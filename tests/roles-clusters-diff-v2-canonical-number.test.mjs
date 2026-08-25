import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {identitySha256} from '../services/bi-control/src/db-analyzer/core.mjs';
import {
  PROGRESSIVE_PHASES,
  advanceProgressivePhase,
  buildProgressiveMethodRegistry,
  createProgressiveCoverage,
  createProgressiveRun,
} from '../services/bi-control/src/db-analyzer/progressive-controller.mjs';
import {
  advanceProgressiveAnalysisPhase,
  buildProgressiveProbeCandidate,
  createProgressiveAnalysis,
  recordProgressiveProbeOutcome,
  registerProgressiveHypothesis,
  reserveProgressiveProbeCandidate,
} from '../services/bi-control/src/db-analyzer/progressive-analysis-v1.mjs';
import {buildSafeAnalysisEvidence} from '../services/bi-control/src/db-analyzer/safe-analysis-methods.mjs';
import {
  buildExtendedEvidenceDiffV2,
  buildRoleClusterSnapshotV2,
  resumeExtendedEvidenceDiffV2,
  resumeRoleClusterSnapshotV2,
} from '../services/bi-control/src/db-analyzer/roles-clusters-diff-v2.mjs';

const ROOT = 'services/bi-control';
const fixture = JSON.parse(await readFile(`${ROOT}/fixtures/roles-clusters-diff-v2.json`, 'utf8'));
const targetValues = Object.values(fixture.targets).filter(({kind}) => kind === 'COLUMN');
const DIFF_SURFACES = ['coverage', 'profiles', 'relationships', 'hypotheses', 'roles', 'clusters'];
const CLASSIFICATIONS = ['ADDED', 'REMOVED', 'CHANGED', 'DENIED', 'UNSUPPORTED', 'UNKNOWN'];
const canonicalZero = (value) => typeof value === 'number' && value === 0 && !Object.is(value, -0);

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function pack(engine) {
  const directory = `${ROOT}/query-packs/db-analyzer/v1/${engine}`;
  const [structureManifest, safeManifest] = await Promise.all([
    readJson(`${directory}/manifest.json`), readJson(`${directory}/safe-analysis-manifest.json`),
  ]);
  return {structureManifest, safeManifest};
}

function coverage(engine, {visible = targetValues, queryState = 'SUCCEEDED', reasonCode = null} = {}) {
  const sourceQueryId = `${engine}.structure.columns`;
  return createProgressiveCoverage({
    engine,
    structureSnapshotSha256: identitySha256({fixture: `${engine}-roles-structure`, visible, queryState}),
    structureCoverageLedgerSha256: identitySha256({fixture: `${engine}-roles-ledger`, visible, queryState}),
    entries: visible.map((target) => ({
      objectRef: {...target, objectName: null, sourceObjectSha256: identitySha256({engine, target})},
      state: 'COMPLETE', reasonCode: null, sourceQueryId,
      evidenceRefs: [identitySha256({fixture: `${engine}-${target.relationName}-${target.columnName}`})],
    })),
    queryCoverage: [
      {queryId: `${engine}.preflight.identity`, category: 'preflight', state: 'SUCCEEDED', reasonCode: null, visibility: 'VISIBLE_COMPLETE', absenceClaim: 'NOT_CLAIMED'},
      {
        queryId: sourceQueryId, category: 'columns', state: queryState, reasonCode,
        visibility: queryState === 'SUCCEEDED' ? 'VISIBLE_COMPLETE' : 'INVISIBLE_UNKNOWN', absenceClaim: 'NOT_CLAIMED',
      },
    ],
  });
}

function advanceControllerTo(run, phase) {
  let current = run;
  while (current.phase !== phase) {
    current = advanceProgressivePhase(current, PROGRESSIVE_PHASES[PROGRESSIVE_PHASES.indexOf(current.phase) + 1]);
  }
  return current;
}

