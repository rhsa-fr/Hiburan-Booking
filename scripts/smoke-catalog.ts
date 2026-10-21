/**
 * Uji kontrak endpoint katalog vendor (packet A).
 *
 * Membuat user pemilik uji lebih dulu lewat SQL, lalu menjalankan seluruh
 * alur: buat vendor -> ubah -> verifikasi -> paket -> kalender -> nonaktifkan.
 * Baris uji memakai penanda unik dan sengaja DIBIARKAN supaya panel punya data
 * contoh yang nyata.
 *
 * Jalankan: npm run smoke:catalog
 */
import { Pool } from 'pg';
import { loadDotEnv } from '../apps/api/src/core/config';
import { signAccessToken } from '@tarlink/platform/auth';

loadDotEnv();

const BASE = (process.env.API_BASE_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const SECRET = process.env.JWT_SECRET ?? '';
const RUN = Date.now().toString().slice(-6);

type Json = Record<string, unknown>;

const results: { name: string; ok: boolean; detail: string }[] = [];

function record(name: string, ok: boolean, detail = ''): void {
  results.push({ name, ok, detail });
  // eslint-disable-next-line no-console
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ` | ${detail}` : ''}`);
}

async function call(
  path: string,
  token: string,
  init: RequestInit = {}
): Promise<{ status: number; body: unknown }> {
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

function unwrap(body: unknown): Json | null {
  if (typeof body !== 'object' || body === null) return null;
  const record = body as Json;
  if ('data' in record && typeof record.data === 'object' && record.data !== null) {
    return record.data as Json;
  }
  return record;
}

function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  if (SECRET.length < 16) throw new Error('JWT_SECRET tidak terbaca');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL tidak terbaca');

  // Pemilik vendor dibuat langsung di DB: endpoint registrasi hanya untuk customer.
  const pool = new Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  let ownerId = '';
  let vendorId = '';
  let packageId = '';

  try {
    // Token HARUS memakai user yang benar-benar ada: kolom `verified_by`,
    // `updated_by`, dan `audit_logs.actor_id` punya FK ke users(id).
    const admins = await client.query<{ id: string; role: string }>(
      `SELECT DISTINCT ON (ur.role::text) u.id, ur.role::text AS role
         FROM users u JOIN user_roles ur ON ur.user_id = u.id
        WHERE ur.role::text IN ('admin_super', 'admin_finance')
        ORDER BY ur.role::text, u.created_at`
    );
    const superId = admins.rows.find((row) => row.role === 'admin_super')?.id;
    const financeId = admins.rows.find((row) => row.role === 'admin_finance')?.id;
    if (!superId || !financeId) {
      throw new Error('butuh minimal satu user admin_super dan satu admin_finance di DB');
    }

    const superToken = signAccessToken({ sub: superId, roles: ['admin_super'] }, SECRET, 900);
    const supportToken = signAccessToken({ sub: superId, roles: ['admin_support'] }, SECRET, 900);
    const financeToken = signAccessToken({ sub: financeId, roles: ['admin_finance'] }, SECRET, 900);

    const owner = await client.query<{ id: string }>(
      `INSERT INTO users (phone, email, status) VALUES ($1, $2, 'active') RETURNING id`,
      [`62${RUN}99`, `vendor.${RUN}@tarlink.test`]
    );
    ownerId = owner.rows[0].id;
    // Peran vendor_owner TIDAK diberikan di sini: CHECK di user_roles mewajibkan
    // vendor_scope = vendor_id, dan vendor-nya baru dibuat lewat API di bawah.

    const created = await call('/admin/vendors', superToken, {
      method: 'POST',
      body: JSON.stringify({
        owner_email: `vendor.${RUN}@tarlink.test`,
        region_code: '3212',
        display_name: `Tarling Uji ${RUN}`,
        base_address: 'Jl. Pantura uji, Indramayu'
      })
    });
    const vendor = unwrap(created.body);
    vendorId = typeof vendor?.id === 'string' ? vendor.id : '';
    record('POST /admin/vendors', created.status === 201 && Boolean(vendorId), `status=${created.status} id=${vendorId}`);

    if (!vendorId) throw new Error('vendor tidak terbentuk, sisa uji dilewati');

    const duplicate = await call('/admin/vendors', superToken, {
      method: 'POST',
      body: JSON.stringify({
        owner_email: `vendor.${RUN}@tarlink.test`,
        region_code: '3212',
        display_name: 'Duplikat'
      })
    });
    record('vendor ganda ditolak', duplicate.status === 409, `status=${duplicate.status}`);

    const patched = await call(`/admin/vendors/${vendorId}`, superToken, {
      method: 'PATCH',
      body: JSON.stringify({ description: 'Diubah oleh smoke test', min_dp_bp: 3000 })
    });
    record('PATCH /admin/vendors/:id', patched.status === 200, `status=${patched.status}`);

    const rejectedBySupport = await call(`/admin/vendors/${vendorId}/verify`, supportToken, {
      method: 'POST',
      body: JSON.stringify({ decision: 'approve' })
    });
    record('verifikasi khusus admin_super', rejectedBySupport.status === 403, `status=${rejectedBySupport.status}`);

    const verified = await call(`/admin/vendors/${vendorId}/verify`, superToken, {
      method: 'POST',
      body: JSON.stringify({ decision: 'approve', note: 'Dokumen lengkap' })
    });
    const verifyBody = unwrap(verified.body);
    record(
      'POST /admin/vendors/:id/verify',
      verified.status === 200 && verifyBody?.verification_status === 'approved',
      `status=${verified.status} state=${String(verifyBody?.verification_status)}`
    );

    const pkg = await call(`/admin/vendors/${vendorId}/packages`, financeToken, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Paket Uji 4 jam',
        duration_minutes: 240,
        base_price_idr: 3500000
      })
    });
    const pkgBody = unwrap(pkg.body);
    packageId = typeof pkgBody?.id === 'string' ? pkgBody.id : '';
    record('POST /admin/vendors/:id/packages', pkg.status === 201 && Boolean(packageId), `status=${pkg.status}`);

    const listed = await call(`/admin/vendors/${vendorId}/packages`, superToken);
    const listedBody = unwrap(listed.body);
    const items = Array.isArray(listedBody?.items) ? (listedBody.items as Json[]) : [];
    record('GET /admin/vendors/:id/packages', listed.status === 200 && items.length >= 1, `items=${items.length}`);

    if (packageId) {
      const edited = await call(`/admin/vendors/${vendorId}/packages/${packageId}`, financeToken, {
        method: 'PATCH',
        body: JSON.stringify({ base_price_idr: 3750000 })
      });
      const editedBody = unwrap(edited.body);
      record(
        'PATCH paket (harga)',
        edited.status === 200 && Number(editedBody?.base_price_idr) === 3750000,
        `status=${edited.status} price=${String(editedBody?.base_price_idr)}`
      );
    }

    const from = isoDate(20);
    const to = isoDate(22);
    const wrote = await call(`/admin/vendors/${vendorId}/calendar`, financeToken, {
      method: 'PUT',
      body: JSON.stringify({ from, to, status: 'available', sessions: ['night'] })
    });
    const wroteBody = unwrap(wrote.body);
    record(
      'PUT kalender (bulk, 3 hari)',
      wrote.status === 200 && Number(wroteBody?.updated) >= 3,
      `status=${wrote.status} updated=${String(wroteBody?.updated)}`
    );

    const read = await call(
      `/admin/vendors/${vendorId}/calendar?from=${from}&to=${to}`,
      superToken
    );
    const readBody = unwrap(read.body);
    const days = Array.isArray(readBody?.days) ? (readBody.days as Json[]) : [];
    const available = days.filter((day) => day.status === 'available').length;
    record('GET kalender membaca hasil tulis', read.status === 200 && available >= 3, `available=${available}/${days.length}`);

    if (packageId) {
      const removed = await call(`/admin/vendors/${vendorId}/packages/${packageId}`, financeToken, {
        method: 'DELETE'
      });
      record('DELETE paket (soft delete)', removed.status === 204, `status=${removed.status}`);

      const after = await call(`/admin/vendors/${vendorId}/packages`, superToken);
      const afterBody = unwrap(after.body);
      const afterItems = Array.isArray(afterBody?.items) ? (afterBody.items as Json[]) : [];
      const target = afterItems.find((item) => item.id === packageId);
      record('paket nonaktif, bukan hilang', Boolean(target) && target?.is_active === false, `active=${String(target?.is_active)}`);
    }
  } finally {
    client.release();
    await pool.end();
  }

  const failed = results.filter((r) => !r.ok);
  // eslint-disable-next-line no-console
  console.log(`\nVENDOR UJI: ${vendorId}`);
  // eslint-disable-next-line no-console
  console.log(`RINGKASAN: ${results.length - failed.length}/${results.length} lolos`);
  process.exit(failed.length === 0 ? 0 : 1);
}

void main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('GAGAL:', (error as Error).message);
  process.exit(1);
});
