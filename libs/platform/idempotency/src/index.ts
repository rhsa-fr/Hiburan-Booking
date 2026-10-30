import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { AppError } from '@tarlink/core/errors';
import { SystemClock, type Clock } from '@tarlink/platform/clock';

/**
 * Idempotency-Key support (TECH-DESIGN-v1.0 §2.4, §7.5, D-11).
 *
 * The key scope is `(actor_id, scope, key)` where `scope` is the route pattern
 * such as `POST /bookings`. A replay with the same request hash returns the
 * stored response; the same key with a different hash is a client bug and
 * raises IDEMPOTENCY_MISMATCH.
 */
export type IdempotencyStatus = 'in_progress' | 'completed' | 'failed';

export interface IdempotencyRecord {
  requestHash: string;
  status: IdempotencyStatus;
  responseStatus: number | null;
  responseBody: unknown;
  lockedUntil: Date | null;
  expiresAt: Date;
}

export interface ClaimRequest {
  scope: string;
  key: string;
  actorId: string | null;
  requestHash: string;
  lockedUntil: Date;
  expiresAt: Date;
}

export interface IdempotencyStore {
  /** Claims the key. Returns false when another request already owns it. */
  tryClaim(request: ClaimRequest): Promise<boolean>;
  read(scope: string, key: string, actorId: string | null): Promise<IdempotencyRecord | null>;
  complete(
    scope: string,
    key: string,
    actorId: string | null,
    responseStatus: number,
    responseBody: unknown
  ): Promise<void>;
  fail(
    scope: string,
    key: string,
    actorId: string | null,
    responseStatus: number
  ): Promise<void>;
  takeOver(
    scope: string,
    key: string,
    actorId: string | null,
    lockedUntil: Date
  ): Promise<void>;
}

type SqlClient = Pick<PoolClient, 'query'>;

type IdempotencyRow = {
  request_hash: string;
  status: string;
  response_status: number | null;
  response_body: unknown;
  locked_until: Date | string | null;
  expires_at: Date | string;
};

function toDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  return value instanceof Date ? value : new Date(value);
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505';
}

export class PgIdempotencyStore implements IdempotencyStore {
  constructor(private readonly db: SqlClient) {}

  async tryClaim(request: ClaimRequest): Promise<boolean> {
    // Retention window: an expired key may be reused, so clear it first.
    await this.db.query(
      `DELETE FROM idempotency_keys
        WHERE actor_id IS NOT DISTINCT FROM $1::uuid
          AND scope = $2
          AND key = $3
          AND expires_at <= now()`,
      [request.actorId, request.scope, request.key]
    );

    try {
      const result = await this.db.query(
        `INSERT INTO idempotency_keys
           (actor_id, scope, key, request_hash, status, locked_until, expires_at)
         VALUES ($1::uuid, $2, $3, $4, 'in_progress', $5, $6)
         ON CONFLICT (actor_id, scope, key) DO NOTHING
         RETURNING id`,
        [
          request.actorId,
          request.scope,
          request.key,
          request.requestHash,
          request.lockedUntil,
          request.expiresAt
        ]
      );
      return result.rows.length > 0;
    } catch (err) {
      // Two runners can both pass ON CONFLICT; the loser sees 23505 and must
      // re-read the winning row instead of failing the request outright.
      if (isUniqueViolation(err)) return false;
      throw err;
    }
  }

  async read(
    scope: string,
    key: string,
    actorId: string | null
  ): Promise<IdempotencyRecord | null> {
    const result = await this.db.query<IdempotencyRow>(
      `SELECT request_hash, status, response_status, response_body, locked_until, expires_at
         FROM idempotency_keys
        WHERE actor_id IS NOT DISTINCT FROM $1::uuid
          AND scope = $2
          AND key = $3`,
      [actorId, scope, key]
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      requestHash: row.request_hash,
      status: row.status as IdempotencyStatus,
      responseStatus: row.response_status === null ? null : Number(row.response_status),
      responseBody: row.response_body,
      lockedUntil: toDate(row.locked_until),
      expiresAt: toDate(row.expires_at) ?? new Date(0)
    };
  }

  async complete(
    scope: string,
    key: string,
    actorId: string | null,
    responseStatus: number,
    responseBody: unknown
  ): Promise<void> {
    await this.db.query(
      `UPDATE idempotency_keys
          SET status = 'completed',
              response_status = $4,
              response_body = $5::jsonb,
              locked_until = NULL
        WHERE actor_id IS NOT DISTINCT FROM $1::uuid
          AND scope = $2
          AND key = $3`,
      [actorId, scope, key, responseStatus, responseBody === undefined ? null : responseBody]
    );
  }

  async fail(
    scope: string,
    key: string,
    actorId: string | null,
    responseStatus: number
  ): Promise<void> {
    await this.db.query(
      `UPDATE idempotency_keys
          SET status = 'failed',
              response_status = $4,
              locked_until = NULL
        WHERE actor_id IS NOT DISTINCT FROM $1::uuid
          AND scope = $2
          AND key = $3`,
      [actorId, scope, key, responseStatus]
    );
  }

