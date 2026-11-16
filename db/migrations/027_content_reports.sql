-- ============================================================
-- 027_content_reports — moderasi UGC: lapor konten (FR-123),
-- takedown hak cipta (FR-124), dan blokir pengguna (FR-142).
--
-- Kenapa TEXT + CHECK, bukan enum PostgreSQL baru:
-- kosakata moderasi (alasan, aksi) masih akan berkembang, sedangkan
-- `ALTER TYPE ... ADD VALUE` tidak aman ketika dijalankan di dalam transaksi
-- (runner migrasi membungkus tiap file dengan BEGIN/COMMIT). Nilai yang sah
-- didokumentasikan lewat COMMENT dan dijaga CHECK.
--
-- Prinsip yang dijaga di sini:
-- 1. Isi laporan tidak bisa diubah setelah dibuat. Hanya kolom keputusan
--    (status/resolution/resolved_*) yang boleh berubah, dan CHECK memastikan
--    keputusan selalu lengkap (ada resolusi, peninjau, waktu, dan catatan).
-- 2. Takdown TIDAK menghapus data. `reviews.hidden_at` dan
--    `chat_messages.hidden_at` menyembunyikan konten dari pembaca; riwayat
--    tetap utuh karena chat bersifat append-only.
-- 3. `user_blocks` hanya memengaruhi tampilan pesan. Memblokir tidak
--    membatalkan booking, payout, atau kewajiban apa pun.
-- 4. Rating vendor tetap konsisten: menyembunyikan/menampilkan ulasan
--    menyesuaikan `vendors.rating_sum` dan `rating_count` lewat trigger,
--    sehingga rating publik tidak menghitung ulasan yang sudah diturunkan.
-- ============================================================

-- ============================================================
-- 1. Blokir pengguna (FR-142)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason     TEXT CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 3 AND 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT user_blocks_not_self CHECK (blocker_id <> blocked_id)
);

-- Memblokir idempoten: `ON CONFLICT DO NOTHING` pada PK di atas.
COMMENT ON TABLE user_blocks IS
  'FR-142: pengguna A memblokir B. Pesan dari B tidak ditampilkan ke A. Tidak memblokir transaksi.';

-- Arah sebaliknya ("siapa saja yang memblokir saya") dipakai saat menampilkan
-- pesan, jadi butuh index sendiri.
CREATE INDEX IF NOT EXISTS user_blocks_blocked_idx
  ON user_blocks (blocked_id, created_at DESC);

-- ============================================================
-- 2. Laporan konten (FR-123)
-- ============================================================
CREATE TABLE IF NOT EXISTS content_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type     TEXT NOT NULL CHECK (target_type IN
                    ('vendor', 'review', 'chat_message', 'vendor_media')),
  target_id       UUID NOT NULL,
  -- Konteks percakapan (hanya untuk target chat_message) agar admin bisa
  -- membaca thread tanpa menebak. Bukan kunci kepemilikan.
  booking_id      UUID REFERENCES bookings(id) ON DELETE SET NULL,
  reason          TEXT NOT NULL CHECK (reason IN
                    ('spam', 'harassment', 'fraud', 'illegal', 'copyright',
                     'impersonation', 'other')),
  detail          TEXT NOT NULL CHECK (char_length(btrim(detail)) BETWEEN 10 AND 2000),
  evidence_url    TEXT,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN
                    ('open', 'reviewing', 'resolved', 'rejected')),
  resolution      TEXT CHECK (resolution IN
                    ('no_action', 'content_removed', 'content_restored',
                     'user_warned', 'user_suspended')),
  resolution_note TEXT,
  resolved_by     UUID REFERENCES users(id),
  resolved_at     TIMESTAMPTZ,
  -- Batas tinjauan: 24 jam (FR-123), 72 jam untuk hak cipta (FR-124).
  -- Dihitung service saat insert; admin membaca antrean berdasar kolom ini.
  sla_due_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT content_reports_decision_consistent CHECK (
    (
      status IN ('open', 'reviewing')
      AND resolution IS NULL
      AND resolved_by IS NULL
      AND resolved_at IS NULL
      AND resolution_note IS NULL
    )
    OR
    (
      status IN ('resolved', 'rejected')
      AND resolution IS NOT NULL
      AND resolved_by IS NOT NULL
      AND resolved_at IS NOT NULL
      AND resolution_note IS NOT NULL
      AND char_length(btrim(resolution_note)) BETWEEN 10 AND 1000
    )
  )
);

