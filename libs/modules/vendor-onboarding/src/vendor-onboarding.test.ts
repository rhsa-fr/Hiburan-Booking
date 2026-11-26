import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import {
  SUBMIT_VENDOR_APPLICATION_BODY,
  type SubmitVendorApplicationInput,
  type VendorAccountRecord,
  type VendorApplicationRecord,
  type VendorCategoryRecord,
  type VendorPolicyRecord
} from './vendor-onboarding.contracts';
import {
  VendorOnboardingRepository,
  maskNik,
  type ApplicationWindow
} from './vendor-onboarding.repository';
import { VendorOnboardingService } from './vendor-onboarding.service';
import {
  VendorOnboardingAdminController,
  VendorOnboardingController
} from './vendor-onboarding.controller';
import { ktpKeyPrefix } from './ktp-storage.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const APPLICATION_ID = '22222222-2222-4222-8222-222222222222';
const POLICY_ID = '77777777-7777-4777-8777-777777777777';

const DESCRIPTION =
  'Grup tarling aktif sejak 2015 dengan delapan personel tetap dan jadwal rutin.';
const EQUIPMENT =
  'Satu set sound system 2000 watt, delapan mikrofon, dan generator cadangan.';

const INPUT: SubmitVendorApplicationInput = {
  display_name: 'Tarling Dian Malam',
  legal_name: 'CV Tarling Dian Malam',
  nik: '3212010101010001',
  region_code: '3212',
  base_address: 'Jl. Pantura No. 1, Indramayu',
  ktp_object_key: `${ktpKeyPrefix(USER_ID)}aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`,
  category_slug: 'tarling',
  years_active: 9,
  description: DESCRIPTION,
  personnel_count: 8,
  equipment_summary: EQUIPMENT,
  portfolio_url: 'https://instagram.com/tarlingdianmalam',
  agreement_policy_version_id: POLICY_ID
};

const POLICY_BODY = {
  status: 'operational',
  ringkasan: 'Ketentuan Mitra v1',
  sections: [{ heading: 'Data', body: 'Harus benar.' }]
};

function account(overrides: Partial<VendorAccountRecord> = {}): VendorAccountRecord {
  return {
    name: 'Budi Santoso',
    phone: '081234567890',
    email: 'budi@example.com',
    emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    status: 'active',
    ...overrides
  };
}

function policy(overrides: Partial<VendorPolicyRecord> = {}): VendorPolicyRecord {
  return {
    id: POLICY_ID,
    code: 'vendor',
    version: 1,
    bodyHash: 'abc123',
    effectiveFrom: new Date('2026-11-01T00:00:00.000Z'),
    body: POLICY_BODY,
    ...overrides
  };
}

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
    formVersion: 2,
    categoryId: 1,
    categorySlug: INPUT.category_slug,
    categoryName: 'Tarling & Dangdut',
    yearsActive: INPUT.years_active,
    description: INPUT.description,
    personnelCount: INPUT.personnel_count,
    equipmentSummary: INPUT.equipment_summary,
    portfolioUrl: INPUT.portfolio_url,
    agreementPolicyVersionId: POLICY_ID,
    agreementVersion: 1,
    ...overrides
  };
}

class FakeRepository {
  hasAccount = false;
  region = true;
  existing: VendorApplicationRecord | null = null;
  account: VendorAccountRecord | null = account();
  policy: VendorPolicyRecord | null = policy();
  /** Overrides what the in-transaction lock returns (race simulation). */
  lockedPolicy: { id: string; version: number } | null = null;
  openApplication = false;
  window: ApplicationWindow = { count: 0, oldest: null };
  referencedKtpKeys: string[] = [];
  categories = new Map<string, VendorCategoryRecord>([
    ['tarling', { id: 1, slug: 'tarling', name: 'Tarling & Dangdut', isActive: true }],
    ['organ-tunggal', { id: 2, slug: 'organ-tunggal', name: 'Organ Tunggal', isActive: true }]
  ]);

