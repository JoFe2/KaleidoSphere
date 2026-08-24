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
  createProgressiveBreadthOverride,
  createProgressiveCoverage,
  createProgressiveRun,
  resumeProgressiveRun,
} from '../services/bi-control/src/db-analyzer/progressive-controller.mjs';
import {
  OBJECT_INVENTORY_AUTHORITY_DIGEST_SCHEMA,
  buildObjectInventoryAuthorityDigest,
  verifyObjectInventoryAuthorityDigest,
} from '../services/bi-control/src/db-analyzer/object-inventory-authority-digest-v1.mjs';
import {runAnalyzeProfile} from '../services/bi-control/src/db-analyzer/workflow.mjs';
import {buildLiveProfile} from '../services/bi-control/src/runtime-config.mjs';

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
const AUTHORITY_FLAGS = Object.freeze({
  approvalAuthority: false,
  callerIdentifiersIncluded: false,
  credentialsIncluded: false,
  cursorAuthority: false,
  dispatchAuthority: false,
  executionAuthority: false,
  mutationAuthority: false,
  pageConstruction: false,
  queryExecution: false,
  rawValuesIncluded: false,
  replayPreventionClaimed: false,
  readOnlyEvidenceOnly: true,
  sqlAuthority: false,
});
const NON_CLAIMS = Object.freeze([
  'NO_RUN_ID',
  'NO_OBJECT_IDENTITY',
  'NO_CALLER_CONTROLLED_PUBLIC_IDENTIFIER',
  'NO_REPLAY_PREVENTION_CLAIM',
  'NO_COMPLETENESS_CLAIM',
  'NO_ABSENCE_CLAIM',
  'NO_BUSINESS_SEMANTIC_TRUTH',
  'NO_SQL_AUTHORITY',
  'NO_DISPATCH_AUTHORITY',
  'NO_MUTATION_AUTHORITY',
]);

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

async function oracleInputs({denySizes = true} = {}) {
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
  if (denySizes) results['oracle.size.segments'] = {state: 'DENIED', reasonCode: 'ORA_01031', rows: []};
  const profile = buildLiveProfile(oracleEnv, 'CM_ORACLE_PASSWORD');
  const structureEvidence = buildPreflightEvidence({
    manifest: structureManifest,
    sqlByQueryId,
    resultSets: {schemaVersion: 'chimpmaera.db/runtime-query-results/v1', engine: 'oracle', runtimeValidated: true, results},
    profileContext: {profileId: profile.profileId, mode: profile.mode, scope: profile.scope, policy: profile.policy, adapter: profile.adapter.kind},
  });
  return {structureManifest, structureEvidence, scope: profile.scope};
}

async function oracleRun({coverageOverride} = {}) {
  const {structureManifest, structureEvidence, scope} = await oracleInputs();
  return createProgressiveRun({
    runId: 'fixture-oracle-authority-digest-v1',
    engine: 'oracle',
    scope,
    methodRegistry: buildProgressiveMethodRegistry({structureManifest}),
    coverage: coverageOverride ?? buildProgressiveCoverage(structureEvidence),
    budgets: {maxRunProbes: 4, maxObjectProbes: 2},
  });
}

function withRunBody(run, changes) {
  const {stateSha256: _previousState, ...body} = structuredClone(run);
  const normalized = normalizeJsonValue(body);
  return {...normalized, ...normalizeJsonValue(changes), stateSha256: identitySha256(normalizeJsonValue({...normalized, ...normalizeJsonValue(changes)}))};
}

