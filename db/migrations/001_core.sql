-- ============================================================
-- 001_core — Tarlink core schema
-- Source: TECH-DESIGN-v1.0 §5 (DDL PostgreSQL 15) and §6 (ledger).
-- Money: BIGINT rupiah only (D-09). No fractional money type anywhere.
--
-- Scope note: `bookings` has NOT NULL foreign keys to `events` and
-- `policy_versions` (§5.7/§5.8), so both prerequisite tables are created here.
-- Reference tables that no required table depends on (categories,
-- vendor_categories, package_addons, booking_addons, payouts, ...) are left to
-- their own migrations.
--
-- DOWN: IRREVERSIBLE for data. Money and audit tables are append-only; there
-- is no supported rollback after the first booking. On an empty database drop
-- the objects in reverse dependency order.
-- ============================================================

-- §5.2 ekstensi & tipe
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role                  AS ENUM ('customer','vendor_owner','vendor_member','admin_support','admin_finance','admin_super');
CREATE TYPE vendor_verification_status AS ENUM ('pending','approved','rejected','suspended');
CREATE TYPE bank_account_status        AS ENUM ('pending','verified','rejected');
CREATE TYPE booking_lifecycle_status   AS ENUM ('requested','countered','accepted','confirmed','in_progress','completed','cancelled','rejected','expired','no_show');
CREATE TYPE booking_payment_status     AS ENUM ('unpaid','dp_paid','fully_paid','partially_refunded','refunded');
CREATE TYPE booking_settlement_status  AS ENUM ('not_eligible','held','disputed','released','clawed_back');
CREATE TYPE status_axis                AS ENUM ('lifecycle','payment','settlement');
CREATE TYPE calendar_slot_status       AS ENUM ('available','blocked','held','booked');
CREATE TYPE calendar_slot_source       AS ENUM ('vendor','offline_job','admin','booking','system');
CREATE TYPE payment_kind               AS ENUM ('dp','settlement');
CREATE TYPE payment_status             AS ENUM ('pending','paid','failed','expired');
CREATE TYPE refund_status              AS ENUM ('requested','approved','processing','succeeded','failed','rejected');
CREATE TYPE fee_bearer                 AS ENUM ('customer','vendor','platform');
CREATE TYPE dispute_status             AS ENUM ('open','investigating','awaiting_evidence','resolved','rejected');
CREATE TYPE dispute_resolution         AS ENUM ('refund_full','refund_partial','release_to_vendor','split','no_action');
CREATE TYPE outbox_status              AS ENUM ('pending','processing','sent','failed','dead');
CREATE TYPE webhook_status             AS ENUM ('received','processing','processed','ignored','failed','dead');
CREATE TYPE account_type               AS ENUM ('asset','liability','equity','revenue','expense');
CREATE TYPE normal_balance             AS ENUM ('debit','credit');
CREATE TYPE event_status               AS ENUM ('draft','open','partially_booked','fully_booked','completed','cancelled');

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ============================================================
-- M-0002: regions, users, peran
-- ============================================================
CREATE TABLE regions (
  code          VARCHAR(10) PRIMARY KEY,
  name          VARCHAR(120) NOT NULL,
  level         VARCHAR(12) NOT NULL CHECK (level IN ('province','regency','city','district','village')),
  parent_code   VARCHAR(10) REFERENCES regions(code) ON DELETE RESTRICT,
  timezone      TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  centroid      geography(Point,4326),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  sort_order    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (parent_code IS NULL OR parent_code <> code)
);
CREATE INDEX regions_parent_idx ON regions (parent_code, sort_order);
CREATE INDEX regions_active_idx ON regions (level, is_active);

CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone             VARCHAR(20) NOT NULL UNIQUE,
  phone_verified_at TIMESTAMPTZ,
  name              VARCHAR(100),
  email             VARCHAR(150),
  avatar_object_key TEXT,
  language          VARCHAR(5) NOT NULL DEFAULT 'id' CHECK (language IN ('id','jv','su')),
  status            VARCHAR(12) NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  last_login_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_uniq ON users (lower(email)) WHERE email IS NOT NULL;

