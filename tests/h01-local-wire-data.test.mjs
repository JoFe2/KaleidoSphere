import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

// KS data conversion only. No portable contract schema, runtime identity or grant.
test('H01 observed wire data is bounded plain JSON without input behavior or prototype pollution', async () => {
  const module = new URL('../scripts/lib/h01-local-wire-data.mjs', import.meta.url);
  assert.ok(existsSync(module), 'KS safe plain wire JSON adapter must exist');
  const { readLocalObservedWireJson } = await import(module);
  const input = JSON.parse('{"runtime":{"version":"6.1.0"},"roles":["superset"],"__proto__":{"polluted":true}}');
  const wire = readLocalObservedWireJson(input);
  assert.equal(Object.getPrototypeOf(wire), Object.prototype);
  assert.equal(Object.getPrototypeOf(wire.runtime), Object.prototype);
  assert.equal(Object.getPrototypeOf(wire.roles), Array.prototype);
  assert.deepEqual(wire, input);
  assert.equal(Object.prototype.polluted, undefined);
  assert.ok(Object.hasOwn(wire, '__proto__'));
  input.runtime.version = 'changed-after-copy';
  assert.equal(wire.runtime.version, '6.1.0');
  let callbacks = 0;
  const getter = {};
  Object.defineProperty(getter, 'value', { enumerable: true, get() { callbacks++; return 1; } });
  const proxy = new Proxy({}, { ownKeys() { callbacks++; return []; }, getPrototypeOf() { callbacks++; return Object.prototype; }, get() { callbacks++; return undefined; } });
  for (const value of [getter, proxy, { toJSON() { callbacks++; return {}; } }, { nested: getter }, { nested: proxy }]) {
    assert.throws(() => readLocalObservedWireJson(value), /H01_OBSERVED_DATA_DENIED/);
  }
  assert.equal(callbacks, 0, 'No getter, proxy trap or toJSON callback may run');
  assert.throws(() => readLocalObservedWireJson({ text: 'x'.repeat(4097) }), /H01_OBSERVED_DATA_DENIED/);
  assert.throws(() => readLocalObservedWireJson({ value: Infinity }), /H01_OBSERVED_DATA_DENIED/);
  const cyclic = {}; cyclic.self = cyclic;
  assert.throws(() => readLocalObservedWireJson(cyclic), /H01_OBSERVED_DATA_DENIED/);
});
