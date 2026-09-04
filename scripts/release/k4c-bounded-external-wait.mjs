#!/usr/bin/env node
// Bounded external-wait evidence for the K4c Codex distribution on this base.
//
// Pure, one-shot, fail-closed. Reads the committed K4c receipts (each
// digest-verified against a known-good hash), verifies their cross-receipt
// package digest is consistent, and derives the REAL terminal-condition state
// of the distribution on this base. It performs no portal submission, no live
// anonymous readback, no receipt mutation, and uses no network.
//
// The committed terminal-evidence and delivery-readback receipts are
// fixture-bound capability demonstrations on recorded evidence sets. This record
// states the actual (non-terminal) base state: the release is not public because
// the bounded external steps (owner portal identity, a live same-digest portal
// submission, and a live anonymous public-directory readback) have not been
// performed or established.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const RECEIPT_SCHEMA = 'kaleidosphere/k4c-bounded-external-wait/v1';
const IDENTITY_RESUME_ACTION =
  'Owner resumes in the official portal UI to verify owner authority and publisher identity.';
const ROLLBACK_TEXT =
  'Safe rollback when authorized: remove the local cache, or withdraw the draft and publish the corrected successor.';
const PACKAGE = Object.freeze({
  name: 'kaleidosphere',
  version: '0.26.0',
  digest: 'e513393ed4ee72098968be99da34941fd87fc95ea0046c30b73f8378c25d821a',
  manifestSha256: '64494f3a2e993ba476834dd49dfb1a1a60cfe8671b8ab6f08eb5f86045873b77',
});
const TASK = Object.freeze({ id: 'KS076-CODEX-DISTRIBUTION', issue: 'KS76' });
const DEFAULT_BASE = path.resolve(import.meta.dirname, '..', '..');