-- ============================================================
-- M-0003: vendor & anggota
-- ============================================================
CREATE TABLE vendors (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id          UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  region_code            VARCHAR(10) NOT NULL REFERENCES regions(code),
  slug                   VARCHAR(160) NOT NULL UNIQUE,
  display_name           VARCHAR(150) NOT NULL,
  legal_name             VARCHAR(150),
  description            TEXT,
  base_address           TEXT,
  base_location          geography(Point,4326),
  timezone               TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  service_radius_km      INT CHECK (service_radius_km BETWEEN 0 AND 500),
  free_radius_km         INT NOT NULL DEFAULT 0 CHECK (free_radius_km >= 0),
  transport_fee_per_km_idr BIGINT NOT NULL DEFAULT 0 CHECK (transport_fee_per_km_idr >= 0),
  min_dp_bp              INT NOT NULL DEFAULT 3000 CHECK (min_dp_bp BETWEEN 0 AND 10000),
  verification_status    vendor_verification_status NOT NULL DEFAULT 'pending',
  verification_note      TEXT,
  verified_at            TIMESTAMPTZ,
  verified_by            UUID REFERENCES users(id),
  ktp_object_key         TEXT,
  npwp_encrypted         BYTEA,
  encryption_key_id      VARCHAR(40),
  rating_sum             INT NOT NULL DEFAULT 0 CHECK (rating_sum >= 0),
  rating_count           INT NOT NULL DEFAULT 0 CHECK (rating_count >= 0),
  response_rate_bp       INT CHECK (response_rate_bp BETWEEN 0 AND 10000),
  calendar_updated_at    TIMESTAMPTZ,
  is_active              BOOLEAN NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (rating_count > 0 OR rating_sum = 0),
  CHECK (verification_status <> 'approved' OR verified_at IS NOT NULL)
);
CREATE INDEX vendors_location_gist      ON vendors USING gist (base_location);
CREATE INDEX vendors_region_idx         ON vendors (region_code, verification_status, is_active);
CREATE INDEX vendors_rating_idx         ON vendors (verification_status, rating_sum DESC, rating_count DESC) WHERE is_active;
CREATE INDEX vendors_owner_idx          ON vendors (owner_user_id);
CREATE INDEX vendors_calendar_stale_idx ON vendors (calendar_updated_at) WHERE is_active;

CREATE TABLE user_roles (
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role         user_role NOT NULL,
  vendor_id    UUID,
  vendor_scope UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  granted_by   UUID REFERENCES users(id),
  granted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at   TIMESTAMPTZ,
  PRIMARY KEY (user_id, role, vendor_scope),
  CHECK (
    (role IN ('customer','admin_support','admin_finance','admin_super')
       AND vendor_id IS NULL
       AND vendor_scope = '00000000-0000-0000-0000-000000000000')
    OR
    (role IN ('vendor_owner','vendor_member')
       AND vendor_id IS NOT NULL
       AND vendor_scope = vendor_id)
  )
);
CREATE INDEX user_roles_role_idx ON user_roles (role) WHERE revoked_at IS NULL;

CREATE TABLE vendor_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id  UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  name       VARCHAR(100) NOT NULL,
  role_title VARCHAR(50),
  can_respond BOOLEAN NOT NULL DEFAULT false,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX vendor_members_vendor_idx ON vendor_members (vendor_id, is_active);
CREATE UNIQUE INDEX vendor_members_user_uniq ON vendor_members (vendor_id, user_id) WHERE user_id IS NOT NULL;

ALTER TABLE user_roles
  ADD CONSTRAINT user_roles_vendor_fk FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE RESTRICT;

-- ============================================================
-- M-0004: rekening bank vendor terverifikasi
-- ============================================================
CREATE TABLE vendor_bank_accounts (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id                 UUID NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  bank_code                 VARCHAR(10) NOT NULL,
  bank_name                 VARCHAR(60) NOT NULL,
  account_number_encrypted  BYTEA NOT NULL,
  account_number_masked     VARCHAR(30) NOT NULL,
  account_number_hash       CHAR(64) NOT NULL,
  account_holder_name       VARCHAR(100) NOT NULL,
  encryption_key_id         VARCHAR(40) NOT NULL,
  status                    bank_account_status NOT NULL DEFAULT 'pending',
  cooling_until             TIMESTAMPTZ NOT NULL,
  verified_at               TIMESTAMPTZ,
  verified_by               UUID REFERENCES users(id),
  rejection_reason          TEXT,
  created_by                UUID NOT NULL REFERENCES users(id),
  superseded_at             TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, account_number_hash),
  CHECK (status <> 'verified' OR verified_at IS NOT NULL),
  CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL)
);
CREATE UNIQUE INDEX vendor_bank_accounts_one_verified
  ON vendor_bank_accounts (vendor_id)
  WHERE status = 'verified' AND superseded_at IS NULL;
CREATE INDEX vendor_bank_accounts_vendor_idx ON vendor_bank_accounts (vendor_id, status);

-- ============================================================
-- M-0005: paket
-- ============================================================
CREATE TABLE packages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id         UUID NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  name              VARCHAR(150) NOT NULL,
  description       TEXT,
  duration_minutes  INT NOT NULL CHECK (duration_minutes BETWEEN 30 AND 1440),
  personnel_count   INT CHECK (personnel_count BETWEEN 1 AND 200),
  inclusions        JSONB NOT NULL DEFAULT '[]'::jsonb,
  base_price_idr    BIGINT NOT NULL CHECK (base_price_idr > 0),
  currency          CHAR(3) NOT NULL DEFAULT 'IDR',
  is_active         BOOLEAN NOT NULL DEFAULT true,
  version           INT NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, name),
  CHECK (currency = 'IDR')
);
CREATE INDEX packages_vendor_active_idx ON packages (vendor_id, is_active, base_price_idr);

