import { createHash } from 'node:crypto';

import { canonicalJson } from '../canonical-json.js';

export const NET_REVENUE_OPERATION_REQUEST_SCHEMA =
  'kaleidosphere.business-bi/net-revenue-operation-request/v1';
export const NET_REVENUE_PLAN_SCHEMA =
  'kaleidosphere.business-bi/net-revenue-plan/v1';
export const NET_REVENUE_SOURCE_REQUEST_SCHEMA =
  'kaleidosphere.business-bi/net-revenue-source-read/v1';
export const NET_REVENUE_EXECUTION_RECEIPT_SCHEMA =
  'kaleidosphere.business-bi/net-revenue-execution-receipt/v1';
export const NET_REVENUE_OPERATION_ID = 'bi-ks-01-net-revenue/v1';

export const ADMITTED_METRIC_CONTRACT_SHA256 =
  '455f735e55f03155c657dc963656ed01363e546345824dfea66b883c287d9d70';
export const ADMITTED_HOLDOUT_SHA256 =
  '2d0ba0bb806e73a473688d6137c6182f4233aec1bed92aee708c4a052d327a4d';
export const ADMITTED_ORACLE_SHA256 =
  'ce0c135351a8179f08cfca77b91a9624f2f6a7e16fd81cda8c3aba780f4a9164';

export const NET_REVENUE_EXECUTION_STATES = Object.freeze([
  'COMPLETE',
  'PARTIAL',
  'DENIED',
  'UNSUPPORTED',
  'UNKNOWN',
  'TIMEOUT',
  'CANCELLED',
]);

const SOURCE_STATES = Object.freeze([
  'COMPLETE',
  'PARTIAL',
  'DENIED',
  'UNSUPPORTED',
  'UNKNOWN',
]);
const RECORD_KINDS = Object.freeze(['sale', 'credit', 'cancel', 'unknown']);
const ROW_FIELDS = Object.freeze([
  'amount_minor_units',
  'order_date',
  'order_id',
  'record_kind',
]);
const REASON_CODE = /^[A-Z][A-Z0-9_]{2,127}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SYNTHETIC_ID = /^s-\d{3,}$/;

export const NET_REVENUE_OUTPUT_COLUMNS = Object.freeze([
  'current_net_minor_units',
  'current_sale_minor_units',
  'current_credit_minor_units',
  'current_cancel_count',
  'current_unknown_count',
  'current_unknown_quantified_amount_minor_units',
  'current_unknown_unquantified_count',
  'current_row_count',
  'comparison_net_minor_units',
  'comparison_sale_minor_units',
  'comparison_credit_minor_units',
  'comparison_cancel_count',
  'comparison_unknown_count',
  'comparison_unknown_quantified_amount_minor_units',
  'comparison_unknown_unquantified_count',
  'comparison_row_count',
  'delta_minor_units',
  'unknown_count',
  'unknown_quantified_amount_minor_units',
  'unknown_unquantified_count',
  'unknown_unassigned_count',
  'unknown_unassigned_quantified_amount_minor_units',
  'unknown_unassigned_unquantified_count',
  'excluded_out_of_scope_count',
]);

export const NET_REVENUE_NONCLAIMS = Object.freeze([
  'No arbitrary SQL: this surface compiles one typed operation and exposes no SQL input.',
  'No second metric: only the admitted versioned synthetic net-revenue operation is in scope.',
  'No real-source or production claim: execution is bound to the admitted synthetic non-customer holdout bytes.',
  'No Superset, chart, dashboard, publish, release, or mutation authority is provided.',
]);

const CLOSED_OPERATION = {
  schemaVersion: NET_REVENUE_OPERATION_REQUEST_SCHEMA,
  operationId: NET_REVENUE_OPERATION_ID,
  metric: {
    id: 'bi-ks-01-net-revenue',
    schemaVersion: 'kaleidosphere.business-bi/net-revenue-metric/v1',
  },
  source: {
    classification: 'SYNTHETIC_NON_CUSTOMER_BYTES',
    relation: 'synthetic_bi.orders',
    relationKind: 'SYNTHETIC_TABLE',
    dateRole: {
      role: 'ORDER_DATE',
      column: 'order_date',
    },
    currency: {
      code: 'EUR',
      amountColumn: 'amount_minor_units',
      minorUnitsPerMajorUnit: 100,
    },
    periods: [
      {
        key: 'current',
        label: '2026-07',
        start: '2026-07-01',
        end: '2026-07-31',
        boundary: 'inclusive-both-ends',
      },
      {
        key: 'comparison',
        label: '2026-06',
        start: '2026-06-01',
        end: '2026-06-30',
        boundary: 'inclusive-both-ends',
      },
    ],
  },
  aggregate: {
    kind: 'NET_REVENUE',
    recordKindColumn: 'record_kind',
    groupingColumns: [],
    inputRowBudget: 17,
    inputByteBudget: 4096,
    outputRowBudget: 1,
    outputColumns: [...NET_REVENUE_OUTPUT_COLUMNS],
  },
  controls: {
    accessMode: 'READ_ONLY',
    timeoutMs: 100,
    timeoutAware: true,
    cancelAware: true,
    mutationAuthority: false,
  },
};

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function cloneJson(value) {
  return JSON.parse(canonicalJson(value));
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export const NET_REVENUE_OPERATION_REQUEST = deepFreeze(cloneJson(CLOSED_OPERATION));

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, allowed, required = allowed) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.every((key) => allowed.includes(key))
    && required.every((key) => keys.includes(key));
}

