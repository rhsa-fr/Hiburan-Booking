/**
 * SQL for the admin read surface and the release write path.
 *
 * Every column referenced here exists in `001_core.sql` / `002_fixes.sql`:
 *   bookings, events, users, vendors, regions, payments, refunds, disputes,
 *   booking_status_history, journal_entries, journal_lines, chart_of_accounts,
 *   vendor_bank_accounts, platform_settings, audit_logs, user_roles.
 *
 * Reads use `query()` (pool). The release path uses the caller's `PoolClient`
 * so the booking update, ledger posting, history and audit rows commit together.
 */
import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { query } from '@tarlink/core/db';
import { AppError } from '@tarlink/core/errors';
import type { BookingFilters } from './contracts';
import type {
  AccountRow,
  AdminUserRow,
  AuditActionRow,
  AuditEventRow,
  BookingRow,
  DailyRow,
  DisputeRow,
  HealthRow,
  JournalEntryRow,
  JournalLineRow,
  KpiRow,
  MixRow,
  OperatorRow,
  PaymentRow,
  QueueRow,
  ReleasedRow,
  SettingsRow,
  StatusHistoryRow,
  VendorRow
} from './rows';
import type { SettingWrite } from './settings';

export const BOOKING_COLUMNS = `
  b.id,
  b.code,
  b.vendor_id,
  v.display_name AS vendor_name,
  vreg.name AS vendor_city,
  COALESCE(cu.name, cu.phone) AS customer_name,
  cu.phone AS customer_phone,
  ereg.name AS city,
  e.start_date::text AS event_date,
  b.scheduled_start_at,
  b.created_at,
  b.lifecycle_status,
  b.payment_status,
  b.settlement_status,
  b.price_package_idr,
  CASE WHEN b.price_package_idr > 0
       THEN ((b.service_fee_idr * 10000) / b.price_package_idr)::int
       ELSE 0 END AS service_fee_bp,
  b.service_fee_idr,
  b.total_customer_idr,
  b.dp_amount_idr,
  CASE WHEN b.price_package_idr > 0
       THEN ((b.dp_amount_idr * 10000) / b.price_package_idr)::int
       ELSE v.min_dp_bp END AS dp_min_bp,
  CASE b.payment_status
       WHEN 'unpaid' THEN b.total_customer_idr
       WHEN 'dp_paid' THEN b.total_customer_idr - b.dp_amount_idr
       ELSE 0::bigint END AS remaining_idr,
  b.commission_bp,
  b.commission_threshold_idr,
  b.commission_bp_tier2,
  b.commission_min_idr,
  b.commission_cap_idr,
  b.commission_tier1_idr,
  b.commission_tier2_idr,
  b.commission_idr,
  b.vendor_entitlement_idr,
  b.respond_deadline,
  b.payment_deadline,
  b.dispute_window_ends_at,
  b.released_at,
  b.updated_at
`;

export const BOOKING_FROM = `
  FROM bookings b
  JOIN users cu ON cu.id = b.customer_id
  JOIN vendors v ON v.id = b.vendor_id
  JOIN regions vreg ON vreg.code = v.region_code
  JOIN events e ON e.id = b.event_id
  JOIN regions ereg ON ereg.code = e.region_code
`;

const BOOKING_SELECT = `SELECT ${BOOKING_COLUMNS} ${BOOKING_FROM}`;

const LIFECYCLE_VALUES = [
  'requested',
  'countered',
  'accepted',
  'confirmed',
  'in_progress',
  'completed',
  'cancelled',
  'rejected',
  'expired',
  'no_show'
] as const;

const PAYMENT_VALUES = [
  'unpaid',
  'dp_paid',
  'fully_paid',
  'partially_refunded',
  'refunded'
] as const;

const SETTLEMENT_VALUES = [
  'not_eligible',
  'held',
  'disputed',
  'released',
  'clawed_back'
] as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Escapes LIKE wildcards so a search for `%` does not scan everything. */
function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/* ------------------------------------------------------------- status filter */

interface StatusFilter {
  column: 'lifecycle_status' | 'payment_status' | 'settlement_status';
  cast: string;
  value: string;
}

