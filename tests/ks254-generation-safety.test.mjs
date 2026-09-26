// KS254 (JoFe2/KaleidoSphere#254) — crash-safe dependency and projection/receipt generations.
//
// AC01 — reproduce interruption during dependency provisioning and before/after the
//        projection/receipt writes against the NATIVE paths.
// AC02 — at each supported crash point a reader sees a complete old or complete new
//        generation; never mixed data/evidence and never a deleted-only dependency state.
// AC03 — exercise recovery and cleanup of OWNED staging paths without deleting the active
//        generation; retain exact source and native readback evidence.
//
// The interruptions below are REAL: the probe child process is killed with SIGKILL at a named
// point of the production path (exit 137), so the assertions observe the genuine on-disk
// state. The RED arms replay the PRE-FIX algorithm verbatim from this suite's probe runner so
// that each claim has a disposable broken counterpart that is actually RED.
//
// Boundary disclosure: this suite drives the native modules and the native provisioning CLI.
// It does NOT start the bi-control HTTP server (it binds a port and requires a control-token
// secret) nor the Apache Superset runtime; the `SUPERSET_PROJECTION_DIGEST_MISMATCH` refusal
// that a lagging projection mirror provokes in `services/superset/runtime/materialize.py` is
// therefore asserted only as a source-level contract, not executed here.
//
// Run: node --test tests/ks254-generation-safety.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  GENERATION_MANIFEST_FILE, OWNED_STAGING_DIRECTORY, OWNED_STORE_DIRECTORY,
  activateGeneration, cleanupGenerationStore, inspectGenerationStore, readActiveGeneration,
  recoverGenerationStore, stageGeneration,
} from '../services/bi-control/src/generation-store.mjs';
import {
  cleanupProjectionStore, projectionMirrorStatus, readActiveProjectionGeneration,
  recoverProjectionStore,
} from '../services/bi-control/src/projection-generation.mjs';
import {
  ORDER_SOURCE_ACTIVE_RELATIVE, ORDER_SOURCE_INSTALL_RELATIVE,
  inspectOrderSourceDependency, readActiveOrderSourceGeneration, readProvisioningManifest,
  verifyInstalledTree,
} from '../services/bi-control/src/business-bi/order-source-provisioning.mjs';
import { resolveOrderSourceHandoffModule } from '../services/bi-control/src/business-bi/order-source-consumption.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const RUNNER = path.join(REPO_ROOT, 'tests/helpers/ks254-generation-runner.mjs');
const PROVISION_CLI = path.join(REPO_ROOT, 'scripts/provision-ks238-order-source-dependency.mjs');
const PINNED_PRODUCER = path.join(REPO_ROOT, 'dependencies/pansphaira');
// The pinned in-repository generation every reader can fall back to. Its identity is a fixed
// property of the repository and must be byte-identical before and after every probe.
const PINNED_MODULE_SHA256 = 'a9b3e0d28133c0f2a2aa2a1b7a630693a50aea993814993c23e3d4c573d2b917';
const PINNED_CLOSURE_SHA256 = 'a4db88ea0b8dc08024992e433d5742fa01a7b24f463d281d3a5beed9fe8dd866';
// spawnSync reports a signal death as { status: null, signal: 'SIGKILL' } — never a 137
// status. The interrupt probes are only real if the child really died on a signal.
const assertKilled = (result, label) => {
  assert.equal(result.signal, 'SIGKILL', `${label}: expected a real SIGKILL process death, got status=${result.status} signal=${result.signal} ${result.stderr ?? ''}`);
  assert.equal(result.status, null, `${label}: a signal death carries no exit status`);
};

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const tempRoots = [];
function tempRoot(prefix = 'ks254-') {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}
test.after(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

function runRunner(args, { crash = null } = {}) {
  const env = { ...process.env };
  if (crash !== null) env.KS254_INTERRUPT_AT = crash;
  else delete env.KS254_INTERRUPT_AT;
  const result = spawnSync(process.execPath, [RUNNER, ...args], { encoding: 'utf8', cwd: REPO_ROOT, env });
  const json = (() => {
    const line = (result.stdout ?? '').trim().split('\n').filter(Boolean).pop();
    try { return JSON.parse(line); } catch { return null; }
  })();
  return { ...result, json };
}

function runProvisionCli(args, { crash = null } = {}) {
  const env = { ...process.env };
  if (crash !== null) env.KS254_INTERRUPT_AT = crash;
  else delete env.KS254_INTERRUPT_AT;
  return spawnSync(process.execPath, [PROVISION_CLI, ...args], { encoding: 'utf8', cwd: REPO_ROOT, env });
}

const pinnedInstallIdentity = () => {
  const { manifest } = readProvisioningManifest(REPO_ROOT);
  const verified = verifyInstalledTree(path.join(REPO_ROOT, ORDER_SOURCE_INSTALL_RELATIVE), manifest);
  return verified;
};

// A projection generation is identified by BOTH its receipt and its snapshot; a reader must
// report exactly one coherent pair.
const readProjectionVerdict = (root) => {
  const active = readActiveProjectionGeneration({ receiptDir: root });
  if (!active.ok) return { ok: false, state: active.state, code: active.code };
  const generationReceipt = active.receipt;
  return {
    ok: true,
    state: active.state,
    generationId: active.generationId,
    receiptId: generationReceipt.receiptId,
    snapshotSha256: generationReceipt.analysis.snapshotSha256,
    declaredProjectionSha256: generationReceipt.projection.sha256,
    // Both artifacts come from the SAME immutable generation directory.
    projectionPathInsideGeneration: path.dirname(active.projectionPath) === active.generationPath,
    receiptPathInsideGeneration: path.dirname(active.receiptPath) === active.generationPath,
    actualProjectionSha256: sha256(readFileSync(active.projectionPath)),
    mirror: projectionMirrorStatus(path.join(root, 'analytics.db'), generationReceipt.projection.sha256),
  };
};

const generationFor = (letter) => ({ receiptId: `mssql-ks254-${letter}`, snapshotSha256: letter.repeat(64) });

// The fixed projection path is a mirror and must always be a COMPLETE, SQLite-readable
// database whose single summary row belongs to exactly one of the two generations.
function fixedProjectionState(projectionDb) {
  if (!existsSync(projectionDb)) return { present: false };
  const database = new DatabaseSync(projectionDb, { readOnly: true });
  try {
    const integrity = database.prepare('PRAGMA integrity_check').get();
    const rows = database.prepare('SELECT receipt_id, snapshot_sha256 FROM bi_analysis_summary').all();
    return {
      present: true,
      integrity: Object.values(integrity)[0],
      rows: rows.map((row) => ({ receiptId: row.receipt_id, snapshotSha256: row.snapshot_sha256 })),
    };
  } finally {
    database.close();
  }
}

const seedGenerationA = (root) => {
  const seeded = runRunner(['projection', '--root', root, '--generation', 'a']);
  assert.equal(seeded.status, 0, seeded.stderr);
  return seeded.json;
};

// ------------------------------------------------------------------ AC01: dependency provisioning

test('KS254 AC01/AC02 dependency provisioning: the native CLI reproduces the pinned generation into an isolated target without mutating the pinned in-repository tree', () => {
  const before = pinnedInstallIdentity();
  assert.equal(before.ok, true, before.code);
  const target = tempRoot('ks254-dep-');
  const result = runProvisionCli(['--root', target, '--from', PINNED_PRODUCER]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^PROVISIONED /);
  assert.match(result.stdout, /status=PROVISIONED /);

  // The active pointer resolves to a COMPLETE generation whose module and runtime closure
  // carry the pinned identities.
  const active = readActiveOrderSourceGeneration(REPO_ROOT, target);
  assert.equal(active.ok, true, active.code);
  assert.equal(sha256(readFileSync(path.join(active.generationPath, 'src/ks238/order-source-handoff.mjs'))), PINNED_MODULE_SHA256);
  const inspected = inspectOrderSourceDependency(REPO_ROOT, target);
  assert.equal(inspected.verifiedGeneration.ok, true);
  assert.equal(inspected.verifiedGeneration.files.fileCount, 157);

  // The pinned in-repository generation was never touched: identical identity before/after.
  const after = pinnedInstallIdentity();
  assert.equal(after.ok, true, after.code);
  assert.equal(after.moduleDigest, PINNED_MODULE_SHA256);
  assert.equal(after.closureSha256, PINNED_CLOSURE_SHA256);

  // Re-provisioning the same generation is idempotent and publishes nothing new.
  const again = runProvisionCli(['--root', target, '--from', PINNED_PRODUCER]);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /status=ALREADY_ACTIVE /);
  assert.equal(readdirSync(path.join(target, OWNED_STAGING_DIRECTORY)).length, 0, 'no staging debris after an idempotent re-provision');
});

