import { ApiError } from './errors';
import { clearSession, readSession, readToken, saveToken } from './session';
import {
  mockApproveMedia,
  mockGetAuditLog,
  mockGetBooking,
  mockGetBookings,
  mockGetDashboard,
  mockGetDisputes,
  mockGetLedger,
  mockGetMediaQueue,
  mockGetOperators,
  mockGetPayments,
  mockGetReleaseQueue,
  mockGetSettings,
  mockGetVendor,
  mockGetVendors,
  mockPreviewRelease,
  mockRejectMedia,
  mockSaveSettings,
  mockSubmitRelease,
  mockSuspendVendor,
  mockUnsuspendVendor
} from './mock';
import type {
  AdminMediaItem,
  AdminMediaQueue,
  AdminMediaStatus,
  AdminRegion,
  AuditLog,
  BookingFilters,
  BookingDetail,
  DashboardSummary,
  DisputeOverview,
  LedgerData,
  Operator,
  Paginated,
  Booking,
  PackageRow,
  PaymentsOverview,
  PlatformSettings,
  ReleaseInput,
  ReleasePreview,
  ReleaseQueue,
  ReleaseResult,
  ResolveDisputeInput,
  ResolveDisputeResult,
  SettleBookingInput,
  SettleBookingResult,
  SuspendVendorInput,
  SuspendVendorResult,
  Vendor,
  VendorCalendarBulkInput,
  VendorCalendarBulkResult,
  VendorCalendarResponse,
  VendorCreateInput,
  VendorCreateResult,
  VendorDetail,
  VendorFilters,
  VendorPackageInput,
  VendorPackagePatchInput,
  VendorPatchInput,
  VendorVerifyInput,
  VendorVerifyResult,
  CreatePayoutInput,
  EligiblePayout,
  PayoutBankAccount,
  PayoutDetail,
  PayoutPage
} from './types';

const BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001').replace(
  /\/$/,
  ''
);

const MOCK_LATENCY_MS = 240;

export function isMockMode(): boolean {
  return process.env.NEXT_PUBLIC_USE_MOCK === 'true';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const data: unknown = await response.json();
    if (isRecord(data)) {
      if (typeof data.message === 'string') {
        return data.message;
      }
      // API v1 membungkus pesan sebagai { error: { code, message } }.
      if (isRecord(data.error) && typeof data.error.message === 'string') {
        return data.error.message;
      }
    }
  } catch {
    // Non-JSON error body: fall through to the generic message.
  }
  return `Permintaan gagal (${response.status}). Coba lagi.`;
}

function apiUrl(path: string): string {
  return `${BASE_URL}${path}`;
}

/** Endpoint auth tidak boleh memicu refresh: 401 di sini berarti kredensial salah. */
const AUTH_PATH_PREFIXES = ['/v1/auth/login', '/v1/auth/google', '/v1/auth/refresh'];

function isAuthPath(pathname: string): boolean {
  if (AUTH_PATH_PREFIXES.includes(pathname)) return true;
  return /^\/v1\/auth\/(?:2fa|otp)\//.test(pathname);
}

/**
 * Satu-satunya jalur fetch ke API. `credentials: 'include'` wajib: refresh token
 * hidup di cookie HttpOnly ber-Path `/v1/auth`, bukan di storage browser.
 */
