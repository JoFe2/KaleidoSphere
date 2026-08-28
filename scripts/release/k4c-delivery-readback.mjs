#!/usr/bin/env node
// Deterministic, offline reconciliation of the four committed K4C receipts.
// This is read-only: it never contacts a directory or portal and never performs delivery.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(import.meta.dirname, '..', '..');
const defaultFixture = path.join(root, 'tests', 'fixtures', 'release', 'k4c-delivery-readback-v1.json');
const defaultReceipt = path.join(root, 'verification', 'k4c', 'delivery-readback-v1.json');
const FIXTURE_SCHEMA = 'kaleidosphere/k4c-delivery-readback-fixture/v1';
const RECEIPT_SCHEMA = 'kaleidosphere/k4c-delivery-readback-receipt/v1';
const SHA256 = /^[a-f0-9]{64}$/;
const OWNER_RESUME_ACTION = 'Owner resumes in the official portal UI to verify owner authority and publisher identity.';
const INPUTS = {
  local: {
    path: 'verification/k4c/local-contract-integration-v1.json',
    schemaVersion: 'kaleidosphere/k4c-local-contract-integration/v1',
    provenance: 'local-contract-integration',
  },
  portal: {
    path: 'verification/k4c/portal-submission-receipt-v1.json',
    schemaVersion: 'kaleidosphere/k4c-portal-submission-receipt/v1',
    provenance: 'portal-preflight',
  },
  anonymous: {
    path: 'verification/k4c/anonymous-directory-readback-v1.json',
    schemaVersion: 'kaleidosphere/k4c-anonymous-directory-readback/v1',
    provenance: 'anonymous-directory-readback',
  },
  terminal: {
    path: 'verification/k4c/terminal-evidence-v1.json',
    schemaVersion: 'kaleidosphere/k4c-terminal-evidence-receipt/v1',
    provenance: 'terminal-evidence-classifier',
  },
};
const INPUT_IDS = Object.keys(INPUTS);
const NON_CLAIMS = [
  'No delivery, submission, listing, external issue close, cache removal, public correction, or production readiness is performed or inferred.',
  'This receipt is a deterministic local readback of four committed receipts and creates no external state.',
];
const ROLLBACK = 'Delete the owned script, test, fixture, schema, and verification receipt; external rollback is unnecessary because execution is local and read-only.';

class Denied extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function deny(code, message) {
  throw new Denied(code, message);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertObject(value, label, code = 'SCHEMA_DENIED') {
  if (!isObject(value)) deny(code, `${label} must be an object`);
}

function assertText(value, label, code = 'SCHEMA_DENIED') {
  if (typeof value !== 'string' || value.trim() === '') deny(code, `${label} must be non-empty text`);
}

function assertSha256(value, label, code = 'SCHEMA_DENIED') {
  if (typeof value !== 'string' || !SHA256.test(value)) deny(code, `${label} must be a SHA-256 digest`);
}

function assertExactKeys(value, keys, label, code = 'SCHEMA_DENIED') {
  assertObject(value, label, code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    deny(code, `${label} has an unsupported or missing field`);
  }
}

function parseTimestamp(value, label) {
  assertText(value, label, 'FRESHNESS_DENIED');
  const epoch = Date.parse(value);
  if (Number.isNaN(epoch) || new Date(epoch).toISOString() !== value) deny('FRESHNESS_DENIED', `${label} is not a canonical timestamp`);
  return epoch;
}

function inside(scope, candidate) {
  return candidate === scope || candidate.startsWith(`${scope}${path.sep}`);
}

function resolveScoped(value, label) {
  const resolved = path.resolve(value);
  if (resolved.includes('\0') || (!inside(root, resolved) && !inside(os.tmpdir(), resolved))) {
    throw new Error(`${label} path outside repository or temporary scope denied`);
  }
  return resolved;
}

function labelPath(file) {
  return inside(root, file) ? path.relative(root, file).split(path.sep).join('/') : file;
}

function parseArgs(argv) {
  const args = { fixture: defaultFixture, receipt: defaultReceipt, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (arg === '--fixture' || arg === '--receipt') {
      const value = argv[index += 1];
      if (value === undefined || value.startsWith('-')) throw new Error(`missing value for ${arg}`);
      if (arg === '--fixture') args.fixture = resolveScoped(value, 'fixture');
      else args.receipt = resolveScoped(value, 'receipt');
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

async function readJson(file, label) {
  let bytes;
  try {
    bytes = await readFile(file);
  } catch {
    deny('MISSING_INPUT_DENIED', `${label} is unreadable`);
  }
  try {
    return { bytes, value: JSON.parse(bytes.toString('utf8')) };
  } catch {
    deny('MALFORMED_INPUT_DENIED', `${label} is malformed JSON`);
  }
}

function redact(message) {
  return String(message)
    .replace(/\b(?:sk|ghp|glpat|xox[baprs])-[a-z0-9_-]{8,}\b/gi, '[REDACTED]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED]');
}

function assertNoSecret(value, label = 'input') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecret(item, `${label}[${index}]`));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:raw)?(?:token|secret|password|credential|credentials|apikey|authorization|privatekey|bearer)$/i.test(key.replaceAll('_', ''))) {
      deny('SECRET_CONTENT_DENIED', `${label} contains a secret-like field`);
    }
    assertNoSecret(child, `${label}.${key}`);
  }
}

