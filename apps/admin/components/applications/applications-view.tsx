'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Eye, FileText, IdCard, RotateCw, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Modal,
  PageHeader,
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
import { formatDateID } from '@/lib/format';
import { readSession } from '@/lib/session';
import {
  approveVendorApplication,
  getVendorApplications,
  openVendorApplicationKtp,
  rejectVendorApplication
} from '@/lib/vendor-applications';
import type { VendorApplication, VendorApplicationStatus } from '@/lib/vendor-applications';

const STATUS_TABS: TabItem[] = [
  { id: 'submitted', label: 'Menunggu' },
  { id: 'approved', label: 'Disetujui' },
  { id: 'rejected', label: 'Ditolak' }
];

function isSuperAdmin(): boolean {
  return (readSession()?.role ?? '').toLowerCase().includes('super');
}

function statusLabel(status: VendorApplicationStatus): string {
  switch (status) {
    case 'submitted':
      return 'Menunggu tinjauan';
    case 'approved':
      return 'Disetujui';
    case 'rejected':
      return 'Ditolak';
    default:
      return 'Draft';
  }
}

/** One compact line for the table; parts the API did not send are skipped. */
function vendorMetaLine(item: VendorApplication): string {
  const parts: string[] = [];
  if (item.category_name) parts.push(item.category_name);
  if (item.years_active != null) parts.push(`${item.years_active} thn`);
  if (item.personnel_count != null) parts.push(`${item.personnel_count} personel`);
  return parts.join(' · ');
}

/** Only plain https links become anchors; anything else stays inert text. */
function isHttpsUrl(value: string): boolean {
  return value.startsWith('https://') && value.length > 'https://'.length;
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-border py-2.5 sm:grid-cols-[180px_1fr] sm:gap-4">
      <dt className="text-sm font-medium text-textMuted">{label}</dt>
      <dd className="break-words text-sm leading-relaxed text-textMain">{children}</dd>
    </div>
  );
}

