/**
 * Counters behind `GET /v1/admin/ops/alerts` (operator readiness).
 *
 * One statement, one round trip. Every branch is a threshold query over tables
 * that already exist; nothing is written and no money/status row is read into
 * the response — only counts and the age of the oldest row.
 *
 * Thresholds
 * ----------
 * - moderation reports and disputes: past `sla_due_at`
 * - reconciliation findings: unresolved and past `due_at`
 * - reconciliation runs: `failed` within the last 24 hours
 * - payouts: `processing` for over 1 hour, or `approved` for over 24 hours
 * - outbox: `failed`/`dead` (the relay keeps retrying)
 * - email deliveries: `failed` within the last 24 hours
 * - payment webhooks: `failed` within the last 24 hours (money received but not applied)
 *
 * `oldest_hours` is rounded **up** so a queue that just crossed its deadline
 * reads "1 jam", never "0 jam". An empty queue returns 0 and NULL.
 */
import type { QueryResultRow } from 'pg';
import { query } from '@tarlink/core/db';
import {
  isOpsMetricKey,
  normaliseOpsSnapshot,
  type OpsMetric,
  type OpsMetricKey,
  type OpsSnapshot
} from './ops.alerts';

export interface OpsDatabase {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[]
  ): Promise<T[]>;
}

const CORE_DB: OpsDatabase = { query };

export interface OpsSnapshotRow extends QueryResultRow {
  key: string;
  count: number;
  oldest_hours: number | null;
}

/**
 * `now()` is evaluated once for the whole statement (transaction timestamp), so
 * every branch agrees on the cut-off even when the query takes a moment.
 */
export const OPS_SNAPSHOT_SQL = `
SELECT 'content_reports' AS key,
       count(*)::int AS count,
       COALESCE(ceil(EXTRACT(EPOCH FROM (now() - min(sla_due_at))) / 3600), 0)::int
         AS oldest_hours
  FROM content_reports
 WHERE status IN ('open', 'reviewing')
   AND sla_due_at < now()
UNION ALL
SELECT 'disputes' AS key,
       count(*)::int AS count,
       COALESCE(ceil(EXTRACT(EPOCH FROM (now() - min(sla_due_at))) / 3600), 0)::int
         AS oldest_hours
  FROM disputes
 WHERE status IN ('open', 'investigating', 'awaiting_evidence')
   AND sla_due_at < now()
UNION ALL
SELECT 'reconciliation_diffs' AS key,
       count(*)::int AS count,
       COALESCE(ceil(EXTRACT(EPOCH FROM (now() - min(due_at))) / 3600), 0)::int
         AS oldest_hours
  FROM reconciliation_diffs
 WHERE resolved_at IS NULL
   AND due_at IS NOT NULL
   AND due_at < now()
UNION ALL
SELECT 'reconciliation_runs' AS key,
       count(*)::int AS count,
       COALESCE(ceil(EXTRACT(EPOCH FROM (now() - min(started_at))) / 3600), 0)::int
         AS oldest_hours
  FROM reconciliation_runs
 WHERE status = 'failed'
   AND started_at > now() - interval '24 hours'
UNION ALL
SELECT 'payouts' AS key,
       count(*)::int AS count,
       COALESCE(ceil(EXTRACT(EPOCH FROM (now() - min(updated_at))) / 3600), 0)::int
         AS oldest_hours
  FROM payouts
 WHERE (status = 'processing' AND updated_at < now() - interval '1 hour')
    OR (status = 'approved' AND updated_at < now() - interval '24 hours')
UNION ALL
SELECT 'outbox' AS key,
       count(*)::int AS count,
       COALESCE(ceil(EXTRACT(EPOCH FROM (now() - min(created_at))) / 3600), 0)::int
         AS oldest_hours
  FROM outbox_messages
 WHERE status IN ('failed', 'dead')
UNION ALL
SELECT 'email' AS key,
       count(*)::int AS count,
       COALESCE(ceil(EXTRACT(EPOCH FROM (now() - min(updated_at))) / 3600), 0)::int
         AS oldest_hours
  FROM notification_deliveries
 WHERE channel = 'email'
   AND status = 'failed'
   AND updated_at > now() - interval '24 hours'
UNION ALL
SELECT 'webhooks' AS key,
       count(*)::int AS count,
       COALESCE(ceil(EXTRACT(EPOCH FROM (now() - min(received_at))) / 3600), 0)::int
         AS oldest_hours
  FROM webhook_events
 WHERE status = 'failed'
   AND received_at > now() - interval '24 hours'
ORDER BY key
`;

export class OpsRepository {
  constructor(private readonly db: OpsDatabase = CORE_DB) {}

  async snapshot(): Promise<OpsSnapshot> {
    const rows = await this.db.query<OpsSnapshotRow>(OPS_SNAPSHOT_SQL);
    const metrics: Partial<Record<OpsMetricKey, OpsMetric>> = {};
    for (const row of rows) {
      if (!isOpsMetricKey(row.key)) continue;
      metrics[row.key] = { count: row.count, oldest_hours: row.oldest_hours };
    }
    return normaliseOpsSnapshot(metrics);
  }
}
