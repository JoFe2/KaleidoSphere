import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {buildPreflightEvidence, canonicalJson, identitySha256, normalizeJsonValue} from '../services/bi-control/src/db-analyzer/core.mjs';
import {buildObjectInventoryAuthorityDigest} from '../services/bi-control/src/db-analyzer/object-inventory-authority-digest-v1.mjs';
import {buildObjectRelationKindAuthority} from '../services/bi-control/src/db-analyzer/object-relation-kind-authority-v1.mjs';
import {
  buildProgressiveCoverage, buildProgressiveMethodRegistry, createProgressiveCoverage, createProgressiveRun,
} from '../services/bi-control/src/db-analyzer/progressive-controller.mjs';
import {
  OBJECT_NAME_AUTHORITY_ENVELOPE_SCHEMA, OBJECT_NAME_AUTHORITY_SCHEMA,
  buildObjectNameAuthority, verifyObjectNameAuthority,
} from '../services/bi-control/src/db-analyzer/object-name-authority-v1.mjs';
import {runAnalyzeProfile} from '../services/bi-control/src/db-analyzer/workflow.mjs';
import {buildLiveProfile} from '../services/bi-control/src/runtime-config.mjs';

const ROOT = 'services/bi-control';
const MSSQL = `${ROOT}/query-packs/db-analyzer/v1/mssql`;
const ORACLE = `${ROOT}/query-packs/db-analyzer/v1/oracle`;
const STATES = [['COMPLETE', null], ['PARTIAL', 'FIXTURE_PARTIAL'], ['DENIED', 'FIXTURE_DENIED'], ['UNKNOWN', 'FIXTURE_UNKNOWN']];
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const rowFor = (query, values) => Object.fromEntries(query.outputColumns.map((column) => [column, values[column] ?? null]));

function resealEvidence(evidence, mutate) {
  const copy = structuredClone(evidence);
  delete copy.snapshotSha256;
  mutate(copy);
  return {...normalizeJsonValue(copy), snapshotSha256: identitySha256(normalizeJsonValue(copy))};
}

async function mssqlSources({shortIdentifiers = false} = {}) {
  const [structureManifest, profilingManifest, raw] = await Promise.all([
    readJson(`${MSSQL}/manifest.json`), readJson(`${MSSQL}/profiling-manifest.json`),
    runAnalyzeProfile(`${ROOT}/fixtures/mssql-profile-v1.json`, {repositoryRoot: ROOT}),
  ]);
  const evidence = resealEvidence(raw, (body) => {
    const extract = body.extracts.find(({category}) => category === 'relations');
    if (shortIdentifiers) {
      for (const row of extract.rows) row.schema_name = 'a';
      extract.rows[0].relation_name = 'e';
    }
    const row = extract.rows[1];
    const {objectSha256: _old, ...object} = row;
    object.relation_kind = 'VIEW';
    extract.rows[1] = {...normalizeJsonValue(object), objectSha256: identitySha256({queryId: extract.queryId, object: normalizeJsonValue(object)})};
    if (shortIdentifiers) {
      for (let index = 0; index < extract.rows.length; index += 1) {
        const {objectSha256: _digest, ...value} = extract.rows[index];
        extract.rows[index] = {...normalizeJsonValue(value), objectSha256: identitySha256({queryId: extract.queryId, object: normalizeJsonValue(value)})};
      }
    }
  });
  const base = buildProgressiveCoverage(evidence);
  const coverage = createProgressiveCoverage({
    engine: 'mssql', structureSnapshotSha256: base.structureSnapshotSha256,
    structureCoverageLedgerSha256: base.structureCoverageLedgerSha256,
    entries: base.entries.map((entry, index) => ({
      objectRef: entry.objectRef, state: STATES[index % STATES.length][0], reasonCode: STATES[index % STATES.length][1],
      sourceQueryId: entry.sourceQueryId, evidenceRefs: entry.evidenceRefs,
    })), queryCoverage: base.queryCoverage,
  });
  const run = createProgressiveRun({
    runId: 'mssql-relation-kind-secret', engine: 'mssql', scope: evidence.profile.scope,
    methodRegistry: buildProgressiveMethodRegistry({structureManifest, profilingManifest}), coverage,
    budgets: {maxRunProbes: 4, maxObjectProbes: 2},
  });
  const inventoryAuthorityProjection = buildObjectInventoryAuthorityDigest(run);
  const relationKindAuthorityProjection = buildObjectRelationKindAuthority({
    controllerRun: run, inventoryAuthorityProjection, structureEvidence: evidence,
  });
  return {controllerRun: run, inventoryAuthorityProjection, relationKindAuthorityProjection, structureEvidence: evidence};
}

