import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  PRODUCT_DESCRIPTOR,
  PRODUCT_DESCRIPTOR_VERSION,
  assertProductSecretBinding,
  buildLiveProfile,
  selectProductDescriptor,
} from '../services/bi-control/src/runtime-config.mjs';
import { buildPreflightEvidence } from '../services/bi-control/src/db-analyzer/core.mjs';
import { runAnalyzeProfile } from '../services/bi-control/src/db-analyzer/workflow.mjs';

// A synthetic secret value that must never appear in the descriptor, a selection, or a
// profile. Secrets are file-derived at runtime; the descriptor carries only reference
// names (an env var name and a file-var name), never a value.
const SECRET_CANARY = 'canary-secret-value-9f3a71';

// Exact, engine-specific selection expected from the frozen versioned descriptor.
const expectedByEngine = {
  mssql: {
    engine: 'mssql',
    components: {
      transport: 'mssql.pool-connect',
      metadata: 'mssql.runtime-scope-normalize',
      executor: 'mssql.run-queries',
      capability: 'mssql.read-only-principal',
      evidence: 'preflight.coverage-ledger',
    },
    secret: {fileVariable: 'MSSQL_PASSWORD_FILE', env: 'CM_MSSQL_PASSWORD'},
  },
  oracle: {
    engine: 'oracle',
    components: {
      transport: 'oracle.connect-string',
      metadata: 'oracle.scoped-query',
      executor: 'oracle.run-queries',
      capability: 'oracle.read-only-capabilities',
      evidence: 'preflight.coverage-ledger',
    },
    secret: {fileVariable: 'ORACLE_PASSWORD_FILE', env: 'CM_ORACLE_PASSWORD'},
  },
  postgresql: {
    engine: 'postgresql',
    components: {
      transport: 'postgresql.connection-options',
      metadata: 'postgresql.scoped-query',
      executor: 'postgresql.run-queries',
      capability: 'postgresql.read-only-session',
      evidence: 'preflight.coverage-ledger',
    },
    secret: {fileVariable: 'POSTGRESQL_PASSWORD_FILE', env: 'CM_POSTGRESQL_PASSWORD'},
  },
};

// Asserts that `fn` throws an Error whose `.code` equals `code`. Uses a manual catch so the
// expectation is unambiguous under every Node assert.throws validator contract.
const throwsWithCode = (fn, code, message) => {
  let threw = false;
  try {
    fn();
  } catch (error) {
    threw = true;
    assert.equal(error.code, code, message);
  }
  assert.ok(threw, `expected ${code}: ${message}`);
};

test('the versioned descriptor selects exact transport, metadata, executor, capability, evidence, and file-secret bindings deterministically', () => {
  assert.equal(PRODUCT_DESCRIPTOR_VERSION, 'v1');
  assert.equal(PRODUCT_DESCRIPTOR.schemaVersion, 'chimpmaera.db/product-descriptor/v1');
  assert.equal(PRODUCT_DESCRIPTOR.version, PRODUCT_DESCRIPTOR_VERSION);
  assert.deepEqual(Object.keys(PRODUCT_DESCRIPTOR.engines).sort(), ['mssql', 'oracle', 'postgresql']);
  for (const engine of ['mssql', 'oracle', 'postgresql']) {
    const selected = selectProductDescriptor(engine);
    assert.deepEqual(selected, expectedByEngine[engine], `${engine} descriptor selection`);
    assert.deepEqual(selectProductDescriptor(engine), selected, `${engine} descriptor selection is deterministic`);
    // Reference-only secret route: an env var name and a file-var name, never a value.
    assert.match(selected.secret.env, /^CM_[A-Z0-9_]+_PASSWORD$/);
    assert.match(selected.secret.fileVariable, /^[A-Z0-9_]+_PASSWORD_FILE$/);
    // The selection is the frozen table entry; it cannot be mutated in place.
    assert.throws(() => { selected.components.transport = 'x'; }, TypeError, `${engine} descriptor is immutable`);
  }
});

