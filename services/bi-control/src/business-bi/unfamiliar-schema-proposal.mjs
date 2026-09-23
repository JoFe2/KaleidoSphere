// KaleidoSphere KS246 (KS-EVO-01-AC01/AC02) — an unfamiliar synthetic schema yields a
// REVIEWABLE metric candidate and an explicit clarification conversation.
//
// The released surfaces this slice extends, and does NOT duplicate:
//   * #150 C2 / `net-revenue-plan.mjs` — the one admitted metric core and its frozen
//     operation request (`NET_REVENUE_OPERATION_REQUEST`), which is the single authority
//     for the canonical row roles and the released arithmetic unit.
//   * `contracts/business-bi/v1/net-revenue.metric.json` — the released metric contract
//     whose `relation.fields` and `recordRules` name the canonical row fields and the
//     closed record-kind vocabulary.  Both are READ here, never re-declared.
//   * `postgresql-wave2.mjs` — the established observation vocabulary
//     (OBSERVED / COMPUTED / INFERRED, `reviewState: REVIEW_REQUIRED`,
//     `executionAuthority: 'NONE'`, proposal-only facts with sha256 identity), reused as
//     the shape convention rather than a second evidence engine.
//
// What this module does that no released module does:
//   AC01 — given a FROZEN synthetic UNFAMILIAR schema reached through bounded
//          metadata-only access plus bounded aggregate counts (no rows, no SQL), it
//          separates OBSERVED fields, INFERRED relationships and CALLER-CONFIRMED
//          business rules, and emits one reviewable metric candidate with explicit
//          grain, units, period, relationships and unresolved business meaning.
//   AC02 — it DETECTS ambiguous joins/fan-out, misleading names, units, credits,
//          cancellations and missing definitions, and asks specific clarification
//          questions instead of manufacturing meaning.
//
// NONCLAIMS (structural, not decoration):
//   - OBSERVED bytes are fixture bytes; a COMPUTED rule outcome is not a semantic truth;
//     an INFERRED candidate is proposal-only and carries `executionAuthority: 'NONE'`.
//   - A CONFIRMED value exists ONLY because a CALLER supplied it through the clarification
//     entry point.  EOF, an empty line, or an explicit refusal leaves the question ABSENT /
//     REFUSED and the meaning UNRESOLVED; no code path here ever supplies an answer.
//   - The metric handoff is DIRECTLY DEMONSTRATED LOCAL SUPPORT ONLY.  It re-derives the
//     proposal's own digests from the local body, binds the caller's contract to the released
//     core's admitted contract digest, and refuses inconsistent proposals; it executes no
//     metric, provides no trusted admission, implements no admission consumer, and AC03's
//     shared task handle remains separately owned and NOT integrated.
//   - This is a bounded local surface on one authored synthetic case, not a measured
//     generalization, not a universal schema-understanding engine, and not a second metric.

import { createHash } from 'node:crypto';

import { canonicalJson } from '../canonical-json.js';
import {
  ADMITTED_METRIC_CONTRACT_SHA256,
  NET_REVENUE_OPERATION_REQUEST,
} from './net-revenue-plan.mjs';

export const UNFAMILIAR_SCHEMA_METADATA_SCHEMA = 'kaleidosphere.business-bi/unfamiliar-schema-metadata/v1';
export const UNFAMILIAR_SCHEMA_AGGREGATE_PROFILE_SCHEMA = 'kaleidosphere.business-bi/unfamiliar-schema-aggregate-profile/v1';
export const UNFAMILIAR_SCHEMA_PROPOSAL_SCHEMA = 'kaleidosphere.business-bi/unfamiliar-schema-proposal/v1';
export const UNFAMILIAR_SCHEMA_CLARIFICATION_SCHEMA = 'kaleidosphere.business-bi/unfamiliar-schema-clarification/v1';
export const UNFAMILIAR_SCHEMA_HANDOFF_SCHEMA = 'kaleidosphere.business-bi/unfamiliar-schema-handoff/v1';

// The synthetic classification is the ONLY readable class for this local surface.
const SYNTHETIC_CLASSIFICATION = 'SYNTHETIC_NON_CUSTOMER_BYTES';
// Bounded access modes.  Anything else (row sampling, executable, free SQL) is denied:
// this is where bounded metadata access is separated from executable authority.
const METADATA_ACCESS_MODE = 'BOUNDED_METADATA_ONLY';
const AGGREGATE_ACCESS_MODE = 'BOUNDED_AGGREGATE_ONLY';

// Observation vocabulary, reused from the released wave-2 convention.
export const UNFAMILIAR_OBSERVATION_KINDS = Object.freeze([
  'OBSERVED',
  'COMPUTED',
  'INFERRED',
  'CONFIRMED',
]);

// The ambiguity classes AC02 names, each owed a NAMED rule and a question.
export const UNFAMILIAR_AMBIGUITY_KINDS = Object.freeze([
  'AMBIGUOUS_JOIN_FANOUT',
  'MISLEADING_NAME',
  'AMBIGUOUS_UNITS',
  'AMBIGUOUS_CURRENCY',
  'AMBIGUOUS_PERIOD',
  'CREDIT_SEMANTICS_UNRESOLVED',
  'CANCEL_SEMANTICS_UNRESOLVED',
  'MISSING_DEFINITION',
]);

// F2/F4 — a CONTRADICTION between the caller's decisions and the observed evidence (or between
// two observed reads).  It is carried explicitly and degrades the candidate out of CONFIRMED;
// closed-domain validity alone is never treated as coherent business confirmation.
export const UNFAMILIAR_INCONSISTENCY_KINDS = Object.freeze([
  'UNITS_DECLARATION_CONFLICT',
  'GRAIN_KEY_NOT_OBSERVED_UNIQUE',
  'GRAIN_SELECTION_NOT_DECLARED_CANDIDATE',
  'DENIED_RELATIONSHIP_WITH_CROSS_RELATION_ROLES',
  'KIND_VALUE_CONFLICT',
  'SOURCE_REVISION_MISMATCH',
  'INCONSISTENT_JOIN_PROFILE',
]);

export const REFUSAL_TOKEN = 'none';
export const UNRESOLVED_TOKEN = 'UNRESOLVED';
// A RESERVED ABSENCE selection in a credit/cancel answer domain.  It is deliberately not an
// observed source value: answering it records that the caller decided NO observed value holds
// that role.  It never becomes a record-kind mapping entry, so absence is represented
// separately instead of being manufactured into a synthetic observed value (F3).
export const NO_OBSERVED_VALUE_TOKEN = 'NO_OBSERVED_VALUE';

const DATA_TYPES = new Set(['integer', 'text', 'date', 'timestamp', 'boolean', 'numeric', 'decimal']);
const KEY_KINDS = new Set(['PRIMARY_KEY', 'UNIQUE']);
const MAX_RELATIONS = 16;
const MAX_COLUMNS = 32;
const MAX_QUESTIONS = 32;
const MAX_MEANING_LENGTH = 200;
// A bounded text domain for a caller-supplied business meaning.  It rejects SQL-looking,
// credential-looking and prompt-looking text exactly as the released discovery surface does.
const SAFE_MEANING = /^[\p{L}\p{N}\s.,:;!?()[\]/_+'%-]{1,200}$/u;
const DENIED_MEANING = /\b(?:select|insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|exec(?:ute)?|password|credential|secret|api[_ -]?key|ignore\s+(?:all\s+)?previous|system\s+prompt|raw\s+sql)\b/i;

const AMOUNT_NAME = /(?:amount|amt|value|revenue|total|sum)/i;
const CURRENCY_VALUE = /^(?:[A-Z]{3}|\d{3})$/;
const DATE_TYPES = new Set(['date', 'timestamp']);
const NUMERIC_TYPES = new Set(['integer', 'numeric', 'decimal']);

const fail = (code) => { const error = new Error(code); error.code = code; throw error; };
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const identitySha256 = (body) => sha256(canonicalJson(body));
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

function exactKeys(value, allowed, required = allowed, code = 'UNFAMILIAR_SCHEMA_DENIED:SHAPE') {
  if (!isPlainObject(value)) fail(code);
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.includes(key)) || required.some((key) => !keys.includes(key))) fail(code);
  return value;
}

function bytesOf(value, code) {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  fail(code);
}

function parseBoundJson(bytesOrObject, code) {
  if (isPlainObject(bytesOrObject)) return bytesOrObject;
  const bytes = bytesOf(bytesOrObject, code);
  try { return JSON.parse(bytes.toString('utf8')); } catch { fail(`${code}:JSON`); }
}

// Bounded access separation: a fixture that carries row material, an executable payload,
// free SQL text or credentials is DENIED before any parsing of its surface — bounded
// metadata access is not executable authority.
const DENIED_FIXTURE_KEYS = Object.freeze({
  rows: 'UNFAMILIAR_SCHEMA_DENIED:ROW_MATERIAL',
  sample: 'UNFAMILIAR_SCHEMA_DENIED:ROW_MATERIAL',
  samples: 'UNFAMILIAR_SCHEMA_DENIED:ROW_MATERIAL',
  sql: 'UNFAMILIAR_SCHEMA_DENIED:SQL_AUTHORITY',
  statements: 'UNFAMILIAR_SCHEMA_DENIED:SQL_AUTHORITY',
  query: 'UNFAMILIAR_SCHEMA_DENIED:SQL_AUTHORITY',
  credentials: 'UNFAMILIAR_SCHEMA_DENIED:CREDENTIALS',
  dsn: 'UNFAMILIAR_SCHEMA_DENIED:CREDENTIALS',
});

function assertNoDeniedFixtureKeys(value, code) {
  if (!isPlainObject(value)) fail(code);
  for (const key of Object.keys(value)) {
    if (Object.hasOwn(DENIED_FIXTURE_KEYS, key)) fail(DENIED_FIXTURE_KEYS[key]);
  }
}

