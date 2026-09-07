import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

import {
  C1_EVIDENCE_SCHEMA_VERSION,
  runPostgresqlC1ProductPath,
  runPostgresqlC1FailClosedProbes,
  validatePostgresqlC1Profile,
} from '../services/bi-control/src/db-analyzer/postgresql-c1.mjs';
import {identitySha256} from '../services/bi-control/src/db-analyzer/core.mjs';
import {selectProductDescriptor} from '../services/bi-control/src/runtime-config.mjs';

const root = path.resolve(import.meta.dirname, '..');
const script = path.join(root, 'scripts', 'run-postgresql-c1-clean-room.mjs');
const profilePath = path.join(root, 'contracts', 'connectors', 'postgresql', 'c1-profile-v1.json');
const committedEvidencePath = path.join(root, 'verification', 'postgresql', 'postgresql-c1-evidence-v1.json');
const packagePath = path.join(root, 'package.json');

const fileSha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const HEX = /^[a-f0-9]{64}$/;
const NO_EXTERNAL_ROUTE = /node:child_process|node:https|node:http|node:net|require\s*\(|fetch\s*\(|spawn\s*\(|execFile\s*\(/;

// The exact truthful failure codes the regular dispatch / auth / scope / policy boundaries
// produce. A denial that coerces to a success or a different code is a falsification.
const EXPECTED_FAIL_CLOSED = Object.freeze({
  badSecret: 'DB_ANALYZE_CREDENTIAL_MISSING',
  scopeSubstitution: 'DB_ANALYZE_SCOPE_OVERRIDE_DENIED',
  crossEngineSecretSubstitution: 'DB_ANALYZE_SECRET_BINDING_MISMATCH',
  staleDescriptor: 'DB_ANALYZE_DESCRIPTOR_STALE',
  rawRowSource: 'DB_QUERY_ROW_SOURCE_DENIED',
  mutationStatement: 'DB_QUERY_MUTATION_DENIED',
  readOnlySessionViolation: 'DB_ANALYZE_PRINCIPAL_NOT_READ_ONLY',
});

const runScript = (args, options = {}) => spawnSync(process.execPath, [script, ...args], {cwd: root, encoding: 'utf8', ...options});
const parseStdout = (result) => {
  assert.equal(result.status, 0, `clean-room failed: ${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout);
};
const readProfile = async () => {
  const bytes = await readFile(profilePath);
  return {bytes, value: JSON.parse(bytes.toString('utf8'))};
};
const mutateProfile = (bytes, fn) => {
  const next = JSON.parse(bytes.toString('utf8'));
  fn(next);
  return next;
};
const throws = (fn) => {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  assert.ok(threw, 'expected fail-closed');
};

test('the committed C1 certificate is the exact deterministic output of the regular clean-room', async () => {
  // Run twice with an emptied PATH to prove the boundary is local-only (no external binary
  // route is taken to reproduce the certificate).
  const first = runScript(['--dry-run'], {env: {...process.env, PATH: ''}});
  const second = runScript(['--dry-run'], {env: {...process.env, PATH: ''}});
  assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
  assert.equal(first.stdout, second.stdout, 'certificate is byte-stable across runs');
  const committed = await readFile(committedEvidencePath, 'utf8');
  assert.equal(committed, first.stdout, 'committed certificate is the exact clean-room output');
  const evidence = parseStdout(first);
  assert.equal(evidence.schemaVersion, C1_EVIDENCE_SCHEMA_VERSION);

  // Certificate integrity: the digest is the identity hash of the body without the digest field.
  const {certificateSha256, ...body} = evidence;
  assert.match(certificateSha256, HEX);
  assert.equal(identitySha256(body), certificateSha256, 'certificateSha256 is the identity hash of the body');
});

test('the regular Analyze-to-Readback product path reproduces the certificate digests', async () => {
  const {bytes: profileBytes, value: profile} = await readProfile();
  validatePostgresqlC1Profile(profile);
  const productPath = await runPostgresqlC1ProductPath({repoRoot: root, profile});
  const committed = JSON.parse(await readFile(committedEvidencePath, 'utf8'));
  // The regular path, not a bespoke bypass, produced the committed receipt / projection digests.
  assert.equal(productPath.mode, 'SYNTHETIC');
  assert.equal(productPath.dispatch, 'REGULAR');
  assert.equal(productPath.engine, 'postgresql');
  assert.equal(productPath.runtimeValidation, 'SYNTHETIC_UNVALIDATED');
  assert.equal(productPath.snapshotSha256, committed.productPath.snapshotSha256);
  assert.equal(productPath.readbackSha256, committed.productPath.readbackSha256);
  assert.deepEqual(productPath.projectionDigests, committed.productPath.projectionDigests);
  assert.equal(productPath.readbackByteStable, true);
  assert.equal(productPath.diskReadbackValidated, true);
  // AC02 content: identity + relations + columns + constraints + dependencies (+schemas), NOT indexes.
  assert.deepEqual(productPath.categories, ['columns', 'constraints', 'dependencies', 'preflight', 'relations', 'schemas']);
  assert.equal(productPath.coverage.allComplete, true);
  assert.equal(productPath.coverage.succeeded, 6);
  for (const digest of Object.values(productPath.projectionDigests)) assert.match(digest, HEX);
});

test('the certificate binds only the tested product, release, config, fixtures, and evidence', async () => {
  const committed = JSON.parse(await readFile(committedEvidencePath, 'utf8'));
  // AC04: the certified route is the frozen versioned descriptor (regular dispatch).
  const descriptor = selectProductDescriptor('postgresql');
  const binding = committed.binding;
  assert.equal(binding.productDescriptor.engine, descriptor.engine);
  assert.equal(binding.productDescriptor.executor, descriptor.components.executor);
  assert.equal(binding.productDescriptor.capability, descriptor.components.capability);
  assert.equal(binding.productDescriptor.evidence, descriptor.components.evidence);
  // Reference-only secret route: an env-var name and a file-var name, never a value.
  assert.equal(binding.auth.secretEnv, descriptor.secret.env);
  assert.equal(binding.auth.secretFileVariable, descriptor.secret.fileVariable);
  // Release binding (Main release manifest).
  const pkgBytes = await readFile(packagePath);
  assert.equal(committed.release.manifestSha256, fileSha256(pkgBytes));
  assert.equal(committed.release.version, JSON.parse(pkgBytes.toString('utf8')).version);
  // Config + fixture bindings match the actual bound files.
  const analyzeBytes = await readFile(path.join(root, 'services/bi-control/fixtures/postgresql-structure-profile-v1.json'));
  const manifestBytes = await readFile(path.join(root, 'services/bi-control/query-packs/db-analyzer/v1/postgresql/manifest.json'));
  const fixtureBytes = await readFile(path.join(root, 'services/bi-control/fixtures/postgresql-structure-results-v1.json'));
  assert.equal(binding.config.analyzeProfileSha256, fileSha256(analyzeBytes));
  assert.equal(binding.config.queryPackManifestSha256, fileSha256(manifestBytes));
  assert.equal(binding.fixtures.syntheticFixtureSha256, fileSha256(fixtureBytes));
  // Profile binding.
  assert.equal(committed.profileSha256, fileSha256(await readFile(profilePath)));
});

test('the fail-closed dispatch/auth/scope/policy probes return the truthful codes', async () => {
  const {value: profile} = await readProfile();
  const failClosed = await runPostgresqlC1FailClosedProbes({repoRoot: root, profile});
  for (const [probe, expected] of Object.entries(EXPECTED_FAIL_CLOSED)) {
    assert.equal(failClosed[probe], expected, `probe ${probe}`);
  }
  // Denied metadata is preserved as a denial, never coerced to a successful empty fact.
  const {deniedMetadata} = failClosed;
  assert.equal(deniedMetadata.state, 'DENIED');
  assert.notEqual(deniedMetadata.state, 'SUCCEEDED');
  assert.equal(deniedMetadata.visibility, 'INVISIBLE');
  assert.equal(deniedMetadata.emptyInterpretation, 'NOT_CLAIMED');
  assert.equal(deniedMetadata.coercedToSuccess, false);
});

test('the certificate preserves BLOCKED_EXTERNAL real-PG non-claims and does not over-claim', async () => {
  const committed = JSON.parse(await readFile(committedEvidencePath, 'utf8'));
  const real = committed.realDisprovablePostgresql;
  assert.equal(real.state, 'BLOCKED_EXTERNAL');
  assert.equal(real.ac01VerifiedLeastPrivilegePrincipal, 'BLOCKED_EXTERNAL');
  assert.equal(real.ac02RealSourcePositiveRun, 'BLOCKED_EXTERNAL');
  assert.equal(real.ac03RealNegativeMatrix, 'BLOCKED_EXTERNAL');
  // Index enumeration is not a tested capability; C2 / mutation / profiling / row-samples are not claimed.
  assert.equal(committed.binding.capabilities.includes('indexes'), false);
  for (const non of ['indexes', 'c2', 'mutation', 'profiling', 'row-samples']) {
    assert.equal(committed.binding.nonCapabilities.includes(non), true, `non-capability ${non}`);
  }
  assert.ok(committed.nonClaims.length >= 3, 'non-claims are recorded');
  const joined = committed.nonClaims.join('\n').toLowerCase();
  for (const phrase of ['production', 'scale', 'all-postgresql-versions', 'c2 is out of scope', 'blocked_external']) {
    assert.ok(joined.includes(phrase), `non-claims must cover: ${phrase}`);
  }
});

test('the C1 profile fails closed on descriptor, scope, principal, and capability drift', async () => {
  const {bytes} = await readProfile();
  assert.doesNotThrow(() => validatePostgresqlC1Profile(mutateProfile(bytes, () => {})), 'the committed profile is valid');
  // The certified route must equal the frozen descriptor route.
  throws(() => validatePostgresqlC1Profile(mutateProfile(bytes, (p) => { p.productDescriptor.executor = 'oracle.run-queries'; })));
  // The engine cannot be substituted.
  throws(() => validatePostgresqlC1Profile(mutateProfile(bytes, (p) => { p.engine = 'oracle'; })));
  // The principal cannot be widened beyond the least-privilege read-only declaration.
  throws(() => validatePostgresqlC1Profile(mutateProfile(bytes, (p) => { p.principal.access = 'READ_WRITE'; })));
  throws(() => validatePostgresqlC1Profile(mutateProfile(bytes, (p) => { p.principal.leastPrivilege.superuser = true; })));
  // The scope cannot be widened to a multi-database container.
  throws(() => validatePostgresqlC1Profile(mutateProfile(bytes, (p) => { p.scope.container = 'citus'; })));
  // A capability may not also be declared a non-capability.
  throws(() => validatePostgresqlC1Profile(mutateProfile(bytes, (p) => { p.capabilities.push('c2'); })));
});

test('the clean-room fails closed when the bound profile route or a bound digest drifts', async () => {
  const {bytes} = await readProfile();
  const tmp = await mkdtemp(path.join(tmpdir(), 'ks149-c1-tamper-'));
  const writeProfile = async (name, mutate) => {
    const file = path.join(tmp, name);
    await writeFile(file, `${JSON.stringify(mutateProfile(bytes, mutate), null, 2)}\n`);
    return file;
  };
  // Route drift: the clean-room refuses to certify a non-regular executor route.
  const badRoute = await writeProfile('bad-route.json', (p) => { p.productDescriptor.executor = 'oracle.run-queries'; });
  const routeResult = runScript(['--dry-run', '--profile', badRoute]);
  assert.notEqual(routeResult.status, 0, `${routeResult.stdout}\n${routeResult.stderr}`);
  // Config drift: a wrong bound analyze-profile digest is denied.
  const badDigest = await writeProfile('bad-digest.json', (p) => { p.productPath.analyzeProfile.sha256 = '0'.repeat(64); });
  const digestResult = runScript(['--dry-run', '--profile', badDigest]);
  assert.notEqual(digestResult.status, 0, `${digestResult.stdout}\n${digestResult.stderr}`);
});

test('the clean-room is source-local: no process, network, or live-database route', async () => {
  const source = await readFile(script, 'utf8');
  assert.doesNotMatch(source, NO_EXTERNAL_ROUTE, 'clean-room takes no external process/network/DB route');
  // It drives the regular product path through the module, not a bespoke bypass.
  assert.match(source, /postgresql-c1\.mjs/);
  // The certificate records the external boundary as blocked, not performed.
  const committed = JSON.parse(await readFile(committedEvidencePath, 'utf8'));
  assert.equal(committed.realDisprovablePostgresql.state, 'BLOCKED_EXTERNAL');
});