  inserted: SubmitVendorApplicationInput | null = null;
  insertedSecret: { ciphertext: Buffer; keyId: string } | null = null;
  resolved: { categoryId: number; agreementPolicyVersionId: string } | null = null;
  calls: string[] = [];
  consents: Array<{
    userId: string;
    policyCode: string;
    policyVersionId: string;
    acceptedAt: Date;
    ip: string | null;
    userAgent: string | null;
  }> = [];
  audits: Array<{
    applicationId: string;
    userId: string;
    policyVersion: number;
    categorySlug: string;
  }> = [];
  ktpAudits: Array<{ applicationId: string; actorId: string; actorRole: string }> = [];
  reviewed: 'approve' | 'reject' | null = null;

  async findAccount(): Promise<VendorAccountRecord | null> {
    return this.account;
  }
  async findLatestByUser(): Promise<VendorApplicationRecord | null> {
    return this.existing;
  }
  async hasVendorAccount(): Promise<boolean> {
    return this.hasAccount;
  }
  async hasOpenApplication(): Promise<boolean> {
    return this.openApplication;
  }
  async countApplicationsSince(): Promise<ApplicationWindow> {
    return this.window;
  }
  async regionExists(): Promise<boolean> {
    return this.region;
  }
  async categoryBySlug(slug: string): Promise<VendorCategoryRecord | null> {
    return this.categories.get(slug) ?? null;
  }
  async listActiveCategories(): Promise<Array<{ slug: string; name: string }>> {
    return [...this.categories.values()]
      .filter((category) => category.isActive)
      .map(({ slug, name }) => ({ slug, name }));
  }
  async currentVendorPolicy(): Promise<VendorPolicyRecord | null> {
    return this.policy;
  }
  async lockVendorPolicy(): Promise<{ id: string; version: number } | null> {
    this.calls.push('lock');
    if (this.lockedPolicy) return this.lockedPolicy;
    return this.policy ? { id: this.policy.id, version: this.policy.version } : null;
  }
  async listKtpKeysForUser(): Promise<string[]> {
    return this.referencedKtpKeys;
  }
  async policyVersionById(id: string): Promise<{ id: string; code: string; version: number } | null> {
    return this.policy && this.policy.id === id
      ? { id: this.policy.id, code: this.policy.code, version: this.policy.version }
      : null;
  }
  async insertConsent(
    _client: unknown,
    input: {
      userId: string;
      policyCode: string;
      policyVersionId: string;
      acceptedAt: Date;
      ip: string | null;
      userAgent: string | null;
    }
  ): Promise<void> {
    this.calls.push('consent');
    this.consents.push(input);
  }
  async insertApplication(
    _client: unknown,
    _userId: string,
    input: SubmitVendorApplicationInput,
    secret: { ciphertext: Buffer; keyId: string },
    resolved: { categoryId: number; agreementPolicyVersionId: string }
  ): Promise<VendorApplicationRecord> {
    this.calls.push('insert');
    this.inserted = input;
    this.insertedSecret = secret;
    this.resolved = resolved;
    return record({ status: 'submitted', nik: '' });
  }
  async insertSubmitAudit(
    _client: unknown,
    input: {
      applicationId: string;
      userId: string;
      policyVersion: number;
      categorySlug: string;
    }
  ): Promise<void> {
    this.calls.push('audit');
    this.audits.push(input);
  }
  async setNikCiphertext(): Promise<void> {
    return undefined;
  }
  async recordKtpAccess(input: { applicationId: string; actorId: string; actorRole: string }): Promise<void> {
    this.ktpAudits.push(input);
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
  readFails = false;
  removed: string | null = null;
  calls: string[] = [];
  pruneCalls: Array<{ userId: string; keys: string[]; now: Date }> = [];
  async save(): Promise<{ objectKey: string }> {
    this.calls.push('save');
    return { objectKey: INPUT.ktp_object_key };
  }
  async pruneUserOrphans(userId: string, keys: readonly string[], now: Date): Promise<void> {
    this.calls.push('prune');
    this.pruneCalls.push({ userId, keys: [...keys], now });
  }
  async exists(): Promise<boolean> {
    return this.present;
  }
  async read(): Promise<{ buffer: Buffer; mime: string; size: number }> {
    this.calls.push('read');
    if (this.readFails) throw new Error('disk read failed');
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

describe('SUBMIT_VENDOR_APPLICATION_BODY', () => {
  it('accepts the wizard payload and normalises an empty portfolio to null', () => {
    const parsed = SUBMIT_VENDOR_APPLICATION_BODY.safeParse({
      ...INPUT,
      portfolio_url: ''
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.portfolio_url).toBeNull();
      expect(parsed.data.years_active).toBe(INPUT.years_active);
    }
  });

  it('treats a missing portfolio as null', () => {
    const { portfolio_url: _ignored, ...withoutPortfolio } = INPUT;
    const parsed = SUBMIT_VENDOR_APPLICATION_BODY.safeParse(withoutPortfolio);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.portfolio_url).toBeNull();
  });

  it('enforces the 40 character description floor', () => {
    expect(
      SUBMIT_VENDOR_APPLICATION_BODY.safeParse({ ...INPUT, description: 'a'.repeat(39) }).success
    ).toBe(false);
    expect(
      SUBMIT_VENDOR_APPLICATION_BODY.safeParse({ ...INPUT, description: 'a'.repeat(40) }).success
    ).toBe(true);
  });

  it('counts Unicode code points, not UTF-16 units, for description', () => {
    const twentyEmoji = '😀'.repeat(20);
    // `.length` is 40 for 20 emoji; Postgres char_length() is 20.
    expect(twentyEmoji.length).toBe(40);
    expect(
      SUBMIT_VENDOR_APPLICATION_BODY.safeParse({ ...INPUT, description: twentyEmoji }).success
    ).toBe(false);
    expect(
      SUBMIT_VENDOR_APPLICATION_BODY.safeParse({ ...INPUT, description: '😀'.repeat(40) }).success
    ).toBe(true);
  });

  it('counts Unicode code points for the other length-limited fields', () => {
    expect(
      SUBMIT_VENDOR_APPLICATION_BODY.safeParse({ ...INPUT, equipment_summary: '😀'.repeat(19) })
        .success
    ).toBe(false);
    expect(
      SUBMIT_VENDOR_APPLICATION_BODY.safeParse({ ...INPUT, equipment_summary: '😀'.repeat(20) })
        .success
    ).toBe(true);
    expect(
      SUBMIT_VENDOR_APPLICATION_BODY.safeParse({ ...INPUT, display_name: '😀' }).success
    ).toBe(false);
    expect(
      SUBMIT_VENDOR_APPLICATION_BODY.safeParse({ ...INPUT, base_address: '😀'.repeat(9) }).success
    ).toBe(false);
  });

  it('rejects a non-https portfolio link', () => {
    expect(
      SUBMIT_VENDOR_APPLICATION_BODY.safeParse({
        ...INPUT,
        portfolio_url: 'http://instagram.com/tarling'
      }).success
    ).toBe(false);
  });

  it('rejects a bare scheme that would violate the DB check', () => {
    expect(
      SUBMIT_VENDOR_APPLICATION_BODY.safeParse({ ...INPUT, portfolio_url: 'https://' }).success
    ).toBe(false);
    expect(
      SUBMIT_VENDOR_APPLICATION_BODY.safeParse({ ...INPUT, portfolio_url: 'https:// ' }).success
    ).toBe(false);
  });

  it('accepts a minimal and a normal https link', () => {
    for (const url of ['https://a', 'https://instagram.com/tarling-dian-malam']) {
      const parsed = SUBMIT_VENDOR_APPLICATION_BODY.safeParse({ ...INPUT, portfolio_url: url });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.portfolio_url).toBe(url);
    }
  });

  it('normalises null and empty portfolio to null', () => {
    for (const value of [null, '', undefined]) {
      const parsed = SUBMIT_VENDOR_APPLICATION_BODY.safeParse({
        ...INPUT,
        portfolio_url: value
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.portfolio_url).toBeNull();
    }
  });

  it('rejects unknown fields, including form_version', () => {
    expect(SUBMIT_VENDOR_APPLICATION_BODY.safeParse({ ...INPUT, form_version: 2 }).success).toBe(
      false
    );
    expect(SUBMIT_VENDOR_APPLICATION_BODY.safeParse({ ...INPUT, nope: true }).success).toBe(false);
  });
});

describe('VendorOnboardingService.submit', () => {
  it('rejects an incomplete profile', async () => {
    const { repository, service } = setup();
    repository.account = account({ name: ' ' });

    await expect(service.submit(USER_ID, INPUT)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { reason: 'PROFILE_INCOMPLETE' }
    });
    expect(repository.inserted).toBeNull();
  });

  it('rejects an inactive account', async () => {
    const { repository, service } = setup();
    repository.account = account({ status: 'suspended' });

    await expect(service.submit(USER_ID, INPUT)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { reason: 'PROFILE_INCOMPLETE' }
    });
  });

  it('rejects an unverified email before writing anything', async () => {
    const { repository, service } = setup();
    repository.account = account({ emailVerifiedAt: null });

    await expect(service.submit(USER_ID, INPUT)).rejects.toMatchObject({
      code: 'EMAIL_NOT_VERIFIED'
    });
    expect(repository.calls).toEqual([]);
  });

  it('rejects an account that already owns a vendor', async () => {
    const { repository, service } = setup();
    repository.hasAccount = true;

    await expect(service.submit(USER_ID, INPUT)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'VENDOR_EXISTS' }
    });
  });

  it('rejects a second open application without inserting', async () => {
    const { repository, service } = setup();
    repository.openApplication = true;

    await expect(service.submit(USER_ID, INPUT)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'APPLICATION_OPEN' }
    });
    expect(repository.calls).toEqual([]);
    expect(repository.inserted).toBeNull();
  });

  it('rate limits a 4th application in 24 hours', async () => {
    const { repository, service } = setup();
    const oldest = new Date(Date.now() - 60 * 60 * 1000);
    repository.window = { count: 3, oldest };

    const error = await service.submit(USER_ID, INPUT).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: 'RATE_LIMITED' });
    const details = (error as { details?: { reason?: string; retry_after_seconds?: number } }).details;
    expect(details?.reason).toBe('RESUBMIT_LIMIT');
    expect(details?.retry_after_seconds).toBeGreaterThan(0);
    expect(details?.retry_after_seconds).toBeLessThanOrEqual(24 * 60 * 60);
  });

  it('computes retry_after_seconds exactly from the oldest application', async () => {
    const { repository, service } = setup();
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-26T10:00:00.000Z'));
      repository.window = { count: 3, oldest: new Date('2026-11-26T09:00:00.000Z') };

      const error = await service.submit(USER_ID, INPUT).catch((caught: unknown) => caught);

      // Oldest frees its slot 23 hours from now: 24h - 1h.
      expect((error as { details?: unknown }).details).toEqual({
        reason: 'RESUBMIT_LIMIT',
        retry_after_seconds: 82_800
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-checks the policy under lock inside the transaction', async () => {
    const { repository, service } = setup();
    // Pre-check sees v1; a new version lands before the insert's lock.
    repository.lockedPolicy = { id: POLICY_ID, version: 2 };

    await expect(service.submit(USER_ID, INPUT)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: {
        reason: 'POLICY_VERSION_STALE',
        current_policy_version_id: POLICY_ID,
        current_policy_version: 2
      }
    });
    expect(repository.calls).toEqual(['lock']);
    expect(repository.consents).toEqual([]);
    expect(repository.inserted).toBeNull();
  });

  it('rejects an unknown region', async () => {
    const { repository, service } = setup();
    repository.region = false;

    await expect(service.submit(USER_ID, INPUT)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { reason: 'REGION_UNKNOWN' }
    });
  });

  it('rejects an unknown category', async () => {
    const { service } = setup();

    await expect(
      service.submit(USER_ID, { ...INPUT, category_slug: 'tidak-ada' })
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { reason: 'CATEGORY_UNKNOWN' }
    });
  });

  it('rejects an inactive category', async () => {
    const { repository, service } = setup();
    repository.categories.set('tarling', {
      id: 1,
      slug: 'tarling',
      name: 'Tarling & Dangdut',
      isActive: false
    });

    await expect(service.submit(USER_ID, INPUT)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { reason: 'CATEGORY_INACTIVE' }
    });
  });

  it('rejects a stale agreement version with the current one in details', async () => {
    const { repository, service } = setup();
    const currentId = '88888888-8888-4888-8888-888888888888';
    repository.policy = policy({ id: currentId, version: 2 });

    await expect(service.submit(USER_ID, INPUT)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: {
        reason: 'POLICY_VERSION_STALE',
        current_policy_version_id: currentId,
        current_policy_version: 2
      }
    });
  });

  it('rejects a KTP key that belongs to another account', async () => {
    const { service } = setup();

    await expect(
      service.submit(USER_ID, {
        ...INPUT,
        ktp_object_key: `${ktpKeyPrefix('33333333-3333-4333-8333-333333333333')}x.jpg`
      })
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { reason: 'KTP_INVALID' }
    });
  });

  it('rejects a KTP key whose file was not uploaded', async () => {
    const { storage, service } = setup();
    storage.present = false;

    await expect(service.submit(USER_ID, INPUT)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { reason: 'KTP_INVALID' }
    });
  });

  it('writes consent, application and audit in that order and returns the form v2 view', async () => {
    const { repository, service } = setup();

    const view = await service.submit(USER_ID, INPUT, {
      ip: '10.1.2.3',
      userAgent: 'vitest-agent'
    });

    expect(repository.calls).toEqual(['lock', 'consent', 'insert', 'audit']);
    expect(repository.inserted).toEqual(INPUT);
    // NIK leaves the request path as ciphertext; the plaintext is never inserted.
    expect(repository.insertedSecret).not.toBeNull();
    expect(repository.insertedSecret?.keyId).toBeTruthy();
    expect(repository.resolved).toEqual({
      categoryId: 1,
      agreementPolicyVersionId: POLICY_ID
    });
    expect(repository.consents[0]).toMatchObject({
      userId: USER_ID,
      policyCode: 'vendor',
      policyVersionId: POLICY_ID,
      ip: '10.1.2.3',
      userAgent: 'vitest-agent'
    });
    expect(repository.audits[0]).toMatchObject({
      applicationId: APPLICATION_ID,
      userId: USER_ID,
      policyVersion: 1,
      categorySlug: 'tarling'
    });

    expect(view.form_version).toBe(2);
    expect(view.status).toBe('submitted');
    expect(view.nik).toBe('************0001');
    expect(view.vendor_id).toBeNull();
    expect(view.category_slug).toBe('tarling');
    expect(view.category_name).toBe('Tarling & Dangdut');
    expect(view.years_active).toBe(9);
    expect(view.personnel_count).toBe(8);
    expect(view.description).toBe(DESCRIPTION);
    expect(view.equipment_summary).toBe(EQUIPMENT);
    expect(view.portfolio_url).toBe(INPUT.portfolio_url);
    expect(view.agreement_version_id).toBe(POLICY_ID);
    expect(view.agreement_version).toBe(1);
  });

  it('allows a resubmission once the previous application was rejected', async () => {
    const { repository, service } = setup();
    repository.existing = record({ status: 'rejected' });
    repository.window = { count: 1, oldest: new Date(Date.now() - 60_000) };

    const view = await service.submit(USER_ID, INPUT);
    expect(view.status).toBe('submitted');
    expect(repository.calls).toEqual(['lock', 'consent', 'insert', 'audit']);
  });
});

