/**
 * Deterministic formatters. No `Intl` here on purpose: the mock runs on the
 * server and in the browser, and these strings must match byte for byte to
 * avoid hydration drift. Money is always an integer amount of rupiah.
 */

import type { StatusAxis } from './types';

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
];

const MONTHS_LONG = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember'
];

function groupThousands(value: number): string {
  return Math.trunc(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function formatIDR(value: number): string {
  const negative = value < 0;
  return `${negative ? '-' : ''}Rp ${groupThousands(Math.abs(Math.trunc(value)))}`;
}

export function formatNumber(value: number): string {
  return groupThousands(value);
}

/** Basis points (10000 = 100%) rendered with up to two decimals. */
export function formatPercentFromBp(bp: number, decimals: 0 | 1 | 2 = 1): string {
  const safe = Math.max(0, Math.trunc(bp));
  const whole = Math.trunc(safe / 100);
  const fraction = safe % 100;
  if (decimals === 0 || fraction === 0) {
    return `${whole}%`;
  }
  const padded = fraction.toString().padStart(2, '0');
  const shown = decimals === 1 ? padded.slice(0, 1) : padded;
  return `${whole},${shown}%`;
}

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Reads a timestamp as WIB regardless of the machine timezone. */
function toWibDate(iso: string): Date {
  return new Date(new Date(iso).getTime() + WIB_OFFSET_MS);
}

function toDate(iso: string): Date {
  return toWibDate(iso);
}

export function formatDateID(iso: string): string {
  const date = toWibDate(iso);
  return `${date.getUTCDate()} ${MONTHS_SHORT[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** Label sumbu hari untuk grafik: "21 Okt". */
export function formatDayLabelID(iso: string): string {
  const date = toWibDate(iso);
  return `${date.getUTCDate()} ${MONTHS_SHORT[date.getUTCMonth()]}`;
}

export function formatDateLongID(iso: string): string {
  const date = toWibDate(iso);
  return `${date.getUTCDate()} ${MONTHS_LONG[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** Nama bulan untuk judul kalender: "Oktober 2026". */
export function formatMonthYearID(year: number, monthIndex: number): string {
  return `${MONTHS_LONG[monthIndex] ?? ''} ${year}`;
}

/** Tanggal panjang dari komponen tanggal kalender (YYYY-MM-DD). */
export function formatCalendarDayID(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map((part) => Number.parseInt(part, 10));
  if (!year || !month || !day) return isoDate;
  return `${day} ${MONTHS_LONG[month - 1] ?? ''} ${year}`;
}

export function formatTimeID(iso: string): string {
  const date = toWibDate(iso);
  const hours = date.getUTCHours().toString().padStart(2, '0');
  const minutes = date.getUTCMinutes().toString().padStart(2, '0');
  return `${hours}.${minutes}`;
}

export function formatDateTimeID(iso: string): string {
  return `${formatDateID(iso)} · ${formatTimeID(iso)}`;
}

export function daysBetween(fromIso: string, toIso: string): number {
  const from = toDate(fromIso).getTime();
  const to = toDate(toIso).getTime();
  return Math.floor((to - from) / 86_400_000);
}

export function addThousandsSeparatorOnInput(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 0) {
    return '';
  }
  return groupThousands(Number.parseInt(digits, 10));
}

export function parseIntInput(value: string): number {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 0) {
    return 0;
  }
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/* -------------------------------------------------------------------------- */
/* Label status dalam bahasa sehari-hari                                      */
/* -------------------------------------------------------------------------- */

export const LIFECYCLE_LABELS: Record<string, string> = {
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

export const PAYMENT_LABELS: Record<string, string> = {
  unpaid: 'Belum bayar',
  dp_paid: 'DP dibayar',
  fully_paid: 'Lunas',
  partially_refunded: 'Refund sebagian',
  refunded: 'Direfund'
};

export const SETTLEMENT_LABELS: Record<string, string> = {
  not_eligible: 'Belum layak',
  held: 'Ditahan',
  disputed: 'Sengketa',
  released: 'Dicairkan',
  clawed_back: 'Clawback'
};

export const AXIS_LABELS: Record<StatusAxis, string> = {
  lifecycle: 'Siklus booking',
  payment: 'Pembayaran',
  settlement: 'Pencairan'
};

export function statusLabel(axis: StatusAxis, value: string): string {
  if (axis === 'lifecycle') return LIFECYCLE_LABELS[value] ?? value;
  if (axis === 'payment') return PAYMENT_LABELS[value] ?? value;
  return SETTLEMENT_LABELS[value] ?? value;
}

export function axisLabel(axis: StatusAxis): string {
  return AXIS_LABELS[axis];
}

/**
 * Human distance from the fixed mock clock. Kept explicit so the seeded
 * dashboard never changes between renders.
 */
export function relativeFrom(nowIso: string, targetIso: string): string {
  const diffMs = toDate(targetIso).getTime() - toDate(nowIso).getTime();
  const past = diffMs < 0;
  const minutes = Math.round(Math.abs(diffMs) / 60_000);
  const label = (() => {
    if (minutes < 1) return 'baru saja';
    if (minutes < 60) return `${minutes} menit`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} jam`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days} hari`;
    return `${Math.round(days / 30)} bulan`;
  })();
  return past ? `lewat ${label}` : `dalam ${label}`;
}
