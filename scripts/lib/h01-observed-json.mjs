import { types } from 'node:util';

// Bounded data-only decoder for KS local observation/adaptor helpers. No proxy,
// accessor, inherited behavior or toJSON callback is consulted. This is NOT a
// shared portable runtime contract and cannot create an admission or permission.
export function readBoundedObservedJson(input) {
  const seen = new Set();
  let nodes = 0;
  const deny = () => { throw new Error('H01_OBSERVED_DATA_DENIED'); };
  function read(value, depth) {
    if (++nodes > 20000 || depth > 16) deny();
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      if (value.length > 4096) deny();
      return value;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) deny();
      return value;
    }
    if (typeof value !== 'object' || types.isProxy(value) || seen.has(value)) deny();
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) deny();
    seen.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some(key => typeof key !== 'string' || key.length > 4096)) deny();
    if (array) {
      const length = descriptors.length?.value;
      if (!Number.isSafeInteger(length) || length < 0 || length > 10000 || keys.length !== length + 1) deny();
      const out = [];
      for (let i = 0; i < length; i += 1) {
        const d = descriptors[String(i)];
        if (!d || !Object.hasOwn(d, 'value') || !d.enumerable) deny();
        out.push(read(d.value, depth + 1));
      }
      return out;
    }
    const out = Object.create(null);
    for (const key of keys) {
      const d = descriptors[key];
      if (!Object.hasOwn(d, 'value') || !d.enumerable) deny();
      out[key] = read(d.value, depth + 1);
    }
    return out;
  }
  return read(input, 0);
}
