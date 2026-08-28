#!/usr/bin/env node
// Deterministic local-only integration receipt for the bounded K4C release chain.
// It reads the closed set of local predecessor receipts, pins their raw SHA-256
// digests, and accepts only one shared package digest. It performs no external
// command, portal, directory, network, publication, or release operation.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const defaultFixture = path.join(root, 'tests', 'fixtures', 'release', 'k4c-local-contract-integration-v1.json');
const defaultReceipt = path.join(root, 'verification', 'k4c', 'local-contract-integration-v1.json');
const FIXTURE_SCHEMA = 'kaleidosphere/k4c-local-contract-integration-fixture/v1';
const RECEIPT_SCHEMA = 'kaleidosphere/k4c-local-contract-integration/v1';
const SHA256 = /^[a-f0-9]{64}$/;
const EXPECTED_PREDECESSORS = [
  {
    id: 'security-license',
    path: 'verification/k4c/security-license-receipt-v1.json',
    schemaVersion: 'kaleidosphere/k4c-security-license-receipt/v1',
  },
  {
    id: 'codex-isolated-e2e',
    path: 'verification/k4c/codex-isolated-e2e-v1.json',
    schemaVersion: 'kaleidosphere/k4c-codex-isolated-e2e/v1',
  },
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
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
    throw new Error(`${label} denied: ${error.code || 'unreadable'}: ${labelPath(file)}`);
  }
  try {
    return { bytes, value: JSON.parse(bytes.toString('utf8')) };
  } catch {
    throw new Error(`${label} denied: invalid JSON: ${labelPath(file)}`);
  }
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} denied: expected object`);
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error(`${label} denied: expected SHA-256`);
}

function assertText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} denied: expected non-empty text`);
}

function assertFixture(fixture) {
  assertObject(fixture, 'local contract integration fixture');
  if (fixture.schemaVersion !== FIXTURE_SCHEMA) throw new Error('local contract integration fixture schema drift denied');
  assertObject(fixture.package, 'fixture package');
  assertText(fixture.package.version, 'fixture package version');
  assertSha256(fixture.package.digest, 'fixture package digest');
  assertSha256(fixture.package.manifestSha256, 'fixture manifest digest');

  if (!Array.isArray(fixture.predecessorReceipts) || fixture.predecessorReceipts.length !== EXPECTED_PREDECESSORS.length) {
    throw new Error('fixture predecessor receipt set denied');
  }
  const expectedById = new Map(EXPECTED_PREDECESSORS.map((item) => [item.id, item]));
  const seen = new Set();
  for (const predecessor of fixture.predecessorReceipts) {
    assertObject(predecessor, 'fixture predecessor receipt');
    assertText(predecessor.id, 'fixture predecessor id');
    if (seen.has(predecessor.id)) throw new Error(`duplicate fixture predecessor denied: ${predecessor.id}`);
    seen.add(predecessor.id);
    const expected = expectedById.get(predecessor.id);
    if (!expected || predecessor.path !== expected.path || predecessor.schemaVersion !== expected.schemaVersion) {
      throw new Error(`fixture predecessor binding denied: ${predecessor.id}`);
    }
    assertSha256(predecessor.sha256, `fixture predecessor digest: ${predecessor.id}`);
  }
  for (const expected of EXPECTED_PREDECESSORS) {
    if (!seen.has(expected.id)) throw new Error(`fixture predecessor missing: ${expected.id}`);
  }

  assertObject(fixture.executionBoundary, 'fixture execution boundary');
  for (const field of ['localOnly', 'externalCommandsCalled', 'portalCalls', 'directoryCalls', 'releaseClaimEmitted']) {
    if (fixture.executionBoundary[field] !== (field === 'localOnly')) {
      throw new Error(`fixture execution boundary denied: ${field}`);
    }
  }
  assertObject(fixture.decision, 'fixture decision');
  if (fixture.decision.outcome !== 'accepted' || fixture.decision.scope !== 'local-contract-integration') {
    throw new Error('fixture decision binding denied');
  }
  if (!Array.isArray(fixture.nonClaims) || fixture.nonClaims.length === 0 || fixture.nonClaims.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw new Error('fixture non-claims denied');
  }
}

