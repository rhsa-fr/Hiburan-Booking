-- 010: Idempotensi domain untuk POST /bookings (D-11, TECH-DESIGN §7.5).
--
-- Tabel `idempotency_keys` sudah menjadi guard HTTP (scope + actor + key).
-- Kolom ini adalah guard terakhir di level data: dua permintaan dengan
-- `client_generated_id` yang sama tidak boleh menghasilkan dua booking,
-- bahkan bila Idempotency-Key berbeda atau retensi 24 jam sudah lewat.
--
-- Nullable: klien lama / booking non-idempoten tetap boleh (NULL tidak ikut
-- unique index parsial).

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS client_generated_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS bookings_client_generated_uniq
  ON bookings (customer_id, client_generated_id)
  WHERE client_generated_id IS NOT NULL;
