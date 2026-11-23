-- 039: tanda baca pesan chat (read receipt) untuk centang dua.
--
-- Percakapan tetap satu per booking dan dua pihak (pelanggan ↔ vendor). Karena
-- penerima sebuah pesan hanya satu, tanda baca disimpan sebagai kolom pada baris
-- pesan, bukan tabel penghubung: satu pesan dibaca paling banyak satu kali oleh
-- lawan bicaranya. `read_at` NULL berarti belum dibaca.
--
-- Pesan bersifat append-only (ADR 0011); kolom `read_at` adalah satu-satunya
-- kolom yang boleh berubah, dan hanya dari NULL menjadi timestamp.

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

COMMENT ON COLUMN chat_messages.read_at IS
  'Waktu pesan dibaca penerima; NULL = belum dibaca. Hanya boleh diisi sekali.';

-- Membaca daftar pesan yang belum dibaca dalam satu booking adalah query yang
-- paling sering dipakai saat membuka thread.
CREATE INDEX IF NOT EXISTS chat_messages_unread_idx
  ON chat_messages (booking_id, created_at)
  WHERE read_at IS NULL;

-- Penanda baca hanya sah untuk pesan yang sudah ada dan bukan pesan pengirim itu
-- sendiri. Aturan "bukan pengirim" ditegakkan di service (butuh identitas aktor),
-- sedangkan di sini hanya dijaga agar nilai tidak mundur.
CREATE OR REPLACE FUNCTION tarlink_chat_read_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at THEN
    RAISE EXCEPTION 'chat_messages.read_at tidak boleh diubah setelah diisi';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tarlink_chat_read_guard ON chat_messages;
CREATE TRIGGER tarlink_chat_read_guard
  BEFORE UPDATE OF read_at ON chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION tarlink_chat_read_guard();
