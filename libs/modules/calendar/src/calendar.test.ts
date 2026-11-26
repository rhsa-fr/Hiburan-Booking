import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { AppError } from '../../../../apps/api/src/core/errors';
import {
  applyStaleness,
  availabilityStateFor,
  compareSession,
  enumerateDates,
  isCalendarStale,
  isIsoDate,
  STALE_THRESHOLD_DAYS
} from './availability';
import { CalendarRepository } from './calendar.repository';
import { CalendarService } from './calendar.service';
import type { CalendarSlotRow } from './calendar.repository';

const NOW = new Date('2026-10-21T10:00:00.000Z');

function serviceWith(rows: CalendarSlotRow[]): CalendarService {
  const repo = {
    listAvailability: async () => ({
      rows,
      calendarUpdatedAt: new Date(NOW.getTime() - 86_400_000)
    })
  } as unknown as CalendarRepository;
  return new CalendarService(repo);
}

const DATE = '2026-11-27';

function states(days: Awaited<ReturnType<CalendarService['listAvailability']>>['days']) {
  return Object.fromEntries(days.map((day) => [day.session, day.availability_state]));
}

describe('CalendarService.listAvailability — one booking owns the date', () => {
  it('marks the whole date booked when a full-day slot is booked', async () => {
    const service = serviceWith([
      { date: DATE, session: 'full', status: 'booked', hold_expires_at: null },
      { date: DATE, session: 'day', status: 'available', hold_expires_at: null },
      { date: DATE, session: 'night', status: 'available', hold_expires_at: null }
    ]);

    const result = await service.listAvailability('v1', DATE, DATE, NOW);

    expect(states(result.days)).toEqual({ day: 'booked', night: 'booked', full: 'booked' });
    expect(result.days.find((day) => day.session === 'day')?.hold_expires_at).toBeNull();
  });

  it('marks the whole date held when a live hold sits on one session only', async () => {
    const hold = new Date(NOW.getTime() + 3_600_000);
    const service = serviceWith([
      { date: DATE, session: 'day', status: 'available', hold_expires_at: null },
      { date: DATE, session: 'night', status: 'held', hold_expires_at: hold }
    ]);

    const result = await service.listAvailability('v1', DATE, DATE, NOW);

    expect(states(result.days)).toEqual({ day: 'held', night: 'held' });
    expect(result.days.find((day) => day.session === 'day')?.hold_expires_at).toBe(
      hold.toISOString()
    );
  });

  it('marks the whole date booked when only the night session is booked', async () => {
    const service = serviceWith([
      { date: DATE, session: 'day', status: 'available', hold_expires_at: null },
      { date: DATE, session: 'night', status: 'booked', hold_expires_at: null },
      { date: DATE, session: 'full', status: 'available', hold_expires_at: null }
    ]);

    const result = await service.listAvailability('v1', DATE, DATE, NOW);

    expect(states(result.days)).toEqual({ day: 'booked', night: 'booked', full: 'booked' });
  });

  it('does not let an expired hold hide free sessions', async () => {
    const service = serviceWith([
      {
        date: DATE,
        session: 'night',
        status: 'held',
        hold_expires_at: new Date(NOW.getTime() - 60_000)
      },
      { date: DATE, session: 'day', status: 'available', hold_expires_at: null }
    ]);

    const result = await service.listAvailability('v1', DATE, DATE, NOW);

    expect(states(result.days)).toEqual({
      day: 'available',
      night: 'unconfirmed'
    });
  });

  it('keeps a vendor block local unless the vendor blocked the full day', async () => {
    const service = serviceWith([
      { date: DATE, session: 'day', status: 'blocked', hold_expires_at: null },
      { date: DATE, session: 'night', status: 'available', hold_expires_at: null }
    ]);

    const result = await service.listAvailability('v1', DATE, DATE, NOW);

    expect(states(result.days)).toEqual({ day: 'blocked', night: 'available' });
  });

  it('propagates a vendor block on full to both half-day sessions', async () => {
    const service = serviceWith([
      { date: DATE, session: 'full', status: 'blocked', hold_expires_at: null },
      { date: DATE, session: 'day', status: 'available', hold_expires_at: null },
      { date: DATE, session: 'night', status: 'available', hold_expires_at: null }
    ]);

    const result = await service.listAvailability('v1', DATE, DATE, NOW);

    expect(states(result.days)).toEqual({ day: 'blocked', night: 'blocked', full: 'blocked' });
  });
});

