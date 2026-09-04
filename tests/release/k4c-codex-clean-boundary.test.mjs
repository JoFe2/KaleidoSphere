import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

// Deterministic source-local proof that the clean-boundary Codex E2E executor
// (runClean in scripts/release/k4c-codex-isolated-e2e.mjs) orchestrates the full
// install/discover/use/deny/remove/zero-residue contract when a conformant `codex`
// executable is present. No real Codex binary, network, portal, or live directory
// is used: the harness is driven with an explicit --codex stub path, so this is a
// non-claim about any real Codex CLI, live model response, or public listing.

const root = path.resolve(import.meta.dirname, '..', '..');
const harness = path.join(root, 'scripts', 'release', 'k4c-codex-isolated-e2e.mjs');
const fixture = path.join(root, 'tests', 'fixtures', 'release', 'k4c-codex-cli-transcripts-v1.json');
const WORK_TEMPLATE = 'ks76-clean-stub-';

function parse(stdout) {
  const start = stdout.indexOf('{');
  assert.notEqual(start, -1, stdout);
  return JSON.parse(stdout.slice(start));
}

// The stub binary must be executable, but the temporary directory it lives in may
// be mounted noexec (as /tmp is here). Probe tmpdir first and fall back to the
// repository, which is executable in this and standard CI environments.
async function makeExecWorkDir() {
  const bases = [path.join(os.tmpdir(), WORK_TEMPLATE), path.join(root, `.${WORK_TEMPLATE}`)];
  for (const base of bases) {
    const dir = await mkdtemp(base);
    const probe = path.join(dir, 'probe');
    await writeFile(probe, '#!/bin/sh\necho ok\n');
    await chmod(probe, 0o755);
    const result = spawnSync(probe, [], { encoding: 'utf8' });
    if (result.status === 0) {
      await rm(probe, { force: true });
      return dir;
    }
    await rm(dir, { recursive: true, force: true });
  }
  throw new Error('no executable temporary directory available for the codex stub');
}

async function buildStub(work, failCommand) {
  const source = JSON.parse(await readFile(fixture, 'utf8'));
  const stub = path.join(work, 'codex-stub');
  const configPath = path.join(work, 'stub-config.json');
  const statePath = path.join(work, 'stub-state.json');
  await writeFile(configPath, `${JSON.stringify({
    version: source.codex.version,
    pluginName: source.package.pluginName,
    marketplaceName: source.package.marketplaceName,
    expectedUseResponse: source.package.expectedUseResponse,
    deniedUseResponse: source.package.deniedUseResponse,
  })}\n`);
  await writeFile(statePath, `${JSON.stringify({ installed: {} })}\n`);
  await writeFile(stub, buildStubSource(failCommand));
  await chmod(stub, 0o755);
  return { stub, configPath, statePath };
}

