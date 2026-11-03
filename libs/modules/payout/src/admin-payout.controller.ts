import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '@tarlink/core/errors';
import { AuthGuard, Roles, RolesGuard, type AuthenticatedRequest } from '@tarlink/platform/auth';
import { BankAccountsService, type BankAccountView } from './bank-accounts.service';
import {
  APPROVE_PAYOUT_BODY,
  CREATE_PAYOUT_BODY,
  PAYOUT_QUERY,
  REJECT_BANK_ACCOUNT_BODY,
  REJECT_PAYOUT_BODY,
  parseBody,
  type CreatePayoutInput
} from './payout.dto';
import {
  PayoutService,
  type EligiblePayoutView,
  type PayoutActor,
  type PayoutDetailView,
  type PayoutView
} from './payout.service';
import type { PayoutStatus } from './payout.repository';

const READ_ROLES = ['admin_support', 'admin_finance', 'admin_super'] as const;
const WRITE_ROLES = ['admin_finance', 'admin_super'] as const;
const UUID = z.string().uuid();

function actor(request: AuthenticatedRequest): PayoutActor {
  const id = request.user?.id;
  if (!id) throw new AppError('UNAUTHENTICATED', 'Authentication is required');
  return { id, roles: request.user?.roles ?? [] };
}

function uuidParam(value: string, field: string): string {
  const parsed = UUID.safeParse(value);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', `${field} tidak valid`);
  }
  return parsed.data;
}

function requireIdempotencyKey(value: string | undefined): string {
  if (!value) {
    throw new AppError('VALIDATION_ERROR', 'Idempotency-Key header is required');
  }
  return value;
}

/**
 * Admin payout operations. Responses are raw panel objects (no `{ data }`),
 * matching the rest of `/admin/*`.
 */
@Controller('admin')
@UseGuards(AuthGuard, RolesGuard)
@Roles(...READ_ROLES)
export class AdminPayoutController {
  constructor(
    private readonly payouts: PayoutService,
    private readonly bankAccounts: BankAccountsService
  ) {}

  @Get('payouts')
  async list(@Query() query: Record<string, unknown>): Promise<{
    items: PayoutView[];
    total: number;
    page: number;
    page_size: number;
  }> {
    const parsed = PAYOUT_QUERY.safeParse(query);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Filter payout tidak valid', parsed.error.issues);
    }
    return this.payouts.list({
      status: (parsed.data.status as PayoutStatus | undefined) ?? null,
      vendor_id: parsed.data.vendor_id ?? null,
      page: parsed.data.page ?? 1,
      page_size: parsed.data.page_size ?? 20
    });
  }

  // Declared before `payouts/:id` so Express does not read "eligible" as an id.
  @Get('payouts/eligible')
  async eligible(@Query('vendor_id') vendorId: string): Promise<EligiblePayoutView> {
    return this.payouts.eligible(uuidParam(vendorId, 'vendor_id'));
  }

  @Get('payouts/:id')
  async detail(@Param('id') id: string): Promise<PayoutDetailView> {
    return this.payouts.detail(uuidParam(id, 'id'));
  }

  @Post('payouts')
  @HttpCode(201)
  @Roles(...WRITE_ROLES)
  async create(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest
  ): Promise<PayoutDetailView> {
    const input = parseBody<CreatePayoutInput>(
      CREATE_PAYOUT_BODY,
      body,
      'Permintaan payout tidak valid'
    );
    return this.payouts.create(
      actor(request),
      { vendor_id: input.vendor_id, booking_ids: input.booking_ids },
      idempotencyKey
    );
  }

  @Post('payouts/:id/approve')
  @HttpCode(200)
  @Roles(...WRITE_ROLES)
  async approve(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest
  ): Promise<PayoutDetailView> {
    parseBody(
      APPROVE_PAYOUT_BODY,
      body ?? {},
      'Permintaan persetujuan payout tidak valid'
    );
    requireIdempotencyKey(idempotencyKey);
    return this.payouts.approve(actor(request), uuidParam(id, 'id'), idempotencyKey);
  }

  @Post('payouts/:id/reject')
  @HttpCode(200)
  @Roles(...WRITE_ROLES)
  async reject(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest
  ): Promise<PayoutDetailView> {
    const input = parseBody(
      REJECT_PAYOUT_BODY,
      body,
      'Alasan penolakan wajib diisi (minimal 5 karakter)'
    );
    return this.payouts.reject(actor(request), uuidParam(id, 'id'), input.reason);
  }

  @Post('payouts/:id/cancel')
  @HttpCode(200)
  @Roles(...WRITE_ROLES)
  async cancel(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest
  ): Promise<PayoutDetailView> {
    return this.payouts.cancel(actor(request), uuidParam(id, 'id'));
  }

  @Get('vendors/:vendorId/bank-accounts')
  async listVendorBankAccounts(
    @Param('vendorId') vendorId: string
  ): Promise<BankAccountView[]> {
    return this.bankAccounts.adminList(uuidParam(vendorId, 'vendorId'));
  }

  @Post('vendors/:vendorId/bank-accounts/:id/verify')
  @HttpCode(200)
  @Roles('admin_super')
  async verifyBankAccount(
    @Param('vendorId') vendorId: string,
    @Param('id') id: string,
    @Headers('x-request-id') requestId: string | undefined,
    @Req() request: AuthenticatedRequest
  ): Promise<BankAccountView> {
    const me = actor(request);
    return this.bankAccounts.verify(
      me.id,
      rolesForAudit(me.roles),
      uuidParam(vendorId, 'vendorId'),
      uuidParam(id, 'id'),
      requestId ?? null
    );
  }

  @Post('vendors/:vendorId/bank-accounts/:id/reject')
  @HttpCode(200)
  @Roles('admin_super')
  async rejectBankAccount(
    @Param('vendorId') vendorId: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('x-request-id') requestId: string | undefined,
    @Req() request: AuthenticatedRequest
  ): Promise<BankAccountView> {
    const input = parseBody(
      REJECT_BANK_ACCOUNT_BODY,
      body,
      'Alasan penolakan wajib diisi (minimal 5 karakter)'
    );
    const me = actor(request);
    return this.bankAccounts.reject(
      me.id,
      rolesForAudit(me.roles),
      uuidParam(vendorId, 'vendorId'),
      uuidParam(id, 'id'),
      input.reason,
      requestId ?? null
    );
  }
}

/** `audit_logs.actor_role` accepts the admin roles; finance wins when both held. */
function rolesForAudit(roles: readonly string[]): 'admin_finance' | 'admin_super' {
  return roles.includes('admin_finance') ? 'admin_finance' : 'admin_super';
}
