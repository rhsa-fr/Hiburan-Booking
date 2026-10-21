import { describe, expect, it } from 'vitest';
import { computeServiceFee } from './booking.service';

describe('computeServiceFee (D-17: biaya layanan pelanggan 1%)', () => {
  it('takes 1% of the package price, floored to whole rupiah', () => {
    expect(computeServiceFee(4_000_000n)).toBe(40_000n);
    expect(computeServiceFee(5_000_000n)).toBe(50_000n);
    expect(computeServiceFee(750_000n)).toBe(7_500n);
    expect(computeServiceFee(40_000_000n)).toBe(400_000n);
  });

  it('floors fractions instead of rounding up', () => {
    expect(computeServiceFee(750_099n)).toBe(7_500n);
  });

  it('is zero for a zero or negative package price', () => {
    expect(computeServiceFee(0n)).toBe(0n);
    expect(computeServiceFee(-1n)).toBe(0n);
  });
});
