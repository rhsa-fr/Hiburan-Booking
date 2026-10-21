'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, SearchX, Wallet } from 'lucide-react';
import { useState } from 'react';
import { BookingDetail } from '@/components/bookings/booking-detail';
import {
  Alert,
  BlockSkeleton,
  Button,
  Card,
  ConfirmDialog,
  DisabledAction,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
  Toast
} from '@/components/ui';
import { getBooking, settleBooking } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import { formatDateID, formatIDR } from '@/lib/format';
import type { Booking, LifecycleStatus, SettleManualMethod } from '@/lib/types';
import { hasAnyRole, useRoles } from '@/lib/use-roles';

const SETTLE_ROLES = ['admin_finance', 'admin_super'];
/** The API only settles these lifecycle states; do not offer a button it rejects. */
const SETTLE_LIFECYCLES: readonly LifecycleStatus[] = [
  'confirmed',
  'in_progress',
  'completed'
];

interface Notice {
  tone: 'ok';
  title: string;
  description: string;
}

/**
 * Release timing comes from the booking itself. A `completed` booking whose
 * dispute window already closed is released on the worker's next tick
 * (seconds), so promising "after the window closes" would be a lie.
 */
function releaseTimingMessage(booking: Booking): string {
  const endsAt = booking.dispute_window_ends_at;
  if (!endsAt) {
    return 'Jendela sengketa booking ini belum ditetapkan — periksa booking sebelum menyimpan.';
  }
  if (new Date(endsAt).getTime() > Date.now()) {
    return `Dana vendor cair otomatis setelah jendela sengketa tutup (${formatDateID(endsAt)}).`;
  }
  return 'Jendela sengketa sudah tutup — dana vendor cair otomatis pada proses berikutnya (hitungan detik). Periksa booking sebelum menyimpan.';
}

/**
 * Manual settlement action. Visible only for `dp_paid`; roles that cannot
 * record money get the reason instead of a button that the API would reject.
 */
function BookingSettlement({
  booking,
  outstandingIdr,
  onNotify,
  onSettled
}: {
  booking: Booking;
  outstandingIdr: number;
  onNotify: (notice: Notice) => void;
  onSettled: () => void;
}) {
  const { roles, ready: rolesReady } = useRoles();
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [method, setMethod] = useState<SettleManualMethod>('transfer_manual');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');

  const settle = useMutation({
    mutationFn: () =>
      settleBooking(booking.id, {
        amount_idr: outstandingIdr,
        method,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined
      }),
    onSuccess: (result) => {
      setConfirmOpen(false);
      setOpen(false);
      settle.reset();
      onNotify({
        tone: 'ok',
        title: 'Pelunasan tercatat',
        description: result.already_settled
          ? 'Booking ini sudah lunas; tidak ada jurnal baru yang dibuat.'
          : `${formatIDR(result.outstanding_before_idr)} tercatat sebagai uang masuk. Status booking sekarang Lunas dan masuk audit.`
      });
      onSettled();
    }
  });

  if (booking.payment_status !== 'dp_paid') return null;
  if (!SETTLE_LIFECYCLES.includes(booking.lifecycle_status)) return null;
  if (!rolesReady) return <Skeleton className="h-12 w-40" />;
  if (!hasAnyRole(roles, SETTLE_ROLES)) {
    return (
      <DisabledAction
        label="Catat pelunasan"
        reason="Hanya admin finance dan admin super yang boleh mencatat uang masuk."
        icon={Wallet}
      />
    );
  }

  const busy = settle.isPending;
  const releaseNote = releaseTimingMessage(booking);
  const closeForm = () => {
    if (busy) return;
    setOpen(false);
    setConfirmOpen(false);
    settle.reset();
  };

  return (
    <>
      <Button
        onClick={() => {
          settle.reset();
          setOpen(true);
        }}
        icon={<Wallet aria-hidden className="h-4 w-4" />}
      >
        Catat pelunasan
      </Button>

      <Modal open={open} onClose={closeForm} labelledBy="settle-modal-title">
        <h2 id="settle-modal-title" className="pr-10 text-xl font-bold tracking-[-0.01em]">
          Catat pelunasan
        </h2>
        <p className="mt-2 text-base leading-relaxed text-textSecondary">
          Untuk pelanggan yang membayar DP lalu melunasi terlambat. Nominal diambil dari server,
          bukan diketik ulang.
        </p>

        <div className="mt-5 space-y-4">
          <Input
            id="settle-amount"
            label="Nominal pelunasan"
            value={formatIDR(outstandingIdr)}
            readOnly
            hint="Sisa tagihan dari server. Tidak bisa diubah di sini."
          />
          <Select
            id="settle-method"
            label="Metode"
            value={method}
            onChange={(event) => setMethod(event.target.value as SettleManualMethod)}
          >
            <option value="transfer_manual">Transfer bank</option>
            <option value="cash">Tunai</option>
          </Select>
          <Input
            id="settle-reference"
            label="Referensi"
            value={reference}
            maxLength={120}
            onChange={(event) => setReference(event.target.value)}
            hint="Opsional, maksimal 120 karakter."
            placeholder="BCA 21/10/2026"
          />
          <Textarea
            id="settle-note"
            label="Catatan"
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
            hint="Opsional, maksimal 500 karakter."
            placeholder="Transfer telat, bukti diterima ops"
          />
        </div>

        <Alert tone="warning" className="mt-4">
          Mencatat uang masuk dan mengubah status jadi Lunas. {releaseNote}
        </Alert>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={closeForm} disabled={busy}>
            Batal
          </Button>
          <Button onClick={() => setConfirmOpen(true)}>Lanjutkan</Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmOpen}
        onClose={closeForm}
        title="Catat pelunasan ini?"
        description={`${formatIDR(outstandingIdr)} via ${
          method === 'cash' ? 'Tunai' : 'Transfer bank'
        } untuk ${booking.code}.`}
        consequence={`Mencatat uang masuk dan mengubah status jadi Lunas. ${releaseNote} Tindakan ini masuk audit dan tidak bisa dibatalkan dari panel.`}
        confirmLabel="Ya, catat pelunasan"
        tone="primary"
        pending={busy}
        error={settle.isError ? settle.error.message : null}
        onConfirm={() => settle.mutate()}
        labelledBy="settle-confirm-title"
      />
    </>
  );
}

