import type { PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import { FixedClock } from '@tarlink/platform/clock';
import type { SecretCipher } from '@tarlink/platform/crypto';
import type {
  BankAccountRow,
  BankAccountSecretRow,
  BankAccountsRepository,
  NewBankAccount,
  VendorRef
} from './bank-accounts.repository';
import { BankAccountsService } from './bank-accounts.service';

const now = new Date('2026-11-03T10:00:00.000Z');

function cipher(): SecretCipher {
  return {
    keyId: 'v1',
    encrypt: (plaintext: string) => Buffer.from(`enc:${plaintext}`, 'utf8'),
    decrypt: (payload: Buffer) => payload.toString('utf8').replace(/^enc:/, '')
  };
}

function row(overrides: Partial<BankAccountRow> = {}): BankAccountRow {
  return {
    id: 'bank-1',
    vendor_id: 'vendor-1',
    bank_code: 'bca',
    bank_name: 'BCA',
    account_number_masked: '****7890',
    account_holder_name: 'Budi',
    status: 'pending',
    cooling_until: new Date(now.getTime() + 86_400_000),
    verified_at: null,
    verified_by: null,
    rejection_reason: null,
    created_by: 'user-1',
    superseded_at: null,
    created_at: now,
    updated_at: now,
    ...overrides
  };
}

class FakeRepo {
  readonly vendor: VendorRef = { id: 'vendor-1', display_name: 'Vendor Satu', is_active: true };
  readonly settings: Record<string, number> = { bank_cooling_hours: 24 };
  inserted: NewBankAccount | null = null;
  revivedWith: NewBankAccount | null = null;
  existing: BankAccountSecretRow | null = null;
  verified: BankAccountRow | null = null;
  rejectedReason: string | null = null;
  superseded: string | null = null;
  auditActions: string[] = [];

  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    return fn({} as PoolClient);
  }

  async readSetting(field: string): Promise<number> {
    return this.settings[field] ?? 0;
  }

  async findVendorByOwner(ownerUserId: string): Promise<VendorRef | null> {
    return ownerUserId === 'user-1' ? this.vendor : null;
  }

  async findVendorById(vendorId: string): Promise<VendorRef | null> {
    return vendorId === this.vendor.id ? this.vendor : null;
  }

  async listForVendor(): Promise<BankAccountRow[]> {
    return [this.verified ?? row()];
  }

  async findByHash(): Promise<BankAccountSecretRow | null> {
    return this.existing;
  }

  async findSecretById(): Promise<BankAccountSecretRow | null> {
    return this.existing;
  }

  async insert(_client: PoolClient, input: NewBankAccount): Promise<BankAccountRow> {
    this.inserted = input;
    return row({
      id: input.id,
      bank_code: input.bankCode,
      bank_name: input.bankName,
      account_number_masked: input.maskedNumber,
      account_holder_name: input.holderName,
      cooling_until: input.coolingUntil
    });
  }

  async revive(_client: PoolClient, accountId: string, input: NewBankAccount): Promise<BankAccountRow> {
    this.revivedWith = input;
    return row({
      id: accountId,
      bank_code: input.bankCode,
      account_number_masked: input.maskedNumber,
      account_holder_name: input.holderName
    });
  }

  async cancel(): Promise<boolean> {
    return true;
  }

  async supersedeOtherVerified(_client: PoolClient, _vendorId: string, keepId: string): Promise<void> {
    this.superseded = keepId;
  }

  async markVerified(): Promise<BankAccountRow | null> {
    this.verified = row({ status: 'verified', verified_at: now });
    return this.verified;
  }

  async markRejected(
    _client: PoolClient,
    _vendorId: string,
    _accountId: string,
    reason: string
  ): Promise<BankAccountRow | null> {
    this.rejectedReason = reason;
    return row({ status: 'rejected', rejection_reason: reason });
  }

  async insertAudit(_client: PoolClient, input: { action: string }): Promise<void> {
    this.auditActions.push(input.action);
  }
}

