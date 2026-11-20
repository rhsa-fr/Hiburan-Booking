'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, Receipt, RotateCcw, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  BlockSkeleton,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Input,
  KpiCard,
  Modal,
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
  Textarea,
  TitleBlock,
  Toast
} from '@/components/ui';
import { getPayments } from '@/lib/api';
import { formatDateTimeID, formatIDR } from '@/lib/format';
import { requestManualRefund } from '@/lib/refunds';
import { readSession } from '@/lib/session';
import type { Payment } from '@/lib/types';

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

function canRefund(): boolean {
  const role = (readSession()?.role ?? '').toLowerCase();
  return role.includes('finance') || role.includes('super');
}

export default function PaymentsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['payments'],
    queryFn: getPayments
  });

  const [manualTarget, setManualTarget] = useState<Payment | null>(null);
  const [manualAmount, setManualAmount] = useState('');
  const [manualReason, setManualReason] = useState('');
  const [manualRef, setManualRef] = useState('');
  const [manualEvidence, setManualEvidence] = useState('');
  const [toastNotice, setToastNotice] = useState<string | null>(null);
  const refundable = canRefund();

  useEffect(() => {
    if (!toastNotice) return;
    const timer = setTimeout(() => setToastNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [toastNotice]);

  const manualMutation = useMutation({
    mutationFn: (payment: Payment) =>
      requestManualRefund(payment.id, {
        amount_idr: Number(manualAmount.replace(/[^\d]/g, '')),
        reason: manualReason.trim(),
        transfer_ref: manualRef.trim(),
        evidence_url: manualEvidence.trim() || undefined
      }),
    onSuccess: (refund) => {
      setManualTarget(null);
      setToastNotice(
        refund.status === 'requested'
          ? 'Refund manual dicatat. Menunggu persetujuan admin lain.'
          : 'Refund manual selesai dicatat dan jurnal sudah diposting.'
      );
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
      void queryClient.invalidateQueries({ queryKey: ['refunds'] });
    },
    onError: (err) => {
      setToastNotice(err instanceof Error ? err.message : 'Gagal mencatat refund manual.');
    }
  });

  function openManual(payment: Payment) {
    setManualTarget(payment);
    setManualAmount(String(payment.amount_idr));
    setManualReason('');
    setManualRef('');
    setManualEvidence('');
  }

  const manualAmountIdr = Number(manualAmount.replace(/[^\d]/g, ''));
  const manualValid =
    manualAmountIdr > 0 &&
    manualReason.trim().length >= 5 &&
    manualRef.trim().length >= 3;

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
                    <TableHeadCell align="right">Aksi</TableHeadCell>
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
                      <TableCell align="right">
                        {payment.status === 'paid' && payment.kind !== 'refund' && refundable ? (
                          <Button size="sm" variant="outline" onClick={() => openManual(payment)}>
                            Refund manual
                          </Button>
                        ) : (
                          <span className="text-xs text-textMuted">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </div>
      ) : null}

      <Modal
        open={manualTarget !== null}
        onClose={() => setManualTarget(null)}
        labelledBy="manual-refund-title"
        size="sm"
      >
        <h2
          id="manual-refund-title"
          className="pr-10 text-xl font-bold tracking-[-0.01em] text-textMain"
        >
          Catat refund manual
        </h2>
        <p className="mt-1 text-sm text-textSecondary">
          {manualTarget
            ? `${manualTarget.booking_code} · ${manualTarget.method} · ${formatIDR(manualTarget.amount_idr)}`
            : ''}
        </p>
        <p className="mt-2 text-[13px] leading-snug text-textMuted">
          Pakai untuk pembayaran VA/Mandiri yang tidak bisa di-refund gateway. Nominal
          di atas ambang akan menunggu persetujuan admin lain.
        </p>
        <div className="mt-4 space-y-3">
          <Input
            id="manual-refund-amount"
            label="Nominal refund (Rp)"
            inputMode="numeric"
            value={manualAmount}
            onChange={(event) => setManualAmount(event.target.value)}
          />
          <Textarea
            id="manual-refund-reason"
            label="Alasan"
            value={manualReason}
            onChange={(event) => setManualReason(event.target.value)}
            placeholder="Contoh: pembatalan acara, transfer balik via BCA."
          />
          <Input
            id="manual-refund-ref"
            label="Referensi transfer"
            value={manualRef}
            onChange={(event) => setManualRef(event.target.value)}
            placeholder="Contoh: TRF-20261117-001"
          />
          <Input
            id="manual-refund-evidence"
            label="URL bukti transfer (opsional)"
            value={manualEvidence}
            onChange={(event) => setManualEvidence(event.target.value)}
            placeholder="https://…"
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setManualTarget(null)}>
            Batal
          </Button>
          <Button
            disabled={!manualValid || manualMutation.isPending}
            onClick={() => {
              if (manualTarget) manualMutation.mutate(manualTarget);
            }}
          >
            {manualMutation.isPending ? 'Menyimpan...' : 'Simpan refund'}
          </Button>
        </div>
      </Modal>

      {toastNotice ? (
        <Toast tone="info" title={toastNotice} onDismiss={() => setToastNotice(null)} />
      ) : null}
    </div>
  );
}
