-- ============================================================
-- 002_fixes — Tarlink schema delta (temuan audit backend)
-- Source: TECH-DESIGN-v1.0 §5 (DDL), §11.3 (seed), §4.3 (L-01..L-07), D-12, D-18.
--
-- Migrasi append-only: `001_core.sql` TIDAK diubah (sudah ter-checksum).
-- Setiap blok di bawah menutup satu temuan audit:
--
--   F06 — Tabel hilang yang dipakai `booking.repository.ts`:
--         `package_price_rules`, `package_addons`, `booking_addons`.
--         Tanpa ini tiap pembuatan booking gagal `42P01 relation does not exist`.
--   F14 — `booking_terms_snapshot` belum ada; L-01 (§4.3) + D-12 mewajibkan
--         snapshot kebijakan yang dibekukan per booking.
--   F08 — `bookings.cancel_reason VARCHAR(80)` meluap (`22001 value too long`)
--         karena API menyimpan `reason_code` + reason note.
--   F12 — Data referensi tidak pernah di-seed: `chart_of_accounts`
--         (FK `journal_lines.account_code`) dan `regions`
--         (FK `events.region_code`) → `23503 foreign_key_violation`.
--         Ditambah seed `policy_versions` — blok pertama agar
--         `bookings.policy_version_id` resolve (FK NOT NULL; tanpa baris ini
--         `POST /bookings` gagal `23503` pada insert booking pertama).
--   F22 — Fallback hold 2 jam pada trigger `sync_calendar_from_booking_slots`
--         menabrak D-18 (24/48 jam). Diganti `hold_expires_at = payment_deadline`.
--   F01 — Trigger `assert_booking_combination`: diverifikasi terhadap
--         `001_core.sql`; kombinasi `confirmed + dp_paid + held` SUDAH legal
--         → trigger TIDAK diubah dan TIDAK dilemahkan.
--
-- Money tetap BIGINT rupiah (D-09); tidak ada NUMERIC/DECIMAL.
-- Index pada tabel besar tetap `CONCURRENTLY` di migrasi terpisah (§11.1).
-- ============================================================

-- ============================================================
-- F06 — package_addons, package_price_rules, booking_addons
-- Sumber: TECH-DESIGN-v1.0 §5.6 (package_addons, package_price_rules)
--         dan §5.7 (booking_addons). DDL disalin apa adanya dari desain.
-- ============================================================

-- §5.2 mendefinisikan `price_rule_type`; belum dibuat di 001_core.sql.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE t.typname = 'price_rule_type'
       AND n.nspname = current_schema()
  ) THEN
    CREATE TYPE price_rule_type AS ENUM ('multiplier','fixed');
  END IF;
END
$$;

CREATE TABLE package_addons (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  name       VARCHAR(100) NOT NULL,
  price_idr  BIGINT NOT NULL CHECK (price_idr >= 0),
  currency   CHAR(3) NOT NULL DEFAULT 'IDR',
  unit       VARCHAR(30) NOT NULL DEFAULT 'unit' CHECK (unit IN ('unit','hour','person')),
  max_qty    SMALLINT NOT NULL DEFAULT 10 CHECK (max_qty > 0),
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (currency = 'IDR')
);

CREATE TABLE package_price_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id      UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  label           VARCHAR(80) NOT NULL,
  rule_type       price_rule_type NOT NULL,
  date_from       DATE,
  date_to         DATE,
  dow_mask        SMALLINT NOT NULL DEFAULT 127 CHECK (dow_mask BETWEEN 1 AND 127),  -- bit 0=Senin .. 6=Minggu
  multiplier_bp   INT CHECK (multiplier_bp BETWEEN 5000 AND 30000),
  fixed_price_idr BIGINT CHECK (fixed_price_idr > 0),
  priority        SMALLINT NOT NULL DEFAULT 100,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (date_to IS NULL OR date_from IS NULL OR date_to >= date_from),
  CHECK (
    (rule_type = 'multiplier' AND multiplier_bp IS NOT NULL AND fixed_price_idr IS NULL)
    OR
    (rule_type = 'fixed' AND fixed_price_idr IS NOT NULL AND multiplier_bp IS NULL)
  )
);
CREATE INDEX package_price_rules_lookup_idx
  ON package_price_rules (package_id, priority, id) WHERE is_active;

