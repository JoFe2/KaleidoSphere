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
const parentClosureTest = 'tests/business-bi-epic-closure.test.mjs';

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
  const canonicalTests = pkg.scripts.test.split(/\s+/).slice(2);
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
  const canonicalTests = pkg.scripts.test.split(/\s+/).slice(2);
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
