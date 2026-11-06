import { describe, expect, it, vi } from 'vitest';

// The service opens one real transaction; tests must never touch PostgreSQL.
vi.mock('@tarlink/core/db', () => ({
  withTransaction: async <T>(fn: (client: unknown) => Promise<T>): Promise<T> => fn({ tx: 'client' }),
  query: vi.fn()
}));

import type { ReconDiff, ReconLine } from './reconciliation.match';
import type {
  AuditEntry,
  InsertRunInput,
  ReconDiffRow,
  ReconRunRow,
  ReconciliationRepository
} from './reconciliation.repository';
import { ReconciliationService } from './reconciliation.service';

function runRow(input: InsertRunInput): ReconRunRow {
  return {
    id: 'run-1',
    provider: input.provider,
    scope: 'payment',
    report_date: input.reportDate,
    status: input.status,
    report_source: 'webhook_events',
    gateway_total_idr: input.gatewayTotalIdr.toString(),
    ledger_total_idr: input.ledgerTotalIdr.toString(),
    diff_idr: input.diffIdr.toString(),
    diff_count: input.diffCount,
    matched_count: input.matchedCount,
    checked_count: input.checkedCount,
    triggered_by: input.actorId,
    trigger_source: 'admin',
    error_message: null,
    started_at: new Date('2026-11-06T00:00:00.000Z'),
    finished_at: new Date('2026-11-06T00:00:01.000Z'),
    created_at: new Date('2026-11-06T00:00:01.000Z')
  };
}

function createFake(gateway: ReconLine[], ledger: ReconLine[]) {
  const runs: ReconRunRow[] = [];
  const diffBatches: Array<{ runId: string; diffs: readonly ReconDiff[] }> = [];
  const audits: AuditEntry[] = [];

  const repository = {
    findGatewayPaymentLines: vi.fn(async () => gateway),
    findPaidPaymentLines: vi.fn(async () => ledger),
    findRunByKey: vi.fn(
      async (provider: string, reportDate: string) =>
        runs.find((row) => row.provider === provider && row.report_date === reportDate) ?? null
    ),
    insertRun: vi.fn(async (_client: unknown, input: InsertRunInput) => {
      const row = runRow(input);
      runs.push(row);
      return row;
    }),
    insertDiffs: vi.fn(
      async (_client: unknown, runId: string, diffs: readonly ReconDiff[]) => {
        diffBatches.push({ runId, diffs });
      }
    ),
    insertAudit: vi.fn(async (_client: unknown, entry: AuditEntry) => {
      audits.push(entry);
    }),
    listRuns: vi.fn(async () => ({ items: runs, total: runs.length })),
    getRun: vi.fn(async (id: string) => runs.find((row) => row.id === id) ?? null),
    listDiffs: vi.fn(async () => [] as ReconDiffRow[])
  };

  const service = new ReconciliationService(
    repository as unknown as ReconciliationRepository
  );
  return { service, repository, runs, diffBatches, audits };
}

const INPUT = {
  provider: 'midtrans',
  reportDate: '2026-11-06',
  actorId: 'admin-1',
  actorRole: 'admin_finance',
  requestId: 'req-1'
};

