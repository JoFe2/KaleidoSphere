import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {
  buildPreflightEvidence,
  canonicalJson,
  identitySha256,
  normalizeJsonValue,
} from '../services/bi-control/src/db-analyzer/core.mjs';
import {
  buildProgressiveCoverage,
  buildProgressiveMethodRegistry,
  createProgressiveCoverage,
  createProgressiveRun,
  resumeProgressiveRun,
} from '../services/bi-control/src/db-analyzer/progressive-controller.mjs';
import {
  buildObjectInventoryAuthorityDigest,
  verifyObjectInventoryAuthorityDigest,
} from '../services/bi-control/src/db-analyzer/object-inventory-authority-digest-v1.mjs';
import {
  createObjectInventorySnapshot,
  createObjectSearchCoverageBinding,
  createObjectSearchEnvelope,
  resumeObjectSearchEnvelope,
} from '../services/bi-control/src/db-analyzer/object-search-envelope-v1.mjs';
import {runAnalyzeProfile} from '../services/bi-control/src/db-analyzer/workflow.mjs';
import {buildLiveProfile} from '../services/bi-control/src/runtime-config.mjs';
import {
  OBJECT_SEARCH_AUTHORITY_BOUND_CURSOR_SCHEMA,
  OBJECT_SEARCH_AUTHORITY_BOUND_RESULT_SCHEMA,
  buildObjectSearchAuthorityBoundResult,
} from '../services/bi-control/src/db-analyzer/object-search-authority-bound-result-v1.mjs';

const ROOT = 'services/bi-control';
const MSSQL_DIRECTORY = `${ROOT}/query-packs/db-analyzer/v1/mssql`;
const ORACLE_DIRECTORY = `${ROOT}/query-packs/db-analyzer/v1/oracle`;
const DIGEST = /^[a-f0-9]{64}$/;
const MIXED_STATES = Object.freeze([
  ['COMPLETE', null],
  ['PARTIAL', 'FIXTURE_PARTIAL'],
  ['DENIED', 'FIXTURE_DENIED'],
  ['UNKNOWN', 'FIXTURE_UNKNOWN'],
]);
const ORACLE_STATE_BY_KIND = Object.freeze({
  SCHEMA: Object.freeze(['UNKNOWN', 'FIXTURE_UNKNOWN']),
  RELATION: Object.freeze(['PARTIAL', 'FIXTURE_PARTIAL']),
  COLUMN: Object.freeze(['DENIED', 'FIXTURE_DENIED']),
});
const VISIBILITY = Object.freeze({
  COMPLETE: 'VISIBLE',
  PARTIAL: 'VISIBLE_PARTIAL',
  DENIED: 'INVISIBLE',
  UNSUPPORTED: 'NOT_APPLICABLE',
  UNKNOWN: 'UNKNOWN',
});

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function mssqlInputs() {
  const [structureManifest, profilingManifest, structureEvidence] = await Promise.all([
    readJson(`${MSSQL_DIRECTORY}/manifest.json`),
    readJson(`${MSSQL_DIRECTORY}/profiling-manifest.json`),
    runAnalyzeProfile(`${ROOT}/fixtures/mssql-profile-v1.json`, {repositoryRoot: ROOT}),
  ]);
  return {structureManifest, profilingManifest, structureEvidence};
}

function mixedCoverage(structureEvidence) {
  const base = buildProgressiveCoverage(structureEvidence);
  return createProgressiveCoverage({
    engine: 'mssql',
    structureSnapshotSha256: base.structureSnapshotSha256,
    structureCoverageLedgerSha256: base.structureCoverageLedgerSha256,
    entries: base.entries.map((entry, index) => {
      const [state, reasonCode] = MIXED_STATES[index % MIXED_STATES.length];
      return {objectRef: entry.objectRef, state, reasonCode, sourceQueryId: entry.sourceQueryId, evidenceRefs: entry.evidenceRefs};
    }),
    queryCoverage: base.queryCoverage,
  });
}

async function mssqlRun({coverageOverride} = {}) {
  const {structureManifest, profilingManifest, structureEvidence} = await mssqlInputs();
  return createProgressiveRun({
    runId: 'fixture-mssql-authority-digest-v1',
    engine: 'mssql',
    scope: structureEvidence.profile.scope,
    methodRegistry: buildProgressiveMethodRegistry({structureManifest, profilingManifest}),
    coverage: coverageOverride ?? mixedCoverage(structureEvidence),
    budgets: {maxRunProbes: 4, maxObjectProbes: 2},
  });
}

const oracleEnv = {
  BI_ENGINE: 'oracle', ORACLE_HOST: 'oracle-test', ORACLE_PORT: '1521', ORACLE_DATABASE: 'FREE',
  ORACLE_SERVICE_NAME: 'FREEPDB1', ORACLE_USER: 'BI_ANALYZE', ORACLE_SCHEMAS: 'BI_DEMO',
  ORACLE_PROTOCOL: 'tcp', ORACLE_CONNECT_TIMEOUT_MS: '9000', ORACLE_QUERY_TIMEOUT_MS: '7000',
};

