import {types as utilTypes} from 'node:util';

import {canonicalJson, identitySha256, normalizeJsonValue, sha256} from '../db-analyzer/core.mjs';
import {
  EVIDENCE_BOUND_REPORT_SPEC_SCHEMA_V1,
  validateEvidenceBoundReportV1,
} from './evidence-bound-report-v1.mjs';
import {
  EVIDENCE_BOUND_COVERAGE_VIEW_SCHEMA_V1,
  verifyEvidenceBoundCoverageViewReplayV1,
  verifyEvidenceBoundCoverageViewV1,
} from './evidence-bound-coverage-view-v1.mjs';

export const EVIDENCE_BOUND_RENDERER_SCHEMA_V1 = 'kaleidosphere.reporting/evidence-bound-renderer/v1';
export const EVIDENCE_BOUND_RENDERER_KIND_V1 = 'TABLE';
export const EVIDENCE_BOUND_RENDERER_FORMAT_V1 = 'JSON';
export const EVIDENCE_BOUND_RENDERER_MAX_EXPORT_BYTES_V1 = 262144;
export const EVIDENCE_BOUND_RENDERER_KINDS_V1 = Object.freeze([EVIDENCE_BOUND_RENDERER_KIND_V1]);
export const EVIDENCE_BOUND_RENDERER_FORMATS_V1 = Object.freeze([EVIDENCE_BOUND_RENDERER_FORMAT_V1]);

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-z][a-z0-9._:-]{2,127}$/;
const INPUT_KEYS = Object.freeze(['projection', 'rendererKind', 'exportFormat']);
const COVERAGE_INPUT_KEYS = Object.freeze([...INPUT_KEYS, 'coverageInput']);
const OPTIONS_KEYS = Object.freeze(['rendererKind', 'exportFormat']);
const PROJECTION_ALLOWED_KEYS = new Set([
  'specSha256', 'sourceQueryId', 'credentials', 'sourceConnections', 'renderer', 'sql', 'mutation',
]);
const RENDER_KEYS = Object.freeze([
  'schemaVersion', 'rendererKind', 'inputKind', 'sourceSchemaVersion', 'reportId',
  'datasetSha256', 'specSha256', 'viewSha256', 'exportFormat', 'exportSha256',
  'exportBytes', 'export', 'renderSha256',
]);
const REPLAY_KEYS = Object.freeze(['receipt', 'snapshot']);
const COVERAGE_VIEW_KEYS = Object.freeze([
  'schemaVersion', 'viewKind', 'viewId', 'reportId', 'bindings', 'metrics', 'states', 'blindSpots',
  'claims', 'authority', 'dataset', 'datasetSha256', 'viewSha256',
]);
const STATE_ROW_KEYS = Object.freeze([
  'capabilityId', 'state', 'reasonCode', 'sourceQueryId', 'coverageEntrySha256',
  'capabilitySha256', 'resultSha256', 'coverageSha256', 'receiptSha256', 'snapshotSha256',
]);
const COVERAGE_STATES = new Set(['COMPLETE', 'PARTIAL', 'DENIED', 'UNSUPPORTED', 'UNKNOWN']);
const SOURCE_QUERY_ID = /^(?:mssql|oracle)\.[a-z0-9][a-z0-9._-]{2,127}$/;
const COVERAGE_METRIC_KEYS = Object.freeze([
  'completeCount', 'partialCount', 'deniedCount', 'unsupportedCount', 'unknownCount',
  'classifiedCount', 'totalCount', 'coverageBps',
]);
const FORBIDDEN_KEY = /(?:credential|password|secret|token|connection|dsn|raw[_-]?row|renderer|browser|url|uri|sql|query|callback|executable|expression|mutation|mutate|dispatch|spec)/i;
const FORBIDDEN_TEXT = /(?:https?:\/\/|file:\/\/|javascript:|data:text|<\/?script\b|\b(?:eval|function|setTimeout|setInterval|alert)\s*\(|=>|\b(?:select|insert|update|delete|merge|drop|alter|create)\b[\s;]|(?:^|\s)[=:][A-Za-z_$][\w$]*(?:\(|\b)|(?:password|credential|secret|token)\s*[:=])/i;
const MAX_SAFE_MAGNITUDE = Number.MAX_SAFE_INTEGER;

const fail = (code) => {
  const error = new Error(code);
  error.code = code;
  throw error;
};
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && !utilTypes.isProxy(value) && Object.getPrototypeOf(value) === Object.prototype;
const hash = (value) => typeof value === 'string' && HASH.test(value);
const same = (left, right) => canonicalJson(left) === canonicalJson(right);

function exact(value, keys, code) {
  if (!plain(value)) fail(code);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key !== 'string' || descriptor?.enumerable !== true || !Object.hasOwn(descriptor ?? {}, 'value');
  }) || !same([...ownKeys].sort(), [...keys].sort())) fail(code);
}

