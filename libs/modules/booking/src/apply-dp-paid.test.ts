import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';

/**
 * The transaction runner is replaced by a double that THROWS when it is
 * called: `applyDpPaid(input, client)` must join the caller's transaction and
 * must never open one of its own (the payment webhook already holds
 * `SELECT ... FOR UPDATE` on the booking row).
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
const NOW = new Date('2026-11-01T02:00:00.000Z');
const DP_AMOUNT = 4_025_000n;

/** 2026-12-05 night, WIB (UTC+07:00) -> 17:00 … 23:59:59. */
const EXPECTED_START = new Date('2026-12-05T10:00:00.000Z');
const EXPECTED_END = new Date('2026-12-05T16:59:59.000Z');
const EXPECTED_DISPUTE_WINDOW = new Date('2026-12-12T16:59:59.000Z');

interface RecordedQuery {
  text: string;
  values: unknown[];
}

function bookingRow(): BookingRow {
  return {
    id: BOOKING_ID,
    code: 'BK-261101-AB12',
    customer_id: '33333333-3333-4333-8333-333333333333',
    vendor_id: VENDOR_ID,
    event_id: '44444444-4444-4444-8444-444444444444',
    package_id: '55555555-5555-4555-8555-555555555555',
    lifecycle_status: 'accepted',
    payment_status: 'unpaid',
    settlement_status: 'not_eligible',
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
    total_customer_idr: '4040000',
    dp_amount_idr: DP_AMOUNT.toString(),
    vendor_entitlement_idr: '3600000',
    pricing_snapshot: {},
    policy_version_id: '66666666-6666-4666-8666-666666666666',
    respond_deadline: new Date('2026-11-02T02:00:00.000Z'),
    counter_deadline: null,
    payment_deadline: new Date('2026-11-02T02:00:00.000Z'),
    scheduled_start_at: null,
    scheduled_end_at: null,
    checkin_at: null,
    confirmed_at: null,
    started_at: null,
    completed_at: null,
    cancelled_at: null,
    cancel_reason: null,
    no_show_at: null,
    released_at: null,
    dispute_window_ends_at: null,
    started_without_checkin: false,
    row_version: 1,
    created_at: new Date('2026-11-01T01:00:00.000Z'),
    updated_at: new Date('2026-11-01T01:00:00.000Z')
  };
}

function slotRow() {
  return {
    date: '2026-12-05',
    session: 'night',
    is_blocking: true,
    start_time: null,
    end_time: null
  };
}

/** A PoolClient double that records every statement it receives. */
function fakeClient(): PoolClient & { queries: RecordedQuery[] } {
  const queries: RecordedQuery[] = [];

  const client = {
    queries,
    async query(text: string, values: unknown[] = []) {
      queries.push({ text, values });

      if (text.includes('FROM bookings')) {
        return { rows: [bookingRow()], rowCount: 1 };
      }
      if (text.includes('FROM booking_slots')) {
        return { rows: [slotRow()], rowCount: 1 };
      }
      if (text.trimStart().startsWith('UPDATE bookings')) {
        return {
          rows: [
            {
              ...bookingRow(),
              lifecycle_status: 'confirmed',
              payment_status: 'dp_paid',
              settlement_status: 'held',
              scheduled_start_at: EXPECTED_START,
              scheduled_end_at: EXPECTED_END,
              confirmed_at: NOW,
              dispute_window_ends_at: EXPECTED_DISPUTE_WINDOW,
              row_version: 2
            }
          ],
          rowCount: 1
        };
      }
      return { rows: [], rowCount: 1 };
    }
  };

  return client as unknown as PoolClient & { queries: RecordedQuery[] };
}

function service(): BookingService {
  return new BookingService(new BookingRepository(), new CalendarService(new CalendarRepository()));
}

function findQuery(queries: RecordedQuery[], needle: string): RecordedQuery | undefined {
  return queries.find((entry) => entry.text.includes(needle));
}

