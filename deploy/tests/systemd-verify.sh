#!/usr/bin/env bash
# `systemd-analyze verify` of the unit files inside a throwaway Ubuntu container (installs systemd there,
# needs internet for apt; nothing is installed on the host). Not part of `pnpm test:deploy` (slow, network).
# Expected: only complaints about things that exist on the real server (node binary), nothing about syntax.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYSTEMD_DIR="$HERE/../systemd"
command -v cygpath >/dev/null 2>&1 && SYSTEMD_DIR="$(cygpath -m "$SYSTEMD_DIR")"
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'
docker run --rm -v "$SYSTEMD_DIR:/units:ro" "${UBUNTU_IMAGE:-ubuntu:24.04}" bash -c '
  set -e
  apt-get update -qq >/dev/null 2>&1; apt-get install -y -qq systemd >/dev/null 2>&1
  useradd -r burgerhause
  mkdir -p /opt/burgerhause/current/node_modules/next/dist/bin /opt/burgerhause/current/deploy/scripts /etc/burgerhause /var/lib/burgerhause /var/backups/burgerhause
  touch /etc/burgerhause/burgerhause.env /opt/burgerhause/current/node_modules/next/dist/bin/next
  printf "#!/bin/sh\n" > /usr/bin/node; chmod +x /usr/bin/node          # stand-in for the real node binary
  printf "#!/bin/sh\n" > /opt/burgerhause/current/deploy/scripts/backup.sh; chmod +x /opt/burgerhause/current/deploy/scripts/backup.sh
  cp /units/* /etc/systemd/system/; chmod 644 /etc/systemd/system/burgerhause*
  rc=0
  for u in burgerhause.service burgerhause-backup.service burgerhause-backup.timer; do
    echo "== systemd-analyze verify $u"; systemd-analyze verify "/etc/systemd/system/$u" 2>&1 || rc=1
  done
  [ "$rc" = 0 ] && echo "systemd units: verify OK" || { echo "systemd units: verify reported problems"; exit 1; }
'
