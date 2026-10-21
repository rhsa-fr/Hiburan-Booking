/**
 * Real-database test for the manual settlement money invariants.
 *
 * Opt-in only: `DATABASE_URL` is present in .env on every dev machine, so it is
 * not a sufficient gate — a plain `vitest run` would then write a booking,
 * journal and audit row into the dev database on every suite. The test runs
 * only when `RUN_DB_TESTS=1` is set explicitly:
 *   $env:RUN_DB_TESTS='1'; npx vitest run libs/modules/payment/src/settle-manual.integration.test.ts
 *
 * What it proves: one journal entry, one payment row, one audit row; a replay
 * writes nothing; a failure after the journal/audit writes rolls everything
 * back. It creates a fresh `ZZAUDIT-*` booking per run. `journal_entries` and
 * `audit_logs` are append-only (triggers reject DELETE), so the booking that
 * owns the journal cannot be deleted; the remaining test rows are reported in
 * the run summary instead of being silently left behind.
 */
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BookingRepository, BookingService } from '@tarlink/modules/booking';
import { CalendarRepository, CalendarService } from '@tarlink/modules/calendar';
import {
  asBookingPaymentPort,
  PaymentService,
  PgPaymentRepository,
  type BookingPaymentPort
} from '@tarlink/modules/payment';
import { ensureBaseFixtures } from '../../../../scripts/db-fixtures';

const DATABASE_URL = process.env.DATABASE_URL?.trim();
const RUN_DB_TESTS = process.env.RUN_DB_TESTS?.trim() === '1' && Boolean(DATABASE_URL);
const ACTION = 'booking.settle_manual';

interface BookingFixture {
  readonly bookingId: string;
  readonly actorId: string;
  readonly outstanding: bigint;
}

function service(port?: BookingPaymentPort): PaymentService {
  const bookingService = new BookingService(
    new BookingRepository(),
    new CalendarService(new CalendarRepository())
  );
  return new PaymentService({
    repository: new PgPaymentRepository(),
    booking: port ?? asBookingPaymentPort(bookingService),
    idempotencyStore: {} as never
  });
}