function rowFor(query, values) {
  return Object.fromEntries(query.outputColumns.map((column) => [column, Object.hasOwn(values, column) ? values[column] : null]));
}

async function oracleInputs() {
  const structureManifest = await readJson(`${ORACLE_DIRECTORY}/manifest.json`);
  const sqlByQueryId = Object.fromEntries(await Promise.all(structureManifest.queries.map(async (query) => [
    query.id, await readFile(`${ORACLE_DIRECTORY}/${query.file}`, 'utf8'),
  ])));
  const results = Object.fromEntries(structureManifest.queries.map((query) => [query.id, {state: 'SUCCEEDED', reasonCode: null, rows: []}]));
  const query = (id) => structureManifest.queries.find((entry) => entry.id === id);
  results['oracle.preflight.identity'].rows = [rowFor(query('oracle.preflight.identity'), {
    engine: 'oracle', engine_version: '26ai-fixture', database_name: 'FREE', container_name: 'FREEPDB1',
  })];
  results['oracle.preflight.rights'].rows = [rowFor(query('oracle.preflight.rights'), {
    permission_name: 'SYSTEM:CREATE SESSION', has_permission: 1,
  })];
  results['oracle.preflight.capabilities'].rows = [rowFor(query('oracle.preflight.capabilities'), {
    collector_id: 'oracle.structure.relations', capability_name: 'ALL_OBJECTS', visibility_state: 'VISIBLE',
    minimum_privilege: 'CREATE SESSION', fallback_semantics: 'DENIED_IS_NOT_ABSENT',
  })];
  results['oracle.structure.schemas'].rows = [rowFor(query('oracle.structure.schemas'), {schema_name: 'BI_DEMO'})];
  results['oracle.structure.relations'].rows = [rowFor(query('oracle.structure.relations'), {
    schema_name: 'BI_DEMO', relation_name: 'ORDERS', relation_kind: 'TABLE', object_id: 101,
    status: 'VALID', temporary: false,
  })];
  results['oracle.structure.columns'].rows = [rowFor(query('oracle.structure.columns'), {
    schema_name: 'BI_DEMO', relation_name: 'ORDERS', relation_kind: 'TABLE', column_name: 'ORDER_ID',
    ordinal_position: 1, data_type_schema: 'SYS', data_type: 'NUMBER', is_nullable: false,
  })];
  results['oracle.size.segments'] = {state: 'DENIED', reasonCode: 'ORA_01031', rows: []};
  const profile = buildLiveProfile(oracleEnv, 'CM_ORACLE_PASSWORD');
  const structureEvidence = buildPreflightEvidence({
    manifest: structureManifest,
    sqlByQueryId,
    resultSets: {schemaVersion: 'chimpmaera.db/runtime-query-results/v1', engine: 'oracle', runtimeValidated: true, results},
    profileContext: {profileId: profile.profileId, mode: profile.mode, scope: profile.scope, policy: profile.policy, adapter: profile.adapter.kind},
  });
  return {structureManifest, structureEvidence, scope: profile.scope};
}

function oracleMixedCoverage(structureEvidence) {
  const base = buildProgressiveCoverage(structureEvidence);
  return createProgressiveCoverage({
    engine: 'oracle',
    structureSnapshotSha256: base.structureSnapshotSha256,
    structureCoverageLedgerSha256: base.structureCoverageLedgerSha256,
    entries: base.entries.map((entry) => {
      const [state, reasonCode] = ORACLE_STATE_BY_KIND[entry.objectRef.kind];
      return {objectRef: entry.objectRef, state, reasonCode, sourceQueryId: entry.sourceQueryId, evidenceRefs: entry.evidenceRefs};
    }),
    queryCoverage: base.queryCoverage,
  });
}

async function oracleRun({coverageOverride} = {}) {
  const {structureManifest, structureEvidence, scope} = await oracleInputs();
  return createProgressiveRun({
    runId: 'fixture-oracle-authority-digest-v1',
    engine: 'oracle',
    scope,
    methodRegistry: buildProgressiveMethodRegistry({structureManifest}),
    coverage: coverageOverride ?? oracleMixedCoverage(structureEvidence),
    budgets: {maxRunProbes: 4, maxObjectProbes: 2},
  });
}

function withRunBody(run, changes) {
  const {stateSha256: _previousState, ...body} = structuredClone(run);
  const normalized = normalizeJsonValue(body);
  return {...normalized, ...normalizeJsonValue(changes), stateSha256: identitySha256(normalizeJsonValue({...normalized, ...normalizeJsonValue(changes)}))};
}