describe('VendorOnboardingService.myApplication', () => {
  it('returns null when nothing was submitted', async () => {
    const { service } = setup();
    expect(await service.myApplication(USER_ID)).toBeNull();
  });

  it('masks the NIK and returns the extended form v2 view', async () => {
    const { repository, service } = setup();
    repository.existing = record();

    const view = await service.myApplication(USER_ID);
    expect(view?.nik).toBe('************0001');
    expect(view?.form_version).toBe(2);
    expect(view?.category_name).toBe('Tarling & Dangdut');
    expect(view?.agreement_version).toBe(1);
  });

  it('returns a legacy form v1 row with null wizard fields', async () => {
    const { repository, service } = setup();
    repository.existing = record({
      formVersion: 1,
      categoryId: null,
      categorySlug: null,
      categoryName: null,
      yearsActive: null,
      description: null,
      personnelCount: null,
      equipmentSummary: null,
      portfolioUrl: null,
      agreementPolicyVersionId: null,
      agreementVersion: null
    });

    const view = await service.myApplication(USER_ID);
    expect(view?.form_version).toBe(1);
    expect(view?.category_slug).toBeNull();
    expect(view?.agreement_version).toBeNull();
  });
});

describe('VendorOnboardingService.uploadKtp / ktpFile', () => {
  it('prunes unreferenced KTP files before saving the new upload', async () => {
    const { repository, storage, service } = setup();
    repository.referencedKtpKeys = [`${ktpKeyPrefix(USER_ID)}kept.jpg`];

    await service.uploadKtp(USER_ID, undefined);

    expect(storage.calls).toEqual(['prune', 'save']);
    expect(storage.pruneCalls).toHaveLength(1);
    expect(storage.pruneCalls[0]?.userId).toBe(USER_ID);
    expect(storage.pruneCalls[0]?.keys).toEqual([`${ktpKeyPrefix(USER_ID)}kept.jpg`]);
    expect(storage.pruneCalls[0]?.now).toBeInstanceOf(Date);
  });

  it('audits KTP access before reading the bytes', async () => {
    const { repository, storage, service } = setup();
    repository.existing = record();
    const order: string[] = [];
    repository.recordKtpAccess = async () => {
      order.push('audit');
    };
    storage.read = async () => {
      order.push('read');
      return { buffer: Buffer.from('ktp'), mime: 'image/jpeg', size: 3 };
    };

    await service.ktpFile(APPLICATION_ID, { id: 'admin-1', role: 'admin_super' });

    expect(order).toEqual(['audit', 'read']);
  });

  it('keeps the audit attempt when the read fails', async () => {
    const { repository, storage, service } = setup();
    repository.existing = record();
    storage.readFails = true;

    await expect(
      service.ktpFile(APPLICATION_ID, { id: 'admin-1', role: 'admin_super' })
    ).rejects.toThrow('disk read failed');
    expect(repository.ktpAudits).toHaveLength(1);
    expect(repository.ktpAudits[0]).toMatchObject({
      applicationId: APPLICATION_ID,
      actorId: 'admin-1'
    });
  });
});

