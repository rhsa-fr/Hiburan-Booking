/**
 * Wire contracts for the admin panel.
 *
 * These are a faithful copy of `apps/admin/lib/types.ts`: the panel casts
 * `response.json()` straight onto those interfaces, so field names, nesting and
 * money-as-`number` are frozen here. The admin module must not import from
 * `apps/**` (§2.2 module boundaries), therefore the shapes are restated.
 *
 * Money is always an integer rupiah `number` on the wire. The DB stores BIGINT
 * and `pg` returns strings; every conversion goes through `money.ts`, which
 * refuses anything above `Number.MAX_SAFE_INTEGER`.
 */

export type LifecycleStatus =
  | 'requested'
  | 'countered'
  | 'accepted'
  | 'confirmed'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'rejected'
  | 'expired'
  | 'no_show';

export type PaymentStatus =
  | 'unpaid'
  | 'dp_paid'
  | 'fully_paid'
  | 'partially_refunded'
  | 'refunded';

export type SettlementStatus =
  | 'not_eligible'
  | 'held'
  | 'disputed'
  | 'released'
  | 'clawed_back';

export type StatusAxis = 'lifecycle' | 'payment' | 'settlement';

export type VendorVerificationStatus = 'verified' | 'pending' | 'rejected';

export type BankAccountStatus = 'verified' | 'pending' | 'rejected';

export type PaymentKind = 'dp' | 'settlement' | 'refund';

export type PaymentRecordStatus = 'pending' | 'paid' | 'failed' | 'expired';

export type DisputeStatus =
  | 'open'
  | 'resolved_to_vendor'
  | 'resolved_refund'
  | 'resolved_clawback'
  | 'rejected';

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export type NormalBalance = 'debit' | 'credit';

export type QueueKind = 'release' | 'dp' | 'dispute' | 'response' | 'counter';

export type Severity = 'info' | 'attention' | 'danger';

export type BookingDateRange = 'all' | '7d' | '30d' | 'month' | 'today';

export type BookingSort = 'event_asc' | 'event_desc' | 'created_desc' | 'created_asc';

export interface BookingStatusHistoryEntry {
  id: string;
  axis: StatusAxis;
  from_status: string;
  to_status: string;
  actor: string;
  at: string;
  note: string | null;
}

export interface Booking {
  id: string;
  code: string;
  vendor_id: string;
  vendor_name: string;
  vendor_city: string;
  customer_name: string;
  customer_phone: string;
  city: string;
  event_date: string;
  event_start_at: string;
  created_at: string;

  lifecycle_status: LifecycleStatus;
  payment_status: PaymentStatus;
  settlement_status: SettlementStatus;

  price_package_idr: number;
  service_fee_bp: number;
  service_fee_idr: number;
  total_customer_idr: number;
  dp_amount_idr: number;
  dp_min_bp: number;
  remaining_idr: number;

  commission_bp: number;
  commission_threshold_idr: number;
  commission_bp_tier2: number;
  commission_min_idr: number;
  commission_cap_idr: number;
  commission_tier1_idr: number;
  commission_tier2_idr: number;
  commission_idr: number;
  vendor_entitlement_idr: number;

  respond_deadline: string | null;
  payment_deadline: string | null;
  dispute_window_ends_at: string | null;
  released_at: string | null;

  status_history: BookingStatusHistoryEntry[];
}

export interface VendorBankAccount {
  id: string;
  bank_name: string;
  account_number_masked: string;
  account_holder: string;
  status: BankAccountStatus;
  cooling_until: string | null;
  verified_at: string | null;
  rejection_reason: string | null;
}

export interface Vendor {
  id: string;
  name: string;
  city: string;
  category: string;
  owner_name: string;
  phone: string;
  verification_status: VendorVerificationStatus;
  verified_at: string | null;
  calendar_updated_at: string;
  response_rate_bp: number;
  rating_x10: number;
  completed_bookings: number;
  is_active: boolean;
  bank_account: VendorBankAccount;

  /* --- Profil onboarding; the catalog migration split these out of the
     original admin contract. --- */
  slug: string;
  legal_name: string | null;
  description: string | null;
  base_address: string | null;
  service_radius_km: number | null;
  free_radius_km: number;
  transport_fee_per_km_idr: number;
  min_dp_bp: number;
  verification_note: string | null;
  verified_by: string | null;
}

export interface Payment {
  id: string;
  booking_id: string;
  booking_code: string;
  kind: PaymentKind;
  status: PaymentRecordStatus;
  amount_idr: number;
  method: string;
  gateway_ref: string;
  paid_at: string | null;
}

export interface JournalLine {
  id: string;
  account_code: string;
  account_name: string;
  side: 'debit' | 'credit';
  amount_idr: number;
  memo: string;
}

export interface JournalEntry {
  id: string;
  code: string;
  posted_at: string;
  description: string;
  source_type: 'payment' | 'settlement' | 'release' | 'payout' | 'clawback';
  source_ref: string;
  created_by: string;
  lines: JournalLine[];
}

export interface Account {
  code: string;
  name: string;
  type: AccountType;
  normal_balance: NormalBalance;
}

