import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {identitySha256, normalizeJsonValue} from '../services/bi-control/src/db-analyzer/core.mjs';
import {
  PROGRESSIVE_OVERRIDE_SCHEMA,
  PROGRESSIVE_PHASES,
  advanceProgressivePhase,
  authorizeProgressiveProbe,
  buildProgressiveCoverage,
  buildProgressiveMethodRegistry,
  createProgressiveBreadthOverride,
  createProgressiveCoverage,
  createProgressiveRun,
  resumeProgressiveRun,
} from '../services/bi-control/src/db-analyzer/progressive-controller.mjs';
import {runAnalyzeProfile} from '../services/bi-control/src/db-analyzer/workflow.mjs';

const ROOT = 'services/bi-control';
const MSSQL_DIRECTORY = `${ROOT}/query-packs/db-analyzer/v1/mssql`;

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function mssqlInputs() {
  const [structureManifest, profilingManifest, structureEvidence] = await Promise.all([
    readJson(`${MSSQL_DIRECTORY}/manifest.json`),
    readJson(`${MSSQL_DIRECTORY}/profiling-manifest.json`),
    runAnalyzeProfile(`${ROOT}/fixtures/mssql-profile-v1.json`, {repositoryRoot: ROOT}),
  ]);
  return {
    engine: 'mssql',
    scope: structureEvidence.profile.scope,
    registry: buildProgressiveMethodRegistry({structureManifest, profilingManifest}),
    coverage: buildProgressiveCoverage(structureEvidence),
  };
}

function mssqlColumnTarget(coverage, offset = 0) {
  const entry = coverage.entries.filter(({objectRef}) => objectRef.kind === 'COLUMN')[offset];
  assert(entry);
  return {
    entry,
    target: {
      kind: 'COLUMN',
      schemaName: entry.objectRef.schemaName,
      relationName: entry.objectRef.relationName,
      columnName: entry.objectRef.columnName,
    },
  };
}

function profileMethod(registry, suffix = 'numeric-aggregate') {
  const method = registry.methods.find(({methodRef}) => methodRef.includes(`profiling.${suffix}@`));
  assert(method);
  return method.methodRef;
}

function request(run, methodRef, target, extra = {}) {
  return {phase: run.phase, methodRef, target, arguments: extra};
}

function advanceTo(run, target) {
  let current = run;
  while (current.phase !== target) {
    const index = PROGRESSIVE_PHASES.indexOf(current.phase);
    current = advanceProgressivePhase(current, PROGRESSIVE_PHASES[index + 1]);
  }
  return current;
}

async function belowThresholdCoverage(inputs, column) {
  const entries = inputs.coverage.entries.map((entry) => ({
    objectRef: entry.objectRef,
    state: entry.objectKey === column.objectKey ? 'UNKNOWN' : entry.state,
    reasonCode: entry.objectKey === column.objectKey ? 'FIXTURE_UNKNOWN' : entry.reasonCode,
    sourceQueryId: entry.sourceQueryId,
    evidenceRefs: entry.evidenceRefs,
  }));
  const coverage = createProgressiveCoverage({
    engine: 'mssql',
    structureSnapshotSha256: inputs.coverage.structureSnapshotSha256,
    structureCoverageLedgerSha256: inputs.coverage.structureCoverageLedgerSha256,
    entries,
    queryCoverage: inputs.coverage.queryCoverage,
  });
  assert(coverage.summary.coverageBps < 9500);
  return coverage;
}

function overrideArgs(inputs, coverage, {runId, column, maxDepthProbeCount, allowedObjectKeys, ...replacements}) {
  return {
    runId,
    scopeSha256: identitySha256(inputs.scope),
    coverageSha256: coverage.coverageSha256,
    reasonCode: 'FIXTURE_KNOWN_BLIND_SPOT',
    actorId: 'fixture-reviewer',
    recordedAt: '2026-08-19T00:00:00.000Z',
    allowedObjectKeys: allowedObjectKeys ?? [column.objectKey],
    maxDepthProbeCount,
    ...replacements,
  };
}

function newRun(inputs, coverage, {runId, budgets, breadthOverride}) {
  return createProgressiveRun({
    runId,
    engine: inputs.engine,
    scope: inputs.scope,
    methodRegistry: inputs.registry,
    coverage,
    budgets,
    breadthOverride,
  });
}

test('established override count is bounded to a positive safe integer at creation (KS #35)', async () => {
  const inputs = await mssqlInputs();
  const {entry: column} = mssqlColumnTarget(inputs.coverage);
  const coverage = await belowThresholdCoverage(inputs, column);
  const runId = 'fixture-mssql-safeint-override';
  assert.throws(() => createProgressiveBreadthOverride(overrideArgs(inputs, coverage, {
    runId,
    column,
    maxDepthProbeCount: Number.MAX_SAFE_INTEGER + 1,
  })), /DB_PROGRESSIVE_OVERRIDE_INVALID/);
});

