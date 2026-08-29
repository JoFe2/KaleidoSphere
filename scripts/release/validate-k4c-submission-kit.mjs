#!/usr/bin/env node
// Validate the K4C directory submission packet without submitting anything.
// The packet is accepted only when its copy and reviewer matrix are bound to
// the already-recorded local package receipts.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const defaultListing = path.join(root, 'docs', 'release', 'k4c-directory-listing.md');
const defaultReleaseNotes = path.join(root, 'docs', 'release', 'k4c-release-notes.md');
const defaultFixture = path.join(root, 'docs', 'release', 'k4c-reviewer-test-cases-v1.json');
const securityReceipt = path.join(root, 'verification', 'k4c', 'security-license-receipt-v1.json');
const e2eReceipt = path.join(root, 'verification', 'k4c', 'codex-isolated-e2e-v1.json');
const manifest = path.join(root, 'packages', 'codex', 'kaleidosphere', '.codex-plugin', 'plugin.json');
const SCHEMA = 'kaleidosphere/k4c-reviewer-test-cases/v1';
const PACKAGE_DIGEST = 'e513393ed4ee72098968be99da34941fd87fc95ea0046c30b73f8378c25d821a';
const MANIFEST_DIGEST = '64494f3a2e993ba476834dd49dfb1a1a60cfe8671b8ab6f08eb5f86045873b77';
const VERSION = '0.26.0';
const SHA256 = /^[a-f0-9]{64}$/;
const REQUIRED_POSITIVE_IDS = [
  'manifest-validation',
  'install',
  'discovery',
  'declared-skill-use',
  'cleanup',
  'package-digest-inspection',
];
const REQUIRED_NEGATIVE_IDS = [
  'undeclared-skill-use',
  'prohibited-package-content',
  'post-remove-residue',
];
const REQUIRED_COMMAND_IDS = [
  'install-marketplace',
  'install-plugin',
  'discover-skill',
  'use-declared-skill',
  'remove-plugin',
  'remove-marketplace',
  'zero-residue-readback',
];
const REQUIRED_NEGATIVE_EVIDENCE_IDS = [
  'undeclared-skill-invocation',
  'residue-after-cleanup',
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

function parseArgs(argv) {
  const args = { listing: defaultListing, releaseNotes: defaultReleaseNotes, fixture: defaultFixture, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (arg === '--listing' || arg === '--release-notes' || arg === '--fixture') {
      const value = argv[index += 1];
      if (value === undefined || value.startsWith('-')) throw new Error(`missing value for ${arg}`);
      if (arg === '--listing') args.listing = resolveInput(value, 'listing');
      else if (arg === '--release-notes') args.releaseNotes = resolveInput(value, 'release notes');
      else args.fixture = resolveInput(value, 'reviewer case fixture');
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

async function readText(file, label) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    throw new Error(`${label} denied: ${error.code || 'unreadable'}: ${file}`);
  }
}

async function readJson(file, label) {
  const text = await readText(file, label);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} denied: invalid JSON: ${file}`);
  }
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} denied: expected object`);
}

function assertDigest(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error(`${label} denied: expected SHA-256`);
}

function assertText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} denied: expected non-empty text`);
}

function assertReceiptBindings(security, e2e, manifestBytes) {
  assertObject(security, 'security receipt');
  assertObject(e2e, 'isolated E2E receipt');
  if (security.schemaVersion !== 'kaleidosphere/k4c-security-license-receipt/v1') throw new Error('security receipt schema drift denied');
  if (e2e.schemaVersion !== 'kaleidosphere/k4c-codex-isolated-e2e/v1') throw new Error('isolated E2E receipt schema drift denied');
  if (security.packageVersion !== VERSION || e2e.package.version !== VERSION) throw new Error('receipt package version drift denied');
  if (security.packageDigest !== PACKAGE_DIGEST || e2e.package.packageDigest !== PACKAGE_DIGEST) throw new Error('receipt package digest drift denied');
  if (security.manifest?.sha256 !== MANIFEST_DIGEST || e2e.package.manifestSha256 !== MANIFEST_DIGEST) throw new Error('receipt manifest digest drift denied');
  if (sha256(manifestBytes) !== MANIFEST_DIGEST) throw new Error('plugin manifest digest mismatch denied');
  if (security.accepted !== true || security.publicationPerformed !== false) throw new Error('security receipt acceptance boundary denied');
  if (e2e.accepted !== true || e2e.globalConfigurationMutated !== false) throw new Error('isolated E2E acceptance boundary denied');
  if (e2e.boundaryProof?.clean !== true || e2e.boundaryProof?.emptyAfterCleanup !== true) throw new Error('isolated cleanup proof denied');
  const commandIds = new Set((e2e.orderedCommandResults || []).map((item) => item && item.id));
  for (const id of REQUIRED_COMMAND_IDS) if (!commandIds.has(id)) throw new Error(`receipt missing required command: ${id}`);
  const negativeIds = new Set((e2e.negativeAssertions || []).map((item) => item && item.id));
  for (const id of REQUIRED_NEGATIVE_EVIDENCE_IDS) if (!negativeIds.has(id)) throw new Error(`receipt missing required negative assertion: ${id}`);
}

function requiredClaims() {
  return [
    '- Claim: KaleidoSphere is distributed as a skills-only Codex plugin.',
    `- Claim: The package version is \`${VERSION}\`.`,
    '- Claim: The package declares the `kaleidosphere` skill at `skills/kaleidosphere/SKILL.md`.',
    '- Claim: The skill accepts only `status`, `discovery`, `analyze`, `plan`, `preview`, and `readback` actions.',
    '- Claim: When no trusted KaleidoSphere transport is configured, the skill returns `WAITING_EXTERNAL` after local validation.',
    `- Claim: The package SHA-256 digest is \`${PACKAGE_DIGEST}\`.`,
    `- Claim: The plugin manifest SHA-256 digest is \`${MANIFEST_DIGEST}\`.`,
  ];
}

