/**
 * Endpoint pengguna: lapor konten (FR-123) dan blokir pengguna (FR-142).
 *
 * Semua rute butuh bearer token; identitas hanya dari `request.user`.
 * Payload memakai envelope `{ data: … }` sesuai konvensi API.
 */
import {
  Body,
  Controller,
  Delete,
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
import { AuthGuard, RolesGuard, type AuthenticatedRequest } from '@tarlink/platform/auth';
import {
  BLOCK_USER_BODY,
  CREATE_APPEAL_BODY,
  CREATE_REPORT_BODY,
  LIST_OWN_REPORTS_QUERY,
  OWNED_TAKEDOWN_QUERY,
  type BlockedUserView,
  type ContentReportAppealView,
  type ContentReportPage,
  type ContentReportView,
  type OwnedTakedownPage
} from './moderation.contracts';
import type { ModerationActor } from './moderation.service';
import { ModerationService } from './moderation.service';

const UUID = z.string().uuid();

function requireActor(request: AuthenticatedRequest): ModerationActor {
  const user = request.user;
  if (!user?.id) throw new AppError('UNAUTHENTICATED', 'Authentication is required');
  return { id: user.id, roles: user.roles ?? [] };
}

function requireUuid(value: string, label: string): string {
  const parsed = UUID.safeParse(value);
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', `invalid ${label}`);
  return parsed.data;
}

@Controller()
@UseGuards(AuthGuard, RolesGuard)
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

  @Post('reports')
  @HttpCode(201)
  async createReport(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest
  ): Promise<{ data: ContentReportView }> {
    const parsed = CREATE_REPORT_BODY.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Laporan tidak valid', parsed.error.issues);
    }
    return { data: await this.moderation.createReport(requireActor(request), parsed.data) };
  }

  @Get('reports')
  async listReports(
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest
  ): Promise<{ data: ContentReportPage }> {
    const parsed = LIST_OWN_REPORTS_QUERY.safeParse(query ?? {});
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Parameter laporan tidak valid', parsed.error.issues);
    }
    return {
      data: await this.moderation.listOwnReports(
        requireActor(request),
        parsed.data.page,
        parsed.data.page_size
      )
    };
  }

  // Declared before `reports/:id` so "against-me" is not read as a UUID.
  @Get('reports/against-me')
  async againstMe(
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest
  ): Promise<{ data: OwnedTakedownPage }> {
    const parsed = OWNED_TAKEDOWN_QUERY.safeParse(query ?? {});
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Parameter banding tidak valid', parsed.error.issues);
    }
    return {
      data: await this.moderation.listTakedownsAgainstMe(
        requireActor(request),
        parsed.data.page,
        parsed.data.page_size
      )
    };
  }

  @Get('reports/:id')
  async getReport(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest
  ): Promise<{ data: ContentReportView }> {
    return {
      data: await this.moderation.getOwnReport(
        requireActor(request),
        requireUuid(id, 'report id')
      )
    };
  }

  /** FR-124: pemilik konten mengajukan banding atas takedown. */
  @Post('reports/:id/appeal')
  @HttpCode(201)
  async createAppeal(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest
  ): Promise<{ data: ContentReportAppealView }> {
    const parsed = CREATE_APPEAL_BODY.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Banding tidak valid', parsed.error.issues);
    }
    return {
      data: await this.moderation.createAppeal(
        requireActor(request),
        requireUuid(id, 'report id'),
        parsed.data
      )
    };
  }

  @Get('reports/:id/appeal')
  async getAppeal(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest
  ): Promise<{ data: ContentReportAppealView }> {
    return {
      data: await this.moderation.getOwnAppeal(
        requireActor(request),
        requireUuid(id, 'report id')
      )
    };
  }

  @Post('blocks')
  @HttpCode(201)
  async block(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest
  ): Promise<{ data: BlockedUserView }> {
    const parsed = BLOCK_USER_BODY.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Permintaan blokir tidak valid', parsed.error.issues);
    }
    return { data: await this.moderation.block(requireActor(request), parsed.data) };
  }

  @Delete('blocks/:userId')
  @HttpCode(204)
  async unblock(
    @Param('userId') userId: string,
    @Req() request: AuthenticatedRequest
  ): Promise<void> {
    await this.moderation.unblock(requireActor(request), requireUuid(userId, 'user id'));
  }

  @Get('blocks')
  async listBlocks(
    @Req() request: AuthenticatedRequest
  ): Promise<{ data: BlockedUserView[] }> {
    return { data: await this.moderation.listBlocks(requireActor(request)) };
  }
}
