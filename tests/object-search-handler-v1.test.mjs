import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {buildPreflightEvidence, canonicalJson, identitySha256, normalizeJsonValue} from '../services/bi-control/src/db-analyzer/core.mjs';
import {buildObjectInventoryAuthorityDigest} from '../services/bi-control/src/db-analyzer/object-inventory-authority-digest-v1.mjs';
import {buildObjectNameAuthority} from '../services/bi-control/src/db-analyzer/object-name-authority-v1.mjs';
import {buildObjectRelationKindAuthority} from '../services/bi-control/src/db-analyzer/object-relation-kind-authority-v1.mjs';
import {
  buildProgressiveCoverage, buildProgressiveMethodRegistry, createProgressiveCoverage, createProgressiveRun,
} from '../services/bi-control/src/db-analyzer/progressive-controller.mjs';
import {
  createObjectInventorySnapshot, createObjectSearchCoverageBinding, createObjectSearchEnvelope,
} from '../services/bi-control/src/db-analyzer/object-search-envelope-v1.mjs';
import {
  buildObjectSearchAuthorityBoundResult, continueObjectSearchAuthorityBoundResult,
} from '../services/bi-control/src/db-analyzer/object-search-authority-bound-result-v1.mjs';
import {runAnalyzeProfile} from '../services/bi-control/src/db-analyzer/workflow.mjs';
import {buildLiveProfile} from '../services/bi-control/src/runtime-config.mjs';
import {
  KS_OBJECT_CAPABILITY_REQUEST_SCHEMA, KS_OBJECT_CAPABILITY_RESULT_SCHEMA, buildObjectCapabilityContractV1,
} from '../services/bi-agent/src/object-capability-contract-v1.mjs';
import {KS_OBJECT_SEARCH_HANDLER_CAPABILITY_ID, handleObjectSearchV1} from '../services/bi-agent/src/object-search-handler-v1.mjs';

const ROOT = 'services/bi-control';
const MSSQL = `${ROOT}/query-packs/db-analyzer/v1/mssql`;
const ORACLE = `${ROOT}/query-packs/db-analyzer/v1/oracle`;
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const rowFor = (query, values) => Object.fromEntries(query.outputColumns.map((column) => [column, values[column] ?? null]));

const H = (character) => character.repeat(64);
const C = Object.freeze({
  search: KS_OBJECT_SEARCH_HANDLER_CAPABILITY_ID,
  details: 'bi.object.details.read',
});
const FORGED = 'KS_OBJECT_SEARCH_HANDLER_PROJECTION_FORGED';
const INPUT_INVALID = 'KS_OBJECT_SEARCH_HANDLER_INPUT_INVALID';
const CAPABILITY_MISMATCH = 'KS_OBJECT_SEARCH_HANDLER_CAPABILITY_MISMATCH';
const BINDING_DRIFT = 'KS_OBJECT_SEARCH_HANDLER_BINDING_DRIFT';
const CLAIMS = Object.freeze({
  absenceClaimed: false, completenessClaimed: false, replayPreventionClaimed: false, sourceRowsIncluded: false,
});
const AUTHORITY = Object.freeze({
  credentialsIncluded: false, dispatchAuthority: false, executionAuthority: false,
  mutationAuthority: false, queryExecution: false, rawValuesIncluded: false, sqlAuthority: false,
});

function resealEvidence(evidence, mutate) {
  const copy = structuredClone(evidence);
  delete copy.snapshotSha256;
  mutate(copy);
  return {...normalizeJsonValue(copy), snapshotSha256: identitySha256(normalizeJsonValue(copy))};
}

