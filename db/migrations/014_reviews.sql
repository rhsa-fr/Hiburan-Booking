-- 014: ulasan dan penilaian vendor (reviews).
--
-- Pelanggan yang telah menyelesaikan booking (lifecycle_status = 'completed')
-- dapat memberikan 1 ulasan dan rating (1-5) per booking.
-- Trigger memperbarui agregat rating_sum dan rating_count pada tabel vendors.

CREATE TABLE IF NOT EXISTS reviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      UUID NOT NULL REFERENCES bookings(id),
  vendor_id       UUID NOT NULL REFERENCES vendors(id),
  customer_id     UUID NOT NULL REFERENCES users(id),
  rating          SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reviews_booking_unique UNIQUE (booking_id)
);

CREATE INDEX IF NOT EXISTS reviews_vendor_idx ON reviews (vendor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS reviews_customer_idx ON reviews (customer_id);

CREATE OR REPLACE FUNCTION trg_reviews_update_vendor_rating() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE vendors
  SET rating_sum = rating_sum + NEW.rating,
      rating_count = rating_count + 1
  WHERE id = NEW.vendor_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reviews_insert ON reviews;
CREATE TRIGGER trg_reviews_insert
  AFTER INSERT ON reviews
  FOR EACH ROW EXECUTE FUNCTION trg_reviews_update_vendor_rating();
