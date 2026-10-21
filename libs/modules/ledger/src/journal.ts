/**
 * Pure double-entry journal builder (TECH-DESIGN-v1.0 §6).
 *
 * Rules enforced here, in application code, before anything reaches SQL:
 * - every entry has at least two lines;
 * - every line carries exactly one side, strictly greater than zero;
 * - SUM(debit) === SUM(credit), computed with bigint only;
 * - journal rows are immutable: there is no update path, corrections use
 *   `buildReversal` + a new corrected entry (§6.1 rule 4).
 *
 * `postEntry` writes inside the caller's transaction (§6.1 rule 7); it never
 * opens or commits a transaction of its own.
 */
import { AppError } from '@tarlink/core/errors';
import {
  computeCommission,
  DEFAULT_COMMISSION,
  type CommissionConfig
} from '@tarlink/platform/pricing';
import { ACCOUNT, getAccountByCode } from './accounts';

export type JournalEventType =
  | 'dp_received'
  | 'settlement_received'
  | 'fee_charged'
  | 'fee_recovered'
  | 'release'
  | 'refund_recognized'
  | 'refund_disbursed'
  | 'payout_requested'
  | 'payout_settled'
  | 'clawback_recognized'
  | 'clawback_paid'
  | 'margin_sweep'
  | 'bad_debt_writeoff'
  | 'adjustment'
  | 'reversal';

export type ReferenceType = 'payment' | 'refund' | 'booking' | 'payout' | 'dispute' | 'adjustment';

export interface JournalLine {
  readonly accountCode: string;
  readonly vendorId?: string;
  readonly debitIdr: bigint;
  readonly creditIdr: bigint;
  readonly memo?: string;
}

export interface JournalEntryDraft {
  readonly eventType: JournalEventType;
  readonly sourceEventKey: string;
  readonly referenceType: ReferenceType;
  readonly referenceId?: string;
  readonly bookingId?: string;
  readonly vendorId?: string;
  readonly reversesEntryId?: string;
  readonly occurredAt: Date;
  readonly memo?: string;
  readonly lines: readonly JournalLine[];
}

/** 0.7% QRIS fee assumption from §6.3, expressed in basis points. */
export const GATEWAY_FEE_BP = 70n;

export function computeGatewayFee(amountIdr: bigint, feeBp: bigint = GATEWAY_FEE_BP): bigint {
  assertPositiveOrZero(amountIdr, 'amountIdr');
  if (feeBp < 0n) throw new AppError('CONFLICT', 'gateway fee basis points must not be negative');
  return (amountIdr * feeBp) / 10_000n;
}

export function sumDebits(lines: readonly JournalLine[]): bigint {
  return lines.reduce((total, line) => total + line.debitIdr, 0n);
}

export function sumCredits(lines: readonly JournalLine[]): bigint {
  return lines.reduce((total, line) => total + line.creditIdr, 0n);
}

/**
 * Throws `AppError('CONFLICT')` when the entry is not a valid, balanced journal.
 * `strict` also rejects unknown account codes (used by `postEntry`).
 */
export function assertBalanced(lines: readonly JournalLine[]): void {
  if (lines.length < 2) {
    throw new AppError('CONFLICT', 'journal entry requires at least two lines');
  }

  for (const line of lines) {
    if (typeof line.debitIdr !== 'bigint' || typeof line.creditIdr !== 'bigint') {
      throw new AppError('CONFLICT', 'journal amounts must be bigint');
    }
    if (line.debitIdr < 0n || line.creditIdr < 0n) {
      throw new AppError('CONFLICT', 'journal amounts must not be negative');
    }
    const hasDebit = line.debitIdr > 0n;
    const hasCredit = line.creditIdr > 0n;
    if (hasDebit === hasCredit) {
      throw new AppError(
        'CONFLICT',
        `journal line ${line.accountCode} must carry exactly one side greater than zero`
      );
    }
  }

  const debits = sumDebits(lines);
  const credits = sumCredits(lines);
  if (debits !== credits) {
    throw new AppError(
      'CONFLICT',
      `journal entry is not balanced: debit ${debits.toString()} != credit ${credits.toString()}`
    );
  }
}

