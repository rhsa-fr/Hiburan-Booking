import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { loadConfig } from './config';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const cfg = loadConfig();
    pool = new Pool({
      connectionString: cfg.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000
    });
  }
  return pool;
}

export async function query<T extends QueryResultRow>(text: string, params: readonly unknown[] = []): Promise<T[]> {
  const res = await getPool().query<T>(text, params as unknown[]);
  return res.rows;
}

/**
 * Runs fn inside a single transaction. Rolls back on any thrown error.
 * All money columns are BIGINT; callers receive them as strings from pg and
 * must convert with BigInt(), never parseFloat().
 */
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

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
