import { query } from '../db';
import { errorMessage, logLine } from '../log';
import type { JobStats } from './runner';

interface CleanupRow {
  sessions: number;
  otp_requests: number;
  login_attempts: number;
}

/**
 * Prunes auth tables that grow one row per login/refresh/attempt.
 *
 * Retention is deliberately longer than any active session or audit need:
 *   - sessions: 30 days after expiry or revocation (the refresh TTL itself is
 *     30 days, so an active family is never touched);
 *   - otp_requests: 7 days after expiry;
 *   - login_attempts: 30 days.
 *
 * Idempotent: running it twice simply deletes nothing the second time.
 */
const CLEANUP_SQL = `
WITH deleted_sessions AS (
  DELETE FROM sessions
   WHERE expires_at < now() - interval '30 days'
      OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '30 days')
  RETURNING 1
),
deleted_otp AS (
  DELETE FROM otp_requests
   WHERE expires_at < now() - interval '7 days'
  RETURNING 1
),
deleted_attempts AS (
  DELETE FROM login_attempts
   WHERE created_at < now() - interval '30 days'
  RETURNING 1
)
SELECT (SELECT COUNT(*) FROM deleted_sessions)::int AS sessions,
       (SELECT COUNT(*) FROM deleted_otp)::int AS otp_requests,
       (SELECT COUNT(*) FROM deleted_attempts)::int AS login_attempts
`;

export async function runCleanupAuth(): Promise<JobStats> {
  const stats: JobStats = { processed: 0, skipped: 0, failed: 0 };
  try {
    const rows = await query<CleanupRow>(CLEANUP_SQL);
    const row = rows[0];
    const total = (row?.sessions ?? 0) + (row?.otp_requests ?? 0) + (row?.login_attempts ?? 0);
    stats.processed = total;
    if (total === 0) stats.skipped = 1;
    else {
      logLine(
        `job=cleanup_auth sessions=${row?.sessions ?? 0} otp_requests=${row?.otp_requests ?? 0} login_attempts=${row?.login_attempts ?? 0}`
      );
    }
  } catch (err) {
    stats.failed = 1;
    logLine(`job=cleanup_auth failed=1 error=${errorMessage(err)}`);
  }
  return stats;
}
