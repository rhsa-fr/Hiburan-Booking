/**
 * Row -> wire mapping. Everything is explicit: no spread of DB rows, no
 * implicit `any`, and every money value crosses the safe-integer guard in
 * `money.ts`.
 */
import { AppError } from '@tarlink/core/errors';
import type {
  Account,
  AuditAction,
  BankAccountStatus,
  Booking,
  BookingStatusHistoryEntry,
  DisputeRecord,
  DisputeStatus,
  JournalEntry,
  JournalLine,
  LifecycleStatus,
  Payment,
  PaymentKind,
  PaymentRecordStatus,
  SettlementStatus,
  StatusAxis,
  Vendor,
  VendorVerificationStatus
} from './contracts';
import { humanizeAccountName } from './display';
import { idrToJson, toIdr } from './money';
import type {
  AccountRow,
  AuditActionRow,
  BookingRow,
  DisputeRow,
  JournalEntryRow,
  JournalLineRow,
  PaymentRow,
  StatusHistoryRow,
  VendorRow
} from './rows';

export function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError('INTERNAL_ERROR', 'database returned an invalid timestamp');
  }
  return date.toISOString();
}

export function toIsoRequired(value: Date | string): string {
  const iso = toIso(value);
  if (iso === null) throw new AppError('INTERNAL_ERROR', 'timestamp is missing');
  return iso;
}

/* ------------------------------------------------------------------ booking */

export function mapStatusHistory(row: StatusHistoryRow): BookingStatusHistoryEntry {
  return {
    id: String(row.id),
    axis: row.axis,
    from_status: row.from_state ?? '',
    to_status: row.to_state,
    actor: row.actor ?? 'Sistem',
    at: toIsoRequired(row.created_at),
    note: row.note
  };
}

export function mapBooking(row: BookingRow, history: readonly StatusHistoryRow[] = []): Booking {
  return {
    id: row.id,
    code: row.code,
    vendor_id: row.vendor_id,
    vendor_name: row.vendor_name,
    vendor_city: row.vendor_city,
    customer_name: row.customer_name,
    customer_phone: row.customer_phone,
    city: row.city,
    event_date: row.event_date,
    event_start_at: row.scheduled_start_at
      ? toIsoRequired(row.scheduled_start_at)
      : `${row.event_date}T00:00:00+07:00`,
    created_at: toIsoRequired(row.created_at),

    lifecycle_status: row.lifecycle_status as LifecycleStatus,
    payment_status: row.payment_status,
    settlement_status: row.settlement_status as SettlementStatus,

    price_package_idr: idrToJson(row.price_package_idr, 'price_package_idr'),
    service_fee_bp: row.service_fee_bp,
    service_fee_idr: idrToJson(row.service_fee_idr, 'service_fee_idr'),
    total_customer_idr: idrToJson(row.total_customer_idr, 'total_customer_idr'),
    dp_amount_idr: idrToJson(row.dp_amount_idr, 'dp_amount_idr'),
    dp_min_bp: row.dp_min_bp,
    remaining_idr: idrToJson(row.remaining_idr, 'remaining_idr'),

    commission_bp: row.commission_bp,
    commission_threshold_idr: idrToJson(row.commission_threshold_idr, 'commission_threshold_idr'),
    commission_bp_tier2: row.commission_bp_tier2,
    commission_min_idr: idrToJson(row.commission_min_idr, 'commission_min_idr'),
    commission_cap_idr: idrToJson(row.commission_cap_idr, 'commission_cap_idr'),
    commission_tier1_idr: idrToJson(row.commission_tier1_idr, 'commission_tier1_idr'),
    commission_tier2_idr: idrToJson(row.commission_tier2_idr, 'commission_tier2_idr'),
    commission_idr: idrToJson(row.commission_idr, 'commission_idr'),
    vendor_entitlement_idr: idrToJson(row.vendor_entitlement_idr, 'vendor_entitlement_idr'),

    respond_deadline: toIso(row.respond_deadline),
    payment_deadline: toIso(row.payment_deadline),
    dispute_window_ends_at: toIso(row.dispute_window_ends_at),
    released_at: toIso(row.released_at),

    status_history: history.map(mapStatusHistory)
  };
}

