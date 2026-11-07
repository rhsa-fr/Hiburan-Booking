import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../apps/api/src/core/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../apps/api/src/core/db')>();
  return {
    ...actual,
    withTransaction: vi.fn(async (fn: (client: unknown) => unknown) => fn({}))
  };
});

import type { CalendarService } from '../../calendar/src/index';
import type {
  BookingRepository,
  BookingRow,
  DisputeRow,
  InsertDisputeInput
} from './booking.repository';
import { BookingService } from './booking.service';
import type { AuthUser } from './current-user.decorator';

const BOOKING_ID = '11111111-1111-4111-8111-111111111111';
const VENDOR_ID = '22222222-2222-4222-8222-222222222222';
const VENDOR_USER_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_VENDOR_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MEMBER_USER_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
/** Active `vendor_members` row with `can_respond = false`. */
const READ_ONLY_MEMBER_ID = '14141414-1414-4414-8414-141414141414';
/** Carries the `vendor_member` role but has no `vendor_members` row. */
const NON_MEMBER_ID = '15151515-1515-4515-8515-151515151515';
const OTHER_VENDOR_OWNER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CUSTOMER_ID = '77777777-7777-4777-8777-777777777777';
const STRANGER_ID = '88888888-8888-4888-8888-888888888888';
const DISPUTE_ID = '99999999-9999-4999-8999-999999999999';
const NOW = new Date('2026-11-01T12:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;
const DESCRIPTION = 'Fotografer tidak datang sesuai paket yang disepakati';

const VENDOR: AuthUser = { id: VENDOR_USER_ID, roles: ['vendor_owner'] };
/** Real vendor accounts always keep the `customer` role from registration. */
const DUAL_ROLE_VENDOR: AuthUser = { id: VENDOR_USER_ID, roles: ['customer', 'vendor_owner'] };
const VENDOR_MEMBER: AuthUser = { id: MEMBER_USER_ID, roles: ['vendor_member'] };
const DUAL_ROLE_VENDOR_MEMBER: AuthUser = { id: MEMBER_USER_ID, roles: ['customer', 'vendor_member'] };
/**
 * Owns vendor A while being an active `can_respond` member of vendor B: the
 * P2 case, where the global `vendor_owner` role string must not grant
 * owner-level writes on B's bookings.
 */
const OWNER_OF_A_MEMBER_OF_B: AuthUser = {
  id: OTHER_VENDOR_OWNER_ID,
  roles: ['customer', 'vendor_owner']
};
const CUSTOMER: AuthUser = { id: CUSTOMER_ID, roles: ['customer'] };
const STRANGER: AuthUser = { id: STRANGER_ID, roles: ['customer'] };
const ADMIN: AuthUser = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', roles: ['admin_support'] };

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
    respond_deadline: new Date(NOW.getTime() - 24 * HOUR_MS),
    counter_deadline: null,
    payment_deadline: null,
    scheduled_start_at: new Date(NOW.getTime() - 60 * HOUR_MS),
    scheduled_end_at: new Date(NOW.getTime() - 30 * HOUR_MS),
    checkin_at: null,
    confirmed_at: new Date(NOW.getTime() - 48 * HOUR_MS),
    started_at: null,
    completed_at: null,
    cancelled_at: null,
    cancel_reason: null,
    no_show_at: null,
    released_at: null,
    dispute_window_ends_at: new Date(NOW.getTime() + 7 * 24 * HOUR_MS),
    started_without_checkin: false,
    row_version: 4,
    created_at: new Date(NOW.getTime() - 96 * HOUR_MS),
    updated_at: NOW,
    ...overrides
  };
}

function disputeRow(overrides: Partial<DisputeRow> = {}): DisputeRow {
  return {
    id: DISPUTE_ID,
    status: 'open',
    reasonCode: 'quality',
    description: DESCRIPTION,
    openedAt: NOW,
    slaDueAt: new Date(NOW.getTime() + 72 * HOUR_MS),
    resolvedAt: null,
    resolution: null,
    resolutionNote: null,
    ...overrides
  };
}

