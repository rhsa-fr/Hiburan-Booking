import type { Pool, PoolClient } from 'pg';
import { AppError } from '@tarlink/core/errors';
import type { AuditInput, VendorRef } from './bank-accounts.repository';
import { readSettingInt, type SettingField } from './settings-reader';

export type PayoutStatus =
  | 'requested'
  | 'approved'
  | 'processing'
  | 'paid'
  | 'failed'
  | 'rejected'
  | 'cancelled';

export interface PayoutRow {
  readonly id: string;
  readonly code: string;
  readonly vendor_id: string;
  readonly vendor_name: string | null;
  readonly bank_account_id: string;
  readonly bank_code: string;
  readonly bank_name: string;
  readonly account_number_masked: string;
  readonly account_holder_name: string;
  readonly amount_idr: string;
  readonly currency: string;
  readonly status: PayoutStatus;
  readonly provider: string;
  readonly provider_ref: string | null;
  readonly provider_payout_id: string | null;
  readonly failure_code: string | null;
  readonly failure_reason: string | null;
  readonly requested_by: string;
  readonly requested_by_name: string | null;
  readonly approved_by: string | null;
  readonly approved_by_name: string | null;
  readonly approved_at: Date | null;
  readonly processed_at: Date | null;
  readonly paid_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export interface PayoutItemRow {
  readonly booking_id: string;
  readonly booking_code: string;
  readonly amount_idr: string;
  readonly released_at: Date | null;
  readonly voided_at: Date | null;
}

export interface EligibleBookingRow {
  readonly booking_id: string;
  readonly booking_code: string;
  readonly amount_idr: string;
  readonly released_at: Date | null;
  readonly event_title: string | null;
}

export interface PayoutFilters {
  readonly status?: PayoutStatus | null;
  readonly vendor_id?: string | null;
  readonly page: number;
  readonly page_size: number;
}

export interface JournalHeaderRow {
  readonly id: string;
  readonly event_type: string;
  readonly source_event_key: string;
  readonly reference_type: string;
  readonly reference_id: string | null;
  readonly booking_id: string | null;
  readonly vendor_id: string | null;
  readonly memo: string | null;
  readonly occurred_at: Date;
}

export interface JournalLineRow {
  readonly line_no: number;
  readonly account_code: string;
  readonly line_vendor_id: string | null;
  readonly debit_idr: string;
  readonly credit_idr: string;
  readonly line_memo: string | null;
}

export interface PayoutJournalRow {
  readonly id: string;
  readonly event_type: string;
  readonly source_event_key: string;
  readonly occurred_at: Date;
  readonly memo: string | null;
  readonly line_no: number;
  readonly account_code: string;
  readonly line_vendor_id: string | null;
  readonly debit_idr: string;
  readonly credit_idr: string;
  readonly line_memo: string | null;
}

const SELECT_COLUMNS = `
       p.id, p.code, p.vendor_id, v.display_name AS vendor_name,
       p.bank_account_id, ba.bank_code, ba.bank_name,
       ba.account_number_masked, ba.account_holder_name,
       p.amount_idr::text AS amount_idr, p.currency, p.status::text AS status,
       p.provider, p.provider_ref, p.provider_payout_id,
       p.failure_code, p.failure_reason,
       p.requested_by, ru.name AS requested_by_name,
       p.approved_by, au.name AS approved_by_name,
       p.approved_at, p.processed_at, p.paid_at, p.created_at, p.updated_at`;

const SELECT_FROM = `
  FROM payouts p
  JOIN vendors v ON v.id = p.vendor_id
  JOIN vendor_bank_accounts ba ON ba.id = p.bank_account_id
  LEFT JOIN users ru ON ru.id = p.requested_by
  LEFT JOIN users au ON au.id = p.approved_by`;

function isUniqueViolation(err: unknown, constraint: string): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const record = err as { code?: unknown; constraint?: unknown };
  return record.code === '23505' && record.constraint === constraint;
}

export class PayoutRepository {
  constructor(private readonly pool: Pool) {}

  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async readSetting(field: SettingField): Promise<number> {
    return readSettingInt(this.pool, field);
  }

  async findVendorByOwner(ownerUserId: string): Promise<VendorRef | null> {
    const result = await this.pool.query<VendorRef>(
      `SELECT v.id, v.display_name, v.is_active, v.verification_status::text AS verification_status
         FROM vendors v
        WHERE v.owner_user_id = $1::uuid AND v.is_active = true
        LIMIT 1`,
      [ownerUserId]
    );
    return result.rows[0] ?? null;
  }