function assertListing(listing) {
  if (!listing.includes('# KaleidoSphere Codex directory listing') || !listing.includes('## Claims')) {
    throw new Error('listing copy denied: required heading missing');
  }
  const claims = listing.split('\n').filter((line) => line.startsWith('- Claim: '));
  for (const claim of claims) {
    if (!requiredClaims().includes(claim)) throw new Error(`unsupported listing claim denied: ${claim}`);
  }
  for (const claim of requiredClaims()) {
    if (!claims.includes(claim)) throw new Error(`listing claim missing: ${claim}`);
  }
  const unsupportedPositiveClaim = /(?:marketplace\s+(?:approval|approved|listing|listed|presence)|(?:is|was|has been|now)\s+(?:published|submitted|approved|listed|deployed)|production[- ]ready|runtime[- ]compatible|customer[- ]data\s+fit(?:ness)?)/i;
  const negativeBoundary = /\b(?:no|not|never|without|does not|do not|claimed)\b/i;
  if (listing.split('\n').some((line) => !negativeBoundary.test(line) && unsupportedPositiveClaim.test(line))) {
    throw new Error('unsupported listing claim denied');
  }
}

function assertReleaseNotes(notes) {
  if (!notes.includes('# KaleidoSphere 0.26.0 release notes') || !notes.includes('## Receipt binding')) {
    throw new Error('release notes denied: required heading missing');
  }
  for (const value of [VERSION, PACKAGE_DIGEST, MANIFEST_DIGEST, 'verification/k4c/security-license-receipt-v1.json', 'verification/k4c/codex-isolated-e2e-v1.json']) {
    if (!notes.includes(value)) throw new Error(`release notes evidence binding missing: ${value}`);
  }
  if (!/No portal form has been submitted\./.test(notes)) throw new Error('release notes portal boundary missing');
}

function assertCase(caseRecord, kind, expectedResult, packetDigest) {
  assertObject(caseRecord, `${kind} reviewer case`);
  assertText(caseRecord.id, `${kind} reviewer case id`);
  if (caseRecord.kind !== kind) throw new Error(`reviewer case kind denied: ${caseRecord.id}`);
  assertText(caseRecord.objective, `reviewer case objective: ${caseRecord.id}`);
  if (!Array.isArray(caseRecord.reviewerSteps) || caseRecord.reviewerSteps.length < 2 || caseRecord.reviewerSteps.some((step) => typeof step !== 'string' || step.trim() === '')) {
    throw new Error(`reviewer steps denied: ${caseRecord.id}`);
  }
  if (caseRecord.expectedResult !== expectedResult) throw new Error(`reviewer case expected result denied: ${caseRecord.id}`);
  if (!Array.isArray(caseRecord.evidence) || caseRecord.evidence.length === 0 || caseRecord.evidence.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw new Error(`reviewer evidence denied: ${caseRecord.id}`);
  }
  if (caseRecord.packageDigest !== packetDigest) throw new Error(`reviewer case digest binding denied: ${caseRecord.id}`);
}

