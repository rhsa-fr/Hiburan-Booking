/**
 * Admin orchestration.
 *
 * Reads are composed from the repository and mapped to the panel contract.
 * The release path is the only writer: it runs in ONE transaction, re-validates
 * every booking under `FOR UPDATE`, posts the ledger entry through
 * `buildEntry('release', …)` + `postEntry`, flips `settlement_status`, writes
 * booking history and the maker/checker audit rows, and is protected by a
 * mandatory `Idempotency-Key` whose completion commits with the same tx.
 */
import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { withTransaction } from '@tarlink/core/db';
import { AppError } from '@tarlink/core/errors';
import { postEntry } from '@tarlink/modules/ledger';
import { PaymentService } from '@tarlink/modules/payment';
import { IdempotencyService, PgIdempotencyStore } from '@tarlink/platform/idempotency';
import { AdminRepository } from './admin.repository';
import type {
  ActionQueueItem,
  AuditEvent,
  AuditLog,
  Booking,
  BookingDetail,
  BookingFilters,
  DashboardSummary,
  DisputeOverview,
  JournalEntry,
  LedgerData,
  Operator,
  Paginated,
  Payment,
  PaymentKindSummary,
  PaymentsOverview,
  PlatformSettings,
  QueueKind,
  ReleaseCandidate,
  ReleaseInput,
  ReleaseJournal,
  ReleasePreview,
  ReleaseQueue,
  ReleaseResult,
  Severity,
  Vendor,
  VendorDetail,
  VendorFilters
} from './contracts';
import {
  RELEASE_MAX_BATCH,
  assertReleaseOperators,
  buildReleaseJournalPlan,
  evaluateReleaseEligibility,
  validateReleaseRequest,
  type AdminIdentity,
  type ValidatedReleaseRequest
} from './eligibility';
import { dayLabel, formatIdr, paymentLabel, PAYMENT_MIX_ORDER } from './display';
import {
  mapAccount,
  mapAuditAction,
  mapBooking,
  mapDispute,
  mapJournalEntry,
  mapPayment,
  mapVendor,
  toIsoRequired
} from './mappers';
import { idrOrZero, idrToJson, sumIdr, toIdr } from './money';
import type {
  BookingRow,
  JournalEntryRow,
  JournalLineRow,
  StatusHistoryRow
} from './rows';
import {
  SETTING_KEYS,
  settingsFromRows,
  settingsToWrites,
  validateSettings
} from './settings';

export interface ReleaseContext {
  actorId: string;
  idempotencyKey: string;
  requestId: string | null;
}

export interface SettingsContext {
  actorId: string;
  requestId: string | null;
}

export interface SettleActor {
  id: string;
  role: 'admin_finance' | 'admin_super';
}

export interface SettleManualBody {
  amount_idr: number;
  method: 'transfer_manual' | 'cash';
  reference?: string;
  note?: string;
}

export interface SettleBookingResult {
  booking_id: string;
  payment_id: string;
  journal_entry_id: string;
  payment_status: 'fully_paid';
  outstanding_before_idr: bigint;
  already_settled: boolean;
}

const SETTLE_MANUAL_BODY = z.object({
  amount_idr: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  method: z.enum(['transfer_manual', 'cash']),
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional()
});

/** Validates the settle DTO at the HTTP boundary; messages are read by operators. */
export function parseSettleManualBody(body: unknown): SettleManualBody {
  const parsed = SETTLE_MANUAL_BODY.safeParse(body);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    const message =
      field === 'amount_idr'
        ? 'Nominal pelunasan harus bilangan bulat lebih dari 0.'
        : field === 'method'
          ? 'Metode pelunasan harus transfer_manual atau cash.'
          : field === 'reference'
            ? 'Referensi maksimal 120 karakter.'
            : field === 'note'
              ? 'Catatan maksimal 500 karakter.'
              : 'Data pelunasan tidak valid.';
    throw new AppError('VALIDATION_ERROR', message, parsed.error.issues);
  }
  return parsed.data;
}

const RELEASE_SCOPE = 'POST /admin/release';
const QUEUE_LIMIT = 5;
const AUDIT_LIMIT = 200;
const AUDIT_ACTION_LIMIT = 50;
const LEDGER_LIMIT = 500;

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const id = key(item);
    const bucket = map.get(id);
    if (bucket) bucket.push(item);
    else map.set(id, [item]);
  }
  return map;
}

