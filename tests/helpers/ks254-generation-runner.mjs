// KS254 (#254) probe runner. NOT a test suite: this is the disposable child process the
// generation-safety suite starts, and — for the RED arms — kills, so that an interruption is
// a REAL process death with REAL on-disk consequences rather than a constructed exception.
//
// Modes:
//   projection              candidate: stage + activate a receipt/projection generation
//   projection-legacy       PRE-FIX algorithm (RED arm): projection renamed into the fixed
//                           path first, then the receipt pointers written with plain writes
//   readback                candidate: resolve the ACTIVE generation
//   readback-legacy         PRE-FIX readback (RED arm): read `latest.json` beside the fixed
//                           projection path with no generation binding at all
//   recover                 candidate: complete/discard owned staging
//   cleanup                 candidate: remove non-active generations and staging
//
// Environment:
//   KS254_INTERRUPT_AT  name of the interruption point to die at (SIGKILL, no unwinding)
//
// Every mode prints ONE JSON line on stdout. The suite asserts on that line and on the real
// filesystem/pointer state the killed process left behind.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import process from 'node:process';

import { runAnalyzeProfile } from '../../services/bi-control/src/db-analyzer/workflow.mjs';
import {
  activateProjectionGeneration, buildProjectionDatabase, cleanupProjectionStore,
  readActiveProjectionGeneration, recoverProjectionStore, stageProjectionGeneration,
} from '../../services/bi-control/src/projection-generation.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const args = process.argv.slice(2);
const mode = args[0];
const flag = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? null : (args[index + 1] ?? null);
};
const root = flag('--root');
const generation = flag('--generation') ?? 'a';
const projectionDb = flag('--projection-db') ?? path.join(root ?? '.', 'analytics.db');
const crashAt = flag('--crash');

// The suite drives interruptions explicitly through the shared hook the production code
// itself consults, so the probe dies at exactly the named point of the REAL path.
if (typeof crashAt === 'string' && crashAt.length > 0) process.env.KS254_INTERRUPT_AT = crashAt;

const projectionInterruptionPoint = (name) => {
  if (process.env.KS254_INTERRUPT_AT === name) process.kill(process.pid, 'SIGKILL');
};

const emit = (value) => { process.stdout.write(`${JSON.stringify(value)}\n`); };