function resolveStatusFilter(raw: string): StatusFilter | null {
  const status = raw.trim();
  if (status.length === 0) return null;

  const colon = status.indexOf(':');
  const axis = colon >= 0 ? status.slice(0, colon) : null;
  const value = colon >= 0 ? status.slice(colon + 1) : status;
  if (value.length === 0) {
    throw new AppError('VALIDATION_ERROR', `status tidak valid: ${raw}`);
  }

  if (axis === 'lifecycle' || axis === null) {
    if ((LIFECYCLE_VALUES as readonly string[]).includes(value)) {
      return { column: 'lifecycle_status', cast: '::booking_lifecycle_status', value };
    }
    if (axis === 'lifecycle') {
      throw new AppError('VALIDATION_ERROR', `status lifecycle tidak dikenal: ${value}`);
    }
  }
  if (axis === 'payment' || axis === null) {
    if ((PAYMENT_VALUES as readonly string[]).includes(value)) {
      return { column: 'payment_status', cast: '::booking_payment_status', value };
    }
    if (axis === 'payment') {
      throw new AppError('VALIDATION_ERROR', `status payment tidak dikenal: ${value}`);
    }
  }
  if (axis === 'settlement' || axis === null) {
    if ((SETTLEMENT_VALUES as readonly string[]).includes(value)) {
      return { column: 'settlement_status', cast: '::booking_settlement_status', value };
    }
    if (axis === 'settlement') {
      throw new AppError('VALIDATION_ERROR', `status settlement tidak dikenal: ${value}`);
    }
  }

  throw new AppError('VALIDATION_ERROR', `status tidak dikenal: ${raw}`);
}

/* ----------------------------------------------------------- response shape */

export interface BookingListResult {
  rows: BookingRow[];
  total: number;
  histories: StatusHistoryRow[];
}

export interface LedgerResult {
  entries: JournalEntryRow[];
  lines: JournalLineRow[];
  accounts: AccountRow[];
}

const HISTORY_SELECT = `
  SELECT h.id::text AS id,
         h.booking_id,
         h.axis::text AS axis,
         h.from_state,
         h.to_state,
         COALESCE(NULLIF(u.name, ''), u.phone, 'Sistem') AS actor,
         h.created_at,
         h.note
    FROM booking_status_history h
    LEFT JOIN users u ON u.id = h.actor_id
`;

const JOURNAL_SELECT = `
  SELECT e.id,
         e.entry_no::text AS entry_no,
         e.event_type,
         e.reference_type,
         e.reference_id,
         e.booking_id,
         b.code AS booking_code,
         e.memo,
         e.occurred_at,
         e.created_at,
         COALESCE(NULLIF(u.name, ''), u.phone) AS created_by_name
    FROM journal_entries e
    LEFT JOIN bookings b ON b.id = e.booking_id
    LEFT JOIN users u ON u.id = e.created_by
`;

const PAYMENT_UNION = `
  SELECT p.id,
         p.booking_id,
         b.code AS booking_code,
         p.kind::text AS kind,
         p.status::text AS status,
         p.amount_idr,
         p.method,
         COALESCE(p.provider_txn_id, p.provider_ref) AS gateway_ref,
         p.paid_at,
         p.created_at
    FROM payments p
    JOIN bookings b ON b.id = p.booking_id
  UNION ALL
  SELECT r.id,
         r.booking_id,
         b.code AS booking_code,
         'refund' AS kind,
         CASE r.status
           WHEN 'succeeded' THEN 'paid'
           WHEN 'failed' THEN 'failed'
           WHEN 'rejected' THEN 'failed'
           ELSE 'pending'
         END AS status,
         r.amount_idr,
         p.method,
         COALESCE(r.provider_ref, p.provider_ref) AS gateway_ref,
         r.processed_at AS paid_at,
         r.created_at
    FROM refunds r
    JOIN bookings b ON b.id = r.booking_id
    JOIN payments p ON p.id = r.payment_id
`;

