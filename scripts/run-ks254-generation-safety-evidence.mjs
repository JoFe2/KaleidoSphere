#!/usr/bin/env node
/**
 * KS254 (#254) — native crash-safe generation evidence runner.
 *
 * Runs the REAL native entry points (the provisioning CLI and the generation-aware
 * projection/receipt paths) under REAL process interruptions (SIGKILL), records every command
 * with its exit/signal and the observed readback, and writes one evidence document outside
 * the repository. Nothing here grants activation or publication authority: it only reports
 * what the native paths did.
 *
 * Usage:
 *   node scripts/run-ks254-generation-safety-evidence.mjs --out <file.json>
 */
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { readProvisioningManifest, verifyInstalledTree } from '../services/bi-control/src/business-bi/order-source-provisioning.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const RUNNER = path.join(REPO_ROOT, 'tests/helpers/ks254-generation-runner.mjs');
const CLI = path.join(REPO_ROOT, 'scripts/provision-ks238-order-source-dependency.mjs');
const PINNED_PRODUCER = path.join(REPO_ROOT, 'dependencies/pansphaira');

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const out = outIndex === -1 ? null : path.resolve(args[outIndex + 1] ?? '');
if (out === null) {
  process.stderr.write('KS254-EVIDENCE-DENIED pass --out <file.json>\n');
  process.exit(2);
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const records = [];
const roots = [];

const tempRoot = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ks254-evidence-'));
  roots.push(root);
  return root;
};

const record = (entry) => { records.push(entry); return entry; };

const spawnRecorded = ({ what, argv, crash = null }) => {
  const env = { ...process.env };
  if (crash !== null) env.KS254_INTERRUPT_AT = crash;
  else delete env.KS254_INTERRUPT_AT;
  const result = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', cwd: REPO_ROOT, env });
  return record({
    what,
    command: argv.join(' '),
    interruptionPoint: crash,
    exitStatus: result.status,
    signal: result.signal,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
    killedBySignal: result.signal !== null,
  });
};

const jsonOf = (text) => {
  const line = text.trim().split('\n').filter(Boolean).pop();
  try { return JSON.parse(line); } catch { return null; }
};

const pinnedIdentity = () => {
  const { manifest } = readProvisioningManifest(REPO_ROOT);
  const verified = verifyInstalledTree(path.join(REPO_ROOT, 'dependencies/pansphaira'), manifest);
  return { ok: verified.ok, code: verified.code, moduleSha256: verified.moduleDigest, closureSha256: verified.closureSha256, fileCount: verified.fileCount };
};

const pinnedBefore = pinnedIdentity();
const gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
const gitClean = execFileSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim() === '';

// ---------------------------------------------------------------- dependency provisioning
const dependencyTarget = tempRoot();
spawnRecorded({ what: 'dependency provisioning positive', argv: [process.execPath, CLI, '--root', dependencyTarget, '--from', PINNED_PRODUCER] });
spawnRecorded({ what: 'dependency provisioning idempotent re-run', argv: [process.execPath, CLI, '--root', dependencyTarget, '--from', PINNED_PRODUCER] });
spawnRecorded({ what: 'dependency verify', argv: [process.execPath, CLI, '--verify'] });
spawnRecorded({ what: 'dependency inspect', argv: [process.execPath, CLI, '--root', dependencyTarget, '--inspect'] });

const dependencyInterruptions = [];
for (const point of ['dependency:before-staging', 'dependency:during-staging', 'dependency:after-staging', 'dependency:after-generation-publish', 'dependency:after-activation']) {
  const target = tempRoot();
  const killed = spawnRecorded({ what: `dependency provisioning interrupted at ${point}`, argv: [process.execPath, CLI, '--root', target, '--from', PINNED_PRODUCER], crash: point });
  const readback = spawnRecorded({ what: `dependency readback after ${point}`, argv: [process.execPath, RUNNER, 'dependency-readback', '--root', target] });
  dependencyInterruptions.push({
    point,
    killedBySignal: killed.killedBySignal,
    signal: killed.signal,
    readback: jsonOf(readback.stdout ?? ''),
    stagingLeftover: existsSync(path.join(target, '.ks254-staging')) ? readdirSync(path.join(target, '.ks254-staging')).length : 0,
    publishedGenerations: existsSync(path.join(target, '.ks254-generations/generations'))
      ? readdirSync(path.join(target, '.ks254-generations/generations')).length : 0,
  });
}

