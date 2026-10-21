/**
 * `pg` row shapes. Money arrives as string (BIGINT), timestamps as Date.
 * These types are the only place SQL column names meet TypeScript; mapping to
 * the wire contract happens in `mappers.ts`.
 *
 * Deliberately `type` aliases (not interfaces): `pg`'s `QueryResultRow` is an
 * index-signature type and type aliases of object literals get an implicit
 * index signature, interfaces do not.
 */
import type {
  LifecycleStatus,
  NormalBalance,
  PaymentStatus,
  SettlementStatus,
  StatusAxis
} from './contracts';

export type BookingRow = {
  id: string;
  code: string;
  vendor_id: string;
  vendor_name: string;
  vendor_city: string;
  customer_name: string;
  customer_phone: string;
  city: string;
  event_date: string;
  scheduled_start_at: Date | null;
  created_at: Date;
  lifecycle_status: LifecycleStatus;
  payment_status: PaymentStatus;
  settlement_status: SettlementStatus;
  price_package_idr: string;
  service_fee_bp: number;
  service_fee_idr: string;
  total_customer_idr: string;
  dp_amount_idr: string;
  dp_min_bp: number;
  remaining_idr: string;
  commission_bp: number;
  commission_threshold_idr: string;
  commission_bp_tier2: number;
  commission_min_idr: string;
  commission_cap_idr: string;
  commission_tier1_idr: string;
  commission_tier2_idr: string;
  commission_idr: string;
  vendor_entitlement_idr: string;
  respond_deadline: Date | null;
  payment_deadline: Date | null;
  dispute_window_ends_at: Date | null;
  released_at: Date | null;
  updated_at: Date;
};

export type StatusHistoryRow = {
  id: string;
  booking_id: string;
  axis: StatusAxis;
  from_state: string | null;
  to_state: string;
  actor: string | null;
  created_at: Date;
  note: string | null;
};

export type PaymentRow = {
  id: string;
  booking_id: string;
  booking_code: string;
  kind: string;
  status: string;
  amount_idr: string;
  method: string;
  gateway_ref: string | null;
  paid_at: Date | null;
  created_at: Date;
};

export type JournalEntryRow = {
  id: string;
  entry_no: string;
  event_type: string;
  reference_type: string;
  reference_id: string | null;
  booking_id: string | null;
  booking_code: string | null;
  memo: string | null;
  occurred_at: Date;
  created_at: Date;
  created_by_name: string | null;
};

export type JournalLineRow = {
  journal_entry_id: string;
  line_no: number;
  account_code: string;
  account_name: string;
  debit_idr: string;
  credit_idr: string;
  memo: string | null;
};

export type AccountRow = {
  code: string;
  name: string;
  account_type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  normal_balance: NormalBalance;
};

export type DisputeRow = {
  id: string;
  booking_id: string;
  booking_code: string;
  status: string;
  resolution: string | null;
  description: string;
  opened_at: Date;
  sla_due_at: Date;
  resolved_at: Date | null;
  resolution_note: string | null;
  customer_share_idr: string;
  vendor_share_idr: string;
  vendor_name: string | null;
  city: string | null;
  customer_name: string | null;
};

export type VendorRow = {
  id: string;
  name: string;
  slug: string;
  legal_name: string | null;
  description: string | null;
  base_address: string | null;
  service_radius_km: number | null;
  free_radius_km: number;
  transport_fee_per_km_idr: string;
  min_dp_bp: number;
  verification_note: string | null;
  verified_by: string | null;
  city: string;
  owner_name: string;
  phone: string;
  verification_status: string;
  verified_at: Date | null;
  calendar_updated_at: Date | null;
  created_at: Date;
  response_rate_bp: number | null;
  rating_x10: number | null;
  completed_bookings: number;
  is_active: boolean;
  bank_id: string | null;
  bank_name: string | null;
  bank_masked: string | null;
  bank_holder: string | null;
  bank_status: string | null;
  bank_cooling_until: Date | null;
  bank_verified_at: Date | null;
  bank_rejection_reason: string | null;
};

export type SettingsRow = {
  key: string;
  value: unknown;
};

export type AuditEventRow = {
  id: string;
  booking_id: string;
  booking_code: string;
  axis: StatusAxis;
  from_status: string | null;
  to_status: string;
  actor: string | null;
  at: Date;
  note: string | null;
};

/** `bigint` arrives from `pg` as a string; the mapper converts it. */
export type AuditActionRow = {
  seq: string;
  created_at: Date;
  actor_id: string | null;
  actor_label: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_state: unknown;
  after_state: unknown;
  request_id: string | null;
};

export type QueueRow = {
  booking_id: string;
  code: string;
  kind: string;
  title: string;
  detail: string;
  amount_idr: string | null;
  due_at: Date;
  severity: string;
};

export type KpiRow = {
  bookings_today: number;
  bookings_today_needs_response: number;
  awaiting_dp: number;
  awaiting_dp_overdue: number;
  ready_to_release: number;
  ready_to_release_idr: string;
  open_disputes: number;
  oldest_dispute_due_at: Date | null;
};

export type HealthRow = {
  response_rate_bp: number;
  dp_conversion_bp: number;
  median_response_minutes: number;
};

export type DailyRow = {
  date: string;
  count: number;
};

export type MixRow = {
  status: PaymentStatus;
  count: number;
};

export type AdminUserRow = {
  id: string;
  name: string;
  roles: string[];
};

export type OperatorRow = {
  id: string;
  name: string;
  role: string;
};

export type ReleasedRow = {
  id: string;
  code: string;
  settlement_status: SettlementStatus;
  released_at: Date | null;
};
