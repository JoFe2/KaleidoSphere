import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {identitySha256, sha256} from '../services/bi-control/src/db-analyzer/core.mjs';
import {
  compilePostgresqlWave2ProfileDispatches,
  runPostgresqlWave2Profiles,
} from '../services/bi-control/src/db-analyzer/postgresql-wave2.mjs';

const profile = (overrides = {}) => ({
  schemaVersion: 'chimpmaera.db/analyze-profile/v1',
  profileId: 'ks23-postgres-e2e-v1',
  engine: 'postgresql',
  mode: 'RUNTIME',
  queryPack: {version: 'v1'},
  scope: {database: 'ks23_e2e', container: null, schemas: ['ks23_app']},
  policy: {
    access: 'READ_ONLY',
    allowRowSamples: false,
    maxQueryTimeoutMs: 5000,
    postgresqlAnalysis: {
      schemaVersion: 'kaleidosphere.analysis/postgresql-wave2-policy/v1',
      enabled: true,
      profileTargets: [
        {schemaName: 'ks23_app', relationName: 'accounts', columnName: 'account_id'},
        {schemaName: 'ks23_app', relationName: 'staging_events', columnName: 'account_id'},
      ],
      sensitiveTargets: [],
      relationshipCandidates: {enabled: true, nameMatch: 'EXACT_COLUMN_NAME', minimumConfidenceBasisPoints: 7500},
      budgets: {maxProfileTargets: 4, maxRelationshipCandidates: 4, maxQueries: 8, maxQueryTimeoutMs: 5000},
      disclosure: {allowRawValues: false, allowExampleValues: false, allowDistributions: false},
      ...overrides,
    },
  },
  adapter: {
    kind: 'postgresql', host: '127.0.0.1', port: 5432, user: 'ks23_scan',
    passwordEnv: 'KS_WAVE2_TEST_PASSWORD', ssl: false, connectTimeoutMs: 5000,
  },
});

async function fixture() {
  const directory = 'services/bi-control/query-packs/db-analyzer/v1/postgresql';
  const [structureEvidence, manifest] = await Promise.all([
    readFile('docs/evidence/postgresql-e2e/run-1/evidence.canonical.json', 'utf8').then(JSON.parse),
    readFile(`${directory}/analysis-wave2-manifest.json`, 'utf8').then(JSON.parse),
  ]);
  const sqlByMethodId = Object.fromEntries(await Promise.all(manifest.methods.map(async (method) => [
    method.id, await readFile(`${directory}/${method.file}`, 'utf8'),
  ])));
  return {structureEvidence, manifest, sqlByMethodId};
}

const fakeDriver = (row, events) => {
  class FakeClient {
    async query(input) {
      const text = typeof input === 'string' ? input : input.text;
      events.push(text);
      if (text.includes("current_setting('transaction_read_only')")) {
        return {rows: [{transaction_read_only: 'on', default_transaction_read_only: 'on'}]};
      }
      if (typeof input === 'object') return {rows: [row]};
      return {rows: []};
    }
    release(destroy) { events.push(`release:${destroy}`); }
  }
  class FakePool {
    async connect() { events.push('connect'); return new FakeClient(); }
    async end() { events.push('end'); }
  }
  return {Pool: FakePool};
};

const assertSealedEvidence = (evidence, {structureEvidence, dispatches, expectedMetrics}) => {
  assert.equal(evidence.runtimeValidation, 'RUNTIME_VALIDATED');
  assert.equal(evidence.factCount, 2);
  assert.equal(evidence.facts.length, 2);
  evidence.facts.forEach((fact, index) => {
    const dispatch = dispatches[index];
    assert.equal(fact.factKind, 'COLUMN_PROFILE');
    assert.equal(fact.observationKind, 'OBSERVED');
    assert.equal(fact.claimStatus, 'MEASURED_AGGREGATE');
    assert.deepEqual(fact.target, dispatch.target);
    assert.deepEqual(fact.metrics, expectedMetrics);
    assert.equal(fact.evidenceRefs.structureSnapshotSha256, structureEvidence.snapshotSha256);
    assert.equal(fact.evidenceRefs.structureObjectSha256, dispatch.structureObjectSha256);
    assert.equal(fact.evidenceRefs.templateSha256, dispatch.templateSha256);
    assert.equal(fact.evidenceRefs.statementSha256, sha256(dispatch.statement));
    assert.equal(fact.evidenceRefs.planSha256, dispatch.planSha256);
    assert.equal(fact.plan.planSha256, dispatch.planSha256);
    assert.equal(fact.plan.templateSha256, dispatch.templateSha256);
    assert.equal(fact.plan.statementSha256, sha256(dispatch.statement));
    assert.deepEqual(fact.plan.target, dispatch.target);
    assert.equal(fact.plan.readOnly, true);
    assert.equal(fact.plan.aggregateOnly, true);
    const {factSha256, plan, ...factBody} = fact;
    assert.equal(factSha256, identitySha256(factBody));
    assert.deepEqual(fact.disclosure, {aggregateCountsOnly: true, rowMaterialPersisted: false, distributionsPersisted: false});
  });
  assert.deepEqual(evidence.disclosure, {
    aggregateCountsOnly: true, distributionsPersisted: false, labelsPersisted: false, rowMaterialPersisted: false,
  });
  assert.doesNotMatch(JSON.stringify(evidence), /sampleValue|exampleValue|rawValue/i);
};

