/**
 * Real-database test for the admin 2FA persistence queries in `PgAuthRepository`.
 *
 * Opt-in only: `DATABASE_URL` is present in .env on every dev machine, so it is
 * not a sufficient gate — a plain `vitest run` would otherwise write
 * `login_attempts` rows and a temporary user into the dev database on every
 * suite. The test runs only when `RUN_DB_TESTS=1` is set explicitly:
 *   $env:RUN_DB_TESTS='1'; $env:DATABASE_URL='...'; npx vitest run libs/modules/auth/src/auth.repository.integration.test.ts
 *
 * The process also needs the rest of the app environment (`JWT_SECRET` at least
 * 16 chars), because `@tarlink/core/db` builds its pool through `loadConfig()`;
 * run from the repo root so `.env` is present.
 *
 * What it proves, against real SQL (the unit tests only use an in-memory fake):
 * - `countFailedTotpAttempts` is per email, case-insensitive, and the empty
 *   email bucket only counts rows that were stored without an email.
 * - `countFailedTotpAttemptsByIp` counts only the given address.
 * - `insertAdminChallenge` keeps exactly one open challenge per user, and a
 *   second issuance replaces id/token/kind/expiry and resets `attempts`.
 *
 * Every row it writes is prefixed with a per-run marker (`zz-auth-it-*`) so a
 * shared dev database never makes the assertions flaky, and every row is
 * removed in `afterAll`. Requires migrations 001..026 already applied; the
 * partial unique index from 026 is what the upsert relies on.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool } from '@tarlink/core/db';
import { PgAuthRepository, type NewAdminChallenge } from './auth.repository';

const DATABASE_URL = process.env.DATABASE_URL?.trim();
const RUN_DB_TESTS = process.env.RUN_DB_TESTS?.trim() === '1' && Boolean(DATABASE_URL);

const RUN = `zz-auth-it-${Date.now()}`;
const A_EMAIL = `${RUN}-a@example.test`;
const B_EMAIL = `${RUN}-b@example.test`;

// Two octets derived from the clock keep concurrent runs on distinct addresses.
const stamp = Date.now();
const IP_THIRD = (Math.floor(stamp / 1_000) + process.pid) % 250;
const IP_FOURTH = (stamp % 250) + 1;
const UNIQUE_IP = `10.${IP_THIRD}.${IP_FOURTH}.11`;
/** Empty-email rows carry their own address so cleanup can target them exactly. */
const EMPTY_BUCKET_IP = `10.${IP_THIRD}.${IP_FOURTH}.12`;
/** TEST-NET-2 (RFC 5737): never a real client, so only our rows can match. */
const OTHER_IP = '198.51.100.42';

const repository = new PgAuthRepository();

function challengeInput(
  id: string,
  kind: 'enroll' | 'verify',
  tokenHash: string,
  userId: string,
  expiresAt: Date,
  createdAt: Date
): NewAdminChallenge {
  return {
    id,
    userId,
    kind,
    tokenHash,
    maxAttempts: 6,
    expiresAt,
    requesterIp: null,
    userAgent: null,
    createdAt
  };
}

async function recordFailedTotp(
  email: string,
  ip: string | null,
  times: number,
  at: Date
): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await repository.recordLoginAttempt({ email, ip, succeeded: false, createdAt: at, stage: 'totp' });
  }
}

