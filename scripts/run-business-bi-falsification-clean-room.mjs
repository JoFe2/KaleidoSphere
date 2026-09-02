#!/usr/bin/env node

// BI-KS-03 / PORTFOLIO-KS147-FALSIFICATION
//
// Local-only falsification of exactly one admitted synthetic holdout metric.
// The product bytes under test are fixed to the named Main/release commit. This
// file has no network, credential, source connection, SQL, mutation, publish,
// push, merge, release, issue, or queue authority.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { endianness } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from '../services/bi-control/src/canonical-json.js';
import {
  ADMITTED_HOLDOUT_SHA256,
  ADMITTED_METRIC_CONTRACT_SHA256,
  ADMITTED_ORACLE_SHA256,
  compileNetRevenuePlan,
  createNetRevenueOperationRequest,
  executeNetRevenuePlan,
  verifyNetRevenueExecutionReceipt,
} from '../services/bi-control/src/business-bi/net-revenue-plan.mjs';

const SELF_PATH = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SELF_PATH), '..');

export const TASK_ID = 'PORTFOLIO-KS147-FALSIFICATION';
export const ISSUE_ID = 'BI-KS-03';
export const RELEASE_COMMIT_OID =
  '764d0f7a1bad9e8e407b96e1b2340baa1e001af6';
export const RELEASE_TREE_OID =
  'e5c6b82aba35a0f760a497c78cf4826dfbb3d104';
export const FROZEN_PLAN_SHA256 =
  '90bca7ef18339928f1dd70bcfc5288e853045bd5f08776c700a7c863ec4526a8';
export const FROZEN_RESULT_SHA256 =
  'ab756c46131ab8d1be491b5ef7f082587fc1475a7fff4f20443966e97cbe02fc';
export const FROZEN_COVERAGE_SHA256 =
  'aae3a6a637b58cb5eb340bebcbaa5f75ae333cade1a6438b548ebeaee7e55338';
export const INDEPENDENT_ORACLE_CALCULATOR_SHA256 =
  '2aac1ef285ac0e8637786507dd7d03fd0bcf0e4bc0ebe8e875085071bb3a17b5';
export const CANONICAL_JSON_SHA256 =
  'e0ab8804532a55b161407e59167cf3027ebceb7df72a4d1dd1a485b1db4400ec';
export const PACKAGE_JSON_SHA256 =
  'cb9622a5e3b7bc8508ae7d443734db4f2606d4ca1e275192d3ecf34928a78710';
export const FROZEN_ENVIRONMENT_SHA256 =
  'ae82ec35cbb149f52da9d6a2cf281ec8f2412c0a87015c545a5393b494627575';

export const ALLOWLISTED_CANDIDATE_PATHS = Object.freeze([
  'docs/evidence/business-bi-net-revenue-v1.md',
  'scripts/run-business-bi-falsification-clean-room.mjs',
  'tests/business-bi-clean-room.test.mjs',
  'verification/business-bi-net-revenue-falsification-v1.json',
]);

export const NAMED_SABOTAGE_CASE_IDS = Object.freeze([
  'WRONG_ORACLE',
  'SUBSTITUTED_METRIC',
  'WIDENED_SCOPE',
  'UNKNOWN_TO_ZERO',
  'CANCELLED_ROW_INCLUSION',
]);

export const ADDITIONAL_FAIL_CLOSED_CASE_IDS = Object.freeze([
  'DIRTY_OR_UNBOUND_BYTES',
  'MOVED_HEAD',
  'ENVIRONMENT_SUBSTITUTION',
]);

export const SABOTAGE_CASE_IDS = Object.freeze([
  ...NAMED_SABOTAGE_CASE_IDS,
  ...ADDITIONAL_FAIL_CLOSED_CASE_IDS,
]);

const PATHS = Object.freeze({
  metric: 'contracts/business-bi/v1/net-revenue.metric.json',
  input: 'tests/fixtures/business-bi/net-revenue-holdout-v1.json',
  oracle: 'tests/fixtures/business-bi/net-revenue-oracle-v1.json',
  oracleCalculator: 'tests/business-bi-metric-oracle.test.mjs',
  canonicalJson: 'services/bi-control/src/canonical-json.js',
  package: 'package.json',
  verification: 'verification/business-bi-net-revenue-falsification-v1.json',
});

const EXPECTED_RESULT = Object.freeze({
  periods: Object.freeze({
    current: Object.freeze({
      netMinorUnits: 100059,
      saleMinorUnits: 141293,
      creditMinorUnits: 41234,
      cancelCount: 1,
      unknown: Object.freeze({
        count: 1,
        quantifiedAmountMinorUnits: 0,
        unquantifiedCount: 1,
      }),
      rowCount: 6,
    }),
    comparison: Object.freeze({
      netMinorUnits: 30000,
      saleMinorUnits: 35500,
      creditMinorUnits: 5500,
      cancelCount: 1,
      unknown: Object.freeze({
        count: 2,
        quantifiedAmountMinorUnits: 777,
        unquantifiedCount: 1,
      }),
      rowCount: 7,
    }),
  }),
  deltaMinorUnits: 70059,
  unknown: Object.freeze({
    count: 4,
    quantifiedAmountMinorUnits: 1977,
    unquantifiedCount: 2,
    unassigned: Object.freeze({
      count: 1,
      quantifiedAmountMinorUnits: 1200,
      unquantifiedCount: 0,
    }),
  }),
  excludedOutOfScopeCount: 3,
});

