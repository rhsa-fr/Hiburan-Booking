-- ============================================================
-- 031_content_report_appeals — FR-124: banding atas takedown
--
-- Pemilik konten yang diturunkan boleh mengajukan banding sekali per laporan.
-- Banding tidak mengubah keputusan laporan asal (riwayat moderasi tetap utuh);
-- keputusan banding disimpan terpisah dan dicatat di `audit_logs`.
--
-- Prinsip:
-- 1. Satu laporan = maksimal satu banding (`UNIQUE (report_id)`).
-- 2. Alasan banding wajib 20-2000 karakter; keputusan wajib catatan 10-1000.
-- 3. Penerimaan memulihkan ulasan/pesan chat, sedangkan media kembali ke
--    antrean `pending` untuk ditinjau ulang (kolom publiknya sudah dibersihkan
--    saat takedown, jadi publikasi ulang harus lewat jalur moderasi media).
-- 4. Tabel ini tidak menyentuh uang, booking, atau laporan asal.
-- ============================================================

CREATE TABLE IF NOT EXISTS content_report_appeals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id     UUID NOT NULL UNIQUE REFERENCES content_reports(id) ON DELETE CASCADE,
  appellant_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason        TEXT NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 20 AND 2000),
  evidence_url  TEXT CHECK (evidence_url IS NULL OR char_length(evidence_url) <= 2000),
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'accepted', 'rejected')),
  decision_note TEXT,
  decided_by    UUID REFERENCES users(id),
  decided_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT content_report_appeals_decision_consistent CHECK (
    (
      status = 'pending'
      AND decision_note IS NULL
      AND decided_by IS NULL
      AND decided_at IS NULL
    )
    OR
    (
      status IN ('accepted', 'rejected')
      AND decision_note IS NOT NULL
      AND decided_by IS NOT NULL
      AND decided_at IS NOT NULL
      AND char_length(btrim(decision_note)) BETWEEN 10 AND 1000
    )
  )
);

COMMENT ON TABLE content_report_appeals IS
  'FR-124: banding pemilik konten atas keputusan takedown. Keputusan laporan asal tidak diubah.';
COMMENT ON COLUMN content_report_appeals.status IS
  'pending (menunggu) | accepted (konten dipulihkan / media ditinjau ulang) | rejected (takedown dipertahankan).';
COMMENT ON COLUMN content_report_appeals.evidence_url IS
  'Tautan bukti tambahan; unggah berkas privat belum tersedia, jadi hanya URL yang divalidasi.';

CREATE INDEX IF NOT EXISTS content_report_appeals_queue_idx
  ON content_report_appeals (status, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS content_report_appeals_appellant_idx
  ON content_report_appeals (appellant_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_content_report_appeals_updated_at ON content_report_appeals;
CREATE TRIGGER trg_content_report_appeals_updated_at
  BEFORE UPDATE ON content_report_appeals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