-- ============================================================
-- M-0006: events (prasyarat bookings)
-- ============================================================
CREATE TABLE events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code              VARCHAR(24) NOT NULL UNIQUE,
  customer_id       UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  parent_event_id   UUID REFERENCES events(id) ON DELETE RESTRICT,
  title             VARCHAR(150) NOT NULL,
  event_type        VARCHAR(50),
  region_code       VARCHAR(10) NOT NULL REFERENCES regions(code),
  venue_name        VARCHAR(150),
  venue_address     TEXT NOT NULL,
  venue_location    geography(Point,4326),
  start_date        DATE NOT NULL,
  end_date          DATE NOT NULL,
  timezone          TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  guest_estimate    INT CHECK (guest_estimate BETWEEN 0 AND 100000),
  notes             TEXT,
  status            event_status NOT NULL DEFAULT 'draft',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  CHECK (end_date - start_date <= 30),
  CHECK (parent_event_id IS NULL OR parent_event_id <> id)
);
CREATE INDEX events_customer_idx ON events (customer_id, start_date DESC);
CREATE INDEX events_parent_idx   ON events (parent_event_id) WHERE parent_event_id IS NOT NULL;
CREATE INDEX events_region_idx   ON events (region_code, start_date);

-- ============================================================
-- M-0007: policy_versions (prasyarat bookings, D-12)
-- ============================================================
CREATE TABLE policy_versions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code           VARCHAR(40) NOT NULL,
  version        INT NOT NULL CHECK (version > 0),
  body           JSONB NOT NULL,
  body_hash      CHAR(64) NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to   TIMESTAMPTZ,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_by     UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (code, version),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE UNIQUE INDEX policy_versions_one_active ON policy_versions (code) WHERE is_active AND effective_to IS NULL;

-- ============================================================
-- M-0007: booking (3 sumbu) & slot
-- ============================================================
CREATE TABLE bookings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  VARCHAR(24) NOT NULL UNIQUE,
  customer_id           UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  vendor_id             UUID NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  event_id              UUID NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  package_id            UUID NOT NULL REFERENCES packages(id) ON DELETE RESTRICT,
  lifecycle_status      booking_lifecycle_status NOT NULL DEFAULT 'requested',
  payment_status        booking_payment_status NOT NULL DEFAULT 'unpaid',
  settlement_status     booking_settlement_status NOT NULL DEFAULT 'not_eligible',
  currency              CHAR(3) NOT NULL DEFAULT 'IDR',
  price_package_idr     BIGINT NOT NULL CHECK (price_package_idr > 0),
  price_addons_idr      BIGINT NOT NULL DEFAULT 0 CHECK (price_addons_idr >= 0),
  price_transport_idr   BIGINT NOT NULL DEFAULT 0 CHECK (price_transport_idr >= 0),
  service_fee_idr       BIGINT NOT NULL DEFAULT 0 CHECK (service_fee_idr >= 0),
  discount_idr          BIGINT NOT NULL DEFAULT 0 CHECK (discount_idr >= 0),
  commission_bp             INT NOT NULL DEFAULT 1000 CHECK (commission_bp BETWEEN 0 AND 5000),
  commission_threshold_idr  BIGINT NOT NULL DEFAULT 10000000 CHECK (commission_threshold_idr >= 0),
  commission_bp_tier2       INT NOT NULL DEFAULT 500 CHECK (commission_bp_tier2 BETWEEN 0 AND 5000),
  commission_min_idr        BIGINT NOT NULL DEFAULT 25000 CHECK (commission_min_idr >= 0),
  commission_cap_idr        BIGINT NOT NULL DEFAULT 7500000 CHECK (commission_cap_idr >= 0),
  commission_tier1_idr      BIGINT NOT NULL DEFAULT 0 CHECK (commission_tier1_idr >= 0),
  commission_tier2_idr      BIGINT NOT NULL DEFAULT 0 CHECK (commission_tier2_idr >= 0),
  commission_idr            BIGINT NOT NULL DEFAULT 0 CHECK (commission_idr >= 0),
  total_customer_idr    BIGINT NOT NULL CHECK (total_customer_idr > 0),
  dp_amount_idr         BIGINT NOT NULL DEFAULT 0 CHECK (dp_amount_idr >= 0),
  vendor_entitlement_idr BIGINT NOT NULL DEFAULT 0 CHECK (vendor_entitlement_idr >= 0),
  pricing_snapshot      JSONB NOT NULL DEFAULT '{}'::jsonb,
  policy_version_id     UUID NOT NULL REFERENCES policy_versions(id),
  respond_deadline      TIMESTAMPTZ NOT NULL,
  counter_deadline      TIMESTAMPTZ,
  payment_deadline      TIMESTAMPTZ,
  scheduled_start_at    TIMESTAMPTZ,
  scheduled_end_at      TIMESTAMPTZ,
  checkin_at            TIMESTAMPTZ,
  checkin_location      geography(Point,4326),
  confirmed_at          TIMESTAMPTZ,
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  completed_by          VARCHAR(10) CHECK (completed_by IN ('customer','system','admin')),
  cancelled_at          TIMESTAMPTZ,
  cancelled_by          VARCHAR(10) CHECK (cancelled_by IN ('customer','vendor','admin','system')),
  cancel_reason         VARCHAR(80),
  no_show_at            TIMESTAMPTZ,
  released_at           TIMESTAMPTZ,
  clawback_recovered_at TIMESTAMPTZ,
  dispute_window_ends_at TIMESTAMPTZ,
  started_without_checkin BOOLEAN NOT NULL DEFAULT false,
  row_version           INT NOT NULL DEFAULT 1,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (currency = 'IDR'),
  CHECK (total_customer_idr = price_package_idr + price_addons_idr + price_transport_idr + service_fee_idr - discount_idr),
  CHECK (dp_amount_idr <= total_customer_idr),
  CHECK (scheduled_end_at IS NULL OR scheduled_start_at IS NULL OR scheduled_end_at > scheduled_start_at),
  CHECK (commission_idr <= total_customer_idr),
  CHECK (commission_min_idr <= commission_cap_idr),
  CHECK (commission_idr = 0 OR commission_idr >= commission_min_idr),
  CHECK (commission_idr = 0 OR commission_idr =
         LEAST(commission_cap_idr, GREATEST(commission_min_idr, commission_tier1_idr + commission_tier2_idr))),
  CHECK (settlement_status NOT IN ('released','clawed_back') OR released_at IS NOT NULL),
  CHECK (lifecycle_status <> 'cancelled' OR cancelled_at IS NOT NULL)
);
CREATE INDEX bookings_vendor_idx     ON bookings (vendor_id, created_at DESC);
CREATE INDEX bookings_customer_idx   ON bookings (customer_id, created_at DESC);
CREATE INDEX bookings_expiry_idx     ON bookings (lifecycle_status, respond_deadline) WHERE lifecycle_status IN ('requested','countered');
CREATE INDEX bookings_dp_expiry_idx  ON bookings (lifecycle_status, payment_deadline) WHERE lifecycle_status = 'accepted';
CREATE INDEX bookings_settlement_idx ON bookings (settlement_status, released_at) WHERE settlement_status IN ('held','released','disputed');
CREATE INDEX bookings_auto_complete_idx ON bookings (scheduled_end_at) WHERE lifecycle_status IN ('confirmed','in_progress');
CREATE INDEX bookings_event_idx      ON bookings (event_id);

