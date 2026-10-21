'use client';

import { useQuery } from '@tanstack/react-query';
import { CreditCard, Receipt, RotateCcw, Wallet } from 'lucide-react';
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
import { getPayments } from '@/lib/api';
import { formatDateTimeID, formatIDR } from '@/lib/format';

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: 'Menunggu',
  paid: 'Berhasil',
  failed: 'Gagal',
  expired: 'Kedaluwarsa'
};

const PAYMENT_KIND_LABELS: Record<string, string> = {
  dp: 'DP',
  settlement: 'Pelunasan',
  refund: 'Refund'
};

export default function PaymentsPage() {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['payments'],
    queryFn: getPayments
  });

  return (
    <div>
      <PageHeader
        title="Pembayaran"
        description="Semua transaksi masuk dari pelanggan: DP, pelunasan, dan refund. Nominal selalu rupiah bulat tanpa desimal."
      />

      {isLoading ? (
        <div className="space-y-4">
          <BlockSkeleton rows={3} />
          <Card>
            <TableSkeleton rows={6} />
          </Card>
        </div>
      ) : isError ? (
        <Card>
          <ErrorState
            message={
              error instanceof Error
                ? error.message
                : 'Daftar pembayaran tidak bisa dimuat. Periksa koneksi lalu coba lagi.'
            }
            onRetry={() => void refetch()}
            retrying={isFetching}
          />
        </Card>
      ) : data ? (
        <div className="space-y-4">
          <StatGrid columns={2}>
            <KpiCard
              label="Total diterima"
              value={formatIDR(data.total_idr)}
              note={`${data.items.length} transaksi tercatat`}
              icon={<Wallet className="h-5 w-5" />}
              tone="primary"
            />
            {data.by_kind.map((kind) => (
              <KpiCard
                key={kind.kind}
                label={kind.label}
                value={formatIDR(kind.amount_idr)}
                note={`${kind.count} transaksi`}
                icon={
                  kind.kind === 'refund' ? (
                    <RotateCcw className="h-5 w-5" />
                  ) : (
                    <CreditCard className="h-5 w-5" />
                  )
                }
                tone={kind.kind === 'refund' ? 'danger' : 'soft'}
              />
            ))}
          </StatGrid>

          <Card className="overflow-hidden">
            <CardHeader
              icon={<Receipt aria-hidden className="h-[17px] w-[17px]" />}
              title="Transaksi masuk"
              description="Diurutkan dari yang terbaru."
            />
            {data.items.length === 0 ? (
              <EmptyState
                title="Belum ada pembayaran"
                description="Transaksi muncul setelah pelanggan membayar DP atau pelunasan."
                action={
                  <Button variant="outline" href="/bookings">
                    Lihat booking
                  </Button>
                }
              />
            ) : (
              <Table
                label="Daftar pembayaran masuk beserta jenis, metode, dan nominal"
                maxHeight="max-h-[65vh]"
                className="min-w-[900px]"
              >
                <TableHead>
                  <TableRow>
                    <TableHeadCell>Booking</TableHeadCell>
                    <TableHeadCell>Jenis</TableHeadCell>
                    <TableHeadCell>Status</TableHeadCell>
                    <TableHeadCell>Metode & referensi</TableHeadCell>
                    <TableHeadCell align="right">Nominal</TableHeadCell>
                    <TableHeadCell align="right">Dibayar</TableHeadCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.items.map((payment) => (
                    <TableRow key={payment.id}>
                      <TableCell>
                        <TitleBlock
                          title={payment.booking_code}
                          subtitle={PAYMENT_KIND_LABELS[payment.kind] ?? payment.kind}
                        />
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone="soft">
                          {PAYMENT_KIND_LABELS[payment.kind] ?? payment.kind}
                        </StatusBadge>
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          tone={payment.status === 'paid' ? 'ok' : payment.status === 'failed' ? 'danger' : 'muted'}
                        >
                          {PAYMENT_STATUS_LABELS[payment.status] ?? payment.status}
                        </StatusBadge>
                      </TableCell>
                      <TableCell>
                        <p className="text-[15px] text-textMain">{payment.method}</p>
                        <p className="text-[13px] text-textSecondary">{payment.gateway_ref}</p>
                      </TableCell>
                      <TableCell align="right">
                        <span className="tnum whitespace-nowrap font-semibold text-textMain">
                          {formatIDR(payment.amount_idr)}
                        </span>
                      </TableCell>
                      <TableCell align="right">
                        <span className="whitespace-nowrap text-[13px] text-textSecondary">
                          {payment.paid_at ? formatDateTimeID(payment.paid_at) : 'Belum dibayar'}
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