const INPUTS = Object.freeze([
  { key: 'securityLicense', path: 'verification/k4c/security-license-receipt-v1.json', schema: 'kaleidosphere/k4c-security-license-receipt/v1', sha256: '3e417d7bad6339c4313bc785bd4c606c9c8e599ed1622bbe364120f6968ce9af' },
  { key: 'codexE2e', path: 'verification/k4c/codex-isolated-e2e-v1.json', schema: 'kaleidosphere/k4c-codex-isolated-e2e/v1', sha256: 'efa866ac86fdb14dec4c73643fae829bb58ee24bfa43ad43e9dbc387b64b5311' },
  { key: 'localContract', path: 'verification/k4c/local-contract-integration-v1.json', schema: 'kaleidosphere/k4c-local-contract-integration/v1', sha256: '84a413920d610c1dc0721eeb5d68485298f3313be3e19c8653b9fb4d765219ec' },
  { key: 'portal', path: 'verification/k4c/portal-submission-receipt-v1.json', schema: 'kaleidosphere/k4c-portal-submission-receipt/v1', sha256: '013fd90eb5a6aad8122953284e825cf47741f51526916fcb18b8726ea994e3fc' },
  { key: 'anonymous', path: 'verification/k4c/anonymous-directory-readback-v1.json', schema: 'kaleidosphere/k4c-anonymous-directory-readback/v1', sha256: '90b85deef6961c0fe0845ed51843b5447133c4b98a668a58b5d3059e2e392b53' },
  { key: 'terminalEvidence', path: 'verification/k4c/terminal-evidence-v1.json', schema: 'kaleidosphere/k4c-terminal-evidence-receipt/v1', sha256: 'd80cf57f869db6bffc833b7f53948a7bd1ba48c84ab92a635c2321199d38e0da' },
  { key: 'deliveryReadback', path: 'verification/k4c/delivery-readback-v1.json', schema: 'kaleidosphere/k4c-delivery-readback-receipt/v1', sha256: '3904b5a0754fddb31f223b2ec6974d5c8881d3ff6266d9bdd3b085447afbc8b1' },
]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function inside(scope, candidate) {
  return candidate === scope || candidate.startsWith(`${scope}${path.sep}`);
}

function resolveBase(value) {
  const resolved = path.resolve(value);
  if (!inside(DEFAULT_BASE, resolved) && !inside(os.tmpdir(), resolved)) {
    throw new Error(`root path outside repository or temporary scope denied: ${value}`);
  }
  return resolved;
}

function resolveReceiptPath(value) {
  const resolved = path.resolve(value);
  if (!inside(DEFAULT_BASE, resolved) && !inside(os.tmpdir(), resolved)) {
    throw new Error(`receipt path outside repository or temporary scope denied: ${value}`);
  }
  return resolved;
}

function parseArgs(argv) {
  const args = { base: DEFAULT_BASE, receipt: null, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--root') {
      const value = argv[index += 1];
      if (value === undefined || value.startsWith('-')) throw new Error('missing value for --root');
      args.base = resolveBase(value);
    } else if (arg === '--receipt') {
      const value = argv[index += 1];
      if (value === undefined || value.startsWith('-')) throw new Error('missing value for --receipt');
      args.receipt = resolveReceiptPath(value);
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (args.receipt === null) args.receipt = path.join(args.base, 'docs', 'release', 'k4c-bounded-external-wait-v1.json');
  return args;
}

async function readBytes(file, label) {
  try {
    return await readFile(file);
  } catch (error) {
    throw new Error(`${label} denied: ${error.code || 'unreadable'}: ${file}`);
  }
}

function parseDocument(bytes, label) {
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value;
  } catch {
    throw new Error(`${label} denied: invalid JSON`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label} denied: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function loadInputs(base) {
  const documents = {};
  for (const input of INPUTS) {
    const file = path.resolve(base, input.path);
    const bytes = await readBytes(file, input.key);
    assertEqual(sha256(bytes), input.sha256, `receipt digest drift denied: ${input.key}`);
    const document = parseDocument(bytes, input.key);
    assertEqual(document.schemaVersion, input.schema, `receipt schema drift denied: ${input.key}`);
    documents[input.key] = document;
  }
  // Cross-receipt package digest consistency: one package, one digest.
  assertEqual(documents.securityLicense.packageDigest, PACKAGE.digest, 'mixed package digest denied: securityLicense');
  assertEqual(documents.codexE2e.package.packageDigest, PACKAGE.digest, 'mixed package digest denied: codexE2e');
  assertEqual(documents.localContract.decision.packageDigest, PACKAGE.digest, 'mixed package digest denied: localContract');
  assertEqual(documents.portal.proposal.packageDigest, PACKAGE.digest, 'mixed package digest denied: portal');
  assertEqual(documents.anonymous.package.digest, PACKAGE.digest, 'mixed package digest denied: anonymous');
  assertEqual(documents.terminalEvidence.package.digest, PACKAGE.digest, 'mixed package digest denied: terminalEvidence');
  // The source-local chain is complete, accepted, and emitted no release claim.
  assertEqual(documents.securityLicense.accepted, true, 'source-local chain denied: securityLicense not accepted');
  assertEqual(documents.securityLicense.publicationPerformed, false, 'source-local chain denied: publication was performed');
  assertEqual(documents.codexE2e.accepted, true, 'source-local chain denied: codexE2e not accepted');
  assertEqual(documents.codexE2e.mode, 'fixture', 'codex e2e mode drift denied');
  assertEqual(documents.localContract.accepted, true, 'source-local chain denied: localContract not accepted');
  assertEqual(documents.localContract.decision.releaseClaimEmitted, false, 'release claim denied: localContract emitted a release claim');
  // The capability demos are recorded-fixture and proposal-only, not live.
  assertEqual(documents.portal.disposition, 'PRECHECK_READY', 'portal capability demo drift denied');
  assertEqual(documents.portal.proposal.kind, 'non-executable', 'portal proposal must be non-executable');
  assertEqual(documents.anonymous.mode, 'fixture', 'anonymous demo must be fixture-bound');
  return documents;
}

function bound(key, document) {
  const input = INPUTS.find((entry) => entry.key === key);
  return { key, path: input.path, schemaVersion: document.schemaVersion, sha256: input.sha256 };
}

function buildRecord(documents) {
  return {
    schemaVersion: RECEIPT_SCHEMA,
    task: { ...TASK },
    terminalState: 'nonterminal-external-wait',
    disposition: 'NOT_RELEASED',
    publicListingClaim: false,
    package: { ...PACKAGE },
    sourceLocalChain: [
      { ...bound('securityLicense', documents.securityLicense), accepted: documents.securityLicense.accepted, publicationPerformed: documents.securityLicense.publicationPerformed },
      { ...bound('codexE2e', documents.codexE2e), accepted: documents.codexE2e.accepted, mode: documents.codexE2e.mode },
      { ...bound('localContract', documents.localContract), accepted: documents.localContract.accepted, releaseClaimEmitted: documents.localContract.decision.releaseClaimEmitted },
    ],
    capabilityDemos: [
      { ...bound('portal', documents.portal), recordedDisposition: documents.portal.disposition, provenance: 'fixture-recorded-portal-preflight' },
      { ...bound('anonymous', documents.anonymous), mode: documents.anonymous.mode, recordedPublicListingClaim: documents.anonymous.publicListingClaim, provenance: 'fixture-recorded-directory-transcripts' },
      { ...bound('terminalEvidence', documents.terminalEvidence), recordedDisposition: documents.terminalEvidence.disposition, provenance: 'fixture-recorded-evidence-set' },
      { ...bound('deliveryReadback', documents.deliveryReadback), recordedTerminalDisposition: documents.deliveryReadback.terminalDisposition, provenance: 'fixture-recorded-delivery-readback' },
    ],
    externalBoundaries: [
      { id: 'portal-identity-verification', satisfied: false, authority: 'owner-official-ui', note: 'Requires owner authority and a verified publisher identity established in the official portal UI.' },
      { id: 'live-portal-submission', satisfied: false, note: 'A live, same-digest portal submission has not been performed or established.' },
      { id: 'live-anonymous-directory-readback', satisfied: false, note: 'A live anonymous public-directory discovery and matching-digest install readback has not been performed.' },
    ],
    resumeActions: [IDENTITY_RESUME_ACTION],
    rollback: ROLLBACK_TEXT,
    side_effects: [],
    nonClaims: [
      'This record is a bounded local classification of the committed receipts; it performs no portal submission, publication, listing, identity, credential, or release operation and uses no network.',
      'No public listing is claimed: publicListingClaim is false until a live anonymous public-directory discovery and matching-digest install readback is recorded.',
      'The capabilityDemos entries are fixture-bound demonstrations on recorded evidence sets; a recorded RELEASED disposition there is not a claim that this base was publicly released.',
      'The single resumeAction is the exact bounded external step; it encodes no authority, performs no mutation, and transfers no execution.',
    ],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const documents = await loadInputs(args.base);
  const receipt = buildRecord(documents);
  const text = `${JSON.stringify(receipt, null, 2)}\n`;
  if (args.dryRun) {
    process.stdout.write(text);
    return;
  }
  await mkdir(path.dirname(args.receipt), { recursive: true });
  await writeFile(args.receipt, text);
  process.stdout.write(text);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`k4c-bounded-external-wait: ${error.message}\n`);
  process.exitCode = 1;
}