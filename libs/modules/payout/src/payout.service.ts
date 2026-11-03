import { randomUUID } from 'node:crypto';
import { AppError } from '@tarlink/core/errors';
import { SystemClock, type Clock } from '@tarlink/platform/clock';
import type { SecretCipher } from '@tarlink/platform/crypto';
import {
  IdempotencyService,
  hashRequest,
  type IdempotencyStore
} from '@tarlink/platform/idempotency';
import {
  buildEntry,
  buildReversal,
  postEntry,
  type JournalEntryDraft,
  type JournalEventType,
  type ReferenceType
} from '@tarlink/modules/ledger';
import { idrToJson } from '../../admin/src/money';
import type { BankAccountsRepository, VendorRef } from './bank-accounts.repository';
import { bankDisplayName } from './banks';
import type { PayoutGateway, PayoutCreateResult, PayoutProviderStatus } from './payout.gateway';
import type {
  EligibleBookingRow,
  PayoutItemRow,
  PayoutJournalRow,
  PayoutRepository,
  PayoutRow,
  PayoutStatus
} from './payout.repository';

export const PAYOUT_SCOPES = {
  create: 'POST /admin/payouts',
  approve: 'POST /admin/payouts/:id/approve'
} as const;

const PAYOUT_IDEMPOTENCY_TTL_SECONDS = 7 * 24 * 60 * 60;
const WRITE_ROLES = ['admin_finance', 'admin_super'] as const;

export interface PayoutActor {
  readonly id: string;
  readonly roles: readonly string[];
}

export interface PayoutServiceDeps {
  readonly repository: PayoutRepository;
  readonly bankAccounts: BankAccountsRepository;
  readonly gateway: PayoutGateway;
  readonly cipherFactory: () => SecretCipher;
  readonly clock?: Clock;
  readonly newId?: () => string;
  readonly idempotencyStore?: IdempotencyStore;
  readonly logger?: (line: string) => void;
}

export interface PayoutItemView {
  readonly booking_id: string;
  readonly booking_code: string;
  readonly amount_idr: number;
  readonly released_at: string | null;
  readonly voided_at: string | null;
}

export interface PayoutJournalLineView {
  readonly account_code: string;
  readonly vendor_id: string | null;
  readonly debit_idr: number;
  readonly credit_idr: number;
  readonly memo: string | null;
}

export interface PayoutJournalEntryView {
  readonly id: string;
  readonly event_type: string;
  readonly source_event_key: string;
  readonly occurred_at: string;
  readonly memo: string | null;
  readonly lines: PayoutJournalLineView[];
}

