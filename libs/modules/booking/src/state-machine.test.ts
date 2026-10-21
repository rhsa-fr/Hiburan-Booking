import { describe, expect, it } from 'vitest';
import { AppError } from '../../../../apps/api/src/core/errors';
import {
  assertLegalCombination,
  applyTransition,
  canTransition,
  initialBookingState,
  isLegalCombination,
  legalSettlementsFor,
  TRANSITIONS,
  type ActorRole,
  type BookingAction,
  type BookingState,
  type LifecycleStatus,
  type PaymentStatus,
  type SettlementStatus,
  type TransitionContext,
  type TransitionDef
} from './state-machine';

const NOW = new Date('2026-10-21T10:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function expectConflict(fn: () => unknown, action?: string): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    const appError = err as AppError;
    expect(appError.code).toBe('CONFLICT');
    if (action) expect(appError.message).toContain(action);
    return;
  }
  throw new Error('expected AppError(CONFLICT) but nothing was thrown');
}

function inferLifecycle(def: TransitionDef): LifecycleStatus {
  if (def.initial) return 'requested';
  if (def.from.lifecycle) return def.from.lifecycle[0] as LifecycleStatus;
  if (def.action === 'payment.settlement_succeeded') return 'confirmed';
  return 'completed';
}

function inferPayment(def: TransitionDef, lifecycle: LifecycleStatus): PaymentStatus {
  if (def.from.payment) return def.from.payment[0] as PaymentStatus;
  if (def.action === 'payment.refund_succeeded_final') return 'partially_refunded';
  if (lifecycle === 'requested' || lifecycle === 'countered' || lifecycle === 'accepted') {
    return 'unpaid';
  }
  return 'fully_paid';
}

function inferSettlement(
  def: TransitionDef,
  lifecycle: LifecycleStatus,
  payment: PaymentStatus
): SettlementStatus {
  if (def.from.settlement) return def.from.settlement[0] as SettlementStatus;
  return legalSettlementsFor(lifecycle, payment)[0] ?? 'not_eligible';
}

/** Builds the smallest state that satisfies the transition's from-clause. */
function fixtureFor(def: TransitionDef): BookingState {
  if (def.initial) return initialBookingState({ total_customer_idr: 4_025_000n });
  const guards = new Set(def.guards);
  const lifecycle = inferLifecycle(def);
  const payment = inferPayment(def, lifecycle);
  const settlement = inferSettlement(def, lifecycle, payment);

  let start: Date;
  if (guards.has('no_show_window')) start = new Date(NOW.getTime() - 3 * HOUR);
  else if (guards.has('checkin_window') || guards.has('start_reached')) {
    start = new Date(NOW.getTime() - 1 * HOUR);
  } else if (guards.has('cancel_before_cutoff') || guards.has('before_start')) {
    start = new Date(NOW.getTime() + 48 * HOUR);
  } else {
    start = new Date(NOW.getTime() - 2 * HOUR);
  }

  let end: Date;
  if (guards.has('auto_complete_due')) end = new Date(NOW.getTime() - 4 * DAY);
  else if (guards.has('dispute_window_passed')) end = new Date(NOW.getTime() - 8 * DAY);
  else if (guards.has('dispute_window_open')) end = new Date(NOW.getTime() - 1 * DAY);
  else if (guards.has('end_reached')) end = new Date(NOW.getTime() - 1 * HOUR);
  else end = new Date(start.getTime() + 2 * HOUR);

  const settlementTouched =
    def.axis === 'settlement' || def.action.startsWith('clawback.') || def.action.startsWith('dispute.');

  return initialBookingState({
    lifecycle_status: lifecycle,
    payment_status: payment,
    settlement_status: settlement,
    total_customer_idr: 4_025_000n,
    respond_deadline: guards.has('respond_deadline_passed')
      ? new Date(NOW.getTime() - HOUR)
      : new Date(NOW.getTime() + HOUR),
    counter_deadline: guards.has('counter_deadline_passed')
      ? new Date(NOW.getTime() - HOUR)
      : new Date(NOW.getTime() + HOUR),
    payment_deadline: guards.has('payment_deadline_passed')
      ? new Date(NOW.getTime() - HOUR)
      : new Date(NOW.getTime() + HOUR),
    scheduled_start_at: start,
    scheduled_end_at: end,
    dispute_window_ends_at:
      guards.has('dispute_window_passed') || guards.has('dispute_window_open')
        ? new Date(end.getTime() + 7 * DAY)
        : null,
    released_at: settlementTouched ? new Date(NOW.getTime() - DAY) : null,
    started_at: null,
    started_without_checkin: false
  });
}

