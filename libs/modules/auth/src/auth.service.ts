/**
 * Authentication: email+password (all roles), Google Sign-In and OTP login, plus
 * session revocation (TECH-DESIGN-v1.0 §7.2, §9.1).
 *
 * Rules enforced here:
 *   - the email is normalised before it is hashed or rate-limited, so case and
 *     surrounding spaces share one quota bucket (ADR 0011: OTP goes to email);
 *   - the OTP is stored only as `sha256(code + ':' + email)`; the plaintext is
 *     returned to the caller only outside production (`dev_code`);
 *   - a request is single-use (`consumed_at` set atomically) and expires after
 *     five minutes; after `max_attempts` wrong guesses the request is locked;
 *   - password login works for every active account that has a password, and
 *     every rejection answers with one generic message;
 *   - public registration and Google sign-up create `customer` only;
 *   - the access token carries `{ sub, roles, jti }`; the `jti` is the matching
 *     `sessions` row, so logout and refresh act on exactly that session.
 *
 * Neither the OTP, the password nor the Google token is ever written to a log.
 */
import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  scrypt,
  timingSafeEqual
} from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppError } from '@tarlink/core/errors';
import { createSecretCipherFromKey, type SecretCipher } from '@tarlink/platform/crypto';
import { signAccessToken, type Role } from '@tarlink/platform/auth';
import type { GoogleTokenVerifier } from './google-verifier';
import { LoggingMailer, type Mailer } from './mailer';
import {
  BACKUP_CODE_COUNT,
  buildOtpauthUri,
  generateBackupCodes,
  generateChallengeToken,
  generateTotpSecret,
  hashBackupCode,
  hashChallengeToken,
  verifyTotpCode
} from './totp';
import type {
  AccountDeletionRecord,
  AdminChallengeKind,
  AdminChallengeRecord,
  AuthRepository,
  AuthUserRecord,
  NewUser,
  NewUserConsent,
  OtpChannel,
  TwoFactorState
} from './auth.repository';

export const OTP_TTL_SECONDS = 5 * 60;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RATE_LIMIT_MAX = 3;
export const OTP_RATE_LIMIT_WINDOW_SECONDS = 10 * 60;
export const OTP_CHANNEL: OtpChannel = 'email';

export const LOGIN_RATE_LIMIT_MAX = 5;
export const LOGIN_RATE_LIMIT_WINDOW_SECONDS = 10 * 60;
/** Per-IP caps: distinct from the per-email/per-phone quotas above. */
export const LOGIN_IP_RATE_LIMIT_MAX = 30;
export const OTP_IP_RATE_LIMIT_MAX = 10;
export const OTP_IP_RATE_LIMIT_WINDOW_SECONDS = 60 * 60;
export const REFRESH_TOKEN_BYTES = 32;

/** FR-128: the 2FA ticket lives ten minutes and tolerates six code guesses. */
export const TOTP_CHALLENGE_TTL_SECONDS = 10 * 60;
export const TOTP_CHALLENGE_MAX_ATTEMPTS = 6;
/**
 * Cross-challenge budget. The per-challenge cap alone lets an attacker with a
 * valid password mint a fresh ticket after every six guesses, so failures are
 * also counted per email and per IP over this window (`login_attempts.stage`).
 */
export const TOTP_FAILURE_WINDOW_SECONDS = 15 * 60;
export const TOTP_FAILURE_MAX = 10;
const TOTP_ISSUER = 'Tarlink';
const INVALID_CHALLENGE_MESSAGE = 'Token 2FA tidak valid atau sudah kedaluwarsa';
const TOTP_LOCKED_MESSAGE = 'Terlalu banyak percobaan kode 2FA. Mulai ulang proses login.';
const TOTP_RATE_LIMITED_MESSAGE = 'Terlalu banyak percobaan kode 2FA. Coba lagi nanti.';

/** One message for every password-login rejection, so nothing is enumerated. */
export const INVALID_CREDENTIALS_MESSAGE = 'Email atau kata sandi salah';

const OTP_CODE_UPPER_BOUND = 1_000_000;

/** scrypt parameters; stored per hash as `scrypt$N$salt_hex$hash_hex`. */
const SCRYPT_PREFIX = 'scrypt';
const SCRYPT_N = 16_384;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_SALT_BYTES = 16;
const SCRYPT_MIN_N = 1_024;

export type AuthEnvironment = 'development' | 'test' | 'production';

/** Response of the account deletion request (FR-101 / UU PDP). */
export interface AccountDeletionResult {
  readonly id: string;
  readonly status: 'requested' | 'completed' | 'cancelled';
  readonly reason: string | null;
  readonly requested_at: string;
  readonly completed_at: string | null;
}

export interface AuthServiceDeps {
  readonly repository: AuthRepository;
  readonly jwtSecret: string;
  readonly jwtTtlSeconds: number;
  /** Lifetime of the opaque refresh token (session row), defaults to 30 days. */
  readonly refreshTtlSeconds?: number;
  /** `dev_code` is returned only when this is not `production` AND the flag is on. */
  readonly nodeEnv: AuthEnvironment;
  readonly otpDevMode?: boolean;
  readonly loginIpRateLimitMax?: number;
  readonly otpIpRateLimitMax?: number;
  /** Null/undefined means `GOOGLE_CLIENT_ID` is not configured. */
  readonly googleVerifier?: GoogleTokenVerifier | null;
  /** Delivery port; defaults to a log-only mailer outside production. */
  readonly mailer?: Mailer;
  readonly now?: () => Date;
  readonly newId?: () => string;
  /** Removes encrypted private documents (KTP) after account deletion. */
  readonly removePrivateFiles?: (keys: readonly string[]) => Promise<void>;
  /**
   * FR-128: base64(32 bytes) for the TOTP secret. Optional so dev/test boots
   * without it; enrollment fails closed when it is missing.
   */
  readonly totpEncryptionKey?: string;
  readonly totpEncryptionKeyPrevious?: string;
  readonly totpKeyId?: string;
  /** Issuer label shown by the authenticator app. */
  readonly totpIssuer?: string;
}

