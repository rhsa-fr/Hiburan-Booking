-- 040: pemilik vendor wajib tetap bisa memakai aplikasi sebagai pelanggan.
--
-- "Keluar mode vendor" membawa pengguna ke layar pelanggan (booking, favorit,
-- chat). Endpoint pelanggan mensyaratkan peran `customer`; tanpa peran itu
-- pengguna akan menerima 403 dari aplikasinya sendiri.
--
-- Audit production 2026-11-22: 8 dari 8 akun `vendor_owner` tidak punya baris
-- `customer`. Migrasi ini membackfill yang kurang, dan bersifat idempoten.
--
-- Peran `customer` tidak pernah dicabut dari pemilik vendor: baris yang sudah
-- ada tetapi `revoked_at` terisi dipulihkan, karena kemampuan memakai aplikasi
-- sebagai pelanggan melekat pada kepemilikan vendor.

INSERT INTO user_roles (user_id, role, vendor_scope)
SELECT DISTINCT
       ur.user_id,
       'customer'::user_role,
       '00000000-0000-0000-0000-000000000000'::uuid
  FROM user_roles ur
 WHERE ur.role IN ('vendor_owner', 'vendor_member')
   AND ur.revoked_at IS NULL
ON CONFLICT (user_id, role, vendor_scope)
DO UPDATE SET revoked_at = NULL
  WHERE user_roles.revoked_at IS NOT NULL;

COMMENT ON TABLE user_roles IS
  'Peran pengguna. Pemilik/anggota vendor selalu mempertahankan peran customer (migrasi 040).';
