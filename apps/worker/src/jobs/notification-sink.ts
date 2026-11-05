import { planNotification } from '@tarlink/modules/notifications';
import { query } from '../db';
import type { MessageSink, OutboxMessage } from './outbox';

interface BookingRecipients {
  customer_id: string | null;
  vendor_owner_id: string | null;
}

const RECIPIENTS_SQL = `
SELECT b.customer_id::text        AS customer_id,
       v.owner_user_id::text      AS vendor_owner_id
  FROM bookings b
  JOIN vendors v ON v.id = b.vendor_id
 WHERE b.id = $1
`;

const INSERT_SQL = `
INSERT INTO notifications (user_id, type, title, body, payload, dedupe_key)
VALUES ($1, $2, $3, $4, $5::jsonb, $6)
ON CONFLICT (dedupe_key) DO NOTHING
`;

/**
 * In-app delivery. Replaces the WhatsApp/push stub: every booking event a
 * person must see becomes one `notifications` row per recipient.
 *
 * Idempotency: `dedupe_key = outbox:<message id>:<user id>`. A retried relay
 * re-runs the insert and the unique index swallows it.
 */
export class NotificationSink implements MessageSink {
  async send(message: OutboxMessage): Promise<void> {
    const plan = planNotification(message.event_type, message.payload);
    if (!plan) return;

    const bookingId = message.payload.booking_id;
    if (typeof bookingId !== 'string' || bookingId.length === 0) return;

    const rows = await query<BookingRecipients>(RECIPIENTS_SQL, [bookingId]);
    const recipients = rows[0];
    if (!recipients) return;

    const userIds = new Set<string>();
    if (plan.audience !== 'vendor' && recipients.customer_id) {
      userIds.add(recipients.customer_id);
    }
    if (plan.audience !== 'customer' && recipients.vendor_owner_id) {
      userIds.add(recipients.vendor_owner_id);
    }

    for (const userId of userIds) {
      await query(INSERT_SQL, [
        userId,
        message.event_type,
        plan.title,
        plan.body,
        JSON.stringify(message.payload),
        `outbox:${message.id}:${userId}`
      ]);
    }
  }
}
