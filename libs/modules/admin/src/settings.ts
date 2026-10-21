/**
 * `platform_settings` mapping and validation (D-17 commission, D-18 deadlines).
 *
 * The table is a generic key/value store; the admin panel exposes a flat
 * `PlatformSettings` object. The seed in TECH-DESIGN §11.3 is not part of
 * migration 002, so GET falls back to the documented defaults when a key is
 * absent and PUT upserts whatever the operator saves.
 */
import { AppError } from '@tarlink/core/errors';
import { z } from 'zod';
import type { PlatformSettings } from './contracts';
import { settingInt } from './money';
import type { SettingsRow } from './rows';

export const SETTING_KEYS: Readonly<Record<keyof PlatformSettings, string>> = {
  bp1: 'commission_bp',
  threshold_idr: 'commission_threshold_idr',
  bp2: 'commission_bp_tier2',
  min_idr: 'commission_min_idr',
  cap_idr: 'commission_cap_idr',
  service_fee_bp: 'service_fee_bp',
  dp_min_bp: 'dp_min_bp',
  payment_deadline_hours: 'payment_deadline_hours',
  payment_deadline_hours_high_value: 'payment_deadline_hours_high_value',
  payment_high_value_threshold_idr: 'payment_high_value_threshold_idr',
  dispute_window_days: 'dispute_window_days',
  bank_cooling_hours: 'bank_cooling_hours',
  payout_min_idr: 'payout_min_idr',
  approval_threshold_idr: 'approval_threshold_idr'
};

/** TECH-DESIGN §11.3 values; `payment_high_value_threshold_idr` mirrors D-18. */
export const DEFAULT_SETTINGS: PlatformSettings = {
  bp1: 1000,
  threshold_idr: 10_000_000,
  bp2: 500,
  min_idr: 25_000,
  cap_idr: 7_500_000,
  service_fee_bp: 100,
  dp_min_bp: 3000,
  payment_deadline_hours: 24,
  payment_deadline_hours_high_value: 48,
  payment_high_value_threshold_idr: 10_000_000,
  dispute_window_days: 7,
  bank_cooling_hours: 24,
  payout_min_idr: 10_000,
  approval_threshold_idr: 1_000_000
};

const IS_PUBLIC: Readonly<Record<string, boolean>> = {
  commission_bp: true,
  commission_threshold_idr: true,
  commission_bp_tier2: true,
  commission_min_idr: true,
  commission_cap_idr: true,
  service_fee_bp: true,
  dp_min_bp: true,
  payment_deadline_hours: false,
  payment_deadline_hours_high_value: false,
  payment_high_value_threshold_idr: false,
  dispute_window_days: false,
  bank_cooling_hours: false,
  payout_min_idr: true,
  approval_threshold_idr: false
};

const DESCRIPTIONS: Readonly<Record<string, string>> = {
  commission_bp: 'Komisi tier-1 (basis point) — D-17',
  commission_threshold_idr: 'Ambang tier-1/tier-2 komisi — D-17',
  commission_bp_tier2: 'Komisi tier-2 (basis point) di atas ambang — D-17',
  commission_min_idr: 'Lantai komisi per booking — D-17',
  commission_cap_idr: 'Batas absolut komisi per booking — D-17',
  service_fee_bp: 'Biaya layanan pelanggan (basis point) — D-17',
  dp_min_bp: 'DP minimum (basis point) dari harga paket',
  payment_deadline_hours: 'Batas bayar DP default dalam jam — D-18',
  payment_deadline_hours_high_value: 'Batas bayar DP untuk transaksi nilai tinggi — D-18',
  payment_high_value_threshold_idr: 'Ambang transaksi nilai tinggi — D-18',
  dispute_window_days: 'Jendela sengketa pra-pencairan dalam hari',
  bank_cooling_hours: 'Cooling rekening bank baru dalam jam',
  payout_min_idr: 'Minimum payout',
  approval_threshold_idr: 'Ambang maker-checker'
};

export function settingsFromRows(rows: readonly SettingsRow[]): PlatformSettings {
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const read = (field: keyof PlatformSettings): number =>
    settingInt(
      byKey.get(SETTING_KEYS[field]),
      SETTING_KEYS[field],
      DEFAULT_SETTINGS[field]
    );

  return {
    bp1: read('bp1'),
    threshold_idr: read('threshold_idr'),
    bp2: read('bp2'),
    min_idr: read('min_idr'),
    cap_idr: read('cap_idr'),
    service_fee_bp: read('service_fee_bp'),
    dp_min_bp: read('dp_min_bp'),
    payment_deadline_hours: read('payment_deadline_hours'),
    payment_deadline_hours_high_value: read('payment_deadline_hours_high_value'),
    payment_high_value_threshold_idr: read('payment_high_value_threshold_idr'),
    dispute_window_days: read('dispute_window_days'),
    bank_cooling_hours: read('bank_cooling_hours'),
    payout_min_idr: read('payout_min_idr'),
    approval_threshold_idr: read('approval_threshold_idr')
  };
}

const intIn = (min: number, max: number): z.ZodNumber =>
  z.number().int().min(min).max(max);

const SettingsSchema = z
  .object({
    bp1: intIn(0, 5000),
    threshold_idr: z.number().int().min(0),
    bp2: intIn(0, 5000),
    min_idr: z.number().int().min(0),
    cap_idr: z.number().int().min(0),
    service_fee_bp: intIn(0, 10_000),
    dp_min_bp: intIn(0, 10_000),
    payment_deadline_hours: intIn(1, 72),
    payment_deadline_hours_high_value: intIn(1, 72),
    payment_high_value_threshold_idr: z.number().int().min(0),
    dispute_window_days: intIn(1, 90),
    bank_cooling_hours: intIn(1, 72),
    payout_min_idr: z.number().int().min(0),
    approval_threshold_idr: z.number().int().min(0)
  })
  .strict();

/** Validates the full settings object. Partial updates are deliberately not
 *  accepted: the panel always PUTs the complete form. */
export function validateSettings(input: unknown): PlatformSettings {
  const parsed = SettingsSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Pengaturan platform tidak valid', parsed.error.issues);
  }
  if (parsed.data.min_idr > parsed.data.cap_idr) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Komisi minimum tidak boleh melebihi batas maksimum komisi.'
    );
  }
  return parsed.data;
}

export interface SettingWrite {
  key: string;
  value: number;
  isPublic: boolean;
  description: string;
}

export function settingsToWrites(settings: PlatformSettings): SettingWrite[] {
  return (Object.keys(SETTING_KEYS) as Array<keyof PlatformSettings>).map((field) => {
    const key = SETTING_KEYS[field];
    return {
      key,
      value: settings[field],
      isPublic: IS_PUBLIC[key] ?? false,
      description: DESCRIPTIONS[key] ?? key
    };
  });
}