function prepareSources({engine, evidence, structureManifest, profilingManifest}) {
  const base = buildProgressiveCoverage(evidence);
  const coverage = createProgressiveCoverage({
    engine, structureSnapshotSha256: base.structureSnapshotSha256,
    structureCoverageLedgerSha256: base.structureCoverageLedgerSha256,
    entries: base.entries.map((entry, index) => ({
      objectRef: entry.objectRef,
      state: ['COMPLETE', 'PARTIAL', 'DENIED', 'UNKNOWN'][index % 4],
      reasonCode: index % 4 === 0 ? null : `FIXTURE_${['COMPLETE', 'PARTIAL', 'DENIED', 'UNKNOWN'][index % 4]}`,
      sourceQueryId: entry.sourceQueryId, evidenceRefs: entry.evidenceRefs,
    })), queryCoverage: base.queryCoverage,
  });
  const controllerRun = createProgressiveRun({
    runId: `${engine}-search-handler-v1-secret`, engine, scope: evidence.profile.scope,
    methodRegistry: buildProgressiveMethodRegistry({structureManifest, ...(profilingManifest ? {profilingManifest} : {})}),
    coverage, budgets: {maxRunProbes: 4, maxObjectProbes: 2},
  });
  const inventoryAuthorityProjection = buildObjectInventoryAuthorityDigest(controllerRun);
  const relationKindAuthorityProjection = buildObjectRelationKindAuthority({
    controllerRun, inventoryAuthorityProjection, structureEvidence: evidence,
  });
  const objectNameAuthorityProjection = buildObjectNameAuthority({
    controllerRun, inventoryAuthorityProjection, relationKindAuthorityProjection, structureEvidence: evidence,
  });
  return {controllerRun, inventoryAuthorityProjection, relationKindAuthorityProjection, objectNameAuthorityProjection, structureEvidence: evidence};
}

async function mssqlSources() {
  const [structureManifest, profilingManifest, raw] = await Promise.all([
    readJson(`${MSSQL}/manifest.json`), readJson(`${MSSQL}/profiling-manifest.json`),
    runAnalyzeProfile(`${ROOT}/fixtures/mssql-profile-v1.json`, {repositoryRoot: ROOT}),
  ]);
  const evidence = resealEvidence(raw, (body) => {
    const extract = body.extracts.find(({category}) => category === 'relations');
    for (let index = 0; index < extract.rows.length; index += 1) {
      const {objectSha256: _old, ...row} = extract.rows[index];
      row.relation_name = index === 0 ? 'InventoryTable' : 'InventoryView';
      row.relation_kind = index === 0 ? 'TABLE' : 'VIEW';
      const object = normalizeJsonValue(row);
      extract.rows[index] = {...object, objectSha256: identitySha256({queryId: extract.queryId, object})};
    }
  });
  return prepareSources({engine: 'mssql', evidence, structureManifest, profilingManifest});
}

const oracleEnv = {
  BI_ENGINE: 'oracle', ORACLE_HOST: 'oracle-test', ORACLE_PORT: '1521', ORACLE_DATABASE: 'FREE',
  ORACLE_SERVICE_NAME: 'FREEPDB1', ORACLE_USER: 'BI_ANALYZE', ORACLE_SCHEMAS: 'BI_DEMO',
  ORACLE_PROTOCOL: 'tcp', ORACLE_CONNECT_TIMEOUT_MS: '9000', ORACLE_QUERY_TIMEOUT_MS: '7000',
};

