/**
 * HTTP surface for the auth slice.
 *
 * Routes are mounted under the global `v1` prefix (`apps/api/src/main.ts`):
 *   POST /v1/auth/otp/request  — public
 *   POST /v1/auth/otp/verify   — public
 *   POST /v1/auth/login        — public (email + password, all roles)
 *   POST /v1/auth/register     — public (customer self-registration)
 *   POST /v1/auth/google       — public (Google ID token)
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
  verifyAccessToken,
  type AuthenticatedRequest
} from '@tarlink/platform/auth';
import {
  AuthService,
  type CurrentUserResult,
  type LogoutResult,
  type PasswordLoginResult,
  type RequestOtpResult,
  type VerifyOtpResult
} from './auth.service';

const RequestOtpBody = z.object({
  phone: z.string().min(1).max(20)
});

const VerifyOtpBody = z.object({
  phone: z.string().min(1).max(20),
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
const RegisterBody = z
  .object({
    email: z.string().trim().max(150).email('email is not valid'),
    password: z.string().min(8).max(200),
    phone: z.string().min(1).max(20),
    full_name: z.string().trim().min(1).max(100).optional()
  })
  .strict();

const GoogleBody = z.object({
  id_token: z.string().min(1).max(4096)
});

/** Refresh/logout accept the opaque token; the legacy access-token path still works. */
const RefreshBody = z.object({
  refresh_token: z.string().min(1).max(256).optional()
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

    return { data: await this.auth.requestOtp({ phone: parsed.data.phone, ip }) };
  }

  @Post('otp/verify')
  @HttpCode(200)
  async verifyOtp(
    @Body() body: unknown,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string
  ): Promise<{ data: VerifyOtpResult }> {
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
  ): Promise<{ data: VerifyOtpResult }> {
    const parsed = GoogleBody.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'invalid Google sign-in request', parsed.error.issues);
    }

    return { data: await this.auth.loginWithGoogle({ ...parsed.data, ip, userAgent }) };
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