test('KS254 AC01/AC02 dependency provisioning: a REAL process death at every supported point still leaves a complete usable generation', () => {
  const points = [
    'dependency:before-staging',
    'dependency:during-staging',
    'dependency:after-staging',
    'dependency:after-generation-publish',
    'dependency:after-activation',
  ];
  const observed = [];
  for (const point of points) {
    const target = tempRoot('ks254-dep-kill-');
    const killed = runProvisionCli(['--root', target, '--from', PINNED_PRODUCER], { crash: point });
    // A genuine process death, not a thrown error: SIGKILL from the probe child.
    assertKilled(killed, point);
    assert.equal(killed.stdout, '', `${point}: a killed provisioning run writes no success report`);

    const verdict = runRunner(['dependency-readback', '--root', target]);
    assert.equal(verdict.status, 0, verdict.stderr);
    const readback = verdict.json;
    // A reader always has a COMPLETE generation: the active provisioned one or the pinned one.
    assert.equal(readback.completeGenerationAvailable, true, `${point}: ${JSON.stringify(readback)}`);
    assert.equal(readback.installVerifies, true, `${point}: the pinned generation stays complete`);
    assert.equal(readback.installCode, 'OK');
    // Never a deleted-only or partial state: the pointer is either absent (the reader falls
    // back to the complete pinned tree) or names a fully verified generation.
    if (readback.storePointer.state !== 'ABSENT') {
      assert.equal(readback.activeGenerationUsable, true, `${point}: an ACTIVE pointer must name a complete generation`);
      assert.equal(readback.activeGenerationFiles, 157);
    }
    const pinned = pinnedInstallIdentity();
    assert.equal(pinned.ok, true, `${point}: pinned tree intact`);
    assert.equal(pinned.moduleDigest, PINNED_MODULE_SHA256);
    observed.push({ point, pointer: readback.storePointer.state, complete: readback.completeGenerationAvailable });
  }
  assert.equal(observed.length, points.length);
});

