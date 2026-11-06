'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Scale, ShieldAlert } from 'lucide-react';
import {
  BlockSkeleton,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  KpiCard,
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
  TitleBlock
} from '@/components/ui';
import { getDisputes, resolveDispute } from '@/lib/api';
import { nowIso, relativeFrom } from '@/lib/clock';
import { formatDateTimeID, formatIDR } from '@/lib/format';
import type { DisputeRecord, ResolveDisputeInput } from '@/lib/types';

const DISPUTE_STATUS_LABELS: Record<string, string> = {
  open: 'Terbuka',
  resolved_to_vendor: 'Diputuskan ke vendor',
  resolved_refund: 'Diputuskan refund',
  resolved_clawback: 'Diputuskan clawback',
  rejected: 'Ditolak'
};

const DISPUTE_STATUS_TONES: Record<string, 'danger' | 'ok' | 'muted' | 'soft'> = {
  open: 'danger',
  resolved_to_vendor: 'ok',
  resolved_refund: 'soft',
  resolved_clawback: 'soft',
  rejected: 'muted'
};

export default function DisputesPage() {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['disputes'],
    queryFn: getDisputes
  });
  const [target, setTarget] = useState<DisputeRecord | null>(null);
  const [resolution, setResolution] = useState<ResolveDisputeInput['resolution']>('reject');
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function openResolve(dispute: DisputeRecord): void {
    setTarget(dispute);
    setResolution('reject');
    setNote('');
    setAmount('');
    setFormError(null);
  }

  async function submitResolve(): Promise<void> {
    if (!target) return;
    const trimmed = note.trim();
    if (trimmed.length < 10) {
      setFormError('Catatan putusan minimal 10 karakter.');
      return;
    }
    const numeric = Number(amount.replace(/[^\d]/g, ''));
    if (resolution === 'refund_partial' && (!Number.isInteger(numeric) || numeric <= 0)) {
      setFormError('Nominal refund sebagian harus lebih dari 0.');
      return;
    }

    setBusy(true);
    setFormError(null);
    try {
      await resolveDispute(target.id, {
        resolution,
        note: trimmed,
        ...(resolution === 'refund_partial' ? { amount_idr: numeric } : {})
      });
      setTarget(null);
      setNote('');
      setAmount('');
      await refetch();
    } catch (submitError) {
      setFormError(
        submitError instanceof Error ? submitError.message : 'Gagal menyimpan putusan sengketa.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Sengketa"
        description="Klaim yang masih menjadi milik platform sampai diputuskan. Dana pada booking yang bersengketa dibekukan."
      />

      {isLoading ? (
        <div className="space-y-4">
          <BlockSkeleton rows={3} />
          <Card>
            <TableSkeleton rows={4} />
          </Card>
        </div>
      ) : isError ? (
        <Card>
          <ErrorState
            message={
              error instanceof Error
                ? error.message
                : 'Daftar sengketa tidak bisa dimuat. Periksa koneksi lalu coba lagi.'
            }
            onRetry={() => void refetch()}
            retrying={isFetching}
          />
        </Card>
      ) : data ? (
        <div className="space-y-4">
          <StatGrid columns={2}>
            <KpiCard
              label="Sengketa terbuka"
              value={String(data.open_count)}
              note={data.open_count > 0 ? 'Dana dibekukan sampai diputuskan' : 'Tidak ada klaim aktif'}
              icon={<ShieldAlert className="h-5 w-5" />}
              tone={data.open_count > 0 ? 'danger' : 'ok'}
            />
            <KpiCard
              label="Nilai sengketa"
              value={formatIDR(data.total_idr)}
              note="Porsi pelanggan dan vendor"
              icon={<Scale className="h-5 w-5" />}
              tone="soft"
            />
          </StatGrid>

          <Card className="overflow-hidden">
            <CardHeader
              icon={<Scale aria-hidden className="h-[17px] w-[17px]" />}
              title="Daftar sengketa"
              description="Diurutkan dari yang paling baru dibuka."
            />
            {data.items.length === 0 ? (
              <EmptyState
                title="Tidak ada sengketa"
                description="Belum ada klaim yang masuk. Dana yang sedang ditahan akan muncul di sini."
                action={
                  <Button variant="outline" href="/bookings">
                    Lihat booking
                  </Button>
                }
              />
            ) : (
              <Table
                label="Daftar sengketa beserta alasan, batas SLA, dan pembagian dana"
                maxHeight="max-h-[65vh]"
                className="min-w-[960px]"
              >
                <TableHead>
                  <TableRow>
                    <TableHeadCell>Booking</TableHeadCell>
                    <TableHeadCell>Alasan</TableHeadCell>
                    <TableHeadCell>Status</TableHeadCell>
                    <TableHeadCell align="right">Pelanggan</TableHeadCell>
                    <TableHeadCell align="right">Vendor</TableHeadCell>
                    <TableHeadCell align="right">SLA</TableHeadCell>
                    <TableHeadCell align="right">Aksi</TableHeadCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.items.map((dispute) => (
                    <TableRow key={dispute.id}>
                      <TableCell>
                        <TitleBlock
                          title={dispute.booking_code}
                          subtitle={`${dispute.vendor_name} · ${dispute.city}`}
                        />
                      </TableCell>
                      <TableCell>
                        <p className="max-w-[320px] text-[15px] text-textMain">{dispute.reason}</p>
                        <p className="text-[13px] text-textSecondary">
                          Dibuka {formatDateTimeID(dispute.opened_at)}
                        </p>
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={DISPUTE_STATUS_TONES[dispute.status] ?? 'muted'}>
                          {DISPUTE_STATUS_LABELS[dispute.status] ?? dispute.status}
                        </StatusBadge>
                      </TableCell>
                      <TableCell align="right">
                        <span className="tnum whitespace-nowrap text-textMain">
                          {formatIDR(dispute.customer_share_idr)}
                        </span>
                      </TableCell>
                      <TableCell align="right">
                        <span className="tnum whitespace-nowrap text-textMain">
                          {formatIDR(dispute.vendor_share_idr)}
                        </span>
                      </TableCell>
                      <TableCell align="right">
                        <span
                          className={`whitespace-nowrap text-[13px] ${
                            dispute.status === 'open'
                              ? 'font-semibold text-danger'
                              : 'text-textSecondary'
                          }`}
                        >
                          {dispute.status === 'open'
                            ? relativeFrom(nowIso(), dispute.sla_due_at)
                            : 'Selesai'}
                        </span>
                      </TableCell>
                      <TableCell align="right">
                        {dispute.status === 'open' ? (
                          <Button variant="outline" size="sm" onClick={() => openResolve(dispute)}>
                            Putuskan
                          </Button>
                        ) : (
                          <span className="text-[13px] text-textSecondary">Selesai</span>
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

      {target ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Putusan sengketa ${target.booking_code}`}
            className="w-full max-w-lg rounded-card border border-border bg-surface p-5 shadow-xl"
          >
            <h2 className="text-[18px] font-semibold text-textMain">
              Putusan sengketa {target.booking_code}
            </h2>
            <p className="mt-1 text-[13px] text-textSecondary">{target.reason}</p>

            <label htmlFor="dispute-resolution" className="mt-4 block text-[13px] font-semibold text-textMain">
              Putusan
            </label>
            <select
              id="dispute-resolution"
              value={resolution}
              onChange={(event) =>
                setResolution(event.target.value as ResolveDisputeInput['resolution'])
              }
              className="mt-1 w-full rounded-field border border-border bg-surface px-3 py-2 text-[14px] text-textMain"
            >
              <option value="reject">Tolak klaim</option>
              <option value="release_to_vendor">Lepas dana ke vendor</option>
              <option value="refund_full">Refund penuh</option>
              <option value="refund_partial">Refund sebagian</option>
            </select>

            {resolution === 'refund_partial' ? (
              <>
                <label htmlFor="dispute-amount" className="mt-3 block text-[13px] font-semibold text-textMain">
                  Nominal refund (Rp)
                </label>
                <input
                  id="dispute-amount"
                  inputMode="numeric"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="Contoh: 500000"
                  className="mt-1 w-full rounded-field border border-border bg-surface px-3 py-2 text-[14px] text-textMain"
                />
              </>
            ) : null}

            <label htmlFor="dispute-note" className="mt-3 block text-[13px] font-semibold text-textMain">
              Catatan putusan (min. 10 karakter)
            </label>
            <textarea
              id="dispute-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={4}
              className="mt-1 w-full rounded-field border border-border bg-surface px-3 py-2 text-[14px] text-textMain"
              placeholder="Alasan putusan dan bukti yang dipertimbangkan."
            />

            {formError ? <p className="mt-2 text-[13px] text-danger">{formError}</p> : null}

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setTarget(null)} disabled={busy}>
                Batal
              </Button>
              <Button onClick={() => void submitResolve()} disabled={busy}>
                {busy ? 'Menyimpan…' : 'Simpan putusan'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
