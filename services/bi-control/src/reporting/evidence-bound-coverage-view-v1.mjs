import {types as utilTypes} from 'node:util';

import {canonicalJson, identitySha256, normalizeJsonValue} from '../db-analyzer/core.mjs';
import {
  EVIDENCE_BOUND_REPORT_SPEC_SCHEMA_V1,
  validateEvidenceBoundReportV1,
} from './evidence-bound-report-v1.mjs';

export const EVIDENCE_BOUND_COVERAGE_VIEW_SCHEMA_V1 = 'kaleidosphere.reporting/evidence-bound-coverage-view/v1';
export const EVIDENCE_BOUND_COVERAGE_STATES = Object.freeze(['COMPLETE', 'PARTIAL', 'DENIED', 'UNSUPPORTED', 'UNKNOWN']);
export const EVIDENCE_BOUND_COVERAGE_VIEW_KIND = 'COVERAGE_VIEW';

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-z][a-z0-9._:-]{2,127}$/;
const QUERY_ID = /^(?:mssql|oracle)\.[a-z0-9][a-z0-9._-]{2,127}$/;
const REASON = /^[A-Z][A-Z0-9_]{2,127}$/;
const RESULT_STATES = new Set(['SUCCEEDED', 'PARTIAL', 'DENIED', 'UNSUPPORTED', 'UNKNOWN', 'ERROR', 'CANCELLED']);
const COVERAGE_SCHEMA = 'kaleidosphere.analysis/progressive-object-coverage/v1';
const BINDING_KEYS = Object.freeze(['snapshotSha256', 'receiptSha256', 'coverageSha256', 'capabilitySha256', 'resultSha256']);
const INPUT_KEYS = Object.freeze(['report', 'coverage', 'capability', 'result', 'receipt', 'snapshot']);
const VIEW_KEYS = Object.freeze([
  'schemaVersion', 'viewKind', 'viewId', 'reportId', 'bindings', 'metrics', 'states', 'blindSpots',
  'claims', 'authority', 'dataset', 'datasetSha256', 'viewSha256',
]);
const STATE_ROW_KEYS = Object.freeze([
  'capabilityId', 'state', 'reasonCode', 'sourceQueryId', 'coverageEntrySha256',
  'capabilitySha256', 'resultSha256', 'coverageSha256', 'receiptSha256', 'snapshotSha256',
]);
// The merged report contract rejects query-shaped field names. Keep the
// source-query citation in the view state, but use its report-safe alias in the
// table projection passed through that contract.
const DATASET_ROW_KEYS = Object.freeze([
  'capability_id', 'state', 'reason_code', 'source_evidence_id', 'coverage_entry_sha256',
  'capability_sha256', 'result_sha256', 'coverage_sha256', 'receipt_sha256', 'snapshot_sha256',
]);
const STATE_KEY_BY_DATASET_KEY = Object.freeze({
  capability_id: 'capabilityId', state: 'state', reason_code: 'reasonCode', source_evidence_id: 'sourceQueryId',
  coverage_entry_sha256: 'coverageEntrySha256', capability_sha256: 'capabilitySha256',
  result_sha256: 'resultSha256', coverage_sha256: 'coverageSha256', receipt_sha256: 'receiptSha256',
  snapshot_sha256: 'snapshotSha256',
});
const METRIC_KEYS = Object.freeze([
  'completeCount', 'partialCount', 'deniedCount', 'unsupportedCount', 'unknownCount',
  'classifiedCount', 'totalCount', 'coverageBps',
]);
const CLAIMS = Object.freeze({completeness: false, absence: false, businessTruth: false, visualTruth: false});
const AUTHORITY = Object.freeze({credentials: false, sourceConnections: false, renderer: false, sql: false, mutation: false});
const FORBIDDEN_KEY = /(?:credential|password|secret|token|connection|dsn|raw[_-]?row|renderer|browser|url|uri|sql|callback|executable|expression|mutation|mutate|dispatch)/i;
const FORBIDDEN_TEXT = /(?:https?:\/\/|file:\/\/|javascript:|data:text|<\/?script\b|\b(?:eval|function|setTimeout|setInterval|alert)\s*\(|=>|\b(?:select|insert|update|delete|merge|drop|alter|create)\b[\s;]|(?:^|\s)[=:][A-Za-z_$][\w$]*(?:\(|\b)|(?:password|credential|secret|token)\s*[:=])/i;
const MAX_SAFE_MAGNITUDE = Number.MAX_SAFE_INTEGER;

const fail = (code) => {
  const error = new Error(code);
  error.code = code;
  throw error;
};
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && !utilTypes.isProxy(value) && Object.getPrototypeOf(value) === Object.prototype;
const same = (left, right) => canonicalJson(left) === canonicalJson(right);
const hash = (value) => typeof value === 'string' && HASH.test(value);
const compare = (left, right) => Buffer.compare(Buffer.from(String(left), 'utf8'), Buffer.from(String(right), 'utf8'));

function exact(value, keys, code) {
  if (!plain(value)) fail(code);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key !== 'string' || descriptor?.enumerable !== true || !Object.hasOwn(descriptor ?? {}, 'value');
  }) || !same([...ownKeys].sort(), [...keys].sort())) fail(code);
}

