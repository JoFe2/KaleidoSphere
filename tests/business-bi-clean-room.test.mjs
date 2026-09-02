// BI-KS-03 / PORTFOLIO-KS147-FALSIFICATION
// Exact-Main, synthetic-only falsification for one admitted holdout metric.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { canonicalJson } from '../services/bi-control/src/canonical-json.js';
import {
  ADDITIONAL_FAIL_CLOSED_CASE_IDS,
  ALLOWLISTED_CANDIDATE_PATHS,
  CANONICAL_JSON_SHA256,
  FROZEN_COVERAGE_SHA256,
  FROZEN_ENVIRONMENT,
  FROZEN_ENVIRONMENT_SHA256,
  FROZEN_PLAN_SHA256,
  FROZEN_REPOSITORY_IDENTITY,
  FROZEN_RESULT_SHA256,
  INDEPENDENT_ORACLE_CALCULATOR_SHA256,
  ISSUE_ID,
  NAMED_SABOTAGE_CASE_IDS,
  PACKAGE_JSON_SHA256,
  RELEASE_COMMIT_OID,
  RELEASE_TREE_OID,
  SABOTAGE_CASE_IDS,
  TASK_ID,
  buildFalsificationVerification,
  canonicalEvidenceBytes,
  createFrozenCleanRoomContext,
  loadFrozenInputs,
  runAdmittedMetric,
  runSabotageCase,
  verifyCleanRoomContext,
} from '../scripts/run-business-bi-falsification-clean-room.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const VERIFICATION_PATH = path.join(
  ROOT,
  'verification/business-bi-net-revenue-falsification-v1.json',
);
const DOC_PATH = path.join(
  ROOT,
  'docs/evidence/business-bi-net-revenue-v1.md',
);
const SCRIPT_PATH = path.join(
  ROOT,
  'scripts/run-business-bi-falsification-clean-room.mjs',
);

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const inputs = await loadFrozenInputs();
const context = createFrozenCleanRoomContext();
const verificationBytes = await readFile(VERIFICATION_PATH);
const verification = JSON.parse(verificationBytes.toString('utf8'));

function without(object, field) {
  const clone = structuredClone(object);
  delete clone[field];
  return clone;
}

function assertFailClosed(result, caseId) {
  assert.equal(result.caseId, caseId);
  assert.equal(result.state, 'DENIED');
  assert.equal(result.ordinaryAnswer, null);
  assert.equal(result.result, null);
  assert.equal(result.successfulOrdinaryAnswer, false);
  assert.match(result.denialSha256, /^[a-f0-9]{64}$/);
  assert.equal(
    result.denialSha256,
    sha256(canonicalJson(without(result, 'denialSha256'))),
  );
}

test('checked verification is byte-exact generated, canonical content-addressed evidence', async () => {
  const generated = await buildFalsificationVerification(inputs, context);
  assert.deepStrictEqual(verification, generated);
  assert.equal(
    verificationBytes.toString('utf8'),
    `${JSON.stringify(generated, null, 2)}\n`,
  );
  assert.equal(
    verification.verificationSha256,
    sha256(canonicalJson(without(verification, 'verificationSha256'))),
  );
  assert.equal(verification.status, 'GREEN');
  assert.equal(verification.taskId, TASK_ID);
  assert.equal(verification.issue, ISSUE_ID);
});