// ---------------------------------------------------------------------------------
// AC01 — bounded metadata load.
// ---------------------------------------------------------------------------------
export function loadUnfamiliarMetadata(bytesOrObject) {
  const code = 'UNFAMILIAR_SCHEMA_METADATA_DENIED';
  const raw = parseBoundJson(bytesOrObject, code);
  assertNoDeniedFixtureKeys(raw, code);
  exactKeys(raw, [
    'schemaVersion', 'classification', 'issue', 'sourceRevision', 'accessMode',
    'provenance', 'relations', 'unitDeclaration', 'currencyDeclaration',
  ], [
    'schemaVersion', 'classification', 'issue', 'sourceRevision', 'accessMode',
    'relations', 'unitDeclaration', 'currencyDeclaration',
  ], `${code}:SURFACE`);
  if (raw.schemaVersion !== UNFAMILIAR_SCHEMA_METADATA_SCHEMA) fail(`${code}:SCHEMA`);
  if (raw.classification !== SYNTHETIC_CLASSIFICATION) fail(`${code}:CLASSIFICATION`);
  if (raw.accessMode !== METADATA_ACCESS_MODE) fail(`${code}:ACCESS_MODE`);
  if (typeof raw.sourceRevision !== 'string' || raw.sourceRevision.length === 0) fail(`${code}:REVISION`);
  if (!Array.isArray(raw.relations) || raw.relations.length === 0 || raw.relations.length > MAX_RELATIONS) {
    fail(`${code}:RELATIONS`);
  }

  const relations = raw.relations.map((relation) => {
    exactKeys(relation, [
      'schemaName', 'relationName', 'relationKind', 'columns', 'declaredKeys', 'declaredForeignKeys',
    ], undefined, `${code}:RELATION`);
    assertNoDeniedFixtureKeys(relation, `${code}:RELATION`);
    if (typeof relation.schemaName !== 'string' || typeof relation.relationName !== 'string') fail(`${code}:RELATION`);
    if (relation.relationKind !== 'SYNTHETIC_TABLE') fail(`${code}:RELATION_KIND`);
    if (!Array.isArray(relation.columns) || relation.columns.length === 0 || relation.columns.length > MAX_COLUMNS) {
      fail(`${code}:COLUMNS`);
    }
    const columns = relation.columns.map((column) => {
      exactKeys(column, ['name', 'dataType', 'nullable', 'declaredMeaning'], ['name', 'dataType', 'nullable'], `${code}:COLUMN`);
      assertNoDeniedFixtureKeys(column, `${code}:COLUMN`);
      if (typeof column.name !== 'string' || !DATA_TYPES.has(column.dataType)) fail(`${code}:COLUMN`);
      if (typeof column.nullable !== 'boolean') fail(`${code}:COLUMN`);
      const meaning = column.declaredMeaning === undefined ? null : column.declaredMeaning;
      if (meaning !== null && typeof meaning !== 'string') fail(`${code}:COLUMN_MEANING`);
      return { name: column.name, dataType: column.dataType, nullable: column.nullable, declaredMeaning: meaning };
    });
    if (new Set(columns.map(({ name }) => name)).size !== columns.length) fail(`${code}:DUPLICATE_COLUMN`);
    const declaredKeys = (relation.declaredKeys ?? []).map((key) => {
      exactKeys(key, ['name', 'kind', 'columns'], undefined, `${code}:KEY`);
      if (typeof key.name !== 'string' || !KEY_KINDS.has(key.kind) || !Array.isArray(key.columns) || key.columns.length === 0) {
        fail(`${code}:KEY`);
      }
      if (key.columns.some((name) => !columns.some((column) => column.name === name))) fail(`${code}:KEY_COLUMN`);
      return { name: key.name, kind: key.kind, columns: [...key.columns] };
    });
    const declaredForeignKeys = (relation.declaredForeignKeys ?? []).map((foreignKey) => {
      exactKeys(
        foreignKey,
        ['name', 'columns', 'referencedRelation', 'referencedColumns'],
        undefined,
        `${code}:FOREIGN_KEY`,
      );
      return foreignKey;
    });
    return {
      schemaName: relation.schemaName,
      relationName: relation.relationName,
      relationKind: relation.relationKind,
      columns,
      declaredKeys,
      declaredForeignKeys,
    };
  });

  const body = {
    schemaVersion: UNFAMILIAR_SCHEMA_METADATA_SCHEMA,
    classification: SYNTHETIC_CLASSIFICATION,
    issue: raw.issue,
    sourceRevision: raw.sourceRevision,
    accessMode: METADATA_ACCESS_MODE,
    provenance: raw.provenance ?? null,
    relations,
    unitDeclaration: raw.unitDeclaration,
    currencyDeclaration: raw.currencyDeclaration,
  };
  return deepFreeze({ ...body, metadataSha256: identitySha256(body) });
}

// ---------------------------------------------------------------------------------
// AC01 — bounded aggregate load.  Counts only; no row material, no SQL.
// ---------------------------------------------------------------------------------
export function loadAggregateProfile(bytesOrObject) {
  const code = 'UNFAMILIAR_SCHEMA_AGGREGATE_DENIED';
  const raw = parseBoundJson(bytesOrObject, code);
  assertNoDeniedFixtureKeys(raw, code);
  exactKeys(raw, [
    'schemaVersion', 'classification', 'issue', 'sourceRevision', 'accessMode',
    'provenance', 'relationProfiles', 'joinCandidateProfiles',
  ], [
    'schemaVersion', 'classification', 'issue', 'sourceRevision', 'accessMode',
    'relationProfiles', 'joinCandidateProfiles',
  ], `${code}:SURFACE`);
  if (raw.schemaVersion !== UNFAMILIAR_SCHEMA_AGGREGATE_PROFILE_SCHEMA) fail(`${code}:SCHEMA`);
  if (raw.classification !== SYNTHETIC_CLASSIFICATION) fail(`${code}:CLASSIFICATION`);
  if (raw.accessMode !== AGGREGATE_ACCESS_MODE) fail(`${code}:ACCESS_MODE`);
  if (!Array.isArray(raw.relationProfiles) || raw.relationProfiles.length === 0) fail(`${code}:RELATIONS`);
  if (!Array.isArray(raw.joinCandidateProfiles)) fail(`${code}:JOINS`);

  const relationProfiles = raw.relationProfiles.map((profile) => {
    exactKeys(profile, ['relation', 'rowCount', 'columns'], undefined, `${code}:RELATION`);
    assertNoDeniedFixtureKeys(profile, `${code}:RELATION`);
    if (typeof profile.relation !== 'string' || !Number.isSafeInteger(profile.rowCount) || profile.rowCount < 0) {
      fail(`${code}:RELATION`);
    }
    if (!Array.isArray(profile.columns) || profile.columns.length === 0) fail(`${code}:COLUMNS`);
    const columns = profile.columns.map((column) => {
      exactKeys(
        column,
        ['name', 'nonNullCount', 'distinctCount', 'minInteger', 'maxInteger', 'minDate', 'maxDate', 'valueCounts'],
        ['name', 'nonNullCount', 'distinctCount'],
        `${code}:COLUMN`,
      );
      assertNoDeniedFixtureKeys(column, `${code}:COLUMN`);
      if (typeof column.name !== 'string'
          || !Number.isSafeInteger(column.nonNullCount) || column.nonNullCount < 0
          || !Number.isSafeInteger(column.distinctCount) || column.distinctCount < 0
          || column.distinctCount > column.nonNullCount
          || column.nonNullCount > profile.rowCount) fail(`${code}:COLUMN`);
      return { ...column };
    });
    return { relation: profile.relation, rowCount: profile.rowCount, columns };
  });

  const joinCandidateProfiles = raw.joinCandidateProfiles.map((candidate) => {
    exactKeys(candidate, [
      'source', 'target', 'sourceNonNullCount', 'sourceDistinctCount',
      'targetNonNullCount', 'targetDistinctCount', 'matchedDistinctCount',
    ], undefined, `${code}:JOIN`);
    for (const endpoint of [candidate.source, candidate.target]) {
      exactKeys(endpoint, ['relation', 'column'], undefined, `${code}:JOIN`);
      if (typeof endpoint.relation !== 'string' || typeof endpoint.column !== 'string') fail(`${code}:JOIN`);
    }
    for (const key of [
      'sourceNonNullCount', 'sourceDistinctCount', 'targetNonNullCount',
      'targetDistinctCount', 'matchedDistinctCount',
    ]) {
      if (!Number.isSafeInteger(candidate[key]) || candidate[key] < 0) fail(`${code}:JOIN`);
    }
    if (candidate.sourceDistinctCount > candidate.sourceNonNullCount
        || candidate.targetDistinctCount > candidate.targetNonNullCount) fail(`${code}:JOIN`);
    return { ...candidate, source: { ...candidate.source }, target: { ...candidate.target } };
  });

  const body = {
    schemaVersion: UNFAMILIAR_SCHEMA_AGGREGATE_PROFILE_SCHEMA,
    classification: SYNTHETIC_CLASSIFICATION,
    issue: raw.issue,
    sourceRevision: raw.sourceRevision,
    accessMode: AGGREGATE_ACCESS_MODE,
    provenance: raw.provenance ?? null,
    relationProfiles,
    joinCandidateProfiles,
  };
  return deepFreeze({ ...body, aggregateProfileSha256: identitySha256(body) });
}

// ---------------------------------------------------------------------------------
// AC02 — named ambiguity rules.  Each rule yields a COMPUTED fact with ruleId +
// evidenceRefs; an anomaly no rule classifies stays a recorded BLIND SPOT.
// ---------------------------------------------------------------------------------
export const UNFAMILIAR_RULES = Object.freeze({
  FANOUT: 'KS246_R_FANOUT_NON_UNIQUE_TARGET@1',
  MISLEADING_NAME: 'KS246_R_MISLEADING_NAME_AMOUNT_LIKE_NON_NUMERIC@1',
  SCALE_CONFLICT: 'KS246_R_SAME_TYPE_SCALE_CONFLICT@1',
  UNIT_UNDECLARED: 'KS246_R_UNIT_UNDECLARED@1',
  CURRENCY_MULTI: 'KS246_R_CURRENCY_VALUE_NOT_SINGLE@1',
  PERIOD_MULTI: 'KS246_R_DATE_ROLE_AMBIGUOUS@1',
  KIND_UNRESOLVED: 'KS246_R_KIND_VOCABULARY_UNRESOLVED@1',
  MISSING_DEFINITION: 'KS246_R_DECLARED_MEANING_MISSING@1',
});

