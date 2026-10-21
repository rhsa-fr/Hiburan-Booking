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
  HttpCode,
  Ip,
  Post,
  Req,
  UseGuards
} from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '@tarlink/core/errors';
import { AuthGuard, type AuthenticatedRequest } from '@tarlink/platform/auth';
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
  async verifyOtp(@Body() body: unknown): Promise<{ data: VerifyOtpResult }> {
    const parsed = VerifyOtpBody.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'invalid OTP verification request', parsed.error.issues);
    }

    return { data: await this.auth.verifyOtp(parsed.data) };
  }

  /**
   * Email + password login for every role. Public by design (the credentials are
   * the proof); every rejection uses the same generic error.
   */
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Ip() ip: string): Promise<{ data: PasswordLoginResult }> {
    const parsed = LoginBody.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'invalid login request', parsed.error.issues);
    }

    return { data: await this.auth.loginWithPassword({ ...parsed.data, ip }) };
  }

  /**
   * Public customer registration. A `role` field is rejected by the strict
   * schema; the service creates the `customer` role regardless.
   */
  @Post('register')
  @HttpCode(201)
  async register(@Body() body: unknown): Promise<{ data: VerifyOtpResult }> {
    const parsed = RegisterBody.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'invalid registration request', parsed.error.issues);
    }

    return { data: await this.auth.register(parsed.data) };
  }

  /** Google Sign-In: exchanges a Google ID token for our access token. */
  @Post('google')
  @HttpCode(200)
  async google(@Body() body: unknown): Promise<{ data: VerifyOtpResult }> {
    const parsed = GoogleBody.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'invalid Google sign-in request', parsed.error.issues);
    }

    return { data: await this.auth.loginWithGoogle(parsed.data) };
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async logout(@Req() req: AuthenticatedRequest): Promise<{ data: LogoutResult }> {
    const user = req.user;
    if (!user) {
      throw new AppError('UNAUTHENTICATED', 'Authentication is required');
    }

    return { data: await this.auth.logout(user.id, user.jti) };
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

  /** Rotates the session carried by the current token and returns a new one. */
  @Post('refresh')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async refresh(@Req() req: AuthenticatedRequest): Promise<{ data: PasswordLoginResult }> {
    const user = req.user;
    if (!user) {
      throw new AppError('UNAUTHENTICATED', 'Authentication is required');
    }

    return { data: await this.auth.refresh(user.id, user.jti) };
  }
}
