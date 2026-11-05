/**
 * HTTP surface for the money routes of the payment slice.
 *
 * Routes are mounted under the global `v1` prefix (see `apps/api/src/main.ts`):
 *   POST /v1/payments/dp
 *   POST /v1/payments/:id/refund
 *
 * Both routes require a bearer token: `AuthGuard` verifies it and puts the
 * identity in `request.user`. The identity is never read from a header.
 * `RolesGuard` enforces the admin role on the refund route.
 *
 * The PJP webhook lives in its own controller (`pjp-webhook.controller.ts`):
 * the provider cannot send a bearer token, it is authenticated by the HMAC
 * signature instead.
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
import { PAYMENT_METHODS, toBigInt } from './payment.repository';
import {
  PaymentService,
  hashRequest,
  type AdminRefundItem,
  type DpPaymentByBookingResult,
  type RefundByBookingResult,
  type RefundResult,
  type SettlementChargeResult,
  type SettlementPaymentByBookingResult
} from './payment.service';

const RefundListQuery = z.object({
  status: z
    .enum(['requested', 'approved', 'processing', 'succeeded', 'failed', 'rejected'])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

const DpChargeBody = z.object({
  booking_id: z.string().uuid(),
  method: z.enum(PAYMENT_METHODS)
});

const SettlementChargeBody = z.object({
  booking_id: z.string().uuid(),
  method: z.enum(PAYMENT_METHODS)
});

const RefundBody = z.object({
  amount_idr: z.union([z.string().regex(/^\d+$/), z.number().int().positive()]),
  reason: z.string().min(1).max(500),
  evidence_url: z.string().url().max(500).optional()
});

const RefundRejectBody = z.object({
  note: z.string().min(5).max(500)
});

@Controller()
@UseGuards(AuthGuard, RolesGuard)
export class PaymentController {
  constructor(private readonly payments: PaymentService) {}

  @Post('payments/dp')
  @HttpCode(201)
  async createDpCharge(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: AuthenticatedRequest
  ): Promise<{ data: unknown }> {
    const parsed = DpChargeBody.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'invalid DP charge request', parsed.error.issues);
    }
    if (!idempotencyKey) {
      // §7.5: POST /payments is an Idempotency-Key mandatory endpoint.
      throw new AppError('VALIDATION_ERROR', 'Idempotency-Key header is required');
    }

    const result = await this.payments.createDpCharge(
      parsed.data.booking_id,
      parsed.data.method,
      {
        idempotencyKey,
        actorId: req.user?.id ?? null,
        requestHash: hashRequest(parsed.data)
      }
    );
    return { data: result };
  }

  @Post('payments/settlement')
  @HttpCode(201)
  async createSettlementCharge(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: AuthenticatedRequest
  ): Promise<{ data: SettlementChargeResult }> {
    const parsed = SettlementChargeBody.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'invalid settlement charge request', parsed.error.issues);
    }
    if (!idempotencyKey) {
      throw new AppError('VALIDATION_ERROR', 'Idempotency-Key header is required');
    }

    const result = await this.payments.createSettlementCharge(
      parsed.data.booking_id,
      parsed.data.method,
      {
        idempotencyKey,
        actorId: req.user?.id ?? null,
        requestHash: hashRequest(parsed.data)
      }
    );
    return { data: result };
  }

  /**
   * The mobile client re-fetches the DP instruction for its own booking. Any
   * role reaches the handler; ownership is enforced by the service.
   */
  @Get('payments/by-booking/:bookingId')
  async dpByBooking(
    @Param('bookingId') bookingId: string,
    @Query('kind') kind: string | undefined,
    @Req() req: AuthenticatedRequest
  ): Promise<{ data: DpPaymentByBookingResult | SettlementPaymentByBookingResult }> {
    const parsed = z.string().uuid().safeParse(bookingId);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'invalid booking id');
    }

    if (kind === 'settlement') {
      return {
        data: await this.payments.getSettlementPaymentByBooking(parsed.data, {
          actorId: req.user?.id ?? null
        })
      };
    }

    return {
      data: await this.payments.getDpPaymentByBooking(parsed.data, {
        actorId: req.user?.id ?? null
      })
    };
  }

  @Get('payments/settlement/by-booking/:bookingId')
  async settlementByBooking(
    @Param('bookingId') bookingId: string,
    @Req() req: AuthenticatedRequest
  ): Promise<{ data: SettlementPaymentByBookingResult }> {
    const parsed = z.string().uuid().safeParse(bookingId);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'invalid booking id');
    }

    return {
      data: await this.payments.getSettlementPaymentByBooking(parsed.data, {
        actorId: req.user?.id ?? null
      })
    };
  }

  @Post('payments/:id/refund')
  @HttpCode(201)
  @Roles('admin_finance', 'admin_super')
  async refund(
    @Param('id') paymentId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: AuthenticatedRequest
  ): Promise<{ data: RefundResult }> {
    const parsed = RefundBody.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'invalid refund request', parsed.error.issues);
    }

    const result = await this.payments.refund(
      paymentId,
      toBigInt(parsed.data.amount_idr, 'amount_idr'),
      parsed.data.reason,
      {
        idempotencyKey,
        actorId: req.user?.id ?? null,
        actorRoles: req.user?.roles,
        evidenceUrl: parsed.data.evidence_url ?? null,
        requestHash: hashRequest({ payment_id: paymentId, ...parsed.data })
      }
    );
    return { data: result };
  }

  /** Queue for the admin refund screen: pending maker-checker requests first. */
  @Get('payments/refunds')
  @Roles('admin_finance', 'admin_super')
  async listRefunds(
    @Query() query: unknown
  ): Promise<{ data: { items: AdminRefundItem[] } }> {
    const parsed = RefundListQuery.safeParse(query);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Filter refund tidak valid', parsed.error.issues);
    }
    return {
      data: await this.payments.listRefunds({
        status: parsed.data.status ?? null,
        limit: parsed.data.limit
      })
    };
  }

  /** Second-admin approval of a refund above the threshold (FR-128). */
  @Post('payments/refunds/:id/approve')
  @HttpCode(200)
  @Roles('admin_finance', 'admin_super')
  async approveRefund(
    @Param('id') refundId: string,
    @Req() req: AuthenticatedRequest
  ): Promise<{ data: RefundResult }> {
    if (!z.string().uuid().safeParse(refundId).success) {
      throw new AppError('VALIDATION_ERROR', 'invalid refund id');
    }
    const result = await this.payments.approveRefund(refundId, {
      actorId: req.user?.id ?? null,
      actorRoles: req.user?.roles
    });
    return { data: result };
  }

  @Post('payments/refunds/:id/reject')
  @HttpCode(200)
  @Roles('admin_finance', 'admin_super')
  async rejectRefund(
    @Param('id') refundId: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ): Promise<{ data: RefundResult }> {
    if (!z.string().uuid().safeParse(refundId).success) {
      throw new AppError('VALIDATION_ERROR', 'invalid refund id');
    }
    const parsed = RefundRejectBody.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'invalid refund rejection', parsed.error.issues);
    }
    const result = await this.payments.rejectRefund(refundId, parsed.data.note, {
      actorId: req.user?.id ?? null,
      actorRoles: req.user?.roles
    });
    return { data: result };
  }

  /** Refund status for the booking owner or an admin (FR-133). */
  @Get('payments/refunds/by-booking/:bookingId')
  @Roles('customer', 'admin_support', 'admin_finance', 'admin_super')
  async refundByBooking(
    @Param('bookingId') bookingId: string,
    @Req() req: AuthenticatedRequest
  ): Promise<{ data: RefundByBookingResult | null }> {
    if (!z.string().uuid().safeParse(bookingId).success) {
      throw new AppError('VALIDATION_ERROR', 'invalid booking id');
    }
    return {
      data: await this.payments.getRefundByBooking(bookingId, {
        actorId: req.user?.id ?? null,
        actorRoles: req.user?.roles
      })
    };
  }
}