const mssqlRequest = ({prefix = 'dbo', kindFilters = ['TABLE', 'VIEW'], pageSize = 1, schemas = ['dbo']} = {}) => createObjectSearchEnvelope({
  engine: 'mssql',
  scope: {schemas},
  prefix,
  kindFilters,
  pageSize,
  inventory: createObjectInventorySnapshot({engine: 'mssql', kindCounts: {TABLE: 2, VIEW: 0, COLUMN: 3, INDEX: 1, SEQUENCE: 0, SYNONYM: 0}}),
  coverage: createObjectSearchCoverageBinding({stateCounts: {SUCCEEDED: 5, PARTIAL: 1, DENIED: 1, UNSUPPORTED: 0, TIMEOUT: 0, ERROR: 0}}),
});

const oracleRequest = ({prefix = 'BI_DEMO', kindFilters = ['TABLE', 'VIEW', 'COLUMN'], pageSize = 10, schemas = ['BI_DEMO']} = {}) => createObjectSearchEnvelope({
  engine: 'oracle',
  scope: {schemas},
  prefix,
  kindFilters,
  pageSize,
  inventory: createObjectInventorySnapshot({engine: 'oracle', kindCounts: {TABLE: 1, VIEW: 0, COLUMN: 1, INDEX: 0, SEQUENCE: 0, SYNONYM: 0}}),
  coverage: createObjectSearchCoverageBinding({stateCounts: {SUCCEEDED: 5, PARTIAL: 1, DENIED: 1, UNSUPPORTED: 0, TIMEOUT: 0, ERROR: 0}}),
});

function assertResultOmissions(result, run) {
  const bytes = canonicalJson(result);
  assert(!bytes.includes(run.runId), 'runId absent from output bytes');
  for (const entry of run.coverage.entries) {
    assert(!bytes.includes(entry.objectRef.sourceObjectSha256), 'sourceObjectSha256 absent from output bytes');
    for (const name of [entry.objectRef.schemaName, entry.objectRef.relationName, entry.objectRef.columnName, entry.objectRef.objectName]) {
      if (name !== null) assert(!bytes.includes(`"${name}"`), `raw object identifier ${name} absent from output bytes`);
    }
  }
  for (const value of [run.scope.database, run.scope.container, ...run.scope.schemas]) {
    if (value !== null) assert(!bytes.includes(`"${value}"`), `raw scope identifier ${value} absent from output bytes`);
  }
  const allowed = new Set([
    result.bindings.controllerStateSha256,
    result.bindings.identityCommitmentSha256,
    result.bindings.authorityDigestSha256,
    result.bindings.envelopeSha256,
    result.bindings.inventorySnapshotSha256,
    ...result.items.flatMap((item) => [item.objectKey, item.itemSha256, ...item.evidenceRefs]),
    result.projectionSha256,
  ]);
  if (result.nextCursor !== null) allowed.add(result.nextCursor.opaqueDigest).add(result.nextCursor.cursorSha256);
  assert((bytes.match(/[a-f0-9]{64}/g) ?? []).every((value) => allowed.has(value)), 'no digest outside the bound set leaks into output bytes');
}

