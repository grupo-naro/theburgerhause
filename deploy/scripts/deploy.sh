#!/usr/bin/env bash
# The Burger Hause - deploy a new version with automatic rollback.
#
#   deploy.sh [deploy]            fetch -> env check -> backup -> install -> MIGRATE -> BUILD -> swap -> restart
#                                 -> health check -> (automatic ROLLBACK if unhealthy). Needs root (systemctl).
#   deploy.sh rollback [release]  manual rollback to the previous GOOD release (or the named good one)
#   deploy.sh status              current release, good/failed releases, health
#   deploy.sh --help
#
# RUN IT SO AN SSH DROP CANNOT HURT: `systemd-run --wait --collect --pty ...` or inside tmux (see the runbook).
# The script also ignores SIGHUP, and cleans up after SIGINT/SIGTERM.
#
# Why this order: the production build PRERENDERS the menu, so the database must be reachable and MIGRATED
# when `next build` runs. Migrations run BEFORE the running version is touched; if any step before the swap
# fails the live release keeps running untouched and the half-built release is deleted.
# Migrations must therefore be backward compatible with the previous release (add columns/tables first,
# remove things in a LATER release), otherwise an automatic rollback would run old code on a new schema.
# New migrations containing DROP / RENAME / SET NOT NULL are refused unless ALLOW_DESTRUCTIVE_MIGRATION=1.
#
# Layout:  $APP_ROOT/releases/<YYYYmmddHHMMSS>/   one directory per deploy; the file .deployed-ok inside marks a
#                                                 release that was deployed AND passed the health check. Only
#                                                 marked releases are ever rollback targets or kept as backups.
#          $APP_ROOT/releases/<stamp>.failed/     a release that failed its health check (kept for inspection)
#          $APP_ROOT/current  ->  releases/<...>   symlink, swapped atomically (mv -T: GNU coreutils)
#
# Exit codes: 0 deployed | 1 failed BEFORE the swap (live version untouched) | 2 usage/config/another deploy running
#             3 new version unhealthy, ROLLED BACK to the previous release (service healthy again)
#             4 unhealthy and rollback impossible or also unhealthy (NEEDS A HUMAN)
#
# Environment (defaults suit the production layout):
#   APP_ROOT=/opt/burgerhause   ENV_FILE=/etc/burgerhause/burgerhause.env   SERVICE_NAME=burgerhause
#   REPO_URL=<git url>  REF=main        source from git (shallow clone of branch/tag REF; commit SHAs are NOT
#                                       supported); both may also be set in the env file ($ENV_FILE)
#   SOURCE_DIR=<dir>                    OR copy an already prepared tree (rsync/scp'd artifact); wins over REPO_URL
#   APP_USER=burgerhause                steps install/migrate/build/backup run as this user when started as root
#   APP_HOME=/var/lib/burgerhause       HOME for those steps (pnpm store, corepack cache)
#   INSTALL_CMD="pnpm install --frozen-lockfile --prod=false"   (dev dependencies are needed to build)
#   MIGRATE_CMD="pnpm db:migrate"       BUILD_CMD="pnpm build"
#   RESTART_CMD="systemctl restart burgerhause"
#   HEALTH_URL=http://127.0.0.1:3000/api/health   HEALTH_TIMEOUT=60   HEALTH_INTERVAL=2
#   KEEP_RELEASES=5     SKIP_BACKUP=1 (skip the pre-deploy backup)     DRY_RUN=1 (print the plan, change nothing)
#   ALLOW_DESTRUCTIVE_MIGRATION=1       accept new migrations with DROP / RENAME / SET NOT NULL
#   NO_LOGGER=1         do not write to the system journal
set -euo pipefail

# An ssh drop (SIGHUP) must not kill a deploy between the swap and the rollback decision.
trap '' HUP

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
REPO_URL="${REPO_URL:-$(env_file_value "$ENV_FILE" REPO_URL)}"
REF="${REF:-$(env_file_value "$ENV_FILE" REF)}"
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
ALLOW_DESTRUCTIVE_MIGRATION="${ALLOW_DESTRUCTIVE_MIGRATION:-0}"
OK_MARKER=".deployed-ok"
MIGRATIONS_SUBDIR="src/db/migrations"

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

list_releases() { # every release directory (14-digit names), ascending
  [ -d "$RELEASES" ] || return 0
  find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -name '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]' -printf '%f\n' | sort
}

