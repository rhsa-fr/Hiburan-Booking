/**
 * Booking persistence (TECH-DESIGN §5.7, §5.8, §5.14).
 *
 * All money columns are BIGINT: pg returns them as strings and this layer only
 * converts with BigInt(), never parseFloat/Number arithmetic. Methods that
 * participate in the booking transaction accept the caller's PoolClient.
 */
import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { query } from '../../../../apps/api/src/core/db';
import { AppError } from '../../../../apps/api/src/core/errors';
import type { CalendarSession } from '../../calendar/src/availability';
import type {
  ActorRole,
  BookingState,
  LifecycleStatus,
  PaymentStatus,
  SettlementStatus,
  StatusAxis
} from './state-machine';

function isForeignKeyViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23503';
}

export type BookingRow = {
  id: string;
  code: string;
  customer_id: string;
  vendor_id: string;
  event_id: string;
  package_id: string;
  lifecycle_status: LifecycleStatus;
  payment_status: PaymentStatus;
  settlement_status: SettlementStatus;
  currency: string;
  price_package_idr: string;
  price_addons_idr: string;
  price_transport_idr: string;
  service_fee_idr: string;
  discount_idr: string;
  commission_bp: number;
  commission_threshold_idr: string;
  commission_bp_tier2: number;
  commission_min_idr: string;
  commission_cap_idr: string;
  commission_tier1_idr: string;
  commission_tier2_idr: string;
  commission_idr: string;
  total_customer_idr: string;
  dp_amount_idr: string;
  vendor_entitlement_idr: string;
  pricing_snapshot: Record<string, unknown>;
  policy_version_id: string;
  respond_deadline: Date;
  counter_deadline: Date | null;
  payment_deadline: Date | null;
  scheduled_start_at: Date | null;
  scheduled_end_at: Date | null;
  checkin_at: Date | null;
  confirmed_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
  no_show_at: Date | null;
  released_at: Date | null;
  dispute_window_ends_at: Date | null;
  started_without_checkin: boolean;
  row_version: number;
  created_at: Date;
  updated_at: Date;
};

/**
 * `findById` joins the display context of the detail screen. The joined
 * columns are all nullable (LEFT JOIN) so a booking whose vendor/package/event
 * row is missing still loads — the service turns the missing part into `null`.
 */
export type BookingDetailRow = BookingRow & {
  vendor_slug: string | null;
  vendor_display_name: string | null;
  vendor_whatsapp: string | null;
  vendor_region_code: string | null;
  vendor_base_address: string | null;
  package_name: string | null;
  package_duration_minutes: number | null;
  event_title: string | null;
  event_type: string | null;
  event_region_code: string | null;
  event_venue_name: string | null;
  event_venue_address: string | null;
  event_lat: number | null;
  event_lng: number | null;
  event_guest_estimate: number | null;
  event_notes: string | null;
  event_start_date: string | null;
  event_end_date: string | null;
};

/** One page of the customer booking list; `total_count` is the unpaged count. */
export type CustomerBookingListRow = {
  id: string;
  code: string;
  lifecycle_status: LifecycleStatus;
  payment_status: PaymentStatus;
  settlement_status: SettlementStatus;
  vendor_id: string;
  package_id: string;
  total_customer_idr: string;
  dp_amount_idr: string;
  vendor_slug: string | null;
  vendor_display_name: string | null;
  package_name: string | null;
  slot_date: string | null;
  slot_session: CalendarSession | null;
  created_at: Date;
  updated_at: Date;
  total_count: number;
};

export interface ListForCustomerOptions {
  status: LifecycleStatus | null;
  limit: number;
  offset: number;
}

export type BookingSlotRow = {
  date: string;
  session: CalendarSession;
  is_blocking: boolean;
  /** Local wall-clock times of the slot; NULL when the vendor set none. */
  start_time: string | null;
  end_time: string | null;
};

export type VendorRow = {
  id: string;
  owner_user_id: string;
  verification_status: string;
  is_active: boolean;
};