const relationKey = ({ schemaName, relationName }) => `${schemaName}.${relationName}`;
const columnKey = (relation, column) => `${relationKey(relation)}.${column}`;

function aggregateFor(aggregates, relation) {
  return aggregates.relationProfiles.find((profile) => profile.relation === relationKey(relation)) ?? null;
}

function columnAggregate(aggregates, relation, columnName) {
  const profile = aggregateFor(aggregates, relation);
  return profile?.columns.find((column) => column.name === columnName) ?? null;
}

function columnAggregateByRelationKey(aggregates, relation, columnName) {
  const profile = aggregates.relationProfiles.find((candidate) => candidate.relation === relation) ?? null;
  return profile?.columns.find((column) => column.name === columnName) ?? null;
}

// F4 — a join candidate's own endpoint counts must agree with the relation profile of the same
// endpoints.  A disagreement is INTERNALLY CONTRADICTORY overlapping evidence: it is retained
// explicitly and never silently removes a fan-out that the other observation still shows.
export function joinEvidence(aggregates, candidate) {
  const sourceProfile = columnAggregateByRelationKey(aggregates, candidate.source.relation, candidate.source.column);
  const targetProfile = columnAggregateByRelationKey(aggregates, candidate.target.relation, candidate.target.column);
  const disagreements = [];
  const compare = (label, profile, nonNullCount, distinctCount) => {
    if (!profile) return;
    if (profile.nonNullCount !== nonNullCount || profile.distinctCount !== distinctCount) {
      disagreements.push(`${label} says ${nonNullCount} non-null / ${distinctCount} distinct while the endpoint relation profile observes ${profile.nonNullCount} non-null / ${profile.distinctCount} distinct`);
    }
  };
  compare('join target', targetProfile, candidate.targetNonNullCount, candidate.targetDistinctCount);
  compare('join source', sourceProfile, candidate.sourceNonNullCount, candidate.sourceDistinctCount);
  const targetNotKeyUnique = candidate.targetNonNullCount > candidate.targetDistinctCount
    || (targetProfile ? targetProfile.nonNullCount > targetProfile.distinctCount : false);
  return {
    fanOut: targetNotKeyUnique,
    targetNotKeyUnique,
    disagreements,
    consistent: disagreements.length === 0,
    targetProfile,
    sourceProfile,
  };
}

export function detectAmbiguities(metadata, aggregates) {
  const facts = [];
  const blindSpots = [];
  // F4 — observations that disagree with each other are retained as explicit evidence
  // inconsistencies instead of being averaged away, and they are also recorded in the
  // blind-spot channel so nothing is silently dropped.
  const evidenceInconsistencies = [];
  const recordInconsistency = (kind, detail, subjects) => {
    evidenceInconsistencies.push({ kind, detail, subjects: [...subjects].sort() });
    blindSpots.push(`${kind}:${detail}`);
  };
  const push = (kind, ruleId, detail, evidenceRefs) => {
    const body = {
      factKind: 'UNFAMILIAR_SCHEMA_AMBIGUITY',
      observationKind: 'COMPUTED',
      claimStatus: 'DETERMINISTIC_RULE_RESULT',
      kind,
      ruleId,
      detail,
      evidenceRefs,
    };
    facts.push({ ...body, factSha256: identitySha256(body) });
  };

  if (metadata.sourceRevision !== aggregates.sourceRevision) {
    // F4 — the two bounded reads claim different source identities; combining them under one
    // revision would conflate observations from different sources, so the mismatch is retained
    // explicitly and is never silently labelled with the metadata revision.
    recordInconsistency('SOURCE_REVISION_MISMATCH',
      `metadata declares source revision ${metadata.sourceRevision} while the bounded aggregate profile declares ${aggregates.sourceRevision}`,
      [metadata.sourceRevision, aggregates.sourceRevision]);
  }

  for (const relation of metadata.relations) {
    const key = relationKey(relation);
    const profile = aggregateFor(aggregates, relation);
    if (!profile) { blindSpots.push(`NO_AGGREGATE_PROFILE:${key}`); continue; }

    // R_PERIOD_MULTI — an ORDER_DATE role is single by contract, so two date columns in
    // one relation make the period role ambiguous rather than freely choosable.
    const dateColumns = relation.columns.filter(({ dataType }) => DATE_TYPES.has(dataType));
    if (dateColumns.length > 1) {
      push('AMBIGUOUS_PERIOD', UNFAMILIAR_RULES.PERIOD_MULTI,
        `${key} exposes ${dateColumns.length} date-like columns (${dateColumns.map(({ name }) => name).join(', ')}); exactly one may hold an ORDER_DATE role.`,
        dateColumns.map(({ name }) => `${key}.${name}`));
    }

    // R_MISLEADING_NAME — an amount-looking NAME whose observed type is not numeric.
    for (const column of relation.columns) {
      if (AMOUNT_NAME.test(column.name) && !NUMERIC_TYPES.has(column.dataType)) {
        push('MISLEADING_NAME', UNFAMILIAR_RULES.MISLEADING_NAME,
          `${key}.${column.name} is named like an amount but its declared type is ${column.dataType}; the name is not evidence of a measure.`,
          [`${key}.${column.name}`]);
      }
    }

    // R_SCALE_CONFLICT — two same-type integer amount candidates where one DECLARES a
    // scale and the observed magnitudes are ~100x apart, so the declaration and the
    // observation disagree.  Same types, opposite implied scale: a misleading pair.
    const integerAmounts = relation.columns.filter((column) => column.dataType === 'integer'
      && AMOUNT_NAME.test(column.name)
      && columnAggregate(aggregates, relation, column.name)?.maxInteger !== undefined);
    if (integerAmounts.length > 1) {
      const scaled = integerAmounts.filter(({ declaredMeaning }) => declaredMeaning !== null
        && /\bcents?\b|\bminor unit/i.test(declaredMeaning));
      const unscaled = integerAmounts.filter(({ declaredMeaning }) => declaredMeaning === null);
      if (scaled.length > 0 && unscaled.length > 0) {
        const scaledMax = Math.max(...scaled.map(({ name }) => columnAggregate(aggregates, relation, name).maxInteger));
        const unscaledMax = Math.max(...unscaled.map(({ name }) => columnAggregate(aggregates, relation, name).maxInteger));
        if (scaledMax > 0 && unscaledMax > 0 && (unscaledMax / scaledMax) >= 20) {
          push('MISLEADING_NAME', UNFAMILIAR_RULES.SCALE_CONFLICT,
            `${key}: ${integerAmounts.map(({ name }) => name).join(' / ')} share type integer, but a column declaring cents reaches ${scaledMax} while an undeclared sibling reaches ${unscaledMax}; the declared scale and the observed magnitude disagree.`,
            integerAmounts.map(({ name }) => `${key}.${name}`));
        }
      }
    }

    // R_UNIT_UNDECLARED — no schema-level unit declaration plus a numeric measure.
    const numericColumns = relation.columns.filter(({ dataType }) => NUMERIC_TYPES.has(dataType));
    if (metadata.unitDeclaration === null && numericColumns.length > 0) {
      push('AMBIGUOUS_UNITS', UNFAMILIAR_RULES.UNIT_UNDECLARED,
        `${key} declares no arithmetic unit while exposing numeric measure column(s) (${numericColumns.map(({ name }) => name).join(', ')}); minor vs base units cannot be derived from the schema.`,
        numericColumns.map(({ name }) => `${key}.${name}`));
    }

    // R_CURRENCY_MULTI — a currency-like column carrying more than one distinct value.
    for (const column of relation.columns) {
      const aggregate = columnAggregate(aggregates, relation, column.name);
      const values = aggregate?.valueCounts ? Object.keys(aggregate.valueCounts) : [];
      const currencyLike = column.dataType === 'text' && values.length > 0
        && values.every((value) => CURRENCY_VALUE.test(value));
      if (currencyLike && (aggregate.distinctCount > 1 || metadata.currencyDeclaration === null && values.length > 1)) {
        if (values.length > 1) {
          push('AMBIGUOUS_CURRENCY', UNFAMILIAR_RULES.CURRENCY_MULTI,
            `${key}.${column.name} observes more than one currency value (${values.join(', ')}); the metric contract admits exactly one.`,
            [`${key}.${column.name}`]);
        }
      }
    }

    // R_KIND_UNRESOLVED — a low-cardinality text column whose values are NOT declared:
    // credit and cancellation semantics are therefore unresolved, never inferred.
    for (const column of relation.columns) {
      const aggregate = columnAggregate(aggregates, relation, column.name);
      const values = aggregate?.valueCounts ? Object.keys(aggregate.valueCounts) : [];
      const enumLike = column.dataType === 'text' && values.length >= 2 && values.length <= 8
        && column.declaredMeaning === null && !values.every((value) => CURRENCY_VALUE.test(value));
      if (enumLike) {
        push('CREDIT_SEMANTICS_UNRESOLVED', UNFAMILIAR_RULES.KIND_UNRESOLVED,
          `${key}.${column.name} carries values ${values.join(', ')} with no declared meaning; which value is a credit (subtracted) is not derivable.`,
          [`${key}.${column.name}`]);
        push('CANCEL_SEMANTICS_UNRESOLVED', UNFAMILIAR_RULES.KIND_UNRESOLVED,
          `${key}.${column.name} carries values ${values.join(', ')} with no declared meaning; which value is a cancellation (contributes 0) is not derivable.`,
          [`${key}.${column.name}`]);
      }
    }

    // R_MISSING_DEFINITION — no declared business meaning.
    for (const column of relation.columns) {
      if (column.declaredMeaning === null) {
        push('MISSING_DEFINITION', UNFAMILIAR_RULES.MISSING_DEFINITION,
          `${key}.${column.name} has no declared business meaning.`,
          [`${key}.${column.name}`]);
      }
    }
  }

  // R_FANOUT — a join candidate whose TARGET has duplicate key values multiplies rows.  The
  // determination is taken over BOTH bounded reads: a contradictory join candidate can no
  // longer erase a fan-out that the endpoint relation profile still observes.
  for (const candidate of aggregates.joinCandidateProfiles) {
    const evidence = joinEvidence(aggregates, candidate);
    const endpoints = `${candidate.source.relation}.${candidate.source.column} -> ${candidate.target.relation}.${candidate.target.column}`;
    if (!evidence.consistent) {
      recordInconsistency('INCONSISTENT_JOIN_PROFILE',
        `${endpoints}: ${evidence.disagreements.join('; ')}`,
        [`${candidate.source.relation}.${candidate.source.column}`, `${candidate.target.relation}.${candidate.target.column}`]);
    }
    if (evidence.targetNotKeyUnique) {
      const profileBasis = evidence.targetProfile
        && evidence.targetProfile.nonNullCount !== candidate.targetNonNullCount
        ? `; the target's own relation profile observes ${evidence.targetProfile.nonNullCount} non-null / ${evidence.targetProfile.distinctCount} distinct`
        : '';
      push('AMBIGUOUS_JOIN_FANOUT', UNFAMILIAR_RULES.FANOUT,
        `join ${endpoints} is not key-unique on the target (${candidate.targetNonNullCount} non-null / ${candidate.targetDistinctCount} distinct${profileBasis}), so it fans out.`,
        [`${candidate.source.relation}.${candidate.source.column}`, `${candidate.target.relation}.${candidate.target.column}`]);
    } else if (candidate.matchedDistinctCount < candidate.sourceDistinctCount) {
      blindSpots.push(`PARTIAL_JOIN_OVERLAP:${candidate.source.relation}.${candidate.source.column}`);
    }
  }

  const byKind = Object.fromEntries(UNFAMILIAR_AMBIGUITY_KINDS.map((kind) => [
    kind,
    facts.filter(({ kind: candidate }) => candidate === kind).length,
  ]));
  const body = {
    factKind: 'UNFAMILIAR_SCHEMA_AMBIGUITY_EVIDENCE',
    observationKind: 'COMPUTED',
    claimStatus: 'DETERMINISTIC_RULE_RESULT',
    metadataSha256: metadata.metadataSha256,
    aggregateProfileSha256: aggregates.aggregateProfileSha256,
    kinds: [...UNFAMILIAR_AMBIGUITY_KINDS],
    byKind,
    facts,
    evidenceInconsistencies,
    blindSpots: blindSpots.sort(),
    limitations: [
      'SYNTHETIC_FIXTURE_ONLY',
      'DETECTION_IS_A_RULE_OUTCOME_NOT_A_SEMANTIC_TRUTH_CLAIM',
      'NAME_HEURISTIC_STARTS_WITH_DECLARED_AND_OBSERVED_BYTES_ONLY',
    ],
  };
  return deepFreeze({ ...body, ambiguityEvidenceSha256: identitySha256(body) });
}