test('input, metric, plan, oracle, result, coverage, environment, commit, and tree identities are frozen', () => {
  assert.deepStrictEqual(verification.frozenIdentities, {
    coverage: { sha256: FROZEN_COVERAGE_SHA256 },
    environment: { sha256: FROZEN_ENVIRONMENT_SHA256 },
    input: {
      path: 'tests/fixtures/business-bi/net-revenue-holdout-v1.json',
      sha256: '2d0ba0bb806e73a473688d6137c6182f4233aec1bed92aee708c4a052d327a4d',
    },
    metric: {
      path: 'contracts/business-bi/v1/net-revenue.metric.json',
      sha256: '455f735e55f03155c657dc963656ed01363e546345824dfea66b883c287d9d70',
    },
    oracle: {
      independentCalculatorPath: 'tests/business-bi-metric-oracle.test.mjs',
      independentCalculatorSha256: INDEPENDENT_ORACLE_CALCULATOR_SHA256,
      path: 'tests/fixtures/business-bi/net-revenue-oracle-v1.json',
      sha256: 'ce0c135351a8179f08cfca77b91a9624f2f6a7e16fd81cda8c3aba780f4a9164',
    },
    plan: { sha256: FROZEN_PLAN_SHA256 },
    repository: {
      commitOid: RELEASE_COMMIT_OID,
      treeOid: RELEASE_TREE_OID,
    },
    result: { sha256: FROZEN_RESULT_SHA256 },
  });
  assert.deepStrictEqual(verification.repositoryPolicy, FROZEN_REPOSITORY_IDENTITY);
  assert.equal(sha256(canonicalJson(FROZEN_ENVIRONMENT)), FROZEN_ENVIRONMENT_SHA256);
  assert.equal(FROZEN_ENVIRONMENT.canonicalJsonSha256, CANONICAL_JSON_SHA256);
  assert.equal(FROZEN_ENVIRONMENT.packageSha256, PACKAGE_JSON_SHA256);
  assert.equal(process.version, FROZEN_ENVIRONMENT.nodeVersion);
  assert.equal(process.versions.modules, FROZEN_ENVIRONMENT.nodeModulesAbi);
  assert.equal(process.platform, FROZEN_ENVIRONMENT.platform);
  assert.equal(process.arch, FROZEN_ENVIRONMENT.architecture);
});

test('two isolated frozen-byte runs are byte-identical and equal the independently bound oracle', async () => {
  const first = await runAdmittedMetric(
    Object.fromEntries(Object.entries(inputs).map(([key, bytes]) => [key, Buffer.from(bytes)])),
    structuredClone(context),
  );
  const second = await runAdmittedMetric(
    Object.fromEntries(Object.entries(inputs).map(([key, bytes]) => [key, Buffer.from(bytes)])),
    structuredClone(context),
  );
  const firstBytes = canonicalEvidenceBytes(first);
  const secondBytes = canonicalEvidenceBytes(second);
  const oracle = JSON.parse(inputs.oracleBytes.toString('utf8'));

  assert.equal(firstBytes.equals(secondBytes), true);
  assert.deepStrictEqual(first, second);
  assert.equal(first.evidenceSha256, second.evidenceSha256);
  assert.equal(first.evidenceSha256, verification.isolatedRuns.firstEvidenceSha256);
  assert.equal(firstBytes.byteLength, verification.isolatedRuns.evidenceByteLength);
  assert.deepStrictEqual(first.execution.result, oracle.expected);
  assert.equal(first.execution.oracleEquality, 'EXACT');
  assert.equal(oracle.independence.productionAnalysisImports, 0);
  assert.equal(first.metric.count, 1);
  assert.equal(first.metric.admission, 'ADMITTED_SYNTHETIC_HOLDOUT_ONLY');
  assert.equal(first.execution.outputRows, 1);
  assert.equal(first.boundary.productionOrCustomerDataUsed, false);
  assert.equal(first.boundary.secondMetricAdmitted, false);
});