function assertKnownAccounts(lines: readonly JournalLine[]): void {
  for (const line of lines) getAccountByCode(line.accountCode);
}

function assertPositive(amount: bigint, field: string): void {
  if (typeof amount !== 'bigint' || amount <= 0n) {
    throw new AppError('CONFLICT', `${field} must be a positive bigint`);
  }
}

function assertPositiveOrZero(amount: bigint, field: string): void {
  if (typeof amount !== 'bigint' || amount < 0n) {
    throw new AppError('CONFLICT', `${field} must be a non-negative bigint`);
  }
}

function assertOccurredAt(occurredAt: Date, field = 'occurredAt'): void {
  if (!(occurredAt instanceof Date) || Number.isNaN(occurredAt.getTime())) {
    throw new AppError('VALIDATION_ERROR', `${field} must be a valid Date`);
  }
}

function debitLine(accountCode: string, amount: bigint, vendorId?: string, memo?: string): JournalLine {
  return { accountCode, debitIdr: amount, creditIdr: 0n, vendorId, memo };
}

function creditLine(accountCode: string, amount: bigint, vendorId?: string, memo?: string): JournalLine {
  return { accountCode, debitIdr: 0n, creditIdr: amount, vendorId, memo };
}

function assertVendorScoped(accountCode: string, vendorId: string | undefined): void {
  const account = getAccountByCode(accountCode);
  if (account.vendorScoped && !vendorId) {
    throw new AppError('CONFLICT', `account ${account.name} requires a vendorId`);
  }
  if (!account.vendorScoped && vendorId) {
    throw new AppError('CONFLICT', `account ${account.name} must not be vendor scoped`);
  }
}

/* ------------------------------------------------------------------ inputs */

export interface PaymentReceivedInput {
  readonly paymentId: string;
  readonly bookingId: string;
  readonly vendorId: string;
  readonly amountIdr: bigint;
  readonly gatewayFeeIdr?: bigint;
  readonly occurredAt: Date;
  readonly sourceEventKey?: string;
  readonly memo?: string;
}

export interface ReleaseInput {
  readonly bookingId: string;
  readonly vendorId: string;
  /** Funds held in escrow for the booking = total_customer_idr already received. */
  readonly escrowIdr: bigint;
  /** D-17 base: price_package_idr only, never the customer total. */
  readonly commissionBaseIdr: bigint;
  readonly serviceFeeIdr: bigint;
  readonly commissionConfig?: CommissionConfig;
  readonly occurredAt: Date;
  readonly sourceEventKey?: string;
  readonly memo?: string;
}

export interface PayoutInput {
  readonly payoutId: string;
  readonly vendorId: string;
  readonly amountIdr: bigint;
  readonly bookingId?: string;
  readonly occurredAt: Date;
  readonly sourceEventKey?: string;
  readonly memo?: string;
}

export interface RefundRecognizedInput {
  readonly refundId: string;
  readonly bookingId: string;
  readonly vendorId: string;
  /** Escrow released by this refund event (gross customer funds). */
  readonly escrowIdr: bigint;
  /** Amount actually returned to the customer (net of recovered gateway fee). */
  readonly refundNetIdr: bigint;
  readonly gatewayFeeRecoveredIdr?: bigint;
  /** Partial refunds only: commission base retained by the vendor. */
  readonly retainedCommissionBaseIdr?: bigint;
  readonly retainedServiceFeeIdr?: bigint;
  readonly commissionConfig?: CommissionConfig;
  readonly occurredAt: Date;
  readonly sourceEventKey?: string;
  readonly memo?: string;
}

