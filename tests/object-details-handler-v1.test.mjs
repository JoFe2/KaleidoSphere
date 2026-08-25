import assert from 'node:assert/strict';
import test from 'node:test';

import {canonicalJson, identitySha256, normalizeJsonValue} from '../services/bi-control/src/db-analyzer/core.mjs';
import {runCapabilityAdversarialMatrixV1} from './helpers/object-capability-adversarial-matrix-v1.mjs';
import {createProgressiveCoverage} from '../services/bi-control/src/db-analyzer/progressive-controller.mjs';
import {
  KS_OBJECT_CAPABILITY_RESULT_SCHEMA,
  buildObjectCapabilityContractV1,
} from '../services/bi-agent/src/object-capability-contract-v1.mjs';
import {
  OBJECT_DETAILS_PROJECTION_SCHEMA,
  projectObjectDetails,
  verifyObjectDetailsProjection,
} from '../services/bi-control/src/db-analyzer/object-details-projection-v1.mjs';
import {
  KS_OBJECT_DETAILS_HANDLER_CAPABILITY,
  KS_OBJECT_DETAILS_HANDLER_FAIL_CLOSED_CODES,
  handleObjectDetailsV1,
} from '../services/bi-agent/src/object-details-handler-v1.mjs';

const H = (character) => character.repeat(64);
const ENGINES = ['mssql', 'oracle'];
const SCOPES = {
  mssql: {database: 'salesdb', container: null, schemas: ['dbo', 'finance']},
  oracle: {database: 'orcl_sales', container: null, schemas: ['DBO', 'FIN']},
};
const STATES = {
  COMPLETE: {state: 'COMPLETE', reasonCode: null},
  DENIED: {state: 'DENIED', reasonCode: 'PRIVILEGE_DENIED'},
  PARTIAL: {state: 'PARTIAL', reasonCode: 'PARTIAL_ROW_LIMIT'},
  UNKNOWN: {state: 'UNKNOWN', reasonCode: 'OBJECT_NOT_FOUND'},
};
const VISIBILITY = {COMPLETE: 'VISIBLE', DENIED: 'INVISIBLE', PARTIAL: 'VISIBLE_PARTIAL', UNKNOWN: 'UNKNOWN'};
const RESULT_KEYS = ['authority', 'bindings', 'capabilityId', 'claims', 'projectionSha256', 'requestSha256', 'schemaVersion', 'state'];

const scopeSha256Of = (engine) => identitySha256(normalizeJsonValue(SCOPES[engine]));
const snapshotOf = (engine) => identitySha256({kind: 'structure-snapshot', engine});
const preflightLedgerOf = (engine) => identitySha256({kind: 'preflight-coverage-ledger', engine});
const sourceObjectOf = (engine, relation) => identitySha256({kind: 'inventory-object', engine, relation});
const seal = (body, key) => ({...normalizeJsonValue(body), [key]: identitySha256(normalizeJsonValue(body))});

function buildLedger(engine, spec, {relationName = 'sales_orders'} = {}) {
  const sourceObjectSha256 = sourceObjectOf(engine, relationName);
  const refs = [...new Set([snapshotOf(engine), preflightLedgerOf(engine), sourceObjectSha256])].sort();
  const objectRef = {kind: 'RELATION', schemaName: SCOPES[engine].schemas[0], relationName, columnName: null, objectName: null, sourceObjectSha256};
  const queryState = spec.state === 'COMPLETE' ? 'SUCCEEDED' : spec.state === 'DENIED' ? 'DENIED' : 'PARTIAL';
  const ledger = createProgressiveCoverage({
    engine,
    structureSnapshotSha256: snapshotOf(engine),
    structureCoverageLedgerSha256: preflightLedgerOf(engine),
    entries: [{objectRef, state: spec.state, reasonCode: spec.reasonCode, sourceQueryId: `${engine}.structure-relations`, evidenceRefs: refs}],
    queryCoverage: [{
      queryId: `${engine}.structure-relations`, category: 'relations', state: queryState,
      reasonCode: spec.state === 'COMPLETE' ? null : spec.reasonCode,
      visibility: spec.state === 'COMPLETE' ? 'VISIBLE_COMPLETE' : VISIBILITY[spec.state], absenceClaim: 'NOT_CLAIMED',
    }],
  });
  return {ledger, entry: ledger.entries[0]};
}

