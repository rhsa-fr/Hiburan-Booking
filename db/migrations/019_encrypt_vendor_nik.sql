-- ============================================================
-- 019_encrypt_vendor_nik — stop storing NIK as plaintext
--
-- The KTP file was already encrypted; the NIK string was not. New rows write
-- `nik_ciphertext` (AES-256-GCM, same key ring as the KTP file) and leave
-- `nik` NULL. Legacy rows are re-encrypted lazily when the admin queue reads
-- them, then the plaintext column is cleared for that row.
--
-- The column is kept (nullable) instead of dropped so an operator can verify
-- the backfill finished before removing it in a later migration.
-- ============================================================

ALTER TABLE vendor_applications ADD COLUMN IF NOT EXISTS nik_ciphertext BYTEA;
ALTER TABLE vendor_applications ADD COLUMN IF NOT EXISTS nik_key_id TEXT;
ALTER TABLE vendor_applications ALTER COLUMN nik DROP NOT NULL;