describe('VendorOnboardingService.eligibility', () => {
  it('reports a ready account with the exact policy document and categories', async () => {
    const { service } = setup();

    const result = await service.eligibility(USER_ID);

    expect(result.can_submit).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.account).toEqual({
      name: 'Budi Santoso',
      phone: '081234567890',
      email: 'budi@example.com',
      email_verified: true
    });
    expect(result.application).toBeNull();
    expect(result.policy).toEqual({
      id: POLICY_ID,
      code: 'vendor',
      version: 1,
      body_hash: 'abc123',
      effective_from: '2026-11-01T00:00:00.000Z',
      body: POLICY_BODY
    });
    expect(result.categories).toEqual([
      { slug: 'tarling', name: 'Tarling & Dangdut' },
      { slug: 'organ-tunggal', name: 'Organ Tunggal' }
    ]);
  });

  const blockerCases: Array<[string, (repo: FakeRepository) => void, string]> = [
    [
      'inactive account',
      (repo) => {
        repo.account = account({ status: 'deleted' });
      },
      'ACCOUNT_INACTIVE'
    ],
    [
      'missing name',
      (repo) => {
        repo.account = account({ name: null });
      },
      'NAME_MISSING'
    ],
    [
      'missing phone',
      (repo) => {
        repo.account = account({ phone: ' ' });
      },
      'PHONE_MISSING'
    ],
    [
      'unverified email',
      (repo) => {
        repo.account = account({ emailVerifiedAt: null });
      },
      'EMAIL_NOT_VERIFIED'
    ],
    [
      'existing vendor',
      (repo) => {
        repo.hasAccount = true;
      },
      'VENDOR_ACCOUNT_EXISTS'
    ],
    [
      'open application',
      (repo) => {
        repo.existing = record({ status: 'submitted' });
      },
      'APPLICATION_OPEN'
    ],
    [
      'missing policy',
      (repo) => {
        repo.policy = null;
      },
      'POLICY_UNAVAILABLE'
    ]
  ];

  for (const [name, mutate, code] of blockerCases) {
    it(`blocks submission when ${name}`, async () => {
      const { repository, service } = setup();
      mutate(repository);

      const result = await service.eligibility(USER_ID);

      expect(result.can_submit).toBe(false);
      expect(result.blockers.map((blocker) => blocker.code)).toContain(code);
    });
  }

  it('returns the policy as null when it is unavailable', async () => {
    const { repository, service } = setup();
    repository.policy = null;

    const result = await service.eligibility(USER_ID);
    expect(result.policy).toBeNull();
  });

  it('does not treat a decided application as a blocker', async () => {
    const { repository, service } = setup();
    repository.existing = record({ status: 'rejected' });

    const result = await service.eligibility(USER_ID);
    expect(result.can_submit).toBe(true);
    expect(result.application?.status).toBe('rejected');
  });
});

