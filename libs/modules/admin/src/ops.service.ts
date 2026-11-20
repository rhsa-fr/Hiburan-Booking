/**
 * Operator readiness summary: reads the counters and applies the presentation
 * mapping. Kept thin on purpose — all thresholds are in the repository SQL and
 * all labels/ordering are in `ops.alerts.ts`, so each half is testable alone.
 */
import { Injectable } from '@nestjs/common';
import { buildOpsAlerts, type OpsAlertsView } from './ops.alerts';
import { OpsRepository } from './ops.repository';

@Injectable()
export class OpsService {
  constructor(private readonly repository: OpsRepository) {}

  async alerts(): Promise<OpsAlertsView> {
    const snapshot = await this.repository.snapshot();
    return buildOpsAlerts(snapshot, new Date());
  }
}
