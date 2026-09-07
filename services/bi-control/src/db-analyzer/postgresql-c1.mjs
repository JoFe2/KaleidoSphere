import {createHash} from 'node:crypto';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  COVERAGE_STATES,
  canonicalJson,
  identitySha256,
  buildPreflightEvidence,
  sha256,
  validateQueryManifest,
} from './core.mjs';
import {renderAnalyzeEvidence, runAnalyzeProfile} from './workflow.mjs';
import {buildStructureMapOutputs} from './outputs.mjs';
import {auditCatalogQuery} from './query-safety.mjs';
import {
  assertPostgresqlReadOnlySession,
  compilePostgresqlProfileQuery,
} from './postgresql-adapter.mjs';
import {runPostgresqlQueries} from './postgresql-runtime.mjs';
import {
  PRODUCT_DESCRIPTOR_VERSION,
  assertProductSecretBinding,
  selectProductDescriptor,
} from '../runtime-config.mjs';

// PostgreSQL C1 — "Certify PostgreSQL C1 on the regular Analyze-to-Readback product
// path" (live KaleidoSphere issue #149 / PG-KS-02).
//
// This module is the source-local, credential-free core of the C1 clean-room. It proves,
// against the frozen query pack and a synthetic result fixture, the parts of the C1
// acceptance criteria that are honest to assert without a live server:
//
//   * the regular Analyze-to-Readback product path (runAnalyzeProfile -> renderAnalyze
//     Evidence -> buildStructureMapOutputs) runs through the versioned product
//     descriptor's dispatch and yields stable snapshot / readback / projection digests;
//   * the dispatch, auth, scoped-query and policy boundaries fail closed with truthful
//     codes for bad secret, scope substitution, cross-engine secret substitution, stale
//     descriptor, raw-row source, mutation, non-read-only session and denied metadata;
//   * a C1 certificate binds only the tested product / version / auth / capabilities and
//     the config, fixtures, release and evidence digests.
//
// The real-disposable-PostgreSQL execution (verified least-privilege principal connect,
// real-source positive run, live timeout/cancel/denied matrix) is NOT performed here and
// is surfaced as explicit BLOCKED_EXTERNAL non-claims; a separate credential-free worker
// gate owns that execution, mirroring the existing KS23 end-to-end harness.

export const C1_PROFILE_SCHEMA_VERSION = 'kaleidosphere.db/postgresql-c1-profile/v1';
export const C1_EVIDENCE_SCHEMA_VERSION = 'kaleidosphere.db/postgresql-c1-evidence/v1';

const SHA256 = /^[a-f0-9]{64}$/;
const fail = (message) => {
  const error = new Error(message);
  error.code = 'DB_C1_CONTRACT_INVALID';
  throw error;
};

// Raw file-byte digest (matches the repo's canonical file hashing). The core sha256()
// helper only canonicalizes strings / JSON values, so Buffer inputs are hashed directly.
const fileSha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const readBytes = async (file, label) => {
  let bytes;
  try {
    bytes = await readFile(file);
  } catch (error) {
    fail(`${label} unreadable: ${error.code ?? 'io-error'}`);
  }
  return bytes;
};

const parseJson = (bytes, label) => {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    fail(`${label}: invalid JSON`);
  }
};

const assertObject = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
};

const assertText = (value, label) => {
  if (typeof value !== 'string' || value.trim() === '') fail(`${label} must be non-empty text`);
};

const assertSha = (value, label) => {
  if (typeof value !== 'string' || !SHA256.test(value)) fail(`${label} must be a SHA-256 hex digest`);
};

const assertBoolean = (value, label) => {
  if (typeof value !== 'boolean') fail(`${label} must be a boolean`);
};

const assertExactKeys = (value, keys, label) => {
  assertObject(value, label);
  const actual = canonicalJson(Object.keys(value).sort());
  const expected = canonicalJson([...keys].sort());
  if (actual !== expected) fail(`${label}: unexpected key set`);
};

