#!/usr/bin/env bash
# shellcheck disable=SC2016,SC2015  # the single-quoted bash -c snippets are intentional
# Verifies deploy/nginx/* with the official nginx Docker image (nothing is installed on the host).
#   deploy/tests/nginx-test.sh syntax     -> `nginx -t` only
#   deploy/tests/nginx-test.sh behavior   -> `nginx -t`, then starts nginx with a fake upstream on
#                                            127.0.0.1:3000 and asserts headers, limits, redirects, uploads...
#   deploy/tests/nginx-test.sh            -> both
# Self-signed certificate, uploads dir and ACME webroot are created INSIDE the throwaway container.
# Env: NGINX_IMAGE (default nginx:stable), KEEP=1 keeps the container for debugging.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../nginx" && pwd)"
# Git Bash on Windows needs "D:/..." style paths for docker -v and no automatic path rewriting.
if command -v cygpath >/dev/null 2>&1; then
  ROOT="$(cygpath -m "$ROOT")"
  HERE="$(cygpath -m "$HERE")"
fi
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'

IMAGE="${NGINX_IMAGE:-nginx:stable}"
NAME="bh-nginx-test-$$"
MODE="${1:-all}"

MOUNTS=(
  -v "$ROOT/conf.d:/etc/nginx/conf.d:ro"
  -v "$ROOT/snippets:/etc/nginx/snippets:ro"
  -v "$ROOT/burgerhause.conf:/etc/nginx/sites-enabled/burgerhause.conf:ro"
  -v "$HERE/nginx/nginx.test.conf:/etc/nginx/nginx.conf:ro"
  -v "$HERE/nginx/stub-upstream.conf:/etc/nginx/stub/stub.conf:ro"
)

# Runs inside the container before nginx: fake certificate (same paths certbot would create), uploads, ACME webroot.
SETUP='set -e
d=/etc/letsencrypt/live/burgerhause.example.com
mkdir -p "$d" /var/lib/burgerhause/uploads /var/www/certbot/.well-known/acme-challenge /var/log/nginx
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=burgerhause.example.com \
  -keyout "$d/privkey.pem" -out "$d/fullchain.pem" >/dev/null 2>&1
printf RIFFfakewebp > /var/lib/burgerhause/uploads/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp
printf token > /var/www/certbot/.well-known/acme-challenge/probe
'