function contextFor(def: TransitionDef): TransitionContext {
  const guards = new Set(def.guards);
  return {
    actor: def.actors[0] as ActorRole,
    now: NOW,
    reason: 'alasan uji',
    openDisputes: 0,
    slotBlocked: true,
    payoutSucceeded: guards.has('payout_settled')
  };
}

function stateAt(overrides: Partial<BookingState>): BookingState {
  return initialBookingState({
    total_customer_idr: 4_025_000n,
    scheduled_start_at: new Date(NOW.getTime() + 48 * HOUR),
    scheduled_end_at: new Date(NOW.getTime() + 50 * HOUR),
    respond_deadline: new Date(NOW.getTime() + HOUR),
    ...overrides
  });
}

describe('legal combination matrix (§4.2)', () => {
  const legalPayment: Record<LifecycleStatus, readonly PaymentStatus[]> = {
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

  const lifecycles = Object.keys(legalPayment) as LifecycleStatus[];
  const payments: PaymentStatus[] = [
    'unpaid',
    'dp_paid',
    'fully_paid',
    'partially_refunded',
    'refunded'
  ];

  for (const lifecycle of lifecycles) {
    for (const payment of payments) {
      const allowed = legalPayment[lifecycle].includes(payment);
      it(`${lifecycle} + ${payment} is ${allowed ? 'legal' : 'illegal'}`, () => {
        const settlement = legalSettlementsFor(lifecycle, payment)[0] ?? 'not_eligible';
        if (allowed) {
          expect(isLegalCombination(lifecycle, payment, settlement)).toBe(true);
          expect(() =>
            assertLegalCombination({
              lifecycle_status: lifecycle,
              payment_status: payment,
              settlement_status: settlement
            })
          ).not.toThrow();
        } else {
          expect(isLegalCombination(lifecycle, payment, settlement)).toBe(false);
          expectConflict(() =>
            assertLegalCombination({
              lifecycle_status: lifecycle,
              payment_status: payment,
              settlement_status: settlement
            })
          );
        }
      });
    }
  }

  it('rejects a settlement that the pair forbids', () => {
    expectConflict(() =>
      assertLegalCombination({
        lifecycle_status: 'completed',
        payment_status: 'fully_paid',
        settlement_status: 'not_eligible'
      })
    );
    expectConflict(() =>
      assertLegalCombination({
        lifecycle_status: 'completed',
        payment_status: 'dp_paid',
        settlement_status: 'released'
      })
    );
    expectConflict(() =>
      assertLegalCombination({
        lifecycle_status: 'requested',
        payment_status: 'unpaid',
        settlement_status: 'held'
      })
    );
    expectConflict(() =>
      assertLegalCombination({
        lifecycle_status: 'cancelled',
        payment_status: 'refunded',
        settlement_status: 'held'
      })
    );
  });
});

describe('the matrix matches the DB trigger assert_booking_combination', () => {
  /**
   * Mirror of the trigger in db/migrations/001_core.sql. The TypeScript
   * matrix must agree with it for EVERY triple, otherwise a booking that the
   * code accepts is rejected by PostgreSQL with 23514 (and vice versa).
   */
  const ALLOWED_PAIRS: ReadonlyArray<readonly [LifecycleStatus, PaymentStatus]> = [
    ['requested', 'unpaid'],
    ['countered', 'unpaid'],
    ['accepted', 'unpaid'],
    ['confirmed', 'dp_paid'],
    ['confirmed', 'fully_paid'],
    ['confirmed', 'partially_refunded'],
    ['in_progress', 'dp_paid'],
    ['in_progress', 'fully_paid'],
    ['in_progress', 'partially_refunded'],
    ['completed', 'dp_paid'],
    ['completed', 'fully_paid'],
    ['completed', 'partially_refunded'],
    ['completed', 'refunded'],
    ['cancelled', 'unpaid'],
    ['cancelled', 'dp_paid'],
    ['cancelled', 'fully_paid'],
    ['cancelled', 'partially_refunded'],
    ['cancelled', 'refunded'],
    ['rejected', 'unpaid'],
    ['expired', 'unpaid'],
    ['expired', 'dp_paid'],
    ['no_show', 'dp_paid'],
    ['no_show', 'fully_paid'],
    ['no_show', 'partially_refunded'],
    ['no_show', 'refunded']
  ];

  const lifecycles: LifecycleStatus[] = [
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
  ];
  const payments: PaymentStatus[] = [
    'unpaid',
    'dp_paid',
    'fully_paid',
    'partially_refunded',
    'refunded'
  ];
  const settlements: SettlementStatus[] = [
    'not_eligible',
    'held',
    'disputed',
    'released',
    'clawed_back'
  ];

  function triggerAllows(
    lifecycle: LifecycleStatus,
    payment: PaymentStatus,
    settlement: SettlementStatus
  ): boolean {
    const pairAllowed = ALLOWED_PAIRS.some(
      ([l, p]) => l === lifecycle && p === payment
    );
    if (!pairAllowed) return false;

    if (settlement === 'released') {
      return (
        lifecycle === 'completed' &&
        (payment === 'fully_paid' || payment === 'partially_refunded')
      );
    }
    if (settlement === 'clawed_back') {
      return (
        (lifecycle === 'completed' || lifecycle === 'no_show') &&
        (payment === 'fully_paid' ||
          payment === 'partially_refunded' ||
          payment === 'refunded')
      );
    }
    if (settlement === 'not_eligible') {
      return (
        payment === 'unpaid' ||
        ((
          lifecycle === 'cancelled' ||
          lifecycle === 'rejected' ||
          lifecycle === 'expired' ||
          lifecycle === 'no_show'
        ) &&
          (payment === 'partially_refunded' || payment === 'refunded')) ||
        (lifecycle === 'completed' &&
          (payment === 'partially_refunded' || payment === 'refunded'))
      );
    }
    // held / disputed
    return (
      (payment === 'dp_paid' ||
        payment === 'fully_paid' ||
        payment === 'partially_refunded') &&
      (lifecycle === 'confirmed' ||
        lifecycle === 'in_progress' ||
        lifecycle === 'completed' ||
        lifecycle === 'no_show' ||
        lifecycle === 'cancelled' ||
        lifecycle === 'expired')
    );
  }

  for (const lifecycle of lifecycles) {
    for (const payment of payments) {
      for (const settlement of settlements) {
        it(`${lifecycle}/${payment}/${settlement} matches the trigger`, () => {
          const expected = triggerAllows(lifecycle, payment, settlement);
          expect(isLegalCombination(lifecycle, payment, settlement)).toBe(expected);
          expect(legalSettlementsFor(lifecycle, payment).includes(settlement)).toBe(
            expected
          );
        });
      }
    }
  }

  it('rejects the combinations the trigger rejects (F19)', () => {
    // cancelled + dp_paid: 'not_eligible' is illegal, 'held'/'disputed' are legal.
    expect(isLegalCombination('cancelled', 'dp_paid', 'not_eligible')).toBe(false);
    expect(isLegalCombination('cancelled', 'dp_paid', 'held')).toBe(true);
    expect(isLegalCombination('cancelled', 'dp_paid', 'disputed')).toBe(true);

    // no_show + dp_paid: 'clawed_back' needs a refunded/fully paid payment.
    expect(isLegalCombination('no_show', 'dp_paid', 'clawed_back')).toBe(false);
    expect(isLegalCombination('no_show', 'dp_paid', 'held')).toBe(true);
    expect(isLegalCombination('no_show', 'fully_paid', 'clawed_back')).toBe(true);

    // expired + dp_paid: 'not_eligible' is illegal as well.
    expect(isLegalCombination('expired', 'dp_paid', 'not_eligible')).toBe(false);
    expect(isLegalCombination('expired', 'dp_paid', 'held')).toBe(true);
  });
});

describe('every transition L-01…L-22 (+ P/S rows) is reachable', () => {
  it('declares exactly 22 lifecycle transitions', () => {
    const lifecycleIds = TRANSITIONS.filter((def) => def.id.startsWith('L-')).map((def) => def.id);
    expect(lifecycleIds).toHaveLength(22);
    expect(lifecycleIds).toEqual(
      Array.from({ length: 22 }, (_, index) => `L-${String(index + 1).padStart(2, '0')}`)
    );
  });

  for (const def of TRANSITIONS) {
    it(`${def.id} ${def.action} applies from its source state`, () => {
      const from = fixtureFor(def);
      const ctx = contextFor(def);
      expect(canTransition(from, def.action, ctx.actor)).toBe(true);

      const result = applyTransition(from, def.action, ctx);

      expect(result.transition.id).toBe(def.id);
      expect(result.transition.action).toBe(def.action);
      expect(() => assertLegalCombination(result.next)).not.toThrow();
      if (def.to.lifecycle) expect(result.next.lifecycle_status).toBe(def.to.lifecycle);
      if (def.to.payment) expect(result.next.payment_status).toBe(def.to.payment);
      if (def.to.settlement) expect(result.next.settlement_status).toBe(def.to.settlement);
      for (const change of result.changes) {
        expect(['lifecycle', 'payment', 'settlement']).toContain(change.axis);
        expect(change.to).not.toBe(change.from);
      }
    });
  }

  it('rejects the same action from every terminal-unrelated state', () => {
    // A requested booking can never be completed or released.
    expectConflict(
      () =>
        applyTransition(stateAt({ lifecycle_status: 'confirmed', payment_status: 'dp_paid', settlement_status: 'held' }), 'booking.accept', {
          actor: 'vendor_owner',
          now: NOW
        }),
      'booking.accept'
    );
    expectConflict(
      () =>
        applyTransition(stateAt({ lifecycle_status: 'requested' }), 'booking.complete', {
          actor: 'customer',
          now: NOW
        }),
      'booking.complete'
    );
    expectConflict(
      () =>
        applyTransition(
          stateAt({ lifecycle_status: 'completed', payment_status: 'fully_paid', settlement_status: 'held' }),
          'settlement.release_auto',
          { actor: 'system', now: NOW }
        ),
      'settlement.release_auto'
    );
  });

  it('rejects an unauthorised actor for every transition', () => {
    for (const def of TRANSITIONS) {
      const wrongActor: ActorRole = def.actors.includes('customer') ? 'system' : 'customer';
      expectConflict(() => applyTransition(fixtureFor(def), def.action, {
        ...contextFor(def),
        actor: wrongActor
      }), def.action);
    }
  });

  it('rejects unknown actions', () => {
    expectConflict(
      () =>
        applyTransition(initialBookingState(), 'booking.not_a_real_action' as BookingAction, {
          actor: 'customer',
          now: NOW
        }),
      'booking.not_a_real_action'
    );
  });
});

describe('accept: slot block and D-18 deadline', () => {
  const requested = (total: bigint): BookingState =>
    stateAt({
      lifecycle_status: 'requested',
      payment_status: 'unpaid',
      settlement_status: 'not_eligible',
      total_customer_idr: total
    });

  it('blocks the slot and sets a 24h deadline below Rp 10 jt', () => {
    const result = applyTransition(requested(4_025_000n), 'booking.accept', {
      actor: 'vendor_owner',
      now: NOW
    });

    expect(result.next.lifecycle_status).toBe('accepted');
    expect(result.blockSlots).toBe(true);
    expect(result.derived.payment_deadline?.toISOString()).toBe(
      new Date(NOW.getTime() + 24 * HOUR).toISOString()
    );
    expect(result.next.payment_deadline?.toISOString()).toBe(
      new Date(NOW.getTime() + 24 * HOUR).toISOString()
    );
    // hold_expires_at must mirror payment_deadline (§4.3 L-03, D-18).
    expect(result.next.hold_expires_at?.toISOString()).toBe(
      result.next.payment_deadline?.toISOString()
    );
  });

  it('sets a 48h deadline at Rp 10 jt or above', () => {
    const below = applyTransition(requested(9_999_999n), 'booking.accept', {
      actor: 'vendor_owner',
      now: NOW
    });
    const at = applyTransition(requested(10_000_000n), 'booking.accept', {
      actor: 'vendor_member',
      now: NOW
    });

    expect(below.next.payment_deadline?.getTime()).toBe(NOW.getTime() + 24 * HOUR);
    expect(at.next.payment_deadline?.getTime()).toBe(NOW.getTime() + 48 * HOUR);
  });

  it('rejects accept at respond_deadline + 1ms', () => {
    const state = requested(4_025_000n);
    state.respond_deadline = new Date(NOW.getTime() - 1);
    expectConflict(
      () => applyTransition(state, 'booking.accept', { actor: 'vendor_owner', now: NOW }),
      'booking.accept'
    );
  });

  it('rejects accept when the exclusion constraint already failed', () => {
    expectConflict(
      () =>
        applyTransition(requested(4_025_000n), 'booking.accept', {
          actor: 'vendor_owner',
          now: NOW,
          slotBlocked: false
        }),
      'booking.accept'
    );
  });

  it('writes one history row per axis change', () => {
    const accepted = applyTransition(requested(4_025_000n), 'booking.accept', {
      actor: 'vendor_owner',
      now: NOW
    });
    expect(accepted.changes).toEqual([{ axis: 'lifecycle', from: 'requested', to: 'accepted' }]);

    const confirmed = applyTransition(accepted.next, 'payment.dp_succeeded', {
      actor: 'system',
      now: NOW
    });
    expect(confirmed.changes).toEqual([
      { axis: 'lifecycle', from: 'accepted', to: 'confirmed' },
      { axis: 'payment', from: 'unpaid', to: 'dp_paid' },
      { axis: 'settlement', from: 'not_eligible', to: 'held' }
    ]);
  });
});

describe('dispute window is anchored to scheduled_end_at (§4.9)', () => {
  const scheduledEnd = new Date('2026-10-24T15:00:00.000Z');

  function inProgress(): BookingState {
    return stateAt({
      lifecycle_status: 'in_progress',
      payment_status: 'fully_paid',
      settlement_status: 'held',
      scheduled_start_at: new Date(scheduledEnd.getTime() - 2 * HOUR),
      scheduled_end_at: scheduledEnd
    });
  }

  it('customer complete at H+1 sets scheduled_end + 7 days, not now + 7', () => {
    const now = new Date(scheduledEnd.getTime() + HOUR);
    const result = applyTransition(inProgress(), 'booking.complete', { actor: 'customer', now });

    expect(result.derived.completed_at?.toISOString()).toBe(now.toISOString());
    expect(result.next.dispute_window_ends_at?.toISOString()).toBe(
      new Date(scheduledEnd.getTime() + 7 * DAY).toISOString()
    );
    expect(result.next.dispute_window_ends_at?.toISOString()).not.toBe(
      new Date(now.getTime() + 7 * DAY).toISOString()
    );
  });

  it('auto-complete is due exactly at scheduled_end + 3 days', () => {
    const atDue = new Date(scheduledEnd.getTime() + 3 * DAY);
    const result = applyTransition(inProgress(), 'booking.complete_auto', {
      actor: 'system',
      now: atDue
    });

    expect(result.next.lifecycle_status).toBe('completed');
    expect(result.next.completed_at?.toISOString()).toBe(atDue.toISOString());
    expect(result.next.dispute_window_ends_at?.toISOString()).toBe(
      new Date(scheduledEnd.getTime() + 7 * DAY).toISOString()
    );
  });

  it('auto-complete is a no-op one hour before H+3', () => {
    const tooEarly = new Date(scheduledEnd.getTime() + 3 * DAY - HOUR);
    expectConflict(
      () =>
        applyTransition(inProgress(), 'booking.complete_auto', {
          actor: 'system',
          now: tooEarly
        }),
      'booking.complete_auto'
    );
  });

  it('auto-complete is blocked by an open dispute', () => {
    expectConflict(
      () =>
        applyTransition(inProgress(), 'booking.complete_auto', {
          actor: 'system',
          now: new Date(scheduledEnd.getTime() + 3 * DAY),
          openDisputes: 1
        }),
      'booking.complete_auto'
    );
  });

  it('auto-complete marks a missing check-in', () => {
    const confirmed = stateAt({
      lifecycle_status: 'confirmed',
      payment_status: 'dp_paid',
      settlement_status: 'held',
      scheduled_start_at: new Date(scheduledEnd.getTime() - 2 * HOUR),
      scheduled_end_at: scheduledEnd,
      started_at: null
    });
    const result = applyTransition(confirmed, 'booking.complete_auto', {
      actor: 'system',
      now: new Date(scheduledEnd.getTime() + 3 * DAY)
    });

    expect(result.next.started_without_checkin).toBe(true);
  });

  it('auto-release is allowed only after the dispute window closes', () => {
    const windowEnd = new Date(scheduledEnd.getTime() + 7 * DAY);
    const completed: BookingState = stateAt({
      lifecycle_status: 'completed',
      payment_status: 'fully_paid',
      settlement_status: 'held',
      scheduled_start_at: new Date(scheduledEnd.getTime() - 2 * HOUR),
      scheduled_end_at: scheduledEnd,
      completed_at: new Date(scheduledEnd.getTime() + HOUR),
      dispute_window_ends_at: windowEnd
    });

    expectConflict(
      () =>
        applyTransition(completed, 'settlement.release_auto', {
          actor: 'system',
          now: windowEnd
        }),
      'settlement.release_auto'
    );

    const result = applyTransition(completed, 'settlement.release_auto', {
      actor: 'system',
      now: new Date(windowEnd.getTime() + 1)
    });
    expect(result.next.settlement_status).toBe('released');
    expect(result.next.released_at?.getTime()).toBe(windowEnd.getTime() + 1);
  });
});

describe('post-release clawback window is 30 days from released_at (FR-122)', () => {
  const releasedAt = new Date('2026-11-01T00:00:00.000Z');

  function released(): BookingState {
    return stateAt({
      lifecycle_status: 'completed',
      payment_status: 'fully_paid',
      settlement_status: 'released',
      released_at: releasedAt,
      completed_at: new Date(releasedAt.getTime() - DAY),
      scheduled_end_at: new Date(releasedAt.getTime() - 2 * DAY),
      dispute_window_ends_at: new Date(releasedAt.getTime() - 2 * DAY + 7 * DAY)
    });
  }

  it('accepts a claim at released_at + 29 days', () => {
    const result = applyTransition(released(), 'dispute.open_post_release', {
      actor: 'customer',
      now: new Date(releasedAt.getTime() + 29 * DAY),
      reason: 'not_as_described'
    });
    expect(result.next.settlement_status).toBe('disputed');
    expect(result.next.released_at?.toISOString()).toBe(releasedAt.toISOString());
  });

  it('accepts a claim exactly at released_at + 30 days', () => {
    expect(() =>
      applyTransition(released(), 'dispute.open_post_release', {
        actor: 'customer',
        now: new Date(releasedAt.getTime() + 30 * DAY),
        reason: 'fraud'
      })
    ).not.toThrow();
  });

  it('rejects a claim at released_at + 31 days', () => {
    expectConflict(
      () =>
        applyTransition(released(), 'dispute.open_post_release', {
          actor: 'customer',
          now: new Date(releasedAt.getTime() + 31 * DAY),
          reason: 'fraud'
        }),
      'dispute.open_post_release'
    );
  });

  it('allows disputed -> clawed_back only after a successful payout', () => {
    const disputed = released();
    disputed.settlement_status = 'disputed';
    expectConflict(
      () =>
        applyTransition(disputed, 'dispute.resolved_clawback', {
          actor: 'admin_super',
          now: NOW,
          reason: 'fraud',
          payoutSucceeded: false
        }),
      'dispute.resolved_clawback'
    );

    const result = applyTransition(disputed, 'dispute.resolved_clawback', {
      actor: 'admin_finance',
      now: NOW,
      reason: 'fraud',
      payoutSucceeded: true
    });
    expect(result.next.settlement_status).toBe('clawed_back');
  });
});

describe('other guards', () => {
  it('check-in is only allowed from H-3 to H+2', () => {
    const start = new Date('2026-10-24T15:00:00.000Z');
    const state = stateAt({
      lifecycle_status: 'confirmed',
      payment_status: 'dp_paid',
      settlement_status: 'held',
      scheduled_start_at: start,
      scheduled_end_at: new Date(start.getTime() + 2 * HOUR)
    });

    expect(() =>
      applyTransition(state, 'booking.checkin', {
        actor: 'vendor_owner',
        now: new Date(start.getTime() - 2 * HOUR)
      })
    ).not.toThrow();

    expectConflict(
      () =>
        applyTransition(state, 'booking.checkin', {
          actor: 'vendor_owner',
          now: new Date(start.getTime() - 4 * HOUR)
        }),
      'booking.checkin'
    );
  });

  it('cancel after confirmation must be at least H-24h', () => {
    const state = stateAt({
      lifecycle_status: 'confirmed',
      payment_status: 'fully_paid',
      settlement_status: 'held',
      scheduled_start_at: new Date(NOW.getTime() + 12 * HOUR),
      scheduled_end_at: new Date(NOW.getTime() + 14 * HOUR)
    });

    expectConflict(
      () =>
        applyTransition(state, 'booking.cancel_by_customer', {
          actor: 'customer',
          now: NOW
        }),
      'booking.cancel_by_customer'
    );
  });

  it('a reason is required for reject and cancel_by_admin', () => {
    expectConflict(
      () =>
        applyTransition(stateAt({ lifecycle_status: 'requested' }), 'booking.reject', {
          actor: 'vendor_owner',
          now: NOW,
          reason: '   '
        }),
      'booking.reject'
    );
  });

  it('terminal lifecycles do not accept new lifecycle actions', () => {
    for (const lifecycle of ['cancelled', 'rejected', 'expired', 'no_show'] as LifecycleStatus[]) {
      expect(
        canTransition(
          stateAt({ lifecycle_status: lifecycle, payment_status: lifecycle === 'no_show' ? 'fully_paid' : 'unpaid', settlement_status: lifecycle === 'no_show' ? 'disputed' : 'not_eligible' }),
          'booking.accept',
          'vendor_owner'
        )
      ).toBe(false);
    }
  });
});