function bytesOf(value, code) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  fail(code);
}

function parseBoundJson(bytes, code) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    fail(code);
  }
}

function isCalendarDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function assertSafeInteger(value, code) {
  if (!Number.isSafeInteger(value) || Object.is(value, -0)) fail(code);
  return value;
}

function safeAdd(left, right) {
  assertSafeInteger(left, 'BUSINESS_BI_INTEGER_ARITHMETIC_DENIED');
  assertSafeInteger(right, 'BUSINESS_BI_INTEGER_ARITHMETIC_DENIED');
  return assertSafeInteger(left + right, 'BUSINESS_BI_INTEGER_ARITHMETIC_DENIED');
}

function assertUnknownChannel(value, code) {
  if (!exactKeys(value, [
    'count',
    'quantifiedAmountMinorUnits',
    'unquantifiedCount',
  ])) fail(code);
  for (const field of Object.keys(value)) {
    if (assertSafeInteger(value[field], code) < 0) fail(code);
  }
}

function assertAggregateResult(value, code = 'BUSINESS_BI_RESULT_SHAPE_DENIED') {
  if (!exactKeys(value, [
    'periods',
    'deltaMinorUnits',
    'unknown',
    'excludedOutOfScopeCount',
  ]) || !exactKeys(value.periods, ['current', 'comparison'])) fail(code);

  for (const periodName of ['current', 'comparison']) {
    const period = value.periods[periodName];
    if (!exactKeys(period, [
      'netMinorUnits',
      'saleMinorUnits',
      'creditMinorUnits',
      'cancelCount',
      'unknown',
      'rowCount',
    ])) fail(code);
    for (const field of [
      'netMinorUnits',
      'saleMinorUnits',
      'creditMinorUnits',
      'cancelCount',
      'rowCount',
    ]) assertSafeInteger(period[field], code);
    if (period.saleMinorUnits < 0
      || period.creditMinorUnits < 0
      || period.cancelCount < 0
      || period.rowCount < 0) fail(code);
    assertUnknownChannel(period.unknown, code);
  }

  assertSafeInteger(value.deltaMinorUnits, code);
  assertSafeInteger(value.excludedOutOfScopeCount, code);
  if (value.excludedOutOfScopeCount < 0
    || !exactKeys(value.unknown, [
      'count',
      'quantifiedAmountMinorUnits',
      'unquantifiedCount',
      'unassigned',
    ])) fail(code);
  assertUnknownChannel({
    count: value.unknown.count,
    quantifiedAmountMinorUnits: value.unknown.quantifiedAmountMinorUnits,
    unquantifiedCount: value.unknown.unquantifiedCount,
  }, code);
  assertUnknownChannel(value.unknown.unassigned, code);
  return value;
}

