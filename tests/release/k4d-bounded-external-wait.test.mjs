import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

// Verifies the committed bounded external-wait evidence record: it is reproducible
// byte-for-byte from the digest-verified committed receipts, states the non-terminal
// external-wait state, carries exactly one bounded resume action, and fails closed
// on any drifted receipt. No external state is claimed or mutated.

const root = path.resolve(import.meta.dirname, '..', '..');
const script = path.join(root, 'scripts', 'release', 'k4d-bounded-external-wait.mjs');
const committedRecord = path.join(root, 'docs', 'release', 'k4d-bounded-external-wait-v1.json');
const IDENTITY_RESUME_ACTION = 'Owner resumes in the official Claude Code marketplace UI to verify owner authority and publisher identity before any submission or terms acceptance.';
const ROLLBACK_TEXT = 'Safe rollback when authorized: remove the local marketplace cache, or withdraw the draft and publish the corrected successor.';
const PACKAGE_DIGEST = 'a9dfd0e40633c13ab7b04f15bdbfd8d5fa579453717272a9542a87567b13a255';
const MANIFEST_SHA256 = 'b8a53a99c90b10982ca7cd15291d000291dc6a0e511b6b6ff53b2222741ae42d';
const RECEIPT_FILES = [
  'manifest-validation-receipt-v1.json',
  'skills-only-security-license-receipt-v1.json',
  'claude-isolated-e2e-v1.json',
];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function run(args) {
  return spawnSync(process.execPath, ['--jitless', script, ...args], { cwd: root, encoding: 'utf8' });
}

async function dryRunRecord() {
  const result = run(['--dry-run']);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

test('the committed bounded external-wait record is reproducible byte-for-byte', async () => {
  const result = run(['--dry-run']);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const committed = await readFile(committedRecord, 'utf8');
  assert.equal(result.stdout, committed);
  const record = JSON.parse(committed);
  assert.equal(record.schemaVersion, 'kaleidosphere/k4d-bounded-external-wait/v1');
  assert.equal(record.task.id, 'KS077-CLAUDE-DISTRIBUTION');
});

test('terminal state is the non-terminal external wait with exactly one bounded resume action', async () => {
  const record = await dryRunRecord();
  assert.equal(record.terminalState, 'nonterminal-external-wait');
  assert.equal(record.disposition, 'NOT_RELEASED');
  assert.equal(record.publicListingClaim, false);
  assert.deepEqual(record.package.digest, PACKAGE_DIGEST);
  assert.deepEqual(record.package.manifestSha256, MANIFEST_SHA256);
  assert.equal(record.package.version, '0.26.0');
  assert.deepEqual(record.resumeActions, [IDENTITY_RESUME_ACTION]);
  assert.equal(record.rollback, ROLLBACK_TEXT);
  assert.deepEqual(record.side_effects, []);
  assert.ok(record.nonClaims.length > 0);
  assert.ok(record.externalBoundaries.length === 3);
  assert.ok(record.externalBoundaries.every((boundary) => boundary.satisfied === false));
});

test('every bound receipt digest matches the committed on-disk receipt', async () => {
  const record = await dryRunRecord();
  const entries = [...record.sourceLocalChain, ...record.capabilityDemos];
  assert.equal(entries.length, 3);
  for (const entry of entries) {
    const bytes = await readFile(path.resolve(root, entry.path));
    assert.equal(sha256(bytes), entry.sha256, entry.path);
  }
  assert.ok(record.sourceLocalChain.every((entry) => entry.accepted === true));
  assert.equal(record.sourceLocalChain.find((entry) => entry.key === 'securityLicense').publicationPerformed, false);
  assert.equal(record.sourceLocalChain.find((entry) => entry.key === 'claudeE2e').mode, 'fixture');
  // No capability demos are established on this base; the capability surface is empty.
  assert.deepEqual(record.capabilityDemos, []);
});

test('the record contains no external-state claims, commands, credentials, or flaky labels', async () => {
  const text = await readFile(committedRecord, 'utf8');
  assert.doesNotMatch(text, /https?:\/\//);
  assert.doesNotMatch(text, /\b(curl|wget|npm|bash)\b/);
  assert.doesNotMatch(text, /(sk|pk|rk)-[A-Za-z0-9]{20,}|hf_[A-Za-z0-9]{20,}|BEGIN [A-Z]+ PRIVATE KEY/);
  assert.doesNotMatch(text, /\b(pending|waiting|in[- ]progress)\b/i);
});

test('the script has no network, polling, or mutation dependency', async () => {
  const source = await readFile(script, 'utf8');
  assert.doesNotMatch(source, /node:(?:http|https|net)|fetch\s*\(|node:child_process|spawn\s*\(|execFile\s*\(|setInterval\s*\(/);
});

test('fails closed on a drifted committed receipt', async () => {
  const tmpRoot = await mkdtemp(path.join(tmpdir(), 'ks77-bw-drift-'));
  try {
    const receiptDir = path.join(tmpRoot, 'generated', 'claude', 'receipts');
    await mkdir(receiptDir, { recursive: true });
    for (const file of RECEIPT_FILES) {
      await cp(path.join(root, 'generated', 'claude', 'receipts', file), path.join(receiptDir, file));
    }
    const manifestPath = path.join(receiptDir, 'manifest-validation-receipt-v1.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.accepted = false;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const result = run(['--root', tmpRoot, '--dry-run']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /receipt digest drift denied: manifestValidation/);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});