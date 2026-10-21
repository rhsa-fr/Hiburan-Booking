/**
 * Row -> wire mapping. Everything is explicit: no spread of DB rows and every
 * money value crosses the safe-integer guard in `money.ts`.
 */
import { AppError } from '@tarlink/core/errors';
import type { CalendarSlotRecord } from './calendar-plan';
import type {
  CalendarSession,
  CalendarSlotStatus,
  PackageRow,
  VendorDetail,
  VendorSummary,
  VendorVerificationStatus,
  VerifyVendorResult
} from './contracts';
import { idrToJson } from './money';
import type { CalendarSlotDbRow, PackageDbRow, VendorRow, VerifyRow } from './rows';

export function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError('INTERNAL_ERROR', 'database returned an invalid timestamp');
  }
  return date.toISOString();
}

export function toIsoRequired(value: Date | string): string {
  const iso = toIso(value);
  if (iso === null) throw new AppError('INTERNAL_ERROR', 'timestamp is missing');
  return iso;
}

const VERIFICATION_STATUSES: readonly VendorVerificationStatus[] = [
  'pending',
  'approved',
  'rejected',
  'suspended'
];

export function asVerificationStatus(value: string): VendorVerificationStatus {
  const found = VERIFICATION_STATUSES.find((status) => status === value);
  if (!found) throw new AppError('INTERNAL_ERROR', `unknown vendor verification status ${value}`);
  return found;
}

const CALENDAR_SESSIONS: readonly CalendarSession[] = ['day', 'night', 'full'];
const CALENDAR_SLOT_STATUSES: readonly CalendarSlotStatus[] = [
  'available',
  'blocked',
  'held',
  'booked'
];

export function mapVendorSummary(row: VendorRow): VendorSummary {
  return {
    id: row.id,
    slug: row.slug,
    display_name: row.display_name,
    verification_status: asVerificationStatus(row.verification_status),
    region_code: row.region_code,
    created_at: toIsoRequired(row.created_at)
  };
}

export function mapVendorDetail(row: VendorRow): VendorDetail {
  return {
    ...mapVendorSummary(row),
    legal_name: row.legal_name,
    description: row.description,
    base_address: row.base_address,
    service_radius_km: row.service_radius_km,
    free_radius_km: row.free_radius_km,
    transport_fee_per_km_idr: idrToJson(
      row.transport_fee_per_km_idr,
      'vendor.transport_fee_per_km_idr'
    ),
    min_dp_bp: row.min_dp_bp,
    is_active: row.is_active
  };
}

export function mapVerifyResult(row: VerifyRow): VerifyVendorResult {
  if (row.verification_status !== 'approved' && row.verification_status !== 'rejected') {
    throw new AppError(
      'INTERNAL_ERROR',
      `verification write returned unexpected status ${row.verification_status}`
    );
  }
  return {
    id: row.id,
    verification_status: row.verification_status,
    verified_at: toIso(row.verified_at),
    verified_by: row.verified_by
  };
}

export function mapPackage(row: PackageDbRow): PackageRow {
  return {
    id: row.id,
    vendor_id: row.vendor_id,
    name: row.name,
    duration_minutes: row.duration_minutes,
    base_price_idr: idrToJson(row.base_price_idr, 'package.base_price_idr'),
    description: row.description,
    is_active: row.is_active,
    created_at: toIsoRequired(row.created_at)
  };
}

export function mapCalendarSlot(row: CalendarSlotDbRow): CalendarSlotRecord {
  const session = CALENDAR_SESSIONS.find((value) => value === row.session);
  if (!session) throw new AppError('INTERNAL_ERROR', `unknown calendar session ${row.session}`);
  const status = CALENDAR_SLOT_STATUSES.find((value) => value === row.status);
  if (!status) throw new AppError('INTERNAL_ERROR', `unknown calendar slot status ${row.status}`);
  return { date: row.date, session, status };
}
