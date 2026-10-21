import type { CommissionConfig } from './types';

export interface CommissionBreakdown {
  base_idr: number;
  tier1_idr: number;
  tier2_idr: number;
  raw_total_idr: number;
  commission_idr: number;
  floor_applied: boolean;
  cap_applied: boolean;
  effective_bp: number;
}

/**
 * D-17 tiered commission. All arithmetic stays in integer rupiah and integer
 * basis points; `Math.floor` never rounds up so the platform can never take
 * more than the published rate.
 *
 *   tier1 = floor(min(base, threshold) * bp1 / 10000)
 *   tier2 = floor(max(base - threshold, 0) * bp2 / 10000)
 *   total = min(cap, max(min, tier1 + tier2))
 */
export function computeCommission(
  baseIdr: number,
  config: CommissionConfig
): CommissionBreakdown {
  const base = Math.max(0, Math.trunc(baseIdr));
  const threshold = Math.max(0, Math.trunc(config.threshold_idr));
  const bp1 = Math.max(0, Math.trunc(config.bp1));
  const bp2 = Math.max(0, Math.trunc(config.bp2));
  const min = Math.max(0, Math.trunc(config.min_idr));
  const cap = Math.max(0, Math.trunc(config.cap_idr));

  const tier1 = Math.floor((Math.min(base, threshold) * bp1) / 10000);
  const tier2 = Math.floor((Math.max(base - threshold, 0) * bp2) / 10000);
  const rawTotal = tier1 + tier2;
  const commission = Math.min(cap, Math.max(min, rawTotal));

  return {
    base_idr: base,
    tier1_idr: tier1,
    tier2_idr: tier2,
    raw_total_idr: rawTotal,
    commission_idr: commission,
    floor_applied: rawTotal < min,
    cap_applied: rawTotal > cap,
    effective_bp: base === 0 ? 0 : Math.round((commission * 10000) / base)
  };
}
