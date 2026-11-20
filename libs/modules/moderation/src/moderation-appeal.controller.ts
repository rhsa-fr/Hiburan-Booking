/**
 * Antrean banding takedown (FR-124) untuk panel admin.
 *
 * Prefix sengaja `admin/report-appeals`, bukan `admin/reports/appeals`, agar
 * tidak bertabrakan dengan `GET admin/reports/:id` yang memperlakukan segmen
 * setelah `reports/` sebagai UUID.
 *
 * Peran: membaca untuk support/finance/super; memutuskan hanya support/super.
 * Finance hanya boleh melihat karena keputusan moderasi bukan aksi finansial.
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
  ADMIN_APPEAL_QUEUE_QUERY,
  RESOLVE_APPEAL_BODY,
  type AdminAppealFilters,
  type ContentReportAppealPage,
  type ContentReportAppealView
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

function actorRole(request: AuthenticatedRequest): string {
  const roles = request.user?.roles ?? [];
  if (roles.includes('admin_super')) return 'admin_super';
  return 'admin_support';
}

function parseUuid(value: string): string {
  const parsed = UUID.safeParse(value);
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'invalid appeal id');
  return parsed.data;
}

@Controller('admin/report-appeals')
@UseGuards(AuthGuard, RolesGuard)
@Roles(...READ_ROLES)
export class ModerationAppealController {
  constructor(private readonly moderation: ModerationService) {}

  @Get()
  async queue(@Query() query: unknown): Promise<ContentReportAppealPage> {
    const parsed = ADMIN_APPEAL_QUEUE_QUERY.safeParse(query ?? {});
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Filter banding tidak valid', parsed.error.issues);
    }
    const filters: AdminAppealFilters = {
      status: parsed.data.status ?? '',
      page: parsed.data.page ?? 1,
      page_size: parsed.data.page_size ?? 20
    };
    return this.moderation.listAppeals(filters);
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<ContentReportAppealView> {
    return this.moderation.getAppeal(parseUuid(id));
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @Roles(...DECIDE_ROLES)
  async resolve(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest
  ): Promise<ContentReportAppealView> {
    const parsed = RESOLVE_APPEAL_BODY.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Keputusan banding tidak valid', parsed.error.issues);
    }
    return this.moderation.resolveAppeal(
      requireActor(request),
      actorRole(request),
      parseUuid(id),
      parsed.data,
      (request.headers['x-request-id'] as string | undefined) ?? null
    );
  }
}