export interface RefundDisbursedInput {
  readonly refundId: string;
  readonly refundNetIdr: bigint;
  readonly bookingId?: string;
  readonly occurredAt: Date;
  readonly sourceEventKey?: string;
  readonly memo?: string;
}

export interface ClawbackRecognizedInput {
  readonly disputeId: string;
  readonly bookingId: string;
  readonly vendorId: string;
  readonly amountIdr: bigint;
  readonly occurredAt: Date;
  readonly sourceEventKey?: string;
  readonly memo?: string;
}

export interface ClawbackPaidInput {
  readonly disputeId: string;
  readonly amountIdr: bigint;
  readonly bookingId?: string;
  readonly occurredAt: Date;
  readonly sourceEventKey?: string;
  readonly memo?: string;
}

export interface GatewayFeeAbsorbedInput {
  readonly disputeId: string;
  readonly amountIdr: bigint;
  readonly bookingId?: string;
  readonly occurredAt: Date;
  readonly sourceEventKey?: string;
  readonly memo?: string;
}

export type RefundScenario = 'refund_full' | 'refund_partial';

export type JournalScenario =
  | 'dp_received'
  | 'settlement_received'
  | 'release'
  | 'payout_requested'
  | 'payout_settled'
  | 'refund_full_recognized'
  | 'refund_partial_recognized'
  | 'refund_disbursed'
  | 'clawback_recognized'
  | 'clawback_paid'
  | 'gateway_fee_absorbed';

export type ScenarioInput =
  | PaymentReceivedInput
  | ReleaseInput
  | PayoutInput
  | RefundRecognizedInput
  | RefundDisbursedInput
  | ClawbackRecognizedInput
  | ClawbackPaidInput
  | GatewayFeeAbsorbedInput;

/* ----------------------------------------------------------------- builder */

export function buildEntry(scenario: JournalScenario, input: ScenarioInput): JournalEntryDraft {
  switch (scenario) {
    case 'dp_received':
      return buildPaymentReceived('dp_received', input as PaymentReceivedInput);
    case 'settlement_received':
      return buildPaymentReceived('settlement_received', input as PaymentReceivedInput);
    case 'release':
      return buildRelease(input as ReleaseInput);
    case 'payout_requested':
      return buildPayoutRequested(input as PayoutInput);
    case 'payout_settled':
      return buildPayoutSettled(input as PayoutInput);
    case 'refund_full_recognized':
      return buildRefundRecognized('refund_full', input as RefundRecognizedInput);
    case 'refund_partial_recognized':
      return buildRefundRecognized('refund_partial', input as RefundRecognizedInput);
    case 'refund_disbursed':
      return buildRefundDisbursed(input as RefundDisbursedInput);
    case 'clawback_recognized':
      return buildClawbackRecognized(input as ClawbackRecognizedInput);
    case 'clawback_paid':
      return buildClawbackPaid(input as ClawbackPaidInput);
    case 'gateway_fee_absorbed':
      return buildGatewayFeeAbsorbed(input as GatewayFeeAbsorbedInput);
    default: {
      const never: never = scenario;
      throw new AppError('VALIDATION_ERROR', `unknown journal scenario: ${String(never)}`);
    }
  }
}

