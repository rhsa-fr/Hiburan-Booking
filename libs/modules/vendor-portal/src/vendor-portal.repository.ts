import { Injectable } from '@nestjs/common';
import { query } from '@tarlink/core/db';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export interface VendorPortalVendorRow {
  id: string;
  display_name: string;
  slug: string;
  region_code: string;
  verification_status: string;
  is_active: boolean;
  calendar_updated_at: Date | string | null;
  legal_name: string | null;
  description: string | null;
  base_address: string | null;
  service_radius_km: number | null;
  free_radius_km: number;
  transport_fee_per_km_idr: string;
  min_dp_bp: number;
  avatar_url: string | null;
  banner_url: string | null;
  photo_urls: string[] | null;
  video_url: string | null;
  whatsapp: string | null;
}

export interface VendorProfileUpdateInput {
  display_name?: string;
  legal_name?: string | null;
  description?: string | null;
  base_address?: string | null;
  service_radius_km?: number | null;
  free_radius_km?: number;
  /** BIGINT as a decimal string. */
  transport_fee_per_km_idr?: string;
  min_dp_bp?: number;
  avatar_url?: string | null;
  banner_url?: string | null;
  photo_urls?: string[];
  video_url?: string | null;
}

export interface VendorBookingListItemRow {
  id: string;
  code: string;
  lifecycle_status: string;
  payment_status: string;
  settlement_status: string;
  total_customer_idr: string;
  dp_amount_idr: string;
  vendor_entitlement_idr: string;
  respond_deadline: Date | string;
  created_at: Date | string;
  event_title: string;
  event_start_date: string;
  event_region_code: string;
  customer_phone: string | null;
  customer_name: string;
  total_count: number;
}

export interface VendorBookingDetailRow {
  id: string;
  code: string;
  customer_id: string;
  vendor_id: string;
  event_id: string;
  package_id: string;
  lifecycle_status: string;
  payment_status: string;
  settlement_status: string;
  currency: string;
  price_package_idr: string;
  price_addons_idr: string;
  price_transport_idr: string;
  service_fee_idr: string;
  discount_idr: string;
  total_customer_idr: string;
  dp_amount_idr: string;
  vendor_entitlement_idr: string;
  commission_idr: string;
  pricing_snapshot: Record<string, unknown>;
  respond_deadline: Date | string;
  counter_deadline: Date | string | null;
  payment_deadline: Date | string | null;
  scheduled_start_at: Date | string | null;
  scheduled_end_at: Date | string | null;
  checkin_at: Date | string | null;
  confirmed_at: Date | string | null;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  cancelled_at: Date | string | null;
  cancel_reason: string | null;
  released_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  event_title: string;
  event_type: string | null;
  event_region_code: string;
  event_venue_name: string | null;
  event_venue_address: string;
  event_start_date: string;
  event_end_date: string;
  event_notes: string | null;
  event_guest_estimate: number | null;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string;
  package_name: string | null;
  package_duration_minutes: number | null;
  package_description: string | null;
}

export interface VendorPortalSummaryRow {
  total_bookings: number;
  pending_count: number;
  this_month_count: number;
  this_month_idr: string;
}

export interface VendorSettledBookingRow {
  id: string;
  code: string;
  vendor_entitlement_idr: string;
  released_at: Date | string | null;
  settlement_status: string;
  event_title: string;
  event_start_date: string;
  total_count: number;
}

const VENDOR_PROFILE_COLUMNS = `
  v.id,
  v.display_name,
  v.slug,
  v.region_code,
  v.verification_status::text AS verification_status,
  v.is_active,
  v.calendar_updated_at,
  v.legal_name,
  v.description,
  v.base_address,
  v.service_radius_km,
  v.free_radius_km,
  v.transport_fee_per_km_idr,
  v.min_dp_bp,
  v.avatar_url,
  v.banner_url,
  v.photo_urls,
  v.video_url,
  u.phone AS whatsapp
`;