// ---------------------------------------------------------------------------------
// AC01 — inference.  Proposal-only candidates, never confirmations.
// ---------------------------------------------------------------------------------
function inferRoles(metadata, aggregates, ambiguities) {
  const grainCandidates = [];
  const periodCandidates = [];
  const amountCandidates = [];
  const currencyCandidates = [];
  const kindCandidates = [];
  const relationships = [];

  for (const relation of metadata.relations) {
    const key = relationKey(relation);
    for (const declaredKey of relation.declaredKeys) {
      if (declaredKey.columns.length === 1) {
        const column = relation.columns.find(({ name }) => name === declaredKey.columns[0]);
        const aggregate = columnAggregate(aggregates, relation, declaredKey.columns[0]);
        const unique = aggregate ? aggregate.distinctCount === aggregate.nonNullCount : false;
        grainCandidates.push({
          relation: key,
          schemaName: relation.schemaName,
          relationName: relation.relationName,
          keyColumn: declaredKey.columns[0],
          keyKind: declaredKey.kind,
          uniqueObserved: unique,
          nonNullCount: aggregate?.nonNullCount ?? null,
          distinctCount: aggregate?.distinctCount ?? null,
          ruleId: 'KS246_R_GRAIN_DECLARED_SINGLE_KEY@1',
          confidence: declaredKey.kind === 'PRIMARY_KEY' && unique ? 'MEDIUM' : 'LOW',
          observationKind: 'INFERRED',
          reviewState: 'REVIEW_REQUIRED',
        });
      }
    }
    for (const column of relation.columns) {
      const aggregate = columnAggregate(aggregates, relation, column.name);
      if (DATE_TYPES.has(column.dataType)) {
        periodCandidates.push({
          relation: key,
          column: column.name,
          dataType: column.dataType,
          nonNullCount: aggregate?.nonNullCount ?? null,
          ruleId: 'KS246_R_PERIOD_DATE_TYPE@1',
          observationKind: 'INFERRED',
          reviewState: 'REVIEW_REQUIRED',
        });
      }
      if (NUMERIC_TYPES.has(column.dataType) && AMOUNT_NAME.test(column.name)) {
        amountCandidates.push({
          relation: key,
          column: column.name,
          dataType: column.dataType,
          declaredMeaning: column.declaredMeaning,
          maxInteger: aggregate?.maxInteger ?? null,
          ruleId: 'KS246_R_AMOUNT_NAME_AND_NUMERIC_TYPE@1',
          observationKind: 'INFERRED',
          reviewState: 'REVIEW_REQUIRED',
        });
      }
      const values = aggregate?.valueCounts ? Object.keys(aggregate.valueCounts) : [];
      if (column.dataType === 'text' && values.length > 0 && values.every((value) => CURRENCY_VALUE.test(value))) {
        currencyCandidates.push({
          relation: key,
          column: column.name,
          observedValues: values.sort(),
          ruleId: 'KS246_R_CURRENCY_CODE_VALUES@1',
          observationKind: 'INFERRED',
          reviewState: 'REVIEW_REQUIRED',
        });
      }
      if (column.dataType === 'text' && values.length >= 2 && values.length <= 8
          && !AMOUNT_NAME.test(column.name)
          && !values.every((value) => CURRENCY_VALUE.test(value))) {
        kindCandidates.push({
          relation: key,
          column: column.name,
          observedValues: values.sort(),
          ruleId: 'KS246_R_LOW_CARDINALITY_TEXT@1',
          observationKind: 'INFERRED',
          reviewState: 'REVIEW_REQUIRED',
        });
      }
    }
  }

  for (const candidate of aggregates.joinCandidateProfiles) {
    const evidence = joinEvidence(aggregates, candidate);
    const fanOut = evidence.fanOut;
    const overlapBasisPoints = candidate.sourceDistinctCount === 0
      ? 0
      : Math.floor((candidate.matchedDistinctCount * 10000) / candidate.sourceDistinctCount);
    relationships.push({
      source: `${candidate.source.relation}.${candidate.source.column}`,
      target: `${candidate.target.relation}.${candidate.target.column}`,
      relationshipKind: 'JOIN_CANDIDATE',
      observationKind: 'INFERRED',
      claimStatus: 'PROPOSAL_ONLY',
      reviewState: 'REVIEW_REQUIRED',
      executionAuthority: 'NONE',
      fanOutRisk: fanOut,
      fanOutReason: fanOut
        ? `target has ${candidate.targetNonNullCount} non-null / ${candidate.targetDistinctCount} distinct key values${evidence.consistent ? '' : ' (a contradictory endpoint profile is also retained)'}, so each source row can match several target rows`
        : null,
      observedEvidenceConsistent: evidence.consistent,
      overlapBasisPoints,
      ruleId: 'KS246_R_EXACT_NAME_TYPE_OVERLAP@1',
      confidence: fanOut ? 'LOW' : overlapBasisPoints >= 9500 ? 'HIGH' : 'MEDIUM',
    });
  }

  const byText = (left, right) => Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
  return {
    grain: grainCandidates.sort((a, b) => byText(a.relation, b.relation)),
    period: periodCandidates.sort((a, b) => byText(`${a.relation}.${a.column}`, `${b.relation}.${b.column}`)),
    units: {
      schemaDeclaration: metadata.unitDeclaration,
      amountColumns: amountCandidates.sort((a, b) => byText(`${a.relation}.${a.column}`, `${b.relation}.${b.column}`)),
      reviewState: 'REVIEW_REQUIRED',
      observationKind: 'INFERRED',
    },
    currency: {
      schemaDeclaration: metadata.currencyDeclaration,
      candidates: currencyCandidates.sort((a, b) => byText(`${a.relation}.${a.column}`, `${b.relation}.${b.column}`)),
      reviewState: 'REVIEW_REQUIRED',
      observationKind: 'INFERRED',
    },
    recordKind: {
      candidates: kindCandidates.sort((a, b) => byText(`${a.relation}.${a.column}`, `${b.relation}.${b.column}`)),
      mapping: null,
      reviewState: 'REVIEW_REQUIRED',
      observationKind: 'INFERRED',
    },
    relationships,
    missingDefinitionRefs: [...new Set(ambiguities.facts
      .filter(({ kind }) => kind === 'MISSING_DEFINITION')
      .flatMap(({ evidenceRefs }) => evidenceRefs))].sort(),
    ambiguityKinds: ambiguities.kinds.filter((kind) => ambiguities.byKind[kind] > 0),
  };
}

// ---------------------------------------------------------------------------------
// AC02 — the clarification question set.  Every question is owed by a detected
// ambiguity or by a required metric role; each carries a CLOSED answer domain so the
// caller cannot answer with free prose where a decision is required.
// ---------------------------------------------------------------------------------
const QUESTION_DEFINITIONS = Object.freeze({
  GRAIN: { code: 'KS246_QUESTION_GRAIN', blocking: true },
  PERIOD: { code: 'KS246_QUESTION_PERIOD', blocking: true },
  UNITS: { code: 'KS246_QUESTION_UNITS', blocking: true },
  AMOUNT_COLUMN: { code: 'KS246_QUESTION_AMOUNT_COLUMN', blocking: true },
  CURRENCY: { code: 'KS246_QUESTION_CURRENCY', blocking: true },
  CREDIT: { code: 'KS246_QUESTION_CREDIT', blocking: true },
  CANCEL: { code: 'KS246_QUESTION_CANCEL', blocking: true },
  FANOUT: { code: 'KS246_QUESTION_FANOUT', blocking: false },
  MISLEADING_NAME: { code: 'KS246_QUESTION_MISLEADING_NAME', blocking: false },
  MISSING_DEFINITION: { code: 'KS246_QUESTION_MISSING_DEFINITION', blocking: false },
});

