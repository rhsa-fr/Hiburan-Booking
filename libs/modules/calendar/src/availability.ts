/**
 * Pure calendar projections (TECH-DESIGN §5.11 / D-10).
 *
 * The absence of a `calendar_slots` row means "belum diisi" (unconfirmed); it
 * must never be coerced to `available`. That distinction is the whole point of
 * D-10, so it lives in one pure function used by the API projection.
 */
export const CALENDAR_SESSIONS = ['day', 'night', 'full'] as const;
export type CalendarSession = (typeof CALENDAR_SESSIONS)[number];

export const BOOKABLE_CALENDAR_SESSIONS = ['day', 'night'] as const;
export type BookableCalendarSession = (typeof BOOKABLE_CALENDAR_SESSIONS)[number];

export const CALENDAR_SLOT_STATUSES = ['available', 'blocked', 'held', 'booked'] as const;
export type CalendarSlotStatus = (typeof CALENDAR_SLOT_STATUSES)[number];

export type AvailabilityState =
  | 'available'
  | 'unconfirmed'
  | 'stale'
  | 'blocked'
  | 'held'
  | 'booked';

export const STALE_THRESHOLD_DAYS = 30;

export interface CalendarSlotProjection {
  date: string;
  session: CalendarSession;
  status: CalendarSlotStatus;
  hold_expires_at: Date | null;
}

/**
 * D-10 mapping:
 * - no row                     -> unconfirmed
 * - available                  -> available
 * - blocked                    -> blocked
 * - held, hold_expires_at > now -> held
 * - held, expired or no expiry  -> unconfirmed ("menunggu pembaruan")
 * - booked                     -> booked
 */
export function availabilityStateFor(
  row: Pick<CalendarSlotProjection, 'status' | 'hold_expires_at'> | null,
  now: Date
): AvailabilityState {
  if (!row) return 'unconfirmed';
  switch (row.status) {
    case 'available':
      return 'available';
    case 'blocked':
      return 'blocked';
    case 'booked':
      return 'booked';
    case 'held':
      return row.hold_expires_at !== null && row.hold_expires_at.getTime() > now.getTime()
        ? 'held'
        : 'unconfirmed';
    default: {
      const exhaustive: never = row.status;
      return exhaustive;
    }
  }
}

export function isCalendarStale(calendarUpdatedAt: Date | null, now: Date): boolean {
  if (!calendarUpdatedAt) return true;
  return now.getTime() - calendarUpdatedAt.getTime() > STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Vendor-level staleness wins over "looks available" so the client cannot
 * promise a slot from a calendar that was not refreshed for a month.
 */
export function applyStaleness(state: AvailabilityState, stale: boolean): AvailabilityState {
  if (!stale) return state;
  return state === 'available' || state === 'unconfirmed' ? 'stale' : state;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Inclusive list of ISO dates between `from` and `to` (UTC, no timezone drift). */
export function enumerateDates(from: string, to: string): string[] {
  if (!isIsoDate(from) || !isIsoDate(to)) {
    throw new Error(`Tanggal tidak valid: ${from}..${to}`);
  }
  const start = new Date(`${from}T00:00:00.000Z`).getTime();
  const end = new Date(`${to}T00:00:00.000Z`).getTime();
  if (start > end) return [];

  const dates: string[] = [];
  for (let cursor = start; cursor <= end; cursor += 24 * 60 * 60 * 1000) {
    dates.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return dates;
}

const SESSION_ORDER: Record<CalendarSession, number> = { day: 0, night: 1, full: 2 };

export function compareSession(a: CalendarSession, b: CalendarSession): number {
  return SESSION_ORDER[a] - SESSION_ORDER[b];
}
