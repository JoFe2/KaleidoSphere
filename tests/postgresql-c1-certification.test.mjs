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

// --- KS149 public-evidence delivery correction (JoFe2/KaleidoSphere#228) ---
//
// The two parent-executed live-matrix artifacts below were produced on 2026-09-11
// against the source at the tested head f60ba0f227c87bac01a0b57edf27edfca862fdc5 and
// were retained untracked in the test VM while the 0.26.0 release and the issue
// closure moved ahead. This correction publishes those historical bytes unchanged,
// binds them to the delivered Main/release through a separate provenance record, and
// content-addresses the family here. These tests fail on:
//   * referenced live-matrix evidence or the provenance record missing,
//   * substitution of the recovered historical evidence bytes (digest mismatch
//     against the recorded originals),
//   * wrong tested-source or release binding (mutated provenance record or
//     cross-file digest drift),
//   * unsupported scope claims (transport/major-version drift, non-claim erasure).
// Nothing here relabels the frozen source-local C1 certificate; its tests above are
// unchanged.

const liveMatrixJsonRel = Object.freeze('verification/postgresql/postgresql-c1-live-matrix-v1.json');
const liveMatrixReadmeRel = Object.freeze('docs/evidence/postgresql-c1-live-matrix/README.md');
const liveProvenanceRel = Object.freeze('verification/postgresql/postgresql-c1-live-matrix-provenance-v1.json');
const v2QueryPackManifestRel = Object.freeze('services/bi-control/query-packs/db-analyzer/v2/postgresql/manifest.json');

// The recorded originals of the Qwen live run (issue #228): historical bytes that are
// never rewritten, relabelled, or re-minted.
const LIVE_MATRIX_JSON_SHA256 = Object.freeze('90866c86b344c2043fdd32b3b3728da5c1d5b957dd01119c03c9398a347f3eab');
const LIVE_MATRIX_README_SHA256 = Object.freeze('9b524b4d3ed6a1ee771c10b514c23f16db159e986b99b6b035f95c944d10b92f');
const LIVE_EVIDENCE_SCHEMA_VERSION = Object.freeze('kaleidosphere.db/postgresql-c1-live-matrix/v1');
const LIVE_PROVENANCE_SCHEMA_VERSION = Object.freeze('kaleidosphere.db/postgresql-c1-live-matrix-provenance/v1');

// The tested-source / delivered-release identity (issue #228). The tested head is a
// retained VM-local commit whose git tree is byte-identical to the tree of the
// delivered Main commit.
const TESTED_SOURCE_COMMIT = Object.freeze('f60ba0f227c87bac01a0b57edf27edfca862fdc5');
const TESTED_SOURCE_TREE = Object.freeze('28b006532f2f41fb37f2382c70087362e7fcf289');
const DELIVERED_RELEASE_COMMIT = Object.freeze('648e0dcc062df8a5bcd149d23c73389370e0d298');
const RELEASE_MANIFEST_SHA256 = Object.freeze('5f8eac55337f60e524ada3988168afbbaef91d472e186d2bcbb89b7de11e3310');
const V2_QUERY_PACK_MANIFEST_SHA256 = Object.freeze('38a45f57b7dcf7fbc6efea52be635f38ae8407458641d66684395ac313097516');

// Fail-closed check: the recovered bytes must match the recorded originals exactly. A
// digest mismatch means the historical bytes were substituted; the evidence must not
// be claimed.
const assertExactHistoricalBytes = (bytes, expectedSha256, label) => {
  assert.equal(fileSha256(bytes), expectedSha256, `${label} bytes are the recorded original`);
};

// Fail-closed check on the provenance binding: the record must bind the tested source
// commit/tree to the delivered release commit/tree/manifest, re-bind the exact original
// digests of the two evidence artifacts, and keep the scope fence (loopback-only,
// major-16) intact.
const assertLiveProvenanceBinding = (record) => {
  assert.equal(record.schemaVersion, LIVE_PROVENANCE_SCHEMA_VERSION, 'provenance schema version');
  assert.equal(record.recordKind, 'PROVENANCE_VERIFICATION', 'record kind');
  const tested = record.historicalObservation.testedSource;
  assert.equal(tested.commit, TESTED_SOURCE_COMMIT, 'tested source commit binding');
  assert.equal(tested.tree, TESTED_SOURCE_TREE, 'tested source tree binding');
  const { treeIdentity, changedFilesSinceTestedHead } = record.testedSourceVersusDeliveredRelease;
  assert.equal(treeIdentity, 'IDENTICAL', 'tested source and delivered release trees are identical');
  assert.deepEqual(changedFilesSinceTestedHead, [], 'no file changed since the tested head');
  const released = record.deliveredRelease;
  assert.equal(released.commit, DELIVERED_RELEASE_COMMIT, 'delivered release commit binding');
  assert.equal(released.tree, TESTED_SOURCE_TREE, 'delivered release tree binding');
  assert.equal(released.manifestSha256, RELEASE_MANIFEST_SHA256, 'release manifest binding');
  const scope = record.historicalObservation.deployment;
  assert.equal(scope.transport, 'loopback-only', 'scope fence: loopback-only transport');
  assert.equal(scope.majorVersion, '16', 'scope fence: major-16 engine');
  const byPath = Object.fromEntries(record.evidence.artifacts.map((artifact) => [artifact.path, artifact]));
  assert.equal(byPath[liveMatrixJsonRel]?.sha256, LIVE_MATRIX_JSON_SHA256, 'matrix evidence digest binding');
  assert.equal(byPath[liveMatrixReadmeRel]?.sha256, LIVE_MATRIX_README_SHA256, 'readback digest binding');
};

