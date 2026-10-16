#!/usr/bin/env bash
# shellcheck disable=SC2010  # ls|grep on our own timestamp-named dirs is fine in tests
# shellcheck disable=SC2034  # `out` of some scenarios is intentionally unused
# deploy.sh scenarios: dry run, success, slow start (503 then 200), automatic rollback, failures before the swap,
# manual rollback, retention, lock, env validation. Runs INSIDE a Linux container (symlinks, GNU tools, nginx
# as the fake service) - launched by deploy/tests/deploy-test.sh. Needs no root privileges beyond the container.
set -uo pipefail

DEPLOY=/deploy                      # the repo's deploy/ directory (read-only mount)
export APP_ROOT=/tmp/app STUB_DIR=/tmp/stub ENV_FILE=/tmp/app.env
export NO_LOGGER=1 APP_USER="" SKIP_BACKUP=1
export HEALTH_URL=http://127.0.0.1:3999/api/health HEALTH_TIMEOUT=6 HEALTH_INTERVAL=1
export INSTALL_CMD='echo install >>"$STUB_DIR/steps.log"; touch INSTALLED'
export MIGRATE_CMD='echo migrate >>"$STUB_DIR/steps.log"; touch MIGRATED; printf %s "$DATABASE_URL" >"$STUB_DIR/dburl"'
export BUILD_CMD='echo build >>"$STUB_DIR/steps.log"; touch BUILT'
export RESTART_CMD="bash $DEPLOY/tests/fake-service.sh"
DEPLOY_SH="$DEPLOY/scripts/deploy.sh"

