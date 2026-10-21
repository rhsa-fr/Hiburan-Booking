import { describe, expect, it } from 'vitest';
import {
  autoReleaseSkipReason,
  clawbackDeadlineFor,
  shouldAutoComplete,
  shouldAutoRelease,
  shouldExpireHold,
  shouldExpireUnpaid,
  type AutoCompleteCandidate,
  type AutoReleaseCandidate
} from './decisions';

const NOW = new Date('2026-03-10T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const releaseCandidate = (overrides: Partial<AutoReleaseCandidate> = {}): AutoReleaseCandidate => ({
  lifecycle_status: 'completed',
  payment_status: 'fully_paid',
  settlement_status: 'held',
  dispute_window_ends_at: new Date('2026-03-01T00:00:00.000Z'),
  vendor_entitlement_idr: 4_500_000n,
  ...overrides
});

describe('shouldAutoComplete (L-22, scheduled_end_at + 3 days)', () => {
  const dueCandidate = (overrides: Partial<AutoCompleteCandidate> = {}): AutoCompleteCandidate => ({
    lifecycle_status: 'confirmed',
    payment_status: 'fully_paid',
    scheduled_end_at: new Date(NOW.getTime() - 4 * DAY),
    has_open_dispute: false,
    ...overrides
  });

  it('is due exactly at scheduled_end_at + 3 days', () => {
    expect(
      shouldAutoComplete(
        dueCandidate({ lifecycle_status: 'in_progress', scheduled_end_at: new Date(NOW.getTime() - 3 * DAY) }),
        NOW
      )
    ).toBe(true);
  });

  it('is not due one millisecond early', () => {
    expect(
      shouldAutoComplete(dueCandidate({ scheduled_end_at: new Date(NOW.getTime() - 3 * DAY + 1) }), NOW)
    ).toBe(false);
  });

  it('completes a confirmed booking whose vendor never checked in', () => {
    expect(shouldAutoComplete(dueCandidate(), NOW)).toBe(true);
  });

  it('refuses when a dispute is open, when the end is unknown, or when already terminal', () => {
    expect(shouldAutoComplete(dueCandidate({ has_open_dispute: true }), NOW)).toBe(false);
    expect(shouldAutoComplete(dueCandidate({ scheduled_end_at: null }), NOW)).toBe(false);
    expect(shouldAutoComplete(dueCandidate({ lifecycle_status: 'completed' }), NOW)).toBe(false);
    expect(shouldAutoComplete(dueCandidate({ lifecycle_status: 'cancelled' }), NOW)).toBe(false);
  });

  it('completes fully_paid and partially_refunded bookings', () => {
    expect(shouldAutoComplete(dueCandidate({ payment_status: 'fully_paid' }), NOW)).toBe(true);
    expect(shouldAutoComplete(dueCandidate({ payment_status: 'partially_refunded' }), NOW)).toBe(true);
  });

  it('never completes a booking whose payment axis is unsettled', () => {
    for (const payment_status of ['dp_paid', 'unpaid', 'refunded']) {
      expect(shouldAutoComplete(dueCandidate({ payment_status }), NOW), payment_status).toBe(false);
    }
  });
});

describe('clawbackDeadlineFor (FR-122: 30 days after release)', () => {
  it('is exactly released_at + 30 days', () => {
    expect(clawbackDeadlineFor(new Date('2026-03-01T00:00:00.000Z')).toISOString()).toBe(
      '2026-03-31T00:00:00.000Z'
    );
  });
});

describe('shouldExpireUnpaid (L-14)', () => {
  const base = {
    lifecycle_status: 'accepted',
    payment_status: 'unpaid',
    payment_deadline: new Date(NOW.getTime() - 1),
    has_paid_dp: false
  };

  it('expires after the deadline with no DP', () => {
    expect(shouldExpireUnpaid(base, NOW)).toBe(true);
  });

  it('keeps the hold open at the exact deadline (strictly after)', () => {
    expect(shouldExpireUnpaid({ ...base, payment_deadline: NOW }, NOW)).toBe(false);
  });

  it('never expires a booking with a successful DP or a non-accepted state', () => {
    expect(shouldExpireUnpaid({ ...base, has_paid_dp: true }, NOW)).toBe(false);
    expect(shouldExpireUnpaid({ ...base, payment_status: 'dp_paid' }, NOW)).toBe(false);
    expect(shouldExpireUnpaid({ ...base, lifecycle_status: 'confirmed' }, NOW)).toBe(false);
    expect(shouldExpireUnpaid({ ...base, payment_deadline: null }, NOW)).toBe(false);
  });
});

