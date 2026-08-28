import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {buildPreflightEvidence, identitySha256} from '../services/bi-control/src/db-analyzer/core.mjs';
import {
  PROGRESSIVE_PHASES,
  advanceProgressivePhase,
  buildProgressiveCoverage,
  buildProgressiveMethodRegistry,
  createProgressiveRun,
} from '../services/bi-control/src/db-analyzer/progressive-controller.mjs';
import {
  advanceProgressiveAnalysisPhase,
  buildProgressiveAnalysisReport,
  buildProgressiveTypedDrilldownRequest,
  buildProgressiveProbeCandidate,
  createProgressiveAnalysis,
  evaluateProgressiveDrilldownEligibility,
  rankProgressiveProbeCandidates,
  rankProgressiveDrilldownRequests,
  reconcileProgressiveUnknownOutcome,
  recordProgressiveProbeOutcome,
  registerProgressiveHypothesis,
  reserveProgressiveProbeCandidate,
  resumeProgressiveAnalysis,
} from '../services/bi-control/src/db-analyzer/progressive-analysis-v1.mjs';
import {runAnalyzeProfile} from '../services/bi-control/src/db-analyzer/workflow.mjs';

const ROOT = 'services/bi-control';
const MSSQL_DIRECTORY = `${ROOT}/query-packs/db-analyzer/v1/mssql`;
const fixture = JSON.parse(await readFile(`${ROOT}/fixtures/progressive-analysis-v1.json`, 'utf8'));

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

async function safeAnalysis({runId, phase, maxRunProbes = 8} = {}) {
  const [structureManifest, profilingManifest, safeAnalysisManifest, structureEvidence] = await Promise.all([
    readJson(`${MSSQL_DIRECTORY}/manifest.json`),
    readJson(`${MSSQL_DIRECTORY}/profiling-manifest.json`),
    readJson(`${ROOT}/query-packs/db-analyzer/v1/mssql/safe-analysis-manifest.json`),
    runAnalyzeProfile(`${ROOT}/fixtures/mssql-profile-v1.json`, {repositoryRoot: ROOT}),
  ]);
  const coverage = buildProgressiveCoverage(structureEvidence);
  const registry = buildProgressiveMethodRegistry({structureManifest, profilingManifest, safeAnalysisManifest});
  const controllerRun = advanceControllerTo(createProgressiveRun({
    runId, engine: 'mssql', scope: structureEvidence.profile.scope, methodRegistry: registry, coverage,
    budgets: {maxRunProbes, maxObjectProbes: Math.min(3, maxRunProbes)},
  }), phase);
  let analysis = createProgressiveAnalysis({
    controllerRun, budgets: {maxTableProbes: Math.min(4, maxRunProbes), maxHypothesisProbes: Math.min(3, maxRunProbes)}, policy: fixture.policy,
  });
  const targets = columnTargets(coverage);
  const hypothesis = fixture.hypotheses[0];
  analysis = registerProgressiveHypothesis(analysis, {
    hypothesisId: hypothesis.hypothesisId, hypothesisKind: hypothesis.hypothesisKind,
    target: {kind: 'TABLE', schemaName: targets[0].schemaName, relationName: targets[0].relationName},
    confidenceBounds: hypothesis.confidenceBounds,
    sourceEvidenceRefs: [identitySha256({fixture: `typed-${hypothesis.sourceEvidence}`})],
  });
  return {analysis, registry, targets};
}

function safeMethod(registry, semanticMethod) {
  const found = registry.methods.find(({methodRef}) => methodRef.includes(`safe.${semanticMethod.toLowerCase().replaceAll('_', '-')}@`));
  assert(found, semanticMethod);
  return found.methodRef;
}

