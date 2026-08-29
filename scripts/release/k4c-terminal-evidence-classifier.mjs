#!/usr/bin/env node
// Deterministic local K4C terminal evidence classification. It validates a
// digest-bound evidence set (local contract, reviewer packet, portal outcome,
// and the anonymous directory readback proof) and emits a record only. It is
// pure and fixture-backed: no network, no child processes, no polling, and no
// external state or mutation. Every record carries the same safe rollback text.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const defaultFixture = path.join(root, 'tests', 'fixtures', 'release', 'k4c-evidence-sets-v1.json');
const defaultReceipt = path.join(root, 'verification', 'k4c', 'terminal-evidence-v1.json');
const FIXTURE_SCHEMA = 'kaleidosphere/k4c-terminal-evidence-fixture/v1';
const RECEIPT_SCHEMA = 'kaleidosphere/k4c-terminal-evidence-receipt/v1';
const LOCAL_RECEIPT_SCHEMA = 'kaleidosphere/k4c-local-contract-integration/v1';
const PACKET_RECEIPT_SCHEMA = 'kaleidosphere/k4c-reviewer-test-cases/v1';
const PORTAL_RECEIPT_SCHEMA = 'kaleidosphere/k4c-portal-submission-receipt/v1';
const ANONYMOUS_RECEIPT_SCHEMA = 'kaleidosphere/k4c-anonymous-directory-readback/v1';
const SHA256 = /^[a-f0-9]{64}$/;
const RECEIPT_IDS = ['local', 'packet', 'portal', 'anonymous'];
// The single literal official UI/identity resume action, shared verbatim with
// the K4C portal submission guard.
const IDENTITY_RESUME_ACTION = 'Owner resumes in the official portal UI to verify owner authority and publisher identity.';
const CORRECTION_RESUME_ACTION = 'Worker resumes by correcting the denied evidence set before requesting a new bounded classification.';
const ROLLBACK_TEXT = 'Safe rollback when authorized: remove the local cache, or withdraw the draft and publish the corrected successor.';
const ANONYMOUS_COMMANDS = [
  'anonymous-boundary-preflight',
  'anonymous-directory-discovery',
  'exact-listing-readback',
  'install-matching-package',
  'installed-package-readback',
  'zero-residue-readback',
];
const ANONYMOUS_NEGATIVES = [
  'authenticated-config',
  'cached-local-only-discovery',
  'title-only-mismatch',
  'missing-package-digest',
  'install-failure',
  'anonymous-receipt-older-than-submission',
];
const NON_CLAIMS = [
  'No portal submission, publication, listing, identity, credential, or release operation is performed or established by this classifier.',
  'A terminal disposition is emitted only when complete same-digest local, packet, portal, and anonymous receipts are validated; a public listing claim then requires the complete anonymous directory discovery and install evidence.',
  'This record is a bounded local classification of recorded evidence; it creates no external state and performs no mutation.',
];

class ClassifiedError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ClassifiedError';
    this.code = code;
  }
}

