/**
 * Public surface of the auth module. Everything else is internal.
 */
export { AuthController } from './auth.controller';
export { AuthModule } from './auth.module';
export {
  PgAuthRepository,
  type AuthRepository,
  type AuthUserProfile,
  type AuthUserRecord,
  type NewLoginAttempt,
  type NewOtpRequest,
  type NewSession,
  type NewUser,
  type OtpChannel,
  type OtpRequestRecord,
  type SessionRefreshRecord
} from './auth.repository';
export {
  GoogleTokenInfoVerifier,
  type GoogleIdentity,
  type GoogleTokenVerifier
} from './google-verifier';
export {
  AuthService,
  INVALID_CREDENTIALS_MESSAGE,
  LOGIN_IP_RATE_LIMIT_MAX,
  LOGIN_RATE_LIMIT_MAX,
  LOGIN_RATE_LIMIT_WINDOW_SECONDS,
  OTP_CHANNEL,
  OTP_IP_RATE_LIMIT_MAX,
  OTP_IP_RATE_LIMIT_WINDOW_SECONDS,
  OTP_MAX_ATTEMPTS,
  OTP_RATE_LIMIT_MAX,
  OTP_RATE_LIMIT_WINDOW_SECONDS,
  OTP_TTL_SECONDS,
  REFRESH_TOKEN_BYTES,
  hashOtpCode,
  hashPassword,
  hashRefreshToken,
  issueRefreshToken,
  normalizeEmail,
  normalizePhone,
  verifyPassword,
  type AuthEnvironment,
  type AuthServiceDeps,
  type AuthenticatedUserSummary,
  type CurrentUserResult,
  type GoogleLoginInput,
  type LoginWithPasswordInput,
  type LogoutResult,
  type PasswordLoginResult,
  type RegisterInput,
  type RequestOtpInput,
  type RequestOtpResult,
  type VerifyOtpInput,
  type VerifyOtpResult
} from './auth.service';
