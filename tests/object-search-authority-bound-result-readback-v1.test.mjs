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
    runId: `${engine}-authority-search-readback-secret`, engine, scope: evidence.profile.scope,
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

const resealedItem = (item) => {
  const {itemSha256: _observed, ...rest} = normalizeJsonValue(item);
  return {...rest, itemSha256: identitySha256(rest)};
};
const resealed = (body) => {
  const {projectionSha256: _observed, ...rest} = normalizeJsonValue(body);
  return {...rest, projectionSha256: identitySha256(rest)};
};

test('MSSQL and Oracle first-page results verify deterministically against the same exact input', async () => {
  const mssqlSources_ = await mssqlSources();
  const mssqlRequest = requestFor({engine: 'mssql', schema: 'dbo', prefix: 'Inventory', kindFilters: ['TABLE', 'VIEW']});
  const mssqlInput = {...mssqlSources_, request: mssqlRequest};
  const mssqlResult = buildObjectSearchAuthorityBoundResult(mssqlInput);
  assert.equal(mssqlResult.page.hasNext, true);
  assert(mssqlResult.nextCursor);
  assert.equal(verifyObjectSearchAuthorityBoundResult(mssqlResult, mssqlInput), mssqlResult);
  assert.equal(canonicalJson(verifyObjectSearchAuthorityBoundResult(mssqlResult, {...mssqlInput})), canonicalJson(mssqlResult));

  const oracleSources_ = await oracleSources();
  const oracleRequest = requestFor({engine: 'oracle', schema: 'BI_DEMO', prefix: 'Order', kindFilters: ['TABLE'], pageSize: 10});
  const oracleInput = {...oracleSources_, request: oracleRequest};
  const oracleResult = buildObjectSearchAuthorityBoundResult(oracleInput);
  assert.equal(oracleResult.page.hasNext, false);
  assert.equal(oracleResult.nextCursor, null);
  assert.equal(verifyObjectSearchAuthorityBoundResult(oracleResult, oracleInput), oracleResult);
});

test('empty and hasNext first-page cases verify and the verifier returns the supplied projection without widening its envelope', async () => {
  const sources = await mssqlSources();
  const request = requestFor({engine: 'mssql', schema: 'dbo', prefix: 'Inventory', kindFilters: ['TABLE', 'VIEW']});
  const input = {...sources, request};
  const first = build(sources, request);
  const verified = verifyObjectSearchAuthorityBoundResult(first, input);
  assert.equal(verified, first);
  assert.deepEqual(verified.claims, first.claims);
  assert.deepEqual(verified.authority, first.authority);
  assert.equal(canonicalJson(verified), canonicalJson(first));

  const emptySources = await oracleSources();
  const emptyRequest = requestFor({engine: 'oracle', schema: 'BI_DEMO', prefix: 'Missing', kindFilters: ['VIEW'], pageSize: 10});
  const emptyInput = {...emptySources, request: emptyRequest};
  const empty = build(emptySources, emptyRequest);
  assert.deepEqual(empty.items, []);
  assert.equal(empty.page.matchCount, 0);
  assert.equal(empty.nextCursor, null);
  assert.equal(verifyObjectSearchAuthorityBoundResult(empty, emptyInput), empty);
});

test('unchanged-projectionSha256 field, item, page, cursor, binding, claims or authority substitution fails closed with one fixed code', async () => {
  const sources = await mssqlSources();
  const request = requestFor({engine: 'mssql', schema: 'dbo', prefix: 'Inventory', kindFilters: ['TABLE', 'VIEW'], pageSize: 10});
  const input = {...sources, request};
  const result = build(sources, request);
  assert.equal(result.items.length, 2);
  assert.equal(result.nextCursor, null);
  const cases = [
    (body) => {body.items = [body.items[1], body.items[0]];},
    (body) => {body.items[0].objectName = 'ForgedTable';},
    (body) => {body.items[0].relationKind = 'VIEW';},
    (body) => {body.items[0].coverage.visibility = 'VISIBLE';},
    (body) => {body.items[0].evidenceRefs = ['forged-evidence-ref'];},
    (body) => {body.page.matchCount = 3;},
    (body) => {body.page.itemCount = 1; body.page.remainingCount = 1;},
    (body) => {body.page.startOrdinal = 1; body.page.endOrdinal = 2;},
    (body) => {body.page.hasNext = true;},
    (body) => {body.bindings.controllerStateSha256 = '0'.repeat(64);},
    (body) => {body.bindings.controllerCoverageSha256 = '0'.repeat(64);},
    (body) => {body.bindings.inventoryAuthorityDigestSha256 = '0'.repeat(64);},
    (body) => {body.bindings.relationKindAuthoritySha256 = '0'.repeat(64);},
    (body) => {body.bindings.objectNameAuthoritySha256 = '0'.repeat(64);},
    (body) => {body.bindings.structureSnapshotSha256 = '0'.repeat(64);},
    (body) => {body.bindings.envelopeSha256 = '0'.repeat(64);},
    (body) => {body.claims.absenceClaimed = true;},
    (body) => {body.claims.replayPreventionClaimed = true;},
    (body) => {body.authority.sqlAuthority = true;},
    (body) => {body.authority.executionAuthority = true;},
    (body) => {body.authority.mutationAuthority = true;},
    (body) => {body.authority.dispatchAuthority = true;},
    (body) => {body.authority.readOnlyEvidenceOnly = false;},
  ];
  for (const mutate of cases) {
    const body = structuredClone(result);
    mutate(body);
    assert.throws(() => verifyObjectSearchAuthorityBoundResult(body, input), {code: FORGED, message: FORGED});
  }

  const cursorRequest = requestFor({engine: 'mssql', schema: 'dbo', prefix: 'Inventory', kindFilters: ['TABLE', 'VIEW']});
  const cursorInput = {...sources, request: cursorRequest};
  const cursorResult = build(sources, cursorRequest);
  assert(cursorResult.nextCursor);
  const cursorCases = [
    (body) => {body.nextCursor = null;},
    (body) => {body.page.hasNext = false;},
    (body) => {body.nextCursor.pageIndex = 2;},
  ];
  for (const mutate of cursorCases) {
    const body = structuredClone(cursorResult);
    mutate(body);
    assert.throws(() => verifyObjectSearchAuthorityBoundResult(body, cursorInput), {code: FORGED, message: FORGED});
  }
});