/** §6.4 scenarios 1 and 2: gateway fee is booked in the same atomic entry. */
function buildPaymentReceived(
  eventType: 'dp_received' | 'settlement_received',
  input: PaymentReceivedInput
): JournalEntryDraft {
  assertOccurredAt(input.occurredAt);
  assertPositive(input.amountIdr, 'amountIdr');
  const gatewayFeeIdr = input.gatewayFeeIdr ?? computeGatewayFee(input.amountIdr);
  assertPositiveOrZero(gatewayFeeIdr, 'gatewayFeeIdr');
  if (gatewayFeeIdr >= input.amountIdr) {
    throw new AppError('CONFLICT', 'gateway fee must be smaller than the payment amount');
  }

  const lines: JournalLine[] = [
    debitLine(ACCOUNT.gateway_clearing.code, input.amountIdr, undefined, 'funds receivable from PJP')
  ];
  if (gatewayFeeIdr > 0n) {
    lines.push(debitLine(ACCOUNT.gateway_fee_expense.code, gatewayFeeIdr, undefined, 'gateway fee'));
  }
  lines.push(
    creditLine(
      ACCOUNT.escrow_liability_vendor.code,
      input.amountIdr,
      input.vendorId,
      'customer funds held in escrow'
    )
  );
  if (gatewayFeeIdr > 0n) {
    lines.push(creditLine(ACCOUNT.gateway_clearing.code, gatewayFeeIdr, undefined, 'gateway fee withheld'));
  }

  return finalize({
    eventType,
    sourceEventKey: input.sourceEventKey ?? `payment:${input.paymentId}:paid`,
    referenceType: 'payment',
    referenceId: input.paymentId,
    bookingId: input.bookingId,
    vendorId: input.vendorId,
    occurredAt: input.occurredAt,
    memo: input.memo,
    lines
  });
}

/** §6.4 scenario 3: escrow splits into commission, service fee and vendor payable. */
function buildRelease(input: ReleaseInput): JournalEntryDraft {
  assertOccurredAt(input.occurredAt);
  assertPositive(input.escrowIdr, 'escrowIdr');
  assertPositive(input.commissionBaseIdr, 'commissionBaseIdr');
  assertPositiveOrZero(input.serviceFeeIdr, 'serviceFeeIdr');

  const commission = computeCommission(
    input.commissionBaseIdr,
    input.commissionConfig ?? DEFAULT_COMMISSION
  );
  const vendorPayableIdr =
    input.escrowIdr - commission.total - input.serviceFeeIdr;
  if (vendorPayableIdr < 0n) {
    throw new AppError(
      'CONFLICT',
      'release splits exceed the escrow balance: commission + service fee > escrow'
    );
  }

  const lines: JournalLine[] = [
    debitLine(ACCOUNT.escrow_liability_vendor.code, input.escrowIdr, input.vendorId, 'release escrow'),
    creditLine(
      ACCOUNT.platform_revenue_commission.code,
      commission.total,
      undefined,
      'commission (D-17)'
    )
  ];
  if (input.serviceFeeIdr > 0n) {
    lines.push(
      creditLine(ACCOUNT.platform_revenue_service_fee.code, input.serviceFeeIdr, undefined, 'service fee')
    );
  }

  if (vendorPayableIdr > 0n) {
    lines.push(
      creditLine(ACCOUNT.vendor_payable.code, vendorPayableIdr, input.vendorId, 'vendor entitlement')
    );
  }

  return finalize({
    eventType: 'release',
    sourceEventKey: input.sourceEventKey ?? `booking:${input.bookingId}:released`,
    referenceType: 'booking',
    referenceId: input.bookingId,
    bookingId: input.bookingId,
    vendorId: input.vendorId,
    occurredAt: input.occurredAt,
    memo: input.memo,
    lines
  });
}

/** §6.4 3b: payable leaves the vendor balance and enters payout clearing. */
function buildPayoutRequested(input: PayoutInput): JournalEntryDraft {
  assertOccurredAt(input.occurredAt);
  assertPositive(input.amountIdr, 'amountIdr');

  return finalize({
    eventType: 'payout_requested',
    sourceEventKey: input.sourceEventKey ?? `payout:${input.payoutId}:requested`,
    referenceType: 'payout',
    referenceId: input.payoutId,
    bookingId: input.bookingId,
    vendorId: input.vendorId,
    occurredAt: input.occurredAt,
    memo: input.memo,
    lines: [
      debitLine(ACCOUNT.vendor_payable.code, input.amountIdr, input.vendorId, 'payout requested'),
      creditLine(
        ACCOUNT.vendor_payout_clearing.code,
        input.amountIdr,
        input.vendorId,
        'disbursement in flight'
      )
    ]
  });
}