export interface PayoutView {
  readonly id: string;
  readonly code: string;
  readonly vendor_id: string;
  readonly vendor_name: string | null;
  readonly status: PayoutStatus;
  readonly amount_idr: number;
  readonly currency: string;
  readonly provider: string;
  readonly provider_ref: string | null;
  readonly failure_code: string | null;
  readonly failure_reason: string | null;
  readonly bank: {
    readonly bank_code: string;
    readonly bank_name: string;
    readonly account_number_masked: string;
    readonly account_holder_name: string;
  };
  readonly requested_by: string;
  readonly requested_by_name: string | null;
  readonly approved_by: string | null;
  readonly approved_by_name: string | null;
  readonly approved_at: string | null;
  readonly processed_at: string | null;
  readonly paid_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface PayoutDetailView extends PayoutView {
  readonly items: PayoutItemView[];
  readonly journal: PayoutJournalEntryView[];
}

export interface EligiblePayoutView {
  readonly vendor_id: string;
  readonly vendor_name: string;
  readonly bank_account: {
    readonly bank_code: string;
    readonly bank_name: string;
    readonly account_number_masked: string;
    readonly account_holder_name: string;
    readonly cooling_until: string;
  } | null;
  readonly bookings: readonly {
    readonly booking_id: string;
    readonly booking_code: string;
    readonly amount_idr: number;
    readonly released_at: string | null;
    readonly event_title: string | null;
  }[];
  readonly amount_idr: number;
  readonly ledger_payable_idr: number;
  readonly minimum_idr: number;
  readonly eligible: boolean;
  readonly reason: string | null;
}

export interface ReconcileStats {
  readonly processed: number;
  readonly skipped: number;
  readonly failed: number;
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function toView(row: PayoutRow): PayoutView {
  return {
    id: row.id,
    code: row.code,
    vendor_id: row.vendor_id,
    vendor_name: row.vendor_name,
    status: row.status,
    amount_idr: idrToJson(row.amount_idr, 'payout.amount_idr'),
    currency: row.currency,
    provider: row.provider,
    provider_ref: row.provider_ref,
    failure_code: row.failure_code,
    failure_reason: row.failure_reason,
    bank: {
      bank_code: row.bank_code,
      bank_name: row.bank_name,
      account_number_masked: row.account_number_masked,
      account_holder_name: row.account_holder_name
    },
    requested_by: row.requested_by,
    requested_by_name: row.requested_by_name,
    approved_by: row.approved_by,
    approved_by_name: row.approved_by_name,
    approved_at: toIso(row.approved_at),
    processed_at: toIso(row.processed_at),
    paid_at: toIso(row.paid_at),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString()
  };
}

function toItemView(row: PayoutItemRow): PayoutItemView {
  return {
    booking_id: row.booking_id,
    booking_code: row.booking_code,
    amount_idr: idrToJson(row.amount_idr, 'payout_item.amount_idr'),
    released_at: toIso(row.released_at),
    voided_at: toIso(row.voided_at)
  };
}

function groupJournal(rows: readonly PayoutJournalRow[]): PayoutJournalEntryView[] {
  const entries = new Map<string, PayoutJournalEntryView & { lines: PayoutJournalLineView[] }>();
  for (const row of rows) {
    let entry = entries.get(row.id);
    if (!entry) {
      entry = {
        id: row.id,
        event_type: row.event_type,
        source_event_key: row.source_event_key,
        occurred_at: row.occurred_at.toISOString(),
        memo: row.memo,
        lines: []
      };
      entries.set(row.id, entry);
    }
    entry.lines.push({
      account_code: row.account_code,
      vendor_id: row.line_vendor_id,
      debit_idr: idrToJson(row.debit_idr, 'journal_line.debit_idr'),
      credit_idr: idrToJson(row.credit_idr, 'journal_line.credit_idr'),
      memo: row.line_memo
    });
  }
  return [...entries.values()];
}

function sumIdr(rows: readonly { readonly amount_idr: string }[]): bigint {
  return rows.reduce((total, row) => total + BigInt(row.amount_idr), 0n);
}

function requireKey(key: string | undefined): string {
  if (!key || key.trim().length === 0) {
    throw new AppError('VALIDATION_ERROR', 'Idempotency-Key header is required');
  }
  return key;
}

export class PayoutService {
  private readonly clock: Clock;
  private readonly newId: () => string;

  constructor(private readonly deps: PayoutServiceDeps) {
    this.clock = deps.clock ?? new SystemClock();
    this.newId = deps.newId ?? (() => randomUUID());
  }

  /* ------------------------------------------------------------------ reads */

  async resolveVendor(actorId: string): Promise<VendorRef> {
    const vendor = await this.deps.repository.findVendorByOwner(actorId);
    if (!vendor) {
      throw new AppError('NOT_FOUND', 'Vendor tidak ditemukan untuk akun ini.');
    }
    return vendor;
  }

  async listForVendor(
    actorId: string,
    page: number,
    pageSize: number
  ): Promise<{ items: PayoutView[]; total: number; page: number; page_size: number }> {
    const vendor = await this.resolveVendor(actorId);
    const result = await this.deps.repository.listForVendor(vendor.id, page, pageSize);
    return {
      items: result.rows.map(toView),
      total: result.total,
      page,
      page_size: pageSize
    };
  }

  async list(filters: {
    readonly status?: PayoutStatus | null;
    readonly vendor_id?: string | null;
    readonly page: number;
    readonly page_size: number;
  }): Promise<{ items: PayoutView[]; total: number; page: number; page_size: number }> {
    const result = await this.deps.repository.list(filters);
    return {
      items: result.rows.map(toView),
      total: result.total,
      page: filters.page,
      page_size: filters.page_size
    };
  }

  async detail(payoutId: string): Promise<PayoutDetailView> {
    const row = await this.deps.repository.findById(payoutId);
    if (!row) throw new AppError('NOT_FOUND', 'Payout tidak ditemukan.');
    const [items, journal] = await Promise.all([
      this.deps.repository.listItems(payoutId),
      this.deps.repository.payoutJournal(payoutId)
    ]);
    return { ...toView(row), items: items.map(toItemView), journal: groupJournal(journal) };
  }

