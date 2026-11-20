'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Play, Scale } from 'lucide-react';
import { useState } from 'react';
import clsx from 'clsx';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Input,
  Pagination,
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
import type { BadgeTone } from '@/components/ui';
import {
  getReconciliationRun,
  listReconciliationRuns,
  resolveReconciliationDiff,
  runReconciliation,
  type ReconciliationClassification,
  type ReconciliationDiff,
  type ReconciliationProvider,
  type ReconciliationResolution,
  type ReconciliationRunStatus,
  type ReconciliationSeverity
} from '@/lib/api';
import { formatCalendarDayID, formatDateTimeID, formatIDR, formatNumber } from '@/lib/format';

const PAGE_SIZE = 20;

const PROVIDER_LABELS: Record<ReconciliationProvider, string> = {
  midtrans: 'Midtrans',
  pjp: 'PJP'
};

const STATUS_LABELS: Record<ReconciliationRunStatus, string> = {
  running: 'Berjalan',
  balanced: 'Seimbang',
  discrepancy: 'Ada selisih',
  failed: 'Gagal'
};

const STATUS_TONES: Record<ReconciliationRunStatus, BadgeTone> = {
  running: 'soft',
  balanced: 'ok',
  discrepancy: 'danger',
  failed: 'danger'
};

const CLASSIFICATION_LABELS: Record<ReconciliationClassification, string> = {
  matched: 'Cocok',
  duplicate: 'Duplikat',
  missing_in_ledger: 'Tidak ada di ledger',
  missing_at_gateway: 'Tidak ada di gateway',
  amount_mismatch: 'Nominal berbeda',
  fee_mismatch: 'Biaya berbeda',
  unverified: 'Belum terverifikasi'
};

const SEVERITY_LABELS: Record<ReconciliationSeverity, string> = {
  info: 'Info',
  warning: 'Peringatan',
  critical: 'Kritis'
};

const SEVERITY_TONES: Record<ReconciliationSeverity, BadgeTone> = {
  info: 'muted',
  warning: 'soft',
  critical: 'danger'
};

/** FR-131 fase 2: keputusan yang boleh diambil atas satu temuan. */
const RESOLUTION_LABELS: Record<ReconciliationResolution, string> = {
  accepted: 'Selisih diterima (didokumentasikan)',
  ignored: 'Bukan temuan nyata',
  referred: 'Diteruskan ke finance/provider',
  corrected: 'Dibetulkan di luar sistem'
};

/** Kemarin menurut kalender WIB; tanggal awal yang wajar untuk laporan harian. */
function yesterdayWib(): string {
  const now = new Date(Date.now() + 7 * 60 * 60 * 1000);
  now.setUTCDate(now.getUTCDate() - 1);
  return now.toISOString().slice(0, 10);
}

function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider as ReconciliationProvider] ?? provider;
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status as ReconciliationRunStatus] ?? status;
}

function statusTone(status: string): BadgeTone {
  return STATUS_TONES[status as ReconciliationRunStatus] ?? 'muted';
}

function classificationLabel(value: string): string {
  return CLASSIFICATION_LABELS[value as ReconciliationClassification] ?? value;
}

function severityLabel(value: string): string {
  return SEVERITY_LABELS[value as ReconciliationSeverity] ?? value;
}

function severityTone(value: string): BadgeTone {
  return SEVERITY_TONES[value as ReconciliationSeverity] ?? 'muted';
}

/** Satu sisi bisa kosong; garis, bukan Rp0, supaya tidak terbaca sebagai nol. */
function amountOrDash(value: number | null): string {
  return value === null ? '—' : formatIDR(value);
}

function isOverdue(diff: ReconciliationDiff): boolean {
  return diff.resolved_at === null && diff.due_at !== null && Date.parse(diff.due_at) < Date.now();
}

