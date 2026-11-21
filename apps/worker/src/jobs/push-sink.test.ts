import type { QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { OutboxMessage } from './outbox';
import {
  PushSink,
  type PushMessage,
  type PushSinkDatabase,
  type PushBatchResult,
  type PushMessenger
} from './push-sink';

const BOOKING_ID = '22222222-2222-2222-2222-222222222222';
const CUSTOMER_ID = '33333333-3333-3333-3333-333333333333';
const VENDOR_ID = '44444444-4444-4444-4444-444444444444';
const MESSAGE_ID = '11111111-1111-1111-1111-111111111111';

const message = (overrides: Partial<OutboxMessage> = {}): OutboxMessage => ({
  id: MESSAGE_ID,
  aggregate_type: 'booking',
  aggregate_id: BOOKING_ID,
  event_type: 'booking.accepted',
  payload: { booking_id: BOOKING_ID, code: 'BK-261105-0001' },
  attempts: 0,
  ...overrides
});

type Handler = (text: string, params: readonly unknown[]) => QueryResultRow[];

class FakeDb implements PushSinkDatabase {
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

interface DbOptions {
  tokens?: Partial<Record<'customer' | 'vendor', string[]>>;
  claimId?: string | null;
}

const recipientRow = { customer_id: CUSTOMER_ID, vendor_owner_id: VENDOR_ID };

function dbWith(options: DbOptions = {}): FakeDb {
  const customerTokens = options.tokens?.customer ?? ['customer-token-1'];
  const vendorTokens = options.tokens?.vendor ?? ['vendor-token-1'];
  const claimId = options.claimId === undefined ? 'delivery-1' : options.claimId;

  return new FakeDb((text, params) => {
    if (text.includes('FROM bookings b')) return [recipientRow as QueryResultRow];
    if (text.includes('FROM device_tokens')) {
      const userId = params[0];
      const list = userId === CUSTOMER_ID ? customerTokens : userId === VENDOR_ID ? vendorTokens : [];
      return list.map((token) => ({ token }) as QueryResultRow);
    }
    if (text.includes('INSERT INTO notification_deliveries')) {
      return claimId ? [{ id: claimId } as QueryResultRow] : [];
    }
    return [];
  });
}

/** Records every multicast call and answers with a caller-supplied batch. */
function recordingMessenger(
  answer: (message: PushMessage) => PushBatchResult = (message) => ({
    successCount: message.tokens.length,
    responses: message.tokens.map(() => ({ success: true }))
  })
): PushMessenger & { sent: PushMessage[] } {
  const sent: PushMessage[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
      return answer(message);
    }
  };
}

describe('PushSink', () => {
  it('is a no-op when Firebase is not configured: no claim, no send, no throw', async () => {
    const db = dbWith();

    await expect(new PushSink({ db }).send(message())).resolves.toBeUndefined();

    // An unconfigured sink never even reads the DB, so no claim row can exist
    // and the in-app/email channels keep working.
    expect(db.calls).toHaveLength(0);
  });

  it('sends one push per recipient with the planned copy and string data', async () => {
    const db = dbWith();
    const messenger = recordingMessenger();

    await new PushSink({ db, messenger }).send(
      message({ event_type: 'booking.confirmed', payload: { booking_id: BOOKING_ID, code: 'BK-1' } })
    );

    // `booking.confirmed` is both-audience.
    expect(messenger.sent).toHaveLength(2);
    for (const push of messenger.sent) {
      expect(push.title.length).toBeGreaterThan(0);
      expect(push.body).toContain('BK-1');
      expect(push.data).toEqual({ type: 'booking.confirmed', booking_id: BOOKING_ID });
      for (const value of Object.values(push.data)) {
        expect(typeof value).toBe('string');
      }
    }

    // Claim happens before the provider call so a crash cannot resend.
    const claimIndex = db.calls.findIndex((call) =>
      call.text.includes('INSERT INTO notification_deliveries')
    );
    expect(claimIndex).toBeGreaterThan(-1);
    expect(db.calls[claimIndex]?.params).toEqual([MESSAGE_ID, CUSTOMER_ID]);
    expect(db.queriesContaining("status = 'sent'")).toHaveLength(2);
  });

  it('does not send twice when the outbox message is relayed again', async () => {
    const db = dbWith({ claimId: null });
    const messenger = recordingMessenger();

    await new PushSink({ db, messenger }).send(message());

    // The claim was attempted but the UNIQUE (channel, message, user) row was
    // already `sent`, so nothing is handed to Firebase.
    expect(db.queriesContaining('INSERT INTO notification_deliveries').length).toBeGreaterThan(0);
    expect(messenger.sent).toHaveLength(0);
    expect(db.queriesContaining("status = 'sent'")).toHaveLength(0);
  });

  it('deletes exactly the tokens Firebase reports as permanently invalid', async () => {
    const db = dbWith({ tokens: { customer: ['good-token', 'dead-token', 'bad-token'] } });
    const messenger = recordingMessenger((push) => ({
      successCount: push.tokens.length - 2,
      responses: push.tokens.map((token) =>
        token === 'dead-token'
          ? {
              success: false,
              error: {
                code: 'messaging/registration-token-not-registered',
                message: 'Requested entity was not found.'
              }
            }
          : token === 'bad-token'
            ? {
                success: false,
                error: { code: 'messaging/invalid-argument', message: 'Invalid token' }
              }
            : { success: true }
      )
    }));

    await new PushSink({ db, messenger }).send(message());

    const deletes = db.queriesContaining('DELETE FROM device_tokens');
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.params?.[0]).toEqual(['dead-token', 'bad-token']);
    expect(db.queriesContaining("status = 'sent'")).toHaveLength(1);
  });

  it('keeps retryable tokens and retries the delivery', async () => {
    const db = dbWith({ tokens: { customer: ['flaky-token'] } });
    const messenger = recordingMessenger(() => ({
      successCount: 0,
      responses: [
        {
          success: false,
          error: { code: 'messaging/internal-error', message: 'backend unavailable' }
        }
      ]
    }));

    await expect(new PushSink({ db, messenger }).send(message())).rejects.toThrow(
      /push delivery failed for 1 of 1 recipient\(s\): backend unavailable/
    );

    expect(db.queriesContaining('DELETE FROM device_tokens')).toHaveLength(0);
    const failed = db.queriesContaining("SET status = 'failed'");
    expect(failed).toHaveLength(1);
    expect(failed[0]?.params?.[1]).toBe('backend unavailable');
  });

  it('does not push a vendor-audience event to the customer', async () => {
    const db = dbWith();
    const messenger = recordingMessenger();

    await new PushSink({ db, messenger }).send(
      message({ event_type: 'booking.requested', payload: { booking_id: BOOKING_ID } })
    );

    expect(messenger.sent).toHaveLength(1);
    expect(messenger.sent[0]?.tokens).toEqual(['vendor-token-1']);
    const tokenQueries = db.queriesContaining('FROM device_tokens');
    expect(tokenQueries.map((call) => call.params[0])).toEqual([VENDOR_ID]);
  });

  it('skips a recipient without a registered device instead of claiming', async () => {
    const db = dbWith({ tokens: { customer: [] } });
    const messenger = recordingMessenger();

    await new PushSink({ db, messenger }).send(message());

    expect(messenger.sent).toHaveLength(0);
    expect(db.queriesContaining('INSERT INTO notification_deliveries')).toHaveLength(0);
  });

  it('ignores events that are not user-facing and payloads without a booking id', async () => {
    const db = dbWith();
    const messenger = recordingMessenger();
    const sink = new PushSink({ db, messenger });

    await sink.send(message({ event_type: 'payment.dp_succeeded' }));
    await sink.send(message({ payload: { code: 'BK-1' } }));

    expect(db.calls).toHaveLength(0);
    expect(messenger.sent).toHaveLength(0);
  });
});
