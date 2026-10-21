/**
 * PJP webhook ingress.
 *
 * The provider cannot send a bearer token: this controller is deliberately
 * NOT guarded by `AuthGuard`/`RolesGuard`. It is authenticated by the HMAC
 * signature of the exact request bytes, which `PaymentService.handleWebhook`
 * verifies before anything is written.
 *
 * Raw body: the HMAC covers the exact bytes. `main.ts` must be bootstrapped
 * with `NestFactory.create(AppModule, { rawBody: true })`; without it Nest's
 * JSON parser consumes the stream and `req.rawBody` is absent. `main.ts` is
 * lead-owned, so the controller reads `req.rawBody` when present and fails
 * closed (never re-serializes JSON) when it is missing.
 */
import { Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { AppError } from '@tarlink/core/errors';
import { PaymentService, type PjpWebhookEvent } from './payment.service';

interface RawBodyRequest {
  readonly rawBody?: Buffer | string;
  readonly body?: unknown;
}

function readRawBody(req: RawBodyRequest): Buffer {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (typeof req.rawBody === 'string') return Buffer.from(req.rawBody, 'utf8');
  if (Buffer.isBuffer(req.body)) return req.body;
  throw new AppError(
    'VALIDATION_ERROR',
    'raw body unavailable: enable { rawBody: true } in NestFactory.create'
  );
}

@Controller('webhooks')
export class PjpWebhookController {
  constructor(private readonly payments: PaymentService) {}

  @Post('pjp')
  @HttpCode(200)
  async handlePjpWebhook(
    @Req() req: RawBodyRequest,
    @Headers('x-pjp-signature') signature: string | undefined,
    @Headers('x-pjp-timestamp') timestamp: string | undefined
  ): Promise<{ data: unknown }> {
    const raw = readRawBody(req);
    let event: PjpWebhookEvent;
    try {
      event = JSON.parse(raw.toString('utf8')) as PjpWebhookEvent;
    } catch {
      throw new AppError('VALIDATION_ERROR', 'webhook body is not valid JSON');
    }
    const result = await this.payments.handleWebhook(raw, signature ?? '', {
      ...event,
      timestamp: event.timestamp ?? timestamp
    });
    return { data: result };
  }
}