test('canonical MSSQL mixed-coverage run verifies a VERIFIED digest projection with named-envelope digests and no identifier leakage', async () => {
  const run = await mssqlRun();
  assert(resumeProgressiveRun(run));
  const {stateCounts} = run.coverage.summary;
  for (const state of ['COMPLETE', 'PARTIAL', 'DENIED', 'UNKNOWN']) assert(stateCounts[state] > 0, `coverage carries ${state}`);
  assert(run.coverage.entries.every(({absenceClaim}) => absenceClaim === 'NOT_CLAIMED'));

  const projection = buildObjectInventoryAuthorityDigest(run);
  const verified = verifyObjectInventoryAuthorityDigest({controllerRun: run, projection});

  assert.equal(verified.schemaVersion, OBJECT_INVENTORY_AUTHORITY_DIGEST_SCHEMA);
  assert.equal(verified.type, 'OBJECT_INVENTORY_AUTHORITY_DIGEST');
  assert.equal(verified.state, 'VERIFIED');
  assert.equal(verified.engine, 'mssql');
  for (const value of [verified.controllerStateSha256, verified.identityCommitmentSha256, verified.authorityDigestSha256]) {
    assert(DIGEST.test(value), `digest ${value} is canonical sha256`);
  }
  assert.equal(verified.controllerStateSha256, run.stateSha256);
  assert.equal(verified.identityCommitmentSha256, projection.identityCommitmentSha256);
  assert.equal(verified.authorityDigestSha256, projection.authorityDigestSha256);
  assert(verified.identityCommitmentSha256 !== verified.authorityDigestSha256, 'identity and authority envelopes are distinct');
  assert.deepEqual(verified.authority, AUTHORITY_FLAGS);
  assert.deepEqual(verified.nonClaims, [...NON_CLAIMS]);

  const again = verifyObjectInventoryAuthorityDigest({controllerRun: run, projection});
  assert.equal(canonicalJson(again), canonicalJson(verified), 'digest metadata is deterministic');

  assert(Object.isFrozen(verified));
  assert(Object.isFrozen(verified.authority));
  assert(Object.isFrozen(verified.nonClaims));
  assert(Object.isFrozen(verified.envelopeSchemas));
  assert(Object.isFrozen(verified.envelopeSchemas.identityEnvelope));

  const bytes = canonicalJson(verified);
  assert(!bytes.includes('fixture-mssql-authority-digest-v1'), 'runId absent from output bytes');
  assert(run.coverage.entries.every(({objectKey}) => !bytes.includes(objectKey)), 'object identities absent from output bytes');
  assert(!bytes.includes('CM_BI_FIXTURE') && !bytes.includes('dbo'), 'caller-controlled scope identifiers absent from output bytes');
  const allowed = new Set([verified.controllerStateSha256, verified.identityCommitmentSha256, verified.authorityDigestSha256]);
  assert((bytes.match(/[a-f0-9]{64}/g) ?? []).every((value) => allowed.has(value)), 'no bare digest preimages leak into output bytes');
});

test('Oracle canonical and reordered object-key inputs yield byte-identical digest metadata; engine and bound evidence digests change it deterministically', async () => {
  const baseOracle = await oracleRun();
  const coverage = baseOracle.coverage;
  assert(coverage.entries.length > 0);
  const canonical = buildObjectInventoryAuthorityDigest(baseOracle);
  const verified = verifyObjectInventoryAuthorityDigest({controllerRun: baseOracle, projection: canonical});
  assert.equal(verified.state, 'VERIFIED');
  assert(Object.isFrozen(verified));

  const reordered = createProgressiveCoverage({
    engine: 'oracle',
    structureSnapshotSha256: coverage.structureSnapshotSha256,
    structureCoverageLedgerSha256: coverage.structureCoverageLedgerSha256,
    entries: [...coverage.entries].reverse().map((entry) => ({
      objectRef: entry.objectRef, state: entry.state, reasonCode: entry.reasonCode, sourceQueryId: entry.sourceQueryId, evidenceRefs: entry.evidenceRefs,
    })),
    queryCoverage: coverage.queryCoverage,
  });
  assert.equal(reordered.coverageSha256, coverage.coverageSha256, 'canonical ordering is independent of input ordering');
  const reorderedRun = await oracleRun({coverageOverride: reordered});
  const reorderedMetadata = buildObjectInventoryAuthorityDigest(reorderedRun);
  assert.equal(JSON.stringify(reorderedMetadata), JSON.stringify(canonical), 'byte-identical digest metadata for identical semantic evidence');

  const mssqlRunObject = await mssqlRun();
  const mssqlMetadata = buildObjectInventoryAuthorityDigest(mssqlRunObject);
  assert.equal(mssqlMetadata.engine, 'mssql');
  assert(mssqlMetadata.authorityDigestSha256 !== canonical.authorityDigestSha256, 'different fixed engine changes the authority digest');
  assert(mssqlMetadata.identityCommitmentSha256 !== canonical.identityCommitmentSha256);
  assert.equal(mssqlMetadata.authorityDigestSha256, buildObjectInventoryAuthorityDigest(mssqlRunObject).authorityDigestSha256, 'engine drift is deterministic');

  const alternateEntries = coverage.entries.map((entry, index) => (index === 0
    ? {...entry, evidenceRefs: [identitySha256({fixture: 'alternate-bound-evidence'})]}
    : entry));
  const alternateRun = await oracleRun({coverageOverride: createProgressiveCoverage({
    engine: 'oracle',
    structureSnapshotSha256: coverage.structureSnapshotSha256,
    structureCoverageLedgerSha256: coverage.structureCoverageLedgerSha256,
    entries: alternateEntries.map(({objectKey: _objectKey, absenceClaim: _absenceClaim, ...entry}) => entry),
    queryCoverage: coverage.queryCoverage,
  })});
  const alternate = buildObjectInventoryAuthorityDigest(alternateRun);
  assert(alternate.authorityDigestSha256 !== canonical.authorityDigestSha256, 'bound evidence digest change alters the authority digest');
  assert.equal(alternate.authorityDigestSha256, buildObjectInventoryAuthorityDigest(alternateRun).authorityDigestSha256, 'evidence drift is deterministic');
});

