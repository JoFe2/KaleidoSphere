import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { buildLiveProfile } from '../services/bi-control/src/runtime-config.mjs';
import { validateAnalyzeProfile } from '../services/bi-control/src/db-analyzer/core.mjs';

const postgresqlEnv = {
  BI_ENGINE: 'postgresql', POSTGRESQL_HOST: 'postgres-test', POSTGRESQL_PORT: '5432',
  POSTGRESQL_DATABASE: 'kaleidosphere', POSTGRESQL_USER: 'bi_analyze',
  POSTGRESQL_SCHEMAS: 'public,reporting', POSTGRESQL_SSL: 'true',
  POSTGRESQL_CONNECT_TIMEOUT_MS: '9000', POSTGRESQL_QUERY_TIMEOUT_MS: '7000',
};

const mssqlEnv = {
  BI_ENGINE: 'mssql', MSSQL_HOST: 'mssql-test', MSSQL_PORT: '1433',
  MSSQL_DATABASE: 'Kaleidosphere', MSSQL_USER: 'bi_analyze', MSSQL_SCHEMAS: 'dbo',
};

const oracleEnv = {
  BI_ENGINE: 'oracle', ORACLE_HOST: 'oracle-test', ORACLE_PORT: '1521', ORACLE_DATABASE: 'FREE',
  ORACLE_SERVICE_NAME: 'FREEPDB1', ORACLE_USER: 'BI_ANALYZE', ORACLE_SCHEMAS: 'BI_DEMO',
  ORACLE_PROTOCOL: 'tcp', ORACLE_CONNECT_TIMEOUT_MS: '9000', ORACLE_QUERY_TIMEOUT_MS: '7000',
};

const passwordEnv = (engine) => `CM_${engine.toUpperCase()}_PASSWORD`;
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const v2 = (extra = {}) => buildLiveProfile({...postgresqlEnv, POSTGRESQL_STRUCTURE_QUERY_PACK: 'v2', ...extra}, passwordEnv('postgresql'));

test('POSTGRESQL_STRUCTURE_QUERY_PACK=v2 selects the existing v2 index querypack, not the hardcoded v1', () => {
  const profile = v2();
  assert.deepEqual(profile.queryPack, {version: 'v2'});
});

test('POSTGRESQL_STRUCTURE_QUERY_PACK=v2 selects the existing bounded v2 catalog policy', async () => {
  const profile = v2();
  const v2Fixture = await readJson('services/bi-control/fixtures/postgresql-structure-profile-v2.json');
  const v2Manifest = await readJson('services/bi-control/query-packs/db-analyzer/v2/postgresql/manifest.json');
  assert.deepEqual(profile.policy.catalogScan, v2Fixture.policy.catalogScan);
  assert.ok(profile.policy.catalogScan.allowedQueryIds.includes('postgresql.structure.indexes'));
  assert.deepEqual(
    profile.policy.catalogScan.allowedQueryIds,
    v2Manifest.queries.map((query) => query.id),
    'the bounded catalog policy must allow exactly the v2 pack query ids',
  );
});

test('absent or exact v1 preserve the historical v1 default exactly', () => {
  const baseline = buildLiveProfile(postgresqlEnv, passwordEnv('postgresql'));
  assert.deepEqual(baseline.queryPack, {version: 'v1'});
  assert.equal(Object.hasOwn(baseline.policy, 'catalogScan'), false);
  assert.deepEqual(baseline.policy, {access: 'READ_ONLY', allowRowSamples: false, maxQueryTimeoutMs: 7000});
  const explicitV1 = buildLiveProfile({...postgresqlEnv, POSTGRESQL_STRUCTURE_QUERY_PACK: 'v1'}, passwordEnv('postgresql'));
  assert.deepEqual(explicitV1, baseline);
});

test('every other supplied POSTGRESQL_STRUCTURE_QUERY_PACK value fails closed', () => {
  const values = [
    'V2', 'v2 ', ' v2', 'v2\n', 'v2\t', '2', '02', 'v3', 'v10', 'V1', 'v 2', 'index', 'indexes',
    '', 'postgresql', 'v1v2', 'constructor', '__proto__', 'hasOwnProperty',
  ];
  for (const value of values) {
    assert.throws(
      () => buildLiveProfile({...postgresqlEnv, POSTGRESQL_STRUCTURE_QUERY_PACK: value}, passwordEnv('postgresql')),
      /CONFIG_POSTGRESQL_STRUCTURE_QUERY_PACK_INVALID/,
      `POSTGRESQL_STRUCTURE_QUERY_PACK=${JSON.stringify(value)} must fail closed`,
    );
  }
  assert.throws(
    () => buildLiveProfile({...postgresqlEnv, POSTGRESQL_STRUCTURE_QUERY_PACK: 2}, passwordEnv('postgresql')),
    /CONFIG_POSTGRESQL_STRUCTURE_QUERY_PACK_INVALID/,
    'a non-string selector must fail closed',
  );
});

test('v2 selection preserves the existing scope, policy, session and credential restrictions', () => {
  const baseline = buildLiveProfile(postgresqlEnv, passwordEnv('postgresql'));
  const profile = v2();
  assert.equal(profile.engine, 'postgresql');
  assert.equal(profile.mode, 'RUNTIME');
  assert.equal(profile.profileId, baseline.profileId, 'the selector must not change the deterministic profile identity');
  assert.deepEqual(profile.scope, baseline.scope);
  assert.deepEqual(profile.adapter, baseline.adapter);
  assert.equal(profile.policy.access, 'READ_ONLY');
  assert.equal(profile.policy.allowRowSamples, false);
  assert.equal(profile.policy.maxQueryTimeoutMs, baseline.policy.maxQueryTimeoutMs);
  assert.equal(JSON.stringify(profile).includes('secret-value'), false);
});

test('v1 and v2 runtime profiles both pass the existing analyze-profile validation', () => {
  assert.doesNotThrow(() => validateAnalyzeProfile(v2()));
  assert.doesNotThrow(() => validateAnalyzeProfile(buildLiveProfile(postgresqlEnv, passwordEnv('postgresql'))));
});

test('the selector is PostgreSQL-scoped: mssql and oracle keep their historical v1 default', () => {
  const mssql = buildLiveProfile({...mssqlEnv, POSTGRESQL_STRUCTURE_QUERY_PACK: 'v2'}, passwordEnv('mssql'));
  assert.deepEqual(mssql.queryPack, {version: 'v1'});
  assert.equal(Object.hasOwn(mssql.policy, 'catalogScan'), false);
  const oracle = buildLiveProfile({...oracleEnv, POSTGRESQL_STRUCTURE_QUERY_PACK: 'v2'}, passwordEnv('oracle'));
  assert.deepEqual(oracle.queryPack, {version: 'v1'});
  assert.equal(Object.hasOwn(oracle.policy, 'catalogScan'), false);
});