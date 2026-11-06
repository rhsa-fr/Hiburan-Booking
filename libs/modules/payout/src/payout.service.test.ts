import type { PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import { FixedClock } from '@tarlink/platform/clock';
import type { SecretCipher } from '@tarlink/platform/crypto';
import type {
  BankAccountSecretRow,
  BankAccountsRepository
} from './bank-accounts.repository';
import type {
  PayoutCreateResult,
  PayoutGateway,
  PayoutStatusResult
} from './payout.gateway';
import type {
  EligibleBookingRow,
  JournalHeaderRow,
  JournalLineRow,
  PayoutItemRow,
  PayoutJournalRow,
  PayoutRepository,
  PayoutRow,
  PayoutStatus
} from './payout.repository';
import { PayoutService } from './payout.service';

const now = new Date('2026-11-03T10:00:00.000Z');

interface LedgerEntry {
  id: string;
  eventType: string;
  sourceEventKey: string;
  referenceType: string;
  referenceId: string | null;
  bookingId: string | null;
  vendorId: string | null;
  reversesEntryId: string | null;
  memo: string | null;
  occurredAt: Date;
  lines: Array<{
    accountCode: string;
    vendorId: string | null;
    debitIdr: string;
    creditIdr: string;
    memo: string | null;
  }>;
}

/** Minimal `postEntry` target: records entries/lines and enforces the unique key. */
class FakeLedger {
  readonly entries: LedgerEntry[] = [];
  private seq = 0;

  query = async (
    text: string,
    params: readonly unknown[] = []
  ): Promise<{ rows: Array<Record<string, unknown>> }> => {
    if (text.includes('INSERT INTO journal_entries')) {
      const sourceEventKey = String(params[1]);
      if (this.entries.some((entry) => entry.sourceEventKey === sourceEventKey)) {
        return { rows: [] };
      }
      this.seq += 1;
      const entry: LedgerEntry = {
        id: `je-${this.seq}`,
        eventType: String(params[0]),
        sourceEventKey,
        referenceType: String(params[2]),
        referenceId: (params[3] as string | null) ?? null,
        bookingId: (params[4] as string | null) ?? null,
        vendorId: (params[5] as string | null) ?? null,
        reversesEntryId: (params[6] as string | null) ?? null,
        memo: (params[7] as string | null) ?? null,
        occurredAt: new Date(String(params[8])),
        lines: []
      };
      this.entries.push(entry);
      return { rows: [{ id: entry.id, entry_no: String(this.seq) }] };
    }

    if (text.includes('SELECT id, entry_no FROM journal_entries')) {
      const entry = this.entries.find((item) => item.sourceEventKey === String(params[0]));
      return { rows: entry ? [{ id: entry.id, entry_no: entry.id }] : [] };
    }

    if (text.includes('INSERT INTO journal_lines')) {
      const entry = this.entries.find((item) => item.id === String(params[0]));
      entry?.lines.push({
        accountCode: String(params[2]),
        vendorId: (params[3] as string | null) ?? null,
        debitIdr: String(params[4]),
        creditIdr: String(params[5]),
        memo: (params[6] as string | null) ?? null
      });
      return { rows: [] };
    }

    throw new Error(`unexpected SQL: ${text.slice(0, 60)}`);
  };
}

class FakePayoutRepository {
  readonly ledger = new FakeLedger();
  readonly settings: Record<string, number> = {
    payout_min_idr: 1_000,
    approval_threshold_idr: 1_000_000,
    bank_cooling_hours: 24
  };
  readonly vendor = {
    id: 'vendor-1',
    display_name: 'Vendor Satu',
    is_active: true,
    verification_status: 'approved'
  };
  bookings: EligibleBookingRow[] = [];
  initialPayable = 0n;
  readonly payouts = new Map<string, PayoutRow>();
  readonly items = new Map<string, PayoutItemRow[]>();
  readonly audits: Array<{ action: string }> = [];
  private seq = 0;

  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    return fn(this.ledger as unknown as PoolClient);
  }

  async readSetting(field: string): Promise<number> {
    return this.settings[field] ?? 0;
  }

  async findVendorByOwner(ownerUserId: string) {
    return ownerUserId === 'maker-1' ? this.vendor : null;
  }

  async findVendorById(vendorId: string) {
    return vendorId === this.vendor.id ? this.vendor : null;
  }

  async lockVendor() {
    return this.vendor;
  }

  async listEligibleBookings(): Promise<EligibleBookingRow[]> {
    return this.bookings;
  }

  async ledgerPayable(vendorId: string): Promise<bigint> {
    const delta = this.ledger.entries
      .flatMap((entry) => entry.lines)
      .filter((line) => line.accountCode === '2120' && line.vendorId === vendorId)
      .reduce(
        (total, line) => total + BigInt(line.creditIdr) - BigInt(line.debitIdr),
        0n
      );
    return this.initialPayable + delta;
  }

  async insertPayout(
    _client: PoolClient,
    input: {
      id: string;
      vendorId: string;
      bankAccountId: string;
      amountIdr: bigint;
      provider: string;
      requestedBy: string;
    }
  ): Promise<{ id: string; code: string }> {
    this.seq += 1;
    const code = `PO-TEST-${String(this.seq).padStart(4, '0')}`;
    this.payouts.set(input.id, {
      id: input.id,
      code,
      vendor_id: input.vendorId,
      vendor_name: this.vendor.display_name,
      bank_account_id: input.bankAccountId,
      bank_code: 'bca',
      bank_name: 'BCA',
      account_number_masked: '****7890',
      account_holder_name: 'Budi',
      amount_idr: input.amountIdr.toString(),
      currency: 'IDR',
      status: 'requested',
      provider: input.provider,
      provider_ref: null,
      provider_payout_id: null,
      failure_code: null,
      failure_reason: null,
      requested_by: input.requestedBy,
      requested_by_name: 'Maker',
      approved_by: null,
      approved_by_name: null,
      approved_at: null,
      processed_at: null,
      paid_at: null,
      created_at: now,
      updated_at: now
    });
    return { id: input.id, code };
  }

  async insertItems(
    _client: PoolClient,
    payoutId: string,
    rows: readonly { bookingId: string; amountIdr: bigint }[]
  ): Promise<void> {
    const bookingById = new Map(this.bookings.map((booking) => [booking.booking_id, booking]));
    this.items.set(
      payoutId,
      rows.map((row) => ({
        booking_id: row.bookingId,
        booking_code: bookingById.get(row.bookingId)?.booking_code ?? row.bookingId,
        amount_idr: row.amountIdr.toString(),
        released_at: now,
        voided_at: null
      }))
    );
  }

  async findById(payoutId: string): Promise<PayoutRow | null> {
    return this.payouts.get(payoutId) ?? null;
  }

  async listItems(payoutId: string): Promise<PayoutItemRow[]> {
    return this.items.get(payoutId) ?? [];
  }

  async payoutJournal(payoutId: string): Promise<PayoutJournalRow[]> {
    return this.ledger.entries
      .filter((entry) => entry.referenceType === 'payout' && entry.referenceId === payoutId)
      .flatMap((entry) =>
        entry.lines.map((line) => ({
          id: entry.id,
          event_type: entry.eventType,
          source_event_key: entry.sourceEventKey,
          occurred_at: entry.occurredAt,
          memo: entry.memo,
          line_no: 1,
          account_code: line.accountCode,
          line_vendor_id: line.vendorId,
          debit_idr: line.debitIdr,
          credit_idr: line.creditIdr,
          line_memo: line.memo
        }))
      );
  }

  private update(payoutId: string, patch: Partial<PayoutRow>): boolean {
    const row = this.payouts.get(payoutId);
    if (!row) return false;
    this.payouts.set(payoutId, { ...row, ...patch, updated_at: now });
    return true;
  }

  async markApproved(_client: PoolClient, payoutId: string, approvedBy: string, at: Date) {
    return this.update(payoutId, {
      status: 'approved',
      approved_by: approvedBy,
      approved_by_name: 'Checker',
      approved_at: at
    });
  }

  async markProcessing(
    _client: PoolClient,
    input: { payoutId: string; providerRef: string | null; providerPayoutId: string | null; at: Date }
  ): Promise<boolean> {
    return this.update(input.payoutId, {
      status: 'processing',
      provider_ref: input.providerRef,
      provider_payout_id: input.providerPayoutId,
      processed_at: input.at
    });
  }

  async markPaid(_client: PoolClient, payoutId: string, paidAt: Date): Promise<boolean> {
    return this.update(payoutId, { status: 'paid', paid_at: paidAt });
  }

  async markFailed(
    _client: PoolClient,
    input: { payoutId: string; failureCode: string; failureReason: string | null }
  ): Promise<boolean> {
    return this.update(input.payoutId, {
      status: 'failed',
      failure_code: input.failureCode,
      failure_reason: input.failureReason
    });
  }

  async markRejected(
    _client: PoolClient,
    payoutId: string,
    approvedBy: string,
    reason: string
  ): Promise<boolean> {
    return this.update(payoutId, {
      status: 'rejected',
      approved_by: approvedBy,
      failure_code: 'REJECTED',
      failure_reason: reason
    });
  }

  async markCancelled(_client: PoolClient, payoutId: string): Promise<boolean> {
    return this.update(payoutId, { status: 'cancelled' });
  }

  async voidItems(_client: PoolClient, payoutId: string, at: Date): Promise<void> {
    const rows = this.items.get(payoutId) ?? [];
    this.items.set(
      payoutId,
      rows.map((row) => ({ ...row, voided_at: at }))
    );
  }

  async reconcileCandidates(): Promise<PayoutRow[]> {
    return [...this.payouts.values()].filter(
      (row) => row.status === 'approved' || row.status === 'processing'
    );
  }

  async touch(): Promise<void> {
    // no-op for tests
  }

  async insertAudit(_client: PoolClient, input: { action: string }): Promise<void> {
    this.audits.push(input);
  }

  async loadJournalEntry(
    sourceEventKey: string
  ): Promise<{ header: JournalHeaderRow; lines: JournalLineRow[] } | null> {
    const entry = this.ledger.entries.find((item) => item.sourceEventKey === sourceEventKey);
    if (!entry) return null;
    return {
      header: {
        id: entry.id,
        event_type: entry.eventType,
        source_event_key: entry.sourceEventKey,
        reference_type: entry.referenceType,
        reference_id: entry.referenceId,
        booking_id: entry.bookingId,
        vendor_id: entry.vendorId,
        memo: entry.memo,
        occurred_at: entry.occurredAt
      },
      lines: entry.lines.map((line, index) => ({
        line_no: index + 1,
        account_code: line.accountCode,
        line_vendor_id: line.vendorId,
        debit_idr: line.debitIdr,
        credit_idr: line.creditIdr,
        line_memo: line.memo
      }))
    };
  }
}

