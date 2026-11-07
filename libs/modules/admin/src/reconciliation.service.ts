/**
 * FR-131 phase 1: read-only daily reconciliation for the `payment` lane.
 *
 * The service computes a run from internal data (`webhook_events` as the
 * gateway side, `payments` as the ledger side), stores the findings in
 * `reconciliation_runs` / `reconciliation_diffs`, and writes one audit row.
 * It never posts a journal entry and never mutates a payment: per D-03 of
 * plan.md, corrections stay a manual decision outside this module.
 *
 * Idempotency: `reconciliation_runs` is UNIQUE (provider, scope, report_date).
 * The service reads the existing run first and, to survive a concurrent
 * request, also inserts with ON CONFLICT DO NOTHING inside the transaction.
 * A second call therefore returns the first run unchanged — no second diff
 * batch, no second audit row.
 */
import { Injectable } from '@nestjs/common';
import { withTransaction } from '@tarlink/core/db';
import { AppError } from '@tarlink/core/errors';
import { idrToJson } from './money';
import { matchPaymentDay, type ReconDiff } from './reconciliation.match';
import {
  ReconciliationRepository,
  type ReconClassification,
  type ReconDiffRow,
  type ReconRunRow,
  type ReconRunStatus,
  type ReconSeverity
} from './reconciliation.repository';

export type ReconciliationProvider = 'midtrans' | 'pjp';

export interface ReconciliationRunSummary {
  run_id: string;
  provider: string;
  report_date: string;
  status: ReconRunStatus;
  report_source: string;
  trigger_source: string;
  checked_count: number;
  matched_count: number;
  diff_count: number;
  gateway_total_idr: number;
  ledger_total_idr: number;
  diff_idr: number;
  started_at: string;
  finished_at: string | null;
}

export interface ReconciliationDiffView {
  id: string;
  classification: ReconClassification;
  severity: ReconSeverity;
  external_id: string | null;
  gateway_amount_idr: number | null;
  ledger_amount_idr: number | null;
  delta_idr: number | null;
  detail: Record<string, unknown>;
  due_at: string | null;
  resolved_at: string | null;
}

export interface ReconciliationRunDetail extends ReconciliationRunSummary {
  diffs: ReconciliationDiffView[];
}

export interface ReconciliationRunList {
  items: ReconciliationRunSummary[];
  total: number;
  page: number;
  page_size: number;
}

export interface RunReconciliationInput {
  provider: string;
  reportDate: string;
  actorId: string;
  actorRole: string;
  requestId: string | null;
}

export interface ListRunsQuery {
  page?: number;
  page_size?: number;
}

const PROVIDERS: readonly ReconciliationProvider[] = ['midtrans', 'pjp'];
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

/** `YYYY-MM-DD` that also round-trips, so `2026-02-30` is rejected. */
function parseReportDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new AppError('VALIDATION_ERROR', 'report_date harus berformat YYYY-MM-DD');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.toISOString().slice(0, 10) !== value) {
    throw new AppError('VALIDATION_ERROR', 'report_date bukan tanggal kalender yang valid');
  }
  return value;
}

/** Next WIB calendar date, expressed as a date string (exclusive upper bound). */
function nextReportDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new AppError('VALIDATION_ERROR', 'report_date harus berformat YYYY-MM-DD');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString().slice(0, 10);
}

function parseProvider(value: string): ReconciliationProvider {
  if (value !== 'midtrans' && value !== 'pjp') {
    throw new AppError(
      'VALIDATION_ERROR',
      `Provider rekonsiliasi harus salah satu dari: ${PROVIDERS.join(', ')}`
    );
  }
  return value;
}

function parsePage(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) {
    throw new AppError('VALIDATION_ERROR', 'page harus bilangan bulat >= 1');
  }
  return value;
}

function parsePageSize(value: number | undefined): number {
  if (value === undefined) return DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
    throw new AppError('VALIDATION_ERROR', `page_size harus antara 1 dan ${MAX_PAGE_SIZE}`);
  }
  return value;
}

function countFindings(diffs: readonly ReconDiff[]): number {
  return diffs.filter((diff) => diff.classification !== 'matched').length;
}