test('verification fails closed on tampered, stale, claim-bearing, or drifted controller runs', async () => {
  const run = await mssqlRun();
  const projection = buildObjectInventoryAuthorityDigest(run);
  const {structureEvidence} = await mssqlInputs();
  const baseCoverage = buildProgressiveCoverage(structureEvidence);

  const substituted = withRunBody(run, {});
  substituted.coverage.entries[0].objectRef.objectName = 'TAMPERED_OBJECT';
  assert.throws(() => verifyObjectInventoryAuthorityDigest({controllerRun: substituted, projection}),
    /DB_PROGRESSIVE_STATE_TAMPERED|DB_OBJECT_INVENTORY_AUTHORITY_IDENTITY_MISMATCH/);

  const claimBearing = structuredClone(run);
  claimBearing.coverage.entries[0].absenceClaim = 'ABSENT';
  assert.throws(() => verifyObjectInventoryAuthorityDigest({controllerRun: claimBearing, projection}),
    /DB_PROGRESSIVE_STATE_TAMPERED|DB_OBJECT_INVENTORY_AUTHORITY_CLAIM_FORBIDDEN/);

  const duplicated = structuredClone(run);
  duplicated.coverage.entries.push(duplicated.coverage.entries[0]);
  assert.throws(() => verifyObjectInventoryAuthorityDigest({controllerRun: duplicated, projection}),
    /DB_PROGRESSIVE_STATE_TAMPERED|DB_OBJECT_INVENTORY_AUTHORITY_IDENTITY_DUPLICATE/);

  const reordered = structuredClone(run);
  [reordered.coverage.entries[0], reordered.coverage.entries[1]] = [reordered.coverage.entries[1], reordered.coverage.entries[0]];
  assert.throws(() => verifyObjectInventoryAuthorityDigest({controllerRun: reordered, projection}),
    /DB_PROGRESSIVE_STATE_TAMPERED|DB_OBJECT_INVENTORY_AUTHORITY_IDENTITY_ORDER_INVALID/);

  const scopeDrift = withRunBody(run, {scope: {...run.scope, schemas: [...run.scope.schemas, 'extra']}});
  assert.throws(() => verifyObjectInventoryAuthorityDigest({controllerRun: scopeDrift, projection}),
    /DB_PROGRESSIVE_BINDING_INVALID|DB_OBJECT_INVENTORY_AUTHORITY_SCOPE_DRIFT/);

  const engineDrift = withRunBody(run, {engine: 'postgresql'});
  assert.throws(() => verifyObjectInventoryAuthorityDigest({controllerRun: engineDrift, projection}),
    /DB_PROGRESSIVE_STATE_INVALID|DB_OBJECT_INVENTORY_AUTHORITY_EVIDENCE_DRIFT/);

  const stalePhase = structuredClone(run);
  stalePhase.phase = 'REPORT';
  assert.throws(() => verifyObjectInventoryAuthorityDigest({controllerRun: stalePhase, projection}),
    /DB_PROGRESSIVE_STATE_TAMPERED|DB_PROGRESSIVE_PHASE_STATE_INVALID/);

  const override = createProgressiveBreadthOverride({
    runId: run.runId,
    scopeSha256: identitySha256(run.scope),
    coverageSha256: run.coverage.coverageSha256,
    reasonCode: 'FIXTURE_KNOWN_BLIND_SPOT',
    actorId: 'fixture-reviewer',
    recordedAt: '2026-08-19T00:00:00.000Z',
    allowedObjectKeys: [run.coverage.entries[0].objectKey],
    maxDepthProbeCount: 1,
  });
  const staleBinding = withRunBody(withRunBody(run, {breadthOverride: override}), {coverage: baseCoverage});
  assert.throws(() => verifyObjectInventoryAuthorityDigest({controllerRun: staleBinding, projection}),
    /DB_PROGRESSIVE_OVERRIDE_STALE|DB_PROGRESSIVE_STATE_TAMPERED/);
});

