/**
 * SQL for the FR-131 daily reconciliation lane (phase 1: `scope = 'payment'`).
 *
 * Read-only over the money tables: this module never writes `payments`,
 * `payouts`, `refunds`, or `journal_*`. The only writes are the run/diff/audit
 * rows the migration `024_reconciliation.sql` introduced.
 *
 * Gateway lane
 * ------------
 * `PaymentService` stores a *normalised* event for every paid notification,
 * for both providers: `{ id, type: 'payment.paid', data: { provider_ref,
 * amount_idr, ... } }`. It stores the raw Midtrans body (with
 * `transaction_status`, `order_id`, `gross_amount`, `fraud_status`) only for
 * non-paid notifications. The predicate below therefore accepts:
 *   - the normalised paid event shape (`payload->>'type'`), which is what the
 *     current code writes for Midtrans and PJP; and
 *   - a raw Midtrans settlement/capture body, defensively, for rows written
 *     before the normalisation (a capture with `fraud_status != 'accept'` is
 *     excluded: `classifyNotification` treats it as failed).
 *
 * Webhook rows are deliberately NOT filtered by `status`: a settlement that
 * arrived but failed/ignored internal processing is exactly the
 * `missing_in_ledger` finding this lane exists to surface. `signature_valid`
 * is required so an unverified payload can never drive a money finding.
 *
 * Day boundaries
 * --------------
 * `report_date` is a WIB calendar date. Both lanes use half-open WIB bounds
 * (`>= start`, `< next start`) computed entirely in SQL from `$2::date` /
 * `$3::date`. The gateway lane keys on `webhook_events.received_at` (the only
 * timestamp present on every row); the ledger lane keys on `payments.paid_at`.
 * A webhook that crosses midnight WIB is reported as a boundary finding
 * instead of being silently moved to another day.
 */
import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { query } from '@tarlink/core/db';
import type { ReconDiff, ReconLine } from './reconciliation.match';

export type ReconRunStatus = 'running' | 'balanced' | 'discrepancy' | 'failed';
export type ReconClassification =
  | 'matched'
  | 'duplicate'
  | 'missing_in_ledger'
  | 'missing_at_gateway'
  | 'amount_mismatch'
  | 'fee_mismatch'
  | 'unverified';
export type ReconSeverity = 'info' | 'warning' | 'critical';

export type ReconRunRow = {
  id: string;
  provider: string;
  scope: string;
  report_date: string;
  status: ReconRunStatus;
  report_source: string;
  gateway_total_idr: string;
  ledger_total_idr: string;
  diff_idr: string;
  diff_count: number;
  matched_count: number;
  checked_count: number;
  triggered_by: string | null;
  trigger_source: string;
  error_message: string | null;
  started_at: Date;
  finished_at: Date | null;
  created_at: Date;
};

export type ReconDiffRow = {
  id: string;
  run_id: string;
  classification: ReconClassification;
  severity: ReconSeverity;
  external_id: string | null;
  gateway_amount_idr: string | null;
  ledger_amount_idr: string | null;
  delta_idr: string | null;
  detail: Record<string, unknown>;
  due_at: Date | null;
  resolved_at: Date | null;
  created_at: Date;
};

export interface InsertRunInput {
  provider: string;
  reportDate: string;
  status: 'balanced' | 'discrepancy';
  gatewayTotalIdr: bigint;
  ledgerTotalIdr: bigint;
  diffIdr: bigint;
  diffCount: number;
  matchedCount: number;
  checkedCount: number;
  actorId: string;
}

export interface AuditEntry {
  actorId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  beforeState: unknown;
  afterState: unknown;
  requestId: string | null;
}

export interface RunListResult {
  items: ReconRunRow[];
  total: number;
}

/**
 * The gateway predicate is explained in the file header. `gross_amount` is a
 * decimal string in Midtrans payloads (`"1200000.00"`), so it is parsed through
 * NUMERIC only when it is integral; anything else is dropped, never rounded.
 */
