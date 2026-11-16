import { describe, expect, it } from 'vitest';
import { SlidingWindowLimiter } from './index';

describe('SlidingWindowLimiter', () => {
  it('allows exactly max attempts inside the window', () => {
    const limiter = new SlidingWindowLimiter({ max: 3, windowMs: 1000 });
    expect(limiter.attempt('u', 100)).toBe(true);
    expect(limiter.attempt('u', 200)).toBe(true);
    expect(limiter.attempt('u', 300)).toBe(true);
    expect(limiter.attempt('u', 400)).toBe(false);
  });

  it('frees budget as old attempts leave the window', () => {
    const limiter = new SlidingWindowLimiter({ max: 2, windowMs: 1000 });
    expect(limiter.attempt('u', 100)).toBe(true);
    expect(limiter.attempt('u', 200)).toBe(true);
    expect(limiter.attempt('u', 300)).toBe(false);
    // First attempt (t=100) is outside (now - 1000) at t=1200.
    expect(limiter.attempt('u', 1200)).toBe(true);
  });

  it('tracks keys independently', () => {
    const limiter = new SlidingWindowLimiter({ max: 1, windowMs: 1000 });
    expect(limiter.attempt('a', 10)).toBe(true);
    expect(limiter.attempt('a', 20)).toBe(false);
    expect(limiter.attempt('b', 20)).toBe(true);
  });

  it('reports limited state without recording', () => {
    const limiter = new SlidingWindowLimiter({ max: 2, windowMs: 1000 });
    expect(limiter.isLimited('u', 10)).toBe(false);
    limiter.attempt('u', 10);
    limiter.attempt('u', 20);
    expect(limiter.isLimited('u', 30)).toBe(false); // exactly at max
    limiter.attempt('u', 30);
    expect(limiter.isLimited('u', 40)).toBe(true);
    expect(limiter.isLimited('u', 40)).toBe(true); // idempotent read
  });

  it('bounds memory by evicting the oldest key', () => {
    const limiter = new SlidingWindowLimiter({ max: 5, windowMs: 1000, maxKeys: 2 });
    limiter.attempt('a', 10);
    limiter.attempt('b', 20);
    limiter.attempt('c', 30);
    // 'a' was evicted, so it starts from a clean budget.
    expect(limiter.isLimited('a', 40)).toBe(false);
  });

  it('reset clears every counter', () => {
    const limiter = new SlidingWindowLimiter({ max: 1, windowMs: 1000 });
    expect(limiter.attempt('u', 10)).toBe(true);
    expect(limiter.attempt('u', 20)).toBe(false);
    limiter.reset();
    expect(limiter.attempt('u', 30)).toBe(true);
  });
});
