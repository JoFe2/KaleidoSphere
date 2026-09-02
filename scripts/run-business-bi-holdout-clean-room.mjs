#!/usr/bin/env node

// BI-KS-02 clean-room proof over the admitted synthetic non-customer bytes.
// This script has no source connection, SQL, credential, mutation, Superset,
// chart, publish, push, or release path. It deterministically rewrites only the
// checked verification receipt named below.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { canonicalJson } from '../services/bi-control/src/canonical-json.js';
import {
  NET_REVENUE_NONCLAIMS,
  compileNetRevenuePlan,
  createNetRevenueOperationRequest,
  executeNetRevenuePlan,
  verifyNetRevenueExecutionReceipt,
} from '../services/bi-control/src/business-bi/net-revenue-plan.mjs';
import {
  createNetRevenueReadback,
  renderNetRevenueJson,
  renderNetRevenueTable,
  verifyNetRevenueRenderings,
} from '../services/bi-control/src/business-bi/net-revenue-readback.mjs';

const root = path.resolve(import.meta.dirname, '..');
const metricContractPath = path.join(
  root,
  'contracts/business-bi/v1/net-revenue.metric.json',
);
const holdoutPath = path.join(
  root,
  'tests/fixtures/business-bi/net-revenue-holdout-v1.json',
);
const oraclePath = path.join(
  root,
  'tests/fixtures/business-bi/net-revenue-oracle-v1.json',
);
const verificationPath = path.join(
  root,
  'verification/business-bi-net-revenue-holdout-v1.json',
);

const [metricContractBytes, holdoutBytes, oracleBytes] = await Promise.all([
  readFile(metricContractPath),
  readFile(holdoutPath),
  readFile(oraclePath),
]);
const oracle = JSON.parse(oracleBytes.toString('utf8'));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function compile(request = createNetRevenueOperationRequest()) {
  return compileNetRevenuePlan({ request, metricContractBytes, oracleBytes });
}

const plan = compile();

function readOnlyEvidence(rowsRead = 17) {
  return {
    accessMode: 'READ_ONLY',
    mutationCount: 0,
    bounded: true,
    relation: 'synthetic_bi.orders',
    rowsRead,
  };
}

function completeResponse(bytes = holdoutBytes, evidence = readOnlyEvidence()) {
  return {
    state: 'COMPLETE',
    reasonCode: null,
    bytes,
    evidence,
  };
}

async function execute(read, options = {}) {
  return executeNetRevenuePlan({
    plan,
    metricContractBytes,
    oracleBytes,
    read,
    ...options,
  });
}

function mutateRequest(mutate) {
  const request = createNetRevenueOperationRequest();
  mutate(request);
  return request;
}

function expectCompileDenied(mutate) {
  assert.throws(
    () => compile(mutateRequest(mutate)),
    { code: 'BUSINESS_BI_OPERATION_DENIED' },
  );
  return 'COMPILE_DENIED';
}

const negativeMatrix = [];
async function prove(id, proof) {
  const observed = await proof();
  negativeMatrix.push({ id, status: 'PASS', observed });
}