function fail(code, message) {
  return new ClassifiedError(code, message);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function inside(scope, candidate) {
  return candidate === scope || candidate.startsWith(`${scope}${path.sep}`);
}

function resolveInput(value, label) {
  const resolved = path.resolve(value);
  if (resolved.includes('\0') || (!inside(root, resolved) && !inside(os.tmpdir(), resolved))) {
    throw new Error(`${label} path outside repository or temporary scope denied`);
  }
  return resolved;
}

function resolveReceipt(value) {
  const resolved = path.resolve(value);
  if (resolved.includes('\0') || (!inside(root, resolved) && !inside(os.tmpdir(), resolved))) {
    throw new Error('receipt path outside repository or temporary scope denied');
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
      if (arg === '--fixture') args.fixture = resolveInput(value, 'fixture');
      else args.receipt = resolveReceipt(value);
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

async function readJsonWithBytes(file, label) {
  let bytes;
  try {
    bytes = await readFile(file);
  } catch {
    throw new Error(`${label} unreadable`);
  }
  try {
    return { bytes, value: JSON.parse(bytes.toString('utf8')) };
  } catch {
    throw new Error(`${label} malformed`);
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertObject(value, label) {
  if (!isObject(value)) throw new Error(`${label} malformed`);
}

function assertText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} malformed`);
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error(`${label} malformed`);
}

function safeDigest(value) {
  return typeof value === 'string' && SHA256.test(value) ? value : null;
}

function safePath(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function initialDigests(fixture) {
  const receipts = isObject(fixture?.receipts) ? fixture.receipts : {};
  const record = (value) => isObject(value)
    ? { path: safePath(value.path), expectedSha256: safeDigest(value.sha256), observedSha256: null }
    : { path: null, expectedSha256: null, observedSha256: null };
  return {
    local: record(receipts.local),
    packet: record(receipts.packet),
    portal: record(receipts.portal),
    anonymous: record(receipts.anonymous),
  };
}

function validateFixtureShell(fixture) {
  assertObject(fixture, 'fixture');
  if (fixture.schemaVersion !== FIXTURE_SCHEMA) throw fail('FIXTURE_SCHEMA_DENIED', 'fixture schema denied');
  assertObject(fixture.package, 'package');
  assertText(fixture.package.name, 'package name');
  assertText(fixture.package.version, 'package version');
  assertText(fixture.package.title, 'package title');
  assertSha256(fixture.package.digest, 'package digest');
  assertSha256(fixture.package.manifestSha256, 'manifest digest');
  if (fixture.claim !== 'released') throw fail('UNSUPPORTED_CLAIM_DENIED', 'unsupported claim denied');
  if (fixture.label !== undefined) assertText(fixture.label, 'label');
  const receipts = fixture.receipts;
  assertObject(receipts, 'receipts');
  for (const id of RECEIPT_IDS) {
    const ref = receipts[id];
    if (ref === undefined) {
      if (id !== 'anonymous') throw fail('FIXTURE_SCHEMA_DENIED', `${id} receipt reference denied`);
      continue;
    }
    assertObject(ref, `${id} receipt reference`);
    assertText(ref.path, `${id} receipt path`);
    assertSha256(ref.sha256, `${id} receipt digest`);
  }
  if (fixture.nonClaims !== undefined) {
    if (!Array.isArray(fixture.nonClaims) || fixture.nonClaims.length === 0) throw fail('FIXTURE_SCHEMA_DENIED', 'fixture non-claims malformed');
    fixture.nonClaims.forEach((item) => assertText(item, 'fixture non-claim'));
  }
}

function secretPatternMatch(text) {
  return (/(?:^|[\s"'=:])(?:TOKEN|PASSWORD|SECRET|CREDENTIAL|API[_-]?KEY|AUTHORIZATION|PRIVATE[_-]?KEY|BEARER)\s*=/i.test(text)
    || /(?:^|[\s"'])(?:sk|ghp|glpat|xox[baprs])-[a-z0-9_-]{8,}/i.test(text)
    || /\bAKIA[0-9A-Z]{16}\b/.test(text)
    || /\b(?:secret|token|password|credential|api[_-]?key|authorization|bearer)\b\s*[:=]/i.test(text));
}

function assertNoSecret(value, location) {
  if (typeof value === 'string' && secretPatternMatch(value)) {
    throw fail('SECRET_CONTENT_DENIED', `${location} secret content denied`);
  }
}

function assertNoUnsafeText(value, location) {
  if (typeof value !== 'string') return;
  const text = value.trim();
  if (/https?:\/\//i.test(text) || /(?:^|[\s])(?:curl|wget|node|npm|bash|sh|python|powershell)\b/i.test(text) || /(?:&&|\|\||;|`|\$\()/u.test(text)) {
    throw fail('URL_EXECUTABLE_DENIED', `${location} executable or URL content denied`);
  }
  if (/(?:portal\s+(?:api|endpoint|form|call)|(?:call|invoke|request)\s+(?:the\s+)?portal)/i.test(text)) {
    throw fail('PORTAL_CALL_DENIED', `${location} portal-call instruction denied`);
  }
  if (/\b(?:retry|retries|poll|polling|loop|backoff|again|until)\b/i.test(text)) {
    throw fail('RETRY_SEMANTICS_DENIED', `${location} retry or poll semantics denied`);
  }
  if (/\b(?:submit|submission|publish|publication|release|listing|listed|released|approve|approved|deploy|delete|remove|install|upload|send|post|mutate|mutation)\b/i.test(text) && !/\b(?:no|not|never|without|does not|do not|doesn't|don't)\b/i.test(text)) {
    throw fail('MUTATION_CLAIM_DENIED', `${location} mutation or success claim denied`);
  }
  assertNoSecret(value, location);
}

function hasWaitingLabel(value) {
  return /\b(?:wait(?:ing|ed)?|pending|queued|on[- ]hold|in[- ]progress|indeterminate)\b/i.test(value.replaceAll('_', ' '));
}

function assertNoWaitingLabel(value, location) {
  if (typeof value === 'string' && hasWaitingLabel(value)) {
    throw fail('WAITING_STATE_DENIED', `${location} waiting-state label denied`);
  }
}

function walkStrings(value, key, visit) {
  if (typeof value === 'string') {
    visit(value, key);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => walkStrings(item, key, visit));
    return;
  }
  if (isObject(value)) {
    for (const [childKey, child] of Object.entries(value)) walkStrings(child, childKey, visit);
  }
}

function scanFixtureText(fixture) {
  // The claim value is a classifier input token, not prose, and is already
  // constrained by the supported-claims check. Receipt paths are identifiers,
  // not instructions or claims.
  walkStrings(fixture, 'fixture', (text, key) => {
    if (key === 'claim' || key === 'path') return;
    assertNoUnsafeText(text, `fixture ${key}`);
    assertNoWaitingLabel(text, `fixture ${key}`);
  });
}

function scanReceiptSecrets(receipt, id) {
  walkStrings(receipt, id, (text, key) => assertNoSecret(text, `${id} receipt ${key}`));
}

function assertNoCredentialFields(value, location = 'input') {
  const credentialKey = /^(?:raw)?(?:token|secret|password|credential|credentials|apikey|authorization|privatekey|bearer)$/i;
  if (!isObject(value) && !Array.isArray(value)) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoCredentialFields(item, `${location}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (credentialKey.test(key.replaceAll('_', ''))) {
      throw fail('SECRET_CONTENT_DENIED', `${location} credential field denied`);
    }
    assertNoCredentialFields(child, `${location}.${key}`);
  }
}

function assertNoForbiddenKeys(value, location = 'input') {
  const forbiddenKeys = new Set([
    'command', 'commands', 'shell', 'url', 'token', 'secret', 'credential', 'credentials',
    'password', 'apikey', 'authorization', 'endpoint', 'portalcall', 'portalrequest',
    'retry', 'retries', 'poll', 'polling', 'resumeaction', 'resumeactions',
    'mutation', 'mutations', 'submissionresult', 'portalresult', 'successclaim',
  ]);
  if (!isObject(value) && !Array.isArray(value)) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenKeys(item, `${location}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.has(key.toLowerCase().replaceAll('_', ''))) {
      throw fail('FORBIDDEN_FIELD_DENIED', `${location} forbidden field denied`);
    }
    assertNoForbiddenKeys(child, `${location}.${key}`);
  }
}