function toSummary(row: ReconRunRow): ReconciliationRunSummary {
  return {
    run_id: row.id,
    provider: row.provider,
    report_date: row.report_date,
    status: row.status,
    report_source: row.report_source,
    trigger_source: row.trigger_source,
    checked_count: row.checked_count,
    matched_count: row.matched_count,
    diff_count: row.diff_count,
    gateway_total_idr: idrToJson(row.gateway_total_idr, 'gateway_total_idr'),
    ledger_total_idr: idrToJson(row.ledger_total_idr, 'ledger_total_idr'),
    diff_idr: idrToJson(row.diff_idr, 'diff_idr'),
    started_at: row.started_at.toISOString(),
    finished_at: row.finished_at === null ? null : row.finished_at.toISOString()
  };
}

function toDiffView(row: ReconDiffRow): ReconciliationDiffView {
  return {
    id: row.id,
    classification: row.classification,
    severity: row.severity,
    external_id: row.external_id,
    gateway_amount_idr:
      row.gateway_amount_idr === null
        ? null
        : idrToJson(row.gateway_amount_idr, 'gateway_amount_idr'),
    ledger_amount_idr:
      row.ledger_amount_idr === null ? null : idrToJson(row.ledger_amount_idr, 'ledger_amount_idr'),
    delta_idr: row.delta_idr === null ? null : idrToJson(row.delta_idr, 'delta_idr'),
    detail: row.detail,
    due_at: row.due_at === null ? null : row.due_at.toISOString(),
    resolved_at: row.resolved_at === null ? null : row.resolved_at.toISOString()
  };
}

@Injectable()
export class ReconciliationService {
  constructor(private readonly repository: ReconciliationRepository) {}

  async run(input: RunReconciliationInput): Promise<ReconciliationRunSummary> {
    const provider = parseProvider(input.provider);
    const reportDate = parseReportDate(input.reportDate);

    const existing = await this.repository.findRunByKey(provider, reportDate);
    if (existing) return toSummary(existing);

    const to = nextReportDate(reportDate);
    const [gateway, ledger] = await Promise.all([
      this.repository.findGatewayPaymentLines(provider, reportDate, to),
      this.repository.findPaidPaymentLines(provider, reportDate, to)
    ]);

    const matched = matchPaymentDay(gateway, ledger);
    const diffCount = countFindings(matched.diffs);
    const status: 'balanced' | 'discrepancy' = diffCount === 0 ? 'balanced' : 'discrepancy';

    return withTransaction(async (client) => {
      const inserted = await this.repository.insertRun(client, {
        provider,
        reportDate,
        status,
        gatewayTotalIdr: matched.gatewayTotalIdr,
        ledgerTotalIdr: matched.ledgerTotalIdr,
        diffIdr: matched.diffIdr,
        diffCount,
        matchedCount: matched.matchedCount,
        checkedCount: matched.checkedCount,
        actorId: input.actorId
      });

      if (!inserted) {
        // A concurrent request won the UNIQUE key: return its run unchanged.
        const concurrent = await this.repository.findRunByKey(provider, reportDate, client);
        if (!concurrent) {
          throw new AppError('INTERNAL_ERROR', 'Run rekonsiliasi gagal disimpan');
        }
        return toSummary(concurrent);
      }

      await this.repository.insertDiffs(client, inserted.id, matched.diffs);
      await this.repository.insertAudit(client, {
        actorId: input.actorId,
        actorRole: input.actorRole,
        action: 'reconciliation.run',
        entityType: 'reconciliation_run',
        entityId: inserted.id,
        beforeState: null,
        afterState: {
          provider,
          scope: 'payment',
          report_date: reportDate,
          status,
          checked_count: matched.checkedCount,
          matched_count: matched.matchedCount,
          diff_count: diffCount,
          gateway_total_idr: matched.gatewayTotalIdr.toString(),
          ledger_total_idr: matched.ledgerTotalIdr.toString(),
          diff_idr: matched.diffIdr.toString()
        },
        requestId: input.requestId
      });

      return toSummary(inserted);
    });
  }

  async list(query: ListRunsQuery): Promise<ReconciliationRunList> {
    const page = parsePage(query.page, 1);
    const pageSize = parsePageSize(query.page_size);
    const { items, total } = await this.repository.listRuns({
      limit: pageSize,
      offset: (page - 1) * pageSize
    });
    return {
      items: items.map(toSummary),
      total,
      page,
      page_size: pageSize
    };
  }

  async detail(id: string): Promise<ReconciliationRunDetail> {
    const run = await this.repository.getRun(id);
    if (!run) throw new AppError('NOT_FOUND', 'Run rekonsiliasi tidak ditemukan');
    const diffs = await this.repository.listDiffs(run.id);
    return { ...toSummary(run), diffs: diffs.map(toDiffView) };
  }
}