export function ApplicationsView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const statusParam = searchParams.get('status');
  const currentStatus: VendorApplicationStatus =
    statusParam === 'approved' || statusParam === 'rejected' ? statusParam : 'submitted';

  const [approveTarget, setApproveTarget] = useState<VendorApplication | null>(null);
  const [rejectTarget, setRejectTarget] = useState<VendorApplication | null>(null);
  const [detailTarget, setDetailTarget] = useState<VendorApplication | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [toastNotice, setToastNotice] = useState<string | null>(null);
  const superAdmin = isSuperAdmin();

  useEffect(() => {
    if (!toastNotice) return;
    const timer = setTimeout(() => setToastNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [toastNotice]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['vendor-applications', currentStatus],
    queryFn: () => getVendorApplications({ status: currentStatus, page: 1, page_size: 20 })
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => approveVendorApplication(id),
    onSuccess: () => {
      setApproveTarget(null);
      setToastNotice('Pengajuan disetujui; vendor dan peran vendor_owner dibuat.');
      void queryClient.invalidateQueries({ queryKey: ['vendor-applications'] });
    },
    onError: (err) => {
      setToastNotice(err instanceof Error ? err.message : 'Gagal menyetujui pengajuan.');
    }
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      rejectVendorApplication(id, note),
    onSuccess: () => {
      setRejectTarget(null);
      setRejectNote('');
      setToastNotice('Pengajuan ditolak.');
      void queryClient.invalidateQueries({ queryKey: ['vendor-applications'] });
    },
    onError: (err) => {
      setToastNotice(err instanceof Error ? err.message : 'Gagal menolak pengajuan.');
    }
  });

  function handleTabChange(tabId: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (tabId === 'submitted') params.delete('status');
    else params.set('status', tabId);
    const query = params.toString();
    setApproveTarget(null);
    setDetailTarget(null);
    router.replace(`${pathname}${query ? `?${query}` : ''}`);
  }

  async function handleOpenKtp(id: string) {
    try {
      await openVendorApplicationKtp(id);
    } catch (err) {
      setToastNotice(err instanceof Error ? err.message : 'KTP tidak bisa dibuka.');
    }
  }

  const items = data?.items ?? [];
  const pending = currentStatus === 'submitted';

  return (
    <div className="space-y-6">
      <p className="rounded-card border border-border bg-surface px-4 py-3 text-sm text-textSecondary">
        Keputusan approve/reject hanya untuk <strong>admin super</strong>. NIK tampil penuh
        untuk admin super dan tersamar untuk peran lain.
      </p>

      <Tabs
        items={STATUS_TABS}
        value={currentStatus}
        onChange={handleTabChange}
        ariaLabel="Pilih status pengajuan vendor"
      />

      {isLoading ? (
        <Card>
          <TableSkeleton rows={6} />
        </Card>
      ) : isError ? (
        <Card>
          <ErrorState
            title="Gagal memuat pengajuan vendor"
            message={
              error instanceof Error ? error.message : 'Terjadi kesalahan pada jaringan atau server.'
            }
            onRetry={() => void refetch()}
          />
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileText aria-hidden className="h-6 w-6 text-textMuted" />}
            title={
              pending
                ? 'Tidak ada pengajuan menunggu'
                : currentStatus === 'approved'
                  ? 'Belum ada pengajuan disetujui'
                  : 'Belum ada pengajuan ditolak'
            }
            description={
              pending
                ? 'Semua pengajuan vendor yang masuk sudah ditinjau.'
                : 'Daftar ini terisi setelah ada keputusan admin.'
            }
          />
        </Card>
      ) : (
        <Card>
          <Table label="Daftar pengajuan vendor">
            <TableHead>
              <TableRow>
                <TableHeadCell>Vendor</TableHeadCell>
                <TableHeadCell>NIK</TableHeadCell>
                <TableHeadCell>Wilayah</TableHeadCell>
                <TableHeadCell>Diajukan</TableHeadCell>
                <TableHeadCell align="right">{pending ? 'Aksi' : 'Status'}</TableHeadCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <span className="block font-semibold text-textMain">{item.display_name}</span>
                    <span className="block text-xs text-textMuted">{item.legal_name}</span>
                    <span className="mt-1 block max-w-[320px] text-xs leading-snug text-textSecondary">
                      {item.base_address}
                    </span>
                    {vendorMetaLine(item) ? (
                      <span className="mt-1 block text-xs text-textSecondary">
                        {vendorMetaLine(item)}
                      </span>
                    ) : null}
                    {item.form_version === 1 ? (
                      <span className="mt-1 block text-xs text-textMuted">Formulir lama</span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-sm text-textMain">{item.nik}</span>
                  </TableCell>
                  <TableCell>{item.region_code}</TableCell>
                  <TableCell>
                    <span className="block text-sm text-textMain">
                      {formatDateID(item.created_at)}
                    </span>
                    {item.review_note ? (
                      <span className="mt-1 block text-xs text-textMuted">
                        Catatan: {item.review_note}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell align="right">
                    {pending ? (
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          icon={<Eye aria-hidden className="h-4 w-4" />}
                          onClick={() => setDetailTarget(item)}
                        >
                          Detail
                        </Button>
                        {superAdmin ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              icon={<IdCard aria-hidden className="h-4 w-4" />}
                              onClick={() => void handleOpenKtp(item.id)}
                            >
                              KTP
                            </Button>
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
                          </>
                        ) : (
                          <span className="text-xs text-textMuted">
                            Butuh admin super
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <span className="text-sm text-textSecondary">
                          {statusLabel(item.status)}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          icon={<Eye aria-hidden className="h-4 w-4" />}
                          onClick={() => setDetailTarget(item)}
                        >
                          Detail
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Modal
        open={detailTarget !== null}
        onClose={() => setDetailTarget(null)}
        labelledBy="application-detail-title"
        size="md"
      >
        {detailTarget ? (
          <>
            <h2
              id="application-detail-title"
              className="pr-10 text-xl font-bold tracking-[-0.01em] text-textMain"
            >
              Detail pengajuan
            </h2>
            <p className="mt-2 text-base leading-relaxed text-textSecondary">
              {detailTarget.display_name} · {detailTarget.legal_name}
            </p>

            <dl className="mt-4">
              <DetailRow label="Kategori">
                {detailTarget.category_name ?? (
                  <span className="text-textMuted">Belum diisi</span>
                )}
              </DetailRow>
              <DetailRow label="Wilayah">{detailTarget.region_code}</DetailRow>
              <DetailRow label="Alamat">{detailTarget.base_address}</DetailRow>
              <DetailRow label="Tahun aktif">
                {detailTarget.years_active != null ? (
                  `${detailTarget.years_active} tahun`
                ) : (
                  <span className="text-textMuted">Belum diisi</span>
                )}
              </DetailRow>
              <DetailRow label="Jumlah personel">
                {detailTarget.personnel_count != null ? (
                  `${detailTarget.personnel_count} personel`
                ) : (
                  <span className="text-textMuted">Belum diisi</span>
                )}
              </DetailRow>
              <DetailRow label="Deskripsi">
                {detailTarget.description ?? (
                  <span className="text-textMuted">Belum diisi</span>
                )}
              </DetailRow>
              <DetailRow label="Peralatan">
                {detailTarget.equipment_summary ?? (
                  <span className="text-textMuted">Belum diisi</span>
                )}
              </DetailRow>
              <DetailRow label="Portofolio">
                {detailTarget.portfolio_url ? (
                  isHttpsUrl(detailTarget.portfolio_url) ? (
                    <a
                      href={detailTarget.portfolio_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all text-accentText underline underline-offset-2"
                    >
                      {detailTarget.portfolio_url}
                    </a>
                  ) : (
                    <span className="break-all">{detailTarget.portfolio_url}</span>
                  )
                ) : (
                  <span className="text-textMuted">Belum diisi</span>
                )}
              </DetailRow>
              <DetailRow label="Formulir">
                {detailTarget.form_version === 1 ? (
                  'Formulir lama (v1)'
                ) : detailTarget.form_version === 2 ? (
                  'Formulir bertahap (v2)'
                ) : (
                  <span className="text-textMuted">Tidak tersedia</span>
                )}
              </DetailRow>
              <DetailRow label="Ketentuan Mitra">
                {detailTarget.agreement_version != null ? (
                  `Versi ${detailTarget.agreement_version}`
                ) : (
                  <span className="text-textMuted">Belum dicatat</span>
                )}
              </DetailRow>
              {detailTarget.review_note ? (
                <DetailRow label="Catatan review">{detailTarget.review_note}</DetailRow>
              ) : null}
            </dl>

            <p className="mt-4 rounded-card border border-border bg-subtle px-3 py-2 text-xs leading-relaxed text-textMuted">
              NIK lengkap dan foto KTP hanya dapat dibuka admin super.
            </p>
          </>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={approveTarget !== null}
        onClose={() => setApproveTarget(null)}
        title="Setujui pengajuan vendor?"
        description={
          approveTarget
            ? `${approveTarget.display_name} akan dibuat sebagai vendor aktif dengan peran vendor_owner.`
            : undefined
        }
        confirmLabel="Setujui"
        tone="primary"
        pending={approveMutation.isPending}
        onConfirm={() => {
          if (approveTarget) approveMutation.mutate(approveTarget.id);
        }}
      />

      <Modal
        open={rejectTarget !== null}
        onClose={() => setRejectTarget(null)}
        labelledBy="reject-application-title"
        size="sm"
      >
        <h2
          id="reject-application-title"
          className="pr-10 text-xl font-bold tracking-[-0.01em] text-textMain"
        >
          Tolak pengajuan
        </h2>
        <p className="mt-2 text-base leading-relaxed text-textSecondary">
          {rejectTarget
            ? `${rejectTarget.display_name} tidak akan menjadi vendor. Catatan tampil di status pengajuan pemohon.`
            : ''}
        </p>
        <Textarea
          id="reject-note"
          label="Alasan penolakan"
          className="mt-4"
          value={rejectNote}
          onChange={(event) => setRejectNote(event.target.value)}
          placeholder="Contoh: foto KTP tidak terbaca."
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
            {rejectMutation.isPending ? 'Menolak...' : 'Tolak pengajuan'}
          </Button>
        </div>
      </Modal>

      {toastNotice ? (
        <Toast tone="info" title={toastNotice} onDismiss={() => setToastNotice(null)} />
      ) : null}
    </div>
  );
}
