import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {
  PERFORMANCE_EVIDENCE_SCHEMA_V1,
  PERFORMANCE_RECOMMENDATION_SCHEMA_V1,
  buildPerformanceRecommendationsV1,
  performanceEvidenceDigestV1,
  performanceSourceEvidenceDigestV1,
  verifyPerformanceRecommendationV1,
} from '../services/bi-control/src/db-analyzer/performance-intelligence-v1.mjs';

const scopeSha256 = 'a'.repeat(64);

function sourceResolver(source) {
  return new Map(['receipt:oracle-statistics', 'receipt:index-usage'].map((evidenceRef) => {
    const body = {
      schemaVersion: 'kaleidosphere/performance-source-evidence/v1', evidenceRef,
      engine: source.engine, engineVersion: source.engineVersion, scopeSha256: source.scopeSha256,
      collectedAtMs: source.collectedAtMs, expiresAtMs: source.expiresAtMs,
      state: 'VERIFIED', authority: 'READ_ONLY_EVIDENCE',
    };
    return [evidenceRef, {...body, evidenceSha256: performanceSourceEvidenceDigestV1(body)}];
  }));
}

function evidence(overrides = {}) {
  const body = {
    schemaVersion: PERFORMANCE_EVIDENCE_SCHEMA_V1,
    evidenceId: 'performance-evidence-fixture',
    engine: 'mssql',
    engineVersion: '2022',
    scopeSha256,
    collectedAtMs: 1_000,
    expiresAtMs: 2_000,
    state: 'COMPLETE',
    observations: [
      {observationId: 'stale-orders-stats', kind: 'STALE_STATISTICS', objectRef: {schemaName: 'APP', relationName: 'ORDERS', indexName: null, procedureName: null}, metrics: {ageMs: 900, estimatedRows: 1_000, scanCount: 4}, evidenceRefs: ['receipt:oracle-statistics']},
      {observationId: 'unused-orders-index', kind: 'UNUSED_INDEX', objectRef: {schemaName: 'APP', relationName: 'ORDERS', indexName: 'IX_ORDERS_ARCHIVE', procedureName: null}, metrics: {ageMs: 300, estimatedRows: 1_000, scanCount: 0}, evidenceRefs: ['receipt:index-usage']},
    ],
    authority: 'READ_ONLY_EVIDENCE',
    rawRowsPersisted: false,
    queryTextPersisted: false,
    ...overrides,
  };
  return {...body, evidenceSha256: performanceEvidenceDigestV1(body)};
}

test('proposal-only performance recommendations are deterministic, ranked and evidence-bound', () => {
  const source = evidence();
  const resolver = sourceResolver(source);
  const first = buildPerformanceRecommendationsV1({
    evidence: source, sourceEvidenceResolver: resolver, expectedScopeSha256: scopeSha256, evaluatedAtMs: 1_500,
  });
  const second = buildPerformanceRecommendationsV1({
    evidence: structuredClone(source), sourceEvidenceResolver: resolver, expectedScopeSha256: scopeSha256, evaluatedAtMs: 1_500,
  });
  assert.deepEqual(first, second);
  assert.equal(first.schemaVersion, PERFORMANCE_RECOMMENDATION_SCHEMA_V1);
  assert.equal(first.engine, 'mssql');
  assert.equal(first.engineVersion, '2022');
  assert.equal(first.evidenceSha256, source.evidenceSha256);
  assert.equal(first.authority, 'PROPOSAL_ONLY');
  assert.equal(first.mutationAuthority, 'NONE');
  assert.equal(first.executionRoute, null);
  assert.deepEqual(first.proposals.map(({kind}) => kind), ['REVIEW_STALE_STATISTICS', 'REVIEW_UNUSED_INDEX']);
  assert.ok(first.proposals.every((proposal) => proposal.evidenceRefs.length > 0 && proposal.confidenceBps > 0));
  assert.equal(verifyPerformanceRecommendationV1(first, source, resolver, scopeSha256, 1_500), true);
  const serialized = JSON.stringify(first);
  assert.doesNotMatch(serialized, /\b(?:CREATE|ALTER|DROP|REBUILD|UPDATE|INSERT|DELETE|MERGE|EXEC(?:UTE)?)\b/i);
  assert.doesNotMatch(serialized, /\bsql\b|queryText|statement|dispatch|apply/i);
});

