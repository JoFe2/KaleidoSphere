// KaleidoSphere #248 (KS-EVO-03) — the composed analysis journey compared under three
// declared information-rights access modes, against an INDEPENDENT deterministic reference
// and a hidden evaluation holdout.
//
// Result / DoD: "A small reproducible comparison proves or falsifies correctness and useful
// reuse under declared information rights and source/rule changes."
//
// Reuse (never a replacement metric implementation):
//   * `net-revenue-segment-comparison.mjs` — the RELEASED comparison is composed as the
//     INTEGRATED PATH and is imported read-only; its period windows, recognition rule and
//     missing-data semantics are carried through (this module never re-derives them).
//   * `tests/fixtures/business-bi/net-revenue-segment-v1.json` — the RELEASED synthetic
//     source, used unchanged as the full-data source bytes.
//   * The #145/#146 oracle and #237 mapping expectations stay where they are; this slice adds
//     the ACCESS-MODE comparison and does not replace them.
//
// What is genuinely NEW here:
//   1. three closed access modes (`METADATA_ONLY`, `PERMITTED_AGGREGATES`,
//      `PERMITTED_FULL_DATA`) that actually restrict what the runner may read, with a
//      JUSTIFIED abstention when a question is unanswerable inside the granted rights;
//   2. a competent DETERMINISTIC REFERENCE written independently of the released core, so the
//      integrated path is compared against something that is not itself;
//   3. evaluator-owned frozen cases whose EXPECTATIONS ARE HELD OUTSIDE the case input, with
//      the public CALIBRATION set and the BLIND holdout kept separate and never mixed;
//   4. denied FX, denied credits, boundary dates and ambiguous joins as named boundaries, and
//      one-cent / rule mutations that must FAIL the independent checker;
//   5. a metric set in which anything not actually measured stays `null` with an `UNKNOWN`
//      reason — a missing metric is never invented.
//
// This is a LOCAL SYNTHETIC comparison. It grants no production, customer, cross-tenant,
// real-source or publication authority, and it is not a measured superiority claim.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  ORDER_STATUSES,
  PERIODS,
  SEGMENT_DIMENSIONS,
  assertSegmentSourceRow,
  canonicalJson,
  compareSegmentsAcrossPeriods,
} from './net-revenue-segment-comparison.mjs';

export const ACCESS_MODE_COMPARISON_SCHEMA =
  'kaleidosphere.business-bi/access-mode-journey-comparison/v1';
export const ACCESS_MODE_CASES_SCHEMA =
  'kaleidosphere.business-bi/access-mode-cases/v1';
export const ACCESS_MODE_HOLDOUT_SCHEMA =
  'kaleidosphere.business-bi/access-mode-holdout/v1';
export const ACCESS_MODE_SOURCE_IDENTITY_SCHEMA =
  'kaleidosphere.business-bi/access-mode-source-identity/v1';
export const ACCESS_MODE_CLASSIFICATION = 'SYNTHETIC_NON_CUSTOMER_BYTES';
export const ACCESS_MODE_FORMATS = Object.freeze(['JSON', 'TABLE']);

// AC02: the three information-rights access modes. The mode is a DECLARED restriction that the
// runner enforces, not a label on the answer.
export const ACCESS_MODES_V1 = Object.freeze([
  'METADATA_ONLY',
  'PERMITTED_AGGREGATES',
  'PERMITTED_FULL_DATA',
]);

// AC02: the observable outcome vocabulary. ABSTAINED is a JUSTIFIED abstention — the question
// is answerable in principle but not inside the granted rights — and is never an empty value.
export const OBSERVED_OUTCOMES_V1 = Object.freeze([
  'ACCEPTED',
  'ABSTAINED',
  'REFUSED_DENIED_FX',
  'REFUSED_DENIED_CREDITS',
  'REFUSED_BOUNDARY_DATE',
  'REFUSED_AMBIGUOUS_JOIN',
  'REFUSED_ACCESS_MODE',
]);

// AC02/AC03: the questions the comparison may ask of the composed journey.
export const QUESTIONS_V1 = Object.freeze([
  'NET_REVENUE_DELTA',
  'SEGMENT_NET_TOTALS',
  'ORDER_STATUS_DETAIL',
]);

// AC02: the boundary-date rule is EXPLICIT in the case; it is never assumed.
export const BOUNDARY_RULES_V1 = Object.freeze([
  'INCLUDE_BOUNDARY_DATES',
  'EXCLUDE_BOUNDARY_DATES',
  'UNSPECIFIED',
]);