function inspectSurface(value, code = 'EVIDENCE_BOUND_RENDERER_SURFACE_DENIED', allowedKeys = new Set(), maxStringLength = 512) {
  const seen = new Set();
  const visit = (item) => {
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'string') {
      if ([...item].length > maxStringLength || /[\u0000-\u001f\u007f]/.test(item) || FORBIDDEN_TEXT.test(item)) fail(code);
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
        || key !== 'length' && descriptor.enumerable !== true) fail(`${code}:${String(key)}`);
      if (array && key === 'length') continue;
      visit(descriptor.value);
    }
    seen.delete(item);
  };
  visit(value);
}

function frozen(value) {
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

function options(value) {
  const selected = value === undefined ? {} : value;
  inspectSurface(selected, 'EVIDENCE_BOUND_RENDERER_OPTIONS_DENIED', new Set(OPTIONS_KEYS));
  if (!plain(selected) || Reflect.ownKeys(selected).some((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(selected, key);
    return typeof key !== 'string' || !OPTIONS_KEYS.includes(key) || descriptor?.enumerable !== true
      || !Object.hasOwn(descriptor ?? {}, 'value');
  })) fail('EVIDENCE_BOUND_RENDERER_OPTIONS_DENIED');
  if ((selected.rendererKind ?? EVIDENCE_BOUND_RENDERER_KIND_V1) !== EVIDENCE_BOUND_RENDERER_KIND_V1) {
    fail('EVIDENCE_BOUND_RENDERER_KIND_DENIED');
  }
  if ((selected.exportFormat ?? EVIDENCE_BOUND_RENDERER_FORMAT_V1) !== EVIDENCE_BOUND_RENDERER_FORMAT_V1) {
    fail('EVIDENCE_BOUND_RENDERER_FORMAT_DENIED');
  }
  return {rendererKind: EVIDENCE_BOUND_RENDERER_KIND_V1, exportFormat: EVIDENCE_BOUND_RENDERER_FORMAT_V1};
}

function verifiedProjection(value, coverageInput) {
  inspectSurface(value, 'EVIDENCE_BOUND_RENDERER_SURFACE_DENIED', PROJECTION_ALLOWED_KEYS);
  if (!plain(value)) fail('EVIDENCE_BOUND_RENDERER_PROJECTION_DENIED');
  if (value.schemaVersion === EVIDENCE_BOUND_REPORT_SPEC_SCHEMA_V1) {
    if (coverageInput !== undefined) fail('EVIDENCE_BOUND_RENDERER_COVERAGE_INPUT_DENIED');
    if (!Object.hasOwn(value, 'datasetSha256') || !Object.hasOwn(value, 'specSha256')) {
      fail('EVIDENCE_BOUND_RENDERER_PROJECTION_REQUIRED');
    }
    const projection = validateEvidenceBoundReportV1(value);
    return {
      projection,
      inputKind: 'REPORT',
      sourceSchemaVersion: projection.schemaVersion,
      datasetSha256: projection.datasetSha256,
      specSha256: projection.specSha256,
      viewSha256: null,
      title: projection.title,
    };
  }
  if (value.schemaVersion === EVIDENCE_BOUND_COVERAGE_VIEW_SCHEMA_V1) {
    if (coverageInput === undefined) fail('EVIDENCE_BOUND_RENDERER_COVERAGE_INPUT_REQUIRED');
    const projection = verifyEvidenceBoundCoverageViewV1(value, coverageInput);
    if (identitySha256(projection.dataset) !== projection.datasetSha256) {
      fail('EVIDENCE_BOUND_RENDERER_DATASET_DIGEST_DENIED');
    }
    const {viewSha256: _view, ...viewBody} = projection;
    if (identitySha256(viewBody) !== projection.viewSha256) {
      fail('EVIDENCE_BOUND_RENDERER_VIEW_DIGEST_DENIED');
    }
    return {
      projection,
      inputKind: 'COVERAGE_VIEW',
      sourceSchemaVersion: projection.schemaVersion,
      datasetSha256: projection.datasetSha256,
      specSha256: null,
      viewSha256: projection.viewSha256,
      title: 'Evidence-bound coverage view',
    };
  }
  fail('EVIDENCE_BOUND_RENDERER_PROJECTION_DENIED');
}

function validateCoverageProjection(value) {
  exact(value, COVERAGE_VIEW_KEYS, 'EVIDENCE_BOUND_RENDERER_COVERAGE_VIEW_DENIED');
  if (value.schemaVersion !== EVIDENCE_BOUND_COVERAGE_VIEW_SCHEMA_V1
    || value.viewKind !== 'COVERAGE_VIEW' || !ID.test(value.viewId) || !ID.test(value.reportId)
    || !hash(value.datasetSha256) || !hash(value.viewSha256)) {
    fail('EVIDENCE_BOUND_RENDERER_COVERAGE_VIEW_DENIED');
  }
  exact(value.bindings, ['snapshotSha256', 'receiptSha256', 'coverageSha256', 'capabilitySha256', 'resultSha256'], 'EVIDENCE_BOUND_RENDERER_COVERAGE_VIEW_DENIED');
  if (Object.values(value.bindings).some((item) => !hash(item))) fail('EVIDENCE_BOUND_RENDERER_COVERAGE_VIEW_DENIED');
  validateEvidenceBoundReportV1({
    schemaVersion: EVIDENCE_BOUND_REPORT_SPEC_SCHEMA_V1,
    reportId: value.reportId,
    title: 'Evidence-bound coverage view',
    dataset: value.dataset,
    bindings: value.bindings,
  });
  exact(value.metrics, COVERAGE_METRIC_KEYS, 'EVIDENCE_BOUND_RENDERER_COVERAGE_VIEW_DENIED');
  if (Object.values(value.metrics).some((item) => !Number.isSafeInteger(item) || item < 0)
    || value.metrics.coverageBps > 10000
    || value.metrics.classifiedCount + value.metrics.unknownCount !== value.metrics.totalCount) {
    fail('EVIDENCE_BOUND_RENDERER_COVERAGE_VIEW_DENIED');
  }
  for (const list of [value.states, value.blindSpots]) {
    if (!Array.isArray(list) || list.length > 1000) fail('EVIDENCE_BOUND_RENDERER_COVERAGE_VIEW_DENIED');
    for (const row of list) {
      exact(row, STATE_ROW_KEYS, 'EVIDENCE_BOUND_RENDERER_COVERAGE_VIEW_DENIED');
      if (!ID.test(row.capabilityId) || !COVERAGE_STATES.has(row.state)
        || !(row.reasonCode === null || /^[A-Z][A-Z0-9_]{2,127}$/.test(row.reasonCode))
        || !SOURCE_QUERY_ID.test(row.sourceQueryId)
        || !hash(row.coverageEntrySha256)
        || ['capabilitySha256', 'resultSha256', 'coverageSha256', 'receiptSha256', 'snapshotSha256']
          .some((key) => !hash(row[key]))) {
        fail('EVIDENCE_BOUND_RENDERER_COVERAGE_VIEW_DENIED');
      }
    }
  }
  exact(value.claims, ['completeness', 'absence', 'businessTruth', 'visualTruth'], 'EVIDENCE_BOUND_RENDERER_COVERAGE_VIEW_DENIED');
  exact(value.authority, ['credentials', 'sourceConnections', 'renderer', 'sql', 'mutation'], 'EVIDENCE_BOUND_RENDERER_DENIED');
  if (Object.values(value.claims).some((item) => item !== false) || Object.values(value.authority).some((item) => item !== false)
    || !same(value.blindSpots, value.states.filter(({state}) => state !== 'COMPLETE'))) {
    fail('EVIDENCE_BOUND_RENDERER_COVERAGE_VIEW_DENIED');
  }
  return value;
}

function parseBuildArguments(value, suppliedOptions) {
  if (suppliedOptions !== undefined || !plain(value) || !Object.hasOwn(value, 'projection')) {
    return {projection: value, coverageInput: undefined, selected: options(suppliedOptions)};
  }
  const keys = Object.hasOwn(value, 'coverageInput') ? COVERAGE_INPUT_KEYS : INPUT_KEYS;
  exact(value, keys, 'EVIDENCE_BOUND_RENDERER_INPUT_DENIED');
  return {
    projection: value.projection,
    coverageInput: value.coverageInput,
    selected: options({rendererKind: value.rendererKind, exportFormat: value.exportFormat}),
  };
}

function exportPayload(source, selected) {
  const {projection, inputKind, sourceSchemaVersion, datasetSha256, specSha256, viewSha256, title} = source;
  return normalizeJsonValue({
    schemaVersion: EVIDENCE_BOUND_RENDERER_SCHEMA_V1,
    rendererKind: selected.rendererKind,
    inputKind,
    sourceSchemaVersion,
    reportId: projection.reportId,
    title,
    dataset: projection.dataset,
    evidence: {
      datasetSha256, specSha256, viewSha256,
      bindings: projection.bindings,
    },
  });
}

function buildFromSource(source, selected) {
  const payload = exportPayload(source, selected);
  const exported = JSON.stringify(payload);
  const exportBytes = new TextEncoder().encode(exported).byteLength;
  if (exportBytes > EVIDENCE_BOUND_RENDERER_MAX_EXPORT_BYTES_V1) {
    fail('EVIDENCE_BOUND_RENDERER_EXPORT_LIMIT_DENIED');
  }
  const body = normalizeJsonValue({
    schemaVersion: EVIDENCE_BOUND_RENDERER_SCHEMA_V1,
    rendererKind: selected.rendererKind,
    inputKind: source.inputKind,
    sourceSchemaVersion: source.sourceSchemaVersion,
    reportId: source.projection.reportId,
    datasetSha256: source.datasetSha256,
    specSha256: source.specSha256,
    viewSha256: source.viewSha256,
    exportFormat: selected.exportFormat,
    exportSha256: sha256(exported),
    exportBytes,
    export: exported,
  });
  return frozen({...body, renderSha256: identitySha256(body)});
}

function validateRender(value) {
  inspectSurface(value, 'EVIDENCE_BOUND_RENDERER_SURFACE_DENIED', new Set(['rendererKind', 'renderSha256', 'exportFormat', 'specSha256']), EVIDENCE_BOUND_RENDERER_MAX_EXPORT_BYTES_V1);
  exact(value, RENDER_KEYS, 'EVIDENCE_BOUND_RENDERER_RESULT_DENIED');
  if (value.schemaVersion !== EVIDENCE_BOUND_RENDERER_SCHEMA_V1
    || value.rendererKind !== EVIDENCE_BOUND_RENDERER_KIND_V1
    || !['REPORT', 'COVERAGE_VIEW'].includes(value.inputKind)
    || !ID.test(value.reportId ?? '') || !hash(value.datasetSha256)
    || value.inputKind === 'REPORT' && (!hash(value.specSha256) || value.viewSha256 !== null)
    || value.inputKind === 'COVERAGE_VIEW' && (value.specSha256 !== null || !hash(value.viewSha256))
    || value.exportFormat !== EVIDENCE_BOUND_RENDERER_FORMAT_V1
    || !hash(value.exportSha256) || !Number.isSafeInteger(value.exportBytes)
    || value.exportBytes < 0 || value.exportBytes > EVIDENCE_BOUND_RENDERER_MAX_EXPORT_BYTES_V1
    || typeof value.export !== 'string' || new TextEncoder().encode(value.export).byteLength !== value.exportBytes
    || !hash(value.renderSha256)) {
    fail('EVIDENCE_BOUND_RENDERER_RESULT_DENIED');
  }
  if (sha256(value.export) !== value.exportSha256) fail('EVIDENCE_BOUND_RENDERER_EXPORT_DIGEST_DENIED');
  let payload;
  try {
    payload = JSON.parse(value.export);
  } catch {
    fail('EVIDENCE_BOUND_RENDERER_EXPORT_DENIED');
  }
  inspectSurface(payload, 'EVIDENCE_BOUND_RENDERER_EXPORT_DENIED', new Set([
    ...PROJECTION_ALLOWED_KEYS, 'rendererKind', 'specSha256', 'viewSha256',
  ]));
  exact(payload, [
    'schemaVersion', 'rendererKind', 'inputKind', 'sourceSchemaVersion', 'reportId', 'title', 'dataset', 'evidence',
  ], 'EVIDENCE_BOUND_RENDERER_EXPORT_DENIED');
  exact(payload.evidence, ['datasetSha256', 'specSha256', 'viewSha256', 'bindings'], 'EVIDENCE_BOUND_RENDERER_EXPORT_DENIED');
  if (payload.schemaVersion !== EVIDENCE_BOUND_RENDERER_SCHEMA_V1
    || payload.rendererKind !== value.rendererKind || payload.inputKind !== value.inputKind
    || payload.sourceSchemaVersion !== value.sourceSchemaVersion || payload.reportId !== value.reportId
    || payload.evidence.datasetSha256 !== value.datasetSha256
    || payload.evidence.specSha256 !== value.specSha256 || payload.evidence.viewSha256 !== value.viewSha256) {
    fail('EVIDENCE_BOUND_RENDERER_EXPORT_DENIED');
  }
  const {renderSha256: _render, ...body} = value;
  if (identitySha256(body) !== value.renderSha256) fail('EVIDENCE_BOUND_RENDERER_DIGEST_DENIED');
  return value;
}

export function buildEvidenceBoundRendererV1(value, suppliedOptions) {
  const {projection, coverageInput, selected} = parseBuildArguments(value, suppliedOptions);
  const source = verifiedProjection(projection, coverageInput);
  return buildFromSource(source, selected);
}

export function validateEvidenceBoundRendererV1(value) {
  return frozen(validateRender(value));
}

export function verifyEvidenceBoundRendererV1(rendered, projection, suppliedOptions) {
  const verified = validateRender(rendered);
  const expected = buildEvidenceBoundRendererV1(projection, suppliedOptions);
  if (!same(verified, expected)) fail('EVIDENCE_BOUND_RENDERER_MISMATCH');
  return frozen(verified);
}

export function verifyEvidenceBoundRendererReplayV1(rendered, projection, replayEvidence, suppliedOptions) {
  inspectSurface(replayEvidence, 'EVIDENCE_BOUND_RENDERER_REPLAY_DENIED');
  exact(replayEvidence, REPLAY_KEYS, 'EVIDENCE_BOUND_RENDERER_REPLAY_DENIED');
  if (!plain(replayEvidence.receipt) || !plain(replayEvidence.snapshot)) fail('EVIDENCE_BOUND_RENDERER_REPLAY_DENIED');
  inspectSurface(replayEvidence.receipt, 'EVIDENCE_BOUND_RENDERER_REPLAY_RECEIPT_DENIED');
  inspectSurface(replayEvidence.snapshot, 'EVIDENCE_BOUND_RENDERER_REPLAY_SNAPSHOT_DENIED');
  const verified = verifyEvidenceBoundRendererV1(rendered, projection, suppliedOptions);
  const parsed = parseBuildArguments(projection, suppliedOptions);
  const source = verifiedProjection(parsed.projection, parsed.coverageInput);
  if (source.inputKind === 'COVERAGE_VIEW') {
    verifyEvidenceBoundCoverageViewReplayV1(parsed.projection, parsed.coverageInput, replayEvidence);
    return verified;
  }
  if (identitySha256(replayEvidence.receipt) !== source.projection.bindings.receiptSha256) {
    fail('EVIDENCE_BOUND_RENDERER_REPLAY_RECEIPT_DIGEST_DENIED');
  }
  if (identitySha256(replayEvidence.snapshot) !== source.projection.bindings.snapshotSha256) {
    fail('EVIDENCE_BOUND_RENDERER_REPLAY_SNAPSHOT_DIGEST_DENIED');
  }
  return verified;
}

export const renderEvidenceBoundProjectionV1 = buildEvidenceBoundRendererV1;
export const buildEvidenceBoundRenderV1 = buildEvidenceBoundRendererV1;
export const verifyEvidenceBoundRenderV1 = verifyEvidenceBoundRendererV1;
export const verifyEvidenceBoundRenderReplayV1 = verifyEvidenceBoundRendererReplayV1;