test('KS254 AC01/AC02 dependency provisioning RED/GREEN: the pre-fix provisioning order leaves no complete generation, the candidate never does', () => {
  // RED arm: the pre-fix algorithm deletes the installed generation and then copies it back
  // in file-group order. Killed between the two copies it leaves a DELETED-ONLY state.
  const legacyRoot = tempRoot('ks254-dep-legacy-');
  const legacyKilled = runRunner(
    ['dependency-provision-legacy', '--root', legacyRoot, '--producer', PINNED_PRODUCER],
    { crash: 'legacy-dependency:between-copy-steps' },
  );
  assertKilled(legacyKilled, 'legacy dependency provisioning');
  // The wrapper is there, the executable runtime closure is not: the dependency is unusable
  // and, because the previous generation was deleted first, nothing complete is left.
  assert.equal(existsSync(path.join(legacyRoot, 'src/ks238/order-source-handoff.mjs')), true);
  assert.equal(existsSync(path.join(legacyRoot, 'dist/packages/contracts/src')), false);
  const legacyVerdict = runRunner(['dependency-readback-legacy', '--install-root', legacyRoot]);
  assert.equal(legacyVerdict.status, 0, legacyVerdict.stderr);
  assert.equal(legacyVerdict.json.completeGenerationAvailable, false, 'PRE-FIX: no complete generation survives');
  assert.equal(legacyVerdict.json.installCode, 'INSTALL_CLOSURE_MISSING');

  // GREEN arm: the same interruption point of the candidate leaves a complete generation.
  const candidateRoot = tempRoot('ks254-dep-candidate-');
  const candidateKilled = runProvisionCli(['--root', candidateRoot, '--from', PINNED_PRODUCER], { crash: 'dependency:during-staging' });
  assertKilled(candidateKilled, 'candidate dependency provisioning');
  const candidateVerdict = runRunner(['dependency-readback', '--root', candidateRoot]);
  assert.equal(candidateVerdict.json.completeGenerationAvailable, true, 'GREEN: a complete generation survives');
  assert.equal(candidateVerdict.json.installVerifies, true);
});

test('KS254 AC02 dependency provisioning: an active pointer is a declared consumer candidate and resolves the pinned bytes', async () => {
  const target = tempRoot('ks254-dep-candidate-');
  const provisioned = runProvisionCli(['--root', target, '--from', PINNED_PRODUCER]);
  assert.equal(provisioned.status, 0, provisioned.stderr);
  const active = readActiveOrderSourceGeneration(REPO_ROOT, target);
  assert.equal(active.ok, true, active.code);
  // The candidate string the consumer resolves through is exactly the one the contract declares.
  assert.equal(ORDER_SOURCE_ACTIVE_RELATIVE, 'dependencies/.ks254-generations/active/src/ks238/order-source-handoff.mjs');
  // Resolved through the pointer path, the module is the pinned bytes and the closure is the
  // pinned closure: an active generation is a first-class identity, not a weaker fallback.
  const resolved = await resolveOrderSourceHandoffModule({ repoRoot: target, explicitPath: active.modulePath });
  assert.equal(resolved.ok, true, resolved.code);
  assert.equal(resolved.moduleSha256, PINNED_MODULE_SHA256);
  const { computeRuntimeClosureSha256 } = await import('../services/bi-control/src/business-bi/order-source-consumption.mjs');
  const closure = computeRuntimeClosureSha256({ moduleFile: active.modulePath });
  assert.equal(closure.ok, true, closure.code);
  assert.equal(closure.closureSha256, PINNED_CLOSURE_SHA256);
  assert.equal(closure.fileCount, 156);
});

