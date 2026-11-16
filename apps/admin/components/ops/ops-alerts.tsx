'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle2,
  Flag,
  RefreshCw,
  ShieldAlert,
  Wallet
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  Alert,
  BlockSkeleton,
  Button,
  Card,
  CardHeader,
  ErrorState,
  KpiCard,
  StatGrid,
  StatusBadge
} from '@/components/ui';
import { getOpsAlerts } from '@/lib/api';
import type { OpsAlertItem, OpsAlerts } from '@/lib/types';

/** Icons per queue; unknown keys fall back to the generic activity icon. */
const ALERT_ICONS: Record<string, typeof Activity> = {
  content_reports: Flag,
  disputes: ShieldAlert,
  reconciliation_diffs: ShieldAlert,
  reconciliation_runs: ShieldAlert,
  payouts: Wallet,
  outbox: Bell,
  email: Bell
};

const STATUS_COPY: Record<OpsAlerts['status'], { title: string; body: string; tone: 'ok' | 'warning' | 'danger' }> = {
  ok: {
    title: 'Semua antrean operasional aman',
    body: 'Tidak ada laporan, sengketa, temuan rekonsiliasi, payout, atau kiriman yang melewati batas.',
    tone: 'ok'
  },
  attention: {
    title: 'Ada antrean yang perlu dipantau',
    body: 'Belum ada yang kritis, tetapi beberapa antrean sudah melewati batas dan bisa menumpuk bila dibiarkan.',
    tone: 'warning'
  },
  critical: {
    title: 'Ada antrean kritis yang perlu ditindaklanjuti',
    body: 'SLA moderasi, sengketa, rekonsiliasi, atau payout sudah terlewati. Selesaikan dari halaman terkait.',
    tone: 'danger'
  }
};

function severityBadge(severity: OpsAlertItem['severity']): ReactNode {
  return severity === 'critical' ? (
    <StatusBadge tone="danger">Kritis</StatusBadge>
  ) : (
    <StatusBadge tone="soft">Peringatan</StatusBadge>
  );
}

/**
 * Compact dashboard banner. Renders nothing while loading, on error, or when
 * every queue is healthy, so a failing ops endpoint never blocks the dashboard.
 */
