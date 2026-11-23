import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { AppError } from '@tarlink/core/errors';
import type { SubmitVendorApplicationInput, VendorApplicationRecord } from './vendor-onboarding.contracts';
import { VendorOnboardingRepository, maskNik } from './vendor-onboarding.repository';
import { VendorOnboardingService } from './vendor-onboarding.service';
import { VendorOnboardingAdminController } from './vendor-onboarding.controller';
import { ktpKeyPrefix } from './ktp-storage.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const APPLICATION_ID = '22222222-2222-4222-8222-222222222222';

const INPUT: SubmitVendorApplicationInput = {
  display_name: 'Tarling Dian Malam',
  legal_name: 'CV Tarling Dian Malam',
  nik: '3212010101010001',
  region_code: '3212',
  base_address: 'Jl. Pantura No. 1, Indramayu',
  ktp_object_key: `${ktpKeyPrefix(USER_ID)}aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`
};

function record(overrides: Partial<VendorApplicationRecord> = {}): VendorApplicationRecord {
  return {
    id: APPLICATION_ID,
    userId: USER_ID,
    status: 'submitted',
    displayName: INPUT.display_name,
    legalName: INPUT.legal_name,
    nik: INPUT.nik,
    nikCiphertext: null,
    nikKeyId: null,
    regionCode: INPUT.region_code,
    baseAddress: INPUT.base_address,
    ktpObjectKey: INPUT.ktp_object_key,
    reviewNote: null,
    reviewedBy: null,
    reviewedAt: null,
    vendorId: null,
    createdAt: new Date('2026-11-04T09:00:00.000Z'),
    ...overrides
  };
}

class FakeRepository {
  hasAccount = false;
  region = true;
  existing: VendorApplicationRecord | null = null;
  inserted: SubmitVendorApplicationInput | null = null;
  reviewed: 'approve' | 'reject' | null = null;

  async findLatestByUser(): Promise<VendorApplicationRecord | null> {
    return this.existing;
  }
  async hasVendorAccount(): Promise<boolean> {
    return this.hasAccount;
  }
  async regionExists(): Promise<boolean> {
    return this.region;
  }
  insertedSecret: { ciphertext: Buffer; keyId: string } | null = null;

  async insertApplication(
    _userId: string,
    input: SubmitVendorApplicationInput,
    secret: { ciphertext: Buffer; keyId: string }
  ): Promise<VendorApplicationRecord> {
    this.inserted = input;
    this.insertedSecret = secret;
    return record({ status: 'submitted', nik: '' });
  }
  async setNikCiphertext(): Promise<void> {
    return undefined;
  }
  async listForAdmin(): Promise<{ items: VendorApplicationRecord[]; total: number }> {
    return { items: [record()], total: 1 };
  }
  async findById(): Promise<VendorApplicationRecord | null> {
    return this.existing;
  }
  async approve(): Promise<VendorApplicationRecord> {
    this.reviewed = 'approve';
    return record({ status: 'approved', vendorId: 'vendor-1' });
  }
  async reject(): Promise<VendorApplicationRecord> {
    this.reviewed = 'reject';
    return record({ status: 'rejected', reviewNote: 'dokumen buram' });
  }
  async transaction<T>(fn: (client: unknown) => Promise<T>): Promise<T> {
    return fn({});
  }
}

class FakeStorage {
  present = true;
  removed: string | null = null;
  async save(): Promise<{ objectKey: string }> {
    return { objectKey: INPUT.ktp_object_key };
  }
  async exists(): Promise<boolean> {
    return this.present;
  }
  async read(): Promise<{ buffer: Buffer; mime: string; size: number }> {
    return { buffer: Buffer.from('ktp'), mime: 'image/jpeg', size: 3 };
  }
  async remove(objectKey: string): Promise<void> {
    this.removed = objectKey;
  }
  encryptNik(nik: string): { ciphertext: Buffer; keyId: string } {
    return { ciphertext: Buffer.from(nik, 'utf8'), keyId: 'test' };
  }
  decryptNik(payload: Buffer): string {
    return payload.toString('utf8');
  }
}

function setup() {
  const repository = new FakeRepository();
  const storage = new FakeStorage();
  const service = new VendorOnboardingService(
    repository as unknown as VendorOnboardingRepository,
    storage as never
  );
  return { repository, storage, service };
}

describe('maskNik', () => {
  it('keeps only the last four digits', () => {
    expect(maskNik('3212010101010001')).toBe('************0001');
    expect(maskNik('1234')).toBe('1234');
  });
});

