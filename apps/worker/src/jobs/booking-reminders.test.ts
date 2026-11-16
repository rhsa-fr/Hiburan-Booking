import { describe, expect, it } from 'vitest';
import {
  addDays,
  reminderDedupeKey,
  reminderEventType,
  reminderTargets,
  wibDate
} from './booking-reminders';

describe('wibDate', () => {
  it('uses the WIB calendar day, not the UTC day', () => {
    // 18:30 UTC on 7 Nov is already 01:30 WIB on 8 Nov.
    expect(wibDate(new Date('2026-11-07T18:30:00.000Z'))).toBe('2026-11-08');
  });

  it('keeps the same day just before the UTC boundary', () => {
    expect(wibDate(new Date('2026-11-07T16:59:00.000Z'))).toBe('2026-11-07');
  });

  it('crosses a month end', () => {
    expect(wibDate(new Date('2026-11-30T17:10:00.000Z'))).toBe('2026-12-01');
  });
});

describe('addDays', () => {
  it('adds days inside a month', () => {
    expect(addDays('2026-11-08', 7)).toBe('2026-11-15');
  });

  it('crosses a month boundary', () => {
    expect(addDays('2026-11-28', 7)).toBe('2026-12-05');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('handles a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
  });
});

describe('reminderTargets', () => {
  it('targets H-7, H-1 and the event day', () => {
    expect(reminderTargets('2026-11-08')).toEqual([
      { offset: 7, date: '2026-11-15' },
      { offset: 1, date: '2026-11-09' },
      { offset: 0, date: '2026-11-08' }
    ]);
  });
});

describe('reminderEventType', () => {
  it('names the event day distinctly from H-N', () => {
    expect(reminderEventType(7)).toBe('booking.reminder_7d');
    expect(reminderEventType(1)).toBe('booking.reminder_1d');
    expect(reminderEventType(0)).toBe('booking.reminder_day');
  });
});

describe('reminderDedupeKey', () => {
  it('is unique per booking and offset', () => {
    const keys = new Set([
      reminderDedupeKey('11111111-1111-1111-1111-111111111111', 7),
      reminderDedupeKey('11111111-1111-1111-1111-111111111111', 1),
      reminderDedupeKey('11111111-1111-1111-1111-111111111111', 0),
      reminderDedupeKey('22222222-2222-2222-2222-222222222222', 0)
    ]);
    expect(keys.size).toBe(4);
  });

  it('is stable across ticks so the UNIQUE key absorbs a retry', () => {
    const booking = '33333333-3333-3333-3333-333333333333';
    expect(reminderDedupeKey(booking, 1)).toBe(reminderDedupeKey(booking, 1));
  });
});
