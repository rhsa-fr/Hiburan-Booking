import { loadDotEnv } from '../../api/src/core/config';

export interface WorkerConfig {
  DATABASE_URL: string;
  WORKER_TICK_MS: number;
  WORKER_BATCH: number;
  /** 0 = run forever. Positive values stop after N ticks (smoke tests / cron). */
  WORKER_MAX_TICKS: number;
}

function readInt(name: string, raw: string | undefined, fallback: number, min: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`Invalid environment: ${name} must be an integer >= ${min}`);
  }
  return value;
}

let cached: WorkerConfig | null = null;

/**
 * Worker env schema. Deliberately narrower than the API schema: the worker
 * needs no JWT/Redis/PJP configuration, so it must not fail on those.
 */
export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  if (cached) return cached;
  loadDotEnv();

  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('Invalid environment: DATABASE_URL is required');
  }

  cached = {
    DATABASE_URL: databaseUrl,
    WORKER_TICK_MS: readInt('WORKER_TICK_MS', env.WORKER_TICK_MS, 15_000, 1),
    WORKER_BATCH: readInt('WORKER_BATCH', env.WORKER_BATCH, 50, 1),
    WORKER_MAX_TICKS: readInt('WORKER_MAX_TICKS', env.WORKER_MAX_TICKS, 0, 0)
  };
  return cached;
}

/** `postgres://user:pass@host:5432/db` -> `postgres://host:5432/db` (never log credentials). */
export function redactDatabaseUrl(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return '<unparseable>';
  }
}
