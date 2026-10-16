#!/usr/bin/env bash
# The Burger Hause - daily backup: database dump (pg_dump -Fc) + incremental copy of the uploads,
# optionally pushed to another machine with rsync over ssh.
#
# Run by burgerhause-backup.timer (04:30) as the app user. Manual run:  deploy/scripts/backup.sh
#
# Exit codes: 0 ok | 1 configuration/usage | 2 database dump failed | 3 uploads copy failed
#             4 remote copy (BACKUP_REMOTE) failed. A failing step never deletes older backups.
#
# Environment (all optional; defaults are for the production layout):
#   ENV_FILE         /etc/burgerhause/burgerhause.env  (read for DATABASE_URL / UPLOAD_DIR if unset)
#   DATABASE_URL     postgres://user:pass@127.0.0.1:5432/db
#   BACKUP_DB        bare database name to dump (default: taken from DATABASE_URL). With a bare name the script adds no
#                    connection settings: libpq defaults apply (UNIX socket + peer auth as the service user).
#
# The database password is NEVER put on a command line: a local URL whose user equals the OS user connects over the
# UNIX socket with peer authentication (no password); any other URL is exported as PGHOST/PGPORT/PGUSER/PGPASSWORD
# in the environment of the pg_dump process only. The Postgres role must be named like the service user (burgerhause).
#   UPLOAD_DIR       /var/lib/burgerhause/uploads
#   BACKUP_DIR       /var/backups/burgerhause     (db/ and uploads/ inside; created 0700)
#   RETENTION_DAYS   14  (only db dumps are pruned; images are immutable and kept)
#   PGDUMP_CMD       pg_dump          e.g. "docker exec -i theburgerhause-postgres-1 pg_dump -U burgerhause"
#   PGRESTORE_CMD    pg_restore       (only used with --list, to prove the dump is readable; reads stdin)
#   BACKUP_REMOTE    user@host:/path  (rsync target; empty = no remote copy)
#   BACKUP_SSH_KEY   ssh private key for the remote copy
#   RSYNC_CMD        rsync
#   DRY_RUN=1        print what would happen, change nothing
#   NO_LOGGER=1      do not write to the system journal
#
# Needs: bash, pg_dump (same or newer major than the server), find, date; rsync (for the remote copy;
# locally it falls back to `cp -a` when rsync is missing, e.g. Git Bash on Windows).
set -euo pipefail

SCRIPT_TAG="burgerhause-backup"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/scripts/lib.sh
source "$HERE/lib.sh"

ENV_FILE="${ENV_FILE:-/etc/burgerhause/burgerhause.env}"
DATABASE_URL="${DATABASE_URL:-$(env_file_value "$ENV_FILE" DATABASE_URL)}"
UPLOAD_DIR="${UPLOAD_DIR:-$(env_file_value "$ENV_FILE" UPLOAD_DIR)}"
UPLOAD_DIR="${UPLOAD_DIR:-/var/lib/burgerhause/uploads}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/burgerhause}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
BACKUP_DB="${BACKUP_DB:-$DATABASE_URL}"
BACKUP_REMOTE="${BACKUP_REMOTE:-$(env_file_value "$ENV_FILE" BACKUP_REMOTE)}"
BACKUP_SSH_KEY="${BACKUP_SSH_KEY:-$(env_file_value "$ENV_FILE" BACKUP_SSH_KEY)}"
RSYNC_CMD="${RSYNC_CMD:-rsync}"
DRY_RUN="${DRY_RUN:-0}"

[ -n "$BACKUP_DB" ] || die "DATABASE_URL (or BACKUP_DB) is not set and not found in $ENV_FILE" 1
case "$RETENTION_DAYS" in '' | *[!0-9]*) die "RETENTION_DAYS must be a number" 1 ;; esac

split_cmd PGDUMP "${PGDUMP_CMD:-pg_dump}"
split_cmd PGRESTORE "${PGRESTORE_CMD:-pg_restore}"
split_cmd RSYNC "$RSYNC_CMD"

pg_resolve "$BACKUP_DB"
DB_NAME="$PG_DBNAME"
[ -n "$DB_NAME" ] || die "cannot work out the database name" 1
STAMP="$(date '+%Y%m%d-%H%M%S')"
DB_DIR="$BACKUP_DIR/db"
UP_DIR="$BACKUP_DIR/uploads"
DUMP="$DB_DIR/$DB_NAME-$STAMP.dump"

run() { # run <description> <command...>: execute, or just print under DRY_RUN
  local d="$1"
  shift
  if [ "$DRY_RUN" = "1" ]; then
    log "DRY_RUN: would $d"
    return 0
  fi
  "$@"
}

log "backup start: db=$DB_NAME uploads=$UPLOAD_DIR -> $BACKUP_DIR (retention ${RETENTION_DAYS}d, remote=${BACKUP_REMOTE:-none}, dry_run=$DRY_RUN)"

