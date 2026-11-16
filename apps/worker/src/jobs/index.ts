import { createEmailTransport } from '@tarlink/platform/email';
import { loadWorkerConfig } from '../config';
import { runAutoComplete } from './auto-complete';
import { runAutoRelease } from './auto-release';
import { runBookingReminders } from './booking-reminders';
import { runCleanupAuth } from './cleanup-auth';
import { runCleanupMedia } from './cleanup-media';
import { EmailNotificationSink } from './email-sink';
import { runEscalateReports } from './escalate-reports';
import { runExpireHolds } from './expire-holds';
import { runExpireUnpaid } from './expire-unpaid';
import { runExpireUnresponsive } from './expire-unresponsive';
import { NotificationSink } from './notification-sink';
import { CompositeMessageSink, runOutbox, type MessageSink } from './outbox';
import { runPayoutReconcile } from './payout-reconcile';
import { runReconcileDaily } from './reconcile-daily';
import type { Job } from './runner';

/**
 * Outbox delivery fan-out: in-app row first, then the outbound email (FR-051).
 *
 * Built lazily because the worker config is only validated in `main()`; a static
 * sink would read `process.env` at import time and could bake in the wrong
 * email provider. Both sinks are idempotent per outbox message.
 */
let outboxSink: MessageSink | null = null;

function getOutboxSink(): MessageSink {
  if (!outboxSink) {
    const cfg = loadWorkerConfig();
    outboxSink = new CompositeMessageSink([
      new NotificationSink(),
      new EmailNotificationSink(
        createEmailTransport({
          nodeEnv: cfg.NODE_ENV,
          apiUrl: cfg.EMAIL_API_URL,
          apiKey: cfg.EMAIL_API_KEY,
          from: cfg.EMAIL_FROM
        })
      )
    ]);
  }
  return outboxSink;
}

/**
 * Execution order inside one tick. Slots are freed before anything reads them,
 * then time-based lifecycle/settlement jobs run, and the outbox relays last so
 * the events produced by this tick leave in the same pass.
 */
export const JOBS: readonly Job[] = [
  { name: 'expire_unpaid', lockKey: 74_101, run: runExpireUnpaid },
  { name: 'expire_unresponsive', lockKey: 74_108, run: runExpireUnresponsive },
  { name: 'expire_holds', lockKey: 74_102, run: runExpireHolds },
  { name: 'auto_complete', lockKey: 74_103, run: runAutoComplete },
  { name: 'auto_release', lockKey: 74_104, run: runAutoRelease },
  { name: 'payout_reconcile', lockKey: 74_107, run: runPayoutReconcile },
  { name: 'reconcile_daily', lockKey: 74_110, run: runReconcileDaily },
  { name: 'escalate_reports', lockKey: 74_111, run: runEscalateReports },
  { name: 'booking_reminders', lockKey: 74_112, run: runBookingReminders },
  {
    name: 'outbox',
    lockKey: 74_105,
    run: (batch: number) => runOutbox(batch, getOutboxSink())
  },
  { name: 'cleanup_auth', lockKey: 74_106, run: runCleanupAuth },
  { name: 'cleanup_media', lockKey: 74_109, run: () => runCleanupMedia() }
];
