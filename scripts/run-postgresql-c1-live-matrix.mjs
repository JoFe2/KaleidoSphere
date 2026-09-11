#!/usr/bin/env node
// KS149 / PG-KS-02 — PostgreSQL C1 live positive/negative matrix (parent-executable).
//
// This runner performs the real-disposable-PostgreSQL execution that the source-local
// C1 certificate (verification/postgresql/postgresql-c1-evidence-v1.json) records as
// BLOCKED_EXTERNAL. It is executed by the parent live operator, who owns a running
// isolated PostgreSQL 16.x server bound to 127.0.0.1; the credential-free worker that
// ships this repository never executes it and never records a live result. A missing
// live result stays an unresolved prerequisite (see WORK_RESULT.md) and is never
// marked PASS.
//
// It drives the REGULAR product path through the repository's own modules —
// buildLiveProfile (exact v2 structure query pack, the certified C1 structure scan)
// -> runAnalyzeProfile (descriptor-bound dispatch, product secret binding enforced)
// -> renderAnalyzeEvidence -> buildStructureMapOutputs — mirroring the KS23
// end-to-end harness:
//
//   * AC01: the verified least-privilege read-only principal connects, its role
//     readback matches the declared principal (all admin capabilities false,
//     read-only session settings on) and a real write probe fails closed (25006
//     under the product read-only session, 42501 on the bare least-privilege
//     connection).
//   * AC02: the exact-profile v2 positive run returns identity, schemas, relations,
//     columns, constraints, dependencies and bounded index enumeration; the run is
//     byte-stable across a credential rotation, the canonical artifact is re-read
//     from disk and revalidated through the product output pipeline, and the output
//     manifest source snapshot digest agrees with the analysis snapshot digest
//     (receipt / projection agreement).
//   * AC03: the exact-profile negative matrix — wrong (rotated) secret, connect-
//     denied database (denied metadata preserved as a denial, never coerced to an
//     empty success), timeout and cancellation controlled probes with post-probe
//     health and zero active followers — plus the source-local dispatch/auth/scope
//     cells (stale descriptor, scope substitution, cross-engine secret
//     substitution, no broadened dispatch).
//
// The runner provisions a disposable clean room on the operator's server (two
// throwaway databases and two throwaway least-privilege roles with canary
// credentials), runs the matrix, tears the clean room down, verifies the teardown,
// scans every emitted artifact for credential/DSN leakage, and only then writes the
// evidence file and the human readback. Any assertion failure tears the clean room
// down and exits non-zero without writing evidence.
//
// Environment contract (validated by scripts/run-postgresql-c1-live-matrix.sh):
//   KS149_PG_HOST               must be exactly 127.0.0.1 (loopback-only)
//   KS149_PG_PORT               port of the running isolated PostgreSQL 16.x
//   KS149_PG_OWNER_USER         provisioning role (default: postgres)
//   KS149_PG_ADMIN_DATABASE     database the owner role connects to (default: postgres)
//   KS149_PG_OWNER_PASSWORD_FILE  mode-0600 file holding the owner password
//
// Secrets travel only as file paths; the product-bound credential reference
// (CM_POSTGRESQL_PASSWORD) is the single environment variable the regular product
// executor consumes, exactly as the control server sets it, and it is deleted again
// before the runner exits. The operator's password file is read once and never
// copied, written, or disclosed.

import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdir, mkdtemp, open, readFile, rename, rm, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';

import {COVERAGE_STATES, canonicalJson, sha256, validateQueryManifest} from '../services/bi-control/src/db-analyzer/core.mjs';
import {buildPostgresqlConnectionOptions, compilePostgresqlProfileQuery} from '../services/bi-control/src/db-analyzer/postgresql-adapter.mjs';
import {readPostgresqlSessionProof, runPostgresqlControlledProbe} from '../services/bi-control/src/db-analyzer/postgresql-runtime.mjs';
import {auditCatalogQuery} from '../services/bi-control/src/db-analyzer/query-safety.mjs';
import {buildStructureMapOutputs} from '../services/bi-control/src/db-analyzer/outputs.mjs';
import {renderAnalyzeEvidence, runAnalyzeProfile} from '../services/bi-control/src/db-analyzer/workflow.mjs';
import {
  PRODUCT_DESCRIPTOR_VERSION,
  assertProductSecretBinding,
  buildLiveProfile,
  selectProductDescriptor,
} from '../services/bi-control/src/runtime-config.mjs';

const repositoryRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const controlRoot = path.join(repositoryRoot, 'services', 'bi-control');
const requireFromControl = createRequire(path.join(controlRoot, 'package.json'));
const {Client} = requireFromControl('pg');

