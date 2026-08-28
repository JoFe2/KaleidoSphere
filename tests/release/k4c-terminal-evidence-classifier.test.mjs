import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');
const classifier = path.join(root, 'scripts/release/k4c-terminal-evidence-classifier.mjs');
const fixture = path.join(root, 'tests/fixtures/release/k4c-evidence-sets-v1.json');
const committedReceipt = path.join(root, 'verification/k4c/terminal-evidence-v1.json');
const schema = path.join(root, 'docs/release/k4c-terminal-evidence-schema-v1.json');
const IDENTITY_RESUME_ACTION = 'Owner resumes in the official portal UI to verify owner authority and publisher identity.';
const CORRECTION_RESUME_ACTION = 'Worker resumes by correcting the denied evidence set before requesting a new bounded classification.';
const ROLLBACK_TEXT = 'Safe rollback when authorized: remove the local cache, or withdraw the draft and publish the corrected successor.';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function run(args) {
  return spawnSync(process.execPath, ['--jitless', classifier, ...args], { cwd: root, encoding: 'utf8' });
}

function parse(stdout) {
  const start = stdout.indexOf('{');
  assert.notEqual(start, -1, stdout);
  return JSON.parse(stdout.slice(start));
}

async function fixtureVariant(mutate, prefix = 'ks76-terminal-fixture-') {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  const value = JSON.parse(await readFile(fixture, 'utf8'));
  mutate(value);
  const file = path.join(directory, 'fixture.json');
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

async function receiptVariant(id, mutate, prefix = `ks76-terminal-${id}-`) {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  const value = JSON.parse(await readFile(fixture, 'utf8'));
  const receiptReference = value.receipts[id];
  const receipt = JSON.parse(await readFile(path.join(root, receiptReference.path), 'utf8'));
  mutate(receipt);
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  const receiptPath = path.join(directory, `${id}.json`);
  await writeFile(receiptPath, receiptBytes);
  value.receipts[id] = { path: receiptPath, sha256: sha256(receiptBytes) };
  const fixturePath = path.join(directory, 'fixture.json');
  await writeFile(fixturePath, `${JSON.stringify(value, null, 2)}\n`);
  return fixturePath;
}

function classify(file) {
  const result = run(['--fixture', file, '--dry-run']);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return parse(result.stdout);
}

function rejected(file) {
  const receipt = classify(file);
  assert.equal(receipt.disposition, 'REJECTED_WITH_EVIDENCE');
  assert.equal(receipt.resumeActions.length, 1);
  assert.equal(receipt.resumeActions[0], CORRECTION_RESUME_ACTION);
  assert.equal(receipt.rollback, ROLLBACK_TEXT);
  assert.deepEqual(receipt.side_effects, []);
  return receipt;
}

test('complete same-digest local, packet, portal, and anonymous receipts classify RELEASED', () => {
  const receipt = classify(fixture);
  assert.equal(receipt.disposition, 'RELEASED');
  assert.equal(receipt.portalOutcome.captured, true);
  assert.equal(receipt.portalOutcome.disposition, 'PRECHECK_READY');
  assert.equal(receipt.portalOutcome.identityStepRecorded, false);
  assert.deepEqual(receipt.resumeActions, []);
  assert.equal(receipt.anonymousProof.complete, true);
  assert.equal(receipt.anonymousProof.discovery, true);
  assert.equal(receipt.anonymousProof.install, true);
  assert.equal(receipt.anonymousProof.publicListingClaim, true);
  assert.equal(receipt.rollback, ROLLBACK_TEXT);
  assert.deepEqual(receipt.side_effects, []);
});

test('portal identity blocker is bounded nonterminal evidence with exactly one literal official UI action', async () => {
  const file = await receiptVariant('portal', (receipt) => {
    receipt.disposition = 'NOT_SUBMITTED';
    receipt.resumeActions = [IDENTITY_RESUME_ACTION];
    receipt.proposal = null;
  });
  const receipt = classify(file);
  assert.equal(receipt.disposition, 'NOT_RELEASED');
  assert.equal(receipt.portalOutcome.captured, false);
  assert.equal(receipt.portalOutcome.disposition, 'NOT_SUBMITTED');
  assert.equal(receipt.portalOutcome.identityStepRecorded, true);
  assert.deepEqual(receipt.resumeActions, [IDENTITY_RESUME_ACTION]);
  assert.equal(receipt.rollback, ROLLBACK_TEXT);
  assert.deepEqual(receipt.side_effects, []);
  assert.equal(receipt.anonymousProof.complete, true);
});

test('missing anonymous discovery or install proof cannot classify RELEASED', async () => {
  const missingAnonymous = rejected(await fixtureVariant((value) => { delete value.receipts.anonymous; }));
  assert.equal(missingAnonymous.evidence[0].code, 'ANONYMOUS_PROOF_REQUIRED');

  const incomplete = rejected(await receiptVariant('anonymous', (receipt) => {
    receipt.evidence.matchingDigestInstall = false;
  }));
  assert.equal(incomplete.evidence[0].code, 'ANONYMOUS_EVIDENCE_INCOMPLETE');
});

test('fails closed for multiple resume actions, waiting labels, credentials, mixed digests, stale cache, and unsupported claims', async () => {
  const multipleActions = rejected(await receiptVariant('portal', (receipt) => {
    receipt.resumeActions = [IDENTITY_RESUME_ACTION, IDENTITY_RESUME_ACTION];
  }));
  assert.equal(multipleActions.evidence[0].code, 'MULTIPLE_RESUME_ACTIONS_DENIED');

  const waiting = rejected(await fixtureVariant((value) => { value.label = 'pending external outcome'; }));
  assert.equal(waiting.evidence[0].code, 'WAITING_STATE_DENIED');

  const rawCredential = rejected(await receiptVariant('anonymous', (receipt) => {
    receipt.boundaryProof.rawCredential = 'do-not-print';
  }));
  assert.equal(rawCredential.evidence[0].code, 'SECRET_CONTENT_DENIED');
  assert.doesNotMatch(JSON.stringify(rawCredential), /do-not-print/);

  const mixedDigest = rejected(await receiptVariant('local', (receipt) => {
    receipt.package.digest = '0'.repeat(64);
  }));
  assert.equal(mixedDigest.evidence[0].code, 'MIXED_DIGEST_DENIED');

  const staleCache = rejected(await receiptVariant('anonymous', (receipt) => {
    receipt.boundaryProof.cachedLocalOnlyDiscovery = true;
  }));
  assert.equal(staleCache.evidence[0].code, 'STALE_CACHE_DENIED');

  const unsupportedClaim = rejected(await fixtureVariant((value) => { value.claim = 'public'; }));
  assert.equal(unsupportedClaim.evidence[0].code, 'UNSUPPORTED_CLAIM_DENIED');
});

test('committed receipt is deterministic, schema is closed, and classifier has no mutation or polling dependency', async () => {
  const receipt = classify(fixture);
  assert.deepEqual(JSON.parse(await readFile(committedReceipt, 'utf8')), receipt);
  const document = JSON.parse(await readFile(schema, 'utf8'));
  assert.equal(document.additionalProperties, false);
  assert.ok(document.required.includes('rollback'));
  assert.ok(document.required.includes('portalOutcome'));
  assert.ok(document.required.includes('anonymousProof'));
  assert.equal(document.properties.side_effects.const.length, 0);
  assert.deepEqual(document.properties.resumeActions.items.enum, [IDENTITY_RESUME_ACTION, CORRECTION_RESUME_ACTION]);
  const source = await readFile(classifier, 'utf8');
  assert.doesNotMatch(source, /node:(?:http|https|net)|fetch\s*\(|node:child_process|spawn\s*\(|execFile\s*\(|setInterval\s*\(/);
});
