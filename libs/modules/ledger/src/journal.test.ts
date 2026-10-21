import { describe, expect, it } from 'vitest';
import { computeCommission } from '@tarlink/platform/pricing';
import { assertBalanced, CHART_OF_ACCOUNTS, ACCOUNT } from './index';
import {
  buildClawbackEntries,
  buildEntry,
  buildRefundEntries,
  buildReversal,
  postEntry,
  sumCredits,
  sumDebits,
  type JournalEntryDraft,
  type JournalLine,
  type JournalQueryClient
} from './journal';

const AT = new Date('2026-10-21T09:00:00.000Z');
const VENDOR = '11111111-1111-4111-8111-111111111111';
const BOOKING = '22222222-2222-4222-8222-222222222222';

function lineOf(entry: JournalEntryDraft, accountCode: string, vendorId?: string): JournalLine {
  const line = entry.lines.find(
    (candidate) =>
      candidate.accountCode === accountCode &&
      (vendorId === undefined || candidate.vendorId === vendorId)
  );
  if (!line) throw new Error(`line ${accountCode} not found in ${entry.eventType}`);
  return line;
}

function totals(entry: JournalEntryDraft): { debit: bigint; credit: bigint } {
  return { debit: sumDebits(entry.lines), credit: sumCredits(entry.lines) };
}

function netByAccount(entries: readonly JournalEntryDraft[]): Map<string, bigint> {
  const totalsByAccount = new Map<string, bigint>();
  for (const account of CHART_OF_ACCOUNTS) totalsByAccount.set(account.code, 0n);

  for (const entry of entries) {
    for (const line of entry.lines) {
      const normal = CHART_OF_ACCOUNTS.find((account) => account.code === line.accountCode);
      if (!normal) throw new Error(`unknown account ${line.accountCode}`);
      const signed =
        normal.normalBalance === 'debit'
          ? line.debitIdr - line.creditIdr
          : line.creditIdr - line.debitIdr;
      totalsByAccount.set(line.accountCode, (totalsByAccount.get(line.accountCode) ?? 0n) + signed);
    }
  }
  return totalsByAccount;
}

describe('§6.4 scenario 1 — dp_received', () => {
  const entry = buildEntry('dp_received', {
    paymentId: '33333333-3333-4333-8333-333333333333',
    bookingId: BOOKING,
    vendorId: VENDOR,
    amountIdr: 1_200_000n,
    gatewayFeeIdr: 8_400n,
    occurredAt: AT
  });

  it('matches the documented amounts exactly', () => {
    expect(entry.sourceEventKey).toBe('payment:33333333-3333-4333-8333-333333333333:paid');
    expect(entry.lines).toHaveLength(4);
    expect(lineOf(entry, ACCOUNT.gateway_clearing.code).debitIdr).toBe(1_200_000n);
    expect(lineOf(entry, ACCOUNT.gateway_fee_expense.code).debitIdr).toBe(8_400n);
    expect(lineOf(entry, ACCOUNT.escrow_liability_vendor.code, VENDOR).creditIdr).toBe(1_200_000n);
    expect(
      entry.lines.filter((line) => line.accountCode === ACCOUNT.gateway_clearing.code)[1]?.creditIdr
    ).toBe(8_400n);
    expect(totals(entry)).toEqual({ debit: 1_208_400n, credit: 1_208_400n });
  });

  it('is balanced with bigint only', () => {
    expect(() => assertBalanced(entry.lines)).not.toThrow();
  });
});

describe('§6.4 scenario 2 — settlement_received', () => {
  const entry = buildEntry('settlement_received', {
    paymentId: '44444444-4444-4444-8444-444444444444',
    bookingId: BOOKING,
    vendorId: VENDOR,
    amountIdr: 2_825_000n,
    occurredAt: AT
  });

  it('derives the 0.7% gateway fee and matches the documented amounts', () => {
    expect(lineOf(entry, ACCOUNT.gateway_fee_expense.code).debitIdr).toBe(19_775n);
    expect(lineOf(entry, ACCOUNT.escrow_liability_vendor.code, VENDOR).creditIdr).toBe(2_825_000n);
    expect(totals(entry)).toEqual({ debit: 2_844_775n, credit: 2_844_775n });
  });
});