const LIVE_EVIDENCE_SCHEMA_VERSION = 'kaleidosphere.db/postgresql-c1-live-matrix/v1';
const DATABASE = 'ks149_c1';
const DENIED_DATABASE = 'ks149_c1_denied';
const SCHEMA = 'ks149_app';
const SCAN_ROLE = 'ks149_scan';
const DENIED_ROLE = 'ks149_denied';
const PRODUCT_PASSWORD_ENV = 'CM_POSTGRESQL_PASSWORD';
const PARTIAL_INDEX_NAME = 'ks149_orders_account_idx';
const PASSWORD_SHAPE = /^[A-Za-z0-9_]{32,96}$/;
const RESERVED_PORTS = new Set([18789, 8000, 8081, 18790, 18088, 18089]);

const fileSha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const canary = (prefix) => `${prefix}${randomBytes(20).toString('hex')}`;
const safePassword = (value) => {
  if (typeof value !== 'string' || !PASSWORD_SHAPE.test(value)) throw new Error('KS149_PASSWORD_SHAPE_INVALID');
  return value;
};
const env = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`KS149_REQUIRED_ENV_MISSING:${name}`);
  return value;
};
const identifier = (value) => typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value);

async function assertSecretFile(file) {
  const metadata = await stat(file);
  assert.equal(metadata.mode & 0o777, 0o600, 'owner secret file mode');
  assert.equal(metadata.isFile(), true, 'owner secret path must be a file');
}