async function readReceipt(id, ref, digests) {
  const resolved = resolveInput(ref.path, `${id} receipt`);
  const { bytes, value } = await readJsonWithBytes(resolved, `${id} receipt`);
  digests[id].observedSha256 = sha256(bytes);
  if (digests[id].observedSha256 !== ref.sha256) throw fail('STALE_DIGEST_DENIED', `${id} receipt stale digest denied`);
  return value;
}

function assertLocalReceipt(receipt, packageRecord) {
  assertObject(receipt, 'local receipt');
  if (receipt.schemaVersion !== LOCAL_RECEIPT_SCHEMA) throw fail('RECEIPT_SCHEMA_DENIED', 'local receipt schema denied');
  const pkg = receipt.package;
  assertObject(pkg, 'local receipt package');
  if (pkg.version !== packageRecord.version || pkg.digest !== packageRecord.digest || pkg.manifestSha256 !== packageRecord.manifestSha256) {
    throw fail('MIXED_DIGEST_DENIED', 'local receipt mixed-digest denied');
  }
  if (receipt.accepted !== true) throw fail('LOCAL_DECISION_DENIED', 'local receipt acceptance denied');
  const decision = receipt.decision;
  assertObject(decision, 'local receipt decision');
  if (decision.outcome !== 'accepted' || decision.scope !== 'local-contract-integration' || decision.packageDigest !== packageRecord.digest || decision.releaseClaimEmitted !== false) {
    throw fail('LOCAL_DECISION_DENIED', 'local receipt decision denied');
  }
  if (typeof receipt.bindingDigest !== 'string' || receipt.bindingDigest !== decision.bindingDigest) {
    throw fail('LOCAL_DECISION_DENIED', 'local receipt binding denied');
  }
  const boundary = receipt.executionBoundary;
  assertObject(boundary, 'local receipt boundary');
  if (boundary.localOnly !== true || boundary.externalCommandsCalled !== false || boundary.portalCalls !== false || boundary.directoryCalls !== false || boundary.releaseClaimEmitted !== false) {
    throw fail('LOCAL_BOUNDARY_DENIED', 'local receipt boundary denied');
  }
  const predecessors = receipt.predecessorReceipts;
  if (!Array.isArray(predecessors) || predecessors.length === 0) throw fail('LOCAL_BOUNDARY_DENIED', 'local receipt predecessors denied');
  for (const item of predecessors) {
    if (!isObject(item) || typeof item.packageDigest !== 'string' || item.packageDigest !== packageRecord.digest) {
      throw fail('MIXED_DIGEST_DENIED', 'local receipt predecessor binding denied');
    }
  }
}

