import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { PoolClient } from 'pg';
import { withTransaction } from '../../../../apps/api/src/core/db';
import { AppError } from '../../../../apps/api/src/core/errors';
import {
  computeCommission,
  DEFAULT_COMMISSION
} from '../../../platform/pricing/src/index';
import { CalendarService, type CalendarSession } from '../../calendar/src/index';
import type { AuthUser } from './current-user.decorator';
import {
  BookingRepository,
  bookingStateFromRow,
  type BookingRow,
  type BookingSlotRow,
  type NewBookingAddon
} from './booking.repository';
import {
  type AcceptBookingDto,
  type CancelBookingDto,
  type CreateBookingDto,
  type DeclineBookingDto
} from './dto';
import { currentRequestId } from './request-context';
import { deriveScheduleWindow } from './schedule';
import {
  applyTransition,
  initialBookingState,
  RESPOND_DEADLINE_HOURS,
  type ActorRole,
  type BookingAction,
  type TransitionResult
} from './state-machine';

const HOUR_MS = 60 * 60 * 1000;

/**
 * platform_settings is not part of this packet. The values below are the
 * frozen defaults from TECH-DESIGN §6.3 / PRD D-17; they are snapshotted per
 * booking so a later settings change cannot rewrite history.
 *
 * Customer service fee is 1% of the package price (D-17), NOT a flat nominal.
 * DP is 30% of the package price (TECH-DESIGN §6.3).
 */
const SERVICE_FEE_BP = 100n;
const DP_RATE_PERCENT = 30n;

export function computeServiceFee(pricePackageIdr: bigint): bigint {
  if (pricePackageIdr <= 0n) return 0n;
  return (pricePackageIdr * SERVICE_FEE_BP) / 10_000n;
}

export interface BookingPricingView {
  currency: string;
  price_package_idr: number;
  price_addons_idr: number;
  price_transport_idr: number;
  service_fee_idr: number;
  discount_idr: number;
  total_customer_idr: number;
  dp_amount_idr: number;
  commission_bp: number;
  commission_threshold_idr: number;
  commission_bp_tier2: number;
  commission_min_idr: number;
  commission_cap_idr: number;
  commission_tier1_idr: number;
  commission_tier2_idr: number;
  commission_idr: number;
  vendor_entitlement_idr: number;
  pricing_snapshot: Record<string, unknown>;
}

export interface BookingSlotView {
  date: string;
  session: string;
  is_blocking: boolean;
}

export interface BookingView {
  id: string;
  code: string;
  lifecycle_status: string;
  payment_status: string;
  settlement_status: string;
  customer_id: string;
  vendor_id: string;
  event_id: string;
  package_id: string;
  slots: BookingSlotView[];
  pricing: BookingPricingView;
  respond_deadline: string;
  counter_deadline: string | null;
  payment_deadline: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  dispute_window_ends_at: string | null;
  completed_at: string | null;
  released_at: string | null;
  row_version: number;
  created_at: string;
  updated_at: string;
}

export interface ListBookingsResult {
  data: BookingView[];
  next_cursor: string | null;
}

/**
 * The booking side of the payment port (TECH-DESIGN §2.2).
 *
 * The payment module never writes `bookings`: it states what happened and the
 * booking module applies the L-11 transition. The optional `client` lets the
 * payment webhook join ITS transaction, so the journal entry and the booking
 * confirmation commit together (§6.1 rule 7). Without a client the booking
 * module opens its own transaction.
 */
export interface BookingStatePort {
  applyDpPaid(
    input: { bookingId: string; amountIdr: bigint; now: Date },
    client?: PoolClient
  ): Promise<void>;
  applyFullyPaid(
    input: {
      bookingId: string;
      amountIdr: bigint;
      now: Date;
      allowAfterCompletion?: boolean;
    },
    client?: PoolClient
  ): Promise<void>;
}

