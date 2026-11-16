-- 033_appeal_evidence_files.sql — FR-124 (bukti banding berupa berkas)
--
-- Sampai migrasi 031, bukti banding hanya `evidence_url` (tautan yang diketik
-- pengaju). Banyak bukti kepemilikan nyata berupa foto/screenshot, jadi berkas
-- perlu disimpan server. Berkas TIDAK disimpan di `/v1/media` (publik): ia masuk
-- `PRIVATE_UPLOAD_DIR` terenkripsi AES-256-GCM dan hanya bisa dibaca pemilik
-- banding atau admin moderasi lewat endpoint ber-guard.
--
-- `evidence_file_path` menyimpan object key internal
-- (`appeal/<report_id>/<uuid>.<ext>`), bukan URL. `evidence_url` tetap ada agar
-- banding lama dan tautan pendukung tidak hilang; keduanya boleh terisi bersamaan.

ALTER TABLE content_report_appeals
  ADD COLUMN IF NOT EXISTS evidence_file_path text;

COMMENT ON COLUMN content_report_appeals.evidence_file_path IS
  'Object key privat bukti banding (FR-124). NULL = hanya evidence_url/tanpa bukti.';
