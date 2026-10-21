/**
 * Calendar range maths and write planning (pure, no database).
 *
 * Two rules from the design live here so they can be tested without Postgres:
 *
 * 1. D-10: a `(date, session)` without a row is `unconfirmed`. The projection
 *    never invents `available` and never emits a fake `full`.
 * 2. A bulk calendar write must never overwrite a `held` or `booked` row —
 *    those belong to a booking, not to the vendor's availability editor.
 *
 * The SQL in `catalog.repository.ts` repeats rule 2 as a `WHERE` guard
 * (defence in depth); this module is what decides what to send.
 */
import { AppError } from '@tarlink/core/errors';
import type { CalendarDay, CalendarSession, CalendarSlotStatus } from './contracts';

export const CALENDAR_SESSIONS = ['day', 'night', 'full'] as const;

/** Sessions the grid always shows; `full` only appears when a row exists. */
export const DEFAULT_VIEW_SESSIONS: readonly CalendarSession[] = ['day', 'night'];

export const PROTECTED_SLOT_STATUSES: readonly CalendarSlotStatus[] = ['held', 'booked'];

export const CALENDAR_WRITE_STATUSES = ['available', 'blocked'] as const;
export type CalendarWriteStatus = (typeof CALENDAR_WRITE_STATUSES)[number];

/** Upper bound for one read/write request (a year of grids). */
export const MAX_CALENDAR_RANGE_DAYS = 366;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const SESSION_ORDER: Record<CalendarSession, number> = { day: 0, night: 1, full: 2 };

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Inclusive list of ISO dates, UTC-anchored so no timezone drift is possible. */
export function enumerateDates(from: string, to: string): string[] {
  if (!isIsoDate(from) || !isIsoDate(to)) {
    throw new AppError('VALIDATION_ERROR', `Tanggal tidak valid: ${from}..${to}`);
  }
  const start = new Date(`${from}T00:00:00.000Z`).getTime();
  const end = new Date(`${to}T00:00:00.000Z`).getTime();
  if (start > end) {
    throw new AppError('VALIDATION_ERROR', `Rentang tanggal terbalik: ${from}..${to}`);
  }

  const dates: string[] = [];
  for (let cursor = start; cursor <= end; cursor += DAY_MS) {
    dates.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return dates;
}

export function slotKey(date: string, session: CalendarSession): string {
  return `${date}|${session}`;
}

export function compareSession(a: CalendarSession, b: CalendarSession): number {
  return SESSION_ORDER[a] - SESSION_ORDER[b];
}

export interface CalendarCell {
  date: string;
  session: CalendarSession;
}

/**
 * Date-major fan-out of `sessions` over an inclusive range. Duplicate sessions
 * are collapsed so one request can never insert the same row twice.
 */
export function expandCalendarCells(
  from: string,
  to: string,
  sessions: readonly CalendarSession[]
): CalendarCell[] {
  const uniqueSessions = [...new Set(sessions)];
  const cells: CalendarCell[] = [];
  for (const date of enumerateDates(from, to)) {
    for (const session of uniqueSessions) {
      cells.push({ date, session });
    }
  }
  return cells;
}

export function isProtectedSlotStatus(status: CalendarSlotStatus): boolean {
  return PROTECTED_SLOT_STATUSES.includes(status);
}

export interface CalendarWritePlan {
  /** Cells that must be written (new rows and real status changes). */
  writes: CalendarCell[];
  /** Rows already at the requested status; not rewritten. */
  unchanged: number;
  /** `held`/`booked` rows owned by a booking; never touched. */
  skipped: number;
}

/**
 * Decides which cells to write. `held`/`booked` rows are skipped, and rows that
 * already hold the requested status are counted as unchanged so `updated`
 * reports real changes only.
 */
export function planCalendarWrites(
  cells: readonly CalendarCell[],
  existing: ReadonlyMap<string, CalendarSlotStatus>,
  status: CalendarWriteStatus
): CalendarWritePlan {
  const writes: CalendarCell[] = [];
  let unchanged = 0;
  let skipped = 0;

  for (const cell of cells) {
    const current = existing.get(slotKey(cell.date, cell.session));
    if (current !== undefined && isProtectedSlotStatus(current)) {
      skipped += 1;
      continue;
    }
    if (current === status) {
      unchanged += 1;
      continue;
    }
    writes.push(cell);
  }

  return { writes, unchanged, skipped };
}

/** Row shape the projection needs; already validated by `mapCalendarSlot`. */
export interface CalendarSlotRecord {
  date: string;
  session: CalendarSession;
  status: CalendarSlotStatus;
}

/**
 * Builds the panel grid: `day` + `night` for every date plus any explicit
 * `full` row that exists. Missing rows become `unconfirmed`.
 */
export function buildCalendarView(
  from: string,
  to: string,
  rows: readonly CalendarSlotRecord[]
): CalendarDay[] {
  const keyed = new Map<string, CalendarSlotStatus>();
  for (const row of rows) {
    keyed.set(slotKey(row.date, row.session), row.status);
  }

  const days: CalendarDay[] = [];
  for (const date of enumerateDates(from, to)) {
    for (const session of DEFAULT_VIEW_SESSIONS) {
      days.push({
        date,
        session,
        status: keyed.get(slotKey(date, session)) ?? 'unconfirmed'
      });
    }
  }

  for (const row of rows) {
    if (row.session !== 'full') continue;
    if (row.date < from || row.date > to) continue;
    days.push({ date: row.date, session: 'full', status: row.status });
  }

  days.sort((a, b) => a.date.localeCompare(b.date) || compareSession(a.session, b.session));
  return days;
}
