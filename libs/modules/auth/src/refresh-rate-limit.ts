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
 * map without bound.
 */

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
  private readonly max: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;
  /** Keys are client IPs; values are ascending attempt timestamps. */
  private readonly attempts = new Map<string, number[]>();

  constructor(options: RefreshRateLimitOptions = {}) {
    this.max = options.max ?? DEFAULT_MAX;
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
  }

  /**
   * Records one failed attempt and returns true only when the key has now
   * exceeded `max` attempts inside the window. `now` is injectable so tests do
   * not depend on the wall clock.
   */
  recordFailure(key: string, now: number = Date.now()): boolean {
    const recent = this.prune(key, now);
    recent.push(now);
    // Re-inserting moves the key to the end of the map: the touched counter is
    // the newest, so eviction below can only drop idle keys.
    this.attempts.delete(key);
    this.attempts.set(key, recent);
    this.boundMemory();
    return recent.length > this.max;
  }

  /** Reports whether the key is already over the limit, without recording. */
  isLimited(key: string, now: number = Date.now()): boolean {
    const recent = this.prune(key, now);
    if (recent.length === 0) return false;
    this.attempts.set(key, recent);
    this.boundMemory();
    return recent.length > this.max;
  }

  /** Drops every counter; used by tests and on configuration changes. */
  reset(): void {
    this.attempts.clear();
  }

  /** Attempts whose timestamp is at or before `now - windowMs` have expired. */
  private prune(key: string, now: number): number[] {
    const windowStart = now - this.windowMs;
    const existing = this.attempts.get(key);
    if (!existing) return [];
    const recent = existing.filter((timestamp) => timestamp > windowStart);
    if (recent.length === 0) this.attempts.delete(key);
    return recent;
  }

  /**
   * Keeps the map bounded without scanning it. Expired buckets are dropped by
   * `prune` the next time their key is touched; when the map is over capacity
   * the oldest insertion is evicted one step at a time (O(1) amortised).
   * Never throws: a full limiter must degrade into "some counters forgotten",
   * not into a 500 on refresh.
   */
  private boundMemory(): void {
    while (this.attempts.size > this.maxKeys) {
      const oldest = this.attempts.keys().next();
      if (oldest.done) return;
      this.attempts.delete(oldest.value);
    }
  }
}