await prove('FREE_SQL', () => expectCompileDenied(
  (request) => { request.sql = 'SELECT * FROM synthetic_bi.orders'; },
));
await prove('ALTERNATE_RELATION', () => expectCompileDenied(
  (request) => { request.source.relation = 'synthetic_bi.refunds'; },
));
await prove('ALTERNATE_COLUMN', () => expectCompileDenied(
  (request) => { request.source.dateRole.column = 'shipping_date'; },
));
await prove('UNBOUNDED_PERIOD', () => expectCompileDenied(
  (request) => { request.source.periods[0].end = null; },
));
await prove('EXTRA_GROUPING', () => expectCompileDenied(
  (request) => { request.aggregate.groupingColumns.push('customer_id'); },
));
await prove('UNKNOWN_FIELD', () => expectCompileDenied(
  (request) => { request.source.unknown = true; },
));
await prove('ALTERNATE_CURRENCY', () => expectCompileDenied(
  (request) => { request.source.currency.code = 'USD'; },
));
await prove('ROW_BUDGET_WIDENING', () => expectCompileDenied(
  (request) => { request.aggregate.inputRowBudget += 1; },
));
await prove('OUTPUT_ROW_WIDENING', () => expectCompileDenied(
  (request) => { request.aggregate.outputRowBudget += 1; },
));
await prove('OUTPUT_COLUMN_WIDENING', () => expectCompileDenied(
  (request) => { request.aggregate.outputColumns.push('customer_id'); },
));
await prove('SECOND_OPERATION', () => expectCompileDenied(
  (request) => { request.operationId = 'bi-ks-01-net-revenue/v2'; },
));
await prove('SECOND_METRIC', () => expectCompileDenied(
  (request) => { request.metric.id = 'gross-revenue'; },
));

await prove('WRITE_ATTEMPT', async () => {
  const receipt = await execute(async () => completeResponse(
    holdoutBytes,
    { ...readOnlyEvidence(), mutationCount: 1 },
  ));
  assert.equal(receipt.execution.state, 'DENIED');
  assert.equal(receipt.execution.reasonCode, 'BUSINESS_BI_READ_ONLY_EVIDENCE_DENIED');
  assert.equal(receipt.result, null);
  return receipt.execution.reasonCode;
});

await prove('SUBSTITUTED_RESULT', async () => {
  const substitutedBytes = Buffer.from(
    holdoutBytes.toString('utf8').replace('"amount_minor_units": 60', '"amount_minor_units": 61'),
  );
  const receipt = await execute(async () => completeResponse(substitutedBytes));
  assert.equal(receipt.execution.state, 'DENIED');
  assert.equal(receipt.execution.reasonCode, 'BUSINESS_BI_HOLDOUT_DIGEST_DENIED');
  assert.equal(receipt.result, null);
  return receipt.execution.reasonCode;
});

const preservedStates = new Map();
for (const state of ['PARTIAL', 'DENIED', 'UNSUPPORTED', 'UNKNOWN']) {
  const receipt = await execute(async () => ({
    state,
    reasonCode: `SOURCE_${state}`,
    bytes: null,
    evidence: readOnlyEvidence(state === 'PARTIAL' ? 8 : null),
  }));
  assert.equal(receipt.execution.state, state);
  assert.equal(receipt.coverage.state, state);
  assert.equal(receipt.result, null);
  preservedStates.set(state, receipt);
  await prove(`${state}_PRESERVATION`, async () => {
    assert.equal(receipt.coverage.nonSuccessCollapsed, false);
    return state;
  });
}

await prove('STATUS_COLLAPSE', async () => {
  assert.equal(preservedStates.size, 4);
  assert.equal(new Set(
    [...preservedStates.values()].map(({ receiptSha256 }) => receiptSha256),
  ).size, 4);
  for (const receipt of preservedStates.values()) {
    assert.equal(receipt.output, null);
    assert.equal(receipt.oracleEquality, 'NOT_EVALUATED');
  }
  return 'DISTINCT_NON_SUCCESS_RECEIPTS';
});

await prove('TIMEOUT_LOSS', async () => {
  const receipt = await execute(() => new Promise(() => {}));
  assert.equal(receipt.execution.state, 'TIMEOUT');
  assert.equal(receipt.result, null);
  return receipt.execution.state;
});

await prove('CANCEL_LOSS', async () => {
  const controller = new AbortController();
  controller.abort();
  let dispatched = false;
  const receipt = await execute(async () => {
    dispatched = true;
    return completeResponse();
  }, { signal: controller.signal });
  assert.equal(dispatched, false);
  assert.equal(receipt.execution.state, 'CANCELLED');
  assert.equal(receipt.result, null);
  return receipt.execution.state;
});

