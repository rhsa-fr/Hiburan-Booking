/**
 * Authentication: email+password (all roles), Google Sign-In and OTP login, plus
 * session revocation (TECH-DESIGN-v1.0 §7.2, §9.1).
 *
 * Rules enforced here:
 *   - the phone number is normalised before it is hashed or rate-limited, so
 *     `0812…`, `+62 812…` and `62812…` share one quota bucket;
 *   - the OTP is stored only as `sha256(code + ':' + phone)`; the plaintext is
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
import { signAccessToken, type Role } from '@tarlink/platform/auth';
import type { GoogleTokenVerifier } from './google-verifier';
import type { AuthRepository, AuthUserRecord, NewUser, OtpChannel } from './auth.repository';

export const OTP_TTL_SECONDS = 5 * 60;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RATE_LIMIT_MAX = 3;
export const OTP_RATE_LIMIT_WINDOW_SECONDS = 10 * 60;
export const OTP_CHANNEL: OtpChannel = 'whatsapp';

export const LOGIN_RATE_LIMIT_MAX = 5;
export const LOGIN_RATE_LIMIT_WINDOW_SECONDS = 10 * 60;

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

export interface AuthServiceDeps {
  readonly repository: AuthRepository;
  readonly jwtSecret: string;
  readonly jwtTtlSeconds: number;
  /** `dev_code` is returned only when this is not `production`. */
  readonly nodeEnv: AuthEnvironment;
  /** Null/undefined means `GOOGLE_CLIENT_ID` is not configured. */
  readonly googleVerifier?: GoogleTokenVerifier | null;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export interface RequestOtpInput {
  readonly phone: string;
  readonly ip?: string | null;
}

export interface RequestOtpResult {
  readonly request_id: string;
  readonly expires_in: number;
  readonly channel: OtpChannel;
  readonly dev_code?: string;
}

export interface VerifyOtpInput {
  readonly phone: string;
  readonly code: string;
}

export interface LoginWithPasswordInput {
  readonly email: string;
  readonly password: string;
  readonly ip?: string | null;
}

export interface RegisterInput {
  readonly email: string;
  readonly password: string;
  readonly phone: string;
  readonly full_name?: string;
}

export interface GoogleLoginInput {
  readonly id_token: string;
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
  readonly token_type: 'Bearer';
  readonly expires_in: number;
  readonly user: AuthenticatedUserSummary;
}