class FakeBankRepository {
  readonly account: BankAccountSecretRow = {
    id: 'bank-1',
    vendor_id: 'vendor-1',
    bank_code: 'bca',
    bank_name: 'BCA',
    account_number_masked: '****7890',
    account_holder_name: 'Budi',
    status: 'verified',
    cooling_until: new Date('2026-11-01T00:00:00.000Z'),
    verified_at: new Date('2026-10-30T00:00:00.000Z'),
    verified_by: 'admin-1',
    rejection_reason: null,
    created_by: 'user-1',
    superseded_at: null,
    created_at: now,
    updated_at: now,
    account_number_encrypted: Buffer.from('enc:1234567890'),
    encryption_key_id: 'v1',
    account_number_hash: 'hash'
  };

  async findVerifiedForPayout(): Promise<BankAccountSecretRow> {
    return this.account;
  }

  async findSecretById(): Promise<BankAccountSecretRow> {
    return this.account;
  }

  async findSecretByIdAnyVendor(): Promise<BankAccountSecretRow> {
    return this.account;
  }
}

class FakeGateway implements PayoutGateway {
  readonly name = 'local';
  createResult: PayoutCreateResult = {
    providerRef: 'ref-1',
    providerPayoutId: 'provider-1',
    status: 'processing',
    paidAt: null,
    raw: {}
  };
  statusResult: PayoutStatusResult = {
    status: 'processing',
    failureCode: null,
    failureReason: null,
    paidAt: null,
    raw: {}
  };
  createError: Error | null = null;

