/**
 * Bukti aturan pelunasan (P-03) pada data nyata.
 *
 * 1. `BK-W2TEST-DP` (completed + dp_paid) -> pelunasan DITOLAK.
 * 2. Booking `confirmed` + `dp_paid` -> pelunasan diterima, status jadi fully_paid.
 *
 * PERINGATAN: `applyFullyPaid` HANYA menggerakkan sumbu payment. Jurnal kas
 * pelunasan ditulis modul payment (webhook PJP), jadi memanggil port ini
 * langsung menghasilkan `fully_paid` tanpa uang tercatat — release berikutnya
 * akan tidak seimbang. Skrip ini menolak jalan tanpa
 * CONFIRM_BYPASS_PAYMENT_JOURNAL=1 dan WAJIB diikuti rollback.
 *
 * Jalankan: $env:CONFIRM_BYPASS_PAYMENT_JOURNAL='1'; npx vite-node scripts/trial-fully-paid.ts
 */
import { loadDotEnv } from '../apps/api/src/core/config';
import { query, withTransaction } from '../apps/api/src/core/db';
import { BookingRepository } from '@tarlink/modules/booking';
import { BookingService } from '@tarlink/modules/booking';
import { CalendarRepository } from '@tarlink/modules/calendar';
import { CalendarService } from '@tarlink/modules/calendar';

loadDotEnv();

const COMPLETED_DP = '2e78d055-5203-47e0-ba8d-b7a7d69dfc67'; // BK-W2TEST-DP

async function state(id: string): Promise<string> {
  const res = await query<{ lifecycle_status: string; payment_status: string; settlement_status: string }>(
    `SELECT lifecycle_status::text, payment_status::text, settlement_status::text FROM bookings WHERE id = $1`,
    [id]
  );
  if (res.length === 0) return '(tidak ada)';
  const row = res[0];
  return `${row.lifecycle_status} / ${row.payment_status} / ${row.settlement_status}`;
}

async function outstanding(id: string): Promise<bigint> {
  const res = await query<{ total_customer_idr: string; dp_amount_idr: string }>(
    `SELECT total_customer_idr, dp_amount_idr FROM bookings WHERE id = $1`,
    [id]
  );
  const row = res[0];
  return BigInt(row.total_customer_idr) - BigInt(row.dp_amount_idr);
}

async function main(): Promise<void> {
  if (process.env.CONFIRM_BYPASS_PAYMENT_JOURNAL !== '1') {
    console.error(
      'DITOLAK: skrip ini melewati jurnal kas pelunasan. Set CONFIRM_BYPASS_PAYMENT_JOURNAL=1 hanya untuk uji, lalu kembalikan datanya.'
    );
    process.exit(2);
  }
  const service = new BookingService(new BookingRepository(), new CalendarService(new CalendarRepository()));

  console.log('[1] completed + dp_paid ->', COMPLETED_DP, '|', await state(COMPLETED_DP));
  try {
    await service.applyFullyPaid({ bookingId: COMPLETED_DP, amountIdr: await outstanding(COMPLETED_DP), now: new Date() });
    console.log('[1] HASIL: diterima (tidak diharapkan)');
  } catch (error) {
    console.log('[1] HASIL: ditolak ->', (error as { code?: string }).code, '|', (error as Error).message);
  }

  // Booking confirmed + dp_paid paling baru, supaya bukti tidak menyentuh data lama.
  const target = await query<{ id: string; code: string }>(
    `SELECT id, code FROM bookings
      WHERE lifecycle_status = 'confirmed' AND payment_status = 'dp_paid'
      ORDER BY created_at DESC LIMIT 1`
  );
  if (target.length === 0) {
    console.log('[2] tidak ada booking confirmed + dp_paid');
    return;
  }
  const id = target[0].id;
  const amount = await outstanding(id);
  console.log('[2]', target[0].code, id, '| sebelum:', await state(id), '| sisa:', amount.toString());

  await withTransaction(async (tx) => {
    await service.applyFullyPaid({ bookingId: id, amountIdr: amount, now: new Date() }, tx);
  });
  console.log('[2] sesudah:', await state(id));

  const journal = await query<{ account_code: string; debit_idr: string; credit_idr: string }>(
    `SELECT l.account_code, l.debit_idr::text, l.credit_idr::text
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.journal_entry_id
      WHERE e.booking_id = $1
      ORDER BY l.account_code`,
    [id]
  );
  console.log('[2] jurnal booking ini:', journal.map((r) => `${r.account_code} D=${r.debit_idr} K=${r.credit_idr}`).join(' | '));
}

void main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error('GAGAL:', (error as Error).message);
    process.exit(1);
  }
);