function inspectSurface(value, code = 'EVIDENCE_BOUND_COVERAGE_SURFACE_DENIED', allowedKeys = new Set()) {
  const seen = new Set();
  const visit = (item) => {
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'string') {
      if (item.length > 512 || /[\u0000-\u001f\u007f]/.test(item) || FORBIDDEN_TEXT.test(item)) fail(code);
      return;
    }
    if (typeof item === 'number') {
      if (!Number.isFinite(item) || Object.is(item, -0) || Math.abs(item) > MAX_SAFE_MAGNITUDE) fail(code);
      return;
    }
    if (!item || typeof item !== 'object' || utilTypes.isProxy(item) || seen.has(item)) fail(code);
    const array = Array.isArray(item);
    if (array ? Object.getPrototypeOf(item) !== Array.prototype : Object.getPrototypeOf(item) !== Object.prototype) fail(code);
    seen.add(item);
    for (const key of Reflect.ownKeys(item)) {
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (typeof key !== 'string' || FORBIDDEN_KEY.test(key) && !allowedKeys.has(key) || !Object.hasOwn(descriptor ?? {}, 'value')
        || key !== 'length' && descriptor.enumerable !== true) fail(code);
      if (array && key === 'length') continue;
      visit(descriptor.value);
    }
    seen.delete(item);
  };
  visit(value);
}

function assertSealed(value, digestKey, code) {
  if (!plain(value) || !hash(value[digestKey])) fail(code);
  const {[digestKey]: digest, ...body} = value;
  if (identitySha256(body) !== digest) fail(code);
  return body;
}

function validateBindings(bindings) {
  exact(bindings, BINDING_KEYS, 'EVIDENCE_BOUND_COVERAGE_BINDING_DENIED');
  if (BINDING_KEYS.some((key) => !hash(bindings[key]))) fail('EVIDENCE_BOUND_COVERAGE_BINDING_DENIED');
  return bindings;
}

