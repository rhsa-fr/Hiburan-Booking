import { describe, expect, it } from 'vitest';
import { AppError } from '../../../../apps/api/src/core/errors';
import { disputeWindowEndsAt } from '../../../platform/pricing/src/index';
import {
  deriveScheduleWindow,
  jakartaLocalToUtc,
  normalizeLocalTime,
  slotWindow,
  type BookingSlotTimeRow
} from './schedule';
import { applyTransition, initialBookingState } from './state-machine';

const DAY = 24 * 60 * 60 * 1000;

function slot(overrides: Partial<BookingSlotTimeRow> = {}): BookingSlotTimeRow {
  return {
    date: '2026-12-05',
    session: 'night',
    start_time: null,
    end_time: null,
    ...overrides
  };
}

describe('local time helpers', () => {
  it('normalises HH:MM and HH:MM:SS, rejects anything else', () => {
    expect(normalizeLocalTime('08:00')).toBe('08:00:00');
    expect(normalizeLocalTime('23:59:59')).toBe('23:59:59');
    expect(normalizeLocalTime('24:00')).toBeNull();
    expect(normalizeLocalTime('8:00')).toBeNull();
    expect(normalizeLocalTime(null)).toBeNull();
  });

  it('reads local WIB as UTC+07:00', () => {
    expect(jakartaLocalToUtc('2026-12-05', '08:00:00').toISOString()).toBe(
      '2026-12-05T01:00:00.000Z'
    );
    expect(jakartaLocalToUtc('2026-12-05', '23:59:59').toISOString()).toBe(
      '2026-12-05T16:59:59.000Z'
    );
  });

  it('rejects an invalid date', () => {
    try {
      jakartaLocalToUtc('05-12-2026', '08:00:00');
      throw new Error('expected AppError');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('slot window', () => {
  it('uses the slot times when the vendor set them', () => {
    const window = slotWindow(
      slot({ session: 'day', start_time: '09:00:00', end_time: '15:30:00' })
    );
    expect(window.start.toISOString()).toBe('2026-12-05T02:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-12-05T08:30:00.000Z');
  });

  it('falls back to the session band when the slot has no times', () => {
    expect(slotWindow(slot({ session: 'day' })).start.toISOString()).toBe(
      '2026-12-05T01:00:00.000Z'
    );
    expect(slotWindow(slot({ session: 'day' })).end.toISOString()).toBe(
      '2026-12-05T10:00:00.000Z'
    );
    expect(slotWindow(slot({ session: 'night' })).start.toISOString()).toBe(
      '2026-12-05T10:00:00.000Z'
    );
    expect(slotWindow(slot({ session: 'night' })).end.toISOString()).toBe(
      '2026-12-05T16:59:59.000Z'
    );
    expect(slotWindow(slot({ session: 'full' })).end.toISOString()).toBe(
      '2026-12-05T16:59:59.000Z'
    );
  });

  it('keeps the window consistent when the times are inverted', () => {
    const window = slotWindow(
      slot({ session: 'day', start_time: '23:00:00', end_time: null })
    );
    expect(window.end.getTime()).toBeGreaterThan(window.start.getTime());
  });
});

describe('deriveScheduleWindow (L-11)', () => {
  it('uses the event times of a single day', () => {
    const window = deriveScheduleWindow([
      slot({ session: 'night', start_time: '19:00:00', end_time: '23:00:00' })
    ]);
    expect(window.scheduled_start_at.toISOString()).toBe('2026-12-05T12:00:00.000Z');
    expect(window.scheduled_end_at.toISOString()).toBe('2026-12-05T16:00:00.000Z');
  });

  it('spans from the earliest slot to the latest slot', () => {
    const window = deriveScheduleWindow([
      slot({ date: '2026-12-07', session: 'night' }),
      slot({ date: '2026-12-05', session: 'day' }),
      slot({ date: '2026-12-06', session: 'full' })
    ]);
    expect(window.scheduled_start_at.toISOString()).toBe('2026-12-05T01:00:00.000Z');
    expect(window.scheduled_end_at.toISOString()).toBe('2026-12-07T16:59:59.000Z');
  });

  it('covers both sessions booked on the same day', () => {
    const window = deriveScheduleWindow([
      slot({ session: 'day' }),
      slot({ session: 'night' })
    ]);
    expect(window.scheduled_start_at.toISOString()).toBe('2026-12-05T01:00:00.000Z');
    expect(window.scheduled_end_at.toISOString()).toBe('2026-12-05T16:59:59.000Z');
  });

  it('refuses to derive a window without slots', () => {
    try {
      deriveScheduleWindow([]);
      throw new Error('expected AppError');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('CONFLICT');
    }
  });

  it('anchors the dispute window on scheduled_end_at + 7 days', () => {
    const window = deriveScheduleWindow([slot({ session: 'night' })]);
    expect(disputeWindowEndsAt(window.scheduled_end_at).toISOString()).toBe(
      new Date(window.scheduled_end_at.getTime() + 7 * DAY).toISOString()
    );
  });
});

describe('L-11 with the derived window', () => {
  const now = new Date('2026-11-01T02:00:00.000Z');

  it('confirms the booking and holds the settlement', () => {
    const window = deriveScheduleWindow([slot({ session: 'night' })]);
    const result = applyTransition(
      {
        ...initialBookingState({
          lifecycle_status: 'accepted',
          payment_status: 'unpaid',
          settlement_status: 'not_eligible',
          total_customer_idr: 4_025_000n,
          payment_deadline: new Date(now.getTime() + DAY)
        }),
        scheduled_start_at: window.scheduled_start_at,
        scheduled_end_at: window.scheduled_end_at
      },
      'payment.dp_succeeded',
      { actor: 'system', now }
    );

    expect(result.next.lifecycle_status).toBe('confirmed');
    expect(result.next.payment_status).toBe('dp_paid');
    expect(result.next.settlement_status).toBe('held');
    expect(result.changes.map((change) => change.axis)).toEqual([
      'lifecycle',
      'payment',
      'settlement'
    ]);
    expect(result.derived.dispute_window_ends_at?.toISOString()).toBe(
      disputeWindowEndsAt(window.scheduled_end_at).toISOString()
    );
    expect(result.derived.dispute_window_ends_at?.getTime()).not.toBe(
      new Date(now.getTime() + 7 * DAY).getTime()
    );
  });

  it('needs the scheduled end before the transition is allowed', () => {
    expect(() =>
      applyTransition(
        initialBookingState({
          lifecycle_status: 'accepted',
          payment_status: 'unpaid',
          settlement_status: 'not_eligible'
        }),
        'payment.dp_succeeded',
        { actor: 'system', now }
      )
    ).toThrowError(AppError);
  });
});