function question(kind, questionId, text, answerDomain, evidenceRefs, subject = null) {
  const definition = QUESTION_DEFINITIONS[kind];
  const body = {
    questionId,
    kind,
    code: definition.code,
    blocking: definition.blocking,
    observationKind: 'INFERRED',
    subject,
    text,
    answerDomain,
    evidenceRefs,
  };
  return { ...body, questionSha256: identitySha256(body) };
}

export function buildClarificationQuestions(inferred) {
  const questions = [];
  const grainKeys = inferred.grain.map(({ relation, keyColumn }) => `${relation}.${keyColumn}`);

  questions.push(question(
    'GRAIN',
    'ks246-q-grain',
    `This schema exposes ${grainKeys.length} candidate key(s) (${grainKeys.join(', ')}). Which relation + key is the metric grain?`,
    { type: 'CLOSED_SET', values: grainKeys },
    inferred.grain.map(({ relation, keyColumn }) => `${relation}.${keyColumn}`),
  ));

  const periodKeys = inferred.period.map(({ relation, column }) => `${relation}.${column}`);
  questions.push(question(
    'PERIOD',
    'ks246-q-period',
    `Which column holds the single ORDER_DATE role? Candidates: ${periodKeys.join(', ')}.`,
    { type: 'CLOSED_SET', values: periodKeys },
    periodKeys,
  ));

  questions.push(question(
    'UNITS',
    'ks246-q-units',
    'What arithmetic unit do the amount columns carry? The schema declares none, so minor vs base units cannot be derived.',
    { type: 'CLOSED_SET', values: ['MINOR_UNITS', 'BASE_UNITS'] },
    inferred.units.amountColumns.map(({ relation, column }) => `${relation}.${column}`),
  ));

  const amountKeys = inferred.units.amountColumns.map(({ relation, column }) => `${relation}.${column}`);
  if (amountKeys.length > 0) {
    questions.push(question(
      'AMOUNT_COLUMN',
      'ks246-q-amount-column',
      `Which column is the metric amount? Candidates share type integer and their names look alike: ${amountKeys.join(', ')}.`,
      { type: 'CLOSED_SET', values: amountKeys },
      amountKeys,
    ));
  }

  const currencyValues = [...new Set(inferred.currency.candidates.flatMap(({ observedValues }) => observedValues))].sort();
  if (currencyValues.length > 0) {
    questions.push(question(
      'CURRENCY',
      'ks246-q-currency',
      `Which single currency is in scope? Observed values: ${currencyValues.join(', ')}.`,
      { type: 'CLOSED_SET', values: currencyValues },
      inferred.currency.candidates.map(({ relation, column }) => `${relation}.${column}`),
    ));
  }

  for (const [index, candidate] of inferred.recordKind.candidates.entries()) {
    // F3 — the closed domain is the OBSERVED values plus one reserved ABSENCE selection.  No
    // synthetic observed value is offered, and the absence selection never becomes a mapping.
    if (candidate.observedValues.includes(NO_OBSERVED_VALUE_TOKEN)) {
      fail('UNFAMILIAR_CLARIFICATION_DENIED:RESERVED_TOKEN');
    }
    const values = [...candidate.observedValues, NO_OBSERVED_VALUE_TOKEN].sort();
    questions.push(question(
      'CREDIT',
      `ks246-q-credit-${index}`,
      `${candidate.relation}.${candidate.column} values ${candidate.observedValues.join(', ')} have no declared meaning. Which value is a CREDIT (subtracted from the total), or ${NO_OBSERVED_VALUE_TOKEN} if none of the observed values is a credit?`,
      { type: 'CLOSED_SET', values },
      [`${candidate.relation}.${candidate.column}`],
      `${candidate.relation}.${candidate.column}`,
    ));
    questions.push(question(
      'CANCEL',
      `ks246-q-cancel-${index}`,
      `${candidate.relation}.${candidate.column} values ${candidate.observedValues.join(', ')} have no declared meaning. Which value is a CANCELLATION (contributes 0), or ${NO_OBSERVED_VALUE_TOKEN} if none of the observed values is a cancellation?`,
      { type: 'CLOSED_SET', values },
      [`${candidate.relation}.${candidate.column}`],
      `${candidate.relation}.${candidate.column}`,
    ));
  }

  for (const [index, relationship] of inferred.relationships.entries()) {
    if (relationship.fanOutRisk) {
      questions.push(question(
        'FANOUT',
        `ks246-q-fanout-${index}`,
        `${relationship.source} -> ${relationship.target} is not key-unique on the target and fans out. Is this a real relationship to model?`,
        { type: 'CLOSED_SET', values: ['REAL_RELATIONSHIP', 'NOT_A_RELATIONSHIP'] },
        [relationship.source, relationship.target],
        `${relationship.source}->${relationship.target}`,
      ));
    }
  }

  const misleading = inferred.units.amountColumns.filter(({ declaredMeaning }) => declaredMeaning !== null
    && /\bcents?\b|\bminor unit/i.test(declaredMeaning));
  for (const [index, candidate] of misleading.entries()) {
    questions.push(question(
      'MISLEADING_NAME',
      `ks246-q-misleading-${index}`,
      `${candidate.relation}.${candidate.column} declares "${candidate.declaredMeaning}" while a same-type sibling integer column is ~100x larger. Which reading is correct?`,
      { type: 'CLOSED_SET', values: ['DECLARED_MEANING_IS_CORRECT', 'OBSERVED_SCALE_IS_CORRECT', 'NEITHER'] },
      [`${candidate.relation}.${candidate.column}`],
      `${candidate.relation}.${candidate.column}`,
    ));
  }

  for (const fact of inferred.missingDefinitionRefs ?? []) {
    questions.push(question(
      'MISSING_DEFINITION',
      `ks246-q-definition-${fact.replace(/[^A-Za-z0-9]+/g, '-')}`,
      `${fact} has no declared business meaning. Supply the business meaning, or record it as ${UNRESOLVED_TOKEN}.`,
      { type: 'SAFE_TEXT_OR_UNRESOLVED' },
      [fact],
      fact,
    ));
  }

  // The order is deterministic by construction and is the interview order a caller sees:
  // required metric roles first (grain, period, units, amount column, currency), then the
  // record-kind semantics, then the relationship/name/meaning questions.  It is NOT
  // re-sorted afterwards, so the caller's positional answer stream maps predictably.
  if (questions.length > MAX_QUESTIONS) fail('UNFAMILIAR_QUESTION_BUDGET_EXCEEDED');
  return deepFreeze(questions);
}

// ---------------------------------------------------------------------------------
// AC02 — the clarification entry point.
//
// A caller supplies answers keyed by questionId.  This is the ONLY place a CONFIRMED
// value can originate.  There is deliberately no default, no fallback and no inference
// path into the confirmed layer:
//   * a missing questionId            -> ABSENT   (the user did not answer)
//   * an empty / whitespace answer    -> ABSENT
//   * the refusal token 'none'        -> REFUSED  (the user explicitly declined)
//   * an out-of-domain answer         -> REJECTED (with an explicit code)
//   * an in-domain answer             -> CONFIRMED (the user's own value)
// ---------------------------------------------------------------------------------
export function createListAnswerSource(lines) {
  if (!Array.isArray(lines)) fail('UNFAMILIAR_ANSWER_SOURCE_DENIED');
  const pending = [...lines];
  return {
    // `undefined` means EOF: the source had nothing to say, which is ABSENT, not a default.
    nextLine() { return pending.length === 0 ? undefined : pending.shift(); },
  };
}

export function normalizeAnswer(line) {
  if (line === undefined || line === null) return { disposition: 'ABSENT', value: undefined };
  if (typeof line !== 'string') fail('UNFAMILIAR_ANSWER_DENIED:TYPE');
  const trimmed = line.trim();
  if (trimmed === '') return { disposition: 'ABSENT', value: undefined };
  if (trimmed === REFUSAL_TOKEN) return { disposition: 'REFUSED', value: REFUSAL_TOKEN };
  return { disposition: 'ANSWERED', value: trimmed };
}

function validateAnswer(q, value) {
  const domain = q.answerDomain;
  if (domain.type === 'CLOSED_SET') {
    if (!domain.values.includes(value)) {
      return {
        disposition: 'REJECTED',
        code: `UNFAMILIAR_CLARIFICATION_REJECTED:${q.kind}`,
        detail: `'${value}' is not one of the supported answers (${domain.values.join(', ')}).`,
      };
    }
    return { disposition: 'CONFIRMED', code: null, detail: null };
  }
  if (domain.type === 'SAFE_TEXT_OR_UNRESOLVED') {
    if (value === UNRESOLVED_TOKEN) return { disposition: 'CONFIRMED', code: null, detail: null };
    if (value.length > MAX_MEANING_LENGTH || !SAFE_MEANING.test(value) || DENIED_MEANING.test(value)) {
      return {
        disposition: 'REJECTED',
        code: `UNFAMILIAR_CLARIFICATION_REJECTED:${q.kind}`,
        detail: 'The supplied meaning is not a bounded, non-executable business description.',
      };
    }
    return { disposition: 'CONFIRMED', code: null, detail: null };
  }
  fail('UNFAMILIAR_QUESTION_DOMAIN_DENIED');
}

