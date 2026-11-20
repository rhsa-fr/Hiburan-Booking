-- ============================================================
-- 029_reconciliation_resolve — FR-131 fase 2: tindak lanjut temuan
--
-- Fase 1 (migrasi 024) hanya mencatat temuan. Fase 2 menambahkan **keputusan**
-- atas setiap temuan tanpa menyentuh uang:
--
-- 1. `resolution` menyimpan jenis penyelesaian: `accepted` (selisih diterima
--    dan didokumentasikan), `ignored` (bukan temuan nyata), `referred`
--    (diteruskan ke finance/provider), `corrected` (dibetulkan di luar modul
--    ini — modul rekonsiliasi tetap read-only terhadap ledger).
-- 2. Keputusan wajib punya catatan (CHECK lama sudah menuntut >=5 karakter
--    saat `resolved_at` diisi) dan pelakunya (`resolved_by`).
-- 3. Tidak ada jurnal, `payments`, `payouts`, atau `refunds` yang diubah oleh
--    migrasi ini. Temuan yang sudah selesai tetap tersimpan; koreksi hanya
--    mengisi kolom keputusan.
--
-- Idempoten: ADD COLUMN IF NOT EXISTS + constraint dicek dari katalog
-- (`pg_constraint`) karena PostgreSQL 15 belum punya ADD CONSTRAINT IF NOT
-- EXISTS. Baris lama yang sudah resolved (tidak ada di fase 1) di-backfill
-- `accepted` sebelum constraint konsistensi dipasang.
-- ============================================================

ALTER TABLE reconciliation_diffs
  ADD COLUMN IF NOT EXISTS resolution TEXT;

COMMENT ON COLUMN reconciliation_diffs.resolution IS
  'Keputusan admin atas temuan: accepted/ignored/referred/corrected. NULL = belum diselesaikan.';

UPDATE reconciliation_diffs
   SET resolution = 'accepted'
 WHERE resolved_at IS NOT NULL
   AND resolution IS NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reconciliation_diffs_resolution_valid'
  ) THEN
    ALTER TABLE reconciliation_diffs
      ADD CONSTRAINT reconciliation_diffs_resolution_valid
      CHECK (resolution IS NULL OR resolution IN ('accepted', 'ignored', 'referred', 'corrected'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reconciliation_diffs_resolution_consistent'
  ) THEN
    ALTER TABLE reconciliation_diffs
      ADD CONSTRAINT reconciliation_diffs_resolution_consistent
      CHECK ((resolved_at IS NULL) = (resolution IS NULL));
  END IF;
END $$;

-- Panel menampilkan temuan yang belum selesai per run; index 024 sudah
-- mencakup (resolved_at IS NULL) lewat due_at, ini menambah jalur per run.
CREATE INDEX IF NOT EXISTS reconciliation_diffs_open_run_idx
  ON reconciliation_diffs (run_id, severity, created_at)
  WHERE resolved_at IS NULL;