const DISPUTE_SELECT = `
  SELECT d.id,
         d.booking_id,
         b.code AS booking_code,
         d.status::text AS status,
         d.resolution::text AS resolution,
         d.description,
         d.opened_at,
         d.sla_due_at,
         d.resolved_at,
         d.resolution_note,
         d.customer_share_idr,
         d.vendor_share_idr,
         v.display_name AS vendor_name,
         ereg.name AS city,
         COALESCE(cu.name, cu.phone) AS customer_name
    FROM disputes d
    JOIN bookings b ON b.id = d.booking_id
    JOIN vendors v ON v.id = b.vendor_id
    JOIN users cu ON cu.id = b.customer_id
    JOIN events e ON e.id = b.event_id
    JOIN regions ereg ON ereg.code = e.region_code
`;

const VENDOR_SELECT = `
  SELECT v.id,
         v.display_name AS name,
         v.slug,
         v.legal_name,
         v.description,
         v.base_address,
         v.service_radius_km,
         v.free_radius_km,
         v.transport_fee_per_km_idr,
         v.min_dp_bp,
         v.verification_note,
         v.verified_by,
         vreg.name AS city,
         COALESCE(NULLIF(u.name, ''), u.phone) AS owner_name,
         u.phone,
         v.verification_status::text AS verification_status,
         v.verified_at,
         v.calendar_updated_at,
         v.created_at,
         v.response_rate_bp,
         CASE WHEN v.rating_count > 0
              THEN ROUND(v.rating_sum::numeric / v.rating_count * 10)::int
              ELSE 0 END AS rating_x10,
         (SELECT count(*)::int
            FROM bookings vb
           WHERE vb.vendor_id = v.id
             AND vb.lifecycle_status = 'completed') AS completed_bookings,
         v.is_active,
         ba.id AS bank_id,
         ba.bank_name,
         ba.account_number_masked AS bank_masked,
         ba.account_holder_name AS bank_holder,
         ba.status::text AS bank_status,
         ba.cooling_until AS bank_cooling_until,
         ba.verified_at AS bank_verified_at,
         ba.rejection_reason AS bank_rejection_reason
    FROM vendors v
    JOIN users u ON u.id = v.owner_user_id
    JOIN regions vreg ON vreg.code = v.region_code
    LEFT JOIN LATERAL (
      SELECT a.id, a.bank_name, a.account_number_masked, a.account_holder_name,
             a.status, a.cooling_until, a.verified_at, a.rejection_reason
        FROM vendor_bank_accounts a
       WHERE a.vendor_id = v.id
         AND a.superseded_at IS NULL
       ORDER BY (a.status = 'verified') DESC, a.created_at DESC
       LIMIT 1
    ) ba ON true
`;

@Injectable()
export class AdminRepository {
  /* ------------------------------------------------------------- dashboard */

  async kpis(): Promise<KpiRow> {
    const rows = await query<KpiRow>(`
      SELECT
        (SELECT count(*)::int FROM bookings
          WHERE created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta')
        ) AS bookings_today,
        (SELECT count(*)::int FROM bookings
          WHERE lifecycle_status = 'requested'
            AND created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta')
        ) AS bookings_today_needs_response,
        (SELECT count(*)::int FROM bookings
          WHERE lifecycle_status = 'accepted' AND payment_status = 'unpaid'
        ) AS awaiting_dp,
        (SELECT count(*)::int FROM bookings
          WHERE lifecycle_status = 'accepted' AND payment_status = 'unpaid'
            AND payment_deadline IS NOT NULL AND payment_deadline < now()
        ) AS awaiting_dp_overdue,
        (SELECT count(*)::int FROM bookings
          WHERE lifecycle_status = 'completed' AND settlement_status = 'held'
            AND payment_status IN ('dp_paid', 'fully_paid')
            AND dispute_window_ends_at IS NOT NULL AND dispute_window_ends_at < now()
        ) AS ready_to_release,
        (SELECT COALESCE(sum(vendor_entitlement_idr), 0) FROM bookings
          WHERE lifecycle_status = 'completed' AND settlement_status = 'held'
            AND payment_status IN ('dp_paid', 'fully_paid')
            AND dispute_window_ends_at IS NOT NULL AND dispute_window_ends_at < now()
        ) AS ready_to_release_idr,
        (SELECT count(*)::int FROM disputes
          WHERE status IN ('open', 'investigating', 'awaiting_evidence')
        ) AS open_disputes,
        (SELECT min(sla_due_at) FROM disputes
          WHERE status IN ('open', 'investigating', 'awaiting_evidence')
        ) AS oldest_dispute_due_at
    `);

    const row = rows[0];
    if (!row) throw new AppError('INTERNAL_ERROR', 'dashboard KPI query returned no row');
    return row;
  }

