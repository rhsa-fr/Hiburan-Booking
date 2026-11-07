import {
  Controller,
  Get,
  Module
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AllExceptionsFilter } from './core/error-filter';
import { AdminModule } from '@tarlink/modules/admin';
import { BookingModule } from '@tarlink/modules/booking';
import { AuthModule } from '@tarlink/modules/auth';
import { CatalogModule } from '@tarlink/modules/catalog';
import { ChatModule } from '@tarlink/modules/chat';
import { NotificationsModule } from '@tarlink/modules/notifications';
import { PaymentModule } from '@tarlink/modules/payment';
import { PayoutModule } from '@tarlink/modules/payout';
import { VendorPortalModule } from '@tarlink/modules/vendor-portal';
import { VendorOnboardingModule } from '@tarlink/modules/vendor-onboarding';
import { AuthGuard, JWT_SECRET, RolesGuard } from '@tarlink/platform/auth';
import { IdempotencyService, PgIdempotencyStore } from '@tarlink/platform/idempotency';
import { SystemClock } from '@tarlink/platform/clock';
import { getPool } from '@tarlink/core/db';
import { loadConfig } from '@tarlink/core/config';

@Controller()
class HealthController {
  @Get('health')
  health(): { status: 'ok'; ts: string } {
    return { status: 'ok', ts: new Date().toISOString() };
  }
}

@Module({
  imports: [
    AuthModule,
    AdminModule,
    CatalogModule,
    ChatModule,
    NotificationsModule,
    BookingModule,
    PaymentModule,
    VendorPortalModule,
    VendorOnboardingModule,
    PayoutModule
  ],
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