list_ok_releases() { # only releases that were deployed AND healthy, ascending
  local n
  while IFS= read -r n; do
    [ -n "$n" ] && [ -f "$RELEASES/$n/$OK_MARKER" ] && printf '%s\n' "$n"
  done < <(list_releases)
  return 0
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

check_env() { # validate the production env file; never prints values
  [ -r "$ENV_FILE" ] || die "env file $ENV_FILE does not exist or is not readable" 2
  load_env_file "$ENV_FILE"
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

check_source_args() { # reject values that git could take as options; branches/tags only
  if [ -z "$SOURCE_DIR" ]; then
    case "$REPO_URL" in -*) die "REPO_URL must not start with '-'" 2 ;; esac
    case "$REF" in -*) die "REF must not start with '-'" 2 ;; esac
    [[ "$REF" =~ ^[A-Za-z0-9._/-]+$ ]] || die "REF '$REF' is not a plain branch or tag name (letters, digits, . _ / -; commit SHAs are not supported)" 2
  fi
}

# --- child process tracking so that a signal can stop a running step --------------------------------------------
CHILD_PID=""
kill_tree() { # kill_tree <pid>
  local c
  if command -v pgrep >/dev/null 2>&1; then
    for c in $(pgrep -P "$1" 2>/dev/null || true); do kill_tree "$c"; done
  fi
  kill "$1" 2>/dev/null || true
}

step() { # step <description> <command string>: run in the release dir as the app user (interruptible)
  local rc=0
  log ">>> $1"
  ( cd "$RELEASE_DIR" && as_app bash -c "$2" ) 9>&- &
  CHILD_PID=$!
  wait "$CHILD_PID" || rc=$?
  CHILD_PID=""
  return "$rc"
}

# --- lock: flock when available (released automatically if the process dies), else an atomic mkdir ---------------------
LOCK_FILE="$APP_ROOT/.deploy.lock"
HAVE_LOCK=0
acquire_lock() {
  mkdir -p "$APP_ROOT"
  if command -v flock >/dev/null 2>&1; then
    exec 9>>"$LOCK_FILE"
    if ! flock -n 9; then
      die "another deploy is running (pid $(cat "$LOCK_FILE.pid" 2>/dev/null || echo '?'))" 2
    fi
    printf '%s\n' "$$" >"$LOCK_FILE.pid"
  else
    # Publish the lock directory ATOMICALLY with the pid already inside (no window with an empty lock).
    local tmp="$LOCK_FILE.d.$$" pid
    mkdir "$tmp" && printf '%s\n' "$$" >"$tmp/pid"
    if ! mv -T "$tmp" "$LOCK_FILE.d" 2>/dev/null; then
      rm -rf "$tmp"
      pid="$(cat "$LOCK_FILE.d/pid" 2>/dev/null || true)"
      if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then die "another deploy is running (pid $pid)" 2; fi
      die "a stale deploy lock exists ($LOCK_FILE.d, pid ${pid:-?} is not running): remove it by hand if no deploy is running" 2
    fi
  fi
  HAVE_LOCK=1
}
release_lock() { # (the flock is released by the kernel on exit)
  if [ "$HAVE_LOCK" = 1 ]; then rm -rf "$LOCK_FILE.d" "$LOCK_FILE.pid" 2>/dev/null || true; fi
}

# --- exit handling -------------------------------------------------------------------------------------------------------
PHASE="none"     # none | pre (release being built, not live) | swapped (live, health decision pending) | decided
RELEASE_DIR=""
on_exit() {
  local rc=$?
  trap - EXIT
  if [ -n "$CHILD_PID" ]; then kill_tree "$CHILD_PID"; fi
  case "$PHASE" in
    pre)
      # abnormal exit before the swap: the half-built release was never live -> discard it
      if [ -n "$RELEASE_DIR" ] && [ -d "$RELEASE_DIR" ] && [ "$(readlink -f "$CURRENT" 2>/dev/null || true)" != "$(readlink -f "$RELEASE_DIR")" ]; then
        rm -rf --one-file-system "${RELEASE_DIR:?}"
        log "interrupted before the swap: half-built release discarded, live version untouched"
        journal "deploy interrupted before the swap (exit $rc); half-built release discarded"
      fi
      ;;
    swapped)
      log "RECOVERY: the deploy was interrupted AFTER the swap and BEFORE the health decision (exit $rc)."
      log "RECOVERY: check the service:  sudo $0 status   - if it is not healthy:  sudo $0 rollback"
      journal "deploy INTERRUPTED after the swap (exit $rc): run deploy.sh status / rollback"
      ;;
  esac
  release_lock
  exit "$rc"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

prune_stale() { # at the start of a deploy: drop half-built/unmarked release dirs of killed deploys, old *.failed
  local cur n f
  cur="$(current_release)"
  while IFS= read -r n; do
    [ -n "$n" ] || continue
    [ "$n" != "$cur" ] || continue
    [ -f "$RELEASES/$n/$OK_MARKER" ] && continue
    log "removing stale unmarked release $n (left by an interrupted deploy)"
    rm -rf --one-file-system "${RELEASES:?}/$n"
  done < <(list_releases)
  # keep only the 2 newest failed releases for inspection
  local i=0
  while IFS= read -r f; do
    i=$((i + 1))
    [ "$i" -gt 2 ] || continue
    log "removing old failed release $f"
    rm -rf --one-file-system "${RELEASES:?}/$f"
  done < <(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -name '*.failed' -printf '%f\n' 2>/dev/null | sort -r)
}

