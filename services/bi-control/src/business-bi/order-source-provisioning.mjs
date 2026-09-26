// KS254 (JoFe2/KaleidoSphere#254) — crash-safe provisioning of the pinned PAN order-source
// dependency.
//
// The dependency is consumed through the pinned artifact manifest
// `contracts/dependencies/pansphaira-order-source-v1.json` (FINDING 3/4 of the KS238 slice).
// Provisioning previously destroyed the installed generation before writing the new one
// (`rmSync(INSTALL_ROOT)` followed by two `cpSync` calls), so an interruption during
// provisioning left the dependency PARTIAL or DELETED-ONLY, and the consumer locator then
// refused with no complete generation to fall back to.
//
// This module provisions through the shared crash-safe generation store
// (`services/bi-control/src/generation-store.mjs`):
//
//   1. the producer root is verified byte-for-byte against the pinned manifest;
//   2. the COMPLETE generation (wrapper + every compiled closure file) is staged and
//      re-verified inside the owned staging directory;
//   3. the staged generation is published as an immutable content-addressed generation
//      directory, and ONE pointer symlink is flipped atomically.
//
// The pinned in-repository tree `dependencies/pansphaira/` is never mutated by provisioning:
// it stays the shipped, always-complete generation, and it is what a reader falls back to
// when no provisioned generation is active. An interrupted provisioning therefore leaves
// either the pinned generation, the previous provisioned generation, or the complete new
// generation — never a partial tree and never a deleted-only dependency state.
//
// Non-claim: real interrupts are process deaths (SIGKILL); storage power loss is not claimed.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { canonicalJson } from '../canonical-json.js';
import {
  ACTIVE_POINTER_NAME, OWNED_STORE_DIRECTORY, activateGeneration, cleanupGenerationStore,
  cleanupPointerDebris, generationStoreLayout, inspectGenerationStore, readActiveGeneration,
  recoverGenerationStore, stageGeneration, verifyGenerationManifest, GENERATION_STORE_CONTRACT,
} from '../generation-store.mjs';
import {
  PAN_ORDER_SOURCE_DEPENDENCY,
  PAN_ORDER_SOURCE_RELEASE,
} from './order-source-consumption.mjs';

export const ORDER_SOURCE_PROVISIONING_CONTRACT = 'chimpmaera.bi/order-source-provisioning/v1';
export const ORDER_SOURCE_MANIFEST_FILE = 'contracts/dependencies/pansphaira-order-source-v1.json';
export const ORDER_SOURCE_INSTALL_RELATIVE = 'dependencies/pansphaira';
// The active provisioned generation is resolved through exactly ONE path: the store pointer.
export const ORDER_SOURCE_ACTIVE_RELATIVE =
  `dependencies/${OWNED_STORE_DIRECTORY}/${ACTIVE_POINTER_NAME}/${PAN_ORDER_SOURCE_DEPENDENCY.module}`;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// `repoRoot` is where the pinned manifest and the pinned in-repository generation live (the
// repository). `root` is the generation-store parent, i.e. the PROVISIONING TARGET: it
// defaults to the in-repository dependency root and may be relocated to an isolated
// synthetic root. Only the target moves; the manifest, the pinned install and every expected
// digest stay bound to the repository.
export function orderSourceProvisioningLayout(repoRoot, root = null) {
  const resolvedRoot = root === null ? path.resolve(repoRoot, 'dependencies') : path.resolve(root);
  const store = generationStoreLayout(resolvedRoot);
  return {
    repoRoot: path.resolve(repoRoot),
    root: resolvedRoot,
    store,
    installRoot: path.resolve(repoRoot, ORDER_SOURCE_INSTALL_RELATIVE),
    activeModule: path.resolve(resolvedRoot, OWNED_STORE_DIRECTORY, ACTIVE_POINTER_NAME,
      PAN_ORDER_SOURCE_DEPENDENCY.module),
  };
}

export function orderSourceManifestPath(repoRoot) {
  return path.resolve(repoRoot, ORDER_SOURCE_MANIFEST_FILE);
}

function walkClosureFiles(producerRoot, closureRoot) {
  const out = [];
  const walk = (dir) => {
    for (const entry of [...readdirSync(dir, { withFileTypes: true })]
      .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) out.push(full);
    }
  };
  walk(path.join(producerRoot, closureRoot));
  return out;
}

