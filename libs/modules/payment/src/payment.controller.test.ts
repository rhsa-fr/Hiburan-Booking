import type { ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { AppError } from '@tarlink/core/errors';
import { AuthGuard, ROLES_KEY, RolesGuard, signAccessToken } from '@tarlink/platform/auth';
import { PaymentController } from './payment.controller';
import { PjpWebhookController } from './pjp-webhook.controller';

const SECRET = 'unit-test-secret-value-0001';

interface FakeRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: { id: string; roles: string[] };
}

function contextFor(request: FakeRequest): ExecutionContext {
  return {
    getHandler: () => (): void => undefined,
    getClass: () => class TestController {},
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => undefined,
      getNext: () => undefined
    })
  } as unknown as ExecutionContext;
}

function classGuardsOf(target: new (...args: never[]) => unknown): unknown[] {
  return (Reflect.getMetadata(GUARDS_METADATA, target) as unknown[] | undefined) ?? [];
}

describe('money routes are guarded', () => {
  it('protects the DP charge route with AuthGuard and RolesGuard', () => {
    const guards = classGuardsOf(PaymentController);
    expect(guards).toContain(AuthGuard);
    expect(guards).toContain(RolesGuard);
  });

  it('protects the refund route with AuthGuard and RolesGuard', () => {
    const guards = classGuardsOf(PaymentController);
    expect(guards).toContain(AuthGuard);
    expect(guards).toContain(RolesGuard);
  });

  it('requires an admin role on the refund route', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      PaymentController.prototype.refund
    ) as string[] | undefined;
    expect(roles).toContain('admin_finance');
    expect(roles).toContain('admin_super');
  });

  it('does not require an admin role on the DP charge route', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      PaymentController.prototype.createDpCharge
    ) as string[] | undefined;
    expect(roles).toBeUndefined();
  });

  it('does not require an admin role on the settlement charge route', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      PaymentController.prototype.createSettlementCharge
    ) as string[] | undefined;
    expect(roles).toBeUndefined();
  });

  it('requires an admin role on the manual refund route', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      PaymentController.prototype.refundManual
    ) as string[] | undefined;
    expect(roles).toContain('admin_finance');
    expect(roles).toContain('admin_super');
  });
});

describe('the PJP webhook route stays open for the provider', () => {
  it('applies no guard to the webhook handler', () => {
    expect(classGuardsOf(PjpWebhookController)).toHaveLength(0);
    const methodGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      PjpWebhookController.prototype.handlePjpWebhook
    ) as unknown[] | undefined;
    expect(methodGuards ?? []).toHaveLength(0);
  });
});

describe('AuthGuard on the money routes', () => {
  const guard = new AuthGuard(SECRET);

  it('rejects a request without a bearer token', () => {
    const request: FakeRequest = { headers: {} };
    expect(() => guard.canActivate(contextFor(request))).toThrowError(AppError);
    expect(request.user).toBeUndefined();
  });

  it('takes the identity from the verified token only', () => {
    const token = signAccessToken({ sub: 'customer-1', roles: ['customer'] }, SECRET, 900);
    const request: FakeRequest = {
      headers: { authorization: `Bearer ${token}`, 'x-user-id': 'admin-1' }
    };

    expect(guard.canActivate(contextFor(request))).toBe(true);
    expect(request.user?.id).toBe('customer-1');
    expect(request.user?.roles).toEqual(['customer']);
  });

  it('rejects a token signed with another secret', () => {
    const token = signAccessToken({ sub: 'customer-1', roles: ['customer'] }, 'another-secret-0001', 900);
    const request: FakeRequest = { headers: { authorization: `Bearer ${token}` } };
    expect(() => guard.canActivate(contextFor(request))).toThrowError(AppError);
  });
});

