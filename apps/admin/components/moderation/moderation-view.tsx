'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Image as ImageIcon, Play, RotateCw, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
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
  Textarea,
  Toast
} from '@/components/ui';
import type { TabItem } from '@/components/ui';
import { approveMedia, getMediaQueue, rejectMedia } from '@/lib/api';
import { formatDateID, formatDateTimeID } from '@/lib/format';
import type { AdminMediaItem, AdminMediaKind, AdminMediaStatus } from '@/lib/types';

const STATUS_TABS: TabItem[] = [
  { id: 'pending', label: 'Menunggu' },
  { id: 'approved', label: 'Disetujui' },
  { id: 'rejected', label: 'Ditolak' }
];

function kindLabel(kind: AdminMediaKind): string {
  switch (kind) {
    case 'avatar':
      return 'Avatar';
    case 'banner':
      return 'Banner';
    case 'gallery':
      return 'Galeri';
    case 'package_photo':
      return 'Foto paket';
    case 'video':
      return 'Video';
    default:
      return kind;
  }
}

function extractHost(rawUrl: string): string {
  if (!rawUrl) return '';
  try {
    const hasProtocol = rawUrl.startsWith('http://') || rawUrl.startsWith('https://');
    const parsed = new URL(hasProtocol ? rawUrl : `https://${rawUrl}`);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return rawUrl;
  }
}

function MediaThumbnail({
  url,
  alt,
  kind
}: {
  url: string;
  alt: string;
  kind?: AdminMediaKind;
}) {
  const [loadFailed, setLoadFailed] = useState(false);

  if (kind === 'video') {
    if (!url) {
      return (
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-field border border-border bg-subtle text-textMuted"
          title="Tautan video tidak tersedia"
        >
          <Play aria-hidden className="h-5 w-5" />
        </div>
      );
    }

    const host = extractHost(url);

    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-12 items-center gap-2 rounded-field border border-border bg-subtle px-2.5 text-xs text-textMain transition-colors hover:border-primary/40 hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        title={`Buka video (${url})`}
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-sm bg-primary/10 text-primary">
          <Play aria-hidden className="h-3.5 w-3.5 fill-current" />
        </span>
        <span className="flex min-w-0 flex-col text-left leading-tight">
          <span className="font-semibold text-textMain">Buka video</span>
          {host ? (
            <span className="max-w-[100px] truncate text-[11px] text-textSecondary" title={host}>
              {host}
            </span>
          ) : null}
        </span>
      </a>
    );
  }

  if (loadFailed || !url) {
    return (
      <div
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-field border border-border bg-subtle text-textMuted"
        title="Gambar tidak dapat dimuat"
      >
        <ImageIcon aria-hidden className="h-5 w-5" />
      </div>
    );
  }

  return (
    <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-field border border-border bg-subtle">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={alt}
        loading="lazy"
        onError={() => setLoadFailed(true)}
        className="h-full w-full object-cover"
      />
    </div>
  );
}

