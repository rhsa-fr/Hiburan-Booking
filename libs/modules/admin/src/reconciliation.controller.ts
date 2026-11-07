/**
 * HTTP surface for FR-131 phase 1 (`/v1/admin/reconciliation/*`).
 *
 * Like the rest of the admin surface these routes return the raw panel object
 * (no `{ data: … }` envelope). Guards: `AuthGuard` then `RolesGuard`; money
 * operations are limited to `admin_finance`/`admin_super`.
 *
 * `Idempotency-Key` is accepted but optional in phase 1: the operation is
 * already idempotent by `UNIQUE (provider, scope, report_date)`, so a retry
 * returns the same run. The header is reserved for phase 2 (diff resolve).
 */
import {
  Body,
  Controller,
  Get,
  Headers,
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
  ReconciliationService,
  type ReconciliationRunDetail,
  type ReconciliationRunList,
  type ReconciliationRunSummary
} from './reconciliation.service';

const RUN_BODY = z
  .object({
    provider: z.enum(['midtrans', 'pjp']),
    report_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  })
  .strict();

const LIST_QUERY = z
  .object({
    page: z.coerce.number().int().min(1).optional(),
    page_size: z.coerce.number().int().min(1).max(100).optional()
  })
  .passthrough();

/** `audit_logs.actor_role` for money routes: finance wins when both are held. */
function financeActor(request: AuthenticatedRequest): {
  id: string;
  role: 'admin_finance' | 'admin_super';
} {
  const id = request.user?.id;
  if (!id) {
    throw new AppError('UNAUTHENTICATED', 'Authentication is required');
  }
  const roles = request.user?.roles ?? [];
  return { id, role: roles.includes('admin_finance') ? 'admin_finance' : 'admin_super' };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('admin/reconciliation')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin_finance', 'admin_super')
export class ReconciliationController {
  constructor(private readonly reconciliation: ReconciliationService) {}

  @Post('runs')
  @HttpCode(200)
  async createRun(
    @Body() body: unknown,
    // Accepted, not required in phase 1 (see the file header).
    @Headers('idempotency-key') _idempotencyKey: string | undefined,
    @Headers('x-request-id') requestId: string | undefined,
    @Req() request: AuthenticatedRequest
  ): Promise<ReconciliationRunSummary> {
    const parsed = RUN_BODY.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Permintaan rekonsiliasi tidak valid', parsed.error.issues);
    }
    const actor = financeActor(request);
    return this.reconciliation.run({
      provider: parsed.data.provider,
      reportDate: parsed.data.report_date,
      actorId: actor.id,
      actorRole: actor.role,
      requestId: requestId ?? null
    });
  }

  @Get('runs')
  async listRuns(@Query() query: Record<string, unknown>): Promise<ReconciliationRunList> {
    const parsed = LIST_QUERY.safeParse(query);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Filter rekonsiliasi tidak valid', parsed.error.issues);
    }
    return this.reconciliation.list({
      page: parsed.data.page,
      page_size: parsed.data.page_size
    });
  }

  @Get('runs/:id')
  async getRun(@Param('id') id: string): Promise<ReconciliationRunDetail> {
    if (!UUID_PATTERN.test(id)) {
      throw new AppError('VALIDATION_ERROR', 'ID run rekonsiliasi tidak valid');
    }
    return this.reconciliation.detail(id);
  }
}
