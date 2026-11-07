-- ============================================================
-- 024_reconciliation — FR-131 rekonsiliasi harian (gateway ↔ ledger)
--
-- Keputusan yang dijaga skema:
-- 1. Satu run per (provider, scope, tanggal laporan WIB). Idempotensi di level
--    DB lewat UNIQUE, sehingga dua tick worker / dua klik admin tidak pernah
--    menghasilkan dua run untuk periode yang sama.
-- 2. Rekonsiliasi TIDAK memposting jurnal. Tabel ini hanya catatan temuan;
--    `journal_entries` tetap append-only dan tidak disentuh (D-03 di plan.md).
-- 3. Setiap selisih > toleransi menjadi baris `reconciliation_diffs` dengan
--    SLA (`due_at`). Selisih ≤ toleransi (default Rp1.000, khusus selisih fee)
--    tetap tercatat sebagai `fee_mismatch`, bukan diposting otomatis.
-- 4. `external_id` boleh NULL (temuan tanpa id provider); UNIQUE NULLS NOT
--    DISTINCT memastikan baris kembar tetap ditolak.
--
-- Zona waktu: `report_date` adalah tanggal kalender Asia/Jakarta (WIB), bukan
-- UTC. Semua query periode wajib memakai `AT TIME ZONE 'Asia/Jakarta'`.
--
-- DOWN: hapus `reconciliation_diffs` lalu `reconciliation_runs`; tipenya
-- dibiarkan (aman, tidak dipakai objek lain). Tidak ada data uang di sini.
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'recon_run_status') THEN
    CREATE TYPE recon_run_status AS ENUM ('running', 'balanced', 'discrepancy', 'failed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'recon_scope') THEN
    CREATE TYPE recon_scope AS ENUM ('payment', 'payout', 'refund');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'recon_classification') THEN
    CREATE TYPE recon_classification AS ENUM (
      'matched',
      'duplicate',
      'missing_in_ledger',
      'missing_at_gateway',
      'amount_mismatch',
      'fee_mismatch',
      'unverified'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'recon_severity') THEN
    CREATE TYPE recon_severity AS ENUM ('info', 'warning', 'critical');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          VARCHAR(30) NOT NULL,
  scope             recon_scope NOT NULL,
  report_date       DATE NOT NULL,
  status            recon_run_status NOT NULL DEFAULT 'running',
  report_source     VARCHAR(30) NOT NULL DEFAULT 'webhook_events'
                      CHECK (report_source IN ('webhook_events', 'gateway_api', 'manual')),
  gateway_total_idr BIGINT NOT NULL DEFAULT 0,
  ledger_total_idr  BIGINT NOT NULL DEFAULT 0,
  diff_idr          BIGINT NOT NULL DEFAULT 0,
  diff_count        INT NOT NULL DEFAULT 0 CHECK (diff_count >= 0),
  matched_count     INT NOT NULL DEFAULT 0 CHECK (matched_count >= 0),
  checked_count     INT NOT NULL DEFAULT 0 CHECK (checked_count >= 0),
  triggered_by      UUID REFERENCES users(id) ON DELETE RESTRICT,
  trigger_source    VARCHAR(16) NOT NULL DEFAULT 'worker'
                      CHECK (trigger_source IN ('worker', 'admin', 'manual')),
  error_message     TEXT,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, scope, report_date),
  CHECK (finished_at IS NULL OR finished_at >= started_at),
  CHECK (status <> 'balanced' OR diff_count = 0),
  CHECK (status <> 'failed' OR error_message IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS reconciliation_runs_date_idx
  ON reconciliation_runs (report_date DESC, provider, scope);

CREATE INDEX IF NOT EXISTS reconciliation_runs_open_idx
  ON reconciliation_runs (status, started_at)
  WHERE status IN ('running', 'failed');

CREATE TABLE IF NOT EXISTS reconciliation_diffs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id             UUID NOT NULL REFERENCES reconciliation_runs(id) ON DELETE RESTRICT,
  classification     recon_classification NOT NULL,
  severity           recon_severity NOT NULL DEFAULT 'warning',
  external_id        VARCHAR(160),
  webhook_event_id   UUID REFERENCES webhook_events(id) ON DELETE RESTRICT,
  payment_id         UUID REFERENCES payments(id) ON DELETE RESTRICT,
  refund_id          UUID REFERENCES refunds(id) ON DELETE RESTRICT,
  payout_id          UUID REFERENCES payouts(id) ON DELETE RESTRICT,
  booking_id         UUID REFERENCES bookings(id) ON DELETE RESTRICT,
  gateway_amount_idr BIGINT,
  ledger_amount_idr  BIGINT,
  delta_idr          BIGINT,
  detail             JSONB NOT NULL DEFAULT '{}'::jsonb,
  due_at             TIMESTAMPTZ,
  resolved_by        UUID REFERENCES users(id) ON DELETE RESTRICT,
  resolved_at        TIMESTAMPTZ,
  resolution_note    TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (run_id, classification, external_id),
  CHECK (gateway_amount_idr IS NULL OR ledger_amount_idr IS NULL
         OR delta_idr = gateway_amount_idr - ledger_amount_idr),
  CHECK (resolved_at IS NULL OR resolved_by IS NOT NULL),
  CHECK (resolved_at IS NULL OR (resolution_note IS NOT NULL AND length(btrim(resolution_note)) >= 5)),
  CHECK (resolved_at IS NOT NULL OR resolution_note IS NULL)
);

