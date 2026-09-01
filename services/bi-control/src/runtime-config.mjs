import { createHash } from 'node:crypto';

import { coded, parseSchemas } from './policy.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const token = (value) => typeof value === 'string' && /^[A-Z][A-Z0-9_$#]{0,127}$/.test(value);
const hostname = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/.test(value);
const postgresqlIdentifier = (value) => typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/.test(value);

const canonicalInteger = (value) => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value);

function integer(env, name, fallback, minimum, maximum) {
  const raw = env[name];
  if (raw !== undefined && !canonicalInteger(raw)) throw coded(`CONFIG_${name}_INVALID`);
  const value = Number(raw ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw coded(`CONFIG_${name}_INVALID`);
  return value;
}

function bool(env, name, fallback) {
  const value = env[name] ?? String(fallback);
  if (!['true', 'false'].includes(value)) throw coded(`CONFIG_${name}_INVALID`);
  return value === 'true';
}

export function selectedEngine(env = process.env) {
  const engine = env.BI_ENGINE;
  if (!['mssql', 'oracle', 'postgresql'].includes(engine)) throw coded('CONFIG_BI_ENGINE_INVALID');
  return engine;
}

export function buildOracleConnectString(adapter) {
  const timeoutSeconds = Math.max(1, Math.ceil(adapter.connectTimeoutMs / 1000));
  const serverDn = adapter.serverDn === null ? '' : `(SECURITY=(SSL_SERVER_CERT_DN="${adapter.serverDn}"))`;
  return `(DESCRIPTION=(CONNECT_TIMEOUT=${timeoutSeconds})(TRANSPORT_CONNECT_TIMEOUT=${timeoutSeconds})(ADDRESS=(PROTOCOL=${adapter.protocol.toUpperCase()})(HOST=${adapter.host})(PORT=${adapter.port}))(CONNECT_DATA=(SERVICE_NAME=${adapter.serviceName}))${serverDn})`;
}

export function buildLiveProfile(env = process.env, passwordEnv) {
  const engine = selectedEngine(env);
  if (typeof passwordEnv !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(passwordEnv)) throw coded('DB_ANALYZE_CONFIG_INVALID');
  if (engine === 'mssql') {
    const database = env.MSSQL_DATABASE ?? '';
    const host = env.MSSQL_HOST ?? '';
    const user = env.MSSQL_USER ?? '';
    const port = integer(env, 'MSSQL_PORT', 1433, 1, 65535);
    const timeout = integer(env, 'MSSQL_QUERY_TIMEOUT_MS', 10000, 1000, 120000);
    if (!hostname(host) || !user || !/^[A-Za-z0-9_.:$#-]{1,128}$/.test(database)) throw coded('DB_ANALYZE_CONFIG_INVALID');
    return {
      schemaVersion: 'chimpmaera.db/analyze-profile/v1',
      profileId: `chimpmaera-bi-mssql-${sha256(`${host}:${port}/${database}/${user}`).slice(0, 16)}`,
      engine, mode: 'RUNTIME', queryPack: {version: 'v1'},
      scope: {database, container: null, schemas: parseSchemas(env.MSSQL_SCHEMAS)},
      policy: {access: 'READ_ONLY', allowRowSamples: false, maxQueryTimeoutMs: timeout},
      adapter: {kind: engine, host, port, user, passwordEnv, encrypt: bool(env, 'MSSQL_ENCRYPT', true), trustServerCertificate: bool(env, 'MSSQL_TRUST_SERVER_CERTIFICATE', false)},
    };
  }

  if (engine === 'postgresql') {
    const database = env.POSTGRESQL_DATABASE ?? '';
    const host = env.POSTGRESQL_HOST ?? '';
    const user = env.POSTGRESQL_USER ?? '';
    const port = integer(env, 'POSTGRESQL_PORT', 5432, 1, 65535);
    const connectTimeoutMs = integer(env, 'POSTGRESQL_CONNECT_TIMEOUT_MS', 10000, 1000, 120000);
    const queryTimeoutMs = integer(env, 'POSTGRESQL_QUERY_TIMEOUT_MS', 10000, 1000, 120000);
    const ssl = bool(env, 'POSTGRESQL_SSL', true);
    const schemas = parseSchemas(env.POSTGRESQL_SCHEMAS);
    if (!hostname(host) || !postgresqlIdentifier(database) || !postgresqlIdentifier(user)
      || schemas.some((schema) => !postgresqlIdentifier(schema))) throw coded('DB_ANALYZE_CONFIG_INVALID');
    return {
      schemaVersion: 'chimpmaera.db/analyze-profile/v1',
      profileId: `chimpmaera-bi-postgresql-${sha256(`${host}:${port}/${database}/${user}`).slice(0, 16)}`,
      engine, mode: 'RUNTIME', queryPack: {version: 'v1'},
      scope: {database, container: null, schemas},
      policy: {access: 'READ_ONLY', allowRowSamples: false, maxQueryTimeoutMs: queryTimeoutMs},
      adapter: {kind: engine, host, port, user, passwordEnv, ssl, connectTimeoutMs},
    };
  }

  const host = env.ORACLE_HOST ?? '';
  const database = env.ORACLE_DATABASE ?? '';
  const serviceName = env.ORACLE_SERVICE_NAME ?? '';
  const user = env.ORACLE_USER ?? '';
  const protocol = env.ORACLE_PROTOCOL ?? 'tcp';
  const serverDn = env.ORACLE_TLS_SERVER_DN || null;
  const port = integer(env, 'ORACLE_PORT', protocol === 'tcps' ? 2484 : 1521, 1, 65535);
  const connectTimeoutMs = integer(env, 'ORACLE_CONNECT_TIMEOUT_MS', 10000, 1000, 120000);
  const queryTimeoutMs = integer(env, 'ORACLE_QUERY_TIMEOUT_MS', 10000, 1000, 120000);
  if (!hostname(host) || !token(database) || !token(serviceName) || !token(user)
    || !['tcp', 'tcps'].includes(protocol)
    || (serverDn !== null && (protocol !== 'tcps' || !/^[A-Za-z0-9 ,.=_-]{1,512}$/.test(serverDn)))) {
    throw coded('DB_ANALYZE_CONFIG_INVALID');
  }
  const schemas = parseSchemas(env.ORACLE_SCHEMAS);
  if (schemas.some((schema) => !token(schema))) throw coded('DB_ANALYZE_CONFIG_INVALID');
  return {
    schemaVersion: 'chimpmaera.db/analyze-profile/v1',
    profileId: `chimpmaera-bi-oracle-${sha256(`${host}:${port}/${serviceName}/${database}/${user}`).slice(0, 16)}`,
    engine, mode: 'RUNTIME', queryPack: {version: 'v1'},
    scope: {database, container: serviceName, schemas},
    policy: {access: 'READ_ONLY', allowRowSamples: false, maxQueryTimeoutMs: queryTimeoutMs},
    adapter: {kind: engine, host, port, user, passwordEnv, protocol, serviceName, serverDn, connectTimeoutMs},
  };
}

// Versioned, additive product descriptor.
//
// Pure selection table: each engine maps to the EXISTING transport, metadata/dialect,
// executor, capability and evidence components it uses — referenced by stable
// identifier, the route being bound to an implementation by the consuming module —
// plus the engine-specific file-derived secret route. No component is rewritten here
// and no runtime module is imported, so workflow and server can consult it without an
// import cycle. The table is frozen and versioned; selecting with a stale version, or
// for a missing/unknown engine, fails closed rather than defaulting to another engine.
export const PRODUCT_DESCRIPTOR_VERSION = 'v1';

export const PRODUCT_DESCRIPTOR = Object.freeze({
  schemaVersion: 'chimpmaera.db/product-descriptor/v1',
  version: PRODUCT_DESCRIPTOR_VERSION,
  engines: Object.freeze({
    mssql: Object.freeze({
      engine: 'mssql',
      components: Object.freeze({
        transport: 'mssql.pool-connect',
        metadata: 'mssql.runtime-scope-normalize',
        executor: 'mssql.run-queries',
        capability: 'mssql.read-only-principal',
        evidence: 'preflight.coverage-ledger',
      }),
      secret: Object.freeze({fileVariable: 'MSSQL_PASSWORD_FILE', env: 'CM_MSSQL_PASSWORD'}),
    }),
    oracle: Object.freeze({
      engine: 'oracle',
      components: Object.freeze({
        transport: 'oracle.connect-string',
        metadata: 'oracle.scoped-query',
        executor: 'oracle.run-queries',
        capability: 'oracle.read-only-capabilities',
        evidence: 'preflight.coverage-ledger',
      }),
      secret: Object.freeze({fileVariable: 'ORACLE_PASSWORD_FILE', env: 'CM_ORACLE_PASSWORD'}),
    }),
    postgresql: Object.freeze({
      engine: 'postgresql',
      components: Object.freeze({
        transport: 'postgresql.connection-options',
        metadata: 'postgresql.scoped-query',
        executor: 'postgresql.run-queries',
        capability: 'postgresql.read-only-session',
        evidence: 'preflight.coverage-ledger',
      }),
      secret: Object.freeze({fileVariable: 'POSTGRESQL_PASSWORD_FILE', env: 'CM_POSTGRESQL_PASSWORD'}),
    }),
  }),
});

// Fail-closed selector: a missing/unknown engine or a stale descriptor version throws
// instead of defaulting to another engine's components.
export function selectProductDescriptor(engine, {version = PRODUCT_DESCRIPTOR_VERSION} = {}) {
  if (version !== PRODUCT_DESCRIPTOR_VERSION) throw coded('DB_ANALYZE_DESCRIPTOR_STALE');
  const descriptor = typeof engine === 'string' ? PRODUCT_DESCRIPTOR.engines[engine] : undefined;
  if (!descriptor || descriptor.engine !== engine) throw coded('DB_ANALYZE_DESCRIPTOR_ENGINE_UNKNOWN');
  return descriptor;
}

// Presence-based cross-engine credential guard: when a profile carries a credential
// reference it must equal this engine's own secret route — a reference bound to another
// engine (substitution) fails closed. Profiles without a reference (e.g. SYNTHETIC
// fixtures) have nothing to bind and are left untouched.
export function assertProductSecretBinding(descriptor, passwordEnv) {
  if (passwordEnv === undefined || passwordEnv === null) return;
  if (typeof passwordEnv !== 'string' || passwordEnv !== descriptor.secret.env) {
    throw coded('DB_ANALYZE_SECRET_BINDING_MISMATCH');
  }
}
