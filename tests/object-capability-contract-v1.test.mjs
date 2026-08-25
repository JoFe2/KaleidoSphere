import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {
  KS_OBJECT_CAPABILITY_CONTRACT_SCHEMA,
  buildObjectCapabilityContractV1,
  getObjectCapabilityBindingProfileV1,
  validateObjectCapabilityContractV1,
} from '../services/bi-agent/src/object-capability-contract-v1.mjs';

const H = (character) => character.repeat(64);
const C = Object.freeze({
  search: 'bi.object.search.read',
  details: 'bi.object.details.read',
  overview: 'bi.database.overview.read',
});
const PROFILE_KEYS = Object.freeze({
  [C.search]: [
    'engine', 'snapshotSha256', 'receiptSha256', 'coverageSha256', 'inventoryAuthoritySha256',
    'relationKindAuthoritySha256', 'objectNameAuthoritySha256', 'cancellationSha256',
  ],
  [C.details]: ['engine', 'snapshotSha256', 'receiptSha256', 'coverageSha256'],
  [C.overview]: [
    'engine', 'runStateSha256', 'snapshotSha256', 'coverageSha256', 'receiptChainSha256', 'cancellationSha256',
  ],
});

function bindings(capabilityId, overrides = {}) {
  return Object.fromEntries(PROFILE_KEYS[capabilityId].map((key, index) => [key, key === 'engine' ? 'mssql' : H(String((index + 1) % 10))])).valueOf()
    && {...Object.fromEntries(PROFILE_KEYS[capabilityId].map((key, index) => [key, key === 'engine' ? 'mssql' : H(String((index + 1) % 10))])), ...overrides};
}

const request = (capabilityId, overrides = {}) => ({
  schemaVersion: 'kaleidosphere.object-capabilities/request/v1',
  requestId: `request-${capabilityId.split('.').at(-1)}`,
  capabilityId,
  bindings: bindings(capabilityId),
  scope: {schemas: ['dbo']},
  ...overrides,
});

