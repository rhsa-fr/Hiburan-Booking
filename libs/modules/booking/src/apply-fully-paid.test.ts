import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';

/**
 * The transaction runner is replaced by a double that THROWS when it is
 * called: `applyFullyPaid(input, client)` must join the caller's transaction
 * (the payment webhook already holds the lock and posts the journal entry).
 */
vi.mock('../../../../apps/api/src/core/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../apps/api/src/core/db')>();
  return {
    ...actual,
    withTransaction: vi.fn(async () => {
      throw new Error(
        'withTransaction() tidak boleh dipanggil saat client diberikan (harus ikut transaksi pemanggil)'
      );
    })
  };
});

import { withTransaction } from '../../../../apps/api/src/core/db';
import { CalendarRepository } from '../../calendar/src/calendar.repository';
import { CalendarService } from '../../calendar/src/calendar.service';
import { BookingRepository, type BookingRow } from './booking.repository';
import { BookingService, type BookingStatePort } from './booking.service';

const BOOKING_ID = '11111111-1111-4111-8111-111111111111';
const VENDOR_ID = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-11-20T02:00:00.000Z');

const TOTAL = 4_040_000n;
const DP = 1_200_000n;
/** total_customer_idr - dp_amount_idr */
const OUTSTANDING = TOTAL - DP;

interface RecordedQuery {
  text: string;
  values: unknown[];
}

function bookingRow(overrides: Partial<BookingRow> = {}): BookingRow {
  return {
    id: BOOKING_ID,
    code: 'BK-261101-AB12',
    customer_id: '33333333-3333-4333-8333-333333333333',
    vendor_id: VENDOR_ID,
    event_id: '44444444-4444-4444-8444-444444444444',
    package_id: '55555555-5555-4555-8555-555555555555',
    lifecycle_status: 'confirmed',
    payment_status: 'dp_paid',
    settlement_status: 'held',
    currency: 'IDR',
    price_package_idr: '4000000',
    price_addons_idr: '0',
    price_transport_idr: '0',
    service_fee_idr: '40000',
    discount_idr: '0',
    commission_bp: 1000,
    commission_threshold_idr: '10000000',
    commission_bp_tier2: 500,
    commission_min_idr: '25000',
    commission_cap_idr: '7500000',
    commission_tier1_idr: '400000',
    commission_tier2_idr: '0',
    commission_idr: '400000',
    total_customer_idr: TOTAL.toString(),
    dp_amount_idr: DP.toString(),
    vendor_entitlement_idr: '3600000',
    pricing_snapshot: {},
    policy_version_id: '66666666-6666-4666-8666-666666666666',
    respond_deadline: new Date('2026-11-02T02:00:00.000Z'),
    counter_deadline: null,
    payment_deadline: new Date('2026-11-02T02:00:00.000Z'),
    scheduled_start_at: new Date('2026-12-05T10:00:00.000Z'),
    scheduled_end_at: new Date('2026-12-05T16:59:59.000Z'),
    checkin_at: null,
    confirmed_at: new Date('2026-11-02T02:00:00.000Z'),
    started_at: null,
    completed_at: null,
    cancelled_at: null,
    cancel_reason: null,
    no_show_at: null,
    released_at: null,
    dispute_window_ends_at: new Date('2026-12-12T16:59:59.000Z'),
    started_without_checkin: false,
    row_version: 3,
    created_at: new Date('2026-11-01T01:00:00.000Z'),
    updated_at: new Date('2026-11-02T02:00:00.000Z'),
    ...overrides
  };
}

/** A PoolClient double that records every statement it receives. */
function fakeClient(row: BookingRow = bookingRow()): PoolClient & { queries: RecordedQuery[] } {
  const queries: RecordedQuery[] = [];

  const client = {
    queries,
    query: vi.fn(async (text: string, values: unknown[] = []) => {
      queries.push({ text, values });

      if (text.includes('FROM bookings')) {
        return { rows: [row], rowCount: 1 };
      }
      if (text.trimStart().startsWith('UPDATE bookings')) {
        return {
          rows: [{ ...row, payment_status: 'fully_paid', row_version: row.row_version + 1 }],
          rowCount: 1
        };
      }
      return { rows: [], rowCount: 1 };
    })
  };

  return client as unknown as PoolClient & { queries: RecordedQuery[] };
}

