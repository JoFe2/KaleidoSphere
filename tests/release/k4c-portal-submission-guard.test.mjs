import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');
const guard = path.join(root, 'scripts/release/k4c-portal-submission-guard.mjs');
const fixture = path.join(root, 'tests/fixtures/release/k4c-portal-capability-v1.json');
const committedReceipt = path.join(root, 'verification/k4c/portal-submission-receipt-v1.json');

function run(args) {
  return spawnSync(process.execPath, ['--jitless', guard, ...args], { cwd: root, encoding: 'utf8' });
}

function parse(stdout) {
  const start = stdout.indexOf('{');
  assert.notEqual(start, -1, stdout);
  return JSON.parse(stdout.slice(start));
}

async function variant(mutate, prefix = 'ks76-portal-guard-') {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  const value = JSON.parse(await readFile(fixture, 'utf8'));
  mutate(value);
  const file = path.join(directory, 'fixture.json');
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

function receiptFor(file) {
  const result = run(['--fixture', file, '--dry-run']);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return parse(result.stdout);
}

function rejected(file) {
  const receipt = receiptFor(file);
  assert.equal(receipt.disposition, 'REJECTED_WITH_EVIDENCE');
  assert.deepEqual(receipt.resumeActions, []);
  assert.equal(receipt.proposal, null);
  return receipt;
}

test('complete same-digest fixture emits a non-executable owner proposal', () => {
  const result = run(['--fixture', fixture, '--dry-run']);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const receipt = parse(result.stdout);
  assert.equal(receipt.disposition, 'PRECHECK_READY');
  assert.equal(receipt.side_effects.length, 0);
  assert.deepEqual(receipt.resumeActions, []);
  assert.equal(receipt.proposal.kind, 'non-executable');
  assert.equal(receipt.proposal.packageDigest, receipt.validatedInputDigests.package.digest);
  assert.equal(receipt.proposal.portalIdentityClass, 'owner-official-ui');
  assert.equal(receipt.proposal.packetDigest, receipt.validatedInputDigests.reviewerPacket.observedSha256);
  assert.doesNotMatch(JSON.stringify(receipt.proposal), /(?:node|npm|curl|wget|https?:\/\/|token|secret|submit|publish|release|listed)/i);
});

test('missing owner authority emits exactly one literal official UI identity resume action', async () => {
  const file = await variant((value) => { value.portal.ownerPortalAuthority = false; });
  const receipt = receiptFor(file);
  assert.equal(receipt.disposition, 'NOT_SUBMITTED');
  assert.equal(receipt.proposal, null);
  assert.deepEqual(receipt.resumeActions, ['Owner resumes in the official portal UI to verify owner authority and publisher identity.']);
  assert.equal(receipt.side_effects.length, 0);
  assert.doesNotMatch(JSON.stringify(receipt), /\b(?:RELEASED|listed|published|submitted successfully)\b/i);
});

test('fails closed for unknown capability, identity mismatch, unverified publisher, and mixed digest', async () => {
  rejected(await variant((value) => { value.portal.capability = 'unknown-capability'; }));
  rejected(await variant((value) => { value.portal.identityClass = 'anonymous'; }));
  const unverified = receiptFor(await variant((value) => { value.portal.verifiedPublisherIdentity = false; }));
  assert.equal(unverified.disposition, 'NOT_SUBMITTED');
  assert.equal(unverified.resumeActions.length, 1);
  const missingPrerequisite = receiptFor(await variant((value) => { delete value.portal.prerequisites.packageDigestConfirmed; }));
  assert.equal(missingPrerequisite.disposition, 'NOT_SUBMITTED');
  assert.equal(missingPrerequisite.resumeActions.length, 1);
  rejected(await variant((value) => { value.package.digest = '0'.repeat(64); }));
});

test('fails closed for secrets, executable or portal instructions, multiple actions, retry semantics, and claims', async () => {
  rejected(await variant((value) => { value.proposal.secret = 'sk-live-1234567890'; }));
  rejected(await variant((value) => { value.proposal.command = ['curl', 'https://portal.invalid/submit']; }));
  rejected(await variant((value) => { value.proposal.instructions = 'Call the portal API'; }));
  rejected(await variant((value) => { value.resumeActions = ['first', 'second']; }));
  rejected(await variant((value) => { value.proposal.instructions = 'retry until submitted'; }));
  rejected(await variant((value) => { value.proposal.claim = 'RELEASED and publicly listed'; }));
});

test('rejects stale input digests and does not expose fixture contents', async () => {
  const file = await variant((value) => { value.securityReceipt.sha256 = '0'.repeat(64); value.proposal.secret = 'do-not-print'; });
  const receipt = rejected(file);
  assert.match(receipt.redactedReason, /stale digest|forbidden field|fixture validation/i);
  assert.doesNotMatch(JSON.stringify(receipt), /do-not-print/);
});

test('committed receipt is deterministic and source-local', async () => {
  const result = run(['--fixture', fixture, '--dry-run']);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(JSON.parse(await readFile(committedReceipt, 'utf8')), parse(result.stdout));
  const source = await readFile(guard, 'utf8');
  assert.doesNotMatch(source, /node:(?:http|https|net)|fetch\s*\(|node:child_process|spawn\s*\(|execFile\s*\(/);
});
