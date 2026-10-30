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
  refund: 'POST /v1/payments/:id/refund',
  advanceRefund: 'payment.refund.advance'
} as const;

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
  readonly now?: () => Date;
  readonly newId?: () => string;
  readonly newProviderRef?: (paymentId: string, method: PaymentMethod) => string;
}

export interface RequestOptions {
  readonly actorId?: string | null;
  readonly idempotencyKey?: string;
  readonly requestHash?: string;
  readonly providerRefundId?: string | null;
}

export interface PaymentInstruction {
  readonly type: 'qris' | 'va';
  readonly qr_string?: string;
  readonly va_number?: string;
  readonly bank?: string;
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
  /** Present once the refund is disbursed and the journal entry is posted. */
  readonly journal_entry_id?: string;
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
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly newProviderRef: (paymentId: string, method: PaymentMethod) => string;

  constructor(deps: PaymentServiceDeps) {
    this.repository = deps.repository;
    this.booking = deps.booking;
    this.idempotencyStore = deps.idempotencyStore;
    this.webhookSecret = deps.webhookSecret ?? '';
    this.provider = deps.provider ?? 'pjp';
    this.now = deps.now ?? (() => new Date());
    this.newId = deps.newId ?? (() => randomUUID());
    this.newProviderRef =
      deps.newProviderRef ??
      ((paymentId) => `PJP-${paymentId.replace(/-/g, '').slice(0, 16).toUpperCase()}`);
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
      return this.repository.transaction(async (tx) => {
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
          throw new AppError(
            'CONFLICT',
            'an active DP payment already exists for this booking',
            { paymentId: active.id, status: active.status }
          );
        }

        const paymentId = this.newId();
        const payment = await this.repository.insertPayment(tx, {
          bookingId,
          kind: 'dp',
          method,
          amountIdr,
          feeIdr: computeGatewayFee(amountIdr),
          provider: this.provider,
          providerRef: this.newProviderRef(paymentId, method),
          expiresAt: booking.paymentDeadline
        });

        return this.toChargeResult(payment);
      });
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

    return this.repository.transaction(async (tx, client) => {
      const inserted = await this.repository.insertWebhookEvent(tx, {
        provider: this.provider,
        externalId: event.id,
        eventType: event.type,
        payload: event,
        headers: { signature },
        signatureValid: true
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
    await this.booking.applyFullyPaid(input, client);
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

    const requestHash =
      opts.requestHash ??
      hashRequest({
        payment_id: paymentId,
        amount_idr: amountIdr.toString(),
        reason
      });
    return this.runIdempotent(IDEMPOTENCY_SCOPE.refund, opts, requestHash, async () =>
      this.repository.transaction(async (tx) => {
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
          requestedBy: actorId
        });

        // Recognition entry only; disbursement is posted when the PJP confirms (§6.4 4b/5b).
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

        return {
          id: refund.id,
          payment_id: paymentId,
          booking_id: payment.bookingId,
          amount_idr: jsonRupiah(amountIdr),
          fee_idr: jsonRupiah(feeRecoveredIdr),
          currency: 'IDR' as const,
          status: refund.status,
          reason_code: refund.reasonCode,
          journal_entry_id: posted.id
        };
      })
    );
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

        return {
          id: updated.id,
          payment_id: updated.paymentId,
          booking_id: updated.bookingId,
          amount_idr: jsonRupiah(updated.amountIdr),
          fee_idr: jsonRupiah(updated.feeIdr),
          currency: 'IDR' as const,
          status: updated.status,
          reason_code: updated.reasonCode,
          journal_entry_id: journalEntryId
        };
      })
    );
  }

  /* ---------------------------------------------------------------- helpers */

  private toChargeResult(payment: PaymentRecord): DpChargeResult {
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
      payment_instruction: this.buildInstruction(payment)
    };
  }

  private buildInstruction(payment: PaymentRecord): PaymentInstruction {
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
