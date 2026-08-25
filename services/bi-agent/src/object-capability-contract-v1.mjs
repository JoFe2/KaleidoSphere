import {canonicalJson} from './external-api-v2.mjs';

export const KS_OBJECT_CAPABILITY_CONTRACT_SCHEMA = 'kaleidosphere.object-capabilities/handler-contract/v1';
export const KS_OBJECT_CAPABILITY_REQUEST_SCHEMA = 'kaleidosphere.object-capabilities/request/v1';
export const KS_OBJECT_CAPABILITY_RESULT_SCHEMA = 'kaleidosphere.object-capabilities/result/v1';

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z][A-Za-z0-9._:-]{2,127}$/;
const SCHEMA = /^[A-Za-z][A-Za-z0-9_$#]{0,127}$/;
const CAPABILITIES = Object.freeze([
  Object.freeze({id: 'bi.object.search.read', projectionSchema: 'chimpmaera.db/object-search-authority-bound-result/v1'}),
  Object.freeze({id: 'bi.object.details.read', projectionSchema: 'kaleidosphere.analysis/object-details-projection/v1'}),
  Object.freeze({id: 'bi.database.overview.read', projectionSchema: 'kaleidosphere.analysis/database-overview-projection/v1'}),
]);
const CAPABILITY_IDS = new Set(CAPABILITIES.map(({id}) => id));
const BINDING_KEYS = Object.freeze([
  'engine', 'snapshotSha256', 'receiptSha256', 'coverageSha256', 'inventoryAuthoritySha256',
  'relationKindAuthoritySha256', 'objectNameAuthoritySha256', 'cancellationSha256',
]);
const CLAIM_KEYS = Object.freeze(['absenceClaimed', 'completenessClaimed', 'replayPreventionClaimed', 'sourceRowsIncluded']);
const AUTHORITY_KEYS = Object.freeze([
  'credentialsIncluded', 'dispatchAuthority', 'executionAuthority', 'mutationAuthority',
  'queryExecution', 'rawValuesIncluded', 'sqlAuthority',
]);

const fail = (code) => {
  const error = new Error(code);
  error.code = code;
  throw error;
};

const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, keys, code) => {
  if (!plain(value) || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) fail(code);
};
const hash = (value) => typeof value === 'string' && HASH.test(value);
const same = (left, right) => canonicalJson(left) === canonicalJson(right);

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function validateBindings(value, expected, code) {
  exact(value, BINDING_KEYS, code);
  if (!['mssql', 'oracle'].includes(value.engine)
      || BINDING_KEYS.slice(1).some((key) => !hash(value[key]))
      || !plain(expected) || !same(value, expected)) fail(code);
  return value;
}

function validateScope(value) {
  exact(value, ['schemas'], 'KS_OBJECT_CAPABILITY_SCOPE_DENIED');
  if (!Array.isArray(value.schemas) || value.schemas.length < 1 || value.schemas.length > 256
      || value.schemas.some((item) => typeof item !== 'string' || !SCHEMA.test(item))
      || new Set(value.schemas).size !== value.schemas.length) fail('KS_OBJECT_CAPABILITY_SCOPE_DENIED');
  return value;
}

function validateRequest(value, expected) {
  exact(value, ['schemaVersion', 'requestId', 'capabilityId', 'bindings', 'scope'], 'KS_OBJECT_CAPABILITY_REQUEST_SURFACE_DENIED');
  if (value.schemaVersion !== KS_OBJECT_CAPABILITY_REQUEST_SCHEMA || !ID.test(value.requestId ?? '')
      || !CAPABILITY_IDS.has(value.capabilityId) || !plain(expected)
      || value.capabilityId !== expected.capabilityId) fail('KS_OBJECT_CAPABILITY_REQUEST_IDENTITY_DENIED');
  validateBindings(value.bindings, expected.bindings, 'KS_OBJECT_CAPABILITY_BINDING_DENIED');
  validateScope(value.scope);
  if (!plain(expected.scope) || !same(value.scope, expected.scope)) fail('KS_OBJECT_CAPABILITY_SCOPE_DENIED');
  return value;
}

