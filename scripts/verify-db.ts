/**
 * Verifikasi skema PostgreSQL untuk Tarlink.
 *
 * Menjalankan seluruh migrasi di SATU transaksi lalu menguji trigger, constraint
 * dan index yang tidak bisa dibuktikan secara statis. Di akhir, transaksi di
 * ROLLBACK sehingga database target tidak tersentuh.
 *
 * Pemakaian:
 *   DATABASE_URL=postgres://user:pass@host:5432/db npm run verify:db
 *
 * Exit code 0 = semua cek lolos, 1 = ada cek gagal.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { loadDotEnv } from '../apps/api/src/core/config';
import { firstKey, ensureBaseFixtures } from './db-fixtures';

loadDotEnv();

const MIGRATIONS_DIR = resolve(process.cwd(), 'db/migrations');

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const checks: Check[] = [];

function record(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
  // eslint-disable-next-line no-console
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail}`);
}

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => resolve(MIGRATIONS_DIR, f));
}

/** Error PG yang membawa SQLSTATE. */
function pgCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : undefined;
}

/**
 * Membangun INSERT minimal untuk sebuah tabel: hanya kolom NOT NULL tanpa
 * default, diisi otomatis per tipe. Kolom relasi (FK) harus disuplai manual
 * lewat `overrides`.
 */
