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

/** New OTPs use `email`; legacy rows may still carry whatsapp/sms. */
export type OtpChannel = 'email' | 'whatsapp' | 'sms';

export interface OtpRequestRecord {
  readonly id: string;
  readonly email: string;
  readonly codeHash: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
  readonly createdAt: Date;
}

export interface NewOtpRequest {
  readonly id: string;
  readonly email: string;
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

/** Read-only profile of the authenticated user (`GET /auth/me`). */
export interface AuthUserProfile extends AuthUserRecord {
  readonly name: string | null;
  readonly createdAt: Date;
}

/** Active version of one policy code (`tos`, `privacy`, `cancellation`). */
export interface ActivePolicyVersion {
  readonly id: string;
  readonly code: string;
  readonly version: number;
}

/** One accepted policy version, written with the user in the same transaction. */
export interface NewUserConsent {
  readonly policyCode: string;
  readonly policyVersionId: string;
  readonly acceptedAt: Date;
  readonly ip: string | null;
  readonly userAgent: string | null;
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
  /**
   * FR-103: public registration records the accepted ToS/privacy versions.
   * Google sign-up passes none; that gap is tracked separately.
   */
  readonly consents?: readonly NewUserConsent[];
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
  /** sha256 of the opaque refresh token; the plaintext is never stored. */
  readonly refreshTokenHash: string;
  readonly refreshExpiresAt: Date;
  readonly familyId: string;
  readonly parentId: string | null;
}

/** Deletion record plus the private object keys whose files must be removed. */
export interface AccountDeletionOutcome {
  readonly record: AccountDeletionRecord;
  readonly privateObjectKeys: string[];
}

/** Outcome of an account deletion request (UU PDP / FR-101). */
export interface AccountDeletionRecord {
  readonly id: string;
  readonly userId: string;
  readonly status: 'requested' | 'completed' | 'cancelled';
  readonly reason: string | null;
  readonly requestedAt: Date;
  readonly completedAt: Date | null;
}

/** Row used by refresh rotation and reuse detection. */
export interface SessionRefreshRecord {
  readonly jti: string;
  readonly userId: string;
  readonly familyId: string;
  readonly revokedAt: Date | null;
  readonly refreshExpiresAt: Date | null;
}

export interface AuthRepository {
  /** Number of OTP requests for `email` created at/after `since`. */
  countRecentOtpRequests(email: string, since: Date): Promise<number>;
  /** Number of OTP requests from `ip` created at/after `since` (null when no IP). */
  countRecentOtpRequestsByIp(ip: string, since: Date): Promise<number>;
  insertOtpRequest(input: NewOtpRequest): Promise<void>;
  /** Newest request for `email` that is neither consumed nor expired. */
  findActiveOtpRequest(email: string, now: Date): Promise<OtpRequestRecord | null>;
  /** Atomically bumps `attempts` and returns the new value. */
  incrementOtpAttempts(id: string): Promise<number>;
  /** Atomically marks the request consumed; false when another caller won. */
  consumeOtpRequest(id: string, consumedAt: Date): Promise<boolean>;
  findUserByPhone(phone: string): Promise<AuthUserRecord | null>;
  /** Case-insensitive lookup used by email+password login. */
  findUserByEmail(email: string): Promise<AuthUserRecord | null>;
  findUserByGoogleSub(googleSub: string): Promise<AuthUserRecord | null>;
  /** Active user plus the profile fields, by id. Null when absent or not active. */
  findUserProfile(userId: string): Promise<AuthUserProfile | null>;
  /** True when any user (active or not) already owns this email. */
  emailExists(email: string): Promise<boolean>;
  /** True when any user already owns this phone. */
  phoneExists(phone: string): Promise<boolean>;
  /** Version that is active right now for `code`, or null when none is published. */
  findActivePolicyVersion(code: string): Promise<ActivePolicyVersion | null>;
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
  /** Number of failed password logins from `ip` created at/after `since`. */
  countFailedLoginAttemptsByIp(ip: string, since: Date): Promise<number>;
  /** Audit row for one password login attempt (success or failure). */
  recordLoginAttempt(input: NewLoginAttempt): Promise<void>;
  /** Writes a new password hash; false when the user does not exist. */
  updatePassword(userId: string, passwordHash: string, updatedAt: Date): Promise<boolean>;
  insertSession(input: NewSession): Promise<void>;
  /** Session row for `jti` that is neither revoked nor expired; null otherwise. */
  findActiveSessionByJti(jti: string, now: Date): Promise<{ userId: string } | null>;
  /** Revokes every active session of a user (e.g. after a password change). */
  revokeAllSessions(userId: string, at: Date): Promise<number>;
  /**
   * Revokes one session by `jti` when given; otherwise the user's most recent
   * session that is still active. Returns the number of rows revoked.
   */
  revokeSessions(userId: string, jti: string | null, at: Date): Promise<number>;
  /** Session lookup for refresh rotation, including already-revoked rows. */
  findSessionByRefreshHash(refreshTokenHash: string): Promise<SessionRefreshRecord | null>;
  /** Marks one session as rotated (revoked + rotated_at + reason) atomically. */
  markSessionRotated(jti: string, at: Date): Promise<boolean>;
  /** Revokes every session in a rotation family (refresh-token reuse). */
  revokeFamily(familyId: string, at: Date): Promise<number>;
  /** Revokes the session owning `refreshTokenHash` (logout by refresh token). */
  revokeByRefreshHash(refreshTokenHash: string, at: Date): Promise<number>;
  /**
   * Anonymises the user's personal data, revokes sessions and roles, and
   * records a completed deletion request in one transaction. The row is kept so
   * bookings, payments and payouts keep their foreign keys.
   */
  deleteAccount(userId: string, reason: string | null, at: Date): Promise<AccountDeletionOutcome>;
  /** Newest deletion request of the user, or null when none exists. */
  findDeletionRequest(userId: string): Promise<AccountDeletionRecord | null>;
}

interface OtpRow {
  id: string;
  email: string;
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

interface UserProfileRow extends UserRow {
  name: string | null;
  created_at: Date;
}

interface SessionRefreshRow {
  jti: string;
  user_id: string;
  family_id: string | null;
  revoked_at: Date | null;
  refresh_expires_at: Date | null;
}

interface DeletionRow {
  id: string;
  user_id: string;
  status: 'requested' | 'completed' | 'cancelled';
  reason: string | null;
  requested_at: Date;
  completed_at: Date | null;
}

const SELECT_DELETION_SQL = `
SELECT id, user_id, status, reason, requested_at, completed_at
FROM account_deletion_requests
WHERE user_id = $1
ORDER BY requested_at DESC
`;

function mapDeletion(row: DeletionRow): AccountDeletionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    reason: row.reason,
    requestedAt: row.requested_at,
    completedAt: row.completed_at
  };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505';
}

