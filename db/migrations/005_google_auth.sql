-- ============================================================
-- 005_google_auth — Google Sign-In sebagai identitas tambahan
-- Source: keputusan produk final (email+password untuk semua role, Google
--         Sign-In opsional untuk semua role).
--
-- Migrasi append-only: `001_core.sql` .. `004_admin_password.sql` sudah
-- ter-checksum dan TIDAK diubah.
--
-- Catatan desain:
--   - `google_sub` adalah klaim `sub` dari ID token Google; unik bila terisi.
--   - `email_verified_at` dicatat saat email terbukti (Google) atau NULL untuk
--     registrasi email+password biasa.
--   - `users.phone` dilonggarkan menjadi nullable: user yang mendaftar lewat
--     Google tidak punya nomor HP, sedangkan 001 mendefinisikan
--     `phone VARCHAR(20) NOT NULL`. UNIQUE tetap berlaku (banyak NULL sah),
--     sehingga satu nomor tetap hanya boleh dimiliki satu user. OTP hanya
--     mencari user dengan phone terisi.
-- ============================================================

ALTER TABLE users ADD COLUMN google_sub TEXT;
CREATE UNIQUE INDEX users_google_sub_unique ON users (google_sub) WHERE google_sub IS NOT NULL;

ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMPTZ;

ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;
