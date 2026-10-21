/**
 * Deterministic display labels. The panel renders these strings verbatim, so
 * they mirror `apps/admin/lib/format.ts` (Indonesian, no `Intl`, no locale
 * drift between requests).
 */
import type { PaymentStatus, StatusAxis } from './contracts';

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des'
] as const;

export const PAYMENT_MIX_ORDER: readonly PaymentStatus[] = [
  'unpaid',
  'dp_paid',
  'fully_paid',
  'partially_refunded',
  'refunded'
] as const;

export const LIFECYCLE_LABELS: Readonly<Record<string, string>> = {
  requested: 'Diminta',
  countered: 'Ditawar',
  accepted: 'Diterima',
  confirmed: 'Terkonfirmasi',
  in_progress: 'Berlangsung',
  completed: 'Selesai',
  cancelled: 'Dibatalkan',
  rejected: 'Ditolak',
  expired: 'Kedaluwarsa',
  no_show: 'Tidak hadir'
};

export const PAYMENT_LABELS: Readonly<Record<string, string>> = {
  unpaid: 'Belum bayar',
  dp_paid: 'DP dibayar',
  fully_paid: 'Lunas',
  partially_refunded: 'Refund sebagian',
  refunded: 'Direfund'
};

export const SETTLEMENT_LABELS: Readonly<Record<string, string>> = {
  not_eligible: 'Belum layak',
  held: 'Ditahan',
  disputed: 'Sengketa',
  released: 'Dicairkan',
  clawed_back: 'Clawback'
};

export function paymentLabel(status: PaymentStatus): string {
  return PAYMENT_LABELS[status] ?? status;
}

export function statusLabel(axis: StatusAxis, value: string): string {
  if (axis === 'lifecycle') return LIFECYCLE_LABELS[value] ?? value;
  if (axis === 'payment') return PAYMENT_LABELS[value] ?? value;
  return SETTLEMENT_LABELS[value] ?? value;
}

/** `escrow_liability_vendor` -> `Escrow Liability Vendor`. */
export function humanizeAccountName(name: string): string {
  return name
    .split('_')
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** `2026-10-21` (a WIB calendar day) -> `21 Okt`, matching the dashboard chart. */
export function dayLabel(isoDate: string): string {
  const [, month, day] = isoDate.split('-');
  const monthIndex = Number.parseInt(month ?? '', 10) - 1;
  const monthName = MONTHS_SHORT[monthIndex];
  if (!monthName || day === undefined) return isoDate;
  return `${Number.parseInt(day, 10)} ${monthName}`;
}

/** `1500000` -> `Rp 1.500.000`, matching the panel's `formatIDR`. */
export function formatIdr(value: number): string {
  const negative = value < 0;
  const digits = Math.abs(Math.trunc(value))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}Rp ${digits}`;
}