test('the five named sabotage cases deterministically deny before GREEN with no ordinary answer', async () => {
  assert.deepStrictEqual(NAMED_SABOTAGE_CASE_IDS, [
    'WRONG_ORACLE',
    'SUBSTITUTED_METRIC',
    'WIDENED_SCOPE',
    'UNKNOWN_TO_ZERO',
    'CANCELLED_ROW_INCLUSION',
  ]);
  const expectedCodes = {
    WRONG_ORACLE: 'BUSINESS_BI_ORACLE_DIGEST_DENIED',
    SUBSTITUTED_METRIC: 'BUSINESS_BI_METRIC_DIGEST_DENIED',
    WIDENED_SCOPE: 'BUSINESS_BI_OPERATION_DENIED',
    UNKNOWN_TO_ZERO: 'BUSINESS_BI_RESULT_SUBSTITUTION_DENIED',
    CANCELLED_ROW_INCLUSION: 'BUSINESS_BI_RESULT_SUBSTITUTION_DENIED',
  };

  for (const caseId of NAMED_SABOTAGE_CASE_IDS) {
    const first = await runSabotageCase(caseId, inputs, context);
    const second = await runSabotageCase(caseId, inputs, context);
    assertFailClosed(first, caseId);
    assert.deepStrictEqual(first, second, `${caseId} denial must be deterministic`);
    assert.equal(first.reasonCode, expectedCodes[caseId]);
  }

  assert.deepStrictEqual(
    verification.sequence.slice(0, 5).map(({ id, state }) => [id, state]),
    NAMED_SABOTAGE_CASE_IDS.map((id) => [id, 'DENIED']),
  );
  assert.deepStrictEqual(
    verification.sequence.at(-1),
    {
      ordinal: 9,
      id: 'FINAL_GREEN',
      state: 'GREEN',
      evidenceSha256: verification.isolatedRuns.firstEvidenceSha256,
    },
  );
});

test('dirty or unbound bytes, moved head, and environment substitution deterministically deny', async () => {
  assert.deepStrictEqual(ADDITIONAL_FAIL_CLOSED_CASE_IDS, [
    'DIRTY_OR_UNBOUND_BYTES',
    'MOVED_HEAD',
    'ENVIRONMENT_SUBSTITUTION',
  ]);
  for (const caseId of ADDITIONAL_FAIL_CLOSED_CASE_IDS) {
    const first = await runSabotageCase(caseId, inputs, context);
    const second = await runSabotageCase(caseId, inputs, context);
    assertFailClosed(first, caseId);
    assert.deepStrictEqual(first, second, `${caseId} denial must be deterministic`);
  }

  const dirty = await runSabotageCase('DIRTY_OR_UNBOUND_BYTES', inputs, context);
  assert.deepStrictEqual(dirty.componentReasonCodes, [
    'BUSINESS_BI_CLEAN_ROOM_DIRTY_WORKTREE_DENIED',
    'BUSINESS_BI_HOLDOUT_DIGEST_DENIED',
  ]);

  const moved = structuredClone(context);
  moved.repository.releaseCommitOid = '0000000000000000000000000000000000000000';
  assertFailClosed(verifyCleanRoomContext(moved, 'MOVED_HEAD'), 'MOVED_HEAD');

  const substitutedEnvironment = structuredClone(context);
  substitutedEnvironment.environment.architecture = 'arm64';
  assertFailClosed(
    verifyCleanRoomContext(
      substitutedEnvironment,
      'ENVIRONMENT_SUBSTITUTION',
    ),
    'ENVIRONMENT_SUBSTITUTION',
  );
});

test('all eight negative proofs pass before one final GREEN', () => {
  assert.deepStrictEqual(SABOTAGE_CASE_IDS, [
    ...NAMED_SABOTAGE_CASE_IDS,
    ...ADDITIONAL_FAIL_CLOSED_CASE_IDS,
  ]);
  assert.equal(verification.negativeMatrix.length, 8);
  assert.deepStrictEqual(
    verification.negativeMatrix.map(({ ordinal, id, status, observedState }) => ({
      ordinal,
      id,
      status,
      observedState,
    })),
    SABOTAGE_CASE_IDS.map((id, index) => ({
      ordinal: index + 1,
      id,
      status: 'PASS',
      observedState: 'DENIED',
    })),
  );
  for (const proof of verification.negativeMatrix) {
    assert.equal(proof.deterministic, true);
    assert.equal(proof.ordinaryAnswer, null);
    assert.equal(proof.result, null);
    assert.equal(proof.successfulOrdinaryAnswer, false);
  }
  assert.equal(verification.finalGreen.state, 'GREEN');
  assert.equal(verification.finalGreen.execution.state, 'COMPLETE');
  assert.equal(verification.finalGreen.execution.oracleEquality, 'EXACT');
});

