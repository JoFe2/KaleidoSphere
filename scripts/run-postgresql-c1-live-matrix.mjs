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
// It drives the REGULAR product path end to end. The AC02 positive run executes
// through the control server's own HTTP surface — POST /v1/analyze (bearer token)
// then POST /v1/readback — with the scan credential resolved through the file-secret
// route (POSTGRESQL_PASSWORD_FILE pointing at a runner-owned 0600 file, the same
// route compose.yaml wires). Inside the server that path is buildLiveProfile (exact
// v2 structure query pack, the certified C1 structure scan) -> readPostgresqlSessionProof
// (the capability gate) -> runAnalyzeProfile (descriptor-bound dispatch, product
// secret binding enforced) -> projection write -> readback.
//
//   * AC01: the verified least-privilege read-only principal connects, its role
//     readback matches the declared principal (all admin capabilities false,
//     read-only session settings on), the deployment's authentication method is
//     verified as SCRAM-SHA-256 (the stored password verifier prefix plus the first
//     matching hba rule), and a real write probe fails closed (25006 under the
//     product read-only session, 42501 on the bare least-privilege connection).
//   * AC02: the exact-profile v2 positive run through the control HTTP surface
//     returns identity, schemas, relations, columns, constraints, dependencies and
//     bounded index enumeration; the run is byte-stable across a credential
//     rotation (the file secret is rewritten and the product re-analyzes from it),
//     the product's own receipt artifact is re-read from disk and revalidated, and
//     the readback projection and the product output pipeline agree with the
//     receipt snapshot digest (receipt / projection agreement).
//   * AC03: the exact-profile negative matrix — wrong (rotated) secret; denied
//     metadata driven through the product's own live gates (the session-proof
//     capability gate and the descriptor-bound executor both fail closed with the
//     truthful 42501, never coerced to an empty success); timeout and cancellation
//     controlled probes with post-probe health and zero active followers — plus the
//     source-local dispatch/auth/scope cells (stale descriptor, scope substitution,
//     cross-engine secret substitution, no broadened dispatch).
//
// Every owner operation runs in a session that connects before use and closes on
// every path (an unconnected pg 8.x client would never settle query()). The
// disposable clean room is torn down on every path — partial provisioning included —
// and its absence is verified before any success claim; a failed run exits non-zero
// with a truthful failure receipt and writes no evidence. The runner owns no
// container, network, or volume beyond its own in-repo runtime directory.
//
// Environment contract (validated by scripts/run-postgresql-c1-live-matrix.sh):
//   KS149_PG_HOST               must be exactly 127.0.0.1 (loopback-only)
//   KS149_PG_PORT               port of the running isolated PostgreSQL 16.x
//   KS149_PG_OWNER_USER         provisioning role (default: postgres)
//   KS149_PG_ADMIN_DATABASE     database the owner role connects to (default: postgres)
//   KS149_PG_OWNER_PASSWORD_FILE  mode-0600 file holding the owner password
//
// Secrets travel only as file paths; the product-bound credential reference
// (CM_POSTGRESQL_PASSWORD) is set only by the control server from the file secret,
// and the runner's own transient copy (denied-metadata executor cell) is deleted
// before the matrix proceeds. The operator's password file is read once and never
// copied, written, or disclosed.

import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdir, mkdtemp, open, readFile, rename, rm, stat, writeFile} from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

import {COVERAGE_STATES, canonicalJson, sha256, validateQueryManifest} from '../services/bi-control/src/db-analyzer/core.mjs';
import {buildPostgresqlConnectionOptions, compilePostgresqlProfileQuery} from '../services/bi-control/src/db-analyzer/postgresql-adapter.mjs';
import {readPostgresqlSessionProof, runPostgresqlControlledProbe} from '../services/bi-control/src/db-analyzer/postgresql-runtime.mjs';
import {auditCatalogQuery} from '../services/bi-control/src/db-analyzer/query-safety.mjs';
import {buildStructureMapOutputs} from '../services/bi-control/src/db-analyzer/outputs.mjs';
import {runAnalyzeProfile} from '../services/bi-control/src/db-analyzer/workflow.mjs';
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
const SCRAM_VERIFIER_PREFIX = 'SCRAM-SHA-256$';

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

