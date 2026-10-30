import { createHmac } from 'node:crypto';
import type { PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import { AppError } from '@tarlink/core/errors';
import { ACCOUNT, type JournalQueryClient } from '@tarlink/modules/ledger';
import type {
  ClaimRequest,
  IdempotencyRecord,
  IdempotencyStore
} from '@tarlink/platform/idempotency';
import type { BookingPaymentPort, DpPaidInput, FullyPaidInput } from './booking.port';
import {
  PaymentService,
  type PjpWebhookEvent,
  type WebhookResult
} from './payment.service';
import {
  PgPaymentRepository,
  type BookingSnapshot,
  type DpPaymentByBooking,
  type NewAuditLog,
  type NewPayment,
  type NewRefund,
  type NewWebhookEvent,
  type PaymentRecord,
  type PaymentRepository,
  type RefundRecord,
  type RefundTransition,
  type WebhookEventRecord
} from './payment.repository';

const AT = new Date('2026-10-21T09:00:00.000Z');
const SECRET = 'test-pjp-webhook-secret';
const VENDOR = 'vendor-1';
const CUSTOMER = 'customer-1';

interface StoredLine {
  readonly entryId: string;
  readonly accountCode: string;
  readonly vendorId?: string;
  readonly debitIdr: bigint;
  readonly creditIdr: bigint;
}

/** In-memory stand-in for `PgIdempotencyStore`. */
class MemoryIdempotencyStore implements IdempotencyStore {
  readonly rows = new Map<string, IdempotencyRecord>();

  private id(scope: string, key: string, actorId: string | null): string {
    return `${actorId ?? '-'}|${scope}|${key}`;
  }

  async tryClaim(request: ClaimRequest): Promise<boolean> {
    const id = this.id(request.scope, request.key, request.actorId);
    // FixedClock fixtures are older than real "now"; TTL reclaim is not part
    // of these unit tests, so a stored row always wins the race here.
    if (this.rows.has(id)) return false;
    this.rows.set(id, {
      requestHash: request.requestHash,
      status: 'in_progress',
      responseStatus: null,
      responseBody: null,
      lockedUntil: request.lockedUntil,
      expiresAt: request.expiresAt
    });
    return true;
  }

  async read(
    scope: string,
    key: string,
    actorId: string | null
  ): Promise<IdempotencyRecord | null> {
    return this.rows.get(this.id(scope, key, actorId)) ?? null;
  }

  async complete(
    scope: string,
    key: string,
    actorId: string | null,
    responseStatus: number,
    responseBody: unknown
  ): Promise<void> {
    const id = this.id(scope, key, actorId);
    const existing = this.rows.get(id);
    this.rows.set(id, {
      requestHash: existing?.requestHash ?? '',
      status: 'completed',
      responseStatus,
      responseBody,
      lockedUntil: null,
      expiresAt: existing?.expiresAt ?? new Date(Date.now() + 86_400_000)
    });
  }

  async fail(
    scope: string,
    key: string,
    actorId: string | null,
    responseStatus: number
  ): Promise<void> {
    const id = this.id(scope, key, actorId);
    const existing = this.rows.get(id);
    this.rows.set(id, {
      requestHash: existing?.requestHash ?? '',
      status: 'failed',
      responseStatus,
      responseBody: null,
      lockedUntil: null,
      expiresAt: existing?.expiresAt ?? new Date(Date.now() + 86_400_000)
    });
  }

  async takeOver(
    scope: string,
    key: string,
    actorId: string | null,
    lockedUntil: Date
  ): Promise<void> {
    const id = this.id(scope, key, actorId);
    const existing = this.rows.get(id);
    if (!existing) return;
    this.rows.set(id, { ...existing, lockedUntil });
  }
}

class FakeRepository implements PaymentRepository {
  bookings = new Map<string, BookingSnapshot>();
  payments = new Map<string, PaymentRecord>();
  refunds = new Map<string, RefundRecord>();
  webhooks = new Map<string, WebhookEventRecord>();
  journalEntries = new Map<string, string>();
  lines: StoredLine[] = [];
  audits: NewAuditLog[] = [];
  /** Makes `findWebhookEvent` behave like a not-yet-committed concurrent row. */
  hideWebhookRow = false;
  private seq = 0;

  seedBooking(overrides: Partial<BookingSnapshot> = {}): BookingSnapshot {
    const booking: BookingSnapshot = {
      id: 'booking-1',
      customerId: CUSTOMER,
      vendorId: VENDOR,
      lifecycleStatus: 'accepted',
      paymentStatus: 'unpaid',
      paymentDeadline: new Date('2026-10-21T10:00:00.000Z'),
      dpAmountIdr: 1_200_000n,
      pricePackageIdr: 4_000_000n,
      serviceFeeIdr: 25_000n,
      totalCustomerIdr: 4_025_000n,
      ...overrides
    };
    this.bookings.set(booking.id, booking);
    return booking;
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  async transaction<T>(fn: (tx: JournalQueryClient, client: PoolClient) => Promise<T>): Promise<T> {
    return fn(this.tx, this.client);
  }

  /** The client the booking module would join; the fake port never uses it. */
  readonly client = { query: async () => ({ rows: [] }) } as unknown as PoolClient;

  readonly tx: JournalQueryClient = {
    query: async (text, params = []) => {
      if (text.includes('INSERT INTO journal_entries')) {
        const key = String(params[1]);
        if (this.journalEntries.has(key)) return { rows: [] };
        const id = this.nextId('journal');
        this.journalEntries.set(key, id);
        return { rows: [{ id, entry_no: String(this.journalEntries.size) }] };
      }
      if (text.includes('SELECT id, entry_no FROM journal_entries')) {
        const id = this.journalEntries.get(String(params[0]));
        return { rows: id ? [{ id, entry_no: '1' }] : [] };
      }
      if (text.includes('INSERT INTO journal_lines')) {
        this.lines.push({
          entryId: String(params[0]),
          accountCode: String(params[2]),
          vendorId: params[3] === null || params[3] === undefined ? undefined : String(params[3]),
          debitIdr: BigInt(String(params[4])),
          creditIdr: BigInt(String(params[5]))
        });
        return { rows: [] };
      }
      throw new Error(`unexpected SQL on fake tx: ${text}`);
    }
  };

  async lockBooking(_tx: JournalQueryClient, bookingId: string): Promise<BookingSnapshot | null> {
    return this.bookings.get(bookingId) ?? null;
  }

  async lockBookingForPayment(
    _tx: JournalQueryClient,
    paymentId: string
  ): Promise<BookingSnapshot | null> {
    const payment = this.payments.get(paymentId);
    return payment ? this.bookings.get(payment.bookingId) ?? null : null;
  }

  async findActiveDpPayment(
    _tx: JournalQueryClient,
    bookingId: string
  ): Promise<PaymentRecord | null> {
    for (const payment of this.payments.values()) {
      if (
        payment.bookingId === bookingId &&
        payment.kind === 'dp' &&
        (payment.status === 'pending' || payment.status === 'paid')
      ) {
        return payment;
      }
    }
    return null;
  }

  async findLatestDpPaymentByBooking(
    _tx: JournalQueryClient,
    bookingId: string
  ): Promise<DpPaymentByBooking | null> {
    const booking = this.bookings.get(bookingId);
    const matches = [...this.payments.values()].filter(
      (payment) => payment.bookingId === bookingId && payment.kind === 'dp'
    );
    const payment = matches[matches.length - 1];
    if (!booking || !payment) return null;
    return { payment, customerId: booking.customerId };
  }

  async insertPayment(_tx: JournalQueryClient, input: NewPayment): Promise<PaymentRecord> {
    const payment: PaymentRecord = {
      id: this.nextId('pay'),
      bookingId: input.bookingId,
      kind: input.kind,
      method: input.method,
      amountIdr: input.amountIdr,
      feeIdr: input.feeIdr,
      status: 'pending',
      provider: input.provider,
      providerRef: input.providerRef,
      expiresAt: input.expiresAt,
      paidAt: null
    };
    this.payments.set(payment.id, payment);
    return payment;
  }

  async findSettlementPayment(
    _tx: JournalQueryClient,
    bookingId: string,
    status?: PaymentRecord['status']
  ): Promise<PaymentRecord | null> {
    const matches = [...this.payments.values()].filter(
      (payment) =>
        payment.bookingId === bookingId &&
        payment.kind === 'settlement' &&
        (status === undefined || payment.status === status)
    );
    return matches[matches.length - 1] ?? null;
  }

  async insertSettlementPayment(
    _tx: JournalQueryClient,
    input: { bookingId: string; method: string; amountIdr: bigint; feeIdr: bigint }
  ): Promise<PaymentRecord> {
    const payment: PaymentRecord = {
      id: this.nextId('pay'),
      bookingId: input.bookingId,
      kind: 'settlement',
      method: input.method as PaymentRecord['method'],
      amountIdr: input.amountIdr,
      feeIdr: input.feeIdr,
      status: 'pending',
      provider: 'manual',
      providerRef: '',
      expiresAt: null,
      paidAt: null
    };
    this.payments.set(payment.id, payment);
    return payment;
  }

  async lockPayment(_tx: JournalQueryClient, paymentId: string): Promise<PaymentRecord | null> {
    return this.payments.get(paymentId) ?? null;
  }

  async findPaymentByProviderRef(
    _tx: JournalQueryClient,
    provider: string,
    providerRef: string
  ): Promise<PaymentRecord | null> {
    for (const payment of this.payments.values()) {
      if (payment.provider === provider && payment.providerRef === providerRef) return payment;
    }
    return null;
  }

  async markPaymentPaid(
    _tx: JournalQueryClient,
    input: { paymentId: string; paidAt: Date; providerTxnId: string | null; rawPayload: unknown }
  ): Promise<void> {
    const payment = this.payments.get(input.paymentId);
    if (!payment || payment.status !== 'pending') {
      throw new AppError('CONFLICT', 'payment is no longer pending');
    }
    this.payments.set(payment.id, {
      ...payment,
      status: 'paid',
      paidAt: input.paidAt
    });
  }

  async sumRefundedAmount(_tx: JournalQueryClient, paymentId: string): Promise<bigint> {
    let total = 0n;
    for (const refund of this.refunds.values()) {
      if (refund.paymentId === paymentId) total += refund.amountIdr;
    }
    return total;
  }

  async insertRefund(_tx: JournalQueryClient, input: NewRefund): Promise<RefundRecord> {
    const inflight = [...this.refunds.values()].find(
      (refund) =>
        refund.bookingId === input.bookingId &&
        ['requested', 'approved', 'processing'].includes(refund.status)
    );
    if (inflight) {
      // `refunds_one_inflight` -> 23505, mapped to CONFLICT by the adapter.
      throw new AppError('CONFLICT', 'another refund for this booking is still in flight');
    }
    const refund: RefundRecord = {
      id: this.nextId('refund'),
      bookingId: input.bookingId,
      paymentId: input.paymentId,
      amountIdr: input.amountIdr,
      feeIdr: input.feeIdr,
      status: 'requested',
      reasonCode: input.reasonCode,
      requestedBy: input.requestedBy ?? null,
      createdAt: AT
    };
    this.refunds.set(refund.id, refund);
    return refund;
  }

  async lockRefund(_tx: JournalQueryClient, refundId: string): Promise<RefundRecord | null> {
    return this.refunds.get(refundId) ?? null;
  }

  async advanceRefundStatus(
    _tx: JournalQueryClient,
    input: RefundTransition
  ): Promise<RefundRecord> {
    const refund = this.refunds.get(input.refundId);
    if (!refund || refund.status !== input.from) {
      throw new AppError('CONFLICT', `refund ${input.refundId} is no longer in status ${input.from}`);
    }
    const updated: RefundRecord = { ...refund, status: input.to };
    this.refunds.set(updated.id, updated);
    return updated;
  }

  async insertWebhookEvent(
    _tx: JournalQueryClient,
    input: NewWebhookEvent
  ): Promise<WebhookEventRecord | null> {
    if (this.webhooks.has(input.externalId)) return null;
    const record: WebhookEventRecord = {
      id: this.nextId('webhook'),
      provider: input.provider,
      externalId: input.externalId,
      eventType: input.eventType,
      status: 'received'
    };
    this.webhooks.set(input.externalId, record);
    return record;
  }

  async findWebhookEvent(
    _tx: JournalQueryClient,
    _provider: string,
    externalId: string
  ): Promise<WebhookEventRecord | null> {
    if (this.hideWebhookRow) return null;
    return this.webhooks.get(externalId) ?? null;
  }

  async markWebhookEvent(
    _tx: JournalQueryClient,
    input: { id: string; status: string; lastError?: string | null }
  ): Promise<void> {
    for (const [key, record] of this.webhooks) {
      if (record.id === input.id) this.webhooks.set(key, { ...record, status: input.status });
    }
  }

  async findJournalEntryId(
    _tx: JournalQueryClient,
    sourceEventKey: string
  ): Promise<string | null> {
    return this.journalEntries.get(sourceEventKey) ?? null;
  }

  async insertAudit(_tx: JournalQueryClient, input: NewAuditLog): Promise<void> {
    this.audits.push(input);
  }

  linesFor(accountCode: string): StoredLine[] {
    return this.lines.filter((line) => line.accountCode === accountCode);
  }
}

class FakeBookingPort implements BookingPaymentPort {
  dpPaidCalls: DpPaidInput[] = [];
  fullyPaidCalls: FullyPaidInput[] = [];
  /** The transaction each transition was asked to join. */
  dpPaidClients: unknown[] = [];
  fullyPaidClients: unknown[] = [];

  async applyDpPaid(input: DpPaidInput, client?: PoolClient): Promise<void> {
    this.dpPaidCalls.push(input);
    this.dpPaidClients.push(client);
  }

  async applyFullyPaid(input: FullyPaidInput, client?: PoolClient): Promise<void> {
    this.fullyPaidCalls.push(input);
    this.fullyPaidClients.push(client);
  }
}

function setup() {
  const repository = new FakeRepository();
  repository.seedBooking();
  const bookingPort = new FakeBookingPort();
  const idempotencyStore = new MemoryIdempotencyStore();
  const service = new PaymentService({
    repository,
    booking: bookingPort,
    idempotencyStore,
    webhookSecret: SECRET,
    provider: 'pjp',
    now: () => AT
  });
  return { repository, bookingPort, idempotencyStore, service };
}

function signed(raw: string, timestampSeconds: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(`${timestampSeconds}.${raw}`).digest('hex');
}

const TIMESTAMP = String(Math.floor(AT.getTime() / 1000));

async function paidWebhook(
  service: PaymentService,
  _repository: FakeRepository,
  event: PjpWebhookEvent
): Promise<WebhookResult> {
  const raw = JSON.stringify(event);
  return service.handleWebhook(raw, signed(raw, TIMESTAMP), { ...event, timestamp: TIMESTAMP });
}

describe('createDpCharge', () => {
  it('creates a pending DP for booking dp_amount_idr and returns an instruction', async () => {
    const { service, repository } = setup();

    const result = await service.createDpCharge('booking-1', 'qris', { actorId: CUSTOMER });

    expect(result.status).toBe('pending');
    expect(result.kind).toBe('dp');
    expect(result.amount_idr).toBe(1_200_000);
    expect(result.currency).toBe('IDR');
    expect(result.payment_instruction.type).toBe('qris');
    expect(result.payment_instruction.qr_string).toContain(result.provider_ref.replace(/[^A-Za-z0-9]/g, ''));
    expect(repository.payments.size).toBe(1);
    expect(repository.lines).toHaveLength(0);
    const stored = [...repository.payments.values()][0];
    expect(stored?.amountIdr).toBe(1_200_000n);
    expect(stored?.feeIdr).toBe(8_400n);
  });

  it('returns a VA instruction for virtual-account methods', async () => {
    const { service } = setup();
    const result = await service.createDpCharge('booking-1', 'va_bca', { actorId: CUSTOMER });
    expect(result.payment_instruction.type).toBe('va');
    expect(result.payment_instruction.bank).toBe('BCA');
    expect(result.payment_instruction.va_number).toMatch(/^\d{12}$/);
  });

  it.each(['gopay', 'ovo', 'dana', 'shopeepay'] as const)(
    'rejects e-wallet method %s instead of building a fake VA',
    async (method) => {
      const { service, repository } = setup();

      await expect(
        service.createDpCharge('booking-1', method, { actorId: CUSTOMER })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(repository.payments.size).toBe(0);
    }
  );

  it('rejects a booking that is not accepted', async () => {
    const { service, repository } = setup();
    repository.seedBooking({ lifecycleStatus: 'requested' });
    await expect(
      service.createDpCharge('booking-1', 'qris', { actorId: CUSTOMER })
    ).rejects.toMatchObject({
      code: 'CONFLICT'
    });
  });

  it('rejects a booking that is already paid', async () => {
    const { service, repository } = setup();
    repository.seedBooking({ paymentStatus: 'dp_paid' });
    await expect(
      service.createDpCharge('booking-1', 'qris', { actorId: CUSTOMER })
    ).rejects.toMatchObject({
      code: 'CONFLICT'
    });
  });

  it('rejects a booking past payment_deadline', async () => {
    const { service, repository } = setup();
    repository.seedBooking({ paymentDeadline: new Date('2026-10-21T08:59:59.000Z') });
    await expect(
      service.createDpCharge('booking-1', 'qris', { actorId: CUSTOMER })
    ).rejects.toMatchObject({
      code: 'CONFLICT'
    });
  });

  it('replays the stored result for the same Idempotency-Key', async () => {
    const { service, repository } = setup();
    const first = await service.createDpCharge('booking-1', 'qris', {
      actorId: CUSTOMER,
      idempotencyKey: 'idem-key-0000000000000001'
    });
    const second = await service.createDpCharge('booking-1', 'qris', {
      actorId: CUSTOMER,
      idempotencyKey: 'idem-key-0000000000000001'
    });
    expect(second).toEqual(first);
    expect(repository.payments.size).toBe(1);
  });

  it('rejects the same Idempotency-Key with a different request', async () => {
    const { service } = setup();
    await service.createDpCharge('booking-1', 'qris', {
      actorId: CUSTOMER,
      idempotencyKey: 'idem-key-0000000000000002'
    });
    await expect(
      service.createDpCharge('booking-1', 'va_bca', {
        actorId: CUSTOMER,
        idempotencyKey: 'idem-key-0000000000000002'
      })
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' });
  });

  describe('ownership', () => {
    it('rejects a booking owned by another customer with NOT_FOUND', async () => {
      const { service, repository } = setup();
      repository.seedBooking({ customerId: 'customer-2' });

      await expect(
        service.createDpCharge('booking-1', 'qris', { actorId: CUSTOMER })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      // Nothing was created: the caller cannot consume the one-active-DP slot.
      expect(repository.payments.size).toBe(0);
    });

    it('never leaks that the foreign booking exists', async () => {
      const { service, repository } = setup();
      repository.seedBooking({ customerId: 'customer-2' });

      const foreign = await service
        .createDpCharge('booking-1', 'qris', { actorId: CUSTOMER })
        .catch((err: AppError) => err);
      const missing = await service
        .createDpCharge('booking-unknown', 'qris', { actorId: CUSTOMER })
        .catch((err: AppError) => err);

      expect((foreign as AppError).code).toBe('NOT_FOUND');
      expect((missing as AppError).code).toBe('NOT_FOUND');
      // The message never mentions ownership or the customer of the booking.
      expect((foreign as AppError).message).not.toMatch(/owner|customer|forbidden/i);
      expect((foreign as AppError).status).toBe(404);
    });

    it('requires an authenticated actor', async () => {
      const { service, repository } = setup();
      await expect(service.createDpCharge('booking-1', 'qris')).rejects.toMatchObject({
        code: 'UNAUTHENTICATED'
      });
      expect(repository.payments.size).toBe(0);
    });
  });
});

describe('handleWebhook /v1/webhooks/pjp', () => {
  it('rejects a bad signature with UNAUTHENTICATED and writes nothing', async () => {
    const { service, repository } = setup();
    const event: PjpWebhookEvent = {
      id: 'evt-bad',
      type: 'payment.paid',
      data: { provider_ref: 'unknown' }
    };
    const raw = JSON.stringify(event);

    await expect(
      service.handleWebhook(raw, 'f'.repeat(64), { ...event, timestamp: TIMESTAMP })
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    expect(repository.webhooks.size).toBe(0);
    expect(repository.lines).toHaveLength(0);
    expect(repository.payments.size).toBe(0);
  });

  it('rejects a stale timestamp (outside 300s)', async () => {
    const { service } = setup();
    const event: PjpWebhookEvent = { id: 'evt-stale', type: 'payment.paid' };
    const raw = JSON.stringify(event);
    const staleTs = String(Number(TIMESTAMP) - 301);

    await expect(
      service.handleWebhook(raw, signed(raw, staleTs), { ...event, timestamp: staleTs })
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects an event without an amount with VALIDATION_ERROR and records nothing', async () => {
    const { service, repository } = setup();
    const charge = await service.createDpCharge('booking-1', 'qris', { actorId: CUSTOMER });
    const event: PjpWebhookEvent = {
      id: 'evt-no-amount',
      type: 'payment.paid',
      data: { provider_ref: charge.provider_ref }
    };
    const raw = JSON.stringify(event);

    await expect(
      service.handleWebhook(raw, signed(raw, TIMESTAMP), { ...event, timestamp: TIMESTAMP })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(repository.webhooks.size).toBe(0);
    expect(repository.journalEntries.size).toBe(0);
    expect(repository.lines).toHaveLength(0);
    expect([...repository.payments.values()][0]?.status).toBe('pending');
  });

  it('posts exactly one DP journal and asks the booking module for the transition', async () => {
    const { service, repository, bookingPort } = setup();
    const charge = await service.createDpCharge('booking-1', 'qris', { actorId: CUSTOMER });

    const result = await paidWebhook(service, repository, {
      id: 'evt-1',
      type: 'payment.paid',
      data: {
        provider_ref: charge.provider_ref,
        provider_txn_id: 'txn-1',
        amount_idr: 1_200_000,
        paid_at: AT.toISOString()
      }
    });

    expect(result.status).toBe('processed');
    expect(result.duplicate).toBe(false);
    expect(result.journal_entry_id).toBeTruthy();

    expect(repository.journalEntries.size).toBe(1);
    expect(repository.journalEntries.has(`payment:${charge.id}:paid`)).toBe(true);
    expect(repository.lines).toHaveLength(4);
    expect(repository.linesFor(ACCOUNT.gateway_clearing.code)[0]?.debitIdr).toBe(1_200_000n);
    expect(repository.linesFor(ACCOUNT.gateway_fee_expense.code)[0]?.debitIdr).toBe(8_400n);
    expect(repository.linesFor(ACCOUNT.escrow_liability_vendor.code)[0]?.creditIdr).toBe(1_200_000n);
    expect(repository.linesFor(ACCOUNT.escrow_liability_vendor.code)[0]?.vendorId).toBe(VENDOR);

    const stored = [...repository.payments.values()][0];
    expect(stored?.status).toBe('paid');

    // The booking module owns the transition; the payment module only states
    // the facts of the payment and hands over its transaction.
    expect(bookingPort.dpPaidCalls).toEqual([
      { bookingId: 'booking-1', amountIdr: 1_200_000n, now: AT }
    ]);
    expect(bookingPort.fullyPaidCalls).toHaveLength(0);
    expect(bookingPort.dpPaidClients[0]).toBe(repository.client);
    expect(repository.webhooks.get('evt-1')?.status).toBe('processed');
  });

  it('does not double-post when the same event id is delivered twice', async () => {
    const { service, repository, bookingPort } = setup();
    const charge = await service.createDpCharge('booking-1', 'qris', { actorId: CUSTOMER });
    const event: PjpWebhookEvent = {
      id: 'evt-dup',
      type: 'payment.succeeded',
      data: { provider_ref: charge.provider_ref, amount_idr: 1_200_000, paid_at: AT.toISOString() }
    };

    const first = await paidWebhook(service, repository, event);
    const second = await paidWebhook(service, repository, event);
    const replay = second as unknown as { duplicate: boolean; status: string };

    expect(first.status).toBe('processed');
    expect(replay.duplicate).toBe(true);
    expect(replay.status).toBe('processed');
    expect(repository.journalEntries.size).toBe(1);
    expect(repository.lines).toHaveLength(4);
    expect(bookingPort.dpPaidCalls).toHaveLength(1);
    expect(repository.webhooks.size).toBe(1);
  });

  it('acknowledges a replayed event id even when the stored row is not readable', async () => {
    const { service, repository } = setup();
    const charge = await service.createDpCharge('booking-1', 'qris', { actorId: CUSTOMER });
    const event: PjpWebhookEvent = {
      id: 'evt-dup-hidden',
      type: 'payment.paid',
      data: { provider_ref: charge.provider_ref, amount_idr: 1_200_000 }
    };

    await paidWebhook(service, repository, event);
    repository.hideWebhookRow = true;

    const replay = await paidWebhook(service, repository, event);
    expect(replay.duplicate).toBe(true);
    expect(replay.status).toBe('duplicate');
    expect(repository.journalEntries.size).toBe(1);
    expect(repository.lines).toHaveLength(4);
  });

  it('marks the event failed and posts nothing on an amount mismatch', async () => {
    const { service, repository } = setup();
    const charge = await service.createDpCharge('booking-1', 'qris', { actorId: CUSTOMER });

    const result = await paidWebhook(service, repository, {
      id: 'evt-mismatch',
      type: 'payment.paid',
      data: { provider_ref: charge.provider_ref, amount_idr: 1_000_000 }
    });

    expect(result.status).toBe('failed');
    expect(repository.lines).toHaveLength(0);
    expect(repository.journalEntries.size).toBe(0);
    expect([...repository.payments.values()][0]?.status).toBe('pending');
  });

  it('ignores a paid event for an unknown provider_ref', async () => {
    const { service, repository } = setup();
    const result = await paidWebhook(service, repository, {
      id: 'evt-unknown',
      type: 'payment.paid',
      data: { provider_ref: 'PJP-UNKNOWN', amount_idr: 1_200_000 }
    });
    expect(result.status).toBe('ignored');
    expect(repository.payments.size).toBe(0);
    expect(repository.journalEntries.size).toBe(0);
  });
});

describe('settlement payment (pelunasan)', () => {
  /** `total_customer_idr - dp_amount_idr`: the outstanding balance. */
  const OUTSTANDING = 2_825_000n;

  async function settlementPayment(repository: FakeRepository) {
    repository.seedBooking({ lifecycleStatus: 'confirmed', paymentStatus: 'dp_paid' });
    return repository.insertPayment(repository.tx, {
      bookingId: 'booking-1',
      kind: 'settlement',
      method: 'qris',
      amountIdr: OUTSTANDING,
      feeIdr: 19_775n,
      provider: 'pjp',
      providerRef: 'PJP-SETTLEMENT-1',
      expiresAt: null
    });
  }

  function settlementEvent(eventId: string) {
    return {
      id: eventId,
      type: 'payment.paid',
      data: {
        provider_ref: 'PJP-SETTLEMENT-1',
        amount_idr: OUTSTANDING.toString(),
        paid_at: AT.toISOString()
      }
    } satisfies PjpWebhookEvent;
  }

  it('routes a settlement payment on a dp_paid booking to applyFullyPaid with the transaction client', async () => {
    const { service, repository, bookingPort } = setup();
    const payment = await settlementPayment(repository);

    const result = await paidWebhook(service, repository, settlementEvent('evt-settlement-1'));

    expect(result.status).toBe('processed');
    expect(bookingPort.fullyPaidCalls).toEqual([
      { bookingId: 'booking-1', amountIdr: OUTSTANDING, now: AT }
    ]);
    expect(bookingPort.fullyPaidClients[0]).toBe(repository.client);
    expect(bookingPort.dpPaidCalls).toHaveLength(0);
    expect(repository.journalEntries.has(`payment:${payment.id}:paid`)).toBe(true);
    expect(repository.journalEntries.size).toBe(1);
    expect(repository.lines).toHaveLength(4);
  });

  it('is idempotent when a settlement webhook is replayed on a fully_paid booking', async () => {
    const { service, repository, bookingPort } = setup();
    await settlementPayment(repository);

    await paidWebhook(service, repository, settlementEvent('evt-settlement-1'));

    // The booking module applied the transition: the booking is fully paid.
    repository.seedBooking({ lifecycleStatus: 'confirmed', paymentStatus: 'fully_paid' });

    // A new event id for the same payment: the payment is already paid.
    const replay = await paidWebhook(service, repository, settlementEvent('evt-settlement-2'));
    expect(replay.status).toBe('processed');
    expect(replay.journal_entry_id).toBeTruthy();

    // No second transition and no second journal entry.
    expect(bookingPort.fullyPaidCalls).toHaveLength(1);
    expect(bookingPort.fullyPaidClients).toHaveLength(1);
    expect(repository.journalEntries.size).toBe(1);
    expect(repository.lines).toHaveLength(4);

    // The very same event id replayed: acknowledged, still one journal entry.
    const sameEvent = await paidWebhook(service, repository, settlementEvent('evt-settlement-1'));
    expect(sameEvent.duplicate).toBe(true);
    expect(sameEvent.status).toBe('processed');
    expect(bookingPort.fullyPaidCalls).toHaveLength(1);
    expect(repository.journalEntries.size).toBe(1);
    expect(repository.lines).toHaveLength(4);
  });
});

describe('settleManual (manual settlement)', () => {
  const OUTSTANDING = 2_825_000n;
  const ACTOR = 'admin-finance';

  function dpPaidBooking(repository: FakeRepository, overrides: Partial<BookingSnapshot> = {}) {
    return repository.seedBooking({
      lifecycleStatus: 'completed',
      paymentStatus: 'dp_paid',
      ...overrides
    });
  }

  it('posts one balanced settlement_received entry, marks the payment and moves the booking', async () => {
    const { service, repository, bookingPort } = setup();
    dpPaidBooking(repository);

    const result = await service.settleManual({
      bookingId: 'booking-1',
      amountIdr: OUTSTANDING,
      method: 'transfer_manual',
      reference: 'TRX-MANUAL-1',
      actorId: ACTOR,
      now: AT
    });

    expect(result.alreadySettled).toBe(false);
    expect(result.outstandingBeforeIdr).toBe(OUTSTANDING);
    expect(result.journalEntryId).toBeTruthy();

    const settlement = [...repository.payments.values()].find(
      (payment) => payment.kind === 'settlement'
    );
    expect(settlement?.provider).toBe('manual');
    expect(settlement?.method).toBe('transfer_manual');
    expect(settlement?.status).toBe('paid');
    expect(result.paymentId).toBe(settlement?.id);

    expect(repository.journalEntries.has(`payment:${settlement?.id}:paid`)).toBe(true);
    expect(repository.journalEntries.size).toBe(1);
    expect(repository.lines).toHaveLength(2);
    const debit = repository.lines.reduce((sum, line) => sum + line.debitIdr, 0n);
    const credit = repository.lines.reduce((sum, line) => sum + line.creditIdr, 0n);
    expect(debit).toBe(OUTSTANDING);
    expect(credit).toBe(OUTSTANDING);
    expect(repository.linesFor(ACCOUNT.gateway_clearing.code)[0]?.debitIdr).toBe(OUTSTANDING);
    expect(repository.linesFor(ACCOUNT.escrow_liability_vendor.code)[0]?.creditIdr).toBe(OUTSTANDING);

    expect(bookingPort.fullyPaidCalls).toEqual([
      { bookingId: 'booking-1', amountIdr: OUTSTANDING, now: AT, allowAfterCompletion: true }
    ]);
    expect(bookingPort.fullyPaidClients[0]).toBe(repository.client);
  });

  it('is idempotent on replay: same journal, no new entry, alreadySettled=true', async () => {
    const { service, repository, bookingPort } = setup();
    dpPaidBooking(repository);

    const first = await service.settleManual({
      bookingId: 'booking-1',
      amountIdr: OUTSTANDING,
      method: 'transfer_manual',
      actorId: ACTOR,
      now: AT
    });

    // The booking module applied the transition in the same transaction.
    repository.seedBooking({ lifecycleStatus: 'completed', paymentStatus: 'fully_paid' });

    const replay = await service.settleManual({
      bookingId: 'booking-1',
      amountIdr: OUTSTANDING,
      method: 'transfer_manual',
      actorId: ACTOR,
      now: AT
    });

    expect(replay.alreadySettled).toBe(true);
    expect(replay.journalEntryId).toBe(first.journalEntryId);
    expect(replay.paymentId).toBe(first.paymentId);
    expect(repository.journalEntries.size).toBe(1);
    expect(repository.lines).toHaveLength(2);
    expect(bookingPort.fullyPaidCalls).toHaveLength(1);
    expect([...repository.payments.values()].filter((p) => p.kind === 'settlement')).toHaveLength(1);
  });

  it('reuses an existing pending settlement row instead of inserting a second one', async () => {
    const { service, repository } = setup();
    dpPaidBooking(repository);
    const existing = await repository.insertSettlementPayment(repository.tx, {
      bookingId: 'booking-1',
      method: 'va_bca',
      amountIdr: OUTSTANDING,
      feeIdr: 0n
    });

    const result = await service.settleManual({
      bookingId: 'booking-1',
      amountIdr: OUTSTANDING,
      method: 'transfer_manual',
      actorId: ACTOR,
      now: AT
    });

    expect(result.paymentId).toBe(existing.id);
    expect([...repository.payments.values()].filter((p) => p.kind === 'settlement')).toHaveLength(1);
  });

  it('refuses an amount that is not the outstanding balance', async () => {
    const { service, repository } = setup();
    dpPaidBooking(repository);

    await expect(
      service.settleManual({
        bookingId: 'booking-1',
        amountIdr: OUTSTANDING - 1n,
        method: 'transfer_manual',
        actorId: ACTOR
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(repository.payments.size).toBe(0);
    expect(repository.journalEntries.size).toBe(0);
  });

  it('refuses a booking that is not dp_paid', async () => {
    const { service, repository } = setup();
    dpPaidBooking(repository, { paymentStatus: 'unpaid' });

    await expect(
      service.settleManual({
        bookingId: 'booking-1',
        amountIdr: OUTSTANDING,
        method: 'transfer_manual',
        actorId: ACTOR
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(repository.payments.size).toBe(0);
    expect(repository.journalEntries.size).toBe(0);
  });

  it('requires a non-empty actor', async () => {
    const { service, repository } = setup();
    dpPaidBooking(repository);

    await expect(
      service.settleManual({
        bookingId: 'booking-1',
        amountIdr: OUTSTANDING,
        method: 'transfer_manual',
        actorId: '  '
      })
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('refuses a method outside transfer_manual/cash', async () => {
    const { service, repository } = setup();
    dpPaidBooking(repository);

    await expect(
      service.settleManual({
        bookingId: 'booking-1',
        amountIdr: OUTSTANDING,
        method: 'va_bca',
        actorId: ACTOR
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(repository.payments.size).toBe(0);
    expect(repository.journalEntries.size).toBe(0);
  });

  it('writes one audit row in the settlement and none on replay', async () => {
    const { service, repository } = setup();
    dpPaidBooking(repository);

    const input = {
      bookingId: 'booking-1',
      amountIdr: OUTSTANDING,
      method: 'transfer_manual' as const,
      actorId: ACTOR,
      audit: {
        action: 'booking.settle_manual',
        actorId: ACTOR,
        actorRole: 'admin_finance' as const,
        requestId: 'x'.repeat(200),
        payload: { payment_status: 'fully_paid', method: 'transfer_manual' }
      }
    };

    const first = await service.settleManual(input);
    expect(repository.audits).toHaveLength(1);
    expect(repository.audits[0]).toMatchObject({
      action: 'booking.settle_manual',
      actorId: ACTOR,
      actorRole: 'admin_finance',
      entityType: 'booking',
      entityId: 'booking-1',
      beforeState: { payment_status: 'dp_paid', outstanding_idr: 2_825_000 },
      afterState: {
        payment_status: 'fully_paid',
        payment_id: first.paymentId,
        journal_entry_id: first.journalEntryId
      }
    });
    expect(repository.audits[0]?.requestId).toHaveLength(40);

    repository.seedBooking({ lifecycleStatus: 'completed', paymentStatus: 'fully_paid' });
    const replay = await service.settleManual(input);

    expect(replay.alreadySettled).toBe(true);
    expect(repository.audits).toHaveLength(1);
    expect(repository.journalEntries.size).toBe(1);
  });
});

describe('refund', () => {
  async function paidPayment() {
    const context = setup();
    const charge = await context.service.createDpCharge('booking-1', 'qris', {
      actorId: CUSTOMER
    });
    await paidWebhook(context.service, context.repository, {
      id: 'evt-refund-setup',
      type: 'payment.paid',
      data: { provider_ref: charge.provider_ref, amount_idr: 1_200_000, paid_at: AT.toISOString() }
    });
    return { ...context, charge };
  }

  it('posts a full refund journal (escrow debit, refund payable + fee recovery)', async () => {
    const { service, repository, charge } = await paidPayment();

    const result = await service.refund(charge.id, 1_200_000n, 'customer_cancel_gt_30d', {
      actorId: 'admin-finance'
    });

    expect(result.amount_idr).toBe(1_200_000);
    expect(result.fee_idr).toBe(8_400);
    expect(repository.refunds.size).toBe(1);
    const entryLines = repository.lines.slice(4);
    expect(entryLines).toHaveLength(3);
    const escrow = entryLines.find((line) => line.accountCode === ACCOUNT.escrow_liability_vendor.code);
    const payable = entryLines.find((line) => line.accountCode === ACCOUNT.refund_payable.code);
    const fee = entryLines.find((line) => line.accountCode === ACCOUNT.gateway_fee_expense.code);
    expect(escrow?.debitIdr).toBe(1_200_000n);
    expect(payable?.creditIdr).toBe(1_191_600n);
    expect(fee?.creditIdr).toBe(8_400n);
  });

  it('rejects a refund above the captured amount', async () => {
    const { service, charge } = await paidPayment();
    await expect(
      service.refund(charge.id, 1_200_001n, 'too_much', { actorId: 'admin-finance' })
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
  });

  it('rejects a second refund that exceeds the remaining captured amount', async () => {
    const { service, charge } = await paidPayment();
    await service.refund(charge.id, 500_000n, 'partial', { actorId: 'admin-finance' });
    await expect(
      service.refund(charge.id, 700_001n, 'partial-2', { actorId: 'admin-finance' })
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
  });

  it('rejects a refund while the payment is still pending', async () => {
    const { service, repository } = setup();
    const charge = await service.createDpCharge('booking-1', 'qris', { actorId: CUSTOMER });
    await expect(
      service.refund(charge.id, 100_000n, 'not_paid', { actorId: 'admin-finance' })
    ).rejects.toMatchObject({
      code: 'CONFLICT'
    });
    expect(repository.refunds.size).toBe(0);
  });

  it('posts a partial refund journal without fee recovery', async () => {
    const { service, repository, charge } = await paidPayment();
    await service.refund(charge.id, 500_000n, 'partial', { actorId: 'admin-finance' });
    const entryLines = repository.lines.slice(4);
    expect(entryLines).toHaveLength(2);
    expect(entryLines.find((line) => line.accountCode === ACCOUNT.refund_payable.code)?.creditIdr).toBe(
      500_000n
    );
  });

  it('requires an authenticated actor', async () => {
    const { service, charge } = await paidPayment();
    await expect(service.refund(charge.id, 100_000n, 'no_actor')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED'
    });
  });
});

describe('refund status advancement', () => {
  async function requestedRefund(amountIdr = 1_200_000n) {
    const context = setup();
    const charge = await context.service.createDpCharge('booking-1', 'qris', {
      actorId: CUSTOMER
    });
    await paidWebhook(context.service, context.repository, {
      id: 'evt-advance-setup',
      type: 'payment.paid',
      data: { provider_ref: charge.provider_ref, amount_idr: 1_200_000, paid_at: AT.toISOString() }
    });
    const refund = await context.service.refund(charge.id, amountIdr, 'customer_cancel', {
      actorId: 'admin-finance'
    });
    return { ...context, charge, refund };
  }

  it('walks requested -> approved -> processing -> succeeded and posts the disbursement', async () => {
    const { service, repository, refund } = await requestedRefund();

    const approved = await service.advanceRefund(refund.id, 'approved', { actorId: 'admin-super' });
    expect(approved.status).toBe('approved');
    expect(approved.journal_entry_id).toBeUndefined();

    const processing = await service.advanceRefund(refund.id, 'processing', { actorId: 'admin-super' });
    expect(processing.status).toBe('processing');

    const succeeded = await service.advanceRefund(refund.id, 'succeeded', {
      actorId: 'admin-super',
      providerRefundId: 'PJP-REFUND-1'
    });
    expect(succeeded.status).toBe('succeeded');
    expect(succeeded.journal_entry_id).toBeTruthy();

    // The disbursement entry: refund payable -> gateway clearing.
    const disbursed = repository.lines.filter(
      (line) => line.entryId === succeeded.journal_entry_id
    );
    expect(disbursed).toHaveLength(2);
    expect(disbursed.find((line) => line.accountCode === ACCOUNT.refund_payable.code)?.debitIdr).toBe(
      1_191_600n
    );
    expect(
      disbursed.find((line) => line.accountCode === ACCOUNT.gateway_clearing.code)?.creditIdr
    ).toBe(1_191_600n);
    expect(repository.journalEntries.has(`refund:${refund.id}:disbursed`)).toBe(true);
  });

  it('rejects a transition that skips a step', async () => {
    const { service, refund } = await requestedRefund();
    await expect(
      service.advanceRefund(refund.id, 'succeeded', { actorId: 'admin-super' })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects an approver that is also the requester', async () => {
    const { service, refund } = await requestedRefund();
    await expect(
      service.advanceRefund(refund.id, 'approved', { actorId: 'admin-finance' })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('frees the one-inflight slot once the refund succeeded', async () => {
    const { service, repository, refund, charge } = await requestedRefund(500_000n);
    await service.advanceRefund(refund.id, 'approved', { actorId: 'admin-super' });
    await service.advanceRefund(refund.id, 'processing', { actorId: 'admin-super' });
    await service.advanceRefund(refund.id, 'succeeded', { actorId: 'admin-super' });

    const second = await service.refund(charge.id, 100_000n, 'second', { actorId: 'admin-finance' });
    expect(second.status).toBe('requested');
    expect(repository.refunds.size).toBe(2);
  });
});

describe('PgPaymentRepository', () => {
  it('maps 23505 on refunds_one_inflight to CONFLICT', async () => {
    const repository = new PgPaymentRepository();
    const tx: JournalQueryClient = {
      query: async () => {
        throw Object.assign(new Error('duplicate key value violates unique constraint'), {
          code: '23505',
          constraint: 'refunds_one_inflight'
        });
      }
    };

    const error = await repository
      .insertRefund(tx, {
        bookingId: 'booking-1',
        paymentId: 'pay-1',
        amountIdr: 1_000n,
        feeIdr: 0n,
        reasonCode: 'customer_cancel'
      })
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('CONFLICT');
    expect((error as AppError).details).toEqual({ constraint: 'refunds_one_inflight' });
  });

  it('maps 23505 on payments_one_active_dp to CONFLICT', async () => {
    const repository = new PgPaymentRepository();
    const tx: JournalQueryClient = {
      query: async () => {
        throw Object.assign(new Error('duplicate key value violates unique constraint'), {
          code: '23505',
          constraint: 'payments_one_active_dp'
        });
      }
    };

    const error = await repository
      .insertPayment(tx, {
        bookingId: 'booking-1',
        kind: 'dp',
        method: 'qris',
        amountIdr: 1_000n,
        feeIdr: 0n,
        provider: 'pjp',
        providerRef: 'PJP-1',
        expiresAt: null
      })
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('CONFLICT');
  });
});

describe('getDpPaymentByBooking', () => {
  it('returns the pending DP with the instruction rebuilt by the charge helper', async () => {
    const { service } = setup();
    const charge = await service.createDpCharge('booking-1', 'qris', { actorId: CUSTOMER });

    const result = await service.getDpPaymentByBooking('booking-1', { actorId: CUSTOMER });

    expect(result.payment).toEqual({
      id: charge.id,
      booking_id: 'booking-1',
      kind: 'dp',
      status: 'pending',
      amount_idr: 1_200_000,
      currency: 'IDR',
      method: 'qris',
      provider: 'pjp',
      provider_ref: charge.provider_ref,
      expires_at: charge.expires_at,
      paid_at: null
    });
    expect(result.payment_instruction).toEqual(charge.payment_instruction);
    expect(result.payment_instruction?.type).toBe('qris');
  });

  it('returns a null instruction once the DP is paid', async () => {
    const { service, repository } = setup();
    const charge = await service.createDpCharge('booking-1', 'qris', { actorId: CUSTOMER });
    await repository.markPaymentPaid(repository.tx, {
      paymentId: charge.id,
      paidAt: AT,
      providerTxnId: 'PJP-TXN-1',
      rawPayload: {}
    });

    const result = await service.getDpPaymentByBooking('booking-1', { actorId: CUSTOMER });

    expect(result.payment.status).toBe('paid');
    expect(result.payment.paid_at).toBe(AT.toISOString());
    expect(result.payment_instruction).toBeNull();
  });

  it('returns a null instruction for an expired DP', async () => {
    const { service, repository } = setup();
    const charge = await service.createDpCharge('booking-1', 'va_bca', { actorId: CUSTOMER });
    const stored = repository.payments.get(charge.id);
    if (!stored) throw new Error('payment not stored');
    repository.payments.set(charge.id, { ...stored, status: 'expired' });

    const result = await service.getDpPaymentByBooking('booking-1', { actorId: CUSTOMER });

    expect(result.payment.status).toBe('expired');
    expect(result.payment_instruction).toBeNull();
  });

  it('answers NOT_FOUND when the booking has no DP payment', async () => {
    const { service } = setup();

    await expect(
      service.getDpPaymentByBooking('booking-1', { actorId: CUSTOMER })
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Belum ada tagihan DP untuk booking ini'
    });
  });

  it('rejects a caller that does not own the booking with NOT_FOUND', async () => {
    const { service } = setup();
    await service.createDpCharge('booking-1', 'qris', { actorId: CUSTOMER });

    await expect(
      service.getDpPaymentByBooking('booking-1', { actorId: 'other-customer' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects an unauthenticated caller', async () => {
    const { service } = setup();

    await expect(service.getDpPaymentByBooking('booking-1')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED'
    });
  });
});