// RED arm: the pre-fix provisioning order, killed between its two copies.
const legacyDependencyTarget = tempRoot();
const legacyDependencyKilled = spawnRecorded({
  what: 'PRE-FIX dependency provisioning interrupted between the two copies (RED arm)',
  argv: [process.execPath, RUNNER, 'dependency-provision-legacy', '--root', legacyDependencyTarget, '--producer', PINNED_PRODUCER],
  crash: 'legacy-dependency:between-copy-steps',
});
const legacyDependencyReadback = spawnRecorded({
  what: 'PRE-FIX dependency readback (RED arm)',
  argv: [process.execPath, RUNNER, 'dependency-readback-legacy', '--install-root', legacyDependencyTarget],
});

// ------------------------------------------------------------------ projection/receipt
const projectionInterruptions = [];
for (const point of ['projection:before-staging', 'projection:during-staging', 'projection:after-staging', 'projection:after-generation-publish', 'projection:after-activation']) {
  const root = tempRoot();
  spawnRecorded({ what: `projection seed generation a (${point})`, argv: [process.execPath, RUNNER, 'projection', '--root', root, '--generation', 'a'] });
  const killed = spawnRecorded({ what: `projection generation b interrupted at ${point}`, argv: [process.execPath, RUNNER, 'projection', '--root', root, '--generation', 'b', '--crash', point] });
  const readback = spawnRecorded({ what: `generation-bound readback after ${point}`, argv: [process.execPath, RUNNER, 'readback', '--root', root] });
  const legacy = spawnRecorded({ what: `pre-fix readback of the same state after ${point} (RED arm)`, argv: [process.execPath, RUNNER, 'readback-legacy', '--root', root] });
  projectionInterruptions.push({
    point,
    killedBySignal: killed.killedBySignal,
    signal: killed.signal,
    generationBoundReadback: jsonOf(readback.stdout ?? ''),
    preFixReadback: jsonOf(legacy.stdout ?? ''),
    legacyPointerFile: existsSync(path.join(root, 'latest.json'))
      ? JSON.parse(readFileSync(path.join(root, 'latest.json'), 'utf8')).receiptId : null,
  });
}

// RED arm: the pre-fix activation itself, killed between the projection write and the receipt write.
const legacyProjectionRoot = tempRoot();
spawnRecorded({ what: 'projection seed generation a (legacy arm)', argv: [process.execPath, RUNNER, 'projection', '--root', legacyProjectionRoot, '--generation', 'a'] });
const legacyProjectionKilled = spawnRecorded({
  what: 'PRE-FIX projection/receipt activation interrupted after the projection write (RED arm)',
  argv: [process.execPath, RUNNER, 'projection-legacy', '--root', legacyProjectionRoot, '--generation', 'b'],
  crash: 'legacy-projection:after-projection-write',
});
const legacyProjectionReadback = spawnRecorded({ what: 'PRE-FIX readback of that interrupted state (RED arm)', argv: [process.execPath, RUNNER, 'readback-legacy', '--root', legacyProjectionRoot] });
const generationBoundOfLegacyState = spawnRecorded({ what: 'generation-bound readback of the same interrupted state', argv: [process.execPath, RUNNER, 'readback', '--root', legacyProjectionRoot] });

// ------------------------------------------------------------------ recovery and cleanup
const recoveryRoot = tempRoot();
spawnRecorded({ what: 'recovery seed generation a', argv: [process.execPath, RUNNER, 'projection', '--root', recoveryRoot, '--generation', 'a'] });
spawnRecorded({ what: 'recovery: generation b interrupted after staging', argv: [process.execPath, RUNNER, 'projection', '--root', recoveryRoot, '--generation', 'b', '--crash', 'projection:after-staging'] });
const recoveryReadbackBefore = spawnRecorded({ what: 'readback before recovery', argv: [process.execPath, RUNNER, 'readback', '--root', recoveryRoot] });
const recovery = spawnRecorded({ what: 'recovery completes the verified uncommitted staging', argv: [process.execPath, RUNNER, 'recover', '--root', recoveryRoot, '--projection-db', path.join(recoveryRoot, 'analytics.db')] });
const recoveryReadbackAfter = spawnRecorded({ what: 'readback after recovery', argv: [process.execPath, RUNNER, 'readback', '--root', recoveryRoot] });

const discardRoot = tempRoot();
spawnRecorded({ what: 'discard seed generation a', argv: [process.execPath, RUNNER, 'projection', '--root', discardRoot, '--generation', 'a'] });
spawnRecorded({ what: 'discard: generation b interrupted during staging', argv: [process.execPath, RUNNER, 'projection', '--root', discardRoot, '--generation', 'b', '--crash', 'projection:during-staging'] });
const discard = spawnRecorded({ what: 'recovery discards the incomplete owned staging', argv: [process.execPath, RUNNER, 'recover', '--root', discardRoot] });

