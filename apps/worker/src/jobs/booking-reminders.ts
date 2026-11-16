import { query } from '../db';
import { errorMessage, logLine } from '../log';
import type { JobStats } from './runner';

/**
 * FR-052: reminders H-7, H-1 and the event day.
 *
 * The reminder is an outbox message, not a direct notification: the existing
 * relay fans it out to the in-app row and the email (FR-051) with the same copy,
 * so there is exactly one place that decides what a reminder says.
 *
 * Guarantees:
 * 1. `outbox_messages.dedupe_key` is UNIQUE (`booking:<id>:reminder:<offset>`),
 *    so a retried or repeated tick can never send the same reminder twice.
 * 2. Only bookings whose schedule is locked (`confirmed`/`in_progress`) are
 *    reminded; a requested/accepted booking still has no confirmed slot.
 * 3. One failing booking does not stop the rest.
 * 4. No money table, status or lifecycle field is written.
 */

/** Reminder windows in days before the event. `0` = the event day itself. */
export const REMINDER_OFFSETS = [7, 1, 0] as const;
export type ReminderOffset = (typeof REMINDER_OFFSETS)[number];

export function reminderEventType(offset: ReminderOffset): string {
  return offset === 0 ? 'booking.reminder_day' : `booking.reminder_${offset}d`;
}

export function reminderDedupeKey(bookingId: string, offset: ReminderOffset): string {
  return `booking:${bookingId}:reminder:${offset}`;
}

/**
 * `events.start_date` is a plain calendar date in the event's own timezone
 * (Asia/Jakarta for every Tarlink booking), so "today" must be the WIB date and
 * not the server's UTC date — otherwise the whole job fires seven hours late.
 */
export function wibDate(now: Date): string {
  const shifted = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

export function addDays(dateIso: string, days: number): string {
  const at = new Date(`${dateIso}T00:00:00.000Z`);
  if (Number.isNaN(at.getTime())) return dateIso;
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

export interface ReminderTarget {
  offset: ReminderOffset;
  date: string;
}

export function reminderTargets(todayWib: string): ReminderTarget[] {
  return REMINDER_OFFSETS.map((offset) => ({ offset, date: addDays(todayWib, offset) }));
}

interface DueBookingRow {
  id: string;
  code: string;
  start_date: string;
}

const DUE_SQL = `
SELECT b.id,
       b.code,
       to_char(e.start_date, 'YYYY-MM-DD') AS start_date
  FROM bookings b
  JOIN events e ON e.id = b.event_id
 WHERE b.lifecycle_status IN ('confirmed', 'in_progress')
   AND e.start_date = ANY($1::date[])
 ORDER BY e.start_date, b.id
 LIMIT $2
`;

const INSERT_SQL = `
INSERT INTO outbox_messages
  (aggregate_type, aggregate_id, event_type, payload, dedupe_key)
VALUES ('booking', $1::uuid, $2, $3::jsonb, $4)
ON CONFLICT (dedupe_key) DO NOTHING
RETURNING id
`;

export async function runBookingReminders(
  batch: number,
  now: Date = new Date()
): Promise<JobStats> {
  const stats: JobStats = { processed: 0, skipped: 0, failed: 0 };
  const targets = reminderTargets(wibDate(now));
  const offsetByDate = new Map(targets.map((target) => [target.date, target.offset]));

  const rows = await query<DueBookingRow>(DUE_SQL, [targets.map((t) => t.date), batch]);
  if (rows.length === 0) {
    stats.skipped += 1;
    return stats;
  }

  for (const booking of rows) {
    const offset = offsetByDate.get(booking.start_date);
    if (offset === undefined) {
      stats.skipped += 1;
      continue;
    }

    try {
      const inserted = await query<{ id: string }>(INSERT_SQL, [
        booking.id,
        reminderEventType(offset),
        JSON.stringify({
          booking_id: booking.id,
          code: booking.code,
          event_date: booking.start_date,
          offset_days: offset
        }),
        reminderDedupeKey(booking.id, offset)
      ]);

      if (inserted.length > 0) {
        stats.processed += 1;
        logLine(`booking_reminder booking=${booking.code} offset=${offset}`);
      } else {
        stats.skipped += 1;
      }
    } catch (err) {
      stats.failed += 1;
      logLine(`booking_reminder_failed booking=${booking.code} error=${errorMessage(err)}`);
    }
  }

  return stats;
}