CREATE TABLE booking_slots (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  UUID NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  vendor_id   UUID NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  date        DATE NOT NULL,
  session     VARCHAR(8) NOT NULL CHECK (session IN ('day','night','full')),
  session_span int4range NOT NULL,
  start_time  TIME,
  end_time    TIME,
  is_blocking BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (booking_id, date, session),
  CHECK (end_time IS NULL OR start_time IS NULL OR end_time > start_time),
  CONSTRAINT booking_slots_no_double_booking
    EXCLUDE USING gist (vendor_id WITH =, date WITH =, session WITH =)
    WHERE (is_blocking),
  CONSTRAINT booking_slots_no_overlap_span
    EXCLUDE USING gist (vendor_id WITH =, date WITH =, session_span WITH &&)
    WHERE (is_blocking)
);
CREATE INDEX booking_slots_vendor_date_idx ON booking_slots (vendor_id, date, session);
CREATE INDEX booking_slots_booking_idx     ON booking_slots (booking_id);

CREATE TABLE booking_status_history (
  id           BIGSERIAL PRIMARY KEY,
  booking_id   UUID NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  axis         status_axis NOT NULL,
  from_state   VARCHAR(30),
  to_state     VARCHAR(30) NOT NULL,
  event        VARCHAR(50) NOT NULL,
  actor_id     UUID REFERENCES users(id),
  actor_role   user_role,
  request_id   VARCHAR(40),
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX booking_status_history_booking_idx ON booking_status_history (booking_id, id);

CREATE TABLE calendar_slots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id       UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  session         VARCHAR(8) NOT NULL CHECK (session IN ('day','night','full')),
  status          calendar_slot_status NOT NULL DEFAULT 'available',
  source          calendar_slot_source NOT NULL DEFAULT 'vendor',
  booking_id      UUID REFERENCES bookings(id) ON DELETE SET NULL,
  start_time      TIME,
  end_time        TIME,
  hold_expires_at TIMESTAMPTZ,
  note            VARCHAR(200),
  updated_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, date, session),
  CHECK (status <> 'held' OR hold_expires_at IS NOT NULL),
  CHECK (status NOT IN ('held','booked') OR booking_id IS NOT NULL),
  CHECK (status <> 'available' OR booking_id IS NULL),
  CONSTRAINT calendar_slots_no_double_hold
    EXCLUDE USING gist (vendor_id WITH =, date WITH =, session WITH =)
    WHERE (status IN ('held','booked'))
);
CREATE INDEX calendar_slots_vendor_range_idx ON calendar_slots (vendor_id, date);
CREATE INDEX calendar_slots_date_status_idx  ON calendar_slots (date, status);
CREATE INDEX calendar_slots_hold_expiry_idx  ON calendar_slots (hold_expires_at) WHERE status = 'held';

