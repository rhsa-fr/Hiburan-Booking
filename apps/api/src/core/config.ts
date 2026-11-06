import { z } from 'zod';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Minimal .env loader (no dotenv dependency). Existing process.env wins, so
 * CI/production env vars are never overridden by the file. Supports
 * `KEY=value`, `#` comments, blank lines and optional surrounding quotes.
 */
export function loadDotEnv(file = resolve(process.cwd(), '.env')): void {
  if (!existsSync(file)) return;
  const content = readFileSync(file, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}


/** `true`/`1`/`yes`/`on` enable a flag; anything else (including "false") disables it. */
const boolFromEnv = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  }
  return false;
}, z.boolean());

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  JWT_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  /** OTP `dev_code` is returned only when this is on AND NODE_ENV != production. */
  OTP_DEV_MODE: boolFromEnv.default(false),
  LOGIN_IP_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  OTP_IP_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  /** Generic email provider endpoint; unset uses a log-only mailer in dev. */
  EMAIL_API_URL: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().url().optional()
  ),
  EMAIL_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('Tarlink <no-reply@tarlink.id>'),
  /** Trust `X-Forwarded-For`; enable behind Railway/reverse proxies. */
  TRUST_PROXY: boolFromEnv.default(false),
  /** `local` = deterministic no-network gateway; `midtrans` = Core API (sandbox by default). */
  PJP_PROVIDER: z.string().default('local'),
  /** FR-128: refunds above this amount need a second, different admin. */
  REFUND_APPROVAL_THRESHOLD_IDR: z.coerce.number().int().nonnegative().default(1_000_000),
  PJP_MERCHANT_ID: z.string().optional(),
  PJP_API_KEY: z.string().optional(),
  PJP_WEBHOOK_SECRET: z.string().optional(),
  MIDTRANS_SERVER_KEY: z.string().optional(),
  MIDTRANS_CLIENT_KEY: z.string().optional(),
  MIDTRANS_IS_PRODUCTION: boolFromEnv.default(false),
  MIDTRANS_BASE_URL: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().url().optional()
  ),
  /** `local` = deterministic disbursement stub; `iris` = Midtrans Iris. */
  PAYOUT_PROVIDER: z.enum(['local', 'iris']).default('local'),
  /** Iris uses its own API key (dashboard Iris), not MIDTRANS_SERVER_KEY. */
  IRIS_API_KEY: z.string().optional(),
  IRIS_IS_PRODUCTION: boolFromEnv.default(false),
  IRIS_BASE_URL: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().url().optional()
  ),
  /** base64(32 bytes); required only when a vendor saves a bank account. */
  BANK_ACCOUNT_ENCRYPTION_KEY: z.string().optional(),
  BANK_ACCOUNT_ENCRYPTION_KEY_PREVIOUS: z.string().optional(),
  BANK_ACCOUNT_KEY_ID: z.string().default('v1'),
  /** Local upload directory; relative paths resolve from the repo root. */
  UPLOAD_DIR: z.string().default('storage/uploads'),
  /** Private uploads (KTP). Never served by the public media route. */
  PRIVATE_UPLOAD_DIR: z.string().default('storage/private'),
  /** Optional public origin for media URLs (no trailing /v1). */
  MEDIA_PUBLIC_BASE_URL: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().url().optional()
  )
});

export type AppConfig = z.infer<typeof EnvSchema>;

let cached: AppConfig | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached) return cached;
  loadDotEnv();
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment: ${detail}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test-only: allows replacing config between test cases. */
export function resetConfigForTests(): void {
  cached = null;
}
