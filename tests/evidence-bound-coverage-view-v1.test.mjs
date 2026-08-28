import assert from 'node:assert/strict';
import test from 'node:test';

import {identitySha256} from '../services/bi-control/src/db-analyzer/core.mjs';
import {
  EVIDENCE_BOUND_COVERAGE_VIEW_SCHEMA_V1,
  EVIDENCE_BOUND_COVERAGE_STATES,
  buildEvidenceBoundCoverageViewV1,
  verifyEvidenceBoundCoverageViewV1,
  verifyEvidenceBoundCoverageViewReplayV1,
} from '../services/bi-control/src/reporting/evidence-bound-coverage-view-v1.mjs';
import {
  EVIDENCE_BOUND_REPORT_DATASET_SCHEMA_V1,
  EVIDENCE_BOUND_REPORT_SPEC_SCHEMA_V1,
  buildEvidenceBoundReportV1,
} from '../services/bi-control/src/reporting/evidence-bound-report-v1.mjs';

const H = (character) => character.repeat(64);
const SCOPE = H('a');
const digest = (label) => identitySha256({fixture: label});
const seal = (body, key) => ({...body, [key]: identitySha256(body)});

const states = [
  ['complete', 'COMPLETE', null, 'SUCCEEDED'],
  ['partial', 'PARTIAL', 'COLUMN_PRIVILEGE_PARTIAL', 'PARTIAL'],
  ['denied', 'DENIED', 'INDEX_PRIVILEGE_DENIED', 'DENIED'],
  ['unsupported', 'UNSUPPORTED', 'SYNONYM_COLLECTOR_UNSUPPORTED', 'UNSUPPORTED'],
  ['unknown', 'UNKNOWN', 'STORED_OBJECT_OUTCOME_UNKNOWN', 'UNKNOWN'],
];

function coverageEvidence() {
  const entries = states.map(([id, state, reasonCode]) => {
    const objectRef = {
      kind: 'RELATION', schemaName: 'reporting', relationName: null, columnName: null,
      objectName: `object_${id}`, sourceObjectSha256: digest(`object-${id}`),
    };
    return {
      objectKey: identitySha256(objectRef), objectRef, state, reasonCode,
      sourceQueryId: `mssql.coverage_${id}`, evidenceRefs: [digest(`evidence-${id}`)], absenceClaim: 'NOT_CLAIMED',
    };
  });
  const queryCoverage = states.map(([, state, reasonCode], index) => ({
    queryId: `mssql.coverage_${states[index][0]}`,
    category: `fixture_${index}`,
    state: state === 'COMPLETE' ? 'SUCCEEDED' : state,
    reasonCode, visibility: 'METADATA_ONLY', absenceClaim: 'NOT_CLAIMED',
  }));
  return seal({
    schemaVersion: 'kaleidosphere.analysis/progressive-object-coverage/v1',
    engine: 'mssql', structureSnapshotSha256: digest('structure-snapshot'),
    structureCoverageLedgerSha256: digest('coverage-ledger'), thresholdBps: 9500,
    summary: {
      visibleObjectCount: 5, classifiedObjectCount: 4, coverageBps: 8000,
      stateCounts: {COMPLETE: 1, PARTIAL: 1, DENIED: 1, UNSUPPORTED: 1, UNKNOWN: 1},
    },
    entries, queryCoverage, missingPrivilegeMeansAbsent: false,
    evidenceStoreSchema: 'kaleidosphere.analysis/evidence-store/v1',
  }, 'coverageSha256');
}

function capabilityEvidence(overrides = {}) {
  const capabilities = states.map(([id, state]) => ({
    capabilityId: `coverage.${id}`,
    sourceQueryId: `mssql.coverage_${id}`,
    state,
  }));
  return seal({
    schemaVersion: 'kaleidosphere.reporting/capability-binding/v1', scopeSha256: SCOPE,
    capabilities, ...overrides,
  }, 'capabilitySha256');
}

function resultEvidence(coverage, capability, overrides = {}) {
  const results = states.map(([id, state]) => ({
    capabilityId: `coverage.${id}`,
    sourceQueryId: `mssql.coverage_${id}`,
    state, resultState: state === 'COMPLETE' ? 'SUCCEEDED' : state,
  }));
  return seal({
    schemaVersion: 'kaleidosphere.reporting/result-binding/v1', scopeSha256: SCOPE,
    coverageSha256: coverage.coverageSha256, capabilitySha256: capability.capabilitySha256,
    results, ...overrides,
  }, 'resultSha256');
}

