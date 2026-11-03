import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../apps/api/src/core/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../apps/api/src/core/db')>();
  return {
    ...actual,
    withTransaction: vi.fn(async (fn: (client: unknown) => unknown) => fn({}))
  };
});

import type { CalendarService } from '../../calendar/src/index';
import type { BookingRepository, BookingRow } from './booking.repository';
import { BookingService } from './booking.service';
import type { AuthUser } from './current-user.decorator';

const BOOKING_ID = '11111111-1111-4111-8111-111111111111';
const VENDOR_ID = '22222222-2222-4222-8222-222222222222';
const CUSTOMER_ID = '77777777-7777-4777-8777-777777777777';
const NOW = new Date('2026-11-01T12:00:00.000Z');

const VENDOR: AuthUser = { id: VENDOR_ID, roles: ['vendor_owner'] };
const CUSTOMER: AuthUser = { id: CUSTOMER_ID, roles: ['customer'] };

function confirmedRow(overrides: Partial<BookingRow> = {}): BookingRow {
  return {
    id: BOOKING_ID,
    code: 'BK-261101-AB12',
    customer_id: CUSTOMER_ID,
    vendor_id: VENDOR_ID,
    event_id: '44444444-4444-4444-8444-444444444444',
    package_id: '33333333-3333-4333-8333-333333333333',
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
    total_customer_idr: '5050000',
    dp_amount_idr: '1500000',
    vendor_entitlement_idr: '4500000',
    pricing_snapshot: {},
    policy_version_id: null,
    respond_deadline: new Date(NOW.getTime() - 24 * 60 * 60 * 1000),
    counter_deadline: null,
    payment_deadline: null,
    scheduled_start_at: new Date(NOW.getTime() - 60 * 60 * 1000),
    scheduled_end_at: new Date(NOW.getTime() + 3 * 60 * 60 * 1000),
    checkin_at: null,
    confirmed_at: new Date(NOW.getTime() - 24 * 60 * 60 * 1000),
    started_at: null,
    completed_at: null,
    cancelled_at: null,
    cancel_reason: null,
    no_show_at: null,
    released_at: null,
    dispute_window_ends_at: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
    started_without_checkin: false,
    row_version: 4,
    created_at: new Date(NOW.getTime() - 48 * 60 * 60 * 1000),
    updated_at: NOW,
    ...overrides
  };
}

function harness(initial: BookingRow) {
  let row = initial;
  const repo = {
    findByIdForUpdate: vi.fn(async () => row),
    isVendorResponder: vi.fn(async () => true),
    countOpenDisputes: vi.fn(async () => 0),
    updateStatus: vi.fn(async (_client: unknown, _id: string, patch: Record<string, unknown>) => {
      row = {
        ...row,
        ...patch,
        row_version: row.row_version + 1
      } as BookingRow;
      return row;
    }),
    insertHistory: vi.fn(async () => undefined),
    enqueueOutbox: vi.fn(async () => undefined),
    insertNoShowDispute: vi.fn(async () => undefined),
    findSlotsByBooking: vi.fn(async () => [])
  } as unknown as BookingRepository;
  const calendar = {} as CalendarService;
  return { repo, service: new BookingService(repo, calendar) };
}

describe('BookingService.checkin', () => {
  beforeEach(() => vi.clearAllMocks());

  it('moves confirmed -> in_progress and stores the optional GPS point', async () => {
    const { repo, service } = harness(confirmedRow());

    const view = await service.checkin(BOOKING_ID, { lat: -6.3, lng: 108.3 }, VENDOR, NOW);

    expect(view.lifecycle_status).toBe('in_progress');
    expect(repo.updateStatus).toHaveBeenCalledWith(
      expect.anything(),
      BOOKING_ID,
      expect.objectContaining({
        lifecycle_status: 'in_progress',
        checkin_location: 'SRID=4326;POINT(108.3 -6.3)'
      })
    );
    expect(repo.enqueueOutbox).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'booking.checked_in' })
    );
  });

  it('rejects a half-sent coordinate pair', async () => {
    const { service } = harness(confirmedRow());
    await expect(service.checkin(BOOKING_ID, { lat: -6.3 }, VENDOR, NOW)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
  });
});

describe('BookingService.noShow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marks no_show, disputes settlement, and opens the dispute row', async () => {
    const { repo, service } = harness(
      confirmedRow({
        scheduled_start_at: new Date(NOW.getTime() - 3 * 60 * 60 * 1000)
      })
    );

    const view = await service.noShow(
      BOOKING_ID,
      { reason: 'Grup tidak datang sampai acara selesai' },
      CUSTOMER,
      NOW
    );

    expect(view.lifecycle_status).toBe('no_show');
    expect(repo.updateStatus).toHaveBeenCalledWith(
      expect.anything(),
      BOOKING_ID,
      expect.objectContaining({ lifecycle_status: 'no_show', settlement_status: 'disputed' })
    );
    expect(repo.insertNoShowDispute).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ bookingId: BOOKING_ID, raisedBy: CUSTOMER_ID })
    );
  });
});