  async dailyBookings(days: number): Promise<DailyRow[]> {
    return query<DailyRow>(
      `
      SELECT to_char((series.day AT TIME ZONE 'Asia/Jakarta')::date, 'YYYY-MM-DD') AS date,
             count(b.id)::int AS count
        FROM generate_series(
               (date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta')
                 - make_interval(days => $1::int - 1)) AT TIME ZONE 'Asia/Jakarta',
               date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta',
               interval '1 day'
             ) AS series(day)
        LEFT JOIN bookings b
          ON b.created_at >= series.day
         AND b.created_at < series.day + interval '1 day'
       GROUP BY series.day
       ORDER BY series.day ASC
      `,
      [days]
    );
  }

  async paymentMix(): Promise<MixRow[]> {
    return query<MixRow>(
      `SELECT payment_status::text AS status, count(*)::int AS count
         FROM bookings
        GROUP BY payment_status`
    );
  }

  async health(): Promise<HealthRow> {
    const rows = await query<HealthRow>(`
      SELECT
        (SELECT COALESCE(ROUND(AVG(response_rate_bp))::int, 0)
           FROM vendors
          WHERE is_active AND response_rate_bp IS NOT NULL) AS response_rate_bp,
        (SELECT CASE WHEN count(*) = 0 THEN 0
                     ELSE ((count(*) FILTER (WHERE payment_status <> 'unpaid') * 10000 / count(*))::int)
                END
           FROM bookings
          WHERE lifecycle_status IN ('accepted', 'confirmed', 'in_progress', 'completed', 'no_show')
        ) AS dp_conversion_bp,
        (SELECT COALESCE(
                  ROUND(EXTRACT(EPOCH FROM percentile_cont(0.5) WITHIN GROUP (
                    ORDER BY (first_move.first_at - b.created_at)
                  )) / 60)::int, 0)
           FROM bookings b
           JOIN LATERAL (
             SELECT min(h.created_at) AS first_at
               FROM booking_status_history h
              WHERE h.booking_id = b.id
                AND h.axis = 'lifecycle'
                AND h.to_state IN ('accepted', 'countered')
           ) first_move ON first_move.first_at IS NOT NULL
        ) AS median_response_minutes
    `);

    const row = rows[0];
    if (!row) throw new AppError('INTERNAL_ERROR', 'health query returned no row');
    return row;
  }

