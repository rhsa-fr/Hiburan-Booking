-- FR-122: post-release clawback with maker-checker.
--
-- A clawback is only possible after the vendor payout for the booking has
-- already been settled. The claim window is 30 days from `bookings.released_at`
-- (S-08 guard `within_clawback_window` / PRD FR-122).
--
-- The request and the approval are deliberately two rows of the same record:
-- `requested_by` never equals `decided_by`. Approval posts the ledger entries
-- (`clawback_recognized` + `clawback_paid`), moves the booking to
-- `clawed_back`, and resolves the dispute with `resolution = 'clawback'`.
-- Rejection leaves the dispute open for another decision.
ALTER TYPE dispute_resolution ADD VALUE IF NOT EXISTS 'clawback';

CREATE TABLE IF NOT EXISTS dispute_clawbacks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id       UUID NOT NULL UNIQUE REFERENCES disputes(id) ON DELETE RESTRICT,
  booking_id       UUID NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  vendor_id        UUID NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  amount_idr       BIGINT NOT NULL CHECK (amount_idr > 0),
  status           VARCHAR(12) NOT NULL DEFAULT 'requested'
                     CHECK (status IN ('requested', 'approved', 'rejected')),
  request_note     TEXT NOT NULL CHECK (char_length(request_note) BETWEEN 5 AND 1000),
  requested_by     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  requested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  decision_note    TEXT CHECK (decision_note IS NULL OR char_length(decision_note) BETWEEN 5 AND 1000),
  decided_by       UUID REFERENCES users(id) ON DELETE RESTRICT,
  decided_at       TIMESTAMPTZ,
  journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE RESTRICT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT dispute_clawbacks_maker_checker CHECK (decided_by IS NULL OR decided_by <> requested_by),
  CONSTRAINT dispute_clawbacks_decision_complete CHECK (
    status = 'requested'
    OR (decided_by IS NOT NULL AND decided_at IS NOT NULL AND decision_note IS NOT NULL)
  ),
  CONSTRAINT dispute_clawbacks_approved_has_journal CHECK (
    status <> 'approved' OR journal_entry_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS dispute_clawbacks_status_idx
  ON dispute_clawbacks (status, requested_at);