function validateFreshness(freshness, generatedAt, id, seenNonces) {
  assertExactKeys(freshness, ['issued_at', 'expires_at', 'nonce'], `${id} freshness`, 'FRESHNESS_DENIED');
  const issuedAt = parseTimestamp(freshness.issued_at, `${id} freshness issued_at`);
  const expiresAt = parseTimestamp(freshness.expires_at, `${id} freshness expires_at`);
  assertSha256(freshness.nonce, `${id} freshness nonce`, 'FRESHNESS_DENIED');
  if (issuedAt > generatedAt || generatedAt > expiresAt || expiresAt - issuedAt > 86_400_000 || seenNonces.has(freshness.nonce)) {
    deny('FRESHNESS_DENIED', `${id} freshness is stale, replayed, or invalid`);
  }
  seenNonces.add(freshness.nonce);
  return { issued_at: freshness.issued_at, expires_at: freshness.expires_at, nonce: freshness.nonce };
}

function validateFixture(fixture) {
  assertExactKeys(fixture, ['schemaVersion', 'generated_at', 'task', 'inputs', 'expectedTerminalDisposition', 'nonClaims'], 'fixture', 'FIXTURE_SCHEMA_DENIED');
  if (fixture.schemaVersion !== FIXTURE_SCHEMA) deny('FIXTURE_SCHEMA_DENIED', 'fixture schema version denied');
  const generatedAt = parseTimestamp(fixture.generated_at, 'fixture generated_at');
  assertExactKeys(fixture.task, ['id', 'issue'], 'fixture task', 'TASK_IDENTITY_DENIED');
  assertText(fixture.task.id, 'fixture task id', 'TASK_IDENTITY_DENIED');
  assertText(fixture.task.issue, 'fixture issue id', 'TASK_IDENTITY_DENIED');
  assertExactKeys(fixture.inputs, INPUT_IDS, 'fixture inputs', 'MISSING_INPUT_DENIED');
  if (!['RELEASED', 'NOT_RELEASED', 'REJECTED_WITH_EVIDENCE'].includes(fixture.expectedTerminalDisposition)) {
    deny('UNSUPPORTED_RELEASE_CLAIM_DENIED', 'fixture expected terminal disposition denied');
  }
  if (!Array.isArray(fixture.nonClaims) || fixture.nonClaims.length === 0 || fixture.nonClaims.some((item) => typeof item !== 'string' || item.trim() === '')) {
    deny('FIXTURE_SCHEMA_DENIED', 'fixture non-claims denied');
  }
  const seenNonces = new Set();
  const references = {};
  for (const id of INPUT_IDS) {
    const reference = fixture.inputs[id];
    assertExactKeys(reference, ['path', 'sha256', 'schemaVersion', 'provenance', 'task_id', 'issue_id', 'freshness'], `${id} input`, 'SCHEMA_DENIED');
    const expected = INPUTS[id];
    if (reference.path !== expected.path || reference.schemaVersion !== expected.schemaVersion || reference.provenance !== expected.provenance) {
      deny('PROVENANCE_DENIED', `${id} declared provenance denied`);
    }
    assertSha256(reference.sha256, `${id} input digest`, 'SCHEMA_DENIED');
    if (reference.task_id !== fixture.task.id || reference.issue_id !== fixture.task.issue) {
      deny('TASK_IDENTITY_DENIED', `${id} task or issue binding denied`);
    }
    references[id] = {
      path: reference.path,
      sha256: reference.sha256,
      schemaVersion: reference.schemaVersion,
      provenance: reference.provenance,
      task_id: reference.task_id,
      issue_id: reference.issue_id,
      freshness: validateFreshness(reference.freshness, generatedAt, id, seenNonces),
    };
  }
  return { generatedAt: fixture.generated_at, task: fixture.task, references };
}

