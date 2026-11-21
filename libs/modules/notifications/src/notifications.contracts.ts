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

/**
 * Mirrors the `device_tokens.platform` CHECK constraint (migration 038).
 * The platform is stored but never trusted for routing: a token is sent to
 * whatever devices are registered for the account.
 */
export const DEVICE_PLATFORMS = ['android', 'ios', 'web'] as const;

export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

export const REGISTER_DEVICE_BODY = z.object({
  // FCM tokens are opaque and long; bounds stop a client from storing blobs.
  token: z.string().min(10).max(4096),
  platform: z.enum(DEVICE_PLATFORMS)
});

export type RegisterDeviceBody = z.infer<typeof REGISTER_DEVICE_BODY>;

/** Path parameter of `DELETE /v1/devices/:token` (already URL-decoded by Nest). */
export const DEVICE_TOKEN_PARAM = z.string().min(10).max(4096);

export interface DeviceRegistrationResult {
  readonly registered: true;
}

export interface DeviceRemovalResult {
  readonly removed: boolean;
}

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
