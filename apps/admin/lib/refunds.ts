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
  /** Manual bank transfer instead of a provider refund. */
  is_manual?: boolean;
  transfer_ref?: string | null;
  transferred_at?: string | null;
}

export interface ManualRefundInput {
  amount_idr: number;
  reason: string;
  transfer_ref: string;
  transferred_at?: string;
  evidence_url?: string;
}

/** Response of `POST /payments/:id/refund/manual` (RefundResult, no booking context). */
export interface ManualRefundResult {
  id: string;
  status: RefundQueueStatus;
  amount_idr: number;
  requires_approval: boolean;
  is_manual: boolean;
  transfer_ref: string | null;
  transferred_at: string | null;
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

/**
 * Refund manual (transfer bank) untuk pembayaran yang tidak bisa di-refund
 * gateway, mis. VA/Mandiri. `transfer_ref` wajib dan menjadi bukti transfer.
 */
export async function requestManualRefund(
  paymentId: string,
  input: ManualRefundInput
): Promise<ManualRefundResult> {
  const response = await apiFetch<{ data: ManualRefundResult }>(
    `/v1/payments/${encodeURIComponent(paymentId)}/refund/manual`,
    {
      method: 'POST',
      body: JSON.stringify(input)
    }
  );
  return response.data;
}

export async function rejectRefund(id: string, note: string): Promise<void> {
  await apiFetch(`/v1/payments/refunds/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    body: JSON.stringify({ note })
  });
}
