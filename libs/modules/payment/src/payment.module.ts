import { Module } from '@nestjs/common';
import { loadConfig } from '@tarlink/core/config';
import { getPool } from '@tarlink/core/db';
import { BookingModule, BookingService } from '@tarlink/modules/booking';
import { AuthGuard, JWT_SECRET, RolesGuard } from '@tarlink/platform/auth';
import { PgIdempotencyStore } from '@tarlink/platform/idempotency';
import { asBookingPaymentPort } from './booking.port';
import { LocalPaymentGateway } from './local.gateway';
import { MidtransGateway } from './midtrans.gateway';
import { PaymentController } from './payment.controller';
import { PjpWebhookController } from './pjp-webhook.controller';
import { PgPaymentRepository } from './payment.repository';
import { PaymentService } from './payment.service';

/**
 * Note for the lead: `AppModule` is lead-owned and does not import this module
 * yet. Register `PaymentModule` there — it needs no extra configuration because
 * the factory reads `PJP_WEBHOOK_SECRET` / `PJP_PROVIDER` from `loadConfig()`.
 *
 * The guards are registered here so they resolve in THIS module's injector:
 * `AuthGuard` needs the JWT secret from configuration and `RolesGuard` needs
 * the `Reflector` of the framework. The webhook controller is intentionally
 * left unguarded: the PJP provider authenticates with the HMAC signature.
 */
@Module({
  imports: [BookingModule],
  controllers: [PaymentController, PjpWebhookController],
  providers: [
    { provide: JWT_SECRET, useValue: loadConfig().JWT_SECRET },
    { provide: AuthGuard, useClass: AuthGuard },
    RolesGuard,
    {
      provide: PaymentService,
      inject: [BookingService],
      useFactory: (booking: BookingService): PaymentService => {
        const cfg = loadConfig();
        const useMidtrans = cfg.PJP_PROVIDER === 'midtrans';
        const gateway = useMidtrans
          ? new MidtransGateway({
              serverKey: cfg.MIDTRANS_SERVER_KEY ?? '',
              isProduction: cfg.MIDTRANS_IS_PRODUCTION,
              baseUrl: cfg.MIDTRANS_BASE_URL
            })
          : new LocalPaymentGateway();
        return new PaymentService({
          repository: new PgPaymentRepository(),
          booking: asBookingPaymentPort(booking),
          idempotencyStore: new PgIdempotencyStore(getPool()),
          webhookSecret: cfg.PJP_WEBHOOK_SECRET,
          gateway,
          provider: gateway.name,
          // Midtrans uses our payment id as the provider order_id so the
          // notification and refund routes can look the payment up directly.
          newProviderRef: useMidtrans ? (paymentId) => paymentId : undefined
        });
      }
    }
  ],
  exports: [PaymentService]
})
export class PaymentModule {}
