-- ============================================================
-- 023_vendor_suspension — FR-132 (stop new payouts only)
--
-- Suspend = `verification_status = 'suspended'`, NOT `is_active = false`.
-- `is_active = false` would cut the vendor portal (`findVendorByOwner` filters
-- `is_active`) and make in-flight bookings impossible to finish. Suspension
-- therefore only hides the vendor from the public catalogue (which requires
-- `approved`) and freezes *new* payouts.
--
-- `suspension_previous_status` stores what to restore on unsuspend. Audit
-- trail lives in `audit_logs` (append-only + hash chain), so no history table.
-- ============================================================

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS suspended_by UUID REFERENCES users(id);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS suspension_reason TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS suspension_previous_status vendor_verification_status;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendors_suspension_consistent'
  ) THEN
    ALTER TABLE vendors ADD CONSTRAINT vendors_suspension_consistent CHECK (
      (
        verification_status = 'suspended'
        AND suspended_at IS NOT NULL
        AND suspended_by IS NOT NULL
        AND suspension_previous_status IS NOT NULL
        AND suspension_reason IS NOT NULL
        AND length(btrim(suspension_reason)) BETWEEN 10 AND 500
      )
      OR
      (
        verification_status <> 'suspended'
        AND suspended_at IS NULL
        AND suspended_by IS NULL
        AND suspension_previous_status IS NULL
        AND suspension_reason IS NULL
      )
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS vendors_suspended_idx
  ON vendors (suspended_at DESC)
  WHERE verification_status = 'suspended';

COMMENT ON COLUMN vendors.suspension_reason IS
  'Alasan penangguhan (10-500 karakter), wajib saat verification_status = suspended.';
COMMENT ON COLUMN vendors.suspension_previous_status IS
  'Status verifikasi sebelum ditangguhkan; dipulihkan saat unsuspend.';