test('the recovered live-matrix evidence is the exact historical bytes at the recorded originals', async () => {
  // Missing referenced evidence fails: both artifacts the provenance family references
  // must exist on disk, and every byte must be the recorded original.
  const jsonBytes = await readFile(path.join(root, liveMatrixJsonRel));
  const readmeBytes = await readFile(path.join(root, liveMatrixReadmeRel));
  assertExactHistoricalBytes(jsonBytes, LIVE_MATRIX_JSON_SHA256, 'live-matrix JSON');
  assertExactHistoricalBytes(readmeBytes, LIVE_MATRIX_README_SHA256, 'live-matrix readback');
  // A substituted historical byte set fails: the recorded originals are the binding.
  throws(() => assertExactHistoricalBytes(Buffer.from(JSON.stringify({ substituted: true })), LIVE_MATRIX_JSON_SHA256, 'substituted JSON'));
  throws(() => assertExactHistoricalBytes(Buffer.from('# substituted readback\n'), LIVE_MATRIX_README_SHA256, 'substituted readback'));
  // The machine evidence is the live-matrix schema carrying the verified live results.
  const live = JSON.parse(jsonBytes.toString('utf8'));
  assert.equal(live.schemaVersion, LIVE_EVIDENCE_SCHEMA_VERSION);
  assert.equal(live.issue, 'PG-KS-02');
  assert.equal(live.ac01.state, 'VERIFIED');
  assert.equal(live.ac02.state, 'VERIFIED');
  assert.equal(live.ac02.mode, 'RUNTIME');
  assert.equal(live.ac02.dispatch, 'REGULAR');
  assert.equal(live.ac02.engine, 'postgresql');
  assert.equal(live.ac02.runtimeValidation, 'RUNTIME_VALIDATED');
  assert.equal(live.ac03.state, 'VERIFIED');
  assert.equal(live.ac03.wrongSecret.sqlState, '28P01');
  assert.equal(live.ac03.deniedMetadata.regularPath.executorDispatch, '42501');
  assert.equal(live.ac03.deniedMetadata.regularPath.sessionProofGate, '42501');
  assert.equal(live.ac03.timeout.sqlState, '57014');
  assert.equal(live.ac03.cancel.sqlState, '57014');
  assert.equal(live.cleanRoom.verifiedAbsent, true);
  assert.equal(live.privacy.secretsDisclosed, false);
  assert.equal(live.privacy.secretCanaryMatches, 0);
  assert.equal(live.privacy.dsnMatches, 0);
  assert.equal(live.scope.container, null);
});

test('the live provenance record binds the tested source, the delivered release, and the exact originals', async () => {
  const record = JSON.parse(await readFile(path.join(root, liveProvenanceRel), 'utf8'));
  assertLiveProvenanceBinding(record);
  // The record is self-digesting: provenanceSha256 is the identity hash of the body
  // without the digest field, per the repository digest convention.
  const { provenanceSha256, ...body } = record;
  assert.match(provenanceSha256, HEX);
  assert.equal(identitySha256(body), provenanceSha256, 'provenanceSha256 is the identity hash of the body');
  // Cross-file binding: the recorded release manifest is the actual package.json, the
  // live evidence release/product fields match the real release manifest, descriptor,
  // and v2 query pack, so a wrong release or a substituted evidence set cannot pass.
  const pkgBytes = await readFile(packagePath);
  assert.equal(JSON.parse(pkgBytes.toString('utf8')).version, record.deliveredRelease.version);
  assert.equal(fileSha256(pkgBytes), RELEASE_MANIFEST_SHA256, 'package.json is the release manifest');
  const live = JSON.parse((await readFile(path.join(root, liveMatrixJsonRel))).toString('utf8'));
  assert.equal(live.product.releaseVersion, record.deliveredRelease.version);
  assert.equal(live.product.manifestSha256, fileSha256(pkgBytes));
  assert.equal(live.product.queryPack.manifestSha256, fileSha256(await readFile(path.join(root, v2QueryPackManifestRel))), 'v2 query pack binding');
  assert.equal(live.product.queryPack.manifestSha256, V2_QUERY_PACK_MANIFEST_SHA256, 'recorded v2 pack original');
  const descriptor = selectProductDescriptor('postgresql');
  assert.equal(live.product.productDescriptor.executor, descriptor.components.executor);
  assert.equal(live.product.productDescriptor.capability, descriptor.components.capability);
  assert.equal(live.product.productDescriptor.evidence, descriptor.components.evidence);
  assert.equal(live.product.productDescriptor.secretEnv, descriptor.secret.env);
  assert.equal(live.product.productDescriptor.secretFileVariable, descriptor.secret.fileVariable);
  // Every artifact the provenance record references exists on disk with its recorded
  // original bytes (missing referenced evidence fails here).
  for (const artifact of record.evidence.artifacts) {
    assertExactHistoricalBytes(await readFile(path.join(root, artifact.path)), artifact.sha256, artifact.path);
  }
  // The frozen certificate is untouched and still BLOCKED_EXTERNAL in its own bytes.
  const frozen = JSON.parse(await readFile(committedEvidencePath, 'utf8'));
  assert.equal(frozen.realDisprovablePostgresql.state, 'BLOCKED_EXTERNAL');
  assert.equal(record.frozenCertificate.state, 'UNCHANGED');
  assert.equal(record.newRunLabeling.newLiveRunPerformed, false);
});