// Validates the C1 profile contract and, crucially, binds it to the frozen,
// versioned product descriptor so the certified path is the regular dispatch rather
// than a direct pilot-module bypass.
export function validatePostgresqlC1Profile(profile) {
  assertExactKeys(profile, [
    'schemaVersion', 'profileId', 'engine', 'deployment', 'auth', 'principal',
    'scope', 'productDescriptor', 'productPath', 'capabilities', 'nonCapabilities',
  ], 'c1 profile');
  if (profile.schemaVersion !== C1_PROFILE_SCHEMA_VERSION) fail('c1 profile schema drift denied');
  assertText(profile.profileId, 'profileId');
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(profile.profileId)) fail('profileId shape denied');
  if (profile.engine !== 'postgresql') fail('c1 profile engine denied: postgresql only');

  assertExactKeys(profile.deployment, ['version', 'majorVersion', 'image', 'transport', 'deploymentClass'], 'deployment');
  assertText(profile.deployment.version, 'deployment.version');
  assertText(profile.deployment.majorVersion, 'deployment.majorVersion');
  assertExactKeys(profile.deployment.image, ['reference', 'platform', 'manifestDigest'], 'deployment.image');
  assertText(profile.deployment.image.reference, 'image.reference');
  assertText(profile.deployment.image.platform, 'image.platform');
  if (!/^sha256:[a-f0-9]{64}$/.test(profile.deployment.image.manifestDigest)) fail('image.manifestDigest must be a digest-pinned sha256');
  assertText(profile.deployment.transport, 'deployment.transport');
  assertText(profile.deployment.deploymentClass, 'deployment.deploymentClass');

  assertExactKeys(profile.auth, ['mode', 'secretRoute'], 'auth');
  assertText(profile.auth.mode, 'auth.mode');
  assertExactKeys(profile.auth.secretRoute, ['fileVariable', 'env'], 'auth.secretRoute');
  assertText(profile.auth.secretRoute.fileVariable, 'secretRoute.fileVariable');
  assertText(profile.auth.secretRoute.env, 'secretRoute.env');

  assertExactKeys(profile.principal, ['roleName', 'access', 'leastPrivilege'], 'principal');
  assertText(profile.principal.roleName, 'principal.roleName');
  if (profile.principal.access !== 'READ_ONLY') fail('principal.access denied: READ_ONLY only');
  assertExactKeys(profile.principal.leastPrivilege, [
    'superuser', 'createDatabase', 'createRole', 'replication', 'bypassRls', 'transactionReadOnly',
  ], 'principal.leastPrivilege');
  for (const key of ['superuser', 'createDatabase', 'createRole', 'replication', 'bypassRls']) {
    if (profile.principal.leastPrivilege[key] !== false) fail(`principal.leastPrivilege.${key} denied: must be false`);
  }
  if (profile.principal.leastPrivilege.transactionReadOnly !== true) fail('principal.leastPrivilege.transactionReadOnly denied: must be true');

  assertExactKeys(profile.scope, ['database', 'container', 'schemas'], 'scope');
  assertText(profile.scope.database, 'scope.database');
  if (profile.scope.container !== null) fail('scope.container denied: c1 scopes a single database');
  if (!Array.isArray(profile.scope.schemas) || profile.scope.schemas.length === 0
    || profile.scope.schemas.some((schema) => typeof schema !== 'string' || schema.length === 0)
    || new Set(profile.scope.schemas).size !== profile.scope.schemas.length) fail('scope.schemas denied');

  assertExactKeys(profile.productDescriptor, ['engine', 'version', 'executor', 'capability', 'evidence'], 'productDescriptor');
  if (profile.productDescriptor.engine !== 'postgresql') fail('productDescriptor.engine denied');
  // Bind to the frozen descriptor: the certified route must equal the regular dispatch.
  const descriptor = selectProductDescriptor('postgresql');
  if (profile.productDescriptor.version !== PRODUCT_DESCRIPTOR_VERSION
    || profile.productDescriptor.executor !== descriptor.components.executor
    || profile.productDescriptor.capability !== descriptor.components.capability
    || profile.productDescriptor.evidence !== descriptor.components.evidence) {
    fail('productDescriptor binding denied: must match the frozen versioned descriptor');
  }
  if (profile.auth.secretRoute.env !== descriptor.secret.env
    || profile.auth.secretRoute.fileVariable !== descriptor.secret.fileVariable) {
    fail('auth.secretRoute binding denied: must match the frozen descriptor secret route');
  }

  assertExactKeys(profile.productPath, ['analyzeProfile', 'queryPackManifest', 'syntheticFixture'], 'productPath');
  for (const key of ['analyzeProfile', 'queryPackManifest', 'syntheticFixture']) {
    assertExactKeys(profile.productPath[key], ['path', 'sha256'], `productPath.${key}`);
    assertText(profile.productPath[key].path, `productPath.${key}.path`);
    assertSha(profile.productPath[key].sha256, `productPath.${key}.sha256`);
  }

  if (!Array.isArray(profile.capabilities) || profile.capabilities.length === 0
    || profile.capabilities.some((value) => typeof value !== 'string' || value.length === 0)
    || new Set(profile.capabilities).size !== profile.capabilities.length) fail('capabilities denied');
  if (!Array.isArray(profile.nonCapabilities) || profile.nonCapabilities.length === 0
    || profile.nonCapabilities.some((value) => typeof value !== 'string' || value.length === 0)
    || new Set(profile.nonCapabilities).size !== profile.nonCapabilities.length) fail('nonCapabilities denied');
  const overlap = profile.capabilities.filter((value) => profile.nonCapabilities.includes(value));
  if (overlap.length > 0) fail(`capabilities/nonCapabilities overlap denied: ${overlap.join(', ')}`);

  return profile;
}