function packageDigest(value, label) {
  assertSha256(value, `${label} package digest`, 'MIXED_DIGEST_DENIED');
  return value;
}

function validateLocal(receipt) {
  assertExactKeys(receipt, ['schemaVersion', 'fixture', 'fixtureSha256', 'package', 'predecessorReceipts', 'bindingDigest', 'decision', 'executionBoundary', 'accepted', 'nonClaims'], 'local receipt');
  if (receipt.schemaVersion !== INPUTS.local.schemaVersion || receipt.accepted !== true) deny('SCHEMA_DENIED', 'local receipt schema or acceptance denied');
  assertExactKeys(receipt.package, ['version', 'digest', 'manifestSha256'], 'local receipt package');
  assertExactKeys(receipt.decision, ['outcome', 'scope', 'packageDigest', 'bindingDigest', 'releaseClaimEmitted'], 'local receipt decision');
  assertExactKeys(receipt.executionBoundary, ['localOnly', 'externalCommandsCalled', 'portalCalls', 'directoryCalls', 'releaseClaimEmitted'], 'local receipt boundary');
  if (receipt.decision.outcome !== 'accepted' || receipt.decision.scope !== 'local-contract-integration' || receipt.decision.releaseClaimEmitted !== false
    || receipt.executionBoundary.localOnly !== true || receipt.executionBoundary.externalCommandsCalled !== false || receipt.executionBoundary.portalCalls !== false || receipt.executionBoundary.directoryCalls !== false || receipt.executionBoundary.releaseClaimEmitted !== false) {
    deny('SCHEMA_DENIED', 'local receipt decision or boundary denied');
  }
  const digest = packageDigest(receipt.package.digest, 'local receipt');
  if (receipt.decision.packageDigest !== digest || receipt.bindingDigest !== receipt.decision.bindingDigest) deny('MIXED_DIGEST_DENIED', 'local receipt digest binding denied');
  return { digest, manifestSha256: receipt.package.manifestSha256 };
}

function validatePortal(receipt) {
  assertExactKeys(receipt, ['schemaVersion', 'fixture', 'fixtureSha256', 'validatedInputDigests', 'portal', 'disposition', 'redactedReason', 'evidence', 'side_effects', 'resumeActions', 'proposal', 'nonClaims'], 'portal receipt');
  if (receipt.schemaVersion !== INPUTS.portal.schemaVersion || !Array.isArray(receipt.side_effects) || receipt.side_effects.length !== 0 || !Array.isArray(receipt.resumeActions)) {
    deny('SCHEMA_DENIED', 'portal receipt schema or boundary denied');
  }
  const pkg = receipt.validatedInputDigests?.package;
  assertExactKeys(pkg, ['version', 'digest', 'manifestSha256'], 'portal receipt package');
  const digest = packageDigest(pkg.digest, 'portal receipt');
  if (!['PRECHECK_READY', 'NOT_SUBMITTED'].includes(receipt.disposition)) deny('UNSUPPORTED_RELEASE_CLAIM_DENIED', 'portal disposition denied');
  if (receipt.disposition === 'PRECHECK_READY') {
    if (receipt.resumeActions.length !== 0 || !isObject(receipt.proposal) || receipt.proposal.packageDigest !== digest) deny('SCHEMA_DENIED', 'portal precheck state denied');
  } else if (receipt.resumeActions.length !== 1 || receipt.resumeActions[0] !== OWNER_RESUME_ACTION || receipt.proposal !== null) {
    deny('MULTIPLE_RESUME_ACTIONS_DENIED', 'portal owner-resume state denied');
  }
  return { digest, disposition: receipt.disposition };
}