test('the live provenance record rejects wrong tested-source or release bindings and substituted evidence', async () => {
  const record = JSON.parse(await readFile(path.join(root, liveProvenanceRel), 'utf8'));
  const mutated = (fn) => {
    const copy = JSON.parse(JSON.stringify(record));
    fn(copy);
    return copy;
  };
  // Wrong tested-source identity.
  throws(() => assertLiveProvenanceBinding(mutated((r) => { r.historicalObservation.testedSource.commit = '0'.repeat(40); })));
  throws(() => assertLiveProvenanceBinding(mutated((r) => { r.historicalObservation.testedSource.tree = 'f'.repeat(40); })));
  // Wrong delivered-release identity or manifest.
  throws(() => assertLiveProvenanceBinding(mutated((r) => { r.deliveredRelease.commit = '0'.repeat(40); })));
  throws(() => assertLiveProvenanceBinding(mutated((r) => { r.deliveredRelease.tree = '1'.repeat(40); })));
  throws(() => assertLiveProvenanceBinding(mutated((r) => { r.deliveredRelease.manifestSha256 = '0'.repeat(64); })));
  // A claim that anything changed since the tested head breaks the exact binding.
  throws(() => assertLiveProvenanceBinding(mutated((r) => { r.testedSourceVersusDeliveredRelease.treeIdentity = 'SUPERSET'; })));
  throws(() => assertLiveProvenanceBinding(mutated((r) => { r.testedSourceVersusDeliveredRelease.changedFilesSinceTestedHead.push('package.json'); })));
  // Substituted evidence digests fail the re-binding.
  throws(() => assertLiveProvenanceBinding(mutated((r) => { r.evidence.artifacts[0].sha256 = '0'.repeat(64); })));
  throws(() => assertLiveProvenanceBinding(mutated((r) => { r.evidence.artifacts[1].sha256 = '0'.repeat(64); })));
});

test('the recovered live evidence and the provenance record preserve the scope fence and over-claim nothing', async () => {
  const live = JSON.parse((await readFile(path.join(root, liveMatrixJsonRel))).toString('utf8'));
  // Scope fence: the exact parent-isolated loopback-only deployment, major 16, no
  // multi-database container.
  assert.equal(live.deployment.transport, 'loopback-only');
  assert.equal(live.deployment.majorVersion, '16');
  assert.equal(live.deployment.host, '127.0.0.1');
  assert.equal(live.deployment.deploymentClass, 'parent-isolated-loopback-clean-room');
  assert.equal(live.scope.container, null);
  const liveJoined = live.nonClaims.join('\n').toLowerCase();
  for (const phrase of ['production', 'ha', 'scale', 'performance', 'all-postgresql-versions', 'c2 is out of scope']) {
    assert.ok(liveJoined.includes(phrase), `live non-claims must cover: ${phrase}`);
  }
  const record = JSON.parse(await readFile(path.join(root, liveProvenanceRel), 'utf8'));
  assert.equal(record.historicalObservation.deployment.transport, 'loopback-only');
  assert.equal(record.historicalObservation.deployment.majorVersion, '16');
  assert.equal(record.historicalObservation.deployment.host, '127.0.0.1');
  assert.equal(record.newRunLabeling.newLiveRunPerformed, false);
  const recordJoined = record.nonClaims.join('\n').toLowerCase();
  for (const phrase of ['production', 'ha', 'scale', 'performance', 'all-postgresql-versions', 'c2 is out of scope']) {
    assert.ok(recordJoined.includes(phrase), `provenance non-claims must cover: ${phrase}`);
  }
  // An unsupported scope claim fails the binding: widening the transport or the engine
  // major version is not the tested scope.
  const widened = JSON.parse(JSON.stringify(record));
  widened.historicalObservation.deployment.transport = 'public-internet';
  throws(() => assertLiveProvenanceBinding(widened));
  const widenedEngine = JSON.parse(JSON.stringify(record));
  widenedEngine.historicalObservation.deployment.majorVersion = '17';
  throws(() => assertLiveProvenanceBinding(widenedEngine));
});
