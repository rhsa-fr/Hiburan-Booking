/**
 * HTTP surface for the auth slice.
 *
 * Routes are mounted under the global `v1` prefix (`apps/api/src/main.ts`):
 *   POST /v1/auth/otp/request  — public
 *   POST /v1/auth/otp/verify   — public
 *   POST /v1/auth/login        — public (email + password, all roles)
 *   POST /v1/auth/register     — public (customer self-registration)
 *   POST /v1/auth/google       — public (Google ID token)
 *   POST /v1/auth/2fa/verify   — public (challenge token + TOTP code)
 *   POST /v1/auth/2fa/backup-code — public (challenge token + backup code)
 *   POST /v1/auth/2fa/enroll   — public (enroll ticket -> secret)
 *   POST /v1/auth/2fa/enroll/verify — public (enroll ticket + code -> session)
 *   POST /v1/auth/2fa/reset    — admin_super bearer token required
 *   POST /v1/auth/logout       — bearer token, refresh cookie or body token required
 *
 * Credential endpoints are public by design: the credential is the proof.
 * Logout takes its identity from the verified token (`AuthGuard`), never from a
 * header. Responses use the project envelope `{ "data": … }`; errors are mapped
 * by the global filter from `AppError`.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Ip,
  Post,
  Req,
  Res,
  UseGuards
} from '@nestjs/common';
import { z } from 'zod';
import { loadConfig } from '@tarlink/core/config';
import { AppError } from '@tarlink/core/errors';
import {
  AuthGuard,
  Roles,
  RolesGuard,
  verifyAccessToken,
  type AuthenticatedRequest
} from '@tarlink/platform/auth';
import {
  AuthService,
  type AccountDeletionResult,
  type CurrentUserResult,
  type LogoutResult,
  type MfaChallengeResult,
  type PasswordLoginResult,
  type RequestOtpResult,
  type TwoFactorEnrolledResult,
  type TwoFactorEnrollmentStartResult,
  type TwoFactorResetResult,
  type VerifyOtpResult
} from './auth.service';
import {
  REFRESH_COOKIE_NAME,
  clearRefreshCookie,
  hasCookie,
  readCookie,
  serializeRefreshCookie
} from './auth.cookies';
import { RefreshRateLimiter } from './refresh-rate-limit';

/**
 * Minimal response surface used with `@Res({ passthrough: true })`. Typing it
 * locally avoids pulling Express types into this module.
 */
interface CookieResponse {
  setHeader(name: string, value: string): void;
}

/**
 * Body of a session-issuing endpoint once the refresh token has moved into the
 * HttpOnly cookie: the token is no longer part of the JSON payload.
 */
export type LoginResponse = Omit<VerifyOtpResult, 'refresh_token'> | MfaChallengeResult;

/** `2fa/enroll/verify` additionally returns the one-time backup codes. */
export type TwoFactorEnrollResponse =
  | TwoFactorEnrolledResult
  | Omit<TwoFactorEnrolledResult, 'refresh_token'>;

/**
 * Reads the cookie lifetime from the same config the service uses, so the
 * cookie cannot outlive the session row it refers to.
 */
function refreshCookieOptions(): { secure: boolean; maxAgeSeconds: number } {
  const cfg = loadConfig();
  return {
    secure: cfg.NODE_ENV === 'production',
    maxAgeSeconds: cfg.REFRESH_TTL_DAYS * 86400
  };
}

/**
 * Writes the rotated refresh token as an HttpOnly cookie. A missing response
 * object must fail loudly: the caller already stripped `refresh_token` from the
 * body, so returning silently would hand the client a session with no credential.
 */
function issueRefreshCookie(res: CookieResponse | undefined, refreshToken: string): void {
  if (!res) {
    throw new AppError('INTERNAL_ERROR', 'Tidak dapat menyimpan sesi: respons tidak tersedia.');
  }
  res.setHeader('Set-Cookie', serializeRefreshCookie(refreshToken, refreshCookieOptions()));
}

/** `Set-Cookie` value that drops the refresh cookie on this deployment. */
function clearedRefreshCookie(): string {
  return clearRefreshCookie({ secure: refreshCookieOptions().secure });
}

/** Copies a session result without the token that now travels in the cookie. */
function stripRefreshToken<T extends VerifyOtpResult>(result: T): Omit<T, 'refresh_token'> {
  const { refresh_token: _movedToCookie, ...rest } = result;
  return rest;
}

