#!/usr/bin/env bash
set -euo pipefail
umask 077

# KS149 / PG-KS-02 — parent-executable PostgreSQL C1 live matrix wrapper.
#
# The parent live operator owns a running isolated PostgreSQL 16.x server bound
# to 127.0.0.1. This wrapper does NOT create, run, or destroy any Docker
# container, network, or volume: it drives scripts/run-postgresql-c1-live-matrix.mjs
# against the parent's instance, and the runner itself creates and destroys its
# disposable clean room (two databases, two least-privilege roles) on that
# server and verifies the teardown in-process.
#
# Required environment:
#   KS149_PG_HOST               exactly 127.0.0.1 (loopback-only)
#   KS149_PG_PORT               port of the running isolated PostgreSQL 16.x
#   KS149_PG_OWNER_PASSWORD_FILE  existing mode-0600 file containing exactly one
#                                 password (32-96 chars of [A-Za-z0-9_]); the file
#                                 is read once, never copied or disclosed
# Optional environment:
#   KS149_PG_OWNER_USER         provisioning role (default: postgres)
#   KS149_PG_ADMIN_DATABASE     database the owner role connects to (default: postgres)
#
# On success the runner writes verification/postgresql/postgresql-c1-live-matrix-v1.json
# and docs/evidence/postgresql-c1-live-matrix/README.md and prints a JSON summary.
# Any assertion failure tears the clean room down, writes no evidence, and exits
# non-zero. A missing live result remains an unresolved prerequisite and is never
# marked PASS.

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
fail() { printf 'KS149_ERROR: %s\n' "$*" >&2; exit 1; }

[[ "${KS149_PG_HOST:-}" == "127.0.0.1" ]] || fail 'KS149_PG_HOST must be exactly 127.0.0.1 (loopback-only)'
[[ -n "${KS149_PG_PORT:-}" && "${KS149_PG_PORT}" =~ ^[0-9]+$ ]] || fail 'KS149_PG_PORT must be an integer port'
port_num=$((10#${KS149_PG_PORT}))
(( port_num >= 1 && port_num <= 65535 )) || fail 'KS149_PG_PORT out of range'
case "$port_num" in
  18789|8000|8081|18790|18088|18089) fail 'KS149_PG_PORT is reserved by this product' ;;
esac
owner_password_file="${KS149_PG_OWNER_PASSWORD_FILE:-}"
[[ -n "$owner_password_file" ]] || fail 'KS149_PG_OWNER_PASSWORD_FILE is required'
[[ -f "$owner_password_file" ]] || fail 'KS149_PG_OWNER_PASSWORD_FILE must be an existing file'
[[ "$(stat -c '%a' "$owner_password_file")" == "600" ]] || fail 'KS149_PG_OWNER_PASSWORD_FILE must be mode 0600'
[[ -s "$owner_password_file" ]] || fail 'KS149_PG_OWNER_PASSWORD_FILE must be non-empty'

state_dir="$(mktemp -d "$repo_dir/.runtime/ks149-c1-live.XXXXXX")"
cleanup_done=0
cleanup() {
  local status=$?
  if [[ "$cleanup_done" -eq 0 ]]; then
    cleanup_done=1
    if [[ -d "$state_dir" && "$state_dir" == "$repo_dir"/.runtime/ks149-c1-live.* ]]; then
      rm -rf -- "$state_dir"
    fi
  fi
  return "$status"
}
trap cleanup EXIT INT TERM

npm --prefix "$repo_dir/services/bi-control" ci --ignore-scripts --no-audit --no-fund >/dev/null

set +e
node "$repo_dir/scripts/run-postgresql-c1-live-matrix.mjs" >"$state_dir/summary.log" 2>&1
status=$?
set -e
cat "$state_dir/summary.log" || true
cleanup
printf '%s\n' '{"runnerOwnedContainers":0,"runnerOwnedNetworks":0,"runnerOwnedVolumes":0,"runnerDockerInvocations":0,"cleanRoomDatabasesAndRoles":"created and dropped on the parent instance; absence verified by the runner"}'
exit "$status"