describe('PaymentController methods', () => {
  const fakeService = {
    createSettlementCharge: async (bookingId: string, method: string, opts: unknown) => ({
      id: 'pay-settle-1',
      booking_id: bookingId,
      kind: 'settlement' as const,
      status: 'pending' as const,
      amount_idr: 2_800_000,
      currency: 'IDR' as const,
      method: method as any,
      provider: 'pjp',
      provider_ref: 'REF-1',
      expires_at: '2026-10-22T09:00:00.000Z',
      payment_instruction: { type: 'qris' as const, expires_at: '2026-10-22T09:00:00.000Z' },
      payment: {
        id: 'pay-settle-1',
        booking_id: bookingId,
        kind: 'settlement' as const,
        status: 'pending' as const,
        amount_idr: 2_800_000,
        currency: 'IDR' as const,
        method: method as any,
        provider: 'pjp',
        provider_ref: 'REF-1',
        expires_at: '2026-10-22T09:00:00.000Z',
        paid_at: null
      }
    }),
    getSettlementPaymentByBooking: async (bookingId: string, opts: unknown) => ({
      payment: {
        id: 'pay-settle-1',
        booking_id: bookingId,
        kind: 'settlement' as const,
        status: 'pending' as const,
        amount_idr: 2_800_000,
        currency: 'IDR' as const,
        method: 'qris' as any,
        provider: 'pjp',
        provider_ref: 'REF-1',
        expires_at: '2026-10-22T09:00:00.000Z',
        paid_at: null
      },
      payment_instruction: { type: 'qris' as const, expires_at: '2026-10-22T09:00:00.000Z' }
    }),
    getDpPaymentByBooking: async (bookingId: string, opts: unknown) => ({
      payment: {
        id: 'pay-dp-1',
        booking_id: bookingId,
        kind: 'dp' as const,
        status: 'pending' as const,
        amount_idr: 1_200_000,
        currency: 'IDR' as const,
        method: 'qris' as any,
        provider: 'pjp',
        provider_ref: 'REF-DP-1',
        expires_at: '2026-10-21T10:00:00.000Z',
        paid_at: null
      },
      payment_instruction: { type: 'qris' as const, expires_at: '2026-10-21T10:00:00.000Z' }
    }),
    abandonPendingPayment: async () => ({
      cancelled: true,
      payment_id: 'pay-dp-1'
    }),
    syncPaymentStatus: async () => ({ status: 'paid', updated: true }),
    refundManual: async () => ({
      id: 'refund-1',
      status: 'succeeded',
      is_manual: true
    })
  };

  const controller = new PaymentController(fakeService as any);
  const authReq = { user: { id: 'cust-1', roles: ['customer'] } } as any;
  const validUuid = '123e4567-e89b-12d3-a456-426614174000';

  it('createSettlementCharge validates body and header', async () => {
    await expect(
      controller.createSettlementCharge({ booking_id: 'invalid', method: 'qris' }, 'key-1', authReq)
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await expect(
      controller.createSettlementCharge({ booking_id: validUuid, method: 'qris' }, undefined, authReq)
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const res = await controller.createSettlementCharge(
      { booking_id: validUuid, method: 'qris' },
      'key-1234567890abcdef',
      authReq
    );
    expect(res.data.id).toBe('pay-settle-1');
    expect(res.data.kind).toBe('settlement');
  });

  it('settlementByBooking validates UUID and delegates to service', async () => {
    await expect(controller.settlementByBooking('bad-id', authReq)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });

    const res = await controller.settlementByBooking(validUuid, authReq);
    expect(res.data.payment.kind).toBe('settlement');
  });

  it('dpByBooking delegates to settlement when kind=settlement', async () => {
    const res = await controller.dpByBooking(validUuid, 'settlement', authReq);
    expect(res.data.payment.kind).toBe('settlement');
  });

  it('dpByBooking defaults to dp when kind is omitted', async () => {
    const res = await controller.dpByBooking(validUuid, undefined, authReq);
    expect(res.data.payment.kind).toBe('dp');
  });

  it('abandonPending validates the body and delegates to the service', async () => {
    await expect(
      controller.abandonPending({ booking_id: 'bad', kind: 'dp' }, authReq)
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await expect(
      controller.abandonPending({ booking_id: validUuid, kind: 'refund' }, authReq)
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const res = await controller.abandonPending(
      { booking_id: validUuid, kind: 'dp' },
      authReq
    );
    expect(res.data).toEqual({ cancelled: true, payment_id: 'pay-dp-1' });
  });

  it('syncPayment validates the body and delegates to the service', async () => {
    await expect(
      controller.syncPayment({ booking_id: 'bad', kind: 'settlement' }, authReq)
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await expect(
      controller.syncPayment({ booking_id: validUuid, kind: 'unknown' }, authReq)
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const res = await controller.syncPayment(
      { booking_id: validUuid, kind: 'settlement' },
      authReq
    );
    expect(res.data).toEqual({ status: 'paid', updated: true });
  });

  it('refundManual validates the body and delegates to the service', async () => {
    await expect(
      controller.refundManual(
        validUuid,
        { amount_idr: 500_000, reason: 'ok', transfer_ref: '' },
        'key-1',
        authReq
      )
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const res = await controller.refundManual(
      validUuid,
      {
        amount_idr: '500000',
        reason: 'transfer balik sebagian',
        transfer_ref: 'TRF-0001'
      },
      'key-1234567890abcdef',
      authReq
    );
    expect(res.data).toMatchObject({ id: 'refund-1', status: 'succeeded', is_manual: true });
  });
});
