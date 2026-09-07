import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// The source gate owns canonical parent registration so the immutable BI-KS-03
// package preimage remains replayable while this test still runs under both
// `npm test` and `npm run test:source`.
import './business-bi-epic-closure.test.mjs';

const businessBiFiles = Object.freeze([
  'contracts/business-bi/v1/net-revenue.metric.json',
  'docs/evidence/business-bi-net-revenue-v1.md',
  'scripts/run-business-bi-falsification-clean-room.mjs',
  'scripts/run-business-bi-holdout-clean-room.mjs',
  'services/bi-control/src/business-bi/net-revenue-plan.mjs',
  'services/bi-control/src/business-bi/net-revenue-readback.mjs',
  'tests/business-bi-clean-room.test.mjs',
  'tests/business-bi-epic-closure.test.mjs',
  'tests/business-bi-metric-oracle.test.mjs',
  'tests/business-bi-net-revenue-plan.test.mjs',
  'tests/fixtures/business-bi/net-revenue-holdout-v1.json',
  'tests/fixtures/business-bi/net-revenue-oracle-v1.json',
  'verification/business-bi-epic-closure-v1.json',
  'verification/business-bi-net-revenue-falsification-v1.json',
  'verification/business-bi-net-revenue-holdout-v1.json',
]);

const businessBiFalsificationPathClasses = Object.freeze({
  public: Object.freeze([
    'README.md',
  ]),
  evidence: Object.freeze([
    'docs/evidence/business-bi-net-revenue-v1.md',
    'scripts/run-business-bi-falsification-clean-room.mjs',
    'tests/business-bi-clean-room.test.mjs',
    'tests/business-bi-epic-closure.test.mjs',
    'verification/business-bi-epic-closure-v1.json',
    'verification/business-bi-net-revenue-falsification-v1.json',
  ]),
});

const canonicalFocusedFamily = Object.freeze([
  'tests/business-bi-metric-oracle.test.mjs',
  'tests/business-bi-net-revenue-plan.test.mjs',
  'tests/business-bi-clean-room.test.mjs',
]);
const historicalEnvironmentTestSkip =
  '--test-skip-pattern=^input,.metric,.plan,.oracle,.result,.coverage,.environment,.commit,.and.tree.identities.are.frozen$';
const parentClosureTest = 'tests/business-bi-epic-closure.test.mjs';

// The PostgreSQL C1 source-local integrity family (KaleidoSphere issue #172): the
// clean-room runtime that mints the certificate, the canonical verifier, and the
// checked certificate. Bound in the content-addressed source map so the family stays
// replayable and tamper-evident without a full repository re-digest.
const postgresqlC1Family = Object.freeze({
  runtime: 'scripts/run-postgresql-c1-clean-room.mjs',
  test: 'tests/postgresql-c1-certification.test.mjs',
  evidence: 'verification/postgresql/postgresql-c1-evidence-v1.json',
});

// The PostgreSQL product-dispatch source-local CI repair (KaleidoSphere issue #175): the
// descriptor-selection suite must be both content-addressed in the source map and
// canonically registered exactly once, in the codepoint-sorted PostgreSQL test family.
// The predecessor/successor anchors pin its exact codepoint slot so that removing,
// duplicating, or moving its registration fails this regression.
const postgresqlProductDispatchSuite = Object.freeze(
  'tests/postgresql-product-dispatch.test.mjs',
);
const postgresqlProductDispatchPredecessor = Object.freeze(
  'tests/postgresql-e2e.test.mjs',
);
const postgresqlProductDispatchSuccessor = Object.freeze(
  'tests/postgresql-structure-scan.test.mjs',
);

// The K4c canonical-CI source-local safety regressions (KaleidoSphere issue #177): the two
// previously omitted safety suites must be both content-addressed in the source map and
// canonically registered exactly once, in deterministic codepoint order within the
// release-test family. The predecessor/successor anchors pin each exact codepoint slot so
// that removing, duplicating, or reordering either registration fails this regression.
const k4cCiFamily = Object.freeze({
  boundedExternalWait: 'tests/release/k4c-bounded-external-wait.test.mjs',
  codexCleanBoundary: 'tests/release/k4c-codex-clean-boundary.test.mjs',
});
const k4cBoundedExternalWaitPredecessor = Object.freeze(
  'tests/release/k4c-anonymous-directory-readback.test.mjs',
);
const k4cBoundedExternalWaitSuccessor = Object.freeze(
  'tests/release/k4c-codex-clean-boundary.test.mjs',
);
const k4cCodexCleanBoundaryPredecessor = Object.freeze(
  'tests/release/k4c-bounded-external-wait.test.mjs',
);
const k4cCodexCleanBoundarySuccessor = Object.freeze(
  'tests/release/k4c-terminal-evidence-classifier.test.mjs',
);

