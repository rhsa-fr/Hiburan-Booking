/**
 * `pg` row shapes for the catalog slice. Money arrives as a string (BIGINT),
 * timestamps as `Date`, `INT` columns as `number`.
 *
 * These are the only types where SQL column names appear; mapping to the wire
 * contract happens in `mappers.ts`. Type aliases (not interfaces) so they stay
 * assignable to `pg`'s index-signature `QueryResultRow`.
 */

export type VendorRow = {
  id: string;
  slug: string;
  display_name: string;
  legal_name: string | null;
  description: string | null;
  base_address: string | null;
  region_code: string;
  verification_status: string;
  verification_note: string | null;
  service_radius_km: number | null;
  free_radius_km: number;
  transport_fee_per_km_idr: string;
  min_dp_bp: number;
  is_active: boolean;
  created_at: Date;
  verified_at: Date | null;
  verified_by: string | null;
};

export type VerifyRow = {
  id: string;
  verification_status: string;
  verification_note: string | null;
  verified_at: Date | null;
  verified_by: string | null;
};

export type PackageDbRow = {
  id: string;
  vendor_id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  base_price_idr: string;
  is_active: boolean;
  created_at: Date;
};

export type CalendarSlotDbRow = {
  date: string;
  session: string;
  status: string;
};

export type UserIdRow = {
  id: string;
};
