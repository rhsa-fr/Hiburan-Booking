'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ReceiptText, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Modal,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeadCell,
  TableRow,
  TableSkeleton,
  Tabs,
  Textarea,
  Toast
} from '@/components/ui';
import type { TabItem } from '@/components/ui';
import { formatDateTimeID, formatIDR } from '@/lib/format';
import {
  approveRefund,
  getRefunds,
  rejectRefund,
  type RefundItem,
  type RefundQueueStatus
} from '@/lib/refunds';
import { readSession } from '@/lib/session';

const STATUS_TABS: TabItem[] = [
  { id: 'requested', label: 'Menunggu approval' },
  { id: 'approved', label: 'Disetujui' },
  { id: 'succeeded', label: 'Selesai' },
  { id: 'rejected', label: 'Ditolak' }
];

function canDecide(): boolean {
  const role = (readSession()?.role ?? '').toLowerCase();
  return role.includes('finance') || role.includes('super');
}

function statusLabel(status: RefundQueueStatus): string {
  switch (status) {
    case 'requested':
      return 'Menunggu admin lain';
    case 'approved':
      return 'Disetujui';
    case 'processing':
      return 'Diproses provider';
    case 'succeeded':
      return 'Selesai';
    case 'failed':
      return 'Gagal';
    case 'rejected':
      return 'Ditolak';
    default:
      return status;
  }
}

