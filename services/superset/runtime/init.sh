#!/usr/bin/env bash
# KS254 (JoFe2/KaleidoSphere#254) — staged, receipt-bound install surface of the owned
# Superset runtime.
#
# This one-shot service (compose.yaml `superset-init`) previously ran `superset db upgrade`,
# `superset init` and `bootstrap.py` DIRECTLY against the live metadata database, so a process
# death between (or during) those steps left the only copy of the container's install state
# partially migrated, with no staging area, no receipt and no pointer to roll back to.
#
# It now stages the derived install state through the crash-safe generation store
# (services/superset/runtime/ks254_install.py + generation_store.py, the python counterpart of
# the released node store services/bi-control/src/generation-store.mjs):
#
#   install (default) stage the candidate metadata database in an OWNED staging directory,
#                     provision it with the pinned runtime commands, verify it, publish it as
#                     an immutable content-addressed generation, commit with ONE atomic
#                     pointer replacement, then refresh the live path atomically.
#   recover           complete a verified uncommitted staging, discard an incomplete one, and
#                     refresh the live path only when it is not itself complete.
#   cleanup           remove owned staging debris and non-active generations; never the active
#                     generation and never anything outside the two owned directories.
#   verify            fail-closed readback of the active generation, the live database and the
#                     consumed projection dependency.
#   inspect           machine-readable state of the same surfaces.
#
# `KS254_INTERRUPT_AT` names an explicit supported interruption point; the running process then
# really dies (SIGKILL), which is how the crash boundary is qualified.
#
# Manual installation semantics are preserved: this is still the single idempotent one-shot
# entry point, its default layout is unchanged (/var/lib/chimpmaera-bi), and the operator
# workflow (`./bin/bi up`, Compose, a metadata backup/restore unit under .runtime/metadata) is
# unchanged. `CHIMPMAERA_BI_ROOT` and `CHIMPMAERA_BI_SECRET_ROOT` relocate the owned root and
# the read-only secret root for isolated qualification only.
set -euo pipefail
umask 077

SHELL_ROOT="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"
RUNTIME_ROOT="${CHIMPMAERA_BI_ROOT:-/var/lib/chimpmaera-bi}"
MODE="${1:-install}"

case "$MODE" in
  install|recover|cleanup|verify|inspect) ;;
  *)
    printf >&2 'KaleidoSphere Superset install ERROR: usage: init.sh [install|recover|cleanup|verify|inspect]\n'
    exit 2
    ;;
esac

PYTHON_BIN="${PYTHON_BIN:-$(command -v python3 || command -v python || true)}"
if [ -z "$PYTHON_BIN" ]; then
  printf >&2 'KaleidoSphere Superset install ERROR: SUPERSET_INSTALL_PYTHON_MISSING\n'
  exit 1
fi

mkdir -p "$RUNTIME_ROOT/metadata" "$RUNTIME_ROOT/projection"

exec "$PYTHON_BIN" "$SHELL_ROOT/ks254_install.py" "$MODE" --root "$RUNTIME_ROOT"
