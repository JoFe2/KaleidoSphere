import assert from 'node:assert/strict';
import test from 'node:test';

import {canonicalJson, identitySha256, normalizeJsonValue} from '../services/bi-control/src/db-analyzer/core.mjs';
import {createProgressiveCoverage} from '../services/bi-control/src/db-analyzer/progressive-controller.mjs';
import {
  projectObjectDetails,
  verifyObjectDetailsProjection,
} from '../services/bi-control/src/db-analyzer/object-details-projection-v1.mjs';

const ENGINES = ['mssql', 'oracle'];
const VISIBILITY = {COMPLETE: 'VISIBLE', PARTIAL: 'VISIBLE_PARTIAL', DENIED: 'INVISIBLE', UNSUPPORTED: 'NOT_APPLICABLE', UNKNOWN: 'UNKNOWN'};
const SCOPE = {mssql: {database: 'salesdb', container: null, schemas: ['dbo', 'finance']}, oracle: {database: 'orcl_sales', container: null, schemas: ['DBO', 'FIN']}};
const SHAPE = {COMPLETE: 'VISIBLE', PARTIAL: 'VISIBLE_PARTIAL', DENIED: 'INVISIBLE', UNSUPPORTED: 'NOT_APPLICABLE', UNKNOWN: 'UNKNOWN'};

const scopeSha256 = (engine) => identitySha256(normalizeJsonValue(SCOPE[engine]));
const snapshotOf = (engine) => identitySha256({kind: 'structure-snapshot', engine});
const preflightLedgerOf = (engine) => identitySha256({kind: 'preflight-coverage-ledger', engine});
const sourceObjectOf = (engine, relation) => identitySha256({kind: 'inventory-object', engine, relation});
const seal = (body, key) => ({...normalizeJsonValue(body), [key]: identitySha256(normalizeJsonValue(body))});

function buildLedger(engine, {state, reasonCode, schemaName = SCOPE[engine].schemas[0], relationName = 'sales_orders', sourceQueryId = `${engine}.structure-relations`, evidenceRefs}) {
  const sourceObjectSha256 = sourceObjectOf(engine, relationName);
  const refs = [...new Set(evidenceRefs ?? [snapshotOf(engine), preflightLedgerOf(engine), sourceObjectSha256])].sort();
  const objectRef = {kind: 'RELATION', schemaName, relationName, columnName: null, objectName: null, sourceObjectSha256};
  const queryState = state === 'COMPLETE' ? 'SUCCEEDED' : state === 'DENIED' ? 'DENIED' : 'PARTIAL';
  const ledger = createProgressiveCoverage({
    engine,
    structureSnapshotSha256: snapshotOf(engine),
    structureCoverageLedgerSha256: preflightLedgerOf(engine),
    entries: [{objectRef, state, reasonCode, sourceQueryId, evidenceRefs: refs}],
    queryCoverage: [{
      queryId: sourceQueryId,
      category: 'relations',
      state: queryState,
      reasonCode: state === 'COMPLETE' ? null : reasonCode,
      visibility: state === 'COMPLETE' ? 'VISIBLE_COMPLETE' : SHAPE[state],
      absenceClaim: 'NOT_CLAIMED',
    }],
  });
  return {ledger, entry: ledger.entries[0], refs};
}

function emptyLedger(engine) {
  return createProgressiveCoverage({
    engine,
    structureSnapshotSha256: snapshotOf(engine),
    structureCoverageLedgerSha256: preflightLedgerOf(engine),
    entries: [],
    queryCoverage: [],
  });
}

// Recomputes coverageSha256 over the mutated body while preserving raw values (a raw -0 must survive sealing).
function reDigestLedger(ledger, mutate) {
  const {coverageSha256: _old, ...body} = structuredClone(ledger);
  mutate(body);
  return {...body, coverageSha256: identitySha256(body)};
}

