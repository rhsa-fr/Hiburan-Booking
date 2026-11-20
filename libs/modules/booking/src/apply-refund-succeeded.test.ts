import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';

/**
 * `applyRefundSucceeded(input, client)` must join the caller's transaction (the
 * refund finalize already holds the booking lock and posts the journals), never
 * open its own.
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
import { BookingService } from './booking.service';

const BOOKING_ID = '11111111-1111-4111-8111-111111111111';
const VENDOR_ID = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-11-20T02:00:00.000Z');
const AMOUNT = 1_650_000n;

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
    price_package_idr: '5000000',
    price_addons_idr: '0',
    price_transport_idr: '0',
    service_fee_idr: '50000',
    discount_idr: '0',
    commission_bp: 1000,
    commission_threshold_idr: '10000000',
    commission_bp_tier2: 500,
    commission_min_idr: '25000',
    commission_cap_idr: '7500000',
    commission_tier1_idr: '500000',
    commission_tier2_idr: '0',
    commission_idr: '500000',
    total_customer_idr: '5555000',
    dp_amount_idr: '1650000',
    vendor_entitlement_idr: '4500000',
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
          rows: [{ ...row, row_version: row.row_version + 1 }],
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

describe('applyRefundSucceeded', () => {
  beforeEach(() => {
    vi.mocked(withTransaction).mockClear();
  });

  it('moves dp_paid to partially_refunded when the booking is still open', async () => {
    const client = fakeClient();

    await service().applyRefundSucceeded(
      { bookingId: BOOKING_ID, amountIdr: AMOUNT, isFullRefund: false, now: NOW },
      client
    );

    const update = findQuery(client.queries, 'UPDATE bookings');
    expect(update).toBeDefined();
    expect(update?.values[0]).toBe('partially_refunded');
    expect(update?.values[1]).toBe('held');
    expect(update?.values[2]).toBe(BOOKING_ID);

    const history = client.queries.filter((entry) =>
      entry.text.includes('INSERT INTO booking_status_history')
    );
    expect(history).toHaveLength(1);
    expect(history[0]?.values.slice(1, 5)).toEqual([
      'payment',
      'dp_paid',
      'partially_refunded',
      'payment.refund_succeeded_partial'
    ]);
  });

  it('closes a completed booking inside the dispute window as refunded', async () => {
    const client = fakeClient(
      bookingRow({ lifecycle_status: 'completed', payment_status: 'fully_paid' })
    );

    await service().applyRefundSucceeded(
      { bookingId: BOOKING_ID, amountIdr: 5_555_000n, isFullRefund: true, now: NOW },
      client
    );

    const update = findQuery(client.queries, 'UPDATE bookings');
    expect(update?.values[0]).toBe('refunded');
    expect(update?.values[1]).toBe('not_eligible');
    expect(update?.values[2]).toBe(BOOKING_ID);

    const history = client.queries.filter((entry) =>
      entry.text.includes('INSERT INTO booking_status_history')
    );
    expect(history[0]?.values[4]).toBe('payment.refund_succeeded');
  });

  it('keeps a released booking at partially_refunded instead of refunded', async () => {
    const client = fakeClient(
      bookingRow({
        lifecycle_status: 'completed',
        payment_status: 'fully_paid',
        settlement_status: 'released'
      })
    );

    await service().applyRefundSucceeded(
      { bookingId: BOOKING_ID, amountIdr: 1_650_000n, isFullRefund: true, now: NOW },
      client
    );

    const update = findQuery(client.queries, 'UPDATE bookings');
    expect(update?.values[0]).toBe('partially_refunded');
    expect(update?.values[1]).toBe('released');
    expect(update?.values[2]).toBe(BOOKING_ID);
  });

  it('is idempotent once the booking is already refunded', async () => {
    const client = fakeClient(
      bookingRow({ lifecycle_status: 'cancelled', payment_status: 'refunded' })
    );

    await service().applyRefundSucceeded(
      { bookingId: BOOKING_ID, amountIdr: AMOUNT, isFullRefund: true, now: NOW },
      client
    );

    expect(findQuery(client.queries, 'UPDATE bookings')).toBeUndefined();
  });

  it('does not open a transaction of its own', async () => {
    const client = fakeClient();

    await service().applyRefundSucceeded(
      { bookingId: BOOKING_ID, amountIdr: AMOUNT, isFullRefund: false, now: NOW },
      client
    );

    expect(withTransaction).not.toHaveBeenCalled();
  });
});
