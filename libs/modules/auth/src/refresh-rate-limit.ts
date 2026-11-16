/**
 * Per-network throttle for failed refresh attempts.
 *
 * A stolen or opaque refresh token is the only thing standing between an
 * attacker and a new session, and `/auth/refresh` is unauthenticated by design.
 * Counting failures per client IP inside a sliding window caps how many failed
 * attempts a network gets a normal answer for (afterwards it gets 429). It does
 * not skip the credential check itself, so it complements rather than replaces
 * the token rotation rules.
 *
 * Deliberately in-memory: the limiter is a defensive signal, not an auditable
 * record. Each API process keeps its own counters, and a restart clears them.
 * The key count is capped so a spoofed `X-Forwarded-For` flood cannot grow the
 * map without bound. The counting itself lives in
 * `@tarlink/platform/rate-limit` so every endpoint shares one implementation.
 */
import { SlidingWindowLimiter, type SlidingWindowOptions } from '@tarlink/platform/rate-limit';

export interface RefreshRateLimitOptions {
  max?: number;
  windowMs?: number;
  maxKeys?: number;
}

/** Defaults are intentionally generous: only sustained failure bursts trip it. */
const DEFAULT_MAX = 30;
const DEFAULT_WINDOW_MS = 5 * 60_000;
const DEFAULT_MAX_KEYS = 10_000;

export class RefreshRateLimiter {
  private readonly limiter: SlidingWindowLimiter;

  constructor(options: RefreshRateLimitOptions = {}) {
    const config: SlidingWindowOptions = {
      max: options.max ?? DEFAULT_MAX,
      windowMs: options.windowMs ?? DEFAULT_WINDOW_MS,
      maxKeys: options.maxKeys ?? DEFAULT_MAX_KEYS
    };
    this.limiter = new SlidingWindowLimiter(config);
  }

  /**
   * Records one failed attempt and returns true only when the key has now
   * exceeded `max` attempts inside the window.
   */
  recordFailure(key: string, now: number = Date.now()): boolean {
    return !this.limiter.attempt(key, now);
  }

  /** Reports whether the key is already over the limit, without recording. */
  isLimited(key: string, now: number = Date.now()): boolean {
    return this.limiter.isLimited(key, now);
  }

  /** Drops every counter; used by tests and on configuration changes. */
  reset(): void {
    this.limiter.reset();
  }
}