function snapshotEvidence() {
  return seal({
    schemaVersion: 'kaleidosphere.reporting/snapshot-binding/v1', scopeSha256: SCOPE,
    snapshotId: 'snapshot-1', state: 'SEALED',
  }, 'snapshotSha256');
}

function receiptEvidence(coverage, capability, result, snapshot) {
  return seal({
    schemaVersion: 'kaleidosphere.reporting/receipt-binding/v1', scopeSha256: SCOPE,
    coverageSha256: coverage.coverageSha256, capabilitySha256: capability.capabilitySha256,
    resultSha256: result.resultSha256, snapshotSha256: snapshot.snapshotSha256,
    receiptId: 'receipt-1', state: 'SEALED',
  }, 'receiptSha256');
}

function evidence() {
  const coverage = coverageEvidence();
  const capability = capabilityEvidence();
  const result = resultEvidence(coverage, capability);
  const snapshot = snapshotEvidence();
  const receipt = receiptEvidence(coverage, capability, result, snapshot);
  return {coverage, capability, result, receipt, snapshot};
}

function reportFor(boundEvidence) {
  return buildEvidenceBoundReportV1({
    schemaVersion: EVIDENCE_BOUND_REPORT_SPEC_SCHEMA_V1,
    reportId: 'orders-report', title: 'Orders evidence report',
    dataset: {
      schemaVersion: EVIDENCE_BOUND_REPORT_DATASET_SCHEMA_V1, datasetId: 'orders-total', kind: 'METRIC',
      columns: [{key: 'value'}],
      columnDefinitions: [{label: 'Orders total', dataType: 'number', nullable: false}],
      rows: [[42]], differentiator: null,
    },
    bindings: {
      snapshotSha256: boundEvidence.snapshot.snapshotSha256,
      receiptSha256: boundEvidence.receipt.receiptSha256,
      coverageSha256: boundEvidence.coverage.coverageSha256,
      capabilitySha256: boundEvidence.capability.capabilitySha256,
      resultSha256: boundEvidence.result.resultSha256,
    },
  });
}

function input(overrides = {}) {
  const boundEvidence = evidence();
  return {
    report: reportFor(boundEvidence), ...boundEvidence, ...overrides,
  };
}

function reordered(value) {
  if (Array.isArray(value)) return value.map(reordered);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reordered(child)]));
  }
  return value;
}

function redactDigest(value, key) {
  const copy = structuredClone(value);
  const {[key]: _old, ...body} = copy;
  return {...body, [key]: identitySha256(body)};
}

function assertDeepFrozen(value) {
  if (!value || typeof value !== 'object') return;
  assert(Object.isFrozen(value));
  Object.values(value).forEach(assertDeepFrozen);
}

test('the same evidence yields a deterministic bounded report-compatible coverage view', () => {
  const firstInput = input();
  const first = buildEvidenceBoundCoverageViewV1(firstInput);
  const second = buildEvidenceBoundCoverageViewV1(input());
  assert.deepEqual(second, first);
  assert.equal(JSON.stringify(second), JSON.stringify(first));
  assert.equal(second.datasetSha256, first.datasetSha256);
  assert.equal(second.viewSha256, first.viewSha256);
  assert.equal(first.schemaVersion, EVIDENCE_BOUND_COVERAGE_VIEW_SCHEMA_V1);
  assert.deepEqual(first.metrics, {
    completeCount: 1, partialCount: 1, deniedCount: 1, unsupportedCount: 1, unknownCount: 1,
    classifiedCount: 4, totalCount: 5, coverageBps: 8000,
  });
  assert.equal(first.dataset.kind, 'TABLE');
  assert.equal(first.dataset.rows.length, 5);
  assert(first.dataset.columns.every((column) => Object.keys(column).length === 1 && Object.hasOwn(column, 'key')));
  assert.equal(first.dataset.columnDefinitions.length, first.dataset.columns.length);
  assert.equal(first.dataset.columns[3].key, 'source_evidence_id');
  assert(first.dataset.rows.every((row) => /^mssql\.coverage_/.test(row[3])));
  assert.match(first.datasetSha256, /^[a-f0-9]{64}$/);
  assert.match(first.viewSha256, /^[a-f0-9]{64}$/);
  assertDeepFrozen(first);
  verifyEvidenceBoundCoverageViewV1(first, firstInput);
});

