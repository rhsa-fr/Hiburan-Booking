import type { Pool } from 'pg';
import {
  CHAT_CHANNEL,
  type ChatMessageView,
  type ChatReadNotification,
  type ChatRole
} from './chat.contracts';

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
  read_at: Date | null;
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

/** Ids actually flipped by [ChatRepository.markRead], plus the value written. */
export interface ChatReadResult {
  read_ids: string[];
  read_at: Date;
}

/**
 * Satu `pg_notify` dibatasi 8000 byte oleh PostgreSQL. UUID (36 karakter) +
 * tanda kutip/koma ≈ 39 byte, jadi 100 id ≈ 4 KB — aman dengan margin besar.
 *
 * Konsekuensi yang disengaja: satu panggilan `markRead` bisa menghasilkan
 * BEBAS BEBERAPA event `read` (100 id per event, batch terakhir lebih kecil).
 * Klien harus memperlakukan setiap event sebagai penambahan tanda baca dan
 * menggabungkan `message_ids`; respons HTTP tetap memuat SELURUH id.
 */
export const READ_NOTIFY_BATCH_SIZE = 100;

const COLUMNS = 'id, booking_id, sender_id, sender_role, body, created_at, read_at';

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

  /**
   * Tanda baca pesan (FR-050/ADR 0011).
   *
   * Trigger `tarlink_chat_read_guard` (migrasi 039) melarang `read_at` diubah
   * setelah terisi, jadi filter `read_at IS NULL` bukan optimasi melainkan
   * syarat: UPDATE kedua untuk baris yang sama akan menggagalkan transaksi.
   * Pesan milik pembaca sendiri tidak pernah ditandai.
   *
   * NOTIFY dikirim dari transaksi yang sama supaya peristiwa `read` tidak
   * pernah tersiar untuk tulisan yang nanti di-ROLLBACK. Payload dipecah per
   * [READ_NOTIFY_BATCH_SIZE] karena batas 8000 byte PostgreSQL.
   */
  async markRead(
    bookingId: string,
    readerId: string,
    now: Date
  ): Promise<ChatReadResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query<{ id: string }>(
        `UPDATE chat_messages
            SET read_at = $3::timestamptz
          WHERE booking_id = $1::uuid
            AND sender_id <> $2::uuid
            AND read_at IS NULL
          RETURNING id`,
        [bookingId, readerId, now]
      );
      const readIds = updated.rows.map((row) => row.id);
      for (let start = 0; start < readIds.length; start += READ_NOTIFY_BATCH_SIZE) {
        const batch = readIds.slice(start, start + READ_NOTIFY_BATCH_SIZE);
        await client.query('SELECT pg_notify($1, $2)', [
          CHAT_CHANNEL,
          buildChatReadNotification(bookingId, readerId, batch, now)
        ]);
      }
      await client.query('COMMIT');
      return { read_ids: readIds, read_at: now };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

export function toChatMessageView(row: ChatMessageRow): ChatMessageView {
  return {
    id: row.id,
    booking_id: row.booking_id,
    sender_id: row.sender_id,
    sender_role: row.sender_role,
    body: row.body,
    created_at: row.created_at.toISOString(),
    read_at: row.read_at ? row.read_at.toISOString() : null
  };
}

/**
 * One place builds the `read` payload, so the NOTIFY text and what the gateway
 * parses can never drift. Field order is part of the wire shape.
 */
export function buildChatReadNotification(
  bookingId: string,
  readerId: string,
  messageIds: readonly string[],
  readAt: Date
): string {
  const payload: ChatReadNotification = {
    type: 'read',
    booking_id: bookingId,
    reader_id: readerId,
    message_ids: [...messageIds],
    read_at: readAt.toISOString()
  };
  return JSON.stringify(payload);
}
