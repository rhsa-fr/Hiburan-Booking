'use client';

import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  KeyValue,
  Input,
  StatusBadge
} from '@/components/ui';
import { computeCommission } from '@/lib/commission';
import { formatIDR, formatPercentFromBp, parseIntInput } from '@/lib/format';
import type { PlatformSettings } from '@/lib/types';

const NUMERIC_KEYS = [
  'bp1',
  'threshold_idr',
  'bp2',
  'min_idr',
  'cap_idr',
  'service_fee_bp',
  'dp_min_bp',
  'payment_deadline_hours',
  'payment_deadline_hours_high_value',
  'payment_high_value_threshold_idr',
  'dispute_window_days',
  'bank_cooling_hours',
  'payout_min_idr',
  'approval_threshold_idr'
] as const;

type NumericKey = (typeof NUMERIC_KEYS)[number];
type Draft = Record<NumericKey, string>;

function toDraft(settings: PlatformSettings): Draft {
  return NUMERIC_KEYS.reduce((draft, key) => {
    draft[key] = String(settings[key]);
    return draft;
  }, {} as Draft);
}

function toSettings(draft: Draft): PlatformSettings {
  return NUMERIC_KEYS.reduce((settings, key) => {
    settings[key] = parseIntInput(draft[key]);
    return settings;
  }, {} as PlatformSettings);
}

