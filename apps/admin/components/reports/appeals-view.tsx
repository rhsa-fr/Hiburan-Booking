'use client';

/**
 * Antrean banding takedown (FR-124).
 *
 * Keputusan wajib bercatatan karena catatan itulah yang masuk `audit_logs` dan
 * dibaca pemilik konten. Menerima banding memulihkan ulasan/pesan chat, atau
 * mengembalikan media ke antrean moderasi (kolom publiknya sudah dibersihkan
 * saat takedown).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gavel, RotateCw } from 'lucide-react';
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
  Toast,
  selectClass,
  textareaClass
} from '@/components/ui';
import type { BadgeTone } from '@/components/ui';
import { getAppealEvidence, getReportAppeals, resolveReportAppeal } from '@/lib/api';
import { formatDateTimeID } from '@/lib/format';
import type { AppealStatus, AppealTargetType, ReportAppeal } from '@/lib/types';

const TARGET_LABELS: Record<AppealTargetType, string> = {
  vendor: 'Vendor',
  review: 'Ulasan',
  chat_message: 'Pesan chat',
  vendor_media: 'Media vendor'
};

const STATUS_META: Record<AppealStatus, { label: string; tone: BadgeTone }> = {
  pending: { label: 'Menunggu', tone: 'primary' },
  accepted: { label: 'Diterima', tone: 'ok' },
  rejected: { label: 'Ditolak', tone: 'muted' }
};

const FILTERS: Array<{ value: AppealStatus | 'all'; label: string }> = [
  { value: 'pending', label: 'Menunggu keputusan' },
  { value: 'accepted', label: 'Diterima' },
  { value: 'rejected', label: 'Ditolak' },
  { value: 'all', label: 'Semua' }
];

const MIN_NOTE = 10;

function shortId(id: string): string {
  return id.slice(0, 8);
}

export function AppealsView() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AppealStatus | 'all'>('pending');
  const [selected, setSelected] = useState<ReportAppeal | null>(null);
  const [note, setNote] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [loadingEvidence, setLoadingEvidence] = useState(false);

  /**
   * Bukti berkas bersifat privat: byte diambil dengan token sesi lalu dibuka
   * sebagai object URL. URL dicabut setelah tab baru selesai memuat gambar.
   */
  async function openEvidence(appeal: ReportAppeal): Promise<void> {
    setEvidenceError(null);
    setLoadingEvidence(true);
    try {
      const blob = await getAppealEvidence(appeal.id);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      setEvidenceError(error instanceof Error ? error.message : 'Bukti tidak bisa dibuka.');
    } finally {
      setLoadingEvidence(false);
    }
  }

  const query = useQuery({
    queryKey: ['report-appeals', status],
    queryFn: () => getReportAppeals(status === 'all' ? {} : { status })
  });

  const mutation = useMutation({
    mutationFn: (input: { id: string; status: 'accepted' | 'rejected'; note: string }) =>
      resolveReportAppeal(input.id, { status: input.status, note: input.note }),
    onSuccess: (appeal) => {
      setSelected(null);
      setNote('');
      setToast(
        appeal.status === 'accepted'
          ? 'Banding diterima. Konten dipulihkan atau dikembalikan ke antrean moderasi.'
          : 'Banding ditolak. Takedown dipertahankan.'
      );
      void queryClient.invalidateQueries({ queryKey: ['report-appeals'] });
    },
    onError: (error) => {
      setToast(error instanceof Error ? error.message : 'Keputusan banding gagal disimpan.');
    }
  });

  function decide(decision: 'accepted' | 'rejected') {
    if (!selected || note.trim().length < MIN_NOTE) return;
    mutation.mutate({ id: selected.id, status: decision, note: note.trim() });
  }

  return (
    <div className="space-y-4">
      <Alert tone="info" title="Banding hanya untuk konten yang sudah diturunkan">
        Pemilik konten mengajukan banding maksimal 30 hari setelah keputusan. Menerima banding
        ulasan/pesan chat langsung memulihkan konten; media kembali ke antrean moderasi.
      </Alert>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-textSecondary">
          Tampilkan
          <select
            className={selectClass}
            value={status}
            onChange={(event) => setStatus(event.target.value as AppealStatus | 'all')}
          >
            {FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </select>
        </label>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
          icon={<RotateCw aria-hidden className={query.isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />}
        >
          Muat ulang
        </Button>
      </div>

      <Card>
        {query.isLoading ? (
          <TableSkeleton rows={5} />
        ) : query.isError ? (
          <ErrorState
            message={
              query.error instanceof Error
                ? query.error.message
                : 'Antrean banding tidak bisa dimuat. Periksa koneksi lalu coba lagi.'
            }
            onRetry={() => void query.refetch()}
            retrying={query.isFetching}
          />
        ) : (query.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            icon={<Gavel aria-hidden className="h-5 w-5" />}
            title="Tidak ada banding"
            description={
              status === 'pending'
                ? 'Semua banding sudah diputuskan. Banding baru akan muncul di sini.'
                : 'Belum ada banding pada filter ini.'
            }
          />
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeadCell>Target</TableHeadCell>
                <TableHeadCell>Alasan banding</TableHeadCell>
                <TableHeadCell>Diajukan</TableHeadCell>
                <TableHeadCell>Status</TableHeadCell>
                <TableHeadCell>
                  <span className="sr-only">Aksi</span>
                </TableHeadCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {query.data?.items.map((appeal) => (
                <TableRow key={appeal.id}>
                  <TableCell>
                    <span className="font-medium text-textMain">
                      {TARGET_LABELS[appeal.target_type]}
                    </span>
                    <span className="ml-2 text-[13px] text-textMuted">
                      laporan {shortId(appeal.report_id)}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[420px]">
                    <p className="line-clamp-2 text-sm text-textSecondary">{appeal.reason}</p>
                    {appeal.status !== 'pending' && appeal.decision_note ? (
                      <p className="mt-1 line-clamp-2 text-[13px] text-textMuted">
                        Catatan: {appeal.decision_note}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-textSecondary">
                    {formatDateTimeID(appeal.created_at)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={STATUS_META[appeal.status].tone}>
                      {STATUS_META[appeal.status].label}
                    </StatusBadge>
                  </TableCell>
                  <TableCell>
                    {appeal.status === 'pending' ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelected(appeal);
                          setNote('');
                        }}
                      >
                        Tinjau
                      </Button>
                    ) : (
                      <span className="text-[13px] text-textMuted">
                        {appeal.decided_at ? formatDateTimeID(appeal.decided_at) : '-'}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Modal
        open={selected !== null}
        onClose={() => {
          if (!mutation.isPending) setSelected(null);
        }}
        labelledBy="appeal-decision-title"
      >
        {selected ? (
          <div className="space-y-4">
            <div>
              <h2
                id="appeal-decision-title"
                className="text-xl font-semibold tracking-[-0.01em] text-textMain"
              >
                Putuskan banding
              </h2>
              <p className="mt-1 text-sm text-textSecondary">
                {TARGET_LABELS[selected.target_type]} · laporan {shortId(selected.report_id)}
              </p>
            </div>
            <div className="rounded-field border border-border bg-subtle px-4 py-3">
              <p className="text-sm font-semibold text-textMain">Alasan pemilik konten</p>
              <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-textSecondary">
                {selected.reason}
              </p>
              {selected.evidence_url ? (
                <a
                  href={selected.evidence_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-sm font-semibold text-accentInk underline underline-offset-2"
                >
                  Buka bukti
                </a>
              ) : null}
              {selected.has_evidence_file ? (
                <div className="mt-2">
                  <Button
                    variant="outline"
                    onClick={() => void openEvidence(selected)}
                    disabled={loadingEvidence}
                  >
                    {loadingEvidence ? 'Mengambil berkas…' : 'Lihat berkas bukti'}
                  </Button>
                  {evidenceError ? (
                    <p className="mt-1 text-[13px] text-danger">{evidenceError}</p>
                  ) : null}
                </div>
              ) : null}
              <p className="mt-2 text-[13px] text-textMuted">
                Keputusan laporan: {selected.report_resolution ?? '-'} ·{' '}
                {selected.report_resolved_at
                  ? formatDateTimeID(selected.report_resolved_at)
                  : 'waktu tidak tercatat'}
              </p>
            </div>

            <label className="block">
              <span className="text-sm font-medium text-textMain">
                Catatan keputusan (minimal {MIN_NOTE} karakter)
              </span>
              <textarea
                className={`${textareaClass} mt-1.5`}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Contoh: bukti kepemilikan valid, takedown keliru dan konten dipulihkan."
                maxLength={1000}
              />
              <span className="mt-1 block text-[13px] text-textMuted">
                {note.trim().length}/{1000} · catatan ini masuk audit dan dibaca pemilik konten.
              </span>
            </label>

            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setSelected(null)}
                disabled={mutation.isPending}
              >
                Batal
              </Button>
              <Button
                variant="danger"
                onClick={() => decide('rejected')}
                disabled={mutation.isPending || note.trim().length < MIN_NOTE}
              >
                Tolak banding
              </Button>
              <Button
                onClick={() => decide('accepted')}
                disabled={mutation.isPending || note.trim().length < MIN_NOTE}
              >
                Terima banding
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      {toast ? <Toast title={toast} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}