function assertReviewerPacket(receipt, packageRecord) {
  assertObject(receipt, 'reviewer packet');
  if (receipt.schemaVersion !== PACKET_RECEIPT_SCHEMA) throw fail('RECEIPT_SCHEMA_DENIED', 'reviewer packet schema denied');
  if (receipt.packet?.packageVersion !== packageRecord.version || receipt.packet?.packageDigest !== packageRecord.digest || receipt.packet?.manifestSha256 !== packageRecord.manifestSha256) {
    throw fail('MIXED_DIGEST_DENIED', 'reviewer packet mixed-digest denied');
  }
  if (receipt.packet?.publicationPerformed !== false || !Array.isArray(receipt.positiveCases) || !Array.isArray(receipt.negativeCases) || receipt.positiveCases.length < 5 || receipt.negativeCases.length < 3) {
    throw fail('PACKET_COMPLETENESS_DENIED', 'reviewer packet completeness denied');
  }
  if (!Array.isArray(receipt.nonClaims) || receipt.nonClaims.length === 0) throw fail('PACKET_COMPLETENESS_DENIED', 'reviewer packet non-claims denied');
  const cases = [...receipt.positiveCases, ...receipt.negativeCases];
  const ids = new Set();
  for (const item of cases) {
    if (!isObject(item) || typeof item.id !== 'string' || ids.has(item.id) || item.packageDigest !== packageRecord.digest) {
      throw fail('PACKET_BINDING_DENIED', 'reviewer packet case binding denied');
    }
    ids.add(item.id);
  }
}

