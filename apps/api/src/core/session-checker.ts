import { configureSessionChecker } from '@tarlink/platform/auth';
import { query } from './db';

const ACTIVE_SESSION_SQL = `
SELECT EXISTS (
  SELECT 1 FROM sessions
   WHERE jti = $1
     AND user_id = $2
     AND revoked_at IS NULL
     AND expires_at > now()
) AS active
`;

/**
 * Closes the 15-minute window after logout/account deletion: every request
 * whose access token carries a `jti` is checked against `sessions`.
 */
export function installSessionChecker(): void {
  configureSessionChecker({
    async isActive(userId: string, jti: string): Promise<boolean> {
      const rows = await query<{ active: boolean }>(ACTIVE_SESSION_SQL, [jti, userId]);
      return rows[0]?.active === true;
    }
  });
}
