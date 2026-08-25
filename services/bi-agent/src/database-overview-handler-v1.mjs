import {canonicalJson, identitySha256} from '../../bi-control/src/db-analyzer/core.mjs';
import {
  buildDatabaseOverviewProjection,
  verifyDatabaseOverviewProjection,
} from '../../bi-control/src/db-analyzer/database-overview-projection-v1.mjs';
import {
  KS_OBJECT_CAPABILITY_RESULT_SCHEMA,
  buildObjectCapabilityContractV1,
} from './object-capability-contract-v1.mjs';

export const DATABASE_OVERVIEW_HANDLER_CAPABILITY_ID = 'bi.database.overview.read';
export const DATABASE_OVERVIEW_HANDLER_SCHEMA = 'kaleidosphere.object-capabilities/database-overview-handler/v1';

const SHA256 = /^[a-f0-9]{64}$/;
const ENGINES = new Set(['mssql', 'oracle']);
const EXPECTATION_KEYS = Object.freeze(['capabilityId', 'bindings', 'scope', 'requestSha256', 'projectionSha256']);
const STATE_KEYS = Object.freeze(['COMPLETE', 'PARTIAL', 'DENIED', 'UNSUPPORTED', 'UNKNOWN']);
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
const hash = (value) => typeof value === 'string' && SHA256.test(value);
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const isDeepFrozen = (value) => {
  if (value === null || typeof value !== 'object') return true;
  if (!Object.isFrozen(value)) return false;
  return Object.values(value).every(isDeepFrozen);
};
const exactKeys = (value, keys) => plain(value)
  && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
const countByState = (entries) => {
  const counts = {COMPLETE: 0, PARTIAL: 0, DENIED: 0, UNSUPPORTED: 0, UNKNOWN: 0};
  for (const entry of entries) if (entry && STATE_KEYS.includes(entry.state)) counts[entry.state] += 1;
  return counts;
};
function deepFreeze(value) {
  // ArrayBuffer views (Buffer) are the single leaf exception: Node cannot
  // freeze a non-empty view (Object.freeze throws). The enclosing object is
  // frozen, pinning each binding to its canonical bytes.
  if (value && typeof value === 'object' && !ArrayBuffer.isView(value) && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function validateFrozenInputs(request, expectations, run) {
  for (const value of [request, expectations, run]) if (!isDeepFrozen(value)) fail('DB_OVERVIEW_HANDLER_INPUT_INVALID');
}

function validateExpectations(expectations) {
  if (!exactKeys(expectations, EXPECTATION_KEYS) || !hash(expectations.requestSha256) || !hash(expectations.projectionSha256)) {
    fail('DB_OVERVIEW_HANDLER_INPUT_INVALID');
  }
  if (expectations.capabilityId !== DATABASE_OVERVIEW_HANDLER_CAPABILITY_ID) fail('DB_OVERVIEW_HANDLER_CAPABILITY_DENIED');
  return expectations;
}

function validateEngine(request, run) {
  if (plain(request) && plain(request.bindings) && ENGINES.has(request.bindings.engine)
      && plain(run) && ENGINES.has(run.engine) && request.bindings.engine !== run.engine) {
    fail('DB_OVERVIEW_HANDLER_ENGINE_MISMATCH');
  }
}

function validateSourceCrossReferences(run) {
  if (plain(run) && ('authority' in run || 'claims' in run)) fail('DB_OVERVIEW_HANDLER_AUTHORITY_CLAIM_DENIED');
  if (!plain(run) || !ENGINES.has(run.engine) || !hash(run.scopeSha256) || identitySha256(run.scope) !== run.scopeSha256
    || !plain(run.coverage) || !Array.isArray(run.coverage.entries) || !Array.isArray(run.coverage.queryCoverage)
    || !Array.isArray(run.probes) || !Array.isArray(run.receipts)) fail('DB_OVERVIEW_SOURCE_INVALID');
  const summary = run.coverage.summary;
  const counts = countByState(run.coverage.entries);
  const classifiedCount = counts.COMPLETE + counts.PARTIAL + counts.DENIED + counts.UNSUPPORTED;
  const totalCount = classifiedCount + counts.UNKNOWN;
  const coverageBasisPoints = totalCount === 0 ? 0 : Math.floor(classifiedCount * 10000 / totalCount);
  if (!plain(summary) || !Number.isSafeInteger(summary.visibleObjectCount) || !Number.isSafeInteger(summary.classifiedObjectCount)
    || !Number.isSafeInteger(summary.coverageBps)
    || summary.visibleObjectCount !== totalCount || summary.classifiedObjectCount !== classifiedCount
    || summary.coverageBps !== coverageBasisPoints) fail('DB_OVERVIEW_TOTALS_INCONSISTENT');
  for (const probe of run.probes) {
    if (!plain(probe) || probe.coverageSha256 !== run.coverage.coverageSha256) fail('DB_OVERVIEW_PROBE_INVALID');
  }
  for (const receipt of run.receipts) {
    if (!plain(receipt) || receipt.scopeSha256 !== run.scopeSha256
      || receipt.coverageSha256 !== run.coverage.coverageSha256) fail('DB_OVERVIEW_RECEIPT_INVALID');
  }
  return run;
}

function buildResultEnvelope(request, requestSha256, projectionSha256) {
  const envelope = {
    schemaVersion: KS_OBJECT_CAPABILITY_RESULT_SCHEMA,
    requestSha256,
    capabilityId: DATABASE_OVERVIEW_HANDLER_CAPABILITY_ID,
    state: 'PROJECTED_READ_ONLY',
    projectionSha256,
    bindings: request.bindings,
    claims: Object.fromEntries(CLAIM_KEYS.map((key) => [key, false])),
    authority: Object.fromEntries(AUTHORITY_KEYS.map((key) => [key, false])),
  };
  buildObjectCapabilityContractV1().validateResult(envelope, {
    capabilityId: DATABASE_OVERVIEW_HANDLER_CAPABILITY_ID,
    requestSha256,
    projectionSha256,
    bindings: request.bindings,
  });
  return envelope;
}

export function handleDatabaseOverviewRequestV1(request, expectations, run) {
  validateFrozenInputs(request, expectations, run);
  validateExpectations(expectations);
  validateEngine(request, run);
  buildObjectCapabilityContractV1().validateRequest(request, expectations);
  if (expectations.requestSha256 !== identitySha256(request)) fail('DB_OVERVIEW_HANDLER_DIGEST_DRIFT');
  validateSourceCrossReferences(run);
  const projection = buildDatabaseOverviewProjection(run);
  if (expectations.projectionSha256 !== projection.projectionSha256) fail('DB_OVERVIEW_HANDLER_DIGEST_DRIFT');
  verifyDatabaseOverviewProjection(projection, run);
  const requestSha256 = expectations.requestSha256;
  const projectionSha256 = projection.projectionSha256;
  const envelope = buildResultEnvelope(request, requestSha256, projectionSha256);
  return deepFreeze({
    schemaVersion: DATABASE_OVERVIEW_HANDLER_SCHEMA,
    capabilityId: DATABASE_OVERVIEW_HANDLER_CAPABILITY_ID,
    state: 'PROJECTED_READ_ONLY',
    requestSha256,
    projectionSha256,
    resultSha256: identitySha256(envelope),
    envelope,
    bytes: {
      request: Buffer.from(canonicalJson(request), 'utf8'),
      projection: Buffer.from(canonicalJson(projection), 'utf8'),
      result: Buffer.from(canonicalJson(envelope), 'utf8'),
    },
  });
}