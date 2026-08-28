import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');
const harness = path.join(root, 'scripts/release/k4c-anonymous-directory-readback.mjs');
const fixture = path.join(root, 'tests/fixtures/release/k4c-directory-readback-transcripts-v1.json');
const schema = path.join(root, 'docs/release/k4c-anonymous-directory-readback-schema-v1.json');
const committedReceipt = path.join(root, 'verification/k4c/anonymous-directory-readback-v1.json');

function run(args, options = {}) {
  return spawnSync(process.execPath, [harness, ...args], { cwd: root, encoding: 'utf8', ...options });
}

function parse(stdout) {
  const start = stdout.indexOf('{');
  assert.notEqual(start, -1, stdout);
  return JSON.parse(stdout.slice(start));
}

async function fixtureVariant(mutate, prefix = 'ks76-anonymous-fixture-') {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  const value = JSON.parse(await readFile(fixture, 'utf8'));
  mutate(value);
  const file = path.join(directory, 'fixture.json');
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

test('fixture mode proves anonymous exact discovery before matching-digest install and zero residue', () => {
  const result = run(['--fixture', fixture, '--dry-run']);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const receipt = parse(result.stdout);
  assert.equal(receipt.mode, 'fixture');
  assert.equal(receipt.accepted, true);
  assert.equal(receipt.fullReceipt, true);
  assert.equal(receipt.publicListingClaim, true);
  assert.deepEqual(receipt.orderedCommandResults.map((item) => item.id), [
    'anonymous-boundary-preflight',
    'anonymous-directory-discovery',
    'exact-listing-readback',
    'install-matching-package',
    'installed-package-readback',
    'zero-residue-readback',
  ]);
  assert.equal(receipt.evidence.anonymousDiscoveryBeforeInstall, true);
  assert.equal(receipt.evidence.matchingDigestInstall, true);
  assert.equal(receipt.evidence.zeroResidue, true);
  assert.equal(receipt.boundaryProof.temporaryBoundaryRemoved, true);
});

test('committed receipt is the exact deterministic fixture result and schema is closed', async () => {
  const result = run(['--fixture', fixture, '--dry-run']);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(JSON.parse(await readFile(committedReceipt, 'utf8')), parse(result.stdout));
  const document = JSON.parse(await readFile(schema, 'utf8'));
  assert.equal(document.additionalProperties, false);
  assert.ok(document.required.includes('publicListingClaim'));
  assert.ok(document.required.includes('boundaryProof'));
});

test('required negative cases fail closed instead of producing a claim', async () => {
  const mutations = [
    ['authenticated config', (value) => { value.boundary.authenticatedConfig = true; }],
    ['cached local-only discovery', (value) => { value.boundary.cachedLocalOnly = true; }],
    ['title-only mismatch', (value) => { delete value.directory.expectedListing.packageDigest; }],
    ['missing package digest', (value) => { value.package.digest = null; }],
    ['install failure', (value) => { value.orderedCommands[3].result.exitCode = 1; }],
    ['stale anonymous receipt', (value) => { value.timestamps.anonymousReceiptAt = value.timestamps.submissionReceiptAt; }],
  ];
  for (const [label, mutate] of mutations) {
    const file = await fixtureVariant(mutate, `ks76-negative-${label.replaceAll(' ', '-')}-`);
    const result = run(['--fixture', file, '--dry-run']);
    assert.notEqual(result.status, 0, label);
    assert.match(result.stderr, /denied|mismatch|missing|outcome|boundary/i, label);
    assert.doesNotMatch(result.stdout, /"publicListingClaim": true/);
  }
});

test('manual one-shot mode runs argument-array commands without credentials and removes its temporary boundary', async () => {
  const helperDirectory = await mkdtemp(path.join(tmpdir(), 'ks76-directory-helper-'));
  const helper = path.join(helperDirectory, 'directory-helper.mjs');
  await writeFile(helper, `
const digest = '9482367f2c671665651ed1ec55f6aa852bacfc151a36f14eb9807afbf3c185f4';
const target = 'kaleidosphere@0.24.0';
const action = process.argv[2];
if (action === 'discover' || action === 'readback') process.stdout.write(JSON.stringify({listingId:'kaleidosphere',title:'KaleidoSphere',packageName:'kaleidosphere',packageVersion:'0.24.0',packageDigest:digest,source:'anonymous-directory',anonymous:true,authenticated:false,cacheHit:false,networkAccess:true}) + '\\n');
else if (action === 'install') process.stdout.write(JSON.stringify({installed:true,installTarget:target,packageDigest:digest}) + '\\n');
else if (action === 'installed') process.stdout.write(JSON.stringify({installed:true,installTarget:target,packageDigest:digest}) + '\\n');
else process.exitCode = 2;
`);
  const receiptPath = path.join(helperDirectory, 'receipt.json');
  const command = (action) => JSON.stringify([process.execPath, helper, action]);
  const result = run([
    '--manual', '--fixture', fixture, '--receipt', receiptPath,
    '--discover-command', command('discover'),
    '--install-command', command('install'),
    '--readback-command', command('installed'),
  ], { env: { ...process.env, OPENAI_API_KEY: 'must-not-reach-child' } });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const receipt = parse(result.stdout);
  assert.equal(receipt.mode, 'manual');
  assert.equal(receipt.accepted, true);
  assert.equal(receipt.publicListingClaim, true);
  assert.equal(receipt.boundaryProof.credentialFree, true);
  assert.equal(receipt.boundaryProof.temporaryBoundaryRemoved, true);
  assert.equal(receipt.orderedCommandResults[1].id, 'anonymous-directory-discovery');
  assert.equal(receipt.orderedCommandResults[3].id, 'install-matching-package');
  assert.match(await readFile(receiptPath, 'utf8'), /"publicListingClaim": true/);
  assert.doesNotMatch(JSON.stringify(receipt), /must-not-reach-child/);
});

test('manual mode rejects cached or title-only discovery and install failure', async () => {
  const helperDirectory = await mkdtemp(path.join(tmpdir(), 'ks76-directory-negative-helper-'));
  const helper = path.join(helperDirectory, 'directory-helper.mjs');
  await writeFile(helper, `
const digest = '9482367f2c671665651ed1ec55f6aa852bacfc151a36f14eb9807afbf3c185f4';
const action = process.argv[2];
if (action === 'cached') process.stdout.write(JSON.stringify({listingId:'kaleidosphere',title:'KaleidoSphere',packageName:'kaleidosphere',packageVersion:'0.24.0',packageDigest:digest,source:'local-cache',anonymous:false,authenticated:false,cacheHit:true,networkAccess:false}) + '\\n');
else if (action === 'title') process.stdout.write(JSON.stringify({listingId:'kaleidosphere',title:'KaleidoSphere'}) + '\\n');
else if (action === 'fail') process.exitCode = 7;
else process.stdout.write(JSON.stringify({installed:true,installTarget:'kaleidosphere@0.24.0',packageDigest:digest}) + '\\n');
`);
  const command = (action) => JSON.stringify([process.execPath, helper, action]);
  const runManual = (discover, install = 'ok') => run([
    '--manual', '--fixture', fixture, '--receipt', path.join(helperDirectory, `${discover}-${install}.json`),
    '--discover-command', command(discover), '--install-command', command(install), '--readback-command', command('ok'),
  ]);
  const cached = runManual('cached');
  assert.notEqual(cached.status, 0);
  const titleOnly = runManual('title');
  assert.notEqual(titleOnly.status, 0);
  const installFailure = runManual('discover', 'fail');
  assert.notEqual(installFailure.status, 0);
});