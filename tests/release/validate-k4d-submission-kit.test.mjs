import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');
const validator = path.join(root, 'scripts', 'release', 'validate-k4d-submission-kit.mjs');
const fixture = path.join(root, 'tests', 'fixtures', 'release', 'k4d-reviewer-test-cases-v1.json');
const invalidFixture = path.join(root, 'tests', 'fixtures', 'release', 'k4d-reviewer-test-cases-invalid-v1.json');

function run(args) {
  return spawnSync(process.execPath, [validator, ...args], { cwd: root, encoding: 'utf8' });
}

function parse(stdout) {
  const start = stdout.indexOf('{');
  assert.notEqual(start, -1, stdout);
  return JSON.parse(stdout.slice(start));
}

async function variant(mutate, prefix = 'ks77-submission-kit-') {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  const value = JSON.parse(await readFile(fixture, 'utf8'));
  mutate(value);
  const file = path.join(directory, 'fixture.json');
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

function denied(result, pattern) {
  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, pattern);
}

test('accepts the complete receipt-bound directory submission packet', () => {
  const result = run(['--fixture', fixture, '--dry-run']);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const receipt = parse(result.stdout);
  assert.equal(receipt.schemaVersion, 'kaleidosphere/k4d-reviewer-test-cases/v1');
  assert.equal(receipt.packageVersion, '0.26.0');
  assert.equal(receipt.packageDigest, 'a9dfd0e40633c13ab7b04f15bdbfd8d5fa579453717272a9542a87567b13a255');
  assert.equal(receipt.manifestSha256, 'b8a53a99c90b10982ca7cd15291d000291dc6a0e511b6b6ff53b2222741ae42d');
  assert.equal(receipt.positiveCaseCount, 6);
  assert.equal(receipt.negativeCaseCount, 3);
  assert.equal(receipt.publicationPerformed, false);
  assert.equal(receipt.accepted, true);
  assert.equal(receipt.dryRun, true);
});

test('invalid repository fixture confirms its expected rejection in dry-run mode', () => {
  const result = run(['--fixture', invalidFixture, '--dry-run']);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const receipt = parse(result.stdout);
  assert.equal(receipt.accepted, false);
  assert.equal(receipt.publicationPerformed, false);
  assert.equal(receipt.dryRun, true);
  assert.equal(receipt.expectedRejectionObserved, true);
  assert.equal(receipt.rejectionReason, 'reviewer case matrix denied: fewer than five positive cases');

  denied(run(['--fixture', invalidFixture]), /expected validation fixture denied: --dry-run required/);
});

test('rejects too few positive or negative cases and duplicate case IDs', async () => {
  const tooFewPositives = await variant((value) => { value.positiveCases = value.positiveCases.slice(0, 4); });
  denied(run(['--fixture', tooFewPositives, '--dry-run']), /fewer than five positive cases/);

  const tooFew = await variant((value) => { value.negativeCases = value.negativeCases.slice(0, 2); });
  denied(run(['--fixture', tooFew, '--dry-run']), /fewer than three negative cases/);

  const duplicate = await variant((value) => { value.negativeCases[0].id = value.positiveCases[0].id; });
  denied(run(['--fixture', duplicate, '--dry-run']), /duplicate reviewer case id denied/);
});

test('rejects unsupported listing claims', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ks77-submission-listing-'));
  const listing = path.join(directory, 'listing.md');
  const original = await readFile(path.join(root, 'docs/release/k4d-directory-listing.md'), 'utf8');
  await writeFile(listing, `${original}\n- Claim: The marketplace approval is complete.\n`);
  const result = run(['--listing', listing, '--fixture', fixture, '--dry-run']);
  denied(result, /unsupported listing claim denied/);
});

test('case records require explicit reviewer steps and expected outcomes', async () => {
  const missingSteps = await variant((value) => { value.positiveCases[0].reviewerSteps = []; });
  denied(run(['--fixture', missingSteps, '--dry-run']), /reviewer steps denied/);

  const wrongOutcome = await variant((value) => { value.negativeCases[0].expectedResult = 'accepted'; });
  denied(run(['--fixture', wrongOutcome, '--dry-run']), /reviewer case expected result denied/);
});