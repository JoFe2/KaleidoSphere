import assert from 'node:assert/strict';
import test from 'node:test';

import {canonicalJson, identitySha256} from '../services/bi-control/src/db-analyzer/core.mjs';
import {runCapabilityAdversarialMatrixV1} from './helpers/object-capability-adversarial-matrix-v1.mjs';
import {
  buildDatabaseOverviewProjection,
  verifyDatabaseOverviewProjection,
} from '../services/bi-control/src/db-analyzer/database-overview-projection-v1.mjs';
import {
  KS_OBJECT_CAPABILITY_RESULT_SCHEMA,
  buildObjectCapabilityContractV1,
} from '../services/bi-agent/src/object-capability-contract-v1.mjs';
import {
  DATABASE_OVERVIEW_HANDLER_CAPABILITY_ID,
  DATABASE_OVERVIEW_HANDLER_SCHEMA,
  handleDatabaseOverviewRequestV1,
} from '../services/bi-agent/src/database-overview-handler-v1.mjs';

const H = (character) => character.repeat(64);
const digest = (label) => identitySha256({fixture: label});
const seal = (body, key) => ({...body, [key]: identitySha256(body)});
const REQUEST_SCHEMA = 'kaleidosphere.object-capabilities/request/v1';

const freeze = (value) => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
};
const refreeze = (value) => freeze(structuredClone(value));
const isDeepFrozen = (value) => value === null || typeof value !== 'object'
  || ArrayBuffer.isView(value)
  || (Object.isFrozen(value) && Object.values(value).every(isDeepFrozen));

function runFor(engine, {cancelled = false, empty = false} = {}) {
  const scope = {database: 'warehouse', container: null, schemas: ['audit', 'reporting']};
  const scopeSha256 = identitySha256(scope);
  const specs = empty ? [] : [
    ['SCHEMA', 'COMPLETE', null],
    ['RELATION', 'COMPLETE', null],
    ['COLUMN', 'PARTIAL', 'COLUMN_PRIVILEGE_PARTIAL'],
    ['INDEX', 'DENIED', 'INDEX_PRIVILEGE_DENIED'],
    ['SYNONYM', 'UNSUPPORTED', 'SYNONYM_COLLECTOR_UNSUPPORTED'],
    ['STORED_OBJECT', 'UNKNOWN', 'STORED_OBJECT_OUTCOME_UNKNOWN'],
  ];
  const entries = specs.map(([kind, state, reasonCode], index) => {
    const objectRef = {kind, schemaName: 'reporting', relationName: null, columnName: null, objectName: `object_${index}`, sourceObjectSha256: digest(`object-${index}`)};
    return {objectKey: identitySha256(objectRef), objectRef, state, reasonCode, sourceQueryId: `${engine}.fixture_${index}`, evidenceRefs: [digest(`evidence-${index}`)], absenceClaim: 'NOT_CLAIMED'};
  });
  const queryCoverage = specs.map(([, state, reasonCode], index) => ({
    queryId: `${engine}.fixture_${index}`, category: `fixture_${index}`,
    state: state === 'COMPLETE' ? 'SUCCEEDED' : state, reasonCode, visibility: 'METADATA_ONLY', absenceClaim: 'NOT_CLAIMED',
  }));
  const summary = empty
    ? {visibleObjectCount: 0, classifiedObjectCount: 0, coverageBps: 0, stateCounts: {COMPLETE: 0, PARTIAL: 0, DENIED: 0, UNSUPPORTED: 0, UNKNOWN: 0}}
    : {visibleObjectCount: 6, classifiedObjectCount: 5, coverageBps: 8333, stateCounts: {COMPLETE: 2, PARTIAL: 1, DENIED: 1, UNSUPPORTED: 1, UNKNOWN: 1}};
  const coverage = seal({
    schemaVersion: 'kaleidosphere.analysis/progressive-object-coverage/v1', engine,
    structureSnapshotSha256: digest('inventory'), structureCoverageLedgerSha256: digest('ledger'), thresholdBps: 9500,
    summary, entries, queryCoverage, missingPrivilegeMeansAbsent: false, evidenceStoreSchema: 'kaleidosphere.analysis/evidence-store/v1',
  }, 'coverageSha256');
  const probes = cancelled && !empty ? [{
    runId: 'overview-run', scopeSha256, methodRef: `${engine}.fixture@1.0.0`, phase: 'SAFE_AGGREGATES', target: {kind: 'SCOPE'}, arguments: {},
    methodRegistrySha256: digest('registry'), coverageSha256: coverage.coverageSha256, probeKey: digest('probe'),
  }] : [];
  const receipts = cancelled && !empty ? [seal({
    schemaVersion: 'kaleidosphere.analysis/progressive-probe-receipt/v1', runId: 'overview-run', scopeSha256,
    coverageSha256: coverage.coverageSha256,
    probeKey: probes[0].probeKey, methodRef: probes[0].methodRef, phase: probes[0].phase, target: probes[0].target,
    argumentsSha256: identitySha256({}), resultState: 'CANCELLED', evidenceRefs: [], blindRetryAllowed: false,
  }, 'receiptSha256')] : [];
  return seal({
    schemaVersion: 'kaleidosphere.analysis/progressive-run/v1', runId: 'overview-run', engine, phase: 'REPORT', completedPhases: [],
    scope, scopeSha256, methodRegistry: {}, coverage, breadthOverride: null, budget: {}, probes, receipts,
    evidenceBinding: {structureSnapshotSha256: coverage.structureSnapshotSha256, structureCoverageSha256: coverage.structureCoverageLedgerSha256, evidenceStoreSchema: coverage.evidenceStoreSchema, canonicalHash: 'SHA-256'},
    safety: {},
  }, 'stateSha256');
}