CREATE TABLE booking_addons (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  addon_id   UUID REFERENCES package_addons(id) ON DELETE SET NULL,
  name       VARCHAR(100) NOT NULL,
  qty        SMALLINT NOT NULL DEFAULT 1 CHECK (qty > 0),
  price_idr  BIGINT NOT NULL CHECK (price_idr >= 0),
  currency   CHAR(3) NOT NULL DEFAULT 'IDR',
  CHECK (currency = 'IDR')
);

-- ============================================================
-- F14 — booking_terms_snapshot (L-01 §4.3, D-12)
-- Sumber: TECH-DESIGN-v1.0 §5.7. Snapshot dibekukan per booking: isi policy
-- yang berlaku saat booking dibuat; perubahan policy tidak boleh retroactive.
-- Kolom `terms`/`terms_hash` memakai nama desain (dipakai fungsi
-- `snapshot_booking_terms` §5.13).
-- ============================================================
CREATE TABLE booking_terms_snapshot (
  booking_id        UUID PRIMARY KEY REFERENCES bookings(id) ON DELETE RESTRICT,
  policy_version_id UUID NOT NULL REFERENCES policy_versions(id),
  terms             JSONB NOT NULL,
  terms_hash        CHAR(64) NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (length(terms_hash) = 64)
);
CREATE INDEX booking_terms_snapshot_booking_idx ON booking_terms_snapshot (booking_id);

-- ============================================================
-- F08 — bookings.cancel_reason meluap pada VARCHAR(80)
-- API menyimpan `reason_code` + reason note (booking.service.ts):
--   cancel  → `reason_code: reason`      (maks 40 + 2 +  500 =  542 karakter)
--   reject  → `reason_code: reason_note` (maks 40 + 2 + 1000 = 1042 karakter)
-- Keduanya jauh melebihi 80 karakter → `22001 value too long` pada cancel/reject biasa.
-- Diperluas ke TEXT. Tanpa CHECK: TEXT tidak dapat meluap, dan batas
-- karakter sudah divalidasi di DTO/lapisan API, bukan di database.
-- `booking_status_history.note` sudah TEXT sejak 001_core.sql → tidak diubah.
-- ============================================================
ALTER TABLE bookings ALTER COLUMN cancel_reason TYPE TEXT;

-- ============================================================
-- F12 — Seed data referensi (idempoten: ON CONFLICT DO NOTHING)
-- Sumber: TECH-DESIGN-v1.0 §11.3. Kode akun dicocokkan 1:1 dengan
-- `libs/modules/ledger/src/accounts.ts` (CHART_OF_ACCOUNTS): code, name,
-- account_type, normal_balance, dan is_vendor_scoped identik.
-- ============================================================

-- Chart of accounts (13 akun, urutan kode)
INSERT INTO chart_of_accounts (code, name, account_type, normal_balance, is_vendor_scoped, description) VALUES
  ('1000','platform_operating_cash',     'asset',     'debit',  false,'Kas platform dari modal/margin sendiri; bukan dana pelanggan'),
  ('1100','gateway_clearing',            'asset',     'debit',  false,'Piutang ke PJP atas dana pelanggan'),
  ('1110','vendor_payout_clearing',      'asset',     'debit',  true, 'Dana dalam perjalanan saat disbursement'),
  ('2100','escrow_liability_vendor',     'liability', 'credit', true, 'Kewajiban tercatat kepada vendor'),
  ('2110','refund_payable',              'liability', 'credit', false,'Kewajiban refund ke pelanggan'),
  ('2120','vendor_payable',              'liability', 'credit', true, 'Hak vendor yang belum ditransfer'),
  ('2130','tax_payable',                 'liability', 'credit', false,'Pajak terutang (D-16)'),
  ('2140','dispute_reserve',             'liability', 'credit', false,'Dana disisihkan untuk clawback'),
  ('4100','platform_revenue_commission', 'revenue',   'credit', false,'Komisi platform'),
  ('4110','platform_revenue_service_fee','revenue',   'credit', false,'Biaya layanan pelanggan'),
  ('5100','gateway_fee_expense',         'expense',   'debit',  false,'Biaya gateway (dipulihkan bila ditanggung pembatal)'),
  ('5110','gateway_fee_absorbed',        'expense',   'debit',  false,'Biaya gateway diserap platform'),
  ('5200','vendor_bad_debt_expense',     'expense',   'debit',  true, 'Write-off piutang vendor')