export function OpsAlertsBanner() {
  const { data } = useQuery({
    queryKey: ['ops-alerts'],
    queryFn: getOpsAlerts,
    staleTime: 30_000
  });

  if (!data || data.status === 'ok' || data.alerts.length === 0) return null;

  const lead = data.alerts[0];
  const rest = data.alerts.length - 1;
  const tone = data.status === 'critical' ? 'danger' : 'warning';

  return (
    <Alert
      tone={tone}
      title={
        data.status === 'critical'
          ? 'Antrean operasional kritis'
          : 'Antrean operasional perlu dipantau'
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          {lead.title} · {lead.detail}
          {rest > 0 ? ` · +${rest} antrean lain` : ''}
        </span>
        <Link href="/ops" className="font-semibold underline underline-offset-2">
          Buka operasional
        </Link>
      </div>
    </Alert>
  );
}

function metricSummary(metric: { count: number; oldest_hours: number | null } | undefined): string {
  if (!metric || metric.count === 0) return '0';
  const age =
    metric.oldest_hours === null
      ? ''
      : ` · tertua ${Math.max(1, Math.round(metric.oldest_hours))} jam`;
  return `${metric.count}${age}`;
}

const METRIC_ORDER: Array<{ key: string; label: string }> = [
  { key: 'content_reports', label: 'Laporan konten lewat SLA' },
  { key: 'disputes', label: 'Sengketa lewat SLA' },
  { key: 'reconciliation_diffs', label: 'Temuan rekonsiliasi lewat SLA' },
  { key: 'reconciliation_runs', label: 'Run rekonsiliasi gagal (24 jam)' },
  { key: 'payouts', label: 'Payout macet' },
  { key: 'outbox', label: 'Pesan outbox gagal' },
  { key: 'email', label: 'Email notifikasi gagal (24 jam)' }
];

function AlertsCard({ alerts }: { alerts: OpsAlertItem[] }) {
  if (alerts.length === 0) {
    return (
      <Card>
        <CardHeader
          icon={<CheckCircle2 aria-hidden className="h-[17px] w-[17px]" />}
          title="Antrean bermasalah"
          description="Semua antrean berada di dalam batasnya."
        />
        <p className="px-5 pb-5 text-sm text-textSecondary">
          Tidak ada tindakan yang dibutuhkan saat ini. Halaman ini akan menampilkan antrean yang
          melewati SLA pada pemeriksaan berikutnya.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        icon={<AlertTriangle aria-hidden className="h-[17px] w-[17px]" />}
        title="Antrean bermasalah"
        description="Kritis lebih dulu, lalu jumlah terbesar. Setiap baris menuju halaman tindakannya."
      />
      <ul className="divide-y divide-border">
        {alerts.map((alert) => {
          const Icon = ALERT_ICONS[alert.key] ?? Activity;
          return (
            <li key={alert.key} className="flex items-start gap-3 px-5 py-4">
              <span
                aria-hidden
                className={
                  alert.severity === 'critical'
                    ? 'grid h-9 w-9 shrink-0 place-items-center rounded-full bg-dangerSoft text-danger'
                    : 'grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accentSoft text-accentInk'
                }
              >
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[15px] font-semibold text-textMain">{alert.title}</p>
                  {severityBadge(alert.severity)}
                </div>
                <p className="mt-1 text-sm text-textSecondary">{alert.detail}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-textMuted">{alert.hint}</p>
              </div>
              <Button variant="ghost" size="sm" href={alert.href} className="shrink-0">
                Buka
              </Button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function MetricsCard({ data }: { data: OpsAlerts }) {
  return (
    <Card>
      <CardHeader
        icon={<Activity aria-hidden className="h-[17px] w-[17px]" />}
        title="Semua antrean yang dipantau"
        description="Termasuk antrean yang sedang nol, supaya sinyal yang hilang tetap terlihat."
      />
      <ul className="divide-y divide-border">
        {METRIC_ORDER.map((metric) => {
          const value = data.metrics[metric.key];
          const active = (value?.count ?? 0) > 0;
          return (
            <li key={metric.key} className="flex items-baseline justify-between gap-3 px-5 py-3">
              <span className="text-sm text-textSecondary">{metric.label}</span>
              <span
                className={
                  active
                    ? 'tnum text-sm font-semibold text-textMain'
                    : 'tnum text-sm font-medium text-textMuted'
                }
              >
                {metricSummary(value)}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="px-5 pb-5 pt-3 text-[13px] leading-relaxed text-textMuted">
        Endpoint ini hanya membaca. Tidak ada status booking, ledger, atau payout yang diubah.
      </p>
    </Card>
  );
}

/** Full `/ops` view: summary, alert list, and the raw queue counters. */
export function OpsAlertsView() {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['ops-alerts'],
    queryFn: getOpsAlerts
  });

  if (isLoading) {
    return (
      <Card>
        <BlockSkeleton rows={7} />
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card>
        <ErrorState
          message={
            error instanceof Error
              ? error.message
              : 'Ringkasan operasional tidak bisa dimuat. Periksa koneksi lalu coba lagi.'
          }
          onRetry={() => void refetch()}
          retrying={isFetching}
        />
      </Card>
    );
  }

  const copy = STATUS_COPY[data.status];
  const critical = data.alerts.filter((alert) => alert.severity === 'critical').length;
  const warning = data.alerts.length - critical;
  const updatedAt = new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta'
  }).format(new Date(data.generated_at));

  return (
    <div className="space-y-4">
      <Alert tone={copy.tone} title={copy.title}>
        {copy.body}
      </Alert>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-textMuted">
          Diperbarui {updatedAt} WIB · {data.alerts.length} antrean bermasalah
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refetch()}
          disabled={isFetching}
          icon={<RefreshCw aria-hidden className={isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />}
        >
          Muat ulang
        </Button>
      </div>

      <StatGrid>
        <KpiCard
          label="Kritis"
          value={String(critical)}
          note={critical > 0 ? 'Lewat SLA atau gagal total' : 'Tidak ada antrean kritis'}
          icon={<ShieldAlert className="h-5 w-5" />}
          tone={critical > 0 ? 'danger' : 'ok'}
        />
        <KpiCard
          label="Peringatan"
          value={String(warning)}
          note={warning > 0 ? 'Perlu dipantau, belum memblokir' : 'Tidak ada peringatan'}
          icon={<Bell className="h-5 w-5" />}
          tone={warning > 0 ? 'soft' : 'ok'}
        />
        <KpiCard
          label="Antrean dipantau"
          value={String(METRIC_ORDER.length)}
          note="Moderasi, sengketa, rekonsiliasi, payout, notifikasi"
          icon={<Activity className="h-5 w-5" />}
          tone="primary"
        />
      </StatGrid>

      <AlertsCard alerts={data.alerts} />
      <MetricsCard data={data} />
    </div>
  );
}