test('authoritative validation rejects claim-bearing database, schema, and object identifiers after complete re-digestion', async () => {
  const run = await mssqlRun();
  const projection = buildObjectInventoryAuthorityDigest(run);
  const scopeCases = [
    ['database', {...run.scope, database: 'warehouse_authoritative'}],
    ['schema', {...run.scope, schemas: ['dbo_verified']}],
  ];
  for (const [kind, scope] of scopeCases) {
    const sealed = withRunBody(run, {scope, scopeSha256: identitySha256(scope)});
    assert(resumeProgressiveRun(sealed), `claim-bearing ${kind} run is fully sealed`);
    assert.throws(
      () => verifyObjectInventoryAuthorityDigest({controllerRun: sealed, projection}),
      /DB_OBJECT_INVENTORY_AUTHORITY_IDENTIFIER_CLAIM_FORBIDDEN/,
      `claim-bearing ${kind} identifier is semantically denied`,
    );
  }

  const claimedEntries = run.coverage.entries.map(({objectRef, state, reasonCode, sourceQueryId, evidenceRefs}, index) => ({
    objectRef: index === 0 ? {...objectRef, objectName: 'inventory_complete'} : objectRef,
    state, reasonCode, sourceQueryId, evidenceRefs,
  }));
  const claimedCoverage = createProgressiveCoverage({
    engine: run.engine,
    structureSnapshotSha256: run.coverage.structureSnapshotSha256,
    structureCoverageLedgerSha256: run.coverage.structureCoverageLedgerSha256,
    entries: claimedEntries,
    queryCoverage: run.coverage.queryCoverage,
  });
  const sealedObjectRun = withRunBody(run, {coverage: claimedCoverage});
  assert(resumeProgressiveRun(sealedObjectRun), 'claim-bearing object run and coverage are fully re-digested');
  assert.throws(
    () => verifyObjectInventoryAuthorityDigest({controllerRun: sealedObjectRun, projection}),
    /DB_OBJECT_INVENTORY_AUTHORITY_IDENTIFIER_CLAIM_FORBIDDEN/,
  );
});