function overviewBindings(run) {
  const projection = buildDatabaseOverviewProjection(run);
  const receiptChainSha256 = projection.bindings.receiptChainSha256;
  return {
    engine: run.engine,
    runStateSha256: run.stateSha256,
    snapshotSha256: projection.bindings.inventorySnapshotSha256,
    coverageSha256: projection.bindings.coverageSha256,
    receiptChainSha256,
    cancellationSha256: identitySha256({
      schemaVersion: 'kaleidosphere.object-capabilities/cancellation-binding/v1',
      receiptChainSha256,
      cancellation: projection.cancellation,
    }),
  };
}

function requestFor(run, overrides = {}) {
  return {
    schemaVersion: REQUEST_SCHEMA,
    requestId: 'request-database-overview',
    capabilityId: DATABASE_OVERVIEW_HANDLER_CAPABILITY_ID,
    bindings: overviewBindings(run),
    scope: {schemas: [...run.scope.schemas]},
    ...overrides,
  };
}

function inputs(engine, shape = {}) {
  const run = runFor(engine, shape);
  return {run: freeze(run), request: freeze(requestFor(run))};
}

function redigestRun(run, mutate) {
  const copy = structuredClone(run);
  mutate(copy);
  const {stateSha256: _old, ...body} = copy;
  return seal(body, 'stateSha256');
}

const ALL_FALSE = [
  'absenceClaimed', 'completenessClaimed', 'replayPreventionClaimed', 'sourceRowsIncluded',
  'credentialsIncluded', 'dispatchAuthority', 'executionAuthority', 'mutationAuthority',
  'queryExecution', 'rawValuesIncluded', 'sqlAuthority',
];

test('mssql and oracle mixed, empty and cancelled authority inputs produce deterministic isolated read-only envelopes', () => {
  for (const engine of ['mssql', 'oracle']) {
    for (const shape of [{}, {empty: true}, {cancelled: true}]) {
      const {run, request} = inputs(engine, shape);
      const first = handleDatabaseOverviewRequestV1(request, run);
      const second = handleDatabaseOverviewRequestV1(refreeze(request), refreeze(run));
      assert.equal(first.schemaVersion, DATABASE_OVERVIEW_HANDLER_SCHEMA);
      assert.equal(first.capabilityId, DATABASE_OVERVIEW_HANDLER_CAPABILITY_ID);
      assert.equal(first.state, 'PROJECTED_READ_ONLY');
      assert.equal(first.requestSha256, identitySha256(request));
      assert.equal(first.projectionSha256, buildDatabaseOverviewProjection(run).projectionSha256);
      assert.deepEqual(first.envelope.bindings, overviewBindings(run));
      assert.equal(first.resultSha256, identitySha256(first.envelope));
      assert.ok(isDeepFrozen(first));
      assert.notEqual(first.envelope.bindings, request.bindings);
      for (const key of ['request', 'projection', 'result']) assert.equal(first.bytes[key], second.bytes[key]);
      for (const key of ALL_FALSE) assert.equal(first.envelope.claims[key] ?? first.envelope.authority[key], false);
      const projection = buildDatabaseOverviewProjection(run);
      verifyDatabaseOverviewProjection(projection, run);
      buildObjectCapabilityContractV1().validateResult(first.envelope, {
        capabilityId: first.capabilityId,
        requestSha256: first.requestSha256,
        projectionSha256: first.projectionSha256,
        bindings: overviewBindings(run),
      });
      assert.throws(() => { first.envelope.state = 'MUTATED'; }, TypeError);
      assert.equal(first.bytes.result, canonicalJson(first.envelope));
    }
  }
});

test('returned canonical byte material is immutable and cannot drift after validation', () => {
  const {run, request} = inputs('mssql');
  const result = handleDatabaseOverviewRequestV1(request, run);
  for (const key of ['request', 'projection', 'result']) {
    assert.equal(typeof result.bytes[key], 'string', `${key} bytes use immutable canonical text`);
    assert.throws(() => { result.bytes[key] = 'mutated'; }, TypeError);
  }
  assert.equal(result.bytes.result, canonicalJson(result.envelope));
});

