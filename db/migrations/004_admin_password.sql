-- ============================================================
-- 004_admin_password — login admin dengan email + kata sandi
-- Source: keputusan produk final (admin tanpa TOTP), TECH-DESIGN §7.2 auth.
--
-- Migrasi append-only: `001_core.sql`, `002_fixes.sql` dan `003_auth.sql`
-- sudah ter-checksum dan TIDAK diubah.
--
-- Catatan desain:
--   - `users.email` SUDAH ada sejak 001_core.sql (VARCHAR(150), nullable) dan
--     sudah punya unique index parsial `users_email_lower_uniq` pada
--     lower(email). Karena itu blok di bawah bersifat guard: `ADD COLUMN email`
--     polos akan gagal `42701 duplicate_column` pada database yang sudah
--     menjalankan 001. Index duplikat juga tidak dibuat bila index ekuivalen
--     sudah ada.
--   - `password_hash` menyimpan format `scrypt$<N>$<salt_hex>$<hash_hex>`
--     (node:crypto scrypt). Plaintext TIDAK pernah disimpan.
--   - Kolom password nullable: customer/vendor tetap memakai OTP WhatsApp dan
--     tidak punya kata sandi.
--   - `login_attempts` mencatat setiap percobaan (sukses dan gagal) agar kuota
--     5 kegagalan / email / 10 menit dapat dihitung dari data.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'users'
       AND column_name = 'email'
  ) THEN
    ALTER TABLE users ADD COLUMN email TEXT;
  END IF;
END
$$;

-- 001_core.sql: CREATE UNIQUE INDEX users_email_lower_uniq ON users (lower(email)) WHERE email IS NOT NULL
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_indexes
     WHERE schemaname = current_schema()
       AND tablename = 'users'
       AND indexname IN ('users_email_unique', 'users_email_lower_uniq')
  ) THEN
    CREATE UNIQUE INDEX users_email_unique ON users (lower(email)) WHERE email IS NOT NULL;
  END IF;
END
$$;

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_updated_at TIMESTAMPTZ;

CREATE TABLE login_attempts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL,
  ip         INET,
  succeeded  BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_email_idx ON login_attempts (lower(email), created_at DESC);
