import {types as utilTypes} from 'node:util';

import {canonicalJson, identitySha256, normalizeJsonValue} from '../db-analyzer/core.mjs';

export const EVIDENCE_BOUND_REPORT_DATASET_SCHEMA_V1 = 'kaleidosphere.reporting/evidence-bound-dataset/v1';
export const EVIDENCE_BOUND_REPORT_SPEC_SCHEMA_V1 = 'kaleidosphere.reporting/evidence-bound-report-spec/v1';
export const EVIDENCE_BOUND_REPORT_PROJECTION_SCHEMA_V1 = EVIDENCE_BOUND_REPORT_SPEC_SCHEMA_V1;

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-z][a-z0-9._:-]{2,127}$/;
const DATA_TYPES = new Set(['string', 'integer', 'number', 'boolean']);
const DATASET_KINDS = new Set(['METRIC', 'TABLE', 'DIFFERENTIATOR_PLACEHOLDER']);
const BINDING_KEYS = Object.freeze([
  'snapshotSha256', 'receiptSha256', 'coverageSha256', 'capabilitySha256', 'resultSha256',
]);
const SPEC_KEYS = Object.freeze(['schemaVersion', 'reportId', 'title', 'dataset', 'bindings']);
const PROJECTION_KEYS = Object.freeze([...SPEC_KEYS, 'datasetSha256', 'specSha256']);
const DATASET_KEYS = Object.freeze(['schemaVersion', 'datasetId', 'kind', 'columns', 'rows', 'differentiator']);
const COLUMN_KEYS = Object.freeze(['key', 'label', 'dataType', 'nullable']);
const DIFFERENTIATOR_KEYS = Object.freeze(['type', 'status', 'label']);
const FORBIDDEN_KEY = /(?:script|executable|expression|credential|password|secret|token|connection|dsn|raw[_-]?row|source[_-]?connection|renderer|browser|url|uri|sql|query|callback)/i;
const FORBIDDEN_TEXT = /(?:https?:\/\/|file:\/\/|javascript:|data:text|<\/?script\b|\b(?:eval|function|setTimeout|setInterval|alert)\s*\(|=>|\b(?:select|insert|update|delete|merge|drop|alter|create)\b[\s;]|(?:^|\s)[=:][A-Za-z_$][\w$]*(?:\(|\b)|(?:password|credential|secret|token)\s*[:=])/i;

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

function inspectSurface(value, code = 'EVIDENCE_BOUND_REPORT_SURFACE_DENIED') {
  const seen = new Set();
  const visit = (item) => {
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'string') {
      if (item.length > 512 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(item) || FORBIDDEN_TEXT.test(item)) fail(code);
      return;
    }
    if (typeof item === 'number') {
      if (!Number.isFinite(item) || Object.is(item, -0) || !Number.isSafeInteger(item) && !Number.isSafeInteger(Math.trunc(item))) fail(code);
      return;
    }
    if (!item || typeof item !== 'object' || utilTypes.isProxy(item) || seen.has(item)) fail(code);
    const array = Array.isArray(item);
    if (array ? Object.getPrototypeOf(item) !== Array.prototype : Object.getPrototypeOf(item) !== Object.prototype) fail(code);
    seen.add(item);
    for (const key of Reflect.ownKeys(item)) {
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (typeof key !== 'string' || FORBIDDEN_KEY.test(key) || !Object.hasOwn(descriptor ?? {}, 'value')
        || key !== 'length' && descriptor.enumerable !== true) fail(code);
      if (array && key === 'length') continue;
      visit(descriptor.value);
    }
    seen.delete(item);
  };
  visit(value);
}

function validateBindings(value, expected) {
  exact(value, BINDING_KEYS, 'EVIDENCE_BOUND_REPORT_BINDING_DENIED');
  if (BINDING_KEYS.some((key) => !hash(value[key]))) fail('EVIDENCE_BOUND_REPORT_BINDING_DENIED');
  if (expected !== undefined) {
    exact(expected, BINDING_KEYS, 'EVIDENCE_BOUND_REPORT_BINDING_DENIED');
    if (!same(value, expected)) fail('EVIDENCE_BOUND_REPORT_BINDING_DENIED');
  }
}

function validateCell(value, column) {
  if (value === null) {
    if (!column.nullable) fail('EVIDENCE_BOUND_REPORT_CELL_DENIED');
    return;
  }
  const valid = column.dataType === 'string' ? typeof value === 'string'
    : column.dataType === 'boolean' ? typeof value === 'boolean'
      : typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)
        && Math.abs(value) <= Number.MAX_SAFE_INTEGER
        && (column.dataType === 'number' || Number.isSafeInteger(value));
  if (!valid) fail('EVIDENCE_BOUND_REPORT_CELL_DENIED');
}