describe('§6.4 scenario 3 — release', () => {
  it('splits escrow into commission, service fee and vendor payable', () => {
    const entry = buildEntry('release', {
      bookingId: BOOKING,
      vendorId: VENDOR,
      escrowIdr: 4_025_000n,
      commissionBaseIdr: 4_000_000n,
      serviceFeeIdr: 25_000n,
      occurredAt: AT
    });

    expect(lineOf(entry, ACCOUNT.escrow_liability_vendor.code, VENDOR).debitIdr).toBe(4_025_000n);
    expect(lineOf(entry, ACCOUNT.platform_revenue_commission.code).creditIdr).toBe(400_000n);
    expect(lineOf(entry, ACCOUNT.platform_revenue_service_fee.code).creditIdr).toBe(25_000n);
    expect(lineOf(entry, ACCOUNT.vendor_payable.code, VENDOR).creditIdr).toBe(3_600_000n);
    expect(totals(entry)).toEqual({ debit: 4_025_000n, credit: 4_025_000n });
  });

  it('applies the D-17 split for a Rp 40.000.000 booking', () => {
    const entry = buildEntry('release', {
      bookingId: BOOKING,
      vendorId: VENDOR,
      escrowIdr: 40_025_000n,
      commissionBaseIdr: 40_000_000n,
      serviceFeeIdr: 25_000n,
      occurredAt: AT
    });

    const commission = lineOf(entry, ACCOUNT.platform_revenue_commission.code).creditIdr;
    expect(computeCommission(40_000_000n)).toEqual({
      tier1: 1_000_000n,
      tier2: 1_500_000n,
      total: 2_500_000n
    });
    expect(commission).toBe(2_500_000n); // tier1 1.000.000 + tier2 1.500.000
    expect(lineOf(entry, ACCOUNT.vendor_payable.code, VENDOR).creditIdr).toBe(37_500_000n);
    expect(totals(entry)).toEqual({ debit: 40_025_000n, credit: 40_025_000n });
  });

  it('applies the small-booking commission floor (Rp 100.000 base -> Rp 25.000)', () => {
    const entry = buildEntry('release', {
      bookingId: BOOKING,
      vendorId: VENDOR,
      escrowIdr: 100_000n,
      commissionBaseIdr: 100_000n,
      serviceFeeIdr: 0n,
      occurredAt: AT
    });

    expect(lineOf(entry, ACCOUNT.platform_revenue_commission.code).creditIdr).toBe(25_000n);
    expect(lineOf(entry, ACCOUNT.vendor_payable.code, VENDOR).creditIdr).toBe(75_000n);
    expect(totals(entry)).toEqual({ debit: 100_000n, credit: 100_000n });
  });
});

describe('§6.4 release payouts (3b, 3c)', () => {
  it('moves vendor payable into payout clearing, then settles it', () => {
    const requested = buildEntry('payout_requested', {
      payoutId: '55555555-5555-4555-8555-555555555555',
      vendorId: VENDOR,
      amountIdr: 3_600_000n,
      occurredAt: AT
    });
    const settled = buildEntry('payout_settled', {
      payoutId: '55555555-5555-4555-8555-555555555555',
      vendorId: VENDOR,
      amountIdr: 3_600_000n,
      occurredAt: AT
    });

    expect(lineOf(requested, ACCOUNT.vendor_payable.code, VENDOR).debitIdr).toBe(3_600_000n);
    expect(lineOf(requested, ACCOUNT.vendor_payout_clearing.code, VENDOR).creditIdr).toBe(3_600_000n);
    expect(lineOf(settled, ACCOUNT.vendor_payout_clearing.code, VENDOR).debitIdr).toBe(3_600_000n);
    expect(lineOf(settled, ACCOUNT.gateway_clearing.code).creditIdr).toBe(3_600_000n);
    expect(totals(requested).debit).toBe(totals(requested).credit);
    expect(totals(settled).debit).toBe(totals(settled).credit);
  });
});

describe('§6.4 scenario 4 — refund before release (full)', () => {
  const entries = buildRefundEntries('refund_full', {
    refundId: '66666666-6666-4666-8666-666666666666',
    bookingId: BOOKING,
    vendorId: VENDOR,
    escrowIdr: 4_025_000n,
    refundNetIdr: 3_996_825n,
    gatewayFeeRecoveredIdr: 28_175n,
    occurredAt: AT
  });

  it('recognizes the refund with fee recovery (4a)', () => {
    const [recognized] = entries;
    expect(recognized.eventType).toBe('refund_recognized');
    expect(lineOf(recognized, ACCOUNT.escrow_liability_vendor.code, VENDOR).debitIdr).toBe(4_025_000n);
    expect(lineOf(recognized, ACCOUNT.refund_payable.code).creditIdr).toBe(3_996_825n);
    expect(lineOf(recognized, ACCOUNT.gateway_fee_expense.code).creditIdr).toBe(28_175n);
    expect(totals(recognized)).toEqual({ debit: 4_025_000n, credit: 4_025_000n });
  });

  it('disburses the refund (4b)', () => {
    const [, disbursed] = entries;
    expect(disbursed.eventType).toBe('refund_disbursed');
    expect(lineOf(disbursed, ACCOUNT.refund_payable.code).debitIdr).toBe(3_996_825n);
    expect(lineOf(disbursed, ACCOUNT.gateway_clearing.code).creditIdr).toBe(3_996_825n);
    expect(totals(disbursed)).toEqual({ debit: 3_996_825n, credit: 3_996_825n });
  });
});

