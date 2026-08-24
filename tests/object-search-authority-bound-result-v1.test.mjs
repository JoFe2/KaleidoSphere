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
import {runAnalyzeProfile} from '../services/bi-control/src/db-analyzer/workflow.mjs';
import {buildLiveProfile} from '../services/bi-control/src/runtime-config.mjs';
import {
  OBJECT_SEARCH_AUTHORITY_BOUND_CURSOR_SCHEMA,
  OBJECT_SEARCH_AUTHORITY_BOUND_RESULT_SCHEMA,
  buildObjectSearchAuthorityBoundResult,
} from '../services/bi-control/src/db-analyzer/object-search-authority-bound-result-v1.mjs';

const ROOT = 'services/bi-control';
const MSSQL = `${ROOT}/query-packs/db-analyzer/v1/mssql`;
const ORACLE = `${ROOT}/query-packs/db-analyzer/v1/oracle`;
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const rowFor = (query, values) => Object.fromEntries(query.outputColumns.map((column) => [column, values[column] ?? null]));

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
    runId: `${engine}-authority-search-result-secret`, engine, scope: evidence.profile.scope,
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

function requestFor({engine, schema, prefix, kindFilters, pageSize = 1, inflated = false}) {
  return createObjectSearchEnvelope({
    engine, scope: {schemas: [schema]}, prefix, kindFilters, pageSize,
    inventory: createObjectInventorySnapshot({engine, kindCounts: {TABLE: inflated ? 999 : 2, VIEW: inflated ? 777 : 1, COLUMN: 0, INDEX: 0, SEQUENCE: 0, SYNONYM: 0}}),
    coverage: createObjectSearchCoverageBinding({stateCounts: {SUCCEEDED: inflated ? 99 : 5, PARTIAL: 1, DENIED: 1, UNSUPPORTED: 0, TIMEOUT: 0, ERROR: 0}}),
  });
}

const build = (sources, request, extra = {}) => buildObjectSearchAuthorityBoundResult({...sources, request, ...extra});
const assertFrozen = (value) => {
  if (!value || typeof value !== 'object') return;
  assert(Object.isFrozen(value));
  Object.values(value).forEach(assertFrozen);
};

test('MSSQL prefix applies to authoritative objectName and TABLE/VIEW filters remain exact', async () => {
  const sources = await mssqlSources();
  const both = build(sources, requestFor({engine: 'mssql', schema: 'dbo', prefix: 'Inventory', kindFilters: ['TABLE', 'VIEW']}));
  assert.deepEqual(both.items.map(({objectName, relationKind}) => [objectName, relationKind]), [['InventoryTable', 'TABLE']]);
  assert.equal(both.page.matchCount, 2);
  assert.equal(both.page.remainingCount, 1);
  assert.equal(both.nextCursor.schemaVersion, OBJECT_SEARCH_AUTHORITY_BOUND_CURSOR_SCHEMA);
  assert.equal(both.nextCursor.pageIndex, 1);
  const tables = build(sources, requestFor({engine: 'mssql', schema: 'dbo', prefix: 'Inventory', kindFilters: ['TABLE'], pageSize: 10}));
  const views = build(sources, requestFor({engine: 'mssql', schema: 'dbo', prefix: 'Inventory', kindFilters: ['VIEW'], pageSize: 10}));
  assert.deepEqual(tables.items.map(({objectName}) => objectName), ['InventoryTable']);
  assert.deepEqual(views.items.map(({objectName}) => objectName), ['InventoryView']);
  assert(!canonicalJson(both).includes('dbo'));
  assertFrozen(both);
});

test('Oracle quoted names preserve case and exact kind while empty output makes no absence/completeness claim', async () => {
  const sources = await oracleSources();
  const table = build(sources, requestFor({engine: 'oracle', schema: 'BI_DEMO', prefix: 'Order', kindFilters: ['TABLE'], pageSize: 10}));
  assert.deepEqual(table.items.map(({objectName, relationKind}) => [objectName, relationKind]), [['Order Detail$Table', 'TABLE']]);
  const empty = build(sources, requestFor({engine: 'oracle', schema: 'BI_DEMO', prefix: 'Missing', kindFilters: ['VIEW'], pageSize: 10}));
  assert.deepEqual(empty.items, []);
  assert.equal(empty.page.matchCount, 0);
  assert.equal(empty.claims.absenceClaimed, false);
  assert.equal(empty.claims.completenessClaimed, false);
  assert.equal(empty.nextCursor, null);
});

