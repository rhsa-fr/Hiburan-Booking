/**
 * In-memory sliding-window limiter shared by API routes.
 *
 * Deliberately process-local: it is a defensive signal, not an auditable
 * record. Each API replica keeps its own counters, so the effective limit is
 * `max × replicas`; a restart clears them. That is acceptable for endpoints
 * whose real protection is authentication/authorization and for which the
 * limiter only caps accidental or scripted bursts.
 *
 * The key map is bounded: when it exceeds `maxKeys`, the oldest inserted key is
 * dropped. Never throws — a full limiter must degrade to "some counters
 * forgotten", not to a 500.
 */

export interface SlidingWindowOptions {
  /** Allowed attempts per window. Default 10. */
  max?: number;
  /** Window length in milliseconds. Default 1 hour. */
  windowMs?: number;
  /** Upper bound on tracked keys. Default 10 000. */
  maxKeys?: number;
}

const DEFAULT_MAX = 10;
const DEFAULT_WINDOW_MS = 60 * 60_000;
const DEFAULT_MAX_KEYS = 10_000;

export class SlidingWindowLimiter {
  private readonly max: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;
  /** Keys are opaque identifiers; values are ascending attempt timestamps. */
  private readonly attempts = new Map<string, number[]>();

  constructor(options: SlidingWindowOptions = {}) {
    this.max = options.max ?? DEFAULT_MAX;
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
  }

  /**
   * Records one attempt and returns `true` while the key is still within
   * budget. `now` is injectable so tests do not depend on the wall clock.
   */
  attempt(key: string, now: number = Date.now()): boolean {
    const recent = this.prune(key, now);
    recent.push(now);
    // Re-inserting moves the key to the end of the map: the touched counter is
    // the newest, so eviction below can only drop idle keys.
    this.attempts.delete(key);
    this.attempts.set(key, recent);
    this.boundMemory();
    return recent.length <= this.max;
  }

  /** Reports whether the key is already over budget, without recording. */
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

  private prune(key: string, now: number): number[] {
    const windowStart = now - this.windowMs;
    const existing = this.attempts.get(key);
    if (!existing) return [];
    const recent = existing.filter((timestamp) => timestamp > windowStart);
    if (recent.length === 0) this.attempts.delete(key);
    return recent;
  }

  private boundMemory(): void {
    while (this.attempts.size > this.maxKeys) {
      const oldest = this.attempts.keys().next();
      if (oldest.done) return;
      this.attempts.delete(oldest.value);
    }
  }
}
