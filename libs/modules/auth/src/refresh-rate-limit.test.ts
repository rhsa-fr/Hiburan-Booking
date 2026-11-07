/**
 * Unit tests for the refresh-failure limiter. The clock is always injected so
 * the window maths is deterministic and the suite never sleeps.
 */
import { describe, expect, it } from 'vitest';
import { RefreshRateLimiter } from './refresh-rate-limit';

const T0 = 1_700_000_000_000;

describe('RefreshRateLimiter', () => {
  it('counts failures without tripping at or below max', () => {
    const limiter = new RefreshRateLimiter({ max: 2, windowMs: 60_000 });

    expect(limiter.recordFailure('ip-a', T0)).toBe(false);
    expect(limiter.recordFailure('ip-a', T0 + 1)).toBe(false);
    expect(limiter.isLimited('ip-a', T0 + 2)).toBe(false);
  });

  it('trips only when the count exceeds max', () => {
    const limiter = new RefreshRateLimiter({ max: 2, windowMs: 60_000 });

    limiter.recordFailure('ip-a', T0);
    limiter.recordFailure('ip-a', T0 + 1);
    expect(limiter.recordFailure('ip-a', T0 + 2)).toBe(true);
    expect(limiter.isLimited('ip-a', T0 + 3)).toBe(true);
  });

  it('isLimited does not record an attempt', () => {
    const limiter = new RefreshRateLimiter({ max: 2, windowMs: 60_000 });

    limiter.recordFailure('ip-a', T0);
    limiter.recordFailure('ip-a', T0 + 1);
    expect(limiter.isLimited('ip-a', T0 + 2)).toBe(false);
    expect(limiter.isLimited('ip-a', T0 + 3)).toBe(false);
    // The third *recorded* failure is still the one that trips it.
    expect(limiter.recordFailure('ip-a', T0 + 4)).toBe(true);
  });

  it('expires attempts that fall out of the sliding window', () => {
    const limiter = new RefreshRateLimiter({ max: 2, windowMs: 60_000 });

    limiter.recordFailure('ip-a', T0);
    limiter.recordFailure('ip-a', T0);
    expect(limiter.recordFailure('ip-a', T0)).toBe(true);

    // Still inside the window: the counter is not reset yet.
    expect(limiter.isLimited('ip-a', T0 + 59_999)).toBe(true);
    // Exactly one window later the old attempts are gone.
    expect(limiter.isLimited('ip-a', T0 + 60_000)).toBe(false);
  });

  it('keeps keys independent of each other', () => {
    const limiter = new RefreshRateLimiter({ max: 1, windowMs: 60_000 });

    limiter.recordFailure('ip-a', T0);
    limiter.recordFailure('ip-b', T0);
    expect(limiter.recordFailure('ip-a', T0 + 1)).toBe(true);
    expect(limiter.recordFailure('ip-b', T0 + 1)).toBe(true);
    expect(limiter.isLimited('ip-c', T0 + 1)).toBe(false);
  });

  it('bounds memory by dropping the oldest key when maxKeys is exceeded', () => {
    const limiter = new RefreshRateLimiter({ max: 1, windowMs: 60_000, maxKeys: 2 });

    limiter.recordFailure('ip-a', T0);
    limiter.recordFailure('ip-a', T0);
    limiter.recordFailure('ip-b', T0);
    limiter.recordFailure('ip-b', T0);
    limiter.recordFailure('ip-c', T0);
    limiter.recordFailure('ip-c', T0);

    // Oldest key was evicted, the two newest keep their counters.
    expect(limiter.isLimited('ip-a', T0 + 1)).toBe(false);
    expect(limiter.isLimited('ip-b', T0 + 1)).toBe(true);
    expect(limiter.isLimited('ip-c', T0 + 1)).toBe(true);
  });

  it('does not evict the key that was just recorded', () => {
    const limiter = new RefreshRateLimiter({ max: 1, windowMs: 60_000, maxKeys: 1 });

    limiter.recordFailure('ip-b', T0);
    limiter.recordFailure('ip-a', T0);
    // `ip-a` filled the map; its own counter must survive the eviction of `ip-b`.
    expect(limiter.isLimited('ip-a', T0 + 1)).toBe(false);
    expect(limiter.recordFailure('ip-a', T0 + 2)).toBe(true);
    expect(limiter.isLimited('ip-b', T0 + 3)).toBe(false);
  });

  it('reset clears every counter', () => {
    const limiter = new RefreshRateLimiter({ max: 1, windowMs: 60_000 });

    limiter.recordFailure('ip-a', T0);
    limiter.recordFailure('ip-a', T0 + 1);
    expect(limiter.isLimited('ip-a', T0 + 2)).toBe(true);

    limiter.reset();
    expect(limiter.isLimited('ip-a', T0 + 3)).toBe(false);
    expect(limiter.recordFailure('ip-a', T0 + 4)).toBe(false);
  });

  it('uses the documented defaults (30 failures per 5 minutes)', () => {
    const limiter = new RefreshRateLimiter();
    const windowMs = 5 * 60_000;

    for (let i = 0; i < 30; i += 1) {
      expect(limiter.recordFailure('ip-a', T0 + i)).toBe(false);
    }
    expect(limiter.recordFailure('ip-a', T0 + 30)).toBe(true);
    expect(limiter.isLimited('ip-a', T0 + windowMs - 1)).toBe(true);
    expect(limiter.isLimited('ip-a', T0 + windowMs)).toBe(false);
  });
});