// AC04: every metric is EITHER an actual count OR null with an UNKNOWN reason.
export const METRIC_KEYS_V1 = Object.freeze([
  'correctAcceptance',
  'falseAcceptance',
  'falseRefusal',
  'clarificationsRequested',
  'correctionsRequired',
  'waiting',
  'activeHumanOrAgentWork',
  'measurableCostMinorUnits',
]);

const UNKNOWN_METRIC_REASONS = Object.freeze({
  waiting: 'NOT_INSTRUMENTED: no wall-clock or waiting surface is observed by this comparison',
  activeHumanOrAgentWork: 'NOT_INSTRUMENTED: no human or agent actor is observed by this comparison',
  measurableCostMinorUnits: 'NOT_INVENTED: no priced execution surface is available to this slice',
});

export const ACCESS_MODE_NONCLAIMS = Object.freeze([
  'Local synthetic comparison only: no production, customer, cross-tenant or real-source access.',
  'The access modes are DECLARED synthetic restrictions enforced by this module, not a database privilege system.',
  'No second metric implementation: the released comparison is composed, and the reference is an independent CHECK, not a competing product path.',
  'A missing metric is null with an UNKNOWN reason and is never inferred.',
  'No measured superiority, no broad-maturity and no real-environment claim.',
  'No arbitrary SQL/host authority, no productive effect and no public write.',
]);

// ---------------------------------------------------------------------------
// Primitives.
// ---------------------------------------------------------------------------
const isRecord = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const isDenseArray = (value) =>
  Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype;
const closedString = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128;
const sha256Hex = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const closedId = (value) =>
  typeof value === 'string' && /^[a-z][a-z0-9-]{1,31}:[a-z0-9][a-z0-9._-]{2,95}$/.test(value);
const inSet = (set, value) => set.includes(value);
const canonicalKeySet = (keys) => JSON.stringify(canonicalJson([...keys].sort()));
const exactKeys = (value, keys) =>
  isRecord(value) && canonicalKeySet(Object.keys(value)) === canonicalKeySet(keys);
const sha256 = (value) => createHash('sha256').update(JSON.stringify(canonicalJson(value)), 'utf8').digest('hex');
const bytesSha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const deny = (code, detail = {}) => ({ outcome: 'DENIED', code: `KS248_COMPARISON_DENIED:${code}`, ...detail });

// ---------------------------------------------------------------------------
// AC01 — evaluator-owned frozen cases. The case carries NO expectation: the numbers and the
// expected outcome class live in the holdout, which is bound by its own digest.
// ---------------------------------------------------------------------------
function validCases(value) {
  if (!exactKeys(value, ['schemaVersion', 'classification', 'casesVersion', 'cases'])) return false;
  if (value.schemaVersion !== ACCESS_MODE_CASES_SCHEMA
    || value.classification !== ACCESS_MODE_CLASSIFICATION
    || !closedString(value.casesVersion)
    || !isDenseArray(value.cases) || value.cases.length === 0) return false;
  for (const item of value.cases) {
    if (!exactKeys(item, ['caseId', 'accessMode', 'question', 'boundaryRule',
      'requiresFxConversion', 'requiresCredits', 'requiresJoinResolution', 'blind'])) return false;
    if (!closedId(item.caseId) || !inSet(ACCESS_MODES_V1, item.accessMode)
      || !inSet(QUESTIONS_V1, item.question) || !inSet(BOUNDARY_RULES_V1, item.boundaryRule)
      || typeof item.requiresFxConversion !== 'boolean'
      || typeof item.requiresCredits !== 'boolean'
      || typeof item.requiresJoinResolution !== 'boolean'
      || typeof item.blind !== 'boolean') return false;
  }
  const ids = value.cases.map(({ caseId }) => caseId);
  return ids.length === new Set(ids).size;
}

function validHoldout(value, { expectBlind }) {
  if (!exactKeys(value, ['schemaVersion', 'classification', 'evaluationId', 'blind', 'digest',
    'expectations'])) return false;
  if (value.schemaVersion !== ACCESS_MODE_HOLDOUT_SCHEMA
    || value.classification !== ACCESS_MODE_CLASSIFICATION
    || !closedString(value.evaluationId)
    || typeof value.blind !== 'boolean'
    || value.blind !== expectBlind
    || !sha256Hex(value.digest)
    || !isDenseArray(value.expectations)) return false;
  for (const entry of value.expectations) {
    if (!exactKeys(entry, ['caseId', 'expectedOutcome', 'expectedNetRevenue'])
      || !closedId(entry.caseId)
      || !inSet(OBSERVED_OUTCOMES_V1, entry.expectedOutcome)) return false;
    const net = entry.expectedNetRevenue;
    if (net !== null) {
      if (!exactKeys(net, ['comparisonNetMinorUnits', 'currentNetMinorUnits', 'deltaNetMinorUnits'])) return false;
      if (![net.comparisonNetMinorUnits, net.currentNetMinorUnits, net.deltaNetMinorUnits]
        .every((value_) => Number.isInteger(value_))) return false;
      if (net.deltaNetMinorUnits !== net.currentNetMinorUnits - net.comparisonNetMinorUnits) return false;
    } else if (entry.expectedOutcome === 'ACCEPTED') {
      return false; // an accepted outcome without a number is not an expectation
    }
  }
  const ids = value.expectations.map(({ caseId }) => caseId);
  if (ids.length !== new Set(ids).size) return false;
  // The held-out body excludes its own digest.
  const { digest: _ignored, ...body } = value;
  return sha256(body) === value.digest;
}

