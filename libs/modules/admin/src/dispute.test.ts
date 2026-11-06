import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tarlink/core/db', () => ({
  withTransaction: async <T>(fn: (client: unknown) => Promise<T>): Promise<T> => fn({}),
  query: vi.fn()
}));

// The release path posts a ledger entry on the transaction client. Keep the real
// journal builders, but never touch the database from a unit test.
vi.mock('@tarlink/modules/ledger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tarlink/modules/ledger')>();
  return {
    ...actual,
    postEntry: vi.fn(async () => ({
      id: 'journal-release',
      entryNo: 'JE-RELEASE-1',
      inserted: true
    }))
  };
});

import type { PoolClient } from 'pg';
import { AppError } from '@tarlink/core/errors';
import type { PaymentService } from '@tarlink/modules/payment';
import { AdminRepository } from './admin.repository';
import { AdminService } from './admin.service';
import type { BookingRow, DisputeRow, PaymentRow } from './rows';

const BOOKING_ID = '11111111-1111-4111-8111-111111111111';
const DISPUTE_ID = '22222222-2222-4222-8222-222222222222';
const PAYMENT_ID = '33333333-3333-4333-8333-333333333333';
const ACTOR = '44444444-4444-4444-8444-444444444444';

const dispute: DisputeRow = {
  id: DISPUTE_ID,
  booking_id: BOOKING_ID,
  booking_code: 'BK-261103-ABCD',
  status: 'open',
  resolution: null,
  description: 'Klaim uji',
  opened_at: new Date('2026-11-03T10:00:00.000Z'),
  sla_due_at: new Date('2026-11-03T12:00:00.000Z'),
  resolved_at: null,
  resolution_note: null,
  customer_share_idr: '0',
  vendor_share_idr: '0',
  vendor_name: 'Vendor Uji',
  city: 'Indramayu',
  customer_name: 'Pelanggan Uji'
};

const booking = {
  id: BOOKING_ID,
  code: 'BK-261103-ABCD',
  vendor_id: '55555555-5555-4555-8555-555555555555',
  lifecycle_status: 'completed',
  payment_status: 'fully_paid',
  settlement_status: 'disputed',
  total_customer_idr: '16160000',
  price_package_idr: '16000000',
  service_fee_idr: '160000',
  commission_bp: 1000,
  commission_threshold_idr: '10000000',
  commission_bp_tier2: 500,
  commission_min_idr: '25000',
  commission_cap_idr: '7500000'
} as BookingRow;

const payment = {
  id: PAYMENT_ID,
  booking_id: BOOKING_ID,
  booking_code: 'BK-261103-ABCD',
  kind: 'dp',
  status: 'paid',
  amount_idr: '4800000',
  method: 'qris',
  gateway_ref: 'order-1',
  paid_at: new Date('2026-11-03T09:00:00.000Z'),
  created_at: new Date('2026-11-03T08:00:00.000Z')
} as PaymentRow;

function harness() {
  const repository = {
    lockDispute: vi.fn(async () => dispute),
    findDispute: vi.fn(async () => dispute),
    lockBookings: vi.fn(async () => [booking]),
    findPaidDpPayment: vi.fn(async () => payment),
    setBookingSettlement: vi.fn(async () => undefined),
    setBookingRefundStatus: vi.fn(async () => undefined),
    markDisputeResolved: vi.fn(async () => undefined),
    markDisputeRejected: vi.fn(async () => undefined),
    markReleased: vi.fn(async () => [
      { id: BOOKING_ID, code: booking.code, settlement_status: 'released', released_at: new Date() }
    ]),
    enqueueDisputeResolved: vi.fn(async () => undefined),
    insertStatusHistory: vi.fn(async () => undefined),
    insertAudit: vi.fn(async () => undefined)
  };
  const payments = {
    refund: vi.fn(async () => ({
      id: 'refund-1',
      payment_id: PAYMENT_ID,
      booking_id: BOOKING_ID,
      amount_idr: 4_800_000,
      fee_idr: 0,
      currency: 'IDR' as const,
      status: 'succeeded',
      reason_code: 'uji',
      journal_entry_id: 'journal-refund'
    }))
  };
  const service = new AdminService(
    repository as unknown as AdminRepository,
    payments as unknown as PaymentService
  );
  return { service, repository, payments };
}

