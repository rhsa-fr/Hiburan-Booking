import { Module } from '@nestjs/common';
import { loadConfig } from '@tarlink/core/config';
import { PaymentModule } from '@tarlink/modules/payment';
import { AuthGuard, JWT_SECRET, RolesGuard } from '@tarlink/platform/auth';
import { AdminController } from './admin.controller';
import { AdminRepository } from './admin.repository';
import { AdminService } from './admin.service';

/**
 * Admin read + release module.
 *
 * Note for the lead: `AppModule` is lead-owned; import `AdminModule` there.
 * It needs no extra configuration — the JWT secret is read from `loadConfig()`
 * inside this module and both guards are registered in this injector.
 */
@Module({
  imports: [PaymentModule],
  controllers: [AdminController],
  providers: [
    AdminRepository,
    AdminService,
    { provide: JWT_SECRET, useValue: loadConfig().JWT_SECRET },
    { provide: AuthGuard, useClass: AuthGuard },
    RolesGuard
  ],
  exports: [AdminService]
})
export class AdminModule {}
