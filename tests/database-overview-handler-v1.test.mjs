import assert from 'node:assert/strict';
import test from 'node:test';

import {canonicalJson, identitySha256} from '../services/bi-control/src/db-analyzer/core.mjs';
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

const freeze = (value) => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
};
const refreeze = (value) => freeze(structuredClone(value));
// ArrayBuffer views are the single leaf exception: Node cannot freeze a
// non-empty view (Object.freeze throws), so the frozen bytes wrapper object
// pins each binding to its canonical buffer instead.
const isDeepFrozen = (value) => value === null || typeof value !== 'object'
  || ArrayBuffer.isView(value)
  || (Object.isFrozen(value) && Object.values(value).every(isDeepFrozen));

const bindings = (engine, overrides = {}) => ({
  engine,
  snapshotSha256: H('1'),
  receiptSha256: H('2'),
  coverageSha256: H('3'),
  inventoryAuthoritySha256: H('4'),
  relationKindAuthoritySha256: H('5'),
  objectNameAuthoritySha256: H('6'),
  cancellationSha256: H('7'),
  ...overrides,
});

const REQUEST_SCHEMA = 'kaleidosphere.object-capabilities/request/v1';
const SCOPE = {schemas: ['dbo']};

function requestFor(engine, overrides = {}) {
  return {
    schemaVersion: REQUEST_SCHEMA,
    requestId: 'request-database-overview',
    capabilityId: DATABASE_OVERVIEW_HANDLER_CAPABILITY_ID,
    bindings: bindings(engine),
    scope: {...SCOPE, schemas: [...SCOPE.schemas]},
    ...overrides,
  };
}

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

function expectationsFor(engine, run, request, overrides = {}) {
  return {
    capabilityId: DATABASE_OVERVIEW_HANDLER_CAPABILITY_ID,
    bindings: bindings(engine),
    scope: {...SCOPE, schemas: [...SCOPE.schemas]},
    requestSha256: identitySha256(request),
    projectionSha256: buildDatabaseOverviewProjection(run).projectionSha256,
    ...overrides,
  };
}

// Independently supplied immutable authoritative inputs: plain values are sealed and deep-frozen
// before the handler sees them.
function inputs(engine, {cancelled = false, empty = false} = {}, overrides = {}) {
  const run = runFor(engine, {cancelled, empty});
  const request = requestFor(engine);
  const expectations = expectationsFor(engine, run, request, overrides);
  return {run: freeze(run), request: freeze(request), expectations: freeze(expectations)};
}