function asQueueKind(kind: string): QueueKind {
  switch (kind) {
    case 'release':
    case 'dp':
    case 'dispute':
    case 'response':
    case 'counter':
      return kind;
    default:
      throw new AppError('INTERNAL_ERROR', `unknown action queue kind ${kind}`);
  }
}

function asSeverity(value: string): Severity {
  if (value === 'info' || value === 'attention' || value === 'danger') return value;
  throw new AppError('INTERNAL_ERROR', `unknown severity ${value}`);
}

function actionLabel(kind: QueueKind): string {
  if (kind === 'release') return 'Tinjau pencairan';
  if (kind === 'dispute') return 'Buka sengketa';
  return 'Lihat booking';
}

function bookingHistories(
  histories: readonly StatusHistoryRow[]
): Map<string, StatusHistoryRow[]> {
  return groupBy(histories, (entry) => entry.booking_id);
}

@Injectable()
export class AdminService {
  constructor(
    private readonly repository: AdminRepository,
    private readonly payment: PaymentService
  ) {}

  /* -------------------------------------------------------------- dashboard */

  async dashboard(): Promise<DashboardSummary> {
    const now = new Date();
    const [kpis, health, queueRows, mix, daily7, daily30] = await Promise.all([
      this.repository.kpis(),
      this.repository.health(),
      this.repository.queue(QUEUE_LIMIT),
      this.repository.paymentMix(),
      this.repository.dailyBookings(7),
      this.repository.dailyBookings(30)
    ]);

    const mixCounts = new Map(mix.map((row) => [row.status, row.count]));
    const queue: ActionQueueItem[] = queueRows.map((row) => {
      const kind = asQueueKind(row.kind);
      const amount = row.amount_idr === null ? null : idrToJson(row.amount_idr, 'queue.amount_idr');
      const detail =
        amount !== null && (kind === 'dp' || kind === 'release')
          ? `${row.detail} · ${kind === 'dp' ? 'DP' : 'hak vendor'} ${formatIdr(amount)}`
          : row.detail;

      return {
        id: `q-${row.booking_id}-${kind}`,
        booking_id: row.booking_id,
        code: row.code,
        kind,
        title: row.title,
        detail,
        due_at: toIsoRequired(row.due_at),
        severity: asSeverity(row.severity),
        action_label: actionLabel(kind),
        href: `/bookings?code=${encodeURIComponent(row.code)}`
      };
    });

    return {
      as_of: now.toISOString(),
      kpis: {
        bookings_today: kpis.bookings_today,
        bookings_today_needs_response: kpis.bookings_today_needs_response,
        awaiting_dp: kpis.awaiting_dp,
        awaiting_dp_overdue: kpis.awaiting_dp_overdue,
        ready_to_release: kpis.ready_to_release,
        ready_to_release_idr: idrOrZero(kpis.ready_to_release_idr, 'ready_to_release_idr'),
        open_disputes: kpis.open_disputes,
        oldest_dispute_due_at: kpis.oldest_dispute_due_at
          ? toIsoRequired(kpis.oldest_dispute_due_at)
          : null
      },
      queue,
      health: {
        response_rate_bp: health.response_rate_bp,
        response_target_bp: 9000,
        dp_conversion_bp: health.dp_conversion_bp,
        dp_target_bp: 5000,
        // The exclusion constraints on booking_slots/calendar_slots make a
        // double booking impossible at the schema level; there is nothing to
        // count from the data, so the truthful value is 0.
        double_bookings: 0,
        median_response_minutes: health.median_response_minutes
      },
      daily_bookings_7d: daily7.map((row) => ({
        date: row.date,
        label: dayLabel(row.date),
        count: row.count
      })),
      daily_bookings_30d: daily30.map((row) => ({
        date: row.date,
        label: dayLabel(row.date),
        count: row.count
      })),
      payment_mix: PAYMENT_MIX_ORDER.map((status) => ({
        status,
        label: paymentLabel(status),
        count: mixCounts.get(status) ?? 0
      }))
    };
  }

  /* --------------------------------------------------------------- bookings */

  async bookings(filters: BookingFilters): Promise<Paginated<Booking>> {
    const { rows, total, histories } = await this.repository.listBookings(filters);
    const history = bookingHistories(histories);

    return {
      items: rows.map((row) => mapBooking(row, history.get(row.id) ?? [])),
      total,
      page: filters.page,
      page_size: filters.page_size
    };
  }