async function oracleSources() {
  const structureManifest = await readJson(`${ORACLE}/manifest.json`);
  const sqlByQueryId = Object.fromEntries(await Promise.all(structureManifest.queries.map(async (query) => [query.id, await readFile(`${ORACLE}/${query.file}`, 'utf8')])));
  const results = Object.fromEntries(structureManifest.queries.map((query) => [query.id, {state: 'SUCCEEDED', reasonCode: null, rows: []}]));
  const query = (id) => structureManifest.queries.find((entry) => entry.id === id);
  results['oracle.preflight.identity'].rows = [rowFor(query('oracle.preflight.identity'), {engine: 'oracle', engine_version: '26ai', database_name: 'FREE', container_name: 'FREEPDB1'})];
  results['oracle.preflight.rights'].rows = [rowFor(query('oracle.preflight.rights'), {permission_name: 'SYSTEM:CREATE SESSION', has_permission: 1})];
  results['oracle.preflight.capabilities'].rows = [rowFor(query('oracle.preflight.capabilities'), {collector_id: 'oracle.structure.relations', capability_name: 'ALL_OBJECTS', visibility_state: 'VISIBLE', minimum_privilege: 'CREATE SESSION', fallback_semantics: 'DENIED_IS_NOT_ABSENT'})];
  results['oracle.structure.schemas'].rows = [rowFor(query('oracle.structure.schemas'), {schema_name: 'BI_DEMO'})];
  results['oracle.structure.relations'].rows = [
    rowFor(query('oracle.structure.relations'), {schema_name: 'BI_DEMO', relation_name: 'Order Detail$Table', relation_kind: 'TABLE', object_id: 101, status: 'VALID', temporary: false}),
    rowFor(query('oracle.structure.relations'), {schema_name: 'BI_DEMO', relation_name: 'Order Detail$View', relation_kind: 'VIEW', object_id: 102, status: 'VALID', temporary: false}),
  ];
  results['oracle.structure.columns'].rows = [rowFor(query('oracle.structure.columns'), {schema_name: 'BI_DEMO', relation_name: 'Order Detail$Table', relation_kind: 'TABLE', column_name: 'ORDER_ID', ordinal_position: 1, data_type_schema: 'SYS', data_type: 'NUMBER', is_nullable: false})];
  results['oracle.size.segments'] = {state: 'DENIED', reasonCode: 'ORA_01031', rows: []};
  const profile = buildLiveProfile(oracleEnv, 'CM_ORACLE_PASSWORD');
  const evidence = buildPreflightEvidence({manifest: structureManifest, sqlByQueryId, resultSets: {schemaVersion: 'chimpmaera.db/runtime-query-results/v1', engine: 'oracle', runtimeValidated: true, results}, profileContext: {profileId: profile.profileId, mode: profile.mode, scope: profile.scope, policy: profile.policy, adapter: profile.adapter.kind}});
  return prepareSources({engine: 'oracle', evidence, structureManifest});
}

function requestFor({engine, schema, prefix, kindFilters, pageSize = 1}) {
  return createObjectSearchEnvelope({
    engine, scope: {schemas: [schema]}, prefix, kindFilters, pageSize,
    inventory: createObjectInventorySnapshot({engine, kindCounts: {TABLE: 2, VIEW: 1, COLUMN: 0, INDEX: 0, SEQUENCE: 0, SYNONYM: 0}}),
    coverage: createObjectSearchCoverageBinding({stateCounts: {SUCCEEDED: 5, PARTIAL: 1, DENIED: 1, UNSUPPORTED: 0, TIMEOUT: 0, ERROR: 0}}),
  });
}

function capabilityBindings(engine, sources, envelope) {
  return {
    engine,
    snapshotSha256: sources.objectNameAuthorityProjection.structureSnapshotSha256,
    receiptSha256: envelope.envelopeSha256,
    coverageSha256: sources.controllerRun.coverage.coverageSha256,
    inventoryAuthoritySha256: sources.objectNameAuthorityProjection.inventoryAuthorityDigestSha256,
    relationKindAuthoritySha256: sources.objectNameAuthorityProjection.relationKindAuthoritySha256,
    objectNameAuthoritySha256: sources.objectNameAuthorityProjection.objectNameAuthoritySha256,
    cancellationSha256: identitySha256({cancellation: 'NONE', engine}),
  };
}

function closedRequest(capabilityId, bindings, schemas) {
  return {
    schemaVersion: KS_OBJECT_CAPABILITY_REQUEST_SCHEMA,
    requestId: `handler-${capabilityId.split('.').pop()}`,
    capabilityId,
    bindings,
    scope: {schemas},
  };
}

function validHandlerInput({engine, sources, envelope, cursor}) {
  const bindings = capabilityBindings(engine, sources, envelope);
  const schemas = envelope.scope.schemas;
  const projectionInput = cursor ? {...sources, request: envelope, cursor} : {...sources, request: envelope};
  const projection = cursor
    ? continueObjectSearchAuthorityBoundResult(projectionInput)
    : buildObjectSearchAuthorityBoundResult(projectionInput);
  return {
    request: closedRequest(C.search, bindings, schemas),
    expected: {capabilityId: C.search, bindings, scope: {schemas}},
    projection,
    projectionInput,
  };
}