function receiptFor(engine, {entry, ledger}) {
  return seal({
    schemaVersion: 'kaleidosphere.analysis/object-details-evidence-receipt/v1', engine,
    scopeSha256: scopeSha256Of(engine), inventorySnapshotSha256: snapshotOf(engine), coverageLedgerSha256: ledger.coverageSha256,
    objectKey: entry.objectKey, coverageEntrySha256: identitySha256(entry), evidenceRefs: [...entry.evidenceRefs].sort(),
  }, 'receiptSha256');
}

function projectionInputFor(engine, {entry, ledger, receipt = receiptFor(engine, {entry, ledger}), objectKey = entry.objectKey, scope = SCOPES[engine], scopeSha256 = scopeSha256Of(engine), inventorySnapshotSha256 = snapshotOf(engine), ...extra} = {}) {
  return {engine, scope, scopeSha256, inventorySnapshotSha256, coverageLedger: ledger, receipt, objectKey, ...extra};
}

function detailsBindings(projection) {
  return {
    engine: projection.engine,
    snapshotSha256: projection.bindings.inventorySnapshotSha256,
    receiptSha256: projection.bindings.receiptSha256,
    coverageSha256: projection.bindings.coverageLedgerSha256,
  };
}

function scenarioFor(engine, spec) {
  const {ledger, entry} = buildLedger(engine, spec);
  const receipt = receiptFor(engine, {entry, ledger});
  const projectionInput = projectionInputFor(engine, {entry, ledger, receipt});
  const projection = projectObjectDetails(projectionInput);
  const request = {
    schemaVersion: 'kaleidosphere.object-capabilities/request/v1',
    requestId: `request-${engine}-${spec.state.toLowerCase()}`,
    capabilityId: KS_OBJECT_DETAILS_HANDLER_CAPABILITY,
    bindings: detailsBindings(projection),
    scope: {schemas: [...SCOPES[engine].schemas]},
  };
  return {ledger, entry, receipt, projectionInput, request, projection};
}

function rawEntry({engine = 'mssql', relationName = 'sales_orders', schemaName = SCOPES.mssql.schemas[0], evidenceRefs} = {}) {
  const objectRef = {kind: 'RELATION', schemaName, relationName, columnName: null, objectName: null, sourceObjectSha256: sourceObjectOf(engine, relationName)};
  return {
    objectKey: identitySha256(objectRef), objectRef, state: 'COMPLETE', reasonCode: null,
    sourceQueryId: `${engine}.structure-relations`,
    evidenceRefs: evidenceRefs ?? [...new Set([snapshotOf(engine), preflightLedgerOf(engine), sourceObjectOf(engine, relationName)])].sort(),
    absenceClaim: 'NOT_CLAIMED',
  };
}

function ledgerWithEntry(ledger, entry) {
  const {coverageSha256: _old, ...body} = structuredClone(ledger);
  body.entries = [entry];
  return seal(body, 'coverageSha256');
}

function expectCode(action, code) {
  assert.throws(action, (error) => error.code === code, code);
}

function assertDeeplyFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  assert.ok(Object.isFrozen(value));
  for (const nested of Object.values(value)) assertDeeplyFrozen(nested);
}

