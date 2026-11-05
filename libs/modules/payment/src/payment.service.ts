/**
 * Payment orchestration: DP charge creation, PJP webhook ingestion, refunds.
 *
 * No real gateway is called. Charges return a locally built instruction payload
 * and the webhook is the only source of truth for "paid" (D-01).
 *
 * The booking module owns the booking status transition: this module only
 * states that the DP was paid and lets `BookingService.applyDpPaid` apply the
 * L-11 transition (see `booking.port.ts`). The booking module joins this
 * module's transaction, so the journal entry, the payment state and the
 * booking transition commit together (§6.1 rule 7).
 *
 * Lock order follows TECH-DESIGN §8.1: the booking row is locked before the
 * payment row.
 */
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { AppError } from '@tarlink/core/errors';
import {
  buildEntry,
  computeGatewayFee,
  postEntry,
  type JournalEntryDraft,
  type JournalQueryClient
} from '@tarlink/modules/ledger';
import {
  IdempotencyService,
  hashRequest,
  type IdempotencyStore
} from '@tarlink/platform/idempotency';
import type { BookingPaymentPort } from './booking.port';
import { LocalPaymentGateway } from './local.gateway';
import type { GatewayInstruction, PaymentGateway } from './payment.gateway';
import {
  PAYMENT_METHODS,
  type PaymentMethod,
  type PaymentRecord,
  type PaymentRepository,
  type PaymentStatus,
  type RefundStatus
} from './payment.repository';

const WEBHOOK_TOLERANCE_SECONDS = 300;
const PAID_EVENT_TYPES = new Set(['payment.paid', 'payment.succeeded', 'payment.captured']);
const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
/** `payments.method` values the manual settlement path may write. */
const SETTLE_MANUAL_METHODS = new Set(['transfer_manual', 'cash']);
/**
 * Rails with a real instruction builder. E-wallet is declared in the enum/DDL
 * but has no deeplink instruction yet; accepting it used to produce a bogus VA
 * (`gopay` → bank "AY"), so it is rejected until the gateway supports it.
 */
const SUPPORTED_DP_METHODS = new Set<PaymentMethod>([
  'qris',
  'va_bca',
  'va_bni',
  'va_bri',
  'va_mandiri'
]);
/** `audit_logs.request_id` is VARCHAR(40); an oversized header must not fail a write. */
const REQUEST_ID_MAX_LENGTH = 40;

export const IDEMPOTENCY_SCOPE = {
  createDpCharge: 'POST /v1/payments/dp',
  createSettlementCharge: 'POST /v1/payments/settlement',
  refund: 'POST /v1/payments/:id/refund',
  advanceRefund: 'payment.refund.advance',
  approveRefund: 'POST /v1/payments/refunds/:id/approve',
  rejectRefund: 'POST /v1/payments/refunds/:id/reject'
} as const;

/**
 * FR-128: a refund above this amount needs a second, different approver. The
 * value is configurable through `REFUND_APPROVAL_THRESHOLD_IDR`.
 */
const DEFAULT_REFUND_APPROVAL_THRESHOLD_IDR = 1_000_000n;

/** The only refund status each transition may start from. */
const REFUND_TRANSITION_FROM: Record<'approved' | 'processing' | 'succeeded', RefundStatus> = {
  approved: 'requested',
  processing: 'approved',
  succeeded: 'processing'
};

export type RefundTargetStatus = keyof typeof REFUND_TRANSITION_FROM;

export interface PaymentServiceDeps {
  readonly repository: PaymentRepository;
  /** Outbound port to the booking module (TECH-DESIGN §2.2). */
  readonly booking: BookingPaymentPort;
  /** Idempotency-Key store (`PgIdempotencyStore` in production). */
  readonly idempotencyStore: IdempotencyStore;
  /** `PJP_WEBHOOK_SECRET`. Empty/undefined rejects every webhook (fail closed). */
  readonly webhookSecret?: string;
  readonly provider?: string;
  /** Defaults to `LocalPaymentGateway` so unit tests never touch the network. */
  readonly gateway?: PaymentGateway;
  readonly now?: () => Date;
  readonly newId?: () => string;
  readonly newProviderRef?: (paymentId: string, method: PaymentMethod) => string;
  /** Defaults to Rp1.000.000 (FR-128). */
  readonly refundApprovalThresholdIdr?: bigint;
}

export interface RequestOptions {
  readonly actorId?: string | null;
  readonly actorRoles?: readonly string[];
  readonly idempotencyKey?: string;
  readonly requestHash?: string;
  readonly providerRefundId?: string | null;
  /** Public URL of the proof attached by the admin requesting the refund. */
  readonly evidenceUrl?: string | null;
}

export interface PaymentInstruction {
  readonly type: 'qris' | 'va';
  /** Raw QR payload for local rendering. */
  readonly qr_string?: string;
  /** Provider-rendered QR image URL (Midtrans Core API). */
  readonly qr_url?: string;
  readonly va_number?: string;
  readonly bank?: string;
  /** Mandiri Bill only. */
  readonly biller_code?: string;
  readonly expires_at: string;
}

export interface DpChargeResult {
  readonly id: string;
  readonly booking_id: string;
  readonly kind: 'dp';
  readonly status: 'pending';
  readonly amount_idr: number;
  readonly currency: 'IDR';
  readonly method: PaymentMethod;
  readonly provider: string;
  readonly provider_ref: string;
  readonly expires_at: string;
  readonly payment_instruction: PaymentInstruction;
}

export interface SettlementChargeResult {
  readonly id: string;
  readonly booking_id: string;
  readonly kind: 'settlement';
  readonly status: 'pending';
  readonly amount_idr: number;
  readonly currency: 'IDR';
  readonly method: PaymentMethod;
  readonly provider: string;
  readonly provider_ref: string;
  readonly expires_at: string;
  readonly payment_instruction: PaymentInstruction;
  readonly payment: {
    readonly id: string;
    readonly booking_id: string;
    readonly kind: 'settlement';
    readonly status: 'pending';
    readonly amount_idr: number;
    readonly currency: 'IDR';
    readonly method: PaymentMethod;
    readonly provider: string;
    readonly provider_ref: string;
    readonly expires_at: string;
    readonly paid_at: string | null;
  };
}

/** `GET /payments/by-booking/:bookingId` body. */
export interface DpPaymentByBookingResult {
  readonly payment: {
    readonly id: string;
    readonly booking_id: string;
    readonly kind: 'dp';
    readonly status: PaymentStatus;
    readonly amount_idr: number;
    readonly currency: 'IDR';
    readonly method: PaymentMethod;
    readonly provider: string;
    readonly provider_ref: string;
    readonly expires_at: string | null;
    readonly paid_at: string | null;
  };
  /** Rebuilt with the same helper as `POST /payments/dp`; null when not pending. */
  readonly payment_instruction: PaymentInstruction | null;
}

/** `GET /payments/settlement/by-booking/:bookingId` body. */
export interface SettlementPaymentByBookingResult {
  readonly payment: {
    readonly id: string;
    readonly booking_id: string;
    readonly kind: 'settlement';
    readonly status: PaymentStatus;
    readonly amount_idr: number;
    readonly currency: 'IDR';
    readonly method: PaymentMethod;
    readonly provider: string;
    readonly provider_ref: string;
    readonly expires_at: string | null;
    readonly paid_at: string | null;
  };
  readonly payment_instruction: PaymentInstruction | null;
}

export interface SettleManualInput {
  readonly bookingId: string;
  readonly amountIdr: bigint;
  /** e.g. `transfer_manual` | `cash` (stored on `payments.method`). */
  readonly method: string;
  readonly reference?: string | null;
  readonly note?: string | null;
  /** Required, non-empty: money operations always carry a verified actor. */
  readonly actorId: string;
  /**
   * Optional audit row, written on the very same transaction as the journal,
   * the payment row and the booking transition. A rolled back settlement takes
   * its audit row with it, and a replay writes none.
   */
  readonly audit?: {
    readonly action: string;
    readonly actorId: string;
    readonly actorRole: string;
    readonly requestId?: string | null;
    readonly payload: Record<string, unknown>;
  };
  readonly now?: Date;
}

