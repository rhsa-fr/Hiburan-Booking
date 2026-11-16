/**
 * Bukti banding berupa berkas (FR-124 lanjutan).
 *
 * Berkas tidak pernah dilayani dari `/v1/media` (publik). Rute di bawah adalah
 * satu-satunya jalan keluar-masuk byte: pemilik banding untuk membaca/mengunggah,
 * dan admin moderasi untuk membaca (setiap pembacaan diaudit).
 *
 * Batas 5 MB dan tipe gambar (JPG/PNG/WebP) divalidasi dari magic bytes, bukan
 * dari nama berkas atau content-type multipart.
 */
import {
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { AppError } from '@tarlink/core/errors';
import { AuthGuard, Roles, RolesGuard, type AuthenticatedRequest } from '@tarlink/platform/auth';
import { type UploadedImage } from '@tarlink/modules/vendor-portal';
import { MAX_APPEAL_EVIDENCE_BYTES } from './appeal-evidence.storage';
import { AppealEvidenceService, type AppealEvidenceActor } from './appeal-evidence.service';
import type { ContentReportAppealView } from './moderation.contracts';

const READ_ROLES = ['admin_support', 'admin_finance', 'admin_super'] as const;
const UUID = z.string().uuid();

function parseUuid(value: string, label: string): string {
  const parsed = UUID.safeParse(value);
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', `invalid ${label} id`);
  return parsed.data;
}

function requireActor(request: AuthenticatedRequest): AppealEvidenceActor {
  const user = request.user;
  if (!user?.id) throw new AppError('UNAUTHENTICATED', 'Authentication is required');
  const roles = user.roles ?? [];
  const role =
    roles.find((candidate) => candidate === 'admin_super') ??
    roles.find((candidate) => candidate.startsWith('admin_')) ??
    null;
  return {
    id: user.id,
    role,
    requestId: (request.headers['x-request-id'] as string | undefined) ?? null
  };
}

@Controller()
@UseGuards(AuthGuard, RolesGuard)
export class ModerationAppealEvidenceController {
  constructor(private readonly evidence: AppealEvidenceService) {}

  /** Pemilik banding melampirkan (atau mengganti) satu berkas bukti. */
  @Post('reports/:id/appeal/evidence')
  @HttpCode(201)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_APPEAL_EVIDENCE_BYTES, files: 1 } })
  )
  async attach(
    @Param('id') id: string,
    @UploadedFile() file: UploadedImage | undefined,
    @Req() request: AuthenticatedRequest
  ): Promise<{ data: ContentReportAppealView }> {
    const reportId = parseUuid(id, 'report');
    const appeal = await this.evidence.attach(reportId, requireActor(request), file);
    return { data: appeal };
  }

  /** Pemilik banding membaca berkasnya sendiri. */
  @Get('reports/:id/appeal/evidence')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'; sandbox")
  async readOwn(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest
  ): Promise<StreamableFile> {
    const reportId = parseUuid(id, 'report');
    const file = await this.evidence.readOwn(reportId, requireActor(request));
    return new StreamableFile(file.buffer, {
      type: file.mime,
      disposition: 'inline',
      length: file.size
    });
  }

  /** Admin membaca bukti; setiap pembacaan masuk `audit_logs`. */
  @Get('admin/report-appeals/:id/evidence')
  @Roles(...READ_ROLES)
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'; sandbox")
  async readAsAdmin(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest
  ): Promise<StreamableFile> {
    const appealId = parseUuid(id, 'appeal');
    const file = await this.evidence.readAsAdmin(appealId, requireActor(request));
    return new StreamableFile(file.buffer, {
      type: file.mime,
      disposition: 'inline',
      length: file.size
    });
  }
}
