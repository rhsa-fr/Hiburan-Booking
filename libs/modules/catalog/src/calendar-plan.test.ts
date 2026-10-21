import { describe, expect, it } from 'vitest';
import {
  buildCalendarView,
  enumerateDates,
  expandCalendarCells,
  planCalendarWrites,
  slotKey,
  type CalendarSlotRecord
} from './calendar-plan';
import type { CalendarSession, CalendarSlotStatus } from './contracts';

function statusMap(
  entries: Array<[string, CalendarSession, CalendarSlotStatus]>
): Map<string, CalendarSlotStatus> {
  return new Map(entries.map(([date, session, status]) => [slotKey(date, session), status]));
}

describe('enumerateDates', () => {
  it('is inclusive on both ends', () => {
    expect(enumerateDates('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02'
    ]);
  });

  it('handles a single day and leap day', () => {
    expect(enumerateDates('2026-03-01', '2026-03-01')).toEqual(['2026-03-01']);
    expect(enumerateDates('2028-02-28', '2028-03-01')).toEqual([
      '2028-02-28',
      '2028-02-29',
      '2028-03-01'
    ]);
  });

  it('rejects a reversed or malformed range', () => {
    expect(() => enumerateDates('2026-12-31', '2026-12-01')).toThrow(/terbalik/);
    expect(() => enumerateDates('2026-02-30', '2026-03-01')).toThrow(/tidak valid/);
  });
});

describe('expandCalendarCells', () => {
  it('fans sessions out per date, date-major', () => {
    expect(expandCalendarCells('2026-12-05', '2026-12-06', ['day', 'night'])).toEqual([
      { date: '2026-12-05', session: 'day' },
      { date: '2026-12-05', session: 'night' },
      { date: '2026-12-06', session: 'day' },
      { date: '2026-12-06', session: 'night' }
    ]);
  });

  it('collapses duplicate sessions so a cell is never written twice', () => {
    expect(expandCalendarCells('2026-12-05', '2026-12-05', ['full', 'full'])).toEqual([
      { date: '2026-12-05', session: 'full' }
    ]);
  });

  it('multiplies dates by sessions', () => {
    const cells = expandCalendarCells('2026-12-01', '2026-12-31', ['day', 'night', 'full']);
    expect(cells).toHaveLength(31 * 3);
  });
});

describe('planCalendarWrites', () => {
  it('never touches held or booked rows', () => {
    const cells = expandCalendarCells('2026-12-05', '2026-12-05', ['day', 'night']);
    const existing = statusMap([
      ['2026-12-05', 'day', 'held'],
      ['2026-12-05', 'night', 'booked']
    ]);

    const plan = planCalendarWrites(cells, existing, 'blocked');

    expect(plan.writes).toEqual([]);
    expect(plan.skipped).toBe(2);
    expect(plan.unchanged).toBe(0);
  });

  it('writes missing rows and real changes, skips no-ops', () => {
    const cells = expandCalendarCells('2026-12-05', '2026-12-06', ['day', 'night']);
    const existing = statusMap([
      ['2026-12-05', 'day', 'available'],
      ['2026-12-05', 'night', 'blocked']
    ]);

    const plan = planCalendarWrites(cells, existing, 'available');

    expect(plan.writes).toEqual([
      { date: '2026-12-05', session: 'night' },
      { date: '2026-12-06', session: 'day' },
      { date: '2026-12-06', session: 'night' }
    ]);
    expect(plan.unchanged).toBe(1);
    expect(plan.skipped).toBe(0);
  });

  it('counts a held row as skipped even when the target status matches', () => {
    const cells = expandCalendarCells('2026-12-05', '2026-12-05', ['full']);
    const plan = planCalendarWrites(cells, statusMap([['2026-12-05', 'full', 'held']]), 'blocked');
    expect(plan.skipped).toBe(1);
    expect(plan.writes).toHaveLength(0);
  });
});

describe('buildCalendarView', () => {
  it('marks a date/session without a row as unconfirmed, never available', () => {
    const days = buildCalendarView('2026-12-05', '2026-12-05', []);
    expect(days).toEqual([
      { date: '2026-12-05', session: 'day', status: 'unconfirmed' },
      { date: '2026-12-05', session: 'night', status: 'unconfirmed' }
    ]);
  });

  it('projects stored statuses and appends explicit full rows', () => {
    const rows: CalendarSlotRecord[] = [
      { date: '2026-12-05', session: 'night', status: 'blocked' },
      { date: '2026-12-05', session: 'day', status: 'available' },
      { date: '2026-12-05', session: 'full', status: 'booked' }
    ];

    expect(buildCalendarView('2026-12-05', '2026-12-05', rows)).toEqual([
      { date: '2026-12-05', session: 'day', status: 'available' },
      { date: '2026-12-05', session: 'night', status: 'blocked' },
      { date: '2026-12-05', session: 'full', status: 'booked' }
    ]);
  });

  it('orders dates ascending and ignores rows outside the range', () => {
    const rows: CalendarSlotRecord[] = [
      { date: '2026-12-07', session: 'day', status: 'available' },
      { date: '2026-12-01', session: 'day', status: 'blocked' }
    ];

    const days = buildCalendarView('2026-12-05', '2026-12-06', rows);

    expect(days).toEqual([
      { date: '2026-12-05', session: 'day', status: 'unconfirmed' },
      { date: '2026-12-05', session: 'night', status: 'unconfirmed' },
      { date: '2026-12-06', session: 'day', status: 'unconfirmed' },
      { date: '2026-12-06', session: 'night', status: 'unconfirmed' }
    ]);
  });
});
