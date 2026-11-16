/**
 * Pure mapping for the operator readiness endpoint (`GET /v1/admin/ops/alerts`).
 *
 * The repository counts rows that are already actionable: overdue moderation
 * and dispute SLAs, undecided reconciliation findings, failed reconciliation
 * runs, stalled payouts, and notification delivery failures. This module turns
 * those counters into a small, deterministic list so the panel never has to
 * know the thresholds or the labels.
 *
 * Deliberately no database import: the mapping is unit-tested with plain
 * objects and the SQL lives in `ops.repository.ts`.
 */

/** Every queue the readiness summary reports, in display order. */
export const OPS_METRIC_KEYS = [
  'content_reports',
  'disputes',
  'reconciliation_diffs',
  'reconciliation_runs',
  'payouts',
  'outbox',
  'email'
] as const;

export type OpsMetricKey = (typeof OPS_METRIC_KEYS)[number];

/** Narrows a database `key` string before it becomes an object property. */
export function isOpsMetricKey(value: string): value is OpsMetricKey {
  return (OPS_METRIC_KEYS as readonly string[]).includes(value);
}

export interface OpsMetric {
  /** Rows that crossed their threshold. Zero is a healthy queue. */
  count: number;
  /**
   * Age of the oldest row, in whole hours. For SLA queues this is how long the
   * deadline has already been missed; for the others it is how long the item
   * has been waiting. `null` when there is nothing to report.
   */
  oldest_hours: number | null;
}

export type OpsSnapshot = Record<OpsMetricKey, OpsMetric>;

export type OpsAlertSeverity = 'critical' | 'warning';
export type OpsStatus = 'ok' | 'attention' | 'critical';

export interface OpsAlert {
  key: OpsMetricKey;
  severity: OpsAlertSeverity;
  title: string;
  /** Product copy: how many, and how old the oldest one is. */
  detail: string;
  /** What the operator should do next. */
  hint: string;
  href: string;
  count: number;
  oldest_hours: number | null;
}

export interface OpsAlertsView {
  generated_at: string;
  status: OpsStatus;
  alerts: OpsAlert[];
  /** Raw counters, including healthy zeroes, for the `/ops` detail table. */
  metrics: OpsSnapshot;
}

interface OpsAlertDefinition {
  severity: OpsAlertSeverity;
  title: string;
  noun: string;
  /** `{hours}` is replaced with the age of the oldest row. */
  age_template: string;
  hint: string;
  href: string;
}

/**
 * Thresholds live in SQL, not here. A definition only describes how to present
 * a non-zero counter; changing a threshold never changes this table.
 */
const OPS_ALERT_DEFINITIONS: Record<OpsMetricKey, OpsAlertDefinition> = {
  content_reports: {
    severity: 'critical',
    title: 'Laporan konten lewat SLA',
    noun: 'laporan',
    age_template: 'terlama lewat {hours} jam',
    hint: 'Putuskan laporan di antrean moderasi. Takedown menyembunyikan konten, bukan menghapusnya.',
    href: '/reports'
  },
  disputes: {
    severity: 'critical',
    title: 'Sengketa lewat SLA',
    noun: 'sengketa',
    age_template: 'terlama lewat {hours} jam',
    hint: 'Selesaikan sengketa. Keputusan memengaruhi dana booking yang sedang ditahan.',
    href: '/disputes'
  },
  reconciliation_diffs: {
    severity: 'critical',
    title: 'Temuan rekonsiliasi melewati SLA',
    noun: 'temuan',
    age_template: 'terlama lewat {hours} jam',
    hint: 'Bandingkan gateway dan ledger, lalu putuskan setiap temuan di halaman rekonsiliasi.',
    href: '/reconciliation'
  },
  reconciliation_runs: {
    severity: 'critical',
    title: 'Run rekonsiliasi gagal',
    noun: 'run',
    age_template: 'tertua {hours} jam lalu',
    hint: 'Periksa log worker reconcile_daily. Tanggal yang gagal tidak dihitung ulang otomatis.',
    href: '/reconciliation'
  },
  payouts: {
    severity: 'critical',
    title: 'Payout macet',
    noun: 'payout',
    age_template: 'tertahan {hours} jam',
    hint: 'Periksa status payout di provider. Approve yang menggantung menahan dana vendor.',
    href: '/payouts'
  },
  outbox: {
    severity: 'warning',
    title: 'Pesan outbox gagal',
    noun: 'pesan',
    age_template: 'tertua {hours} jam lalu',
    hint: 'Relay outbox mencoba ulang otomatis. Bila menetap, periksa last_error di database.',
    href: '/ops'
  },
  email: {
    severity: 'warning',
    title: 'Email notifikasi gagal (24 jam)',
    noun: 'email',
    age_template: 'tertua {hours} jam lalu',
    hint: 'Notifikasi in-app tetap terkirim. Periksa kredensial dan kuota penyedia email.',
    href: '/ops'
  }
};

