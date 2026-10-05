import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const module = await import('../services/bi-control/src/runtime/h05-shared-runtime-source.mjs').catch(() => ({}));
test('H05 imports the exact development closure privately without granting runtime authority', async () => {
  assert.equal(typeof module.loadH05SharedRuntimeSourceV1, 'function', 'actual H05 shared-source loader missing');
  const sourceRoot = process.env.KS_H05_PAN_SOURCE_ROOT ?? resolve('../PANSPHAIRA');
  const source = await module.loadH05SharedRuntimeSourceV1({ optIn: true, sourceRoot });
  try {
    assert.equal(source.producerCommit, '6be212953b2cb52f46347e10132d13b95f881f29');
    assert.equal(source.producerTree, '3b8d7b6b5f29fe4b0736a00d3db5dd380bfefcef');
    assert.equal(source.descriptorSha256, '4f8ed30d2446639fa4f3b28589a8c9ef362ca8b1083f702fabcc40d22b887255');
    assert.equal(source.executionAuthorityGranted, false);
    assert.equal(source.PANOwnerStoreQualifiedAsKSLedger, false);
    const api = module.getH05SharedRuntimeApisV1(source);
    assert.equal(typeof api.budget.makeCcpCostBudgetV1, 'function');
    assert.equal(typeof api.envelope.readCcpClosedObjectV1, 'function');
    assert.equal(typeof api.broker.ModelAccessBrokerV1, 'function');
    assert.equal(typeof api.templates.planRuntimeTemplateV1, 'function');
    assert.equal(Object.hasOwn(api, 'createResourceBudgetStoreV1'), false);
    assert.throws(() => module.getH05SharedRuntimeApisV1({ ...source }), /H05_PAN_SHARED_SOURCE_DENIED/);
  } finally { module.releaseH05SharedRuntimeSourceV1(source); }
  assert.throws(() => module.getH05SharedRuntimeApisV1(source), /H05_PAN_SHARED_SOURCE_DENIED/);
});