describe('ReconciliationService.run', () => {
  it('stores a balanced day and writes the audit row in the same transaction', async () => {
    const { service, repository, diffBatches, audits } = createFake(
      [{ externalId: 'order-1', amountIdr: 1_200_000n }],
      [{ externalId: 'order-1', amountIdr: 1_200_000n }]
    );

    const result = await service.run(INPUT);

    expect(result).toMatchObject({
      run_id: 'run-1',
      provider: 'midtrans',
      report_date: '2026-11-06',
      status: 'balanced',
      checked_count: 1,
      matched_count: 1,
      diff_count: 0,
      gateway_total_idr: 1_200_000,
      ledger_total_idr: 1_200_000,
      diff_idr: 0
    });
    expect(repository.findGatewayPaymentLines).toHaveBeenCalledWith(
      'midtrans',
      '2026-11-06',
      '2026-11-07'
    );
    expect(repository.insertRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: 'midtrans',
        reportDate: '2026-11-06',
        status: 'balanced',
        diffCount: 0,
        matchedCount: 1,
        checkedCount: 1
      })
    );
    expect(diffBatches).toHaveLength(1);
    expect(diffBatches[0]?.diffs.map((diff) => diff.classification)).toEqual(['matched']);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: 'reconciliation.run',
      entityType: 'reconciliation_run',
      entityId: 'run-1',
      actorId: 'admin-1',
      actorRole: 'admin_finance',
      requestId: 'req-1',
      beforeState: null
    });
    expect(audits[0]?.afterState).toMatchObject({
      provider: 'midtrans',
      scope: 'payment',
      report_date: '2026-11-06',
      status: 'balanced',
      diff_count: 0
    });
    // Both writes share the transaction client handed out by withTransaction.
    expect(repository.insertRun.mock.calls[0]?.[0]).toBe(
      repository.insertAudit.mock.calls[0]?.[0]
    );
  });

  it('stores a discrepancy run when the gateway has a payment the ledger does not', async () => {
    const { service, repository, diffBatches, audits } = createFake(
      [
        { externalId: 'order-1', amountIdr: 1_200_000n },
        { externalId: 'order-2', amountIdr: 500_000n }
      ],
      [{ externalId: 'order-1', amountIdr: 1_200_000n }]
    );

    const result = await service.run(INPUT);

    expect(result).toMatchObject({
      status: 'discrepancy',
      checked_count: 2,
      matched_count: 1,
      diff_count: 1,
      gateway_total_idr: 1_700_000,
      ledger_total_idr: 1_200_000,
      diff_idr: 500_000
    });
    expect(repository.insertRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'discrepancy', diffCount: 1 })
    );
    expect(diffBatches[0]?.diffs.map((diff) => diff.classification)).toEqual([
      'matched',
      'missing_in_ledger'
    ]);
    expect(audits[0]?.afterState).toMatchObject({ status: 'discrepancy', diff_count: 1 });
  });

  it('is idempotent per (provider, report_date): the second call returns the same run', async () => {
    const { service, repository, diffBatches, audits } = createFake(
      [{ externalId: 'order-1', amountIdr: 1_200_000n }],
      [{ externalId: 'order-1', amountIdr: 1_200_000n }]
    );

    const first = await service.run(INPUT);
    const second = await service.run(INPUT);

    expect(second).toEqual(first);
    expect(repository.findGatewayPaymentLines).toHaveBeenCalledTimes(1);
    expect(repository.insertRun).toHaveBeenCalledTimes(1);
    expect(diffBatches).toHaveLength(1);
    expect(audits).toHaveLength(1);
  });

  it('rejects an unsupported provider before touching any data', async () => {
    const { service, repository } = createFake([], []);

    await expect(service.run({ ...INPUT, provider: 'dana' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
    expect(repository.findRunByKey).not.toHaveBeenCalled();
    expect(repository.insertRun).not.toHaveBeenCalled();
  });

  it('rejects a calendar date that does not exist', async () => {
    const { service, repository } = createFake([], []);

    await expect(service.run({ ...INPUT, reportDate: '2026-02-30' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
    expect(repository.findRunByKey).not.toHaveBeenCalled();
  });
});

describe('ReconciliationService.detail', () => {
  it('returns the run plus its diffs with money converted at the boundary', async () => {
    const { service, repository } = createFake([], []);
    repository.getRun.mockResolvedValueOnce(
      runRow({
        provider: 'pjp',
        reportDate: '2026-11-06',
        status: 'discrepancy',
        gatewayTotalIdr: 1_200_000n,
        ledgerTotalIdr: 1_000_000n,
        diffIdr: 200_000n,
        diffCount: 1,
        matchedCount: 0,
        checkedCount: 1,
        actorId: 'admin-1'
      })
    );
    repository.listDiffs.mockResolvedValueOnce([
      {
        id: 'diff-1',
        run_id: 'run-1',
        classification: 'amount_mismatch',
        severity: 'critical',
        external_id: 'order-9',
        gateway_amount_idr: '1200000',
        ledger_amount_idr: '1000000',
        delta_idr: '200000',
        detail: {},
        due_at: null,
        resolved_at: null,
        created_at: new Date('2026-11-06T00:00:01.000Z')
      }
    ]);

    const detail = await service.detail('00000000-0000-0000-0000-000000000001');

    expect(detail.run_id).toBe('run-1');
    expect(detail.diffs).toEqual([
      {
        id: 'diff-1',
        classification: 'amount_mismatch',
        severity: 'critical',
        external_id: 'order-9',
        gateway_amount_idr: 1_200_000,
        ledger_amount_idr: 1_000_000,
        delta_idr: 200_000,
        detail: {},
        due_at: null,
        resolved_at: null
      }
    ]);
  });

  it('throws NOT_FOUND for an unknown run id', async () => {
    const { service } = createFake([], []);

    await expect(
      service.detail('00000000-0000-0000-0000-000000000002')
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