function validSourceIdentity(value) {
  return exactKeys(value, ['schemaVersion', 'classification', 'sourceLabel', 'sourceBytesSha256', 'ambiguousJoinKeys'])
    && value.schemaVersion === ACCESS_MODE_SOURCE_IDENTITY_SCHEMA
    && value.classification === ACCESS_MODE_CLASSIFICATION
    && closedString(value.sourceLabel)
    && sha256Hex(value.sourceBytesSha256)
    && isDenseArray(value.ambiguousJoinKeys)
    && value.ambiguousJoinKeys.every((key) => typeof key === 'string' && key.length > 0);
}

// ---------------------------------------------------------------------------
// The permitted projection per access mode + granted rights.
// ---------------------------------------------------------------------------
function permittedProjection({ rows, accessMode, rights }) {
  if (accessMode === 'METADATA_ONLY') {
    // Field profile and counts only. No amount is read at all.
    const profile = new Map();
    for (const row of rows) {
      for (const [field, value] of Object.entries(row)) {
        const entry = profile.get(field) ?? { field, observedTypes: new Set(), nullCount: 0 };
        entry.observedTypes.add(value === null ? 'NULL' : typeof value);
        if (value === null) entry.nullCount += 1;
        profile.set(field, entry);
      }
    }
    return {
      mode: accessMode,
      rowCount: rows.length,
      metadata: [...profile.values()].map((entry) => ({
        field: entry.field,
        observedTypes: [...entry.observedTypes].sort(),
        nullCount: entry.nullCount,
      })).sort((left, right) => left.field.localeCompare(right.field)),
      aggregates: null,
      rows: null,
    };
  }
  if (accessMode === 'PERMITTED_AGGREGATES') {
    // Aggregate totals only: no order-level row leaves this projection. Credits are aggregated
    // only when the credits right is granted; otherwise the credit aggregate is DENIED, not 0.
    const totals = new Map();
    // The credits right is enforced by what the projection READS: when credits are DENIED, a
    // credit row is not read at all (never read-then-zeroed).
    const readable = rights.credits === 'PERMITTED' ? rows : rows.filter((row) => row.record_kind !== 'credit');
    for (const row of readable) {
      if (row.amount_minor_units === null || row.order_date === null) continue;
      const period = periodOf(row.order_date);
      if (period === null) continue;
      const key = `${period}|${row.segment}`;
      const entry = totals.get(key) ?? { period, segment: row.segment, sale: 0, credit: 0, cancelCount: 0 };
      if (row.record_kind === 'sale') entry.sale += row.amount_minor_units;
      else if (row.record_kind === 'credit') entry.credit += row.amount_minor_units;
      else if (row.record_kind === 'cancel') entry.cancelCount += 1;
      totals.set(key, entry);
    }
    return {
      mode: accessMode,
      rowCount: rows.length,
      metadata: null,
      aggregates: [...totals.values()].sort((left, right) =>
        `${left.period}|${left.segment}`.localeCompare(`${right.period}|${right.segment}`)),
      creditsAggregate: rights.credits === 'PERMITTED' ? 'PERMITTED' : 'DENIED',
      rows: null,
    };
  }
  const readable = rights.credits === 'PERMITTED' ? rows : rows.filter((row) => row.record_kind !== 'credit');
  return {
    mode: accessMode,
    rowCount: rows.length,
    metadata: null,
    aggregates: null,
    rows: readable,
    creditsReadable: rights.credits === 'PERMITTED',
  };
}

const periodOf = (date) =>
  date >= PERIODS.comparison.start && date <= PERIODS.comparison.end ? 'comparison'
    : date >= PERIODS.current.start && date <= PERIODS.current.end ? 'current'
      : null;