export interface RequestOtpInput {
  readonly email: string;
  readonly ip?: string | null;
}

export interface RequestOtpResult {
  readonly request_id: string;
  readonly expires_in: number;
  readonly channel: OtpChannel;
  readonly dev_code?: string;
}

export interface VerifyOtpInput {
  readonly email: string;
  readonly code: string;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
}

export interface LoginWithPasswordInput {
  readonly email: string;
  readonly password: string;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
}

/** FR-103: the client sends the policy versions it displayed and accepted. */
export interface PolicyConsentInput {
  readonly tos_version_id: string;
  readonly privacy_version_id: string;
}

export interface RegisterInput {
  readonly email: string;
  readonly password: string;
  readonly phone?: string;
  readonly full_name?: string;
  readonly consent: PolicyConsentInput;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
}

export interface GoogleLoginInput {
  readonly id_token: string;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
}

export interface AuthenticatedUserSummary {
  readonly id: string;
  /** Null only for Google-created accounts that never supplied a phone. */
  readonly phone: string | null;
  readonly roles: Role[];
  /** Present for password/Google login; OTP responses keep their old shape. */
  readonly email?: string;
}

export interface VerifyOtpResult {
  readonly access_token: string;
  /** Opaque, single-use, rotated on every refresh. Stored hashed in `sessions`. */
  readonly refresh_token: string;
  readonly token_type: 'Bearer';
  readonly expires_in: number;
  readonly user: AuthenticatedUserSummary;
}

/** FR-128: the admin must finish TOTP enrollment before any session exists. */
export interface MfaSetupRequiredResult {
  readonly mfa_setup_required: true;
  readonly enroll_token: string;
  readonly expires_in: number;
}

/** FR-128: the admin has TOTP; the login is paused between password and code. */
export interface MfaRequiredResult {
  readonly mfa_required: true;
  readonly challenge_token: string;
  readonly expires_in: number;
}

export type MfaChallengeResult = MfaSetupRequiredResult | MfaRequiredResult;

/** Password/OTP/Google login: a session for users, a challenge for admins. */
export type PasswordLoginResult = VerifyOtpResult | MfaChallengeResult;

export interface TwoFactorVerifyInput {
  readonly challenge_token: string;
  readonly code: string;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
}

export interface TwoFactorEnrollInput {
  readonly enroll_token: string;
}

export interface TwoFactorEnrollVerifyInput extends TwoFactorEnrollInput {
  readonly code: string;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
}

export interface TwoFactorEnrollmentStartResult {
  /** Shown once, then only the encrypted copy exists in the database. */
  readonly secret: string;
  readonly otpauth_uri: string;
  /** Seconds left on the enroll ticket, not a new TTL. */
  readonly expires_in: number;
}

/** Enrollment completes with a session; plaintext codes are shown once. */
export interface TwoFactorEnrolledResult extends VerifyOtpResult {
  readonly backup_codes: string[];
}

export interface TwoFactorResetResult {
  readonly user_id: string;
  readonly revoked_sessions: number;
}

/** `GET /auth/me`: profile read from the database, not from the token claims. */
export interface CurrentUserResult {
  readonly user: {
    readonly id: string;
    readonly phone: string | null;
    readonly roles: Role[];
    readonly email: string | null;
    readonly full_name: string | null;
    readonly created_at: string;
  };
}

export interface LogoutResult {
  readonly revoked: number;
}

/**
 * Normalises an Indonesian mobile number to digits with the `62` prefix.
 * Anything that cannot be normalised is a VALIDATION_ERROR at the boundary.
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  let normalized = digits;

  if (digits.startsWith('0')) {
    normalized = `62${digits.slice(1)}`;
  } else if (digits.startsWith('8')) {
    normalized = `62${digits}`;
  }

  if (!/^62\d{8,13}$/.test(normalized)) {
    throw new AppError('VALIDATION_ERROR', 'phone must be an Indonesian mobile number');
  }
  return normalized;
}

/**
 * Normalises an email for password login: trimmed and lowercased. Format is
 * checked at the HTTP boundary by zod; this guards direct service callers.
 */
export function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 150) {
    throw new AppError('VALIDATION_ERROR', 'email is not valid');
  }
  return normalized;
}

/** `code_hash` format shared by the writer and the reader. */
export function hashOtpCode(code: string, email: string): string {
  return createHash('sha256').update(`${code}:${email}`, 'utf8').digest('hex');
}

