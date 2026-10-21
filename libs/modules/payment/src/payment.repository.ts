/**
 * Payment/refund persistence ports.
 *
 * `PaymentService` depends only on the interfaces; `PgPaymentRepository` is the
 * PostgreSQL adapter. Every money column arrives from `pg` as a string and is
 * converted with BigInt (`toBigInt`), never parseFloat.
 */
import { AppError } from '@tarlink/core/errors';
import { withTransaction } from '@tarlink/core/db';
import type { PoolClient } from 'pg';
import type { JournalQueryClient } from '@tarlink/modules/ledger';

export type PaymentKind = 'dp' | 'settlement';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'expired';

export const PAYMENT_METHODS = [
  'qris',
  'va_bca',
  'va_bni',
  'va_bri',
  'va_mandiri',
  'gopay',
  'ovo',
  'dana',
  'shopeepay'
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface BookingSnapshot {
  readonly id: string;
  readonly customerId: string;
  readonly vendorId: string;
  readonly lifecycleStatus: string;
  readonly paymentStatus: string;
  readonly paymentDeadline: Date | null;
  readonly dpAmountIdr: bigint;
  readonly pricePackageIdr: bigint;
  readonly serviceFeeIdr: bigint;
  readonly totalCustomerIdr: bigint;
}

export interface PaymentRecord {
  readonly id: string;
  readonly bookingId: string;
  readonly kind: PaymentKind;
  readonly method: PaymentMethod;
  readonly amountIdr: bigint;
  readonly feeIdr: bigint;
  readonly status: PaymentStatus;
  readonly provider: string;
  readonly providerRef: string;
  readonly expiresAt: Date | null;
  readonly paidAt: Date | null;
}

export type RefundStatus =
  | 'requested'
  | 'approved'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'rejected';

export interface RefundRecord {
  readonly id: string;
  readonly bookingId: string;
  readonly paymentId: string;
  readonly amountIdr: bigint;
  readonly feeIdr: bigint;
  readonly status: string;
  readonly reasonCode: string;
  readonly requestedBy: string | null;
  readonly createdAt: Date;
}

export interface NewPayment {
  readonly bookingId: string;
  readonly kind: PaymentKind;
  readonly method: PaymentMethod;
  readonly amountIdr: bigint;
  readonly feeIdr: bigint;
  readonly provider: string;
  readonly providerRef: string;
  readonly expiresAt: Date | null;
}

/** Manual settlement row: no gateway, no provider reference. */
export interface NewSettlementPayment {
  readonly bookingId: string;
  readonly method: string;
  readonly amountIdr: bigint;
  readonly feeIdr: bigint;
}

export interface NewRefund {
  readonly bookingId: string;
  readonly paymentId: string;
  readonly amountIdr: bigint;
  readonly feeIdr: bigint;
  readonly reasonCode: string;
  readonly reasonNote?: string;
  readonly requestedBy?: string | null;
}

/** Audit row written inside a caller's money transaction. */
export interface NewAuditLog {
  readonly actorId: string | null;
  readonly actorRole: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly beforeState: unknown;
  readonly afterState: unknown;
  readonly requestId: string | null;
}

export interface NewWebhookEvent {
  readonly provider: string;
  readonly externalId: string;
  readonly eventType: string;
  readonly payload: unknown;
  readonly headers: Record<string, string>;
  readonly signatureValid: boolean;
}

export interface WebhookEventRecord {
  readonly id: string;
  readonly provider: string;
  readonly externalId: string;
  readonly eventType: string;
  readonly status: string;
}

export interface RefundTransition {
  readonly refundId: string;
  /** The only status the refund may currently have. */
  readonly from: RefundStatus;
  readonly to: RefundStatus;
  /** Admin that approved the refund; required for `approved`. */
  readonly actorId?: string | null;
  /** Provider reference of the disbursement; stored on `succeeded`. */
  readonly providerRefundId?: string | null;
}

export interface PaymentRepository {
  /**
   * Runs `fn` inside one transaction. The callback receives the query client
   * and the raw `PoolClient`, so the booking module can join this very
   * transaction (§6.1 rule 7: the journal entry, the payment state and the
   * booking transition commit together).
   */
  transaction<T>(fn: (tx: JournalQueryClient, client: PoolClient) => Promise<T>): Promise<T>;

  lockBooking(tx: JournalQueryClient, bookingId: string): Promise<BookingSnapshot | null>;
  lockBookingForPayment(tx: JournalQueryClient, paymentId: string): Promise<BookingSnapshot | null>;
  findActiveDpPayment(tx: JournalQueryClient, bookingId: string): Promise<PaymentRecord | null>;
  insertPayment(tx: JournalQueryClient, input: NewPayment): Promise<PaymentRecord>;
  findSettlementPayment(
    tx: JournalQueryClient,
    bookingId: string,
    status?: PaymentStatus
  ): Promise<PaymentRecord | null>;
  insertSettlementPayment(
    tx: JournalQueryClient,
    input: NewSettlementPayment
  ): Promise<PaymentRecord>;

  lockPayment(tx: JournalQueryClient, paymentId: string): Promise<PaymentRecord | null>;
  findPaymentByProviderRef(
    tx: JournalQueryClient,
    provider: string,
    providerRef: string
  ): Promise<PaymentRecord | null>;
  markPaymentPaid(
    tx: JournalQueryClient,
    input: { paymentId: string; paidAt: Date; providerTxnId: string | null; rawPayload: unknown }
  ): Promise<void>;

  sumRefundedAmount(tx: JournalQueryClient, paymentId: string): Promise<bigint>;
  insertRefund(tx: JournalQueryClient, input: NewRefund): Promise<RefundRecord>;
  lockRefund(tx: JournalQueryClient, refundId: string): Promise<RefundRecord | null>;
  advanceRefundStatus(tx: JournalQueryClient, input: RefundTransition): Promise<RefundRecord>;

  insertWebhookEvent(tx: JournalQueryClient, input: NewWebhookEvent): Promise<WebhookEventRecord | null>;
  findWebhookEvent(
    tx: JournalQueryClient,
    provider: string,
    externalId: string
  ): Promise<WebhookEventRecord | null>;
  markWebhookEvent(
    tx: JournalQueryClient,
    input: { id: string; status: string; lastError?: string | null }
  ): Promise<void>;

  findJournalEntryId(tx: JournalQueryClient, sourceEventKey: string): Promise<string | null>;
  /** Appends an `audit_logs` row on the settlement transaction's connection. */
  insertAudit(tx: JournalQueryClient, input: NewAuditLog): Promise<void>;
}

/* ------------------------------------------------------------------ mapping */

export function toBigInt(value: unknown, field: string): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new AppError('INTERNAL_ERROR', `${field} is not an integer: ${value}`);
    }
    return BigInt(value);
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  throw new AppError('INTERNAL_ERROR', `${field} is not a valid integer: ${String(value)}`);
}