function resealEnvelope(envelope, mutate) {
  const copy = structuredClone(envelope);
  delete copy.envelopeSha256;
  mutate(copy);
  return {...normalizeJsonValue(copy), envelopeSha256: identitySha256(normalizeJsonValue(copy))};
}

function resealedProjection(body) {
  const {projectionSha256: _observed, ...rest} = normalizeJsonValue(body);
  return {...rest, projectionSha256: identitySha256(rest)};
}

const assertFrozen = (value) => {
  if (!value || typeof value !== 'object') return;
  assert(Object.isFrozen(value));
  Object.values(value).forEach(assertFrozen);
};

const fixtures = async () => ([
  {engine: 'mssql', sources: await mssqlSources(), envelope: requestFor({engine: 'mssql', schema: 'dbo', prefix: 'Inventory', kindFilters: ['TABLE', 'VIEW']})},
  {engine: 'oracle', sources: await oracleSources(), envelope: requestFor({engine: 'oracle', schema: 'BI_DEMO', prefix: 'Order', kindFilters: ['TABLE', 'VIEW']})},
]);

test('MSSQL and Oracle exact first-page inputs produce byte-deterministic deeply frozen read-only envelopes bound to the canonical request and verified projection digests', async () => {
  for (const {engine, sources, envelope} of await fixtures()) {
    const value = validHandlerInput({engine, sources, envelope});
    const a = handleObjectSearchV1(value);
    const b = handleObjectSearchV1({
      request: {...value.request, bindings: {...value.request.bindings}, scope: {...value.request.scope, schemas: [...value.request.scope.schemas]}},
      expected: {...value.expected, bindings: {...value.expected.bindings}, scope: {...value.expected.scope, schemas: [...value.expected.scope.schemas]}},
      projection: value.projection,
      projectionInput: value.projectionInput,
    });
    assert.equal(a.schemaVersion, KS_OBJECT_CAPABILITY_RESULT_SCHEMA);
    assert.equal(a.capabilityId, C.search);
    assert.equal(a.state, 'PROJECTED_READ_ONLY');
    assert.equal(a.requestSha256, identitySha256(value.request));
    assert.equal(a.projectionSha256, value.projection.projectionSha256);
    assert.deepEqual(a.bindings, value.expected.bindings);
    assert.deepEqual(a.claims, CLAIMS);
    assert.deepEqual(a.authority, AUTHORITY);
    assertFrozen(a);
    assert.throws(() => {a.state = 'MUTATED';}, TypeError);
    assert.equal(canonicalJson(a), canonicalJson(b));
    const contract = buildObjectCapabilityContractV1();
    assert.equal(contract.validateResult(a, {
      capabilityId: C.search, requestSha256: a.requestSha256, projectionSha256: a.projectionSha256, bindings: value.expected.bindings,
    }), a);
  }
});

test('MSSQL and Oracle exact continuation inputs produce byte-deterministic deeply frozen read-only envelopes bound to the canonical request and verified projection digests', async () => {
  for (const {engine, sources, envelope} of await fixtures()) {
    const first = buildObjectSearchAuthorityBoundResult({...sources, request: envelope});
    assert(first.nextCursor);
    const value = validHandlerInput({engine, sources, envelope, cursor: first.nextCursor});
    assert.equal(value.projection.page.pageIndex, 1);
    assert.equal(value.projection.nextCursor, null);
    const a = handleObjectSearchV1(value);
    const b = handleObjectSearchV1(value);
    assert.equal(a.schemaVersion, KS_OBJECT_CAPABILITY_RESULT_SCHEMA);
    assert.equal(a.state, 'PROJECTED_READ_ONLY');
    assert.equal(a.requestSha256, identitySha256(value.request));
    assert.equal(a.projectionSha256, value.projection.projectionSha256);
    assertFrozen(a);
    assert.equal(canonicalJson(a), canonicalJson(b));
  }
});

