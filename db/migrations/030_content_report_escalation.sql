-- ============================================================
-- 030_content_report_escalation — FR-123/FR-124: eskalasi SLA
--
-- `content_reports.sla_due_at` sudah ada sejak migrasi 027 dan dipakai panel
-- untuk menandai laporan lewat SLA. Yang belum: tindakan otomatis. Worker
-- `escalate_reports` menandai laporan terbuka yang melewati SLA dan
-- memberitahu admin support/super.
--
-- `escalated_at` membuat eskalasi:
-- 1. tercatat sekali (UPDATE ... WHERE escalated_at IS NULL), jadi tick worker
--    berikutnya tidak mengirim notifikasi ulang;
-- 2. terlihat di panel tanpa menghitung ulang selisih waktu;
-- 3. tidak mengubah status laporan. Moderator tetap yang memutuskan; eskalasi
--    hanya menaikkan visibilitas.
--
-- Tidak ada data konten atau uang yang disentuh migrasi ini.
-- ============================================================

ALTER TABLE content_reports
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;

COMMENT ON COLUMN content_reports.escalated_at IS
  'Waktu laporan terbuka pertama kali melewati SLA dan dieskalasi worker. NULL = belum.';

-- Worker hanya memindai laporan terbuka yang belum dieskalasi.
CREATE INDEX IF NOT EXISTS content_reports_escalation_idx
  ON content_reports (sla_due_at)
  WHERE status IN ('open', 'reviewing') AND escalated_at IS NULL;
