#!/usr/bin/env bash
# Real backup -> restore round trip against a Postgres running in Docker (default: the project's dev container).
#   1. backup.sh (dry run, then real) of the source database through `docker exec ... pg_dump`
#   2. restore-db.sh into a NEW scratch database, compare the row count of EVERY table with the source
#   3. safety rails: refuse live db, refuse existing target, wrong confirmation, failing dump keeps old backups
#   4. --force-live on a scratch "live" database
# Everything it creates (scratch databases, temp dir) is removed at the end, also on failure.
#
# Env: PG_CONTAINER (default theburgerhause-postgres-1)  PG_USER (burgerhause)  SRC_DB (burgerhause)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS="$HERE/../scripts"
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' NO_LOGGER=1

C="${PG_CONTAINER:-theburgerhause-postgres-1}"
U="${PG_USER:-burgerhause}"
SRC="${SRC_DB:-burgerhause}"
SCRATCH="burgerhause_restore_test"

PSQL_CMD="docker exec -i $C psql -U $U"
PGRESTORE_CMD="docker exec -i $C pg_restore -U $U"
PGDUMP_CMD="docker exec -i $C pg_dump -U $U"
export PSQL_CMD PGRESTORE_CMD PGDUMP_CMD

T="$(mktemp -d)"
FAILS=0
ok() { printf '  ok   %s\n' "$1"; }
bad() { printf '  FAIL %s\n' "$1"; FAILS=$((FAILS + 1)); }
psql_at() { docker exec -i "$C" psql -U "$U" -X -At -v ON_ERROR_STOP=1 -d "$1" -c "$2" </dev/null; }
drop_scratch() {
  docker exec -i "$C" psql -U "$U" -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$SCRATCH\" WITH (FORCE)" >/dev/null 2>&1 || true
  rm -rf "$T"
}
trap drop_scratch EXIT

counts() { # counts <db>: "table=count" lines for every public table
  psql_at "$1" "SELECT string_agg(format('SELECT %L||%L||count(*) FROM %I', tablename, '=', tablename), ' UNION ALL ' ORDER BY tablename) FROM pg_tables WHERE schemaname='public'" |
    { read -r q; psql_at "$1" "$q"; } | sort
}

echo "== source: $SRC in container $C =="
SRC_COUNTS="$(counts "$SRC")"
echo "$SRC_COUNTS" | grep -E '^(orders|products|settings|users)=' | sed 's/^/  source /'

# fake uploads
UP="$T/uploads"; mkdir -p "$UP"
printf one >"$UP/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp"
printf two >"$UP/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.thumb.webp"
export BACKUP_DIR="$T/backups" UPLOAD_DIR="$UP" BACKUP_DB="$SRC" DATABASE_URL="postgres://x:y@127.0.0.1:1/$SRC" RETENTION_DAYS=14

echo "== backup.sh =="
out="$(DRY_RUN=1 "$SCRIPTS/backup.sh")"
echo "$out" | sed 's/^/  /'
[ ! -e "$BACKUP_DIR" ] && ok "dry run created nothing" || bad "dry run created files"

mkdir -p "$BACKUP_DIR/db"
OLD="$BACKUP_DIR/db/${SRC}-20000101-000000.dump"; printf old >"$OLD"; touch -d '20 days ago' "$OLD"
RECENT="$BACKUP_DIR/db/${SRC}-recent.dump"; printf recent >"$RECENT"; touch -d '3 days ago' "$RECENT"
"$SCRIPTS/backup.sh" | sed 's/^/  /'
DUMP="$(ls -1t "$BACKUP_DIR"/db/"$SRC"-2*.dump | head -1)"
[ -s "$DUMP" ] && ok "dump written: $(basename "$DUMP") ($(wc -c <"$DUMP") bytes)" || bad "no dump"
[ ! -e "$OLD" ] && ok "dump older than 14 days pruned" || bad "old dump not pruned"
[ -e "$RECENT" ] && ok "dump younger than 14 days kept" || bad "recent dump pruned"
case "$(uname -s)" in
  MINGW* | MSYS*) ok "(file mode 0600 check skipped on Windows)" ;;
  *) [ "$(stat -c %a "$DUMP")" = 600 ] && ok "dump mode 0600" || bad "dump mode is $(stat -c %a "$DUMP")" ;;
esac
[ -s "$BACKUP_DIR/last-success" ] && ok "last-success marker: $(cat "$BACKUP_DIR/last-success")" || bad "no last-success marker"
[ "$(ls "$BACKUP_DIR/uploads" | wc -l)" = 2 ] && ok "uploads copied (2 files)" || bad "uploads not copied"

