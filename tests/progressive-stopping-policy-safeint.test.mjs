import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {identitySha256} from '../services/bi-control/src/db-analyzer/core.mjs';
import {
  PROGRESSIVE_PHASES,
  advanceProgressivePhase,
  buildProgressiveCoverage,
  buildProgressiveMethodRegistry,
  createProgressiveRun,
} from '../services/bi-control/src/db-analyzer/progressive-controller.mjs';
import {
  buildProgressiveProbeCandidate,
  createProgressiveAnalysis,
  recordProgressiveProbeOutcome,
  registerProgressiveHypothesis,
  reserveProgressiveProbeCandidate,
  resumeProgressiveAnalysis,
} from '../services/bi-control/src/db-analyzer/progressive-analysis-v1.mjs';
import {runAnalyzeProfile} from '../services/bi-control/src/db-analyzer/workflow.mjs';

const ROOT = 'services/bi-control';
const MSSQL_DIRECTORY = `${ROOT}/query-packs/db-analyzer/v1/mssql`;
const fixture = JSON.parse(await readFile(`${ROOT}/fixtures/progressive-analysis-v1.json`, 'utf8'));
const UNSAFE = Number.MAX_SAFE_INTEGER + 1;

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
    scope: structureEvidence.profile.scope,
    registry: buildProgressiveMethodRegistry({structureManifest, profilingManifest}),
    coverage: buildProgressiveCoverage(structureEvidence),
  };
}

function advanceControllerTo(run, target) {
  let current = run;
  while (current.phase !== target) {
    current = advanceProgressivePhase(current, PROGRESSIVE_PHASES[PROGRESSIVE_PHASES.indexOf(current.phase) + 1]);
  }
  return current;
}

function columnTargets(coverage) {
  return coverage.entries
    .filter(({objectRef}) => objectRef.kind === 'COLUMN')
    .map(({objectRef}) => ({
      kind: 'COLUMN', schemaName: objectRef.schemaName, relationName: objectRef.relationName, columnName: objectRef.columnName,
    }));
}

function method(registry, suffix) {
  const found = registry.methods.find(({methodRef}) => methodRef.includes(`profiling.${suffix}@`));
  assert(found, suffix);
  return found.methodRef;
}

async function baseAnalysis({runId = fixture.runId, budgets = fixture.budgets, policy = fixture.policy} = {}) {
  const inputs = await mssqlInputs();
  const controllerRun = advanceControllerTo(createProgressiveRun({
    runId,
    engine: 'mssql',
    scope: inputs.scope,
    methodRegistry: inputs.registry,
    coverage: inputs.coverage,
    budgets: {maxRunProbes: budgets.maxRunProbes, maxObjectProbes: budgets.maxObjectProbes},
  }), 'SAFE_AGGREGATES');
  let analysis = createProgressiveAnalysis({
    controllerRun,
    budgets: {maxTableProbes: budgets.maxTableProbes, maxHypothesisProbes: budgets.maxHypothesisProbes},
    policy,
  });
  const targets = columnTargets(inputs.coverage);
  assert(targets.length >= 2);
  const tableTarget = {kind: 'TABLE', schemaName: targets[0].schemaName, relationName: targets[0].relationName};
  for (const hypothesis of fixture.hypotheses) {
    analysis = registerProgressiveHypothesis(analysis, {
      hypothesisId: hypothesis.hypothesisId,
      hypothesisKind: hypothesis.hypothesisKind,
      target: tableTarget,
      confidenceBounds: hypothesis.confidenceBounds,
      sourceEvidenceRefs: [identitySha256({fixture: hypothesis.sourceEvidence})],
    });
  }
  return {analysis, inputs, targets};
}

function candidate(analysis, {hypothesisId = fixture.hypotheses[0].hypothesisId, methodRef, target, intentFeatures, gain = 'high', arguments: args = {}}) {
  return buildProgressiveProbeCandidate(analysis, {
    hypothesisId,
    phase: analysis.controllerRun.phase,
    methodRef,
    target,
    arguments: args,
    intentFeatures,
    gainInputs: {
      ...fixture.gainInputs[gain],
      evidenceRefs: [identitySha256({fixture: `${hypothesisId}-${gain}`})],
    },
  });
}

