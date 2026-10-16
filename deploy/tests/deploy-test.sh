#!/usr/bin/env bash
# Runs deploy/tests/deploy-scenarios.sh inside a throwaway Linux container (symlinks, GNU tools and an nginx
# acting as the fake service cannot be relied on in Git Bash / Windows). Needs Docker; no root on the host.
# Env: NGINX_IMAGE (default nginx:stable; any Debian-based image with bash, curl and nginx works)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "$HERE/.." && pwd)"
if command -v cygpath >/dev/null 2>&1; then DEPLOY_DIR="$(cygpath -m "$DEPLOY_DIR")"; fi
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'
command -v docker >/dev/null 2>&1 || { echo "docker is required for the deploy scenarios"; exit 1; }
docker run --rm --entrypoint bash -v "$DEPLOY_DIR:/deploy:ro" "${NGINX_IMAGE:-nginx:stable}" /deploy/tests/deploy-scenarios.sh