function receiptFor(engine, {entry, ledger, inventorySnapshotSha256 = snapshotOf(engine), scopeDigest = scopeSha256(engine)} = {}) {
  return seal({
    schemaVersion: 'kaleidosphere.analysis/object-details-evidence-receipt/v1', engine,
    scopeSha256: scopeDigest, inventorySnapshotSha256, coverageLedgerSha256: ledger.coverageSha256,
    objectKey: entry.objectKey, coverageEntrySha256: identitySha256(entry),
    evidenceRefs: [...entry.evidenceRefs].sort(),
  }, 'receiptSha256');
}

function inputsFor(engine, {entry, ledger, scope = SCOPE[engine], scopeSha256: boundScopeSha256 = scopeSha256(engine), inventorySnapshotSha256 = snapshotOf(engine), receipt = entry && ledger ? receiptFor(engine, {entry, ledger, inventorySnapshotSha256, scopeDigest: boundScopeSha256}) : null, objectKey = entry?.objectKey ?? identitySha256({missing: 'coverage-entry'}), coverageLedger = ledger, extra = {}} = {}) {
  return {
    engine,
    scope,
    scopeSha256: boundScopeSha256,
    inventorySnapshotSha256,
    coverageLedger,
    receipt,
    objectKey,
    ...extra,
  };
}

function expectCode(action, code) {
  assert.throws(action, (error) => error.code === code, code);
}

function rawEntry({engine, relationName = 'sales_orders', schemaName = SCOPE[engine].schemas[0]}) {
  const objectRef = {kind: 'RELATION', schemaName, relationName, columnName: null, objectName: null, sourceObjectSha256: sourceObjectOf(engine, relationName)};
  return {
    objectKey: identitySha256(objectRef),
    objectRef,
    state: 'COMPLETE',
    reasonCode: null,
    sourceQueryId: `${engine}.structure-relations`,
    evidenceRefs: [...new Set([snapshotOf(engine), preflightLedgerOf(engine), sourceObjectOf(engine, relationName)])].sort(),
    absenceClaim: 'NOT_CLAIMED',
  };
}

function ledgerWithEntry(ledger, entry) {
  const {coverageSha256: _old, ...body} = structuredClone(ledger);
  body.entries = [entry];
  return seal(body, 'coverageSha256');
}

test('fully re-digested ledger with negative-zero UNKNOWN state count fails closed before projection', () => {
  for (const engine of ENGINES) {
    const {ledger, entry} = buildLedger(engine, {state: 'COMPLETE', reasonCode: null});
    const forged = reDigestLedger(ledger, (value) => { value.summary.stateCounts.UNKNOWN = -0; });
    assert.ok(Object.is(forged.summary.stateCounts.UNKNOWN, -0), 'raw negative zero survives sealing');
    const {coverageSha256, ...forgedBody} = forged;
    assert.equal(coverageSha256, identitySha256(forgedBody), 'recomputed ledger digest is valid');
    const receipt = receiptFor(engine, {entry, ledger: forged});
    expectCode(() => projectObjectDetails(inputsFor(engine, {entry, ledger: forged, receipt})), 'DB_OBJECT_DETAILS_COVERAGE_LEDGER_INVALID');
    expectCode(() => projectObjectDetails(inputsFor(engine, {entry, ledger: forged})), 'DB_OBJECT_DETAILS_COVERAGE_LEDGER_INVALID');
  }
});

test('negative zero is rejected independently in every arithmetically consistent summary slot', () => {
  const engine = 'mssql';
  const {ledger, entry} = buildLedger(engine, {state: 'COMPLETE', reasonCode: null});
  for (const state of ['PARTIAL', 'DENIED', 'UNSUPPORTED', 'UNKNOWN']) {
    const forged = reDigestLedger(ledger, (value) => { value.summary.stateCounts[state] = -0; });
    assert.ok(Object.is(forged.summary.stateCounts[state], -0), `raw negative zero in ${state}`);
    expectCode(() => projectObjectDetails(inputsFor(engine, {entry, ledger: forged})), 'DB_OBJECT_DETAILS_COVERAGE_LEDGER_INVALID');
  }
  const blank = emptyLedger(engine);
  for (const field of ['visibleObjectCount', 'classifiedObjectCount', 'coverageBps']) {
    const forged = reDigestLedger(blank, (value) => { value.summary[field] = -0; });
    assert.ok(Object.is(forged.summary[field], -0), `raw negative zero in ${field}`);
    expectCode(() => projectObjectDetails(inputsFor(engine, {ledger: forged})), 'DB_OBJECT_DETAILS_COVERAGE_LEDGER_INVALID');
  }
});

