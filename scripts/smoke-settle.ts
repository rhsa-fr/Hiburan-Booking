/**
 * Uji endpoint pelunasan manual (POST /v1/admin/bookings/:id/settle).
 *
 * Sengaja TIDAK memindahkan uang baru: semua kasus di sini idempoten atau
 * ditolak. Satu-satunya efek tulis adalah jurnal yang memang sudah ada.
 *
 * Jalankan: npx vite-node scripts/smoke-settle.ts
 */
import { loadDotEnv } from '../apps/api/src/core/config';
import { closePool, query } from '../apps/api/src/core/db';
import { signAccessToken } from '@tarlink/platform/auth';

loadDotEnv();

const BASE = (process.env.API_BASE_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const SECRET = process.env.JWT_SECRET ?? '';
const SETTLED = '2e78d055-5203-47e0-ba8d-b7a7d69dfc67'; // BK-W2TEST-DP

const results: { name: string; ok: boolean; detail: string }[] = [];

function record(name: string, ok: boolean, detail = ''): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ` | ${detail}` : ''}`);
}

async function call(path: string, token: string, init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${BASE}/v1${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {})
    }
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

function unwrap(body: unknown): Record<string, unknown> | null {
  if (typeof body !== 'object' || body === null) return null;
  const rec = body as Record<string, unknown>;
  return typeof rec.data === 'object' && rec.data !== null ? (rec.data as Record<string, unknown>) : rec;
}

async function main(): Promise<void> {
  if (SECRET.length < 16) throw new Error('JWT_SECRET tidak terbaca');

  const admins = await query<{ id: string; role: string }>(
    `SELECT DISTINCT ON (ur.role::text) u.id, ur.role::text AS role
       FROM users u JOIN user_roles ur ON ur.user_id = u.id
      WHERE ur.role::text IN ('admin_super', 'admin_finance')
      ORDER BY ur.role::text, u.created_at`
  );
  const superId = admins.find((row) => row.role === 'admin_super')?.id;
  const financeId = admins.find((row) => row.role === 'admin_finance')?.id;
  if (!superId || !financeId) throw new Error('butuh user admin_super dan admin_finance di DB');

  const superToken = signAccessToken({ sub: superId, roles: ['admin_super'] }, SECRET, 900);
  const financeToken = signAccessToken({ sub: financeId, roles: ['admin_finance'] }, SECRET, 900);
  const supportToken = signAccessToken({ sub: superId, roles: ['admin_support'] }, SECRET, 900);

  const booking = await query<{
    payment_status: string;
    total_customer_idr: string;
    dp_amount_idr: string;
  }>(`SELECT payment_status::text, total_customer_idr, dp_amount_idr FROM bookings WHERE id = $1`, [SETTLED]);
  if (booking.length === 0) throw new Error('booking acuan tidak ada');
  const outstanding = BigInt(booking[0].total_customer_idr) - BigInt(booking[0].dp_amount_idr);

  const journalsBefore = await query<{ count: string }>(
    `SELECT count(*)::text AS count FROM journal_entries WHERE booking_id = $1`,
    [SETTLED]
  );

  // 1. Idempoten: booking sudah lunas -> tidak boleh ada jurnal baru.
  const replay = await call(`/admin/bookings/${SETTLED}/settle`, financeToken, {
    method: 'POST',
    body: JSON.stringify({ amount_idr: Number(outstanding), method: 'transfer_manual' })
  });
  const replayBody = unwrap(replay.body);
  record(
    'pelunasan ulang tidak menulis jurnal baru',
    (replay.status === 200 || replay.status === 409) &&
      (await query<{ count: string }>(
        `SELECT count(*)::text AS count FROM journal_entries WHERE booking_id = $1`,
        [SETTLED]
      ))[0].count === journalsBefore[0].count,
    `status=${replay.status} already=${String(replayBody?.already_settled ?? replayBody?.alreadySettled)}`
  );

  // 2. Nominal salah -> ditolak.
  const wrong = await call(`/admin/bookings/${SETTLED}/settle`, financeToken, {
    method: 'POST',
    body: JSON.stringify({ amount_idr: Number(outstanding) - 1, method: 'transfer_manual' })
  });
  record('nominal tidak sama sisa tagihan ditolak', wrong.status === 409 || wrong.status === 400, `status=${wrong.status}`);

  // 3. RBAC: admin_support tidak boleh mencatat uang.
  const support = await call(`/admin/bookings/${SETTLED}/settle`, supportToken, {
    method: 'POST',
    body: JSON.stringify({ amount_idr: Number(outstanding), method: 'cash' })
  });
  record('admin_support ditolak', support.status === 403, `status=${support.status}`);

  // 4. Tanpa token -> 401.
  const anon = await call(`/admin/bookings/${SETTLED}/settle`, '', {
    method: 'POST',
    body: JSON.stringify({ amount_idr: Number(outstanding), method: 'cash' })
  });
  record('tanpa token ditolak', anon.status === 401 || anon.status === 403, `status=${anon.status}`);

  // 5. Booking yang masih dp_paid hanya diuji bila ada: tolak nominal 0.
  const dp = await query<{ id: string; total_customer_idr: string; dp_amount_idr: string }>(
    `SELECT id, total_customer_idr, dp_amount_idr FROM bookings
      WHERE payment_status = 'dp_paid' ORDER BY created_at DESC LIMIT 1`
  );
  if (dp.length > 0) {
    const zero = await call(`/admin/bookings/${dp[0].id}/settle`, superToken, {
      method: 'POST',
      body: JSON.stringify({ amount_idr: 0, method: 'cash' })
    });
    record('nominal 0 ditolak tanpa mengubah status', zero.status === 400 || zero.status === 409, `status=${zero.status}`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nRINGKASAN: ${results.length - failed.length}/${results.length} lolos`);
  await closePool();
  // vite-node di Windows kadang crash di teardown libuv bila process.exit()
  // dipanggil saat handle masih closing; biarkan loop selesai sendiri.
  process.exitCode = failed.length === 0 ? 0 : 1;
}

void main().catch(async (error: unknown) => {
  console.error('GAGAL:', (error as Error).message);
  await closePool();
  process.exitCode = 1;
});
