import { Module } from '@nestjs/common';
import { resolve } from 'node:path';
import { loadConfig } from '@tarlink/core/config';
import { getPool } from '@tarlink/core/db';
import { AuthGuard, JWT_SECRET, RolesGuard } from '@tarlink/platform/auth';
import {
  AppealEvidenceStorage,
  deriveAppealEvidenceKey
} from './appeal-evidence.storage';
import { AppealEvidenceService } from './appeal-evidence.service';
import { ModerationAdminController } from './moderation-admin.controller';
import { ModerationAppealController } from './moderation-appeal.controller';
import { ModerationAppealEvidenceController } from './moderation-appeal-evidence.controller';
import { ModerationController } from './moderation.controller';
import { ModerationRepository } from './moderation.repository';
import { ModerationService } from './moderation.service';

/**
 * Moderasi UGC: lapor konten (FR-123), takedown (FR-124), blokir (FR-142),
 * plus bukti banding berupa berkas privat (FR-124 lanjutan).
 *
 * Catatan untuk lead: `AppModule` dipunyai lead; impor `ModerationModule` di
 * sana. Modul ini tidak butuh konfigurasi tambahan — JWT secret dibaca dari
 * `loadConfig()` dan kedua guard didaftarkan di injector ini. Kunci enkripsi
 * bukti diturunkan dari `KTP_ENCRYPTION_KEY` (domain terpisah), jadi tidak ada
 * env var baru yang wajib diisi hanya untuk fitur ini.
 */
@Module({
  controllers: [
    ModerationController,
    ModerationAppealController,
    ModerationAppealEvidenceController,
    ModerationAdminController
  ],
  providers: [
    { provide: JWT_SECRET, useValue: loadConfig().JWT_SECRET },
    { provide: AuthGuard, useClass: AuthGuard },
    RolesGuard,
    {
      provide: ModerationRepository,
      useFactory: (): ModerationRepository => new ModerationRepository(getPool())
    },
    {
      provide: AppealEvidenceStorage,
      useFactory: (): AppealEvidenceStorage => {
        const cfg = loadConfig();
        const secret = process.env.KTP_ENCRYPTION_KEY?.trim() || cfg.JWT_SECRET;
        return new AppealEvidenceStorage(
          resolve(process.cwd(), cfg.PRIVATE_UPLOAD_DIR),
          deriveAppealEvidenceKey(secret, cfg.NODE_ENV)
        );
      }
    },
    {
      provide: ModerationService,
      inject: [ModerationRepository],
      useFactory: (repository: ModerationRepository): ModerationService =>
        new ModerationService(repository)
    },
    {
      provide: AppealEvidenceService,
      inject: [ModerationRepository, AppealEvidenceStorage],
      useFactory: (
        repository: ModerationRepository,
        storage: AppealEvidenceStorage
      ): AppealEvidenceService => new AppealEvidenceService(repository, storage)
    }
  ],
  exports: [ModerationService, AppealEvidenceService]
})
export class ModerationModule {}