export const FROZEN_ENVIRONMENT = Object.freeze({
  schemaVersion: 'kaleidosphere.business-bi/falsification-environment/v1',
  runtime: 'node',
  nodeVersion: 'v24.19.0',
  nodeModulesAbi: '137',
  platform: 'linux',
  architecture: 'x64',
  endianness: 'LE',
  canonicalJsonSha256: CANONICAL_JSON_SHA256,
  packageSha256: PACKAGE_JSON_SHA256,
});

export const FROZEN_REPOSITORY_IDENTITY = Object.freeze({
  schemaVersion: 'kaleidosphere.business-bi/falsification-repository/v1',
  gitObjectFormat: 'sha1',
  mainCommitOid: RELEASE_COMMIT_OID,
  originMainCommitOid: RELEASE_COMMIT_OID,
  releaseCommitOid: RELEASE_COMMIT_OID,
  releaseTreeOid: RELEASE_TREE_OID,
  candidateParentOid: RELEASE_COMMIT_OID,
  candidateCommitCount: 1,
  candidateChangedPaths: ALLOWLISTED_CANDIDATE_PATHS,
});

export const FROZEN_WORKSPACE_STATE = Object.freeze({
  trackedClean: true,
  untrackedClean: true,
  indexMatchesHead: true,
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function jsonClone(value) {
  return JSON.parse(canonicalJson(value));
}

function exactJson(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function invariant(condition, code) {
  if (condition) return;
  const error = new Error(code);
  error.code = code;
  throw error;
}

function contentAddress(body, digestField) {
  return {
    ...body,
    [digestField]: sha256(canonicalJson(body)),
  };
}

function denial(caseId, reasonCode, details = {}) {
  return contentAddress({
    schemaVersion: 'kaleidosphere.business-bi/falsification-denial/v1',
    taskId: TASK_ID,
    issue: ISSUE_ID,
    caseId,
    state: 'DENIED',
    reasonCode,
    ordinaryAnswer: null,
    result: null,
    successfulOrdinaryAnswer: false,
    ...details,
  }, 'denialSha256');
}

function thrownDenial(caseId, expectedCode, operation, details = {}) {
  try {
    operation();
  } catch (error) {
    invariant(error?.code === expectedCode, 'BUSINESS_BI_FALSIFICATION_UNEXPECTED_DENIAL');
    return denial(caseId, error.code, details);
  }
  invariant(false, 'BUSINESS_BI_FALSIFICATION_FAILED_OPEN');
}

function observedEnvironment() {
  return {
    schemaVersion: FROZEN_ENVIRONMENT.schemaVersion,
    runtime: process.release.name,
    nodeVersion: process.version,
    nodeModulesAbi: process.versions.modules,
    platform: process.platform,
    architecture: process.arch,
    endianness: endianness(),
    canonicalJsonSha256: CANONICAL_JSON_SHA256,
    packageSha256: PACKAGE_JSON_SHA256,
  };
}

export function createFrozenCleanRoomContext() {
  return {
    repository: jsonClone(FROZEN_REPOSITORY_IDENTITY),
    workspace: jsonClone(FROZEN_WORKSPACE_STATE),
    environment: jsonClone(FROZEN_ENVIRONMENT),
  };
}

export function verifyCleanRoomContext(context, caseId = 'CLEAN_ROOM_CONTEXT') {
  if (!exactJson(context?.workspace, FROZEN_WORKSPACE_STATE)) {
    return denial(
      caseId,
      'BUSINESS_BI_CLEAN_ROOM_DIRTY_WORKTREE_DENIED',
    );
  }
  if (!exactJson(context?.repository, FROZEN_REPOSITORY_IDENTITY)) {
    return denial(
      caseId,
      'BUSINESS_BI_CLEAN_ROOM_MOVED_HEAD_DENIED',
    );
  }
  if (!exactJson(context?.environment, FROZEN_ENVIRONMENT)
    || sha256(canonicalJson(context.environment)) !== FROZEN_ENVIRONMENT_SHA256) {
    return denial(
      caseId,
      'BUSINESS_BI_CLEAN_ROOM_ENVIRONMENT_DENIED',
    );
  }
  return null;
}

function runGit(args) {
  const result = spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
  });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function repositoryCommandDenied() {
  return denial(
    'CLEAN_ROOM_PREFLIGHT',
    'BUSINESS_BI_CLEAN_ROOM_REPOSITORY_COMMAND_DENIED',
  );
}

export function inspectLiveRepository() {
  const topLevel = runGit(['rev-parse', '--show-toplevel']);
  const status = runGit(['status', '--porcelain=v1', '--untracked-files=all']);
  if (topLevel === null || status === null) return repositoryCommandDenied();
  if (path.resolve(topLevel) !== ROOT) {
    return denial(
      'CLEAN_ROOM_PREFLIGHT',
      'BUSINESS_BI_CLEAN_ROOM_WRONG_WORKSPACE_DENIED',
    );
  }
  if (status !== '') {
    return denial(
      'CLEAN_ROOM_PREFLIGHT',
      'BUSINESS_BI_CLEAN_ROOM_DIRTY_WORKTREE_DENIED',
    );
  }

  const head = runGit(['rev-parse', 'HEAD']);
  const headTree = runGit(['rev-parse', 'HEAD^{tree}']);
  const parentLine = runGit(['rev-list', '--parents', '-n', '1', 'HEAD']);
  const main = runGit(['rev-parse', 'main^{commit}']);
  const originMain = runGit(['rev-parse', 'origin/main^{commit}']);
  const releaseTree = runGit(['rev-parse', `${RELEASE_COMMIT_OID}^{tree}`]);
  const candidateCount = runGit([
    'rev-list',
    '--count',
    `${RELEASE_COMMIT_OID}..HEAD`,
  ]);
  const changedStatus = runGit([
    'diff',
    '--name-status',
    '--no-renames',
    `${RELEASE_COMMIT_OID}...HEAD`,
  ]);
  const diffCheck = spawnSync('git', [
    'diff',
    '--check',
    `${RELEASE_COMMIT_OID}...HEAD`,
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
  });
  if ([
    head,
    headTree,
    parentLine,
    main,
    originMain,
    releaseTree,
    candidateCount,
    changedStatus,
  ].some((value) => value === null) || diffCheck.status !== 0) {
    return repositoryCommandDenied();
  }

  const parents = parentLine.split(' ').slice(1);
  const changedEntries = changedStatus === ''
    ? []
    : changedStatus.split('\n').map((line) => line.split('\t'));
  const changedPaths = changedEntries.map(([, changedPath]) => changedPath).sort();
  const repository = {
    schemaVersion: FROZEN_REPOSITORY_IDENTITY.schemaVersion,
    gitObjectFormat: 'sha1',
    mainCommitOid: main,
    originMainCommitOid: originMain,
    releaseCommitOid: RELEASE_COMMIT_OID,
    releaseTreeOid: releaseTree,
    candidateParentOid: parents[0] ?? null,
    candidateCommitCount: Number(candidateCount),
    candidateChangedPaths: changedPaths,
  };
  const allAdded = changedEntries.every(([change]) => change === 'A');
  const exactSingleParent = parents.length === 1
    && parents[0] === RELEASE_COMMIT_OID;
  if (head === RELEASE_COMMIT_OID
    || !/^[a-f0-9]{40}$/.test(head)
    || !/^[a-f0-9]{40}$/.test(headTree)
    || !allAdded
    || !exactSingleParent
    || !exactJson(repository, FROZEN_REPOSITORY_IDENTITY)) {
    return denial(
      'CLEAN_ROOM_PREFLIGHT',
      'BUSINESS_BI_CLEAN_ROOM_MOVED_HEAD_DENIED',
    );
  }

  return {
    state: 'BOUND',
    context: {
      repository,
      workspace: jsonClone(FROZEN_WORKSPACE_STATE),
      environment: observedEnvironment(),
    },
    candidate: {
      commitOid: head,
      treeOid: headTree,
    },
  };
}

export async function loadFrozenInputs() {
  const entries = await Promise.all(Object.entries({
    metricContractBytes: PATHS.metric,
    holdoutBytes: PATHS.input,
    oracleBytes: PATHS.oracle,
    oracleCalculatorBytes: PATHS.oracleCalculator,
    canonicalJsonBytes: PATHS.canonicalJson,
    packageBytes: PATHS.package,
  }).map(async ([key, relativePath]) => [
    key,
    await readFile(path.join(ROOT, relativePath)),
  ]));
  return Object.fromEntries(entries);
}

function verifyFrozenInputIdentities(inputs, caseId = 'FROZEN_INPUT_IDENTITIES') {
  const checks = [
    [inputs?.metricContractBytes, ADMITTED_METRIC_CONTRACT_SHA256,
      'BUSINESS_BI_METRIC_DIGEST_DENIED'],
    [inputs?.holdoutBytes, ADMITTED_HOLDOUT_SHA256,
      'BUSINESS_BI_HOLDOUT_DIGEST_DENIED'],
    [inputs?.oracleBytes, ADMITTED_ORACLE_SHA256,
      'BUSINESS_BI_ORACLE_DIGEST_DENIED'],
    [inputs?.oracleCalculatorBytes, INDEPENDENT_ORACLE_CALCULATOR_SHA256,
      'BUSINESS_BI_INDEPENDENT_ORACLE_DIGEST_DENIED'],
    [inputs?.canonicalJsonBytes, CANONICAL_JSON_SHA256,
      'BUSINESS_BI_CANONICALIZER_DIGEST_DENIED'],
    [inputs?.packageBytes, PACKAGE_JSON_SHA256,
      'BUSINESS_BI_PACKAGE_DIGEST_DENIED'],
  ];
  for (const [bytes, digest, code] of checks) {
    if (!(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array)
      || sha256(bytes) !== digest) return denial(caseId, code);
  }
  return null;
}

function freshInputs(inputs) {
  return Object.fromEntries(Object.entries(inputs).map(([key, value]) => [
    key,
    Buffer.from(value),
  ]));
}

function readOnlyEvidence() {
  return {
    accessMode: 'READ_ONLY',
    mutationCount: 0,
    bounded: true,
    relation: 'synthetic_bi.orders',
    rowsRead: 17,
  };
}

function compile(inputs, request = createNetRevenueOperationRequest()) {
  return compileNetRevenuePlan({
    request,
    metricContractBytes: inputs.metricContractBytes,
    oracleBytes: inputs.oracleBytes,
  });
}

async function completeReceipt(inputs, plan = compile(inputs)) {
  return executeNetRevenuePlan({
    plan,
    metricContractBytes: inputs.metricContractBytes,
    oracleBytes: inputs.oracleBytes,
    read: async () => ({
      state: 'COMPLETE',
      reasonCode: null,
      bytes: inputs.holdoutBytes,
      evidence: readOnlyEvidence(),
    }),
  });
}

function readdressReceipt(receipt) {
  receipt.resultSha256 = sha256(canonicalJson(receipt.result));
  receipt.outputSha256 = sha256(canonicalJson(receipt.output));
  const { receiptSha256: _discarded, ...body } = receipt;
  receipt.receiptSha256 = sha256(canonicalJson(body));
  return receipt;
}

function assertDenialShape(value, caseId) {
  invariant(value?.caseId === caseId, 'BUSINESS_BI_FALSIFICATION_CASE_ID_MISMATCH');
  invariant(value.state === 'DENIED', 'BUSINESS_BI_FALSIFICATION_FAILED_OPEN');
  invariant(value.ordinaryAnswer === null, 'BUSINESS_BI_FALSIFICATION_ANSWER_LEAK');
  invariant(value.result === null, 'BUSINESS_BI_FALSIFICATION_RESULT_LEAK');
  invariant(value.successfulOrdinaryAnswer === false,
    'BUSINESS_BI_FALSIFICATION_ANSWER_LEAK');
  const { denialSha256, ...body } = value;
  invariant(denialSha256 === sha256(canonicalJson(body)),
    'BUSINESS_BI_FALSIFICATION_DENIAL_DIGEST_MISMATCH');
  return value;
}

async function wrongOracle(inputs) {
  const changed = freshInputs(inputs);
  changed.oracleBytes[changed.oracleBytes.length - 2] ^= 1;
  return thrownDenial(
    'WRONG_ORACLE',
    'BUSINESS_BI_ORACLE_DIGEST_DENIED',
    () => compile(changed),
  );
}

async function substitutedMetric(inputs) {
  const changed = freshInputs(inputs);
  changed.metricContractBytes[changed.metricContractBytes.length - 2] ^= 1;
  return thrownDenial(
    'SUBSTITUTED_METRIC',
    'BUSINESS_BI_METRIC_DIGEST_DENIED',
    () => compile(changed),
  );
}

async function widenedScope(inputs) {
  const request = createNetRevenueOperationRequest();
  request.aggregate.groupingColumns.push('customer_id');
  request.aggregate.outputRowBudget = 2;
  return thrownDenial(
    'WIDENED_SCOPE',
    'BUSINESS_BI_OPERATION_DENIED',
    () => compile(inputs, request),
  );
}

async function unknownToZero(inputs) {
  const plan = compile(inputs);
  const forged = structuredClone(await completeReceipt(inputs, plan));
  forged.result.unknown.quantifiedAmountMinorUnits = 0;
  forged.output.rows[0].unknown_quantified_amount_minor_units = 0;
  readdressReceipt(forged);
  return thrownDenial(
    'UNKNOWN_TO_ZERO',
    'BUSINESS_BI_RESULT_SUBSTITUTION_DENIED',
    () => verifyNetRevenueExecutionReceipt({
      plan,
      receipt: forged,
      metricContractBytes: inputs.metricContractBytes,
      oracleBytes: inputs.oracleBytes,
    }),
  );
}

async function cancelledRowInclusion(inputs) {
  const plan = compile(inputs);
  const forged = structuredClone(await completeReceipt(inputs, plan));
  forged.result.periods.comparison.netMinorUnits += 1;
  forged.result.periods.comparison.saleMinorUnits += 1;
  forged.result.deltaMinorUnits -= 1;
  forged.output.rows[0].comparison_net_minor_units += 1;
  forged.output.rows[0].comparison_sale_minor_units += 1;
  forged.output.rows[0].delta_minor_units -= 1;
  readdressReceipt(forged);
  return thrownDenial(
    'CANCELLED_ROW_INCLUSION',
    'BUSINESS_BI_RESULT_SUBSTITUTION_DENIED',
    () => verifyNetRevenueExecutionReceipt({
      plan,
      receipt: forged,
      metricContractBytes: inputs.metricContractBytes,
      oracleBytes: inputs.oracleBytes,
    }),
  );
}

async function dirtyOrUnboundBytes(inputs, context) {
  const dirtyContext = jsonClone(context);
  dirtyContext.workspace.trackedClean = false;
  const dirty = verifyCleanRoomContext(
    dirtyContext,
    'DIRTY_OR_UNBOUND_BYTES',
  );
  invariant(dirty?.reasonCode === 'BUSINESS_BI_CLEAN_ROOM_DIRTY_WORKTREE_DENIED',
    'BUSINESS_BI_FALSIFICATION_FAILED_OPEN');

  const plan = compile(inputs);
  const changed = Buffer.from(inputs.holdoutBytes);
  changed[changed.length - 2] ^= 1;
  const receipt = await executeNetRevenuePlan({
    plan,
    metricContractBytes: inputs.metricContractBytes,
    oracleBytes: inputs.oracleBytes,
    read: async () => ({
      state: 'COMPLETE',
      reasonCode: null,
      bytes: changed,
      evidence: readOnlyEvidence(),
    }),
  });
  invariant(receipt.execution.state === 'DENIED'
    && receipt.execution.reasonCode === 'BUSINESS_BI_HOLDOUT_DIGEST_DENIED'
    && receipt.result === null,
  'BUSINESS_BI_FALSIFICATION_FAILED_OPEN');

  return denial(
    'DIRTY_OR_UNBOUND_BYTES',
    'BUSINESS_BI_DIRTY_OR_UNBOUND_BYTES_DENIED',
    {
      componentReasonCodes: [
        dirty.reasonCode,
        receipt.execution.reasonCode,
      ],
    },
  );
}

async function movedHead(_inputs, context) {
  const moved = jsonClone(context);
  moved.repository.mainCommitOid =
    '0000000000000000000000000000000000000000';
  const result = verifyCleanRoomContext(moved, 'MOVED_HEAD');
  invariant(result?.reasonCode === 'BUSINESS_BI_CLEAN_ROOM_MOVED_HEAD_DENIED',
    'BUSINESS_BI_FALSIFICATION_FAILED_OPEN');
  return result;
}

async function environmentSubstitution(_inputs, context) {
  const substituted = jsonClone(context);
  substituted.environment.nodeVersion = 'v24.19.1';
  const result = verifyCleanRoomContext(
    substituted,
    'ENVIRONMENT_SUBSTITUTION',
  );
  invariant(result?.reasonCode === 'BUSINESS_BI_CLEAN_ROOM_ENVIRONMENT_DENIED',
    'BUSINESS_BI_FALSIFICATION_FAILED_OPEN');
  return result;
}

const SABOTAGE_RUNNERS = Object.freeze({
  WRONG_ORACLE: wrongOracle,
  SUBSTITUTED_METRIC: substitutedMetric,
  WIDENED_SCOPE: widenedScope,
  UNKNOWN_TO_ZERO: unknownToZero,
  CANCELLED_ROW_INCLUSION: cancelledRowInclusion,
  DIRTY_OR_UNBOUND_BYTES: dirtyOrUnboundBytes,
  MOVED_HEAD: movedHead,
  ENVIRONMENT_SUBSTITUTION: environmentSubstitution,
});

export async function runSabotageCase(caseId, inputs, context) {
  invariant(SABOTAGE_CASE_IDS.includes(caseId),
    'BUSINESS_BI_FALSIFICATION_CASE_DENIED');
  const inputDenial = verifyFrozenInputIdentities(inputs, caseId);
  if (inputDenial !== null) return assertDenialShape(inputDenial, caseId);
  const runner = SABOTAGE_RUNNERS[caseId];
  return assertDenialShape(await runner(
    freshInputs(inputs),
    jsonClone(context),
  ), caseId);
}

export async function runAdmittedMetric(inputs, context) {
  const contextDenial = verifyCleanRoomContext(context, 'FINAL_GREEN');
  invariant(contextDenial === null, contextDenial?.reasonCode);
  const inputDenial = verifyFrozenInputIdentities(inputs, 'FINAL_GREEN');
  invariant(inputDenial === null, inputDenial?.reasonCode);

  const isolatedInputs = freshInputs(inputs);
  const oracle = JSON.parse(isolatedInputs.oracleBytes.toString('utf8'));
  invariant(oracle.independence?.productionAnalysisImports === 0,
    'BUSINESS_BI_INDEPENDENT_ORACLE_DENIED');
  invariant(exactJson(oracle.expected, EXPECTED_RESULT),
    'BUSINESS_BI_INDEPENDENT_ORACLE_DENIED');

  const plan = compile(isolatedInputs);
  invariant(plan.planSha256 === FROZEN_PLAN_SHA256,
    'BUSINESS_BI_PLAN_DIGEST_DENIED');
  const receipt = await completeReceipt(isolatedInputs, plan);
  invariant(receipt.execution.state === 'COMPLETE',
    'BUSINESS_BI_FALSIFICATION_POSITIVE_NOT_COMPLETE');
  invariant(receipt.oracleEquality === 'EXACT'
    && exactJson(receipt.result, oracle.expected),
  'BUSINESS_BI_ORACLE_MISMATCH');
  invariant(receipt.resultSha256 === FROZEN_RESULT_SHA256,
    'BUSINESS_BI_RESULT_DIGEST_DENIED');
  const coverageSha256 = sha256(canonicalJson(receipt.coverage));
  invariant(coverageSha256 === FROZEN_COVERAGE_SHA256,
    'BUSINESS_BI_COVERAGE_DIGEST_DENIED');
  verifyNetRevenueExecutionReceipt({
    plan,
    receipt,
    metricContractBytes: isolatedInputs.metricContractBytes,
    oracleBytes: isolatedInputs.oracleBytes,
  });

  const body = {
    schemaVersion: 'kaleidosphere.business-bi/net-revenue-falsification-run/v1',
    taskId: TASK_ID,
    issue: ISSUE_ID,
    state: 'GREEN',
    classification: 'SYNTHETIC_NON_CUSTOMER_BYTES',
    metric: {
      count: 1,
      id: 'bi-ks-01-net-revenue',
      operationId: plan.operationId,
      admission: 'ADMITTED_SYNTHETIC_HOLDOUT_ONLY',
    },
    identities: {
      input: {
        path: PATHS.input,
        sha256: sha256(isolatedInputs.holdoutBytes),
      },
      metric: {
        path: PATHS.metric,
        sha256: sha256(isolatedInputs.metricContractBytes),
      },
      plan: {
        sha256: plan.planSha256,
      },
      oracle: {
        path: PATHS.oracle,
        sha256: sha256(isolatedInputs.oracleBytes),
        independentCalculatorPath: PATHS.oracleCalculator,
        independentCalculatorSha256:
          sha256(isolatedInputs.oracleCalculatorBytes),
      },
      result: {
        sha256: receipt.resultSha256,
      },
      coverage: {
        sha256: coverageSha256,
      },
      environment: {
        sha256: FROZEN_ENVIRONMENT_SHA256,
      },
      repository: {
        commitOid: RELEASE_COMMIT_OID,
        treeOid: RELEASE_TREE_OID,
      },
    },
    environment: jsonClone(FROZEN_ENVIRONMENT),
    execution: {
      state: receipt.execution.state,
      accessMode: receipt.execution.accessMode,
      mutationAuthority: receipt.execution.mutationAuthority,
      bounded: receipt.execution.bounded,
      rowsRead: receipt.execution.rowsRead,
      rowBudget: receipt.execution.rowBudget,
      outputRows: receipt.output.rows.length,
      oracleEquality: receipt.oracleEquality,
      result: jsonClone(receipt.result),
      coverage: jsonClone(receipt.coverage),
    },
    boundary: {
      sourceConnectionUsed: false,
      productionOrCustomerDataUsed: false,
      credentialAccessed: false,
      networkAccessed: false,
      arbitrarySqlAccepted: false,
      secondMetricAdmitted: false,
      externalEffectPerformed: false,
    },
  };
  return contentAddress(body, 'evidenceSha256');
}

export function canonicalEvidenceBytes(evidence) {
  return Buffer.from(`${canonicalJson(evidence)}\n`, 'utf8');
}

export async function buildFalsificationVerification(inputs, context) {
  const contextDenial = verifyCleanRoomContext(context, 'CLEAN_ROOM_PREFLIGHT');
  invariant(contextDenial === null, contextDenial?.reasonCode);
  const inputDenial = verifyFrozenInputIdentities(
    inputs,
    'FROZEN_INPUT_IDENTITIES',
  );
  invariant(inputDenial === null, inputDenial?.reasonCode);

  const negativeMatrix = [];
  const sequence = [];
  for (const [index, caseId] of SABOTAGE_CASE_IDS.entries()) {
    const first = await runSabotageCase(caseId, inputs, context);
    const second = await runSabotageCase(caseId, inputs, context);
    invariant(exactJson(first, second),
      'BUSINESS_BI_FALSIFICATION_NONDETERMINISTIC_DENIAL');
    negativeMatrix.push({
      ordinal: index + 1,
      id: caseId,
      status: 'PASS',
      observedState: first.state,
      reasonCode: first.reasonCode,
      ordinaryAnswer: first.ordinaryAnswer,
      result: first.result,
      successfulOrdinaryAnswer: first.successfulOrdinaryAnswer,
      componentReasonCodes: first.componentReasonCodes ?? [],
      denialSha256: first.denialSha256,
      deterministic: true,
    });
    sequence.push({
      ordinal: index + 1,
      id: caseId,
      state: 'DENIED',
    });
  }

  const firstRun = await runAdmittedMetric(freshInputs(inputs), context);
  const secondRun = await runAdmittedMetric(freshInputs(inputs), context);
  const firstBytes = canonicalEvidenceBytes(firstRun);
  const secondBytes = canonicalEvidenceBytes(secondRun);
  invariant(firstBytes.equals(secondBytes),
    'BUSINESS_BI_FALSIFICATION_RUN_BYTES_DIVERGED');
  invariant(firstRun.evidenceSha256 === secondRun.evidenceSha256,
    'BUSINESS_BI_FALSIFICATION_RUN_DIGEST_DIVERGED');

  sequence.push({
    ordinal: SABOTAGE_CASE_IDS.length + 1,
    id: 'FINAL_GREEN',
    state: 'GREEN',
    evidenceSha256: firstRun.evidenceSha256,
  });

  const acceptance = [
    {
      id: 'BI-KS-03-AC01',
      status: 'PASS',
      proof: 'Exact Main/release commit and tree plus input, metric, plan, oracle, result, coverage, and environment identities are frozen.',
    },
    {
      id: 'BI-KS-03-AC02',
      status: 'PASS',
      proof: 'All named sabotage and context-substitution cases deterministically deny without an ordinary answer before final GREEN.',
    },
    {
      id: 'BI-KS-03-AC03',
      status: 'PASS',
      proof: 'Two isolated immutable-byte runs are byte-identical and equal the independently bound oracle for exactly one admitted holdout metric.',
    },
  ];
  const satisfiedCriteria = acceptance.filter(({ status }) => status === 'PASS').length;
  const totalCriteria = acceptance.length;

  const body = {
    schemaVersion:
      'kaleidosphere.business-bi/net-revenue-falsification-verification/v1',
    taskId: TASK_ID,
    issue: ISSUE_ID,
    status: 'GREEN',
    classification: 'SYNTHETIC_NON_CUSTOMER_BYTES',
    processContext: {
      operatingModel: 'Operating Model v1.1',
      decisionsPreserved: [
        'D-001',
        'D-002',
        'D-003',
        'D-004',
        'D-005',
        'D-006',
        'D-007',
      ],
      processVariant: 'NONE',
    },
    publicClaim: {
      statement: 'Exactly one admitted-holdout metric, synthetic net-revenue v1, passed clean-room falsification; no production or broader BI claim is made.',
      admittedHoldoutMetricCount: 1,
      metricIds: ['bi-ks-01-net-revenue'],
      productionMetricCount: 0,
      broaderBiCapabilityClaimed: false,
    },
    acceptanceSummary: {
      satisfiedCriteria,
      totalCriteria,
    },
    packageSummary: {
      deliveredPackages: 1,
      publishedPackages: 0,
      packageKind: 'LOCAL_FALSIFICATION_EVIDENCE_PACKAGE',
    },
    frozenIdentities: jsonClone(firstRun.identities),
    repositoryPolicy: jsonClone(FROZEN_REPOSITORY_IDENTITY),
    isolatedRuns: {
      count: 2,
      isolation: 'FRESH_IMMUTABLE_BYTE_SNAPSHOTS',
      byteIdentical: true,
      contentAddressAlgorithm: 'sha256-of-canonical-evidence-body',
      firstEvidenceSha256: firstRun.evidenceSha256,
      secondEvidenceSha256: secondRun.evidenceSha256,
      evidenceByteLength: firstBytes.byteLength,
    },
    oracleEquality: {
      status: firstRun.execution.oracleEquality,
      exactDeepEquality: exactJson(firstRun.execution.result, EXPECTED_RESULT),
      independentlyBound: true,
    },
    negativeMatrix,
    sequence,
    acceptance,
    finalGreen: firstRun,
    publicClosureGovernance: {
      independentIntegratedReviews: [
        {
          ordinal: 1,
          role: 'INDEPENDENT_INTEGRATED_REVIEWER',
          status: 'PENDING_CONTROLLER',
          workerSelfReview: false,
        },
      ],
      finalOwners: [
        {
          ordinal: 1,
          owner: 'Sol',
          responsibility: 'FIX_FORWARD_TO_PUBLIC_CLOSURE',
          status: 'PENDING_CONTROLLER',
          requiredStages: [
            'EXACT_PR_MAIN_CI',
            'RELEASE',
            'ANONYMOUS_READBACK',
            'ISSUE_CLOSED',
            'QUEUE_DONE',
          ],
        },
      ],
      publicClosureAuthorized: false,
      workerAuthority: 'ONE_LOCAL_ALLOWLISTED_COMMIT_ONLY',
    },
    deliveryBoundary: {
      externalEffectsPerformed: false,
      sourceDatabaseWritten: false,
      credentialsUsed: false,
      realOrCustomerDataUsed: false,
      pushPerformed: false,
      mergePerformed: false,
      releasePerformed: false,
      anonymousReadbackClaimed: false,
      issueClosed: false,
      queueDoneClaimed: false,
    },
    nonclaims: [
      'No production or customer data was accessed.',
      'No second metric, general BI capability, dashboard, or package publication is claimed.',
      'No credential, network, source connection, write, push, merge, release, issue-close, or Queue mutation authority is granted.',
      'The local GREEN is falsification evidence only; integrated review and all public closure stages remain with the controller and final Sol owner.',
    ],
  };
  return contentAddress(body, 'verificationSha256');
}

function checkedEvidenceDenial() {
  return denial(
    'CHECKED_EVIDENCE',
    'BUSINESS_BI_CHECKED_EVIDENCE_SUBSTITUTION_DENIED',
  );
}

async function runCli() {
  const args = process.argv.slice(2);
  const validDefault = args.length === 0
    || (args.length === 1 && args[0] === '--check');
  const sabotageIndex = args.indexOf('--sabotage');
  const isSabotage = sabotageIndex !== -1
    && args.length === 2
    && sabotageIndex === 0
    && SABOTAGE_CASE_IDS.includes(args[1]);
  if (!validDefault && !isSabotage) {
    process.stdout.write(`${canonicalJson(denial(
      'CLI_ARGUMENTS',
      'BUSINESS_BI_FALSIFICATION_ARGUMENT_DENIED',
    ))}\n`);
    process.exitCode = 2;
    return;
  }

  const live = inspectLiveRepository();
  if (live.state !== 'BOUND') {
    process.stdout.write(`${canonicalJson(live)}\n`);
    process.exitCode = 2;
    return;
  }
  const contextDenial = verifyCleanRoomContext(
    live.context,
    'CLEAN_ROOM_PREFLIGHT',
  );
  if (contextDenial !== null) {
    process.stdout.write(`${canonicalJson(contextDenial)}\n`);
    process.exitCode = 2;
    return;
  }

  const inputs = await loadFrozenInputs();
  if (isSabotage) {
    const result = await runSabotageCase(args[1], inputs, live.context);
    process.stdout.write(`${canonicalJson(result)}\n`);
    process.exitCode = 2;
    return;
  }

  const verification = await buildFalsificationVerification(
    inputs,
    live.context,
  );
  let checked;
  let checkedBytes;
  try {
    checkedBytes = await readFile(path.join(ROOT, PATHS.verification));
    checked = JSON.parse(checkedBytes.toString('utf8'));
  } catch {
    checked = null;
  }
  const expectedBytes = Buffer.from(
    `${JSON.stringify(verification, null, 2)}\n`,
    'utf8',
  );
  if (!exactJson(checked, verification)
    || !Buffer.isBuffer(checkedBytes)
    || !checkedBytes.equals(expectedBytes)) {
    process.stdout.write(`${canonicalJson(checkedEvidenceDenial())}\n`);
    process.exitCode = 2;
    return;
  }

  process.stdout.write(`${canonicalJson({
    schemaVersion: 'kaleidosphere.business-bi/falsification-cli-result/v1',
    taskId: TASK_ID,
    issue: ISSUE_ID,
    state: 'GREEN',
    claim: verification.publicClaim.statement,
    admittedHoldoutMetricCount:
      verification.publicClaim.admittedHoldoutMetricCount,
    satisfiedCriteria: verification.acceptanceSummary.satisfiedCriteria,
    totalCriteria: verification.acceptanceSummary.totalCriteria,
    deliveredPackages: verification.packageSummary.deliveredPackages,
    publishedPackages: verification.packageSummary.publishedPackages,
    isolatedRuns: verification.isolatedRuns.count,
    byteIdentical: verification.isolatedRuns.byteIdentical,
    oracleEquality: verification.oracleEquality.status,
    evidenceSha256: verification.isolatedRuns.firstEvidenceSha256,
    verificationSha256: verification.verificationSha256,
    candidateCommitOid: live.candidate.commitOid,
    candidateTreeOid: live.candidate.treeOid,
  })}\n`);
}

if (process.argv[1]
  && path.resolve(process.argv[1]) === SELF_PATH) {
  try {
    await runCli();
  } catch (error) {
    process.stdout.write(`${canonicalJson(denial(
      'CLEAN_ROOM_EXECUTION',
      typeof error?.code === 'string'
        ? error.code
        : 'BUSINESS_BI_FALSIFICATION_INTERNAL_DENIED',
    ))}\n`);
    process.exitCode = 2;
  }
}