/** §6.4 3c: disbursement settles against the PJP receivable. */
function buildPayoutSettled(input: PayoutInput): JournalEntryDraft {
  assertOccurredAt(input.occurredAt);
  assertPositive(input.amountIdr, 'amountIdr');

  return finalize({
    eventType: 'payout_settled',
    sourceEventKey: input.sourceEventKey ?? `payout:${input.payoutId}:settled`,
    referenceType: 'payout',
    referenceId: input.payoutId,
    bookingId: input.bookingId,
    vendorId: input.vendorId,
    occurredAt: input.occurredAt,
    memo: input.memo,
    lines: [
      debitLine(
        ACCOUNT.vendor_payout_clearing.code,
        input.amountIdr,
        input.vendorId,
        'disbursement settled'
      ),
      creditLine(ACCOUNT.gateway_clearing.code, input.amountIdr, undefined, 'funds left PJP')
    ]
  });
}

/** §6.4 scenario 4a / 5a: refund recognition, before or after a partial release split. */
function buildRefundRecognized(
  scenario: RefundScenario,
  input: RefundRecognizedInput
): JournalEntryDraft {
  assertOccurredAt(input.occurredAt);
  assertPositive(input.escrowIdr, 'escrowIdr');
  assertPositive(input.refundNetIdr, 'refundNetIdr');
  const gatewayFeeRecoveredIdr = input.gatewayFeeRecoveredIdr ?? 0n;
  assertPositiveOrZero(gatewayFeeRecoveredIdr, 'gatewayFeeRecoveredIdr');

  const lines: JournalLine[] = [
    debitLine(
      ACCOUNT.escrow_liability_vendor.code,
      input.escrowIdr,
      input.vendorId,
      'refund recognized against escrow'
    )
  ];

  let retainedCommissionIdr = 0n;
  let retainedServiceFeeIdr = 0n;

  if (scenario === 'refund_full') {
    if (input.escrowIdr !== input.refundNetIdr + gatewayFeeRecoveredIdr) {
      throw new AppError(
        'CONFLICT',
        'full refund must equal refundNetIdr + gatewayFeeRecoveredIdr'
      );
    }
  } else {
    const commissionBase = input.retainedCommissionBaseIdr ?? 0n;
    assertPositiveOrZero(commissionBase, 'retainedCommissionBaseIdr');
    retainedServiceFeeIdr = input.retainedServiceFeeIdr ?? 0n;
    assertPositiveOrZero(retainedServiceFeeIdr, 'retainedServiceFeeIdr');
    retainedCommissionIdr = computeCommission(
      commissionBase,
      input.commissionConfig ?? DEFAULT_COMMISSION
    ).total;
  }

  const vendorPayableIdr =
    input.escrowIdr -
    input.refundNetIdr -
    gatewayFeeRecoveredIdr -
    retainedCommissionIdr -
    retainedServiceFeeIdr;
  if (vendorPayableIdr < 0n) {
    throw new AppError(
      'CONFLICT',
      'refund splits exceed the escrow balance: refund + fee + commission > escrow'
    );
  }

  lines.push(
    creditLine(ACCOUNT.refund_payable.code, input.refundNetIdr, undefined, 'refund owed to customer')
  );
  if (gatewayFeeRecoveredIdr > 0n) {
    lines.push(
      creditLine(
        ACCOUNT.gateway_fee_expense.code,
        gatewayFeeRecoveredIdr,
        undefined,
        'gateway fee recovered from cancelling party'
      )
    );
  }
  if (retainedCommissionIdr > 0n) {
    lines.push(
      creditLine(
        ACCOUNT.platform_revenue_commission.code,
        retainedCommissionIdr,
        undefined,
        'commission on retained base'
      )
    );
  }
  if (retainedServiceFeeIdr > 0n) {
    lines.push(
      creditLine(
        ACCOUNT.platform_revenue_service_fee.code,
        retainedServiceFeeIdr,
        undefined,
        'service fee retained'
      )
    );
  }
  if (vendorPayableIdr > 0n) {
    lines.push(
      creditLine(ACCOUNT.vendor_payable.code, vendorPayableIdr, input.vendorId, 'vendor retained share')
    );
  }

  return finalize({
    eventType: 'refund_recognized',
    sourceEventKey: input.sourceEventKey ?? `refund:${input.refundId}:recognized`,
    referenceType: 'refund',
    referenceId: input.refundId,
    bookingId: input.bookingId,
    vendorId: input.vendorId,
    occurredAt: input.occurredAt,
    memo: input.memo,
    lines
  });
}

