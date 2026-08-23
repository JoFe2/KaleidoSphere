import assert from 'node:assert/strict';
import test from 'node:test';

import {identitySha256, normalizeJsonValue} from '../services/bi-control/src/db-analyzer/core.mjs';
import {
  DATABASE_OVERVIEW_KINDS,
  buildDatabaseOverviewProjection,
  verifyDatabaseOverviewProjection,
} from '../services/bi-control/src/db-analyzer/database-overview-projection-v1.mjs';

const seal = (body, key) => ({...normalizeJsonValue(body), [key]: identitySha256(normalizeJsonValue(body))});
const digest = (label) => identitySha256({fixture: label});

function source({cancelled = false} = {}) {
  const scope = {database: 'warehouse', container: null, schemas: ['audit', 'reporting']};
  const scopeSha256 = identitySha256(scope);
  const specs = [
    ['SCHEMA', 'COMPLETE', null],
    ['RELATION', 'COMPLETE', null],
    ['COLUMN', 'PARTIAL', 'COLUMN_PRIVILEGE_PARTIAL'],
    ['INDEX', 'DENIED', 'INDEX_PRIVILEGE_DENIED'],
    ['SYNONYM', 'UNSUPPORTED', 'SYNONYM_COLLECTOR_UNSUPPORTED'],
    ['STORED_OBJECT', 'UNKNOWN', 'STORED_OBJECT_OUTCOME_UNKNOWN'],
  ];
  const entries = specs.map(([kind, state, reasonCode], index) => {
    const objectRef = {kind, schemaName: 'reporting', relationName: null, columnName: null, objectName: `object_${index}`, sourceObjectSha256: digest(`object-${index}`)};
    return {objectKey: identitySha256(objectRef), objectRef, state, reasonCode, sourceQueryId: `mssql.fixture_${index}`, evidenceRefs: [digest(`evidence-${index}`)], absenceClaim: 'NOT_CLAIMED'};
  });
  const queryCoverage = specs.map(([, state, reasonCode], index) => ({
    queryId: `mssql.fixture_${index}`, category: `fixture_${index}`,
    state: state === 'COMPLETE' ? 'SUCCEEDED' : state, reasonCode, visibility: 'METADATA_ONLY', absenceClaim: 'NOT_CLAIMED',
  }));
  const stateCounts = {COMPLETE: 2, PARTIAL: 1, DENIED: 1, UNSUPPORTED: 1, UNKNOWN: 1};
  const coverageBody = {
    schemaVersion: 'kaleidosphere.analysis/progressive-object-coverage/v1', engine: 'mssql',
    structureSnapshotSha256: digest('inventory'), structureCoverageLedgerSha256: digest('ledger'), thresholdBps: 9500,
    summary: {visibleObjectCount: 6, classifiedObjectCount: 5, coverageBps: 8333, stateCounts},
    entries, queryCoverage, missingPrivilegeMeansAbsent: false, evidenceStoreSchema: 'kaleidosphere.analysis/evidence-store/v1',
  };
  const coverage = seal(coverageBody, 'coverageSha256');
  const probes = cancelled ? [{
    runId: 'overview-run', scopeSha256, methodRef: 'mssql.fixture@1.0.0', phase: 'SAFE_AGGREGATES', target: {kind: 'SCOPE'}, arguments: {},
    methodRegistrySha256: digest('registry'), coverageSha256: coverage.coverageSha256, probeKey: digest('probe'),
  }] : [];
  const receipts = cancelled ? [seal({
    schemaVersion: 'kaleidosphere.analysis/progressive-probe-receipt/v1', runId: 'overview-run', scopeSha256,
    probeKey: probes[0].probeKey, methodRef: probes[0].methodRef, phase: probes[0].phase, target: probes[0].target,
    argumentsSha256: identitySha256({}), resultState: 'CANCELLED', evidenceRefs: [], blindRetryAllowed: false,
  }, 'receiptSha256')] : [];
  return seal({
    schemaVersion: 'kaleidosphere.analysis/progressive-run/v1', runId: 'overview-run', engine: 'mssql', phase: 'REPORT', completedPhases: [],
    scope, scopeSha256, methodRegistry: {}, coverage, breadthOverride: null, budget: {}, probes, receipts,
    evidenceBinding: {structureSnapshotSha256: coverage.structureSnapshotSha256, structureCoverageSha256: coverage.structureCoverageLedgerSha256, evidenceStoreSchema: coverage.evidenceStoreSchema, canonicalHash: 'SHA-256'},
    safety: {},
  }, 'stateSha256');
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

test('mixed coverage emits a closed deterministic bounded aggregate with fixed kind order', () => {
  const run = source();
  const first = buildDatabaseOverviewProjection(run);
  const second = buildDatabaseOverviewProjection(JSON.parse(JSON.stringify(run)));
  assert.deepEqual(second, first);
  assert.deepEqual(first.countsByKind.map(({kind}) => kind), DATABASE_OVERVIEW_KINDS);
  assert.deepEqual(first.totals, {visibleCount: 2, partialCount: 1, deniedCount: 1, unsupportedCount: 1, unknownCount: 1, totalCount: 6});
  assert.equal(first.coverageBasisPoints, 8333);
  assert.deepEqual(first.claims, {completeness: false, absence: false, businessTruth: false});
  assert.deepEqual(first.authority, {sqlAuthority: 'NONE', dispatchAuthority: 'NONE', mutationAuthority: 'NONE'});
  assert(!JSON.stringify(first).includes('reporting'));
  verifyDatabaseOverviewProjection(first, run);
});

test('cancelled receipts are chained and cancellation is represented without retry or dispatch authority', () => {
  const run = source({cancelled: true});
  const projection = buildDatabaseOverviewProjection(run);
  assert.deepEqual(projection.cancellation, {state: 'CANCELLED', cancelledReceiptCount: 1, receiptCount: 1});
  assert.equal(projection.bindings.receiptChainSha256.length, 64);
  verifyDatabaseOverviewProjection(projection, run);
});

test('key ordering does not affect canonical projection identity', () => {
  const run = source();
  const top = Object.fromEntries(Object.entries(run).reverse());
  assert.equal(buildDatabaseOverviewProjection(top).projectionSha256, buildDatabaseOverviewProjection(run).projectionSha256);
});

test('inconsistent totals or basis points and missing coverage fail closed', () => {
  for (const mutate of [
    (run) => { run.coverage.summary.visibleObjectCount = 7; },
    (run) => { run.coverage.summary.coverageBps = 9000; },
  ]) {
    const forged = structuredClone(source());
    mutate(forged);
    const {coverageSha256: _coverage, ...coverageBody} = forged.coverage;
    forged.coverage = seal(coverageBody, 'coverageSha256');
    forged.evidenceBinding.structureSnapshotSha256 = forged.coverage.structureSnapshotSha256;
    const {stateSha256: _state, ...runBody} = forged;
    const sealedRun = seal(runBody, 'stateSha256');
    assert.throws(() => buildDatabaseOverviewProjection(sealedRun), /DB_OVERVIEW_TOTALS_INCONSISTENT/);
  }
  const missing = redigestRun(source(), (run) => { delete run.coverage; });
  assert.throws(() => buildDatabaseOverviewProjection(missing), /DB_OVERVIEW_SOURCE_INVALID/);
});

test('stale or tampered receipts, cancellation mismatch, and digest drift fail closed', () => {
  const run = source({cancelled: true});
  const stale = redigestRun(run, (copy) => { copy.receipts[0].scopeSha256 = digest('other-scope'); });
  assert.throws(() => buildDatabaseOverviewProjection(stale), /DB_OVERVIEW_RECEIPT_TAMPERED/);
  const cancellationMismatch = redigestProjection(buildDatabaseOverviewProjection(run), (body) => { body.cancellation.state = 'NOT_CANCELLED'; });
  assert.throws(() => verifyDatabaseOverviewProjection(cancellationMismatch, run), /DB_OVERVIEW_PROJECTION_MISMATCH/);
  const drift = redigestRun(run, (copy) => { copy.evidenceBinding.structureCoverageSha256 = digest('other-ledger'); });
  assert.throws(() => buildDatabaseOverviewProjection(drift), /DB_OVERVIEW_BINDING_DRIFT/);
});

test('duplicate kinds or evidence, unsupported codes, and identifier substitution fail closed', () => {
  const duplicateKind = redigestProjection(buildDatabaseOverviewProjection(source()), (body) => { body.countsByKind[1].kind = body.countsByKind[0].kind; });
  assert.throws(() => verifyDatabaseOverviewProjection(duplicateKind, source()), /DB_OVERVIEW_PROJECTION_MISMATCH/);
  const duplicateEvidence = structuredClone(source());
  duplicateEvidence.coverage.entries[0].evidenceRefs.push(duplicateEvidence.coverage.entries[0].evidenceRefs[0]);
  const {coverageSha256: _coverage, ...coverageBody} = duplicateEvidence.coverage;
  duplicateEvidence.coverage = seal(coverageBody, 'coverageSha256');
  const {stateSha256: _state, ...runBody} = duplicateEvidence;
  assert.throws(() => buildDatabaseOverviewProjection(seal(runBody, 'stateSha256')), /DB_OVERVIEW_COVERAGE_INVALID/);
  const unsupported = structuredClone(source());
  unsupported.coverage.entries[2].reasonCode = 'bad-code';
  const {coverageSha256: _badCoverage, ...badCoverageBody} = unsupported.coverage;
  unsupported.coverage = seal(badCoverageBody, 'coverageSha256');
  const {stateSha256: _badState, ...badRunBody} = unsupported;
  assert.throws(() => buildDatabaseOverviewProjection(seal(badRunBody, 'stateSha256')), /DB_OVERVIEW_COVERAGE_INVALID/);
  const substituted = redigestRun(source(), (run) => { run.scope.database = 'other'; });
  assert.throws(() => buildDatabaseOverviewProjection(substituted), /DB_OVERVIEW_SOURCE_INVALID/);
});

test('claim-bearing identifiers and fully re-digested projection forgeries are rejected', () => {
  const claim = structuredClone(source());
  claim.scope.database = 'warehouse_complete';
  claim.scopeSha256 = identitySha256(claim.scope);
  claim.evidenceBinding = {...claim.evidenceBinding};
  const {stateSha256: _state, ...body} = claim;
  assert.throws(() => buildDatabaseOverviewProjection(seal(body, 'stateSha256')), /DB_OVERVIEW_CLAIM_BEARING_IDENTIFIER/);
  const run = source();
  const forgery = redigestProjection(buildDatabaseOverviewProjection(run), (projection) => {
    projection.totals.visibleCount += 1;
    projection.totals.totalCount += 1;
    projection.coverageBasisPoints = 8571;
  });
  assert.throws(() => verifyDatabaseOverviewProjection(forgery, run), /DB_OVERVIEW_PROJECTION_MISMATCH/);
});

test('unsafe JSON, secrets, paths, URLs, callbacks, and SQL-shaped values are rejected', () => {
  const cases = [
    ['callback', () => {}], ['apiToken', 'not-a-secret'], ['reportPath', '/tmp/report.json'],
    ['reference', 'https://example.invalid'], ['note', 'select * from users;'], ['note', 'password=hunter2'],
  ];
  for (const [key, value] of cases) {
    const run = source();
    run[key] = value;
    assert.throws(() => buildDatabaseOverviewProjection(run), /DB_OVERVIEW_UNSAFE_JSON/);
  }
});