function buildStubSource(failCommand) {
  const fail = JSON.stringify(failCommand);
  return [
    '#!/usr/bin/env node',
    "import { readFileSync, writeFileSync, existsSync } from 'node:fs';",
    `const FAIL = ${fail};`,
    'const config = JSON.parse(readFileSync(process.env.KS76_STUB_CONFIG, \'utf8\'));',
    'const statePath = process.env.KS76_STUB_STATE;',
    'let state = { installed: {} };',
    'if (existsSync(statePath)) { try { state = JSON.parse(readFileSync(statePath, \'utf8\')); } catch { state = { installed: {} }; } }',
    'if (!state || typeof state !== \'object\' || typeof state.installed !== \'object\' || !state.installed) state = { installed: {} };',
    'const save = () => { writeFileSync(statePath, JSON.stringify(state)); };',
    'const argv = process.argv.slice(2);',
    'if (argv.includes(\'--version\')) { process.stdout.write(config.version); process.exit(0); }',
    'const a = argv[0];',
    'const b = argv[1];',
    'const c = argv[2];',
    'if (a === \'plugin\' && b === \'marketplace\' && c === \'add\') { process.stdout.write(\'{}\'); process.exit(0); }',
    'if (a === \'plugin\' && b === \'marketplace\' && c === \'remove\') { process.stdout.write(\'{}\'); process.exit(0); }',
    'if (a === \'plugin\' && b === \'add\') {',
    '  const target = c === undefined ? \'\' : c;',
    '  const at = target.indexOf(\'@\');',
    '  const name = at >= 0 ? target.slice(0, at) : target;',
    '  const market = at >= 0 ? target.slice(at + 1) : \'\';',
    '  if (target === \'\' || at < 0 || market === \'\') { process.stderr.write(\'invalid plugin target\'); process.exit(2); }',
    '  if (FAIL === \'install-plugin\') { process.stderr.write(\'simulated install failure\'); process.exit(1); }',
    '  state.installed[name] = true;',
    '  save();',
    '  process.stdout.write(\'{}\');',
    '  process.exit(0);',
    '}',
    'if (a === \'plugin\' && b === \'remove\') {',
    '  const target = c === undefined ? \'\' : c;',
    '  const at = target.indexOf(\'@\');',
    '  const name = at >= 0 ? target.slice(0, at) : target;',
    '  delete state.installed[name];',
    '  save();',
    '  process.stdout.write(\'{}\');',
    '  process.exit(0);',
    '}',
    'if (a === \'plugin\' && b === \'list\') {',
    '  if (FAIL === \'discover-skill\') { process.stdout.write(JSON.stringify({ plugins: [] })); process.exit(0); }',
    '  const names = Object.keys(state.installed).filter((key) => state.installed[key]);',
    '  process.stdout.write(JSON.stringify({ plugins: names.map((name) => ({ name })) }));',
    '  process.exit(0);',
    '}',
    'if (a === \'exec\') {',
    '  const prompt = argv[argv.length - 1];',
    '  if (typeof prompt === \'string\' && prompt.includes(\'ks76-not-declared\')) { process.stdout.write(config.deniedUseResponse); process.exit(1); }',
    '  if (state.installed[config.pluginName]) { process.stdout.write(config.expectedUseResponse); process.exit(0); }',
    '  process.stdout.write(\'KaleidoSphere: REFUSED_SKILL_NOT_INSTALLED\');',
    '  process.exit(1);',
    '}',
    'process.stderr.write(\'stub: unhandled command\');',
    'process.exit(3);',
    '',
  ].join('\n');
}

function runHarness({ stub, configPath, statePath, boundary, receiptPath }) {
  return spawnSync(process.execPath, [
    harness,
    '--clean-boundary',
    '--codex', stub,
    '--boundary', boundary,
    '--receipt', receiptPath,
    '--fixture', fixture,
  ], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, KS76_STUB_CONFIG: configPath, KS76_STUB_STATE: statePath },
  });
}