const liveProfileFor = (host, port, queryTimeoutMs, {database = DATABASE, user = SCAN_ROLE} = {}) => buildLiveProfile({
  BI_ENGINE: 'postgresql',
  POSTGRESQL_HOST: host,
  POSTGRESQL_PORT: String(port),
  POSTGRESQL_DATABASE: database,
  POSTGRESQL_USER: user,
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

const freeLoopbackPort = () => new Promise((resolvePort, rejectPort) => {
  const probe = net.createServer();
  probe.once('error', rejectPort);
  probe.listen(0, '127.0.0.1', () => {
    const address = probe.address();
    probe.close(() => resolvePort(address.port));
  });
});

// Spawns the regular product control server as a child process on a free loopback
// port. The scan credential is resolved through the file-secret route exactly as the
// regular deployment wires it; the runner owns no container, network, or volume.
async function startControlServer({runtimeDirectory, host, pgPort, passwordFile}) {
  const controlToken = randomBytes(24).toString('hex');
  const tokenFile = path.join(runtimeDirectory, 'control-token');
  await atomicWrite(tokenFile, controlToken);
  const controlPort = await freeLoopbackPort();
  const receiptDir = path.join(runtimeDirectory, 'control-receipts');
  const projectionDb = path.join(runtimeDirectory, 'control-projection', 'analytics.db');
  const child = spawn(process.execPath, [path.join(controlRoot, 'src', 'server.mjs')], {
    cwd: controlRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      PORT: String(controlPort),
      RECEIPT_DIR: receiptDir,
      PROJECTION_DB: projectionDb,
      REPOSITORY_ROOT: controlRoot,
      BI_ENGINE: 'postgresql',
      BI_SOURCE_MODE: 'live',
      POSTGRESQL_HOST: host,
      POSTGRESQL_PORT: String(pgPort),
      POSTGRESQL_DATABASE: DATABASE,
      POSTGRESQL_USER: SCAN_ROLE,
      POSTGRESQL_SCHEMAS: SCHEMA,
      POSTGRESQL_SSL: 'false',
      POSTGRESQL_CONNECT_TIMEOUT_MS: '5000',
      POSTGRESQL_QUERY_TIMEOUT_MS: '5000',
      POSTGRESQL_STRUCTURE_QUERY_PACK: 'v2',
      POSTGRESQL_PASSWORD_FILE: passwordFile,
      CONTROL_TOKEN_FILE: tokenFile,
    },
  });
  let diagnostics = '';
  child.stderr.on('data', (chunk) => { diagnostics += chunk.toString('utf8'); });
  const url = `http://127.0.0.1:${controlPort}`;
  const deadline = Date.now() + 20000;
  let healthy = false;
  for (;;) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`${url}/healthz`, {signal: AbortSignal.timeout(500)});
      if (response.ok) { healthy = true; break; }
    } catch { /* the server is still starting */ }
    if (Date.now() > deadline) break;
    await new Promise((resolveWait) => { setTimeout(resolveWait, 100); });
  }
  if (!healthy) {
    child.kill('SIGKILL');
    throw new Error(`KS149_CONTROL_SERVER_UNAVAILABLE:${diagnostics.slice(-400) || 'no diagnostics'}`);
  }
  const stop = async () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([
        new Promise((resolveExit) => { child.once('exit', resolveExit); }),
        new Promise((resolveExit) => {
          const timer = setTimeout(() => { child.kill('SIGKILL'); resolveExit(); }, 5000);
          timer.unref();
        }),
      ]);
    }
  };
  return {url, token: controlToken, receiptDir, projectionDb, stop};
}

