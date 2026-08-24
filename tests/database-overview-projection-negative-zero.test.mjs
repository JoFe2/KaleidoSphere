import assert from 'node:assert/strict';
import test from 'node:test';

import {identitySha256} from '../services/bi-control/src/db-analyzer/core.mjs';
import {
  DATABASE_OVERVIEW_KINDS,
  buildDatabaseOverviewProjection,
  verifyDatabaseOverviewProjection,
} from '../services/bi-control/src/db-analyzer/database-overview-projection-v1.mjs';

// Seals over the raw body: the digest is canonical (identitySha256 normalizes -0 to 0 inside),
// while the retained body keeps the raw numeric value, matching a fully re-digested sealed run.
const seal = (body, key) => ({...body, [key]: identitySha256(body)});
const digest = (label) => identitySha256({fixture: label});

function emptySource(zero) {
  const scope = {database: 'warehouse', container: null, schemas: ['audit', 'reporting']};
  const scopeSha256 = identitySha256(scope);
  const coverageBody = {
    schemaVersion: 'kaleidosphere.analysis/progressive-object-coverage/v1', engine: 'mssql',
    structureSnapshotSha256: digest('inventory'), structureCoverageLedgerSha256: digest('ledger'), thresholdBps: 9500,
    summary: {visibleObjectCount: zero, classifiedObjectCount: zero, coverageBps: zero, stateCounts: {COMPLETE: zero, PARTIAL: 0, DENIED: 0, UNSUPPORTED: 0, UNKNOWN: 0}},
    entries: [], queryCoverage: [], missingPrivilegeMeansAbsent: false, evidenceStoreSchema: 'kaleidosphere.analysis/evidence-store/v1',
  };
  const coverage = seal(coverageBody, 'coverageSha256');
  return seal({
    schemaVersion: 'kaleidosphere.analysis/progressive-run/v1', runId: 'overview-run', engine: 'mssql', phase: 'REPORT', completedPhases: [],
    scope, scopeSha256, methodRegistry: {}, coverage, breadthOverride: null, budget: {}, probes: [], receipts: [],
    evidenceBinding: {structureSnapshotSha256: coverage.structureSnapshotSha256, structureCoverageSha256: coverage.structureCoverageLedgerSha256, evidenceStoreSchema: coverage.evidenceStoreSchema, canonicalHash: 'SHA-256'},
    safety: {},
  }, 'stateSha256');
}

function redigestWithNegativeZero(mutate) {
  const run = structuredClone(emptySource(0));
  mutate(run);
  const {coverageSha256: _oldCoverage, ...coverageBody} = run.coverage;
  run.coverage = seal(coverageBody, 'coverageSha256');
  const {stateSha256: _oldState, ...runBody} = run;
  return seal(runBody, 'stateSha256');
}

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
    coverageSha256: coverage.coverageSha256,
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

test('fully sealed empty run with negative-zero summary counts fails closed before projection', () => {
  const run = emptySource(-0);
  assert.equal(Object.is(run.coverage.summary.visibleObjectCount, -0), true);
  assert.equal(Object.is(run.coverage.summary.classifiedObjectCount, -0), true);
  assert.equal(Object.is(run.coverage.summary.coverageBps, -0), true);
  assert.equal(Object.is(run.coverage.summary.stateCounts.COMPLETE, -0), true);
  assert.throws(() => buildDatabaseOverviewProjection(run), /DB_OVERVIEW_UNSAFE_JSON/);
});

test('negative zero is rejected independently in every accepted numeric evidence input', () => {
  for (const mutate of [
    (run) => { run.coverage.summary.visibleObjectCount = -0; },
    (run) => { run.coverage.summary.classifiedObjectCount = -0; },
    (run) => { run.coverage.summary.coverageBps = -0; },
    (run) => { run.coverage.summary.stateCounts.COMPLETE = -0; },
    (run) => { run.coverage.summary.stateCounts.PARTIAL = -0; },
    (run) => { run.coverage.thresholdBps = -0; },
    (run) => { run.budget = {maxRelations: -0}; },
  ]) {
    const run = redigestWithNegativeZero(mutate);
    assert.throws(() => buildDatabaseOverviewProjection(run), /DB_OVERVIEW_UNSAFE_JSON/);
  }
});

test('canonical zero empty run retains a deterministic all-zero bounded aggregate and verifies', () => {
  const run = emptySource(0);
  const first = buildDatabaseOverviewProjection(run);
  const second = buildDatabaseOverviewProjection(JSON.parse(JSON.stringify(run)));
  assert.deepEqual(second, first);
  assert.deepEqual(first.countsByKind.map(({kind}) => kind), DATABASE_OVERVIEW_KINDS);
  assert.ok(first.countsByKind.every((item) => item.visibleCount === 0 && item.partialCount === 0 && item.deniedCount === 0 && item.unsupportedCount === 0 && item.unknownCount === 0));
  assert.deepEqual(first.totals, {visibleCount: 0, partialCount: 0, deniedCount: 0, unsupportedCount: 0, unknownCount: 0, totalCount: 0});
  assert.equal(Object.is(first.coverageBasisPoints, -0), false);
  assert.equal(first.coverageBasisPoints, 0);
  assert.deepEqual(first.blindSpotCodes, []);
  assert.deepEqual(first.cancellation, {state: 'NOT_CANCELLED', cancelledReceiptCount: 0, receiptCount: 0});
  assert.equal(first.bindings.receiptChainSha256.length, 64);
  assert.deepEqual(first.claims, {completeness: false, absence: false, businessTruth: false});
  assert.deepEqual(first.authority, {sqlAuthority: 'NONE', dispatchAuthority: 'NONE', mutationAuthority: 'NONE'});
  assert(!JSON.stringify(first).includes('reporting'));
  verifyDatabaseOverviewProjection(first, run);
});

test('ordinary positive mixed-coverage summary and cancellation retain the deterministic bounded projection', () => {
  const run = source({cancelled: true});
  const first = buildDatabaseOverviewProjection(run);
  const second = buildDatabaseOverviewProjection(JSON.parse(JSON.stringify(run)));
  assert.deepEqual(second, first);
  assert.deepEqual(first.countsByKind.map(({kind}) => kind), DATABASE_OVERVIEW_KINDS);
  assert.deepEqual(first.totals, {visibleCount: 2, partialCount: 1, deniedCount: 1, unsupportedCount: 1, unknownCount: 1, totalCount: 6});
  assert.equal(first.coverageBasisPoints, 8333);
  assert.deepEqual(first.cancellation, {state: 'CANCELLED', cancelledReceiptCount: 1, receiptCount: 1});
  assert.equal(first.bindings.receiptChainSha256.length, 64);
  assert.deepEqual(first.claims, {completeness: false, absence: false, businessTruth: false});
  assert.deepEqual(first.authority, {sqlAuthority: 'NONE', dispatchAuthority: 'NONE', mutationAuthority: 'NONE'});
  verifyDatabaseOverviewProjection(first, run);
});