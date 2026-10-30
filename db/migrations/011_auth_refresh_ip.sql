-- 011: Refresh token panjang + rate limit per IP (TECH-DESIGN §9.1).
--
-- Sebelumnya `sessions.expires_at` = TTL access token (15 menit), sehingga
-- sesi mati saat cold start. Sekarang baris sesi hidup selama refresh TTL
-- (REFRESH_TTL_DAYS, default 30 hari); access token tetap 15 menit.
--
-- `refresh_token_hash` menyimpan sha256 token opaque — plaintext tidak pernah
-- disimpan. `family_id`/`parent_id`/`rotated_at` dipakai untuk rotasi dan
-- deteksi reuse (token lama yang dipakai lagi -> seluruh family dicabut).

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS refresh_token_hash CHAR(64),
  ADD COLUMN IF NOT EXISTS refresh_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS family_id UUID,
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rotated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoke_reason TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS sessions_refresh_hash_uniq
  ON sessions (refresh_token_hash)
  WHERE refresh_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS sessions_family_idx ON sessions (family_id);

-- Limiter per IP membaca kolom ip/requester_ip; tanpa index ini setiap
-- percobaan login memindai seluruh tabel yang tumbuh tanpa batas.
CREATE INDEX IF NOT EXISTS login_attempts_ip_idx
  ON login_attempts (ip, created_at DESC)
  WHERE ip IS NOT NULL;

CREATE INDEX IF NOT EXISTS otp_requests_requester_ip_idx
  ON otp_requests (requester_ip, created_at DESC)
  WHERE requester_ip IS NOT NULL;