test('public claim is one admitted holdout metric and separates criteria from package counts', () => {
  assert.deepStrictEqual(verification.publicClaim.metricIds, [
    'bi-ks-01-net-revenue',
  ]);
  assert.equal(verification.publicClaim.admittedHoldoutMetricCount, 1);
  assert.equal(verification.publicClaim.productionMetricCount, 0);
  assert.equal(verification.publicClaim.broaderBiCapabilityClaimed, false);
  assert.match(
    verification.publicClaim.statement,
    /^Exactly one admitted-holdout metric,/,
  );
  assert.deepStrictEqual(verification.acceptanceSummary, {
    satisfiedCriteria: 3,
    totalCriteria: 3,
  });
  assert.deepStrictEqual(verification.packageSummary, {
    deliveredPackages: 1,
    publishedPackages: 0,
    packageKind: 'LOCAL_FALSIFICATION_EVIDENCE_PACKAGE',
  });
  assert.notStrictEqual(
    verification.acceptanceSummary,
    verification.packageSummary,
  );
  assert.equal(verification.acceptance.length, 3);
  assert.equal(
    verification.acceptance.every(({ status }) => status === 'PASS'),
    true,
  );
});

test('governance reserves exactly one integrated review and one final Sol owner without claiming closure', () => {
  const governance = verification.publicClosureGovernance;
  assert.equal(governance.independentIntegratedReviews.length, 1);
  assert.deepStrictEqual(governance.independentIntegratedReviews[0], {
    ordinal: 1,
    role: 'INDEPENDENT_INTEGRATED_REVIEWER',
    status: 'PENDING_CONTROLLER',
    workerSelfReview: false,
  });
  assert.equal(governance.finalOwners.length, 1);
  assert.equal(governance.finalOwners[0].owner, 'Sol');
  assert.deepStrictEqual(governance.finalOwners[0].requiredStages, [
    'EXACT_PR_MAIN_CI',
    'RELEASE',
    'ANONYMOUS_READBACK',
    'ISSUE_CLOSED',
    'QUEUE_DONE',
  ]);
  assert.equal(governance.publicClosureAuthorized, false);
  assert.equal(verification.deliveryBoundary.pushPerformed, false);
  assert.equal(verification.deliveryBoundary.releasePerformed, false);
  assert.equal(verification.deliveryBoundary.issueClosed, false);
  assert.equal(verification.deliveryBoundary.queueDoneClaimed, false);
});

test('runner and evidence remain local-only and document the exact allowlist', async () => {
  const [source, document] = await Promise.all([
    readFile(SCRIPT_PATH, 'utf8'),
    readFile(DOC_PATH, 'utf8'),
  ]);
  assert.doesNotMatch(
    source,
    /node:(?:http|https|net|tls|dgram)|\bfetch\s*\(|\bwriteFile\s*\(/,
  );
  assert.doesNotMatch(source, /docker|superset/i);
  assert.deepStrictEqual(ALLOWLISTED_CANDIDATE_PATHS, [
    'docs/evidence/business-bi-net-revenue-v1.md',
    'scripts/run-business-bi-falsification-clean-room.mjs',
    'tests/business-bi-clean-room.test.mjs',
    'verification/business-bi-net-revenue-falsification-v1.json',
  ]);
  for (const changedPath of ALLOWLISTED_CANDIDATE_PATHS) {
    assert.equal(document.includes(`\`${changedPath}\``), true, changedPath);
  }
  assert.match(document, /3\/3 satisfied criteria/);
  assert.match(document, /1 delivered local evidence package/);
  assert.match(document, /0 published packages/);
});