export interface SettleManualResult {
  readonly paymentId: string;
  readonly journalEntryId: string;
  readonly bookingId: string;
  readonly outstandingBeforeIdr: bigint;
  readonly alreadySettled: boolean;
}

export interface PjpWebhookEvent {
  readonly id: string;
  readonly type: string;
  readonly timestamp?: string | number;
  readonly data?: {
    readonly provider_ref?: string;
    readonly provider_txn_id?: string;
    readonly amount_idr?: string | number;
    readonly fee_idr?: string | number;
    readonly paid_at?: string;
  };
}

export interface WebhookResult {
  readonly received: true;
  readonly duplicate: boolean;
  readonly event_id: string;
  readonly status: string;
  readonly payment_id?: string;
  readonly journal_entry_id?: string;
}

export interface RefundResult {
  readonly id: string;
  readonly payment_id: string;
  readonly booking_id: string;
  readonly amount_idr: number;
  readonly fee_idr: number;
  readonly currency: 'IDR';
  readonly status: string;
  readonly reason_code: string;
  readonly reason_note: string | null;
  readonly evidence_url: string | null;
  readonly review_note: string | null;
  readonly requested_by: string | null;
  readonly approved_by: string | null;
  readonly approved_at: string | null;
  /** True when the request is waiting for a second admin (FR-128). */
  readonly requires_approval: boolean;
  readonly journal_entry_id: string;
}

export interface RefundAdvanceResult {
  readonly id: string;
  readonly payment_id: string;
  readonly booking_id: string;
  readonly amount_idr: number;
  readonly fee_idr: number;
  readonly currency: 'IDR';
  readonly status: string;
  readonly reason_code: string;
  readonly reason_note: string | null;
  readonly evidence_url: string | null;
  readonly review_note: string | null;
  readonly requested_by: string | null;
  readonly approved_by: string | null;
  readonly approved_at: string | null;
  readonly requires_approval: boolean;
  /** Present once the refund is disbursed and the journal entry is posted. */
  readonly journal_entry_id?: string;
}

export interface RefundByBookingResult {
  readonly refund: RefundResult;
}

/** Stable JSON for idempotency request hashing (§7.5 step 2). */
export { hashRequest };

/** Money leaves the process as a JSON number only when it is exactly representable. */
function jsonRupiah(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new AppError('INTERNAL_ERROR', 'amount exceeds JSON safe integer range');
  }
  return Number(value);
}

/**
 * Parses an amount that arrives from the outside world. A missing or malformed
 * amount is a client error, never an internal one.
 */
function parseExternalAmount(value: string | number | undefined | null, field: string): bigint {
  if (value === undefined || value === null || value === '') {
    throw new AppError('VALIDATION_ERROR', `${field} is required`);
  }
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) {
      throw new AppError('VALIDATION_ERROR', `${field} must be a non-negative integer`);
    }
    return BigInt(value);
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  throw new AppError('VALIDATION_ERROR', `${field} must be a non-negative integer`);
}

export class PaymentService {
  private readonly repository: PaymentRepository;
  private readonly booking: BookingPaymentPort;
  private readonly idempotencyStore: IdempotencyStore;
  private readonly webhookSecret: string;
  private readonly provider: string;
  private readonly gateway: PaymentGateway;
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly newProviderRef: (paymentId: string, method: PaymentMethod) => string;
  private readonly refundApprovalThresholdIdr: bigint;

  constructor(deps: PaymentServiceDeps) {
    this.repository = deps.repository;
    this.booking = deps.booking;
    this.idempotencyStore = deps.idempotencyStore;
    this.webhookSecret = deps.webhookSecret ?? '';
    this.gateway = deps.gateway ?? new LocalPaymentGateway();
    this.provider = deps.provider ?? this.gateway.name;
    this.now = deps.now ?? (() => new Date());
    this.newId = deps.newId ?? (() => randomUUID());
    this.newProviderRef =
      deps.newProviderRef ??
      ((paymentId) => `PJP-${paymentId.replace(/-/g, '').slice(0, 16).toUpperCase()}`);
    this.refundApprovalThresholdIdr =
      deps.refundApprovalThresholdIdr ?? DEFAULT_REFUND_APPROVAL_THRESHOLD_IDR;
  }

  /* -------------------------------------------------------------- DP charge */

