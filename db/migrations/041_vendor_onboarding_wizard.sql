-- ============================================================
-- 041_vendor_onboarding_wizard — registrasi vendor bertahap (form v2)
--
-- Gate: pengajuan baru wajib menyetujui Ketentuan Mitra (`policy_versions`
-- code `vendor`) dan mengisi data kelayakan. Baris lama tetap sah:
-- form_version = 1 dan kolom baru NULL. Tidak ada backfill kategori karena
-- kategori adalah data bisnis, bukan tebakan.
--
-- Teks di bawah adalah RINGKASAN ATURAN OPERASIONAL, bukan pasal hukum final.
-- Ganti lewat migrasi baru setelah teks resmi disetujui; jangan mengarang
-- pasal di sini.
-- ============================================================

ALTER TABLE vendor_applications
  ADD COLUMN IF NOT EXISTS form_version SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS category_id SMALLINT REFERENCES categories(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS years_active SMALLINT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS personnel_count SMALLINT,
  ADD COLUMN IF NOT EXISTS equipment_summary TEXT,
  ADD COLUMN IF NOT EXISTS portfolio_url TEXT,
  ADD COLUMN IF NOT EXISTS agreement_policy_version_id UUID REFERENCES policy_versions(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendor_applications_form_version_chk'
  ) THEN
    ALTER TABLE vendor_applications
      ADD CONSTRAINT vendor_applications_form_version_chk
      CHECK (form_version IN (1, 2));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendor_applications_wizard_complete'
  ) THEN
    ALTER TABLE vendor_applications
      ADD CONSTRAINT vendor_applications_wizard_complete
      CHECK (
        form_version = 1 OR (
          category_id IS NOT NULL
          AND years_active IS NOT NULL
          AND description IS NOT NULL
          AND char_length(description) BETWEEN 40 AND 1000
          AND personnel_count IS NOT NULL
          AND equipment_summary IS NOT NULL
          AND char_length(equipment_summary) BETWEEN 20 AND 1000
          AND agreement_policy_version_id IS NOT NULL
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendor_applications_years_active_chk'
  ) THEN
    ALTER TABLE vendor_applications
      ADD CONSTRAINT vendor_applications_years_active_chk
      CHECK (years_active IS NULL OR years_active BETWEEN 0 AND 80);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendor_applications_personnel_chk'
  ) THEN
    ALTER TABLE vendor_applications
      ADD CONSTRAINT vendor_applications_personnel_chk
      CHECK (personnel_count IS NULL OR personnel_count BETWEEN 1 AND 1000);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendor_applications_portfolio_chk'
  ) THEN
    ALTER TABLE vendor_applications
      ADD CONSTRAINT vendor_applications_portfolio_chk
      CHECK (
        portfolio_url IS NULL OR (
          portfolio_url ~ '^https://[^[:space:]]+$'
          AND char_length(portfolio_url) <= 300
        )
      );
  END IF;
END $$;

-- Dipakai findLatestByUser() dan hitungan batas 3 pengajuan / 24 jam.
CREATE INDEX IF NOT EXISTS vendor_applications_user_created_idx
  ON vendor_applications (user_id, created_at DESC);

-- Ketentuan Mitra v1: ringkasan operasional yang sudah tercermin di produk.
INSERT INTO policy_versions (code, version, body, body_hash, effective_from, is_active)
SELECT
  'vendor',
  1,
  b.body,
  encode(digest(b.body::text, 'sha256'), 'hex'),
  now(),
  true
FROM (
  SELECT $json$
  {
    "status": "operational",
    "ringkasan": "Ketentuan Mitra ini merangkum aturan operasional Tarlink untuk vendor. Teks hukum final masih menunggu peninjauan; versi yang kamu setujui dicatat bersama pengajuan ini.",
    "sections": [
      {
        "heading": "Data yang kamu kirim harus benar",
        "body": "Nama grup, nama legal, NIK, wilayah, dan alamat dipakai untuk verifikasi. Pengajuan dengan data palsu atau milik orang lain ditolak, dan akun dapat ditangguhkan."
      },
      {
        "heading": "Dokumen KTP bersifat privat",
        "body": "Foto KTP disimpan terenkripsi di penyimpanan privat. Hanya admin verifikasi yang dapat membukanya, dan setiap pembukaan tercatat di audit log. KTP tidak pernah tampil ke pelanggan dan tidak disajikan sebagai media publik."
      },
      {
        "heading": "Komisi dan pencairan",
        "body": "Komisi platform, biaya layanan, dan jadwal pencairan mengikuti ketentuan platform yang berlaku dan terlihat di rincian pendapatan portal vendor sebelum pencairan diminta. Dana baru dicairkan setelah acara selesai dan jendela sengketa lewat."
      },
      {
        "heading": "Konten dan perilaku",
        "body": "Foto, video, paket, dan pesan dimoderasi. Konten yang melanggar dapat disembunyikan, dan pelanggaran berulang dapat berujung pada penangguhan vendor."
      },
      {
        "heading": "Penangguhan dan pembatalan",
        "body": "Vendor dapat ditangguhkan bila terbukti melanggar ketentuan, menerima pembayaran di luar platform, atau tidak memenuhi booking yang sudah dikonfirmasi. Booking yang sudah dibayar mengikuti kebijakan pembatalan dan pengembalian dana yang berlaku."
      },
      {
        "heading": "Versi kesepakatan",
        "body": "Versi ketentuan yang kamu setujui disimpan sebagai bukti persetujuan. Bila ketentuan diperbarui, pengajuan berikutnya memakai versi terbaru."
      }
    ]
  }
  $json$::jsonb AS body
) b
ON CONFLICT (code, version) DO NOTHING;