function harness(initial: BookingRow, disputes: DisputeRow[] = [disputeRow()]) {
  let row = initial;
  const repo = {
    findByIdForUpdate: vi.fn(async () => row),
    findById: vi.fn(async () => row),
    isVendorOwner: vi.fn(
      async (vendorId: string, userId: string) =>
        vendorId === VENDOR_ID && userId === VENDOR_USER_ID
    ),
    isVendorResponder: vi.fn(
      async (vendorId: string, userId: string) =>
        vendorId === VENDOR_ID && userId === VENDOR_USER_ID
    ),
    // Mirrors `BookingRepository.canViewBookingAsVendor`: the vendor owner OR
    // any active `vendor_members` row, with no `can_respond` requirement.
    canViewBookingAsVendor: vi.fn(
      async (bookingId: string, userId: string) =>
        bookingId === row.id &&
        row.vendor_id === VENDOR_ID &&
        (userId === VENDOR_USER_ID ||
          userId === MEMBER_USER_ID ||
          userId === READ_ONLY_MEMBER_ID ||
          userId === OTHER_VENDOR_OWNER_ID)
    ),
    countOpenDisputes: vi.fn(async () => 0),
    updateStatus: vi.fn(
      async (_client: unknown, _id: string, patch: Record<string, unknown>) => {
        row = { ...row, ...patch, row_version: row.row_version + 1 } as BookingRow;
        return row;
      }
    ),
    insertDispute: vi.fn(async (_client: unknown, _input: InsertDisputeInput) => true),
    insertHistory: vi.fn(
      async (_client: unknown, _entries: Array<Record<string, unknown>>) => undefined
    ),
    enqueueOutbox: vi.fn(
      async (_client: unknown, _message: Record<string, unknown>) => undefined
    ),
    listDisputes: vi.fn(async () => disputes)
  };
  const service = new BookingService(repo as unknown as BookingRepository, {} as CalendarService);
  return { repo, service };
}

