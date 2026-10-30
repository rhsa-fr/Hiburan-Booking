import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ClaimRequest,
  IdempotencyRecord,
  IdempotencyStore
} from '../../../platform/idempotency/src/index';
import { hashRequest } from '../../../platform/idempotency/src/index';

/**
 * `createBooking` opens its own transaction. The double runs the callback
 * against an empty client: every repository/calendar call below is faked, so
 * the test exercises only the validation and persistence ORDER in the service.
 */
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
import type { CreateBookingDto } from './dto';

const BOOKING_ID = '11111111-1111-4111-8111-111111111111';
const VENDOR_ID = '22222222-2222-4222-8222-222222222222';
const PACKAGE_ID = '33333333-3333-4333-8333-333333333333';
const EVENT_ID = '44444444-4444-4444-8444-444444444444';
const POLICY_ID = '55555555-5555-4555-8555-555555555555';
const CLIENT_ID = '66666666-6666-4666-8666-666666666666';
const CUSTOMER: AuthUser = { id: '77777777-7777-4777-8777-777777777777', roles: ['customer'] };
const NOW = new Date('2026-11-01T02:00:00.000Z');

function policy(overrides: Record<string, unknown> = {}) {
  return {
    id: POLICY_ID,
    code: 'cancellation',
    version: 1,
    body: { currency: 'IDR', tiers: [] },
    body_hash: 'a'.repeat(64),
    effective_from: new Date('2026-01-01T00:00:00.000Z'),
    effective_to: null,
    is_active: true,
    ...overrides
  };
}

function bookingRow(policyVersionId = POLICY_ID): BookingRow {
  return {
    id: BOOKING_ID,
    code: 'BK-261101-AB12',
    customer_id: CUSTOMER.id,
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
    policy_version_id: policyVersionId,
    respond_deadline: new Date('2026-11-02T02:00:00.000Z'),
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
    created_at: NOW,
    updated_at: NOW
  };
}

const input: CreateBookingDto = {
  vendor_id: VENDOR_ID,
  package_id: PACKAGE_ID,
  event: {
    title: 'Hajatan keluarga',
    region_code: '3212',
    venue_address: 'Jl. Pantura No. 12',
    start_date: '2026-12-05',
    end_date: '2026-12-05'
  },
  slots: [{ date: '2026-12-05', session: 'night' }],
  addons: [],
  policy_version_id: POLICY_ID,
  client_generated_id: CLIENT_ID
};

function harness(policyRow = policy()) {
  const repo = {
    findVendor: vi.fn().mockResolvedValue({
      id: VENDOR_ID,
      owner_user_id: VENDOR_ID,
      verification_status: 'approved',
      is_active: true
    }),
    findPackage: vi.fn().mockResolvedValue({
      id: PACKAGE_ID,
      vendor_id: VENDOR_ID,
      base_price_idr: '5000000',
      is_active: true
    }),
    findPolicyVersion: vi.fn().mockResolvedValue(policyRow),
    findPriceRule: vi.fn().mockResolvedValue(null),
    findAddons: vi.fn().mockResolvedValue([]),
    insertEvent: vi.fn().mockResolvedValue({ id: EVENT_ID, code: 'EV-261101-AB12' }),
    insertBooking: vi.fn().mockResolvedValue(bookingRow()),
    insertTermsSnapshot: vi.fn().mockResolvedValue(undefined),
    insertBookingAddons: vi.fn().mockResolvedValue(undefined),
    insertHistory: vi.fn().mockResolvedValue(undefined),
    enqueueOutbox: vi.fn().mockResolvedValue(undefined),
    findSlotsByBooking: vi.fn().mockResolvedValue([])
  } as unknown as BookingRepository;
  const calendar = {
    reserve: vi.fn().mockResolvedValue(undefined)
  } as unknown as CalendarService;

  return { repo, calendar, service: new BookingService(repo, calendar) };
}

/** Minimal in-memory idempotency store; the platform store is SQL-backed. */
class MemoryStore implements IdempotencyStore {
  private readonly rows = new Map<string, IdempotencyRecord>();

  private id(scope: string, key: string, actorId: string | null): string {
    return `${actorId ?? '∅'}|${scope}|${key}`;
  }

  async tryClaim(request: ClaimRequest): Promise<boolean> {
    const id = this.id(request.scope, request.key, request.actorId);
    if (this.rows.has(id)) return false;
    this.rows.set(id, {
      requestHash: request.requestHash,
      status: 'in_progress',
      responseStatus: null,
      responseBody: null,
      lockedUntil: request.lockedUntil,
      expiresAt: request.expiresAt
    });
    return true;
  }

  async read(scope: string, key: string, actorId: string | null): Promise<IdempotencyRecord | null> {
    return this.rows.get(this.id(scope, key, actorId)) ?? null;
  }