/** §6.4 4b / 5b: refund payable is disbursed, PJP receivable decreases. */
function buildRefundDisbursed(input: RefundDisbursedInput): JournalEntryDraft {
  assertOccurredAt(input.occurredAt);
  assertPositive(input.refundNetIdr, 'refundNetIdr');

  return finalize({
    eventType: 'refund_disbursed',
    sourceEventKey: input.sourceEventKey ?? `refund:${input.refundId}:disbursed`,
    referenceType: 'refund',
    referenceId: input.refundId,
    bookingId: input.bookingId,
    occurredAt: input.occurredAt,
    memo: input.memo,
    lines: [
      debitLine(ACCOUNT.refund_payable.code, input.refundNetIdr, undefined, 'refund disbursed'),
      creditLine(ACCOUNT.gateway_clearing.code, input.refundNetIdr, undefined, 'funds left PJP')
    ]
  });
}

/** §6.4 6a: clawback is recognized as a negative vendor payable covered by the reserve. */
function buildClawbackRecognized(input: ClawbackRecognizedInput): JournalEntryDraft {
  assertOccurredAt(input.occurredAt);
  assertPositive(input.amountIdr, 'amountIdr');

  return finalize({
    eventType: 'clawback_recognized',
    sourceEventKey: input.sourceEventKey ?? `dispute:${input.disputeId}:clawback_recognized`,
    referenceType: 'dispute',
    referenceId: input.disputeId,
    bookingId: input.bookingId,
    vendorId: input.vendorId,
    occurredAt: input.occurredAt,
    memo: input.memo,
    lines: [
      debitLine(ACCOUNT.vendor_payable.code, input.amountIdr, input.vendorId, 'clawback against vendor'),
      creditLine(ACCOUNT.dispute_reserve.code, input.amountIdr, undefined, 'dispute reserve')
    ]
  });
}

/** §6.4 6b: clawback is paid from platform cash, never from other customers' funds. */
function buildClawbackPaid(input: ClawbackPaidInput): JournalEntryDraft {
  assertOccurredAt(input.occurredAt);
  assertPositive(input.amountIdr, 'amountIdr');

  return finalize({
    eventType: 'clawback_paid',
    sourceEventKey: input.sourceEventKey ?? `dispute:${input.disputeId}:clawback_paid`,
    referenceType: 'dispute',
    referenceId: input.disputeId,
    bookingId: input.bookingId,
    occurredAt: input.occurredAt,
    memo: input.memo,
    lines: [
      debitLine(ACCOUNT.dispute_reserve.code, input.amountIdr, undefined, 'reserve released'),
      creditLine(
        ACCOUNT.platform_operating_cash.code,
        input.amountIdr,
        undefined,
        'platform funds paid out'
      )
    ]
  });
}