test('M2.3 details handler derives exact MSSQL/Oracle profiles and returns deterministic isolated read-only projections', () => {
  for (const engine of ENGINES) {
    for (const [name, spec] of Object.entries(STATES)) {
      const {projectionInput, request, projection} = scenarioFor(engine, spec);
      const result = handleObjectDetailsV1(request, projectionInput);
      assert.equal(result.schemaVersion, KS_OBJECT_CAPABILITY_RESULT_SCHEMA);
      assert.equal(result.state, 'PROJECTED_READ_ONLY');
      assert.equal(result.capabilityId, KS_OBJECT_DETAILS_HANDLER_CAPABILITY);
      assert.equal(result.requestSha256, identitySha256(normalizeJsonValue(request)));
      assert.equal(result.projectionSha256, projection.projectionSha256);
      assert.deepEqual(result.bindings, detailsBindings(projection));
      assert.notEqual(result.bindings, request.bindings);
      assert.deepEqual(Object.keys(result).sort(), RESULT_KEYS);
      assert.ok([...Object.values(result.claims), ...Object.values(result.authority)].every((flag) => flag === false));
      verifyObjectDetailsProjection(projection, projectionInput);
      assert.equal(projection.schemaVersion, OBJECT_DETAILS_PROJECTION_SCHEMA);
      assert.equal(projection.coverage.state, spec.state, `${engine} ${name}`);
      assertDeeplyFrozen(result);
      assert.equal(canonicalJson(handleObjectDetailsV1(request, projectionInput)), canonicalJson(result));
    }
  }
});

test('M2.3 handler exports the closed read-only details capability and no dispatch code', () => {
  assert.equal(KS_OBJECT_DETAILS_HANDLER_CAPABILITY, 'bi.object.details.read');
  assert.ok(Object.isFrozen(KS_OBJECT_DETAILS_HANDLER_FAIL_CLOSED_CODES));
  assert.ok(!KS_OBJECT_DETAILS_HANDLER_FAIL_CLOSED_CODES.includes('KS_OBJECT_DETAILS_HANDLER_DISPATCH_INCLUDED'));
});

test('M2.3 rejects capability, scope and every capability-profile binding substitution against unchanged authority', () => {
  const {projectionInput, request} = scenarioFor('mssql', STATES.COMPLETE);
  expectCode(() => handleObjectDetailsV1({...request, capabilityId: 'bi.object.search.read'}, projectionInput), 'KS_OBJECT_CAPABILITY_REQUEST_IDENTITY_DENIED');
  const substitutions = [
    ['scope', {schemas: ['other']}],
    ...Object.keys(request.bindings).filter((key) => key !== 'engine').map((key) => [key, H('0')]),
  ];
  for (const [key, value] of substitutions) {
    const substituted = key === 'scope'
      ? {...request, scope: value}
      : {...request, bindings: {...request.bindings, [key]: value}};
    assert.throws(() => handleObjectDetailsV1(substituted, projectionInput), /KS_OBJECT_CAPABILITY_(?:SCOPE|BINDING)_DENIED/);
  }
  assert.throws(() => handleObjectDetailsV1({...request, bindings: {...request.bindings, cancellationSha256: H('7')}}, projectionInput), /KS_OBJECT_CAPABILITY_BINDING_DENIED/);
});

test('M2.3 rejects unsafe request fields, projection substitution, identifiers, oversized evidence and stale receipt bindings', () => {
  const {ledger, entry, request, projectionInput} = scenarioFor('mssql', STATES.COMPLETE);
  for (const [field, value] of [['sql', 'SELECT 1'], ['credentials', 'secret'], ['rawRows', []], ['callback', 'https://evil.invalid']]) {
    expectCode(() => handleObjectDetailsV1({...request, [field]: value}, projectionInput), 'KS_OBJECT_CAPABILITY_REQUEST_SURFACE_DENIED');
  }
  const withEntry = (next) => projectionInputFor('mssql', {entry: next, ledger: ledgerWithEntry(ledger, next)});
  expectCode(() => handleObjectDetailsV1(request, withEntry(rawEntry({relationName: 'sales--orders'}))), 'DB_OBJECT_DETAILS_IDENTIFIER_INVALID');
  expectCode(() => handleObjectDetailsV1(request, withEntry(rawEntry({relationName: 'sales_orders_verified'}))), 'DB_OBJECT_DETAILS_IDENTIFIER_CLAIM');
  const oversized = rawEntry({});
  oversized.evidenceRefs = Array.from({length: 17}, (_, index) => identitySha256({evidence: index}));
  expectCode(() => handleObjectDetailsV1(request, withEntry(oversized)), 'DB_OBJECT_DETAILS_EVIDENCE_INVALID');
  expectCode(() => handleObjectDetailsV1(request, {...projectionInput, objectKey: identitySha256({missing: true})}), 'DB_OBJECT_DETAILS_COVERAGE_MISSING');
  const unrelated = buildLedger('mssql', STATES.COMPLETE, {relationName: 'other_orders'});
  expectCode(() => handleObjectDetailsV1(request, projectionInputFor('mssql', {
    entry, ledger, receipt: receiptFor('mssql', {entry: unrelated.entry, ledger: unrelated.ledger}),
  })), 'DB_OBJECT_DETAILS_RECEIPT_BINDING_INVALID');
  expectCode(() => handleObjectDetailsV1(request, {...projectionInput, hint: 'select 1'}), 'DB_OBJECT_DETAILS_INPUT_INVALID');
});

