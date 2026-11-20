/**
 * Panduan E2E pembayaran sandbox: membuat charge, menunggu pelanggan membayar
 * di simulator Midtrans, lalu memverifikasi status booking + jurnal.
 *
 * Pembayaran tidak bisa diotomatiskan: VA/QRIS harus dibayar di dashboard
 * sandbox Midtrans. Skrip ini menyiapkan charge, memantau `POST /payments/sync`,
 * dan memeriksa bukti ledger setelah `paid`.
 *
 * Pemakaian:
 *   set E2E_EMAIL=qa.b2.520274@tarlink.id
 *   set E2E_PASSWORD=...
 *   node --env-file=.env scripts/smoke-payment-e2e.mjs --booking <uuid>
 *
 * Opsi: --kind dp|settlement (default dp), --method qris|va_bca|...,
 *       --api http://localhost:3001, --timeout 300
 */
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const apiBase = arg('api', process.env.API_BASE_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const bookingId = arg('booking', process.env.E2E_BOOKING_ID);
const kind = arg('kind', 'dp');
const method = arg('method', 'qris');
const timeoutSeconds = Number(arg('timeout', '300'));
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

if (!bookingId) {
  console.error('Wajib: --booking <uuid> (booking accepted/unpaid atau dp_paid)');
  process.exit(1);
}
if (!email || !password) {
  console.error('Wajib: E2E_EMAIL dan E2E_PASSWORD di environment');
  process.exit(1);
}
if (!['dp', 'settlement'].includes(kind)) {
  console.error('--kind harus dp atau settlement');
  process.exit(1);
}

async function json(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`respons bukan JSON (${response.status}): ${text.slice(0, 300)}`);
  }
}

async function login() {
  const response = await fetch(`${apiBase}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const body = await json(response);
  const token = body?.access_token ?? body?.data?.access_token;
  if (!response.ok || !token) {
    throw new Error(`login gagal (${response.status}): ${JSON.stringify(body).slice(0, 300)}`);
  }
  return token;
}

async function createCharge(token) {
  const response = await fetch(`${apiBase}/v1/payments/${kind}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'Idempotency-Key': randomUUID()
    },
    body: JSON.stringify({ booking_id: bookingId, method })
  });
  const body = await json(response);
  if (!response.ok) {
    throw new Error(`charge gagal (${response.status}): ${JSON.stringify(body).slice(0, 500)}`);
  }
  return body.data ?? body;
}

async function sync(token) {
  const response = await fetch(`${apiBase}/v1/payments/sync`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ booking_id: bookingId, kind })
  });
  const body = await json(response);
  if (!response.ok) {
    throw new Error(`sync gagal (${response.status}): ${JSON.stringify(body).slice(0, 300)}`);
  }
  return body.data ?? body;
}

async function verifyLedger(paymentId) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const booking = await client.query(
      'SELECT payment_status::text, lifecycle_status::text FROM bookings WHERE id = $1',
      [bookingId]
    );
    const entry = await client.query(
      "SELECT event_type FROM journal_entries WHERE reference_type = 'payment' AND reference_id = $1",
      [paymentId]
    );
    const balanced = await client.query(
      `SELECT 1
         FROM journal_entries je
         JOIN journal_lines jl ON jl.journal_entry_id = je.id
        WHERE je.reference_id = $1
        GROUP BY je.id
       HAVING sum(jl.debit_idr) = sum(jl.credit_idr)`,
      [paymentId]
    );
    return {
      booking: booking.rows[0] ?? null,
      journal: entry.rows.map((row) => row.event_type),
      balanced: balanced.rowCount > 0
    };
  } finally {
    await client.end();
  }
}

function printInstruction(charge) {
  const instruction = charge.payment_instruction ?? charge.instruction ?? {};
  console.log(`charge ${charge.id} · ${charge.status} · ${charge.method}`);
  console.log(`nominal: Rp${Number(charge.amount_idr).toLocaleString('id-ID')}`);
  if (instruction.type === 'va') {
    console.log(`VA ${instruction.bank ?? ''}: ${instruction.va_number}`);
    if (instruction.biller_code) console.log(`biller code: ${instruction.biller_code}`);
  } else {
    console.log(`QRIS: ${instruction.qr_string ?? instruction.qr_url ?? '(tidak ada payload)'}`);
  }
  console.log(`kedaluwarsa: ${charge.expires_at}`);
}

async function main() {
  const token = await login();
  const charge = await createCharge(token);
  printInstruction(charge);
  console.log('\nBayar tagihan di simulator sandbox Midtrans, lalu skrip akan memantau sync...\n');

  const deadline = Date.now() + timeoutSeconds * 1000;
  let last = 'pending';
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const result = await sync(token);
    if (result.status !== last) {
      console.log(`sync: ${result.status} (updated=${result.updated})`);
      last = result.status;
    }
    if (result.status === 'paid') {
      const evidence = await verifyLedger(charge.id);
      console.log(`booking: ${evidence.booking?.lifecycle_status} / ${evidence.booking?.payment_status}`);
      console.log(`jurnal: ${evidence.journal.join(', ') || '(tidak ada)'} · seimbang=${evidence.balanced}`);
      if (!evidence.journal.length || !evidence.balanced) {
        throw new Error('pembayaran paid tetapi jurnal tidak lengkap/seimbang');
      }
      console.log('\nE2E pembayaran: PASS');
      return;
    }
    if (['expired', 'failed'].includes(result.status)) {
      throw new Error(`tagihan berakhir ${result.status} sebelum dibayar`);
    }
  }
  throw new Error(`timeout ${timeoutSeconds} detik; tagihan masih ${last}`);
}

main().catch((error) => {
  console.error(`\nE2E pembayaran: FAIL — ${error.message}`);
  process.exit(1);
});