@Injectable()
export class VendorPortalRepository {
  async findVendorByOwner(userId: string): Promise<VendorPortalVendorRow | null> {
    if (!isUuid(userId)) return null;
    const rows = await query<VendorPortalVendorRow>(
      `SELECT ${VENDOR_PROFILE_COLUMNS}
         FROM vendors v
         LEFT JOIN users u ON u.id = v.owner_user_id
        WHERE v.owner_user_id = $1
          AND v.is_active = true
        LIMIT 1`,
      [userId]
    );
    return rows[0] ?? null;
  }

  async findVendorById(vendorId: string): Promise<VendorPortalVendorRow | null> {
    if (!isUuid(vendorId)) return null;
    const rows = await query<VendorPortalVendorRow>(
      `SELECT ${VENDOR_PROFILE_COLUMNS}
         FROM vendors v
         LEFT JOIN users u ON u.id = v.owner_user_id
        WHERE v.id = $1::uuid
        LIMIT 1`,
      [vendorId]
    );
    return rows[0] ?? null;
  }

  async updateOwnProfile(
    vendorId: string,
    patch: VendorProfileUpdateInput
  ): Promise<VendorPortalVendorRow | null> {
    if (!isUuid(vendorId)) return null;

    const assignments: string[] = [];
    const params: unknown[] = [vendorId];
    const set = (column: string, value: unknown): void => {
      params.push(value);
      assignments.push(`${column} = $${params.length}`);
    };

    if (patch.display_name !== undefined) set('display_name', patch.display_name);
    if (patch.legal_name !== undefined) set('legal_name', patch.legal_name);
    if (patch.description !== undefined) set('description', patch.description);
    if (patch.base_address !== undefined) set('base_address', patch.base_address);
    if (patch.service_radius_km !== undefined) set('service_radius_km', patch.service_radius_km);
    if (patch.free_radius_km !== undefined) set('free_radius_km', patch.free_radius_km);
    if (patch.transport_fee_per_km_idr !== undefined) {
      params.push(patch.transport_fee_per_km_idr);
      assignments.push(`transport_fee_per_km_idr = $${params.length}::bigint`);
    }
    if (patch.min_dp_bp !== undefined) set('min_dp_bp', patch.min_dp_bp);
    if (patch.avatar_url !== undefined) set('avatar_url', patch.avatar_url);
    if (patch.banner_url !== undefined) set('banner_url', patch.banner_url);
    if (patch.photo_urls !== undefined) set('photo_urls', patch.photo_urls);
    if (patch.video_url !== undefined) set('video_url', patch.video_url);

    if (assignments.length === 0) return this.findVendorById(vendorId);

    const rows = await query<VendorPortalVendorRow>(
      `WITH updated AS (
         UPDATE vendors
            SET ${assignments.join(', ')}
          WHERE id = $1::uuid
          RETURNING *
       )
       SELECT ${VENDOR_PROFILE_COLUMNS}
         FROM updated v
         LEFT JOIN users u ON u.id = v.owner_user_id`,
      params
    );
    return rows[0] ?? null;
  }

  async listBookings(
    vendorId: string,
    status: string | null,
    limit: number,
    offset: number
  ): Promise<VendorBookingListItemRow[]> {
    if (!isUuid(vendorId)) return [];
    return query<VendorBookingListItemRow>(
      `SELECT b.id, b.code, b.lifecycle_status, b.payment_status, b.settlement_status,
              b.total_customer_idr, b.dp_amount_idr, b.vendor_entitlement_idr,
              b.respond_deadline, b.created_at,
              e.title AS event_title, e.start_date::text AS event_start_date,
              e.region_code AS event_region_code,
              u.phone AS customer_phone,
              u.name AS customer_name,
              COUNT(*) OVER()::int AS total_count
       FROM bookings b
       JOIN events e ON e.id = b.event_id
       JOIN users u ON u.id = b.customer_id
       WHERE b.vendor_id = $1 AND ($2::text IS NULL OR b.lifecycle_status::text = $2)
       ORDER BY CASE WHEN b.lifecycle_status = 'requested' THEN 0 ELSE 1 END, b.created_at DESC
       LIMIT $3 OFFSET $4`,
      [vendorId, status, limit, offset]
    );
  }

