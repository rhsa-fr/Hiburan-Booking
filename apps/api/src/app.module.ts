import {
  ArgumentsHost,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  HttpException,
  Module
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AdminModule } from '@tarlink/modules/admin';
import { BookingModule } from '@tarlink/modules/booking';
import { AuthModule } from '@tarlink/modules/auth';
import { CatalogModule } from '@tarlink/modules/catalog';
import { PaymentModule } from '@tarlink/modules/payment';
import { AuthGuard, JWT_SECRET, RolesGuard } from '@tarlink/platform/auth';
import { IdempotencyService, PgIdempotencyStore } from '@tarlink/platform/idempotency';
import { SystemClock } from '@tarlink/platform/clock';
import { getPool } from '@tarlink/core/db';
import { loadConfig } from '@tarlink/core/config';
import { AppError, type ErrorEnvelope } from '@tarlink/core/errors';

@Controller()
class HealthController {
  @Get('health')
  health(): { status: 'ok'; ts: string } {
    return { status: 'ok', ts: new Date().toISOString() };
  }
}

/**
 * Single error shape for the whole API (TECH-DESIGN §7.1):
 * { "error": { "code", "message", "request_id", "details" } }
 */
@Catch()
class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest<{ id?: string }>();

    let status = 500;
    let code: ErrorEnvelope['error']['code'] = 'INTERNAL_ERROR';
    let message = 'Terjadi kesalahan. Coba lagi sebentar lagi.';
    let details: unknown;

    if (exception instanceof AppError) {
      status = exception.status;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = status === 400 ? 'VALIDATION_ERROR' : status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : status === 409 ? 'CONFLICT' : status === 429 ? 'RATE_LIMITED' : 'INTERNAL_ERROR';
      const body = exception.getResponse();
      message = typeof body === 'string' ? body : ((body as { message?: string })?.message ?? message);
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    response.status(status).json({
      error: {
        code,
        message,
        request_id: request?.id,
        details
      }
    } satisfies ErrorEnvelope);
  }
}

@Module({
  imports: [AuthModule, AdminModule, CatalogModule, BookingModule, PaymentModule],
  controllers: [HealthController],
  providers: [
    RolesGuard,
    {
      provide: IdempotencyService,
      useFactory: (): IdempotencyService =>
        new IdempotencyService(new PgIdempotencyStore(getPool()), { clock: new SystemClock() })
    },
    { provide: JWT_SECRET, useValue: loadConfig().JWT_SECRET },
    { provide: AuthGuard, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter }
  ],
  exports: [AuthGuard]
})
export class AppModule {}
