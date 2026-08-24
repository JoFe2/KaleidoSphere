import {canonicalJson, identitySha256, normalizeJsonValue} from './core.mjs';
import {resumeProgressiveRun} from './progressive-controller.mjs';
import {verifyObjectInventoryAuthorityDigest} from './object-inventory-authority-digest-v1.mjs';
import {resumeObjectSearchEnvelope} from './object-search-envelope-v1.mjs';

export const OBJECT_SEARCH_AUTHORITY_BOUND_RESULT_SCHEMA = 'chimpmaera.db/object-search-authority-bound-result/v1';
export const OBJECT_SEARCH_AUTHORITY_BOUND_CURSOR_SCHEMA = 'chimpmaera.db/object-search-authority-bound-cursor/v1';
export const OBJECT_SEARCH_AUTHORITY_BOUND_RESULT_TYPE = 'OBJECT_SEARCH_AUTHORITY_BOUND_RESULT';
export const OBJECT_SEARCH_AUTHORITY_BOUND_RESULT_STATE = 'PROJECTED';

const SHA256 = /^[a-f0-9]{64}$/;
const KIND_TO_ENTRY_KIND = Object.freeze({
  COLUMN: 'COLUMN',
  INDEX: 'INDEX',
  SEQUENCE: 'SEQUENCE',
  SYNONYM: 'SYNONYM',
  TABLE: 'RELATION',
  VIEW: 'RELATION',
});
const VISIBILITY = Object.freeze({
  COMPLETE: 'VISIBLE',
  PARTIAL: 'VISIBLE_PARTIAL',
  DENIED: 'INVISIBLE',
  UNSUPPORTED: 'NOT_APPLICABLE',
  UNKNOWN: 'UNKNOWN',
});
const CLAIMS = Object.freeze({
  absenceClaimed: false,
  businessTruthEstablished: false,
  completenessClaimed: false,
  replayPreventionClaimed: false,
  sourceRowsIncluded: false,
});
const AUTHORITY = Object.freeze({
  approvalAuthority: false,
  credentialsIncluded: false,
  dispatchAuthority: false,
  executionAuthority: false,
  mutationAuthority: false,
  queryExecution: false,
  rawValuesIncluded: false,
  replayPreventionClaimed: false,
  sqlAuthority: false,
  readOnlyEvidenceOnly: true,
});
const INPUT_KEYS = Object.freeze(['controllerRun', 'projection', 'request', 'cursor']);
const REQUIRED_INPUT_KEYS = Object.freeze(['controllerRun', 'projection', 'request']);
const CURSOR_KEYS = Object.freeze([
  'schemaVersion', 'pageIndex', 'envelopeSha256', 'controllerStateSha256',
  'identityCommitmentSha256', 'authorityDigestSha256', 'opaqueDigest', 'cursorSha256',
]);
const CURSOR_DIGEST_FIELDS = Object.freeze([
  'envelopeSha256', 'controllerStateSha256', 'identityCommitmentSha256', 'authorityDigestSha256', 'opaqueDigest',
]);

const fail = (code) => {
  const error = new Error(code);
  error.code = code;
  throw error;
};

const exactKeys = (value, keys) => value
  && typeof value === 'object'
  && !Array.isArray(value)
  && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());

function assertInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || !REQUIRED_INPUT_KEYS.every((key) => Object.hasOwn(input, key))
    || Object.keys(input).some((key) => !INPUT_KEYS.includes(key))) {
    fail('DB_OBJECT_SEARCH_AUTHORITY_RESULT_INPUT_INVALID');
  }
}

function identityPath(objectRef) {
  const parts = objectRef.kind === 'COLUMN'
    ? [objectRef.schemaName, objectRef.relationName, objectRef.columnName]
    : objectRef.kind === 'RELATION'
      ? [objectRef.schemaName, objectRef.relationName]
      : [objectRef.schemaName, objectRef.objectName ?? objectRef.relationName];
  return parts.filter((part) => part !== null).join('.');
}

function selectMatches(run, request) {
  const entryKinds = new Set(request.kindFilters.map((kind) => KIND_TO_ENTRY_KIND[kind]));
  const schemas = new Set(request.scope.schemas);
  return run.coverage.entries.filter((entry) => {
    const {objectRef} = entry;
    return entryKinds.has(objectRef.kind) && objectRef.schemaName !== null && schemas.has(objectRef.schemaName)
      && identityPath(objectRef).startsWith(request.prefix);
  });
}

function itemFor(entry) {
  const {objectRef} = entry;
  const body = normalizeJsonValue({
    objectKey: entry.objectKey,
    objectKind: objectRef.kind,
    coverage: {state: entry.state, reasonCode: entry.reasonCode, visibility: VISIBILITY[entry.state]},
    evidenceRefs: entry.evidenceRefs.filter((ref) => ref !== objectRef.sourceObjectSha256),
  });
  return {...body, itemSha256: identitySha256(body)};
}