const oracleEnv = {
  BI_ENGINE: 'oracle', ORACLE_HOST: 'oracle-test', ORACLE_PORT: '1521', ORACLE_DATABASE: 'FREE',
  ORACLE_SERVICE_NAME: 'FREEPDB1', ORACLE_USER: 'BI_ANALYZE', ORACLE_SCHEMAS: 'BI_DEMO',
  ORACLE_PROTOCOL: 'tcp', ORACLE_CONNECT_TIMEOUT_MS: '9000', ORACLE_QUERY_TIMEOUT_MS: '7000',
};

async function oracleSources({reverseRows = false} = {}) {
  const manifest = await readJson(`${ORACLE}/manifest.json`);
  const sqlByQueryId = Object.fromEntries(await Promise.all(manifest.queries.map(async (query) => [query.id, await readFile(`${ORACLE}/${query.file}`, 'utf8')])));
  const results = Object.fromEntries(manifest.queries.map((query) => [query.id, {state: 'SUCCEEDED', reasonCode: null, rows: []}]));
  const query = (id) => manifest.queries.find((entry) => entry.id === id);
  results['oracle.preflight.identity'].rows = [rowFor(query('oracle.preflight.identity'), {engine: 'oracle', engine_version: '26ai', database_name: 'FREE', container_name: 'FREEPDB1'})];
  results['oracle.preflight.rights'].rows = [rowFor(query('oracle.preflight.rights'), {permission_name: 'SYSTEM:CREATE SESSION', has_permission: 1})];
  results['oracle.preflight.capabilities'].rows = [rowFor(query('oracle.preflight.capabilities'), {collector_id: 'oracle.structure.relations', capability_name: 'ALL_OBJECTS', visibility_state: 'VISIBLE', minimum_privilege: 'CREATE SESSION', fallback_semantics: 'DENIED_IS_NOT_ABSENT'})];
  results['oracle.structure.schemas'].rows = [rowFor(query('oracle.structure.schemas'), {schema_name: 'BI_DEMO'})];
  const relationRows = [
    rowFor(query('oracle.structure.relations'), {schema_name: 'BI_DEMO', relation_name: 'ORDERS', relation_kind: 'TABLE', object_id: 101, status: 'VALID', temporary: false}),
    rowFor(query('oracle.structure.relations'), {schema_name: 'BI_DEMO', relation_name: 'ORDER_VIEW', relation_kind: 'VIEW', object_id: 102, status: 'VALID', temporary: false}),
  ];
  results['oracle.structure.relations'].rows = reverseRows ? relationRows.reverse() : relationRows;
  results['oracle.structure.columns'].rows = [rowFor(query('oracle.structure.columns'), {schema_name: 'BI_DEMO', relation_name: 'ORDERS', relation_kind: 'TABLE', column_name: 'ORDER_ID', ordinal_position: 1, data_type_schema: 'SYS', data_type: 'NUMBER', is_nullable: false})];
  results['oracle.size.segments'] = {state: 'DENIED', reasonCode: 'ORA_01031', rows: []};
  const profile = buildLiveProfile(oracleEnv, 'CM_ORACLE_PASSWORD');
  const evidence = buildPreflightEvidence({manifest, sqlByQueryId, resultSets: {schemaVersion: 'chimpmaera.db/runtime-query-results/v1', engine: 'oracle', runtimeValidated: true, results}, profileContext: {profileId: profile.profileId, mode: profile.mode, scope: profile.scope, policy: profile.policy, adapter: profile.adapter.kind}});
  const base = buildProgressiveCoverage(evidence);
  const coverage = createProgressiveCoverage({
    engine: 'oracle', structureSnapshotSha256: base.structureSnapshotSha256,
    structureCoverageLedgerSha256: base.structureCoverageLedgerSha256,
    entries: base.entries.map((entry, index) => ({
      objectRef: entry.objectRef, state: STATES[(index % 3) + 1][0], reasonCode: STATES[(index % 3) + 1][1],
      sourceQueryId: entry.sourceQueryId, evidenceRefs: entry.evidenceRefs,
    })), queryCoverage: base.queryCoverage,
  });
  const run = createProgressiveRun({runId: 'oracle-relation-kind-secret', engine: 'oracle', scope: profile.scope, methodRegistry: buildProgressiveMethodRegistry({structureManifest: manifest}), coverage, budgets: {maxRunProbes: 4, maxObjectProbes: 2}});
  const inventoryAuthorityProjection = buildObjectInventoryAuthorityDigest(run);
  const relationKindAuthorityProjection = buildObjectRelationKindAuthority({
    controllerRun: run, inventoryAuthorityProjection, structureEvidence: evidence,
  });
  return {controllerRun: run, inventoryAuthorityProjection, relationKindAuthorityProjection, structureEvidence: evidence};
}