test('omitted and unknown engines fail closed', () => {
  for (const engine of [undefined, null, '', 'postgres', 'mysql', 'ORACLE', 'postgresql ', 42]) {
    throwsWithCode(() => selectProductDescriptor(engine), 'DB_ANALYZE_DESCRIPTOR_ENGINE_UNKNOWN', `engine=${JSON.stringify(engine)}`);
  }
});

test('stale descriptor versions fail closed', () => {
  for (const version of ['v0', 'v2', 'v1.0', '']) {
    throwsWithCode(() => selectProductDescriptor('postgresql', {version}), 'DB_ANALYZE_DESCRIPTOR_STALE', `version=${JSON.stringify(version)}`);
  }
  // A current version still selects exactly.
  assert.equal(selectProductDescriptor('postgresql', {version: 'v1'}).engine, 'postgresql');
});

test('cross-engine credential substitution and mismatched bindings fail closed', () => {
  const postgresql = selectProductDescriptor('postgresql');
  const mssql = selectProductDescriptor('mssql');
  const oracle = selectProductDescriptor('oracle');
  // A correct engine-specific binding passes.
  assert.doesNotThrow(() => assertProductSecretBinding(postgresql, 'CM_POSTGRESQL_PASSWORD'));
  // Cross-engine substitution (this engine's descriptor, another engine's reference) fails closed.
  throwsWithCode(() => assertProductSecretBinding(postgresql, 'CM_ORACLE_PASSWORD'), 'DB_ANALYZE_SECRET_BINDING_MISMATCH', 'postgresql <- oracle ref');
  throwsWithCode(() => assertProductSecretBinding(mssql, 'CM_POSTGRESQL_PASSWORD'), 'DB_ANALYZE_SECRET_BINDING_MISMATCH', 'mssql <- postgresql ref');
  throwsWithCode(() => assertProductSecretBinding(oracle, 'CM_MSSQL_PASSWORD'), 'DB_ANALYZE_SECRET_BINDING_MISMATCH', 'oracle <- mssql ref');
  // A malformed (non-string) credential reference fails closed.
  throwsWithCode(() => assertProductSecretBinding(postgresql, 42), 'DB_ANALYZE_SECRET_BINDING_MISMATCH', 'non-string reference');
  // A profile without a credential reference (e.g. a SYNTHETIC fixture) is left untouched.
  assert.doesNotThrow(() => assertProductSecretBinding(postgresql, undefined));
});

test('the descriptor and its selection are credential-free (no secret value / canary)', () => {
  const descriptorBytes = JSON.stringify(PRODUCT_DESCRIPTOR);
  assert.ok(!descriptorBytes.includes(SECRET_CANARY), 'descriptor carries no secret value');
  for (const engine of ['mssql', 'oracle', 'postgresql']) {
    assert.ok(!JSON.stringify(selectProductDescriptor(engine)).includes(SECRET_CANARY), `${engine} selection carries no secret value`);
  }
  // A profile built from a configured engine carries only the credential reference,
  // never the file-derived value, even when the value is present in the environment.
  process.env.CM_POSTGRESQL_PASSWORD = SECRET_CANARY;
  try {
    const profile = buildLiveProfile({
      BI_ENGINE: 'postgresql', POSTGRESQL_HOST: 'postgres-test', POSTGRESQL_DATABASE: 'kaleidosphere',
      POSTGRESQL_USER: 'bi_analyze', POSTGRESQL_SCHEMAS: 'public', POSTGRESQL_SSL: 'true',
    }, 'CM_POSTGRESQL_PASSWORD');
    assert.equal(profile.adapter.passwordEnv, 'CM_POSTGRESQL_PASSWORD');
    assert.ok(!JSON.stringify(profile).includes(SECRET_CANARY), 'profile is credential-reference-only');
  } finally {
    delete process.env.CM_POSTGRESQL_PASSWORD;
  }
});