function flattenResult(result) {
  assertAggregateResult(result);
  const { current, comparison } = result.periods;
  const row = {
    current_net_minor_units: current.netMinorUnits,
    current_sale_minor_units: current.saleMinorUnits,
    current_credit_minor_units: current.creditMinorUnits,
    current_cancel_count: current.cancelCount,
    current_unknown_count: current.unknown.count,
    current_unknown_quantified_amount_minor_units:
      current.unknown.quantifiedAmountMinorUnits,
    current_unknown_unquantified_count: current.unknown.unquantifiedCount,
    current_row_count: current.rowCount,
    comparison_net_minor_units: comparison.netMinorUnits,
    comparison_sale_minor_units: comparison.saleMinorUnits,
    comparison_credit_minor_units: comparison.creditMinorUnits,
    comparison_cancel_count: comparison.cancelCount,
    comparison_unknown_count: comparison.unknown.count,
    comparison_unknown_quantified_amount_minor_units:
      comparison.unknown.quantifiedAmountMinorUnits,
    comparison_unknown_unquantified_count: comparison.unknown.unquantifiedCount,
    comparison_row_count: comparison.rowCount,
    delta_minor_units: result.deltaMinorUnits,
    unknown_count: result.unknown.count,
    unknown_quantified_amount_minor_units:
      result.unknown.quantifiedAmountMinorUnits,
    unknown_unquantified_count: result.unknown.unquantifiedCount,
    unknown_unassigned_count: result.unknown.unassigned.count,
    unknown_unassigned_quantified_amount_minor_units:
      result.unknown.unassigned.quantifiedAmountMinorUnits,
    unknown_unassigned_unquantified_count:
      result.unknown.unassigned.unquantifiedCount,
    excluded_out_of_scope_count: result.excludedOutOfScopeCount,
  };
  if (canonicalJson(Object.keys(row)) !== canonicalJson(NET_REVENUE_OUTPUT_COLUMNS)) {
    fail('BUSINESS_BI_OUTPUT_COLUMNS_DENIED');
  }
  return row;
}

function assertContractMatchesOperation(contract) {
  const operation = NET_REVENUE_OPERATION_REQUEST;
  if (!isPlainObject(contract)
    || contract.schemaVersion !== operation.metric.schemaVersion
    || contract.metric?.id !== operation.metric.id
    || contract.relation?.name !== operation.source.relation
    || contract.relation?.kind !== operation.source.relationKind
    || contract.orderDateRole?.role !== operation.source.dateRole.role
    || contract.orderDateRole?.column !== operation.source.dateRole.column
    || contract.currency?.code !== operation.source.currency.code
    || contract.currency?.amountColumn !== operation.source.currency.amountColumn
    || contract.currency?.minorUnitsPerMajorUnit
      !== operation.source.currency.minorUnitsPerMajorUnit) {
    fail('BUSINESS_BI_METRIC_CONTRACT_DENIED');
  }

  for (const period of operation.source.periods) {
    if (canonicalJson(contract.periods?.[period.key]) !== canonicalJson({
      label: period.label,
      start: period.start,
      end: period.end,
      boundary: period.boundary,
    })) fail('BUSINESS_BI_METRIC_CONTRACT_DENIED');
  }

  if (contract.holdout?.byteBound !== true) {
    fail('BUSINESS_BI_METRIC_CONTRACT_DENIED');
  }
}

function assertOracle(oracle) {
  if (!isPlainObject(oracle)
    || oracle.schemaVersion !== 'kaleidosphere.business-bi/net-revenue-oracle/v1'
    || oracle.classification !== 'SYNTHETIC_NON_CUSTOMER_BYTES'
    || oracle.receipt?.binding !== 'sha256-of-exact-file-bytes'
    || oracle.receipt?.contract?.sha256 !== ADMITTED_METRIC_CONTRACT_SHA256
    || oracle.receipt?.holdout?.sha256 !== ADMITTED_HOLDOUT_SHA256) {
    fail('BUSINESS_BI_ORACLE_DENIED');
  }
  assertAggregateResult(oracle.expected, 'BUSINESS_BI_ORACLE_DENIED');
  flattenResult(oracle.expected);
  return oracle;
}

export function createNetRevenueOperationRequest() {
  return cloneJson(NET_REVENUE_OPERATION_REQUEST);
}