export function RefundsView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const statusParam = searchParams.get('status');
  const currentStatus: RefundQueueStatus =
    statusParam === 'approved' || statusParam === 'succeeded' || statusParam === 'rejected'
      ? statusParam
      : 'requested';

  const [approveTarget, setApproveTarget] = useState<RefundItem | null>(null);
  const [rejectTarget, setRejectTarget] = useState<RefundItem | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [toastNotice, setToastNotice] = useState<string | null>(null);
  const decider = canDecide();

  useEffect(() => {
    if (!toastNotice) return;
    const timer = setTimeout(() => setToastNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [toastNotice]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['refunds', currentStatus],
    queryFn: () => getRefunds({ status: currentStatus, limit: 50 })
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => approveRefund(id),
    onSuccess: () => {
      setApproveTarget(null);
      setToastNotice('Refund disetujui dan diproses.');
      void queryClient.invalidateQueries({ queryKey: ['refunds'] });
    },
    onError: (err) => {
      setToastNotice(err instanceof Error ? err.message : 'Gagal menyetujui refund.');
    }
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => rejectRefund(id, note),
    onSuccess: () => {
      setRejectTarget(null);
      setRejectNote('');
      setToastNotice('Refund ditolak.');
      void queryClient.invalidateQueries({ queryKey: ['refunds'] });
    },
    onError: (err) => {
      setToastNotice(err instanceof Error ? err.message : 'Gagal menolak refund.');
    }
  });

  function handleTabChange(tabId: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (tabId === 'requested') params.delete('status');
    else params.set('status', tabId);
    const query = params.toString();
    setApproveTarget(null);
    router.replace(`${pathname}${query ? `?${query}` : ''}`);
  }

  const items = data ?? [];

  return (
    <div className="space-y-6">
      <p className="rounded-card border border-border bg-surface px-4 py-3 text-sm text-textSecondary">
        Refund di atas ambang wajib disetujui <strong>admin lain</strong>: admin yang
        mengajukan tidak bisa menyetujui permintaannya sendiri.
      </p>

      <Tabs
        items={STATUS_TABS}
        value={currentStatus}
        onChange={handleTabChange}
        ariaLabel="Pilih status refund"
      />

      {isLoading ? (
        <Card>
          <TableSkeleton rows={5} />
        </Card>
      ) : isError ? (
        <Card>
          <ErrorState
            title="Gagal memuat antrean refund"
            message={
              error instanceof Error ? error.message : 'Terjadi kesalahan pada jaringan atau server.'
            }
            onRetry={() => void refetch()}
          />
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ReceiptText aria-hidden className="h-6 w-6 text-textMuted" />}
            title="Tidak ada refund pada status ini"
            description="Antrean terisi saat pelanggan atau admin mengajukan refund."
          />
        </Card>
      ) : (
        <Card>
          <Table label="Daftar refund">
            <TableHead>
              <TableRow>
                <TableHeadCell>Booking</TableHeadCell>
                <TableHeadCell>Nominal</TableHeadCell>
                <TableHeadCell>Alasan</TableHeadCell>
                <TableHeadCell>Diajukan</TableHeadCell>
                <TableHeadCell align="right">
                  {currentStatus === 'requested' ? 'Aksi' : 'Status'}
                </TableHeadCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <span className="block font-semibold text-textMain">{item.booking_code}</span>
                    <span className="block text-xs text-textMuted">
                      {item.customer_name ?? 'Pelanggan'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="tnum font-semibold text-textMain">
                      {formatIDR(item.amount_idr)}
                    </span>
                    {item.fee_idr > 0 ? (
                      <span className="block text-xs text-textMuted">
                        Biaya {formatIDR(item.fee_idr)}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <span className="block text-sm text-textMain">{item.reason_code}</span>
                    {item.reason_note ? (
                      <span className="block max-w-[320px] text-xs text-textSecondary">
                        {item.reason_note}
                      </span>
                    ) : null}
                    {item.review_note ? (
                      <span className="mt-1 block text-xs text-textMuted">
                        Catatan review: {item.review_note}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-textMain">
                      {formatDateTimeID(item.created_at)}
                    </span>
                    {item.approved_at ? (
                      <span className="mt-1 block text-xs text-textMuted">
                        Disetujui {formatDateTimeID(item.approved_at)}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell align="right">
                    {currentStatus === 'requested' ? (
                      decider ? (
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button
                            size="sm"
                            icon={<CheckCircle2 aria-hidden className="h-4 w-4" />}
                            onClick={() => setApproveTarget(item)}
                          >
                            Setujui
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<X aria-hidden className="h-4 w-4" />}
                            onClick={() => {
                              setRejectNote('');
                              setRejectTarget(item);
                            }}
                          >
                            Tolak
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-textMuted">Butuh admin finance</span>
                      )
                    ) : (
                      <span className="text-sm text-textSecondary">{statusLabel(item.status)}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <ConfirmDialog
        open={approveTarget !== null}
        onClose={() => setApproveTarget(null)}
        title="Setujui refund?"
        description={
          approveTarget
            ? `${approveTarget.booking_code} akan direfund ${formatIDR(approveTarget.amount_idr)}. Tindakan ini tercatat di audit.`
            : undefined
        }
        confirmLabel="Setujui refund"
        tone="primary"
        pending={approveMutation.isPending}
        onConfirm={() => {
          if (approveTarget) approveMutation.mutate(approveTarget.id);
        }}
      />

      <Modal
        open={rejectTarget !== null}
        onClose={() => setRejectTarget(null)}
        labelledBy="reject-refund-title"
        size="sm"
      >
        <h2
          id="reject-refund-title"
          className="pr-10 text-xl font-bold tracking-[-0.01em] text-textMain"
        >
          Tolak refund
        </h2>
        <Textarea
          id="refund-reject-note"
          label="Alasan penolakan"
          className="mt-4"
          value={rejectNote}
          onChange={(event) => setRejectNote(event.target.value)}
          placeholder="Contoh: bukti tidak sesuai kebijakan pembatalan."
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRejectTarget(null)}>
            Batal
          </Button>
          <Button
            variant="danger"
            disabled={rejectMutation.isPending || rejectNote.trim().length === 0}
            onClick={() => {
              if (rejectTarget) {
                rejectMutation.mutate({ id: rejectTarget.id, note: rejectNote.trim() });
              }
            }}
          >
            {rejectMutation.isPending ? 'Menolak...' : 'Tolak refund'}
          </Button>
        </div>
      </Modal>

      {toastNotice ? (
        <Toast tone="info" title={toastNotice} onDismiss={() => setToastNotice(null)} />
      ) : null}
    </div>
  );
}