  async takeOver(
    scope: string,
    key: string,
    actorId: string | null,
    lockedUntil: Date
  ): Promise<void> {
    await this.db.query(
      `UPDATE idempotency_keys
          SET locked_until = $4
        WHERE actor_id IS NOT DISTINCT FROM $1::uuid
          AND scope = $2
          AND key = $3
          AND status = 'in_progress'`,
      [actorId, scope, key, lockedUntil]
    );
  }
}

export const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
export const DEFAULT_LOCK_SECONDS = 30;
export const DEFAULT_RESPONSE_STATUS = 200;

export interface IdempotencyOptions {
  /** Key retention. §7.5: 24h for booking/payment, 7 days for payout. */
  ttlSeconds?: number;
  /** How long an in-progress claim blocks other runners. */
  lockSeconds?: number;
  /** Actor bound to the key; §2.4 scopes keys per actor. */
  actorId?: string | null;
  clock?: Clock;
}

function addSeconds(from: Date, seconds: number): Date {
  return new Date(from.getTime() + seconds * 1000);
}

function validateKey(key: string): void {
  if (typeof key !== 'string' || key.length < 16 || key.length > 80) {
    throw new AppError('VALIDATION_ERROR', 'Idempotency-Key must be 16-80 characters');
  }
}

function validateHash(requestHash: string): void {
  if (typeof requestHash !== 'string' || requestHash.length !== 64) {
    throw new AppError('VALIDATION_ERROR', 'requestHash must be a sha256 hex digest');
  }
}

/** Stable JSON (sorted object keys) so equal payloads hash equal. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

/** sha256 over the canonical JSON form of a request payload (§7.5 step 2). */
export function hashRequest(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

export interface IdempotencyRunOptions {
  /** HTTP status persisted with the response; defaults to 200. */
  responseStatus?: number;
}

export interface IdempotencyRunResult<T> {
  value: T;
  replayed: boolean;
  responseStatus: number;
}

export class IdempotencyService {
  private readonly ttlSeconds: number;
  private readonly lockSeconds: number;
  private readonly actorId: string | null;
  private readonly clock: Clock;

  constructor(
    private readonly store: IdempotencyStore,
    options: IdempotencyOptions = {}
  ) {
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    this.lockSeconds = options.lockSeconds ?? DEFAULT_LOCK_SECONDS;
    this.actorId = options.actorId ?? null;
    this.clock = options.clock ?? new SystemClock();
  }

  async run<T>(
    key: string,
    endpoint: string,
    requestHash: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const result = await this.runWithMeta(key, endpoint, requestHash, fn);
    return result.value;
  }

  /**
   * Like `run`, but also reports whether the response was replayed and which
   * HTTP status was persisted. Callers use this to set `Idempotency-Replayed`
   * and to store 201 for create endpoints.
   */
  async runWithMeta<T>(
    key: string,
    endpoint: string,
    requestHash: string,
    fn: () => Promise<T>,
    options: IdempotencyRunOptions = {}
  ): Promise<IdempotencyRunResult<T>> {
    validateKey(key);
    validateHash(requestHash);
    if (typeof endpoint !== 'string' || endpoint.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'Idempotency scope (endpoint) is required');
    }

    const responseStatus = options.responseStatus ?? DEFAULT_RESPONSE_STATUS;
    const now = this.clock.now();
    const claimed = await this.store.tryClaim({
      scope: endpoint,
      key,
      actorId: this.actorId,
      requestHash,
      lockedUntil: addSeconds(now, this.lockSeconds),
      expiresAt: addSeconds(now, this.ttlSeconds)
    });

    if (!claimed) {
      const record = await this.store.read(endpoint, key, this.actorId);

      // The conflicting row must be visible after the insert conflict; if it is
      // not, the winner has not committed yet and the caller should retry.
      if (!record) {
        throw new AppError('CONFLICT', 'IDEMPOTENCY_IN_PROGRESS: retry shortly');
      }

      if (record.requestHash !== requestHash) {
        throw new AppError(
          'IDEMPOTENCY_MISMATCH',
          'Idempotency-Key was reused with a different request payload'
        );
      }

      if (record.status === 'completed') {
        // Stored JSON response; the generic T is the handler's own result shape.
        return {
          value: record.responseBody as T,
          replayed: true,
          responseStatus: record.responseStatus ?? responseStatus
        };
      }

      if (record.status === 'in_progress') {
        if (record.lockedUntil && record.lockedUntil.getTime() > now.getTime()) {
          throw new AppError('CONFLICT', 'IDEMPOTENCY_IN_PROGRESS: retry shortly');
        }
        // Previous runner crashed mid-flight; take the expired lease over.
        await this.store.takeOver(
          endpoint,
          key,
          this.actorId,
          addSeconds(now, this.lockSeconds)
        );
      }
      // status='failed' is retryable: fall through and execute again.
    }

    try {
      const result = await fn();
      await this.store.complete(endpoint, key, this.actorId, responseStatus, result);
      return { value: result, replayed: false, responseStatus };
    } catch (err) {
      try {
        await this.store.fail(
          endpoint,
          key,
          this.actorId,
          err instanceof AppError ? err.status : 500
        );
      } catch {
        // Preserve the original failure; the store error is secondary.
      }
      throw err;
    }
  }
}
