// KS254 (JoFe2/KaleidoSphere#254) — crash-safe generation staging and activation.
//
// One bounded mechanism, reused by both native surfaces that must not be observable in a
// half-written state:
//
//   * native dependency provisioning   (scripts/provision-ks238-order-source-dependency.mjs)
//   * projection/receipt activation    (services/bi-control/src/projection-generation.mjs)
//
// The mechanism stages a complete generation into an OWNED staging directory, verifies
// every declared byte, publishes it as an IMMUTABLE generation directory named by the
// content digest of its own manifest, and only then flips ONE pointer. The pointer is a
// symlink whose replacement by `rename(2)` is atomic within its directory, so a concurrent
// reader resolves either the complete old generation directory or the complete new one —
// never a mix, and never a deleted-only state. The previously active generation directory
// is retained (never deleted by activation), so an interrupted run can always be completed
// or rolled back and the last complete usable generation stays usable.
//
// Ownership discipline: the store and staging directories are the ONLY paths this module
// writes. `cleanup` never removes the active generation and never touches a path outside
// the two owned directories.
//
// Non-claim: a process death (SIGKILL) is the interruption this module is qualified against.
// Storage power loss / fsync-durability and distributed transactions are NOT claimed; no
// `fsync` is issued and none of the guarantees below depend on the page cache being flushed.

import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync,
  statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { canonicalJson } from './canonical-json.js';

export const GENERATION_STORE_CONTRACT = 'chimpmaera.bi/generation-store/v1';
export const GENERATION_MANIFEST_FILE = 'generation.manifest.json';
export const OWNED_STORE_DIRECTORY = '.ks254-generations';
export const OWNED_STAGING_DIRECTORY = '.ks254-staging';
export const ACTIVE_POINTER_NAME = 'active';

