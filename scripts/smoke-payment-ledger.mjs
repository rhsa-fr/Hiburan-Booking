/**
 * Audit cepat: setiap uang yang tercatat di tabel operasional harus punya
 * jurnal ledger yang seimbang.
 *
 * Bukan pengganti `npm run verify:db` (invarian skema/trigger), melainkan
 * pemeriksaan kelengkapan jurnal per baris:
 * - pembayaran `paid` → `dp_received` / `settlement_received`
 * - refund `succeeded` → `refund_recognized` + `refund_disbursed`
 * - booking `released` → `release`
 * - refund manual `succeeded` → wajib punya referensi transfer
 *
 * Jalankan: node --env-file=.env scripts/smoke-payment-ledger.mjs
 * Tidak menulis apa pun; hanya SELECT.
 */
import { Client } from 'pg';

const client = new Client({ connectionString: process.env.DATABASE_URL });
const checks = [];

function check(name, ok, detail) {
  checks.push({ name, ok, detail });
}

async function main() {
  await client.connect();

  const unbalanced = await client.query(`
    SELECT je.id, je.event_type,
           sum(jl.debit_idr)::text AS debit, sum(jl.credit_idr)::text AS credit
      FROM journal_entries je
      JOIN journal_lines jl ON jl.journal_entry_id = je.id
     GROUP BY je.id, je.event_type
    HAVING sum(jl.debit_idr) <> sum(jl.credit_idr)
  `);
  check(
    'semua jurnal seimbang',
    unbalanced.rowCount === 0,
    `${unbalanced.rowCount} jurnal tidak seimbang`
  );

  const missingPayment = await client.query(`
    SELECT p.id, p.kind::text, p.provider_ref
      FROM payments p
     WHERE p.status::text = 'paid'
       AND NOT EXISTS (
             SELECT 1 FROM journal_entries je
              WHERE je.reference_type = 'payment'
                AND je.reference_id = p.id
                AND je.event_type = CASE
                      WHEN p.kind::text = 'dp' THEN 'dp_received'
                      ELSE 'settlement_received'
                    END
           )
  `);
  check(
    'setiap pembayaran paid punya jurnal',
    missingPayment.rowCount === 0,
    `${missingPayment.rowCount} pembayaran tanpa jurnal`
  );

  const missingRefund = await client.query(`
    SELECT r.id
      FROM refunds r
     WHERE r.status::text = 'succeeded'
       AND (
             NOT EXISTS (
               SELECT 1 FROM journal_entries je
                WHERE je.reference_type = 'refund'
                  AND je.reference_id = r.id
                  AND je.event_type = 'refund_recognized'
             )
             OR NOT EXISTS (
               SELECT 1 FROM journal_entries je
                WHERE je.reference_type = 'refund'
                  AND je.reference_id = r.id
                  AND je.event_type = 'refund_disbursed'
             )
           )
  `);
  check(
    'setiap refund succeeded punya jurnal pengakuan + pencairan',
    missingRefund.rowCount === 0,
    `${missingRefund.rowCount} refund tanpa jurnal lengkap`
  );

  const missingRelease = await client.query(`
    SELECT b.id
      FROM bookings b
     WHERE b.settlement_status::text = 'released'
       AND NOT EXISTS (
             SELECT 1 FROM journal_entries je
              WHERE je.booking_id = b.id AND je.event_type = 'release'
           )
  `);
  check(
    'setiap booking released punya jurnal release',
    missingRelease.rowCount === 0,
    `${missingRelease.rowCount} booking tanpa jurnal release`
  );

  const manualWithoutRef = await client.query(`
    SELECT id FROM refunds
     WHERE is_manual
       AND status::text = 'succeeded'
       AND (provider_refund_id IS NULL OR btrim(provider_refund_id) = '')
  `);
  check(
    'refund manual succeeded punya referensi transfer',
    manualWithoutRef.rowCount === 0,
    `${manualWithoutRef.rowCount} refund manual tanpa referensi`
  );

  await client.end();

  for (const item of checks) {
    console.log(`${item.ok ? 'PASS' : 'FAIL'} | ${item.name} | ${item.detail}`);
  }
  const failed = checks.filter((item) => !item.ok).length;
  console.log(`\nRINGKASAN: ${checks.length - failed}/${checks.length} cek lolos`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error('audit ledger gagal:', error.message);
  process.exit(1);
});
