/**
 * FR-126 — vendor earnings CSV export.
 *
 * Every money cell comes from the booking's `release` journal entry:
 *   GMV              = debit  `2100` escrow_liability_vendor
 *   komisi           = credit `4100` platform_revenue_commission
 *   biaya layanan    = credit `4110` platform_revenue_service_fee
 *   pendapatan vendor= credit `2120` vendor_payable
 * `clawback_idr` is the `2120` debit of a later `clawback_recognized` entry.
 *
 * The TOTAL row is the sum of those same cells, so the report reconciles to
 * the ledger by construction (PRD FR-126: selisih Rp 0). Nothing here
 * recomputes commission from booking columns.
 */
import { AppError } from '@tarlink/core/errors';
import { idrToJson, toIdr } from '@tarlink/modules/catalog';
import type { VendorEarningsExportRow } from './vendor-portal.repository';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/** A monthly report is the primary case; a year is the largest allowed span. */
export const EARNINGS_EXPORT_MAX_DAYS = 366;

/** Protects memory and the 60-second budget for 1.000 rows (FR-126). */
export const EARNINGS_EXPORT_MAX_ROWS = 5000;

export interface EarningsPeriod {
  from: string;
  to: string;
}

export interface EarningsTotals {
  gmv_idr: bigint;
  commission_idr: bigint;
  service_fee_idr: bigint;
  vendor_entitlement_idr: bigint;
  clawback_idr: bigint;
  net_vendor_idr: bigint;
  payout_idr: bigint;
}

export interface EarningsExportResult {
  filename: string;
  period: EarningsPeriod;
  row_count: number;
  /** Where the money cells came from; the panel/mobile shows this as-is. */
  source: 'release_journal';
  totals: {
    gmv_idr: number;
    commission_idr: number;
    service_fee_idr: number;
    vendor_entitlement_idr: number;
    clawback_idr: number;
    net_vendor_idr: number;
    payout_idr: number;
  };
  csv: string;
}

/**
 * WIB calendar date (`YYYY-MM-DD`) for an instant. The server may run in UTC,
 * but a vendor in Indonesia expects "this month" to start at 00:00 WIB.
 */
