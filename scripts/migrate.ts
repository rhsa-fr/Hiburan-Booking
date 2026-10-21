/**
 * Migration runner (TECH-DESIGN-v1.0 §11.6).
 *
 * - reads db/migrations/*.sql in lexicographic order
 * - records (version, checksum) in schema_migrations
 * - holds a session advisory lock so two runners cannot apply concurrently
 * - runs each file in its own transaction; a failed file rolls back alone
 * - refuses to continue when an applied file's checksum changed
 *
 * Usage:
 *   tsx scripts/migrate.ts [--dry-run] [--dir <path>]
 *
 * Requires DATABASE_URL. No secret is read or embedded here.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { Client } from 'pg';

export const DEFAULT_MIGRATIONS_DIR = resolve(__dirname, '..', 'db', 'migrations');

/** Stable key so every runner in the cluster waits on the same lock. */
export const ADVISORY_LOCK_KEY = '20261021001';

/** sha256 hex over the SQL with CRLF normalised to LF. */
export function checksum(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

export interface MigrationFile {
  version: string;
  filePath: string;
  sql: string;
  checksum: string;
}

export interface AppliedMigration {
  version: string;
  checksum: string;
}

export async function loadMigrations(dir: string = DEFAULT_MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const versions = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const migrations: MigrationFile[] = [];
  for (const fileName of versions) {
    const filePath = join(dir, fileName);
    const sql = await readFile(filePath, 'utf8');
    migrations.push({
      version: basename(fileName, '.sql'),
      filePath,
      sql,
      checksum: checksum(sql)
    });
  }

  return migrations;
}

/**
 * Pure planning step: validates the applied set against the files on disk and
 * returns what still has to run. Throws when history was tampered with.
 */
export function planMigrations(
  files: readonly MigrationFile[],
  applied: readonly AppliedMigration[]
): MigrationFile[] {
  const known = new Map(files.map((file) => [file.version, file]));

  for (const record of applied) {
    const file = known.get(record.version);
    if (!file) {
      throw new Error(
        `Applied migration ${record.version} has no file on disk; refusing to continue`
      );
    }
    if (file.checksum !== record.checksum) {
      throw new Error(
        `Checksum mismatch for ${record.version}: database has ${record.checksum}, file has ${file.checksum}`
      );
    }
  }

  const appliedVersions = new Set(applied.map((record) => record.version));
  return files.filter((file) => !appliedVersions.has(file.version));
}

async function readApplied(
  client: Client,
  options: { allowMissingTable: boolean }
): Promise<AppliedMigration[]> {
  try {
    const result = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations ORDER BY version'
    );
    return result.rows;
  } catch (err) {
    if (options.allowMissingTable && isUndefinedTable(err)) return [];
    throw err;
  }
}

function isUndefinedTable(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '42P01';
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface RunOptions {
  dir?: string;
  dryRun?: boolean;
  /** Defaults to process.env.DATABASE_URL. */
  databaseUrl?: string;
  log?: (line: string) => void;
}

export interface RunResult {
  applied: string[];
  pending: string[];
}

export async function runMigrations(options: RunOptions = {}): Promise<RunResult> {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to run migrations');
  }

  const dir = options.dir ?? DEFAULT_MIGRATIONS_DIR;
  const dryRun = options.dryRun ?? false;
  const log = options.log ?? ((line: string) => process.stdout.write(`${line}\n`));

  const files = await loadMigrations(dir);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    if (dryRun) {
      const applied = await readApplied(client, { allowMissingTable: true });
      const pending = planMigrations(files, applied);
      for (const migration of pending) {
        log(`pending ${migration.version}`);
      }
      if (pending.length === 0) log('no pending migrations');
      return { applied: [], pending: pending.map((migration) => migration.version) };
    }

    await client.query('SELECT pg_advisory_lock($1::bigint)', [ADVISORY_LOCK_KEY]);
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version    TEXT PRIMARY KEY,
          checksum   TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);

      const applied = await readApplied(client, { allowMissingTable: false });
      const pending = planMigrations(files, applied);
      const appliedNow: string[] = [];

      for (const migration of pending) {
        await client.query('BEGIN');
        try {
          await client.query(migration.sql);
          await client.query(
            'INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)',
            [migration.version, migration.checksum]
          );
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw new Error(`Migration ${migration.version} failed: ${describeError(err)}`, {
            cause: err
          });
        }
        appliedNow.push(migration.version);
        log(`applied ${migration.version}`);
      }

      if (appliedNow.length === 0) log('no pending migrations');
      return { applied: appliedNow, pending: pending.map((migration) => migration.version) };
    } finally {
      await client.query('SELECT pg_advisory_unlock($1::bigint)', [ADVISORY_LOCK_KEY]);
    }
  } finally {
    await client.end();
  }
}

interface CliOptions {
  dryRun: boolean;
  dir?: string;
  help: boolean;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const parsed: CliOptions = { dryRun: false, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--dir') {
      const value = argv[i + 1];
      if (!value) throw new Error('--dir requires a path');
      parsed.dir = value;
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

async function main(argv: readonly string[]): Promise<void> {
  const options = parseArgs(argv);

  if (options.help) {
    process.stdout.write(
      'Usage: tsx scripts/migrate.ts [--dry-run] [--dir <migrations-dir>]\n' +
        'Applies db/migrations/*.sql in lexicographic order.\n'
    );
    return;
  }

  await runMigrations({ dryRun: options.dryRun, dir: options.dir });
}

if (typeof require !== 'undefined' && require.main === module) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    process.stderr.write(`${describeError(err)}\n`);
    process.exitCode = 1;
  });
}
