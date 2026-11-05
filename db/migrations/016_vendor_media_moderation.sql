-- 016: moderasi media vendor (FR-107) dan pernyataan lisensi konten (FR-140).
--
-- Media TIDAK lagi ditulis langsung ke kolom publik `vendors.avatar_url`,
-- `vendors.banner_url`, `vendors.photo_urls`, `vendors.video_url`, atau
-- `packages.photo_url`. Setiap unggahan menjadi baris `vendor_media` berstatus
-- `pending`. Kolom publik hanya berubah ketika admin menyetujui (approve).
--
-- Backfill: unggahan asli sebelum migrasi ini (URL `/v1/media/...`) ditandai
-- `approved` dengan `reviewed_at` terisi dan `review_note='backfill: pra-moderasi'`.
-- Seed stok Unsplash/YouTube sudah dikosongkan oleh 015, jadi tidak ikut.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'media_kind') THEN
    CREATE TYPE media_kind AS ENUM ('avatar', 'banner', 'gallery', 'package_photo', 'video');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'media_review_status') THEN
    CREATE TYPE media_review_status AS ENUM ('pending', 'approved', 'rejected');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS vendor_media (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id         UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  package_id        UUID REFERENCES packages(id) ON DELETE CASCADE,
  kind              media_kind NOT NULL,
  url               TEXT NOT NULL,
  -- Nama berkas di UPLOAD_DIR untuk unggahan sendiri; NULL untuk tautan eksternal.
  storage_key       TEXT,
  license_statement TEXT NOT NULL,
  status            media_review_status NOT NULL DEFAULT 'pending',
  submitted_by      UUID REFERENCES users(id),
  reviewed_by       UUID REFERENCES users(id),
  reviewed_at       TIMESTAMPTZ,
  review_note       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (length(btrim(license_statement)) >= 10),
  CHECK (kind <> 'package_photo' OR package_id IS NOT NULL),
  CHECK (kind = 'package_photo' OR package_id IS NULL),
  CHECK (status <> 'approved' OR reviewed_at IS NOT NULL),
  CHECK (status <> 'rejected' OR (review_note IS NOT NULL AND length(btrim(review_note)) > 0))
);

CREATE INDEX IF NOT EXISTS vendor_media_queue_idx
  ON vendor_media (status, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS vendor_media_vendor_idx
  ON vendor_media (vendor_id, status, created_at DESC);

-- Satu paket tidak boleh punya dua foto paket yang sama-sama menunggu/terbit.
CREATE UNIQUE INDEX IF NOT EXISTS vendor_media_package_active_unique
  ON vendor_media (package_id)
  WHERE kind = 'package_photo' AND status IN ('pending', 'approved');

-- Backfill unggahan asli pra-moderasi sebagai approved.
INSERT INTO vendor_media (vendor_id, kind, url, license_statement, status, reviewed_at, review_note)
SELECT v.id, 'avatar', v.avatar_url, 'backfill: unggahan pra-moderasi', 'approved', now(), 'backfill: pra-moderasi'
  FROM vendors v
 WHERE v.avatar_url LIKE '%/v1/media/%'
   AND NOT EXISTS (
     SELECT 1 FROM vendor_media m WHERE m.vendor_id = v.id AND m.kind = 'avatar' AND m.url = v.avatar_url
   );

INSERT INTO vendor_media (vendor_id, kind, url, license_statement, status, reviewed_at, review_note)
SELECT v.id, 'banner', v.banner_url, 'backfill: unggahan pra-moderasi', 'approved', now(), 'backfill: pra-moderasi'
  FROM vendors v
 WHERE v.banner_url LIKE '%/v1/media/%'
   AND NOT EXISTS (
     SELECT 1 FROM vendor_media m WHERE m.vendor_id = v.id AND m.kind = 'banner' AND m.url = v.banner_url
   );

INSERT INTO vendor_media (vendor_id, kind, url, license_statement, status, reviewed_at, review_note)
SELECT v.id, 'video', v.video_url, 'backfill: unggahan pra-moderasi', 'approved', now(), 'backfill: pra-moderasi'
  FROM vendors v
 WHERE btrim(COALESCE(v.video_url, '')) <> ''
   AND NOT EXISTS (
     SELECT 1 FROM vendor_media m WHERE m.vendor_id = v.id AND m.kind = 'video' AND m.url = v.video_url
   );

INSERT INTO vendor_media (vendor_id, kind, url, license_statement, status, reviewed_at, review_note)
SELECT v.id, 'gallery', g.url, 'backfill: unggahan pra-moderasi', 'approved', now(), 'backfill: pra-moderasi'
  FROM vendors v
 CROSS JOIN LATERAL unnest(v.photo_urls) AS g(url)
 WHERE g.url LIKE '%/v1/media/%'
   AND NOT EXISTS (
     SELECT 1 FROM vendor_media m WHERE m.vendor_id = v.id AND m.kind = 'gallery' AND m.url = g.url
   );

INSERT INTO vendor_media (vendor_id, package_id, kind, url, license_statement, status, reviewed_at, review_note)
SELECT p.vendor_id, p.id, 'package_photo', p.photo_url, 'backfill: unggahan pra-moderasi', 'approved', now(), 'backfill: pra-moderasi'
  FROM packages p
 WHERE p.photo_url LIKE '%/v1/media/%'
   AND NOT EXISTS (
     SELECT 1 FROM vendor_media m WHERE m.package_id = p.id AND m.kind = 'package_photo'
   );
