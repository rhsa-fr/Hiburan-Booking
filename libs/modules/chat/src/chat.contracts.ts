import { z } from 'zod';

/** Who is speaking in a thread, derived from the booking relationship. */
export type ChatRole = 'customer' | 'vendor' | 'admin';

/** PostgreSQL channel shared by the NOTIFY writers and every API LISTENer. */
export const CHAT_CHANNEL = 'tarlink_chat';

export const SEND_CHAT_MESSAGE_SCHEMA = z.object({
  body: z.string().trim().min(1).max(2000)
});

export type SendChatMessageInput = z.infer<typeof SEND_CHAT_MESSAGE_SCHEMA>;

/**
 * History is cursor-based: `before` is the opaque cursor of the oldest row the
 * client already has, so a busy thread never replays pages by offset.
 */
export const LIST_CHAT_MESSAGES_QUERY = z.object({
  before: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

export type ListChatMessagesQuery = z.infer<typeof LIST_CHAT_MESSAGES_QUERY>;

export interface ChatMessageView {
  readonly id: string;
  readonly booking_id: string;
  readonly sender_id: string;
  readonly sender_role: ChatRole;
  readonly body: string;
  readonly created_at: string;
  /** When the recipient read the message; null while unread. */
  readonly read_at: string | null;
}

export interface ChatMessagePage {
  readonly items: ChatMessageView[];
  /** Cursor for the next older page, or null when the thread start was reached. */
  readonly next_before: string | null;
}

/** Response body of `POST /bookings/:bookingId/chat/messages/read`. */
export interface ChatReadReceipt {
  readonly read_ids: string[];
  /** The timestamp written to every listed message (same value for all). */
  readonly read_at: string;
}

/** One row of `GET /chats`: a booking thread with its last visible message. */
export interface ChatThreadView {
  readonly booking_id: string;
  readonly booking_code: string;
  readonly vendor_id: string;
  readonly vendor_name: string;
  readonly counterpart_name: string;
  readonly counterpart_role: 'customer' | 'vendor';
  readonly last_message: string;
  readonly last_at: string;
  readonly unread_count: number;
}

/**
 * `read` is the only NOTIFY payload that is not a stored chat row: it carries
 * ids, never message bodies, so it is safe to fan out to the whole thread.
 */
export interface ChatReadNotification {
  readonly type: 'read';
  readonly booking_id: string;
  readonly reader_id: string;
  readonly message_ids: string[];
  readonly read_at: string;
}