// A synthetic-but-real analysis receipt for generation <generation>. The analysis itself is
// the repository's own fixture analysis; only the generation identity here is synthetic.
let cachedAnalysis = null;
async function receiptFor(generationId) {
  cachedAnalysis ??= await runAnalyzeProfile(
    path.join(REPO_ROOT, 'services/bi-control/fixtures/mssql-profile-v1.json'),
    { repositoryRoot: path.join(REPO_ROOT, 'services/bi-control') },
  );
  const analysis = { ...cachedAnalysis, snapshotSha256: generationId.repeat(64) };
  return {
    schemaVersion: 'chimpmaera.bi/analysis-receipt/v1',
    receiptId: `mssql-ks254-${generationId}`,
    status: 'ANALYZED_READ_ONLY',
    analyzedAt: `2026-09-07T0${generationId === 'b' ? 1 : 0}:00:00.000Z`,
    sourceMode: 'fixture',
    engine: 'mssql',
    scope: analysis.profile.scope,
    safety: { queryPackSelectOnly: true, rowSamples: false },
    analysis,
  };
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

if (mode === 'projection') {
  const receipt = await receiptFor(generation);
  const staged = stageProjectionGeneration({ receiptDir: root, receipt });
  const activated = activateProjectionGeneration({ receiptDir: root, staged, projectionDb });
  emit({
    mode, generationId: activated.generationId, published: activated.published,
    receiptId: activated.receipt.receiptId,
    snapshotSha256: activated.receipt.analysis.snapshotSha256,
    projectionSha256: activated.projectionSha256, mirror: activated.mirror,
  });
  process.exit(0);
}

// PRE-FIX projection/receipt activation, replayed verbatim as the RED arm. One artifact is
// renamed into place and the receipt pointer is then written with a plain (non-atomic) write
// beside it; nothing binds the two together.
if (mode === 'projection-legacy') {
  const receipt = await receiptFor(generation);
  mkdirSync(path.dirname(projectionDb), { recursive: true });
  mkdirSync(root, { recursive: true });
  const temporary = `${projectionDb}.${process.pid}.tmp`;
  buildProjectionDatabase(temporary, receipt);
  const projectionSha256 = sha256(readFileSync(temporary));
  receipt.projection = { path: 'analytics.db', sha256: projectionSha256, tables: ['bi_analysis_summary', 'bi_analysis_detail'] };
  renameSync(temporary, projectionDb);
  projectionInterruptionPoint('legacy-projection:after-projection-write');
  const rendered = `${JSON.stringify(receipt, null, 2)}\n`;
  writeFileSync(path.join(root, `${receipt.receiptId}.json`), rendered);
  projectionInterruptionPoint('legacy-projection:after-receipt-write');
  writeFileSync(path.join(root, 'latest.json'), rendered);
  emit({ mode, receiptId: receipt.receiptId, projectionSha256 });
  process.exit(0);
}

if (mode === 'readback') {
  const active = readActiveProjectionGeneration({ receiptDir: root });
  if (!active.ok) { emit({ mode, ok: false, state: active.state, code: active.code }); process.exit(0); }
  emit({
    mode, ok: true, state: active.state, generationId: active.generationId,
    receiptId: active.receipt.receiptId, snapshotSha256: active.receipt.analysis.snapshotSha256,
  });
  process.exit(0);
}

// PRE-FIX readback, replayed verbatim as the RED arm: it reads the receipt pointer file and
// then reports whatever row the fixed projection path happens to hold for that receipt — or
// silently reports a receipt whose snapshot is NOT the snapshot in the projection.
if (mode === 'readback-legacy') {
  let receipt = null;
  try { receipt = JSON.parse(readFileSync(path.join(root, 'latest.json'), 'utf8')); } catch { /* absent */ }
  if (receipt === null) { emit({ mode, ok: false, state: 'ABSENT', code: 'ANALYSIS_RECEIPT_MISSING' }); process.exit(0); }
  const database = new DatabaseSync(projectionDb, { readOnly: true });
  let summary = null;
  try {
    summary = database.prepare('SELECT * FROM bi_analysis_summary WHERE receipt_id=?').get(receipt.receiptId);
  } catch { summary = null; } finally { database.close(); }
  const projectionSnapshotSha256 = summary === null || summary === undefined
    ? null : summary.snapshot_sha256;
  emit({
    mode, ok: true, state: 'ACTIVE', receiptId: receipt.receiptId,
    declaredSnapshotSha256: receipt.analysis.snapshotSha256,
    projectionSnapshotSha256,
    projectionRowPresent: projectionSnapshotSha256 !== null,
    // The pre-fix reader has no generation binding: it reports the receipt the pointer FILE
    // names beside whatever the projection path happens to hold, and it cannot tell that the
    // two are different generations.
    mixed: projectionSnapshotSha256 !== receipt.analysis.snapshotSha256,
  });
  process.exit(0);
}

if (mode === 'recover') {
  const recovered = recoverProjectionStore({ receiptDir: root, projectionDb });
  emit({
    mode, activated: recovered.activated, discarded: recovered.discarded,
    pointer: recovered.store.pointer, activeOk: recovered.active.ok,
    activeGenerationId: recovered.active.generationId ?? null, activeCode: recovered.active.code,
    activeReceiptId: recovered.active.ok ? recovered.active.receipt.receiptId : null,
  });
  process.exit(0);
}

if (mode === 'cleanup') {
  emit({ mode, ...cleanupProjectionStore({ receiptDir: root }) });
  process.exit(0);
}

// The pinned dependency generation and its manifest live in the repository; `--install-root`
// names the tree a reader is asked about (the provisioned target, or a legacy one).
async function dependencyArms() {
  const { orderSourceProvisioningLayout, readProvisioningManifest, verifyInstalledTree, inspectOrderSourceDependency } =
    await import('../../services/bi-control/src/business-bi/order-source-provisioning.mjs');
  const manifest = readProvisioningManifest(REPO_ROOT).manifest;
  return { manifest, layout: orderSourceProvisioningLayout(REPO_ROOT, root), verifyInstalledTree, inspectOrderSourceDependency };
}

// PRE-FIX dependency provisioning, replayed verbatim as the RED arm: the installed generation
// is DELETED first, and the new one is written file-group by file-group afterwards.
if (mode === 'dependency-provision-legacy') {
  const { rmSync, mkdirSync, cpSync } = await import('node:fs');
  const producer = flag('--producer');
  const { PAN_ORDER_SOURCE_DEPENDENCY } = await import('../../services/bi-control/src/business-bi/order-source-consumption.mjs');
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  cpSync(path.join(producer, PAN_ORDER_SOURCE_DEPENDENCY.module), path.join(root, PAN_ORDER_SOURCE_DEPENDENCY.module));
  projectionInterruptionPoint('legacy-dependency:between-copy-steps');
  cpSync(path.join(producer, PAN_ORDER_SOURCE_DEPENDENCY.runtimeClosureRoot),
    path.join(root, PAN_ORDER_SOURCE_DEPENDENCY.runtimeClosureRoot), { recursive: true });
  emit({ mode, installRoot: root, status: 'PROVISIONED_LEGACY' });
  process.exit(0);
}

if (mode === 'dependency-readback') {
  const { manifest, layout, verifyInstalledTree, inspectOrderSourceDependency } = await dependencyArms();
  const store = inspectOrderSourceDependency(REPO_ROOT, root);
  const activeUsable = store.verifiedGeneration.ok;
  const installRoot = flag('--install-root') ?? layout.installRoot;
  const pinned = verifyInstalledTree(installRoot, manifest);
  emit({
    mode, installRoot,
    storePointer: store.store.pointer,
    activeGenerationUsable: activeUsable,
    activeGenerationFiles: activeUsable ? store.verifiedGeneration.files.fileCount : null,
    installVerifies: pinned.ok,
    installCode: pinned.code,
    // A reader always has a COMPLETE generation available: either the active provisioned
    // generation or the pinned in-repository generation.
    completeGenerationAvailable: activeUsable || pinned.ok,
  });
  process.exit(0);
}

if (mode === 'dependency-readback-legacy') {
  const { manifest, verifyInstalledTree } = await dependencyArms();
  const installRoot = flag('--install-root') ?? root;
  const verified = verifyInstalledTree(installRoot, manifest);
  emit({
    mode, installRoot, installVerifies: verified.ok, installCode: verified.code,
    // The pre-fix provisioning order leaves no complete generation at all here.
    completeGenerationAvailable: verified.ok,
  });
  process.exit(0);
}

process.stderr.write(`KS254-RUNNER-DENIED unknown mode ${mode}\n`);
process.exit(2);
