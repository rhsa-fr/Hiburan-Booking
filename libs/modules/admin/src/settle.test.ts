import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { ROLES_KEY, RolesGuard } from '@tarlink/platform/auth';
import type { BookingRow } from './rows';

vi.mock('@tarlink/core/db', () => ({
  withTransaction: async <T>(fn: (client: unknown) => Promise<T>): Promise<T> => fn({})
}));

import type { PaymentService } from '@tarlink/modules/payment';
import { AdminController } from './admin.controller';
import { AdminService, parseSettleManualBody } from './admin.service';
import type { AdminRepository } from './admin.repository';

const BOOKING_ID = '11111111-1111-4111-8111-111111111111';

function booking(overrides: Partial<BookingRow> = {}): BookingRow {
  return {
    id: BOOKING_ID,
    payment_status: 'dp_paid',
    total_customer_idr: '4000000',
    dp_amount_idr: '450000',
    ...overrides
  } as BookingRow;
}

function harness(before: BookingRow) {
  const repository = {
    findBooking: vi.fn(async () => before),
    insertAudit: vi.fn(async () => undefined)
  };
  const payment = {
    settleManual: vi.fn(async () => ({
      paymentId: 'payment-1',
      journalEntryId: 'journal-1',
      bookingId: BOOKING_ID,
      outstandingBeforeIdr: 3_550_000n,
      alreadySettled: false
    }))
  };
  const service = new AdminService(
    repository as unknown as AdminRepository,
    payment as unknown as PaymentService
  );
  return { service, repository, payment };
}

describe('parseSettleManualBody', () => {
  it('accepts the frozen panel payload and trims strings', () => {
    expect(
      parseSettleManualBody({
        amount_idr: 3_550_000,
        method: 'transfer_manual',
        reference: '  BCA 21/10/2026  ',
        note: '  Transfer telat  '
      })
    ).toEqual({
      amount_idr: 3_550_000,
      method: 'transfer_manual',
      reference: 'BCA 21/10/2026',
      note: 'Transfer telat'
    });
  });

  it('rejects zero, fractions and unknown methods with an Indonesian message', () => {
    for (const body of [
      { amount_idr: 0, method: 'cash' },
      { amount_idr: 1.5, method: 'cash' },
      { amount_idr: 1000, method: 'qris' },
      { amount_idr: 1000, method: 'cash', reference: 'x'.repeat(121) }
    ]) {
      expect(() => parseSettleManualBody(body)).toThrow(/Nominal|Metode|Referensi/);
    }
  });
});

describe('AdminService.settleBookingManual', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('settles the exact outstanding and hands the audit row to the money transaction', async () => {
    const { service, repository, payment } = harness(booking());
    const longRequestId = 'r'.repeat(200);

    const result = await service.settleBookingManual(
      BOOKING_ID,
      {
        amount_idr: 3_550_000,
        method: 'transfer_manual',
        reference: 'BCA 21/10/2026',
        note: 'Transfer telat'
      },
      { id: 'actor-1', role: 'admin_finance' },
      longRequestId
    );

    expect(payment.settleManual).toHaveBeenCalledWith({
      bookingId: BOOKING_ID,
      amountIdr: 3_550_000n,
      method: 'transfer_manual',
      reference: 'BCA 21/10/2026',
      note: 'Transfer telat',
      actorId: 'actor-1',
      audit: {
        action: 'booking.settle_manual',
        actorId: 'actor-1',
        actorRole: 'admin_finance',
        requestId: longRequestId.slice(0, 40),
        payload: {
          payment_status: 'fully_paid',
          amount_idr: 3_550_000,
          method: 'transfer_manual',
          reference: 'BCA 21/10/2026'
        }
      }
    });
    // The audit is no longer a second, post-commit transaction.
    expect(repository.insertAudit).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      booking_id: BOOKING_ID,
      payment_id: 'payment-1',
      journal_entry_id: 'journal-1',
      payment_status: 'fully_paid',
      outstanding_before_idr: 3_550_000n,
      already_settled: false
    });
  });

  it('rejects an amount that is not the outstanding without calling payment', async () => {
    const { service, repository, payment } = harness(booking());

    await expect(
      service.settleBookingManual(
        BOOKING_ID,
        { amount_idr: 3_549_999, method: 'cash' },
        { id: 'actor-1', role: 'admin_super' }
      )
    ).rejects.toThrow(/sisa tagihan/);

    expect(payment.settleManual).not.toHaveBeenCalled();
    expect(repository.insertAudit).not.toHaveBeenCalled();
  });

  it('replays an already fully paid booking without a second audit row', async () => {
    const { service, repository, payment } = harness(booking({ payment_status: 'fully_paid' }));
    payment.settleManual.mockResolvedValueOnce({
      paymentId: 'payment-old',
      journalEntryId: 'journal-old',
      bookingId: BOOKING_ID,
      outstandingBeforeIdr: 3_550_000n,
      alreadySettled: true
    });

    const result = await service.settleBookingManual(
      BOOKING_ID,
      { amount_idr: 3_550_000, method: 'transfer_manual' },
      { id: 'actor-1', role: 'admin_finance' }
    );

    expect(result.already_settled).toBe(true);
    expect(result.journal_entry_id).toBe('journal-old');
    expect(repository.insertAudit).not.toHaveBeenCalled();
  });
  it('turns a concurrent settlement of a dp_paid booking into a 409', async () => {
    const { service, payment } = harness(booking());
    payment.settleManual.mockResolvedValueOnce({
      paymentId: 'payment-1',
      journalEntryId: 'journal-1',
      bookingId: BOOKING_ID,
      outstandingBeforeIdr: 3_550_000n,
      alreadySettled: true
    });

    await expect(
      service.settleBookingManual(
        BOOKING_ID,
        { amount_idr: 3_550_000, method: 'cash' },
        { id: 'actor-1', role: 'admin_finance' }
      )
    ).rejects.toThrow(/operator lain/);
  });
});

describe('settle route role guard', () => {
  const handler = AdminController.prototype.settleBooking;

  function contextFor(roles: string[]): ExecutionContext {
    return {
      getHandler: () => handler,
      getClass: () => AdminController,
      switchToHttp: () => ({
        getRequest: () => ({ headers: {}, user: { id: 'actor-1', roles } })
      })
    } as unknown as ExecutionContext;
  }

  it('declares only admin_finance and admin_super for the handler', () => {
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([
      'admin_finance',
      'admin_super'
    ]);
  });

  it('rejects admin_support at the guard', () => {
    const guard = new RolesGuard(new Reflector());
    expect(() => guard.canActivate(contextFor(['admin_support']))).toThrow(/not permitted/);
    expect(guard.canActivate(contextFor(['admin_finance']))).toBe(true);
  });
});