function sealCursor({pageIndex, envelopeSha256, controllerStateSha256, identityCommitmentSha256, authorityDigestSha256}) {
  const opaqueDigest = identitySha256({envelopeSha256, controllerStateSha256, identityCommitmentSha256, authorityDigestSha256, pageIndex});
  const body = normalizeJsonValue({
    schemaVersion: OBJECT_SEARCH_AUTHORITY_BOUND_CURSOR_SCHEMA,
    pageIndex,
    envelopeSha256,
    controllerStateSha256,
    identityCommitmentSha256,
    authorityDigestSha256,
    opaqueDigest,
  });
  return {...body, cursorSha256: identitySha256(body)};
}

function assertCursor(cursor, {request, run, projection, matchCount, pageSize}) {
  const value = normalizeJsonValue(cursor);
  if (!exactKeys(value, CURSOR_KEYS) || value.schemaVersion !== OBJECT_SEARCH_AUTHORITY_BOUND_CURSOR_SCHEMA
    || !Number.isInteger(value.pageIndex) || value.pageIndex < 1
    || !CURSOR_DIGEST_FIELDS.every((field) => SHA256.test(value[field] ?? ''))) {
    fail('DB_OBJECT_SEARCH_AUTHORITY_CURSOR_INVALID');
  }
  const {cursorSha256, ...body} = value;
  if (identitySha256(body) !== cursorSha256) fail('DB_OBJECT_SEARCH_AUTHORITY_CURSOR_TAMPERED');
  if (value.opaqueDigest !== identitySha256({
    envelopeSha256: value.envelopeSha256,
    controllerStateSha256: value.controllerStateSha256,
    identityCommitmentSha256: value.identityCommitmentSha256,
    authorityDigestSha256: value.authorityDigestSha256,
    pageIndex: value.pageIndex,
  })) fail('DB_OBJECT_SEARCH_AUTHORITY_CURSOR_DIGEST_MISMATCH');
  if (value.envelopeSha256 !== request.envelopeSha256) fail('DB_OBJECT_SEARCH_AUTHORITY_CURSOR_REQUEST_REPLAY');
  if (value.controllerStateSha256 !== run.stateSha256) fail('DB_OBJECT_SEARCH_AUTHORITY_CURSOR_RUN_REPLAY');
  if (value.identityCommitmentSha256 !== projection.identityCommitmentSha256
    || value.authorityDigestSha256 !== projection.authorityDigestSha256) {
    fail('DB_OBJECT_SEARCH_AUTHORITY_CURSOR_PROJECTION_REPLAY');
  }
  if (value.pageIndex * pageSize >= matchCount) fail('DB_OBJECT_SEARCH_AUTHORITY_CURSOR_OVERFLOW');
  return value;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

export function buildObjectSearchAuthorityBoundResult(input) {
  assertInput(input);
  const run = resumeProgressiveRun(input.controllerRun);
  const projection = verifyObjectInventoryAuthorityDigest({controllerRun: run, projection: input.projection});
  const request = resumeObjectSearchEnvelope(input.request);
  if (request.engine !== run.engine) fail('DB_OBJECT_SEARCH_AUTHORITY_RESULT_ENGINE_DRIFT');
  const runSchemas = new Set(run.scope.schemas);
  if (!request.scope.schemas.every((schema) => runSchemas.has(schema))) fail('DB_OBJECT_SEARCH_AUTHORITY_RESULT_SCOPE_DRIFT');

  const matches = selectMatches(run, request);
  const matchCount = matches.length;
  const pageSize = request.pageSize;
  const cursor = Object.hasOwn(input, 'cursor')
    ? assertCursor(input.cursor, {request, run, projection, matchCount, pageSize})
    : null;
  const pageIndex = cursor ? cursor.pageIndex : 0;
  const pageStart = pageIndex * pageSize;
  const items = matches.slice(pageStart, pageStart + pageSize).map(itemFor);
  const remainingCount = matchCount - (pageStart + items.length);
  const page = {
    pageIndex,
    pageSize,
    startOrdinal: pageStart,
    endOrdinal: items.length > 0 ? pageStart + items.length - 1 : pageStart - 1,
    itemCount: items.length,
    matchCount,
    remainingCount,
    hasNext: remainingCount > 0,
  };
  const nextCursor = page.hasNext ? sealCursor({
    pageIndex: pageIndex + 1,
    envelopeSha256: request.envelopeSha256,
    controllerStateSha256: run.stateSha256,
    identityCommitmentSha256: projection.identityCommitmentSha256,
    authorityDigestSha256: projection.authorityDigestSha256,
  }) : null;
  const body = normalizeJsonValue({
    schemaVersion: OBJECT_SEARCH_AUTHORITY_BOUND_RESULT_SCHEMA,
    type: OBJECT_SEARCH_AUTHORITY_BOUND_RESULT_TYPE,
    state: OBJECT_SEARCH_AUTHORITY_BOUND_RESULT_STATE,
    engine: run.engine,
    bindings: {
      controllerStateSha256: run.stateSha256,
      identityCommitmentSha256: projection.identityCommitmentSha256,
      authorityDigestSha256: projection.authorityDigestSha256,
      envelopeSha256: request.envelopeSha256,
      inventorySnapshotSha256: request.inventory.inventorySha256,
    },
    page,
    items,
    nextCursor,
    claims: {...CLAIMS},
    authority: {...AUTHORITY},
  });
  return deepFreeze({...body, projectionSha256: identitySha256(body)});
}