export interface Dispute {
  id: string;
  booking_id: string;
  booking_code: string;
  status: DisputeStatus;
  reason: string;
  opened_at: string;
  sla_due_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
  customer_share_idr: number;
  vendor_share_idr: number;
}

export interface CommissionConfig {
  bp1: number;
  threshold_idr: number;
  bp2: number;
  min_idr: number;
  cap_idr: number;
}

export interface PlatformSettings extends CommissionConfig {
  service_fee_bp: number;
  dp_min_bp: number;
  payment_deadline_hours: number;
  payment_deadline_hours_high_value: number;
  payment_high_value_threshold_idr: number;
  dispute_window_days: number;
  bank_cooling_hours: number;
  payout_min_idr: number;
  approval_threshold_idr: number;
}

export interface DashboardKpis {
  bookings_today: number;
  bookings_today_needs_response: number;
  awaiting_dp: number;
  awaiting_dp_overdue: number;
  ready_to_release: number;
  ready_to_release_idr: number;
  open_disputes: number;
  oldest_dispute_due_at: string | null;
}

export interface ActionQueueItem {
  id: string;
  booking_id: string;
  code: string;
  kind: QueueKind;
  title: string;
  detail: string;
  due_at: string;
  severity: Severity;
  action_label: string;
  href: string;
}

export interface OperationHealth {
  response_rate_bp: number;
  response_target_bp: number;
  dp_conversion_bp: number;
  dp_target_bp: number;
  double_bookings: number;
  median_response_minutes: number;
}

export interface DailyBookingPoint {
  date: string;
  label: string;
  count: number;
}

export interface PaymentMixSlice {
  status: PaymentStatus;
  label: string;
  count: number;
}

export interface DashboardSummary {
  as_of: string;
  kpis: DashboardKpis;
  queue: ActionQueueItem[];
  health: OperationHealth;
  daily_bookings_7d: DailyBookingPoint[];
  daily_bookings_30d: DailyBookingPoint[];
  payment_mix: PaymentMixSlice[];
}

export interface PaymentKindSummary {
  kind: PaymentKind;
  label: string;
  count: number;
  amount_idr: number;
}

export interface PaymentsOverview {
  items: Payment[];
  total_idr: number;
  by_kind: PaymentKindSummary[];
}

export interface DisputeRecord extends Dispute {
  vendor_name: string;
  city: string;
  customer_name: string;
}

export interface DisputeOverview {
  items: DisputeRecord[];
  open_count: number;
  total_idr: number;
}

export interface AuditEvent {
  id: string;
  booking_id: string;
  booking_code: string;
  axis: StatusAxis;
  from_status: string;
  to_status: string;
  actor: string;
  at: string;
  note: string | null;
}

/** One row of `audit_logs`, exposed so the panel can prove who did what. */
export interface AuditAction {
  seq: number;
  created_at: string;
  actor_id: string | null;
  actor_label: string;
  actor_role: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  before: unknown;
  after: unknown;
  request_id: string | null;
}

export interface AuditLog {
  events: AuditEvent[];
  total: number;
  actions: AuditAction[];
}

export interface BookingFilters {
  status: string;
  range: BookingDateRange;
  city: string;
  q: string;
  sort: BookingSort;
  page: number;
  page_size: number;
}

export interface VendorFilters {
  q: string;
  city: string;
  verification: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface BookingDetail {
  booking: Booking;
  payments: Payment[];
  dispute: Dispute | null;
  /** Additive: the panel type does not read it, the ops team asked for it. */
  journal_entries: JournalEntry[];
  /** Sisa tagihan (total - DP) dihitung server; sumber angka modal pelunasan. */
  outstanding_idr: number;
}

export type SettleManualMethod = 'transfer_manual' | 'cash';

export interface SettleBookingResponse {
  booking_id: string;
  payment_id: string;
  journal_entry_id: string;
  payment_status: 'fully_paid';
  outstanding_before_idr: number;
  already_settled: boolean;
}

export interface VendorDetail {
  vendor: Vendor;
  recent_bookings: Booking[];
}

export interface ReleaseCandidate {
  booking: Booking;
  eligible: boolean;
  blocked_reason: string | null;
  window_ends_at: string | null;
}

export interface ReleaseQueue {
  max_batch: number;
  candidates: ReleaseCandidate[];
}

export interface ReleaseJournal {
  booking_id: string;
  booking_code: string;
  lines: JournalLine[];
  debit_total_idr: number;
  credit_total_idr: number;
}

export interface ReleasePreview {
  journals: ReleaseJournal[];
  total_entitlement_idr: number;
  total_debit_idr: number;
  total_credit_idr: number;
  maker: string;
  checker: string;
}

export interface ReleaseInput {
  booking_ids: string[];
  reason: string;
  maker: string;
  checker: string;
}

export interface ReleaseResult {
  released_booking_codes: string[];
  journal_codes: string[];
  released_at: string;
  checker: string;
  reason: string;
  /* Additive fields requested by the packet; the panel ignores extra keys. */
  released_booking_ids: string[];
  journal_entry_ids: string[];
  maker: string;
  total_debit_idr: number;
  total_credit_idr: number;
  total_entitlement_idr: number;
}

export interface LedgerData {
  entries: JournalEntry[];
  accounts: Account[];
}

export interface Operator {
  id: string;
  name: string;
  role: string;
}
