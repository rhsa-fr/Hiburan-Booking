import {
  Controller,
  Get,
  Module,
  Res
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AllExceptionsFilter } from './core/error-filter';
import { AdminModule } from '@tarlink/modules/admin';
import { BookingModule } from '@tarlink/modules/booking';
import { AuthModule } from '@tarlink/modules/auth';
import { CatalogModule } from '@tarlink/modules/catalog';
import { ChatModule } from '@tarlink/modules/chat';
import { ModerationModule } from '@tarlink/modules/moderation';
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
  /** Liveness: the process answers HTTP. Never touches the database. */
  @Get('health')
  health(): { status: 'ok'; ts: string } {
    return { status: 'ok', ts: new Date().toISOString() };
  }

  /**
   * Readiness: the process can serve requests that need PostgreSQL. Returns
   * 503 so a container orchestrator/load balancer can stop routing traffic
   * while the database is unreachable, instead of serving 500s.
   */
  @Get('health/ready')
  async ready(
    @Res({ passthrough: true }) response: { status(code: number): void }
  ): Promise<{ status: 'ok' | 'degraded'; checks: { db: 'ok' | 'error' }; ts: string }> {
    const ts = new Date().toISOString();
    try {
      await getPool().query('SELECT 1');
      return { status: 'ok', checks: { db: 'ok' }, ts };
    } catch {
      response.status(503);
      return { status: 'degraded', checks: { db: 'error' }, ts };
    }
  }
}

@Module({
  imports: [
    AuthModule,
    AdminModule,
    CatalogModule,
    ChatModule,
    ModerationModule,
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