-- ============================================================
-- M-0008: payments & refunds
-- ============================================================
CREATE TABLE payments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id       UUID NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  kind             payment_kind NOT NULL,
  method           VARCHAR(30) NOT NULL CHECK (method IN ('qris','va_bca','va_bni','va_bri','va_mandiri','gopay','ovo','dana','shopeepay')),
  amount_idr       BIGINT NOT NULL CHECK (amount_idr > 0),
  currency         CHAR(3) NOT NULL DEFAULT 'IDR',
  status           payment_status NOT NULL DEFAULT 'pending',
  provider         VARCHAR(30) NOT NULL,
  provider_ref     VARCHAR(120),
  provider_txn_id  VARCHAR(120),
  fee_idr          BIGINT NOT NULL DEFAULT 0 CHECK (fee_idr >= 0),
  expires_at       TIMESTAMPTZ,
  paid_at          TIMESTAMPTZ,
  failure_code     VARCHAR(60),
  raw_payload      JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (currency = 'IDR'),
  UNIQUE (provider, provider_ref)
);
CREATE UNIQUE INDEX payments_one_active_dp
  ON payments (booking_id) WHERE kind = 'dp' AND status IN ('pending','paid');
CREATE INDEX payments_booking_idx ON payments (booking_id, status);
CREATE INDEX payments_pending_expiry_idx ON payments (expires_at) WHERE status = 'pending';

CREATE TABLE refunds (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id         UUID NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  payment_id         UUID NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  amount_idr         BIGINT NOT NULL CHECK (amount_idr > 0),
  currency           CHAR(3) NOT NULL DEFAULT 'IDR',
  fee_idr            BIGINT NOT NULL DEFAULT 0 CHECK (fee_idr >= 0),
  fee_bearer         fee_bearer NOT NULL,
  status             refund_status NOT NULL DEFAULT 'requested',
  reason_code        VARCHAR(40) NOT NULL,
  reason_note        TEXT,
  policy_version_id  UUID REFERENCES policy_versions(id),
  computed_percent_bp INT CHECK (computed_percent_bp BETWEEN 0 AND 10000),
  provider_ref       VARCHAR(120),
  provider_refund_id VARCHAR(120),
  requested_by       UUID REFERENCES users(id),
  approved_by        UUID REFERENCES users(id),
  approved_at        TIMESTAMPTZ,
  processed_at       TIMESTAMPTZ,
  failure_code       VARCHAR(60),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (currency = 'IDR'),
  CHECK (approved_by IS NULL OR approved_by <> requested_by)
);
CREATE UNIQUE INDEX refunds_one_inflight
  ON refunds (booking_id) WHERE status IN ('requested','approved','processing');
CREATE INDEX refunds_booking_idx ON refunds (booking_id, created_at DESC);

-- ============================================================
-- M-0013: webhook dedupe
-- ============================================================
CREATE TABLE webhook_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          VARCHAR(30) NOT NULL,
  external_id       VARCHAR(160) NOT NULL,
  event_type        VARCHAR(60) NOT NULL,
  provider_sequence BIGINT,
  payload           JSONB NOT NULL,
  headers           JSONB NOT NULL DEFAULT '{}'::jsonb,
  signature_valid   BOOLEAN NOT NULL,
  status            webhook_status NOT NULL DEFAULT 'received',
  attempts          SMALLINT NOT NULL DEFAULT 0,
  last_error        TEXT,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at      TIMESTAMPTZ,
  UNIQUE (provider, external_id)
);
CREATE INDEX webhook_events_pending_idx ON webhook_events (received_at) WHERE status IN ('received','failed');
CREATE INDEX webhook_events_type_idx    ON webhook_events (provider, event_type, received_at);

-- ============================================================
-- M-0011: chart of accounts, journal
-- ============================================================
CREATE TABLE chart_of_accounts (
  code           VARCHAR(40) PRIMARY KEY,
  name           VARCHAR(100) NOT NULL,
  account_type   account_type NOT NULL,
  normal_balance normal_balance NOT NULL,
  is_vendor_scoped BOOLEAN NOT NULL DEFAULT false,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  description    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE journal_entries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_no         BIGSERIAL NOT NULL UNIQUE,
  event_type       VARCHAR(40) NOT NULL CHECK (event_type IN
                     ('dp_received','settlement_received','fee_charged','fee_recovered',
                      'release','refund_recognized','refund_disbursed','payout_requested',
                      'payout_settled','clawback_recognized','clawback_paid',
                      'margin_sweep','bad_debt_writeoff','adjustment','reversal')),
  source_event_key VARCHAR(160) NOT NULL UNIQUE,
  reference_type   VARCHAR(30) NOT NULL CHECK (reference_type IN
                     ('payment','refund','booking','payout','dispute','adjustment')),
  reference_id     UUID,
  booking_id       UUID REFERENCES bookings(id) ON DELETE RESTRICT,
  vendor_id        UUID REFERENCES vendors(id) ON DELETE RESTRICT,
  currency         CHAR(3) NOT NULL DEFAULT 'IDR',
  rounding_idr     BIGINT NOT NULL DEFAULT 0,
  reverses_entry_id UUID REFERENCES journal_entries(id) ON DELETE RESTRICT,
  memo             TEXT,
  occurred_at      TIMESTAMPTZ NOT NULL,
  created_by       UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (currency = 'IDR'),
  CHECK (event_type <> 'reversal' OR reverses_entry_id IS NOT NULL)
);
CREATE INDEX journal_entries_booking_idx ON journal_entries (booking_id, id);
CREATE INDEX journal_entries_vendor_idx  ON journal_entries (vendor_id, occurred_at);
CREATE INDEX journal_entries_occurred_idx ON journal_entries (occurred_at);

