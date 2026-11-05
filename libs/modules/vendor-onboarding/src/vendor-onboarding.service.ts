import { Injectable } from '@nestjs/common';
import { AppError } from '@tarlink/core/errors';
import { slugify } from '@tarlink/modules/catalog';
import type { UploadedImage } from '@tarlink/modules/vendor-portal';
import {
  type ListVendorApplicationsQuery,
  type VendorApplicationRecord,
  type ReviewVendorApplicationInput,
  type SubmitVendorApplicationInput,
  type VendorApplicationList,
  type VendorApplicationView
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

@Injectable()
export class VendorOnboardingService {
  constructor(
    private readonly repository: VendorOnboardingRepository,
    private readonly storage: KtpStorageService
  ) {}

  regions(): Promise<Array<{ code: string; name: string; level: string }>> {
    return this.repository.listRegions();
  }

  /** Stores the KTP privately and returns the opaque key used at submit time. */
  async uploadKtp(
    userId: string,
    file: UploadedImage | undefined
  ): Promise<{ ktp_object_key: string }> {
    const saved = await this.storage.save(userId, file);
    return { ktp_object_key: saved.objectKey };
  }

  async submit(
    userId: string,
    input: SubmitVendorApplicationInput
  ): Promise<VendorApplicationView> {
    if (await this.repository.hasVendorAccount(userId)) {
      throw new AppError('CONFLICT', 'Akun ini sudah terdaftar sebagai vendor.');
    }
    if (!(await this.repository.regionExists(input.region_code))) {
      throw new AppError('VALIDATION_ERROR', 'Wilayah tidak dikenal', {
        region_code: input.region_code
      });
    }
    if (!input.ktp_object_key.startsWith(ktpKeyPrefix(userId))) {
      throw new AppError('VALIDATION_ERROR', 'Foto KTP bukan milik akun ini.');
    }
    if (!(await this.storage.exists(input.ktp_object_key))) {
      throw new AppError('VALIDATION_ERROR', 'Foto KTP tidak ditemukan. Unggah ulang.');
    }

    const secret = this.storage.encryptNik(input.nik);
    const record = await this.repository.insertApplication(userId, input, secret);
    return toApplicationView({ ...record, nik: input.nik }, { revealNik: false });
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
    const file = await this.storage.read(application.ktpObjectKey);
    await this.repository.recordKtpAccess({
      applicationId,
      actorId: actor.id,
      actorRole: actor.role
    });
    return file;
  }
}