CREATE INDEX IF NOT EXISTS reconciliation_diffs_run_idx
  ON reconciliation_diffs (run_id, classification);

CREATE INDEX IF NOT EXISTS reconciliation_diffs_open_idx
  ON reconciliation_diffs (due_at, created_at)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS reconciliation_diffs_booking_idx
  ON reconciliation_diffs (booking_id)
  WHERE booking_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_reconciliation_diffs_updated_at ON reconciliation_diffs;
CREATE TRIGGER trg_reconciliation_diffs_updated_at
  BEFORE UPDATE ON reconciliation_diffs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Index periode untuk lane rekonsiliasi. Dibuat di sini (bukan di 001/013)
-- supaya perubahan 024 bisa di-rollback tanpa menyentuh migrasi lama.
CREATE INDEX IF NOT EXISTS payments_provider_paid_idx
  ON payments (provider, paid_at)
  WHERE status = 'paid';

CREATE INDEX IF NOT EXISTS payouts_provider_paid_idx
  ON payouts (provider, paid_at)
  WHERE status = 'paid';

CREATE INDEX IF NOT EXISTS refunds_processed_idx
  ON refunds (processed_at)
  WHERE status = 'succeeded';

-- Seed pengaturan. `is_public = false`: nilai operasional, bukan katalog.
INSERT INTO platform_settings (key, value, is_public, description)
VALUES
  ('recon_enabled', 'true'::jsonb, false,
   'Aktifkan job rekonsiliasi harian FR-131.'),
  ('recon_hour_wib', '7'::jsonb, false,
   'Jam mulai rekonsiliasi (WIB). Default 07:00 supaya selesai sebelum 09:00 WIB.'),
  ('recon_fee_tolerance_idr', '1000'::jsonb, false,
   'Toleransi selisih fee gateway dalam rupiah. Selisih di atas nilai ini menjadi temuan.'),
  ('recon_sla_hours', '24'::jsonb, false,
   'Batas waktu penyelesaian temuan rekonsiliasi (jam) sejak run selesai.')
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE reconciliation_runs IS
  'Satu baris per (provider, scope, tanggal WIB). Tidak memposting jurnal apa pun.';
COMMENT ON COLUMN reconciliation_runs.report_date IS
  'Tanggal kalender Asia/Jakarta (WIB) periode yang direkonsiliasi.';
COMMENT ON COLUMN reconciliation_runs.diff_idr IS
  'gateway_total_idr - ledger_total_idr. Nilai negatif berarti ledger lebih kecil.';
COMMENT ON TABLE reconciliation_diffs IS
  'Temuan rekonsiliasi per baris. Resolve wajib menyertakan alasan minimal 5 karakter.';
COMMENT ON COLUMN reconciliation_diffs.due_at IS
  'Batas SLA temuan: finished_at run + recon_sla_hours.';