  async booking(identifier: string): Promise<BookingDetail> {
    const row = await this.repository.findBooking(identifier);
    if (!row) {
      throw new AppError('NOT_FOUND', 'Booking tidak ditemukan. Tautan mungkin sudah kedaluwarsa.');
    }

    const [histories, payments, dispute, journal] = await Promise.all([
      this.repository.historiesFor([row.id]),
      this.repository.bookingPayments(row.id),
      this.repository.bookingDispute(row.id),
      this.repository.bookingJournalEntries(row.id)
    ]);

    return {
      booking: mapBooking(row, histories),
      payments: payments.map(mapPayment),
      dispute: dispute ? mapDispute(dispute) : null,
      journal_entries: groupJournalEntries(journal.entries, journal.lines),
      outstanding_idr: idrToJson(
        toIdr(row.total_customer_idr, 'booking.total_customer_idr') -
          toIdr(row.dp_amount_idr, 'booking.dp_amount_idr'),
        'outstanding_idr'
      )
    };
  }

  /**
   * Manual settlement for a late-paying customer.
   *
   * The journal, payment row, booking flip and audit row ride ONE transaction
   * inside `PaymentService.settleManual`: a failed audit insert rolls the money
   * back instead of leaving it committed without a trail.
   */
  async settleBookingManual(
    bookingId: string,
    body: unknown,
    actor: SettleActor,
    requestId: string | null = null
  ): Promise<SettleBookingResult> {
    const input = parseSettleManualBody(body);
    const before = await this.repository.findBooking(bookingId);
    if (!before) {
      throw new AppError('NOT_FOUND', 'Booking tidak ditemukan.');
    }

    const outstanding =
      toIdr(before.total_customer_idr, 'booking.total_customer_idr') -
      toIdr(before.dp_amount_idr, 'booking.dp_amount_idr');
    const amount = BigInt(input.amount_idr);
    if (amount !== outstanding) {
      throw new AppError(
        'CONFLICT',
        `Nominal pelunasan harus sama dengan sisa tagihan (${outstanding.toString()}).`
      );
    }

    // `audit_logs.request_id` is VARCHAR(40): never let a long header break a write.
    const auditRequestId = requestId ? requestId.slice(0, 40) : null;

    const settled = await this.payment.settleManual({
      bookingId: before.id,
      amountIdr: amount,
      method: input.method,
      reference: input.reference ?? null,
      note: input.note ?? null,
      actorId: actor.id,
      audit: {
        action: 'booking.settle_manual',
        actorId: actor.id,
        actorRole: actor.role,
        requestId: auditRequestId,
        payload: {
          payment_status: 'fully_paid',
          amount_idr: input.amount_idr,
          method: input.method,
          reference: input.reference ?? null
        }
      }
    });

    if (settled.alreadySettled) {
      if (before.payment_status === 'dp_paid') {
        // Another operator settled it between our read and the locked write.
        throw new AppError(
          'CONFLICT',
          'Booking sudah dilunasi oleh operator lain. Muat ulang halaman.'
        );
      }
      return {
        booking_id: settled.bookingId,
        payment_id: settled.paymentId,
        journal_entry_id: settled.journalEntryId,
        payment_status: 'fully_paid',
        outstanding_before_idr: settled.outstandingBeforeIdr,
        already_settled: true
      };
    }

    return {
      booking_id: settled.bookingId,
      payment_id: settled.paymentId,
      journal_entry_id: settled.journalEntryId,
      payment_status: 'fully_paid',
      outstanding_before_idr: settled.outstandingBeforeIdr,
      already_settled: false
    };
  }

  /* ---------------------------------------------------------------- vendors */

  async vendors(filters: VendorFilters): Promise<Paginated<Vendor>> {
    const rows = await this.repository.listVendors(filters);
    return {
      items: rows.map(mapVendor),
      total: rows.length,
      page: 1,
      page_size: rows.length
    };
  }

  async vendor(identifier: string): Promise<VendorDetail> {
    const row = await this.repository.findVendor(identifier);
    if (!row) throw new AppError('NOT_FOUND', 'Vendor tidak ditemukan.');

    const recent = await this.repository.vendorRecentBookings(row.id, 3);
    const histories = await this.repository.historiesFor(recent.map((booking) => booking.id));
    const history = bookingHistories(histories);

    return {
      vendor: mapVendor(row),
      recent_bookings: recent.map((booking) => mapBooking(booking, history.get(booking.id) ?? []))
    };
  }

