import { ApiError } from './errors';
import { readToken } from './session';
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

/**
 * Single entry point for both data paths. Signatures never change when the
 * mock flag flips: only the transport does.
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (!isMockMode()) {
    const headers = new Headers(init?.headers);
    headers.set('Accept', 'application/json');
    if (init?.body) {
      headers.set('Content-Type', 'application/json');
    }
    // API memakai prefix global `/v1`; panel historically memanggil `/api/v1`.
    // Dinormalisasi di satu tempat supaya semua pemanggil konsisten.
    const normalised = path.replace(/^\/api\/v1/, '/v1');
    const token = readToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(`${BASE_URL}${normalised}`, { ...init, headers });
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

export interface AuthResult {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: AuthUser;
}

/** True when a Google OAuth client id is configured for the browser. */
export function googleLoginEnabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID);
}

export function googleClientId(): string {
  return process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '';
}

/** Email + password. Dipakai panel admin; API memakai prefix `/v1`. */
export async function loginWithPassword(email: string, password: string): Promise<AuthResult> {
  const response = await apiFetch<{ data: AuthResult }>('/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
  return response.data;
}

/** Google Sign-In: kirim ID token dari Google Identity Services. */
export async function loginWithGoogle(idToken: string): Promise<AuthResult> {
  const response = await apiFetch<{ data: AuthResult }>('/v1/auth/google', {
    method: 'POST',
    body: JSON.stringify({ id_token: idToken })
  });
  return response.data;
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