// ---------------------------------------------------------------------------
// The competent DETERMINISTIC REFERENCE. Written independently of the released core and
// deliberately in a different shape (a single ordered fold with an explicit boundary rule), so
// agreement with the integrated path is evidence and not a tautology.
// ---------------------------------------------------------------------------
function deterministicReference({ rows, boundaryRule, audienceSegments = SEGMENT_DIMENSIONS }) {
  let comparisonNet = 0;
  let currentNet = 0;
  const segments = { comparison: {}, current: {} };
  for (const segment of audienceSegments) {
    segments.comparison[segment] = 0;
    segments.current[segment] = 0;
  }
  const boundaryDates = [];
  let excludedBoundaryRows = 0;
  for (const row of rows) {
    if (row.order_date === null || row.amount_minor_units === null) continue;
    const onBoundary = row.order_date === PERIODS.comparison.start
      || row.order_date === PERIODS.comparison.end
      || row.order_date === PERIODS.current.start
      || row.order_date === PERIODS.current.end;
    if (onBoundary) {
      boundaryDates.push({ order_id: row.order_id, order_date: row.order_date });
      if (boundaryRule === 'EXCLUDE_BOUNDARY_DATES') {
        excludedBoundaryRows += 1;
        continue;
      }
    }
    const period = periodOf(row.order_date);
    if (period === null) continue;
    const signed = row.record_kind === 'sale' ? row.amount_minor_units
      : row.record_kind === 'credit' ? -row.amount_minor_units
        : 0;
    if (period === 'comparison') comparisonNet += signed; else currentNet += signed;
    if (row.record_kind === 'sale' && inSet(audienceSegments, row.segment)) {
      segments[period][row.segment] += row.amount_minor_units;
    }
  }
  return {
    comparisonNetMinorUnits: comparisonNet,
    currentNetMinorUnits: currentNet,
    deltaNetMinorUnits: currentNet - comparisonNet,
    segmentNetMinorUnits: segments,
    boundaryDates: boundaryDates.sort((left, right) => left.order_id.localeCompare(right.order_id)),
    excludedBoundaryRows,
    boundaryRule,
  };
}

function integratedPath(rows) {
  const released = compareSegmentsAcrossPeriods(rows);
  return {
    comparisonNetMinorUnits: released.comparison.netRevenue,
    currentNetMinorUnits: released.current.netRevenue,
    deltaNetMinorUnits: released.delta.netRevenue,
    segmentNetMinorUnits: { comparison: released.comparison.segments, current: released.current.segments },
    excludedOutOfScopeCount: released.excludedOutOfScopeCount,
  };
}

