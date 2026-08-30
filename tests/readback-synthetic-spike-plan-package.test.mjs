import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  BASE_SHA,
  HISTORICAL_PROVENANCE_SHA,
  NO_GO,
  PACKAGE_PATHS,
  RECEIPT_SCHEMA,
  REJECTED_WITH_EVIDENCE,
  evaluateLocalPackage,
  readLocalPackage,
  runLocalReadback,
} from '../scripts/readback-synthetic-spike-plan-package.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../scripts/readback-synthetic-spike-plan-package.mjs', import.meta.url));
const CHECKLIST = new URL('../docs/future/remote-connector/SYNTHETIC_SPIKE_CLOSURE_CHECKLIST.md', import.meta.url);

function runCli(script, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

function alteredPackage(localPackage, path, text) {
  return {
    ...localPackage,
    entries: localPackage.entries.map((entry) => (entry.path === path ? { ...entry, text } : entry)),
  };
}

test('readback binds all 14 current-checkout paths and terminalizes honest NO_GO evidence', async () => {
  const receipt = await runLocalReadback();
  assert.equal(receipt.schemaVersion, RECEIPT_SCHEMA);
  assert.equal(receipt.issue, 92);
  assert.equal(receipt.immutableBaseSha, BASE_SHA);
  assert.equal(receipt.decision.terminalOutcome, REJECTED_WITH_EVIDENCE);
  assert.equal(receipt.decision.executionDecision, NO_GO);
  assert.equal(receipt.decision.owner, 'final issue #92 delivery owner');
  assert.equal(receipt.internalPackageValidation, 'PASS');
  assert.deepEqual(receipt.failureIds, []);
  assert.equal(receipt.packageFiles.length, 14);
  assert.deepEqual(receipt.packageFiles.map(({ path }) => path), PACKAGE_PATHS);
  assert.ok(receipt.packageFiles.every(({ actualSha256 }) => /^sha256:[0-9a-f]{64}$/.test(actualSha256)));
  assert.match(receipt.currentCheckoutBinding.packageDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(receipt.provenance.historicalArtifactHeadSha, HISTORICAL_PROVENANCE_SHA);
  assert.equal(receipt.provenance.requiredToExist, false);
  assert.equal(receipt.provenance.integrationShaClaimed, false);
  assert.equal(receipt.execution.callerAuthoredAuthorityAccepted, false);
  assert.equal(receipt.execution.deploymentOrComplianceReadinessClaimed, false);
});

test('readback receipt and aggregate digest are deterministic for unchanged bytes', async () => {
  const first = await runLocalReadback();
  const second = await runLocalReadback();
  assert.deepEqual(first, second);
  assert.equal(first.currentCheckoutBinding.packageDigest, second.currentCheckoutBinding.packageDigest);
});

test('stale or substituted package bytes fail closed structurally', async () => {
  const localPackage = await readLocalPackage();
  const path = 'docs/future/remote-connector/fixtures/synthetic-connector-fixture-v1.json';
  const entry = localPackage.entries.find((item) => item.path === path);
  const receipt = evaluateLocalPackage(alteredPackage(localPackage, path, `${entry.text}\n`));
  assert.equal(receipt.decision.terminalOutcome, REJECTED_WITH_EVIDENCE);
  assert.equal(receipt.internalPackageValidation, 'FAIL');
  assert.ok(receipt.failureIds.includes(`PACKAGE-${path}`));
});

test('missing package path fails closed and cannot produce a complete binding', async () => {
  const localPackage = await readLocalPackage();
  localPackage.entries = localPackage.entries.slice(1);
  const receipt = evaluateLocalPackage(localPackage);
  assert.equal(receipt.internalPackageValidation, 'FAIL');
  assert.ok(receipt.failureIds.includes('PACKAGE-COMPLETE'));
});

test('CLI accepts no external inputs and rejects unexpected arguments with an evidence receipt', async () => {
  const result = await runCli(SCRIPT, ['--github=https://example.invalid'], ROOT);
  assert.equal(result.code, 1, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.decision.terminalOutcome, REJECTED_WITH_EVIDENCE);
  assert.deepEqual(receipt.failureIds, ['INPUT-ARGS']);
});

test('complete package readback is portable without a .git directory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ks92-no-git-'));
  try {
    for (const path of PACKAGE_PATHS) {
      await mkdir(dirname(join(directory, path)), { recursive: true });
      await cp(join(ROOT, path), join(directory, path));
    }
    const result = await runCli(join(directory, 'scripts/readback-synthetic-spike-plan-package.mjs'), [], directory);
    assert.equal(result.code, 0, result.stderr);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.localOnly.gitHistoryRequired, false);
    assert.equal(receipt.internalPackageValidation, 'PASS');
    assert.equal(receipt.decision.terminalOutcome, REJECTED_WITH_EVIDENCE);
    assert.equal(receipt.decision.executionDecision, NO_GO);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('closure checklist assigns closure-audit scope to the final owner and preserves nonclaims', async () => {
  const checklist = await readFile(CHECKLIST, 'utf8');
  for (const text of [
    'final issue #92 delivery owner',
    'REJECTED_WITH_EVIDENCE',
    'NO_GO',
    'No connector implementation',
    'No production readiness',
    'no controller receipt',
    'no future integration SHA',
  ]) assert.ok(checklist.toLowerCase().includes(text.toLowerCase()), `missing checklist rule: ${text}`);
});
