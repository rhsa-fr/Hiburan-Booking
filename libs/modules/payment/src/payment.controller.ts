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
import { Body, Controller, Headers, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '@tarlink/core/errors';
import { AuthGuard, Roles, RolesGuard, type AuthenticatedRequest } from '@tarlink/platform/auth';
import { PAYMENT_METHODS, toBigInt } from './payment.repository';
import { PaymentService, hashRequest, type RefundResult } from './payment.service';

const DpChargeBody = z.object({
  booking_id: z.string().uuid(),
  method: z.enum(PAYMENT_METHODS)
});

const RefundBody = z.object({
  amount_idr: z.union([z.string().regex(/^\d+$/), z.number().int().positive()]),
  reason: z.string().min(1).max(500)
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
        requestHash: hashRequest({ payment_id: paymentId, ...parsed.data })
      }
    );
    return { data: result };
  }
}