// ------------------------------------------------------------------ AC01: projection/receipt

test('KS254 AC01/AC02 projection/receipt: a REAL process death before and after the projection and receipt writes always leaves one COMPLETE generation', () => {
  const points = [
    'projection:before-staging',
    'projection:during-staging',
    'projection:after-staging',
    'projection:after-generation-publish',
    'projection:after-activation',
  ];
  const a = generationFor('a');
  const b = generationFor('b');
  const outcomes = [];
  for (const point of points) {
    const root = tempRoot('ks254-proj-kill-');
    const seeded = seedGenerationA(root);
    assert.equal(seeded.receiptId, a.receiptId);
    const killed = runRunner(['projection', '--root', root, '--generation', 'b', '--crash', point]);
    assertKilled(killed, point);

    const verdict = readProjectionVerdict(root);
    assert.equal(verdict.ok, true, `${point}: a reader must resolve a complete generation: ${JSON.stringify(verdict)}`);
    // Complete OLD or complete NEW — exactly one coherent receipt/snapshot pair.
    const identity = `${verdict.receiptId}|${verdict.snapshotSha256}`;
    assert.ok(identity === `${a.receiptId}|${a.snapshotSha256}` || identity === `${b.receiptId}|${b.snapshotSha256}`,
      `${point}: got ${identity}`);
    // Mixed evidence is not representable: the reader's receipt and its projection are taken
    // from the same immutable generation and the declared digest matches the bytes.
    assert.equal(verdict.projectionPathInsideGeneration, true);
    assert.equal(verdict.receiptPathInsideGeneration, true);
    assert.equal(verdict.declaredProjectionSha256, verdict.actualProjectionSha256, `${point}: declared projection digest binds its own bytes`);

    // The fixed projection mirror is always a complete, SQLite-readable single generation.
    const mirror = fixedProjectionState(path.join(root, 'analytics.db'));
    assert.equal(mirror.present, true, `${point}: the fixed projection path is a complete database`);
    assert.equal(mirror.integrity, 'ok');
    assert.equal(mirror.rows.length, 1);
    assert.ok(
      mirror.rows[0].snapshotSha256 === a.snapshotSha256 || mirror.rows[0].snapshotSha256 === b.snapshotSha256,
      `${point}: mirror row is one of the two complete generations`,
    );
    // The legacy receipt pointer is a COMPLETE receipt of one generation (never truncated).
    const legacyPointer = JSON.parse(readFileSync(path.join(root, 'latest.json'), 'utf8'));
    assert.ok(
      `${legacyPointer.receiptId}|${legacyPointer.analysis.snapshotSha256}` === `${a.receiptId}|${a.snapshotSha256}`
      || `${legacyPointer.receiptId}|${legacyPointer.analysis.snapshotSha256}` === `${b.receiptId}|${b.snapshotSha256}`,
      `${point}: the legacy pointer is complete and belongs to one generation`,
    );
    outcomes.push({ point, identity, mirror: mirror.rows[0].snapshotSha256.slice(0, 1) });
  }
  // The interruptions really do straddle the commit point: at least one leaves the old
  // generation and at least one leaves the new one.
  assert.ok(outcomes.some((entry) => entry.identity.startsWith(a.receiptId)), 'an interruption keeps the complete OLD generation readable');
  assert.ok(outcomes.some((entry) => entry.identity.startsWith(b.receiptId)), 'an interruption after the commit leaves the complete NEW generation readable');
});