function sendRequest(
  path: string,
  init: RequestInit | undefined,
  token: string | null
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');
  if (init?.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(apiUrl(path), { ...init, headers, credentials: 'include' });
}

let refreshInFlight: Promise<string | null> | null = null;

/**
 * Nomor generasi refresh. Naik saat sesi lokal diakhiri, sehingga hasil refresh
 * yang masih berjalan tidak boleh menulis token baru setelah operator menekan
 * "Keluar" (sesi hidup kembali tanpa sepengetahuan operator).
 */
let refreshGeneration = 0;

function invalidateRefresh(): void {
  refreshGeneration += 1;
  refreshInFlight = null;
}

/** Nama lock browser: satu refresh cookie untuk seluruh tab. */
const REFRESH_LOCK_NAME = 'tarlink.admin.refresh';

/** Batas waktu satu request refresh; tab beku tidak boleh menahan tab lain. */
const REFRESH_TIMEOUT_MS = 10_000;

/** Batas menunggu lock antar-tab sebelum dianggap gagal (bukan deadlock). */
const LOCK_WAIT_MS = 15_000;

/* Fallback lock untuk origin tanpa `navigator.locks` (lihat acquireLease). */
const LEASE_KEY = 'tarlink.admin.refresh.lock';
const LEASE_TTL_MS = 15_000;
const LEASE_RETRY_MS = 75;
const LEASE_WAIT_MS = 10_000;

interface LeaseRecord {
  owner: string;
  expiresAt: number;
}

/**
 * `navigator.locks` menyerialisasi refresh antar-tab. Dibiarkan opsional supaya
 * browser lama / origin tidak aman tetap memakai lease localStorage.
 */
function refreshLockManager(): LockManager | null {
  if (typeof navigator === 'undefined') return null;
  if (!('locks' in navigator)) return null;
  const { locks } = navigator;
  if (typeof locks?.request !== 'function') return null;
  return locks;
}

/** Identifier pemilik lease. `crypto.randomUUID` juga butuh secure context. */
function leaseOwnerId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Lanjut ke fallback: origin tanpa secure context tetap butuh pemilik unik.
  }
  return `lease-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Baca lease dari localStorage. Nilai yang rusak/tidak bisa di-parse dianggap
 * kedaluwarsa supaya tab tidak terkunci selamanya karena sisa data lama.
 */
function readLease(): LeaseRecord | null {
  try {
    const raw = window.localStorage.getItem(LEASE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.owner !== 'string' || record.owner.length === 0) return null;
    if (typeof record.expiresAt !== 'number' || !Number.isFinite(record.expiresAt)) return null;
    return { owner: record.owner, expiresAt: record.expiresAt };
  } catch {
    return null;
  }
}

/** Tulis lease lalu baca ulang: hanya penulis terakhir yang boleh menganggap dirinya pemilik. */
function tryTakeLease(owner: string): boolean {
  const now = Date.now();
  const existing = readLease();
  if (existing && existing.owner !== owner && existing.expiresAt > now) return false;
  try {
    const lease: LeaseRecord = { owner, expiresAt: now + LEASE_TTL_MS };
    window.localStorage.setItem(LEASE_KEY, JSON.stringify(lease));
  } catch {
    // Penyimpanan diblokir: tab lain di browser yang sama juga tidak bisa
    // memegang lease, jadi lanjut tanpa lock lebih baik daripada menunggu.
    return true;
  }
  const confirmed = readLease();
  return confirmed !== null && confirmed.owner === owner;
}

async function acquireLease(owner: string): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const deadline = Date.now() + LEASE_WAIT_MS;
  for (;;) {
    if (tryTakeLease(owner)) return true;
    if (Date.now() >= deadline) return false;
    await sleep(LEASE_RETRY_MS);
  }
}

function releaseLease(owner: string): void {
  const current = readLease();
  if (!current || current.owner !== owner) return;
  try {
    window.localStorage.removeItem(LEASE_KEY);
  } catch {
    // Tidak ada yang bisa dibersihkan; lease akan kedaluwarsa sendiri.
  }
}

/** Batasi penantian lock: `null` berarti lock tidak didapat, bukan error. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([work, deadline])
    .catch(() => null)
    .finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    });
}

/**
 * Jalankan pekerjaan di bawah lock antar-tab yang sama dengan refresh. `null`
 * berarti lock tidak didapat sampai batas waktu: pemanggil memutuskan apakah
 * pekerjaan tetap jalan tanpa lock (best effort).
 */
async function runUnderRefreshLock<T>(work: () => Promise<T>): Promise<T | null> {
  const locks = refreshLockManager();
  if (locks) {
    return withTimeout(locks.request(REFRESH_LOCK_NAME, work) as Promise<T>, LOCK_WAIT_MS);
  }
  const owner = leaseOwnerId();
  const held = await acquireLease(owner);
  try {
    return await work();
  } finally {
    if (held) releaseLease(owner);
  }
}

/** Berakhirnya sesi harus terlihat oleh semua tab, bukan hanya tab ini. */
function endSession(): void {
  clearSession();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('tarlink:session-ended'));
  }
}

/** Batas waktu fetch refresh; browser lama tanpa `AbortSignal.timeout` tetap jalan. */
function refreshSignal(): AbortSignal | undefined {
  if (typeof AbortSignal === 'undefined') return undefined;
  if (typeof AbortSignal.timeout !== 'function') return undefined;
  return AbortSignal.timeout(REFRESH_TIMEOUT_MS);
}

/** `data.user.id` dari respons refresh; null bila bentuknya tidak dikenal. */
function readPayloadUserId(data: Record<string, unknown> | null): string | null {
  if (!data) return null;
  const user = data.user;
  if (typeof user !== 'object' || user === null || Array.isArray(user)) return null;
  const id = (user as Record<string, unknown>).id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * Tukar cookie refresh jadi access token. Dipanggil hanya di dalam lock.
 *
 * Cookie refresh berotasi setiap dipakai: memakai cookie yang sudah dipakai tab
 * lain dianggap reuse dan mencabut seluruh keluarga sesi. Karena itu token
 * dibaca ulang dulu — kalau tab lain sudah memperbarui, tidak ada jaringan.
 *
 * Generasi refresh dicek setelah fetch: hasil yang datang terlambat tidak boleh
 * menulis token untuk sesi yang sudah ditutup operator.
 */
async function exchangeRefreshCookie(staleToken: string | null): Promise<string | null> {
  const current = readToken();
  if (current && current !== staleToken) {
    return current;
  }

  const generation = refreshGeneration;
  try {
    const response = await fetch(apiUrl('/v1/auth/refresh'), {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: '{}',
      signal: refreshSignal()
    });
    if (generation !== refreshGeneration) return null;
    if (!response.ok) {
      endSession();
      return null;
    }
    const payload: unknown = await response.json();
    if (generation !== refreshGeneration) return null;
    const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
    const token = data && typeof data.access_token === 'string' ? data.access_token : null;
    if (!token) {
      endSession();
      return null;
    }
    // Token tanpa pemilik tidak boleh disimpan: di workstation bersama itu
    // berarti tab lain bisa memakainya dengan profil operator yang berbeda.
    const userId = readPayloadUserId(data) ?? readSession()?.user_id ?? null;
    if (!userId) {
      endSession();
      return null;
    }
    saveToken(token, userId);
    return token;
  } catch {
    if (generation !== refreshGeneration) return null;
    endSession();
    return null;
  }
}

/**
 * Single-flight refresh. `staleToken` adalah token yang baru saja ditolak 401
 * (wajib: tanpa token lama tidak ada yang bisa dibandingkan, jadi pemanggil
 * harus mengirim null secara eksplisit). Dua pemanggil di tab yang sama berbagi
 * satu promise; antar-tab diserialisasi lewat `navigator.locks` atau lease
 * localStorage, dan tab yang kalah cepat cukup memakai token baru.
 */
export async function refreshAccessToken(staleToken: string | null): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  // Lock bisa diberikan setelah batas waktu: refresh kedua di tab ini akan
  // memakai cookie yang sudah dirotasi dan memicu deteksi reuse.
  let abandoned = false;

  const pending = (async (): Promise<string | null> => {
    try {
      return await runUnderRefreshLock(() => {
        if (abandoned) return Promise.resolve(null);
        return exchangeRefreshCookie(staleToken);
      });
    } finally {
      abandoned = true;
      refreshInFlight = null;
    }
  })();

  refreshInFlight = pending;
  return pending;
}

/**
 * Single entry point for both data paths. Signatures never change when the
 * mock flag flips: only the transport does.
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (!isMockMode()) {
    // API memakai prefix global `/v1`; panel historically memanggil `/api/v1`.
    // Dinormalisasi di satu tempat supaya semua pemanggil konsisten.
    const normalised = path.replace(/^\/api\/v1/, '/v1');
    const pathname = normalised.split('?')[0] ?? normalised;
    const previousToken = readToken();
    let response = await sendRequest(normalised, init, previousToken);

    // Access token hanya 15 menit. Pada 401 pertama untuk request biasa, tukar
    // cookie refresh jadi token baru lalu ulangi tepat satu kali. Tanpa token
    // sebelumnya artinya tab ini basi (logout/token dicabut tab lain): akhiri
    // sesi supaya dialihkan ke /login, bukan berputar di state error.
    if (response.status === 401 && !isAuthPath(pathname)) {
      if (previousToken) {
        const refreshed = await refreshAccessToken(previousToken);
        if (refreshed) {
          response = await sendRequest(normalised, init, refreshed);
        }
      } else {
        endSession();
      }
    }

    if (!response.ok) {
      throw new ApiError(await readErrorMessage(response), response.status);
    }
    // DELETE paket menjawab 204 tanpa body; jangan panggil response.json().
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  await sleep(MOCK_LATENCY_MS);
  // Boundary cast: the mock router produces the same shapes as the API.
  return mockRoute(path, init) as T;
}

function idempotencyHeaders(): Record<string, string> {
  return { 'Idempotency-Key': crypto.randomUUID() };
}

/* -------------------------------------------------------------------------- */
/* Auth                                                                        */
/* -------------------------------------------------------------------------- */

export interface AuthUser {
  id: string;
  phone: string | null;
  email?: string;
  roles: string[];
}

/** Full session: satu-satunya bentuk yang boleh disimpan sebagai sesi operator. */
export interface SessionResult {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: AuthUser;
}

/** FR-128: kata sandi benar, kode TOTP masih diminta. Belum ada sesi. */
export interface MfaRequiredResult {
  mfa_required: true;
  challenge_token: string;
  expires_in: number;
}

/** FR-128: akun admin ini belum punya TOTP; enrollment harus selesai dulu. */
export interface MfaSetupRequiredResult {
  mfa_setup_required: true;
  enroll_token: string;
  expires_in: number;
}

/** Semua jawaban `POST /auth/login` dan `POST /auth/google`. */
export type LoginResult = SessionResult | MfaRequiredResult | MfaSetupRequiredResult;

/** @deprecated Alias lama; login sekarang menjawab `LoginResult`. */
export type AuthResult = SessionResult;

/** `POST /auth/2fa/enroll`: rahasia hanya ditampilkan sekali. */
export interface TwoFactorEnrollment {
  secret: string;
  otpauth_uri: string;
  expires_in: number;
}

/** `POST /auth/2fa/enroll/verify`: sesi penuh plus salinan kode cadangan. */
export interface TwoFactorEnrolledSession extends SessionResult {
  backup_codes: string[];
}

function invalidAuthPayload(): ApiError {
  return new ApiError('Respons autentikasi tidak dikenali.', 502);
}

function readAuthUser(value: unknown): AuthUser | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || !Array.isArray(value.roles)) return null;
  const roles = value.roles.filter((role): role is string => typeof role === 'string');
  if (roles.length !== value.roles.length) return null;
  if (value.phone !== null && typeof value.phone !== 'string') return null;
  if (value.email !== undefined && typeof value.email !== 'string') return null;
  return {
    id: value.id,
    phone: value.phone,
    roles,
    ...(value.email !== undefined ? { email: value.email } : {})
  };
}

function readSessionResult(value: unknown): SessionResult | null {
  if (!isRecord(value)) return null;
  if (typeof value.access_token !== 'string' || typeof value.token_type !== 'string') return null;
  if (typeof value.expires_in !== 'number') return null;
  const user = readAuthUser(value.user);
  if (!user) return null;
  return {
    access_token: value.access_token,
    token_type: value.token_type,
    expires_in: value.expires_in,
    user
  };
}

function requireSessionResult(value: unknown): SessionResult {
  const session = readSessionResult(value);
  if (!session) throw invalidAuthPayload();
  return session;
}

/** Boundary validation: a 200 with an unknown shape must not become a session. */
function readLoginResult(value: unknown): LoginResult {
  if (isRecord(value)) {
    if (value.mfa_required === true) {
      if (typeof value.challenge_token !== 'string' || typeof value.expires_in !== 'number') {
        throw invalidAuthPayload();
      }
      return {
        mfa_required: true,
        challenge_token: value.challenge_token,
        expires_in: value.expires_in
      };
    }
    if (value.mfa_setup_required === true) {
      if (typeof value.enroll_token !== 'string' || typeof value.expires_in !== 'number') {
        throw invalidAuthPayload();
      }
      return {
        mfa_setup_required: true,
        enroll_token: value.enroll_token,
        expires_in: value.expires_in
      };
    }
  }
  return requireSessionResult(value);
}

function readEnrollmentResult(value: unknown): TwoFactorEnrollment {
  if (
    !isRecord(value) ||
    typeof value.secret !== 'string' ||
    typeof value.otpauth_uri !== 'string' ||
    typeof value.expires_in !== 'number'
  ) {
    throw new ApiError('Respons pendaftaran 2FA tidak dikenali.', 502);
  }
  return {
    secret: value.secret,
    otpauth_uri: value.otpauth_uri,
    expires_in: value.expires_in
  };
}

/** True when a Google OAuth client id is configured for the browser. */
export function googleLoginEnabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID);
}

export function googleClientId(): string {
  return process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '';
}

/** Email + password. Dipakai panel admin; API memakai prefix `/v1`. */
export async function loginWithPassword(email: string, password: string): Promise<LoginResult> {
  const response = await apiFetch<{ data: unknown }>('/v1/auth/login', {
    method: 'POST',
    // `cookie: true`: refresh token dikirim API lewat cookie HttpOnly, bukan body.
    body: JSON.stringify({ email, password, cookie: true })
  });
  return readLoginResult(response.data);
}

/** Google Sign-In: kirim ID token dari Google Identity Services. */
export async function loginWithGoogle(idToken: string): Promise<LoginResult> {
  const response = await apiFetch<{ data: unknown }>('/v1/auth/google', {
    method: 'POST',
    body: JSON.stringify({ id_token: idToken, cookie: true })
  });
  return readLoginResult(response.data);
}

/** FR-128 langkah 2: tukar challenge + kode TOTP menjadi sesi penuh. */
export async function verifyTwoFactor(
  challengeToken: string,
  code: string
): Promise<SessionResult> {
  const response = await apiFetch<{ data: unknown }>('/v1/auth/2fa/verify', {
    method: 'POST',
    body: JSON.stringify({ challenge_token: challengeToken, code, cookie: true })
  });
  return requireSessionResult(response.data);
}

/** Jalur cadangan saat aplikasi autentikator tidak bisa diakses. */
export async function verifyBackupCode(
  challengeToken: string,
  code: string
): Promise<SessionResult> {
  const response = await apiFetch<{ data: unknown }>('/v1/auth/2fa/backup-code', {
    method: 'POST',
    body: JSON.stringify({ challenge_token: challengeToken, code, cookie: true })
  });
  return requireSessionResult(response.data);
}

/** FR-128 langkah 1 enrollment: rahasia base32 + URI `otpauth://`. */
export async function startTwoFactorEnrollment(
  enrollToken: string
): Promise<TwoFactorEnrollment> {
  const response = await apiFetch<{ data: unknown }>('/v1/auth/2fa/enroll', {
    method: 'POST',
    body: JSON.stringify({ enroll_token: enrollToken })
  });
  return readEnrollmentResult(response.data);
}

