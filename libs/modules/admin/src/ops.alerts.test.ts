import { describe, expect, it } from 'vitest';
import {
  OPS_METRIC_KEYS,
  buildOpsAlerts,
  emptyOpsSnapshot,
  normaliseOpsSnapshot,
  type OpsMetric,
  type OpsSnapshot
} from './ops.alerts';

const NOW = new Date('2026-11-08T04:00:00.000Z');

function snapshot(overrides: Partial<Record<(typeof OPS_METRIC_KEYS)[number], OpsMetric>>): OpsSnapshot {
  return { ...emptyOpsSnapshot(), ...overrides };
}

describe('buildOpsAlerts', () => {
  it('reports every queue healthy when all counters are zero', () => {
    const view = buildOpsAlerts(emptyOpsSnapshot(), NOW);

    expect(view.status).toBe('ok');
    expect(view.alerts).toEqual([]);
    expect(view.generated_at).toBe('2026-11-08T04:00:00.000Z');
    expect(Object.keys(view.metrics).sort()).toEqual([...OPS_METRIC_KEYS].sort());
    expect(view.metrics.content_reports).toEqual({ count: 0, oldest_hours: null });
  });

  it('turns a positive counter into an alert with count, age and destination', () => {
    const view = buildOpsAlerts(
      snapshot({ content_reports: { count: 3, oldest_hours: 26 } }),
      NOW
    );

    expect(view.status).toBe('critical');
    expect(view.alerts).toHaveLength(1);
    expect(view.alerts[0]).toMatchObject({
      key: 'content_reports',
      severity: 'critical',
      title: 'Laporan konten lewat SLA',
      count: 3,
      oldest_hours: 26,
      href: '/reports'
    });
    expect(view.alerts[0].detail).toBe('3 laporan · terlama lewat 26 jam');
    expect(view.alerts[0].hint).toContain('Takedown');
  });

  it('treats failed payment webhooks as critical and points to the payments page', () => {
    const view = buildOpsAlerts(snapshot({ webhooks: { count: 2, oldest_hours: 1 } }), NOW);

    expect(view.status).toBe('critical');
    expect(view.alerts[0]).toMatchObject({
      key: 'webhooks',
      severity: 'critical',
      count: 2,
      href: '/payments'
    });
    expect(view.alerts[0].hint).toContain('refund manual');
  });

  it('is attention-only when the only findings are warnings', () => {
    const view = buildOpsAlerts(
      snapshot({
        outbox: { count: 2, oldest_hours: 5 },
        email: { count: 1, oldest_hours: 1 }
      }),
      NOW
    );

    expect(view.status).toBe('attention');
    expect(view.alerts.map((alert) => alert.key)).toEqual(['outbox', 'email']);
    expect(view.alerts[0].severity).toBe('warning');
  });

  it('sorts critical first, then by count, then by key', () => {
    const view = buildOpsAlerts(
      snapshot({
        email: { count: 9, oldest_hours: 2 },
        disputes: { count: 1, oldest_hours: 3 },
        content_reports: { count: 4, oldest_hours: 30 },
        reconciliation_runs: { count: 4, oldest_hours: 48 }
      }),
      NOW
    );

    expect(view.status).toBe('critical');
    expect(view.alerts.map((alert) => alert.key)).toEqual([
      'content_reports',
      'reconciliation_runs',
      'disputes',
      'email'
    ]);
  });

  it('treats a missing or malformed metric as healthy instead of throwing', () => {
    const partial = {
      disputes: { count: 2, oldest_hours: null },
      payouts: { count: Number.NaN, oldest_hours: 4 },
      outbox: { count: -1, oldest_hours: 2 }
    } as unknown as Partial<Record<(typeof OPS_METRIC_KEYS)[number], OpsMetric>>;

    const view = buildOpsAlerts(partial, NOW);

    expect(view.metrics.payouts).toEqual({ count: 0, oldest_hours: null });
    expect(view.metrics.outbox).toEqual({ count: 0, oldest_hours: null });
    expect(view.metrics.email).toEqual({ count: 0, oldest_hours: null });
    expect(view.alerts).toHaveLength(1);
    expect(view.alerts[0].key).toBe('disputes');
    expect(view.alerts[0].detail).toBe('2 sengketa');
  });

  it('never shows a zero-hour age when the database rounds down', () => {
    const view = buildOpsAlerts(
      snapshot({ payouts: { count: 1, oldest_hours: 0 } }),
      NOW
    );

    expect(view.alerts[0].detail).toBe('1 payout · tertahan 1 jam');
  });

  it('has a usable title, hint and panel route for every queue', () => {
    const full = snapshot(
      Object.fromEntries(
        OPS_METRIC_KEYS.map((key) => [key, { count: 1, oldest_hours: 2 }])
      ) as Record<(typeof OPS_METRIC_KEYS)[number], OpsMetric>
    );
    const view = buildOpsAlerts(full, NOW);

    expect(view.alerts).toHaveLength(OPS_METRIC_KEYS.length);
    for (const alert of view.alerts) {
      expect(alert.title.length).toBeGreaterThan(4);
      expect(alert.hint.length).toBeGreaterThan(10);
      expect(alert.href.startsWith('/')).toBe(true);
      expect(alert.detail).toContain('1 ');
    }
  });
});

describe('normaliseOpsSnapshot', () => {
  it('keeps a valid age and clears it when there is no count', () => {
    const normalised = normaliseOpsSnapshot({
      email: { count: 2, oldest_hours: 7 },
      outbox: { count: 0, oldest_hours: 7 }
    });

    expect(normalised.email).toEqual({ count: 2, oldest_hours: 7 });
    expect(normalised.outbox).toEqual({ count: 0, oldest_hours: null });
  });
});