test('canonical zero and safe positive counts retain exact MSSQL/Oracle details, digest and readback', () => {
  const cases = [
    {state: 'COMPLETE', reasonCode: null},
    {state: 'PARTIAL', reasonCode: 'PARTIAL_ROW_LIMIT'},
    {state: 'DENIED', reasonCode: 'PRIVILEGE_DENIED'},
  ];
  for (const engine of ENGINES) {
    for (const {state, reasonCode} of cases) {
      const {ledger, entry, refs} = buildLedger(engine, {state, reasonCode});
      assert.equal(ledger.summary.stateCounts[state], 1, 'safe positive count');
      assert.equal(ledger.summary.stateCounts.UNKNOWN, 0, 'canonical zero count');
      assert.ok(Object.values(ledger.summary.stateCounts).every((count) => !Object.is(count, -0)), 'no negative zero in canonical summary');
      const input = inputsFor(engine, {entry, ledger});
      const receipt = receiptFor(engine, {entry, ledger});
      const projection = projectObjectDetails(input);
      assert.equal(projection.engine, engine);
      assert.equal(projection.objectKey, entry.objectKey);
      assert.equal(projection.objectKind, 'RELATION');
      assert.equal(projection.identifierShape, 'SCHEMA_RELATION');
      assert.deepEqual(projection.identifiers, {schemaName: SCOPE[engine].schemas[0], relationName: 'sales_orders', columnName: null, objectName: null});
      assert.equal(projection.coverage.state, state);
      assert.equal(projection.coverage.reasonCode, reasonCode);
      assert.equal(projection.coverage.visibility, VISIBILITY[state]);
      assert.equal(projection.coverage.absenceClaim, 'NOT_CLAIMED');
      assert.deepEqual(projection.evidenceRefs, refs);
      assert.equal(projection.bindings.scopeSha256, scopeSha256(engine));
      assert.equal(projection.bindings.inventorySnapshotSha256, snapshotOf(engine));
      assert.equal(projection.bindings.coverageLedgerSha256, ledger.coverageSha256);
      assert.equal(projection.bindings.receiptSha256, receipt.receiptSha256);
      assert.equal(projection.bindings.coverageEntrySha256, identitySha256(entry));
      const {projectionSha256, ...body} = projection;
      assert.equal(projectionSha256, identitySha256(body), 'recomputed projection digest');
      assert.equal(canonicalJson(projectObjectDetails(input)), canonicalJson(projection), 'deterministic repeat');
      for (const flag of Object.values(projection.safety)) assert.equal(flag, false, 'explicit non-completeness');
      verifyObjectDetailsProjection(projection, input);
    }
  }
});