CREATE TABLE journal_lines (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE RESTRICT,
  line_no          SMALLINT NOT NULL CHECK (line_no > 0),
  account_code     VARCHAR(40) NOT NULL REFERENCES chart_of_accounts(code) ON DELETE RESTRICT,
  vendor_id        UUID REFERENCES vendors(id) ON DELETE RESTRICT,
  debit_idr        BIGINT NOT NULL DEFAULT 0 CHECK (debit_idr >= 0),
  credit_idr       BIGINT NOT NULL DEFAULT 0 CHECK (credit_idr >= 0),
  currency         CHAR(3) NOT NULL DEFAULT 'IDR',
  memo             TEXT,
  UNIQUE (journal_entry_id, line_no),
  CHECK (currency = 'IDR'),
  CHECK ((debit_idr > 0 AND credit_idr = 0) OR (credit_idr > 0 AND debit_idr = 0))
);
CREATE INDEX journal_lines_entry_idx   ON journal_lines (journal_entry_id);
CREATE INDEX journal_lines_account_idx ON journal_lines (account_code, journal_entry_id);
CREATE INDEX journal_lines_vendor_idx  ON journal_lines (vendor_id, account_code) WHERE vendor_id IS NOT NULL;

-- ============================================================
-- M-0013: idempotency & outbox
-- ============================================================
CREATE TABLE idempotency_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id        UUID REFERENCES users(id) ON DELETE RESTRICT,
  scope           VARCHAR(80) NOT NULL,
  key             VARCHAR(80) NOT NULL,
  request_hash    CHAR(64) NOT NULL,
  status          VARCHAR(12) NOT NULL DEFAULT 'in_progress'
                    CHECK (status IN ('in_progress','completed','failed')),
  response_status SMALLINT CHECK (response_status BETWEEN 100 AND 599),
  response_body   JSONB,
  locked_until    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  UNIQUE NULLS NOT DISTINCT (actor_id, scope, key),
  CHECK (length(key) BETWEEN 16 AND 80),
  CHECK (status <> 'completed' OR response_status IS NOT NULL)
);
CREATE INDEX idempotency_expiry_idx ON idempotency_keys (expires_at);

CREATE TABLE outbox_messages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type    VARCHAR(40) NOT NULL,
  aggregate_id      UUID NOT NULL,
  aggregate_version INT NOT NULL DEFAULT 1,
  event_type        VARCHAR(60) NOT NULL,
  payload           JSONB NOT NULL,
  dedupe_key        VARCHAR(160) NOT NULL UNIQUE,
  status            outbox_status NOT NULL DEFAULT 'pending',
  attempts          SMALLINT NOT NULL DEFAULT 0,
  available_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at         TIMESTAMPTZ,
  locked_by         VARCHAR(60),
  last_error        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at           TIMESTAMPTZ
);
CREATE INDEX outbox_pending_idx ON outbox_messages (available_at, id) WHERE status IN ('pending','failed');

-- ============================================================
-- M-0014: platform settings & audit log
-- ============================================================
CREATE TABLE platform_settings (
  key         VARCHAR(80) PRIMARY KEY,
  value       JSONB NOT NULL,
  is_public   BOOLEAN NOT NULL DEFAULT false,
  description TEXT,
  updated_by  UUID REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  seq          BIGSERIAL PRIMARY KEY,
  id           UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  actor_id     UUID REFERENCES users(id),
  actor_role   user_role,
  action       VARCHAR(100) NOT NULL,
  entity_type  VARCHAR(40) NOT NULL,
  entity_id    VARCHAR(64),
  before_state JSONB,
  after_state  JSONB,
  ip_hash      CHAR(64),
  user_agent   TEXT,
  request_id   VARCHAR(40),
  prev_hash    CHAR(64) NOT NULL,
  row_hash     CHAR(64) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX audit_logs_actor_idx  ON audit_logs (actor_id, created_at DESC);
CREATE INDEX audit_logs_action_idx ON audit_logs (action, created_at DESC);

-- ============================================================
-- M-0010: disputes
-- ============================================================
CREATE TABLE disputes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id          UUID NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  raised_by           UUID NOT NULL REFERENCES users(id),
  reason_code         VARCHAR(40) NOT NULL CHECK (reason_code IN
                        ('no_show','not_as_described','late_arrival','fraud','quality','cancellation_abuse','other')),
  description         TEXT NOT NULL,
  status              dispute_status NOT NULL DEFAULT 'open',
  resolution          dispute_resolution,
  resolution_amount_idr BIGINT NOT NULL DEFAULT 0 CHECK (resolution_amount_idr >= 0),
  customer_share_idr  BIGINT NOT NULL DEFAULT 0 CHECK (customer_share_idr >= 0),
  vendor_share_idr    BIGINT NOT NULL DEFAULT 0 CHECK (vendor_share_idr >= 0),
  opened_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  sla_due_at          TIMESTAMPTZ NOT NULL,
  resolved_at         TIMESTAMPTZ,
  resolved_by         UUID REFERENCES users(id),
  approved_by         UUID REFERENCES users(id),
  resolution_note     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (approved_by IS NULL OR approved_by <> resolved_by),
  CHECK (status <> 'resolved' OR (resolution IS NOT NULL AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL)),
  CHECK (status <> 'resolved' OR customer_share_idr + vendor_share_idr = resolution_amount_idr)
);
CREATE UNIQUE INDEX disputes_one_open_per_booking
  ON disputes (booking_id) WHERE status IN ('open','investigating','awaiting_evidence');
