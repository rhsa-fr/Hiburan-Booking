-- 032_booking_reminders.sql — FR-052 (pengingat H-7/H-1/hari-H)
--
-- Job `booking_reminders` memilih event berdasarkan `events.start_date`
-- (tiga tanggal target per tick) lalu JOIN ke booking aktifnya. Tanpa index ini
-- setiap tick memindai seluruh tabel `events`; dengan index, pemindaian dibatasi
-- pada tiga nilai tanggal.
--
-- Tidak ada tabel/kolom baru: idempotensi memakai `outbox_messages.dedupe_key`
-- yang sudah UNIQUE (`booking:<id>:reminder:<offset>`), sehingga tick ganda tidak
-- pernah mengirim pengingat yang sama dua kali.

CREATE INDEX IF NOT EXISTS events_start_date_idx ON events (start_date);

COMMENT ON INDEX events_start_date_idx IS
  'FR-052: pemilihan event untuk pengingat H-7/H-1/hari-H per tick worker.';