test('denied/failed metadata is preserved and never coerced to a successful empty fact', async () => {
  const packDirectory = 'services/bi-control/query-packs/db-analyzer/v1/postgresql';
  const fixtureDirectory = 'services/bi-control/fixtures';
  const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
  const [manifest, profile, incomplete] = await Promise.all([
    readJson(`${packDirectory}/manifest.json`),
    readJson(`${fixtureDirectory}/postgresql-structure-profile-v1.json`),
    readJson(`${fixtureDirectory}/postgresql-structure-results-incomplete-v1.json`),
  ]);
  const sqlByQueryId = Object.fromEntries(await Promise.all(manifest.queries
    .map(async (query) => [query.id, await readFile(`${packDirectory}/${query.file}`, 'utf8')])));
  const profileContext = {profileId: profile.profileId, mode: profile.mode, scope: profile.scope, policy: profile.policy, adapter: profile.adapter.kind};
  const evidence = buildPreflightEvidence({manifest, sqlByQueryId, resultSets: incomplete, profileContext});

  const denied = evidence.extracts.find((entry) => entry.queryId === 'postgresql.structure.dependencies');
  // The denial is preserved as DENIED / INVISIBLE, not coerced to SUCCEEDED + VERIFIED_EMPTY.
  assert.equal(denied.state, 'DENIED');
  assert.notEqual(denied.state, 'SUCCEEDED');
  assert.equal(denied.visibility, 'INVISIBLE');
  assert.equal(denied.emptyInterpretation, 'NOT_CLAIMED');
  assert.notEqual(denied.emptyInterpretation, 'VERIFIED_EMPTY');
  assert.equal(denied.rows.length, 0);
  assert.ok(evidence.coverage.DENIED >= 1);
  assert.ok(evidence.blindSpots.some((blindSpot) => blindSpot.queryId === 'postgresql.structure.dependencies' && blindSpot.coverageState === 'DENIED'));

  // The distinction holds within the same evidence: a successful query is visible-complete
  // while the denied one is invisible — observed absence and denial are not conflated.
  const succeeded = evidence.extracts.find((entry) => entry.queryId === 'postgresql.preflight.identity');
  assert.equal(succeeded.state, 'SUCCEEDED');
  assert.equal(succeeded.visibility, 'VISIBLE_COMPLETE');
});

// Numeric SQLSTATE reason codes (42501, 57014) are the truthful denial/timeout codes the
// pinned pg 8.x driver produces on real connection and query failures. The coverage
// ledger must preserve them instead of failing closed on the shape of the code.
test('denied, timeout and error results preserve numeric SQLSTATE reason codes in the coverage ledger', async () => {
  const packDirectory = 'services/bi-control/query-packs/db-analyzer/v2/postgresql';
  const manifest = JSON.parse(await readFile(`${packDirectory}/manifest.json`, 'utf8'));
  const sqlByQueryId = Object.fromEntries(await Promise.all(manifest.queries
    .map(async (query) => [query.id, await readFile(`${packDirectory}/${query.file}`, 'utf8')])));
  const resultSets = {
    schemaVersion: 'chimpmaera.db/runtime-query-results/v1',
    engine: 'postgresql',
    runtimeValidated: true,
    results: Object.fromEntries(manifest.queries.map((query) => [query.id,
      query.category === 'preflight'
        ? {state: 'DENIED', reasonCode: '42501', rows: []}
        : query.category === 'schemas'
          ? {state: 'TIMEOUT', reasonCode: '57014', rows: []}
          : {state: 'ERROR', reasonCode: '42501', rows: []},
    ])),
  };
  const profileContext = {
    profileId: 'postgresql-sqlstate-reason-probe',
    mode: 'RUNTIME',
    scope: {database: 'ks149_probe', container: null, schemas: ['ks149_app']},
    policy: {},
    adapter: 'postgresql',
  };
  const evidence = buildPreflightEvidence({manifest, sqlByQueryId, resultSets, profileContext});
  assert.equal(evidence.coverageLedger.stateCounts.SUCCEEDED, 0);
  assert.equal(evidence.coverageLedger.stateCounts.DENIED, 1);
  assert.equal(evidence.coverageLedger.stateCounts.TIMEOUT, 1);
  assert.equal(evidence.coverageLedger.stateCounts.ERROR, 5);
  assert.equal(evidence.coverageLedger.allComplete, false);
  const denied = evidence.extracts.find((entry) => entry.state === 'DENIED');
  assert.equal(denied.reasonCode, '42501', 'the denial preserves the truthful SQLSTATE');
  assert.equal(denied.visibility, 'INVISIBLE');
  assert.equal(denied.emptyInterpretation, 'NOT_CLAIMED');
  assert.notEqual(denied.emptyInterpretation, 'VERIFIED_EMPTY');
  const timedOut = evidence.extracts.find((entry) => entry.state === 'TIMEOUT');
  assert.equal(timedOut.reasonCode, '57014', 'the timeout preserves the truthful SQLSTATE');
});

