import { vi } from 'vitest';

/**
 * Browser globals for the admin unit tests. Deliberately dependency-free:
 * pulling in jsdom/happy-dom just to get `localStorage` would buy nothing for
 * modules that only touch storage and events.
 *
 * Node 24 already provides `Event`, `EventTarget`, `Headers`, `Response` and
 * `crypto.randomUUID`, so those are not polyfilled here.
 */

/**
 * `Storage` over a `Map`. Insertion order matches the Web Storage spec closely
 * enough for assertions; values are coerced to string like the real thing.
 */
export class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();

  // Required by the `Storage` interface (named properties share the namespace).
  [name: string]: unknown;

  get length(): number {
    return this.items.size;
  }

  clear(): void {
    this.items.clear();
  }

  getItem(key: string): string | null {
    const value = this.items.get(key);
    return value === undefined ? null : value;
  }

  key(index: number): string | null {
    if (index < 0 || index >= this.items.size) return null;
    return [...this.items.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }

  setItem(key: string, value: string): void {
    this.items.set(key, String(value));
  }
}

export interface BrowserEnv {
  localStorage: Storage;
  sessionStorage: Storage;
}

/**
 * Stubs `globalThis.window` with the subset the admin lib uses: the two
 * storages plus an event bus (`tarlink:session-ended` is dispatched through it).
 * The returned storages are the live instances for assertions; they are also
 * reachable as `window.localStorage` / `window.sessionStorage`.
 */
export function installBrowserEnv(): BrowserEnv {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const events = new EventTarget();

  const windowStub = {
    localStorage,
    sessionStorage,
    dispatchEvent(event: Event): boolean {
      return events.dispatchEvent(event);
    },
    addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions
    ): void {
      events.addEventListener(type, listener, options);
    },
    removeEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions
    ): void {
      events.removeEventListener(type, listener, options);
    }
  };

  vi.stubGlobal('window', windowStub);
  return { localStorage, sessionStorage };
}

/** Removes every stubbed global (`window`, and any per-test `fetch` stub). */
export function cleanupBrowserEnv(): void {
  vi.unstubAllGlobals();
}
