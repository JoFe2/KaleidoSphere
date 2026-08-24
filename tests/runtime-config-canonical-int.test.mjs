import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLiveProfile, selectedEngine } from '../services/bi-control/src/runtime-config.mjs';

const postgresqlEnv = {
  BI_ENGINE: 'postgresql', POSTGRESQL_HOST: 'postgres-test', POSTGRESQL_PORT: '5432',
  POSTGRESQL_DATABASE: 'kaleidosphere', POSTGRESQL_USER: 'bi_analyze',
  POSTGRESQL_SCHEMAS: 'public,reporting', POSTGRESQL_SSL: 'true',
  POSTGRESQL_CONNECT_TIMEOUT_MS: '9000', POSTGRESQL_QUERY_TIMEOUT_MS: '7000',
};

const oracleEnv = {
  BI_ENGINE: 'oracle', ORACLE_HOST: 'oracle-test', ORACLE_PORT: '1521', ORACLE_DATABASE: 'FREE',
  ORACLE_SERVICE_NAME: 'FREEPDB1', ORACLE_USER: 'BI_ANALYZE', ORACLE_SCHEMAS: 'BI_DEMO',
  ORACLE_PROTOCOL: 'tcp', ORACLE_CONNECT_TIMEOUT_MS: '9000', ORACLE_QUERY_TIMEOUT_MS: '7000',
};

const mssqlEnv = {
  BI_ENGINE: 'mssql', MSSQL_HOST: 'mssql-test', MSSQL_PORT: '1433',
  MSSQL_DATABASE: 'Kaleidosphere', MSSQL_USER: 'bi_analyze', MSSQL_SCHEMAS: 'dbo',
  MSSQL_QUERY_TIMEOUT_MS: '9000',
};

const passwordEnv = (engine) => `CM_${engine.toUpperCase()}_PASSWORD`;

const integerFields = [
  {engine: 'mssql', env: mssqlEnv, field: 'MSSQL_PORT', minimum: 1, maximum: 65535, fallback: 1433},
  {engine: 'mssql', env: mssqlEnv, field: 'MSSQL_QUERY_TIMEOUT_MS', minimum: 1000, maximum: 120000, fallback: 10000},
  {engine: 'postgresql', env: postgresqlEnv, field: 'POSTGRESQL_PORT', minimum: 1, maximum: 65535, fallback: 5432},
  {engine: 'postgresql', env: postgresqlEnv, field: 'POSTGRESQL_CONNECT_TIMEOUT_MS', minimum: 1000, maximum: 120000, fallback: 10000},
  {engine: 'postgresql', env: postgresqlEnv, field: 'POSTGRESQL_QUERY_TIMEOUT_MS', minimum: 1000, maximum: 120000, fallback: 10000},
  {engine: 'oracle', env: oracleEnv, field: 'ORACLE_PORT', minimum: 1, maximum: 65535, fallback: 1521},
  {engine: 'oracle', env: oracleEnv, field: 'ORACLE_CONNECT_TIMEOUT_MS', minimum: 1000, maximum: 120000, fallback: 10000},
  {engine: 'oracle', env: oracleEnv, field: 'ORACLE_QUERY_TIMEOUT_MS', minimum: 1000, maximum: 120000, fallback: 10000},
];

const nonCanonicalSpellings = [
  '05432', // leading-zero multi-digit
  '00', // leading zeros, zero
  '007', // leading-zero multi-digit
  '5e3', // exponent
  '1e4', // exponent
  '5.5e2', // exponent with decimal point
  '0x1538', // hexadecimal
  '0X1538', // hexadecimal, uppercase
  '+5432', // plus-signed
  '-5432', // minus-signed
  '5432.0', // decimal
  '5432.', // trailing decimal point
  '.5432', // leading decimal point
  ' 5432', // leading whitespace
  '5432 ', // trailing whitespace
  '5 432', // embedded whitespace
  '\t5432', // tab
  '5432\n', // newline
  '', // empty
  'NaN', // NaN
  '-NaN', // signed NaN
  'Infinity', // positive infinity
  '-Infinity', // negative infinity
  '+Infinity', // plus-signed infinity
];

