import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');
const harness = path.join(root, 'scripts', 'release', 'k4d-claude-isolated-e2e.mjs');
const fixture = path.join(root, 'tests', 'fixtures', 'release', 'k4d-claude-cli-transcripts-v1.json');
const schema = path.join(root, 'docs', 'release', 'k4d-claude-e2e-schema-v1.json');

function run(args, options = {}) {
  return spawnSync(process.execPath, [harness, ...args], { cwd: root, encoding: 'utf8', ...options });
}

function parse(stdout) {
  const start = stdout.indexOf('{');
  assert.notEqual(start, -1, stdout);
  return JSON.parse(stdout.slice(start));
}

async function temporaryReceipt(prefix = 'ks77-claude-e2e-test-') {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  return path.join(directory, 'receipt.json');
}

test('fixture mode records the complete ordered install/discover/use/deny/remove/readback contract', async () => {
  const receiptPath = await temporaryReceipt();
  const result = run(['--fixture', fixture, '--receipt', receiptPath], {
    env: { ...process.env, PATH: '/definitely-no-claude-on-path' },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const receipt = parse(result.stdout);
  const persisted = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.deepEqual(persisted, receipt);
  assert.equal(receipt.schemaVersion, 'kaleidosphere/k4d-claude-isolated-e2e/v1');
  assert.equal(receipt.mode, 'fixture');
  assert.equal(receipt.claude.binary, 'claude');
  assert.equal(receipt.claude.version, '2.1.259');
  assert.match(receipt.package.packageDigest, /^[a-f0-9]{64}$/);
  assert.equal(receipt.package.manifestSha256, 'b8a53a99c90b10982ca7cd15291d000291dc6a0e511b6b6ff53b2222741ae42d');
  assert.equal(receipt.boundaryProof.clean, true);
  assert.equal(receipt.boundaryProof.emptyAfterCleanup, true);
  assert.equal(receipt.boundaryProof.globalConfigurationMutated, false);
  assert.deepEqual(receipt.orderedCommandResults.map((item) => item.id), [
    'claude-version',
    'install-marketplace',
    'install-plugin',
    'discover-skill',
    'use-declared-skill',
    'use-undeclared-skill-denied',
    'malformed-install-target-denied',
    'remove-plugin',
    'discover-skill-after-removal',
    'use-declared-skill-after-removal-denied',
    'remove-marketplace',
    'marketplace-absent-readback',
    'zero-residue-readback',
  ]);
  const negativeIds = receipt.negativeAssertions.filter((item) => item.required).map((item) => item.id);
  assert.deepEqual(negativeIds, [
    'preexisting-profile-residue',
    'absent-skill-discovery',
    'undeclared-skill-invocation',
    'malformed-install-target',
    'successful-use-after-removal',
    'residue-after-cleanup',
  ]);
  assert.ok(receipt.orderedCommandResults.find((item) => item.id === 'use-undeclared-skill-denied').assertion);
  assert.equal(receipt.globalConfigurationMutated, false);
  assert.equal(receipt.accepted, true);
});

test('fixture mode is hermetic and does not need the claude executable', async () => {
  const result = run(['--fixture', fixture, '--dry-run'], {
    env: { ...process.env, PATH: '' },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(parse(result.stdout).mode, 'fixture');
});

test('required negative cases and explicit negative assertions are fail-closed', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ks77-claude-invalid-fixture-'));
  const invalidFixture = path.join(directory, 'invalid.json');
  const contents = JSON.parse(await readFile(fixture, 'utf8'));
  contents.requiredNegativeCases = contents.requiredNegativeCases.filter((item) => item.id !== 'malformed-install-target');
  await writeFile(invalidFixture, `${JSON.stringify(contents, null, 2)}\n`);
  const result = run(['--fixture', invalidFixture, '--dry-run', '--receipt', path.join(directory, 'receipt.json')]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /required negative assertion denied: malformed-install-target/);
});

test('clean-boundary implementation uses isolated Claude roots and never targets global configuration', async () => {
  const source = await readFile(harness, 'utf8');
  assert.match(source, /CLAUDE_CONFIG_DIR: roots\.config/);
  assert.match(source, /HOME: roots\.home/);
  assert.doesNotMatch(source, /process\.env\.HOME\s*=\s*['"]\//);
  assert.doesNotMatch(source, /CODEX_HOME|XDG_/);
  assert.doesNotMatch(source, /\.codex-plugin/);
  assert.match(source, /\.claude-plugin', 'marketplace\.json'/);
  assert.match(source, /source: '\.\/plugins\/kaleidosphere'/);
  assert.match(source, /if \(owned\) await rm\(boundary, \{ recursive: true, force: true \}\)/);
});

test('--dry-run is only valid with the recorded fixture route', () => {
  const result = run(['--clean-boundary', '--dry-run']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--dry-run is only valid with --fixture/);
});

test('receipt schema is closed and names the required evidence fields', async () => {
  const document = JSON.parse(await readFile(schema, 'utf8'));
  assert.equal(document.additionalProperties, false);
  assert.deepEqual(document.required, [
    'schemaVersion',
    'mode',
    'claude',
    'package',
    'boundaryProof',
    'orderedCommandResults',
    'negativeAssertions',
    'accepted',
    'globalConfigurationMutated',
    'nonClaims',
  ]);
});