test('pure first-page projection rejects cursor consumption, non-relation kinds and caller page/count authority', async () => {
  const sources = await mssqlSources();
  const request = requestFor({engine: 'mssql', schema: 'dbo', prefix: 'Inventory', kindFilters: ['TABLE', 'VIEW']});
  const first = build(sources, request);
  assert.throws(() => build(sources, request, {cursor: first.nextCursor}), {code: 'DB_OBJECT_SEARCH_AUTHORITY_RESULT_INPUT_INVALID'});
  assert.throws(() => build(sources, requestFor({engine: 'mssql', schema: 'dbo', prefix: 'Inventory', kindFilters: ['COLUMN']})), {code: 'DB_OBJECT_SEARCH_AUTHORITY_RESULT_KIND_UNSUPPORTED'});
  assert.throws(() => build(sources, request, {pageIndex: 1}), {code: 'DB_OBJECT_SEARCH_AUTHORITY_RESULT_INPUT_INVALID'});
  const inflated = build(sources, requestFor({engine: 'mssql', schema: 'dbo', prefix: 'Inventory', kindFilters: ['TABLE', 'VIEW'], inflated: true}));
  assert.equal(inflated.page.matchCount, 2);
  assert.deepEqual(inflated.items, first.items);
});

test('exact bindings, deterministic bytes, deep freeze and authority/non-claim envelope are retained', async () => {
  const sources = await mssqlSources();
  const request = requestFor({engine: 'mssql', schema: 'dbo', prefix: 'Inventory', kindFilters: ['TABLE', 'VIEW']});
  const a = build(sources, request);
  const b = build(sources, request);
  assert.equal(a.schemaVersion, OBJECT_SEARCH_AUTHORITY_BOUND_RESULT_SCHEMA);
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(a.bindings.objectNameAuthoritySha256, sources.objectNameAuthorityProjection.objectNameAuthoritySha256);
  assert.equal(a.bindings.relationKindAuthoritySha256, sources.relationKindAuthorityProjection.relationKindAuthoritySha256);
  assert.equal(a.authority.readOnlyEvidenceOnly, true);
  for (const [key, value] of Object.entries(a.authority)) if (key !== 'readOnlyEvidenceOnly') assert.equal(value, false);
  assert.deepEqual(a.claims, {absenceClaimed: false, businessTruthEstablished: false, completenessClaimed: false, replayPreventionClaimed: false, sourceRowsIncluded: false});
  assertFrozen(a);
});

test('fails closed on substituted projections, stale structure evidence, scope drift, unsafe fields and forged results', async () => {
  const sources = await mssqlSources();
  const request = requestFor({engine: 'mssql', schema: 'dbo', prefix: 'Inventory', kindFilters: ['TABLE', 'VIEW']});
  const wrongName = structuredClone(sources.objectNameAuthorityProjection);
  wrongName.objectNameAuthoritySha256 = '0'.repeat(64);
  assert.throws(() => build({...sources, objectNameAuthorityProjection: wrongName}, request));
  const stale = structuredClone(sources.structureEvidence);
  stale.snapshotSha256 = '0'.repeat(64);
  assert.throws(() => build({...sources, structureEvidence: stale}, request));
  assert.throws(() => build(sources, requestFor({engine: 'mssql', schema: 'other', prefix: 'Inventory', kindFilters: ['TABLE']})), {code: 'DB_OBJECT_SEARCH_AUTHORITY_RESULT_SCOPE_DRIFT'});
  for (const extra of [{result: {}}, {sql: 'SELECT 1'}, {credentials: 'secret'}, {callback: 'https://evil.invalid'}]) {
    assert.throws(() => build(sources, request, extra), {code: 'DB_OBJECT_SEARCH_AUTHORITY_RESULT_INPUT_INVALID'});
  }
});
