/**
 * Pure time/state decisions for the worker jobs.
 *
 * Kept free of SQL and of the ambient clock so the jobs and the tests make the
 * same decision from the same `now`. Window arithmetic lives in
 * `libs/platform/pricing` (auto-complete due at `scheduled_end_at + 3 days`,
 * FR-118 / L-22; clawback claim window) so the API and the worker can never
 * disagree. The pre-release dispute window (`scheduled_end_at + 7 days`) is
 * persisted with SQL arithmetic on the row, which keeps it exact to the
 * microsecond and impossible to anchor to `now()` or `completed_at` (§4.9).
 */
import { autoCompleteAt, clawbackDeadline } from '../../../../libs/platform/pricing/src/index';

const OPEN_DISPUTE_STATUSES = ['open', 'investigating', 'awaiting_evidence'] as const;

export interface AutoCompleteCandidate {
  lifecycle_status: string;
  payment_status: string;
  scheduled_end_at: Date | null;
  has_open_dispute: boolean;
}

/**
 * L-22: confirmed|in_progress + scheduled_end_at + 3 days + no open dispute,
 * and the money settled. Completing a `dp_paid` booking would strand it: the
 * release path requires fully paid, so a DP-only booking would sit `completed`
 * and unpayable forever. A refunded-but-once-paid booking may complete (the
 * service already happened).
 */
export function shouldAutoComplete(candidate: AutoCompleteCandidate, now: Date): boolean {
  if (candidate.lifecycle_status !== 'confirmed' && candidate.lifecycle_status !== 'in_progress') {
    return false;
  }
  if (candidate.payment_status !== 'fully_paid' && candidate.payment_status !== 'partially_refunded') {
    return false;
  }
  if (!candidate.scheduled_end_at) return false;
  if (candidate.has_open_dispute) return false;
  return now.getTime() >= autoCompleteAt(candidate.scheduled_end_at).getTime();
}

/** FR-122: claim window that opens after an automatic release. */
export function clawbackDeadlineFor(releasedAt: Date): Date {
  return clawbackDeadline(releasedAt);
}

export interface ExpireUnpaidCandidate {
  lifecycle_status: string;
  payment_status: string;
  payment_deadline: Date | null;
  has_paid_dp: boolean;
}

/** L-14: accepted, payment_deadline passed, and no successful DP. */
export function shouldExpireUnpaid(candidate: ExpireUnpaidCandidate, now: Date): boolean {
  if (candidate.lifecycle_status !== 'accepted') return false;
  if (candidate.payment_status !== 'unpaid') return false;
  if (candidate.has_paid_dp) return false;
  if (!candidate.payment_deadline) return false;
  return now.getTime() > candidate.payment_deadline.getTime();
}

export interface AutoReleaseCandidate {
  lifecycle_status: string;
  payment_status: string;
  settlement_status: string;
  dispute_window_ends_at: Date | null;
  vendor_entitlement_idr: bigint | null;
}

export type AutoReleaseSkipReason =
  | 'lifecycle_not_completed'
  | 'settlement_not_held'
  | 'payment_not_fully_paid'
  | 'open_dispute'
  | 'already_released'
  | 'dispute_window_missing'
  | 'dispute_window_open'
  | 'missing_vendor_entitlement'
  | 'non_positive_vendor_entitlement';

/**
 * S-02: completed + held + dispute window passed + no open dispute + no release
 * already posted + releasable money. Returns the reason a row must be left
 * alone (logged as `skipped_reason`), or null when it is safe to move money.
 */
export function autoReleaseSkipReason(
  candidate: AutoReleaseCandidate,
  now: Date,
  hasOpenDispute: boolean,
  hasReleaseEntry: boolean
): AutoReleaseSkipReason | null {
  if (candidate.lifecycle_status !== 'completed') return 'lifecycle_not_completed';
  if (candidate.settlement_status !== 'held') return 'settlement_not_held';
  // The DB trigger only allows settlement=released for fully_paid/partially_refunded.
  if (candidate.payment_status !== 'fully_paid' && candidate.payment_status !== 'partially_refunded') {
    return 'payment_not_fully_paid';
  }
  if (hasOpenDispute) return 'open_dispute';
  if (hasReleaseEntry) return 'already_released';
  if (!candidate.dispute_window_ends_at) return 'dispute_window_missing';
  if (now.getTime() <= candidate.dispute_window_ends_at.getTime()) return 'dispute_window_open';
  if (candidate.vendor_entitlement_idr === null) return 'missing_vendor_entitlement';
  if (candidate.vendor_entitlement_idr <= 0n) return 'non_positive_vendor_entitlement';
  return null;
}

export function shouldAutoRelease(
  candidate: AutoReleaseCandidate,
  now: Date,
  hasOpenDispute: boolean,
  hasReleaseEntry: boolean
): boolean {
  return autoReleaseSkipReason(candidate, now, hasOpenDispute, hasReleaseEntry) === null;
}

export interface HoldCandidate {
  status: string;
  hold_expires_at: Date | null;
  booking_lifecycle_status: string | null;
}

/**
 * Stale hold: the hold TTL passed while the booking never reached `confirmed`.
 * `booked` slots and confirmed bookings are never touched. Rows without an
 * expiry are left to `expire_unpaid` (D-18 / 002_fixes F22).
 */
export function shouldExpireHold(slot: HoldCandidate, now: Date): boolean {
  if (slot.status !== 'held') return false;
  if (!slot.hold_expires_at) return false;
  if (slot.booking_lifecycle_status === 'confirmed') return false;
  return slot.hold_expires_at.getTime() < now.getTime();
}

/** SQL fragment shared by every "open dispute" guard. */
export const OPEN_DISPUTE_SQL = OPEN_DISPUTE_STATUSES.map((status) => `'${status}'`).join(',');
