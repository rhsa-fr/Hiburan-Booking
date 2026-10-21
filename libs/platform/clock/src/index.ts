/**
 * Clock port (TECH-DESIGN-v1.0 §2.5 rule 5).
 *
 * Domain code never calls `Date.now()` directly: it injects a `Clock` so tests
 * can freeze or advance time without patching globals.
 */
export interface Clock {
  /** Current instant. Always a fresh Date so callers cannot mutate clock state. */
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Test double: time only moves when the test says so. */
export class FixedClock implements Clock {
  private current: Date;

  constructor(initial: Date | string | number) {
    this.current = new Date(initial);
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  set(at: Date | string | number): void {
    this.current = new Date(at);
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}