// Recompute the runtime-closure digest exactly as the consumer does, from a producer root.
export function measureClosure(producerRoot) {
  const closureRoot = path.join(producerRoot, PAN_ORDER_SOURCE_DEPENDENCY.runtimeClosureRoot);
  if (!existsSync(closureRoot)) return { ok: false, code: 'SOURCE_CLOSURE_MISSING', closureRoot };
  const partials = {};
  for (const file of walkClosureFiles(producerRoot, PAN_ORDER_SOURCE_DEPENDENCY.runtimeClosureRoot)) {
    const rel = path.relative(producerRoot, file).split(path.sep).join('/');
    partials[rel] = sha256(readFileSync(file));
  }
  return {
    ok: true,
    closureSha256: sha256(JSON.stringify(partials)),
    fileCount: Object.keys(partials).length,
  };
}

export function readProvisioningManifest(repoRoot) {
  const manifestPath = orderSourceManifestPath(repoRoot);
  return { manifestPath, manifest: JSON.parse(readFileSync(manifestPath, 'utf8')) };
}

// The pin agreement checks the previous provisioner performed, unchanged in meaning: the
// manifest, the consumer pin and the recorded released SOURCE identity must all agree, and
// the release must never be inflated into a published compiled artifact.
export function assertManifestAgreement(manifest) {
  // Each disagreement keeps the exact denial code the previous provisioner raised, so a
  // counterexample still names WHICH contract disagreed instead of only that one did.
  const disagreements = [];
  if (manifest.moduleSha256 !== PAN_ORDER_SOURCE_DEPENDENCY.expectedModuleSha256) {
    disagreements.push(['MANIFEST_MODULE_DISAGREES_WITH_CONSUMER_PIN', 'moduleSha256', manifest.moduleSha256, PAN_ORDER_SOURCE_DEPENDENCY.expectedModuleSha256]);
  }
  if (manifest.runtimeClosureSha256 !== PAN_ORDER_SOURCE_DEPENDENCY.expectedRuntimeClosureSha256) {
    disagreements.push(['MANIFEST_CLOSURE_DISAGREES_WITH_CONSUMER_PIN', 'runtimeClosureSha256', manifest.runtimeClosureSha256, PAN_ORDER_SOURCE_DEPENDENCY.expectedRuntimeClosureSha256]);
  }
  if (manifest.files.length !== PAN_ORDER_SOURCE_DEPENDENCY.expectedRuntimeClosureFileCount) {
    disagreements.push(['MANIFEST_FILE_COUNT_DISAGREES_WITH_CONSUMER_PIN', 'files', manifest.files.length, PAN_ORDER_SOURCE_DEPENDENCY.expectedRuntimeClosureFileCount]);
  }
  const release = manifest.release ?? {};
  const fields = [
    ['releaseId', release.releaseId, PAN_ORDER_SOURCE_RELEASE.releaseId],
    ['tag', release.tag, PAN_ORDER_SOURCE_RELEASE.tag],
    ['mainCommit', release.mainCommit, PAN_ORDER_SOURCE_RELEASE.mainCommit],
    ['publishedAt', release.publishedAt, PAN_ORDER_SOURCE_RELEASE.publishedAt],
    ['releaseClass', release.releaseClass, PAN_ORDER_SOURCE_RELEASE.releaseClass],
    ['sourceModuleSha256', release.sourceModuleSha256, PAN_ORDER_SOURCE_RELEASE.moduleSha256],
    ['attachedAssets', release.attachedAssets, PAN_ORDER_SOURCE_RELEASE.attachedAssets],
    ['compiledClosurePublished', release.compiledClosurePublished, PAN_ORDER_SOURCE_RELEASE.compiledClosurePublished],
  ];
  for (const [field, actual, expected] of fields) {
    if (actual !== expected) disagreements.push(['MANIFEST_RELEASE_DISAGREES_WITH_CONSUMER_PIN', field, actual, expected]);
  }
  if ((manifest.release ?? {}).compiledClosurePublished === false) {
    // Recorded explicitly: a SOURCE_EVIDENCE_ONLY release is never inflated into a
    // published compiled artifact by provisioning.
  } else {
    disagreements.push(['MANIFEST_RELEASE_INFLATED_INTO_A_PUBLICATION', 'compiledClosurePublished',
      (manifest.release ?? {}).compiledClosurePublished, false]);
  }
  return {
    ok: disagreements.length === 0,
    code: disagreements.length === 0 ? 'OK' : disagreements[0][0],
    disagreements,
  };
}

