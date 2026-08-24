import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {identitySha256} from '../services/bi-control/src/db-analyzer/core.mjs';
import {
  PROGRESSIVE_PHASES,
  advanceProgressivePhase,
  authorizeProgressiveProbe,
  buildProgressiveMethodRegistry,
  createProgressiveCoverage,
  createProgressiveRun,
} from '../services/bi-control/src/db-analyzer/progressive-controller.mjs';
import {
  buildSafeAnalysisEvidence,
  executeSafeAnalysisMethod,
} from '../services/bi-control/src/db-analyzer/safe-analysis-methods.mjs';

const ROOT = 'services/bi-control/query-packs/db-analyzer/v1';
const scope = {database: 'FIXTURE', container: null, schemas: ['APP']};
const targets = {
  orderId: {kind: 'COLUMN', schemaName: 'APP', relationName: 'ORDERS', columnName: 'ORDER_ID'},
  customerId: {kind: 'COLUMN', schemaName: 'APP', relationName: 'ORDERS', columnName: 'CUSTOMER_ID'},
  customerKey: {kind: 'COLUMN', schemaName: 'APP', relationName: 'CUSTOMERS', columnName: 'CUSTOMER_ID'},
  orderDate: {kind: 'COLUMN', schemaName: 'APP', relationName: 'ORDERS', columnName: 'ORDER_DATE'},
};
targets.relationship = {
  kind: 'RELATIONSHIP',
  source: {schemaName: 'APP', relationName: 'ORDERS', columnName: 'CUSTOMER_ID'},
  target: {schemaName: 'APP', relationName: 'CUSTOMERS', columnName: 'CUSTOMER_ID'},
};