export type PackageRow = {
  id: string;
  vendor_id: string;
  base_price_idr: string;
  is_active: boolean;
};

export type PriceRuleRow = {
  id: string;
  rule_type: 'multiplier' | 'fixed';
  multiplier_bp: number | null;
  fixed_price_idr: string | null;
};

export type AddonRow = {
  id: string;
  name: string;
  price_idr: string;
  max_qty: number;
};

export type PolicyVersionRow = {
  id: string;
  code: string;
  version: number;
  body: unknown;
  body_hash: string;
  effective_from: Date;
  effective_to: Date | null;
  is_active: boolean;
};

export interface TermsSnapshotInput {
  bookingId: string;
  policyVersionId: string;
  terms: unknown;
  termsHash: string;
}

export type AutoCompletableRow = {
  id: string;
  vendor_id: string;
  scheduled_end_at: Date;
};

export interface NewEventRecord {
  code: string;
  customerId: string;
  title: string;
  eventType: string | null;
  regionCode: string;
  venueName: string | null;
  venueAddress: string;
  latitude: number | null;
  longitude: number | null;
  startDate: string;
  endDate: string;
  guestEstimate: number | null;
  notes: string | null;
}

export interface NewBookingRecord {
  code: string;
  customerId: string;
  vendorId: string;
  eventId: string;
  packageId: string;
  pricePackageIdr: bigint;
  priceAddonsIdr: bigint;
  priceTransportIdr: bigint;
  serviceFeeIdr: bigint;
  discountIdr: bigint;
  commissionBp: number;
  commissionThresholdIdr: bigint;
  commissionBpTier2: number;
  commissionMinIdr: bigint;
  commissionCapIdr: bigint;
  commissionTier1Idr: bigint;
  commissionTier2Idr: bigint;
  commissionIdr: bigint;
  totalCustomerIdr: bigint;
  dpAmountIdr: bigint;
  vendorEntitlementIdr: bigint;
  pricingSnapshot: Record<string, unknown>;
  policyVersionId: string;
  respondDeadline: Date;
  clientGeneratedId: string | null;
}

export interface NewBookingAddon {
  addonId: string | null;
  name: string;
  qty: number;
  priceIdr: bigint;
}

export interface BookingStatusPatch {
  lifecycle_status?: LifecycleStatus;
  payment_status?: PaymentStatus;
  settlement_status?: SettlementStatus;
  counter_deadline?: Date | null;
  payment_deadline?: Date | null;
  scheduled_start_at?: Date | null;
  scheduled_end_at?: Date | null;
  confirmed_at?: Date | null;
  started_at?: Date | null;
  checkin_at?: Date | null;
  completed_at?: Date | null;
  /** 'customer' | 'vendor' | 'admin' | 'system' (CHECK constraint of the DDL). */
  completed_by?: string | null;
  cancelled_at?: Date | null;
  /** 'customer' | 'vendor' | 'admin' | 'system' (CHECK constraint of the DDL). */
  cancelled_by?: string | null;
  cancel_reason?: string | null;
  no_show_at?: Date | null;
  released_at?: Date | null;
  dispute_window_ends_at?: Date | null;
  started_without_checkin?: boolean;
}

export interface StatusHistoryInput {
  bookingId: string;
  axis: StatusAxis;
  from: string | null;
  to: string;
  event: string;
  actorId: string | null;
  actorRole: ActorRole | null;
  requestId?: string | null;
  note?: string | null;
}

export interface OutboxInput {
  aggregateId: string;
  aggregateVersion: number;
  eventType: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
  availableAt?: Date;
}

export interface ListForVendorOptions {
  limit: number;
  cursorCreatedAt?: Date | null;
  cursorId?: string | null;
  lifecycle?: LifecycleStatus | null;
}