function redigestEvidence(evidence, mutate) {
  return resealEvidence(evidence, (body) => {
    mutate(body);
    for (const extract of body.extracts) {
      for (let index = 0; index < extract.rows.length; index += 1) {
        const {objectSha256: _old, ...object} = extract.rows[index];
        extract.rows[index] = {...normalizeJsonValue(object), objectSha256: identitySha256({queryId: extract.queryId, object: normalizeJsonValue(object)})};
      }
    }
  });
}

// Exact canonical MSSQL mapping: orders is the re-sealed VIEW, customers the TABLE, ordered by objectKey.
const EXPECTED_MSSQL_MAPPINGS = [
  {objectKey: '9bf40aa709bbb2da874f73ff32567272f00065df627fcebb8603c2e1661824da', objectName: 'orders', relationKind: 'VIEW'},
  {objectKey: 'a344bb3b7c186b2515289707b885e11f28e9105c08424b507922903a81c5c922', objectName: 'customers', relationKind: 'TABLE'},
];

test('canonical MSSQL mixed TABLE/VIEW evidence yields the exact ordered frozen name authority mapping and named digest', async () => {
  const sources = await mssqlSources();
  const projection = buildObjectNameAuthority(sources);
  const verified = verifyObjectNameAuthority({...sources, projection});
  assert.equal(verified.schemaVersion, OBJECT_NAME_AUTHORITY_SCHEMA);
  assert.equal(verified.state, 'VERIFIED');
  assert.equal(verified.engine, 'mssql');
  assert.equal(verified.objectNameEnvelopeSchema, OBJECT_NAME_AUTHORITY_ENVELOPE_SCHEMA);
  assert.deepEqual(verified.mappings, EXPECTED_MSSQL_MAPPINGS);
  assert.deepEqual(verified.mappings.map(({objectKey}) => objectKey), verified.mappings.map(({objectKey}) => objectKey).sort());
  assert.equal(verified.objectNameAuthoritySha256, 'a6c6b9cb9f6e0bebd43149b4445ed36906e7336f29e272ea86c571bd24cd0916');
  assert.equal(verified.controllerStateSha256, sources.controllerRun.stateSha256);
  assert.equal(verified.inventoryAuthorityDigestSha256, sources.inventoryAuthorityProjection.authorityDigestSha256);
  assert.equal(verified.relationKindAuthoritySha256, sources.relationKindAuthorityProjection.relationKindAuthoritySha256);
  assert.equal(verified.structureSnapshotSha256, sources.controllerRun.coverage.structureSnapshotSha256);
  assert(Object.isFrozen(verified) && Object.isFrozen(verified.mappings) && verified.mappings.every(Object.isFrozen));
  const bytes = canonicalJson(verified);
  for (const forbidden of ['mssql-relation-kind-secret', 'dbo', 'schemaName', 'sourceObjectSha256']) assert(!bytes.includes(forbidden));
  for (const name of ['orders', 'customers']) assert(bytes.includes(name));
});