const result = (capabilityId, overrides = {}) => ({
  schemaVersion: 'kaleidosphere.object-capabilities/result/v1',
  requestSha256: H('8'),
  capabilityId,
  state: 'PROJECTED_READ_ONLY',
  projectionSha256: H('9'),
  bindings: bindings(capabilityId),
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

const requestAuthority = (capabilityId) => ({capabilityId, bindings: bindings(capabilityId), scope: {schemas: ['dbo']}});
const resultAuthority = (capabilityId) => ({
  capabilityId, requestSha256: H('8'), projectionSha256: H('9'), bindings: bindings(capabilityId),
});

function withHidden(value, key = 'credentials') {
  Object.defineProperty(value, key, {value: 'secret', enumerable: false});
  return value;
}

function assertDeepFrozen(value) {
  if (!value || typeof value !== 'object') return;
  assert(Object.isFrozen(value));
  Object.values(value).forEach(assertDeepFrozen);
}

test('M2.2 contract publishes three closed versioned capability-specific binding profiles without widening External API v2', () => {
  const contract = buildObjectCapabilityContractV1();
  assert.equal(contract.schemaVersion, KS_OBJECT_CAPABILITY_CONTRACT_SCHEMA);
  assert.deepEqual(contract.capabilities.map(({id}) => id), Object.values(C));
  assert.deepEqual(contract.capabilities.map(({requiredBindings}) => requiredBindings), Object.values(C).map((id) => PROFILE_KEYS[id]));
  assert.deepEqual(contract.capabilities.map(({bindingProfileSchema}) => bindingProfileSchema), [
    'kaleidosphere.object-capabilities/binding-profile/object-search/v1',
    'kaleidosphere.object-capabilities/binding-profile/object-details/v1',
    'kaleidosphere.object-capabilities/binding-profile/database-overview/v1',
  ]);
  for (const id of Object.values(C)) {
    const profile = getObjectCapabilityBindingProfileV1(id);
    assert.deepEqual(profile.requiredBindings, PROFILE_KEYS[id]);
    assertDeepFrozen(profile);
  }
  assert.equal(contract.integration.externalApiV2Changed, false);
  assert.deepEqual(contract.integration.externalApiV2Actions, ['status', 'discovery', 'analyze', 'plan', 'preview', 'readback']);
  assert.equal(contract.boundaries.freeSqlAccepted, false);
  assert.equal(contract.boundaries.handlerDispatchIncluded, false);
  assert.equal(validateObjectCapabilityContractV1(contract), contract);
  assertDeepFrozen(contract);
});

test('M2.2 validator accepts only the exact binding profile for each capability', () => {
  const contract = buildObjectCapabilityContractV1();
  for (const id of Object.values(C)) {
    assert.deepEqual(contract.validateRequest(request(id), requestAuthority(id)), request(id));
    assert.deepEqual(contract.validateResult(result(id), resultAuthority(id)), result(id));
    const extra = {...bindings(id), syntheticNotApplicableSha256: H('0')};
    assert.throws(() => contract.validateRequest(request(id, {bindings: extra}), {...requestAuthority(id), bindings: extra}));
    const missing = {...bindings(id)};
    delete missing[PROFILE_KEYS[id].at(-1)];
    assert.throws(() => contract.validateRequest(request(id, {bindings: missing}), {...requestAuthority(id), bindings: missing}));
  }
  assert.equal(JSON.stringify(buildObjectCapabilityContractV1()), JSON.stringify(contract));
});

test('M2.2 request validation fails closed for capability, profile binding, scope, oversize and unsafe surface substitution', () => {
  const {validateRequest} = buildObjectCapabilityContractV1();
  const cases = [
    request(C.search, {capabilityId: C.details}),
    request(C.search, {bindings: bindings(C.search, {snapshotSha256: H('0')})}),
    request(C.search, {scope: {schemas: ['../escape']}}),
    request(C.search, {scope: {schemas: ['other']}}),
    request(C.search, {scope: {schemas: Array.from({length: 257}, (_, i) => `s${i}`)}}),
    {...request(C.search), sql: 'SELECT 1'},
    {...request(C.search), credentials: 'secret'},
    {...request(C.search), rawRows: []},
    {...request(C.search), callback: 'https://evil.invalid'},
  ];
  for (const value of cases) assert.throws(() => validateRequest(value, requestAuthority(C.search)));
});

test('M2.2 result validation denies binding drift, tamper and every authority or claim widening', () => {
  const {validateResult} = buildObjectCapabilityContractV1();
  const cases = [
    result(C.details),
    result(C.overview, {projectionSha256: H('0')}),
    result(C.overview, {bindings: bindings(C.overview, {coverageSha256: H('0')})}),
    result(C.overview, {claims: {...result(C.overview).claims, completenessClaimed: true}}),
    result(C.overview, {claims: {...result(C.overview).claims, sourceRowsIncluded: true}}),
    result(C.overview, {authority: {...result(C.overview).authority, sqlAuthority: true}}),
    result(C.overview, {authority: {...result(C.overview).authority, dispatchAuthority: true}}),
    result(C.overview, {authority: {...result(C.overview).authority, mutationAuthority: true}}),
    {...result(C.overview), token: 'secret'},
  ];
  for (const value of cases) assert.throws(() => validateResult(value, resultAuthority(C.overview)));
});

test('review follow-up rejects Proxy, accessor, hidden and symbol inputs without invoking traps', () => {
  const {validateRequest, validateResult} = buildObjectCapabilityContractV1();
  let traps = 0;
  const proxyRequest = new Proxy(request(C.search), {
    getPrototypeOf() { traps += 1; return Object.prototype; },
    ownKeys(target) { traps += 1; return Reflect.ownKeys(target); },
  });
  assert.throws(() => validateRequest(proxyRequest, requestAuthority(C.search)));
  assert.equal(traps, 0);

  const proxyBindings = new Proxy(bindings(C.search), {ownKeys(target) { traps += 1; return Reflect.ownKeys(target); }});
  assert.throws(() => validateResult(result(C.search, {bindings: proxyBindings}), resultAuthority(C.search)));
  assert.equal(traps, 0);

  assert.throws(() => validateRequest(withHidden(request(C.search)), requestAuthority(C.search)));
  const symbol = result(C.overview);
  symbol[Symbol('secret')] = 'hidden';
  assert.throws(() => validateResult(symbol, resultAuthority(C.overview)));

  let getterCalls = 0;
  const accessorClaims = result(C.overview).claims;
  Object.defineProperty(accessorClaims, 'completenessClaimed', {
    enumerable: true,
    get() { getterCalls += 1; return getterCalls === 1 ? false : true; },
  });
  assert.throws(() => validateResult(result(C.overview, {claims: accessorClaims}), resultAuthority(C.overview)));
  assert.equal(getterCalls, 0);
});

test('validated request and result are isolated deeply frozen clones', () => {
  const {validateRequest, validateResult} = buildObjectCapabilityContractV1();
  const sourceRequest = request(C.details);
  const sourceResult = result(C.overview);
  const validatedRequest = validateRequest(sourceRequest, requestAuthority(C.details));
  const validatedResult = validateResult(sourceResult, resultAuthority(C.overview));
  assert.notEqual(validatedRequest, sourceRequest);
  assert.notEqual(validatedResult, sourceResult);
  assertDeepFrozen(validatedRequest);
  assertDeepFrozen(validatedResult);
  sourceRequest.scope.schemas[0] = 'mutated';
  sourceResult.bindings.coverageSha256 = H('0');
  assert.equal(validatedRequest.scope.schemas[0], 'dbo');
  assert.notEqual(validatedResult.bindings.coverageSha256, H('0'));
});

test('canonical npm test and protected CI execute all three handler adversarial suites', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  for (const file of [
    'tests/object-search-handler-v1.test.mjs',
    'tests/object-details-handler-v1.test.mjs',
    'tests/database-overview-handler-v1.test.mjs',
  ]) assert.match(pkg.scripts.test, new RegExp(`(?:^|\\s)${file.replaceAll('.', '\\.')}(?:\\s|$)`), file);
});