function service(repo: FakeRepo, cipherFactory: () => SecretCipher = cipher): BankAccountsService {
  return new BankAccountsService({
    repository: repo as unknown as BankAccountsRepository,
    cipherFactory,
    clock: new FixedClock(now),
    newId: () => 'bank-new'
  });
}

describe('BankAccountsService.create', () => {
  it('encrypts the number and stores only masked/hash fields', async () => {
    const repo = new FakeRepo();
    const created = await service(repo).create('user-1', {
      bank_code: 'bca',
      account_number: '1234567890',
      account_holder_name: 'Budi'
    });

    expect(created.account_number_masked).toBe('****7890');
    expect(repo.inserted).not.toBeNull();
    expect(repo.inserted!.encryptedNumber.toString('utf8')).toBe('enc:1234567890');
    expect(repo.inserted!.maskedNumber).toBe('****7890');
    expect(repo.inserted!.numberHash).toHaveLength(64);
    expect(repo.inserted!.keyId).toBe('v1');
    expect(repo.inserted!.coolingUntil.toISOString()).toBe('2026-11-04T10:00:00.000Z');
  });

  it('refuses a duplicate active account', async () => {
    const repo = new FakeRepo();
    repo.existing = {
      ...row(),
      account_number_encrypted: Buffer.from('enc:1234567890'),
      encryption_key_id: 'v1',
      account_number_hash: 'h'
    };

    await expect(
      service(repo).create('user-1', {
        bank_code: 'bca',
        account_number: '1234567890',
        account_holder_name: 'Budi'
      })
    ).rejects.toThrow(/sudah terdaftar/);
  });

  it('revives a superseded row instead of hitting the permanent unique index', async () => {
    const repo = new FakeRepo();
    repo.existing = {
      ...row({ superseded_at: now }),
      account_number_encrypted: Buffer.from('enc:1234567890'),
      encryption_key_id: 'v1',
      account_number_hash: 'h'
    };

    await service(repo).create('user-1', {
      bank_code: 'bca',
      account_number: '1234567890',
      account_holder_name: 'Budi'
    });

    expect(repo.revivedWith).not.toBeNull();
    expect(repo.inserted).toBeNull();
  });

  it('fails with a clear message when the encryption key is missing', async () => {
    const repo = new FakeRepo();
    await expect(
      service(repo, () => {
        throw new Error('BANK_ACCOUNT_ENCRYPTION_KEY belum diisi');
      }).create('user-1', {
        bank_code: 'bca',
        account_number: '1234567890',
        account_holder_name: 'Budi'
      })
    ).rejects.toThrow(/BANK_ACCOUNT_ENCRYPTION_KEY/);
  });
});

describe('BankAccountsService admin actions', () => {
  it('supersedes the previous verified account before verifying a new one', async () => {
    const repo = new FakeRepo();
    repo.existing = {
      ...row(),
      account_number_encrypted: Buffer.from('enc:1234567890'),
      encryption_key_id: 'v1',
      account_number_hash: 'h'
    };

    const verified = await service(repo).verify('admin-1', 'admin_super', 'vendor-1', 'bank-1');

    expect(repo.superseded).toBe('bank-1');
    expect(verified.status).toBe('verified');
    expect(repo.auditActions).toContain('vendor.bank_account.verify');
  });

  it('writes the rejection reason and an audit row', async () => {
    const repo = new FakeRepo();
    repo.existing = {
      ...row(),
      account_number_encrypted: Buffer.from('enc:1234567890'),
      encryption_key_id: 'v1',
      account_number_hash: 'h'
    };

    const rejected = await service(repo).reject(
      'admin-1',
      'admin_super',
      'vendor-1',
      'bank-1',
      'Nama pemilik tidak cocok'
    );

    expect(rejected.status).toBe('rejected');
    expect(repo.rejectedReason).toBe('Nama pemilik tidak cocok');
    expect(repo.auditActions).toContain('vendor.bank_account.reject');
  });
});