test('rejects paired scope and every profile binding substitution against the unchanged authoritative run', () => {
  const {run, request} = inputs('mssql');
  const substitutions = [
    ['scope', {schemas: ['other']}],
    ...Object.keys(request.bindings).filter((key) => key !== 'engine').map((key) => [key, H('0')]),
  ];
  for (const [key, value] of substitutions) {
    const nextRequest = key === 'scope'
      ? {...request, scope: value}
      : {...request, bindings: {...request.bindings, [key]: value}};
    assert.throws(
      () => handleDatabaseOverviewRequestV1(refreeze(nextRequest), run),
      /KS_OBJECT_CAPABILITY_(?:SCOPE|BINDING)_DENIED/,
      `paired ${key} substitution must be denied`,
    );
  }
});

test('rejects capability, engine, unsafe surface, extra universal bindings and mutable inputs', () => {
  const {run, request} = inputs('mssql');
  assert.throws(() => handleDatabaseOverviewRequestV1(refreeze({...request, capabilityId: 'bi.object.search.read'}), run), /KS_OBJECT_CAPABILITY_REQUEST_IDENTITY_DENIED/);
  assert.throws(() => handleDatabaseOverviewRequestV1(refreeze({...request, bindings: {...request.bindings, engine: 'oracle'}}), run), /KS_OBJECT_CAPABILITY_BINDING_DENIED/);
  for (const [key, value] of [['sql', 'SELECT 1'], ['credentials', 'secret'], ['rawRows', []], ['callback', 'https://evil.invalid']]) {
    assert.throws(() => handleDatabaseOverviewRequestV1(refreeze({...request, [key]: value}), run), /KS_OBJECT_CAPABILITY_REQUEST_SURFACE_DENIED/);
  }
  assert.throws(() => handleDatabaseOverviewRequestV1(refreeze({
    ...request, bindings: {...request.bindings, inventoryAuthoritySha256: H('4')},
  }), run), /KS_OBJECT_CAPABILITY_BINDING_DENIED/);
  assert.throws(() => handleDatabaseOverviewRequestV1(request, structuredClone(run)), /DB_OVERVIEW_HANDLER_INPUT_INVALID/);
});

test('rejects fully re-digested forged, claim-bearing, inconsistent, stale and authority-widened runs', () => {
  const {request} = inputs('mssql');
  const cases = [
    [redigestRun(runFor('mssql'), (copy) => { copy.scope.database = 'warehouse_complete'; copy.scopeSha256 = identitySha256(copy.scope); }), /DB_OVERVIEW_CLAIM_BEARING_IDENTIFIER/],
    [redigestRun(runFor('mssql'), (copy) => { copy.coverage.summary.visibleObjectCount = 7; }), /DB_OVERVIEW_(?:COVERAGE_TAMPERED|TOTALS_INCONSISTENT)/],
    [redigestRun(runFor('mssql'), (copy) => { delete copy.coverage; }), /DB_OVERVIEW_SOURCE_INVALID/],
    [redigestRun(runFor('mssql', {cancelled: true}), (copy) => { copy.receipts[0].scopeSha256 = digest('other-scope'); }), /DB_OVERVIEW_RECEIPT_(?:TAMPERED|INVALID)/],
    [redigestRun(runFor('mssql'), (copy) => { copy.authority = {dispatchAuthority: true}; }), /DB_OVERVIEW_HANDLER_AUTHORITY_CLAIM_DENIED/],
  ];
  for (const [run, code] of cases) assert.throws(() => handleDatabaseOverviewRequestV1(request, freeze(run)), code);
});

test('rejects Proxy, accessor, hidden and symbol inputs before traps execute', () => {
  const {run, request} = inputs('mssql');
  let traps = 0;
  const proxy = new Proxy(request, {getPrototypeOf() { traps += 1; return Object.prototype; }});
  assert.throws(() => handleDatabaseOverviewRequestV1(proxy, run), /KS_OBJECT_CAPABILITY_REQUEST_SURFACE_DENIED/);
  assert.equal(traps, 0);

  const hidden = structuredClone(request);
  Object.defineProperty(hidden, 'credentials', {value: 'secret', enumerable: false});
  assert.throws(() => handleDatabaseOverviewRequestV1(freeze(hidden), run), /KS_OBJECT_CAPABILITY_REQUEST_SURFACE_DENIED/);

  const symbol = structuredClone(request);
  symbol[Symbol('secret')] = 'hidden';
  assert.throws(() => handleDatabaseOverviewRequestV1(freeze(symbol), run), /KS_OBJECT_CAPABILITY_REQUEST_SURFACE_DENIED/);

  let getterCalls = 0;
  const accessor = structuredClone(request);
  Object.defineProperty(accessor.bindings, 'coverageSha256', {enumerable: true, get() { getterCalls += 1; return request.bindings.coverageSha256; }});
  assert.throws(() => handleDatabaseOverviewRequestV1(accessor, run), /KS_OBJECT_CAPABILITY_REQUEST_SURFACE_DENIED/);
  assert.equal(getterCalls, 0);
});

test('reusable adversarial matrix covers the Overview capability profile against unchanged authority', () => {
  const {run, request} = inputs('mssql');
  runCapabilityAdversarialMatrixV1({
    request,
    otherCapabilityId: 'bi.object.search.read',
    invokeWithRequest: (candidate) => handleDatabaseOverviewRequestV1(candidate, run),
  });
});