function method(registry, semanticMethod) {
  const slug = semanticMethod.toLowerCase().replaceAll('_', '-');
  const found = registry.methods.find(({methodRef}) => methodRef.includes(`safe.${slug}@`));
  assert(found, semanticMethod);
  return found;
}

function table(target) {
  const value = target.kind === 'RELATIONSHIP' ? target.source : target;
  return {kind: 'TABLE', schemaName: value.schemaName, relationName: value.relationName};
}

function intent(semanticMethod) {
  if (semanticMethod === 'RELATIONSHIP_OVERLAP') {
    return {probeClass: 'RELATIONSHIP_CHECK', signalKind: 'RELATIONSHIP', comparisonKind: 'NONE', grain: 'TABLE'};
  }
  if (semanticMethod === 'TEMPORAL_COVERAGE') {
    return {probeClass: 'TEMPORAL_CHECK', signalKind: 'TEMPORAL', comparisonKind: 'BASELINE', grain: 'COLUMN'};
  }
  if (semanticMethod === 'QUALITY_INDICATORS') {
    return {probeClass: 'QUALITY_CHECK', signalKind: 'NULLABILITY', comparisonKind: 'BASELINE', grain: 'COLUMN'};
  }
  return {probeClass: 'SAFE_AGGREGATE', signalKind: 'CARDINALITY', comparisonKind: 'BASELINE', grain: 'COLUMN'};
}

async function analysisFixture(engine, {
  runId = `fixture-${engine}-roles-clusters`,
  visible = targetValues,
  queryState = 'SUCCEEDED',
  reasonCode = null,
  includeEvidence = true,
  relationshipResult = fixture.results.relationship,
} = {}) {
  const packed = await pack(engine);
  const registry = buildProgressiveMethodRegistry({
    structureManifest: packed.structureManifest, safeAnalysisManifest: packed.safeManifest,
  });
  let analysis = createProgressiveAnalysis({
    controllerRun: advanceControllerTo(createProgressiveRun({
      runId, engine, scope: fixture.scope, methodRegistry: registry,
      coverage: coverage(engine, {visible, queryState, reasonCode}),
      budgets: {maxRunProbes: fixture.budgets.maxRunProbes, maxObjectProbes: fixture.budgets.maxObjectProbes},
    }), 'SAFE_AGGREGATES'),
    budgets: {maxTableProbes: fixture.budgets.maxTableProbes, maxHypothesisProbes: fixture.budgets.maxHypothesisProbes},
    policy: fixture.policy,
  });
  const tableTargets = [...new Map(visible.map((target) => [target.relationName, table(target)])).values()];
  for (const target of tableTargets) {
    analysis = registerProgressiveHypothesis(analysis, {
      hypothesisId: `${target.relationName.toLowerCase()}-structural-role`,
      hypothesisKind: target.relationName === 'ORDERS' ? 'RELATIONSHIP_CANDIDATE' : 'DATA_QUALITY',
      target, confidenceBounds: {lowerBps: 1000, upperBps: 8000},
      sourceEvidenceRefs: [identitySha256({fixture: `${engine}-${target.relationName}-hypothesis`})],
    });
  }
  const safeEvidence = [];

  function record(semanticMethod, target, typeFamily, row, hypothesisId) {
    const descriptor = method(registry, semanticMethod);
    const args = {maxSourceRows: 500, typeFamily};
    const candidate = buildProgressiveProbeCandidate(analysis, {
      hypothesisId, phase: analysis.controllerRun.phase, methodRef: descriptor.methodRef,
      target, arguments: args, intentFeatures: intent(semanticMethod),
      gainInputs: {
        uncertaintyBps: 6000, outcomeProbabilityBps: 7000, relevanceBps: 8000,
        rationaleCode: 'BOUNDED_ROLE_CLUSTER_EVIDENCE',
        evidenceRefs: [identitySha256({fixture: `${engine}-${semanticMethod}-${hypothesisId}`})],
      },
    });
    const reserved = reserveProgressiveProbeCandidate(analysis, candidate, {expectedStateSha256: analysis.stateSha256});
    const evidence = buildSafeAnalysisEvidence({
      controllerState: reserved.state, manifest: packed.safeManifest,
      methodId: descriptor.methodRef.split('@')[0], target, arguments: args,
      result: {state: 'SUCCEEDED', reasonCode: null, rows: [row]}, authorization: reserved.authorization,
    });
    analysis = recordProgressiveProbeOutcome(reserved.state, {
      reservationSha256: reserved.authorization.reservationSha256,
      resultState: 'SUCCEEDED', evidenceRefs: [evidence.evidenceSha256],
      signal: evidence.counterevidence.length > 0 ? 'COUNTERS' : 'SUPPORTS', informationGainBps: 2500,
      confidenceBounds: evidence.counterevidence.length > 0
        ? {lowerBps: 500, upperBps: 4500} : {lowerBps: 5000, upperBps: 9000},
      reasonCode: evidence.counterevidence.length > 0 ? 'SAFE_AGGREGATE_COUNTEREVIDENCE' : 'SAFE_AGGREGATE_SUPPORT',
    });
    safeEvidence.push(evidence);
  }

  if (includeEvidence) {
    record('COLUMN_SUMMARY', fixture.targets.orderId, 'NUMERIC', fixture.results.orderKey, 'orders-structural-role');
    record('COLUMN_SUMMARY', fixture.targets.customerKey, 'NUMERIC', fixture.results.customerKey, 'customers-structural-role');
    record('TEMPORAL_COVERAGE', fixture.targets.orderDate, 'TEMPORAL', fixture.results.temporal, 'orders-structural-role');
    analysis = advanceProgressiveAnalysisPhase(analysis, 'RELATIONSHIP_GRAPH');
    record('RELATIONSHIP_OVERLAP', fixture.targets.relationship, 'PAIR', relationshipResult, 'orders-structural-role');
    analysis = advanceProgressiveAnalysisPhase(analysis, 'HYPOTHESIS_VALIDATION');
    record('QUALITY_INDICATORS', fixture.targets.customerId, 'NUMERIC', fixture.results.quality, 'orders-structural-role');
  }
  while (analysis.controllerRun.phase !== 'REPORT') {
    analysis = advanceProgressiveAnalysisPhase(
      analysis,
      PROGRESSIVE_PHASES[PROGRESSIVE_PHASES.indexOf(analysis.controllerRun.phase) + 1],
    );
  }
  return {analysis, safeEvidence};
}

