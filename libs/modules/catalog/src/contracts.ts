/**
 * Wire contract for the catalog slice (vendors, packages, calendar).
 *
 * The admin panel is coded against these shapes: `POST /admin/vendors` returns
 * six keys, the `PATCH` response is the same six plus the mutable columns, and
 * every money field is a JSON `number` (see `money.ts` for the safe-integer
 * guard). Media fields were added additively; older clients ignore them.
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
  avatar_url: string | null;
  banner_url: string | null;
  photo_urls: string[];
  video_url: string | null;
}

/** One category assignment under `GET/PUT /admin/vendors/:id/categories`. */
export interface VendorCategoryAssignment {
  slug: string;
  name: string;
  is_primary: boolean;
}

export interface VendorCategoryList {
  vendor_id: string;
  items: VendorCategoryAssignment[];
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
  personnel_count: number | null;
  inclusions: string[];
  photo_url: string | null;
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

/* ------------------------------------------------------------ public catalog */

export type PublicVendorSort = 'rating' | 'price_asc' | 'name_asc';

/** `GET /vendors` query after validation; `null` means "no filter". */
export interface PublicVendorQuery {
  q: string | null;
  region: string | null;
  category: string | null;
  /** `YYYY-MM-DD`; only vendors with an explicit available slot that day. */
  date: string | null;
  session: CalendarSession | null;
  sort: PublicVendorSort;
  page: number;
  page_size: number;
}

/** One row of `GET /categories`. */
export interface PublicCategory {
  slug: string;
  name: string;
  sort_order: number;
}

export interface PublicCategoryList {
  items: PublicCategory[];
}

/** One row of `GET /vendors`. */
export interface PublicVendorCard {
  id: string;
  slug: string;
  display_name: string;
  region_code: string;
  region_name: string;
  base_address: string | null;
  description: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  photo_urls: string[];
  video_url: string | null;
  rating: number | null;
  rating_count: number;
  response_rate_bp: number | null;
  category_slug: string | null;
  category_name: string | null;
  min_dp_bp: number;
  starting_price_idr: number | null;
  package_count: number;
}

export interface PublicVendorList {
  items: PublicVendorCard[];
  total: number;
  page: number;
  page_size: number;
}

export interface PublicVendorLocation {
  lat: number;
  lng: number;
}

/** `GET /vendors/:idOrSlug` -> `vendor`. No KYC, legal-doc or commission fields. */
export interface PublicVendorProfileFields {
  id: string;
  slug: string;
  display_name: string;
  legal_name: string | null;
  description: string | null;
  region_code: string;
  region_name: string;
  base_address: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  photo_urls: string[];
  video_url: string | null;
  location: PublicVendorLocation | null;
  service_radius_km: number | null;
  transport_fee_per_km_idr: number;
  min_dp_bp: number;
  rating: number | null;
  rating_count: number;
  response_rate_bp: number | null;
  category_slug: string | null;
  category_name: string | null;
  whatsapp: string | null;
}

export interface PublicAddon {
  id: string;
  name: string;
  price_idr: number;
  unit: string;
  max_qty: number;
}

export interface PublicPackage {
  id: string;
  name: string;
  description: string | null;
  photo_url: string | null;
  duration_minutes: number;
  personnel_count: number | null;
  base_price_idr: number;
  inclusions: string[];
  addons: PublicAddon[];
}

export interface PublicVendorProfile {
  vendor: PublicVendorProfileFields;
  packages: PublicPackage[];
}

/** `GET /policies/:code`: the current (newest active) version of one policy. */
export interface PolicyDocument {
  id: string;
  code: string;
  version: number;
  body_hash: string;
  effective_from: string;
  body: Record<string, unknown>;
}