CREATE INDEX disputes_queue_idx ON disputes (status, sla_due_at);

-- ============================================================
-- M-0015: trigger integritas (urutan §5.18)
-- ============================================================

-- (1) updated_at otomatis
CREATE TRIGGER trg_vendors_touch        BEFORE UPDATE ON vendors        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_bookings_touch       BEFORE UPDATE ON bookings       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_calendar_slots_touch BEFORE UPDATE ON calendar_slots FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_booking_slots_touch  BEFORE UPDATE ON booking_slots  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_packages_touch       BEFORE UPDATE ON packages       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_payments_touch       BEFORE UPDATE ON payments       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_disputes_touch       BEFORE UPDATE ON disputes       FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- (2) session_span dari session (dipakai exclusion constraint)
CREATE OR REPLACE FUNCTION booking_slots_set_span() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.session_span := CASE NEW.session
    WHEN 'day'   THEN int4range(1, 2, '[)')
    WHEN 'night' THEN int4range(2, 3, '[)')
    ELSE              int4range(1, 3, '[)')
  END;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_booking_slots_span
  BEFORE INSERT OR UPDATE OF session ON booking_slots
  FOR EACH ROW EXECUTE FUNCTION booking_slots_set_span();

-- (2b) slot yang diblokir vendor tidak boleh di-accept
CREATE OR REPLACE FUNCTION assert_booking_slot_calendar_available() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status  calendar_slot_status;
  v_booking UUID;
BEGIN
  IF NOT NEW.is_blocking THEN
    RETURN NEW;
  END IF;

  SELECT status, booking_id INTO v_status, v_booking
    FROM calendar_slots
   WHERE vendor_id = NEW.vendor_id
     AND date = NEW.date
     AND session = NEW.session
   FOR UPDATE;

  IF FOUND AND v_status = 'blocked' THEN
    RAISE EXCEPTION 'slot % % % diblokir vendor', NEW.vendor_id, NEW.date, NEW.session
      USING ERRCODE = '23514';
  END IF;

  IF FOUND AND v_status IN ('held','booked')
     AND v_booking IS DISTINCT FROM NEW.booking_id THEN
    RAISE EXCEPTION 'slot % % % sudah dipegang booking lain', NEW.vendor_id, NEW.date, NEW.session
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_booking_slots_calendar_guard
  BEFORE INSERT OR UPDATE OF is_blocking ON booking_slots
  FOR EACH ROW EXECUTE FUNCTION assert_booking_slot_calendar_available();

-- (3) sinkronisasi calendar_slots dari booking_slots
-- Hold expiry follows D-18: `calendar_slots.hold_expires_at = payment_deadline`
-- (§4.3 L-03). The 2h value is only a fallback for rows without a deadline.
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
                ELSE COALESCE(b.payment_deadline, now() + interval '2 hours') END
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
CREATE TRIGGER trg_booking_slots_sync_calendar
  AFTER INSERT OR UPDATE OF is_blocking ON booking_slots
  FOR EACH ROW EXECUTE FUNCTION sync_calendar_from_booking_slots();

-- (4) total debit = total kredit per journal entry (deferred)
CREATE OR REPLACE FUNCTION assert_journal_entry_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_debit  BIGINT;
  v_credit BIGINT;
BEGIN
  SELECT COALESCE(SUM(debit_idr), 0), COALESCE(SUM(credit_idr), 0)
    INTO v_debit, v_credit
    FROM journal_lines
   WHERE journal_entry_id = NEW.journal_entry_id;

  IF v_debit <> v_credit THEN
    RAISE EXCEPTION 'unbalanced journal entry %: debit=% credit=%',
      NEW.journal_entry_id, v_debit, v_credit
      USING ERRCODE = '23514', HINT = 'Setiap entry wajib total debit = total kredit.';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER trg_journal_entry_balanced
  AFTER INSERT OR UPDATE ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_journal_entry_balanced();

-- (5) immutable: journal & audit
CREATE OR REPLACE FUNCTION reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% bersifat append-only; gunakan reversal entry', TG_TABLE_NAME
    USING ERRCODE = '23000';
