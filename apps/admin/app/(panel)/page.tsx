'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CalendarDays, ShieldAlert, Wallet } from 'lucide-react';
import { useState } from 'react';
import { BookingTrendCard, PaymentMixCard } from '@/components/dashboard/operation-charts';
import { ActionQueueCard, OperationHealthCard } from '@/components/dashboard/operation-overview';
import {
  BlockSkeleton,
  Button,
  Card,
  ErrorState,
  KpiCard,
  PageHeader,
  StatGrid,
  StatSkeleton
} from '@/components/ui';
import { getDashboard } from '@/lib/api';
import { formatIDR, relativeFrom } from '@/lib/format';
import { MOCK_NOW } from '@/lib/mock';

export default function DashboardPage() {
  const [range, setRange] = useState<'7d' | '30d'>('7d');

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['dashboard'],
    queryFn: getDashboard
  });

  return (
    <div>
      {isLoading ? (
        <div className="space-y-4">
          <StatSkeleton />
          <Card>
            <BlockSkeleton rows={6} />
          </Card>
        </div>
      ) : isError ? (
        <Card>
          <ErrorState
            message={
              error instanceof Error
                ? error.message
                : 'Ringkasan tidak bisa dimuat. Periksa koneksi lalu coba lagi.'
            }
            onRetry={() => void refetch()}
            retrying={isFetching}
          />
        </Card>
      ) : data ? (
        <div className="space-y-4">
          <PageHeader
            title="Ringkasan operasi"
            description="Rabu, 21 Oktober 2026 · ringkasan booking masuk, pencairan, dan kesehatan operasi Tarlink."
          />
          <StatGrid>
            <KpiCard
              label="Booking masuk hari ini"
              value={String(data.kpis.bookings_today)}
              note={`${data.kpis.bookings_today_needs_response} menunggu respons vendor`}
              icon={<CalendarDays className="h-5 w-5" />}
              tone="primary"
            />
            <KpiCard
              label="Menunggu DP"
              value={String(data.kpis.awaiting_dp)}
              note={
                data.kpis.awaiting_dp_overdue > 0
                  ? `${data.kpis.awaiting_dp_overdue} lewat batas bayar`
                  : 'Semua masih dalam batas bayar'
              }
              icon={<Wallet className="h-5 w-5" />}
              tone={data.kpis.awaiting_dp_overdue > 0 ? 'danger' : 'ok'}
            />
            <KpiCard
              label="Siap dicairkan"
              value={String(data.kpis.ready_to_release)}
              note={`${formatIDR(data.kpis.ready_to_release_idr)} hak vendor`}
              icon={<Wallet className="h-5 w-5" />}
              tone="soft"
            />
            <KpiCard
              label="Sengketa terbuka"
              value={String(data.kpis.open_disputes)}
              note={
                data.kpis.oldest_dispute_due_at
                  ? `SLA ${relativeFrom(MOCK_NOW, data.kpis.oldest_dispute_due_at)}`
                  : 'Tidak ada sengketa aktif'
              }
              icon={<ShieldAlert className="h-5 w-5" />}
              tone={data.kpis.open_disputes > 0 ? 'danger' : 'ok'}
            />
          </StatGrid>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.85fr)_minmax(0,1fr)]">
            <BookingTrendCard
              points7d={data.daily_bookings_7d}
              points30d={data.daily_bookings_30d}
              range={range}
              onRangeChange={setRange}
            />
            <PaymentMixCard mix={data.payment_mix} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <ActionQueueCard items={data.queue} />
            <OperationHealthCard health={data.health} />
          </div>

          <div className="flex justify-end">
            <Button variant="ghost" href="/bookings" iconAfter={<ArrowRight aria-hidden className="h-4 w-4" />}>
              Lihat semua booking
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