describe('availabilityStateFor (D-10)', () => {
  it('treats a missing row as unconfirmed, never available', () => {
    expect(availabilityStateFor(null, NOW)).toBe('unconfirmed');
  });

  it('maps explicit statuses', () => {
    expect(availabilityStateFor({ status: 'available', hold_expires_at: null }, NOW)).toBe(
      'available'
    );
    expect(availabilityStateFor({ status: 'blocked', hold_expires_at: null }, NOW)).toBe('blocked');
    expect(availabilityStateFor({ status: 'booked', hold_expires_at: null }, NOW)).toBe('booked');
  });

  it('only reports held while the hold is still alive', () => {
    expect(
      availabilityStateFor(
        { status: 'held', hold_expires_at: new Date(NOW.getTime() + 60_000) },
        NOW
      )
    ).toBe('held');
    expect(
      availabilityStateFor(
        { status: 'held', hold_expires_at: new Date(NOW.getTime() - 60_000) },
        NOW
      )
    ).toBe('unconfirmed');
    expect(availabilityStateFor({ status: 'held', hold_expires_at: null }, NOW)).toBe(
      'unconfirmed'
    );
  });

  it('promotes available/unconfirmed to stale when the vendor calendar is old', () => {
    expect(applyStaleness('available', false)).toBe('available');
    expect(applyStaleness('available', true)).toBe('stale');
    expect(applyStaleness('unconfirmed', true)).toBe('stale');
    expect(applyStaleness('blocked', true)).toBe('blocked');
    expect(applyStaleness('booked', true)).toBe('booked');
  });
});

describe('calendar staleness', () => {
  it('is stale when calendar_updated_at is null or older than 30 days', () => {
    expect(isCalendarStale(null, NOW)).toBe(true);
    expect(
      isCalendarStale(new Date(NOW.getTime() - (STALE_THRESHOLD_DAYS + 1) * 86_400_000), NOW)
    ).toBe(true);
    expect(
      isCalendarStale(new Date(NOW.getTime() - (STALE_THRESHOLD_DAYS - 1) * 86_400_000), NOW)
    ).toBe(false);
  });
});

describe('date helpers', () => {
  it('validates ISO dates strictly', () => {
    expect(isIsoDate('2026-12-05')).toBe(true);
    expect(isIsoDate('2026-02-31')).toBe(false);
    expect(isIsoDate('05-12-2026')).toBe(false);
  });

  it('enumerates an inclusive range without timezone drift', () => {
    expect(enumerateDates('2026-12-05', '2026-12-08')).toEqual([
      '2026-12-05',
      '2026-12-06',
      '2026-12-07',
      '2026-12-08'
    ]);
  });

  it('returns an empty range when from > to', () => {
    expect(enumerateDates('2026-12-08', '2026-12-05')).toEqual([]);
  });

  it('orders sessions day < night < full', () => {
    const sessions = ['full', 'night', 'day'] as const;
    expect([...sessions].sort(compareSession)).toEqual(['day', 'night', 'full']);
  });
});