describe('BookingService.openDispute', () => {
  beforeEach(() => vi.clearAllMocks());

  it('held settlement: disputes the money, inserts the row, history and outbox', async () => {
    const { repo, service } = harness(confirmedRow());

    const result = await service.openDispute(
      BOOKING_ID,
      { reason_code: 'quality', description: DESCRIPTION },
      CUSTOMER,
      NOW
    );

    expect(result).toEqual({
      dispute_id: DISPUTE_ID,
      booking_id: BOOKING_ID,
      status: 'open',
      reason_code: 'quality',
      description: DESCRIPTION,
      opened_at: NOW.toISOString(),
      sla_due_at: new Date(NOW.getTime() + 72 * HOUR_MS).toISOString()
    });

    expect(repo.updateStatus).toHaveBeenCalledWith(expect.anything(), BOOKING_ID, {
      settlement_status: 'disputed'
    });

    const inserted = repo.insertDispute.mock.calls[0][1];
    expect(inserted).toMatchObject({
      bookingId: BOOKING_ID,
      raisedBy: CUSTOMER_ID,
      reasonCode: 'quality',
      description: DESCRIPTION
    });
    // Admin SLA: 72 hours from the moment the dispute opens.
    expect(inserted.slaDueAt).toEqual(new Date(NOW.getTime() + 72 * HOUR_MS));

    const history = repo.insertHistory.mock.calls[0][1];
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      bookingId: BOOKING_ID,
      axis: 'settlement',
      from: 'held',
      to: 'disputed',
      event: 'dispute.open',
      actorId: CUSTOMER_ID,
      actorRole: 'customer',
      note: DESCRIPTION
    });

    const outbox = repo.enqueueOutbox.mock.calls[0][1];
    expect(outbox).toMatchObject({
      aggregateId: BOOKING_ID,
      eventType: 'booking.dispute_opened',
      dedupeKey: `booking.dispute_opened:${BOOKING_ID}`
    });
    expect(outbox.payload).toMatchObject({
      booking_id: BOOKING_ID,
      settlement_status: 'disputed',
      dispute_reason: 'quality'
    });
  });

  it('released settlement uses dispute.open_post_release', async () => {
    const { repo, service } = harness(
      confirmedRow({
        lifecycle_status: 'completed',
        payment_status: 'fully_paid',
        settlement_status: 'released',
        completed_at: new Date(NOW.getTime() - 20 * HOUR_MS),
        released_at: new Date(NOW.getTime() - 2 * HOUR_MS)
      })
    );

    await service.openDispute(
      BOOKING_ID,
      { reason_code: 'fraud', description: 'Vendor meminta biaya tambahan di luar kesepakatan' },
      CUSTOMER,
      NOW
    );

    expect(repo.updateStatus).toHaveBeenCalledWith(expect.anything(), BOOKING_ID, {
      settlement_status: 'disputed'
    });
    const history = repo.insertHistory.mock.calls[0][1];
    expect(history[0]).toMatchObject({
      event: 'dispute.open_post_release',
      from: 'released',
      to: 'disputed'
    });
  });

  it('vendor_owner may open a dispute when the vendor is a responder', async () => {
    const { repo, service } = harness(confirmedRow());

    await service.openDispute(
      BOOKING_ID,
      { reason_code: 'cancellation_abuse', description: 'Pelanggan membatalkan mendadak di hari acara' },
      VENDOR,
      NOW
    );

    expect(repo.isVendorOwner).toHaveBeenCalledWith(VENDOR_ID, VENDOR_USER_ID);
    expect(repo.insertDispute.mock.calls[0][1]).toMatchObject({
      raisedBy: VENDOR_USER_ID,
      reasonCode: 'cancellation_abuse'
    });
  });

  it('dual-role vendor (customer + vendor_owner) opens on their own vendor booking', async () => {
    const { repo, service } = harness(confirmedRow());

    await service.openDispute(
      BOOKING_ID,
      { reason_code: 'cancellation_abuse', description: 'Pelanggan membatalkan mendadak' },
      DUAL_ROLE_VENDOR,
      NOW
    );

    expect(repo.isVendorOwner).toHaveBeenCalledWith(VENDOR_ID, VENDOR_USER_ID);
    expect(repo.insertDispute.mock.calls[0][1]).toMatchObject({ raisedBy: VENDOR_USER_ID });
    // Ownership decides the actor: the customer role must not win by being first.
    expect(repo.insertHistory.mock.calls[0][1][0]).toMatchObject({
      actorId: VENDOR_USER_ID,
      actorRole: 'vendor_owner'
    });
  });

  it('rejects a vendor opening a dispute on another vendor booking', async () => {
    const { repo, service } = harness(confirmedRow({ vendor_id: OTHER_VENDOR_ID }));

    await expect(
      service.openDispute(
        BOOKING_ID,
        { reason_code: 'cancellation_abuse', description: 'Bukan booking vendor saya' },
        DUAL_ROLE_VENDOR,
        NOW
      )
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(repo.insertDispute).not.toHaveBeenCalled();
  });

  it('rejects an owner of vendor A who is only a can_respond member of vendor B', async () => {
    const { repo, service } = harness(confirmedRow());
    // The exact P2: `isVendorResponder(B, user)` is true because of the active
    // `vendor_members` row, but the user owns a different vendor.
    repo.isVendorResponder.mockImplementation(
      async (vendorId: string, userId: string) =>
        vendorId === VENDOR_ID && userId === OTHER_VENDOR_OWNER_ID
    );
    repo.isVendorOwner.mockImplementation(
      async (vendorId: string, userId: string) =>
        vendorId === OTHER_VENDOR_ID && userId === OTHER_VENDOR_OWNER_ID
    );

    await expect(
      service.openDispute(
        BOOKING_ID,
        { reason_code: 'cancellation_abuse', description: 'Pemilik vendor lain mencoba membuka sengketa' },
        OWNER_OF_A_MEMBER_OF_B,
        NOW
      )
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(repo.isVendorOwner).toHaveBeenCalledWith(VENDOR_ID, OTHER_VENDOR_OWNER_ID);
    expect(repo.updateStatus).not.toHaveBeenCalled();
    expect(repo.insertDispute).not.toHaveBeenCalled();
  });

  it('rejects vendor_member even when they can respond for the vendor', async () => {
    for (const user of [VENDOR_MEMBER, DUAL_ROLE_VENDOR_MEMBER]) {
      const { repo, service } = harness(confirmedRow());
      // Sole owner is the only allowed vendor actor, so being a responder is not enough.
      repo.isVendorResponder.mockResolvedValue(true);

      await expect(
        service.openDispute(
          BOOKING_ID,
          { reason_code: 'cancellation_abuse', description: 'Anggota vendor mencoba membuka sengketa' },
          user,
          NOW
        )
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      expect(repo.insertDispute).not.toHaveBeenCalled();
    }
  });

  it('rejects a dispute opened after the 7-day window', async () => {
    const { repo, service } = harness(
      confirmedRow({ dispute_window_ends_at: new Date(NOW.getTime() - 1) })
    );

    await expect(
      service.openDispute(
        BOOKING_ID,
        { reason_code: 'quality', description: DESCRIPTION },
        CUSTOMER,
        NOW
      )
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(repo.updateStatus).not.toHaveBeenCalled();
    expect(repo.insertDispute).not.toHaveBeenCalled();
  });

  it('rejects a second open dispute for the same booking', async () => {
    const { repo, service } = harness(confirmedRow());
    repo.insertDispute.mockResolvedValueOnce(false);

    await expect(
      service.openDispute(
        BOOKING_ID,
        { reason_code: 'quality', description: DESCRIPTION },
        CUSTOMER,
        NOW
      )
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Sengketa untuk booking ini sudah terbuka.'
    });

    expect(repo.enqueueOutbox).not.toHaveBeenCalled();
  });

  it('rejects a caller who is not a participant', async () => {
    const { repo, service } = harness(confirmedRow());

    await expect(
      service.openDispute(
        BOOKING_ID,
        { reason_code: 'quality', description: DESCRIPTION },
        STRANGER,
        NOW
      )
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(repo.insertDispute).not.toHaveBeenCalled();
  });

  it('rejects a booking whose settlement is not held or released', async () => {
    const { repo, service } = harness(
      confirmedRow({
        lifecycle_status: 'cancelled',
        payment_status: 'unpaid',
        settlement_status: 'not_eligible'
      })
    );

    await expect(
      service.openDispute(
        BOOKING_ID,
        { reason_code: 'quality', description: DESCRIPTION },
        CUSTOMER,
        NOW
      )
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(repo.insertDispute).not.toHaveBeenCalled();
  });

  it('rejects an admin: POST /disputes is participant-only', async () => {
    const { service } = harness(confirmedRow());

    await expect(
      service.openDispute(
        BOOKING_ID,
        { reason_code: 'quality', description: DESCRIPTION },
        ADMIN,
        NOW
      )
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('BookingService.listBookingDisputes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the booking disputes mapped to the public shape', async () => {
    const resolved = disputeRow({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      status: 'resolved',
      resolvedAt: new Date(NOW.getTime() - HOUR_MS),
      resolution: 'refund_full',
      resolutionNote: 'Vendor tidak hadir'
    });
    const { repo, service } = harness(confirmedRow(), [disputeRow(), resolved]);

    const list = await service.listBookingDisputes(BOOKING_ID, CUSTOMER);

    expect(repo.listDisputes).toHaveBeenCalledWith(BOOKING_ID);
    expect(list).toEqual([
      {
        id: DISPUTE_ID,
        status: 'open',
        reason_code: 'quality',
        description: DESCRIPTION,
        opened_at: NOW.toISOString(),
        sla_due_at: new Date(NOW.getTime() + 72 * HOUR_MS).toISOString(),
        resolved_at: null,
        resolution: null,
        resolution_note: null
      },
      {
        id: resolved.id,
        status: 'resolved',
        reason_code: 'quality',
        description: DESCRIPTION,
        opened_at: NOW.toISOString(),
        sla_due_at: new Date(NOW.getTime() + 72 * HOUR_MS).toISOString(),
        resolved_at: resolved.resolvedAt?.toISOString() ?? null,
        resolution: 'refund_full',
        resolution_note: 'Vendor tidak hadir'
      }
    ]);
  });

  it('allows an admin to read the disputes of any booking', async () => {
    const { service } = harness(confirmedRow());

    const list = await service.listBookingDisputes(BOOKING_ID, ADMIN);

    expect(list).toHaveLength(1);
  });

  it('rejects a customer who does not own the booking', async () => {
    const { repo, service } = harness(confirmedRow());

    await expect(service.listBookingDisputes(BOOKING_ID, STRANGER)).rejects.toMatchObject({
      code: 'NOT_FOUND'
    });
    expect(repo.listDisputes).not.toHaveBeenCalled();
  });

  it('rejects a vendor the repository denies view access to', async () => {
    const { repo, service } = harness(confirmedRow());
    repo.canViewBookingAsVendor.mockResolvedValueOnce(false);

    await expect(service.listBookingDisputes(BOOKING_ID, VENDOR)).rejects.toMatchObject({
      code: 'NOT_FOUND'
    });
    expect(repo.listDisputes).not.toHaveBeenCalled();
  });

  it('lets a dual-role vendor read the disputes of their own vendor booking', async () => {
    const { service } = harness(confirmedRow());

    const list = await service.listBookingDisputes(BOOKING_ID, DUAL_ROLE_VENDOR);

    expect(list).toHaveLength(1);
  });

  it('rejects a vendor reading another vendor booking', async () => {
    const { repo, service } = harness(confirmedRow({ vendor_id: OTHER_VENDOR_ID }));

    await expect(
      service.listBookingDisputes(BOOKING_ID, DUAL_ROLE_VENDOR)
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(repo.listDisputes).not.toHaveBeenCalled();
  });

  it('lets an active vendor_member read the disputes', async () => {
    const { repo, service } = harness(confirmedRow());

    const list = await service.listBookingDisputes(BOOKING_ID, DUAL_ROLE_VENDOR_MEMBER);

    expect(list).toHaveLength(1);
    expect(repo.canViewBookingAsVendor).toHaveBeenCalledWith(BOOKING_ID, MEMBER_USER_ID);
  });

  it('lets an active vendor_member without can_respond read the disputes', async () => {
    const { repo, service } = harness(confirmedRow());
    const readOnlyMember: AuthUser = { id: READ_ONLY_MEMBER_ID, roles: ['vendor_member'] };

    const list = await service.listBookingDisputes(BOOKING_ID, readOnlyMember);

    expect(list).toHaveLength(1);
    expect(repo.canViewBookingAsVendor).toHaveBeenCalledWith(BOOKING_ID, READ_ONLY_MEMBER_ID);
    // The read path must not consult the responder predicate at all.
    expect(repo.isVendorResponder).not.toHaveBeenCalled();
  });

  it('still rejects a user with no vendor membership at all', async () => {
    const { repo, service } = harness(confirmedRow());
    const nonMember: AuthUser = { id: NON_MEMBER_ID, roles: ['vendor_member'] };

    await expect(
      service.listBookingDisputes(BOOKING_ID, nonMember)
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(repo.canViewBookingAsVendor).toHaveBeenCalledWith(BOOKING_ID, NON_MEMBER_ID);
    expect(repo.listDisputes).not.toHaveBeenCalled();
  });

  it('lets an owner of vendor A read vendor B disputes through the member path', async () => {
    const { repo, service } = harness(confirmedRow());
    // Reading only needs the owner/active-member relationship: owning another
    // vendor neither grants nor blocks it.
    const list = await service.listBookingDisputes(BOOKING_ID, OWNER_OF_A_MEMBER_OF_B);

    expect(list).toHaveLength(1);
    expect(repo.listDisputes).toHaveBeenCalledWith(BOOKING_ID);
  });
});