/** Opaque refresh token: 256 bits, returned once and stored only as a hash. */
export function issueRefreshToken(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function deriveScryptKey(
  password: string,
  salt: Buffer,
  keyLength: number,
  cost: number
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, { N: cost, r: 8, p: 1 }, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/** Hashes with scrypt and returns `scrypt$N$salt_hex$hash_hex`. */
export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'password is required');
  }
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const hash = await deriveScryptKey(password, salt, SCRYPT_KEY_LENGTH, SCRYPT_N);
  return `${SCRYPT_PREFIX}$${SCRYPT_N}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/**
 * Constant-time scrypt verification. A malformed or unsupported hash is a
 * non-match, never an exception, so a bad row cannot turn into a 500.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4) return false;

  const [scheme, costPart, saltPart, hashPart] = parts as [string, string, string, string];
  if (scheme !== SCRYPT_PREFIX) return false;

  const cost = Number(costPart);
  if (!Number.isInteger(cost) || cost < SCRYPT_MIN_N) return false;
  if (saltPart.length !== SCRYPT_SALT_BYTES * 2 || hashPart.length === 0 || hashPart.length % 2 !== 0) {
    return false;
  }

  const salt = Buffer.from(saltPart, 'hex');
  const expected = Buffer.from(hashPart, 'hex');
  if (salt.length !== SCRYPT_SALT_BYTES || expected.length !== hashPart.length / 2) return false;

  const derived = await deriveScryptKey(password, salt, expected.length, cost);
  return timingSafeEqual(derived, expected);
}

function constantTimeEquals(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

@Injectable()
export class AuthService {
  private readonly repository: AuthRepository;
  private readonly jwtSecret: string;
  private readonly jwtTtlSeconds: number;
  private readonly refreshTtlSeconds: number;
  private readonly nodeEnv: AuthEnvironment;
  private readonly otpDevMode: boolean;
  private readonly loginIpRateLimitMax: number;
  private readonly otpIpRateLimitMax: number;
  private readonly googleVerifier: GoogleTokenVerifier | null;
  private readonly mailer: Mailer;
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly removePrivateFiles?: (keys: readonly string[]) => Promise<void>;
  private readonly totpEncryptionKey?: string;
  private readonly totpEncryptionKeyPrevious?: string;
  private readonly totpKeyId?: string;
  private readonly totpIssuer: string;
  /** Built lazily so a missing key only fails the enrollment that needs it. */
  private cipherCache?: SecretCipher | null;

  constructor(deps: AuthServiceDeps) {
    this.repository = deps.repository;
    this.jwtSecret = deps.jwtSecret;
    this.jwtTtlSeconds = deps.jwtTtlSeconds;
    this.refreshTtlSeconds = deps.refreshTtlSeconds ?? 30 * 24 * 60 * 60;
    this.nodeEnv = deps.nodeEnv;
    this.otpDevMode = deps.otpDevMode ?? false;
    this.loginIpRateLimitMax = deps.loginIpRateLimitMax ?? LOGIN_IP_RATE_LIMIT_MAX;
    this.otpIpRateLimitMax = deps.otpIpRateLimitMax ?? OTP_IP_RATE_LIMIT_MAX;
    this.googleVerifier = deps.googleVerifier ?? null;
    this.mailer = deps.mailer ?? new LoggingMailer();
    this.now = deps.now ?? (() => new Date());
    this.newId = deps.newId ?? (() => randomUUID());
    this.removePrivateFiles = deps.removePrivateFiles;
    this.totpEncryptionKey = deps.totpEncryptionKey;
    this.totpEncryptionKeyPrevious = deps.totpEncryptionKeyPrevious;
    this.totpKeyId = deps.totpKeyId;
    this.totpIssuer = deps.totpIssuer ?? TOTP_ISSUER;
  }

  async requestOtp(input: RequestOtpInput): Promise<RequestOtpResult> {
    const email = normalizeEmail(input.email);
    const now = this.now();
    const windowStart = new Date(now.getTime() - OTP_RATE_LIMIT_WINDOW_SECONDS * 1000);

    const recent = await this.repository.countRecentOtpRequests(email, windowStart);
    if (recent >= OTP_RATE_LIMIT_MAX) {
      throw new AppError(
        'RATE_LIMITED',
        `OTP requests are limited to ${OTP_RATE_LIMIT_MAX} per ${OTP_RATE_LIMIT_WINDOW_SECONDS / 60} minutes`
      );
    }

    if (input.ip) {
      const ipWindowStart = new Date(
        now.getTime() - OTP_IP_RATE_LIMIT_WINDOW_SECONDS * 1000
      );
      const recentFromIp = await this.repository.countRecentOtpRequestsByIp(
        input.ip,
        ipWindowStart
      );
      if (recentFromIp >= this.otpIpRateLimitMax) {
        throw new AppError(
          'RATE_LIMITED',
          `OTP requests from this network are limited to ${this.otpIpRateLimitMax} per hour`
        );
      }
    }

    const code = randomInt(0, OTP_CODE_UPPER_BOUND).toString().padStart(6, '0');
    const requestId = this.newId();

    await this.repository.insertOtpRequest({
      id: requestId,
      email,
      codeHash: hashOtpCode(code, email),
      channel: OTP_CHANNEL,
      maxAttempts: OTP_MAX_ATTEMPTS,
      expiresAt: new Date(now.getTime() + OTP_TTL_SECONDS * 1000),
      requesterIp: input.ip ?? null,
      createdAt: now
    });

    await this.mailer.sendOtp({ to: email, code, ttlSeconds: OTP_TTL_SECONDS });

    return {
      request_id: requestId,
      expires_in: OTP_TTL_SECONDS,
      channel: OTP_CHANNEL,
      // Double gate: never in production, and only when OTP_DEV_MODE is on.
      // This keeps a misconfigured staging deploy from leaking the code.
      ...(this.nodeEnv !== 'production' && this.otpDevMode ? { dev_code: code } : {})
    };
  }

  async verifyOtp(input: VerifyOtpInput): Promise<PasswordLoginResult> {
    const email = normalizeEmail(input.email);
    const now = this.now();

    const request = await this.repository.findActiveOtpRequest(email, now);
    if (!request) {
      throw new AppError('VALIDATION_ERROR', 'OTP is invalid or expired');
    }

    const attempts = await this.repository.incrementOtpAttempts(request.id);
    if (attempts > request.maxAttempts) {
      throw new AppError('RATE_LIMITED', 'OTP attempt limit reached, request a new code');
    }

    if (!constantTimeEquals(hashOtpCode(input.code, email), request.codeHash)) {
      throw new AppError('VALIDATION_ERROR', 'OTP is invalid or expired');
    }

    // Atomic single-use: a concurrent verify loses here instead of minting a
    // second session for the same code.
    const consumed = await this.repository.consumeOtpRequest(request.id, now);
    if (!consumed) {
      throw new AppError('VALIDATION_ERROR', 'OTP is invalid or expired');
    }

    const user = await this.repository.findUserByEmail(email);
    if (!user) {
      throw new AppError('NOT_FOUND', 'User not found');
    }

    const roles = await this.repository.listActiveRoles(user.id);
    return this.issueSessionOrChallenge(user, roles, now, {
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null
    });
  }

  /**
   * Email + password login for every active account that has a password. They
   * are all rejected with the same message so neither the email nor the role
   * set is revealed.
   */
  async loginWithPassword(input: LoginWithPasswordInput): Promise<PasswordLoginResult> {
    const email = normalizeEmail(input.email);
    const now = this.now();
    const ip = input.ip ?? null;
    const windowStart = new Date(now.getTime() - LOGIN_RATE_LIMIT_WINDOW_SECONDS * 1000);

    const reject = async (): Promise<never> => {
      await this.repository.recordLoginAttempt({ email, ip, succeeded: false, createdAt: now });
      throw new AppError('UNAUTHENTICATED', INVALID_CREDENTIALS_MESSAGE);
    };

    const failures = await this.repository.countFailedLoginAttempts(email, windowStart);
    if (failures >= LOGIN_RATE_LIMIT_MAX) {
      // The blocked attempt is audited too; the caller only learns the quota.
      await this.repository.recordLoginAttempt({ email, ip, succeeded: false, createdAt: now });
      throw new AppError(
        'RATE_LIMITED',
        `Password login is limited to ${LOGIN_RATE_LIMIT_MAX} failed attempts per ${LOGIN_RATE_LIMIT_WINDOW_SECONDS / 60} minutes`
      );
    }

    // Per-IP quota stops one host from spraying many different emails, which
    // the per-email counter above can never see.
    if (ip) {
      const ipFailures = await this.repository.countFailedLoginAttemptsByIp(ip, windowStart);
      if (ipFailures >= this.loginIpRateLimitMax) {
        await this.repository.recordLoginAttempt({ email, ip, succeeded: false, createdAt: now });
        throw new AppError(
          'RATE_LIMITED',
          `Login attempts from this network are limited to ${this.loginIpRateLimitMax} per ${LOGIN_RATE_LIMIT_WINDOW_SECONDS / 60} minutes`
        );
      }
    }

    const user = await this.repository.findUserByEmail(email);
    if (!user || user.passwordHash === null) {
      return reject();
    }

    const passwordMatches = await verifyPassword(input.password, user.passwordHash);
    if (!passwordMatches) {
      return reject();
    }

    const roles = await this.repository.listActiveRoles(user.id);
    await this.repository.recordLoginAttempt({ email, ip, succeeded: true, createdAt: now });
    return this.issueSessionOrChallenge(user, roles, now, {
      includeEmail: true,
      ip,
      userAgent: input.userAgent ?? null
    });
  }

  /**
   * Public self-registration. It can only create a `customer`: the role is never
   * read from the request, and vendor accounts are created by onboarding.
   */
  async register(input: RegisterInput): Promise<VerifyOtpResult> {
    const email = normalizeEmail(input.email);
    const phone =
      input.phone && input.phone.trim().length > 0 ? normalizePhone(input.phone) : null;

    if (typeof input.password !== 'string' || input.password.length < 8) {
      throw new AppError('VALIDATION_ERROR', 'password must be at least 8 characters');
    }

    // One generic conflict message: registration must not reveal which of the
    // two identifiers is already taken.
    if (
      (await this.repository.emailExists(email)) ||
      (phone !== null && (await this.repository.phoneExists(phone)))
    ) {
      throw new AppError('CONFLICT', 'Email atau nomor sudah terdaftar');
    }

    if (!input.consent) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Persetujuan Syarat & Ketentuan serta Kebijakan Privasi wajib dicentang'
      );
    }

    // Only the version that is active right now may be accepted. This stops a
    // stale tab from recording consent to text the user no longer saw.
    const [tos, privacy] = await Promise.all([
      this.repository.findActivePolicyVersion('tos'),
      this.repository.findActivePolicyVersion('privacy')
    ]);
    if (!tos || !privacy) {
      throw new AppError('INTERNAL_ERROR', 'Kebijakan belum tersedia');
    }
    if (
      input.consent.tos_version_id !== tos.id ||
      input.consent.privacy_version_id !== privacy.id
    ) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Versi kebijakan sudah berubah. Muat ulang halaman pendaftaran.'
      );
    }

    const now = this.now();
    const passwordHash = await hashPassword(input.password);
    const consents: NewUserConsent[] = [
      {
        policyCode: tos.code,
        policyVersionId: tos.id,
        acceptedAt: now,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null
      },
      {
        policyCode: privacy.code,
        policyVersionId: privacy.id,
        acceptedAt: now,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null
      }
    ];
    const newUser: NewUser = {
      id: this.newId(),
      phone: phone ?? null,
      email,
      name: input.full_name?.trim() || null,
      passwordHash,
      passwordUpdatedAt: now,
      googleSub: null,
      emailVerifiedAt: null,
      consents
    };

    const user = await this.repository.createUser(newUser);
    const roles = await this.repository.listActiveRoles(user.id);
    return this.issueSession(user, roles, now, {
      includeEmail: true,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null
    });
  }

  /**
   * Google Sign-In. The ID token is verified server-side by the injected
   * verifier; this module never trusts claims decoded by the client.
   */
  async loginWithGoogle(input: GoogleLoginInput): Promise<PasswordLoginResult> {
    if (!this.googleVerifier) {
      throw new AppError('UPSTREAM_ERROR', 'Google Sign-In belum dikonfigurasi');
    }

    const identity = await this.googleVerifier.verify(input.id_token ?? '');
    const email = normalizeEmail(identity.email);
    const now = this.now();

    let user = await this.repository.findUserByGoogleSub(identity.sub);
    if (!user) {
      const existingByEmail = await this.repository.findUserByEmail(email);
      if (existingByEmail) {
        await this.repository.linkGoogleAccount(existingByEmail.id, identity.sub, now);
        user = existingByEmail;
      } else {
        try {
          user = await this.repository.createUser({
            id: this.newId(),
            phone: null,
            email,
            name: null,
            passwordHash: null,
            passwordUpdatedAt: null,
            googleSub: identity.sub,
            emailVerifiedAt: now
          });
        } catch (err) {
          // Email/phone already used by an account we could not load (e.g.
          // suspended). Do not leak that state through a different status.
          if (err instanceof AppError && err.code === 'CONFLICT') {
            throw new AppError('UNAUTHENTICATED', 'Google sign-in tidak valid');
          }
          throw err;
        }
      }
    }

    const roles = await this.repository.listActiveRoles(user.id);
    return this.issueSessionOrChallenge(user, roles, now, {
      includeEmail: true,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null
    });
  }

  /**
   * FR-128 step 2: finish a password/OTP/Google login with a TOTP code. The
   * challenge is single-use and rate limited atomically by the repository.
   */
  async verifyTwoFactorCode(input: TwoFactorVerifyInput): Promise<VerifyOtpResult> {
    const now = this.now();
    const challenge = await this.loadChallenge(input.challenge_token, 'verify', now);
    const attempts = await this.claimAttempt(challenge, now);
    const state = await this.requireTwoFactorState(challenge.userId);

    if (!state.twoFactorEnabled || !state.totpSecretEncrypted) {
      // `two_factor_enabled` without a secret is corrupt data: fail closed
      // instead of letting the account log in as if 2FA were off.
      throw new AppError(
        'INTERNAL_ERROR',
        'Status 2FA akun tidak konsisten. Minta admin lain melakukan reset 2FA.'
      );
    }

    const secret = this.requireCipher().decrypt(state.totpSecretEncrypted, state.totpKeyId);
    if (!verifyTotpCode(secret, input.code, now)) {
      await this.recordTotpAttempt(state.email, input.ip ?? null, false, now);
      throw await this.totpFailureError(
        state.email,
        input.ip ?? null,
        attempts,
        challenge.maxAttempts,
        now
      );
    }

    return this.finishChallenge(challenge, state, input.ip ?? null, input.userAgent ?? null, now);
  }

  /** Backup code fallback for a lost authenticator; each code works once. */
  async verifyBackupCode(input: TwoFactorVerifyInput): Promise<VerifyOtpResult> {
    const now = this.now();
    const challenge = await this.loadChallenge(input.challenge_token, 'verify', now);
    const attempts = await this.claimAttempt(challenge, now);
    const state = await this.requireTwoFactorState(challenge.userId);

    const claimed = await this.repository.markBackupCodeUsed(
      state.id,
      hashBackupCode(input.code),
      now
    );
    if (!claimed) {
      await this.recordTotpAttempt(state.email, input.ip ?? null, false, now);
      throw await this.totpFailureError(
        state.email,
        input.ip ?? null,
        attempts,
        challenge.maxAttempts,
        now
      );
    }

    return this.finishChallenge(challenge, state, input.ip ?? null, input.userAgent ?? null, now);
  }

  /**
   * Starts enrollment: the secret is stored encrypted right away (still
   * disabled) so the client gets exactly one copy of the plaintext, and only
   * the enroll ticket can read it back for verification.
   */
  async beginTwoFactorEnrollment(
    input: TwoFactorEnrollInput
  ): Promise<TwoFactorEnrollmentStartResult> {
    const now = this.now();
    const challenge = await this.loadChallenge(input.enroll_token, 'enroll', now);
    const state = await this.requireTwoFactorState(challenge.userId);
    if (state.twoFactorEnabled) {
      throw new AppError('CONFLICT', '2FA sudah aktif untuk akun ini.');
    }

    const cipher = this.requireCipher();
    const secret = generateTotpSecret();
    const stored = await this.repository.storeTotpSecret(
      state.id,
      cipher.encrypt(secret),
      cipher.keyId,
      now
    );
    if (!stored) {
      throw new AppError('CONFLICT', '2FA sudah aktif untuk akun ini.');
    }

    return {
      secret,
      otpauth_uri: buildOtpauthUri({
        issuer: this.totpIssuer,
        account: state.email ?? state.id,
        secret
      }),
      expires_in: Math.max(0, Math.floor((challenge.expiresAt.getTime() - now.getTime()) / 1000))
    };
  }

  /**
   * Finishes enrollment: activates 2FA, issues ten single-use backup codes and
   * returns a session in one step, so the admin is never left half-enrolled.
   */
  async completeTwoFactorEnrollment(
    input: TwoFactorEnrollVerifyInput
  ): Promise<TwoFactorEnrolledResult> {
    const now = this.now();
    const challenge = await this.loadChallenge(input.enroll_token, 'enroll', now);
    const attempts = await this.claimAttempt(challenge, now);
    const state = await this.requireTwoFactorState(challenge.userId);

    if (state.twoFactorEnabled) {
      throw new AppError('CONFLICT', '2FA sudah aktif untuk akun ini.');
    }
    if (!state.totpSecretEncrypted) {
      throw new AppError('UNAUTHENTICATED', 'Mulai enrollment TOTP terlebih dahulu.');
    }

    const secret = this.requireCipher().decrypt(state.totpSecretEncrypted, state.totpKeyId);
    if (!verifyTotpCode(secret, input.code, now)) {
      await this.recordTotpAttempt(state.email, input.ip ?? null, false, now);
      throw this.invalidCodeError(attempts, challenge.maxAttempts);
    }

    const backupCodes = generateBackupCodes(BACKUP_CODE_COUNT);
    const enabled = await this.repository.completeTwoFactorEnrollment(
      state.id,
      backupCodes.map((code) => hashBackupCode(code)),
      now
    );
    if (!enabled) {
      throw new AppError('CONFLICT', '2FA sudah aktif untuk akun ini.');
    }

    const session = await this.finishChallenge(
      challenge,
      state,
      input.ip ?? null,
      input.userAgent ?? null,
      now
    );
    return { ...session, backup_codes: backupCodes };
  }

  /**
   * FR-128 recovery: an `admin_super` clears the target's TOTP, backup codes and
   * open challenges, revokes every session of that user and records the action.
   */
  async resetTwoFactor(input: {
    readonly userId: string;
    readonly actorId: string;
    readonly actorRole: Role | null;
    readonly requestId?: string | null;
  }): Promise<TwoFactorResetResult> {
    if (!input.userId) {
      throw new AppError('VALIDATION_ERROR', 'user_id wajib diisi');
    }

    // `audit_logs.request_id` is VARCHAR(40); a long header must not fail the write.
    const requestId = input.requestId ? input.requestId.slice(0, 40) : null;
    const outcome = await this.repository.resetTwoFactor({
      userId: input.userId,
      actorId: input.actorId,
      actorRole: input.actorRole,
      requestId,
      at: this.now()
    });

    return { user_id: outcome.userId, revoked_sessions: outcome.revokedSessions };
  }

  /**
   * Current profile of the subject carried by a verified access token. Roles are
   * re-read from `user_roles`, so a revoked role disappears immediately instead
   * of staying alive until the token expires.
   */
  async getProfile(userId: string): Promise<CurrentUserResult> {
    const user = await this.repository.findUserProfile(userId);
    if (!user) {
      throw new AppError('UNAUTHENTICATED', 'Sesi tidak valid');
    }
    const roles = await this.repository.listActiveRoles(user.id);
    return {
      user: {
        id: user.id,
        phone: user.phone,
        roles,
        email: user.email,
        full_name: user.name,
        created_at: user.createdAt.toISOString()
      }
    };
  }

  /**
   * FR-101: anonymises the caller's personal data and revokes every session and
   * role. The user row is kept so bookings/payments/payouts keep their foreign
   * keys; the response records the completed request. Safe to call twice.
   */
  async deleteAccount(userId: string, reason?: string | null): Promise<AccountDeletionResult> {
    if (!userId) throw new AppError('VALIDATION_ERROR', 'userId is required');

    // The repository is idempotent and also returns any leftover private
    // document keys, so a retry can finish a half-completed file cleanup.
    const outcome = await this.repository.deleteAccount(
      userId,
      reason?.trim() || null,
      this.now()
    );

    if (outcome.privateObjectKeys.length > 0 && this.removePrivateFiles) {
      try {
        await this.removePrivateFiles(outcome.privateObjectKeys);
      } catch {
        // The database no longer references the files; an operator can remove
        // them from PRIVATE_UPLOAD_DIR if the filesystem call failed.
      }
    }

    return this.toDeletionResult(outcome.record);
  }

  /** Status of the newest deletion request, or null when the account is intact. */
  async getDeletionStatus(userId: string): Promise<AccountDeletionResult | null> {
    if (!userId) throw new AppError('VALIDATION_ERROR', 'userId is required');
    const existing = await this.repository.findDeletionRequest(userId);
    return existing ? this.toDeletionResult(existing) : null;
  }

  private toDeletionResult(record: AccountDeletionRecord): AccountDeletionResult {
    return {
      id: record.id,
      status: record.status,
      reason: record.reason,
      requested_at: record.requestedAt.toISOString(),
      completed_at: record.completedAt ? record.completedAt.toISOString() : null
    };
  }

  /**
   * Rotates the session identified by `jti`: the old row is revoked and a new
   * session is issued, so one refresh chain has exactly one active row. A
   * missing, revoked or expired session is a 401 - an access token alone is not
   * enough to keep a session alive. Refresh and logout consult `sessions`
   * directly; other authenticated requests do so through the `AuthGuard`
   * session checker installed by the API bootstrap.
   */
  async refresh(userId: string, jti?: string | null): Promise<PasswordLoginResult> {
    if (!jti) {
      throw new AppError('UNAUTHENTICATED', 'Sesi tidak valid. Silakan masuk lagi.');
    }

    const now = this.now();
    const session = await this.repository.findActiveSessionByJti(jti, now);
    if (!session || session.userId !== userId) {
      throw new AppError('UNAUTHENTICATED', 'Sesi sudah berakhir. Silakan masuk lagi.');
    }

    // Atomic claim: a concurrent refresh with the same jti loses here.
    const revoked = await this.repository.revokeSessions(userId, jti, now);
    if (revoked === 0) {
      throw new AppError('UNAUTHENTICATED', 'Sesi sudah berakhir. Silakan masuk lagi.');
    }

    const user = await this.repository.findUserProfile(userId);
    if (!user) {
      throw new AppError('UNAUTHENTICATED', 'Sesi tidak valid');
    }
    const roles = await this.repository.listActiveRoles(user.id);
    return this.issueSession(user, roles, now, { includeEmail: true });
  }

  /**
   * Refresh-token path (§9.1): the opaque token is the credential, so an expired
   * access token no longer forces a re-login. Every successful refresh rotates
   * the token; presenting a revoked token means it was replayed and the whole
   * rotation family is revoked.
   */
  async refreshWithToken(refreshToken: string): Promise<PasswordLoginResult> {
    if (typeof refreshToken !== 'string' || refreshToken.length < 32) {
      throw new AppError('UNAUTHENTICATED', 'Sesi sudah berakhir. Silakan masuk lagi.');
    }

    const now = this.now();
    const session = await this.repository.findSessionByRefreshHash(hashRefreshToken(refreshToken));
    if (!session) {
      throw new AppError('UNAUTHENTICATED', 'Sesi sudah berakhir. Silakan masuk lagi.');
    }

    if (session.revokedAt !== null) {
      // Reuse of an already-rotated token: revoke the whole family.
      await this.repository.revokeFamily(session.familyId, now);
      throw new AppError('UNAUTHENTICATED', 'Sesi sudah berakhir. Silakan masuk lagi.');
    }

    if (!session.refreshExpiresAt || session.refreshExpiresAt.getTime() <= now.getTime()) {
      await this.repository.markSessionRotated(session.jti, now);
      throw new AppError('UNAUTHENTICATED', 'Sesi sudah berakhir. Silakan masuk lagi.');
    }

    const rotated = await this.repository.markSessionRotated(session.jti, now);
    if (!rotated) {
      throw new AppError('UNAUTHENTICATED', 'Sesi sudah berakhir. Silakan masuk lagi.');
    }

    const user = await this.repository.findUserProfile(session.userId);
    if (!user) {
      throw new AppError('UNAUTHENTICATED', 'Sesi tidak valid');
    }
    const roles = await this.repository.listActiveRoles(user.id);
    return this.issueSession(user, roles, now, {
      includeEmail: true,
      familyId: session.familyId,
      parentId: session.jti
    });
  }

  /** Logout with a refresh token, for clients whose access token already expired. */
  async logoutByRefreshToken(refreshToken: string): Promise<LogoutResult> {
    if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
      return { revoked: 0 };
    }
    const revoked = await this.repository.revokeByRefreshHash(
      hashRefreshToken(refreshToken),
      this.now()
    );
    return { revoked };
  }

  /**
   * Sets (or replaces) a password and revokes every existing session, so a
   * credential change always forces a fresh login. Used by the seeding path.
   */
  async setPassword(userId: string, password: string): Promise<void> {
    const now = this.now();
    const passwordHash = await hashPassword(password);
    const updated = await this.repository.updatePassword(userId, passwordHash, now);
    if (!updated) {
      throw new AppError('NOT_FOUND', 'User not found');
    }
    await this.repository.revokeAllSessions(userId, now);
  }

  /**
   * FR-128 gate: a session is issued directly to customers/vendors, while any
   * `admin_*` account is paused on a challenge. Called from every path that
   * issues a session (password, OTP, Google), so OTP cannot bypass 2FA.
   */
  private async issueSessionOrChallenge(
    user: AuthUserRecord,
    roles: Role[],
    now: Date,
    options: {
      includeEmail?: boolean;
      ip?: string | null;
      userAgent?: string | null;
    } = {}
  ): Promise<PasswordLoginResult> {
    if (!roles.some((role) => role.startsWith('admin_'))) {
      return this.issueSession(user, roles, now, options);
    }

    const state = await this.repository.findTwoFactorState(user.id);
    if (!state) {
      // The row disappeared between the credential check and here (deleted
      // account). Refuse instead of inserting a challenge with a dangling FK.
      throw new AppError('UNAUTHENTICATED', 'Sesi tidak valid');
    }
    const kind: AdminChallengeKind = state.twoFactorEnabled ? 'verify' : 'enroll';

    // Cross-challenge budget: a new ticket must not reset the guess counter,
    // otherwise password login becomes an unlimited oracle for the TOTP code.
    if (await this.totpFailureCapReached(user.email, options.ip ?? null, now)) {
      throw new AppError('RATE_LIMITED', TOTP_RATE_LIMITED_MESSAGE);
    }

    const token = generateChallengeToken();

    // One live ticket per user: an earlier unconsumed challenge must not stay
    // usable side by side with the one just issued.
    await this.repository.deleteOpenChallenges(user.id);
    await this.repository.insertAdminChallenge({
      id: this.newId(),
      userId: user.id,
      kind,
      tokenHash: hashChallengeToken(token),
      maxAttempts: TOTP_CHALLENGE_MAX_ATTEMPTS,
      expiresAt: new Date(now.getTime() + TOTP_CHALLENGE_TTL_SECONDS * 1000),
      requesterIp: options.ip ?? null,
      userAgent: options.userAgent ?? null,
      createdAt: now
    });

    return kind === 'verify'
      ? {
          mfa_required: true,
          challenge_token: token,
          expires_in: TOTP_CHALLENGE_TTL_SECONDS
        }
      : {
          mfa_setup_required: true,
          enroll_token: token,
          expires_in: TOTP_CHALLENGE_TTL_SECONDS
        };
  }

  /** Resolves an opaque token to an open challenge of the expected kind. */
  private async loadChallenge(
    token: string,
    kind: AdminChallengeKind,
    now: Date
  ): Promise<AdminChallengeRecord> {
    if (typeof token !== 'string' || token.length === 0) {
      throw new AppError('UNAUTHENTICATED', INVALID_CHALLENGE_MESSAGE);
    }

    const challenge = await this.repository.findChallengeByTokenHash(hashChallengeToken(token));
    // A mismatch of kind is reported exactly like an unknown token: a `verify`
    // token must never reach the enroll endpoints or vice versa.
    if (!challenge || challenge.kind !== kind) {
      throw new AppError('UNAUTHENTICATED', INVALID_CHALLENGE_MESSAGE);
    }
    if (challenge.consumedAt !== null || challenge.expiresAt.getTime() <= now.getTime()) {
      throw new AppError('UNAUTHENTICATED', INVALID_CHALLENGE_MESSAGE);
    }
    return challenge;
  }

  /**
   * Counts one guess against the challenge cap. The repository does the
   * increment in a single UPDATE ... WHERE attempts < max_attempts, so two
   * parallel guesses cannot both slip past the limit.
   */
  private async claimAttempt(challenge: AdminChallengeRecord, now: Date): Promise<number> {
    const attempts = await this.repository.incrementChallengeAttempt(challenge.id, now);
    if (attempts === null) {
      // Null means locked, consumed or expired. Only a locked row is a 429.
      if (challenge.attempts >= challenge.maxAttempts) {
        throw new AppError('RATE_LIMITED', TOTP_LOCKED_MESSAGE);
      }
      throw new AppError('UNAUTHENTICATED', INVALID_CHALLENGE_MESSAGE);
    }
    return attempts;
  }

  /** Wrong code: the last permitted guess answers 429, earlier ones 401. */
  private invalidCodeError(attempts: number, maxAttempts: number): AppError {
    return attempts >= maxAttempts
      ? new AppError('RATE_LIMITED', TOTP_LOCKED_MESSAGE)
      : new AppError('UNAUTHENTICATED', 'Kode 2FA salah');
  }

  /**
   * True when the window-wide TOTP failure budget is spent for the email or the
   * IP. Both counters are checked so one host cannot spread guesses over many
   * accounts and one account cannot be guessed from many hosts.
   */
  private async totpFailureCapReached(
    email: string | null,
    ip: string | null,
    now: Date
  ): Promise<boolean> {
    const windowStart = new Date(now.getTime() - TOTP_FAILURE_WINDOW_SECONDS * 1000);
    const [byEmail, byIp] = await Promise.all([
      // An unknown email falls back to the whole window: over-counting only
      // tightens the lockout, it never lets a guess through.
      this.repository.countFailedTotpAttempts(email ?? '', windowStart),
      ip ? this.repository.countFailedTotpAttemptsByIp(ip, windowStart) : Promise.resolve(0)
    ]);
    return byEmail >= TOTP_FAILURE_MAX || byIp >= TOTP_FAILURE_MAX;
  }

  /**
   * A wrong code is a 401 until the cross-challenge budget is spent; from then
   * on it is a 429 so the client stops asking for another ticket.
   */
  private async totpFailureError(
    email: string | null,
    ip: string | null,
    attempts: number,
    maxAttempts: number,
    at: Date
  ): Promise<AppError> {
    if (await this.totpFailureCapReached(email, ip, at)) {
      return new AppError('RATE_LIMITED', TOTP_RATE_LIMITED_MESSAGE);
    }
    return this.invalidCodeError(attempts, maxAttempts);
  }

  private async requireTwoFactorState(userId: string): Promise<TwoFactorState> {
    const state = await this.repository.findTwoFactorState(userId);
    if (!state) {
      throw new AppError('UNAUTHENTICATED', INVALID_CHALLENGE_MESSAGE);
    }
    return state;
  }

  /**
   * Missing key material is an operator error, not a user error: enrollment and
   * verification must fail closed rather than store or accept a plaintext
   * secret.
   */
  private requireCipher(): SecretCipher {
    if (this.cipherCache === undefined) {
      this.cipherCache = createSecretCipherFromKey({
        key: this.totpEncryptionKey,
        previousKey: this.totpEncryptionKeyPrevious,
        keyId: this.totpKeyId,
        name: 'TOTP_ENCRYPTION_KEY'
      });
    }
    if (!this.cipherCache) {
      throw new AppError(
        'INTERNAL_ERROR',
        'TOTP_ENCRYPTION_KEY belum diisi. Enrollment 2FA tidak bisa disimpan sebelum kunci enkripsi tersedia.'
      );
    }
    return this.cipherCache;
  }

  private async recordTotpAttempt(
    email: string | null,
    ip: string | null,
    succeeded: boolean,
    at: Date
  ): Promise<void> {
    await this.repository.recordLoginAttempt({
      email: email ?? '',
      ip,
      succeeded,
      createdAt: at,
      stage: 'totp'
    });
  }

  /** Consumes the challenge, records the attempt and mints the real session. */
  private async finishChallenge(
    challenge: AdminChallengeRecord,
    state: TwoFactorState,
    ip: string | null,
    userAgent: string | null,
    now: Date
  ): Promise<VerifyOtpResult> {
    const consumed = await this.repository.consumeChallenge(challenge.id, now);
    if (!consumed) {
      // A concurrent request already used it; no second session.
      throw new AppError('UNAUTHENTICATED', INVALID_CHALLENGE_MESSAGE);
    }

    await this.recordTotpAttempt(state.email, ip, true, now);
    const roles = await this.repository.listActiveRoles(state.id);
    return this.issueSession(state, roles, now, { includeEmail: true, ip, userAgent });
  }

  /**
   * Creates the session row, the access token (same `jti`) and a fresh opaque
   * refresh token. The session row lives for the refresh TTL; the access token
   * still expires after `jwtTtlSeconds`.
   */
  private async issueSession(
    user: AuthUserRecord,
    roles: Role[],
    now: Date,
    options: {
      includeEmail?: boolean;
      ip?: string | null;
      userAgent?: string | null;
      familyId?: string;
      parentId?: string | null;
    } = {}
  ): Promise<VerifyOtpResult> {
    const jti = this.newId();
    const refreshToken = issueRefreshToken();
    const refreshExpiresAt = new Date(now.getTime() + this.refreshTtlSeconds * 1000);
    await this.repository.insertSession({
      jti,
      userId: user.id,
      issuedAt: now,
      expiresAt: refreshExpiresAt,
      userAgent: options.userAgent ?? null,
      ip: options.ip ?? null,
      refreshTokenHash: hashRefreshToken(refreshToken),
      refreshExpiresAt,
      familyId: options.familyId ?? this.newId(),
      parentId: options.parentId ?? null
    });

    return {
      access_token: signAccessToken(
        { sub: user.id, roles, jti },
        this.jwtSecret,
        this.jwtTtlSeconds
      ),
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: this.jwtTtlSeconds,
      user: {
        id: user.id,
        phone: user.phone,
        roles,
        // OTP responses stay unchanged; password and Google login additionally
        // return the email the account signed in with.
        ...(options.includeEmail && user.email ? { email: user.email } : {})
      }
    };
  }

  /**
   * Revokes the session identified by `jti`. Tokens minted before sessions had
   * a `jti` claim carry none; those fall back to revoking the user's most recent
   * active session.
   */
  async logout(userId: string, jti?: string | null): Promise<LogoutResult> {
    const revoked = await this.repository.revokeSessions(userId, jti ?? null, this.now());
    return { revoked };
  }
}
