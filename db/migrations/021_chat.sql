-- ============================================================
-- 021_chat — chat real-time in-app per booking (FR-050, ADR 0011).
--
-- Satu percakapan per booking; peserta ditentukan dari relasi booking
-- (pelanggan, pemilik/anggota vendor, admin). Pesan append-only: koreksi
-- dilakukan dengan pesan baru, bukan UPDATE/DELETE.
--
-- Fan-out antar-instance tidak memakai Redis: trigger mengirim NOTIFY
-- `tarlink_chat` berisi baris lengkap, lalu setiap instance API yang sedang
-- LISTEN meneruskannya ke klien WebSocket yang berlangganan booking tersebut.
-- ============================================================

CREATE TABLE IF NOT EXISTS chat_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  sender_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('customer', 'vendor', 'admin')),
  body        TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Riwayat selalu dibaca per booking, terbaru dulu, dengan cursor (created_at, id).
CREATE INDEX IF NOT EXISTS chat_messages_booking_created_idx
  ON chat_messages (booking_id, created_at DESC, id DESC);

-- Payload NOTIFY dibatasi 8000 byte; body maksimum 2000 karakter sehingga
-- baris lengkap tetap aman.
CREATE OR REPLACE FUNCTION tarlink_chat_notify() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify(
    'tarlink_chat',
    json_build_object(
      'id', NEW.id,
      'booking_id', NEW.booking_id,
      'sender_id', NEW.sender_id,
      'sender_role', NEW.sender_role,
      'body', NEW.body,
      'created_at', NEW.created_at
    )::text
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tarlink_chat_notify ON chat_messages;
CREATE TRIGGER tarlink_chat_notify
  AFTER INSERT ON chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION tarlink_chat_notify();