cleanup() {
  if [ "${KEEP:-0}" != "1" ]; then docker rm -f "$NAME" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

FAILS=0
ok()   { printf '  ok   %s\n' "$1"; }
bad()  { printf '  FAIL %s\n' "$1"; FAILS=$((FAILS + 1)); }
check() { # check <description> <command...>   (command runs on the host, must succeed)
  local d="$1"; shift
  if "$@"; then ok "$d"; else bad "$d"; fi
}

run_syntax() {
  echo "== nginx -t (image $IMAGE) =="
  docker run --rm --entrypoint sh "${MOUNTS[@]}" "$IMAGE" -c "$SETUP nginx -t" 2>&1 | grep -v '^$'
}

if [ "$MODE" = "syntax" ] || [ "$MODE" = "all" ]; then
  out="$(run_syntax)" || { echo "$out"; echo "nginx -t FAILED"; exit 1; }
  echo "$out"
  grep -q "syntax is ok" <<<"$out" && grep -q "test is successful" <<<"$out" || { echo "unexpected nginx -t output"; exit 1; }
fi
[ "$MODE" = "syntax" ] && exit 0

echo "== behavior tests =="
docker run -d --name "$NAME" --entrypoint sh "${MOUNTS[@]}" "$IMAGE" -c "$SETUP exec nginx -g 'daemon off;'" >/dev/null
for _ in $(seq 1 50); do
  if docker exec "$NAME" curl -ks -o /dev/null https://127.0.0.1/ -H 'Host: burgerhause.example.com'; then break; fi
  sleep 0.2
done

H='Host: burgerhause.example.com'
# curl inside the container against https (self-signed -> -k). Prints headers+body.
cx() { docker exec "$NAME" curl -ksS -H "$H" "$@"; }
code() { docker exec "$NAME" curl -ksS -o /dev/null -w '%{http_code}' -H "$H" "$@"; }
has() { grep -qiE "$1" <<<"$2"; }

# -- proxy headers ---------------------------------------------------------------------------------
body="$(cx -H 'X-Forwarded-For: 6.6.6.6, 7.7.7.7' -H 'Forwarded: for=6.6.6.6' -H 'X-Real-IP: 8.8.8.8' https://127.0.0.1/some/page)"
check "X-Forwarded-For is OVERWRITTEN with the TCP peer (spoofed hops dropped)" \
  bash -c '[[ "$1" == *"xff=127.0.0.1|"* && "$1" != *6.6.6.6* && "$1" != *7.7.7.7* ]]' _ "$body"
check "Host / X-Forwarded-Host / X-Forwarded-Proto passed" \
  bash -c '[[ "$1" == *"host=burgerhause.example.com|xfh=burgerhause.example.com|xfp=https|"* ]]' _ "$body"
check "Connection header cleared (upstream keepalive)" bash -c '[[ "$1" == *"conn=|"* ]]' _ "$body"
check "client-supplied X-Real-IP / Forwarded do not reach the app" \
  bash -c '[[ "$1" == *"realip=127.0.0.1|fwd=|"* ]]' _ "$body"

# -- TLS side: redirect, headers ---------------------------------------------------------------------
hdr="$(docker exec "$NAME" curl -sI -H "$H" 'http://127.0.0.1/pedido/abc?x=1')"
check "HTTP -> HTTPS 301 keeps host and URI" bash -c '[[ "$1" == *"301"* && "$1" == *"Location: https://burgerhause.example.com/pedido/abc?x=1"* ]]' _ "$hdr"
check "unknown Host on :80 gets the connection closed (444)" \
  bash -c '! docker exec "$1" curl -s -o /dev/null -H "Host: evil.test" http://127.0.0.1/' _ "$NAME"
check "ACME challenge is served over HTTP from the webroot" \
  bash -c '[[ "$(docker exec "$1" curl -s -H "Host: burgerhause.example.com" http://127.0.0.1/.well-known/acme-challenge/probe)" == "token" ]]' _ "$NAME"

hdr="$(cx -sI https://127.0.0.1/some/page)"
check "HSTS max-age=31536000 without preload" bash -c '[[ "$1" == *"max-age=31536000"* && "$1" != *preload* ]]' _ "$hdr"
check "X-Content-Type-Options nosniff" has 'x-content-type-options: nosniff' "$hdr"
check "X-Frame-Options DENY" has 'x-frame-options: deny' "$hdr"
check "default Referrer-Policy strict-origin-when-cross-origin" has 'referrer-policy: strict-origin-when-cross-origin' "$hdr"
check "server_tokens off (no version in Server header)" bash -c '! grep -qiE "^server: nginx/" <<<"$1"' _ "$hdr"
hdr="$(cx -sI https://127.0.0.1/pedido/abc)"
check "/pedido keeps the app's own Referrer-Policy: no-referrer (exactly one header)" \
  bash -c '[[ "$(grep -ci "^referrer-policy:" <<<"$1")" == 1 && "$1" == *"no-referrer"* ]]' _ "$hdr"

hdr="$(cx -sI https://127.0.0.1/hardened)"
check "headers the app also sets (X-Frame-Options, nosniff) appear exactly once, X-Powered-By is dropped"   bash -c '[[ "$(grep -ci "^x-frame-options:" <<<"$1")" == 1 && "$(grep -ci "^x-content-type-options:" <<<"$1")" == 1 && "$1" != *[Pp]owered-[Bb]y* ]]' _ "$hdr"

# -- dotfiles / source maps ----------------------------------------------------------------------------
check "/.env -> 404" bash -c '[[ "$(docker exec "$1" curl -ks -o /dev/null -w "%{http_code}" -H "Host: burgerhause.example.com" https://127.0.0.1/.env)" == 404 ]]' _ "$NAME"
check "/.git/config -> 404" bash -c '[[ "$(docker exec "$1" curl -ks -o /dev/null -w "%{http_code}" -H "Host: burgerhause.example.com" https://127.0.0.1/.git/config)" == 404 ]]' _ "$NAME"
check "*.map -> 404" bash -c '[[ "$(docker exec "$1" curl -ks -o /dev/null -w "%{http_code}" -H "Host: burgerhause.example.com" https://127.0.0.1/_next/static/a.js.map)" == 404 ]]' _ "$NAME"

# -- uploads served directly --------------------------------------------------------------------------
U=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp
hdr="$(cx -sI "https://127.0.0.1/uploads/$U")"
check "/uploads/<file> served by nginx (200)" has 'HTTP/[0-9.]+ 200' "$hdr"
check "uploads: immutable + 1y cache" bash -c '[[ "$1" == *"immutable"* && "$1" == *"max-age=31536000"* ]]' _ "$hdr"
check "uploads: nosniff + HSTS repeated inside the location" bash -c 'grep -qi nosniff <<<"$1" && grep -qi strict-transport-security <<<"$1"' _ "$hdr"
check "uploads: missing file -> 404" bash -c '[[ "$(docker exec "$1" curl -ks -o /dev/null -w "%{http_code}" -H "Host: burgerhause.example.com" https://127.0.0.1/uploads/nope.webp)" == 404 ]]' _ "$NAME"
c="$(code https://127.0.0.1/uploads/)"
check "uploads: no directory listing (got $c)" bash -c '[[ "$1" != 200 ]]' _ "$c"
b="$(cx --path-as-is 'https://127.0.0.1/uploads/../../../etc/passwd')"
check "uploads: path traversal does not expose files" bash -c '[[ "$1" != *root:* ]]' _ "$b"
b="$(cx 'https://127.0.0.1/uploads/%2e%2e/%2e%2e/etc/passwd')"
check "uploads: encoded traversal does not expose files" bash -c '[[ "$1" != *root:* ]]' _ "$b"
b="$(cx 'https://127.0.0.1/uploads/..%2f..%2fetc/passwd')"
check "uploads: encoded-slash traversal does not expose files" bash -c '[[ "$1" != *root:* ]]' _ "$b"

# -- body size limits -----------------------------------------------------------------------------------
post() { # post <MB> <path>  -> status code
  docker exec "$NAME" sh -c "head -c $(( $1 * 1024 * 1024 )) /dev/zero | curl -ks -o /dev/null -w '%{http_code}' -H '$H' -X POST --data-binary @- https://127.0.0.1$2"
}
c="$(post 5 /api/uploads)"; check "POST 5 MB to /api/uploads passes (got $c)" bash -c '[[ "$1" == 200 ]]' _ "$c"
c="$(post 7 /api/uploads)"; check "POST 7 MB to /api/uploads -> 413 (got $c)" bash -c '[[ "$1" == 413 ]]' _ "$c"
c="$(post 2 /api/pedido/x)"; check "POST 2 MB elsewhere -> 413 (small default, got $c)" bash -c '[[ "$1" == 413 ]]' _ "$c"

# -- SSE locations (config inspection: buffering cannot be observed from a stub) ----------------------------
conf="$(docker exec "$NAME" nginx -T 2>/dev/null)"
for loc in '= /api/events' '= /api/agent/stream'; do
  blk="$(awk -v L="location $loc {" 'index($0, L) {f=1} f {print} f && /^    }/ {exit}' <<<"$conf")"
  check "SSE location '$loc': buffering off, cache off, read timeout 1h, gzip off, HTTP/1.1, Connection cleared" \
    bash -c '[[ "$1" == *"proxy_buffering off"* && "$1" == *"proxy_cache off"* && "$1" == *"proxy_read_timeout 1h"* && "$1" == *"gzip off"* && "$1" == *"limit_conn bh_sse"* && "$1" == *"burgerhause-proxy.conf"* ]]' _ "$blk"
done
check "proxy snippet: HTTP/1.1 + empty Connection + XFF \$remote_addr (never \$proxy_add_x_forwarded_for)" \
  bash -c '[[ "$1" == *"proxy_http_version 1.1"* && "$1" == *"proxy_set_header Connection \"\""* && "$1" == *"X-Forwarded-For \$remote_addr"* && "$1" != *"\$proxy_add_x_forwarded_for;"* ]]' _ "$conf"
check "SSE passes through the proxy unmodified" \
  bash -c '[[ "$1" == *"event: hello"* ]]' _ "$(cx -N --max-time 5 https://127.0.0.1/api/events)"

# -- gzip ---------------------------------------------------------------------------------------------------
hdr="$(docker exec "$NAME" curl -ks -D - -o /dev/null -H "$H" -H 'Accept-Encoding: gzip' https://127.0.0.1/big.txt)"
check "gzip on text assets" has 'content-encoding: gzip' "$hdr"
hdr="$(docker exec "$NAME" curl -ks -D - -o /dev/null --max-time 5 -N -H "$H" -H 'Accept-Encoding: gzip' https://127.0.0.1/api/events)"
check "no gzip on the event stream" bash -c '! grep -qi "content-encoding: gzip" <<<"$1"' _ "$hdr"

# -- rate limits (all from one source IP, like the venue) -----------------------------------------------------
burst() { # burst <path> <n> -> "200xN 429xM"
  local urls=() i
  for ((i = 0; i < $2; i++)); do urls+=(-o /dev/null "https://127.0.0.1$1"); done
  docker exec "$NAME" curl -ks -w '%{http_code}\n' -H "$H" "${urls[@]}" | sort | uniq -c | tr '\n' ' '
}
r="$(burst /login 20)"
check "/login: 20 quick requests from ONE IP (9 PCs + GET/POST each) all pass ($r)" bash -c '[[ "$1" == *"20 200"* && "$1" != *429* ]]' _ "$r"
r="$(burst /login 80)"
check "/login: 80 quick requests trip the volume cap (429) ($r)" bash -c '[[ "$1" == *429* && "$1" == *200* ]]' _ "$r"
r="$(burst /api/agent/heartbeat 60)"
check "/api/agent/: 9 PCs on one IP are not throttled by 60 rapid requests ($r)" bash -c '[[ "$1" == *"60 200"* && "$1" != *429* ]]' _ "$r"
r="$(burst /api/pedido/abc 80)"
check "/api/pedido/: 10 r/s burst 20 throttles a flood ($r)" bash -c '[[ "$1" == *429* && "$1" == *200* ]]' _ "$r"
r="$(burst /api/uploads 20)"
check "/api/uploads: 2 r/s burst 10 throttles a flood ($r)" bash -c '[[ "$1" == *429* && "$1" == *200* ]]' _ "$r"
check "limit_conn for SSE is >= 40 (60)" bash -c '[[ "$1" == *"limit_conn bh_sse 60"* ]]' _ "$conf"

r="$(burst /some/page 160)"
check "general volume cap: 160 rapid page requests from one IP trip 30 r/s + burst 100 ($r)" bash -c '[[ "$1" == *429* && "$1" == *200* ]]' _ "$r"
r="$(burst /_next/static/chunks/a.js 160)"
check "/_next/static/ is exempt from the volume cap ($r)" bash -c '[[ "$1" == *"160 200"* && "$1" != *429* ]]' _ "$r"

# -- hardening round: TLS catch-all, x-middleware-subrequest, /pedido without trailing slash ---------------------
set +e
docker exec "$NAME" curl -ks -o /dev/null --resolve evil.test:443:127.0.0.1 https://evil.test/ ; ec=$?
set -e
check "unknown Host over TLS: connection dropped (curl exit $ec, expected 52, 56 or 92 = dropped)" bash -c '[[ "$1" == 52 || "$1" == 56 || "$1" == 92 ]]' _ "$ec"
check "real Host over TLS still proxies" bash -c '[[ "$1" == *"host=burgerhause.example.com"* ]]' _ "$(cx https://127.0.0.1/ok)"
b="$(cx -H 'x-middleware-subrequest: middleware' https://127.0.0.1/x)"
check "x-middleware-subrequest from the client is blanked" bash -c '[[ "$1" == *"mw=|"* ]]' _ "$b"
r="$(burst /pedido 80)"
check "/pedido WITHOUT trailing slash is rate limited too ($r)" bash -c '[[ "$1" == *429* ]] && grep -qE "[0-9] (200|301)" <<<"$1"' _ "$r"

echo
if [ "$FAILS" -ne 0 ]; then echo "nginx behavior tests: $FAILS FAILED"; exit 1; fi
echo "nginx behavior tests: all passed"