export function compileNetRevenuePlan(input) {
  if (!exactKeys(input, ['request', 'metricContractBytes', 'oracleBytes'])) {
    fail('BUSINESS_BI_COMPILE_INPUT_DENIED');
  }
  if (canonicalJson(input.request) !== canonicalJson(NET_REVENUE_OPERATION_REQUEST)) {
    fail('BUSINESS_BI_OPERATION_DENIED');
  }

  const metricContractBytes = bytesOf(
    input.metricContractBytes,
    'BUSINESS_BI_METRIC_BYTES_DENIED',
  );
  const oracleBytes = bytesOf(input.oracleBytes, 'BUSINESS_BI_ORACLE_BYTES_DENIED');
  if (sha256(metricContractBytes) !== ADMITTED_METRIC_CONTRACT_SHA256) {
    fail('BUSINESS_BI_METRIC_DIGEST_DENIED');
  }
  if (sha256(oracleBytes) !== ADMITTED_ORACLE_SHA256) {
    fail('BUSINESS_BI_ORACLE_DIGEST_DENIED');
  }

  const contract = parseBoundJson(
    metricContractBytes,
    'BUSINESS_BI_METRIC_JSON_DENIED',
  );
  const oracle = parseBoundJson(oracleBytes, 'BUSINESS_BI_ORACLE_JSON_DENIED');
  assertContractMatchesOperation(contract);
  assertOracle(oracle);

  const operation = cloneJson(NET_REVENUE_OPERATION_REQUEST);
  const body = {
    schemaVersion: NET_REVENUE_PLAN_SCHEMA,
    operationId: NET_REVENUE_OPERATION_ID,
    operation,
    bindings: {
      operationSha256: sha256(canonicalJson(operation)),
      metricContractSha256: ADMITTED_METRIC_CONTRACT_SHA256,
      holdoutSha256: ADMITTED_HOLDOUT_SHA256,
      oracleSha256: ADMITTED_ORACLE_SHA256,
    },
    bounds: {
      inputRowBudget: operation.aggregate.inputRowBudget,
      inputByteBudget: operation.aggregate.inputByteBudget,
      outputRowBudget: operation.aggregate.outputRowBudget,
      timeoutMs: operation.controls.timeoutMs,
    },
    authority: {
      arbitrarySql: false,
      sourceWrites: false,
      mutationAuthority: false,
      secondMetric: false,
      groupingWidening: false,
      realSourceClaim: false,
    },
  };
  return deepFreeze({ ...body, planSha256: sha256(canonicalJson(body)) });
}

export function verifyNetRevenuePlan(input) {
  if (!exactKeys(input, ['plan', 'metricContractBytes', 'oracleBytes'])) {
    fail('BUSINESS_BI_PLAN_VERIFY_INPUT_DENIED');
  }
  if (!isPlainObject(input.plan)) fail('BUSINESS_BI_PLAN_DENIED');
  const expected = compileNetRevenuePlan({
    request: input.plan.operation,
    metricContractBytes: input.metricContractBytes,
    oracleBytes: input.oracleBytes,
  });
  if (canonicalJson(input.plan) !== canonicalJson(expected)) {
    fail('BUSINESS_BI_PLAN_DENIED');
  }
  return input.plan;
}

function emptyUnknownChannel() {
  return {
    count: 0,
    quantifiedAmountMinorUnits: 0,
    unquantifiedCount: 0,
  };
}

function recordUnknown(channel, amount) {
  channel.count = safeAdd(channel.count, 1);
  if (Number.isSafeInteger(amount)) {
    channel.quantifiedAmountMinorUnits = safeAdd(
      channel.quantifiedAmountMinorUnits,
      amount,
    );
  } else {
    channel.unquantifiedCount = safeAdd(channel.unquantifiedCount, 1);
  }
}