/** Langkah 2: aktifkan TOTP, terbitkan sesi, dan tampilkan kode cadangan sekali. */
export async function completeTwoFactorEnrollment(
  enrollToken: string,
  code: string
): Promise<TwoFactorEnrolledSession> {
  const response = await apiFetch<{ data: unknown }>('/v1/auth/2fa/enroll/verify', {
    method: 'POST',
    body: JSON.stringify({ enroll_token: enrollToken, code, cookie: true })
  });
  const session = requireSessionResult(response.data);
  if (!isRecord(response.data)) throw invalidAuthPayload();
  const rawCodes = response.data.backup_codes;
  if (!Array.isArray(rawCodes)) throw invalidAuthPayload();
  const backupCodes = rawCodes.filter((item): item is string => typeof item === 'string');
  if (backupCodes.length !== rawCodes.length) throw invalidAuthPayload();
  return { ...session, backup_codes: backupCodes };
}

/**
 * Cabut sesi di server: Bearer access token di header, cookie refresh dibersihkan
 * API lewat respons. Sengaja tidak lewat `apiFetch` supaya logout tidak pernah
 * memicu refresh; pemanggil menutup sesi lokal apa pun hasilnya.
 *
 * Dijalankan di lock yang sama dengan refresh: logout tidak boleh berselang
 * dengan rotasi cookie, dan refresh yang sudah berjalan tidak boleh menulis
 * token baru sesudah ini (`invalidateRefresh`).
 */
