'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, CheckCircle2, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  BlockSkeleton,
  Button,
  Card,
  CardHeader,
  Checkbox,
  EmptyState,
  ErrorState,
  Modal,
  PageHeader,
  Select,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeadCell,
  TableRow,
  TableSkeleton,
  Textarea
} from '@/components/ui';
import {
  approvePayout,
  cancelPayout,
  createPayout,
  getPayout,
  getPayoutEligible,
  getPayouts,
  getVendors,
  rejectPayout
} from '@/lib/api';
import { formatDateID, formatIDR } from '@/lib/format';
import { readSession } from '@/lib/session';
import { hasAnyRole, PAYOUT_WRITE_ROLES, useRoles } from '@/lib/use-roles';
import type { Payout, PayoutStatus } from '@/lib/types';

const MIN_REASON_LENGTH = 5;

function statusBadge(status: PayoutStatus) {
  switch (status) {
    case 'paid':
      return <StatusBadge tone="ok">Cair</StatusBadge>;
    case 'failed':
      return <StatusBadge tone="danger">Gagal</StatusBadge>;
    case 'rejected':
      return <StatusBadge tone="danger">Ditolak</StatusBadge>;
    case 'cancelled':
      return <StatusBadge tone="soft">Dibatalkan</StatusBadge>;
    case 'processing':
      return <StatusBadge tone="soft">Diproses</StatusBadge>;
    case 'approved':
      return <StatusBadge tone="soft">Disetujui</StatusBadge>;
    default:
      return <StatusBadge tone="soft">Menunggu</StatusBadge>;
  }
}

