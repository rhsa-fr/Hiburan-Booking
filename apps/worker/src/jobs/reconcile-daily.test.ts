import { describe, expect, it } from 'vitest';
import { previousWibDate, reconciliationDatesToRun, shouldRunRecon } from './reconcile-daily';

describe('shouldRunRecon', () => {
  const base = { enabled: true, startHourWib: 7, currentHourWib: 9 };

  it('runs after the configured WIB hour', () => {
    expect(shouldRunRecon(base)).toBe(true);
    expect(shouldRunRecon({ ...base, currentHourWib: 23 })).toBe(true);
  });

  it('does not run before the configured hour', () => {
    expect(shouldRunRecon({ ...base, currentHourWib: 6 })).toBe(false);
    expect(shouldRunRecon({ ...base, currentHourWib: 0 })).toBe(false);
  });

  it('runs exactly at the configured hour (inclusive gate)', () => {
    expect(shouldRunRecon({ ...base, currentHourWib: 7 })).toBe(true);
  });

  it('is disabled by recon_enabled=false', () => {
    expect(shouldRunRecon({ ...base, enabled: false })).toBe(false);
  });

  it('rejects an out-of-range configured hour instead of guessing', () => {
    expect(shouldRunRecon({ ...base, startHourWib: 24 })).toBe(false);
    expect(shouldRunRecon({ ...base, startHourWib: -1 })).toBe(false);
    expect(shouldRunRecon({ ...base, startHourWib: Number.NaN })).toBe(false);
  });
});

describe('previousWibDate', () => {
  it('returns the previous calendar day', () => {
    expect(previousWibDate('2026-11-07')).toBe('2026-11-06');
  });

  it('crosses a month boundary', () => {
    expect(previousWibDate('2026-03-01')).toBe('2026-02-28');
    expect(previousWibDate('2026-12-01')).toBe('2026-11-30');
  });

  it('crosses a year boundary', () => {
    expect(previousWibDate('2026-01-01')).toBe('2025-12-31');
  });

  it('handles a leap day', () => {
    expect(previousWibDate('2024-03-01')).toBe('2024-02-29');
    expect(previousWibDate('2025-03-01')).toBe('2025-02-28');
  });

  it('rejects a malformed date', () => {
    expect(() => previousWibDate('07-11-2026')).toThrow(/WIB/);
    expect(() => previousWibDate('')).toThrow(/WIB/);
  });
});

describe('reconciliationDatesToRun', () => {
  it('starts from yesterday when the provider has never been reconciled', () => {
    expect(
      reconciliationDatesToRun({ latestReportDate: null, yesterday: '2026-11-07' })
    ).toEqual(['2026-11-07']);
  });

  it('does nothing when yesterday is already reconciled', () => {
    expect(
      reconciliationDatesToRun({
        latestReportDate: '2026-11-07',
        yesterday: '2026-11-07'
      })
    ).toEqual([]);
  });

  it('backfills every missing day since the last run', () => {
    expect(
      reconciliationDatesToRun({
        latestReportDate: '2026-11-04',
        yesterday: '2026-11-07'
      })
    ).toEqual(['2026-11-05', '2026-11-06', '2026-11-07']);
  });

  it('crosses a month boundary while backfilling', () => {
    expect(
      reconciliationDatesToRun({
        latestReportDate: '2026-02-27',
        yesterday: '2026-03-01'
      })
    ).toEqual(['2026-02-28', '2026-03-01']);
  });

  it('caps a long outage at maxDays ending yesterday', () => {
    const dates = reconciliationDatesToRun({
      latestReportDate: '2026-10-01',
      yesterday: '2026-11-07'
    });
    expect(dates).toHaveLength(7);
    expect(dates[0]).toBe('2026-11-01');
    expect(dates.at(-1)).toBe('2026-11-07');
  });

  it('honours a custom maxDays', () => {
    expect(
      reconciliationDatesToRun({
        latestReportDate: '2026-10-01',
        yesterday: '2026-11-07',
        maxDays: 3
      })
    ).toEqual(['2026-11-05', '2026-11-06', '2026-11-07']);
  });

  it('rejects malformed input instead of guessing dates', () => {
    expect(() =>
      reconciliationDatesToRun({ latestReportDate: null, yesterday: 'kemarin' })
    ).toThrow(/WIB/);
    expect(() =>
      reconciliationDatesToRun({ latestReportDate: '2026-13-01', yesterday: '2026-11-07' })
    ).toThrow(/WIB/);
  });
});