function computeNetRevenue(holdout, plan) {
  if (!exactKeys(holdout, [
    'schemaVersion',
    'classification',
    'issue',
    'contractPath',
    'relation',
    'currencyCode',
    'rowOrder',
    'rows',
  ])
    || holdout.schemaVersion
      !== 'kaleidosphere.business-bi/net-revenue-holdout/v1'
    || holdout.classification !== 'SYNTHETIC_NON_CUSTOMER_BYTES'
    || holdout.relation !== plan.operation.source.relation
    || holdout.currencyCode !== plan.operation.source.currency.code
    || !Array.isArray(holdout.rows)
    || holdout.rows.length > plan.bounds.inputRowBudget) {
    fail('BUSINESS_BI_HOLDOUT_SHAPE_DENIED');
  }

  const periods = {
    current: {
      netMinorUnits: 0,
      saleMinorUnits: 0,
      creditMinorUnits: 0,
      cancelCount: 0,
      unknown: emptyUnknownChannel(),
      rowCount: 0,
    },
    comparison: {
      netMinorUnits: 0,
      saleMinorUnits: 0,
      creditMinorUnits: 0,
      cancelCount: 0,
      unknown: emptyUnknownChannel(),
      rowCount: 0,
    },
  };
  const unknown = {
    ...emptyUnknownChannel(),
    unassigned: emptyUnknownChannel(),
  };
  const periodByName = Object.fromEntries(
    plan.operation.source.periods.map((period) => [period.key, period]),
  );
  let excludedOutOfScopeCount = 0;
  const seenIds = new Set();

  for (const row of holdout.rows) {
    if (!exactKeys(row, ROW_FIELDS)) fail('BUSINESS_BI_HOLDOUT_ROW_DENIED');
    if (typeof row.order_id !== 'string'
      || !SYNTHETIC_ID.test(row.order_id)
      || seenIds.has(row.order_id)) fail('BUSINESS_BI_HOLDOUT_ROW_DENIED');
    seenIds.add(row.order_id);

    const date = row.order_date;
    const kind = row.record_kind;
    const amount = row.amount_minor_units;
    if (date !== null && !isCalendarDate(date)) {
      fail('BUSINESS_BI_HOLDOUT_ROW_DENIED');
    }
    if (!RECORD_KINDS.includes(kind)
      || (amount !== null
        && (!Number.isSafeInteger(amount) || Object.is(amount, -0)))) {
      fail('BUSINESS_BI_HOLDOUT_ROW_DENIED');
    }

    const hasAmount = Number.isSafeInteger(amount);
    if (kind === 'cancel' && amount !== 0) fail('BUSINESS_BI_RECORD_RULE_DENIED');
    if (kind === 'credit' && hasAmount && amount <= 0) {
      fail('BUSINESS_BI_RECORD_RULE_DENIED');
    }
    if ((kind === 'sale' || kind === 'unknown') && hasAmount && amount < 0) {
      fail('BUSINESS_BI_RECORD_RULE_DENIED');
    }

    const routesToUnknown = date === null || kind === 'unknown' || amount === null;
    if (routesToUnknown) recordUnknown(unknown, amount);
    if (date === null) {
      recordUnknown(unknown.unassigned, amount);
      continue;
    }

    const current = periodByName.current;
    const comparison = periodByName.comparison;
    const inCurrent = date >= current.start && date <= current.end;
    const inComparison = date >= comparison.start && date <= comparison.end;
    if (routesToUnknown) {
      if (inCurrent || inComparison) {
        const bucket = periods[inCurrent ? 'current' : 'comparison'];
        bucket.rowCount = safeAdd(bucket.rowCount, 1);
        recordUnknown(bucket.unknown, amount);
      } else {
        excludedOutOfScopeCount = safeAdd(excludedOutOfScopeCount, 1);
      }
      continue;
    }

    if (inCurrent || inComparison) {
      const bucket = periods[inCurrent ? 'current' : 'comparison'];
      bucket.rowCount = safeAdd(bucket.rowCount, 1);
      if (kind === 'sale') {
        bucket.saleMinorUnits = safeAdd(bucket.saleMinorUnits, amount);
        bucket.netMinorUnits = safeAdd(bucket.netMinorUnits, amount);
      } else if (kind === 'credit') {
        bucket.creditMinorUnits = safeAdd(bucket.creditMinorUnits, amount);
        bucket.netMinorUnits = safeAdd(bucket.netMinorUnits, -amount);
      } else {
        bucket.cancelCount = safeAdd(bucket.cancelCount, 1);
      }
    } else {
      excludedOutOfScopeCount = safeAdd(excludedOutOfScopeCount, 1);
    }
  }

  return assertAggregateResult({
    periods,
    deltaMinorUnits: safeAdd(
      periods.current.netMinorUnits,
      -periods.comparison.netMinorUnits,
    ),
    unknown,
    excludedOutOfScopeCount,
  });
}

function sourceRequestFor(plan) {
  const body = {
    schemaVersion: NET_REVENUE_SOURCE_REQUEST_SCHEMA,
    operationId: plan.operationId,
    planSha256: plan.planSha256,
    source: {
      classification: plan.operation.source.classification,
      relation: plan.operation.source.relation,
      fields: [...ROW_FIELDS],
      payloadFormat: 'EXACT_JSON_BYTES',
      expectedSha256: plan.bindings.holdoutSha256,
    },
    bounds: {
      rowBudget: plan.bounds.inputRowBudget,
      byteBudget: plan.bounds.inputByteBudget,
      timeoutMs: plan.bounds.timeoutMs,
    },
    authority: {
      accessMode: 'READ_ONLY',
      mutationAuthority: false,
      arbitrarySql: false,
    },
  };
  return deepFreeze({
    ...body,
    requestSha256: sha256(canonicalJson(body)),
  });
}

async function raceRead({ read, sourceRequest, externalSignal, timeoutMs }) {
  if (externalSignal?.aborted) return { kind: 'CANCELLED' };

  const controller = new AbortController();
  let timer;
  let removeExternal = () => {};
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort('BUSINESS_BI_EXECUTION_TIMEOUT');
      resolve({ kind: 'TIMEOUT' });
    }, timeoutMs);
  });
  const cancellation = new Promise((resolve) => {
    if (!externalSignal) return;
    const cancel = () => {
      controller.abort('BUSINESS_BI_EXECUTION_CANCELLED');
      resolve({ kind: 'CANCELLED' });
    };
    externalSignal.addEventListener('abort', cancel, { once: true });
    removeExternal = () => externalSignal.removeEventListener('abort', cancel);
  });
  const execution = Promise.resolve()
    .then(() => read(Object.freeze({
      request: sourceRequest,
      signal: controller.signal,
    })))
    .then(
      (response) => ({ kind: 'RESPONSE', response }),
      (error) => ({ kind: 'ERROR', error }),
    );

  try {
    return await Promise.race([execution, timeout, cancellation]);
  } finally {
    clearTimeout(timer);
    removeExternal();
  }
}

