'use client';

import { useQuery } from '@tanstack/react-query';
import { Scale, ShieldAlert } from 'lucide-react';
import {
  BlockSkeleton,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  KpiCard,
  PageHeader,
  StatGrid,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeadCell,
  TableRow,
  TableSkeleton,
  TitleBlock
} from '@/components/ui';
import { getDisputes } from '@/lib/api';
import { formatDateTimeID, formatIDR, relativeFrom } from '@/lib/format';
import { MOCK_NOW } from '@/lib/mock';

const DISPUTE_STATUS_LABELS: Record<string, string> = {
  open: 'Terbuka',
  resolved_to_vendor: 'Diputuskan ke vendor',
  resolved_refund: 'Diputuskan refund',
  resolved_clawback: 'Diputuskan clawback',
  rejected: 'Ditolak'
};

const DISPUTE_STATUS_TONES: Record<string, 'danger' | 'ok' | 'muted' | 'soft'> = {
  open: 'danger',
  resolved_to_vendor: 'ok',
  resolved_refund: 'soft',
  resolved_clawback: 'soft',
  rejected: 'muted'
};

export default function DisputesPage() {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['disputes'],
    queryFn: getDisputes
  });

  return (
    <div>
      <PageHeader
        title="Sengketa"
        description="Klaim yang masih menjadi milik platform sampai diputuskan. Dana pada booking yang bersengketa dibekukan."
      />

      {isLoading ? (
        <div className="space-y-4">
          <BlockSkeleton rows={3} />
          <Card>
            <TableSkeleton rows={4} />
          </Card>
        </div>
      ) : isError ? (
        <Card>
          <ErrorState
            message={
              error instanceof Error
                ? error.message
                : 'Daftar sengketa tidak bisa dimuat. Periksa koneksi lalu coba lagi.'
            }
            onRetry={() => void refetch()}
            retrying={isFetching}
          />
        </Card>
      ) : data ? (
        <div className="space-y-4">
          <StatGrid columns={2}>
            <KpiCard
              label="Sengketa terbuka"
              value={String(data.open_count)}
              note={data.open_count > 0 ? 'Dana dibekukan sampai diputuskan' : 'Tidak ada klaim aktif'}
              icon={<ShieldAlert className="h-5 w-5" />}
              tone={data.open_count > 0 ? 'danger' : 'ok'}
            />
            <KpiCard
              label="Nilai sengketa"
              value={formatIDR(data.total_idr)}
              note="Porsi pelanggan dan vendor"
              icon={<Scale className="h-5 w-5" />}
              tone="soft"
            />
          </StatGrid>

          <Card className="overflow-hidden">
            <CardHeader
              icon={<Scale aria-hidden className="h-[17px] w-[17px]" />}
              title="Daftar sengketa"
              description="Diurutkan dari yang paling baru dibuka."
            />
            {data.items.length === 0 ? (
              <EmptyState
                title="Tidak ada sengketa"
                description="Belum ada klaim yang masuk. Dana yang sedang ditahan akan muncul di sini."
                action={
                  <Button variant="outline" href="/bookings">
                    Lihat booking
                  </Button>
                }
              />
            ) : (
              <Table
                label="Daftar sengketa beserta alasan, batas SLA, dan pembagian dana"
                maxHeight="max-h-[65vh]"
                className="min-w-[960px]"
              >
                <TableHead>
                  <TableRow>
                    <TableHeadCell>Booking</TableHeadCell>
                    <TableHeadCell>Alasan</TableHeadCell>
                    <TableHeadCell>Status</TableHeadCell>
                    <TableHeadCell align="right">Pelanggan</TableHeadCell>
                    <TableHeadCell align="right">Vendor</TableHeadCell>
                    <TableHeadCell align="right">SLA</TableHeadCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.items.map((dispute) => (
                    <TableRow key={dispute.id}>
                      <TableCell>
                        <TitleBlock
                          title={dispute.booking_code}
                          subtitle={`${dispute.vendor_name} · ${dispute.city}`}
                        />
                      </TableCell>
                      <TableCell>
                        <p className="max-w-[320px] text-[15px] text-textMain">{dispute.reason}</p>
                        <p className="text-[13px] text-textSecondary">
                          Dibuka {formatDateTimeID(dispute.opened_at)}
                        </p>
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={DISPUTE_STATUS_TONES[dispute.status] ?? 'muted'}>
                          {DISPUTE_STATUS_LABELS[dispute.status] ?? dispute.status}
                        </StatusBadge>
                      </TableCell>
                      <TableCell align="right">
                        <span className="tnum whitespace-nowrap text-textMain">
                          {formatIDR(dispute.customer_share_idr)}
                        </span>
                      </TableCell>
                      <TableCell align="right">
                        <span className="tnum whitespace-nowrap text-textMain">
                          {formatIDR(dispute.vendor_share_idr)}
                        </span>
                      </TableCell>
                      <TableCell align="right">
                        <span
                          className={`whitespace-nowrap text-[13px] ${
                            dispute.status === 'open'
                              ? 'font-semibold text-danger'
                              : 'text-textSecondary'
                          }`}
                        >
                          {dispute.status === 'open'
                            ? relativeFrom(MOCK_NOW, dispute.sla_due_at)
                            : 'Selesai'}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