function toDateOrNull(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new AppError('INTERNAL_ERROR', `invalid timestamp: ${String(value)}`);
  }
  return date;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

/** Name of the violated constraint, when the driver reports one. */
function constraintName(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const name = (error as { constraint?: unknown }).constraint;
  return typeof name === 'string' ? name : undefined;
}

/* -------------------------------------------------------------------- SQL */

const SELECT_BOOKING_SQL = `
SELECT id, customer_id, vendor_id, lifecycle_status, payment_status, payment_deadline,
       dp_amount_idr, price_package_idr, service_fee_idr, total_customer_idr
FROM bookings
WHERE id = $1
FOR UPDATE
`;

const SELECT_BOOKING_FOR_PAYMENT_SQL = `
SELECT b.id, b.customer_id, b.vendor_id, b.lifecycle_status, b.payment_status, b.payment_deadline,
       b.dp_amount_idr, b.price_package_idr, b.service_fee_idr, b.total_customer_idr
FROM bookings b
JOIN payments p ON p.booking_id = b.id
WHERE p.id = $1
FOR UPDATE OF b
`;

const SELECT_ACTIVE_DP_SQL = `
SELECT id, booking_id, kind, method, amount_idr, fee_idr, status, provider, provider_ref,
       expires_at, paid_at
FROM payments
WHERE booking_id = $1 AND kind = 'dp' AND status IN ('pending','paid')
LIMIT 1
`;