umask 077
run "create $DB_DIR and $UP_DIR" mkdir -p "$DB_DIR" "$UP_DIR"

# ---- 1. database dump ---------------------------------------------------------------------------
FAIL=0
if [ "$DRY_RUN" = "1" ]; then
  log "DRY_RUN: would run: ${PGDUMP[*]} -Fc $PG_DBNAME > $DUMP (connection mode: $PG_MODE)"
else
  PARTIAL="$DUMP.partial"
  if ! pg_exec "${PGDUMP[@]}" -Fc "$PG_DBNAME" >"$PARTIAL" 2>"$PARTIAL.err"; then
    # pg_dump may echo the connection string: redact before logging.
    log "pg_dump failed: $(redact "$(head -c 400 "$PARTIAL.err")")"
    rm -f "$PARTIAL" "$PARTIAL.err"
    die "database dump failed (older backups were NOT touched)" 2
  fi
  rm -f "$PARTIAL.err"
  if [ ! -s "$PARTIAL" ]; then
    rm -f "$PARTIAL"
    die "database dump is empty" 2
  fi
  # Prove the file is a readable archive before we trust it (and before we prune anything).
  if ! "${PGRESTORE[@]}" --list <"$PARTIAL" >/dev/null 2>&1; then
    rm -f "$PARTIAL"
    die "database dump is not a valid pg_dump archive" 2
  fi
  mv "$PARTIAL" "$DUMP"
  chmod 0600 "$DUMP"
  log "database dump ok: $DUMP ($(wc -c <"$DUMP") bytes)"
fi

# ---- 2. retention (only after a good dump) ------------------------------------------------------------
if [ "$DRY_RUN" = "1" ]; then
  log "DRY_RUN: would delete $DB_DIR/*.dump older than $RETENTION_DAYS days"
else
  find "$DB_DIR" -maxdepth 1 -type f -name '*.dump' -mtime "+$RETENTION_DAYS" -print -delete |
    while read -r old; do log "pruned old dump: $old"; done || true
fi

# ---- 3. uploads: additive local copy (files are immutable UUID names; nothing is deleted) ------------------------
if [ ! -d "$UPLOAD_DIR" ]; then
  log "WARNING: uploads dir $UPLOAD_DIR does not exist; nothing to copy"
elif [ "$DRY_RUN" = "1" ]; then
  log "DRY_RUN: would copy $UPLOAD_DIR/ -> $UP_DIR/ (incremental, no deletions)"
else
  if command -v "${RSYNC[0]}" >/dev/null 2>&1; then
    "${RSYNC[@]}" -a "$UPLOAD_DIR/" "$UP_DIR/" || FAIL=3
  else
    log "WARNING: rsync not found; using cp -a (copies everything every time)"
    cp -a "$UPLOAD_DIR/." "$UP_DIR/" || FAIL=3
  fi
  if [ "$FAIL" = 3 ]; then log "uploads copy FAILED"; else log "uploads copy ok"; fi
fi

# ---- 4. optional remote copy --------------------------------------------------------------------------------
if [ -n "$BACKUP_REMOTE" ]; then
  SSH="ssh -o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=yes"
  [ -n "$BACKUP_SSH_KEY" ] && SSH="$SSH -i $BACKUP_SSH_KEY"
  if [ "$DRY_RUN" = "1" ]; then
    log "DRY_RUN: would rsync $DB_DIR/ and $UP_DIR/ to $BACKUP_REMOTE (ssh: $SSH)"
  elif ! command -v "${RSYNC[0]}" >/dev/null 2>&1; then
    log "remote copy FAILED: rsync is not installed"
    [ "$FAIL" = 0 ] && FAIL=4
  else
    # No --delete: a mistake or an attack here must not be able to erase the off-site copy.
    if "${RSYNC[@]}" -a -e "$SSH" "$DB_DIR/" "$BACKUP_REMOTE/db/" &&
      "${RSYNC[@]}" -a -e "$SSH" "$UP_DIR/" "$BACKUP_REMOTE/uploads/"; then
      log "remote copy ok: $BACKUP_REMOTE"
    else
      log "remote copy FAILED: $BACKUP_REMOTE"
      [ "$FAIL" = 0 ] && FAIL=4
    fi
  fi
fi

# ---- 5. result ---------------------------------------------------------------------------------------------------
if [ "$DRY_RUN" = "1" ]; then
  log "DRY_RUN finished (nothing was changed)"
  exit 0
fi
if [ "$FAIL" != 0 ]; then
  journal "backup FINISHED WITH ERRORS (exit $FAIL)"
  die "backup finished with errors (exit $FAIL); last-success marker NOT updated" "$FAIL"
fi
# Monitoring marker: its mtime/content says when the last COMPLETE backup finished.
date -u '+%Y-%m-%dT%H:%M:%SZ' >"$BACKUP_DIR/last-success"
log "BACKUP_OK $DUMP"
journal "BACKUP_OK $DUMP"