describe('§6.4 scenario 5 — partial refund', () => {
  const entries = buildRefundEntries('refund_partial', {
    refundId: '77777777-7777-4777-8777-777777777777',
    bookingId: BOOKING,
    vendorId: VENDOR,
    escrowIdr: 1_200_000n,
    refundNetIdr: 591_600n,
    gatewayFeeRecoveredIdr: 8_400n,
    retainedCommissionBaseIdr: 600_000n,
    occurredAt: AT
  });

  it('recomputes commission on the retained base (5a)', () => {
    const [recognized] = entries;
    expect(lineOf(recognized, ACCOUNT.escrow_liability_vendor.code, VENDOR).debitIdr).toBe(1_200_000n);
    expect(lineOf(recognized, ACCOUNT.refund_payable.code).creditIdr).toBe(591_600n);
    expect(lineOf(recognized, ACCOUNT.gateway_fee_expense.code).creditIdr).toBe(8_400n);
    expect(lineOf(recognized, ACCOUNT.platform_revenue_commission.code).creditIdr).toBe(60_000n);
    expect(lineOf(recognized, ACCOUNT.vendor_payable.code, VENDOR).creditIdr).toBe(540_000n);
    expect(totals(recognized)).toEqual({ debit: 1_200_000n, credit: 1_200_000n });
  });

  it('disburses only the net refund (5b)', () => {
    const [, disbursed] = entries;
    expect(lineOf(disbursed, ACCOUNT.refund_payable.code).debitIdr).toBe(591_600n);
    expect(lineOf(disbursed, ACCOUNT.gateway_clearing.code).creditIdr).toBe(591_600n);
    expect(totals(disbursed)).toEqual({ debit: 591_600n, credit: 591_600n });
  });
});

describe('§6.4 scenario 6 — clawback after release', () => {
  const entries = buildClawbackEntries({
    disputeId: '88888888-8888-4888-8888-888888888888',
    bookingId: BOOKING,
    vendorId: VENDOR,
    amountIdr: 1_600_000n,
    gatewayFeeAbsorbedIdr: 2_500n,
    occurredAt: AT
  });

  it('recognizes, pays and absorbs the fee (6a, 6b, 6c)', () => {
    expect(entries).toHaveLength(3);
    const [recognized, paid, feeAbsorbed] = entries as [
      JournalEntryDraft,
      JournalEntryDraft,
      JournalEntryDraft
    ];

    expect(lineOf(recognized, ACCOUNT.vendor_payable.code, VENDOR).debitIdr).toBe(1_600_000n);
    expect(lineOf(recognized, ACCOUNT.dispute_reserve.code).creditIdr).toBe(1_600_000n);
    expect(totals(recognized)).toEqual({ debit: 1_600_000n, credit: 1_600_000n });

    expect(lineOf(paid, ACCOUNT.dispute_reserve.code).debitIdr).toBe(1_600_000n);
    expect(lineOf(paid, ACCOUNT.platform_operating_cash.code).creditIdr).toBe(1_600_000n);
    expect(totals(paid)).toEqual({ debit: 1_600_000n, credit: 1_600_000n });

    expect(lineOf(feeAbsorbed, ACCOUNT.gateway_fee_absorbed.code).debitIdr).toBe(2_500n);
    expect(lineOf(feeAbsorbed, ACCOUNT.platform_operating_cash.code).creditIdr).toBe(2_500n);
    expect(totals(feeAbsorbed)).toEqual({ debit: 2_500n, credit: 2_500n });
  });

  it('leaves vendor_payable negative by exactly the clawback amount', () => {
    const balances = netByAccount(entries);
    expect(balances.get(ACCOUNT.vendor_payable.code)).toBe(-1_600_000n);
    expect(balances.get(ACCOUNT.dispute_reserve.code)).toBe(0n);
  });
});