// Runs the regular Analyze-to-Readback product path on the bound synthetic fixture,
// twice, and re-reads the canonical artifact from disk to revalidate it. Returns the
// proven digests and counts. The profile must be schema-validated by the caller.
export async function runPostgresqlC1ProductPath({repoRoot, profile}) {
  const controlRoot = path.join(repoRoot, 'services', 'bi-control');
  const analyzeProfileFile = path.join(repoRoot, profile.productPath.analyzeProfile.path);
  const manifestFile = path.join(repoRoot, profile.productPath.queryPackManifest.path);

  const [manifestBytes, analyzeBytes] = await Promise.all([
    readBytes(manifestFile, 'query pack manifest'),
    readBytes(analyzeProfileFile, 'bound analyze profile'),
  ]);
  if (fileSha256(manifestBytes) !== profile.productPath.queryPackManifest.sha256) {
    fail('query pack manifest binding drift denied');
  }
  if (fileSha256(analyzeBytes) !== profile.productPath.analyzeProfile.sha256) {
    fail('bound analyze profile drift denied');
  }
  const manifest = parseJson(manifestBytes, 'query pack manifest');
  validateQueryManifest(manifest);

  const packDirectory = path.dirname(manifestFile);
  const sqlByQueryId = Object.fromEntries(await Promise.all(manifest.queries.map(async (query) => [
    query.id, (await readFile(path.join(packDirectory, query.file), 'utf8')),
  ])));

  const run1 = await runAnalyzeProfile(analyzeProfileFile, {repositoryRoot: controlRoot});
  const render1 = renderAnalyzeEvidence(run1);
  const run2 = await runAnalyzeProfile(analyzeProfileFile, {repositoryRoot: controlRoot});
  const render2 = renderAnalyzeEvidence(run2);
  if (render1 !== render2) fail('analyze readback not byte-stable across runs');
  if (run1.snapshotSha256 !== run2.snapshotSha256) fail('analyze snapshot digest not stable across runs');

  // Genuine readback: persist the canonical artifact and re-read + revalidate it through
  // the product's output pipeline so the readback is a re-processable, hash-bound surface.
  const readbackDirectory = await mkdtemp(path.join(os.tmpdir(), 'ks149-c1-readback-'));
  let diskReadbackValidated;
  try {
    const readbackFile = path.join(readbackDirectory, 'readback.canonical.json');
    await writeFile(readbackFile, render1, {mode: 0o600});
    const readbackText = (await readFile(readbackFile)).toString('utf8');
    if (readbackText !== render1) fail('disk readback bytes differ from the canonical artifact');
    const readback = JSON.parse(readbackText);
    const readbackOutputs = buildStructureMapOutputs({evidence: readback, manifest, sqlByQueryId});
    if (readbackOutputs.outputManifest.sourceSnapshotSha256 !== run1.snapshotSha256) {
      fail('disk readback failed to revalidate through the product output pipeline');
    }
    diskReadbackValidated = true;
  } finally {
    await rm(readbackDirectory, {recursive: true, force: true});
  }

  const outputs = buildStructureMapOutputs({evidence: run1, manifest, sqlByQueryId});
  const counts = {};
  for (const extract of run1.extracts) counts[extract.category] = extract.rows.length;
  return {
    mode: run1.runtimeValidation === 'RUNTIME_VALIDATED' ? 'RUNTIME' : 'SYNTHETIC',
    dispatch: 'REGULAR',
    engine: run1.engine,
    runtimeValidation: run1.runtimeValidation,
    snapshotSha256: run1.snapshotSha256,
    readbackSha256: sha256(render1),
    readbackByteStable: true,
    diskReadbackValidated,
    projectionDigests: {
      inventorySha256: outputs.outputManifest.artifactDigests.inventorySha256,
      relationshipsSha256: outputs.outputManifest.artifactDigests.relationshipsSha256,
      coverageSha256: outputs.outputManifest.artifactDigests.coverageSha256,
    },
    coverage: {
      allComplete: run1.coverageLedger.allComplete,
      ...Object.fromEntries(COVERAGE_STATES.map((state) => [state.toLowerCase(), run1.coverageLedger.stateCounts[state]])),
    },
    counts,
    categories: Object.keys(counts).sort(),
  };
}