function assertPortalOutcome(receipt, packageRecord, packetSha256) {
  assertObject(receipt, 'portal receipt');
  if (receipt.schemaVersion !== PORTAL_RECEIPT_SCHEMA) throw fail('RECEIPT_SCHEMA_DENIED', 'portal receipt schema denied');
  const digests = receipt.validatedInputDigests;
  assertObject(digests, 'portal receipt digests');
  const pkg = digests.package;
  assertObject(pkg, 'portal receipt package digests');
  if (pkg.version !== packageRecord.version || pkg.digest !== packageRecord.digest || pkg.manifestSha256 !== packageRecord.manifestSha256) {
    throw fail('MIXED_DIGEST_DENIED', 'portal receipt mixed-digest denied');
  }
  for (const id of ['securityReceipt', 'reviewerPacket']) {
    const entry = digests[id];
    assertObject(entry, `portal receipt ${id} digest`);
    if (entry.expectedSha256 !== entry.observedSha256) throw fail('STALE_DIGEST_DENIED', `portal receipt ${id} stale digest denied`);
  }
  if (digests.reviewerPacket.observedSha256 !== packetSha256) throw fail('STALE_DIGEST_DENIED', 'portal receipt packet digest stale denied');
  if (!Array.isArray(receipt.side_effects) || receipt.side_effects.length !== 0) throw fail('SIDE_EFFECT_DENIED', 'portal receipt side effects denied');
  const actions = receipt.resumeActions;
  if (!Array.isArray(actions) || actions.length > 1) throw fail('MULTIPLE_RESUME_ACTIONS_DENIED', 'portal receipt multiple resume actions denied');
  if (actions.length === 1 && actions[0] !== IDENTITY_RESUME_ACTION) throw fail('RESUME_ACTION_MISMATCH_DENIED', 'portal receipt resume action mismatch denied');
  const proposal = receipt.proposal;
  if (proposal !== null) {
    assertObject(proposal, 'portal receipt proposal');
    if (proposal.kind !== 'non-executable' || proposal.packageDigest !== packageRecord.digest || proposal.portalIdentityClass !== 'owner-official-ui' || proposal.packetDigest !== packetSha256) {
      throw fail('PROPOSAL_BINDING_DENIED', 'portal receipt proposal binding denied');
    }
  }
  const disposition = receipt.disposition;
  if (disposition === 'PRECHECK_READY') {
    if (actions.length !== 0 || proposal === null) throw fail('PORTAL_OUTCOME_INCONSISTENT', 'portal receipt outcome inconsistent');
    return { captured: true, disposition, identityStepRecorded: false };
  }
  if (disposition === 'NOT_SUBMITTED') {
    if (actions.length !== 1 || proposal !== null) throw fail('IDENTITY_STEP_INCONSISTENT', 'portal receipt identity step inconsistent');
    return { captured: false, disposition, identityStepRecorded: true };
  }
  throw fail('PORTAL_OUTCOME_UNSUPPORTED', 'portal receipt outcome unsupported');
}