function validateAnonymous(receipt, freshness) {
  assertExactKeys(receipt, ['schemaVersion', 'mode', 'fixture', 'fixtureSha256', 'package', 'directory', 'timestamps', 'boundaryProof', 'orderedCommandResults', 'negativeAssertions', 'evidence', 'accepted', 'fullReceipt', 'publicListingClaim', 'nonClaims'], 'anonymous receipt');
  if (receipt.schemaVersion !== INPUTS.anonymous.schemaVersion || receipt.accepted !== true || receipt.fullReceipt !== true || receipt.publicListingClaim !== true) {
    deny('SCHEMA_DENIED', 'anonymous receipt schema or acceptance denied');
  }
  const digest = packageDigest(receipt.package?.digest, 'anonymous receipt');
  const boundary = receipt.boundaryProof;
  assertObject(boundary, 'anonymous receipt boundary');
  if (boundary.credentialFree !== true || boundary.authenticatedConfigDetected !== false || boundary.cachedLocalOnlyDiscovery !== false || boundary.cleanBeforeDiscovery !== true || boundary.emptyAfterCleanup !== true || boundary.temporaryBoundaryRemoved !== true || !Array.isArray(boundary.residuePaths) || boundary.residuePaths.length !== 0) {
    deny('ANONYMOUS_BOUNDARY_DENIED', 'anonymous cache or authenticated substitution denied');
  }
  const evidence = receipt.evidence;
  assertObject(evidence, 'anonymous receipt evidence');
  for (const key of ['anonymousDiscoveryBeforeInstall', 'exactListingReadback', 'matchingDigestInstall', 'installedDigestReadback', 'freshTimestamps', 'zeroResidue']) {
    if (evidence[key] !== true) deny('ANONYMOUS_PROOF_DENIED', 'anonymous discovery/install proof denied');
  }
  const timestamps = receipt.timestamps;
  assertObject(timestamps, 'anonymous receipt timestamps');
  const submitted = parseTimestamp(timestamps.submissionReceiptAt, 'anonymous submissionReceiptAt');
  const recorded = parseTimestamp(timestamps.anonymousReceiptAt, 'anonymous anonymousReceiptAt');
  const issued = parseTimestamp(freshness.issued_at, 'anonymous freshness issued_at');
  const expires = parseTimestamp(freshness.expires_at, 'anonymous freshness expires_at');
  if (recorded <= submitted || recorded < issued || recorded > expires) deny('FRESHNESS_DENIED', 'anonymous receipt freshness denied');
  if (!Array.isArray(receipt.orderedCommandResults) || receipt.orderedCommandResults.length !== 6) deny('ANONYMOUS_PROOF_DENIED', 'anonymous command set denied');
  const expectedIds = ['anonymous-boundary-preflight', 'anonymous-directory-discovery', 'exact-listing-readback', 'install-matching-package', 'installed-package-readback', 'zero-residue-readback'];
  for (const [index, id] of expectedIds.entries()) {
    const command = receipt.orderedCommandResults[index];
    if (!isObject(command) || command.order !== index + 1 || command.id !== id || command.result?.exitCode !== 0 || command.result?.signal !== null) {
      deny('ANONYMOUS_PROOF_DENIED', 'anonymous command sequence denied');
    }
  }
  return { digest };
}

function validateTerminal(receipt, actualDigests) {
  assertExactKeys(receipt, ['schemaVersion', 'fixture', 'fixtureSha256', 'package', 'validatedInputDigests', 'portalOutcome', 'anonymousProof', 'disposition', 'reason', 'evidence', 'resumeActions', 'rollback', 'side_effects', 'nonClaims'], 'terminal receipt');
  if (receipt.schemaVersion !== INPUTS.terminal.schemaVersion || !['RELEASED', 'NOT_RELEASED', 'REJECTED_WITH_EVIDENCE'].includes(receipt.disposition)
    || !Array.isArray(receipt.resumeActions) || !Array.isArray(receipt.side_effects) || receipt.side_effects.length !== 0) {
    deny('SCHEMA_DENIED', 'terminal receipt schema or state denied');
  }
  const digest = packageDigest(receipt.package?.digest, 'terminal receipt');
  for (const id of ['local', 'portal', 'anonymous']) {
    const reference = receipt.validatedInputDigests?.[id];
    if (!isObject(reference) || reference.observedSha256 !== actualDigests[id] || reference.expectedSha256 !== actualDigests[id]) {
      deny('STALE_DIGEST_DENIED', `terminal ${id} digest binding denied`);
    }
  }
  if (receipt.disposition === 'RELEASED' && receipt.resumeActions.length !== 0) deny('MULTIPLE_RESUME_ACTIONS_DENIED', 'released terminal action denied');
  if (receipt.disposition === 'NOT_RELEASED' && (receipt.resumeActions.length !== 1 || receipt.resumeActions[0] !== OWNER_RESUME_ACTION)) deny('MULTIPLE_RESUME_ACTIONS_DENIED', 'nonterminal terminal action denied');
  if (receipt.disposition === 'REJECTED_WITH_EVIDENCE' && receipt.resumeActions.length !== 0) deny('MULTIPLE_RESUME_ACTIONS_DENIED', 'rejected terminal action denied');
  return { digest, disposition: receipt.disposition };
}

