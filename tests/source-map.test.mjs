import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const businessBiFiles = Object.freeze([
  'contracts/business-bi/v1/net-revenue.metric.json',
  'scripts/run-business-bi-holdout-clean-room.mjs',
  'services/bi-control/src/business-bi/net-revenue-plan.mjs',
  'services/bi-control/src/business-bi/net-revenue-readback.mjs',
  'tests/business-bi-metric-oracle.test.mjs',
  'tests/business-bi-net-revenue-plan.test.mjs',
  'tests/fixtures/business-bi/net-revenue-holdout-v1.json',
  'tests/fixtures/business-bi/net-revenue-oracle-v1.json',
  'verification/business-bi-net-revenue-holdout-v1.json',
]);

test('tracked source and derived Oracle bytes match the content-addressed source map', async () => {
  const sourceMap = JSON.parse(await readFile('SOURCE-MAP.json', 'utf8'));
  assert.equal(sourceMap.sourceCommit, 'cee9fd5835ac3527af54b5974b5d53414eac88d8');
  assert.equal(sourceMap.oracleSourceCommit, '7a483ad9db76f6233b166874447693d28e8ac942');
  for (const file of businessBiFiles) {
    assert.match(sourceMap.files[file] ?? '', /^[a-f0-9]{64}$/, file);
  }
  for (const [file, expected] of Object.entries(sourceMap.files)) {
    const actual = createHash('sha256').update(await readFile(file)).digest('hex');
    assert.equal(actual, expected, file);
  }
});
