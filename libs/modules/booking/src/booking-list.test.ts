import { describe, expect, it } from 'vitest';
import { CalendarRepository } from '../../calendar/src/calendar.repository';
import { CalendarService } from '../../calendar/src/calendar.service';
import {
  BookingRepository,
  type BookingDetailRow,
  type BookingSlotRow,
  type CustomerBookingListRow,
  type ListForCustomerOptions
} from './booking.repository';
import { BookingService } from './booking.service';
import type { AuthUser } from './current-user.decorator';
import { listBookingsQuerySchema, parseInput } from './dto';

const CUSTOMER_A = '11111111-1111-4111-8111-111111111111';
const CUSTOMER_B = '22222222-2222-4222-8222-222222222222';
const BOOKING_ID = '33333333-3333-4333-8333-333333333333';
const VENDOR_ID = '44444444-4444-4444-8444-444444444444';
const PACKAGE_ID = '55555555-5555-4555-8555-555555555555';
const EVENT_ID = '66666666-6666-4666-8666-666666666666';

const CUSTOMER: AuthUser = { id: CUSTOMER_A, roles: ['customer'] };

function listRow(overrides: Partial<CustomerBookingListRow> = {}): CustomerBookingListRow {
  return {
    id: BOOKING_ID,
    code: 'BK-261021-F1FA',
    lifecycle_status: 'requested',
    payment_status: 'unpaid',
    settlement_status: 'not_eligible',
    vendor_id: VENDOR_ID,
    package_id: PACKAGE_ID,
    total_customer_idr: '5050000',
    dp_amount_idr: '1500000',
    vendor_slug: 'tarling-dian',
    vendor_display_name: 'Tarling Dangdut Dian',
    package_name: 'Paket 6 jam',
    slot_date: '2026-12-05',
    slot_session: 'day',
    created_at: new Date('2026-10-21T10:00:00.000Z'),
    updated_at: new Date('2026-10-21T10:05:00.000Z'),
    total_count: 4,
    ...overrides
  };
}

function detailRow(overrides: Partial<BookingDetailRow> = {}): BookingDetailRow {
  return {
    id: BOOKING_ID,
    code: 'BK-261021-F1FA',
    customer_id: CUSTOMER_A,
    vendor_id: VENDOR_ID,
    event_id: EVENT_ID,
    package_id: PACKAGE_ID,
    lifecycle_status: 'requested',
    payment_status: 'unpaid',
    settlement_status: 'not_eligible',
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
    policy_version_id: '77777777-7777-4777-8777-777777777777',
    respond_deadline: new Date('2026-10-22T10:00:00.000Z'),
    counter_deadline: null,
    payment_deadline: null,
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
    created_at: new Date('2026-10-21T10:00:00.000Z'),
    updated_at: new Date('2026-10-21T10:05:00.000Z'),
    vendor_slug: 'tarling-dian',
    vendor_display_name: 'Tarling Dangdut Dian',
    vendor_whatsapp: '6281234567890',
    vendor_region_code: '3209',
    vendor_base_address: 'Jl. Merdeka 1, Indramayu',
    package_name: 'Paket 6 jam',
    package_duration_minutes: 360,
    event_title: 'Hajatan Keluarga',
    event_type: null,
    event_region_code: '3209',
    event_venue_name: null,
    event_venue_address: 'Jl. Pantura 12',
    event_lat: -6.7,
    event_lng: 108.5,
    event_guest_estimate: 120,
    event_notes: 'Datang sore',
    event_start_date: '2026-12-05',
    event_end_date: '2026-12-05',
    ...overrides
  };
}

const SLOTS: BookingSlotRow[] = [
  { date: '2026-12-05', session: 'day', is_blocking: false, start_time: null, end_time: null }
];

/** Records the arguments the service passes to the repository. */
class FakeRepo {
  readonly listCalls: Array<{ customerId: string; options: ListForCustomerOptions }> = [];
  detail: BookingDetailRow | null = null;
  canViewAsVendor = false;

