import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupBrowserEnv, installBrowserEnv, type BrowserEnv } from '../test/browser-env';
import { saveToken } from './session';

/**
 * The localStorage-lease fallback in `lib/api.ts` is unreachable from the rest
 * of the suite: Node 24 always exposes `navigator.locks`. Every test here
 * therefore replaces `navigator` with an object without `locks` (or with a fake
 * lock manager), while `window` still comes from `installBrowserEnv()`.
 *
 * The lease constants are duplicated on purpose: they are module-private in
 * `api.ts`, and exporting them would widen the production surface for tests.
 */
const LEASE_KEY = 'tarlink.admin.refresh.lock';
const LEASE_WAIT_MS = 10_000;
const LEASE_RETRY_MS = 75;
const REFRESH_LOCK_NAME = 'tarlink.admin.refresh';
const REFRESH_SUFFIX = '/v1/auth/refresh';
const TOKEN_KEY = 'tarlink.admin.token';

let env: BrowserEnv;

beforeEach(() => {
  env = installBrowserEnv();
});

afterEach(() => {
  vi.useRealTimers();
  cleanupBrowserEnv();
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Response-like object: `api.ts` only reads `ok`, `status` and `json()`. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as unknown as Response;
}

function refreshPayload(token: string, userId: string): unknown {
  return {
    data: {
      access_token: token,
      token_type: 'Bearer',
      expires_in: 900,
      user: { id: userId }
    }
  };
}

/**
 * `api.ts` keeps module state (`refreshInFlight`, `refreshGeneration`, lease
 * owner bookkeeping), so the module is re-imported per test.
 */
async function loadApi() {
  vi.resetModules();
  return import('./api');
}

type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function installFetch(handler: FetchHandler) {
  const mock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
      handler(String(input), init)
  );
  vi.stubGlobal('fetch', mock);
  return mock;
}

function refreshCalls(fetchMock: ReturnType<typeof installFetch>) {
  return fetchMock.mock.calls.filter(([input]) => String(input).endsWith(REFRESH_SUFFIX));
}

/** `navigator` without `locks`: forces `api.ts` onto the localStorage lease. */
function installNavigatorWithoutLocks(): void {
  vi.stubGlobal('navigator', {});
}

/** Current lease value as stored, parsed back for structural assertions. */
function readStoredLease(): unknown {
  const raw = env.localStorage.getItem(LEASE_KEY);
  return raw === null ? null : JSON.parse(raw);
}

function storedToken(): unknown {
  return JSON.parse(env.localStorage.getItem(TOKEN_KEY) ?? 'null');
}

/* -------------------------------------------------------------------------- */
/* (a) Path selection                                                          */
/* -------------------------------------------------------------------------- */

describe('refresh lock: pemilihan jalur', () => {
  it('memakai navigator.locks bila tersedia dan tidak menyentuh lease', async () => {
    const request = vi.fn((_name: string, work: () => Promise<string | null>) => work());
    vi.stubGlobal('navigator', { locks: { request } });

    const leaseDuringWork: Array<string | null> = [];
    installFetch((url) => {
      if (!url.endsWith(REFRESH_SUFFIX)) throw new Error(`fetch tak terduga: ${url}`);
      leaseDuringWork.push(env.localStorage.getItem(LEASE_KEY));
      return Promise.resolve(jsonResponse(refreshPayload('locks-token', 'u1')));
    });

    const api = await loadApi();

    await expect(api.refreshAccessToken(null)).resolves.toBe('locks-token');

    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toBe(REFRESH_LOCK_NAME);
    expect(typeof request.mock.calls[0]?.[1]).toBe('function');
    // The fallback must stay untouched while the Web Locks API is present.
    expect(leaseDuringWork).toEqual([null]);
    expect(env.localStorage.getItem(LEASE_KEY)).toBeNull();
    expect(storedToken()).toEqual({ token: 'locks-token', userId: 'u1' });
  });

  it('jatuh ke lease localStorage saat navigator tidak punya locks, lalu melepasnya', async () => {
    installNavigatorWithoutLocks();

    const leaseDuringWork: unknown[] = [];
    const fetchMock = installFetch((url) => {
      if (!url.endsWith(REFRESH_SUFFIX)) throw new Error(`fetch tak terduga: ${url}`);
      leaseDuringWork.push(readStoredLease());
      return Promise.resolve(jsonResponse(refreshPayload('fallback-token', 'u1')));
    });

    const api = await loadApi();

    await expect(api.refreshAccessToken(null)).resolves.toBe('fallback-token');

    expect(refreshCalls(fetchMock)).toHaveLength(1);
    // The lease exists for the duration of the work ...
    expect(leaseDuringWork).toHaveLength(1);
    const held = leaseDuringWork[0] as { owner: string; expiresAt: number };
    expect(typeof held.owner).toBe('string');
    expect(held.owner.length).toBeGreaterThan(0);
    expect(held.expiresAt).toBeGreaterThan(Date.now());
    // ... and is released afterwards.
    expect(env.localStorage.getItem(LEASE_KEY)).toBeNull();
    expect(storedToken()).toEqual({ token: 'fallback-token', userId: 'u1' });
  });
});