function validateCoverage(value) {
  const body = assertSealed(value, 'coverageSha256', 'EVIDENCE_BOUND_COVERAGE_EVIDENCE_DENIED');
  exact(value, [
    'schemaVersion', 'engine', 'structureSnapshotSha256', 'structureCoverageLedgerSha256', 'thresholdBps',
    'summary', 'entries', 'queryCoverage', 'missingPrivilegeMeansAbsent', 'evidenceStoreSchema', 'coverageSha256',
  ], 'EVIDENCE_BOUND_COVERAGE_EVIDENCE_DENIED');
  if (body.schemaVersion !== COVERAGE_SCHEMA || !['mssql', 'oracle'].includes(body.engine)
    || !hash(body.structureSnapshotSha256) || !hash(body.structureCoverageLedgerSha256)
    || body.thresholdBps !== 9500 || body.missingPrivilegeMeansAbsent !== false
    || body.evidenceStoreSchema !== 'kaleidosphere.analysis/evidence-store/v1'
    || !Array.isArray(body.entries) || !Array.isArray(body.queryCoverage) || body.entries.length === 0 || body.entries.length > 1000) {
    fail('EVIDENCE_BOUND_COVERAGE_EVIDENCE_DENIED');
  }
  const queryIds = new Set();
  for (const query of body.queryCoverage) {
    exact(query, ['queryId', 'category', 'state', 'reasonCode', 'visibility', 'absenceClaim'], 'EVIDENCE_BOUND_COVERAGE_EVIDENCE_DENIED');
    if (!QUERY_ID.test(query.queryId) || typeof query.category !== 'string' || query.category.length < 1 || query.category.length > 128
      || !['SUCCEEDED', 'PARTIAL', 'DENIED', 'UNSUPPORTED', 'UNKNOWN', 'TIMEOUT', 'ERROR'].includes(query.state)
      || !(query.reasonCode === null || REASON.test(query.reasonCode)) || typeof query.visibility !== 'string'
      || query.visibility.length < 1 || query.visibility.length > 128 || query.absenceClaim !== 'NOT_CLAIMED'
      || queryIds.has(query.queryId)) fail('EVIDENCE_BOUND_COVERAGE_EVIDENCE_DENIED');
    queryIds.add(query.queryId);
  }
  const objectKeys = new Set();
  const counts = Object.fromEntries(EVIDENCE_BOUND_COVERAGE_STATES.map((state) => [state, 0]));
  for (const entry of body.entries) {
    exact(entry, ['objectKey', 'objectRef', 'state', 'reasonCode', 'sourceQueryId', 'evidenceRefs', 'absenceClaim'], 'EVIDENCE_BOUND_COVERAGE_EVIDENCE_DENIED');
    if (!EVIDENCE_BOUND_COVERAGE_STATES.includes(entry.state)) fail('EVIDENCE_BOUND_COVERAGE_STATE_DENIED');
    if (!hash(entry.objectKey) || !plain(entry.objectRef) || identitySha256(entry.objectRef) !== entry.objectKey
      || !(entry.reasonCode === null || REASON.test(entry.reasonCode))
      || !QUERY_ID.test(entry.sourceQueryId) || !queryIds.has(entry.sourceQueryId) || entry.absenceClaim !== 'NOT_CLAIMED'
      || !Array.isArray(entry.evidenceRefs) || entry.evidenceRefs.length === 0
      || entry.evidenceRefs.some((ref) => !hash(ref)) || new Set(entry.evidenceRefs).size !== entry.evidenceRefs.length
      || objectKeys.has(entry.objectKey)) fail('EVIDENCE_BOUND_COVERAGE_EVIDENCE_DENIED');
    objectKeys.add(entry.objectKey);
    counts[entry.state] += 1;
  }
  exact(body.summary, ['visibleObjectCount', 'classifiedObjectCount', 'coverageBps', 'stateCounts'], 'EVIDENCE_BOUND_COVERAGE_EVIDENCE_DENIED');
  exact(body.summary.stateCounts, EVIDENCE_BOUND_COVERAGE_STATES, 'EVIDENCE_BOUND_COVERAGE_EVIDENCE_DENIED');
  if (!same(body.summary.stateCounts, counts)
    || body.summary.visibleObjectCount !== body.entries.length
    || body.summary.classifiedObjectCount !== body.entries.length - counts.UNKNOWN
    || body.summary.coverageBps !== (body.entries.length === 0 ? 0 : Math.floor((body.entries.length - counts.UNKNOWN) * 10000 / body.entries.length))) {
    fail('EVIDENCE_BOUND_COVERAGE_EVIDENCE_DENIED');
  }
  return value;
}

