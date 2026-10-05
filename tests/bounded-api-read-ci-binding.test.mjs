import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const family = [
  'services/bi-control/src/db-analyzer/bounded-api-read-workflow.mjs',
  'services/bi-control/src/db-analyzer/workflow.mjs',
  'tests/bounded-api-read-product.test.mjs',
  'tests/bounded-api-read-ci-binding.test.mjs',
  'scripts/update-bounded-api-read-source-map.mjs',
  'docs/evidence/bounded-api-read-local-v1.md',
  'verification/bounded-api-read-local-v1.json',
];
test('K07 local HTTP scope is content-addressed, reached once and mandatory in CI without real-target promotion', async () => {
  const map = JSON.parse(await readFile('SOURCE-MAP.json', 'utf8'));
  for (const name of family) {
    assert.match(map.files[name] ?? '', /^[a-f0-9]{64}$/, name);
    assert.equal(createHash('sha256').update(await readFile(name)).digest('hex'), map.files[name], name);
  }
  const parent = await readFile('tests/source-map.test.mjs', 'utf8');
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  for (const suite of ['bounded-api-read-product.test.mjs', 'bounded-api-read-ci-binding.test.mjs']) {
    assert.equal(parent.split("import './" + suite + "';").length - 1, 1);
    assert.equal(pkg.scripts.test.split(/\s+/).includes('tests/' + suite), false);
  }
  const ci = await readFile('.github/workflows/ci.yml', 'utf8');
  assert.match(ci, /node --test --test-concurrency=1 tests\/bounded-api-read-product\.test\.mjs tests\/bounded-api-read-ci-binding\.test\.mjs/);
  const proof = JSON.parse(await readFile('verification/bounded-api-read-local-v1.json', 'utf8'));
  assert.equal(proof.actualRun.exit, 0);
  assert.equal(proof.actualRun.counts.fail, 0);
  assert.equal(proof.actualAuthorizedTargetSelected, false);
  assert.equal(proof.actualVendorQualified, false);
  assert.equal(proof.wholeIssueComplete, false);
  assert.equal(proof.localFixtureSubstitutesForAC4, false);
  assert.equal(proof.originalCriteria.find((entry) => entry.id === 'AC4').state, 'BLOCKED_EXTERNAL_AUTHORIZED_TARGET_ACCESS_DATA');
  for (const [name, digest] of Object.entries(proof.sourcePins)) {
    assert.equal(createHash('sha256').update(await readFile(name)).digest('hex'), digest, name);
  }
});