function redigest(body, hashKey) {
  const {[hashKey]: _sealed, ...rest} = body;
  body[hashKey] = identitySha256(rest);
  return body;
}

function resealedDiff(diff) {
  for (const surface of DIFF_SURFACES) redigest(diff[surface], 'surfaceDiffSha256');
  return redigest(diff, 'diffSha256');
}

async function identicalDiff() {
  const source = await analysisFixture('mssql');
  const baseline = buildRoleClusterSnapshotV2({
    analysisState: source.analysis, safeEvidence: source.safeEvidence, snapshotOrdinal: 1, previousSnapshotSha256: null,
  });
  const current = buildRoleClusterSnapshotV2({
    analysisState: source.analysis, safeEvidence: source.safeEvidence, snapshotOrdinal: 2,
    previousSnapshotSha256: baseline.snapshotSha256,
  });
  const diff = buildExtendedEvidenceDiffV2({baseline, current});
  return {source, baseline, current, diff};
}

test('fully re-digested empty extended-diff surfaces with negative-zero counts fail closed before normalization', async () => {
  const {diff} = await identicalDiff();
  for (const surface of DIFF_SURFACES) {
    assert.equal(diff[surface].changes.length, 0);
    for (const classification of CLASSIFICATIONS) assert(canonicalZero(diff[surface].counts[classification]));
  }
  const forged = structuredClone(diff);
  for (const surface of DIFF_SURFACES) {
    for (const classification of CLASSIFICATIONS) forged[surface].counts[classification] = -0;
  }
  resealedDiff(forged);
  for (const surface of DIFF_SURFACES) {
    for (const classification of CLASSIFICATIONS) assert(Object.is(forged[surface].counts[classification], -0));
  }
  assert.throws(() => resumeExtendedEvidenceDiffV2(forged), /DB_EVIDENCE_DIFF_SURFACE_INVALID/);
});

