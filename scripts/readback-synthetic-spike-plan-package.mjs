#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { runDryRun } from './dry-run-synthetic-connector-spike.mjs';
import { validateContracts } from './validate-synthetic-connector-spike-plan.mjs';

export const RECEIPT_SCHEMA = 'kaleidosphere/synthetic-spike-plan-package-readback/v2';
export const REJECTED_WITH_EVIDENCE = 'REJECTED_WITH_EVIDENCE';
export const NO_GO = 'NO_GO';
export const ISSUE = 92;
export const BASE_SHA = '664447988841eed2f9023f29ab7ba7025562e524';
export const HISTORICAL_PROVENANCE_SHA = '33998d49d61eb191113d7d853187b4cb5e1d1fb6';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, '..');
const PLAN_PATH = 'docs/future/remote-connector/SYNTHETIC_SPIKE_PLAN.md';
const FIXTURE_PATH = 'docs/future/remote-connector/fixtures/synthetic-connector-fixture-v1.json';
const AUTHORIZATION_PACKET_PATH = 'docs/future/remote-connector/SYNTHETIC_SPIKE_AUTHORIZATION_PACKET.md';

export const PACKAGE_PATHS = [
  'docs/future/remote-connector/SYNTHETIC_SPIKE_AUTHORIZATION_PACKET.md',
  'docs/future/remote-connector/SYNTHETIC_SPIKE_CLOSURE_CHECKLIST.md',
  'docs/future/remote-connector/SYNTHETIC_SPIKE_DRY_RUN.md',
  'docs/future/remote-connector/SYNTHETIC_SPIKE_EVIDENCE_INDEX.md',
  'docs/future/remote-connector/SYNTHETIC_SPIKE_PLAN.md',
  'docs/future/remote-connector/fixtures/README.md',
  'docs/future/remote-connector/fixtures/synthetic-connector-fixture-v1.json',
  'scripts/dry-run-synthetic-connector-spike.mjs',
  'scripts/readback-synthetic-spike-plan-package.mjs',
  'scripts/validate-synthetic-connector-spike-plan.mjs',
  'tests/dry-run-synthetic-connector-spike.test.mjs',
  'tests/future/remote-connector/92/synthetic-spike-plan.test.mjs',
  'tests/readback-synthetic-spike-plan-package.test.mjs',
  'tests/validate-synthetic-connector-spike-plan.test.mjs',
];

const REQUIRED_ABSENCE_CODES = [
  'FRC.0-EVIDENCE-ABSENT',
  'FRC.1-EVIDENCE-ABSENT',
  'FRC.2-EVIDENCE-ABSENT',
  'PRODUCT-AUTHORIZATION-ABSENT',
  'SECURITY-AUTHORIZATION-ABSENT',
  'WORTH-RUNNING-EVIDENCE-ABSENT',
];

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function packageDigest(packageFiles) {
  const binding = packageFiles.map(({ path, actualSha256 }) => ({ path, sha256: actualSha256 }));
  return sha256(JSON.stringify(binding));
}

function check(id, requirement, passed, detail) {
  return passed ? { id, requirement, status: 'PASS' } : { id, requirement, status: 'FAIL', detail };
}

function receipt(checks, packageFiles) {
  const failures = checks.filter(({ status }) => status === 'FAIL');
  return {
    schemaVersion: RECEIPT_SCHEMA,
    issue: ISSUE,
    immutableBaseSha: BASE_SHA,
    currentCheckoutBinding: {
      pathCount: packageFiles.length,
      algorithm: 'sha256',
      aggregateCanonicalization: 'JSON.stringify ordered [{path,sha256}] with repository-relative paths',
      packageDigest: packageDigest(packageFiles),
    },
    provenance: {
      historicalArtifactHeadSha: HISTORICAL_PROVENANCE_SHA,
      requiredToExist: false,
      authorityForCurrentBytes: false,
      integrationShaClaimed: false,
    },
    decision: {
      terminalOutcome: REJECTED_WITH_EVIDENCE,
      executionDecision: NO_GO,
      owner: 'final issue #92 delivery owner',
      reasons: REQUIRED_ABSENCE_CODES,
      affectedScope: 'issue #92 FRC.3 synthetic spike execution eligibility only',
      supersessionConditions: [
        'bind independently issued FRC.0-FRC.2 completion or exact scope-down evidence to the then-current package',
        'bind distinct product and security authorizations to the then-current package',
        'bind an independently owned worth-running decision to the then-current package',
        'rerun internal validation and final-owner canonical integration checks',
      ],
    },
    internalPackageValidation: failures.length === 0 ? 'PASS' : 'FAIL',
    localOnly: {
      networkAccessed: false,
      githubContacted: false,
      externalInputsAccepted: false,
      gitHistoryRequired: false,
    },
    execution: {
      authorized: false,
      started: false,
      connectorImplemented: false,
      connectorExecuted: false,
      mcpListed: false,
      mcpExecuted: false,
      mutationCapableActionUsed: false,
      customerOrProviderDataUsed: false,
      liveCredentialUsed: false,
      publicBindOrEndpointCreated: false,
      deploymentOrComplianceReadinessClaimed: false,
      callerAuthoredAuthorityAccepted: false,
    },
    nonclaims: [
      'no closure-audit/controller receipt was created by this worker',
      'no future integration commit or SHA is claimed',
      'no connector, MCP, network, deployment, release, compliance, customer-valid, or production-readiness result is claimed',
      'internal plan, fixture, test, and simulation checks do not grant G-1 through G-6',
    ],
    packageFiles,
    checks,
    failureIds: failures.map(({ id }) => id),
  };
}

