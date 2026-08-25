import assert from 'node:assert/strict';

const H0 = '0'.repeat(64);

function deepFrozen(value) {
  if (!value || typeof value !== 'object' || ArrayBuffer.isView(value)) return true;
  return Object.isFrozen(value) && Object.values(value).every(deepFrozen);
}

export function runCapabilityAdversarialMatrixV1({
  request,
  invokeWithRequest,
  otherCapabilityId,
}) {
  const baselineRequest = structuredClone(request);
  const baseline = invokeWithRequest(baselineRequest);
  const baselineJson = JSON.stringify(baseline);
  assert.ok(deepFrozen(baseline), 'returned result must be deeply frozen');
  assert.notEqual(baseline.bindings ?? baseline.envelope?.bindings, baselineRequest.bindings, 'result bindings are isolated');

  const substitutions = [
    ['capabilityId', (copy) => { copy.capabilityId = otherCapabilityId; }],
    ['scope', (copy) => { copy.scope = {schemas: ['other']}; }],
    ['engine', (copy) => { copy.bindings.engine = copy.bindings.engine === 'mssql' ? 'oracle' : 'mssql'; }],
    ...Object.keys(request.bindings)
      .filter((key) => key !== 'engine')
      .map((key) => [key, (copy) => { copy.bindings[key] = H0; }]),
    ['synthetic-not-applicable', (copy) => { copy.bindings.syntheticNotApplicableSha256 = H0; }],
  ];
  for (const [label, mutate] of substitutions) {
    const copy = structuredClone(request);
    mutate(copy);
    assert.throws(() => invokeWithRequest(copy), `unchanged authority must deny ${label}`);
  }

  const mutable = structuredClone(request);
  const isolated = invokeWithRequest(mutable);
  const digestKey = Object.keys(mutable.bindings).find((key) => key !== 'engine');
  mutable.bindings[digestKey] = H0;
  mutable.scope.schemas[0] = 'mutated';
  assert.equal(JSON.stringify(isolated), baselineJson, 'post-validation request mutation cannot alter result');

  let traps = 0;
  const proxy = new Proxy(structuredClone(request), {
    getPrototypeOf() { traps += 1; return Object.prototype; },
    ownKeys(target) { traps += 1; return Reflect.ownKeys(target); },
  });
  assert.throws(() => invokeWithRequest(proxy), 'Proxy request denied');
  assert.equal(traps, 0, 'Proxy traps are not invoked');

  const hidden = structuredClone(request);
  Object.defineProperty(hidden, 'credentials', {value: 'secret', enumerable: false});
  assert.throws(() => invokeWithRequest(hidden), 'hidden field denied');

  const symbol = structuredClone(request);
  symbol[Symbol('secret')] = 'hidden';
  assert.throws(() => invokeWithRequest(symbol), 'symbol field denied');

  let getterCalls = 0;
  const accessor = structuredClone(request);
  const key = Object.keys(accessor.bindings).find((item) => item !== 'engine');
  Object.defineProperty(accessor.bindings, key, {
    enumerable: true,
    get() { getterCalls += 1; return request.bindings[key]; },
  });
  assert.throws(() => invokeWithRequest(accessor), 'accessor field denied');
  assert.equal(getterCalls, 0, 'accessor is not invoked');
}