/* ----------------------------------------------------------------- payments */

const PAYMENT_KINDS: readonly PaymentKind[] = ['dp', 'settlement', 'refund'];
const PAYMENT_STATUSES: readonly PaymentRecordStatus[] = ['pending', 'paid', 'failed', 'expired'];

export function mapPayment(row: PaymentRow): Payment {
  const kind = PAYMENT_KINDS.find((value) => value === row.kind);
  if (!kind) throw new AppError('INTERNAL_ERROR', `unknown payment kind ${row.kind}`);
  const status = PAYMENT_STATUSES.find((value) => value === row.status);
  if (!status) throw new AppError('INTERNAL_ERROR', `unknown payment status ${row.status}`);

  return {
    id: row.id,
    booking_id: row.booking_id,
    booking_code: row.booking_code,
    kind,
    status,
    amount_idr: idrToJson(row.amount_idr, 'payment.amount_idr'),
    method: row.method,
    gateway_ref: row.gateway_ref ?? '',
    paid_at: toIso(row.paid_at)
  };
}

/* ------------------------------------------------------------------- ledger */

function sourceTypeFor(referenceType: string): JournalEntry['source_type'] {
  switch (referenceType) {
    case 'payment':
      return 'payment';
    case 'payout':
      return 'payout';
    case 'dispute':
      return 'clawback';
    case 'booking':
      return 'release';
    case 'refund':
    case 'adjustment':
      return 'settlement';
    default:
      return 'settlement';
  }
}

export function mapJournalLine(row: JournalLineRow): JournalLine {
  const debit = toIdr(row.debit_idr, 'journal_line.debit_idr');
  const credit = toIdr(row.credit_idr, 'journal_line.credit_idr');
  if (debit > 0n) {
    return {
      id: `${row.journal_entry_id}-l${row.line_no}`,
      account_code: row.account_code,
      account_name: humanizeAccountName(row.account_name),
      side: 'debit',
      amount_idr: idrToJson(debit, 'journal_line.debit_idr'),
      memo: row.memo ?? ''
    };
  }
  return {
    id: `${row.journal_entry_id}-l${row.line_no}`,
    account_code: row.account_code,
    account_name: humanizeAccountName(row.account_name),
    side: 'credit',
    amount_idr: idrToJson(credit, 'journal_line.credit_idr'),
    memo: row.memo ?? ''
  };
}

export function mapJournalEntry(row: JournalEntryRow, lines: readonly JournalLineRow[]): JournalEntry {
  return {
    id: row.id,
    code: `JE-${row.entry_no}`,
    posted_at: toIsoRequired(row.occurred_at),
    description: row.memo ?? row.event_type,
    source_type: sourceTypeFor(row.reference_type),
    source_ref: row.booking_code ?? row.reference_id ?? '',
    created_by: row.created_by_name ?? 'Sistem',
    lines: lines.map(mapJournalLine)
  };
}

export function mapAccount(row: AccountRow): Account {
  return {
    code: row.code,
    name: humanizeAccountName(row.name),
    type: row.account_type,
    normal_balance: row.normal_balance
  };
}

/* ---------------------------------------------------------------- disputes */

export function mapDisputeStatus(row: DisputeRow): DisputeStatus {
  if (row.status === 'rejected') return 'rejected';
  if (row.status !== 'resolved') return 'open';
  switch (row.resolution) {
    case 'release_to_vendor':
    case 'no_action':
      return 'resolved_to_vendor';
    case 'refund_full':
    case 'refund_partial':
      return 'resolved_refund';
    case 'split':
      return 'resolved_clawback';
    default:
      return 'resolved_to_vendor';
  }
}

