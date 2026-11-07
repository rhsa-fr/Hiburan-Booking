/**
 * HTTP-boundary contract of the auth controller around the HttpOnly refresh
 * cookie. The service is a stub: these tests lock what the browser receives
 * (`Set-Cookie` vs. body `refresh_token`), not the auth rules themselves.
 */
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '@tarlink/core/config';
import { AppError } from '@tarlink/core/errors';
import { signAccessToken, type Role } from '@tarlink/platform/auth';
import { AuthController } from './auth.controller';
import { RefreshRateLimiter } from './refresh-rate-limit';
import type { AuthService, LogoutResult, VerifyOtpResult } from './auth.service';

// `bearerClaims` verifies with `loadConfig().JWT_SECRET`, so this file signs with
// the same value. Seed the env first (same pattern as the other unit suites) so
// the file does not depend on a developer `.env`.
process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/test';
process.env.JWT_SECRET ??= 'test-jwt-secret-at-least-16-chars';

const JWT_SECRET = loadConfig().JWT_SECRET;

const USER_ID = '11111111-1111-4111-8111-111111111111';
const COOKIE_VALUE = 'cookie-refresh-token';
const IP = '203.0.113.9';

const SESSION: VerifyOtpResult = {
  access_token: 'access-token',
  refresh_token: 'refresh-token-from-service',
  token_type: 'Bearer',
  expires_in: 900,
  user: {
    id: USER_ID,
    phone: null,
    roles: ['admin_super' as Role],
    email: 'admin@tarlink.id'
  }
};

/** Minimal stand-in for `AuthService`; only the methods under test exist. */
function stubAuth(overrides: Record<string, unknown> = {}): AuthService {
  return {
    loginWithPassword: async () => SESSION,
    refreshWithToken: async () => SESSION,
    logoutByRefreshToken: async (): Promise<LogoutResult> => ({ revoked: 1 }),
    logout: async (): Promise<LogoutResult> => ({ revoked: 1 }),
    ...overrides
  } as unknown as AuthService;
}

/** Captures `setHeader` calls, the only response surface the controller uses. */
function fakeRes(): {
  res: { setHeader: (name: string, value: string) => void };
  headers: Array<[string, string]>;
} {
  const headers: Array<[string, string]> = [];
  const res = {
    setHeader: (name: string, value: string) => {
      headers.push([name, value]);
    }
  };
  return { res, headers };
}

function setCookie(headers: Array<[string, string]>): string {
  return headers.find(([name]) => name === 'Set-Cookie')?.[1] ?? '';
}

/** Signed access token whose `jti` is the session id the controller revokes. */
function bearer(sub: string, jti: string): string {
  return `Bearer ${signAccessToken({ sub, roles: ['admin_super'], jti }, JWT_SECRET, 900)}`;
}