/** BIGINT -> JSON number; no arithmetic is ever done on the number value. */
function moneyToJson(value: string | bigint): number {
  const asBigInt = typeof value === 'bigint' ? value : BigInt(value);
  if (
    asBigInt > BigInt(Number.MAX_SAFE_INTEGER) ||
    asBigInt < BigInt(-Number.MAX_SAFE_INTEGER)
  ) {
    throw new AppError('INTERNAL_ERROR', 'Nilai uang di luar batas aman JSON');
  }
  return Number(asBigInt);
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function codeFor(prefix: 'BK' | 'EV', now: Date): string {
  const datePart = now.toISOString().slice(2, 10).replace(/-/g, '');
  return `${prefix}-${datePart}-${randomBytes(2).toString('hex').toUpperCase()}`;
}

/** bit 0 = Monday … bit 6 = Sunday, matching package_price_rules.dow_mask. */
function dayOfWeekMask(date: string): number {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return 1 << ((day + 6) % 7);
}

function isAdmin(user: AuthUser): boolean {
  return user.roles.some(
    (role) => role === 'admin_support' || role === 'admin_finance' || role === 'admin_super'
  );
}

function requireRole(user: AuthUser, allowed: readonly ActorRole[]): ActorRole {
  const role = allowed.find(
    (candidate) => candidate !== 'system' && user.roles.includes(candidate)
  );
  if (!role) {
    throw new AppError(
      'FORBIDDEN',
      `Peran [${user.roles.join(', ')}] tidak berwenang untuk aksi ini`
    );
  }
  return role;
}

/**
 * `bookings.cancelled_by` / `completed_by` are VARCHAR(10) with a CHECK
 * constraint on the role token ('customer', 'vendor', 'admin', 'system'), so
 * the acting role is stored there — not the user id.
 */
export type AuditActorToken = 'customer' | 'vendor' | 'admin' | 'system';

export function auditActorToken(role: ActorRole): AuditActorToken {
  if (role === 'customer') return 'customer';
  if (role === 'vendor_owner' || role === 'vendor_member') return 'vendor';
  if (role === 'system') return 'system';
  return 'admin';
}

function toCalendarSession(session: string): CalendarSession {
  if (session === 'day' || session === 'night' || session === 'full') return session;
  throw new AppError('INTERNAL_ERROR', `Sesi slot tidak dikenal: ${session}`);
}

function encodeCursor(row: BookingRow): string {
  return Buffer.from(
    JSON.stringify({ created_at: row.created_at.toISOString(), id: row.id }),
    'utf8'
  ).toString('base64url');
}

function decodeCursor(cursor: string | undefined): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      created_at?: unknown;
      id?: unknown;
    };
    if (typeof parsed.created_at !== 'string' || typeof parsed.id !== 'string') return null;
    const createdAt = new Date(parsed.created_at);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id: parsed.id };
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Cursor tidak valid');
  }
}

@Injectable()
export class BookingService {
  constructor(
    @Inject(BookingRepository) private readonly repo: BookingRepository,
    @Inject(CalendarService) private readonly calendar: CalendarService
  ) {}