const cleanupRoot = tempRoot();
writeFileSync(path.join(cleanupRoot, 'unrelated-notes.txt'), 'keep me\n');
spawnRecorded({ what: 'cleanup seed generation a', argv: [process.execPath, RUNNER, 'projection', '--root', cleanupRoot, '--generation', 'a'] });
spawnRecorded({ what: 'cleanup seed generation b', argv: [process.execPath, RUNNER, 'projection', '--root', cleanupRoot, '--generation', 'b'] });
const cleanup = spawnRecorded({ what: 'cleanup removes owned staging and non-active generations', argv: [process.execPath, RUNNER, 'cleanup', '--root', cleanupRoot] });
const cleanupReadback = spawnRecorded({ what: 'readback after cleanup', argv: [process.execPath, RUNNER, 'readback', '--root', cleanupRoot] });

const pinnedAfter = pinnedIdentity();

const document = {
  schemaVersion: 'chimpmaera.bi/ks254-generation-safety-evidence/v1',
  issue: 'JoFe2/KaleidoSphere#254',
  parentEpic: 'JoFe2/KaleidoSphere#252',
  contract: {
    store: 'services/bi-control/src/generation-store.mjs',
    projection: 'services/bi-control/src/projection-generation.mjs',
    dependency: 'services/bi-control/src/business-bi/order-source-provisioning.mjs',
    cli: 'scripts/provision-ks238-order-source-dependency.mjs',
  },
  environment: {
    node: process.version,
    platform: process.platform,
    gitHead,
    worktreeClean: gitClean,
    // Boundaries: neither the Apache Superset runtime nor the bi-control HTTP server is
    // started by this runner.
    supersetRuntimeExecuted: false,
    biControlHttpServerExecuted: false,
    storagePowerLossQualified: false,
  },
  pinnedGeneration: { before: pinnedBefore, after: pinnedAfter, unchanged: sha256(JSON.stringify(pinnedBefore)) === sha256(JSON.stringify(pinnedAfter)) },
  dependencyInterruptions,
  projectionInterruptions,
  redArms: {
    dependency: {
      killed: legacyDependencyKilled.signal,
      installRootVerifies: jsonOf(legacyDependencyReadback.stdout ?? '')?.installVerifies ?? null,
      completeGenerationAvailable: jsonOf(legacyDependencyReadback.stdout ?? '')?.completeGenerationAvailable ?? null,
    },
    projection: {
      killed: legacyProjectionKilled.signal,
      preFixReadback: jsonOf(legacyProjectionReadback.stdout ?? ''),
      generationBoundReadback: jsonOf(generationBoundOfLegacyState.stdout ?? ''),
    },
  },
  recoveryAndCleanup: {
    readbackBefore: jsonOf(recoveryReadbackBefore.stdout ?? ''),
    recovery: jsonOf(recovery.stdout ?? ''),
    readbackAfter: jsonOf(recoveryReadbackAfter.stdout ?? ''),
    discard: jsonOf(discard.stdout ?? ''),
    cleanup: jsonOf(cleanup.stdout ?? ''),
    cleanupReadback: jsonOf(cleanupReadback.stdout ?? ''),
    unrelatedFilePreserved: existsSync(path.join(cleanupRoot, 'unrelated-notes.txt')),
  },
  records,
  nonClaims: [
    'Process-death (SIGKILL) interruption only; storage power loss and fsync durability are NOT qualified.',
    'The Apache Superset runtime and the bi-control HTTP server were not executed in this environment; the Superset-side digest refusal is bound as a source contract.',
    'No publication, activation, merge, release or issue mutation is performed or claimed.',
  ],
};

writeFileSync(out, `${JSON.stringify(document, null, 2)}\n`);
for (const root of roots) rmSync(root, { recursive: true, force: true });
process.stdout.write(`KS254-EVIDENCE-WRITTEN records=${records.length} killedProbes=${dependencyInterruptions.filter((entry) => entry.killedBySignal).length + projectionInterruptions.filter((entry) => entry.killedBySignal).length} out=${out}\n`);
process.stdout.write(`KS254-EVIDENCE-PINNED unchanged=${document.pinnedGeneration.unchanged}\n`);
process.stdout.write(`KS254-EVIDENCE-RED dependencyCompleteGeneration=${document.redArms.dependency.completeGenerationAvailable} projectionMixed=${document.redArms.projection.preFixReadback?.mixed}\n`);
