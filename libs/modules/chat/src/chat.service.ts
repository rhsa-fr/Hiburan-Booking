import { AppError } from '@tarlink/core/errors';
import type {
  ChatMessagePage,
  ChatMessageView,
  ChatReadReceipt,
  ChatRole,
  ChatThreadView,
  ListChatMessagesQuery
} from './chat.contracts';
import {
  ChatRepository,
  toChatMessageView,
  type ChatMessageRow,
  type ChatThreadRow
} from './chat.repository';

const MAX_BODY_LENGTH = 2000;
const ADMIN_ROLES = new Set(['admin_support', 'admin_finance', 'admin_super']);
const CURSOR_SEPARATOR = '|';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ChatUser {
  readonly id: string;
  readonly roles: readonly string[];
}

/** Trims and validates a message. Shared by REST and WebSocket paths. */
export function normalizeChatBody(value: unknown): string {
  if (typeof value !== 'string') {
    throw new AppError('VALIDATION_ERROR', 'Pesan wajib berupa teks');
  }
  const body = value.trim();
  if (body.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'Pesan tidak boleh kosong');
  }
  if (body.length > MAX_BODY_LENGTH) {
    throw new AppError(
      'VALIDATION_ERROR',
      `Pesan maksimal ${MAX_BODY_LENGTH} karakter`
    );
  }
  return body;
}

/** Cursor is `<created_at ISO>|<uuid>`, opaque to clients. */
export function encodeChatCursor(row: ChatMessageRow): string {
  return `${row.created_at.toISOString()}${CURSOR_SEPARATOR}${row.id}`;
}

export function decodeChatCursor(
  raw: string
): { createdAt: Date; id: string } {
  const separator = raw.lastIndexOf(CURSOR_SEPARATOR);
  if (separator <= 0) {
    throw new AppError('VALIDATION_ERROR', 'Cursor riwayat chat tidak valid');
  }
  const createdAt = new Date(raw.slice(0, separator));
  const id = raw.slice(separator + 1);
  if (Number.isNaN(createdAt.getTime()) || id.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'Cursor riwayat chat tidak valid');
  }
  return { createdAt, id };
}

export class ChatService {
  constructor(private readonly repository: ChatRepository) {}

  /**
   * The role comes from the booking relationship, never from the token alone:
   * a vendor_owner may also be a customer of another vendor's booking.
   */
  async resolveRole(bookingId: string, user: ChatUser): Promise<ChatRole> {
    if (!UUID_PATTERN.test(bookingId)) {
      throw new AppError('VALIDATION_ERROR', 'invalid booking id');
    }
    const participants = await this.repository.findParticipants(bookingId, user.id);
    if (!participants) {
      throw new AppError('NOT_FOUND', 'Booking tidak ditemukan');
    }
    if (participants.is_customer) return 'customer';
    if (participants.is_vendor_owner || participants.is_vendor_member) return 'vendor';
    if (user.roles.some((role) => ADMIN_ROLES.has(role))) return 'admin';
    throw new AppError('FORBIDDEN', 'Kamu tidak terlibat dalam booking ini');
  }

  /** Inbox rows for the current customer or vendor; one row per booking. */
  async threads(user: ChatUser): Promise<ChatThreadView[]> {
    const rows: ChatThreadRow[] = await this.repository.listThreads(user.id);
    return rows.map((row) => ({
      booking_id: row.booking_id,
      booking_code: row.booking_code,
      vendor_id: row.vendor_id,
      vendor_name: row.vendor_name,
      counterpart_name: row.is_customer
        ? row.vendor_name
        : row.customer_name ?? 'Pelanggan',
      counterpart_role: row.is_customer ? 'vendor' : 'customer',
      last_message: row.last_message,
      last_at: row.last_at.toISOString(),
      unread_count: row.unread_count
    }));
  }

  async list(
    bookingId: string,
    user: ChatUser,
    query: ListChatMessagesQuery
  ): Promise<ChatMessagePage> {
    await this.resolveRole(bookingId, user);
    const cursor = query.before ? decodeChatCursor(query.before) : null;

    // One extra row tells us whether an older page exists without a count query.
    const rows = await this.repository.listMessages(bookingId, user.id, {
      beforeCreatedAt: cursor?.createdAt ?? null,
      beforeId: cursor?.id ?? null,
      limit: query.limit + 1
    });

    const hasMore = rows.length > query.limit;
    const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
    const oldest = pageRows[pageRows.length - 1];

    return {
      items: pageRows.map(toChatMessageView).reverse(),
      next_before: hasMore && oldest ? encodeChatCursor(oldest) : null
    };
  }

  async send(
    bookingId: string,
    user: ChatUser,
    rawBody: unknown
  ): Promise<ChatMessageView> {
    const role = await this.resolveRole(bookingId, user);
    const body = normalizeChatBody(rawBody);
    const row = await this.repository.insertMessage({
      bookingId,
      senderId: user.id,
      senderRole: role,
      body
    });
    return toChatMessageView(row);
  }

  /**
   * Tanda baca memakai otorisasi yang sama persis dengan `list`: `resolveRole`
   * adalah satu-satunya jalur yang memutuskan siapa boleh menyentuh thread ini.
   *
   * Peran `admin` tidak pernah menulis tanda baca: `read_at` tidak bisa diubah
   * setelah terisi (trigger migrasi 039), jadi admin yang membuka thread akan
   * memalsukan "sudah dibaca" untuk pelanggan dan vendor sekaligus. Resepnya
   * tetap 200 dengan daftar kosong supaya klien admin tidak perlu berubah.
   *
   * `now` bisa diinjeksi supaya test deterministik; produksi memakai jam proses,
   * bukan `now()` SQL, sehingga nilai yang dikembalikan sama dengan yang ditulis.
   */
  async markRead(
    bookingId: string,
    user: ChatUser,
    now: Date = new Date()
  ): Promise<ChatReadReceipt> {
    const role = await this.resolveRole(bookingId, user);
    if (role === 'admin') {
      return { read_ids: [], read_at: now.toISOString() };
    }
    const result = await this.repository.markRead(bookingId, user.id, now);
    return {
      read_ids: result.read_ids,
      read_at: result.read_at.toISOString()
    };
  }
}
