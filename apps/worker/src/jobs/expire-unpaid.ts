import { enqueue } from '../../../../libs/platform/outbox/src/index';
import { query, withTransaction } from '../db';
import { errorMessage, logLine } from '../log';
import { shouldExpireUnpaid } from './decisions';
import type { JobStats } from './runner';

interface CandidateRow {
  id: string;
}

interface BookingRow {
  id: string;
  code: string;
  vendor_id: string;
  lifecycle_status: string;
  payment_status: string;
  payment_deadline: Date | null;
  row_version: number;
}

const SELECT_DUE_SQL = `
SELECT b.id
  FROM bookings b
 WHERE b.lifecycle_status = 'accepted'
   AND b.payment_deadline IS NOT NULL
   AND b.payment_deadline < now()
   AND NOT EXISTS (
         SELECT 1 FROM payments p
          WHERE p.booking_id = b.id
            AND p.kind = 'dp'
            AND p.status = 'paid')
 ORDER BY b.payment_deadline, b.id
 LIMIT $1
`;

const SELECT_FOR_UPDATE_SQL = `
SELECT id, code, vendor_id, lifecycle_status, payment_status, payment_deadline, row_version
  FROM bookings
 WHERE id = $1
 FOR UPDATE
`;

// `bookings` has no `expired_at` column (001_core.sql); the expiry instant is
// recorded by the lifecycle history row's created_at.
const UPDATE_SQL = `
UPDATE bookings
   SET lifecycle_status = 'expired',
       row_version = row_version + 1
 WHERE id = $1
   AND lifecycle_status = 'accepted'
   AND payment_status = 'unpaid'
 RETURNING id
`;

const INSERT_HISTORY_SQL = `
INSERT INTO booking_status_history
  (booking_id, axis, from_state, to_state, event, actor_id, actor_role, note)
VALUES ($1, 'lifecycle', 'accepted', 'expired', 'booking.expire', NULL, NULL, $2)
`;

const RELEASE_BOOKING_SLOTS_SQL = `
UPDATE booking_slots
   SET is_blocking = false
 WHERE booking_id = $1
   AND is_blocking
`;

// `calendar_slot_source` (001_core.sql) only has vendor | offline_job | admin |
// booking | system — there is no 'manual' value, so the worker uses 'system'.
const RELEASE_CALENDAR_SLOTS_SQL = `
UPDATE calendar_slots
   SET status = 'available',
       booking_id = NULL,
       hold_expires_at = NULL,
       source = 'system'
 WHERE booking_id = $1
   AND status = 'held'
`;

/**
 * L-14: `accepted` bookings whose D-18 payment deadline passed without a
 * successful DP are expired and their hold is released.
 *
 * The paid-DP check is repeated inside the transaction: a payment may land
 * between the selection query and the update.
 */
export async function runExpireUnpaid(batch: number): Promise<JobStats> {
  const rows = await query<CandidateRow>(SELECT_DUE_SQL, [batch]);
  const stats: JobStats = { processed: 0, skipped: 0, failed: 0 };

  for (const row of rows) {
    try {
      const changed = await withTransaction(async (client) => {
        const locked = await client.query<BookingRow>(SELECT_FOR_UPDATE_SQL, [row.id]);
        const booking = locked.rows[0];
        if (!booking) return false;

        const paidDp = await client.query(
          `SELECT 1 FROM payments WHERE booking_id = $1 AND kind = 'dp' AND status = 'paid' LIMIT 1`,
          [booking.id]
        );

        const now = new Date();
        if (
          !shouldExpireUnpaid(
            {
              lifecycle_status: booking.lifecycle_status,
              payment_status: booking.payment_status,
              payment_deadline: booking.payment_deadline,
              has_paid_dp: paidDp.rows.length > 0
            },
            now
          )
        ) {
          return false;
        }

        const updated = await client.query(UPDATE_SQL, [booking.id]);
        if (updated.rows.length === 0) return false;

        // Free the reservation first: clearing `is_blocking` drops the row from
        // the exclusion constraints and the calendar-sync trigger stays inert.
        await client.query(RELEASE_BOOKING_SLOTS_SQL, [booking.id]);
        await client.query(RELEASE_CALENDAR_SLOTS_SQL, [booking.id]);

        await client.query(INSERT_HISTORY_SQL, [
          booking.id,
          'payment_deadline passed without DP (worker)'
        ]);

        await enqueue(
          client,
          'booking.expired',
          {
            booking_id: booking.id,
            code: booking.code,
            vendor_id: booking.vendor_id,
            lifecycle_status: 'expired',
            payment_deadline: booking.payment_deadline?.toISOString() ?? null
          },
          {
            aggregateType: 'booking',
            aggregateId: booking.id,
            aggregateVersion: booking.row_version + 1,
            dedupeKey: `booking.expired:${booking.id}`
          }
        );

        return true;
      });

      if (changed) stats.processed += 1;
      else stats.skipped += 1;
    } catch (err) {
      stats.failed += 1;
      logLine(`job=expire_unpaid failed=1 booking=${row.id} error=${errorMessage(err)}`);
    }
  }

  return stats;
}