/* -------------------------------------------------------------------------- */
/* (b) Foreign valid lease                                                     */
/* -------------------------------------------------------------------------- */

describe('refresh lock: lease milik tab lain', () => {
  it('tidak merampas lease yang masih valid; setelah LEASE_WAIT_MS refresh tetap jalan', async () => {
    vi.useFakeTimers();
    installNavigatorWithoutLocks();

    const foreign = { owner: 'tab-lain', expiresAt: Date.now() + 60_000 };
    env.localStorage.setItem(LEASE_KEY, JSON.stringify(foreign));

    const leaseAtFetch: unknown[] = [];
    const fetchMock = installFetch((url) => {
      if (!url.endsWith(REFRESH_SUFFIX)) throw new Error(`fetch tak terduga: ${url}`);
      leaseAtFetch.push(readStoredLease());
      return Promise.resolve(jsonResponse(refreshPayload('best-effort', 'u1')));
    });

    const api = await loadApi();
    const pending = api.refreshAccessToken(null);

    // Still waiting: the foreign lease is valid and must not be overwritten.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(readStoredLease()).toEqual(foreign);
    expect(refreshCalls(fetchMock)).toHaveLength(0);

    // The wait budget is exhausted: refresh proceeds best-effort without a lock.
    await vi.advanceTimersByTimeAsync(LEASE_WAIT_MS + LEASE_RETRY_MS * 2);
    await expect(pending).resolves.toBe('best-effort');

    expect(refreshCalls(fetchMock)).toHaveLength(1);
    // Work ran while the foreign lease was still the one in storage.
    expect(leaseAtFetch).toEqual([foreign]);
    // Best-effort means "no release": someone else's lease stays untouched.
    expect(readStoredLease()).toEqual(foreign);
    expect(storedToken()).toEqual({ token: 'best-effort', userId: 'u1' });
  });
});

/* -------------------------------------------------------------------------- */
/* (c) Corrupt lease records                                                   */
/* -------------------------------------------------------------------------- */

