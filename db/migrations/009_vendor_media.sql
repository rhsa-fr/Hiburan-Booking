-- 009: Media vendor (foto profil, banner, galeri pentas, cuplikan video) & foto paket.

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS banner_url TEXT,
  ADD COLUMN IF NOT EXISTS photo_urls TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS video_url TEXT;

ALTER TABLE packages
  ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- Seed default media untuk vendor aktif agar showcase panggung langsung terisi
UPDATE vendors
SET 
  avatar_url = COALESCE(avatar_url, 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=400&q=80'),
  banner_url = COALESCE(banner_url, 'https://images.unsplash.com/photo-1465847899084-d164df4dedc6?auto=format&fit=crop&w=1200&q=80'),
  photo_urls = CASE 
    WHEN photo_urls = '{}' OR photo_urls IS NULL THEN ARRAY[
      'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=800&q=80'
    ]
    ELSE photo_urls
  END,
  video_url = COALESCE(video_url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')
WHERE is_active = true;

UPDATE packages
SET photo_url = COALESCE(photo_url, 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=800&q=80')
WHERE is_active = true;