export function applyClarifications(skeleton, answers) {
  if (answers === undefined) answers = {};
  if (!isPlainObject(answers)) fail('UNFAMILIAR_CLARIFICATION_DENIED:SHAPE');
  const questionIds = new Set(skeleton.questions.map(({ questionId }) => questionId));
  for (const key of Object.keys(answers)) {
    if (!questionIds.has(key)) fail(`UNFAMILIAR_CLARIFICATION_DENIED:UNKNOWN_QUESTION:${key}`);
  }

  const dispositions = [];
  const confirmed = {};
  for (const q of skeleton.questions) {
    const supplied = Object.hasOwn(answers, q.questionId) ? answers[q.questionId] : undefined;
    let outcome;
    if (supplied === undefined) {
      outcome = { disposition: 'ABSENT', code: null, detail: 'The caller supplied no answer.' };
    } else if (supplied === null) {
      outcome = { disposition: 'ABSENT', code: null, detail: 'The caller explicitly supplied no answer.' };
    } else if (typeof supplied !== 'string') {
      fail('UNFAMILIAR_CLARIFICATION_DENIED:TYPE');
    } else if (supplied.trim() === '') {
      outcome = { disposition: 'ABSENT', code: null, detail: 'The caller supplied an empty answer.' };
    } else if (supplied.trim() === REFUSAL_TOKEN) {
      outcome = { disposition: 'REFUSED', code: 'UNFAMILIAR_CLARIFICATION_REFUSED', detail: 'The caller declined the question.' };
    } else {
      outcome = validateAnswer(q, supplied.trim());
    }
    const record = {
      questionId: q.questionId,
      kind: q.kind,
      code: q.code,
      blocking: q.blocking,
      subject: q.subject,
      questionSha256: q.questionSha256,
      disposition: outcome.disposition,
      answer: outcome.disposition === 'CONFIRMED' ? supplied.trim() : null,
      rejectionDetail: outcome.disposition === 'REJECTED' ? outcome.detail : null,
      outcomeCode: outcome.code ?? null,
    };
    dispositions.push({ ...record, dispositionSha256: identitySha256(record) });
    if (outcome.disposition === 'CONFIRMED') {
      confirmed[q.questionId] = {
        kind: q.kind,
        subject: q.subject,
        value: supplied.trim(),
        questionSha256: q.questionSha256,
        answeredBy: 'CALLER',
      };
    }
  }

  const count = (disposition) => dispositions.filter((entry) => entry.disposition === disposition).length;
  const body = {
    schemaVersion: UNFAMILIAR_SCHEMA_CLARIFICATION_SCHEMA,
    observationKind: 'CONFIRMED',
    claimStatus: 'CALLER_CONFIRMED_DECISION',
    source: skeleton.source,
    proposalQuestionsSha256: identitySha256(skeleton.questions),
    questionCount: skeleton.questions.length,
    confirmedCount: count('CONFIRMED'),
    absentCount: count('ABSENT'),
    refusedCount: count('REFUSED'),
    rejectedCount: count('REJECTED'),
    blockingConfirmed: skeleton.questions
      .filter(({ blocking }) => blocking)
      .every(({ questionId }) => Object.hasOwn(confirmed, questionId)),
    dispositions,
    confirmed,
    authority: {
      // A confirmed decision decides WHAT would be run.  It is not authorization to run:
      // no admission, production, execution or mutation authority is granted here.
      executionAuthority: 'NONE',
      admissionAuthority: 'NONE',
      mutationAuthority: 'NONE',
      humanComprehension: false,
    },
    neverManufactured: 'Every CONFIRMED value is a caller-supplied answer; no code path supplies one.',
  };
  return deepFreeze({ ...body, clarificationSha256: identitySha256(body) });
}

function resolveCandidate(skeleton, clarification) {
  const confirmed = clarification.confirmed;
  const find = (kind) => Object.values(confirmed).filter((entry) => entry.kind === kind);
  const grainAnswer = find('GRAIN')[0] ?? null;
  const periodAnswer = find('PERIOD')[0] ?? null;
  const unitsAnswer = find('UNITS')[0] ?? null;
  const amountAnswer = find('AMOUNT_COLUMN')[0] ?? null;
  const currencyAnswer = find('CURRENCY')[0] ?? null;
  const creditAnswer = find('CREDIT')[0] ?? null;
  const cancelAnswer = find('CANCEL')[0] ?? null;

  const decisionFor = (questionId) => clarification.dispositions
    .find(({ questionId: candidate }) => candidate === questionId) ?? null;
  const relationOfSubject = (subject) => (typeof subject === 'string' && subject.lastIndexOf('.') > 0
    ? subject.slice(0, subject.lastIndexOf('.'))
    : null);

  // F3 — the reserved ABSENCE selection is NOT an observed value: it is carried as an explicit
  // absence declaration and never becomes a record-kind mapping entry.
  const creditSelection = creditAnswer ? creditAnswer.value : null;
  const cancelSelection = cancelAnswer ? cancelAnswer.value : null;
  const creditValue = creditSelection === NO_OBSERVED_VALUE_TOKEN ? null : creditSelection;
  const cancelValue = cancelSelection === NO_OBSERVED_VALUE_TOKEN ? null : cancelSelection;

  const recordKindMapping = {};
  if (creditValue !== null) recordKindMapping[creditValue] = 'credit';
  if (cancelValue !== null) recordKindMapping[cancelValue] = 'cancel';

  const unresolved = [];
  for (const q of skeleton.questions) {
    const decision = decisionFor(q.questionId);
    const outstanding = decision.disposition !== 'CONFIRMED'
      || (q.kind === 'MISSING_DEFINITION' && decision.answer === UNRESOLVED_TOKEN);
    if (outstanding && q.kind !== 'CREDIT' && q.kind !== 'CANCEL') {
      unresolved.push({ questionId: q.questionId, kind: q.kind, disposition: decision.disposition, subject: q.subject });
    }
  }
  // Credit/cancel values that were neither confirmed as credit nor as cancel keep an
  // explicitly unresolved meaning: they are never silently treated as sales.
  for (const candidate of skeleton.inferred.recordKind.candidates) {
    const subject = `${candidate.relation}.${candidate.column}`;
    for (const value of candidate.observedValues) {
      if (recordKindMapping[value] === undefined) {
        unresolved.push({
          questionId: null,
          kind: 'KIND_VALUE_UNRESOLVED',
          disposition: 'ABSENT',
          subject: `${subject}=${value}`,
        });
      }
    }
  }

  // ---------------------------------------------------------------------------------
  // F2/F4 — explicit contradictions.  Each is carried with its own kind and subjects; a
  // candidate that carries one is NEVER labelled CONFIRMED and never hands off.
  // ---------------------------------------------------------------------------------
  const inconsistencies = [];
  const contradiction = (kind, detail, subjects) => inconsistencies.push({
    kind,
    detail,
    subjects: [...new Set(subjects.filter((subject) => typeof subject === 'string'))].sort(),
  });

  // (1) A selected grain whose declared key is observed non-unique: the confirmed grain is
  // not key-unique, so the selected row grain is not a grain.
  if (grainAnswer) {
    const grainCandidate = skeleton.inferred.grain
      .find(({ relation, keyColumn }) => `${relation}.${keyColumn}` === grainAnswer.value) ?? null;
    if (grainCandidate === null) {
      contradiction('GRAIN_SELECTION_NOT_DECLARED_CANDIDATE',
        `${grainAnswer.value} was selected as the metric grain but is not one of the declared key candidates of this schema.`,
        [grainAnswer.value]);
    } else if (grainCandidate.uniqueObserved === false) {
      contradiction('GRAIN_KEY_NOT_OBSERVED_UNIQUE',
        `${grainAnswer.value} is declared ${grainCandidate.keyKind} but the bounded aggregates observe it non-unique (${grainCandidate.nonNullCount} non-null / ${grainCandidate.distinctCount} distinct), so the selected grain does not identify one row.`,
        [grainAnswer.value]);
    }
  }

  // (2) A caller decision that affirms a declared minor-unit meaning while declaring the
  // arithmetic unit to be base units.
  const affirmedDeclaredMeanings = skeleton.questions
    .filter(({ kind }) => kind === 'MISLEADING_NAME')
    .map((q) => ({ q, decision: decisionFor(q.questionId) }))
    .filter(({ decision }) => decision.disposition === 'CONFIRMED'
      && decision.answer === 'DECLARED_MEANING_IS_CORRECT')
    .map(({ q }) => skeleton.inferred.units.amountColumns
      .find(({ relation, column }) => `${relation}.${column}` === q.subject) ?? null)
    .filter((candidate) => candidate !== null && candidate.declaredMeaning !== null)
    .filter(({ declaredMeaning }) => /\bcents?\b|\bminor unit/i.test(declaredMeaning));
  if (unitsAnswer && unitsAnswer.value === 'BASE_UNITS' && affirmedDeclaredMeanings.length > 0) {
    for (const candidate of affirmedDeclaredMeanings) {
      contradiction('UNITS_DECLARATION_CONFLICT',
        `the caller declared the arithmetic unit to be BASE_UNITS while also confirming that ${candidate.relation}.${candidate.column} declares "${candidate.declaredMeaning}"; a minor-unit declaration and a base-unit arithmetic unit cannot both hold.`,
        [`${candidate.relation}.${candidate.column}`, 'ks246-q-units']);
    }
  }

  // (3) Roles that span more than one relation while the caller DENIED the relationship that
  // connects them: the selected metric cannot be computed across a denied relation.
  const selectedRoleSubjects = [grainAnswer?.value, periodAnswer?.value, amountAnswer?.value, creditAnswer?.subject]
    .filter((subject) => typeof subject === 'string');
  const selectedRelations = new Set(selectedRoleSubjects.map(relationOfSubject).filter((relation) => relation !== null));
  const deniedRelationships = skeleton.questions
    .filter(({ kind }) => kind === 'FANOUT')
    .filter((q) => decisionFor(q.questionId).disposition === 'CONFIRMED'
      && decisionFor(q.questionId).answer === 'NOT_A_RELATIONSHIP');
  if (selectedRelations.size > 1) {
    for (const q of deniedRelationships) {
      const [sourceSubject, targetSubject] = String(q.subject).split('->');
      const sourceRelation = relationOfSubject(sourceSubject);
      const targetRelation = relationOfSubject(targetSubject);
      if (selectedRelations.has(sourceRelation) && selectedRelations.has(targetRelation)) {
        contradiction('DENIED_RELATIONSHIP_WITH_CROSS_RELATION_ROLES',
          `the selected metric roles span ${[...selectedRelations].sort().join(' and ')} while the caller denied the relationship ${q.subject}; roles spread over a denied relationship cannot form one computable metric.`,
          [...selectedRoleSubjects, q.subject]);
      }
    }
  }

  // (4) The two bounded reads claiming different source identities (F4).
  for (const inconsistency of skeleton.computed.ambiguities.evidenceInconsistencies ?? []) {
    contradiction(inconsistency.kind, inconsistency.detail, inconsistency.subjects);
  }

  if (creditValue !== null && cancelValue !== null && creditValue === cancelValue) {
    contradiction('KIND_VALUE_CONFLICT',
      `${creditValue} is claimed as both credit and cancellation`,
      [creditValue]);
  }
  // Every contradiction is ALSO carried in the unresolved-meaning channel: a contradiction is
  // not a resolved business rule, so the two lists can never disagree about it.
  for (const inconsistency of inconsistencies) {
    unresolved.push({
      questionId: null,
      kind: inconsistency.kind,
      disposition: 'CONFLICTING',
      subject: inconsistency.detail,
    });
  }

  const byCanonicalJson = (left, right) => Buffer.compare(
    Buffer.from(canonicalJson(left), 'utf8'),
    Buffer.from(canonicalJson(right), 'utf8'),
  );
  const answersRecorded = clarification.confirmedCount > 0;
  const status = inconsistencies.length > 0
    ? 'INCONSISTENT'
    : clarification.blockingConfirmed ? 'CONFIRMED'
      : answersRecorded ? 'PARTIALLY_CONFIRMED' : 'PROPOSED';

  const body = {
    grain: grainAnswer
      ? { selected: grainAnswer.value, confirmedBy: 'CALLER', questionSha256: grainAnswer.questionSha256 }
      : { selected: null, candidates: skeleton.inferred.grain },
    units: {
      selected: unitsAnswer ? unitsAnswer.value : null,
      amountColumn: amountAnswer ? amountAnswer.value : null,
      schemaDeclaration: skeleton.inferred.units.schemaDeclaration,
      candidates: skeleton.inferred.units.amountColumns,
      confirmedBy: unitsAnswer || amountAnswer ? 'CALLER' : null,
    },
    period: {
      selected: periodAnswer ? periodAnswer.value : null,
      candidates: skeleton.inferred.period,
      confirmedBy: periodAnswer ? 'CALLER' : null,
    },
    currency: currencyAnswer
      ? { selected: currencyAnswer.value, confirmedBy: 'CALLER' }
      : { selected: null, candidates: skeleton.inferred.currency.candidates },
    relationships: skeleton.inferred.relationships,
    recordKind: {
      column: creditAnswer?.subject ?? cancelAnswer?.subject ?? null,
      creditValue,
      cancelValue,
      absenceDeclarations: [creditSelection, cancelSelection]
        .filter((selection) => selection === NO_OBSERVED_VALUE_TOKEN)
        .slice()
        .sort(),
      mapping: Object.keys(recordKindMapping).length > 0 ? recordKindMapping : null,
      candidates: skeleton.inferred.recordKind.candidates,
    },
    unresolvedMeaning: unresolved.sort(byCanonicalJson),
    inconsistencies: inconsistencies.sort(byCanonicalJson),
    coherent: inconsistencies.length === 0,
    status,
    reviewState: 'REVIEW_REQUIRED',
    observationKind: 'INFERRED',
    executionAuthority: 'NONE',
    carriesResult: false,
  };
  return deepFreeze({ ...body, candidateSha256: identitySha256(body) });
}

