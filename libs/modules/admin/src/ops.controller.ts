/**
 * Read-only operator readiness surface (`/v1/admin/ops/alerts`).
 *
 * Every admin role may read it: the payload is aggregate counters, no customer
 * data and no money movement. Mutations stay on the domain controllers, each
 * with its own narrower role set.
 */
import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard, Roles, RolesGuard } from '@tarlink/platform/auth';
import type { OpsAlertsView } from './ops.alerts';
import { OpsService } from './ops.service';

@Controller('admin/ops')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin_support', 'admin_finance', 'admin_super')
export class OpsController {
  constructor(private readonly ops: OpsService) {}

  @Get('alerts')
  async alerts(): Promise<OpsAlertsView> {
    return this.ops.alerts();
  }
}