// A regular-product control action over HTTP with the bearer token.
async function postControlAction(control, endpoint, action) {
  const response = await fetch(`${control.url}${endpoint}`, {
    method: 'POST',
    headers: {'content-type': 'application/json', authorization: `Bearer ${control.token}`},
    body: JSON.stringify({action}),
    signal: AbortSignal.timeout(120000),
  });
  const body = await response.json().catch(() => ({}));
  return {status: response.status, body};
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
  try {
    const scanPassword1 = canary('KS149_SCAN1_');
    const scanPassword2 = canary('KS149_SCAN2_');
    const deniedPassword = canary('KS149_DENIED_');
    safePassword(scanPassword1); safePassword(scanPassword2); safePassword(deniedPassword);
    const allSecrets = [ownerPassword, scanPassword1, scanPassword2, deniedPassword];

    // Every owner operation runs inside a session that connected before use and is
    // closed on every path; an unconnected client would never settle query().
    const ownerSession = async (database, work) => {
      const client = new Client({
        host, port, user: ownerUser, password: ownerPassword, database, ssl: false,
        application_name: 'kaleidosphere-ks149-provisioner',
      });
      let connected = false;
      try {
        await client.connect();
        connected = true;
        return await work(client);
      } finally {
        if (connected) await client.end().catch(() => {});
      }
    };
    const ownerStatements = (database) => [
      `SELECT pg_catalog.pg_terminate_backend(pid) FROM pg_catalog.pg_stat_activity WHERE datname = '${database}';`,
      `DROP DATABASE IF EXISTS ${database};`,
    ];

    // Fail fast: the target must really be a PostgreSQL 16.x server.
    const engineVersion = await ownerSession(adminDatabase, async (owner) => {
      const response = await owner.query(`SELECT current_setting('server_version') AS engine_version;`);
      return response.rows[0].engine_version;
    });
    assert.match(engineVersion, /^16\.\d+/, 'KS149 target must be PostgreSQL 16.x');

    const profile = liveProfileFor(host, port, 5000);
    assert.equal(profile.queryPack.version, 'v2');
    assert.equal(profile.policy.catalogScan.allowedQueryIds.length, 7);
    assert.ok(profile.policy.catalogScan.allowedQueryIds.includes('postgresql.structure.indexes'));
    const probeProfile = liveProfileFor(host, port, 1000);
    const deniedProfile = liveProfileFor(host, port, 5000, {database: DENIED_DATABASE, user: DENIED_ROLE});
    const profileFile = path.join(runtimeDirectory, 'live-profile.json');
    await atomicWrite(profileFile, canonicalJson(profile));
    const deniedProfileFile = path.join(runtimeDirectory, 'denied-profile.json');
    await atomicWrite(deniedProfileFile, canonicalJson(deniedProfile));

    const v2PackDirectory = path.join(controlRoot, 'query-packs', 'db-analyzer', 'v2', 'postgresql');
    const v2ManifestBytes = await readFile(path.join(v2PackDirectory, 'manifest.json'));
    const v2Manifest = validateQueryManifest(JSON.parse(v2ManifestBytes.toString('utf8')));
    const sqlByQueryId = Object.fromEntries(await Promise.all(v2Manifest.queries.map(async (query) => [
      query.id, await readFile(path.join(v2PackDirectory, query.file), 'utf8'),
    ])));

    const teardown = async () => {
      await ownerSession(adminDatabase, async (owner) => {
        for (const statement of [...ownerStatements(DATABASE), ...ownerStatements(DENIED_DATABASE)]) await owner.query(statement);
        await owner.query(`DROP ROLE IF EXISTS ${SCAN_ROLE};`);
        await owner.query(`DROP ROLE IF EXISTS ${DENIED_ROLE};`);
      });
    };
    const verifyCleanRoomGone = async () => {
      await ownerSession(adminDatabase, async (owner) => {
        const databaseNames = [DATABASE, DENIED_DATABASE].map((name) => `'${name}'`).join(', ');
        const roleNames = [SCAN_ROLE, DENIED_ROLE].map((name) => `'${name}'`).join(', ');
        const databases = (await owner.query(
          `SELECT count(*)::integer AS n FROM pg_catalog.pg_database WHERE datname IN (${databaseNames});`)).rows[0].n;
        const roles = (await owner.query(
          `SELECT count(*)::integer AS n FROM pg_catalog.pg_roles WHERE rolname IN (${roleNames});`)).rows[0].n;
        assert.equal(databases, 0, 'KS149 clean-room databases dropped');
        assert.equal(roles, 0, 'KS149 clean-room roles dropped');
      });
    };

    let matrixError = null;
    let matrix;
    try {
      // Provision the disposable clean room on the operator's server.
      await ownerSession(adminDatabase, async (owner) => {
        for (const statement of [...ownerStatements(DATABASE), ...ownerStatements(DENIED_DATABASE)]) await owner.query(statement);
        await owner.query(`CREATE DATABASE ${DATABASE};`);
        await owner.query(`CREATE DATABASE ${DENIED_DATABASE};`);
        // The denied database must be connect-denied: revoke the PUBLIC default and
        // grant nothing, so the metadata there is invisible to every non-owner role.
        await owner.query(`REVOKE CONNECT ON DATABASE ${DENIED_DATABASE} FROM PUBLIC;`);
      });
      await ownerSession(DATABASE, async (owner) => {
        await owner.query(`DROP ROLE IF EXISTS ${SCAN_ROLE};`);
        await owner.query(`DROP ROLE IF EXISTS ${DENIED_ROLE};`);
        await owner.query(`CREATE ROLE ${SCAN_ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;`);
        await owner.query(`CREATE ROLE ${DENIED_ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;`);
        await owner.query(`ALTER ROLE ${SCAN_ROLE} PASSWORD '${scanPassword1}';`);
        await owner.query(`ALTER ROLE ${DENIED_ROLE} PASSWORD '${deniedPassword}';`);
        await owner.query(`
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
        await owner.query(`GRANT USAGE ON SCHEMA ${SCHEMA} TO ${SCAN_ROLE};`);
        await owner.query(`GRANT SELECT ON ALL TABLES IN SCHEMA ${SCHEMA} TO ${SCAN_ROLE};`);
      });

      // AC01: the deployment authenticates with SCRAM-SHA-256 (the authorized auth
      // method) — the scan principal's stored verifier and the first hba rule that
      // can authorize it must both say so.
      const scram = await ownerSession(adminDatabase, async (owner) => {
        const verifier = (await owner.query(
          `SELECT left(rolpassword, ${SCRAM_VERIFIER_PREFIX.length}) AS prefix FROM pg_catalog.pg_authid WHERE rolname = $1;`,
          [SCAN_ROLE],
        )).rows[0]?.prefix ?? null;
        const rules = (await owner.query(`
SELECT line_number, auth_method FROM pg_catalog.pg_hba_file_rules
WHERE type IN ('host', 'hostssl', 'hostnossl')
  AND (database @> ARRAY['${DATABASE}'] OR database @> ARRAY['all'])
  AND (user_name @> ARRAY['${SCAN_ROLE}'] OR user_name @> ARRAY['all'])
ORDER BY line_number;`)).rows;
        return {verifier, firstAuthMethod: rules[0]?.auth_method ?? null,
          scramRuleCount: rules.filter((rule) => rule.auth_method === 'scram-sha-256').length};
      });
      assert.equal(scram.verifier, SCRAM_VERIFIER_PREFIX, 'AC01 SCRAM-SHA-256 verifier stored for the scan principal');
      assert.equal(scram.firstAuthMethod, 'scram-sha-256', 'AC01 first matching hba rule is SCRAM-SHA-256');
      assert.ok(scram.scramRuleCount >= 1, 'AC01 SCRAM-SHA-256 hba rule present');

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

      // AC02: the exact-profile v2 regular Analyze-to-Readback path through the
      // control server's HTTP surface, the credential resolved through the
      // file-secret route (POSTGRESQL_PASSWORD_FILE) exactly as the regular
      // deployment wires it.
      const scanPasswordFile = path.join(runtimeDirectory, 'scan-password');
      await atomicWrite(scanPasswordFile, scanPassword1);
      const control = await startControlServer({runtimeDirectory, host, pgPort: port, passwordFile: scanPasswordFile});
      allSecrets.push(control.token);
      let receipt;
      let rotatedAnalysis;
      let readback;
      let outputs1;
      let diskOutputs;
      let counts;
      let preflight;
      try {
        const analyze1 = await postControlAction(control, '/v1/analyze', 'analyze');
        assert.equal(analyze1.status, 200, 'AC02 /v1/analyze accepted');
        receipt = analyze1.body;
        const run1 = receipt.analysis;
        assert.equal(receipt.status, 'ANALYZED_READ_ONLY', 'AC02 receipt status');
        assert.equal(receipt.sourceMode, 'live', 'AC02 live source mode');
        assert.equal(receipt.engine, 'postgresql', 'AC02 receipt engine');
        assert.equal(run1.runtimeValidation, 'RUNTIME_VALIDATED', 'AC02 runtime validation');
        assert.equal(run1.engine, 'postgresql');
        assert.equal(run1.coverageLedger.allComplete, true, 'AC02 coverage complete');
        counts = {};
        for (const extract of run1.extracts) counts[extract.category] = extract.rows.length;
        assert.deepEqual(counts, {
          preflight: 1, schemas: 1, relations: 2, columns: 8, constraints: 3, dependencies: 0, indexes: 5,
        }, 'AC02 deterministic fixture counts');
        for (const state of COVERAGE_STATES) {
          assert.equal(run1.coverageLedger.stateCounts[state], state === 'SUCCEEDED' ? 7 : 0, `AC02 coverage ${state}`);
        }
        preflight = run1.extracts.find((entry) => entry.category === 'preflight').rows[0];
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

        // The control surface enforces its bearer auth: the same call without a
        // token fails closed with the truthful denial code.
        const unauthenticated = await fetch(`${control.url}/v1/analyze`, {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({action: 'analyze'}),
          signal: AbortSignal.timeout(10000),
        });
        assert.equal(unauthenticated.status, 401, 'AC02 control bearer auth enforced');
        const unauthenticatedBody = await unauthenticated.json().catch(() => ({}));
        assert.equal(unauthenticatedBody.code, 'CONTROL_AUTH_DENIED', 'AC02 truthful auth denial code');

        // Credential rotation through the file-secret route: the role password and
        // the file the product reads are both rewritten, and the same regular path
        // must be byte-stable, proving the digest is content-bound, not
        // credential-bound.
        await ownerSession(DATABASE, (owner) => owner.query(`ALTER ROLE ${SCAN_ROLE} PASSWORD '${scanPassword2}';`));
        await atomicWrite(scanPasswordFile, scanPassword2);
        const analyze2 = await postControlAction(control, '/v1/analyze', 'analyze');
        assert.equal(analyze2.status, 200, 'AC02 /v1/analyze after rotation');
        rotatedAnalysis = analyze2.body.analysis;
        assert.equal(canonicalJson(rotatedAnalysis), canonicalJson(run1), 'AC02 readback byte-stable across rotation');
        assert.equal(rotatedAnalysis.snapshotSha256, run1.snapshotSha256, 'AC02 snapshot digest stable across rotation');

        // Genuine disk readback: the product's own receipt artifact, re-read from
        // disk and revalidated through the product output pipeline.
        const diskReceipt = JSON.parse((await readFile(path.join(control.receiptDir, 'latest.json'), 'utf8')));
        assert.equal(diskReceipt.receiptId, receipt.receiptId, 'AC02 disk receipt readback identity');
        assert.equal(diskReceipt.analysis.snapshotSha256, run1.snapshotSha256, 'AC02 disk receipt readback digest');
        readback = await postControlAction(control, '/v1/readback', 'readback');
        assert.equal(readback.status, 200, 'AC02 /v1/readback accepted');
        assert.equal(readback.body.receiptId, receipt.receiptId, 'AC02 readback receipt identity');
        assert.equal(readback.body.summary.snapshot_sha256, run1.snapshotSha256, 'AC02 projection agrees with the receipt snapshot');
        assert.equal(readback.body.summary.relation_count, counts.relations, 'AC02 projection relation count');
        assert.equal(readback.body.summary.column_count, counts.columns, 'AC02 projection column count');
        assert.equal(readback.body.summary.constraint_count, counts.constraints, 'AC02 projection constraint count');
        assert.equal(readback.body.summary.index_count, counts.indexes, 'AC02 projection index count');
        assert.equal(readback.body.detailCount, counts.columns, 'AC02 projection detail row count');
        assert.equal(readback.body.catalogSnapshot?.receipt_id, receipt.receiptId, 'AC02 catalog readback agrees with the receipt');
        assert.equal(readback.body.catalogSnapshot?.snapshot_sha256, run1.snapshotSha256, 'AC02 catalog snapshot digest agrees');

        // Receipt / projection agreement: the product output pipeline rebinds the
        // same source snapshot digest the analysis receipt carries.
        outputs1 = buildStructureMapOutputs({evidence: run1, manifest: v2Manifest, sqlByQueryId});
        assert.equal(outputs1.outputManifest.sourceSnapshotSha256, run1.snapshotSha256, 'AC02 receipt/projection agreement');
        diskOutputs = buildStructureMapOutputs({evidence: diskReceipt.analysis, manifest: v2Manifest, sqlByQueryId});
        assert.equal(diskOutputs.outputManifest.sourceSnapshotSha256, run1.snapshotSha256, 'AC02 disk readback revalidation');
      } finally {
        await control.stop();
      }

      // AC03: the exact-profile real negative matrix (the scan role's password is
      // now the rotated scanPassword2, so scanPassword1 is the wrong secret).
      const wrongSecretSqlState = await connectFailureCode({
        host, port, user: SCAN_ROLE, password: scanPassword1, database: DATABASE,
      });
      assert.equal(wrongSecretSqlState, '28P01', 'AC03 wrong (rotated) secret');

      // Denied metadata through the product's own live gates: the session-proof
      // capability gate and the descriptor-bound executor both must fail closed
      // with the truthful SQLSTATE — the denial is never coerced into an empty
      // success.
      let deniedSessionCode;
      try {
        await readPostgresqlSessionProof({profile: deniedProfile, password: deniedPassword});
        deniedSessionCode = 'NO_ERROR';
      } catch (error) {
        deniedSessionCode = error?.code ?? String(error?.message ?? error);
      }
      assert.equal(deniedSessionCode, '42501', 'AC03 denied metadata through the product session-proof gate');
      process.env[PRODUCT_PASSWORD_ENV] = deniedPassword;
      let deniedExecutorCode;
      try {
        await runAnalyzeProfile(deniedProfileFile, {repositoryRoot: controlRoot});
        deniedExecutorCode = 'NO_ERROR';
      } catch (error) {
        deniedExecutorCode = error?.code ?? String(error?.message ?? error);
      } finally {
        delete process.env[PRODUCT_PASSWORD_ENV];
      }
      assert.equal(deniedExecutorCode, '42501', 'AC03 denied metadata through the regular executor dispatch');

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

      matrix = {
        session, scram, readOnlySessionSqlState, noPrivilegeSqlState,
        receipt, rotatedAnalysis, readback, outputs1, diskOutputs, counts, preflight,
        wrongSecretSqlState, deniedSessionCode, deniedExecutorCode,
        timeout, cancel, failClosed,
      };
    } catch (error) {
      matrixError = error;
    }

    // The clean room is torn down on every path (partial provisioning included) and
    // its absence is verified before any success claim; the truth of the residue is
    // reported either way.
    let cleanupError = null;
    try {
      await teardown();
      await verifyCleanRoomGone();
    } catch (error) {
      cleanupError = error;
    }
    if (matrixError || cleanupError) {
      console.error(JSON.stringify({
        fixtureId: 'ks149-postgresql-c1-live-matrix-v1',
        status: 'FAILED',
        code: matrixError?.code ?? cleanupError?.code ?? 'KS149_LIVE_MATRIX_FAILED',
        cleanRoom: cleanupError === null
          ? {teardown: 'PASSED', verifiedAbsent: true}
          : {teardown: 'FAILED', verifiedAbsent: false},
      }));
      throw matrixError ?? cleanupError;
    }

    // Success path only: bind the narrow live certificate to what was actually
    // tested. Reaching here means the clean room was torn down and verified absent
    // above.
    const {session, scram, readOnlySessionSqlState, noPrivilegeSqlState,
      receipt, rotatedAnalysis, readback, outputs1, diskOutputs, counts, preflight,
      wrongSecretSqlState, deniedSessionCode, deniedExecutorCode,
      timeout, cancel, failClosed} = matrix;
    const run1 = receipt.analysis;
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
        auth: {
          mechanism: 'scram-sha-256',
          scramVerified: {verifierPrefix: SCRAM_VERIFIER_PREFIX, hbaFirstMatch: scram.firstAuthMethod},
          secretRoute: {fileVariable: 'POSTGRESQL_PASSWORD_FILE', env: PRODUCT_PASSWORD_ENV},
          valueDisclosed: false,
        },
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
        scram: {
          mechanism: 'scram-sha-256',
          verifierPrefix: SCRAM_VERIFIER_PREFIX,
          hbaFirstMatch: scram.firstAuthMethod,
          verified: true,
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
        productSurface: {
          controlServer: 'services/bi-control/src/server.mjs',
          analyzeEndpoint: '/v1/analyze',
          readbackEndpoint: '/v1/readback',
          bearerAuth: {enforced: true, denialCode: 'CONTROL_AUTH_DENIED'},
          secretRoute: {fileVariable: 'POSTGRESQL_PASSWORD_FILE', fileOwnedBy: 'runner', fileMode: 0o600},
        },
        engine: run1.engine,
        runtimeValidation: run1.runtimeValidation,
        receiptId: receipt.receiptId,
        receiptStatus: receipt.status,
        sourceMode: receipt.sourceMode,
        snapshotSha256: run1.snapshotSha256,
        readbackSha256: sha256(canonicalJson(run1)),
        readbackByteStable: true,
        rotationSecretRoute: 'file-secret rewrite (POSTGRESQL_PASSWORD_FILE)',
        diskReadbackValidated: true,
        receiptProjectionAgreement: {
          projectionSummarySnapshotSha256Matches: true,
          projectionCounts: {
            relation: readback.body.summary.relation_count,
            column: readback.body.summary.column_count,
            constraint: readback.body.summary.constraint_count,
            index: readback.body.summary.index_count,
          },
          projectionDetailRowCount: readback.body.detailCount,
          catalogSnapshotAgrees: true,
          outputPipeline: {
            sourceSnapshotSha256Matches: true,
            diskReadbackSourceSnapshotSha256Matches: true,
            projectionDigests: {
              inventorySha256: outputs1.outputManifest.artifactDigests.inventorySha256,
              relationshipsSha256: outputs1.outputManifest.artifactDigests.relationshipsSha256,
              coverageSha256: outputs1.outputManifest.artifactDigests.coverageSha256,
            },
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
          regularPath: {
            sessionProofGate: deniedSessionCode,
            executorDispatch: deniedExecutorCode,
          },
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
        `Live matrix bound to the exact parent-isolated loopback-only deployment and the observed engine version ${engineVersion}; no production, customer-data, HA, scale, performance, extension or all-PostgreSQL-versions claim; C2 is out of scope.`,
        'Loopback transport runs without TLS; no production TLS behavior is claimed.',
        'Index expression/predicate content and raw index definitions remain the declared query-pack blind spot (INDEX_EXPRESSION_OR_PREDICATE_CONTENT_OMITTED); only bounded identity and flags are enumerated.',
        `The AC02 positive run executed through the control server HTTP surface (POST /v1/analyze then POST /v1/readback) with the bearer token and the file-secret credential route; the runner spawned the server as a child process and removed every runner-owned file (the runtime directory) on every path.`,
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
        + `the deployment's authentication method was verified as SCRAM-SHA-256 (stored verifier prefix \`${SCRAM_VERIFIER_PREFIX}\` `
        + `and first matching hba rule \`${scram.firstAuthMethod}\`); `
        + `the real write probe failed closed (\`25006\` under the read-only session, \`42501\` on the bare connection).`,
      '',
      `AC02: the exact-profile v2 regular Analyze-to-Readback path through the control HTTP surface `
        + '(POST /v1/analyze with the bearer token, then POST /v1/readback; credential resolved through the file-secret route) '
        + `returned identity, 1 schema, 2 relations, 8 columns, 3 catalog constraints (2 primary keys, 1 foreign key), 0 view dependencies and 5 bounded index rows `
        + '(2 primary, 3 unique, 1 partial with predicate content omitted by the declared blind spot). '
        + `After the credential rotation (file secret rewritten) the same path was byte-identical at SHA-256 \`${run1.snapshotSha256}\`; `
        + `the product receipt artifact was re-read from disk, the readback projection and the catalog snapshot agreed with the receipt, `
        + 'and the output pipeline revalidated the same source snapshot digest.',
      '',
      `AC03: wrong secret \`${wrongSecretSqlState}\`; denied metadata driven through the product's own live gates — `
        + `the session-proof capability gate and the regular executor dispatch both failed closed with the truthful \`${deniedSessionCode}\`, `
        + 'never coerced to an empty success (INVISIBLE / NOT_CLAIMED); '
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
      canonicalJson(run1),
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
      authMechanism: 'scram-sha-256',
      productSurface: 'control-http',
      ac01: 'VERIFIED',
      ac02: {snapshotSha256: run1.snapshotSha256, indexes: counts.indexes, readbackByteStable: true},
      ac03: {
        wrongSecret: wrongSecretSqlState,
        deniedMetadata: {sessionProofGate: deniedSessionCode, executorDispatch: deniedExecutorCode},
        timeout: {state: timeout.state, sqlState: timeout.sqlState, elapsedMs: timeout.elapsedMs},
        cancel: {state: cancel.state, sqlState: cancel.sqlState, elapsedMs: cancel.elapsedMs},
      },
      privacy,
      diskReadbackValidated: true,
      cleanRoomVerifiedAbsent: true,
    }));
  } finally {
    await rm(runtimeDirectory, {recursive: true, force: true}).catch(() => {});
  }
}

await main();