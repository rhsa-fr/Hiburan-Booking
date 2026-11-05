import { apiFetch } from './api';
import { readToken } from './session';

export type VendorApplicationStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

export interface VendorApplication {
  id: string;
  status: VendorApplicationStatus;
  display_name: string;
  legal_name: string;
  nik: string;
  region_code: string;
  base_address: string;
  review_note: string | null;
  vendor_id: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export interface VendorApplicationPage {
  items: VendorApplication[];
  total: number;
  page: number;
  page_size: number;
}

/** Admin queue. `admin_support` sees masked NIK; `admin_super` sees the full value. */
export function getVendorApplications(params: {
  status?: VendorApplicationStatus;
  page?: number;
  page_size?: number;
} = {}): Promise<VendorApplicationPage> {
  const search = new URLSearchParams();
  if (params.status) search.set('status', params.status);
  if (params.page) search.set('page', String(params.page));
  if (params.page_size) search.set('page_size', String(params.page_size));
  const suffix = search.toString() ? `?${search.toString()}` : '';
  return apiFetch<VendorApplicationPage>(`/v1/admin/vendor-applications${suffix}`);
}

export async function approveVendorApplication(id: string): Promise<VendorApplication> {
  const response = await apiFetch<{ data: VendorApplication }>(
    `/v1/admin/vendor-applications/${encodeURIComponent(id)}/approve`,
    { method: 'POST', body: JSON.stringify({ decision: 'approve' }) }
  );
  return response.data;
}

export async function rejectVendorApplication(
  id: string,
  note: string
): Promise<VendorApplication> {
  const response = await apiFetch<{ data: VendorApplication }>(
    `/v1/admin/vendor-applications/${encodeURIComponent(id)}/reject`,
    { method: 'POST', body: JSON.stringify({ decision: 'reject', note }) }
  );
  return response.data;
}

/**
 * The private KTP endpoint needs the bearer token, so it cannot be an `<a href>`.
 * Fetch the bytes, then hand the browser a short-lived object URL.
 */
export async function openVendorApplicationKtp(id: string): Promise<void> {
  const base = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001').replace(
    /\/$/,
    ''
  );
  const token = readToken();
  const response = await fetch(
    `${base}/v1/admin/vendor-applications/${encodeURIComponent(id)}/ktp`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} }
  );
  if (!response.ok) {
    throw new Error('KTP tidak bisa dibuka. Pastikan kamu admin super.');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