function packageBinding(predecessor, receipt, packageRecord) {
  if (predecessor.id === 'security-license') {
    if (receipt.packageVersion !== packageRecord.version || receipt.packageDigest !== packageRecord.digest || receipt.manifest?.sha256 !== packageRecord.manifestSha256) {
      throw new Error('security-license package binding denied');
    }
    if (receipt.accepted !== true || receipt.publicationPerformed !== false || receipt.checks?.noExternalCommands !== true) {
      throw new Error('security-license acceptance boundary denied');
    }
    return receipt.packageDigest;
  }
  if (predecessor.id === 'codex-isolated-e2e') {
    if (receipt.package?.version !== packageRecord.version || receipt.package?.packageDigest !== packageRecord.digest || receipt.package?.manifestSha256 !== packageRecord.manifestSha256) {
      throw new Error('codex-isolated-e2e package binding denied');
    }
    if (receipt.accepted !== true || receipt.globalConfigurationMutated !== false || receipt.boundaryProof?.clean !== true || receipt.boundaryProof?.emptyAfterCleanup !== true) {
      throw new Error('codex-isolated-e2e acceptance boundary denied');
    }
    return receipt.package.packageDigest;
  }
  throw new Error(`unrecognized predecessor receipt denied: ${predecessor.id}`);
}

async function readPredecessors(fixture) {
  const records = [];
  for (const predecessor of fixture.predecessorReceipts.slice().sort((a, b) => compareText(a.id, b.id))) {
    const file = path.join(root, ...predecessor.path.split('/'));
    const { bytes, value } = await readJsonWithBytes(file, `predecessor receipt ${predecessor.id}`);
    const digest = sha256(bytes);
    if (digest !== predecessor.sha256) throw new Error(`predecessor receipt digest mismatch denied: ${predecessor.id}`);
    if (value.schemaVersion !== predecessor.schemaVersion) throw new Error(`predecessor receipt schema drift denied: ${predecessor.id}`);
    const packageDigest = packageBinding(predecessor, value, fixture.package);
    records.push({
      id: predecessor.id,
      path: predecessor.path,
      schemaVersion: predecessor.schemaVersion,
      sha256: digest,
      packageDigest,
    });
  }
  return records;
}

function bindingDigest(packageRecord, predecessors) {
  return sha256(JSON.stringify({
    schemaVersion: RECEIPT_SCHEMA,
    package: packageRecord,
    predecessorReceipts: predecessors,
  }, null, 2));
}

function buildReceipt(args, fixtureBytes, fixture, predecessors) {
  const digest = bindingDigest(fixture.package, predecessors);
  return {
    schemaVersion: RECEIPT_SCHEMA,
    fixture: labelPath(args.fixture),
    fixtureSha256: sha256(fixtureBytes),
    package: fixture.package,
    predecessorReceipts: predecessors,
    bindingDigest: digest,
    decision: {
      outcome: fixture.decision.outcome,
      scope: fixture.decision.scope,
      packageDigest: fixture.package.digest,
      bindingDigest: digest,
      releaseClaimEmitted: false,
    },
    executionBoundary: fixture.executionBoundary,
    accepted: true,
    nonClaims: fixture.nonClaims,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { bytes: fixtureBytes, value: fixture } = await readJsonWithBytes(args.fixture, 'local contract integration fixture');
  assertFixture(fixture);
  const predecessors = await readPredecessors(fixture);
  const receipt = buildReceipt(args, fixtureBytes, fixture, predecessors);
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
  process.stderr.write(`k4c-local-contract-integration: ${error.message}\n`);
  process.exitCode = 1;
}