const receipt = await execute(async () => completeResponse());
assert.equal(receipt.execution.state, 'COMPLETE');
assert.equal(receipt.oracleEquality, 'EXACT');
assert.deepStrictEqual(receipt.result, oracle.expected);
assert.equal(verifyNetRevenueExecutionReceipt({
  plan,
  receipt,
  metricContractBytes,
  oracleBytes,
}), receipt);

const renderingInput = { plan, receipt, metricContractBytes, oracleBytes };
const readback = createNetRevenueReadback(renderingInput);
const json = renderNetRevenueJson(renderingInput);
const table = renderNetRevenueTable(renderingInput);
const renderingIdentity = verifyNetRevenueRenderings({
  ...renderingInput,
  json,
  table,
});

await prove('RENDERING_DISAGREEMENT', async () => {
  assert.throws(() => verifyNetRevenueRenderings({
    ...renderingInput,
    json,
    table: `${table}substituted\n`,
  }), { code: 'BUSINESS_BI_RENDERING_DISAGREEMENT' });
  return 'DISAGREEMENT_DENIED';
});

await prove('RECEIPT_SUBSTITUTION', async () => {
  const forged = structuredClone(receipt);
  forged.result.deltaMinorUnits += 1;
  forged.result.periods.current.netMinorUnits += 1;
  forged.resultSha256 = sha256(canonicalJson(forged.result));
  forged.output.rows[0].delta_minor_units += 1;
  forged.output.rows[0].current_net_minor_units += 1;
  forged.outputSha256 = sha256(canonicalJson(forged.output));
  const { receiptSha256: _oldReceiptSha256, ...body } = forged;
  forged.receiptSha256 = sha256(canonicalJson(body));
  assert.throws(() => verifyNetRevenueExecutionReceipt({
    plan,
    receipt: forged,
    metricContractBytes,
    oracleBytes,
  }), { code: 'BUSINESS_BI_RESULT_SUBSTITUTION_DENIED' });
  return 'FULLY_REDIGESTED_RECEIPT_DENIED';
});

