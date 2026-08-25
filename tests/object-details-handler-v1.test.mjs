import assert from 'node:assert/strict';
import test from 'node:test';

import {canonicalJson, identitySha256, normalizeJsonValue} from '../services/bi-control/src/db-analyzer/core.mjs';
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

function bindingsFor(engine, {ledger, receipt}) {
  return {
    engine,
    snapshotSha256: snapshotOf(engine),
    receiptSha256: receipt.receiptSha256,
    coverageSha256: ledger.coverageSha256,
    inventoryAuthoritySha256: H('4'),
    relationKindAuthoritySha256: H('5'),
    objectNameAuthoritySha256: H('6'),
    cancellationSha256: H('7'),
  };
}

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
      queryId: `${engine}.structure-relations`,
      category: 'relations',
      state: queryState,
      reasonCode: spec.state === 'COMPLETE' ? null : spec.reasonCode,
      visibility: spec.state === 'COMPLETE' ? 'VISIBLE_COMPLETE' : VISIBILITY[spec.state],
      absenceClaim: 'NOT_CLAIMED',
    }],
  });
  return {ledger, entry: ledger.entries[0]};
}

function receiptFor(engine, {entry, ledger}) {
  return seal({
    schemaVersion: 'kaleidosphere.analysis/object-details-evidence-receipt/v1', engine,
    scopeSha256: scopeSha256Of(engine), inventorySnapshotSha256: snapshotOf(engine), coverageLedgerSha256: ledger.coverageSha256,
    objectKey: entry.objectKey, coverageEntrySha256: identitySha256(entry),
    evidenceRefs: [...entry.evidenceRefs].sort(),
  }, 'receiptSha256');
}

function projectionInputFor(engine, {entry, ledger, receipt = receiptFor(engine, {entry, ledger}), objectKey = entry.objectKey, scope = SCOPES[engine], scopeSha256 = scopeSha256Of(engine), inventorySnapshotSha256 = snapshotOf(engine), ...extra} = {}) {
  return {engine, scope, scopeSha256, inventorySnapshotSha256, coverageLedger: ledger, receipt, objectKey, ...extra};
}

