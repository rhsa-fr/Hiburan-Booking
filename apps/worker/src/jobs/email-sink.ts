import { planEmailNotification } from '@tarlink/modules/notifications';
import type { EmailTransport } from '@tarlink/platform/email';
import type { QueryResultRow } from 'pg';
import { query } from '../db';
import { errorMessage, logLine } from '../log';
import type { MessageSink, OutboxMessage } from './outbox';

/**
 * FR-051: outbound delivery for booking events.
 *
 * The in-app relay (`notification-sink.ts`) already writes one row per
 * recipient. This sink adds the channel a person still sees when the app is
 * closed: email, through the provider configured by `EMAIL_API_URL`.
 *
 * Guarantees:
 * 1. At most one email per (outbox message, recipient). The claim row in
 *    `notification_deliveries` is inserted with `ON CONFLICT` and only a
 *    `failed` row (or a stale `sending` row older than 10 minutes) can be
 *    claimed again.
 * 2. One failing recipient never blocks the others: every recipient is
 *    attempted, then the sink throws so the outbox retries the message. Already
 *    `sent` recipients are skipped on that retry.
 * 3. A missing email address is skipped, not an error: OTP-by-email is
 *    optional and a phone-only account is valid.
 * 4. Logs never contain the address, the subject, or the body.
 */

export interface EmailRecipientRow extends QueryResultRow {
  customer_id: string | null;
  vendor_owner_id: string | null;
  customer_email: string | null;
  vendor_email: string | null;
}

export interface DeliveryClaimRow extends QueryResultRow {
  id: string;
}

/** Narrow view of the DB so the sink stays unit-testable without Postgres. */
export interface EmailSinkDatabase {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[]
  ): Promise<T[]>;
}

const RECIPIENTS_SQL = `
SELECT b.customer_id::text   AS customer_id,
       v.owner_user_id::text AS vendor_owner_id,
       cu.email              AS customer_email,
       vu.email              AS vendor_email
  FROM bookings b
  JOIN vendors v ON v.id = b.vendor_id
  LEFT JOIN users cu ON cu.id = b.customer_id AND cu.status <> 'deleted'
  LEFT JOIN users vu ON vu.id = v.owner_user_id AND vu.status <> 'deleted'
 WHERE b.id = $1::uuid
`;

/**
 * `sending` older than 10 minutes belongs to a dead worker: reclaim it so a
 * crash between claim and provider call cannot lose the email forever.
 */
const CLAIM_SQL = `
INSERT INTO notification_deliveries (channel, outbox_message_id, user_id, status)
VALUES ('email', $1::uuid, $2::uuid, 'sending')
ON CONFLICT (channel, outbox_message_id, user_id) DO UPDATE
   SET status = 'sending',
       attempts = notification_deliveries.attempts + 1,
       last_error = NULL,
       updated_at = now()
 WHERE notification_deliveries.status = 'failed'
    OR (notification_deliveries.status = 'sending'
        AND notification_deliveries.updated_at < now() - interval '10 minutes')
RETURNING id
`;

const MARK_SENT_SQL = `
UPDATE notification_deliveries
   SET status = 'sent',
       sent_at = now(),
       updated_at = now(),
       last_error = NULL
 WHERE id = $1::uuid
`;

const MARK_FAILED_SQL = `
UPDATE notification_deliveries
   SET status = 'failed',
       last_error = $2,
       updated_at = now()
 WHERE id = $1::uuid
`;

interface Recipient {
  userId: string;
  email: string;
}

export class EmailNotificationSink implements MessageSink {
  constructor(
    private readonly transport: EmailTransport,
    private readonly db: EmailSinkDatabase = { query }
  ) {}

  async send(message: OutboxMessage): Promise<void> {
    const plan = planEmailNotification(message.event_type, message.payload);
    if (!plan) return;

    const bookingId = message.payload.booking_id;
    if (typeof bookingId !== 'string' || bookingId.length === 0) return;

    const rows = await this.db.query<EmailRecipientRow>(RECIPIENTS_SQL, [bookingId]);
    const recipients = this.recipientsFor(rows[0], plan.audience);
    if (recipients.length === 0) return;

    const failures: string[] = [];
    for (const recipient of recipients) {
      const claim = await this.db.query<DeliveryClaimRow>(CLAIM_SQL, [
        message.id,
        recipient.userId
      ]);
      const deliveryId = claim[0]?.id;
      if (!deliveryId) continue; // already sent, or claimed by a live worker

      try {
        await this.transport.sendEmail({
          to: recipient.email,
          subject: plan.subject,
          text: plan.text
        });
        await this.db.query(MARK_SENT_SQL, [deliveryId]);
        logLine(
          `email_sent message=${message.id} user=${recipient.userId} event=${message.event_type}`
        );
      } catch (err) {
        const reason = errorMessage(err);
        failures.push(reason);
        try {
          await this.db.query(MARK_FAILED_SQL, [deliveryId, reason]);
        } catch (updateErr) {
          logLine(
            `email_delivery_mark_failed_error message=${message.id} error=${errorMessage(updateErr)}`
          );
        }
        logLine(
          `email_failed message=${message.id} user=${recipient.userId} event=${message.event_type} error=${reason}`
        );
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `email delivery failed for ${failures.length} of ${recipients.length} recipient(s): ${failures[0]}`
      );
    }
  }

  private recipientsFor(
    row: EmailRecipientRow | undefined,
    audience: 'customer' | 'vendor' | 'both'
  ): Recipient[] {
    if (!row) return [];
    const recipients: Recipient[] = [];
    if (audience !== 'vendor' && row.customer_id && row.customer_email) {
      recipients.push({ userId: row.customer_id, email: row.customer_email });
    }
    if (audience !== 'customer' && row.vendor_owner_id && row.vendor_email) {
      recipients.push({ userId: row.vendor_owner_id, email: row.vendor_email });
    }
    return recipients;
  }
}