// ---------------------------------------------------------------------------
// AC02/AC03 — run one case against its declared rights and the granted access mode.
// ---------------------------------------------------------------------------
function runCase({ item, rows, rights, sourceIdentity }) {
  // Denied rights are checked BEFORE anything is read: an un-granted right is a refusal with
  // its own name, never a silently zeroed number.
  if (item.requiresFxConversion && rights.fxConversion === 'DENIED') {
    return { caseId: item.caseId, accessMode: item.accessMode, observedOutcome: 'REFUSED_DENIED_FX', numbers: null, basis: 'RIGHT_DENIED' };
  }
  if (item.requiresCredits && rights.credits === 'DENIED') {
    return { caseId: item.caseId, accessMode: item.accessMode, observedOutcome: 'REFUSED_DENIED_CREDITS', numbers: null, basis: 'RIGHT_DENIED' };
  }
  if (item.boundaryRule === 'UNSPECIFIED') {
    return { caseId: item.caseId, accessMode: item.accessMode, observedOutcome: 'ABSTAINED', numbers: null, basis: 'BOUNDARY_RULE_UNSPECIFIED' };
  }
  // An ambiguous join inside the granted scope cannot be answered without inventing a
  // resolution: a case that NEEDS the join refuses by name instead of guessing.
  const ambiguousInScope = sourceIdentity.ambiguousJoinKeys.length > 0;
  if (item.requiresJoinResolution && ambiguousInScope) {
    return { caseId: item.caseId, accessMode: item.accessMode, observedOutcome: 'REFUSED_AMBIGUOUS_JOIN', numbers: null, basis: 'AMBIGUOUS_JOIN_KEY_IN_SCOPE', ambiguousJoinKeys: [...sourceIdentity.ambiguousJoinKeys] };
  }
  const projection = permittedProjection({ rows, accessMode: item.accessMode, rights });

  if (item.question === 'ORDER_STATUS_DETAIL') {
    // Order-status detail needs row-level access; aggregates and metadata cannot answer it.
    if (item.accessMode !== 'PERMITTED_FULL_DATA') {
      return { caseId: item.caseId, accessMode: item.accessMode, observedOutcome: 'ABSTAINED', numbers: null, basis: 'ACCESS_MODE_INSUFFICIENT_FOR_ROW_LEVEL_QUESTION', projection };
    }
    const counts = Object.fromEntries(ORDER_STATUSES.map((status) => [status, 0]));
    for (const row of projection.rows) {
      if (row.order_date === null) continue;
      if (periodOf(row.order_date) === null) continue;
      if (inSet(ORDER_STATUSES, row.status)) counts[row.status] += 1;
    }
    return { caseId: item.caseId, accessMode: item.accessMode, observedOutcome: 'ACCEPTED', numbers: null, statusCounts: counts, basis: 'ROW_LEVEL_PERMITTED', projection };
  }

  if (item.accessMode === 'METADATA_ONLY') {
    // The question is numeric; metadata alone cannot answer it. A JUSTIFIED abstention.
    return { caseId: item.caseId, accessMode: item.accessMode, observedOutcome: 'ABSTAINED', numbers: null, basis: 'METADATA_ONLY_CANNOT_ANSWER_A_NUMERIC_QUESTION', projection };
  }

  if (item.accessMode === 'PERMITTED_AGGREGATES') {
    // Aggregates answer the numeric questions without row-level access, and the reference is
    // recomputed from the AGGREGATE projection rather than from rows.
    let comparisonNet = 0;
    let currentNet = 0;
    const segments = { comparison: {}, current: {} };
    for (const segment of SEGMENT_DIMENSIONS) { segments.comparison[segment] = 0; segments.current[segment] = 0; }
    for (const entry of projection.aggregates) {
      const net = entry.sale - (projection.creditsAggregate === 'PERMITTED' ? entry.credit : 0);
      if (entry.period === 'comparison') comparisonNet += net; else currentNet += net;
      if (entry.segment in segments.comparison) segments[entry.period][entry.segment] += entry.sale;
    }
    const numbers = {
      comparisonNetMinorUnits: comparisonNet,
      currentNetMinorUnits: currentNet,
      deltaNetMinorUnits: currentNet - comparisonNet,
      segmentNetMinorUnits: segments,
    };
    return {
      caseId: item.caseId, accessMode: item.accessMode, observedOutcome: 'ACCEPTED', numbers,
      basis: 'PERMITTED_AGGREGATES_OVER_THE_RELEASED_PERIOD_WINDOWS', projection,
      creditsAggregate: projection.creditsAggregate,
    };
  }

  // PERMITTED_FULL_DATA: the INTEGRATED PATH is composed and the independent REFERENCE is
  // computed alongside it, then compared.
  const permittedRows = projection.rows;
  const boundaryRows = permittedRows.filter((row) => row.order_date === PERIODS.comparison.start
    || row.order_date === PERIODS.comparison.end
    || row.order_date === PERIODS.current.start
    || row.order_date === PERIODS.current.end);
  if (boundaryRows.length > 0 && item.boundaryRule === 'EXCLUDE_BOUNDARY_DATES') {
    return { caseId: item.caseId, accessMode: item.accessMode, observedOutcome: 'REFUSED_BOUNDARY_DATE', numbers: null, basis: 'EXCLUSIVE_BOUNDARY_RULE_NOT_AVAILABLE_ON_THE_RELEASED_PATH', boundaryRowCount: boundaryRows.length, projection };
  }
  try {
    for (const row of permittedRows) assertSegmentSourceRow(row);
  } catch (error) {
    return { caseId: item.caseId, accessMode: item.accessMode, observedOutcome: 'ABSTAINED', numbers: null, basis: `RELEASED_PATH_REFUSED_THE_SOURCE:${String(error?.message ?? error)}`, projection };
  }
  const integrated = integratedPath(permittedRows);
  const reference = deterministicReference({ rows: permittedRows, boundaryRule: item.boundaryRule });
  const agrees = integrated.comparisonNetMinorUnits === reference.comparisonNetMinorUnits
    && integrated.currentNetMinorUnits === reference.currentNetMinorUnits
    && integrated.deltaNetMinorUnits === reference.deltaNetMinorUnits;
  return {
    caseId: item.caseId,
    accessMode: item.accessMode,
    observedOutcome: 'ACCEPTED',
    numbers: {
      comparisonNetMinorUnits: integrated.comparisonNetMinorUnits,
      currentNetMinorUnits: integrated.currentNetMinorUnits,
      deltaNetMinorUnits: integrated.deltaNetMinorUnits,
      segmentNetMinorUnits: integrated.segmentNetMinorUnits,
    },
    reference,
    integratedPathAgreesWithReference: agrees,
    basis: 'RELEASED_INTEGRATED_PATH_PLUS_INDEPENDENT_DETERMINISTIC_REFERENCE',
    projection,
  };
}

