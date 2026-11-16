import { ReconciliationRepository, type ReconDatabase } from '../../../../libs/modules/admin/src/reconciliation.repository';
import { query, withTransaction } from '../db';
import { errorMessage, logLine } from '../log';
import type { JobStats } from './runner';

/**
 * FR-131 daily reconciliation (worker).
 *
 * Once per WIB day, after `recon_hour_wib`, reconcile **yesterday** for every
 * provider that has ever appeared in `payments` or `webhook_events`. The run
 * itself is computed by the same `ReconciliationRepository.runDay` used by the
 * admin service, so the matcher, SQL, audit shape, and SLA are identical; this
 * module only decides *when* and *for whom*.
 *
 * Safety:
 * 1. `recon_enabled=false` (or a missing setting) disables the job entirely.
 * 2. The hour gate uses the database clock in Asia/Jakarta, not the process TZ.
 * 3. Idempotency is the DB UNIQUE `(provider, scope, report_date)`: every tick
 *    after the first run of the day is a no-op (`skipped`).
 * 4. A failing provider does not stop the others; the job reports `failed` so
 *    the tick line surfaces it.
 * 5. No journal entry and no money row is written — same read-only contract as
 *    manual runs.
 */

export interface ReconScheduleInput {
  enabled: boolean;
  /** `recon_hour_wib`: first WIB hour the daily run may start. */
  startHourWib: number;
  /** Current WIB hour (0-23) read from the database. */
  currentHourWib: number;
}

/** Pure gate, exported for tests. */
export function shouldRunRecon(input: ReconScheduleInput): boolean {
  if (!input.enabled) return false;
  if (!Number.isInteger(input.startHourWib) || input.startHourWib < 0 || input.startHourWib > 23) {
    return false;
  }
  return input.currentHourWib >= input.startHourWib && input.currentHourWib <= 23;
}

/** Previous WIB calendar date (`2026-03-01` -> `2026-02-28`). */
export function previousWibDate(wibDate: string): string {
  return shiftWibDate(wibDate, -1);
}

function shiftWibDate(wibDate: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(wibDate);
  if (!match) throw new Error('Tanggal WIB tidak valid');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  // Reject `2026-02-30` / `2026-13-01`: Date.UTC would silently roll them over.
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== wibDate) {
    throw new Error('Tanggal WIB tidak valid');
  }
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export interface CatchUpInput {
  /** Latest `report_date` already reconciled for the provider, or null. */
  latestReportDate: string | null;
  /** Target day: yesterday in WIB. */
  yesterday: string;
  /** Upper bound of days backfilled in one tick (default 7). */
  maxDays?: number;
}

/**
 * Dates still to reconcile for one provider.
 *
 * A worker that was down for a few days catches up on the next tick, but never
 * more than `maxDays` back: unbounded backfill would rewrite history and turn a
 * long outage into one huge tick. A provider with no run at all starts at
 * `yesterday` only — there is nothing to compare against before that.
 */
export function reconciliationDatesToRun(input: CatchUpInput): string[] {
  const maxDays =
    input.maxDays === undefined ? 7 : Math.min(Math.max(Math.trunc(input.maxDays), 1), 31);
  const yesterday = shiftWibDate(input.yesterday, 0);
  if (input.latestReportDate === null) return [yesterday];

  const latest = shiftWibDate(input.latestReportDate, 0);
  if (latest >= yesterday) return [];

  const windowStart = shiftWibDate(yesterday, -(maxDays - 1));
  const start = latest < windowStart ? windowStart : shiftWibDate(latest, 1);
  const dates: string[] = [];
  for (let date = start; date <= yesterday; date = shiftWibDate(date, 1)) {
    dates.push(date);
  }
  return dates;
}

const CLOCK_SQL = `
SELECT to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS wib_date,
       EXTRACT(HOUR FROM (now() AT TIME ZONE 'Asia/Jakarta'))::int AS wib_hour
`;

