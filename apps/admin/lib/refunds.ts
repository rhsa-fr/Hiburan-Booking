import { apiFetch } from './api';

export type RefundQueueStatus =
  | 'requested'
  | 'approved'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'rejected';

export interface RefundItem {
  id: string;
  payment_id: string;
  booking_id: string;
  booking_code: string;
  customer_name: string | null;
  created_at: string;
  amount_idr: number;
  fee_idr: number;
  currency: 'IDR';
  status: RefundQueueStatus;
  reason_code: string;
  reason_note: string | null;
  evidence_url: string | null;
  review_note: string | null;
  requested_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  requires_approval: boolean;
}

export async function getRefunds(params: {
  status?: RefundQueueStatus;
  limit?: number;
} = {}): Promise<RefundItem[]> {
  const search = new URLSearchParams();
  if (params.status) search.set('status', params.status);
  if (params.limit) search.set('limit', String(params.limit));
  const suffix = search.toString() ? `?${search.toString()}` : '';
  const response = await apiFetch<{ data: { items: RefundItem[] } }>(
    `/v1/payments/refunds${suffix}`
  );
  return response.data.items;
}

export async function approveRefund(id: string): Promise<void> {
  await apiFetch(`/v1/payments/refunds/${encodeURIComponent(id)}/approve`, {
    method: 'POST'
  });
}

export async function rejectRefund(id: string, note: string): Promise<void> {
  await apiFetch(`/v1/payments/refunds/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    body: JSON.stringify({ note })
  });
}
