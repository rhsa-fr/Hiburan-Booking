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
import { AppError } from '@tarlink/core/errors';
import { AuthGuard, Roles, RolesGuard, type AuthenticatedRequest } from '@tarlink/platform/auth';
import { BankAccountsService, type BankAccountView } from './bank-accounts.service';
import {
  CREATE_BANK_ACCOUNT_BODY,
  parseBody,
  type CreateBankAccountInput
} from './payout.dto';
import { PayoutService, type PayoutView } from './payout.service';

function actorId(request: AuthenticatedRequest): string {
  const id = request.user?.id;
  if (!id) throw new AppError('UNAUTHENTICATED', 'Authentication is required');
  return id;
}

function pageOf(query: Record<string, unknown>): { page: number; pageSize: number } {
  const page = Math.max(1, Number.parseInt(String(query.page ?? '1'), 10) || 1);
  const rawSize = Number.parseInt(String(query.page_size ?? '20'), 10) || 20;
  return { page, pageSize: Math.min(100, Math.max(1, rawSize)) };
}

/**
 * Vendor side of payouts: manage the destination account and read history.
 * Money movement is admin-initiated, so there is no "request payout" button.
 */
@Controller('vendor')
@UseGuards(AuthGuard, RolesGuard)
@Roles('vendor_owner')
export class VendorPayoutController {
  constructor(
    private readonly bankAccounts: BankAccountsService,
    private readonly payouts: PayoutService
  ) {}

  @Get('bank-accounts')
  async listBankAccounts(
    @Req() request: AuthenticatedRequest
  ): Promise<{ data: BankAccountView[] }> {
    return { data: await this.bankAccounts.list(actorId(request)) };
  }

  @Post('bank-accounts')
  @HttpCode(201)
  async createBankAccount(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest
  ): Promise<{ data: BankAccountView }> {
    const input = parseBody<CreateBankAccountInput>(
      CREATE_BANK_ACCOUNT_BODY,
      body,
      'Data rekening tidak valid'
    );
    return { data: await this.bankAccounts.create(actorId(request), input) };
  }

  @Delete('bank-accounts/:id')
  @HttpCode(200)
  async cancelBankAccount(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest
  ): Promise<{ data: { ok: true } }> {
    await this.bankAccounts.cancel(actorId(request), id);
    return { data: { ok: true } };
  }

  @Get('payouts')
  async listPayouts(
    @Query() query: Record<string, unknown>,
    @Req() request: AuthenticatedRequest
  ): Promise<{
    items: PayoutView[];
    total: number;
    page: number;
    page_size: number;
  }> {
    const { page, pageSize } = pageOf(query);
    return this.payouts.listForVendor(actorId(request), page, pageSize);
  }
}