  /* ---------------------------------------------------------------- release */

  async releaseQueue(): Promise<ReleaseQueue> {
    const now = new Date();
    const rows = await this.repository.releaseCandidates();
    const histories = await this.repository.historiesFor(rows.map((row) => row.id));
    const history = bookingHistories(histories);

    const candidates: ReleaseCandidate[] = rows.map((row) => {
      const eligibility = evaluateReleaseEligibility(row, now);
      return {
        booking: mapBooking(row, history.get(row.id) ?? []),
        eligible: eligibility.eligible,
        blocked_reason: eligibility.blocked_reason,
        window_ends_at: row.dispute_window_ends_at
          ? toIsoRequired(row.dispute_window_ends_at)
          : null
      };
    });

    return { max_batch: RELEASE_MAX_BATCH, candidates };
  }

  async previewRelease(input: ReleaseInput): Promise<ReleasePreview> {
    const request = validateReleaseRequest(input);
    const bookings = await this.bookingsForPreview(request.bookingIds);
    const now = new Date();

    const journals: ReleaseJournal[] = [];
    let totalEntitlement = 0n;
    let totalDebit = 0n;
    let totalCredit = 0n;

    for (const booking of bookings) {
      const plan = buildReleaseJournalPlan(
        booking,
        now,
        `Pratinjau release ${booking.code}: ${request.reason}`
      );
      journals.push(plan.journal);
      totalEntitlement += plan.vendorPayableIdr;
      totalDebit += plan.debitTotalIdr;
      totalCredit += plan.creditTotalIdr;
    }

    return {
      journals,
      total_entitlement_idr: idrToJson(totalEntitlement, 'total_entitlement_idr'),
      total_debit_idr: idrToJson(totalDebit, 'total_debit_idr'),
      total_credit_idr: idrToJson(totalCredit, 'total_credit_idr'),
      maker: request.maker,
      checker: request.checker
    };
  }

  async release(input: ReleaseInput, context: ReleaseContext): Promise<ReleaseResult> {
    const request = validateReleaseRequest(input);
    const requestHash = hashReleaseRequest(request);
    const occurredAt = new Date();

    return withTransaction(async (client) => {
      const store = new PgIdempotencyStore(client);
      const idempotency = new IdempotencyService(store, { actorId: context.actorId });

      return idempotency.run(context.idempotencyKey, RELEASE_SCOPE, requestHash, () =>
        this.executeRelease(client, request, occurredAt, context)
      );
    });
  }