/** Maps a persisted row to the pure state-machine input. */
export function bookingStateFromRow(row: BookingRow): BookingState {
  return {
    lifecycle_status: row.lifecycle_status,
    payment_status: row.payment_status,
    settlement_status: row.settlement_status,
    total_customer_idr: BigInt(row.total_customer_idr),
    respond_deadline: row.respond_deadline,
    counter_deadline: row.counter_deadline,
    payment_deadline: row.payment_deadline,
    scheduled_start_at: row.scheduled_start_at,
    scheduled_end_at: row.scheduled_end_at,
    dispute_window_ends_at: row.dispute_window_ends_at,
    confirmed_at: row.confirmed_at,
    started_at: row.started_at,
    checkin_at: row.checkin_at,
    completed_at: row.completed_at,
    cancelled_at: row.cancelled_at,
    no_show_at: row.no_show_at,
    released_at: row.released_at,
    hold_expires_at: null,
    started_without_checkin: row.started_without_checkin
  };
}

@Injectable()
export class BookingRepository {
  async findVendor(client: PoolClient, vendorId: string): Promise<VendorRow | null> {
    const rows = await client.query<VendorRow>(
      `SELECT id, owner_user_id, verification_status, is_active
         FROM vendors
        WHERE id = $1`,
      [vendorId]
    );
    return rows.rows[0] ?? null;
  }

  /** D-12: the booking freezes the policy version that was effective at creation. */
  async findPolicyVersion(
    client: PoolClient,
    policyVersionId: string
  ): Promise<PolicyVersionRow | null> {
    const rows = await client.query<PolicyVersionRow>(
      `SELECT id, code, version, body, body_hash,
              effective_from, effective_to, is_active
         FROM policy_versions
        WHERE id = $1`,
      [policyVersionId]
    );
    return rows.rows[0] ?? null;
  }

  async insertTermsSnapshot(client: PoolClient, input: TermsSnapshotInput): Promise<void> {
    try {
      await client.query(
        `INSERT INTO booking_terms_snapshot
           (booking_id, policy_version_id, terms, terms_hash)
         VALUES ($1, $2, $3::jsonb, $4)`,
        [input.bookingId, input.policyVersionId, JSON.stringify(input.terms), input.termsHash]
      );
    } catch (err) {
      if (isForeignKeyViolation(err)) {
        throw new AppError('VALIDATION_ERROR', 'Referensi kebijakan tidak valid');
      }
      throw err;
    }
  }

  async findPackage(
    client: PoolClient,
    vendorId: string,
    packageId: string
  ): Promise<PackageRow | null> {
    const rows = await client.query<PackageRow>(
      `SELECT id, vendor_id, base_price_idr, is_active
         FROM packages
        WHERE id = $1 AND vendor_id = $2`,
      [packageId, vendorId]
    );
    return rows.rows[0] ?? null;
  }

  /**
   * Deterministic seasonal price selection (§5.6): first active rule matching
   * the date, ordered by priority then id.
   */
  async findPriceRule(
    client: PoolClient,
    packageId: string,
    date: string,
    dowMask: number
  ): Promise<PriceRuleRow | null> {
    const rows = await client.query<PriceRuleRow>(
      `SELECT id, rule_type, multiplier_bp, fixed_price_idr
         FROM package_price_rules
        WHERE package_id = $1
          AND is_active
          AND (date_from IS NULL OR date_from <= $2::date)
          AND (date_to IS NULL OR date_to >= $2::date)
          AND (dow_mask & $3) <> 0
        ORDER BY priority ASC, id ASC
        LIMIT 1`,
      [packageId, date, dowMask]
    );
    return rows.rows[0] ?? null;
  }

  async findAddons(
    client: PoolClient,
    packageId: string,
    addonIds: readonly string[]
  ): Promise<AddonRow[]> {
    if (addonIds.length === 0) return [];
    const rows = await client.query<AddonRow>(
      `SELECT id, name, price_idr, max_qty
         FROM package_addons
        WHERE package_id = $1
          AND is_active
          AND id = ANY($2::uuid[])`,
      [packageId, addonIds]
    );
    return rows.rows;
  }

