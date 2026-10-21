/**
 * Auth persistence ports.
 *
 * `AuthService` depends only on the `AuthRepository` interface so the OTP rules
 * can be tested without PostgreSQL. `PgAuthRepository` is the adapter used by
 * the module; it never logs or returns the OTP plaintext.
 */
import { AppError } from '@tarlink/core/errors';
import { query, withTransaction } from '@tarlink/core/db';
import type { Role } from '@tarlink/platform/auth';

export type OtpChannel = 'whatsapp' | 'sms';

export interface OtpRequestRecord {
  readonly id: string;
  readonly phone: string;
  readonly codeHash: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
  readonly createdAt: Date;
}

export interface NewOtpRequest {
  readonly id: string;
  readonly phone: string;
  readonly codeHash: string;
  readonly channel: OtpChannel;
  readonly maxAttempts: number;
  readonly expiresAt: Date;
  readonly requesterIp: string | null;
  readonly createdAt: Date;
}

export interface AuthUserRecord {
  readonly id: string;
  /** Null for accounts created through Google without a phone number. */
  readonly phone: string | null;
  readonly email: string | null;
  /** `scrypt$N$salt_hex$hash_hex`, or null when the account has no password. */
  readonly passwordHash: string | null;
}

export interface NewUser {
  readonly id: string;
  readonly phone: string | null;
  readonly email: string;
  readonly name: string | null;
  readonly passwordHash: string | null;
  readonly passwordUpdatedAt: Date | null;
  readonly googleSub: string | null;
  readonly emailVerifiedAt: Date | null;
}

export interface NewLoginAttempt {
  readonly email: string;
  readonly ip: string | null;
  readonly succeeded: boolean;
  readonly createdAt: Date;
}

export interface NewSession {
  readonly jti: string;
  readonly userId: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly userAgent: string | null;
  readonly ip: string | null;
}

export interface AuthRepository {
  /** Number of OTP requests for `phone` created at/after `since`. */
  countRecentOtpRequests(phone: string, since: Date): Promise<number>;
  insertOtpRequest(input: NewOtpRequest): Promise<void>;
  /** Newest request for `phone` that is neither consumed nor expired. */
  findActiveOtpRequest(phone: string, now: Date): Promise<OtpRequestRecord | null>;
  /** Atomically bumps `attempts` and returns the new value. */
  incrementOtpAttempts(id: string): Promise<number>;
  /** Atomically marks the request consumed; false when another caller won. */
  consumeOtpRequest(id: string, consumedAt: Date): Promise<boolean>;
  findUserByPhone(phone: string): Promise<AuthUserRecord | null>;
  /** Case-insensitive lookup used by email+password login. */
  findUserByEmail(email: string): Promise<AuthUserRecord | null>;
  findUserByGoogleSub(googleSub: string): Promise<AuthUserRecord | null>;
  /** True when any user (active or not) already owns this email. */
  emailExists(email: string): Promise<boolean>;
  /** True when any user already owns this phone. */
  phoneExists(phone: string): Promise<boolean>;
  /**
   * Creates a user with the `customer` role in one transaction. Unique
   * violations become CONFLICT. New accounts created here are customers only.
   */
  createUser(input: NewUser): Promise<AuthUserRecord>;
  /** Links a Google subject and marks the email verified. */
  linkGoogleAccount(userId: string, googleSub: string, verifiedAt: Date): Promise<void>;
  /** Roles that are currently granted (not revoked). */
  listActiveRoles(userId: string): Promise<Role[]>;
  /** Number of failed password logins for `email` created at/after `since`. */
  countFailedLoginAttempts(email: string, since: Date): Promise<number>;
  /** Audit row for one password login attempt (success or failure). */
  recordLoginAttempt(input: NewLoginAttempt): Promise<void>;
  /** Writes a new password hash; false when the user does not exist. */
  updatePassword(userId: string, passwordHash: string, updatedAt: Date): Promise<boolean>;
  insertSession(input: NewSession): Promise<void>;
  /** Revokes every active session of a user (e.g. after a password change). */
  revokeAllSessions(userId: string, at: Date): Promise<number>;
  /**
   * Revokes one session by `jti` when given; otherwise the user's most recent
   * session that is still active. Returns the number of rows revoked.
   */
  revokeSessions(userId: string, jti: string | null, at: Date): Promise<number>;
}

