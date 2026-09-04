#!/usr/bin/env node
// Bounded external-wait evidence for the K4D Claude Code distribution on this base.
//
// Pure, one-shot, fail-closed. Reads the committed K4D receipts (each
// digest-verified against a known-good hash), verifies their cross-receipt
// package digest is consistent, and derives the REAL terminal-condition state of
// the distribution on this base. It performs no marketplace submission, no live
// anonymous readback, no receipt mutation, and uses no network.
//
// This record states the actual (non-terminal) base state: the release is not
// public because the bounded external steps (owner marketplace identity, a live
// same-digest marketplace submission, and a live anonymous public-directory
// readback) have not been performed or established. The three committed receipts
// are the deterministic, source-local evidence chain (manifest validation,
// skills-only security/license guard, isolated runtime lifecycle).

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const RECEIPT_SCHEMA = 'kaleidosphere/k4d-bounded-external-wait/v1';
const IDENTITY_RESUME_ACTION =
  'Owner resumes in the official Claude Code marketplace UI to verify owner authority and publisher identity before any submission or terms acceptance.';
const ROLLBACK_TEXT =
  'Safe rollback when authorized: remove the local marketplace cache, or withdraw the draft and publish the corrected successor.';
const PACKAGE = Object.freeze({
  name: 'kaleidosphere',
  version: '0.26.0',
  digest: 'a9dfd0e40633c13ab7b04f15bdbfd8d5fa579453717272a9542a87567b13a255',
  manifestSha256: 'b8a53a99c90b10982ca7cd15291d000291dc6a0e511b6b6ff53b2222741ae42d',
});
const TASK = Object.freeze({ id: 'KS077-CLAUDE-DISTRIBUTION', issue: 'KS77' });
const DEFAULT_BASE = path.resolve(import.meta.dirname, '..', '..');

const INPUTS = Object.freeze([
  { key: 'manifestValidation', path: 'generated/claude/receipts/manifest-validation-receipt-v1.json', schema: 'kaleidosphere/k4d-manifest-validation-receipt/v1', sha256: '992acfefbf8a8b57cf2b7ab2c356b0e9a4190f060fbad353b2202a051f6d935d' },
  { key: 'securityLicense', path: 'generated/claude/receipts/skills-only-security-license-receipt-v1.json', schema: 'kaleidosphere/k4d-skills-only-security-license-receipt/v1', sha256: 'bc5f8fa5440c31dfef10f7cd721c9c4a6d017327c0133d3cad8f1f16a064967c' },
  { key: 'claudeE2e', path: 'generated/claude/receipts/claude-isolated-e2e-v1.json', schema: 'kaleidosphere/k4d-claude-isolated-e2e/v1', sha256: '274cddc31469c5bef531b40480468ecbb10f3a1054c8f6c096ac09e6d5f7fe01' },
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
  if (args.receipt === null) args.receipt = path.join(args.base, 'docs', 'release', 'k4d-bounded-external-wait-v1.json');
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
  assertEqual(documents.manifestValidation.packageDigest, PACKAGE.digest, 'mixed package digest denied: manifestValidation');
  assertEqual(documents.securityLicense.packageDigest, PACKAGE.digest, 'mixed package digest denied: securityLicense');
  assertEqual(documents.claudeE2e.package.packageDigest, PACKAGE.digest, 'mixed package digest denied: claudeE2e');
  // Cross-receipt manifest digest consistency.
  assertEqual(documents.manifestValidation.manifest?.sha256, PACKAGE.manifestSha256, 'mixed manifest digest denied: manifestValidation');
  assertEqual(documents.securityLicense.manifest?.sha256, PACKAGE.manifestSha256, 'mixed manifest digest denied: securityLicense');
  assertEqual(documents.claudeE2e.package.manifestSha256, PACKAGE.manifestSha256, 'mixed manifest digest denied: claudeE2e');
  // The source-local chain is complete, accepted, and emitted no release claim.
  assertEqual(documents.manifestValidation.accepted, true, 'source-local chain denied: manifestValidation not accepted');
  assertEqual(documents.manifestValidation.publicationPerformed, false, 'source-local chain denied: manifestValidation publication was performed');
  assertEqual(documents.securityLicense.accepted, true, 'source-local chain denied: securityLicense not accepted');
  assertEqual(documents.securityLicense.publicationPerformed, false, 'source-local chain denied: publication was performed');
  assertEqual(documents.claudeE2e.accepted, true, 'source-local chain denied: claudeE2e not accepted');
  assertEqual(documents.claudeE2e.mode, 'fixture', 'claude e2e mode drift denied');
  assertEqual(documents.claudeE2e.globalConfigurationMutated, false, 'claude e2e boundary denied: global configuration was mutated');
  assertEqual(documents.claudeE2e.boundaryProof?.clean, true, 'claude e2e cleanup proof denied: not clean');
  assertEqual(documents.claudeE2e.boundaryProof?.emptyAfterCleanup, true, 'claude e2e cleanup proof denied: not empty after cleanup');
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
      { ...bound('manifestValidation', documents.manifestValidation), accepted: documents.manifestValidation.accepted, publicationPerformed: documents.manifestValidation.publicationPerformed },
      { ...bound('securityLicense', documents.securityLicense), accepted: documents.securityLicense.accepted, publicationPerformed: documents.securityLicense.publicationPerformed },
      { ...bound('claudeE2e', documents.claudeE2e), accepted: documents.claudeE2e.accepted, mode: documents.claudeE2e.mode },
    ],
    capabilityDemos: [],
    externalBoundaries: [
      { id: 'marketplace-identity-verification', satisfied: false, authority: 'owner-official-marketplace-ui', note: 'Requires owner authority and a verified publisher identity established in the official Claude Code marketplace UI.' },
      { id: 'live-marketplace-submission', satisfied: false, note: 'A live, same-digest marketplace submission has not been performed or established.' },
      { id: 'live-anonymous-directory-readback', satisfied: false, note: 'A live anonymous public-directory discovery and matching-digest install readback has not been performed.' },
    ],
    resumeActions: [IDENTITY_RESUME_ACTION],
    rollback: ROLLBACK_TEXT,
    side_effects: [],
    nonClaims: [
      'This record is a bounded local classification of the committed receipts; it performs no marketplace submission, publication, listing, identity, credential, or release operation and uses no network.',
      'No public listing is claimed: publicListingClaim is false until a live anonymous public-directory discovery and matching-digest install readback is recorded.',
      'capabilityDemos is empty because no recorded-fixture marketplace capability demonstration (submission, anonymous readback, terminal evidence, or delivery readback) has been established on this base.',
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
  process.stderr.write(`k4d-bounded-external-wait: ${error.message}\n`);
  process.exitCode = 1;
}