function redigestProjection(projection, mutate) {
  const {projectionSha256: _old, ...body} = structuredClone(projection);
  mutate(body);
  return seal(body, 'projectionSha256');
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

test('mssql and oracle exact mixed, empty and cancelled inputs produce byte-deterministic deeply frozen read-only envelopes', () => {
  const digestsByEngine = new Map();
  for (const engine of ['mssql', 'oracle']) {
    for (const shape of [{}, {empty: true}, {cancelled: true}]) {
      const {run, request, expectations} = inputs(engine, shape);
      const first = handleDatabaseOverviewRequestV1(request, expectations, run);
      const second = handleDatabaseOverviewRequestV1(
        refreeze(request), refreeze(expectations), refreeze(run),
      );
      for (const key of ['request', 'projection', 'result']) {
        assert.equal(Buffer.compare(first.bytes[key], second.bytes[key]), 0, `${engine} ${key} bytes`);
      }
      assert.equal(first.requestSha256, second.requestSha256);
      assert.equal(first.projectionSha256, second.projectionSha256);
      assert.equal(first.resultSha256, second.resultSha256);
      assert.ok(isDeepFrozen(first), 'result is deeply frozen');
      assert.throws(() => { first.envelope.state = 'MUTATED'; }, TypeError);
      assert.throws(() => { first.bytes.result = null; }, TypeError);
      assert.equal(first.schemaVersion, DATABASE_OVERVIEW_HANDLER_SCHEMA);
      assert.equal(first.capabilityId, DATABASE_OVERVIEW_HANDLER_CAPABILITY_ID);
      assert.equal(first.state, 'PROJECTED_READ_ONLY');
      assert.equal(first.requestSha256, identitySha256(request));
      assert.equal(first.projectionSha256, buildDatabaseOverviewProjection(run).projectionSha256);
      assert.equal(first.resultSha256, identitySha256(first.envelope));
      const projection = buildDatabaseOverviewProjection(run);
      verifyDatabaseOverviewProjection(projection, run);
      assert.deepEqual(first.envelope, {
        schemaVersion: KS_OBJECT_CAPABILITY_RESULT_SCHEMA,
        requestSha256: first.requestSha256,
        capabilityId: first.capabilityId,
        state: 'PROJECTED_READ_ONLY',
        projectionSha256: first.projectionSha256,
        bindings: bindings(engine),
        claims: {absenceClaimed: false, completenessClaimed: false, replayPreventionClaimed: false, sourceRowsIncluded: false},
        authority: {
          credentialsIncluded: false, dispatchAuthority: false, executionAuthority: false, mutationAuthority: false,
          queryExecution: false, rawValuesIncluded: false, sqlAuthority: false,
        },
      });
      assert.ok(Object.values(first.envelope.claims).every((value) => value === false), 'claims are all false');
      assert.ok(Object.values(first.envelope.authority).every((value) => value === false), 'authority is all false');
      buildObjectCapabilityContractV1().validateResult(first.envelope, {
        capabilityId: first.capabilityId, requestSha256: first.requestSha256, projectionSha256: first.projectionSha256, bindings: bindings(engine),
      });
      assert.ok(first.bytes.result.equals(Buffer.from(canonicalJson(first.envelope), 'utf8')), 'result bytes are canonical');
      assert.ok(first.bytes.request.equals(Buffer.from(canonicalJson(request), 'utf8')), 'request bytes are canonical');
      if (shape.cancelled) {
        assert.deepEqual(projection.cancellation, {state: 'CANCELLED', cancelledReceiptCount: 1, receiptCount: 1});
      } else if (shape.empty) {
        assert.deepEqual(projection.totals, {visibleCount: 0, partialCount: 0, deniedCount: 0, unsupportedCount: 0, unknownCount: 0, totalCount: 0});
        assert.deepEqual(projection.cancellation, {state: 'NOT_CANCELLED', cancelledReceiptCount: 0, receiptCount: 0});
      } else {
        assert.deepEqual(projection.totals, {visibleCount: 2, partialCount: 1, deniedCount: 1, unsupportedCount: 1, unknownCount: 1, totalCount: 6});
        assert.equal(projection.coverageBasisPoints, 8333);
      }
      digestsByEngine.set(`${engine}-${shape.cancelled ? 'cancelled' : shape.empty ? 'empty' : 'mixed'}`, first.projectionSha256);
    }
  }
  assert.notEqual(digestsByEngine.get('mssql-mixed'), digestsByEngine.get('oracle-mixed'));
  assert.notEqual(digestsByEngine.get('mssql-empty'), digestsByEngine.get('mssql-mixed'));
});

test('rejects capability, request, binding, scope and cancellation substitution before projection', () => {
  const cases = [
    [{}, {expectations: {capabilityId: 'bi.object.search.read'}}],
    [{capabilityId: 'bi.object.search.read'}, {}],
    [{bindings: bindings('mssql', {snapshotSha256: H('0')})}, {}],
    [{bindings: bindings('mssql', {cancellationSha256: H('0')})}, {}],
    [{scope: {schemas: ['other']}}, {}],
    [{scope: {schemas: ['../escape']}}, {}],
    [{scope: {schemas: ['dbo;--']}}, {}],
    [{scope: {schemas: Array.from({length: 257}, (_, index) => `s${index}`)}}, {}],
  ];
  const [requestCode, expectedCode] = [
    /DB_OVERVIEW_HANDLER_CAPABILITY_DENIED/, /KS_OBJECT_CAPABILITY_REQUEST_IDENTITY_DENIED/,
    /KS_OBJECT_CAPABILITY_BINDING_DENIED/, /KS_OBJECT_CAPABILITY_BINDING_DENIED/,
    /KS_OBJECT_CAPABILITY_SCOPE_DENIED/, /KS_OBJECT_CAPABILITY_SCOPE_DENIED/, /KS_OBJECT_CAPABILITY_SCOPE_DENIED/,
    /KS_OBJECT_CAPABILITY_SCOPE_DENIED/,
  ];
  cases.forEach(([requestOverrides, expectationOverrides], index) => {
    const {run, request, expectations} = inputs('mssql', {}, expectationOverrides);
    const mutated = freeze(structuredClone({...requestFor('mssql'), ...requestOverrides}));
    assert.throws(
      () => handleDatabaseOverviewRequestV1(mutated, expectations, run),
      expectedCode[index],
    );
  });
});

test('rejects unsafe request surface fields: sql, credentials, raw rows and callbacks', () => {
  for (const [key, value] of [['sql', 'SELECT 1'], ['credentials', 'secret'], ['rawRows', []], ['callback', 'https://evil.invalid']]) {
    const {run, expectations} = inputs('mssql');
    const mutated = freeze(structuredClone({...requestFor('mssql'), [key]: value}));
    assert.throws(() => handleDatabaseOverviewRequestV1(mutated, expectations, run), /KS_OBJECT_CAPABILITY_REQUEST_SURFACE_DENIED/);
  }
});

test('rejects unchanged-digest binding drift against canonical request and projection digests', () => {
  const {run, request, expectations} = inputs('mssql');
  const driftedRequest = requestFor('mssql', {requestId: 'request-other-overview'});
  assert.throws(
    () => handleDatabaseOverviewRequestV1(
      freeze(structuredClone(request)),
      freeze(structuredClone({...expectationsFor('mssql', run, request), requestSha256: identitySha256(driftedRequest)})),
      run,
    ),
    /DB_OVERVIEW_HANDLER_DIGEST_DRIFT/,
  );
  const forgery = redigestProjection(buildDatabaseOverviewProjection(run), (body) => {
    body.totals.visibleCount += 1;
    body.totals.totalCount += 1;
    body.coverageBasisPoints = 8571;
  });
  assert.throws(
    () => handleDatabaseOverviewRequestV1(
      request,
      freeze(structuredClone({...expectationsFor('mssql', run, request), projectionSha256: forgery.projectionSha256})),
      run,
    ),
    /DB_OVERVIEW_HANDLER_DIGEST_DRIFT/,
  );
  assert.throws(
    () => handleDatabaseOverviewRequestV1(
      request,
      freeze(structuredClone({...expectationsFor('mssql', run, request), requestSha256: H('g')})),
      run,
    ),
    /DB_OVERVIEW_HANDLER_INPUT_INVALID/,
  );
  const {run: mssqlRun, request: oracleRequest, expectations: oracleExpectations} = inputs('mssql');
  void mssqlRun;
  const mismatched = freeze(structuredClone({
    ...requestFor('oracle'),
    bindings: bindings('oracle'),
    scope: {...SCOPE, schemas: [...SCOPE.schemas]},
  }));
  assert.throws(
    () => handleDatabaseOverviewRequestV1(mismatched, oracleExpectations, run),
    /DB_OVERVIEW_HANDLER_ENGINE_MISMATCH/,
  );
});

test('rejects claim-bearing identifiers and fully re-digested forged runs against unchanged authoritative inputs', () => {
  const {request, expectations} = inputs('mssql');
  const claim = redigestRun(runFor('mssql'), (copy) => {
    copy.scope.database = 'warehouse_complete';
    copy.scopeSha256 = identitySha256(copy.scope);
  });
  assert.throws(() => handleDatabaseOverviewRequestV1(request, expectations, freeze(claim)), /DB_OVERVIEW_CLAIM_BEARING_IDENTIFIER/);
  const inconsistent = redigestRun(runFor('mssql'), (copy) => {
    copy.coverage.summary.visibleObjectCount = 7;
  });
  assert.throws(() => handleDatabaseOverviewRequestV1(request, expectations, freeze(inconsistent)), /DB_OVERVIEW_TOTALS_INCONSISTENT/);
  const missing = redigestRun(runFor('mssql'), (copy) => { delete copy.coverage; });
  assert.throws(() => handleDatabaseOverviewRequestV1(request, expectations, freeze(missing)), /DB_OVERVIEW_SOURCE_INVALID/);
  const stale = redigestRun(runFor('mssql', {cancelled: true}), (copy) => {
    copy.receipts[0].scopeSha256 = identitySha256({fixture: 'other-scope'});
  });
  assert.throws(() => handleDatabaseOverviewRequestV1(request, expectations, freeze(stale)), /DB_OVERVIEW_RECEIPT_INVALID/);
  const replacement = redigestRun(runFor('mssql', {cancelled: true}), (copy) => {
    copy.coverage.thresholdBps = 9000;
    const {coverageSha256: _old, ...coverageBody} = copy.coverage;
    copy.coverage = seal(coverageBody, 'coverageSha256');
  });
  assert.throws(() => handleDatabaseOverviewRequestV1(request, expectations, freeze(replacement)), /DB_OVERVIEW_(?:PROBE|RECEIPT)_INVALID/);
});

test('rejects unsafe source values, authority claim fields and mutable inputs', () => {
  const {request, expectations} = inputs('mssql');
  for (const [key, value] of [['note', 'select * from users;'], ['apiToken', 'not-a-secret'], ['reference', 'https://example.invalid']]) {
    const unsafe = redigestRun(runFor('mssql'), (copy) => { copy[key] = value; });
    assert.throws(() => handleDatabaseOverviewRequestV1(request, expectations, freeze(unsafe)), /DB_OVERVIEW_UNSAFE_JSON/);
  }
  for (const [key, value] of [
    ['authority', {dispatchAuthority: true}],
    ['authority', {executionAuthority: true}],
    ['authority', {mutationAuthority: true}],
    ['claims', {completenessClaimed: true}],
  ]) {
    const claiming = redigestRun(runFor('mssql'), (copy) => { copy[key] = value; });
    assert.throws(() => handleDatabaseOverviewRequestV1(request, expectations, freeze(claiming)), /DB_OVERVIEW_HANDLER_AUTHORITY_CLAIM_DENIED/);
  }
  const mutable = inputs('mssql');
  assert.throws(
    () => handleDatabaseOverviewRequestV1(structuredClone(mutable.request), mutable.expectations, mutable.run),
    /DB_OVERVIEW_HANDLER_INPUT_INVALID/,
  );
});