  async findVendorById(
    vendorId: string,
    db: Pool | PoolClient = this.pool
  ): Promise<VendorRef | null> {
    const result = await db.query<VendorRef>(
      `SELECT v.id, v.display_name, v.is_active, v.verification_status::text AS verification_status
         FROM vendors v
        WHERE v.id = $1::uuid`,
      [vendorId]
    );
    return result.rows[0] ?? null;
  }

  async lockVendor(client: PoolClient, vendorId: string): Promise<VendorRef | null> {
    const result = await client.query<VendorRef>(
      `SELECT v.id, v.display_name, v.is_active, v.verification_status::text AS verification_status
         FROM vendors v
        WHERE v.id = $1::uuid
        FOR UPDATE`,
      [vendorId]
    );
    return result.rows[0] ?? null;
  }

  /** Released bookings that no active payout has claimed yet. */
  async listEligibleBookings(
    vendorId: string,
    db: Pool | PoolClient = this.pool
  ): Promise<EligibleBookingRow[]> {
    const result = await db.query<EligibleBookingRow>(
      `SELECT b.id AS booking_id,
              b.code AS booking_code,
              b.vendor_entitlement_idr::text AS amount_idr,
              b.released_at,
              e.title AS event_title
         FROM bookings b
         LEFT JOIN events e ON e.id = b.event_id
        WHERE b.vendor_id = $1::uuid
          AND b.settlement_status = 'released'
          AND b.released_at IS NOT NULL
          AND NOT EXISTS (
                SELECT 1 FROM payout_items pi
                 WHERE pi.booking_id = b.id AND pi.voided_at IS NULL)
        ORDER BY b.released_at, b.code`,
      [vendorId]
    );
    return result.rows;
  }

  /** Ledger balance of `vendor_payable` (2120) for one vendor. */
  async ledgerPayable(
    vendorId: string,
    db: Pool | PoolClient = this.pool
  ): Promise<bigint> {
    const result = await db.query<{ balance: string }>(
      `SELECT COALESCE(SUM(credit_idr - debit_idr), 0)::text AS balance
         FROM journal_lines
        WHERE account_code = '2120' AND vendor_id = $1::uuid`,
      [vendorId]
    );
    return BigInt(result.rows[0]?.balance ?? '0');
  }

  async insertPayout(
    client: PoolClient,
    input: {
      readonly id: string;
      readonly vendorId: string;
      readonly bankAccountId: string;
      readonly amountIdr: bigint;
      readonly provider: string;
      readonly requestedBy: string;
    }
  ): Promise<{ id: string; code: string }> {
    try {
      const result = await client.query<{ id: string; code: string }>(
        `INSERT INTO payouts
           (id, code, vendor_id, bank_account_id, amount_idr, provider, requested_by)
         VALUES ($1::uuid,
                 'PO-' || to_char(now(), 'YYMMDD') || '-' ||
                 lpad(nextval('payout_code_seq')::text, 4, '0'),
                 $2::uuid, $3::uuid, $4::bigint, $5, $6::uuid)
         RETURNING id, code`,
        [
          input.id,
          input.vendorId,
          input.bankAccountId,
          input.amountIdr.toString(),
          input.provider,
          input.requestedBy
        ]
      );
      return result.rows[0]!;
    } catch (err) {
      if (isUniqueViolation(err, 'payouts_one_active_per_vendor')) {
        throw new AppError(
          'CONFLICT',
          'Vendor ini masih punya payout aktif. Selesaikan atau batalkan payout tersebut dulu.'
        );
      }
      throw err;
    }
  }

  async insertItems(
    client: PoolClient,
    payoutId: string,
    items: readonly { readonly bookingId: string; readonly amountIdr: bigint }[]
  ): Promise<void> {
    if (items.length === 0) return;
    try {
      await client.query(
        `INSERT INTO payout_items (payout_id, booking_id, amount_idr)
         SELECT $1::uuid, item.booking_id::uuid, item.amount_idr::bigint
           FROM unnest($2::uuid[], $3::text[]) AS item(booking_id, amount_idr)`,
        [
          payoutId,
          items.map((item) => item.bookingId),
          items.map((item) => item.amountIdr.toString())
        ]
      );
    } catch (err) {
      if (isUniqueViolation(err, 'payout_items_booking_active_uniq')) {
        throw new AppError(
          'CONFLICT',
          'Salah satu booking sudah masuk payout lain. Muat ulang daftar booking yang bisa dicairkan.'
        );
      }
      throw err;
    }
  }