ON CONFLICT (code) DO NOTHING;

-- Wilayah (kode BPS; verifikasi terhadap publikasi BPS terbaru sebelum rilis) [ASUMSI]
INSERT INTO regions (code, name, level, parent_code, centroid, sort_order) VALUES
  ('32',   'Jawa Barat',            'province', NULL, ST_SetSRID(ST_MakePoint(107.6098, -6.9147),4326)::geography, 1),
  ('33',   'Jawa Tengah',           'province', NULL, ST_SetSRID(ST_MakePoint(110.4200, -7.0051),4326)::geography, 2),
  ('3212', 'Kabupaten Indramayu',   'regency',  '32', ST_SetSRID(ST_MakePoint(108.3244, -6.3271),4326)::geography, 10),
  ('3209', 'Kabupaten Cirebon',     'regency',  '32', ST_SetSRID(ST_MakePoint(108.5560, -6.7063),4326)::geography, 11),
  ('3274', 'Kota Cirebon',          'city',     '32', ST_SetSRID(ST_MakePoint(108.5523, -6.7320),4326)::geography, 12),
  ('3213', 'Kabupaten Subang',      'regency',  '32', ST_SetSRID(ST_MakePoint(107.7610, -6.5716),4326)::geography, 13),
  ('3210', 'Kabupaten Majalengka',  'regency',  '32', ST_SetSRID(ST_MakePoint(108.2270, -6.8364),4326)::geography, 14),
  ('3215', 'Kabupaten Karawang',    'regency',  '32', ST_SetSRID(ST_MakePoint(107.3375, -6.3227),4326)::geography, 15),
  ('3329', 'Kabupaten Brebes',      'regency',  '33', ST_SetSRID(ST_MakePoint(109.0436, -6.8728),4326)::geography, 20),
  ('3328', 'Kabupaten Tegal',       'regency',  '33', ST_SetSRID(ST_MakePoint(109.1400, -7.0300),4326)::geography, 21),
  ('3376', 'Kota Tegal',            'city',     '33', ST_SetSRID(ST_MakePoint(109.1250, -6.8694),4326)::geography, 22),
  ('3327', 'Kabupaten Pemalang',    'regency',  '33', ST_SetSRID(ST_MakePoint(109.3822, -6.8886),4326)::geography, 23),
  ('3326', 'Kabupaten Pekalongan',  'regency',  '33', ST_SetSRID(ST_MakePoint(109.6750, -6.8886),4326)::geography, 24),
  ('3375', 'Kota Pekalongan',       'city',     '33', ST_SetSRID(ST_MakePoint(109.6750, -6.8886),4326)::geography, 25)
ON CONFLICT (code) DO NOTHING;

-- Kebijakan pembatalan versi awal (§11.3) — baris policy pertama sehingga
-- `bookings.policy_version_id` (FK NOT NULL → policy_versions) selalu resolve.
-- Tanpa baris ini `POST /bookings` gagal `23503 foreign_key_violation` pada
-- insert booking pertama. `body` dan `body_hash` disalin apa adanya dari
-- desain (hash desain memuat subset body: currency + tiers).
INSERT INTO policy_versions (code, version, body, body_hash, effective_from, is_active, created_by)
VALUES (
  'cancellation', 1,
  '{"currency":"IDR","tiers":[{"min_days_before":30,"refund_percent_bp":10000},{"min_days_before":14,"refund_percent_bp":5000},{"min_days_before":0,"refund_percent_bp":0}],"vendor_cancel":{"refund_percent_bp":10000,"vendor_penalty":"reputation"},"fee_bearer":{"customer":"customer","vendor":"platform","platform":"platform"}}'::jsonb,
  encode(digest('{"currency":"IDR","tiers":[{"min_days_before":30,"refund_percent_bp":10000},{"min_days_before":14,"refund_percent_bp":5000},{"min_days_before":0,"refund_percent_bp":0}]}'::text,'sha256'),'hex'),
  '2026-10-21T00:00:00+07:00', true, NULL
)
ON CONFLICT (code, version) DO NOTHING;

