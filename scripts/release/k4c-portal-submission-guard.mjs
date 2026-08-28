#!/usr/bin/env node
// Deterministic local K4C portal preflight. It validates recorded local evidence
// and a reviewer packet, then emits a receipt only. It never contacts or mutates
// a portal and never emits an executable submission instruction.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const defaultFixture = path.join(root, 'tests', 'fixtures', 'release', 'k4c-portal-capability-v1.json');
const defaultReceipt = path.join(root, 'verification', 'k4c', 'portal-submission-receipt-v1.json');
const FIXTURE_SCHEMA = 'kaleidosphere/k4c-portal-capability-fixture/v1';
const RECEIPT_SCHEMA = 'kaleidosphere/k4c-portal-submission-receipt/v1';
const CAPABILITY = 'k4c-portal-preflight-v1';
const IDENTITY_CLASS = 'owner-official-ui';
const SHA256 = /^[a-f0-9]{64}$/;
const RESUME_ACTION = 'Owner resumes in the official portal UI to verify owner authority and publisher identity.';
const NON_CLAIMS = [
  'No portal submission, publication, listing, authenticated identity proof, anonymous availability, or release is performed or established.',
  'This local receipt is proposal evidence only and does not delegate authority or transfer execution.',
];

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
  } catch (error) {
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
  const packageRecord = isObject(fixture?.package) ? fixture.package : {};
  const security = isObject(fixture?.securityReceipt) ? fixture.securityReceipt : {};
  const packet = isObject(fixture?.reviewerPacket) ? fixture.reviewerPacket : {};
  return {
    package: {
      version: typeof packageRecord.version === 'string' ? packageRecord.version : null,
      digest: safeDigest(packageRecord.digest),
      manifestSha256: safeDigest(packageRecord.manifestSha256),
    },
    securityReceipt: {
      path: safePath(security.path),
      expectedSha256: safeDigest(security.sha256),
      observedSha256: null,
    },
    reviewerPacket: {
      path: safePath(packet.path),
      expectedSha256: safeDigest(packet.sha256),
      observedSha256: null,
    },
  };
}

function validateFixtureShell(fixture) {
  assertObject(fixture, 'fixture');
  if (fixture.schemaVersion !== FIXTURE_SCHEMA) throw new Error('fixture schema denied');
  assertObject(fixture.package, 'package');
  assertText(fixture.package.version, 'package version');
  assertSha256(fixture.package.digest, 'package digest');
  assertSha256(fixture.package.manifestSha256, 'manifest digest');
  assertObject(fixture.securityReceipt, 'security receipt reference');
  assertText(fixture.securityReceipt.path, 'security receipt path');
  assertSha256(fixture.securityReceipt.sha256, 'security receipt digest');
  assertObject(fixture.reviewerPacket, 'reviewer packet reference');
  assertText(fixture.reviewerPacket.path, 'reviewer packet path');
  assertSha256(fixture.reviewerPacket.sha256, 'reviewer packet digest');
  assertObject(fixture.portal, 'portal capability');
  assertText(fixture.portal.capability, 'portal capability name');
  assertText(fixture.portal.identityClass, 'portal identity class');
  if (fixture.portal.prerequisites !== undefined) assertObject(fixture.portal.prerequisites, 'portal prerequisites');
  assertObject(fixture.proposal, 'proposal');
  if (fixture.resumeActions !== undefined) {
    if (!Array.isArray(fixture.resumeActions) || fixture.resumeActions.length > 1) throw new Error('multiple resume actions denied');
  }
}

