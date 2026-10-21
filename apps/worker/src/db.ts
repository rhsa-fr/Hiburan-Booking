import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { loadWorkerConfig } from './config';

/**
 * Worker-local pool.
 *
 * `apps/api/src/core/db.ts` is not reused: it resolves the connection string
 * through the API's full env schema (JWT_SECRET and friends), and a background
 * process must not require auth configuration to start. The query helpers are
 * intentionally identical in shape so the job code reads the same.
 *
 * Bigint columns arrive as strings from pg; convert with BigInt(), never
 * parseFloat().
 */
let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const cfg = loadWorkerConfig();
    pool = new Pool({
      connectionString: cfg.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000
    });
  }
  return pool;
}

export async function query<T extends QueryResultRow>(
  text: string,
  params: readonly unknown[] = []
): Promise<T[]> {
  const res = await getPool().query<T>(text, params as unknown[]);
  return res.rows;
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export type LockResult<T> = { locked: true; value: T } | { locked: false };

/**
 * Session-level `pg_try_advisory_lock`. Two workers (or two ticks) can never run
 * the same job at once; the lock is always released in `finally`, and dies with
 * the connection if the process crashes.
 */
export async function withAdvisoryLock<T>(key: number, fn: () => Promise<T>): Promise<LockResult<T>> {
  const client = await getPool().connect();
  try {
    const res = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [key]);
    if (!res.rows[0]?.locked) return { locked: false };
    try {
      return { locked: true, value: await fn() };
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [key]);
    }
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
