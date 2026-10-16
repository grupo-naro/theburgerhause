#!/usr/bin/env bash
# Shared helpers for deploy/scripts/*.sh (sourced, not executed). Works on Linux and Git Bash.
# shellcheck shell=bash

: "${SCRIPT_TAG:=burgerhause}"

# log <message...>: timestamped line on stdout (systemd captures it in journald for the timer/service).
log() {
  printf '%s [%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$SCRIPT_TAG" "$*"
}

# journal <message...>: also write to the system journal when `logger` exists (skipped with NO_LOGGER=1).
journal() {
  if [ -z "${NO_LOGGER:-}" ] && command -v logger >/dev/null 2>&1; then
    logger -t "$SCRIPT_TAG" -- "$*" || true
  fi
}

# die <message> [exit-code]
die() {
  log "ERROR: $1"
  journal "ERROR: $1"
  exit "${2:-1}"
}

# split_cmd <varname> <string>: split a command string on whitespace into the array <varname>.
# (Used for *_CMD overrides such as PGDUMP_CMD="docker exec -i some-container pg_dump -U user".
#  No quoting inside the string: keep each word free of spaces.)
split_cmd() {
  local __name="$1" __str="$2"
  # shellcheck disable=SC2229
  read -r -a "$__name" <<<"$__str"
}

# env_file_value <file> <KEY>: print the value of KEY=value in a systemd-style env file (no sourcing:
# values may contain & ? # etc.). Prints nothing when the file or key is missing.
env_file_value() {
  local file="$1" key="$2"
  [ -r "$file" ] || return 0
  grep -E "^${key}=" "$file" | tail -n 1 | cut -d= -f2- || true
}

# db_name_of <url-or-name>: database name of a postgres:// URL, or the argument itself if it is a bare name.
db_name_of() {
  local v="$1"
  case "$v" in
    *://*)
      v="${v##*/}"
      printf '%s\n' "${v%%\?*}"
      ;;
    *) printf '%s\n' "$v" ;;
  esac
}

# redact <text>: hide the password of any postgres://user:pass@ URL in the text.
redact() {
  printf '%s' "$1" | sed -E 's#(postgres(ql)?://[^:/@]+):[^@]*@#\1:***@#g'
}