test('Wave 2 profile counts fail closed on raw numeric negative zero before conversion', async () => {
  const {structureEvidence, manifest, sqlByMethodId} = await fixture();
  const events = [];
  process.env.KS_WAVE2_TEST_PASSWORD = 'fixture-only-password';
  await assert.rejects(runPostgresqlWave2Profiles({
    profile: profile(), structureEvidence, manifest, sqlByMethodId,
    driver: fakeDriver({row_count: -0, null_count: -0, distinct_count: -0}, events),
  }), /DB_WAVE2_PROFILE_RESULT_INVALID/);
  delete process.env.KS_WAVE2_TEST_PASSWORD;
  assert.equal(events.at(-1), 'end');
});

test('Wave 2 profile counts reject negative zero independently per aggregate field', async () => {
  const {structureEvidence, manifest, sqlByMethodId} = await fixture();
  for (const field of ['row_count', 'null_count', 'distinct_count']) {
    const row = {row_count: '0', null_count: '0', distinct_count: '0'};
    row[field] = -0;
    const events = [];
    process.env.KS_WAVE2_TEST_PASSWORD = 'fixture-only-password';
    await assert.rejects(runPostgresqlWave2Profiles({
      profile: profile(), structureEvidence, manifest, sqlByMethodId, driver: fakeDriver(row, events),
    }), /DB_WAVE2_PROFILE_RESULT_INVALID/);
    delete process.env.KS_WAVE2_TEST_PASSWORD;
    assert.equal(events.at(-1), 'end');
  }
});

test('Wave 2 canonical zero counts as string, number and bigint retain deterministic sealed evidence', async () => {
  const {structureEvidence, manifest, sqlByMethodId} = await fixture();
  const dispatches = compilePostgresqlWave2ProfileDispatches({profile: profile(), structureEvidence, manifest, sqlByMethodId});
  const events = [];
  process.env.KS_WAVE2_TEST_PASSWORD = 'fixture-only-password';
  const evidence = await runPostgresqlWave2Profiles({
    profile: profile(), structureEvidence, manifest, sqlByMethodId,
    driver: fakeDriver({row_count: '0', null_count: 0, distinct_count: 0n}, events),
  });
  delete process.env.KS_WAVE2_TEST_PASSWORD;
  const secondEvents = [];
  process.env.KS_WAVE2_TEST_PASSWORD = 'fixture-only-password';
  const second = await runPostgresqlWave2Profiles({
    profile: profile(), structureEvidence, manifest, sqlByMethodId,
    driver: fakeDriver({row_count: '0', null_count: 0, distinct_count: 0n}, secondEvents),
  });
  delete process.env.KS_WAVE2_TEST_PASSWORD;
  assert.deepEqual(second, evidence);
  assertSealedEvidence(evidence, {structureEvidence, dispatches, expectedMetrics: {rowCount: 0, nullCount: 0, distinctCount: 0}});
  assert.ok(events.includes('BEGIN READ ONLY'));
  assert.ok(events.some((entry) => entry.includes("current_setting('transaction_read_only')")));
  assert.ok(events.includes('COMMIT'));
  assert.ok(events.includes('release:true'));
  assert.equal(events.at(-1), 'end');
});

test('Wave 2 ordinary safe positive aggregate counts retain deterministic sealed evidence and pool cleanup', async () => {
  const {structureEvidence, manifest, sqlByMethodId} = await fixture();
  const dispatches = compilePostgresqlWave2ProfileDispatches({profile: profile(), structureEvidence, manifest, sqlByMethodId});
  const events = [];
  process.env.KS_WAVE2_TEST_PASSWORD = 'fixture-only-password';
  const evidence = await runPostgresqlWave2Profiles({
    profile: profile(), structureEvidence, manifest, sqlByMethodId,
    driver: fakeDriver({row_count: '7', null_count: 2, distinct_count: 2n}, events),
  });
  delete process.env.KS_WAVE2_TEST_PASSWORD;
  const secondEvents = [];
  process.env.KS_WAVE2_TEST_PASSWORD = 'fixture-only-password';
  const second = await runPostgresqlWave2Profiles({
    profile: profile(), structureEvidence, manifest, sqlByMethodId,
    driver: fakeDriver({row_count: '7', null_count: 2, distinct_count: 2n}, secondEvents),
  });
  delete process.env.KS_WAVE2_TEST_PASSWORD;
  assert.deepEqual(second, evidence);
  assertSealedEvidence(evidence, {structureEvidence, dispatches, expectedMetrics: {rowCount: 7, nullCount: 2, distinctCount: 2}});
  assert.ok(events.includes('BEGIN READ ONLY'));
  assert.ok(events.some((entry) => entry.includes("current_setting('transaction_read_only')")));
  assert.ok(events.includes('COMMIT'));
  assert.ok(events.includes('release:true'));
  assert.equal(events.at(-1), 'end');
});