function validateCapability(value) {
  const body = assertSealed(value, 'capabilitySha256', 'EVIDENCE_BOUND_COVERAGE_EVIDENCE_DENIED');
  exact(value, ['schemaVersion', 'scopeSha256', 'capabilities', 'capabilitySha256'], 'EVIDENCE_BOUND_COVERAGE_EVIDENCE_DENIED');
  if (body.schemaVersion !== 'kaleidosphere.reporting/capability-binding/v1' || !hash(body.scopeSha256)
    || !Array.isArray(body.capabilities) || body.capabilities.length > 1000) fail('EVIDENCE_BOUND_COVERAGE_EVIDENCE_DENIED');
  const ids = new Set();
  const queries = new Set();
  for (const capability of body.capabilities) {
    exact(capability, ['capabilityId', 'sourceQueryId', 'state'], 'EVIDENCE_BOUND_COVERAGE_CAPABILITY_DENIED');
    if (!ID.test(capability.capabilityId) || !QUERY_ID.test(capability.sourceQueryId)
      || !EVIDENCE_BOUND_COVERAGE_STATES.includes(capability.state)
      || ids.has(capability.capabilityId) || queries.has(capability.sourceQueryId)) fail('EVIDENCE_BOUND_COVERAGE_CAPABILITY_DENIED');
    ids.add(capability.capabilityId);
    queries.add(capability.sourceQueryId);
  }
  return value;
}

function validateResult(value) {
  const body = assertSealed(value, 'resultSha256', 'EVIDENCE_BOUND_COVERAGE_EVIDENCE_DENIED');
  exact(value, ['schemaVersion', 'scopeSha256', 'coverageSha256', 'capabilitySha256', 'results', 'resultSha256'], 'EVIDENCE_BOUND_COVERAGE_EVIDENCE_DENIED');
  if (body.schemaVersion !== 'kaleidosphere.reporting/result-binding/v1' || !hash(body.scopeSha256)
    || !hash(body.coverageSha256) || !hash(body.capabilitySha256) || !Array.isArray(body.results) || body.results.length > 1000) {
    fail('EVIDENCE_BOUND_COVERAGE_EVIDENCE_DENIED');
  }
  const ids = new Set();
  for (const result of body.results) {
    exact(result, ['capabilityId', 'sourceQueryId', 'state', 'resultState'], 'EVIDENCE_BOUND_COVERAGE_EVIDENCE_DENIED');
    if (!ID.test(result.capabilityId) || !QUERY_ID.test(result.sourceQueryId)
      || !EVIDENCE_BOUND_COVERAGE_STATES.includes(result.state) || !RESULT_STATES.has(result.resultState)
      || ids.has(result.capabilityId)) fail('EVIDENCE_BOUND_COVERAGE_EVIDENCE_DENIED');
    ids.add(result.capabilityId);
  }
  return value;
}

function validateReceipt(value) {
  const body = assertSealed(value, 'receiptSha256', 'EVIDENCE_BOUND_COVERAGE_EVIDENCE_DENIED');
  exact(value, [
    'schemaVersion', 'scopeSha256', 'coverageSha256', 'capabilitySha256', 'resultSha256', 'snapshotSha256',
    'receiptId', 'state', 'receiptSha256',
  ], 'EVIDENCE_BOUND_COVERAGE_EVIDENCE_DENIED');
  if (body.schemaVersion !== 'kaleidosphere.reporting/receipt-binding/v1' || !hash(body.scopeSha256)
    || !hash(body.coverageSha256) || !hash(body.capabilitySha256) || !hash(body.resultSha256) || !hash(body.snapshotSha256)
    || !ID.test(body.receiptId) || body.state !== 'SEALED') fail('EVIDENCE_BOUND_COVERAGE_EVIDENCE_DENIED');
  return value;
}

function validateSnapshot(value) {
  const body = assertSealed(value, 'snapshotSha256', 'EVIDENCE_BOUND_COVERAGE_EVIDENCE_DENIED');
  exact(value, ['schemaVersion', 'scopeSha256', 'snapshotId', 'state', 'snapshotSha256'], 'EVIDENCE_BOUND_COVERAGE_EVIDENCE_DENIED');
  if (body.schemaVersion !== 'kaleidosphere.reporting/snapshot-binding/v1' || !hash(body.scopeSha256)
    || !ID.test(body.snapshotId) || body.state !== 'SEALED') fail('EVIDENCE_BOUND_COVERAGE_EVIDENCE_DENIED');
  return value;
}