// Captures the code thrown by `fn`, or null when it does not throw.
const thrownCode = (fn) => {
  try {
    fn();
  } catch (error) {
    return error?.code ?? String(error?.message ?? error);
  }
  return null;
};

// Runs the fail-closed dispatch / auth / scope / policy probes against the regular
// product components. Each probe returns the truthful failure code it observed; the
// caller asserts they are the expected codes.
export async function runPostgresqlC1FailClosedProbes({repoRoot, profile}) {
  const descriptor = selectProductDescriptor('postgresql');
  const mssqlDescriptor = selectProductDescriptor('mssql');

  // Bad/missing secret: the regular executor refuses before it opens any connection when
  // the bound credential reference is absent from the environment.
  const unsetSecretEnv = 'KS149_C1_UNSET_SECRET';
  const priorSecret = process.env[unsetSecretEnv];
  delete process.env[unsetSecretEnv];
  const runtimeProbeProfile = {
    schemaVersion: 'chimpmaera.db/analyze-profile/v1',
    profileId: 'ks149-c1-bad-secret-probe',
    engine: 'postgresql',
    mode: 'RUNTIME',
    queryPack: {version: 'v1'},
    scope: {database: profile.scope.database, container: null, schemas: profile.scope.schemas},
    policy: {access: 'READ_ONLY', allowRowSamples: false, maxQueryTimeoutMs: 5000},
    adapter: {
      kind: 'postgresql', host: '127.0.0.1', port: 5432, user: 'ks149_probe',
      passwordEnv: unsetSecretEnv, ssl: false, connectTimeoutMs: 5000,
    },
  };
  let badSecret;
  try {
    await runPostgresqlQueries({profile: runtimeProbeProfile, manifest: {queries: []}, entries: []});
    badSecret = 'NO_ERROR';
  } catch (error) {
    badSecret = error?.code ?? String(error?.message ?? error);
  } finally {
    if (priorSecret === undefined) delete process.env[unsetSecretEnv];
    else process.env[unsetSecretEnv] = priorSecret;
  }

  // Scope substitution: binding the profile scope to a different schema set before
  // dispatch is denied rather than silently widened.
  const scopeStatement = 'SELECT namespace.nspname AS schema_name FROM pg_catalog.pg_namespace AS namespace;';
  const scopeQuery = {id: 'postgresql.structure.schemas', outputColumns: ['schema_name'], sortKeys: ['schema_name'], scopeColumn: 'schema_name'};
  const scopeSubstitution = thrownCode(() => compilePostgresqlProfileQuery({
    profile: {scope: {schemas: [...profile.scope.schemas]}},
    query: scopeQuery,
    statement: scopeStatement,
    requestedSchemas: ['ks149_outside'],
  }));

  // Cross-engine secret substitution: this engine's descriptor bound to another engine's
  // credential reference is denied.
  const crossEngineSecretSubstitution = thrownCode(() => assertProductSecretBinding(descriptor, mssqlDescriptor.secret.env));

  // Stale descriptor version: selecting the product descriptor with a non-current version
  // fails closed rather than defaulting.
  const staleDescriptor = thrownCode(() => selectProductDescriptor('postgresql', {version: 'v0'}));

  // Raw-row source: a SELECT from a non-catalog relation is denied by the query safety
  // boundary (no raw source-row access).
  const rawRowSource = thrownCode(() => auditCatalogQuery({
    engine: 'postgresql', queryId: 'ks149.c1.raw-row', sql: 'SELECT customer_email FROM public.customers;',
  }));

  // Mutation: a SELECT carrying a mutation token is denied by the query safety boundary.
  const mutationStatement = thrownCode(() => auditCatalogQuery({
    engine: 'postgresql', queryId: 'ks149.c1.mutation', sql: 'SELECT relname INTO ks149_probe_sink FROM pg_catalog.pg_class;',
  }));

  // Non-read-only session proof: a session that is not transactionally read-only is denied.
  const readOnlySessionViolation = thrownCode(() => assertPostgresqlReadOnlySession([
    {transaction_read_only: 'off', default_transaction_read_only: 'off'},
  ]));

  // Denied metadata is preserved, never coerced into a successful empty fact.
  const fixtureDirectory = path.join(repoRoot, 'services', 'bi-control', 'fixtures');
  const [incompleteBytes, analyzeBytes] = await Promise.all([
    readBytes(path.join(fixtureDirectory, 'postgresql-structure-results-incomplete-v1.json'), 'incomplete fixture'),
    readBytes(path.join(repoRoot, profile.productPath.analyzeProfile.path), 'bound analyze profile'),
  ]);
  const incomplete = parseJson(incompleteBytes, 'incomplete fixture');
  const analyzeProfile = parseJson(analyzeBytes, 'bound analyze profile');
  const packDirectory = path.join(repoRoot, profile.productPath.queryPackManifest.path, '..');
  const manifestForDenied = parseJson(await readBytes(path.join(packDirectory, 'manifest.json'), 'query pack manifest'), 'query pack manifest');
  const sqlByQueryId = Object.fromEntries(await Promise.all(manifestForDenied.queries.map(async (query) => [
    query.id, (await readFile(path.join(packDirectory, query.file), 'utf8')),
  ])));
  const evidence = buildPreflightEvidence({
    manifest: manifestForDenied,
    sqlByQueryId,
    resultSets: incomplete,
    profileContext: {
      profileId: analyzeProfile.profileId,
      mode: analyzeProfile.mode,
      scope: analyzeProfile.scope,
      policy: analyzeProfile.policy,
      adapter: analyzeProfile.adapter.kind,
    },
  });
  const denied = evidence.extracts.find((entry) => entry.queryId === 'postgresql.structure.dependencies');
  const deniedMetadata = {
    state: denied?.state,
    visibility: denied?.visibility,
    emptyInterpretation: denied?.emptyInterpretation,
    coercedToSuccess: denied?.state === 'SUCCEEDED',
  };

  return {
    badSecret,
    scopeSubstitution,
    crossEngineSecretSubstitution,
    staleDescriptor,
    rawRowSource,
    mutationStatement,
    readOnlySessionViolation,
    deniedMetadata,
  };
}

