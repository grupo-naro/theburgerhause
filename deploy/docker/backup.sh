#!/usr/bin/env bash
# Backup diario de The Burger House: reutiliza repo/deploy/scripts/backup.sh (pg_dump -Fc + copia de fotos,
# retención 14 días) haciendo el dump con docker exec. Lo corre cron (04:30, ver README.md) y deploy.sh antes de migrar.
set -euo pipefail
cd "$(dirname "$0")"
export ENV_FILE=/dev/null \
  BACKUP_DB=burgerhause \
  PGDUMP_CMD="docker exec -i theburgerhouse-db-1 pg_dump -U burgerhause" \
  PGRESTORE_CMD="docker exec -i theburgerhouse-db-1 pg_restore" \
  UPLOAD_DIR="$PWD/data/uploads" \
  BACKUP_DIR="$PWD/backups" \
  RETENTION_DAYS=14
exec repo/deploy/scripts/backup.sh "$@"