cleanup_old() { # keep the newest KEEP_RELEASES GOOD releases; never the current or the previous one
  local keep_cur="$1" keep_prev="$2" all total n i=0
  all="$(list_ok_releases)"
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

check_migrations() { # refuse new destructive migrations unless explicitly allowed
  local prev="$1" f base found="" hits
  [ -n "$prev" ] || return 0 # first deploy: nothing to roll back to
  [ -d "$RELEASE_DIR/$MIGRATIONS_SUBDIR" ] || return 0
  for f in "$RELEASE_DIR/$MIGRATIONS_SUBDIR"/*.sql; do
    [ -f "$f" ] || continue
    base="$(basename "$f")"
    [ -f "$RELEASES/$prev/$MIGRATIONS_SUBDIR/$base" ] && continue # already part of the running release
    hits="$(grep -inE 'drop |rename |set not null' "$f" || true)"
    if [ -n "$hits" ]; then
      found="$found\n  $base: $(printf '%s' "$hits" | head -n 3 | tr '\n' ' ')"
    fi
  done
  [ -n "$found" ] || return 0
  log "WARNING ----------------------------------------------------------------------------------"
  log "WARNING: the NEW migrations contain destructive statements (DROP / RENAME / SET NOT NULL):"
  printf '%b\n' "$found"
  log "WARNING: an automatic rollback would run the OLD code on the NEW schema and may fail or corrupt data."
  log "WARNING: prefer additive migrations (nullable columns or columns with DEFAULT), removals in a later release."
  log "WARNING ----------------------------------------------------------------------------------"
  if [ "$ALLOW_DESTRUCTIVE_MIGRATION" = 1 ]; then
    log "ALLOW_DESTRUCTIVE_MIGRATION=1: continuing (a fresh backup was taken before the migration)"
    return 0
  fi
  return 1
}

# ---------------------------------------------------------------------------------------------------
# commands
# ---------------------------------------------------------------------------------------------------
do_status() {
  local cur n
  cur="$(current_release)"
  echo "current : ${cur:-<none>}"
  echo "good releases (rollback targets):"
  list_ok_releases | sed "s/^/  /"
  echo "other (failed / unmarked):"
  { list_releases | while IFS= read -r n; do [ -f "$RELEASES/$n/$OK_MARKER" ] || echo "$n (unmarked)"; done
    find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -name '*.failed' -printf '%f\n' 2>/dev/null | sort; } | sed "s/^/  /"
  if curl -fsS --max-time 3 "$HEALTH_URL" 2>/dev/null; then echo; else echo "health  : NOT OK ($HEALTH_URL)"; fi
}

restart_and_check() { # restart_and_check <expected-commit>: 0 when healthy afterwards
  log ">>> restart: $RESTART_CMD"
  bash -c "$RESTART_CMD" 9>&- || { log "restart command failed"; return 1; }
  log ">>> waiting for $HEALTH_URL (up to ${HEALTH_TIMEOUT}s)"
  health_wait "${1:-}"
}

do_rollback() {
  local target="${1:-}" cur prev="" n
  cur="$(current_release)"
  [ -n "$cur" ] || die "there is no current release" 4
  if [ -z "$target" ]; then
    # the closest GOOD release older than the current one
    while IFS= read -r n; do
      [ "$n" = "$cur" ] && break
      prev="$n"
    done < <(list_ok_releases)
    target="$prev"
  fi
  [ -n "$target" ] || die "no previous GOOD release to roll back to" 4
  [ -d "$RELEASES/$target" ] || die "release $target does not exist" 2
  [ -f "$RELEASES/$target/$OK_MARKER" ] || die "release $target was never deployed successfully (no $OK_MARKER): refusing to roll back to it" 2
  [ "$target" != "$cur" ] || die "release $target is already the current one" 2
  if [ "$DRY_RUN" = 1 ]; then
    log "DRY_RUN: would re-point $CURRENT from $cur to $target, restart and check health"
    return 0
  fi
  acquire_lock
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
  check_source_args
  check_env

  local stamp release prev commit="unknown"
  stamp="$(date '+%Y%m%d%H%M%S')"
  while [ -e "$RELEASES/$stamp" ] || [ -e "$RELEASES/$stamp.failed" ]; do sleep 1; stamp="$(date '+%Y%m%d%H%M%S')"; done
  RELEASE_DIR="$RELEASES/$stamp"
  release="$stamp"
  prev="$(current_release)"

  if [ "$DRY_RUN" = 1 ]; then
    log "DRY_RUN: nothing will be changed. Plan for release $release (current: ${prev:-none}):"
    if [ -n "$SOURCE_DIR" ]; then log "  1. fetch: copy $SOURCE_DIR -> $RELEASE_DIR"; else log "  1. fetch: git clone --depth 1 --branch ${REF} -- ${REPO_URL:-<REPO_URL not set>} $RELEASE_DIR"; fi
    log "  2. write $RELEASE_DIR/RELEASE.env (APP_COMMIT); chown to ${APP_USER:-current user}"
    if [ "$SKIP_BACKUP" = 1 ]; then log "  3. backup: skipped (SKIP_BACKUP=1)"; else log "  3. backup: $HERE/backup.sh (abort the deploy if it fails)"; fi
    log "  4. install: $INSTALL_CMD"
    log "  5. migrate: $MIGRATE_CMD   (abort here = live version untouched; destructive new migrations are refused)"
    log "  6. build:   $BUILD_CMD"
    log "  7. swap:    $CURRENT -> $RELEASE_DIR (atomic)"
    log "  8. restart: $RESTART_CMD"
    log "  9. health:  $HEALTH_URL must report status ok within ${HEALTH_TIMEOUT}s, then mark the release $OK_MARKER"
    log " 10. on failure: re-point $CURRENT to ${prev:-<nothing: first deploy>}, restart, rename the failed release *.failed"
    log " 11. keep the last $KEEP_RELEASES good releases"
    [ -z "$SOURCE_DIR" ] && [ -z "$REPO_URL" ] && log "NOTE: set REPO_URL (+REF) or SOURCE_DIR before a real deploy"
    return 0
  fi

  [ -n "$SOURCE_DIR" ] || [ -n "$REPO_URL" ] || die "set REPO_URL (and optionally REF) or SOURCE_DIR" 2
  [ -z "$SOURCE_DIR" ] || [ -d "$SOURCE_DIR" ] || die "SOURCE_DIR $SOURCE_DIR is not a directory" 2

  acquire_lock
  fail_before_swap() { # live version untouched: discard the half-built release (the exit trap removes it)
    log "ERROR: $1 - the live version was NOT touched"
    journal "deploy FAILED at: $1 (release $release discarded, live untouched)"
    exit 1
  }

  journal "deploy START release=$release ref=${REF} previous=${prev:-none}"
  log "deploy start: release $release (previous: ${prev:-none})"
  mkdir -p "$RELEASES"
  prune_stale
  PHASE="pre"

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
    git clone --quiet --depth 1 --branch "$REF" -- "$REPO_URL" "$RELEASE_DIR" || fail_before_swap "git clone (REPO_URL/REF correct? deploy key installed?)"
  fi
  rm -f "$RELEASE_DIR/$OK_MARKER" # a copied tree must never arrive pre-marked
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

  # 3. install, check migrations, migrate, build - all BEFORE touching the running version
  step "install dependencies" "$INSTALL_CMD" || fail_before_swap "dependency install"
  check_migrations "$prev" || fail_before_swap "destructive migration refused (set ALLOW_DESTRUCTIVE_MIGRATION=1 only after reading the warning above)"
  step "database migrations" "$MIGRATE_CMD" || fail_before_swap "database migration"
  step "production build" "$BUILD_CMD" || fail_before_swap "production build"

  # 4. swap + restart + health
  swap_to "$release"
  PHASE="swapped"
  log "current -> $release"
  if restart_and_check "$([ "$commit" = unknown ] && echo "" || echo "$commit")"; then
    touch "$RELEASE_DIR/$OK_MARKER"
    PHASE="decided"
    cleanup_old "$release" "$prev"
    log "DEPLOY_OK release $release commit $commit"
    journal "deploy OK release=$release commit=$commit"
    return 0
  fi

  # 5. automatic rollback
  log "ERROR: release $release is NOT healthy - rolling back"
  journal "deploy UNHEALTHY release=$release - rolling back to ${prev:-nothing}"
  if [ -z "$prev" ] || [ ! -d "$RELEASES/$prev" ]; then
    PHASE="decided"
    log "ERROR: there is no previous release to go back to (first deploy?). Look at: journalctl -u $SERVICE_NAME -n 100"
    exit 4
  fi
  swap_to "$prev"
  PHASE="decided"
  mv "$RELEASES/$release" "$RELEASES/$release.failed" # outside the release glob: never a rollback target again
  if restart_and_check ""; then
    log "ROLLED_BACK to $prev (the failed release was kept as $release.failed for inspection)"
    journal "deploy ROLLED_BACK to $prev; failed release kept as $release.failed"
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