export function BookingDetailPage({ bookingId }: { bookingId: string }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['booking', bookingId],
    queryFn: () => getBooking(bookingId)
  });

  const notFound = error instanceof ApiError && error.status === 404;

  function handleSettled(): void {
    void refetch();
    void queryClient.invalidateQueries({ queryKey: ['bookings'] });
  }

  return (
    <div>
      <PageHeader
        title={data ? data.booking.code : 'Detail booking'}
        description={
          data
            ? `${data.booking.vendor_name} · ${data.booking.customer_name} · acara ${formatDateID(
                data.booking.event_start_at
              )}`
            : 'Rincian uang, status tiga sumbu, dan timeline booking.'
        }
        actions={
          <>
            {data ? (
              <BookingSettlement
                booking={data.booking}
                outstandingIdr={data.outstanding_idr}
                onNotify={setNotice}
                onSettled={handleSettled}
              />
            ) : null}
            <Button
              variant="outline"
              href="/bookings"
              icon={<ArrowLeft aria-hidden className="h-4 w-4" />}
            >
              Kembali ke daftar
            </Button>
          </>
        }
      />

      <Card className="p-5 lg:p-6">
        {isLoading ? (
          <BlockSkeleton rows={7} className="p-0" />
        ) : isError ? (
          notFound ? (
            <EmptyState
              icon={<SearchX aria-hidden className="h-6 w-6" />}
              title="Booking tidak ditemukan"
              description="Kode booking ini tidak ada di data mock. Tautan mungkin salah ketik atau sudah tidak berlaku."
              action={
                <Button variant="outline" href="/bookings">
                  Kembali ke daftar booking
                </Button>
              }
            />
          ) : (
            <ErrorState
              message={
                error instanceof Error
                  ? error.message
                  : 'Detail booking tidak bisa dimuat. Periksa koneksi lalu coba lagi.'
              }
              onRetry={() => void refetch()}
              retrying={isFetching}
            />
          )
        ) : data ? (
          <BookingDetail
            booking={data.booking}
            payments={data.payments}
            dispute={data.dispute}
            variant="page"
          />
        ) : null}
      </Card>

      {notice ? (
        <Toast
          tone={notice.tone}
          title={notice.title}
          description={notice.description}
          onDismiss={() => setNotice(null)}
        />
      ) : null}
    </div>
  );
}