"$SCRIPTS/check-backup.sh" | grep -q BACKUP_FRESH && ok "check-backup.sh: fresh backup detected" || bad "check-backup.sh fresh"
echo "2020-01-01T00:00:00Z" >"$BACKUP_DIR/last-success"
set +e; "$SCRIPTS/check-backup.sh" >/dev/null; rcs=$?; set -e
[ "$rcs" = 1 ] && ok "check-backup.sh: stale backup -> exit 1" || bad "check-backup.sh stale ($rcs)"
date -u '+%Y-%m-%dT%H:%M:%SZ' >"$BACKUP_DIR/last-success"

echo "== failing dump keeps older backups and the marker =="
before="$(cat "$BACKUP_DIR/last-success")"; sleep 1
set +e
PGDUMP_CMD="false" "$SCRIPTS/backup.sh" >"$T/fail.out" 2>&1; rc=$?
set -e
[ "$rc" = 2 ] && ok "exit code 2 on pg_dump failure" || bad "exit code $rc (wanted 2)"
[ -s "$DUMP" ] && [ "$(cat "$BACKUP_DIR/last-success")" = "$before" ] && ok "previous dump and marker untouched" || bad "failure damaged previous backup"
grep -q "postgres://x:y" "$T/fail.out" && bad "connection string leaked in the log" || ok "no credentials in the failure log"
ls "$BACKUP_DIR"/db/*.partial >/dev/null 2>&1 && bad "partial file left behind" || ok "no partial file left behind"

echo "== restore-db.sh into a NEW database =="
export LIVE_DB="$SRC"
"$SCRIPTS/restore-db.sh" "$DUMP" "$SCRATCH" | sed 's/^/  /'
REST_COUNTS="$(counts "$SCRATCH")"
if [ "$SRC_COUNTS" = "$REST_COUNTS" ]; then
  ok "row counts of ALL $(echo "$SRC_COUNTS" | wc -l) tables identical"
else
  bad "row counts differ"; diff <(echo "$SRC_COUNTS") <(echo "$REST_COUNTS") || true
fi
for t in orders products settings users; do
  a="$(echo "$SRC_COUNTS" | grep "^$t=")"; b="$(echo "$REST_COUNTS" | grep "^$t=")"
  [ "$a" = "$b" ] && ok "$a (source) == $b (restored)" || bad "$t differs: $a vs $b"
done

echo "== safety rails =="
set +e
"$SCRIPTS/restore-db.sh" "$DUMP" "$SRC" >"$T/o1" 2>&1; rc1=$?
"$SCRIPTS/restore-db.sh" "$DUMP" "$SCRATCH" >"$T/o2" 2>&1; rc2=$?
"$SCRIPTS/restore-db.sh" --force-live "$DUMP" <<<"nope" >"$T/o3" 2>&1; rc3=$?
printf 'not a dump' >"$T/garbage.dump"
"$SCRIPTS/restore-db.sh" "$T/garbage.dump" "${SCRATCH}_x" >"$T/o4" 2>&1; rc4=$?
set -e
[ "$rc1" = 2 ] && grep -q "LIVE database" "$T/o1" && ok "refuses the live database without --force-live (exit 2)" || bad "live db not refused ($rc1)"
[ "$rc2" = 2 ] && ok "refuses an existing target (exit 2)" || bad "existing target not refused ($rc2)"
[ "$rc3" = 2 ] && ok "--force-live with a wrong confirmation refuses (exit 2)" || bad "wrong confirmation not refused ($rc3)"
[ "$(counts "$SRC")" = "$SRC_COUNTS" ] && ok "live database untouched by all of the above" || bad "LIVE DATABASE CHANGED"
[ "$rc4" = 1 ] && [ -z "$(psql_at postgres "SELECT 1 FROM pg_database WHERE datname='${SCRATCH}_x'")" ] && ok "garbage file rejected before creating anything (exit 1)" || bad "garbage dump not rejected ($rc4)"

echo "== --force-live on a scratch database acting as 'live' =="
export LIVE_DB="$SCRATCH"   # pretend the restored copy is the live database
psql_at "$SCRATCH" "DELETE FROM settings" >/dev/null
[ "$(psql_at "$SCRATCH" 'SELECT count(*) FROM settings')" = 0 ] && ok "scratch live db damaged on purpose (settings emptied)" || bad "could not damage"
"$SCRIPTS/restore-db.sh" --force-live "$DUMP" <<<"$SCRATCH" 2>&1 | sed 's/^/  /' | tail -4
[ "$(counts "$SCRATCH")" = "$SRC_COUNTS" ] && ok "--force-live replaced it: counts equal the backup again" || bad "force-live did not restore"

echo
if [ "$FAILS" -ne 0 ]; then echo "backup/restore round trip: $FAILS FAILED"; exit 1; fi
echo "backup/restore round trip: all passed"
echo "== cleanup =="