const NUMERIC_INTENT = Object.freeze({
  probeClass: 'SAFE_AGGREGATE', signalKind: 'DISTRIBUTION', comparisonKind: 'BASELINE', grain: 'COLUMN',
});
const CARDINALITY_INTENT = Object.freeze({
  probeClass: 'SAFE_AGGREGATE', signalKind: 'CARDINALITY', comparisonKind: 'BASELINE', grain: 'COLUMN',
});

test('unsafely large stopping counters are denied at creation before reservation or dispatch', async () => {
  await assert.rejects(
    baseAnalysis({
      runId: 'fixture-ks35-safeint-unsafe-both',
      policy: {...fixture.policy, maxConsecutiveNoGain: UNSAFE, maxConsecutiveCounterevidence: UNSAFE},
    }),
    /DB_PROGRESSIVE_POLICY_INVALID/,
  );
  await assert.rejects(
    baseAnalysis({runId: 'fixture-ks35-safeint-unsafe-nogain', policy: {...fixture.policy, maxConsecutiveNoGain: UNSAFE}}),
    /DB_PROGRESSIVE_POLICY_INVALID/,
  );
  await assert.rejects(
    baseAnalysis({runId: 'fixture-ks35-safeint-unsafe-counter', policy: {...fixture.policy, maxConsecutiveCounterevidence: UNSAFE}}),
    /DB_PROGRESSIVE_POLICY_INVALID/,
  );
});

test('canonical stopping counters of one and MAX_SAFE_INTEGER retain deterministic construction, resume and evidence-bound stop', async () => {
  const {analysis: initial, inputs, targets} = await baseAnalysis({
    runId: 'fixture-ks35-safeint-one',
    policy: {...fixture.policy, maxConsecutiveNoGain: 1, maxConsecutiveCounterevidence: 1},
  });
  const probe = candidate(initial, {methodRef: method(inputs.registry, 'numeric-aggregate'), target: targets[0], intentFeatures: NUMERIC_INTENT});
  const reserved = reserveProgressiveProbeCandidate(initial, probe, {expectedStateSha256: initial.stateSha256});
  assert.equal(reserved.authorization.disposition, 'RESERVED');
  const stopped = recordProgressiveProbeOutcome(reserved.state, {
    reservationSha256: reserved.authorization.reservationSha256,
    resultState: 'SUCCEEDED',
    evidenceRefs: [identitySha256({fixture: 'ks35-safeint-no-gain'})],
    signal: 'NO_GAIN', informationGainBps: 0,
    confidenceBounds: {lowerBps: 1500, upperBps: 7500}, reasonCode: 'NO_MEASURABLE_GAIN',
  });
  const hypothesis = stopped.hypothesisLedger.entries.find(({hypothesisId}) => hypothesisId === fixture.hypotheses[0].hypothesisId);
  assert.equal(hypothesis.status, 'STOPPED');
  assert.equal(hypothesis.terminalReason, 'NO_GAIN_LIMIT');
  assert.equal(hypothesis.consecutiveNoGain, 1);
  assert.deepEqual(hypothesis.sourceReceiptRefs, [stopped.outcomes[0].outcomeReceiptSha256]);
  assert.deepEqual(hypothesis.contradictions, []);
  const resumed = resumeProgressiveAnalysis(JSON.parse(JSON.stringify(stopped)));
  assert.equal(resumed.stateSha256, stopped.stateSha256);
  const next = candidate(stopped, {methodRef: method(inputs.registry, 'numeric-aggregate'), target: targets[0], intentFeatures: CARDINALITY_INTENT});
  assert.throws(
    () => reserveProgressiveProbeCandidate(stopped, next, {expectedStateSha256: stopped.stateSha256}),
    /DB_PROGRESSIVE_HYPOTHESIS_STOPPED/,
  );

  const maxPolicy = {...fixture.policy, maxConsecutiveNoGain: Number.MAX_SAFE_INTEGER, maxConsecutiveCounterevidence: Number.MAX_SAFE_INTEGER};
  const {analysis: maxState, inputs: maxInputs, targets: maxTargets} = await baseAnalysis({runId: 'fixture-ks35-safeint-max', policy: maxPolicy});
  assert.equal(maxState.policy.maxConsecutiveNoGain, Number.MAX_SAFE_INTEGER);
  assert.equal(resumeProgressiveAnalysis(JSON.parse(JSON.stringify(maxState))).stateSha256, maxState.stateSha256);
  const rebuilt = await baseAnalysis({runId: 'fixture-ks35-safeint-max', policy: maxPolicy});
  assert.equal(rebuilt.analysis.stateSha256, maxState.stateSha256);
  const maxProbe = candidate(maxState, {methodRef: method(maxInputs.registry, 'numeric-aggregate'), target: maxTargets[0], intentFeatures: NUMERIC_INTENT});
  const maxReserved = reserveProgressiveProbeCandidate(maxState, maxProbe, {expectedStateSha256: maxState.stateSha256});
  assert.equal(maxReserved.authorization.disposition, 'RESERVED');
  assert.equal(maxReserved.state.hypothesisLedger.entries[0].status, 'OPEN');
  assert.equal(maxReserved.state.policy.maxConsecutiveNoGain, Number.MAX_SAFE_INTEGER);
});

