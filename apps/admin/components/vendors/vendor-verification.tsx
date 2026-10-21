'use client';

import { useMutation } from '@tanstack/react-query';
import { Check, ShieldCheck, ShieldX } from 'lucide-react';
import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  DisabledAction,
  KeyValue,
  Modal,
  Skeleton,
  StatusBadge,
  Textarea,
  toneForVerification,
  verificationLabel
} from '@/components/ui';
import { verifyVendor } from '@/lib/api';
import { formatDateID } from '@/lib/format';
import type { Vendor, VendorVerifyInput } from '@/lib/types';
import type { VendorNotice } from './notice';

export function VendorVerification({
  vendor,
  canVerify,
  rolesReady,
  onNotify,
  onChanged
}: {
  vendor: Vendor;
  canVerify: boolean;
  rolesReady: boolean;
  onNotify: (notice: VendorNotice) => void;
  onChanged: () => void;
}) {
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [note, setNote] = useState('');
  const [noteTouched, setNoteTouched] = useState(false);

  const verify = useMutation({
    mutationFn: (input: VendorVerifyInput) => verifyVendor(vendor.id, input),
    onSuccess: (result, input) => {
      onChanged();
      setApproveOpen(false);
      setRejectOpen(false);
      setNote('');
      setNoteTouched(false);
      verify.reset();
      onNotify({
        tone: 'ok',
        title: input.decision === 'approve' ? 'Vendor disetujui' : 'Vendor ditolak',
        description:
          result.verification_status === 'verified'
            ? 'Status vendor sekarang terverifikasi dan tercatat di audit.'
            : 'Keputusan tercatat. Vendor bisa diperbaiki lalu diajukan ulang.'
      });
    }
  });

  const noteValid = note.trim().length >= 10;
  const busy = verify.isPending;
  const isVerified = vendor.verification_status === 'verified';

  const actions = (() => {
    if (!rolesReady) {
      return (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-2/3" />
        </div>
      );
    }

    if (!canVerify) {
      return (
        <DisabledAction
          label="Setujui atau tolak"
          reason="Hanya admin super yang boleh memutuskan verifikasi vendor."
          icon={ShieldCheck}
        />
      );
    }

    if (isVerified) {
      return (
        <Alert tone="ok" title="Sudah diverifikasi">
          Keputusan akhir sudah tercatat. Perubahan status berikutnya hanya lewat alur audit admin
          super.
        </Alert>
      );
    }

    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => {
            verify.reset();
            setApproveOpen(true);
          }}
          icon={<Check aria-hidden className="h-4 w-4" />}
        >
          Setujui
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            verify.reset();
            setRejectOpen(true);
          }}
          icon={<ShieldX aria-hidden className="h-4 w-4" />}
        >
          Tolak
        </Button>
      </div>
    );
  })();

  return (
    <Card labelledBy="vendor-verification-title">
      <CardHeader
        title={<span id="vendor-verification-title">Verifikasi vendor</span>}
        description="Keputusan akhir hanya untuk admin super. Setiap keputusan masuk jejak audit."
        icon={<ShieldCheck aria-hidden className="h-4 w-4" />}
        action={
          <StatusBadge tone={toneForVerification(vendor.verification_status)}>
            {verificationLabel(vendor.verification_status)}
          </StatusBadge>
        }
      />
      <CardBody className="space-y-4">
        {vendor.verification_status === 'rejected' && vendor.verification_note ? (
          <Alert tone="danger" title="Catatan penolakan sebelumnya">
            {vendor.verification_note}
          </Alert>
        ) : null}

        {vendor.verification_status === 'pending' ? (
          <p className="text-base leading-relaxed text-textSecondary">
            Vendor ini belum bisa menerima booking sampai diputuskan. Periksa kelengkapan profil
            dan rekening sebelum menyetujui.
          </p>
        ) : null}

        {actions}

        {vendor.verified_at ? (
          <KeyValue
            items={[
              { label: 'Diputuskan pada', value: formatDateID(vendor.verified_at) },
              {
                label: 'Diputuskan oleh',
                value: vendor.verified_by ?? '—'
              },
              ...(vendor.verification_note
                ? [{ label: 'Catatan', value: vendor.verification_note }]
                : [])
            ]}
          />
        ) : null}
      </CardBody>

      <ConfirmDialog
        open={approveOpen}
        onClose={() => setApproveOpen(false)}
        title="Setujui vendor ini?"
        description={`${vendor.display_name ?? vendor.name} akan berstatus terverifikasi.`}
        consequence="Vendor bisa menerima booking dan muncul di pencarian pelanggan. Keputusan ini tercatat di audit dan sulit dibatalkan."
        confirmLabel="Ya, setujui"
        tone="primary"
        pending={busy}
        error={verify.isError ? verify.error.message : null}
        onConfirm={() => verify.mutate({ decision: 'approve' })}
        labelledBy="approve-vendor-title"
      />

      <Modal
        open={rejectOpen}
        onClose={() => {
          if (busy) return;
          setRejectOpen(false);
          verify.reset();
        }}
        labelledBy="reject-vendor-title"
        size="sm"
      >
        <h2 id="reject-vendor-title" className="pr-10 text-xl font-bold tracking-[-0.01em]">
          Tolak vendor ini?
        </h2>
        <p className="mt-2 text-base leading-relaxed text-textSecondary">
          Vendor tidak bisa menerima booking sampai diperbaiki dan diajukan ulang.
        </p>

        <div className="mt-4">
          <Textarea
            id="vendor-reject-note"
            label="Alasan penolakan"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onBlur={() => setNoteTouched(true)}
            hint="Minimal 10 karakter. Catatan ini terlihat oleh operator lain."
            error={
              (noteTouched || note.length > 0) && !noteValid
                ? 'Tulis alasan minimal 10 karakter.'
                : null
            }
            placeholder="Contoh: foto KTP buram dan nama rekening tidak cocok."
          />
        </div>

        {verify.isError ? (
          <Alert tone="danger" title="Penolakan gagal" className="mt-4">
            {verify.error.message}
          </Alert>
        ) : null}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            onClick={() => {
              setRejectOpen(false);
              verify.reset();
            }}
            disabled={busy}
          >
            Batal
          </Button>
          <Button
            variant="danger"
            disabled={busy || !noteValid}
            onClick={() => {
              setNoteTouched(true);
              if (!noteValid) return;
              verify.mutate({ decision: 'reject', note: note.trim() });
            }}
          >
            {busy ? 'Menyimpan…' : 'Tolak vendor'}
          </Button>
        </div>
      </Modal>
    </Card>
  );
}