function outputFor(result) {
  const output = {
    columns: [...NET_REVENUE_OUTPUT_COLUMNS],
    rows: [flattenResult(result)],
  };
  if (output.rows.length !== 1) fail('BUSINESS_BI_OUTPUT_ROW_BUDGET_DENIED');
  return output;
}

function buildExecutionReceipt(plan, {
  state,
  reasonCode,
  rowsRead,
  readOnlyEvidence,
  result = null,
}) {
  if (!NET_REVENUE_EXECUTION_STATES.includes(state)
    || (state === 'COMPLETE' ? reasonCode !== null : !REASON_CODE.test(reasonCode ?? ''))
    || !['VERIFIED', 'NOT_OBSERVED', 'DENIED'].includes(readOnlyEvidence)
    || !(rowsRead === null
      || (Number.isSafeInteger(rowsRead)
        && rowsRead >= 0
        && rowsRead <= plan.bounds.inputRowBudget))) {
    fail('BUSINESS_BI_EXECUTION_RECEIPT_INPUT_DENIED');
  }
  if ((state === 'COMPLETE') !== (result !== null)) {
    fail('BUSINESS_BI_EXECUTION_RECEIPT_INPUT_DENIED');
  }

  const normalizedResult = result === null ? null : cloneJson(assertAggregateResult(result));
  const output = normalizedResult === null ? null : outputFor(normalizedResult);
  const body = {
    schemaVersion: NET_REVENUE_EXECUTION_RECEIPT_SCHEMA,
    operationId: plan.operationId,
    bindings: {
      planSha256: plan.planSha256,
      operationSha256: plan.bindings.operationSha256,
      metricContractSha256: plan.bindings.metricContractSha256,
      holdoutSha256: plan.bindings.holdoutSha256,
      oracleSha256: plan.bindings.oracleSha256,
    },
    execution: {
      state,
      reasonCode,
      accessMode: 'READ_ONLY',
      mutationAuthority: false,
      readOnlyEvidence,
      bounded: true,
      timeoutAware: true,
      cancelAware: true,
      rowsRead,
      rowBudget: plan.bounds.inputRowBudget,
      byteBudget: plan.bounds.inputByteBudget,
      timeoutMs: plan.bounds.timeoutMs,
    },
    coverage: {
      state,
      resultAvailable: state === 'COMPLETE',
      nonSuccessCollapsed: false,
      emptyOrZeroSuccessSynthesized: false,
    },
    result: normalizedResult,
    resultSha256:
      normalizedResult === null ? null : sha256(canonicalJson(normalizedResult)),
    output,
    outputSha256: output === null ? null : sha256(canonicalJson(output)),
    oracleEquality: state === 'COMPLETE' ? 'EXACT' : 'NOT_EVALUATED',
    nonclaims: [...NET_REVENUE_NONCLAIMS],
  };
  return deepFreeze({ ...body, receiptSha256: sha256(canonicalJson(body)) });
}

function sourceEnvelopeError(response, plan) {
  if (!exactKeys(response, ['state', 'reasonCode', 'bytes', 'evidence'])
    || !SOURCE_STATES.includes(response.state)
    || !exactKeys(response.evidence, [
      'accessMode',
      'mutationCount',
      'bounded',
      'relation',
      'rowsRead',
    ])) return 'BUSINESS_BI_SOURCE_ENVELOPE_DENIED';

  const evidence = response.evidence;
  if (evidence.accessMode !== 'READ_ONLY'
    || evidence.mutationCount !== 0
    || evidence.bounded !== true) return 'BUSINESS_BI_READ_ONLY_EVIDENCE_DENIED';
  if (evidence.relation !== plan.operation.source.relation
    || !(evidence.rowsRead === null
      || (Number.isSafeInteger(evidence.rowsRead)
        && evidence.rowsRead >= 0
        && evidence.rowsRead <= plan.bounds.inputRowBudget))) {
    return 'BUSINESS_BI_SOURCE_SCOPE_DENIED';
  }
  if (response.state === 'COMPLETE') {
    if (response.reasonCode !== null
      || evidence.rowsRead === null
      || !(Buffer.isBuffer(response.bytes)
        || response.bytes instanceof Uint8Array)) {
      return 'BUSINESS_BI_SOURCE_ENVELOPE_DENIED';
    }
  } else if (!REASON_CODE.test(response.reasonCode ?? '')
    || response.bytes !== null) {
    return 'BUSINESS_BI_SOURCE_ENVELOPE_DENIED';
  }
  return null;
}

