import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

/**
 * Transactional outbox (TECH-DESIGN-v1.0 §5.14, §2.3 rule 4).
 *
 * `enqueue` must be called with the caller's transaction client so the message
 * commits atomically with the domain change. It never starts or commits a
 * transaction itself.
 */
export interface EnqueueOptions {
  /** Deterministic event id. Supplying it makes retries produce the same row. */
  id?: string;
  /** Defaults to `system`; use the aggregate name, e.g. `booking`. */
  aggregateType?: string;
  /** Defaults to the event id. */
  aggregateId?: string;
  aggregateVersion?: number;
  /** Defaults to `${topic}:${id}`. Unique in `outbox_messages`. */
  dedupeKey?: string;
  /** Delay delivery (worker reads `available_at <= now()`). */
  availableAt?: Date;
}

export interface EnqueuedMessage {
  id: string;
  eventType: string;
  dedupeKey: string;
}

type SqlClient = Pick<PoolClient, 'query'>;

type ExistingRow = {
  id: string;
  event_type: string;
  dedupe_key: string;
};

export async function enqueue(
  client: SqlClient,
  topic: string,
  payload: Record<string, unknown>,
  options: EnqueueOptions = {}
): Promise<EnqueuedMessage> {
  if (typeof topic !== 'string' || topic.length === 0) {
    throw new Error('Outbox topic is required');
  }

  const id = options.id ?? randomUUID();
  const dedupeKey = options.dedupeKey ?? `${topic}:${id}`;

  const inserted = await client.query<ExistingRow>(
    `INSERT INTO outbox_messages
       (id, aggregate_type, aggregate_id, aggregate_version, event_type, payload, dedupe_key, available_at)
     VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6::jsonb, $7, COALESCE($8::timestamptz, now()))
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING id, event_type, dedupe_key`,
    [
      id,
      options.aggregateType ?? 'system',
      options.aggregateId ?? id,
      options.aggregateVersion ?? 1,
      topic,
      JSON.stringify(payload),
      dedupeKey,
      options.availableAt ? options.availableAt.toISOString() : null
    ]
  );

  const insertedRow = inserted.rows[0];
  if (insertedRow) {
    return {
      id: insertedRow.id,
      eventType: insertedRow.event_type,
      dedupeKey: insertedRow.dedupe_key
    };
  }

  // A message with the same dedupe_key already exists in this transaction:
  // return the existing row so callers keep a stable reference.
  const existing = await client.query<ExistingRow>(
    `SELECT id, event_type, dedupe_key FROM outbox_messages WHERE dedupe_key = $1`,
    [dedupeKey]
  );

  const existingRow = existing.rows[0];
  if (!existingRow) {
    throw new Error(`Outbox message ${dedupeKey} conflicted but could not be read back`);
  }

  return {
    id: existingRow.id,
    eventType: existingRow.event_type,
    dedupeKey: existingRow.dedupe_key
  };
}