  async findById(
    payoutId: string,
    options: { readonly forUpdate?: boolean } = {},
    db: Pool | PoolClient = this.pool
  ): Promise<PayoutRow | null> {
    const result = await db.query<PayoutRow>(
      `SELECT ${SELECT_COLUMNS} ${SELECT_FROM}
        WHERE p.id = $1::uuid${options.forUpdate ? ' FOR UPDATE OF p' : ''}`,
      [payoutId]
    );
    return result.rows[0] ?? null;
  }

  async list(
    filters: PayoutFilters,
    db: Pool | PoolClient = this.pool
  ): Promise<{ rows: PayoutRow[]; total: number }> {
    const offset = (filters.page - 1) * filters.page_size;
    const result = await db.query<PayoutRow & { total_count: number }>(
      `SELECT COUNT(*) OVER()::int AS total_count, ${SELECT_COLUMNS} ${SELECT_FROM}
        WHERE ($1::text IS NULL OR p.status::text = $1)
          AND ($2::uuid IS NULL OR p.vendor_id = $2::uuid)
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT $3 OFFSET $4`,
      [filters.status ?? null, filters.vendor_id ?? null, filters.page_size, offset]
    );

    const total = result.rows[0]?.total_count;
    if (total !== undefined) {
      return { rows: result.rows, total: Number(total) };
    }

    const count = await db.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total
         FROM payouts
        WHERE ($1::text IS NULL OR status::text = $1)
          AND ($2::uuid IS NULL OR vendor_id = $2::uuid)`,
      [filters.status ?? null, filters.vendor_id ?? null]
    );
    return { rows: result.rows, total: Number(count.rows[0]?.total ?? 0) };
  }

  async listForVendor(
    vendorId: string,
    page: number,
    pageSize: number,
    db: Pool | PoolClient = this.pool
  ): Promise<{ rows: PayoutRow[]; total: number }> {
    return this.list({ vendor_id: vendorId, page, page_size: pageSize }, db);
  }

  async listItems(payoutId: string, db: Pool | PoolClient = this.pool): Promise<PayoutItemRow[]> {
    const result = await db.query<PayoutItemRow>(
      `SELECT pi.booking_id,
              b.code AS booking_code,
              pi.amount_idr::text AS amount_idr,
              b.released_at,
              pi.voided_at
         FROM payout_items pi
         JOIN bookings b ON b.id = pi.booking_id
        WHERE pi.payout_id = $1::uuid
        ORDER BY b.released_at NULLS LAST, b.code`,
      [payoutId]
    );
    return result.rows;
  }

  async markApproved(
    client: PoolClient,
    payoutId: string,
    approvedBy: string,
    at: Date
  ): Promise<boolean> {
    const result = await client.query(
      `UPDATE payouts
          SET status = 'approved', approved_by = $2::uuid, approved_at = $3::timestamptz
        WHERE id = $1::uuid AND status = 'requested'`,
      [payoutId, approvedBy, at]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async markProcessing(
    client: PoolClient,
    input: {
      readonly payoutId: string;
      readonly provider: string;
      readonly providerRef: string | null;
      readonly providerPayoutId: string | null;
      readonly at: Date;
    }
  ): Promise<boolean> {
    const result = await client.query(
      `UPDATE payouts
          SET status = 'processing',
              provider = $2,
              provider_ref = $3,
              provider_payout_id = $4,
              processed_at = $5::timestamptz
        WHERE id = $1::uuid AND status IN ('approved', 'processing')`,
      [input.payoutId, input.provider, input.providerRef, input.providerPayoutId, input.at]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async markPaid(client: PoolClient, payoutId: string, paidAt: Date): Promise<boolean> {
    const result = await client.query(
      `UPDATE payouts
          SET status = 'paid', paid_at = $2::timestamptz
        WHERE id = $1::uuid AND status IN ('approved', 'processing')`,
      [payoutId, paidAt]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async markFailed(
    client: PoolClient,
    input: {
      readonly payoutId: string;
      readonly failureCode: string;
      readonly failureReason: string | null;
    }
  ): Promise<boolean> {
    const result = await client.query(
      `UPDATE payouts
          SET status = 'failed', failure_code = $2, failure_reason = $3
        WHERE id = $1::uuid AND status IN ('approved', 'processing')`,
      [input.payoutId, input.failureCode, input.failureReason]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async markRejected(
    client: PoolClient,
    payoutId: string,
    approvedBy: string,
    reason: string,
    at: Date
  ): Promise<boolean> {
    const result = await client.query(
      `UPDATE payouts
          SET status = 'rejected',
              approved_by = $2::uuid,
              approved_at = $3::timestamptz,
              failure_code = 'REJECTED',
              failure_reason = $4
        WHERE id = $1::uuid AND status = 'requested'`,
      [payoutId, approvedBy, at, reason]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async markCancelled(client: PoolClient, payoutId: string, at: Date): Promise<boolean> {
    const result = await client.query(
      `UPDATE payouts
          SET status = 'cancelled', failure_code = 'CANCELLED', failure_reason = $2
        WHERE id = $1::uuid AND status = 'requested'`,
      [payoutId, `Dibatalkan pada ${at.toISOString()}`]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async voidItems(client: PoolClient, payoutId: string, at: Date): Promise<void> {
    await client.query(
      `UPDATE payout_items
          SET voided_at = $2::timestamptz
        WHERE payout_id = $1::uuid AND voided_at IS NULL`,
      [payoutId, at]
    );
  }

  /** Rows the worker may retry: an `approved` that never reached the provider,
   *  or a `processing` transfer whose final status is still unknown. */
  async reconcileCandidates(
    provider: string,
    limit: number,
    db: Pool | PoolClient = this.pool
  ): Promise<PayoutRow[]> {
    const result = await db.query<PayoutRow>(
      `SELECT ${SELECT_COLUMNS} ${SELECT_FROM}
        WHERE p.provider = $1
          AND p.updated_at <= now() - interval '30 seconds'
          AND p.status IN ('approved', 'processing')
        ORDER BY p.updated_at, p.id
        LIMIT $2`,
      [provider, limit]
    );
    return result.rows;
  }

  async touch(client: PoolClient, payoutId: string): Promise<void> {
    await client.query('UPDATE payouts SET updated_at = now() WHERE id = $1::uuid', [payoutId]);
  }

  async insertAudit(client: PoolClient, input: AuditInput): Promise<void> {
    await client.query(
      `INSERT INTO audit_logs
         (actor_id, actor_role, action, entity_type, entity_id,
          before_state, after_state, request_id)
       VALUES ($1::uuid, $2::user_role, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
      [
        input.actorId,
        input.actorRole,
        input.action,
        input.entityType,
        input.entityId,
        input.beforeState === undefined ? null : JSON.stringify(input.beforeState),
        input.afterState === undefined ? null : JSON.stringify(input.afterState),
        input.requestId ?? null
      ]
    );
  }