test('zero, negative, fractional, negative-zero, non-finite and unsafe stopping counters are denied at creation', async () => {
  const bad = [0, -1, 1.5, -0, NaN, Infinity, -Infinity, UNSAFE];
  let index = 0;
  for (const key of ['maxConsecutiveNoGain', 'maxConsecutiveCounterevidence']) {
    for (const value of bad) {
      await assert.rejects(
        baseAnalysis({runId: `fixture-ks35-safeint-bad-${index++}`, policy: {...fixture.policy, [key]: value}}),
        /DB_PROGRESSIVE_POLICY_INVALID/,
      );
    }
  }
});

test('fully re-digested forged state with zero, negative, fractional, negative-zero or unsafe stopping counters is denied at resume', async () => {
  const {analysis: base} = await baseAnalysis({runId: 'fixture-ks35-safeint-forged'});
  const cases = [
    {value: 0, code: /DB_PROGRESSIVE_POLICY_INVALID/},
    {value: -1, code: /DB_PROGRESSIVE_POLICY_INVALID/},
    {value: 1.5, code: /DB_PROGRESSIVE_POLICY_INVALID/},
    {value: -0, code: /DB_PROGRESSIVE_POLICY_INVALID/},
    {value: UNSAFE, code: /DB_PROGRESSIVE_POLICY_INVALID/},
    {value: NaN, code: /DB_CANONICAL_NUMBER_INVALID/},
    {value: Infinity, code: /DB_CANONICAL_NUMBER_INVALID/},
    {value: -Infinity, code: /DB_CANONICAL_NUMBER_INVALID/},
  ];
  for (const key of ['maxConsecutiveNoGain', 'maxConsecutiveCounterevidence']) {
    for (const {value, code} of cases) {
      assert.throws(() => {
        const {stateSha256: _oldStateHash, ...body} = structuredClone(base);
        body.policy = {...body.policy, [key]: value};
        body.stateSha256 = identitySha256(body);
        resumeProgressiveAnalysis(body);
      }, code);
    }
  }
});

test('unchanged-digest policy substitution and claim-bearing hypothesis or run identifiers fail closed', async () => {
  const {analysis: base, inputs, targets} = await baseAnalysis({runId: 'fixture-ks35-safeint-retained-ids'});
  const tampered = structuredClone(base);
  tampered.policy = {...tampered.policy, maxConsecutiveNoGain: UNSAFE, maxConsecutiveCounterevidence: UNSAFE};
  assert.throws(() => resumeProgressiveAnalysis(tampered), /DB_PROGRESSIVE_ANALYSIS_STATE_TAMPERED/);

  const tableTarget = {kind: 'TABLE', schemaName: targets[0].schemaName, relationName: targets[0].relationName};
  assert.throws(() => registerProgressiveHypothesis(base, {
    hypothesisId: 'Claim.Bearing;Identifier', hypothesisKind: 'DISTRIBUTION_ANOMALY', target: tableTarget,
    confidenceBounds: {lowerBps: 1000, upperBps: 6000}, sourceEvidenceRefs: [identitySha256({fixture: 'ks35-claim'})],
  }), /DB_PROGRESSIVE_HYPOTHESIS_INVALID/);
  assert.throws(() => createProgressiveRun({
    runId: 'claim;drop-table', engine: 'mssql', scope: inputs.scope, methodRegistry: inputs.registry,
    coverage: inputs.coverage, budgets: {maxRunProbes: fixture.budgets.maxRunProbes, maxObjectProbes: fixture.budgets.maxObjectProbes},
  }), /DB_PROGRESSIVE_RUN_INVALID/);
});