/**
 * Applies the opt-in `cookie: true` contract to a login-style result. A 2FA
 * challenge has no `refresh_token`, so it is returned untouched and no cookie
 * is set. Without `cookie: true` the body is byte-identical to the old shape.
 */
function loginResponse(
  res: CookieResponse | undefined,
  result: PasswordLoginResult,
  cookie: boolean
): PasswordLoginResult | LoginResponse {
  if (!cookie) return result;
  if (!('refresh_token' in result)) return result;

  issueRefreshCookie(res, result.refresh_token);
  return stripRefreshToken(result);
}

const RequestOtpBody = z.object({
  email: z.string().trim().max(150).email('email is not valid')
});

const VerifyOtpBody = z.object({
  email: z.string().trim().max(150).email('email is not valid'),
  code: z.string().regex(/^\d{6}$/, 'code must be 6 digits')
});

/**
 * `cookie: true` is opt-in for the admin panel: the refresh token goes into an
 * HttpOnly `Set-Cookie` instead of the JSON body. Mobile omits it and keeps
 * receiving `refresh_token` in the body.
 */
const LoginBody = z.object({
  email: z.string().trim().max(150).email('email is not valid'),
  password: z.string().min(8).max(200),
  cookie: z.boolean().optional()
});

/**
 * `.strict()` is deliberate: a `role` (or any other unknown key) is rejected
 * instead of being silently ignored. Public registration is customer-only.
 */
/** FR-103: both policy versions are required and must be the active ones. */
const ConsentBody = z
  .object({
    tos_version_id: z.string().uuid(),
    privacy_version_id: z.string().uuid()
  })
  .strict();

const RegisterBody = z
  .object({
    email: z.string().trim().max(150).email('email is not valid'),
    password: z.string().min(8).max(200),
    phone: z.string().min(1).max(20).optional(),
    full_name: z.string().trim().min(1).max(100).optional(),
    consent: ConsentBody
  })
  .strict();

/**
 * FR-103: `consent` is optional because an existing account logging in again has
 * nothing left to accept. The service requires it only when this call creates a
 * new account; the outer object stays open for clients that send extra fields.
 */
const GoogleBody = z.object({
  id_token: z.string().min(1).max(4096),
  consent: ConsentBody.optional(),
  cookie: z.boolean().optional()
});

/** Refresh accepts the opaque token; the legacy access-token path still works. */
const RefreshBody = z.object({
  refresh_token: z.string().min(1).max(256).optional(),
  cookie: z.boolean().optional()
});

/**
 * Logout only takes the opaque refresh token. `cookie` belongs to `/auth/refresh`
 * and the login-style bodies; accepting it here implied an effect logout never
 * had.
 */
const LogoutBody = z.object({
  refresh_token: z.string().min(1).max(256).optional()
});

/** Typed confirmation keeps an accidental `DELETE` from wiping an account. */
const DeleteAccountBody = z.object({
  confirm: z.literal('HAPUS AKUN'),
  reason: z.string().max(300).optional()
});

/** FR-128: opaque ticket from the login step plus the authenticator code. */
const TwoFactorVerifyBody = z.object({
  challenge_token: z.string().min(1).max(256),
  code: z.string().regex(/^\d{6}$/, 'code must be 6 digits'),
  cookie: z.boolean().optional()
});

/** Backup codes are `XXXX-XXXX`; dashes and case are normalised by the service. */
const TwoFactorBackupBody = z.object({
  challenge_token: z.string().min(1).max(256),
  code: z.string().min(1).max(32),
  cookie: z.boolean().optional()
});

const TwoFactorEnrollBody = z.object({
  enroll_token: z.string().min(1).max(256)
});

const TwoFactorEnrollVerifyBody = z.object({
  enroll_token: z.string().min(1).max(256),
  code: z.string().regex(/^\d{6}$/, 'code must be 6 digits'),
  cookie: z.boolean().optional()
});

const TwoFactorResetBody = z.object({
  user_id: z.string().uuid()
});

function bearerClaims(authorization: string | undefined): { sub: string; jti?: string } | null {
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return null;
  try {
    return verifyAccessToken(authorization.slice('Bearer '.length), loadConfig().JWT_SECRET);
  } catch {
    return null;
  }
}

