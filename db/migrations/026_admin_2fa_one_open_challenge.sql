-- ============================================================
-- 026_admin_2fa_one_open_challenge — satu tiket 2FA hidup per user
--
-- Migrasi 025 hanya memberi index non-unik pada `admin_2fa_challenges`.
-- Akibatnya `DELETE open challenges` lalu `INSERT` di service bisa disela dua
-- request login paralel, menyisakan DUA tiket hidup; tiap tiket tetap boleh
-- enam tebakan sehingga anggaran lintas-challenge (10 kegagalan / 15 menit)
-- bisa dikali dengan jumlah request paralel.
--
-- Index parsial unik di bawah membuat "satu tiket hidup per user" menjadi
-- invarian database. Repository kemudian memakai satu statement
-- `INSERT ... ON CONFLICT ... DO UPDATE` sehingga rotasi tiket atomik.
--
-- Idempoten: duplikat lama dibersihkan lebih dulu (menyisakan tiket terbaru),
-- lalu index dibuat dengan IF NOT EXISTS.
--
-- DOWN: `DROP INDEX admin_2fa_challenges_one_open_uq;` — tidak ada data uang
-- dan tidak ada kolom yang diubah.
-- ============================================================

-- Tiket 2FA bersifat sementara (TTL 10 menit) dan token plaintext tidak pernah
-- disimpan, jadi menghapus duplikat lama aman. Yang dipertahankan: created_at
-- terbaru, dengan id sebagai pemecah seri.
DELETE FROM admin_2fa_challenges older
USING admin_2fa_challenges newer
WHERE older.consumed_at IS NULL
  AND newer.consumed_at IS NULL
  AND older.user_id = newer.user_id
  AND (older.created_at, older.id) < (newer.created_at, newer.id);

CREATE UNIQUE INDEX IF NOT EXISTS admin_2fa_challenges_one_open_uq
  ON admin_2fa_challenges (user_id)
  WHERE consumed_at IS NULL;

COMMENT ON INDEX admin_2fa_challenges_one_open_uq IS
  'FR-128: maksimal satu challenge 2FA hidup per user; rotasi tiket atomik.';
