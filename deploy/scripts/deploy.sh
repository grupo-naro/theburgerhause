#!/usr/bin/env bash
# The Burger Hause - deploy a new version with automatic rollback.
#
#   deploy.sh [deploy]            fetch -> env check -> backup -> install -> MIGRATE -> BUILD -> swap -> restart
#                                 -> health check -> (automatic ROLLBACK if unhealthy). Needs root (systemctl).
#   deploy.sh rollback [release]  manual rollback to the previous (or the named) release, restart, health check
#   deploy.sh status              current release, available releases, health
#   deploy.sh --help
#
# Why this order: the production build PRERENDERS the menu, so the database must be reachable and MIGRATED
# when `next build` runs. Migrations run BEFORE the running version is touched; if any step before the swap
# fails the live release keeps running untouched and the half-built release is deleted.
# Migrations must therefore be backward compatible with the previous release (add columns/tables first,
# remove things in a LATER release), otherwise an automatic rollback would run old code on a new schema.
#
# Layout:  $APP_ROOT/releases/<YYYYmmddHHMMSS>/   one directory per deploy
#          $APP_ROOT/current  ->  releases/<...>   symlink, swapped atomically (mv -T: GNU coreutils)
#
# Exit codes: 0 deployed | 1 failed BEFORE the swap (live version untouched) | 2 usage/config
#             3 new version unhealthy, ROLLED BACK to the previous release (service healthy again)
#             4 unhealthy and rollback impossible or also unhealthy (NEEDS A HUMAN)
#
# Environment (defaults suit the production layout):
#   APP_ROOT=/opt/burgerhause   ENV_FILE=/etc/burgerhause/burgerhause.env   SERVICE_NAME=burgerhause
#   REPO_URL=<git url>  REF=main        source from git (shallow clone of branch/tag REF)
#   SOURCE_DIR=<dir>                    OR copy an already prepared tree (rsync/scp'd artifact); wins over REPO_URL
#   APP_USER=burgerhause                steps install/migrate/build/backup run as this user when started as root
#   APP_HOME=/var/lib/burgerhause       HOME for those steps (pnpm store, corepack cache)
#   INSTALL_CMD="pnpm install --frozen-lockfile --prod=false"   (dev dependencies are needed to build)
#   MIGRATE_CMD="pnpm db:migrate"       BUILD_CMD="pnpm build"
#   RESTART_CMD="systemctl restart burgerhause"
#   HEALTH_URL=http://127.0.0.1:3000/api/health   HEALTH_TIMEOUT=60   HEALTH_INTERVAL=2
#   KEEP_RELEASES=5     SKIP_BACKUP=1 (skip the pre-deploy backup)     DRY_RUN=1 (print the plan, change nothing)
#   NO_LOGGER=1         do not write to the system journal
set -euo pipefail

SCRIPT_TAG="burgerhause-deploy"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/scripts/lib.sh
source "$HERE/lib.sh"

usage() { sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; }

CMD="deploy"
case "${1:-}" in
  deploy) shift ;;
  rollback) CMD="rollback"; shift ;;
  status) CMD="status"; shift ;;
  -h | --help) usage; exit 0 ;;
  '') ;;
  *) usage; exit 2 ;;
esac

APP_ROOT="${APP_ROOT:-/opt/burgerhause}"
RELEASES="$APP_ROOT/releases"
CURRENT="$APP_ROOT/current"
ENV_FILE="${ENV_FILE:-/etc/burgerhause/burgerhause.env}"
SERVICE_NAME="${SERVICE_NAME:-burgerhause}"
REPO_URL="${REPO_URL:-}"
REF="${REF:-main}"
SOURCE_DIR="${SOURCE_DIR:-}"
if [ -z "${APP_USER+x}" ]; then
  if [ "$(id -u)" = 0 ]; then APP_USER="burgerhause"; else APP_USER=""; fi
fi
APP_HOME="${APP_HOME:-/var/lib/burgerhause}"
INSTALL_CMD="${INSTALL_CMD:-pnpm install --frozen-lockfile --prod=false}"
MIGRATE_CMD="${MIGRATE_CMD:-pnpm db:migrate}"
BUILD_CMD="${BUILD_CMD:-pnpm build}"
RESTART_CMD="${RESTART_CMD:-systemctl restart $SERVICE_NAME}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-60}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-2}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
SKIP_BACKUP="${SKIP_BACKUP:-0}"
DRY_RUN="${DRY_RUN:-0}"

for n in HEALTH_TIMEOUT HEALTH_INTERVAL KEEP_RELEASES; do
  case "${!n}" in '' | *[!0-9]*) die "$n must be a number" 2 ;; esac