  async createPayout(): Promise<PayoutCreateResult> {
    if (this.createError) throw this.createError;
    return this.createResult;
  }

  async getPayout(): Promise<PayoutStatusResult> {
    return this.statusResult;
  }
}

function cipher(): SecretCipher {
  return {
    keyId: 'v1',
    encrypt: (plaintext: string) => Buffer.from(`enc:${plaintext}`),
    decrypt: () => '1234567890'
  };
}

function setup(): {
  repo: FakePayoutRepository;
  banks: FakeBankRepository;
  gateway: FakeGateway;
  service: PayoutService;
} {
  const repo = new FakePayoutRepository();
  repo.initialPayable = 5_000n;
  repo.bookings = [
    {
      booking_id: 'booking-1',
      booking_code: 'BK-1',
      amount_idr: '3000',
      released_at: now,
      event_title: 'Acara 1'
    },
    {
      booking_id: 'booking-2',
      booking_code: 'BK-2',
      amount_idr: '2000',
      released_at: now,
      event_title: 'Acara 2'
    }
  ];
  const banks = new FakeBankRepository();
  const gateway = new FakeGateway();
  const service = new PayoutService({
    repository: repo as unknown as PayoutRepository,
    bankAccounts: banks as unknown as BankAccountsRepository,
    gateway,
    cipherFactory: cipher,
    clock: new FixedClock(now),
    newId: () => 'payout-1'
  });
  return { repo, banks, gateway, service };
}