const GATEWAY_LINES_SQL = `
SELECT external_id, amount_idr
FROM (
  SELECT
    COALESCE(payload#>>'{data,provider_ref}', payload->>'order_id') AS external_id,
    CASE
      WHEN payload#>>'{data,amount_idr}' ~ '^[0-9]+$'
        THEN (payload#>>'{data,amount_idr}')::bigint
      WHEN payload->>'gross_amount' ~ '^[0-9]+(\\.0+)?$'
        THEN (payload->>'gross_amount')::numeric::bigint
      ELSE NULL
    END AS amount_idr,
    received_at
  FROM webhook_events
  WHERE provider = $1
    AND signature_valid = true
    AND (
      payload->>'type' IN ('payment.paid', 'payment.succeeded', 'payment.captured')
      OR (
        payload->>'transaction_status' IN ('settlement', 'capture')
        AND (
          payload->>'transaction_status' <> 'capture'
          OR lower(COALESCE(payload->>'fraud_status', 'accept')) = 'accept'
        )
      )
    )
    AND received_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Jakarta')
    AND received_at <  ($3::date::timestamp AT TIME ZONE 'Asia/Jakarta')
) AS gateway_lines
WHERE external_id IS NOT NULL
  AND btrim(external_id) <> ''
  AND amount_idr IS NOT NULL
ORDER BY received_at, external_id
`;

const LEDGER_LINES_SQL = `
SELECT provider_ref AS external_id, amount_idr
FROM payments
WHERE provider = $1
  AND status = 'paid'
  AND provider_ref IS NOT NULL
  AND btrim(provider_ref) <> ''
  AND paid_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Jakarta')
  AND paid_at <  ($3::date::timestamp AT TIME ZONE 'Asia/Jakarta')
ORDER BY paid_at, provider_ref
`;

const RUN_COLUMNS = `
  id,
  provider,
  scope,
  report_date::text AS report_date,
  status,
  report_source,
  gateway_total_idr,
  ledger_total_idr,
  diff_idr,
  diff_count,
  matched_count,
  checked_count,
  triggered_by,
  trigger_source,
  error_message,
  started_at,
  finished_at,
  created_at
`;

const GET_RUN_SQL = `
SELECT ${RUN_COLUMNS}
FROM reconciliation_runs
WHERE id = $1::uuid
`;

const FIND_RUN_SQL = `
SELECT ${RUN_COLUMNS}
FROM reconciliation_runs
WHERE provider = $1
  AND scope = 'payment'
  AND report_date = $2::date
`;

const LIST_RUNS_SQL = `
SELECT ${RUN_COLUMNS}
FROM reconciliation_runs
ORDER BY report_date DESC, provider ASC, created_at DESC
LIMIT $1 OFFSET $2
`;

const COUNT_RUNS_SQL = `SELECT count(*)::int AS total FROM reconciliation_runs`;

const INSERT_RUN_SQL = `
INSERT INTO reconciliation_runs
  (provider, scope, report_date, status, report_source,
   gateway_total_idr, ledger_total_idr, diff_idr,
   diff_count, matched_count, checked_count,
   triggered_by, trigger_source, started_at, finished_at)
VALUES
  ($1, 'payment', $2::date, $3::recon_run_status, 'webhook_events',
   $4::bigint, $5::bigint, $6::bigint,
   $7, $8, $9,
   $10::uuid, 'admin', now(), now())
ON CONFLICT (provider, scope, report_date) DO NOTHING
RETURNING ${RUN_COLUMNS}
`;

const LIST_DIFFS_SQL = `
SELECT
  id,
  run_id,
  classification,
  severity,
  external_id,
  gateway_amount_idr,
  ledger_amount_idr,
  delta_idr,
  detail,
  due_at,
  resolved_at,
  created_at
FROM reconciliation_diffs
WHERE run_id = $1::uuid
ORDER BY
  CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
  classification,
  external_id NULLS LAST,
  created_at
`;

@Injectable()
export class ReconciliationRepository {
  async findGatewayPaymentLines(
    provider: string,
    from: string,
    to: string
  ): Promise<ReconLine[]> {
    const rows = await query<{ external_id: string; amount_idr: string }>(GATEWAY_LINES_SQL, [
      provider,
      from,
      to
    ]);
    return rows.map((row) => ({
      externalId: row.external_id,
      amountIdr: BigInt(row.amount_idr)
    }));
  }

  async findPaidPaymentLines(provider: string, from: string, to: string): Promise<ReconLine[]> {
    const rows = await query<{ external_id: string; amount_idr: string }>(LEDGER_LINES_SQL, [
      provider,
      from,
      to
    ]);
    return rows.map((row) => ({
      externalId: row.external_id,
      amountIdr: BigInt(row.amount_idr)
    }));
  }