async function atomicWrite(file, bytes) {
  await mkdir(path.dirname(file), {recursive: true, mode: 0o700});
  const temporary = `${file}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  await writeFile(temporary, bytes, {mode: 0o600, flag: 'wx'});
  const handle = await open(temporary, 'r');
  await handle.sync();
  await handle.close();
  await rename(temporary, file);
  const directory = await open(path.dirname(file), 'r');
  await directory.sync();
  await directory.close();
}

const liveProfileFor = (host, port, queryTimeoutMs) => buildLiveProfile({
  BI_ENGINE: 'postgresql',
  POSTGRESQL_HOST: host,
  POSTGRESQL_PORT: String(port),
  POSTGRESQL_DATABASE: DATABASE,
  POSTGRESQL_USER: SCAN_ROLE,
  POSTGRESQL_SCHEMAS: SCHEMA,
  POSTGRESQL_SSL: 'false',
  POSTGRESQL_CONNECT_TIMEOUT_MS: '5000',
  POSTGRESQL_QUERY_TIMEOUT_MS: String(queryTimeoutMs),
  POSTGRESQL_STRUCTURE_QUERY_PACK: 'v2',
}, PRODUCT_PASSWORD_ENV);

// A disposable connection: least-privilege user, optional read-only session option.
async function disposableClient({profile, password, readOnlySession = true}) {
  const options = buildPostgresqlConnectionOptions(profile, password);
  if (!readOnlySession) {
    delete options.options;
    options.application_name = 'kaleidosphere-ks149-probe';
  }
  const client = new Client(options);
  await client.connect();
  return client;
}

// The real write probe: an INSERT the least-privilege principal must not be able to
// perform. Under the product read-only session option the session fails first (25006);
// on a bare connection the missing privilege fails (42501). Both are recorded truthful.
async function liveWriteProbe({profile, password, readOnlySession, statement}) {
  const client = await disposableClient({profile, password, readOnlySession});
  let code;
  try {
    if (readOnlySession) await client.query('BEGIN READ ONLY');
    try {
      await client.query(statement);
    } catch (error) {
      code = error.code;
    }
    await client.query('ROLLBACK').catch(() => {});
  } finally {
    await client.end().catch(() => {});
  }
  return code;
}

// A connect attempt whose failure SQLSTATE is the observed truth.
async function connectFailureCode({host, port, user, password, database}) {
  const client = new Client({
    host, port, user, password, database, ssl: false,
    application_name: 'kaleidosphere-ks149-connect-probe',
  });
  try {
    await client.connect();
  } catch (error) {
    await client.end().catch(() => {});
    return error.code ?? 'CONNECT_FAILED';
  }
  await client.end();
  return 'CONNECTED_UNEXPECTEDLY';
}

// Source-local dispatch/auth/scope cells, driven through the exact product components.
function sourceLocalFailClosed() {
  const thrownCode = (fn) => {
    try {
      fn();
    } catch (error) {
      return error?.code ?? String(error?.message ?? error);
    }
    return 'NO_ERROR';
  };
  const noDispatch = (fn) => {
    let dispatches = 0;
    let code;
    try {
      fn();
      dispatches = 1;
    } catch (error) {
      code = error?.code ?? String(error?.message ?? error);
    }
    return {code, dispatches};
  };
  const postgresqlDescriptor = selectProductDescriptor('postgresql');
  const mssqlDescriptor = selectProductDescriptor('mssql');
  return {
    staleDescriptor: thrownCode(() => selectProductDescriptor('postgresql', {version: 'v0'})),
    scopeSubstitution: thrownCode(() => compilePostgresqlProfileQuery({
      profile: {scope: {schemas: [SCHEMA]}},
      query: {id: 'postgresql.structure.schemas', outputColumns: ['schema_name'], sortKeys: ['schema_name'], scopeColumn: 'schema_name'},
      statement: 'SELECT namespace.nspname AS schema_name FROM pg_catalog.pg_namespace AS namespace;',
      requestedSchemas: ['ks149_outside'],
    })),
    crossEngineSecretSubstitution: thrownCode(() => assertProductSecretBinding(postgresqlDescriptor, mssqlDescriptor.secret.env)),
    noBroadenedDispatch: {
      mutation: noDispatch(() => auditCatalogQuery({
        engine: 'postgresql', queryId: 'ks149.c1-live.mutation', sql: 'SELECT relname INTO ks149_sink FROM pg_catalog.pg_class;',
      })),
      rawRow: noDispatch(() => auditCatalogQuery({
        engine: 'postgresql', queryId: 'ks149.c1-live.raw-row', sql: 'SELECT customer_email FROM public.customers;',
      })),
    },
  };
}

function scanArtifacts(text, secrets) {
  return {
    secretCanaryMatches: secrets.reduce((count, secret) => count + text.split(secret).length - 1, 0),
    dsnMatches: (text.match(/postgres(?:ql)?:\/\//gi) ?? []).length,
  };
}

async function main() {
  const host = env('KS149_PG_HOST');
  assert.equal(host, '127.0.0.1', 'KS149 loopback-only host');
  const port = Number(env('KS149_PG_PORT'));
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65535, 'KS149_PG_PORT shape');
  assert.ok(!RESERVED_PORTS.has(port), 'KS149_PG_PORT reserved');
  const ownerUser = process.env.KS149_PG_OWNER_USER ?? 'postgres';
  const adminDatabase = process.env.KS149_PG_ADMIN_DATABASE ?? 'postgres';
  assert.ok(identifier(ownerUser), 'KS149_PG_OWNER_USER identifier');
  assert.ok(identifier(adminDatabase), 'KS149_PG_ADMIN_DATABASE identifier');
  const ownerPasswordFile = env('KS149_PG_OWNER_PASSWORD_FILE');
  await assertSecretFile(ownerPasswordFile);
  const ownerPassword = safePassword((await readFile(ownerPasswordFile, 'utf8')).trim());

  const runtimeDirectory = await mkdtemp(path.join(repositoryRoot, '.runtime', 'ks149-live-matrix-'));
  const scanPassword1 = canary('KS149_SCAN1_');
  const scanPassword2 = canary('KS149_SCAN2_');
  const deniedPassword = canary('KS149_DENIED_');
  safePassword(scanPassword1); safePassword(scanPassword2); safePassword(deniedPassword);
  const allSecrets = [ownerPassword, scanPassword1, scanPassword2, deniedPassword];

  const ownerClient = (database) => new Client({
    host, port, user: ownerUser, password: ownerPassword, database, ssl: false,
    application_name: 'kaleidosphere-ks149-provisioner',
  });
  const ownerStatements = (database) => [
    `SELECT pg_catalog.pg_terminate_backend(pid) FROM pg_catalog.pg_stat_activity WHERE datname = '${database}';`,
    `DROP DATABASE IF EXISTS ${database};`,
  ];

  // Fail fast: the target must really be a PostgreSQL 16.x server.
  const engineVersion = await new Promise((resolve, reject) => {
    const client = ownerClient(adminDatabase);
    client.connect()
      .then(() => client.query('SELECT current_setting(\'server_version\') AS engine_version;'))
      .then((response) => { resolve(response.rows[0].engine_version); })
      .catch(reject)
      .finally(() => { client.end().catch(() => {}); });
  });
  assert.match(engineVersion, /^16\.\d+/, 'KS149 target must be PostgreSQL 16.x');

  const profile = liveProfileFor(host, port, 5000);
  assert.equal(profile.queryPack.version, 'v2');
  assert.equal(profile.policy.catalogScan.allowedQueryIds.length, 7);
  assert.ok(profile.policy.catalogScan.allowedQueryIds.includes('postgresql.structure.indexes'));
  const probeProfile = liveProfileFor(host, port, 1000);
  const profileFile = path.join(runtimeDirectory, 'live-profile.json');
  await atomicWrite(profileFile, canonicalJson(profile));

  const v2PackDirectory = path.join(controlRoot, 'query-packs', 'db-analyzer', 'v2', 'postgresql');
  const v2ManifestBytes = await readFile(path.join(v2PackDirectory, 'manifest.json'));
  const v2Manifest = validateQueryManifest(JSON.parse(v2ManifestBytes.toString('utf8')));
  const sqlByQueryId = Object.fromEntries(await Promise.all(v2Manifest.queries.map(async (query) => [
    query.id, await readFile(path.join(v2PackDirectory, query.file), 'utf8'),
  ])));

  // Provision the disposable clean room on the operator's server.
  {
    const owner = ownerClient(adminDatabase);
    try {
      for (const statement of [...ownerStatements(DATABASE), ...ownerStatements(DENIED_DATABASE)]) await owner.query(statement);
      await owner.query(`CREATE DATABASE ${DATABASE};`);
      await owner.query(`CREATE DATABASE ${DENIED_DATABASE};`);
      // The denied database must be connect-denied: revoke the PUBLIC default and
      // grant nothing, so the metadata there is invisible to every non-owner role.
      await owner.query(`REVOKE CONNECT ON DATABASE ${DENIED_DATABASE} FROM PUBLIC;`);
    } finally {
      await owner.end().catch(() => {});
    }
    const databaseOwner = ownerClient(DATABASE);
    try {
      await databaseOwner.query(`DROP ROLE IF EXISTS ${SCAN_ROLE};`);
      await databaseOwner.query(`DROP ROLE IF EXISTS ${DENIED_ROLE};`);
      await databaseOwner.query(`CREATE ROLE ${SCAN_ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;`);
      await databaseOwner.query(`CREATE ROLE ${DENIED_ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;`);
      await databaseOwner.query(`ALTER ROLE ${SCAN_ROLE} PASSWORD '${scanPassword1}';`);
      await databaseOwner.query(`ALTER ROLE ${DENIED_ROLE} PASSWORD '${deniedPassword}';`);
      await databaseOwner.query(`
CREATE SCHEMA ${SCHEMA};
CREATE TABLE ${SCHEMA}.accounts (
  account_id bigint PRIMARY KEY,
  region text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ks149_accounts_region_uix ON ${SCHEMA}.accounts (region);
CREATE INDEX ks149_accounts_created_idx ON ${SCHEMA}.accounts (created_at);
CREATE TABLE ${SCHEMA}.orders (
  order_id bigint PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES ${SCHEMA}.accounts (account_id),
  amount numeric(12,2),
  status text NOT NULL,
  placed_at timestamptz
);
CREATE INDEX ${PARTIAL_INDEX_NAME} ON ${SCHEMA}.orders (account_id) WHERE status = 'open';
`);
      // The scan principal sees exactly the scoped schema; the denied principal
      // receives no grants at all.
      await databaseOwner.query(`GRANT USAGE ON SCHEMA ${SCHEMA} TO ${SCAN_ROLE};`);
      await databaseOwner.query(`GRANT SELECT ON ALL TABLES IN SCHEMA ${SCHEMA} TO ${SCAN_ROLE};`);
    } finally {
      await databaseOwner.end().catch(() => {});
    }
  }

  const teardown = async () => {
    const owner = ownerClient(adminDatabase);
    try {
      for (const statement of [...ownerStatements(DATABASE), ...ownerStatements(DENIED_DATABASE)]) await owner.query(statement);
      await owner.query(`DROP ROLE IF EXISTS ${SCAN_ROLE};`);
      await owner.query(`DROP ROLE IF EXISTS ${DENIED_ROLE};`);
    } finally {
      await owner.end().catch(() => {});
    }
  };
  const verifyCleanRoomGone = async () => {
    const owner = ownerClient(adminDatabase);
    try {
      const databaseNames = [DATABASE, DENIED_DATABASE].map((name) => `'${name}'`).join(', ');
      const roleNames = [SCAN_ROLE, DENIED_ROLE].map((name) => `'${name}'`).join(', ');
      const databases = (await owner.query(
        `SELECT count(*)::integer AS n FROM pg_catalog.pg_database WHERE datname IN (${databaseNames});`)).rows[0].n;
      const roles = (await owner.query(
        `SELECT count(*)::integer AS n FROM pg_catalog.pg_roles WHERE rolname IN (${roleNames});`)).rows[0].n;
      assert.equal(databases, 0, 'KS149 clean-room databases dropped');
      assert.equal(roles, 0, 'KS149 clean-room roles dropped');
    } finally {
      await owner.end().catch(() => {});
    }
  };

  let matrix;
  try {
    // AC01: verified least-privilege read-only principal.
    const session = await readPostgresqlSessionProof({profile, password: scanPassword1});
    assert.equal(session.roleName, SCAN_ROLE, 'AC01 role readback');
    assert.equal(session.adminCapabilities, false, 'AC01 admin capabilities');
    assert.equal(session.transactionReadOnly, 'on', 'AC01 transaction read-only');
    assert.equal(session.defaultTransactionReadOnly, 'on', 'AC01 default transaction read-only');
    const writeStatement = `INSERT INTO ${SCHEMA}.orders (order_id, account_id, status) VALUES (1, 1, 'open');`;
    const readOnlySessionSqlState = await liveWriteProbe({profile, password: scanPassword1, readOnlySession: true, statement: writeStatement});
    assert.equal(readOnlySessionSqlState, '25006', 'AC01 read-only session write probe');
    const noPrivilegeSqlState = await liveWriteProbe({profile, password: scanPassword1, readOnlySession: false, statement: writeStatement});
    assert.equal(noPrivilegeSqlState, '42501', 'AC01 least-privilege write probe');

    // AC02: the exact-profile v2 regular Analyze-to-Readback product path.
    let run1;
    let run2;
    let render1;
    let outputs1;
    process.env[PRODUCT_PASSWORD_ENV] = scanPassword1;
    try {
      run1 = await runAnalyzeProfile(profileFile, {repositoryRoot: controlRoot});
      render1 = renderAnalyzeEvidence(run1);
      outputs1 = buildStructureMapOutputs({evidence: run1, manifest: v2Manifest, sqlByQueryId});

      assert.equal(run1.runtimeValidation, 'RUNTIME_VALIDATED', 'AC02 runtime validation');
      assert.equal(run1.engine, 'postgresql');
      assert.equal(run1.coverageLedger.allComplete, true, 'AC02 coverage complete');
      const counts = {};
      for (const extract of run1.extracts) counts[extract.category] = extract.rows.length;
      assert.deepEqual(counts, {
        preflight: 1, schemas: 1, relations: 2, columns: 8, constraints: 3, dependencies: 0, indexes: 5,
      }, 'AC02 deterministic fixture counts');
      for (const state of COVERAGE_STATES) {
        assert.equal(run1.coverageLedger.stateCounts[state], state === 'SUCCEEDED' ? 7 : 0, `AC02 coverage ${state}`);
      }
      const preflight = run1.extracts.find((entry) => entry.category === 'preflight').rows[0];
      assert.equal(preflight.engine, 'postgresql');
      assert.equal(preflight.database_name, DATABASE);
      assert.match(preflight.engine_version, /^16\.\d+/, 'AC02 observed PostgreSQL 16 series');
      assert.equal(preflight.engine_version, engineVersion, 'AC02 engine version consistent with preflight');
      const indexes = run1.extracts.find((entry) => entry.category === 'indexes').rows;
      assert.equal(indexes.filter((row) => row.is_primary === true).length, 2, 'AC02 primary indexes');
      assert.equal(indexes.filter((row) => row.is_unique === true).length, 3, 'AC02 unique indexes');
      const partial = indexes.find((row) => row.index_name === PARTIAL_INDEX_NAME);
      assert.ok(partial, 'AC02 partial index present');
      assert.equal(partial.has_predicate, true, 'AC02 partial predicate flag');
      assert.equal(partial.predicate_disclosure, 'OMITTED_NO_RAW_PREDICATE', 'AC02 predicate content omitted');
      assert.ok(indexes.every((row) => row.definition_disclosure === 'OMITTED_NO_RAW_DEFINITION'), 'AC02 definition content omitted');

      // Receipt / projection agreement: the product output pipeline rebinds the same
      // source snapshot digest the analysis receipt carries.
      assert.equal(outputs1.outputManifest.sourceSnapshotSha256, run1.snapshotSha256, 'AC02 receipt/projection agreement');

      // Credential rotation: the same regular path with the rotated secret must be
      // byte-stable, proving the digest is content-bound, not credential-bound.
      const rotator = ownerClient(DATABASE);
      try {
        await rotator.query(`ALTER ROLE ${SCAN_ROLE} PASSWORD '${scanPassword2}';`);
      } finally {
        await rotator.end().catch(() => {});
      }
      process.env[PRODUCT_PASSWORD_ENV] = scanPassword2;
      run2 = await runAnalyzeProfile(profileFile, {repositoryRoot: controlRoot});
      const render2 = renderAnalyzeEvidence(run2);
      assert.equal(render2, render1, 'AC02 readback byte-stable across rotation');
      assert.equal(run2.snapshotSha256, run1.snapshotSha256, 'AC02 snapshot digest stable across rotation');

      // Genuine disk readback: persist, re-read, revalidate through the output pipeline.
      const readbackFile = path.join(runtimeDirectory, 'readback.canonical.json');
      await atomicWrite(readbackFile, render1);
      const readbackText = (await readFile(readbackFile)).toString('utf8');
      assert.equal(readbackText, render1, 'AC02 disk readback bytes');
      const readbackOutputs = buildStructureMapOutputs({evidence: JSON.parse(readbackText), manifest: v2Manifest, sqlByQueryId});
      assert.equal(readbackOutputs.outputManifest.sourceSnapshotSha256, run1.snapshotSha256, 'AC02 disk readback revalidation');

      matrix = {session, readOnlySessionSqlState, noPrivilegeSqlState, run1, run2, render1, outputs1, counts, preflight};
    } finally {
      delete process.env[PRODUCT_PASSWORD_ENV];
    }

    // AC03: the exact-profile real negative matrix (the scan role's password is the
    // rotated scanPassword2, so scanPassword1 is now the wrong secret).
    const wrongSecretSqlState = await connectFailureCode({
      host, port, user: SCAN_ROLE, password: scanPassword1, database: DATABASE,
    });
    assert.equal(wrongSecretSqlState, '28P01', 'AC03 wrong (rotated) secret');
    const deniedMetadataSqlState = await connectFailureCode({
      host, port, user: DENIED_ROLE, password: deniedPassword, database: DENIED_DATABASE,
    });
    assert.equal(deniedMetadataSqlState, '42501', 'AC03 connect-denied database');

    const timeout = await runPostgresqlControlledProbe({profile: probeProfile, password: scanPassword2, probeId: 'timeout'});
    assert.ok(timeout.elapsedMs >= 850 && timeout.elapsedMs < 2500, `AC03 timeout elapsed ${timeout.elapsedMs}`);
    const cancel = await runPostgresqlControlledProbe({profile: probeProfile, password: scanPassword2, probeId: 'cancel', abortAfterMs: 100});
    assert.ok(cancel.elapsedMs >= 50 && cancel.elapsedMs < 1500, `AC03 cancel elapsed ${cancel.elapsedMs}`);
    assert.equal(timeout.state, 'TIMEOUT', 'AC03 timeout state');
    assert.equal(timeout.sqlState, '57014', 'AC03 timeout SQLSTATE');
    assert.equal(timeout.postProbeHealthy, true, 'AC03 timeout post-probe health');
    assert.equal(timeout.activeFollowers, 0, 'AC03 timeout no followers');
    assert.equal(cancel.state, 'CANCELLED', 'AC03 cancel state');
    assert.equal(cancel.sqlState, '57014', 'AC03 cancel SQLSTATE');
    assert.equal(cancel.postProbeHealthy, true, 'AC03 cancel post-probe health');
    assert.equal(cancel.activeFollowers, 0, 'AC03 cancel no followers');
    assert.equal(timeout.poolClosed, true, 'AC03 timeout pool closed');
    assert.equal(cancel.poolClosed, true, 'AC03 cancel pool closed');

    const failClosed = sourceLocalFailClosed();
    assert.equal(failClosed.staleDescriptor, 'DB_ANALYZE_DESCRIPTOR_STALE', 'AC03 stale descriptor');
    assert.equal(failClosed.scopeSubstitution, 'DB_ANALYZE_SCOPE_OVERRIDE_DENIED', 'AC03 scope substitution');
    assert.equal(failClosed.crossEngineSecretSubstitution, 'DB_ANALYZE_SECRET_BINDING_MISMATCH', 'AC03 cross-engine secret substitution');
    assert.match(failClosed.noBroadenedDispatch.mutation.code ?? '', /^DB_QUERY_/);
    assert.equal(failClosed.noBroadenedDispatch.mutation.dispatches, 0, 'AC03 mutation dispatch');
    assert.match(failClosed.noBroadenedDispatch.rawRow.code ?? '', /^DB_QUERY_/);
    assert.equal(failClosed.noBroadenedDispatch.rawRow.dispatches, 0, 'AC03 raw-row dispatch');

    matrix = {...matrix, wrongSecretSqlState, deniedMetadataSqlState, timeout, cancel, failClosed};
  } finally {
    // Clean-room teardown always runs, on success or on assertion failure, and the
    // runner-owned runtime directory is removed on every path.
    await teardown();
    await rm(runtimeDirectory, {recursive: true, force: true});
  }

  // Reaching here means the full matrix passed. Verify the clean room is gone
  // before any evidence is written.
  await verifyCleanRoomGone();

  // Success path only: bind the narrow live certificate to what was actually tested.
  const {session, readOnlySessionSqlState, noPrivilegeSqlState, run1, render1, outputs1, counts, preflight,
    wrongSecretSqlState, deniedMetadataSqlState, timeout, cancel, failClosed} = matrix;
  const packageBytes = await readFile(path.join(repositoryRoot, 'package.json'));
  const packageManifest = JSON.parse(packageBytes.toString('utf8'));
  const descriptor = selectProductDescriptor('postgresql');
  const coverageCounts = Object.fromEntries(COVERAGE_STATES.map((state) => [state.toLowerCase(), run1.coverageLedger.stateCounts[state]]));
  const evidence = {
    schemaVersion: LIVE_EVIDENCE_SCHEMA_VERSION,
    issue: 'PG-KS-02',
    product: {
      releaseVersion: packageManifest.version,
      manifestSha256: fileSha256(packageBytes),
      productDescriptor: {
        engine: descriptor.engine,
        version: PRODUCT_DESCRIPTOR_VERSION,
        executor: descriptor.components.executor,
        capability: descriptor.components.capability,
        evidence: descriptor.components.evidence,
        secretEnv: descriptor.secret.env,
        secretFileVariable: descriptor.secret.fileVariable,
      },
      profileId: profile.profileId,
      queryPack: {version: 'v2', packVersion: v2Manifest.packVersion, manifestSha256: fileSha256(v2ManifestBytes)},
      regularPath: {dispatch: 'REGULAR', executorBinding: 'postgresql.run-queries', productSecretBindingEnforced: true},
    },
    deployment: {
      deploymentClass: 'parent-isolated-loopback-clean-room',
      host,
      port,
      engineVersion,
      majorVersion: '16',
      transport: 'loopback-only',
      ssl: false,
      auth: {secretRoute: {fileVariable: 'POSTGRESQL_PASSWORD_FILE', env: PRODUCT_PASSWORD_ENV}, valueDisclosed: false},
      databases: [DATABASE, DENIED_DATABASE],
    },
    scope: {database: DATABASE, container: null, schemas: [SCHEMA]},
    ac01: {
      state: 'VERIFIED',
      principal: {
        roleName: SCAN_ROLE,
        access: 'READ_ONLY',
        leastPrivilege: {
          superuser: false, createDatabase: false, createRole: false,
          replication: false, bypassRls: false, transactionReadOnly: true,
        },
      },
      sessionProof: {
        roleName: session.roleName,
        transactionReadOnly: session.transactionReadOnly,
        defaultTransactionReadOnly: session.defaultTransactionReadOnly,
        adminCapabilities: session.adminCapabilities,
      },
      deniedWriteProbe: {
        readOnlySessionSqlState,
        noPrivilegeSqlState,
        coercedToSuccess: false,
      },
    },
    ac02: {
      state: 'VERIFIED',
      mode: 'RUNTIME',
      dispatch: 'REGULAR',
      engine: run1.engine,
      runtimeValidation: run1.runtimeValidation,
      snapshotSha256: run1.snapshotSha256,
      readbackSha256: sha256(render1),
      readbackByteStable: true,
      diskReadbackValidated: true,
      receiptProjectionAgreement: {
        sourceSnapshotSha256Matches: true,
        projectionDigests: {
          inventorySha256: outputs1.outputManifest.artifactDigests.inventorySha256,
          relationshipsSha256: outputs1.outputManifest.artifactDigests.relationshipsSha256,
          coverageSha256: outputs1.outputManifest.artifactDigests.coverageSha256,
        },
      },
      coverage: {allComplete: true, ...coverageCounts},
      counts,
      indexEnumeration: {
        rowCount: counts.indexes,
        primaryIndexRows: 2,
        uniqueIndexRows: 3,
        partialIndex: {
          indexName: PARTIAL_INDEX_NAME,
          hasPredicate: true,
          predicateDisclosure: 'OMITTED_NO_RAW_PREDICATE',
        },
        definitionDisclosure: 'OMITTED_NO_RAW_DEFINITION',
        expressionOrPredicateContent: 'OMITTED',
      },
    },
    ac03: {
      state: 'VERIFIED',
      wrongSecret: {state: 'DENIED', sqlState: wrongSecretSqlState, coercedToSuccess: false},
      deniedMetadata: {
        state: 'DENIED',
        sqlState: deniedMetadataSqlState,
        visibility: 'INVISIBLE',
        emptyInterpretation: 'NOT_CLAIMED',
        coercedToSuccess: false,
      },
      timeout: {
        state: timeout.state,
        sqlState: timeout.sqlState,
        elapsedMs: timeout.elapsedMs,
        postProbeHealthy: timeout.postProbeHealthy,
        activeFollowers: timeout.activeFollowers,
        poolClosed: timeout.poolClosed,
      },
      cancel: {
        state: cancel.state,
        sqlState: cancel.sqlState,
        elapsedMs: cancel.elapsedMs,
        postProbeHealthy: cancel.postProbeHealthy,
        activeFollowers: cancel.activeFollowers,
        poolClosed: cancel.poolClosed,
      },
      staleDescriptor: failClosed.staleDescriptor,
      scopeSubstitution: failClosed.scopeSubstitution,
      crossEngineSecretSubstitution: failClosed.crossEngineSecretSubstitution,
      noBroadenedDispatch: {
        mutation: {code: failClosed.noBroadenedDispatch.mutation.code, dispatches: failClosed.noBroadenedDispatch.mutation.dispatches},
        rawRow: {code: failClosed.noBroadenedDispatch.rawRow.code, dispatches: failClosed.noBroadenedDispatch.rawRow.dispatches},
      },
    },
    cleanRoom: {
      databasesDropped: [DATABASE, DENIED_DATABASE],
      rolesDropped: [SCAN_ROLE, DENIED_ROLE],
      verifiedAbsent: true,
      operatorSecretFileDisclosed: false,
      runnerOwnedSecretFiles: 0,
    },
    privacy: {secretsDisclosed: false},
    nonClaims: [
      `Live matrix bound to the exact parent-isolated loopback-only deployment and the observed engine version ${engineVersion}; no production, customer-data, HA, scale, performance, extension or all-PostgreSQL-versions/auth-modes claim; C2 is out of scope.`,
      'Loopback transport runs without TLS; no production TLS behavior is claimed.',
      'Index expression/predicate content and raw index definitions remain the declared query-pack blind spot (INDEX_EXPRESSION_OR_PREDICATE_CONTENT_OMITTED); only bounded identity and flags are enumerated.',
      'This file is written only by the parent-executable runner after every assertion and the clean-room teardown verification pass; it never relabels the frozen source-local C1 certificate (verification/postgresql/postgresql-c1-evidence-v1.json).',
    ],
  };
  const evidenceJson = canonicalJson(evidence);
  const evidenceFile = path.join(repositoryRoot, 'verification', 'postgresql', 'postgresql-c1-live-matrix-v1.json');
  await atomicWrite(evidenceFile, evidenceJson);
  const humanFile = path.join(repositoryRoot, 'docs', 'evidence', 'postgresql-c1-live-matrix', 'README.md');
  const human = [
    '# PostgreSQL C1 live matrix readback (PG-KS-02)',
    '',
    `Executed by the parent live operator against the isolated loopback PostgreSQL ${engineVersion} deployment. `
      + `Disposable clean room: databases \`${DATABASE}\` and \`${DENIED_DATABASE}\`, least-privilege roles \`${SCAN_ROLE}\` / \`${DENIED_ROLE}\`; `
      + 'all dropped and verified absent after the run.',
    '',
    `AC01: role readback matched the declared least-privilege read-only principal (admin capabilities false, read-only session settings on); `
      + `the real write probe failed closed (\`25006\` under the read-only session, \`42501\` on the bare connection).`,
    '',
    `AC02: the exact-profile v2 regular Analyze-to-Readback path (buildLiveProfile v2 -> runAnalyzeProfile -> output pipeline) `
      + `returned identity, 1 schema, 2 relations, 8 columns, 3 catalog constraints (2 primary keys, 1 foreign key), 0 view dependencies and 5 bounded index rows `
      + '(2 primary, 3 unique, 1 partial with predicate content omitted by the declared blind spot). '
      + `Both credential-rotated runs are byte-identical at SHA-256 \`${run1.snapshotSha256}\`; the disk readback revalidated through the output pipeline.`,
    '',
    `AC03: wrong secret \`${wrongSecretSqlState}\`, connect-denied database \`${deniedMetadataSqlState}\` (preserved as a denial, never coerced to an empty success), `
      + `timeout \`${timeout.sqlState}\` at ${timeout.elapsedMs} ms and cancellation \`${cancel.sqlState}\` at ${cancel.elapsedMs} ms, `
      + 'both with post-probe health and zero active followers; stale descriptor, scope substitution and cross-engine secret '
      + `substitution returned the truthful codes (${failClosed.staleDescriptor}, ${failClosed.scopeSubstitution}, ${failClosed.crossEngineSecretSubstitution}) `
      + 'and no dispatch was broadened.',
    '',
    'No credentials, connection strings, raw row values or raw index definitions are reproduced here.',
    '',
  ].join('\n');
  await atomicWrite(humanFile, human);

  const artifacts = [
    (await readFile(evidenceFile)).toString('utf8'),
    (await readFile(humanFile)).toString('utf8'),
    render1,
  ].join('\n');
  const privacy = scanArtifacts(artifacts, allSecrets);
  assert.deepEqual(privacy, {secretCanaryMatches: 0, dsnMatches: 0}, 'privacy scan');
  evidence.privacy = {
    secretCanaryMatches: privacy.secretCanaryMatches,
    dsnMatches: privacy.dsnMatches,
    secretsDisclosed: false,
  };
  await atomicWrite(evidenceFile, canonicalJson(evidence));

  console.log(JSON.stringify({
    fixtureId: 'ks149-postgresql-c1-live-matrix-v1',
    engineVersion,
    ac01: 'VERIFIED',
    ac02: {snapshotSha256: run1.snapshotSha256, indexes: counts.indexes, readbackByteStable: true},
    ac03: {
      wrongSecret: wrongSecretSqlState,
      deniedMetadata: deniedMetadataSqlState,
      timeout: {state: timeout.state, sqlState: timeout.sqlState, elapsedMs: timeout.elapsedMs},
      cancel: {state: cancel.state, sqlState: cancel.sqlState, elapsedMs: cancel.elapsedMs},
    },
    privacy,
    diskReadbackValidated: true,
    cleanRoomVerifiedAbsent: true,
  }));
}

await main();