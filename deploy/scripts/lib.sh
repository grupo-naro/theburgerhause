#!/usr/bin/env bash
# Shared helpers for deploy/scripts/*.sh (sourced, not executed). Works on Linux and Git Bash.
# shellcheck shell=bash

: "${SCRIPT_TAG:=burgerhause}"

# log <message...>: timestamped line on stdout (systemd captures it in journald for the timer/service).
log() {
  # A vanished terminal (ssh/pty gone: EIO) must not abort a script running under set -e.
  printf '%s [%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$SCRIPT_TAG" "$*" || true
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

# load_env_file <file>: export KEY=VALUE lines of a systemd-style env file WITHOUT sourcing it
# (values may contain & ? # $). Surrounding single/double quotes are stripped like systemd does.
load_env_file() {
  local file="$1" line key val sq="'"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in '' | '#'*) continue ;; esac
    key="${line%%=*}"
    val="${line#*=}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    case "$val" in
      \"*\") val="${val#\"}"; val="${val%\"}" ;;
      "$sq"*"$sq") val="${val#"$sq"}"; val="${val%"$sq"}" ;;
    esac
    export "$key=$val"
  done <"$file"
}

# urldecode <string>: percent-decode (for user/password parts of a postgres:// URL).
urldecode() {
  local s="$1" out="" hex
  while [ -n "$s" ]; do
    if [[ "$s" =~ ^%([0-9A-Fa-f]{2})(.*)$ ]]; then
      hex="${BASH_REMATCH[1]}"; s="${BASH_REMATCH[2]}"
      # shellcheck disable=SC2059
      out+="$(printf "\x$hex")"
    else
      out+="${s:0:1}"; s="${s:1}"
    fi
  done
  printf '%s' "$out"
}

# pg_resolve <postgres-url-or-bare-db-name>
# Works out HOW to connect WITHOUT ever putting a password (or the URL) in a command line:
#   PG_DBNAME   the bare database name (the only thing that goes in argv)
#   PG_ENV      array of KEY=VALUE to export in the CHILD process only (libpq reads them)
#   PG_MODE     "name" (bare name given: caller's own PG* env/socket applies) | "socket" (local URL and the
#               OS user equals the URL user: UNIX socket + peer auth, no password at all) | "env" (everything
#               else: PGHOST/PGPORT/PGUSER/PGPASSWORD in the environment)
# shellcheck disable=SC2034  # PG_MODE / PG_DBNAME / PG_ENV are read by the callers
pg_resolve() {
  local v="$1" rest userinfo hostport user="" pass="" host="" port=""
  PG_ENV=()
  case "$v" in
    *://*) ;;
    *)
      PG_DBNAME="$v"; PG_MODE="name"; return 0 ;;
  esac
  rest="${v#*://}"
  PG_DBNAME="${rest#*/}"; PG_DBNAME="${PG_DBNAME%%\?*}"
  hostport="${rest%%/*}"
  if [[ "$hostport" == *@* ]]; then
    userinfo="${hostport%@*}"; hostport="${hostport##*@}"
    user="${userinfo%%:*}"
    [[ "$userinfo" == *:* ]] && pass="${userinfo#*:}"
    user="$(urldecode "$user")"; pass="$(urldecode "$pass")"
  fi
  if [[ "$hostport" == \[*\]* ]]; then # [::1]:5432
    host="${hostport%%]*}"; host="${host#[}"
    [[ "$hostport" == *\]:* ]] && port="${hostport##*]:}"
  else
    host="${hostport%%:*}"
    [[ "$hostport" == *:* ]] && port="${hostport##*:}"
  fi
  local local_host=0
  case "$host" in "" | localhost | 127.0.0.1 | ::1) local_host=1 ;; esac
  if [ "$local_host" = 1 ] && { [ -z "$port" ] || [ "$port" = 5432 ]; } && [ -n "$user" ] && [ "$user" = "$(id -un 2>/dev/null || true)" ]; then
    PG_MODE="socket" # peer authentication over the UNIX socket: no password needed
    return 0
  fi
  PG_MODE="env"
  [ -n "$host" ] && PG_ENV+=("PGHOST=$host")
  [ -n "$port" ] && PG_ENV+=("PGPORT=$port")
  [ -n "$user" ] && PG_ENV+=("PGUSER=$user")
  [ -n "$pass" ] && PG_ENV+=("PGPASSWORD=$pass")
  return 0
}

# pg_exec <command...>: run the command with the PG_ENV variables exported ONLY for that child.
pg_exec() {
  (
    local kv
    # shellcheck disable=SC2163  # exports the KEY=VALUE pair held in kv
    for kv in "${PG_ENV[@]+"${PG_ENV[@]}"}"; do export "$kv"; done
    "$@"
  )
}
