import { query, withTransaction } from '../db';
import { errorMessage, logLine } from '../log';
import { shouldExpireHold } from './decisions';
import type { JobStats } from './runner';

interface CandidateRow {
  id: string;
}

interface SlotRow {
  id: string;
  status: string;
  hold_expires_at: Date | null;
  booking_lifecycle_status: string | null;
}

const SELECT_DUE_SQL = `
SELECT cs.id
  FROM calendar_slots cs
  LEFT JOIN bookings b ON b.id = cs.booking_id
 WHERE cs.status = 'held'
   AND cs.hold_expires_at IS NOT NULL
   AND cs.hold_expires_at < now()
   AND (b.id IS NULL OR b.lifecycle_status <> 'confirmed')
 ORDER BY cs.hold_expires_at, cs.id
 LIMIT $1
`;

const SELECT_FOR_UPDATE_SQL = `
SELECT cs.id, cs.status, cs.hold_expires_at, b.lifecycle_status AS booking_lifecycle_status
  FROM calendar_slots cs
  LEFT JOIN bookings b ON b.id = cs.booking_id
 WHERE cs.id = $1
 FOR UPDATE OF cs
`;

// `source='system'`: the slot was freed by a worker, not by a vendor or admin.
const FREE_SLOT_SQL = `
UPDATE calendar_slots
   SET status = 'available',
       booking_id = NULL,
       hold_expires_at = NULL,
       source = 'system'
 WHERE id = $1
   AND status = 'held'
   AND NOT EXISTS (
         SELECT 1 FROM bookings b
          WHERE b.id = calendar_slots.booking_id
            AND b.lifecycle_status = 'confirmed')
 RETURNING id
`;

/**
 * Frees `held` calendar slots whose TTL passed while their booking never became
 * `confirmed` (L-03 → L-14 window). `booked` slots and confirmed bookings are
 * never touched; slots without an expiry belong to `expire_unpaid` (D-18).
 */
export async function runExpireHolds(batch: number): Promise<JobStats> {
  const rows = await query<CandidateRow>(SELECT_DUE_SQL, [batch]);
  const stats: JobStats = { processed: 0, skipped: 0, failed: 0 };

  for (const row of rows) {
    try {
      const freed = await withTransaction(async (client) => {
        const locked = await client.query<SlotRow>(SELECT_FOR_UPDATE_SQL, [row.id]);
        const slot = locked.rows[0];
        if (!slot) return false;
        if (!shouldExpireHold(slot, new Date())) return false;

        const updated = await client.query(FREE_SLOT_SQL, [slot.id]);
        return updated.rows.length > 0;
      });

      if (freed) stats.processed += 1;
      else stats.skipped += 1;
    } catch (err) {
      stats.failed += 1;
      logLine(`job=expire_holds failed=1 slot=${row.id} error=${errorMessage(err)}`);
    }
  }

  return stats;
}
