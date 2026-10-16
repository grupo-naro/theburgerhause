#!/usr/bin/env bash
# The Burger Hause - restore a pg_dump -Fc backup into a database and show row counts to prove it.
#
# Usage:
#   restore-db.sh <dump-file> [target_db]            restore into a NEW database (default name
#                                                    <livedb>_restore_<timestamp>); refuses if it exists
#   restore-db.sh --force-live <dump-file>           REPLACE the live database (asks you to type its name)
#   restore-db.sh --help
#
# The live database is never touched without --force-live AND the typed confirmation. Stop the app first
# (`sudo systemctl stop burgerhause`) and take a fresh backup (deploy/scripts/backup.sh) before --force-live.
#
# Exit codes: 0 ok | 1 usage/config | 2 refused (live db / target exists / not confirmed) | 3 restore failed.
#
# Environment (optional):
#   ENV_FILE         /etc/burgerhause/burgerhause.env (DATABASE_URL tells which database is "live")
#   DATABASE_URL     overrides the file
#   LIVE_DB          name of the live database (default: taken from DATABASE_URL, else "burgerhause")
#   PSQL_CMD         psql           run as postgres:  `sudo -u postgres env PSQL_CMD=psql ...` or a docker exec
#   PGRESTORE_CMD    pg_restore     (reads the dump from stdin)
#   RESTORE_OWNER    role that must own the restored database/objects (e.g. burgerhause). Needed in
#                    production so the app can use the restored copy. Default: the connecting role.
#   NO_LOGGER=1      do not write to the system journal
set -euo pipefail

SCRIPT_TAG="burgerhause-restore"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/scripts/lib.sh
source "$HERE/lib.sh"

usage() { sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; }

FORCE_LIVE=0
ARGS=()
for a in "$@"; do
  case "$a" in
    --force-live) FORCE_LIVE=1 ;;
    -h | --help) usage; exit 0 ;;
    *) ARGS+=("$a") ;;
  esac
done
[ "${#ARGS[@]}" -ge 1 ] && [ "${#ARGS[@]}" -le 2 ] || { usage; exit 1; }
DUMP="${ARGS[0]}"
TARGET="${ARGS[1]:-}"
[ -f "$DUMP" ] && [ -r "$DUMP" ] || die "dump file not found or unreadable: $DUMP" 1

ENV_FILE="${ENV_FILE:-/etc/burgerhause/burgerhause.env}"
DATABASE_URL="${DATABASE_URL:-$(env_file_value "$ENV_FILE" DATABASE_URL)}"
LIVE_DB="${LIVE_DB:-$([ -n "$DATABASE_URL" ] && db_name_of "$DATABASE_URL" || echo burgerhause)}"
RESTORE_OWNER="${RESTORE_OWNER:-}"
split_cmd PSQL "${PSQL_CMD:-psql}"
split_cmd PGRESTORE "${PGRESTORE_CMD:-pg_restore}"

case "$LIVE_DB" in *[!A-Za-z0-9_]* | '') die "unsupported live database name: $LIVE_DB (letters, digits, underscore)" 1 ;; esac
case "$RESTORE_OWNER" in *[!A-Za-z0-9_]*) die "unsupported RESTORE_OWNER" 1 ;; esac

# Admin-level SQL on the maintenance database "postgres" / SQL on a given database.
psql_admin() { "${PSQL[@]}" -X -q -v ON_ERROR_STOP=1 -d postgres "$@" </dev/null; }
psql_db() { local db="$1"; shift; "${PSQL[@]}" -X -q -v ON_ERROR_STOP=1 -d "$db" "$@" </dev/null; }

if [ "$FORCE_LIVE" = 1 ]; then
  [ -z "$TARGET" ] || [ "$TARGET" = "$LIVE_DB" ] || die "--force-live restores into the live database ($LIVE_DB); do not pass another target" 1
  TARGET="$LIVE_DB"
elif [ -z "$TARGET" ]; then
  TARGET="${LIVE_DB}_restore_$(date '+%Y%m%d_%H%M%S')"
fi
case "$TARGET" in *[!A-Za-z0-9_]* | '') die "unsupported target database name: $TARGET (letters, digits, underscore)" 1 ;; esac

if [ "$TARGET" = "$LIVE_DB" ] && [ "$FORCE_LIVE" != 1 ]; then
  die "REFUSED: $TARGET is the LIVE database. Use --force-live to replace it (and read the runbook first)." 2
fi

# The file must be a readable archive before we drop or create anything.
"${PGRESTORE[@]}" --list <"$DUMP" >/dev/null 2>&1 || die "not a valid pg_dump -Fc archive: $DUMP" 1

exists="$(psql_admin -At -c "SELECT 1 FROM pg_database WHERE datname = '$TARGET'")"

if [ "$FORCE_LIVE" = 1 ]; then
  printf 'WARNING: this will DELETE the live database "%s" and replace it with %s.\n' "$TARGET" "$DUMP" >&2
  printf 'Is the app stopped (systemctl stop burgerhause) and do you have a fresh backup? Type the database name to continue: ' >&2
  read -r answer || answer=""
  [ "$answer" = "$TARGET" ] || die "REFUSED: confirmation did not match; nothing was changed." 2
  if [ "$exists" = 1 ]; then
    log "dropping live database $TARGET (all connections are terminated)"
    psql_admin -c "DROP DATABASE \"$TARGET\" WITH (FORCE)"
  fi
elif [ "$exists" = 1 ]; then
  die "REFUSED: database $TARGET already exists; choose another name (nothing was changed)." 2
fi

log "creating database $TARGET${RESTORE_OWNER:+ (owner $RESTORE_OWNER)}"
psql_admin -c "CREATE DATABASE \"$TARGET\"${RESTORE_OWNER:+ OWNER \"$RESTORE_OWNER\"} ENCODING 'UTF8' TEMPLATE template0"

log "restoring $DUMP into $TARGET"
RESTORE_ARGS=(--no-owner --no-acl --exit-on-error -d "$TARGET")
[ -n "$RESTORE_OWNER" ] && RESTORE_ARGS+=(--role "$RESTORE_OWNER")
if ! "${PGRESTORE[@]}" "${RESTORE_ARGS[@]}" <"$DUMP"; then
  log "restore FAILED; the partially restored database $TARGET was left for inspection (drop it with: DROP DATABASE \"$TARGET\";)"
  exit 3
fi

log "restore finished; row counts in $TARGET:"
TABLES="$(psql_db "$TARGET" -At -c "SELECT string_agg(format('SELECT %L AS tabla, count(*) AS filas FROM %I', tablename, tablename), ' UNION ALL ' ORDER BY tablename) FROM pg_tables WHERE schemaname = 'public'")"
[ -n "$TABLES" ] || die "the restored database has no tables in schema public" 3
psql_db "$TARGET" -c "$TABLES ORDER BY 1"
journal "restored $DUMP into $TARGET"
log "RESTORE_OK database=$TARGET"