export async function executeNetRevenuePlan(input) {
  if (!exactKeys(
    input,
    ['plan', 'metricContractBytes', 'oracleBytes', 'read', 'signal'],
    ['plan', 'metricContractBytes', 'oracleBytes', 'read'],
  ) || typeof input.read !== 'function'
    || (input.signal !== undefined
      && (typeof input.signal?.aborted !== 'boolean'
        || typeof input.signal?.addEventListener !== 'function'
        || typeof input.signal?.removeEventListener !== 'function'))) {
    fail('BUSINESS_BI_EXECUTION_INPUT_DENIED');
  }

  const plan = verifyNetRevenuePlan({
    plan: input.plan,
    metricContractBytes: input.metricContractBytes,
    oracleBytes: input.oracleBytes,
  });
  const oracleBytes = bytesOf(input.oracleBytes, 'BUSINESS_BI_ORACLE_BYTES_DENIED');
  const oracle = assertOracle(parseBoundJson(
    oracleBytes,
    'BUSINESS_BI_ORACLE_JSON_DENIED',
  ));
  const sourceRequest = sourceRequestFor(plan);
  const outcome = await raceRead({
    read: input.read,
    sourceRequest,
    externalSignal: input.signal,
    timeoutMs: plan.bounds.timeoutMs,
  });

  if (outcome.kind === 'TIMEOUT') {
    return buildExecutionReceipt(plan, {
      state: 'TIMEOUT',
      reasonCode: 'BUSINESS_BI_EXECUTION_TIMEOUT',
      rowsRead: null,
      readOnlyEvidence: 'NOT_OBSERVED',
    });
  }
  if (outcome.kind === 'CANCELLED') {
    return buildExecutionReceipt(plan, {
      state: 'CANCELLED',
      reasonCode: 'BUSINESS_BI_EXECUTION_CANCELLED',
      rowsRead: null,
      readOnlyEvidence: 'NOT_OBSERVED',
    });
  }
  if (outcome.kind === 'ERROR') {
    return buildExecutionReceipt(plan, {
      state: 'UNKNOWN',
      reasonCode: 'BUSINESS_BI_SOURCE_OUTCOME_UNKNOWN',
      rowsRead: null,
      readOnlyEvidence: 'NOT_OBSERVED',
    });
  }

  const envelopeCode = sourceEnvelopeError(outcome.response, plan);
  if (envelopeCode !== null) {
    return buildExecutionReceipt(plan, {
      state: 'DENIED',
      reasonCode: envelopeCode,
      rowsRead: null,
      readOnlyEvidence: envelopeCode === 'BUSINESS_BI_READ_ONLY_EVIDENCE_DENIED'
        ? 'DENIED'
        : 'NOT_OBSERVED',
    });
  }

  const response = outcome.response;
  if (response.state !== 'COMPLETE') {
    return buildExecutionReceipt(plan, {
      state: response.state,
      reasonCode: response.reasonCode,
      rowsRead: response.evidence.rowsRead,
      readOnlyEvidence: 'VERIFIED',
    });
  }

  const holdoutBytes = bytesOf(response.bytes, 'BUSINESS_BI_HOLDOUT_BYTES_DENIED');
  if (holdoutBytes.byteLength > plan.bounds.inputByteBudget) {
    return buildExecutionReceipt(plan, {
      state: 'DENIED',
      reasonCode: 'BUSINESS_BI_INPUT_BYTE_BUDGET_DENIED',
      rowsRead: null,
      readOnlyEvidence: 'VERIFIED',
    });
  }
  if (sha256(holdoutBytes) !== plan.bindings.holdoutSha256) {
    return buildExecutionReceipt(plan, {
      state: 'DENIED',
      reasonCode: 'BUSINESS_BI_HOLDOUT_DIGEST_DENIED',
      rowsRead: null,
      readOnlyEvidence: 'VERIFIED',
    });
  }

  const holdout = parseBoundJson(
    holdoutBytes,
    'BUSINESS_BI_HOLDOUT_JSON_DENIED',
  );
  if (!Array.isArray(holdout.rows)
    || holdout.rows.length !== response.evidence.rowsRead) {
    return buildExecutionReceipt(plan, {
      state: 'DENIED',
      reasonCode: 'BUSINESS_BI_ROW_COUNT_EVIDENCE_DENIED',
      rowsRead: null,
      readOnlyEvidence: 'VERIFIED',
    });
  }

  const result = computeNetRevenue(holdout, plan);
  if (canonicalJson(result) !== canonicalJson(oracle.expected)) {
    fail('BUSINESS_BI_ORACLE_MISMATCH');
  }
  return buildExecutionReceipt(plan, {
    state: 'COMPLETE',
    reasonCode: null,
    rowsRead: holdout.rows.length,
    readOnlyEvidence: 'VERIFIED',
    result,
  });
}