export function ModerationView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const statusParam = searchParams.get('status');
  const currentStatus: AdminMediaStatus =
    statusParam === 'approved' || statusParam === 'rejected' ? statusParam : 'pending';

  const [confirmApproveId, setConfirmApproveId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<AdminMediaItem | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [rejectTouched, setRejectTouched] = useState(false);
  const [toastNotice, setToastNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!toastNotice) return;
    const timer = setTimeout(() => setToastNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [toastNotice]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['media-queue', currentStatus],
    queryFn: () => getMediaQueue({ status: currentStatus, page: 1, page_size: 20 })
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => approveMedia(id),
    onSuccess: () => {
      setConfirmApproveId(null);
      setToastNotice('Media berhasil disetujui.');
      void queryClient.invalidateQueries({ queryKey: ['media-queue'] });
    },
    onError: (err) => {
      setToastNotice(err instanceof Error ? err.message : 'Gagal menyetujui media.');
    }
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => rejectMedia(id, note),
    onSuccess: () => {
      setRejectTarget(null);
      setRejectNote('');
      setRejectTouched(false);
      setToastNotice('Media berhasil ditolak.');
      void queryClient.invalidateQueries({ queryKey: ['media-queue'] });
    },
    onError: (err) => {
      setToastNotice(err instanceof Error ? err.message : 'Gagal menolak media.');
    }
  });

  function handleTabChange(tabId: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (tabId === 'pending') {
      params.delete('status');
    } else {
      params.set('status', tabId);
    }
    const query = params.toString();
    setConfirmApproveId(null);
    router.replace(`${pathname}${query ? `?${query}` : ''}`);
  }

  const items = data?.items ?? [];

  return (
    <div className="space-y-6">
      <Tabs
        items={STATUS_TABS}
        value={currentStatus}
        onChange={handleTabChange}
        ariaLabel="Pilih status moderasi media"
      />

      {isLoading ? (
        <Card>
          <TableSkeleton rows={6} />
        </Card>
      ) : isError ? (
        <Card>
          <ErrorState
            title="Gagal memuat antrean moderasi"
            message={error instanceof Error ? error.message : 'Terjadi kesalahan pada jaringan atau server.'}
            onRetry={() => void refetch()}
          />
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ImageIcon aria-hidden className="h-6 w-6 text-textMuted" />}
            title={
              currentStatus === 'pending'
                ? 'Tidak ada media menunggu tinjauan'
                : currentStatus === 'approved'
                  ? 'Tidak ada media disetujui'
                  : 'Tidak ada media ditolak'
            }
            description={
              currentStatus === 'pending'
                ? 'Semua media vendor yang masuk telah ditinjau.'
                : currentStatus === 'approved'
                  ? 'Belum ada media yang disetujui dalam daftar.'
                  : 'Belum ada media yang ditolak dalam daftar.'
            }
          />
        </Card>
      ) : (
        <Card>
          <Table label="Daftar antrean moderasi media">
            <TableHead>
              <TableRow>
                <TableHeadCell className="w-28">Media</TableHeadCell>
                <TableHeadCell>Tipe & Paket</TableHeadCell>
                <TableHeadCell>Vendor & Wilayah</TableHeadCell>
                <TableHeadCell>Pernyataan Lisensi</TableHeadCell>
                <TableHeadCell>Tanggal Diajukan</TableHeadCell>
                <TableHeadCell align="right">
                  {currentStatus === 'pending' ? 'Aksi' : 'Status'}
                </TableHeadCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <MediaThumbnail
                      url={item.url}
                      alt={`Media ${item.vendor_name}`}
                      kind={item.kind}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <span className="inline-flex">
                        <StatusBadge tone="soft">{kindLabel(item.kind)}</StatusBadge>
                      </span>
                      {item.package_name ? (
                        <span
                          className="max-w-[200px] truncate text-xs text-textSecondary"
                          title={`Paket: ${item.package_name}`}
                        >
                          Paket: {item.package_name}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-semibold text-textMain">{item.vendor_name}</span>
                      <span className="mt-0.5 text-xs text-textSecondary">
                        Wilayah: {item.vendor_region_code}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-[280px]">
                      <p
                        className="line-clamp-2 text-sm text-textSecondary"
                        title={item.license_statement ?? 'Tidak ada pernyataan lisensi'}
                      >
                        {item.license_statement || '-'}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="whitespace-nowrap text-sm text-textSecondary">
                      {formatDateTimeID(item.created_at)}
                    </span>
                  </TableCell>
                  <TableCell align="right">
                    {currentStatus === 'pending' ? (
                      <div className="flex items-center justify-end gap-2">
                        {confirmApproveId === item.id ? (
                          <div
                            className="flex items-center gap-1.5"
                            role="group"
                            aria-label="Konfirmasi persetujuan"
                          >
                            <Button
                              size="sm"
                              variant="primary"
                              disabled={approveMutation.isPending}
                              onClick={() => approveMutation.mutate(item.id)}
                            >
                              {approveMutation.isPending &&
                              approveMutation.variables === item.id
                                ? 'Menyimpan…'
                                : 'Ya, setujui'}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={approveMutation.isPending}
                              onClick={() => setConfirmApproveId(null)}
                            >
                              Batal
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setConfirmApproveId(item.id)}
                          >
                            Setujui
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => {
                            setConfirmApproveId(null);
                            setRejectTarget(item);
                            setRejectNote('');
                            setRejectTouched(false);
                          }}
                        >
                          Tolak
                        </Button>
                      </div>
                    ) : currentStatus === 'approved' ? (
                      <div className="flex flex-col items-end">
                        <StatusBadge tone="ok">Disetujui</StatusBadge>
                        {item.reviewed_at ? (
                          <span className="mt-1 text-xs text-textMuted">
                            Ditinjau: {formatDateID(item.reviewed_at)}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <div className="ml-auto flex max-w-[220px] flex-col items-end">
                        <StatusBadge tone="danger">Ditolak</StatusBadge>
                        {item.review_note ? (
                          <p
                            className="mt-1 line-clamp-2 text-right text-xs text-danger"
                            title={item.review_note}
                          >
                            Alasan: {item.review_note}
                          </p>
                        ) : null}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Modal Tolak Media */}
      <Modal
        open={rejectTarget !== null}
        onClose={() => {
          if (!rejectMutation.isPending) {
            setRejectTarget(null);
            setRejectNote('');
            setRejectTouched(false);
          }
        }}
        labelledBy="reject-media-dialog-title"
        size="sm"
      >
        <div className="space-y-4">
          <div>
            <h2
              id="reject-media-dialog-title"
              className="pr-10 text-xl font-bold tracking-[-0.01em] text-textMain"
            >
              Tolak Media
            </h2>
            <p className="mt-1 text-sm text-textSecondary">
              Tolak media dari vendor <strong>{rejectTarget?.vendor_name}</strong> (
              {rejectTarget ? kindLabel(rejectTarget.kind) : ''}).
            </p>
          </div>

          <Textarea
            id="reject-reason"
            label="Alasan Penolakan"
            maxLength={500}
            hint={
              <span className="flex items-start justify-between gap-2">
                <span>Minimal 5 karakter. Berikan penjelasan yang jelas agar vendor dapat memperbaikinya.</span>
                <span className="tnum shrink-0 text-textMuted">
                  {rejectNote.length}/500
                </span>
              </span>
            }
            error={
              rejectTouched && rejectNote.trim().length > 0 && rejectNote.trim().length < 5
                ? 'Alasan penolakan minimal 5 karakter.'
                : rejectTouched && rejectNote.trim().length === 0
                  ? 'Alasan penolakan wajib diisi.'
                  : null
            }
            value={rejectNote}
            onChange={(e) => {
              setRejectNote(e.target.value);
              if (!rejectTouched) setRejectTouched(true);
            }}
            placeholder="Misal: Foto buram atau tidak memenuhi standar lisensi."
            rows={3}
          />

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              onClick={() => {
                setRejectTarget(null);
                setRejectNote('');
                setRejectTouched(false);
              }}
              disabled={rejectMutation.isPending}
            >
              Batal
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (!rejectTarget) return;
                rejectMutation.mutate({ id: rejectTarget.id, note: rejectNote.trim() });
              }}
              disabled={rejectNote.trim().length < 5 || rejectMutation.isPending}
            >
              {rejectMutation.isPending ? 'Memproses…' : 'Tolak media'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Toast notifikasi */}
      {toastNotice ? (
        <Toast
          tone="ok"
          title={toastNotice}
          onDismiss={() => setToastNotice(null)}
        />
      ) : null}
    </div>
  );
}