describe('VendorOnboardingController', () => {
  it('passes the request fingerprint into submit', async () => {
    let context: unknown = null;
    let received: unknown = null;
    const controller = new VendorOnboardingController({
      submit: async (_id: string, input: unknown, ctx: unknown) => {
        received = input;
        context = ctx;
        return { id: APPLICATION_ID } as never;
      }
    } as never);

    await controller.submit(
      { ...INPUT, portfolio_url: undefined },
      '10.1.2.3',
      'vitest-agent',
      { user: { id: USER_ID, roles: ['customer'] } } as never
    );

    expect(context).toEqual({ ip: '10.1.2.3', userAgent: 'vitest-agent' });
    expect(received).toMatchObject({ category_slug: 'tarling', portfolio_url: null });
  });

  it('rejects an invalid submit body before calling the service', async () => {
    const submit = vi.fn();
    const controller = new VendorOnboardingController({ submit } as never);

    await expect(
      controller.submit(
        { ...INPUT, description: 'pendek' },
        '127.0.0.1',
        undefined,
        { user: { id: USER_ID, roles: ['customer'] } } as never
      )
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(submit).not.toHaveBeenCalled();
  });

  it('rejects a bare https:// portfolio as VALIDATION_ERROR, not a DB failure', async () => {
    const submit = vi.fn();
    const controller = new VendorOnboardingController({ submit } as never);

    await expect(
      controller.submit(
        { ...INPUT, portfolio_url: 'https://' },
        '127.0.0.1',
        undefined,
        { user: { id: USER_ID, roles: ['customer'] } } as never
      )
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(submit).not.toHaveBeenCalled();
  });

  it('asks an old APK to update instead of a generic validation error', async () => {
    const submit = vi.fn();
    const controller = new VendorOnboardingController({ submit } as never);
    const legacyBody = {
      display_name: INPUT.display_name,
      legal_name: INPUT.legal_name,
      nik: INPUT.nik,
      region_code: INPUT.region_code,
      base_address: INPUT.base_address,
      ktp_object_key: INPUT.ktp_object_key
    };

    await expect(
      controller.submit(legacyBody, '127.0.0.1', undefined, {
        user: { id: USER_ID, roles: ['customer'] }
      } as never)
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'APP_UPDATE_REQUIRED' }
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it('rejects a 20-emoji description before it can reach the DB', async () => {
    const submit = vi.fn();
    const controller = new VendorOnboardingController({ submit } as never);

    await expect(
      controller.submit(
        { ...INPUT, description: '😀'.repeat(20) },
        '127.0.0.1',
        undefined,
        { user: { id: USER_ID, roles: ['customer'] } } as never
      )
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(submit).not.toHaveBeenCalled();
  });

  it('rate limits the 6th KTP upload in an hour', async () => {
    const uploadKtp = vi.fn(async () => ({ ktp_object_key: 'ktp/key.jpg' }));
    const controller = new VendorOnboardingController({ uploadKtp } as never);
    const request = { user: { id: USER_ID, roles: ['customer'] } } as never;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(controller.uploadKtp(undefined, request)).resolves.toEqual({
        data: { ktp_object_key: 'ktp/key.jpg' }
      });
    }

    await expect(controller.uploadKtp(undefined, request)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      details: { reason: 'KTP_UPLOAD_LIMIT' }
    });
    expect(uploadKtp).toHaveBeenCalledTimes(5);
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

  it('prefers admin_super when an account holds several admin roles', async () => {
    let actor: { id: string; role: string } | null = null;
    const controller = new VendorOnboardingAdminController({
      review: async (_id: string, _input: unknown, received: { id: string; role: string }) => {
        actor = received;
        return { id: APPLICATION_ID } as never;
      }
    } as never);

    await controller.approve(APPLICATION_ID, {
      user: { id: 'admin-1', roles: ['admin_support', 'admin_super'] }
    } as never);

    expect(actor).toMatchObject({ id: 'admin-1', role: 'admin_super' });
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
    form_version: 2,
    category_id: 1,
    category_slug: INPUT.category_slug,
    category_name: 'Tarling & Dangdut',
    years_active: INPUT.years_active,
    description: INPUT.description,
    personnel_count: INPUT.personnel_count,
    equipment_summary: INPUT.equipment_summary,
    portfolio_url: INPUT.portfolio_url,
    agreement_policy_version_id: POLICY_ID,
    agreement_version: 1,
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
function fakeApprovalClient(
  roles: Map<string, Date | null> = new Map(),
  current: Record<string, unknown> = applicationRow()
) {
  const roleWrites: Array<{ sql: string; params: unknown[] | undefined }> = [];
  const vendorWrites: Array<{ sql: string; params: unknown[] | undefined }> = [];
  const categoryWrites: Array<{ sql: string; params: unknown[] | undefined }> = [];
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes('LEFT JOIN categories')) {
      return {
        rows: [
          applicationRow({
            id: String(params?.[0]),
            status: 'approved',
            vendor_id: VENDOR_ID
          })
        ],
        rowCount: 1
      };
    }
    if (sql.includes('FROM vendor_applications') && sql.includes('FOR UPDATE')) {
      return { rows: [{ ...current, id: String(params?.[0]) }], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO vendors')) {
      vendorWrites.push({ sql, params });
      return { rows: [{ id: VENDOR_ID }], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO vendor_categories')) {
      categoryWrites.push({ sql, params });
      return { rows: [], rowCount: 1 };
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
  return { client: { query } as unknown as PoolClient, roleWrites, vendorWrites, categoryWrites, roles };
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

describe('VendorOnboardingRepository.approve — wizard fields', () => {
  const repository = new VendorOnboardingRepository();

  it('copies the application description into the vendor row', async () => {
    const { client, vendorWrites } = fakeApprovalClient();

    await approve(repository, client);

    expect(vendorWrites).toHaveLength(1);
    expect(vendorWrites[0]?.sql).toContain('description');
    expect(vendorWrites[0]?.params?.[6]).toBe(DESCRIPTION);
  });

  it('assigns the chosen category as the primary vendor category', async () => {
    const { client, categoryWrites } = fakeApprovalClient();

    await approve(repository, client);

    expect(categoryWrites).toHaveLength(1);
    expect(categoryWrites[0]?.sql).toContain('INSERT INTO vendor_categories');
    expect(categoryWrites[0]?.sql).toContain('is_primary');
    expect(categoryWrites[0]?.sql).toContain('ON CONFLICT DO NOTHING');
    expect(categoryWrites[0]?.params).toEqual([VENDOR_ID, 1]);
  });

  it('skips the category insert for a legacy form v1 row', async () => {
    const { client, categoryWrites } = fakeApprovalClient(
      new Map(),
      applicationRow({ category_id: null, form_version: 1 })
    );

    await approve(repository, client);

    expect(categoryWrites).toHaveLength(0);
  });
});

describe('VendorOnboardingRepository.insertApplication — DB errors', () => {
  const repository = new VendorOnboardingRepository();
  const secret = { ciphertext: Buffer.from('x'), keyId: 'test' };
  const resolved = { categoryId: 1, agreementPolicyVersionId: POLICY_ID };

  function failingClient(code: string): PoolClient {
    return {
      query: vi.fn(async () => {
        throw Object.assign(new Error(`db error ${code}`), { code });
      })
    } as unknown as PoolClient;
  }

  it('maps a unique violation to CONFLICT APPLICATION_OPEN', async () => {
    await expect(
      repository.insertApplication(failingClient('23505'), USER_ID, INPUT, secret, resolved)
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'APPLICATION_OPEN' }
    });
  });

  it.each(['23514', '23503'])('maps %s to VALIDATION_ERROR DB_CONSTRAINT', async (code) => {
    await expect(
      repository.insertApplication(failingClient(code), USER_ID, INPUT, secret, resolved)
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { reason: 'DB_CONSTRAINT' }
    });
  });
});