const C1_NON_CLAIMS = Object.freeze([
  'C1 is certified only for the exact tested PostgreSQL 16.10 version, digest-pinned image, SCRAM-SHA-256 auth and loopback-only disposable-clean-room deployment named in the C1 profile.',
  'No production, customer-data, HA, scale, performance, extension or all-PostgreSQL-versions/auth-modes claim; C2 is out of scope.',
  'The certified structural categories are identity, schemas, relations, columns, constraints and dependencies; index enumeration is NOT a tested capability of this C1 structural pack and is not claimed.',
  'Real-disposable-PostgreSQL execution (verified least-privilege principal connect and role readback, real-source positive run, and the live timeout/cancel/denied matrix) is BLOCKED_EXTERNAL and not proven by this source-local certificate.',
]);

// Assembles and schema-validates the C1 certificate. The real-disposable-PostgreSQL
// section is recorded as BLOCKED_EXTERNAL: this source-local clean-room performs no live
// database connection, so it never claims real-source execution.
export async function buildPostgresqlC1Evidence({repoRoot, profile, profileBytes}) {
  validatePostgresqlC1Profile(profile);
  const descriptor = selectProductDescriptor('postgresql');
  const packageBytes = await readBytes(path.join(repoRoot, 'package.json'), 'package manifest');
  const packageManifest = parseJson(packageBytes, 'package manifest');

  const productPath = await runPostgresqlC1ProductPath({repoRoot, profile});
  const failClosed = await runPostgresqlC1FailClosedProbes({repoRoot, profile});

  const body = {
    schemaVersion: C1_EVIDENCE_SCHEMA_VERSION,
    profileId: profile.profileId,
    profileSha256: fileSha256(profileBytes),
    release: {
      version: packageManifest.version,
      manifestSha256: fileSha256(packageBytes),
    },
    binding: {
      productDescriptor: {
        engine: descriptor.engine,
        version: descriptor.version ?? PRODUCT_DESCRIPTOR_VERSION,
        executor: descriptor.components.executor,
        capability: descriptor.components.capability,
        evidence: descriptor.components.evidence,
        secretEnv: descriptor.secret.env,
        secretFileVariable: descriptor.secret.fileVariable,
      },
      deployment: {
        version: profile.deployment.version,
        majorVersion: profile.deployment.majorVersion,
        imageManifestDigest: profile.deployment.image.manifestDigest,
        transport: profile.deployment.transport,
        deploymentClass: profile.deployment.deploymentClass,
      },
      auth: {
        mode: profile.auth.mode,
        secretEnv: profile.auth.secretRoute.env,
        secretFileVariable: profile.auth.secretRoute.fileVariable,
      },
      principal: {
        roleName: profile.principal.roleName,
        access: profile.principal.access,
        leastPrivilege: profile.principal.leastPrivilege,
      },
      scope: profile.scope,
      capabilities: profile.capabilities,
      nonCapabilities: profile.nonCapabilities,
      config: {
        analyzeProfileSha256: profile.productPath.analyzeProfile.sha256,
        queryPackManifestSha256: profile.productPath.queryPackManifest.sha256,
      },
      fixtures: {
        syntheticFixtureSha256: profile.productPath.syntheticFixture.sha256,
      },
    },
    productPath,
    failClosed,
    realDisprovablePostgresql: {
      state: 'BLOCKED_EXTERNAL',
      reason: 'NO_REAL_DISPOSABLE_POSTGRESQL',
      ac01VerifiedLeastPrivilegePrincipal: 'BLOCKED_EXTERNAL',
      ac02RealSourcePositiveRun: 'BLOCKED_EXTERNAL',
      ac03RealNegativeMatrix: 'BLOCKED_EXTERNAL',
    },
    nonClaims: [...C1_NON_CLAIMS],
  };

  return {...body, certificateSha256: identitySha256(body)};
}
