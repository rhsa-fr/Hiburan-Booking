/**
 * Derivation of the scheduled window of a booking (TECH-DESIGN §4.3 L-11).
 *
 * `bookings.scheduled_start_at` / `scheduled_end_at` are the anchor of every
 * later rule: check-in window (L-15), no-show window (L-20), auto-complete
 * (L-22, scheduled_end + 3 days) and the dispute window (scheduled_end + 7
 * days, NEVER completion + 7).
 *
 * The window is derived from the booking's own `booking_slots`:
 * - the earliest slot decides `scheduled_start_at`;
 * - the latest slot decides `scheduled_end_at`;
 * - a slot contributes its own `start_time`/`end_time` when the vendor set
 *   them, otherwise the default window of its session.
 *
 * Local times are WIB (`events.timezone` defaults to `Asia/Jakarta`, a fixed
 * UTC+07:00 offset without DST), stored as UTC instants.
 */
import { AppError } from '../../../../apps/api/src/core/errors';
import { isIsoDate, type CalendarSession } from '../../calendar/src/availability';

/** Asia/Jakarta is UTC+07:00 all year round (no DST since 2014). */
export const JAKARTA_UTC_OFFSET = '+07:00';

/**
 * Default local window per session, used when the slot has no explicit
 * `start_time`/`end_time`. The bands follow `booking_slots.session_span`
 * (day=[1,2), night=[2,3), full=[1,3)): `full` therefore covers both bands.
 */
export const SESSION_DEFAULT_WINDOW: Record<CalendarSession, { start: string; end: string }> = {
  day: { start: '08:00:00', end: '17:00:00' },
  night: { start: '17:00:00', end: '23:59:59' },
  full: { start: '08:00:00', end: '23:59:59' }
};

export interface BookingSlotTimeRow {
  /** YYYY-MM-DD, local date of the slot. */
  date: string;
  session: CalendarSession;
  /** Local wall-clock time, `HH:MM` or `HH:MM:SS`, or NULL. */
  start_time: string | null;
  end_time: string | null;
}

export interface ScheduleWindow {
  scheduled_start_at: Date;
  scheduled_end_at: Date;
}

export interface SlotWindow {
  start: Date;
  end: Date;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

/** Normalises `HH:MM` / `HH:MM:SS` to `HH:MM:SS`; NULL/invalid -> null. */
export function normalizeLocalTime(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const match = TIME_PATTERN.exec(value.trim());
  if (!match) return null;
  return `${match[1]}:${match[2]}:${match[3] ?? '00'}`;
}

/** Local wall-clock time on `date` -> UTC instant. */
export function jakartaLocalToUtc(date: string, time: string): Date {
  if (!isIsoDate(date)) {
    throw new AppError('VALIDATION_ERROR', `Tanggal slot tidak valid: ${date}`);
  }
  const normalized = normalizeLocalTime(time);
  if (!normalized) {
    throw new AppError('VALIDATION_ERROR', `Jam slot tidak valid: ${time}`);
  }
  return new Date(`${date}T${normalized}${JAKARTA_UTC_OFFSET}`);
}

/** The window of one slot, falling back to the session default. */
export function slotWindow(slot: BookingSlotTimeRow): SlotWindow {
  const defaults = SESSION_DEFAULT_WINDOW[slot.session];
  const startTime = normalizeLocalTime(slot.start_time) ?? defaults.start;
  const endTime = normalizeLocalTime(slot.end_time) ?? defaults.end;

  const start = jakartaLocalToUtc(slot.date, startTime);
  const end = jakartaLocalToUtc(slot.date, endTime);
  if (end.getTime() > start.getTime()) return { start, end };

  // Degenerate input (e.g. start after the session's end): keep the slot
  // consistent with the session band instead of producing an inverted window.
  const fallbackStart = jakartaLocalToUtc(slot.date, defaults.start);
  const fallbackEnd = jakartaLocalToUtc(slot.date, defaults.end);
  return { start: fallbackStart, end: fallbackEnd };
}

/**
 * The scheduled window of a booking: earliest slot start, latest slot end.
 * Throws CONFLICT when the booking has no slot at all.
 */
export function deriveScheduleWindow(slots: readonly BookingSlotTimeRow[]): ScheduleWindow {
  if (slots.length === 0) {
    throw new AppError('CONFLICT', 'Booking tidak memiliki slot untuk menentukan jadwal');
  }

  let start: Date | null = null;
  let end: Date | null = null;

  for (const slot of slots) {
    const window = slotWindow(slot);
    if (start === null || window.start.getTime() < start.getTime()) start = window.start;
    if (end === null || window.end.getTime() > end.getTime()) end = window.end;
  }

  if (!start || !end) {
    throw new AppError('CONFLICT', 'Booking tidak memiliki slot untuk menentukan jadwal');
  }
  return { scheduled_start_at: start, scheduled_end_at: end };
}
