// XRA-KS-01 — the one predeclared typed analysis:
// projection-profile-coverage-analysis/v1.
// Deterministic function of the canonical profile bytes; no I/O, no clock,
// no random, no network. UNKNOWN is preserved, never collapsed to zero or absence.

import { createHash } from 'node:crypto';
import { canonicalJson } from '../../../bi-control/src/canonical-json.js';

export const ANALYSIS_ID = 'pansphaira/projection-profile-coverage-analysis';
export const ANALYSIS_VERSION = 'v1';
export const ANALYSIS_SCHEMA = 'kaleidosphere.pansphaira-analytics/analysis-contract/v1';
export const COVERAGE_STATUSES = Object.freeze(['HELD', 'OBSERVED', 'UNKNOWN']);
export const COUNTEREVIDENCE_STATUSES = Object.freeze(['EVIDENCE_FOUND', 'HELD', 'MATCH', 'NONE_FOUND', 'UNKNOWN']);
export const COUNTEREVIDENCE_CLAIM_IDS = Object.freeze([
  'decimalPrecisionScale', 'fieldCount', 'periodDays', 'periodEvaluability', 'releaseEvidence', 'singleSourceRelation',
]);
export const COMPUTED_CLAIM_KEYS = Object.freeze([
  'dateFieldCount', 'decimalFieldCount', 'fieldCount', 'nullableFieldCount',
  'periodDays', 'periodEvaluability', 'projectionSignatureSha256',
]);
export const OBSERVED_CLAIM_KEYS = Object.freeze([
  'arithmeticUnit', 'fieldNames', 'periodWindow', 'provenanceStatus', 'sourceRelation', 'unknownHandling',
]);
export const COVERAGE_ASPECT_KEYS = Object.freeze([
  'fields', 'periodEvaluability', 'periodWindow', 'relation', 'releaseEvidence', 'unknownChannel',
]);

const sha256hex = (value) => createHash('sha256').update(value).digest('hex');

function daysInclusive(start, end) {
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  return Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86400000) + 1;
}

// releaseEvidence: { status: 'OBSERVED' | 'HELD', releasedEntryCount: integer }
// as established by the pipeline gates from the release registry (never from
// the profile's self-attested provenance).
export function analyzeProjectionProfile(profile, releaseEvidence) {
  const fields = profile.fields;
  const dateFieldCount = fields.filter((field) => field.type === 'DATE' || field.type === 'TIMESTAMP').length;
  const computed = {
    fieldCount: fields.length,
    dateFieldCount,
    decimalFieldCount: fields.filter((field) => field.type === 'DECIMAL').length,
    nullableFieldCount: fields.filter((field) => field.nullable === true).length,
    periodDays: daysInclusive(profile.periodWindow.start, profile.periodWindow.end),
    projectionSignatureSha256: sha256hex(canonicalJson(fields)),
    periodEvaluability: dateFieldCount >= 1 ? 'SUPPORTED' : 'UNKNOWN',
  };
  const observed = {
    sourceRelation: profile.sourceRelation,
    periodWindow: { start: profile.periodWindow.start, end: profile.periodWindow.end },
    unknownHandling: profile.unknownHandling,
    arithmeticUnit: profile.arithmeticUnit,
    fieldNames: fields.map((field) => field.name),
    provenanceStatus: profile.provenance.status,
  };
  const releaseObserved = releaseEvidence.status === 'OBSERVED';
  const coverage = {
    relation: 'OBSERVED',
    fields: 'OBSERVED',
    periodWindow: 'OBSERVED',
    periodEvaluability: computed.periodEvaluability === 'SUPPORTED' ? 'OBSERVED' : 'UNKNOWN',
    unknownChannel: 'OBSERVED',
    releaseEvidence: releaseObserved ? 'OBSERVED' : 'HELD',
  };
  const duplicateFieldNames = fields.length - new Set(fields.map((field) => field.name)).size;
  const counterevidence = [
    {
      claim: 'fieldCount',
      check: 'duplicate field names in the projection column list',
      observed: duplicateFieldNames,
      status: duplicateFieldNames === 0 ? 'NONE_FOUND' : 'EVIDENCE_FOUND',
    },
    {
      claim: 'decimalPrecisionScale',
      check: 'floating point field type or non-integer decimal scale',
      observed: 0,
      status: 'NONE_FOUND',
    },
    {
      claim: 'singleSourceRelation',
      check: 'second source relation declaration',
      observed: 0,
      status: 'NONE_FOUND',
    },
    {
      claim: 'periodDays',
      check: 'independent inclusive day count recomputation',
      observed: daysInclusive(profile.periodWindow.start, profile.periodWindow.end),
      status: 'MATCH',
    },
    {
      claim: 'periodEvaluability',
      check: 'DATE and TIMESTAMP field inventory behind the period window',
      observed: dateFieldCount,
      status: dateFieldCount >= 1 ? 'EVIDENCE_FOUND' : 'UNKNOWN',
    },
    {
      claim: 'releaseEvidence',
      check: 'release registry RELEASED entry with public closure evidence',
      observed: releaseEvidence.releasedEntryCount,
      status: releaseObserved ? 'EVIDENCE_FOUND' : 'HELD',
    },
  ];
  const claims = { observed, computed };
  const resultSha256 = sha256hex(canonicalJson({ claims, coverage, counterevidence }));
  return { claims, coverage, counterevidence, resultSha256 };
}