  /**
   * L-01: creates the booking in `requested` with non-blocking slots. The slot
   * is only blocked at accept (L-03); price and commission are snapshotted now.
   */
  async createBooking(
    input: CreateBookingDto,
    user: AuthUser,
    now: Date = new Date()
  ): Promise<BookingView> {
    const role = requireRole(user, ['customer']);
    const uniqueSlots = this.assertUniqueSlots(input);

    const row = await withTransaction(async (client) => {
      const vendor = await this.repo.findVendor(client, input.vendor_id);
      if (!vendor) throw new AppError('NOT_FOUND', `Vendor ${input.vendor_id} tidak ditemukan`);
      if (vendor.verification_status !== 'approved' || !vendor.is_active) {
        throw new AppError('CONFLICT', 'Vendor belum dapat menerima booking');
      }

      const pkg = await this.repo.findPackage(client, input.vendor_id, input.package_id);
      if (!pkg) throw new AppError('NOT_FOUND', `Paket ${input.package_id} tidak ditemukan`);
      if (!pkg.is_active) throw new AppError('CONFLICT', 'Paket tidak aktif');

      const basePriceIdr = BigInt(pkg.base_price_idr);
      const priceRule = await this.repo.findPriceRule(
        client,
        pkg.id,
        input.event.start_date,
        dayOfWeekMask(input.event.start_date)
      );

      let pricePackageIdr = basePriceIdr;
      if (priceRule?.rule_type === 'multiplier' && priceRule.multiplier_bp !== null) {
        pricePackageIdr = (basePriceIdr * BigInt(priceRule.multiplier_bp)) / 10_000n;
      } else if (priceRule?.rule_type === 'fixed' && priceRule.fixed_price_idr !== null) {
        pricePackageIdr = BigInt(priceRule.fixed_price_idr);
      }

      const { addons, priceAddonsIdr } = await this.loadAddons(client, pkg.id, input);

      const priceTransportIdr = 0n;
      const discountIdr = 0n;
      const serviceFeeIdr = computeServiceFee(pricePackageIdr);
      const totalCustomerIdr =
        pricePackageIdr + priceAddonsIdr + priceTransportIdr + serviceFeeIdr - discountIdr;

      // D-17: the commission base is the package price only.
      const commission = computeCommission(pricePackageIdr);
      const dpAmountIdr = (pricePackageIdr * DP_RATE_PERCENT) / 100n;
      const vendorEntitlementIdr = pricePackageIdr - commission.total;
      const respondDeadline = new Date(now.getTime() + RESPOND_DEADLINE_HOURS * HOUR_MS);

      const created = applyTransition(
        initialBookingState({ total_customer_idr: totalCustomerIdr }),
        'booking.create',
        { actor: role, now }
      );

      const event = await this.repo.insertEvent(client, {
        code: codeFor('EV', now),
        customerId: user.id,
        title: input.event.title,
        eventType: input.event.event_type ?? null,
        regionCode: input.event.region_code,
        venueName: input.event.venue_name ?? null,
        venueAddress: input.event.venue_address,
        latitude: input.event.venue_location?.lat ?? null,
        longitude: input.event.venue_location?.lng ?? null,
        startDate: input.event.start_date,
        endDate: input.event.end_date,
        guestEstimate: input.event.guest_estimate ?? null,
        notes: input.event.notes ?? null
      });

      const pricingSnapshot: Record<string, unknown> = {
        base_price_idr: basePriceIdr.toString(),
        selected_price_idr: pricePackageIdr.toString(),
        rule_id: priceRule?.id ?? null,
        rule_type: priceRule?.rule_type ?? null,
        multiplier_bp: priceRule?.multiplier_bp ?? null,
        fixed_price_idr: priceRule?.fixed_price_idr ?? null,
        dp_rate_percent: DP_RATE_PERCENT.toString()
      };

      const booking = await this.repo.insertBooking(client, {
        code: codeFor('BK', now),
        customerId: user.id,
        vendorId: vendor.id,
        eventId: event.id,
        packageId: pkg.id,
        pricePackageIdr,
        priceAddonsIdr,
        priceTransportIdr,
        serviceFeeIdr,
        discountIdr,
        commissionBp: DEFAULT_COMMISSION.bp1,
        commissionThresholdIdr: DEFAULT_COMMISSION.threshold,
        commissionBpTier2: DEFAULT_COMMISSION.bp2,
        commissionMinIdr: DEFAULT_COMMISSION.min,
        commissionCapIdr: DEFAULT_COMMISSION.cap,
        commissionTier1Idr: commission.tier1,
        commissionTier2Idr: commission.tier2,
        commissionIdr: commission.total,
        totalCustomerIdr,
        dpAmountIdr,
        vendorEntitlementIdr,
        pricingSnapshot,
        policyVersionId: input.policy_version_id,
        respondDeadline
      });

      await this.repo.insertBookingAddons(client, booking.id, addons);
      await this.calendar.reserve(
        client,
        vendor.id,
        uniqueSlots.map((slot) => ({
          bookingId: booking.id,
          date: slot.date,
          session: slot.session
        })),
        { blocking: false }
      );

      await this.writeHistory(client, booking.id, created, 'booking.create', role, user.id, input.notes);
      await this.repo.enqueueOutbox(client, {
        aggregateId: booking.id,
        aggregateVersion: booking.row_version,
        eventType: 'booking.requested',
        payload: this.outboxPayload(booking),
        dedupeKey: `booking.requested:${booking.id}`
      });

      return booking;
    });

    const slots = await this.repo.findSlotsByBooking(row.id);
    return this.toView(row, slots);
  }