test('KS #35 probe: non-canonical PostgreSQL integer spellings deny before profile construction', () => {
  // Exact main b329b7d silently accepts these: Number('05e3')=5000, Number('1e4')=10000, Number('010000')=10000.
  const env = {...postgresqlEnv, POSTGRESQL_PORT: '05e3', POSTGRESQL_CONNECT_TIMEOUT_MS: '1e4', POSTGRESQL_QUERY_TIMEOUT_MS: '010000'};
  assert.throws(() => buildLiveProfile(env, passwordEnv('postgresql')), /CONFIG_POSTGRESQL_PORT_INVALID/);
  assert.throws(() => buildLiveProfile({...postgresqlEnv, POSTGRESQL_PORT: '05e3'}, passwordEnv('postgresql')), /CONFIG_POSTGRESQL_PORT_INVALID/);
  assert.throws(() => buildLiveProfile({...postgresqlEnv, POSTGRESQL_CONNECT_TIMEOUT_MS: '1e4'}, passwordEnv('postgresql')), /CONFIG_POSTGRESQL_CONNECT_TIMEOUT_MS_INVALID/);
  assert.throws(() => buildLiveProfile({...postgresqlEnv, POSTGRESQL_QUERY_TIMEOUT_MS: '010000'}, passwordEnv('postgresql')), /CONFIG_POSTGRESQL_QUERY_TIMEOUT_MS_INVALID/);
});

test('canonical minimum, ordinary and maximum decimal strings retain exact bounded profiles', () => {
  const min = buildLiveProfile({...postgresqlEnv, POSTGRESQL_PORT: '1', POSTGRESQL_CONNECT_TIMEOUT_MS: '1000', POSTGRESQL_QUERY_TIMEOUT_MS: '1000'}, passwordEnv('postgresql'));
  assert.deepEqual(min.adapter, {kind: 'postgresql', host: 'postgres-test', port: 1, user: 'bi_analyze', passwordEnv: 'CM_POSTGRESQL_PASSWORD', ssl: true, connectTimeoutMs: 1000});
  assert.deepEqual(min.policy, {access: 'READ_ONLY', allowRowSamples: false, maxQueryTimeoutMs: 1000});
  const ordinary = buildLiveProfile({...postgresqlEnv, POSTGRESQL_PORT: '5433', POSTGRESQL_CONNECT_TIMEOUT_MS: '9000', POSTGRESQL_QUERY_TIMEOUT_MS: '7000'}, passwordEnv('postgresql'));
  assert.deepEqual(ordinary.adapter, {kind: 'postgresql', host: 'postgres-test', port: 5433, user: 'bi_analyze', passwordEnv: 'CM_POSTGRESQL_PASSWORD', ssl: true, connectTimeoutMs: 9000});
  assert.deepEqual(ordinary.policy, {access: 'READ_ONLY', allowRowSamples: false, maxQueryTimeoutMs: 7000});
  const max = buildLiveProfile({...postgresqlEnv, POSTGRESQL_PORT: '65535', POSTGRESQL_CONNECT_TIMEOUT_MS: '120000', POSTGRESQL_QUERY_TIMEOUT_MS: '120000'}, passwordEnv('postgresql'));
  assert.equal(max.adapter.port, 65535);
  assert.equal(max.adapter.connectTimeoutMs, 120000);
  assert.deepEqual(max.policy, {access: 'READ_ONLY', allowRowSamples: false, maxQueryTimeoutMs: 120000});
});