export default function PayoutsPage() {
  const queryClient = useQueryClient();
  const { roles } = useRoles();
  const canWrite = hasAnyRole(roles, PAYOUT_WRITE_ROLES);

  const [userId, setUserId] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [vendorId, setVendorId] = useState('');
  const [selectedBookings, setSelectedBookings] = useState<string[]>([]);
  const [approveTarget, setApproveTarget] = useState<Payout | null>(null);
  const [approveNote, setApproveNote] = useState('');
  const [rejectTarget, setRejectTarget] = useState<Payout | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [cancelTarget, setCancelTarget] = useState<Payout | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    setUserId(readSession()?.user_id);
  }, []);

  const payoutsQuery = useQuery({
    queryKey: ['payouts'],
    queryFn: () => getPayouts({ page_size: 50 })
  });
  const vendorsQuery = useQuery({
    queryKey: ['vendors', 'payout'],
    queryFn: () => getVendors({ q: '', city: '', verification: '' })
  });
  const eligibleQuery = useQuery({
    queryKey: ['payout-eligible', vendorId],
    queryFn: () => getPayoutEligible(vendorId),
    enabled: vendorId.length > 0
  });
  const detailQuery = useQuery({
    queryKey: ['payout-detail', detailId],
    queryFn: () => getPayout(detailId as string),
    enabled: detailId !== null
  });

  useEffect(() => {
    if (!eligibleQuery.data) return;
    setSelectedBookings(eligibleQuery.data.bookings.map((booking) => booking.booking_id));
  }, [eligibleQuery.data]);

  const selectedTotal = useMemo(() => {
    const eligible = eligibleQuery.data;
    if (!eligible) return 0;
    return eligible.bookings
      .filter((booking) => selectedBookings.includes(booking.booking_id))
      .reduce((total, booking) => total + booking.amount_idr, 0);
  }, [eligibleQuery.data, selectedBookings]);

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['payouts'] });
    void queryClient.invalidateQueries({ queryKey: ['payout-eligible'] });
    void queryClient.invalidateQueries({ queryKey: ['payout-detail'] });
    void queryClient.invalidateQueries({ queryKey: ['ledger'] });
  }

  const createMutation = useMutation({
    mutationFn: () =>
      createPayout(
        selectedBookings.length > 0
          ? { vendor_id: vendorId, booking_ids: selectedBookings }
          : { vendor_id: vendorId }
      ),
    onSuccess: (data) => {
      setNotice(`Payout ${data.code} dibuat dan menunggu persetujuan operator lain.`);
      setCreateOpen(false);
      setVendorId('');
      setSelectedBookings([]);
      invalidate();
    }
  });

  const approveMutation = useMutation({
    mutationFn: () => approvePayout(approveTarget!.id, approveNote.trim() || undefined),
    onSuccess: (data) => {
      setNotice(`Payout ${data.code} disetujui dan dikirim ke provider.`);
      setApproveTarget(null);
      setApproveNote('');
      invalidate();
    }
  });

  const rejectMutation = useMutation({
    mutationFn: () => rejectPayout(rejectTarget!.id, rejectReason.trim()),
    onSuccess: (data) => {
      setNotice(`Payout ${data.code} ditolak. Booking kembali bisa dicairkan.`);
      setRejectTarget(null);
      setRejectReason('');
      invalidate();
    }
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelPayout(cancelTarget!.id),
    onSuccess: (data) => {
      setNotice(`Payout ${data.code} dibatalkan.`);
      setCancelTarget(null);
      invalidate();
    }
  });

  function toggleBooking(bookingId: string) {
    setSelectedBookings((previous) =>
      previous.includes(bookingId)
        ? previous.filter((item) => item !== bookingId)
        : [...previous, bookingId]
    );
  }

  function closeCreate() {
    if (createMutation.isPending) return;
    setCreateOpen(false);
    setVendorId('');
    setSelectedBookings([]);
    createMutation.reset();
  }

  const eligible = eligibleQuery.data;
  const canSubmitCreate =
    canWrite &&
    vendorId.length > 0 &&
    selectedBookings.length > 0 &&
    (eligible?.eligible ?? false) &&
    !createMutation.isPending;

  return (
    <div>
      <PageHeader
        title="Payout vendor"
        description="Pencairan dana released ke rekening vendor. Pembuat dan penyetuju wajib dua operator berbeda; jurnal dan status provider terlihat di sini."
        actions={
          <Button
            onClick={() => {
              setNotice(null);
              setCreateOpen(true);
            }}
            disabled={!canWrite}
            icon={<Banknote aria-hidden className="h-4 w-4" />}
          >
            Buat payout
          </Button>
        }
      />

      {notice ? <Alert tone="ok">{notice}</Alert> : null}
      {!canWrite ? (
        <Alert tone="info">
          Hanya admin finance dan admin super yang bisa membuat atau menyetujui payout. Anda tetap
          bisa melihat riwayat.
        </Alert>
      ) : null}

      <Card className="mt-4 overflow-hidden">
        <CardHeader
          title="Riwayat payout"
          description="Satu payout mencakup satu vendor. Provider default adalah stub lokal sampai PAYOUT_PROVIDER=iris diaktifkan."
        />

        {payoutsQuery.isLoading ? (
          <TableSkeleton rows={4} />
        ) : payoutsQuery.isError ? (
          <ErrorState
            message={
              payoutsQuery.error instanceof Error
                ? payoutsQuery.error.message
                : 'Riwayat payout tidak bisa dimuat.'
            }
            onRetry={() => void payoutsQuery.refetch()}
            retrying={payoutsQuery.isFetching}
          />
        ) : (payoutsQuery.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            icon={<Banknote aria-hidden className="h-6 w-6" />}
            title="Belum ada payout"
            description="Payout bisa dibuat setelah booking berstatus released dan rekening vendor terverifikasi."
          />
        ) : (
          <Table
            label="Riwayat payout vendor"
            maxHeight="max-h-[60vh]"
            className="min-w-[980px]"
          >
            <TableHead>
              <TableRow>
                <TableHeadCell>Kode</TableHeadCell>
                <TableHeadCell>Vendor</TableHeadCell>
                <TableHeadCell>Rekening tujuan</TableHeadCell>
                <TableHeadCell align="right">Nominal</TableHeadCell>
                <TableHeadCell>Status</TableHeadCell>
                <TableHeadCell>Dibuat</TableHeadCell>
                <TableHeadCell align="right">Aksi</TableHeadCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {payoutsQuery.data!.items.map((payout) => {
                const isMaker = userId !== undefined && payout.requested_by === userId;
                return (
                  <TableRow key={payout.id}>
                    <TableCell>
                      <p className="tnum text-sm font-semibold text-textMain">{payout.code}</p>
                      <p className="text-xs text-textSecondary">
                        {payout.requested_by_name ?? 'Operator'}
                      </p>
                    </TableCell>
                    <TableCell>{payout.vendor_name ?? payout.vendor_id}</TableCell>
                    <TableCell>
                      <p className="text-sm text-textMain">
                        {payout.bank.bank_name} · {payout.bank.account_number_masked}
                      </p>
                      <p className="text-xs text-textSecondary">
                        {payout.bank.account_holder_name}
                      </p>
                    </TableCell>
                    <TableCell align="right">
                      <span className="tnum font-semibold text-textMain">
                        {formatIDR(payout.amount_idr)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        {statusBadge(payout.status)}
                        {payout.failure_reason ? (
                          <span className="max-w-[220px] text-xs text-danger">
                            {payout.failure_reason}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>{formatDateID(payout.created_at)}</TableCell>
                    <TableCell align="right">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDetailId(payout.id)}
                        >
                          Lihat
                        </Button>
                        {canWrite && payout.status === 'requested' ? (
                          <>
                            <Button
                              size="sm"
                              onClick={() => {
                                setApproveNote('');
                                setApproveTarget(payout);
                              }}
                              disabled={isMaker}
                              title={
                                isMaker
                                  ? 'Pembuat payout tidak boleh menyetujui payout yang sama.'
                                  : undefined
                              }
                            >
                              Setujui
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setRejectReason('');
                                setRejectTarget(payout);
                              }}
                            >
                              Tolak
                            </Button>
                            {isMaker ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setCancelTarget(payout)}
                              >
                                Batalkan
                              </Button>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* ------------------------------------------------------------ create */}
      <Modal open={createOpen} onClose={closeCreate} labelledBy="payout-create-title" size="lg">
        <div className="pr-6">
          <h2 id="payout-create-title" className="text-xl font-semibold tracking-[-0.01em]">
            Buat payout
          </h2>
          <p className="mt-1 text-base text-textSecondary">
            Nominal dihitung server dari booking released yang belum dicairkan, lalu dicek terhadap
            saldo <span className="font-medium text-textMain">vendor_payable</span> di ledger.
          </p>

          <div className="mt-4 space-y-3">
            <Select
              id="payout-vendor"
              label="Vendor"
              value={vendorId}
              onChange={(event) => {
                setVendorId(event.target.value);
                setSelectedBookings([]);
              }}
              hint="Hanya vendor dengan rekening terverifikasi yang bisa dicairkan."
            >
              <option value="">Pilih vendor</option>
              {(vendorsQuery.data?.items ?? []).map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name} · {vendor.city}
                </option>
              ))}
            </Select>

            {eligibleQuery.isLoading ? (
              <BlockSkeleton rows={4} />
            ) : eligibleQuery.isError ? (
              <ErrorState
                message={
                  eligibleQuery.error instanceof Error
                    ? eligibleQuery.error.message
                    : 'Data kelayakan payout gagal dimuat.'
                }
                onRetry={() => void eligibleQuery.refetch()}
                retrying={eligibleQuery.isFetching}
              />
            ) : eligible ? (
              <div className="space-y-3">
                <div className="grid gap-3 rounded-card border border-border bg-subtle p-4 sm:grid-cols-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.1em] text-textSecondary">
                      Nominal tersedia
                    </p>
                    <p className="tnum mt-1 text-lg font-semibold text-textMain">
                      {formatIDR(eligible.amount_idr)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.1em] text-textSecondary">
                      Saldo ledger 2120
                    </p>
                    <p className="tnum mt-1 text-lg font-semibold text-textMain">
                      {formatIDR(eligible.ledger_payable_idr)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.1em] text-textSecondary">
                      Minimum payout
                    </p>
                    <p className="tnum mt-1 text-lg font-semibold text-textMain">
                      {formatIDR(eligible.minimum_idr)}
                    </p>
                  </div>
                </div>

                {eligible.bank_account ? (
                  <p className="rounded-field bg-subtle px-4 py-3 text-sm text-textSecondary">
                    Tujuan: <span className="font-medium text-textMain">
                      {eligible.bank_account.bank_name} ·{' '}
                      {eligible.bank_account.account_number_masked}
                    </span>{' '}
                    a.n. {eligible.bank_account.account_holder_name}
                  </p>
                ) : (
                  <Alert tone="danger">Vendor belum punya rekening terverifikasi.</Alert>
                )}

                {eligible.reason ? <Alert tone="danger">{eligible.reason}</Alert> : null}

                <Table label="Booking yang dicakup payout" maxHeight="max-h-[36vh]">
                  <TableHead>
                    <TableRow>
                      <TableHeadCell className="w-12">
                        <span className="sr-only">Pilih</span>
                      </TableHeadCell>
                      <TableHeadCell>Booking</TableHeadCell>
                      <TableHeadCell>Acara</TableHeadCell>
                      <TableHeadCell align="right">Hak vendor</TableHeadCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {eligible.bookings.map((booking) => {
                      const checked = selectedBookings.includes(booking.booking_id);
                      return (
                        <TableRow key={booking.booking_id} selected={checked}>
                          <TableCell>
                            <Checkbox
                              id={`payout-booking-${booking.booking_id}`}
                              checked={checked}
                              onChange={() => toggleBooking(booking.booking_id)}
                              label={`Pilih booking ${booking.booking_code}`}
                              hideLabel
                            />
                          </TableCell>
                          <TableCell>
                            <span className="tnum text-sm font-semibold text-textMain">
                              {booking.booking_code}
                            </span>
                          </TableCell>
                          <TableCell>{booking.event_title ?? '—'}</TableCell>
                          <TableCell align="right">
                            <span className="tnum">{formatIDR(booking.amount_idr)}</span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>

                <p className="text-right text-sm text-textSecondary">
                  Total dipilih{' '}
                  <span className="tnum text-base font-semibold text-textMain">
                    {formatIDR(selectedTotal)}
                  </span>
                </p>

                <Alert tone="info">
                  Setelah dibuat, payout berstatus menunggu. Operator lain harus menyetujui sebelum
                  dana dikirim ke provider.
                </Alert>
              </div>
            ) : null}

            {createMutation.error ? (
              <Alert tone="danger">{createMutation.error.message}</Alert>
            ) : null}
          </div>

          <div className="mt-5 flex flex-col-reverse gap-3 border-t border-border pt-4 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={closeCreate} disabled={createMutation.isPending}>
              Batal
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!canSubmitCreate}
            >
              {createMutation.isPending ? 'Menyimpan…' : 'Ajukan payout'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ----------------------------------------------------------- approve */}
      <Modal
        open={approveTarget !== null}
        onClose={() => (approveMutation.isPending ? undefined : setApproveTarget(null))}
        labelledBy="payout-approve-title"
      >
        {approveTarget ? (
          <div className="pr-6">
            <h2 id="payout-approve-title" className="text-xl font-semibold">
              Setujui payout {approveTarget.code}
            </h2>
            <p className="mt-1 text-base text-textSecondary">
              Anda bertindak sebagai checker. Jurnal <span className="font-medium">payout_requested</span>{' '}
              diposting sebelum provider dipanggil; bila provider gagal, jurnal dibalik otomatis.
            </p>

            <div className="mt-4 rounded-card border border-border bg-subtle p-4">
              <p className="text-sm text-textSecondary">Nominal</p>
              <p className="tnum text-xl font-semibold text-textMain">
                {formatIDR(approveTarget.amount_idr)}
              </p>
              <p className="mt-1 text-sm text-textSecondary">
                {approveTarget.bank.bank_name} · {approveTarget.bank.account_number_masked} a.n.{' '}
                {approveTarget.bank.account_holder_name}
              </p>
            </div>

            {userId !== undefined && approveTarget.requested_by === userId ? (
              <Alert tone="danger">
                Anda pembuat payout ini. Maker dan checker harus dua orang berbeda.
              </Alert>
            ) : null}

            <div className="mt-4">
              <Textarea
                id="payout-approve-note"
                label="Catatan (opsional)"
                value={approveNote}
                onChange={(event) => setApproveNote(event.target.value)}
                placeholder="Contoh: rekening sudah dicek dengan vendor."
              />
            </div>

            {approveMutation.error ? (
              <Alert tone="danger">{approveMutation.error.message}</Alert>
            ) : null}

            <div className="mt-5 flex flex-col-reverse gap-3 border-t border-border pt-4 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                onClick={() => setApproveTarget(null)}
                disabled={approveMutation.isPending}
              >
                Batal
              </Button>
              <Button
                onClick={() => approveMutation.mutate()}
                disabled={
                  approveMutation.isPending ||
                  (userId !== undefined && approveTarget.requested_by === userId)
                }
                icon={<ShieldCheck aria-hidden className="h-4 w-4" />}
              >
                {approveMutation.isPending ? 'Mengirim…' : 'Setujui & kirim'}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* ------------------------------------------------------------ reject */}
      <Modal
        open={rejectTarget !== null}
        onClose={() => (rejectMutation.isPending ? undefined : setRejectTarget(null))}
        labelledBy="payout-reject-title"
      >
        {rejectTarget ? (
          <div className="pr-6">
            <h2 id="payout-reject-title" className="text-xl font-semibold">
              Tolak payout {rejectTarget.code}
            </h2>
            <p className="mt-1 text-base text-textSecondary">
              Booking yang tercakup akan kembali bisa dicairkan. Tidak ada jurnal yang dibuat karena
              payout belum disetujui.
            </p>

            <div className="mt-4">
              <Textarea
                id="payout-reject-reason"
                label="Alasan penolakan"
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                placeholder="Contoh: nama rekening berbeda dengan nama legal vendor."
                hint={`Minimal ${MIN_REASON_LENGTH} karakter. Tersimpan di audit log.`}
                error={
                  rejectReason.length > 0 && rejectReason.trim().length < MIN_REASON_LENGTH
                    ? `Alasan masih ${rejectReason.trim().length} karakter.`
                    : null
                }
              />
            </div>

            {rejectMutation.error ? (
              <Alert tone="danger">{rejectMutation.error.message}</Alert>
            ) : null}

            <div className="mt-5 flex flex-col-reverse gap-3 border-t border-border pt-4 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                onClick={() => setRejectTarget(null)}
                disabled={rejectMutation.isPending}
              >
                Batal
              </Button>
              <Button
                onClick={() => rejectMutation.mutate()}
                disabled={
                  rejectMutation.isPending ||
                  rejectReason.trim().length < MIN_REASON_LENGTH
                }
              >
                {rejectMutation.isPending ? 'Menyimpan…' : 'Tolak payout'}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* ------------------------------------------------------------ cancel */}
      <Modal
        open={cancelTarget !== null}
        onClose={() => (cancelMutation.isPending ? undefined : setCancelTarget(null))}
        labelledBy="payout-cancel-title"
      >
        {cancelTarget ? (
          <div className="pr-6">
            <h2 id="payout-cancel-title" className="text-xl font-semibold">
              Batalkan payout {cancelTarget.code}?
            </h2>
            <p className="mt-1 text-base text-textSecondary">
              Payout yang dibatalkan tidak mengubah ledger. Booking yang tercakup bisa dimasukkan ke
              payout baru.
            </p>
            {cancelMutation.error ? (
              <Alert tone="danger">{cancelMutation.error.message}</Alert>
            ) : null}
            <div className="mt-5 flex flex-col-reverse gap-3 border-t border-border pt-4 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                onClick={() => setCancelTarget(null)}
                disabled={cancelMutation.isPending}
              >
                Kembali
              </Button>
              <Button onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending}>
                {cancelMutation.isPending ? 'Membatalkan…' : 'Ya, batalkan'}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* ------------------------------------------------------------ detail */}
      <Modal
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        labelledBy="payout-detail-title"
        size="lg"
      >
        <div className="pr-6">
          <h2 id="payout-detail-title" className="text-xl font-semibold">
            Detail payout
          </h2>
          {detailQuery.isLoading ? (
            <BlockSkeleton rows={5} />
          ) : detailQuery.isError ? (
            <ErrorState
              message={
                detailQuery.error instanceof Error
                  ? detailQuery.error.message
                  : 'Detail payout gagal dimuat.'
              }
              onRetry={() => void detailQuery.refetch()}
              retrying={detailQuery.isFetching}
            />
          ) : detailQuery.data ? (
            <div className="mt-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="tnum text-lg font-semibold text-textMain">
                    {detailQuery.data.code}
                  </p>
                  <p className="text-sm text-textSecondary">
                    {detailQuery.data.vendor_name ?? detailQuery.data.vendor_id}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {statusBadge(detailQuery.data.status)}
                  <span className="tnum font-semibold text-textMain">
                    {formatIDR(detailQuery.data.amount_idr)}
                  </span>
                </div>
              </div>

              <div className="rounded-card border border-border p-4">
                <p className="text-sm text-textSecondary">Rekening tujuan</p>
                <p className="mt-1 text-base text-textMain">
                  {detailQuery.data.bank.bank_name} ·{' '}
                  {detailQuery.data.bank.account_number_masked}
                </p>
                <p className="text-sm text-textSecondary">
                  a.n. {detailQuery.data.bank.account_holder_name}
                </p>
                <p className="mt-2 text-xs text-textSecondary">
                  Provider: {detailQuery.data.provider}
                  {detailQuery.data.provider_ref
                    ? ` · ref ${detailQuery.data.provider_ref}`
                    : ''}
                </p>
              </div>

              <div>
                <h3 className="text-base font-semibold text-textMain">Booking tercakup</h3>
                <ul className="mt-2 divide-y divide-border overflow-hidden rounded-field border border-border">
                  {detailQuery.data.items.map((item) => (
                    <li
                      key={item.booking_id}
                      className="flex items-center justify-between gap-3 px-3 py-2"
                    >
                      <span className="tnum text-sm text-textMain">{item.booking_code}</span>
                      <span className="flex items-center gap-2">
                        {item.voided_at ? (
                          <StatusBadge tone="soft">Dilepas</StatusBadge>
                        ) : null}
                        <span className="tnum text-sm">{formatIDR(item.amount_idr)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="text-base font-semibold text-textMain">Jurnal</h3>
                {detailQuery.data.journal.length === 0 ? (
                  <p className="mt-1 text-sm text-textSecondary">
                    Belum ada jurnal. Jurnal dibuat saat payout disetujui.
                  </p>
                ) : (
                  <div className="mt-2 space-y-3">
                    {detailQuery.data.journal.map((entry) => (
                      <div key={entry.id} className="rounded-field border border-border p-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="font-mono text-sm font-semibold text-textMain">
                            {entry.event_type}
                          </p>
                          <p className="text-xs text-textSecondary">
                            {formatDateID(entry.occurred_at)}
                          </p>
                        </div>
                        <ul className="mt-2 space-y-1">
                          {entry.lines.map((line, index) => (
                            <li
                              key={`${entry.id}-${index}`}
                              className="flex items-center justify-between gap-2 text-sm"
                            >
                              <span className="tnum text-textSecondary">{line.account_code}</span>
                              <span className="tnum">
                                {line.debit_idr > 0
                                  ? `D ${formatIDR(line.debit_idr)}`
                                  : `K ${formatIDR(line.credit_idr)}`}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {detailQuery.data.status === 'paid' ? (
                <p className="flex items-center gap-2 text-sm text-okInk">
                  <CheckCircle2 aria-hidden className="h-4 w-4" />
                  Dana sudah dicairkan
                  {detailQuery.data.paid_at
                    ? ` pada ${formatDateID(detailQuery.data.paid_at)}`
                    : ''}
                  .
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