describe('reversal', () => {
  it('returns every account to its prior balance (I-10)', () => {
    const dp = buildEntry('dp_received', {
      paymentId: '99999999-9999-4999-8999-999999999999',
      bookingId: BOOKING,
      vendorId: VENDOR,
      amountIdr: 1_200_000n,
      gatewayFeeIdr: 8_400n,
      occurredAt: AT
    });
    const entryId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const original: JournalEntryDraft & { id: string } = { ...dp, id: entryId };

    const before = netByAccount([]);
    const afterOriginal = netByAccount([dp]);
    const reversal = buildReversal(original, {
      occurredAt: new Date('2026-10-21T10:00:00.000Z')
    });
    const afterReversal = netByAccount([dp, reversal]);

    expect(reversal.eventType).toBe('reversal');
    expect(reversal.reversesEntryId).toBe(entryId);
    expect(reversal.sourceEventKey).toBe(`reversal:${dp.sourceEventKey}`);
    expect(totals(reversal)).toEqual({ debit: 1_208_400n, credit: 1_208_400n });
    for (const account of CHART_OF_ACCOUNTS) {
      expect(afterReversal.get(account.code)).toBe(before.get(account.code));
    }
    for (const touched of [
      ACCOUNT.gateway_clearing.code,
      ACCOUNT.gateway_fee_expense.code,
      ACCOUNT.escrow_liability_vendor.code
    ]) {
      expect(afterOriginal.get(touched)).not.toBe(before.get(touched));
    }
  });

  it('refuses to reverse without the original entry id', () => {
    const dp = buildEntry('dp_received', {
      paymentId: '99999999-9999-4999-8999-999999999999',
      bookingId: BOOKING,
      vendorId: VENDOR,
      amountIdr: 1_200_000n,
      occurredAt: AT
    });
    expect(() => buildReversal(dp, { occurredAt: AT })).toThrow(/original journal entry id/);
  });
});

describe('assertBalanced', () => {
  const debit = (accountCode: string, amount: bigint): JournalLine => ({
    accountCode,
    debitIdr: amount,
    creditIdr: 0n
  });
  const credit = (accountCode: string, amount: bigint): JournalLine => ({
    accountCode,
    debitIdr: 0n,
    creditIdr: amount
  });

  it('rejects unbalanced entries', () => {
    expect(() =>
      assertBalanced([debit(ACCOUNT.gateway_clearing.code, 10n), credit(ACCOUNT.refund_payable.code, 9n)])
    ).toThrow(/not balanced/);
  });

  it('rejects zero and negative amounts', () => {
    expect(() =>
      assertBalanced([
        debit(ACCOUNT.gateway_clearing.code, 0n),
        credit(ACCOUNT.refund_payable.code, 0n)
      ])
    ).toThrow(/exactly one side/);
    expect(() =>
      assertBalanced([debit(ACCOUNT.gateway_clearing.code, -1n), credit(ACCOUNT.refund_payable.code, -1n)])
    ).toThrow(/negative/);
  });

  it('rejects a line with both sides populated', () => {
    expect(() =>
      assertBalanced([
        { accountCode: ACCOUNT.gateway_clearing.code, debitIdr: 5n, creditIdr: 5n },
        credit(ACCOUNT.refund_payable.code, 5n)
      ])
    ).toThrow(/exactly one side/);
  });

  it('rejects fewer than two lines', () => {
    expect(() => assertBalanced([debit(ACCOUNT.gateway_clearing.code, 5n)])).toThrow(/at least two/);
  });
});

describe('postEntry idempotency (I-09)', () => {
  it('writes one entry and one line set for a duplicate source_event_key', async () => {
    const entries: Array<Record<string, unknown>> = [];
    const lines: Array<Record<string, unknown>> = [];
    let seq = 0;

    const client: JournalQueryClient = {
      async query(text, params = []) {
        if (text.includes('INSERT INTO journal_entries')) {
          const key = String(params[1]);
          if (entries.some((entry) => entry.source_event_key === key)) return { rows: [] };
          seq += 1;
          const row = { id: `entry-${seq}`, entry_no: String(seq), source_event_key: key };
          entries.push(row);
          return { rows: [{ id: row.id, entry_no: row.entry_no }] };
        }
        if (text.includes('SELECT id, entry_no FROM journal_entries')) {
          const row = entries.find((entry) => entry.source_event_key === String(params[0]));
          return { rows: row ? [{ id: row.id, entry_no: row.entry_no }] : [] };
        }
        if (text.includes('INSERT INTO journal_lines')) {
          lines.push({
            entry: params[0],
            line_no: params[1],
            account_code: params[2],
            debit: params[4],
            credit: params[5]
          });
          return { rows: [] };
        }
        throw new Error(`unexpected SQL: ${text}`);
      }
    };

    const entry = buildEntry('dp_received', {
      paymentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      bookingId: BOOKING,
      vendorId: VENDOR,
      amountIdr: 1_200_000n,
      gatewayFeeIdr: 8_400n,
      occurredAt: AT
    });

    const first = await postEntry(client, entry);
    const second = await postEntry(client, entry);

    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    expect(second.id).toBe(first.id);
    expect(entries).toHaveLength(1);
    expect(lines).toHaveLength(entry.lines.length);
    expect(lines.map((line) => line.debit)).toEqual(['1200000', '8400', '0', '0']);
  });
});
