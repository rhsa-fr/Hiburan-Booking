'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ShieldCheck, Wallet } from 'lucide-react';
import { useState } from 'react';
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
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableFoot,
  TableHead,
  TableHeadCell,
  TableRow,
  TableSkeleton,
  Textarea
} from '@/components/ui';
import {
  getOperators,
  getReleaseQueue,
  previewRelease,
  submitRelease
} from '@/lib/api';
import { formatDateID, formatIDR } from '@/lib/format';
import type { ReleaseCandidate, ReleaseInput, ReleaseResult } from '@/lib/types';

const MIN_REASON_LENGTH = 10;

export default function ReleasePage() {
  const queryClient = useQueryClient();
  const queueQuery = useQuery({ queryKey: ['release-queue'], queryFn: getReleaseQueue });
  const operatorsQuery = useQuery({ queryKey: ['operators'], queryFn: getOperators });

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [reason, setReason] = useState('');
  const [maker, setMaker] = useState('');
  const [checker, setChecker] = useState('');
  const [result, setResult] = useState<ReleaseResult | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const candidates = queueQuery.data?.candidates ?? [];
  const maxBatch = queueQuery.data?.max_batch ?? 5;
  const selectedCandidates = candidates.filter((candidate) =>
    selectedIds.includes(candidate.booking.id)
  );
  const selectedTotal = selectedCandidates.reduce(
    (sum, candidate) => sum + candidate.booking.vendor_entitlement_idr,
    0
  );

  const previewQuery = useQuery({
    queryKey: ['release-preview', selectedIds],
    queryFn: () =>
      previewRelease({
        booking_ids: selectedIds,
        reason,
        maker,
        checker
      }),
    enabled: step >= 1 && selectedIds.length > 0
  });

  const submit = useMutation<ReleaseResult, Error, ReleaseInput>({
    mutationFn: submitRelease,
    onSuccess: (data) => {
      setResult(data);
      setStep(3);
      void queryClient.invalidateQueries({ queryKey: ['release-queue'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['bookings'] });
      void queryClient.invalidateQueries({ queryKey: ['ledger'] });
    }
  });

  const reasonValid = reason.trim().length >= MIN_REASON_LENGTH;
  const makerValid = maker.length > 0;
  const checkerValid = checker.length > 0 && checker !== maker;
  const atLimit = selectedIds.length >= maxBatch;

  function toggle(id: string) {
    setSelectedIds((previous) => {
      if (previous.includes(id)) {
        return previous.filter((item) => item !== id);
      }
      if (previous.length >= maxBatch) {
        return previous;
      }
      return [...previous, id];
    });
  }

  function selectTop() {
    const eligible = candidates
      .filter((candidate) => candidate.eligible)
      .slice(0, maxBatch)
      .map((candidate) => candidate.booking.id);
    setSelectedIds(eligible);
  }

  function openDialog() {
    setStep(1);
    setResult(null);
    submit.reset();
  }

  function closeDialog() {
    if (submit.isPending) return;
    setStep(0);
    setReason('');
    setChecker('');
    setSubmitAttempted(false);
  }

  function approve() {
    setSubmitAttempted(true);
    if (!reasonValid || !makerValid || !checkerValid || selectedIds.length === 0) return;
    submit.mutate({
      booking_ids: selectedIds,
      reason: reason.trim(),
      maker,
      checker
    });
  }

  function finishSuccess() {
    setSelectedIds([]);
    setReason('');
    setMaker('');
    setChecker('');
    setResult(null);
    setStep(0);
  }

  return (
    <div>
      <PageHeader
        title="Pencairan"
        description="Release manual dengan maker-checker. Maker mengajukan, checker operator lain menyetujui, dan jurnal persisnya ditampilkan sebelum dana dicairkan."
        actions={<StatusBadge tone="soft">Maks. {maxBatch} booking per batch</StatusBadge>}
      />

      <Card className="overflow-hidden">
        <CardHeader
          title="Antrean siap cair"
          description="Booking completed, lunas, dana held, tanpa sengketa, dan jendela sengketa sudah lewat."
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={selectTop}
              disabled={queueQuery.isLoading || candidates.every((candidate) => !candidate.eligible)}
            >
              {queueQuery.isLoading
                ? 'Memuat antrean…'
                : `Pilih ${Math.min(
                    maxBatch,
                    candidates.filter((candidate) => candidate.eligible).length
                  )} teratas`}
            </Button>
          }
        />

        {queueQuery.isLoading ? (
          <TableSkeleton rows={4} />
        ) : queueQuery.isError ? (
          <ErrorState
            message={
              queueQuery.error instanceof Error
                ? queueQuery.error.message
                : 'Antrean pencairan tidak bisa dimuat. Periksa koneksi lalu coba lagi.'
            }
            onRetry={() => void queueQuery.refetch()}
            retrying={queueQuery.isFetching}
          />
        ) : candidates.length === 0 ? (
          <EmptyState
            icon={<Wallet aria-hidden className="h-6 w-6" />}
            title="Tidak ada booking di antrean"
            description="Belum ada booking yang memenuhi syarat pencairan. Antrean terisi setelah acara selesai dan jendela sengketa berakhir."
            action={
              <Button variant="outline" href="/bookings">
                Lihat semua booking
              </Button>
            }
          />
        ) : (
          <>
            <Table
              label="Booking yang menunggu pencairan manual beserta hak vendor dan kelayakannya"
              maxHeight="max-h-[60vh]"
              className="min-w-[940px]"
            >
              <TableHead>
                <TableRow>
                  <TableHeadCell className="w-12">
                    <span className="sr-only">Pilih</span>
                  </TableHeadCell>
                  <TableHeadCell>Booking</TableHeadCell>
                  <TableHeadCell>Vendor</TableHeadCell>
                  <TableHeadCell>Acara</TableHeadCell>
                  <TableHeadCell align="right">Total tagihan</TableHeadCell>
                  <TableHeadCell align="right">Hak vendor</TableHeadCell>
                  <TableHeadCell>Kelayakan</TableHeadCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {candidates.map((candidate: ReleaseCandidate) => {
                  const booking = candidate.booking;
                  const checked = selectedIds.includes(booking.id);
                  const disabled = !candidate.eligible || (atLimit && !checked);
                  const inputId = `release-select-${booking.id}`;
                  return (
                    <TableRow key={booking.id} selected={checked}>
                      <TableCell>
                        <Checkbox
                          id={inputId}
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggle(booking.id)}
                          label={`Pilih booking ${booking.code}`}
                          hideLabel
                          title={
                            candidate.eligible
                              ? atLimit && !checked
                                ? `Maksimal ${maxBatch} booking per batch.`
                                : undefined
                              : (candidate.blocked_reason ?? undefined)
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <p className="tnum text-sm font-semibold text-textMain">{booking.code}</p>
                        <p className="mt-0.5 text-sm text-textSecondary">{booking.customer_name}</p>
                      </TableCell>
                      <TableCell>
                        <p className="max-w-[220px] truncate text-base text-textMain">
                          {booking.vendor_name}
                        </p>
                        <p className="text-sm text-textSecondary">{booking.city}</p>
                      </TableCell>
                      <TableCell>
                        <p className="text-base text-textMain">{formatDateID(booking.event_start_at)}</p>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          <StatusPill axis="lifecycle" value={booking.lifecycle_status} />
                          <StatusPill axis="settlement" value={booking.settlement_status} />
                        </div>
                      </TableCell>
                      <TableCell align="right">
                        <span className="tnum text-textMain">{formatIDR(booking.total_customer_idr)}</span>
                      </TableCell>
                      <TableCell align="right">
                        <span className="tnum font-semibold text-textMain">
                          {formatIDR(booking.vendor_entitlement_idr)}
                        </span>
                      </TableCell>
                      <TableCell>
                        {candidate.eligible ? (
                          <StatusBadge tone="ok">Siap dicairkan</StatusBadge>
                        ) : (
                          <span className="block max-w-[240px] text-sm text-danger">
                            {candidate.blocked_reason ?? 'Tidak memenuhi syarat'}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            <div className="border-t border-border px-4 py-3">
              <p className="text-sm text-textSecondary">
                Maker dan checker wajib dua orang berbeda. Batch di atas {maxBatch} booking harus
                dipecah agar tiap jurnal tetap mudah diaudit.
              </p>
            </div>
          </>
        )}
      </Card>

      {selectedIds.length > 0 ? (
        <div className="sticky bottom-4 z-20 mt-5">
          <div className="flex flex-col gap-3 rounded-card border border-primary/20 bg-surface p-4 shadow-lg sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-base font-semibold text-textMain">{selectedIds.length} booking dipilih</p>
              <p className="text-sm text-textSecondary">
                Total hak vendor{' '}
                <span className="tnum font-semibold text-textMain">{formatIDR(selectedTotal)}</span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setSelectedIds([])}>
                Kosongkan
              </Button>
              <Button
                onClick={openDialog}
                icon={<ShieldCheck aria-hidden className="h-4 w-4" />}
              >
                Lanjut ke pratinjau
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <Modal
        open={step > 0}
        onClose={closeDialog}
        labelledBy="release-dialog-title"
        size="lg"
      >
        {step === 3 && result ? (
          <div className="py-4 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-card border border-ok/20 bg-ok/10 text-ok">
              <CheckCircle2 aria-hidden className="h-7 w-7" />
            </div>
            <h2 id="release-dialog-title" className="mt-4 text-xl font-semibold tracking-[-0.01em]">
              Pencairan tercatat
            </h2>
            <p className="mt-1 text-base text-textSecondary">
              Checker <span className="font-medium text-textMain">{result.checker}</span> menyetujui batch
              ini. Jurnal sudah masuk ke ledger.
            </p>
            <dl className="mx-auto mt-5 max-w-md divide-y divide-border rounded-card border border-border bg-surface text-left">
              <div className="px-4 py-3">
                <dt className="text-sm text-textSecondary">Booking dicairkan</dt>
                <dd className="mt-1 text-base font-medium text-textMain">
                  {result.released_booking_codes.join(', ')}
                </dd>
              </div>
              <div className="px-4 py-3">
                <dt className="text-sm text-textSecondary">Jurnal</dt>
                <dd className="tnum mt-1 text-base font-medium text-textMain">
                  {result.journal_codes.join(', ')}
                </dd>
              </div>
              <div className="px-4 py-3">
                <dt className="text-sm text-textSecondary">Alasan</dt>
                <dd className="mt-1 text-base text-textMain">{result.reason}</dd>
              </div>
            </dl>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <Button variant="outline" href="/ledger">
                Lihat jurnal
              </Button>
              <Button onClick={finishSuccess}>Tutup</Button>
            </div>
          </div>
        ) : (
          <div className="pr-8">
            <p className="text-sm font-semibold uppercase tracking-[0.12em] text-textSecondary">
              Langkah {step} dari 2
            </p>
            <h2 id="release-dialog-title" className="mt-1 text-xl font-semibold tracking-[-0.01em]">
              {step === 1 ? 'Pratinjau jurnal pencairan' : 'Konfirmasi checker'}
            </h2>
            <p className="mt-1 text-base leading-relaxed text-textSecondary">
              {step === 1
                ? 'Periksa jurnal yang akan diposting. Tidak ada dana berpindah sebelum checker menyetujui.'
                : 'Checker harus operator berbeda dari maker. Setelah disetujui, jurnal tidak bisa dihapus — koreksi hanya lewat reversal.'}
            </p>

            <div className="mt-5 rounded-card border border-border">
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div>
                  <h3 className="text-base font-semibold text-textMain">Jurnal yang akan diposting</h3>
                  <p className="text-sm text-textSecondary">
                    {selectedIds.length} booking · total{' '}
                    <span className="tnum">{formatIDR(selectedTotal)}</span> hak vendor
                  </p>
                </div>
                {previewQuery.data ? (
                  <StatusBadge
                    tone={
                      previewQuery.data.total_debit_idr === previewQuery.data.total_credit_idr
                        ? 'ok'
                        : 'danger'
                    }
                  >
                    {previewQuery.data.total_debit_idr === previewQuery.data.total_credit_idr
                      ? 'Debit = Kredit'
                      : 'Tidak seimbang'}
                  </StatusBadge>
                ) : null}
              </div>

              {previewQuery.isLoading ? (
                <BlockSkeleton rows={4} />
              ) : previewQuery.isError ? (
                <ErrorState
                  message={
                    previewQuery.error instanceof Error
                      ? previewQuery.error.message
                      : 'Pratinjau jurnal gagal dimuat.'
                  }
                  onRetry={() => void previewQuery.refetch()}
                  retrying={previewQuery.isFetching}
                />
              ) : previewQuery.data ? (
                <div className="divide-y divide-border">
                  {previewQuery.data.journals.map((journal) => (
                    <div key={journal.booking_id} className="p-4">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="tnum text-sm font-semibold text-textMain">{journal.booking_code}</p>
                        <p className="tnum text-sm text-textSecondary">
                          {formatIDR(journal.debit_total_idr)} /{' '}
                          {formatIDR(journal.credit_total_idr)}
                        </p>
                      </div>
                      <Table label={`Debit dan kredit untuk ${journal.booking_code}`} maxHeight={null}>
                        <TableHead>
                          <TableRow>
                            <TableHeadCell>Akun</TableHeadCell>
                            <TableHeadCell align="right">Debit</TableHeadCell>
                            <TableHeadCell align="right">Kredit</TableHeadCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {journal.lines.map((line) => (
                            <TableRow key={line.id}>
                              <TableCell>
                                <p className="tnum text-sm font-medium text-textMain">
                                  {line.account_code} · {line.account_name}
                                </p>
                                <p className="text-xs text-textSecondary">{line.memo}</p>
                              </TableCell>
                              <TableCell
                                align="right"
                                className={
                                  line.side === 'debit'
                                    ? 'tnum text-sm text-primary'
                                    : 'tnum text-sm text-textMain'
                                }
                              >
                                {line.side === 'debit' ? formatIDR(line.amount_idr) : '—'}
                              </TableCell>
                              <TableCell
                                align="right"
                                className={
                                  line.side === 'credit'
                                    ? 'tnum text-sm font-semibold text-textMain'
                                    : 'tnum text-sm text-textSecondary'
                                }
                              >
                                {line.side === 'credit' ? formatIDR(line.amount_idr) : '—'}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                        <TableFoot>
                          <TableRow>
                            <TableCell align="right" className="font-semibold text-textMain">
                              Total
                            </TableCell>
                            <TableCell align="right" className="tnum font-semibold text-textMain">
                              {formatIDR(journal.debit_total_idr)}
                            </TableCell>
                            <TableCell align="right" className="tnum font-semibold text-textMain">
                              {formatIDR(journal.credit_total_idr)}
                            </TableCell>
                          </TableRow>
                        </TableFoot>
                      </Table>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            {step === 1 ? (
              <div className="mt-5 space-y-4">
                <Textarea
                  id="release-reason"
                  label="Alasan pencairan"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Contoh: acara selesai tanpa sengketa, jendela klaim sudah lewat."
                  hint={`Minimal ${MIN_REASON_LENGTH} karakter. Tersimpan di audit log dan timeline booking.`}
                  error={
                    reason.length > 0 && !reasonValid
                      ? `Alasan masih ${reason.trim().length} karakter, minimal ${MIN_REASON_LENGTH}.`
                      : null
                  }
                />
                <Select
                  id="release-maker"
                  label="Maker (pengaju)"
                  value={maker}
                  onChange={(event) => setMaker(event.target.value)}
                  hint="Operator yang mengajukan batch ini."
                >
                  <option value="">Pilih operator</option>
                  {(operatorsQuery.data ?? []).map((operator) => (
                    <option key={operator.id} value={operator.name}>
                      {operator.name} · {operator.role}
                    </option>
                  ))}
                </Select>
                {operatorsQuery.isError ? (
                  <p role="alert" className="text-sm font-semibold text-danger">
                    Daftar operator gagal dimuat. Tutup dialog lalu coba lagi.
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                <div className="rounded-card border border-border bg-subtle px-4 py-3">
                  <p className="text-sm text-textSecondary">Maker</p>
                  <p className="text-base font-semibold text-textMain">{maker}</p>
                </div>
                <Select
                  id="release-checker"
                  label="Checker (penyetuju)"
                  value={checker}
                  onChange={(event) => setChecker(event.target.value)}
                  hint="Harus operator berbeda dari maker. Kontrol ini ditegakkan juga di server."
                  error={
                    checker.length > 0 && checker === maker
                      ? 'Checker tidak boleh sama dengan maker.'
                      : submitAttempted && !checker
                        ? 'Pilih checker terlebih dahulu.'
                        : null
                  }
                >
                  <option value="">Pilih operator</option>
                  {(operatorsQuery.data ?? []).map((operator) => (
                    <option
                      key={operator.id}
                      value={operator.name}
                      disabled={operator.name === maker}
                    >
                      {operator.name} · {operator.role}
                      {operator.name === maker ? ' (maker)' : ''}
                    </option>
                  ))}
                </Select>
                {checker.length > 0 && checker === maker ? (
                  <Alert tone="danger">
                    Pilih operator lain. Satu orang tidak boleh menjadi maker sekaligus checker.
                  </Alert>
                ) : null}
              </div>
            )}

            {submit.error ? <Alert tone="danger">{submit.error.message}</Alert> : null}

            <div className="mt-5 flex flex-col-reverse gap-3 border-t border-border pt-4 sm:flex-row sm:justify-between">
              <Button
                variant="outline"
                onClick={() => (step === 2 ? setStep(1) : closeDialog())}
                disabled={submit.isPending}
              >
                {step === 2 ? 'Kembali' : 'Batal'}
              </Button>
              {step === 1 ? (
                <Button
                  onClick={() => setStep(2)}
                  disabled={!reasonValid || !makerValid || !previewQuery.data}
                  ariaControls="release-step1-hint"
                >
                  Lanjut: pilih checker
                </Button>
              ) : (
                <Button onClick={approve} disabled={submit.isPending || !checkerValid}>
                  {submit.isPending ? 'Memposting jurnal…' : 'Setujui & cairkan'}
                </Button>
              )}
            </div>
            {step === 1 && (!reasonValid || !makerValid) ? (
              <p id="release-step1-hint" className="mt-2 text-right text-sm text-textSecondary">
                Isi alasan minimal {MIN_REASON_LENGTH} karakter dan pilih maker untuk melanjutkan.
              </p>
            ) : null}
          </div>
        )}
      </Modal>
    </div>
  );
}