function assertCaseMatrix(fixture) {
  assertObject(fixture, 'reviewer case matrix');
  if (fixture.schemaVersion !== SCHEMA) throw new Error('reviewer case matrix schema drift denied');
  assertObject(fixture.packet, 'reviewer packet binding');
  if (fixture.packet.packageVersion !== VERSION || fixture.packet.packageDigest !== PACKAGE_DIGEST || fixture.packet.manifestSha256 !== MANIFEST_DIGEST) {
    throw new Error('reviewer packet binding denied');
  }
  if (fixture.packet.publicationPerformed !== false) throw new Error('reviewer packet publication claim denied');
  const positives = fixture.positiveCases;
  const negatives = fixture.negativeCases;
  if (!Array.isArray(positives) || positives.length < 5) throw new Error('reviewer case matrix denied: fewer than five positive cases');
  if (!Array.isArray(negatives) || negatives.length < 3) throw new Error('reviewer case matrix denied: fewer than three negative cases');
  const allCases = [...positives, ...negatives];
  const ids = allCases.map((item) => item && item.id);
  const seen = new Set();
  for (const id of ids) {
    if (typeof id !== 'string' || id.trim() === '') throw new Error('reviewer case id denied');
    if (seen.has(id)) throw new Error(`duplicate reviewer case id denied: ${id}`);
    seen.add(id);
  }
  if (!Array.isArray(fixture.requiredPositiveCaseIds) || !Array.isArray(fixture.requiredNegativeCaseIds)) throw new Error('reviewer case coverage lists denied');
  for (const id of REQUIRED_POSITIVE_IDS) {
    if (!fixture.requiredPositiveCaseIds.includes(id) || !positives.some((item) => item.id === id)) throw new Error(`positive reviewer coverage denied: missing ${id}`);
  }
  for (const id of REQUIRED_NEGATIVE_IDS) {
    if (!fixture.requiredNegativeCaseIds.includes(id) || !negatives.some((item) => item.id === id)) throw new Error(`negative reviewer coverage denied: missing ${id}`);
  }
  for (const item of positives) assertCase(item, 'positive', 'accepted', fixture.packet.packageDigest);
  for (const item of negatives) assertCase(item, 'negative', 'denied', fixture.packet.packageDigest);
  const byId = new Map(allCases.map((item) => [item.id, item]));
  if (!byId.get('prohibited-package-content').evidence.some((item) => item.includes('check-k4c-skills-only') || item.includes('prohibited-package-inputs'))) {
    throw new Error('negative reviewer coverage denied: prohibited package content evidence missing');
  }
  if (!byId.get('post-remove-residue').evidence.some((item) => item === 'residue-after-cleanup' || item === 'zero-residue-readback')) {
    throw new Error('negative reviewer coverage denied: post-remove residue evidence missing');
  }
  if (!byId.get('undeclared-skill-use').evidence.some((item) => item === 'use-undeclared-skill-denied' || item === 'undeclared-skill-invocation')) {
    throw new Error('negative reviewer coverage denied: undeclared skill evidence missing');
  }
  if (!Array.isArray(fixture.nonClaims) || fixture.nonClaims.length === 0 || fixture.nonClaims.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw new Error('reviewer matrix non-claims denied');
  }
}

function observeExpectedRejection(fixture, dryRun) {
  assertObject(fixture, 'reviewer case matrix');
  if (fixture.expectedValidation === undefined) return null;
  if (!dryRun) throw new Error('expected validation fixture denied: --dry-run required');
  assertObject(fixture.expectedValidation, 'expected validation');
  if (fixture.expectedValidation.accepted !== false) throw new Error('expected validation denied: accepted must be false');
  assertText(fixture.expectedValidation.error, 'expected validation error');

  let rejection;
  try {
    assertCaseMatrix(fixture);
  } catch (error) {
    rejection = error;
  }
  if (!rejection) throw new Error('expected validation denied: reviewer case matrix was accepted');
  if (rejection.message !== fixture.expectedValidation.error) {
    throw new Error(`expected validation error mismatch: ${rejection.message}`);
  }
  return rejection.message;
}

function buildResult(args, fixture, overrides = {}) {
  return {
    schemaVersion: SCHEMA,
    packageVersion: VERSION,
    packageDigest: PACKAGE_DIGEST,
    manifestSha256: MANIFEST_DIGEST,
    positiveCaseCount: fixture.positiveCases.length,
    negativeCaseCount: fixture.negativeCases.length,
    listing: args.listing === defaultListing ? 'docs/release/k4c-directory-listing.md' : args.listing,
    releaseNotes: args.releaseNotes === defaultReleaseNotes ? 'docs/release/k4c-release-notes.md' : args.releaseNotes,
    publicationPerformed: false,
    accepted: true,
    dryRun: args.dryRun,
    nonClaims: fixture.nonClaims,
    ...overrides,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [listing, notes, fixture, security, e2e, manifestBytes] = await Promise.all([
    readText(args.listing, 'listing copy'),
    readText(args.releaseNotes, 'release notes'),
    readJson(args.fixture, 'reviewer case fixture'),
    readJson(securityReceipt, 'security receipt'),
    readJson(e2eReceipt, 'isolated E2E receipt'),
    readFile(manifest),
  ]);
  assertListing(listing);
  assertReleaseNotes(notes);
  assertReceiptBindings(security, e2e, manifestBytes);
  const rejectionReason = observeExpectedRejection(fixture, args.dryRun);
  if (rejectionReason === null) assertCaseMatrix(fixture);
  const result = buildResult(args, fixture, rejectionReason === null ? {} : {
    accepted: false,
    expectedRejectionObserved: true,
    rejectionReason,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`k4c-submission-kit: ${error.message}\n`);
  process.exitCode = 1;
}