// AC01 — build the reviewable candidate skeleton (observed / computed / inferred only).
export function buildUnfamiliarSchemaProposalSkeleton(metadata, aggregates) {
  const ambiguities = detectAmbiguities(metadata, aggregates);
  const inferred = inferRoles(metadata, aggregates, ambiguities);
  const questions = buildClarificationQuestions(inferred);
  const body = {
    schemaVersion: UNFAMILIAR_SCHEMA_PROPOSAL_SCHEMA,
    classification: SYNTHETIC_CLASSIFICATION,
    issue: 'KS246',
    source: {
      sourceRevision: metadata.sourceRevision,
      // F4 — the aggregate read's own revision is DISCLOSED next to the metadata revision, so
      // observations from two different source identities can never be silently merged under
      // one revision.
      aggregateSourceRevision: aggregates.sourceRevision,
      sourceRevisionMismatch: metadata.sourceRevision !== aggregates.sourceRevision,
      metadataSha256: metadata.metadataSha256,
      aggregateProfileSha256: aggregates.aggregateProfileSha256,
      accessMode: metadata.accessMode,
      aggregateAccessMode: aggregates.accessMode,
    },
    // AC01's three-way separation, as three differently-named layers.
    observed: {
      relations: metadata.relations,
      unitDeclaration: metadata.unitDeclaration,
      currencyDeclaration: metadata.currencyDeclaration,
      aggregateProfile: aggregates.relationProfiles,
      joinCandidates: aggregates.joinCandidateProfiles,
    },
    computed: { ambiguities },
    inferred,
    questions,
    nonclaims: UNFAMILIAR_SCHEMA_NONCLAIMS,
  };
  return deepFreeze({ ...body, skeletonSha256: identitySha256(body) });
}

export function proposeUnfamiliarSchemaCandidate({ metadataBytes, aggregateBytes, answers }) {
  const metadata = loadUnfamiliarMetadata(metadataBytes);
  const aggregates = loadAggregateProfile(aggregateBytes);
  const skeleton = buildUnfamiliarSchemaProposalSkeleton(metadata, aggregates);
  const clarification = applyClarifications(skeleton, answers ?? {});
  const candidate = resolveCandidate(skeleton, clarification);
  const body = {
    ...skeleton,
    confirmed: clarification.confirmed,
    clarification,
    metricCandidate: candidate,
    reviewState: 'REVIEW_REQUIRED',
    executionAuthority: 'NONE',
    mutationAuthority: 'NONE',
    carriesResult: false,
  };
  return deepFreeze({ ...body, proposalSha256: identitySha256(body) });
}

// AC02 — the actual proposal/clarification entry point: the questions are driven through
// a real answer source, never through canned answers embedded here.
export function runUnfamiliarSchemaProposalEntryPoint({ metadataBytes, aggregateBytes, answerSource }) {
  const metadata = loadUnfamiliarMetadata(metadataBytes);
  const aggregates = loadAggregateProfile(aggregateBytes);
  const skeleton = buildUnfamiliarSchemaProposalSkeleton(metadata, aggregates);
  const answers = {};
  for (const q of skeleton.questions) {
    const line = answerSource === undefined ? undefined : answerSource.nextLine();
    const normalized = normalizeAnswer(line);
    if (normalized.disposition === 'ANSWERED') answers[q.questionId] = normalized.value;
    else if (normalized.disposition === 'REFUSED') answers[q.questionId] = REFUSAL_TOKEN;
    // ABSENT: the key is simply not set, so the question stays ABSENT.
  }
  const clarification = applyClarifications(skeleton, answers);
  const candidate = resolveCandidate(skeleton, clarification);
  const body = {
    schemaVersion: UNFAMILIAR_SCHEMA_PROPOSAL_SCHEMA,
    classification: SYNTHETIC_CLASSIFICATION,
    issue: 'KS246',
    source: skeleton.source,
    skeletonSha256: skeleton.skeletonSha256,
    observed: skeleton.observed,
    computed: skeleton.computed,
    inferred: skeleton.inferred,
    confirmed: clarification.confirmed,
    clarification,
    metricCandidate: candidate,
    questions: skeleton.questions,
    nonclaims: UNFAMILIAR_SCHEMA_NONCLAIMS,
    reviewState: 'REVIEW_REQUIRED',
    executionAuthority: 'NONE',
    mutationAuthority: 'NONE',
    carriesResult: false,
  };
  return deepFreeze({ ...body, entryPointSha256: identitySha256(body) });
}

// ---------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------
// AC03 — DIRECTLY DEMONSTRATED LOCAL SUPPORT ONLY (claims narrowed to what is executed).
//
// This local handoff:
//   * re-derives the proposal's own digests from the local body it is handed and refuses a
//     proposal whose declared identity does not reproduce (so a copied digest is not trusted);
//   * requires every selected role to be one of the proposal's OWN inferred candidates;
//   * binds the caller's contract bytes to the released metric core's admitted contract digest
//     (ADMITTED_METRIC_CONTRACT_SHA256), so a contract with changed semantics is refused;
//   * refuses an INCONSISTENT proposal and any credit/cancel conflict;
//   * hands the accepted proposal to the existing metric entry point by NAME only.
// It does NOT execute a metric, does NOT provide trusted admission, and no admission consumer
// is implemented.  AC03's shared task handle is separately owned and explicitly NOT integrated
// (`sharedTaskHandle: 'NOT_INTEGRATED'`); AC04 admitted execution stays open.
// ---------------------------------------------------------------------------------
function assertReproducedIdentity(body, digestField, code) {
  if (!isPlainObject(body)) fail(code);
  const { [digestField]: declared, ...rest } = body;
  if (typeof declared !== 'string' || declared !== identitySha256(rest)) fail(code);
}