  async complete(
    scope: string,
    key: string,
    actorId: string | null,
    responseStatus: number,
    responseBody: unknown
  ): Promise<void> {
    const row = this.rows.get(this.id(scope, key, actorId));
    if (!row) throw new Error('missing key');
    row.status = 'completed';
    row.responseStatus = responseStatus;
    row.responseBody = responseBody;
    row.lockedUntil = null;
  }

  async fail(
    scope: string,
    key: string,
    actorId: string | null,
    responseStatus: number
  ): Promise<void> {
    const row = this.rows.get(this.id(scope, key, actorId));
    if (!row) throw new Error('missing key');
    row.status = 'failed';
    row.responseStatus = responseStatus;
    row.lockedUntil = null;
  }

  async takeOver(
    scope: string,
    key: string,
    actorId: string | null,
    lockedUntil: Date
  ): Promise<void> {
    const row = this.rows.get(this.id(scope, key, actorId));
    if (row) row.lockedUntil = lockedUntil;
  }
}

describe('BookingService.createBooking — policy', () => {
  beforeEach(() => vi.clearAllMocks());

  it('freezes the policy terms and stores client_generated_id', async () => {
    const { repo, service } = harness();

    const view = await service.createBooking(input, CUSTOMER, NOW);
    const insertBooking = repo.insertBooking as unknown as ReturnType<typeof vi.fn>;
    const insertTerms = repo.insertTermsSnapshot as unknown as ReturnType<typeof vi.fn>;

    expect(view.id).toBe(BOOKING_ID);
    expect(insertBooking).toHaveBeenCalledTimes(1);
    const record = insertBooking.mock.calls[0]?.[1] as {
      clientGeneratedId: string;
      policyVersionId: string;
    };
    expect(record.clientGeneratedId).toBe(CLIENT_ID);
    expect(record.policyVersionId).toBe(POLICY_ID);

    const snapshot = insertTerms.mock.calls[0]?.[1] as {
      termsHash: string;
      terms: { code: string; version: number };
    };
    expect(snapshot.terms).toMatchObject({ code: 'cancellation', version: 1 });
    expect(snapshot.termsHash).toHaveLength(64);
  });

  it('rejects an unknown policy version before inserting anything', async () => {
    const { repo, service } = harness(null as unknown as ReturnType<typeof policy>);
    const insertBooking = repo.insertBooking as unknown as ReturnType<typeof vi.fn>;

    await expect(service.createBooking(input, CUSTOMER, NOW)).rejects.toMatchObject({
      code: 'NOT_FOUND'
    });
    expect(insertBooking).not.toHaveBeenCalled();
  });

  it('rejects an inactive policy version', async () => {
    const { service } = harness(policy({ is_active: false }));
    await expect(service.createBooking(input, CUSTOMER, NOW)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
  });

  it('rejects a policy that is not effective yet or already ended', async () => {
    const future = harness(policy({ effective_from: new Date('2027-01-01T00:00:00.000Z') }));
    await expect(future.service.createBooking(input, CUSTOMER, NOW)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });

    const ended = harness(policy({ effective_to: new Date('2026-01-02T00:00:00.000Z') }));
    await expect(ended.service.createBooking(input, CUSTOMER, NOW)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
  });
});

describe('BookingService.createBookingIdempotent', () => {
  it('returns the stored booking on replay without inserting twice', async () => {
    const { repo, calendar, service } = harness();
    const store = new MemoryStore();
    const idempotent = new BookingService(repo, calendar, store);
    const key = { key: CLIENT_ID, requestHash: hashRequest(input) };

    const first = await idempotent.createBookingIdempotent(input, CUSTOMER, key);
    const second = await idempotent.createBookingIdempotent(input, CUSTOMER, key);

    const insertBooking = repo.insertBooking as unknown as ReturnType<typeof vi.fn>;
    const insertTerms = repo.insertTermsSnapshot as unknown as ReturnType<typeof vi.fn>;
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.booking.id).toBe(first.booking.id);
    expect(insertBooking).toHaveBeenCalledTimes(1);
    expect(insertTerms).toHaveBeenCalledTimes(1);
  });

  it('rejects the same key with a different payload', async () => {
    const { repo, calendar } = harness();
    const idempotent = new BookingService(repo, calendar, new MemoryStore());
    const insertBooking = repo.insertBooking as unknown as ReturnType<typeof vi.fn>;

    await idempotent.createBookingIdempotent(input, CUSTOMER, {
      key: CLIENT_ID,
      requestHash: hashRequest(input)
    });

    await expect(
      idempotent.createBookingIdempotent(
        { ...input, notes: 'payload berubah' },
        CUSTOMER,
        { key: CLIENT_ID, requestHash: hashRequest({ ...input, notes: 'payload berubah' }) }
      )
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' });
    expect(insertBooking).toHaveBeenCalledTimes(1);
  });
});
