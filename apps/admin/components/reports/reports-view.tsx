'use client';

/**
 * Antrean laporan konten (FR-123) dan keputusan takedown (FR-124).
 *
 * Alurnya sengaja tiga langkah: buka antrean → pilih laporan → putuskan.
 * Keputusan selalu butuh catatan ≥10 karakter karena alasan itulah yang
 * disimpan di `audit_logs` dan dibaca pelapor.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Flag, RotateCw } from 'lucide-react';
import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Modal,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeadCell,
  TableRow,
  TableSkeleton,
  Tabs,
  Toast,
  selectClass,
  textareaClass
} from '@/components/ui';
import type { BadgeTone, TabItem } from '@/components/ui';
import {
  getReportQueue,
  resolveReport,
  type AdminReport,
  type AdminReportAction,
  type AdminReportQueueStatus,
  type AdminReportReason,
  type AdminReportStatus,
  type AdminReportTargetType
} from '@/lib/api';
import { formatDateTimeID } from '@/lib/format';

type QueueTab = 'pending' | 'overdue' | 'resolved' | 'all';

const TABS: TabItem[] = [
  { id: 'pending', label: 'Belum diputuskan' },
  { id: 'overdue', label: 'Lewat SLA' },
  { id: 'resolved', label: 'Selesai' },
  { id: 'all', label: 'Semua' }
];

const ACTIONS: Array<{ value: AdminReportAction; label: string }> = [
  { value: 'no_action', label: 'Tidak ada tindakan (laporan tidak berdasar)' },
  { value: 'user_warned', label: 'Peringatan tertulis kepada pemilik konten' },
  { value: 'content_removed', label: 'Turunkan konten (sembunyikan dari publik)' },
  { value: 'content_restored', label: 'Pulihkan konten yang sebelumnya diturunkan' }
];

const TARGET_LABELS: Record<AdminReportTargetType, string> = {
  vendor: 'Vendor',
  review: 'Ulasan',
  chat_message: 'Pesan chat',
  vendor_media: 'Media vendor'
};

const REASON_LABELS: Record<AdminReportReason, string> = {
  spam: 'Spam',
  harassment: 'Pelecehan',
  fraud: 'Penipuan',
  illegal: 'Konten ilegal',
  copyright: 'Hak cipta',
  impersonation: 'Peniruan identitas',
  other: 'Lainnya'
};

const STATUS_LABELS: Record<AdminReportStatus, string> = {
  open: 'Baru',
  reviewing: 'Ditinjau',
  resolved: 'Diputuskan',
  rejected: 'Ditolak'
};

const FIRST_PAGE = 1;
const PAGE_SIZE = 20;

function statusTone(status: AdminReportStatus, overdue: boolean): BadgeTone {
  if (status === 'resolved' || status === 'rejected') return 'muted';
  return overdue ? 'danger' : 'primary';
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function tabParams(tab: QueueTab, page: number) {
  if (tab === 'pending') return { status: 'pending' as AdminReportQueueStatus, page };
  if (tab === 'overdue') return { overdue: true, page };
  if (tab === 'resolved') return { status: 'resolved' as AdminReportQueueStatus, page };
  return { page };
}

export function ReportsView() {
  const [tab, setTab] = useState<QueueTab>('pending');
  const [page, setPage] = useState(FIRST_PAGE);
  const [selected, setSelected] = useState<AdminReport | null>(null);
  const [action, setAction] = useState<AdminReportAction>('no_action');
  const [note, setNote] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const queue = useQuery({
    queryKey: ['reports', tab, page],
    queryFn: () => getReportQueue({ ...tabParams(tab, page), page_size: PAGE_SIZE })
  });

  const decide = useMutation({
    mutationFn: (input: { id: string; action: AdminReportAction; note: string }) =>
      resolveReport(input.id, { action: input.action, note: input.note }),
    onSuccess: () => {
      setToast('Keputusan tersimpan dan tercatat di audit log.');
      setSelected(null);
      setNote('');
      setAction('no_action');
      void queryClient.invalidateQueries({ queryKey: ['reports'] });
    }
  });

  function openReport(report: AdminReport) {
    setSelected(report);
    setAction('no_action');
    setNote('');
    decide.reset();
  }

  function changeTab(next: string) {
    setTab(next as QueueTab);
    setPage(FIRST_PAGE);
  }

  const items = queue.data?.items ?? [];
  const total = queue.data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const noteTooShort = note.trim().length < 10;

  return (
    <div className="space-y-4">
      {toast ? (
        <Toast
          tone="ok"
          title={toast}
          onDismiss={() => setToast(null)}
        />
      ) : null}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <Tabs items={TABS} value={tab} onChange={changeTab} ariaLabel="Filter laporan" />
          <Button
            variant="outline"
            onClick={() => void queue.refetch()}
            disabled={queue.isFetching}
          >
            <RotateCw aria-hidden className="h-4 w-4" />
            Muat ulang
          </Button>
        </div>

        {queue.isPending ? (
          <TableSkeleton rows={6} />
        ) : queue.isError ? (
          <ErrorState
            message={queue.error instanceof Error ? queue.error.message : 'Gagal memuat laporan'}
            onRetry={() => void queue.refetch()}
            retrying={queue.isFetching}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Flag aria-hidden className="h-6 w-6" />}
            title="Tidak ada laporan"
            description="Antrean moderasi untuk filter ini kosong. Laporan baru akan muncul di sini."
          />
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeadCell>Masuk</TableHeadCell>
                <TableHeadCell>Target</TableHeadCell>
                <TableHeadCell>Alasan</TableHeadCell>
                <TableHeadCell>Batas tinjauan</TableHeadCell>
                <TableHeadCell>Status</TableHeadCell>
                <TableHeadCell align="right">Aksi</TableHeadCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((report) => (
                <TableRow key={report.id}>
                  <TableCell>
                    <span className="text-textMain">{formatDateTimeID(report.created_at)}</span>
                    <span className="block text-[12px] text-textMuted">#{shortId(report.id)}</span>
                  </TableCell>
                  <TableCell>
                    <span className="font-semibold text-textMain">
                      {TARGET_LABELS[report.target_type]}
                    </span>
                    <span className="block text-[12px] text-textMuted">
                      {shortId(report.target_id)}
                    </span>
                  </TableCell>
                  <TableCell>{REASON_LABELS[report.reason]}</TableCell>
                  <TableCell>
                    <span className={report.overdue ? 'font-semibold text-danger' : undefined}>
                      {formatDateTimeID(report.sla_due_at)}
                    </span>
                    {report.overdue ? (
                      <span className="block text-[12px] text-danger">Lewat SLA</span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={statusTone(report.status, report.overdue)}>
                      {STATUS_LABELS[report.status]}
                    </StatusBadge>
                  </TableCell>
                  <TableCell align="right">
                    <Button variant="outline" onClick={() => openReport(report)}>
                      {report.status === 'open' || report.status === 'reviewing'
                        ? 'Tinjau'
                        : 'Lihat'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {total > PAGE_SIZE ? (
          <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-[13px] text-textSecondary">
            <span>
              Halaman {page} dari {lastPage} · {total} laporan
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= FIRST_PAGE}
                onClick={() => setPage((current) => Math.max(FIRST_PAGE, current - 1))}
              >
                Sebelumnya
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= lastPage}
                onClick={() => setPage((current) => current + 1)}
              >
                Berikutnya
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      <Modal
        open={selected !== null}
        onClose={() => setSelected(null)}
        labelledBy="report-detail-title"
        size="lg"
      >
        {selected ? (
          <div className="space-y-4">
            <div>
              <h2 id="report-detail-title" className="text-lg font-semibold text-textMain">
                {TARGET_LABELS[selected.target_type]} · {REASON_LABELS[selected.reason]}
              </h2>
              <p className="mt-1 text-[13px] text-textSecondary">
                Masuk {formatDateTimeID(selected.created_at)} · batas tinjauan{' '}
                {formatDateTimeID(selected.sla_due_at)}
                {selected.overdue ? ' (lewat SLA)' : ''}
                {selected.escalated_at ? ` · dieskalasi ${formatDateTimeID(selected.escalated_at)}` : ''}
              </p>
            </div>

            <div className="rounded-field border border-border bg-subtle px-4 py-3">
              <p className="text-[13px] font-semibold text-textSecondary">Isi laporan</p>
              <p className="mt-1 whitespace-pre-line text-[14px] text-textMain">{selected.detail}</p>
              {selected.evidence_url ? (
                <a
                  className="mt-2 inline-block text-[13px] font-semibold text-primary underline"
                  href={selected.evidence_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Buka tautan bukti
                </a>
              ) : null}
            </div>

            <dl className="grid grid-cols-2 gap-3 text-[13px]">
              <div>
                <dt className="text-textMuted">ID target</dt>
                <dd className="font-mono text-textMain">{selected.target_type}#{shortId(selected.target_id)}</dd>
              </div>
              <div>
                <dt className="text-textMuted">Pelapor</dt>
                <dd className="font-mono text-textMain">{shortId(selected.reporter_id)}</dd>
              </div>
            </dl>

            {selected.status === 'resolved' || selected.status === 'rejected' ? (
              <Alert tone="info" title="Sudah diputuskan">
                <p>{selected.resolution_note ?? 'Tanpa catatan.'}</p>
                <p className="mt-1 text-[12px]">
                  {selected.resolution ? ACTIONS.find((a) => a.value === selected.resolution)?.label : ''}
                  {selected.resolved_at ? ` · ${formatDateTimeID(selected.resolved_at)}` : ''}
                </p>
              </Alert>
            ) : (
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (noteTooShort) return;
                  decide.mutate({ id: selected.id, action, note: note.trim() });
                }}
              >
                <label className="block text-[13px] font-semibold text-textSecondary">
                  Tindakan
                  <select
                    className={selectClass}
                    value={action}
                    onChange={(event) => setAction(event.target.value as AdminReportAction)}
                  >
                    {ACTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-[13px] font-semibold text-textSecondary">
                  Catatan keputusan (wajib, ≥10 karakter)
                  <textarea
                    className={textareaClass}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Contoh: Bukti menunjukkan vendor meminta transfer di luar platform."
                  />
                </label>

                {decide.isError ? (
                  <Alert tone="danger" title="Keputusan gagal disimpan">
                    {decide.error instanceof Error ? decide.error.message : 'Terjadi kesalahan.'}
                  </Alert>
                ) : null}

                <div className="flex justify-end gap-2">
                  <Button variant="ghost" type="button" onClick={() => setSelected(null)}>
                    Batal
                  </Button>
                  <Button type="submit" disabled={noteTooShort || decide.isPending}>
                    {decide.isPending ? 'Menyimpan…' : 'Simpan keputusan'}
                  </Button>
                </div>
              </form>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