test('Oracle canonical ordering is byte-identical and PARTIAL/DENIED/UNKNOWN controller coverage is retained without promotion', async () => {
  const first = await oracleSources();
  const second = await oracleSources({reverseRows: true});
  const a = buildObjectNameAuthority(first);
  const b = buildObjectNameAuthority(second);
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.deepEqual(a.mappings, [
    {objectKey: '0351415bbec464f1935006badbbf13af5f09a125255d6b6037bd31c48faf58d7', objectName: 'ORDERS', relationKind: 'TABLE'},
    {objectKey: '9c838e00bd7f6c6fbd39d12a3893de0d116f45306a13eaaf51d88c5fac950204', objectName: 'ORDER_VIEW', relationKind: 'VIEW'},
  ]);
  assert.equal(a.objectNameAuthoritySha256, '7d2776b02f6d8d56290f8411a926e28b856568b39269a13612e19f27922fc149');
  assert.deepEqual(a.mappings.map(({relationKind}) => relationKind).sort(), ['TABLE', 'VIEW']);
  for (const state of ['PARTIAL', 'DENIED', 'UNKNOWN']) assert(first.controllerRun.coverage.entries.some((entry) => entry.state === state));
  const bytes = canonicalJson(a);
  for (const forbidden of ['oracle-relation-kind-secret', 'BI_DEMO', 'schemaName', 'sourceObjectSha256']) assert(!bytes.includes(forbidden));
  assert(Object.isFrozen(a) && Object.isFrozen(a.mappings));
  assert(!/complete|absence|businessTruth/i.test(bytes));
});

test('fails closed on substitutions, claim material, source mismatches, stale evidence, and fully re-digested forgeries', async () => {
  const sources = await mssqlSources();
  const projection = buildObjectNameAuthority(sources);
  const rejected = [
    {...projection, mappings: projection.mappings.map((entry, index) => index ? entry : {...entry, relationKind: entry.relationKind === 'TABLE' ? 'VIEW' : 'TABLE'})},
    {...projection, mappings: projection.mappings.map((entry, index) => index ? entry : {...entry, objectKey: '0'.repeat(64)})},
    {...projection, mappings: projection.mappings.map((entry, index) => index ? entry : {...entry, objectName: 'forged_name'})},
    {...projection, mappings: projection.mappings.slice(1)},
    {...projection, mappings: [...projection.mappings, projection.mappings[0]]},
    {...projection, schemaName: 'dbo'},
    {...projection, dispatchAuthority: true},
    {...projection, objectNameAuthoritySha256: identitySha256({forged: true})},
  ];
  for (const candidate of rejected) assert.throws(() => verifyObjectNameAuthority({...sources, projection: candidate}));

  const tampered = structuredClone(sources.structureEvidence);
  tampered.extracts.find(({category}) => category === 'relations').rows[0].relation_name = 'forged';
  assert.throws(() => buildObjectNameAuthority({...sources, structureEvidence: tampered}));

  for (const mutate of [
    (body) => { body.engine = 'oracle'; },
    (body) => { body.extracts.find(({category}) => category === 'relations').querySha256 = '0'.repeat(64); },
    (body) => { body.extracts.find(({category}) => category === 'relations').rows.pop(); },
    (body) => { body.extracts.find(({category}) => category === 'relations').rows.push(structuredClone(body.extracts.find(({category}) => category === 'relations').rows[0])); },
    (body) => { body.extracts.find(({category}) => category === 'relations').rows[0].relation_kind = 'VIEW'; },
    (body) => { body.extracts.find(({category}) => category === 'relations').rows[0].relation_name = 'verified_name'; },
    (body) => { body.extracts.find(({category}) => category === 'relations').rows[0].relation_name = 'ORDERS'; },
  ]) {
    const forged = redigestEvidence(sources.structureEvidence, mutate);
    assert.throws(() => buildObjectNameAuthority({...sources, structureEvidence: forged}));
  }
  const wrongInventory = structuredClone(sources.inventoryAuthorityProjection);
  wrongInventory.authorityDigestSha256 = '0'.repeat(64);
  assert.throws(() => buildObjectNameAuthority({...sources, inventoryAuthorityProjection: wrongInventory}));
  const wrongRelationKind = structuredClone(sources.relationKindAuthorityProjection);
  wrongRelationKind.relationKindAuthoritySha256 = '0'.repeat(64);
  assert.throws(() => buildObjectNameAuthority({...sources, relationKindAuthorityProjection: wrongRelationKind}));
});

