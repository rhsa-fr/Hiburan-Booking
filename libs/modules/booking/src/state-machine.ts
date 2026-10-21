/**
 * Booking state machine — three independent axes (TECH-DESIGN §4).
 *
 * Deliberately pure: no NestJS, no database, no ambient clock. Every time
 * decision is derived from `ctx.now` so the same code is testable and the
 * workers can replay a job deterministically.
 *
 * Sources of truth:
 * - §4.2 state definitions and the legal-combination matrix
 * - §4.3 lifecycle transitions L-01…L-22
 * - §4.4 payment transitions P-01…P-09
 * - §4.5 settlement transitions S-01…S-12
 * - §4.9 / D-18 deadline and window rules (via @tarlink/platform/pricing)
 *
 * Rules encoded here:
 * - the slot is blocked (held) at ACCEPT, never at DP payment;
 * - a payment deadline is 24h, or 48h when total_customer_idr >= Rp 10.000.000;
 * - auto-complete is due at scheduled_end_at + 3 days;
 * - the dispute window is anchored to scheduled_end_at + 7 days, not completed_at;
 * - a post-release claim is allowed until released_at + 30 days.
 */
import { AppError } from '../../../../apps/api/src/core/errors';
import type { Role } from '../../../platform/auth/src/index';
import {
  autoCompleteAt,
  clawbackDeadline,
  disputeWindowEndsAt,
  paymentDeadlineFrom
} from '../../../platform/pricing/src/index';

const HOUR_MS = 60 * 60 * 1000;
const RESPOND_DEADLINE_HOURS = 24;
const COUNTER_DEADLINE_HOURS = 24;
const CHECKIN_EARLY_HOURS = 3;
const CHECKIN_LATE_HOURS = 2;
const CUSTOMER_CANCEL_CUTOFF_HOURS = 24;
const NO_SHOW_AFTER_HOURS = 2;

export const LIFECYCLE_STATUSES = [
  'requested',
  'countered',
  'accepted',
  'confirmed',
  'in_progress',
  'completed',
  'cancelled',
  'rejected',
  'expired',
  'no_show'
] as const;
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

