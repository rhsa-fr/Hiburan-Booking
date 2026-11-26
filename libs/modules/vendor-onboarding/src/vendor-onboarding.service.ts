import { Injectable } from '@nestjs/common';
import { AppError } from '@tarlink/core/errors';
import { slugify } from '@tarlink/modules/catalog';
import type { UploadedImage } from '@tarlink/modules/vendor-portal';
import {
  type EligibilityBlocker,
  type ListVendorApplicationsQuery,
  type SubmitVendorApplicationContext,
  type SubmitVendorApplicationInput,
  type VendorApplicationList,
  type VendorApplicationRecord,
  type VendorApplicationView,
  type VendorEligibilityView,
  type ReviewVendorApplicationInput
} from './vendor-onboarding.contracts';
import {
  VendorOnboardingRepository,
  toApplicationView
} from './vendor-onboarding.repository';
import { KtpStorageService, ktpKeyPrefix } from './ktp-storage.service';

export interface ReviewActor {
  readonly id: string;
  readonly role: string;
}

/** 3 submissions per rolling 24 hours; the oldest one frees the next slot. */
const RESUBMIT_LIMIT = 3;
const RESUBMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const NO_CONTEXT: SubmitVendorApplicationContext = { ip: null, userAgent: null };

@Injectable()
export class VendorOnboardingService {
  constructor(
    private readonly repository: VendorOnboardingRepository,
    private readonly storage: KtpStorageService
  ) {}

  regions(): Promise<Array<{ code: string; name: string; level: string }>> {
    return this.repository.listRegions();
  }

  /**
   * Stores the KTP privately and returns the opaque key used at submit time.
   *
   * The API is the only process that can see `PRIVATE_UPLOAD_DIR`, so each
   * successful upload first prunes that user's abandoned files older than 24h
   * that no row references. That bounds retried uploads for active users;
   * sweeping users who never return needs a volume-aware job (follow-up).
   */
  async uploadKtp(
    userId: string,
    file: UploadedImage | undefined
  ): Promise<{ ktp_object_key: string }> {
    const referenced = await this.repository.listKtpKeysForUser(userId);
    await this.storage.pruneUserOrphans(userId, referenced, new Date());
    const saved = await this.storage.save(userId, file);
    return { ktp_object_key: saved.objectKey };
  }

  /**
   * Everything the wizard needs before it renders: account readiness, the open
   * application, the exact Ketentuan Mitra document to accept, and the
   * categories. The client never derives the gate itself.
   */
  async eligibility(userId: string): Promise<VendorEligibilityView> {
    const [account, application, hasVendor, policy, categories] = await Promise.all([
      this.repository.findAccount(userId),
      this.repository.findLatestByUser(userId),
      this.repository.hasVendorAccount(userId),
      this.repository.currentVendorPolicy(),
      this.repository.listActiveCategories()
    ]);

    const blockers: EligibilityBlocker[] = [];
    if (!account || account.status !== 'active') {
      blockers.push({
        code: 'ACCOUNT_INACTIVE',
        message: 'Akun tidak aktif. Hubungi dukungan sebelum mendaftar sebagai vendor.'
      });
    }
    if ((account?.name ?? '').trim().length < 2) {
      blockers.push({
        code: 'NAME_MISSING',
        message: 'Lengkapi nama akun dulu di Profil.'
      });
    }
    if (!(account?.phone ?? '').trim()) {
      blockers.push({
        code: 'PHONE_MISSING',
        message: 'Nomor telepon akun belum terisi. Lengkapi di Profil.'
      });
    }
    if (!account?.emailVerifiedAt) {
      blockers.push({
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Verifikasi email akun dulu sebelum mendaftar sebagai vendor.'
      });
    }
    if (hasVendor) {
      blockers.push({
        code: 'VENDOR_ACCOUNT_EXISTS',
        message: 'Akun ini sudah terdaftar sebagai vendor.'
      });
    }
    if (application && (application.status === 'draft' || application.status === 'submitted')) {
      blockers.push({
        code: 'APPLICATION_OPEN',
        message: 'Pengajuan vendor kamu masih diproses.'
      });
    }
    if (!policy) {
      blockers.push({
        code: 'POLICY_UNAVAILABLE',
        message: 'Ketentuan Mitra belum tersedia. Coba lagi nanti.'
      });
    }

    return {
      can_submit: blockers.length === 0,
      blockers,
      account: {
        name: account?.name ?? null,
        phone: account?.phone ?? null,
        email: account?.email ?? null,
        email_verified: Boolean(account?.emailVerifiedAt)
      },
      application: application
        ? toApplicationView(await this.hydrateNik(application), { revealNik: false })
        : null,
      policy: policy
        ? {
            id: policy.id,
            code: policy.code,
            version: policy.version,
            body_hash: policy.bodyHash,
            effective_from: policy.effectiveFrom.toISOString(),
            body: policy.body
          }
        : null,
      categories
    };
  }