test('canonical zero ordinal and safe derived confidence bounds retain deterministic MSSQL/Oracle snapshot behavior', async () => {
  const snapshots = [];
  for (const engine of ['mssql', 'oracle']) {
    const source = await analysisFixture(engine);
    snapshots.push(buildRoleClusterSnapshotV2({
      analysisState: source.analysis, safeEvidence: source.safeEvidence, snapshotOrdinal: 1, previousSnapshotSha256: null,
    }));
  }
  const [mssql, oracle] = snapshots;
  assert.equal(mssql.semanticProjectionSha256, oracle.semanticProjectionSha256);
  assert.equal(mssql.semanticProjectionSha256, fixture.expected.semanticProjectionSha256);
  assert.equal(mssql.snapshotSha256, fixture.expected.mssqlSnapshotSha256);
  assert.equal(oracle.snapshotSha256, fixture.expected.oracleSnapshotSha256);
  assert.notEqual(mssql.snapshotSha256, oracle.snapshotSha256);
  for (const snapshot of snapshots) {
    const readback = resumeRoleClusterSnapshotV2(JSON.parse(JSON.stringify(snapshot)));
    assert.deepEqual(readback, snapshot);
    assert.equal(readback.snapshotSha256, snapshot.snapshotSha256);
    assert(Number.isSafeInteger(snapshot.snapshotOrdinal) && snapshot.snapshotOrdinal === 1 && !Object.is(snapshot.snapshotOrdinal, -0));
    for (const key of ['relationships', 'hypotheses', 'roles', 'clusters']) {
      assert(snapshot[key].length > 0);
      for (const item of snapshot[key]) {
        const {lowerBps, upperBps} = item.confidenceBounds;
        assert(Number.isSafeInteger(lowerBps) && !Object.is(lowerBps, -0));
        assert(Number.isSafeInteger(upperBps) && !Object.is(upperBps, -0));
        assert(lowerBps >= 0 && upperBps <= 10000 && lowerBps <= upperBps);
      }
    }
  }
});