  async queue(limit: number): Promise<QueueRow[]> {
    return query<QueueRow>(
      `
      SELECT q.* FROM (
        SELECT b.id AS booking_id,
               b.code,
               'response'::text AS kind,
               'Vendor belum menjawab permintaan'::text AS title,
               v.display_name || ' · ' || ereg.name AS detail,
               NULL::bigint AS amount_idr,
               b.respond_deadline AS due_at,
               CASE WHEN b.respond_deadline < now() THEN 'danger' ELSE 'attention' END AS severity
          FROM bookings b
          JOIN vendors v ON v.id = b.vendor_id
          JOIN events e ON e.id = b.event_id
          JOIN regions ereg ON ereg.code = e.region_code
         WHERE b.lifecycle_status = 'requested'
           AND b.respond_deadline IS NOT NULL
        UNION ALL
        SELECT b.id,
               b.code,
               'counter'::text,
               'Menunggu jawaban pelanggan atas counter'::text,
               COALESCE(cu.name, cu.phone) || ' · ' || v.display_name,
               NULL::bigint,
               b.counter_deadline,
               CASE WHEN b.counter_deadline IS NOT NULL AND b.counter_deadline < now()
                    THEN 'danger' ELSE 'attention' END
          FROM bookings b
          JOIN users cu ON cu.id = b.customer_id
          JOIN vendors v ON v.id = b.vendor_id
         WHERE b.lifecycle_status = 'countered'
        UNION ALL
        SELECT b.id,
               b.code,
               'dp'::text,
               'Menunggu pembayaran DP'::text,
               v.display_name,
               b.dp_amount_idr,
               b.payment_deadline,
               CASE WHEN b.payment_deadline IS NOT NULL AND b.payment_deadline < now()
                    THEN 'danger' ELSE 'attention' END
          FROM bookings b
          JOIN vendors v ON v.id = b.vendor_id
         WHERE b.lifecycle_status = 'accepted'
           AND b.payment_status = 'unpaid'
        UNION ALL
        SELECT b.id,
               b.code,
               'release'::text,
               'Siap dicairkan'::text,
               v.display_name,
               b.vendor_entitlement_idr,
               b.dispute_window_ends_at,
               'attention'::text
          FROM bookings b
          JOIN vendors v ON v.id = b.vendor_id
         WHERE b.lifecycle_status = 'completed'
           AND b.settlement_status = 'held'
           AND b.payment_status IN ('dp_paid', 'fully_paid')
           AND b.dispute_window_ends_at IS NOT NULL
           AND b.dispute_window_ends_at < now()
        UNION ALL
        SELECT d.booking_id,
               b.code,
               'dispute'::text,
               'Sengketa terbuka perlu keputusan'::text,
               left(d.description, 64),
               NULL::bigint,
               d.sla_due_at,
               'danger'::text
          FROM disputes d
          JOIN bookings b ON b.id = d.booking_id
         WHERE d.status IN ('open', 'investigating', 'awaiting_evidence')
      ) q
      WHERE q.due_at IS NOT NULL
      ORDER BY q.due_at ASC
      LIMIT $1
      `,
      [limit]
    );
  }

  /* -------------------------------------------------------------- bookings */

  async listBookings(filter: BookingFilters): Promise<BookingListResult> {
    const where: string[] = [];
    const params: unknown[] = [];
    const bind = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };

    const status = resolveStatusFilter(filter.status);
    if (status) {
      where.push(`b.${status.column} = ${bind(status.value)}${status.cast}`);
    }

    switch (filter.range) {
      case 'today':
        where.push(
          `b.created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta')`
        );
        break;
      case '7d':
        where.push(`b.created_at >= now() - interval '7 days'`);
        break;
      case '30d':
        where.push(`b.created_at >= now() - interval '30 days'`);
        break;
      case 'month':
        where.push(
          `b.created_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta')`
        );
        break;
      case 'all':
        break;
      default: {
        const exhaustive: never = filter.range;
        throw new AppError('VALIDATION_ERROR', `range tidak dikenal: ${String(exhaustive)}`);
      }
    }

    const city = filter.city.trim();
    if (city.length > 0) {
      where.push(`ereg.name ILIKE ${bind(likePattern(city))}`);
    }

    const search = filter.q.trim();
    if (search.length > 0) {
      const pattern = bind(likePattern(search));
      where.push(
        `(b.code ILIKE ${pattern} OR cu.name ILIKE ${pattern} OR cu.phone ILIKE ${pattern} OR v.display_name ILIKE ${pattern})`
      );
    }

    const orderBy = (() => {
      switch (filter.sort) {
        case 'created_asc':
          return 'b.created_at ASC, b.id ASC';
        case 'event_asc':
          return 'COALESCE(b.scheduled_start_at, e.start_date::timestamptz) ASC, b.id ASC';
        case 'event_desc':
          return 'COALESCE(b.scheduled_start_at, e.start_date::timestamptz) DESC, b.id DESC';
        case 'created_desc':
          return 'b.created_at DESC, b.id DESC';
        default: {
          const exhaustive: never = filter.sort;
          throw new AppError('VALIDATION_ERROR', `sort tidak dikenal: ${String(exhaustive)}`);
        }
      }
    })();

    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const countParams = [...params];

    const limit = bind(filter.page_size);
    const offset = bind((filter.page - 1) * filter.page_size);