-- ============================================================
-- F22 — Hold expiry mengikuti D-18, bukan fallback 2 jam
-- `001_core.sql` memakai `COALESCE(b.payment_deadline, now() + interval '2 hours')`.
-- Fallback itu diam-diam menimpa jendela D-18 (24 jam / 48 jam) selama booking
-- belum punya `payment_deadline`. Sekarang `hold_expires_at = payment_deadline`;
-- NULL berarti "hold tanpa kedaluwarsa" dan booking service yang bertanggung
-- jawab mengekspire-nya (job `expire_payment_hold`, §8.2).
-- ============================================================

-- (a) CHECK calendar_slots: hold tanpa kedaluwarsa sah bila slot terikat ke
-- booking (kedaluwarsa diambil dari `bookings.payment_deadline`, D-18).
-- CHECK yang ditulis tanpa nama di 001_core.sql dicari lewat definisinya
-- supaya migrasi tidak bergantung pada auto-nama PostgreSQL.
DO $$
DECLARE
  v_constraint TEXT;
BEGIN
  SELECT conname INTO v_constraint
    FROM pg_constraint
   WHERE conrelid = 'calendar_slots'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%hold_expires_at IS NOT NULL%';

  IF v_constraint IS NULL THEN
    RAISE EXCEPTION
      'CHECK calendar_slots yang mewajibkan hold_expires_at IS NOT NULL tidak ditemukan';
  END IF;

  EXECUTE format('ALTER TABLE calendar_slots DROP CONSTRAINT %I', v_constraint);
END
$$;

ALTER TABLE calendar_slots
  ADD CONSTRAINT calendar_slots_hold_expiry_or_booking
  CHECK (status <> 'held' OR hold_expires_at IS NOT NULL OR booking_id IS NOT NULL);

-- (b) trigger sinkronisasi: hold_expires_at mengikuti payment_deadline.
-- Sisanya logika trigger identik dengan 001_core.sql.
CREATE OR REPLACE FUNCTION sync_calendar_from_booking_slots() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status calendar_slot_status;
  v_source calendar_slot_source;
  v_hold_expires_at TIMESTAMPTZ;
BEGIN
  IF NEW.is_blocking THEN
    SELECT CASE WHEN b.lifecycle_status = 'confirmed' THEN 'booked'::calendar_slot_status
                ELSE 'held'::calendar_slot_status END,
           CASE WHEN b.lifecycle_status = 'confirmed' THEN NULL
                ELSE b.payment_deadline END
      INTO v_status, v_hold_expires_at
      FROM bookings b WHERE b.id = NEW.booking_id;

    v_source := 'booking';
    INSERT INTO calendar_slots (vendor_id, date, session, status, source, booking_id,
                                hold_expires_at, updated_by)
    VALUES (NEW.vendor_id, NEW.date, NEW.session, v_status, v_source, NEW.booking_id,
            v_hold_expires_at, NULL)
    ON CONFLICT (vendor_id, date, session) DO UPDATE
      SET status = EXCLUDED.status,
          source = EXCLUDED.source,
          booking_id = EXCLUDED.booking_id,
          hold_expires_at = EXCLUDED.hold_expires_at,
          updated_at = now()
      WHERE calendar_slots.status IN ('available','held','blocked');
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================
-- F01 — Trigger kombinasi 3 sumbu: TANPA PERUBAHAN
-- `assert_booking_combination` di 001_core.sql sudah:
--   - menerima pasangan ('confirmed','dp_paid') pada daftar VALUES;
--   - mengizinkan settlement 'held' bila
--     payment_status IN ('dp_paid','fully_paid','partially_refunded') dan
--     lifecycle_status IN ('confirmed','in_progress','completed','no_show','cancelled','expired').
-- Maka `confirmed + dp_paid + held` SUDAH legal, dan `confirmed + dp_paid +
-- not_eligible` ditolak (wajib 'held') — konsisten dengan D-18.
-- Trigger tidak dilemahkan; tidak ada DDL untuk F01 (perbaikan sisi kode
-- ada di paket lain).
-- Catatan: 'partially_paid' yang disebut pada temuan audit bukan nilai enum
-- `booking_payment_status` (unpaid, dp_paid, fully_paid, partially_refunded,
-- refunded) sehingga tidak ada nilai enum baru yang ditambahkan.
-- ============================================================