function validateInput(input) {
  inspectSurface(input);
  exact(input, INPUT_KEYS, 'EVIDENCE_BOUND_COVERAGE_INPUT_DENIED');
  const report = validateEvidenceBoundReportV1(input.report);
  const coverage = validateCoverage(input.coverage);
  const capability = validateCapability(input.capability);
  const result = validateResult(input.result);
  const receipt = validateReceipt(input.receipt);
  const snapshot = validateSnapshot(input.snapshot);
  const bindings = validateBindings(report.bindings);
  if (bindings.coverageSha256 !== coverage.coverageSha256 || bindings.capabilitySha256 !== capability.capabilitySha256
    || bindings.resultSha256 !== result.resultSha256 || bindings.receiptSha256 !== receipt.receiptSha256
    || bindings.snapshotSha256 !== snapshot.snapshotSha256
    || result.coverageSha256 !== coverage.coverageSha256 || result.capabilitySha256 !== capability.capabilitySha256
    || receipt.coverageSha256 !== coverage.coverageSha256 || receipt.capabilitySha256 !== capability.capabilitySha256
    || receipt.resultSha256 !== result.resultSha256 || receipt.snapshotSha256 !== snapshot.snapshotSha256) {
    fail('EVIDENCE_BOUND_COVERAGE_BINDING_DENIED');
  }
  const scope = capability.scopeSha256;
  if (result.scopeSha256 !== scope || receipt.scopeSha256 !== scope || snapshot.scopeSha256 !== scope) {
    fail('EVIDENCE_BOUND_COVERAGE_SCOPE_DENIED');
  }
  const capabilities = new Map(capability.capabilities.map((item) => [item.sourceQueryId, item]));
  const results = new Map(result.results.map((item) => [item.capabilityId, item]));
  for (const resultBinding of result.results) {
    const boundCapability = capability.capabilities.find(({capabilityId}) => capabilityId === resultBinding.capabilityId);
    if (!boundCapability || boundCapability.sourceQueryId !== resultBinding.sourceQueryId) {
      fail('EVIDENCE_BOUND_COVERAGE_BINDING_DENIED');
    }
  }
  return {report, coverage, capability, result, receipt, snapshot, bindings, capabilities, results};
}

function stateRows(source) {
  const {coverage, capability, result, receipt, snapshot, bindings, capabilities, results} = source;
  const rows = coverage.entries.map((entry) => {
    const boundCapability = capabilities.get(entry.sourceQueryId);
    const boundResult = boundCapability ? results.get(boundCapability.capabilityId) : null;
    let state = entry.state;
    let reasonCode = entry.reasonCode;
    let capabilityId = boundCapability?.capabilityId ?? `unbound.${entry.sourceQueryId}`;
    if (!boundCapability || !boundResult) {
      state = 'UNKNOWN';
      reasonCode = 'EVIDENCE_BINDING_MISSING';
    } else if (boundCapability.state !== entry.state || boundResult.state !== entry.state) {
      fail('EVIDENCE_BOUND_COVERAGE_CONTRADICTION_DENIED');
    } else if (entry.state === 'COMPLETE' && boundResult.resultState !== 'SUCCEEDED') {
      fail('EVIDENCE_BOUND_COVERAGE_CONTRADICTION_DENIED');
    } else if (entry.state !== 'COMPLETE' && boundResult.resultState !== entry.state) {
      fail('EVIDENCE_BOUND_COVERAGE_CONTRADICTION_DENIED');
    }
    return normalizeJsonValue({
      capabilityId, state, reasonCode, sourceQueryId: entry.sourceQueryId,
      coverageEntrySha256: identitySha256(entry), capabilitySha256: bindings.capabilitySha256,
      resultSha256: bindings.resultSha256, coverageSha256: bindings.coverageSha256,
      receiptSha256: receipt.receiptSha256, snapshotSha256: snapshot.snapshotSha256,
    });
  }).sort((left, right) => compare(left.capabilityId, right.capabilityId)
    || compare(left.sourceQueryId, right.sourceQueryId) || compare(left.coverageEntrySha256, right.coverageEntrySha256));
  return rows;
}

