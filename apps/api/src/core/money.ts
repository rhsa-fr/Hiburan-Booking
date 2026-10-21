/**
 * Money rules (TECH-DESIGN D-09):
 * - Every amount is an integer number of rupiah, stored as BIGINT in PostgreSQL.
 * - Never use floating point, never DECIMAL/NUMERIC as a column type.
 * - JavaScript must not do arithmetic on numbers above Number.MAX_SAFE_INTEGER
 *   for money; use bigint for any computation that could exceed 9e15 (it cannot
 *   in this product, but the helper keeps the discipline explicit).
 */
export type Rupiah = bigint;

export function toRupiah(value: bigint | number | string): Rupiah {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new Error('Rupiah must be an integer');
    return BigInt(value);
  }
  return BigInt(value);
}

/** Formats 4000000n -> "Rp 4.000.000" (id-ID, no decimals). */
export function formatRupiah(value: Rupiah): string {
  return `Rp ${value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

export function sumRupiah(values: readonly Rupiah[]): Rupiah {
  return values.reduce((acc, v) => acc + v, 0n);
}
