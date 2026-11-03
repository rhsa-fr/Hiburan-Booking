import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tarlink/core/db', () => ({
  withTransaction: async <T>(fn: (client: unknown) => Promise<T>): Promise<T> => fn({})
}));

import { AppError } from '@tarlink/core/errors';
import type { PaymentService } from '@tarlink/modules/payment';
import type { AdminRepository } from './admin.repository';
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
  });
});
