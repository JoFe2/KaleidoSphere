"""KS254 (JoFe2/KaleidoSphere#254) -- crash-safe generation store, Superset-runtime counterpart.

This module is the Python counterpart of the RELEASED node generation store
(`services/bi-control/src/generation-store.mjs`, delivered with source/tooling release
2026_09_26_v3) for the ONE runtime that cannot use it: the owned Apache Superset image is
`apache/superset:6.1.0`, whose published `lean` stage is a python:3.11-slim image with
Superset's pinned python dependency set and NO Node.js (Node exists upstream only in the
frontend build stage, which is not part of the released image; the repository Dockerfile does
not install one either). The install surface of `services/superset/runtime/init.sh` therefore
cannot import the node module -- but it must not invent a second mechanism either.

So this file is a faithful PORT of the released contract, not a new mechanism:

  * the same contract id            chimpmaera.bi/generation-store/v1
  * the same owned paths            <root>/.ks254-generations, <root>/.ks254-staging, `active`
  * the same manifest file name and the same generationId derivation
    (sha256 over the canonical JSON of {contract, label, files})
  * the same per-file sha256 verification, unsafe-path and symlink refusal
  * the same fail-closed readback states ABSENT / INVALID / DANGLING / INCOMPLETE
  * the same recovery (complete a verified uncommitted staging, discard an incomplete one)
    and cleanup (remove staging debris and non-active generations, never the active one)
  * the same single interruption hook: KS254_INTERRUPT_AT names a point, and the running
    process really dies (SIGKILL) so a probe observes genuine on-disk state.

`tests/ks254-superset-init-recovery.test.mjs` proves the port is contract-equivalent to the
released node store: identical generation ids and identical manifest bytes for identical
inputs, cross-readback of each side's published generation by the other side, and identical
refusal codes on the same negative inputs.

Non-claim: process death (SIGKILL) is the interruption qualified here. Storage power loss /
fsync durability and distributed transactions are NOT claimed.
"""

from __future__ import annotations

import hashlib
import json
import os
import random
import re
import shutil
import signal
from pathlib import Path

GENERATION_STORE_CONTRACT = "chimpmaera.bi/generation-store/v1"
GENERATION_MANIFEST_FILE = "generation.manifest.json"
OWNED_STORE_DIRECTORY = ".ks254-generations"
OWNED_STAGING_DIRECTORY = ".ks254-staging"
ACTIVE_POINTER_NAME = "active"

GENERATION_ID_PATTERN = re.compile(r"^[0-9a-f]{64}$")
STAGING_NAME_PATTERN = re.compile(r"^staging-[0-9a-f]{24}-[0-9a-f]{8}$")
POINTER_TEMP_PATTERN = re.compile(r"^\.active\.[0-9]+\.[0-9a-f]{8}$")
FILE_DECLARATION_PATTERN = re.compile(r"^[A-Za-z0-9._/-]+$")


class GenerationError(RuntimeError):
    """A refusal that names its machine-readable code, exactly like the node store."""

    def __init__(self, code: str, detail: str | None = None):
        self.code = code
        self.detail = detail
        super().__init__(f"{code}: {detail}" if detail is not None else code)


def _fail(code: str, detail: str | None = None):
    raise GenerationError(code, detail)


def interruption_point(name: str) -> None:
    """The single interruption hook. Inert unless the caller names THIS point."""
    if os.environ.get("KS254_INTERRUPT_AT") == name:
        os.kill(os.getpid(), signal.SIGKILL)