const verificationBody = {
  schemaVersion: 'kaleidosphere.business-bi/net-revenue-holdout-verification/v1',
  taskId: 'PORTFOLIO-KS146-IMPLEMENT',
  issue: 'BI-KS-02',
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
  source: {
    metricContractPath: 'contracts/business-bi/v1/net-revenue.metric.json',
    holdoutPath: 'tests/fixtures/business-bi/net-revenue-holdout-v1.json',
    oraclePath: 'tests/fixtures/business-bi/net-revenue-oracle-v1.json',
    sourceConnectionUsed: false,
    productionDataUsed: false,
  },
  operation: {
    operationId: plan.operationId,
    relation: plan.operation.source.relation,
    dateRole: plan.operation.source.dateRole,
    periods: plan.operation.source.periods,
    currency: plan.operation.source.currency,
    inputRowBudget: plan.bounds.inputRowBudget,
    outputRowBudget: plan.bounds.outputRowBudget,
    groupingColumns: plan.operation.aggregate.groupingColumns,
    outputColumns: plan.operation.aggregate.outputColumns,
    accessMode: plan.operation.controls.accessMode,
  },
  bindings: {
    planSha256: plan.planSha256,
    operationSha256: plan.bindings.operationSha256,
    metricContractSha256: plan.bindings.metricContractSha256,
    holdoutSha256: plan.bindings.holdoutSha256,
    oracleSha256: plan.bindings.oracleSha256,
    executionReceiptSha256: receipt.receiptSha256,
    resultSha256: receipt.resultSha256,
    readbackSha256: readback.readbackSha256,
  },
  execution: {
    state: receipt.execution.state,
    readOnlyEvidence: receipt.execution.readOnlyEvidence,
    bounded: receipt.execution.bounded,
    timeoutAware: receipt.execution.timeoutAware,
    cancelAware: receipt.execution.cancelAware,
    rowsRead: receipt.execution.rowsRead,
    rowBudget: receipt.execution.rowBudget,
    outputRows: receipt.output.rows.length,
    nonSuccessStatesPreserved: [
      'PARTIAL',
      'DENIED',
      'UNSUPPORTED',
      'UNKNOWN',
    ],
    timeoutStatePreserved: 'TIMEOUT',
    cancellationStatePreserved: 'CANCELLED',
  },
  oracleEquality: {
    status: receipt.oracleEquality,
    exactDeepEquality: true,
    comparisonNetMinorUnits: receipt.result.periods.comparison.netMinorUnits,
    currentNetMinorUnits: receipt.result.periods.current.netMinorUnits,
    deltaMinorUnits: receipt.result.deltaMinorUnits,
    aggregateUnknownQuantifiedMinorUnits:
      receipt.result.unknown.quantifiedAmountMinorUnits,
    unassignedUnknownQuantifiedMinorUnits:
      receipt.result.unknown.unassigned.quantifiedAmountMinorUnits,
  },
  renderings: {
    formats: ['JSON', 'TABLE'],
    identityEqual: renderingIdentity.identityEqual,
    deterministic: renderNetRevenueJson(renderingInput) === json
      && renderNetRevenueTable(renderingInput) === table,
    metricContractSha256: renderingIdentity.metricContractSha256,
    oracleSha256: renderingIdentity.oracleSha256,
    resultSha256: renderingIdentity.resultSha256,
    readbackSha256: renderingIdentity.readbackSha256,
    jsonSha256: renderingIdentity.jsonSha256,
    tableSha256: renderingIdentity.tableSha256,
    coverageState: readback.coverage.state,
    nonclaimsIncluded: readback.nonclaims.length === NET_REVENUE_NONCLAIMS.length,
  },
  acceptance: [
    {
      id: 'BI-KS-02-AC01',
      status: 'PASS',
      proof: 'Exact operation compile plus closed-scope/digest negative matrix.',
    },
    {
      id: 'BI-KS-02-AC02',
      status: 'PASS',
      proof: 'Bounded read-only execution and distinct status/timeout/cancel receipts.',
    },
    {
      id: 'BI-KS-02-AC03',
      status: 'PASS',
      proof: 'Deterministic JSON/TABLE renderings share verified identities and reject disagreement.',
    },
    {
      id: 'BI-KS-02-AC04',
      status: 'PASS',
      proof: 'Computed aggregate is exactly deep-equal to the independent admitted oracle.',
    },
  ],
  negativeMatrix,
  publicClosureGovernance: {
    independentReviews: [
      {
        ordinal: 1,
        role: 'INDEPENDENT_REVIEWER',
        status: 'PENDING_CONTROLLER',
        workerSelfReview: false,
      },
    ],
    finalOwners: [
      {
        ordinal: 1,
        owner: 'Sol',
        scope: 'PUBLIC_ISSUE_CLOSURE',
        status: 'PENDING_CONTROLLER',
      },
    ],
    publicClosureAuthorized: false,
    workerAuthority: 'LOCAL_CLEAN_COMMIT_ONLY',
  },
  deliveryBoundary: {
    externalEffectsPerformed: false,
    sourceDatabaseWritten: false,
    pushPerformed: false,
    mergePerformed: false,
    releasePerformed: false,
    issueClosed: false,
    queueDoneClaimed: false,
  },
  nonclaims: [...NET_REVENUE_NONCLAIMS],
};
const verification = {
  ...verificationBody,
  verificationSha256: sha256(canonicalJson(verificationBody)),
};
await writeFile(verificationPath, `${JSON.stringify(verification, null, 2)}\n`, {
  mode: 0o644,
});

process.stdout.write(`${canonicalJson({
  issue: verification.issue,
  state: verification.execution.state,
  oracleEquality: verification.oracleEquality.status,
  negativeCases: verification.negativeMatrix.length,
  jsonTableIdentity: verification.renderings.identityEqual,
  verificationSha256: verification.verificationSha256,
  path: path.relative(root, verificationPath),
})}\n`);
