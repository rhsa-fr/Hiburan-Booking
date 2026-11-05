-- 015: hapus media stok bawaan migrasi 009.
--
-- Migrasi 009 mengisi `avatar_url`, `banner_url`, `photo_urls`, `video_url`
-- vendor dan `packages.photo_url` dengan gambar Unsplash serta satu tautan
-- YouTube contoh. Itu melanggar aturan produk (AGENTS.md §2: jangan menampilkan
-- gambar stok) dan FR-140 (setiap media wajib punya pernyataan lisensi).
--
-- Migrasi ini TIDAK menghapus data pengguna. Nilai yang dikosongkan adalah
-- DAFTAR URL EKSAK dari 009 (bukan pola `images.unsplash.com/%`), sehingga
-- tautan Unsplash yang diunggah vendor sendiri tetap utuh. Kolomnya nullable dan
-- UI sudah punya fallback gradien deterministik, jadi kartu vendor tetap tampil.

-- avatar seed 009 (w=400)
UPDATE vendors
   SET avatar_url = NULL,
       updated_at = now()
 WHERE avatar_url = 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=400&q=80';

-- banner seed 009 (w=1200)
UPDATE vendors
   SET banner_url = NULL,
       updated_at = now()
 WHERE banner_url = 'https://images.unsplash.com/photo-1465847899084-d164df4dedc6?auto=format&fit=crop&w=1200&q=80';

-- galeri seed 009 (empat URL w=800)
UPDATE vendors
   SET photo_urls = COALESCE(
         (
           SELECT array_agg(url ORDER BY ord)
             FROM unnest(photo_urls) WITH ORDINALITY AS t(url, ord)
            WHERE url NOT IN (
              'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=800&q=80',
              'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=800&q=80',
              'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=800&q=80',
              'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=800&q=80'
            )
         ),
         '{}'::text[]
       ),
       updated_at = now()
 WHERE photo_urls && ARRAY[
         'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=800&q=80',
         'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=800&q=80',
         'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=800&q=80',
         'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=800&q=80'
       ]::text[];

-- video contoh 009
UPDATE vendors
   SET video_url = NULL,
       updated_at = now()
 WHERE video_url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

-- foto paket seed 009
UPDATE packages
   SET photo_url = NULL,
       updated_at = now()
 WHERE photo_url = 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=800&q=80';
