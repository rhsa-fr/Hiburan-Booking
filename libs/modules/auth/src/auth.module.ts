import { Module } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { resolve, sep } from 'node:path';
import { loadConfig } from '@tarlink/core/config';
import { AuthGuard, JWT_SECRET, RolesGuard } from '@tarlink/platform/auth';
import { AuthController } from './auth.controller';
import { PgAuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { GoogleTokenInfoVerifier } from './google-verifier';
import { createMailer } from './mailer';
import { RefreshRateLimiter } from './refresh-rate-limit';

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
    // Process-wide refresh throttle; the controller also has a default instance
    // so direct (non-DI) construction keeps compiling.
    RefreshRateLimiter,
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
          totpEncryptionKey: cfg.TOTP_ENCRYPTION_KEY,
          totpEncryptionKeyPrevious: cfg.TOTP_ENCRYPTION_KEY_PREVIOUS,
          totpKeyId: cfg.TOTP_KEY_ID,
          googleVerifier: googleClientId ? new GoogleTokenInfoVerifier(googleClientId) : null,
          mailer: createMailer({
            nodeEnv: cfg.NODE_ENV,
            apiUrl: cfg.EMAIL_API_URL,
            apiKey: cfg.EMAIL_API_KEY,
            from: cfg.EMAIL_FROM
          }),
          removePrivateFiles: async (keys) => {
            const root = resolve(process.cwd(), cfg.PRIVATE_UPLOAD_DIR);
            for (const key of keys) {
              if (!/^ktp\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(key)) continue;
              const target = resolve(root, key);
              if (!target.startsWith(`${root}${sep}`)) continue;
              await fs.rm(target, { force: true });
            }
          }
        });
      }
    }
  ],
  exports: [AuthService]
})
export class AuthModule {}