  /** L-03: blocks the slot and starts the D-18 payment countdown. */
  async accept(id: string, input: AcceptBookingDto, user: AuthUser, now: Date = new Date()): Promise<BookingView> {
    const updated = await withTransaction(async (client) => {
      const row = await this.repo.findByIdForUpdate(client, id);
      if (!row) throw new AppError('NOT_FOUND', `Booking ${id} tidak ditemukan`);

      const role = requireRole(user, ['vendor_owner', 'vendor_member']);
      await this.assertResponder(row.vendor_id, user);

      const slots = await this.repo.findSlots(client, id);
      if (slots.length === 0) {
        throw new AppError('CONFLICT', 'Booking tidak memiliki slot');
      }

      const openDisputes = await this.repo.countOpenDisputes(client, id);
      const result = applyTransition(bookingStateFromRow(row), 'booking.accept', {
        actor: role,
        now,
        openDisputes,
        slotBlocked: true,
        reason: input.note ?? null
      });

      const paymentDeadline = result.derived.payment_deadline;
      if (!paymentDeadline) {
        throw new AppError('INTERNAL_ERROR', 'payment_deadline tidak terbentuk saat accept');
      }

      // The deadline is persisted BEFORE the slot is reserved: the calendar
      // sync trigger copies bookings.payment_deadline into
      // calendar_slots.hold_expires_at and would otherwise fall back to 2h
      // instead of the D-18 24h/48h window.
      const next = await this.repo.updateStatus(client, id, {
        lifecycle_status: result.next.lifecycle_status,
        payment_deadline: paymentDeadline
      });

      // Exclusion constraint is the final arbiter; a 23P01/23514 becomes
      // SLOT_UNAVAILABLE.
      await this.calendar.reserve(
        client,
        row.vendor_id,
        slots.map((slot) => ({
          bookingId: row.id,
          date: slot.date,
          session: toCalendarSession(slot.session)
        })),
        { blocking: true, holdExpiresAt: paymentDeadline }
      );

      await this.writeHistory(client, id, result, 'booking.accept', role, user.id, input.note);
      await this.repo.enqueueOutbox(client, {
        aggregateId: id,
        aggregateVersion: next.row_version,
        eventType: 'booking.accepted',
        payload: {
          ...this.outboxPayload(next),
          payment_deadline: paymentDeadline.toISOString()
        },
        dedupeKey: `booking.accepted:${id}`
      });

      return next;
    });

    const slots = await this.repo.findSlotsByBooking(id);
    return this.toView(updated, slots);
  }

  /** L-04: vendor declines a request. */
  async decline(
    id: string,
    input: DeclineBookingDto,
    user: AuthUser,
    now: Date = new Date()
  ): Promise<BookingView> {
    // The machine code lives in the history note, not in cancel_reason:
    // `cancel_reason` keeps the free text as it was written by the vendor.
    const reasonNote = input.reason_note ?? null;
    const historyNote = input.reason_note
      ? `${input.reason_code}: ${input.reason_note}`
      : input.reason_code;

    const updated = await withTransaction(async (client) => {
      const row = await this.repo.findByIdForUpdate(client, id);
      if (!row) throw new AppError('NOT_FOUND', `Booking ${id} tidak ditemukan`);

      const role = requireRole(user, ['vendor_owner', 'vendor_member']);
      await this.assertResponder(row.vendor_id, user);

      const result = applyTransition(bookingStateFromRow(row), 'booking.reject', {
        actor: role,
        now,
        reason: historyNote
      });

      await this.calendar.releaseHold(client, row.vendor_id, id);

      const next = await this.repo.updateStatus(client, id, {
        lifecycle_status: result.next.lifecycle_status,
        cancelled_at: result.derived.cancelled_at ?? null,
        cancelled_by: auditActorToken(role),
        cancel_reason: reasonNote
      });

      await this.writeHistory(client, id, result, 'booking.reject', role, user.id, historyNote);
      await this.repo.enqueueOutbox(client, {
        aggregateId: id,
        aggregateVersion: next.row_version,
        eventType: 'booking.rejected',
        payload: { ...this.outboxPayload(next), reason: historyNote },
        dedupeKey: `booking.rejected:${id}`
      });

      return next;
    });

    const slots = await this.repo.findSlotsByBooking(id);
    return this.toView(updated, slots);
  }

  /** L-06 / L-10 / L-12 / L-13 / L-17 / L-18 / L-19, chosen by current state. */
  async cancel(
    id: string,
    input: CancelBookingDto,
    user: AuthUser,
    now: Date = new Date()
  ): Promise<BookingView> {
    const updated = await withTransaction(async (client) => {
      const row = await this.repo.findByIdForUpdate(client, id);
      if (!row) throw new AppError('NOT_FOUND', `Booking ${id} tidak ditemukan`);

      const { action, role } = await this.resolveCancelAction(row, user);

      // The machine code lives in the history note, not in cancel_reason:
      // `cancel_reason` keeps the free text as it was written by the actor.
      const historyNote = input.reason_code
        ? `${input.reason_code}: ${input.reason}`
        : input.reason;

      const result = applyTransition(bookingStateFromRow(row), action, {
        actor: role,
        now,
        reason: historyNote
      });

      if (result.releaseSlots) {
        await this.calendar.releaseHold(client, row.vendor_id, id);
      }

      const next = await this.repo.updateStatus(client, id, {
        lifecycle_status: result.next.lifecycle_status,
        cancelled_at: result.derived.cancelled_at ?? null,
        cancelled_by: auditActorToken(role),
        cancel_reason: input.reason
      });

      await this.writeHistory(client, id, result, action, role, user.id, historyNote);
      await this.repo.enqueueOutbox(client, {
        aggregateId: id,
        aggregateVersion: next.row_version,
        eventType: 'booking.cancelled',
        payload: { ...this.outboxPayload(next), reason: historyNote },
        dedupeKey: `booking.cancelled:${id}`
      });

      return next;
    });

    const slots = await this.repo.findSlotsByBooking(id);
    return this.toView(updated, slots);
  }

