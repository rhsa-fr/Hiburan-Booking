import { describe, expect, it } from 'vitest';
import { matchPaymentDay, type ReconLine } from './reconciliation.match';

function line(externalId: string, amountIdr: bigint): ReconLine {
  return { externalId, amountIdr };
}

describe('matchPaymentDay', () => {
  it('returns zero totals for empty inputs', () => {
    const result = matchPaymentDay([], []);

    expect(result.diffs).toEqual([]);
    expect(result.checkedCount).toBe(0);
    expect(result.matchedCount).toBe(0);
    expect(result.gatewayTotalIdr).toBe(0n);
    expect(result.ledgerTotalIdr).toBe(0n);
    expect(result.diffIdr).toBe(0n);
  });

  it('classifies equal amounts on both sides as matched', () => {
    const result = matchPaymentDay([line('order-1', 1_200_000n)], [line('order-1', 1_200_000n)]);

    expect(result.diffs).toEqual([
      {
        classification: 'matched',
        severity: 'info',
        externalId: 'order-1',
        gatewayAmountIdr: 1_200_000n,
        ledgerAmountIdr: 1_200_000n,
        deltaIdr: 0n,
        detail: {}
      }
    ]);
    expect(result.checkedCount).toBe(1);
    expect(result.matchedCount).toBe(1);
    expect(result.gatewayTotalIdr).toBe(1_200_000n);
    expect(result.ledgerTotalIdr).toBe(1_200_000n);
    expect(result.diffIdr).toBe(0n);
  });

  it('classifies different amounts as an amount_mismatch with gateway - ledger delta', () => {
    const result = matchPaymentDay([line('order-1', 1_200_000n)], [line('order-1', 1_000_000n)]);

    expect(result.diffs).toHaveLength(1);
    expect(result.diffs[0]).toMatchObject({
      classification: 'amount_mismatch',
      severity: 'critical',
      gatewayAmountIdr: 1_200_000n,
      ledgerAmountIdr: 1_000_000n,
      deltaIdr: 200_000n
    });
    expect(result.matchedCount).toBe(0);
    expect(result.diffIdr).toBe(200_000n);
  });

  it('classifies a gateway-only key as missing_in_ledger', () => {
    const result = matchPaymentDay([line('order-1', 750_000n)], []);

    expect(result.diffs).toHaveLength(1);
    expect(result.diffs[0]).toMatchObject({
      classification: 'missing_in_ledger',
      severity: 'critical',
      externalId: 'order-1',
      gatewayAmountIdr: 750_000n,
      ledgerAmountIdr: null,
      deltaIdr: 750_000n
    });
    expect(result.checkedCount).toBe(1);
    expect(result.matchedCount).toBe(0);
    expect(result.diffIdr).toBe(750_000n);
  });

  it('classifies a ledger-only key as missing_at_gateway with a negative delta', () => {
    const result = matchPaymentDay([], [line('order-1', 750_000n)]);

    expect(result.diffs).toHaveLength(1);
    expect(result.diffs[0]).toMatchObject({
      classification: 'missing_at_gateway',
      severity: 'warning',
      externalId: 'order-1',
      gatewayAmountIdr: null,
      ledgerAmountIdr: 750_000n,
      deltaIdr: -750_000n
    });
    expect(result.checkedCount).toBe(1);
    expect(result.gatewayTotalIdr).toBe(0n);
    expect(result.ledgerTotalIdr).toBe(750_000n);
    expect(result.diffIdr).toBe(-750_000n);
  });

  it('emits one duplicate per extra gateway occurrence and keeps totals on distinct keys', () => {
    const result = matchPaymentDay(
      [line('order-1', 1_000_000n), line('order-1', 1_000_000n)],
      [line('order-1', 1_000_000n)]
    );

    expect(result.diffs.map((diff) => diff.classification)).toEqual(['matched', 'duplicate']);
    expect(result.diffs[1]).toMatchObject({
      classification: 'duplicate',
      severity: 'warning',
      externalId: 'order-1',
      gatewayAmountIdr: 1_000_000n,
      ledgerAmountIdr: null,
      deltaIdr: 0n,
      detail: { side: 'gateway', occurrence: 2 }
    });
    expect(result.checkedCount).toBe(1);
    expect(result.matchedCount).toBe(1);
    expect(result.gatewayTotalIdr).toBe(1_000_000n);
    expect(result.ledgerTotalIdr).toBe(1_000_000n);
    expect(result.diffIdr).toBe(0n);
  });

  it('emits a duplicate for an extra ledger occurrence too', () => {
    const result = matchPaymentDay(
      [line('order-1', 400_000n)],
      [line('order-1', 400_000n), line('order-1', 400_000n)]
    );

    expect(result.diffs.map((diff) => diff.classification)).toEqual(['matched', 'duplicate']);
    expect(result.diffs[1]).toMatchObject({
      classification: 'duplicate',
      severity: 'warning',
      gatewayAmountIdr: null,
      ledgerAmountIdr: 400_000n,
      deltaIdr: 0n,
      detail: { side: 'ledger', occurrence: 2 }
    });
    expect(result.matchedCount).toBe(1);
    expect(result.ledgerTotalIdr).toBe(400_000n);
  });

  it('matches the first occurrence even when a later gateway duplicate differs', () => {
    const result = matchPaymentDay(
      [line('order-1', 1_000_000n), line('order-1', 2_000_000n)],
      [line('order-1', 1_000_000n)]
    );

    expect(result.diffs.map((diff) => diff.classification)).toEqual(['matched', 'duplicate']);
    expect(result.diffs[1]).toMatchObject({ gatewayAmountIdr: 2_000_000n, deltaIdr: 0n });
    expect(result.diffIdr).toBe(0n);
  });

  it('drops blank external ids without counting them', () => {
    const result = matchPaymentDay(
      [line('', 500_000n), line('   ', 500_000n), line('order-1', 100_000n)],
      [line('', 500_000n), line('order-1', 100_000n)]
    );

    expect(result.diffs.map((diff) => diff.externalId)).toEqual(['order-1']);
    expect(result.checkedCount).toBe(1);
    expect(result.gatewayTotalIdr).toBe(100_000n);
    expect(result.ledgerTotalIdr).toBe(100_000n);
  });

  it('aggregates totals across mixed classifications', () => {
    const result = matchPaymentDay(
      [line('order-1', 100_000n), line('order-2', 200_000n), line('order-3', 300_000n)],
      [line('order-1', 100_000n), line('order-2', 250_000n), line('order-4', 50_000n)]
    );

    expect(result.checkedCount).toBe(4);
    expect(result.matchedCount).toBe(1);
    expect(result.diffs.map((diff) => diff.classification)).toEqual([
      'matched',
      'amount_mismatch',
      'missing_in_ledger',
      'missing_at_gateway'
    ]);
    expect(result.gatewayTotalIdr).toBe(600_000n);
    expect(result.ledgerTotalIdr).toBe(400_000n);
    expect(result.diffIdr).toBe(200_000n);
  });

  it('keeps bigint arithmetic exact beyond Number.MAX_SAFE_INTEGER', () => {
    const huge = 9_007_199_254_740_993n; // 2^53 + 1
    const result = matchPaymentDay([line('order-1', huge)], [line('order-1', huge - 2n)]);

    expect(result.diffs[0]?.deltaIdr).toBe(2n);
    expect(result.diffIdr).toBe(2n);
  });

  it('is deterministic: diffs are ordered by key', () => {
    const result = matchPaymentDay(
      [line('order-c', 30n), line('order-a', 10n), line('order-b', 20n)],
      []
    );

    expect(result.diffs.map((diff) => diff.externalId)).toEqual(['order-a', 'order-b', 'order-c']);
  });
});
