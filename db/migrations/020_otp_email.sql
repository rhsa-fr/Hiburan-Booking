-- ============================================================
-- 020_otp_email — OTP dikirim ke email, bukan nomor HP (ADR 0011).
--
-- Baris lama tetap valid: `phone` boleh NULL selama `email` terisi.
-- Channel lama (whatsapp/sms) dipertahankan agar data historis tidak rusak,
-- tetapi penulisan baru hanya memakai 'email'.
-- ============================================================

ALTER TABLE otp_requests ADD COLUMN IF NOT EXISTS email VARCHAR(150);

ALTER TABLE otp_requests ALTER COLUMN phone DROP NOT NULL;

ALTER TABLE otp_requests DROP CONSTRAINT IF EXISTS otp_requests_channel_check;
ALTER TABLE otp_requests
  ADD CONSTRAINT otp_requests_channel_check
  CHECK (channel IN ('whatsapp', 'sms', 'email'));

ALTER TABLE otp_requests DROP CONSTRAINT IF EXISTS otp_requests_target_check;
ALTER TABLE otp_requests
  ADD CONSTRAINT otp_requests_target_check
  CHECK (phone IS NOT NULL OR email IS NOT NULL);

CREATE INDEX IF NOT EXISTS otp_requests_email_idx
  ON otp_requests (lower(email), created_at DESC);
