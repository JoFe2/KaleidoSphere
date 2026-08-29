import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {
  auditSafeAnalysisQuery,
  validateSafeAnalysisMethodManifest,
} from '../services/bi-control/src/db-analyzer/safe-analysis-methods.mjs';

const ROOT = 'services/bi-control/query-packs/db-analyzer/v1';
const RECEIPT = 'docs/evidence/conveyor/ks67-aggregate-profiling-closure-v1.json';
const ENGINES = ['mssql', 'oracle'];

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function pack(engine) {
  const directory = `${ROOT}/${engine}`;
  const manifest = await readJson(`${directory}/safe-analysis-manifest.json`);
  const sqlByMethodId = Object.fromEntries(await Promise.all(manifest.methods.map(async (method) => [
    method.id,
    await readFile(`${directory}/${method.file}`, 'utf8'),
  ])));
  return {directory, manifest, sqlByMethodId};
}

test('KS67 closure receipt binds the existing protected delivery without widening authority', async () => {
  const receipt = await readJson(RECEIPT);
  assert.equal(receipt.schemaVersion, 'kaleidosphere/evidence/ks67-aggregate-profiling-closure/v1');
  assert.equal(receipt.issue, 67);
  assert.equal(receipt.reuse.sourceIssue, 38);
  assert.equal(receipt.reuse.pullRequest, 45);
  assert.equal(receipt.reuse.release, 'v0.14.0');
  assert.equal(receipt.currentMainBase, '3cb45cf19ddcebc479ff29dee2e919835fea1229');
  assert.deepEqual(receipt.engines, ENGINES);
  assert.deepEqual(receipt.nonClaims, [
    'NO_STATISTICAL_PRIVACY_THEOREM',
    'NO_RAW_SAMPLES_OR_SENSITIVE_VALUE_EXPORT',
    'NO_ARBITRARY_SQL_OR_MUTATION',
    'NO_LIVE_CUSTOMER_PERFORMANCE_CLAIM',
  ]);
});

test('MSSQL and Oracle aggregate manifests preserve exact semantic parity and closed privacy bounds', async () => {
  const packs = await Promise.all(ENGINES.map(pack));
  const semantics = [];
  for (const {manifest, sqlByMethodId} of packs) {
    assert.equal(validateSafeAnalysisMethodManifest(manifest, sqlByMethodId), manifest);
    semantics.push(manifest.methods.map(({semanticMethod}) => semanticMethod).sort());
    for (const method of manifest.methods) {
      assert.equal(auditSafeAnalysisQuery({manifest, method, sql: sqlByMethodId[method.id]}), true);
      assert.equal(method.readOnly, true);
      assert.equal(method.aggregateOnly, true);
      assert.equal(method.rowSamples, false);
      assert.equal(method.exampleValues, false);
      assert.equal(method.maxOutputRows, 1);
      assert.ok(method.maxSourceRows > 0 && method.maxSourceRows <= 10_000);
      assert.ok(method.timeoutMs > 0 && method.timeoutMs <= 10_000);
      assert.deepEqual(method.argumentKeys, ['maxSourceRows', 'typeFamily']);
    }
  }
  assert.deepEqual(semantics[0], semantics[1]);
});

test('unsupported Oracle boolean profiling remains explicit fail-closed evidence', async () => {
  const {manifest} = await pack('oracle');
  const summary = manifest.methods.find(({semanticMethod}) => semanticMethod === 'COLUMN_SUMMARY');
  const boolean = summary.capabilities.find(({typeFamily}) => typeFamily === 'BOOLEAN');
  assert.deepEqual(boolean, {
    typeFamily: 'BOOLEAN',
    state: 'UNSUPPORTED',
    reasonCode: 'ORACLE_NATIVE_BOOLEAN_COLUMN_UNSUPPORTED',
  });
});
