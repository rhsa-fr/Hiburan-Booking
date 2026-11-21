import type { Pool } from 'pg';

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  read_at: Date | null;
  created_at: Date;
}

export interface NotificationListOptions {
  unreadOnly: boolean;
  page: number;
  pageSize: number;
}

const COLUMNS = 'id, type, title, body, payload, read_at, created_at';

/**
 * Upsert on the token, not on (user, token): a device that signs into another
 * account must move to that account, otherwise the previous owner would keep
 * receiving pushes for hardware they no longer control. `updated_at` records
 * the last time the client proved it is still using this token.
 */
const UPSERT_DEVICE_SQL = `
INSERT INTO device_tokens (user_id, token, platform)
VALUES ($1::uuid, $2, $3)
ON CONFLICT (token) DO UPDATE
   SET user_id = EXCLUDED.user_id,
       platform = EXCLUDED.platform,
       updated_at = now()
`;

/**
 * `user_id` is part of the predicate, not a post-check: a caller cannot delete
 * a token owned by someone else even if the token string is known.
 */
const DELETE_DEVICE_SQL = `
DELETE FROM device_tokens
 WHERE user_id = $1::uuid
   AND token = $2
`;

/**
 * Every query is scoped by `user_id`: a notification belongs to exactly one
 * account and there is no cross-account read path.
 */
export class NotificationsRepository {
  constructor(private readonly pool: Pool) {}

  async list(
    userId: string,
    options: NotificationListOptions
  ): Promise<{ rows: NotificationRow[]; total: number }> {
    const unreadClause = options.unreadOnly ? 'AND read_at IS NULL' : '';
    const offset = (options.page - 1) * options.pageSize;

    const [rows, count] = await Promise.all([
      this.pool.query<NotificationRow>(
        `SELECT ${COLUMNS}
           FROM notifications
          WHERE user_id = $1 ${unreadClause}
          ORDER BY created_at DESC, id DESC
          LIMIT $2 OFFSET $3`,
        [userId, options.pageSize, offset]
      ),
      this.pool.query<{ total: string }>(
        `SELECT count(*)::text AS total
           FROM notifications
          WHERE user_id = $1 ${unreadClause}`,
        [userId]
      )
    ]);

    return {
      rows: rows.rows,
      total: Number(count.rows[0]?.total ?? '0')
    };
  }

  async unreadCount(userId: string): Promise<number> {
    const result = await this.pool.query<{ total: string }>(
      `SELECT count(*)::text AS total
         FROM notifications
        WHERE user_id = $1 AND read_at IS NULL`,
      [userId]
    );
    return Number(result.rows[0]?.total ?? '0');
  }

  async markRead(userId: string, id: string): Promise<NotificationRow | null> {
    const result = await this.pool.query<NotificationRow>(
      `UPDATE notifications
          SET read_at = COALESCE(read_at, now())
        WHERE id = $1 AND user_id = $2
        RETURNING ${COLUMNS}`,
      [id, userId]
    );
    return result.rows[0] ?? null;
  }

  async markAllRead(userId: string): Promise<number> {
    const result = await this.pool.query(
      `UPDATE notifications
          SET read_at = now()
        WHERE user_id = $1 AND read_at IS NULL`,
      [userId]
    );
    return result.rowCount ?? 0;
  }

  /**
   * Registers (or re-owns) a device token. Never takes the owner from the
   * request body: `userId` always comes from the access token.
   */
  async upsertDeviceToken(userId: string, token: string, platform: string): Promise<void> {
    await this.pool.query(UPSERT_DEVICE_SQL, [userId, token, platform]);
  }

  /** Returns how many rows the caller owned; another user's token yields 0. */
  async removeDeviceToken(userId: string, token: string): Promise<number> {
    const result = await this.pool.query(DELETE_DEVICE_SQL, [userId, token]);
    return result.rowCount ?? 0;
  }
}
