/**
 * Money boundary for the admin slice (D-09).
 *
 * PostgreSQL stores every amount as BIGINT and `pg` hands it back as a string.
 * The panel's contract is a JSON `number`, so the only allowed conversion is
 * bigint -> number behind a `Number.MAX_SAFE_INTEGER` guard. No `parseFloat`,
 * no division, no arithmetic on `number`.
 */
import { AppError } from '@tarlink/core/errors';

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = -MAX_SAFE;

export type IdrLike = string | number | bigint;

/** Parses a DB/JSON amount into bigint. Rejects fractions and junk. */
export function toIdr(value: IdrLike | null | undefined, field: string): bigint {
  if (value === null || value === undefined) {
    throw new AppError('INTERNAL_ERROR', `${field} is missing`);
  }
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new AppError('INTERNAL_ERROR', `${field} must be a safe integer number`);
    }
    return BigInt(value);
  }
  if (!/^-?\d+$/.test(value)) {
    throw new AppError('INTERNAL_ERROR', `${field} is not an integer rupiah amount`);
  }
  return BigInt(value);
}

/** Serialises an amount for JSON, refusing values a JS number cannot hold. */
export function idrToJson(value: IdrLike | null | undefined, field: string): number {
  const amount = toIdr(value, field);
  if (amount > MAX_SAFE || amount < MIN_SAFE) {
    throw new AppError(
      'INTERNAL_ERROR',
      `${field} exceeds Number.MAX_SAFE_INTEGER and cannot be serialised as a number`
    );
  }
  return Number(amount);
}

/** Zero-tolerant variant for nullable SUM() results. */
export function idrOrZero(value: IdrLike | null | undefined, field: string): number {
  if (value === null || value === undefined) return 0;
  return idrToJson(value, field);
}

/** Sums amounts with bigint arithmetic, then guards the JSON conversion once. */
export function sumIdr(values: readonly (IdrLike | null | undefined)[], field: string): number {
  let total = 0n;
  for (const value of values) {
    if (value === null || value === undefined) continue;
    total += toIdr(value, field);
  }
  return idrToJson(total, field);
}

/**
 * Reads an integer from `platform_settings.value` (JSONB). Settings are counts
 * and basis points, never money with fractions, so anything non-integral is a
 * configuration bug and is rejected rather than silently truncated.
 */
export function settingInt(value: unknown, field: string, fallback: number): number {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new AppError('INTERNAL_ERROR', `${field} must be an integer`);
    }
    return value;
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  throw new AppError('INTERNAL_ERROR', `${field} must be an integer`);
}
