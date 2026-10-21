/**
 * Wire contract for the catalog slice (vendors, packages, calendar).
 *
 * The admin panel is coded against exactly these shapes, so they are declared
 * once here and never widened: `POST /admin/vendors` returns six keys, the
 * `PATCH` response is the same six plus the mutable columns, and every money
 * field is a JSON `number` (see `money.ts` for the safe-integer guard).
 */

export type VendorVerificationStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

/** `POST /admin/vendors` response. */
export interface VendorSummary {
  id: string;
  slug: string;
  display_name: string;
  verification_status: VendorVerificationStatus;
  region_code: string;
  created_at: string;
}

/** `PATCH /admin/vendors/:id` response: summary + every mutable column. */
export interface VendorDetail extends VendorSummary {
  legal_name: string | null;
  description: string | null;
  base_address: string | null;
  service_radius_km: number | null;
  free_radius_km: number;
  transport_fee_per_km_idr: number;
  min_dp_bp: number;
  is_active: boolean;
}

export type VendorDecision = 'approve' | 'reject';

/** `POST /admin/vendors/:id/verify` response. */
export interface VerifyVendorResult {
  id: string;
  verification_status: 'approved' | 'rejected';
  verified_at: string | null;
  verified_by: string | null;
}

/** One row of the `packages` table as the panel consumes it. */
export interface PackageRow {
  id: string;
  vendor_id: string;
  name: string;
  duration_minutes: number;
  base_price_idr: number;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

export interface PackageList {
  items: PackageRow[];
}

export type CalendarSession = 'day' | 'night' | 'full';
export type CalendarSlotStatus = 'available' | 'blocked' | 'held' | 'booked';

/** A missing `calendar_slots` row is `unconfirmed`, never `available` (D-10). */
export type CalendarViewStatus = CalendarSlotStatus | 'unconfirmed';

export interface CalendarDay {
  date: string;
  session: CalendarSession;
  status: CalendarViewStatus;
}

export interface CalendarDays {
  days: CalendarDay[];
}

export interface CalendarWriteResult {
  updated: number;
}
