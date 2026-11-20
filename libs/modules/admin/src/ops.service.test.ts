import { describe, expect, it, vi } from 'vitest';
import { emptyOpsSnapshot } from './ops.alerts';
import type { OpsRepository } from './ops.repository';
import { OpsService } from './ops.service';

function repositoryWith(snapshot: ReturnType<typeof emptyOpsSnapshot>): {
  repository: OpsRepository;
  snapshot: ReturnType<typeof vi.fn>;
} {
  const snapshotFn = vi.fn().mockResolvedValue(snapshot);
  return {
    repository: { snapshot: snapshotFn } as unknown as OpsRepository,
    snapshot: snapshotFn
  };
}

describe('OpsService', () => {
  it('maps the repository snapshot into a critical readiness view', async () => {
    const snapshot = emptyOpsSnapshot();
    snapshot.disputes = { count: 2, oldest_hours: 9 };
    const { repository, snapshot: snapshotFn } = repositoryWith(snapshot);

    const view = await new OpsService(repository).alerts();

    expect(snapshotFn).toHaveBeenCalledTimes(1);
    expect(view.status).toBe('critical');
    expect(view.alerts).toHaveLength(1);
    expect(view.alerts[0]).toMatchObject({ key: 'disputes', count: 2, oldest_hours: 9 });
    expect(Number.isNaN(Date.parse(view.generated_at))).toBe(false);
    expect(view.metrics.payouts).toEqual({ count: 0, oldest_hours: null });
  });

  it('reports ok without alerts when every queue is empty', async () => {
    const { repository } = repositoryWith(emptyOpsSnapshot());

    const view = await new OpsService(repository).alerts();

    expect(view.status).toBe('ok');
    expect(view.alerts).toEqual([]);
  });
});
