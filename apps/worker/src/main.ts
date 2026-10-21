/**
 * Tarlink background worker — one long-running process, database poll loop.
 *
 * Deviation from TECH-DESIGN-v1.0 §8.3: the target design schedules jobs with
 * Redis + BullMQ / a `scheduled_jobs` table. This packet runs a plain DB poll
 * loop instead, with no Redis and no queue dependency. The DB is the source of
 * truth, every job is idempotent and guarded by a per-job `pg_try_advisory_lock`,
 * so correctness does not depend on the scheduler: adding BullMQ later only
 * changes *when* a tick runs, not *what* it does.
 */
import './alias';
import { loadWorkerConfig, redactDatabaseUrl, type WorkerConfig } from './config';
import { closePool } from './db';
import { JOBS } from './jobs';
import { runJob } from './jobs/runner';
import { errorMessage, logLine } from './log';

let stopping = false;
let shuttingDown = false;
let inTick = false;
let tickTimer: NodeJS.Timeout | null = null;
let ticks = 0;

async function shutdown(reason: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  if (tickTimer) {
    clearTimeout(tickTimer);
    tickTimer = null;
  }
  try {
    await closePool();
  } catch (err) {
    logLine(`worker_stop error=${errorMessage(err)}`);
  }
  logLine(`worker_stop reason=${reason} ticks=${ticks}`);
  process.exit(0);
}

function requestShutdown(signal: string): void {
  if (stopping) return;
  stopping = true;
  logLine(`worker_stop_requested signal=${signal} in_tick=${inTick}`);
  if (tickTimer) {
    clearTimeout(tickTimer);
    tickTimer = null;
  }
  // Finish the current tick before exiting; only stop right away when idle.
  if (!inTick) void shutdown(signal);
}

function scheduleNextTick(cfg: WorkerConfig): void {
  if (stopping) return;
  tickTimer = setTimeout(() => {
    tickTimer = null;
    void tick(cfg);
  }, cfg.WORKER_TICK_MS);
}

async function tick(cfg: WorkerConfig): Promise<void> {
  if (stopping) return;
  inTick = true;
  const tickStartedAt = Date.now();

  try {
    for (const job of JOBS) {
      if (stopping) break;
      await runJob(job, cfg.WORKER_BATCH);
    }
  } catch (err) {
    logLine(`tick=failed error=${errorMessage(err)}`);
  } finally {
    inTick = false;
    ticks += 1;
    logLine(`tick=done ticks=${ticks} duration_ms=${Date.now() - tickStartedAt}`);

    if (stopping) {
      await shutdown('signal');
    } else if (cfg.WORKER_MAX_TICKS > 0 && ticks >= cfg.WORKER_MAX_TICKS) {
      await shutdown('max_ticks');
    } else {
      scheduleNextTick(cfg);
    }
  }
}

function main(): void {
  let cfg: WorkerConfig;
  try {
    cfg = loadWorkerConfig();
  } catch (err) {
    console.error(`worker_config_invalid error=${errorMessage(err)}`);
    process.exitCode = 1;
    return;
  }

  logLine(
    `worker_start tick_ms=${cfg.WORKER_TICK_MS} batch=${cfg.WORKER_BATCH} max_ticks=${cfg.WORKER_MAX_TICKS} database=${redactDatabaseUrl(cfg.DATABASE_URL)} pid=${process.pid}`
  );

  process.on('SIGINT', () => requestShutdown('SIGINT'));
  process.on('SIGTERM', () => requestShutdown('SIGTERM'));

  void tick(cfg);
}

main();
