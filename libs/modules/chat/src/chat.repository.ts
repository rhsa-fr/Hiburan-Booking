import type { Pool } from 'pg';
import type { ChatMessageView, ChatRole } from './chat.contracts';

export interface ChatParticipantRow {
  customer_id: string;
  vendor_id: string;
  is_customer: boolean;
  is_vendor_owner: boolean;
  is_vendor_member: boolean;
}

export interface ChatMessageRow {
  id: string;
  booking_id: string;
  sender_id: string;
  sender_role: ChatRole;
  body: string;
  created_at: Date;
}

export interface ChatHistoryOptions {
  beforeCreatedAt: Date | null;
  beforeId: string | null;
  limit: number;
}

export interface NewChatMessage {
  bookingId: string;
  senderId: string;
  senderRole: ChatRole;
  body: string;
}

const COLUMNS = 'id, booking_id, sender_id, sender_role, body, created_at';

/**
 * Chat persistence. Every read is scoped by `booking_id`; permission is decided
 * by the service from [findParticipants] before any query runs.
 */
export class ChatRepository {
  constructor(private readonly pool: Pool) {}

  async findParticipants(
    bookingId: string,
    userId: string
  ): Promise<ChatParticipantRow | null> {
    const result = await this.pool.query<ChatParticipantRow>(
      `SELECT b.customer_id,
              b.vendor_id,
              (b.customer_id = $2) AS is_customer,
              EXISTS (
                SELECT 1 FROM vendors v
                 WHERE v.id = b.vendor_id AND v.owner_user_id = $2
              ) AS is_vendor_owner,
              EXISTS (
                SELECT 1 FROM vendor_members vm
                 WHERE vm.vendor_id = b.vendor_id
                   AND vm.user_id = $2
                   AND vm.is_active
              ) AS is_vendor_member
         FROM bookings b
        WHERE b.id = $1`,
      [bookingId, userId]
    );
    return result.rows[0] ?? null;
  }

  /**
   * Riwayat chat untuk satu pembaca.
   *
   * Dua filter moderasi diterapkan di SQL, bukan di klien:
   * - `hidden_at IS NULL` — pesan yang diturunkan admin (FR-124) tidak muncul;
   * - `NOT EXISTS (user_blocks …)` — pesan dari pihak yang diblokir pembaca
   *   tidak dikirim sama sekali (FR-142). Ditaruh di query supaya paginasi
   *   tetap benar: menyaring setelah LIMIT akan membuat halaman bolong.
   */
  async listMessages(
    bookingId: string,
    viewerId: string,
    options: ChatHistoryOptions
  ): Promise<ChatMessageRow[]> {
    const result = await this.pool.query<ChatMessageRow>(
      `SELECT ${COLUMNS}
         FROM chat_messages m
        WHERE m.booking_id = $1
          AND m.hidden_at IS NULL
          AND NOT EXISTS (
                SELECT 1 FROM user_blocks ub
                 WHERE ub.blocker_id = $2::uuid
                   AND ub.blocked_id = m.sender_id
              )
          AND ($3::timestamptz IS NULL
               OR (m.created_at, m.id) < ($3::timestamptz, $4::uuid))
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT $5`,
      [
        bookingId,
        viewerId,
        options.beforeCreatedAt,
        options.beforeId,
        options.limit
      ]
    );
    return result.rows;
  }

  async insertMessage(input: NewChatMessage): Promise<ChatMessageRow> {
    const result = await this.pool.query<ChatMessageRow>(
      `INSERT INTO chat_messages (booking_id, sender_id, sender_role, body)
       VALUES ($1, $2, $3, $4)
       RETURNING ${COLUMNS}`,
      [input.bookingId, input.senderId, input.senderRole, input.body]
    );
    const row = result.rows[0];
    if (!row) throw new Error('chat message insert returned no row');
    return row;
  }
}

export function toChatMessageView(row: ChatMessageRow): ChatMessageView {
  return {
    id: row.id,
    booking_id: row.booking_id,
    sender_id: row.sender_id,
    sender_role: row.sender_role,
    body: row.body,
    created_at: row.created_at.toISOString()
  };
}