/** Password login returns the same payload as OTP verification. */
export type PasswordLoginResult = VerifyOtpResult;

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
export function hashOtpCode(code: string, phone: string): string {
  return createHash('sha256').update(`${code}:${phone}`, 'utf8').digest('hex');
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
  private readonly nodeEnv: AuthEnvironment;
  private readonly googleVerifier: GoogleTokenVerifier | null;
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(deps: AuthServiceDeps) {
    this.repository = deps.repository;
    this.jwtSecret = deps.jwtSecret;
    this.jwtTtlSeconds = deps.jwtTtlSeconds;
    this.nodeEnv = deps.nodeEnv;
    this.googleVerifier = deps.googleVerifier ?? null;
    this.now = deps.now ?? (() => new Date());
    this.newId = deps.newId ?? (() => randomUUID());
  }

  async requestOtp(input: RequestOtpInput): Promise<RequestOtpResult> {
    const phone = normalizePhone(input.phone);
    const now = this.now();
    const windowStart = new Date(now.getTime() - OTP_RATE_LIMIT_WINDOW_SECONDS * 1000);

    const recent = await this.repository.countRecentOtpRequests(phone, windowStart);
    if (recent >= OTP_RATE_LIMIT_MAX) {
      throw new AppError(
        'RATE_LIMITED',
        `OTP requests are limited to ${OTP_RATE_LIMIT_MAX} per ${OTP_RATE_LIMIT_WINDOW_SECONDS / 60} minutes`
      );
    }

    const code = randomInt(0, OTP_CODE_UPPER_BOUND).toString().padStart(6, '0');
    const requestId = this.newId();

    await this.repository.insertOtpRequest({
      id: requestId,
      phone,
      codeHash: hashOtpCode(code, phone),
      channel: OTP_CHANNEL,
      maxAttempts: OTP_MAX_ATTEMPTS,
      expiresAt: new Date(now.getTime() + OTP_TTL_SECONDS * 1000),
      requesterIp: input.ip ?? null,
      createdAt: now
    });

    return {
      request_id: requestId,
      expires_in: OTP_TTL_SECONDS,
      channel: OTP_CHANNEL,
      // Development convenience only. In production the code leaves the process
      // through the WhatsApp provider, never through the API response.
      ...(this.nodeEnv !== 'production' ? { dev_code: code } : {})
    };
  }

  async verifyOtp(input: VerifyOtpInput): Promise<VerifyOtpResult> {
    const phone = normalizePhone(input.phone);
    const now = this.now();

    const request = await this.repository.findActiveOtpRequest(phone, now);
    if (!request) {
      throw new AppError('VALIDATION_ERROR', 'OTP is invalid or expired');
    }

    const attempts = await this.repository.incrementOtpAttempts(request.id);
    if (attempts > request.maxAttempts) {
      throw new AppError('RATE_LIMITED', 'OTP attempt limit reached, request a new code');
    }

    if (!constantTimeEquals(hashOtpCode(input.code, phone), request.codeHash)) {
      throw new AppError('VALIDATION_ERROR', 'OTP is invalid or expired');
    }

    // Atomic single-use: a concurrent verify loses here instead of minting a
    // second session for the same code.
    const consumed = await this.repository.consumeOtpRequest(request.id, now);
    if (!consumed) {
      throw new AppError('VALIDATION_ERROR', 'OTP is invalid or expired');
    }

    const user = await this.repository.findUserByPhone(phone);
    if (!user) {
      throw new AppError('NOT_FOUND', 'User not found');
    }

    const roles = await this.repository.listActiveRoles(user.id);
    return this.issueSession(user, roles, now);
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
    return this.issueSession(user, roles, now, { includeEmail: true });
  }

  /**
   * Public self-registration. It can only create a `customer`: the role is never
   * read from the request, and vendor accounts are created by onboarding.
   */
  async register(input: RegisterInput): Promise<VerifyOtpResult> {
    const email = normalizeEmail(input.email);
    const phone = normalizePhone(input.phone);

    if (typeof input.password !== 'string' || input.password.length < 8) {
      throw new AppError('VALIDATION_ERROR', 'password must be at least 8 characters');
    }

    // One generic conflict message: registration must not reveal which of the
    // two identifiers is already taken.
    if ((await this.repository.emailExists(email)) || (await this.repository.phoneExists(phone))) {
      throw new AppError('CONFLICT', 'Email atau nomor sudah terdaftar');
    }

    const now = this.now();
    const passwordHash = await hashPassword(input.password);
    const newUser: NewUser = {
      id: this.newId(),
      phone,
      email,
      name: input.full_name?.trim() || null,
      passwordHash,
      passwordUpdatedAt: now,
      googleSub: null,
      emailVerifiedAt: null
    };

    const user = await this.repository.createUser(newUser);
    const roles = await this.repository.listActiveRoles(user.id);
    return this.issueSession(user, roles, now, { includeEmail: true });
  }

  /**
   * Google Sign-In. The ID token is verified server-side by the injected
   * verifier; this module never trusts claims decoded by the client.
   */
  async loginWithGoogle(input: GoogleLoginInput): Promise<VerifyOtpResult> {
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
    return this.issueSession(user, roles, now, { includeEmail: true });
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
   * Rotates the session identified by `jti`: the old row is revoked and a new
   * session is issued, so one refresh chain has exactly one active row. A
   * missing, revoked or expired session is a 401 - an access token alone is not
   * enough to keep a session alive. Normal authenticated requests never consult
   * `sessions`; only refresh and logout do.
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

  /** Creates the session row and the matching access token (same `jti`). */
  private async issueSession(
    user: AuthUserRecord,
    roles: Role[],
    now: Date,
    options: { includeEmail?: boolean } = {}
  ): Promise<VerifyOtpResult> {
    const jti = this.newId();
    await this.repository.insertSession({
      jti,
      userId: user.id,
      issuedAt: now,
      expiresAt: new Date(now.getTime() + this.jwtTtlSeconds * 1000),
      userAgent: null,
      ip: null
    });

    return {
      access_token: signAccessToken(
        { sub: user.id, roles, jti },
        this.jwtSecret,
        this.jwtTtlSeconds
      ),
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
