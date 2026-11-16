import { describe, expect, it } from 'vitest';
import { formatEventDate, planEmailNotification, planNotification } from './templates';

const payload = {
  booking_id: '22222222-2222-2222-2222-222222222222',
  code: 'BK-261115-AB12',
  event_date: '2026-11-15',
  offset_days: 7
};

describe('planNotification — pengingat FR-052', () => {
  it('announces the H-7 reminder to both parties', () => {
    const plan = planNotification('booking.reminder_7d', payload);
    expect(plan?.audience).toBe('both');
    expect(plan?.title).toBe('Acara 7 hari lagi');
    expect(plan?.body).toContain('BK-261115-AB12');
    expect(plan?.body).toContain('15 November 2026');
  });

  it('announces the H-1 reminder', () => {
    const plan = planNotification('booking.reminder_1d', payload);
    expect(plan?.title).toBe('Acara besok');
    expect(plan?.body).toContain('15 November 2026');
  });

  it('announces the event-day reminder without a date claim', () => {
    const plan = planNotification('booking.reminder_day', payload);
    expect(plan?.title).toBe('Acara hari ini');
    expect(plan?.body).toContain('BK-261115-AB12');
    expect(plan?.body).not.toContain('besok');
  });

  it('still produces a body when the payload has no usable date', () => {
    const plan = planNotification('booking.reminder_7d', { code: 'BK-1' });
    expect(plan?.body).toContain('tanggal yang dijadwalkan');
  });
});

describe('planEmailNotification — pengingat FR-052', () => {
  it('wraps the same copy in an email with the booking code in the subject', () => {
    const email = planEmailNotification('booking.reminder_1d', payload);
    expect(email?.audience).toBe('both');
    expect(email?.subject).toContain('Acara besok');
    expect(email?.subject).toContain('BK-261115-AB12');
    expect(email?.text).toContain('15 November 2026');
  });

  it('keeps internal events internal', () => {
    expect(planEmailNotification('internal.tick', payload)).toBeNull();
  });
});

describe('formatEventDate', () => {
  it('renders Indonesian month names', () => {
    expect(formatEventDate('2026-01-01')).toBe('1 Januari 2026');
    expect(formatEventDate('2026-08-17')).toBe('17 Agustus 2026');
    expect(formatEventDate('2026-12-31')).toBe('31 Desember 2026');
  });

  it('falls back instead of guessing on malformed input', () => {
    expect(formatEventDate(undefined)).toBe('tanggal yang dijadwalkan');
    expect(formatEventDate('15-11-2026')).toBe('tanggal yang dijadwalkan');
    expect(formatEventDate('2026-13-01')).toBe('tanggal yang dijadwalkan');
  });
});
