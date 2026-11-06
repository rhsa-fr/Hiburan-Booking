import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import type { ClaimRequest, IdempotencyRecord } from '@tarlink/platform/idempotency';
import {
  ROLES_KEY,
  RolesGuard,
  type AuthenticatedRequest
} from '@tarlink/platform/auth';
import type { BookingRow } from './rows';

// The settle claim must not borrow the money transaction's client. The only db
// symbol `settleBookingManual` needs is the pool, so the mock exposes just that
// and the tests assert the store was handed the pool sentinel.
const fakeDb = vi.hoisted(() => ({ pool: { kind: 'pool' } }));

vi.mock('@tarlink/core/db', () => ({
  getPool: () => fakeDb.pool
}));

// In-memory idempotency store: same contract as PgIdempotencyStore, no DB.
const fakeIdempotency = vi.hoisted(() => ({
  rows: new Map<string, IdempotencyRecord>(),
  clients: [] as unknown[]
}));

vi.mock('@tarlink/platform/idempotency', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tarlink/platform/idempotency')>();
  const keyOf = (scope: string, key: string, actorId: string | null): string =>
    `${actorId ?? ''}|${scope}|${key}`;

  class FakePgIdempotencyStore {
    constructor(client: unknown) {
      fakeIdempotency.clients.push(client);
    }

    async tryClaim(request: ClaimRequest): Promise<boolean> {
      const id = keyOf(request.scope, request.key, request.actorId);
      if (fakeIdempotency.rows.has(id)) return false;
      fakeIdempotency.rows.set(id, {
        requestHash: request.requestHash,
        status: 'in_progress',
        responseStatus: null,
        responseBody: null,
        lockedUntil: request.lockedUntil,
        expiresAt: request.expiresAt
      });
      return true;
    }

    async read(
      scope: string,
      key: string,
      actorId: string | null
    ): Promise<IdempotencyRecord | null> {
      return fakeIdempotency.rows.get(keyOf(scope, key, actorId)) ?? null;
    }

    async complete(
      scope: string,
      key: string,
      actorId: string | null,
      responseStatus: number,
      responseBody: unknown
    ): Promise<void> {
      const row = fakeIdempotency.rows.get(keyOf(scope, key, actorId));
      if (!row) return;
      row.status = 'completed';
      row.responseStatus = responseStatus;
      // PostgreSQL stores this column as JSONB: round-trip through JSON so a
      // BIGINT leak fails here instead of on the first real retry.
      row.responseBody =
        responseBody === undefined
          ? null
          : (JSON.parse(JSON.stringify(responseBody)) as unknown);
      row.lockedUntil = null;
    }

    async fail(
      scope: string,
      key: string,
      actorId: string | null,
      responseStatus: number
    ): Promise<void> {
      const row = fakeIdempotency.rows.get(keyOf(scope, key, actorId));
      if (!row) return;
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
      const row = fakeIdempotency.rows.get(keyOf(scope, key, actorId));
      if (row) row.lockedUntil = lockedUntil;
    }
  }

  return { ...actual, PgIdempotencyStore: FakePgIdempotencyStore };
});

import type { PaymentService } from '@tarlink/modules/payment';
import { AdminController } from './admin.controller';
import {
  AdminService,
  parseSettleManualBody,
  type SettleContext
} from './admin.service';
import type { AdminRepository } from './admin.repository';

const BOOKING_ID = '11111111-1111-4111-8111-111111111111';
const IDEMPOTENCY_KEY = 'idem-key-0123456789abcdef';
const SETTLE_SCOPE = 'POST /admin/bookings/:id/settle';

/** Claim row the in-memory store keeps for `key`, scoped to the settle route. */
function storedClaim(key: string): IdempotencyRecord | undefined {
  return fakeIdempotency.rows.get(`actor-1|${SETTLE_SCOPE}|${key}`);
}