async function pack(engine) {
  const directory = `${ROOT}/${engine}`;
  const [structureManifest, manifest] = await Promise.all([
    readJson(`${directory}/manifest.json`), readJson(`${directory}/safe-analysis-manifest.json`),
  ]);
  const sqlByMethodId = Object.fromEntries(await Promise.all(manifest.methods.map(async (method) => [
    method.id, await readFile(`${directory}/${method.file}`, 'utf8'),
  ])));
  return {engine, structureManifest, manifest, sqlByMethodId};
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

function coverage(engine) {
  const sourceQueryId = `${engine}.structure.columns`;
  const evidence = identitySha256({fixture: `${engine}-safe-analysis-coverage`});
  return createProgressiveCoverage({
    engine,
    structureSnapshotSha256: identitySha256({fixture: `${engine}-structure-snapshot`}),
    structureCoverageLedgerSha256: identitySha256({fixture: `${engine}-coverage-ledger`}),
    entries: Object.values(targets).filter((target) => target.kind === 'COLUMN').map((target) => ({
      objectRef: {
        kind: 'COLUMN', schemaName: target.schemaName, relationName: target.relationName,
        columnName: target.columnName, objectName: null, sourceObjectSha256: identitySha256({engine, target}),
      },
      state: 'COMPLETE', reasonCode: null, sourceQueryId, evidenceRefs: [evidence],
    })),
    queryCoverage: [
      {queryId: `${engine}.preflight.identity`, category: 'preflight', state: 'SUCCEEDED', reasonCode: null, visibility: 'VISIBLE_COMPLETE', absenceClaim: 'NOT_CLAIMED'},
      {queryId: sourceQueryId, category: 'columns', state: 'SUCCEEDED', reasonCode: null, visibility: 'VISIBLE_COMPLETE', absenceClaim: 'NOT_CLAIMED'},
    ],
  });
}

function advanceTo(run, phase) {
  let state = run;
  while (state.phase !== phase) state = advanceProgressivePhase(state, PROGRESSIVE_PHASES[PROGRESSIVE_PHASES.indexOf(state.phase) + 1]);
  return state;
}

async function controller(engine, phase, budgets = {maxRunProbes: 8, maxObjectProbes: 3}) {
  const packed = await pack(engine);
  const registry = buildProgressiveMethodRegistry({
    structureManifest: packed.structureManifest, safeAnalysisManifest: packed.manifest,
  });
  const run = advanceTo(createProgressiveRun({
    runId: `fixture-${engine}-${phase.toLowerCase().replaceAll('_', '-')}`,
    engine, scope, methodRegistry: registry, coverage: coverage(engine), budgets,
  }), phase);
  return {...packed, registry, run};
}

function methodRef(registry, semanticMethod) {
  const found = registry.methods.find((method) => method.methodRef.includes(`safe.${semanticMethod.toLowerCase().replaceAll('_', '-')}@`));
  assert(found, semanticMethod);
  return found.methodRef;
}

function authorize(run, registry, semanticMethod, target, typeFamily) {
  return authorizeProgressiveProbe(run, {
    phase: run.phase, methodRef: methodRef(registry, semanticMethod), target,
    arguments: {maxSourceRows: 500, typeFamily},
  });
}

function buildEvidence(state, {semanticMethod, target, typeFamily, row}) {
  const authorized = authorize(state.run, state.registry, semanticMethod, target, typeFamily);
  const method = state.manifest.methods.find(({semanticMethod: name}) => name === semanticMethod);
  const built = buildSafeAnalysisEvidence({
    controllerState: authorized.state, manifest: state.manifest, methodId: method.id, target,
    arguments: {maxSourceRows: 500, typeFamily},
    result: {state: 'SUCCEEDED', reasonCode: null, rows: [row]},
    authorization: authorized.authorization,
  });
  return {authorized, method, built};
}

const session = (engine, rows, capture = []) => ({
  engine,
  readOnly: true,
  async execute(request) {
    capture.push(request);
    return {state: 'SUCCEEDED', reasonCode: null, rows};
  },
});

test('raw numeric negative zero in authorized MSSQL column-summary counts fails DB_SAFE_METHOD_RESULT_INVALID before normalization', async () => {
  const state = await controller('mssql', 'SAFE_AGGREGATES');
  const authorized = authorize(state.run, state.registry, 'COLUMN_SUMMARY', targets.orderId, 'NUMERIC');
  const method = state.manifest.methods.find(({semanticMethod}) => semanticMethod === 'COLUMN_SUMMARY');
  assert.throws(() => buildSafeAnalysisEvidence({
    controllerState: authorized.state, manifest: state.manifest, methodId: method.id, target: targets.orderId,
    arguments: {maxSourceRows: 500, typeFamily: 'NUMERIC'},
    result: {state: 'SUCCEEDED', reasonCode: null, rows: [{rowCount: -0, nullCount: -0, distinctCount: -0}]},
    authorization: authorized.authorization,
  }), {code: 'DB_SAFE_METHOD_RESULT_INVALID'}, 'buildSafeAnalysisEvidence must fail closed on raw -0');
  await assert.rejects(() => executeSafeAnalysisMethod({
    run: authorized.state, authorization: authorized.authorization, manifest: state.manifest,
    sqlByMethodId: state.sqlByMethodId, session: session('mssql', [{rowCount: -0, nullCount: -0, distinctCount: -0}]),
  }), {code: 'DB_SAFE_METHOD_RESULT_INVALID'}, 'exact-main executable probe must fail closed on raw -0');
});

test("canonical '0', numeric 0 and bigint 0n counts retain deterministic engine-neutral zero evidence", async () => {
  const semanticHashes = [];
  const engineSeals = [];
  const forms = [
    {rowCount: '0', nullCount: 0, distinctCount: 0n},
    {rowCount: 0, nullCount: '0', distinctCount: 0n},
    {rowCount: 0n, nullCount: 0, distinctCount: '0'},
  ];
  for (const engine of ['mssql', 'oracle']) {
    for (const row of forms) {
      const state = await controller(engine, 'SAFE_AGGREGATES');
      const {method, built} = buildEvidence(state, {semanticMethod: 'COLUMN_SUMMARY', target: targets.orderId, typeFamily: 'NUMERIC', row});
      assert.equal(built.state, 'COMPLETE');
      assert.equal(built.receiptState, 'SUCCEEDED');
      const observed = built.observedClaims[0].metrics;
      assert.deepEqual(observed, {rowCount: 0, nullCount: 0, distinctCount: 0});
      for (const value of Object.values(observed)) assert.equal(Object.is(value, -0), false);
      assert.deepEqual(built.computedClaims[0].metrics, {nonNullCount: 0, duplicateCount: 0, nullRateBasisPoints: 0, distinctRateBasisPoints: 0});
      assert.deepEqual(built.inferredClaims, []);
      assert.deepEqual(built.counterevidence.map(({reasonCode}) => reasonCode), ['EMPTY_BOUNDED_SCOPE']);
      assert.deepEqual(built.bounds, {maxSourceRows: 500, timeoutMs: method.timeoutMs, maxOutputRows: 1});
      assert.equal(built.automaticFactPromotion, false);
      assert.equal(built.rawValuesPersisted, false);
      assert.equal(built.absenceClaim, 'NOT_CLAIMED');
      semanticHashes.push(built.semanticEvidenceSha256);
      engineSeals.push(built.evidenceSha256);
    }
  }
  assert.equal(new Set(semanticHashes).size, 1, 'all canonical zero forms and engines must share one semantic hash');
  assert.equal(engineSeals[0], engineSeals[1]);
  assert.equal(engineSeals[1], engineSeals[2]);
  assert.equal(engineSeals[3], engineSeals[4]);
  assert.equal(engineSeals[4], engineSeals[5]);
  assert.notEqual(engineSeals[0], engineSeals[3], 'engine-bound seals must differ across engines');
});

test('ordinary safe aggregate counts retain deterministic engine-neutral observed, computed, proposal-only and counterevidence behavior', async () => {
  const semanticHashes = [];
  for (const engine of ['mssql', 'oracle']) {
    const state = await controller(engine, 'HYPOTHESIS_VALIDATION');
    const {built} = buildEvidence(state, {semanticMethod: 'QUALITY_INDICATORS', target: targets.customerId, typeFamily: 'NUMERIC', row: {rowCount: '12', nullCount: 0, distinctCount: 12n}});
    assert.equal(built.state, 'COMPLETE');
    assert.deepEqual(built.observedClaims[0].metrics, {rowCount: 12, nullCount: 0, distinctCount: 12});
    assert.deepEqual(built.computedClaims[0].metrics, {nonNullCount: 12, duplicateCount: 0, nullRateBasisPoints: 0, distinctRateBasisPoints: 10000});
    assert.equal(built.computedClaims[0].keyEligible, true);
    assert.deepEqual(built.inferredClaims, [{observationKind: 'INFERRED', inferenceKind: 'KEY_CANDIDATE', claimStatus: 'PROPOSAL_ONLY', compositeKeyCompletenessClaimed: false}]);
    assert.deepEqual(built.counterevidence, []);
    assert.equal(built.automaticForeignKey, false);
    semanticHashes.push(built.semanticEvidenceSha256);
  }
  assert.equal(semanticHashes[0], semanticHashes[1]);
});

test('raw numeric negative zero fails independently in every accepted aggregate count column including relationship counts', async () => {
  const relationshipColumns = ['sourceNonNullCount', 'sourceDistinctCount', 'targetNonNullCount', 'targetDistinctCount', 'matchedDistinctCount'];
  const relationshipRow = {sourceNonNullCount: 4, sourceDistinctCount: 3, targetNonNullCount: 3, targetDistinctCount: 3, matchedDistinctCount: 3};
  const sweep = [
    ['mssql', 'SAFE_AGGREGATES', 'COLUMN_SUMMARY', targets.orderId, 'NUMERIC', ['rowCount', 'nullCount', 'distinctCount'], {rowCount: 4, nullCount: 0, distinctCount: 4}],
    ['mssql', 'SAFE_AGGREGATES', 'TEMPORAL_COVERAGE', targets.orderDate, 'TEMPORAL', ['rowCount', 'nullCount', 'distinctCount'], {rowCount: 5, nullCount: 1, distinctCount: 4, minimum: '2026-01-01', maximum: '2026-01-05', freshnessMaximum: '2026-01-05'}],
    ['mssql', 'HYPOTHESIS_VALIDATION', 'QUALITY_INDICATORS', targets.customerId, 'NUMERIC', ['rowCount', 'nullCount', 'distinctCount'], {rowCount: 4, nullCount: 0, distinctCount: 4}],
    ['mssql', 'RELATIONSHIP_GRAPH', 'RELATIONSHIP_OVERLAP', targets.relationship, 'PAIR', relationshipColumns, relationshipRow],
    ['oracle', 'RELATIONSHIP_GRAPH', 'RELATIONSHIP_OVERLAP', targets.relationship, 'PAIR', relationshipColumns, relationshipRow],
  ];
  for (const [engine, phase, semanticMethod, target, typeFamily, columns, base] of sweep) {
    for (const column of columns) {
      const state = await controller(engine, phase);
      assert.throws(() => buildEvidence(state, {semanticMethod, target, typeFamily, row: {...base, [column]: -0}}),
        {code: 'DB_SAFE_METHOD_RESULT_INVALID'}, `${engine} ${semanticMethod} ${column} must fail closed on raw -0`);
    }
  }
});

test('non-canonical strings, negative, fractional, unsafe and inconsistent aggregate counts remain denied', async () => {
  const rows = [
    {rowCount: '-0', nullCount: 0, distinctCount: 0},
    {rowCount: '0.0', nullCount: 0, distinctCount: 0},
    {rowCount: '+0', nullCount: 0, distinctCount: 0},
    {rowCount: ' 0', nullCount: 0, distinctCount: 0},
    {rowCount: '0x10', nullCount: 0, distinctCount: 0},
    {rowCount: '1e2', nullCount: 0, distinctCount: 0},
    {rowCount: -1, nullCount: 0, distinctCount: 0},
    {rowCount: -0.5, nullCount: 0, distinctCount: 0},
    {rowCount: 0.5, nullCount: 0, distinctCount: 0},
    {rowCount: 1.5, nullCount: 0, distinctCount: 0},
    {rowCount: 2 ** 53, nullCount: 0, distinctCount: 0},
    {rowCount: 2n ** 53n, nullCount: 0, distinctCount: 0},
    {rowCount: null, nullCount: 0, distinctCount: 0},
    {rowCount: true, nullCount: 0, distinctCount: 0},
    {rowCount: 4, nullCount: '-0', distinctCount: 4},
    {rowCount: 4, nullCount: 0, distinctCount: -0},
    {rowCount: '12', nullCount: '4', distinctCount: 9},
    {rowCount: 1, nullCount: 2, distinctCount: 0},
    {rowCount: 1, nullCount: 0, distinctCount: 2},
  ];
  for (const row of rows) {
    const state = await controller('mssql', 'SAFE_AGGREGATES');
    const label = JSON.stringify(row, (_key, value) => (typeof value === 'bigint' ? value.toString() : value));
    assert.throws(() => buildEvidence(state, {semanticMethod: 'COLUMN_SUMMARY', target: targets.orderId, typeFamily: 'NUMERIC', row}),
      {code: 'DB_SAFE_METHOD_RESULT_INVALID'}, `must deny ${label}`);
  }
});

test('multi-row results, raw-value shaped output and cancellation with rows remain denied', async () => {
  const state = await controller('mssql', 'SAFE_AGGREGATES');
  const authorized = authorize(state.run, state.registry, 'COLUMN_SUMMARY', targets.orderId, 'NUMERIC');
  const method = state.manifest.methods.find(({semanticMethod}) => semanticMethod === 'COLUMN_SUMMARY');
  const input = (result, target = targets.orderId) => buildSafeAnalysisEvidence({
    controllerState: authorized.state, manifest: state.manifest, methodId: method.id, target,
    arguments: {maxSourceRows: 500, typeFamily: 'NUMERIC'}, result, authorization: authorized.authorization,
  });
  assert.throws(() => input({state: 'SUCCEEDED', reasonCode: null, rows: [{rowCount: 1, nullCount: 0, distinctCount: 1}, {rowCount: 1, nullCount: 0, distinctCount: 1}]}),
    {code: 'DB_SAFE_METHOD_RESULT_INVALID'}, 'multi-row results must be denied');
  for (const forbidden of [{sampleValue: 'person@example.invalid'}, {rawValue: 'private'}, {exampleValue: 'private'}, {password: 'private'}]) {
    assert.throws(() => input({state: 'SUCCEEDED', reasonCode: null, rows: [{rowCount: 1, nullCount: 0, distinctCount: 1, ...forbidden}]}),
      {code: 'DB_SAFE_METHOD_RAW_VALUE_DENIED'}, `raw-value shaped output ${JSON.stringify(forbidden)} must be denied`);
  }
  assert.throws(() => input({state: 'CANCELLED', reasonCode: 'QUERY_CANCELLED', rows: [{rowCount: 1, nullCount: 0, distinctCount: 1}]}),
    {code: 'DB_SAFE_METHOD_RAW_VALUE_DENIED'}, 'cancellation with rows must be denied');
  const cancelled = input({state: 'CANCELLED', reasonCode: 'QUERY_CANCELLED', rows: []});
  assert.equal(cancelled.state, 'UNKNOWN');
  assert.equal(cancelled.receiptState, 'CANCELLED');
  assert.equal(cancelled.absenceClaim, 'NOT_CLAIMED');
});

test('digest-bound substitution, replay drift, claim-bearing identifiers and authority denials remain in force', async () => {
  const state = await controller('mssql', 'SAFE_AGGREGATES');
  const authorized = authorize(state.run, state.registry, 'COLUMN_SUMMARY', targets.orderId, 'NUMERIC');
  const method = state.manifest.methods.find(({semanticMethod}) => semanticMethod === 'COLUMN_SUMMARY');
  const result = {state: 'SUCCEEDED', reasonCode: null, rows: [{rowCount: 4, nullCount: 0, distinctCount: 4}]};
  const base = {
    controllerState: authorized.state, manifest: state.manifest, methodId: method.id, target: targets.orderId,
    arguments: {maxSourceRows: 500, typeFamily: 'NUMERIC'}, result, authorization: authorized.authorization,
  };
  const forgedManifest = structuredClone(state.manifest);
  forgedManifest.methods[0].engineDifferences[0] = 'tampered engine difference';
  assert.throws(() => buildSafeAnalysisEvidence({...base, manifest: forgedManifest}),
    {code: 'DB_SAFE_METHOD_CONTROLLER_AUTHORIZATION_REQUIRED'}, 'unchanged-digest manifest substitution must be denied');
  assert.throws(() => buildSafeAnalysisEvidence({...base, target: targets.customerId}),
    {code: 'DB_SAFE_METHOD_CONTROLLER_AUTHORIZATION_REQUIRED'}, 'forged result evidence beside unchanged controller authorization must be denied');
  const drifted = structuredClone(authorized.state);
  const probe = drifted.probes.find((entry) => entry.probeKey === authorized.authorization.probeKey);
  probe.arguments.maxSourceRows = 1;
  assert.throws(() => buildSafeAnalysisEvidence({...base, controllerState: drifted}),
    {code: 'DB_SAFE_METHOD_CONTROLLER_AUTHORIZATION_REQUIRED'}, 'replayed state with stale digest must be denied');
  assert.throws(() => buildSafeAnalysisEvidence({...base, target: {...targets.orderId, columnName: 'PASSWORD_HASH'}}),
    {code: 'DB_SAFE_METHOD_TARGET_INVALID'}, 'claim-bearing identifiers must be denied');
  const ref = methodRef(state.registry, 'COLUMN_SUMMARY');
  assert.throws(() => authorizeProgressiveProbe(state.run, {phase: state.run.phase, methodRef: ref, target: targets.orderId, arguments: {sql: 'SELECT 1'}}),
    /DB_/);
  await assert.rejects(() => executeSafeAnalysisMethod({
    run: authorized.state, authorization: authorized.authorization, manifest: state.manifest, sqlByMethodId: state.sqlByMethodId,
    session: {engine: 'mssql', readOnly: true, password: 'fixture', execute: async () => ({})},
  }), {code: 'DB_SAFE_METHOD_READ_ONLY_SESSION_REQUIRED'}, 'credential-shaped sessions must be denied');
  await assert.rejects(() => executeSafeAnalysisMethod({
    run: authorized.state, authorization: authorized.authorization, manifest: state.manifest, sqlByMethodId: state.sqlByMethodId,
    session: {engine: 'mssql', readOnly: false, execute: async () => ({})},
  }), {code: 'DB_SAFE_METHOD_READ_ONLY_SESSION_REQUIRED'}, 'mutation-capable sessions must be denied');
  await assert.rejects(() => executeSafeAnalysisMethod({
    run: authorized.state, authorization: authorized.authorization, manifest: state.manifest, sqlByMethodId: state.sqlByMethodId,
    session: {engine: 'mssql', readOnly: true},
  }), {code: 'DB_SAFE_METHOD_READ_ONLY_SESSION_REQUIRED'}, 'sessions without dispatch execute must be denied');
  const zero = buildSafeAnalysisEvidence({...base, result: {state: 'SUCCEEDED', reasonCode: null, rows: [{rowCount: '0', nullCount: 0, distinctCount: 0n}]}});
  assert.equal(zero.state, 'COMPLETE');
  assert.equal(zero.automaticFactPromotion, false);
  assert.equal(zero.automaticForeignKey, false);
  assert.equal(zero.absenceClaim, 'NOT_CLAIMED');
  assert.deepEqual(zero.inferredClaims, []);
});