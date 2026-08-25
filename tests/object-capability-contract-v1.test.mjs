import assert from 'node:assert/strict';
import test from 'node:test';

import {
  KS_OBJECT_CAPABILITY_CONTRACT_SCHEMA,
  buildObjectCapabilityContractV1,
  validateObjectCapabilityContractV1,
} from '../services/bi-agent/src/object-capability-contract-v1.mjs';

const H = (character) => character.repeat(64);

const bindings = (overrides = {}) => ({
  engine: 'mssql',
  snapshotSha256: H('1'),
  receiptSha256: H('2'),
  coverageSha256: H('3'),
  inventoryAuthoritySha256: H('4'),
  relationKindAuthoritySha256: H('5'),
  objectNameAuthoritySha256: H('6'),
  cancellationSha256: H('7'),
  ...overrides,
});

const request = (capabilityId, overrides = {}) => ({
  schemaVersion: 'kaleidosphere.object-capabilities/request/v1',
  requestId: `request-${capabilityId.split('.').at(-1)}`,
  capabilityId,
  bindings: bindings(),
  scope: {schemas: ['dbo']},
  ...overrides,
});

const result = (capabilityId, overrides = {}) => ({
  schemaVersion: 'kaleidosphere.object-capabilities/result/v1',
  requestSha256: H('8'),
  capabilityId,
  state: 'PROJECTED_READ_ONLY',
  projectionSha256: H('9'),
  bindings: bindings(),
  claims: {
    absenceClaimed: false,
    completenessClaimed: false,
    replayPreventionClaimed: false,
    sourceRowsIncluded: false,
  },
  authority: {
    credentialsIncluded: false,
    dispatchAuthority: false,
    executionAuthority: false,
    mutationAuthority: false,
    queryExecution: false,
    rawValuesIncluded: false,
    sqlAuthority: false,
  },
  ...overrides,
});

const C = Object.freeze({
  search: 'bi.object.search.read',
  details: 'bi.object.details.read',
  overview: 'bi.database.overview.read',
});

test('M2.2 contract freezes three separate read-only object capabilities without widening External API v2', () => {
  const contract = buildObjectCapabilityContractV1();
  assert.equal(contract.schemaVersion, KS_OBJECT_CAPABILITY_CONTRACT_SCHEMA);
  assert.deepEqual(contract.capabilities.map(({id}) => id), Object.values(C));
  assert.deepEqual(contract.capabilities.map(({projectionSchema}) => projectionSchema), [
    'chimpmaera.db/object-search-authority-bound-result/v1',
    'kaleidosphere.analysis/object-details-projection/v1',
    'kaleidosphere.analysis/database-overview-projection/v1',
  ]);
  assert.equal(contract.integration.externalApiV2Changed, false);
  assert.deepEqual(contract.integration.externalApiV2Actions, ['status', 'discovery', 'analyze', 'plan', 'preview', 'readback']);
  assert.equal(contract.boundaries.freeSqlAccepted, false);
  assert.equal(contract.boundaries.handlerDispatchIncluded, false);
  assert.equal(validateObjectCapabilityContractV1(contract), contract);
  assert(Object.isFrozen(contract));
});

test('M2.2 validator accepts exact deterministic request and result bindings for each capability', () => {
  const contract = buildObjectCapabilityContractV1();
  for (const id of Object.values(C)) {
    assert.deepEqual(contract.validateRequest(request(id), {capabilityId: id, bindings: bindings(), scope: {schemas: ['dbo']}}), request(id));
    assert.deepEqual(contract.validateResult(result(id), {capabilityId: id, requestSha256: H('8'), projectionSha256: H('9'), bindings: bindings()}), result(id));
  }
  assert.equal(JSON.stringify(buildObjectCapabilityContractV1()), JSON.stringify(contract));
});