test('canonical mixed-coverage MSSQL run + exact W17 projection + TABLE/VIEW prefix request yield the exact authority-bound first page with next cursor', async () => {
  const run = await mssqlRun();
  assert(resumeProgressiveRun(run), 'run is an independently validated progressive controller run');
  for (const state of ['COMPLETE', 'PARTIAL', 'DENIED', 'UNKNOWN']) {
    assert(run.coverage.summary.stateCounts[state] > 0, `coverage carries ${state}`);
  }
  const projection = buildObjectInventoryAuthorityDigest(run);
  assert.equal(verifyObjectInventoryAuthorityDigest({controllerRun: run, projection}).state, 'VERIFIED', 'exact W17 projection verifies');
  const request = mssqlRequest();

  const result = buildObjectSearchAuthorityBoundResult({controllerRun: run, projection, request});

  // authoritative filtered match set recomputed from the unchanged validated run
  const matches = run.coverage.entries.filter((entry) => {
    const {objectRef} = entry;
    return objectRef.kind === 'RELATION' && objectRef.schemaName === 'dbo'
      && [objectRef.schemaName, objectRef.relationName].join('.').startsWith('dbo');
  });
  assert.equal(matches.length, 2, 'run carries two dbo RELATION identities');

  assert.equal(result.schemaVersion, OBJECT_SEARCH_AUTHORITY_BOUND_RESULT_SCHEMA);
  assert.equal(result.type, 'OBJECT_SEARCH_AUTHORITY_BOUND_RESULT');
  assert.equal(result.state, 'PROJECTED');
  assert.equal(result.engine, 'mssql');
  assert.equal(result.bindings.controllerStateSha256, run.stateSha256);
  assert.equal(result.bindings.identityCommitmentSha256, projection.identityCommitmentSha256);
  assert.equal(result.bindings.authorityDigestSha256, projection.authorityDigestSha256);
  assert.equal(result.bindings.envelopeSha256, request.envelopeSha256);
  assert.equal(result.bindings.inventorySnapshotSha256, request.inventory.inventorySha256);

  assert.deepEqual(result.page, {
    pageIndex: 0, pageSize: 1, startOrdinal: 0, endOrdinal: 0,
    itemCount: 1, matchCount: 2, remainingCount: 1, hasNext: true,
  });

  const first = matches[0];
  assert.equal(result.items.length, 1);
  const [item] = result.items;
  assert.equal(item.objectKey, first.objectKey, 'item identity is recomputed from the validated run');
  assert.equal(item.objectKind, first.objectRef.kind);
  assert.deepEqual(item.coverage, {state: first.state, reasonCode: first.reasonCode, visibility: VISIBILITY[first.state]}, 'explicit per-item coverage state/reason');
  assert.deepEqual(item.evidenceRefs, first.evidenceRefs.filter((ref) => ref !== first.objectRef.sourceObjectSha256), 'per-item evidence binding without the source row digest');
  assert(!item.evidenceRefs.includes(first.objectRef.sourceObjectSha256));
  assert(DIGEST.test(item.itemSha256));

  assert(result.nextCursor !== null, 'authority-bound next cursor is emitted while matches remain');
  assert.equal(result.nextCursor.schemaVersion, OBJECT_SEARCH_AUTHORITY_BOUND_CURSOR_SCHEMA);
  assert.equal(result.nextCursor.pageIndex, 1);
  assert.equal(result.nextCursor.envelopeSha256, request.envelopeSha256);
  assert.equal(result.nextCursor.controllerStateSha256, run.stateSha256);
  assert.equal(result.nextCursor.identityCommitmentSha256, projection.identityCommitmentSha256);
  assert.equal(result.nextCursor.authorityDigestSha256, projection.authorityDigestSha256);
  assert(DIGEST.test(result.nextCursor.opaqueDigest) && DIGEST.test(result.nextCursor.cursorSha256));

  assert.deepEqual(result.claims, {
    absenceClaimed: false, businessTruthEstablished: false, completenessClaimed: false,
    replayPreventionClaimed: false, sourceRowsIncluded: false,
  });
  assert(result.authority.readOnlyEvidenceOnly === true);
  for (const key of Object.keys(result.authority)) {
    if (key !== 'readOnlyEvidenceOnly') assert.equal(result.authority[key], false, `authority ${key} stays denied`);
  }

  const again = buildObjectSearchAuthorityBoundResult({controllerRun: run, projection, request});
  assert.equal(canonicalJson(again), canonicalJson(result), 'result bytes are deterministic');
  assert(Object.isFrozen(result) && Object.isFrozen(result.bindings) && Object.isFrozen(result.page)
    && Object.isFrozen(result.items) && Object.isFrozen(result.items[0]) && Object.isFrozen(result.items[0].coverage)
    && Object.isFrozen(result.claims) && Object.isFrozen(result.authority) && Object.isFrozen(result.nextCursor), 'result is deeply frozen');
  assertResultOmissions(result, run);

  // resume the exact page through the authority-bound cursor
  const second = buildObjectSearchAuthorityBoundResult({controllerRun: run, projection, request, cursor: result.nextCursor});
  assert.deepEqual(second.page, {
    pageIndex: 1, pageSize: 1, startOrdinal: 1, endOrdinal: 1,
    itemCount: 1, matchCount: 2, remainingCount: 0, hasNext: false,
  });
  assert.equal(second.items[0].objectKey, matches[1].objectKey, 'second page carries the remaining recomputed identity');
  assert.deepEqual(second.items[0].coverage, {state: matches[1].state, reasonCode: matches[1].reasonCode, visibility: VISIBILITY[matches[1].state]});
  assert.equal(second.nextCursor, null, 'terminal page emits no next cursor');
  assertResultOmissions(second, run);
});