describe('AdminService.resolveDispute', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects a note shorter than 10 characters before touching the database', async () => {
    const { service, repository } = harness();
    await expect(
      service.resolveDispute(
        DISPUTE_ID,
        { resolution: 'reject', note: 'pendek' },
        { actorId: ACTOR, actorRole: 'admin_super', requestId: null }
      )
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(repository.lockDispute).not.toHaveBeenCalled();
  });

  it('rejects the dispute and returns the settlement to held', async () => {
    const { service, repository } = harness();

    const result = await service.resolveDispute(
      DISPUTE_ID,
      { resolution: 'reject', note: 'Bukti tidak cukup untuk klaim ini.' },
      { actorId: ACTOR, actorRole: 'admin_super', requestId: null }
    );

    expect(repository.setBookingSettlement).toHaveBeenCalledWith(expect.anything(), {
      bookingId: BOOKING_ID,
      settlementStatus: 'held'
    });
    expect(repository.markDisputeRejected).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ disputeId: DISPUTE_ID, resolvedBy: ACTOR })
    );
    expect(repository.enqueueDisputeResolved).toHaveBeenCalledTimes(1);
    expect(repository.enqueueDisputeResolved).toHaveBeenCalledWith(expect.anything(), {
      disputeId: DISPUTE_ID,
      bookingId: BOOKING_ID,
      bookingCode: 'BK-261103-ABCD',
      status: 'rejected',
      resolution: 'reject'
    });
    expect(result).toMatchObject({
      status: 'rejected',
      resolution: 'no_action',
      resolution_amount_idr: 0,
      customer_share_idr: 0,
      vendor_share_idr: 0
    });
  });

  it('leaves the dispute open when the provider refund fails', async () => {
    const { service, repository, payments } = harness();
    payments.refund.mockRejectedValueOnce(new AppError('UPSTREAM_ERROR', 'declined'));

    await expect(
      service.resolveDispute(
        DISPUTE_ID,
        { resolution: 'refund_full', note: 'Refund penuh sesuai putusan sengketa.' },
        { actorId: ACTOR, actorRole: 'admin_super', requestId: null }
      )
    ).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });

    expect(repository.markDisputeResolved).not.toHaveBeenCalled();
    expect(repository.setBookingRefundStatus).not.toHaveBeenCalled();
    expect(repository.enqueueDisputeResolved).not.toHaveBeenCalled();
  });

  it('enqueues one dispute_resolved notification when the money goes to the vendor', async () => {
    const { service, repository } = harness();

    await service.resolveDispute(
      DISPUTE_ID,
      { resolution: 'release_to_vendor', note: 'Bukti vendor kuat, dana dilepas.' },
      { actorId: ACTOR, actorRole: 'admin_super', requestId: null }
    );

    expect(repository.enqueueDisputeResolved).toHaveBeenCalledTimes(1);
    expect(repository.enqueueDisputeResolved).toHaveBeenCalledWith(expect.anything(), {
      disputeId: DISPUTE_ID,
      bookingId: BOOKING_ID,
      bookingCode: 'BK-261103-ABCD',
      status: 'resolved',
      resolution: 'release_to_vendor'
    });
  });

  it('enqueues one dispute_resolved notification after a full refund', async () => {
    const { service, repository } = harness();

    await service.resolveDispute(
      DISPUTE_ID,
      { resolution: 'refund_full', note: 'Refund penuh sesuai putusan sengketa.' },
      { actorId: ACTOR, actorRole: 'admin_super', requestId: null }
    );

    expect(repository.markDisputeResolved).toHaveBeenCalledTimes(1);
    expect(repository.enqueueDisputeResolved).toHaveBeenCalledTimes(1);
    expect(repository.enqueueDisputeResolved).toHaveBeenCalledWith(expect.anything(), {
      disputeId: DISPUTE_ID,
      bookingId: BOOKING_ID,
      bookingCode: 'BK-261103-ABCD',
      status: 'resolved',
      resolution: 'refund_full'
    });
  });
});

describe('AdminRepository.enqueueDisputeResolved', () => {
  it('writes one dispute-keyed outbox row on the caller transaction', async () => {
    const client = { query: vi.fn(async () => ({ rows: [] })) };

    await new AdminRepository().enqueueDisputeResolved(client as unknown as PoolClient, {
      disputeId: DISPUTE_ID,
      bookingId: BOOKING_ID,
      bookingCode: 'BK-261103-ABCD',
      status: 'resolved',
      resolution: 'release_to_vendor'
    });

    expect(client.query).toHaveBeenCalledTimes(1);
    const [sql, params] = client.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("'booking.dispute_resolved'");
    expect(sql).toContain('ON CONFLICT (dedupe_key) DO NOTHING');
    expect(params).toEqual([
      BOOKING_ID,
      JSON.stringify({
        booking_id: BOOKING_ID,
        code: 'BK-261103-ABCD',
        dispute_id: DISPUTE_ID,
        status: 'resolved',
        resolution: 'release_to_vendor'
      }),
      `booking.dispute_resolved:${DISPUTE_ID}`
    ]);
  });
});