function assertAnonymousReceipt(receipt, packageRecord) {
  assertObject(receipt, 'anonymous receipt');
  if (receipt.schemaVersion !== ANONYMOUS_RECEIPT_SCHEMA) throw fail('RECEIPT_SCHEMA_DENIED', 'anonymous receipt schema denied');
  const pkg = receipt.package;
  assertObject(pkg, 'anonymous receipt package');
  if (pkg.name !== packageRecord.name || pkg.version !== packageRecord.version || pkg.digest !== packageRecord.digest) {
    throw fail('MIXED_DIGEST_DENIED', 'anonymous receipt mixed-digest denied');
  }
  if (receipt.accepted !== true || receipt.fullReceipt !== true || receipt.publicListingClaim !== true) {
    throw fail('ANONYMOUS_ACCEPTANCE_DENIED', 'anonymous receipt acceptance denied');
  }
  const evidence = receipt.evidence;
  assertObject(evidence, 'anonymous receipt evidence');
  for (const key of ['anonymousDiscoveryBeforeInstall', 'exactListingReadback', 'matchingDigestInstall', 'installedDigestReadback', 'freshTimestamps', 'zeroResidue']) {
    if (evidence[key] !== true) throw fail('ANONYMOUS_EVIDENCE_INCOMPLETE', 'anonymous receipt discovery or install evidence incomplete');
  }
  const boundary = receipt.boundaryProof;
  assertObject(boundary, 'anonymous receipt boundary');
  if (boundary.cachedLocalOnlyDiscovery !== false) throw fail('STALE_CACHE_DENIED', 'anonymous receipt stale cache denied');
  if (boundary.cleanBeforeDiscovery !== true || boundary.credentialFree !== true || boundary.authenticatedConfigDetected !== false
    || !Array.isArray(boundary.residuePaths) || boundary.residuePaths.length !== 0 || boundary.emptyAfterCleanup !== true || boundary.temporaryBoundaryRemoved !== true) {
    throw fail('ANONYMOUS_BOUNDARY_DENIED', 'anonymous receipt boundary denied');
  }
  const timestamps = receipt.timestamps;
  assertObject(timestamps, 'anonymous receipt timestamps');
  if (typeof timestamps.submissionReceiptAt !== 'string' || typeof timestamps.anonymousReceiptAt !== 'string'
    || timestamps.anonymousReceiptAt <= timestamps.submissionReceiptAt) {
    throw fail('STALE_TIMESTAMP_DENIED', 'anonymous receipt timestamps stale denied');
  }
  const commands = receipt.orderedCommandResults;
  if (!Array.isArray(commands) || commands.length !== ANONYMOUS_COMMANDS.length) throw fail('ANONYMOUS_COMMAND_SEQUENCE_DENIED', 'anonymous receipt command sequence denied');
  for (const [index, id] of ANONYMOUS_COMMANDS.entries()) {
    const item = commands[index];
    if (!isObject(item) || item.order !== index + 1 || item.id !== id || !isObject(item.result) || item.result.exitCode !== 0 || item.result.signal !== null) {
      throw fail('ANONYMOUS_COMMAND_SEQUENCE_DENIED', 'anonymous receipt command sequence denied');
    }
  }
  const negatives = receipt.negativeAssertions;
  if (!Array.isArray(negatives) || negatives.length !== ANONYMOUS_NEGATIVES.length) throw fail('ANONYMOUS_NEGATIVE_ASSERTIONS_DENIED', 'anonymous receipt negative assertions denied');
  for (const id of ANONYMOUS_NEGATIVES) {
    const item = negatives.find((candidate) => candidate?.id === id);
    if (!isObject(item) || item.required !== true || item.observed !== 'denied') {
      throw fail('ANONYMOUS_NEGATIVE_ASSERTIONS_DENIED', 'anonymous receipt negative assertions denied');
    }
  }
  return { discovery: true, install: true, fresh: true, boundaryClean: true, complete: true, publicListingClaim: true };
}

function classify(outcome, anonymous) {
  if (outcome.identityStepRecorded) {
    return {
      disposition: 'NOT_RELEASED',
      reason: 'portal identity blocker recorded; exactly one official UI identity step awaits owner action',
      resumeActions: [IDENTITY_RESUME_ACTION],
    };
  }
  if (anonymous === null || !anonymous.complete) {
    throw fail('ANONYMOUS_PROOF_REQUIRED', 'released claim denied without complete anonymous discovery and install proof');
  }
  return {
    disposition: 'RELEASED',
    reason: 'complete same-digest local, packet, portal, and anonymous receipts validated; anonymous discovery and install proof is fresh and boundary-clean',
    resumeActions: [],
  };
}

