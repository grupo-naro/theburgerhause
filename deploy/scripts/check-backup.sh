#!/usr/bin/env bash
# Exit 0 when the last COMPLETE backup is recent, 1 otherwise. Use it from cron / an uptime monitor / by hand:
#   deploy/scripts/check-backup.sh            (default: backup must be < 26 hours old)
# Env: BACKUP_DIR (/var/backups/burgerhause)  MAX_AGE_HOURS (26)
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/burgerhause}"
MAX_AGE_HOURS="${MAX_AGE_HOURS:-26}"
marker="$BACKUP_DIR/last-success"

if [ ! -s "$marker" ]; then
  echo "BACKUP_MISSING: no $marker (no backup has ever completed)"
  exit 1
fi
last="$(cat "$marker")"
last_epoch="$(date -u -d "$last" +%s 2>/dev/null || true)"
if [ -z "$last_epoch" ]; then
  echo "BACKUP_UNKNOWN: cannot read the date in $marker ($last)"
  exit 1
fi
age_h=$(( ($(date -u +%s) - last_epoch) / 3600 ))
if [ "$age_h" -gt "$MAX_AGE_HOURS" ]; then
  echo "BACKUP_STALE: last complete backup $last (${age_h}h ago, limit ${MAX_AGE_HOURS}h)"
  exit 1
fi
echo "BACKUP_FRESH: last complete backup $last (${age_h}h ago)"
