#!/usr/bin/env bash
# Docker-free unit tests for deploy/scripts/lib.sh (URL parsing: passwords must never need argv).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/scripts/lib.sh
source "$HERE/../scripts/lib.sh"
FAILS=0
t() { # t <desc> <expected> <actual>
  if [ "$2" = "$3" ]; then printf '  ok   %s\n' "$1"; else printf '  FAIL %s\n         expected: %s\n         actual:   %s\n' "$1" "$2" "$3"; FAILS=$((FAILS + 1)); fi
}
pg_resolve 'postgres://u%40x:p%21w%2Fd@db.example:6543/mydb?sslmode=require'
t "remote URL: env mode, decoded credentials, bare db name" "env mydb PGHOST=db.example PGPORT=6543 PGUSER=u@x PGPASSWORD=p!w/d" "$PG_MODE $PG_DBNAME ${PG_ENV[*]}"
pg_resolve 'postgres://bob@[::1]/db2'
t "IPv6 host without password" "env db2 PGHOST=::1 PGUSER=bob" "$PG_MODE $PG_DBNAME ${PG_ENV[*]}"
ME="$(id -un)"
pg_resolve "postgres://$ME:pw@127.0.0.1:5432/appdb"
t "local URL, user == OS user: socket/peer, nothing exported" "socket appdb 0" "$PG_MODE $PG_DBNAME ${#PG_ENV[@]}"
pg_resolve "postgres://someoneelse:pw@localhost:5432/appdb"
t "local URL, other user: env mode over TCP with password in env" "env PGHOST=localhost PGPORT=5432 PGUSER=someoneelse PGPASSWORD=pw" "$PG_MODE ${PG_ENV[*]}"
pg_resolve "postgres://$ME:pw@localhost:15435/appdb"
t "non-default port is never socket mode" "env" "$PG_MODE"
pg_resolve burgerhause
t "bare name" "name burgerhause 0" "$PG_MODE $PG_DBNAME ${#PG_ENV[@]}"
t "redact hides the password" "postgres://u:***@h/db failed" "$(redact 'postgres://u:secret@h/db failed')"
[ "$FAILS" = 0 ] && echo "lib tests: all passed" || { echo "lib tests: $FAILS FAILED"; exit 1; }