function makeRecord(args, fixture, fixtureDigest, digests, outcome, anonymous, disposition, reason, evidence, resumeActions) {
  const packageRecord = isObject(fixture?.package) ? fixture.package : {};
  return {
    schemaVersion: RECEIPT_SCHEMA,
    fixture: labelPath(args.fixture),
    fixtureSha256: fixtureDigest,
    package: {
      name: typeof packageRecord.name === 'string' && packageRecord.name.trim() !== '' ? packageRecord.name : null,
      version: typeof packageRecord.version === 'string' && packageRecord.version.trim() !== '' ? packageRecord.version : null,
      title: typeof packageRecord.title === 'string' && packageRecord.title.trim() !== '' ? packageRecord.title : null,
      digest: safeDigest(packageRecord.digest),
      manifestSha256: safeDigest(packageRecord.manifestSha256),
    },
    validatedInputDigests: digests,
    portalOutcome: outcome,
    anonymousProof: {
      present: anonymous !== null,
      discovery: anonymous?.discovery ?? false,
      install: anonymous?.install ?? false,
      fresh: anonymous?.fresh ?? false,
      boundaryClean: anonymous?.boundaryClean ?? false,
      complete: anonymous?.complete ?? false,
      publicListingClaim: anonymous?.publicListingClaim ?? false,
    },
    disposition,
    reason,
    evidence,
    resumeActions,
    rollback: ROLLBACK_TEXT,
    side_effects: [],
    nonClaims: NON_CLAIMS,
  };
}

function rejectionReason(error) {
  const message = error instanceof Error ? error.message : 'validation denied';
  return message.replace(/\b(?:sk|ghp|glpat|xox[baprs])-[a-z0-9_-]{8,}\b/gi, '[REDACTED]').replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED]');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { bytes: fixtureBytes, value: fixture } = await readJsonWithBytes(args.fixture, 'fixture');
  const fixtureDigest = sha256(fixtureBytes);
  const digests = initialDigests(fixture);
  const evidence = [];
  const outcome = { captured: false, disposition: null, identityStepRecorded: false };
  let anonymous = null;
  let disposition = 'REJECTED_WITH_EVIDENCE';
  let reason = 'evidence set validation denied';
  let resumeActions = [CORRECTION_RESUME_ACTION];
  try {
    validateFixtureShell(fixture);
    assertNoForbiddenKeys(fixture, 'fixture');
    scanFixtureText(fixture);
    const packageRecord = {
      name: fixture.package.name,
      version: fixture.package.version,
      title: fixture.package.title,
      digest: fixture.package.digest,
      manifestSha256: fixture.package.manifestSha256,
    };
    for (const id of RECEIPT_IDS) {
      const ref = fixture.receipts[id];
      if (ref === undefined) continue;
      const receipt = await readReceipt(id, ref, digests);
      scanReceiptSecrets(receipt, id);
      assertNoCredentialFields(receipt, `${id} receipt`);
      if (id === 'local' || id === 'packet') assertNoForbiddenKeys(receipt, `${id} receipt`);
      if (id === 'portal') {
        walkStrings(receipt, 'portal receipt', (text, key) => assertNoWaitingLabel(text, `portal receipt ${key}`));
        Object.assign(outcome, assertPortalOutcome(receipt, packageRecord, digests.packet.observedSha256));
      }
      if (id === 'local') assertLocalReceipt(receipt, packageRecord);
      if (id === 'packet') assertReviewerPacket(receipt, packageRecord);
      if (id === 'anonymous') anonymous = assertAnonymousReceipt(receipt, packageRecord);
    }
    const classified = classify(outcome, anonymous);
    disposition = classified.disposition;
    reason = classified.reason;
    resumeActions = classified.resumeActions;
  } catch (error) {
    reason = rejectionReason(error);
    evidence.push({ code: error instanceof ClassifiedError ? error.code : 'VALIDATION_DENIED', redactedReason: reason });
  }
  const record = makeRecord(args, fixture, fixtureDigest, digests, outcome, anonymous, disposition, reason, evidence, resumeActions);
  const serialized = `${JSON.stringify(record, null, 2)}\n`;
  if (!args.dryRun) {
    await mkdir(path.dirname(args.receipt), { recursive: true });
    await writeFile(args.receipt, serialized, { mode: 0o644 });
  }
  process.stdout.write(serialized);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`k4c-terminal-evidence-classifier: ${error.message}\n`);
  process.exitCode = 1;
}