test('canonical minimum, ordinary and maximum decimal strings retain exact bounded fields for every shared integer field', () => {
  for (const {engine, env, field, minimum, fallback, maximum} of integerFields) {
    for (const value of [minimum, fallback, maximum]) {
      const profile = buildLiveProfile({...env, [field]: String(value)}, passwordEnv(engine));
      const holder = field.endsWith('_QUERY_TIMEOUT_MS') ? profile.policy : profile.adapter;
      const key = field.endsWith('_PORT') ? 'port' : field.endsWith('_CONNECT_TIMEOUT_MS') ? 'connectTimeoutMs' : 'maxQueryTimeoutMs';
      assert.equal(holder[key], value, `${field}=${value} must retain the canonical ${key}`);
      assert.equal(profile.policy.access, 'READ_ONLY', `${field}=${value} must retain the read-only policy`);
      assert.equal(profile.adapter.passwordEnv, passwordEnv(engine), `${field}=${value} must retain the credential reference`);
    }
  }
});

test('unset integer fields fall back to the existing numeric defaults and bounds', () => {
  const postgresql = buildLiveProfile({BI_ENGINE: 'postgresql', POSTGRESQL_HOST: 'postgres-test', POSTGRESQL_DATABASE: 'kaleidosphere', POSTGRESQL_USER: 'bi_analyze', POSTGRESQL_SCHEMAS: 'public', POSTGRESQL_SSL: 'true'}, passwordEnv('postgresql'));
  assert.deepEqual(postgresql.adapter, {kind: 'postgresql', host: 'postgres-test', port: 5432, user: 'bi_analyze', passwordEnv: 'CM_POSTGRESQL_PASSWORD', ssl: true, connectTimeoutMs: 10000});
  assert.deepEqual(postgresql.policy, {access: 'READ_ONLY', allowRowSamples: false, maxQueryTimeoutMs: 10000});
  const mssql = buildLiveProfile({BI_ENGINE: 'mssql', MSSQL_HOST: 'mssql-test', MSSQL_DATABASE: 'Kaleidosphere', MSSQL_USER: 'bi_analyze', MSSQL_SCHEMAS: 'dbo'}, passwordEnv('mssql'));
  assert.deepEqual(mssql.adapter, {kind: 'mssql', host: 'mssql-test', port: 1433, user: 'bi_analyze', passwordEnv: 'CM_MSSQL_PASSWORD', encrypt: true, trustServerCertificate: false});
  assert.deepEqual(mssql.policy, {access: 'READ_ONLY', allowRowSamples: false, maxQueryTimeoutMs: 10000});
  const oracle = buildLiveProfile({BI_ENGINE: 'oracle', ORACLE_HOST: 'oracle-test', ORACLE_DATABASE: 'FREE', ORACLE_SERVICE_NAME: 'FREEPDB1', ORACLE_USER: 'BI_ANALYZE', ORACLE_SCHEMAS: 'BI_DEMO', ORACLE_PROTOCOL: 'tcp'}, passwordEnv('oracle'));
  assert.equal(oracle.adapter.port, 1521);
  assert.equal(oracle.adapter.connectTimeoutMs, 10000);
  assert.deepEqual(oracle.policy, {access: 'READ_ONLY', allowRowSamples: false, maxQueryTimeoutMs: 10000});
  const oracleTcps = buildLiveProfile({BI_ENGINE: 'oracle', ORACLE_HOST: 'oracle-test', ORACLE_DATABASE: 'FREE', ORACLE_SERVICE_NAME: 'FREEPDB1', ORACLE_USER: 'BI_ANALYZE', ORACLE_SCHEMAS: 'BI_DEMO', ORACLE_PROTOCOL: 'tcps'}, passwordEnv('oracle'));
  assert.equal(oracleTcps.adapter.port, 2484);
});

test('every shared integer-backed field denies non-canonical spellings with its field-specific code', () => {
  for (const {engine, env, field} of integerFields) {
    for (const spelling of nonCanonicalSpellings) {
      assert.throws(
        () => buildLiveProfile({...env, [field]: spelling}, passwordEnv(engine)),
        new RegExp(`CONFIG_${field}_INVALID`),
        `${field}=${JSON.stringify(spelling)} must deny with CONFIG_${field}_INVALID`,
      );
    }
  }
});

