-- 037: OTP bertujuan (login / pendaftaran / reset kata sandi) dan token reset.
--
-- Sebelumnya `otp_requests` hanya berarti "kode login untuk email ini". Dua alur
-- baru memakai tabel yang sama supaya kuota, masa berlaku, dan batas percobaan
-- tidak bercabang:
--   - 'register'       : verifikasi email sebelum baris `users` dibuat;
--   - 'password_reset' : bukti kepemilikan email sebelum kata sandi diganti.
-- `metadata` menyimpan data pendaftaran yang belum jadi user (nama, telepon,
-- hash kata sandi, consent). Kata sandi plaintext tidak pernah masuk sini.
--
-- `password_reset_tokens` menyimpan HANYA sha256 hex dari token 32 byte; token
-- plaintext tidak pernah masuk database dan hanya sekali pakai.

ALTER TABLE otp_requests
  ADD COLUMN IF NOT EXISTS purpose VARCHAR(24) NOT NULL DEFAULT 'login';

ALTER TABLE otp_requests
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'otp_requests_purpose_check'
  ) THEN
    ALTER TABLE otp_requests
      ADD CONSTRAINT otp_requests_purpose_check
      CHECK (purpose IN ('login', 'register', 'password_reset'));
  END IF;
END
$$;

-- Setiap pembacaan OTP memfilter (email, purpose) lalu mengambil yang terbaru.
CREATE INDEX IF NOT EXISTS otp_requests_email_purpose_idx
  ON otp_requests (lower(email), purpose, created_at DESC);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  CHAR(64) NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_expiry_idx
  ON password_reset_tokens (user_id, expires_at);

-- Akun yang sudah ada tidak boleh terkunci oleh aturan `email_verified_at`.
-- Login berbasis OTP email sudah membuktikan kepemilikan alamat tersebut, jadi
-- seluruh baris lama dianggap terverifikasi pada waktu pembuatannya.
UPDATE users
   SET email_verified_at = COALESCE(created_at, now())
 WHERE email_verified_at IS NULL;

COMMENT ON COLUMN otp_requests.purpose IS
  'Tujuan kode: login, register, atau password_reset.';
COMMENT ON COLUMN otp_requests.metadata IS
  'Data sementara untuk purpose tertentu (mis. pendaftaran yang belum jadi user).';
COMMENT ON TABLE password_reset_tokens IS
  'Token reset kata sandi sekali pakai; hanya sha256 hex yang disimpan.';
