import assert from 'node:assert/strict';
import test from 'node:test';

import {identitySha256, sha256} from '../services/bi-control/src/db-analyzer/core.mjs';
import {EVIDENCE_BOUND_COVERAGE_VIEW_SCHEMA_V1} from '../services/bi-control/src/reporting/evidence-bound-coverage-view-v1.mjs';
import {
  EVIDENCE_BOUND_REPORT_DATASET_SCHEMA_V1,
  EVIDENCE_BOUND_REPORT_SPEC_SCHEMA_V1,
  buildEvidenceBoundReportV1,
} from '../services/bi-control/src/reporting/evidence-bound-report-v1.mjs';
import {
  EVIDENCE_BOUND_RENDERER_FORMAT_V1,
  EVIDENCE_BOUND_RENDERER_KIND_V1,
  EVIDENCE_BOUND_RENDERER_MAX_EXPORT_BYTES_V1,
  EVIDENCE_BOUND_RENDERER_SCHEMA_V1,
  buildEvidenceBoundRendererV1,
  validateEvidenceBoundRendererV1,
  verifyEvidenceBoundRendererReplayV1,
  verifyEvidenceBoundRendererV1,
} from '../services/bi-control/src/reporting/evidence-bound-renderer-v1.mjs';

const H = (character) => character.repeat(64);
const BINDINGS = Object.freeze({
  snapshotSha256: H('1'), receiptSha256: H('2'), coverageSha256: H('3'),
  capabilitySha256: H('4'), resultSha256: H('5'),
});

const reportSpec = (dataset = {
  schemaVersion: EVIDENCE_BOUND_REPORT_DATASET_SCHEMA_V1,
  datasetId: 'orders-total', kind: 'METRIC', columns: [{key: 'value'}],
  columnDefinitions: [{label: 'Orders total', dataType: 'number', nullable: false}],
  rows: [[42]], differentiator: null,
}) => ({
  schemaVersion: EVIDENCE_BOUND_REPORT_SPEC_SCHEMA_V1,
  reportId: 'orders-report', title: 'Orders evidence report', dataset, bindings: {...BINDINGS},
});

const report = () => buildEvidenceBoundReportV1(reportSpec());
const options = (overrides = {}) => ({rendererKind: EVIDENCE_BOUND_RENDERER_KIND_V1, exportFormat: EVIDENCE_BOUND_RENDERER_FORMAT_V1, ...overrides});

function coverageView() {
  const dataset = {
    schemaVersion: EVIDENCE_BOUND_REPORT_DATASET_SCHEMA_V1, datasetId: 'coverage-state', kind: 'TABLE',
    columns: [{key: 'state'}], columnDefinitions: [{label: 'State', dataType: 'string', nullable: false}],
    rows: [['COMPLETE']], differentiator: null,
  };
  const state = {
    capabilityId: 'coverage.complete', state: 'COMPLETE', reasonCode: null, sourceQueryId: 'mssql.coverage_complete',
    coverageEntrySha256: H('6'), capabilitySha256: BINDINGS.capabilitySha256, resultSha256: BINDINGS.resultSha256,
    coverageSha256: BINDINGS.coverageSha256, receiptSha256: BINDINGS.receiptSha256, snapshotSha256: BINDINGS.snapshotSha256,
  };
  const body = {
    schemaVersion: EVIDENCE_BOUND_COVERAGE_VIEW_SCHEMA_V1, viewKind: 'COVERAGE_VIEW', viewId: 'coverage-view',
    reportId: 'orders-report', bindings: {...BINDINGS},
    metrics: {completeCount: 1, partialCount: 0, deniedCount: 0, unsupportedCount: 0, unknownCount: 0, classifiedCount: 1, totalCount: 1, coverageBps: 10000},
    states: [state], blindSpots: [],
    claims: {completeness: false, absence: false, businessTruth: false, visualTruth: false},
    authority: {credentials: false, sourceConnections: false, renderer: false, sql: false, mutation: false}, dataset,
  };
  const withDataset = {...body, datasetSha256: identitySha256(dataset)};
  return {...withDataset, viewSha256: identitySha256(withDataset)};
}

function reordered(value) {
  if (Array.isArray(value)) return value.map(reordered);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reordered(child)]));
  return value;
}

function assertDeepFrozen(value) {
  if (!value || typeof value !== 'object') return;
  assert(Object.isFrozen(value));
  Object.values(value).forEach(assertDeepFrozen);
}

