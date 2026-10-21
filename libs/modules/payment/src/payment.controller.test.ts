import type { ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { AppError } from '@tarlink/core/errors';
import { AuthGuard, ROLES_KEY, RolesGuard, signAccessToken } from '@tarlink/platform/auth';
import { PaymentController } from './payment.controller';
import { PjpWebhookController } from './pjp-webhook.controller';

const SECRET = 'unit-test-secret-value-0001';

interface FakeRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: { id: string; roles: string[] };
}

function contextFor(request: FakeRequest): ExecutionContext {
  return {
    getHandler: () => (): void => undefined,
    getClass: () => class TestController {},
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => undefined,
      getNext: () => undefined
    })
  } as unknown as ExecutionContext;
}

function classGuardsOf(target: new (...args: never[]) => unknown): unknown[] {
  return (Reflect.getMetadata(GUARDS_METADATA, target) as unknown[] | undefined) ?? [];
}

describe('money routes are guarded', () => {
  it('protects the DP charge route with AuthGuard and RolesGuard', () => {
    const guards = classGuardsOf(PaymentController);
    expect(guards).toContain(AuthGuard);
    expect(guards).toContain(RolesGuard);
  });

  it('protects the refund route with AuthGuard and RolesGuard', () => {
    const guards = classGuardsOf(PaymentController);
    expect(guards).toContain(AuthGuard);
    expect(guards).toContain(RolesGuard);
  });

  it('requires an admin role on the refund route', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      PaymentController.prototype.refund
    ) as string[] | undefined;
    expect(roles).toContain('admin_finance');
    expect(roles).toContain('admin_super');
  });

  it('does not require an admin role on the DP charge route', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      PaymentController.prototype.createDpCharge
    ) as string[] | undefined;
    expect(roles).toBeUndefined();
  });
});

describe('the PJP webhook route stays open for the provider', () => {
  it('applies no guard to the webhook handler', () => {
    expect(classGuardsOf(PjpWebhookController)).toHaveLength(0);
    const methodGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      PjpWebhookController.prototype.handlePjpWebhook
    ) as unknown[] | undefined;
    expect(methodGuards ?? []).toHaveLength(0);
  });
});

describe('AuthGuard on the money routes', () => {
  const guard = new AuthGuard(SECRET);

  it('rejects a request without a bearer token', () => {
    const request: FakeRequest = { headers: {} };
    expect(() => guard.canActivate(contextFor(request))).toThrowError(AppError);
    expect(request.user).toBeUndefined();
  });

  it('takes the identity from the verified token only', () => {
    const token = signAccessToken({ sub: 'customer-1', roles: ['customer'] }, SECRET, 900);
    const request: FakeRequest = {
      headers: { authorization: `Bearer ${token}`, 'x-user-id': 'admin-1' }
    };

    expect(guard.canActivate(contextFor(request))).toBe(true);
    expect(request.user?.id).toBe('customer-1');
    expect(request.user?.roles).toEqual(['customer']);
  });

  it('rejects a token signed with another secret', () => {
    const token = signAccessToken({ sub: 'customer-1', roles: ['customer'] }, 'another-secret-0001', 900);
    const request: FakeRequest = { headers: { authorization: `Bearer ${token}` } };
    expect(() => guard.canActivate(contextFor(request))).toThrowError(AppError);
  });
});
