// ERV-KS-AC03/AC05 — deterministic JSON/TABLE readback over the read-only, digest-bound
// ERV analytics source.
//
// Mirrors the KS146 bounded-readback contract (net-revenue-readback): the readback is
// rebuilt from the verified source and compared byte-for-byte (rebuild-and-compare), so a
// substituted readback or a tampered rendering fails closed. It renders only the two
// registered formats — canonical JSON and a bounded markdown TABLE — both carrying the
// full digest identity and the frozen nonclaims + all-false authority. It grants no
// posting, approval, execution or query authority and exposes no SQL/write entry point.

import { createHash } from 'node:crypto';

import { canonicalJson } from '../canonical-json.js';
import {
  ERV_ANALYTICS_AUTHORITY_KEYS,
  ERV_ANALYTICS_NONCLAIMS,
  PACK_SCHEMA,
  verifyErvAnalyticsSource,
} from './erv-analytics-source.mjs';

export const ERV_ANALYTICS_READBACK_SCHEMA =
  'kaleidosphere.business-bi/erv-analytics-readback/v1';
// The only renderable readback formats: canonical JSON and the bounded markdown table.
export const ERV_ANALYTICS_READBACK_FORMATS = Object.freeze(['JSON', 'TABLE']);

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

// Rebuild the frozen readback from a verified source. `readbackSha256` is the sha256 of
// the canonical JSON of the body (minus that field), the readback's self-binding digest.
function buildReadback(input) {
  const source = verifyErvAnalyticsSource(input);
  const states = source.metrics.map((metric) => metric.state);
  const body = {
    schemaVersion: ERV_ANALYTICS_READBACK_SCHEMA,
    type: 'ERV_ANALYTICS_AGGREGATE_READBACK',
    packSchema: source.packSchema,
    packId: source.packId,
    scenario: source.scenario,
    identity: {
      fileSha256: source.fileSha256,
      packDigest: source.packDigest,
      canonicalProjectionDigest: source.projections.canonical.digest,
      tableProjectionDigest: source.projections.table.digest,
      resultDigest: source.binding.resultDigest,
      configDigest: source.binding.configDigest,
      metricCatalogDigest: source.binding.metricCatalogDigest,
      ap03ReceiptSha256: source.binding.ap03ReceiptSha256,
      ap04CoreDigest: source.binding.ap04CoreDigest,
    },
    coverage: {
      metricStates: states,
      metricReasonCodes: source.metrics.map((metric) => metric.reasonCode),
      completeCount: states.filter((state) => state === 'COMPLETE').length,
      partialCount: states.filter((state) => state === 'PARTIAL').length,
      unknownCount: states.filter((state) => state === 'UNKNOWN').length,
      deniedCount: states.filter((state) => state === 'DENIED').length,
      deterministicReplay: true,
    },
    rows: cloneJson(source.tableRows),
    nonclaims: [...ERV_ANALYTICS_NONCLAIMS],
    authority: Object.fromEntries(ERV_ANALYTICS_AUTHORITY_KEYS.map((key) => [key, false])),
  };
  return deepFreeze({ ...body, readbackSha256: sha256(canonicalJson(body)) });
}

const jsonFor = (readback) => `${canonicalJson(readback)}\n`;

const tableFor = (readback) => {
  const identity = readback.identity;
  const metadata = [
    ['schema_version', readback.schemaVersion],
    ['type', readback.type],
    ['pack_schema', readback.packSchema],
    ['pack_id', readback.packId],
    ['scenario', readback.scenario],
    ['readback_sha256', readback.readbackSha256],
    ['file_sha256', identity.fileSha256],
    ['pack_digest', identity.packDigest],
    ['canonical_projection_digest', identity.canonicalProjectionDigest],
    ['table_projection_digest', identity.tableProjectionDigest],
    ['result_digest', identity.resultDigest],
    ['config_digest', identity.configDigest],
    ['metric_catalog_digest', identity.metricCatalogDigest],
    ['ap03_receipt_sha256', identity.ap03ReceiptSha256],
    ['ap04_core_digest', identity.ap04CoreDigest],
    ['metric_states', readback.coverage.metricStates.join(',')],
    ['complete_count', String(readback.coverage.completeCount)],
    ['partial_count', String(readback.coverage.partialCount)],
    ['unknown_count', String(readback.coverage.unknownCount)],
    ['denied_count', String(readback.coverage.deniedCount)],
  ];
  const lines = [
    '# KaleidoSphere ERV analytics TABLE readback',
    ...metadata.map(([key, value]) => `# ${key}=${value}`),
    ...readback.nonclaims.map((nonclaim, index) => `# nonclaim_${index + 1}=${canonicalJson(nonclaim)}`),
    '| analysis | metricId | dimension | value | state | units |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const row of readback.rows) {
    lines.push(`| ${row.analysis} | ${row.metricId} | ${row.dimension} | ${row.value} | ${row.state} | ${row.units} |`);
  }
  return `${lines.join('\n')}\n`;
};

// AC03 — build the frozen, deterministic readback for a source (verified first).
export function createErvAnalyticsReadback(input) {
  if (!exactKeys(input, ['source'])) fail('ERV_READBACK_INPUT_DENIED');
  return buildReadback(input);
}

// AC03 — render the readback as its canonical JSON form (deterministic).
export function renderErvAnalyticsJson(input) {
  if (!exactKeys(input, ['source'])) fail('ERV_RENDER_INPUT_DENIED');
  return jsonFor(buildReadback(input));
}

// AC03 — render the readback as its bounded markdown TABLE form (deterministic).
export function renderErvAnalyticsTable(input) {
  if (!exactKeys(input, ['source'])) fail('ERV_RENDER_INPUT_DENIED');
  return tableFor(buildReadback(input));
}

// AC04 — rebuild the readback from the source and require byte parity with the supplied
// one; a substituted readback (different source or altered digest) fails closed.
export function verifyErvAnalyticsReadback(input) {
  if (!exactKeys(input, ['source', 'readback'])) fail('ERV_READBACK_VERIFY_INPUT_DENIED');
  const { source, readback } = input;
  if (!isPlainObject(readback)) fail('ERV_READBACK_SUBSTITUTION_DENIED');
  const expected = buildReadback({ source });
  if (canonicalJson(readback) !== canonicalJson(expected)) {
    fail('ERV_READBACK_SUBSTITUTION_DENIED');
  }
  return readback;
}

// AC04 — rebuild and require both renderings to match the source's readback byte-for-byte;
// a swapped, tampered or substituted JSON/TABLE pair fails closed.
export function verifyErvAnalyticsRenderings(input) {
  if (!exactKeys(input, ['source', 'json', 'table'])) fail('ERV_RENDER_VERIFY_INPUT_DENIED');
  const { source, json, table } = input;
  if (typeof json !== 'string' || typeof table !== 'string') fail('ERV_RENDERING_DISAGREEMENT');
  const readback = buildReadback({ source });
  if (json !== jsonFor(readback)) fail('ERV_RENDERING_DISAGREEMENT');
  if (table !== tableFor(readback)) fail('ERV_RENDERING_DISAGREEMENT');
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    fail('ERV_RENDERING_DISAGREEMENT');
  }
  if (canonicalJson(parsed) !== canonicalJson(readback)) fail('ERV_RENDERING_DISAGREEMENT');
  return deepFreeze({
    readbackSha256: readback.readbackSha256,
    fileSha256: readback.identity.fileSha256,
    packDigest: readback.identity.packDigest,
    jsonSha256: sha256(json),
    tableSha256: sha256(table),
    identityEqual: true,
  });
}