test('canonical safe-integer counts retain byte-deterministic sealed creation, exact bindings and bounded authorization', async () => {
  const inputs = await mssqlInputs();
  const {entry: column} = mssqlColumnTarget(inputs.coverage);
  const coverage = await belowThresholdCoverage(inputs, column);
  const methodRef = profileMethod(inputs.registry);
  const target = {kind: 'COLUMN', schemaName: column.objectRef.schemaName, relationName: column.objectRef.relationName, columnName: column.objectRef.columnName};
  const cases = [
    {maxDepthProbeCount: 1, budgets: {maxRunProbes: 4, maxObjectProbes: 2}, second: 'EXHAUSTED'},
    {maxDepthProbeCount: Number.MAX_SAFE_INTEGER, budgets: {maxRunProbes: Number.MAX_SAFE_INTEGER, maxObjectProbes: 2}, second: 'AUTHORIZED', third: 'OBJECT_BUDGET'},
  ];
  for (const {maxDepthProbeCount, budgets, second, third} of cases) {
    const runId = `fixture-mssql-safeint-canonical-${maxDepthProbeCount === 1 ? 'one' : 'maxsafe'}`;
    const override = createProgressiveBreadthOverride(overrideArgs(inputs, coverage, {runId, column, maxDepthProbeCount}));
    assert.equal(override.schemaVersion, PROGRESSIVE_OVERRIDE_SCHEMA);
    assert.equal(override.maxDepthProbeCount, maxDepthProbeCount);
    assert.equal(override.runId, runId);
    assert.equal(override.scopeSha256, identitySha256(inputs.scope));
    assert.equal(override.coverageSha256, coverage.coverageSha256);
    assert.deepEqual(override.allowedObjectKeys, [column.objectKey]);
    const again = createProgressiveBreadthOverride(overrideArgs(inputs, coverage, {runId, column, maxDepthProbeCount}));
    assert.equal(again.overrideSha256, override.overrideSha256);
    assert.equal(JSON.stringify(again), JSON.stringify(override));

    const blocked = advanceTo(newRun(inputs, coverage, {runId, budgets, breadthOverride: null}), 'PRIORITIZATION');
    assert.throws(() => advanceProgressivePhase(blocked, 'SAFE_AGGREGATES'), /DB_PROGRESSIVE_BREADTH_GATE_BLOCKED/);

    let run = newRun(inputs, coverage, {runId, budgets, breadthOverride: override});
    assert.equal(run.breadthOverride.overrideSha256, override.overrideSha256);
    const rebuilt = newRun(inputs, coverage, {runId, budgets, breadthOverride: override});
    assert.equal(rebuilt.stateSha256, run.stateSha256);
    run = advanceTo(run, 'SAFE_AGGREGATES');
    const first = authorizeProgressiveProbe(run, request(run, methodRef, target));
    assert.equal(first.authorization.disposition, 'AUTHORIZED');
    run = first.state;
    const resumed = resumeProgressiveRun(JSON.parse(JSON.stringify(run)));
    assert.equal(resumed.stateSha256, run.stateSha256);
    assert.equal(resumed.breadthOverride.maxDepthProbeCount, maxDepthProbeCount);
    run = resumed;
    if (second === 'EXHAUSTED') {
      assert.throws(() => authorizeProgressiveProbe(run, request(run, profileMethod(inputs.registry, 'temporal-aggregate'), target)),
        /DB_PROGRESSIVE_OVERRIDE_BUDGET_EXCEEDED|DB_PROGRESSIVE_OBJECT_BUDGET_EXCEEDED/);
    } else {
      const secondProbe = authorizeProgressiveProbe(run, request(run, profileMethod(inputs.registry, 'temporal-aggregate'), target));
      assert.equal(secondProbe.authorization.disposition, 'AUTHORIZED');
      run = secondProbe.state;
      assert.throws(() => authorizeProgressiveProbe(run, request(run, profileMethod(inputs.registry, 'category-aggregate'), target)),
        /DB_PROGRESSIVE_OBJECT_BUDGET_EXCEEDED/);
    }
  }
});