done
[ "$KEEP_RELEASES" -ge 2 ] || die "KEEP_RELEASES must be at least 2" 2

# ---------------------------------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------------------------------
as_app() { # run a command as the unprivileged app user when we are root
  if [ -n "$APP_USER" ] && [ "$(id -u)" = 0 ]; then
    runuser -u "$APP_USER" -- env "HOME=$APP_HOME" COREPACK_ENABLE_DOWNLOAD_PROMPT=0 "$@"
  else
    "$@"
  fi
}

current_release() { # basename of the active release, or empty
  local t
  if [ -L "$CURRENT" ] && t="$(readlink -f "$CURRENT" 2>/dev/null)" && [ -d "$t" ]; then basename "$t"; fi
}

list_releases() { # ascending
  [ -d "$RELEASES" ] || return 0
  find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -name '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]' -printf '%f\n' | sort
}

swap_to() { # atomic: new symlink next to the old one, then rename over it
  local name="$1"
  ln -sfn "$RELEASES/$name" "$CURRENT.new"
  mv -Tf "$CURRENT.new" "$CURRENT"
}

health_wait() { # health_wait <expected-commit-or-empty>: 0 when /api/health reports status ok
  local want="${1:-}" body deadline=$((SECONDS + HEALTH_TIMEOUT))
  while :; do
    body="$(curl -fsS --max-time 3 "$HEALTH_URL" 2>/dev/null || true)"
    if printf '%s' "$body" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"'; then
      # If the response names a commit it must be the one we just deployed (not an old process still answering).
      if [ -z "$want" ] || ! printf '%s' "$body" | grep -q '"commit"' || printf '%s' "$body" | grep -q "\"commit\"[[:space:]]*:[[:space:]]*\"$want\""; then
        return 0
      fi
    fi
    [ "$SECONDS" -lt "$deadline" ] || return 1
    sleep "$HEALTH_INTERVAL"
  done
}

load_env() { # export KEY=VALUE lines of the env file WITHOUT sourcing it (values may contain & ? # $)
  local line key val
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in '' | '#'*) continue ;; esac
    key="${line%%=*}"
    val="${line#*=}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    case "$val" in \"*\") val="${val#\"}"; val="${val%\"}" ;; \'*\') val="${val#\'}"; val="${val%\'}" ;; esac
    export "$key=$val"
  done <"$ENV_FILE"
}