export function verifyNetRevenueExecutionReceipt(input) {
  if (!exactKeys(input, [
    'plan',
    'receipt',
    'metricContractBytes',
    'oracleBytes',
  ])) fail('BUSINESS_BI_RECEIPT_VERIFY_INPUT_DENIED');

  const plan = verifyNetRevenuePlan({
    plan: input.plan,
    metricContractBytes: input.metricContractBytes,
    oracleBytes: input.oracleBytes,
  });
  const receipt = input.receipt;
  if (!exactKeys(receipt, [
    'schemaVersion',
    'operationId',
    'bindings',
    'execution',
    'coverage',
    'result',
    'resultSha256',
    'output',
    'outputSha256',
    'oracleEquality',
    'nonclaims',
    'receiptSha256',
  ])
    || receipt.schemaVersion !== NET_REVENUE_EXECUTION_RECEIPT_SCHEMA
    || receipt.operationId !== NET_REVENUE_OPERATION_ID
    || !exactKeys(receipt.bindings, [
      'planSha256',
      'operationSha256',
      'metricContractSha256',
      'holdoutSha256',
      'oracleSha256',
    ])
    || canonicalJson(receipt.bindings) !== canonicalJson({
      planSha256: plan.planSha256,
      operationSha256: plan.bindings.operationSha256,
      metricContractSha256: plan.bindings.metricContractSha256,
      holdoutSha256: plan.bindings.holdoutSha256,
      oracleSha256: plan.bindings.oracleSha256,
    })
    || !exactKeys(receipt.execution, [
      'state',
      'reasonCode',
      'accessMode',
      'mutationAuthority',
      'readOnlyEvidence',
      'bounded',
      'timeoutAware',
      'cancelAware',
      'rowsRead',
      'rowBudget',
      'byteBudget',
      'timeoutMs',
    ])
    || !exactKeys(receipt.coverage, [
      'state',
      'resultAvailable',
      'nonSuccessCollapsed',
      'emptyOrZeroSuccessSynthesized',
    ])) fail('BUSINESS_BI_EXECUTION_RECEIPT_DENIED');

  const state = receipt.execution.state;
  if (!NET_REVENUE_EXECUTION_STATES.includes(state)
    || receipt.execution.accessMode !== 'READ_ONLY'
    || receipt.execution.mutationAuthority !== false
    || receipt.execution.bounded !== true
    || receipt.execution.timeoutAware !== true
    || receipt.execution.cancelAware !== true
    || receipt.execution.rowBudget !== plan.bounds.inputRowBudget
    || receipt.execution.byteBudget !== plan.bounds.inputByteBudget
    || receipt.execution.timeoutMs !== plan.bounds.timeoutMs
    || receipt.coverage.state !== state
    || receipt.coverage.resultAvailable !== (state === 'COMPLETE')
    || receipt.coverage.nonSuccessCollapsed !== false
    || receipt.coverage.emptyOrZeroSuccessSynthesized !== false) {
    fail('BUSINESS_BI_EXECUTION_RECEIPT_DENIED');
  }

  const oracle = assertOracle(parseBoundJson(
    bytesOf(input.oracleBytes, 'BUSINESS_BI_ORACLE_BYTES_DENIED'),
    'BUSINESS_BI_ORACLE_JSON_DENIED',
  ));
  if (state === 'COMPLETE'
    && canonicalJson(receipt.result) !== canonicalJson(oracle.expected)) {
    fail('BUSINESS_BI_RESULT_SUBSTITUTION_DENIED');
  }

  let rebuilt;
  try {
    rebuilt = buildExecutionReceipt(plan, {
      state,
      reasonCode: receipt.execution.reasonCode,
      rowsRead: receipt.execution.rowsRead,
      readOnlyEvidence: receipt.execution.readOnlyEvidence,
      result: receipt.result,
    });
  } catch {
    fail('BUSINESS_BI_EXECUTION_RECEIPT_DENIED');
  }
  if (canonicalJson(receipt) !== canonicalJson(rebuilt)) {
    fail('BUSINESS_BI_EXECUTION_RECEIPT_DENIED');
  }
  return receipt;
}