function assertNoUnsafeText(value, location) {
  if (typeof value !== 'string') return;
  const text = value.trim();
  if (/https?:\/\//i.test(text) || /(?:^|[\s])(?:curl|wget|node|npm|bash|sh|python|powershell)\b/i.test(text) || /(?:&&|\|\||;|`|\$\()/u.test(text)) {
    throw new Error(`${location} executable or URL content denied`);
  }
  if (/(?:portal\s+(?:api|endpoint|form|call)|(?:call|invoke|request)\s+(?:the\s+)?portal)/i.test(text)) {
    throw new Error(`${location} portal-call instruction denied`);
  }
  if (/\b(?:retry|retries|poll|polling|loop|backoff|again|until)\b/i.test(text)) {
    throw new Error(`${location} retry or poll semantics denied`);
  }
  if (/\b(?:submit|submission|publish|publication|release|listing|listed|released|approve|approved|deploy|delete|remove|install|upload|send|post|mutate|mutation)\b/i.test(text) && !/\b(?:no|not|never|without|does not|do not|doesn't|don't)\b/i.test(text)) {
    throw new Error(`${location} mutation or success claim denied`);
  }
  if (/\b(?:secret|token|password|credential|api[_-]?key|authorization|bearer)\b\s*[:=]/i.test(text) || /\b(?:sk|ghp|glpat|xox[baprs])-[a-z0-9_-]{8,}\b/i.test(text) || /\bAKIA[0-9A-Z]{16}\b/.test(text)) {
    throw new Error(`${location} secret content denied`);
  }
}

function assertSafeProposal(proposal) {
  assertObject(proposal, 'proposal');
  if (proposal.kind !== 'non-executable') throw new Error('proposal kind denied');
  for (const [key, value] of Object.entries(proposal)) {
    if (/command|shell|url|token|secret|credential|password|authorization|endpoint/i.test(key)) throw new Error('proposal executable or secret field denied');
    if (typeof value === 'string') assertNoUnsafeText(value, `proposal ${key}`);
    else if (Array.isArray(value)) value.forEach((item, index) => assertNoUnsafeText(item, `proposal ${key}[${index}]`));
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
      throw new Error(`${location} forbidden field denied`);
    }
    assertNoForbiddenKeys(child, `${location}.${key}`);
  }
}

function assertSecurityReceipt(receipt, packageRecord) {
  assertObject(receipt, 'security receipt');
  if (receipt.schemaVersion !== 'kaleidosphere/k4c-security-license-receipt/v1') throw new Error('security receipt schema denied');
  if (receipt.packageVersion !== packageRecord.version || receipt.packageDigest !== packageRecord.digest || receipt.manifest?.sha256 !== packageRecord.manifestSha256) {
    throw new Error('security receipt mixed-digest denied');
  }
  if (receipt.accepted !== true || receipt.publicationPerformed !== false || receipt.checks?.secretFree !== true || receipt.checks?.noExternalCommands !== true || receipt.checks?.noExecutablePayloads !== true) {
    throw new Error('security receipt boundary denied');
  }
}

function assertReviewerPacket(packet, packageRecord) {
  assertObject(packet, 'reviewer packet');
  if (packet.schemaVersion !== 'kaleidosphere/k4c-reviewer-test-cases/v1') throw new Error('reviewer packet schema denied');
  if (packet.packet?.packageVersion !== packageRecord.version || packet.packet?.packageDigest !== packageRecord.digest || packet.packet?.manifestSha256 !== packageRecord.manifestSha256) {
    throw new Error('reviewer packet mixed-digest denied');
  }
  if (packet.packet?.publicationPerformed !== false || !Array.isArray(packet.positiveCases) || !Array.isArray(packet.negativeCases) || packet.positiveCases.length < 5 || packet.negativeCases.length < 3) {
    throw new Error('reviewer packet completeness denied');
  }
  if (!Array.isArray(packet.nonClaims) || packet.nonClaims.length === 0) throw new Error('reviewer packet non-claims denied');
  const cases = [...packet.positiveCases, ...packet.negativeCases];
  const ids = new Set();
  for (const item of cases) {
    if (!isObject(item) || typeof item.id !== 'string' || ids.has(item.id) || item.packageDigest !== packageRecord.digest) {
      throw new Error('reviewer packet case binding denied');
    }
    ids.add(item.id);
  }
}