test('KS254 AC01/AC02 projection/receipt RED/GREEN: the pre-fix activation+readback mix generations, the generation-bound candidate does not', () => {
  const a = generationFor('a');
  const root = tempRoot('ks254-proj-legacy-');
  seedGenerationA(root);

  // RED arm: the pre-fix algorithm renames the new projection into the fixed path and then
  // writes the receipt pointers separately. Killed between them, the projection path holds
  // generation b while the only receipt pointer still names generation a.
  const killed = runRunner(['projection-legacy', '--root', root, '--generation', 'b'], { crash: 'legacy-projection:after-projection-write' });
  assertKilled(killed, 'legacy projection activation');
  const legacy = runRunner(['readback-legacy', '--root', root]);
  assert.equal(legacy.status, 0, legacy.stderr);
  assert.equal(legacy.json.mixed, true, 'PRE-FIX: the reader mixes the old receipt with the new projection');
  assert.equal(legacy.json.receiptId, a.receiptId);
  assert.equal(legacy.json.declaredSnapshotSha256, a.snapshotSha256);
  assert.equal(legacy.json.projectionRowPresent, false, 'PRE-FIX: the old generation projection was destroyed, not preserved');

  // The same on-disk state read through the generation-bound reader is NOT mixed: it still
  // resolves the complete OLD generation, because the old generation directory is retained.
  const candidate = readProjectionVerdict(root);
  assert.equal(candidate.ok, true, JSON.stringify(candidate));
  assert.equal(candidate.receiptId, a.receiptId);
  assert.equal(candidate.snapshotSha256, a.snapshotSha256);
  assert.equal(candidate.actualProjectionSha256, candidate.declaredProjectionSha256);
});

test('KS254 AC02 projection/receipt: the Superset materializer digest gate refuses a lagging projection mirror instead of binding mixed evidence', () => {
  const root = tempRoot('ks254-proj-mirror-');
  seedGenerationA(root);
  const active = readActiveProjectionGeneration({ receiptDir: root });
  assert.equal(active.ok, true, active.code);
  const declared = active.receipt.projection.sha256;
  // A mirror that lags behind the committed generation is reported as a stale generation,
  // never as an in-sync one.
  const mirrorPath = path.join(root, 'analytics.db');
  writeFileSync(mirrorPath, readFileSync(mirrorPath).subarray(0, 512));
  const stale = projectionMirrorStatus(mirrorPath, declared);
  assert.equal(stale.inSync, false);
  assert.equal(stale.state, 'STALE_GENERATION');
  // The contract the Superset-side materializer enforces against exactly this digest.
  const materialize = readFileSync(path.join(REPO_ROOT, 'services/superset/runtime/materialize.py'), 'utf8');
  assert.match(materialize, /SUPERSET_PROJECTION_DIGEST_MISMATCH/);
  assert.match(materialize, /hashlib\.sha256\(PROJECTION\.read_bytes\(\)\)\.hexdigest\(\) != request\["projectionSha256"\]/);
});

// ------------------------------------------------------------------ AC02: refusal of mixed/incomplete state

test('KS254 AC02 mixed-generation refusal: a tampered, dangling or malformed pointer fails closed and never yields partially trusted bytes', () => {
  const a = generationFor('a');
  const root = tempRoot('ks254-refuse-');
  seedGenerationA(root);
  const storeRoot = path.join(root, OWNED_STORE_DIRECTORY);
  const active = readActiveGeneration({ root });
  assert.equal(active.ok, true, active.code);
  const pointer = path.join(storeRoot, 'active');

  // A declared file removed from the ACTIVE generation directory.
  const receiptFile = path.join(active.generationPath, 'receipt.json');
  const savedReceipt = readFileSync(receiptFile);
  rmSync(receiptFile);
  const missing = readActiveProjectionGeneration({ receiptDir: root });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'GENERATION_INCOMPLETE');
  assert.equal(missing.state, 'INCOMPLETE');
  writeFileSync(receiptFile, savedReceipt);

  // A declared file tampered with: the manifest declaration no longer matches the bytes.
  const projectionFile = path.join(active.generationPath, 'analytics.db');
  const savedProjection = readFileSync(projectionFile);
  writeFileSync(projectionFile, Buffer.concat([savedProjection, Buffer.from('tamper')]));
  const tampered = readActiveProjectionGeneration({ receiptDir: root });
  assert.equal(tampered.ok, false);
  assert.equal(tampered.code, 'GENERATION_INCOMPLETE');
  writeFileSync(projectionFile, savedProjection);

  // A pointer that names a directory outside the published generation set.
  rmSync(pointer);
  const bogus = path.join(storeRoot, 'bogus');
  mkdirSync(bogus, { recursive: true });
  symlinkSync('bogus', pointer);
  const dangling = readActiveGeneration({ root });
  assert.equal(dangling.ok, false);
  assert.equal(dangling.state, 'INVALID');

  rmSync(pointer, { force: true });
  symlinkSync(path.join('generations', 'f'.repeat(64)), pointer);
  const gone = readActiveGeneration({ root });
  assert.equal(gone.ok, false);
  assert.equal(gone.state, 'DANGLING');

  // Restoring the pointer restores the complete generation: no residue of the refusals.
  rmSync(pointer, { force: true });
  symlinkSync(path.join('generations', active.generationId), pointer);
  const restored = readProjectionVerdict(root);
  assert.equal(restored.ok, true, JSON.stringify(restored));
  assert.equal(restored.receiptId, a.receiptId);
});