function context(overrides: Partial<SettleContext> = {}): SettleContext {
  return {
    actor: { id: 'actor-1', role: 'admin_finance' },
    idempotencyKey: IDEMPOTENCY_KEY,
    requestId: null,
    ...overrides
  };
}


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
    fakeIdempotency.rows.clear();
    fakeIdempotency.clients.length = 0;
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
      context({ requestId: longRequestId })
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
        context({ actor: { id: 'actor-1', role: 'admin_super' } })
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
      context()
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
        context()
      )
    ).rejects.toThrow(/operator lain/);
  });

  it('settles once when the same key and payload are retried', async () => {
    const { service, repository, payment } = harness(booking());
    const body = {
      amount_idr: 3_550_000,
      method: 'transfer_manual',
      reference: 'BCA 21/10/2026'
    };

    const first = await service.settleBookingManual(BOOKING_ID, body, context());
    const second = await service.settleBookingManual(BOOKING_ID, body, context());

    expect(payment.settleManual).toHaveBeenCalledTimes(1);
    expect(repository.findBooking).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(second).toMatchObject({
      booking_id: BOOKING_ID,
      payment_id: 'payment-1',
      journal_entry_id: 'journal-1',
      payment_status: 'fully_paid',
      outstanding_before_idr: 3_550_000n,
      already_settled: false
    });
  });

  it('rejects the same key with a different payload', async () => {
    const { service, payment } = harness(booking());

    await service.settleBookingManual(
      BOOKING_ID,
      { amount_idr: 3_550_000, method: 'transfer_manual' },
      context()
    );

    await expect(
      service.settleBookingManual(
        BOOKING_ID,
        { amount_idr: 3_549_999, method: 'cash' },
        context()
      )
    ).rejects.toThrow(/different request payload/);

    expect(payment.settleManual).toHaveBeenCalledTimes(1);
  });

  it('claims through the pool store, never through a transaction client', async () => {
    const { service } = harness(booking());

    await service.settleBookingManual(
      BOOKING_ID,
      { amount_idr: 3_550_000, method: 'cash' },
      context()
    );

    expect(fakeIdempotency.clients).toEqual([fakeDb.pool]);
  });

  it('runs the business callback once per key and payload, but again for a new key', async () => {
    const { service, repository, payment } = harness(booking());
    const body = { amount_idr: 3_550_000, method: 'cash' };

    const first = await service.settleBookingManual(BOOKING_ID, body, context());
    const replay = await service.settleBookingManual(BOOKING_ID, body, context());

    expect(replay).toEqual(first);
    expect(payment.settleManual).toHaveBeenCalledTimes(1);
    expect(repository.findBooking).toHaveBeenCalledTimes(1);

    // A different key is a different intent: the business step runs again.
    const fresh = await service.settleBookingManual(
      BOOKING_ID,
      body,
      context({ idempotencyKey: 'idem-key-fedcba9876543210' })
    );
    expect(fresh).toEqual(first);
    expect(payment.settleManual).toHaveBeenCalledTimes(2);
  });

  it('does not leave a completed claim when the business step throws', async () => {
    const { service, payment } = harness(booking());
    const body = { amount_idr: 3_550_000, method: 'cash' };
    payment.settleManual.mockRejectedValueOnce(new Error('provider down'));

    await expect(service.settleBookingManual(BOOKING_ID, body, context())).rejects.toThrow(
      /provider down/
    );

    // IdempotencyService marks the claim `failed`, never `completed`.
    expect(storedClaim(IDEMPOTENCY_KEY)?.status).toBe('failed');
    expect(storedClaim(IDEMPOTENCY_KEY)?.responseBody).toBeNull();

    // `failed` is retryable: same key + same payload runs the business step again.
    const retried = await service.settleBookingManual(BOOKING_ID, body, context());

    expect(payment.settleManual).toHaveBeenCalledTimes(2);
    expect(retried).toMatchObject({
      booking_id: BOOKING_ID,
      payment_id: 'payment-1',
      already_settled: false
    });
    expect(storedClaim(IDEMPOTENCY_KEY)?.status).toBe('completed');
  });
});

describe('settle route idempotency header', () => {
  const request = {
    user: { id: 'actor-1', roles: ['admin_finance'] }
  } as unknown as AuthenticatedRequest;

  function controller(): { controller: AdminController; settleBookingManual: ReturnType<typeof vi.fn> } {
    const settleBookingManual = vi.fn(async () => ({
      booking_id: BOOKING_ID,
      payment_id: 'payment-1',
      journal_entry_id: 'journal-1',
      payment_status: 'fully_paid' as const,
      outstanding_before_idr: 3_550_000n,
      already_settled: false
    }));
    const instance = new AdminController({
      settleBookingManual
    } as unknown as AdminService);
    return { controller: instance, settleBookingManual };
  }

  it('rejects a request without Idempotency-Key before the service runs', async () => {
    const { controller: instance, settleBookingManual } = controller();

    await expect(
      instance.settleBooking(
        BOOKING_ID,
        { amount_idr: 3_550_000, method: 'cash' },
        undefined,
        undefined,
        request
      )
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Idempotency-Key header is required'
    });

    expect(settleBookingManual).not.toHaveBeenCalled();
  });

  it('forwards the header to the service context', async () => {
    const { controller: instance, settleBookingManual } = controller();
    const body = { amount_idr: 3_550_000, method: 'cash' };

    await instance.settleBooking(BOOKING_ID, body, IDEMPOTENCY_KEY, 'req-1', request);

    expect(settleBookingManual).toHaveBeenCalledWith(BOOKING_ID, body, {
      actor: { id: 'actor-1', role: 'admin_finance' },
      idempotencyKey: IDEMPOTENCY_KEY,
      requestId: 'req-1'
    });
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
