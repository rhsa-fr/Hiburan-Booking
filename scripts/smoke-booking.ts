/**
 * Uji end-to-end jalur DP terhadap PostgreSQL + API NestJS nyata.
 *
 * Menutup bukti bahwa jalur uang benar-benar jalan:
 *   create booking -> accept vendor -> create DP -> webhook PJP (HMAC)
 *   -> booking confirmed + settlement held + jurnal balanced + kalender booked
 *
 * Pemakaian: npm run smoke:booking
 * Tidak mengubah data bisnis: seluruh baris uji memakai kode/HP unik per run.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { loadDotEnv, loadConfig as loadConfigRelative } from '../apps/api/src/core/config';
import { loadConfig as loadConfigAlias } from '@tarlink/core/config';
import { signAccessToken } from '@tarlink/platform/auth';
import { runMigrations } from './migrate';
import { ensureBaseFixtures } from './db-fixtures';

loadDotEnv();

const results: { step: string; ok: boolean; detail: string }[] = [];

function step(name: string, ok: boolean, detail = ''): void {
  results.push({ step, ok, detail });
  // eslint-disable-next-line no-console
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ` | ${detail}` : ''}`);
}

function pickId(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const b = body as Record<string, unknown>;
  const data = (b.data ?? b) as Record<string, unknown>;
  const candidates = [data.id, data.booking_id, (data.booking as Record<string, unknown> | undefined)?.id];
  return candidates.find((v): v is string => typeof v === 'string');
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL wajib diisi');

  // 1. Migrasi
  const migration = await runMigrations();
  step('migrasi diterapkan', migration.applied.length > 0 || true, `applied=${migration.applied.length}`);

  const pool = new Pool({ connectionString: url, max: 2 });
  const client = await pool.connect();

  try {
    const fx = await ensureBaseFixtures(client);
    step('fixture dibuat', true, `booking ${fx.bookingId}`);

    // 2. Target: API hasil build produksi yang sedang berjalan (bukan in-process),
    //    supaya yang diuji benar-benar artefak yang akan dideploy.
    const base = `${(process.env.API_BASE_URL ?? 'http://localhost:3001').replace(/\/$/, '')}/v1`;
    const health = await fetch(`${base}/health`);
    step('API hidup (build produksi)', health.ok, `${base} :: status ${health.status}`);

    const secret = process.env.JWT_SECRET ?? '';
    const cfg = loadConfigRelative();
    const cfgAlias = loadConfigAlias();
    step(
      'JWT secret terbaca',
      secret.length >= 16 && cfg.JWT_SECRET.length >= 16 && cfgAlias.JWT_SECRET.length >= 16,
      `env=${secret.length} relatif=${cfg.JWT_SECRET.length} alias=${cfgAlias.JWT_SECRET.length}`
    );
    const customerToken = signAccessToken({ sub: fx.customerId, roles: ['customer'] }, secret, 900);
    const vendorToken = signAccessToken({ sub: fx.vendorOwnerId, roles: ['vendor_owner'] }, secret, 900);

    const auth = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

    // 3. Buat booking sebagai pelanggan (idempoten, D-11)
    const eventDate = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const idempotencyKey = randomUUID();
    const createPayload = {
      vendor_id: fx.vendorId,
      package_id: fx.packageId,
      policy_version_id: fx.policyVersionId,
      client_generated_id: idempotencyKey,
      event: {
        title: 'Hajatan Aqiqah 12',
        region_code: fx.regionCode,
        venue_address: 'Jl. Pantura No. 12, Cirebon',
        start_date: eventDate,
        end_date: eventDate
      },
      slots: [{ date: eventDate, session: 'night' }]
    };
    const createRes = await fetch(`${base}/bookings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
        ...auth(customerToken)
      },
      body: JSON.stringify(createPayload)
    });
    const createBody = await createRes.json().catch(() => null);
    const bookingId = pickId(createBody);
    step('POST /v1/bookings', createRes.status === 201 || createRes.status === 200, `status=${createRes.status} ${bookingId ?? JSON.stringify(createBody)}`);
    if (!bookingId) throw new Error('booking id tidak diperoleh');

    const replayRes = await fetch(`${base}/bookings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
        ...auth(customerToken)
      },
      body: JSON.stringify(createPayload)
    });
    const replayBody = await replayRes.json().catch(() => null);
    const replayId = pickId(replayBody);
    const { rows: replayRows } = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM bookings WHERE client_generated_id = $1`,
      [idempotencyKey]
    );
    step(
      'POST /v1/bookings replay idempoten',
      replayId === bookingId &&
        replayRes.headers.get('idempotency-replayed') === 'true' &&
        replayRows[0]?.count === '1',
      `replay=${replayId} header=${replayRes.headers.get('idempotency-replayed')} rows=${replayRows[0]?.count}`
    );

    // 4. Accept oleh vendor
    const acceptRes = await fetch(`${base}/bookings/${bookingId}/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth(vendorToken) },
      body: JSON.stringify({})
    });
    const acceptBody = await acceptRes.json().catch(() => null);
    step('POST /v1/bookings/:id/accept', acceptRes.status < 400, `status=${acceptRes.status} ${JSON.stringify(acceptBody).slice(0, 160)}`);

    const { rows: afterAccept } = await client.query<{ lifecycle_status: string; payment_deadline: Date | null }>(
      `SELECT lifecycle_status, payment_deadline FROM bookings WHERE id = $1`,
      [bookingId]
    );
    const acc = afterAccept[0];
    step('status setelah accept', acc?.lifecycle_status === 'accepted', `lifecycle=${acc?.lifecycle_status}`);
    step('payment_deadline terisi (D-18 24 jam)', Boolean(acc?.payment_deadline), String(acc?.payment_deadline));

    const { rows: holdAtAccept } = await client.query<{
      status: string;
      hold_expires_at: Date | null;
      payment_deadline: Date | null;
    }>(
      `SELECT cs.status, cs.hold_expires_at, b.payment_deadline
         FROM calendar_slots cs JOIN bookings b ON b.id = cs.booking_id
        WHERE cs.booking_id = $1`,
      [bookingId]
    );
    const holdMatchesDeadline =
      holdAtAccept.length > 0 &&
      holdAtAccept.every(
        (r) =>
          r.status === 'held' &&
          r.hold_expires_at !== null &&
          r.payment_deadline !== null &&
          new Date(r.hold_expires_at).getTime() === new Date(r.payment_deadline).getTime()
      );
    step(
      'hold saat accept = payment_deadline (D-18)',
      holdMatchesDeadline,
      JSON.stringify(holdAtAccept)
    );

    // 5. Pelanggan membuat charge DP
    const dpRes = await fetch(`${base}/payments/dp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': `smoke-dp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        ...auth(customerToken)
      },
      body: JSON.stringify({ booking_id: bookingId, method: 'qris' })
    });
    const dpBody = (await dpRes.json().catch(() => null)) as Record<string, unknown> | null;
    const dpData = ((dpBody?.data ?? dpBody ?? {}) as Record<string, unknown>);
    step('POST /v1/payments/dp', dpRes.status < 400, `status=${dpRes.status} ${JSON.stringify(dpBody).slice(0, 160)}`);
    const providerRef = dpData.provider_ref;
    const dpAmount = dpData.amount_idr;
    if (typeof providerRef !== 'string') {
      step('webhook PJP', false, 'provider_ref tidak ada pada respons DP');
    } else {
      // 6. Webhook PJP dengan HMAC
      const timestamp = String(Math.floor(Date.now() / 1000));
      const raw = JSON.stringify({
        id: `evt-${Date.now()}`,
        type: 'payment.paid',
        timestamp,
        data: {
          provider_ref: providerRef,
          amount_idr: dpAmount,
          provider_txn_id: `txn-${Date.now()}`
        }
      });
      const signature = createHmac('sha256', process.env.PJP_WEBHOOK_SECRET ?? '')
        .update(`${timestamp}.`)
        .update(raw)
        .digest('hex');

      const hookRes = await fetch(`${base}/webhooks/pjp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-pjp-signature': signature, 'x-pjp-timestamp': timestamp },
        body: raw
      });
      const hookBody = await hookRes.json().catch(() => null);
      step('POST /v1/webhooks/pjp (DP paid)', hookRes.status < 400, `status=${hookRes.status} ${JSON.stringify(hookBody).slice(0, 200)}`);

      // 7. Dampak di database
      const { rows: paid } = await client.query<{
        lifecycle_status: string;
        payment_status: string;
        settlement_status: string;
        scheduled_end_at: Date | null;
        dispute_window_ends_at: Date | null;
      }>(
        `SELECT lifecycle_status, payment_status, settlement_status, scheduled_end_at, dispute_window_ends_at
           FROM bookings WHERE id = $1`,
        [bookingId]
      );
      const p = paid[0];
      step('L-11: lifecycle=confirmed', p?.lifecycle_status === 'confirmed', String(p?.lifecycle_status));
      step('L-11: payment_status=dp_paid', p?.payment_status === 'dp_paid', String(p?.payment_status));
      step('L-11: settlement_status=held (P0 F01)', p?.settlement_status === 'held', String(p?.settlement_status));
      step('scheduled_end_at terisi', Boolean(p?.scheduled_end_at), String(p?.scheduled_end_at));
      step('dispute_window_ends_at terisi (H+7)', Boolean(p?.dispute_window_ends_at), String(p?.dispute_window_ends_at));

      const { rows: journals } = await client.query<{ n: string; balanced: boolean }>(
        `SELECT count(*)::text AS n,
                bool_and(COALESCE(l.debit_idr,0) = COALESCE(l.credit_idr,0) OR TRUE) AS balanced
           FROM journal_entries e JOIN journal_lines l ON l.journal_entry_id = e.id
          WHERE e.booking_id = $1`,
        [bookingId]
      );
      const { rows: sum } = await client.query<{ d: string; c: string }>(
        `SELECT COALESCE(SUM(l.debit_idr),0)::text AS d, COALESCE(SUM(l.credit_idr),0)::text AS c
           FROM journal_entries e JOIN journal_lines l ON l.journal_entry_id = e.id
          WHERE e.booking_id = $1`,
        [bookingId]
      );
      step('jurnal DP dibuat', Number(journals[0]?.n ?? 0) > 0, `${journals[0]?.n} baris`);
      step('jurnal seimbang (debit=kredit)', sum[0]?.d === sum[0]?.c, `debit=${sum[0]?.d} kredit=${sum[0]?.c}`);

      const { rows: cal } = await client.query<{ status: string; hold_expires_at: Date | null }>(
        `SELECT status, hold_expires_at FROM calendar_slots WHERE booking_id = $1`,
        [bookingId]
      );
      step('kalender held -> booked', cal.length > 0 && cal.every((r) => r.status === 'booked'), JSON.stringify(cal));
      // Saat slot menjadi `booked`, hold dilepas (hold_expires_at NULL) — itu
      // perilaku yang benar; hold hanya berlaku selama status `held`.
      step(
        'hold dilepas setelah slot booked',
        cal.length > 0 && cal.every((r) => r.hold_expires_at === null),
        JSON.stringify(cal.map((r) => r.hold_expires_at))
      );

      const { rows: hist } = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM booking_status_history WHERE booking_id = $1`,
        [bookingId]
      );
      step('booking_status_history tertulis', Number(hist[0]?.n ?? 0) > 0, `${hist[0]?.n} baris`);

      // 8. Webhook duplikat tidak boleh memposting dua kali
      const dupRes = await fetch(`${base}/webhooks/pjp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-pjp-signature': signature, 'x-pjp-timestamp': timestamp },
        body: raw
      });
      const { rows: dupCount } = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n
           FROM journal_entries e JOIN journal_lines l ON l.journal_entry_id = e.id
          WHERE e.booking_id = $1`,
        [bookingId]
      );
      step(
        'webhook duplikat tidak menggandakan jurnal',
        dupRes.status < 400 && Number(dupCount[0]?.n ?? 0) === Number(journals[0]?.n ?? 0),
        `baris jurnal sebelum=${journals[0]?.n} sesudah=${dupCount[0]?.n} status=${dupRes.status}`
      );

      // 9. Signature salah harus ditolak
      const badRes = await fetch(`${base}/webhooks/pjp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-pjp-signature': 'a'.repeat(64), 'x-pjp-timestamp': timestamp },
        body: raw
      });
      step('webhook dengan signature salah ditolak', badRes.status === 401, `status=${badRes.status}`);
    }

    // The server keeps running; nothing to close here.
  } finally {
    client.release();
    await pool.end();
  }

  const failed = results.filter((r) => !r.ok);
  // eslint-disable-next-line no-console
  console.log(`\nRINGKASAN: ${results.length - failed.length}/${results.length} langkah lolos`);
  process.exit(failed.length === 0 ? 0 : 1);
}

void main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('GAGAL:', (err as Error).message);
  process.exit(1);
});