describe('reservation errors (23P01 and 23514)', () => {
  const repo = new CalendarRepository();

  function pgError(code: string, message: string): Error & { code: string } {
    const err = new Error(message) as Error & { code: string };
    err.code = code;
    return err;
  }

  function clientThatFails(err: Error): PoolClient {
    return {
      query: async (sql: string) => {
        // The advisory lock and the date-occupancy probe run before the insert;
        // let them succeed so the injected failure hits the reservation itself.
        if (sql.startsWith('SELECT pg_advisory_xact_lock')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM booking_slots')) {
          return { rowCount: 0, rows: [] };
        }
        throw err;
      }
    } as unknown as PoolClient;
  }

  const slot = [{ bookingId: 'b1', date: '2026-12-05', session: 'night' as const }];

  it('maps the exclusion violation to SLOT_UNAVAILABLE', async () => {
    const client = clientThatFails(
      pgError('23P01', 'conflicting key value violates exclusion constraint')
    );
    await expect(
      repo.reserve(client, 'v1', slot, {
        blocking: true,
        holdExpiresAt: new Date('2026-11-01T00:00:00.000Z')
      })
    ).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
  });

  it('maps the vendor-blocked trigger error (23514) to SLOT_UNAVAILABLE', async () => {
    const client = clientThatFails(
      pgError('23514', 'slot v1 2026-12-05 night diblokir vendor')
    );
    try {
      await repo.reserve(client, 'v1', slot, {
        blocking: true,
        holdExpiresAt: new Date('2026-11-01T00:00:00.000Z')
      });
      throw new Error('expected AppError');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('SLOT_UNAVAILABLE');
      expect((err as AppError).status).toBe(409);
    }
  });

  it('maps the held-by-another-booking trigger error (23514) to SLOT_UNAVAILABLE', async () => {
    const client = clientThatFails(
      pgError('23514', 'slot v1 2026-12-05 night sudah dipegang booking lain')
    );
    await expect(
      repo.reserve(client, 'v1', slot, {
        blocking: true,
        holdExpiresAt: new Date('2026-11-01T00:00:00.000Z')
      })
    ).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
  });

  it('does not swallow an unrelated 23514', async () => {
    const client = clientThatFails(
      pgError('23514', 'illegal booking combination lifecycle=confirmed payment=unpaid')
    );
    await expect(
      repo.reserve(client, 'v1', slot, {
        blocking: true,
        holdExpiresAt: new Date('2026-11-01T00:00:00.000Z')
      })
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('one booking per date', () => {
  const repo = new CalendarRepository();
  const hold = new Date('2026-11-01T00:00:00.000Z');

  function recordingClient(occupancyRows: number, blockedRows = 0) {
    const calls: { sql: string; params?: unknown[] }[] = [];
    const client = {
      query: async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params });
        if (sql.startsWith('SELECT pg_advisory_xact_lock')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM booking_slots')) {
          return {
            rowCount: occupancyRows,
            rows: occupancyRows > 0 ? [{ '?column?': 1 }] : []
          };
        }
        if (sql.includes('FROM calendar_slots')) {
          return {
            rowCount: blockedRows,
            rows: blockedRows > 0 ? [{ '?column?': 1 }] : []
          };
        }
        if (sql.includes('INSERT INTO calendar_slots')) {
          return { rowCount: 1, rows: [{ id: 'c1' }] };
        }
        return { rowCount: 0, rows: [] };
      }
    } as unknown as PoolClient;
    return { client, calls };
  }

  it('rejects a different booking on the same date even in another session', async () => {
    const { client, calls } = recordingClient(1);

    await expect(
      repo.reserve(client, 'v1', [{ bookingId: 'b2', date: '2026-12-05', session: 'day' }], {
        blocking: true,
        holdExpiresAt: hold
      })
    ).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });

    expect(calls.some((call) => call.sql.startsWith('SELECT pg_advisory_xact_lock'))).toBe(true);
    expect(calls.some((call) => call.sql.includes('INSERT INTO booking_slots'))).toBe(false);
  });

  it('lets the owning booking reserve more than one session on its date', async () => {
    const { client } = recordingClient(0);

    await expect(
      repo.reserve(
        client,
        'v1',
        [
          { bookingId: 'b1', date: '2026-12-05', session: 'day' },
          { bookingId: 'b1', date: '2026-12-05', session: 'night' }
        ],
        { blocking: true, holdExpiresAt: hold }
      )
    ).resolves.toBeUndefined();
  });

  it('rejects a request on a date the vendor blocked as a full day', async () => {
    const { client } = recordingClient(0, 1);

    await expect(
      repo.reserve(client, 'v1', [{ bookingId: 'b1', date: '2026-12-05', session: 'day' }], {
        blocking: true,
        holdExpiresAt: hold
      })
    ).rejects.toMatchObject({
      code: 'SLOT_UNAVAILABLE',
      message: expect.stringContaining('diblokir vendor')
    });
  });

  it('does not probe or lock when the reservation is non-blocking', async () => {
    const { client, calls } = recordingClient(1);

    await expect(
      repo.reserve(client, 'v1', [{ bookingId: 'b2', date: '2026-12-05', session: 'day' }], {
        blocking: false
      })
    ).resolves.toBeUndefined();

    expect(calls.some((call) => call.sql.includes('pg_advisory_xact_lock'))).toBe(false);
    expect(calls.some((call) => call.sql.includes('FROM booking_slots'))).toBe(false);
  });
});