// The regular dispatch must preserve a connect-level denial as the truthful SQLSTATE —
// no empty success, no partial evidence. This is the product-level behavior the live
// runner's denied-metadata cell relies on.
test('the regular dispatch fails closed with the truthful SQLSTATE when the connection is denied', async () => {
  const postgresql = selectProductDescriptor('postgresql');
  const profile = buildLiveProfile({
    BI_ENGINE: 'postgresql',
    POSTGRESQL_HOST: '127.0.0.1',
    POSTGRESQL_PORT: '15432',
    POSTGRESQL_DATABASE: 'ks149_c1_denied',
    POSTGRESQL_USER: 'ks149_denied',
    POSTGRESQL_SCHEMAS: 'ks149_app',
    POSTGRESQL_SSL: 'false',
    POSTGRESQL_CONNECT_TIMEOUT_MS: '1000',
    POSTGRESQL_QUERY_TIMEOUT_MS: '5000',
    POSTGRESQL_STRUCTURE_QUERY_PACK: 'v2',
  }, postgresql.secret.env);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ks149-dispatch-denied-'));
  try {
    const profileFile = path.join(directory, 'denied-profile.json');
    await writeFile(profileFile, `${JSON.stringify(profile, null, 2)}\n`);
    const denied = () => Object.assign(new Error('permission denied for database "ks149_c1_denied"'), {code: '42501'});
    const postgresqlDriver = {
      Pool: class { async connect() { throw denied(); } async end() {} },
      Client: class { async connect() { throw denied(); } async end() {} },
    };
    process.env[postgresql.secret.env] = 'denied-canary-password';
    let code;
    try {
      await runAnalyzeProfile(profileFile, {repositoryRoot: 'services/bi-control', postgresqlDriver});
      code = 'NO_ERROR';
    } catch (error) {
      code = error?.code ?? String(error?.message ?? error);
    } finally {
      delete process.env[postgresql.secret.env];
    }
    assert.equal(code, '42501', 'the denial is preserved, never an empty success');
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

// The live runner's owner sessions must connect before use (an unconnected pg 8.x
// Client never settles query() — the committed evidence path must not hang), and the
// verified clean-room absence must precede any success claim.
test('the live-matrix runner connects every owner session before use and claims verified absence only after teardown', async () => {
  const runnerSource = await readFile('scripts/run-postgresql-c1-live-matrix.mjs', 'utf8');
  assert.match(runnerSource, /const ownerSession = async \(database, work\) => \{/);
  assert.match(runnerSource, /await client\.connect\(\);\s*\n\s*connected = true;/);
  const ownerSessionCalls = runnerSource.match(/await ownerSession\(/g) ?? [];
  assert.ok(ownerSessionCalls.length >= 5, `owner sessions are awaited at every site (found ${ownerSessionCalls.length})`);
  assert.ok(!runnerSource.includes('ownerClient'), 'no unconnected owner client factory remains');
  assert.match(runnerSource, /throw matrixError \?\? cleanupError;/);
  const verifiedIndex = runnerSource.indexOf('await verifyCleanRoomGone();');
  const claimIndex = runnerSource.indexOf('cleanRoomVerifiedAbsent');
  assert.ok(verifiedIndex !== -1 && claimIndex !== -1 && verifiedIndex < claimIndex, 'verified absence precedes the success claim');
});

// The parent-executable wrapper may claim verified clean-room absence only when the
// runner itself succeeded; a failed run must print a truthful residue notice.
test('the live-matrix wrapper emits the verified clean-room receipt only on success', async () => {
  const wrapperSource = await readFile('scripts/run-postgresql-c1-live-matrix.sh', 'utf8');
  const successReceipt = 'absence verified by the runner';
  assert.equal(wrapperSource.split(successReceipt).length - 1, 1, 'the verified receipt is emitted exactly once');
  const gate = wrapperSource.indexOf('[[ "$status" -eq 0 ]]');
  const receipt = wrapperSource.indexOf(successReceipt);
  assert.ok(gate !== -1, 'the receipt is gated on the runner exit status');
  assert.ok(receipt > gate, 'the verified receipt is emitted only in the success branch');
  assert.match(wrapperSource, /NOT VERIFIED/);
  assert.match(wrapperSource, /exit "\$status"/);
});

// AC02 must run through the regular product surface (control server HTTP /v1/analyze
// and /v1/readback with bearer auth, the credential resolved through the file-secret
// route) and the deployment must verify its SCRAM authentication method.
test('the live-matrix runner drives AC02 through the control HTTP surface and verifies SCRAM authentication', async () => {
  const runnerSource = await readFile('scripts/run-postgresql-c1-live-matrix.mjs', 'utf8');
  assert.match(runnerSource, /\/v1\/analyze/);
  assert.match(runnerSource, /\/v1\/readback/);
  assert.match(runnerSource, /POSTGRESQL_PASSWORD_FILE:/);
  assert.match(runnerSource, /Bearer /);
  assert.match(runnerSource, /pg_hba_file_rules/);
  assert.match(runnerSource, /SCRAM-SHA-256\$/);
  assert.match(runnerSource, /mechanism: 'scram-sha-256'/);
});

// Boundary gate: with the environment contract satisfied but no PostgreSQL reachable,
// the runner must fail closed promptly — no evidence file, no verified-absence claim.
test('the live-matrix runner fails closed against an unreachable server without writing evidence', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ks149-runner-negative-'));
  try {
    const ownerPasswordFile = path.join(directory, 'owner-password');
    await writeFile(ownerPasswordFile, 'KS149_NEGATIVE_GATE_0123456789_0123456789', {mode: 0o600});
    const freePort = await new Promise((resolvePort, rejectPort) => {
      const probe = net.createServer();
      probe.once('error', rejectPort);
      probe.listen(0, '127.0.0.1', () => {
        const address = probe.address();
        probe.close(() => resolvePort(address.port));
      });
    });
    const evidenceFile = 'verification/postgresql/postgresql-c1-live-matrix-v1.json';
    const evidenceExists = () => stat(evidenceFile).then(() => true, () => false);
    assert.equal(await evidenceExists(), false, 'no live evidence exists before the run');
    const child = spawn(process.execPath, ['scripts/run-postgresql-c1-live-matrix.mjs'], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {...process.env, KS149_PG_HOST: '127.0.0.1', KS149_PG_PORT: String(freePort), KS149_PG_OWNER_PASSWORD_FILE: ownerPasswordFile},
    });
    const guard = setTimeout(() => { child.kill('SIGKILL'); }, 30000);
    guard.unref();
    const output = await new Promise((resolveOutput) => {
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
      child.on('close', (code) => resolveOutput({code, stdout, stderr}));
    });
    assert.notEqual(output.code, 0, 'the runner exits non-zero against an unreachable server');
    assert.match(output.stderr, /ECONNREFUSED/, 'the failure is the truthful connection error');
    assert.ok(!output.stdout.includes('cleanRoomVerifiedAbsent'), 'no verified-absence claim on failure');
    assert.ok(!output.stdout.includes('VERIFIED'), 'no success claim on failure');
    assert.equal(await evidenceExists(), false, 'no evidence is written on failure');
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
