import { z } from 'zod';

/** Who is speaking in a thread, derived from the booking relationship. */
export type ChatRole = 'customer' | 'vendor' | 'admin';

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
}

export interface ChatMessagePage {
  readonly items: ChatMessageView[];
  /** Cursor for the next older page, or null when the thread start was reached. */
  readonly next_before: string | null;
}