const INSERT_PAYMENT_SQL = `
INSERT INTO payments
  (booking_id, kind, method, amount_idr, currency, status, provider, provider_ref, fee_idr, expires_at)
VALUES ($1, $2, $3, $4, 'IDR', 'pending', $5, $6, $7, $8)
RETURNING id, booking_id, kind, method, amount_idr, fee_idr, status, provider, provider_ref,
          expires_at, paid_at
`;

const SELECT_PAYMENT_BY_ID_SQL = `
SELECT id, booking_id, kind, method, amount_idr, fee_idr, status, provider, provider_ref,
       expires_at, paid_at
FROM payments
WHERE id = $1
FOR UPDATE
`;

const SELECT_PAYMENT_BY_PROVIDER_REF_SQL = `
SELECT id, booking_id, kind, method, amount_idr, fee_idr, status, provider, provider_ref,
       expires_at, paid_at
FROM payments
WHERE provider = $1 AND provider_ref = $2
LIMIT 1
`;

const SELECT_SETTLEMENT_SQL = `
SELECT id, booking_id, kind, method, amount_idr, fee_idr, status, provider, provider_ref,
       expires_at, paid_at
FROM payments
WHERE booking_id = $1 AND kind = 'settlement'
  AND ($2::payment_status IS NULL OR status = $2::payment_status)
ORDER BY created_at DESC
LIMIT 1
FOR UPDATE
`;

const INSERT_SETTLEMENT_SQL = `
INSERT INTO payments
  (booking_id, kind, method, amount_idr, currency, status, provider, provider_ref, fee_idr, expires_at)
VALUES ($1, 'settlement', $2, $3, 'IDR', 'pending', 'manual', NULL, $4, NULL)
RETURNING id, booking_id, kind, method, amount_idr, fee_idr, status, provider, provider_ref,
          expires_at, paid_at
`;

const MARK_PAID_SQL = `
UPDATE payments
SET status = 'paid', paid_at = $2, provider_txn_id = $3, raw_payload = $4, updated_at = now()
WHERE id = $1 AND status = 'pending'
RETURNING id
`;

const SUM_REFUNDED_SQL = `
SELECT COALESCE(SUM(amount_idr), 0)::BIGINT AS total
FROM refunds
WHERE payment_id = $1 AND status IN ('requested','approved','processing','succeeded')
`;

const INSERT_REFUND_SQL = `
INSERT INTO refunds
  (booking_id, payment_id, amount_idr, currency, fee_idr, fee_bearer, status,
   reason_code, reason_note, requested_by)
VALUES ($1, $2, $3, 'IDR', $4, 'customer', 'requested', $5, $6, $7)
RETURNING id, booking_id, payment_id, amount_idr, fee_idr, status, reason_code, requested_by, created_at
`;

const SELECT_REFUND_SQL = `
SELECT id, booking_id, payment_id, amount_idr, fee_idr, status, reason_code, requested_by, created_at
FROM refunds
WHERE id = $1
FOR UPDATE
`;

/**
 * Status advancement of one refund. The `WHERE status = $5` guard makes the
 * transition atomic: only the status the caller expects can move forward.
 */
const ADVANCE_REFUND_SQL = `
UPDATE refunds
SET status = $2::refund_status,
    approved_by = CASE WHEN $2::text = 'approved' THEN $3::uuid ELSE approved_by END,
    approved_at = CASE WHEN $2::text = 'approved' THEN now() ELSE approved_at END,
    processed_at = CASE WHEN $2::text IN ('processing', 'succeeded') THEN now() ELSE processed_at END,
    provider_refund_id = COALESCE($4, provider_refund_id),
    updated_at = now()
WHERE id = $1 AND status = $5::refund_status
RETURNING id, booking_id, payment_id, amount_idr, fee_idr, status, reason_code, requested_by, created_at
`;