export const PAYMENT_STATUSES = [
  'unpaid',
  'dp_paid',
  'fully_paid',
  'partially_refunded',
  'refunded'
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const SETTLEMENT_STATUSES = [
  'not_eligible',
  'held',
  'disputed',
  'released',
  'clawed_back'
] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

export type StatusAxis = 'lifecycle' | 'payment' | 'settlement';

/**
 * The actor of a transition.
 *
 * `Role` mirrors the `user_role` enum of migration 001_core exactly.
 * `system` is NOT a `user_role` value: it marks the automated paths (L-05,
 * L-09, L-14, L-16, L-22, P-*, S-*) and is stored as NULL in
 * `booking_status_history.actor_role`.
 */
export type ActorRole = Role | 'system';

export type BookingAction =
  | 'booking.create'
  | 'booking.counter'
  | 'booking.accept'
  | 'booking.reject'
  | 'booking.expire'
  | 'booking.cancel_by_customer'
  | 'booking.cancel_by_vendor'
  | 'booking.cancel_by_admin'
  | 'booking.counter_accept'
  | 'booking.counter_decline'
  | 'booking.counter_withdraw'
  | 'booking.checkin'
  | 'booking.start_auto'
  | 'booking.no_show'
  | 'booking.complete'
  | 'booking.complete_auto'
  | 'payment.dp_succeeded'
  | 'payment.full_succeeded'
  | 'payment.settlement_succeeded'
  | 'payment.refund_succeeded'
  | 'payment.refund_succeeded_partial'
  | 'payment.refund_succeeded_final'
  | 'settlement.release_auto'
  | 'settlement.release_manual'
  | 'dispute.open'
  | 'dispute.resolved_to_vendor'
  | 'dispute.resolved_refund_full'
  | 'dispute.resolved_refund_partial'
  | 'dispute.open_post_release'
  | 'dispute.resolved_clawback'
  | 'dispute.rejected'
  | 'dispute.rejected_post_release'
  | 'clawback.recovered_full';

export type GuardId =
  | 'respond_deadline_open'
  | 'respond_deadline_passed'
  | 'counter_deadline_open'
  | 'counter_deadline_passed'
  | 'payment_deadline_open'
  | 'payment_deadline_passed'
  | 'slot_blockable'
  | 'scheduled_end_known'
  | 'payment_unpaid'
  | 'payment_received'
  | 'payment_fully_paid'
  | 'checkin_window'
  | 'start_reached'
  | 'cancel_before_cutoff'
  | 'before_start'
  | 'no_show_window'
  | 'end_reached'
  | 'auto_complete_due'
  | 'no_open_dispute'
  | 'dispute_window_open'
  | 'dispute_window_passed'
  | 'within_clawback_window'
  | 'reason_required'
  | 'payout_settled'
  | 'payout_not_settled';

export interface BookingState {
  lifecycle_status: LifecycleStatus;
  payment_status: PaymentStatus;
  settlement_status: SettlementStatus;
  total_customer_idr: bigint;
  respond_deadline: Date | null;
  counter_deadline: Date | null;
  payment_deadline: Date | null;
  scheduled_start_at: Date | null;
  scheduled_end_at: Date | null;
  dispute_window_ends_at: Date | null;
  confirmed_at: Date | null;
  started_at: Date | null;
  checkin_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  no_show_at: Date | null;
  released_at: Date | null;
  hold_expires_at: Date | null;
  started_without_checkin: boolean;
}

export interface TransitionContext {
  actor: ActorRole;
  now?: Date;
  /** false only when the exclusion constraint rejected the reservation. */
  slotBlocked?: boolean;
  /** number of open/investigating/awaiting_evidence disputes for the booking. */
  openDisputes?: number;
  reason?: string | null;
  /** true when a payout for this booking already succeeded (S-06/S-09/S-11). */
  payoutSucceeded?: boolean;
}

export interface StatusChange {
  axis: StatusAxis;
  from: string | null;
  to: string;
}

export interface DerivedFields {
  payment_deadline?: Date;
  hold_expires_at?: Date;
  counter_deadline?: Date;
  dispute_window_ends_at?: Date;
  confirmed_at?: Date;
  started_at?: Date;
  checkin_at?: Date;
  completed_at?: Date;
  cancelled_at?: Date;
  no_show_at?: Date;
  released_at?: Date;
}

export interface TransitionResult {
  transition: { id: string; action: BookingAction };
  next: BookingState;
  changes: StatusChange[];
  derived: DerivedFields;
  /** needs calendar reservation: booking_slots.is_blocking=true + calendar_slots='held'. */
  blockSlots: boolean;
  /** conflicting holds can be turned into booked slots. */
  confirmSlots: boolean;
  /** release calendar_slots held/booked by this booking (idempotent). */
  releaseSlots: boolean;
}

export interface TransitionDef {
  id: string;
  action: BookingAction;
  axis: StatusAxis;
  initial?: boolean;
  from: {
    lifecycle?: readonly LifecycleStatus[];
    payment?: readonly PaymentStatus[];
    settlement?: readonly SettlementStatus[];
  };
  to: {
    lifecycle?: LifecycleStatus;
    payment?: PaymentStatus;
    settlement?: SettlementStatus;
  };
  actors: readonly ActorRole[];
  guards: readonly GuardId[];
}

export const INITIAL_STATE: BookingState = {
  lifecycle_status: 'requested',
  payment_status: 'unpaid',
  settlement_status: 'not_eligible',
  total_customer_idr: 0n,
  respond_deadline: null,
  counter_deadline: null,
  payment_deadline: null,
  scheduled_start_at: null,
  scheduled_end_at: null,
  dispute_window_ends_at: null,
  confirmed_at: null,
  started_at: null,
  checkin_at: null,
  completed_at: null,
  cancelled_at: null,
  no_show_at: null,
  released_at: null,
  hold_expires_at: null,
  started_without_checkin: false
};

export function initialBookingState(overrides: Partial<BookingState> = {}): BookingState {
  return { ...INITIAL_STATE, ...overrides };
}

/** §4.2: lifecycle × payment legality. */
const LEGAL_PAYMENT: Record<LifecycleStatus, readonly PaymentStatus[]> = {
  requested: ['unpaid'],
  countered: ['unpaid'],
  accepted: ['unpaid'],
  confirmed: ['dp_paid', 'fully_paid', 'partially_refunded'],
  in_progress: ['dp_paid', 'fully_paid', 'partially_refunded'],
  completed: ['dp_paid', 'fully_paid', 'partially_refunded', 'refunded'],
  cancelled: ['unpaid', 'dp_paid', 'fully_paid', 'partially_refunded', 'refunded'],
  rejected: ['unpaid'],
  expired: ['unpaid', 'dp_paid'],
  no_show: ['dp_paid', 'fully_paid', 'partially_refunded', 'refunded']
};

/**
 * §4.2 + §4.6 settlement constraints per (lifecycle, payment) pair.
 *
 * This matrix mirrors the DB trigger `assert_booking_combination`
 * (db/migrations/001_core.sql) EXACTLY, so the pure state machine and the
 * database never disagree about a legal combination:
 *
 * - `released`      -> lifecycle='completed' AND payment IN (fully_paid, partially_refunded)
 * - `clawed_back`   -> lifecycle IN (completed, no_show)
 *                      AND payment IN (fully_paid, partially_refunded, refunded)
 * - `not_eligible`  -> payment='unpaid'
 *                      OR (lifecycle IN (cancelled, rejected, expired, no_show)
 *                          AND payment IN (partially_refunded, refunded))
 *                      OR (lifecycle='completed'
 *                          AND payment IN (partially_refunded, refunded))
 * - `held`/`disputed` -> payment IN (dp_paid, fully_paid, partially_refunded)
 *                      AND lifecycle IN (confirmed, in_progress, completed,
 *                                        no_show, cancelled, expired)
 */
const LEGAL_SETTLEMENT: Record<LifecycleStatus, Partial<Record<PaymentStatus, readonly SettlementStatus[]>>> = {
  requested: { unpaid: ['not_eligible'] },
  countered: { unpaid: ['not_eligible'] },
  accepted: { unpaid: ['not_eligible'] },
  confirmed: {
    dp_paid: ['held', 'disputed'],
    fully_paid: ['held', 'disputed'],
    partially_refunded: ['held', 'disputed']
  },
  in_progress: {
    dp_paid: ['held', 'disputed'],
    fully_paid: ['held', 'disputed'],
    partially_refunded: ['held', 'disputed']
  },
  completed: {
    dp_paid: ['held', 'disputed'],
    fully_paid: ['held', 'disputed', 'released', 'clawed_back'],
    partially_refunded: ['held', 'disputed', 'released', 'clawed_back', 'not_eligible'],
    refunded: ['not_eligible', 'clawed_back']
  },
  cancelled: {
    unpaid: ['not_eligible'],
    dp_paid: ['held', 'disputed'],
    fully_paid: ['held', 'disputed'],
    partially_refunded: ['not_eligible', 'held', 'disputed'],
    refunded: ['not_eligible']
  },
  rejected: { unpaid: ['not_eligible'] },
  expired: {
    unpaid: ['not_eligible'],
    dp_paid: ['held', 'disputed']
  },
  no_show: {
    dp_paid: ['held', 'disputed'],
    fully_paid: ['held', 'disputed', 'clawed_back'],
    partially_refunded: ['not_eligible', 'held', 'disputed', 'clawed_back'],
    refunded: ['not_eligible', 'clawed_back']
  }
};

export function legalSettlementsFor(
  lifecycle: LifecycleStatus,
  payment: PaymentStatus
): readonly SettlementStatus[] {
  return LEGAL_SETTLEMENT[lifecycle][payment] ?? [];
}

export function isLegalCombination(
  lifecycle: LifecycleStatus,
  payment: PaymentStatus,
  settlement: SettlementStatus
): boolean {
  if (!LEGAL_PAYMENT[lifecycle].includes(payment)) return false;
  return legalSettlementsFor(lifecycle, payment).includes(settlement);
}

/** Throws CONFLICT when the three axes describe a state §4.2 forbids. */
export function assertLegalCombination(
  state: Pick<BookingState, 'lifecycle_status' | 'payment_status' | 'settlement_status'>
): void {
  const { lifecycle_status, payment_status, settlement_status } = state;
  const combination = `${lifecycle_status}/${payment_status}/${settlement_status}`;

  const payments = LEGAL_PAYMENT[lifecycle_status];
  if (!payments) {
    throw new AppError('CONFLICT', `lifecycle_status tidak dikenal: ${String(lifecycle_status)}`, {
      combination
    });
  }
  if (!payments.includes(payment_status)) {
    throw new AppError('CONFLICT', `Kombinasi status tidak sah: ${combination}`, {
      combination,
      reason: 'lifecycle_payment'
    });
  }
  if (!legalSettlementsFor(lifecycle_status, payment_status).includes(settlement_status)) {
    throw new AppError('CONFLICT', `Kombinasi status tidak sah: ${combination}`, {
      combination,
      reason: 'payment_settlement'
    });
  }
}

export function isTerminalLifecycle(status: LifecycleStatus): boolean {
  return status === 'cancelled' || status === 'rejected' || status === 'expired' || status === 'no_show';
}

const OWNER_OR_MEMBER: readonly ActorRole[] = ['vendor_owner', 'vendor_member'];
const ADMIN: readonly ActorRole[] = ['admin_support', 'admin_finance', 'admin_super'];
const FINANCE_MAKER_CHECKER: readonly ActorRole[] = ['admin_finance', 'admin_super'];

/**
 * L-01…L-22 are the lifecycle transitions promised by the packet. Payment and
 * settlement rows are included because a lifecycle change that touches another
 * axis must be expressible as one atomic result (§4.1: one history row per axis).
 *
 * L-23/L-24/L-25 are intentionally out of scope for this packet (L-24 is not a
 * lifecycle transition; L-25 is a system-only cleanup path).
 */
export const TRANSITIONS: readonly TransitionDef[] = [
  // ------------------------------------------------------------------ lifecycle
  {
    id: 'L-01',
    action: 'booking.create',
    axis: 'lifecycle',
    initial: true,
    from: {},
    to: { lifecycle: 'requested', payment: 'unpaid', settlement: 'not_eligible' },
    actors: ['customer'],
    guards: []
  },
  {
    id: 'L-02',
    action: 'booking.counter',
    axis: 'lifecycle',
    from: { lifecycle: ['requested'] },
    to: { lifecycle: 'countered' },
    actors: OWNER_OR_MEMBER,
    guards: ['respond_deadline_open']
  },
  {
    id: 'L-03',
    action: 'booking.accept',
    axis: 'lifecycle',
    from: { lifecycle: ['requested'] },
    to: { lifecycle: 'accepted' },
    actors: OWNER_OR_MEMBER,
    guards: ['respond_deadline_open', 'slot_blockable']
  },
  {
    id: 'L-04',
    action: 'booking.reject',
    axis: 'lifecycle',
    from: { lifecycle: ['requested'] },
    to: { lifecycle: 'rejected' },
    actors: OWNER_OR_MEMBER,
    guards: ['reason_required']
  },
  {
    id: 'L-05',
    action: 'booking.expire',
    axis: 'lifecycle',
    from: { lifecycle: ['requested'] },
    to: { lifecycle: 'expired' },
    actors: ['system'],
    guards: ['respond_deadline_passed']
  },
  {
    id: 'L-06',
    action: 'booking.cancel_by_customer',
    axis: 'lifecycle',
    from: { lifecycle: ['requested'] },
    to: { lifecycle: 'cancelled' },
    actors: ['customer'],
    guards: ['respond_deadline_open']
  },
  {
    id: 'L-07',
    action: 'booking.counter_accept',
    axis: 'lifecycle',
    from: { lifecycle: ['countered'] },
    to: { lifecycle: 'accepted' },
    actors: ['customer'],
    guards: ['counter_deadline_open', 'slot_blockable']
  },
  {
    id: 'L-08',
    action: 'booking.counter_decline',
    axis: 'lifecycle',
    from: { lifecycle: ['countered'] },
    to: { lifecycle: 'rejected' },
    actors: ['customer'],
    guards: []
  },
  {
    id: 'L-09',
    action: 'booking.expire',
    axis: 'lifecycle',
    from: { lifecycle: ['countered'] },
    to: { lifecycle: 'expired' },
    actors: ['system'],
    guards: ['counter_deadline_passed']
  },
  {
    id: 'L-10',
    action: 'booking.counter_withdraw',
    axis: 'lifecycle',
    from: { lifecycle: ['countered'] },
    to: { lifecycle: 'cancelled' },
    actors: ['vendor_owner'],
    guards: []
  },
  {
    id: 'L-11',
    action: 'payment.dp_succeeded',
    axis: 'lifecycle',
    from: { lifecycle: ['accepted'], payment: ['unpaid'], settlement: ['not_eligible'] },
    to: { lifecycle: 'confirmed', payment: 'dp_paid', settlement: 'held' },
    actors: ['system'],
    guards: ['scheduled_end_known']
  },
  {
    id: 'L-12',
    action: 'booking.cancel_by_customer',
    axis: 'lifecycle',
    from: { lifecycle: ['accepted'] },
    to: { lifecycle: 'cancelled' },
    actors: ['customer'],
    guards: ['payment_unpaid']
  },
  {
    id: 'L-13',
    action: 'booking.cancel_by_vendor',
    axis: 'lifecycle',
    from: { lifecycle: ['accepted'] },
    to: { lifecycle: 'cancelled' },
    actors: ['vendor_owner'],
    guards: ['payment_unpaid']
  },
  {
    id: 'L-14',
    action: 'booking.expire',
    axis: 'lifecycle',
    from: { lifecycle: ['accepted'] },
    to: { lifecycle: 'expired' },
    actors: ['system'],
    guards: ['payment_deadline_passed']
  },
  {
    id: 'L-15',
    action: 'booking.checkin',
    axis: 'lifecycle',
    from: { lifecycle: ['confirmed'] },
    to: { lifecycle: 'in_progress' },
    actors: OWNER_OR_MEMBER,
    guards: ['checkin_window', 'payment_received']
  },
  {
    id: 'L-16',
    action: 'booking.start_auto',
    axis: 'lifecycle',
    from: { lifecycle: ['confirmed'] },
    to: { lifecycle: 'in_progress' },
    actors: ['system'],
    guards: ['start_reached']
  },
  {
    id: 'L-17',
    action: 'booking.cancel_by_customer',
    axis: 'lifecycle',
    from: { lifecycle: ['confirmed'] },
    to: { lifecycle: 'cancelled' },
    actors: ['customer'],
    guards: ['cancel_before_cutoff', 'no_open_dispute']
  },
  {
    id: 'L-18',
    action: 'booking.cancel_by_vendor',
    axis: 'lifecycle',
    from: { lifecycle: ['confirmed'] },
    to: { lifecycle: 'cancelled' },
    actors: ['vendor_owner'],
    guards: ['before_start', 'no_open_dispute']
  },
  {
    id: 'L-19',
    action: 'booking.cancel_by_admin',
    axis: 'lifecycle',
    from: { lifecycle: ['confirmed'] },
    to: { lifecycle: 'cancelled' },
    actors: ['admin_support', 'admin_super'],
    guards: ['reason_required', 'no_open_dispute']
  },
  {
    id: 'L-20',
    action: 'booking.no_show',
    axis: 'lifecycle',
    from: { lifecycle: ['confirmed'], settlement: ['held'] },
    to: { lifecycle: 'no_show', settlement: 'disputed' },
    actors: ['customer', 'admin_support'],
    guards: ['no_show_window', 'no_open_dispute']
  },
  {
    id: 'L-21',
    action: 'booking.complete',
    axis: 'lifecycle',
    from: { lifecycle: ['in_progress'] },
    to: { lifecycle: 'completed' },
    actors: ['customer'],
    guards: ['end_reached', 'no_open_dispute']
  },
  {
    id: 'L-22',
    action: 'booking.complete_auto',
    axis: 'lifecycle',
    from: { lifecycle: ['confirmed', 'in_progress'] },
    to: { lifecycle: 'completed' },
    actors: ['system'],
    guards: ['scheduled_end_known', 'auto_complete_due', 'no_open_dispute']
  },

  // -------------------------------------------------------------------- payment
  // P-01 is L-11 above: the doc names the same event on both axes.
  {
    id: 'P-02',
    action: 'payment.full_succeeded',
    axis: 'payment',
    from: { lifecycle: ['accepted', 'confirmed'], payment: ['unpaid'] },
    to: { lifecycle: 'confirmed', payment: 'fully_paid', settlement: 'held' },
    actors: ['system'],
    guards: ['scheduled_end_known']
  },
  {
    id: 'P-03',
    action: 'payment.settlement_succeeded',
    axis: 'payment',
    from: { payment: ['dp_paid'] },
    to: { payment: 'fully_paid' },
    actors: ['system'],
    guards: []
  },
  {
    id: 'P-04',
    action: 'payment.refund_succeeded',
    axis: 'payment',
    from: {
      lifecycle: ['cancelled', 'rejected', 'expired', 'no_show', 'completed'],
      payment: ['dp_paid', 'fully_paid'],
      settlement: ['held', 'disputed']
    },
    to: { payment: 'refunded', settlement: 'not_eligible' },
    actors: ['system'],
    guards: []
  },
  {
    id: 'P-06',
    action: 'payment.refund_succeeded_partial',
    axis: 'payment',
    from: { payment: ['dp_paid', 'fully_paid'] },
    to: { payment: 'partially_refunded' },
    actors: ['system'],
    guards: []
  },
  {
    id: 'P-08',
    action: 'payment.refund_succeeded_partial',
    axis: 'payment',
    from: { payment: ['partially_refunded'] },
    to: { payment: 'partially_refunded' },
    actors: ['system'],
    guards: []
  },
  {
    id: 'P-09',
    action: 'payment.refund_succeeded_final',
    axis: 'payment',
    from: {
      lifecycle: ['cancelled', 'rejected', 'expired', 'no_show', 'completed'],
      payment: ['partially_refunded'],
      settlement: ['held', 'disputed']
    },
    to: { payment: 'refunded', settlement: 'not_eligible' },
    actors: ['system'],
    guards: []
  },

  // ----------------------------------------------------------------- settlement
  {
    id: 'S-02',
    action: 'settlement.release_auto',
    axis: 'settlement',
    from: { lifecycle: ['completed'], payment: ['fully_paid'], settlement: ['held'] },
    to: { settlement: 'released' },
    actors: ['system'],
    guards: ['no_open_dispute', 'dispute_window_passed']
  },
  {
    id: 'S-03',
    action: 'settlement.release_manual',
    axis: 'settlement',
    from: { lifecycle: ['completed'], payment: ['fully_paid'], settlement: ['held'] },
    to: { settlement: 'released' },
    actors: FINANCE_MAKER_CHECKER,
    guards: ['no_open_dispute', 'reason_required', 'payment_fully_paid']
  },
  {
    id: 'S-04',
    action: 'dispute.open',
    axis: 'settlement',
    from: {
      lifecycle: ['confirmed', 'in_progress', 'completed', 'no_show'],
      settlement: ['held']
    },
    to: { settlement: 'disputed' },
    actors: ['customer', 'vendor_owner', 'admin_support'],
    guards: ['dispute_window_open', 'reason_required']
  },
  {
    id: 'S-06',
    action: 'dispute.resolved_to_vendor',
    axis: 'settlement',
    from: {
      lifecycle: ['completed'],
      payment: ['fully_paid', 'partially_refunded'],
      settlement: ['disputed']
    },
    to: { settlement: 'released' },
    actors: FINANCE_MAKER_CHECKER,
    guards: ['payout_not_settled', 'reason_required']
  },
  {
    id: 'S-07a',
    action: 'dispute.resolved_refund_full',
    axis: 'settlement',
    from: { lifecycle: ['completed', 'no_show'], settlement: ['disputed'] },
    to: { payment: 'refunded', settlement: 'not_eligible' },
    actors: FINANCE_MAKER_CHECKER,
    guards: ['payout_not_settled', 'reason_required']
  },
  {
    id: 'S-07b',
    action: 'dispute.resolved_refund_partial',
    axis: 'settlement',
    from: { lifecycle: ['completed', 'no_show'], settlement: ['disputed'] },
    to: { payment: 'partially_refunded', settlement: 'not_eligible' },
    actors: FINANCE_MAKER_CHECKER,
    guards: ['payout_not_settled', 'reason_required']
  },
  {
    id: 'S-08',
    action: 'dispute.open_post_release',
    axis: 'settlement',
    from: { lifecycle: ['completed', 'no_show'], settlement: ['released'] },
    to: { settlement: 'disputed' },
    actors: ['customer', 'admin_support'],
    guards: ['within_clawback_window', 'reason_required']
  },
  {
    id: 'S-09',
    action: 'dispute.resolved_clawback',
    axis: 'settlement',
    from: {
      lifecycle: ['completed', 'no_show'],
      payment: ['fully_paid', 'partially_refunded'],
      settlement: ['disputed']
    },
    to: { settlement: 'clawed_back' },
    actors: FINANCE_MAKER_CHECKER,
    guards: ['payout_settled', 'reason_required']
  },
  {
    id: 'S-10',
    action: 'dispute.rejected',
    axis: 'settlement',
    from: {
      lifecycle: ['confirmed', 'in_progress', 'completed'],
      payment: ['dp_paid', 'fully_paid', 'partially_refunded'],
      settlement: ['disputed']
    },
    to: { settlement: 'held' },
    actors: FINANCE_MAKER_CHECKER,
    guards: ['payout_not_settled', 'reason_required']
  },
  {
    id: 'S-11',
    action: 'dispute.rejected_post_release',
    axis: 'settlement',
    from: {
      lifecycle: ['completed', 'no_show'],
      payment: ['fully_paid', 'partially_refunded'],
      settlement: ['disputed']
    },
    to: { settlement: 'released' },
    actors: FINANCE_MAKER_CHECKER,
    guards: ['payout_settled', 'reason_required']
  },
  {
    id: 'S-12',
    action: 'clawback.recovered_full',
    axis: 'settlement',
    from: { settlement: ['clawed_back'] },
    to: { settlement: 'clawed_back' },
    actors: ['system'],
    guards: []
  }
];

function conflict(action: string, reason: string): AppError {
  return new AppError('CONFLICT', `Transisi '${action}' tidak sah: ${reason}`, { action, reason });
}

function matchesFrom(def: TransitionDef, state: BookingState): boolean {
  if (def.initial) return true;
  const { lifecycle, payment, settlement } = def.from;
  if (lifecycle && !lifecycle.includes(state.lifecycle_status)) return false;
  if (payment && !payment.includes(state.payment_status)) return false;
  if (settlement && !settlement.includes(state.settlement_status)) return false;
  return true;
}

function disputeWindowFor(state: BookingState): Date | null {
  if (state.dispute_window_ends_at) return state.dispute_window_ends_at;
  if (state.scheduled_end_at) return disputeWindowEndsAt(state.scheduled_end_at);
  return null;
}

function guardPasses(
  guard: GuardId,
  state: BookingState,
  ctx: TransitionContext,
  now: Date
): boolean {
  const nowMs = now.getTime();
  switch (guard) {
    case 'respond_deadline_open':
      return !state.respond_deadline || nowMs <= state.respond_deadline.getTime();
    case 'respond_deadline_passed':
      return !!state.respond_deadline && nowMs > state.respond_deadline.getTime();
    case 'counter_deadline_open':
      return !state.counter_deadline || nowMs <= state.counter_deadline.getTime();
    case 'counter_deadline_passed':
      return !!state.counter_deadline && nowMs > state.counter_deadline.getTime();
    case 'payment_deadline_open':
      return !state.payment_deadline || nowMs <= state.payment_deadline.getTime();
    case 'payment_deadline_passed':
      return !!state.payment_deadline && nowMs > state.payment_deadline.getTime();
    case 'slot_blockable':
      return ctx.slotBlocked !== false;
    case 'scheduled_end_known':
      return state.scheduled_end_at !== null;
    case 'payment_unpaid':
      return state.payment_status === 'unpaid';
    case 'payment_received':
      return state.payment_status === 'dp_paid' || state.payment_status === 'fully_paid';
    case 'payment_fully_paid':
      return state.payment_status === 'fully_paid';
    case 'checkin_window': {
      if (!state.scheduled_start_at) return false;
      const start = state.scheduled_start_at.getTime();
      return (
        nowMs >= start - CHECKIN_EARLY_HOURS * HOUR_MS &&
        nowMs <= start + CHECKIN_LATE_HOURS * HOUR_MS
      );
    }
    case 'start_reached':
      return !!state.scheduled_start_at && nowMs >= state.scheduled_start_at.getTime();
    case 'cancel_before_cutoff':
      return (
        !!state.scheduled_start_at &&
        nowMs < state.scheduled_start_at.getTime() - CUSTOMER_CANCEL_CUTOFF_HOURS * HOUR_MS
      );
    case 'before_start':
      return !!state.scheduled_start_at && nowMs < state.scheduled_start_at.getTime();
    case 'no_show_window':
      return (
        !!state.scheduled_start_at &&
        nowMs > state.scheduled_start_at.getTime() + NO_SHOW_AFTER_HOURS * HOUR_MS
      );
    case 'end_reached':
      return !!state.scheduled_end_at && nowMs >= state.scheduled_end_at.getTime();
    case 'auto_complete_due':
      return !!state.scheduled_end_at && nowMs >= autoCompleteAt(state.scheduled_end_at).getTime();
    case 'no_open_dispute':
      return (ctx.openDisputes ?? 0) === 0;
    case 'dispute_window_open': {
      const window = disputeWindowFor(state);
      return !!window && nowMs <= window.getTime();
    }
    case 'dispute_window_passed': {
      const window = disputeWindowFor(state);
      return !!window && nowMs > window.getTime();
    }
    case 'within_clawback_window':
      return !!state.released_at && nowMs <= clawbackDeadline(state.released_at).getTime();
    case 'reason_required':
      return typeof ctx.reason === 'string' && ctx.reason.trim().length > 0;
    case 'payout_settled':
      return ctx.payoutSucceeded === true;
    case 'payout_not_settled':
      return ctx.payoutSucceeded !== true;
    default: {
      const exhaustive: never = guard;
      return exhaustive;
    }
  }
}

/** Structural legality: right action for the state and the actor. */
export function canTransition(
  current: BookingState,
  action: BookingAction,
  actor: ActorRole
): boolean {
  return TRANSITIONS.some(
    (def) => def.action === action && def.actors.includes(actor) && matchesFrom(def, current)
  );
}

export function transitionsFor(action: BookingAction): readonly TransitionDef[] {
  return TRANSITIONS.filter((def) => def.action === action);
}

/**
 * Applies one action to the booking state.
 *
 * Throws CONFLICT (naming the action) when the action is unknown, the actor is
 * not permitted, the current state is not a source state, a guard fails, or the
 * resulting three-axis combination is illegal.
 */
export function applyTransition(
  current: BookingState,
  action: BookingAction,
  ctx: TransitionContext
): TransitionResult {
  const now = ctx.now ?? new Date();
  const candidates = transitionsFor(action);
  if (candidates.length === 0) {
    throw conflict(action, 'aksi tidak dikenal');
  }

  const actorCandidates = candidates.filter((def) => def.actors.includes(ctx.actor));
  if (actorCandidates.length === 0) {
    throw conflict(action, `aktor '${ctx.actor}' tidak berwenang`);
  }

  const matched = actorCandidates.filter((def) => matchesFrom(def, current));
  if (matched.length === 0) {
    throw conflict(
      action,
      `state saat ini ${current.lifecycle_status}/${current.payment_status}/${current.settlement_status} bukan state asal`
    );
  }

  let chosen: TransitionDef | null = null;
  let failedGuard: GuardId | null = null;
  for (const def of matched) {
    const failing = def.guards.find((guard) => !guardPasses(guard, current, ctx, now));
    if (!failing) {
      chosen = def;
      break;
    }
    failedGuard = failedGuard ?? failing;
  }
  if (!chosen) {
    throw conflict(action, `guard '${String(failedGuard)}' tidak terpenuhi`);
  }

  const next: BookingState = { ...current };

  if (chosen.initial) {
    next.lifecycle_status = 'requested';
    next.payment_status = 'unpaid';
    next.settlement_status = 'not_eligible';
  }
  if (chosen.to.lifecycle) next.lifecycle_status = chosen.to.lifecycle;
  if (chosen.to.payment) next.payment_status = chosen.to.payment;
  if (chosen.to.settlement) next.settlement_status = chosen.to.settlement;

  const derived: DerivedFields = {};

  switch (chosen.action) {
    case 'booking.counter': {
      const deadline = new Date(now.getTime() + COUNTER_DEADLINE_HOURS * HOUR_MS);
      next.counter_deadline = deadline;
      derived.counter_deadline = deadline;
      break;
    }
    case 'booking.accept':
    case 'booking.counter_accept': {
      // D-18: 24h, or 48h when total_customer_idr >= Rp 10.000.000.
      const deadline = paymentDeadlineFrom(now, current.total_customer_idr);
      next.payment_deadline = deadline;
      next.hold_expires_at = deadline;
      derived.payment_deadline = deadline;
      derived.hold_expires_at = deadline;
      break;
    }
    case 'payment.dp_succeeded':
    case 'payment.full_succeeded': {
      if (!next.confirmed_at) next.confirmed_at = now;
      derived.confirmed_at = next.confirmed_at;
      if (next.scheduled_end_at) {
        const windowEnd = disputeWindowEndsAt(next.scheduled_end_at);
        next.dispute_window_ends_at = windowEnd;
        derived.dispute_window_ends_at = windowEnd;
      }
      break;
    }
    case 'booking.checkin': {
      next.checkin_at = now;
      next.started_at = now;
      derived.checkin_at = now;
      derived.started_at = now;
      break;
    }
    case 'booking.start_auto': {
      next.started_at = now;
      next.started_without_checkin = true;
      derived.started_at = now;
      break;
    }
    case 'booking.complete':
    case 'booking.complete_auto': {
      next.completed_at = now;
      derived.completed_at = now;
      if (next.scheduled_end_at) {
        // Anchored to the end of the event, never to completed_at (§4.9).
        const windowEnd = disputeWindowEndsAt(next.scheduled_end_at);
        next.dispute_window_ends_at = windowEnd;
        derived.dispute_window_ends_at = windowEnd;
      }
      if (chosen.action === 'booking.complete_auto' && next.started_at === null) {
        next.started_without_checkin = true;
      }
      break;
    }
    case 'booking.cancel_by_customer':
    case 'booking.cancel_by_vendor':
    case 'booking.cancel_by_admin':
    case 'booking.counter_withdraw': {
      next.cancelled_at = now;
      derived.cancelled_at = now;
      break;
    }
    case 'booking.no_show': {
      next.no_show_at = now;
      derived.no_show_at = now;
      break;
    }
    case 'settlement.release_auto':
    case 'settlement.release_manual':
    case 'dispute.resolved_to_vendor':
    case 'dispute.rejected_post_release': {
      next.released_at = now;
      derived.released_at = now;
      break;
    }
    default:
      break;
  }

  assertLegalCombination(next);

  const changes: StatusChange[] = [];
  if (chosen.initial) {
    changes.push({ axis: 'lifecycle', from: null, to: next.lifecycle_status });
    changes.push({ axis: 'payment', from: null, to: next.payment_status });
    changes.push({ axis: 'settlement', from: null, to: next.settlement_status });
  } else {
    if (next.lifecycle_status !== current.lifecycle_status) {
      changes.push({
        axis: 'lifecycle',
        from: current.lifecycle_status,
        to: next.lifecycle_status
      });
    }
    if (next.payment_status !== current.payment_status) {
      changes.push({ axis: 'payment', from: current.payment_status, to: next.payment_status });
    }
    if (next.settlement_status !== current.settlement_status) {
      changes.push({
        axis: 'settlement',
        from: current.settlement_status,
        to: next.settlement_status
      });
    }
  }

  const blockSlots =
    chosen.action === 'booking.accept' || chosen.action === 'booking.counter_accept';
  const confirmSlots =
    chosen.action === 'payment.dp_succeeded' || chosen.action === 'payment.full_succeeded';
  const releaseSlots =
    chosen.action === 'booking.reject' ||
    chosen.action === 'booking.expire' ||
    chosen.action === 'booking.counter_decline' ||
    chosen.action === 'booking.counter_withdraw' ||
    chosen.action === 'booking.cancel_by_customer' ||
    chosen.action === 'booking.cancel_by_vendor' ||
    chosen.action === 'booking.cancel_by_admin';

  return {
    transition: { id: chosen.id, action: chosen.action },
    next,
    changes,
    derived,
    blockSlots,
    confirmSlots,
    releaseSlots
  };
}

/** D-18 helper used by the service to seed payment_deadline before persisting. */
export function acceptDeadline(now: Date, totalCustomerIdr: bigint): Date {
  return paymentDeadlineFrom(now, totalCustomerIdr);
}

export { RESPOND_DEADLINE_HOURS };
