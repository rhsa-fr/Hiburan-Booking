#!/usr/bin/env bash
#
# Backup harian PostgreSQL Tarlink (custom format — bisa di-restore selektif).
#
#   scripts/backup-db.sh
#   BACKUP_DIR=/var/backups/tarlink RETENTION_DAYS=30 scripts/backup-db.sh
#
# Dua mode:
#   - DATABASE_URL diisi  → memakai pg_dump di host.
#   - DATABASE_URL kosong → menjalankan pg_dump di dalam service `db` compose
#     (dijamin versinya cocok dengan server).
#
# Pasang di cron:  15 2 * * *  cd /srv/tarlink && scripts/backup-db.sh >> /var/log/tarlink-backup.log 2>&1
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.prod}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="${BACKUP_DIR}/tarlink-${STAMP}.dump"

mkdir -p "$BACKUP_DIR"

if [ -n "${DATABASE_URL:-}" ]; then
  echo "mode: pg_dump langsung"
  pg_dump --format=custom --no-owner --no-privileges --compress=6 \
    --file="$TARGET" "$DATABASE_URL"
else
  echo "mode: pg_dump di dalam container db"
  : "${POSTGRES_USER:=tarlink}"
  : "${POSTGRES_DB:=tarlink}"
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T db \
    pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    --format=custom --no-owner --no-privileges --compress=6 >"$TARGET"
fi

# File ada belum tentu bisa dibaca. Kalau pg_restore tersedia, buktikan.
if command -v pg_restore >/dev/null 2>&1; then
  if ! pg_restore --list "$TARGET" >/dev/null 2>&1; then
    echo "GAGAL: dump tidak bisa dibaca pg_restore: $TARGET" >&2
    exit 1
  fi
  echo "verifikasi: pg_restore --list ok"
else
  echo "peringatan: pg_restore tidak ada di host, verifikasi dump dilewati"
fi

SIZE="$(wc -c <"$TARGET" | tr -d ' ')"
if [ "$SIZE" -lt 1024 ]; then
  echo "GAGAL: dump terlalu kecil (${SIZE} byte), curigakan" >&2
  exit 1
fi
echo "backup ok: $TARGET (${SIZE} byte)"

# Retensi.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'tarlink-*.dump' \
  -mtime "+${RETENTION_DAYS}" -print -delete
