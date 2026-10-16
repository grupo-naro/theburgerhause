#!/usr/bin/env bash
# Test double for pg_dump: records its argv and which PG* variables are set (never their values) in $SPY_LOG,
# then dumps $SPY_DB from the Docker Postgres container instead (the connection data it was given is fake).
set -euo pipefail
: "${SPY_LOG:?}" "${SPY_DB:?}" "${PG_CONTAINER:?}"
{
  echo "ARGV: $*"
  for v in PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE; do
    if [ -n "${!v+x}" ]; then echo "ENV_SET: $v"; fi
  done
} >"$SPY_LOG"
args=()
for a in "$@"; do case "$a" in -*) args+=("$a") ;; esac; done # keep options (-Fc), drop the database argument
exec docker exec -i "$PG_CONTAINER" pg_dump -U "${PG_USER:-burgerhause}" "${args[@]}" "$SPY_DB"