test('rejects unknown fields, malformed names or digests, unsafe claims, and oversized caller projections', async () => {
  const sources = await mssqlSources();
  const projection = buildObjectNameAuthority(sources);
  const unsafe = [
    null, [], {...projection, callback: () => {}}, {...projection, sql: 'DROP TABLE x'}, {...projection, credentials: 'secret'},
    {...projection, runId: 'public-id'}, {...projection, approvalAuthority: true}, {...projection, mutationAuthority: true},
    {...projection, completeness: true}, {...projection, replayPrevention: true},
    {...projection, mappings: [{objectKey: 'bad', objectName: 'x', relationKind: 'TABLE'}]},
    {...projection, mappings: [{objectKey: '0'.repeat(64), objectName: 'x', relationKind: 'MATERIALIZED_VIEW'}]},
    {...projection, mappings: [{objectKey: '0'.repeat(64), objectName: '', relationKind: 'TABLE'}]},
    {...projection, mappings: [{objectKey: '0'.repeat(64), objectName: 'x'.repeat(129), relationKind: 'TABLE'}]},
    {...projection, mappings: [{objectKey: '0'.repeat(64), objectName: 'verified', relationKind: 'TABLE'}]},
    {...projection, mappings: [{objectKey: '0'.repeat(64), objectName: 'x;DROP', relationKind: 'TABLE'}]},
    {...projection, mappings: [{objectKey: '0'.repeat(64), relationKind: 'TABLE'}]},
    {...projection, mappings: [{objectKey: '0'.repeat(64), objectName: 'x', relationKind: 'TABLE', extra: 1}]},
    {...projection, mappings: Array.from({length: 100001}, () => ({objectKey: '0'.repeat(64), objectName: 'x', relationKind: 'TABLE'}))},
  ];
  for (const candidate of unsafe) assert.throws(() => verifyObjectNameAuthority({...sources, projection: candidate}));
  assert.throws(() => buildObjectNameAuthority({...sources, callerNameMap: {}}));
});