  async insertEvent(client: PoolClient, event: NewEventRecord): Promise<{ id: string; code: string }> {
    let rows: { rows: { id: string; code: string }[] };
    try {
      rows = await client.query<{ id: string; code: string }>(
        `INSERT INTO events
           (code, customer_id, title, event_type, region_code, venue_name, venue_address,
            venue_location, start_date, end_date, guest_estimate, notes)
         VALUES
           ($1, $2, $3, $4, $5, $6, $7,
            CASE WHEN $8::float8 IS NULL OR $9::float8 IS NULL
                 THEN NULL
                 ELSE ST_SetSRID(ST_MakePoint($8::float8, $9::float8), 4326)
            END,
            $10::date, $11::date, $12, $13)
         RETURNING id, code`,
        [
          event.code,
          event.customerId,
          event.title,
          event.eventType,
          event.regionCode,
          event.venueName,
          event.venueAddress,
          event.longitude,
          event.latitude,
          event.startDate,
          event.endDate,
          event.guestEstimate,
          event.notes
        ]
      );
    } catch (err) {
      if (isForeignKeyViolation(err)) {
        throw new AppError('VALIDATION_ERROR', 'Referensi wilayah atau pelanggan tidak valid');
      }
      throw err;
    }
    const row = rows.rows[0];
    if (!row) throw new AppError('INTERNAL_ERROR', 'Gagal menyimpan event');
    return row;
  }

  async insertBooking(client: PoolClient, record: NewBookingRecord): Promise<BookingRow> {
    let rows: { rows: BookingRow[] };
    try {
      rows = await client.query<BookingRow>(
        `INSERT INTO bookings
           (code, customer_id, vendor_id, event_id, package_id, currency,
            price_package_idr, price_addons_idr, price_transport_idr, service_fee_idr, discount_idr,
            commission_bp, commission_threshold_idr, commission_bp_tier2,
            commission_min_idr, commission_cap_idr,
            commission_tier1_idr, commission_tier2_idr, commission_idr,
            total_customer_idr, dp_amount_idr, vendor_entitlement_idr,
            pricing_snapshot, policy_version_id, respond_deadline, client_generated_id)
         VALUES
           ($1, $2, $3, $4, $5, 'IDR',
            $6, $7, $8, $9, $10,
            $11, $12, $13,
            $14, $15,
            $16, $17, $18,
            $19, $20, $21,
            $22::jsonb, $23, $24, $25)
         RETURNING *`,
        [
          record.code,
          record.customerId,
          record.vendorId,
          record.eventId,
          record.packageId,
          record.pricePackageIdr.toString(),
          record.priceAddonsIdr.toString(),
          record.priceTransportIdr.toString(),
          record.serviceFeeIdr.toString(),
          record.discountIdr.toString(),
          record.commissionBp,
          record.commissionThresholdIdr.toString(),
          record.commissionBpTier2,
          record.commissionMinIdr.toString(),
          record.commissionCapIdr.toString(),
          record.commissionTier1Idr.toString(),
          record.commissionTier2Idr.toString(),
          record.commissionIdr.toString(),
          record.totalCustomerIdr.toString(),
          record.dpAmountIdr.toString(),
          record.vendorEntitlementIdr.toString(),
          JSON.stringify(record.pricingSnapshot),
          record.policyVersionId,
          record.respondDeadline,
          record.clientGeneratedId
        ]
      );
    } catch (err) {
      if (isForeignKeyViolation(err)) {
        throw new AppError('VALIDATION_ERROR', 'Referensi booking tidak valid');
      }
      const pg = err as { code?: unknown; constraint?: unknown };
      if (
        pg.code === '23505' &&
        pg.constraint === 'bookings_client_generated_uniq'
      ) {
        throw new AppError('CONFLICT', 'Booking dengan client_generated_id ini sudah ada');
      }
      throw err;
    }
    const row = rows.rows[0];
    if (!row) throw new AppError('INTERNAL_ERROR', 'Gagal menyimpan booking');
    return row;
  }

