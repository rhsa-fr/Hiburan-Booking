import { cert, getApps, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import { getMessaging, type BatchResponse } from 'firebase-admin/messaging';
import { planNotification } from '@tarlink/modules/notifications';
import type { QueryResultRow } from 'pg';
import { query } from '../db';
import { errorMessage, logLine } from '../log';
import type { MessageSink, OutboxMessage } from './outbox';

/**
 * Push delivery (FCM) for every event the in-app sink also writes.
 *
 * Guarantees:
 * 1. At most one push per (outbox message, recipient). The `notification_deliveries`
 *    claim (`channel='push'`) is copied from `EmailNotificationSink`: it is
 *    inserted before the provider call, only a `failed` row or a `sending` row
 *    older than 10 minutes can be claimed again, so a retried relay cannot send
 *    the same notification twice.
 * 2. A missing `FCM_SERVICE_ACCOUNT_JSON` makes the sink a no-op: no claim, no
 *    provider call, no throw. In-app and email delivery must not depend on
 *    Firebase being configured.
 * 3. Tokens Firebase reports as permanently invalid are deleted from
 *    `device_tokens`; a dead token must not leak into every later send.
 * 4. Logs carry counts only — never the service account, a token, or a payload.
 */

/** Narrow view of the DB so the sink stays unit-testable without Postgres. */
export interface PushSinkDatabase {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[]
  ): Promise<T[]>;
}

export interface PushMessage {
  tokens: string[];
  title: string;
  body: string;
  data: Record<string, string>;
}

export interface PushSendResponse {
  success: boolean;
  error?: { code: string; message: string };
}

export interface PushBatchResult {
  successCount: number;
  responses: PushSendResponse[];
}

/** Provider boundary; the production implementation wraps `firebase-admin`. */
export interface PushMessenger {
  send(message: PushMessage): Promise<PushBatchResult>;
}

export interface PushSinkOptions {
  /** Raw service-account JSON or its base64 encoding. Absent = no-op sink. */
  serviceAccountJson?: string;
  /** Falls back to the service account's own `project_id`. */
  projectId?: string;
  /** Injected by tests; production builds the Firebase messenger lazily. */
  messenger?: PushMessenger;
  db?: PushSinkDatabase;
}

interface BookingRecipients extends QueryResultRow {
  customer_id: string | null;
  vendor_owner_id: string | null;
}

interface DeviceTokenRow extends QueryResultRow {
  token: string;
}

interface DeliveryClaimRow extends QueryResultRow {
  id: string;
}

const RECIPIENTS_SQL = `
SELECT b.customer_id::text   AS customer_id,
       v.owner_user_id::text AS vendor_owner_id
  FROM bookings b
  JOIN vendors v ON v.id = b.vendor_id
 WHERE b.id = $1::uuid
`;

const TOKENS_SQL = `
SELECT token
  FROM device_tokens
 WHERE user_id = $1::uuid
 ORDER BY updated_at DESC
`;

/**
 * Same claim semantics as the email sink, different `channel`. `sending` older
 * than 10 minutes belongs to a dead worker and is reclaimed.
 */
const CLAIM_SQL = `
INSERT INTO notification_deliveries (channel, outbox_message_id, user_id, status)
VALUES ('push', $1::uuid, $2::uuid, 'sending')
ON CONFLICT (channel, outbox_message_id, user_id) DO UPDATE
   SET status = 'sending',
       attempts = notification_deliveries.attempts + 1,
       last_error = NULL,
       updated_at = now()
 WHERE notification_deliveries.status = 'failed'
    OR (notification_deliveries.status = 'sending'
        AND notification_deliveries.updated_at < now() - interval '10 minutes')
RETURNING id
`;

const MARK_SENT_SQL = `
UPDATE notification_deliveries
   SET status = 'sent',
       sent_at = now(),
       updated_at = now(),
       last_error = NULL
 WHERE id = $1::uuid
`;

const MARK_FAILED_SQL = `
UPDATE notification_deliveries
   SET status = 'failed',
       last_error = $2,
       updated_at = now()
 WHERE id = $1::uuid
`;

const DELETE_TOKENS_SQL = `
DELETE FROM device_tokens
 WHERE token = ANY($1::text[])
`;

/** Dead tokens: retrying them can never succeed, so stop storing them. */
const PERMANENT_FAILURE_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-argument'
]);

/**
 * Lazily built once per process: the worker reads its env at boot, so the
 * credential cannot change between ticks. Keyed by the config value so a
 * different value re-initialises instead of reusing stale credentials.
 */
let cachedMessenger: { key: string; messenger: PushMessenger } | null = null;

function resolveMessenger(options: PushSinkOptions): PushMessenger | null {
  if (options.messenger) return options.messenger;

  const raw = options.serviceAccountJson?.trim();
  if (!raw) return null;

  const key = `${raw}\u0000${options.projectId ?? ''}`;
  if (cachedMessenger?.key === key) return cachedMessenger.messenger;

  const messenger = createFirebaseMessenger(parseServiceAccount(raw), options.projectId);
  cachedMessenger = { key, messenger };
  return messenger;
}

function createFirebaseMessenger(
  serviceAccount: ServiceAccount,
  projectId: string | undefined
): PushMessenger {
  // A single worker process has exactly one credential; reuse an app created
  // earlier in the process instead of failing with "app already exists".
  const app =
    getApps()[0] ??
    initializeApp({
      credential: cert(serviceAccount),
      ...(projectId ? { projectId } : {})
    });
  const messaging = getMessaging(app);

  return {
    async send(message: PushMessage): Promise<PushBatchResult> {
      const result: BatchResponse = await messaging.sendEachForMulticast({
        tokens: message.tokens,
        notification: { title: message.title, body: message.body },
        data: message.data
      });
      return result;
    }
  };
}