export function mapDispute(row: DisputeRow): DisputeRecord {
  return {
    id: row.id,
    booking_id: row.booking_id,
    booking_code: row.booking_code,
    status: mapDisputeStatus(row),
    reason: row.description,
    opened_at: toIsoRequired(row.opened_at),
    sla_due_at: toIsoRequired(row.sla_due_at),
    resolved_at: toIso(row.resolved_at),
    resolution_note: row.resolution_note,
    customer_share_idr: idrToJson(row.customer_share_idr, 'dispute.customer_share_idr'),
    vendor_share_idr: idrToJson(row.vendor_share_idr, 'dispute.vendor_share_idr'),
    vendor_name: row.vendor_name ?? 'Vendor tidak ditemukan',
    city: row.city ?? '-',
    customer_name: row.customer_name ?? '-'
  };
}

/* ----------------------------------------------------------------- vendors */

function mapVerificationStatus(value: string): VendorVerificationStatus {
  switch (value) {
    case 'approved':
      return 'verified';
    case 'pending':
      return 'pending';
    // The panel has no `suspended` state; a suspended vendor is not verified.
    case 'rejected':
    case 'suspended':
      return 'rejected';
    default:
      throw new AppError('INTERNAL_ERROR', `unknown vendor verification status ${value}`);
  }
}

function mapBankStatus(value: string | null): BankAccountStatus {
  switch (value) {
    case 'verified':
      return 'verified';
    case 'rejected':
      return 'rejected';
    default:
      return 'pending';
  }
}

export function mapVendor(row: VendorRow): Vendor {
  // The panel type requires a bank_account object; vendors without a registered
  // account get a neutral, clearly empty placeholder rather than invented data.
  const bank = row.bank_id
    ? {
        id: row.bank_id,
        bank_name: row.bank_name ?? '',
        account_number_masked: row.bank_masked ?? '',
        account_holder: row.bank_holder ?? '',
        status: mapBankStatus(row.bank_status),
        cooling_until: toIso(row.bank_cooling_until),
        verified_at: toIso(row.bank_verified_at),
        rejection_reason: row.bank_rejection_reason
      }
    : {
        id: '',
        bank_name: '',
        account_number_masked: '',
        account_holder: '',
        status: 'pending' as const,
        cooling_until: null,
        verified_at: null,
        rejection_reason: null
      };

  return {
    id: row.id,
    name: row.name,
    city: row.city,
    // No category table exists in 001/002; the panel falls back to this blank.
    category: '',
    owner_name: row.owner_name,
    phone: row.phone,
    verification_status: mapVerificationStatus(row.verification_status),
    verified_at: toIso(row.verified_at),
    calendar_updated_at: toIsoRequired(row.calendar_updated_at ?? row.created_at),
    response_rate_bp: row.response_rate_bp ?? 0,
    rating_x10: row.rating_x10 ?? 0,
    completed_bookings: row.completed_bookings,
    is_active: row.is_active,
    bank_account: bank,
    slug: row.slug,
    legal_name: row.legal_name,
    description: row.description,
    base_address: row.base_address,
    service_radius_km: row.service_radius_km,
    free_radius_km: row.free_radius_km,
    transport_fee_per_km_idr: idrToJson(
      row.transport_fee_per_km_idr,
      'vendors.transport_fee_per_km_idr'
    ),
    min_dp_bp: row.min_dp_bp,
    verification_note: row.verification_note,
    verified_by: row.verified_by
  };
}

export function mapAuditAction(row: AuditActionRow): AuditAction {
  return {
    seq: Number(row.seq),
    created_at: toIsoRequired(row.created_at),
    actor_id: row.actor_id,
    // The join already falls back to the uuid; keep it for a deleted actor row.
    actor_label: row.actor_label ?? row.actor_id ?? 'Sistem',
    actor_role: row.actor_role,
    action: row.action,
    entity: row.entity_type,
    entity_id: row.entity_id,
    before: row.before_state,
    after: row.after_state,
    request_id: row.request_id
  };
}

/* ------------------------------------------------------------------- misc */

export function axisFromDb(value: string): StatusAxis {
  if (value === 'lifecycle' || value === 'payment' || value === 'settlement') return value;
  throw new AppError('INTERNAL_ERROR', `unknown status axis ${value}`);
}