test('handler rejects capability substitution, request substitution, binding drift, scope escape, oversize and cancellation drift before projection', async () => {
  const {engine, sources, envelope} = (await fixtures())[0];
  const value = validHandlerInput({engine, sources, envelope});
  const bindings = value.request.bindings;
  const cases = [
    [{
      ...value,
      request: closedRequest(C.details, bindings, value.request.scope.schemas),
      expected: {...value.expected, capabilityId: C.details},
    }, CAPABILITY_MISMATCH],
    [{
      ...value,
      request: closedRequest(C.details, bindings, value.request.scope.schemas),
    }, 'KS_OBJECT_CAPABILITY_REQUEST_IDENTITY_DENIED'],
    [{...value, request: {...closedRequest(C.search, bindings, value.request.scope.schemas), sql: 'SELECT 1'}}, 'KS_OBJECT_CAPABILITY_REQUEST_SURFACE_DENIED'],
    [{...value, request: {...closedRequest(C.search, bindings, value.request.scope.schemas), credentials: 'secret'}}, 'KS_OBJECT_CAPABILITY_REQUEST_SURFACE_DENIED'],
    [{...value, request: {...closedRequest(C.search, bindings, value.request.scope.schemas), callback: 'https://evil.invalid'}}, 'KS_OBJECT_CAPABILITY_REQUEST_SURFACE_DENIED'],
    [{...value, request: {...closedRequest(C.search, bindings, value.request.scope.schemas), rawRows: []}}, 'KS_OBJECT_CAPABILITY_REQUEST_SURFACE_DENIED'],
    [{
      ...value,
      request: closedRequest(C.search, {...bindings, claims: {completenessClaimed: true}}, value.request.scope.schemas),
    }, 'KS_OBJECT_CAPABILITY_REQUEST_SURFACE_DENIED'],
    [{
      ...value,
      request: closedRequest(C.search, {...bindings, dispatchAuthority: true}, value.request.scope.schemas),
    }, 'KS_OBJECT_CAPABILITY_REQUEST_SURFACE_DENIED'],
    [{
      ...value,
      request: closedRequest(C.search, {...bindings, receiptSha256: H('0')}, value.request.scope.schemas),
      expected: {...value.expected, bindings: {...bindings, receiptSha256: H('0')}},
    }, BINDING_DRIFT],
    [{...value, request: closedRequest(C.search, {...bindings, receiptSha256: H('0')}, value.request.scope.schemas)}, 'KS_OBJECT_CAPABILITY_BINDING_DENIED'],
    [{...value, request: closedRequest(C.search, {...bindings, cancellationSha256: H('0')}, value.request.scope.schemas)}, 'KS_OBJECT_CAPABILITY_BINDING_DENIED'],
    [{
      ...value,
      request: closedRequest(C.search, {...bindings, objectNameAuthoritySha256: H('0')}, value.request.scope.schemas),
      expected: {...value.expected, bindings: {...bindings, objectNameAuthoritySha256: H('0')}},
    }, BINDING_DRIFT],
    [{...value, request: closedRequest(C.search, bindings, ['../escape'])}, 'KS_OBJECT_CAPABILITY_SCOPE_DENIED'],
    [{...value, request: closedRequest(C.search, bindings, ['other'])}, 'KS_OBJECT_CAPABILITY_SCOPE_DENIED'],
    [{...value, request: closedRequest(C.search, bindings, Array.from({length: 257}, (_, index) => `s${index}`))}, 'KS_OBJECT_CAPABILITY_SCOPE_DENIED'],
    [{...value, request: null}, 'KS_OBJECT_CAPABILITY_REQUEST_SURFACE_DENIED'],
  ];
  for (const [input, code] of cases) {
    assert.throws(() => handleObjectSearchV1(input), {code, message: code});
  }
});