const predecessorEvidenceSha256 = Object.freeze({
  'closure-audits/PORTFOLIO-KS146-ROOT-QS/exact-head-local-gate-receipt.json':
    '314459ef8ee132efb924c3aa95767127a94d20d91403747ac443b4706810c918',
  'verification/business-bi-net-revenue-holdout-v1.json':
    '9a962e48ea2d4252d208a03900a92bb4e0d337b9ae30fc2819b7dcce4ba445e7',
});

const integrationAuditPath =
  'closure-audits/PORTFOLIO-KS147-ROOT-QS/exact-head-local-gate-receipt.json';
const parentIntegrationAuditPath =
  'closure-audits/PORTFOLIO-KS143-ROOT-QS/exact-head-local-gate-receipt.json';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('tracked source and derived Oracle bytes match the content-addressed source map', async () => {
  const sourceMap = JSON.parse(await readFile('SOURCE-MAP.json', 'utf8'));
  assert.equal(sourceMap.sourceCommit, 'cee9fd5835ac3527af54b5974b5d53414eac88d8');
  assert.equal(sourceMap.oracleSourceCommit, '7a483ad9db76f6233b166874447693d28e8ac942');
  assert.deepStrictEqual(
    sourceMap.releasePathClasses.businessBiFalsification,
    businessBiFalsificationPathClasses,
  );
  const classifiedPaths = Object.values(businessBiFalsificationPathClasses).flat();
  assert.equal(new Set(classifiedPaths).size, classifiedPaths.length);
  assert.equal(classifiedPaths.length, 7);
  assert.equal(sourceMap.files['SOURCE-MAP.json'], undefined);
  assert.equal(sourceMap.files[integrationAuditPath], undefined);
  assert.equal(sourceMap.files[parentIntegrationAuditPath], undefined);
  assert.equal(classifiedPaths.includes('SOURCE-MAP.json'), false);
  assert.equal(classifiedPaths.includes(integrationAuditPath), false);
  assert.equal(classifiedPaths.includes(parentIntegrationAuditPath), false);
  for (const file of businessBiFiles) {
    assert.match(sourceMap.files[file] ?? '', /^[a-f0-9]{64}$/, file);
  }
  for (const file of classifiedPaths) {
    assert.match(sourceMap.files[file] ?? '', /^[a-f0-9]{64}$/, file);
  }
  for (const [file, expected] of Object.entries(sourceMap.files)) {
    const actual = sha256(await readFile(file));
    assert.equal(actual, expected, file);
  }
});

test('the three-test business BI predecessor family remains registered once and contiguously', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const canonicalTokens = pkg.scripts.test.split(/\s+/);
  assert.deepStrictEqual(canonicalTokens.slice(0, 3), [
    'node',
    '--test',
    historicalEnvironmentTestSkip,
  ]);
  const canonicalTests = canonicalTokens.slice(3);
  const start = canonicalTests.indexOf(canonicalFocusedFamily[0]);
  assert.notEqual(start, -1);
  assert.deepStrictEqual(
    canonicalTests.slice(start, start + canonicalFocusedFamily.length),
    canonicalFocusedFamily,
  );
  for (const file of canonicalFocusedFamily) {
    assert.equal(canonicalTests.filter((candidate) => candidate === file).length, 1, file);
  }
});

test('the E-BI-1 parent test is registered once through the canonical source gate', async () => {
  const [pkg, source, sourceMap] = await Promise.all([
    readFile('package.json', 'utf8').then(JSON.parse),
    readFile('tests/source-map.test.mjs', 'utf8'),
    readFile('SOURCE-MAP.json', 'utf8').then(JSON.parse),
  ]);
  const canonicalTests = pkg.scripts.test.split(/\s+/).slice(3);
  assert.equal(canonicalTests.includes(parentClosureTest), false);
  assert.equal(
    (source.match(/import '\.\/business-bi-epic-closure\.test\.mjs';/g) ?? []).length,
    1,
  );
  assert.match(sourceMap.files[parentClosureTest] ?? '', /^[a-f0-9]{64}$/);
});

