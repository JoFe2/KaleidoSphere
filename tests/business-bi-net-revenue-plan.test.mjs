// BI-KS-02 / PORTFOLIO-KS146-IMPLEMENT
// One synthetic, digest-bound, read-only net-revenue aggregate only. No free
// SQL, second metric, production/real-source, Superset/chart, mutation, push,
// publish, or release authority is introduced by this focused gate.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { canonicalJson } from '../services/bi-control/src/canonical-json.js';
import {
  ADMITTED_HOLDOUT_SHA256,
  ADMITTED_METRIC_CONTRACT_SHA256,
  ADMITTED_ORACLE_SHA256,
  NET_REVENUE_EXECUTION_STATES,
  NET_REVENUE_NONCLAIMS,
  NET_REVENUE_OPERATION_ID,
  NET_REVENUE_OUTPUT_COLUMNS,
  compileNetRevenuePlan,
  createNetRevenueOperationRequest,
  executeNetRevenuePlan,
  verifyNetRevenueExecutionReceipt,
  verifyNetRevenuePlan,
} from '../services/bi-control/src/business-bi/net-revenue-plan.mjs';
import {
  createNetRevenueReadback,
  renderNetRevenueJson,
  renderNetRevenueReadback,
  renderNetRevenueTable,
  verifyNetRevenueReadback,
  verifyNetRevenueRenderings,
} from '../services/bi-control/src/business-bi/net-revenue-readback.mjs';

const [metricContractBytes, holdoutBytes, oracleBytes] = await Promise.all([
  readFile('contracts/business-bi/v1/net-revenue.metric.json'),
  readFile('tests/fixtures/business-bi/net-revenue-holdout-v1.json'),
  readFile('tests/fixtures/business-bi/net-revenue-oracle-v1.json'),
]);
const oracle = JSON.parse(oracleBytes.toString('utf8'));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function compile(request = createNetRevenueOperationRequest()) {
  return compileNetRevenuePlan({ request, metricContractBytes, oracleBytes });
}

const plan = compile();

function evidence(rowsRead = 17) {
  return {
    accessMode: 'READ_ONLY',
    mutationCount: 0,
    bounded: true,
    relation: 'synthetic_bi.orders',
    rowsRead,
  };
}

