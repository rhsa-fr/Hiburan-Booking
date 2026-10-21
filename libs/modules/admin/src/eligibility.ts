/**
 * Release rules — pure, no I/O, unit-tested.
 *
 * Eligibility is the packet's four conditions, evaluated against an explicit
 * `now` so tests do not depend on the wall clock:
 *   1. lifecycle_status = 'completed'
 *   2. settlement_status = 'held'
 *   3. payment_status IN ('dp_paid','fully_paid')
 *   4. dispute_window_ends_at < now()
 *
 * The journal itself is never written here: `buildEntry('release', …)` from the
 * ledger module produces the draft, and `postEntry` is the only writer.
 */
import { AppError } from '@tarlink/core/errors';
import { ACCOUNT, buildEntry, getAccountByCode, type JournalEntryDraft } from '@tarlink/modules/ledger';
import type { CommissionConfig as LedgerCommissionConfig } from '@tarlink/platform/pricing';
import type {
  LifecycleStatus,
  PaymentStatus,
  ReleaseInput,
  ReleaseJournal,
  SettlementStatus
} from './contracts';
import { humanizeAccountName } from './display';
import { idrToJson, toIdr } from './money';

export const RELEASE_MAX_BATCH = 5;
export const RELEASE_REASON_MIN_LENGTH = 10;
export const RELEASE_ROLES = ['admin_finance', 'admin_super'] as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ------------------------------------------------------------- eligibility */

export interface ReleaseEligibilityBooking {
  lifecycle_status: LifecycleStatus;
  payment_status: PaymentStatus;
  settlement_status: SettlementStatus;
  dispute_window_ends_at: Date | string | null;
}

export interface ReleaseEligibility {
  eligible: boolean;
  blocked_reason: string | null;
}

function blocked(reason: string): ReleaseEligibility {
  return { eligible: false, blocked_reason: reason };
}

function toDate(value: Date | string): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function evaluateReleaseEligibility(
  booking: ReleaseEligibilityBooking,
  now: Date
): ReleaseEligibility {
  if (booking.lifecycle_status !== 'completed') {
    return blocked('Acara belum selesai — pencairan menunggu status completed.');
  }
  if (booking.settlement_status !== 'held') {
    return blocked('Dana tidak dalam status ditahan (held).');
  }
  if (booking.payment_status !== 'dp_paid' && booking.payment_status !== 'fully_paid') {
    return blocked('Pembayaran belum mencapai DP.');
  }
  // Schema alignment (001_core.sql, `assert_booking_combination`): the DB
  // rejects settlement_status='released' unless payment_status is
  // fully_paid/partially_refunded. The panel's mock applies the same rule, so a
  // DP-only booking is shown as blocked instead of failing at UPDATE time.
  if (booking.payment_status !== 'fully_paid') {
    return blocked('Tagihan belum lunas sepenuhnya — release hanya untuk fully_paid.');
  }
  if (booking.dispute_window_ends_at === null) {
    return blocked('Jendela sengketa belum ditetapkan.');
  }

  const windowEnds = toDate(booking.dispute_window_ends_at);
  if (windowEnds === null) {
    return blocked('Jendela sengketa tidak valid.');
  }
  if (windowEnds.getTime() >= now.getTime()) {
    return blocked('Jendela sengketa belum berakhir.');
  }

  return { eligible: true, blocked_reason: null };
}

/* ------------------------------------------------------- request validation */

export interface ValidatedReleaseRequest {
  bookingIds: string[];
  reason: string;
  maker: string;
  checker: string;
}

export function validateReleaseRequest(
  input: ReleaseInput,
  maxBatch: number = RELEASE_MAX_BATCH
): ValidatedReleaseRequest {
  if (!Array.isArray(input.booking_ids) || input.booking_ids.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'Pilih minimal satu booking untuk dicairkan.');
  }
  if (input.booking_ids.length > maxBatch) {
    throw new AppError('VALIDATION_ERROR', `Maksimal ${maxBatch} booking per batch.`);
  }

  const bookingIds = input.booking_ids.map((value) => {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new AppError('VALIDATION_ERROR', 'booking_ids hanya boleh berisi id booking.');
    }
    const id = value.trim();
    if (!UUID_PATTERN.test(id)) {
      throw new AppError('VALIDATION_ERROR', `booking_ids memuat id yang bukan UUID: ${id}`);
    }
    return id;
  });

  if (new Set(bookingIds).size !== bookingIds.length) {
    throw new AppError('VALIDATION_ERROR', 'booking_ids tidak boleh berisi duplikat.');
  }

  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason.length < RELEASE_REASON_MIN_LENGTH) {
    throw new AppError(
      'VALIDATION_ERROR',
      `Alasan pencairan wajib diisi minimal ${RELEASE_REASON_MIN_LENGTH} karakter.`
    );
  }

  const maker = typeof input.maker === 'string' ? input.maker.trim() : '';
  const checker = typeof input.checker === 'string' ? input.checker.trim() : '';
  if (maker.length === 0 || checker.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'Maker dan checker wajib dipilih.');
  }
  if (maker.toLowerCase() === checker.toLowerCase()) {
    throw new AppError('VALIDATION_ERROR', 'Checker harus operator yang berbeda dari maker.');
  }

  return { bookingIds, reason, maker, checker };
}

/* -------------------------------------------------------------- four eyes */

