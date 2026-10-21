/**
 * Domain types for the Tarlink admin panel.
 * Naming mirrors the API contract (snake_case) so mock and real responses
 * can be swapped without touching the screens.
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

export type BookingDateRange = 'all' | '7d' | '30d' | 'month';

export type BookingSort = 'event_asc' | 'event_desc' | 'created_desc';

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

  /* --- Profil onboarding (kontrak /admin/vendors). Opsional karena list
     lama belum mengirimkannya; layar memakai fallback yang jujur. --- */
  slug?: string;
  display_name?: string;
  region_code?: string;
  legal_name?: string | null;
  description?: string | null;
  base_address?: string | null;
  service_radius_km?: number | null;
  free_radius_km?: number;
  transport_fee_per_km_idr?: number;
  min_dp_bp?: number;
  verification_note?: string | null;
  verified_by?: string | null;
  owner_email?: string | null;
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

export interface AccountBalance extends Account {
  debit_idr: number;
  credit_idr: number;
  balance_idr: number;
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

export interface DashboardSummary {
  as_of: string;
  kpis: DashboardKpis;
  queue: ActionQueueItem[];
  health: OperationHealth;
  daily_bookings_7d: DailyBookingPoint[];
  daily_bookings_30d: DailyBookingPoint[];
  payment_mix: PaymentMixSlice[];
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

export interface PaymentKindSummary {
  kind: Payment['kind'];
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

/** Satu baris `audit_logs`: siapa, aksi apa, sebelum dan sesudahnya. */
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
  actions?: AuditAction[];
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
  /** Dihitung di server: total tagihan - DP. */
  outstanding_idr: number;
}

export type SettleManualMethod = 'transfer_manual' | 'cash';

export interface SettleBookingInput {
  amount_idr: number;
  method: SettleManualMethod;
  reference?: string;
  note?: string;
}

export interface SettleBookingResult {
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

export interface LoginSession {
  operator_name: string;
  role: string;
  mock: boolean;
}

/* -------------------------------------------------------------------------- */
/* Onboarding vendor — kontrak /admin/vendors                                 */
/* -------------------------------------------------------------------------- */

export interface VendorCreateInput {
  owner_email?: string;
  owner_phone?: string;
  region_code: string;
  display_name: string;
  legal_name?: string;
  description?: string;
  base_address?: string;
}

export interface VendorCreateResult {
  id: string;
  slug: string;
  display_name: string;
  verification_status: VendorVerificationStatus;
  region_code: string;
  created_at: string;
}

export interface VendorPatchInput {
  display_name?: string;
  legal_name?: string;
  description?: string;
  base_address?: string;
  service_radius_km?: number;
  free_radius_km?: number;
  transport_fee_per_km_idr?: number;
  min_dp_bp?: number;
  is_active?: boolean;
}

export type VendorVerifyDecision = 'approve' | 'reject';

export interface VendorVerifyInput {
  decision: VendorVerifyDecision;
  note?: string;
}

export interface VendorVerifyResult {
  id: string;
  verification_status: VendorVerificationStatus;
  verified_at: string | null;
  verified_by: string | null;
}

export interface PackageRow {
  id: string;
  vendor_id: string;
  name: string;
  duration_minutes: number;
  base_price_idr: number;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

export interface VendorPackageInput {
  name: string;
  duration_minutes: number;
  base_price_idr: number;
  description?: string;
  is_active?: boolean;
}

export type VendorPackagePatchInput = Partial<VendorPackageInput>;

export type VendorCalendarSession = 'day' | 'night' | 'full';

export type VendorCalendarStatus =
  | 'available'
  | 'blocked'
  | 'held'
  | 'booked'
  | 'unconfirmed';

export interface VendorCalendarDay {
  date: string;
  session: VendorCalendarSession;
  status: VendorCalendarStatus;
}

export interface VendorCalendarResponse {
  days: VendorCalendarDay[];
}

export interface VendorCalendarBulkInput {
  from: string;
  to: string;
  status: 'available' | 'blocked';
  sessions: VendorCalendarSession[];
}

export interface VendorCalendarBulkResult {
  updated: number;
}