test('canonical Oracle run: terminal page and zero-match requests are byte-identical across equivalent controller-entry ordering with exact terminal bounds and no next cursor', async () => {
  const run = await oracleRun();
  assert(resumeProgressiveRun(run), 'run is an independently validated progressive controller run');
  for (const state of ['PARTIAL', 'DENIED', 'UNKNOWN']) {
    assert(run.coverage.summary.stateCounts[state] > 0, `coverage carries ${state}`);
  }
  const projection = buildObjectInventoryAuthorityDigest(run);
  const request = oracleRequest();

  const result = buildObjectSearchAuthorityBoundResult({controllerRun: run, projection, request});
  assert.equal(result.engine, 'oracle');
  assert.deepEqual(result.page, {
    pageIndex: 0, pageSize: 10, startOrdinal: 0, endOrdinal: 1,
    itemCount: 2, matchCount: 2, remainingCount: 0, hasNext: false,
  }, 'exact terminal bounds from the authoritative filtered match set');
  assert.equal(result.nextCursor, null, 'terminal page has no next cursor');
  assert.deepEqual(result.items.map(({coverage}) => coverage.state).sort(), ['DENIED', 'PARTIAL'], 'per-item PARTIAL/DENIED semantics preserved from the run');
  assert(result.items.every(({objectKind}) => ['RELATION', 'COLUMN'].includes(objectKind)));
  assertResultOmissions(result, run);

  const zeroRequest = oracleRequest({prefix: 'ZZZ'});
  const zero = buildObjectSearchAuthorityBoundResult({controllerRun: run, projection, request: zeroRequest});
  assert.deepEqual(zero.items, []);
  assert.deepEqual(zero.page, {
    pageIndex: 0, pageSize: 10, startOrdinal: 0, endOrdinal: -1,
    itemCount: 0, matchCount: 0, remainingCount: 0, hasNext: false,
  });
  assert.equal(zero.nextCursor, null);
  assert.equal(zero.claims.absenceClaimed, false, 'empty output claims no absence');
  assert.equal(zero.claims.completenessClaimed, false, 'empty output claims no completeness');
  assert.equal(zero.state, 'PROJECTED');
  assertResultOmissions(zero, run);

  // equivalent controller-entry ordering yields byte-identical frozen output
  const coverage = run.coverage;
  const reordered = createProgressiveCoverage({
    engine: 'oracle',
    structureSnapshotSha256: coverage.structureSnapshotSha256,
    structureCoverageLedgerSha256: coverage.structureCoverageLedgerSha256,
    entries: [...coverage.entries].reverse().map(({objectKey: _objectKey, absenceClaim: _absenceClaim, ...entry}) => entry),
    queryCoverage: coverage.queryCoverage,
  });
  assert.equal(reordered.coverageSha256, coverage.coverageSha256, 'canonical coverage ordering is independent of entry ordering');
  const reorderedRun = await oracleRun({coverageOverride: reordered});
  const reorderedProjection = buildObjectInventoryAuthorityDigest(reorderedRun);
  assert.equal(reorderedProjection.authorityDigestSha256, projection.authorityDigestSha256, 'authority digest is ordering-independent');
  const reorderedResult = buildObjectSearchAuthorityBoundResult({controllerRun: reorderedRun, projection: reorderedProjection, request});
  assert.equal(canonicalJson(reorderedResult), canonicalJson(result), 'byte-identical frozen output across equivalent controller-entry ordering');
  const reorderedZero = buildObjectSearchAuthorityBoundResult({controllerRun: reorderedRun, projection: reorderedProjection, request: zeroRequest});
  assert.equal(canonicalJson(reorderedZero), canonicalJson(zero), 'byte-identical frozen empty output across equivalent controller-entry ordering');
});
const reSeal = (value, hashKey) => {
  const body = JSON.parse(JSON.stringify(value));
  delete body[hashKey];
  return {...body, [hashKey]: identitySha256(body)};
};

function craftRun(run, mutate) {
  const copy = JSON.parse(JSON.stringify(run));
  mutate(copy);
  copy.coverage = reSeal(copy.coverage, 'coverageSha256');
  return reSeal(copy, 'stateSha256');
}

function craftCursor({pageIndex, envelopeSha256, controllerStateSha256, identityCommitmentSha256, authorityDigestSha256}) {
  const body = {
    schemaVersion: OBJECT_SEARCH_AUTHORITY_BOUND_CURSOR_SCHEMA,
    pageIndex,
    envelopeSha256,
    controllerStateSha256,
    identityCommitmentSha256,
    authorityDigestSha256,
    opaqueDigest: identitySha256({envelopeSha256, controllerStateSha256, identityCommitmentSha256, authorityDigestSha256, pageIndex}),
  };
  return {...body, cursorSha256: identitySha256(body)};
}

