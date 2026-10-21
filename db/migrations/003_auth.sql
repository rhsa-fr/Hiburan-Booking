-- ============================================================
-- 003_auth — tabel auth yang belum ada di 001_core.sql
-- Source: TECH-DESIGN-v1.0 §5.14 (sessions, otp_requests), §9.1 (OTP/JWT).
--
-- Migrasi append-only: `001_core.sql` dan `002_fixes.sql` sudah ter-checksum
-- dan TIDAK diubah. Blok ini hanya menambah, tidak mengubah tabel lama.
--
-- Catatan desain:
--   - OTP disimpan HANYA sebagai `code_hash` (CHAR(64) = sha256 hex);
--     plaintext tidak pernah masuk database.
--   - `sessions.jti` adalah id token (UUID) yang dipakai untuk revocation;
--     access token membawa `sub` + `roles`, sesi menyimpan `jti`-nya.
--   - Kolom `channel`/`attempts` dijaga CHECK agar nilai rusak tidak masuk.
-- ============================================================

CREATE TABLE otp_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone        VARCHAR(20) NOT NULL,
  code_hash    CHAR(64) NOT NULL,
  channel      VARCHAR(16) NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp','sms')),
  attempts     SMALLINT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts SMALLINT NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ,
  requester_ip INET,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX otp_requests_phone_idx ON otp_requests (phone, created_at DESC);
CREATE INDEX otp_requests_expiry_idx ON otp_requests (expires_at);

CREATE TABLE sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  jti        UUID NOT NULL UNIQUE,
  issued_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  user_agent TEXT,
  ip         INET,
  CHECK (expires_at > issued_at)
);
CREATE INDEX sessions_user_expiry_idx ON sessions (user_id, expires_at DESC);