test('every shared integer-backed field denies canonical out-of-range values with its field-specific code', () => {
  for (const {engine, env, field, minimum, maximum} of integerFields) {
    assert.throws(
      () => buildLiveProfile({...env, [field]: String(minimum - 1)}, passwordEnv(engine)),
      new RegExp(`CONFIG_${field}_INVALID`),
      `${field}=${minimum - 1} is below the minimum`,
    );
    assert.throws(
      () => buildLiveProfile({...env, [field]: String(maximum + 1)}, passwordEnv(engine)),
      new RegExp(`CONFIG_${field}_INVALID`),
      `${field}=${maximum + 1} is above the maximum`,
    );
  }
});

test('profile identity is deterministic, credential-reference-only, and unaffected by unknown configuration text', () => {
  const profile = buildLiveProfile(postgresqlEnv, 'CM_POSTGRESQL_PASSWORD');
  assert.equal(profile.profileId, buildLiveProfile(postgresqlEnv, 'A_DIFFERENT_PASSWORD_ENV').profileId);
  assert.equal(profile.adapter.passwordEnv, 'CM_POSTGRESQL_PASSWORD');
  assert.equal(JSON.stringify(profile).includes('secret-value'), false);
  assert.deepEqual(
    buildLiveProfile({...postgresqlEnv, POSTGRESQL_UNKNOWN: 'SELECT 1; DROP TABLE users;'}, 'CM_POSTGRESQL_PASSWORD'),
    profile,
  );
});

test('non-integer denials and authority boundaries are unchanged', () => {
  assert.throws(() => selectedEngine({...postgresqlEnv, BI_ENGINE: 'postgres'}), /CONFIG_BI_ENGINE_INVALID/);
  assert.throws(() => buildLiveProfile({...postgresqlEnv, POSTGRESQL_HOST: 'bad host'}, passwordEnv('postgresql')), /DB_ANALYZE_CONFIG_INVALID/);
  assert.throws(() => buildLiveProfile({...postgresqlEnv, POSTGRESQL_DATABASE: 'bad-database'}, passwordEnv('postgresql')), /DB_ANALYZE_CONFIG_INVALID/);
  assert.throws(() => buildLiveProfile({...postgresqlEnv, POSTGRESQL_SCHEMAS: 'public,bad schema'}, passwordEnv('postgresql')), /DB_ANALYZE_SCHEMA_SCOPE_INVALID|DB_ANALYZE_CONFIG_INVALID/);
  assert.throws(() => buildLiveProfile({...oracleEnv, ORACLE_PROTOCOL: 'udp'}, passwordEnv('oracle')), /DB_ANALYZE_CONFIG_INVALID/);
  assert.throws(() => buildLiveProfile({...oracleEnv, ORACLE_TLS_SERVER_DN: 'CN=oracle-test'}, passwordEnv('oracle')), /DB_ANALYZE_CONFIG_INVALID/);
  assert.throws(() => buildLiveProfile({...oracleEnv, ORACLE_PROTOCOL: 'tcps', ORACLE_TLS_SERVER_DN: 'CN=oracle-test!'}, passwordEnv('oracle')), /DB_ANALYZE_CONFIG_INVALID/);
  assert.throws(() => buildLiveProfile(postgresqlEnv, 'bad ref'), /DB_ANALYZE_CONFIG_INVALID/);
  assert.throws(() => buildLiveProfile(postgresqlEnv, 42), /DB_ANALYZE_CONFIG_INVALID/);
  assert.throws(() => buildLiveProfile(postgresqlEnv, 'CM_POSTGRESQL_PASSWORD extra'), /DB_ANALYZE_CONFIG_INVALID/);
});