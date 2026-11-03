/**
 * Bank codes accepted for vendor payouts.
 *
 * These strings are sent to Midtrans Iris as `beneficiary_bank`, so they must
 * match Iris rather than any local naming convention. The mobile app keeps a
 * display copy in `apps/mobile/lib/features/vendor/vendor_banks.dart`.
 */
export interface SupportedBank {
  readonly code: string;
  readonly name: string;
}

export const SUPPORTED_BANKS: readonly SupportedBank[] = Object.freeze([
  { code: 'bca', name: 'BCA' },
  { code: 'bni', name: 'BNI' },
  { code: 'bri', name: 'BRI' },
  { code: 'mandiri', name: 'Mandiri' },
  { code: 'bsi', name: 'BSI' },
  { code: 'btn', name: 'BTN' },
  { code: 'cimb', name: 'CIMB Niaga' },
  { code: 'permata', name: 'Permata' },
  { code: 'danamon', name: 'Danamon' },
  { code: 'btpn', name: 'BTPN' },
  { code: 'maybank', name: 'Maybank' },
  { code: 'ocbc', name: 'OCBC' },
  { code: 'panin', name: 'Panin' },
  { code: 'mega', name: 'Bank Mega' },
  { code: 'bjb', name: 'BJB' },
  { code: 'sinarmas', name: 'Sinarmas' }
]);

export const SUPPORTED_BANK_CODES: readonly string[] = Object.freeze(
  SUPPORTED_BANKS.map((bank) => bank.code)
);

export function isSupportedBank(code: string): boolean {
  return SUPPORTED_BANK_CODES.includes(code);
}

export function bankDisplayName(code: string): string {
  return SUPPORTED_BANKS.find((bank) => bank.code === code)?.name ?? code.toUpperCase();
}
