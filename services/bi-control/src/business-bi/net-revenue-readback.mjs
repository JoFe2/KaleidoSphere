import { createHash } from 'node:crypto';

import { canonicalJson } from '../canonical-json.js';
import {
  NET_REVENUE_EXECUTION_STATES,
  NET_REVENUE_NONCLAIMS,
  NET_REVENUE_OPERATION_ID,
  NET_REVENUE_OUTPUT_COLUMNS,
  verifyNetRevenueExecutionReceipt,
  verifyNetRevenuePlan,
} from './net-revenue-plan.mjs';

export const NET_REVENUE_READBACK_SCHEMA =
  'kaleidosphere.business-bi/net-revenue-readback/v1';
export const NET_REVENUE_READBACK_FORMATS = Object.freeze(['JSON', 'TABLE']);

const CREATE_KEYS = Object.freeze([
  'plan',
  'receipt',
  'metricContractBytes',
  'oracleBytes',
]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

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

function validatedSources(input) {
  if (!exactKeys(input, CREATE_KEYS)) fail('BUSINESS_BI_READBACK_INPUT_DENIED');
  const plan = verifyNetRevenuePlan({
    plan: input.plan,
    metricContractBytes: input.metricContractBytes,
    oracleBytes: input.oracleBytes,
  });
  const receipt = verifyNetRevenueExecutionReceipt({
    plan,
    receipt: input.receipt,
    metricContractBytes: input.metricContractBytes,
    oracleBytes: input.oracleBytes,
  });
  return { plan, receipt };
}

function buildReadback(input) {
  const { plan, receipt } = validatedSources(input);
  const state = receipt.execution.state;
  const body = {
    schemaVersion: NET_REVENUE_READBACK_SCHEMA,
    type: 'NET_REVENUE_AGGREGATE_READBACK',
    operationId: NET_REVENUE_OPERATION_ID,
    identity: {
      planSha256: plan.planSha256,
      operationSha256: plan.bindings.operationSha256,
      metricContractSha256: plan.bindings.metricContractSha256,
      holdoutSha256: plan.bindings.holdoutSha256,
      oracleSha256: plan.bindings.oracleSha256,
      executionReceiptSha256: receipt.receiptSha256,
      resultSha256: receipt.resultSha256,
      outputSha256: receipt.outputSha256,
    },
    coverage: {
      state,
      reasonCode: receipt.execution.reasonCode,
      resultAvailable: state === 'COMPLETE',
      completeIsDistinctFromNonSuccess: true,
      distinctNonSuccessStates: NET_REVENUE_EXECUTION_STATES.filter(
        (candidate) => candidate !== 'COMPLETE',
      ),
      emptyRowsAreNotComplete: state !== 'COMPLETE',
    },
    columns: [...NET_REVENUE_OUTPUT_COLUMNS],
    rows: receipt.output === null ? [] : cloneJson(receipt.output.rows),
    oracleEquality: receipt.oracleEquality,
    nonclaims: [...NET_REVENUE_NONCLAIMS],
    authority: {
      arbitrarySql: false,
      mutation: false,
      secondMetric: false,
      realSource: false,
      supersetOrChart: false,
    },
  };
  return deepFreeze({
    ...body,
    readbackSha256: sha256(canonicalJson(body)),
  });
}

export function createNetRevenueReadback(input) {
  return buildReadback(input);
}

export function verifyNetRevenueReadback(input) {
  if (!exactKeys(input, [...CREATE_KEYS, 'readback'])) {
    fail('BUSINESS_BI_READBACK_VERIFY_INPUT_DENIED');
  }
  const {
    readback,
    plan,
    receipt,
    metricContractBytes,
    oracleBytes,
  } = input;
  const expected = buildReadback({
    plan,
    receipt,
    metricContractBytes,
    oracleBytes,
  });
  if (canonicalJson(readback) !== canonicalJson(expected)) {
    fail('BUSINESS_BI_READBACK_SUBSTITUTION_DENIED');
  }
  return readback;
}

function jsonFor(readback) {
  return `${canonicalJson(readback)}\n`;
}

function tableFor(readback) {
  const identity = readback.identity;
  const metadata = [
    ['schema_version', readback.schemaVersion],
    ['operation_id', readback.operationId],
    ['readback_sha256', readback.readbackSha256],
    ['plan_sha256', identity.planSha256],
    ['operation_sha256', identity.operationSha256],
    ['metric_contract_sha256', identity.metricContractSha256],
    ['holdout_sha256', identity.holdoutSha256],
    ['oracle_sha256', identity.oracleSha256],
    ['execution_receipt_sha256', identity.executionReceiptSha256],
    ['result_sha256', identity.resultSha256 ?? 'NONE'],
    ['output_sha256', identity.outputSha256 ?? 'NONE'],
    ['coverage_state', readback.coverage.state],
    ['coverage_reason', readback.coverage.reasonCode ?? 'NONE'],
    ['result_available', String(readback.coverage.resultAvailable)],
    ['oracle_equality', readback.oracleEquality],
    ['row_count', String(readback.rows.length)],
  ];
  const lines = [
    '# KaleidoSphere closed net-revenue TABLE readback',
    ...metadata.map(([key, value]) => `# ${key}=${value}`),
    ...readback.nonclaims.map(
      (nonclaim, index) => `# nonclaim_${index + 1}=${canonicalJson(nonclaim)}`,
    ),
    `| ${readback.columns.join(' | ')} |`,
    `| ${readback.columns.map(() => '---').join(' | ')} |`,
  ];
  for (const row of readback.rows) {
    lines.push(`| ${readback.columns.map((column) => String(row[column])).join(' | ')} |`);
  }
  return `${lines.join('\n')}\n`;
}

export function renderNetRevenueJson(input) {
  return jsonFor(buildReadback(input));
}

export function renderNetRevenueTable(input) {
  return tableFor(buildReadback(input));
}

export function renderNetRevenueReadback(input) {
  if (!exactKeys(input, [...CREATE_KEYS, 'format'])) {
    fail('BUSINESS_BI_RENDER_INPUT_DENIED');
  }
  const {
    format,
    plan,
    receipt,
    metricContractBytes,
    oracleBytes,
  } = input;
  if (!NET_REVENUE_READBACK_FORMATS.includes(format)) {
    fail('BUSINESS_BI_RENDER_FORMAT_DENIED');
  }
  const readback = buildReadback({
    plan,
    receipt,
    metricContractBytes,
    oracleBytes,
  });
  return format === 'JSON' ? jsonFor(readback) : tableFor(readback);
}

export function verifyNetRevenueRenderings(input) {
  if (!exactKeys(input, [...CREATE_KEYS, 'json', 'table'])) {
    fail('BUSINESS_BI_RENDER_VERIFY_INPUT_DENIED');
  }
  const {
    json,
    table,
    plan,
    receipt,
    metricContractBytes,
    oracleBytes,
  } = input;
  if (typeof json !== 'string' || typeof table !== 'string') {
    fail('BUSINESS_BI_RENDERING_DISAGREEMENT');
  }
  const readback = buildReadback({
    plan,
    receipt,
    metricContractBytes,
    oracleBytes,
  });
  if (json !== jsonFor(readback) || table !== tableFor(readback)) {
    fail('BUSINESS_BI_RENDERING_DISAGREEMENT');
  }

  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    fail('BUSINESS_BI_RENDERING_DISAGREEMENT');
  }
  if (canonicalJson(parsed) !== canonicalJson(readback)
    || !table.includes(`# readback_sha256=${readback.readbackSha256}\n`)
    || !table.includes(
      `# metric_contract_sha256=${readback.identity.metricContractSha256}\n`,
    )
    || !table.includes(`# oracle_sha256=${readback.identity.oracleSha256}\n`)
    || !table.includes(
      `# result_sha256=${readback.identity.resultSha256 ?? 'NONE'}\n`,
    )) fail('BUSINESS_BI_RENDERING_DISAGREEMENT');

  return deepFreeze({
    readbackSha256: readback.readbackSha256,
    metricContractSha256: readback.identity.metricContractSha256,
    oracleSha256: readback.identity.oracleSha256,
    resultSha256: readback.identity.resultSha256,
    jsonSha256: sha256(json),
    tableSha256: sha256(table),
    identityEqual: true,
  });
}