async function readAndValidateEvidence(fixture, digests) {
  const packageRecord = fixture.package;
  const securityPath = resolveInput(fixture.securityReceipt.path, 'security receipt');
  const packetPath = resolveInput(fixture.reviewerPacket.path, 'reviewer packet');
  const security = await readJsonWithBytes(securityPath, 'security receipt');
  const packet = await readJsonWithBytes(packetPath, 'reviewer packet');
  digests.securityReceipt.observedSha256 = sha256(security.bytes);
  digests.reviewerPacket.observedSha256 = sha256(packet.bytes);
  if (digests.securityReceipt.observedSha256 !== fixture.securityReceipt.sha256) throw new Error('security receipt stale digest denied');
  if (digests.reviewerPacket.observedSha256 !== fixture.reviewerPacket.sha256) throw new Error('reviewer packet stale digest denied');
  assertSecurityReceipt(security.value, packageRecord);
  assertReviewerPacket(packet.value, packageRecord);
  assertNoForbiddenKeys(security.value, 'security receipt');
  assertNoForbiddenKeys(packet.value, 'reviewer packet');
  return { packageDigest: packageRecord.digest, packetDigest: digests.reviewerPacket.observedSha256 };
}

function capabilityState(fixture) {
  if (fixture.portal.capability !== CAPABILITY || fixture.portal.identityClass !== IDENTITY_CLASS) throw new Error('unknown capability or identity class denied');
  const prerequisites = fixture.portal.prerequisites || {};
  const ready = fixture.portal.ownerPortalAuthority === true
    && fixture.portal.verifiedPublisherIdentity === true
    && prerequisites.officialUiAvailable === true
    && prerequisites.ownerAuthorityConfirmed === true
    && prerequisites.verifiedPublisherIdentity === true
    && prerequisites.packageDigestConfirmed === true
    && prerequisites.reviewerPacketComplete === true;
  return ready;
}

function makeReceipt(args, fixture, fixtureDigest, digests, disposition, redactedReason, evidence = [], binding = {}) {
  const receipt = {
    schemaVersion: RECEIPT_SCHEMA,
    fixture: labelPath(args.fixture),
    fixtureSha256: fixtureDigest,
    validatedInputDigests: digests,
    portal: {
      identityClass: typeof fixture?.portal?.identityClass === 'string' ? fixture.portal.identityClass : null,
      capability: typeof fixture?.portal?.capability === 'string' ? fixture.portal.capability : null,
    },
    disposition,
    redactedReason,
    evidence,
    side_effects: [],
    resumeActions: [],
    proposal: null,
    nonClaims: NON_CLAIMS,
  };
  if (disposition === 'PRECHECK_READY') {
    receipt.proposal = {
      kind: 'non-executable',
      packageDigest: binding.packageDigest,
      portalIdentityClass: IDENTITY_CLASS,
      packetDigest: binding.packetDigest,
      redactedReason: 'Owner review proposal only; no portal action is encoded or performed.',
    };
  } else if (disposition === 'NOT_SUBMITTED') {
    receipt.resumeActions = [RESUME_ACTION];
  }
  return receipt;
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
  let disposition = 'REJECTED_WITH_EVIDENCE';
  let reason = 'fixture validation denied';
  const evidence = [];
  let binding = {};
  try {
    validateFixtureShell(fixture);
    assertNoForbiddenKeys(fixture);
    assertSafeProposal(fixture.proposal);
    if (fixture.resumeActions?.length === 1) throw new Error('caller-supplied resume action denied');
    const validated = await readAndValidateEvidence(fixture, digests);
    binding = validated;
    if (capabilityState(fixture)) {
      disposition = 'PRECHECK_READY';
      reason = 'same-digest security evidence and reviewer packet validated';
    } else {
      disposition = 'NOT_SUBMITTED';
      reason = 'owner portal authority, verified publisher identity, or portal prerequisite is not confirmed';
    }
  } catch (error) {
    reason = rejectionReason(error);
    evidence.push({ code: 'VALIDATION_DENIED', redactedReason: reason });
  }
  const receipt = makeReceipt(args, fixture, fixtureDigest, digests, disposition, reason, evidence, binding);
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (!args.dryRun) {
    await mkdir(path.dirname(args.receipt), { recursive: true });
    await writeFile(args.receipt, serialized, { mode: 0o644 });
  }
  process.stdout.write(serialized);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`k4c-portal-submission-guard: ${error.message}\n`);
  process.exitCode = 1;
}