test('Oracle supported evidence retains explicit engine/version and no universal-support claim', () => {
  const source = evidence({engine: 'oracle', engineVersion: '19c'});
  source.evidenceSha256 = performanceEvidenceDigestV1(source);
  const result = buildPerformanceRecommendationsV1({evidence: source, sourceEvidenceResolver: sourceResolver(source), expectedScopeSha256: scopeSha256, evaluatedAtMs: 1_500});
  assert.equal(result.engine, 'oracle');
  assert.equal(result.engineVersion, '19c');
  assert.deepEqual(result.nonClaims, [
    'NO_PERFORMANCE_IMPROVEMENT_GUARANTEE',
    'NO_AUTOMATIC_OPTIMIZATION',
    'NO_PRODUCTION_BENCHMARK',
    'NO_MUTATION_AUTHORITY',
    'NO_UNIVERSAL_ENGINE_SUPPORT',
  ]);
});

test('stale, tampered, unsupported, partial, cancelled, cross-scope and unsafe evidence fail closed', () => {
  const build = (source, options = {}) => buildPerformanceRecommendationsV1({evidence: source, sourceEvidenceResolver: sourceResolver(source), expectedScopeSha256: scopeSha256, evaluatedAtMs: 1_500, ...options});
  const probes = [
    () => build(evidence(), {evaluatedAtMs: 2_001}),
    () => { const value = evidence(); value.observations[0].metrics.scanCount = 99; return build(value); },
    () => build(evidence({engine: 'mysql', engineVersion: '8'})),
    () => build(evidence({state: 'PARTIAL'})),
    () => build(evidence({state: 'CANCELLED'})),
    () => build(evidence(), {expectedScopeSha256: 'b'.repeat(64)}),
    () => build(evidence({rawRowsPersisted: true})),
    () => build(evidence({queryTextPersisted: true})),
  ];
  for (const probe of probes) assert.throws(probe, /PERFORMANCE_EVIDENCE_DENIED/);
});

test('unknown fields, mutation-shaped observation text and missing evidence refs deny', () => {
  const unknown = evidence(); unknown.extra = true;
  const mutation = evidence(); mutation.observations[0].observationId = 'DROP-index-now'; mutation.evidenceSha256 = performanceEvidenceDigestV1(mutation);
  const missing = evidence(); missing.observations[0].evidenceRefs = []; missing.evidenceSha256 = performanceEvidenceDigestV1(missing);
  for (const value of [unknown, mutation, missing]) {
    assert.throws(() => buildPerformanceRecommendationsV1({evidence: value, sourceEvidenceResolver: sourceResolver(value), expectedScopeSha256: scopeSha256, evaluatedAtMs: 1_500}), /PERFORMANCE_EVIDENCE_DENIED/);
  }
});

test('missing, unresolved or re-digested forged source receipts deny before recommendation', () => {
  const source = evidence();
  assert.throws(() => buildPerformanceRecommendationsV1({evidence: source, expectedScopeSha256: scopeSha256, evaluatedAtMs: 1_500}), /PERFORMANCE_EVIDENCE_DENIED/);
  const incomplete = sourceResolver(source); incomplete.delete('receipt:index-usage');
  assert.throws(() => buildPerformanceRecommendationsV1({evidence: source, sourceEvidenceResolver: incomplete, expectedScopeSha256: scopeSha256, evaluatedAtMs: 1_500}), /PERFORMANCE_EVIDENCE_DENIED/);
  const forged = sourceResolver(source); const record = structuredClone(forged.get('receipt:index-usage'));
  record.engineVersion = '2019'; record.evidenceSha256 = performanceSourceEvidenceDigestV1(record); forged.set(record.evidenceRef, record);
  assert.throws(() => buildPerformanceRecommendationsV1({evidence: source, sourceEvidenceResolver: forged, expectedScopeSha256: scopeSha256, evaluatedAtMs: 1_500}), /PERFORMANCE_EVIDENCE_DENIED/);
});

test('performance intelligence source contains no I/O, SQL, dispatch or mutation route', async () => {
  const source = await readFile('services/bi-control/src/db-analyzer/performance-intelligence-v1.mjs', 'utf8');
  for (const token of ['node:fs', 'node:http', 'node:https', 'node:net', 'node:dns', 'node:child_process', 'fetch(', '.execute(', 'dispatch(', 'apply(']) {
    assert.equal(source.includes(token), false, token);
  }
});