test('all states and blind spots retain exact source, capability, result, receipt and snapshot bindings', () => {
  const source = input();
  const view = buildEvidenceBoundCoverageViewV1(source);
  assert.deepEqual([...new Set(view.states.map(({state}) => state))].sort(), [...EVIDENCE_BOUND_COVERAGE_STATES].sort());
  assert.deepEqual(view.blindSpots.map(({state}) => state), ['DENIED', 'PARTIAL', 'UNKNOWN', 'UNSUPPORTED']);
  for (const row of view.states) {
    assert.equal(row.coverageSha256, source.coverage.coverageSha256);
    assert.equal(row.capabilitySha256, source.capability.capabilitySha256);
    assert.equal(row.resultSha256, source.result.resultSha256);
    assert.equal(row.receiptSha256, source.receipt.receiptSha256);
    assert.equal(row.snapshotSha256, source.snapshot.snapshotSha256);
    assert.equal(row.sourceQueryId, `mssql.coverage_${row.capabilityId.replace('coverage.', '')}`);
  }
  assert.deepEqual(view.claims, {completeness: false, absence: false, businessTruth: false, visualTruth: false});
  assert.deepEqual(view.authority, {credentials: false, sourceConnections: false, renderer: false, sql: false, mutation: false});
});

test('input object ordering does not change canonical view ordering or digest', () => {
  const source = input();
  const reorderedInput = reordered(source);
  const first = buildEvidenceBoundCoverageViewV1(source);
  const second = buildEvidenceBoundCoverageViewV1(reorderedInput);
  assert.deepEqual(second, first);
  assert.deepEqual(second.states.map(({capabilityId}) => capabilityId), [
    'coverage.complete', 'coverage.denied', 'coverage.partial', 'coverage.unknown', 'coverage.unsupported',
  ]);
});

test('replay verifies receipt and snapshot readback bindings', () => {
  const source = input();
  const view = buildEvidenceBoundCoverageViewV1(source);
  assert.deepEqual(verifyEvidenceBoundCoverageViewReplayV1(view, source, {
    receipt: source.receipt, snapshot: source.snapshot,
  }), view);
  const tamperedReceiptBody = {...source.receipt, state: 'TAMPERED'};
  delete tamperedReceiptBody.receiptSha256;
  const tamperedSnapshotBody = {...source.snapshot, state: 'TAMPERED'};
  delete tamperedSnapshotBody.snapshotSha256;
  assert.throws(() => verifyEvidenceBoundCoverageViewReplayV1(view, source, {
    receipt: seal(tamperedReceiptBody, 'receiptSha256'), snapshot: source.snapshot,
  }), /EVIDENCE_BOUND_COVERAGE_REPLAY_RECEIPT_DIGEST_DENIED/);
  assert.throws(() => verifyEvidenceBoundCoverageViewReplayV1(view, source, {
    receipt: source.receipt, snapshot: seal(tamperedSnapshotBody, 'snapshotSha256'),
  }), /EVIDENCE_BOUND_COVERAGE_REPLAY_SNAPSHOT_DIGEST_DENIED/);
});

test('unknown or missing capability/result evidence is never promoted to complete or absent', () => {
  const source = input();
  const missingCapability = structuredClone(source);
  missingCapability.capability.capabilities = missingCapability.capability.capabilities.filter(({state}) => state !== 'COMPLETE');
  missingCapability.capability = redactDigest(missingCapability.capability, 'capabilitySha256');
  assert.throws(() => buildEvidenceBoundCoverageViewV1(missingCapability), /EVIDENCE_BOUND_COVERAGE_BINDING_DENIED/);

  const missingResult = structuredClone(source);
  missingResult.result.results = missingResult.result.results.filter(({state}) => state !== 'COMPLETE');
  missingResult.result = redactDigest(missingResult.result, 'resultSha256');
  missingResult.receipt = receiptEvidence(missingResult.coverage, missingResult.capability, missingResult.result, missingResult.snapshot);
  missingResult.report = reportFor(missingResult);
  const view = buildEvidenceBoundCoverageViewV1(missingResult);
  assert.equal(view.states.find(({state}) => state === 'UNKNOWN')?.capabilityId, 'coverage.complete');
  assert.equal(view.blindSpots.some(({state}) => state === 'UNKNOWN'), true);
});