test('canonical zero and exact per-classification diff counts retain deterministic extended-diff hashes and readback', async () => {
  const {baseline, diff} = await identicalDiff();
  assert.equal(diff.baselineOrdinal, 1);
  assert.equal(diff.currentOrdinal, 2);
  for (const ordinal of [diff.baselineOrdinal, diff.currentOrdinal]) {
    assert(Number.isSafeInteger(ordinal) && ordinal > 0 && !Object.is(ordinal, -0));
  }
  const readback = resumeExtendedEvidenceDiffV2(JSON.parse(JSON.stringify(diff)));
  assert.deepEqual(readback, diff);
  assert.equal(readback.diffSha256, diff.diffSha256);
  for (const surface of DIFF_SURFACES) {
    for (const classification of CLASSIFICATIONS) {
      const count = diff[surface].counts[classification];
      const expected = diff[surface].changes
        .filter(({classification: itemClassification}) => itemClassification === classification).length;
      assert.equal(count, expected);
      assert(canonicalZero(count) === (expected === 0));
      assert(Number.isSafeInteger(count) && count >= 0);
    }
  }

  const visibleOrders = targetValues.filter(({relationName}) => relationName === 'ORDERS');
  const observedSource = await analysisFixture('mssql', {
    runId: 'fixture-mssql-observed-removal', visible: visibleOrders, includeEvidence: false,
  });
  const observed = buildRoleClusterSnapshotV2({
    analysisState: observedSource.analysis, safeEvidence: [], snapshotOrdinal: 2,
    previousSnapshotSha256: baseline.snapshotSha256,
  });
  const observedDiff = buildExtendedEvidenceDiffV2({baseline, current: observed});
  assert.deepEqual(resumeExtendedEvidenceDiffV2(JSON.parse(JSON.stringify(observedDiff))), observedDiff);
  assert(observedDiff.coverage.changes.some(({classification, semantics}) => classification === 'REMOVED' && semantics === 'OBSERVED_REMOVAL'));
  for (const surface of DIFF_SURFACES) {
    for (const classification of CLASSIFICATIONS) {
      const count = observedDiff[surface].counts[classification];
      assert.equal(count, observedDiff[surface].changes
        .filter(({classification: itemClassification}) => itemClassification === classification).length);
      assert(Number.isSafeInteger(count) && !Object.is(count, -0));
    }
  }
  assert.equal(observedDiff.diffSha256, fixture.expected.observedRemovalDiffSha256);

  const deniedSource = await analysisFixture('mssql', {
    runId: 'fixture-mssql-visibility-loss', visible: visibleOrders, queryState: 'DENIED',
    reasonCode: 'SELECT_PRIVILEGE_DENIED', includeEvidence: false,
  });
  const denied = buildRoleClusterSnapshotV2({
    analysisState: deniedSource.analysis, safeEvidence: [], snapshotOrdinal: 2,
    previousSnapshotSha256: baseline.snapshotSha256,
  });
  const deniedDiff = buildExtendedEvidenceDiffV2({baseline, current: denied});
  assert(deniedDiff.coverage.changes.some(({classification, semantics}) => classification === 'DENIED' && semantics === 'VISIBILITY_LOSS'));
  assert(!deniedDiff.coverage.changes.some(({classification}) => classification === 'REMOVED'));
  assert.equal(deniedDiff.diffSha256, fixture.expected.visibilityLossDiffSha256);
});

test('negative zero in supplied confidence bounds fails closed at each sealed snapshot surface', async () => {
  const {baseline} = await identicalDiff();
  const surfaces = [
    ['relationships', 'DB_ROLE_CLUSTER_RELATIONSHIP_INVALID', 'relationshipSha256'],
    ['hypotheses', 'DB_ROLE_CLUSTER_HYPOTHESIS_INVALID', 'hypothesisProjectionSha256'],
    ['roles', 'DB_ROLE_CLUSTER_ROLE_INVALID', 'roleSha256'],
    ['clusters', 'DB_ROLE_CLUSTER_CLUSTER_INVALID', 'clusterSha256'],
  ];
  for (const [key, code, hashKey] of surfaces) {
    for (const bound of ['lowerBps', 'upperBps']) {
      const forged = structuredClone(baseline);
      forged[key][0].confidenceBounds[bound] = -0;
      redigest(forged[key][0], hashKey);
      redigest(forged, 'snapshotSha256');
      assert(Object.is(forged[key][0].confidenceBounds[bound], -0));
      assert.throws(() => resumeRoleClusterSnapshotV2(forged), new RegExp(code));
    }
  }
});

test('negative zero snapshot and diff ordinals fail closed at the canonical-number boundary', async () => {
  const {source, baseline, diff} = await identicalDiff();

  assert.throws(() => buildRoleClusterSnapshotV2({
    analysisState: source.analysis, safeEvidence: source.safeEvidence, snapshotOrdinal: -0, previousSnapshotSha256: null,
  }), /DB_ROLE_CLUSTER_SNAPSHOT_INPUT_INVALID/);

  const forgedSnapshot = structuredClone(baseline);
  forgedSnapshot.snapshotOrdinal = -0;
  redigest(forgedSnapshot, 'snapshotSha256');
  assert.throws(() => resumeRoleClusterSnapshotV2(forgedSnapshot), /DB_ROLE_CLUSTER_SNAPSHOT_INVALID/);

  for (const key of ['baselineOrdinal', 'currentOrdinal']) {
    const forgedDiff = structuredClone(diff);
    forgedDiff[key] = -0;
    resealedDiff(forgedDiff);
    assert.throws(() => resumeExtendedEvidenceDiffV2(forgedDiff), /DB_EVIDENCE_DIFF_INVALID/);
  }
});