  async insertBookingAddons(
    client: PoolClient,
    bookingId: string,
    addons: readonly NewBookingAddon[]
  ): Promise<void> {
    for (const addon of addons) {
      await client.query(
        `INSERT INTO booking_addons (booking_id, addon_id, name, qty, price_idr, currency)
         VALUES ($1, $2, $3, $4, $5, 'IDR')`,
        [bookingId, addon.addonId, addon.name, addon.qty, addon.priceIdr.toString()]
      );
    }
  }

  async findById(id: string): Promise<BookingDetailRow | null> {
    const rows = await query<BookingDetailRow>(
      `SELECT b.*,
              v.slug         AS vendor_slug,
              v.display_name AS vendor_display_name,
              v.region_code  AS vendor_region_code,
              v.base_address AS vendor_base_address,
              u.phone        AS vendor_whatsapp,
              p.name              AS package_name,
              p.duration_minutes  AS package_duration_minutes,
              e.title              AS event_title,
              e.event_type         AS event_type,
              e.region_code        AS event_region_code,
              e.venue_name         AS event_venue_name,
              e.venue_address      AS event_venue_address,
              ST_Y(e.venue_location::geometry) AS event_lat,
              ST_X(e.venue_location::geometry) AS event_lng,
              e.guest_estimate     AS event_guest_estimate,
              e.notes              AS event_notes,
              e.start_date::text   AS event_start_date,
              e.end_date::text     AS event_end_date
         FROM bookings b
         LEFT JOIN vendors v  ON v.id = b.vendor_id
         LEFT JOIN users u    ON u.id = v.owner_user_id
         LEFT JOIN packages p ON p.id = b.package_id
         LEFT JOIN events e   ON e.id = b.event_id
        WHERE b.id = $1`,
      [id]
    );
    return rows[0] ?? null;
  }

  async findByIdForUpdate(client: PoolClient, id: string): Promise<BookingRow | null> {
    const rows = await client.query<BookingRow>(
      `SELECT * FROM bookings WHERE id = $1 FOR UPDATE`,
      [id]
    );
    return rows.rows[0] ?? null;
  }

  async findSlots(client: PoolClient, bookingId: string): Promise<BookingSlotRow[]> {
    const rows = await client.query<BookingSlotRow>(
      `SELECT date::text AS date,
              session,
              is_blocking,
              start_time::text AS start_time,
              end_time::text AS end_time
         FROM booking_slots
        WHERE booking_id = $1
        ORDER BY date, session`,
      [bookingId]
    );
    return rows.rows;
  }

