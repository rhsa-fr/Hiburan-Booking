'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Button, Input, Modal, Textarea } from '@/components/ui';
import { createVendor } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import type { VendorCreateInput, VendorCreateResult } from '@/lib/types';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REGION_CODE_PATTERN = /^\d{2,10}$/;

function digitsOnly(value: string): string {
  return value.replace(/[\s().-]/g, '');
}

export function AddVendorModal({
  open,
  onClose,
  onCreated
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (vendor: VendorCreateResult) => void;
}) {
  const [contact, setContact] = useState('');
  const [regionCode, setRegionCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [description, setDescription] = useState('');
  const [baseAddress, setBaseAddress] = useState('');
  const [touched, setTouched] = useState(false);

  const create = useMutation({
    mutationFn: (input: VendorCreateInput) => createVendor(input),
    onSuccess: (vendor) => {
      reset();
      onCreated(vendor);
    }
  });

  const contactValue = contact.trim();
  const isEmail = contactValue.includes('@');
  const contactError = !contactValue
    ? 'Isi email atau nomor HP pemilik.'
    : isEmail
      ? EMAIL_PATTERN.test(contactValue)
        ? null
        : 'Format email belum benar, mis. nama@contoh.id.'
      : /^\+?\d{8,16}$/.test(digitsOnly(contactValue))
        ? null
        : 'Nomor HP berisi 8–16 angka, mis. 081234567890.';
  const regionError = REGION_CODE_PATTERN.test(regionCode.trim())
    ? null
    : 'Isi kode wilayah BPS, mis. 3212.';
  const nameError = displayName.trim().length >= 2 ? null : 'Nama tampilan minimal 2 karakter.';

  const invalid = Boolean(contactError || regionError || nameError);

  function reset(): void {
    setContact('');
    setRegionCode('');
    setDisplayName('');
    setLegalName('');
    setDescription('');
    setBaseAddress('');
    setTouched(false);
    create.reset();
  }

  function close(): void {
    if (create.isPending) return;
    reset();
    onClose();
  }

  function submit(): void {
    setTouched(true);
    if (invalid) return;
    const input: VendorCreateInput = {
      region_code: regionCode.trim(),
      display_name: displayName.trim()
    };
    if (isEmail) {
      input.owner_email = contactValue;
    } else {
      input.owner_phone = digitsOnly(contactValue);
    }
    if (legalName.trim()) input.legal_name = legalName.trim();
    if (description.trim()) input.description = description.trim();
    if (baseAddress.trim()) input.base_address = baseAddress.trim();
    create.mutate(input);
  }

  const serverError = create.isError ? create.error.message : null;
  const errorTitle =
    create.error instanceof ApiError && create.error.status === 409
      ? 'Vendor belum bisa dibuat'
      : create.error instanceof ApiError && create.error.status === 400
        ? 'Data vendor belum bisa dipakai'
        : 'Vendor gagal dibuat';

  return (
    <Modal open={open} onClose={close} labelledBy="add-vendor-title" size="md">
      <h2 id="add-vendor-title" className="pr-10 text-xl font-bold tracking-[-0.01em]">
        Tambah vendor
      </h2>
      <p className="mt-1.5 text-base leading-relaxed text-textSecondary">
        Vendor baru selalu masuk dengan status <strong className="font-semibold text-textMain">menunggu verifikasi</strong>.
        Pemilik harus sudah punya akun Tarlink.
      </p>

      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        noValidate
      >
        <Input
          id="vendor-owner-contact"
          label="Email atau nomor HP pemilik"
          value={contact}
          onChange={(event) => setContact(event.target.value)}
          placeholder="nama@contoh.id atau 081234567890"
          autoComplete="off"
          hint="Cukup salah satu. Panel mendeteksi otomatis mana yang Anda isi."
          error={touched ? contactError : null}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            id="vendor-region-code"
            label="Kode wilayah (BPS)"
            value={regionCode}
            onChange={(event) => setRegionCode(event.target.value.replace(/[^\d]/g, ''))}
            placeholder="3212"
            inputMode="numeric"
            hint="Kode BPS, mis. 3212 untuk Kabupaten Indramayu."
            error={touched ? regionError : null}
          />
          <Input
            id="vendor-display-name"
            label="Nama tampilan"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Nama yang dilihat pelanggan"
            hint="Wajib. Boleh nama panggung atau nama usaha."
            error={touched ? nameError : null}
          />
        </div>

        <Input
          id="vendor-legal-name"
          label="Nama legal (opsional)"
          value={legalName}
          onChange={(event) => setLegalName(event.target.value)}
          placeholder="Sesuai KTP atau akta usaha"
        />

        <Textarea
          id="vendor-description"
          label="Deskripsi (opsional)"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Jenis pertunjukan, perlengkapan, area layanan…"
        />

        <Input
          id="vendor-base-address"
          label="Alamat markas (opsional)"
          value={baseAddress}
          onChange={(event) => setBaseAddress(event.target.value)}
          placeholder="Alamat lengkap atau patokan"
        />

        {serverError ? (
          <Alert tone="danger" title={errorTitle}>
            {serverError}
          </Alert>
        ) : null}

        <div className="sticky -bottom-5 z-10 -mx-5 -mb-5 mt-2 flex flex-col-reverse gap-2 border-t border-border bg-surface/95 px-5 py-4 backdrop-blur sm:-bottom-6 sm:-mx-6 sm:-mb-6 sm:flex-row sm:justify-end sm:px-6">
          <Button variant="outline" onClick={close} disabled={create.isPending}>
            Batal
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Menyimpan…' : 'Simpan vendor'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