  async submit(
    userId: string,
    input: SubmitVendorApplicationInput,
    context: SubmitVendorApplicationContext = NO_CONTEXT
  ): Promise<VendorApplicationView> {
    // Gate order matters to the wizard: it shows the first failure the customer
    // can actually fix. Nothing is written until every check below passes.
    const account = await this.repository.findAccount(userId);
    if (
      !account ||
      account.status !== 'active' ||
      (account.name ?? '').trim().length < 2 ||
      !(account.phone ?? '').trim()
    ) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Profil belum lengkap. Isi nama dan nomor telepon sebelum mendaftar.',
        { reason: 'PROFILE_INCOMPLETE' }
      );
    }
    if (!account.emailVerifiedAt) {
      throw new AppError(
        'EMAIL_NOT_VERIFIED',
        'Verifikasi email akun dulu sebelum mendaftar sebagai vendor.'
      );
    }
    if (await this.repository.hasVendorAccount(userId)) {
      throw new AppError('CONFLICT', 'Akun ini sudah terdaftar sebagai vendor.', {
        reason: 'VENDOR_EXISTS'
      });
    }
    if (await this.repository.hasOpenApplication(userId)) {
      throw new AppError('CONFLICT', 'Pengajuan vendor untuk akun ini masih diproses.', {
        reason: 'APPLICATION_OPEN'
      });
    }

    const now = new Date();
    const window = await this.repository.countApplicationsSince(
      userId,
      new Date(now.getTime() - RESUBMIT_WINDOW_MS)
    );
    if (window.count >= RESUBMIT_LIMIT) {
      const retryAt = window.oldest ? window.oldest.getTime() + RESUBMIT_WINDOW_MS : 0;
      throw new AppError('RATE_LIMITED', 'Terlalu banyak pengajuan vendor dalam 24 jam.', {
        reason: 'RESUBMIT_LIMIT',
        retry_after_seconds: Math.max(1, Math.ceil((retryAt - now.getTime()) / 1000))
      });
    }

    if (!(await this.repository.regionExists(input.region_code))) {
      throw new AppError('VALIDATION_ERROR', 'Wilayah tidak dikenal', {
        reason: 'REGION_UNKNOWN'
      });
    }

    const category = await this.repository.categoryBySlug(input.category_slug);
    if (!category) {
      throw new AppError('VALIDATION_ERROR', 'Kategori tidak dikenal', {
        reason: 'CATEGORY_UNKNOWN'
      });
    }
    if (!category.isActive) {
      throw new AppError('VALIDATION_ERROR', 'Kategori tidak aktif', {
        reason: 'CATEGORY_INACTIVE'
      });
    }

    const policy = await this.repository.currentVendorPolicy();
    if (!policy || policy.id !== input.agreement_policy_version_id) {
      throw new AppError('CONFLICT', 'Ketentuan Mitra sudah berubah. Muat ulang lalu setujui lagi.', {
        reason: 'POLICY_VERSION_STALE',
        current_policy_version_id: policy?.id ?? null,
        current_policy_version: policy?.version ?? null
      });
    }

    if (!input.ktp_object_key.startsWith(ktpKeyPrefix(userId))) {
      throw new AppError('VALIDATION_ERROR', 'Foto KTP bukan milik akun ini.', {
        reason: 'KTP_INVALID'
      });
    }
    if (!(await this.storage.exists(input.ktp_object_key))) {
      throw new AppError('VALIDATION_ERROR', 'Foto KTP tidak ditemukan. Unggah ulang.', {
        reason: 'KTP_INVALID'
      });
    }

    const secret = this.storage.encryptNik(input.nik);
    const record = await this.repository.transaction(async (client) => {
      // Re-read the active policy under a shared lock: an admin could have
      // shipped a new Ketentuan Mitra between the pre-check and this insert.
      const locked = await this.repository.lockVendorPolicy(client);
      if (!locked || locked.id !== policy.id || locked.version !== policy.version) {
        throw new AppError(
          'CONFLICT',
          'Ketentuan Mitra sudah berubah. Muat ulang lalu setujui lagi.',
          {
            reason: 'POLICY_VERSION_STALE',
            current_policy_version_id: locked?.id ?? null,
            current_policy_version: locked?.version ?? null
          }
        );
      }
      // Consent first: if the insert fails, both rows roll back together.
      await this.repository.insertConsent(client, {
        userId,
        policyCode: policy.code,
        policyVersionId: policy.id,
        acceptedAt: now,
        ip: context.ip,
        userAgent: context.userAgent
      });
      const inserted = await this.repository.insertApplication(client, userId, input, secret, {
        categoryId: category.id,
        agreementPolicyVersionId: policy.id
      });
      await this.repository.insertSubmitAudit(client, {
        applicationId: inserted.id,
        userId,
        policyVersion: policy.version,
        categorySlug: category.slug
      });
      return inserted;
    });

    return toApplicationView(
      {
        ...record,
        nik: input.nik,
        categorySlug: category.slug,
        categoryName: category.name,
        agreementPolicyVersionId: policy.id,
        agreementVersion: policy.version
      },
      { revealNik: false }
    );
  }

  async myApplication(userId: string): Promise<VendorApplicationView | null> {
    const record = await this.repository.findLatestByUser(userId);
    if (!record) return null;
    return toApplicationView(await this.hydrateNik(record), { revealNik: false });
  }

  /**
   * Returns a record whose `nik` is readable. Rows written before migration 019
   * still contain plaintext: encrypt it, clear the column, keep serving the
   * value from memory so the admin queue never breaks mid-migration.
   */
  private async hydrateNik(
    record: VendorApplicationRecord
  ): Promise<VendorApplicationRecord> {
    if (record.nik.length > 0) {
      try {
        const secret = this.storage.encryptNik(record.nik);
        await this.repository.setNikCiphertext(record.id, secret.ciphertext, secret.keyId);
      } catch {
        // Leave the legacy row untouched; the next read retries.
      }
      return record;
    }
    if (!record.nikCiphertext) return record;
    try {
      return { ...record, nik: this.storage.decryptNik(record.nikCiphertext) };
    } catch {
      return record;
    }
  }

  async list(
    query: ListVendorApplicationsQuery,
    options: { revealNik: boolean }
  ): Promise<VendorApplicationList> {
    const result = await this.repository.listForAdmin({
      status: query.status,
      page: query.page,
      pageSize: query.page_size
    });
    const hydrated = await Promise.all(result.items.map((record) => this.hydrateNik(record)));
    return {
      items: hydrated.map((record) =>
        toApplicationView(record, { revealNik: options.revealNik })
      ),
      total: result.total,
      page: query.page,
      page_size: query.page_size
    };
  }

  async review(
    applicationId: string,
    input: ReviewVendorApplicationInput,
    actor: ReviewActor
  ): Promise<VendorApplicationView> {
    const application = await this.repository.findById(applicationId);
    if (!application) throw new AppError('NOT_FOUND', 'Pengajuan vendor tidak ditemukan');

    if (application.userId === actor.id) {
      throw new AppError('CONFLICT', 'Admin tidak boleh menyetujui pengajuan vendor miliknya sendiri');
    }

    if (input.decision === 'reject') {
      const rejected = await this.repository.transaction((client) =>
        this.repository.reject(client, {
          applicationId,
          actorId: actor.id,
          actorRole: actor.role,
          note: input.note ?? null,
          now: new Date()
        })
      );
      // Best effort: the DB row no longer references the KTP, so remove the
      // encrypted bytes as well. A failure here must not undo the decision.
      try {
        await this.storage.remove(application.ktpObjectKey);
      } catch {
        // Left for the operator; the key is already blanked in the database.
      }
      return toApplicationView(await this.hydrateNik(rejected), { revealNik: true });
    }

    // Short suffix guarantees a unique slug without a read-modify-write race.
    const stem = slugify(application.displayName).slice(0, 140);
    const slug = `${stem}-${application.id.slice(0, 8)}`;
    const approved = await this.repository.transaction((client) =>
      this.repository.approve(client, {
        application,
        actorId: actor.id,
        actorRole: actor.role,
        slug,
        now: new Date()
      })
    );
    return toApplicationView(await this.hydrateNik(approved), { revealNik: true });
  }

  async ktpFile(
    applicationId: string,
    actor: ReviewActor
  ): Promise<{ buffer: Buffer; mime: string; size: number }> {
    const application = await this.repository.findById(applicationId);
    if (!application || !application.ktpObjectKey) {
      throw new AppError('NOT_FOUND', 'Foto KTP tidak ditemukan');
    }
    // Fail closed: the access attempt is recorded before any bytes are read, so
    // a read failure (or a crash) still leaves an audit trail.
    await this.repository.recordKtpAccess({
      applicationId,
      actorId: actor.id,
      actorRole: actor.role
    });
    return this.storage.read(application.ktpObjectKey);
  }
}