test('stale, tampered, cross-scope, unsupported, duplicate and contradictory evidence denies', () => {
  const source = input();
  for (const key of ['coverage', 'capability', 'result', 'receipt', 'snapshot']) {
    const bad = structuredClone(source);
    const digestKey = `${key}Sha256`;
    bad[key][digestKey] = H('0');
    assert.throws(() => buildEvidenceBoundCoverageViewV1(bad), /EVIDENCE_BOUND_COVERAGE_(?:BINDING|EVIDENCE)_DENIED/);
  }

  const crossScope = structuredClone(source);
  const {snapshotSha256: _snapshot, ...snapshotBody} = crossScope.snapshot;
  crossScope.snapshot = seal({...snapshotBody, scopeSha256: H('b')}, 'snapshotSha256');
  assert.throws(() => buildEvidenceBoundCoverageViewV1(crossScope), /EVIDENCE_BOUND_COVERAGE_(?:BINDING|SCOPE)_DENIED/);

  const unsupported = structuredClone(source);
  unsupported.coverage.entries[0].state = 'NOT_SUPPORTED';
  unsupported.coverage = redactDigest(unsupported.coverage, 'coverageSha256');
  assert.throws(() => buildEvidenceBoundCoverageViewV1(unsupported), /EVIDENCE_BOUND_COVERAGE_STATE_DENIED/);

  const duplicate = structuredClone(source);
  duplicate.capability.capabilities.push(duplicate.capability.capabilities[0]);
  duplicate.capability = redactDigest(duplicate.capability, 'capabilitySha256');
  assert.throws(() => buildEvidenceBoundCoverageViewV1(duplicate), /EVIDENCE_BOUND_COVERAGE_CAPABILITY_DENIED/);

  const contradictory = structuredClone(source);
  contradictory.capability.capabilities[0].state = 'PARTIAL';
  contradictory.capability = redactDigest(contradictory.capability, 'capabilitySha256');
  contradictory.result = resultEvidence(contradictory.coverage, contradictory.capability);
  contradictory.receipt = receiptEvidence(contradictory.coverage, contradictory.capability, contradictory.result, contradictory.snapshot);
  contradictory.report = reportFor(contradictory);
  assert.throws(() => buildEvidenceBoundCoverageViewV1(contradictory), /EVIDENCE_BOUND_COVERAGE_CONTRADICTION_DENIED/);

  const crossQueryResult = structuredClone(source);
  crossQueryResult.result.results[0].sourceQueryId = 'mssql.coverage_substituted';
  crossQueryResult.result = redactDigest(crossQueryResult.result, 'resultSha256');
  crossQueryResult.receipt = receiptEvidence(crossQueryResult.coverage, crossQueryResult.capability, crossQueryResult.result, crossQueryResult.snapshot);
  crossQueryResult.report = reportFor(crossQueryResult);
  assert.throws(() => buildEvidenceBoundCoverageViewV1(crossQueryResult), /EVIDENCE_BOUND_COVERAGE_BINDING_DENIED/);
});

test('credentials, connections, URLs, raw rows, executable fields, SQL and mutation surfaces deny', () => {
  for (const [key, value] of [
    ['credentials', {password: 'secret'}], ['sourceConnection', {host: 'db'}], ['url', 'https://example.invalid'],
    ['rawRows', []], ['renderer', {type: 'chart'}], ['sql', 'select 1'], ['mutate', false],
  ]) {
    const bad = input({[key]: value});
    assert.throws(() => buildEvidenceBoundCoverageViewV1(bad), /EVIDENCE_BOUND_COVERAGE_SURFACE_DENIED/);
  }
});

test('view verification rejects a re-digested substitution and never returns caller-owned mutable data', () => {
  const source = input();
  const view = buildEvidenceBoundCoverageViewV1(source);
  const forged = structuredClone(view);
  forged.states[0].sourceQueryId = 'mssql.coverage_substituted';
  forged.dataset.rows[0][3] = 'mssql.coverage_substituted';
  forged.datasetSha256 = identitySha256(forged.dataset);
  const {viewSha256: _old, ...body} = forged;
  forged.viewSha256 = identitySha256(body);
  assert.throws(() => verifyEvidenceBoundCoverageViewV1(forged, source), /EVIDENCE_BOUND_COVERAGE_VIEW_MISMATCH/);
  const copy = verifyEvidenceBoundCoverageViewV1(view, source);
  assert.notEqual(copy, view);
  assertDeepFrozen(copy);
});

test('the pure build and replay boundary leaves no lifecycle residue', () => {
  const source = input();
  const view = buildEvidenceBoundCoverageViewV1(source);
  verifyEvidenceBoundCoverageViewReplayV1(view, source, {
    receipt: source.receipt, snapshot: source.snapshot,
  });
  assert.equal(Object.keys(globalThis).some((key) => /coverage|credential|connection|renderer/i.test(key)), false);
});
