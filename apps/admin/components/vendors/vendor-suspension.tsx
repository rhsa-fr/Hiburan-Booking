'use client';

import { useMutation } from '@tanstack/react-query';
import { Ban, RotateCcw, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  Input,
  KeyValue,
  Modal,
  Skeleton,
  StatusBadge,
  Textarea,
  toneForVerification,
  verificationLabel
} from '@/components/ui';
import { suspendVendor, unsuspendVendor } from '@/lib/api';
import { formatDateID } from '@/lib/format';
import type { SuspendVendorInput, Vendor } from '@/lib/types';
import type { VendorNotice } from './notice';

export function VendorSuspension({
  vendor,
  canSuspend,
  rolesReady,
  onNotify,
  onChanged
}: {
  vendor: Vendor;
  canSuspend: boolean;
  rolesReady: boolean;
  onNotify: (notice: VendorNotice) => void;
  onChanged: () => void;
}) {
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [unsuspendOpen, setUnsuspendOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [reasonTouched, setReasonTouched] = useState(false);

  const suspend = useMutation({
    mutationFn: (input: SuspendVendorInput) => suspendVendor(vendor.id, input),
    onSuccess: () => {
      onChanged();
      setSuspendOpen(false);
      setReason('');
      setNote('');
      setReasonTouched(false);
      suspend.reset();
      onNotify({
        tone: 'ok',
        title: 'Vendor ditangguhkan',
        description: 'Status vendor sekarang ditangguhkan. Listing disembunyikan dari katalog.'
      });
    }
  });

  const unsuspend = useMutation({
    mutationFn: () => unsuspendVendor(vendor.id),
    onSuccess: () => {
      onChanged();
      setUnsuspendOpen(false);
      unsuspend.reset();
      onNotify({
        tone: 'ok',
        title: 'Penangguhan dibatalkan',
        description: 'Vendor berhasil dipulihkan ke status terverifikasi.'
      });
    }
  });

  const isSuspended = vendor.verification_status === 'suspended';
  const isVerified = vendor.verification_status === 'verified';

  if (!isSuspended && !isVerified) {
    return null;
  }

  if (!rolesReady) {
    if (isSuspended) {
      return (
        <Card labelledBy="vendor-suspension-title">
          <CardHeader
            title={<span id="vendor-suspension-title">Penangguhan vendor</span>}
            description="Status penangguhan operasional vendor."
            icon={<ShieldAlert aria-hidden className="h-4 w-4" />}
          />
          <CardBody className="space-y-4">
            <Skeleton className="h-12 w-full" />
          </CardBody>
        </Card>
      );
    }
    return null;
  }

  // Non-super admins must not see action buttons. If vendor is verified and user cannot suspend,
  // do not render an empty card.
  if (isVerified && !canSuspend) {
    return null;
  }

  const trimmedReason = reason.trim();
  const reasonValid = trimmedReason.length >= 10 && trimmedReason.length <= 500;

  const reasonError = (() => {
    if (!reasonTouched && reason.length === 0) return null;
    if (trimmedReason.length === 0) return 'Alasan penangguhan wajib diisi.';
    if (trimmedReason.length < 10) return 'Alasan penangguhan minimal 10 karakter.';
    if (trimmedReason.length > 500) return 'Alasan penangguhan maksimal 500 karakter.';
    return null;
  })();

  return (
    <>
      <Card labelledBy="vendor-suspension-title">
        <CardHeader
          title={<span id="vendor-suspension-title">Penangguhan vendor</span>}
          description={
            isSuspended
              ? 'Status penangguhan operasional vendor.'
              : 'Hentikan sementara operasional vendor jika terjadi pelanggaran regulasi.'
          }
          icon={<ShieldAlert aria-hidden className="h-4 w-4" />}
          action={
            isSuspended ? (
              <StatusBadge tone={toneForVerification(vendor.verification_status)}>
                {verificationLabel(vendor.verification_status)}
              </StatusBadge>
            ) : null
          }
        />
        <CardBody className="space-y-4">
          {isSuspended ? (
            <>
              <Alert tone="danger" title="Vendor sedang ditangguhkan">
                Listing hilang dari katalog; pencairan payout baru dibekukan; booking berjalan tetap diselesaikan.
              </Alert>

              <KeyValue
                items={[
                  { label: 'Alasan penangguhan', value: vendor.suspension_reason ?? '—' },
                  ...(vendor.suspended_at
                    ? [{ label: 'Ditangguhkan pada', value: formatDateID(vendor.suspended_at) }]
                    : []),
                  ...(vendor.suspended_by
                    ? [{ label: 'Ditangguhkan oleh', value: vendor.suspended_by }]
                    : [])
                ]}
              />

              {canSuspend ? (
                <div className="flex items-center gap-3 pt-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      unsuspend.reset();
                      setUnsuspendOpen(true);
                    }}
                    icon={<RotateCcw aria-hidden className="h-4 w-4" />}
                  >
                    Batalkan penangguhan
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <p className="text-base leading-relaxed text-textSecondary">
                Penangguhan akan menyembunyikan vendor dari katalog dan membekukan pencairan payout baru. Booking berjalan tetap diselesaikan.
              </p>

              {canSuspend ? (
                <div className="flex items-center gap-3">
                  <Button
                    variant="danger"
                    onClick={() => {
                      suspend.reset();
                      setSuspendOpen(true);
                    }}
                    icon={<Ban aria-hidden className="h-4 w-4" />}
                  >
                    Tangguhkan vendor
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </CardBody>
      </Card>

      <Modal
        open={suspendOpen}
        onClose={() => {
          if (suspend.isPending) return;
          setSuspendOpen(false);
          suspend.reset();
        }}
        labelledBy="suspend-vendor-title"
        size="sm"
      >
        <h2 id="suspend-vendor-title" className="pr-10 text-xl font-bold tracking-[-0.01em] text-textMain">
          Tangguhkan vendor ini?
        </h2>
        <p className="mt-2 text-base leading-relaxed text-textSecondary">
          {vendor.display_name ?? vendor.name} akan ditangguhkan dari katalog dan operasional.
        </p>

        <Alert tone="danger" className="mt-4" title="Dampak penangguhan">
          Listing hilang dari katalog; pencairan payout baru dibekukan; booking berjalan tetap diselesaikan.
        </Alert>

        <div className="mt-4 space-y-4">
          <Textarea
            id="vendor-suspend-reason"
            label="Alasan penangguhan"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            onBlur={() => setReasonTouched(true)}
            hint={`Wajib diisi, antara 10 hingga 500 karakter (${trimmedReason.length}/500).`}
            error={reasonError}
            placeholder="Tuliskan alasan penangguhan vendor…"
            rows={3}
          />

          <Input
            id="vendor-suspend-note"
            label="Catatan internal (opsional)"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            hint="Catatan tambahan untuk tim internal jika diperlukan."
            placeholder="Catatan tambahan…"
          />
        </div>

        {suspend.isError ? (
          <Alert tone="danger" title="Penangguhan gagal" className="mt-4">
            {suspend.error.message}
          </Alert>
        ) : null}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            onClick={() => {
              setSuspendOpen(false);
              suspend.reset();
            }}
            disabled={suspend.isPending}
          >
            Batal
          </Button>
          <Button
            variant="danger"
            disabled={suspend.isPending || !reasonValid}
            onClick={() => {
              setReasonTouched(true);
              if (!reasonValid) return;
              suspend.mutate({
                reason: trimmedReason,
                ...(note.trim() ? { note: note.trim() } : {})
              });
            }}
          >
            {suspend.isPending ? 'Menyimpan…' : 'Tangguhkan vendor'}
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={unsuspendOpen}
        onClose={() => {
          if (unsuspend.isPending) return;
          setUnsuspendOpen(false);
          unsuspend.reset();
        }}
        title="Batalkan penangguhan vendor?"
        description={`${vendor.display_name ?? vendor.name} akan dipulihkan statusnya menjadi terverifikasi.`}
        consequence="Vendor akan kembali muncul di katalog publik dan pencairan payout akan diaktifkan kembali."
        confirmLabel={unsuspend.isPending ? 'Memulihkan…' : 'Ya, batalkan penangguhan'}
        cancelLabel="Batal"
        tone="primary"
        pending={unsuspend.isPending}
        error={unsuspend.isError ? unsuspend.error.message : null}
        onConfirm={() => unsuspend.mutate()}
        labelledBy="unsuspend-vendor-title"
      />
    </>
  );
}
