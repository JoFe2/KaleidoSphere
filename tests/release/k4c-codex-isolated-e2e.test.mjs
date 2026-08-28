import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');
const harness = path.join(root, 'scripts', 'release', 'k4c-codex-isolated-e2e.mjs');
const fixture = path.join(root, 'tests', 'fixtures', 'release', 'k4c-codex-cli-transcripts-v1.json');
const schema = path.join(root, 'docs', 'release', 'k4c-codex-e2e-schema-v1.json');

function run(args, options = {}) {
  return spawnSync(process.execPath, [harness, ...args], { cwd: root, encoding: 'utf8', ...options });
}

function parse(stdout) {
  const start = stdout.indexOf('{');
  assert.notEqual(start, -1, stdout);
  return JSON.parse(stdout.slice(start));
}

async function temporaryReceipt(prefix = 'ks76-codex-e2e-test-') {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  return path.join(directory, 'receipt.json');
}

test('fixture mode records the complete ordered install/discover/use/deny/remove/readback contract', async () => {
  const receiptPath = await temporaryReceipt();
  const result = run(['--fixture', fixture, '--dry-run', '--receipt', receiptPath], {
    env: { ...process.env, PATH: '/definitely-no-codex-on-path' },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const receipt = parse(result.stdout);
  const persisted = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.deepEqual(persisted, receipt);
  assert.equal(receipt.schemaVersion, 'kaleidosphere/k4c-codex-isolated-e2e/v1');
  assert.equal(receipt.mode, 'fixture');
  assert.equal(receipt.codex.version, 'codex-cli 0.144.1');
  assert.match(receipt.package.packageDigest, /^[a-f0-9]{64}$/);
  assert.equal(receipt.package.manifestSha256, 'beb78cef8fbedb1817fbf3fc61c96177a7e1a7e28b910838b7bf5070eb47fc75');
  assert.equal(receipt.boundaryProof.emptyAfterCleanup, true);
  assert.equal(receipt.boundaryProof.globalConfigurationMutated, false);
  assert.deepEqual(receipt.orderedCommandResults.map((item) => item.id), [
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

test('fixture mode is hermetic and does not need the Codex executable', async () => {
  const receiptPath = await temporaryReceipt('ks76-codex-no-cli-');
  const result = run(['--fixture', fixture, '--dry-run', '--receipt', receiptPath], {
    env: { ...process.env, PATH: '' },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(parse(result.stdout).mode, 'fixture');
});

test('required negative cases and explicit negative assertions are fail-closed', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ks76-codex-invalid-fixture-'));
  const invalidFixture = path.join(directory, 'invalid.json');
  const contents = JSON.parse(await readFile(fixture, 'utf8'));
  contents.requiredNegativeCases = contents.requiredNegativeCases.filter((item) => item.id !== 'malformed-install-target');
  await writeFile(invalidFixture, `${JSON.stringify(contents, null, 2)}\n`);
  const result = run(['--fixture', invalidFixture, '--dry-run', '--receipt', path.join(directory, 'receipt.json')]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /required negative assertion denied: malformed-install-target/);
});

test('clean-boundary implementation uses isolated Codex roots and never targets global configuration', async () => {
  const source = await readFile(harness, 'utf8');
  assert.match(source, /CODEX_HOME/);
  assert.match(source, /XDG_CONFIG_HOME/);
  assert.match(source, /XDG_CACHE_HOME/);
  assert.match(source, /XDG_DATA_HOME/);
  assert.match(source, /ignore-user-config/);
  assert.doesNotMatch(source, /process\.env\.HOME\s*=\s*['"]\//);
});

test('receipt schema is closed and names the required evidence fields', async () => {
  const document = JSON.parse(await readFile(schema, 'utf8'));
  assert.equal(document.additionalProperties, false);
  assert.deepEqual(document.required, [
    'schemaVersion',
    'mode',
    'codex',
    'package',
    'boundaryProof',
    'orderedCommandResults',
    'negativeAssertions',
    'accepted',
    'globalConfigurationMutated',
    'nonClaims',
  ]);
});