  constructor(private readonly rows: CustomerBookingListRow[] = []) {}

  async listForCustomer(
    customerId: string,
    options: ListForCustomerOptions
  ): Promise<CustomerBookingListRow[]> {
    this.listCalls.push({ customerId, options });
    return this.rows;
  }

  async findById(): Promise<BookingDetailRow | null> {
    return this.detail;
  }

  async findSlotsByBooking(): Promise<BookingSlotRow[]> {
    return SLOTS;
  }

  async canViewBookingAsVendor(): Promise<boolean> {
    return this.canViewAsVendor;
  }
}

function service(repo: FakeRepo): BookingService {
  return new BookingService(
    repo as unknown as BookingRepository,
    new CalendarService(new CalendarRepository())
  );
}

function query(value: Record<string, unknown> = {}) {
  return parseInput(listBookingsQuerySchema, value);
}

describe('GET /bookings list', () => {
  it('scopes the rows to the caller and converts page to LIMIT/OFFSET', async () => {
    const repo = new FakeRepo([listRow()]);

    const page = await service(repo).listForCustomer(CUSTOMER, query({ page: '2', page_size: '2' }));

    expect(repo.listCalls).toHaveLength(1);
    expect(repo.listCalls[0]?.customerId).toBe(CUSTOMER_A);
    expect(repo.listCalls[0]?.options).toEqual({ status: null, limit: 2, offset: 2 });
    expect(page.page).toBe(2);
    expect(page.page_size).toBe(2);
  });

  it('forwards the status filter to the query', async () => {
    const repo = new FakeRepo([]);

    await service(repo).listForCustomer(CUSTOMER, query({ status: 'accepted' }));

    expect(repo.listCalls[0]?.options.status).toBe('accepted');
  });

  it('keeps the SQL total, not the page length', async () => {
    const repo = new FakeRepo([listRow({ total_count: 4 })]);

    const page = await service(repo).listForCustomer(CUSTOMER, query({ page_size: '1' }));

    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(4);
  });

  it('maps the first slot and the outstanding balance', async () => {
    const repo = new FakeRepo([listRow({ payment_status: 'dp_paid' })]);

    const [item] = (await service(repo).listForCustomer(CUSTOMER, query())).items;

    expect(item?.first_slot).toEqual({ date: '2026-12-05', session: 'day' });
    expect(item?.total_customer_idr).toBe(5050000);
    expect(item?.dp_amount_idr).toBe(1500000);
    expect(item?.outstanding_idr).toBe(3550000);
    expect(item?.vendor).toEqual({
      id: VENDOR_ID,
      slug: 'tarling-dian',
      display_name: 'Tarling Dangdut Dian'
    });
    expect(item?.package).toEqual({ id: PACKAGE_ID, name: 'Paket 6 jam' });
  });

  it('charges the full total while the booking is unpaid', async () => {
    const repo = new FakeRepo([listRow({ payment_status: 'unpaid' })]);

    const [item] = (await service(repo).listForCustomer(CUSTOMER, query())).items;

    expect(item?.outstanding_idr).toBe(5050000);
  });

  it('reports nothing left once the booking is fully paid', async () => {
    const repo = new FakeRepo([listRow({ payment_status: 'fully_paid' })]);

    const [item] = (await service(repo).listForCustomer(CUSTOMER, query())).items;

    expect(item?.outstanding_idr).toBe(0);
  });

  it('reports nothing left after a refund', async () => {
    const ref = new FakeRepo([listRow({ payment_status: 'refunded' })]);
    const partial = new FakeRepo([listRow({ payment_status: 'partially_refunded' })]);

    const [refunded] = (await service(ref).listForCustomer(CUSTOMER, query())).items;
    const [partiallyRefunded] = (await service(partial).listForCustomer(CUSTOMER, query())).items;

    expect(refunded?.outstanding_idr).toBe(0);
    expect(partiallyRefunded?.outstanding_idr).toBe(0);
  });

  it('clamps a non-positive outstanding balance to 0', async () => {
    const repo = new FakeRepo([
      listRow({
        payment_status: 'dp_paid',
        total_customer_idr: '1000000',
        dp_amount_idr: '1500000'
      })
    ]);

    const [item] = (await service(repo).listForCustomer(CUSTOMER, query())).items;

    expect(item?.outstanding_idr).toBe(0);
  });

  it('returns first_slot null when the booking has no slot', async () => {
    const repo = new FakeRepo([listRow({ slot_date: null, slot_session: null })]);

    const [item] = (await service(repo).listForCustomer(CUSTOMER, query())).items;

    expect(item?.first_slot).toBeNull();
  });

  it('returns an empty page with total 0', async () => {
    const repo = new FakeRepo([]);

    const page = await service(repo).listForCustomer(CUSTOMER, query());

    expect(page).toEqual({ items: [], total: 0, page: 1, page_size: 20 });
  });

  it('refuses a non-customer role', async () => {
    const repo = new FakeRepo([]);

    await expect(
      service(repo).listForCustomer({ id: CUSTOMER_A, roles: ['admin_support'] }, query())
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(repo.listCalls).toHaveLength(0);
  });
});

describe('listBookingsQuerySchema', () => {
  it('defaults page 1 and page_size 20', () => {
    expect(query()).toEqual({ page: 1, page_size: 20 });
  });

  it('rejects an unknown status listing the valid values', () => {
    try {
      query({ status: 'no_show' });
      expect.unreachable('status no_show must be rejected');
    } catch (error) {
      const appError = error as { code: string; details: Array<{ field: string; reason: string }> };
      expect(appError.code).toBe('VALIDATION_ERROR');
      expect(appError.details[0]?.field).toBe('status');
      expect(appError.details[0]?.reason).toContain('status harus salah satu dari:');
      expect(appError.details[0]?.reason).toContain('requested, accepted, confirmed');
    }
  });

  it('rejects page_size above 50', () => {
    expect(() => query({ page_size: '51' })).toThrowError();
  });
});

describe('GET /bookings/:id detail', () => {
  it('adds outstanding, vendor, package and event without dropping the old keys', async () => {
    const repo = new FakeRepo();
    repo.detail = detailRow({ payment_status: 'dp_paid' });

    const view = await service(repo).getById(BOOKING_ID, CUSTOMER);

    expect(view.outstanding_idr).toBe(3550000);
    expect(view.vendor).toEqual({
      id: VENDOR_ID,
      slug: 'tarling-dian',
      display_name: 'Tarling Dangdut Dian',
      whatsapp: '6281234567890',
      region_code: '3209',
      base_address: 'Jl. Merdeka 1, Indramayu'
    });
    expect(view.package).toEqual({ id: PACKAGE_ID, name: 'Paket 6 jam', duration_minutes: 360 });
    expect(view.event).toEqual({
      title: 'Hajatan Keluarga',
      event_type: null,
      region_code: '3209',
      venue_name: null,
      venue_address: 'Jl. Pantura 12',
      location: { lat: -6.7, lng: 108.5 },
      guest_estimate: 120,
      notes: 'Datang sore',
      start_date: '2026-12-05',
      end_date: '2026-12-05'
    });

    // The pre-existing keys the admin panel / vendor UI parse.
    expect(view.row_version).toBe(1);
    expect(view.pricing.total_customer_idr).toBe(5050000);
    expect(view.pricing.dp_amount_idr).toBe(1500000);
    expect(view.slots).toEqual([
      { date: '2026-12-05', session: 'day', is_blocking: false }
    ]);
  });

  it('gives a non-owner customer 404, not 403', async () => {
    const repo = new FakeRepo();
    repo.detail = detailRow({ customer_id: CUSTOMER_B });

    await expect(service(repo).getById(BOOKING_ID, CUSTOMER)).rejects.toMatchObject({
      code: 'NOT_FOUND'
    });
  });
});