test('M2.3 rejects fully re-digested forged details evidence and every result authority widening', () => {
  const {projectionInput, request, projection} = scenarioFor('mssql', STATES.COMPLETE);
  const {projectionSha256: _old, ...body} = {...projection, coverage: {...projection.coverage, visibility: 'EXHAUSTIVE'}};
  const forged = {...body, projectionSha256: identitySha256(body)};
  expectCode(() => verifyObjectDetailsProjection(forged, projectionInput), 'DB_OBJECT_DETAILS_FORGED');

  const result = handleObjectDetailsV1(request, projectionInput);
  const expected = {
    capabilityId: result.capabilityId,
    requestSha256: result.requestSha256,
    projectionSha256: result.projectionSha256,
    bindings: detailsBindings(projection),
  };
  const {validateResult} = buildObjectCapabilityContractV1();
  assert.deepEqual(validateResult(result, expected), result);
  for (const changed of [
    {...result, claims: {...result.claims, completenessClaimed: true}},
    {...result, claims: {...result.claims, sourceRowsIncluded: true}},
    {...result, authority: {...result.authority, dispatchAuthority: true}},
    {...result, authority: {...result.authority, executionAuthority: true}},
    {...result, authority: {...result.authority, mutationAuthority: true}},
    {...result, authority: {...result.authority, sqlAuthority: true}},
    {...result, authority: {...result.authority, rawValuesIncluded: true}},
  ]) assert.throws(() => validateResult(changed, expected));
});

test('M2.3 rejects Proxy, accessor, hidden and symbol request surfaces before traps execute', () => {
  const {projectionInput, request} = scenarioFor('mssql', STATES.COMPLETE);
  let traps = 0;
  const proxy = new Proxy(request, {getPrototypeOf() { traps += 1; return Object.prototype; }});
  assert.throws(() => handleObjectDetailsV1(proxy, projectionInput), /KS_OBJECT_CAPABILITY_REQUEST_SURFACE_DENIED/);
  assert.equal(traps, 0);

  const hidden = structuredClone(request);
  Object.defineProperty(hidden, 'credentials', {value: 'secret', enumerable: false});
  assert.throws(() => handleObjectDetailsV1(hidden, projectionInput), /KS_OBJECT_CAPABILITY_REQUEST_SURFACE_DENIED/);
  const symbol = structuredClone(request);
  symbol[Symbol('secret')] = 'hidden';
  assert.throws(() => handleObjectDetailsV1(symbol, projectionInput), /KS_OBJECT_CAPABILITY_REQUEST_SURFACE_DENIED/);

  let getterCalls = 0;
  const accessor = structuredClone(request);
  Object.defineProperty(accessor.bindings, 'coverageSha256', {enumerable: true, get() { getterCalls += 1; return request.bindings.coverageSha256; }});
  assert.throws(() => handleObjectDetailsV1(accessor, projectionInput), /KS_OBJECT_CAPABILITY_REQUEST_SURFACE_DENIED/);
  assert.equal(getterCalls, 0);
});

test('reusable adversarial matrix covers the Details capability profile against unchanged authority', () => {
  const {projectionInput, request} = scenarioFor('mssql', STATES.COMPLETE);
  runCapabilityAdversarialMatrixV1({
    request,
    otherCapabilityId: 'bi.object.search.read',
    invokeWithRequest: (candidate) => handleObjectDetailsV1(candidate, projectionInput),
  });
});