test('negative-zero, zero, negative, fractional, NaN/infinite and out-of-safe-range counts deny before override persistence', async () => {
  const inputs = await mssqlInputs();
  const {entry: column} = mssqlColumnTarget(inputs.coverage);
  const coverage = await belowThresholdCoverage(inputs, column);
  const runId = 'fixture-mssql-safeint-invalid';
  for (const maxDepthProbeCount of [
    -0, 0, -1, -Number.MAX_SAFE_INTEGER, 0.5, 1.5, NaN,
    Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 2, 1e100,
  ]) {
    assert.throws(() => createProgressiveBreadthOverride(overrideArgs(inputs, coverage, {
      runId,
      column,
      maxDepthProbeCount,
    })), /DB_PROGRESSIVE_OVERRIDE_INVALID/);
  }
});

test('fully re-digested forged unsafe counts deny at run creation and resume beside unchanged authoritative run/coverage', async () => {
  const inputs = await mssqlInputs();
  const {entry: column} = mssqlColumnTarget(inputs.coverage);
  const coverage = await belowThresholdCoverage(inputs, column);
  const runId = 'fixture-mssql-safeint-redigest';
  const canonical = createProgressiveBreadthOverride(overrideArgs(inputs, coverage, {
    runId,
    column,
    maxDepthProbeCount: 1,
  }));
  const forgeUnsafe = (count) => {
    const {overrideSha256: _sealed, ...body} = {...canonical, maxDepthProbeCount: count};
    const normalizedBody = normalizeJsonValue(body);
    return {...normalizedBody, overrideSha256: identitySha256(normalizedBody)};
  };
  const forged = forgeUnsafe(Number.MAX_SAFE_INTEGER + 1);
  assert.notEqual(forged.overrideSha256, canonical.overrideSha256);
  assert.equal(forged.runId, runId);
  assert.equal(forged.coverageSha256, coverage.coverageSha256);
  const budgets = {maxRunProbes: Number.MAX_SAFE_INTEGER + 1, maxObjectProbes: 2};
  assert.throws(() => newRun(inputs, coverage, {runId, budgets, breadthOverride: forged}),
    /DB_PROGRESSIVE_OVERRIDE_INVALID/);
  const clean = advanceTo(newRun(inputs, coverage, {
    runId,
    budgets: {maxRunProbes: 4, maxObjectProbes: 2},
    breadthOverride: canonical,
  }), 'SAFE_AGGREGATES');
  const tampered = JSON.parse(JSON.stringify(clean));
  tampered.breadthOverride = forgeUnsafe(Number.MAX_SAFE_INTEGER + 1);
  assert.throws(() => resumeProgressiveRun(tampered), /DB_PROGRESSIVE_STATE_TAMPERED|DB_PROGRESSIVE_OVERRIDE_TAMPERED|DB_PROGRESSIVE_OVERRIDE_INVALID/);
});

test('replay of a canonical safe-int override after state re-digestion retains exact bindings and determinism', async () => {
  const inputs = await mssqlInputs();
  const {entry: column} = mssqlColumnTarget(inputs.coverage);
  const coverage = await belowThresholdCoverage(inputs, column);
  const runId = 'fixture-mssql-safeint-replay';
  const override = createProgressiveBreadthOverride(overrideArgs(inputs, coverage, {
    runId,
    column,
    maxDepthProbeCount: Number.MAX_SAFE_INTEGER,
  }));
  const budgets = {maxRunProbes: Number.MAX_SAFE_INTEGER, maxObjectProbes: 2};
  const run = advanceTo(newRun(inputs, coverage, {runId, budgets, breadthOverride: override}), 'SAFE_AGGREGATES');
  const replayed = resumeProgressiveRun(JSON.parse(JSON.stringify(run)));
  assert.equal(replayed.stateSha256, run.stateSha256);
  assert.equal(replayed.breadthOverride.overrideSha256, override.overrideSha256);
  assert.equal(replayed.breadthOverride.maxDepthProbeCount, Number.MAX_SAFE_INTEGER);
  assert.equal(replayed.breadthOverride.runId, runId);
  assert.equal(replayed.breadthOverride.scopeSha256, run.scopeSha256);
  assert.equal(replayed.breadthOverride.coverageSha256, run.coverage.coverageSha256);
});