COMMENT ON COLUMN content_reports.target_type IS
  'vendor | review | chat_message | vendor_media — UUID target ada di target_id.';
COMMENT ON COLUMN content_reports.reason IS
  'spam | harassment | fraud | illegal | copyright | impersonation | other.';
COMMENT ON COLUMN content_reports.status IS
  'open (baru) | reviewing (dipegang admin) | resolved (ditindak) | rejected (laporan tidak berdasar).';
COMMENT ON COLUMN content_reports.resolution IS
  'no_action | content_removed | content_restored | user_warned | user_suspended.';
COMMENT ON COLUMN content_reports.sla_due_at IS
  'Batas tinjauan: created_at + 24 jam, atau +72 jam untuk reason = copyright.';

-- Satu pelapor tidak boleh menumpuk laporan terbuka untuk target yang sama.
-- Laporan yang sudah selesai tidak menghalangi laporan baru (konten bisa
-- muncul lagi setelah dipulihkan).
CREATE UNIQUE INDEX IF NOT EXISTS content_reports_open_per_target_uniq
  ON content_reports (reporter_id, target_type, target_id)
  WHERE status IN ('open', 'reviewing');

-- Antrean admin: yang belum diputuskan, paling mendesak dulu.
CREATE INDEX IF NOT EXISTS content_reports_queue_idx
  ON content_reports (status, sla_due_at, created_at)
  WHERE status IN ('open', 'reviewing');

-- Penelusuran riwayat sebuah target ("apakah vendor ini sudah dilaporkan?").
CREATE INDEX IF NOT EXISTS content_reports_target_idx
  ON content_reports (target_type, target_id, created_at DESC);

CREATE INDEX IF NOT EXISTS content_reports_reporter_idx
  ON content_reports (reporter_id, created_at DESC);

-- ============================================================
-- 3. Takdown konten (FR-124) — sembunyikan, jangan hapus
-- ============================================================
ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS hidden_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hidden_reason TEXT;

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS hidden_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hidden_reason TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reviews_hidden_consistent'
  ) THEN
    ALTER TABLE reviews ADD CONSTRAINT reviews_hidden_consistent CHECK (
      (hidden_at IS NULL AND hidden_reason IS NULL)
      OR
      (hidden_at IS NOT NULL
       AND hidden_reason IS NOT NULL
       AND char_length(btrim(hidden_reason)) BETWEEN 10 AND 500)
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_messages_hidden_consistent'
  ) THEN
    ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_hidden_consistent CHECK (
      (hidden_at IS NULL AND hidden_reason IS NULL)
      OR
      (hidden_at IS NOT NULL
       AND hidden_reason IS NOT NULL
       AND char_length(btrim(hidden_reason)) BETWEEN 10 AND 500)
    );
  END IF;
END $$;

-- Pembacaan publik hanya mengambil baris yang tidak disembunyikan.
CREATE INDEX IF NOT EXISTS reviews_visible_idx
  ON reviews (vendor_id, created_at DESC, id DESC)
  WHERE hidden_at IS NULL;

CREATE INDEX IF NOT EXISTS chat_messages_visible_idx
  ON chat_messages (booking_id, created_at DESC, id DESC)
  WHERE hidden_at IS NULL;

-- Rating vendor harus tetap konsisten saat ulasan disembunyikan/dipulihkan:
-- kalau tidak, rating publik tetap menghitung ulasan yang sudah diturunkan.
CREATE OR REPLACE FUNCTION trg_reviews_hidden_rating() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.hidden_at IS DISTINCT FROM OLD.hidden_at THEN
    IF NEW.hidden_at IS NULL THEN
      UPDATE vendors
         SET rating_sum   = rating_sum + NEW.rating,
             rating_count = rating_count + 1
       WHERE id = NEW.vendor_id;
    ELSE
      UPDATE vendors
         SET rating_sum   = GREATEST(rating_sum - NEW.rating, 0),
             rating_count = GREATEST(rating_count - 1, 0)
       WHERE id = NEW.vendor_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reviews_hidden ON reviews;
CREATE TRIGGER trg_reviews_hidden
  AFTER UPDATE OF hidden_at ON reviews
  FOR EACH ROW EXECUTE FUNCTION trg_reviews_hidden_rating();

COMMENT ON COLUMN reviews.hidden_at IS
  'FR-124: waktu konten diturunkan. NULL = tampil publik. Baris tidak dihapus.';
COMMENT ON COLUMN chat_messages.hidden_at IS
  'FR-124: waktu pesan diturunkan. NULL = tampil. Baris tidak dihapus (append-only).';