/** §6.4 6c: gateway fee on the clawback refund is absorbed by the platform (D-03). */
function buildGatewayFeeAbsorbed(input: GatewayFeeAbsorbedInput): JournalEntryDraft {
  assertOccurredAt(input.occurredAt);
  assertPositive(input.amountIdr, 'amountIdr');

  return finalize({
    eventType: 'fee_charged',
    sourceEventKey: input.sourceEventKey ?? `dispute:${input.disputeId}:gateway_fee_absorbed`,
    referenceType: 'dispute',
    referenceId: input.disputeId,
    bookingId: input.bookingId,
    occurredAt: input.occurredAt,
    memo: input.memo,
    lines: [
      debitLine(ACCOUNT.gateway_fee_absorbed.code, input.amountIdr, undefined, 'fee absorbed'),
      creditLine(
        ACCOUNT.platform_operating_cash.code,
        input.amountIdr,
        undefined,
        'platform funds consumed'
      )
    ]
  });
}

/** Convenience: a whole refund scenario = recognition entry + disbursement entry. */
export function buildRefundEntries(
  scenario: RefundScenario,
  input: RefundRecognizedInput & { readonly disbursedAt?: Date }
): readonly [JournalEntryDraft, JournalEntryDraft] {
  const recognized = buildRefundRecognized(scenario, input);
  const disbursed = buildRefundDisbursed({
    refundId: input.refundId,
    refundNetIdr: input.refundNetIdr,
    bookingId: input.bookingId,
    occurredAt: input.disbursedAt ?? input.occurredAt,
    memo: input.memo
  });
  return [recognized, disbursed];
}

/** Convenience: §6.4 scenario 6 = 6a + 6b (+ 6c when a gateway fee was absorbed). */
export function buildClawbackEntries(
  input: ClawbackRecognizedInput & { readonly gatewayFeeAbsorbedIdr?: bigint }
): readonly JournalEntryDraft[] {
  const entries: JournalEntryDraft[] = [
    buildClawbackRecognized(input),
    buildClawbackPaid({
      disputeId: input.disputeId,
      amountIdr: input.amountIdr,
      bookingId: input.bookingId,
      occurredAt: input.occurredAt,
      memo: input.memo
    })
  ];
  if (input.gatewayFeeAbsorbedIdr !== undefined && input.gatewayFeeAbsorbedIdr > 0n) {
    entries.push(
      buildGatewayFeeAbsorbed({
        disputeId: input.disputeId,
        amountIdr: input.gatewayFeeAbsorbedIdr,
        bookingId: input.bookingId,
        occurredAt: input.occurredAt,
        memo: input.memo
      })
    );
  }
  return entries;
}

/**
 * Reversal entry: swaps debit and credit for every line. The original entry is
 * never mutated; `reverses_entry_id` is mandatory (§6.1 rule 4).
 */
export function buildReversal(
  original: JournalEntryDraft & { readonly id?: string },
  overrides: { readonly occurredAt: Date; readonly sourceEventKey?: string; readonly memo?: string }
): JournalEntryDraft {
  assertOccurredAt(overrides.occurredAt);
  const reversesEntryId = original.id ?? original.reversesEntryId;
  if (!reversesEntryId) {
    throw new AppError('CONFLICT', 'reversal requires the original journal entry id');
  }
  if (original.eventType === 'reversal') {
    throw new AppError('CONFLICT', 'a reversal entry cannot itself be reversed');
  }

  const lines = original.lines.map<JournalLine>((line) => ({
    accountCode: line.accountCode,
    vendorId: line.vendorId,
    debitIdr: line.creditIdr,
    creditIdr: line.debitIdr,
    memo: line.memo
  }));

  return finalize({
    eventType: 'reversal',
    sourceEventKey: overrides.sourceEventKey ?? `reversal:${original.sourceEventKey}`,
    referenceType: original.referenceType,
    referenceId: original.referenceId,
    bookingId: original.bookingId,
    vendorId: original.vendorId,
    reversesEntryId,
    occurredAt: overrides.occurredAt,
    memo: overrides.memo ?? `reversal of ${original.sourceEventKey}`,
    lines
  });
}