  /**
   * L-11 (`payment.dp_succeeded`): the DP is paid, so the booking becomes
   * `confirmed` / `dp_paid` / `held`.
   *
   * Everything the transition owes happens in ONE transaction:
   * - the three status axes move through `applyTransition` (the state machine
   *   stays the single source of truth; the DB trigger would reject a partial
   *   write with 23514);
   * - `scheduled_start_at` / `scheduled_end_at` are derived from the booking's
   *   own slots;
   * - `dispute_window_ends_at` = scheduled_end_at + 7 days (NOT completion + 7);
   * - one `booking_status_history` row per changed axis;
   * - the calendar slots flip from `held` to `booked`;
   * - the `booking.confirmed` outbox message is enqueued.
   *
   * Transaction handling:
   * - WITHOUT `client` the method opens its own transaction and commits it;
   * - WITH `client` the method runs every statement on that client and joins
   *   the caller's transaction: it never opens, commits or rolls back, and it
   *   never opens a second connection. The caller keeps the booking row lock
   *   (`SELECT ... FOR UPDATE`), so the DP money path can post the journal
   *   entry and confirm the booking atomically.
   */
  async applyDpPaid(
    input: { bookingId: string; amountIdr: bigint; now: Date },
    client?: PoolClient
  ): Promise<void> {
    if (client) {
      await this.applyDpPaidWithin(client, input);
      return;
    }
    await withTransaction((tx) => this.applyDpPaidWithin(tx, input));
  }

  /** The L-11 effects, always executed on the client it is given. */
  private async applyDpPaidWithin(
    client: PoolClient,
    input: { bookingId: string; amountIdr: bigint; now: Date }
  ): Promise<void> {
    const row = await this.repo.findByIdForUpdate(client, input.bookingId);
    if (!row) {
      throw new AppError('NOT_FOUND', `Booking ${input.bookingId} tidak ditemukan`);
    }

    // §4.3 L-11 guard: amount_idr = dp_amount_idr.
    const expectedDp = BigInt(row.dp_amount_idr);
    if (input.amountIdr !== expectedDp) {
      throw new AppError(
        'CONFLICT',
        `Nominal DP tidak sesuai dengan dp_amount_idr booking (${expectedDp})`
      );
    }

    const slots = await this.repo.findSlots(client, input.bookingId);
    const window = deriveScheduleWindow(slots);

    // The scheduled window is part of the state the transition reads
    // (guard `scheduled_end_known`), so it is injected before the call.
    const result = applyTransition(
      {
        ...bookingStateFromRow(row),
        scheduled_start_at: window.scheduled_start_at,
        scheduled_end_at: window.scheduled_end_at
      },
      'payment.dp_succeeded',
      { actor: 'system', now: input.now }
    );

    const next = await this.repo.updateStatus(client, input.bookingId, {
      lifecycle_status: result.next.lifecycle_status,
      payment_status: result.next.payment_status,
      settlement_status: result.next.settlement_status,
      scheduled_start_at: result.next.scheduled_start_at,
      scheduled_end_at: result.next.scheduled_end_at,
      confirmed_at: result.derived.confirmed_at ?? null,
      dispute_window_ends_at: result.derived.dispute_window_ends_at ?? null
    });

    // The held slots become booked ones (the projection read by search).
    await this.calendar.confirmBooked(client, row.vendor_id, input.bookingId);

    await this.writeHistory(
      client,
      input.bookingId,
      result,
      'payment.dp_succeeded',
      'system',
      null,
      `DP ${input.amountIdr.toString()} diterima`
    );

    await this.repo.enqueueOutbox(client, {
      aggregateId: input.bookingId,
      aggregateVersion: next.row_version,
      eventType: 'booking.confirmed',
      payload: {
        ...this.outboxPayload(next),
        scheduled_start_at: next.scheduled_start_at?.toISOString() ?? null,
        scheduled_end_at: next.scheduled_end_at?.toISOString() ?? null,
        dispute_window_ends_at: next.dispute_window_ends_at?.toISOString() ?? null
      },
      dedupeKey: `booking.confirmed:${input.bookingId}`
    });
  }

