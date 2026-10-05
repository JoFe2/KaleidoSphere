import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadH05SharedRuntimeSourceV1, releaseH05SharedRuntimeSourceV1,
  getH05SharedRuntimeApisV1 } from '../services/bi-control/src/runtime/h05-shared-runtime-source.mjs';
const module = await import('../services/bi-control/src/runtime/h05-native-resource-store.mjs').catch(() => ({}));
const sourceRoot = process.env.KS_H05_PAN_SOURCE_ROOT ?? resolve('../PANSPHAIRA');
test('H05 owns a durable native KS ledger and constructs receipts with unchanged CCP semantics', async () => {
  assert.equal(typeof module.createH05NativeResourceStoreV1, 'function', 'actual KS-native resource store missing');
  const source = await loadH05SharedRuntimeSourceV1({ optIn: true, sourceRoot });
  const stateRoot = mkdtempSync(join(tmpdir(), 'ks295-resource-store-'));
  let store, db;
  const options = { optIn: true, stateRoot, tenantId: 'tenant:synthetic-zoo', bindingDigest: 'a'.repeat(64),
    limits: { modelUnits: 64, runtimeUnits: 1 } };
  const request = { operationId: 'operation:ks-store-0001', requestDigest: 'b'.repeat(64), modelUnits: 64, runtimeUnits: 1 };
  try {
    store = module.createH05NativeResourceStoreV1(source, options);
    const budget = store.snapshot();
    assert.equal(budget.model.repositoryId, 'repository:kaleidosphere');
    assert.equal(budget.model.ledgerId, 'ledger:ks295-native');
    assert.equal(budget.model.budgetId, 'budget:ks295-model');
    assert.equal(budget.model.contributionId, 'contribution:ks295-runtime');
    const shared = getH05SharedRuntimeApisV1(source);
    assert.deepEqual(shared.budget.parseCcpCostBudgetV1(budget.model), budget.model);
    assert.equal(store.reserve(request).replayed, false);
    assert.equal(store.reserve(request).replayed, true);
    assert.equal(store.markUnknownUsage(request.operationId).dispatchGranted, true);
    store.close(); store = module.createH05NativeResourceStoreV1(source, options);
    assert.equal(store.reserve(request).replayed, true);
    assert.equal(store.markUnknownUsage(request.operationId).dispatchGranted, false);
    assert.equal(store.snapshot().model.committedUnits, 64);
    assert.equal(store.snapshot().runtime.committedUnits, 1);
    const completion = store.ownerCompletionEvidence({ operationId: request.operationId, requestDigest: request.requestDigest,
      modelUnits: 5, runtimeUnits: 1, evidenceDigest: 'c'.repeat(64) });
    assert.equal(store.settle(completion).state, 'SETTLED');
    assert.equal(store.settle(completion).model_consumed, 5);
    db = new DatabaseSync(join(stateRoot, 'ks295-resource-budget.sqlite'), { readOnly: true });
    const sql = db.prepare('SELECT count(*) AS rows,sum(model_consumed) AS model,sum(runtime_consumed) AS runtime FROM reservations').get();
    assert.deepEqual({ ...sql }, { rows: 1, model: 5, runtime: 1 });
    assert.equal(store.snapshot().model.remainingUnits, 59);
    assert.equal(store.snapshot().runtime.remainingUnits, 0);
  } finally { db?.close(); store?.close(); releaseH05SharedRuntimeSourceV1(source); rmSync(stateRoot, { recursive: true, force: true }); }
});