function validateResult(value, expected) {
  exact(value, ['schemaVersion', 'requestSha256', 'capabilityId', 'state', 'projectionSha256', 'bindings', 'claims', 'authority'],
    'KS_OBJECT_CAPABILITY_RESULT_SURFACE_DENIED');
  if (value.schemaVersion !== KS_OBJECT_CAPABILITY_RESULT_SCHEMA || !CAPABILITY_IDS.has(value.capabilityId)
      || value.state !== 'PROJECTED_READ_ONLY' || !hash(value.requestSha256) || !hash(value.projectionSha256)
      || !plain(expected) || value.capabilityId !== expected.capabilityId
      || value.requestSha256 !== expected.requestSha256
      || value.projectionSha256 !== expected.projectionSha256) fail('KS_OBJECT_CAPABILITY_RESULT_IDENTITY_DENIED');
  validateBindings(value.bindings, expected.bindings, 'KS_OBJECT_CAPABILITY_RESULT_BINDING_DENIED');
  exact(value.claims, CLAIM_KEYS, 'KS_OBJECT_CAPABILITY_CLAIM_DENIED');
  exact(value.authority, AUTHORITY_KEYS, 'KS_OBJECT_CAPABILITY_AUTHORITY_DENIED');
  if (CLAIM_KEYS.some((key) => value.claims[key] !== false)) fail('KS_OBJECT_CAPABILITY_CLAIM_DENIED');
  if (AUTHORITY_KEYS.some((key) => value.authority[key] !== false)) fail('KS_OBJECT_CAPABILITY_AUTHORITY_DENIED');
  return value;
}

function contractData() {
  return {
    schemaVersion: KS_OBJECT_CAPABILITY_CONTRACT_SCHEMA,
    capabilities: CAPABILITIES.map((item) => ({
      ...item,
      requestSchema: KS_OBJECT_CAPABILITY_REQUEST_SCHEMA,
      resultSchema: KS_OBJECT_CAPABILITY_RESULT_SCHEMA,
      authority: 'read-only-evidence-projection',
    })),
    requiredBindings: [...BINDING_KEYS],
    failClosedCodes: [
      'KS_OBJECT_CAPABILITY_REQUEST_SURFACE_DENIED', 'KS_OBJECT_CAPABILITY_REQUEST_IDENTITY_DENIED',
      'KS_OBJECT_CAPABILITY_BINDING_DENIED', 'KS_OBJECT_CAPABILITY_SCOPE_DENIED',
      'KS_OBJECT_CAPABILITY_RESULT_SURFACE_DENIED', 'KS_OBJECT_CAPABILITY_RESULT_IDENTITY_DENIED',
      'KS_OBJECT_CAPABILITY_RESULT_BINDING_DENIED', 'KS_OBJECT_CAPABILITY_CLAIM_DENIED',
      'KS_OBJECT_CAPABILITY_AUTHORITY_DENIED',
    ],
    integration: {
      mode: 'separate-versioned-extension',
      externalApiV2Changed: false,
      externalApiV2Actions: ['status', 'discovery', 'analyze', 'plan', 'preview', 'readback'],
    },
    boundaries: {
      credentialsAccepted: false,
      freeSqlAccepted: false,
      handlerDispatchIncluded: false,
      mutationAuthority: false,
      rawRowsAccepted: false,
      replayPreventionClaimed: false,
    },
  };
}

export function buildObjectCapabilityContractV1() {
  const value = contractData();
  Object.defineProperties(value, {
    validateRequest: {value: validateRequest, enumerable: false},
    validateResult: {value: validateResult, enumerable: false},
  });
  return deepFreeze(value);
}

export function validateObjectCapabilityContractV1(value) {
  if (!plain(value) || !same(value, contractData())) fail('KS_OBJECT_CAPABILITY_CONTRACT_DENIED');
  return value;
}
