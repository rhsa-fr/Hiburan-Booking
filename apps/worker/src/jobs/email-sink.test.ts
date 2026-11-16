import type { QueryResultRow } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import type { EmailTransport } from '@tarlink/platform/email';
import { EmailNotificationSink, type EmailSinkDatabase } from './email-sink';
import type { OutboxMessage } from './outbox';

const BOOKING_ID = '22222222-2222-2222-2222-222222222222';
const CUSTOMER_ID = '33333333-3333-3333-3333-333333333333';
const VENDOR_ID = '44444444-4444-4444-4444-444444444444';

const message = (overrides: Partial<OutboxMessage> = {}): OutboxMessage => ({
  id: '11111111-1111-1111-1111-111111111111',
  aggregate_type: 'booking',
  aggregate_id: BOOKING_ID,
  event_type: 'booking.accepted',
  payload: { booking_id: BOOKING_ID, code: 'BK-261105-0001' },
  attempts: 0,
  ...overrides
});

type Handler = (text: string, params: readonly unknown[]) => QueryResultRow[];

class FakeDb implements EmailSinkDatabase {
  readonly calls: { text: string; params: readonly unknown[] }[] = [];

  constructor(private readonly handler: Handler) {}

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: readonly unknown[] = []
  ): Promise<T[]> {
    this.calls.push({ text, params });
    return this.handler(text, params) as T[];
  }

  queriesContaining(fragment: string): { text: string; params: readonly unknown[] }[] {
    return this.calls.filter((call) => call.text.includes(fragment));
  }
}

const recipientRow = (
  overrides: Partial<{ customer_email: string | null; vendor_email: string | null }> = {}
) => ({
  customer_id: CUSTOMER_ID,
  vendor_owner_id: VENDOR_ID,
  customer_email: 'pelanggan@example.com',
  vendor_email: 'vendor@example.com',
  ...overrides
});

function dbWithRecipients(row: unknown, claimId: string | null = 'delivery-1'): FakeDb {
  return new FakeDb((text) => {
    if (text.includes('FROM bookings b')) return row ? [row as QueryResultRow] : [];
    if (text.includes('INSERT INTO notification_deliveries')) {
      return claimId ? [{ id: claimId }] : [];
    }
    return [];
  });
}

function recordingTransport(
  behaviour: (message: { to: string }) => void = () => undefined
): EmailTransport & { sent: { to: string; subject: string }[] } {
  const sent: { to: string; subject: string }[] = [];
  return {
    sent,
    async sendEmail(input) {
      behaviour(input);
      sent.push({ to: input.to, subject: input.subject });
    }
  };
}

describe('EmailNotificationSink', () => {
  it('emails the customer for a customer-only event and records the claim', async () => {
    const db = dbWithRecipients(recipientRow());
    const transport = recordingTransport();

    await new EmailNotificationSink(transport, db).send(message());

    expect(transport.sent).toEqual([
      { to: 'pelanggan@example.com', subject: 'Pesanan diterima vendor — BK-261105-0001' }
    ]);
    expect(db.queriesContaining("status = 'sent'")).toHaveLength(1);
    // Claim happens before the provider call so a crash cannot resend.
    const claimIndex = db.calls.findIndex((call) =>
      call.text.includes('INSERT INTO notification_deliveries')
    );
    expect(claimIndex).toBe(1);
    expect(db.calls[claimIndex]?.params).toEqual([message().id, CUSTOMER_ID]);
  });

  it('emails both sides for a both-audience event', async () => {
    const db = dbWithRecipients(recipientRow());
    const transport = recordingTransport();

    await new EmailNotificationSink(transport, db).send(
      message({ event_type: 'booking.confirmed', payload: { booking_id: BOOKING_ID, code: 'BK-1' } })
    );

    expect(transport.sent.map((mail) => mail.to)).toEqual([
      'pelanggan@example.com',
      'vendor@example.com'
    ]);
    expect(db.queriesContaining('INSERT INTO notification_deliveries')).toHaveLength(2);
  });

  it('skips recipients without an email address', async () => {
    const db = dbWithRecipients(recipientRow({ vendor_email: null }));
    const transport = recordingTransport();

    await new EmailNotificationSink(transport, db).send(
      message({ event_type: 'booking.requested' })
    );

    // `booking.requested` is vendor-audience; without a vendor email there is
    // nothing to send at all.
    expect(transport.sent).toHaveLength(0);
    expect(db.queriesContaining('INSERT INTO notification_deliveries')).toHaveLength(0);
  });

  it('does not resend when the claim is already held or sent', async () => {
    const db = dbWithRecipients(recipientRow(), null);
    const transport = recordingTransport();

    await new EmailNotificationSink(transport, db).send(message());

    expect(transport.sent).toHaveLength(0);
    expect(db.queriesContaining("SET status = 'sent'")).toHaveLength(0);
  });

  it('ignores events that are not user-facing', async () => {
    const db = dbWithRecipients(recipientRow());
    const transport = recordingTransport();

    await new EmailNotificationSink(transport, db).send(
      message({ event_type: 'payment.dp_succeeded' })
    );

    expect(db.calls).toHaveLength(0);
    expect(transport.sent).toHaveLength(0);
  });

  it('ignores a payload without a booking id', async () => {
    const db = dbWithRecipients(recipientRow());
    const transport = recordingTransport();

    await new EmailNotificationSink(transport, db).send(
      message({ payload: { code: 'BK-1' } })
    );

    expect(db.calls).toHaveLength(0);
  });

  it('marks a failed delivery and still attempts the other recipient', async () => {
    const db = dbWithRecipients(recipientRow());
    const transport = recordingTransport((input) => {
      if (input.to === 'pelanggan@example.com') throw new Error('smtp down');
    });

    await expect(
      new EmailNotificationSink(transport, db).send(
        message({ event_type: 'booking.fully_paid' })
      )
    ).rejects.toThrow(/email delivery failed for 1 of 2 recipient\(s\): smtp down/);

    expect(transport.sent.map((mail) => mail.to)).toEqual(['vendor@example.com']);
    const failed = db.queriesContaining("SET status = 'failed'");
    expect(failed).toHaveLength(1);
    expect(failed[0]?.params?.[1]).toBe('smtp down');
    expect(db.queriesContaining("status = 'sent'")).toHaveLength(1);
  });

  it('does nothing when the booking row is gone instead of crashing the tick', async () => {
    const db = dbWithRecipients(null);
    const transport = recordingTransport();

    await expect(new EmailNotificationSink(transport, db).send(message())).resolves.toBeUndefined();
    expect(transport.sent).toHaveLength(0);
  });
});