test('M2.2 request validation fails closed for substitution, stale binding, scope escape, oversize, cancellation drift and unsafe fields', () => {
  const {validateRequest} = buildObjectCapabilityContractV1();
  const cases = [
    request(C.search, {capabilityId: C.details}),
    request(C.search, {bindings: bindings({snapshotSha256: H('0')})}),
    request(C.search, {scope: {schemas: ['../escape']}}),
    request(C.search, {scope: {schemas: ['other']}}),
    request(C.search, {scope: {schemas: Array.from({length: 257}, (_, i) => `s${i}`)}}),
    request(C.search, {bindings: bindings({cancellationSha256: H('0')})}),
    {...request(C.search), sql: 'SELECT 1'},
    {...request(C.search), credentials: 'secret'},
    {...request(C.search), rawRows: []},
    {...request(C.search), callback: 'https://evil.invalid'},
  ];
  for (const value of cases) assert.throws(() => validateRequest(value, {capabilityId: C.search, bindings: bindings(), scope: {schemas: ['dbo']}}));
});

test('M2.2 result validation denies binding drift, tamper and every authority or claim widening', () => {
  const {validateResult} = buildObjectCapabilityContractV1();
  const cases = [
    result(C.details),
    result(C.overview, {projectionSha256: H('0')}),
    result(C.overview, {bindings: bindings({coverageSha256: H('0')})}),
    result(C.overview, {claims: {...result(C.overview).claims, completenessClaimed: true}}),
    result(C.overview, {claims: {...result(C.overview).claims, sourceRowsIncluded: true}}),
    result(C.overview, {authority: {...result(C.overview).authority, sqlAuthority: true}}),
    result(C.overview, {authority: {...result(C.overview).authority, dispatchAuthority: true}}),
    result(C.overview, {authority: {...result(C.overview).authority, mutationAuthority: true}}),
    {...result(C.overview), token: 'secret'},
  ];
  for (const value of cases) assert.throws(() => validateResult(value, {capabilityId: C.overview, requestSha256: H('8'), projectionSha256: H('9'), bindings: bindings()}));
});

test('review follow-up rejects stateful Proxy inputs before any trap and cannot return a widened result', () => {
  const {validateRequest, validateResult} = buildObjectCapabilityContractV1();
  let traps = 0;
  const statefulClaims = new Proxy(result(C.overview).claims, {
    get(target, key, receiver) { traps += 1; return traps <= 4 ? false : Reflect.get(target, key, receiver); },
    getPrototypeOf(target) { traps += 1; return Reflect.getPrototypeOf(target); },
    ownKeys(target) { traps += 1; return Reflect.ownKeys(target); },
  });
  assert.throws(() => validateResult(result(C.overview, {claims: statefulClaims}), {
    capabilityId: C.overview, requestSha256: H('8'), projectionSha256: H('9'), bindings: bindings(),
  }));
  assert.equal(traps, 0);

  for (const [value, call] of [
    [new Proxy(request(C.search), {getPrototypeOf() { traps += 1; return Object.prototype; }}), (item) => validateRequest(item, {capabilityId: C.search, bindings: bindings(), scope: {schemas: ['dbo']}})],
    [result(C.search, {bindings: new Proxy(bindings(), {ownKeys(target) { traps += 1; return Reflect.ownKeys(target); }})}), (item) => validateResult(item, {capabilityId: C.search, requestSha256: H('8'), projectionSha256: H('9'), bindings: bindings()})],
  ]) assert.throws(() => call(value));
  assert.equal(traps, 0);
});

test('review follow-up rejects non-enumerable and symbol keys on closed request and result surfaces', () => {
  const {validateRequest, validateResult} = buildObjectCapabilityContractV1();
  const hidden = request(C.search);
  Object.defineProperty(hidden, 'credentials', {value: 'secret', enumerable: false});
  assert.throws(() => validateRequest(hidden, {capabilityId: C.search, bindings: bindings(), scope: {schemas: ['dbo']}}));

  const symbol = result(C.overview);
  symbol[Symbol('secret')] = 'hidden';
  assert.throws(() => validateResult(symbol, {
    capabilityId: C.overview, requestSha256: H('8'), projectionSha256: H('9'), bindings: bindings(),
  }));
});