  async countOpenDisputes(client: PoolClient, bookingId: string): Promise<number> {
    const rows = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM disputes
        WHERE booking_id = $1
          AND status IN ('open', 'investigating', 'awaiting_evidence')`,
      [bookingId]
    );
    return rows.rows[0]?.count ?? 0;
  }

  /** Optimistic-concurrency friendly status write; only listed columns change. */
  async updateStatus(
    client: PoolClient,
    id: string,
    patch: BookingStatusPatch
  ): Promise<BookingRow> {
    const assignments: string[] = [];
    const values: unknown[] = [];

    const set = (column: string, value: unknown): void => {
      values.push(value);
      assignments.push(`${column} = $${values.length}`);
    };

    const columns: ReadonlyArray<[keyof BookingStatusPatch, string]> = [
      ['lifecycle_status', 'lifecycle_status'],
      ['payment_status', 'payment_status'],
      ['settlement_status', 'settlement_status'],
      ['counter_deadline', 'counter_deadline'],
      ['payment_deadline', 'payment_deadline'],
      ['scheduled_start_at', 'scheduled_start_at'],
      ['scheduled_end_at', 'scheduled_end_at'],
      ['confirmed_at', 'confirmed_at'],
      ['started_at', 'started_at'],
      ['checkin_at', 'checkin_at'],
      ['completed_at', 'completed_at'],
      ['completed_by', 'completed_by'],
      ['cancelled_at', 'cancelled_at'],
      ['cancelled_by', 'cancelled_by'],
      ['cancel_reason', 'cancel_reason'],
      ['no_show_at', 'no_show_at'],
      ['released_at', 'released_at'],
      ['dispute_window_ends_at', 'dispute_window_ends_at'],
      ['started_without_checkin', 'started_without_checkin']
    ];

    for (const [key, column] of columns) {
      const value = patch[key];
      if (value !== undefined) set(column, value);
    }

    if (assignments.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'Tidak ada perubahan status yang diminta');
    }

    assignments.push('row_version = row_version + 1', 'updated_at = now()');
    values.push(id);

    const rows = await client.query<BookingRow>(
      `UPDATE bookings
          SET ${assignments.join(', ')}
        WHERE id = $${values.length}
        RETURNING *`,
      values
    );
    const row = rows.rows[0];
    if (!row) throw new AppError('NOT_FOUND', `Booking ${id} tidak ditemukan`);
    return row;
  }

  /** One row per axis change, per §4.1. */
  async insertHistory(client: PoolClient, entries: readonly StatusHistoryInput[]): Promise<void> {
    for (const entry of entries) {
      await client.query(
        `INSERT INTO booking_status_history
           (booking_id, axis, from_state, to_state, event, actor_id, actor_role, request_id, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          entry.bookingId,
          entry.axis,
          entry.from,
          entry.to,
          entry.event,
          entry.actorId,
          entry.actorRole,
          entry.requestId ?? null,
          entry.note ?? null
        ]
      );
    }
  }

  async enqueueOutbox(client: PoolClient, message: OutboxInput): Promise<void> {
    await client.query(
      `INSERT INTO outbox_messages
         (aggregate_type, aggregate_id, aggregate_version, event_type, payload, dedupe_key, available_at)
       VALUES ('booking', $1, $2, $3, $4::jsonb, $5, COALESCE($6, now()))
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [
        message.aggregateId,
        message.aggregateVersion,
        message.eventType,
        JSON.stringify(message.payload),
        message.dedupeKey,
        message.availableAt ?? null
      ]
    );
  }

  async isVendorResponder(vendorId: string, userId: string): Promise<boolean> {
    const rows = await query<{ allowed: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM vendors v
          WHERE v.id = $1 AND v.owner_user_id = $2
         UNION ALL
         SELECT 1
           FROM vendor_members vm
          WHERE vm.vendor_id = $1
            AND vm.user_id = $2
            AND vm.is_active
            AND vm.can_respond
       ) AS allowed`,
      [vendorId, userId]
    );
    return rows[0]?.allowed ?? false;
  }

  /** Owner or any active member (viewing does not require `can_respond`). */
  async isVendorMember(vendorId: string, userId: string): Promise<boolean> {
    const rows = await query<{ allowed: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM vendors v
          WHERE v.id = $1 AND v.owner_user_id = $2
         UNION ALL
         SELECT 1
           FROM vendor_members vm
          WHERE vm.vendor_id = $1
            AND vm.user_id = $2
            AND vm.is_active
       ) AS allowed`,
      [vendorId, userId]
    );
    return rows[0]?.allowed ?? false;
  }

  async canViewBookingAsVendor(bookingId: string, userId: string): Promise<boolean> {
    const rows = await query<{ allowed: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM bookings b
           JOIN vendors v ON v.id = b.vendor_id
           LEFT JOIN vendor_members vm
             ON vm.vendor_id = b.vendor_id
            AND vm.user_id = $2
            AND vm.is_active
          WHERE b.id = $1
            AND (v.owner_user_id = $2 OR vm.id IS NOT NULL)
       ) AS allowed`,
      [bookingId, userId]
    );
    return rows[0]?.allowed ?? false;
  }

  /**
   * Cursor pagination: opaque (created_at, id) cursor, created_at DESC, id DESC.
   * No offset scanning (§7.3).
   */
  async listForVendor(
    vendorId: string,
    options: ListForVendorOptions
  ): Promise<BookingRow[]> {
    const rows = await query<BookingRow>(
      `SELECT *
         FROM bookings
        WHERE vendor_id = $1
          AND ($2::timestamptz IS NULL
               OR (created_at, id) < ($2::timestamptz, $3::uuid))
          AND ($4::text IS NULL OR lifecycle_status = $4::booking_lifecycle_status)
        ORDER BY created_at DESC, id DESC
        LIMIT $5`,
      [
        vendorId,
        options.cursorCreatedAt ?? null,
        options.cursorId ?? null,
        options.lifecycle ?? null,
        options.limit
      ]
    );
    return rows;
  }

  /**
   * Customer list: one query, no N+1. The lateral picks the earliest slot with
   * the session order `day < night < full`; `count(*) OVER ()` is the unpaged
   * total (window runs before LIMIT).
   */
  async listForCustomer(
    customerId: string,
    options: ListForCustomerOptions
  ): Promise<CustomerBookingListRow[]> {
    return query<CustomerBookingListRow>(
      `SELECT b.id,
              b.code,
              b.lifecycle_status,
              b.payment_status,
              b.settlement_status,
              b.vendor_id,
              b.package_id,
              b.total_customer_idr,
              b.dp_amount_idr,
              b.created_at,
              b.updated_at,
              v.slug         AS vendor_slug,
              v.display_name AS vendor_display_name,
              p.name         AS package_name,
              s.date::text   AS slot_date,
              s.session      AS slot_session,
              CAST(count(*) OVER () AS int) AS total_count
         FROM bookings b
         LEFT JOIN vendors v  ON v.id = b.vendor_id
         LEFT JOIN packages p ON p.id = b.package_id
         LEFT JOIN LATERAL (
           SELECT bs.date, bs.session
             FROM booking_slots bs
            WHERE bs.booking_id = b.id
            ORDER BY bs.date ASC,
                     CASE bs.session WHEN 'day' THEN 0 WHEN 'night' THEN 1 ELSE 2 END
            LIMIT 1
         ) s ON true
        WHERE b.customer_id = $1
          AND ($2::text IS NULL OR b.lifecycle_status = $2::booking_lifecycle_status)
        ORDER BY b.created_at DESC, b.id DESC
        LIMIT $3 OFFSET $4`,
      [customerId, options.status, options.limit, options.offset]
    );
  }

  /**
   * L-22 worker query: due at scheduled_end_at + 3 days, no open dispute.
   * The worker itself is out of scope for this packet.
   */
  async findAutoCompletable(now: Date, limit = 50): Promise<AutoCompletableRow[]> {
    return query<AutoCompletableRow>(
      `SELECT b.id, b.vendor_id, b.scheduled_end_at
         FROM bookings b
        WHERE b.lifecycle_status IN ('confirmed', 'in_progress')
          AND b.scheduled_end_at IS NOT NULL
          AND b.scheduled_end_at + interval '3 days' <= $1
          AND b.payment_status IN ('dp_paid', 'fully_paid', 'partially_refunded', 'refunded')
          AND NOT EXISTS (
                SELECT 1
                  FROM disputes d
                 WHERE d.booking_id = b.id
                   AND d.status IN ('open', 'investigating', 'awaiting_evidence')
              )
        ORDER BY b.scheduled_end_at ASC
        LIMIT $2`,
      [now, limit]
    );
  }

  async findSlotsByBooking(bookingId: string): Promise<BookingSlotRow[]> {
    return query<BookingSlotRow>(
      `SELECT date::text AS date,
              session,
              is_blocking,
              start_time::text AS start_time,
              end_time::text AS end_time
         FROM booking_slots
        WHERE booking_id = $1
        ORDER BY date, session`,
      [bookingId]
    );
  }
}
