/**
 * SQL for the catalog slice: vendor creation/verification, package CRUD and the
 * vendor calendar.
 *
 * Every column referenced here exists in `001_core.sql` / `002_fixes.sql`:
 *   vendors, packages, calendar_slots, users, regions, audit_logs.
 *
 * Reads use `query()` (pool). Writes take the caller's `PoolClient` so vendor
 * verification + its audit row, and a bulk calendar write + the
 * `vendors.calendar_updated_at` touch, commit together.
 */
import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { query } from '@tarlink/core/db';
import type {
  CalendarSlotDbRow,
  CategoryLookupRow,
  PackageDbRow,
  PolicyDbRow,
  PublicAddonDbRow,
  PublicCategoryDbRow,
  PublicPackageDbRow,
  PublicVendorDetailRow,
  PublicVendorListRow,
  UserIdRow,
  VendorCategoryDbRow,
  VendorRow,
  VerifyRow
} from './rows';

export const VENDOR_COLUMNS = `
  v.id,
  v.slug,
  v.display_name,
  v.legal_name,
  v.description,
  v.base_address,
  v.region_code,
  v.verification_status::text AS verification_status,
  v.verification_note,
  v.service_radius_km,
  v.free_radius_km,
  v.transport_fee_per_km_idr,
  v.min_dp_bp,
  v.is_active,
  v.created_at,
  v.verified_at,
  v.verified_by,
  v.avatar_url,
  v.banner_url,
  v.photo_urls,
  v.video_url
`;

const PACKAGE_COLUMNS = `
  p.id,
  p.vendor_id,
  p.name,
  p.description,
  p.duration_minutes,
  p.personnel_count,
  p.inclusions,
  p.photo_url,
  p.base_price_idr,
  p.is_active,
  p.created_at
`;

const VERIFY_RETURNING = `
  id,
  verification_status::text AS verification_status,
  verification_note,
  verified_at,
  verified_by
`;

const VENDOR_CATEGORY_COLUMNS = `
  c.slug,
  c.name,
  vc.is_primary
`;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** `%`, `_` and `\` in user input must not act as LIKE wildcards. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** `$1` = LIKE pattern (or NULL), `$2` = region prefix (or NULL),
 *  `$3` = category slug (or NULL), `$4` = date (or NULL), `$5` = session (or NULL). */
const PUBLIC_VENDOR_WHERE = `
  v.verification_status = 'approved'
  AND v.is_active
  AND ($1::text IS NULL
       OR v.display_name ILIKE $1 ESCAPE '\\'
       OR v.legal_name ILIKE $1 ESCAPE '\\'
       OR v.base_address ILIKE $1 ESCAPE '\\')
  AND ($2::text IS NULL OR v.region_code LIKE $2 || '%')
  AND ($3::text IS NULL OR EXISTS (
        SELECT 1
          FROM vendor_categories vc
          JOIN categories c ON c.id = vc.category_id
         WHERE vc.vendor_id = v.id
           AND c.slug = $3
           AND c.is_active
      ))
  AND ($4::date IS NULL OR EXISTS (
        SELECT 1
          FROM (
            SELECT
              bool_or(cs.session = 'full')  AS full_ok,
              bool_or(cs.session = 'day')   AS day_ok,
              bool_or(cs.session = 'night') AS night_ok
              FROM calendar_slots cs
             WHERE cs.vendor_id = v.id
               AND cs.date = $4::date
               AND cs.status = 'available'
          ) slots
         WHERE ($5::text IS NULL AND (slots.full_ok OR slots.day_ok OR slots.night_ok))
            OR ($5::text = 'full'  AND (slots.full_ok OR (slots.day_ok AND slots.night_ok)))
            OR ($5::text = 'day'   AND (slots.day_ok OR slots.full_ok))
            OR ($5::text = 'night' AND (slots.night_ok OR slots.full_ok))
      ))
`;

/** Primary category for the card: a vendor may belong to many, one flagged. */
const PUBLIC_VENDOR_CATEGORY_JOIN = `
  LEFT JOIN LATERAL (
    SELECT c.slug, c.name
      FROM vendor_categories vc
      JOIN categories c ON c.id = vc.category_id
     WHERE vc.vendor_id = v.id
       AND vc.is_primary
       AND c.is_active
     LIMIT 1
  ) cat ON true