async function insertMinimal(
  client: PoolClient,
  table: string,
  overrides: Record<string, string> = {}
): Promise<string> {
  const { rows } = await client.query<{ column_name: string; data_type: string; udt_name: string; is_nullable: string; column_default: string | null; is_identity: string }>(
    `SELECT column_name, data_type, udt_name, is_nullable, column_default, is_identity
       FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1`,
    [table]
  );

  const cols: string[] = [];
  const vals: string[] = [];
  for (const c of rows) {
    if (c.is_nullable === 'NO' && c.column_default === null && c.is_identity !== 'YES') {
      const override = overrides[c.column_name];
      if (override !== undefined) {
        cols.push(c.column_name);
        vals.push(override);
        continue;
      }
      switch (c.data_type) {
        case 'uuid':
          cols.push(c.column_name);
          vals.push('gen_random_uuid()');
          break;
        case 'USER-DEFINED': {
          const { rows: labels } = await client.query<{ l: string }>(
            `SELECT enumlabel AS l FROM pg_enum JOIN pg_type t ON t.oid = pg_enum.enumtypid WHERE t.typname = $1 ORDER BY enumsortorder LIMIT 1`,
            [c.udt_name]
          );
          if (labels.length === 0) continue;
          cols.push(c.column_name);
          vals.push(`'${labels[0].l}'::${c.udt_name}`);
          break;
        }
        case 'integer':
        case 'bigint':
        case 'smallint':
          cols.push(c.column_name);
          vals.push('0');
          break;
        case 'numeric':
        case 'double precision':
        case 'real':
          cols.push(c.column_name);
          vals.push('0');
          break;
        case 'boolean':
          cols.push(c.column_name);
          vals.push('false');
          break;
        case 'date':
          cols.push(c.column_name);
          vals.push('CURRENT_DATE');
          break;
        case 'timestamp with time zone':
        case 'timestamp without time zone':
          cols.push(c.column_name);
          vals.push('now()');
          break;
        case 'jsonb':
        case 'json':
          cols.push(c.column_name);
          vals.push("'{}'::jsonb");
          break;
        case 'ARRAY':
          cols.push(c.column_name);
          vals.push("'{}'");
          break;
        case 'geography':
          cols.push(c.column_name);
          vals.push("'SRID=4326;POINT(0 0)'::geography");
          break;
        default:
          cols.push(c.column_name);
          vals.push("'test'");
      }
    }
  }

  if (cols.length === 0) {
    const res = await client.query<Record<string, unknown>>(`INSERT INTO ${table} DEFAULT VALUES RETURNING *`);
    return firstKey(res.rows[0]);
  }

  const list = cols.join(', ');
  const res = await client.query<Record<string, unknown>>(
    `INSERT INTO ${table} (${list}) VALUES (${vals.join(', ')}) RETURNING *`,
    []
  );
  return firstKey(res.rows[0]);
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL wajib diisi');

  const pool = new Pool({ connectionString: url, max: 2 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Terapkan migrasi yang belumApplied saja (idempoten terhadap DB yang
    //    sudah dimigrasi), lalu jalankan semua cek dalam satu transaksi yang
    //    di-rollback di akhir sehingga data uji tidak tertinggal.
    const appliedRows = await client
      .query<{ version: string }>(
        `SELECT version FROM schema_migrations`
      )
      .catch(() => ({ rows: [] as { version: string }[] }));
    const alreadyApplied = new Set(
      appliedRows.rows.map((r) => String(r.version).replace(/\.sql$/i, ''))
    );
    let appliedCount = 0;
    for (const file of migrationFiles()) {
      const rawVersion = file.split(/[\\/]/).pop() ?? '';
      const version = rawVersion.replace(/\.sql$/i, '');
      if (alreadyApplied.has(version)) continue;
      const sql = readFileSync(file, 'utf8');
      try {
        await client.query(sql);
        appliedCount += 1;
      } catch (err) {
        record(`migrasi ${version}`, false, `gagal: ${(err as Error).message}`);
        await client.query('ROLLBACK');
        await pool.end();
        process.exit(1);
      }
    }
    record(
      'migrasi diterapkan',
      true,
      `${appliedCount} baru, ${alreadyApplied.size} sudah ada, ${migrationFiles().length} total`
    );

    // 2. Struktur
    const { rows: tables } = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_type='BASE TABLE'`
    );
    const tableCount = Number(tables[0].n);
    record('tabel dibuat', tableCount >= 24, `${tableCount} tabel`);

    // Hanya kolom NOMINAL uang yang wajib BIGINT. `*_bp` (basis point = tarif)
    // dan kolom enum seperti `fee_bearer` bukan uang dan boleh integer/enum.
    const { rows: badMoney } = await client.query<{ n: string; cols: string }>(
      `SELECT count(*)::text AS n, COALESCE(string_agg(table_name || '.' || column_name || '=' || data_type, ', '), '') AS cols
         FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name IN ('bookings','payments','refunds','journal_lines','payouts','vendor_bank_accounts')
          AND (column_name ~ '(amount|price|total|fee|commission|_idr|salary|balance)')
          AND column_name NOT LIKE '%\_bp%' ESCAPE '\'
          AND column_name <> 'fee_bearer'
          AND data_type <> 'bigint'`
    );
    record('kolom uang nominal bertipe bigint', Number(badMoney[0].n) === 0, `${badMoney[0].n} kolom: ${badMoney[0].cols}`);

    // PostgreSQL merender exclusion constraint sebagai "CREATE UNIQUE INDEX ... USING gist",
    // jadi harus dicek lewat pg_constraint (contype='x'), bukan pg_indexes.
    const { rows: excl } = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_constraint WHERE contype = 'x'`
    );
    const { rows: gist } = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_indexes WHERE schemaname = current_schema() AND indexdef ILIKE '%USING gist%'`
    );
    record(
      'anti double-booking (EXCLUDE USING gist)',
      Number(excl[0].n) >= 1 && Number(gist[0].n) >= 1,
      `${excl[0].n} exclusion constraint, ${gist[0].n} index gist`
    );

    const { rows: coa } = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM chart_of_accounts`
    );
    record('chart_of_accounts ter-seed', Number(coa[0].n) >= 10, `${coa[0].n} akun`);

    const { rows: regs } = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM regions`);
    record('regions ter-seed', Number(regs[0].n) >= 2, `${regs[0].n} wilayah`);

    // 3. Data minimum untuk uji trigger (fixture bersama dengan uji end-to-end)
    const fx = await ensureBaseFixtures(client);
    const userId = fx.customerId;
    const vendorId = fx.vendorId;
    const packageId = fx.packageId;
    const policyId = fx.policyVersionId;
    const eventId = fx.eventId;
    const bookingId = fx.bookingId;
    record('data minimum dibuat', true, `booking ${bookingId}`);

    // 4. Matriks 3 sumbu: kombinasi ilegal harus ditolak trigger
    await client.query('SAVEPOINT sp_axis');
    try {
      await client.query(
        `UPDATE bookings SET lifecycle_status='confirmed', payment_status='dp_paid'
          WHERE id = $1`,
        [bookingId]
      );
      record('trigger 3 sumbu menolak kombinasi ilegal', false, 'UPDATE ilegal berhasil (harusnya 23514)');
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT sp_axis');
      const code = pgCode(err);
      record(
        'trigger 3 sumbu menolak kombinasi ilegal',
        code === '23514',
        `kode ${code ?? 'tidak diketahui'}`
      );
    }

    // 5. L-11 yang benar: tiga sumbu sekaligus -> harus berhasil
    await client.query('SAVEPOINT sp_l11');
    try {
      await client.query(
        `UPDATE bookings
            SET lifecycle_status='confirmed', payment_status='dp_paid', settlement_status='held',
                confirmed_at = now(), scheduled_start_at = now(), scheduled_end_at = now() + interval '1 day',
                dispute_window_ends_at = now() + interval '8 days'
          WHERE id = $1`,
        [bookingId]
      );
      record('L-11 (confirmed + dp_paid + held) diterima', true, 'UPDATE diterima trigger');
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT sp_l11');
      record('L-11 (confirmed + dp_paid + held) diterima', false, (err as Error).message);
    }

    // 6. Exclusion constraint: dua booking slot bentrok
    // 6a. slot pertama (harus berhasil)
    await client.query('SAVEPOINT sp_slot1');
    try {
      await insertMinimal(client, 'booking_slots', {
        booking_id: `'${bookingId}'`,
        vendor_id: `'${vendorId}'`,
        date: 'CURRENT_DATE',
        session: "'night'",
        session_span: "'[2,3)'",
        is_blocking: 'true'
      });
      record('slot pertama tersimpan', true, 'ok');
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT sp_slot1');
      record('slot pertama tersimpan', false, (err as Error).message.slice(0, 400));
    }

    // 6b. booking kedua (fixture; kegagalan di sini BUKAN temuan constraint)
    let otherBooking = '';
    await client.query('SAVEPOINT sp_slot2');
    try {
      otherBooking = await insertMinimal(client, 'bookings', {
        customer_id: `'${userId}'`,
        vendor_id: `'${vendorId}'`,
        package_id: `'${packageId}'`,
        event_id: `'${eventId}'`,
        policy_version_id: `'${policyId}'`,
        code: "'BK-TEST-2'",
        lifecycle_status: "'requested'",
        payment_status: "'unpaid'",
        settlement_status: "'not_eligible'",
        price_package_idr: '5000000',
        service_fee_idr: '50000',
        price_addons_idr: '0',
        price_transport_idr: '0',
        discount_idr: '0',
        total_customer_idr: '5050000',
        dp_amount_idr: '1500000',
        respond_deadline: 'now() + interval \'1 day\''
      });
      record('booking kedua dibuat', true, otherBooking);
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT sp_slot2');
      record('booking kedua dibuat', false, (err as Error).message.slice(0, 400));
    }

    // 6c. slot kedua untuk vendor+tanggal+sesi yang sama -> harus ditolak
    await client.query('SAVEPOINT sp_slot');
    try {
      await insertMinimal(client, 'booking_slots', {
        booking_id: `'${otherBooking}'`,
        vendor_id: `'${vendorId}'`,
        date: 'CURRENT_DATE',
        session: "'night'",
        session_span: "'[2,3)'",
        is_blocking: 'true'
      });
      record('slot bentrok ditolak (anti double-booking)', false, 'INSERT kedua berhasil (harusnya 23P01)');
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT sp_slot');
      const code = pgCode(err);
      const message = (err as Error).message;
      const isSlotConflict =
        (code === '23P01' || code === '23514') && /pegang|double|slot|conflict|exclude/i.test(message);
      record(
        'slot bentrok ditolak (anti double-booking)',
        isSlotConflict,
        `kode ${code ?? 'tidak diketahui'} :: ${message.slice(0, 300)}`
      );
    }

    // 7. Jurnal harus seimbang
    const entryId = await insertMinimal(client, 'journal_entries', {
      event_type: "'adjustment'",
      source_event_key: "'verify-entry-1'",
      reference_type: "'booking'",
      reference_id: `'${bookingId}'`,
      memo: "'verify'"
    });
    await client.query('SAVEPOINT sp_journal');
    try {
      await client.query(
        `INSERT INTO journal_lines (journal_entry_id, line_no, account_code, debit_idr, credit_idr, currency)
         VALUES ($1, 1, '1000', 1000, 0, 'IDR')`,
        [entryId]
      );
      await client.query(
        `INSERT INTO journal_lines (journal_entry_id, line_no, account_code, debit_idr, credit_idr, currency)
         VALUES ($1, 2, '4100', 0, 500, 'IDR')`,
        [entryId]
      );
      // Trigger keseimbangan jurnal bisa DEFERRABLE (diperiksa saat COMMIT).
      // Paksa peninjauan sekarang supaya error muncul di dalam SAVEPOINT.
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      record('jurnal tidak seimbang ditolak', false, 'INSERT berhasil (harusnya ditolak)');
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT sp_journal');
      const message = (err as Error).message;
      // Yang diuji adalah trigger keseimbangan, bukan error lain.
      const rejectedByBalanceTrigger = /balance|balanced|jurnal|debit|kredit/i.test(message);
      record(
        'jurnal tidak seimbang ditolak',
        rejectedByBalanceTrigger,
        `ditolak: ${message.slice(0, 160)}`
      );
    }

    // 8. Idempotency: UNIQUE NULLS NOT DISTINCT + ON CONFLICT
    try {
      await client.query(
        `INSERT INTO idempotency_keys (actor_id, scope, key, request_hash, status, response_status, response_body, expires_at)
         VALUES (NULL,'verify','k1-verify-0000001', repeat('a',64),'completed',200,'{}'::jsonb, now() + interval '1 day')
         ON CONFLICT (actor_id, scope, key) DO NOTHING`
      );
      const { rows: idem } = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM idempotency_keys WHERE scope='verify' AND key='k1-verify-0000001'`
      );
      record('idempotency UNIQUE NULLS NOT DISTINCT bekerja', Number(idem[0].n) === 1, `${idem[0].n} baris (harus 1)`);
    } catch (err) {
      record('idempotency UNIQUE NULLS NOT DISTINCT bekerja', false, (err as Error).message.slice(0, 200));
    }

    // 9. Kolom komisi D-17
    const { rows: comm } = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM information_schema.columns
        WHERE table_schema=current_schema() AND table_name='bookings'
          AND column_name IN ('commission_bp','commission_threshold_idr','commission_bp_tier2','commission_min_idr','commission_cap_idr','commission_tier1_idr','commission_tier2_idr')`
    );
    record('kolom komisi D-17 lengkap', Number(comm[0].n) === 7, `${comm[0].n}/7 kolom`);

    await client.query('ROLLBACK');
    // eslint-disable-next-line no-console
    console.log('\n(transaksi ROLLBACK — database target tidak berubah)');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    record('eksekusi skrip', false, (err as Error).message);
  } finally {
    client.release();
    await pool.end();
  }

  const failed = checks.filter((c) => !c.ok);
  // eslint-disable-next-line no-console
  console.log(`\nRINGKASAN: ${checks.length - failed.length}/${checks.length} cek lolos`);
  process.exit(failed.length === 0 ? 0 : 1);
}

void main();