describe.skipIf(!RUN_DB_TESTS)('settleManual against PostgreSQL', () => {
  let pool: Pool;
  let fixture: BookingFixture;
  const residue: string[] = [];

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
    const client = await pool.connect();
    try {
      const ids = await ensureBaseFixtures(client);
      const code = `ZZAUDIT-${Date.now().toString().slice(-8)}`;
      await client.query(
        `UPDATE bookings
            SET code = $2,
                lifecycle_status = 'completed',
                payment_status = 'dp_paid',
                settlement_status = 'held',
                completed_at = now(),
                dispute_window_ends_at = now() - interval '1 day'
          WHERE id = $1`,
        [ids.bookingId, code]
      );
      const { rows } = await client.query<{
        total_customer_idr: string;
        dp_amount_idr: string;
      }>(
        `SELECT total_customer_idr, dp_amount_idr FROM bookings WHERE id = $1`,
        [ids.bookingId]
      );
      fixture = {
        bookingId: ids.bookingId,
        actorId: ids.customerId,
        outstanding: BigInt(rows[0].total_customer_idr) - BigInt(rows[0].dp_amount_idr)
      };
    } finally {
      client.release();
    }
  }, 30_000);

  afterAll(async () => {
    if (!pool) return;
    const client = await pool.connect();
    try {
      // Best effort: append-only journal/audit rows keep the booking alive.
      for (const sql of [
        `DELETE FROM outbox_messages WHERE aggregate_id = $1`,
        `DELETE FROM booking_status_history WHERE booking_id = $1`,
        `DELETE FROM payments WHERE booking_id = $1`,
        `DELETE FROM bookings WHERE id = $1`
      ]) {
        try {
          await client.query(sql, [fixture.bookingId]);
        } catch (error) {
          residue.push((error as Error).message);
        }
      }
    } finally {
      client.release();
      await pool.end();
    }
  }, 30_000);

  async function bookingStatus(client: PoolClient): Promise<string> {
    const { rows } = await client.query<{ payment_status: string }>(
      `SELECT payment_status::text AS payment_status FROM bookings WHERE id = $1`,
      [fixture.bookingId]
    );
    return rows[0]?.payment_status ?? 'missing';
  }

  async function counts(client: PoolClient) {
    const journals = await client.query<{ count: string; debit: string; credit: string }>(
      `SELECT count(DISTINCT e.id)::text AS count,
              COALESCE(SUM(l.debit_idr), 0)::text AS debit,
              COALESCE(SUM(l.credit_idr), 0)::text AS credit
         FROM journal_entries e
         JOIN journal_lines l ON l.journal_entry_id = e.id
        WHERE e.booking_id = $1 AND e.event_type = 'settlement_received'`,
      [fixture.bookingId]
    );
    const payments = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM payments WHERE booking_id = $1 AND kind = 'settlement'`,
      [fixture.bookingId]
    );
    const audits = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit_logs
        WHERE action = $2 AND entity_type = 'booking' AND entity_id = $1`,
      [fixture.bookingId, ACTION]
    );
    return {
      journals: journals.rows[0],
      payments: Number(payments.rows[0].count),
      audits: Number(audits.rows[0].count)
    };
  }

  it('rolls back journal, payment and audit when the transaction fails', async () => {
    const failing: BookingPaymentPort = {
      applyDpPaid: async () => undefined,
      applyFullyPaid: async () => {
        // The audit row is already written when this throws.
        throw new Error('simulated booking transition failure');
      }
    };

    await expect(
      service(failing).settleManual({
        bookingId: fixture.bookingId,
        amountIdr: fixture.outstanding,
        method: 'transfer_manual',
        actorId: fixture.actorId,
        audit: {
          action: ACTION,
          actorId: fixture.actorId,
          actorRole: 'admin_finance',
          requestId: 'req-rollback',
          payload: { method: 'transfer_manual' }
        }
      })
    ).rejects.toThrow(/simulated/);

    const client = await pool.connect();
    try {
      expect(await bookingStatus(client)).toBe('dp_paid');
      const after = await counts(client);
      expect(after.journals.count).toBe('0');
      expect(after.payments).toBe(0);
      expect(after.audits).toBe(0);
    } finally {
      client.release();
    }
  }, 30_000);

  it('settles once: balanced journal, manual payment row, one audit row', async () => {
    const result = await service().settleManual({
      bookingId: fixture.bookingId,
      amountIdr: fixture.outstanding,
      method: 'transfer_manual',
      reference: 'BCAAUDIT',
      actorId: fixture.actorId,
      audit: {
        action: ACTION,
        actorId: fixture.actorId,
        actorRole: 'admin_finance',
        requestId: 'req-first',
        payload: { method: 'transfer_manual', reference: 'BCAAUDIT' }
      }
    });

    expect(result.alreadySettled).toBe(false);
    expect(result.outstandingBeforeIdr).toBe(fixture.outstanding);

    const client = await pool.connect();
    try {
      expect(await bookingStatus(client)).toBe('fully_paid');

      const cash = await counts(client);
      expect(cash.journals.count).toBe('1');
      expect(cash.journals.debit).toBe(fixture.outstanding.toString());
      expect(cash.journals.credit).toBe(fixture.outstanding.toString());
      expect(cash.payments).toBe(1);
      expect(cash.audits).toBe(1);

      const payment = await client.query<{ provider: string; method: string; provider_txn_id: string | null }>(
        `SELECT provider, method, provider_txn_id FROM payments
          WHERE booking_id = $1 AND kind = 'settlement'`,
        [fixture.bookingId]
      );
      expect(payment.rows[0]).toMatchObject({
        provider: 'manual',
        method: 'transfer_manual',
        provider_txn_id: 'BCAAUDIT'
      });
    } finally {
      client.release();
    }
  }, 30_000);

  it('replays idempotently: alreadySettled, still one journal/payment/audit', async () => {
    const replay = await service().settleManual({
      bookingId: fixture.bookingId,
      amountIdr: fixture.outstanding,
      method: 'transfer_manual',
      actorId: fixture.actorId,
      audit: {
        action: ACTION,
        actorId: fixture.actorId,
        actorRole: 'admin_finance',
        requestId: 'req-replay',
        payload: { method: 'transfer_manual' }
      }
    });

    expect(replay.alreadySettled).toBe(true);

    const client = await pool.connect();
    try {
      const after = await counts(client);
      expect(after.journals.count).toBe('1');
      expect(after.payments).toBe(1);
      expect(after.audits).toBe(1);
    } finally {
      client.release();
    }
  }, 30_000);
});