// The single interruption hook. It is inert unless the caller explicitly names THIS point
// through the environment. When it fires the running process really dies (SIGKILL), so a
// probe observes the genuine on-disk state instead of a constructed exception.
export function interruptionPoint(name) {
  if (process.env?.KS254_INTERRUPT_AT === name) process.kill(process.pid, 'SIGKILL');
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const generationIdPattern = /^[0-9a-f]{64}$/;
const stagingNamePattern = /^staging-[0-9a-f]{24}-[0-9a-f]{8}$/;
const pointerTempPattern = /^\.active\.[0-9]+\.[0-9a-f]{8}$/;

export function generationFailure(code, detail = null) {
  const error = new Error(detail ? `${code}: ${detail}` : code);
  error.code = code;
  if (detail !== null) error.detail = detail;
  return error;
}

const fail = (code, detail = null) => { throw generationFailure(code, detail); };

const nonce = () => randomBytes(4).toString('hex');

export function generationStoreLayout(root) {
  const base = path.resolve(root);
  const storeRoot = path.join(base, OWNED_STORE_DIRECTORY);
  return {
    base,
    storeRoot,
    stagingRoot: path.join(base, OWNED_STAGING_DIRECTORY),
    generationsRoot: path.join(storeRoot, 'generations'),
    pointer: path.join(storeRoot, ACTIVE_POINTER_NAME),
  };
}

export function initializeGenerationStore(root) {
  const layout = generationStoreLayout(root);
  mkdirSync(layout.base, { recursive: true });
  mkdirSync(layout.stagingRoot, { recursive: true });
  mkdirSync(layout.generationsRoot, { recursive: true });
  return layout;
}

function fileDigest(file) {
  return sha256(readFileSync(file));
}

// Verify every byte a manifest declares. A generation is only ever "complete" when its own
// manifest declaration matches the bytes on disk; anything else is INCOMPLETE, never a
// partially trusted generation.
export function verifyGenerationManifest(directory, manifest) {
  const mismatches = [];
  if (!manifest || manifest.contract !== GENERATION_STORE_CONTRACT) {
    return { ok: false, code: 'GENERATION_MANIFEST_INVALID', mismatches: [{ path: GENERATION_MANIFEST_FILE, reason: 'contract' }] };
  }
  if (!generationIdPattern.test(String(manifest.generationId ?? ''))) {
    return { ok: false, code: 'GENERATION_MANIFEST_INVALID', mismatches: [{ path: GENERATION_MANIFEST_FILE, reason: 'generationId' }] };
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    return { ok: false, code: 'GENERATION_MANIFEST_INVALID', mismatches: [{ path: GENERATION_MANIFEST_FILE, reason: 'files' }] };
  }
  for (const entry of manifest.files) {
    const target = path.join(directory, entry.path);
    if (!existsSync(target) || !statSync(target).isFile()) {
      mismatches.push({ path: entry.path, reason: 'missing' });
      continue;
    }
    const actual = fileDigest(target);
    if (actual !== entry.sha256) mismatches.push({ path: entry.path, reason: 'digest', expected: entry.sha256, actual });
  }
  const expectedId = sha256(canonicalJson({
    contract: GENERATION_STORE_CONTRACT, label: manifest.label, files: manifest.files,
  }));
  if (expectedId !== manifest.generationId) {
    mismatches.push({ path: GENERATION_MANIFEST_FILE, reason: 'generationId', expected: expectedId, actual: manifest.generationId });
  }
  return mismatches.length === 0
    ? { ok: true, code: 'OK', generationId: manifest.generationId, fileCount: manifest.files.length }
    : { ok: false, code: 'GENERATION_INCOMPLETE', mismatches };
}

function readGenerationManifest(directory) {
  const file = path.join(directory, GENERATION_MANIFEST_FILE);
  if (!existsSync(file)) return { manifest: null, code: 'GENERATION_MANIFEST_MISSING' };
  try {
    return { manifest: JSON.parse(readFileSync(file, 'utf8')), code: 'OK' };
  } catch {
    return { manifest: null, code: 'GENERATION_MANIFEST_UNREADABLE' };
  }
}

// Stage a complete generation. `build(stagingDirectory)` writes the artifacts and returns
// `{ label, files: [{ path, sha256 }] }`; the store then RE-VERIFIES every declared byte
// before the staging directory is allowed to count as complete.
export function stageGeneration({ root, target = 'generation', build }) {
  const layout = initializeGenerationStore(root);
  const stagingName = `staging-${randomBytes(12).toString('hex')}-${nonce()}`;
  const stagingPath = path.join(layout.stagingRoot, stagingName);
  interruptionPoint(`${target}:before-staging`);
  mkdirSync(stagingPath, { recursive: true });
  let built;
  try {
    built = build(stagingPath);
  } catch (error) {
    rmSync(stagingPath, { recursive: true, force: true });
    throw error;
  }
  if (!built || typeof built !== 'object' || !Array.isArray(built.files) || built.files.length === 0) {
    rmSync(stagingPath, { recursive: true, force: true });
    fail('GENERATION_BUILD_INVALID');
  }
  // Interruption here leaves a staging directory with artifacts but NO manifest: an
  // incomplete staging that is recoverable by name and never mistaken for a generation.
  interruptionPoint(`${target}:during-staging`);
  const provisional = {
    contract: GENERATION_STORE_CONTRACT,
    label: String(built.label ?? 'unlabelled'),
    files: built.files.map((entry) => ({ path: String(entry.path), sha256: String(entry.sha256) })),
  };
  const verified = verifyGenerationManifest(stagingPath, { ...provisional, generationId: sha256(canonicalJson(provisional)) });
  if (!verified.ok) {
    rmSync(stagingPath, { recursive: true, force: true });
    fail(verified.code, JSON.stringify(verified.mismatches));
  }
  const manifest = {
    ...provisional,
    generationId: verified.generationId,
    stagedAt: new Date().toISOString(),
  };
  writeFileSync(path.join(stagingPath, GENERATION_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  interruptionPoint(`${target}:after-staging`);
  return {
    generationId: manifest.generationId,
    stagingName,
    stagingPath,
    manifest,
    layout,
    extra: built.extra ?? null,
  };
}

// Publish the staged generation as an immutable generation directory and flip the ONE
// pointer. The pointer replacement is a `rename(2)` of a freshly created symlink over the
// previous pointer, so it is atomic: a reader resolves the old generation or the new one.
export function activateGeneration({ root, staged, target = 'generation' }) {
  const layout = staged?.layout ?? generationStoreLayout(root);
  const verifiedStaging = verifyGenerationManifest(staged.stagingPath ?? '', staged.manifest);
  if (!verifiedStaging.ok) fail('GENERATION_STAGING_NOT_COMPLETE', verifiedStaging.code);
  const generationId = staged.manifest.generationId;
  const generationPath = path.join(layout.generationsRoot, generationId);
  let published = 'REUSED';
  if (existsSync(generationPath)) {
    const existing = readGenerationManifest(generationPath);
    const existingVerified = verifyGenerationManifest(generationPath, existing.manifest);
    if (!existingVerified.ok) fail('GENERATION_PUBLISH_COLLISION', generationId);
    // The identical generation is already published; the freshly staged copy is owned
    // staging debris and is discarded here rather than left for a later cleanup.
    rmSync(staged.stagingPath, { recursive: true, force: true });
  } else {
    renameSync(staged.stagingPath, generationPath);
    published = 'PUBLISHED';
  }
  interruptionPoint(`${target}:after-generation-publish`);
  const pointerTemp = path.join(layout.storeRoot, `.active.${process.pid}.${nonce()}`);
  symlinkSync(path.join('generations', generationId), pointerTemp);
  renameSync(pointerTemp, layout.pointer);
  interruptionPoint(`${target}:after-activation`);
  return {
    generationId,
    generationPath,
    manifest: staged.manifest,
    published,
    extra: staged.extra ?? null,
  };
}

// Resolve the active generation. Returns a status object (never throws) so a caller can
// distinguish ABSENT / INVALID / DANGLING / INCOMPLETE from a usable generation; an
// unresolved or incomplete pointer NEVER yields partially trusted bytes.
export function readActiveGeneration({ root, verifyFiles = true }) {
  const layout = generationStoreLayout(root);
  let target = null;
  try {
    target = readlinkSync(layout.pointer);
  } catch {
    return { ok: false, state: 'ABSENT', code: 'GENERATION_POINTER_ABSENT', layout };
  }
  const match = /^generations\/([0-9a-f]{64})$/.exec(target);
  if (!match) return { ok: false, state: 'INVALID', code: 'GENERATION_POINTER_INVALID', target, layout };
  const generationId = match[1];
  const generationPath = path.join(layout.generationsRoot, generationId);
  if (!existsSync(generationPath)) {
    return { ok: false, state: 'DANGLING', code: 'GENERATION_POINTER_DANGLING', generationId, layout };
  }
  const read = readGenerationManifest(generationPath);
  if (read.manifest === null) {
    return { ok: false, state: 'INCOMPLETE', code: read.code, generationId, layout };
  }
  if (read.manifest.generationId !== generationId) {
    return { ok: false, state: 'INCOMPLETE', code: 'GENERATION_MANIFEST_MISMATCH', generationId, layout };
  }
  const verified = verifyFiles
    ? verifyGenerationManifest(generationPath, read.manifest)
    : { ok: true, code: 'OK' };
  if (!verified.ok) {
    return { ok: false, state: 'INCOMPLETE', code: 'GENERATION_INCOMPLETE', generationId, mismatches: verified.mismatches, layout };
  }
  return { ok: true, state: 'ACTIVE', code: 'OK', generationId, generationPath, manifest: read.manifest, layout };
}

function listStagingDirectories(layout) {
  let entries = [];
  try { entries = readdirSync(layout.stagingRoot, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter((entry) => entry.isDirectory() && stagingNamePattern.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function listGenerationDirectories(layout) {
  let entries = [];
  try { entries = readdirSync(layout.generationsRoot, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter((entry) => generationIdPattern.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

export function inspectGenerationStore(root) {
  const layout = generationStoreLayout(root);
  const active = readActiveGeneration({ root });
  const generations = listGenerationDirectories(layout).map((generationId) => {
    const read = readGenerationManifest(path.join(layout.generationsRoot, generationId));
    const verified = read.manifest === null
      ? { ok: false, code: read.code }
      : verifyGenerationManifest(path.join(layout.generationsRoot, generationId), read.manifest);
    return {
      generationId,
      complete: verified.ok,
      code: verified.ok ? 'OK' : verified.code,
      active: active.ok && active.generationId === generationId,
      label: read.manifest?.label ?? null,
    };
  });
  const staging = listStagingDirectories(layout).map((stagingName) => {
    const stagingPath = path.join(layout.stagingRoot, stagingName);
    const read = readGenerationManifest(stagingPath);
    const verified = read.manifest === null
      ? { ok: false, code: read.code }
      : verifyGenerationManifest(stagingPath, read.manifest);
    return { stagingName, complete: verified.ok, code: verified.ok ? 'OK' : verified.code };
  });
  return {
    contract: GENERATION_STORE_CONTRACT,
    pointer: { state: active.state, code: active.code, generationId: active.generationId ?? null },
    generations,
    staging,
  };
}

// Recovery entry point: finish an activation that was interrupted after its staging was
// already complete, and discard staging that was never completed. It never invents a
// generation and never removes a published generation.
export function recoverGenerationStore({ root, target = 'generation' }) {
  const layout = initializeGenerationStore(root);
  const activated = [];
  const discarded = [];
  for (const stagingName of listStagingDirectories(layout)) {
    const stagingPath = path.join(layout.stagingRoot, stagingName);
    const read = readGenerationManifest(stagingPath);
    const verified = read.manifest === null
      ? { ok: false, code: read.code }
      : verifyGenerationManifest(stagingPath, read.manifest);
    if (!verified.ok) {
      rmSync(stagingPath, { recursive: true, force: true });
      discarded.push({ stagingName, code: verified.code });
      continue;
    }
    const published = activateGeneration({
      root, target,
      staged: { stagingPath, manifest: read.manifest, layout },
    });
    activated.push({ stagingName, generationId: published.generationId, published: published.published });
  }
  return { activated, discarded, store: inspectGenerationStore(root) };
}

// Cleanup entry point: remove every published generation that is NOT the active one, plus
// every owned staging leftover. The active generation and anything outside the two owned
// directories are untouched by construction.
export function cleanupGenerationStore({ root }) {
  const layout = generationStoreLayout(root);
  const active = readActiveGeneration({ root });
  if (!active.ok) fail('GENERATION_CLEANUP_ACTIVE_UNRESOLVED', active.code);
  const removedGenerations = [];
  for (const generationId of listGenerationDirectories(layout)) {
    if (generationId === active.generationId) continue;
    rmSync(path.join(layout.generationsRoot, generationId), { recursive: true, force: true });
    removedGenerations.push(generationId);
  }
  const removedStaging = [];
  for (const stagingName of listStagingDirectories(layout)) {
    rmSync(path.join(layout.stagingRoot, stagingName), { recursive: true, force: true });
    removedStaging.push(stagingName);
  }
  return {
    removedGenerations,
    removedStaging,
    activeGenerationId: active.generationId,
    activeFilesVerified: verifyGenerationManifest(active.generationPath, active.manifest).ok,
  };
}

// A left-over pointer temporary from a killed activation is never a pointer and never a
// generation; it is owned debris inside the store directory only.
export function cleanupPointerDebris({ root }) {
  const layout = generationStoreLayout(root);
  let entries = [];
  try { entries = readdirSync(layout.storeRoot, { withFileTypes: true }); } catch { return []; }
  const removed = [];
  for (const entry of entries) {
    if (!pointerTempPattern.test(entry.name)) continue;
    rmSync(path.join(layout.storeRoot, entry.name), { force: true });
    removed.push(entry.name);
  }
  return removed;
}

export function listOwnedPaths(root) {
  const layout = generationStoreLayout(root);
  return {
    owned: [layout.storeRoot, layout.stagingRoot],
    storeRoot: layout.storeRoot,
    stagingRoot: layout.stagingRoot,
    pointer: layout.pointer,
  };
}
