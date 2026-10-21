-- 006: izinkan metode pembayaran manual (transfer/kas) untuk pelunasan yang
-- dicatat admin. Uangnya tetap masuk jalur non-platform (D-01); baris payments
-- hanya mencatat kejadiannya supaya jurnal settlement_received seimbang.
--
-- Sebelum ini CHECK hanya menerima rail gateway, sehingga pelunasan manual
-- yang dibayar lewat transfer bank tidak bisa dicatat sama sekali.

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_method_check;

ALTER TABLE payments
  ADD CONSTRAINT payments_method_check CHECK (
    method::text = ANY (
      ARRAY[
        'qris',
        'va_bca',
        'va_bni',
        'va_bri',
        'va_mandiri',
        'gopay',
        'ovo',
        'dana',
        'shopeepay',
        'transfer_manual',
        'cash'
      ]::text[]
    )
  );
