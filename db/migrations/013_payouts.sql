-- 013: pencairan dana vendor (payouts + payout_items).
--
-- Tabel `vendor_bank_accounts` sudah ada sejak 001, tetapi belum pernah dipakai
-- menulis. Migrasi ini menambah tabel operasional payout; uang tetap hidup di
-- ledger double-entry, bukan di tabel ini.
--
-- Keputusan yang dijaga skema:
-- 1. Satu vendor hanya boleh punya satu payout aktif (requested/approved/
--    processing), sehingga dua operator tidak bisa mencairkan dana yang sama.
-- 2. Satu booking hanya boleh masuk satu payout aktif. Baris yang di-void saat
--    payout gagal membebaskan booking itu untuk payout berikutnya.
-- 3. Maker dan checker wajib dua orang berbeda (CHECK approved_by <> requested_by).
-- 4. Status paid wajib punya paid_at; status failed wajib punya failure_code.
--
-- `set_updated_at()` sudah dibuat di 001_core.sql.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payout_status') THEN
    CREATE TYPE payout_status AS ENUM
      ('requested', 'approved', 'processing', 'paid', 'failed', 'rejected', 'cancelled');
  END IF;
END $$;

-- Nomor urut kode payout. Dibuat di DB supaya dua operator tidak pernah
-- menghasilkan `code` yang sama, tanpa perlu retry di aplikasi.
CREATE SEQUENCE IF NOT EXISTS payout_code_seq;

CREATE TABLE IF NOT EXISTS payouts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                VARCHAR(24) NOT NULL UNIQUE,
  vendor_id           UUID NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  bank_account_id     UUID NOT NULL REFERENCES vendor_bank_accounts(id) ON DELETE RESTRICT,
  amount_idr          BIGINT NOT NULL CHECK (amount_idr > 0),
  currency            CHAR(3) NOT NULL DEFAULT 'IDR',
  status              payout_status NOT NULL DEFAULT 'requested',
  provider            VARCHAR(30) NOT NULL,
  provider_ref        VARCHAR(120),
  provider_payout_id  VARCHAR(120),
  failure_code        VARCHAR(60),
  failure_reason      TEXT,
  requested_by        UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_by         UUID REFERENCES users(id) ON DELETE RESTRICT,
  approved_at         TIMESTAMPTZ,
  processed_at        TIMESTAMPTZ,
  paid_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (currency = 'IDR'),
  CHECK (approved_by IS NULL OR approved_by <> requested_by),
  CHECK (status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK (status <> 'paid' OR (approved_by IS NOT NULL AND paid_at IS NOT NULL)),
  CHECK (status <> 'failed' OR failure_code IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS payouts_one_active_per_vendor
  ON payouts (vendor_id)
  WHERE status IN ('requested', 'approved', 'processing');

CREATE INDEX IF NOT EXISTS payouts_vendor_idx
  ON payouts (vendor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS payouts_reconcile_idx
  ON payouts (status, updated_at)
  WHERE status IN ('approved', 'processing');

CREATE TABLE IF NOT EXISTS payout_items (
  payout_id  UUID NOT NULL REFERENCES payouts(id) ON DELETE RESTRICT,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  amount_idr BIGINT NOT NULL CHECK (amount_idr > 0),
  voided_at  TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (payout_id, booking_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS payout_items_booking_active_uniq
  ON payout_items (booking_id)
  WHERE voided_at IS NULL;

CREATE INDEX IF NOT EXISTS payout_items_voided_idx
  ON payout_items (payout_id) WHERE voided_at IS NOT NULL;

DROP TRIGGER IF EXISTS trg_payouts_updated_at ON payouts;
CREATE TRIGGER trg_payouts_updated_at
  BEFORE UPDATE ON payouts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
