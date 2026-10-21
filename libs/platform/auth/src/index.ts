import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  Inject,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
  type Provider
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '@tarlink/core/errors';

/** D-08 roles. Mirrors the `user_role` enum in migration 001_core. */
export type Role =
  | 'customer'
  | 'vendor_owner'
  | 'vendor_member'
  | 'admin_support'
  | 'admin_finance'
  | 'admin_super';

export interface AccessTokenPayload {
  sub: string;
  roles: Role[];
  /** Session id (`sessions.jti`). Optional: older callers omit it. */
  jti?: string;
}

export interface AccessTokenClaims extends AccessTokenPayload {
  iat: number;
  exp: number;
}

const JWT_HEADER = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

function base64UrlEncode(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function decodeJson(segment: string): unknown {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    throw new AppError('UNAUTHENTICATED', 'Malformed token');
  }
}

function sign(data: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(data).digest();
}

function assertSecret(secret: string): void {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('JWT secret must be provided by configuration');
  }
}

function assertPayload(payload: AccessTokenPayload): void {
  if (!payload || typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'Access token requires a subject');
  }
  if (!Array.isArray(payload.roles)) {
    throw new AppError('VALIDATION_ERROR', 'Access token requires a roles array');
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** Signs an HS256 access token. `ttlSeconds` is required — there is no implicit TTL. */
export function signAccessToken(
  payload: AccessTokenPayload,
  secret: string,
  ttlSeconds: number
): string {
  assertSecret(secret);
  assertPayload(payload);
  if (!Number.isFinite(ttlSeconds)) {
    throw new AppError('VALIDATION_ERROR', 'ttlSeconds must be a finite number');
  }

  const issuedAt = nowSeconds();
  const claims: AccessTokenClaims = {
    sub: payload.sub,
    roles: [...payload.roles],
    ...(payload.jti ? { jti: payload.jti } : {}),
    iat: issuedAt,
    exp: issuedAt + Math.floor(ttlSeconds)
  };

  const body = `${JWT_HEADER}.${base64UrlEncode(JSON.stringify(claims))}`;
  return `${body}.${sign(body, secret).toString('base64url')}`;
}

/**
 * Verifies signature, algorithm and expiry. Anything that is not a valid,
 * unexpired HS256 token signed with `secret` becomes UNAUTHENTICATED.
 */
export function verifyAccessToken(token: string, secret: string): AccessTokenClaims {
  assertSecret(secret);
  if (typeof token !== 'string') {
    throw new AppError('UNAUTHENTICATED', 'Access token is required');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new AppError('UNAUTHENTICATED', 'Malformed token');
  }

  const [header, body, signature] = parts as [string, string, string];

  const headerJson = decodeJson(header);
  if (
    typeof headerJson !== 'object' ||
    headerJson === null ||
    (headerJson as { alg?: unknown }).alg !== 'HS256'
  ) {
    throw new AppError('UNAUTHENTICATED', 'Unsupported token algorithm');
  }

  const expected = sign(`${header}.${body}`, secret);
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new AppError('UNAUTHENTICATED', 'Invalid token signature');
  }

  const claims = decodeJson(body) as Partial<AccessTokenClaims> | null;
  if (
    !claims ||
    typeof claims.sub !== 'string' ||
    claims.sub.length === 0 ||
    !Array.isArray(claims.roles) ||
    typeof claims.exp !== 'number' ||
    typeof claims.iat !== 'number'
  ) {
    throw new AppError('UNAUTHENTICATED', 'Invalid token claims');
  }

  if (claims.exp <= nowSeconds()) {
    throw new AppError('UNAUTHENTICATED', 'Access token expired');
  }

  return {
    sub: claims.sub,
    roles: claims.roles as Role[],
    ...(typeof claims.jti === 'string' ? { jti: claims.jti } : {}),
    iat: claims.iat,
    exp: claims.exp
  };
}

export interface AuthenticatedUser {
  id: string;
  roles: Role[];
  /** Session id carried by tokens minted since session rotation; absent on older tokens. */
  jti?: string;
}

/** The only user shape guards accept. It is populated from verified claims. */
export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthenticatedUser;
}

/**
 * Verifies `Authorization: Bearer <access_token>` and sets `request.user`.
 * It deliberately ignores `x-user-id` and every other identity header: identity
 * comes from the signed token only.
 *
 * The secret is a constructor argument, never a literal: wire it from config with
 * `authGuardProvider(cfg.JWT_SECRET)` (or any `useFactory`) so no environment
 * value is compiled into the bundle.
 */
/**
 * Token injection untuk secret JWT.
 *
 * `secret: string` sebagai parameter constructor tidak bisa di-inject Nest
 * (primitive tidak punya token), sehingga Nest akan mencoba instantiate
 * `AuthGuard` sendiri dan gagal. Pola yang benar: secret diberikan sebagai
 * provider ber-token.
 *
 * Di setiap module yang memakai guard:
 *   providers: [
 *     { provide: JWT_SECRET, useValue: loadConfig().JWT_SECRET },
 *     { provide: AuthGuard, useClass: AuthGuard },
 *   ]
 */
export const JWT_SECRET = 'TARLINK_JWT_SECRET';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(JWT_SECRET) private readonly secret: string) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers['authorization'];
    const value = Array.isArray(header) ? header[0] : header;
    const match = /^Bearer\s+(.+)$/i.exec(value ?? '');

    if (!match || !match[1]) {
      throw new AppError('UNAUTHENTICATED', 'Authorization Bearer token is required');
    }

    const claims = verifyAccessToken(match[1], this.secret);
    request.user = {
      id: claims.sub,
      roles: claims.roles,
      ...(claims.jti ? { jti: claims.jti } : {})
    };
    return true;
  }
}

/** Registers AuthGuard with a secret supplied by configuration. */
export function authGuardProvider(secret: string): Provider {
  return { provide: AuthGuard, useValue: new AuthGuard(secret) };
}

export const ROLES_KEY = 'tarlink:roles';

/** Declares the roles allowed to reach a handler or controller. */
export function Roles(...roles: Role[]): MethodDecorator & ClassDecorator {
  return SetMetadata(ROLES_KEY, roles);
}

/**
 * Enforces `@Roles(...)` metadata. Runs after AuthGuard; it reads only
 * `request.user`, never request headers.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass()
    ]);

    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user) {
      throw new AppError('UNAUTHENTICATED', 'Authentication is required');
    }

    if (!required.some((role) => user.roles.includes(role))) {
      throw new AppError('FORBIDDEN', 'Role is not permitted for this action');
    }

    return true;
  }
}
