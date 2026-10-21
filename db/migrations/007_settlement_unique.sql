-- 007: satu booking hanya boleh punya satu baris settlement yang aktif
-- (pending/paid). Duplikat pelunasan dicegah di level DB, bukan hanya oleh
-- guard aplikasi, sehingga dua operator tidak bisa menghasilkan dua jurnal.

CREATE UNIQUE INDEX IF NOT EXISTS payments_one_settlement
  ON payments (booking_id)
  WHERE kind = 'settlement' AND status IN ('pending', 'paid');