  async payoutJournal(
    payoutId: string,
    db: Pool | PoolClient = this.pool
  ): Promise<PayoutJournalRow[]> {
    const result = await db.query<PayoutJournalRow>(
      `SELECT je.id, je.event_type, je.source_event_key, je.occurred_at, je.memo,
              jl.line_no, jl.account_code,
              jl.vendor_id AS line_vendor_id,
              jl.debit_idr::text AS debit_idr,
              jl.credit_idr::text AS credit_idr,
              jl.memo AS line_memo
         FROM journal_entries je
         JOIN journal_lines jl ON jl.journal_entry_id = je.id
        WHERE je.reference_type = 'payout' AND je.reference_id = $1::uuid
        ORDER BY je.id, jl.line_no`,
      [payoutId]
    );
    return result.rows;
  }

  async loadJournalEntry(
    sourceEventKey: string,
    db: Pool | PoolClient = this.pool
  ): Promise<{ header: JournalHeaderRow; lines: JournalLineRow[] } | null> {
    const result = await db.query<JournalHeaderRow & JournalLineRow>(
      `SELECT je.id, je.event_type, je.source_event_key, je.reference_type,
              je.reference_id, je.booking_id, je.vendor_id, je.memo, je.occurred_at,
              jl.line_no, jl.account_code,
              jl.vendor_id AS line_vendor_id,
              jl.debit_idr::text AS debit_idr,
              jl.credit_idr::text AS credit_idr,
              jl.memo AS line_memo
         FROM journal_entries je
         JOIN journal_lines jl ON jl.journal_entry_id = je.id
        WHERE je.source_event_key = $1
        ORDER BY jl.line_no`,
      [sourceEventKey]
    );
    if (result.rows.length === 0) return null;

    const first = result.rows[0]!;
    return {
      header: {
        id: first.id,
        event_type: first.event_type,
        source_event_key: first.source_event_key,
        reference_type: first.reference_type,
        reference_id: first.reference_id,
        booking_id: first.booking_id,
        vendor_id: first.vendor_id,
        memo: first.memo,
        occurred_at: first.occurred_at
      },
      lines: result.rows
    };
  }
}