test('KS254 AC02 mixed-generation refusal: a receipt whose declared projection digest disagrees with its own generation is refused, not merged', () => {
  const root = tempRoot('ks254-refuse-binding-');
  seedGenerationA(root);
  const active = readActiveGeneration({ root });
  assert.equal(active.ok, true, active.code);
  const receiptFile = path.join(active.generationPath, 'receipt.json');
  const receipt = JSON.parse(readFileSync(receiptFile, 'utf8'));
  receipt.projection.sha256 = '0'.repeat(64);
  writeFileSync(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`);
  const verdict = readActiveProjectionGeneration({ receiptDir: root });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.state, 'INCOMPLETE');
  // The manifest declaration catches it first: the receipt bytes themselves changed.
  assert.ok(verdict.code === 'GENERATION_INCOMPLETE' || verdict.code === 'PROJECTION_BINDING_MISMATCH', verdict.code);
});

// ------------------------------------------------------------------ AC03: recovery and cleanup

test('KS254 AC03 recovery: a verified but uncommitted staging is COMPLETED, an incomplete staging is DISCARDED, and a published-but-uncommitted generation never displaces the active one', () => {
  const a = generationFor('a');
  const b = generationFor('b');

  // Interrupted AFTER staging completed but BEFORE the commit: the owned staging directory
  // holds a complete, verified generation and the pointer is still the old one. Recovery
  // completes that activation deterministically.
  const completingRoot = tempRoot('ks254-recover-complete-');
  seedGenerationA(completingRoot);
  const staged = runRunner(['projection', '--root', completingRoot, '--generation', 'b', '--crash', 'projection:after-staging']);
  assertKilled(staged, 'activation interrupted after staging');
  assert.equal(readProjectionVerdict(completingRoot).receiptId, a.receiptId, 'before recovery the complete OLD generation is active');
  assert.equal(readdirSync(path.join(completingRoot, OWNED_STAGING_DIRECTORY)).length, 1, 'the owned staging is left behind by the kill');
  const recovered = recoverProjectionStore({ receiptDir: completingRoot, projectionDb: path.join(completingRoot, 'analytics.db') });
  assert.equal(recovered.activated.length, 1, 'recovery completed exactly the interrupted activation');
  assert.equal(recovered.active.ok, true, recovered.active.code);
  assert.equal(recovered.active.receipt.receiptId, b.receiptId, 'recovery COMPLETES a verified uncommitted staging');
  assert.equal(readdirSync(path.join(completingRoot, OWNED_STAGING_DIRECTORY)).length, 0);
  assert.equal(recovered.mirror.sha256, recovered.active.receipt.projection.sha256, 'recovery re-binds the fixed projection mirror to the completed generation');

  // Interrupted DURING staging: nothing was ever verified, so recovery discards the owned
  // staging and the active generation is untouched.
  const discardingRoot = tempRoot('ks254-recover-discard-');
  seedGenerationA(discardingRoot);
  const partial = runRunner(['projection', '--root', discardingRoot, '--generation', 'b', '--crash', 'projection:during-staging']);
  assertKilled(partial, 'activation interrupted during staging');
  assert.equal(readProjectionVerdict(discardingRoot).receiptId, a.receiptId);
  const second = recoverProjectionStore({ receiptDir: discardingRoot });
  assert.equal(second.active.ok, true, second.active.code);
  assert.equal(second.active.receipt.receiptId, a.receiptId, 'recovery never promotes an unverified staging');
  assert.equal(second.discarded.length, 1);
  assert.equal(readdirSync(path.join(discardingRoot, OWNED_STAGING_DIRECTORY)).length, 0, 'incomplete owned staging was discarded');

  // Interrupted after the generation directory was published but before the commit: no
  // staging is left, so the complete OLD generation stays active — recovery never invents an
  // activation, and the unreferenced generation is removed by cleanup, not by recovery.
  const publishedRoot = tempRoot('ks254-recover-published-');
  seedGenerationA(publishedRoot);
  const published = runRunner(['projection', '--root', publishedRoot, '--generation', 'b', '--crash', 'projection:after-generation-publish']);
  assertKilled(published, 'activation interrupted after publish');
  const afterPublish = recoverProjectionStore({ receiptDir: publishedRoot });
  assert.deepEqual(afterPublish.activated, []);
  assert.equal(afterPublish.active.receipt.receiptId, a.receiptId, 'a published-but-uncommitted generation never displaces the active one');
  const storeNow = inspectGenerationStore(publishedRoot);
  assert.equal(storeNow.generations.length, 2, 'the uncommitted generation directory is retained until an explicit cleanup');
  const cleaned = cleanupProjectionStore({ receiptDir: publishedRoot });
  assert.equal(cleaned.removedGenerations.length, 1, 'cleanup removes exactly the unreferenced generation');
  assert.equal(readProjectionVerdict(publishedRoot).receiptId, a.receiptId);
});

test('KS254 AC03 cleanup: owned staging and non-active generations are removed, the ACTIVE generation and unrelated files are not', () => {
  const root = tempRoot('ks254-cleanup-');
  // Unrelated files beside and inside the provisioning target must survive untouched.
  writeFileSync(path.join(root, 'unrelated-notes.txt'), 'keep me\n');
  mkdirSync(path.join(root, 'unrelated'), { recursive: true });
  writeFileSync(path.join(root, 'unrelated', 'keep.txt'), 'keep me too\n');
  mkdirSync(path.join(root, OWNED_STAGING_DIRECTORY), { recursive: true });
  writeFileSync(path.join(root, OWNED_STAGING_DIRECTORY, 'not-a-staging-name'), 'debris the store does not own\n');

  seedGenerationA(root);
  const activatedB = runRunner(['projection', '--root', root, '--generation', 'b']);
  assert.equal(activatedB.status, 0, activatedB.stderr);
  const activeBefore = readActiveGeneration({ root });
  assert.equal(activeBefore.ok, true, activeBefore.code);
  const generationCountBefore = readdirSync(path.join(root, OWNED_STORE_DIRECTORY, 'generations')).length;
  assert.equal(generationCountBefore, 2, 'both generations are retained before cleanup');

  const cleaned = cleanupProjectionStore({ receiptDir: root });
  assert.equal(cleaned.removedGenerations.length, 1, 'exactly the non-active generation is removed');
  assert.equal(cleaned.activeGenerationId, activeBefore.generationId);
  assert.equal(cleaned.activeFilesVerified, true, 'the active generation still verifies byte-for-byte after cleanup');
  assert.deepEqual(readdirSync(path.join(root, OWNED_STORE_DIRECTORY, 'generations')), [activeBefore.generationId]);

  // The active generation is still fully readable, and the unrelated files are untouched.
  const verdict = readProjectionVerdict(root);
  assert.equal(verdict.ok, true, JSON.stringify(verdict));
  assert.equal(verdict.generationId, activeBefore.generationId);
  assert.equal(readFileSync(path.join(root, 'unrelated-notes.txt'), 'utf8'), 'keep me\n');
  assert.equal(readFileSync(path.join(root, 'unrelated', 'keep.txt'), 'utf8'), 'keep me too\n');
  assert.equal(existsSync(path.join(root, OWNED_STAGING_DIRECTORY, 'not-a-staging-name')), true,
    'cleanup removes only names the store owns');
});

test('KS254 AC03 cleanup refuses to delete anything when the active generation cannot be resolved', () => {
  const root = tempRoot('ks254-cleanup-refuse-');
  seedGenerationA(root);
  const pointer = path.join(root, OWNED_STORE_DIRECTORY, 'active');
  rmSync(pointer);
  assert.throws(() => cleanupGenerationStore({ root }), /GENERATION_CLEANUP_ACTIVE_UNRESOLVED/);
  // Nothing was removed: the published generation directory is still there.
  assert.equal(readdirSync(path.join(root, OWNED_STORE_DIRECTORY, 'generations')).length, 1);
});

test('KS254 AC03 dependency recovery and cleanup through the native CLI never disturb the pinned generation', () => {
  const target = tempRoot('ks254-dep-recover-');
  const provisioned = runProvisionCli(['--root', target, '--from', PINNED_PRODUCER]);
  assert.equal(provisioned.status, 0, provisioned.stderr);
  const activeId = readActiveOrderSourceGeneration(REPO_ROOT, target).generationId;

  // A killed re-provision leaves owned staging behind; recovery completes it deterministically.
  const killed = runProvisionCli(['--root', target, '--from', PINNED_PRODUCER], { crash: 'dependency:after-staging' });
  assertKilled(killed, 'dependency re-provision interrupted after staging');
  const recovered = runProvisionCli(['--root', target, '--recover']);
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.match(recovered.stdout, /^PROVISION-RECOVERED /);

  const cleaned = runProvisionCli(['--root', target, '--cleanup']);
  assert.equal(cleaned.status, 0, cleaned.stderr);
  assert.match(cleaned.stdout, /^PROVISION-CLEANED /);
  assert.match(cleaned.stdout, new RegExp(`active=${activeId.slice(0, 12)}`));
  const afterCleanup = readActiveOrderSourceGeneration(REPO_ROOT, target);
  assert.equal(afterCleanup.ok, true, afterCleanup.code);
  assert.equal(afterCleanup.generationId, activeId, 'cleanup never removes the active generation');
  assert.equal(readdirSync(path.join(target, OWNED_STAGING_DIRECTORY)).length, 0);

  // The pinned in-repository generation is byte-identical after provisioning, recovery and cleanup.
  const pinned = pinnedInstallIdentity();
  assert.equal(pinned.ok, true, pinned.code);
  assert.equal(pinned.moduleDigest, PINNED_MODULE_SHA256);
  assert.equal(pinned.closureSha256, PINNED_CLOSURE_SHA256);
});

// ------------------------------------------------------------------ generation-store primitives

test('KS254 AC02 the shared generation store is content-addressed, idempotent and never publishes a staging directory', () => {
  const root = tempRoot('ks254-store-');
  const build = () => (directory) => {
    const body = Buffer.from('artifact-bytes\n');
    writeFileSync(path.join(directory, 'artifact.bin'), body);
    return { label: 'unit', files: [{ path: 'artifact.bin', sha256: sha256(body) }] };
  };
  const first = stageGeneration({ root, target: 'unit', build: build() });
  assert.equal(existsSync(first.stagingPath), true, 'staging lives in the owned staging directory');
  assert.equal(path.dirname(first.stagingPath), path.join(root, OWNED_STAGING_DIRECTORY));
  assert.deepEqual(readdirSync(path.join(root, OWNED_STORE_DIRECTORY, 'generations')), [], 'staging is not published as a generation');
  const activated = activateGeneration({ root, staged: first, target: 'unit' });
  assert.equal(activated.published, 'PUBLISHED');
  assert.equal(path.basename(activated.generationPath), first.generationId);
  assert.equal(readlinkSync(path.join(root, OWNED_STORE_DIRECTORY, 'active')), path.join('generations', first.generationId));
  const second = activateGeneration({ root, staged: stageGeneration({ root, target: 'unit', build: build() }), target: 'unit' });
  assert.equal(second.generationId, first.generationId, 'identical bytes produce the identical content-addressed generation');
  assert.equal(second.published, 'REUSED');
  const store = inspectGenerationStore(root);
  assert.deepEqual(store.staging, [], 'a re-published identical generation leaves no staging debris');
  assert.equal(store.generations.length, 1);
  assert.equal(store.pointer.state, 'ACTIVE');
});

test('KS254 AC02 a generation whose declared bytes are tampered before publication is never published at all', () => {
  const root = tempRoot('ks254-store-tamper-');
  assert.throws(() => stageGeneration({
    root, target: 'unit',
    build: (directory) => {
      const body = Buffer.from('reported bytes\n');
      writeFileSync(path.join(directory, 'artifact.bin'), Buffer.from('different bytes\n'));
      return { label: 'unit', files: [{ path: 'artifact.bin', sha256: sha256(body) }] };
    },
  }), /GENERATION_INCOMPLETE/);
  // A refused staging is removed and nothing is published.
  assert.equal(readdirSync(path.join(root, OWNED_STAGING_DIRECTORY)).length, 0);
  assert.equal(readActiveGeneration({ root }).state, 'ABSENT');
  assert.equal(inspectGenerationStore(root).generations.length, 0);
});

test('KS254 AC03 a crashed generation build leaves no published generation and no half-written manifest', () => {
  const root = tempRoot('ks254-store-crash-');
  const killed = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { writeFileSync } from 'node:fs';
    import { stageGeneration } from ${JSON.stringify(path.join(REPO_ROOT, 'services/bi-control/src/generation-store.mjs'))};
    stageGeneration({ root: ${JSON.stringify(root)}, target: 'unit', build: (directory) => {
      writeFileSync(directory + '/artifact.bin', 'bytes');
      process.kill(process.pid, 'SIGKILL');
    } });
  `], { encoding: 'utf8', cwd: REPO_ROOT });
  assertKilled(killed, 'in-build crash');
  const store = inspectGenerationStore(root);
  assert.equal(store.generations.length, 0, 'nothing was published');
  assert.equal(store.pointer.state, 'ABSENT');
  assert.equal(store.staging.length, 1, 'the owned staging directory is left for recovery');
  assert.equal(store.staging[0].complete, false);
  assert.equal(existsSync(path.join(root, OWNED_STAGING_DIRECTORY, store.staging[0].stagingName, GENERATION_MANIFEST_FILE)), false);
  const recovered = recoverGenerationStore({ root, target: 'unit' });
  assert.deepEqual(recovered.activated, []);
  assert.equal(recovered.discarded.length, 1);
  assert.equal(inspectGenerationStore(root).staging.length, 0);
});