  async createDpCharge(
    bookingId: string,
    method: PaymentMethod,
    opts: RequestOptions = {}
  ): Promise<DpChargeResult> {
    if (!bookingId) throw new AppError('VALIDATION_ERROR', 'bookingId is required');
    if (!PAYMENT_METHODS.includes(method)) {
      throw new AppError('VALIDATION_ERROR', `unsupported payment method: ${String(method)}`);
    }
    if (!SUPPORTED_DP_METHODS.has(method)) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Metode e-wallet belum tersedia. Gunakan QRIS atau virtual account.'
      );
    }
    // Money operations always carry the identity of the verified token.
    const actorId = opts.actorId ?? null;
    if (!actorId) {
      throw new AppError('UNAUTHENTICATED', 'an authenticated actor is required');
    }

    const requestHash = opts.requestHash ?? hashRequest({ booking_id: bookingId, method });
    return this.runIdempotent(IDEMPOTENCY_SCOPE.createDpCharge, opts, requestHash, async () => {
      const now = this.now();
      const payment = await this.repository.transaction(async (tx) => {
        const booking = await this.repository.lockBooking(tx, bookingId);
        if (!booking) throw new AppError('NOT_FOUND', `booking ${bookingId} not found`);

        // §7.3: the caller must own the booking. NOT_FOUND, never FORBIDDEN:
        // the existence of another customer's booking is not disclosed.
        if (booking.customerId !== actorId) {
          throw new AppError('NOT_FOUND', `booking ${bookingId} not found`);
        }

        // Packet T9 guard: DP can only be charged on an accepted, still-unpaid booking.
        if (booking.lifecycleStatus !== 'accepted') {
          throw new AppError(
            'CONFLICT',
            `booking must be accepted before a DP charge (current: ${booking.lifecycleStatus})`
          );
        }
        if (booking.paymentStatus !== 'unpaid') {
          throw new AppError(
            'CONFLICT',
            `booking payment_status must be unpaid (current: ${booking.paymentStatus})`
          );
        }
        if (!booking.paymentDeadline) {
          throw new AppError('CONFLICT', 'booking has no payment_deadline');
        }
        if (now.getTime() >= booking.paymentDeadline.getTime()) {
          throw new AppError('CONFLICT', 'payment deadline has passed');
        }

        // Server-computed amount: the client never supplies amount_idr (§7.4).
        const amountIdr = booking.dpAmountIdr;
        if (amountIdr <= 0n) throw new AppError('CONFLICT', 'booking dp_amount_idr must be positive');
        if (amountIdr > booking.totalCustomerIdr) {
          throw new AppError('CONFLICT', 'dp_amount_idr exceeds total_customer_idr');
        }

        const active = await this.repository.findActiveDpPayment(tx, bookingId);
        if (active) {
          // A previous attempt already reached the provider. Replaying its
          // instruction is safe; creating a second charge is not.
          if (this.instructionFromPayment(active)) return active;
          throw new AppError(
            'CONFLICT',
            'an active DP payment already exists for this booking',
            { paymentId: active.id, status: active.status }
          );
        }

        const paymentId = this.newId();
        return this.repository.insertPayment(tx, {
          bookingId,
          kind: 'dp',
          method,
          amountIdr,
          feeIdr: computeGatewayFee(amountIdr),
          provider: this.provider,
          providerRef: this.newProviderRef(paymentId, method),
          expiresAt: booking.paymentDeadline
        });
      });

      // A replay of an already-charged payment returns the stored instruction.
      const storedInstruction = this.instructionFromPayment(payment);
      if (storedInstruction) return this.toChargeResult(payment, storedInstruction);
      if (!payment.expiresAt) {
        throw new AppError('INTERNAL_ERROR', 'pending payment without expires_at');
      }

      let charge;
      try {
        charge = await this.gateway.createCharge({
          paymentId: payment.id,
          orderId: payment.providerRef,
          amountIdr: payment.amountIdr,
          method: payment.method,
          expiresAt: payment.expiresAt
        });
      } catch (error) {
        // Release the active-DP slot so the customer can retry with a new
        // Idempotency-Key after a provider rejection.
        await this.repository
          .transaction((tx) =>
            this.repository.markPaymentFailed(tx, {
              paymentId: payment.id,
              status: 'failed',
              failureCode: 'CHARGE_FAILED',
              rawPayload: { error: error instanceof Error ? error.message : String(error) }
            })
          )
          .catch(() => undefined);
        throw error;
      }

      const updated = await this.repository.transaction((tx) =>
        this.repository.updatePaymentCharge(tx, {
          paymentId: payment.id,
          providerTxnId: charge.providerTxnId,
          rawPayload: this.rawWithInstruction(charge.rawPayload, charge.instruction),
          expiresAt: charge.expiresAt ?? payment.expiresAt
        })
      );
      return this.toChargeResult(updated, charge.instruction);
    });
  }

  /* --------------------------------------------------------- DP read route */

  /**
   * Most recent DP payment of a booking, whatever its status, for the mobile
   * client that needs to re-fetch the instruction. Ownership comes from the
   * booking row (same rule as the charge route: NOT_FOUND, never FORBIDDEN, so
   * another customer's booking is not disclosed).
   */
  async getDpPaymentByBooking(
    bookingId: string,
    opts: RequestOptions = {}
  ): Promise<DpPaymentByBookingResult> {
    if (!bookingId) throw new AppError('VALIDATION_ERROR', 'bookingId is required');
    const actorId = opts.actorId ?? null;
    if (!actorId) {
      throw new AppError('UNAUTHENTICATED', 'an authenticated actor is required');
    }

    const found = await this.repository.transaction((tx) =>
      this.repository.findLatestDpPaymentByBooking(tx, bookingId)
    );
    if (!found || found.customerId !== actorId) {
      throw new AppError('NOT_FOUND', 'Belum ada tagihan DP untuk booking ini');
    }

    const payment = found.payment;
    return {
      payment: {
        id: payment.id,
        booking_id: payment.bookingId,
        kind: 'dp',
        status: payment.status,
        amount_idr: jsonRupiah(payment.amountIdr),
        currency: 'IDR',
        method: payment.method,
        provider: payment.provider,
        provider_ref: payment.providerRef,
        expires_at: payment.expiresAt ? payment.expiresAt.toISOString() : null,
        paid_at: payment.paidAt ? payment.paidAt.toISOString() : null
      },
      payment_instruction: payment.status === 'pending' ? this.buildInstruction(payment) : null
    };
  }

  /* ------------------------------------------------------ settlement charge */

  async createSettlementCharge(
    bookingId: string,
    method: PaymentMethod,
    opts: RequestOptions = {}
  ): Promise<SettlementChargeResult> {
    if (!bookingId) throw new AppError('VALIDATION_ERROR', 'bookingId is required');
    if (!PAYMENT_METHODS.includes(method)) {
      throw new AppError('VALIDATION_ERROR', `unsupported payment method: ${String(method)}`);
    }
    if (!SUPPORTED_DP_METHODS.has(method)) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Metode e-wallet belum tersedia. Gunakan QRIS atau virtual account.'
      );
    }
    const actorId = opts.actorId ?? null;
    if (!actorId) {
      throw new AppError('UNAUTHENTICATED', 'an authenticated actor is required');
    }

    const requestHash = opts.requestHash ?? hashRequest({ booking_id: bookingId, method });
    return this.runIdempotent(IDEMPOTENCY_SCOPE.createSettlementCharge, opts, requestHash, async () => {
      const now = this.now();
      const payment = await this.repository.transaction(async (tx) => {
        const booking = await this.repository.lockBooking(tx, bookingId);
        if (!booking) throw new AppError('NOT_FOUND', `booking ${bookingId} not found`);

        if (booking.customerId !== actorId) {
          throw new AppError('NOT_FOUND', `booking ${bookingId} not found`);
        }

        if (booking.paymentStatus === 'unpaid') {
          throw new AppError('CONFLICT', 'DP must be paid before settlement');
        }
        if (booking.paymentStatus === 'fully_paid') {
          throw new AppError('CONFLICT', 'booking is already fully paid');
        }
        if (booking.paymentStatus !== 'dp_paid') {
          throw new AppError(
            'CONFLICT',
            `booking payment_status must be dp_paid (current: ${booking.paymentStatus})`
          );
        }

        const CLOSED_LIFECYCLE_STATUSES = new Set(['cancelled', 'rejected', 'expired', 'no_show']);
        if (CLOSED_LIFECYCLE_STATUSES.has(booking.lifecycleStatus)) {
          throw new AppError(
            'CONFLICT',
            `cannot settle booking in lifecycle_status: ${booking.lifecycleStatus}`
          );
        }
        const ALLOWED_SETTLEMENT_LIFECYCLES = new Set([
          'confirmed',
          'in_progress',
          'completed'
        ]);
        if (!ALLOWED_SETTLEMENT_LIFECYCLES.has(booking.lifecycleStatus)) {
          throw new AppError(
            'CONFLICT',
            `booking lifecycle_status must be confirmed, in_progress, or completed (current: ${booking.lifecycleStatus})`
          );
        }

        const amountIdr = booking.totalCustomerIdr - booking.dpAmountIdr;
        if (amountIdr <= 0n) {
          throw new AppError('CONFLICT', 'settlement amount must be positive');
        }

        const active = await this.repository.findActiveSettlementPayment(tx, bookingId);
        if (active) {
          if (this.instructionFromPayment(active)) return active;
          throw new AppError(
            'CONFLICT',
            'an active settlement payment already exists for this booking',
            { paymentId: active.id, status: active.status }
          );
        }

        const paymentId = this.newId();
        const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        return this.repository.insertPayment(tx, {
          bookingId,
          kind: 'settlement',
          method,
          amountIdr,
          feeIdr: computeGatewayFee(amountIdr),
          provider: this.provider,
          providerRef: this.newProviderRef(paymentId, method),
          expiresAt
        });
      });

      const storedInstruction = this.instructionFromPayment(payment);
      if (storedInstruction) return this.toSettlementChargeResult(payment, storedInstruction);

      if (!payment.expiresAt) {
        throw new AppError('INTERNAL_ERROR', 'pending payment without expires_at');
      }

      let charge;
      try {
        charge = await this.gateway.createCharge({
          paymentId: payment.id,
          orderId: payment.providerRef,
          amountIdr: payment.amountIdr,
          method: payment.method,
          expiresAt: payment.expiresAt
        });
      } catch (error) {
        await this.repository
          .transaction((tx) =>
            this.repository.markPaymentFailed(tx, {
              paymentId: payment.id,
              status: 'failed',
              failureCode: 'CHARGE_FAILED',
              rawPayload: { error: error instanceof Error ? error.message : String(error) }
            })
          )
          .catch(() => undefined);
        throw error;
      }

      const updated = await this.repository.transaction((tx) =>
        this.repository.updatePaymentCharge(tx, {
          paymentId: payment.id,
          providerTxnId: charge.providerTxnId,
          rawPayload: this.rawWithInstruction(charge.rawPayload, charge.instruction),
          expiresAt: charge.expiresAt ?? payment.expiresAt
        })
      );
      return this.toSettlementChargeResult(updated, charge.instruction);
    });
  }

  /* --------------------------------------------- settlement read route */

  async getSettlementPaymentByBooking(
    bookingId: string,
    opts: RequestOptions = {}
  ): Promise<SettlementPaymentByBookingResult> {
    if (!bookingId) throw new AppError('VALIDATION_ERROR', 'bookingId is required');
    const actorId = opts.actorId ?? null;
    if (!actorId) {
      throw new AppError('UNAUTHENTICATED', 'an authenticated actor is required');
    }

    const found = await this.repository.transaction((tx) =>
      this.repository.findLatestSettlementPaymentByBooking(tx, bookingId)
    );
    if (!found || found.customerId !== actorId) {
      throw new AppError('NOT_FOUND', 'Belum ada tagihan pelunasan untuk booking ini');
    }

    const payment = found.payment;
    return {
      payment: {
        id: payment.id,
        booking_id: payment.bookingId,
        kind: 'settlement',
        status: payment.status,
        amount_idr: jsonRupiah(payment.amountIdr),
        currency: 'IDR',
        method: payment.method,
        provider: payment.provider,
        provider_ref: payment.providerRef,
        expires_at: payment.expiresAt ? payment.expiresAt.toISOString() : null,
        paid_at: payment.paidAt ? payment.paidAt.toISOString() : null
      },
      payment_instruction: payment.status === 'pending' ? this.buildInstruction(payment) : null
    };
  }

  /* --------------------------------------------------------- manual settle */

  /**
   * Manual settlement: records the cash journal AND moves the booking
   * `dp_paid -> fully_paid` in one transaction.
   *
   * Same journal as the PJP settlement webhook, same lock order (booking then
   * payment), same `source_event_key`, so a replay can never post twice. Unlike
   * the webhook this path may settle a booking that already auto-completed
   * while only the DP was paid.
   */
  async settleManual(input: SettleManualInput): Promise<SettleManualResult> {
    if (!input.bookingId) throw new AppError('VALIDATION_ERROR', 'bookingId is required');
    if (typeof input.amountIdr !== 'bigint' || input.amountIdr <= 0n) {
      throw new AppError('VALIDATION_ERROR', 'amountIdr must be a positive bigint');
    }
    const method = typeof input.method === 'string' ? input.method.trim() : '';
    if (!method) throw new AppError('VALIDATION_ERROR', 'method is required');
    if (!SETTLE_MANUAL_METHODS.has(method)) {
      throw new AppError(
        'VALIDATION_ERROR',
        `metode pelunasan hanya transfer_manual atau cash (sekarang ${method})`
      );
    }
    const actorId = typeof input.actorId === 'string' ? input.actorId.trim() : '';
    if (!actorId) {
      throw new AppError('UNAUTHENTICATED', 'an authenticated actor is required');
    }
    if (input.audit && (!input.audit.action?.trim() || !input.audit.actorRole?.trim())) {
      throw new AppError('VALIDATION_ERROR', 'audit requires an action and an actor role');
    }
    const now = input.now ?? this.now();

    return this.repository.transaction(async (tx, client) => {
      // Lock order (§8.1): booking first, then the settlement payment row.
      const booking = await this.repository.lockBooking(tx, input.bookingId);
      if (!booking) {
        throw new AppError('NOT_FOUND', `Booking ${input.bookingId} tidak ditemukan`);
      }

      const outstanding = booking.totalCustomerIdr - booking.dpAmountIdr;

      if (booking.paymentStatus === 'fully_paid') {
        const settled = await this.repository.findSettlementPayment(tx, input.bookingId, 'paid');
        const journalEntryId = settled
          ? await this.repository.findJournalEntryId(tx, `payment:${settled.id}:paid`)
          : null;
        return {
          paymentId: settled?.id ?? '',
          journalEntryId: journalEntryId ?? '',
          bookingId: booking.id,
          outstandingBeforeIdr: outstanding,
          alreadySettled: true
        };
      }

      if (booking.paymentStatus !== 'dp_paid') {
        throw new AppError(
          'CONFLICT',
          `Pelunasan manual hanya sah untuk booking dp_paid (sekarang ${booking.paymentStatus})`
        );
      }
      if (outstanding <= 0n) {
        throw new AppError('CONFLICT', 'Sisa tagihan booking tidak positif');
      }
      if (input.amountIdr !== outstanding) {
        throw new AppError(
          'CONFLICT',
          `Nominal pelunasan harus sama dengan sisa tagihan (${outstanding.toString()})`
        );
      }

      let payment = await this.repository.findSettlementPayment(tx, input.bookingId, 'pending');
      if (payment && payment.amountIdr !== outstanding) {
        throw new AppError(
          'CONFLICT',
          `Nominal payment pelunasan tidak sesuai sisa tagihan (${outstanding.toString()})`
        );
      }
      if (!payment) {
        payment = await this.repository.insertSettlementPayment(tx, {
          bookingId: booking.id,
          method,
          amountIdr: outstanding,
          feeIdr: 0n
        });
      }

      const entry = buildEntry('settlement_received', {
        paymentId: payment.id,
        bookingId: booking.id,
        vendorId: booking.vendorId,
        amountIdr: outstanding,
        gatewayFeeIdr: payment.feeIdr,
        occurredAt: now,
        memo: input.note?.trim() || 'manual settlement'
      });
      const posted = await postEntry(tx, entry);

      await this.repository.markPaymentPaid(tx, {
        paymentId: payment.id,
        paidAt: now,
        providerTxnId: input.reference ?? null,
        rawPayload: {
          manual: true,
          actor_id: actorId,
          method,
          note: input.note ?? null
        }
      });

      // Same transaction as the money: a failure below rolls the audit back too.
      if (input.audit) {
        const requestId = input.audit.requestId
          ? input.audit.requestId.slice(0, REQUEST_ID_MAX_LENGTH)
          : null;
        await this.repository.insertAudit(tx, {
          actorId: input.audit.actorId || actorId,
          actorRole: input.audit.actorRole,
          action: input.audit.action,
          entityType: 'booking',
          entityId: booking.id,
          beforeState: {
            payment_status: booking.paymentStatus,
            outstanding_idr: jsonRupiah(outstanding)
          },
          afterState: {
            ...input.audit.payload,
            payment_id: payment.id,
            journal_entry_id: posted.id
          },
          requestId
        });
      }

      // Booking module joins this transaction: journal + payment + transition
      // commit (or roll back) together.
      await this.booking.applyFullyPaid(
        { bookingId: booking.id, amountIdr: outstanding, now, allowAfterCompletion: true },
        client
      );

      return {
        paymentId: payment.id,
        journalEntryId: posted.id,
        bookingId: booking.id,
        outstandingBeforeIdr: outstanding,
        alreadySettled: false
      };
    });
  }

  /* ---------------------------------------------------------------- webhook */

  async handleWebhook(
    rawBody: string | Buffer,
    signature: string,
    event: PjpWebhookEvent
  ): Promise<WebhookResult> {
    const raw = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
    this.verifySignature(raw, signature, event.timestamp);
    if (!event || typeof event.id !== 'string' || event.id.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'webhook event id is required');
    }
    if (typeof event.type !== 'string' || event.type.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'webhook event type is required');
    }
    // The amount is mandatory: without it the event cannot be verified against
    // the server-side amount, so nothing is recorded at all.
    const reportedAmountIdr = parseExternalAmount(event.data?.amount_idr, 'amount_idr');
    return this.processVerifiedEvent(event, { signature }, true, reportedAmountIdr);
  }

  /**
   * Midtrans-style notification: authenticity comes from the body's
   * `signature_key` (SHA512), not from an HMAC header.
   */
  async handleGatewayNotification(_rawBody: string | Buffer, body: unknown): Promise<WebhookResult> {
    const gateway = this.gateway;
    if (!gateway.verifyNotification || !gateway.classifyNotification) {
      throw new AppError('CONFLICT', 'Gateway ini tidak mendukung notifikasi berbasis body');
    }
    gateway.verifyNotification(body);
    const notification = gateway.classifyNotification(body);

    if (notification.kind === 'paid') {
      const amountIdr = parseExternalAmount(notification.event.data?.amount_idr, 'amount_idr');
      return this.processVerifiedEvent(
        notification.event,
        { source: gateway.name },
        true,
        amountIdr
      );
    }

    if (!notification.orderId) {
      throw new AppError('VALIDATION_ERROR', 'notification order_id is required');
    }

    return this.repository.transaction(async (tx) => {
      const inserted = await this.repository.insertWebhookEvent(tx, {
        provider: this.provider,
        externalId: notification.eventId,
        eventType: notification.eventType,
        payload: notification.raw,
        headers: { source: gateway.name },
        signatureValid: true
      });
      if (!inserted) {
        return {
          received: true,
          duplicate: true,
          event_id: notification.eventId,
          status: 'duplicate'
        };
      }

      if (notification.kind === 'failed' || notification.kind === 'expired') {
        const payment = await this.repository.findPaymentByProviderRef(
          tx,
          this.provider,
          notification.orderId
        );
        if (payment && payment.status === 'pending') {
          await this.repository.markPaymentFailed(tx, {
            paymentId: payment.id,
            status: notification.kind === 'expired' ? 'expired' : 'failed',
            failureCode: notification.eventType,
            rawPayload: notification.raw
          });
        }
      }

      await this.repository.markWebhookEvent(tx, { id: inserted.id, status: 'processed' });
      return {
        received: true,
        duplicate: false,
        event_id: notification.eventId,
        status: 'processed'
      };
    });
  }

  private async processVerifiedEvent(
    event: PjpWebhookEvent,
    headers: Record<string, string>,
    signatureValid: boolean,
    reportedAmountIdr: bigint
  ): Promise<WebhookResult> {
    return this.repository.transaction(async (tx, client) => {
      const inserted = await this.repository.insertWebhookEvent(tx, {
        provider: this.provider,
        externalId: event.id,
        eventType: event.type,
        payload: event,
        headers,
        signatureValid
      });

      if (!inserted) {
        // UNIQUE(provider, external_id) hit: replay the stored outcome, write nothing.
        const existing = await this.repository.findWebhookEvent(tx, this.provider, event.id);
        if (!existing) {
          // The row is not readable yet (a concurrent delivery is still in
          // flight). Acknowledge the delivery instead of failing it: the
          // provider must not retry a webhook we already accepted.
          return {
            received: true,
            duplicate: true,
            event_id: event.id,
            status: 'duplicate'
          };
        }
        return this.replayDuplicate(tx, event, existing.status);
      }

      if (!PAID_EVENT_TYPES.has(event.type)) {
        await this.repository.markWebhookEvent(tx, {
          id: inserted.id,
          status: 'ignored',
          lastError: `unhandled event type: ${event.type}`
        });
        return {
          received: true,
          duplicate: false,
          event_id: event.id,
          status: 'ignored'
        };
      }

      return this.processPaidEvent(tx, client, event, inserted.id, reportedAmountIdr);
    });
  }

  private async replayDuplicate(
    tx: JournalQueryClient,
    event: PjpWebhookEvent,
    storedStatus: string
  ): Promise<WebhookResult> {
    const providerRef = event.data?.provider_ref;
    if (!providerRef) {
      return {
        received: true,
        duplicate: true,
        event_id: event.id,
        status: storedStatus
      };
    }

    const payment = await this.repository.findPaymentByProviderRef(tx, this.provider, providerRef);
    if (!payment) {
      return {
        received: true,
        duplicate: true,
        event_id: event.id,
        status: storedStatus
      };
    }

    const journalEntryId = await this.repository.findJournalEntryId(
      tx,
      `payment:${payment.id}:paid`
    );
    return {
      received: true,
      duplicate: true,
      event_id: event.id,
      status: storedStatus,
      payment_id: payment.id,
      journal_entry_id: journalEntryId ?? undefined
    };
  }

  private async processPaidEvent(
    tx: JournalQueryClient,
    client: PoolClient,
    event: PjpWebhookEvent,
    webhookRowId: string,
    reportedAmountIdr: bigint
  ): Promise<WebhookResult> {
    const data = event.data ?? {};
    if (!data.provider_ref) {
      await this.repository.markWebhookEvent(tx, {
        id: webhookRowId,
        status: 'failed',
        lastError: 'provider_ref missing'
      });
      return { received: true, duplicate: false, event_id: event.id, status: 'failed' };
    }

    const found = await this.repository.findPaymentByProviderRef(
      tx,
      this.provider,
      data.provider_ref
    );
    if (!found) {
      // Unknown transaction: never create a payment from a webhook (W-03).
      await this.repository.markWebhookEvent(tx, {
        id: webhookRowId,
        status: 'ignored',
        lastError: `unknown provider_ref: ${data.provider_ref}`
      });
      return { received: true, duplicate: false, event_id: event.id, status: 'ignored' };
    }

    // Lock order (§8.1): the booking row first, then the payment row. The
    // booking module joins this transaction, so it re-reads the very same
    // locked row instead of blocking on it.
    const booking = await this.repository.lockBooking(tx, found.bookingId);
    const payment = await this.repository.lockPayment(tx, found.id);
    if (!booking) {
      await this.repository.markWebhookEvent(tx, {
        id: webhookRowId,
        status: 'failed',
        lastError: 'booking disappeared'
      });
      return { received: true, duplicate: false, event_id: event.id, status: 'failed' };
    }
    if (!payment) {
      await this.repository.markWebhookEvent(tx, {
        id: webhookRowId,
        status: 'failed',
        lastError: 'payment disappeared'
      });
      return { received: true, duplicate: false, event_id: event.id, status: 'failed' };
    }

    // The server-side amount stays the source of truth; the reported amount is
    // only used to verify that the provider moved the expected money.
    if (reportedAmountIdr !== payment.amountIdr) {
      await this.repository.markWebhookEvent(tx, {
        id: webhookRowId,
        status: 'failed',
        lastError: `amount mismatch: reported ${reportedAmountIdr.toString()}, expected ${payment.amountIdr.toString()}`
      });
      return { received: true, duplicate: false, event_id: event.id, status: 'failed' };
    }

    if (payment.status === 'paid') {
      // State guard: a later duplicate event must not post twice. The booking
      // transition is retried when it is still owed (self-healing).
      const journalEntryId = await this.repository.findJournalEntryId(
        tx,
        `payment:${payment.id}:paid`
      );
      await this.applyBookingTransition(payment, booking, payment.paidAt ?? this.now(), client);
      await this.repository.markWebhookEvent(tx, { id: webhookRowId, status: 'processed' });
      return {
        received: true,
        duplicate: false,
        event_id: event.id,
        status: 'processed',
        payment_id: payment.id,
        journal_entry_id: journalEntryId ?? undefined
      };
    }

    if (payment.status !== 'pending') {
      await this.repository.markWebhookEvent(tx, {
        id: webhookRowId,
        status: 'ignored',
        lastError: `payment status is ${payment.status}`
      });
      return { received: true, duplicate: false, event_id: event.id, status: 'ignored' };
    }

    const paidAt = this.parseEventDate(data.paid_at) ?? this.now();
    const entry: JournalEntryDraft = buildEntry(
      payment.kind === 'dp' ? 'dp_received' : 'settlement_received',
      {
        paymentId: payment.id,
        bookingId: payment.bookingId,
        vendorId: booking.vendorId,
        amountIdr: payment.amountIdr,
        gatewayFeeIdr: payment.feeIdr,
        occurredAt: paidAt,
        memo: `pjp webhook ${event.id}`
      }
    );
    const posted = await postEntry(tx, entry);

    await this.repository.markPaymentPaid(tx, {
      paymentId: payment.id,
      paidAt,
      providerTxnId: data.provider_txn_id ?? null,
      rawPayload: event
    });

    // The booking module owns the transition (L-11) and everything it owes.
    await this.applyBookingTransition(payment, booking, paidAt, client);

    await this.repository.markWebhookEvent(tx, { id: webhookRowId, status: 'processed' });

    return {
      received: true,
      duplicate: false,
      event_id: event.id,
      status: 'processed',
      payment_id: payment.id,
      journal_entry_id: posted.id
    };
  }

  /**
   * Asks the booking module to move the booking forward.
   *
   * The PAYMENT decides which transition it is, never the booking status: a DP
   * payment moves the booking `unpaid -> dp_paid` (`applyDpPaid`), a
   * settlement payment moves it `dp_paid -> fully_paid` (`applyFullyPaid`).
   *
   * The booking status only says whether the transition is still owed: a
   * replayed webhook finds the booking already in the target state, so
   * nothing happens - no second transition, no error, no second journal
   * entry.
   */
  private async applyBookingTransition(
    payment: PaymentRecord,
    booking: { readonly paymentStatus: string },
    now: Date,
    client?: PoolClient
  ): Promise<void> {
    const input = {
      bookingId: payment.bookingId,
      amountIdr: payment.amountIdr,
      now
    };

    if (payment.kind === 'dp') {
      // `unpaid -> dp_paid`: a booking that already carries a payment status
      // (dp_paid and beyond) does not need the DP transition any more.
      if (booking.paymentStatus !== 'unpaid') return;
      await this.booking.applyDpPaid(input, client);
      return;
    }

    // `dp_paid -> fully_paid`: the booking is already `fully_paid` when the
    // settlement webhook is replayed. The booking module treats that as a
    // no-op; the payment module does not even ask.
    if (booking.paymentStatus === 'fully_paid') return;
    await this.booking.applyFullyPaid({ ...input, allowAfterCompletion: true }, client);
  }

  /* ----------------------------------------------------------------- refund */

  async refund(
    paymentId: string,
    amountIdr: bigint,
    reason: string,
    opts: RequestOptions = {}
  ): Promise<RefundResult> {
    if (!paymentId) throw new AppError('VALIDATION_ERROR', 'paymentId is required');
    if (typeof amountIdr !== 'bigint' || amountIdr <= 0n) {
      throw new AppError('VALIDATION_ERROR', 'refund amount must be a positive bigint');
    }
    if (!reason || reason.trim().length === 0) {
      throw new AppError('VALIDATION_ERROR', 'refund reason is required');
    }
    const actorId = opts.actorId ?? null;
    if (!actorId) {
      throw new AppError('UNAUTHENTICATED', 'an authenticated actor is required');
    }
    const evidenceUrl = opts.evidenceUrl?.trim() || null;
    const requiresApproval = amountIdr > this.refundApprovalThresholdIdr;

    const requestHash =
      opts.requestHash ??
      hashRequest({
        payment_id: paymentId,
        amount_idr: amountIdr.toString(),
        reason,
        evidence_url: evidenceUrl
      });
    return this.runIdempotent(IDEMPOTENCY_SCOPE.refund, opts, requestHash, async () => {
      const outcome = await this.repository.transaction(async (tx) => {
        // Lock order: booking first, then payment (§8.1).
        const booking = await this.repository.lockBookingForPayment(tx, paymentId);
        const payment = await this.repository.lockPayment(tx, paymentId);
        if (!payment) throw new AppError('NOT_FOUND', `payment ${paymentId} not found`);
        if (!booking) throw new AppError('NOT_FOUND', `booking for payment ${paymentId} not found`);
        if (payment.status !== 'paid') {
          throw new AppError(
            'CONFLICT',
            `payment must be paid before refunding (current: ${payment.status})`
          );
        }
        if (this.gateway.name !== 'local' && (!payment.providerRef || payment.provider !== this.provider)) {
          // A manual settlement row has no provider transaction to reverse.
          throw new AppError(
            'CONFLICT',
            'Pembayaran ini tidak berasal dari gateway; refund harus dicatat manual.'
          );
        }

        const alreadyRefunded = await this.repository.sumRefundedAmount(tx, paymentId);
        const capturedIdr = payment.amountIdr;
        const availableIdr = capturedIdr - alreadyRefunded;
        if (amountIdr > availableIdr) {
          throw new AppError(
            'VALIDATION_ERROR',
            `refund amount ${amountIdr.toString()} exceeds captured amount ${availableIdr.toString()}`,
            {
              captured_idr: capturedIdr.toString(),
              already_refunded_idr: alreadyRefunded.toString(),
              available_idr: availableIdr.toString()
            }
          );
        }

        const isFullRefund = alreadyRefunded === 0n && amountIdr === capturedIdr;
        const feeRecoveredIdr = isFullRefund ? payment.feeIdr : 0n;
        if (feeRecoveredIdr >= amountIdr) {
          throw new AppError('CONFLICT', 'captured gateway fee exceeds the refund amount');
        }
        const refundNetIdr = amountIdr - feeRecoveredIdr;

        const refund = await this.repository.insertRefund(tx, {
          bookingId: payment.bookingId,
          paymentId,
          amountIdr,
          feeIdr: feeRecoveredIdr,
          reasonCode: reason.trim().slice(0, 40),
          reasonNote: reason.trim(),
          evidenceUrl,
          requestedBy: actorId
        });

        // The local gateway keeps the historical request-only behaviour, so it
        // posts the recognition entry immediately. A real provider waits until
        // the money movement is confirmed; a rejected refund must not leave a
        // recognition entry behind. A refund above the approval threshold never
        // posts anything before the second admin signs off.
        let recognitionJournalId = '';
        if (this.gateway.name === 'local' && !requiresApproval) {
          const entry = buildEntry(
            isFullRefund ? 'refund_full_recognized' : 'refund_partial_recognized',
            {
              refundId: refund.id,
              bookingId: payment.bookingId,
              vendorId: booking.vendorId,
              escrowIdr: amountIdr,
              refundNetIdr,
              gatewayFeeRecoveredIdr: feeRecoveredIdr,
              retainedCommissionBaseIdr: 0n,
              occurredAt: this.now(),
              memo: `refund ${reason.trim()}`
            }
          );
          const posted = await postEntry(tx, entry);
          recognitionJournalId = posted.id;
        }

        const result = this.toRefundResult(refund, recognitionJournalId, requiresApproval);
        return {
          result,
          providerRef: payment.providerRef,
          method: payment.method,
          vendorId: booking.vendorId,
          isFullRefund,
          refundNetIdr,
          reason: reason.trim()
        };
      });

      // Above the threshold the request stops at `requested` until a second
      // admin approves it. Below the threshold the local gateway keeps the
      // historical request-only behaviour; a real provider is asked to move
      // the money immediately.
      if (requiresApproval || this.gateway.name === 'local') return outcome.result;

      let providerRefund;
      try {
        providerRefund = await this.gateway.refund({
          orderId: outcome.providerRef,
          method: outcome.method,
          amountIdr,
          reason: outcome.reason,
          refundKey: outcome.result.id
        });
      } catch (error) {
        await this.repository
          .transaction((tx) =>
            this.repository.advanceRefundStatus(tx, {
              refundId: outcome.result.id,
              from: 'requested',
              to: 'failed',
              actorId: null,
              providerRefundId: null
            })
          )
          .catch(() => undefined);
        throw error;
      }
      return this.finalizeRefund(outcome, providerRefund.providerRefundId);
    });
  }

  private toRefundResult(
    refund: {
      id: string;
      paymentId: string;
      bookingId: string;
      amountIdr: bigint;
      feeIdr: bigint;
      status: string;
      reasonCode: string;
      reasonNote: string | null;
      evidenceUrl: string | null;
      reviewNote: string | null;
      requestedBy: string | null;
      approvedBy: string | null;
      approvedAt: Date | null;
    },
    journalEntryId: string,
    requiresApproval: boolean
  ): RefundResult {
    return {
      id: refund.id,
      payment_id: refund.paymentId,
      booking_id: refund.bookingId,
      amount_idr: jsonRupiah(refund.amountIdr),
      fee_idr: jsonRupiah(refund.feeIdr),
      currency: 'IDR' as const,
      status: refund.status,
      reason_code: refund.reasonCode,
      reason_note: refund.reasonNote,
      evidence_url: refund.evidenceUrl,
      review_note: refund.reviewNote,
      requested_by: refund.requestedBy,
      approved_by: refund.approvedBy,
      approved_at: refund.approvedAt ? refund.approvedAt.toISOString() : null,
      requires_approval: requiresApproval,
      journal_entry_id: journalEntryId
    };
  }

  private async finalizeRefund(
    outcome: {
      result: RefundResult;
      vendorId: string;
      isFullRefund: boolean;
      refundNetIdr: bigint;
      reason: string;
    },
    providerRefundId: string | null,
    from: RefundStatus = 'requested',
    actorId: string | null = null
  ): Promise<RefundResult> {
    const { result } = outcome;
    return this.repository.transaction(async (tx) => {
      const refund = await this.repository.lockRefund(tx, result.id);
      if (!refund) throw new AppError('NOT_FOUND', `refund ${result.id} not found`);
      if (refund.status === 'succeeded') return result;
      if (refund.status !== from) {
        throw new AppError(
          'CONFLICT',
          `refund ${result.id} is ${refund.status}, cannot be finalized automatically`
        );
      }

      const updated = await this.repository.advanceRefundStatus(tx, {
        refundId: result.id,
        from,
        to: 'succeeded',
        actorId,
        providerRefundId
      });
      const refundNetIdr = updated.amountIdr - updated.feeIdr;

      await postEntry(
        tx,
        buildEntry(
          outcome.isFullRefund ? 'refund_full_recognized' : 'refund_partial_recognized',
          {
            refundId: updated.id,
            bookingId: updated.bookingId,
            vendorId: outcome.vendorId,
            escrowIdr: updated.amountIdr,
            refundNetIdr,
            gatewayFeeRecoveredIdr: updated.feeIdr,
            retainedCommissionBaseIdr: 0n,
            occurredAt: this.now(),
            memo: `refund ${outcome.reason}`
          }
        )
      );
      const posted = await postEntry(
        tx,
        buildEntry('refund_disbursed', {
          refundId: updated.id,
          refundNetIdr,
          bookingId: updated.bookingId,
          occurredAt: this.now(),
          memo: `refund ${updated.id} disbursed`
        })
      );

      return this.toRefundResult(updated, posted.id, false);
    });
  }

  /**
   * Moves a refund one step forward: `requested -> approved -> processing ->
   * succeeded`. The disbursement is confirmed by the provider; the matching
   * `refund_disbursed` journal entry is posted when the refund succeeds.
   */
  async advanceRefund(
    refundId: string,
    target: RefundTargetStatus,
    opts: RequestOptions = {}
  ): Promise<RefundAdvanceResult> {
    if (!refundId) throw new AppError('VALIDATION_ERROR', 'refundId is required');
    if (!(target in REFUND_TRANSITION_FROM)) {
      throw new AppError('VALIDATION_ERROR', `unsupported refund status: ${String(target)}`);
    }
    const actorId = opts.actorId ?? null;
    if (!actorId) {
      throw new AppError('UNAUTHENTICATED', 'an authenticated actor is required');
    }

    const requestHash = opts.requestHash ?? hashRequest({ refund_id: refundId, target });
    return this.runIdempotent(IDEMPOTENCY_SCOPE.advanceRefund, opts, requestHash, async () =>
      this.repository.transaction(async (tx) => {
        const refund = await this.repository.lockRefund(tx, refundId);
        if (!refund) throw new AppError('NOT_FOUND', `refund ${refundId} not found`);

        const expected = REFUND_TRANSITION_FROM[target];
        if (refund.status !== expected) {
          throw new AppError(
            'CONFLICT',
            `refund ${refundId} must be ${expected} to become ${target} (current: ${refund.status})`
          );
        }
        if (target === 'approved' && refund.requestedBy === actorId) {
          // Four-eyes rule, also enforced by the `approved_by <> requested_by`
          // check constraint of the refunds table.
          throw new AppError('CONFLICT', 'the approver must differ from the requester');
        }

        const updated = await this.repository.advanceRefundStatus(tx, {
          refundId,
          from: expected,
          to: target,
          actorId,
          providerRefundId: opts.providerRefundId ?? null
        });

        let journalEntryId: string | undefined;
        if (target === 'succeeded') {
          const refundNetIdr = updated.amountIdr - updated.feeIdr;
          const posted = await postEntry(
            tx,
            buildEntry('refund_disbursed', {
              refundId: updated.id,
              refundNetIdr,
              bookingId: updated.bookingId,
              occurredAt: this.now(),
              memo: `refund ${updated.id} disbursed`
            })
          );
          journalEntryId = posted.id;
        }

        const result = this.toRefundResult(updated, journalEntryId ?? '', false);
        return { ...result, journal_entry_id: journalEntryId } as RefundAdvanceResult;
      })
    );
  }

  /**
   * Second-admin approval (FR-128). The approver must differ from the requester.
   * Only after this call does the provider move money and the journals post.
   */
  async approveRefund(refundId: string, opts: RequestOptions = {}): Promise<RefundResult> {
    if (!refundId) throw new AppError('VALIDATION_ERROR', 'refundId is required');
    const actorId = opts.actorId ?? null;
    if (!actorId) {
      throw new AppError('UNAUTHENTICATED', 'an authenticated actor is required');
    }

    const requestHash = opts.requestHash ?? hashRequest({ refund_id: refundId, action: 'approve' });
    return this.runIdempotent(
      IDEMPOTENCY_SCOPE.approveRefund,
      opts,
      requestHash,
      async () => {
        const context = await this.repository.transaction(async (tx) => {
          const refund = await this.repository.lockRefund(tx, refundId);
          if (!refund) throw new AppError('NOT_FOUND', `refund ${refundId} not found`);
          if (refund.status !== 'requested') {
            throw new AppError(
              'CONFLICT',
              `refund ${refundId} must be requested to be approved (current: ${refund.status})`
            );
          }
          if (refund.requestedBy === actorId) {
            // Four-eyes rule, also enforced by the refunds table check.
            throw new AppError('CONFLICT', 'the approver must differ from the requester');
          }

          const booking = await this.repository.lockBookingForPayment(tx, refund.paymentId);
          const payment = await this.repository.lockPayment(tx, refund.paymentId);
          if (!booking) throw new AppError('NOT_FOUND', `booking for refund ${refundId} not found`);
          if (!payment) throw new AppError('NOT_FOUND', `payment for refund ${refundId} not found`);
          if (payment.status !== 'paid') {
            throw new AppError(
              'CONFLICT',
              `payment must be paid before approving a refund (current: ${payment.status})`
            );
          }
          if (
            this.gateway.name !== 'local' &&
            (!payment.providerRef || payment.provider !== this.provider)
          ) {
            throw new AppError(
              'CONFLICT',
              'Pembayaran ini tidak berasal dari gateway; refund harus dicatat manual.'
            );
          }

          const approved = await this.repository.advanceRefundStatus(tx, {
            refundId,
            from: 'requested',
            to: 'approved',
            actorId
          });
          return {
            refund: approved,
            vendorId: booking.vendorId,
            providerRef: payment.providerRef,
            method: payment.method,
            capturedIdr: payment.amountIdr
          };
        });

        const isFullRefund = context.refund.amountIdr === context.capturedIdr;
        const outcome = {
          result: this.toRefundResult(context.refund, '', false),
          vendorId: context.vendorId,
          isFullRefund,
          refundNetIdr: context.refund.amountIdr - context.refund.feeIdr,
          reason: context.refund.reasonNote ?? context.refund.reasonCode
        };

        if (this.gateway.name === 'local') {
          return this.finalizeRefund(outcome, null, 'approved', actorId);
        }

        let providerRefund;
        try {
          providerRefund = await this.gateway.refund({
            orderId: context.providerRef,
            method: context.method,
            amountIdr: context.refund.amountIdr,
            reason: outcome.reason,
            refundKey: context.refund.id
          });
        } catch (error) {
          await this.repository
            .transaction((tx) =>
              this.repository.advanceRefundStatus(tx, {
                refundId,
                from: 'approved',
                to: 'failed',
                actorId: null,
                providerRefundId: null
              })
            )
            .catch(() => undefined);
          throw error;
        }

        return this.finalizeRefund(outcome, providerRefund.providerRefundId, 'approved', actorId);
      }
    );
  }

  /** Rejects a refund that is still waiting for its second approver. */
  async rejectRefund(
    refundId: string,
    note: string,
    opts: RequestOptions = {}
  ): Promise<RefundResult> {
    if (!refundId) throw new AppError('VALIDATION_ERROR', 'refundId is required');
    if (!note || note.trim().length < 5) {
      throw new AppError('VALIDATION_ERROR', 'a rejection note of at least 5 characters is required');
    }
    const actorId = opts.actorId ?? null;
    if (!actorId) {
      throw new AppError('UNAUTHENTICATED', 'an authenticated actor is required');
    }

    const requestHash =
      opts.requestHash ?? hashRequest({ refund_id: refundId, action: 'reject', note: note.trim() });
    return this.runIdempotent(
      IDEMPOTENCY_SCOPE.rejectRefund,
      opts,
      requestHash,
      async () =>
        this.repository.transaction(async (tx) => {
          const rejected = await this.repository.rejectRefund(tx, {
            refundId,
            actorId,
            note: note.trim()
          });
          return this.toRefundResult(rejected, '', false);
        })
    );
  }

  /**
   * Refund status for the customer or an admin (FR-133: the customer must see
   * the outcome). Another customer's booking resolves to NOT_FOUND.
   */
  async getRefundByBooking(
    bookingId: string,
    opts: RequestOptions = {}
  ): Promise<RefundByBookingResult | null> {
    if (!bookingId) throw new AppError('VALIDATION_ERROR', 'bookingId is required');
    const actorId = opts.actorId ?? null;
    if (!actorId) {
      throw new AppError('UNAUTHENTICATED', 'an authenticated actor is required');
    }
    const isAdmin = (opts.actorRoles ?? []).some((role) => role.startsWith('admin_') || role === 'operator');

    return this.repository.transaction(async (tx) => {
      const found = await this.repository.findLatestRefundByBooking(tx, bookingId);
      if (!found) return null;
      if (!isAdmin && found.customerId !== actorId) {
        throw new AppError('NOT_FOUND', `booking ${bookingId} not found`);
      }
      const pendingApproval = ['requested', 'approved'].includes(found.refund.status);
      return { refund: this.toRefundResult(found.refund, '', pendingApproval) };
    });
  }

  /* ---------------------------------------------------------------- helpers */

  private toChargeResult(
    payment: PaymentRecord,
    instruction?: GatewayInstruction
  ): DpChargeResult {
    if (!payment.expiresAt) {
      throw new AppError('INTERNAL_ERROR', 'pending payment without expires_at');
    }
    return {
      id: payment.id,
      booking_id: payment.bookingId,
      kind: 'dp',
      status: 'pending',
      amount_idr: jsonRupiah(payment.amountIdr),
      currency: 'IDR',
      method: payment.method,
      provider: payment.provider,
      provider_ref: payment.providerRef,
      expires_at: payment.expiresAt.toISOString(),
      payment_instruction:
        instruction ?? this.instructionFromPayment(payment) ?? this.buildInstruction(payment)
    };
  }

  private toSettlementChargeResult(
    payment: PaymentRecord,
    instruction?: GatewayInstruction
  ): SettlementChargeResult {
    if (!payment.expiresAt) {
      throw new AppError('INTERNAL_ERROR', 'pending payment without expires_at');
    }
    const paymentInstruction =
      instruction ?? this.instructionFromPayment(payment) ?? this.buildInstruction(payment);
    const amountNum = jsonRupiah(payment.amountIdr);
    const expiresAtStr = payment.expiresAt.toISOString();

    return {
      id: payment.id,
      booking_id: payment.bookingId,
      kind: 'settlement',
      status: 'pending',
      amount_idr: amountNum,
      currency: 'IDR',
      method: payment.method,
      provider: payment.provider,
      provider_ref: payment.providerRef,
      expires_at: expiresAtStr,
      payment_instruction: paymentInstruction,
      payment: {
        id: payment.id,
        booking_id: payment.bookingId,
        kind: 'settlement',
        status: 'pending',
        amount_idr: amountNum,
        currency: 'IDR',
        method: payment.method,
        provider: payment.provider,
        provider_ref: payment.providerRef,
        expires_at: expiresAtStr,
        paid_at: payment.paidAt ? payment.paidAt.toISOString() : null
      }
    };
  }

  /** The normalized instruction captured after a successful gateway charge. */
  private instructionFromPayment(payment: PaymentRecord): PaymentInstruction | null {
    const raw = payment.rawPayload;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const normalized = (raw as Record<string, unknown>)._tarlink_instruction;
    if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) return null;
    const candidate = normalized as Record<string, unknown>;
    if (candidate.type !== 'qris' && candidate.type !== 'va') return null;
    return candidate as unknown as PaymentInstruction;
  }

  private rawWithInstruction(raw: unknown, instruction: GatewayInstruction): unknown {
    const base =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : { provider_payload: raw ?? null };
    return { ...base, _tarlink_instruction: instruction };
  }

  private buildInstruction(payment: PaymentRecord): PaymentInstruction {
    const stored = this.instructionFromPayment(payment);
    if (stored) return stored;
    const expiresAt = (payment.expiresAt ?? this.now()).toISOString();
    if (payment.method === 'qris') {
      const payload = payment.providerRef.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      return {
        type: 'qris',
        qr_string: `00020101021226${payload}`,
        expires_at: expiresAt
      };
    }
    if (payment.method.startsWith('va_')) {
      const bank = payment.method.slice(3).toUpperCase();
      const digest = createHash('sha256').update(payment.id).digest('hex');
      const vaNumber = (BigInt(`0x${digest}`) % 1_000_000_000_000n)
        .toString()
        .padStart(12, '0');
      return { type: 'va', va_number: vaNumber, bank, expires_at: expiresAt };
    }
    // Defensive: createDpCharge rejects unsupported rails, so a stored row with
    // no instruction builder is a data problem, never a valid instruction.
    throw new AppError(
      'INTERNAL_ERROR',
      `Metode pembayaran tidak didukung: ${String(payment.method)}`
    );
  }

  private verifySignature(raw: Buffer, signature: string, timestamp?: string | number): void {
    if (!this.webhookSecret) {
      throw new AppError('UNAUTHENTICATED', 'PJP webhook secret is not configured');
    }
    if (!signature) throw new AppError('UNAUTHENTICATED', 'missing webhook signature');
    if (timestamp === undefined || timestamp === null || String(timestamp).length === 0) {
      throw new AppError('UNAUTHENTICATED', 'missing webhook timestamp');
    }

    const timestampText = String(timestamp);
    const timestampSeconds = Number(timestampText);
    if (!Number.isFinite(timestampSeconds)) {
      throw new AppError('UNAUTHENTICATED', 'invalid webhook timestamp');
    }
    const seconds = timestampSeconds > 1e12 ? Math.floor(timestampSeconds / 1000) : timestampSeconds;
    const skew = Math.abs(Math.floor(this.now().getTime() / 1000) - seconds);
    if (skew > WEBHOOK_TOLERANCE_SECONDS) {
      throw new AppError('UNAUTHENTICATED', 'webhook timestamp outside the 300s tolerance');
    }

    const expected = createHmac('sha256', this.webhookSecret)
      .update(`${timestampText}.`)
      .update(raw)
      .digest();
    const providedHex = signature.startsWith('sha256=') ? signature.slice(7) : signature;
    if (!/^[0-9a-fA-F]{64}$/.test(providedHex)) {
      throw new AppError('UNAUTHENTICATED', 'invalid webhook signature format');
    }
    const provided = Buffer.from(providedHex, 'hex');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw new AppError('UNAUTHENTICATED', 'webhook signature mismatch');
    }
  }

  private parseEventDate(value: string | undefined): Date | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  /**
   * Runs `fn` under the platform Idempotency-Key contract (§7.5): the same key
   * with the same request replays the stored response, the same key with a
   * different request is an IDEMPOTENCY_MISMATCH and expired keys are removed
   * by the store.
   */
  private async runIdempotent<T>(
    scope: string,
    opts: RequestOptions,
    requestHash: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const key = opts.idempotencyKey;
    if (!key) return fn();
    const idempotency = new IdempotencyService(this.idempotencyStore, {
      actorId: opts.actorId ?? null,
      ttlSeconds: IDEMPOTENCY_TTL_SECONDS,
      clock: { now: () => this.now() }
    });
    return idempotency.run(key, scope, requestHash, fn);
  }
}