describe('refresh lock: lease rusak', () => {
  it.each([
    ['JSON rusak', '{not json'],
    ['record tanpa owner', '{"expiresAt":9999999999999}'],
    ['owner kosong', '{"owner":"","expiresAt":9999999999999}'],
    ['expiresAt bukan angka', '{"owner":"tab-lain","expiresAt":"besok"}']
  ])('%s tidak memblokir refresh', async (_label, raw) => {
    installNavigatorWithoutLocks();
    env.localStorage.setItem(LEASE_KEY, raw);

    const fetchMock = installFetch((url) => {
      if (!url.endsWith(REFRESH_SUFFIX)) throw new Error(`fetch tak terduga: ${url}`);
      return Promise.resolve(jsonResponse(refreshPayload('recovered', 'u1')));
    });

    const api = await loadApi();

    await expect(api.refreshAccessToken(null)).resolves.toBe('recovered');

    expect(refreshCalls(fetchMock)).toHaveLength(1);
    expect(storedToken()).toEqual({ token: 'recovered', userId: 'u1' });
    // Corrupt data is treated as expired, taken over and cleaned up again.
    expect(env.localStorage.getItem(LEASE_KEY)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* (d) Expired lease                                                           */
/* -------------------------------------------------------------------------- */

describe('refresh lock: lease kedaluwarsa', () => {
  it('diambil alih, dipakai selama refresh, lalu dilepas', async () => {
    installNavigatorWithoutLocks();

    const expired = { owner: 'tab-mati', expiresAt: Date.now() - 1_000 };
    env.localStorage.setItem(LEASE_KEY, JSON.stringify(expired));

    const leaseAtFetch: unknown[] = [];
    const fetchMock = installFetch((url) => {
      if (!url.endsWith(REFRESH_SUFFIX)) throw new Error(`fetch tak terduga: ${url}`);
      leaseAtFetch.push(readStoredLease());
      return Promise.resolve(jsonResponse(refreshPayload('takeover', 'u1')));
    });

    const api = await loadApi();

    await expect(api.refreshAccessToken(null)).resolves.toBe('takeover');

    expect(refreshCalls(fetchMock)).toHaveLength(1);
    expect(leaseAtFetch).toHaveLength(1);
    const held = leaseAtFetch[0] as { owner: string; expiresAt: number };
    expect(held.owner).not.toBe(expired.owner);
    expect(held.expiresAt).toBeGreaterThan(Date.now());
    expect(env.localStorage.getItem(LEASE_KEY)).toBeNull();
    expect(storedToken()).toEqual({ token: 'takeover', userId: 'u1' });
  });
});

/* -------------------------------------------------------------------------- */
/* (e) Single-flight on the lease path                                         */
/* -------------------------------------------------------------------------- */

describe('refresh lock: single-flight di jalur lease', () => {
  it('dua pemanggil bersamaan hanya memicu satu fetch dan menyimpan token baru', async () => {
    installNavigatorWithoutLocks();

    const leaseAtFetch: unknown[] = [];
    const fetchMock = installFetch((url) => {
      if (!url.endsWith(REFRESH_SUFFIX)) throw new Error(`fetch tak terduga: ${url}`);
      leaseAtFetch.push(readStoredLease());
      return Promise.resolve(jsonResponse(refreshPayload('shared-token', 'u1')));
    });

    const api = await loadApi();

    const [first, second] = await Promise.all([
      api.refreshAccessToken(null),
      api.refreshAccessToken(null)
    ]);

    expect(first).toBe('shared-token');
    expect(second).toBe('shared-token');
    expect(refreshCalls(fetchMock)).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // One holder, one network refresh, nothing left behind.
    expect(leaseAtFetch).toHaveLength(1);
    expect(env.localStorage.getItem(LEASE_KEY)).toBeNull();
    expect(storedToken()).toEqual({ token: 'shared-token', userId: 'u1' });
  });
});

/* -------------------------------------------------------------------------- */
/* (f) Another tab already refreshed                                           */
/* -------------------------------------------------------------------------- */

describe('refresh lock: token sudah diperbarui tab lain', () => {
  it('di jalur lease tidak memanggil fetch dan tetap melepas lock', async () => {
    installNavigatorWithoutLocks();
    saveToken('fresh-from-other-tab', 'u1');

    const fetchMock = installFetch(() => {
      throw new Error('fetch tidak boleh dipanggil');
    });

    const api = await loadApi();

    await expect(api.refreshAccessToken('stale-token')).resolves.toBe('fresh-from-other-tab');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(env.localStorage.getItem(LEASE_KEY)).toBeNull();
    expect(storedToken()).toEqual({ token: 'fresh-from-other-tab', userId: 'u1' });
  });
});