function service(): BookingService {
  return new BookingService(new BookingRepository(), new CalendarService(new CalendarRepository()));
}

function findQuery(queries: RecordedQuery[], needle: string): RecordedQuery | undefined {
  return queries.find((entry) => entry.text.includes(needle));
}

describe('applyFullyPaid (P-03 payment.settlement_succeeded)', () => {
  beforeEach(() => {
    vi.mocked(withTransaction).mockClear();
  });

  it('moves dp_paid to fully_paid and writes the history row', async () => {
    const client = fakeClient();

    await service().applyFullyPaid(
      { bookingId: BOOKING_ID, amountIdr: OUTSTANDING, now: NOW },
      client
    );

    const update = findQuery(client.queries, 'UPDATE bookings');
    expect(update).toBeDefined();
    expect(update?.values[0]).toBe('fully_paid');
    expect(update?.values[1]).toBe(BOOKING_ID);

    const history = client.queries.filter((entry) =>
      entry.text.includes('INSERT INTO booking_status_history')
    );
    expect(history).toHaveLength(1);
    expect(history[0]?.values.slice(1, 5)).toEqual([
      'payment',
      'dp_paid',
      'fully_paid',
      'payment.settlement_succeeded'
    ]);
    expect(history[0]?.values[5]).toBeNull();
    expect(history[0]?.values[6]).toBeNull();
  });

  it('enqueues the settlement outbox message', async () => {
    const client = fakeClient();

    await service().applyFullyPaid(
      { bookingId: BOOKING_ID, amountIdr: OUTSTANDING, now: NOW },
      client
    );

    const outbox = findQuery(client.queries, 'INSERT INTO outbox_messages');
    expect(outbox).toBeDefined();
    expect(outbox?.values[0]).toBe(BOOKING_ID);
    expect(outbox?.values[2]).toBe('booking.fully_paid');
    expect(outbox?.values[4]).toBe(`booking.fully_paid:${BOOKING_ID}`);

    const payload = JSON.parse(String(outbox?.values[3])) as Record<string, unknown>;
    expect(payload.payment_status).toBe('fully_paid');
    expect(payload.settlement_status).toBe('held');
  });

  it('never releases the funds nor recomputes the windows', async () => {
    const client = fakeClient();

    await service().applyFullyPaid(
      { bookingId: BOOKING_ID, amountIdr: OUTSTANDING, now: NOW },
      client
    );

    const update = findQuery(client.queries, 'UPDATE bookings');
    expect(update?.text).not.toContain('settlement_status');
    expect(update?.text).not.toContain('released');
    expect(update?.text).not.toContain('scheduled_start_at');
    expect(update?.text).not.toContain('scheduled_end_at');
    expect(update?.text).not.toContain('dispute_window_ends_at');

    // The calendar is untouched by the settlement payment.
    expect(findQuery(client.queries, 'UPDATE calendar_slots')).toBeUndefined();
  });

  it('does not open a transaction of its own', async () => {
    const client = fakeClient();

    await service().applyFullyPaid(
      { bookingId: BOOKING_ID, amountIdr: OUTSTANDING, now: NOW },
      client
    );

    expect(withTransaction).not.toHaveBeenCalled();
    const texts = client.queries.map((entry) => entry.text);
    expect(texts.some((text) => text.includes('FROM bookings'))).toBe(true);
    expect(texts.some((text) => text.includes('UPDATE bookings'))).toBe(true);
    expect(texts.some((text) => text.includes('INSERT INTO booking_status_history'))).toBe(true);
    expect(texts.some((text) => text.includes('INSERT INTO outbox_messages'))).toBe(true);
  });

  it('is a no-op when the booking is already fully paid', async () => {
    const client = fakeClient(bookingRow({ payment_status: 'fully_paid' }));

    await service().applyFullyPaid(
      { bookingId: BOOKING_ID, amountIdr: OUTSTANDING, now: NOW },
      client
    );

    expect(findQuery(client.queries, 'UPDATE bookings')).toBeUndefined();
    expect(findQuery(client.queries, 'INSERT INTO booking_status_history')).toBeUndefined();
    expect(findQuery(client.queries, 'INSERT INTO outbox_messages')).toBeUndefined();
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it('rejects a completed booking without allowAfterCompletion (PJP webhook path)', async () => {
    const client = fakeClient(bookingRow({ lifecycle_status: 'completed' }));

    await expect(
      service().applyFullyPaid({ bookingId: BOOKING_ID, amountIdr: OUTSTANDING, now: NOW }, client)
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(findQuery(client.queries, 'UPDATE bookings')).toBeUndefined();
    expect(findQuery(client.queries, 'INSERT INTO booking_status_history')).toBeUndefined();
  });

  it('settles a completed + dp_paid booking when allowAfterCompletion is true', async () => {
    const client = fakeClient(bookingRow({ lifecycle_status: 'completed' }));

    await service().applyFullyPaid(
      {
        bookingId: BOOKING_ID,
        amountIdr: OUTSTANDING,
        now: NOW,
        allowAfterCompletion: true
      },
      client
    );

    expect(findQuery(client.queries, 'UPDATE bookings')?.values[0]).toBe('fully_paid');
    const history = findQuery(client.queries, 'INSERT INTO booking_status_history');
    expect(history).toBeDefined();
    expect(findQuery(client.queries, 'INSERT INTO outbox_messages')?.values[2]).toBe(
      'booking.fully_paid'
    );
  });

  it('rejects a booking that is not settled yet', async () => {
    const client = fakeClient(bookingRow({ lifecycle_status: 'requested', payment_status: 'unpaid' }));

    await expect(
      service().applyFullyPaid({ bookingId: BOOKING_ID, amountIdr: OUTSTANDING, now: NOW }, client)
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(findQuery(client.queries, 'UPDATE bookings')).toBeUndefined();
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it('rejects a booking whose lifecycle cannot be settled', async () => {
    const client = fakeClient(bookingRow({ lifecycle_status: 'accepted' }));

    await expect(
      service().applyFullyPaid({ bookingId: BOOKING_ID, amountIdr: OUTSTANDING, now: NOW }, client)
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects a missing booking', async () => {
    const client = fakeClient();
    vi.mocked(client.query).mockImplementationOnce(async () => ({ rows: [], rowCount: 0 }));

    await expect(
      service().applyFullyPaid({ bookingId: BOOKING_ID, amountIdr: OUTSTANDING, now: NOW }, client)
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects an amount that does not match the outstanding balance', async () => {
    const client = fakeClient();

    await expect(
      service().applyFullyPaid({ bookingId: BOOKING_ID, amountIdr: OUTSTANDING - 1n, now: NOW }, client)
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    await expect(
      service().applyFullyPaid({ bookingId: BOOKING_ID, amountIdr: OUTSTANDING + 1n, now: NOW }, client)
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    await expect(
      service().applyFullyPaid({ bookingId: BOOKING_ID, amountIdr: 0n, now: NOW }, client)
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(findQuery(client.queries, 'UPDATE bookings')).toBeUndefined();
  });
});

describe('applyFullyPaid without a client', () => {
  beforeEach(() => {
    vi.mocked(withTransaction).mockClear();
  });

  it('opens its own transaction', async () => {
    const client = fakeClient();
    vi.mocked(withTransaction).mockImplementationOnce(
      async (fn: (tx: PoolClient) => Promise<unknown>) => fn(client) as never
    );

    await service().applyFullyPaid({ bookingId: BOOKING_ID, amountIdr: OUTSTANDING, now: NOW });

    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(findQuery(client.queries, 'UPDATE bookings')?.values[0]).toBe('fully_paid');
    expect(findQuery(client.queries, 'INSERT INTO outbox_messages')).toBeDefined();
  });
});

describe('BookingStatePort', () => {
  it('publishes both transitions', () => {
    const port: BookingStatePort = service();
    expect(typeof port.applyDpPaid).toBe('function');
    expect(typeof port.applyFullyPaid).toBe('function');
  });
});