test('replay, stale CAS, scope drift, free SQL, raw values, credentials and gain bounds fail closed', async () => {
  const {analysis: base, inputs, targets} = await baseAnalysis({runId: 'fixture-ks35-safeint-retained'});
  const valid = candidate(base, {methodRef: method(inputs.registry, 'numeric-aggregate'), target: targets[0], intentFeatures: NUMERIC_INTENT});
  const reserved = reserveProgressiveProbeCandidate(base, valid, {expectedStateSha256: base.stateSha256});
  assert.throws(
    () => reserveProgressiveProbeCandidate(reserved.state, valid, {expectedStateSha256: base.stateSha256}),
    /DB_PROGRESSIVE_STALE_RESERVATION/,
  );
  const outcome = {
    reservationSha256: reserved.authorization.reservationSha256, resultState: 'SUCCEEDED',
    evidenceRefs: [identitySha256({fixture: 'ks35-replayed'})], signal: 'SUPPORTS', informationGainBps: 2100,
    confidenceBounds: {lowerBps: 4000, upperBps: 8500}, reasonCode: 'AGGREGATE_SUPPORT',
  };
  const recorded = recordProgressiveProbeOutcome(reserved.state, outcome);
  assert.throws(() => recordProgressiveProbeOutcome(recorded, outcome), /DB_PROGRESSIVE_OUTCOME_DUPLICATE_OR_UNKNOWN/);

  const other = await baseAnalysis({runId: 'fixture-ks35-safeint-retained-other'});
  assert.throws(
    () => reserveProgressiveProbeCandidate(other.analysis, valid, {expectedStateSha256: other.analysis.stateSha256}),
    /DB_PROGRESSIVE_CANDIDATE_BINDING_INVALID/,
  );

  for (const args of [{sql: 'SELECT 1'}, {rawValues: ['private-value']}, {credential: 'fixture-secret'}]) {
    assert.throws(
      () => candidate(base, {methodRef: method(inputs.registry, 'numeric-aggregate'), target: targets[0], intentFeatures: NUMERIC_INTENT, arguments: args}),
      /DB_PROGRESSIVE_METHOD_DENIED|DB_PROGRESSIVE_PROBE_REQUEST_INVALID/,
    );
  }
  assert.throws(
    () => candidate(base, {methodRef: 'mssql.ddl.drop-table@1.0.0', target: targets[0], intentFeatures: NUMERIC_INTENT}),
    /DB_PROGRESSIVE_METHOD_DENIED/,
  );
  assert.equal(reserved.state.safety.reservationBeforeDispatch, true);
  assert.equal(reserved.state.safety.freeSqlAccepted, false);
  assert.equal(reserved.state.safety.rawValuesPersisted, false);
  assert.equal(reserved.state.safety.credentialsPersisted, false);

  const gainBounded = await baseAnalysis({runId: 'fixture-ks35-safeint-gain-bound', policy: {...fixture.policy, minExpectedGainBps: 3000}});
  const lowGain = candidate(gainBounded.analysis, {
    methodRef: method(gainBounded.inputs.registry, 'numeric-aggregate'), target: gainBounded.targets[0], intentFeatures: CARDINALITY_INTENT, gain: 'medium',
  });
  assert.throws(
    () => reserveProgressiveProbeCandidate(gainBounded.analysis, lowGain, {expectedStateSha256: gainBounded.analysis.stateSha256}),
    /DB_PROGRESSIVE_EXPECTED_GAIN_TOO_LOW/,
  );
});