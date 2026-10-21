/**
 * HTTP surface for the admin panel.
 *
 * Mounted under the global `v1` prefix: `/v1/admin/*`. Responses are the raw
 * panel objects (the panel casts `response.json()` straight onto its types);
 * there is no `{ data: … }` envelope on these routes.
 *
 * Guards: `AuthGuard` (signed bearer token) then `RolesGuard` (`@Roles`).
 * Identity comes only from `request.user`; no header is trusted for it.
 */
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards
} from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '@tarlink/core/errors';
import { AuthGuard, Roles, RolesGuard, type AuthenticatedRequest } from '@tarlink/platform/auth';
import { AdminService } from './admin.service';
import type {
  AuditLog,
  BookingDetail,
  BookingFilters,
  DashboardSummary,
  DisputeOverview,
  LedgerData,
  Operator,
  Paginated,
  PaymentsOverview,
  PlatformSettings,
  ReleaseInput,
  ReleasePreview,
  ReleaseQueue,
  ReleaseResult,
  SettleBookingResponse,
  Booking,
  Vendor,
  VendorDetail
} from './contracts';
import { idrToJson } from './money';

const READ_ROLES = ['admin_support', 'admin_finance', 'admin_super'] as const;
const RELEASE_ROLES = ['admin_finance', 'admin_super'] as const;
const SETTLE_ROLES = ['admin_finance', 'admin_super'] as const;

const BOOKING_QUERY = z
  .object({
    status: z.string().optional(),
    range: z.enum(['today', '7d', '30d', 'all', 'month']).optional(),
    city: z.string().optional(),
    q: z.string().optional(),
    sort: z.enum(['created_desc', 'created_asc', 'event_asc', 'event_desc']).optional(),
    page: z.coerce.number().int().min(1).optional(),
    page_size: z.coerce.number().int().min(1).max(100).optional()
  })
  .passthrough();

const VENDOR_QUERY = z
  .object({
    q: z.string().optional(),
    city: z.string().optional(),
    verification: z.string().optional()
  })
  .passthrough();

const RELEASE_BODY = z
  .object({
    booking_ids: z.array(z.string()).optional(),
    reason: z.string().optional(),
    maker: z.string().optional(),
    checker: z.string().optional()
  })
  .passthrough();

function requireActor(request: AuthenticatedRequest): string {
  const actorId = request.user?.id;
  if (!actorId) {
    throw new AppError('UNAUTHENTICATED', 'Authentication is required');
  }
  return actorId;
}

/** `audit_logs.actor_role` for money routes: finance wins when both are held. */
function settleActor(request: AuthenticatedRequest): {
  id: string;
  role: 'admin_finance' | 'admin_super';
} {
  const id = requireActor(request);
  const roles = request.user?.roles ?? [];
  return { id, role: roles.includes('admin_finance') ? 'admin_finance' : 'admin_super' };
}

function requireIdempotencyKey(value: string | undefined): string {
  if (!value) {
    // §7.5: money routes require an Idempotency-Key so a retry cannot double-post.
    throw new AppError('VALIDATION_ERROR', 'Idempotency-Key header is required');
  }
  return value;
}

@Controller('admin')
@UseGuards(AuthGuard, RolesGuard)
@Roles(...READ_ROLES)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('dashboard')
  async dashboard(): Promise<DashboardSummary> {
    return this.admin.dashboard();
  }

  @Get('bookings')
  async bookings(@Query() query: Record<string, unknown>): Promise<Paginated<Booking>> {
    const parsed = BOOKING_QUERY.safeParse(query);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Filter booking tidak valid', parsed.error.issues);
    }
    const data = parsed.data;
    const filters: BookingFilters = {
      status: data.status ?? '',
      range: data.range ?? 'all',
      city: data.city ?? '',
      q: data.q ?? '',
      sort: data.sort ?? 'created_desc',
      page: data.page ?? 1,
      page_size: data.page_size ?? 8
    };
    return this.admin.bookings(filters);
  }

  @Get('bookings/:id')
  async booking(@Param('id') id: string): Promise<BookingDetail> {
    return this.admin.booking(id);
  }

  @Post('bookings/:id/settle')
  @HttpCode(200)
  @Roles(...SETTLE_ROLES)
  async settleBooking(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('x-request-id') requestId: string | undefined,
    @Req() request: AuthenticatedRequest
  ): Promise<SettleBookingResponse> {
    const result = await this.admin.settleBookingManual(
      id,
      body,
      settleActor(request),
      requestId ?? null
    );
    return {
      booking_id: result.booking_id,
      payment_id: result.payment_id,
      journal_entry_id: result.journal_entry_id,
      payment_status: result.payment_status,
      outstanding_before_idr: idrToJson(
        result.outstanding_before_idr,
        'outstanding_before_idr'
      ),
      already_settled: result.already_settled
    };
  }

  @Get('vendors')
  async vendors(@Query() query: Record<string, unknown>): Promise<Paginated<Vendor>> {
    const parsed = VENDOR_QUERY.safeParse(query);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Filter vendor tidak valid', parsed.error.issues);
    }
    return this.admin.vendors({
      q: parsed.data.q ?? '',
      city: parsed.data.city ?? '',
      verification: parsed.data.verification ?? ''
    });
  }

  @Get('vendors/:id')
  async vendor(@Param('id') id: string): Promise<VendorDetail> {
    return this.admin.vendor(id);
  }

  @Get('release/queue')
  async releaseQueue(): Promise<ReleaseQueue> {
    return this.admin.releaseQueue();
  }

  @Post('release/preview')
  @HttpCode(200)
  @Roles(...RELEASE_ROLES)
  async previewRelease(@Body() body: unknown): Promise<ReleasePreview> {
    return this.admin.previewRelease(parseReleaseInput(body));
  }

  @Post('release')
  @HttpCode(200)
  @Roles(...RELEASE_ROLES)
  async release(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-request-id') requestId: string | undefined,
    @Req() request: AuthenticatedRequest
  ): Promise<ReleaseResult> {
    const input = parseReleaseInput(body);
    return this.admin.release(input, {
      actorId: requireActor(request),
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
      requestId: requestId ?? null
    });
  }

  @Get('ledger')
  async ledger(): Promise<LedgerData> {
    return this.admin.ledger();
  }

  @Get('payments')
  async payments(): Promise<PaymentsOverview> {
    return this.admin.payments();
  }

  @Get('disputes')
  async disputes(): Promise<DisputeOverview> {
    return this.admin.disputes();
  }

  @Get('audit')
  async audit(): Promise<AuditLog> {
    return this.admin.audit();
  }

  @Get('operators')
  async operators(): Promise<Operator[]> {
    return this.admin.operators();
  }

  @Get('settings')
  async settings(): Promise<PlatformSettings> {
    return this.admin.settings();
  }

  @Put('settings')
  @Roles('admin_super')
  async saveSettings(
    @Body() body: unknown,
    @Headers('x-request-id') requestId: string | undefined,
    @Req() request: AuthenticatedRequest
  ): Promise<PlatformSettings> {
    return this.admin.saveSettings(body, {
      actorId: requireActor(request),
      requestId: requestId ?? null
    });
  }
}

function parseReleaseInput(body: unknown): ReleaseInput {
  const parsed = RELEASE_BODY.safeParse(body);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Permintaan release tidak valid', parsed.error.issues);
  }
  return {
    booking_ids: parsed.data.booking_ids ?? [],
    reason: parsed.data.reason ?? '',
    maker: parsed.data.maker ?? '',
    checker: parsed.data.checker ?? ''
  };
}
