import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupBrowserEnv, installBrowserEnv, type BrowserEnv } from '../test/browser-env';
import { saveToken } from './session';

const TOKEN_KEY = 'tarlink.admin.token';
const SESSION_KEY = 'tarlink.admin.session';
const REFRESH_SUFFIX = '/v1/auth/refresh';
const LOGOUT_SUFFIX = '/v1/auth/logout';

let env: BrowserEnv;

beforeEach(() => {
  env = installBrowserEnv();
});

afterEach(() => {
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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * `api.ts` keeps module state (`refreshInFlight`, `refreshGeneration`), so the
 * module is re-imported per test. `errors` is imported in the same tick to get
 * the *same* `ApiError` class instance `api.ts` uses (module identity matters
 * for `toBeInstanceOf`).
 */
async function loadModules() {
  vi.resetModules();
  const [api, errors] = await Promise.all([import('./api'), import('./errors')]);
  return { api, ApiError: errors.ApiError };
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

function logoutCalls(fetchMock: ReturnType<typeof installFetch>) {
  return fetchMock.mock.calls.filter(([input]) => String(input).endsWith(LOGOUT_SUFFIX));
}

/** Lets queued microtasks run (needed only if the lock falls back to leases). */
async function flushMicrotasks(turns = 10): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    await Promise.resolve();
  }
}

async function captureError(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
    return null;
  } catch (error) {
    return error;
  }
}

/* -------------------------------------------------------------------------- */
/* Refresh                                                                     */
/* -------------------------------------------------------------------------- */

describe('refreshAccessToken', () => {
  it('single-flight: dua pemanggil bersamaan hanya memicu satu fetch refresh', async () => {
    const { api } = await loadModules();
    const fetchMock = installFetch((url) => {
      if (url.endsWith(REFRESH_SUFFIX)) {
        return Promise.resolve(jsonResponse(refreshPayload('new-token', 'u1')));
      }
      throw new Error(`fetch tak terduga: ${url}`);
    });

    const [first, second] = await Promise.all([
      api.refreshAccessToken(null),
      api.refreshAccessToken(null)
    ]);

    expect(first).toBe('new-token');
    expect(second).toBe('new-token');
    expect(refreshCalls(fetchMock)).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Single-flight: the refresh request must carry the HttpOnly cookie.
    const [refreshCall] = refreshCalls(fetchMock);
    expect(refreshCall?.[1]?.credentials).toBe('include');
    expect(refreshCall?.[1]?.body).toBe('{}');
    expect(JSON.parse(env.localStorage.getItem(TOKEN_KEY) ?? 'null')).toEqual({
      token: 'new-token',
      userId: 'u1'
    });
  });

  it('memakai token tab lain tanpa fetch (cookie rotasi tidak boleh dipakai dua kali)', async () => {
    saveToken('fresh', 'u1');
    const { api } = await loadModules();
    const fetchMock = installFetch(() => {
      throw new Error('fetch tidak boleh dipanggil');
    });

    await expect(api.refreshAccessToken('stale')).resolves.toBe('fresh');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logout membatalkan refresh yang sedang berjalan: hasil telat tidak menulis token', async () => {
    const { api } = await loadModules();
    const pendingRefresh = deferred<Response>();
    const fetchMock = installFetch((url) => {
      if (url.endsWith(REFRESH_SUFFIX)) return pendingRefresh.promise;
      if (url.endsWith(LOGOUT_SUFFIX)) return Promise.resolve(jsonResponse({ data: {} }));
      throw new Error(`fetch tak terduga: ${url}`);
    });

    const refreshPromise = api.refreshAccessToken('stale');
    // Pastikan refresh benar-benar sudah berjalan (generation tercatat) sebelum
    // logout; dengan `navigator.locks` fetch dipanggil sinkron.
    await flushMicrotasks();
    expect(refreshCalls(fetchMock)).toHaveLength(1);

    // Tidak di-await: `logoutSession` harus membatalkan generation secara sinkron.
    const logoutPromise = api.logoutSession();

    pendingRefresh.resolve(jsonResponse(refreshPayload('resurrected', 'u1')));

    const [refreshed] = await Promise.all([refreshPromise, logoutPromise]);

    expect(refreshed).toBeNull();
    expect(env.localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(logoutCalls(fetchMock)).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* apiFetch                                                                    */
/* -------------------------------------------------------------------------- */

describe('apiFetch', () => {
  it('mengulang tepat sekali setelah 401 memakai token hasil refresh', async () => {
    saveToken('old', 'u1');
    const { api } = await loadModules();
    const responses: Response[] = [
      jsonResponse({ error: { code: 'token_expired', message: 'Token kedaluwarsa.' } }, 401),
      jsonResponse(refreshPayload('new', 'u1')),
      jsonResponse({ data: { ok: true } })
    ];
    const fetchMock = installFetch(() => {
      const next = responses.shift();
      if (!next) throw new Error('fetch tak terduga: antrean respons habis');
      return Promise.resolve(next);
    });

    await expect(api.apiFetch<{ data: { ok: boolean } }>('/v1/admin/dashboard')).resolves.toEqual({
      data: { ok: true }
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [, firstInit] = fetchMock.mock.calls[0] ?? [];
    expect(new Headers(firstInit?.headers).get('Authorization')).toBe('Bearer old');
    const [, retryInit] = fetchMock.mock.calls[2] ?? [];
    expect(new Headers(retryInit?.headers).get('Authorization')).toBe('Bearer new');
    expect(JSON.parse(env.localStorage.getItem(TOKEN_KEY) ?? 'null')).toEqual({
      token: 'new',
      userId: 'u1'
    });
  });

  it('tidak me-refresh endpoint auth: 401 login langsung menjadi ApiError', async () => {
    const { api, ApiError } = await loadModules();
    const fetchMock = installFetch(() =>
      Promise.resolve(
        jsonResponse(
          { error: { code: 'invalid_credentials', message: 'Email atau kata sandi salah.' } },
          401
        )
      )
    );

    const caught = await captureError(() =>
      api.apiFetch('/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'ops@tarlink.id', password: 'salah' })
      })
    );

    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).toMatchObject({ name: 'ApiError', status: 401 });
    expect((caught as Error).message).toBe('Email atau kata sandi salah.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refreshCalls(fetchMock)).toHaveLength(0);
  });

  it('401 tanpa token tersimpan mengakhiri sesi dan membersihkan storage', async () => {
    const { api, ApiError } = await loadModules();
    // Sisa format lama: `readToken()` menganggapnya tidak ada.
    env.localStorage.setItem(TOKEN_KEY, 'legacy-raw-token');
    env.sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        operator_name: 'Sari',
        role: 'admin_finance',
        logged_in_at: '2026-01-01T00:00:00.000Z',
        user_id: 'u1'
      })
    );

    const events: string[] = [];
    const listener = () => events.push('session-ended');
    window.addEventListener('tarlink:session-ended', listener);

    const fetchMock = installFetch(() =>
      Promise.resolve(
        jsonResponse({ error: { code: 'unauthenticated', message: 'Sesi berakhir.' } }, 401)
      )
    );

    await expect(api.apiFetch('/v1/admin/dashboard')).rejects.toBeInstanceOf(ApiError);

    window.removeEventListener('tarlink:session-ended', listener);
    expect(events).toEqual(['session-ended']);
    expect(env.localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(env.sessionStorage.getItem(SESSION_KEY)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