function buildBody(source) {
  const states = stateRows(source);
  const count = (state) => states.filter((row) => row.state === state).length;
  const totalCount = states.length;
  const metrics = {
    completeCount: count('COMPLETE'), partialCount: count('PARTIAL'), deniedCount: count('DENIED'),
    unsupportedCount: count('UNSUPPORTED'), unknownCount: count('UNKNOWN'),
    classifiedCount: totalCount - count('UNKNOWN'), totalCount,
    coverageBps: totalCount === 0 ? 0 : Math.floor((totalCount - count('UNKNOWN')) * 10000 / totalCount),
  };
  const dataset = normalizeJsonValue({
    schemaVersion: 'kaleidosphere.reporting/evidence-bound-dataset/v1', datasetId: 'coverage-view', kind: 'TABLE',
    columns: [
      {key: 'capability_id'}, {key: 'state'}, {key: 'reason_code'}, {key: 'source_evidence_id'},
      {key: 'coverage_entry_sha256'}, {key: 'capability_sha256'}, {key: 'result_sha256'},
      {key: 'coverage_sha256'}, {key: 'receipt_sha256'}, {key: 'snapshot_sha256'},
    ],
    columnDefinitions: [
      {label: 'Capability', dataType: 'string', nullable: false},
      {label: 'Coverage state', dataType: 'string', nullable: false},
      {label: 'Blind spot reason', dataType: 'string', nullable: true},
      {label: 'Source evidence', dataType: 'string', nullable: false},
      {label: 'Coverage entry digest', dataType: 'string', nullable: false},
      {label: 'Capability digest', dataType: 'string', nullable: false},
      {label: 'Result digest', dataType: 'string', nullable: false},
      {label: 'Coverage digest', dataType: 'string', nullable: false},
      {label: 'Receipt digest', dataType: 'string', nullable: false},
      {label: 'Snapshot digest', dataType: 'string', nullable: false},
    ],
    rows: states.map((row) => DATASET_ROW_KEYS.map((key) => row[STATE_KEY_BY_DATASET_KEY[key]])), differentiator: null,
  });
  return normalizeJsonValue({
    schemaVersion: EVIDENCE_BOUND_COVERAGE_VIEW_SCHEMA_V1, viewKind: EVIDENCE_BOUND_COVERAGE_VIEW_KIND,
    viewId: `${source.report.reportId}-coverage`, reportId: source.report.reportId, bindings: source.bindings,
    metrics, states, blindSpots: states.filter(({state}) => state !== 'COMPLETE'), claims: {...CLAIMS}, authority: {...AUTHORITY}, dataset,
  });
}

function freeze(value) {
  const clone = structuredClone(normalizeJsonValue(value));
  const visit = (item) => {
    if (item && typeof item === 'object' && !Object.isFrozen(item)) {
      Object.values(item).forEach(visit);
      Object.freeze(item);
    }
    return item;
  };
  return visit(clone);
}

