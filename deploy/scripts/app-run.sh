#!/usr/bin/env bash
# Run a command inside the CURRENT release with the production environment, as the unprivileged app user.
# For one-off maintenance tasks (first-day setup, resetting the admin password):
#   sudo deploy/scripts/app-run.sh pnpm db:init-prod
#   sudo ADMIN_USERNAME=admin deploy/scripts/app-run.sh pnpm db:seed-admin      (prints a generated password once)
# Env: APP_ROOT (/opt/burgerhause)  ENV_FILE (/etc/burgerhause/burgerhause.env)  APP_USER (burgerhause)  APP_HOME
# NEVER use it for `pnpm db:seed` (demo data): the production guard refuses anyway.
set -euo pipefail

SCRIPT_TAG="burgerhause-run"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/scripts/lib.sh
source "$HERE/lib.sh"

[ "$#" -ge 1 ] || { sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; exit 2; }

APP_ROOT="${APP_ROOT:-/opt/burgerhause}"
ENV_FILE="${ENV_FILE:-/etc/burgerhause/burgerhause.env}"
APP_USER="${APP_USER:-burgerhause}"
APP_HOME="${APP_HOME:-/var/lib/burgerhause}"

[ -r "$ENV_FILE" ] || die "cannot read $ENV_FILE (run with sudo)" 2
[ -d "$APP_ROOT/current" ] || die "$APP_ROOT/current does not exist: deploy first" 2

load_env_file "$ENV_FILE"
cd "$APP_ROOT/current"
if [ "$(id -u)" = 0 ]; then
  exec runuser -u "$APP_USER" -- env "HOME=$APP_HOME" COREPACK_ENABLE_DOWNLOAD_PROMPT=0 "$@"
fi
exec "$@"
