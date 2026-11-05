import { describe, expect, it } from 'vitest';
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
  async insertApplication(
    _userId: string,
    input: SubmitVendorApplicationInput
  ): Promise<VendorApplicationRecord> {
    this.inserted = input;
    return record({ status: 'submitted' });
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