const INSERT_WEBHOOK_SQL = `
INSERT INTO webhook_events
  (provider, external_id, event_type, payload, headers, signature_valid, status)
VALUES ($1, $2, $3, $4, $5, $6, 'received')
ON CONFLICT (provider, external_id) DO NOTHING
RETURNING id, provider, external_id, event_type, status
`;

const SELECT_WEBHOOK_SQL = `
SELECT id, provider, external_id, event_type, status
FROM webhook_events
WHERE provider = $1 AND external_id = $2
`;

const MARK_WEBHOOK_SQL = `
UPDATE webhook_events
SET status = $2, processed_at = now(), last_error = $3
WHERE id = $1
`;

const SELECT_JOURNAL_ENTRY_SQL = `
SELECT id FROM journal_entries WHERE source_event_key = $1
`;

const INSERT_AUDIT_SQL = `
INSERT INTO audit_logs
  (actor_id, actor_role, action, entity_type, entity_id,
   before_state, after_state, request_id)
VALUES ($1::uuid, $2::user_role, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
`;

/* -------------------------------------------------------------- adapter */

export class PgPaymentRepository implements PaymentRepository {
  async transaction<T>(fn: (tx: JournalQueryClient, client: PoolClient) => Promise<T>): Promise<T> {
    return withTransaction(async (client: PoolClient) =>
      fn(client as unknown as JournalQueryClient, client)
    );
  }

  async lockBooking(tx: JournalQueryClient, bookingId: string): Promise<BookingSnapshot | null> {
    const { rows } = await tx.query(SELECT_BOOKING_SQL, [bookingId]);
    const row = rows[0];
    return row ? mapBooking(row) : null;
  }

  async lockBookingForPayment(
    tx: JournalQueryClient,
    paymentId: string
  ): Promise<BookingSnapshot | null> {
    const { rows } = await tx.query(SELECT_BOOKING_FOR_PAYMENT_SQL, [paymentId]);
    const row = rows[0];
    return row ? mapBooking(row) : null;
  }

  async findActiveDpPayment(
    tx: JournalQueryClient,
    bookingId: string
  ): Promise<PaymentRecord | null> {
    const { rows } = await tx.query(SELECT_ACTIVE_DP_SQL, [bookingId]);
    const row = rows[0];
    return row ? mapPayment(row) : null;
  }

  async insertPayment(tx: JournalQueryClient, input: NewPayment): Promise<PaymentRecord> {
    try {
      const { rows } = await tx.query(INSERT_PAYMENT_SQL, [
        input.bookingId,
        input.kind,
        input.method,
        input.amountIdr.toString(),
        input.provider,
        input.providerRef,
        input.feeIdr.toString(),
        input.expiresAt ? input.expiresAt.toISOString() : null
      ]);
      const row = rows[0];
      if (!row) throw new AppError('INTERNAL_ERROR', 'payment insert returned no row');
      return mapPayment(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(
          'CONFLICT',
          'an active DP payment already exists for this booking',
          { constraint: 'payments_one_active_dp' }
        );
      }
      throw error;
    }
  }

  async lockPayment(tx: JournalQueryClient, paymentId: string): Promise<PaymentRecord | null> {
    const { rows } = await tx.query(SELECT_PAYMENT_BY_ID_SQL, [paymentId]);
    const row = rows[0];
    return row ? mapPayment(row) : null;
  }

  async findSettlementPayment(
    tx: JournalQueryClient,
    bookingId: string,
    status?: PaymentStatus
  ): Promise<PaymentRecord | null> {
    const { rows } = await tx.query(SELECT_SETTLEMENT_SQL, [bookingId, status ?? null]);
    const row = rows[0];
    return row ? mapPayment(row) : null;
  }