  /**
   * P-03 (`payment.settlement_succeeded`): the remaining balance is paid, so
   * the booking becomes `fully_paid`.
   *
   * The money itself is NOT released here: `settlement_status` stays `held`
   * until the dispute window closes (S-02 `settlement.release_auto`).
   *
   * Transaction handling mirrors `applyDpPaid`: WITH `client` the method joins
   * the caller's transaction and never opens one of its own; WITHOUT `client`
   * it opens its own transaction.
   */
  async applyFullyPaid(
    input: {
      bookingId: string;
      amountIdr: bigint;
      now: Date;
      allowAfterCompletion?: boolean;
    },
    client?: PoolClient
  ): Promise<void> {
    if (client) {
      await this.applyFullyPaidWithin(client, input);
      return;
    }
    await withTransaction((tx) => this.applyFullyPaidWithin(tx, input));
  }

  /** The P-03 effects, always executed on the client it is given. */
  private async applyFullyPaidWithin(
    client: PoolClient,
    input: {
      bookingId: string;
      amountIdr: bigint;
      now: Date;
      allowAfterCompletion?: boolean;
    }
  ): Promise<void> {
    const row = await this.repo.findByIdForUpdate(client, input.bookingId);
    if (!row) {
      throw new AppError('NOT_FOUND', `Booking ${input.bookingId} tidak ditemukan`);
    }

    // Idempotency: a retried webhook must not fail and must not write twice.
    if (row.payment_status === 'fully_paid') return;

    if (row.payment_status !== 'dp_paid') {
      throw new AppError(
        'CONFLICT',
        `Pelunasan hanya sah untuk booking berstatus dp_paid (sekarang ${row.payment_status})`
      );
    }
    // Manual settlement may arrive after the booking auto-completed while only
    // the DP was paid; the PJP webhook path never sets the flag.
    const afterCompletion = input.allowAfterCompletion === true && row.lifecycle_status === 'completed';
    if (
      row.lifecycle_status !== 'confirmed' &&
      row.lifecycle_status !== 'in_progress' &&
      !afterCompletion
    ) {
      throw new AppError(
        'CONFLICT',
        `Pelunasan hanya sah untuk booking confirmed/in_progress (sekarang ${row.lifecycle_status})`
      );
    }

    // §4.4 P-03 guard: the accumulated successful payments = total_customer_idr.
    // The outstanding balance is derived from the booking row, never from the
    // caller.
    const total = BigInt(row.total_customer_idr);
    const paid = BigInt(row.dp_amount_idr);
    const outstanding = total - paid;
    if (input.amountIdr <= 0n) {
      throw new AppError('CONFLICT', 'Nominal pelunasan harus lebih dari 0');
    }
    if (outstanding <= 0n) {
      throw new AppError('CONFLICT', 'Sisa tagihan booking tidak positif');
    }
    if (input.amountIdr > outstanding) {
      throw new AppError(
        'CONFLICT',
        `Nominal pelunasan melebihi sisa tagihan (${outstanding.toString()})`
      );
    }
    if (input.amountIdr !== outstanding) {
      throw new AppError(
        'CONFLICT',
        `Nominal pelunasan harus sama dengan sisa tagihan (${outstanding.toString()})`
      );
    }

    // P-03 moves the payment axis only: `settlement_status` stays `held` and
    // the scheduled window / dispute window are left untouched.
    const result = applyTransition(bookingStateFromRow(row), 'payment.settlement_succeeded', {
      actor: 'system',
      now: input.now
    });

    const next = await this.repo.updateStatus(client, input.bookingId, {
      payment_status: result.next.payment_status
    });

    await this.writeHistory(
      client,
      input.bookingId,
      result,
      'payment.settlement_succeeded',
      'system',
      null,
      `Pelunasan ${input.amountIdr.toString()} diterima`
    );

    await this.repo.enqueueOutbox(client, {
      aggregateId: input.bookingId,
      aggregateVersion: next.row_version,
      eventType: 'booking.fully_paid',
      payload: this.outboxPayload(next),
      dedupeKey: `booking.fully_paid:${input.bookingId}`
    });
  }

  async getById(id: string, user: AuthUser): Promise<BookingView> {
    const row = await this.repo.findById(id);
    if (!row) throw new AppError('NOT_FOUND', `Booking ${id} tidak ditemukan`);
    await this.assertCanView(row, user);
    const slots = await this.repo.findSlotsByBooking(id);
    return this.toView(row, slots);
  }