export function ReconciliationView() {
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState<ReconciliationProvider>('midtrans');
  const [reportDate, setReportDate] = useState(yesterdayWib);
  const [page, setPage] = useState(1);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [resolveTarget, setResolveTarget] = useState<ReconciliationDiff | null>(null);
  const [resolution, setResolution] = useState<ReconciliationResolution>('accepted');
  const [note, setNote] = useState('');

  const runsQuery = useQuery({
    queryKey: ['reconciliation-runs', page],
    queryFn: () => listReconciliationRuns({ page, page_size: PAGE_SIZE })
  });

  const detailQuery = useQuery({
    queryKey: ['reconciliation-run', selectedRunId],
    enabled: selectedRunId !== null,
    queryFn: async () => {
      if (!selectedRunId) throw new Error('Run rekonsiliasi belum dipilih.');
      return getReconciliationRun(selectedRunId);
    }
  });

  const runMutation = useMutation({
    mutationFn: runReconciliation,
    onSuccess: (run) => {
      setPage(1);
      setSelectedRunId(run.run_id);
      void queryClient.invalidateQueries({ queryKey: ['reconciliation-runs'] });
      void queryClient.invalidateQueries({ queryKey: ['reconciliation-run', run.run_id] });
    }
  });

  const resolveMutation = useMutation({
    mutationFn: (input: { diffId: string; resolution: ReconciliationResolution; note: string }) =>
      resolveReconciliationDiff(input.diffId, {
        resolution: input.resolution,
        note: input.note
      }),
    onSuccess: () => {
      setResolveTarget(null);
      setNote('');
      void queryClient.invalidateQueries({ queryKey: ['reconciliation-run', selectedRunId] });
      void queryClient.invalidateQueries({ queryKey: ['reconciliation-runs'] });
    }
  });

  const runs = runsQuery.data?.items ?? [];
  const total = runsQuery.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const detail = detailQuery.data;

  const runErrorMessage = runMutation.isError
    ? runMutation.error instanceof Error
      ? runMutation.error.message
      : 'Rekonsiliasi gagal dijalankan. Coba lagi.'
    : null;

  const resolveErrorMessage = resolveMutation.isError
    ? resolveMutation.error instanceof Error
      ? resolveMutation.error.message
      : 'Keputusan gagal disimpan. Coba lagi.'
    : null;

  return (
    <div className="space-y-6">
      <Card>
        <CardBody>
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
            <Select
              id="reconciliation-provider"
              label="Provider"
              value={provider}
              disabled={runMutation.isPending}
              onChange={(event) =>
                setProvider(event.target.value === 'pjp' ? 'pjp' : 'midtrans')
              }
            >
              <option value="midtrans">Midtrans</option>
              <option value="pjp">PJP</option>
            </Select>
            <Input
              id="reconciliation-date"
              label="Tanggal laporan (WIB)"
              type="date"
              value={reportDate}
              disabled={runMutation.isPending}
              onChange={(event) => setReportDate(event.target.value)}
            />
            <Button
              onClick={() => runMutation.mutate({ provider, report_date: reportDate })}
              disabled={runMutation.isPending || reportDate.length === 0}
              icon={<Play aria-hidden className="h-4 w-4" />}
            >
              {runMutation.isPending ? 'Menjalankan…' : 'Jalankan rekonsiliasi'}
            </Button>
          </div>
          {runErrorMessage ? (
            <Alert tone="danger" className="mt-4">
              {runErrorMessage}
            </Alert>
          ) : null}
        </CardBody>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader
          icon={<Scale aria-hidden className="h-[17px] w-[17px]" />}
          title="Riwayat rekonsiliasi"
          description="Satu baris per provider dan tanggal laporan. Pilih baris untuk melihat temuannya."
        />

        {runsQuery.isLoading ? (
          <TableSkeleton rows={5} />
        ) : runsQuery.isError ? (
          <ErrorState
            title="Gagal memuat riwayat rekonsiliasi"
            message={
              runsQuery.error instanceof Error
                ? runsQuery.error.message
                : 'Daftar rekonsiliasi tidak bisa dimuat. Periksa koneksi lalu coba lagi.'
            }
            onRetry={() => void runsQuery.refetch()}
            retrying={runsQuery.isFetching}
          />
        ) : runs.length === 0 ? (
          <EmptyState
            title="Belum ada rekonsiliasi untuk filter ini."
            description="Pilih provider dan tanggal laporan, lalu jalankan rekonsiliasi untuk menyimpan temuan."
          />
        ) : (
          <>
            <Table
              label="Riwayat run rekonsiliasi beserta total gateway, ledger, dan selisih"
              maxHeight="max-h-[55vh]"
              className="min-w-[1080px]"
            >
              <TableHead>
                <TableRow>
                  <TableHeadCell>Tanggal</TableHeadCell>
                  <TableHeadCell>Provider</TableHeadCell>
                  <TableHeadCell>Status</TableHeadCell>
                  <TableHeadCell align="right">Diperiksa</TableHeadCell>
                  <TableHeadCell align="right">Cocok</TableHeadCell>
                  <TableHeadCell align="right">Temuan</TableHeadCell>
                  <TableHeadCell align="right">Total gateway</TableHeadCell>
                  <TableHeadCell align="right">Total ledger</TableHeadCell>
                  <TableHeadCell align="right">Selisih</TableHeadCell>
                  <TableHeadCell align="right">Aksi</TableHeadCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {runs.map((run) => {
                  const isSelected = run.run_id === selectedRunId;
                  return (
                    <TableRow
                      key={run.run_id}
                      selected={isSelected}
                      onClick={() => setSelectedRunId(run.run_id)}
                    >
                      <TableCell>
                        <span className="whitespace-nowrap font-medium">
                          {formatCalendarDayID(run.report_date)}
                        </span>
                      </TableCell>
                      <TableCell>{providerLabel(run.provider)}</TableCell>
                      <TableCell>
                        <StatusBadge tone={statusTone(run.status)}>
                          {statusLabel(run.status)}
                        </StatusBadge>
                      </TableCell>
                      <TableCell align="right">
                        <span className="tnum">{formatNumber(run.checked_count)}</span>
                      </TableCell>
                      <TableCell align="right">
                        <span className="tnum">{formatNumber(run.matched_count)}</span>
                      </TableCell>
                      <TableCell align="right">
                        <span
                          className={clsx(
                            'tnum',
                            run.diff_count > 0 && 'font-semibold text-danger'
                          )}
                        >
                          {formatNumber(run.diff_count)}
                        </span>
                      </TableCell>
                      <TableCell align="right">
                        <span className="tnum whitespace-nowrap">
                          {formatIDR(run.gateway_total_idr)}
                        </span>
                      </TableCell>
                      <TableCell align="right">
                        <span className="tnum whitespace-nowrap">
                          {formatIDR(run.ledger_total_idr)}
                        </span>
                      </TableCell>
                      <TableCell align="right">
                        <span
                          className={clsx(
                            'tnum whitespace-nowrap font-semibold',
                            run.diff_idr !== 0 ? 'text-danger' : 'text-textMain'
                          )}
                        >
                          {formatIDR(run.diff_idr)}
                        </span>
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          variant="ghost"
                          size="sm"
                          ariaLabel={`Lihat detail rekonsiliasi ${formatCalendarDayID(run.report_date)}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedRunId(isSelected ? null : run.run_id);
                          }}
                        >
                          {isSelected ? 'Tutup' : 'Lihat'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {pageCount > 1 ? (
              <Pagination
                page={page}
                pageCount={pageCount}
                start={(page - 1) * PAGE_SIZE + 1}
                end={Math.min(page * PAGE_SIZE, total)}
                total={total}
                unit="run"
                onPageChange={setPage}
              />
            ) : null}
          </>
        )}
      </Card>

      {selectedRunId ? (
        <Card className="overflow-hidden">
          <CardHeader
            icon={<Scale aria-hidden className="h-[17px] w-[17px]" />}
            title="Detail run terpilih"
            description={
              detail
                ? `${formatCalendarDayID(detail.report_date)} · ${providerLabel(detail.provider)} · ${
                    detail.diff_count === 0
                      ? `tidak ada temuan, semua ${formatNumber(detail.checked_count)} baris cocok.`
                      : `${formatNumber(detail.diff_count)} temuan dari ${formatNumber(detail.checked_count)} baris diperiksa${
                          detail.open_diff_count > 0
                            ? `, ${formatNumber(detail.open_diff_count)} belum diselesaikan.`
                            : ', semuanya sudah diselesaikan.'
                        }`
                  }`
                : 'Memuat detail run…'
            }
            action={
              <Button variant="ghost" size="sm" onClick={() => setSelectedRunId(null)}>
                Tutup
              </Button>
            }
          />

          {detailQuery.isLoading ? (
            <TableSkeleton rows={3} />
          ) : detailQuery.isError ? (
            <ErrorState
              title="Gagal memuat detail run"
              message={
                detailQuery.error instanceof Error
                  ? detailQuery.error.message
                  : 'Detail rekonsiliasi tidak bisa dimuat. Periksa koneksi lalu coba lagi.'
              }
              onRetry={() => void detailQuery.refetch()}
              retrying={detailQuery.isFetching}
            />
          ) : detail ? (
            detail.diffs.length === 0 ? (
              <EmptyState
                title="Tidak ada temuan."
                description="Tidak ada baris gateway maupun ledger yang perlu diperiksa pada tanggal ini."
                icon={<CheckCircle2 aria-hidden className="h-6 w-6" />}
              />
            ) : (
              <Table
                label="Daftar temuan rekonsiliasi untuk run terpilih"
                maxHeight="max-h-[55vh]"
                className="min-w-[1100px]"
              >
                <TableHead>
                  <TableRow>
                    <TableHeadCell>Klasifikasi</TableHeadCell>
                    <TableHeadCell>Tingkat</TableHeadCell>
                    <TableHeadCell>External ID</TableHeadCell>
                    <TableHeadCell align="right">Gateway</TableHeadCell>
                    <TableHeadCell align="right">Ledger</TableHeadCell>
                    <TableHeadCell align="right">Delta</TableHeadCell>
                    <TableHeadCell>SLA</TableHeadCell>
                    <TableHeadCell>Status</TableHeadCell>
                    <TableHeadCell align="right">Aksi</TableHeadCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {detail.diffs.map((diff) => {
                    const overdue = isOverdue(diff);
                    return (
                      <TableRow key={diff.id}>
                        <TableCell>{classificationLabel(diff.classification)}</TableCell>
                        <TableCell>
                          <StatusBadge tone={severityTone(diff.severity)}>
                            {severityLabel(diff.severity)}
                          </StatusBadge>
                        </TableCell>
                        <TableCell>
                          <span className="block max-w-[280px] truncate text-[13px] text-textSecondary">
                            {diff.external_id ?? '—'}
                          </span>
                        </TableCell>
                        <TableCell align="right">
                          <span className="tnum whitespace-nowrap">
                            {amountOrDash(diff.gateway_amount_idr)}
                          </span>
                        </TableCell>
                        <TableCell align="right">
                          <span className="tnum whitespace-nowrap">
                            {amountOrDash(diff.ledger_amount_idr)}
                          </span>
                        </TableCell>
                        <TableCell align="right">
                          <span
                            className={clsx(
                              'tnum whitespace-nowrap font-semibold',
                              diff.delta_idr !== null && diff.delta_idr !== 0
                                ? 'text-danger'
                                : 'text-textMain'
                            )}
                          >
                            {amountOrDash(diff.delta_idr)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span
                            className={clsx(
                              'whitespace-nowrap text-[13px]',
                              overdue ? 'font-semibold text-danger' : 'text-textSecondary'
                            )}
                          >
                            {diff.due_at === null ? '—' : formatDateTimeID(diff.due_at)}
                            {overdue ? ' · lewat' : ''}
                          </span>
                        </TableCell>
                        <TableCell>
                          {diff.classification === 'matched' ? (
                            <StatusBadge tone="muted">Cocok</StatusBadge>
                          ) : diff.resolved_at === null ? (
                            <StatusBadge tone="soft">Terbuka</StatusBadge>
                          ) : (
                            <span
                              title={diff.resolution_note ?? undefined}
                              className="inline-flex"
                            >
                              <StatusBadge tone="ok">
                                {diff.resolution === null
                                  ? 'Selesai'
                                  : RESOLUTION_LABELS[diff.resolution]}
                              </StatusBadge>
                            </span>
                          )}
                        </TableCell>
                        <TableCell align="right">
                          {diff.classification === 'matched' ? (
                            <span className="text-[13px] text-textSecondary">—</span>
                          ) : diff.resolved_at === null ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              ariaLabel={`Selesaikan temuan ${diff.external_id ?? diff.id}`}
                              disabled={resolveMutation.isPending}
                              onClick={() => {
                                setResolveTarget(diff);
                                setResolution('accepted');
                                setNote('');
                              }}
                            >
                              Selesaikan
                            </Button>
                          ) : (
                            <span className="text-[13px] text-textSecondary">
                              {formatDateTimeID(diff.resolved_at)}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )
          ) : null}
        </Card>
      ) : null}

      {selectedRunId && resolveTarget ? (
        <Card>
          <CardHeader
            icon={<CheckCircle2 aria-hidden className="h-[17px] w-[17px]" />}
            title="Selesaikan temuan"
            description={`${classificationLabel(resolveTarget.classification)} · ${
              resolveTarget.external_id ?? resolveTarget.id
            } · delta ${amountOrDash(resolveTarget.delta_idr)}`}
            action={
              <Button
                variant="ghost"
                size="sm"
                disabled={resolveMutation.isPending}
                onClick={() => setResolveTarget(null)}
              >
                Batal
              </Button>
            }
          />
          <CardBody className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Select
                id="reconciliation-resolution"
                label="Keputusan"
                value={resolution}
                disabled={resolveMutation.isPending}
                onChange={(event) =>
                  setResolution(event.target.value as ReconciliationResolution)
                }
              >
                {(Object.keys(RESOLUTION_LABELS) as ReconciliationResolution[]).map((value) => (
                  <option key={value} value={value}>
                    {RESOLUTION_LABELS[value]}
                  </option>
                ))}
              </Select>
              <div className="flex items-end text-[13px] text-textSecondary">
                Temuan yang sudah diputuskan tidak bisa diubah lagi; catatan peninjau
                pertama disimpan di audit log.
              </div>
            </div>
            <Textarea
              id="reconciliation-resolution-note"
              label="Catatan penyelesaian"
              hint="Minimal 5 karakter. Jelaskan bukti atau tindakan yang sudah dilakukan."
              maxLength={1000}
              value={note}
              disabled={resolveMutation.isPending}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Contoh: selisih Rp2.000 adalah biaya kanal Midtrans, bukti transfer dilampirkan di tiket FIN-123."
            />
            {resolveErrorMessage ? <Alert tone="danger">{resolveErrorMessage}</Alert> : null}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                disabled={resolveMutation.isPending}
                onClick={() => setResolveTarget(null)}
              >
                Batal
              </Button>
              <Button
                disabled={resolveMutation.isPending || note.trim().length < 5}
                onClick={() =>
                  resolveMutation.mutate({
                    diffId: resolveTarget.id,
                    resolution,
                    note: note.trim()
                  })
                }
              >
                {resolveMutation.isPending ? 'Menyimpan…' : 'Simpan keputusan'}
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