  async eligible(vendorId: string): Promise<EligiblePayoutView> {
    const vendor = await this.deps.repository.findVendorById(vendorId);
    if (!vendor) throw new AppError('NOT_FOUND', 'Vendor tidak ditemukan.');

    const [bookings, ledger, account, minimum] = await Promise.all([
      this.deps.repository.listEligibleBookings(vendor.id),
      this.deps.repository.ledgerPayable(vendor.id),
      this.deps.bankAccounts.findVerifiedForPayout(vendor.id),
      this.deps.repository.readSetting('payout_min_idr')
    ]);

    const amount = sumIdr(bookings);
    const reason = this.eligibilityReason({
      hasBookings: bookings.length > 0,
      account,
      amount,
      ledger,
      minimum
    });

    return {
      vendor_id: vendor.id,
      vendor_name: vendor.display_name,
      bank_account: account
        ? {
            bank_code: account.bank_code,
            bank_name: bankDisplayName(account.bank_code),
            account_number_masked: account.account_number_masked,
            account_holder_name: account.account_holder_name,
            cooling_until: account.cooling_until.toISOString()
          }
        : null,
      bookings: bookings.map((row: EligibleBookingRow) => ({
        booking_id: row.booking_id,
        booking_code: row.booking_code,
        amount_idr: idrToJson(row.amount_idr, 'eligible_booking.amount_idr'),
        released_at: toIso(row.released_at),
        event_title: row.event_title
      })),
      amount_idr: idrToJson(amount, 'eligible.amount_idr'),
      ledger_payable_idr: idrToJson(ledger, 'eligible.ledger_payable_idr'),
      minimum_idr: minimum,
      eligible: reason === null,
      reason
    };
  }

  /* ----------------------------------------------------------------- writes */

  async create(
    maker: PayoutActor,
    input: { readonly vendor_id: string; readonly booking_ids?: readonly string[] },
    idempotencyKey: string | undefined
  ): Promise<PayoutDetailView> {
    this.assertWriteRole(maker.roles);
    const key = requireKey(idempotencyKey);

    return this.idempotent(
      PAYOUT_SCOPES.create,
      maker.id,
      key,
      { vendor_id: input.vendor_id, booking_ids: input.booking_ids ?? null },
      async () => {
        const row = await this.deps.repository.transaction(async (client) => {
          const vendor = await this.deps.repository.lockVendor(client, input.vendor_id);
          if (!vendor) throw new AppError('NOT_FOUND', 'Vendor tidak ditemukan.');
          if (!vendor.is_active) {
            throw new AppError('CONFLICT', 'Vendor sedang tidak aktif.');
          }

          const now = this.clock.now();
          const account = await this.deps.bankAccounts.findVerifiedForPayout(vendor.id, client);
          if (!account) {
            throw new AppError(
              'VALIDATION_ERROR',
              'Vendor belum punya rekening terverifikasi. Verifikasi rekening sebelum mencairkan dana.'
            );
          }
          if (account.cooling_until.getTime() > now.getTime()) {
            throw new AppError(
              'CONFLICT',
              `Rekening masih masa tunggu sampai ${account.cooling_until.toISOString()}.`
            );
          }

          const eligible = await this.deps.repository.listEligibleBookings(vendor.id, client);
          if (eligible.length === 0) {
            throw new AppError('CONFLICT', 'Belum ada dana released yang bisa dicairkan.');
          }

          const selection = input.booking_ids
            ? this.selectBookings(eligible, input.booking_ids)
            : eligible;
          const amount = sumIdr(selection);

          const minimum = BigInt(await this.deps.repository.readSetting('payout_min_idr'));
          if (amount < minimum) {
            throw new AppError(
              'VALIDATION_ERROR',
              `Nominal payout di bawah minimum (Rp${minimum.toString()}).`
            );
          }

          const ledger = await this.deps.repository.ledgerPayable(vendor.id, client);
          if (amount > ledger) {
            throw new AppError(
              'CONFLICT',
              'Saldo vendor_payable di ledger lebih kecil dari nominal payout. Periksa clawback/sengketa.'
            );
          }

          const inserted = await this.deps.repository.insertPayout(client, {
            id: this.newId(),
            vendorId: vendor.id,
            bankAccountId: account.id,
            amountIdr: amount,
            provider: this.deps.gateway.name,
            requestedBy: maker.id
          });

          await this.deps.repository.insertItems(
            client,
            inserted.id,
            selection.map((booking) => ({
              bookingId: booking.booking_id,
              amountIdr: BigInt(booking.amount_idr)
            }))
          );

          await this.deps.repository.insertAudit(client, {
            actorId: maker.id,
            actorRole: this.actorRole(maker.roles),
            action: 'payout.requested',
            entityType: 'payout',
            entityId: inserted.id,
            afterState: {
              vendor_id: vendor.id,
              amount_idr: amount.toString(),
              booking_ids: selection.map((booking) => booking.booking_id)
            }
          });

          const fresh = await this.deps.repository.findById(inserted.id, {}, client);
          if (!fresh) throw new AppError('INTERNAL_ERROR', 'Payout gagal dibaca ulang.');
          return fresh;
        });

        const items = await this.deps.repository.listItems(row.id);
        return { ...toView(row), items: items.map(toItemView), journal: [] };
      }
    );
  }

