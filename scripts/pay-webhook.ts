/**
 * Menandai pembayaran DP sebagai lunas lewat webhook PJP (HMAC), untuk uji E2E.
 * Tidak ada gateway nyata di repo: ini meniru provider.
 *
 * Jalankan: npx vite-node scripts/pay-webhook.ts <paymentId>
 */
import { createHmac } from 'node:crypto';
import { loadDotEnv } from '../apps/api/src/core/config';
import { closePool, query } from '../apps/api/src/core/db';

loadDotEnv();

const BASE = (process.env.API_BASE_URL ?? 'http://localhost:3001').replace(/\/$/, '');

async function main(): Promise<void> {
  const paymentId = process.argv[2];
  if (!paymentId) throw new Error('pakai: pay-webhook.ts <paymentId>');

  const secret = process.env.PJP_WEBHOOK_SECRET ?? '';
  if (secret.length < 8) throw new Error('PJP_WEBHOOK_SECRET tidak terbaca');

  const rows = await query<{ provider_ref: string; status: string; amount_idr: string }>(
    `SELECT provider_ref, status::text AS status, amount_idr FROM payments WHERE id = $1`,
    [paymentId]
  );
  if (rows.length === 0) throw new Error('payment tidak ditemukan');
  const { provider_ref: providerRef, status, amount_idr: amount } = rows[0];
  if (!providerRef) throw new Error('payment tidak punya provider_ref');
  console.log(`payment=${paymentId} status=${status} amount=${amount} ref=${providerRef}`);

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    id: `evt-${Date.now()}`,
    type: 'payment.paid',
    timestamp,
    data: { provider_ref: providerRef, amount_idr: Number(amount) }
  });
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

  const response = await fetch(`${BASE}/v1/webhooks/pjp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-pjp-signature': signature,
      'x-pjp-timestamp': timestamp
    },
    body
  });
  const result = await response.text();
  console.log(`http=${response.status} ${result}`);

  const after = await query<{ lifecycle_status: string; payment_status: string; settlement_status: string }>(
    `SELECT b.lifecycle_status::text AS lifecycle_status, b.payment_status::text AS payment_status,
            b.settlement_status::text AS settlement_status
       FROM bookings b JOIN payments p ON p.booking_id = b.id WHERE p.id = $1`,
    [paymentId]
  );
  if (after.length > 0) {
    console.log(
      `booking=${after[0].lifecycle_status}/${after[0].payment_status}/${after[0].settlement_status}`
    );
  }
  await closePool();
  process.exitCode = response.ok ? 0 : 1;
}

void main().catch(async (error: unknown) => {
  console.error('GAGAL:', (error as Error).message);
  await closePool();
  process.exitCode = 1;
});
