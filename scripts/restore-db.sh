#!/usr/bin/env bash
#
# Memulihkan dump hasil scripts/backup-db.sh ke database Tarlink.
#
#   scripts/restore-db.sh backups/tarlink-20261108T020000Z.dump --yes
#
# Aman secara default: menolak berjalan bila database sudah berisi tabel,
# karena pg_restore --clean akan MENGHAPUS objek yang ada. Pakai --force
# hanya kalau memang ingin menimpa database yang sudah dipakai.
#
# Setelah restore, WAJIB:
#   1. npm run migrate:dry   → pastikan tidak ada migrasi tertinggal
#   2. npm run verify:db     → invarian uang/ledger kembali hijau
#   3. npm run verify:prod -- --db
set -euo pipefail

DUMP="${1:-}"
shift || true
CONFIRM="${1:-}"
FORCE="${2:-}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.prod}"

if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "pemakaian: $0 <dump-file> --yes [--force]" >&2
  exit 2
fi
if [ "$CONFIRM" != "--yes" ] && [ "$FORCE" != "--yes" ]; then
  echo "pemakaian: $0 <dump-file> --yes [--force]" >&2
  exit 2
fi

run_psql() {
  if [ -n "${DATABASE_URL:-}" ]; then
    psql "$DATABASE_URL" -tAc "$1"
  else
    : "${POSTGRES_USER:=tarlink}"
    : "${POSTGRES_DB:=tarlink}"
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T db \
      psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "$1"
  fi
}

EXISTING="$(run_psql "select count(*) from information_schema.tables where table_schema='public'" | tr -d '[:space:]')"
echo "tabel di public: ${EXISTING}"

if [ "${EXISTING:-0}" -gt 0 ] && [ "$FORCE" != "--force" ]; then
  echo "DITOLAK: database sudah berisi ${EXISTING} tabel." >&2
  echo "Restore akan menimpa data. Bila ini memang disengaja, tambahkan --force." >&2
  exit 1
fi

echo "memulihkan $DUMP ..."
if [ -n "${DATABASE_URL:-}" ]; then
  pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$DATABASE_URL" "$DUMP"
else
  : "${POSTGRES_USER:=tarlink}"
  : "${POSTGRES_DB:=tarlink}"
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T db \
    pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    --clean --if-exists --no-owner --no-privileges <"$DUMP"
fi

echo "restore selesai. Langkah wajib berikutnya:"
echo "  npm run migrate:dry"
echo "  npm run verify:db"
echo "  npm run verify:prod -- --db"