const EMPTY_METRIC: OpsMetric = { count: 0, oldest_hours: null };

/** All queues healthy. Handy for tests and for defensive defaults. */
export function emptyOpsSnapshot(): OpsSnapshot {
  return OPS_METRIC_KEYS.reduce((snapshot, key) => {
    snapshot[key] = { ...EMPTY_METRIC };
    return snapshot;
  }, {} as OpsSnapshot);
}

function sanitiseMetric(value: OpsMetric | undefined): OpsMetric {
  if (!value || !Number.isFinite(value.count) || value.count <= 0) {
    return { ...EMPTY_METRIC };
  }
  const oldest =
    typeof value.oldest_hours === 'number' &&
    Number.isFinite(value.oldest_hours) &&
    value.oldest_hours >= 0
      ? value.oldest_hours
      : null;
  return { count: Math.trunc(value.count), oldest_hours: oldest };
}

/**
 * Fills missing keys with zeroes so a partial repository row set can never make
 * the endpoint throw. Counters that are not positive are treated as healthy.
 */
export function normaliseOpsSnapshot(
  input: Partial<Record<OpsMetricKey, OpsMetric | undefined>>
): OpsSnapshot {
  const snapshot = emptyOpsSnapshot();
  for (const key of OPS_METRIC_KEYS) {
    snapshot[key] = sanitiseMetric(input[key]);
  }
  return snapshot;
}

function describeMetric(definition: OpsAlertDefinition, metric: OpsMetric): string {
  const base = `${metric.count} ${definition.noun}`;
  if (metric.oldest_hours === null) return base;
  // The SQL rounds up, but stay defensive: never print "0 jam".
  const hours = Math.max(1, Math.round(metric.oldest_hours));
  return `${base} · ${definition.age_template.replace('{hours}', String(hours))}`;
}

const SEVERITY_RANK: Record<OpsAlertSeverity, number> = { critical: 0, warning: 1 };

/**
 * Builds the alert list for one request. `generatedAt` is injected so tests and
 * callers share the same clock.
 */
export function buildOpsAlerts(
  snapshot: Partial<Record<OpsMetricKey, OpsMetric | undefined>>,
  generatedAt: Date
): OpsAlertsView {
  const metrics = normaliseOpsSnapshot(snapshot);

  const alerts: OpsAlert[] = OPS_METRIC_KEYS.filter((key) => metrics[key].count > 0).map(
    (key) => {
      const definition = OPS_ALERT_DEFINITIONS[key];
      const metric = metrics[key];
      return {
        key,
        severity: definition.severity,
        title: definition.title,
        detail: describeMetric(definition, metric),
        hint: definition.hint,
        href: definition.href,
        count: metric.count,
        oldest_hours: metric.oldest_hours
      };
    }
  );

  alerts.sort(
    (left, right) =>
      SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] ||
      right.count - left.count ||
      left.key.localeCompare(right.key)
  );

  const status: OpsStatus =
    alerts.length === 0
      ? 'ok'
      : alerts.some((alert) => alert.severity === 'critical')
        ? 'critical'
        : 'attention';

  return {
    generated_at: generatedAt.toISOString(),
    status,
    alerts,
    metrics
  };
}