FAILS=0
ok() { printf '  ok   %s\n' "$1"; }
bad() { printf '  FAIL %s\n' "$1"; FAILS=$((FAILS + 1)); }
expect() { # expect <description> <command...>
  local d="$1"; shift
  if "$@"; then ok "$d"; else bad "$d"; fi
}
eq() { [ "$1" = "$2" ]; }
cur() { basename "$(readlink -f "$APP_ROOT/current" 2>/dev/null)" 2>/dev/null || echo none; }
nreleases() { find "$APP_ROOT/releases" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l; }
steps() { tr '\n' ' ' <"$STUB_DIR/steps.log" 2>/dev/null || true; }
health_code() { curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$HEALTH_URL" || true; }

write_env() {
  cat >"$ENV_FILE" <<'ENVF'
DATABASE_URL=postgres://burgerhause:secret@127.0.0.1:5432/burgerhause?sslmode=disable&x=1
SESSION_SECRET=0123456789abcdef0123456789abcdef0123456789
UPLOAD_DIR=/var/lib/burgerhause/uploads
NODE_ENV=production
ENVF
}
mksrc() { # mksrc <health-mode> -> prints the dir of a fake release tree
  local d; d="$(mktemp -d /tmp/src.XXXXXX)"
  echo "$1" >"$d/HEALTH_MODE"
  echo "app" >"$d/package.json"
  printf '%s' "$d"
}
reset_world() { stop_stub; rm -rf "$APP_ROOT" "$STUB_DIR"; mkdir -p "$STUB_DIR"; : >"$STUB_DIR/steps.log"; write_env; }
stop_stub() {
  [ -f "$STUB_DIR/timer.pid" ] && kill "$(cat "$STUB_DIR/timer.pid")" 2>/dev/null
  [ -f "$STUB_DIR/nginx.pid" ] && kill "$(cat "$STUB_DIR/nginx.pid")" 2>/dev/null
  sleep 0.3
  return 0
}
trap 'stop_stub; rm -rf /tmp/src.* "$APP_ROOT" "$STUB_DIR" "$ENV_FILE"' EXIT

run_deploy() { # run_deploy <mode> [extra env assignments via env]; sets RC and OUT
  local src; src="$(mksrc "$1")"
  OUT="$(SOURCE_DIR="$src" bash "$DEPLOY_SH" 2>&1)"; RC=$?
}

# ------------------------------------------------------------------------------------------------
echo "== 1. DRY_RUN prints the plan and changes nothing"
reset_world
src="$(mksrc ok)"
OUT="$(DRY_RUN=1 SOURCE_DIR="$src" bash "$DEPLOY_SH" 2>&1)"; RC=$?
expect "exit 0" eq "$RC" 0
expect "plan lists install, migrate, build, swap, restart, health, rollback" bash -c 'for w in "install:" "migrate:" "build:" "swap:" "restart:" "health:" "on failure"; do grep -q "$w" <<<"$1" || exit 1; done' _ "$OUT"
expect "no releases dir, no current, no restart" bash -c '[ ! -e "$1/releases" ] && [ ! -e "$1/current" ] && [ ! -s "$2/steps.log" ]' _ "$APP_ROOT" "$STUB_DIR"
echo "$OUT" | sed 's/^/    /'

# ------------------------------------------------------------------------------------------------
echo "== 2. first deploy succeeds"
reset_world
run_deploy ok
expect "exit 0 (got $RC)" eq "$RC" 0
R1="$(cur)"
expect "current -> a release dir ($R1)" bash -c '[ -L "$1/current" ] && [ -d "$1/releases/$2" ]' _ "$APP_ROOT" "$R1"
expect "order: install, migrate, build, restart" eq "$(steps)" "install migrate build restart $R1 "
expect "service healthy (200)" eq "$(health_code)" 200
expect "RELEASE.env written" test -s "$APP_ROOT/releases/$R1/RELEASE.env"
expect "env file value with ? & = reaches the migrate step intact" eq "$(cat "$STUB_DIR/dburl")" "postgres://burgerhause:secret@127.0.0.1:5432/burgerhause?sslmode=disable&x=1"
expect "no secrets in the deploy output" bash -c '! grep -q "secret" <<<"$1"' _ "$OUT"
echo "$OUT" | sed 's/^/    /'

# ------------------------------------------------------------------------------------------------
echo "== 3. second deploy swaps; previous release is kept"
run_deploy ok
R2="$(cur)"
expect "exit 0 (got $RC)" eq "$RC" 0
expect "current moved to a new release ($R2 != $R1)" bash -c '[ "$1" != "$2" ] && [ "$2" != none ]' _ "$R1" "$R2"
expect "previous release dir still there" test -d "$APP_ROOT/releases/$R1"

# ------------------------------------------------------------------------------------------------
echo "== 4. slow start: 503 first, then 200 -> deploy still succeeds"
: >"$STUB_DIR/steps.log"
HEALTH_TIMEOUT=10 run_deploy slow:3
R3="$(cur)"
expect "exit 0 after 503s then 200 (got $RC)" eq "$RC" 0
expect "current -> new release" bash -c '[ "$1" != "$2" ]' _ "$R3" "$R2"
expect "health 200 now" eq "$(health_code)" 200

# ------------------------------------------------------------------------------------------------
echo "== 5. unhealthy new release -> automatic ROLLBACK"
: >"$STUB_DIR/steps.log"
HEALTH_TIMEOUT=4 run_deploy bad
expect "exit 3 (rolled back, got $RC)" eq "$RC" 3
expect "symlink points back to the previous release ($R3)" eq "$(cur)" "$R3"
expect "service healthy again after rollback" eq "$(health_code)" 200
expect "two restarts: failed release, then the previous one" bash -c '[ "$(grep -c "^restart" "$1/steps.log")" = 2 ] && grep -q "^restart $2$" "$1/steps.log"' _ "$STUB_DIR" "$R3"
expect "output says ROLLED_BACK" bash -c 'grep -q ROLLED_BACK <<<"$1"' _ "$OUT"
expect "failed release kept for inspection ($(nreleases) dirs)" bash -c '[ "$(find "$1/releases" -mindepth 1 -maxdepth 1 -type d | wc -l)" -ge 4 ]' _ "$APP_ROOT"
echo "$OUT" | tail -8 | sed 's/^/    /'

echo "== 5b. an OLD process still answering (wrong commit) is not accepted -> rollback"
: >"$STUB_DIR/steps.log"
APP_COMMIT=newcommit1 HEALTH_TIMEOUT=3 run_deploy stale-commit
expect "exit 3 (got $RC)" eq "$RC" 3
expect "back on $R3" eq "$(cur)" "$R3"

# ------------------------------------------------------------------------------------------------
echo "== 6. failures BEFORE the swap leave the live version untouched"
before="$(nreleases)"
: >"$STUB_DIR/steps.log"
MIGRATE_CMD=false run_deploy ok
expect "migration failure: exit 1 (got $RC)" eq "$RC" 1
expect "current unchanged ($R3)" eq "$(cur)" "$R3"
expect "no restart happened" eq "$(grep -c '^restart' "$STUB_DIR/steps.log")" 0
expect "build was not even attempted" bash -c '! grep -q "^build" "$1/steps.log"' _ "$STUB_DIR"
expect "half-built release removed ($before dirs before = $(nreleases) after)" eq "$(nreleases)" "$before"
BUILD_CMD=false run_deploy ok
expect "build failure: exit 1 (got $RC), current unchanged" bash -c '[ "$1" = 1 ] && [ "$2" = "$3" ]' _ "$RC" "$(cur)" "$R3"
SKIP_BACKUP=0 PGDUMP_CMD=false run_deploy ok
expect "backup failure aborts the deploy: exit 1 (got $RC), current unchanged" bash -c '[ "$1" = 1 ] && [ "$2" = "$3" ]' _ "$RC" "$(cur)" "$R3"
expect "service still healthy" eq "$(health_code)" 200

# ------------------------------------------------------------------------------------------------
echo "== 7. configuration checks (nothing is created)"
before="$(nreleases)"
sed -i 's/^SESSION_SECRET=.*/SESSION_SECRET=short/' "$ENV_FILE"
run_deploy ok
expect "short SESSION_SECRET refused: exit 2 (got $RC)" eq "$RC" 2
write_env; echo 'ALLOW_DEMO_SEED=1' >>"$ENV_FILE"
run_deploy ok
expect "ALLOW_DEMO_SEED refused: exit 2 (got $RC)" eq "$RC" 2
write_env; sed -i 's/^UPLOAD_DIR=.*/UPLOAD_DIR=relative\/path/' "$ENV_FILE"
run_deploy ok
expect "relative UPLOAD_DIR refused: exit 2 (got $RC)" eq "$RC" 2
write_env; sed -i 's/^SESSION_SECRET=.*/SESSION_SECRET=CHANGE_ME_openssl_rand_base64_48_padding_padding/' "$ENV_FILE"
run_deploy ok
expect "template placeholder refused: exit 2 (got $RC)" eq "$RC" 2
write_env
ENV_FILE=/tmp/does-not-exist.env run_deploy ok
expect "missing env file refused: exit 2 (got $RC)" eq "$RC" 2
expect "no release was created by any of them" eq "$(nreleases)" "$before"
expect "no secret value printed" bash -c '! grep -q "0123456789abcdef" <<<"$1"' _ "$OUT"

# ------------------------------------------------------------------------------------------------
echo "== 8. concurrency: two simultaneous deploys, one runs and the other refuses"
BUILD_CMD='sleep 4; touch BUILT' SOURCE_DIR="$(mksrc ok)" bash "$DEPLOY_SH" >"$STUB_DIR/a.out" 2>&1 &
APID=$!
sleep 1.5
run_deploy ok
expect "second deploy refused: exit 2 (got $RC)" eq "$RC" 2
expect "refusal message is clear" bash -c 'grep -q "another deploy is running" <<<"$1"' _ "$OUT"
wait "$APID"; arc=$?
expect "first deploy completed: exit 0 (got $arc)" eq "$arc" 0
run_deploy ok
expect "after it finished a new deploy works: exit 0 (got $RC)" eq "$RC" 0
R4="$(cur)"

# ------------------------------------------------------------------------------------------------
echo "== 9. manual rollback"
out="$(bash "$DEPLOY_SH" rollback 2>&1)"; rc=$?
expect "exit 0 (got $rc)" eq "$rc" 0
expect "current moved back to the release before $R4" bash -c '[ "$1" != "$2" ] && [ "$1" != none ]' _ "$(cur)" "$R4"
expect "healthy after manual rollback" eq "$(health_code)" 200
out="$(bash "$DEPLOY_SH" rollback "$R4" 2>&1)"; rc=$?
expect "rollback to a named release (roll forward) works (got $rc)" bash -c '[ "$1" = 0 ] && [ "$2" = "$3" ]' _ "$rc" "$(cur)" "$R4"
out="$(bash "$DEPLOY_SH" rollback 20000101000000 2>&1)"; rc=$?
expect "unknown release refused (got $rc)" eq "$rc" 2
out="$(DRY_RUN=1 bash "$DEPLOY_SH" rollback 2>&1)"; rc=$?
expect "rollback DRY_RUN changes nothing (got $rc)" bash -c '[ "$1" = 0 ] && [ "$2" = "$3" ]' _ "$rc" "$(cur)" "$R4"
bash "$DEPLOY_SH" status | sed 's/^/    /'

# ------------------------------------------------------------------------------------------------
echo "== 10. first deploy unhealthy and nothing to go back to"
reset_world
HEALTH_TIMEOUT=3 run_deploy bad
expect "exit 4 (needs a human, got $RC)" eq "$RC" 4
expect "output explains there is no previous release" bash -c 'grep -q "no previous release" <<<"$1"' _ "$OUT"

# ------------------------------------------------------------------------------------------------
echo "== 11. retention keeps the last 5 and never the current"
reset_world
for _ in 1 2 3 4 5 6 7; do run_deploy ok; done
expect "last deploy exit 0" eq "$RC" 0
expect "5 releases kept (got $(nreleases))" eq "$(nreleases)" 5
expect "current is the newest" eq "$(cur)" "$(ls -1 "$APP_ROOT/releases" | sort | tail -1)"

# ------------------------------------------------------------------------------------------------
echo "== 12. rollback never lands on a failed release (fail, then succeed, then rollback -> R1, not R2)"
reset_world
run_deploy ok; R1="$(cur)"
HEALTH_TIMEOUT=3 run_deploy bad
expect "R2 fails and is rolled back: exit 3 (got $RC)" eq "$RC" 3
expect "failed release renamed *.failed (outside the release glob)" bash -c 'ls "$1/releases" | grep -q "\.failed$"' _ "$APP_ROOT"
run_deploy ok; R3="$(cur)"
expect "R3 live (marker .deployed-ok present)" test -f "$APP_ROOT/releases/$R3/.deployed-ok"
out="$(bash "$DEPLOY_SH" rollback 2>&1)"; rc=$?
expect "manual rollback exit 0 (got $rc)" eq "$rc" 0
expect "rollback landed on R1 ($R1), not on the failed release" eq "$(cur)" "$R1"
out="$(bash "$DEPLOY_SH" rollback "$(ls "$APP_ROOT/releases" | grep '\.failed$' | head -1)" 2>&1)"; rc=$?
expect "naming a failed release explicitly is refused (got $rc)" bash -c '[ "$1" != 0 ]' _ "$rc"

echo "== 13. killed deploy leaves a half-built dir: next deploy cleans it, rollback ignores it"
reset_world
run_deploy ok; R1="$(cur)"
BUILD_CMD='sleep 60' SOURCE_DIR="$(mksrc ok)" bash "$DEPLOY_SH" >"$STUB_DIR/k.out" 2>&1 &
KPID=$!
for _ in $(seq 1 40); do [ "$(nreleases)" = 2 ] && break; sleep 0.25; done
kill -9 "$KPID" 2>/dev/null; wait "$KPID" 2>/dev/null
expect "half-built release dir left behind by the SIGKILL ($(nreleases) dirs)" eq "$(nreleases)" 2
expect "it has no OK marker" bash -c 'n=0; for d in "$1"/releases/*/; do [ -f "$d/.deployed-ok" ] || n=$((n+1)); done; [ "$n" = 1 ]' _ "$APP_ROOT"
run_deploy ok; R3="$(cur)"
expect "next deploy exit 0 (got $RC)" eq "$RC" 0
expect "stale half-built dir was removed (only $R1 and $R3 remain)" eq "$(ls "$APP_ROOT/releases" | tr '\n' ' ')" "$R1 $R3 "
out="$(bash "$DEPLOY_SH" rollback 2>&1)"; rc=$?
expect "rollback -> $R1 (exit $rc)" bash -c '[ "$1" = 0 ] && [ "$2" = "$3" ]' _ "$rc" "$(cur)" "$R1"

echo "== 14. SIGTERM mid-build removes the half-built release and leaves current alone"
reset_world
run_deploy ok; R1="$(cur)"
BUILD_CMD='sleep 60' SOURCE_DIR="$(mksrc ok)" bash "$DEPLOY_SH" >"$STUB_DIR/t.out" 2>&1 &
TPID=$!
for _ in $(seq 1 40); do [ "$(nreleases)" = 2 ] && break; sleep 0.25; done
kill -TERM "$TPID"; wait "$TPID"; trc=$?
expect "terminated (exit $trc, not 0)" bash -c '[ "$1" != 0 ]' _ "$trc"
expect "half-built dir removed, current untouched" bash -c '[ "$(ls "$1/releases" | wc -l)" = 1 ] && [ "$2" = "$3" ]' _ "$APP_ROOT" "$(cur)" "$R1"

echo "== 15. SIGHUP (ssh drop) does not abort a deploy during the health check"
reset_world
run_deploy ok; R1="$(cur)"
: >"$STUB_DIR/steps.log"
HEALTH_TIMEOUT=12 SOURCE_DIR="$(mksrc slow:4)" bash "$DEPLOY_SH" >"$STUB_DIR/h.out" 2>&1 &
HPID=$!
for _ in $(seq 1 60); do grep -q '^restart' "$STUB_DIR/steps.log" && break; sleep 0.25; done
kill -HUP "$HPID"; wait "$HPID"; hrc=$?
expect "deploy still completed after SIGHUP: exit 0 (got $hrc)" eq "$hrc" 0
expect "new release is live" bash -c '[ "$1" != "$2" ]' _ "$(cur)" "$R1"
: >"$STUB_DIR/steps.log"
HEALTH_TIMEOUT=5 SOURCE_DIR="$(mksrc bad)" bash "$DEPLOY_SH" >"$STUB_DIR/h2.out" 2>&1 &
HPID=$!
for _ in $(seq 1 60); do grep -q '^restart' "$STUB_DIR/steps.log" && break; sleep 0.25; done
kill -HUP "$HPID"; wait "$HPID"; hrc=$?
expect "unhealthy deploy + SIGHUP still reaches the rollback decision: exit 3 (got $hrc)" eq "$hrc" 3

echo "== 16. SIGTERM after the swap prints a recovery note"
reset_world
run_deploy ok
: >"$STUB_DIR/steps.log"
HEALTH_TIMEOUT=30 SOURCE_DIR="$(mksrc bad)" bash "$DEPLOY_SH" >"$STUB_DIR/r.out" 2>&1 &
RPID=$!
for _ in $(seq 1 60); do grep -q '^restart' "$STUB_DIR/steps.log" && break; sleep 0.25; done
kill -TERM "$RPID"; wait "$RPID"; rrc=$?
expect "exit non-zero (got $rrc)" bash -c '[ "$1" != 0 ]' _ "$rrc"
expect "output tells the operator to run status / rollback" bash -c 'grep -q "RECOVERY" "$1" && grep -q "deploy.sh rollback" "$1"' _ "$STUB_DIR/r.out"

echo "== 17. REPO_URL / REF validation"
reset_world
for ref in '--upload-pack=touch /tmp/pwn' 'a b' '-x' 'a;b' '$(id)'; do
  OUT="$(REPO_URL=file:///nonexistent REF="$ref" bash "$DEPLOY_SH" 2>&1)"; RC=$?
  expect "REF '$ref' rejected (exit $RC)" eq "$RC" 2
done
OUT="$(REPO_URL='--upload-pack=touch /tmp/pwn' bash "$DEPLOY_SH" 2>&1)"; RC=$?
expect "REPO_URL starting with '-' rejected (exit $RC)" eq "$RC" 2
OUT="$(REPO_URL=file:///nonexistent REF=release/v1.2-rc.1 bash "$DEPLOY_SH" 2>&1)"; RC=$?
expect "a valid branch/tag name passes validation and fails only at the clone: exit 1 (got $RC)" eq "$RC" 1
expect "nothing created by the failed clone" eq "$(nreleases)" 0

echo "== 18. destructive migrations need ALLOW_DESTRUCTIVE_MIGRATION=1"
reset_world
mig() { # mig <mode> <file:content>...  -> source dir with src/db/migrations
  local d f; d="$(mksrc "$1")"; shift; mkdir -p "$d/src/db/migrations"
  for f in "$@"; do printf '%s\n' "${f#*:}" >"$d/src/db/migrations/${f%%:*}"; done
  printf '%s' "$d"
}
M0='0000_init.sql:CREATE TABLE t (id int, c text);'
M1='0001_add.sql:ALTER TABLE t ADD COLUMN d text;'
OUT="$(SOURCE_DIR="$(mig ok "$M0")" bash "$DEPLOY_SH" 2>&1)"; RC=$?
expect "first deploy (no previous release) skips the check: exit 0 (got $RC)" eq "$RC" 0
OUT="$(SOURCE_DIR="$(mig ok "$M0" "$M1")" bash "$DEPLOY_SH" 2>&1)"; RC=$?
expect "additive migration passes: exit 0 (got $RC)" eq "$RC" 0
R_PREV="$(cur)"
for bad in 'ALTER TABLE t DROP COLUMN c;' 'ALTER TABLE t RENAME COLUMN c TO e;' 'ALTER TABLE t ALTER COLUMN c SET NOT NULL;'; do
  OUT="$(SOURCE_DIR="$(mig ok "$M0" "$M1" "0002_x.sql:$bad")" bash "$DEPLOY_SH" 2>&1)"; RC=$?
  expect "'$bad' refused: exit 1 (got $RC)" eq "$RC" 1
  expect "  loud warning about unsafe rollback" bash -c 'grep -q "ALLOW_DESTRUCTIVE_MIGRATION" <<<"$1" && grep -qi "rollback" <<<"$1"' _ "$OUT"
  expect "  live release untouched" eq "$(cur)" "$R_PREV"
done
OUT="$(ALLOW_DESTRUCTIVE_MIGRATION=1 SOURCE_DIR="$(mig ok "$M0" "$M1" '0002_x.sql:ALTER TABLE t DROP COLUMN c;')" bash "$DEPLOY_SH" 2>&1)"; RC=$?
expect "with ALLOW_DESTRUCTIVE_MIGRATION=1 it proceeds: exit 0 (got $RC)" eq "$RC" 0

echo "== 19. retention with KEEP_RELEASES=2 keeps current and the previous OK release"
reset_world
for _ in 1 2 3 4; do KEEP_RELEASES=2 run_deploy ok; done
expect "2 releases kept (got $(nreleases))" eq "$(nreleases)" 2
out="$(bash "$DEPLOY_SH" rollback 2>&1)"; rc=$?
expect "rollback still possible (exit $rc)" eq "$rc" 0

echo
if [ "$FAILS" -ne 0 ]; then echo "deploy scenarios: $FAILS FAILED"; exit 1; fi
echo "deploy scenarios: all passed"
