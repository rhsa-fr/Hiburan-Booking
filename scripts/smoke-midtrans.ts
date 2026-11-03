/**
 * Temporary live smoke test for the Midtrans sandbox adapter.
 * Never prints the server key. Safe to delete after running.
 */
import { loadDotEnv } from '../apps/api/src/core/config';
import { MidtransGateway } from '../libs/modules/payment/src/midtrans.gateway';
import type { PaymentMethod } from '../libs/modules/payment/src/payment.repository';

loadDotEnv();

const serverKey = process.env.MIDTRANS_SERVER_KEY ?? '';
const isProduction = process.env.MIDTRANS_IS_PRODUCTION === 'true';
const baseUrl = process.env.MIDTRANS_BASE_URL || undefined;

console.log(
  JSON.stringify({
    provider: process.env.PJP_PROVIDER,
    isProduction,
    baseUrl: baseUrl ?? (isProduction ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com'),
    serverKeyPresent: serverKey.length > 0,
    serverKeyLength: serverKey.length,
    clientKeyPresent: Boolean(process.env.MIDTRANS_CLIENT_KEY)
  })
);

const gateway = new MidtransGateway({ serverKey, isProduction, baseUrl });
const stamp = Date.now().toString(36).toUpperCase();
const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

async function run(method: PaymentMethod, label: string): Promise<void> {
  const orderId = `SMOKE-${label}-${stamp}`;
  try {
    const result = await gateway.createCharge({
      paymentId: orderId,
      orderId,
      amountIdr: 1000n,
      method,
      expiresAt
    });
    const instruction = result.instruction;
    console.log(
      JSON.stringify({
        label,
        ok: true,
        orderId,
        providerTxnId: result.providerTxnId,
        type: instruction.type,
        qrUrl: instruction.qr_url ? instruction.qr_url.slice(0, 90) : undefined,
        vaNumber: instruction.va_number,
        bank: instruction.bank,
        billerCode: instruction.biller_code
      })
    );
  } catch (error) {
    console.log(
      JSON.stringify({
        label,
        ok: false,
        orderId,
        error: error instanceof Error ? error.message : String(error),
        details: (error as { details?: unknown }).details
      })
    );
  }
}

async function main(): Promise<void> {
  await run('qris', 'QRIS');
  await run('va_bca', 'BCA');
  await run('va_mandiri', 'MANDIRI');
}

void main();