const maker = { id: 'maker-1', roles: ['admin_finance'] as const };
const checker = { id: 'checker-1', roles: ['admin_finance'] as const };
const key = 'idem-1234567890';

describe('PayoutService.create', () => {
  it('claims every released booking not yet paid out', async () => {
    const { repo, service } = setup();
    const result = await service.create(maker, { vendor_id: 'vendor-1' }, key);

    expect(result.status).toBe('requested');
    expect(result.amount_idr).toBe(5000);
    expect(result.items).toHaveLength(2);
    expect(repo.audits.map((audit) => audit.action)).toContain('payout.requested');
  });

  it('honours an explicit booking subset', async () => {
    const { service } = setup();
    const result = await service.create(
      maker,
      { vendor_id: 'vendor-1', booking_ids: ['booking-1'] },
      key
    );
    expect(result.amount_idr).toBe(3000);
    expect(result.items).toHaveLength(1);
  });

  it('refuses a payout below the configured minimum', async () => {
    const { repo, service } = setup();
    repo.settings.payout_min_idr = 10_000;
    await expect(service.create(maker, { vendor_id: 'vendor-1' }, key)).rejects.toThrow(
      /di bawah minimum/
    );
  });

  it('refuses when the ledger payable is smaller than the claim', async () => {
    const { repo, service } = setup();
    repo.initialPayable = 1_000n;
    await expect(service.create(maker, { vendor_id: 'vendor-1' }, key)).rejects.toThrow(
      /vendor_payable/
    );
  });

  it('refuses a booking id that is not eligible', async () => {
    const { service } = setup();
    await expect(
      service.create(maker, { vendor_id: 'vendor-1', booking_ids: ['booking-x'] }, key)
    ).rejects.toThrow(/tidak eligible/);
  });
});