test('fail closed on identity substitution, duplicate/reordered identities, claim-bearing identifiers, fabricated absence claims, malformed seals and stale or substituted runs and projections', async () => {
  const run = await mssqlRun();
  const projection = buildObjectInventoryAuthorityDigest(run);
  const request = mssqlRequest();
  const build = (controllerRun = run, proj = projection) =>
    buildObjectSearchAuthorityBoundResult({controllerRun, projection: proj, request});

  // objectRef substitution with unchanged objectKey and re-sealed digests
  const substituted = craftRun(run, (copy) => {
    copy.coverage.entries[0].objectRef = {...copy.coverage.entries[0].objectRef, relationName: 'forged_relation'};
  });
  assert.throws(() => build(substituted), {code: 'DB_PROGRESSIVE_COVERAGE_ENTRY_INVALID'});

  // duplicate identity
  const duplicated = craftRun(run, (copy) => {
    copy.coverage.entries.push({...copy.coverage.entries[0]});
  });
  assert.throws(() => build(duplicated), {code: 'DB_PROGRESSIVE_COVERAGE_DUPLICATE'});

  // reordered identities
  const reordered = craftRun(run, (copy) => {
    [copy.coverage.entries[0], copy.coverage.entries[1]] = [copy.coverage.entries[1], copy.coverage.entries[0]];
  });
  assert.throws(() => build(reordered), {code: 'DB_PROGRESSIVE_COVERAGE_INVALID'});

  // claim-bearing otherwise-valid database/schema identifier
  const claimed = craftRun(run, (copy) => {
    copy.scope = {...copy.scope, schemas: ['dbo_verified']};
    copy.scopeSha256 = identitySha256(copy.scope);
  });
  assert.throws(() => build(claimed), {code: 'DB_OBJECT_INVENTORY_AUTHORITY_IDENTIFIER_CLAIM_FORBIDDEN'});

  // fabricated absence claim
  const absence = craftRun(run, (copy) => {
    copy.coverage.entries[0].absenceClaim = 'ABSENT';
  });
  assert.throws(() => build(absence), {code: 'DB_PROGRESSIVE_COVERAGE_ENTRY_INVALID'});

  // malformed digest (oversized run seal)
  const brokenSeal = JSON.parse(JSON.stringify(run));
  brokenSeal.stateSha256 = '1'.repeat(63);
  assert.throws(() => build(brokenSeal), {code: 'DB_PROGRESSIVE_STATE_TAMPERED'});

  // stale/tampered self-consistent controller run against the unchanged projection
  const stale = withRunBody(run, {runId: 'fixture-mssql-authority-digest-stale'});
  assert.throws(() => build(stale), {code: 'DB_OBJECT_INVENTORY_AUTHORITY_CANDIDATE_MISMATCH'});

  // substituted W17 projection (built from a different run)
  const otherRun = await oracleRun();
  const otherProjection = buildObjectInventoryAuthorityDigest(otherRun);
  assert.throws(() => build(run, otherProjection), {code: 'DB_OBJECT_INVENTORY_AUTHORITY_CANDIDATE_MISMATCH'});
});

test('fail closed on engine/scope drift and malformed, oversized, injected, unsafe or authority-claiming request envelopes', async () => {
  const run = await mssqlRun();
  const projection = buildObjectInventoryAuthorityDigest(run);
  const request = mssqlRequest();
  const build = (req) => buildObjectSearchAuthorityBoundResult({controllerRun: run, projection, request: req});

  // engine drift: valid envelope for an engine the validated run does not cover
  const postgresRequest = createObjectSearchEnvelope({
    engine: 'postgresql',
    scope: {schemas: ['dbo']},
    prefix: 'dbo',
    kindFilters: ['TABLE', 'VIEW'],
    pageSize: 1,
    inventory: createObjectInventorySnapshot({engine: 'postgresql', kindCounts: {TABLE: 2, VIEW: 0, COLUMN: 3, INDEX: 1, SEQUENCE: 0, SYNONYM: 0}}),
    coverage: createObjectSearchCoverageBinding({stateCounts: {SUCCEEDED: 5, PARTIAL: 1, DENIED: 1, UNSUPPORTED: 0, TIMEOUT: 0, ERROR: 0}}),
  });
  assert.throws(() => build(postgresRequest), {code: 'DB_OBJECT_SEARCH_AUTHORITY_RESULT_ENGINE_DRIFT'});

  // scope drift: schemas outside the validated run scope (including injection-shaped identifiers)
  assert.throws(() => build(mssqlRequest({schemas: ['other_schema']})), {code: 'DB_OBJECT_SEARCH_AUTHORITY_RESULT_SCOPE_DRIFT'});
  assert.throws(() => build(mssqlRequest({schemas: ["dbo'; -- x"]})), {code: 'DB_OBJECT_SEARCH_AUTHORITY_RESULT_SCOPE_DRIFT'});

  const craftEnvelope = (changes) => reSeal({...request, ...changes}, 'envelopeSha256');

  // unknown field carrying an arbitrary callback URL
  assert.throws(() => build(craftEnvelope({callback: 'https://evil.example/cb'})), {code: 'DB_OBJECT_SEARCH_ENVELOPE_INVALID'});
  // oversized page
  assert.throws(() => build(craftEnvelope({pageSize: 501})), {code: 'DB_OBJECT_SEARCH_PAGE_SIZE_INVALID'});
  // oversized and SQL-injected prefix identifiers
  assert.throws(() => build(craftEnvelope({prefix: 'a'.repeat(65)})), {code: 'DB_OBJECT_SEARCH_PREFIX_INVALID'});
  assert.throws(() => build(craftEnvelope({prefix: "dbo' OR 1=1"})), {code: 'DB_OBJECT_SEARCH_PREFIX_INVALID'});
  assert.throws(() => build(craftEnvelope({prefix: 'dbo; DROP'})), {code: 'DB_OBJECT_SEARCH_PREFIX_INVALID'});
  // credential-shaped identifier, raw sample value, private path
  assert.throws(() => build(craftEnvelope({scope: {schemas: ['password_store']}})), {code: 'DB_OBJECT_SEARCH_SCOPE_INVALID'});
  assert.throws(() => build(craftEnvelope({scope: {schemas: ['sample_value']}})), {code: 'DB_OBJECT_SEARCH_UNSAFE_MATERIAL'});
  assert.throws(() => build(craftEnvelope({prefix: '/etc/passwd'})), {code: 'DB_OBJECT_SEARCH_PREFIX_INVALID'});
  // tampered authority flags (cancellation/dispatch/execution/mutation bypass claim)
  assert.throws(() => build(craftEnvelope({authority: {...request.authority, readOnly: false}})), {code: 'DB_OBJECT_SEARCH_AUTHORITY_INVALID'});
});