// ---------------------------------------------------------------------------
// AC04 — correctness, false acceptance / refusal, clarification and correction counting.
// ---------------------------------------------------------------------------
function classify(observed, expectation) {
  if (observed.observedOutcome === 'ACCEPTED' && expectation.expectedOutcome !== 'ACCEPTED') {
    return 'FALSE_ACCEPTANCE';
  }
  if (observed.observedOutcome !== 'ACCEPTED' && expectation.expectedOutcome === 'ACCEPTED') {
    return observed.observedOutcome === 'ABSTAINED' ? 'JUSTIFIED_ABSTENTION' : 'FALSE_REFUSAL';
  }
  if (observed.observedOutcome !== 'ACCEPTED') {
    return observed.observedOutcome === expectation.expectedOutcome ? 'REFUSAL_MATCH' : 'WRONG_REFUSAL_REASON';
  }
  const expected = expectation.expectedNetRevenue;
  const actual = observed.numbers;
  if (actual === null) return 'FALSE_ACCEPTANCE';
  return actual.comparisonNetMinorUnits === expected.comparisonNetMinorUnits
    && actual.currentNetMinorUnits === expected.currentNetMinorUnits
    && actual.deltaNetMinorUnits === expected.deltaNetMinorUnits
    ? 'CORRECT_ACCEPTANCE'
    : 'WRONG_NUMBER';
}

/**
 * Public entry point. `cases`, `holdout`, `calibration`, `rights`, `rows` and `now` are all
 * REQUIRED: the expectations are NEVER read from the candidate input, and the calibration set
 * and the blind holdout are handled as two separate populations.
 */
