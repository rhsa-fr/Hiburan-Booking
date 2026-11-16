-- ============================================================
-- 028_notification_deliveries — notifikasi keluar (FR-051)
--
-- Konteks: migrasi 018 hanya mengirim notifikasi **in-app** (satu baris
-- `notifications` per penerima). FR-051 menuntut perubahan status booking juga
-- sampai ke pengguna di luar aplikasi. Kanal yang tersedia tanpa dependency baru
-- adalah email (`EMAIL_API_URL`, sudah dipakai OTP sejak ADR 0011).
--
-- Tabel ini adalah buku kirim per (kanal, pesan outbox, penerima):
-- 1. `UNIQUE (channel, outbox_message_id, user_id)` membuat relay yang di-retry
--    tidak pernah mengirim email kedua kali untuk penerima yang sama.
-- 2. `status` menyimpan hasil percobaan terakhir. Baris `failed` boleh diklaim
--    ulang; baris `sent` tidak pernah diklaim ulang.
-- 3. Klaim `sending` yang lebih tua dari 10 menit dianggap milik proses yang
--    mati dan boleh diambil alih, sehingga crash worker tidak membuat email
--    hilang permanen.
-- 4. Tabel ini mencatat pengiriman, bukan status booking. Tidak ada uang,
--    ledger, atau status booking yang dibaca/diubah dari sini.
--
-- `channel` memakai TEXT + CHECK agar kanal berikutnya (push/SMS/WhatsApp)
-- tidak membutuhkan `ALTER TYPE ... ADD VALUE` di dalam transaksi migrasi.
-- ============================================================

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel           TEXT NOT NULL CHECK (channel IN ('email', 'push', 'sms', 'whatsapp')),
  outbox_message_id UUID NOT NULL REFERENCES outbox_messages(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'sending'
                      CHECK (status IN ('sending', 'sent', 'failed')),
  attempts          SMALLINT NOT NULL DEFAULT 1 CHECK (attempts > 0),
  last_error        TEXT,
  sent_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT notification_deliveries_sent_consistent
    CHECK ((status = 'sent') = (sent_at IS NOT NULL)),
  CONSTRAINT notification_deliveries_once_per_recipient
    UNIQUE (channel, outbox_message_id, user_id)
);

COMMENT ON TABLE notification_deliveries IS
  'FR-051: buku kirim notifikasi keluar (email). Satu baris per (kanal, pesan outbox, penerima); mencegah email ganda saat relay di-retry.';
COMMENT ON COLUMN notification_deliveries.status IS
  'sending = sedang dikirim, sent = provider menerima, failed = boleh diklaim ulang oleh tick berikutnya.';
COMMENT ON COLUMN notification_deliveries.attempts IS
  'Jumlah klaim. Naik setiap kali baris failed diklaim ulang.';

-- Operasional: lihat kiriman yang gagal / macet tanpa memindai seluruh tabel.
CREATE INDEX IF NOT EXISTS notification_deliveries_status_idx
  ON notification_deliveries (channel, status, updated_at DESC);

-- Daftar kiriman per penerima (dukungan investigasi "apakah email saya keluar?").
CREATE INDEX IF NOT EXISTS notification_deliveries_user_idx
  ON notification_deliveries (user_id, created_at DESC);
