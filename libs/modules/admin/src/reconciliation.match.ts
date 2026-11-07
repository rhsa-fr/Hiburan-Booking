/**
 * Pure matcher for the FR-131 daily reconciliation lane (gateway <-> ledger).
 *
 * No I/O and no clock: the caller decides which day and which rows are in
 * scope. Every amount is `bigint` (PostgreSQL BIGINT) so totals cannot lose
 * precision; conversion to a JSON number happens only at the HTTP boundary.
 *
 * Rules (mirrored by `reconciliation.match.test.ts`):
 * - key = `externalId`; blank keys are dropped entirely (nothing to match on).
 * - both sides, same amount            -> matched (info)
 * - both sides, different amount       -> amount_mismatch (critical)
 * - gateway only                       -> missing_in_ledger (critical)
 * - ledger only                        -> missing_at_gateway (warning)
 * - extra occurrence(s) on one side    -> duplicate (warning) per extra line
 * - totals use one amount per distinct key, so duplicates never inflate them.
 */

export interface ReconLine {
  externalId: string;
  amountIdr: bigint;
}

export type ReconClassification =
  | 'matched'
  | 'duplicate'
  | 'missing_in_ledger'
  | 'missing_at_gateway'
  | 'amount_mismatch';

export type ReconSeverity = 'info' | 'warning' | 'critical';

export interface ReconDiff {
  classification: ReconClassification;
  severity: ReconSeverity;
  externalId: string;
  gatewayAmountIdr: bigint | null;
  ledgerAmountIdr: bigint | null;
  deltaIdr: bigint;
  detail: Record<string, unknown>;
}

export interface MatchPaymentDayResult {
  diffs: ReconDiff[];
  checkedCount: number;
  matchedCount: number;
  gatewayTotalIdr: bigint;
  ledgerTotalIdr: bigint;
  diffIdr: bigint;
}

/** Groups amounts by trimmed external id; blank ids are not reconcilable. */
function groupLines(lines: readonly ReconLine[]): Map<string, bigint[]> {
  const grouped = new Map<string, bigint[]>();
  for (const line of lines) {
    const key = line.externalId.trim();
    if (key.length === 0) continue;
    const amounts = grouped.get(key);
    if (amounts) amounts.push(line.amountIdr);
    else grouped.set(key, [line.amountIdr]);
  }
  return grouped;
}

/**
 * Matches one provider's gateway lines against the internal ledger for one day.
 * Diffs are ordered by key so a rerun produces the same rows in the same order.
 */
export function matchPaymentDay(
  gateway: readonly ReconLine[],
  ledger: readonly ReconLine[]
): MatchPaymentDayResult {
  const gatewayByKey = groupLines(gateway);
  const ledgerByKey = groupLines(ledger);
  const keys = Array.from(new Set([...gatewayByKey.keys(), ...ledgerByKey.keys()])).sort();

  const diffs: ReconDiff[] = [];
  let matchedCount = 0;
  let gatewayTotalIdr = 0n;
  let ledgerTotalIdr = 0n;

  for (const key of keys) {
    const gatewayAmounts = gatewayByKey.get(key);
    const ledgerAmounts = ledgerByKey.get(key);
    const firstGateway = gatewayAmounts?.[0];
    const firstLedger = ledgerAmounts?.[0];

    if (firstGateway !== undefined && firstLedger !== undefined) {
      const delta = firstGateway - firstLedger;
      if (delta === 0n) {
        matchedCount += 1;
        diffs.push({
          classification: 'matched',
          severity: 'info',
          externalId: key,
          gatewayAmountIdr: firstGateway,
          ledgerAmountIdr: firstLedger,
          deltaIdr: 0n,
          detail: {}
        });
      } else {
        diffs.push({
          classification: 'amount_mismatch',
          severity: 'critical',
          externalId: key,
          gatewayAmountIdr: firstGateway,
          ledgerAmountIdr: firstLedger,
          deltaIdr: delta,
          detail: {}
        });
      }
    } else if (firstGateway !== undefined) {
      diffs.push({
        classification: 'missing_in_ledger',
        severity: 'critical',
        externalId: key,
        gatewayAmountIdr: firstGateway,
        ledgerAmountIdr: null,
        deltaIdr: firstGateway,
        detail: {}
      });
    } else if (firstLedger !== undefined) {
      diffs.push({
        classification: 'missing_at_gateway',
        severity: 'warning',
        externalId: key,
        gatewayAmountIdr: null,
        ledgerAmountIdr: firstLedger,
        // gateway - ledger, with the missing gateway side counted as zero.
        deltaIdr: -firstLedger,
        detail: {}
      });
    }

    if (gatewayAmounts) {
      for (let index = 1; index < gatewayAmounts.length; index += 1) {
        const amount = gatewayAmounts[index];
        if (amount === undefined) continue;
        diffs.push({
          classification: 'duplicate',
          severity: 'warning',
          externalId: key,
          gatewayAmountIdr: amount,
          ledgerAmountIdr: null,
          deltaIdr: 0n,
          detail: { side: 'gateway', occurrence: index + 1 }
        });
      }
    }
    if (ledgerAmounts) {
      for (let index = 1; index < ledgerAmounts.length; index += 1) {
        const amount = ledgerAmounts[index];
        if (amount === undefined) continue;
        diffs.push({
          classification: 'duplicate',
          severity: 'warning',
          externalId: key,
          gatewayAmountIdr: null,
          ledgerAmountIdr: amount,
          deltaIdr: 0n,
          detail: { side: 'ledger', occurrence: index + 1 }
        });
      }
    }

    // Totals use distinct keys: only the first occurrence of each side counts.
    if (firstGateway !== undefined) gatewayTotalIdr += firstGateway;
    if (firstLedger !== undefined) ledgerTotalIdr += firstLedger;
  }

  return {
    diffs,
    checkedCount: keys.length,
    matchedCount,
    gatewayTotalIdr,
    ledgerTotalIdr,
    diffIdr: gatewayTotalIdr - ledgerTotalIdr
  };
}