test('fail closed on cursor replay across run/request/projection, cursor gap/overflow, page-zero, malformed and tampered cursors', async () => {
  const run = await mssqlRun();
  const projection = buildObjectInventoryAuthorityDigest(run);
  const request = mssqlRequest();
  const result = buildObjectSearchAuthorityBoundResult({controllerRun: run, projection, request});
  const cursor = result.nextCursor;
  const build = ({controllerRun = run, proj = projection, req = request, cur = cursor} = {}) =>
    buildObjectSearchAuthorityBoundResult({controllerRun, projection: proj, request: req, cursor: cur});

  // replay against another run (same identities, different coverage states)
  const {structureEvidence} = await mssqlInputs();
  const base = buildProgressiveCoverage(structureEvidence);
  const shifted = createProgressiveCoverage({
    engine: 'mssql',
    structureSnapshotSha256: base.structureSnapshotSha256,
    structureCoverageLedgerSha256: base.structureCoverageLedgerSha256,
    entries: base.entries.map((entry, index) => {
      const [state, reasonCode] = MIXED_STATES[(index + 1) % MIXED_STATES.length];
      return {objectRef: entry.objectRef, state, reasonCode, sourceQueryId: entry.sourceQueryId, evidenceRefs: entry.evidenceRefs};
    }),
    queryCoverage: base.queryCoverage,
  });
  const otherRun = await mssqlRun({coverageOverride: shifted});
  assert.notEqual(otherRun.stateSha256, run.stateSha256, 'distinct controller state');
  const otherProjection = buildObjectInventoryAuthorityDigest(otherRun);
  assert.throws(() => build({controllerRun: otherRun, proj: otherProjection}), {code: 'DB_OBJECT_SEARCH_AUTHORITY_CURSOR_RUN_REPLAY'});

  // replay against a different request (different page size => different envelope digest)
  assert.throws(() => build({req: mssqlRequest({pageSize: 2})}), {code: 'DB_OBJECT_SEARCH_AUTHORITY_CURSOR_REQUEST_REPLAY'});

  // substituted W17 projection with a cursor: rejected at authority verification
  assert.throws(() => build({proj: otherProjection}), {code: 'DB_OBJECT_INVENTORY_AUTHORITY_CANDIDATE_MISMATCH'});

  const cursorBindings = {
    envelopeSha256: request.envelopeSha256,
    controllerStateSha256: run.stateSha256,
    identityCommitmentSha256: projection.identityCommitmentSha256,
    authorityDigestSha256: projection.authorityDigestSha256,
  };
  // gap/overflow: cursors past the last non-empty page
  assert.throws(() => build({cur: craftCursor({pageIndex: 2, ...cursorBindings})}), {code: 'DB_OBJECT_SEARCH_AUTHORITY_CURSOR_OVERFLOW'});
  assert.throws(() => build({cur: craftCursor({pageIndex: 3, ...cursorBindings})}), {code: 'DB_OBJECT_SEARCH_AUTHORITY_CURSOR_OVERFLOW'});
  // page-zero cursor: the first page carries no cursor authority
  assert.throws(() => build({cur: craftCursor({pageIndex: 0, ...cursorBindings})}), {code: 'DB_OBJECT_SEARCH_AUTHORITY_CURSOR_INVALID'});
  // malformed digest and tampered seal
  assert.throws(() => build({cur: reSeal({...JSON.parse(JSON.stringify(cursor)), opaqueDigest: '1'.repeat(63)}, 'cursorSha256')}),
    {code: 'DB_OBJECT_SEARCH_AUTHORITY_CURSOR_INVALID'});
  const tamperedSeal = JSON.parse(JSON.stringify(cursor));
  tamperedSeal.controllerStateSha256 = '0'.repeat(64);
  assert.throws(() => build({cur: tamperedSeal}), {code: 'DB_OBJECT_SEARCH_AUTHORITY_CURSOR_TAMPERED'});
  assert.throws(() => build({cur: reSeal({...JSON.parse(JSON.stringify(cursor)), opaqueDigest: '1'.repeat(64)}, 'cursorSha256')}),
    {code: 'DB_OBJECT_SEARCH_AUTHORITY_CURSOR_DIGEST_MISMATCH'});
});

