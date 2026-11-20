-- 036: refund manual (transfer bank) untuk pembayaran yang tidak bisa
-- di-refund oleh gateway.
--
-- Midtrans tidak mendukung refund bank transfer (VA/Mandiri) dan tidak
-- mengembalikan dana ke rekening pelanggan. Untuk kasus itu admin mencatat
-- transfer manual: nominal, referensi transfer, waktu transfer, dan bukti.
-- Row tetap memakai tabel `refunds` supaya antrean, status pelanggan, dan
-- audit tidak bercabang.
--
-- `is_manual` membedakan jalur ini dari refund provider. `transferred_at`
-- adalah waktu uang benar-benar ditransfer; `processed_at` tetap berarti
-- "refund selesai diproses" dan diisi saat status menjadi succeeded.

ALTER TABLE refunds
  ADD COLUMN IF NOT EXISTS is_manual BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE refunds
  ADD COLUMN IF NOT EXISTS transferred_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'refunds_manual_requires_transfer_ref'
  ) THEN
    ALTER TABLE refunds
      ADD CONSTRAINT refunds_manual_requires_transfer_ref
      CHECK (NOT is_manual OR status <> 'succeeded' OR provider_refund_id IS NOT NULL);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS refunds_manual_idx
  ON refunds (created_at DESC)
  WHERE is_manual;

COMMENT ON COLUMN refunds.is_manual IS
  'Refund dicatat dari transfer bank manual, bukan dari provider.';
COMMENT ON COLUMN refunds.transferred_at IS
  'Waktu transfer manual dilakukan; NULL untuk refund gateway.';
