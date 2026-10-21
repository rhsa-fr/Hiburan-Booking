import { enqueue } from '../../../../libs/platform/outbox/src/index';
import { query, withTransaction } from '../db';
import { errorMessage, logLine } from '../log';
import { OPEN_DISPUTE_SQL, shouldAutoComplete } from './decisions';
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
  scheduled_end_at: Date;
  row_version: number;
}

/** The only payment states that may auto-complete (see `shouldAutoComplete`). */
const PAYMENT_SETTLED_SQL = `'fully_paid','partially_refunded'`;

const SELECT_DUE_SQL = `
SELECT b.id
  FROM bookings b
 WHERE b.lifecycle_status IN ('confirmed','in_progress')
   AND b.payment_status IN (${PAYMENT_SETTLED_SQL})
   AND b.scheduled_end_at IS NOT NULL
   AND b.scheduled_end_at + interval '3 days' <= now()
   AND NOT EXISTS (
         SELECT 1 FROM disputes d
          WHERE d.booking_id = b.id
            AND d.status IN (${OPEN_DISPUTE_SQL}))
 ORDER BY b.scheduled_end_at, b.id
 LIMIT $1
`;

// Rows that would be due but are blocked by the money alone: reported, never
// completed. Counter only — no ids or PII leave this query.
const SELECT_WAITING_PAYMENT_SQL = `
SELECT count(*)::int AS count
  FROM bookings b
 WHERE b.lifecycle_status IN ('confirmed','in_progress')
   AND b.scheduled_end_at IS NOT NULL
   AND b.scheduled_end_at + interval '3 days' <= now()
   AND b.payment_status NOT IN (${PAYMENT_SETTLED_SQL})
   AND NOT EXISTS (
         SELECT 1 FROM disputes d
          WHERE d.booking_id = b.id
            AND d.status IN (${OPEN_DISPUTE_SQL}))
`;

const SELECT_FOR_UPDATE_SQL = `
SELECT id, code, vendor_id, lifecycle_status, payment_status, scheduled_end_at, row_version
  FROM bookings
 WHERE id = $1
 FOR UPDATE
`;

// The window is computed from the column itself (not from a JS Date and never
// from `now()`): `scheduled_end_at + 7 days`, exact to the microsecond.
const UPDATE_SQL = `
UPDATE bookings
   SET lifecycle_status = 'completed',
       completed_at = $2::timestamptz,
       completed_by = 'system',
       dispute_window_ends_at = scheduled_end_at + interval '7 days',
       started_without_checkin = started_without_checkin OR started_at IS NULL,
       row_version = row_version + 1
 WHERE id = $1
   AND lifecycle_status IN ('confirmed','in_progress')
   AND scheduled_end_at IS NOT NULL
 RETURNING id, dispute_window_ends_at
`;

const INSERT_HISTORY_SQL = `
INSERT INTO booking_status_history
  (booking_id, axis, from_state, to_state, event, actor_id, actor_role, note)
VALUES ($1, 'lifecycle', $2, 'completed', 'booking.complete_auto', NULL, NULL, $3)
`;

/**
 * L-22 / FR-118: `confirmed` or `in_progress` bookings whose event ended more
 * than 3 days ago are completed by the system, unless a dispute is open or the
 * payment axis is not settled. Rows blocked only by payment are counted as
 * `waiting_payment` (visible, never silently dropped).
 *
 * Idempotent by construction: the status re-check inside the row transaction and
 * the `lifecycle_status IN (...)` guard on the UPDATE both make a second run a
 * no-op, and the outbox row is keyed by `booking.completed:<booking_id>`.
 */
export async function runAutoComplete(batch: number): Promise<JobStats> {
  const rows = await query<CandidateRow>(SELECT_DUE_SQL, [batch]);
  const waiting = await query<{ count: number }>(SELECT_WAITING_PAYMENT_SQL);
  const stats: JobStats = { processed: 0, skipped: 0, failed: 0, waiting_payment: waiting[0]?.count ?? 0 };

  for (const row of rows) {
    try {
      const changed = await withTransaction(async (client) => {
        const locked = await client.query<BookingRow>(SELECT_FOR_UPDATE_SQL, [row.id]);
        const booking = locked.rows[0];
        if (!booking || !booking.scheduled_end_at) return false;

        const disputes = await client.query(
          `SELECT 1 FROM disputes WHERE booking_id = $1 AND status IN (${OPEN_DISPUTE_SQL}) LIMIT 1`,
          [booking.id]
        );

        const now = new Date();
        if (
          !shouldAutoComplete(
            {
              lifecycle_status: booking.lifecycle_status,
              payment_status: booking.payment_status,
              scheduled_end_at: booking.scheduled_end_at,
              has_open_dispute: disputes.rows.length > 0
            },
            now
          )
        ) {
          return false;
        }

        // Anchored to the end of the event, never to completed_at (§4.9).
        const updated = await client.query<{ id: string; dispute_window_ends_at: Date }>(UPDATE_SQL, [
          booking.id,
          now.toISOString()
        ]);
        const completed = updated.rows[0];
        if (!completed) return false;

        await client.query(INSERT_HISTORY_SQL, [
          booking.id,
          booking.lifecycle_status,
          'auto-complete: scheduled_end_at + 3 days reached (worker)'
        ]);

        await enqueue(
          client,
          'booking.completed',
          {
            booking_id: booking.id,
            code: booking.code,
            vendor_id: booking.vendor_id,
            lifecycle_status: 'completed',
            completed_by: 'system',
            completed_at: now.toISOString(),
            scheduled_end_at: booking.scheduled_end_at.toISOString(),
            dispute_window_ends_at: completed.dispute_window_ends_at.toISOString()
          },
          {
            aggregateType: 'booking',
            aggregateId: booking.id,
            aggregateVersion: booking.row_version + 1,
            dedupeKey: `booking.completed:${booking.id}`
          }
        );

        return true;
      });

      if (changed) stats.processed += 1;
      else stats.skipped += 1;
    } catch (err) {
      stats.failed += 1;
      logLine(`job=auto_complete failed=1 booking=${row.id} error=${errorMessage(err)}`);
    }
  }

  return stats;
}