export async function logoutSession(): Promise<void> {
  // Wajib sebelum await pertama: refresh yang masih di jalan harus dibatalkan.
  invalidateRefresh();

  const sendLogout = (): Promise<Response> => {
    const token = readToken();
    const headers = new Headers({ Accept: 'application/json' });
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(apiUrl('/v1/auth/logout'), {
      method: 'POST',
      headers,
      credentials: 'include'
    });
  };

  // Satu request saja: callback lock bisa menyusul setelah batas waktu.
  let request: Promise<Response> | null = null;
  const sendOnce = (): Promise<Response> => {
    request ??= sendLogout();
    return request;
  };

  const locked = await runUnderRefreshLock(sendOnce);
  const response = locked ?? (await sendOnce());
  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }
}

/** Peran yang boleh membuka panel operasi. */
export function isPanelRole(roles: string[]): boolean {
  return roles.some((role) => role.startsWith('admin_'));
}

function readBody(init?: RequestInit): Record<string, unknown> {
  if (typeof init?.body !== 'string' || init.body.length === 0) {
    return {};
  }
  const parsed: unknown = JSON.parse(init.body);
  return isRecord(parsed) ? parsed : {};
}

function readString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === 'string' ? value : '';
}

function readStringArray(body: Record<string, unknown>, key: string): string[] {
  const value = body[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function readNumber(body: Record<string, unknown>, key: string): number {
  const value = body[key];
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;
}

/** Mock wilayah untuk `NEXT_PUBLIC_USE_MOCK=true` (FR-125). */
let mockRegionState: AdminRegion[] = [
  { code: '3212', name: 'Indramayu', level: 'regency', parent_code: '32', is_active: true, vendor_count: 2 },
  { code: '3213', name: 'Cirebon', level: 'regency', parent_code: '32', is_active: true, vendor_count: 1 },
  { code: '3274', name: 'Kota Cirebon', level: 'city', parent_code: '32', is_active: true, vendor_count: 0 }
];

function mockRoute(path: string, init?: RequestInit): unknown {
  const url = new URL(path, 'https://mock.tarlink.local');
  const method = (init?.method ?? 'GET').toUpperCase();
  const pathname = url.pathname.replace(/^\/api\/v1/, '');
  const body = readBody(init);

  if (method === 'GET' && pathname === '/admin/dashboard') {
    return mockGetDashboard();
  }
  if (method === 'GET' && pathname === '/admin/bookings') {
    return mockGetBookings({
      status: url.searchParams.get('status') ?? '',
      range: (url.searchParams.get('range') ?? 'all') as BookingFilters['range'],
      city: url.searchParams.get('city') ?? '',
      q: url.searchParams.get('q') ?? '',
      sort: (url.searchParams.get('sort') ?? 'created_desc') as BookingFilters['sort'],
      page: Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1,
      page_size: Number.parseInt(url.searchParams.get('page_size') ?? '8', 10) || 8
    });
  }
  const bookingMatch = pathname.match(/^\/admin\/bookings\/([^/]+)$/);
  if (method === 'GET' && bookingMatch) {
    return mockGetBooking(decodeURIComponent(bookingMatch[1]));
  }
  if (method === 'GET' && pathname === '/admin/vendors') {
    return mockGetVendors({
      q: url.searchParams.get('q') ?? '',
      city: url.searchParams.get('city') ?? '',
      verification: url.searchParams.get('verification') ?? ''
    });
  }
  const vendorMatch = pathname.match(/^\/admin\/vendors\/([^/]+)$/);
  if (method === 'GET' && vendorMatch) {
    return mockGetVendor(decodeURIComponent(vendorMatch[1]));
  }
  const suspendVendorMatch = pathname.match(/^\/admin\/vendors\/([^/]+)\/suspend$/);
  if (method === 'POST' && suspendVendorMatch) {
    const id = decodeURIComponent(suspendVendorMatch[1]);
    const reason = readString(body, 'reason');
    const note = readString(body, 'note') || undefined;
    return mockSuspendVendor(id, { reason, note });
  }
  const unsuspendVendorMatch = pathname.match(/^\/admin\/vendors\/([^/]+)\/unsuspend$/);
  if (method === 'POST' && unsuspendVendorMatch) {
    const id = decodeURIComponent(unsuspendVendorMatch[1]);
    return mockUnsuspendVendor(id);
  }
  if (method === 'GET' && pathname === '/admin/release/queue') {
    return mockGetReleaseQueue();
  }
  if (method === 'POST' && pathname === '/admin/release/preview') {
    return mockPreviewRelease({
      booking_ids: readStringArray(body, 'booking_ids'),
      reason: readString(body, 'reason'),
      maker: readString(body, 'maker'),
      checker: readString(body, 'checker')
    });
  }
  if (method === 'POST' && pathname === '/admin/release') {
    return mockSubmitRelease({
      booking_ids: readStringArray(body, 'booking_ids'),
      reason: readString(body, 'reason'),
      maker: readString(body, 'maker'),
      checker: readString(body, 'checker')
    });
  }
  if (method === 'GET' && pathname === '/admin/ledger') {
    return mockGetLedger();
  }
  if (method === 'GET' && pathname === '/admin/payments') {
    return mockGetPayments();
  }
  if (method === 'GET' && pathname === '/admin/disputes') {
    return mockGetDisputes();
  }
  if (method === 'GET' && pathname === '/admin/audit') {
    return mockGetAuditLog();
  }
  if (method === 'GET' && pathname === '/admin/settings') {
    return mockGetSettings();
  }
  if (method === 'PUT' && pathname === '/admin/settings') {
    return mockSaveSettings({
      bp1: readNumber(body, 'bp1'),
      threshold_idr: readNumber(body, 'threshold_idr'),
      bp2: readNumber(body, 'bp2'),
      min_idr: readNumber(body, 'min_idr'),
      cap_idr: readNumber(body, 'cap_idr'),
      service_fee_bp: readNumber(body, 'service_fee_bp'),
      dp_min_bp: readNumber(body, 'dp_min_bp'),
      payment_deadline_hours: readNumber(body, 'payment_deadline_hours'),
      payment_deadline_hours_high_value: readNumber(body, 'payment_deadline_hours_high_value'),
      payment_high_value_threshold_idr: readNumber(body, 'payment_high_value_threshold_idr'),
      dispute_window_days: readNumber(body, 'dispute_window_days'),
      bank_cooling_hours: readNumber(body, 'bank_cooling_hours'),
      payout_min_idr: readNumber(body, 'payout_min_idr'),
      approval_threshold_idr: readNumber(body, 'approval_threshold_idr')
    });
  }
  if (method === 'GET' && pathname === '/admin/regions') {
    return mockRegionState;
  }
  const regionMatch = pathname.match(/^\/admin\/regions\/([^/]+)$/);
  if (method === 'PATCH' && regionMatch) {
    const code = decodeURIComponent(regionMatch[1]);
    const index = mockRegionState.findIndex((region) => region.code === code);
    if (index < 0) throw new ApiError('Wilayah tidak ditemukan', 404);
    const next = mockRegionState.map((region, position) =>
      position === index ? { ...region, is_active: body.is_active === true } : region
    );
    mockRegionState = next;
    return next[index];
  }
  if (method === 'GET' && pathname === '/admin/operators') {
    return mockGetOperators();
  }
  if (method === 'GET' && (pathname === '/admin/media' || pathname === '/v1/admin/media')) {
    const status = (url.searchParams.get('status') ?? undefined) as AdminMediaStatus | undefined;
    const page = Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1;
    const page_size = Number.parseInt(url.searchParams.get('page_size') ?? '20', 10) || 20;
    return { data: mockGetMediaQueue({ status, page, page_size }) };
  }
  const approveMediaMatch = pathname.match(/^\/(?:v1\/)?admin\/media\/([^/]+)\/approve$/);
  if (method === 'POST' && approveMediaMatch) {
    const id = decodeURIComponent(approveMediaMatch[1]);
    return { data: { media: mockApproveMedia(id) } };
  }
  const rejectMediaMatch = pathname.match(/^\/(?:v1\/)?admin\/media\/([^/]+)\/reject$/);
  if (method === 'POST' && rejectMediaMatch) {
    const id = decodeURIComponent(rejectMediaMatch[1]);
    const note = readString(body, 'note');
    return { data: { media: mockRejectMedia(id, note) } };
  }

  if (method === 'GET' && pathname === '/admin/vendor-applications') {
    return { items: [], total: 0, page: 1, page_size: 20 };
  }
  if (
    method === 'POST' &&
    /^\/admin\/vendor-applications\/[^/]+\/(approve|reject)$/.test(pathname)
  ) {
    return {
      data: {
        id: 'mock-application',
        status: pathname.endsWith('/approve') ? 'approved' : 'rejected',
        display_name: 'Vendor Mock',
        legal_name: 'Vendor Mock',
        nik: '0000000000000000',
        region_code: 'ID-JB',
        base_address: '-',
        review_note: null,
        vendor_id: null,
        created_at: new Date().toISOString(),
        reviewed_at: new Date().toISOString()
      }
    };
  }
  if (method === 'GET' && pathname === '/payments/refunds') {
    return { data: { items: [] } };
  }
  if (method === 'POST' && /^\/payments\/refunds\/[^/]+\/(approve|reject)$/.test(pathname)) {
    return { data: {} };
  }

  throw new ApiError(`Endpoint mock tidak dikenal: ${method} ${pathname}`, 404);
}

export function getDashboard(): Promise<DashboardSummary> {
  return apiFetch<DashboardSummary>('/api/v1/admin/dashboard');
}

export function getBookings(filters: BookingFilters): Promise<Paginated<Booking>> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  params.set('range', filters.range);
  if (filters.city) params.set('city', filters.city);
  if (filters.q) params.set('q', filters.q);
  params.set('sort', filters.sort);
  params.set('page', String(filters.page));
  params.set('page_size', String(filters.page_size));
  return apiFetch<Paginated<Booking>>(`/api/v1/admin/bookings?${params.toString()}`);
}

export function getBooking(id: string): Promise<BookingDetail> {
  return apiFetch<BookingDetail>(`/api/v1/admin/bookings/${encodeURIComponent(id)}`);
}

/** Catat pelunasan manual. Nominal harus persis sisa tagihan versi server. */
export function settleBooking(
  id: string,
  input: SettleBookingInput
): Promise<SettleBookingResult> {
  return apiFetch<SettleBookingResult>(
    `/api/v1/admin/bookings/${encodeURIComponent(id)}/settle`,
    {
      method: 'POST',
      headers: idempotencyHeaders(), // Idempotency-Key
      body: JSON.stringify(input)
    }
  );
}

export function getVendors(filters: VendorFilters): Promise<Paginated<Vendor>> {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.city) params.set('city', filters.city);
  if (filters.verification) params.set('verification', filters.verification);
  return apiFetch<Paginated<Vendor>>(`/api/v1/admin/vendors?${params.toString()}`);
}

