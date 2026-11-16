import { Module } from '@nestjs/common';
import { loadConfig } from '@tarlink/core/config';
import { PaymentModule } from '@tarlink/modules/payment';
import { AuthGuard, JWT_SECRET, RolesGuard } from '@tarlink/platform/auth';
import { AdminController } from './admin.controller';
import { AdminRepository } from './admin.repository';
import { AdminService } from './admin.service';
import { OpsController } from './ops.controller';
import { OpsRepository } from './ops.repository';
import { OpsService } from './ops.service';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationRepository } from './reconciliation.repository';
import { ReconciliationService } from './reconciliation.service';

/**
 * Admin read + release module.
 *
 * Note for the lead: `AppModule` is lead-owned; import `AdminModule` there.
 * It needs no extra configuration — the JWT secret is read from `loadConfig()`
 * inside this module and both guards are registered in this injector.
 */
@Module({
  imports: [PaymentModule],
  controllers: [AdminController, ReconciliationController, OpsController],
  providers: [
    AdminRepository,
    AdminService,
    {
      provide: OpsRepository,
      // Interface-typed constructor parameter (database port): Nest cannot
      // resolve it by reflection, so the API instance is built explicitly.
      useFactory: () => new OpsRepository()
    },
    OpsService,
    {
      provide: ReconciliationRepository,
      // The repository has a DB-port constructor so the worker can inject its
      // own pool; the API instance keeps the default core pool.
      useFactory: () => new ReconciliationRepository()
    },
    ReconciliationService,
    { provide: JWT_SECRET, useValue: loadConfig().JWT_SECRET },
    { provide: AuthGuard, useClass: AuthGuard },
    RolesGuard
  ],
  exports: [AdminService]
})
export class AdminModule {}
