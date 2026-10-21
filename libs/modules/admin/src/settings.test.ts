import { describe, expect, it } from 'vitest';
import { AppError } from '@tarlink/core/errors';
import {
  DEFAULT_SETTINGS,
  SETTING_KEYS,
  settingsFromRows,
  settingsToWrites,
  validateSettings
} from './settings';

describe('settingsFromRows', () => {
  it('falls back to the D-17/D-18 defaults when platform_settings is empty', () => {
    expect(settingsFromRows([])).toEqual(DEFAULT_SETTINGS);
  });

  it('reads JSONB numbers and keeps unrelated keys out of the contract', () => {
    const settings = settingsFromRows([
      { key: 'commission_bp', value: 1250 },
      { key: 'payment_deadline_hours', value: 36 },
      { key: 'gateway_fee_bp', value: 70 }
    ]);
    expect(settings.bp1).toBe(1250);
    expect(settings.payment_deadline_hours).toBe(36);
    expect(settings.cap_idr).toBe(DEFAULT_SETTINGS.cap_idr);
  });
});

describe('validateSettings', () => {
  const valid = { ...DEFAULT_SETTINGS };

  it('accepts the current defaults', () => {
    expect(validateSettings(valid)).toEqual(valid);
  });

  it('rejects basis points outside 0..5000 for commission', () => {
    expect(() => validateSettings({ ...valid, bp1: 5001 })).toThrow(AppError);
    expect(() => validateSettings({ ...valid, bp2: -1 })).toThrow(AppError);
  });

  it('rejects service fee / DP basis points above 10000', () => {
    expect(() => validateSettings({ ...valid, service_fee_bp: 10_001 })).toThrow(AppError);
    expect(() => validateSettings({ ...valid, dp_min_bp: 10_001 })).toThrow(AppError);
  });

  it('requires min commission <= cap', () => {
    expect(() => validateSettings({ ...valid, min_idr: 8_000_000, cap_idr: 7_500_000 })).toThrow(
      /tidak boleh melebihi/
    );
  });

  it('rejects a negative threshold or payout minimum', () => {
    expect(() => validateSettings({ ...valid, threshold_idr: -1 })).toThrow(AppError);
    expect(() => validateSettings({ ...valid, payout_min_idr: -1 })).toThrow(AppError);
  });

  it('enforces 1..72 hours on the deadline fields', () => {
    expect(() => validateSettings({ ...valid, payment_deadline_hours: 0 })).toThrow(AppError);
    expect(() => validateSettings({ ...valid, payment_deadline_hours: 73 })).toThrow(AppError);
    expect(() =>
      validateSettings({ ...valid, payment_deadline_hours_high_value: 73 })
    ).toThrow(AppError);
    expect(() => validateSettings({ ...valid, bank_cooling_hours: 0 })).toThrow(AppError);
  });

  it('rejects unknown keys instead of silently dropping them', () => {
    expect(() => validateSettings({ ...valid, commission_bp: 1000 })).toThrow(AppError);
  });

  it('rejects fractional money or basis points', () => {
    expect(() => validateSettings({ ...valid, bp1: 10.5 })).toThrow(AppError);
    expect(() => validateSettings({ ...valid, cap_idr: 1000.5 })).toThrow(AppError);
  });
});

describe('settingsToWrites', () => {
  it('maps every contract field to its platform_settings key', () => {
    const writes = settingsToWrites(DEFAULT_SETTINGS);
    expect(writes).toHaveLength(Object.keys(SETTING_KEYS).length);
    expect(writes.find((write) => write.key === 'commission_bp')?.value).toBe(1000);
    expect(writes.find((write) => write.key === 'payment_deadline_hours')?.value).toBe(24);
    expect(writes.every((write) => write.description.length > 0)).toBe(true);
  });
});
