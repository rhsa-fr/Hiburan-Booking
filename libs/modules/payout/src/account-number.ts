import { createHash } from 'node:crypto';
import { AppError } from '@tarlink/core/errors';

const MIN_DIGITS = 6;
const MAX_DIGITS = 20;

/** Strips spaces, dashes and dots; rejects anything that is not digits. */
export function normalizeAccountNumber(raw: string): string {
  const digits = raw.replace(/[\s.-]/g, '');
  if (!/^\d+$/.test(digits)) {
    throw new AppError('VALIDATION_ERROR', 'Nomor rekening hanya boleh berisi angka.');
  }
  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) {
    throw new AppError(
      'VALIDATION_ERROR',
      `Nomor rekening harus ${MIN_DIGITS}–${MAX_DIGITS} digit.`
    );
  }
  return digits;
}

/** `****` + the last four digits; safe to show in admin/mobile lists. */
export function maskAccountNumber(digits: string): string {
  return `****${digits.slice(-4)}`;
}

/** Stable hash used by the UNIQUE (vendor_id, account_number_hash) guard. */
export function hashAccountNumber(bankCode: string, digits: string): string {
  return createHash('sha256').update(`${bankCode}:${digits}`).digest('hex');
}
