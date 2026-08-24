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
  buildObjectSearchAuthorityBoundResult,
  verifyObjectSearchAuthorityBoundResult,
} from '../services/bi-control/src/db-analyzer/object-search-authority-bound-result-v1.mjs';

const FORGED = 'DB_OBJECT_SEARCH_AUTHORITY_RESULT_FORGED';
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
    runId: `${engine}-authority-search-canonical-number-secret`, engine, scope: evidence.profile.scope,
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

const build = (sources, request) => buildObjectSearchAuthorityBoundResult({...sources, request});

const recomputedDigest = (body) => {
  const {projectionSha256: _observed, ...rest} = body;
  return {...body, projectionSha256: identitySha256(rest)};
};

test('cloned first-page projection with negative zero pageIndex and unchanged projection digest fails closed with the fixed forged code', async () => {
  const sources = await mssqlSources();
  const request = requestFor({engine: 'mssql', schema: 'dbo', prefix: 'Inventory', kindFilters: ['TABLE', 'VIEW']});
  const input = {...sources, request};
  const result = build(sources, request);
  assert(result.nextCursor);
  const body = structuredClone(result);
  body.page.pageIndex = -0;
  assert.equal(body.projectionSha256, result.projectionSha256);
  assert.throws(() => verifyObjectSearchAuthorityBoundResult(body, input), {code: FORGED, message: FORGED});
});

test('fully recomputed projection digest beside negative zero pageIndex still fails closed', async () => {
  const sources = await mssqlSources();
  const request = requestFor({engine: 'mssql', schema: 'dbo', prefix: 'Inventory', kindFilters: ['TABLE', 'VIEW']});
  const input = {...sources, request};
  const result = build(sources, request);
  const body = structuredClone(result);
  body.page.pageIndex = -0;
  const redigested = recomputedDigest(body);
  assert.equal(redigested.projectionSha256, result.projectionSha256);
  assert(Object.is(redigested.page.pageIndex, -0));
  assert.throws(() => verifyObjectSearchAuthorityBoundResult(redigested, input), {code: FORGED, message: FORGED});
});

test('negative zero in any supplied projection numeric field fails closed with the fixed forged code', async () => {
  const sources = await mssqlSources();
  const request = requestFor({engine: 'mssql', schema: 'dbo', prefix: 'Inventory', kindFilters: ['TABLE', 'VIEW']});
  const input = {...sources, request};
  const result = build(sources, request);
  const cases = [
    (body) => {body.page.pageIndex = -0;},
    (body) => {body.page.pageSize = -0;},
    (body) => {body.page.startOrdinal = -0;},
    (body) => {body.page.endOrdinal = -0;},
    (body) => {body.page.itemCount = -0;},
    (body) => {body.page.matchCount = -0;},
    (body) => {body.page.remainingCount = -0;},
    (body) => {body.nextCursor.pageIndex = -0;},
  ];
  for (const mutate of cases) {
    const body = structuredClone(result);
    mutate(body);
    assert.throws(() => verifyObjectSearchAuthorityBoundResult(body, input), {code: FORGED, message: FORGED});
  }
  const emptySources = await oracleSources();
  const emptyRequest = requestFor({engine: 'oracle', schema: 'BI_DEMO', prefix: 'Missing', kindFilters: ['VIEW'], pageSize: 10});
  const emptyInput = {...emptySources, request: emptyRequest};
  const empty = build(emptySources, emptyRequest);
  const emptyCases = [
    (body) => {body.page.pageIndex = -0;},
    (body) => {body.page.pageSize = -0;},
    (body) => {body.page.startOrdinal = -0;},
    (body) => {body.page.endOrdinal = -0;},
    (body) => {body.page.itemCount = -0;},
    (body) => {body.page.matchCount = -0;},
    (body) => {body.page.remainingCount = -0;},
  ];
  for (const mutate of emptyCases) {
    const body = structuredClone(empty);
    mutate(body);
    assert.throws(() => verifyObjectSearchAuthorityBoundResult(body, emptyInput), {code: FORGED, message: FORGED});
  }
});

test('non-finite or unsafe projection numbers fail closed with the fixed forged code', async () => {
  const sources = await mssqlSources();
  const request = requestFor({engine: 'mssql', schema: 'dbo', prefix: 'Inventory', kindFilters: ['TABLE', 'VIEW']});
  const input = {...sources, request};
  const result = build(sources, request);
  for (const value of [NaN, Infinity, -Infinity]) {
    const body = structuredClone(result);
    body.page.matchCount = value;
    assert.throws(() => verifyObjectSearchAuthorityBoundResult(body, input), {code: FORGED, message: FORGED});
  }
  for (const projection of [-0, {page: {pageIndex: -0}}]) {
    assert.throws(() => verifyObjectSearchAuthorityBoundResult(projection, input), {code: FORGED, message: FORGED});
  }
});

test('canonical zero and safe derived integers retain deterministic MSSQL and Oracle first-page construction and verification', async () => {
  const mssqlSources_ = await mssqlSources();
  const mssqlRequest = requestFor({engine: 'mssql', schema: 'dbo', prefix: 'Inventory', kindFilters: ['TABLE', 'VIEW']});
  const mssqlInput = {...mssqlSources_, request: mssqlRequest};
  const mssqlResult = build(mssqlSources_, mssqlRequest);
  assert(Object.is(mssqlResult.page.pageIndex, 0));
  assert(Object.is(mssqlResult.page.startOrdinal, 0));
  assert.equal(mssqlResult.page.pageSize, 1);
  assert.equal(mssqlResult.page.itemCount, 1);
  assert.equal(mssqlResult.page.matchCount, 2);
  assert.equal(mssqlResult.page.remainingCount, 1);
  assert.equal(mssqlResult.nextCursor.pageIndex, 1);
  assert.equal(verifyObjectSearchAuthorityBoundResult(mssqlResult, mssqlInput), mssqlResult);
  assert.equal(canonicalJson(verifyObjectSearchAuthorityBoundResult(structuredClone(mssqlResult), mssqlInput)), canonicalJson(mssqlResult));

  const fullSources = await mssqlSources();
  const fullRequest = requestFor({engine: 'mssql', schema: 'dbo', prefix: 'Inventory', kindFilters: ['TABLE', 'VIEW'], pageSize: 10});
  const fullInput = {...fullSources, request: fullRequest};
  const full = build(fullSources, fullRequest);
  assert.equal(full.page.endOrdinal, 1);
  assert.equal(full.page.remainingCount, 0);
  assert.equal(full.nextCursor, null);
  assert.equal(verifyObjectSearchAuthorityBoundResult(full, fullInput), full);

  const oracleSources_ = await oracleSources();
  const oracleRequest = requestFor({engine: 'oracle', schema: 'BI_DEMO', prefix: 'Missing', kindFilters: ['VIEW'], pageSize: 10});
  const oracleInput = {...oracleSources_, request: oracleRequest};
  const oracle = build(oracleSources_, oracleRequest);
  assert(Object.is(oracle.page.matchCount, 0));
  assert(Object.is(oracle.page.itemCount, 0));
  assert(Object.is(oracle.page.remainingCount, 0));
  assert.equal(oracle.page.endOrdinal, -1);
  assert.equal(oracle.nextCursor, null);
  assert.equal(verifyObjectSearchAuthorityBoundResult(oracle, oracleInput), oracle);
  assert.equal(canonicalJson(verifyObjectSearchAuthorityBoundResult(oracle, oracleInput)), canonicalJson(oracle));
});