function validateView(value) {
  inspectSurface(value, 'EVIDENCE_BOUND_COVERAGE_SURFACE_DENIED', new Set(['credentials', 'sourceConnections', 'renderer', 'sql', 'mutation']));
  exact(value, VIEW_KEYS, 'EVIDENCE_BOUND_COVERAGE_VIEW_DENIED');
  if (value.schemaVersion !== EVIDENCE_BOUND_COVERAGE_VIEW_SCHEMA_V1 || value.viewKind !== EVIDENCE_BOUND_COVERAGE_VIEW_KIND
    || !ID.test(value.viewId) || !ID.test(value.reportId) || !hash(value.datasetSha256) || !hash(value.viewSha256)) {
    fail('EVIDENCE_BOUND_COVERAGE_VIEW_DENIED');
  }
  validateBindings(value.bindings);
  validateEvidenceBoundReportV1({
    schemaVersion: EVIDENCE_BOUND_REPORT_SPEC_SCHEMA_V1,
    reportId: value.reportId,
    title: 'Evidence-bound coverage view',
    dataset: value.dataset,
    bindings: value.bindings,
  });
  exact(value.metrics, METRIC_KEYS, 'EVIDENCE_BOUND_COVERAGE_VIEW_DENIED');
  if (Object.values(value.metrics).some((item) => !Number.isSafeInteger(item) || item < 0)
    || value.metrics.coverageBps > 10000 || value.metrics.classifiedCount + value.metrics.unknownCount !== value.metrics.totalCount) {
    fail('EVIDENCE_BOUND_COVERAGE_VIEW_DENIED');
  }
  for (const list of [value.states, value.blindSpots]) {
    if (!Array.isArray(list) || list.length > 1000) fail('EVIDENCE_BOUND_COVERAGE_VIEW_DENIED');
    for (const row of list) {
      exact(row, STATE_ROW_KEYS, 'EVIDENCE_BOUND_COVERAGE_VIEW_DENIED');
      if (!ID.test(row.capabilityId) || !EVIDENCE_BOUND_COVERAGE_STATES.includes(row.state)
        || !(row.reasonCode === null || REASON.test(row.reasonCode)) || !QUERY_ID.test(row.sourceQueryId)
        || !BINDING_KEYS.every((key) => hash(row[key])) || !hash(row.coverageEntrySha256)) {
        fail('EVIDENCE_BOUND_COVERAGE_VIEW_DENIED');
      }
    }
  }
  if (!same(value.blindSpots, value.states.filter(({state}) => state !== 'COMPLETE'))
    || !same(value.claims, CLAIMS) || !same(value.authority, AUTHORITY)) fail('EVIDENCE_BOUND_COVERAGE_VIEW_DENIED');
  return value;
}

export function buildEvidenceBoundCoverageViewV1(input) {
  const source = validateInput(input);
  const body = buildBody(source);
  const projection = {...body, datasetSha256: identitySha256(body.dataset)};
  return freeze({...projection, viewSha256: identitySha256(projection)});
}

function buildFromValidated(source) {
  const body = buildBody(source);
  const projection = {...body, datasetSha256: identitySha256(body.dataset)};
  return freeze({...projection, viewSha256: identitySha256(projection)});
}

export function verifyEvidenceBoundCoverageViewV1(view, input) {
  const source = validateInput(input);
  validateView(view);
  if (identitySha256(view.dataset) !== view.datasetSha256) fail('EVIDENCE_BOUND_COVERAGE_DATASET_DIGEST_DENIED');
  const expected = buildFromValidated(source);
  if (!same(view, expected)) fail('EVIDENCE_BOUND_COVERAGE_VIEW_MISMATCH');
  return freeze(view);
}

export function verifyEvidenceBoundCoverageViewReplayV1(view, input, replayEvidence) {
  exact(replayEvidence, ['receipt', 'snapshot'], 'EVIDENCE_BOUND_COVERAGE_REPLAY_DENIED');
  inspectSurface(replayEvidence.receipt, 'EVIDENCE_BOUND_COVERAGE_REPLAY_DENIED');
  inspectSurface(replayEvidence.snapshot, 'EVIDENCE_BOUND_COVERAGE_REPLAY_DENIED');
  const verified = verifyEvidenceBoundCoverageViewV1(view, input);
  if (!hash(replayEvidence.receipt?.receiptSha256) || replayEvidence.receipt.receiptSha256 !== verified.bindings.receiptSha256) {
    fail('EVIDENCE_BOUND_COVERAGE_REPLAY_RECEIPT_DIGEST_DENIED');
  }
  if (!hash(replayEvidence.snapshot?.snapshotSha256) || replayEvidence.snapshot.snapshotSha256 !== verified.bindings.snapshotSha256) {
    fail('EVIDENCE_BOUND_COVERAGE_REPLAY_SNAPSHOT_DIGEST_DENIED');
  }
  validateReceipt(replayEvidence.receipt);
  validateSnapshot(replayEvidence.snapshot);
  return verified;
}

export const buildEvidenceBoundCoverageProjectionV1 = buildEvidenceBoundCoverageViewV1;
export const verifyEvidenceBoundCoverageProjectionV1 = verifyEvidenceBoundCoverageViewV1;
export const verifyEvidenceBoundCoverageReplayV1 = verifyEvidenceBoundCoverageViewReplayV1;