/**
 * Accepts the raw JSON or its base64 encoding and normalises it to the SDK's
 * camelCase shape. Field values never appear in errors.
 */
function parseServiceAccount(raw: string): ServiceAccount {
  let parsed: unknown;
  try {
    const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    parsed = JSON.parse(text);
  } catch {
    throw new Error('FCM_SERVICE_ACCOUNT_JSON is not valid JSON or base64-encoded JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('FCM_SERVICE_ACCOUNT_JSON must be a JSON object');
  }

  const record = parsed as Record<string, unknown>;
  const projectId = firstString(record.project_id, record.projectId);
  const clientEmail = firstString(record.client_email, record.clientEmail);
  const privateKey = firstString(record.private_key, record.privateKey);
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'FCM_SERVICE_ACCOUNT_JSON is missing project_id, client_email or private_key'
    );
  }
  return { projectId, clientEmail, privateKey };
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return undefined;
}

export class PushSink implements MessageSink {
  private readonly db: PushSinkDatabase;

  constructor(private readonly options: PushSinkOptions = {}) {
    this.db = options.db ?? { query };
  }

  async send(message: OutboxMessage): Promise<void> {
    const plan = planNotification(message.event_type, message.payload);
    if (!plan) return;

    const bookingId = message.payload.booking_id;
    if (typeof bookingId !== 'string' || bookingId.length === 0) return;

    // Resolve the provider before claiming anything: an unconfigured (or
    // misconfigured) credential must not leave a `sending` row behind.
    const messenger = resolveMessenger(this.options);
    if (!messenger) return;

    const rows = await this.db.query<BookingRecipients>(RECIPIENTS_SQL, [bookingId]);
    const recipientIds = this.recipientsFor(rows[0], plan.audience);
    if (recipientIds.length === 0) return;

    const data: Record<string, string> = { type: message.event_type, booking_id: bookingId };
    const failures: string[] = [];

    for (const userId of recipientIds) {
      const tokenRows = await this.db.query<DeviceTokenRow>(TOKENS_SQL, [userId]);
      const tokens = tokenRows
        .map((row) => row.token)
        .filter((token): token is string => typeof token === 'string' && token.length > 0);
      // No registered device: nothing to send, so no claim either.
      if (tokens.length === 0) continue;

      const claim = await this.db.query<DeliveryClaimRow>(CLAIM_SQL, [message.id, userId]);
      const deliveryId = claim[0]?.id;
      if (!deliveryId) continue; // already sent, or claimed by a live worker

      try {
        const result = await messenger.send({
          tokens,
          title: plan.title,
          body: plan.body,
          data
        });

        const invalid = this.invalidTokens(tokens, result);
        if (invalid.length > 0) {
          await this.db.query(DELETE_TOKENS_SQL, [invalid]);
        }

        const retryable = result.responses.filter(
          (response) => !response.success && !isPermanentFailure(response.error?.code)
        );
        if (retryable.length > 0) {
          const reason = retryable[0]?.error?.message ?? 'push provider rejected the message';
          await this.db.query(MARK_FAILED_SQL, [deliveryId, reason]);
          failures.push(reason);
          logLine(
            `push_failed message=${message.id} event=${message.event_type} tokens=${tokens.length} retryable=${retryable.length} invalid=${invalid.length}`
          );
        } else {
          await this.db.query(MARK_SENT_SQL, [deliveryId]);
          logLine(
            `push_sent message=${message.id} event=${message.event_type} tokens=${tokens.length} invalid=${invalid.length}`
          );
        }
      } catch (err) {
        const reason = errorMessage(err);
        failures.push(reason);
        try {
          await this.db.query(MARK_FAILED_SQL, [deliveryId, reason]);
        } catch (updateErr) {
          logLine(
            `push_delivery_mark_failed_error message=${message.id} error=${errorMessage(updateErr)}`
          );
        }
        logLine(`push_failed message=${message.id} event=${message.event_type} error=${reason}`);
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `push delivery failed for ${failures.length} of ${recipientIds.length} recipient(s): ${failures[0]}`
      );
    }
  }

  /** Mirrors `NotificationSink`: the audience decides who receives the event. */
  private recipientsFor(
    row: BookingRecipients | undefined,
    audience: 'customer' | 'vendor' | 'both'
  ): string[] {
    if (!row) return [];
    const userIds = new Set<string>();
    if (audience !== 'vendor' && row.customer_id) userIds.add(row.customer_id);
    if (audience !== 'customer' && row.vendor_owner_id) userIds.add(row.vendor_owner_id);
    return [...userIds];
  }

  /** `responses` is aligned with `tokens`; only permanent failures are dropped. */
  private invalidTokens(tokens: string[], result: PushBatchResult): string[] {
    const invalid: string[] = [];
    for (const [index, response] of result.responses.entries()) {
      const token = tokens[index];
      if (!token || response.success) continue;
      if (isPermanentFailure(response.error?.code)) invalid.push(token);
    }
    return invalid;
  }
}

function isPermanentFailure(code: string | undefined): boolean {
  return code !== undefined && PERMANENT_FAILURE_CODES.has(code);
}