  async insertSettlementPayment(
    tx: JournalQueryClient,
    input: NewSettlementPayment
  ): Promise<PaymentRecord> {
    try {
      const { rows } = await tx.query(INSERT_SETTLEMENT_SQL, [
        input.bookingId,
        input.method,
        input.amountIdr.toString(),
        input.feeIdr.toString()
      ]);
      const row = rows[0];
      if (!row) throw new AppError('INTERNAL_ERROR', 'settlement insert returned no row');
      return mapPayment(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        // `payments_one_settlement` (007): at most one active settlement row.
        throw new AppError(
          'CONFLICT',
          'booking ini sudah punya baris pelunasan aktif',
          { constraint: 'payments_one_settlement' }
        );
      }
      throw error;
    }
  }

  async findPaymentByProviderRef(
    tx: JournalQueryClient,
    provider: string,
    providerRef: string
  ): Promise<PaymentRecord | null> {
    const { rows } = await tx.query(SELECT_PAYMENT_BY_PROVIDER_REF_SQL, [provider, providerRef]);
    const row = rows[0];
    return row ? mapPayment(row) : null;
  }

  async markPaymentPaid(
    tx: JournalQueryClient,
    input: { paymentId: string; paidAt: Date; providerTxnId: string | null; rawPayload: unknown }
  ): Promise<void> {
    const result = await tx.query(MARK_PAID_SQL, [
      input.paymentId,
      input.paidAt.toISOString(),
      input.providerTxnId,
      input.rawPayload === undefined ? null : JSON.stringify(input.rawPayload)
    ]);
    if (result.rows.length === 0) {
      throw new AppError('CONFLICT', 'payment is no longer pending');
    }
  }

  async sumRefundedAmount(tx: JournalQueryClient, paymentId: string): Promise<bigint> {
    const { rows } = await tx.query(SUM_REFUNDED_SQL, [paymentId]);
    return toBigInt(rows[0]?.total ?? 0, 'refunds.total');
  }

  async insertRefund(tx: JournalQueryClient, input: NewRefund): Promise<RefundRecord> {
    try {
      const { rows } = await tx.query(INSERT_REFUND_SQL, [
        input.bookingId,
        input.paymentId,
        input.amountIdr.toString(),
        input.feeIdr.toString(),
        input.reasonCode,
        input.reasonNote ?? null,
        input.requestedBy ?? null
      ]);
      const row = rows[0];
      if (!row) throw new AppError('INTERNAL_ERROR', 'refund insert returned no row');
      return mapRefund(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        // `refunds_one_inflight`: a booking can only hold one refund in
        // requested/approved/processing. The previous one has to reach a
        // terminal status before a new refund can be requested.
        throw new AppError(
          'CONFLICT',
          'another refund for this booking is still in flight',
          { constraint: constraintName(error) ?? 'refunds_one_inflight' }
        );
      }
      throw error;
    }
  }

  async lockRefund(tx: JournalQueryClient, refundId: string): Promise<RefundRecord | null> {
    const { rows } = await tx.query(SELECT_REFUND_SQL, [refundId]);
    const row = rows[0];
    return row ? mapRefund(row) : null;
  }

  async advanceRefundStatus(
    tx: JournalQueryClient,
    input: RefundTransition
  ): Promise<RefundRecord> {
    const { rows } = await tx.query(ADVANCE_REFUND_SQL, [
      input.refundId,
      input.to,
      input.actorId ?? null,
      input.providerRefundId ?? null,
      input.from
    ]);
    const row = rows[0];
    if (!row) {
      throw new AppError(
        'CONFLICT',
        `refund ${input.refundId} is no longer in status ${input.from}`
      );
    }
    return mapRefund(row);
  }

