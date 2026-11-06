-- ============================================================
-- 018_notifications — in-app notifications
--
-- Replaces the WhatsApp/push delivery stub: the worker outbox relay now
-- writes one row per recipient instead of logging the message. The mobile
-- app polls `/v1/notifications` and shows the newest unread row as a popup.
--
-- Notifications are product state, not money state: they carry no balances and
-- no journal references. Delivery is idempotent through `dedupe_key`.
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key  TEXT NOT NULL,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per (outbox message, recipient): a retried relay never duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_uniq
  ON notifications (dedupe_key);

CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;