export function buildMetricHandoff({ proposal, metricContractBytes }) {
  if (!isPlainObject(proposal) || !isPlainObject(proposal.metricCandidate)) {
    fail('UNFAMILIAR_HANDOFF_DENIED:PROPOSAL');
  }
  const contract = parseBoundJson(metricContractBytes, 'UNFAMILIAR_HANDOFF_DENIED:CONTRACT');
  const operation = NET_REVENUE_OPERATION_REQUEST;
  // Reuse gate: the handed contract must BE the released metric contract the operation
  // names.  A substituted or unrelated contract is denied rather than silently accepted.
  if (contract.relation?.name !== operation.source.relation
      || contract.relation?.kind !== operation.source.relationKind
      || contract.orderDateRole?.column !== operation.source.dateRole.column
      || contract.currency?.amountColumn !== operation.source.currency.amountColumn
      || contract.currency?.code !== operation.source.currency.code
      || contract.currency?.minorUnitsPerMajorUnit !== operation.source.currency.minorUnitsPerMajorUnit) {
    fail('UNFAMILIAR_HANDOFF_DENIED:CONTRACT_NOT_RELEASED');
  }
  const fields = contract.relation.fields;
  if (!isPlainObject(fields)) fail('UNFAMILIAR_HANDOFF_DENIED:CONTRACT_NOT_RELEASED');
  // The canonical row roles, read from the released contract + frozen operation request.
  const idRole = Object.keys(fields).find((name) => name !== operation.source.dateRole.column
    && name !== operation.source.currency.amountColumn
    && name !== operation.aggregate.recordKindColumn);
  const releasedRoleVocabulary = {
    idField: idRole,
    dateField: operation.source.dateRole.column,
    kindField: operation.aggregate.recordKindColumn,
    amountField: operation.source.currency.amountColumn,
  };
  if (Object.values(releasedRoleVocabulary).some((value) => typeof value !== 'string')) {
    fail('UNFAMILIAR_HANDOFF_DENIED:RELEASED_ROLE_VOCABULARY');
  }
  const releasedKindVocabulary = Object.keys(contract.recordRules ?? {}).sort();
  if (!releasedKindVocabulary.includes('credit') || !releasedKindVocabulary.includes('cancel')) {
    fail('UNFAMILIAR_HANDOFF_DENIED:KIND_NOT_IN_RELEASED_CONTRACT');
  }
  // Whole-contract identity: the released metric core is the single authority for its own
  // contract digest, so a contract whose SEMANTICS were changed is refused rather than
  // accepted on a key-presence comparison.
  const contractBytes = bytesOf(metricContractBytes, 'UNFAMILIAR_HANDOFF_DENIED:CONTRACT');
  if (sha256(contractBytes) !== ADMITTED_METRIC_CONTRACT_SHA256) {
    fail('UNFAMILIAR_HANDOFF_DENIED:CONTRACT_DIGEST_NOT_RELEASED');
  }

  // Local identity: the proposal's own digests must REPRODUCE from the body being handed.
  // A copied hash field, a substituted source revision or an invented role is denied here.
  const candidate = proposal.metricCandidate;
  const proposalIdentityCode = 'UNFAMILIAR_HANDOFF_DENIED:PROPOSAL_IDENTITY';
  assertReproducedIdentity(candidate, 'candidateSha256', proposalIdentityCode);
  if (typeof proposal.entryPointSha256 === 'string') {
    assertReproducedIdentity(proposal, 'entryPointSha256', proposalIdentityCode);
  } else if (typeof proposal.proposalSha256 === 'string') {
    assertReproducedIdentity(proposal, 'proposalSha256', proposalIdentityCode);
  } else {
    fail(proposalIdentityCode);
  }
  assertReproducedIdentity(proposal.clarification, 'clarificationSha256', proposalIdentityCode);
  const inferred = proposal.inferred;
  if (!isPlainObject(inferred)) fail('UNFAMILIAR_HANDOFF_DENIED:PROPOSAL');
  const grainCatalog = new Set(inferred.grain.map(({ relation, keyColumn }) => `${relation}.${keyColumn}`));
  const periodCatalog = new Set(inferred.period.map(({ relation, column }) => `${relation}.${column}`));
  const amountCatalog = new Set(inferred.units.amountColumns.map(({ relation, column }) => `${relation}.${column}`));
  const currencyCatalog = new Set(inferred.currency.candidates.flatMap(({ observedValues }) => observedValues));
  // Every SELECTED role must be one of the proposal's own inferred candidates.  An unselected
  // role is not a substitute check: it is simply not answered yet (denied further below).
  const selectedRoles = [
    ['grain', candidate.grain.selected, grainCatalog],
    ['period', candidate.period.selected, periodCatalog],
    ['amountColumn', candidate.units.amountColumn, amountCatalog],
    ['currency', candidate.currency.selected, currencyCatalog],
  ];
  for (const [role, value, catalog] of selectedRoles) {
    if (typeof value === 'string' && !catalog.has(value)) {
      fail(`UNFAMILIAR_HANDOFF_DENIED:ROLE_NOT_IN_INFERRED_CANDIDATES:${role}`);
    }
  }

  // F3 — absence and contradiction are never mapped into a record value.
  const credit = candidate.recordKind?.creditValue ?? null;
  const cancel = candidate.recordKind?.cancelValue ?? null;
  if (credit !== null && cancel !== null && credit === cancel) {
    fail('UNFAMILIAR_HANDOFF_DENIED:KIND_CONFLICT');
  }
  // F2/F4 — a contradictory proposal is never handed off, and never labelled confirmed.
  if (candidate.status === 'INCONSISTENT' || (candidate.inconsistencies?.length ?? 0) > 0) {
    fail('UNFAMILIAR_HANDOFF_DENIED:INCONSISTENT_PROPOSAL');
  }
  if (candidate.status !== 'CONFIRMED') {
    fail('UNFAMILIAR_HANDOFF_DENIED:UNCONFIRMED_QUESTIONS');
  }
  if (credit === null || cancel === null) {
    fail('UNFAMILIAR_HANDOFF_DENIED:UNCONFIRMED_KIND_SEMANTICS');
  }
  // Reuse gates on the RELEASED metric core's own declarations: the released arithmetic is
  // integer MINOR units of one currency.  A caller may legitimately answer otherwise, but
  // such a decision is not an admissible handoff and is denied by name here.
  if (candidate.units.selected !== 'MINOR_UNITS') {
    fail('UNFAMILIAR_HANDOFF_DENIED:ARITHMETIC_UNIT_NOT_RELEASED');
  }
  if (candidate.currency.selected !== operation.source.currency.code) {
    fail('UNFAMILIAR_HANDOFF_DENIED:CURRENCY_NOT_RELEASED');
  }

  const kindMapping = { [credit]: 'credit', [cancel]: 'cancel' };
  for (const [value, kind] of Object.entries(kindMapping)) {
    if (!releasedKindVocabulary.includes(kind)) fail('UNFAMILIAR_HANDOFF_DENIED:KIND_NOT_IN_RELEASED_CONTRACT');
    if (typeof value !== 'string') fail('UNFAMILIAR_HANDOFF_DENIED:KIND_VALUE');
  }
  const residualKindValues = candidate.recordKind.candidates
    .flatMap(({ observedValues }) => observedValues)
    .filter((value) => kindMapping[value] === undefined)
    .sort();

  const body = {
    schemaVersion: UNFAMILIAR_SCHEMA_HANDOFF_SCHEMA,
    observationKind: 'CONFIRMED',
    source: proposal.source,
    proposalSha256: proposal.proposalSha256 ?? proposal.entryPointSha256,
    candidateSha256: candidate.candidateSha256,
    clarificationSha256: proposal.clarification.clarificationSha256,
    decisionsSha256: identitySha256(proposal.confirmed),
    releasedOperationId: operation.operationId,
    releasedContractSha256: sha256(contractBytes),
    releasedRoleVocabulary,
    releasedKindVocabulary,
    identity: {
      proposalIdentity: 'RECOMPUTED_FROM_LOCAL_BODY',
      proposalDigestField: typeof proposal.entryPointSha256 === 'string' ? 'entryPointSha256' : 'proposalSha256',
      candidateIdentity: 'RECOMPUTED_FROM_LOCAL_BODY',
      selectedRoles: 'ALL_SELECTED_ROLES_ARE_DECLARED_INFERRED_CANDIDATES',
      contractIdentity: 'RELEASED_ADMITTED_CONTRACT_DIGEST_MATCHED',
      admissionConsumerImplemented: false,
    },
    canonicalRowBinding: {
      idField: { role: releasedRoleVocabulary.idField, source: candidate.grain.selected },
      dateField: { role: releasedRoleVocabulary.dateField, source: candidate.period.selected },
      kindField: {
        role: releasedRoleVocabulary.kindField,
        source: candidate.recordKind.column,
        confirmedMapping: kindMapping,
        residualKindValues,
        absenceDeclarations: candidate.recordKind.absenceDeclarations,
      },
      amountField: {
        role: releasedRoleVocabulary.amountField,
        source: candidate.units.amountColumn,
        unitScale: candidate.units.selected,
        currency: candidate.currency.selected,
      },
    },
    ownerEntryPoint: 'compileNetRevenuePlan',
    status: 'REVIEW_REQUIRED',
    authority: {
      executionAuthority: 'NONE',
      admissionAuthority: 'NONE',
      mutationAuthority: 'NONE',
      metricExecution: 'NOT_PERFORMED',
      admissionConsumer: 'NOT_IMPLEMENTED',
      arbitrarySql: false,
      // AC03's shared task handle is separately owned; this local handoff does NOT
      // pretend to be it.
      sharedTaskHandle: 'NOT_INTEGRATED',
      humanComprehension: false,
    },
    unresolvedMeaning: candidate.unresolvedMeaning,
    nonclaims: [
      ...UNFAMILIAR_SCHEMA_NONCLAIMS,
      'The handoff is a locally verified bound proposal, not admission: it executes no metric, provides no trusted admission, and no admission consumer is implemented.',
      'Residual kind values are neither credit, cancel nor silently sale; they stay explicitly unresolved.',
      'Absence (no observed value holds a role) is carried as an absence declaration, never as a fabricated record value.',
    ],
  };
  return deepFreeze({ ...body, handoffSha256: identitySha256(body) });
}

export const UNFAMILIAR_SCHEMA_NONCLAIMS = Object.freeze([
  'No production or customer claim: only authored synthetic non-customer bytes are read.',
  'No arbitrary SQL and no row material: access is bounded metadata plus bounded aggregate counts.',
  'No implicit approval: a proposal, a confirmed decision and a handoff all grant no admission or execution authority.',
  'No second metric, no second currency and no second date role: the released metric core stays the single authority.',
  'No generalization claim: one authored synthetic unfamiliar schema is a local proof, not a measured blind result.',
  'No semantic truth claim: a detected ambiguity is a named rule outcome, and unclassified anomalies stay recorded blind spots.',
]);

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
