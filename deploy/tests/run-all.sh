#!/usr/bin/env bash
# `pnpm test:deploy`: everything that can be verified without the real VPS.
#   1. bash -n on every script            4. nginx config: syntax + behavior (Docker, nginx:stable)
#   2. shellcheck (Docker, if available)  5. backup -> restore round trip (Docker Postgres container; skipped
#   3. deploy.sh scenarios (Docker)          with a notice when PG_CONTAINER is not running, REQUIRE_PG=1 makes it fatal)
# No root and no installation on the host: Docker is the only requirement.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY="$(cd "$HERE/.." && pwd)"
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'
command -v docker >/dev/null 2>&1 || { echo "docker is required for pnpm test:deploy"; exit 1; }

echo "##### 1/5 bash -n"
for f in "$DEPLOY"/scripts/*.sh "$DEPLOY"/tests/*.sh; do bash -n "$f" && echo "  ok $(basename "$f")"; done

echo "##### 2/5 shellcheck (warnings and errors)"
DEPLOY_M="$DEPLOY"; command -v cygpath >/dev/null 2>&1 && DEPLOY_M="$(cygpath -m "$DEPLOY")"
if docker image inspect koalaman/shellcheck:stable >/dev/null 2>&1 || docker pull -q koalaman/shellcheck:stable >/dev/null 2>&1; then
  docker run --rm -v "$DEPLOY_M:/mnt/deploy:ro" -w /mnt koalaman/shellcheck:stable -S warning -x deploy/scripts/*.sh deploy/tests/*.sh && echo "  shellcheck clean"
else
  echo "  shellcheck image not available: skipped"
fi

echo "##### 2b lib.sh unit tests"
bash "$HERE/lib-test.sh"

echo "##### 3/5 deploy.sh scenarios"
bash "$HERE/deploy-test.sh"

echo "##### 4/5 nginx"
bash "$HERE/nginx-test.sh"

echo "##### 5/5 backup -> restore round trip"
C="${PG_CONTAINER:-theburgerhause-postgres-1}"
if docker ps --format '{{.Names}}' | grep -qx "$C"; then
  bash "$HERE/backup-restore-test.sh"
elif [ "${REQUIRE_PG:-0}" = 1 ]; then
  echo "container $C is not running (REQUIRE_PG=1)"; exit 1
else
  echo "  container $C is not running: round trip SKIPPED (start it with: pnpm db:up)"
fi
echo
echo "test:deploy: all passed"