function receiptAndSnapshot() {
  const receipt = {receiptId: 'receipt-1', schemaVersion: 'test/receipt/v1', status: 'SEALED'};
  const snapshot = {schemaVersion: 'test/snapshot/v1', snapshotId: 'snapshot-1', state: 'SEALED'};
  return {receipt, snapshot};
}

test('the closed TABLE renderer produces deterministic bounded JSON and preserves report digests', () => {
  const first = buildEvidenceBoundRendererV1(report(), options());
  const second = buildEvidenceBoundRendererV1(reordered(report()), options());
  assert.deepEqual(second, first);
  assert.equal(JSON.stringify(second), JSON.stringify(first));
  assert.equal(first.schemaVersion, EVIDENCE_BOUND_RENDERER_SCHEMA_V1);
  assert.equal(first.rendererKind, EVIDENCE_BOUND_RENDERER_KIND_V1);
  assert.equal(first.inputKind, 'REPORT');
  assert.equal(first.datasetSha256, report().datasetSha256);
  assert.equal(first.specSha256, report().specSha256);
  assert.equal(first.viewSha256, null);
  assert.equal(first.exportBytes, new TextEncoder().encode(first.export).byteLength);
  assert(first.exportBytes <= EVIDENCE_BOUND_RENDERER_MAX_EXPORT_BYTES_V1);
  assert.match(first.exportSha256, /^[a-f0-9]{64}$/);
  assert.match(first.renderSha256, /^[a-f0-9]{64}$/);
  const exported = JSON.parse(first.export);
  assert.equal(exported.rendererKind, 'TABLE');
  assert.equal(exported.dataset.rows[0][0], 42);
  assert.equal(exported.evidence.specSha256, first.specSha256);
  assertDeepFrozen(first);
  verifyEvidenceBoundRendererV1(first, report(), options());
});

test('the renderer accepts the object-form input and replay verifies receipt and snapshot identities', () => {
  const source = report();
  const rendered = buildEvidenceBoundRendererV1({projection: source, ...options()});
  const evidence = receiptAndSnapshot();
  const replaySource = buildEvidenceBoundReportV1({...reportSpec(), bindings: {
    ...BINDINGS,
    receiptSha256: identitySha256(evidence.receipt), snapshotSha256: identitySha256(evidence.snapshot),
  }});
  const replayed = buildEvidenceBoundRendererV1(replaySource, options());
  assert.deepEqual(verifyEvidenceBoundRendererReplayV1(replayed, replaySource, evidence, options()), replayed);
  assertDeepFrozen(validateEvidenceBoundRendererV1(rendered));
  assert.throws(() => verifyEvidenceBoundRendererReplayV1(replayed, replaySource, {
    receipt: {...evidence.receipt, status: 'TAMPERED'}, snapshot: evidence.snapshot,
  }, options()), /EVIDENCE_BOUND_RENDERER_REPLAY_RECEIPT_DIGEST_DENIED/);
  assert.throws(() => verifyEvidenceBoundRendererReplayV1(replayed, replaySource, {
    receipt: evidence.receipt, snapshot: {...evidence.snapshot, state: 'TAMPERED'},
  }, options()), /EVIDENCE_BOUND_RENDERER_REPLAY_SNAPSHOT_DIGEST_DENIED/);
});

test('coverage-view projection without authoritative evidence input is denied before rendering', () => {
  const source = coverageView();
  assert.throws(() => buildEvidenceBoundRendererV1(source, options()), /EVIDENCE_BOUND_RENDERER_COVERAGE_INPUT_REQUIRED/);
});

test('unsupported renderer, format, injection, URLs, SQL, code and authority surfaces fail closed', () => {
  const source = report();
  for (const badOptions of [
    {rendererKind: 'CHART', exportFormat: 'JSON'},
    {rendererKind: 'TABLE', exportFormat: 'HTML'},
    {rendererKind: 'TABLE', exportFormat: 'JSON', spec: 'injected'},
    {rendererKind: 'TABLE', exportFormat: 'JSON', url: 'https://example.invalid'},
    {rendererKind: 'TABLE', exportFormat: 'JSON', sql: 'select 1'},
    {rendererKind: 'TABLE', exportFormat: 'JSON', expression: 'eval("bad")'},
  ]) {
    assert.throws(() => buildEvidenceBoundRendererV1({projection: source, ...badOptions}), /EVIDENCE_BOUND_RENDERER_(?:INPUT|OPTIONS|KIND|FORMAT|SURFACE)_DENIED/);
  }
  for (const mutate of [
    (copy) => { copy.credentials = {password: 'secret'}; },
    (copy) => { copy.sourceConnection = {host: 'db'}; },
    (copy) => { copy.network = true; },
    (copy) => { copy.renderer = {kind: 'CHART'}; },
    (copy) => { copy.mutate = true; },
    (copy) => { copy.dataset.rows[0][0] = '<script>alert(1)</script>'; },
  ]) {
    const bad = structuredClone(source);
    mutate(bad);
    assert.throws(() => buildEvidenceBoundRendererV1(bad), /EVIDENCE_BOUND_RENDERER_(?:PROJECTION|SURFACE|RESULT)_DENIED|EVIDENCE_BOUND_REPORT_/);
  }
});

