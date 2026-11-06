import { z } from 'zod';

/**
 * Owner-scoped notification list. `unread_only` is an explicit enum so
 * `?unread_only=false` cannot be coerced into `true` by `z.coerce.boolean`.
 */
export const LIST_NOTIFICATIONS_QUERY = z.object({
  unread_only: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20)
});

export type ListNotificationsQuery = z.infer<typeof LIST_NOTIFICATIONS_QUERY>;

export interface NotificationView {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly body: string;
  readonly payload: Record<string, unknown>;
  readonly read_at: string | null;
  readonly created_at: string;
}

export interface NotificationPage {
  readonly items: NotificationView[];
  readonly total: number;
  readonly page: number;
  readonly page_size: number;
}
