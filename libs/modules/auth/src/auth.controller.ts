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
 *   POST /v1/auth/logout       — bearer token required
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
  type PasswordLoginResult,
  type RequestOtpResult,
  type TwoFactorEnrolledResult,
  type TwoFactorEnrollmentStartResult,
  type TwoFactorResetResult,
  type VerifyOtpResult
} from './auth.service';

const RequestOtpBody = z.object({
  email: z.string().trim().max(150).email('email is not valid')
});

const VerifyOtpBody = z.object({
  email: z.string().trim().max(150).email('email is not valid'),
  code: z.string().regex(/^\d{6}$/, 'code must be 6 digits')
});

const LoginBody = z.object({
  email: z.string().trim().max(150).email('email is not valid'),
  password: z.string().min(8).max(200)
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

const GoogleBody = z.object({
  id_token: z.string().min(1).max(4096)
});

/** Refresh/logout accept the opaque token; the legacy access-token path still works. */
const RefreshBody = z.object({
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
  code: z.string().regex(/^\d{6}$/, 'code must be 6 digits')
});

/** Backup codes are `XXXX-XXXX`; dashes and case are normalised by the service. */
const TwoFactorBackupBody = z.object({
  challenge_token: z.string().min(1).max(256),
  code: z.string().min(1).max(32)
});

const TwoFactorEnrollBody = z.object({
  enroll_token: z.string().min(1).max(256)
});

const TwoFactorEnrollVerifyBody = z.object({
  enroll_token: z.string().min(1).max(256),
  code: z.string().regex(/^\d{6}$/, 'code must be 6 digits')
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
  constructor(private readonly auth: AuthService) {}

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
    @Headers('user-agent') userAgent?: string
  ): Promise<{ data: PasswordLoginResult }> {
    const parsed = LoginBody.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'invalid login request', parsed.error.issues);
    }

    return { data: await this.auth.loginWithPassword({ ...parsed.data, ip, userAgent }) };
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
    @Headers('user-agent') userAgent?: string
  ): Promise<{ data: PasswordLoginResult }> {
    const parsed = GoogleBody.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'invalid Google sign-in request', parsed.error.issues);
    }

    return { data: await this.auth.loginWithGoogle({ ...parsed.data, ip, userAgent }) };
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
    @Headers('user-agent') userAgent?: string
  ): Promise<{ data: VerifyOtpResult }> {
    const parsed = TwoFactorVerifyBody.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'invalid 2FA verification request', parsed.error.issues);
    }

    return { data: await this.auth.verifyTwoFactorCode({ ...parsed.data, ip, userAgent }) };
  }

  /** Same challenge, backup-code credential instead of TOTP. */
  @Post('2fa/backup-code')
  @HttpCode(200)
  async verifyBackupCode(
    @Body() body: unknown,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string
  ): Promise<{ data: VerifyOtpResult }> {
    const parsed = TwoFactorBackupBody.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'invalid backup code request', parsed.error.issues);
    }

    return { data: await this.auth.verifyBackupCode({ ...parsed.data, ip, userAgent }) };
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
    @Headers('user-agent') userAgent?: string
  ): Promise<{ data: TwoFactorEnrolledResult }> {
    const parsed = TwoFactorEnrollVerifyBody.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'invalid 2FA enrollment request', parsed.error.issues);
    }

    return {
      data: await this.auth.completeTwoFactorEnrollment({ ...parsed.data, ip, userAgent })
    };
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
    @Headers('authorization') authorization?: string
  ): Promise<{ data: LogoutResult }> {
    const parsed = RefreshBody.safeParse(body ?? {});
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'invalid logout request', parsed.error.issues);
    }

    // Refresh-token logout works even when the access token already expired.
    if (parsed.data.refresh_token) {
      return { data: await this.auth.logoutByRefreshToken(parsed.data.refresh_token) };
    }

    const claims = bearerClaims(authorization);
    if (!claims) {
      throw new AppError('UNAUTHENTICATED', 'Authentication is required');
    }
    return { data: await this.auth.logout(claims.sub, claims.jti) };
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
   * Rotates the session and returns a new access + refresh pair.
   * A `refresh_token` body is the primary path (works after the access token
   * expired). The legacy Bearer path is kept for clients that have not migrated.
   */
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body() body: unknown,
    @Headers('authorization') authorization?: string
  ): Promise<{ data: PasswordLoginResult }> {
    const parsed = RefreshBody.safeParse(body ?? {});
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'invalid refresh request', parsed.error.issues);
    }

    if (parsed.data.refresh_token) {
      return { data: await this.auth.refreshWithToken(parsed.data.refresh_token) };
    }

    const claims = bearerClaims(authorization);
    if (!claims) {
      throw new AppError('UNAUTHENTICATED', 'Authentication is required');
    }
    return { data: await this.auth.refresh(claims.sub, claims.jti) };
  }
}