END;
$$;
CREATE TRIGGER trg_journal_entries_immutable BEFORE UPDATE OR DELETE ON journal_entries FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER trg_journal_lines_immutable   BEFORE UPDATE OR DELETE ON journal_lines   FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER trg_audit_logs_immutable      BEFORE UPDATE OR DELETE ON audit_logs      FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- (6) hash chain audit log (serialized agar tidak bercabang)
CREATE OR REPLACE FUNCTION audit_logs_chain() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_prev CHAR(64);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('audit_logs_chain'));
  SELECT row_hash INTO v_prev FROM audit_logs ORDER BY seq DESC LIMIT 1;
  NEW.prev_hash := COALESCE(v_prev, repeat('0', 64));
  NEW.row_hash  := encode(digest(
    NEW.prev_hash || NEW.action || NEW.entity_type || COALESCE(NEW.entity_id, '') ||
    COALESCE(NEW.before_state::text, '') || COALESCE(NEW.after_state::text, '') ||
    NEW.created_at::text, 'sha256'), 'hex');
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_audit_logs_chain BEFORE INSERT ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_chain();

-- (7) kombinasi 3 sumbu hanya yang sah
CREATE OR REPLACE FUNCTION assert_booking_combination() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_ok BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM (VALUES
      ('requested','unpaid'),
      ('countered','unpaid'),
      ('accepted','unpaid'),
      ('confirmed','dp_paid'), ('confirmed','fully_paid'), ('confirmed','partially_refunded'),
      ('in_progress','dp_paid'), ('in_progress','fully_paid'), ('in_progress','partially_refunded'),
      ('completed','dp_paid'), ('completed','fully_paid'), ('completed','partially_refunded'), ('completed','refunded'),
      ('cancelled','unpaid'), ('cancelled','dp_paid'), ('cancelled','fully_paid'),
      ('cancelled','partially_refunded'), ('cancelled','refunded'),
      ('rejected','unpaid'),
      ('expired','unpaid'), ('expired','dp_paid'),
      ('no_show','dp_paid'), ('no_show','fully_paid'),
      ('no_show','partially_refunded'), ('no_show','refunded')
    ) AS allowed(l, p)
    WHERE allowed.l = NEW.lifecycle_status::text
      AND allowed.p = NEW.payment_status::text
  ) INTO v_ok;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'illegal booking combination lifecycle=% payment=%',
      NEW.lifecycle_status, NEW.payment_status USING ERRCODE = '23514';
  END IF;

  IF NEW.settlement_status = 'released'
     AND NOT (NEW.lifecycle_status = 'completed'
              AND NEW.payment_status IN ('fully_paid','partially_refunded')) THEN
    RAISE EXCEPTION 'illegal settlement=released for lifecycle=% payment=%',
      NEW.lifecycle_status, NEW.payment_status USING ERRCODE = '23514';
  END IF;

  IF NEW.settlement_status = 'clawed_back'
     AND NOT (NEW.lifecycle_status IN ('completed','no_show')
              AND NEW.payment_status IN ('fully_paid','partially_refunded','refunded')) THEN
    RAISE EXCEPTION 'illegal settlement=clawed_back for lifecycle=% payment=%',
      NEW.lifecycle_status, NEW.payment_status USING ERRCODE = '23514';
  END IF;

  IF NEW.settlement_status = 'not_eligible'
     AND NOT (NEW.payment_status = 'unpaid'
              OR (NEW.lifecycle_status IN ('cancelled','rejected','expired','no_show')
                  AND NEW.payment_status IN ('partially_refunded','refunded'))
              OR (NEW.lifecycle_status = 'completed'
                  AND NEW.payment_status IN ('partially_refunded','refunded'))) THEN
    RAISE EXCEPTION 'illegal settlement=not_eligible for lifecycle=% payment=%',
      NEW.lifecycle_status, NEW.payment_status USING ERRCODE = '23514';
  END IF;

  IF NEW.settlement_status IN ('held','disputed')
     AND NOT (NEW.payment_status IN ('dp_paid','fully_paid','partially_refunded')
              AND NEW.lifecycle_status IN ('confirmed','in_progress','completed','no_show','cancelled','expired')) THEN
    RAISE EXCEPTION 'illegal settlement=% for lifecycle=% payment=%',
      NEW.settlement_status, NEW.lifecycle_status, NEW.payment_status USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_bookings_combination
  BEFORE INSERT OR UPDATE OF lifecycle_status, payment_status, settlement_status ON bookings
  FOR EACH ROW EXECUTE FUNCTION assert_booking_combination();

-- (8) refund tidak boleh melebihi dana diterima
CREATE OR REPLACE FUNCTION assert_refund_within_collected() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_collected BIGINT;
  v_refunded  BIGINT;
BEGIN
  IF NEW.status <> 'succeeded' THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(SUM(amount_idr), 0) INTO v_collected
    FROM payments WHERE booking_id = NEW.booking_id AND status = 'paid';
  SELECT COALESCE(SUM(amount_idr), 0) INTO v_refunded
    FROM refunds WHERE booking_id = NEW.booking_id AND status = 'succeeded' AND id <> NEW.id;
  IF v_refunded + NEW.amount_idr > v_collected THEN
    RAISE EXCEPTION 'refund melebihi dana diterima: collected=% refunded=% baru=%',
      v_collected, v_refunded, NEW.amount_idr USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_refunds_within_collected
  BEFORE INSERT OR UPDATE OF status ON refunds
  FOR EACH ROW EXECUTE FUNCTION assert_refund_within_collected();
