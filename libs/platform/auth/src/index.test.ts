import { createHmac } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { AppError } from '@tarlink/core/errors';
import {
  AuthGuard,
  ROLES_KEY,
  Roles,
  RolesGuard,
  signAccessToken,
  verifyAccessToken,
  type Role
} from './index';

const SECRET = 'unit-test-secret-value-0001';
const OTHER_SECRET = 'unit-test-secret-value-0002';

interface FakeRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: { id: string; roles: Role[] };
}

function contextFor(
  request: FakeRequest,
  handler: (...args: unknown[]) => unknown = () => undefined
): ExecutionContext {
  const http = {
    getRequest: () => request,
    getResponse: () => undefined,
    getNext: () => undefined
  };
  return {
    getHandler: () => handler,
    getClass: () => class TestController {},
    switchToHttp: () => http
  } as unknown as ExecutionContext;
}

function expectAppError(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(code);
    return;
  }
  throw new Error(`expected AppError ${code} but nothing was thrown`);
}

describe('HS256 access tokens', () => {
  it('round-trips subject and roles', () => {
    const token = signAccessToken({ sub: 'user-1', roles: ['vendor_owner'] }, SECRET, 900);
    const claims = verifyAccessToken(token, SECRET);

    expect(claims.sub).toBe('user-1');
    expect(claims.roles).toEqual(['vendor_owner']);
    expect(claims.exp).toBeGreaterThan(claims.iat);
  });

  it('rejects a tampered payload', () => {
    const token = signAccessToken({ sub: 'user-1', roles: ['customer'] }, SECRET, 900);
    const [header, , signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ sub: 'admin-1', roles: ['admin_super'], iat: 1, exp: 9_999_999_999 })
    ).toString('base64url');

    expectAppError(() => verifyAccessToken(`${header}.${forged}.${signature}`, SECRET), 'UNAUTHENTICATED');
  });

  it('rejects a token signed with another secret', () => {
    const token = signAccessToken({ sub: 'user-1', roles: ['customer'] }, OTHER_SECRET, 900);
    expectAppError(() => verifyAccessToken(token, SECRET), 'UNAUTHENTICATED');
  });

  it('rejects an expired token', () => {
    const token = signAccessToken({ sub: 'user-1', roles: ['customer'] }, SECRET, -60);
    expectAppError(() => verifyAccessToken(token, SECRET), 'UNAUTHENTICATED');
  });

  it('rejects a token with alg none', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({ sub: 'user-1', roles: ['admin_super'], iat: 1, exp: 9_999_999_999 })
    ).toString('base64url');

    expectAppError(() => verifyAccessToken(`${header}.${body}.`, SECRET), 'UNAUTHENTICATED');
  });

  it('rejects a structurally invalid token', () => {
    expectAppError(() => verifyAccessToken('not-a-token', SECRET), 'UNAUTHENTICATED');
  });

  it('requires the secret to be supplied by configuration', () => {
    expect(() => signAccessToken({ sub: 'user-1', roles: ['customer'] }, '', 900)).toThrow(
      /JWT secret/
    );
  });

  it('produces a standard HMAC-SHA256 signature', () => {
    const token = signAccessToken({ sub: 'user-1', roles: [] }, SECRET, 900);
    const [header, body, signature] = token.split('.') as [string, string, string];
    const expected = createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');

    expect(signature).toBe(expected);
  });
});

describe('AuthGuard', () => {
  const guard = new AuthGuard(SECRET);

  it('sets request.user from verified claims', () => {
    const token = signAccessToken({ sub: 'user-9', roles: ['customer'] }, SECRET, 900);
    const request: FakeRequest = { headers: { authorization: `Bearer ${token}` } };

    expect(guard.canActivate(contextFor(request))).toBe(true);
    expect(request.user).toEqual({ id: 'user-9', roles: ['customer'] });
  });

  it('does not trust x-user-id', () => {
    const request: FakeRequest = { headers: { 'x-user-id': 'admin-1' } };

    expectAppError(() => guard.canActivate(contextFor(request)), 'UNAUTHENTICATED');
    expect(request.user).toBeUndefined();
  });

  it('rejects a non-bearer scheme', () => {
    const token = signAccessToken({ sub: 'user-9', roles: ['customer'] }, SECRET, 900);
    const request: FakeRequest = { headers: { authorization: `Basic ${token}` } };

    expectAppError(() => guard.canActivate(contextFor(request)), 'UNAUTHENTICATED');
  });
});

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  it('allows a handler with no role requirement', () => {
    const request: FakeRequest = { headers: {} };
    expect(guard.canActivate(contextFor(request))).toBe(true);
  });

  it('allows a user holding one of the required roles', () => {
    const handler = () => undefined;
    Reflect.defineMetadata(ROLES_KEY, ['admin_finance', 'admin_super'], handler);
    const request: FakeRequest = {
      headers: {},
      user: { id: 'user-9', roles: ['admin_finance'] }
    };

    expect(guard.canActivate(contextFor(request, handler))).toBe(true);
  });

  it('rejects a user without the required role', () => {
    const handler = () => undefined;
    Reflect.defineMetadata(ROLES_KEY, ['admin_finance'], handler);
    const request: FakeRequest = { headers: {}, user: { id: 'user-9', roles: ['customer'] } };

    expectAppError(() => guard.canActivate(contextFor(request, handler)), 'FORBIDDEN');
  });

  it('rejects an unauthenticated request before checking roles', () => {
    const handler = () => undefined;
    Reflect.defineMetadata(ROLES_KEY, ['admin_finance'], handler);

    expectAppError(
      () => guard.canActivate(contextFor({ headers: {} }, handler)),
      'UNAUTHENTICATED'
    );
  });

  it('records role metadata through the decorator', () => {
    class Controller {
      @Roles('vendor_owner', 'vendor_member')
      respond(): void {
        // no body
      }
    }

    const metadata = Reflect.getMetadata(ROLES_KEY, Controller.prototype.respond) as Role[];
    expect(metadata).toEqual(['vendor_owner', 'vendor_member']);
  });
});
