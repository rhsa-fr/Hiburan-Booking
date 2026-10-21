import { query } from '../db';
import { errorMessage, logLine } from '../log';
import type { JobStats } from './runner';

export interface OutboxMessage {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempts: number;
}

/** Delivery boundary. The provider (WA/push/webhook relay) plugs in here later. */
export interface MessageSink {
  send(message: OutboxMessage): Promise<void>;
}

/** Default sink: no provider exists yet, so delivery is a structured log line. */
export class LoggingMessageSink implements MessageSink {
  async send(message: OutboxMessage): Promise<void> {
    logLine(
      `outbox_dispatch id=${message.id} event=${message.event_type} aggregate=${message.aggregate_type}:${message.aggregate_id} attempt=${message.attempts + 1}`
    );
  }
}

// Real columns (001_core.sql): there is no `published_at` and no `dispatched_at`.
// Delivery success is `status='sent'` + `sent_at`; `failed` stays retryable.
const SELECT_DUE_SQL = `
SELECT id, aggregate_type, aggregate_id, event_type, payload, attempts
  FROM outbox_messages
 WHERE status IN ('pending','failed')
   AND available_at <= now()
 ORDER BY available_at, id
 LIMIT $1
`;

const MARK_SENT_SQL = `
UPDATE outbox_messages
   SET status = 'sent',
       sent_at = now(),
       attempts = attempts + 1,
       last_error = NULL
 WHERE id = $1
   AND status IN ('pending','failed')
`;

const MARK_FAILED_SQL = `
UPDATE outbox_messages
   SET status = 'failed',
       attempts = attempts + 1,
       last_error = $2,
       available_at = now() + ($3::int * interval '1 second')
 WHERE id = $1
   AND status IN ('pending','failed')
`;

/** §8.4 rule 4: min(5s * 2^attempts, 15 minutes). */
function retryDelaySeconds(attempts: number): number {
  return Math.min(5 * 2 ** Math.max(attempts, 0), 900);
}

/**
 * Relay: reads committed outbox messages and hands them to the sink. A sink
 * failure is never swallowed — the message stays `failed` with `attempts+1`,
 * `last_error` and a backoff in `available_at`, so it is retried next ticks.
 */
export async function runOutbox(
  batch: number,
  sink: MessageSink = new LoggingMessageSink()
): Promise<JobStats> {
  const rows = await query<OutboxMessage>(SELECT_DUE_SQL, [batch]);
  const stats: JobStats = { processed: 0, skipped: 0, failed: 0 };

  for (const message of rows) {
    try {
      await sink.send(message);
      await query(MARK_SENT_SQL, [message.id]);
      stats.processed += 1;
    } catch (err) {
      stats.failed += 1;
      const reason = errorMessage(err);
      try {
        await query(MARK_FAILED_SQL, [message.id, reason, retryDelaySeconds(message.attempts)]);
      } catch (updateErr) {
        logLine(`job=outbox failed=1 message=${message.id} error=${errorMessage(updateErr)}`);
      }
      logLine(`job=outbox failed=1 message=${message.id} event=${message.event_type} error=${reason}`);
    }
  }

  return stats;
}