test('stale run/scope/coverage bindings and object substitution deny with a sealed override', async () => {
  const inputs = await mssqlInputs();
  const {entry: column} = mssqlColumnTarget(inputs.coverage);
  const {entry: otherColumn} = mssqlColumnTarget(inputs.coverage, 1);
  const coverage = await belowThresholdCoverage(inputs, column);
  const runId = 'fixture-mssql-safeint-binding';
  const canonical = createProgressiveBreadthOverride(overrideArgs(inputs, coverage, {
    runId,
    column,
    maxDepthProbeCount: 1,
  }));
  const wrongRun = createProgressiveBreadthOverride(overrideArgs(inputs, coverage, {
    runId: 'fixture-mssql-safeint-other',
    column,
    maxDepthProbeCount: 1,
  }));
  assert.throws(() => newRun(inputs, coverage, {
    runId,
    budgets: {maxRunProbes: 4, maxObjectProbes: 2},
    breadthOverride: wrongRun,
  }), /DB_PROGRESSIVE_OVERRIDE_STALE/);
  const wrongScope = createProgressiveBreadthOverride(overrideArgs(inputs, coverage, {
    runId,
    column,
    maxDepthProbeCount: 1,
    ...{scopeSha256: '0'.repeat(64)},
  }));
  assert.throws(() => newRun(inputs, coverage, {
    runId,
    budgets: {maxRunProbes: 4, maxObjectProbes: 2},
    breadthOverride: wrongScope,
  }), /DB_PROGRESSIVE_OVERRIDE_STALE/);
  const wrongCoverage = createProgressiveBreadthOverride(overrideArgs(inputs, coverage, {
    runId,
    column,
    maxDepthProbeCount: 1,
    ...{coverageSha256: '0'.repeat(64)},
  }));
  assert.throws(() => newRun(inputs, coverage, {
    runId,
    budgets: {maxRunProbes: 4, maxObjectProbes: 2},
    breadthOverride: wrongCoverage,
  }), /DB_PROGRESSIVE_OVERRIDE_STALE/);
  const wrongObject = createProgressiveBreadthOverride(overrideArgs(inputs, coverage, {
    runId,
    column,
    maxDepthProbeCount: 1,
    allowedObjectKeys: [otherColumn.objectKey],
  }));
  const run = advanceTo(newRun(inputs, coverage, {
    runId,
    budgets: {maxRunProbes: 4, maxObjectProbes: 2},
    breadthOverride: wrongObject,
  }), 'SAFE_AGGREGATES');
  assert.throws(() => authorizeProgressiveProbe(run, request(run, profileMethod(inputs.registry), mssqlColumnTarget(coverage, 0).target)),
    /DB_PROGRESSIVE_TARGET_COVERAGE_DENIED/);
});

test('duplicate suppression and dispatch/mutation authority denial are retained for safe-int overrides', async () => {
  const inputs = await mssqlInputs();
  const {entry: column, target} = mssqlColumnTarget(inputs.coverage);
  const coverage = await belowThresholdCoverage(inputs, column);
  const runId = 'fixture-mssql-safeint-authority';
  const override = createProgressiveBreadthOverride(overrideArgs(inputs, coverage, {
    runId,
    column,
    maxDepthProbeCount: 1,
  }));
  let run = advanceTo(newRun(inputs, coverage, {
    runId,
    budgets: {maxRunProbes: 4, maxObjectProbes: 2},
    breadthOverride: override,
  }), 'SAFE_AGGREGATES');
  assert.deepEqual(run.safety, {
    allowlistedMethodsOnly: true,
    typedIdentifiersAndArgumentsOnly: true,
    freeSqlAccepted: false,
    rawValuesPersisted: false,
    credentialsPersisted: false,
    missingPrivilegeMeansAbsent: false,
    blindRetryAllowed: false,
  });
  const methodRef = profileMethod(inputs.registry);
  assert.throws(() => authorizeProgressiveProbe(run, request(run, 'mssql.dml.update@1.0.0', target)), /DB_PROGRESSIVE_METHOD_DENIED/);
  assert.throws(() => authorizeProgressiveProbe(run, request(run, 'mssql.ddl.drop-table@1.0.0', target)), /DB_PROGRESSIVE_METHOD_DENIED/);
  assert.throws(() => authorizeProgressiveProbe(run, request(run, methodRef, target, {sql: 'SELECT * FROM secret'})), /DB_PROGRESSIVE_PROBE_REQUEST_INVALID/);
  assert.throws(() => authorizeProgressiveProbe(run, request(run, methodRef, target, {rawValues: ['customer@example.invalid']})), /DB_PROGRESSIVE_PROBE_REQUEST_INVALID/);
  assert.throws(() => authorizeProgressiveProbe(run, request(run, methodRef, target, {password: 'fixture-only'})), /DB_PROGRESSIVE_PROBE_REQUEST_INVALID/);
  const authorized = authorizeProgressiveProbe(run, request(run, methodRef, target));
  assert.equal(authorized.authorization.disposition, 'AUTHORIZED');
  run = authorized.state;
  const duplicate = authorizeProgressiveProbe(run, request(run, methodRef, target));
  assert.equal(duplicate.authorization.disposition, 'SUPPRESSED_DUPLICATE');
  assert.equal(duplicate.state.stateSha256, run.stateSha256);
  assert.equal(JSON.stringify(run).includes('fixture-only'), false);
});