test('retains fail-closed denials for unsafe, non-finite, inconsistent, missing, tampered, injected and unknown fields', () => {
  const engine = 'mssql';
  const {ledger, entry} = buildLedger(engine, {state: 'COMPLETE', reasonCode: null});

  const nonFinite = structuredClone(ledger);
  nonFinite.summary.coverageBps = Number.NaN;
  expectCode(() => projectObjectDetails(inputsFor(engine, {entry, ledger: nonFinite})), 'DB_CANONICAL_NUMBER_INVALID');

  expectCode(() => projectObjectDetails(inputsFor(engine, {entry, ledger: reDigestLedger(ledger, (value) => { value.summary.stateCounts.COMPLETE = 2; })})), 'DB_OBJECT_DETAILS_COVERAGE_LEDGER_INVALID');
  expectCode(() => projectObjectDetails(inputsFor(engine, {entry, ledger: reDigestLedger(ledger, (value) => { delete value.summary; })})), 'DB_OBJECT_DETAILS_COVERAGE_LEDGER_INVALID');
  expectCode(() => projectObjectDetails(inputsFor(engine, {entry, ledger: {...structuredClone(ledger), thresholdBps: 9400}})), 'DB_OBJECT_DETAILS_COVERAGE_LEDGER_TAMPERED');
  const injected = rawEntry({engine, relationName: 'sales--orders'});
  expectCode(() => projectObjectDetails(inputsFor(engine, {entry: injected, ledger: ledgerWithEntry(ledger, injected), objectKey: injected.objectKey})), 'DB_OBJECT_DETAILS_IDENTIFIER_INVALID');
  expectCode(() => projectObjectDetails(inputsFor(engine, {entry, ledger, extra: {hint: 'select 1'}})), 'DB_OBJECT_DETAILS_INPUT_INVALID');
  expectCode(() => projectObjectDetails(inputsFor(engine, {entry, ledger, objectKey: identitySha256({substituted: true})})), 'DB_OBJECT_DETAILS_COVERAGE_MISSING');
  expectCode(() => projectObjectDetails(inputsFor(engine, {entry, ledger, scopeSha256: identitySha256({stale: true})})), 'DB_OBJECT_DETAILS_BINDING_DRIFT');
});

test('retains D-017 substitution, claim-bearing identifiers, fully re-digested forgeries and authority denials', () => {
  const engine = 'mssql';
  const {ledger, entry} = buildLedger(engine, {state: 'COMPLETE', reasonCode: null});

  for (const [relationName, code] of [
    ['sales_orders_verified', 'DB_OBJECT_DETAILS_IDENTIFIER_CLAIM'],
    ['select', 'DB_OBJECT_DETAILS_IDENTIFIER_INVALID'],
    ['password_orders', 'DB_OBJECT_DETAILS_IDENTIFIER_INVALID'],
    ['return_url_orders', 'DB_OBJECT_DETAILS_IDENTIFIER_INVALID'],
    ['dispatch_authority_orders', 'DB_OBJECT_DETAILS_IDENTIFIER_INVALID'],
  ]) {
    const claimed = rawEntry({engine, relationName});
    expectCode(() => projectObjectDetails(inputsFor(engine, {entry: claimed, ledger: ledgerWithEntry(ledger, claimed), objectKey: claimed.objectKey})), code);
  }

  const unrelated = buildLedger(engine, {state: 'COMPLETE', reasonCode: null, relationName: 'other_orders'});
  expectCode(() => projectObjectDetails(inputsFor(engine, {
    entry, ledger: unrelated.ledger, objectKey: entry.objectKey,
    receipt: receiptFor(engine, {entry: unrelated.entry, ledger: unrelated.ledger}),
  })), 'DB_OBJECT_DETAILS_COVERAGE_MISSING');
  expectCode(() => projectObjectDetails(inputsFor(engine, {
    entry, ledger, receipt: receiptFor(engine, {entry: unrelated.entry, ledger: unrelated.ledger}),
  })), 'DB_OBJECT_DETAILS_RECEIPT_BINDING_INVALID');

  const projection = projectObjectDetails(inputsFor(engine, {entry, ledger}));
  expectCode(() => verifyObjectDetailsProjection(projection, inputsFor(engine, {entry, ledger, receipt: {...receiptFor(engine, {entry, ledger}), receiptSha256: identitySha256({stale: 'receipt'})}})), 'DB_OBJECT_DETAILS_FORGED');
  const forgedBody = {...projection, coverage: {...projection.coverage, visibility: 'EXHAUSTIVE'}};
  expectCode(() => verifyObjectDetailsProjection({...forgedBody, projectionSha256: identitySha256(forgedBody)}, inputsFor(engine, {entry, ledger})), 'DB_OBJECT_DETAILS_FORGED');
});