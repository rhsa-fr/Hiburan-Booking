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
  /** Optional so older test fixtures without media columns stay valid. */
  avatar_url?: string | null;
  banner_url?: string | null;
  photo_urls?: string[] | null;
  video_url?: string | null;
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
  /** Optional so older test fixtures without the new columns stay valid. */
  personnel_count?: number | null;
  inclusions?: string[] | null;
  photo_url?: string | null;
};

export type CalendarSlotDbRow = {
  date: string;
  session: string;
  status: string;
};

export type UserIdRow = {
  id: string;
};

/** Categories assigned to one vendor, primary first. */
export type VendorCategoryDbRow = {
  slug: string;
  name: string;
  is_primary: boolean;
};

/** Category lookup during an assignment write. */
export type CategoryLookupRow = {
  id: number;
  slug: string;
  name: string;
  is_active: boolean;
};

/* ------------------------------------------------------------ public catalog */

export type PublicCategoryDbRow = {
  slug: string;
  name: string;
  sort_order: number;
};

export type PublicVendorListRow = {
  id: string;
  slug: string;
  display_name: string;
  region_code: string;
  region_name: string | null;
  base_address: string | null;
  description: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  photo_urls: string[] | null;
  video_url: string | null;
  rating_sum: number;
  rating_count: number;
  response_rate_bp: number | null;
  category_slug: string | null;
  category_name: string | null;
  min_dp_bp: number;
  /** NULL when the vendor has no active package. */
  starting_price_idr: string | null;
  package_count: number;
};

export type PublicVendorDetailRow = {
  id: string;
  slug: string;
  display_name: string;
  legal_name: string | null;
  description: string | null;
  region_code: string;
  region_name: string | null;
  base_address: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  photo_urls: string[] | null;
  video_url: string | null;
  /** `ST_Y(base_location::geometry)`; NULL when the vendor has no location. */
  lat: number | null;
  /** `ST_X(base_location::geometry)`; NULL when the vendor has no location. */
  lng: number | null;
  service_radius_km: number | null;
  transport_fee_per_km_idr: string;
  min_dp_bp: number;
  rating_sum: number;
  rating_count: number;
  response_rate_bp: number | null;
  category_slug: string | null;
  category_name: string | null;
  /** `users.phone` of the owner; NULL when absent. */
  whatsapp: string | null;
};

export type PublicPackageDbRow = {
  id: string;
  name: string;
  description: string | null;
  photo_url: string | null;
  duration_minutes: number;
  personnel_count: number | null;
  base_price_idr: string;
  inclusions?: string[] | null;
};

export type PublicAddonDbRow = {
  id: string;
  package_id: string;
  name: string;
  price_idr: string;
  unit: string;
  max_qty: number;
};

export type PolicyDbRow = {
  id: string;
  code: string;
  version: number;
  body_hash: string;
  effective_from: Date;
  body: Record<string, unknown>;
};