export function SettingsForm({
  settings,
  saving,
  onSave
}: {
  settings: PlatformSettings;
  saving: boolean;
  onSave: (next: PlatformSettings) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(settings));
  const [examplePrice, setExamplePrice] = useState('40000000');

  const numeric = useMemo(() => toSettings(draft), [draft]);
  const example = computeCommission(parseIntInput(examplePrice), numeric);

  function update(key: NumericKey, value: string) {
    setDraft((previous) => ({ ...previous, [key]: value.replace(/\D/g, '') }));
  }

  const dirty = NUMERIC_KEYS.some((key) => parseIntInput(draft[key]) !== settings[key]);

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            title="D-17 · Komisi bertingkat"
            description="Komisi dihitung dari harga paket sebelum biaya layanan. Semua aritmetika memakai bilangan bulat rupiah dan basis point."
          />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Input
              id="set-bp1"
              label="Tarif tier-1 (basis point)"
              inputMode="numeric"
              value={draft.bp1}
              onChange={(event) => update('bp1', event.target.value)}
              hint={`${formatPercentFromBp(numeric.bp1, 2)} dari bagian nilai sampai ambang`}
            />
            <Input
              id="set-threshold"
              label="Ambang tier-1 ke tier-2 (Rp)"
              inputMode="numeric"
              value={draft.threshold_idr}
              onChange={(event) => update('threshold_idr', event.target.value)}
              hint={`${formatIDR(numeric.threshold_idr)}`}
            />
            <Input
              id="set-bp2"
              label="Tarif tier-2 (basis point)"
              inputMode="numeric"
              value={draft.bp2}
              onChange={(event) => update('bp2', event.target.value)}
              hint={`${formatPercentFromBp(numeric.bp2, 2)} dari bagian nilai di atas ambang`}
            />
            <Input
              id="set-min"
              label="Lantai komisi (Rp)"
              inputMode="numeric"
              value={draft.min_idr}
              onChange={(event) => update('min_idr', event.target.value)}
              hint={`${formatIDR(numeric.min_idr)} per booking`}
            />
            <Input
              id="set-cap"
              label="Batas maksimum komisi (Rp)"
              inputMode="numeric"
              value={draft.cap_idr}
              onChange={(event) => update('cap_idr', event.target.value)}
              hint={`${formatIDR(numeric.cap_idr)} per booking`}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Contoh perhitungan langsung"
            description="Ubah nilai di kiri dan lihat hasilnya berubah di sini. Tidak ada Pembulatan ke atas."
          />
          <CardBody className="space-y-4">
            <Input
              id="set-example-price"
              label="Harga paket contoh (Rp)"
              inputMode="numeric"
              value={examplePrice}
              onChange={(event) => setExamplePrice(event.target.value.replace(/\D/g, ''))}
              hint={`Harga paket ${formatIDR(example.base_idr)}`}
            />
            <KeyValue
              items={[
                {
                  label: 'Komisi tier-1',
                  value: formatIDR(example.tier1_idr),
                  hint: `(${formatPercentFromBp(numeric.bp1, 0)} s.d. ${formatIDR(
                    numeric.threshold_idr
                  )})`
                },
                {
                  label: 'Komisi tier-2',
                  value: formatIDR(example.tier2_idr),
                  hint: `(${formatPercentFromBp(numeric.bp2, 0)} di atas ambang)`
                },
                {
                  label: 'Total komisi platform',
                  value: formatIDR(example.commission_idr),
                  emphasis: true
                },
                {
                  label: 'Dana bersih vendor',
                  value: formatIDR(example.base_idr - example.commission_idr),
                  emphasis: true,
                  tone: 'ok'
                }
              ]}
            />
            <p className="text-sm leading-relaxed text-textSecondary">
              {formatIDR(example.tier1_idr)} + {formatIDR(example.tier2_idr)} ={' '}
              <span className="font-semibold text-textMain">{formatIDR(example.commission_idr)}</span>{' '}
              komisi platform (tarif efektif{' '}
              <span className="tnum font-semibold text-textMain">
                {formatPercentFromBp(example.effective_bp, 2)}
              </span>
              ).
              {example.floor_applied ? ' Lantai komisi sedang mengikat.' : ''}
              {example.cap_applied ? ' Batas maksimum komisi sedang mengikat.' : ''}
            </p>
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="D-18 · Batas bayar DP"
            description="Slot ditahan selama batas ini. Lewat batas, booking menjadi kedaluwarsa dan slot dilepas."
          />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Input
              id="set-deadline"
              label="Batas bayar default (jam)"
              inputMode="numeric"
              value={draft.payment_deadline_hours}
              onChange={(event) => update('payment_deadline_hours', event.target.value)}
              hint="Berlaku untuk booking di bawah ambang nilai tinggi"
            />
            <Input
              id="set-deadline-high"
              label="Batas bayar nilai tinggi (jam)"
              inputMode="numeric"
              value={draft.payment_deadline_hours_high_value}
              onChange={(event) =>
                update('payment_deadline_hours_high_value', event.target.value)
              }
              hint="Berlaku untuk transaksi besar"
            />
            <Input
              id="set-high-threshold"
              label="Ambang nilai tinggi (Rp)"
              inputMode="numeric"
              value={draft.payment_high_value_threshold_idr}
              onChange={(event) =>
                update('payment_high_value_threshold_idr', event.target.value)
              }
              hint={`Total tagihan ≥ ${formatIDR(numeric.payment_high_value_threshold_idr)}`}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Parameter lain"
            description="Biaya layanan, minimum DP, jendela sengketa, cooling rekening, dan ambang payout."
          />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Input
              id="set-service-fee"
              label="Biaya layanan pelanggan (basis point)"
              inputMode="numeric"
              value={draft.service_fee_bp}
              onChange={(event) => update('service_fee_bp', event.target.value)}
              hint={`${formatPercentFromBp(numeric.service_fee_bp, 2)} dari harga paket`}
            />
            <Input
              id="set-dp-min"
              label="Minimum DP (basis point)"
              inputMode="numeric"
              value={draft.dp_min_bp}
              onChange={(event) => update('dp_min_bp', event.target.value)}
              hint={`${formatPercentFromBp(numeric.dp_min_bp, 0)} dari harga paket`}
            />
            <Input
              id="set-dispute-window"
              label="Jendela sengketa (hari)"
              inputMode="numeric"
              value={draft.dispute_window_days}
              onChange={(event) => update('dispute_window_days', event.target.value)}
              hint="Setelah acara selesai"
            />
            <Input
              id="set-bank-cooling"
              label="Cooling rekening (jam)"
              inputMode="numeric"
              value={draft.bank_cooling_hours}
              onChange={(event) => update('bank_cooling_hours', event.target.value)}
              hint="Jeda sebelum rekening baru dipakai"
            />
            <Input
              id="set-payout-min"
              label="Minimum payout (Rp)"
              inputMode="numeric"
              value={draft.payout_min_idr}
              onChange={(event) => update('payout_min_idr', event.target.value)}
              hint={`${formatIDR(numeric.payout_min_idr)}`}
            />
            <Input
              id="set-approval"
              label="Ambang approval (Rp)"
              inputMode="numeric"
              value={draft.approval_threshold_idr}
              onChange={(event) => update('approval_threshold_idr', event.target.value)}
              hint={`${formatIDR(numeric.approval_threshold_idr)}`}
            />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-base font-semibold text-textMain">Simpan pengaturan</p>
            <p className="mt-0.5 text-sm text-textSecondary">
              Nilai baru berlaku untuk booking yang dibuat setelah disimpan. Booking yang sudah ada
              memakai komisi tersimpan saat accept.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {dirty ? (
              <StatusBadge tone="soft">Ada perubahan belum disimpan</StatusBadge>
            ) : (
              <StatusBadge tone="ok">Tersimpan</StatusBadge>
            )}
            <Button
              onClick={() => onSave(numeric)}
              disabled={saving || !dirty}
            >
              {saving ? 'Menyimpan…' : 'Simpan pengaturan'}
            </Button>
          </div>
        </CardBody>
      </Card>

      {numeric.min_idr > numeric.cap_idr ? (
        <Alert tone="danger" title="Lantai komisi lebih besar dari batas maksimum">
          Nilai ini akan ditolak server. Lantai harus lebih kecil atau sama dengan batas.
        </Alert>
      ) : null}
    </div>
  );
}
