import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');
const integration = path.join(root, 'scripts', 'release', 'k4c-local-contract-integration.mjs');
const fixture = path.join(root, 'tests', 'fixtures', 'release', 'k4c-local-contract-integration-v1.json');
const committedReceipt = path.join(root, 'verification', 'k4c', 'local-contract-integration-v1.json');

function run(args, options = {}) {
  return spawnSync(process.execPath, [integration, ...args], { cwd: root, encoding: 'utf8', ...options });
}

function parse(stdout) {
  const start = stdout.indexOf('{');
  assert.notEqual(start, -1, stdout);
  return JSON.parse(stdout.slice(start));
}

async function temporaryReceipt(prefix = 'ks76-local-contract-integration-') {
  return path.join(await mkdtemp(path.join(tmpdir(), prefix)), 'receipt.json');
}

async function fixtureVariant(mutate) {
  const directory = await mkdtemp(path.join(tmpdir(), 'ks76-local-contract-fixture-'));
  const value = JSON.parse(await readFile(fixture, 'utf8'));
  mutate(value);
  const file = path.join(directory, 'fixture.json');
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

test('accepts and deterministically cryptographically binds every local predecessor receipt to one package digest', async () => {
  const firstPath = await temporaryReceipt('ks76-local-contract-first-');
  const secondPath = await temporaryReceipt('ks76-local-contract-second-');
  const first = run(['--fixture', fixture, '--receipt', firstPath]);
  const second = run(['--fixture', fixture, '--receipt', secondPath]);

  assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
  assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
  assert.equal(first.stdout, second.stdout);
  const receipt = parse(first.stdout);
  assert.deepEqual(JSON.parse(await readFile(firstPath, 'utf8')), receipt);
  assert.deepEqual(JSON.parse(await readFile(secondPath, 'utf8')), receipt);

  assert.equal(receipt.schemaVersion, 'kaleidosphere/k4c-local-contract-integration/v1');
  assert.equal(receipt.package.digest, '9482367f2c671665651ed1ec55f6aa852bacfc151a36f14eb9807afbf3c185f4');
  assert.match(receipt.fixtureSha256, /^[a-f0-9]{64}$/);
  assert.match(receipt.bindingDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(receipt.predecessorReceipts.map((item) => item.id), ['codex-isolated-e2e', 'security-license']);
  assert.deepEqual(receipt.predecessorReceipts.map((item) => item.packageDigest), [receipt.package.digest, receipt.package.digest]);
  assert.deepEqual(receipt.predecessorReceipts.map((item) => item.sha256), [
    '1a20208058c9ab4031bc2b8467c09d3f19d4837ea8f3343792f2dffc6fb820b7',
    '44106cffcfa0e245b46923d1e1c0ae6fdb316001a066b1459e832accaba5e165',
  ]);
  assert.equal(receipt.accepted, true);
});

test('the committed bounded receipt is the exact deterministic default result', async () => {
  const result = run(['--fixture', fixture, '--dry-run'], { env: { ...process.env, PATH: '' } });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(JSON.parse(await readFile(committedReceipt, 'utf8')), parse(result.stdout));
});

test('fails closed when a predecessor receipt hash, package digest, or acceptance boundary drifts', async () => {
  const badHash = await fixtureVariant((value) => { value.predecessorReceipts[0].sha256 = '0'.repeat(64); });
  const hashResult = run(['--fixture', badHash, '--dry-run']);
  assert.notEqual(hashResult.status, 0, `${hashResult.stdout}\n${hashResult.stderr}`);
  assert.match(hashResult.stderr, /predecessor receipt digest mismatch denied: security-license/);

  const badPackage = await fixtureVariant((value) => { value.package.digest = '0'.repeat(64); });
  const packageResult = run(['--fixture', badPackage, '--dry-run']);
  assert.notEqual(packageResult.status, 0, `${packageResult.stdout}\n${packageResult.stderr}`);
  assert.match(packageResult.stderr, /package binding denied/);

  const releaseBoundary = await fixtureVariant((value) => { value.executionBoundary.releaseClaimEmitted = true; });
  const boundaryResult = run(['--fixture', releaseBoundary, '--dry-run']);
  assert.notEqual(boundaryResult.status, 0, `${boundaryResult.stdout}\n${boundaryResult.stderr}`);
  assert.match(boundaryResult.stderr, /fixture execution boundary denied: releaseClaimEmitted/);
});

test('integration is source-local: it has no process, network, portal, directory, or release route', async () => {
  const source = await readFile(integration, 'utf8');
  assert.doesNotMatch(source, /node:child_process|node:https|node:http|node:net|fetch\s*\(|spawn\s*\(|execFile\s*\(/);
  const receipt = parse(run(['--fixture', fixture, '--dry-run']).stdout);
  assert.equal(receipt.executionBoundary.localOnly, true);
  assert.equal(receipt.executionBoundary.externalCommandsCalled, false);
  assert.equal(receipt.executionBoundary.portalCalls, false);
  assert.equal(receipt.executionBoundary.directoryCalls, false);
  assert.equal(receipt.executionBoundary.releaseClaimEmitted, false);
  assert.equal(receipt.decision.releaseClaimEmitted, false);
  assert.equal(receipt.decision.bindingDigest, receipt.bindingDigest);
  assert.doesNotMatch(JSON.stringify(receipt), /\b(?:release completed|published|submitted|approved|listed)\b/i);
});