test('fully re-digested forged items, cursor, bindings, claims or authority still fail closed', async () => {
  const sources = await mssqlSources();
  const request = requestFor({engine: 'mssql', schema: 'dbo', prefix: 'Inventory', kindFilters: ['TABLE', 'VIEW'], pageSize: 10});
  const input = {...sources, request};
  const result = build(sources, request);
  const cursorRequest = requestFor({engine: 'mssql', schema: 'dbo', prefix: 'Inventory', kindFilters: ['TABLE', 'VIEW']});
  const cursorInput = {...sources, request: cursorRequest};
  const cursorResult = build(sources, cursorRequest);
  const cases = [
    (body) => {body.items = [body.items[1], body.items[0]];},
    (body) => {body.items[0].objectName = 'ForgedTable'; body.items[0] = resealedItem(body.items[0]);},
    (body) => {body.items[0].relationKind = 'VIEW'; body.items[0] = resealedItem(body.items[0]);},
    (body) => {body.items[0].coverage.visibility = 'VISIBLE'; body.items[0] = resealedItem(body.items[0]);},
    (body) => {body.page.matchCount = 3;},
    (body) => {body.bindings.objectNameAuthoritySha256 = 'f'.repeat(64);},
    (body) => {body.claims.absenceClaimed = true;},
    (body) => {body.authority.sqlAuthority = true;},
  ];
  for (const mutate of cases) {
    const cloned = structuredClone(result);
    mutate(cloned);
    const body = resealed(cloned);
    assert.throws(() => verifyObjectSearchAuthorityBoundResult(body, input), {code: FORGED, message: FORGED});
  }
  const cursorBody = structuredClone(cursorResult);
  cursorBody.nextCursor.pageIndex = 2;
  const {cursorSha256: _observed, ...cursorRest} = normalizeJsonValue(cursorBody.nextCursor);
  cursorBody.nextCursor = {...cursorRest, cursorSha256: identitySha256(cursorRest)};
  const cursorRedigested = resealed(cursorBody);
  assert.throws(() => verifyObjectSearchAuthorityBoundResult(cursorRedigested, cursorInput), {code: FORGED, message: FORGED});
});

test('verifier fails closed with the single fixed code on tampered or widened authoritative inputs without revealing values', async () => {
  const sources = await mssqlSources();
  const request = requestFor({engine: 'mssql', schema: 'dbo', prefix: 'Inventory', kindFilters: ['TABLE', 'VIEW']});
  const input = {...sources, request};
  const result = build(sources, request);
  const wrongName = structuredClone(sources.objectNameAuthorityProjection);
  wrongName.objectNameAuthoritySha256 = '0'.repeat(64);
  const stale = structuredClone(sources.structureEvidence);
  stale.snapshotSha256 = '0'.repeat(64);
  const badInputs = [
    {...input, objectNameAuthorityProjection: wrongName},
    {...input, structureEvidence: stale},
    {...input, request: requestFor({engine: 'mssql', schema: 'other', prefix: 'Inventory', kindFilters: ['TABLE']})},
    {...input, request: requestFor({engine: 'mssql', schema: 'dbo', prefix: 'Forged', kindFilters: ['TABLE', 'VIEW']})},
    {...input, request: requestFor({engine: 'mssql', schema: 'dbo', prefix: 'Inventory', kindFilters: ['COLUMN']})},
    {...input, cursor: result.nextCursor},
    {...input, pageIndex: 1},
    {...input, sql: 'SELECT secret FROM sys.tables'},
    {...input, credentials: 'BI_ANALYZE_password_secret'},
    {...input, callback: 'https://evil.invalid'},
  ];
  for (const badInput of badInputs) {
    assert.throws(() => verifyObjectSearchAuthorityBoundResult(result, badInput), {code: FORGED, message: FORGED});
  }
  for (const projection of [null, 'forged', 7, {...structuredClone(result), extraAuthority: true}]) {
    assert.throws(() => verifyObjectSearchAuthorityBoundResult(projection, input), {code: FORGED, message: FORGED});
  }
});