test('verification fails closed on forged, re-digested, or otherwise invalid candidate projections', async () => {
  const run = await mssqlRun();
  const projection = buildObjectInventoryAuthorityDigest(run);
  const {structureEvidence} = await mssqlInputs();
  const baseCoverage = buildProgressiveCoverage(structureEvidence);

  assert.throws(() => verifyObjectInventoryAuthorityDigest({controllerRun: run, projection: [projection]}),
    /DB_OBJECT_INVENTORY_AUTHORITY_PROJECTION_INVALID/);
  assert.throws(() => verifyObjectInventoryAuthorityDigest({
    controllerRun: run,
    projection: {identityCommitmentSha256: projection.identityCommitmentSha256, authorityDigestSha256: projection.authorityDigestSha256},
  }), /DB_OBJECT_INVENTORY_AUTHORITY_PROJECTION_INVALID/);

  const bareArrayPreimage = {...projection, identityCommitmentSha256: identitySha256(run.coverage.entries.map(({objectKey}) => objectKey))};
  assert.throws(() => verifyObjectInventoryAuthorityDigest({controllerRun: run, projection: bareArrayPreimage}),
    /DB_OBJECT_INVENTORY_AUTHORITY_CANDIDATE_MISMATCH/);
  const anonymousPreimage = {...projection, identityCommitmentSha256: identitySha256({identities: run.coverage.entries.map(({objectKey}) => objectKey)})};
  assert.throws(() => verifyObjectInventoryAuthorityDigest({controllerRun: run, projection: anonymousPreimage}),
    /DB_OBJECT_INVENTORY_AUTHORITY_CANDIDATE_MISMATCH/);
  const sameEnvelopeClaim = {...projection, authorityDigestSha256: projection.identityCommitmentSha256};
  assert.throws(() => verifyObjectInventoryAuthorityDigest({controllerRun: run, projection: sameEnvelopeClaim}),
    /DB_OBJECT_INVENTORY_AUTHORITY_CANDIDATE_MISMATCH/);

  const zeroDigest = {...projection, identityCommitmentSha256: '0'.repeat(64)};
  assert.throws(() => verifyObjectInventoryAuthorityDigest({controllerRun: run, projection: zeroDigest}),
    /DB_OBJECT_INVENTORY_AUTHORITY_CANDIDATE_MISMATCH/);
  const unknownField = {...projection, runId: 'fixture-mssql-authority-digest-v1'};
  assert.throws(() => verifyObjectInventoryAuthorityDigest({controllerRun: run, projection: unknownField}),
    /DB_OBJECT_INVENTORY_AUTHORITY_PROJECTION_INVALID/);
  const missingField = {...projection};
  delete missingField.state;
  assert.throws(() => verifyObjectInventoryAuthorityDigest({controllerRun: run, projection: missingField}),
    /DB_OBJECT_INVENTORY_AUTHORITY_PROJECTION_INVALID/);

  const malformedDigest = {...projection, authorityDigestSha256: 'NOT_A_DIGEST'};
  assert.throws(() => verifyObjectInventoryAuthorityDigest({controllerRun: run, projection: malformedDigest}),
    /DB_OBJECT_INVENTORY_AUTHORITY_DIGEST_INVALID/);
  const oversizedDigest = {...projection, authorityDigestSha256: 'a'.repeat(65)};
  assert.throws(() => verifyObjectInventoryAuthorityDigest({controllerRun: run, projection: oversizedDigest}),
    /DB_OBJECT_INVENTORY_AUTHORITY_DIGEST_INVALID/);

  const injectedSchema = {...projection, schemaVersion: `${OBJECT_INVENTORY_AUTHORITY_DIGEST_SCHEMA}; DROP TABLE x`};
  assert.throws(() => verifyObjectInventoryAuthorityDigest({controllerRun: run, projection: injectedSchema}),
    /DB_OBJECT_INVENTORY_AUTHORITY_PROJECTION_INVALID/);
  const injectedEngine = {...projection, engine: 'mssql; SELECT * FROM secrets'};
  assert.throws(() => verifyObjectInventoryAuthorityDigest({controllerRun: run, projection: injectedEngine}),
    /DB_OBJECT_INVENTORY_AUTHORITY_UNSAFE_MATERIAL/);
  const rawValueEngine = {...projection, engine: 'password=fixture-only'};
  assert.throws(() => verifyObjectInventoryAuthorityDigest({controllerRun: run, projection: rawValueEngine}),
    /DB_OBJECT_INVENTORY_AUTHORITY_UNSAFE_MATERIAL/);
  const callbackClaim = {...projection, nonClaims: [...NON_CLAIMS, 'callback=https://example.invalid/replay']};
  assert.throws(() => verifyObjectInventoryAuthorityDigest({controllerRun: run, projection: callbackClaim}),
    /DB_OBJECT_INVENTORY_AUTHORITY_UNSAFE_MATERIAL/);
  const freeTextState = {...projection, state: 'COMPLETE; business truth established'};
  assert.throws(() => verifyObjectInventoryAuthorityDigest({controllerRun: run, projection: freeTextState}),
    /DB_OBJECT_INVENTORY_AUTHORITY_PROJECTION_INVALID/);
  const completenessClaim = {...projection, nonClaims: [...NON_CLAIMS, 'ALL_OBJECTS_PRESENT']};
  assert.throws(() => verifyObjectInventoryAuthorityDigest({controllerRun: run, projection: completenessClaim}),
    /DB_OBJECT_INVENTORY_AUTHORITY_CANDIDATE_MISMATCH/);

  const widenedAuthority = {...structuredClone(projection), authority: {...AUTHORITY_FLAGS, mutationAuthority: true}};
  assert.throws(() => verifyObjectInventoryAuthorityDigest({controllerRun: run, projection: widenedAuthority}),
    /DB_OBJECT_INVENTORY_AUTHORITY_CANDIDATE_MISMATCH/);
  const replayClaim = {...structuredClone(projection), authority: {...AUTHORITY_FLAGS, replayPreventionClaimed: true}};
  assert.throws(() => verifyObjectInventoryAuthorityDigest({controllerRun: run, projection: replayClaim}),
    /DB_OBJECT_INVENTORY_AUTHORITY_CANDIDATE_MISMATCH/);
  const dispatchClaim = {...structuredClone(projection), authority: {...AUTHORITY_FLAGS, dispatchAuthority: true}};
  assert.throws(() => verifyObjectInventoryAuthorityDigest({controllerRun: run, projection: dispatchClaim}),
    /DB_OBJECT_INVENTORY_AUTHORITY_CANDIDATE_MISMATCH/);

  const forgedRef = normalizeJsonValue({
    kind: 'COLUMN',
    schemaName: 'dbo',
    relationName: 'FORGED_TABLE',
    columnName: 'FORGED_COLUMN',
    objectName: null,
    sourceObjectSha256: identitySha256({fixture: 'forged-object'}),
  });
  const forgedCoverage = createProgressiveCoverage({
    engine: 'mssql',
    structureSnapshotSha256: baseCoverage.structureSnapshotSha256,
    structureCoverageLedgerSha256: baseCoverage.structureCoverageLedgerSha256,
    entries: [
      ...run.coverage.entries.map(({objectRef, state, reasonCode, sourceQueryId, evidenceRefs}) => ({objectRef, state, reasonCode, sourceQueryId, evidenceRefs})),
      {objectRef: forgedRef, state: 'COMPLETE', reasonCode: null, sourceQueryId: run.coverage.entries[0].sourceQueryId, evidenceRefs: [identitySha256({fixture: 'forged-evidence'})]},
    ],
    queryCoverage: baseCoverage.queryCoverage,
  });
  const forgedRun = withRunBody(run, {coverage: forgedCoverage});
  assert(resumeProgressiveRun(forgedRun), 'fully re-digested forged run is internally consistent');
  const forgedProjection = buildObjectInventoryAuthorityDigest(forgedRun);
  assert(forgedProjection.authorityDigestSha256 !== projection.authorityDigestSha256, 'forged candidate re-digests to a different authority digest');
  assert.throws(() => verifyObjectInventoryAuthorityDigest({controllerRun: run, projection: forgedProjection}),
    /DB_OBJECT_INVENTORY_AUTHORITY_CANDIDATE_MISMATCH/);
  const unmodified = verifyObjectInventoryAuthorityDigest({controllerRun: run, projection});
  assert.equal(unmodified.state, 'VERIFIED', 'unchanged independently supplied controller run still verifies beside the forged candidate');
  assert.equal(unmodified.authorityDigestSha256, projection.authorityDigestSha256);
});

