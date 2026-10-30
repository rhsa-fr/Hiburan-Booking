-- 008: kategori katalog + favorit pelanggan.
--
-- Kategori adalah data referensi (bukan enum) supaya admin bisa menambah
-- kategori tanpa migrasi baru dan satu vendor bisa tampil di beberapa kategori
-- (FR-106, TECH-DESIGN-v1.0 5.4). Tabel favorit disiapkan lebih awal karena
-- favorit adalah Should-have Fase 1 (FR-015); endpoint-nya menyusul.
--
-- Tidak ada backfill kategori untuk vendor lama: kategori adalah data bisnis
-- yang harus dipilih admin, bukan ditebak dari nama vendor.

CREATE TABLE IF NOT EXISTS categories (
  id         SMALLSERIAL PRIMARY KEY,
  parent_id  SMALLINT REFERENCES categories(id) ON DELETE RESTRICT,
  slug       VARCHAR(50) NOT NULL UNIQUE,
  name       VARCHAR(100) NOT NULL,
  icon_url   TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS vendor_categories (
  vendor_id   UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  category_id SMALLINT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  is_primary  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (vendor_id, category_id)
);

CREATE INDEX IF NOT EXISTS vendor_categories_category_idx
  ON vendor_categories (category_id, vendor_id);

CREATE UNIQUE INDEX IF NOT EXISTS vendor_categories_one_primary
  ON vendor_categories (vendor_id)
  WHERE is_primary;

INSERT INTO categories (slug, name, sort_order) VALUES
  ('tarling',         'Tarling & Dangdut', 1),
  ('organ-tunggal',   'Organ Tunggal',     2),
  ('seni-tradisi',    'Seni Tradisi',      3),
  ('pendukung-acara', 'Pendukung Acara',   4)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS favorites (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vendor_id  UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, vendor_id)
);

CREATE INDEX IF NOT EXISTS favorites_vendor_idx ON favorites (vendor_id);