  async findBookingForVendor(
    bookingId: string,
    vendorId: string
  ): Promise<VendorBookingDetailRow | null> {
    if (!isUuid(bookingId) || !isUuid(vendorId)) return null;
    const rows = await query<VendorBookingDetailRow>(
      `SELECT b.id, b.code, b.customer_id, b.vendor_id, b.event_id, b.package_id,
              b.lifecycle_status, b.payment_status, b.settlement_status, b.currency,
              b.price_package_idr, b.price_addons_idr, b.price_transport_idr,
              b.service_fee_idr, b.discount_idr,
              b.total_customer_idr, b.dp_amount_idr, b.vendor_entitlement_idr,
              b.commission_idr, b.pricing_snapshot,
              b.respond_deadline, b.counter_deadline, b.payment_deadline,
              b.scheduled_start_at, b.scheduled_end_at, b.checkin_at,
              b.confirmed_at, b.started_at, b.completed_at, b.cancelled_at,
              b.cancel_reason, b.released_at, b.created_at, b.updated_at,
              e.title AS event_title, e.event_type AS event_type,
              e.region_code AS event_region_code,
              e.venue_name AS event_venue_name, e.venue_address AS event_venue_address,
              e.start_date::text AS event_start_date, e.end_date::text AS event_end_date,
              e.notes AS event_notes, e.guest_estimate AS event_guest_estimate,
              u.name AS customer_name, u.phone AS customer_phone, u.email AS customer_email,
              p.name AS package_name, p.duration_minutes AS package_duration_minutes,
              p.description AS package_description
       FROM bookings b
       JOIN events e ON e.id = b.event_id
       JOIN users u ON u.id = b.customer_id
       LEFT JOIN packages p ON p.id = b.package_id
       WHERE b.id = $1 AND b.vendor_id = $2`,
      [bookingId, vendorId]
    );
    return rows[0] ?? null;
  }

  async getSummary(vendorId: string): Promise<VendorPortalSummaryRow> {
    if (!isUuid(vendorId)) {
      return { total_bookings: 0, pending_count: 0, this_month_count: 0, this_month_idr: '0' };
    }
    const rows = await query<VendorPortalSummaryRow>(
      `SELECT COUNT(*)::int AS total_bookings,
              COUNT(*) FILTER (WHERE lifecycle_status = 'requested')::int AS pending_count,
              COUNT(*) FILTER (WHERE date_trunc('month', created_at) = date_trunc('month', now()))::int AS this_month_count,
              COALESCE(SUM(vendor_entitlement_idr::bigint) FILTER (WHERE date_trunc('month', created_at) = date_trunc('month', now())), 0)::text AS this_month_idr
       FROM bookings
       WHERE vendor_id = $1`,
      [vendorId]
    );
    return rows[0] ?? { total_bookings: 0, pending_count: 0, this_month_count: 0, this_month_idr: '0' };
  }

  async getHeldBalance(vendorId: string): Promise<string> {
    if (!isUuid(vendorId)) return '0';
    const rows = await query<{ held_idr: string }>(
      `SELECT COALESCE(SUM(vendor_entitlement_idr::bigint), 0)::text AS held_idr
       FROM bookings
       WHERE vendor_id = $1 AND settlement_status = 'held'`,
      [vendorId]
    );
    return rows[0]?.held_idr ?? '0';
  }

  async listSettledBookings(
    vendorId: string,
    limit: number,
    offset: number
  ): Promise<VendorSettledBookingRow[]> {
    if (!isUuid(vendorId)) return [];
    return query<VendorSettledBookingRow>(
      `SELECT b.id, b.code, b.vendor_entitlement_idr, b.released_at, b.settlement_status,
              e.title AS event_title, e.start_date::text AS event_start_date,
              COUNT(*) OVER()::int AS total_count
       FROM bookings b
       JOIN events e ON e.id = b.event_id
       WHERE b.vendor_id = $1 AND b.settlement_status = 'released'
       ORDER BY b.released_at DESC NULLS LAST
       LIMIT $2 OFFSET $3`,
      [vendorId, limit, offset]
    );
  }
}