function validateDataset(value) {
  exact(value, DATASET_KEYS, 'EVIDENCE_BOUND_REPORT_DATASET_DENIED');
  if (value.schemaVersion !== EVIDENCE_BOUND_REPORT_DATASET_SCHEMA_V1 || !ID.test(value.datasetId ?? '')
    || !DATASET_KINDS.has(value.kind) || !Array.isArray(value.columns) || !Array.isArray(value.rows)
    || value.columns.length > 32 || value.rows.length > 1000) fail('EVIDENCE_BOUND_REPORT_DATASET_DENIED');
  const keys = new Set();
  for (const column of value.columns) {
    exact(column, COLUMN_KEYS, 'EVIDENCE_BOUND_REPORT_DATASET_DENIED');
    if (!ID.test(column.key ?? '') || typeof column.label !== 'string' || column.label.length < 1 || column.label.length > 128
      || !DATA_TYPES.has(column.dataType) || typeof column.nullable !== 'boolean' || keys.has(column.key)) fail('EVIDENCE_BOUND_REPORT_DATASET_DENIED');
    keys.add(column.key);
  }
  if (value.kind === 'DIFFERENTIATOR_PLACEHOLDER') {
    if (value.columns.length !== 0 || value.rows.length !== 0 || value.differentiator === null) fail('EVIDENCE_BOUND_REPORT_DATASET_DENIED');
    exact(value.differentiator, DIFFERENTIATOR_KEYS, 'EVIDENCE_BOUND_REPORT_DATASET_DENIED');
    if (value.differentiator.type !== 'DIFFERENTIATOR_PLACEHOLDER' || value.differentiator.status !== 'UNPOPULATED'
      || typeof value.differentiator.label !== 'string' || value.differentiator.label.length < 1 || value.differentiator.label.length > 128) {
      fail('EVIDENCE_BOUND_REPORT_DATASET_DENIED');
    }
    return;
  }
  if (value.columns.length === 0 || value.differentiator !== null
    || value.kind === 'METRIC' && (value.columns.length !== 1 || value.rows.length !== 1)
    || value.kind === 'TABLE' && value.rows.length === 0) fail('EVIDENCE_BOUND_REPORT_DATASET_DENIED');
  for (const row of value.rows) {
    if (!Array.isArray(row) || row.length !== value.columns.length || row.length > 32) fail('EVIDENCE_BOUND_REPORT_DATASET_DENIED');
    for (let index = 0; index < row.length; index += 1) validateCell(row[index], value.columns[index]);
  }
}

function validateSpec(value, expectedBindings) {
  exact(value, SPEC_KEYS, 'EVIDENCE_BOUND_REPORT_SURFACE_DENIED');
  if (value.schemaVersion !== EVIDENCE_BOUND_REPORT_SPEC_SCHEMA_V1 || !ID.test(value.reportId ?? '')
    || typeof value.title !== 'string' || value.title.length < 1 || value.title.length > 256) fail('EVIDENCE_BOUND_REPORT_SPEC_DENIED');
  validateDataset(value.dataset);
  validateBindings(value.bindings, expectedBindings);
}

function validateProjection(value, expectedBindings) {
  inspectSurface(value);
  const hasDataset = Object.hasOwn(value, 'datasetSha256');
  const hasSpec = Object.hasOwn(value, 'specSha256');
  if (hasDataset !== hasSpec) fail('EVIDENCE_BOUND_REPORT_SPEC_DIGEST_DENIED');
  if (!hasDataset) {
    validateSpec(value, expectedBindings);
    return {body: value, projection: false};
  }
  exact(value, PROJECTION_KEYS, 'EVIDENCE_BOUND_REPORT_SURFACE_DENIED');
  if (!hash(value.datasetSha256) || !hash(value.specSha256)) fail('EVIDENCE_BOUND_REPORT_SPEC_DIGEST_DENIED');
  const {datasetSha256: _dataset, specSha256: _spec, ...body} = value;
  validateSpec(body, expectedBindings);
  const normalized = normalizeJsonValue(body);
  if (identitySha256(normalized.dataset) !== value.datasetSha256) fail('EVIDENCE_BOUND_REPORT_DATASET_DIGEST_DENIED');
  if (identitySha256(normalized) !== value.specSha256) fail('EVIDENCE_BOUND_REPORT_SPEC_DIGEST_DENIED');
  return {body, projection: true};
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

export function validateEvidenceBoundReportV1(value, expectedBindings) {
  inspectSurface(value);
  if (!plain(value)) fail('EVIDENCE_BOUND_REPORT_SURFACE_DENIED');
  const {body, projection} = validateProjection(value, expectedBindings);
  return projection && Object.isFrozen(value) ? value : frozen(projection ? value : body);
}

export function buildEvidenceBoundReportV1(value, expectedBindings) {
  inspectSurface(value);
  if (!plain(value)) fail('EVIDENCE_BOUND_REPORT_SURFACE_DENIED');
  const {body} = validateProjection(value, expectedBindings);
  const normalized = normalizeJsonValue(body);
  const projection = {
    ...normalized,
    datasetSha256: identitySha256(normalized.dataset),
    specSha256: identitySha256(normalized),
  };
  return frozen(projection);
}

export function verifyEvidenceBoundReportV1(projection, spec, expectedBindings) {
  inspectSurface(spec);
  const expected = buildEvidenceBoundReportV1(spec, expectedBindings);
  validateEvidenceBoundReportV1(projection, expectedBindings ?? expected.bindings);
  if (!same(projection, expected)) fail('EVIDENCE_BOUND_REPORT_MISMATCH');
  return projection;
}

export const buildEvidenceBoundReportDatasetV1 = buildEvidenceBoundReportV1;
export const buildEvidenceBoundReportProjectionV1 = buildEvidenceBoundReportV1;
export const projectEvidenceBoundReportV1 = buildEvidenceBoundReportV1;
export const validateEvidenceBoundReportSpecV1 = validateEvidenceBoundReportV1;
export const verifyEvidenceBoundReportSpecV1 = verifyEvidenceBoundReportV1;
export const verifyEvidenceBoundReportProjectionV1 = verifyEvidenceBoundReportV1;
