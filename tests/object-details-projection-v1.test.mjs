import assert from 'node:assert/strict';
import test from 'node:test';

import {canonicalJson, identitySha256, normalizeJsonValue} from '../services/bi-control/src/db-analyzer/core.mjs';
import {createProgressiveCoverage} from '../services/bi-control/src/db-analyzer/progressive-controller.mjs';
import {
  OBJECT_DETAILS_PROJECTION_SCHEMA,
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

function expectedEnvelope(input, entry) {
  const ref = entry.objectRef;
  return {
    schemaVersion: OBJECT_DETAILS_PROJECTION_SCHEMA,
    projectionKind: 'OBJECT_DETAILS',
    engine: input.engine,
    objectKey: input.objectKey,
    objectKind: ref.kind,
    identifiers: {schemaName: ref.schemaName, relationName: ref.relationName, columnName: ref.columnName, objectName: ref.objectName},
    identifierShape: ref.columnName !== null ? 'SCHEMA_RELATION_COLUMN'
      : ref.relationName !== null ? 'SCHEMA_RELATION'
        : ref.objectName !== null ? 'SCHEMA_OBJECT' : 'SCHEMA_ONLY',
    sourceObjectSha256: ref.sourceObjectSha256,
    coverage: {state: entry.state, reasonCode: entry.reasonCode, visibility: VISIBILITY[entry.state], absenceClaim: 'NOT_CLAIMED'},
    evidenceRefs: [...entry.evidenceRefs].sort(),
    bindings: {
      scopeSha256: input.scopeSha256,
      inventorySnapshotSha256: input.inventorySnapshotSha256,
      coverageLedgerSha256: input.coverageLedger.coverageSha256 ?? identitySha256(input.coverageLedger),
      receiptSha256: input.receipt.receiptSha256 ?? identitySha256(input.receipt),
      coverageEntrySha256: identitySha256(entry),
    },
    safety: {
      rawValuesIncluded: false,
      credentialsIncluded: false,
      freeSqlAccepted: false,
      dispatchAuthority: false,
      approvalAuthority: false,
      executionAuthority: false,
      mutationAuthority: false,
      cancellationBypass: false,
      completenessClaimed: false,
      missingPrivilegeMeansAbsent: false,
    },
  };
}

test('canonical visible relation coverage entry yields exact OBJECT_DETAILS bytes and recomputed projection digest', () => {
  for (const engine of ENGINES) {
    const {ledger, entry, refs} = buildLedger(engine, {state: 'COMPLETE', reasonCode: null});
    const input = inputsFor(engine, {entry, ledger});
    const projection = projectObjectDetails(input);
    const expected = expectedEnvelope(input, entry);
    const {projectionSha256, ...projectionBody} = projection;
    assert.equal(projectionSha256, identitySha256(projectionBody), 'recomputed projection digest');
    expected.projectionSha256 = identitySha256(expected);
    assert.equal(canonicalJson(projection), canonicalJson(expected), `exact OBJECT_DETAILS bytes for ${engine}`);
    assert.deepEqual(projection.evidenceRefs, refs);
    assert.equal(projection.objectKind, 'RELATION');
    assert.equal(projection.coverage.state, 'COMPLETE');
    assert.equal(projection.coverage.reasonCode, null);
    assert.equal(projection.coverage.visibility, 'VISIBLE');
    assert.equal(projection.coverage.absenceClaim, 'NOT_CLAIMED');
    assert.equal(canonicalJson(projectObjectDetails(input)), canonicalJson(projection), 'deterministic repeat');
    for (const nested of [projection, projection.identifiers, projection.coverage, projection.bindings, projection.safety]) {
      assert.ok(Object.isFrozen(nested), 'deeply frozen');
    }
    verifyObjectDetailsProjection(projection, input);
  }
});

test('canonical DENIED coverage entry yields fixed denial metadata with NOT_CLAIMED absence and no fabricated facts', () => {
  for (const engine of ENGINES) {
    const {ledger, entry} = buildLedger(engine, {state: 'DENIED', reasonCode: 'PRIVILEGE_DENIED'});
    const input = inputsFor(engine, {entry, ledger});
    const projection = projectObjectDetails(input);
    assert.equal(projection.coverage.state, 'DENIED');
    assert.equal(projection.coverage.reasonCode, 'PRIVILEGE_DENIED');
    assert.equal(projection.coverage.visibility, 'INVISIBLE');
    assert.equal(projection.coverage.absenceClaim, 'NOT_CLAIMED');
    assert.equal(projection.safety.completenessClaimed, false);
    assert.equal(projection.safety.missingPrivilegeMeansAbsent, false);
    assert.equal(projection.safety.rawValuesIncluded, false);
    const bytes = canonicalJson(projection);
    assert.doesNotMatch(bytes, /"rows"|"rawValues"|"sampleValues"|https?:\/\//);
    for (const flag of Object.values(projection.safety)) assert.equal(flag, false);
    assert.deepEqual(Object.keys(projection).sort(), [
      'bindings', 'coverage', 'evidenceRefs', 'engine', 'identifierShape', 'identifiers', 'objectKey', 'objectKind',
      'projectionKind', 'projectionSha256', 'safety', 'schemaVersion', 'sourceObjectSha256',
    ].sort());
    verifyObjectDetailsProjection(projection, input);
  }
});

test('PARTIAL and UNKNOWN coverage remain explicit without fabricated completeness', () => {
  const {ledger, entry} = buildLedger('mssql', {state: 'PARTIAL', reasonCode: 'PARTIAL_ROW_LIMIT'});
  const input = inputsFor('mssql', {entry, ledger});
  const projection = projectObjectDetails(input);
  assert.equal(projection.coverage.state, 'PARTIAL');
  assert.equal(projection.coverage.reasonCode, 'PARTIAL_ROW_LIMIT');
  assert.equal(projection.coverage.visibility, 'VISIBLE_PARTIAL');
  assert.equal(projection.safety.completenessClaimed, false);
});

test('rejects substitution, drift, injection, unknown fields and other fail-closed violations', () => {
  const engine = 'mssql';
  const {ledger, entry} = buildLedger(engine, {state: 'COMPLETE', reasonCode: null});
  const input = inputsFor(engine, {entry, ledger});

  expectCode(() => projectObjectDetails(inputsFor(engine, {entry, ledger, objectKey: identitySha256({substituted: true})})), 'DB_OBJECT_DETAILS_COVERAGE_MISSING');
  const escaped = buildLedger(engine, {state: 'COMPLETE', reasonCode: null, schemaName: 'hr'});
  expectCode(() => projectObjectDetails(inputsFor(engine, {entry: escaped.entry, ledger: escaped.ledger})), 'DB_OBJECT_DETAILS_SCOPE_DENIED');
  const injected = rawEntry({engine, relationName: 'sales--orders'});
  expectCode(() => projectObjectDetails(inputsFor(engine, {entry: injected, ledger: ledgerWithEntry(ledger, injected), objectKey: injected.objectKey})), 'DB_OBJECT_DETAILS_IDENTIFIER_INVALID');
  const claimed = rawEntry({engine, relationName: 'sales_orders_verified'});
  expectCode(() => projectObjectDetails(inputsFor(engine, {entry: claimed, ledger: ledgerWithEntry(ledger, claimed), objectKey: claimed.objectKey})), 'DB_OBJECT_DETAILS_IDENTIFIER_CLAIM');
  const oversized = rawEntry({engine, relationName: `s_${'x'.repeat(127)}`});
  expectCode(() => projectObjectDetails(inputsFor(engine, {entry: oversized, ledger: ledgerWithEntry(ledger, oversized), objectKey: oversized.objectKey})), 'DB_OBJECT_DETAILS_IDENTIFIER_INVALID');
  const substitutedRef = rawEntry({engine});
  substitutedRef.objectRef.relationName = 'other_orders';
  expectCode(() => projectObjectDetails(inputsFor(engine, {entry: substitutedRef, ledger: ledgerWithEntry(ledger, substitutedRef), objectKey: substitutedRef.objectKey})), 'DB_OBJECT_DETAILS_KEY_MISMATCH');
  expectCode(() => projectObjectDetails(inputsFor(engine, {entry, ledger, objectKey: identitySha256({missing: 'coverage-entry'})})), 'DB_OBJECT_DETAILS_COVERAGE_MISSING');
  expectCode(() => projectObjectDetails(inputsFor(engine, {entry, ledger, extra: {hint: 'select 1'}})), 'DB_OBJECT_DETAILS_INPUT_INVALID');
  expectCode(() => projectObjectDetails(inputsFor(engine, {entry, ledger, scopeSha256: identitySha256({stale: true})})), 'DB_OBJECT_DETAILS_BINDING_DRIFT');
  const drifted = buildLedger(engine, {
    state: 'COMPLETE',
    reasonCode: null,
    evidenceRefs: [identitySha256({drifted: 'snapshot'}), preflightLedgerOf(engine), sourceObjectOf(engine, 'sales_orders')],
  });
  expectCode(() => projectObjectDetails(inputsFor(engine, {entry: drifted.entry, ledger: drifted.ledger})), 'DB_OBJECT_DETAILS_EVIDENCE_DRIFT');
  const duplicated = rawEntry({engine});
  duplicated.evidenceRefs = [snapshotOf(engine), snapshotOf(engine), preflightLedgerOf(engine)];
  expectCode(() => projectObjectDetails(inputsFor(engine, {entry: duplicated, ledger: ledgerWithEntry(ledger, duplicated), objectKey: duplicated.objectKey})), 'DB_OBJECT_DETAILS_EVIDENCE_INVALID');
  const oversizedEvidence = rawEntry({engine});
  oversizedEvidence.evidenceRefs = [...Array.from({length: 17}, (_value, index) => identitySha256({evidence: index}))];
  expectCode(() => projectObjectDetails(inputsFor(engine, {entry: oversizedEvidence, ledger: ledgerWithEntry(ledger, oversizedEvidence), objectKey: identitySha256(oversizedEvidence.objectRef)})), 'DB_OBJECT_DETAILS_EVIDENCE_INVALID');
});

test('rejects stale or tampered receipt bindings and a fully re-digested forged details envelope', () => {
  const engine = 'mssql';
  const {ledger, entry} = buildLedger(engine, {state: 'COMPLETE', reasonCode: null});
  const input = inputsFor(engine, {entry, ledger});
  const projection = projectObjectDetails(input);

  expectCode(() => verifyObjectDetailsProjection(projection, inputsFor(engine, {entry, ledger, receipt: {...receiptFor(engine, {entry, ledger}), receiptSha256: identitySha256({stale: 'receipt'})}})), 'DB_OBJECT_DETAILS_FORGED');
  const unrelated = buildLedger(engine, {state: 'COMPLETE', reasonCode: null, relationName: 'other_orders'});
  expectCode(() => verifyObjectDetailsProjection(projection, inputsFor(engine, {entry: unrelated.entry, ledger: unrelated.ledger, objectKey: entry.objectKey})), 'DB_OBJECT_DETAILS_FORGED');
  const tamperedEntry = {...entry, reasonCode: 'PRIVILEGE_DENIED'};
  expectCode(() => verifyObjectDetailsProjection(projection, inputsFor(engine, {entry: tamperedEntry, ledger, objectKey: entry.objectKey})), 'DB_OBJECT_DETAILS_FORGED');
  expectCode(() => verifyObjectDetailsProjection({...projection, coverage: {...projection.coverage, visibility: 'EXHAUSTIVE'}}, input), 'DB_OBJECT_DETAILS_FORGED');
  const forgedBody = {...projection, coverage: {...projection.coverage, visibility: 'EXHAUSTIVE'}};
  delete forgedBody.projectionSha256;
  const forged = {...forgedBody, projectionSha256: identitySha256(forgedBody)};
  expectCode(() => verifyObjectDetailsProjection(forged, input), 'DB_OBJECT_DETAILS_FORGED');
  expectCode(() => verifyObjectDetailsProjection({forged: true}, input), 'DB_OBJECT_DETAILS_FORGED');
});

test('accepts recomputable evidence bodies and rejects re-digested unrelated ledger or receipt evidence', () => {
  const engine = 'mssql';
  const {ledger, entry} = buildLedger(engine, {state: 'COMPLETE', reasonCode: null});
  const receipt = receiptFor(engine, {entry, ledger});
  const {coverageSha256: _coverage, ...ledgerBody} = ledger;
  const {receiptSha256: _receipt, ...receiptBody} = receipt;
  assert.doesNotThrow(() => projectObjectDetails(inputsFor(engine, {entry, ledger: ledgerBody, receipt: receiptBody})));

  const unrelated = buildLedger(engine, {state: 'COMPLETE', reasonCode: null, relationName: 'other_orders'});
  expectCode(() => projectObjectDetails(inputsFor(engine, {
    entry, ledger: unrelated.ledger, objectKey: entry.objectKey,
    receipt: receiptFor(engine, {entry: unrelated.entry, ledger: unrelated.ledger}),
  })), 'DB_OBJECT_DETAILS_COVERAGE_MISSING');
  expectCode(() => projectObjectDetails(inputsFor(engine, {
    entry, ledger, receipt: receiptFor(engine, {entry: unrelated.entry, ledger: unrelated.ledger}),
  })), 'DB_OBJECT_DETAILS_RECEIPT_BINDING_INVALID');
});
