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

const NOW = new Date('2026-10-21T10:00:00.000Z');

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
      query: async () => {
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