export function buildAccessModeJourneyComparison({
  cases,
  holdout,
  calibration,
  rights,
  rows,
  sourceIdentity,
  now,
} = {}) {
  const missing = [];
  if (cases === undefined) missing.push('cases');
  if (holdout === undefined) missing.push('holdout');
  if (calibration === undefined) missing.push('calibration');
  if (rights === undefined) missing.push('rights');
  if (rows === undefined) missing.push('rows');
  if (sourceIdentity === undefined) missing.push('sourceIdentity');
  if (!closedString(now)) missing.push('now');
  if (missing.length > 0) return deny('INPUT_REQUIRED', { missing });

  if (!validCases(cases)) return deny('CASES_MALFORMED');
  if (!validHoldout(holdout, { expectBlind: true })) return deny('HOLDOUT_MALFORMED');
  if (!validHoldout(calibration, { expectBlind: false })) return deny('CALIBRATION_MALFORMED');
  if (!validSourceIdentity(sourceIdentity)) return deny('SOURCE_IDENTITY_MALFORMED');
  if (!isDenseArray(rows) || rows.length === 0) return deny('ROWS_REQUIRED');
  if (!exactKeys(rights, ['fxConversion', 'credits', 'rowLevel'])) return deny('RIGHTS_MALFORMED');
  if (!['PERMITTED', 'DENIED'].includes(rights.fxConversion)
    || !['PERMITTED', 'DENIED'].includes(rights.credits)
    || !['PERMITTED', 'DENIED'].includes(rights.rowLevel)) return deny('RIGHTS_MALFORMED');
  // The independently retained source identity must be the bytes actually executed.
  if (bytesSha256(JSON.stringify(rows)) !== sourceIdentity.sourceBytesSha256) {
    return deny('SOURCE_SUBSTITUTION', {
      declared: sourceIdentity.sourceBytesSha256,
      observed: bytesSha256(JSON.stringify(rows)),
    });
  }
  const holdoutIds = new Set(holdout.expectations.map(({ caseId }) => caseId));
  const calibrationIds = new Set(calibration.expectations.map(({ caseId }) => caseId));
  for (const item of cases.cases) {
    if (item.blind && !holdoutIds.has(item.caseId)) return deny('BLIND_CASE_WITHOUT_HOLDOUT_EXPECTATION', { caseId: item.caseId });
    if (!item.blind && !calibrationIds.has(item.caseId)) return deny('CALIBRATION_CASE_WITHOUT_EXPECTATION', { caseId: item.caseId });
    if (item.blind && calibrationIds.has(item.caseId)) return deny('CALIBRATION_CONTAMINATES_BLIND_HOLDOUT', { caseId: item.caseId });
  }

  const expectationFor = (caseId) => [...holdout.expectations, ...calibration.expectations]
    .find((entry) => entry.caseId === caseId);

  const results = [];
  for (const item of cases.cases) {
    const observed = runCase({ item, rows, rights, sourceIdentity });
    const expectation = expectationFor(item.caseId);
    const verdict = classify(observed, expectation);
    results.push({
      caseId: item.caseId,
      accessMode: item.accessMode,
      question: item.question,
      boundaryRule: item.boundaryRule,
      blind: item.blind,
      observedOutcome: observed.observedOutcome,
      expectedOutcome: expectation.expectedOutcome,
      verdict,
      basis: observed.basis,
      numbers: observed.numbers,
      reference: observed.reference ?? null,
      integratedPathAgreesWithReference: observed.integratedPathAgreesWithReference ?? null,
      statusCounts: observed.statusCounts ?? null,
      boundaryRowCount: observed.boundaryRowCount ?? null,
      creditsAggregate: observed.creditsAggregate ?? null,
      ambiguousJoinKeys: observed.ambiguousJoinKeys ?? null,
      creditsReadableInProjection: observed.projection?.creditsReadable ?? null,
    });
  }

  const metricFor = (population) => {
    const selected = results.filter((entry) => entry.blind === population);
    const count = (verdict) => selected.filter((entry) => entry.verdict === verdict).length;
    const accepted = selected.filter((entry) => entry.observedOutcome === 'ACCEPTED');
    return {
      population: population ? 'BLIND_HOLDOUT' : 'PUBLIC_CALIBRATION',
      caseCount: selected.length,
      correctAcceptance: count('CORRECT_ACCEPTANCE'),
      falseAcceptance: count('FALSE_ACCEPTANCE'),
      falseRefusal: count('FALSE_REFUSAL'),
      wrongNumber: count('WRONG_NUMBER'),
      wrongRefusalReason: count('WRONG_REFUSAL_REASON'),
      justifiedAbstention: count('JUSTIFIED_ABSTENTION'),
      refusalMatch: count('REFUSAL_MATCH'),
      clarificationsRequested: selected.filter((entry) =>
        entry.observedOutcome === 'ABSTAINED' || entry.observedOutcome === 'REFUSED_BOUNDARY_DATE').length,
      correctionsRequired: count('WRONG_NUMBER') + count('WRONG_REFUSAL_REASON') + count('FALSE_ACCEPTANCE'),
      acceptedCount: accepted.length,
      integratedPathAgreement: accepted.filter((entry) => entry.integratedPathAgreesWithReference === true).length
        + (accepted.length === 0 ? 0 : 0),
      integratedPathDisagreement: accepted.filter((entry) => entry.integratedPathAgreesWithReference === false).length,
      waiting: null,
      waitingReason: UNKNOWN_METRIC_REASONS.waiting,
      activeHumanOrAgentWork: null,
      activeHumanOrAgentWorkReason: UNKNOWN_METRIC_REASONS.activeHumanOrAgentWork,
      measurableCostMinorUnits: null,
      measurableCostMinorUnitsReason: UNKNOWN_METRIC_REASONS.measurableCostMinorUnits,
    };
  };

  const body = {
    schemaVersion: ACCESS_MODE_COMPARISON_SCHEMA,
    classification: ACCESS_MODE_CLASSIFICATION,
    trust: 'LOCAL_SYNTHETIC',
    now,
    casesVersion: cases.casesVersion,
    holdoutEvaluationId: holdout.evaluationId,
    calibrationEvaluationId: calibration.evaluationId,
    rights: { ...rights },
    sourceIdentity: {
      sourceLabel: sourceIdentity.sourceLabel,
      sourceBytesSha256: sourceIdentity.sourceBytesSha256,
      ambiguousJoinKeys: [...sourceIdentity.ambiguousJoinKeys],
    },
    populations: {
      publicCalibration: results.filter((entry) => !entry.blind).map((entry) => entry.caseId),
      blindHoldout: results.filter((entry) => entry.blind).map((entry) => entry.caseId),
      separation: 'PUBLIC_CALIBRATION_AND_BLIND_HOLDOUT_ARE_DISJOINT_POPULATIONS',
    },
    results,
  };
  return {
    outcome: 'COMPARED',
    code: 'OK',
    ...body,
    metrics: { publicCalibration: metricFor(false), blindHoldout: metricFor(true) },
    binding: body,
    bindingDigest: sha256(body),
    nonClaims: [...ACCESS_MODE_NONCLAIMS],
  };
}

/**
 * The independent checker. It re-executes the comparison over the INDEPENDENTLY RETAINED rows
 * and requires the carried binding to re-derive exactly, so:
 *   * a ONE-CENT mutation of the retained rows changes the re-derived digest,
 *   * a RULE mutation in the cases (boundary rule, access mode, rights) changes the
 *     re-derived digest and, for a mutation that flips a verdict, the outcome itself.
 * A carried digest that no longer re-derives is refused. The comparison never accepts its own
 * self-consistency as evidence.
 */