// Verify an INSTALLED generation tree (module + closure) against the pinned manifest. Used
// for the pinned in-repository tree and for any published generation directory.
export function verifyInstalledTree(installRoot, manifest) {
  const modulePath = path.join(installRoot, manifest.module);
  if (!existsSync(modulePath)) {
    return { ok: false, code: 'INSTALL_MISSING', modulePath };
  }
  const moduleDigest = sha256(readFileSync(modulePath));
  if (moduleDigest !== manifest.moduleSha256) {
    return { ok: false, code: 'INSTALL_MODULE_DIGEST_MISMATCH', moduleDigest, expected: manifest.moduleSha256 };
  }
  const measured = measureClosure(installRoot);
  if (!measured.ok) return { ok: false, code: 'INSTALL_CLOSURE_MISSING', closureRoot: measured.closureRoot };
  if (measured.closureSha256 !== manifest.runtimeClosureSha256) {
    return { ok: false, code: 'INSTALL_CLOSURE_DIGEST_MISMATCH', closureSha256: measured.closureSha256, expected: manifest.runtimeClosureSha256 };
  }
  if (measured.fileCount !== manifest.runtimeClosureFileCount) {
    return { ok: false, code: 'INSTALL_CLOSURE_FILE_COUNT_MISMATCH', fileCount: measured.fileCount, expected: manifest.runtimeClosureFileCount };
  }
  return { ok: true, code: 'OK', moduleDigest, closureSha256: measured.closureSha256, fileCount: measured.fileCount };
}

// Verify the PRODUCER root before a single byte is staged: every declared file must be
// present with its pinned digest, and the recomputed closure digest must match.
export function verifyProducerRoot(producerRoot, manifest) {
  if (!existsSync(producerRoot) || !statSync(producerRoot).isDirectory()) {
    return { ok: false, code: 'SOURCE_NOT_A_DIRECTORY', producerRoot };
  }
  for (const entry of manifest.files) {
    if (!existsSync(path.join(producerRoot, entry.path))) return { ok: false, code: 'SOURCE_MISSING_FILE', file: entry.path };
  }
  if (!existsSync(path.join(producerRoot, manifest.module))) return { ok: false, code: 'SOURCE_MISSING_FILE', file: manifest.module };
  const moduleDigest = sha256(readFileSync(path.join(producerRoot, manifest.module)));
  if (moduleDigest !== manifest.moduleSha256) {
    return { ok: false, code: 'SOURCE_MODULE_DIGEST_MISMATCH', moduleDigest, expected: manifest.moduleSha256 };
  }
  const measured = measureClosure(producerRoot);
  if (!measured.ok) return { ok: false, code: 'SOURCE_CLOSURE_MISSING', closureRoot: measured.closureRoot };
  if (measured.closureSha256 !== manifest.runtimeClosureSha256) {
    return { ok: false, code: 'SOURCE_CLOSURE_DIGEST_MISMATCH', closureSha256: measured.closureSha256, expected: manifest.runtimeClosureSha256 };
  }
  for (const entry of manifest.files) {
    const digest = sha256(readFileSync(path.join(producerRoot, entry.path)));
    if (digest !== entry.sha256) return { ok: false, code: 'SOURCE_FILE_DIGEST_MISMATCH', file: entry.path };
  }
  return { ok: true, code: 'OK', closureSha256: measured.closureSha256, fileCount: measured.fileCount };
}

const ORDER_SOURCE_LABEL = 'pansphaira-order-source';

// Copy the COMPLETE generation into the staging directory and declare it to the store. The
// store re-verifies every declared byte before the staging directory counts as complete.
function buildOrderSourceGeneration({ producerRoot, manifest }) {
  return (stagingDirectory) => {
    const files = [];
    for (const entry of manifest.files) {
      const target = path.join(stagingDirectory, entry.path);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, readFileSync(path.join(producerRoot, entry.path)));
      files.push({ path: entry.path, sha256: entry.sha256 });
    }
    const moduleTarget = path.join(stagingDirectory, manifest.module);
    mkdirSync(path.dirname(moduleTarget), { recursive: true });
    writeFileSync(moduleTarget, readFileSync(path.join(producerRoot, manifest.module)));
    files.push({ path: manifest.module, sha256: manifest.moduleSha256 });
    files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
    return { label: ORDER_SOURCE_LABEL, files };
  };
}