    const rows = await query<BookingRow>(
      `${BOOKING_SELECT} ${whereSql} ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    const totals = await query<{ total: number }>(
      `SELECT count(*)::int AS total ${BOOKING_FROM} ${whereSql}`,
      countParams
    );

    return {
      rows,
      total: totals[0]?.total ?? 0,
      histories: await this.historiesFor(rows.map((row) => row.id))
    };
  }

  async historiesFor(bookingIds: readonly string[]): Promise<StatusHistoryRow[]> {
    if (bookingIds.length === 0) return [];
    return query<StatusHistoryRow>(
      `${HISTORY_SELECT} WHERE h.booking_id = ANY($1::uuid[]) ORDER BY h.id ASC`,
      [bookingIds]
    );
  }

  async findBooking(identifier: string): Promise<BookingRow | null> {
    const rows = await query<BookingRow>(
      isUuid(identifier)
        ? `${BOOKING_SELECT} WHERE b.id = $1::uuid`
        : `${BOOKING_SELECT} WHERE lower(b.code) = lower($1)`,
      [identifier]
    );
    return rows[0] ?? null;
  }

  async findBookingsByIds(bookingIds: readonly string[]): Promise<BookingRow[]> {
    if (bookingIds.length === 0) return [];
    return query<BookingRow>(`${BOOKING_SELECT} WHERE b.id = ANY($1::uuid[])`, [bookingIds]);
  }

  async bookingPayments(bookingId: string): Promise<PaymentRow[]> {
    return query<PaymentRow>(
      `SELECT * FROM (${PAYMENT_UNION}) payments_view
        WHERE booking_id = $1::uuid
        ORDER BY COALESCE(paid_at, created_at) DESC`,
      [bookingId]
    );
  }

  async bookingDispute(bookingId: string): Promise<DisputeRow | null> {
    const rows = await query<DisputeRow>(
      `${DISPUTE_SELECT} WHERE d.booking_id = $1::uuid ORDER BY d.opened_at DESC LIMIT 1`,
      [bookingId]
    );
    return rows[0] ?? null;
  }

  async bookingJournalEntries(
    bookingId: string
  ): Promise<{ entries: JournalEntryRow[]; lines: JournalLineRow[] }> {
    const entries = await query<JournalEntryRow>(
      `${JOURNAL_SELECT} WHERE e.booking_id = $1::uuid ORDER BY e.occurred_at DESC, e.id DESC`,
      [bookingId]
    );
    return { entries, lines: await this.linesFor(entries.map((entry) => entry.id)) };
  }

  /* --------------------------------------------------------------- vendors */

  async listVendors(filter: {
    q: string;
    city: string;
    verification: string;
  }): Promise<VendorRow[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    const bind = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };

    const search = filter.q.trim();
    if (search.length > 0) {
      const pattern = bind(likePattern(search));
      where.push(
        `(v.display_name ILIKE ${pattern} OR u.name ILIKE ${pattern} OR u.phone ILIKE ${pattern} OR v.slug ILIKE ${pattern})`
      );
    }

    const city = filter.city.trim();
    if (city.length > 0) {
      where.push(`vreg.name ILIKE ${bind(likePattern(city))}`);
    }

    const verification = filter.verification.trim();
    if (verification.length > 0) {
      switch (verification) {
        case 'verified':
          where.push(`v.verification_status = 'approved'`);
          break;
        case 'pending':
          where.push(`v.verification_status = 'pending'`);
          break;
        case 'rejected':
          where.push(`v.verification_status IN ('rejected', 'suspended')`);
          break;
        default:
          throw new AppError(
            'VALIDATION_ERROR',
            `verification tidak dikenal: ${verification}`
          );
      }
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    return query<VendorRow>(
      `${VENDOR_SELECT} ${whereSql} ORDER BY v.display_name ASC, v.id ASC`,
      params
    );
  }

  async findVendor(identifier: string): Promise<VendorRow | null> {
    const rows = await query<VendorRow>(
      isUuid(identifier)
        ? `${VENDOR_SELECT} WHERE v.id = $1::uuid`
        : `${VENDOR_SELECT} WHERE lower(v.slug) = lower($1)`,
      [identifier]
    );
    return rows[0] ?? null;
  }

  async vendorRecentBookings(vendorId: string, limit: number): Promise<BookingRow[]> {
    return query<BookingRow>(
      `${BOOKING_SELECT}
        WHERE b.vendor_id = $1::uuid
        ORDER BY COALESCE(b.scheduled_start_at, e.start_date::timestamptz) DESC, b.id DESC
        LIMIT $2`,
      [vendorId, limit]
    );
  }

  /* ---------------------------------------------------------------- release */

  async releaseCandidates(): Promise<BookingRow[]> {
    return query<BookingRow>(
      `${BOOKING_SELECT}
        WHERE b.lifecycle_status = 'completed'
          AND b.settlement_status = 'held'
        ORDER BY b.dispute_window_ends_at ASC NULLS FIRST, b.created_at ASC`
    );
  }

  async lockBookings(client: PoolClient, bookingIds: readonly string[]): Promise<BookingRow[]> {
    const result = await client.query<BookingRow>(
      `${BOOKING_SELECT}
        WHERE b.id = ANY($1::uuid[])
        ORDER BY b.id
        FOR UPDATE OF b`,
      [bookingIds]
    );
    return result.rows;
  }

  async markReleased(
    client: PoolClient,
    bookingIds: readonly string[],
    releasedAt: Date
  ): Promise<ReleasedRow[]> {
    const result = await client.query<ReleasedRow>(
      `UPDATE bookings
          SET settlement_status = 'released',
              released_at = $2,
              updated_at = now(),
              row_version = row_version + 1
        WHERE id = ANY($1::uuid[])
          AND settlement_status = 'held'
        RETURNING id, code, settlement_status, released_at`,
      [bookingIds, releasedAt]
    );
    return result.rows;
  }

  /**
   * Resolves an operator by user id or by display name. The panel sends the
   * name from its operator dropdown, so both forms are accepted; the caller
   * rejects ambiguous names instead of guessing.
   */
  async findAdminUsers(client: PoolClient, identifier: string): Promise<AdminUserRow[]> {
    const sql = `
      SELECT u.id,
             COALESCE(NULLIF(u.name, ''), u.phone) AS name,
             COALESCE(array_agg(r.role::text) FILTER (WHERE r.role IS NOT NULL), '{}') AS roles
        FROM users u
        LEFT JOIN user_roles r
          ON r.user_id = u.id
         AND r.revoked_at IS NULL
       WHERE u.status = 'active'
         AND ${isUuid(identifier) ? 'u.id = $1::uuid' : 'lower(u.name) = lower($1)'}
       GROUP BY u.id
       ORDER BY u.id
    `;
    const result = await client.query<AdminUserRow>(sql, [identifier]);
    return result.rows;
  }

  async insertStatusHistory(
    client: PoolClient,
    entry: {
      bookingId: string;
      from: string | null;
      to: string;
      event: string;
      actorId: string | null;
      actorRole: string | null;
      note: string;
    }
  ): Promise<void> {
    await client.query(
      `INSERT INTO booking_status_history
         (booking_id, axis, from_state, to_state, event, actor_id, actor_role, note)
       VALUES ($1::uuid, 'settlement', $2, $3, $4, $5::uuid, $6::user_role, $7)`,
      [
        entry.bookingId,
        entry.from,
        entry.to,
        entry.event,
        entry.actorId,
        entry.actorRole,
        entry.note
      ]
    );
  }

  /** `audit_logs.prev_hash`/`row_hash` are filled by the DB hash-chain trigger. */
  async insertAudit(
    client: PoolClient,
    entry: {
      actorId: string | null;
      actorRole: string | null;
      action: string;
      entityType: string;
      entityId: string | null;
      beforeState: unknown;
      afterState: unknown;
      requestId: string | null;
    }
  ): Promise<void> {
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

  /* --------------------------------------------------------------- settings */

  async settingsRows(keys: readonly string[]): Promise<SettingsRow[]> {
    return query<SettingsRow>(
      `SELECT key, value FROM platform_settings WHERE key = ANY($1::text[])`,
      [keys]
    );
  }

  async upsertSetting(client: PoolClient, write: SettingWrite, actorId: string | null): Promise<void> {
    await client.query(
      `INSERT INTO platform_settings (key, value, is_public, description, updated_by, updated_at)
       VALUES ($1, $2::jsonb, $3, $4, $5::uuid, now())
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value,
             updated_by = EXCLUDED.updated_by,
             updated_at = now()`,
      [write.key, JSON.stringify(write.value), write.isPublic, write.description, actorId]
    );
  }

  /* ------------------------------------------------------- secondary reads */

  async payments(): Promise<PaymentRow[]> {
    return query<PaymentRow>(
      `SELECT * FROM (${PAYMENT_UNION}) payments_view
        ORDER BY COALESCE(paid_at, created_at) DESC
        LIMIT 500`
    );
  }

  async disputes(): Promise<DisputeRow[]> {
    return query<DisputeRow>(`${DISPUTE_SELECT} ORDER BY d.opened_at DESC LIMIT 500`);
  }

  async auditEvents(limit: number): Promise<{ events: AuditEventRow[]; total: number }> {
    const events = await query<AuditEventRow>(
      `SELECT h.id::text AS id,
              h.booking_id,
              b.code AS booking_code,
              h.axis::text AS axis,
              h.from_state AS from_status,
              h.to_state AS to_status,
              COALESCE(NULLIF(u.name, ''), u.phone, 'Sistem') AS actor,
              h.created_at AS at,
              h.note
         FROM booking_status_history h
         JOIN bookings b ON b.id = h.booking_id
         LEFT JOIN users u ON u.id = h.actor_id
        ORDER BY h.id DESC
        LIMIT $1`,
      [limit]
    );
    const totals = await query<{ total: number }>(
      `SELECT count(*)::int AS total FROM booking_status_history`
    );
    return { events, total: totals[0]?.total ?? 0 };
  }

  /** `audit_logs` real columns: entity_type/entity_id/before_state/after_state. */
  async auditActions(limit: number): Promise<AuditActionRow[]> {
    return query<AuditActionRow>(
      `SELECT a.seq::text AS seq,
              a.created_at,
              a.actor_id,
              COALESCE(NULLIF(u.name, ''), u.email, u.phone, a.actor_id::text) AS actor_label,
              a.actor_role::text AS actor_role,
              a.action,
              a.entity_type,
              a.entity_id,
              a.before_state,
              a.after_state,
              a.request_id
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.actor_id
        ORDER BY a.seq DESC
        LIMIT $1`,
      [limit]
    );
  }

  async operators(): Promise<OperatorRow[]> {
    return query<OperatorRow>(
      `SELECT u.id,
              COALESCE(NULLIF(u.name, ''), u.phone) AS name,
              min(r.role::text) AS role
         FROM users u
         JOIN user_roles r ON r.user_id = u.id AND r.revoked_at IS NULL
        WHERE r.role IN ('admin_support', 'admin_finance', 'admin_super')
          AND u.status = 'active'
        GROUP BY u.id
        ORDER BY name ASC`
    );
  }

  async ledger(limit: number): Promise<LedgerResult> {
    const entries = await query<JournalEntryRow>(
      `${JOURNAL_SELECT} ORDER BY e.occurred_at DESC, e.id DESC LIMIT $1`,
      [limit]
    );
    const [lines, accounts] = await Promise.all([
      this.linesFor(entries.map((entry) => entry.id)),
      query<AccountRow>(
        `SELECT code, name, account_type::text AS account_type,
                normal_balance::text AS normal_balance
           FROM chart_of_accounts
          ORDER BY code ASC`
      )
    ]);
    return { entries, lines, accounts };
  }

  async linesFor(entryIds: readonly string[]): Promise<JournalLineRow[]> {
    if (entryIds.length === 0) return [];
    return query<JournalLineRow>(
      `SELECT l.journal_entry_id,
              l.line_no,
              l.account_code,
              a.name AS account_name,
              l.debit_idr,
              l.credit_idr,
              l.memo
         FROM journal_lines l
         JOIN chart_of_accounts a ON a.code = l.account_code
        WHERE l.journal_entry_id = ANY($1::uuid[])
        ORDER BY l.journal_entry_id, l.line_no`,
      [entryIds]
    );
  }
}
