import { withAdvisoryLock } from '../db';
import { errorMessage, logLine } from '../log';

export interface JobStats {
  processed: number;
  skipped: number;
  failed: number;
  /** Rows blocked by a gate rather than by the clock (currently auto_complete). */
  waiting_payment?: number;
}

export interface Job {
  name: string;
  /** Distinct advisory-lock key per job. */
  lockKey: number;
  run(batch: number): Promise<JobStats>;
}

/** Bound on batches per tick so a full backlog cannot stall the loop forever. */
const MAX_BATCHES_PER_TICK = 20;

export const EMPTY_STATS: JobStats = { processed: 0, skipped: 0, failed: 0 };

/**
 * Runs one job under its advisory lock, draining batches until a batch stops
 * making progress. A tick emits exactly one summary line per job.
 */
export async function runJob(job: Job, batch: number): Promise<void> {
  const startedAt = Date.now();
  const totals: JobStats = { processed: 0, skipped: 0, failed: 0 };

  try {
    const lock = await withAdvisoryLock(job.lockKey, async () => {
      const accumulated: JobStats = { processed: 0, skipped: 0, failed: 0 };
      for (let round = 0; round < MAX_BATCHES_PER_TICK; round += 1) {
        const stats = await job.run(batch);
        accumulated.processed += stats.processed;
        accumulated.skipped += stats.skipped;
        accumulated.failed += stats.failed;
        // A snapshot count of blocked rows is the same every round: keep the max.
        if (stats.waiting_payment !== undefined) {
          accumulated.waiting_payment = Math.max(accumulated.waiting_payment ?? 0, stats.waiting_payment);
        }
        // Continue only while the batch was full and nothing failed: a skipped or
        // failed row stays selectable, so re-reading would spin on the same rows.
        if (stats.processed < batch || stats.failed > 0) break;
      }
      return accumulated;
    });

    if (!lock.locked) {
      logLine(`job=${job.name} processed=0 skipped=1 failed=0 skipped_reason=lock_held`);
      return;
    }
    totals.processed = lock.value.processed;
    totals.skipped = lock.value.skipped;
    totals.failed = lock.value.failed;
    totals.waiting_payment = lock.value.waiting_payment;
  } catch (err) {
    logLine(
      `job=${job.name} processed=${totals.processed} skipped=${totals.skipped} failed=${totals.failed + 1} error=${errorMessage(err)}`
    );
    return;
  }

  // Emitted whenever the job reports the field, including 0: "0 blocked" and
  // "no gate" must not look the same in the tick line.
  const waiting = totals.waiting_payment === undefined ? '' : ` waiting_payment=${totals.waiting_payment}`;
  logLine(
    `job=${job.name} processed=${totals.processed} skipped=${totals.skipped} failed=${totals.failed}${waiting} duration_ms=${Date.now() - startedAt}`
  );
}