export class PgAuthRepository implements AuthRepository {
  async countRecentOtpRequests(email: string, since: Date): Promise<number> {
    const rows = await query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM otp_requests WHERE lower(email) = lower($1) AND created_at >= $2',
      [email, since]
    );
    return rows[0]?.count ?? 0;
  }

  async countRecentOtpRequestsByIp(ip: string, since: Date): Promise<number> {
    const rows = await query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM otp_requests WHERE requester_ip = $1::inet AND created_at >= $2',
      [ip, since]
    );
    return rows[0]?.count ?? 0;
  }

  async insertOtpRequest(input: NewOtpRequest): Promise<void> {
    await query(
      `INSERT INTO otp_requests
         (id, email, code_hash, channel, max_attempts, expires_at, requester_ip, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::inet, $8)`,
      [
        input.id,
        input.email,
        input.codeHash,
        input.channel,
        input.maxAttempts,
        input.expiresAt,
        input.requesterIp,
        input.createdAt
      ]
    );
  }

  async findActiveOtpRequest(email: string, now: Date): Promise<OtpRequestRecord | null> {
    const rows = await query<OtpRow>(
      `SELECT id, email, code_hash, attempts, max_attempts, expires_at, consumed_at, created_at
         FROM otp_requests
        WHERE lower(email) = lower($1)
          AND consumed_at IS NULL
          AND expires_at > $2
        ORDER BY created_at DESC
        LIMIT 1`,
      [email, now]
    );
    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      email: row.email,
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

  async findUserProfile(userId: string): Promise<AuthUserProfile | null> {
    const rows = await query<UserProfileRow>(
      "SELECT id, phone, email, password_hash, name, created_at FROM users WHERE id = $1 AND status = 'active'",
      [userId]
    );
    const row = rows[0];
    if (!row) return null;
    return {
      ...toUserRecord(row),
      name: row.name,
      createdAt: row.created_at
    };
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

  async findActivePolicyVersion(code: string): Promise<ActivePolicyVersion | null> {
    const rows = await query<ActivePolicyVersion>(
      `SELECT id, code, version
         FROM policy_versions
        WHERE code = $1
          AND is_active
          AND effective_from <= now()
          AND (effective_to IS NULL OR effective_to > now())
        ORDER BY effective_from DESC, version DESC
        LIMIT 1`,
      [code]
    );
    return rows[0] ?? null;
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
        // Consent is part of the same transaction: a user never exists without
        // the policy versions they accepted at sign-up.
        for (const consent of input.consents ?? []) {
          await client.query(
            `INSERT INTO user_consents
               (user_id, policy_code, policy_version_id, accepted_at, ip, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (user_id, policy_version_id) DO NOTHING`,
            [
              input.id,
              consent.policyCode,
              consent.policyVersionId,
              consent.acceptedAt,
              consent.ip,
              consent.userAgent
            ]
          );
        }
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

  async countFailedLoginAttemptsByIp(ip: string, since: Date): Promise<number> {
    const rows = await query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM login_attempts WHERE ip = $1::inet AND succeeded = false AND created_at >= $2',
      [ip, since]
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
      `INSERT INTO sessions
         (jti, user_id, issued_at, expires_at, user_agent, ip,
          refresh_token_hash, refresh_expires_at, family_id, parent_id)
       VALUES ($1, $2, $3, $4, $5, $6::inet, $7, $8, $9, $10)`,
      [
        input.jti,
        input.userId,
        input.issuedAt,
        input.expiresAt,
        input.userAgent,
        input.ip,
        input.refreshTokenHash,
        input.refreshExpiresAt,
        input.familyId,
        input.parentId
      ]
    );
  }

  async findActiveSessionByJti(jti: string, now: Date): Promise<{ userId: string } | null> {
    const rows = await query<{ user_id: string }>(
      `SELECT user_id FROM sessions
        WHERE jti = $1 AND revoked_at IS NULL AND expires_at > $2
        LIMIT 1`,
      [jti, now]
    );
    const row = rows[0];
    return row ? { userId: row.user_id } : null;
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

  async findSessionByRefreshHash(
    refreshTokenHash: string
  ): Promise<SessionRefreshRecord | null> {
    const rows = await query<SessionRefreshRow>(
      `SELECT jti, user_id, family_id, revoked_at, refresh_expires_at
         FROM sessions
        WHERE refresh_token_hash = $1
        LIMIT 1`,
      [refreshTokenHash]
    );
    const row = rows[0];
    if (!row) return null;
    return {
      jti: row.jti,
      userId: row.user_id,
      // Rows written before migration 011 have no family; fall back to the jti
      // so reuse detection still isolates that single session.
      familyId: row.family_id ?? row.jti,
      revokedAt: row.revoked_at,
      refreshExpiresAt: row.refresh_expires_at
    };
  }

  async markSessionRotated(jti: string, at: Date): Promise<boolean> {
    const rows = await query<{ id: string }>(
      `UPDATE sessions
          SET revoked_at = $2,
              rotated_at = $2,
              revoke_reason = 'rotated'
        WHERE jti = $1 AND revoked_at IS NULL
        RETURNING id`,
      [jti, at]
    );
    return rows.length > 0;
  }

  async revokeFamily(familyId: string, at: Date): Promise<number> {
    const rows = await query<{ id: string }>(
      `UPDATE sessions
          SET revoked_at = $2,
              revoke_reason = COALESCE(revoke_reason, 'reuse_detected')
        WHERE family_id = $1 AND revoked_at IS NULL
        RETURNING id`,
      [familyId, at]
    );
    return rows.length;
  }

  async revokeByRefreshHash(refreshTokenHash: string, at: Date): Promise<number> {
    const rows = await query<{ id: string }>(
      `UPDATE sessions
          SET revoked_at = $2,
              revoke_reason = COALESCE(revoke_reason, 'logout')
        WHERE refresh_token_hash = $1 AND revoked_at IS NULL
        RETURNING id`,
      [refreshTokenHash, at]
    );
    return rows.length;
  }

  async deleteAccount(
    userId: string,
    reason: string | null,
    at: Date
  ): Promise<AccountDeletionOutcome> {
    return withTransaction(async (client) => {
      const users = await client.query<{ id: string; status: string }>(
        'SELECT id, status FROM users WHERE id = $1 FOR UPDATE',
        [userId]
      );
      const user = users.rows[0];
      if (!user) throw new AppError('NOT_FOUND', 'User not found');

      let record: AccountDeletionRecord | null = null;

      // Idempotent: a repeated request reuses the completed record instead of
      // anonymising twice or creating a second audit row.
      if (user.status === 'deleted') {
        const existing = await client.query<DeletionRow>(
          `${SELECT_DELETION_SQL} LIMIT 1`,
          [userId]
        );
        const row = existing.rows[0];
        if (row) record = mapDeletion(row);
      } else {
        await client.query(
          `UPDATE users
              SET phone = NULL,
                  email = NULL,
                  name = 'Pengguna dihapus',
                  avatar_object_key = NULL,
                  password_hash = NULL,
                  google_sub = NULL,
                  status = 'deleted',
                  deletion_requested_at = COALESCE(deletion_requested_at, $2),
                  updated_at = $2
            WHERE id = $1`,
          [userId, at]
        );

        await client.query(
          `UPDATE sessions
              SET revoked_at = $2,
                  revoke_reason = COALESCE(revoke_reason, 'account_deleted')
            WHERE user_id = $1 AND revoked_at IS NULL`,
          [userId, at]
        );

        await client.query(
          `UPDATE user_roles
              SET revoked_at = $2
            WHERE user_id = $1 AND revoked_at IS NULL`,
          [userId, at]
        );
      }

      if (!record) {
        const inserted = await client.query<DeletionRow>(
          `INSERT INTO account_deletion_requests
             (user_id, status, reason, requested_at, completed_at)
           VALUES ($1, 'completed', $2, $3, $3)
           RETURNING id, user_id, status, reason, requested_at, completed_at`,
          [userId, reason, at]
        );
        const row = inserted.rows[0];
        if (!row) {
          throw new AppError('INTERNAL_ERROR', 'deletion request insert returned no row');
        }
        record = mapDeletion(row);
      }

      // Read the old keys first: `RETURNING` after a UPDATE reports the new
      // value, which is exactly the NULL/'' we are writing. KTP is national
      // identity data, so the caller must delete the encrypted bytes too.
      const vendorKeys = await client.query<{ ktp_object_key: string }>(
        `SELECT ktp_object_key
           FROM vendors
          WHERE owner_user_id = $1 AND ktp_object_key IS NOT NULL
          FOR UPDATE`,
        [userId]
      );
      const applicationKeys = await client.query<{ ktp_object_key: string }>(
        `SELECT ktp_object_key
           FROM vendor_applications
          WHERE user_id = $1 AND ktp_object_key <> ''
          FOR UPDATE`,
        [userId]
      );

      await client.query(
        `UPDATE vendors
            SET ktp_object_key = NULL,
                updated_at = $2
          WHERE owner_user_id = $1 AND ktp_object_key IS NOT NULL`,
        [userId, at]
      );
      await client.query(
        `UPDATE vendor_applications
            SET ktp_object_key = ''
          WHERE user_id = $1 AND ktp_object_key <> ''`,
        [userId]
      );

      return {
        record,
        privateObjectKeys: [
          ...vendorKeys.rows.map((row) => row.ktp_object_key),
          ...applicationKeys.rows.map((row) => row.ktp_object_key)
        ]
      };
    });
  }

  async findDeletionRequest(userId: string): Promise<AccountDeletionRecord | null> {
    const rows = await query<DeletionRow>(`${SELECT_DELETION_SQL} LIMIT 1`, [userId]);
    const row = rows[0];
    return row ? mapDeletion(row) : null;
  }
}