test('negative zero in every per-surface classification count fails closed whether re-digested or unchanged-digest', async () => {
  const {diff} = await identicalDiff();
  for (const surface of DIFF_SURFACES) {
    for (const redigested of [true, false]) {
      const forged = structuredClone(diff);
      forged[surface].counts.UNKNOWN = -0;
      if (redigested) resealedDiff(forged);
      assert(Object.is(forged[surface].counts.UNKNOWN, -0));
      assert.throws(() => resumeExtendedEvidenceDiffV2(forged), /DB_EVIDENCE_DIFF_SURFACE_INVALID/);
    }
  }
});

test('non-finite, inconsistent, unsafe, authority, stale, drift and tamper denials are retained beside the negative-zero boundary', async () => {
  const {source, baseline, current, diff} = await identicalDiff();

  for (const value of [NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const invalid = structuredClone(diff);
    invalid.coverage.counts.ADDED = value;
    assert.throws(() => resumeExtendedEvidenceDiffV2(invalid), /DB_CANONICAL_NUMBER_INVALID/);
  }

  const inconsistent = structuredClone(diff);
  inconsistent.coverage.counts.ADDED = 3;
  resealedDiff(inconsistent);
  assert.throws(() => resumeExtendedEvidenceDiffV2(inconsistent), /DB_EVIDENCE_DIFF_SURFACE_INVALID/);

  const unchangedDigest = structuredClone(diff);
  unchangedDigest.coverage.counts.ADDED = 3;
  assert.throws(() => resumeExtendedEvidenceDiffV2(unchangedDigest), /DB_EVIDENCE_DIFF_TAMPERED/);

  const unsafe = structuredClone(source.safeEvidence);
  unsafe[0].password = 'private-fixture-value';
  redigest(unsafe[0], 'evidenceSha256');
  assert.throws(() => buildRoleClusterSnapshotV2({
    analysisState: source.analysis, safeEvidence: unsafe, snapshotOrdinal: 1, previousSnapshotSha256: null,
  }), /DB_ROLE_CLUSTER_UNSAFE_EVIDENCE_DENIED/);

  const safety = structuredClone(diff);
  safety.safety.visibilityLossConvertedToRemoval = true;
  redigest(safety, 'diffSha256');
  assert.throws(() => resumeExtendedEvidenceDiffV2(safety), /DB_EVIDENCE_DIFF_SAFETY_INVALID/);

  const claim = structuredClone(baseline);
  claim.roles[0].roleKind = 'AUTHORITATIVE_BUSINESS_ROLE';
  assert.throws(() => resumeRoleClusterSnapshotV2(claim), /DB_ROLE_CLUSTER_SNAPSHOT_TAMPERED/);

  const stale = structuredClone(current);
  stale.previousSnapshotSha256 = identitySha256({fixture: 'stale'});
  redigest(stale, 'snapshotSha256');
  assert.throws(() => buildExtendedEvidenceDiffV2({baseline, current: stale}), /DB_EVIDENCE_DIFF_STALE_BASELINE/);

  const drift = structuredClone(current);
  drift.scope = {...drift.scope, database: 'OTHER_FIXTURE'};
  drift.scopeSha256 = identitySha256(drift.scope);
  redigest(drift, 'snapshotSha256');
  assert.throws(() => buildExtendedEvidenceDiffV2({baseline, current: drift}), /DB_EVIDENCE_DIFF_SCOPE_DRIFT/);

  const engineSource = await analysisFixture('oracle');
  const engineDrift = buildRoleClusterSnapshotV2({
    analysisState: engineSource.analysis, safeEvidence: engineSource.safeEvidence, snapshotOrdinal: 2,
    previousSnapshotSha256: baseline.snapshotSha256,
  });
  assert.throws(() => buildExtendedEvidenceDiffV2({baseline, current: engineDrift}), /DB_EVIDENCE_DIFF_ENGINE_DRIFT/);
});