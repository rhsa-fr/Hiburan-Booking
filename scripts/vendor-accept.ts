/**
 * Menerima booking sebagai vendor, untuk uji E2E. Vendor seed tidak punya
 * password, jadi token dibentuk langsung dari pemilik vendor di DB.
 *
 * Jalankan: npx vite-node scripts/vendor-accept.ts <bookingId>
 */
import { loadDotEnv } from '../apps/api/src/core/config';
import { closePool, query } from '../apps/api/src/core/db';
import { signAccessToken } from '@tarlink/platform/auth';

loadDotEnv();

const BASE = (process.env.API_BASE_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const SECRET = process.env.JWT_SECRET ?? '';

async function main(): Promise<void> {
  const bookingId = process.argv[2];
  if (!bookingId) throw new Error('pakai: vendor-accept.ts <bookingId>');
  if (SECRET.length < 16) throw new Error('JWT_SECRET tidak terbaca');

  const rows = await query<{ owner_user_id: string; code: string; lifecycle_status: string }>(
    `SELECT v.owner_user_id, b.code, b.lifecycle_status::text AS lifecycle_status
       FROM bookings b JOIN vendors v ON v.id = b.vendor_id
      WHERE b.id = $1`,
    [bookingId]
  );
  if (rows.length === 0) throw new Error('booking tidak ditemukan');
  const { owner_user_id: ownerId, code, lifecycle_status } = rows[0];
  console.log(`booking=${code} status=${lifecycle_status} owner=${ownerId}`);

  const token = signAccessToken({ sub: ownerId, roles: ['vendor_owner'] }, SECRET, 900);
  const response = await fetch(`${BASE}/v1/bookings/${bookingId}/accept`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ note: 'Uji E2E aplikasi pelanggan' })
  });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const booking = (body?.data ?? {}) as Record<string, unknown>;
  console.log(
    `http=${response.status} lifecycle=${String(booking.lifecycle_status)} payment_deadline=${String(
      booking.payment_deadline
    )}`
  );
  if (!response.ok) console.log('respons:', JSON.stringify(body));
  await closePool();
  process.exitCode = response.ok ? 0 : 1;
}

void main().catch(async (error: unknown) => {
  console.error('GAGAL:', (error as Error).message);
  await closePool();
  process.exitCode = 1;
});
