#!/usr/bin/env bash
# Stand-in for `systemctl restart burgerhause` in deploy/tests/deploy-scenarios.sh.
# It runs a tiny nginx on 127.0.0.1:3999 whose /api/health answer depends on the file HEALTH_MODE of the
# CURRENT release (read through the `current` symlink at restart time):
#   ok            -> 200 {"status":"ok",...,"commit":<APP_COMMIT of RELEASE.env>}
#   bad           -> 503 forever
#   slow:<n>      -> 503 for n seconds, then 200   (service that takes a while to come up)
#   stale-commit  -> 200 but reports another commit (an OLD process still answering)
# Every restart appends "restart <release>" to $STUB_DIR/steps.log.
set -euo pipefail
: "${STUB_DIR:?}" "${APP_ROOT:?}"
mkdir -p "$STUB_DIR"
release="$(basename "$(readlink -f "$APP_ROOT/current")")"
mode="$(cat "$APP_ROOT/current/HEALTH_MODE" 2>/dev/null || echo ok)"
commit="$(grep '^APP_COMMIT=' "$APP_ROOT/current/RELEASE.env" 2>/dev/null | cut -d= -f2- || true)"
echo "restart $release" >>"$STUB_DIR/steps.log"

# stop a pending "become healthy" timer from a previous restart
if [ -f "$STUB_DIR/timer.pid" ]; then kill "$(cat "$STUB_DIR/timer.pid")" 2>/dev/null || true; rm -f "$STUB_DIR/timer.pid"; fi

ok_conf() { printf "return 200 '{\"status\":\"ok\",\"db\":\"ok\",\"commit\":\"%s\"}';\n" "$1" >"$STUB_DIR/mode.conf"; }
bad_conf() { printf "return 503 '{\"status\":\"degraded\",\"db\":\"down\"}';\n" >"$STUB_DIR/mode.conf"; }
reload() { nginx -c "$STUB_DIR/nginx.conf" -s reload 2>/dev/null; }

case "$mode" in
  ok) ok_conf "$commit" ;;
  bad) bad_conf ;;
  stale-commit) ok_conf "oldprocess" ;;
  slow:*)
    bad_conf
    secs="${mode#slow:}"
    ( sleep "$secs"; ok_conf "$commit"; reload ) >/dev/null 2>&1 &
    echo $! >"$STUB_DIR/timer.pid"
    ;;
  *) echo "unknown HEALTH_MODE $mode" >&2; exit 1 ;;
esac

if [ ! -f "$STUB_DIR/nginx.pid" ] || ! kill -0 "$(cat "$STUB_DIR/nginx.pid")" 2>/dev/null; then
  cat >"$STUB_DIR/nginx.conf" <<CONF
pid $STUB_DIR/nginx.pid;
error_log $STUB_DIR/error.log;
events {}
http {
  access_log off;
  server {
    listen 127.0.0.1:3999;
    default_type application/json;
    location = /api/health { include $STUB_DIR/mode.conf; }
  }
}
CONF
  nginx -c "$STUB_DIR/nginx.conf"
else
  reload
fi