  async approve(
    checker: PayoutActor,
    payoutId: string,
    idempotencyKey: string | undefined
  ): Promise<PayoutDetailView> {
    this.assertWriteRole(checker.roles);
    const key = requireKey(idempotencyKey);

    return this.idempotent(
      PAYOUT_SCOPES.approve,
      checker.id,
      key,
      { payout_id: payoutId, checker_id: checker.id },
      async () => {
        const prepared = await this.deps.repository.transaction(async (client) => {
          const row = await this.deps.repository.findById(payoutId, { forUpdate: true }, client);
          if (!row) throw new AppError('NOT_FOUND', 'Payout tidak ditemukan.');
          if (row.status !== 'requested') {
            throw new AppError('CONFLICT', `Payout sudah berstatus ${row.status}.`);
          }
          if (row.requested_by === checker.id) {
            throw new AppError('CONFLICT', 'Pembuat dan penyetuju payout harus orang berbeda.');
          }

          const amount = BigInt(row.amount_idr);
          const threshold = BigInt(await this.deps.repository.readSetting('approval_threshold_idr'));
          if (amount >= threshold && !checker.roles.includes('admin_super')) {
            throw new AppError(
              'FORBIDDEN',
              'Payout di atas ambang persetujuan wajib disetujui admin_super.'
            );
          }

          const account = await this.deps.bankAccounts.findSecretById(
            row.vendor_id,
            row.bank_account_id,
            client
          );
          if (!account || account.status !== 'verified' || account.superseded_at) {
            throw new AppError('CONFLICT', 'Rekening tujuan payout tidak lagi terverifikasi.');
          }

          const ledger = await this.deps.repository.ledgerPayable(row.vendor_id, client);
          if (amount > ledger) {
            throw new AppError(
              'CONFLICT',
              'Saldo vendor_payable tidak mencukupi saat persetujuan. Muat ulang lalu buat payout baru.'
            );
          }

          const now = this.clock.now();
          const entry = buildEntry('payout_requested', {
            payoutId: row.id,
            vendorId: row.vendor_id,
            amountIdr: amount,
            occurredAt: now,
            sourceEventKey: `payout:${row.id}:requested`,
            memo: `Payout ${row.code}`
          });
          const posted = await postEntry(client, entry);

          const approved = await this.deps.repository.markApproved(
            client,
            row.id,
            checker.id,
            now
          );
          if (!approved) {
            throw new AppError('CONFLICT', 'Payout berubah status sebelum disetujui.');
          }

          await this.deps.repository.insertAudit(client, {
            actorId: checker.id,
            actorRole: this.actorRole(checker.roles),
            action: 'payout.approve',
            entityType: 'payout',
            entityId: row.id,
            beforeState: { status: 'requested' },
            afterState: { status: 'approved', journal_entry_id: posted.id }
          });

          const cipher = this.deps.cipherFactory();
          const accountNumber = cipher.decrypt(
            account.account_number_encrypted,
            account.encryption_key_id
          );

          return {
            row,
            amount,
            beneficiary: {
              bankCode: account.bank_code,
              accountNumber,
              accountHolderName: account.account_holder_name
            }
          };
        });

        let result: PayoutCreateResult;
        try {
          result = await this.deps.gateway.createPayout({
            referenceNo: prepared.row.id,
            amountIdr: prepared.amount,
            beneficiary: prepared.beneficiary,
            notes: `Payout ${prepared.row.code} - ${prepared.row.vendor_name ?? prepared.row.vendor_id}`
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await this.failPayout(prepared.row.id, 'PROVIDER_ERROR', message);
          throw new AppError('UPSTREAM_ERROR', `Payout gagal dikirim ke provider: ${message}`);
        }

        await this.deps.repository.transaction(async (client) => {
          const updated = await this.deps.repository.markProcessing(client, {
            payoutId: prepared.row.id,
            provider: this.deps.gateway.name,
            providerRef: result.providerRef,
            providerPayoutId: result.providerPayoutId,
            at: this.clock.now()
          });
          if (!updated) return;
          if (result.status === 'completed') {
            await this.postSettled(
              client,
              prepared.row,
              result.paidAt ?? this.clock.now(),
              'Provider completed synchronously'
            );
          }
        });

        return this.detail(prepared.row.id);
      }
    );
  }

  async reject(checker: PayoutActor, payoutId: string, reason: string): Promise<PayoutDetailView> {
    this.assertWriteRole(checker.roles);
    const now = this.clock.now();

    await this.deps.repository.transaction(async (client) => {
      const row = await this.deps.repository.findById(payoutId, { forUpdate: true }, client);
      if (!row) throw new AppError('NOT_FOUND', 'Payout tidak ditemukan.');
      if (row.status !== 'requested') {
        throw new AppError('CONFLICT', `Payout sudah berstatus ${row.status}.`);
      }
      if (row.requested_by === checker.id) {
        throw new AppError('CONFLICT', 'Pembuat dan penolak payout harus orang berbeda.');
      }

      const rejected = await this.deps.repository.markRejected(
        client,
        payoutId,
        checker.id,
        reason,
        now
      );
      if (!rejected) throw new AppError('CONFLICT', 'Payout berubah status sebelum ditolak.');
      await this.deps.repository.voidItems(client, payoutId, now);
      await this.deps.repository.insertAudit(client, {
        actorId: checker.id,
        actorRole: this.actorRole(checker.roles),
        action: 'payout.reject',
        entityType: 'payout',
        entityId: payoutId,
        beforeState: { status: 'requested' },
        afterState: { status: 'rejected', reason }
      });
    });

    return this.detail(payoutId);
  }

  async cancel(maker: PayoutActor, payoutId: string): Promise<PayoutDetailView> {
    this.assertWriteRole(maker.roles);
    const now = this.clock.now();

    await this.deps.repository.transaction(async (client) => {
      const row = await this.deps.repository.findById(payoutId, { forUpdate: true }, client);
      if (!row) throw new AppError('NOT_FOUND', 'Payout tidak ditemukan.');
      if (row.status !== 'requested') {
        throw new AppError('CONFLICT', `Payout sudah berstatus ${row.status}.`);
      }
      if (row.requested_by !== maker.id) {
        throw new AppError('FORBIDDEN', 'Hanya pembuat payout yang boleh membatalkannya.');
      }

      const cancelled = await this.deps.repository.markCancelled(client, payoutId, now);
      if (!cancelled) throw new AppError('CONFLICT', 'Payout berubah status sebelum dibatalkan.');
      await this.deps.repository.voidItems(client, payoutId, now);
      await this.deps.repository.insertAudit(client, {
        actorId: maker.id,
        actorRole: this.actorRole(maker.roles),
        action: 'payout.cancel',
        entityType: 'payout',
        entityId: payoutId,
        beforeState: { status: 'requested' },
        afterState: { status: 'cancelled' }
      });
    });

    return this.detail(payoutId);
  }

  /* ---------------------------------------------------------------- worker */

  async reconcile(batch: number): Promise<ReconcileStats> {
    const rows = await this.deps.repository.reconcileCandidates(this.deps.gateway.name, batch);
    let processed = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of rows) {
      try {
        if (row.status === 'approved') {
          const advanced = await this.retryCreate(row);
          if (advanced) processed += 1;
          else skipped += 1;
          continue;
        }

        if (!row.provider_ref) {
          await this.deps.repository.transaction((client) =>
            this.deps.repository.touch(client, row.id)
          );
          skipped += 1;
          continue;
        }

        const status = await this.deps.gateway.getPayout(row.provider_ref);
        if (status.status === 'completed') {
          await this.deps.repository.transaction((client) =>
            this.postSettled(client, row, status.paidAt ?? this.clock.now(), 'Reconciled from provider')
          );
          processed += 1;
          continue;
        }

        if (status.status === 'failed') {
          await this.failPayout(
            row.id,
            status.failureCode ?? 'PROVIDER_FAILED',
            status.failureReason
          );
          processed += 1;
          continue;
        }

        await this.deps.repository.transaction((client) =>
          this.deps.repository.touch(client, row.id)
        );
        skipped += 1;
      } catch (err) {
        failed += 1;
        this.log(
          `payout_reconcile failed=1 payout=${row.id} error=${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    return { processed, skipped, failed };
  }

  /* --------------------------------------------------------------- private */

  private async retryCreate(row: PayoutRow): Promise<boolean> {
    const account = await this.deps.bankAccounts.findSecretByIdAnyVendor(row.bank_account_id);
    if (!account) {
      this.log(`payout_reconcile skipped=1 payout=${row.id} reason=bank_account_missing`);
      return false;
    }

    const cipher = this.deps.cipherFactory();
    const accountNumber = cipher.decrypt(
      account.account_number_encrypted,
      account.encryption_key_id
    );

    let result: PayoutCreateResult;
    try {
      result = await this.deps.gateway.createPayout({
        referenceNo: row.id,
        amountIdr: BigInt(row.amount_idr),
        beneficiary: {
          bankCode: account.bank_code,
          accountNumber,
          accountHolderName: account.account_holder_name
        },
        notes: `Payout ${row.code} - ${row.vendor_name ?? row.vendor_id}`
      });
    } catch (err) {
      this.log(
        `payout_reconcile retry_failed=1 payout=${row.id} error=${
          err instanceof Error ? err.message : String(err)
        }`
      );
      return false;
    }

    await this.deps.repository.transaction(async (client) => {
      const updated = await this.deps.repository.markProcessing(client, {
        payoutId: row.id,
        provider: this.deps.gateway.name,
        providerRef: result.providerRef,
        providerPayoutId: result.providerPayoutId,
        at: this.clock.now()
      });
      if (updated && result.status === 'completed') {
        await this.postSettled(
          client,
          row,
          result.paidAt ?? this.clock.now(),
          'Provider completed on retry'
        );
      }
    });

    return true;
  }

  private async postSettled(
    client: Parameters<PayoutRepository['markPaid']>[0],
    row: PayoutRow,
    at: Date,
    memo: string
  ): Promise<void> {
    const amount = BigInt(row.amount_idr);
    const entry = buildEntry('payout_settled', {
      payoutId: row.id,
      vendorId: row.vendor_id,
      amountIdr: amount,
      occurredAt: at,
      sourceEventKey: `payout:${row.id}:settled`,
      memo: `Payout ${row.code} ${memo}`.trim()
    });
    const posted = await postEntry(client, entry);

    const paid = await this.deps.repository.markPaid(client, row.id, at);
    if (!paid) {
      throw new AppError('CONFLICT', 'Payout berubah status sebelum sempat ditandai cair.');
    }

    await this.deps.repository.insertAudit(client, {
      actorId: null,
      actorRole: null,
      action: 'payout.paid',
      entityType: 'payout',
      entityId: row.id,
      afterState: { status: 'paid', journal_entry_id: posted.id, paid_at: at.toISOString() }
    });
  }

  private async failPayout(
    payoutId: string,
    failureCode: string,
    failureReason: string | null
  ): Promise<void> {
    const now = this.clock.now();
    await this.deps.repository.transaction(async (client) => {
      const row = await this.deps.repository.findById(payoutId, { forUpdate: true }, client);
      if (!row) return;
      if (row.status !== 'approved' && row.status !== 'processing') return;

      await this.reverseRequested(client, row, failureReason ?? failureCode, now);
      const marked = await this.deps.repository.markFailed(client, {
        payoutId,
        failureCode,
        failureReason
      });
      if (marked) {
        await this.deps.repository.voidItems(client, payoutId, now);
      }
      await this.deps.repository.insertAudit(client, {
        actorId: null,
        actorRole: null,
        action: 'payout.failed',
        entityType: 'payout',
        entityId: payoutId,
        beforeState: { status: row.status },
        afterState: { status: 'failed', failure_code: failureCode }
      });
    });
  }

  /**
   * The ledger is append-only: a failed transfer reverses `payout_requested`
   * instead of deleting or updating it.
   */
  private async reverseRequested(
    client: Parameters<PayoutRepository['markPaid']>[0],
    row: PayoutRow,
    reason: string,
    at: Date
  ): Promise<void> {
    const loaded = await this.deps.repository.loadJournalEntry(
      `payout:${row.id}:requested`,
      client
    );
    if (!loaded) return;

    const original: JournalEntryDraft & { readonly id?: string } = {
      id: loaded.header.id,
      eventType: loaded.header.event_type as JournalEventType,
      sourceEventKey: loaded.header.source_event_key,
      referenceType: loaded.header.reference_type as ReferenceType,
      referenceId: loaded.header.reference_id ?? undefined,
      bookingId: loaded.header.booking_id ?? undefined,
      vendorId: loaded.header.vendor_id ?? undefined,
      occurredAt: loaded.header.occurred_at,
      memo: loaded.header.memo ?? undefined,
      lines: loaded.lines.map((line) => ({
        accountCode: line.account_code,
        vendorId: line.line_vendor_id ?? undefined,
        debitIdr: BigInt(line.debit_idr),
        creditIdr: BigInt(line.credit_idr),
        memo: line.line_memo ?? undefined
      }))
    };

    const reversal = buildReversal(original, {
      occurredAt: at,
      sourceEventKey: `payout:${row.id}:requested:reversed`,
      memo: `Payout ${row.code} gagal: ${reason}`
    });
    await postEntry(client, reversal);
  }

  private selectBookings(
    eligible: readonly EligibleBookingRow[],
    bookingIds: readonly string[]
  ): EligibleBookingRow[] {
    const wanted = new Set(bookingIds);
    const selection = eligible.filter((row) => wanted.has(row.booking_id));
    if (selection.length !== wanted.size) {
      throw new AppError(
        'CONFLICT',
        'Ada booking yang tidak eligible atau sudah masuk payout lain. Muat ulang daftar.'
      );
    }
    return selection;
  }

  private eligibilityReason(input: {
    readonly hasBookings: boolean;
    readonly account: {
      readonly status: string;
      readonly cooling_until: Date;
    } | null;
    readonly amount: bigint;
    readonly ledger: bigint;
    readonly minimum: number;
  }): string | null {
    if (!input.account) {
      return 'Vendor belum punya rekening terverifikasi.';
    }
    if (input.account.cooling_until.getTime() > this.clock.now().getTime()) {
      return `Rekening masih masa tunggu sampai ${input.account.cooling_until.toISOString()}.`;
    }
    if (!input.hasBookings) return 'Belum ada booking released yang belum dicairkan.';
    if (input.amount < BigInt(input.minimum)) {
      return `Nominal di bawah minimum Rp${input.minimum.toString()}.`;
    }
    if (input.amount > input.ledger) {
      return 'Saldo vendor_payable di ledger lebih kecil dari nominal. Periksa clawback/sengketa.';
    }
    return null;
  }

  private assertWriteRole(roles: readonly string[]): void {
    if (!roles.some((role) => WRITE_ROLES.includes(role as (typeof WRITE_ROLES)[number]))) {
      throw new AppError('FORBIDDEN', 'Hanya admin_finance atau admin_super yang boleh mencairkan.');
    }
  }

  private actorRole(roles: readonly string[]): 'admin_finance' | 'admin_super' {
    return roles.includes('admin_finance') ? 'admin_finance' : 'admin_super';
  }

  private async idempotent<T>(
    scope: string,
    actorId: string,
    key: string,
    payload: unknown,
    fn: () => Promise<T>
  ): Promise<T> {
    if (!this.deps.idempotencyStore) return fn();
    const service = new IdempotencyService(this.deps.idempotencyStore, {
      actorId,
      ttlSeconds: PAYOUT_IDEMPOTENCY_TTL_SECONDS,
      clock: this.clock
    });
    return service.run(key, scope, hashRequest(payload), fn);
  }

  private log(line: string): void {
    this.deps.logger?.(line);
  }
}

export type { PayoutProviderStatus };