describe('AuthController refresh cookie contract', () => {
  it('login with cookie:true returns no refresh_token in the body and sets the cookie', async () => {
    const { res, headers } = fakeRes();
    const controller = new AuthController(stubAuth());

    const response = await controller.login(
      { email: 'admin@tarlink.id', password: 'rahasia-admin-2026', cookie: true },
      '203.0.113.1',
      'vitest',
      res
    );

    expect(response.data).not.toHaveProperty('refresh_token');
    const cookie = setCookie(headers);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/v1/auth');
    expect(cookie).toContain(`tarlink_rt=${encodeURIComponent(SESSION.refresh_token)}`);
  });

  it('login without the flag keeps the refresh_token in the body and sets no cookie', async () => {
    const { res, headers } = fakeRes();
    const controller = new AuthController(stubAuth());

    const response = await controller.login(
      { email: 'admin@tarlink.id', password: 'rahasia-admin-2026' },
      '203.0.113.1',
      'vitest',
      res
    );

    expect(response.data).toMatchObject({ refresh_token: SESSION.refresh_token });
    expect(headers).toEqual([]);
  });

  it('login with cookie:true returns a 2FA challenge untouched and sets no cookie', async () => {
    const challenge = {
      mfa_required: true as const,
      challenge_token: 'challenge-token',
      expires_in: 300
    };
    const { res, headers } = fakeRes();
    const controller = new AuthController(
      stubAuth({ loginWithPassword: async () => challenge })
    );

    const response = await controller.login(
      { email: 'admin@tarlink.id', password: 'rahasia-admin-2026', cookie: true },
      '203.0.113.1',
      'vitest',
      res
    );

    expect(response.data).toEqual(challenge);
    expect(headers).toEqual([]);
  });

  it('login with cookie:true fails loudly when there is no response object', async () => {
    const controller = new AuthController(stubAuth());

    await expect(
      controller.login(
        { email: 'admin@tarlink.id', password: 'rahasia-admin-2026', cookie: true },
        '203.0.113.1'
      )
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('refresh with a cookie rotates it and omits refresh_token from the body', async () => {
    const refreshWithToken = vi.fn(async (_token: string) => SESSION);
    const { res, headers } = fakeRes();
    const controller = new AuthController(stubAuth({ refreshWithToken }));

    const response = await controller.refresh(
      {},
      undefined,
      `tarlink_rt=${COOKIE_VALUE}`,
      IP,
      res
    );

    expect(refreshWithToken).toHaveBeenCalledWith(COOKIE_VALUE);
    expect(response.data).not.toHaveProperty('refresh_token');
    expect(setCookie(headers)).toContain(
      `tarlink_rt=${encodeURIComponent(SESSION.refresh_token)}`
    );
  });

  it('refresh with a cookie clears it when the service rejects the token', async () => {
    const failure = new AppError('UNAUTHENTICATED', 'Sesi sudah berakhir. Silakan masuk lagi.');
    const refreshWithToken = vi.fn(async (_token: string): Promise<VerifyOtpResult> => {
      throw failure;
    });
    const { res, headers } = fakeRes();
    const controller = new AuthController(stubAuth({ refreshWithToken }));

    await expect(
      controller.refresh({}, undefined, `tarlink_rt=${COOKIE_VALUE}`, IP, res)
    ).rejects.toBe(failure);

    const cookie = setCookie(headers);
    expect(cookie).toContain('tarlink_rt=;');
    expect(cookie).toContain('Max-Age=0');
  });

  it('logout with only a cookie revokes it even when the Bearer is expired', async () => {
    const logoutByRefreshToken = vi.fn(
      async (_token: string): Promise<LogoutResult> => ({ revoked: 1 })
    );
    const logout = vi.fn(async (): Promise<LogoutResult> => ({ revoked: 1 }));
    const { res, headers } = fakeRes();
    const controller = new AuthController(stubAuth({ logoutByRefreshToken, logout }));

    const response = await controller.logout(
      {},
      'Bearer expired-access-token',
      `tarlink_rt=${COOKIE_VALUE}`,
      res
    );

    expect(response).toEqual({ data: { revoked: 1 } });
    expect(logoutByRefreshToken).toHaveBeenCalledWith(COOKIE_VALUE);
    expect(logout).not.toHaveBeenCalled();
    expect(setCookie(headers)).toContain('Max-Age=0');
  });

  it('logout without any credential is unauthenticated', async () => {
    const { res } = fakeRes();
    const controller = new AuthController(stubAuth());

    await expect(controller.logout({}, undefined, undefined, res)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED'
    });
  });

  it('refresh with only a body token keeps it in the body and sets no cookie', async () => {
    const refreshWithToken = vi.fn(async (_token: string) => SESSION);
    const { res, headers } = fakeRes();
    const controller = new AuthController(stubAuth({ refreshWithToken }));

    const response = await controller.refresh(
      { refresh_token: 'body-refresh-token' },
      undefined,
      undefined,
      IP,
      res
    );

    expect(refreshWithToken).toHaveBeenCalledWith('body-refresh-token');
    expect(response.data).toMatchObject({ refresh_token: SESSION.refresh_token });
    // Mobile must not receive a session cookie as a side effect.
    expect(headers).toEqual([]);
  });

  it('refresh with a rejected body token does not clear a cookie it never used', async () => {
    const failure = new AppError('UNAUTHENTICATED', 'Sesi sudah berakhir. Silakan masuk lagi.');
    const refreshWithToken = vi.fn(async (_token: string): Promise<VerifyOtpResult> => {
      throw failure;
    });
    const { res, headers } = fakeRes();
    const controller = new AuthController(stubAuth({ refreshWithToken }));

    await expect(
      controller.refresh({ refresh_token: 'replayed-token' }, undefined, undefined, IP, res)
    ).rejects.toBe(failure);

    // The clearing Set-Cookie is reserved for the cookie-backed path.
    expect(headers).toEqual([]);
  });

  it('logout with a Bearer for the same session as the cookie revokes it once', async () => {
    const sessionJti = 'session-jti-1';
    const revokedSessions = new Set<string>();

    // Mirrors the repository: revoking an already revoked session returns 0, so
    // reaching the same session through both credentials counts once.
    const logoutByRefreshToken = vi.fn(async (_token: string): Promise<LogoutResult> => {
      revokedSessions.add(sessionJti);
      return { revoked: 1 };
    });
    const logout = vi.fn(
      async (_userId: string, jti?: string | null): Promise<LogoutResult> => {
        if (!jti || revokedSessions.has(jti)) return { revoked: 0 };
        revokedSessions.add(jti);
        return { revoked: 1 };
      }
    );
    const { res } = fakeRes();
    const controller = new AuthController(stubAuth({ logoutByRefreshToken, logout }));

    const response = await controller.logout(
      {},
      bearer(USER_ID, sessionJti),
      `tarlink_rt=${COOKIE_VALUE}`,
      res
    );

    expect(response).toEqual({ data: { revoked: 1 } });
    expect(logoutByRefreshToken).toHaveBeenCalledWith(COOKIE_VALUE);
    expect(logout).toHaveBeenCalledWith(USER_ID, sessionJti);
  });

  it('logout with the same token in the body and the cookie revokes it once', async () => {
    const logoutByRefreshToken = vi.fn(
      async (_token: string): Promise<LogoutResult> => ({ revoked: 1 })
    );
    const { res } = fakeRes();
    const controller = new AuthController(stubAuth({ logoutByRefreshToken }));

    const response = await controller.logout(
      { refresh_token: COOKIE_VALUE },
      undefined,
      `tarlink_rt=${COOKIE_VALUE}`,
      res
    );

    expect(response).toEqual({ data: { revoked: 1 } });
    expect(logoutByRefreshToken).toHaveBeenCalledTimes(1);
  });

  it('logout with only a Bearer revokes the session and clears the cookie', async () => {
    const logout = vi.fn(
      async (_userId: string, _jti?: string | null): Promise<LogoutResult> => ({ revoked: 1 })
    );
    const logoutByRefreshToken = vi.fn(
      async (_token: string): Promise<LogoutResult> => ({ revoked: 1 })
    );
    const { res, headers } = fakeRes();
    const controller = new AuthController(stubAuth({ logout, logoutByRefreshToken }));

    const response = await controller.logout({}, bearer(USER_ID, 'session-jti-5'), undefined, res);

    expect(response).toEqual({ data: { revoked: 1 } });
    expect(logout).toHaveBeenCalledWith(USER_ID, 'session-jti-5');
    expect(logoutByRefreshToken).not.toHaveBeenCalled();
    expect(setCookie(headers)).toContain('Max-Age=0');
  });

  it('refresh on the legacy Bearer path with cookie:true issues a cookie only', async () => {
    const refresh = vi.fn(async (_userId: string, _jti?: string | null) => SESSION);
    const { res, headers } = fakeRes();
    const controller = new AuthController(stubAuth({ refresh }));

    const response = await controller.refresh(
      { cookie: true },
      bearer(USER_ID, 'session-jti-6'),
      undefined,
      IP,
      res
    );

    expect(refresh).toHaveBeenCalledWith(USER_ID, 'session-jti-6');
    expect(response.data).not.toHaveProperty('refresh_token');
    expect(setCookie(headers)).toContain(
      `tarlink_rt=${encodeURIComponent(SESSION.refresh_token)}`
    );
  });
});

describe('AuthController refresh hardening', () => {
  const UNDECODABLE = 'tarlink_rt=%E0%A4%A';
  const AUTH_FAILURE = (): AppError =>
    new AppError('UNAUTHENTICATED', 'Sesi sudah berakhir. Silakan masuk lagi.');

  it('clears an undecodable cookie and answers UNAUTHENTICATED', async () => {
    const { res, headers } = fakeRes();
    const controller = new AuthController(stubAuth());

    await expect(
      controller.refresh({}, undefined, UNDECODABLE, IP, res)
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    const cookie = setCookie(headers);
    expect(cookie).toContain('tarlink_rt=;');
    expect(cookie).toContain('Max-Age=0');
  });

  it('falls back to a valid Bearer and still drops the undecodable cookie', async () => {
    const refresh = vi.fn(async (_userId: string, _jti?: string | null) => SESSION);
    const { res, headers } = fakeRes();
    const controller = new AuthController(stubAuth({ refresh }));

    const response = await controller.refresh(
      {},
      bearer(USER_ID, 'session-jti-7'),
      UNDECODABLE,
      IP,
      res
    );

    expect(refresh).toHaveBeenCalledWith(USER_ID, 'session-jti-7');
    expect(response.data).toMatchObject({ refresh_token: SESSION.refresh_token });
    expect(setCookie(headers)).toContain('tarlink_rt=;');
    expect(setCookie(headers)).toContain('Max-Age=0');
  });

  it('logout drops an undecodable cookie even when it answers 401', async () => {
    const { res, headers } = fakeRes();
    const controller = new AuthController(stubAuth());

    await expect(
      controller.logout({}, undefined, UNDECODABLE, res)
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    expect(setCookie(headers)).toContain('tarlink_rt=;');
    expect(setCookie(headers)).toContain('Max-Age=0');
  });

  it('throttles once failed refreshes from one IP exceed the limit', async () => {
    const refreshWithToken = vi.fn(async (_token: string): Promise<VerifyOtpResult> => {
      throw AUTH_FAILURE();
    });
    const { res } = fakeRes();
    const controller = new AuthController(
      stubAuth({ refreshWithToken }),
      new RefreshRateLimiter({ max: 2, windowMs: 60_000 })
    );

    await expect(
      controller.refresh({ refresh_token: 'bad-1' }, undefined, undefined, IP, res)
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(
      controller.refresh({ refresh_token: 'bad-2' }, undefined, undefined, IP, res)
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(
      controller.refresh({ refresh_token: 'bad-3' }, undefined, undefined, IP, res)
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('does not charge the quota for a successful refresh', async () => {
    const refreshWithToken = vi.fn(async (token: string): Promise<VerifyOtpResult> => {
      if (token === 'good-token') return SESSION;
      throw AUTH_FAILURE();
    });
    const { res } = fakeRes();
    const controller = new AuthController(
      stubAuth({ refreshWithToken }),
      new RefreshRateLimiter({ max: 2, windowMs: 60_000 })
    );

    await expect(
      controller.refresh({ refresh_token: 'good-token' }, undefined, undefined, IP, res)
    ).resolves.toMatchObject({ data: SESSION });
    await expect(
      controller.refresh({ refresh_token: 'bad-1' }, undefined, undefined, IP, res)
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(
      controller.refresh({ refresh_token: 'bad-2' }, undefined, undefined, IP, res)
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(
      controller.refresh({ refresh_token: 'bad-3' }, undefined, undefined, IP, res)
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('counts each IP independently', async () => {
    const refreshWithToken = vi.fn(async (_token: string): Promise<VerifyOtpResult> => {
      throw AUTH_FAILURE();
    });
    const { res } = fakeRes();
    const controller = new AuthController(
      stubAuth({ refreshWithToken }),
      new RefreshRateLimiter({ max: 1, windowMs: 60_000 })
    );

    await expect(
      controller.refresh({ refresh_token: 'bad' }, undefined, undefined, '203.0.113.1', res)
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(
      controller.refresh({ refresh_token: 'bad' }, undefined, undefined, '203.0.113.1', res)
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    // A different network still gets its first failure counted, not blocked.
    await expect(
      controller.refresh({ refresh_token: 'bad' }, undefined, undefined, '203.0.113.2', res)
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('does not count operational errors toward the quota', async () => {
    let mode: 'internal' | 'auth' = 'internal';
    const refreshWithToken = vi.fn(async (_token: string): Promise<VerifyOtpResult> => {
      if (mode === 'internal') throw new AppError('INTERNAL_ERROR', 'database unavailable');
      throw AUTH_FAILURE();
    });
    const { res } = fakeRes();
    const controller = new AuthController(
      stubAuth({ refreshWithToken }),
      new RefreshRateLimiter({ max: 1, windowMs: 60_000 })
    );

    await expect(
      controller.refresh({ refresh_token: 'x' }, undefined, undefined, IP, res)
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    await expect(
      controller.refresh({ refresh_token: 'x' }, undefined, undefined, IP, res)
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });

    // Two 500s consumed nothing: the first real auth failure is still 1 of 1.
    mode = 'auth';
    await expect(
      controller.refresh({ refresh_token: 'x' }, undefined, undefined, IP, res)
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(
      controller.refresh({ refresh_token: 'x' }, undefined, undefined, IP, res)
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('keeps the refresh cookie when the failure is not a credential rejection', async () => {
    const refreshWithToken = vi.fn(async (): Promise<VerifyOtpResult> => {
      throw new AppError('INTERNAL_ERROR', 'database unavailable');
    });
    const { res, headers } = fakeRes();
    const controller = new AuthController(stubAuth({ refreshWithToken }));

    await expect(
      controller.refresh({}, undefined, `tarlink_rt=${COOKIE_VALUE}`, IP, res)
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });

    // A 5xx says nothing about the cookie; dropping it would force a re-login.
    expect(headers).toEqual([]);
  });

  it('does not clear the cookie when the request is throttled', async () => {
    const refreshWithToken = vi.fn(async (): Promise<VerifyOtpResult> => {
      throw AUTH_FAILURE();
    });
    const { res, headers } = fakeRes();
    const controller = new AuthController(
      stubAuth({ refreshWithToken }),
      new RefreshRateLimiter({ max: 0, windowMs: 60_000 })
    );

    await expect(
      controller.refresh({}, undefined, `tarlink_rt=${COOKIE_VALUE}`, IP, res)
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });

    // The credential was never judged invalid, so it must survive the 429.
    expect(headers).toEqual([]);
  });
});