test('caller-supplied inventory counts and coverage bindings are bound but never trusted for page or match authority', async () => {
  const run = await mssqlRun();
  const projection = buildObjectInventoryAuthorityDigest(run);
  const low = mssqlRequest();
  const inflated = createObjectSearchEnvelope({
    engine: 'mssql',
    scope: {schemas: ['dbo']},
    prefix: 'dbo',
    kindFilters: ['TABLE', 'VIEW'],
    pageSize: 1,
    inventory: createObjectInventorySnapshot({engine: 'mssql', kindCounts: {TABLE: 999, VIEW: 0, COLUMN: 3, INDEX: 1, SEQUENCE: 0, SYNONYM: 0}}),
    coverage: createObjectSearchCoverageBinding({stateCounts: {SUCCEEDED: 9, PARTIAL: 9, DENIED: 9, UNSUPPORTED: 0, TIMEOUT: 0, ERROR: 0}}),
  });

  const a = buildObjectSearchAuthorityBoundResult({controllerRun: run, projection, request: low});
  const b = buildObjectSearchAuthorityBoundResult({controllerRun: run, projection, request: inflated});
  assert.equal(b.page.matchCount, 2, 'matchCount is recomputed from the validated run, not the caller inventory');
  assert.equal(b.page.remainingCount, a.page.remainingCount, 'remaining count is recomputed from the authoritative match set');
  assert.deepEqual(b.items, a.items, 'items are identical regardless of caller-supplied counts');
  assert.notEqual(b.bindings.envelopeSha256, a.bindings.envelopeSha256, 'the caller counts remain bound by digest');
  assert.notEqual(b.bindings.inventorySnapshotSha256, a.bindings.inventorySnapshotSha256);
  const validated = resumeObjectSearchEnvelope(low);
  assert(!Object.hasOwn(validated, 'pageIndex') && !Object.hasOwn(validated, 'matchCount'),
    'the request envelope carries no page or count authority channel');
});

test('a fully re-digested forged result or identity set beside the unchanged run and W17 projection is not admitted', async () => {
  const run = await mssqlRun();
  const projection = buildObjectInventoryAuthorityDigest(run);
  const request = mssqlRequest();
  const clean = buildObjectSearchAuthorityBoundResult({controllerRun: run, projection, request});

  const forgedItem = {
    objectKey: 'ab'.repeat(32),
    objectKind: 'RELATION',
    coverage: {state: 'COMPLETE', reasonCode: null, visibility: 'VISIBLE'},
    evidenceRefs: ['cd'.repeat(32), 'ef'.repeat(32)],
  };
  forgedItem.itemSha256 = identitySha256(JSON.parse(JSON.stringify(forgedItem)));
  const forged = reSeal({
    ...JSON.parse(JSON.stringify(clean)),
    items: [...clean.items, forgedItem],
  }, 'projectionSha256');
  assert.notEqual(forged.projectionSha256, clean.projectionSha256, 'the forgery re-digests its own bytes consistently');

  const bytes = canonicalJson(clean);
  assert(!bytes.includes(forgedItem.objectKey), 'a forged identity set cannot enter the projection');
  assert(!bytes.includes(forgedItem.itemSha256));
  const expectedKeys = run.coverage.entries
    .filter((entry) => entry.objectRef.kind === 'RELATION' && entry.objectRef.schemaName === 'dbo'
      && [entry.objectRef.schemaName, entry.objectRef.relationName].join('.').startsWith('dbo'))
    .map(({objectKey}) => objectKey);
  const full = buildObjectSearchAuthorityBoundResult({controllerRun: run, projection, request: mssqlRequest({pageSize: 2})});
  assert.equal(full.page.matchCount, expectedKeys.length, 'matchCount is the full ordered matching identity set');
  assert.deepEqual(full.items.map(({objectKey}) => objectKey), expectedKeys,
    'the identity set is recomputed only from the unchanged validated controller run');
  assert.throws(() => buildObjectSearchAuthorityBoundResult({controllerRun: run, projection, request, result: forged}),
    {code: 'DB_OBJECT_SEARCH_AUTHORITY_RESULT_INPUT_INVALID'}, 'a forged result has no input channel to this projection');
});
