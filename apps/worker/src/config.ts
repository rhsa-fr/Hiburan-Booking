import { loadDotEnv } from '../../api/src/core/config';

export interface WorkerConfig {
  DATABASE_URL: string;
  WORKER_TICK_MS: number;
  WORKER_BATCH: number;
  /** 0 = run forever. Positive values stop after N ticks (smoke tests / cron). */
  WORKER_MAX_TICKS: number;
  /**
   * `production` makes a missing email provider fail closed instead of
   * pretending the message was delivered. Defaults to development.
   */
  NODE_ENV: string;
  /** Outbound email (FR-051). Unset outside production = messages are logged. */
  EMAIL_PROVIDER?: string;
  EMAIL_API_URL?: string;
  EMAIL_API_KEY?: string;
  EMAIL_FROM?: string;
  /**
   * FCM push. `FCM_SERVICE_ACCOUNT_JSON` is either the raw service-account JSON
   * or its base64 encoding. Absent = the push sink is a no-op, so in-app and
   * email delivery still run.
   */
  FCM_SERVICE_ACCOUNT_JSON?: string;
  FCM_PROJECT_ID?: string;
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
    WORKER_MAX_TICKS: readInt('WORKER_MAX_TICKS', env.WORKER_MAX_TICKS, 0, 0),
    NODE_ENV: env.NODE_ENV?.trim() || 'development',
    EMAIL_PROVIDER: optional(env.EMAIL_PROVIDER),
    EMAIL_API_URL: optional(env.EMAIL_API_URL),
    EMAIL_API_KEY: optional(env.EMAIL_API_KEY),
    EMAIL_FROM: optional(env.EMAIL_FROM),
    FCM_SERVICE_ACCOUNT_JSON: optional(env.FCM_SERVICE_ACCOUNT_JSON),
    FCM_PROJECT_ID: optional(env.FCM_PROJECT_ID)
  };
  return cached;
}

function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
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