`;

const PUBLIC_VENDOR_LIST_COLUMNS = `
  v.id,
  v.slug,
  v.display_name,
  v.region_code,
  r.name AS region_name,
  v.base_address,
  v.description,
  v.avatar_url,
  v.banner_url,
  v.photo_urls,
  v.video_url,
  v.rating_sum,
  v.rating_count,
  v.response_rate_bp,
  cat.slug AS category_slug,
  cat.name AS category_name,
  v.min_dp_bp,
  (SELECT MIN(p.base_price_idr) FROM packages p WHERE p.vendor_id = v.id AND p.is_active)
    AS starting_price_idr,
  (SELECT COUNT(*)::int FROM packages p WHERE p.vendor_id = v.id AND p.is_active)
    AS package_count
`;

const PUBLIC_VENDOR_DETAIL_COLUMNS = `
  v.id,
  v.slug,
  v.display_name,
  v.legal_name,
  v.description,
  v.region_code,
  r.name AS region_name,
  v.base_address,
  v.avatar_url,
  v.banner_url,
  v.photo_urls,
  v.video_url,
  ST_Y(COALESCE(v.base_location::geometry, r.centroid::geometry)) AS lat,
  ST_X(COALESCE(v.base_location::geometry, r.centroid::geometry)) AS lng,
  v.service_radius_km,
  v.transport_fee_per_km_idr,
  v.min_dp_bp,
  v.rating_sum,
  v.rating_count,
  v.response_rate_bp,
  cat.slug AS category_slug,
  cat.name AS category_name,
  u.phone AS whatsapp