function typedRequest(state, {
  claim = 'claim', gap = 'gap', methodRef, target, typeFamily, arguments: args, phase = state.controllerRun.phase,
  intentFeatures, gain = 'high', resumeReceiptSha256,
}) {
  const input = {
    claimSha256: identitySha256({fixture: claim}),
    evidenceGapSha256: identitySha256({fixture: gap}),
    hypothesisId: fixture.hypotheses[0].hypothesisId,
    phase,
    methodRef,
    target,
    arguments: args ?? {maxSourceRows: 500, typeFamily},
    intentFeatures,
    gainInputs: {...fixture.gainInputs[gain], evidenceRefs: [identitySha256({fixture: `${claim}-gain`})]},
  };
  if (resumeReceiptSha256 !== undefined) input.resumeReceiptSha256 = resumeReceiptSha256;
  return buildProgressiveTypedDrilldownRequest(state, input);
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
const TEMPORAL_INTENT = Object.freeze({
  probeClass: 'TEMPORAL_CHECK', signalKind: 'TEMPORAL', comparisonKind: 'BASELINE', grain: 'COLUMN',
});

async function noGainTerminal({advanceReport = true} = {}) {
  const {analysis: initial, inputs, targets} = await baseAnalysis();
  let state = initial;
  const first = candidate(state, {methodRef: method(inputs.registry, 'numeric-aggregate'), target: targets[0], intentFeatures: NUMERIC_INTENT});
  let reserved = reserveProgressiveProbeCandidate(state, first, {expectedStateSha256: state.stateSha256});
  state = recordProgressiveProbeOutcome(reserved.state, {
    reservationSha256: reserved.authorization.reservationSha256,
    resultState: 'SUCCEEDED',
    evidenceRefs: [identitySha256({fixture: 'first-no-gain'})],
    signal: 'NO_GAIN', informationGainBps: 0,
    confidenceBounds: {lowerBps: 1500, upperBps: 7500}, reasonCode: 'NO_MEASURABLE_GAIN',
  });
  const second = candidate(state, {methodRef: method(inputs.registry, 'numeric-aggregate'), target: targets[1], intentFeatures: CARDINALITY_INTENT, gain: 'medium'});
  reserved = reserveProgressiveProbeCandidate(state, second, {expectedStateSha256: state.stateSha256});
  state = recordProgressiveProbeOutcome(reserved.state, {
    reservationSha256: reserved.authorization.reservationSha256,
    resultState: 'SUCCEEDED',
    evidenceRefs: [identitySha256({fixture: 'second-no-gain'})],
    signal: 'NO_GAIN', informationGainBps: 0,
    confidenceBounds: {lowerBps: 1500, upperBps: 7500}, reasonCode: 'NO_MEASURABLE_GAIN',
  });
  while (advanceReport && state.controllerRun.phase !== 'REPORT') {
    state = advanceProgressiveAnalysisPhase(state, PROGRESSIVE_PHASES[PROGRESSIVE_PHASES.indexOf(state.controllerRun.phase) + 1]);
  }
  return state;
}

test('reservation-before-dispatch debits run, table and hypothesis budgets and deterministic rank persists calculated EIG', async () => {
  const {analysis: initial, inputs, targets} = await baseAnalysis();
  const numeric = candidate(initial, {methodRef: method(inputs.registry, 'numeric-aggregate'), target: targets[0], intentFeatures: NUMERIC_INTENT, gain: 'high'});
  const lower = candidate(initial, {methodRef: method(inputs.registry, 'temporal-aggregate'), target: targets[0], intentFeatures: TEMPORAL_INTENT, gain: 'medium'});
  const ranked = rankProgressiveProbeCandidates(initial, [lower, numeric]);
  assert.deepEqual(ranked.map(({candidateSha256}) => candidateSha256), [numeric.candidateSha256, lower.candidateSha256]);
  assert.equal(numeric.expectedGain.expectedInformationGainBps, 4320);

  let reserved = reserveProgressiveProbeCandidate(initial, numeric, {expectedStateSha256: initial.stateSha256});
  assert.equal(reserved.authorization.disposition, 'RESERVED');
  assert.equal(reserved.state.controllerRun.budget.authorizedProbeCount, 1);
  assert.deepEqual(reserved.state.budget.tableReservationCounts.map(({count}) => count), [1]);
  assert.deepEqual(reserved.state.budget.hypothesisReservationCounts.map(({count}) => count), [1]);

  const near = candidate(reserved.state, {
    methodRef: method(inputs.registry, 'temporal-aggregate'), target: targets[0], intentFeatures: NUMERIC_INTENT, gain: 'high',
  });
  const suppressed = reserveProgressiveProbeCandidate(reserved.state, near, {expectedStateSha256: reserved.state.stateSha256});
  assert.equal(suppressed.authorization.disposition, 'SUPPRESSED_NEAR_DUPLICATE');
  assert.equal(suppressed.state.stateSha256, reserved.state.stateSha256);

  const distinct = candidate(reserved.state, {
    methodRef: method(inputs.registry, 'temporal-aggregate'), target: targets[0], intentFeatures: TEMPORAL_INTENT, gain: 'medium',
  });
  reserved = reserveProgressiveProbeCandidate(reserved.state, distinct, {expectedStateSha256: reserved.state.stateSha256});
  assert.equal(reserved.authorization.disposition, 'RESERVED');
  assert.equal(reserved.state.budget.tableReservationCounts[0].count, 2);
});

test('two consecutive no-gain outcomes stop the hypothesis before another reservation and restart is byte-deterministic', async () => {
  const terminal = await noGainTerminal();
  const hypothesis = terminal.hypothesisLedger.entries.find(({hypothesisId}) => hypothesisId === fixture.hypotheses[0].hypothesisId);
  assert.equal(hypothesis.status, 'STOPPED');
  assert.equal(hypothesis.terminalReason, 'NO_GAIN_LIMIT');
  assert.equal(hypothesis.consecutiveNoGain, 2);
  const resumed = resumeProgressiveAnalysis(JSON.parse(JSON.stringify(terminal)));
  assert.equal(resumed.stateSha256, terminal.stateSha256);
  const firstReport = buildProgressiveAnalysisReport(terminal);
  const resumedReport = buildProgressiveAnalysisReport(resumed);
  assert.equal(firstReport.analysisEvidenceSha256, resumedReport.analysisEvidenceSha256);
  assert.equal(firstReport.hypothesisLedger.entries[0].automaticBusinessTruth, false);

  const stopped = await noGainTerminal({advanceReport: false});
  const {inputs, targets} = await baseAnalysis();
  const blocked = candidate(stopped, {methodRef: method(inputs.registry, 'numeric-aggregate'), target: targets[0], intentFeatures: TEMPORAL_INTENT});
  assert.throws(
    () => reserveProgressiveProbeCandidate(stopped, blocked, {expectedStateSha256: stopped.stateSha256}),
    /DB_PROGRESSIVE_HYPOTHESIS_STOPPED/,
  );
});

test('compare-and-swap rejects a stale concurrent reservation without overspending the one-slot table or hypothesis budget', async () => {
  const {analysis: initial, inputs, targets} = await baseAnalysis({
    runId: 'fixture-mssql-progressive-concurrent',
    budgets: {...fixture.budgets, maxTableProbes: 1, maxHypothesisProbes: 1},
  });
  const first = candidate(initial, {methodRef: method(inputs.registry, 'numeric-aggregate'), target: targets[0], intentFeatures: NUMERIC_INTENT});
  const second = candidate(initial, {methodRef: method(inputs.registry, 'temporal-aggregate'), target: targets[0], intentFeatures: TEMPORAL_INTENT});
  const committed = reserveProgressiveProbeCandidate(initial, first, {expectedStateSha256: initial.stateSha256});
  assert.throws(
    () => reserveProgressiveProbeCandidate(committed.state, second, {expectedStateSha256: initial.stateSha256}),
    /DB_PROGRESSIVE_STALE_RESERVATION/,
  );
  assert.equal(committed.state.controllerRun.budget.authorizedProbeCount, 1);
  assert.equal(committed.state.budget.tableReservationCounts[0].count, 1);
  assert.equal(committed.state.budget.hypothesisReservationCounts[0].count, 1);
});

test('sequential table and hypothesis reservation limits each fail closed before controller dispatch', async () => {
  for (const budgetCase of [
    {name: 'table', budgets: {...fixture.budgets, maxTableProbes: 1, maxHypothesisProbes: 3}, expected: /DB_PROGRESSIVE_TABLE_BUDGET_EXCEEDED/},
    {name: 'hypothesis', budgets: {...fixture.budgets, maxTableProbes: 3, maxHypothesisProbes: 1}, expected: /DB_PROGRESSIVE_HYPOTHESIS_BUDGET_EXCEEDED/},
  ]) {
    const {analysis: initial, inputs, targets} = await baseAnalysis({
      runId: `fixture-mssql-progressive-${budgetCase.name}-budget`, budgets: budgetCase.budgets,
    });
    const first = candidate(initial, {methodRef: method(inputs.registry, 'numeric-aggregate'), target: targets[0], intentFeatures: NUMERIC_INTENT});
    const committed = reserveProgressiveProbeCandidate(initial, first, {expectedStateSha256: initial.stateSha256});
    const second = candidate(committed.state, {
      methodRef: method(inputs.registry, 'numeric-aggregate'), target: targets[1], intentFeatures: CARDINALITY_INTENT,
    });
    assert.throws(
      () => reserveProgressiveProbeCandidate(committed.state, second, {expectedStateSha256: committed.state.stateSha256}),
      budgetCase.expected,
    );
    assert.equal(committed.state.controllerRun.budget.authorizedProbeCount, 1);
  }
});

test('unknown outcome remains debited and non-retryable, then append-only reconciliation is deterministic across restart', async () => {
  const {analysis: initial, inputs, targets} = await baseAnalysis({runId: 'fixture-mssql-progressive-unknown'});
  const probe = candidate(initial, {methodRef: method(inputs.registry, 'numeric-aggregate'), target: targets[0], intentFeatures: NUMERIC_INTENT});
  const reserved = reserveProgressiveProbeCandidate(initial, probe, {expectedStateSha256: initial.stateSha256});
  const unknown = recordProgressiveProbeOutcome(reserved.state, {
    reservationSha256: reserved.authorization.reservationSha256,
    resultState: 'UNKNOWN', evidenceRefs: [], signal: 'UNKNOWN', informationGainBps: 0,
    confidenceBounds: {lowerBps: 1500, upperBps: 7500}, reasonCode: 'DISPATCH_OUTCOME_UNKNOWN',
  });
  const suppressed = reserveProgressiveProbeCandidate(unknown, probe, {expectedStateSha256: unknown.stateSha256});
  assert.equal(suppressed.authorization.disposition, 'SUPPRESSED_UNKNOWN_OUTCOME');
  assert.equal(suppressed.state.controllerRun.budget.authorizedProbeCount, 1);
  const restarted = resumeProgressiveAnalysis(JSON.parse(JSON.stringify(unknown)));
  const reconciliation = {
    outcomeReceiptSha256: unknown.outcomes[0].outcomeReceiptSha256,
    resolvedState: 'SUCCEEDED',
    reconciliationEvidenceRefs: [identitySha256({fixture: 'unknown-readback-confirmed'})],
    signal: 'SUPPORTS', informationGainBps: 2100,
    confidenceBounds: {lowerBps: 4000, upperBps: 8500}, reasonCode: 'READBACK_CONFIRMED_SUCCESS',
  };
  const direct = reconcileProgressiveUnknownOutcome(unknown, reconciliation);
  const afterRestart = reconcileProgressiveUnknownOutcome(restarted, reconciliation);
  assert.equal(direct.stateSha256, afterRestart.stateSha256);
  assert.equal(direct.reconciliations.length, 1);
  assert.equal(direct.controllerRun.receipts[0].resultState, 'UNKNOWN');
  assert.equal(reserveProgressiveProbeCandidate(direct, probe, {expectedStateSha256: direct.stateSha256}).authorization.disposition, 'REUSED_RECONCILED_SUCCESS');
});

test('counterevidence is retained without fact promotion and repeated counterevidence stops the branch', async () => {
  const {analysis: initial, inputs, targets} = await baseAnalysis({runId: 'fixture-mssql-progressive-counter'});
  let state = initial;
  for (const [index, intentFeatures] of [NUMERIC_INTENT, CARDINALITY_INTENT].entries()) {
    const probe = candidate(state, {methodRef: method(inputs.registry, 'numeric-aggregate'), target: targets[index], intentFeatures, gain: index === 0 ? 'high' : 'medium'});
    const reserved = reserveProgressiveProbeCandidate(state, probe, {expectedStateSha256: state.stateSha256});
    state = recordProgressiveProbeOutcome(reserved.state, {
      reservationSha256: reserved.authorization.reservationSha256,
      resultState: 'SUCCEEDED', evidenceRefs: [identitySha256({fixture: `counter-${index}`})],
      signal: 'COUNTERS', informationGainBps: 1700,
      confidenceBounds: {lowerBps: 500, upperBps: 3500}, reasonCode: 'AGGREGATE_COUNTEREVIDENCE',
    });
  }
  const hypothesis = state.hypothesisLedger.entries.find(({hypothesisId}) => hypothesisId === fixture.hypotheses[0].hypothesisId);
  assert.equal(hypothesis.status, 'STOPPED');
  assert.equal(hypothesis.terminalReason, 'REPEATED_COUNTEREVIDENCE');
  assert.equal(hypothesis.counterevidenceRefs.length, 2);
  assert.equal(hypothesis.contradictions.length, 2);
  assert.equal(hypothesis.automaticBusinessTruth, false);
});

test('forged gain, counter rollback, replay, cross-scope, unsafe parameters and terminal timeout/cancel fail closed', async () => {
  const {analysis: initial, inputs, targets} = await baseAnalysis({runId: 'fixture-mssql-progressive-negative'});
  const valid = candidate(initial, {methodRef: method(inputs.registry, 'numeric-aggregate'), target: targets[0], intentFeatures: NUMERIC_INTENT});
  const forged = structuredClone(valid);
  forged.expectedGain.expectedInformationGainBps += 1;
  const {expectedGainSha256: _oldGainHash, ...forgedGainBody} = forged.expectedGain;
  forged.expectedGain.expectedGainSha256 = identitySha256(forgedGainBody);
  const {candidateSha256: _oldCandidateHash, ...forgedBody} = forged;
  forged.candidateSha256 = identitySha256(forgedBody);
  assert.throws(() => reserveProgressiveProbeCandidate(initial, forged, {expectedStateSha256: initial.stateSha256}), /DB_PROGRESSIVE_GAIN_FORGED/);

  const unsafeCases = [
    () => candidate(initial, {methodRef: 'mssql.ddl.drop-table@1.0.0', target: targets[0], intentFeatures: NUMERIC_INTENT}),
    () => candidate(initial, {methodRef: method(inputs.registry, 'numeric-aggregate'), target: targets[0], intentFeatures: NUMERIC_INTENT, arguments: {sql: 'SELECT * FROM secret'}}),
    () => candidate(initial, {methodRef: method(inputs.registry, 'numeric-aggregate'), target: targets[0], intentFeatures: NUMERIC_INTENT, arguments: {rawValues: ['private-value']}}),
    () => candidate(initial, {methodRef: method(inputs.registry, 'numeric-aggregate'), target: targets[0], intentFeatures: NUMERIC_INTENT, arguments: {credential: 'fixture-secret'}}),
  ];
  for (const unsafe of unsafeCases) {
    assert.throws(
      unsafe,
      /DB_PROGRESSIVE_METHOD_DENIED|DB_PROGRESSIVE_PROBE_REQUEST_INVALID/,
    );
  }

  const reserved = reserveProgressiveProbeCandidate(initial, valid, {expectedStateSha256: initial.stateSha256});
  const rolledBack = structuredClone(reserved.state);
  rolledBack.budget.tableReservationCounts[0].count = 0;
  const {stateSha256: _oldStateHash, ...rolledBackBody} = rolledBack;
  rolledBack.stateSha256 = identitySha256(rolledBackBody);
  assert.throws(() => resumeProgressiveAnalysis(rolledBack), /DB_PROGRESSIVE_BUDGET_STATE_INVALID/);

  const crossScope = await baseAnalysis({runId: 'fixture-mssql-progressive-other-scope'});
  assert.throws(
    () => reserveProgressiveProbeCandidate(crossScope.analysis, valid, {expectedStateSha256: crossScope.analysis.stateSha256}),
    /DB_PROGRESSIVE_CANDIDATE_BINDING_INVALID/,
  );
  const timedOut = recordProgressiveProbeOutcome(reserved.state, {
    reservationSha256: reserved.authorization.reservationSha256,
    resultState: 'TIMEOUT', evidenceRefs: [], signal: 'UNKNOWN', informationGainBps: 0,
    confidenceBounds: {lowerBps: 1500, upperBps: 7500}, reasonCode: 'QUERY_TIMEOUT',
  });
  assert.equal(timedOut.hypothesisLedger.entries.find(({hypothesisId}) => hypothesisId === fixture.hypotheses[0].hypothesisId).terminalReason, 'TIMEOUT');
  assert.equal(timedOut.safety.blindRetryAllowed, false);
  assert.throws(() => recordProgressiveProbeOutcome(timedOut, {
    reservationSha256: reserved.authorization.reservationSha256,
    resultState: 'CANCELLED', evidenceRefs: [], signal: 'UNKNOWN', informationGainBps: 0,
    confidenceBounds: {lowerBps: 1500, upperBps: 7500}, reasonCode: 'QUERY_CANCELLED',
  }), /DB_PROGRESSIVE_OUTCOME_DUPLICATE_OR_UNKNOWN/);

  const cancelBase = await baseAnalysis({runId: 'fixture-mssql-progressive-cancel'});
  const cancelCandidate = candidate(cancelBase.analysis, {
    methodRef: method(cancelBase.inputs.registry, 'numeric-aggregate'), target: cancelBase.targets[0], intentFeatures: NUMERIC_INTENT,
  });
  const cancelReservation = reserveProgressiveProbeCandidate(cancelBase.analysis, cancelCandidate, {expectedStateSha256: cancelBase.analysis.stateSha256});
  const cancelled = recordProgressiveProbeOutcome(cancelReservation.state, {
    reservationSha256: cancelReservation.authorization.reservationSha256,
    resultState: 'CANCELLED', evidenceRefs: [], signal: 'UNKNOWN', informationGainBps: 0,
    confidenceBounds: {lowerBps: 1500, upperBps: 7500}, reasonCode: 'QUERY_CANCELLED',
  });
  assert.equal(cancelled.hypothesisLedger.entries.find(({hypothesisId}) => hypothesisId === fixture.hypotheses[0].hypothesisId).terminalReason, 'CANCELLED');
  assert.equal(reserveProgressiveProbeCandidate(cancelled, cancelCandidate, {expectedStateSha256: cancelled.stateSha256}).authorization.disposition, 'SUPPRESSED_TERMINAL_OUTCOME');
});

test('sequential, restart, concurrent-reservation and unknown-outcome fixture hashes are deterministic', async () => {
  const sequential = await noGainTerminal();
  const restart = resumeProgressiveAnalysis(JSON.parse(JSON.stringify(sequential)));
  const sequentialHash = buildProgressiveAnalysisReport(sequential).analysisEvidenceSha256;
  const restartHash = buildProgressiveAnalysisReport(restart).analysisEvidenceSha256;
  assert.equal(sequentialHash, restartHash);

  const concurrent = await baseAnalysis({
    runId: 'fixture-mssql-progressive-hash-concurrent',
    budgets: {...fixture.budgets, maxTableProbes: 1, maxHypothesisProbes: 1},
  });
  const concurrentCandidate = candidate(concurrent.analysis, {
    methodRef: method(concurrent.inputs.registry, 'numeric-aggregate'), target: concurrent.targets[0], intentFeatures: NUMERIC_INTENT,
  });
  const concurrentState = reserveProgressiveProbeCandidate(concurrent.analysis, concurrentCandidate, {expectedStateSha256: concurrent.analysis.stateSha256}).state;

  const unknownBase = await baseAnalysis({runId: 'fixture-mssql-progressive-hash-unknown'});
  const unknownCandidate = candidate(unknownBase.analysis, {
    methodRef: method(unknownBase.inputs.registry, 'numeric-aggregate'), target: unknownBase.targets[0], intentFeatures: NUMERIC_INTENT,
  });
  const unknownReservation = reserveProgressiveProbeCandidate(unknownBase.analysis, unknownCandidate, {expectedStateSha256: unknownBase.analysis.stateSha256});
  const unknownState = recordProgressiveProbeOutcome(unknownReservation.state, {
    reservationSha256: unknownReservation.authorization.reservationSha256,
    resultState: 'UNKNOWN', evidenceRefs: [], signal: 'UNKNOWN', informationGainBps: 0,
    confidenceBounds: {lowerBps: 1500, upperBps: 7500}, reasonCode: 'DISPATCH_OUTCOME_UNKNOWN',
  });
  const hashes = {
    sequentialTerminal: sequentialHash,
    restartTerminal: restartHash,
    concurrentReservationState: concurrentState.stateSha256,
    unknownOutcomeState: unknownState.stateSha256,
  };
  assert.deepEqual(hashes, JSON.parse(JSON.stringify(hashes)));
  if (process.env.KS_PRINT_PROGRESSIVE_ANALYSIS_HASHES === '1') console.log(JSON.stringify(hashes));
});

test('typed drilldown eligibility seals the four existing safe paths and preserves claim-to-receipt evidence traceability', async () => {
  const paths = [
    {phase: 'SAFE_AGGREGATES', semanticMethod: 'COLUMN_SUMMARY', typeFamily: 'NUMERIC', intentFeatures: NUMERIC_INTENT},
    {phase: 'SAFE_AGGREGATES', semanticMethod: 'TEMPORAL_COVERAGE', typeFamily: 'TEMPORAL', intentFeatures: TEMPORAL_INTENT},
    {phase: 'RELATIONSHIP_GRAPH', semanticMethod: 'RELATIONSHIP_OVERLAP', typeFamily: 'PAIR', intentFeatures: {...NUMERIC_INTENT, probeClass: 'RELATIONSHIP_CHECK', signalKind: 'RELATIONSHIP', grain: 'TABLE'}},
    {phase: 'HYPOTHESIS_VALIDATION', semanticMethod: 'QUALITY_INDICATORS', typeFamily: 'NUMERIC', intentFeatures: {...NUMERIC_INTENT, probeClass: 'QUALITY_CHECK', signalKind: 'NULLABILITY'}},
  ];
  const decisions = [];
  for (const [index, path] of paths.entries()) {
    const {analysis, registry, targets} = await safeAnalysis({
      runId: `fixture-typed-drilldown-${index}`, phase: path.phase,
    });
    const target = path.semanticMethod === 'RELATIONSHIP_OVERLAP'
      ? {kind: 'RELATIONSHIP', source: (({kind: _sourceKind, ...source}) => source)(targets[0]), target: (({kind: _targetKind, ...target}) => target)(targets[1])}
      : targets[index === 1 ? 1 : 0];
    const request = typedRequest(analysis, {
      claim: `claim-${index}`, gap: `gap-${index}`, methodRef: safeMethod(registry, path.semanticMethod), target,
      typeFamily: path.typeFamily, intentFeatures: path.intentFeatures,
    });
    const decision = evaluateProgressiveDrilldownEligibility(analysis, request);
    assert.equal(decision.disposition, 'ELIGIBLE');
    assert.equal(decision.dispatchAllowed, false);
    assert.equal(decision.trace.claimSha256, request.claimSha256);
    assert.equal(decision.trace.evidenceGapSha256, request.evidenceGapSha256);
    assert.equal(decision.trace.intent.methodRef, request.methodRef);
    assert.equal(decision.trace.intent.candidateSha256, request.candidateSha256);
    assert.deepEqual(decision.gates, {
      phase: true, scope: true, allowlist: true, privilege: true, capability: true,
      runBudget: true, tableBudget: true, hypothesisBudget: true, duplicate: true,
      timeout: true, cancellation: true, receiptResume: true, stoppingRule: true,
    });
    decisions.push(decision);
  }
  assert.equal(new Set(decisions.map(({eligibilitySha256}) => eligibilitySha256)).size, paths.length);
});

test('typed drilldown ordering and terminal eligibility digest are independent of request input order and restart', async () => {
  const {analysis, registry, targets} = await safeAnalysis({runId: 'fixture-typed-drilldown-order', phase: 'SAFE_AGGREGATES'});
  const first = typedRequest(analysis, {
    claim: 'order-first', gap: 'order-gap-first', methodRef: safeMethod(registry, 'COLUMN_SUMMARY'), target: targets[0],
    typeFamily: 'NUMERIC', intentFeatures: NUMERIC_INTENT,
  });
  const second = typedRequest(analysis, {
    claim: 'order-second', gap: 'order-gap-second', methodRef: safeMethod(registry, 'TEMPORAL_COVERAGE'), target: targets[1],
    typeFamily: 'TEMPORAL', intentFeatures: TEMPORAL_INTENT, gain: 'medium',
  });
  const forward = rankProgressiveDrilldownRequests(analysis, [second, first]);
  const reverse = rankProgressiveDrilldownRequests(JSON.parse(JSON.stringify(analysis)), [first, second]);
  assert.deepEqual(forward.map(({requestSha256}) => requestSha256), reverse.map(({requestSha256}) => requestSha256));
  assert.equal(forward.terminalDigestSha256, reverse.terminalDigestSha256);
  assert.equal(forward.eligible.length, 2);
  assert(forward.eligible.every(({dispatchAllowed}) => dispatchAllowed === false));
  if (process.env.KS_PRINT_PROGRESSIVE_ANALYSIS_HASHES === '1') {
    console.log(JSON.stringify({typedDrilldownTerminalDigest: forward.terminalDigestSha256}));
  }
});

test('typed drilldown eligibility fails closed for authorization, capability, receipt, budget, duplicate, timeout and cancellation gates', async () => {
  const {analysis, registry, targets} = await safeAnalysis({runId: 'fixture-typed-drilldown-negative', phase: 'SAFE_AGGREGATES'});
  const methodRef = safeMethod(registry, 'COLUMN_SUMMARY');
  const valid = typedRequest(analysis, {methodRef, target: targets[0], typeFamily: 'NUMERIC', intentFeatures: NUMERIC_INTENT});
  const invalidArguments = {...valid, arguments: {sql: 'SELECT secret'}};
  assert.throws(() => buildProgressiveTypedDrilldownRequest(analysis, {
    claimSha256: valid.claimSha256, evidenceGapSha256: valid.evidenceGapSha256, hypothesisId: valid.hypothesisId,
    phase: valid.phase, methodRef, target: targets[0], arguments: invalidArguments.arguments,
    intentFeatures: NUMERIC_INTENT, gainInputs: fixture.gainInputs.high,
  }), /DB_PROGRESSIVE_METHOD_DENIED|DB_PROGRESSIVE_PROBE_REQUEST_INVALID/);
  const deniedAllowlistRequest = buildProgressiveTypedDrilldownRequest(analysis, {
    claimSha256: valid.claimSha256, evidenceGapSha256: valid.evidenceGapSha256, hypothesisId: valid.hypothesisId,
    phase: valid.phase, methodRef: 'mssql.safe.model-authored-sql@1.0.0', target: targets[0],
    arguments: {maxSourceRows: 500, typeFamily: 'NUMERIC'}, intentFeatures: NUMERIC_INTENT,
    gainInputs: {...fixture.gainInputs.high, evidenceRefs: [identitySha256({fixture: 'denied-allowlist-gain'})]},
  });
  assert.equal(evaluateProgressiveDrilldownEligibility(analysis, deniedAllowlistRequest).disposition, 'DENIED_ALLOWLIST');
  assert.throws(() => buildProgressiveTypedDrilldownRequest(analysis, {
    claimSha256: valid.claimSha256, evidenceGapSha256: valid.evidenceGapSha256, hypothesisId: valid.hypothesisId,
    phase: valid.phase, methodRef, target: targets[0], arguments: {maxSourceRows: 500, credential: 'fixture-secret'},
    intentFeatures: NUMERIC_INTENT, gainInputs: fixture.gainInputs.high,
  }), /DB_PROGRESSIVE_METHOD_DENIED|DB_PROGRESSIVE_PROBE_REQUEST_INVALID/);
  const unsupported = typedRequest(analysis, {
    claim: 'unsupported', gap: 'unsupported-gap', methodRef, target: targets[0], typeFamily: 'TEMPORAL', intentFeatures: NUMERIC_INTENT,
  });
  assert.equal(evaluateProgressiveDrilldownEligibility(analysis, unsupported).disposition, 'TERMINATED_UNSUPPORTED_CAPABILITY');
  const invisible = typedRequest(analysis, {
    claim: 'invisible', gap: 'invisible-gap', methodRef, target: {...targets[0], columnName: 'NOT_VISIBLE'},
    typeFamily: 'NUMERIC', intentFeatures: NUMERIC_INTENT,
  });
  assert.equal(evaluateProgressiveDrilldownEligibility(analysis, invisible).disposition, 'DENIED_SCOPE');
  const forged = structuredClone(valid);
  forged.requestSha256 = '0'.repeat(64);
  assert.throws(() => evaluateProgressiveDrilldownEligibility(analysis, forged), /DB_PROGRESSIVE_DRILLDOWN_REQUEST_TAMPERED/);

  const receiptBase = await safeAnalysis({runId: 'fixture-typed-drilldown-receipt', phase: 'SAFE_AGGREGATES'});
  const receiptRequest = typedRequest(receiptBase.analysis, {
    methodRef: safeMethod(receiptBase.registry, 'COLUMN_SUMMARY'), target: receiptBase.targets[0], typeFamily: 'NUMERIC', intentFeatures: NUMERIC_INTENT,
  });
  const receiptReservation = reserveProgressiveProbeCandidate(receiptBase.analysis, receiptRequest.candidate, {
    expectedStateSha256: receiptBase.analysis.stateSha256,
    claimSha256: receiptRequest.claimSha256, evidenceGapSha256: receiptRequest.evidenceGapSha256,
  });
  const receiptEvidence = identitySha256({fixture: 'typed-receipt-counterevidence'});
  const received = recordProgressiveProbeOutcome(receiptReservation.state, {
    reservationSha256: receiptReservation.authorization.reservationSha256, resultState: 'SUCCEEDED', evidenceRefs: [receiptEvidence],
    signal: 'COUNTERS', informationGainBps: 1700, confidenceBounds: {lowerBps: 500, upperBps: 3500}, reasonCode: 'TYPED_COUNTEREVIDENCE',
  });
  const receiptSha256 = received.controllerRun.receipts[0].receiptSha256;
  const resumedRequest = typedRequest(received, {
    methodRef: safeMethod(receiptBase.registry, 'COLUMN_SUMMARY'), target: receiptBase.targets[0], typeFamily: 'NUMERIC', intentFeatures: NUMERIC_INTENT,
    resumeReceiptSha256: receiptSha256,
  });
  const resumedDecision = evaluateProgressiveDrilldownEligibility(received, resumedRequest);
  assert.equal(resumedDecision.disposition, 'REUSED_SUCCESS');
  assert.equal(resumedDecision.trace.receipt.resultState, 'SUCCEEDED');
  assert.deepEqual(resumedDecision.trace.evidence.evidenceRefs, [receiptEvidence]);
  assert.deepEqual(resumedDecision.trace.evidence.counterevidenceRefs, [receiptEvidence]);
  const changedArguments = typedRequest(received, {
    methodRef: safeMethod(receiptBase.registry, 'COLUMN_SUMMARY'), target: receiptBase.targets[0], typeFamily: 'NUMERIC',
    arguments: {maxSourceRows: 501, typeFamily: 'NUMERIC'}, intentFeatures: NUMERIC_INTENT,
  });
  const changedArgumentsDecision = evaluateProgressiveDrilldownEligibility(received, changedArguments);
  assert.equal(changedArgumentsDecision.disposition, 'SUPPRESSED_DUPLICATE');
  assert.equal(changedArgumentsDecision.trace.receipt, null);
  assert.deepEqual(changedArgumentsDecision.trace.evidence.evidenceRefs, []);
  const changedArgumentsResume = typedRequest(received, {
    methodRef: safeMethod(receiptBase.registry, 'COLUMN_SUMMARY'), target: receiptBase.targets[0], typeFamily: 'NUMERIC',
    arguments: {maxSourceRows: 501, typeFamily: 'NUMERIC'}, intentFeatures: NUMERIC_INTENT, resumeReceiptSha256: receiptSha256,
  });
  const changedArgumentsResumeDecision = evaluateProgressiveDrilldownEligibility(received, changedArgumentsResume);
  assert.equal(changedArgumentsResumeDecision.disposition, 'SUPPRESSED_DUPLICATE');
  assert.equal(changedArgumentsResumeDecision.trace.receipt, null);
  const crossClaimResume = typedRequest(received, {
    claim: 'other-claim', gap: 'gap', methodRef: safeMethod(receiptBase.registry, 'COLUMN_SUMMARY'),
    target: receiptBase.targets[0], typeFamily: 'NUMERIC', intentFeatures: NUMERIC_INTENT, resumeReceiptSha256: receiptSha256,
  });
  assert.equal(evaluateProgressiveDrilldownEligibility(received, crossClaimResume).disposition, 'DENIED_RECEIPT_RESUME');
  const crossClaimNoResume = typedRequest(received, {
    claim: 'other-claim', gap: 'gap', methodRef: safeMethod(receiptBase.registry, 'COLUMN_SUMMARY'),
    target: receiptBase.targets[0], typeFamily: 'NUMERIC', intentFeatures: NUMERIC_INTENT,
  });
  assert.equal(evaluateProgressiveDrilldownEligibility(received, crossClaimNoResume).disposition, 'DENIED_RECEIPT_RESUME');
  const gapSubstitution = typedRequest(received, {
    claim: 'claim', gap: 'other-gap', methodRef: safeMethod(receiptBase.registry, 'COLUMN_SUMMARY'),
    target: receiptBase.targets[0], typeFamily: 'NUMERIC', intentFeatures: NUMERIC_INTENT, resumeReceiptSha256: receiptSha256,
  });
  assert.equal(evaluateProgressiveDrilldownEligibility(received, gapSubstitution).disposition, 'DENIED_RECEIPT_RESUME');

  const reserved = reserveProgressiveProbeCandidate(analysis, valid.candidate, {
    expectedStateSha256: analysis.stateSha256,
    claimSha256: valid.claimSha256, evidenceGapSha256: valid.evidenceGapSha256,
  });
  const duplicateRequest = typedRequest(reserved.state, {
    methodRef, target: targets[0], typeFamily: 'NUMERIC', intentFeatures: NUMERIC_INTENT,
  });
  const duplicate = evaluateProgressiveDrilldownEligibility(reserved.state, duplicateRequest);
  assert.equal(duplicate.disposition, 'SUPPRESSED_DUPLICATE');
  assert.throws(() => evaluateProgressiveDrilldownEligibility(reserved.state, valid), /DB_PROGRESSIVE_DRILLDOWN_REQUEST_INVALID/);
  const forgedBudget = structuredClone(valid);
  forgedBudget.remainingBudget = {...valid.remainingBudget, runProbes: valid.remainingBudget.runProbes + 1};
  const {requestSha256: _oldRequestHash, ...forgedBudgetBody} = forgedBudget;
  forgedBudget.requestSha256 = identitySha256(forgedBudgetBody);
  assert.throws(() => evaluateProgressiveDrilldownEligibility(analysis, forgedBudget), /DB_PROGRESSIVE_DRILLDOWN_REQUEST_INVALID/);
  assert.throws(() => reserveProgressiveProbeCandidate(reserved.state, valid.candidate, {
    expectedStateSha256: reserved.state.stateSha256,
    claimSha256: identitySha256({fixture: 'other-claim'}), evidenceGapSha256: valid.evidenceGapSha256,
  }), /DB_PROGRESSIVE_CLAIM_BINDING_INVALID/);
  assert.throws(() => reserveProgressiveProbeCandidate(reserved.state, valid.candidate, {
    expectedStateSha256: reserved.state.stateSha256,
    claimSha256: valid.claimSha256, evidenceGapSha256: null,
  }), /DB_PROGRESSIVE_CLAIM_BINDING_INVALID/);
  const exhausted = await safeAnalysis({runId: 'fixture-typed-drilldown-exhausted', phase: 'SAFE_AGGREGATES', maxRunProbes: 1});
  const exhaustedRequest = typedRequest(exhausted.analysis, {
    methodRef: safeMethod(exhausted.registry, 'COLUMN_SUMMARY'), target: exhausted.targets[0], typeFamily: 'NUMERIC', intentFeatures: NUMERIC_INTENT,
  });
  const exhaustedState = reserveProgressiveProbeCandidate(exhausted.analysis, exhaustedRequest.candidate, {
    expectedStateSha256: exhausted.analysis.stateSha256,
    claimSha256: exhaustedRequest.claimSha256, evidenceGapSha256: exhaustedRequest.evidenceGapSha256,
  }).state;
  const budget = evaluateProgressiveDrilldownEligibility(exhaustedState, typedRequest(exhaustedState, {
    claim: 'other', gap: 'other-gap', methodRef: safeMethod(exhausted.registry, 'COLUMN_SUMMARY'), target: exhausted.targets[1], typeFamily: 'NUMERIC', intentFeatures: NUMERIC_INTENT,
  }));
  assert.equal(budget.disposition, 'DENIED_BUDGET');

  const timedOut = recordProgressiveProbeOutcome(reserved.state, {
    reservationSha256: reserved.authorization.reservationSha256, resultState: 'TIMEOUT', evidenceRefs: [], signal: 'UNKNOWN', informationGainBps: 0,
    confidenceBounds: {lowerBps: 1500, upperBps: 7500}, reasonCode: 'QUERY_TIMEOUT',
  });
  const timedOutRequest = typedRequest(timedOut, {
    methodRef, target: targets[0], typeFamily: 'NUMERIC', intentFeatures: NUMERIC_INTENT,
  });
  assert.equal(evaluateProgressiveDrilldownEligibility(timedOut, timedOutRequest).disposition, 'TERMINATED_TIMEOUT');
  const changedArgumentsTimedOutRequest = typedRequest(timedOut, {
    methodRef, target: targets[0], typeFamily: 'NUMERIC', arguments: {maxSourceRows: 501, typeFamily: 'NUMERIC'}, intentFeatures: NUMERIC_INTENT,
  });
  const changedArgumentsTimedOutDecision = evaluateProgressiveDrilldownEligibility(timedOut, changedArgumentsTimedOutRequest);
  assert.equal(changedArgumentsTimedOutDecision.disposition, 'SUPPRESSED_DUPLICATE');
  assert.equal(changedArgumentsTimedOutDecision.trace.receipt, null);
  const cancelBase = await safeAnalysis({runId: 'fixture-typed-drilldown-cancel', phase: 'SAFE_AGGREGATES'});
  const cancelRequest = typedRequest(cancelBase.analysis, {
    methodRef: safeMethod(cancelBase.registry, 'COLUMN_SUMMARY'), target: cancelBase.targets[0], typeFamily: 'NUMERIC', intentFeatures: NUMERIC_INTENT,
  });
  const cancelReservation = reserveProgressiveProbeCandidate(cancelBase.analysis, cancelRequest.candidate, {
    expectedStateSha256: cancelBase.analysis.stateSha256,
    claimSha256: cancelRequest.claimSha256, evidenceGapSha256: cancelRequest.evidenceGapSha256,
  });
  const cancelled = recordProgressiveProbeOutcome(cancelReservation.state, {
    reservationSha256: cancelReservation.authorization.reservationSha256, resultState: 'CANCELLED', evidenceRefs: [], signal: 'UNKNOWN', informationGainBps: 0,
    confidenceBounds: {lowerBps: 1500, upperBps: 7500}, reasonCode: 'QUERY_CANCELLED',
  });
  const cancelledRequest = typedRequest(cancelled, {
    methodRef: safeMethod(cancelBase.registry, 'COLUMN_SUMMARY'), target: cancelBase.targets[0], typeFamily: 'NUMERIC', intentFeatures: NUMERIC_INTENT,
  });
  assert.equal(evaluateProgressiveDrilldownEligibility(cancelled, cancelledRequest).disposition, 'TERMINATED_CANCELLED');
  const changedArgumentsCancelledRequest = typedRequest(cancelled, {
    methodRef: safeMethod(cancelBase.registry, 'COLUMN_SUMMARY'), target: cancelBase.targets[0], typeFamily: 'NUMERIC',
    arguments: {maxSourceRows: 501, typeFamily: 'NUMERIC'}, intentFeatures: NUMERIC_INTENT,
  });
  const changedArgumentsCancelledDecision = evaluateProgressiveDrilldownEligibility(cancelled, changedArgumentsCancelledRequest);
  assert.equal(changedArgumentsCancelledDecision.disposition, 'SUPPRESSED_DUPLICATE');
  assert.equal(changedArgumentsCancelledDecision.trace.receipt, null);
  const staleReceiptRequest = {...valid, resumeReceiptSha256: '0'.repeat(64)};
  delete staleReceiptRequest.requestSha256;
  staleReceiptRequest.requestSha256 = identitySha256(staleReceiptRequest);
  assert.equal(evaluateProgressiveDrilldownEligibility(analysis, staleReceiptRequest).disposition, 'DENIED_RECEIPT_RESUME');
});

test('typed drilldown duplicate lookup is bound to the controller probe key across hypothesis and intent changes', async () => {
  const {analysis, registry, targets} = await safeAnalysis({runId: 'fixture-typed-drilldown-probe-key', phase: 'SAFE_AGGREGATES'});
  const secondHypothesis = fixture.hypotheses[1];
  assert(secondHypothesis, 'expected a second fixture hypothesis');
  const registered = registerProgressiveHypothesis(analysis, {
    hypothesisId: secondHypothesis.hypothesisId, hypothesisKind: secondHypothesis.hypothesisKind,
    target: {kind: 'TABLE', schemaName: targets[0].schemaName, relationName: targets[0].relationName},
    confidenceBounds: secondHypothesis.confidenceBounds,
    sourceEvidenceRefs: [identitySha256({fixture: `typed-${secondHypothesis.sourceEvidence}`})],
  });
  const methodRef = safeMethod(registry, 'COLUMN_SUMMARY');
  const base = typedRequest(registered, {methodRef, target: targets[0], typeFamily: 'NUMERIC', intentFeatures: NUMERIC_INTENT});
  const reserved = reserveProgressiveProbeCandidate(registered, base.candidate, {
    expectedStateSha256: registered.stateSha256,
    claimSha256: base.claimSha256, evidenceGapSha256: base.evidenceGapSha256,
  });
  const probeEvidence = identitySha256({fixture: 'typed-probe-key-evidence'});
  const received = recordProgressiveProbeOutcome(reserved.state, {
    reservationSha256: reserved.authorization.reservationSha256, resultState: 'SUCCEEDED', evidenceRefs: [probeEvidence],
    signal: 'COUNTERS', informationGainBps: 1700, confidenceBounds: {lowerBps: 500, upperBps: 3500}, reasonCode: 'TYPED_COUNTEREVIDENCE',
  });
  const exactReuse = typedRequest(received, {methodRef, target: targets[0], typeFamily: 'NUMERIC', intentFeatures: NUMERIC_INTENT});
  const exactReuseDecision = evaluateProgressiveDrilldownEligibility(received, exactReuse);
  assert.equal(exactReuseDecision.disposition, 'REUSED_SUCCESS');
  assert.equal(exactReuseDecision.gates.duplicate, false);
  assert.deepEqual(exactReuseDecision.trace.evidence.evidenceRefs, [probeEvidence]);
  const changedIntent = typedRequest(received, {methodRef, target: targets[0], typeFamily: 'NUMERIC', intentFeatures: CARDINALITY_INTENT});
  const changedIntentDecision = evaluateProgressiveDrilldownEligibility(received, changedIntent);
  assert.equal(changedIntentDecision.disposition, 'SUPPRESSED_DUPLICATE');
  assert.equal(changedIntentDecision.gates.duplicate, false);
  assert.equal(changedIntentDecision.trace.receipt, null);
  assert.deepEqual(changedIntentDecision.trace.evidence.evidenceRefs, []);
  const changedHypothesis = buildProgressiveTypedDrilldownRequest(received, {
    claimSha256: base.claimSha256, evidenceGapSha256: base.evidenceGapSha256,
    hypothesisId: secondHypothesis.hypothesisId, phase: received.controllerRun.phase, methodRef,
    target: targets[0], arguments: {maxSourceRows: 500, typeFamily: 'NUMERIC'}, intentFeatures: NUMERIC_INTENT,
    gainInputs: {...fixture.gainInputs.high, evidenceRefs: [identitySha256({fixture: 'claim-gain'})]},
  });
  const changedHypothesisDecision = evaluateProgressiveDrilldownEligibility(received, changedHypothesis);
  assert.equal(changedHypothesisDecision.disposition, 'SUPPRESSED_DUPLICATE');
  assert.equal(changedHypothesisDecision.gates.duplicate, false);
  assert.equal(changedHypothesisDecision.trace.receipt, null);
  assert.deepEqual(changedHypothesisDecision.trace.evidence.evidenceRefs, []);
});

test('typed drilldown suppresses a mismatched probe receipt without resuming or reusing evidence', async () => {
  const {analysis, registry, targets} = await safeAnalysis({runId: 'fixture-typed-drilldown-mismatched-receipt', phase: 'SAFE_AGGREGATES'});
  const methodRef = safeMethod(registry, 'COLUMN_SUMMARY');
  const original = typedRequest(analysis, {methodRef, target: targets[0], typeFamily: 'NUMERIC', intentFeatures: NUMERIC_INTENT});
  const reserved = reserveProgressiveProbeCandidate(analysis, original.candidate, {
    expectedStateSha256: analysis.stateSha256,
    claimSha256: original.claimSha256, evidenceGapSha256: original.evidenceGapSha256,
  });
  const evidence = identitySha256({fixture: 'mismatched-receipt-evidence'});
  const received = recordProgressiveProbeOutcome(reserved.state, {
    reservationSha256: reserved.authorization.reservationSha256, resultState: 'SUCCEEDED', evidenceRefs: [evidence],
    signal: 'COUNTERS', informationGainBps: 1700, confidenceBounds: {lowerBps: 500, upperBps: 3500}, reasonCode: 'TYPED_COUNTEREVIDENCE',
  });
  const receiptSha256 = received.controllerRun.receipts[0].receiptSha256;
  const mismatched = typedRequest(received, {
    methodRef, target: targets[0], typeFamily: 'NUMERIC', arguments: {maxSourceRows: 501, typeFamily: 'NUMERIC'},
    intentFeatures: NUMERIC_INTENT, resumeReceiptSha256: receiptSha256,
  });
  const decision = evaluateProgressiveDrilldownEligibility(received, mismatched);
  assert.equal(decision.disposition, 'SUPPRESSED_DUPLICATE');
  assert.equal(decision.gates.receiptResume, false);
  assert.equal(decision.trace.receipt, null);
  assert.deepEqual(decision.trace.evidence.evidenceRefs, []);
});

test('typed drilldown returns explicit denials for valid phase and allowlist mismatches', async () => {
  const {analysis, registry, targets} = await safeAnalysis({runId: 'fixture-typed-drilldown-denial-dispositions', phase: 'SAFE_AGGREGATES'});
  const validInput = {
    methodRef: safeMethod(registry, 'COLUMN_SUMMARY'), target: targets[0], typeFamily: 'NUMERIC', intentFeatures: NUMERIC_INTENT,
  };
  const phaseMismatch = typedRequest(analysis, {...validInput, phase: 'RELATIONSHIP_GRAPH'});
  assert.equal(evaluateProgressiveDrilldownEligibility(analysis, phaseMismatch).disposition, 'DENIED_PHASE');
  const allowlistMismatch = typedRequest(analysis, {...validInput, methodRef: 'mssql.safe.model-authored-sql@1.0.0'});
  assert.equal(evaluateProgressiveDrilldownEligibility(analysis, allowlistMismatch).disposition, 'DENIED_ALLOWLIST');
});