const SETTINGS_SQL = `
SELECT key, value
  FROM platform_settings
 WHERE key IN ('recon_enabled', 'recon_hour_wib')
`;

/**
 * Providers that ever produced a payment or a webhook. A provider with no data
 * at all has nothing to reconcile; a provider with only webhooks is exactly the
 * `missing_in_ledger` case this lane must still report.
 */
const PROVIDERS_SQL = `
SELECT DISTINCT provider
  FROM (
    SELECT provider FROM payments
    UNION
    SELECT provider FROM webhook_events
  ) AS sources
 WHERE provider IN ('midtrans', 'pjp')
 ORDER BY provider
`;

interface SettingRow {
  key: string;
  value: unknown;
}

interface ProviderRow {
  provider: string;
}

interface ClockRow {
  wib_date: string;
  wib_hour: number;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  if (typeof value === 'object' && value !== null) {
    const candidate = (value as Record<string, unknown>).value;
    if (typeof candidate === 'boolean') return candidate;
  }
  return null;
}

function asInt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number.parseInt(value, 10);
  if (typeof value === 'object' && value !== null) {
    const candidate = (value as Record<string, unknown>).value;
    if (typeof candidate === 'number' && Number.isInteger(candidate)) return candidate;
    if (typeof candidate === 'string' && /^\d+$/.test(candidate)) {
      return Number.parseInt(candidate, 10);
    }
  }
  return fallback;
}

let repository: ReconciliationRepository | null = null;

function getRepository(): ReconciliationRepository {
  if (!repository) {
    const db: ReconDatabase = { query, withTransaction };
    repository = new ReconciliationRepository(db);
  }
  return repository;
}

/** Missing key means disabled: a failed seed must never start writing runs. */
function readEnabled(rows: readonly SettingRow[]): boolean {
  const row = rows.find((entry) => entry.key === 'recon_enabled');
  return row === undefined ? false : asBoolean(row.value) === true;
}

function readHour(rows: readonly SettingRow[]): number {
  const row = rows.find((entry) => entry.key === 'recon_hour_wib');
  const hour = row === undefined ? 7 : asInt(row.value, 7);
  return hour >= 0 && hour <= 23 ? hour : 7;
}

export async function runReconcileDaily(_batch: number): Promise<JobStats> {
  const stats: JobStats = { processed: 0, skipped: 0, failed: 0 };

  const clock = await query<ClockRow>(CLOCK_SQL);
  const current = clock[0];
  if (!current) throw new Error('Jam WIB tidak bisa dibaca');

  const settings = await query<SettingRow>(SETTINGS_SQL);
  const due = shouldRunRecon({
    enabled: readEnabled(settings),
    startHourWib: readHour(settings),
    currentHourWib: current.wib_hour
  });
  if (!due) {
    stats.skipped += 1;
    return stats;
  }

  const reportDate = previousWibDate(current.wib_date);
  const providers = await query<ProviderRow>(PROVIDERS_SQL);
  if (providers.length === 0) {
    stats.skipped += 1;
    return stats;
  }

  for (const row of providers) {
    try {
      const latestReportDate = await getRepository().findLatestReportDate(row.provider);
      const dates = reconciliationDatesToRun({ latestReportDate, yesterday: reportDate });
      if (dates.length === 0) {
        stats.skipped += 1;
        continue;
      }

      for (const date of dates) {
        const result = await getRepository().runDay({
          provider: row.provider,
          reportDate: date,
          triggerSource: 'worker',
          requestId: null
        });
        if (result.created) {
          stats.processed += 1;
          logLine(
            `reconcile_daily provider=${result.run.provider} date=${result.run.report_date} status=${result.run.status} checked=${result.run.checked_count} diffs=${result.run.diff_count}`
          );
        } else {
          stats.skipped += 1;
        }
      }
    } catch (err) {
      stats.failed += 1;
      logLine(
        `reconcile_daily_failed provider=${row.provider} date=${reportDate} error=${errorMessage(err)}`
      );
    }
  }

  return stats;
}
