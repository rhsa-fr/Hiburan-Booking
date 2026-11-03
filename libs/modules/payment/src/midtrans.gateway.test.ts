import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MidtransGateway } from './midtrans.gateway';

const SERVER_KEY = 'SB-Mid-server-test';
const EXPIRES = new Date('2026-10-21T10:00:00.000Z');
const NOW = new Date('2026-10-21T09:00:00.000Z');

function fakeFetch(response: unknown, status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify(response), {
      status,
      headers: { 'content-type': 'application/json' }
    });
  }) as typeof fetch;
  return { impl, calls };
}

function gateway(response: unknown, status = 200) {
  const fetch = fakeFetch(response, status);
  const instance = new MidtransGateway({
    serverKey: SERVER_KEY,
    fetchImpl: fetch.impl,
    now: () => NOW
  });
  return { instance, calls: fetch.calls };
}

function bodyOf(call: { init: RequestInit }): Record<string, unknown> {
  return JSON.parse(String(call.init.body)) as Record<string, unknown>;
}

describe('MidtransGateway', () => {
  it('requires a server key', () => {
    expect(() => new MidtransGateway({ serverKey: '' })).toThrow(/MIDTRANS_SERVER_KEY/);
  });

  it('creates a QRIS charge and returns the provider QR image URL', async () => {
    const { instance, calls } = gateway({
      status_code: '201',
      transaction_id: 'tx-qris',
      order_id: 'order-1',
      transaction_status: 'pending',
      actions: [
        { name: 'generate-qr-code', method: 'GET', url: 'https://example.test/qr.png' }
      ]
    });

    const result = await instance.createCharge({
      paymentId: 'payment-1',
      orderId: 'order-1',
      amountIdr: 1_200_000n,
      method: 'qris',
      expiresAt: EXPIRES
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.sandbox.midtrans.com/v2/charge');
    expect(calls[0]?.init.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from(`${SERVER_KEY}:`).toString('base64')}`
    });
    const body = bodyOf(calls[0]!);
    expect(body.payment_type).toBe('qris');
    expect(body.transaction_details).toEqual({
      order_id: 'order-1',
      gross_amount: 1_200_000
    });
    expect(body.custom_expiry).toEqual({
      order_time: '2026-10-21 16:00:00 +0700',
      expiry_duration: 60,
      unit: 'minute'
    });
    expect(result.providerTxnId).toBe('tx-qris');
    expect(result.instruction).toEqual({
      type: 'qris',
      qr_url: 'https://example.test/qr.png',
      expires_at: EXPIRES.toISOString()
    });
  });

  it('maps a BCA virtual account response', async () => {
    const { instance } = gateway({
      status_code: '201',
      transaction_id: 'tx-bca',
      order_id: 'order-2',
      transaction_status: 'pending',
      va_numbers: [{ bank: 'bca', va_number: '812785002530231' }]
    });

    const result = await instance.createCharge({
      paymentId: 'payment-2',
      orderId: 'order-2',
      amountIdr: 1_200_000n,
      method: 'va_bca',
      expiresAt: EXPIRES
    });

    expect(result.instruction).toEqual({
      type: 'va',
      va_number: '812785002530231',
      bank: 'BCA',
      expires_at: EXPIRES.toISOString()
    });
  });

  it('maps Mandiri Bill to a VA instruction with biller code', async () => {
    const { instance } = gateway({
      status_code: '201',
      transaction_id: 'tx-mandiri',
      order_id: 'order-3',
      transaction_status: 'pending',
      bill_key: '778347787706',
      biller_code: '70012'
    });

    const result = await instance.createCharge({
      paymentId: 'payment-3',
      orderId: 'order-3',
      amountIdr: 1_200_000n,
      method: 'va_mandiri',
      expiresAt: EXPIRES
    });

    expect(result.instruction).toEqual({
      type: 'va',
      va_number: '778347787706',
      bank: 'MANDIRI',
      biller_code: '70012',
      expires_at: EXPIRES.toISOString()
    });
  });

  it('verifies the SHA512 notification signature', () => {
    const { instance } = gateway({});
    const notification = {
      order_id: 'order-1',
      status_code: '200',
      gross_amount: '1200000.00',
      transaction_status: 'settlement',
      transaction_id: 'tx-1',
      fraud_status: 'accept'
    };
    const signature = createHash('sha512')
      .update(`order-1${'200'}${'1200000.00'}${SERVER_KEY}`)
      .digest('hex');

    expect(() => instance.verifyNotification({ ...notification, signature_key: signature })).not.toThrow();
    expect(() =>
      instance.verifyNotification({ ...notification, signature_key: '0'.repeat(128) })
    ).toThrow(/signature_key mismatch/);
  });

  it('classifies settlement as paid and expire as expired', () => {
    const { instance } = gateway({});
    const base = {
      order_id: 'order-1',
      status_code: '200',
      gross_amount: '1200000.00',
      transaction_id: 'tx-1'
    };

    const paid = instance.classifyNotification({
      ...base,
      transaction_status: 'settlement',
      settlement_time: '2026-10-21 09:05:00'
    });
    expect(paid.kind).toBe('paid');
    if (paid.kind === 'paid') {
      expect(paid.event.data).toEqual({
        provider_ref: 'order-1',
        provider_txn_id: 'tx-1',
        amount_idr: '1200000',
        paid_at: '2026-10-21 09:05:00'
      });
    }

    const expired = instance.classifyNotification({ ...base, transaction_status: 'expire' });
    expect(expired.kind).toBe('expired');
  });

  it('refunds a QRIS transaction with the refund key', async () => {
    const { instance, calls } = gateway({
      status_code: '200',
      transaction_id: 'tx-1',
      order_id: 'order-1',
      transaction_status: 'refund',
      refund_chargeback_id: 12,
      refund_key: 'refund-1'
    });

    const result = await instance.refund({
      orderId: 'order-1',
      method: 'qris',
      amountIdr: 1_200_000n,
      reason: 'acara batal',
      refundKey: 'refund-1'
    });

    expect(calls[0]?.url).toBe('https://api.sandbox.midtrans.com/v2/order-1/refund');
    expect(bodyOf(calls[0]!)).toEqual({
      refund_key: 'refund-1',
      amount: 1_200_000,
      reason: 'acara batal'
    });
    expect(result).toMatchObject({
      providerRefundId: '12',
      status: 'refund'
    });
  });

  it('rejects a VA refund instead of pretending it succeeded', async () => {
    const { instance, calls } = gateway({});
    await expect(
      instance.refund({
        orderId: 'order-1',
        method: 'va_bca',
        amountIdr: 1_200_000n,
        reason: 'acara batal',
        refundKey: 'refund-1'
      })
    ).rejects.toThrow(/tidak mendukung refund/);
    expect(calls).toHaveLength(0);
  });
});