export async function readLocalPackage(repositoryRoot = REPOSITORY_ROOT) {
  const entries = await Promise.all(PACKAGE_PATHS.map(async (path) => {
    try {
      const bytes = await readFile(resolve(repositoryRoot, path));
      return { path, checkoutSha256: sha256(bytes), text: bytes.toString('utf8') };
    } catch {
      return { path, checkoutSha256: null, text: null };
    }
  }));
  const byPath = new Map(entries.map((entry) => [entry.path, entry.text]));
  let fixture = null;
  try {
    fixture = JSON.parse(byPath.get(FIXTURE_PATH));
  } catch {
    fixture = null;
  }
  return {
    entries,
    planText: byPath.get(PLAN_PATH),
    fixture,
    authorizationPacket: byPath.get(AUTHORIZATION_PACKET_PATH),
  };
}

export function evaluateLocalPackage(localPackage, { dryRun } = {}) {
  const checks = [];
  const packageFiles = [];
  for (const { path, checkoutSha256, text } of localPackage.entries) {
    const actualSha256 = text === null ? null : sha256(Buffer.from(text, 'utf8'));
    packageFiles.push({ path, actualSha256 });
    checks.push(check(
      `PACKAGE-${path}`,
      'current bytes remain identical to the bytes captured for this readback evaluation',
      actualSha256 !== null && actualSha256 === checkoutSha256,
      actualSha256 === null ? `${path} is unreadable` : `${path} has stale or substituted bytes`,
    ));
  }
  checks.push(check('PACKAGE-COMPLETE', 'all 14 reconciled paths are bound exactly once',
    packageFiles.length === 14 && new Set(packageFiles.map(({ path }) => path)).size === 14
      && PACKAGE_PATHS.every((path) => packageFiles.some((entry) => entry.path === path && entry.actualSha256 !== null)),
    'the current-checkout package is incomplete or duplicated'));

  const validation = validateContracts(localPackage.planText, localPackage.fixture);
  checks.push(check('PLAN-FIXTURE-INTERNAL', 'plan and fixture pass internal offline contract validation',
    validation.outcome === 'VALIDATED' && validation.valid === true && validation.failedCount === 0,
    'plan or fixture internal validation failed'));

  const packetText = localPackage.authorizationPacket;
  checks.push(check('PREREQUISITES-EXPLICITLY-ABSENT', 'all absent prerequisites are explicit and fail closed',
    typeof packetText === 'string' && REQUIRED_ABSENCE_CODES.every((code) => packetText.includes(code)),
    'one or more required absence reasons is missing'));
  checks.push(check('PACKET-NONAUTHORITY', 'packet denies caller-authored authority and delegates closure evidence to the final owner',
    typeof packetText === 'string' && packetText.includes('caller-authored authority')
      && packetText.includes('final issue #92 delivery owner'),
    'packet lacks the required owner or non-authority statement'));

  if (dryRun !== undefined) {
    checks.push(check('LOCAL-FIXTURE-SIMULATION', 'local fixture simulation is finite and non-authorizing while preflight remains NO_GO',
      dryRun?.outcome === 'SIMULATED_SUCCESS' && dryRun.simulated === true
        && dryRun.preflight?.decision === NO_GO
        && dryRun.preflight?.gates?.every(({ status }) => status === 'NOT_GRANTED')
        && dryRun.connectorExecuted === false && dryRun.mcpExecuted === false
        && dryRun.networkAccessed === false && dryRun.spikeAuthorized === false
        && dryRun.cleanup?.status === 'PASS' && dryRun.readback?.byteIdentical === true,
      'local simulation is missing, authorizing, externally active, or lacks cleanup/readback integrity'));
  }

  return receipt(checks, packageFiles);
}

export async function runLocalReadback(repositoryRoot = REPOSITORY_ROOT) {
  const localPackage = await readLocalPackage(repositoryRoot);
  const dryRun = await runDryRun({
    fixturePath: resolve(repositoryRoot, FIXTURE_PATH),
    simulate: true,
    authorizationEvidence: true,
  });
  return evaluateLocalPackage(localPackage, { dryRun });
}

async function main() {
  if (process.argv.length !== 2) {
    const invalid = receipt([
      check('INPUT-ARGS', 'readback accepts no arguments and reads only the fixed local package', false, 'unexpected command-line arguments'),
    ], []);
    process.stdout.write(`${JSON.stringify(invalid, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }
  const result = await runLocalReadback();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.internalPackageValidation !== 'PASS') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