test('fails closed on objectRef substitution', async () => {
  const sources = await mssqlSources();
  const original = sources.controllerRun;
  const coverage = createProgressiveCoverage({
    engine: original.engine,
    structureSnapshotSha256: original.coverage.structureSnapshotSha256,
    structureCoverageLedgerSha256: original.coverage.structureCoverageLedgerSha256,
    entries: original.coverage.entries.map((entry, index) => ({
      objectRef: index ? entry.objectRef : {...entry.objectRef, schemaName: 'substitute'},
      state: entry.state, reasonCode: entry.reasonCode,
      sourceQueryId: entry.sourceQueryId, evidenceRefs: entry.evidenceRefs,
    })),
    queryCoverage: original.coverage.queryCoverage,
  });
  const controllerRun = createProgressiveRun({
    runId: original.runId, engine: original.engine, scope: original.scope,
    methodRegistry: original.methodRegistry, coverage,
    budgets: {maxRunProbes: original.budget.maxRunProbes, maxObjectProbes: original.budget.maxObjectProbes},
  });
  const inventoryAuthorityProjection = buildObjectInventoryAuthorityDigest(controllerRun);
  assert.throws(() => buildObjectNameAuthority({...sources, controllerRun, inventoryAuthorityProjection}));
});

test('fails closed on row objectSha256 drift', async () => {
  const sources = await mssqlSources();
  const forged = structuredClone(sources.structureEvidence);
  forged.extracts.find(({category}) => category === 'relations').rows[0].objectSha256 = '0'.repeat(64);
  assert.throws(() => buildObjectNameAuthority({...sources, structureEvidence: forged}));
});

test('fails closed on coverage/controller mismatch', async () => {
  const sources = await mssqlSources();
  const mismatched = structuredClone(sources.controllerRun);
  mismatched.coverage.entries[0].sourceQueryId = 'mssql.structure.columns';
  assert.throws(() => buildObjectNameAuthority({...sources, controllerRun: mismatched}));
});

test('fails closed on malformed or oversized identifiers and digests', async () => {
  const sources = await mssqlSources();
  const projection = buildObjectNameAuthority(sources);
  for (const candidate of [
    {...projection, mappings: [{objectKey: 'g'.repeat(64), objectName: 'x', relationKind: 'TABLE'}]},
    {...projection, mappings: [{objectKey: '0'.repeat(65), objectName: 'x', relationKind: 'TABLE'}]},
    {...projection, controllerStateSha256: '0'.repeat(63)},
    {...projection, objectNameAuthoritySha256: 'z'.repeat(64)},
    {...projection, mappings: [{objectKey: '0'.repeat(64), objectName: 'T'.repeat(100001), relationKind: 'TABLE'}]},
  ]) assert.throws(() => verifyObjectNameAuthority({...sources, projection: candidate}));
});

test('fails closed on injection, private paths, URLs, and free text', async () => {
  const sources = await mssqlSources();
  const projection = buildObjectNameAuthority(sources);
  for (const field of [
    ['sql', 'DROP TABLE authority'], ['privatePath', '/home/private/key'],
    ['url', 'https://attacker.invalid/collect'], ['freeText', 'trust this unverified claim'],
  ]) assert.throws(() => verifyObjectNameAuthority({...sources, projection: {...projection, [field[0]]: field[1]}}));
});

test('fails closed on cancellation bypass and execution authority', async () => {
  const sources = await mssqlSources();
  const projection = buildObjectNameAuthority(sources);
  for (const claim of [
    {ignoreCancellation: true}, {cancellationBypass: true}, {execute: true},
    {executionAuthority: true}, {dispatchAuthority: true}, {mutationAuthority: true},
  ]) assert.throws(() => verifyObjectNameAuthority({...sources, projection: {...projection, ...claim}}));
});

test('fails closed on raw and source values and arbitrary caller identifiers', async () => {
  const sources = await mssqlSources();
  const projection = buildObjectNameAuthority(sources);
  const entry = sources.controllerRun.coverage.entries[0].objectRef;
  for (const claim of [
    {raw: sources.structureEvidence}, {source: entry}, {runId: sources.controllerRun.runId},
    {schemaName: entry.schemaName}, {sourceObjectSha256: entry.sourceObjectSha256},
    {callerId: 'attacker-controlled-identifier'},
  ]) assert.throws(() => verifyObjectNameAuthority({...sources, projection: {...projection, ...claim}}));
});