import { describe, expect, it } from 'vitest';
import { IrisGateway } from './iris.gateway';
import { createPayoutGateway } from './gateway.factory';
import { LocalPayoutGateway } from './local-payout.gateway';

const beneficiary = {
  bankCode: 'bca',
  accountNumber: '1234567890',
  accountHolderName: 'Budi'
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('IrisGateway', () => {
  it('sends the documented create payload with basic auth', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const gateway = new IrisGateway({
      apiKey: 'iris-key',
      fetchImpl: async (url, init) => {
        captured = { url: String(url), init: init ?? {} };
        return jsonResponse({
          payouts: [{ reference_no: 'ref-1', status: 'queued', id: 'iris-1' }]
        });
      }
    });

    const result = await gateway.createPayout({
      referenceNo: 'ref-1',
      amountIdr: 1_500_000n,
      beneficiary,
      notes: 'Payout PO-1'
    });

    expect(result.status).toBe('queued');
    expect(result.providerRef).toBe('ref-1');
    expect(result.providerPayoutId).toBe('iris-1');
    expect(captured!.url).toBe('https://app.sandbox.midtrans.com/iris/api/v1/payouts');
    expect(captured!.init.method).toBe('POST');
    const headers = captured!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from('iris-key:').toString('base64')}`);
    const body = JSON.parse(String(captured!.init.body)) as {
      payouts: Array<Record<string, string>>;
    };
    expect(body.payouts[0]).toMatchObject({
      beneficiary_name: 'Budi',
      beneficiary_account: '1234567890',
      beneficiary_bank: 'bca',
      amount: '1500000',
      reference_no: 'ref-1'
    });
  });

  it('recovers from a duplicate reference by reading the existing payout', async () => {
    const calls: string[] = [];
    const gateway = new IrisGateway({
      apiKey: 'iris-key',
      fetchImpl: async (url, init) => {
        calls.push(`${init?.method ?? 'GET'} ${String(url)}`);
        if (init?.method === 'POST') {
          return jsonResponse({ error_message: 'reference_no already exist' }, 400);
        }
        return jsonResponse({ reference_no: 'ref-1', status: 'completed' });
      }
    });

    const result = await gateway.createPayout({
      referenceNo: 'ref-1',
      amountIdr: 10_000n,
      beneficiary,
      notes: 'retry'
    });

    expect(result.status).toBe('completed');
    expect(result.paidAt).toBeInstanceOf(Date);
    expect(calls).toHaveLength(2);
  });

  it('maps a failed payout with its provider error code', async () => {
    const gateway = new IrisGateway({
      apiKey: 'iris-key',
      fetchImpl: async () =>
        jsonResponse({
          reference_no: 'ref-2',
          status: 'failed',
          error_code: 'INSUFFICIENT_BALANCE',
          error_message: 'Saldo tidak cukup'
        })
    });

    const result = await gateway.getPayout('ref-2');
    expect(result.status).toBe('failed');
    expect(result.failureCode).toBe('INSUFFICIENT_BALANCE');
    expect(result.failureReason).toBe('Saldo tidak cukup');
    expect(result.paidAt).toBeNull();
  });

  it('fails closed without an API key', () => {
    expect(() => new IrisGateway({ apiKey: '' })).toThrow(/IRIS_API_KEY/);
  });
});

describe('createPayoutGateway', () => {
  it('defaults to the local stub', () => {
    expect(createPayoutGateway({}).name).toBe('local');
  });

  it('rejects an unknown provider', () => {
    expect(() => createPayoutGateway({ PAYOUT_PROVIDER: 'xendit' })).toThrow(/tidak dikenal/);
  });
});

describe('LocalPayoutGateway', () => {
  it('completes after the configured delay', async () => {
    let now = 0;
    const gateway = new LocalPayoutGateway({ delayMs: 1000, now: () => new Date(now) });
    await gateway.createPayout({
      referenceNo: 'ref-3',
      amountIdr: 1000n,
      beneficiary,
      notes: 'x'
    });

    expect((await gateway.getPayout('ref-3')).status).toBe('processing');
    now = 1500;
    expect((await gateway.getPayout('ref-3')).status).toBe('completed');
  });

  it('treats an unknown reference as completed so the worker can finish cross-process', async () => {
    const gateway = new LocalPayoutGateway();
    expect((await gateway.getPayout('created-in-another-process')).status).toBe('completed');
  });
});