describe('applyDpPaid with a caller transaction', () => {
  beforeEach(() => {
    vi.mocked(withTransaction).mockClear();
  });

  it('does not open a transaction of its own', async () => {
    const client = fakeClient();

    await service().applyDpPaid(
      { bookingId: BOOKING_ID, amountIdr: DP_AMOUNT, now: NOW },
      client
    );

    expect(withTransaction).not.toHaveBeenCalled();
  });

  it('runs every statement on the given client', async () => {
    const client = fakeClient();

    await service().applyDpPaid(
      { bookingId: BOOKING_ID, amountIdr: DP_AMOUNT, now: NOW },
      client
    );

    const texts = client.queries.map((entry) => entry.text);
    expect(texts.some((text) => text.includes('FROM bookings'))).toBe(true);
    expect(texts.some((text) => text.includes('FROM booking_slots'))).toBe(true);
    expect(texts.some((text) => text.includes('UPDATE bookings'))).toBe(true);
    expect(texts.some((text) => text.includes('UPDATE calendar_slots'))).toBe(true);
    expect(texts.some((text) => text.includes('UPDATE booking_slots'))).toBe(true);
    expect(texts.some((text) => text.includes('INSERT INTO booking_status_history'))).toBe(true);
    expect(texts.some((text) => text.includes('INSERT INTO outbox_messages'))).toBe(true);
  });

  it('writes the three axes, the scheduled window and the dispute window', async () => {
    const client = fakeClient();

    await service().applyDpPaid(
      { bookingId: BOOKING_ID, amountIdr: DP_AMOUNT, now: NOW },
      client
    );

    const update = findQuery(client.queries, 'UPDATE bookings');
    expect(update).toBeDefined();
    expect(update?.values[0]).toBe('confirmed');
    expect(update?.values[1]).toBe('dp_paid');
    expect(update?.values[2]).toBe('held');
    expect(update?.values[3]).toEqual(EXPECTED_START);
    expect(update?.values[4]).toEqual(EXPECTED_END);
    expect(update?.values[5]).toEqual(NOW);
    expect(update?.values[6]).toEqual(EXPECTED_DISPUTE_WINDOW);
    expect(update?.values[7]).toBe(BOOKING_ID);
  });

  it('writes one history row per changed axis', async () => {
    const client = fakeClient();

    await service().applyDpPaid(
      { bookingId: BOOKING_ID, amountIdr: DP_AMOUNT, now: NOW },
      client
    );

    const history = client.queries.filter((entry) =>
      entry.text.includes('INSERT INTO booking_status_history')
    );
    expect(history).toHaveLength(3);
    expect(history.map((entry) => entry.values.slice(1, 4))).toEqual([
      ['lifecycle', 'accepted', 'confirmed'],
      ['payment', 'unpaid', 'dp_paid'],
      ['settlement', 'not_eligible', 'held']
    ]);
    for (const entry of history) {
      expect(entry.values[4]).toBe('payment.dp_succeeded');
      // A system action has no user_role actor.
      expect(entry.values[5]).toBeNull();
      expect(entry.values[6]).toBeNull();
    }
  });

  it('enqueues the booking.confirmed outbox message', async () => {
    const client = fakeClient();

    await service().applyDpPaid(
      { bookingId: BOOKING_ID, amountIdr: DP_AMOUNT, now: NOW },
      client
    );

    const outbox = findQuery(client.queries, 'INSERT INTO outbox_messages');
    expect(outbox).toBeDefined();
    expect(outbox?.values[0]).toBe(BOOKING_ID);
    expect(outbox?.values[2]).toBe('booking.confirmed');
    expect(outbox?.values[4]).toBe(`booking.confirmed:${BOOKING_ID}`);

    const payload = JSON.parse(String(outbox?.values[3])) as Record<string, unknown>;
    expect(payload.lifecycle_status).toBe('confirmed');
    expect(payload.payment_status).toBe('dp_paid');
    expect(payload.settlement_status).toBe('held');
    expect(payload.scheduled_end_at).toBe(EXPECTED_END.toISOString());
  });

  it('flips the calendar slots to booked', async () => {
    const client = fakeClient();

    await service().applyDpPaid(
      { bookingId: BOOKING_ID, amountIdr: DP_AMOUNT, now: NOW },
      client
    );

    const calendar = findQuery(client.queries, 'UPDATE calendar_slots');
    expect(calendar?.text).toContain("status = 'booked'");
    expect(calendar?.values).toEqual([VENDOR_ID, BOOKING_ID]);

    const slots = findQuery(client.queries, 'UPDATE booking_slots');
    expect(slots?.text).toContain('is_blocking = true');
  });

  it('rejects a DP amount that does not match dp_amount_idr', async () => {
    const client = fakeClient();

    await expect(
      service().applyDpPaid({ bookingId: BOOKING_ID, amountIdr: 1n, now: NOW }, client)
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(withTransaction).not.toHaveBeenCalled();
  });
});

describe('applyDpPaid without a client', () => {
  beforeEach(() => {
    vi.mocked(withTransaction).mockClear();
  });

  it('opens its own transaction', async () => {
    const client = fakeClient();
    vi.mocked(withTransaction).mockImplementationOnce(
      async (fn: (tx: PoolClient) => Promise<unknown>) => fn(client) as never
    );

    await service().applyDpPaid({ bookingId: BOOKING_ID, amountIdr: DP_AMOUNT, now: NOW });

    expect(withTransaction).toHaveBeenCalledTimes(1);
    const update = findQuery(client.queries, 'UPDATE bookings');
    expect(update?.values[0]).toBe('confirmed');
    expect(update?.values[2]).toBe('held');
    expect(findQuery(client.queries, 'INSERT INTO outbox_messages')).toBeDefined();
  });
});

describe('BookingStatePort', () => {
  it('is satisfied by the booking service', () => {
    const port: BookingStatePort = service();
    expect(typeof port.applyDpPaid).toBe('function');
  });
});