test('clean-boundary executor runs the full ordered contract against a conformant stub codex', async () => {
  const work = await makeExecWorkDir();
  const boundary = await mkdtemp(path.join(os.tmpdir(), 'ks76-clean-boundary-'));
  const receiptPath = path.join(os.tmpdir(), 'ks76-clean-receipt-') + Math.random().toString(16).slice(2);
  try {
    const { stub, configPath, statePath } = await buildStub(work, null);
    const result = runHarness({ stub, configPath, statePath, boundary, receiptPath });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const receipt = parse(result.stdout);
    assert.deepEqual(JSON.parse(await readFile(receiptPath, 'utf8')), receipt);

    assert.equal(receipt.schemaVersion, 'kaleidosphere/k4c-codex-isolated-e2e/v1');
    assert.equal(receipt.mode, 'clean-boundary');
    assert.equal(receipt.accepted, true);
    assert.equal(receipt.globalConfigurationMutated, false);
    // The harness invoked the stub path, not a PATH-resolved real codex.
    assert.equal(receipt.codex.binary, stub);
    assert.equal(receipt.package.packageDigest, 'e513393ed4ee72098968be99da34941fd87fc95ea0046c30b73f8378c25d821a');
    assert.equal(receipt.package.manifestSha256, '64494f3a2e993ba476834dd49dfb1a1a60cfe8671b8ab6f08eb5f86045873b77');

    const ids = receipt.orderedCommandResults.map((item) => item.id);
    assert.deepEqual(ids, [
      'generate-package',
      'codex-version',
      'install-marketplace',
      'malformed-install-target-denied',
      'install-plugin',
      'discover-skill',
      'use-declared-skill',
      'use-undeclared-skill-denied',
      'remove-plugin',
      'use-after-removal-denied',
      'remove-marketplace',
      'zero-residue-readback',
    ]);
    const byId = Object.fromEntries(receipt.orderedCommandResults.map((item) => [item.id, item]));
    assert.equal(byId['malformed-install-target-denied'].result.exitCode, 2);
    assert.equal(byId['use-undeclared-skill-denied'].result.exitCode, 1);
    assert.match(byId['use-undeclared-skill-denied'].result.stdout, /REFUSED_UNDECLARED_SKILL/);
    assert.equal(byId['use-after-removal-denied'].result.exitCode, 1);
    assert.match(byId['use-after-removal-denied'].result.stdout, /REFUSED/);
    assert.match(byId['use-declared-skill'].result.stdout, /WAITING_EXTERNAL/);

    const negatives = receipt.negativeAssertions.filter((item) => item.required).map((item) => item.id);
    assert.deepEqual(negatives, [
      'preexisting-profile-residue',
      'absent-skill-discovery',
      'undeclared-skill-invocation',
      'malformed-install-target',
      'successful-use-after-removal',
      'residue-after-cleanup',
    ]);
    assert.ok(receipt.negativeAssertions.every((item) => item.observed === 'denied'));

    assert.equal(receipt.boundaryProof.emptyAfterCleanup, true);
    assert.equal(receipt.boundaryProof.globalConfigurationMutated, false);
    assert.deepEqual(receipt.boundaryProof.residuePaths, []);
    // The boundary (a requested, non-owned path) is emptied by the harness.
    assert.deepEqual(await readdir(boundary), []);
    assert.ok(receipt.nonClaims.length > 0);
  } finally {
    await rm(work, { recursive: true, force: true });
    await rm(boundary, { recursive: true, force: true });
    await rm(receiptPath, { force: true });
  }
});

test('clean-boundary executor fails closed when declared-skill discovery is absent', async () => {
  const work = await makeExecWorkDir();
  const boundary = await mkdtemp(path.join(os.tmpdir(), 'ks76-clean-boundary-fail-'));
  const receiptPath = path.join(os.tmpdir(), 'ks76-clean-receipt-fail-') + Math.random().toString(16).slice(2);
  try {
    const { stub, configPath, statePath } = await buildStub(work, 'discover-skill');
    const result = runHarness({ stub, configPath, statePath, boundary, receiptPath });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    const receipt = parse(result.stdout);
    assert.equal(receipt.mode, 'clean-boundary');
    assert.equal(receipt.accepted, false);
    assert.match(receipt.failure, /absent-skill-discovery denied/);
    // Even on failure the harness cleans the boundary: no residue remains.
    assert.equal(receipt.boundaryProof.emptyAfterCleanup, true);
    assert.deepEqual(await readdir(boundary), []);
  } finally {
    await rm(work, { recursive: true, force: true });
    await rm(boundary, { recursive: true, force: true });
    await rm(receiptPath, { force: true });
  }
});

test('clean-boundary executor fails closed when plugin install is rejected', async () => {
  const work = await makeExecWorkDir();
  const boundary = await mkdtemp(path.join(os.tmpdir(), 'ks76-clean-boundary-install-'));
  const receiptPath = path.join(os.tmpdir(), 'ks76-clean-receipt-install-') + Math.random().toString(16).slice(2);
  try {
    const { stub, configPath, statePath } = await buildStub(work, 'install-plugin');
    const result = runHarness({ stub, configPath, statePath, boundary, receiptPath });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    const receipt = parse(result.stdout);
    assert.equal(receipt.accepted, false);
    assert.match(receipt.failure, /plugin install denied/);
    assert.equal(receipt.boundaryProof.emptyAfterCleanup, true);
    assert.deepEqual(await readdir(boundary), []);
  } finally {
    await rm(work, { recursive: true, force: true });
    await rm(boundary, { recursive: true, force: true });
    await rm(receiptPath, { force: true });
  }
});