function completeResponse(bytes = holdoutBytes, overrides = {}) {
  return {
    state: 'COMPLETE',
    reasonCode: null,
    bytes,
    evidence: evidence(),
    ...overrides,
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

async function completeReceipt() {
  return execute(async () => completeResponse());
}

function readbackInput(receipt) {
  return { plan, receipt, metricContractBytes, oracleBytes };
}

function assertCode(code) {
  return { code, message: code };
}

function mutatedRequest(mutate) {
  const request = createNetRevenueOperationRequest();
  mutate(request);
  return request;
}

test('AC01 positive: only the exact versioned operation compiles with closed digest-bound scope and output', () => {
  const repeated = compile();
  assert.deepStrictEqual(repeated, plan);
  assert.equal(plan.operationId, NET_REVENUE_OPERATION_ID);
  assert.equal(plan.operation.source.relation, 'synthetic_bi.orders');
  assert.deepEqual(plan.operation.source.dateRole, {
    column: 'order_date',
    role: 'ORDER_DATE',
  });
  assert.deepEqual(plan.operation.source.periods.map(({ key, start, end }) => ({
    key,
    start,
    end,
  })), [
    { key: 'current', start: '2026-07-01', end: '2026-07-31' },
    { key: 'comparison', start: '2026-06-01', end: '2026-06-30' },
  ]);
  assert.equal(plan.operation.source.currency.code, 'EUR');
  assert.equal(plan.operation.aggregate.inputRowBudget, 17);
  assert.equal(plan.operation.aggregate.outputRowBudget, 1);
  assert.deepEqual(plan.operation.aggregate.groupingColumns, []);
  assert.deepEqual(plan.operation.aggregate.outputColumns, NET_REVENUE_OUTPUT_COLUMNS);
  assert.deepEqual(plan.bindings, {
    operationSha256: sha256(canonicalJson(plan.operation)),
    metricContractSha256: ADMITTED_METRIC_CONTRACT_SHA256,
    holdoutSha256: ADMITTED_HOLDOUT_SHA256,
    oracleSha256: ADMITTED_ORACLE_SHA256,
  });
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(verifyNetRevenuePlan({
    plan,
    metricContractBytes,
    oracleBytes,
  }), plan);
});

test('AC01 negatives: free SQL, alternate scope, unbounded period, grouping, writes, and unknown fields cannot compile', () => {
  const cases = [
    ['free SQL', (request) => { request.sql = 'SELECT * FROM synthetic_bi.orders'; }],
    ['alternate relation', (request) => { request.source.relation = 'synthetic_bi.refunds'; }],
    ['alternate date column', (request) => { request.source.dateRole.column = 'shipping_date'; }],
    ['unbounded period', (request) => { request.source.periods[0].end = null; }],
    ['third period', (request) => {
      request.source.periods.push({
        key: 'prior',
        label: '2026-05',
        start: '2026-05-01',
        end: '2026-05-31',
        boundary: 'inclusive-both-ends',
      });
    }],
    ['alternate currency', (request) => { request.source.currency.code = 'USD'; }],
    ['row-budget widening', (request) => { request.aggregate.inputRowBudget = 18; }],
    ['output-row widening', (request) => { request.aggregate.outputRowBudget = 2; }],
    ['output-column widening', (request) => { request.aggregate.outputColumns.push('customer_id'); }],
    ['extra grouping', (request) => { request.aggregate.groupingColumns.push('customer_id'); }],
    ['write access', (request) => { request.controls.accessMode = 'READ_WRITE'; }],
    ['mutation authority', (request) => { request.controls.mutationAuthority = true; }],
    ['unknown field', (request) => { request.source.unknown = true; }],
    ['alternate operation version', (request) => { request.operationId = 'bi-ks-01-net-revenue/v2'; }],
    ['second metric', (request) => { request.metric.id = 'gross-revenue'; }],
  ];
  for (const [name, mutate] of cases) {
    assert.throws(
      () => compile(mutatedRequest(mutate)),
      assertCode('BUSINESS_BI_OPERATION_DENIED'),
      name,
    );
  }

  assert.throws(() => compileNetRevenuePlan({
    request: createNetRevenueOperationRequest(),
    metricContractBytes,
    oracleBytes,
    freeSql: 'SELECT 1',
  }), assertCode('BUSINESS_BI_COMPILE_INPUT_DENIED'));
});

test('AC01 negatives: contract, oracle, plan, and holdout identity substitutions fail closed', async () => {
  const changedContract = Buffer.from(metricContractBytes);
  changedContract[changedContract.length - 2] ^= 1;
  assert.throws(() => compileNetRevenuePlan({
    request: createNetRevenueOperationRequest(),
    metricContractBytes: changedContract,
    oracleBytes,
  }), assertCode('BUSINESS_BI_METRIC_DIGEST_DENIED'));

  const changedOracle = Buffer.from(oracleBytes);
  changedOracle[changedOracle.length - 2] ^= 1;
  assert.throws(() => compileNetRevenuePlan({
    request: createNetRevenueOperationRequest(),
    metricContractBytes,
    oracleBytes: changedOracle,
  }), assertCode('BUSINESS_BI_ORACLE_DIGEST_DENIED'));

  const forgedPlan = structuredClone(plan);
  forgedPlan.bounds.inputRowBudget += 1;
  const { planSha256: _oldPlanSha256, ...forgedPlanBody } = forgedPlan;
  forgedPlan.planSha256 = sha256(canonicalJson(forgedPlanBody));
  assert.throws(() => verifyNetRevenuePlan({
    plan: forgedPlan,
    metricContractBytes,
    oracleBytes,
  }), assertCode('BUSINESS_BI_PLAN_DENIED'));

  const changedHoldout = Buffer.from(
    holdoutBytes.toString('utf8').replace('"amount_minor_units": 60', '"amount_minor_units": 61'),
  );
  assert.notEqual(sha256(changedHoldout), ADMITTED_HOLDOUT_SHA256);
  const receipt = await execute(async () => completeResponse(changedHoldout));
  assert.equal(receipt.execution.state, 'DENIED');
  assert.equal(receipt.execution.reasonCode, 'BUSINESS_BI_HOLDOUT_DIGEST_DENIED');
  assert.equal(receipt.result, null);
  assert.equal(receipt.oracleEquality, 'NOT_EVALUATED');
});

test('AC02/AC04 positive: bounded read-only execution equals the independent oracle exactly', async () => {
  let observed;
  const receipt = await execute(async (invocation) => {
    observed = invocation;
    return completeResponse();
  });

  assert.equal(Object.isFrozen(observed), true);
  assert.equal(Object.isFrozen(observed.request), true);
  assert.equal(observed.request.authority.accessMode, 'READ_ONLY');
  assert.equal(observed.request.authority.mutationAuthority, false);
  assert.equal(observed.request.authority.arbitrarySql, false);
  assert.equal(observed.request.bounds.rowBudget, 17);
  assert.equal(observed.request.bounds.byteBudget, 4096);
  assert.equal(observed.request.bounds.timeoutMs, 100);
  assert.equal(observed.request.source.expectedSha256, ADMITTED_HOLDOUT_SHA256);
  assert.equal('sql' in observed.request, false);
  assert.equal('statement' in observed.request, false);

  assert.equal(receipt.execution.state, 'COMPLETE');
  assert.equal(receipt.execution.readOnlyEvidence, 'VERIFIED');
  assert.equal(receipt.execution.rowsRead, 17);
  assert.equal(receipt.execution.mutationAuthority, false);
  assert.equal(receipt.execution.bounded, true);
  assert.equal(receipt.execution.timeoutAware, true);
  assert.equal(receipt.execution.cancelAware, true);
  assert.deepStrictEqual(receipt.result, oracle.expected);
  assert.equal(receipt.result.periods.comparison.netMinorUnits, 30000);
  assert.equal(receipt.result.periods.current.netMinorUnits, 100059);
  assert.equal(receipt.result.deltaMinorUnits, 70059);
  assert.equal(receipt.oracleEquality, 'EXACT');
  assert.equal(receipt.output.rows.length, 1);
  assert.deepEqual(receipt.output.columns, NET_REVENUE_OUTPUT_COLUMNS);
  assert.equal(receipt.output.rows[0].unknown_quantified_amount_minor_units, 1977);
  assert.equal(receipt.output.rows[0].unknown_unassigned_quantified_amount_minor_units, 1200);
  assert.equal(verifyNetRevenueExecutionReceipt({
    plan,
    receipt,
    metricContractBytes,
    oracleBytes,
  }), receipt);
});

test('AC02 positive: repeated execution is deterministic and bounded to one output row', async () => {
  const first = await completeReceipt();
  const second = await completeReceipt();
  assert.deepStrictEqual(first, second);
  assert.equal(first.receiptSha256, second.receiptSha256);
  assert.equal(first.output.rows.length, plan.bounds.outputRowBudget);
  assert.equal(first.execution.rowsRead <= first.execution.rowBudget, true);
});

test('AC02 status matrix: COMPLETE/PARTIAL/DENIED/UNSUPPORTED/UNKNOWN remain distinct and never collapse', async () => {
  const complete = await completeReceipt();
  const receipts = new Map([['COMPLETE', complete]]);
  for (const state of ['PARTIAL', 'DENIED', 'UNSUPPORTED', 'UNKNOWN']) {
    const rowsRead = state === 'PARTIAL' ? 8 : null;
    const receipt = await execute(async () => ({
      state,
      reasonCode: `SOURCE_${state}`,
      bytes: null,
      evidence: evidence(rowsRead),
    }));
    receipts.set(state, receipt);
  }

  assert.deepEqual([...receipts.keys()], [
    'COMPLETE',
    'PARTIAL',
    'DENIED',
    'UNSUPPORTED',
    'UNKNOWN',
  ]);
  assert.equal(new Set([...receipts.values()].map((receipt) => receipt.receiptSha256)).size, 5);
  for (const [state, receipt] of receipts) {
    assert.equal(receipt.execution.state, state);
    assert.equal(receipt.coverage.state, state);
    assert.equal(receipt.coverage.nonSuccessCollapsed, false);
    assert.equal(receipt.coverage.emptyOrZeroSuccessSynthesized, false);
    if (state === 'COMPLETE') continue;
    assert.equal(receipt.result, null);
    assert.equal(receipt.resultSha256, null);
    assert.equal(receipt.output, null);
    assert.equal(receipt.oracleEquality, 'NOT_EVALUATED');
    const readback = createNetRevenueReadback(readbackInput(receipt));
    assert.equal(readback.coverage.state, state);
    assert.deepEqual(readback.rows, []);
    assert.equal(readback.coverage.emptyRowsAreNotComplete, true);
  }
});

test('AC02 negatives: writes and malformed/unknown execution fields fail closed as DENIED', async () => {
  for (const response of [
    completeResponse(holdoutBytes, {
      evidence: { ...evidence(), mutationCount: 1 },
    }),
    completeResponse(holdoutBytes, {
      evidence: { ...evidence(), accessMode: 'READ_WRITE' },
    }),
    { ...completeResponse(), writeResult: { updatedRows: 1 } },
    { ...completeResponse(), state: 'SUCCEEDED' },
  ]) {
    const receipt = await execute(async () => response);
    assert.equal(receipt.execution.state, 'DENIED');
    assert.equal(receipt.result, null);
    assert.equal(receipt.coverage.emptyOrZeroSuccessSynthesized, false);
  }
});

test('AC02 negatives: empty/substituted/oversized payloads and status-collapse attempts cannot become success', async () => {
  const oversized = Buffer.alloc(plan.bounds.inputByteBudget + 1, 0x20);
  const cases = [
    [Buffer.from('{}'), 'BUSINESS_BI_HOLDOUT_DIGEST_DENIED'],
    [Buffer.alloc(0), 'BUSINESS_BI_HOLDOUT_DIGEST_DENIED'],
    [oversized, 'BUSINESS_BI_INPUT_BYTE_BUDGET_DENIED'],
  ];
  for (const [bytes, reasonCode] of cases) {
    const receipt = await execute(async () => completeResponse(bytes));
    assert.equal(receipt.execution.state, 'DENIED');
    assert.equal(receipt.execution.reasonCode, reasonCode);
    assert.equal(receipt.result, null);
  }

  const collapsedDenied = await execute(async () => ({
    state: 'DENIED',
    reasonCode: 'SOURCE_DENIED',
    bytes: Buffer.from('[]'),
    evidence: evidence(0),
  }));
  assert.equal(collapsedDenied.execution.state, 'DENIED');
  assert.equal(collapsedDenied.result, null);
  assert.equal(collapsedDenied.oracleEquality, 'NOT_EVALUATED');
});

test('AC02 negative: a fully re-digested substituted result receipt is rejected against the oracle', async () => {
  const receipt = structuredClone(await completeReceipt());
  receipt.result.periods.current.netMinorUnits += 1;
  receipt.result.deltaMinorUnits += 1;
  receipt.resultSha256 = sha256(canonicalJson(receipt.result));
  receipt.output.rows[0].current_net_minor_units += 1;
  receipt.output.rows[0].delta_minor_units += 1;
  receipt.outputSha256 = sha256(canonicalJson(receipt.output));
  const { receiptSha256: _oldReceiptSha256, ...body } = receipt;
  receipt.receiptSha256 = sha256(canonicalJson(body));

  assert.throws(() => verifyNetRevenueExecutionReceipt({
    plan,
    receipt,
    metricContractBytes,
    oracleBytes,
  }), assertCode('BUSINESS_BI_RESULT_SUBSTITUTION_DENIED'));
});

test('AC02 timeout awareness: a non-returning reader terminates as TIMEOUT without synthesizing a result', async () => {
  let aborted = false;
  const receipt = await execute(({ signal }) => new Promise(() => {
    signal.addEventListener('abort', () => { aborted = true; }, { once: true });
  }));
  assert.equal(receipt.execution.state, 'TIMEOUT');
  assert.equal(receipt.execution.reasonCode, 'BUSINESS_BI_EXECUTION_TIMEOUT');
  assert.equal(receipt.execution.readOnlyEvidence, 'NOT_OBSERVED');
  assert.equal(receipt.result, null);
  assert.equal(receipt.oracleEquality, 'NOT_EVALUATED');
  assert.equal(aborted, true);
});

test('AC02 cancellation awareness: pre-dispatch and in-flight cancellation remain CANCELLED', async () => {
  const preCancelled = new AbortController();
  preCancelled.abort();
  let dispatched = false;
  const before = await execute(async () => {
    dispatched = true;
    return completeResponse();
  }, { signal: preCancelled.signal });
  assert.equal(dispatched, false);
  assert.equal(before.execution.state, 'CANCELLED');
  assert.equal(before.result, null);

  const inFlight = new AbortController();
  let sourceSignalAborted = false;
  const running = execute(({ signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => {
      sourceSignalAborted = true;
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  }), { signal: inFlight.signal });
  setImmediate(() => inFlight.abort());
  const during = await running;
  assert.equal(during.execution.state, 'CANCELLED');
  assert.equal(during.execution.reasonCode, 'BUSINESS_BI_EXECUTION_CANCELLED');
  assert.equal(during.result, null);
  assert.equal(sourceSignalAborted, true);
});

test('AC02 unknown outcome: a reader failure remains UNKNOWN and is not changed to empty success', async () => {
  const receipt = await execute(async () => {
    throw new Error('synthetic transport failure');
  });
  assert.equal(receipt.execution.state, 'UNKNOWN');
  assert.equal(receipt.execution.reasonCode, 'BUSINESS_BI_SOURCE_OUTCOME_UNKNOWN');
  assert.equal(receipt.result, null);
  assert.equal(receipt.output, null);
  assert.equal(receipt.coverage.resultAvailable, false);
});

test('AC03 positive: deterministic JSON and TABLE bind the same verified result, metric, oracle, coverage, and nonclaims', async () => {
  const receipt = await completeReceipt();
  const input = readbackInput(receipt);
  const readback = createNetRevenueReadback(input);
  const json = renderNetRevenueJson(input);
  const table = renderNetRevenueTable(input);
  const genericJson = renderNetRevenueReadback({ ...input, format: 'JSON' });
  const genericTable = renderNetRevenueReadback({ ...input, format: 'TABLE' });
  const identity = verifyNetRevenueRenderings({ ...input, json, table });

  assert.equal(json, genericJson);
  assert.equal(table, genericTable);
  assert.equal(renderNetRevenueJson(input), json);
  assert.equal(renderNetRevenueTable(input), table);
  assert.equal(identity.identityEqual, true);
  assert.equal(identity.readbackSha256, readback.readbackSha256);
  assert.equal(identity.metricContractSha256, ADMITTED_METRIC_CONTRACT_SHA256);
  assert.equal(identity.oracleSha256, ADMITTED_ORACLE_SHA256);
  assert.equal(identity.resultSha256, receipt.resultSha256);
  assert.deepStrictEqual(JSON.parse(json), readback);
  assert.equal(table.includes(`# result_sha256=${receipt.resultSha256}\n`), true);
  assert.equal(table.includes('# coverage_state=COMPLETE\n'), true);
  assert.equal(table.includes('# oracle_equality=EXACT\n'), true);
  for (const nonclaim of NET_REVENUE_NONCLAIMS) {
    assert.equal(readback.nonclaims.includes(nonclaim), true);
    assert.equal(table.includes(JSON.stringify(nonclaim)), true);
  }
  assert.equal(verifyNetRevenueReadback({ ...input, readback }), readback);
});

test('AC03 negatives: rendering disagreement, unknown format, and readback substitution fail closed', async () => {
  const receipt = await completeReceipt();
  const input = readbackInput(receipt);
  const json = renderNetRevenueJson(input);
  const table = renderNetRevenueTable(input);

  assert.throws(() => verifyNetRevenueRenderings({
    ...input,
    json,
    table: table.replace('| 70059 |', '| 70060 |'),
  }), assertCode('BUSINESS_BI_RENDERING_DISAGREEMENT'));
  assert.throws(() => verifyNetRevenueRenderings({
    ...input,
    json: json.replace('"oracleEquality":"EXACT"', '"oracleEquality":"NOT_EVALUATED"'),
    table,
  }), assertCode('BUSINESS_BI_RENDERING_DISAGREEMENT'));
  assert.throws(() => renderNetRevenueReadback({
    ...input,
    format: 'CSV',
  }), assertCode('BUSINESS_BI_RENDER_FORMAT_DENIED'));

  const substituted = structuredClone(createNetRevenueReadback(input));
  substituted.rows[0].delta_minor_units += 1;
  const { readbackSha256: _oldReadbackSha256, ...body } = substituted;
  substituted.readbackSha256 = sha256(canonicalJson(body));
  assert.throws(() => verifyNetRevenueReadback({
    ...input,
    readback: substituted,
  }), assertCode('BUSINESS_BI_READBACK_SUBSTITUTION_DENIED'));
});

test('checked clean-room receipt records all four criteria, the full negative matrix, and one-review/one-Sol-owner governance', async () => {
  const verification = JSON.parse(await readFile(
    'verification/business-bi-net-revenue-holdout-v1.json',
    'utf8',
  ));
  const { verificationSha256, ...verificationBody } = verification;
  assert.equal(verificationSha256, sha256(canonicalJson(verificationBody)));
  assert.equal(verification.schemaVersion,
    'kaleidosphere.business-bi/net-revenue-holdout-verification/v1');
  assert.equal(verification.taskId, 'PORTFOLIO-KS146-IMPLEMENT');
  assert.equal(verification.issue, 'BI-KS-02');
  assert.deepEqual(verification.acceptance.map(({ id, status }) => [id, status]), [
    ['BI-KS-02-AC01', 'PASS'],
    ['BI-KS-02-AC02', 'PASS'],
    ['BI-KS-02-AC03', 'PASS'],
    ['BI-KS-02-AC04', 'PASS'],
  ]);
  assert.equal(verification.execution.state, 'COMPLETE');
  assert.equal(verification.oracleEquality.status, 'EXACT');
  assert.equal(verification.renderings.identityEqual, true);
  assert.equal(verification.negativeMatrix.length >= 18, true);
  assert.equal(verification.negativeMatrix.every(({ status }) => status === 'PASS'), true);
  for (const required of [
    'FREE_SQL',
    'ALTERNATE_RELATION',
    'ALTERNATE_COLUMN',
    'UNBOUNDED_PERIOD',
    'EXTRA_GROUPING',
    'UNKNOWN_FIELD',
    'WRITE_ATTEMPT',
    'SUBSTITUTED_RESULT',
    'STATUS_COLLAPSE',
    'TIMEOUT_LOSS',
    'CANCEL_LOSS',
    'RENDERING_DISAGREEMENT',
  ]) assert.equal(verification.negativeMatrix.some(({ id }) => id === required), true, required);
  assert.equal(verification.publicClosureGovernance.independentReviews.length, 1);
  assert.equal(verification.publicClosureGovernance.independentReviews[0].status,
    'PENDING_CONTROLLER');
  assert.equal(verification.publicClosureGovernance.finalOwners.length, 1);
  assert.equal(verification.publicClosureGovernance.finalOwners[0].owner, 'Sol');
  assert.equal(verification.publicClosureGovernance.publicClosureAuthorized, false);
});
