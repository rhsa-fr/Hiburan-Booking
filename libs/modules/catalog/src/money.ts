/**
 * Money boundary for the catalog slice (D-09).
 *
 * `packages.base_price_idr` and `vendors.transport_fee_per_km_idr` are BIGINT;
 * `pg` returns them as strings. The panel contract is a JSON `number`, so the
 * only allowed conversion is bigint -> number behind a `Number.MAX_SAFE_INTEGER`
 * guard. No `parseFloat`, no fractions, no arithmetic on `number`.
 *
 * Same rules as `libs/modules/admin/src/money.ts`; duplicated on purpose so
 * this module does not depend on the admin slice.
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
      throw new AppError('VALIDATION_ERROR', `${field} harus bilangan bulat rupiah yang aman`);
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

/** BIGINT parameter for `pg`: the driver accepts the decimal string verbatim. */
export function idrToPgParam(value: IdrLike, field: string): string {
  return toIdr(value, field).toString();
}
