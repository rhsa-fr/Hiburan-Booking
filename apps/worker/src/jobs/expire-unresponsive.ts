import { enqueue } from '../../../../libs/platform/outbox/src/index';
import { query, withTransaction } from '../db';
import { errorMessage, logLine } from '../log';
import { shouldExpireUnresponsive } from './decisions';
import type { JobStats } from './runner';

interface CandidateRow {
  id: string;
}

interface BookingRow {
  id: string;
  code: string;
  vendor_id: string;
  lifecycle_status: string;
  respond_deadline: Date | null;
  row_version: number;
}

const SELECT_DUE_SQL = `
SELECT b.id
  FROM bookings b
 WHERE b.lifecycle_status = 'requested'
   AND b.respond_deadline IS NOT NULL
   AND b.respond_deadline <= now()
 ORDER BY b.respond_deadline, b.id
 LIMIT $1
`;

const SELECT_FOR_UPDATE_SQL = `
SELECT id, code, vendor_id, lifecycle_status, respond_deadline, row_version
  FROM bookings
 WHERE id = $1
 FOR UPDATE
`;

const UPDATE_SQL = `
UPDATE bookings
   SET lifecycle_status = 'expired',
       row_version = row_version + 1
 WHERE id = $1
   AND lifecycle_status = 'requested'
 RETURNING id
`;

const INSERT_HISTORY_SQL = `
INSERT INTO booking_status_history
  (booking_id, axis, from_state, to_state, event, actor_id, actor_role, note)
VALUES ($1, 'lifecycle', 'requested', 'expired', 'booking.expire', NULL, NULL, $2)
`;

const RELEASE_BOOKING_SLOTS_SQL = `
UPDATE booking_slots
   SET is_blocking = false
 WHERE booking_id = $1
   AND is_blocking
`;

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
 * L-05 / FR-032: `requested` bookings whose respond_deadline passed without
 * vendor response are expired.
 */
export async function runExpireUnresponsive(batch: number): Promise<JobStats> {
  const rows = await query<CandidateRow>(SELECT_DUE_SQL, [batch]);
  const stats: JobStats = { processed: 0, skipped: 0, failed: 0 };

  for (const row of rows) {
    try {
      const changed = await withTransaction(async (client) => {
        const locked = await client.query<BookingRow>(SELECT_FOR_UPDATE_SQL, [row.id]);
        const booking = locked.rows[0];
        if (!booking) return false;

        const now = new Date();
        if (
          !shouldExpireUnresponsive(
            {
              lifecycle_status: booking.lifecycle_status,
              respond_deadline: booking.respond_deadline
            },
            now
          )
        ) {
          return false;
        }

        const updated = await client.query(UPDATE_SQL, [booking.id]);
        if (updated.rows.length === 0) return false;

        await client.query(RELEASE_BOOKING_SLOTS_SQL, [booking.id]);
        await client.query(RELEASE_CALENDAR_SLOTS_SQL, [booking.id]);

        await client.query(INSERT_HISTORY_SQL, [
          booking.id,
          'Batas waktu respons vendor terlewati (24 jam)'
        ]);

        await enqueue(
          client,
          'booking.expired',
          {
            booking_id: booking.id,
            code: booking.code,
            vendor_id: booking.vendor_id,
            reason: 'respond_deadline_passed'
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
      logLine(`job=expire_unresponsive failed=1 booking=${row.id} error=${errorMessage(err)}`);
    }
  }

  return stats;
}