test('the accepted #146 evidence bytes remain exact and outside the self-binding map', async () => {
  const sourceMap = JSON.parse(await readFile('SOURCE-MAP.json', 'utf8'));
  for (const [file, expected] of Object.entries(predecessorEvidenceSha256)) {
    assert.equal(sha256(await readFile(file)), expected, file);
  }
  assert.equal(
    sourceMap.files['verification/business-bi-net-revenue-holdout-v1.json'],
    predecessorEvidenceSha256['verification/business-bi-net-revenue-holdout-v1.json'],
  );
  assert.equal(
    sourceMap.files['closure-audits/PORTFOLIO-KS146-ROOT-QS/exact-head-local-gate-receipt.json'],
    undefined,
  );
});

test('the PostgreSQL and K4c source-local CI families are content-addressed and their suites are canonically registered once', async () => {
  const [pkg, sourceMap] = await Promise.all([
    readFile('package.json', 'utf8').then(JSON.parse),
    readFile('SOURCE-MAP.json', 'utf8').then(JSON.parse),
  ]);
  // The PostgreSQL C1 runtime/test/evidence family is content-addressed: each bound
  // byte set matches on disk.
  for (const file of Object.values(postgresqlC1Family)) {
    assert.match(sourceMap.files[file] ?? '', /^[a-f0-9]{64}$/, file);
    assert.equal(sha256(await readFile(file)), sourceMap.files[file], file);
  }
  // The product-dispatch suite is content-addressed: its bytes are bound in the source
  // map and match on disk.
  assert.match(
    sourceMap.files[postgresqlProductDispatchSuite] ?? '',
    /^[a-f0-9]{64}$/,
    postgresqlProductDispatchSuite,
  );
  assert.equal(
    sha256(await readFile(postgresqlProductDispatchSuite)),
    sourceMap.files[postgresqlProductDispatchSuite],
    postgresqlProductDispatchSuite,
  );
  // ... and canonically registered exactly once, at its codepoint-sorted slot in the
  // PostgreSQL family: immediately after its predecessor and before its successor, so
  // removing, duplicating, or moving the registration fails this regression.
  const canonicalTests = pkg.scripts.test.split(/\s+/).slice(3);
  assert.equal(
    canonicalTests.filter((candidate) => candidate === postgresqlProductDispatchSuite).length,
    1,
    postgresqlProductDispatchSuite,
  );
  const slot = canonicalTests.indexOf(postgresqlProductDispatchSuite);
  assert.notEqual(slot, -1);
  assert.equal(
    canonicalTests[slot - 1],
    postgresqlProductDispatchPredecessor,
    'predecessor must be the codepoint-sorted PostgreSQL e2e suite',
  );
  assert.equal(
    canonicalTests[slot + 1],
    postgresqlProductDispatchSuccessor,
    'successor must be the codepoint-sorted PostgreSQL structure-scan suite',
  );
  // The K4c CI safety pair is content-addressed and canonically registered exactly once,
  // each at its deterministic codepoint slot within the release-test family, so removing,
  // duplicating, or reordering either registration fails this regression.
  for (const file of Object.values(k4cCiFamily)) {
    assert.match(sourceMap.files[file] ?? '', /^[a-f0-9]{64}$/, file);
    assert.equal(sha256(await readFile(file)), sourceMap.files[file], file);
    assert.equal(
      canonicalTests.filter((candidate) => candidate === file).length,
      1,
      file,
    );
  }
  const k4cBoundedSlot = canonicalTests.indexOf(k4cCiFamily.boundedExternalWait);
  assert.notEqual(k4cBoundedSlot, -1);
  assert.equal(
    canonicalTests[k4cBoundedSlot - 1],
    k4cBoundedExternalWaitPredecessor,
    'predecessor must be the codepoint-sorted anonymous directory readback suite',
  );
  assert.equal(
    canonicalTests[k4cBoundedSlot + 1],
    k4cBoundedExternalWaitSuccessor,
    'successor must be the codepoint-sorted clean-boundary suite',
  );
  const k4cCleanBoundarySlot = canonicalTests.indexOf(k4cCiFamily.codexCleanBoundary);
  assert.notEqual(k4cCleanBoundarySlot, -1);
  assert.equal(
    canonicalTests[k4cCleanBoundarySlot - 1],
    k4cCodexCleanBoundaryPredecessor,
    'predecessor must be the codepoint-sorted bounded external-wait suite',
  );
  assert.equal(
    canonicalTests[k4cCleanBoundarySlot + 1],
    k4cCodexCleanBoundarySuccessor,
    'successor must be the codepoint-sorted terminal evidence classifier suite',
  );
});