interface OtpRow {
  id: string;
  phone: string;
  code_hash: string;
  attempts: number;
  max_attempts: number;
  expires_at: Date;
  consumed_at: Date | null;
  created_at: Date;
}

interface UserRow {
  id: string;
  phone: string | null;
  email: string | null;
  password_hash: string | null;
}

function toUserRecord(row: UserRow): AuthUserRecord {
  return { id: row.id, phone: row.phone, email: row.email, passwordHash: row.password_hash };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505';
}

export class PgAuthRepository implements AuthRepository {
  async countRecentOtpRequests(phone: string, since: Date): Promise<number> {
    const rows = await query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM otp_requests WHERE phone = $1 AND created_at >= $2',
      [phone, since]
    );
    return rows[0]?.count ?? 0;
  }

  async insertOtpRequest(input: NewOtpRequest): Promise<void> {
    await query(
      `INSERT INTO otp_requests
         (id, phone, code_hash, channel, max_attempts, expires_at, requester_ip, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::inet, $8)`,
      [
        input.id,
        input.phone,
        input.codeHash,
        input.channel,
        input.maxAttempts,
        input.expiresAt,
        input.requesterIp,
        input.createdAt
      ]
    );
  }

  async findActiveOtpRequest(phone: string, now: Date): Promise<OtpRequestRecord | null> {
    const rows = await query<OtpRow>(
      `SELECT id, phone, code_hash, attempts, max_attempts, expires_at, consumed_at, created_at
         FROM otp_requests
        WHERE phone = $1
          AND consumed_at IS NULL
          AND expires_at > $2
        ORDER BY created_at DESC
        LIMIT 1`,
      [phone, now]
    );
    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      phone: row.phone,
      codeHash: row.code_hash,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      expiresAt: row.expires_at,
      consumedAt: row.consumed_at,
      createdAt: row.created_at
    };
  }

  async incrementOtpAttempts(id: string): Promise<number> {
    const rows = await query<{ attempts: number }>(
      'UPDATE otp_requests SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts',
      [id]
    );
    const attempts = rows[0]?.attempts;
    if (attempts === undefined) {
      throw new AppError('VALIDATION_ERROR', 'OTP request is no longer available');
    }
    return attempts;
  }

  async consumeOtpRequest(id: string, consumedAt: Date): Promise<boolean> {
    const rows = await query<{ id: string }>(
      'UPDATE otp_requests SET consumed_at = $2 WHERE id = $1 AND consumed_at IS NULL RETURNING id',
      [id, consumedAt]
    );
    return rows.length > 0;
  }

  async findUserByPhone(phone: string): Promise<AuthUserRecord | null> {
    const rows = await query<UserRow>(
      "SELECT id, phone, email, password_hash FROM users WHERE phone = $1 AND status = 'active'",
      [phone]
    );
    const row = rows[0];
    return row ? toUserRecord(row) : null;
  }

  async findUserByEmail(email: string): Promise<AuthUserRecord | null> {
    const rows = await query<UserRow>(
      "SELECT id, phone, email, password_hash FROM users WHERE lower(email) = lower($1) AND status = 'active'",
      [email]
    );
    const row = rows[0];
    return row ? toUserRecord(row) : null;
  }

  async findUserByGoogleSub(googleSub: string): Promise<AuthUserRecord | null> {
    const rows = await query<UserRow>(
      "SELECT id, phone, email, password_hash FROM users WHERE google_sub = $1 AND status = 'active'",
      [googleSub]
    );
    const row = rows[0];
    return row ? toUserRecord(row) : null;
  }

  async emailExists(email: string): Promise<boolean> {
    const rows = await query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM users WHERE lower(email) = lower($1)) AS exists',
      [email]
    );
    return rows[0]?.exists ?? false;
  }

  async phoneExists(phone: string): Promise<boolean> {
    const rows = await query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM users WHERE phone = $1) AS exists',
      [phone]
    );
    return rows[0]?.exists ?? false;
  }

  async createUser(input: NewUser): Promise<AuthUserRecord> {
    try {
      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO users
             (id, phone, email, name, password_hash, password_updated_at, google_sub, email_verified_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            input.id,
            input.phone,
            input.email,
            input.name,
            input.passwordHash,
            input.passwordUpdatedAt,
            input.googleSub,
            input.emailVerifiedAt
          ]
        );
        // Public registration and Google sign-up may only mint customers.
        await client.query("INSERT INTO user_roles (user_id, role) VALUES ($1, 'customer')", [
          input.id
        ]);
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError('CONFLICT', 'Email atau nomor sudah terdaftar');
      }
      throw err;
    }

    return {
      id: input.id,
      phone: input.phone,
      email: input.email,
      passwordHash: input.passwordHash
    };
  }

  async linkGoogleAccount(userId: string, googleSub: string, verifiedAt: Date): Promise<void> {
    const rows = await query<{ id: string }>(
      `UPDATE users
          SET google_sub = $2,
              email_verified_at = COALESCE(email_verified_at, $3),
              updated_at = $3
        WHERE id = $1
        RETURNING id`,
      [userId, googleSub, verifiedAt]
    );
    if (rows.length === 0) {
      throw new AppError('NOT_FOUND', 'User not found');
    }
  }

  async listActiveRoles(userId: string): Promise<Role[]> {
    const rows = await query<{ role: Role }>(
      'SELECT role FROM user_roles WHERE user_id = $1 AND revoked_at IS NULL ORDER BY role',
      [userId]
    );
    return rows.map((row) => row.role);
  }

  async countFailedLoginAttempts(email: string, since: Date): Promise<number> {
    const rows = await query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM login_attempts WHERE lower(email) = lower($1) AND succeeded = false AND created_at >= $2',
      [email, since]
    );
    return rows[0]?.count ?? 0;
  }

  async recordLoginAttempt(input: NewLoginAttempt): Promise<void> {
    await query(
      'INSERT INTO login_attempts (email, ip, succeeded, created_at) VALUES ($1, $2::inet, $3, $4)',
      [input.email, input.ip, input.succeeded, input.createdAt]
    );
  }

  async updatePassword(userId: string, passwordHash: string, updatedAt: Date): Promise<boolean> {
    const rows = await query<{ id: string }>(
      'UPDATE users SET password_hash = $2, password_updated_at = $3, updated_at = $3 WHERE id = $1 RETURNING id',
      [userId, passwordHash, updatedAt]
    );
    return rows.length > 0;
  }

  async insertSession(input: NewSession): Promise<void> {
    await query(
      `INSERT INTO sessions (jti, user_id, issued_at, expires_at, user_agent, ip)
       VALUES ($1, $2, $3, $4, $5, $6::inet)`,
      [input.jti, input.userId, input.issuedAt, input.expiresAt, input.userAgent, input.ip]
    );
  }

  async revokeAllSessions(userId: string, at: Date): Promise<number> {
    const rows = await query<{ id: string }>(
      'UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL RETURNING id',
      [userId, at]
    );
    return rows.length;
  }

  async revokeSessions(userId: string, jti: string | null, at: Date): Promise<number> {
    if (jti) {
      const rows = await query<{ id: string }>(
        `UPDATE sessions SET revoked_at = $3
          WHERE user_id = $1 AND jti = $2 AND revoked_at IS NULL
          RETURNING id`,
        [userId, jti, at]
      );
      return rows.length;
    }

    const rows = await query<{ id: string }>(
      `UPDATE sessions SET revoked_at = $2
        WHERE id = (
          SELECT id FROM sessions
           WHERE user_id = $1 AND revoked_at IS NULL
           ORDER BY issued_at DESC
           LIMIT 1
        )
        RETURNING id`,
      [userId, at]
    );
    return rows.length;
  }
}