export interface AdminIdentity {
  id: string;
  name: string;
  roles: readonly string[];
}

function privilegedRole(identity: AdminIdentity): 'admin_finance' | 'admin_super' | null {
  if (identity.roles.includes('admin_super')) return 'admin_super';
  if (identity.roles.includes('admin_finance')) return 'admin_finance';
  return null;
}

/**
 * Both parties must exist as active users and hold `admin_finance` or
 * `admin_super`; the two ids must differ. Returns the role used for the audit
 * trail so the caller never guesses it.
 */
export function assertReleaseOperators(
  maker: AdminIdentity | null,
  checker: AdminIdentity | null
): { makerRole: 'admin_finance' | 'admin_super'; checkerRole: 'admin_finance' | 'admin_super' } {
  if (!maker) {
    throw new AppError('VALIDATION_ERROR', 'Maker tidak ditemukan atau tidak aktif.');
  }
  if (!checker) {
    throw new AppError('VALIDATION_ERROR', 'Checker tidak ditemukan atau tidak aktif.');
  }
  if (maker.id === checker.id) {
    throw new AppError('VALIDATION_ERROR', 'Checker harus operator yang berbeda dari maker.');
  }

  const makerRole = privilegedRole(maker);
  if (!makerRole) {
    throw new AppError(
      'FORBIDDEN',
      `${maker.name} tidak memiliki peran admin_finance atau admin_super.`
    );
  }
  const checkerRole = privilegedRole(checker);
  if (!checkerRole) {
    throw new AppError(
      'FORBIDDEN',
      `${checker.name} tidak memiliki peran admin_finance atau admin_super.`
    );
  }

  return { makerRole, checkerRole };
}

/* --------------------------------------------------------------- the draft */

export interface ReleaseBookingMoney {
  id: string;
  code: string;
  vendor_id: string;
  total_customer_idr: string | bigint;
  price_package_idr: string | bigint;
  service_fee_idr: string | bigint;
  commission_bp: number;
  commission_threshold_idr: string | bigint;
  commission_bp_tier2: number;
  commission_min_idr: string | bigint;
  commission_cap_idr: string | bigint;
}

export interface ReleaseJournalPlan {
  draft: JournalEntryDraft;
  journal: ReleaseJournal;
  debitTotalIdr: bigint;
  creditTotalIdr: bigint;
  vendorPayableIdr: bigint;
}

function commissionConfigFor(booking: ReleaseBookingMoney): LedgerCommissionConfig {
  return {
    bp1: booking.commission_bp,
    threshold: toIdr(booking.commission_threshold_idr, 'commission_threshold_idr'),
    bp2: booking.commission_bp_tier2,
    min: toIdr(booking.commission_min_idr, 'commission_min_idr'),
    cap: toIdr(booking.commission_cap_idr, 'commission_cap_idr')
  };
}

/**
 * Builds the exact release entry for one booking with the ledger module.
 * `escrowIdr` is the gross customer money already recognised as escrow
 * (`total_customer_idr`), matching the ledger's own release scenario.
 */
export function buildReleaseJournalPlan(
  booking: ReleaseBookingMoney,
  occurredAt: Date,
  memo?: string
): ReleaseJournalPlan {
  const escrowIdr = toIdr(booking.total_customer_idr, 'total_customer_idr');
  const draft = buildEntry('release', {
    bookingId: booking.id,
    vendorId: booking.vendor_id,
    escrowIdr,
    commissionBaseIdr: toIdr(booking.price_package_idr, 'price_package_idr'),
    serviceFeeIdr: toIdr(booking.service_fee_idr, 'service_fee_idr'),
    commissionConfig: commissionConfigFor(booking),
    occurredAt,
    sourceEventKey: `booking:${booking.id}:released`,
    memo: memo ?? `Release ${booking.code}`
  });

  let debitTotalIdr = 0n;
  let creditTotalIdr = 0n;
  let vendorPayableIdr = 0n;

  const lines = draft.lines.map((line, index) => {
    const isDebit = line.debitIdr > 0n;
    const amountIdr = isDebit ? line.debitIdr : line.creditIdr;
    if (isDebit) debitTotalIdr += amountIdr;
    else creditTotalIdr += amountIdr;
    if (!isDebit && line.accountCode === ACCOUNT.vendor_payable.code) {
      vendorPayableIdr += amountIdr;
    }

    return {
      id: `preview-${booking.id}-${index + 1}`,
      account_code: line.accountCode,
      account_name: humanizeAccountName(getAccountByCode(line.accountCode).name),
      side: (isDebit ? 'debit' : 'credit') as 'debit' | 'credit',
      amount_idr: idrToJson(amountIdr, 'journal line amount'),
      memo: line.memo ?? ''
    };
  });

  if (debitTotalIdr !== creditTotalIdr) {
    // `buildEntry` already guarantees this; the guard keeps the preview honest
    // if the ledger scenario ever changes.
    throw new AppError('INTERNAL_ERROR', 'release journal is not balanced');
  }

  return {
    draft,
    journal: {
      booking_id: booking.id,
      booking_code: booking.code,
      lines,
      debit_total_idr: idrToJson(debitTotalIdr, 'debit_total_idr'),
      credit_total_idr: idrToJson(creditTotalIdr, 'credit_total_idr')
    },
    debitTotalIdr,
    creditTotalIdr,
    vendorPayableIdr
  };
}
