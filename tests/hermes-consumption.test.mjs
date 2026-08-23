import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const verifier = path.join(root, 'scripts', 'verify-hermes-consumption.mjs');
const canonical = path.join(root, 'agent-skills', 'kaleidosphere');
const canonicalFiles = [
  'SKILL.md',
  'references/contract.json',
  'scripts/validate-request.mjs',
];
const portableReference = 'references/portable-companion-v1.json';
const stagedFiles = [...canonicalFiles, portableReference];
const sourceFiles = [
  'agent-skills/host-contracts.json',
  ...canonicalFiles.map((file) => `agent-skills/kaleidosphere/${file}`),
  'package.json',
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function digestFile(file) {
  return sha256(await readFile(file));
}

function runVerifier(workspace) {
  return spawnSync(process.execPath, [verifier, workspace], { cwd: root, encoding: 'utf8' });
}

async function withWorkspace(prefix, fn) {
  const workspace = await mkdtemp(path.join(tmpdir(), prefix));
  try {
    return await fn(workspace);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

function assertHostPathFree(text, label) {
  assert(!/\/home\//.test(text), `${label}: /home/ path denied`);
  assert(!/\/Users\//.test(text), `${label}: /Users/ path denied`);
  assert(!/[A-Za-z]:[\\/]/.test(text), `${label}: windows path denied`);
  assert(!text.includes('~'), `${label}: tilde path denied`);
  for (const token of text.split(/\s+/)) {
    assert(
      !(token.includes('/') && (token.startsWith('/') || token.startsWith('\\') || token.includes('..'))),
      `${label}: absolute or escaping path denied: ${token}`,
    );
  }
}

async function listStagedFiles(base) {
  const out = [];
  async function walk(prefix) {
    const dir = prefix === '' ? base : path.join(base, prefix);
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix === '' ? entry.name : path.posix.join(prefix, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`symlink denied in staged view: ${relative}`);
      if (entry.isDirectory()) await walk(relative);
      else if (entry.isFile()) out.push(relative);
      else throw new Error(`non-regular path denied in staged view: ${relative}`);
    }
  }
  await walk('');
  return out;
}

function runStagedValidator(stagedRoot, request) {
  return spawnSync(
    process.execPath,
    [path.join(stagedRoot, 'scripts', 'validate-request.mjs')],
    { input: JSON.stringify(request), encoding: 'utf8', cwd: stagedRoot },
  );
}

test('hermes consumption proof stages the generated skill view with exact bytes and digests', async () => {
  await withWorkspace('ks-hermes-proof-1-', async (workspace) => {
    const before = Object.fromEntries(
      await Promise.all(sourceFiles.map(async (file) => [file, await digestFile(path.join(root, file))])),
    );
    const result = runVerifier(workspace);
    assert.equal(result.status, 0, result.stderr);
    assertHostPathFree(result.stdout, 'verifier stdout');
    assert.match(result.stdout, /result ok/);

    const stagedRoot = path.join(workspace, 'hermes', 'skills', 'kaleidosphere');
    const byName = (a, b) => a.localeCompare(b);
    assert.deepEqual(
      [...(await listStagedFiles(stagedRoot))].sort(byName),
      [...stagedFiles].sort(byName),
      'staged file set',
    );
    for (const file of stagedFiles) {
      const staged = path.join(stagedRoot, file);
      const mode = (await stat(staged)).mode;
      assert.equal(mode & 0o111, 0, `executable mode denied: ${file}`);
      const stagedDigest = await digestFile(staged);
      const distView = path.join(workspace, 'dist', 'clawhub', 'kaleidosphere', file);
      assert.equal(stagedDigest, await digestFile(distView), `staged vs generated view: ${file}`);
      if (file !== portableReference) {
        assert.equal(stagedDigest, await digestFile(path.join(canonical, file)), `staged vs canonical: ${file}`);
      }
    }

    const manifest = JSON.parse(await readFile(path.join(workspace, 'dist', 'manifest.json'), 'utf8'));
    assert.equal(
      await digestFile(path.join(stagedRoot, portableReference)),
      manifest.portableReference.sha256,
      'portable reference digest',
    );

    const base = { schemaVersion: 'superset-bi-agent.external/intent-request/v2', requestId: 'ks-75-hermes-test' };
    const allowed = runStagedValidator(stagedRoot, { ...base, action: 'status', input: {} });
    assert.equal(allowed.status, 0, allowed.stderr);
    assert.deepEqual(JSON.parse(allowed.stdout), { valid: true, action: 'status', authority: 'read-only' });

    const widening = runStagedValidator(stagedRoot, { ...base, action: 'apply', input: {} });
    assert.equal(widening.status, 2);
    assert.equal(JSON.parse(widening.stdout).valid, false);

    const smuggling = runStagedValidator(stagedRoot, { ...base, action: 'plan', input: { objective: 'Run SQL', sql: 'select 1' } });
    assert.equal(smuggling.status, 2);
    assert.equal(JSON.parse(smuggling.stdout).valid, false);

    const after = Object.fromEntries(
      await Promise.all(sourceFiles.map(async (file) => [file, await digestFile(path.join(root, file))])),
    );
    assert.deepEqual(after, before, 'zero source mutation');

    const evidenceText = await readFile(path.join(workspace, 'hermes-consumption-proof.json'), 'utf8');
    assertHostPathFree(evidenceText, 'evidence');
    const evidence = JSON.parse(evidenceText);
    assert.equal(evidence.schemaVersion, 'kaleidosphere/hermes-consumption-proof/v1');
    assert.equal(evidence.singleSource, true);
    assert.equal(evidence.layout, 'hermes/skills/kaleidosphere');
    assert.deepEqual(evidence.stagedFiles, stagedFiles);
    assert.equal(evidence.sourceMutation.mutated, 0);
    assert.equal(evidence.validator.probes.at(-1).valid, false);
  });
});

test('hermes consumption proof output is deterministic and host-path free', async () => {
  const first = await withWorkspace('ks-hermes-proof-a-', async (workspace) => {
    const result = runVerifier(workspace);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  });
  const second = await withWorkspace('ks-hermes-proof-b-', async (workspace) => {
    const result = runVerifier(workspace);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  });
  assert.equal(first, second, 'verifier stdout must be deterministic across fresh workspaces');
  assertHostPathFree(first, 'deterministic stdout');
});

test('hermes consumption verifier fails closed on an in-repo workspace', () => {
  const scratch = path.join(root, 'scratch-hermes-workspace');
  const result = runVerifier(scratch);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /workspace must be outside the repository/);
  assert.equal(existsSync(scratch), false, 'workspace must not be created');
});