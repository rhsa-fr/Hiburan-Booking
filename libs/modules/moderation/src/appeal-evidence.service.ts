/**
 * Bukti banding berupa berkas (FR-124 lanjutan).
 *
 * Aturan yang dijaga di sini, bukan di controller:
 * - hanya pemilik banding yang boleh melampirkan dan membaca berkasnya;
 * - berkas hanya bisa diubah selama banding masih `pending` (keputusan final);
 * - pengganti berkas tidak meninggalkan file yatim: berkas lama dihapus setelah
 *   pembaruan baris berhasil, berkas baru dihapus bila pembaruan gagal;
 * - pembacaan oleh admin diaudit sebelum byte dikirim, karena isinya bisa berupa
 *   dokumen identitas.
 */
import { AppError } from '@tarlink/core/errors';
import { type UploadedImage } from '@tarlink/modules/vendor-portal';
import type { ContentReportAppealView } from './moderation.contracts';
import {
  type AppealEvidenceFile,
  type AppealEvidenceStorage
} from './appeal-evidence.storage';
import { type ModerationRepository, toAppealView } from './moderation.repository';

export interface AppealEvidenceActor {
  readonly id: string;
  readonly role: string | null;
  readonly requestId: string | null;
}

export class AppealEvidenceService {
  constructor(
    private readonly repository: ModerationRepository,
    private readonly storage: AppealEvidenceStorage
  ) {}

  async attach(
    reportId: string,
    actor: AppealEvidenceActor,
    file: UploadedImage | undefined
  ): Promise<ContentReportAppealView> {
    const appeal = await this.repository.findAppealByReport(reportId);
    // A stranger must not learn whether an appeal exists for this report.
    if (!appeal || appeal.appellant_id !== actor.id) {
      throw new AppError('NOT_FOUND', 'Bukti banding tidak ditemukan');
    }
    if (appeal.status !== 'pending') {
      throw new AppError('CONFLICT', 'Banding sudah diputuskan dan tidak bisa diubah.');
    }

    const saved = await this.storage.save(reportId, file);
    try {
      const updated = await this.repository.attachAppealEvidenceFile({
        appealId: appeal.id,
        objectKey: saved.objectKey,
        previousObjectKey: appeal.evidence_file_path,
        actorId: actor.id,
        actorRole: actor.role,
        requestId: actor.requestId
      });
      // Replace semantics: the old ciphertext must not linger on disk.
      await this.storage.remove(appeal.evidence_file_path);
      return toAppealView(updated);
    } catch (err) {
      await this.storage.remove(saved.objectKey);
      throw err;
    }
  }

  async readOwn(reportId: string, actor: AppealEvidenceActor): Promise<AppealEvidenceFile> {
    const appeal = await this.repository.findAppealByReport(reportId);
    if (!appeal || appeal.appellant_id !== actor.id) {
      throw new AppError('NOT_FOUND', 'Bukti banding tidak ditemukan');
    }
    if (!appeal.evidence_file_path) {
      throw new AppError('NOT_FOUND', 'Bukti banding tidak ditemukan');
    }
    return this.storage.read(appeal.evidence_file_path);
  }

  async readAsAdmin(
    appealId: string,
    actor: AppealEvidenceActor
  ): Promise<AppealEvidenceFile> {
    const appeal = await this.repository.findAppealById(appealId);
    if (!appeal || !appeal.evidence_file_path) {
      throw new AppError('NOT_FOUND', 'Bukti banding tidak ditemukan');
    }
    await this.repository.auditAppealEvidenceViewed({
      appealId: appeal.id,
      actorId: actor.id,
      actorRole: actor.role,
      requestId: actor.requestId
    });
    return this.storage.read(appeal.evidence_file_path);
  }
}