function finalize(
  draft: Omit<JournalEntryDraft, 'lines'> & { readonly lines: readonly JournalLine[] }
): JournalEntryDraft {
  if (draft.sourceEventKey.length === 0 || draft.sourceEventKey.length > 160) {
    throw new AppError('CONFLICT', 'sourceEventKey must be 1..160 characters');
  }
  assertBalanced(draft.lines);
  assertKnownAccounts(draft.lines);
  for (const line of draft.lines) assertVendorScoped(line.accountCode, line.vendorId);

  return Object.freeze({
    ...draft,
    lines: Object.freeze(draft.lines.map((line) => Object.freeze({ ...line })))
  });
}

/* ----------------------------------------------------------------- posting */

export interface JournalQueryResult {
  readonly rows: Array<Record<string, unknown>>;
}

/** Minimal structural client: satisfied by `pg.PoolClient` and by test fakes. */
export interface JournalQueryClient {
  query(text: string, params?: readonly unknown[]): Promise<JournalQueryResult>;
}

export interface PostedEntry {
  readonly id: string;
  readonly entryNo: string;
  readonly inserted: boolean;
}

const INSERT_ENTRY_SQL = `
INSERT INTO journal_entries
  (event_type, source_event_key, reference_type, reference_id, booking_id, vendor_id,
   reverses_entry_id, memo, occurred_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
ON CONFLICT (source_event_key) DO NOTHING
RETURNING id, entry_no
`;

const SELECT_ENTRY_BY_KEY_SQL = `
SELECT id, entry_no FROM journal_entries WHERE source_event_key = $1
`;

const INSERT_LINE_SQL = `
INSERT INTO journal_lines
  (journal_entry_id, line_no, account_code, vendor_id, debit_idr, credit_idr, memo)
VALUES ($1, $2, $3, $4, $5, $6, $7)
`;

/**
 * Inserts one entry + its lines inside the caller's transaction.
 * Idempotent by `source_event_key`: a duplicate returns the existing id and
 * writes nothing. Journal rows are never updated.
 */
export async function postEntry(
  client: JournalQueryClient,
  entry: JournalEntryDraft
): Promise<PostedEntry> {
  assertOccurredAt(entry.occurredAt);
  assertBalanced(entry.lines);
  assertKnownAccounts(entry.lines);
  for (const line of entry.lines) assertVendorScoped(line.accountCode, line.vendorId);

  if (entry.eventType === 'reversal' && !entry.reversesEntryId) {
    throw new AppError('CONFLICT', 'reversal entries require reversesEntryId');
  }

  const insertedRows = await client.query(INSERT_ENTRY_SQL, [
    entry.eventType,
    entry.sourceEventKey,
    entry.referenceType,
    entry.referenceId ?? null,
    entry.bookingId ?? null,
    entry.vendorId ?? null,
    entry.reversesEntryId ?? null,
    entry.memo ?? null,
    entry.occurredAt.toISOString()
  ]);

  if (insertedRows.rows.length === 0) {
    const existing = await client.query(SELECT_ENTRY_BY_KEY_SQL, [entry.sourceEventKey]);
    const row = existing.rows[0];
    if (!row) {
      throw new AppError(
        'CONFLICT',
        `journal entry ${entry.sourceEventKey} conflicted but could not be read back`
      );
    }
    return { id: String(row.id), entryNo: String(row.entry_no), inserted: false };
  }

  const row = insertedRows.rows[0];
  if (!row) {
    throw new AppError('INTERNAL_ERROR', 'journal entry insert returned no row');
  }
  const id = String(row.id);

  for (const [index, line] of entry.lines.entries()) {
    await client.query(INSERT_LINE_SQL, [
      id,
      index + 1,
      line.accountCode,
      line.vendorId ?? null,
      line.debitIdr.toString(),
      line.creditIdr.toString(),
      line.memo ?? null
    ]);
  }

  return { id, entryNo: String(row.entry_no), inserted: true };
}