export function verifyAccessModeJourneyComparison({
  cases,
  holdout,
  calibration,
  rights,
  rows,
  sourceIdentity,
  now,
  report,
  bindingDigest,
} = {}) {
  if (!isRecord(report) || !sha256Hex(bindingDigest)) return deny('SERIALIZED_BINDING_MALFORMED');
  const fresh = buildAccessModeJourneyComparison({
    cases, holdout, calibration, rights, rows, sourceIdentity, now,
  });
  if (fresh.outcome !== 'COMPARED') {
    // A substituted source is surfaced as ITSELF, not buried under a generic mismatch.
    if (typeof fresh.code === 'string' && fresh.code.endsWith('SOURCE_SUBSTITUTION')) {
      return deny('SOURCE_SUBSTITUTION', { declared: fresh.declared, observed: fresh.observed });
    }
    return deny('SERIALIZED_EVIDENCE_MISMATCH', { detail: fresh });
  }
  if (fresh.bindingDigest !== bindingDigest) {
    return deny('SERIALIZED_BINDING_MISMATCH', { expected: bindingDigest, derived: fresh.bindingDigest });
  }
  if (fresh.bindingDigest !== sha256(report.binding ?? report)) {
    return deny('SERIALIZED_EVIDENCE_MISMATCH', { expected: bindingDigest, derived: sha256(report.binding ?? report) });
  }
  const blind = fresh.metrics.blindHoldout;
  if (blind.falseAcceptance > 0 || blind.wrongNumber > 0 || blind.wrongRefusalReason > 0) {
    return deny('BLIND_HOLDOUT_VERDICT_FAILED', {
      falseAcceptance: blind.falseAcceptance,
      wrongNumber: blind.wrongNumber,
      wrongRefusalReason: blind.wrongRefusalReason,
    });
  }
  if (blind.integratedPathDisagreement > 0) return deny('REFERENCE_DISAGREES_WITH_INTEGRATED_PATH');
  return {
    outcome: 'VERIFIED',
    code: 'OK',
    bindingDigest: fresh.bindingDigest,
    blindHoldout: blind,
    publicCalibration: fresh.metrics.publicCalibration,
  };
}

export function renderAccessModeComparison(report, format = 'JSON') {
  if (!ACCESS_MODE_FORMATS.includes(format)) return deny('FORMAT_UNSUPPORTED', { format });
  if (!isRecord(report) || report.outcome !== 'COMPARED') return deny('SERIALIZED_BINDING_MALFORMED');
  if (format === 'JSON') {
    return { outcome: 'RENDERED', code: 'OK', format, text: `${JSON.stringify(report, null, 2)}\n` };
  }
  const header = ['case', 'mode', 'question', 'blind', 'observed', 'expected', 'verdict'];
  const rows = report.results.map((entry) => [
    entry.caseId, entry.accessMode, entry.question, String(entry.blind),
    entry.observedOutcome, entry.expectedOutcome, entry.verdict,
  ]);
  const widths = header.map((cell, index) => Math.max(cell.length, ...rows.map((r) => String(r[index]).length)));
  const line = (cells) => cells.map((cell, index) => String(cell).padEnd(widths[index])).join('  ').trimEnd();
  const text = [
    line(header),
    widths.map((width) => '-'.repeat(width)).join('  '),
    ...rows.map(line),
    '',
    `bindingDigest=${report.bindingDigest}`,
    `blindHoldout correctAcceptance=${report.metrics.blindHoldout.correctAcceptance} falseAcceptance=${report.metrics.blindHoldout.falseAcceptance} falseRefusal=${report.metrics.blindHoldout.falseRefusal}`,
    `publicCalibration correctAcceptance=${report.metrics.publicCalibration.correctAcceptance} falseAcceptance=${report.metrics.publicCalibration.falseAcceptance} falseRefusal=${report.metrics.publicCalibration.falseRefusal}`,
    `waiting=${String(report.metrics.blindHoldout.waiting)} activeHumanOrAgentWork=${String(report.metrics.blindHoldout.activeHumanOrAgentWork)} measurableCostMinorUnits=${String(report.metrics.blindHoldout.measurableCostMinorUnits)}`,
    '',
  ].join('\n');
  return { outcome: 'RENDERED', code: 'OK', format, text };
}

export function loadAccessModeJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export const ACCESS_MODE_INTERNALS = Object.freeze({
  validCases,
  validHoldout,
  permittedProjection,
  deterministicReference,
  integratedPath,
  classify,
  sha256,
  exactKeys,
});