  async findRunByKey(
    provider: string,
    reportDate: string,
    client?: PoolClient
  ): Promise<ReconRunRow | null> {
    const params = [provider, reportDate];
    const rows = client
      ? (await client.query<ReconRunRow>(FIND_RUN_SQL, params)).rows
      : await query<ReconRunRow>(FIND_RUN_SQL, params);
    return rows[0] ?? null;
  }

  /**
   * Returns `null` when a concurrent caller already inserted the same
   * (provider, scope, report_date); the caller must then read that row back.
   */
  async insertRun(client: PoolClient, input: InsertRunInput): Promise<ReconRunRow | null> {
    const result = await client.query<ReconRunRow>(INSERT_RUN_SQL, [
      input.provider,
      input.reportDate,
      input.status,
      input.gatewayTotalIdr.toString(),
      input.ledgerTotalIdr.toString(),
      input.diffIdr.toString(),
      input.diffCount,
      input.matchedCount,
      input.checkedCount,
      input.actorId
    ]);
    return result.rows[0] ?? null;
  }

  /**
   * Chunked statements keep the parameter list far below PostgreSQL's 65535
   * bind limit on a busy day. `ON CONFLICT DO NOTHING` protects the
   * (run_id, classification, external_id) constraint when a key has more than
   * one extra occurrence: the first duplicate row carries the evidence, the
   * summary counts stay per classification from the matcher.
   */
  async insertDiffs(
    client: PoolClient,
    runId: string,
    diffs: readonly ReconDiff[]
  ): Promise<void> {
    if (diffs.length === 0) return;

    const CHUNK_SIZE = 500;
    for (let start = 0; start < diffs.length; start += CHUNK_SIZE) {
      const chunk = diffs.slice(start, start + CHUNK_SIZE);
      const values: unknown[] = [];
      const tuples = chunk.map((diff, index) => {
        const base = index * 8;
        values.push(
          runId,
          diff.classification,
          diff.severity,
          diff.externalId,
          diff.gatewayAmountIdr === null ? null : diff.gatewayAmountIdr.toString(),
          diff.ledgerAmountIdr === null ? null : diff.ledgerAmountIdr.toString(),
          diff.deltaIdr.toString(),
          JSON.stringify(diff.detail)
        );
        return `($${base + 1}::uuid, $${base + 2}::recon_classification, $${base + 3}::recon_severity, $${base + 4}, $${base + 5}::bigint, $${base + 6}::bigint, $${base + 7}::bigint, $${base + 8}::jsonb)`;
      });

      await client.query(
        `INSERT INTO reconciliation_diffs
           (run_id, classification, severity, external_id,
            gateway_amount_idr, ledger_amount_idr, delta_idr, detail)
         VALUES ${tuples.join(', ')}
         ON CONFLICT (run_id, classification, external_id) DO NOTHING`,
        values
      );
    }
  }

  /** `audit_logs.prev_hash`/`row_hash` are filled by the DB hash-chain trigger. */
  async insertAudit(client: PoolClient, entry: AuditEntry): Promise<void> {
    await client.query(
      `INSERT INTO audit_logs
         (actor_id, actor_role, action, entity_type, entity_id,
          before_state, after_state, request_id)
       VALUES ($1::uuid, $2::user_role, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
      [
        entry.actorId,
        entry.actorRole,
        entry.action,
        entry.entityType,
        entry.entityId,
        entry.beforeState === null ? null : JSON.stringify(entry.beforeState),
        entry.afterState === null ? null : JSON.stringify(entry.afterState),
        entry.requestId
      ]
    );
  }

  async listRuns(params: { limit: number; offset: number }): Promise<RunListResult> {
    const [items, totals] = await Promise.all([
      query<ReconRunRow>(LIST_RUNS_SQL, [params.limit, params.offset]),
      query<{ total: number }>(COUNT_RUNS_SQL)
    ]);
    return { items, total: totals[0]?.total ?? 0 };
  }

  async getRun(id: string): Promise<ReconRunRow | null> {
    const rows = await query<ReconRunRow>(GET_RUN_SQL, [id]);
    return rows[0] ?? null;
  }

  async listDiffs(runId: string): Promise<ReconDiffRow[]> {
    return query<ReconDiffRow>(LIST_DIFFS_SQL, [runId]);
  }
}