function rawEntry({engine = 'mssql', relationName = 'sales_orders', schemaName = SCOPES.mssql.schemas[0], evidenceRefs} = {}) {
  const objectRef = {kind: 'RELATION', schemaName, relationName, columnName: null, objectName: null, sourceObjectSha256: sourceObjectOf(engine, relationName)};
  return {
    objectKey: identitySha256(objectRef),
    objectRef,
    state: 'COMPLETE',
    reasonCode: null,
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

function scenarioFor(engine, spec) {
  const {ledger, entry} = buildLedger(engine, spec);
  const receipt = receiptFor(engine, {entry, ledger});
  const projectionInput = projectionInputFor(engine, {entry, ledger, receipt});
  const scenarioBindings = bindingsFor(engine, {ledger, receipt});
  const request = {
    schemaVersion: 'kaleidosphere.object-capabilities/request/v1',
    requestId: `request-${engine}-${spec.state.toLowerCase()}`,
    capabilityId: KS_OBJECT_DETAILS_HANDLER_CAPABILITY,
    bindings: scenarioBindings,
    scope: {schemas: SCOPES[engine].schemas},
  };
  const projection = projectObjectDetails(projectionInput);
  const expectations = {
    capabilityId: KS_OBJECT_DETAILS_HANDLER_CAPABILITY,
    bindings: scenarioBindings,
    scope: {schemas: SCOPES[engine].schemas},
    requestSha256: identitySha256(normalizeJsonValue(request)),
    projectionSha256: projection.projectionSha256,
  };
  return {ledger, entry, receipt, projectionInput, request, projection, expectations};
}

function expectCode(action, code) {
  assert.throws(action, (error) => error.code === code, code);
}

function assertDeeplyFrozen(value, label) {
  if (value === null || typeof value !== 'object') return;
  assert.ok(Object.isFrozen(value), `deeply frozen: ${label}`);
  for (const [key, nested] of Object.entries(value)) assertDeeplyFrozen(nested, `${label}.${key}`);
}

test('M2.3 closed details request with authoritative expectations and projection inputs yields byte-deterministic deeply frozen read-only result envelopes bound to canonical request and verified projection digests', () => {
  for (const engine of ENGINES) {
    for (const [name, spec] of Object.entries(STATES)) {
      const {ledger, receipt, projectionInput, request, projection, expectations} = scenarioFor(engine, spec);
      const result = handleObjectDetailsV1(request, expectations, projectionInput);
      assert.equal(result.schemaVersion, KS_OBJECT_CAPABILITY_RESULT_SCHEMA, `${engine} ${name} schemaVersion`);
      assert.equal(result.state, 'PROJECTED_READ_ONLY');
      assert.equal(result.capabilityId, 'bi.object.details.read');
      assert.equal(result.requestSha256, identitySha256(normalizeJsonValue(request)), `${engine} ${name} canonical request digest`);
      assert.equal(result.projectionSha256, projection.projectionSha256, `${engine} ${name} verified projection digest`);
      assert.deepEqual(result.bindings, bindingsFor(engine, {ledger, receipt}));
      assert.deepEqual(Object.keys(result).sort(), RESULT_KEYS);
      for (const flag of [...Object.values(result.claims), ...Object.values(result.authority)]) assert.equal(flag, false);
      verifyObjectDetailsProjection(projection, projectionInput);
      assert.equal(projection.schemaVersion, OBJECT_DETAILS_PROJECTION_SCHEMA);
      assert.equal(projection.coverage.state, spec.state);
      assert.equal(projection.coverage.reasonCode, spec.reasonCode);
      assert.equal(projection.coverage.visibility, VISIBILITY[spec.state]);
      assertDeeplyFrozen(result, `${engine} ${name} result`);
      assert.equal(canonicalJson(handleObjectDetailsV1(request, expectations, projectionInput)), canonicalJson(result), `${engine} ${name} deterministic repeat`);
    }
  }
});

test('M2.3 handler exports the fixed read-only details capability and its fail-closed code surface', () => {
  assert.equal(KS_OBJECT_DETAILS_HANDLER_CAPABILITY, 'bi.object.details.read');
  assert.ok(Object.isFrozen(KS_OBJECT_DETAILS_HANDLER_FAIL_CLOSED_CODES));
  assert.ok(!KS_OBJECT_DETAILS_HANDLER_FAIL_CLOSED_CODES.includes('KS_OBJECT_DETAILS_HANDLER_DISPATCH_INCLUDED'));
});

test('M2.3 handler fails closed before projection for capability, request and binding substitution, scope escape, cancellation drift and unsafe request fields', () => {
  const {projectionInput, request, expectations} = scenarioFor('mssql', STATES.COMPLETE);
  expectCode(() => handleObjectDetailsV1({...request, capabilityId: 'bi.object.search.read'}, expectations, projectionInput), 'KS_OBJECT_CAPABILITY_REQUEST_IDENTITY_DENIED');
  expectCode(() => handleObjectDetailsV1(request, {...expectations, capabilityId: 'bi.object.search.read'}, projectionInput), 'KS_OBJECT_DETAILS_HANDLER_CAPABILITY_DENIED');
  expectCode(() => handleObjectDetailsV1(request, {...expectations, capabilityId: 'bi.database.overview.read'}, projectionInput), 'KS_OBJECT_DETAILS_HANDLER_CAPABILITY_DENIED');
  expectCode(() => handleObjectDetailsV1({...request, bindings: {...request.bindings, snapshotSha256: H('0')}}, expectations, projectionInput), 'KS_OBJECT_CAPABILITY_BINDING_DENIED');
  expectCode(() => handleObjectDetailsV1({...request, bindings: {...request.bindings, cancellationSha256: H('0')}}, expectations, projectionInput), 'KS_OBJECT_CAPABILITY_BINDING_DENIED');
  expectCode(() => handleObjectDetailsV1({...request, scope: {schemas: ['../escape']}}, expectations, projectionInput), 'KS_OBJECT_CAPABILITY_SCOPE_DENIED');
  expectCode(() => handleObjectDetailsV1({...request, scope: {schemas: ['other']}}, expectations, projectionInput), 'KS_OBJECT_CAPABILITY_SCOPE_DENIED');
  expectCode(() => handleObjectDetailsV1({...request, requestId: 'r'}, expectations, projectionInput), 'KS_OBJECT_CAPABILITY_REQUEST_IDENTITY_DENIED');
  for (const [field, value] of [['sql', 'SELECT 1'], ['credentials', 'secret'], ['rawRows', []], ['callback', 'https://evil.invalid']]) {
    expectCode(() => handleObjectDetailsV1({...request, [field]: value}, expectations, projectionInput), 'KS_OBJECT_CAPABILITY_REQUEST_SURFACE_DENIED');
  }
  expectCode(() => handleObjectDetailsV1('request', expectations, projectionInput), 'KS_OBJECT_CAPABILITY_REQUEST_SURFACE_DENIED');
});

test('M2.3 handler rejects unchanged-digest binding drift and scope or engine drift between request and projection inputs', () => {
  const {projectionInput, request, expectations} = scenarioFor('mssql', STATES.COMPLETE);
  // Authoritative request digest unchanged while the closed request is altered.
  expectCode(() => handleObjectDetailsV1({...request, requestId: 'request-substituted'}, expectations, projectionInput), 'KS_OBJECT_DETAILS_HANDLER_REQUEST_DIGEST_DRIFT');
  // Closed request unchanged while the authoritative request digest drifts.
  expectCode(() => handleObjectDetailsV1(request, {...expectations, requestSha256: H('0')}, projectionInput), 'KS_OBJECT_DETAILS_HANDLER_REQUEST_DIGEST_DRIFT');
  // Projection input scope escaping the closed request scope in either direction.
  expectCode(() => handleObjectDetailsV1(request, expectations, {...projectionInput, scope: {...SCOPES.mssql, schemas: ['dbo', 'finance', 'hr']}}), 'KS_OBJECT_DETAILS_HANDLER_SCOPE_DRIFT');
  expectCode(() => handleObjectDetailsV1(request, expectations, {...projectionInput, scope: {...SCOPES.mssql, schemas: ['dbo']}}), 'KS_OBJECT_DETAILS_HANDLER_SCOPE_DRIFT');
  expectCode(() => handleObjectDetailsV1(request, expectations, {...projectionInput, scope: {...SCOPES.mssql, schemas: []}}), 'KS_OBJECT_DETAILS_HANDLER_SCOPE_DRIFT');
  // Projection input engine drifting from the request binding engine.
  expectCode(() => handleObjectDetailsV1(request, expectations, {...projectionInput, engine: 'oracle'}), 'KS_OBJECT_DETAILS_HANDLER_ENGINE_DRIFT');
  // Malformed expectations fail closed before any projection work.
  expectCode(() => handleObjectDetailsV1(request, {...expectations, extra: true}, projectionInput), 'KS_OBJECT_DETAILS_HANDLER_EXPECTATION_INVALID');
  expectCode(() => handleObjectDetailsV1(request, {...expectations, bindings: {...expectations.bindings, engine: 'sqlite'}}, projectionInput), 'KS_OBJECT_DETAILS_HANDLER_EXPECTATION_INVALID');
  expectCode(() => handleObjectDetailsV1(request, {...expectations, scope: {schemas: []}}, projectionInput), 'KS_OBJECT_DETAILS_HANDLER_EXPECTATION_INVALID');
});

test('M2.3 handler rejects paired request and expectation binding substitution against the unchanged authoritative projection inputs and verified envelope', () => {
  const {projectionInput, request, expectations} = scenarioFor('mssql', STATES.COMPLETE);
  const paired = (changed) => {
    const nextBindings = {...request.bindings, ...changed};
    const nextRequest = {...request, bindings: nextBindings};
    return [nextRequest, {...expectations, bindings: nextBindings, requestSha256: identitySha256(normalizeJsonValue(nextRequest))}];
  };
  // Review probe: snapshot and receipt are substituted as a pair with the authoritative request digest recomputed while the projection input and digest stay unchanged.
  const [probeRequest, probeExpectations] = paired({snapshotSha256: H('0'), receiptSha256: H('9')});
  expectCode(() => handleObjectDetailsV1(probeRequest, probeExpectations, projectionInput), 'KS_OBJECT_DETAILS_HANDLER_BINDING_DRIFT');
  // Each published hash anchored by the details capability must track the unchanged authoritative snapshot and verified projection envelope digests.
  const [snapshotRequest, snapshotExpectations] = paired({snapshotSha256: H('0')});
  expectCode(() => handleObjectDetailsV1(snapshotRequest, snapshotExpectations, projectionInput), 'KS_OBJECT_DETAILS_HANDLER_BINDING_DRIFT');
  const [coverageRequest, coverageExpectations] = paired({coverageSha256: H('0')});
  expectCode(() => handleObjectDetailsV1(coverageRequest, coverageExpectations, projectionInput), 'KS_OBJECT_DETAILS_HANDLER_BINDING_DRIFT');
  const [receiptRequest, receiptExpectations] = paired({receiptSha256: H('0')});
  expectCode(() => handleObjectDetailsV1(receiptRequest, receiptExpectations, projectionInput), 'KS_OBJECT_DETAILS_HANDLER_BINDING_DRIFT');
});

test('M2.3 handler rejects projection input substitution, identifier injection, claims, secrets, oversized evidence, missing coverage and stale receipt bindings', () => {
  const {ledger, entry, request, expectations} = scenarioFor('mssql', STATES.COMPLETE);
  const input = projectionInputFor('mssql', {entry, ledger});
  const withEntry = (next) => projectionInputFor('mssql', {entry: next, ledger: ledgerWithEntry(ledger, next)});
  const injected = rawEntry({relationName: 'sales--orders'});
  expectCode(() => handleObjectDetailsV1(request, expectations, withEntry(injected)), 'DB_OBJECT_DETAILS_IDENTIFIER_INVALID');
  const claimed = rawEntry({relationName: 'sales_orders_verified'});
  expectCode(() => handleObjectDetailsV1(request, expectations, withEntry(claimed)), 'DB_OBJECT_DETAILS_IDENTIFIER_CLAIM');
  const secret = rawEntry({relationName: 'sales_password_orders'});
  expectCode(() => handleObjectDetailsV1(request, expectations, withEntry(secret)), 'DB_OBJECT_DETAILS_IDENTIFIER_INVALID');
  const oversized = rawEntry({relationName: `s_${'x'.repeat(127)}`});
  expectCode(() => handleObjectDetailsV1(request, expectations, withEntry(oversized)), 'DB_OBJECT_DETAILS_IDENTIFIER_INVALID');
  expectCode(() => handleObjectDetailsV1(request, expectations, projectionInputFor('mssql', {entry, ledger, objectKey: identitySha256({missing: 'coverage-entry'})})), 'DB_OBJECT_DETAILS_COVERAGE_MISSING');
  const oversizedEvidence = rawEntry({});
  oversizedEvidence.evidenceRefs = [...Array.from({length: 17}, (_value, index) => identitySha256({evidence: index}))];
  expectCode(() => handleObjectDetailsV1(request, expectations, withEntry(oversizedEvidence)), 'DB_OBJECT_DETAILS_EVIDENCE_INVALID');
  const unrelated = buildLedger('mssql', STATES.COMPLETE, {relationName: 'other_orders'});
  expectCode(() => handleObjectDetailsV1(request, expectations, projectionInputFor('mssql', {
    entry, ledger, receipt: receiptFor('mssql', {entry: unrelated.entry, ledger: unrelated.ledger}),
  })), 'DB_OBJECT_DETAILS_RECEIPT_BINDING_INVALID');
  expectCode(() => handleObjectDetailsV1(request, expectations, {...input, scopeSha256: identitySha256({stale: 'scope'})}), 'DB_OBJECT_DETAILS_BINDING_DRIFT');
  expectCode(() => handleObjectDetailsV1(request, expectations, {...input, hint: 'select 1'}), 'KS_OBJECT_DETAILS_HANDLER_PROJECTION_INPUT_INVALID');
  expectCode(() => handleObjectDetailsV1(request, expectations, null), 'KS_OBJECT_DETAILS_HANDLER_PROJECTION_INPUT_INVALID');
});

test('M2.3 handler rejects a fully re-digested forged details projection against unchanged authoritative inputs', () => {
  const {projectionInput, request, projection, expectations} = scenarioFor('mssql', STATES.COMPLETE);
  const {projectionSha256: _old, ...body} = {...projection, coverage: {...projection.coverage, visibility: 'EXHAUSTIVE'}};
  const forged = {...body, projectionSha256: identitySha256(body)};
  // The composed verifier rejects the re-digested forged envelope against unchanged inputs.
  expectCode(() => verifyObjectDetailsProjection(forged, projectionInput), 'DB_OBJECT_DETAILS_FORGED');
  // The handler's binding to the unchanged authoritative projection digest rejects the forged digest.
  expectCode(() => handleObjectDetailsV1(request, {...expectations, projectionSha256: forged.projectionSha256}, projectionInput), 'KS_OBJECT_DETAILS_HANDLER_PROJECTION_DIGEST_DRIFT');
  // Any other drifted authoritative projection digest also fails closed.
  expectCode(() => handleObjectDetailsV1(request, {...expectations, projectionSha256: H('0')}, projectionInput), 'KS_OBJECT_DETAILS_HANDLER_PROJECTION_DIGEST_DRIFT');
});

test('M2.3 composed result envelope validation accepts the built envelope and denies every claim and authority widening', () => {
  const {projectionInput, request, expectations} = scenarioFor('mssql', STATES.COMPLETE);
  const result = handleObjectDetailsV1(request, expectations, projectionInput);
  const {validateResult} = buildObjectCapabilityContractV1();
  const expected = {
    capabilityId: expectations.capabilityId,
    requestSha256: expectations.requestSha256,
    projectionSha256: expectations.projectionSha256,
    bindings: expectations.bindings,
  };
  assert.deepEqual(validateResult(result, expected), result, 'built envelope is the validated result envelope');
  expectCode(() => validateResult({...result, claims: {...result.claims, completenessClaimed: true}}, expected), 'KS_OBJECT_CAPABILITY_CLAIM_DENIED');
  expectCode(() => validateResult({...result, claims: {...result.claims, sourceRowsIncluded: true}}, expected), 'KS_OBJECT_CAPABILITY_CLAIM_DENIED');
  expectCode(() => validateResult({...result, authority: {...result.authority, dispatchAuthority: true}}, expected), 'KS_OBJECT_CAPABILITY_AUTHORITY_DENIED');
  expectCode(() => validateResult({...result, authority: {...result.authority, executionAuthority: true}}, expected), 'KS_OBJECT_CAPABILITY_AUTHORITY_DENIED');
  expectCode(() => validateResult({...result, authority: {...result.authority, mutationAuthority: true}}, expected), 'KS_OBJECT_CAPABILITY_AUTHORITY_DENIED');
  expectCode(() => validateResult({...result, authority: {...result.authority, sqlAuthority: true}}, expected), 'KS_OBJECT_CAPABILITY_AUTHORITY_DENIED');
  expectCode(() => validateResult({...result, authority: {...result.authority, rawValuesIncluded: true}}, expected), 'KS_OBJECT_CAPABILITY_AUTHORITY_DENIED');
});