// STATS-only readback of the ACTIVE provisioned generation. It resolves the single pointer
// and verifies the generation's own manifest; it never reads a partially written path.
export function readActiveOrderSourceGeneration(repoRoot, root = null) {
  const layout = orderSourceProvisioningLayout(repoRoot, root);
  const active = readActiveGeneration({ root: layout.root });
  return {
    ...active,
    modulePath: active.ok ? path.join(active.generationPath, PAN_ORDER_SOURCE_DEPENDENCY.module) : null,
    installRoot: layout.installRoot,
    activeCandidate: ORDER_SOURCE_ACTIVE_RELATIVE,
  };
}

export function provisionOrderSourceDependency({
  repoRoot, producerRoot, root = null, target = 'dependency', manifest = null, manifestPath = null,
}) {
  const layout = orderSourceProvisioningLayout(repoRoot, root);
  const resolved = manifest ?? readProvisioningManifest(repoRoot).manifest;
  const agreement = assertManifestAgreement(resolved);
  if (!agreement.ok) {
    return { ok: false, code: agreement.code, disagreements: agreement.disagreements, manifestPath };
  }
  const produced = verifyProducerRoot(path.resolve(producerRoot), resolved);
  if (!produced.ok) return { ok: false, ...produced };
  const staged = stageGeneration({
    root: layout.root,
    target,
    build: buildOrderSourceGeneration({ producerRoot: path.resolve(producerRoot), manifest: resolved }),
  });
  const activated = activateGeneration({ root: layout.root, staged, target });
  const active = readActiveOrderSourceGeneration(repoRoot, root);
  return {
    ok: true,
    status: activated.published === 'REUSED' ? 'ALREADY_ACTIVE' : 'PROVISIONED',
    generationId: activated.generationId,
    published: activated.published,
    generationPath: activated.generationPath,
    moduleSha256: resolved.moduleSha256,
    closureSha256: produced.closureSha256,
    fileCount: produced.fileCount,
    active,
    pinnedInstall: verifyInstalledTree(layout.installRoot, resolved),
    activeCandidate: ORDER_SOURCE_ACTIVE_RELATIVE,
    contract: ORDER_SOURCE_PROVISIONING_CONTRACT,
  };
}

export function recoverOrderSourceDependency({ repoRoot, root = null, target = 'dependency' }) {
  const layout = orderSourceProvisioningLayout(repoRoot, root);
  const recovered = recoverGenerationStore({ root: layout.root, target });
  const manifest = readProvisioningManifest(repoRoot).manifest;
  return {
    ...recovered,
    active: readActiveOrderSourceGeneration(repoRoot, root),
    // The pinned in-repository tree is the generation a reader falls back to whenever no
    // provisioned generation is active; recovery never mutates it.
    pinnedInstall: verifyInstalledTree(layout.installRoot, manifest),
  };
}

export function cleanupOrderSourceDependency({ repoRoot, root = null }) {
  const layout = orderSourceProvisioningLayout(repoRoot, root);
  const manifest = readProvisioningManifest(repoRoot).manifest;
  return {
    ...cleanupGenerationStore({ root: layout.root }),
    pointerDebris: cleanupPointerDebris({ root: layout.root }),
    active: readActiveOrderSourceGeneration(repoRoot, root),
    pinnedInstall: verifyInstalledTree(layout.installRoot, manifest),
  };
}

export function inspectOrderSourceDependency(repoRoot, root = null) {
  const layout = orderSourceProvisioningLayout(repoRoot, root);
  const manifest = readProvisioningManifest(repoRoot).manifest;
  return {
    contract: ORDER_SOURCE_PROVISIONING_CONTRACT,
    storeContract: GENERATION_STORE_CONTRACT,
    manifestIdentity: canonicalJson({ module: manifest.module, files: manifest.files.length }),
    store: inspectGenerationStore(layout.root),
    active: readActiveOrderSourceGeneration(repoRoot, root),
    pinnedInstall: verifyInstalledTree(layout.installRoot, manifest),
    activeCandidate: ORDER_SOURCE_ACTIVE_RELATIVE,
    pinnedCandidate: `${ORDER_SOURCE_INSTALL_RELATIVE}/${PAN_ORDER_SOURCE_DEPENDENCY.module}`,
    verifiedGeneration: (() => {
      const active = readActiveGeneration({ root: layout.root });
      if (!active.ok) return { ok: false, code: active.code };
      return { ok: true, code: 'OK', files: verifyGenerationManifest(active.generationPath, active.manifest) };
    })(),
  };
}