export function getVendor(id: string): Promise<VendorDetail> {
  return apiFetch<VendorDetail>(`/api/v1/admin/vendors/${encodeURIComponent(id)}`);
}

/** Buat vendor baru. Pemilik dipilih lewat email ATAU nomor HP yang sudah terdaftar. */
export function createVendor(input: VendorCreateInput): Promise<VendorCreateResult> {
  return apiFetch<VendorCreateResult>('/api/v1/admin/vendors', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function updateVendor(id: string, patch: VendorPatchInput): Promise<Vendor> {
  return apiFetch<Vendor>(`/api/v1/admin/vendors/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch)
  });
}

export function verifyVendor(
  id: string,
  input: VendorVerifyInput
): Promise<VendorVerifyResult> {
  return apiFetch<VendorVerifyResult>(
    `/api/v1/admin/vendors/${encodeURIComponent(id)}/verify`,
    {
      method: 'POST',
      body: JSON.stringify(input)
    }
  );
}

export function suspendVendor(
  id: string,
  input: SuspendVendorInput
): Promise<SuspendVendorResult> {
  return apiFetch<SuspendVendorResult>(
    `/api/v1/admin/vendors/${encodeURIComponent(id)}/suspend`,
    {
      method: 'POST',
      body: JSON.stringify(input)
    }
  );
}

export function unsuspendVendor(
  id: string
): Promise<SuspendVendorResult> {
  return apiFetch<SuspendVendorResult>(
    `/api/v1/admin/vendors/${encodeURIComponent(id)}/unsuspend`,
    {
      method: 'POST'
    }
  );
}

export function getVendorPackages(id: string): Promise<{ items: PackageRow[] }> {
  return apiFetch<{ items: PackageRow[] }>(
    `/api/v1/admin/vendors/${encodeURIComponent(id)}/packages`
  );
}

export function createVendorPackage(
  id: string,
  input: VendorPackageInput
): Promise<PackageRow> {
  return apiFetch<PackageRow>(`/api/v1/admin/vendors/${encodeURIComponent(id)}/packages`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function updateVendorPackage(
  id: string,
  packageId: string,
  patch: VendorPackagePatchInput
): Promise<PackageRow> {
  return apiFetch<PackageRow>(
    `/api/v1/admin/vendors/${encodeURIComponent(id)}/packages/${encodeURIComponent(packageId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(patch)
    }
  );
}

/** Soft delete: paket tidak lagi ditawarkan, booking lama tetap merujuk ke baris ini. */
export function deleteVendorPackage(id: string, packageId: string): Promise<void> {
  return apiFetch<void>(
    `/api/v1/admin/vendors/${encodeURIComponent(id)}/packages/${encodeURIComponent(packageId)}`,
    { method: 'DELETE' }
  );
}

export function getVendorCalendar(
  id: string,
  from: string,
  to: string
): Promise<VendorCalendarResponse> {
  const params = new URLSearchParams({ from, to });
  return apiFetch<VendorCalendarResponse>(
    `/api/v1/admin/vendors/${encodeURIComponent(id)}/calendar?${params.toString()}`
  );
}

export function bulkUpdateVendorCalendar(
  id: string,
  input: VendorCalendarBulkInput
): Promise<VendorCalendarBulkResult> {
  return apiFetch<VendorCalendarBulkResult>(
    `/api/v1/admin/vendors/${encodeURIComponent(id)}/calendar`,
    {
      method: 'PUT',
      body: JSON.stringify(input)
    }
  );
}

export function getReleaseQueue(): Promise<ReleaseQueue> {
  return apiFetch<ReleaseQueue>('/api/v1/admin/release/queue');
}

export function previewRelease(input: ReleaseInput): Promise<ReleasePreview> {
  return apiFetch<ReleasePreview>('/api/v1/admin/release/preview', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function submitRelease(input: ReleaseInput): Promise<ReleaseResult> {
  return apiFetch<ReleaseResult>('/api/v1/admin/release', {
    method: 'POST',
    headers: idempotencyHeaders(), // Idempotency-Key
    body: JSON.stringify(input)
  });
}

export function getLedger(): Promise<LedgerData> {
  return apiFetch<LedgerData>('/api/v1/admin/ledger');
}

export function getPayments(): Promise<PaymentsOverview> {
  return apiFetch<PaymentsOverview>('/api/v1/admin/payments');
}

export function getDisputes(): Promise<DisputeOverview> {
  return apiFetch<DisputeOverview>('/api/v1/admin/disputes');
}

export function resolveDispute(
  disputeId: string,
  input: ResolveDisputeInput
): Promise<ResolveDisputeResult> {
  return apiFetch<ResolveDisputeResult>(
    `/api/v1/admin/disputes/${encodeURIComponent(disputeId)}/resolve`,
    {
      method: 'POST',
      headers: idempotencyHeaders(), // Idempotency-Key
      body: JSON.stringify(input)
    }
  );
}

export function getAuditLog(): Promise<AuditLog> {
  return apiFetch<AuditLog>('/api/v1/admin/audit');
}

export function getSettings(): Promise<PlatformSettings> {
  return apiFetch<PlatformSettings>('/api/v1/admin/settings');
}

export function saveSettings(settings: PlatformSettings): Promise<PlatformSettings> {
  return apiFetch<PlatformSettings>('/api/v1/admin/settings', {
    method: 'PUT',
    body: JSON.stringify(settings)
  });
}

export function getOperators(): Promise<Operator[]> {
  return apiFetch<Operator[]>('/api/v1/admin/operators');
}

/** FR-125: daftar wilayah + jumlah vendor aktif. */
export function getRegions(): Promise<AdminRegion[]> {
  return apiFetch<AdminRegion[]>('/api/v1/admin/regions');
}

/** FR-125: aktif/nonaktif wilayah. Hanya `admin_super` yang diizinkan API. */
export function setRegionActive(code: string, isActive: boolean): Promise<AdminRegion> {
  return apiFetch<AdminRegion>(`/api/v1/admin/regions/${encodeURIComponent(code)}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_active: isActive })
  });
}

/* -------------------------------------------------------------------------- */
/* Payout vendor                                                              */
/* -------------------------------------------------------------------------- */

export function getPayouts(params: {
  status?: string;
  vendor_id?: string;
  page?: number;
  page_size?: number;
} = {}): Promise<PayoutPage> {
  const search = new URLSearchParams();
  if (params.status) search.set('status', params.status);
  if (params.vendor_id) search.set('vendor_id', params.vendor_id);
  if (params.page) search.set('page', String(params.page));
  if (params.page_size) search.set('page_size', String(params.page_size));
  const suffix = search.toString() ? `?${search.toString()}` : '';
  return apiFetch<PayoutPage>(`/api/v1/admin/payouts${suffix}`);
}

export function getPayout(id: string): Promise<PayoutDetail> {
  return apiFetch<PayoutDetail>(`/api/v1/admin/payouts/${encodeURIComponent(id)}`);
}

export function getPayoutEligible(vendorId: string): Promise<EligiblePayout> {
  return apiFetch<EligiblePayout>(
    `/api/v1/admin/payouts/eligible?vendor_id=${encodeURIComponent(vendorId)}`
  );
}

export function createPayout(input: CreatePayoutInput): Promise<PayoutDetail> {
  return apiFetch<PayoutDetail>('/api/v1/admin/payouts', {
    method: 'POST',
    headers: idempotencyHeaders(), // Idempotency-Key
    body: JSON.stringify(input)
  });
}

export function approvePayout(id: string, note?: string): Promise<PayoutDetail> {
  return apiFetch<PayoutDetail>(
    `/api/v1/admin/payouts/${encodeURIComponent(id)}/approve`,
    {
      method: 'POST',
      headers: idempotencyHeaders(), // Idempotency-Key
      body: JSON.stringify(note ? { note } : {})
    }
  );
}

export function rejectPayout(id: string, reason: string): Promise<PayoutDetail> {
  return apiFetch<PayoutDetail>(
    `/api/v1/admin/payouts/${encodeURIComponent(id)}/reject`,
    {
      method: 'POST',
      body: JSON.stringify({ reason })
    }
  );
}

export function cancelPayout(id: string): Promise<PayoutDetail> {
  return apiFetch<PayoutDetail>(
    `/api/v1/admin/payouts/${encodeURIComponent(id)}/cancel`,
    { method: 'POST' }
  );
}

export function getVendorPayoutBankAccounts(vendorId: string): Promise<PayoutBankAccount[]> {
  return apiFetch<PayoutBankAccount[]>(
    `/api/v1/admin/vendors/${encodeURIComponent(vendorId)}/bank-accounts`
  );
}

export function verifyVendorPayoutBankAccount(
  vendorId: string,
  accountId: string
): Promise<PayoutBankAccount> {
  return apiFetch<PayoutBankAccount>(
    `/api/v1/admin/vendors/${encodeURIComponent(vendorId)}/bank-accounts/${encodeURIComponent(accountId)}/verify`,
    { method: 'POST' }
  );
}

export function rejectVendorPayoutBankAccount(
  vendorId: string,
  accountId: string,
  reason: string
): Promise<PayoutBankAccount> {
  return apiFetch<PayoutBankAccount>(
    `/api/v1/admin/vendors/${encodeURIComponent(vendorId)}/bank-accounts/${encodeURIComponent(accountId)}/reject`,
    { method: 'POST', body: JSON.stringify({ reason }) }
  );
}

/* -------------------------------------------------------------------------- */
/* Moderasi media vendor                                                      */
/* -------------------------------------------------------------------------- */

export async function getMediaQueue(params: {
  status?: AdminMediaStatus;
  page?: number;
  page_size?: number;
} = {}): Promise<AdminMediaQueue> {
  const search = new URLSearchParams();
  if (params.status) search.set('status', params.status);
  if (params.page) search.set('page', String(params.page));
  if (params.page_size) search.set('page_size', String(params.page_size));
  const suffix = search.toString() ? `?${search.toString()}` : '';
  const response = await apiFetch<{ data: AdminMediaQueue }>(`/v1/admin/media${suffix}`);
  return response.data;
}

export async function approveMedia(id: string): Promise<AdminMediaItem> {
  const response = await apiFetch<{ data: { media: AdminMediaItem } }>(
    `/v1/admin/media/${encodeURIComponent(id)}/approve`,
    { method: 'POST' }
  );
  return response.data.media;
}

export async function rejectMedia(id: string, note: string): Promise<AdminMediaItem> {
  const response = await apiFetch<{ data: { media: AdminMediaItem } }>(
    `/v1/admin/media/${encodeURIComponent(id)}/reject`,
    {
      method: 'POST',
      body: JSON.stringify({ note })
    }
  );
  return response.data.media;
}

/* -------------------------------------------------------------------------- */
/* Rekonsiliasi harian gateway <-> ledger (FR-131 fase 1)                     */
/* -------------------------------------------------------------------------- */

export type ReconciliationProvider = 'midtrans' | 'pjp';

/** `reconciliation_runs.status`; `running`/`failed` are reserved by the schema. */
export type ReconciliationRunStatus = 'running' | 'balanced' | 'discrepancy' | 'failed';

export type ReconciliationClassification =
  | 'matched'
  | 'duplicate'
  | 'missing_in_ledger'
  | 'missing_at_gateway'
  | 'amount_mismatch'
  | 'fee_mismatch'
  | 'unverified';

export type ReconciliationSeverity = 'info' | 'warning' | 'critical';

/** `POST/GET /v1/admin/reconciliation/runs` — money is an integer rupiah number. */
export interface ReconciliationRunSummary {
  run_id: string;
  provider: string;
  report_date: string;
  status: ReconciliationRunStatus;
  report_source: string;
  trigger_source: string;
  checked_count: number;
  matched_count: number;
  diff_count: number;
  gateway_total_idr: number;
  ledger_total_idr: number;
  diff_idr: number;
  started_at: string;
  finished_at: string | null;
}

export interface ReconciliationDiff {
  id: string;
  classification: ReconciliationClassification;
  severity: ReconciliationSeverity;
  external_id: string | null;
  gateway_amount_idr: number | null;
  ledger_amount_idr: number | null;
  delta_idr: number | null;
  detail: Record<string, unknown>;
  due_at: string | null;
  resolved_at: string | null;
}

export interface ReconciliationRunDetail extends ReconciliationRunSummary {
  diffs: ReconciliationDiff[];
}

export interface ReconciliationRunPage {
  items: ReconciliationRunSummary[];
  total: number;
  page: number;
  page_size: number;
}

export interface RunReconciliationInput {
  provider: ReconciliationProvider;
  report_date: string;
}

export function listReconciliationRuns(
  params: { page?: number; page_size?: number } = {}
): Promise<ReconciliationRunPage> {
  const search = new URLSearchParams();
  if (params.page) search.set('page', String(params.page));
  if (params.page_size) search.set('page_size', String(params.page_size));
  const suffix = search.toString() ? `?${search.toString()}` : '';
  return apiFetch<ReconciliationRunPage>(`/v1/admin/reconciliation/runs${suffix}`);
}

export function getReconciliationRun(id: string): Promise<ReconciliationRunDetail> {
  return apiFetch<ReconciliationRunDetail>(
    `/v1/admin/reconciliation/runs/${encodeURIComponent(id)}`
  );
}

/**
 * Idempoten lewat `UNIQUE (provider, scope, report_date)` di server, jadi
 * `Idempotency-Key` tidak dikirim: panggilan ulang mengembalikan run yang sama.
 */
export function runReconciliation(
  input: RunReconciliationInput
): Promise<ReconciliationRunSummary> {
  return apiFetch<ReconciliationRunSummary>('/v1/admin/reconciliation/runs', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}