test('verification fails closed on unknown or forbidden top-level input material beside the required keys', async () => {
  const run = await mssqlRun();
  const projection = buildObjectInventoryAuthorityDigest(run);
  const forbiddenTopLevel = Object.freeze({
    sql: 'SELECT * FROM secrets',
    password: 'fixture-only',
    credentials: {user: 'fixture', secret: 'fixture-only'},
    privatePath: '/etc/passwd',
    callback: 'https://example.invalid/replay',
    rawValues: [{value: 'fixture-only'}],
    dispatch: {target: 'fixture'},
    executionAuthority: true,
    mutationAuthority: true,
  });
  for (const [key, value] of Object.entries(forbiddenTopLevel)) {
    assert.throws(
      () => verifyObjectInventoryAuthorityDigest({controllerRun: run, projection, [key]: value}),
      /DB_OBJECT_INVENTORY_AUTHORITY_INPUT_INVALID/,
      `forbidden top-level key ${key} is rejected`,
    );
  }
  const unknownField = {controllerRun: run, projection, extra: 'fixture-only'};
  assert.throws(() => verifyObjectInventoryAuthorityDigest(unknownField),
    /DB_OBJECT_INVENTORY_AUTHORITY_INPUT_INVALID/);
  const missingControllerRun = {projection};
  assert.throws(() => verifyObjectInventoryAuthorityDigest(missingControllerRun),
    /DB_OBJECT_INVENTORY_AUTHORITY_INPUT_INVALID/);
  const missingProjection = {controllerRun: run};
  assert.throws(() => verifyObjectInventoryAuthorityDigest(missingProjection),
    /DB_OBJECT_INVENTORY_AUTHORITY_INPUT_INVALID/);
  const clean = verifyObjectInventoryAuthorityDigest({controllerRun: run, projection});
  assert.equal(clean.state, 'VERIFIED', 'exact two-key input still verifies');
});
