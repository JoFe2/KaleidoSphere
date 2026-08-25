import {canonicalJson, identitySha256, normalizeJsonValue} from '../../bi-control/src/db-analyzer/core.mjs';
import {projectObjectDetails} from '../../bi-control/src/db-analyzer/object-details-projection-v1.mjs';
import {KS_OBJECT_CAPABILITY_RESULT_SCHEMA, buildObjectCapabilityContractV1} from './object-capability-contract-v1.mjs';

export const KS_OBJECT_DETAILS_HANDLER_CAPABILITY = 'bi.object.details.read';
export const KS_OBJECT_DETAILS_HANDLER_FAIL_CLOSED_CODES = Object.freeze([
  'KS_OBJECT_DETAILS_HANDLER_CAPABILITY_DENIED',
  'KS_OBJECT_DETAILS_HANDLER_EXPECTATION_INVALID',
  'KS_OBJECT_DETAILS_HANDLER_REQUEST_DIGEST_DRIFT',
  'KS_OBJECT_DETAILS_HANDLER_PROJECTION_INPUT_INVALID',
  'KS_OBJECT_DETAILS_HANDLER_ENGINE_DRIFT',
  'KS_OBJECT_DETAILS_HANDLER_SCOPE_DRIFT',
  'KS_OBJECT_DETAILS_HANDLER_PROJECTION_DIGEST_DRIFT',
]);

const SHA256 = /^[a-f0-9]{64}$/;
const SCHEMA = /^[A-Za-z][A-Za-z0-9_$#]{0,127}$/;
const ENGINES = new Set(['mssql', 'oracle']);
const BINDING_KEYS = Object.freeze([
  'engine', 'snapshotSha256', 'receiptSha256', 'coverageSha256', 'inventoryAuthoritySha256',
  'relationKindAuthoritySha256', 'objectNameAuthoritySha256', 'cancellationSha256',
]);
const EXPECTATION_KEYS = Object.freeze(['bindings', 'capabilityId', 'projectionSha256', 'requestSha256', 'scope']);
const PROJECTION_INPUT_KEYS = Object.freeze([
  'coverageLedger', 'engine', 'inventorySnapshotSha256', 'objectKey', 'receipt', 'scope', 'scopeSha256',
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
const hash = (value) => typeof value === 'string' && SHA256.test(value);

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function validateExpectations(value) {
  exact(value, EXPECTATION_KEYS, 'KS_OBJECT_DETAILS_HANDLER_EXPECTATION_INVALID');
  if (value.capabilityId !== KS_OBJECT_DETAILS_HANDLER_CAPABILITY) fail('KS_OBJECT_DETAILS_HANDLER_CAPABILITY_DENIED');
  exact(value.bindings, BINDING_KEYS, 'KS_OBJECT_DETAILS_HANDLER_EXPECTATION_INVALID');
  if (!ENGINES.has(value.bindings.engine) || BINDING_KEYS.slice(1).some((key) => !hash(value.bindings[key]))
    || !hash(value.requestSha256) || !hash(value.projectionSha256)
    || !plain(value.scope) || !Array.isArray(value.scope.schemas) || value.scope.schemas.length < 1
    || value.scope.schemas.length > 256
    || value.scope.schemas.some((schema) => typeof schema !== 'string' || !SCHEMA.test(schema))
    || new Set(value.scope.schemas).size !== value.scope.schemas.length) {
    fail('KS_OBJECT_DETAILS_HANDLER_EXPECTATION_INVALID');
  }
  return value;
}

function validateProjectionInputShape(value) {
  exact(value, PROJECTION_INPUT_KEYS, 'KS_OBJECT_DETAILS_HANDLER_PROJECTION_INPUT_INVALID');
  if (!plain(value.scope) || !Array.isArray(value.scope.schemas)) fail('KS_OBJECT_DETAILS_HANDLER_PROJECTION_INPUT_INVALID');
  return value;
}

export function handleObjectDetailsV1(request, expectations, projectionInput) {
  const contract = buildObjectCapabilityContractV1();
  validateExpectations(expectations);
  contract.validateRequest(request, expectations);
  const requestSha256 = identitySha256(normalizeJsonValue(request));
  if (requestSha256 !== expectations.requestSha256) fail('KS_OBJECT_DETAILS_HANDLER_REQUEST_DIGEST_DRIFT');
  validateProjectionInputShape(projectionInput);
  if (projectionInput.engine !== request.bindings.engine) fail('KS_OBJECT_DETAILS_HANDLER_ENGINE_DRIFT');
  if (canonicalJson([...projectionInput.scope.schemas].sort()) !== canonicalJson([...request.scope.schemas].sort())) {
    fail('KS_OBJECT_DETAILS_HANDLER_SCOPE_DRIFT');
  }
  const projection = projectObjectDetails(projectionInput);
  if (projection.projectionSha256 !== expectations.projectionSha256) fail('KS_OBJECT_DETAILS_HANDLER_PROJECTION_DIGEST_DRIFT');
  const result = {
    schemaVersion: KS_OBJECT_CAPABILITY_RESULT_SCHEMA,
    state: 'PROJECTED_READ_ONLY',
    capabilityId: KS_OBJECT_DETAILS_HANDLER_CAPABILITY,
    requestSha256,
    projectionSha256: projection.projectionSha256,
    bindings: expectations.bindings,
    claims: Object.fromEntries(CLAIM_KEYS.map((key) => [key, false])),
    authority: Object.fromEntries(AUTHORITY_KEYS.map((key) => [key, false])),
  };
  contract.validateResult(result, {
    capabilityId: result.capabilityId,
    requestSha256,
    projectionSha256: result.projectionSha256,
    bindings: expectations.bindings,
  });
  return deepFreeze(result);
}