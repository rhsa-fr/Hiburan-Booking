-- ============================================================
-- 038_device_tokens — FCM device registration (push notification)
--
-- One row per FCM registration token. The token is globally UNIQUE on purpose:
-- a device can be signed into a different account later, and a stale owner
-- would keep receiving another person's booking pushes. Registration therefore
-- moves (`re-owns`) the row to the caller instead of inserting a duplicate.
--
-- `push_sink.ts` reads this table per recipient and deletes tokens Firebase
-- reports as permanently invalid (`messaging/registration-token-not-registered`,
-- `messaging/invalid-argument`).
--
-- No money, ledger, or booking status is read or written here.
-- ============================================================

CREATE TABLE IF NOT EXISTS device_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  platform   VARCHAR(16) NOT NULL CHECK (platform IN ('android', 'ios', 'web')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE device_tokens IS
  'FCM registration tokens per account. UNIQUE(token) so a device is owned by exactly one account at a time.';
COMMENT ON COLUMN device_tokens.updated_at IS
  'Moved to now() whenever a client re-registers the same token, so the worker can prefer active devices.';

-- Per-recipient token lookup for the push sink.
CREATE INDEX IF NOT EXISTS device_tokens_user_idx
  ON device_tokens (user_id);
