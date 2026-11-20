-- FR-126: vendor earnings export filters one vendor by release date.
--
-- `bookings_vendor_idx` starts with vendor_id but continues with created_at, so
-- a monthly export still walks every booking the vendor ever had. This partial
-- index keeps the export query on released rows only.
CREATE INDEX IF NOT EXISTS bookings_vendor_released_idx
  ON bookings (vendor_id, released_at DESC)
  WHERE released_at IS NOT NULL;
