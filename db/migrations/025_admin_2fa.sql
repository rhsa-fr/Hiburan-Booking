-- ============================================================
-- 025_admin_2fa — FR-128 fondasi 2FA admin (TOTP + backup code)
--
-- Migrasi ini hanya menyiapkan penyimpanan. Login BELUM berubah: penerbitan
-- sesi tetap seperti sebelumnya sampai packet berikutnya.
--
-- Keputusan yang dijaga skema:
-- 1. Secret TOTP TIDAK pernah plaintext. Disimpan sebagai BYTEA hasil
--    AES-256-GCM (IV 12 byte || tag 16 byte || ciphertext) dengan
--    `TOTP_ENCRYPTION_KEY`. `totp_key_id` menyimpan id kunci aktif saat
--    menulis, sehingga rotasi bisa mendekripsi baris lama tanpa menulis ulang.
-- 2. Backup code disimpan hanya sebagai hash sha256 (sekali pakai). Plaintext
--    hanya ditampilkan sekali saat enroll dan tidak bisa dipulihkan dari DB.
-- 3. Challenge login adalah token acak; yang disimpan hanya hash sha256-nya.
--    `attempts` dibatasi `max_attempts` di service (bukan trigger) supaya
--    pesan ke pengguna konsisten; CHECK di sini menjaga nilai tidak negatif.
-- 4. `login_attempts.stage` memisahkan kegagalan kata sandi, TOTP dan sesi
--    agar kuota per tahap tidak saling memakan.
--
-- Idempoten: seluruh DDL memakai IF NOT EXISTS / guard pg_constraint sehingga
-- aman dijalankan pada database yang sudah memiliki 001-024.
--
-- DOWN: hapus tabel `admin_2fa_challenges`, `admin_backup_codes`, lalu kolom
-- baru di `users` dan `login_attempts`. Tidak ada data uang di sini.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Kolom 2FA pada users
-- ------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret_encrypted BYTEA;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_key_id VARCHAR(40);
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enrolled_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enforced_at TIMESTAMPTZ;

COMMENT ON COLUMN users.totp_secret_encrypted IS
  'Secret TOTP terenkripsi AES-256-GCM (IV 12 || tag 16 || ciphertext). Plaintext tidak pernah disimpan.';
COMMENT ON COLUMN users.totp_key_id IS
  'Id kunci enkripsi (TOTP_KEY_ID) yang dipakai saat menulis totp_secret_encrypted, untuk rotasi kunci.';
COMMENT ON COLUMN users.totp_enrolled_at IS
  'Waktu admin menyelesaikan enrollment TOTP; NULL berarti belum pernah enroll.';
COMMENT ON COLUMN users.two_factor_enabled IS
  'True setelah TOTP terverifikasi. Login admin wajib melewati TOTP bila true.';
COMMENT ON COLUMN users.two_factor_enforced_at IS
  'Waktu 2FA mulai diwajibkan untuk akun ini (cutover FR-128), NULL bila belum diwajibkan.';

-- ------------------------------------------------------------
-- 2. Backup code sekali pakai
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_backup_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT admin_backup_codes_user_code_uniq UNIQUE (user_id, code_hash)
);

COMMENT ON TABLE admin_backup_codes IS
  'Kode cadangan 2FA admin, hanya hash sha256; plaintext ditampilkan sekali saat enrollment.';
COMMENT ON COLUMN admin_backup_codes.code_hash IS
  'sha256 hex dari kode yang dinormalisasi (huruf besar, tanpa tanda hubung). Tidak reversibel.';
COMMENT ON COLUMN admin_backup_codes.used_at IS
  'Waktu kode dipakai; kode dengan used_at terisi tidak boleh diterima lagi.';

-- Hanya kode yang belum terpakai yang dicari saat verifikasi.
CREATE INDEX IF NOT EXISTS admin_backup_codes_unused_idx
  ON admin_backup_codes (user_id)
  WHERE used_at IS NULL;

-- ------------------------------------------------------------
-- 3. Challenge login (enroll / verify)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_2fa_challenges (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         VARCHAR(10) NOT NULL CHECK (kind IN ('enroll', 'verify')),
  token_hash   TEXT NOT NULL UNIQUE,
  attempts     INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INT NOT NULL DEFAULT 6,
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ,
  requester_ip INET,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE admin_2fa_challenges IS
  'Tiket sementara antara langkah kata sandi dan langkah TOTP; sekali pakai dan berbatas waktu.';
COMMENT ON COLUMN admin_2fa_challenges.kind IS
  'enroll = admin belum punya TOTP; verify = TOTP sudah aktif dan diminta saat login.';
COMMENT ON COLUMN admin_2fa_challenges.token_hash IS
  'sha256 hex dari token challenge; token asli hanya dikirim ke klien.';
COMMENT ON COLUMN admin_2fa_challenges.attempts IS
  'Jumlah percobaan TOTP yang gagal untuk challenge ini; ditolak setelah max_attempts.';
COMMENT ON COLUMN admin_2fa_challenges.max_attempts IS
  'Batas percobaan sebelum challenge dianggap terkunci.';
COMMENT ON COLUMN admin_2fa_challenges.expires_at IS
  'Batas waktu challenge; setelah lewat, token tidak boleh dipakai lagi.';
COMMENT ON COLUMN admin_2fa_challenges.consumed_at IS
  'Waktu challenge dipakai; token dengan consumed_at terisi tidak bisa dipakai ulang.';
COMMENT ON COLUMN admin_2fa_challenges.requester_ip IS
  'IP peminta challenge untuk rate limit dan audit.';
COMMENT ON COLUMN admin_2fa_challenges.user_agent IS
  'User-Agent peminta challenge untuk audit.';

CREATE INDEX IF NOT EXISTS admin_2fa_challenges_user_expiry_idx
  ON admin_2fa_challenges (user_id, expires_at);

-- Antrean pembersihan: hanya challenge yang belum dipakai.
CREATE INDEX IF NOT EXISTS admin_2fa_challenges_open_idx
  ON admin_2fa_challenges (expires_at)
  WHERE consumed_at IS NULL;

-- ------------------------------------------------------------
-- 4. Tahap percobaan login
-- ------------------------------------------------------------
ALTER TABLE login_attempts ADD COLUMN IF NOT EXISTS stage VARCHAR(16) NOT NULL DEFAULT 'password';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'login_attempts_stage_check'
  ) THEN
    ALTER TABLE login_attempts ADD CONSTRAINT login_attempts_stage_check
      CHECK (stage IN ('password', 'totp', 'session'));
  END IF;
END $$;

COMMENT ON COLUMN login_attempts.stage IS
  'Tahap login yang dicatat: password, totp atau session. Kuota dihitung per tahap.';