@Controller('auth')
export class AuthController {
  /**
   * The limiter default keeps direct `new AuthController(service)` call sites
   * (tests, scripts) working; Nest injects the module-registered instance.
   */
  constructor(
    private readonly auth: AuthService,
    private readonly refreshLimiter: RefreshRateLimiter = new RefreshRateLimiter()
  ) {}

  @Post('otp/request')
  @HttpCode(200)
  async requestOtp(@Body() body: unknown, @Ip() ip: string): Promise<{ data: RequestOtpResult }> {
    const parsed = RequestOtpBody.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'invalid OTP request', parsed.error.issues);
    }

    return { data: await this.auth.requestOtp({ email: parsed.data.email, ip }) };
  }

  @Post('otp/verify')
  @HttpCode(200)
  async verifyOtp(
    @Body() body: unknown,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string
  ): Promise<{ data: PasswordLoginResult }> {
    const parsed = VerifyOtpBody.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'invalid OTP verification request', parsed.error.issues);
    }

    return { data: await this.auth.verifyOtp({ ...parsed.data, ip, userAgent }) };
  }

  /**
   * Email + password login for every role. Public by design (the credentials are
   * the proof); every rejection uses the same generic error.
   */
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
    @Res({ passthrough: true }) res?: CookieResponse
  ): Promise<{ data: PasswordLoginResult | LoginResponse }> {
    const parsed = LoginBody.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'invalid login request', parsed.error.issues);
    }
    const { cookie, ...credentials } = parsed.data;

    const result = await this.auth.loginWithPassword({ ...credentials, ip, userAgent });
    return { data: loginResponse(res, result, cookie === true) };
  }

  /**
   * Public customer registration. A `role` field is rejected by the strict
   * schema; the service creates the `customer` role regardless.
   */
  @Post('register')
  @HttpCode(201)
  async register(
    @Body() body: unknown,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string
  ): Promise<{ data: VerifyOtpResult }> {
    const parsed = RegisterBody.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'invalid registration request', parsed.error.issues);
    }

    return { data: await this.auth.register({ ...parsed.data, ip, userAgent }) };
  }

  /** Google Sign-In: exchanges a Google ID token for our access token. */
  @Post('google')
  @HttpCode(200)
  async google(
    @Body() body: unknown,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
    @Res({ passthrough: true }) res?: CookieResponse
  ): Promise<{ data: PasswordLoginResult | LoginResponse }> {
    const parsed = GoogleBody.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'invalid Google sign-in request', parsed.error.issues);
    }
    const { cookie, ...identity } = parsed.data;

    const result = await this.auth.loginWithGoogle({ ...identity, ip, userAgent });
    return { data: loginResponse(res, result, cookie === true) };
  }

  /**
   * FR-128: completes an admin login that was paused before a session was
   * issued. Public by design: the challenge token is the credential.
   */
  @Post('2fa/verify')
  @HttpCode(200)
  async verifyTwoFactor(
    @Body() body: unknown,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
    @Res({ passthrough: true }) res?: CookieResponse
  ): Promise<{ data: PasswordLoginResult | LoginResponse }> {
    const parsed = TwoFactorVerifyBody.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'invalid 2FA verification request', parsed.error.issues);
    }
    const { cookie, ...challenge } = parsed.data;

    const result = await this.auth.verifyTwoFactorCode({ ...challenge, ip, userAgent });
    return { data: loginResponse(res, result, cookie === true) };
  }

  /** Same challenge, backup-code credential instead of TOTP. */
  @Post('2fa/backup-code')
  @HttpCode(200)
  async verifyBackupCode(
    @Body() body: unknown,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
    @Res({ passthrough: true }) res?: CookieResponse
  ): Promise<{ data: PasswordLoginResult | LoginResponse }> {
    const parsed = TwoFactorBackupBody.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'invalid backup code request', parsed.error.issues);
    }
    const { cookie, ...challenge } = parsed.data;

    const result = await this.auth.verifyBackupCode({ ...challenge, ip, userAgent });
    return { data: loginResponse(res, result, cookie === true) };
  }

  /** Step 1 of enrollment: returns the secret and `otpauth://` URI exactly once. */
  @Post('2fa/enroll')
  @HttpCode(200)
  async enrollTwoFactor(@Body() body: unknown): Promise<{ data: TwoFactorEnrollmentStartResult }> {
    const parsed = TwoFactorEnrollBody.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'invalid 2FA enrollment request', parsed.error.issues);
    }

    return { data: await this.auth.beginTwoFactorEnrollment(parsed.data) };
  }

  /** Step 2: activates 2FA, issues the session and shows backup codes once. */
  @Post('2fa/enroll/verify')
  @HttpCode(200)
  async completeTwoFactorEnrollment(
    @Body() body: unknown,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
    @Res({ passthrough: true }) res?: CookieResponse
  ): Promise<{ data: TwoFactorEnrollResponse }> {
    const parsed = TwoFactorEnrollVerifyBody.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'invalid 2FA enrollment request', parsed.error.issues);
    }
    const { cookie, ...enrollment } = parsed.data;

    const result = await this.auth.completeTwoFactorEnrollment({ ...enrollment, ip, userAgent });
    if (cookie !== true) return { data: result };

    issueRefreshCookie(res, result.refresh_token);
    return { data: stripRefreshToken(result) };
  }

  /**
   * FR-128 recovery: only `admin_super` may clear another admin's TOTP. The
   * service revokes every session of the target and writes `audit_logs`.
   */
  @Post('2fa/reset')
  @HttpCode(200)
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('admin_super')
  async resetTwoFactor(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Headers('x-request-id') requestId?: string
  ): Promise<{ data: TwoFactorResetResult }> {
    const actor = req.user;
    if (!actor) {
      throw new AppError('UNAUTHENTICATED', 'Authentication is required');
    }

    const parsed = TwoFactorResetBody.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'invalid 2FA reset request', parsed.error.issues);
    }

    const actorRole = actor.roles.includes('admin_super')
      ? 'admin_super'
      : (actor.roles.find((role) => role.startsWith('admin_')) ?? null);

    return {
      data: await this.auth.resetTwoFactor({
        userId: parsed.data.user_id,
        actorId: actor.id,
        actorRole,
        requestId: requestId ?? null
      })
    };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
    @Headers('cookie') cookieHeader?: string,
    @Res({ passthrough: true }) res?: CookieResponse
  ): Promise<{ data: LogoutResult }> {
    const parsed = LogoutBody.safeParse(body ?? {});
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'invalid logout request', parsed.error.issues);
    }

    const bodyToken = parsed.data.refresh_token;
    const cookiePresent = hasCookie(cookieHeader, REFRESH_COOKIE_NAME);
    const cookieToken = readCookie(cookieHeader, REFRESH_COOKIE_NAME);
    // The panel's access token lives 15 minutes, so an expired Bearer must not
    // block a logout that still carries a refresh credential.
    const claims = bearerClaims(authorization);

    // Clear before the "no usable credential" 401: a cookie present in the
    // header is dropped even when its value is empty or undecodable.
    if (res && cookiePresent) {
      res.setHeader('Set-Cookie', clearedRefreshCookie());
    }

    if (!bodyToken && cookieToken === null && !claims) {
      throw new AppError('UNAUTHENTICATED', 'Authentication is required');
    }

    // The cookie is cleared on every successful logout, including the Bearer
    // path: a stale cookie must not be able to refresh the session we just ended.
    if (res && !cookiePresent) {
      res.setHeader('Set-Cookie', clearedRefreshCookie());
    }

    // A refresh-token logout works even when the access token already expired;
    // the same token arriving in both places is revoked once.
    let revoked = 0;
    if (bodyToken) {
      revoked += (await this.auth.logoutByRefreshToken(bodyToken)).revoked;
    }
    if (cookieToken !== null && cookieToken !== bodyToken) {
      revoked += (await this.auth.logoutByRefreshToken(cookieToken)).revoked;
    }
    if (claims) {
      revoked += (await this.auth.logout(claims.sub, claims.jti)).revoked;
    }

    return { data: { revoked } };
  }

  /** Profile of the verified caller; roles come from the database, not the token. */
  @Get('me')
  @UseGuards(AuthGuard)
  async me(@Req() req: AuthenticatedRequest): Promise<{ data: CurrentUserResult }> {
    const user = req.user;
    if (!user) {
      throw new AppError('UNAUTHENTICATED', 'Authentication is required');
    }

    return { data: await this.auth.getProfile(user.id) };
  }

  /**
   * FR-101: self-service account deletion. The account is anonymised in place,
   * so financial records keep their references.
   */
  @Delete('me')
  @UseGuards(AuthGuard)
  @HttpCode(200)
  async deleteMe(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ): Promise<{ data: AccountDeletionResult }> {
    const user = req.user;
    if (!user) throw new AppError('UNAUTHENTICATED', 'Authentication is required');

    const parsed = DeleteAccountBody.safeParse(body ?? {});
    if (!parsed.success) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Kirim konfirmasi "HAPUS AKUN" untuk menghapus akun.',
        parsed.error.issues
      );
    }

    return { data: await this.auth.deleteAccount(user.id, parsed.data.reason ?? null) };
  }

  /** Status of the newest deletion request (visible in the app after deletion). */
  @Get('account-deletion')
  @UseGuards(AuthGuard)
  async deletionStatus(
    @Req() req: AuthenticatedRequest
  ): Promise<{ data: AccountDeletionResult | null }> {
    const user = req.user;
    if (!user) throw new AppError('UNAUTHENTICATED', 'Authentication is required');
    return { data: await this.auth.getDeletionStatus(user.id) };
  }

  /**
   * Runs one credential check and counts only genuine authentication failures.
   * Operational errors (internal, upstream) are rethrown untouched and must not
   * consume the caller's quota. `ip` falls back to an empty string for direct
   * callers; Nest always supplies a value.
   */
  private async attemptRefresh<T>(ip: string, attempt: () => Promise<T>): Promise<T> {
    try {
      return await attempt();
    } catch (error) {
      if (
        error instanceof AppError &&
        error.code === 'UNAUTHENTICATED' &&
        typeof ip === 'string' &&
        ip.length > 0 &&
        this.refreshLimiter.recordFailure(ip)
      ) {
        throw new AppError(
          'RATE_LIMITED',
          'Too many refresh attempts from this network. Try again later.'
        );
      }
      throw error;
    }
  }

  /**
   * Rotates the session and returns a new access + refresh pair.
   * A `refresh_token` body is the primary path for mobile (works after the
   * access token expired). The browser sends the `tarlink_rt` cookie instead and
   * gets the rotated token back as a cookie, never in the body. The legacy
   * Bearer path is kept for clients that have not migrated.
   */
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
    @Headers('cookie') cookieHeader?: string,
    @Ip() ip: string = '',
    @Res({ passthrough: true }) res?: CookieResponse
  ): Promise<{ data: PasswordLoginResult | LoginResponse }> {
    const parsed = RefreshBody.safeParse(body ?? {});
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'invalid refresh request', parsed.error.issues);
    }

    const bodyToken = parsed.data.refresh_token;
    const cookiePresent = hasCookie(cookieHeader, REFRESH_COOKIE_NAME);
    const cookieToken = readCookie(cookieHeader, REFRESH_COOKIE_NAME);

    if (bodyToken) {
      const result = await this.attemptRefresh(ip, () => this.auth.refreshWithToken(bodyToken));

      // A corrupt cookie must not survive a body-token refresh either; a mobile
      // client has no cookie header, so this stays a no-op for the app flow.
      if (cookiePresent && cookieToken === null && res) {
        res.setHeader('Set-Cookie', clearedRefreshCookie());
      }

      // The cookie is only touched on the explicit opt-in: a client that sent a
      // body token (mobile) must not receive a session cookie as a side effect.
      return { data: loginResponse(res, result, parsed.data.cookie === true) };
    }

    if (cookieToken !== null) {
      try {
        const result = await this.attemptRefresh(ip, () => this.auth.refreshWithToken(cookieToken));
        return { data: loginResponse(res, result, true) };
      } catch (error) {
        // Clear only a credential the server actually rejected. A 429 from the
        // throttle or a 5xx from the database says nothing about the cookie;
        // dropping it would turn a transient outage into a forced re-login.
        if (res && error instanceof AppError && error.code === 'UNAUTHENTICATED') {
          res.setHeader('Set-Cookie', clearedRefreshCookie());
        }
        throw error;
      }
    }

    // A cookie that is present but undecodable cannot be used, yet it must not
    // survive: drop it before falling through to the Bearer path or the 401.
    if (cookiePresent && res) {
      res.setHeader('Set-Cookie', clearedRefreshCookie());
    }

    const claims = bearerClaims(authorization);
    if (!claims) {
      throw new AppError('UNAUTHENTICATED', 'Authentication is required');
    }
    const result = await this.attemptRefresh(ip, () => this.auth.refresh(claims.sub, claims.jti));
    return { data: loginResponse(res, result, parsed.data.cookie === true) };
  }
}
