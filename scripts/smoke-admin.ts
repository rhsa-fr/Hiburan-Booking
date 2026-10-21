/**
 * Uji kontrak endpoint admin terhadap API yang benar-benar berjalan.
 *
 * Dipakai setelah `AdminModule` di-wire ke `AppModule`. Memeriksa status HTTP
 * dan keberadaan field tingkat atas yang dipakai panel, bukan seluruh isi
 * respons — tujuannya menangkap kontrak yang bergeser, bukan menguji ulang SQL.
 *
 * Jalankan: npm run smoke:admin
 */
import { loadDotEnv } from '../apps/api/src/core/config';
import { signAccessToken } from '@tarlink/platform/auth';

loadDotEnv();

const BASE = (process.env.API_BASE_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const SECRET = process.env.JWT_SECRET ?? '';
const ADMIN_ID = process.env.SMOKE_ADMIN_ID ?? '00000000-0000-0000-0000-0000000000aa';

interface Result {
  name: string;
  ok: boolean;
  detail: string;
}

const results: Result[] = [];

function record(name: string, ok: boolean, detail = ''): void {
  results.push({ name, ok, detail });
  // eslint-disable-next-line no-console
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ` | ${detail}` : ''}`);
}

async function call(
  path: string,
  init: RequestInit = {}
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${BASE}/v1${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
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

function hasKeys(body: unknown, keys: string[]): { ok: boolean; missing: string[] } {
  if (typeof body !== 'object' || body === null) return { ok: false, missing: keys };
  const data =
    'data' in (body as Record<string, unknown>)
      ? ((body as Record<string, unknown>).data as unknown)
      : body;
  if (typeof data !== 'object' || data === null) return { ok: false, missing: keys };
  const missing = keys.filter((key) => !(key in (data as Record<string, unknown>)));
  return { ok: missing.length === 0, missing };
}

async function main(): Promise<void> {
  if (SECRET.length < 16) throw new Error('JWT_SECRET tidak terbaca dari .env');

  const adminToken = signAccessToken(
    { sub: ADMIN_ID, roles: ['admin_super'] },
    SECRET,
    900
  );
  const financeToken = signAccessToken(
    { sub: ADMIN_ID, roles: ['admin_finance'] },
    SECRET,
    900
  );
  const auth = { authorization: `Bearer ${adminToken}` };
  const finance = { authorization: `Bearer ${financeToken}` };

  // Tanpa token harus 401 di semua endpoint admin.
  for (const path of ['/admin/dashboard', '/admin/bookings', '/admin/release/queue']) {
    const { status } = await call(path);
    record(`401 tanpa token ${path}`, status === 401, `status=${status}`);
  }

  const reads: { path: string; keys: string[]; token?: string }[] = [
    { path: '/admin/dashboard', keys: ['kpis', 'daily_bookings_7d', 'payment_mix'] },
    { path: '/admin/bookings?page=1&page_size=8', keys: ['items', 'total'] },
    { path: '/admin/vendors', keys: ['items', 'total'] },
    { path: '/admin/release/queue', keys: ['candidates', 'max_batch'] },
    { path: '/admin/ledger', keys: ['entries'] },
    { path: '/admin/disputes', keys: ['items', 'open_count'] },
    { path: '/admin/audit', keys: ['events', 'total'] },
    // Kontrak panel untuk dua endpoint ini memakai objek datar; cukup pastikan
    // bentuknya objek, bukan memaksa nama key internal.
    { path: '/admin/payments', keys: [] },
    { path: '/admin/settings', keys: [] },
    { path: '/admin/operators', keys: [] }
  ];

  for (const read of reads) {
    const { status, body } = await call(read.path, { headers: auth });
    const keyCheck = hasKeys(body, read.keys);
    record(
      `GET ${read.path.split('?')[0]}`,
      status === 200 && keyCheck.ok,
      `status=${status}${keyCheck.missing.length ? ` missing=${keyCheck.missing.join(',')}` : ''}`
    );
  }

  // Preview release: ambil satu kandidat, lalu minta pratinjau jurnal.
  const queue = await call('/admin/release/queue', { headers: finance });
  const queueData =
    typeof queue.body === 'object' && queue.body !== null && 'data' in queue.body
      ? ((queue.body as Record<string, unknown>).data as Record<string, unknown>)
      : (queue.body as Record<string, unknown> | null);
  const candidates = Array.isArray(queueData?.candidates)
    ? (queueData.candidates as { booking?: { id?: string } }[])
    : [];
  const firstId = candidates[0]?.booking?.id;

  if (!firstId) {
    record('POST /admin/release/preview', true, 'dilewati: belum ada kandidat siap cair');
  } else {
    const preview = await call('/admin/release/preview', {
      method: 'POST',
      headers: finance,
      body: JSON.stringify({
        booking_ids: [firstId],
        reason: 'Smoke test pencairan otomatis',
        maker: ADMIN_ID,
        checker: '00000000-0000-0000-0000-0000000000bb'
      })
    });
    const keyCheck = hasKeys(preview.body, ['journals']);
    record(
      'POST /admin/release/preview',
      preview.status === 200 && keyCheck.ok,
      `status=${preview.status}${keyCheck.missing.length ? ` missing=${keyCheck.missing.join(',')}` : ''}`
    );
  }

  // Pemisahan peran: admin_support TIDAK boleh mencairkan.
  const supportToken = signAccessToken(
    { sub: ADMIN_ID, roles: ['admin_support'] },
    SECRET,
    900
  );
  const forbidden = await call('/admin/release/preview', {
    method: 'POST',
    headers: { authorization: `Bearer ${supportToken}` },
    body: JSON.stringify({
      booking_ids: ['00000000-0000-0000-0000-000000000000'],
      reason: 'Smoke test peran',
      maker: ADMIN_ID,
      checker: '00000000-0000-0000-0000-0000000000bb'
    })
  });
  record('admin_support ditolak di jalur pencairan', forbidden.status === 403, `status=${forbidden.status}`);

  const failed = results.filter((result) => !result.ok);
  // eslint-disable-next-line no-console
  console.log(`\nRINGKASAN: ${results.length - failed.length}/${results.length} lolos`);
  process.exit(failed.length === 0 ? 0 : 1);
}

void main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('GAGAL:', (error as Error).message);
  process.exit(1);
});