def canonical_json(value) -> str:
    """Byte-identical to the released `services/bi-control/src/canonical-json.js`."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            raise TypeError("Canonical JSON rejects non-finite numbers")
        return json.dumps(value)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(canonical_json(item) for item in value) + "]"
    if isinstance(value, dict):
        parts = []
        for key in sorted(value):
            parts.append(f"{json.dumps(key, ensure_ascii=False)}:{canonical_json(value[key])}")
        return "{" + ",".join(parts) + "}"
    raise TypeError("Canonical JSON accepts plain JSON objects only")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(file: Path) -> str:
    return sha256_bytes(Path(file).read_bytes())


class StoreLayout:
    def __init__(self, base: str | os.PathLike):
        self.base = Path(base).resolve()
        self.store_root = self.base / OWNED_STORE_DIRECTORY
        self.staging_root = self.base / OWNED_STAGING_DIRECTORY
        self.generations_root = self.store_root / "generations"
        self.pointer = self.store_root / ACTIVE_POINTER_NAME

    def as_dict(self) -> dict:
        return {
            "base": str(self.base),
            "storeRoot": str(self.store_root),
            "stagingRoot": str(self.staging_root),
            "generationsRoot": str(self.generations_root),
            "pointer": str(self.pointer),
        }


def generation_store_layout(root: str | os.PathLike) -> StoreLayout:
    return StoreLayout(root)


def initialize_generation_store(root: str | os.PathLike) -> StoreLayout:
    layout = generation_store_layout(root)
    layout.base.mkdir(parents=True, exist_ok=True)
    layout.staging_root.mkdir(parents=True, exist_ok=True)
    layout.generations_root.mkdir(parents=True, exist_ok=True)
    return layout


def verify_generation_manifest(directory: str | os.PathLike, manifest) -> dict:
    directory = Path(directory)
    if not isinstance(manifest, dict) or manifest.get("contract") != GENERATION_STORE_CONTRACT:
        return {"ok": False, "code": "GENERATION_MANIFEST_INVALID",
                "mismatches": [{"path": GENERATION_MANIFEST_FILE, "reason": "contract"}]}
    if not GENERATION_ID_PATTERN.match(str(manifest.get("generationId") or "")):
        return {"ok": False, "code": "GENERATION_MANIFEST_INVALID",
                "mismatches": [{"path": GENERATION_MANIFEST_FILE, "reason": "generationId"}]}
    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        return {"ok": False, "code": "GENERATION_MANIFEST_INVALID",
                "mismatches": [{"path": GENERATION_MANIFEST_FILE, "reason": "files"}]}
    mismatches: list[dict] = []
    seen: set[str] = set()
    for entry in files:
        relative = entry.get("path") if isinstance(entry, dict) else None
        if (not isinstance(relative, str) or not FILE_DECLARATION_PATTERN.match(relative)
                or any(part in ("", ".", "..") for part in relative.split("/"))
                or relative in seen
                or not GENERATION_ID_PATTERN.match(str(entry.get("sha256") or ""))):
            return {"ok": False, "code": "GENERATION_MANIFEST_INVALID",
                    "mismatches": [{"path": relative, "reason": "unsafe file declaration"}]}
        seen.add(relative)
        target = directory
        safe = True
        for part in relative.split("/"):
            target = target / part
            if not target.exists() or target.is_symlink():
                safe = False
                break
        if not safe or not target.is_file():
            mismatches.append({"path": relative, "reason": "missing or unsafe file"})
            continue
        actual = sha256_file(target)
        if actual != entry["sha256"]:
            mismatches.append({"path": relative, "reason": "digest",
                               "expected": entry["sha256"], "actual": actual})
    expected_id = sha256_bytes(canonical_json({
        "contract": GENERATION_STORE_CONTRACT, "label": manifest.get("label"), "files": files,
    }).encode("utf-8"))
    if expected_id != manifest.get("generationId"):
        mismatches.append({"path": GENERATION_MANIFEST_FILE, "reason": "generationId",
                           "expected": expected_id, "actual": manifest.get("generationId")})
    if mismatches:
        return {"ok": False, "code": "GENERATION_INCOMPLETE", "mismatches": mismatches}
    return {"ok": True, "code": "OK", "generationId": manifest["generationId"],
            "fileCount": len(files)}


def read_generation_manifest(directory: str | os.PathLike) -> dict:
    file = Path(directory) / GENERATION_MANIFEST_FILE
    if not file.exists():
        return {"manifest": None, "code": "GENERATION_MANIFEST_MISSING"}
    try:
        return {"manifest": json.loads(file.read_text(encoding="utf-8")), "code": "OK"}
    except Exception:
        return {"manifest": None, "code": "GENERATION_MANIFEST_UNREADABLE"}


def _nonce() -> str:
    return os.urandom(4).hex()


def stage_generation(root, target: str, build) -> dict:
    """Stage a complete generation into the OWNED staging directory.

    `build(staging_directory)` writes the artifacts and returns
    `{"label": str, "files": [{"path": str, "sha256": str}], "extra": ...}`; the store then
    RE-VERIFIES every declared byte before the staging may count as complete.
    """
    layout = initialize_generation_store(root)
    staging_name = f"staging-{os.urandom(12).hex()}-{_nonce()}"
    staging_path = layout.staging_root / staging_name
    interruption_point(f"{target}:before-staging")
    staging_path.mkdir(parents=True, exist_ok=True)
    try:
        built = build(staging_path)
    except BaseException:
        shutil.rmtree(staging_path, ignore_errors=True)
        raise
    if (not isinstance(built, dict) or not isinstance(built.get("files"), list)
            or not built["files"]):
        shutil.rmtree(staging_path, ignore_errors=True)
        _fail("GENERATION_BUILD_INVALID")
    # An interruption here leaves a staging directory with artifacts but NO manifest: an
    # incomplete staging that is recoverable by name and never mistaken for a generation.
    interruption_point(f"{target}:during-staging")
    provisional = {
        "contract": GENERATION_STORE_CONTRACT,
        "label": str(built.get("label") if built.get("label") is not None else "unlabelled"),
        "files": [{"path": str(entry["path"]), "sha256": str(entry["sha256"])}
                  for entry in built["files"]],
    }
    provisional["generationId"] = sha256_bytes(canonical_json(provisional).encode("utf-8"))
    verified = verify_generation_manifest(staging_path, provisional)
    if not verified["ok"]:
        shutil.rmtree(staging_path, ignore_errors=True)
        _fail(verified["code"], json.dumps(verified["mismatches"]))
    manifest = dict(provisional)
    manifest["stagedAt"] = _iso_now()
    (staging_path / GENERATION_MANIFEST_FILE).write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    interruption_point(f"{target}:after-staging")
    return {"generationId": manifest["generationId"], "stagingName": staging_name,
            "stagingPath": str(staging_path), "manifest": manifest, "layout": layout,
            "extra": built.get("extra")}


def _iso_now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def activate_generation(root, staged: dict, target: str) -> dict:
    """Publish the staged generation immutably and flip the ONE pointer by rename(2)."""
    layout = staged.get("layout") or generation_store_layout(root)
    verified_staging = verify_generation_manifest(staged["stagingPath"], staged["manifest"])
    if not verified_staging["ok"]:
        _fail("GENERATION_STAGING_NOT_COMPLETE", verified_staging["code"])
    generation_id = staged["manifest"]["generationId"]
    generation_path = layout.generations_root / generation_id
    if generation_path.exists():
        existing = read_generation_manifest(generation_path)
        if not verify_generation_manifest(generation_path, existing["manifest"])["ok"]:
            _fail("GENERATION_PUBLISH_COLLISION", generation_id)
        # The identical generation is already published: the freshly staged copy is owned
        # staging debris and is discarded here rather than left for a later cleanup.
        shutil.rmtree(staged["stagingPath"], ignore_errors=True)
        published = "REUSED"
    else:
        os.rename(staged["stagingPath"], generation_path)
        published = "PUBLISHED"
    interruption_point(f"{target}:after-generation-publish")
    pointer_temp = layout.store_root / f".active.{os.getpid()}.{_nonce()}"
    os.symlink(os.path.join("generations", generation_id), pointer_temp)
    os.rename(pointer_temp, layout.pointer)
    interruption_point(f"{target}:after-activation")
    return {"generationId": generation_id, "generationPath": str(generation_path),
            "manifest": staged["manifest"], "published": published,
            "extra": staged.get("extra")}


def read_active_generation(root, verify_files: bool = True) -> dict:
    """Resolve the active generation; never throws, never yields partially trusted bytes."""
    layout = generation_store_layout(root)
    try:
        target = os.readlink(layout.pointer)
    except OSError:
        return {"ok": False, "state": "ABSENT", "code": "GENERATION_POINTER_ABSENT",
                "layout": layout}
    match = re.match(r"^generations/([0-9a-f]{64})$", target)
    if not match:
        return {"ok": False, "state": "INVALID", "code": "GENERATION_POINTER_INVALID",
                "target": target, "layout": layout}
    generation_id = match.group(1)
    generation_path = layout.generations_root / generation_id
    if not generation_path.exists():
        return {"ok": False, "state": "DANGLING", "code": "GENERATION_POINTER_DANGLING",
                "generationId": generation_id, "layout": layout}
    read = read_generation_manifest(generation_path)
    if read["manifest"] is None:
        return {"ok": False, "state": "INCOMPLETE", "code": read["code"],
                "generationId": generation_id, "layout": layout}
    if read["manifest"].get("generationId") != generation_id:
        return {"ok": False, "state": "INCOMPLETE", "code": "GENERATION_MANIFEST_MISMATCH",
                "generationId": generation_id, "layout": layout}
    verified = (verify_generation_manifest(generation_path, read["manifest"]) if verify_files
                else {"ok": True, "code": "OK"})
    if not verified["ok"]:
        return {"ok": False, "state": "INCOMPLETE", "code": "GENERATION_INCOMPLETE",
                "generationId": generation_id, "mismatches": verified["mismatches"],
                "layout": layout}
    return {"ok": True, "state": "ACTIVE", "code": "OK", "generationId": generation_id,
            "generationPath": str(generation_path), "manifest": read["manifest"],
            "layout": layout}


def list_staging_directories(layout: StoreLayout) -> list[str]:
    try:
        entries = list(layout.staging_root.iterdir())
    except OSError:
        return []
    return sorted(entry.name for entry in entries
                  if entry.is_dir() and STAGING_NAME_PATTERN.match(entry.name))


def list_generation_directories(layout: StoreLayout) -> list[str]:
    try:
        entries = list(layout.generations_root.iterdir())
    except OSError:
        return []
    return sorted(entry.name for entry in entries if GENERATION_ID_PATTERN.match(entry.name))


def inspect_generation_store(root) -> dict:
    layout = generation_store_layout(root)
    active = read_active_generation(root)
    generations = []
    for generation_id in list_generation_directories(layout):
        directory = layout.generations_root / generation_id
        read = read_generation_manifest(directory)
        verified = ({"ok": False, "code": read["code"]} if read["manifest"] is None
                    else verify_generation_manifest(directory, read["manifest"]))
        generations.append({
            "generationId": generation_id,
            "complete": verified["ok"],
            "code": verified["code"],
            "active": active.get("ok", False) and active.get("generationId") == generation_id,
            "label": (read["manifest"] or {}).get("label"),
        })
    staging = []
    for staging_name in list_staging_directories(layout):
        directory = layout.staging_root / staging_name
        read = read_generation_manifest(directory)
        verified = ({"ok": False, "code": read["code"]} if read["manifest"] is None
                    else verify_generation_manifest(directory, read["manifest"]))
        staging.append({"stagingName": staging_name, "complete": verified["ok"],
                        "code": verified["code"]})
    return {"contract": GENERATION_STORE_CONTRACT,
            "pointer": {"state": active.get("state"), "code": active.get("code"),
                        "generationId": active.get("generationId")},
            "generations": generations, "staging": staging}


def recover_generation_store(root, target: str = "generation") -> dict:
    """Finish an activation whose staging was already complete; discard incomplete staging.

    It never invents a generation and never removes a published generation.
    """
    layout = initialize_generation_store(root)
    activated: list[dict] = []
    discarded: list[dict] = []
    for staging_name in list_staging_directories(layout):
        staging_path = layout.staging_root / staging_name
        read = read_generation_manifest(staging_path)
        verified = ({"ok": False, "code": read["code"]} if read["manifest"] is None
                    else verify_generation_manifest(staging_path, read["manifest"]))
        if not verified["ok"]:
            shutil.rmtree(staging_path, ignore_errors=True)
            discarded.append({"stagingName": staging_name, "code": verified["code"]})
            continue
        published = activate_generation(root, {
            "stagingPath": str(staging_path), "manifest": read["manifest"], "layout": layout,
        }, target)
        activated.append({"stagingName": staging_name, "generationId": published["generationId"],
                          "published": published["published"]})
    return {"activated": activated, "discarded": discarded,
            "store": inspect_generation_store(root)}


def cleanup_generation_store(root) -> dict:
    """Remove owned staging debris and every generation that is NOT the active one."""
    layout = generation_store_layout(root)
    active = read_active_generation(root)
    if not active["ok"]:
        _fail("GENERATION_CLEANUP_ACTIVE_UNRESOLVED", active["code"])
    removed_generations = []
    for generation_id in list_generation_directories(layout):
        if generation_id == active["generationId"]:
            continue
        shutil.rmtree(layout.generations_root / generation_id, ignore_errors=True)
        removed_generations.append(generation_id)
    removed_staging = []
    for staging_name in list_staging_directories(layout):
        shutil.rmtree(layout.staging_root / staging_name, ignore_errors=True)
        removed_staging.append(staging_name)
    return {"removedGenerations": removed_generations, "removedStaging": removed_staging,
            "activeGenerationId": active["generationId"],
            "activeFilesVerified": verify_generation_manifest(
                active["generationPath"], active["manifest"])["ok"]}


def cleanup_pointer_debris(root) -> list[str]:
    """A left-over pointer temporary is owned debris inside the store directory only."""
    layout = generation_store_layout(root)
    try:
        entries = list(layout.store_root.iterdir())
    except OSError:
        return []
    removed = []
    for entry in entries:
        if not POINTER_TEMP_PATTERN.match(entry.name):
            continue
        try:
            entry.unlink()
        except OSError:
            continue
        removed.append(entry.name)
    return removed


def list_owned_paths(root) -> dict:
    layout = generation_store_layout(root)
    return {"owned": [str(layout.store_root), str(layout.staging_root)],
            "storeRoot": str(layout.store_root), "stagingRoot": str(layout.staging_root),
            "pointer": str(layout.pointer)}