describe('shouldAutoRelease / autoReleaseSkipReason (S-02)', () => {
  it('releases after the window with no dispute and no prior release', () => {
    expect(shouldAutoRelease(releaseCandidate(), NOW, false, false)).toBe(true);
    expect(autoReleaseSkipReason(releaseCandidate(), NOW, false, false)).toBeNull();
  });

  it('waits while the dispute window is still open', () => {
    expect(autoReleaseSkipReason(releaseCandidate({ dispute_window_ends_at: NOW }), NOW, false, false)).toBe(
      'dispute_window_open'
    );
    expect(
      autoReleaseSkipReason(releaseCandidate({ dispute_window_ends_at: new Date(NOW.getTime() + HOUR) }), NOW, false, false)
    ).toBe('dispute_window_open');
  });

  it('refuses when a dispute is open or a release entry already exists', () => {
    expect(autoReleaseSkipReason(releaseCandidate(), NOW, true, false)).toBe('open_dispute');
    expect(autoReleaseSkipReason(releaseCandidate(), NOW, false, true)).toBe('already_released');
  });

  it('refuses to move money that is missing or non-positive', () => {
    expect(autoReleaseSkipReason(releaseCandidate({ vendor_entitlement_idr: 0n }), NOW, false, false)).toBe(
      'non_positive_vendor_entitlement'
    );
    expect(autoReleaseSkipReason(releaseCandidate({ vendor_entitlement_idr: null }), NOW, false, false)).toBe(
      'missing_vendor_entitlement'
    );
  });

  it('refuses illegal settlement combinations', () => {
    expect(autoReleaseSkipReason(releaseCandidate({ payment_status: 'dp_paid' }), NOW, false, false)).toBe(
      'payment_not_fully_paid'
    );
    expect(autoReleaseSkipReason(releaseCandidate({ settlement_status: 'released' }), NOW, false, false)).toBe(
      'settlement_not_held'
    );
    expect(autoReleaseSkipReason(releaseCandidate({ lifecycle_status: 'in_progress' }), NOW, false, false)).toBe(
      'lifecycle_not_completed'
    );
    expect(
      autoReleaseSkipReason(releaseCandidate({ dispute_window_ends_at: null }), NOW, false, false)
    ).toBe('dispute_window_missing');
  });

  it('accepts partially_refunded settlements (legal for released)', () => {
    expect(shouldAutoRelease(releaseCandidate({ payment_status: 'partially_refunded' }), NOW, false, false)).toBe(
      true
    );
  });
});

describe('shouldExpireHold (stale hold TTL)', () => {
  it('frees a held slot whose TTL passed for a non-confirmed booking', () => {
    expect(
      shouldExpireHold(
        { status: 'held', hold_expires_at: new Date(NOW.getTime() - 1), booking_lifecycle_status: 'accepted' },
        NOW
      )
    ).toBe(true);
  });

  it('leaves booked slots, confirmed bookings, live holds and open-ended holds alone', () => {
    const past = new Date(NOW.getTime() - 1);
    expect(shouldExpireHold({ status: 'booked', hold_expires_at: past, booking_lifecycle_status: 'confirmed' }, NOW)).toBe(
      false
    );
    expect(shouldExpireHold({ status: 'held', hold_expires_at: past, booking_lifecycle_status: 'confirmed' }, NOW)).toBe(
      false
    );
    expect(shouldExpireHold({ status: 'held', hold_expires_at: NOW, booking_lifecycle_status: 'accepted' }, NOW)).toBe(
      false
    );
    expect(
      shouldExpireHold({ status: 'held', hold_expires_at: null, booking_lifecycle_status: 'accepted' }, NOW)
    ).toBe(false);
  });
});
