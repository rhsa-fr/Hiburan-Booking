/**
 * Commission and payment-deadline rules.
 * Source of truth: PRD-v1.1 D-17, D-18 and TECH-DESIGN-v1.0 §1.1, §6.3.
 *
 * Commission base is `price_package_idr` (the package price only), NOT the
 * customer total: service fee and add-ons are not commissionable.
 *
 * tier1 = floor(min(base, threshold) * bp1 / 10000)
 * tier2 = floor(max(base - threshold, 0) * bp2 / 10000)
 * total = least(cap, greatest(min, tier1 + tier2))
 */
export interface CommissionConfig {
  bp1: number;
  threshold: bigint;
  bp2: number;
  min: bigint;
  cap: bigint;
}

export const DEFAULT_COMMISSION: CommissionConfig = {
  bp1: 1000,
  threshold: 10_000_000n,
  bp2: 500,
  min: 25_000n,
  cap: 7_500_000n
};

export interface CommissionBreakdown {
  tier1: bigint;
  tier2: bigint;
  total: bigint;
}

export function computeCommission(
  base: bigint,
  cfg: CommissionConfig = DEFAULT_COMMISSION
): CommissionBreakdown {
  if (base <= 0n) return { tier1: 0n, tier2: 0n, total: 0n };

  const bp1 = BigInt(cfg.bp1);
  const bp2 = BigInt(cfg.bp2);
  const capped = base < cfg.threshold ? base : cfg.threshold;
  const overflow = base > cfg.threshold ? base - cfg.threshold : 0n;

  const tier1 = (capped * bp1) / 10_000n;
  const tier2 = (overflow * bp2) / 10_000n;
  const raw = tier1 + tier2;
  const floored = raw < cfg.min ? cfg.min : raw;
  const total = floored > cfg.cap ? cfg.cap : floored;

  return { tier1, tier2, total };
}

/** D-18: 24h default, 48h for transactions >= Rp 10.000.000. */
export function paymentDeadlineHours(
  totalCustomerIdr: bigint,
  opts: { baseHours?: number; highValueHours?: number; highValueThreshold?: bigint } = {}
): number {
  const base = opts.baseHours ?? 24;
  const high = opts.highValueHours ?? 48;
  const threshold = opts.highValueThreshold ?? 10_000_000n;
  return totalCustomerIdr >= threshold ? high : base;
}

export function paymentDeadlineFrom(now: Date, totalCustomerIdr: bigint, opts?: Parameters<typeof paymentDeadlineHours>[1]): Date {
  const hours = paymentDeadlineHours(totalCustomerIdr, opts);
  return new Date(now.getTime() + hours * 60 * 60 * 1000);
}

/** FR-118 / D-05: auto-complete at scheduled_end + 3 days. */
export function autoCompleteAt(scheduledEndAt: Date): Date {
  return new Date(scheduledEndAt.getTime() + 3 * 24 * 60 * 60 * 1000);
}

/** Anchor for the dispute window: scheduled_end + 7 days (NOT completion + 7). */
export function disputeWindowEndsAt(scheduledEndAt: Date): Date {
  return new Date(scheduledEndAt.getTime() + 7 * 24 * 60 * 60 * 1000);
}

/** FR-122: post-release clawback claim window is 30 days from release. */
export function clawbackDeadline(releasedAt: Date): Date {
  return new Date(releasedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
}
