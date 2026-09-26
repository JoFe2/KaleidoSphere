#!/usr/bin/env python3
"""KS254 (JoFe2/KaleidoSphere#254) -- staged, receipt-bound install surface of the owned
Superset runtime.

`services/superset/runtime/init.sh` used to run, directly against the LIVE metadata path:

    superset db upgrade
    superset init
    python bootstrap.py

Every one of those commands mutates `/var/lib/chimpmaera-bi/metadata/superset.db` in place.
A process killed between (or during) them therefore left the ONLY copy of the container's
install state partially migrated, with no staging area, no receipt and no pointer -- there was
nothing to roll back to and nothing that could tell an operator whether the metadata database
was complete. That is the KS254 defect class on the native Superset install surface.

This driver stages the derived install state as ONE generation through the crash-safe
generation store (`generation_store.py`, the python counterpart of the RELEASED node store at
`services/bi-control/src/generation-store.mjs`):

  1. the candidate metadata database is seeded from the CURRENT live database (or empty on a
     first install) INSIDE an owned staging directory; the live path is never touched;
  2. the real pinned commands (`superset db upgrade`, `superset init`, `bootstrap.py`) run
     against the CANDIDATE through `CHIMPMAERA_BI_METADATA_DB_URI`, so the pinned runtime
     dependency set is what provisions it;
  3. the candidate is verified structurally (integrity check, required tables, alembic
     revision, users, managed database row) and a receipt recording the exact commands, exits,
     digests and the consumed projection dependency is written beside it;
  4. both files are RE-VERIFIED by the store, published as an immutable content-addressed
     generation directory, and committed by ONE atomic pointer replacement;
  5. only then is the live path refreshed (atomic rename of a complete copy), so at every
     supported interruption point the live path holds either the complete old install state or
     the complete new one.

Supported interruption points (`KS254_INTERRUPT_AT`): `metadata:before-staging`,
`metadata:during-build` (the parent dies while the pinned `superset db upgrade` child runs),
`metadata:during-staging`, `metadata:after-staging`, `metadata:after-generation-publish`,
`metadata:after-activation`, `metadata:after-mirror`.

Modes: install (default), recover, cleanup, verify, inspect.

Boundaries / non-claims:
  * The live metadata database is a WORKING COPY: the owned Superset runtime mutates it after
    activation. The generation directory stays immutable and is the verified rollback point.
    The live path is therefore never overwritten by recovery/install when it is itself a
    structurally complete database (it may hold runtime state).
  * Process death (SIGKILL) only. No storage power-loss / fsync durability claim, no
    distributed transaction claim.
  * The secret mount is read-only input. Paths default to the container's production layout;
    `CHIMPMAERA_BI_ROOT` and `CHIMPMAERA_BI_SECRET_ROOT` relocate it for isolated
    qualification only.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from generation_store import (  # noqa: E402  (sibling module of the Superset runtime image)
    ACTIVE_POINTER_NAME,
    GENERATION_STORE_CONTRACT,
    OWNED_STAGING_DIRECTORY,
    OWNED_STORE_DIRECTORY,
    GenerationError,
    activate_generation,
    cleanup_generation_store,
    cleanup_pointer_debris,
    generation_store_layout,
    inspect_generation_store,
    initialize_generation_store,
    interruption_point,
    read_active_generation,
    recover_generation_store,
    sha256_bytes,
    sha256_file,
    stage_generation,
    verify_generation_manifest,
)

INSTALL_CONTRACT = "chimpmaera.bi/superset-install-receipt/v1"
METADATA_DATABASE_FILE = "superset.db"
INSTALL_RECEIPT_FILE = "install.receipt.json"
TARGET = "metadata"
DEFAULT_ROOT = "/var/lib/chimpmaera-bi"
DEFAULT_SECRET_ROOT = "/run/secrets"
PROJECTION_RELATIVE = "projection/analytics.db"
# The tables the owned runtime cannot start without: flask-appbuilder security + Superset
# metadata + the alembic revision that says which migration head the database is at.
REQUIRED_TABLES = ("alembic_version", "ab_user", "ab_role", "ab_permission", "dashboards",
                   "slices", "dbs", "tables", "key_value")
MANAGED_DATABASE_NAME = "ChimpMaera BI managed projection"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class InstallLayout:
    def __init__(self, root: str | os.PathLike | None = None):
        self.root = Path(root or os.environ.get("CHIMPMAERA_BI_ROOT") or DEFAULT_ROOT).resolve()
        self.metadata_dir = self.root / "metadata"
        self.projection_dir = self.root / "projection"
        self.live_database = self.metadata_dir / METADATA_DATABASE_FILE
        self.projection_database = self.root / PROJECTION_RELATIVE
        self.store = generation_store_layout(self.metadata_dir)
        self.secret_root = Path(os.environ.get("CHIMPMAERA_BI_SECRET_ROOT")
                                or DEFAULT_SECRET_ROOT).resolve()

    def owned_paths(self) -> list[str]:
        return [str(self.store.store_root), str(self.store.staging_root)]


def verify_metadata_database(path: str | os.PathLike) -> dict:
    """Structural completeness of a metadata database (used for the candidate AND the live
    working copy, which legitimately drifts after activation)."""
    path = Path(path)
    if not path.is_file():
        return {"ok": False, "code": "METADATA_DATABASE_MISSING", "path": str(path)}
    digest = sha256_file(path)
    try:
        connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    except sqlite3.Error as error:
        return {"ok": False, "code": "METADATA_DATABASE_UNREADABLE", "path": str(path),
                "detail": str(error)}
    try:
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            return {"ok": False, "code": "METADATA_INTEGRITY_FAILED", "path": str(path),
                    "detail": str(integrity), "sha256": digest}
        tables = {row[0] for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
        missing = sorted(table for table in REQUIRED_TABLES if table not in tables)
        if missing:
            return {"ok": False, "code": "METADATA_SCHEMA_INCOMPLETE", "path": str(path),
                    "missingTables": missing, "sha256": digest}
        revision_row = connection.execute("SELECT version_num FROM alembic_version").fetchone()
        if not revision_row:
            return {"ok": False, "code": "METADATA_ALEMBIC_REVISION_MISSING",
                    "path": str(path), "sha256": digest}
        version = connection.execute("SELECT MAX(version_num) FROM alembic_version").fetchone()[0]
        counters = {
            "users": connection.execute("SELECT COUNT(*) FROM ab_user").fetchone()[0],
            "roles": connection.execute("SELECT COUNT(*) FROM ab_role").fetchone()[0],
            "tables": len(tables),
            "managedDatabases": connection.execute(
                "SELECT COUNT(*) FROM dbs WHERE database_name = ?",
                (MANAGED_DATABASE_NAME,)).fetchone()[0],
        }
    except sqlite3.Error as error:
        return {"ok": False, "code": "METADATA_SCHEMA_UNREADABLE", "path": str(path),
                "detail": str(error), "sha256": digest}
    finally:
        connection.close()
    return {"ok": True, "code": "OK", "path": str(path), "sha256": digest,
            "bytes": path.stat().st_size, "revision": version, "counters": counters}


def projection_dependency_readback(layout: InstallLayout) -> dict:
    """The consumed dependency of the Superset runtime: the managed read-only projection
    produced by bi-control on the shared projection volume. Read-only observation."""
    path = layout.projection_database
    readback = {"component": "managed-projection", "path": str(path), "readOnly": True}
    if not path.is_file():
        readback.update({"state": "ABSENT", "code": "PROJECTION_DEPENDENCY_ABSENT", "sha256": None})
        return readback
    readback.update({"state": "PRESENT", "code": "OK", "sha256": sha256_file(path),
                     "bytes": path.stat().st_size})
    return readback


def _atomic_write(target: Path, source: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{target.name}.", dir=str(target.parent))
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(source.read_bytes())
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, target)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise


def mirror_status(layout: InstallLayout, active: dict) -> dict:
    """Read-only status of the live working copy against the active generation. The live
    database legitimately drifts once the owned runtime starts writing to it, so a divergence
    is REPORTED (the released projection surface's IN_SYNC / STALE_GENERATION vocabulary)
    rather than treated as corruption."""
    declared = (sha256_file(Path(active["generationPath"]) / METADATA_DATABASE_FILE)
                if active.get("ok") else None)
    current = verify_metadata_database(layout.live_database)
    if not current["ok"]:
        state = ("ABSENT" if current["code"] == "METADATA_DATABASE_MISSING"
                 else "REFRESHABLE")
    elif current["sha256"] == declared:
        state = "IN_SYNC"
    else:
        state = "STALE_GENERATION"
    return {"state": state, "inSync": bool(current["ok"] and current["sha256"] == declared),
            "liveSha256": current.get("sha256"), "declaredSha256": declared,
            "generationId": active.get("generationId"), "live": current["code"]}


def refresh_live_mirror(layout: InstallLayout, active: dict, seeded_sha256: str | None = None) -> dict:
    """Bring the live working copy to the active generation's bytes through an atomic rename.

    Safety rule: a live database that is structurally complete is only replaced when this run
    KNOWS it is still the exact copy it seeded its candidate from (`seeded_sha256`, an
    install-mode fact recorded in the generation receipt). Anything else -- a concurrent
    writer during an install, or a recovery run over a database the runtime may already have
    mutated -- is left untouched and reported, never silently clobbered.
    """
    source = Path(active["generationPath"]) / METADATA_DATABASE_FILE
    declared = sha256_file(source)
    current = verify_metadata_database(layout.live_database)
    if not current["ok"] or current["sha256"] == declared:
        if not current["ok"]:
            _atomic_write(layout.live_database, source)
            state, reason = "REFRESHED", "LIVE_NOT_COMPLETE"
        else:
            state, reason = "IN_SYNC", "ALREADY_ACTIVE_BYTES"
        return {"state": state, "reason": reason, "sha256": declared, "declaredSha256": declared,
                "generationId": active["generationId"], "inSync": True}
    if seeded_sha256 is not None and current["sha256"] == seeded_sha256:
        _atomic_write(layout.live_database, source)
        return {"state": "REFRESHED", "reason": "UNCHANGED_SINCE_SEED", "sha256": declared,
                "declaredSha256": declared, "generationId": active["generationId"],
                "inSync": True, "replaced": current["sha256"]}
    return {"state": ("PRESERVED_CONCURRENT_WRITES" if seeded_sha256 is not None
                      else "PRESERVED_COMPLETE_LIVE"),
            "reason": ("LIVE_CHANGED_SINCE_SEED" if seeded_sha256 is not None
                       else "LIVE_MAY_HOLD_RUNTIME_STATE"),
            "sha256": current["sha256"], "declaredSha256": declared,
            "generationId": active["generationId"], "inSync": False}


def _version_of(superset_bin: str) -> str | None:
    try:
        result = subprocess.run([superset_bin, "version"], capture_output=True, text=True,
                                timeout=120, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    text = (result.stdout or result.stderr or "").strip().splitlines()
    return text[-1].strip() if text else None


def _run_step(command: list[str], *, env: dict, record: list[dict], interruption: str | None,
              staging: Path) -> str:
    """Run one REAL provisioning step. A named interruption point kills THIS process while the
    child runs, so a probe observes the genuine on-disk state (and may clean up the orphan)."""
    started = _now()
    try:
        child = subprocess.Popen(command, env=env, stdout=subprocess.PIPE,
                                 stderr=subprocess.STDOUT, text=True, start_new_session=True)
    except OSError as error:
        record.append({"command": command, "startedAt": started, "exitStatus": None,
                       "signal": None, "code": "STEP_UNAVAILABLE", "detail": str(error)})
        raise GenerationError("METADATA_STEP_UNAVAILABLE", f"{command[0]}: {error}")
    pid_marker = staging / ".ks254-build-child.pid"
    if interruption is not None:
        # Owned build debris, written ONLY when the interruption hook names this point, so a
        # probe that observes the orphaned child can clean it up. It never survives a step.
        pid_marker.write_text(str(child.pid), encoding="utf-8")
        interruption_point(interruption)
    try:
        output, _ = child.communicate()
    finally:
        pid_marker.unlink(missing_ok=True)
    tail = [line for line in (output or "").splitlines() if line.strip()]
    record.append({"command": command, "startedAt": started, "exitStatus": child.returncode,
                   "signal": -child.returncode if child.returncode is not None and child.returncode < 0 else None,
                   "outputTail": tail[-1][:200] if tail else ""})
    if child.returncode != 0:
        raise GenerationError("METADATA_STEP_FAILED",
                              f"{command[0]}: exit {child.returncode}")
    return tail[-1] if tail else ""


def _build_generation(layout: InstallLayout, staging: Path) -> dict:
    superset_bin = os.environ.get("SUPERSET_BIN") or "superset"
    python_bin = os.environ.get("PYTHON_BIN") or sys.executable
    bootstrap = Path(__file__).resolve().with_name("bootstrap.py")
    candidate = staging / METADATA_DATABASE_FILE
    steps: list[dict] = []

    # 1. Seed the candidate from the current LIVE working copy (preserving runtime state such
    #    as dashboards and users across an install) without touching that live copy.
    live = verify_metadata_database(layout.live_database)
    if live["ok"]:
        shutil.copyfile(layout.live_database, candidate)
        base = {"source": "LIVE_PATH", "sha256": live["sha256"], "revision": live["revision"]}
    else:
        base = {"source": "EMPTY", "sha256": None, "code": live["code"]}

    env = dict(os.environ)
    env["CHIMPMAERA_BI_ROOT"] = str(layout.root)
    env["CHIMPMAERA_BI_METADATA_DB_URI"] = f"sqlite:///{candidate}"
    env.setdefault("SUPERSET_CONFIG_PATH", str(Path(__file__).resolve().with_name("superset_config.py")))

    # 2. The pinned runtime provisions the candidate. `metadata:during-build` kills this
    #    process while the migration child runs -- the original failure boundary.
    _run_step([superset_bin, "db", "upgrade"], env=env, record=steps,
              interruption=f"{TARGET}:during-build", staging=staging)
    _run_step([superset_bin, "init"], env=env, record=steps, interruption=None, staging=staging)
    _run_step([python_bin, str(bootstrap)], env=env, record=steps, interruption=None,
              staging=staging)

    # 3. The candidate must be structurally complete before it is allowed to become a
    #    generation; anything else fails closed and the staging is discarded.
    verified = verify_metadata_database(candidate)
    if not verified["ok"]:
        raise GenerationError(verified["code"], verified.get("detail") or verified.get("path"))
    receipt = {
        "schemaVersion": INSTALL_CONTRACT,
        "contract": GENERATION_STORE_CONTRACT,
        "issue": "JoFe2/KaleidoSphere#254",
        "installedAt": _now(),
        "metadata": {"file": METADATA_DATABASE_FILE, "sha256": verified["sha256"],
                     "bytes": verified["bytes"], "revision": verified["revision"],
                     "counters": verified["counters"]},
        "base": base,
        "steps": steps,
        "dependency": projection_dependency_readback(layout),
        "environment": {"supersetCommand": superset_bin, "pythonCommand": python_bin,
                        "supersetVersion": _version_of(superset_bin),
                        "root": str(layout.root)},
        "nonClaims": [
            "Process death (SIGKILL) interruption only; no storage power loss or fsync claim.",
            "No distributed transaction guarantee.",
            "The live metadata database is a working copy that the runtime may mutate after "
            "activation; the generation directory is the immutable verified rollback point.",
        ],
    }
    receipt_bytes = json.dumps(receipt, indent=2).encode("utf-8") + b"\n"
    (staging / INSTALL_RECEIPT_FILE).write_bytes(receipt_bytes)
    return {
        "label": f"superset-metadata:{verified['revision']}",
        "files": [
            {"path": METADATA_DATABASE_FILE, "sha256": verified["sha256"]},
            {"path": INSTALL_RECEIPT_FILE, "sha256": sha256_bytes(receipt_bytes)},
        ],
        "extra": {"receipt": receipt},
    }


def install(layout: InstallLayout) -> dict:
    initialize_generation_store(layout.metadata_dir)
    staged = stage_generation(layout.metadata_dir, TARGET,
                             lambda staging: _build_generation(layout, staging))
    activated = activate_generation(layout.metadata_dir, staged, TARGET)
    # The candidate was seeded from the live database at the start of THIS run; only bytes
    # that are still that exact copy may be replaced by the committed generation.
    mirror = refresh_live_mirror(layout, activated,
                                seeded_sha256=(activated["extra"]["receipt"]
                                               .get("base", {}).get("sha256")))
    interruption_point(f"{TARGET}:after-mirror")
    return {"generationId": activated["generationId"], "published": activated["published"],
            "generationPath": activated["generationPath"], "mirror": mirror,
            "receipt": activated["extra"]["receipt"],
            "steps": activated["extra"]["receipt"]["steps"]}


def _seeded_sha256_of(active: dict) -> str | None:
    """The live bytes the active generation's candidate was seeded from, read back from that
    generation's own receipt. Recovery uses it to decide whether the live working copy may be
    replaced: only bytes that are still EXACTLY the seed contain no later writes."""
    if not active.get("ok"):
        return None
    receipt_file = Path(active["generationPath"]) / INSTALL_RECEIPT_FILE
    try:
        receipt = json.loads(receipt_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    base = receipt.get("base")
    return base.get("sha256") if isinstance(base, dict) else None


def recover(layout: InstallLayout) -> dict:
    recovered = recover_generation_store(layout.metadata_dir, TARGET)
    active = read_active_generation(layout.metadata_dir)
    mirror = (refresh_live_mirror(layout, active, seeded_sha256=_seeded_sha256_of(active))
              if active["ok"] else None)
    return {**recovered, "active": active, "mirror": mirror,
            "dependency": projection_dependency_readback(layout)}


def cleanup(layout: InstallLayout) -> dict:
    cleaned = cleanup_generation_store(layout.metadata_dir)
    cleaned["pointerDebris"] = cleanup_pointer_debris(layout.metadata_dir)
    return cleaned


def verify(layout: InstallLayout) -> dict:
    active = read_active_generation(layout.metadata_dir)
    live = verify_metadata_database(layout.live_database)
    return {
        "contract": INSTALL_CONTRACT,
        "active": {"ok": active["ok"], "state": active["state"], "code": active["code"],
                   "generationId": active.get("generationId"),
                   "filesVerified": active["ok"]},
        "live": live,
        "mirror": mirror_status(layout, active),
        "dependency": projection_dependency_readback(layout),
        "store": inspect_generation_store(layout.metadata_dir),
    }


def inspect(layout: InstallLayout) -> dict:
    return {
        "contract": INSTALL_CONTRACT,
        "storeContract": GENERATION_STORE_CONTRACT,
        "layout": {"root": str(layout.root), "metadataDir": str(layout.metadata_dir),
                   "liveDatabase": str(layout.live_database),
                   "projectionDatabase": str(layout.projection_database),
                   "storeRoot": str(layout.store.store_root),
                   "stagingRoot": str(layout.store.staging_root),
                   "pointer": str(layout.store.pointer),
                   "owned": layout.owned_paths()},
        "store": inspect_generation_store(layout.metadata_dir),
        "active": {key: value for key, value in read_active_generation(layout.metadata_dir).items()
                   if key != "layout"},
        "live": verify_metadata_database(layout.live_database),
        "dependency": projection_dependency_readback(layout),
    }


def _out(line: str) -> None:
    sys.stdout.write(f"{line}\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("mode", choices=["install", "recover", "cleanup", "verify", "inspect"])
    parser.add_argument("--root", default=None)
    args = parser.parse_args(argv)
    layout = InstallLayout(args.root)
    layout.metadata_dir.mkdir(parents=True, exist_ok=True)
    layout.projection_dir.mkdir(parents=True, exist_ok=True)
    try:
        if args.mode == "install":
            result = install(layout)
            _out(f"INSTALL-ACTIVATED generation={result['generationId'][:12]}"
                 f" label={result['receipt']['metadata']['revision']}"
                 f" published={result['published']} mirror={result['mirror']['state']}"
                 f" files=2 root={layout.root}")
        elif args.mode == "recover":
            result = recover(layout)
            _out(f"INSTALL-RECOVERED activated={len(result['activated'])}"
                 f" discarded={len(result['discarded'])} pointer={result['active']['state']}"
                 f" mirror={result['mirror']['state'] if result['mirror'] else 'UNRESOLVED'}")
        elif args.mode == "cleanup":
            result = cleanup(layout)
            _out(f"INSTALL-CLEANED generations={len(result['removedGenerations'])}"
                 f" staging={len(result['removedStaging'])}"
                 f" active={result['activeGenerationId'][:12]}"
                 f" pointerDebris={len(result['pointerDebris'])}")
        elif args.mode == "verify":
            result = verify(layout)
            if not result["active"]["ok"] or not result["live"]["ok"]:
                sys.stderr.write(
                    f"INSTALL-DENIED {result['active']['code'] if not result['active']['ok'] else result['live']['code']}\n")
                return 1
            _out(f"INSTALL-VERIFIED active={result['active']['generationId'][:12]}"
                 f" filesVerified={result['active']['filesVerified']}"
                 f" liveRevision={result['live']['revision']}"
                 f" mirror={result['mirror']['state']}"
                 f" dependency={result['dependency']['state']}")
        else:
            _out(json.dumps(inspect(layout), indent=2))
    except GenerationError as error:
        sys.stderr.write(f"INSTALL-DENIED {error.code}"
                         f"{f': {error.detail}' if error.detail else ''}\n")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