  /** Runs inside the release transaction. Only ever called by `release()`. */
  private async executeRelease(
    client: PoolClient,
    request: ValidatedReleaseRequest,
    occurredAt: Date,
    context: ReleaseContext
  ): Promise<ReleaseResult> {
    const maker = await this.resolveOperator(client, request.maker, 'Maker');
    const checker = await this.resolveOperator(client, request.checker, 'Checker');
    if (!maker) {
      throw new AppError('VALIDATION_ERROR', 'Maker tidak ditemukan atau tidak aktif.');
    }
    if (!checker) {
      throw new AppError('VALIDATION_ERROR', 'Checker tidak ditemukan atau tidak aktif.');
    }
    const { makerRole, checkerRole } = assertReleaseOperators(maker, checker);

    const bookings = await this.repository.lockBookings(client, request.bookingIds);
    if (bookings.length !== request.bookingIds.length) {
      throw new AppError(
        'NOT_FOUND',
        'Salah satu booking tidak ditemukan. Muat ulang antrean.'
      );
    }

    const byId = new Map(bookings.map((booking) => [booking.id, booking]));
    const ordered: BookingRow[] = [];
    for (const id of request.bookingIds) {
      const booking = byId.get(id);
      if (!booking) {
        throw new AppError('NOT_FOUND', 'Salah satu booking tidak ditemukan. Muat ulang antrean.');
      }
      ordered.push(booking);
    }

    for (const booking of ordered) {
      const eligibility = evaluateReleaseEligibility(booking, occurredAt);
      if (!eligibility.eligible) {
        throw new AppError(
          'CONFLICT',
          `${booking.code} tidak bisa dicairkan: ${eligibility.blocked_reason ?? 'tidak memenuhi syarat'}.`
        );
      }
    }

    const journalEntryIds: string[] = [];
    const journalCodes: string[] = [];
    let totalDebit = 0n;
    let totalCredit = 0n;
    let totalEntitlement = 0n;

    for (const booking of ordered) {
      const plan = buildReleaseJournalPlan(
        booking,
        occurredAt,
        `Release manual ${booking.code}: ${request.reason}`
      );
      const posted = await postEntry(client, plan.draft);
      if (!posted.inserted) {
        // The booking is still `held` yet the release entry already exists:
        // a partial earlier attempt left inconsistent state. Never double-post.
        throw new AppError(
          'CONFLICT',
          `Jurnal release untuk ${booking.code} sudah ada tetapi settlement masih held. Periksa rekonsiliasi.`
        );
      }

      journalEntryIds.push(posted.id);
      journalCodes.push(`JE-${posted.entryNo}`);
      totalDebit += plan.debitTotalIdr;
      totalCredit += plan.creditTotalIdr;
      totalEntitlement += plan.vendorPayableIdr;

      await this.repository.insertStatusHistory(client, {
        bookingId: booking.id,
        from: 'held',
        to: 'released',
        event: 'settlement.release_manual',
        actorId: checker.id,
        actorRole: checkerRole,
        note: `Maker ${maker.name} → checker ${checker.name}: ${request.reason}`
      });
    }

    const released = await this.repository.markReleased(
      client,
      ordered.map((booking) => booking.id),
      occurredAt
    );
    if (released.length !== ordered.length) {
      throw new AppError(
        'CONFLICT',
        'Sebagian booking berubah status saat pencairan. Ulangi dari antrean.'
      );
    }

    const releasedCodes = ordered.map((booking) => booking.code);
    const audited = {
      booking_ids: ordered.map((booking) => booking.id),
      booking_codes: releasedCodes,
      journal_entry_ids: journalEntryIds,
      journal_codes: journalCodes,
      total_debit_idr: idrToJson(totalDebit, 'total_debit_idr'),
      total_credit_idr: idrToJson(totalCredit, 'total_credit_idr'),
      total_entitlement_idr: idrToJson(totalEntitlement, 'total_entitlement_idr'),
      reason: request.reason,
      released_at: occurredAt.toISOString(),
      requested_by: context.actorId
    };

    await this.repository.insertAudit(client, {
      actorId: maker.id,
      actorRole: makerRole,
      action: 'release.maker_submitted',
      entityType: 'booking_release_batch',
      entityId: null,
      beforeState: { settlement_status: 'held' },
      afterState: audited,
      requestId: context.requestId
    });

    await this.repository.insertAudit(client, {
      actorId: checker.id,
      actorRole: checkerRole,
      action: 'release.checker_approved',
      entityType: 'booking_release_batch',
      entityId: null,
      beforeState: { settlement_status: 'held' },
      afterState: audited,
      requestId: context.requestId
    });

    return {
      released_booking_codes: releasedCodes,
      journal_codes: journalCodes,
      released_at: occurredAt.toISOString(),
      checker: checker.name,
      reason: request.reason,
      released_booking_ids: audited.booking_ids,
      journal_entry_ids: journalEntryIds,
      maker: maker.name,
      total_debit_idr: audited.total_debit_idr,
      total_credit_idr: audited.total_credit_idr,
      total_entitlement_idr: audited.total_entitlement_idr
    };
  }

  private async bookingsForPreview(bookingIds: readonly string[]): Promise<BookingRow[]> {
    const rows = await this.repository.findBookingsByIds(bookingIds);
    if (rows.length !== bookingIds.length) {
      throw new AppError(
        'NOT_FOUND',
        'Salah satu booking tidak ditemukan. Muat ulang antrean.'
      );
    }
    const byId = new Map(rows.map((row) => [row.id, row]));
    return bookingIds.map((id) => {
      const row = byId.get(id);
      if (!row) throw new AppError('NOT_FOUND', 'Salah satu booking tidak ditemukan.');
      return row;
    });
  }

  private async resolveOperator(
    client: PoolClient,
    identifier: string,
    label: 'Maker' | 'Checker'
  ): Promise<AdminIdentity | null> {
    const rows = await this.repository.findAdminUsers(client, identifier);
    if (rows.length === 0) return null;
    if (rows.length > 1) {
      throw new AppError(
        'CONFLICT',
        `${label} "${identifier}" cocok dengan lebih dari satu pengguna. Gunakan id pengguna.`
      );
    }
    const row = rows[0];
    if (!row) return null;
    return { id: row.id, name: row.name, roles: row.roles };
  }