test('raw report specs and oversized exports are not renderer inputs', () => {
  assert.throws(() => buildEvidenceBoundRendererV1(reportSpec(), options()), /EVIDENCE_BOUND_RENDERER_PROJECTION_REQUIRED/);
  const oversized = reportSpec({
    schemaVersion: EVIDENCE_BOUND_REPORT_DATASET_SCHEMA_V1, datasetId: 'large-table', kind: 'TABLE',
    columns: [{key: 'value'}], columnDefinitions: [{label: 'Value', dataType: 'string', nullable: false}],
    rows: Array.from({length: 1000}, (_, index) => [`row-${index}-${'x'.repeat(500)}`]), differentiator: null,
  });
  const largeProjection = buildEvidenceBoundReportV1(oversized);
  assert.throws(() => buildEvidenceBoundRendererV1(largeProjection, options()), /EVIDENCE_BOUND_RENDERER_EXPORT_LIMIT_DENIED/);
});

test('direct renderer validation rejects a re-digested export with substituted dataset bytes', () => {
  const rendered = buildEvidenceBoundRendererV1(report(), options());
  const forged = structuredClone(rendered);
  const payload = JSON.parse(forged.export);
  payload.dataset.rows[0][0] = 99;
  forged.export = JSON.stringify(payload);
  forged.exportBytes = new TextEncoder().encode(forged.export).byteLength;
  forged.exportSha256 = sha256(forged.export);
  const {renderSha256: _old, ...body} = forged;
  forged.renderSha256 = identitySha256(body);
  assert.throws(
    () => validateEvidenceBoundRendererV1(forged),
    /EVIDENCE_BOUND_RENDERER_DATASET_DIGEST_DENIED/,
  );
});

test('verification rejects a re-digested substitution and returns no caller-owned mutable data', () => {
  const source = report();
  const rendered = buildEvidenceBoundRendererV1(source, options());
  const forged = structuredClone(rendered);
  forged.export = forged.export.replace('Orders evidence report', 'Substituted report');
  forged.exportBytes = new TextEncoder().encode(forged.export).byteLength;
  forged.exportSha256 = sha256(forged.export);
  const {renderSha256: _old, ...body} = forged;
  forged.renderSha256 = identitySha256(body);
  assert.throws(() => verifyEvidenceBoundRendererV1(forged, source, options()), /EVIDENCE_BOUND_RENDERER_MISMATCH/);
  const verified = verifyEvidenceBoundRendererV1(rendered, source, options());
  assert.notEqual(verified, rendered);
  assertDeepFrozen(verified);
  assert.equal(Object.keys(globalThis).some((key) => /renderer|credential|connection|network/i.test(key)), false);
});

test('proxy, accessor and mutation surfaces are denied without reading traps', () => {
  let traps = 0;
  const source = report();
  const proxy = new Proxy(source, {ownKeys() { traps += 1; return Reflect.ownKeys(source); }, getPrototypeOf() { traps += 1; return Object.prototype; }});
  assert.throws(() => buildEvidenceBoundRendererV1(proxy, options()), /EVIDENCE_BOUND_RENDERER_SURFACE_DENIED|EVIDENCE_BOUND_REPORT_SURFACE_DENIED/);
  assert.equal(traps, 0);
  const accessor = structuredClone(source);
  Object.defineProperty(accessor, 'title', {enumerable: true, get() { traps += 1; return 'accessed'; }});
  assert.throws(() => buildEvidenceBoundRendererV1(accessor, options()), /EVIDENCE_BOUND_RENDERER_SURFACE_DENIED|EVIDENCE_BOUND_REPORT_SURFACE_DENIED/);
  assert.equal(traps, 0);
  const frozen = Object.freeze(structuredClone(source));
  assert.doesNotThrow(() => buildEvidenceBoundRendererV1(frozen, options()));
  assert.equal(frozen.dataset.rows[0][0], 42);
});