check_env() { # validate the production env file; never prints values
  [ -r "$ENV_FILE" ] || die "env file $ENV_FILE does not exist or is not readable" 2
  load_env
  local missing=() k
  for k in DATABASE_URL SESSION_SECRET UPLOAD_DIR; do
    [ -n "${!k:-}" ] || missing+=("$k")
  done
  [ "${#missing[@]}" = 0 ] || die "missing in $ENV_FILE: ${missing[*]}" 2
  case "$DATABASE_URL" in postgres://* | postgresql://*) ;; *) die "DATABASE_URL must start with postgres://" 2 ;; esac
  [ "${#SESSION_SECRET}" -ge 32 ] || die "SESSION_SECRET must be at least 32 characters (openssl rand -base64 48)" 2
  case "$SESSION_SECRET" in CHANGE_ME*) die "SESSION_SECRET is still the template placeholder" 2 ;; esac
  case "$DATABASE_URL" in *CHANGE_ME*) die "DATABASE_URL still contains the template placeholder" 2 ;; esac
  case "$UPLOAD_DIR" in /*) ;; *) die "UPLOAD_DIR must be an absolute path" 2 ;; esac
  [ -z "${ALLOW_DEMO_SEED:-}" ] || die "ALLOW_DEMO_SEED must NEVER be set in production" 2
  [ "${NODE_ENV:-}" = "production" ] || log "WARNING: NODE_ENV is '${NODE_ENV:-unset}' in $ENV_FILE (expected production)"
  log "env file ok (DATABASE_URL, SESSION_SECRET, UPLOAD_DIR present)"
}

step() { # step <description> <command string>: run in the release dir as the app user
  log ">>> $1"
  ( cd "$RELEASE_DIR" && as_app bash -c "$2" )
}

LOCK_DIR="$APP_ROOT/.deploy.lock"
HAVE_LOCK=0
acquire_lock() {
  mkdir -p "$APP_ROOT"
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    local pid
    pid="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      die "another deploy is running (pid $pid)" 2
    fi
    log "removing stale lock"
    rm -rf "$LOCK_DIR"
    mkdir "$LOCK_DIR" || die "cannot take the deploy lock" 2
  fi
  echo "$$" >"$LOCK_DIR/pid"
  HAVE_LOCK=1
}
release_lock() { [ "$HAVE_LOCK" = 1 ] && rm -rf "$LOCK_DIR" || true; }

cleanup_old() { # keep the newest KEEP_RELEASES, never the current or the previous one
  local keep_cur="$1" keep_prev="$2" all total n i=0
  all="$(list_releases)"
  total="$(printf '%s\n' "$all" | grep -c . || true)"
  while IFS= read -r n; do
    [ -n "$n" ] || continue
    i=$((i + 1))
    [ $((total - i)) -ge "$KEEP_RELEASES" ] || continue
    [ "$n" != "$keep_cur" ] && [ "$n" != "$keep_prev" ] || continue
    log "removing old release $n"
    rm -rf --one-file-system "${RELEASES:?}/$n"
  done <<<"$all"
}

# ---------------------------------------------------------------------------------------------------
# commands
# ---------------------------------------------------------------------------------------------------
do_status() {
  local cur
  cur="$(current_release)"
  echo "current : ${cur:-<none>}"
  echo "releases:"
  list_releases | sed "s/^/  /"
  if curl -fsS --max-time 3 "$HEALTH_URL" 2>/dev/null; then echo; else echo "health  : NOT OK ($HEALTH_URL)"; fi
}

restart_and_check() { # restart_and_check <expected-commit>: 0 when healthy afterwards
  log ">>> restart: $RESTART_CMD"
  bash -c "$RESTART_CMD" || { log "restart command failed"; return 1; }
  log ">>> waiting for $HEALTH_URL (up to ${HEALTH_TIMEOUT}s)"
  health_wait "${1:-}"
}

do_rollback() {
  local target="${1:-}" cur prev="" n
  cur="$(current_release)"
  [ -n "$cur" ] || die "there is no current release" 4
  if [ -z "$target" ]; then
    while IFS= read -r n; do
      [ "$n" = "$cur" ] && break
      prev="$n"
    done < <(list_releases)
    target="$prev"
  fi
  [ -n "$target" ] || die "no previous release to roll back to" 4
  [ -d "$RELEASES/$target" ] || die "release $target does not exist" 2
  [ "$target" != "$cur" ] || die "release $target is already the current one" 2
  if [ "$DRY_RUN" = 1 ]; then
    log "DRY_RUN: would re-point $CURRENT from $cur to $target, restart and check health"
    return 0
  fi
  acquire_lock
  trap release_lock EXIT
  journal "rollback START $cur -> $target"
  swap_to "$target"
  if restart_and_check ""; then
    log "ROLLBACK_OK now running $target"
    journal "rollback OK now $target"
  else
    die "rolled back to $target but the service is still unhealthy: check 'journalctl -u $SERVICE_NAME -n 100'" 4
  fi
}

do_deploy() {
  check_env

  local stamp release prev commit="unknown"
  stamp="$(date '+%Y%m%d%H%M%S')"
  while [ -e "$RELEASES/$stamp" ]; do sleep 1; stamp="$(date '+%Y%m%d%H%M%S')"; done
  RELEASE_DIR="$RELEASES/$stamp"
  release="$stamp"
  prev="$(current_release)"

  if [ "$DRY_RUN" = 1 ]; then
    log "DRY_RUN: nothing will be changed. Plan for release $release (current: ${prev:-none}):"
    if [ -n "$SOURCE_DIR" ]; then log "  1. fetch: copy $SOURCE_DIR -> $RELEASE_DIR"; else log "  1. fetch: git clone --depth 1 --branch ${REF} ${REPO_URL:-<REPO_URL not set>} $RELEASE_DIR"; fi
    log "  2. write $RELEASE_DIR/RELEASE.env (APP_COMMIT); chown to ${APP_USER:-current user}"
    if [ "$SKIP_BACKUP" = 1 ]; then log "  3. backup: skipped (SKIP_BACKUP=1)"; else log "  3. backup: $HERE/backup.sh (abort the deploy if it fails)"; fi
    log "  4. install: $INSTALL_CMD"
    log "  5. migrate: $MIGRATE_CMD   (abort here = live version untouched)"
    log "  6. build:   $BUILD_CMD"
    log "  7. swap:    $CURRENT -> $RELEASE_DIR (atomic)"
    log "  8. restart: $RESTART_CMD"
    log "  9. health:  $HEALTH_URL must report status ok within ${HEALTH_TIMEOUT}s"
    log " 10. on failure: re-point $CURRENT to ${prev:-<nothing: first deploy>} and restart"
    log " 11. keep the last $KEEP_RELEASES releases"
    [ -z "$SOURCE_DIR" ] && [ -z "$REPO_URL" ] && log "NOTE: set REPO_URL (+REF) or SOURCE_DIR before a real deploy"
    return 0
  fi

  [ -n "$SOURCE_DIR" ] || [ -n "$REPO_URL" ] || die "set REPO_URL (and optionally REF) or SOURCE_DIR" 2
  [ -z "$SOURCE_DIR" ] || [ -d "$SOURCE_DIR" ] || die "SOURCE_DIR $SOURCE_DIR is not a directory" 2

  acquire_lock
  trap 'release_lock' EXIT
  fail_before_swap() { # live version untouched: discard the half-built release
    log "ERROR: $1 - the live version was NOT touched"
    journal "deploy FAILED at: $1 (release $release discarded, live untouched)"
    rm -rf --one-file-system "${RELEASE_DIR:?}"
    exit 1
  }

  journal "deploy START release=$release ref=${REF} previous=${prev:-none}"
  log "deploy start: release $release (previous: ${prev:-none})"
  mkdir -p "$RELEASES"

  # 1. fetch
  if [ -n "$SOURCE_DIR" ]; then
    log ">>> fetch: copying $SOURCE_DIR"
    mkdir -p "$RELEASE_DIR"
    if command -v rsync >/dev/null 2>&1; then
      rsync -a --exclude node_modules --exclude .next --exclude .env --exclude '.env.*' "$SOURCE_DIR/" "$RELEASE_DIR/" || fail_before_swap "copy of SOURCE_DIR"
    else
      cp -a "$SOURCE_DIR/." "$RELEASE_DIR/" || fail_before_swap "copy of SOURCE_DIR"
      rm -rf "$RELEASE_DIR/node_modules" "$RELEASE_DIR/.next" "$RELEASE_DIR/.env"
    fi
  else
    log ">>> fetch: git clone $REPO_URL ($REF)"
    git clone --quiet --depth 1 --branch "$REF" "$REPO_URL" "$RELEASE_DIR" || fail_before_swap "git clone (REPO_URL/REF correct? deploy key installed?)"
  fi
  if [ -d "$RELEASE_DIR/.git" ] && commit="$(git -C "$RELEASE_DIR" rev-parse --short=12 HEAD 2>/dev/null)"; then :; else commit="${APP_COMMIT:-unknown}"; fi
  printf 'APP_COMMIT=%s\n' "$commit" >"$RELEASE_DIR/RELEASE.env"
  if [ -n "$APP_USER" ] && [ "$(id -u)" = 0 ]; then
    chown -R "$APP_USER:$(id -gn "$APP_USER")" "$RELEASE_DIR" || fail_before_swap "chown of the release"
  fi
  log "release $release = commit $commit"

  # 2. pre-deploy backup (a migration is the one irreversible thing in a deploy)
  if [ "$SKIP_BACKUP" = 1 ]; then
    log ">>> backup skipped (SKIP_BACKUP=1)"
  else
    log ">>> pre-deploy backup"
    as_app "$HERE/backup.sh" || fail_before_swap "pre-deploy backup (fix the backup or set SKIP_BACKUP=1 knowingly)"
  fi

  # 3. install, migrate, build - all BEFORE touching the running version
  step "install dependencies" "$INSTALL_CMD" || fail_before_swap "dependency install"
  step "database migrations" "$MIGRATE_CMD" || fail_before_swap "database migration"
  step "production build" "$BUILD_CMD" || fail_before_swap "production build"

  # 4. swap + restart + health
  swap_to "$release"
  log "current -> $release"
  if restart_and_check "$([ "$commit" = unknown ] && echo "" || echo "$commit")"; then
    cleanup_old "$release" "$prev"
    log "DEPLOY_OK release $release commit $commit"
    journal "deploy OK release=$release commit=$commit"
    return 0
  fi

  # 5. automatic rollback
  log "ERROR: release $release is NOT healthy - rolling back"
  journal "deploy UNHEALTHY release=$release - rolling back to ${prev:-nothing}"
  if [ -z "$prev" ] || [ ! -d "$RELEASES/$prev" ]; then
    log "ERROR: there is no previous release to go back to (first deploy?). Look at: journalctl -u $SERVICE_NAME -n 100"
    exit 4
  fi
  swap_to "$prev"
  if restart_and_check ""; then
    log "ROLLED_BACK to $prev (the failed release $release was kept for inspection in $RELEASES)"
    journal "deploy ROLLED_BACK to $prev; failed release $release kept"
    exit 3
  fi
  log "ERROR: rollback to $prev is ALSO unhealthy. Needs a human: journalctl -u $SERVICE_NAME -n 100"
  journal "deploy ROLLBACK FAILED - manual intervention"
  exit 4
}

case "$CMD" in
  status) do_status ;;
  rollback) do_rollback "${1:-}" ;;
  deploy) do_deploy ;;
esac