  /* ----------------------------------------------------------------- ledger */

  async ledger(): Promise<LedgerData> {
    const result = await this.repository.ledger(LEDGER_LIMIT);
    return {
      entries: groupJournalEntries(result.entries, result.lines),
      accounts: result.accounts.map(mapAccount)
    };
  }

  async payments(): Promise<PaymentsOverview> {
    const rows = await this.repository.payments();
    const items: Payment[] = rows.map(mapPayment);
    const kinds: Array<{ kind: Payment['kind']; label: string }> = [
      { kind: 'dp', label: 'DP' },
      { kind: 'settlement', label: 'Pelunasan' },
      { kind: 'refund', label: 'Refund' }
    ];

    const byKind: PaymentKindSummary[] = kinds.map(({ kind, label }) => {
      const matching = items.filter((item) => item.kind === kind);
      return {
        kind,
        label,
        count: matching.length,
        amount_idr: sumIdr(
          matching.map((item) => item.amount_idr),
          `${kind}.amount_idr`
        )
      };
    });

    return {
      items,
      total_idr: sumIdr(
        items.map((item) => item.amount_idr),
        'payments.total_idr'
      ),
      by_kind: byKind
    };
  }

  async disputes(): Promise<DisputeOverview> {
    const rows = await this.repository.disputes();
    const items = rows.map(mapDispute);
    return {
      items,
      open_count: items.filter((item) => item.status === 'open').length,
      // bigint summation: never add money as JS numbers.
      total_idr: sumIdr(
        items.flatMap((item) => [item.customer_share_idr, item.vendor_share_idr]),
        'disputes.total_idr'
      )
    };
  }

  async audit(): Promise<AuditLog> {
    const [{ events, total }, actions] = await Promise.all([
      this.repository.auditEvents(AUDIT_LIMIT),
      this.repository.auditActions(AUDIT_ACTION_LIMIT)
    ]);
    const mapped: AuditEvent[] = events.map((event) => ({
      id: event.id,
      booking_id: event.booking_id,
      booking_code: event.booking_code,
      axis: event.axis,
      from_status: event.from_status ?? '',
      to_status: event.to_status,
      actor: event.actor ?? 'Sistem',
      at: toIsoRequired(event.at),
      note: event.note
    }));
    return { events: mapped, total, actions: actions.map(mapAuditAction) };
  }

  async operators(): Promise<Operator[]> {
    const rows = await this.repository.operators();
    return rows.map((row) => ({ id: row.id, name: row.name, role: row.role }));
  }

  /* --------------------------------------------------------------- settings */

  async settings(): Promise<PlatformSettings> {
    const keys = Object.values(SETTING_KEYS);
    return settingsFromRows(await this.repository.settingsRows(keys));
  }

  async saveSettings(input: unknown, context: SettingsContext): Promise<PlatformSettings> {
    const next = validateSettings(input);
    const keys = Object.values(SETTING_KEYS);
    const before = settingsFromRows(await this.repository.settingsRows(keys));

    await withTransaction(async (client) => {
      for (const write of settingsToWrites(next)) {
        await this.repository.upsertSetting(client, write, context.actorId);
      }
      await this.repository.insertAudit(client, {
        actorId: context.actorId,
        actorRole: null,
        action: 'platform_settings.update',
        entityType: 'platform_settings',
        entityId: 'global',
        beforeState: before,
        afterState: next,
        requestId: context.requestId
      });
    });

    return next;
  }
}

function groupJournalEntries(
  entries: readonly JournalEntryRow[],
  lines: readonly JournalLineRow[]
): JournalEntry[] {
  const byEntry = groupBy(lines, (line) => line.journal_entry_id);
  return entries.map((entry) => mapJournalEntry(entry, byEntry.get(entry.id) ?? []));
}

/** Stable request hash for the idempotency store (sha256 hex). */
export function hashReleaseRequest(request: ValidatedReleaseRequest): string {
  const payload = JSON.stringify({
    booking_ids: request.bookingIds,
    reason: request.reason,
    maker: request.maker,
    checker: request.checker
  });
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

export { RELEASE_MAX_BATCH };