`;

export interface PublicVendorFilter {
  /** Already trimmed; `null` = no text filter. */
  q: string | null;
  region: string | null;
  category: string | null;
  date: string | null;
  session: string | null;
  sort: 'rating' | 'price_asc' | 'name_asc';
  limit: number;
  offset: number;
}

export interface VendorInsertInput {
  ownerUserId: string;
  regionCode: string;
  slug: string;
  displayName: string;
  legalName: string | null;
  description: string | null;
  baseAddress: string | null;
}

export interface VendorUpdateInput {
  display_name?: string;
  legal_name?: string | null;
  description?: string | null;
  base_address?: string | null;
  service_radius_km?: number | null;
  free_radius_km?: number;
  /** BIGINT as a decimal string; converted with BigInt in the service. */
  transport_fee_per_km_idr?: string;
  min_dp_bp?: number;
  is_active?: boolean;
  avatar_url?: string | null;
  banner_url?: string | null;
  photo_urls?: string[];
  video_url?: string | null;
}

export interface PackageInsertInput {
  name: string;
  duration_minutes: number;
  /** BIGINT as a decimal string. */
  base_price_idr: string;
  description: string | null;
  is_active: boolean;
  personnel_count: number | null;
  inclusions: string[];
  photo_url: string | null;
}

export interface PackageUpdateInput {
  name?: string;
  duration_minutes?: number;
  /** BIGINT as a decimal string. */
  base_price_idr?: string;
  description?: string | null;
  is_active?: boolean;
  personnel_count?: number | null;
  inclusions?: string[];
  photo_url?: string | null;
}

export interface CalendarCellInput {
  date: string;
  session: string;
}

export interface AuditEntry {
  actorId: string;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  beforeState: unknown;
  afterState: unknown;
  requestId: string | null;
}

@Injectable()
export class CatalogRepository {
  /* ---------------------------------------------------------------- vendor */

  async regionExists(client: PoolClient, code: string): Promise<boolean> {
    const result = await client.query<{ code: string }>(
      `SELECT code FROM regions WHERE code = $1`,
      [code]
    );
    return result.rowCount === 1;
  }

  async findActiveUserByEmail(client: PoolClient, email: string): Promise<string | null> {
    const result = await client.query<UserIdRow>(
      `SELECT id
         FROM users
        WHERE lower(email) = lower($1)
          AND status = 'active'
        ORDER BY created_at ASC
        LIMIT 1`,
      [email]
    );
    return result.rows[0]?.id ?? null;
  }

  async findActiveUserByPhone(client: PoolClient, phone: string): Promise<string | null> {
    const result = await client.query<UserIdRow>(
      `SELECT id
         FROM users
        WHERE phone = $1
          AND status = 'active'
        LIMIT 1`,
      [phone]
    );
    return result.rows[0]?.id ?? null;
  }

  async vendorIdForOwner(client: PoolClient, ownerUserId: string): Promise<string | null> {
    const result = await client.query<UserIdRow>(
      `SELECT id FROM vendors WHERE owner_user_id = $1::uuid LIMIT 1`,
      [ownerUserId]
    );
    return result.rows[0]?.id ?? null;
  }

  /** Slugs equal to `base` or sharing its `base-N` prefix. */
  async takenSlugs(client: PoolClient, base: string): Promise<string[]> {
    const result = await client.query<{ slug: string }>(
      `SELECT slug FROM vendors WHERE slug = $1 OR slug LIKE $2`,
      [base, `${base}-%`]
    );
    return result.rows.map((row) => row.slug);
  }

  async insertVendor(client: PoolClient, input: VendorInsertInput): Promise<VendorRow> {
    const result = await client.query<VendorRow>(
      `WITH inserted AS (
         INSERT INTO vendors
           (owner_user_id, region_code, slug, display_name, legal_name, description, base_address)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
         RETURNING *
       )
       SELECT ${VENDOR_COLUMNS} FROM inserted v`,
      [
        input.ownerUserId,
        input.regionCode,
        input.slug,
        input.displayName,
        input.legalName,
        input.description,
        input.baseAddress
      ]
    );
    const row = result.rows[0];
    if (!row) throw new Error('insert vendor returned no row');
    return row;
  }

  /**
   * Grants the owner the `vendor_owner` role scoped to this vendor.
   *
   * Must run after the vendor row exists: `user_roles` requires vendor roles to
   * carry `vendor_id NOT NULL` and `vendor_scope = vendor_id`. Idempotent — a
   * re-run (or a previously revoked grant) only clears `revoked_at`.
   */
  async grantVendorOwner(
    client: PoolClient,
    userId: string,
    vendorId: string
  ): Promise<void> {
    await client.query(
      `INSERT INTO user_roles (user_id, role, vendor_id, vendor_scope)
       VALUES ($1::uuid, 'vendor_owner'::user_role, $2::uuid, $2::uuid)
       ON CONFLICT (user_id, role, vendor_scope) DO UPDATE SET revoked_at = NULL`,
      [userId, vendorId]
    );
  }

  async lockVendor(client: PoolClient, id: string): Promise<VendorRow | null> {
    if (!isUuid(id)) return null;
    const result = await client.query<VendorRow>(
      `SELECT ${VENDOR_COLUMNS} FROM vendors v WHERE v.id = $1::uuid FOR UPDATE`,
      [id]
    );
    return result.rows[0] ?? null;
  }

  /** Cheap existence check that locks the row against deletion for the tx. */
  async lockVendorRef(client: PoolClient, id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    const result = await client.query<{ id: string }>(
      `SELECT id FROM vendors WHERE id = $1::uuid FOR KEY SHARE`,
      [id]
    );
    return result.rowCount === 1;
  }

  async vendorExists(id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    const rows = await query<{ id: string }>(`SELECT id FROM vendors WHERE id = $1::uuid`, [id]);
    return rows.length === 1;
  }

  async updateVendor(
    client: PoolClient,
    id: string,
    patch: VendorUpdateInput
  ): Promise<VendorRow | null> {
    if (!isUuid(id)) return null;

    const assignments: string[] = [];
    const params: unknown[] = [id];
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
      set('transport_fee_per_km_idr', patch.transport_fee_per_km_idr);
    }
    if (patch.min_dp_bp !== undefined) set('min_dp_bp', patch.min_dp_bp);
    if (patch.is_active !== undefined) set('is_active', patch.is_active);
    if (patch.avatar_url !== undefined) set('avatar_url', patch.avatar_url);
    if (patch.banner_url !== undefined) set('banner_url', patch.banner_url);
    if (patch.photo_urls !== undefined) set('photo_urls', patch.photo_urls);
    if (patch.video_url !== undefined) set('video_url', patch.video_url);

    if (assignments.length === 0) {
      return this.lockVendor(client, id);
    }

    const result = await client.query<VendorRow>(
      `WITH updated AS (
         UPDATE vendors
            SET ${assignments.join(', ')}
          WHERE id = $1::uuid
          RETURNING *
       )
       SELECT ${VENDOR_COLUMNS} FROM updated v`,
      params
    );
    return result.rows[0] ?? null;
  }

  /* ------------------------------------------------------- vendor categories */

  async listVendorCategories(vendorId: string): Promise<VendorCategoryDbRow[]> {
    if (!isUuid(vendorId)) return [];
    return query<VendorCategoryDbRow>(
      `SELECT ${VENDOR_CATEGORY_COLUMNS}
         FROM vendor_categories vc
         JOIN categories c ON c.id = vc.category_id
        WHERE vc.vendor_id = $1::uuid
        ORDER BY vc.is_primary DESC, c.sort_order ASC, c.slug ASC`,
      [vendorId]
    );
  }

  async vendorCategoriesInTx(
    client: PoolClient,
    vendorId: string
  ): Promise<VendorCategoryDbRow[]> {
    const result = await client.query<VendorCategoryDbRow>(
      `SELECT ${VENDOR_CATEGORY_COLUMNS}
         FROM vendor_categories vc
         JOIN categories c ON c.id = vc.category_id
        WHERE vc.vendor_id = $1::uuid
        ORDER BY vc.is_primary DESC, c.sort_order ASC, c.slug ASC`,
      [vendorId]
    );
    return result.rows;
  }

  async categoriesBySlugs(client: PoolClient, slugs: string[]): Promise<CategoryLookupRow[]> {
    if (slugs.length === 0) return [];
    const result = await client.query<CategoryLookupRow>(
      `SELECT id, slug, name, is_active
         FROM categories
        WHERE slug = ANY($1::text[])`,
      [slugs]
    );
    return result.rows;
  }

  /**
   * Replaces the full set of categories for a vendor. Existing rows keep their
   * `created_at`; the primary flag is cleared first so moving it between rows
   * never trips the `vendor_categories_one_primary` unique index.
   */
  async replaceVendorCategories(
    client: PoolClient,
    vendorId: string,
    categoryIds: readonly number[],
    primaryCategoryId: number | null
  ): Promise<void> {
    await client.query(
      `UPDATE vendor_categories SET is_primary = false WHERE vendor_id = $1::uuid`,
      [vendorId]
    );
    await client.query(
      `DELETE FROM vendor_categories
        WHERE vendor_id = $1::uuid
          AND NOT (category_id = ANY($2::smallint[]))`,
      [vendorId, categoryIds]
    );
    if (categoryIds.length === 0) return;

    await client.query(
      `INSERT INTO vendor_categories (vendor_id, category_id, is_primary)
       SELECT $1::uuid, c.id, COALESCE(c.id = $3::smallint, false)
         FROM categories c
        WHERE c.id = ANY($2::smallint[])
       ON CONFLICT (vendor_id, category_id)
       DO UPDATE SET is_primary = EXCLUDED.is_primary`,
      [vendorId, categoryIds, primaryCategoryId]
    );
  }

  /** `approve`: verified_at = now(), verified_by = actor. */
  async setApproved(client: PoolClient, id: string, actorId: string): Promise<VerifyRow | null> {
    if (!isUuid(id)) return null;
    const result = await client.query<VerifyRow>(
      `UPDATE vendors
          SET verification_status = 'approved',
              verified_at = now(),
              verified_by = $2::uuid,
              verification_note = NULL
        WHERE id = $1::uuid
        RETURNING ${VERIFY_RETURNING}`,
      [id, actorId]
    );
    return result.rows[0] ?? null;
  }

  /** `reject`: records the note; no verified_at/verified_by. */
  async setRejected(client: PoolClient, id: string, note: string | null): Promise<VerifyRow | null> {
    if (!isUuid(id)) return null;
    const result = await client.query<VerifyRow>(
      `UPDATE vendors
          SET verification_status = 'rejected',
              verified_at = NULL,
              verified_by = NULL,
              verification_note = $2
        WHERE id = $1::uuid
        RETURNING ${VERIFY_RETURNING}`,
      [id, note]
    );
    return result.rows[0] ?? null;
  }

  /** `audit_logs.prev_hash`/`row_hash` are filled by the DB hash-chain trigger. */
  async insertAudit(client: PoolClient, entry: AuditEntry): Promise<void> {
    await client.query(
      `INSERT INTO audit_logs
         (actor_id, actor_role, action, entity_type, entity_id,
          before_state, after_state, request_id)
       VALUES ($1::uuid, $2::user_role, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
      [
        entry.actorId,
        entry.actorRole,
        entry.action,
        entry.entityType,
        entry.entityId,
        entry.beforeState === null ? null : JSON.stringify(entry.beforeState),
        entry.afterState === null ? null : JSON.stringify(entry.afterState),
        entry.requestId
      ]
    );
  }

  /* --------------------------------------------------------------- packages */

  async listPackages(vendorId: string): Promise<PackageDbRow[]> {
    return query<PackageDbRow>(
      `SELECT ${PACKAGE_COLUMNS}
         FROM packages p
        WHERE p.vendor_id = $1::uuid
        ORDER BY p.created_at ASC, p.id ASC`,
      [vendorId]
    );
  }

  async insertPackage(
    client: PoolClient,
    vendorId: string,
    input: PackageInsertInput
  ): Promise<PackageDbRow> {
    const result = await client.query<PackageDbRow>(
      `WITH inserted AS (
         INSERT INTO packages
           (vendor_id, name, duration_minutes, personnel_count, inclusions,
            photo_url, base_price_idr, description, is_active)
         VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6, $7::bigint, $8, $9)
         RETURNING *
       )
       SELECT ${PACKAGE_COLUMNS} FROM inserted p`,
      [
        vendorId,
        input.name,
        input.duration_minutes,
        input.personnel_count,
        JSON.stringify(input.inclusions),
        input.photo_url,
        input.base_price_idr,
        input.description,
        input.is_active
      ]
    );
    const row = result.rows[0];
    if (!row) throw new Error('insert package returned no row');
    return row;
  }

  async updatePackage(
    client: PoolClient,
    vendorId: string,
    packageId: string,
    patch: PackageUpdateInput
  ): Promise<PackageDbRow | null> {
    if (!isUuid(packageId)) return null;

    const assignments: string[] = [];
    const params: unknown[] = [packageId, vendorId];
    const set = (column: string, value: unknown): void => {
      params.push(value);
      assignments.push(`${column} = $${params.length}`);
    };

    if (patch.name !== undefined) set('name', patch.name);
    if (patch.duration_minutes !== undefined) set('duration_minutes', patch.duration_minutes);
    if (patch.base_price_idr !== undefined) {
      params.push(patch.base_price_idr);
      assignments.push(`base_price_idr = $${params.length}::bigint`);
    }
    if (patch.description !== undefined) set('description', patch.description);
    if (patch.is_active !== undefined) set('is_active', patch.is_active);
    if (patch.personnel_count !== undefined) set('personnel_count', patch.personnel_count);
    if (patch.inclusions !== undefined) {
      params.push(JSON.stringify(patch.inclusions));
      assignments.push(`inclusions = $${params.length}::jsonb`);
    }
    if (patch.photo_url !== undefined) set('photo_url', patch.photo_url);

    if (assignments.length === 0) {
      return this.findPackageInTx(client, packageId, vendorId);
    }

    const result = await client.query<PackageDbRow>(
      `WITH updated AS (
         UPDATE packages
            SET ${assignments.join(', ')}
          WHERE id = $1::uuid
            AND vendor_id = $2::uuid
          RETURNING *
       )
       SELECT ${PACKAGE_COLUMNS} FROM updated p`,
      params
    );
    return result.rows[0] ?? null;
  }

  private async findPackageInTx(
    client: PoolClient,
    packageId: string,
    vendorId: string
  ): Promise<PackageDbRow | null> {
    const result = await client.query<PackageDbRow>(
      `SELECT ${PACKAGE_COLUMNS}
         FROM packages p
        WHERE p.id = $1::uuid
          AND p.vendor_id = $2::uuid`,
      [packageId, vendorId]
    );
    return result.rows[0] ?? null;
  }

  /** Soft delete: bookings reference packages, so rows are never removed. */
  async deactivatePackage(
    client: PoolClient,
    vendorId: string,
    packageId: string
  ): Promise<boolean> {
    if (!isUuid(packageId)) return false;
    const result = await client.query(
      `UPDATE packages
          SET is_active = false
        WHERE id = $1::uuid
          AND vendor_id = $2::uuid`,
      [packageId, vendorId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  /* --------------------------------------------------------------- calendar */

  async calendarSlots(vendorId: string, from: string, to: string): Promise<CalendarSlotDbRow[]> {
    return query<CalendarSlotDbRow>(
      `SELECT date::text AS date,
              session,
              status::text AS status
         FROM calendar_slots
        WHERE vendor_id = $1::uuid
          AND date BETWEEN $2::date AND $3::date
        ORDER BY date ASC, session ASC`,
      [vendorId, from, to]
    );
  }

  /** Locks every existing row in range so a booking cannot flip one mid-write. */
  async lockCalendarSlots(
    client: PoolClient,
    vendorId: string,
    from: string,
    to: string
  ): Promise<CalendarSlotDbRow[]> {
    const result = await client.query<CalendarSlotDbRow>(
      `SELECT date::text AS date,
              session,
              status::text AS status
         FROM calendar_slots
        WHERE vendor_id = $1::uuid
          AND date BETWEEN $2::date AND $3::date
        FOR UPDATE`,
      [vendorId, from, to]
    );
    return result.rows;
  }

  /**
   * Upserts the planned cells only. The `WHERE` repeats the held/booked guard
   * from `calendar_plan.planCalendarWrites` as defence in depth: even a bug in
   * the planner cannot overwrite a slot a booking owns.
   */
  async upsertCalendarCells(
    client: PoolClient,
    vendorId: string,
    cells: readonly CalendarCellInput[],
    status: string,
    actorId: string,
    source: 'admin' | 'vendor' = 'admin'
  ): Promise<number> {
    if (cells.length === 0) return 0;

    const result = await client.query(
      `INSERT INTO calendar_slots (vendor_id, date, session, status, source, updated_by)
       SELECT $1::uuid, c.d, c.s, $4::calendar_slot_status, $6::calendar_slot_source, $5::uuid
         FROM unnest($2::date[], $3::text[]) AS c(d, s)
       ON CONFLICT (vendor_id, date, session) DO UPDATE
          SET status = EXCLUDED.status,
              source = EXCLUDED.source,
              updated_by = EXCLUDED.updated_by
        WHERE calendar_slots.status IN ('available', 'blocked')
          AND calendar_slots.status <> EXCLUDED.status
       RETURNING id`,
      [
        vendorId,
        cells.map((cell) => cell.date),
        cells.map((cell) => cell.session),
        status,
        actorId,
        source
      ]
    );
    return result.rowCount ?? 0;
  }

  /** D-10: `calendar_updated_at` reflects the last vendor/admin write. */
  async touchCalendar(client: PoolClient, vendorId: string): Promise<void> {
    await client.query(`UPDATE vendors SET calendar_updated_at = now() WHERE id = $1::uuid`, [
      vendorId
    ]);
  }

  /* ---------------------------------------------------------- public catalog */

  /**
   * Public listing. Only approved+active vendors; `q` is matched as a
   * case-insensitive substring of display_name/legal_name/base_address and
   * `region` as an exact code prefix (`32` covers everything under Jawa Barat).
   */
  async publicVendorPage(filter: PublicVendorFilter): Promise<{
    rows: PublicVendorListRow[];
    total: number;
  }> {
    const like = filter.q === null ? null : `%${escapeLike(filter.q)}%`;
    const orderBy =
      filter.sort === 'price_asc'
        ? 'starting_price_idr ASC NULLS LAST, v.display_name ASC, v.id ASC'
        : filter.sort === 'name_asc'
          ? 'v.display_name ASC, v.id ASC'
          : 'v.rating_count DESC, v.display_name ASC, v.id ASC';
    const rows = await query<PublicVendorListRow>(
      `SELECT ${PUBLIC_VENDOR_LIST_COLUMNS}
         FROM vendors v
         LEFT JOIN regions r ON r.code = v.region_code
         ${PUBLIC_VENDOR_CATEGORY_JOIN}
        WHERE ${PUBLIC_VENDOR_WHERE}
        ORDER BY ${orderBy}
        LIMIT $6 OFFSET $7`,
      [
        like,
        filter.region,
        filter.category,
        filter.date,
        filter.session,
        filter.limit,
        filter.offset
      ]
    );
    const counted = await query<{ total: number }>(
      `SELECT COUNT(*)::int AS total
         FROM vendors v
        WHERE ${PUBLIC_VENDOR_WHERE}`,
      [like, filter.region, filter.category, filter.date, filter.session]
    );
    return { rows, total: counted[0]?.total ?? 0 };
  }

  /** Active categories in display order. Public reference data only. */
  async publicCategories(): Promise<PublicCategoryDbRow[]> {
    return query<PublicCategoryDbRow>(
      `SELECT slug, name, sort_order
         FROM categories
        WHERE is_active
        ORDER BY sort_order ASC, name ASC`
    );
  }

  /** Accepts a uuid or a slug; returns null when not public or unknown. */
  async publicVendorProfile(idOrSlug: string): Promise<PublicVendorDetailRow | null> {
    const predicate = isUuid(idOrSlug) ? 'v.id = $1::uuid' : 'v.slug = $1';
    const rows = await query<PublicVendorDetailRow>(
      `SELECT ${PUBLIC_VENDOR_DETAIL_COLUMNS}
         FROM vendors v
         LEFT JOIN regions r ON r.code = v.region_code
         LEFT JOIN users u ON u.id = v.owner_user_id
         ${PUBLIC_VENDOR_CATEGORY_JOIN}
        WHERE ${predicate}
          AND v.verification_status = 'approved'
          AND v.is_active
        LIMIT 1`,
      [idOrSlug]
    );
    return rows[0] ?? null;
  }

  async publicPackages(vendorId: string): Promise<PublicPackageDbRow[]> {
    return query<PublicPackageDbRow>(
      `SELECT p.id, p.name, p.description, p.duration_minutes, p.personnel_count,
              p.inclusions, p.base_price_idr, p.photo_url
         FROM packages p
        WHERE p.vendor_id = $1::uuid
          AND p.is_active
        ORDER BY p.created_at ASC, p.id ASC`,
      [vendorId]
    );
  }

  async publicAddons(packageIds: readonly string[]): Promise<PublicAddonDbRow[]> {
    if (packageIds.length === 0) return [];
    return query<PublicAddonDbRow>(
      `SELECT a.id, a.package_id, a.name, a.price_idr, a.unit, a.max_qty
         FROM package_addons a
        WHERE a.package_id = ANY($1::uuid[])
          AND a.is_active
        ORDER BY a.name ASC, a.id ASC`,
      [packageIds]
    );
  }

  /**
   * "Current" is deterministic: active, not expired, newest `effective_from`
   * first (`effective_to` only shrinks the window, the index guarantees one
   * open row per code but historical rows can still be active+closed).
   */
  async currentPolicy(code: string): Promise<PolicyDbRow | null> {
    const rows = await query<PolicyDbRow>(
      `SELECT id, code, version, body_hash, effective_from, body
         FROM policy_versions
        WHERE code = $1
          AND is_active
          AND (effective_to IS NULL OR effective_to > now())
        ORDER BY effective_from DESC, created_at DESC
        LIMIT 1`,
      [code]
    );
    return rows[0] ?? null;
  }
}
