import {createHash} from 'node:crypto';
import {canonicalJson} from './core.mjs';

export const PERFORMANCE_EVIDENCE_SCHEMA_V1 = 'kaleidosphere/performance-evidence/v1';
export const PERFORMANCE_RECOMMENDATION_SCHEMA_V1 = 'kaleidosphere/performance-recommendation/v1';

const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9][a-z0-9._:-]{2,127}$/i;
const SAFE_IDENTIFIER = /^[A-Za-z0-9_$#.-]{1,128}$/;
const MUTATION_TEXT = /\b(?:CREATE|ALTER|DROP|TRUNCATE|REBUILD|UPDATE|INSERT|DELETE|MERGE|EXEC(?:UTE)?|GRANT|REVOKE)\b/i;
const ENGINES = Object.freeze({mssql: new Set(['2019', '2022']), oracle: new Set(['19c', '23ai', '26ai'])});
const EVIDENCE_KEYS = ['schemaVersion', 'evidenceId', 'engine', 'engineVersion', 'scopeSha256', 'collectedAtMs', 'expiresAtMs', 'state', 'observations', 'authority', 'rawRowsPersisted', 'queryTextPersisted', 'evidenceSha256'];
const OBSERVATION_KEYS = ['observationId', 'kind', 'objectRef', 'metrics', 'evidenceRefs'];
const OBJECT_KEYS = ['schemaName', 'relationName', 'indexName', 'procedureName'];
const METRIC_KEYS = ['ageMs', 'estimatedRows', 'scanCount'];
const SOURCE_KEYS = ['schemaVersion', 'evidenceRef', 'engine', 'engineVersion', 'scopeSha256', 'collectedAtMs', 'expiresAtMs', 'state', 'authority', 'evidenceSha256'];
const KINDS = new Set(['STALE_STATISTICS', 'UNUSED_INDEX', 'PROCEDURE_HOTSPOT']);
const NONCLAIMS = Object.freeze([
  'NO_PERFORMANCE_IMPROVEMENT_GUARANTEE',
  'NO_AUTOMATIC_OPTIMIZATION',
  'NO_PRODUCTION_BENCHMARK',
  'NO_MUTATION_AUTHORITY',
  'NO_UNIVERSAL_ENGINE_SUPPORT',
]);

function fail() {
  throw new Error('PERFORMANCE_EVIDENCE_DENIED');
}

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exact(value, keys) {
  return plain(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function safeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
}

function without(value, key) {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}

function sha256(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function performanceEvidenceDigestV1(value) {
  if (!plain(value)) fail();
  return sha256(without(value, 'evidenceSha256'));
}

export function performanceSourceEvidenceDigestV1(value) {
  if (!plain(value)) fail();
  return sha256(without(value, 'evidenceSha256'));
}

function resolveSource(resolver, evidenceRef) {
  try {
    if (typeof resolver === 'function') return resolver(evidenceRef);
    if (resolver && typeof resolver.get === 'function') return resolver.get(evidenceRef);
    if (plain(resolver)) return resolver[evidenceRef];
  } catch {
    return undefined;
  }
  return undefined;
}

function validateSourceEvidence(value, source, evidenceRef, evaluatedAtMs) {
  if (!exact(value, SOURCE_KEYS) || value.schemaVersion !== 'kaleidosphere/performance-source-evidence/v1'
    || value.evidenceRef !== evidenceRef || typeof value.evidenceRef !== 'string' || !ID.test(value.evidenceRef)
    || value.engine !== source.engine || value.engineVersion !== source.engineVersion || value.scopeSha256 !== source.scopeSha256
    || !safeInteger(value.collectedAtMs) || !safeInteger(value.expiresAtMs)
    || value.collectedAtMs > source.collectedAtMs || value.expiresAtMs < source.expiresAtMs
    || evaluatedAtMs < value.collectedAtMs || evaluatedAtMs > value.expiresAtMs
    || value.state !== 'VERIFIED' || value.authority !== 'READ_ONLY_EVIDENCE'
    || !DIGEST.test(value.evidenceSha256) || performanceSourceEvidenceDigestV1(value) !== value.evidenceSha256) fail();
}

function validateSourceEvidenceSet(source, resolver, evaluatedAtMs) {
  if (resolver === undefined || resolver === null) fail();
  const refs = new Set(source.observations.flatMap(({evidenceRefs}) => evidenceRefs));
  for (const evidenceRef of refs) validateSourceEvidence(resolveSource(resolver, evidenceRef), source, evidenceRef, evaluatedAtMs);
}

function validateObjectRef(value, kind) {
  if (!exact(value, OBJECT_KEYS)) fail();
  for (const key of ['schemaName', 'relationName']) if (typeof value[key] !== 'string' || !SAFE_IDENTIFIER.test(value[key]) || MUTATION_TEXT.test(value[key])) fail();
  for (const key of ['indexName', 'procedureName']) if (value[key] !== null && (typeof value[key] !== 'string' || !SAFE_IDENTIFIER.test(value[key]) || MUTATION_TEXT.test(value[key]))) fail();
  if (kind === 'UNUSED_INDEX' && value.indexName === null) fail();
  if (kind === 'PROCEDURE_HOTSPOT' && value.procedureName === null) fail();
}

function validateObservation(value) {
  if (!exact(value, OBSERVATION_KEYS) || typeof value.observationId !== 'string' || !ID.test(value.observationId)
    || MUTATION_TEXT.test(value.observationId) || !KINDS.has(value.kind)) fail();
  validateObjectRef(value.objectRef, value.kind);
  if (!exact(value.metrics, METRIC_KEYS) || !Object.values(value.metrics).every(safeInteger)) fail();
  if (!Array.isArray(value.evidenceRefs) || value.evidenceRefs.length === 0 || value.evidenceRefs.length > 16
    || new Set(value.evidenceRefs).size !== value.evidenceRefs.length
    || value.evidenceRefs.some((ref) => typeof ref !== 'string' || !ID.test(ref) || MUTATION_TEXT.test(ref))) fail();
}

function validateEvidence(value, expectedScopeSha256, evaluatedAtMs) {
  if (!exact(value, EVIDENCE_KEYS) || value.schemaVersion !== PERFORMANCE_EVIDENCE_SCHEMA_V1
    || typeof value.evidenceId !== 'string' || !ID.test(value.evidenceId)
    || !Object.hasOwn(ENGINES, value.engine) || !ENGINES[value.engine].has(value.engineVersion)
    || !DIGEST.test(value.scopeSha256) || value.scopeSha256 !== expectedScopeSha256
    || !safeInteger(value.collectedAtMs) || !safeInteger(value.expiresAtMs) || value.expiresAtMs <= value.collectedAtMs
    || !safeInteger(evaluatedAtMs) || evaluatedAtMs < value.collectedAtMs || evaluatedAtMs > value.expiresAtMs
    || value.state !== 'COMPLETE' || value.authority !== 'READ_ONLY_EVIDENCE'
    || value.rawRowsPersisted !== false || value.queryTextPersisted !== false
    || !Array.isArray(value.observations) || value.observations.length === 0 || value.observations.length > 128
    || !DIGEST.test(value.evidenceSha256) || performanceEvidenceDigestV1(value) !== value.evidenceSha256) fail();
  value.observations.forEach(validateObservation);
  if (new Set(value.observations.map(({observationId}) => observationId)).size !== value.observations.length) fail();
  return value;
}

const PROPOSAL = Object.freeze({
  STALE_STATISTICS: {kind: 'REVIEW_STALE_STATISTICS', priority: 300, confidenceBps: 8500},
  UNUSED_INDEX: {kind: 'REVIEW_UNUSED_INDEX', priority: 200, confidenceBps: 7000},
  PROCEDURE_HOTSPOT: {kind: 'REVIEW_PROCEDURE_HOTSPOT', priority: 100, confidenceBps: 6000},
});

function proposal(observation) {
  const definition = PROPOSAL[observation.kind];
  const body = {
    proposalId: `proposal:${observation.observationId}`,
    kind: definition.kind,
    priority: definition.priority,
    confidenceBps: definition.confidenceBps,
    objectRef: structuredClone(observation.objectRef),
    evidenceRefs: [...observation.evidenceRefs].sort(),
    evidenceObservationId: observation.observationId,
    authority: 'PROPOSAL_ONLY',
  };
  return {...body, proposalSha256: sha256(body)};
}

export function buildPerformanceRecommendationsV1({evidence, sourceEvidenceResolver, expectedScopeSha256, evaluatedAtMs}) {
  const source = validateEvidence(evidence, expectedScopeSha256, evaluatedAtMs);
  validateSourceEvidenceSet(source, sourceEvidenceResolver, evaluatedAtMs);
  const proposals = source.observations.map(proposal).sort((left, right) => right.priority - left.priority || left.proposalId.localeCompare(right.proposalId));
  const body = {
    schemaVersion: PERFORMANCE_RECOMMENDATION_SCHEMA_V1,
    recommendationId: `recommendation:${source.evidenceId}`,
    engine: source.engine,
    engineVersion: source.engineVersion,
    scopeSha256: source.scopeSha256,
    evidenceSha256: source.evidenceSha256,
    evaluatedAtMs,
    proposals,
    authority: 'PROPOSAL_ONLY',
    mutationAuthority: 'NONE',
    executionRoute: null,
    nonClaims: [...NONCLAIMS],
  };
  return Object.freeze({...body, recommendationSha256: sha256(body)});
}

export function verifyPerformanceRecommendationV1(value, evidence, sourceEvidenceResolver, expectedScopeSha256, evaluatedAtMs) {
  try {
    if (!plain(value) || value.schemaVersion !== PERFORMANCE_RECOMMENDATION_SCHEMA_V1) return false;
    return canonicalJson(value) === canonicalJson(buildPerformanceRecommendationsV1({evidence, sourceEvidenceResolver, expectedScopeSha256, evaluatedAtMs}));
  } catch {
    return false;
  }
}
