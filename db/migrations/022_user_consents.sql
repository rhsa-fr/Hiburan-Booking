-- ============================================================
-- 022_user_consents — consent ToS + Kebijakan Privasi (FR-103)
--
-- Persetujuan disimpan sebagai baris append-only per (user, versi kebijakan):
-- mengubah persetujuan berarti baris baru, bukan UPDATE. `policy_versions`
-- sudah menyimpan versi + hash, jadi bukti "apa yang disetujui" ikut terekam.
--
-- Catatan: body `tos` dan `privacy` di bawah adalah PLACEHOLDER yang menyatakan
-- teks hukum belum ditinjau. Jangan menambahkan pasal karangan; ganti lewat
-- migrasi baru setelah teks final disetujui.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_consents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  policy_code       VARCHAR(40) NOT NULL,
  policy_version_id UUID NOT NULL REFERENCES policy_versions(id),
  accepted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip                TEXT,
  user_agent        TEXT,
  UNIQUE (user_id, policy_version_id)
);

CREATE INDEX IF NOT EXISTS user_consents_user_code_idx
  ON user_consents (user_id, policy_code, accepted_at DESC);

INSERT INTO policy_versions (code, version, body, body_hash, effective_from, is_active)
SELECT
  seed.code,
  1,
  seed.body,
  encode(digest(seed.body::text, 'sha256'), 'hex'),
  now(),
  true
FROM (
  VALUES
    (
      'tos',
      '{"status":"draft","note":"Teks hukum menunggu peninjauan; versi ini mencatat persetujuan pengguna."}'::jsonb
    ),
    (
      'privacy',
      '{"status":"draft","note":"Teks hukum menunggu peninjauan; versi ini mencatat persetujuan pengguna."}'::jsonb
    )
) AS seed(code, body)
ON CONFLICT (code, version) DO NOTHING;