test('handler rejects handler-surface injection, secrets, callbacks, raw rows and SQL/query fields with one fixed code', async () => {
  const {engine, sources, envelope} = (await fixtures())[0];
  const value = validHandlerInput({engine, sources, envelope});
  for (const extra of [{sql: 'SELECT 1'}, {credentials: 'secret'}, {callback: 'https://evil.invalid'}, {result: {}}, {query: 'SELECT 1'}]) {
    assert.throws(() => handleObjectSearchV1({...value, ...extra}), {code: INPUT_INVALID, message: INPUT_INVALID});
  }
  for (const projectionInput of [{...value.projectionInput, sql: 'SELECT 1'}, {...value.projectionInput, credentials: 'secret'}, {...value.projectionInput, callback: 'https://evil.invalid'}]) {
    assert.throws(() => handleObjectSearchV1({...value, projectionInput}), {code: FORGED, message: FORGED});
  }
});

test('handler fails closed on substituted, re-digested, stale and page-mismatched projections with one fixed code', async () => {
  const {engine, sources, envelope} = (await fixtures())[0];
  const value = validHandlerInput({engine, sources, envelope});
  const forged = (mutate) => {
    const projection = structuredClone(value.projection);
    mutate(projection);
    return {...value, projection};
  };
  const tampered = [
    (projection) => {projection.items[0].objectName = 'ForgedTable';},
    (projection) => {projection.page.matchCount += 1;},
    (projection) => {projection.bindings.objectNameAuthoritySha256 = H('0');},
    (projection) => {projection.claims.absenceClaimed = true;},
    (projection) => {projection.authority.sqlAuthority = true;},
    (projection) => {projection.authority.dispatchAuthority = true;},
    (projection) => {projection.authority.executionAuthority = true;},
    (projection) => {projection.authority.mutationAuthority = true;},
    (projection) => {projection.authority.replayPreventionClaimed = true;},
    (projection) => {projection.rawRows = [];},
  ];
  for (const mutate of tampered) {
    assert.throws(() => handleObjectSearchV1(forged(mutate)), {code: FORGED, message: FORGED});
  }
  const redigested = forged((projection) => {
    projection.items[0].objectName = 'ForgedTable';
  });
  assert.throws(() => handleObjectSearchV1({...redigested, projection: resealedProjection(redigested.projection)}), {code: FORGED, message: FORGED});
  const firstInput = value.projectionInput;
  const first = buildObjectSearchAuthorityBoundResult(firstInput);
  assert(first.nextCursor);
  const secondInput = {...sources, request: envelope, cursor: first.nextCursor};
  const second = continueObjectSearchAuthorityBoundResult(secondInput);
  assert.throws(() => handleObjectSearchV1({...value, projection: second}), {code: FORGED, message: FORGED});
  assert.throws(() => handleObjectSearchV1({...value, projection: first, projectionInput: secondInput}), {code: FORGED, message: FORGED});
  const exhaustedEnvelope = requestFor({engine: 'mssql', schema: 'dbo', prefix: 'Inventory', kindFilters: ['TABLE', 'VIEW'], pageSize: 10});
  const exhaustedInput = {...sources, request: exhaustedEnvelope, cursor: first.nextCursor};
  assert.throws(() => handleObjectSearchV1({
    ...validHandlerInput({engine, sources, envelope: exhaustedEnvelope}),
    projectionInput: exhaustedInput,
  }), {code: FORGED, message: FORGED});
});

test('handler fails closed on scope escape, injection, secrets, oversize page bound, missing coverage and stale receipt in the authoritative search envelope', async () => {
  const {engine, sources, envelope} = (await fixtures())[0];
  const value = validHandlerInput({engine, sources, envelope});
  const withEnvelope = (mutate) => ({
    ...value,
    projection: buildObjectSearchAuthorityBoundResult({...sources, request: envelope}),
    projectionInput: {...sources, request: resealEnvelope(envelope, mutate)},
  });
  const cases = [
    (body) => {body.prefix = 'Inventory; DROP TABLE Students;--';},
    (body) => {body.prefix = 'password123';},
    (body) => {body.pageSize = 501;},
    (body) => {delete body.coverage.stateCounts.DENIED;},
    (body) => {body.receiptSha256 = H('0');},
    (body) => {body.scope.schemas = ['../escape'];},
  ];
  for (const mutate of cases) {
    assert.throws(() => handleObjectSearchV1(withEnvelope(mutate)), {code: FORGED, message: FORGED});
  }
});