-- 012: Index trigram untuk pencarian vendor (AGENTS §7).
--
-- `catalog.repository.ts` mencari dengan infix `%q%` pada display_name,
-- legal_name, dan base_address. Btree tidak bisa melayani leading wildcard;
-- GIN + pg_trgm bisa. Query tidak berubah, hanya jalur aksesnya.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS vendors_display_name_trgm_idx
  ON vendors USING gin (display_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS vendors_legal_name_trgm_idx
  ON vendors USING gin (legal_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS vendors_base_address_trgm_idx
  ON vendors USING gin (base_address gin_trgm_ops);