export function classify(terminal, portal) {
  if (terminal.disposition === 'NOT_RELEASED' && portal.disposition === 'NOT_SUBMITTED') {
    return { disposition: 'NOT_RELEASED', reason: 'owner portal authority remains the single external prerequisite', resumeActions: [OWNER_RESUME_ACTION] };
  }
  if (terminal.disposition === 'RELEASED' && portal.disposition === 'PRECHECK_READY') {
    return { disposition: 'RELEASED', reason: 'upstream terminal classifier is RELEASED and fresh anonymous discovery plus install prove the same digest', resumeActions: [] };
  }
  if (terminal.disposition === 'REJECTED_WITH_EVIDENCE') {
    return { disposition: 'REJECTED_WITH_EVIDENCE', reason: 'upstream terminal classifier rejected the bounded evidence set', resumeActions: [] };
  }
  deny('CLASSIFIER_READBACK_DISAGREEMENT_DENIED', 'terminal classifier and readback state disagree');
}

function bindingDigest(task, inputDigests) {
  return sha256(JSON.stringify({ schemaVersion: RECEIPT_SCHEMA, task, inputDigests }, null, 2));
}

function receiptFor({ fixturePath, generatedAt, task, inputDigests, terminalDisposition, classified, evidence }) {
  return {
    schemaVersion: RECEIPT_SCHEMA,
    generated_at: generatedAt,
    task,
    fixture: labelPath(fixturePath),
    inputDigests,
    bindingDigest: bindingDigest(task, inputDigests),
    terminalDisposition,
    disposition: classified.disposition,
    reason: classified.reason,
    evidence,
    resumeActions: classified.resumeActions,
    rollback: ROLLBACK,
    side_effects: [],
    nonClaims: NON_CLAIMS,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fixtureFile = await readJson(args.fixture, 'fixture');
  const fixture = validateFixture(fixtureFile.value);
  const inputFiles = {};
  const inputDigests = {};
  for (const id of INPUT_IDS) {
    inputFiles[id] = await readJson(path.join(root, ...INPUTS[id].path.split('/')), `${id} receipt`);
    const observed = sha256(inputFiles[id].bytes);
    if (observed !== fixture.references[id].sha256) deny('STALE_DIGEST_DENIED', `${id} receipt digest drift denied`);
    inputDigests[id] = { ...fixture.references[id], observed_sha256: observed };
    assertNoSecret(inputFiles[id].value, `${id} receipt`);
  }
  let classified;
  let terminalDisposition = null;
  const evidence = [];
  try {
    const local = validateLocal(inputFiles.local.value);
    const portal = validatePortal(inputFiles.portal.value);
    const anonymous = validateAnonymous(inputFiles.anonymous.value, fixture.references.anonymous.freshness);
    const terminal = validateTerminal(inputFiles.terminal.value, Object.fromEntries(INPUT_IDS.map((id) => [id, inputDigests[id].observed_sha256])));
    terminalDisposition = terminal.disposition;
    if (terminal.disposition !== fixtureFile.value.expectedTerminalDisposition) deny('CLASSIFIER_READBACK_DISAGREEMENT_DENIED', 'terminal disposition does not match the bound fixture expectation');
    if (new Set([local.digest, portal.digest, anonymous.digest, terminal.digest]).size !== 1) deny('MIXED_DIGEST_DENIED', 'required receipts do not share one package digest');
    classified = classify(terminal, portal);
  } catch (error) {
    const reason = redact(error instanceof Error ? error.message : 'validation denied');
    evidence.push({ code: error instanceof Denied ? error.code : 'VALIDATION_DENIED', redactedReason: reason });
    classified = { disposition: 'REJECTED_WITH_EVIDENCE', reason, resumeActions: [] };
  }
  const receipt = receiptFor({ fixturePath: args.fixture, generatedAt: fixture.generatedAt, task: fixture.task, inputDigests, terminalDisposition, classified, evidence });
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (!args.dryRun) {
    await mkdir(path.dirname(args.receipt), { recursive: true });
    await writeFile(args.receipt, serialized, { mode: 0o644 });
  }
  process.stdout.write(serialized);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`k4c-delivery-readback: ${redact(error instanceof Error ? error.message : 'validation denied')}\n`);
    process.exitCode = 1;
  }
}
