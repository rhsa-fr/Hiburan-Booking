-- 017: refund maker-checker evidence + customer account deletion requests.
--
-- Refund rows already carry requested_by/approved_by and the
-- `approved_by <> requested_by` check from 001. This migration only adds the
-- evidence trail the admin panel needs (FR-133) and an index for the
-- refund-status read route.
--
-- Account deletion (FR-101) anonymises the user row instead of deleting it:
-- bookings, payments, refunds and payouts keep their foreign keys, while the
-- personal data is removed and the request is recorded for audit.

ALTER TABLE refunds ADD COLUMN IF NOT EXISTS evidence_url TEXT;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS review_note TEXT;

CREATE INDEX IF NOT EXISTS refunds_payment_idx ON refunds (payment_id, created_at DESC);

ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS account_deletion_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status       VARCHAR(12) NOT NULL DEFAULT 'completed'
               CHECK (status IN ('requested','completed','cancelled')),
  reason       TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CHECK (status <> 'completed' OR completed_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS account_deletion_requests_user_idx
  ON account_deletion_requests (user_id, requested_at DESC);

-- ---------------------------------------------------------------------------
-- FR-002/FR-003: vendor self-registration application.
--
-- The customer keeps the `customer` role until an admin approves the
-- application; approval creates the vendor row, grants `vendor_owner`, and
-- stores the private KTP key on `vendors.ktp_object_key`. The file itself never
-- goes to the public `/v1/media` directory.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS vendor_applications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status          VARCHAR(12) NOT NULL DEFAULT 'submitted'
                  CHECK (status IN ('draft','submitted','approved','rejected')),
  display_name    VARCHAR(150) NOT NULL,
  legal_name      VARCHAR(150) NOT NULL,
  nik             VARCHAR(16) NOT NULL CHECK (nik ~ '^[0-9]{16}$'),
  region_code     VARCHAR(10) NOT NULL REFERENCES regions(code),
  base_address    TEXT NOT NULL,
  ktp_object_key  TEXT NOT NULL,
  review_note     TEXT,
  reviewed_by     UUID REFERENCES users(id),
  reviewed_at     TIMESTAMPTZ,
  vendor_id       UUID REFERENCES vendors(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One open application per account; rejected applications can be replaced.
CREATE UNIQUE INDEX IF NOT EXISTS vendor_applications_one_open
  ON vendor_applications (user_id) WHERE status IN ('draft','submitted');
CREATE INDEX IF NOT EXISTS vendor_applications_status_idx
  ON vendor_applications (status, created_at DESC);

DROP TRIGGER IF EXISTS vendor_applications_set_updated_at ON vendor_applications;
CREATE TRIGGER vendor_applications_set_updated_at
  BEFORE UPDATE ON vendor_applications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
