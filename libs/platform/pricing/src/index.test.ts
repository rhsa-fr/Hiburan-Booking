import { describe, expect, it } from 'vitest';
import {
  autoCompleteAt,
  clawbackDeadline,
  computeCommission,
  disputeWindowEndsAt,
  paymentDeadlineFrom,
  paymentDeadlineHours
} from './index';

describe('computeCommission (D-17)', () => {
  it('applies floor for a small booking', () => {
    expect(computeCommission(750_000n)).toEqual({ tier1: 75_000n, tier2: 0n, total: 75_000n });
  });

  it('charges 10% up to the 10M threshold', () => {
    expect(computeCommission(4_000_000n)).toEqual({ tier1: 400_000n, tier2: 0n, total: 400_000n });
  });

  it('splits tiers above the threshold', () => {
    expect(computeCommission(40_000_000n)).toEqual({
      tier1: 1_000_000n,
      tier2: 1_500_000n,
      total: 2_500_000n
    });
  });

  it('enforces the absolute cap', () => {
    expect(computeCommission(500_000_000n).total).toBe(7_500_000n);
  });

  it('enforces the floor', () => {
    expect(computeCommission(100_000n).total).toBe(25_000n);
  });

  it('never charges on zero or negative base', () => {
    expect(computeCommission(0n).total).toBe(0n);
    expect(computeCommission(-1n).total).toBe(0n);
  });
});

describe('payment deadline (D-18)', () => {
  it('is 24 hours below the high-value threshold', () => {
    expect(paymentDeadlineHours(9_999_999n)).toBe(24);
  });

  it('is 48 hours at or above Rp 10 jt', () => {
    expect(paymentDeadlineHours(10_000_000n)).toBe(48);
  });

  it('computes an absolute deadline', () => {
    const now = new Date('2026-10-21T00:00:00.000Z');
    expect(paymentDeadlineFrom(now, 4_000_000n).toISOString()).toBe('2026-10-22T00:00:00.000Z');
  });
});

describe('windows', () => {
  const end = new Date('2026-10-24T15:00:00.000Z');

  it('auto-completes at scheduled_end + 3 days', () => {
    expect(autoCompleteAt(end).toISOString()).toBe('2026-10-27T15:00:00.000Z');
  });

  it('anchors the dispute window to scheduled_end + 7 days', () => {
    expect(disputeWindowEndsAt(end).toISOString()).toBe('2026-10-31T15:00:00.000Z');
  });

  it('allows clawback for 30 days after release', () => {
    const released = new Date('2026-11-01T00:00:00.000Z');
    expect(clawbackDeadline(released).toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });
});
