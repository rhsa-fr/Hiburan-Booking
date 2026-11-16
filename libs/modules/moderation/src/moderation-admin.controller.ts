/**
 * Antrean moderasi untuk panel admin (FR-123 tinjauan + FR-124 takedown).
 *
 * Sama seperti `AdminController`, respons di sini adalah objek panel apa adanya
 * (tanpa envelope `{ data: … }`) karena panel melakukan cast langsung.
 *
 * Peran:
 * - membaca antrean: support, finance, super (semua boleh melihat);
 * - memutuskan: support dan super. Finance tidak, karena keputusan moderasi
 *   bukan aksi finansial dan tidak boleh tercampur dengan alur refund.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards
} from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '@tarlink/core/errors';
import { AuthGuard, Roles, RolesGuard, type AuthenticatedRequest } from '@tarlink/platform/auth';
import {
  ADMIN_REPORT_QUEUE_QUERY,
  RESOLVE_REPORT_BODY,
  type AdminReportFilters,
  type ContentReportPage,
  type ContentReportView
} from './moderation.contracts';
import type { ModerationActor } from './moderation.service';
import { ModerationService } from './moderation.service';

const READ_ROLES = ['admin_support', 'admin_finance', 'admin_super'] as const;
const DECIDE_ROLES = ['admin_support', 'admin_super'] as const;

const UUID = z.string().uuid();

function requireActor(request: AuthenticatedRequest): ModerationActor {
  const user = request.user;
  if (!user?.id) throw new AppError('UNAUTHENTICATED', 'Authentication is required');
  return { id: user.id, roles: user.roles ?? [] };
}

/** `audit_logs.actor_role`: super menang bila pengguna memegang keduanya. */
function actorRole(request: AuthenticatedRequest): string {
  const roles = request.user?.roles ?? [];
  if (roles.includes('admin_super')) return 'admin_super';
  return 'admin_support';
}

@Controller('admin/reports')
@UseGuards(AuthGuard, RolesGuard)
@Roles(...READ_ROLES)
export class ModerationAdminController {
  constructor(private readonly moderation: ModerationService) {}

  @Get()
  async queue(@Query() query: unknown): Promise<ContentReportPage> {
    const parsed = ADMIN_REPORT_QUEUE_QUERY.safeParse(query ?? {});
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Filter laporan tidak valid', parsed.error.issues);
    }
    const data = parsed.data;
    const filters: AdminReportFilters = {
      status: data.status ?? '',
      reason: data.reason ?? '',
      target_type: data.target_type ?? '',
      overdue: data.overdue === 'true',
      page: data.page ?? 1,
      page_size: data.page_size ?? 20
    };
    return this.moderation.listQueue(filters);
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<ContentReportView> {
    return this.moderation.getReport(parseUuid(id));
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @Roles(...DECIDE_ROLES)
  async resolve(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest
  ): Promise<ContentReportView> {
    const parsed = RESOLVE_REPORT_BODY.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Keputusan laporan tidak valid', parsed.error.issues);
    }
    return this.moderation.resolve(
      requireActor(request),
      actorRole(request),
      parseUuid(id),
      parsed.data,
      (request.headers['x-request-id'] as string | undefined) ?? null
    );
  }
}

function parseUuid(value: string): string {
  const parsed = UUID.safeParse(value);
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'invalid report id');
  return parsed.data;
}