  async insertWebhookEvent(
    tx: JournalQueryClient,
    input: NewWebhookEvent
  ): Promise<WebhookEventRecord | null> {
    try {
      const { rows } = await tx.query(INSERT_WEBHOOK_SQL, [
        input.provider,
        input.externalId,
        input.eventType,
        JSON.stringify(input.payload),
        JSON.stringify(input.headers),
        input.signatureValid
      ]);
      const row = rows[0];
      return row ? mapWebhook(row) : null;
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  async findWebhookEvent(
    tx: JournalQueryClient,
    provider: string,
    externalId: string
  ): Promise<WebhookEventRecord | null> {
    const { rows } = await tx.query(SELECT_WEBHOOK_SQL, [provider, externalId]);
    const row = rows[0];
    return row ? mapWebhook(row) : null;
  }

  async markWebhookEvent(
    tx: JournalQueryClient,
    input: { id: string; status: string; lastError?: string | null }
  ): Promise<void> {
    await tx.query(MARK_WEBHOOK_SQL, [input.id, input.status, input.lastError ?? null]);
  }

  async findJournalEntryId(tx: JournalQueryClient, sourceEventKey: string): Promise<string | null> {
    const { rows } = await tx.query(SELECT_JOURNAL_ENTRY_SQL, [sourceEventKey]);
    return rows[0] ? String(rows[0].id) : null;
  }

  /** `audit_logs.prev_hash`/`row_hash` are filled by the DB hash-chain trigger. */
  async insertAudit(tx: JournalQueryClient, input: NewAuditLog): Promise<void> {
    await tx.query(INSERT_AUDIT_SQL, [
      input.actorId,
      input.actorRole,
      input.action,
      input.entityType,
      input.entityId,
      input.beforeState === null ? null : JSON.stringify(input.beforeState),
      input.afterState === null ? null : JSON.stringify(input.afterState),
      input.requestId
    ]);
  }
}

function mapBooking(row: Record<string, unknown>): BookingSnapshot {
  return {
    id: String(row.id),
    customerId: String(row.customer_id),
    vendorId: String(row.vendor_id),
    lifecycleStatus: String(row.lifecycle_status),
    paymentStatus: String(row.payment_status),
    paymentDeadline: toDateOrNull(row.payment_deadline),
    dpAmountIdr: toBigInt(row.dp_amount_idr, 'bookings.dp_amount_idr'),
    pricePackageIdr: toBigInt(row.price_package_idr, 'bookings.price_package_idr'),
    serviceFeeIdr: toBigInt(row.service_fee_idr, 'bookings.service_fee_idr'),
    totalCustomerIdr: toBigInt(row.total_customer_idr, 'bookings.total_customer_idr')
  };
}

function mapRefund(row: Record<string, unknown>): RefundRecord {
  return {
    id: String(row.id),
    bookingId: String(row.booking_id),
    paymentId: String(row.payment_id),
    amountIdr: toBigInt(row.amount_idr, 'refunds.amount_idr'),
    feeIdr: toBigInt(row.fee_idr, 'refunds.fee_idr'),
    status: String(row.status),
    reasonCode: String(row.reason_code),
    requestedBy: row.requested_by === null || row.requested_by === undefined ? null : String(row.requested_by),
    createdAt: toDateOrNull(row.created_at) ?? new Date()
  };
}

function mapPayment(row: Record<string, unknown>): PaymentRecord {
  return {
    id: String(row.id),
    bookingId: String(row.booking_id),
    kind: String(row.kind) as PaymentKind,
    method: String(row.method) as PaymentMethod,
    amountIdr: toBigInt(row.amount_idr, 'payments.amount_idr'),
    feeIdr: toBigInt(row.fee_idr, 'payments.fee_idr'),
    status: String(row.status) as PaymentStatus,
    provider: String(row.provider),
    providerRef:
      row.provider_ref === null || row.provider_ref === undefined ? '' : String(row.provider_ref),
    expiresAt: toDateOrNull(row.expires_at),
    paidAt: toDateOrNull(row.paid_at)
  };
}

function mapWebhook(row: Record<string, unknown>): WebhookEventRecord {
  return {
    id: String(row.id),
    provider: String(row.provider),
    externalId: String(row.external_id),
    eventType: String(row.event_type),
    status: String(row.status)
  };
}
