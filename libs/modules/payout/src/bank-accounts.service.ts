import { randomUUID } from 'node:crypto';
import { AppError } from '@tarlink/core/errors';
import { SystemClock, type Clock } from '@tarlink/platform/clock';
import type { SecretCipher } from '@tarlink/platform/crypto';
import {
  hashAccountNumber,
  maskAccountNumber,
  normalizeAccountNumber
} from './account-number';
import type {
  BankAccountRow,
  BankAccountsRepository,
  VendorRef
} from './bank-accounts.repository';
import { bankDisplayName, isSupportedBank } from './banks';
import type { CreateBankAccountInput } from './payout.dto';

export interface BankAccountsServiceDeps {
  readonly repository: BankAccountsRepository;
  /** Built lazily so read-only endpoints still work without a key. */
  readonly cipherFactory: () => SecretCipher;
  readonly clock?: Clock;
  readonly newId?: () => string;
}

export interface BankAccountView {
  readonly id: string;
  readonly bank_code: string;
  readonly bank_name: string;
  readonly account_number_masked: string;
  readonly account_holder_name: string;
  readonly status: 'pending' | 'verified' | 'rejected';
  readonly cooling_until: string;
  readonly verified_at: string | null;
  readonly rejection_reason: string | null;
  readonly is_primary: boolean;
  readonly created_at: string;
}

function toView(row: BankAccountRow): BankAccountView {
  return {
    id: row.id,
    bank_code: row.bank_code,
    bank_name: row.bank_name,
    account_number_masked: row.account_number_masked,
    account_holder_name: row.account_holder_name,
    status: row.status,
    cooling_until: row.cooling_until.toISOString(),
    verified_at: row.verified_at ? row.verified_at.toISOString() : null,
    rejection_reason: row.rejection_reason,
    is_primary: row.status === 'verified',
    created_at: row.created_at.toISOString()
  };
}

export class BankAccountsService {
  private readonly clock: Clock;
  private readonly newId: () => string;

  constructor(private readonly deps: BankAccountsServiceDeps) {
    this.clock = deps.clock ?? new SystemClock();
    this.newId = deps.newId ?? (() => randomUUID());
  }

  async resolveVendor(actorId: string): Promise<VendorRef> {
    const vendor = await this.deps.repository.findVendorByOwner(actorId);
    if (!vendor) {
      throw new AppError('NOT_FOUND', 'Vendor tidak ditemukan untuk akun ini.');
    }
    return vendor;
  }

  async list(actorId: string): Promise<BankAccountView[]> {
    const vendor = await this.resolveVendor(actorId);
    const rows = await this.deps.repository.listForVendor(vendor.id);
    return rows.map(toView);
  }

  async create(actorId: string, input: CreateBankAccountInput): Promise<BankAccountView> {
    const vendor = await this.resolveVendor(actorId);
    const bankCode = input.bank_code.trim().toLowerCase();
    if (!isSupportedBank(bankCode)) {
      throw new AppError('VALIDATION_ERROR', 'Bank belum didukung untuk pencairan.');
    }

    const digits = normalizeAccountNumber(input.account_number);
    const hash = hashAccountNumber(bankCode, digits);
    const cipher = this.deps.cipherFactory();
    const now = this.clock.now();
    const coolingHours = await this.deps.repository.readSetting('bank_cooling_hours');
    const coolingUntil = new Date(now.getTime() + coolingHours * 60 * 60 * 1000);

    const draft = {
      id: this.newId(),
      vendorId: vendor.id,
      bankCode,
      bankName: bankDisplayName(bankCode),
      encryptedNumber: cipher.encrypt(digits),
      maskedNumber: maskAccountNumber(digits),
      numberHash: hash,
      holderName: input.account_holder_name.trim(),
      keyId: cipher.keyId,
      coolingUntil,
      createdBy: actorId
    };

    const row = await this.deps.repository.transaction(async (client) => {
      const existing = await this.deps.repository.findByHash(vendor.id, hash, client);
      if (existing) {
        // The unique (vendor_id, account_number_hash) is permanent, so a number
        // that was rejected or cancelled is revived instead of duplicated.
        if (!existing.superseded_at && existing.status !== 'rejected') {
          throw new AppError('CONFLICT', 'Rekening ini sudah terdaftar.');
        }
        return this.deps.repository.revive(client, existing.id, draft);
      }
      return this.deps.repository.insert(client, draft);
    });

    return toView(row);
  }

  async cancel(actorId: string, accountId: string): Promise<void> {
    const vendor = await this.resolveVendor(actorId);
    const now = this.clock.now();
    const cancelled = await this.deps.repository.transaction((client) =>
      this.deps.repository.cancel(client, vendor.id, accountId, now)
    );
    if (!cancelled) {
      throw new AppError(
        'CONFLICT',
        'Hanya rekening berstatus menunggu yang bisa dibatalkan.'
      );
    }
  }

  async adminList(vendorId: string): Promise<BankAccountView[]> {
    const vendor = await this.deps.repository.findVendorById(vendorId);
    if (!vendor) throw new AppError('NOT_FOUND', 'Vendor tidak ditemukan.');
    const rows = await this.deps.repository.listForVendor(vendor.id, {
      includeSuperseded: false
    });
    return rows.map(toView);
  }

  async verify(
    actorId: string,
    actorRole: string,
    vendorId: string,
    accountId: string,
    requestId: string | null = null
  ): Promise<BankAccountView> {
    const now = this.clock.now();
    const row = await this.deps.repository.transaction(async (client) => {
      const account = await this.deps.repository.findSecretById(vendorId, accountId, client);
      if (!account) throw new AppError('NOT_FOUND', 'Rekening tidak ditemukan.');
      if (account.superseded_at) {
        throw new AppError('CONFLICT', 'Rekening ini sudah tidak aktif.');
      }

      // Must happen before the new row becomes `verified`: the partial unique
      // index allows only one verified account per vendor.
      await this.deps.repository.supersedeOtherVerified(client, vendorId, accountId, now);
      const updated = await this.deps.repository.markVerified(
        client,
        vendorId,
        accountId,
        actorId,
        now
      );
      if (!updated) throw new AppError('CONFLICT', 'Rekening tidak bisa diverifikasi.');

      await this.deps.repository.insertAudit(client, {
        actorId,
        actorRole,
        action: 'vendor.bank_account.verify',
        entityType: 'vendor_bank_account',
        entityId: accountId,
        beforeState: { status: account.status, vendor_id: vendorId },
        afterState: { status: 'verified', vendor_id: vendorId },
        requestId
      });
      return updated;
    });
    return toView(row);
  }

  async reject(
    actorId: string,
    actorRole: string,
    vendorId: string,
    accountId: string,
    reason: string,
    requestId: string | null = null
  ): Promise<BankAccountView> {
    const now = this.clock.now();
    const row = await this.deps.repository.transaction(async (client) => {
      const account = await this.deps.repository.findSecretById(vendorId, accountId, client);
      if (!account) throw new AppError('NOT_FOUND', 'Rekening tidak ditemukan.');

      const updated = await this.deps.repository.markRejected(
        client,
        vendorId,
        accountId,
        reason,
        now
      );
      if (!updated) {
        throw new AppError('CONFLICT', 'Hanya rekening berstatus menunggu yang bisa ditolak.');
      }

      await this.deps.repository.insertAudit(client, {
        actorId,
        actorRole,
        action: 'vendor.bank_account.reject',
        entityType: 'vendor_bank_account',
        entityId: accountId,
        beforeState: { status: account.status },
        afterState: { status: 'rejected', reason },
        requestId
      });
      return updated;
    });
    return toView(row);
  }
}