  async listForVendor(
    vendorId: string,
    user: AuthUser,
    options: { limit?: number; cursor?: string; lifecycle?: BookingRow['lifecycle_status'] } = {}
  ): Promise<ListBookingsResult> {
    if (!isAdmin(user)) {
      requireRole(user, ['vendor_owner', 'vendor_member']);
      const member = await this.repo.isVendorMember(vendorId, user.id);
      if (!member) throw new AppError('FORBIDDEN', 'Tidak berwenang melihat booking vendor ini');
    }

    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const cursor = decodeCursor(options.cursor);
    const rows = await this.repo.listForVendor(vendorId, {
      limit: limit + 1,
      cursorCreatedAt: cursor?.createdAt ?? null,
      cursorId: cursor?.id ?? null,
      lifecycle: options.lifecycle ?? null
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];

    return {
      data: page.map((row) => this.toView(row, [])),
      next_cursor: hasMore && last ? encodeCursor(last) : null
    };
  }

  /** L-22 worker input; the worker process itself is out of scope. */
  findAutoCompletable(now: Date, limit = 50): Promise<Awaited<ReturnType<BookingRepository['findAutoCompletable']>>> {
    return this.repo.findAutoCompletable(now, limit);
  }

  private async resolveCancelAction(
    row: BookingRow,
    user: AuthUser
  ): Promise<{ action: BookingAction; role: ActorRole }> {
    if (row.lifecycle_status === 'requested') {
      const role = requireRole(user, ['customer']);
      this.assertCustomer(row, user);
      return { action: 'booking.cancel_by_customer', role };
    }

    if (row.lifecycle_status === 'accepted') {
      if (user.roles.includes('customer')) {
        this.assertCustomer(row, user);
        return { action: 'booking.cancel_by_customer', role: 'customer' };
      }
      const role = requireRole(user, ['vendor_owner']);
      await this.assertResponder(row.vendor_id, user);
      return { action: 'booking.cancel_by_vendor', role };
    }

    if (row.lifecycle_status === 'confirmed') {
      if (user.roles.includes('customer')) {
        this.assertCustomer(row, user);
        return { action: 'booking.cancel_by_customer', role: 'customer' };
      }
      if (user.roles.includes('vendor_owner')) {
        await this.assertResponder(row.vendor_id, user);
        return { action: 'booking.cancel_by_vendor', role: 'vendor_owner' };
      }
      const role = requireRole(user, ['admin_support', 'admin_super']);
      return { action: 'booking.cancel_by_admin', role };
    }

    throw new AppError(
      'CONFLICT',
      `Booking berstatus ${row.lifecycle_status} tidak dapat dibatalkan`
    );
  }

  private assertCustomer(row: BookingRow, user: AuthUser): void {
    if (row.customer_id !== user.id) {
      throw new AppError('FORBIDDEN', 'Booking ini bukan milik Anda');
    }
  }

  private async assertResponder(vendorId: string, user: AuthUser): Promise<void> {
    const allowed = await this.repo.isVendorResponder(vendorId, user.id);
    if (!allowed) {
      throw new AppError('FORBIDDEN', 'Anda bukan pemilik/anggota vendor yang berwenang');
    }
  }

  private async assertCanView(row: BookingRow, user: AuthUser): Promise<void> {
    if (isAdmin(user) || row.customer_id === user.id) return;
    if (await this.repo.canViewBookingAsVendor(row.id, user.id)) return;
    // Deliberately NOT_FOUND, matching §7.3 (do not leak existence).
    throw new AppError('NOT_FOUND', `Booking ${row.id} tidak ditemukan`);
  }

  private assertUniqueSlots(
    input: CreateBookingDto
  ): Array<{ date: string; session: CalendarSession }> {
    const seen = new Set<string>();
    const slots: Array<{ date: string; session: CalendarSession }> = [];
    for (const slot of input.slots) {
      const key = `${slot.date}|${slot.session}`;
      if (seen.has(key)) {
        throw new AppError('VALIDATION_ERROR', `Slot ganda: ${slot.date} ${slot.session}`);
      }
      seen.add(key);
      slots.push({ date: slot.date, session: slot.session });
    }
    return slots;
  }

  private async loadAddons(
    client: Parameters<BookingRepository['findAddons']>[0],
    packageId: string,
    input: CreateBookingDto
  ): Promise<{ addons: NewBookingAddon[]; priceAddonsIdr: bigint }> {
    if (input.addons.length === 0) return { addons: [], priceAddonsIdr: 0n };

    const rows = await this.repo.findAddons(
      client,
      packageId,
      input.addons.map((addon) => addon.addon_id)
    );
    const byId = new Map(rows.map((row) => [row.id, row]));

    const addons: NewBookingAddon[] = [];
    let priceAddonsIdr = 0n;

    for (const requested of input.addons) {
      const addon = byId.get(requested.addon_id);
      if (!addon) {
        throw new AppError('VALIDATION_ERROR', `Add-on ${requested.addon_id} tidak tersedia`);
      }
      if (requested.qty > addon.max_qty) {
        throw new AppError(
          'VALIDATION_ERROR',
          `Jumlah add-on ${addon.name} melebihi batas ${addon.max_qty}`
        );
      }
      const priceIdr = BigInt(addon.price_idr);
      priceAddonsIdr += priceIdr * BigInt(requested.qty);
      addons.push({
        addonId: addon.id,
        name: addon.name,
        qty: requested.qty,
        priceIdr
      });
    }

    return { addons, priceAddonsIdr };
  }

  private async writeHistory(
    client: Parameters<BookingRepository['insertHistory']>[0],
    bookingId: string,
    result: TransitionResult,
    event: BookingAction,
    role: ActorRole,
    actorId: string | null,
    note?: string | null
  ): Promise<void> {
    // `system` is not a `user_role` value: the automated paths are stored
    // without an actor.
    const requestId = currentRequestId();
    await this.repo.insertHistory(
      client,
      result.changes.map((change) => ({
        bookingId,
        axis: change.axis,
        from: change.from,
        to: change.to,
        event,
        actorId: role === 'system' ? null : actorId,
        actorRole: role === 'system' ? null : role,
        requestId,
        note: note ?? null
      }))
    );
  }

  private outboxPayload(row: BookingRow): Record<string, unknown> {
    return {
      booking_id: row.id,
      code: row.code,
      customer_id: row.customer_id,
      vendor_id: row.vendor_id,
      lifecycle_status: row.lifecycle_status,
      payment_status: row.payment_status,
      settlement_status: row.settlement_status,
      total_customer_idr: row.total_customer_idr,
      dp_amount_idr: row.dp_amount_idr
    };
  }

  private toView(row: BookingRow, slots: readonly BookingSlotRow[]): BookingView {
    return {
      id: row.id,
      code: row.code,
      lifecycle_status: row.lifecycle_status,
      payment_status: row.payment_status,
      settlement_status: row.settlement_status,
      customer_id: row.customer_id,
      vendor_id: row.vendor_id,
      event_id: row.event_id,
      package_id: row.package_id,
      slots: slots.map((slot) => ({
        date: slot.date,
        session: slot.session,
        is_blocking: slot.is_blocking
      })),
      pricing: {
        currency: row.currency,
        price_package_idr: moneyToJson(row.price_package_idr),
        price_addons_idr: moneyToJson(row.price_addons_idr),
        price_transport_idr: moneyToJson(row.price_transport_idr),
        service_fee_idr: moneyToJson(row.service_fee_idr),
        discount_idr: moneyToJson(row.discount_idr),
        total_customer_idr: moneyToJson(row.total_customer_idr),
        dp_amount_idr: moneyToJson(row.dp_amount_idr),
        commission_bp: row.commission_bp,
        commission_threshold_idr: moneyToJson(row.commission_threshold_idr),
        commission_bp_tier2: row.commission_bp_tier2,
        commission_min_idr: moneyToJson(row.commission_min_idr),
        commission_cap_idr: moneyToJson(row.commission_cap_idr),
        commission_tier1_idr: moneyToJson(row.commission_tier1_idr),
        commission_tier2_idr: moneyToJson(row.commission_tier2_idr),
        commission_idr: moneyToJson(row.commission_idr),
        vendor_entitlement_idr: moneyToJson(row.vendor_entitlement_idr),
        pricing_snapshot: row.pricing_snapshot
      },
      respond_deadline: row.respond_deadline.toISOString(),
      counter_deadline: iso(row.counter_deadline),
      payment_deadline: iso(row.payment_deadline),
      scheduled_start_at: iso(row.scheduled_start_at),
      scheduled_end_at: iso(row.scheduled_end_at),
      dispute_window_ends_at: iso(row.dispute_window_ends_at),
      completed_at: iso(row.completed_at),
      released_at: iso(row.released_at),
      row_version: row.row_version,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString()
    };
  }
}
