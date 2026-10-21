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
import type { CalendarSlotDbRow, PackageDbRow, UserIdRow, VendorRow, VerifyRow } from './rows';

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
  v.verified_by
`;

const PACKAGE_COLUMNS = `
  p.id,
  p.vendor_id,
  p.name,
  p.description,
  p.duration_minutes,
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
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
}

export interface PackageInsertInput {
  name: string;
  duration_minutes: number;
  /** BIGINT as a decimal string. */
  base_price_idr: string;
  description: string | null;
  is_active: boolean;
}

export interface PackageUpdateInput {
  name?: string;
  duration_minutes?: number;
  /** BIGINT as a decimal string. */
  base_price_idr?: string;
  description?: string | null;
  is_active?: boolean;
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
           (vendor_id, name, duration_minutes, base_price_idr, description, is_active)
         VALUES ($1::uuid, $2, $3, $4::bigint, $5, $6)
         RETURNING *
       )
       SELECT ${PACKAGE_COLUMNS} FROM inserted p`,
      [
        vendorId,
        input.name,
        input.duration_minutes,
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
    actorId: string
  ): Promise<number> {
    if (cells.length === 0) return 0;

    const result = await client.query(
      `INSERT INTO calendar_slots (vendor_id, date, session, status, source, updated_by)
       SELECT $1::uuid, c.d, c.s, $4::calendar_slot_status, 'admin', $5::uuid
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
        actorId
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
}