describe('VendorOnboardingService.submit', () => {
  it('rejects an account that already owns a vendor', async () => {
    const { repository, service } = setup();
    repository.hasAccount = true;

    await expect(service.submit(USER_ID, INPUT)).rejects.toMatchObject({
      code: 'CONFLICT'
    });
  });

  it('rejects an unknown region', async () => {
    const { repository, service } = setup();
    repository.region = false;

    await expect(service.submit(USER_ID, INPUT)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
  });

  it('rejects a KTP key that belongs to another account', async () => {
    const { service } = setup();

    await expect(
      service.submit(USER_ID, {
        ...INPUT,
        ktp_object_key: `${ktpKeyPrefix('33333333-3333-4333-8333-333333333333')}x.jpg`
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects a KTP key whose file was not uploaded', async () => {
    const { storage, service } = setup();
    storage.present = false;

    await expect(service.submit(USER_ID, INPUT)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
  });

  it('stores the application and returns a masked NIK', async () => {
    const { repository, service } = setup();

    const view = await service.submit(USER_ID, INPUT);

    expect(repository.inserted).toEqual(INPUT);
    // NIK leaves the request path as ciphertext; the plaintext is never inserted.
    expect(repository.insertedSecret).not.toBeNull();
    expect(repository.insertedSecret?.keyId).toBeTruthy();
    expect(view.status).toBe('submitted');
    expect(view.nik).toBe('************0001');
    expect(view.vendor_id).toBeNull();
  });
});

describe('VendorOnboardingService.review', () => {
  it('approves and exposes the full NIK to the admin', async () => {
    const { repository, service } = setup();
    repository.existing = record();

    const view = await service.review(
      APPLICATION_ID,
      { decision: 'approve' },
      { id: 'admin-1', role: 'admin_super' }
    );

    expect(repository.reviewed).toBe('approve');
    expect(view.status).toBe('approved');
    expect(view.nik).toBe(INPUT.nik);
    expect(view.vendor_id).toBe('vendor-1');
  });

  it('rejects with a note and removes the KTP file', async () => {
    const { repository, storage, service } = setup();
    repository.existing = record();

    const view = await service.review(
      APPLICATION_ID,
      { decision: 'reject', note: 'dokumen buram' },
      { id: 'admin-1', role: 'admin_super' }
    );

    expect(repository.reviewed).toBe('reject');
    expect(view.status).toBe('rejected');
    expect(view.review_note).toBe('dokumen buram');
    expect(storage.removed).toBe(INPUT.ktp_object_key);
  });

  it('returns NOT_FOUND for an unknown application', async () => {
    const { service } = setup();

    await expect(
      service.review(APPLICATION_ID, { decision: 'approve' }, { id: 'admin-1', role: 'admin_super' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects self-approval when admin reviews own application', async () => {
    const { repository, service } = setup();
    repository.existing = record({ userId: 'admin-1' });

    await expect(
      service.review(
        APPLICATION_ID,
        { decision: 'approve' },
        { id: 'admin-1', role: 'admin_super' }
      )
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Admin tidak boleh menyetujui pengajuan vendor miliknya sendiri'
    });
  });
});

describe('VendorOnboardingService.myApplication', () => {
  it('returns null when nothing was submitted', async () => {
    const { service } = setup();
    expect(await service.myApplication(USER_ID)).toBeNull();
  });

  it('masks the NIK for the owner', async () => {
    const { repository, service } = setup();
    repository.existing = record();

    const view = await service.myApplication(USER_ID);
    expect(view?.nik).toBe('************0001');
  });
});

describe('VendorOnboardingAdminController', () => {
  it('injects the reject decision into the request body before validation', async () => {
    let received: unknown = null;
    const controller = new VendorOnboardingAdminController({
      review: async (_id: string, input: unknown) => {
        received = input;
        return { id: APPLICATION_ID } as never;
      }
    } as never);

    await controller.reject(
      APPLICATION_ID,
      { note: 'dokumen buram' },
      { user: { id: 'admin-1', roles: ['admin_super'] } } as never
    );

    expect(received).toEqual({ note: 'dokumen buram', decision: 'reject' });
  });

  it('masks NIK for admin_support in the queue', async () => {
    let reveal: boolean | null = null;
    const controller = new VendorOnboardingAdminController({
      list: async (_query: unknown, options: { revealNik: boolean }) => {
        reveal = options.revealNik;
        return { items: [], total: 0, page: 1, page_size: 20 };
      }
    } as never);

    await controller.list(
      {},
      { user: { id: 'support-1', roles: ['admin_support'] } } as never
    );

    expect(reveal).toBe(false);
  });
});

describe('ktp storage key', () => {
  it('scopes the key to the owner id', () => {
    expect(INPUT.ktp_object_key.startsWith(ktpKeyPrefix(USER_ID))).toBe(true);
    expect(INPUT.ktp_object_key.startsWith(ktpKeyPrefix('other'))).toBe(false);
  });
});

const ADMIN_ID = '44444444-4444-4444-8444-444444444444';
const VENDOR_ID = '55555555-5555-4555-8555-555555555555';
const CUSTOMER_SCOPE = '00000000-0000-0000-0000-000000000000';

function applicationRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: APPLICATION_ID,
    user_id: USER_ID,
    status: 'submitted',
    display_name: INPUT.display_name,
    legal_name: INPUT.legal_name,
    nik: null,
    nik_ciphertext: Buffer.from(INPUT.nik, 'utf8'),
    nik_key_id: 'test',
    region_code: INPUT.region_code,
    base_address: INPUT.base_address,
    ktp_object_key: INPUT.ktp_object_key,
    review_note: null,
    reviewed_by: null,
    reviewed_at: null,
    vendor_id: null,
    created_at: new Date('2026-11-04T09:00:00.000Z'),
    ...overrides
  };
}

/**
 * Fake pool client that mimics the `user_roles` primary key
 * `(user_id, role, vendor_scope)`: a plain insert for a key that already exists
 * raises 23505, `DO NOTHING` keeps the row untouched, and
 * `DO UPDATE SET revoked_at = NULL ... WHERE revoked_at IS NOT NULL` restores a
 * revoked row without inserting a second one. Values: `null` = active row.
 */
function fakeApprovalClient(roles: Map<string, Date | null> = new Map()) {
  const roleWrites: Array<{ sql: string; params: unknown[] | undefined }> = [];
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes('FROM vendor_applications') && sql.includes('FOR UPDATE')) {
      return { rows: [applicationRow({ id: String(params?.[0]) })], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO vendors')) {
      return { rows: [{ id: VENDOR_ID }], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO user_roles')) {
      roleWrites.push({ sql, params });
      const role = sql.includes("'customer'") ? 'customer' : 'vendor_owner';
      const key = `${String(params?.[0])}:${role}`;
      const exists = roles.has(key);
      if (!sql.includes('ON CONFLICT') && exists) {
        throw Object.assign(new Error('duplicate key value violates unique constraint'), {
          code: '23505'
        });
      }
      if (!exists) {
        roles.set(key, null);
        return { rows: [], rowCount: 1 };
      }
      const revokedAt = roles.get(key) ?? null;
      if (revokedAt !== null && sql.includes('DO UPDATE SET revoked_at = NULL')) {
        roles.set(key, null);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('UPDATE vendor_applications')) {
      return {
        rows: [applicationRow({ id: String(params?.[0]), status: 'approved', vendor_id: VENDOR_ID })],
        rowCount: 1
      };
    }
    return { rows: [], rowCount: 1 };
  });
  return { client: { query } as unknown as PoolClient, roleWrites, roles };
}

function approve(repository: VendorOnboardingRepository, client: PoolClient, applicationId = APPLICATION_ID) {
  return repository.approve(client, {
    application: record({ id: applicationId }),
    actorId: ADMIN_ID,
    actorRole: 'admin_super',
    slug: 'tarling-dian-malam-22222222',
    now: new Date('2026-11-22T03:00:00.000Z')
  });
}

describe('VendorOnboardingRepository.approve — customer role', () => {
  const repository = new VendorOnboardingRepository();

  it('grants both vendor_owner and customer on the caller transaction', async () => {
    const { client, roleWrites } = fakeApprovalClient();

    await approve(repository, client);

    expect(roleWrites).toHaveLength(2);
    const [ownerGrant, customerGrant] = roleWrites;

    expect(ownerGrant?.sql).toContain("'vendor_owner'");
    expect(ownerGrant?.params).toEqual([USER_ID, VENDOR_ID, ADMIN_ID]);

    // Customer has no vendor: role check requires vendor_id NULL and the
    // all-zero vendor_scope.
    expect(customerGrant?.sql).toContain("'customer'");
    expect(customerGrant?.sql).toContain(`NULL, '${CUSTOMER_SCOPE}'`);
    expect(customerGrant?.sql).toContain(
      'DO UPDATE SET revoked_at = NULL WHERE user_roles.revoked_at IS NOT NULL'
    );
    expect(customerGrant?.params).toEqual([USER_ID]);
  });

  it('still succeeds when the user already holds the customer role', async () => {
    const { client, roleWrites, roles } = fakeApprovalClient(
      new Map([[`${USER_ID}:customer`, null]])
    );

    await expect(approve(repository, client)).resolves.toMatchObject({
      status: 'approved',
      vendorId: VENDOR_ID
    });

    const customerWrites = roleWrites.filter((write) => write.sql.includes("'customer'"));
    expect(customerWrites).toHaveLength(1);
    expect(roles.get(`${USER_ID}:customer`)).toBeNull();
  });

  it('restores a revoked customer row instead of duplicating it', async () => {
    const revokedAt = new Date('2026-10-01T00:00:00.000Z');
    const { client, roles } = fakeApprovalClient(new Map([[`${USER_ID}:customer`, revokedAt]]));

    await approve(repository, client);

    expect(roles.has(`${USER_ID}:customer`)).toBe(true);
    expect(roles.get(`${USER_ID}:customer`)).toBeNull();
    expect(roles.size).toBe(2); // vendor_owner + customer, no third customer row
  });

  it('re-approving another application for the same user does not fail', async () => {
    const { client, roleWrites } = fakeApprovalClient();
    const secondApplicationId = '66666666-6666-4666-8666-666666666666';

    await approve(repository, client);
    await approve(repository, client, secondApplicationId);

    const customerWrites = roleWrites.filter((write) => write.sql.includes("'customer'"));
    expect(customerWrites).toHaveLength(2);
    for (const write of customerWrites) {
      expect(write.sql).toContain(
        'DO UPDATE SET revoked_at = NULL WHERE user_roles.revoked_at IS NOT NULL'
      );
      expect(write.params).toEqual([USER_ID]);
    }
  });
});
