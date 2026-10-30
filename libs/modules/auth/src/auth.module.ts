import { Module } from '@nestjs/common';
import { loadConfig } from '@tarlink/core/config';
import { AuthGuard, JWT_SECRET, RolesGuard } from '@tarlink/platform/auth';
import { AuthController } from './auth.controller';
import { PgAuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { GoogleTokenInfoVerifier } from './google-verifier';

/**
 * `AppModule` is lead-owned and does not import this module yet; register
 * `AuthModule` there. No extra configuration is needed: the factory below reads
 * `JWT_SECRET`, `JWT_TTL_SECONDS` and `NODE_ENV` from `loadConfig()`.
 *
 * `GOOGLE_CLIENT_ID` is read from `process.env` directly because
 * `apps/api/src/core/config.ts` is lead-owned. When it is empty, Google Sign-In
 * is disabled and `POST /auth/google` answers `UPSTREAM_ERROR`.
 *
 * The guards are registered in THIS module's injector because `AuthGuard` needs
 * the JWT secret (a token provider, not a primitive constructor argument) and
 * `RolesGuard` needs the framework `Reflector`.
 */
@Module({
  controllers: [AuthController],
  providers: [
    { provide: JWT_SECRET, useValue: loadConfig().JWT_SECRET },
    { provide: AuthGuard, useClass: AuthGuard },
    RolesGuard,
    {
      provide: AuthService,
      useFactory: (): AuthService => {
        const cfg = loadConfig();
        const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim() ?? '';
        return new AuthService({
          repository: new PgAuthRepository(),
          jwtSecret: cfg.JWT_SECRET,
          jwtTtlSeconds: cfg.JWT_TTL_SECONDS,
          refreshTtlSeconds: cfg.REFRESH_TTL_DAYS * 24 * 60 * 60,
          nodeEnv: cfg.NODE_ENV,
          otpDevMode: cfg.OTP_DEV_MODE,
          loginIpRateLimitMax: cfg.LOGIN_IP_RATE_LIMIT_MAX,
          otpIpRateLimitMax: cfg.OTP_IP_RATE_LIMIT_MAX,
          googleVerifier: googleClientId ? new GoogleTokenInfoVerifier(googleClientId) : null
        });
      }
    }
  ],
  exports: [AuthService]
})
export class AuthModule {}
