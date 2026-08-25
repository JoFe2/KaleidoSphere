import {canonicalJson, identitySha256} from '../../bi-control/src/db-analyzer/core.mjs';
import {
  buildObjectSearchAuthorityBoundResult, continueObjectSearchAuthorityBoundResult,
} from '../../bi-control/src/db-analyzer/object-search-authority-bound-result-v1.mjs';
import {
  buildObjectCapabilityContractV1, KS_OBJECT_CAPABILITY_REQUEST_SCHEMA, KS_OBJECT_CAPABILITY_RESULT_SCHEMA,
} from './object-capability-contract-v1.mjs';

export const KS_OBJECT_SEARCH_HANDLER_CAPABILITY_ID = 'bi.object.search.read';
export const KS_OBJECT_SEARCH_HANDLER_STATE = 'PROJECTED_READ_ONLY';
const INPUT_INVALID = 'KS_OBJECT_SEARCH_HANDLER_INPUT_INVALID';
const PROJECTION_FORGED = 'KS_OBJECT_SEARCH_HANDLER_PROJECTION_FORGED';
const CAPABILITY_MISMATCH = 'KS_OBJECT_SEARCH_HANDLER_CAPABILITY_MISMATCH';
const BINDING_DRIFT = 'KS_OBJECT_SEARCH_HANDLER_BINDING_DRIFT';
const INPUT_KEYS = Object.freeze(['request', 'expected', 'projection', 'projectionInput']);
const REQUEST_KEYS = Object.freeze(['schemaVersion', 'requestId', 'capabilityId', 'bindings', 'scope']);
const EXPECTED_KEYS = Object.freeze(['capabilityId', 'bindings', 'scope']);
const BINDING_KEYS = Object.freeze([
  'engine', 'snapshotSha256', 'receiptSha256', 'coverageSha256', 'inventoryAuthoritySha256',
  'relationKindAuthoritySha256', 'objectNameAuthoritySha256', 'cancellationSha256',
]);
const PROJECTION_SOURCE_KEYS = Object.freeze([
  'controllerRun', 'inventoryAuthorityProjection', 'relationKindAuthorityProjection',
  'objectNameAuthorityProjection', 'structureEvidence', 'request',
]);
const CLAIMS = Object.freeze({
  absenceClaimed: false, completenessClaimed: false, replayPreventionClaimed: false, sourceRowsIncluded: false,
});
const AUTHORITY = Object.freeze({
  credentialsIncluded: false, dispatchAuthority: false, executionAuthority: false,
  mutationAuthority: false, queryExecution: false, rawValuesIncluded: false, sqlAuthority: false,
});
const CONTRACT = buildObjectCapabilityContractV1();

const fail = (code) => {
  const error = new Error(code);
  error.code = code;
  throw error;
};

const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const exactKeys = (value, keys) => plain(value)
  && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function rejectNegativeZero(value) {
  if (typeof value === 'number') {
    if (Object.is(value, -0)) fail(PROJECTION_FORGED);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(rejectNegativeZero);
    return;
  }
  if (value && typeof value === 'object') Object.values(value).forEach(rejectNegativeZero);
}

// Closed request surface: the exact closed request plus the independently supplied
// authoritative expectations are validated before any projection work; claim-bearing
// identifiers and authority claims are surface denials, not binding denials.
function validateClosedRequest(input) {
  if (!exactKeys(input, INPUT_KEYS)) fail(INPUT_INVALID);
  const {request, expected} = input;
  if (!plain(request) || !exactKeys(request, REQUEST_KEYS)
      || request.schemaVersion !== KS_OBJECT_CAPABILITY_REQUEST_SCHEMA
      || !plain(expected) || !exactKeys(expected, EXPECTED_KEYS)
      || !plain(request.bindings) || !exactKeys(request.bindings, BINDING_KEYS)
      || !plain(expected.bindings) || !exactKeys(expected.bindings, BINDING_KEYS)) {
    fail('KS_OBJECT_CAPABILITY_REQUEST_SURFACE_DENIED');
  }
  CONTRACT.validateRequest(request, expected);
  if (request.capabilityId !== KS_OBJECT_SEARCH_HANDLER_CAPABILITY_ID) fail(CAPABILITY_MISMATCH);
  return input;
}

// The authoritative projection inputs are a closed surface: the exact projector
// source keys plus the sealed search envelope, and the continuation cursor only for
// continuation pages. Any extra or substituted field is a forged projection input.
function validateProjectionInput(projectionInput) {
  if (!plain(projectionInput)) fail(PROJECTION_FORGED);
  const keys = Object.hasOwn(projectionInput, 'cursor') ? [...PROJECTION_SOURCE_KEYS, 'cursor'] : PROJECTION_SOURCE_KEYS;
  if (!exactKeys(projectionInput, keys)) fail(PROJECTION_FORGED);
  return projectionInput;
}

function verifyProjection(projection, projectionInput) {
  const projectionSha256 = projection?.projectionSha256;
  let recomputed;
  try {
    recomputed = Object.hasOwn(projectionInput, 'cursor')
      ? continueObjectSearchAuthorityBoundResult(projectionInput)
      : buildObjectSearchAuthorityBoundResult(projectionInput);
  } catch {
    fail(PROJECTION_FORGED);
  }
  // A substituted, re-digested, stale or page-mismatched projection fails the canonical
  // comparison; the projector's own fail-closed rejections fail the recompute; negative
  // zero is rejected first because canonicalJson normalizes it to zero.
  rejectNegativeZero(projection);
  if (!plain(projection) || canonicalJson(projection) !== canonicalJson(recomputed)
      || projectionSha256 !== recomputed.projectionSha256) fail(PROJECTION_FORGED);
  return recomputed;
}

function assertAuthoritativeBindings(request, projection) {
  const {bindings} = request;
  const bound = projection.bindings;
  if (bindings.engine !== projection.engine
      || bindings.snapshotSha256 !== bound.structureSnapshotSha256
      || bindings.receiptSha256 !== bound.envelopeSha256
      || bindings.coverageSha256 !== bound.controllerCoverageSha256
      || bindings.inventoryAuthoritySha256 !== bound.inventoryAuthorityDigestSha256
      || bindings.relationKindAuthoritySha256 !== bound.relationKindAuthoritySha256
      || bindings.objectNameAuthoritySha256 !== bound.objectNameAuthoritySha256
      || bindings.cancellationSha256 !== identitySha256({cancellation: 'NONE', engine: projection.engine})) {
    fail(BINDING_DRIFT);
  }
}

export function handleObjectSearchV1(input) {
  const {request, expected, projection, projectionInput} = validateClosedRequest(input);
  const recomputed = verifyProjection(projection, validateProjectionInput(projectionInput));
  assertAuthoritativeBindings(request, recomputed);
  const result = {
    schemaVersion: KS_OBJECT_CAPABILITY_RESULT_SCHEMA,
    requestSha256: identitySha256(request),
    capabilityId: KS_OBJECT_SEARCH_HANDLER_CAPABILITY_ID,
    state: KS_OBJECT_SEARCH_HANDLER_STATE,
    projectionSha256: recomputed.projectionSha256,
    bindings: {...request.bindings},
    claims: {...CLAIMS},
    authority: {...AUTHORITY},
  };
  CONTRACT.validateResult(result, {
    capabilityId: result.capabilityId,
    requestSha256: result.requestSha256,
    projectionSha256: result.projectionSha256,
    bindings: expected.bindings,
  });
  return deepFreeze(result);
}