export function wibDateString(instant: Date): string {
  return new Date(instant.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

function parseIsoDate(value: string, field: string): Date {
  const match = ISO_DATE.exec(value);
  if (!match) {
    throw new AppError('VALIDATION_ERROR', `${field} harus berformat YYYY-MM-DD.`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new AppError('VALIDATION_ERROR', `${field} bukan tanggal yang valid.`);
  }
  return parsed;
}

function readDate(query: Record<string, unknown>, key: string): string | null {
  const raw = query[key];
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') {
    throw new AppError('VALIDATION_ERROR', `${key} harus berupa tanggal YYYY-MM-DD.`);
  }
  return raw.trim();
}

/**
 * Reads `from`/`to` from the query. Defaults to the current WIB month up to
 * today, which is the monthly report FR-064 expects.
 */
export function resolveEarningsPeriod(
  query: Record<string, unknown>,
  now: Date = new Date()
): EarningsPeriod {
  const today = wibDateString(now);
  const from = readDate(query, 'from') ?? `${today.slice(0, 7)}-01`;
  const to = readDate(query, 'to') ?? today;

  const fromDate = parseIsoDate(from, 'from');
  const toDate = parseIsoDate(to, 'to');
  if (fromDate.getTime() > toDate.getTime()) {
    throw new AppError('VALIDATION_ERROR', 'Tanggal awal tidak boleh setelah tanggal akhir.');
  }

  const days = Math.floor((toDate.getTime() - fromDate.getTime()) / DAY_MS) + 1;
  if (days > EARNINGS_EXPORT_MAX_DAYS) {
    throw new AppError(
      'VALIDATION_ERROR',
      `Rentang ekspor maksimal ${EARNINGS_EXPORT_MAX_DAYS} hari.`
    );
  }

  return { from, to };
}

function formatWibDate(value: Date | string): string {
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) {
    throw new AppError('INTERNAL_ERROR', 'Tanggal pencairan tidak valid.');
  }
  return wibDateString(instant);
}

function csvCell(value: string | number | null): string {
  if (value === null) return '';
  const text = String(value);
  // Spreadsheet apps evaluate a cell that starts with a formula marker even
  // when the field is quoted. Event titles are user input, so neutralize it.
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function sumEarnings(rows: VendorEarningsExportRow[]): EarningsTotals {
  const totals: EarningsTotals = {
    gmv_idr: 0n,
    commission_idr: 0n,
    service_fee_idr: 0n,
    vendor_entitlement_idr: 0n,
    clawback_idr: 0n,
    net_vendor_idr: 0n,
    payout_idr: 0n
  };

  for (const row of rows) {
    const entitlement = toIdr(row.vendor_entitlement_idr, 'earnings.vendor_entitlement_idr');
    const clawback = toIdr(row.clawback_idr, 'earnings.clawback_idr');
    totals.gmv_idr += toIdr(row.gmv_idr, 'earnings.gmv_idr');
    totals.commission_idr += toIdr(row.commission_idr, 'earnings.commission_idr');
    totals.service_fee_idr += toIdr(row.service_fee_idr, 'earnings.service_fee_idr');
    totals.vendor_entitlement_idr += entitlement;
    totals.clawback_idr += clawback;
    totals.net_vendor_idr += entitlement - clawback;
    if (row.payout_amount_idr !== null) {
      totals.payout_idr += toIdr(row.payout_amount_idr, 'earnings.payout_amount_idr');
    }
  }

  return totals;
}

const HEADER = [
  'tanggal_lepas',
  'kode_booking',
  'judul_acara',
  'tanggal_acara',
  'gmv_idr',
  'komisi_idr',
  'biaya_layanan_idr',
  'pendapatan_vendor_idr',
  'clawback_idr',
  'pendapatan_bersih_idr',
  'pencairan_idr',
  'status_pencairan',
  'tanggal_pencairan'
] as const;

/**
 * Renders the CSV with a UTF-8 BOM and CRLF line endings so Excel on Windows
 * opens Indonesian characters and columns without an import wizard.
 */
export function renderEarningsCsv(
  rows: VendorEarningsExportRow[],
  totals: EarningsTotals
): string {
  const lines: string[] = [HEADER.join(',')];

  for (const row of rows) {
    const entitlement = toIdr(row.vendor_entitlement_idr, 'earnings.vendor_entitlement_idr');
    const clawback = toIdr(row.clawback_idr, 'earnings.clawback_idr');
    lines.push(
      [
        formatWibDate(row.released_at),
        csvCell(row.code),
        csvCell(row.event_title),
        csvCell(row.event_start_date),
        toIdr(row.gmv_idr, 'earnings.gmv_idr').toString(),
        toIdr(row.commission_idr, 'earnings.commission_idr').toString(),
        toIdr(row.service_fee_idr, 'earnings.service_fee_idr').toString(),
        entitlement.toString(),
        clawback.toString(),
        (entitlement - clawback).toString(),
        row.payout_amount_idr === null
          ? ''
          : toIdr(row.payout_amount_idr, 'earnings.payout_amount_idr').toString(),
        csvCell(row.payout_status),
        row.payout_paid_at === null ? '' : formatWibDate(row.payout_paid_at)
      ].join(',')
    );
  }

  lines.push(
    [
      'TOTAL',
      '',
      '',
      '',
      totals.gmv_idr.toString(),
      totals.commission_idr.toString(),
      totals.service_fee_idr.toString(),
      totals.vendor_entitlement_idr.toString(),
      totals.clawback_idr.toString(),
      totals.net_vendor_idr.toString(),
      totals.payout_idr.toString(),
      '',
      ''
    ].join(',')
  );

  // A BOM keeps Excel from decoding the file as ANSI.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function buildEarningsExport(
  period: EarningsPeriod,
  rows: VendorEarningsExportRow[]
): EarningsExportResult {
  const totals = sumEarnings(rows);
  return {
    filename: `pendapatan-vendor-${period.from}_${period.to}.csv`,
    period,
    row_count: rows.length,
    source: 'release_journal',
    totals: {
      gmv_idr: idrToJson(totals.gmv_idr, 'earnings.gmv_idr'),
      commission_idr: idrToJson(totals.commission_idr, 'earnings.commission_idr'),
      service_fee_idr: idrToJson(totals.service_fee_idr, 'earnings.service_fee_idr'),
      vendor_entitlement_idr: idrToJson(
        totals.vendor_entitlement_idr,
        'earnings.vendor_entitlement_idr'
      ),
      clawback_idr: idrToJson(totals.clawback_idr, 'earnings.clawback_idr'),
      net_vendor_idr: idrToJson(totals.net_vendor_idr, 'earnings.net_vendor_idr'),
      payout_idr: idrToJson(totals.payout_idr, 'earnings.payout_idr')
    },
    csv: renderEarningsCsv(rows, totals)
  };
}