describe.skipIf(!RUN_DB_TESTS)('PgAuthRepository 2FA queries against PostgreSQL', () => {
  let pool: Pool;
  let tempUserId: string | null = null;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
    // `users.phone` is VARCHAR(20) NOT NULL UNIQUE.
    const { rows } = await pool.query<{ id: string }>(
      'INSERT INTO users (phone, email) VALUES ($1, $2) RETURNING id',
      [`zz2fa${Date.now().toString().slice(-10)}`, `${RUN}-admin@example.test`]
    );
    tempUserId = rows[0]?.id ?? null;
    if (!tempUserId) throw new Error('temp user insert returned no id');
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      // Scoped to this run: the marker covers the per-email rows, the address
      // covers the empty-email rows that `LIKE` cannot see.
      await pool.query(
        `DELETE FROM login_attempts
          WHERE email LIKE $1 OR (email = $2 AND ip = $3::inet)`,
        [`${RUN}%`, '', EMPTY_BUCKET_IP]
      );
      if (tempUserId) {
        // `admin_2fa_challenges` cascades from `users`.
        await pool.query('DELETE FROM users WHERE id = $1', [tempUserId]);
      }
    } finally {
      await pool.end();
      // The repository writes through the shared @tarlink/core/db pool; close
      // it so vitest can exit instead of waiting on idle clients.
      await closePool();
    }
  });

  it('counts failed TOTP attempts per email and keeps the empty bucket separate', async () => {
    const since = new Date(Date.now() - 60_000);
    const at = new Date();

    const emptyBefore = await repository.countFailedTotpAttempts('', since);
    const aBefore = await repository.countFailedTotpAttempts(A_EMAIL, since);
    const aUpperBefore = await repository.countFailedTotpAttempts(A_EMAIL.toUpperCase(), since);
    const bBefore = await repository.countFailedTotpAttempts(B_EMAIL, since);

    await recordFailedTotp(A_EMAIL, null, 10, at);
    await recordFailedTotp(B_EMAIL, null, 2, at);

    // Neither a successful TOTP nor a password-stage failure may count.
    await repository.recordLoginAttempt({
      email: A_EMAIL,
      ip: null,
      succeeded: true,
      createdAt: at,
      stage: 'totp'
    });
    await repository.recordLoginAttempt({
      email: A_EMAIL,
      ip: null,
      succeeded: false,
      createdAt: at,
      stage: 'password'
    });

    const aAfter = await repository.countFailedTotpAttempts(A_EMAIL, since);
    expect(aAfter - aBefore).toBe(10);
    expect((await repository.countFailedTotpAttempts(B_EMAIL, since)) - bBefore).toBe(2);
    expect(await repository.countFailedTotpAttempts('', since)).toBe(emptyBefore);
    // Case-insensitive: the uppercase form sees the same ten failures.
    expect((await repository.countFailedTotpAttempts(A_EMAIL.toUpperCase(), since)) - aUpperBefore).toBe(
      10
    );

    // Empty-email failures land in their own bucket, never in an account's.
    await recordFailedTotp('', EMPTY_BUCKET_IP, 2, at);
    expect((await repository.countFailedTotpAttempts('', since)) - emptyBefore).toBe(2);
    expect(await repository.countFailedTotpAttempts(A_EMAIL, since)).toBe(aAfter);
  }, 30_000);

  it('counts failed TOTP attempts per IP and ignores other addresses', async () => {
    const since = new Date(Date.now() - 60_000);
    const at = new Date();

    const ipBefore = await repository.countFailedTotpAttemptsByIp(UNIQUE_IP, since);
    const otherBefore = await repository.countFailedTotpAttemptsByIp(OTHER_IP, since);

    await recordFailedTotp(B_EMAIL, UNIQUE_IP, 3, at);

    expect((await repository.countFailedTotpAttemptsByIp(UNIQUE_IP, since)) - ipBefore).toBe(3);
    expect(await repository.countFailedTotpAttemptsByIp(OTHER_IP, since)).toBe(otherBefore);
  }, 30_000);

  it('keeps exactly one open challenge per user and resets its state on reissue', async () => {
    expect(tempUserId).not.toBeNull();
    const userId = tempUserId as string;

    const createdAt = new Date();
    const firstExpiry = new Date(createdAt.getTime() + 5 * 60_000);
    const secondExpiry = new Date(createdAt.getTime() + 10 * 60_000);
    const firstId = randomUUID();
    const secondId = randomUUID();
    const firstHash = `${RUN}-token-first`;
    const secondHash = `${RUN}-token-second`;

    await repository.insertAdminChallenge(
      challengeInput(firstId, 'enroll', firstHash, userId, firstExpiry, createdAt)
    );
    // Give the open row a non-zero counter; otherwise `attempts = 0` on the
    // reissue would prove nothing.
    expect(await repository.incrementChallengeAttempt(firstId, createdAt)).toBe(1);

    await repository.insertAdminChallenge(
      challengeInput(secondId, 'verify', secondHash, userId, secondExpiry, createdAt)
    );

    const open = await pool.query<{
      id: string;
      token_hash: string;
      kind: string;
      attempts: number;
      expires_at: Date;
    }>(
      `SELECT id, token_hash, kind, attempts, expires_at
         FROM admin_2fa_challenges
        WHERE user_id = $1 AND consumed_at IS NULL`,
      [userId]
    );

    expect(open.rows).toHaveLength(1);
    const row = open.rows[0];
    expect(row?.id).toBe(secondId);
    expect(row?.token_hash).toBe(secondHash);
    expect(row?.kind).toBe('verify');
    expect(row?.attempts).toBe(0);
    expect(row?.expires_at.getTime()).toBe(secondExpiry.getTime());

    // The upsert updated the row in place instead of inserting a second one.
    const total = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM admin_2fa_challenges WHERE user_id = $1',
      [userId]
    );
    expect(total.rows[0]?.count).toBe(1);
  }, 30_000);

  it('keeps exactly one open row when two issuances race', async () => {
    expect(tempUserId).not.toBeNull();
    const userId = tempUserId as string;
    await pool.query('DELETE FROM admin_2fa_challenges WHERE user_id = $1', [userId]);

    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + 10 * 60_000);
    const first = challengeInput(
      randomUUID(),
      'verify',
      `${RUN}-race-1`,
      userId,
      expiresAt,
      createdAt
    );
    const second = challengeInput(
      randomUUID(),
      'enroll',
      `${RUN}-race-2`,
      userId,
      expiresAt,
      createdAt
    );

    await Promise.all([
      repository.insertAdminChallenge(first),
      repository.insertAdminChallenge(second)
    ]);

    const open = await pool.query<{ id: string }>(
      `SELECT id FROM admin_2fa_challenges WHERE user_id = $1 AND consumed_at IS NULL`,
      [userId]
    );
    expect(open.rows).toHaveLength(1);
    expect([first.id, second.id]).toContain(open.rows[0]?.id);
  }, 30_000);
});
