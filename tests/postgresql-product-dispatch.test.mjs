import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  PRODUCT_DESCRIPTOR,
  PRODUCT_DESCRIPTOR_VERSION,
  assertProductSecretBinding,
  buildLiveProfile,
  selectProductDescriptor,
} from '../services/bi-control/src/runtime-config.mjs';
import { buildPreflightEvidence } from '../services/bi-control/src/db-analyzer/core.mjs';

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