describe('PayoutService.approve', () => {
  it('rejects the maker as checker', async () => {
    const { service } = setup();
    const created = await service.create(maker, { vendor_id: 'vendor-1' }, key);

    await expect(service.approve(maker, created.id, key)).rejects.toThrow(/orang berbeda/);
  });

  it('posts payout_requested, moves to processing, and drains the payable', async () => {
    const { repo, service } = setup();
    const created = await service.create(maker, { vendor_id: 'vendor-1' }, key);
    const approved = await service.approve(checker, created.id, key);

    expect(approved.status).toBe('processing');
    expect(approved.provider_ref).toBe('ref-1');
    expect(repo.ledger.entries.map((entry) => entry.eventType)).toEqual(['payout_requested']);
    expect(await repo.ledgerPayable('vendor-1')).toBe(0n);
    expect(repo.audits.map((audit) => audit.action)).toContain('payout.approve');
  });

  it('settles immediately when the provider completes synchronously', async () => {
    const { repo, gateway, service } = setup();
    gateway.createResult = {
      providerRef: 'ref-1',
      providerPayoutId: 'provider-1',
      status: 'completed',
      paidAt: now,
      raw: {}
    };

    const created = await service.create(maker, { vendor_id: 'vendor-1' }, key);
    const approved = await service.approve(checker, created.id, key);

    expect(approved.status).toBe('paid');
    expect(repo.ledger.entries.map((entry) => entry.eventType)).toEqual([
      'payout_requested',
      'payout_settled'
    ]);
  });

  it('reverses the journal and frees bookings when the provider fails', async () => {
    const { repo, gateway, service } = setup();
    gateway.createError = new Error('iris down');

    const created = await service.create(maker, { vendor_id: 'vendor-1' }, key);
    await expect(service.approve(checker, created.id, key)).rejects.toThrow(/iris down/);

    const row = repo.payouts.get(created.id)!;
    expect(row.status).toBe('failed');
    expect(row.failure_code).toBe('PROVIDER_ERROR');
    expect(repo.ledger.entries.map((entry) => entry.eventType)).toEqual([
      'payout_requested',
      'reversal'
    ]);
    expect(await repo.ledgerPayable('vendor-1')).toBe(5000n);
    expect(repo.items.get(created.id)!.every((item) => item.voided_at !== null)).toBe(true);
  });
});

describe('PayoutService.reconcile', () => {
  it('marks a processing payout paid when the provider completes', async () => {
    const { repo, gateway, service } = setup();
    const created = await service.create(maker, { vendor_id: 'vendor-1' }, key);
    await service.approve(checker, created.id, key);
    gateway.statusResult = {
      status: 'completed',
      failureCode: null,
      failureReason: null,
      paidAt: now,
      raw: {}
    };

    const stats = await service.reconcile(10);

    expect(stats.processed).toBe(1);
    expect(repo.payouts.get(created.id)!.status).toBe('paid');
    expect(repo.ledger.entries.map((entry) => entry.eventType)).toEqual([
      'payout_requested',
      'payout_settled'
    ]);
  });

  it('marks failed and reverses when the provider rejects the transfer', async () => {
    const { repo, gateway, service } = setup();
    const created = await service.create(maker, { vendor_id: 'vendor-1' }, key);
    await service.approve(checker, created.id, key);
    gateway.statusResult = {
      status: 'failed',
      failureCode: 'INSUFFICIENT_BALANCE',
      failureReason: 'Saldo Iris tidak cukup',
      paidAt: null,
      raw: {}
    };

    const stats = await service.reconcile(10);

    expect(stats.processed).toBe(1);
    const row = repo.payouts.get(created.id)!;
    expect(row.status).toBe('failed');
    expect(row.failure_code).toBe('INSUFFICIENT_BALANCE');
    expect(repo.ledger.entries.map((entry) => entry.eventType)).toEqual([
      'payout_requested',
      'reversal'
    ]);
    expect(repo.items.get(created.id)!.every((item) => item.voided_at !== null)).toBe(true);
  });
});

describe('PayoutService role guards', () => {
  it('rejects support staff on create', async () => {
    const { service } = setup();
    await expect(
      service.create({ id: 'support-1', roles: ['admin_support'] }, { vendor_id: 'vendor-1' }, key)
    ).rejects.toThrow(/admin_finance/);
  });
});

export type { PayoutStatus };
