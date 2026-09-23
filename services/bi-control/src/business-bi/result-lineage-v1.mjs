// KaleidoSphere KS247 (KS-EVO-02-AC02/AC03/AC04) — READ-ONLY result lineage on the
// existing CLI/TABLE/HTML read path: the released read output is separated into
// independently verified numbers, free-form explanation, unavailable facts and the
// ACTUAL completion state.
//
// WHAT THIS IS
//   The retained KS246 composition (dependency/ks246 = 37cf871) already carries a
//   caller-confirmed unfamiliar-schema proposal into the released metric core and an
//   ACTUAL local synthetic database execution.  That execution returns a released result
//   and a released receipt, but it does not, by itself, say WHICH of its output a reader
//   may treat as verified.
//
//   This module is that separation, and it is the only thing it adds:
//
//     * AC02 — every number the lineage presents as verified is compared, dimension by
//       dimension, against an INDEPENDENTLY MAINTAINED expectation (an authored,
//       versioned expectation fixture that pins the source content digest, the canonical
//       holdout digest, the arithmetic unit, the period windows and the exact integers).
//       The comparison never reads its expectation out of the run: a caller-supplied
//       evidence claim whose digest was RECOMPUTED for substituted bytes is still
//       refused, because the claim is compared against the maintained pin, not against
//       its own self-consistency.
//
//     * AC03 — the deterministic verified numbers are a SEPARATE section from free-form
//       explanation.  An explanation is text, it carries no numeric field, it is rendered
//       labelled UNVERIFIED and it is never counted as verified.  A caller that presents
//       an explanation, a wrong number/unit/period, stale evidence or an unsupported
//       causal/completion assertion AS verified is refused by name.
//
//     * AC04 — completion is the released receipt's OWN execution state, never a caller
//       assertion, and this surface keeps a valid read-only completion WITHOUT inventing
//       an effect journal: a read-only journey declares NO effects, and any synthetic
//       effect that is shown must consume a SEPARATELY CONFIRMED effect status.  The
//       source/journey promotion boundaries are preserved and stated.
//
// WHAT THIS IS NOT
//   Not a second metric, engine, validator, dashboard, BI frontend or order module.  It
//   reuses the released `canonicalJson`, the released metric contract and the retained
//   KS246 journey; it introduces no arithmetic of its own: the numbers it verifies are the
//   released receipt's numbers, compared with the maintained expectation.
//   Not an authority: no production, customer, real-source, admission, mutation or
//   publication authority is created here.  The separately owned PAN452 read-purpose
//   binding stays NOT_INTEGRATED; no positive integration is invented.
//
// Nonclaims are structural, not decoration — see RESULT_LINEAGE_NONCLAIMS.

import { createHash } from 'node:crypto';

import { canonicalJson } from '../canonical-json.js';

export const RESULT_LINEAGE_SCHEMA = 'kaleidosphere.business-bi/read-only-result-lineage/v1';
export const RESULT_LINEAGE_EXPECTATION_SCHEMA =
  'kaleidosphere.business-bi/result-lineage-expectation/v1';
export const RESULT_LINEAGE_EXPLANATION_SCHEMA =
  'kaleidosphere.business-bi/result-lineage-explanation/v1';
export const RESULT_LINEAGE_EFFECT_STATUS_SCHEMA =
  'kaleidosphere.business-bi/result-lineage-effect-status/v1';
export const RESULT_LINEAGE_EVIDENCE_CLAIM_SCHEMA =
  'kaleidosphere.business-bi/result-lineage-evidence-claim/v1';

// The four separations the read path must hold apart, plus the ONE optional fifth that a
// synthetic effect scenario may add — and only from a separately confirmed status.
export const RESULT_LINEAGE_LINE_KINDS = Object.freeze([
  'VERIFIED_NUMBER', 'EXPLANATION', 'UNAVAILABLE_FACT', 'COMPLETION', 'SYNTHETIC_EFFECT',
]);

export const RESULT_LINEAGE_FORMATS = Object.freeze(['JSON', 'TABLE', 'HTML']);

// The CLOSED effect-status vocabulary.  A synthetic effect is never "shown as applied"
// because a read returned: its status must be a separately confirmed value of this set.
export const RESULT_LINEAGE_EFFECT_STATUSES = Object.freeze([
  'EFFECT_NOT_APPLIED_READ_ONLY',
  'SYNTHETIC_EFFECT_CONFIRMED_APPLIED',
  'SYNTHETIC_EFFECT_CONFIRMED_NOT_APPLIED',
  'SYNTHETIC_EFFECT_STATUS_UNKNOWN',
]);

// An explanation assertion's kind.  Only DESCRIPTIVE prose may be free-form; a causal or
// completion claim is a different fact and cannot ride in as prose.
export const RESULT_LINEAGE_ASSERTION_KINDS = Object.freeze([
  'DESCRIPTIVE', 'CAUSAL', 'COMPLETION', 'EFFECT', 'NUMBER',
]);

export const RESULT_LINEAGE_SYNTHETIC_CLASSIFICATION = 'SYNTHETIC_NON_CUSTOMER_BYTES';

export const RESULT_LINEAGE_NONCLAIMS = Object.freeze([
  'Read-only: this surface issues no write, no admission and no publication; the only database access is the retained KS246 confined read of authored synthetic bytes.',
  'No second metric, engine, arithmetic, mapping vocabulary or dashboard: the verified numbers are the released receipt\'s own numbers, compared with an independently maintained expectation.',
  'No invented effect journal: a read-only journey declares NO effects, and any synthetic effect shown consumes a separately confirmed effect status.',
  'No explanation is verified: free-form text is rendered labelled UNVERIFIED and carries no numeric field.',
  'No authority from repetition: a caller-recomputed digest is a self-consistency statement, never evidence of an independently maintained source.',
  'No full KS-EVO-02 closure: the separately owned PAN452 read-purpose binding stays NOT_INTEGRATED, and AC05 stays parent-owned.',
]);

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const fail = (code) => { const error = new Error(code); error.code = code; throw error; };
const hex64 = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const isCalendarDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
};
const isSafeInt = (value) => Number.isSafeInteger(value) && !Object.is(value, -0);

function exactKeys(value, allowed, required, code) {
  if (!isPlainObject(value)) fail(code);
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.includes(key))
      || (required ?? allowed).some((key) => !keys.includes(key))) fail(code);
  return value;
}

function bytesOf(value, code) {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  if (isPlainObject(value)) return Buffer.from(canonicalJson(value), 'utf8');
  fail(code);
}

function parseBoundJson(bytesOrObject, code) {
  if (isPlainObject(bytesOrObject)) return bytesOrObject;
  try { return JSON.parse(bytesOf(bytesOrObject, code).toString('utf8')); } catch { fail(`${code}:JSON`); }
}

// ---------------------------------------------------------------------------------
// The INDEPENDENTLY MAINTAINED expectation.
//
// This is an authored, versioned declaration.  It is deliberately NOT derived from any
// run: the numbers are hand-derived integer minor units (the released synthetic oracle's
// independent expectation), and the digests are content-addressed from the frozen
// fixtures.  Because the expectation is maintained outside the run, comparing the run
// against it is a real comparison rather than a re-statement of the run.
// ---------------------------------------------------------------------------------
export function loadIndependentExpectation(bytesOrObject) {
  const code = 'KS247_EXPECTATION_DENIED';
  const raw = parseBoundJson(bytesOrObject, code);
  exactKeys(raw, [
    'schemaVersion', 'classification', 'issue', 'metricId', 'maintenance', 'current',
    'supersededEvidence', 'unit', 'periods', 'expectedNumbers', 'unavailableFacts',
  ], [
    'schemaVersion', 'classification', 'issue', 'metricId', 'maintenance', 'current',
    'supersededEvidence', 'unit', 'periods', 'expectedNumbers', 'unavailableFacts',
  ], `${code}:SHAPE`);
  if (raw.schemaVersion !== RESULT_LINEAGE_EXPECTATION_SCHEMA) fail(`${code}:SCHEMA`);
  if (raw.classification !== RESULT_LINEAGE_SYNTHETIC_CLASSIFICATION) fail(`${code}:CLASSIFICATION`);
  if (typeof raw.metricId !== 'string' || raw.metricId.length === 0) fail(`${code}:METRIC`);
  exactKeys(raw.maintenance, ['author', 'derivedFrom', 'statement'], undefined, `${code}:MAINTENANCE`);
  if (typeof raw.maintenance.derivedFrom !== 'string' || raw.maintenance.derivedFrom.length === 0) {
    fail(`${code}:MAINTENANCE`);
  }

  exactKeys(raw.current, ['sourceRevision', 'sourceByteSha256', 'canonicalHoldoutSha256', 'canonicalRowCount'],
    undefined, `${code}:CURRENT`);
  if (typeof raw.current.sourceRevision !== 'string' || raw.current.sourceRevision.length === 0) {
    fail(`${code}:CURRENT`);
  }
  if (!hex64(raw.current.sourceByteSha256)) fail(`${code}:CURRENT_SOURCE_DIGEST`);
  if (!hex64(raw.current.canonicalHoldoutSha256)) fail(`${code}:CURRENT_HOLDOUT_DIGEST`);
  if (!isSafeInt(raw.current.canonicalRowCount) || raw.current.canonicalRowCount < 0) {
    fail(`${code}:CURRENT_ROW_COUNT`);
  }

  if (!Array.isArray(raw.supersededEvidence)) fail(`${code}:SUPERSEDED`);
  const supersededEvidence = raw.supersededEvidence.map((entry) => {
    exactKeys(entry, ['sourceRevision', 'subject', 'evidenceSha256'], undefined, `${code}:SUPERSEDED`);
    if (typeof entry.sourceRevision !== 'string' || entry.sourceRevision.length === 0
        || typeof entry.subject !== 'string' || entry.subject.length === 0
        || !hex64(entry.evidenceSha256)) fail(`${code}:SUPERSEDED`);
    return { sourceRevision: entry.sourceRevision, subject: entry.subject, evidenceSha256: entry.evidenceSha256 };
  });

  exactKeys(raw.unit, ['id', 'currency', 'minorUnitsPerMajorUnit', 'amountUnit'], undefined, `${code}:UNIT`);
  if (typeof raw.unit.id !== 'string' || raw.unit.id.length === 0
      || raw.unit.id !== `${raw.unit.currency}_${raw.unit.amountUnit}`) fail(`${code}:UNIT`);
  if (raw.unit.amountUnit !== 'MINOR_UNITS' || !isSafeInt(raw.unit.minorUnitsPerMajorUnit)
      || raw.unit.minorUnitsPerMajorUnit <= 0) fail(`${code}:UNIT`);

  if (!isPlainObject(raw.periods) || Object.keys(raw.periods).length === 0) fail(`${code}:PERIODS`);
  const periods = {};
  for (const [key, window] of Object.entries(raw.periods)) {
    exactKeys(window, ['label', 'start', 'end', 'boundary'], undefined, `${code}:PERIODS`);
    if (typeof window.label !== 'string' || window.label.length === 0
        || !isCalendarDate(window.start) || !isCalendarDate(window.end)
        || window.start > window.end) fail(`${code}:PERIODS`);
    if (window.boundary !== 'inclusive-both-ends') fail(`${code}:PERIODS`);
    periods[key] = { label: window.label, start: window.start, end: window.end, boundary: window.boundary };
  }

  if (!isPlainObject(raw.expectedNumbers) || Object.keys(raw.expectedNumbers).length === 0) {
    fail(`${code}:EXPECTED_NUMBERS`);
  }
  const expectedNumbers = {};
  for (const [path, value] of Object.entries(raw.expectedNumbers)) {
    if (!/^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)*$/.test(path) || !isSafeInt(value)) {
      fail(`${code}:EXPECTED_NUMBERS`);
    }
    expectedNumbers[path] = value;
  }

  if (!Array.isArray(raw.unavailableFacts)) fail(`${code}:UNAVAILABLE`);
  const unavailableFacts = raw.unavailableFacts.map((entry) => {
    exactKeys(entry, ['subject', 'reasonCode'], undefined, `${code}:UNAVAILABLE`);
    if (typeof entry.subject !== 'string' || entry.subject.length === 0
        || !/^[A-Z][A-Z0-9_]{2,127}$/.test(entry.reasonCode ?? '')) fail(`${code}:UNAVAILABLE`);
    return { subject: entry.subject, reasonCode: entry.reasonCode };
  });
  for (const entry of unavailableFacts) {
    if (Object.hasOwn(expectedNumbers, entry.subject)) fail(`${code}:UNAVAILABLE_IS_EXPECTED`);
  }

  const body = {
    schemaVersion: RESULT_LINEAGE_EXPECTATION_SCHEMA,
    classification: RESULT_LINEAGE_SYNTHETIC_CLASSIFICATION,
    issue: raw.issue,
    metricId: raw.metricId,
    maintenance: {
      author: raw.maintenance.author,
      derivedFrom: raw.maintenance.derivedFrom,
      statement: raw.maintenance.statement ?? null,
    },
    current: {
      sourceRevision: raw.current.sourceRevision,
      sourceByteSha256: raw.current.sourceByteSha256,
      canonicalHoldoutSha256: raw.current.canonicalHoldoutSha256,
      canonicalRowCount: raw.current.canonicalRowCount,
    },
    supersededEvidence: supersededEvidence
      .sort((left, right) => left.evidenceSha256.localeCompare(right.evidenceSha256)),
    unit: {
      id: raw.unit.id,
      currency: raw.unit.currency,
      minorUnitsPerMajorUnit: raw.unit.minorUnitsPerMajorUnit,
      amountUnit: raw.unit.amountUnit,
    },
    periods,
    expectedNumbers: Object.fromEntries(
      Object.entries(expectedNumbers).sort(([left], [right]) => left.localeCompare(right)),
    ),
    unavailableFacts: unavailableFacts.sort((left, right) => left.subject.localeCompare(right.subject)),
  };
  return Object.freeze({
    ...body,
    expectationSha256: sha256(canonicalJson(body)),
    independence: 'MAINTAINED_OUTSIDE_THE_RUN_NEVER_READ_BACK_FROM_A_RECEIPT',
  });
}

// ---------------------------------------------------------------------------------
// The caller's free-form explanation.  Text only: an assertion may not carry a numeric
// field, so prose can never be re-counted as a verified number, and a caller that marks an
// explanation/causal/completion/effect assertion as verified is refused by name.
// ---------------------------------------------------------------------------------
export function loadFreeExplanation(bytesOrObject) {
  const code = 'KS247_EXPLANATION_DENIED';
  const raw = parseBoundJson(bytesOrObject, code);
  exactKeys(raw, ['schemaVersion', 'issue', 'authoredInput', 'assertions'],
    ['schemaVersion', 'issue', 'assertions'], `${code}:SHAPE`);
  if (raw.schemaVersion !== RESULT_LINEAGE_EXPLANATION_SCHEMA) fail(`${code}:SCHEMA`);
  if (!Array.isArray(raw.assertions)) fail(`${code}:ASSERTIONS`);
  const seen = new Set();
  const assertions = raw.assertions.map((entry) => {
    exactKeys(entry, ['assertionId', 'kind', 'text', 'assertedAsVerified'],
      ['assertionId', 'kind', 'text'], `${code}:ASSERTION`);
    if (typeof entry.assertionId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(entry.assertionId)) {
      fail(`${code}:ASSERTION_ID`);
    }
    if (seen.has(entry.assertionId)) fail(`${code}:DUPLICATE_ASSERTION:${entry.assertionId}`);
    seen.add(entry.assertionId);
    if (!RESULT_LINEAGE_ASSERTION_KINDS.includes(entry.kind)) fail(`${code}:ASSERTION_KIND`);
    // Free-form means free-form: `text` is the ONLY payload.  The exact-key gate above
    // already refuses a `value`/`amount`/`number`/`minorUnits` field, so a number that never
    // passed the independent comparison cannot ride in as an explanation.
    if (typeof entry.text !== 'string' || entry.text.length === 0 || entry.text.length > 2048) {
      fail(`${code}:ASSERTION_TEXT`);
    }
    return {
      assertionId: entry.assertionId,
      kind: entry.kind,
      text: entry.text,
      assertedAsVerified: entry.assertedAsVerified === true,
    };
  });
  const body = {
    schemaVersion: RESULT_LINEAGE_EXPLANATION_SCHEMA,
    issue: raw.issue,
    authoredInput: raw.authoredInput === true,
    assertions,
  };
  return Object.freeze({ ...body, explanationSha256: sha256(canonicalJson(body)), verified: false });
}

// ---------------------------------------------------------------------------------
// The SEPARATELY CONFIRMED effect status.  A read-only journey has no effects; where a
// synthetic effect is shown at all, its status may come only from this separately
// confirmed input, and never from the read having happened.
// ---------------------------------------------------------------------------------
export function loadConfirmedEffectStatus(bytesOrObject) {
  const code = 'KS247_EFFECT_STATUS_DENIED';
  const raw = parseBoundJson(bytesOrObject, code);
  exactKeys(raw, ['schemaVersion', 'issue', 'sourceRevision', 'mutationAuthority', 'effects'],
    ['schemaVersion', 'issue', 'sourceRevision', 'mutationAuthority', 'effects'], `${code}:SHAPE`);
  if (raw.schemaVersion !== RESULT_LINEAGE_EFFECT_STATUS_SCHEMA) fail(`${code}:SCHEMA`);
  if (typeof raw.sourceRevision !== 'string' || raw.sourceRevision.length === 0) fail(`${code}:REVISION`);
  // The read-only boundary is structural: an effect-status input that claims mutation
  // authority is not usable on a read-only lineage at all.
  if (raw.mutationAuthority !== false) fail(`${code}:READ_ONLY_EFFECT_CLAIM_DENIED`);
  if (!Array.isArray(raw.effects)) fail(`${code}:EFFECTS`);
  const seen = new Set();
  const effects = raw.effects.map((entry) => {
    exactKeys(entry, ['effectId', 'kind', 'status', 'separateConfirmation'],
      ['effectId', 'kind', 'status', 'separateConfirmation'], `${code}:EFFECT`);
    if (typeof entry.effectId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(entry.effectId)) {
      fail(`${code}:EFFECT_ID`);
    }
    if (seen.has(entry.effectId)) fail(`${code}:DUPLICATE_EFFECT:${entry.effectId}`);
    seen.add(entry.effectId);
    if (entry.kind !== 'SYNTHETIC_EFFECT') fail(`${code}:EFFECT_KIND`);
    if (!RESULT_LINEAGE_EFFECT_STATUSES.includes(entry.status)) fail(`${code}:EFFECT_STATUS`);
    // A status is only usable when it is SEPARATELY confirmed: the confirmation is its own
    // authored record and is content-addressed here, so "the read succeeded" is never the
    // confirmation.
    exactKeys(entry.separateConfirmation, ['kind', 'confirmationId', 'confirmationSha256'],
      ['kind', 'confirmationId', 'confirmationSha256'], `${code}:CONFIRMATION`);
    if (entry.separateConfirmation.kind !== 'AUTHORED_SEPARATE_CONFIRMATION'
        || typeof entry.separateConfirmation.confirmationId !== 'string'
        || entry.separateConfirmation.confirmationId.length === 0
        || !hex64(entry.separateConfirmation.confirmationSha256)) {
      fail(`${code}:EFFECT_STATUS_NOT_SEPARATELY_CONFIRMED`);
    }
    return {
      effectId: entry.effectId,
      kind: entry.kind,
      status: entry.status,
      separateConfirmation: {
        kind: entry.separateConfirmation.kind,
        confirmationId: entry.separateConfirmation.confirmationId,
        confirmationSha256: entry.separateConfirmation.confirmationSha256,
      },
    };
  });
  if (effects.some(({ status }) => status === 'EFFECT_NOT_APPLIED_READ_ONLY') && effects.length > 1) {
    fail(`${code}:READ_ONLY_EFFECT_CLAIM_DENIED`);
  }
  const body = {
    schemaVersion: RESULT_LINEAGE_EFFECT_STATUS_SCHEMA,
    issue: raw.issue,
    sourceRevision: raw.sourceRevision,
    mutationAuthority: false,
    effects,
  };
  return Object.freeze({ ...body, effectStatusSha256: sha256(canonicalJson(body)) });
}

// ---------------------------------------------------------------------------------
// The caller's evidence CLAIM.  This is the shape AC02 turns on: the caller states which
// source/evidence digests the presented numbers rest on, and MAY declare that it
// recomputed them itself.  Self-recomputation is recorded, never trusted: the claim is
// compared against the independently maintained pin.
// ---------------------------------------------------------------------------------
export function loadEvidenceClaim(bytesOrObject) {
  const code = 'KS247_EVIDENCE_CLAIM_DENIED';
  const raw = parseBoundJson(bytesOrObject, code);
  exactKeys(raw, [
    'schemaVersion', 'issue', 'sourceRevision', 'sourceByteSha256', 'canonicalHoldoutSha256',
    'resultSha256', 'recomputedByCaller',
  ], [
    'schemaVersion', 'issue', 'sourceRevision', 'sourceByteSha256', 'canonicalHoldoutSha256',
  ], `${code}:SHAPE`);
  if (raw.schemaVersion !== RESULT_LINEAGE_EVIDENCE_CLAIM_SCHEMA) fail(`${code}:SCHEMA`);
  if (typeof raw.sourceRevision !== 'string' || raw.sourceRevision.length === 0) fail(`${code}:REVISION`);
  if (!hex64(raw.sourceByteSha256)) fail(`${code}:SOURCE_DIGEST`);
  if (!hex64(raw.canonicalHoldoutSha256)) fail(`${code}:HOLDOUT_DIGEST`);
  // A non-complete journey carries no result digest at all, so null is the truthful value
  // here and is kept rather than substituted with a placeholder digest.
  if (raw.resultSha256 !== null && !hex64(raw.resultSha256)) fail(`${code}:RESULT_DIGEST`);
  const body = {
    schemaVersion: RESULT_LINEAGE_EVIDENCE_CLAIM_SCHEMA,
    issue: raw.issue,
    sourceRevision: raw.sourceRevision,
    sourceByteSha256: raw.sourceByteSha256,
    canonicalHoldoutSha256: raw.canonicalHoldoutSha256,
    resultSha256: raw.resultSha256,
    recomputedByCaller: raw.recomputedByCaller === true,
  };
  return Object.freeze({ ...body, claimSha256: sha256(canonicalJson(body)) });
}

// ---------------------------------------------------------------------------------
// The read-only lineage itself.
// ---------------------------------------------------------------------------------
const NUMBER_PATHS = Object.freeze([
  'deltaMinorUnits',
  'excludedOutOfScopeCount',
  'periods.current.netMinorUnits',
  'periods.current.saleMinorUnits',
  'periods.current.creditMinorUnits',
  'periods.current.cancelCount',
  'periods.current.rowCount',
  'periods.current.unknown.count',
  'periods.current.unknown.quantifiedAmountMinorUnits',
  'periods.current.unknown.unquantifiedCount',
  'periods.comparison.netMinorUnits',
  'periods.comparison.saleMinorUnits',
  'periods.comparison.creditMinorUnits',
  'periods.comparison.cancelCount',
  'periods.comparison.rowCount',
  'periods.comparison.unknown.count',
  'periods.comparison.unknown.quantifiedAmountMinorUnits',
  'periods.comparison.unknown.unquantifiedCount',
  'unknown.count',
  'unknown.quantifiedAmountMinorUnits',
  'unknown.unquantifiedCount',
  'unknown.unassigned.count',
  'unknown.unassigned.quantifiedAmountMinorUnits',
  'unknown.unassigned.unquantifiedCount',
]);

// The period a number path belongs to ('current'/'comparison'), or null for the
// journey-wide figures.  Derived from the path, never from the run.
// A path's own unit: only a money aggregate is in the currency's minor unit.  A row/cancel/
// unknown COUNT is a count, and labelling it with the currency unit would misstate the fact.
function unitForPath(path, amountUnit) {
  return /MinorUnits$/.test(path)
    ? { ...amountUnit }
    : { id: 'COUNT', currency: null, minorUnitsPerMajorUnit: null, amountUnit: 'COUNT' };
}

function periodOfPath(path) {
  const match = /^periods\.(current|comparison)\./.exec(path);
  return match === null ? null : match[1];
}

function valueAtPath(object, path) {
  let cursor = object;
  for (const segment of path.split('.')) {
    if (!isPlainObject(cursor) || !Object.hasOwn(cursor, segment)) return { present: false, value: null };
    cursor = cursor[segment];
  }
  return { present: true, value: cursor };
}

// The unit the released contract declares.  Derived from the contract the run actually
// used, so a contract substitution shows up as a different observed unit rather than as a
// silently relabelled number.
function observedUnit(metricContract) {
  const currency = metricContract?.currency;
  const amountColumn = currency?.amountColumn;
  if (!isPlainObject(currency) || typeof currency.code !== 'string'
      || !isSafeInt(currency.minorUnitsPerMajorUnit) || currency.minorUnitsPerMajorUnit <= 0
      || typeof amountColumn !== 'string') fail('KS247_LINEAGE_DENIED:CONTRACT_UNIT');
  return {
    id: `${currency.code}_MINOR_UNITS`,
    currency: currency.code,
    minorUnitsPerMajorUnit: currency.minorUnitsPerMajorUnit,
    amountUnit: 'MINOR_UNITS',
  };
}

function observedPeriods(metricContract) {
  if (!isPlainObject(metricContract?.periods)) fail('KS247_LINEAGE_DENIED:CONTRACT_PERIODS');
  const out = {};
  for (const [key, window] of Object.entries(metricContract.periods)) {
    if (!isPlainObject(window) || typeof window.label !== 'string'
        || !isCalendarDate(window.start) || !isCalendarDate(window.end)
        || window.boundary !== 'inclusive-both-ends') fail('KS247_LINEAGE_DENIED:CONTRACT_PERIODS');
    out[key] = { label: window.label, start: window.start, end: window.end, boundary: window.boundary };
  }
  return out;
}

function assertShape(input) {
  exactKeys(input, [
    'journey', 'expectation', 'metricContractBytes', 'evidenceClaim', 'explanation', 'effectStatus',
  ], ['journey', 'expectation', 'metricContractBytes', 'evidenceClaim'], 'KS247_LINEAGE_DENIED:INPUT');
  if (!isPlainObject(input.journey)) fail('KS247_LINEAGE_DENIED:JOURNEY');
  if (!isPlainObject(input.expectation) || input.expectation.independence
      !== 'MAINTAINED_OUTSIDE_THE_RUN_NEVER_READ_BACK_FROM_A_RECEIPT') {
    fail('KS247_LINEAGE_DENIED:MISSING_INDEPENDENT_EXPECTATION');
  }
  if (typeof input.metricContractBytes !== 'string' && !Buffer.isBuffer(input.metricContractBytes)) {
    fail('KS247_LINEAGE_DENIED:CONTRACT');
  }
  if (input.evidenceClaim === undefined || input.evidenceClaim === null) {
    fail('KS247_LINEAGE_DENIED:MISSING_EVIDENCE_CLAIM');
  }
}

// The evidence gate.  Every branch below is a refusal BY NAME, and the caller's own
// recomputation is recorded but never treated as authority.
function verifyEvidence({ journey, expectation, evidenceClaim }) {
  const binding = isPlainObject(journey.binding) ? journey.binding : fail('KS247_LINEAGE_DENIED:JOURNEY_BINDING');
  // (a) The ACTUAL read must be of the maintained current source.
  if (binding.sourceRevision !== expectation.current.sourceRevision) {
    fail('KS247_LINEAGE_DENIED:SOURCE_REVISION_STALE');
  }
  const superseded = expectation.supersededEvidence.map(({ evidenceSha256 }) => evidenceSha256);
  // (b) A claim resting on superseded evidence is stale, no matter how well it is formed.
  if (superseded.includes(evidenceClaim.sourceByteSha256)
      || superseded.includes(evidenceClaim.canonicalHoldoutSha256)) {
    fail('KS247_LINEAGE_DENIED:STALE_EVIDENCE');
  }
  // (c) The claim is compared against the INDEPENDENTLY MAINTAINED pin, not against its
  // own self-consistency: substituted bytes with a correctly recomputed digest still fail.
  if (evidenceClaim.sourceByteSha256 !== expectation.current.sourceByteSha256
      || binding.sourceSha256 !== expectation.current.sourceByteSha256) {
    fail('KS247_LINEAGE_DENIED:SOURCE_SUBSTITUTED');
  }
  if (evidenceClaim.canonicalHoldoutSha256 !== expectation.current.canonicalHoldoutSha256
      || binding.canonicalHoldoutSha256 !== expectation.current.canonicalHoldoutSha256) {
    fail('KS247_LINEAGE_DENIED:EVIDENCE_NOT_CURRENT');
  }
  return {
    sourceRevision: evidenceClaim.sourceRevision,
    sourceByteSha256: evidenceClaim.sourceByteSha256,
    canonicalHoldoutSha256: evidenceClaim.canonicalHoldoutSha256,
    resultSha256: evidenceClaim.resultSha256,
    claimSha256: evidenceClaim.claimSha256,
    recomputedByCaller: evidenceClaim.recomputedByCaller,
    selfConsistencyIsNotAuthority: true,
  };
}

function verifyCompletion({ journey, explanation }) {
  const acceptance = isPlainObject(journey.acceptance) ? journey.acceptance : {};
  const executed = journey.executed === true;
  const state = acceptance.executionState ?? 'NOT_EXECUTED';
  const complete = executed && state === 'COMPLETE';
  // A completion ASSERTION in the free-form channel is NEVER the completion authority: the
  // released receipt's state is.  Marking such an assertion as verified is refused whether or
  // not it happens to agree with the receipt, so agreement never manufactures authority.
  if (isPlainObject(explanation)) {
    for (const assertion of explanation.assertions) {
      if (assertion.kind === 'COMPLETION' && assertion.assertedAsVerified) {
        fail('KS247_LINEAGE_DENIED:UNSUPPORTED_COMPLETION_ASSERTION');
      }
    }
  }
  return {
    kind: 'COMPLETION',
    state,
    complete,
    // The completion is the released receipt's own state; it is never a caller assertion.
    completionSource: 'RELEASED_EXECUTION_RECEIPT_STATE',
    resultAvailable: complete && isPlainObject(journey.result),
    receiptSha256: journey.receiptSha256 ?? null,
    resultSha256: complete ? journey.resultSha256 ?? null : null,
    denialReasonCode: complete ? null : (acceptance.denialReasonCode ?? null),
    oracleEquality: acceptance.oracleEquality ?? null,
  };
}

function verifyNumbers({ journey, expectation, metricContract, metricContractBytes, completion, evidence }) {
  const verified = [];
  const unavailable = [];
  if (!completion.complete) {
    // No completion, no verified number: an empty verified section is the truthful output,
    // never a fabricated zero.
    for (const [path, value] of Object.entries(expectation.expectedNumbers)) {
      unavailable.push({
        kind: 'UNAVAILABLE_FACT',
        subject: path,
        reasonCode: 'NO_COMPLETED_READ_ONLY_EXECUTION',
        expectedValue: value,
        presentedAsVerified: false,
      });
    }
    return { verified, unavailable };
  }
  const unit = observedUnit(metricContract);
  const periods = observedPeriods(metricContract);
  // The contract the numbers came from must be the released contract the journey bound.
  // The contract the numbers came from must be the released contract the journey bound;
  // a substituted contract is refused before any number is compared.
  if (typeof journey.binding?.releasedContractSha256 === 'string'
      && sha256(Buffer.isBuffer(metricContractBytes)
        ? metricContractBytes
        : Buffer.from(metricContractBytes, 'utf8')) !== journey.binding.releasedContractSha256) {
    fail('KS247_LINEAGE_DENIED:CONTRACT_SUBSTITUTED');
  }
  // Dimension 1 — unit.
  if (unit.id !== expectation.unit.id
      || unit.currency !== expectation.unit.currency
      || unit.minorUnitsPerMajorUnit !== expectation.unit.minorUnitsPerMajorUnit) {
    fail('KS247_LINEAGE_DENIED:WRONG_UNIT');
  }
  // Dimension 2 — period windows.
  for (const [key, expected] of Object.entries(expectation.periods)) {
    const observed = periods[key];
    if (!isPlainObject(observed) || canonicalJson(observed) !== canonicalJson(expected)) {
      fail('KS247_LINEAGE_DENIED:WRONG_PERIOD');
    }
  }
  if (Object.keys(periods).length !== Object.keys(expectation.periods).length) {
    fail('KS247_LINEAGE_DENIED:WRONG_PERIOD');
  }
  // Dimension 3 — the numbers themselves, path by path against the maintained pins.
  for (const [path, expectedValue] of Object.entries(expectation.expectedNumbers)) {
    const observed = valueAtPath(journey.result, path);
    if (!observed.present) {
      unavailable.push({
        kind: 'UNAVAILABLE_FACT',
        subject: path,
        reasonCode: 'RELEASED_RESULT_DOES_NOT_CARRY_THIS_FACT',
        expectedValue,
        presentedAsVerified: false,
      });
      continue;
    }
    if (!isSafeInt(observed.value)) fail('KS247_LINEAGE_DENIED:WRONG_NUMBER');
    if (observed.value !== expectedValue) fail('KS247_LINEAGE_DENIED:WRONG_NUMBER');
    const period = periodOfPath(path);
    verified.push({
      kind: 'VERIFIED_NUMBER',
      lineId: path,
      subject: path,
      period,
      periodWindow: period === null ? null : periods[period],
      unit: unitForPath(path, unit),
      value: observed.value,
      expectedValue,
      verification: 'MATCHES_INDEPENDENT_EXPECTATION',
      independentExpectationSha256: expectation.expectationSha256,
      // The evidence below is what makes the number checkable later; it never widens the
      // number's meaning.
      evidence: {
        sourceRevision: evidence.sourceRevision,
        sourceByteSha256: evidence.sourceByteSha256,
        canonicalHoldoutSha256: evidence.canonicalHoldoutSha256,
        receiptSha256: completion.receiptSha256,
        resultSha256: completion.resultSha256,
        oracleEquality: completion.oracleEquality,
      },
    });
  }
  // Facts the surface must NOT present as numbers, at all.
  for (const fact of expectation.unavailableFacts) {
    unavailable.push({
      kind: 'UNAVAILABLE_FACT',
      subject: fact.subject,
      reasonCode: fact.reasonCode,
      expectedValue: null,
      presentedAsVerified: false,
    });
  }
  return { verified, unavailable };
}

function classifyExplanation({ explanation, expectation, effectStatus }) {
  if (explanation === undefined || explanation === null) return [];
  const lines = [];
  let syntheticEffectPresented = false;
  for (const assertion of explanation.assertions) {
    if (assertion.kind === 'EFFECT') syntheticEffectPresented = true;
    if (assertion.assertedAsVerified) {
      if (assertion.kind === 'CAUSAL') fail('KS247_LINEAGE_DENIED:UNSUPPORTED_CAUSAL_ASSERTION');
      if (assertion.kind === 'COMPLETION') fail('KS247_LINEAGE_DENIED:UNSUPPORTED_COMPLETION_ASSERTION');
      if (assertion.kind === 'EFFECT') fail('KS247_LINEAGE_DENIED:FABRICATED_EFFECT_JOURNAL');
      if (assertion.kind === 'NUMBER') {
        if (expectation.unavailableFacts.some(({ subject }) => subject === assertion.assertionId)) {
          fail('KS247_LINEAGE_DENIED:UNAVAILABLE_FACT_ASSERTED');
        }
        fail('KS247_LINEAGE_DENIED:EXPLANATION_PRESENTED_AS_VERIFIED');
      }
      fail('KS247_LINEAGE_DENIED:EXPLANATION_PRESENTED_AS_VERIFIED');
    }
    lines.push({
      kind: 'EXPLANATION',
      lineId: assertion.assertionId,
      assertionKind: assertion.kind,
      text: assertion.text,
      // Structural: free-form text is NEVER verified, whatever it says.
      verified: false,
      presentedAsVerified: false,
    });
  }
  // A synthetic effect shown without a separately confirmed status is a fabricated journal.
  if (syntheticEffectPresented && (effectStatus === undefined || effectStatus === null)) {
    fail('KS247_LINEAGE_DENIED:FABRICATED_EFFECT_JOURNAL');
  }
  return lines;
}

function effectLines({ effectStatus, journey }) {
  // Read-only: this surface keeps a VALID completion and invents no effect journal. The
  // read-only journey's own effect set is empty and is stated as such.
  if (effectStatus === undefined || effectStatus === null) {
    return {
      effects: [],
      effectJournal: 'NOT_INVENTED_READ_ONLY_JOURNEY',
      effectStatus: 'EFFECT_NOT_APPLIED_READ_ONLY',
      effectStatusSha256: null,
      separatelyConfirmed: false,
    };
  }
  if (isPlainObject(journey.binding) && effectStatus.sourceRevision !== journey.binding.sourceRevision) {
    fail('KS247_LINEAGE_DENIED:SOURCE_REVISION_STALE');
  }
  return {
    effects: effectStatus.effects.map(({ effectId, kind, status, separateConfirmation }) => ({
      kind: 'SYNTHETIC_EFFECT',
      lineId: effectId,
      effectKind: kind,
      status,
      presentedAsApplied: status === 'SYNTHETIC_EFFECT_CONFIRMED_APPLIED',
      separateConfirmation,
      derivedFromReadSuccess: false,
    })),
    effectJournal: effectStatus.effects.length === 0
      ? 'NOT_INVENTED_READ_ONLY_JOURNEY'
      : 'CONSUMED_SEPARATELY_CONFIRMED_EFFECT_STATUS',
    effectStatus: effectStatus.effects.length === 0
      ? 'EFFECT_NOT_APPLIED_READ_ONLY'
      : 'CONSUMED_SEPARATELY_CONFIRMED_EFFECT_STATUS',
    effectStatusSha256: effectStatus.effectStatusSha256,
    separatelyConfirmed: true,
  };
}

export function buildReadOnlyResultLineage(input) {
  assertShape(input);
  const { journey, expectation, evidenceClaim } = input;
  const metricContractBytes = Buffer.isBuffer(input.metricContractBytes)
    ? input.metricContractBytes
    : Buffer.from(input.metricContractBytes, 'utf8');
  const metricContract = parseBoundJson(metricContractBytes, 'KS247_LINEAGE_DENIED:CONTRACT');
  const evidence = verifyEvidence({ journey, expectation, evidenceClaim });
  const explanation = input.explanation ?? null;
  const completion = verifyCompletion({ journey, explanation });
  const { verified, unavailable } = verifyNumbers({
    journey, expectation, metricContract, metricContractBytes, completion, evidence,
  });
  const explanations = classifyExplanation({
    explanation, expectation, effectStatus: input.effectStatus ?? null,
  });
  const effects = effectLines({ effectStatus: input.effectStatus ?? null, journey });

  const body = {
    schemaVersion: RESULT_LINEAGE_SCHEMA,
    lineageId: 'ks247-read-only-result-lineage',
    issue: 'KS-EVO-02',
    metricId: expectation.metricId,
    sourceRevision: evidence.sourceRevision,
    observationKind: completion.complete
      ? 'COMPLETE_READ_ONLY_OBSERVATION'
      : 'NON_COMPLETE_OBSERVATION',
    sections: {
      verifiedNumbers: verified,
      explanations,
      unavailableFacts: unavailable,
      completion,
      syntheticEffects: effects.effects,
    },
    separation: {
      // The four separations, stated as data so a reader can check them rather than trust
      // the prose above them.
      verifiedNumbersComeFromReleasedReceipt: true,
      verifiedNumbersComparedAgainstIndependentExpectation: true,
      explanationsAreNeverVerified: true,
      explanationsCarryNoNumericField: true,
      unavailableFactsAreNotRenderedAsNumbers: true,
      completionIsTheReleasedState: true,
      callerCompletionAssertionsAreNotAuthority: true,
      callerRecomputedDigestIsNotAuthority: evidence.recomputedByCaller,
      effectJournalInvented: false,
      syntheticEffectsRequireSeparateConfirmation: true,
    },
    verification: {
      expectationSha256: expectation.expectationSha256,
      expectationIndependence: expectation.independence,
      evidence: { ...evidence, receiptSha256: completion.receiptSha256 },
      unit: expectation.unit,
      periods: expectation.periods,
      expectedNumberCount: Object.keys(expectation.expectedNumbers).length,
      verifiedNumberCount: verified.length,
      unavailableFactCount: unavailable.length,
      explanationCount: explanations.length,
      effectStatus: effects.effectStatus,
      effectJournal: effects.effectJournal,
      effectStatusSha256: effects.effectStatusSha256,
      separatelyConfirmedEffects: effects.separatelyConfirmed,
    },
    promotionBoundaries: {
      // The source/journey promotion boundaries are preserved, not widened.
      sourcePromotion: 'NONE',
      journeyPromotion: 'LOCAL_SYNTHETIC_READ_ONLY_ONLY',
      admissionAuthority: 'NONE',
      mutationAuthority: 'NONE',
      publicWrites: false,
      arbitrarySql: false,
      realSource: false,
      // The PAN452 read-purpose binding is separately owned and NOT accepted; this surface
      // neither designs nor stubs its handles and fabricates no positive integration.
      sharedReadPurposeBinding: 'NOT_INTEGRATED',
      readOnlyPromotionBoundaryPreserved: true,
    },
    authority: {
      executionAuthority: 'LOCAL_SYNTHETIC_READ_ONLY',
      verificationAuthority: 'INDEPENDENT_EXPECTATION_COMPARISON',
      admissionAuthority: 'NONE',
      publicationAuthority: 'NONE',
      humanComprehension: false,
      sharedTaskHandle: 'NOT_INTEGRATED',
    },
    nonclaims: [...RESULT_LINEAGE_NONCLAIMS],
  };
  const lineage = { ...body, lineageSha256: sha256(canonicalJson(body)) };
  return Object.freeze({
    ...lineage,
    sections: Object.freeze({
      ...lineage.sections,
      verifiedNumbers: Object.freeze(verified),
      explanations: Object.freeze(explanations),
      unavailableFacts: Object.freeze(unavailable),
      syntheticEffects: Object.freeze(effects.effects),
    }),
  });
}

// Round-trip verifier: the lineage is re-derived from the same inputs and compared
// byte-for-byte, so a lineage edited between build and read is refused rather than shown.
export function verifyReadOnlyResultLineage(input) {
  exactKeys(input, [
    'lineage', 'journey', 'expectation', 'metricContractBytes', 'evidenceClaim', 'explanation', 'effectStatus',
  ], ['lineage', 'journey', 'expectation', 'metricContractBytes', 'evidenceClaim'],
  'KS247_LINEAGE_DENIED:VERIFY_INPUT');
  const expected = buildReadOnlyResultLineage({
    journey: input.journey,
    expectation: input.expectation,
    metricContractBytes: input.metricContractBytes,
    evidenceClaim: input.evidenceClaim,
    explanation: input.explanation ?? null,
    effectStatus: input.effectStatus ?? null,
  });
  if (canonicalJson(input.lineage) !== canonicalJson(expected)) {
    fail('KS247_LINEAGE_DENIED:LINEAGE_SUBSTITUTION');
  }
  return expected;
}

// ---------------------------------------------------------------------------------
// The read path's renderings.  One lineage, three deterministic renderings (JSON, TABLE,
// HTML) — the same output the existing CLI/table/HTML path offers, with the four sections
// held apart.  Presentation only: rendering is not a comprehension claim.
// ---------------------------------------------------------------------------------
const escapeHtml = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

function lineageRows(lineage) {
  const rows = [];
  for (const number of lineage.sections.verifiedNumbers) {
    rows.push([
      'VERIFIED_NUMBER', number.subject, number.period ?? 'ALL',
      `${number.value} ${number.unit.id}`, 'VERIFIED',
    ]);
  }
  for (const explanation of lineage.sections.explanations) {
    rows.push([
      'EXPLANATION', explanation.lineId, 'ALL', '-', 'UNVERIFIED',
    ]);
  }
  for (const fact of lineage.sections.unavailableFacts) {
    rows.push([
      'UNAVAILABLE_FACT', fact.subject, 'ALL', 'NOT_AVAILABLE', 'UNAVAILABLE',
    ]);
  }
  rows.push([
    'COMPLETION', 'execution.state', 'ALL', lineage.sections.completion.state,
    lineage.sections.completion.complete ? 'COMPLETE_VERIFIED' : 'NOT_COMPLETE',
  ]);
  for (const effect of lineage.sections.syntheticEffects) {
    rows.push([
      'SYNTHETIC_EFFECT', effect.lineId, 'ALL', effect.status,
      effect.presentedAsApplied ? 'CONFIRMED_APPLIED' : 'NOT_PRESENTED_AS_APPLIED',
    ]);
  }
  return rows;
}

const HEADER = Object.freeze(['classification', 'subject', 'period', 'value', 'presented_as']);

function lineageLegend(lineage) {
  return [
    `lineage: ${lineage.lineageId} (${lineage.schemaVersion})`,
    `source revision: ${lineage.sourceRevision}`,
    `independent expectation: ${lineage.verification.expectationSha256} [${lineage.verification.expectationIndependence}]`,
    `unit: ${lineage.verification.unit.id} (${lineage.verification.unit.currency}, ${lineage.verification.unit.minorUnitsPerMajorUnit} minor units per major unit)`,
    `periods: ${Object.entries(lineage.verification.periods).map(([key, window]) => `${key}=${window.start}..${window.end}`).join(' ')}`,
    `verified numbers: ${lineage.verification.verifiedNumberCount} of ${lineage.verification.expectedNumberCount} maintained expectations`,
    `unavailable facts: ${lineage.verification.unavailableFactCount}`,
    `completion: state=${lineage.sections.completion.state} complete=${lineage.sections.completion.complete} source=${lineage.sections.completion.completionSource}`,
    `effect journal: ${lineage.verification.effectJournal} (status=${lineage.verification.effectStatus})`,
    `read-purpose binding: ${lineage.promotionBoundaries.sharedReadPurposeBinding}`,
    'EXPLANATION rows are free-form text and are never verified; UNAVAILABLE_FACT rows are facts this surface does not have',
    'UNVERIFIED and UNAVAILABLE rows are not numbers and are never counted as verified',
    ...lineage.nonclaims.map((nonclaim) => `nonclaim: ${nonclaim}`),
  ];
}

function jsonFor(lineage) {
  return `${canonicalJson(lineage)}\n`;
}

function tableFor(lineage) {
  const rows = lineageRows(lineage);
  const widths = HEADER.map((column, index) => Math.max(
    column.length,
    ...rows.map((row) => String(row[index]).length),
  ));
  const pad = (value, width) => {
    const text = String(value);
    return text.length >= width ? text : text + ' '.repeat(width - text.length);
  };
  const lines = [
    '# KaleidoSphere read-only result lineage TABLE (KS247)',
    ...lineageLegend(lineage).map((line) => `# ${line}`),
    `| ${HEADER.map((column, index) => pad(column, widths[index])).join(' | ')} |`,
    `| ${HEADER.map((_, index) => '-'.repeat(widths[index])).join(' | ')} |`,
    ...rows.map((row) => `| ${row.map((cell, index) => pad(cell, widths[index])).join(' | ')} |`),
    '',
    '## explanation (UNVERIFIED free-form text, not a verified fact)',
    ...(lineage.sections.explanations.length === 0
      ? ['(none declared)']
      : lineage.sections.explanations.map((entry) => `- [${entry.assertionKind}] ${entry.text}`)),
  ];
  return `${lines.join('\n')}\n`;
}

function htmlFor(lineage) {
  const rows = lineageRows(lineage);
  const classOf = (kind) => (kind === 'VERIFIED_NUMBER' ? 'verified'
    : kind === 'UNAVAILABLE_FACT' ? 'unavailable' : kind === 'EXPLANATION' ? 'unverified' : 'completion');
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<title>KaleidoSphere KS247 — read-only result lineage (synthetic local source)</title>',
    '<style>body{font:14px/1.5 system-ui,sans-serif;margin:2rem;color:#111}',
    'table{border-collapse:collapse;margin-top:1rem}',
    'th,td{border:1px solid #ccc;padding:.35rem .6rem}',
    'tr.verified td{background:#eef8ee}tr.unverified td{background:#fdf6e3}',
    'tr.unavailable td{background:#f4f4f4;color:#666}',
    'ul{color:#444}h2{font-size:1rem;margin-top:1.5rem}</style>',
    '</head><body>',
    '<h1>Read-only result lineage</h1>',
    '<ul>',
    ...lineageLegend(lineage).map((line) => `  <li>${escapeHtml(line)}</li>`),
    '</ul>',
    `<table><caption>verified numbers, explanation, unavailable facts and completion, held apart</caption>`,
    `  <tr>${HEADER.map((column) => `<th>${escapeHtml(column)}</th>`).join('')}</tr>`,
    ...rows.map((row) => `  <tr class="${classOf(row[0])}">${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`),
    '</table>',
    '<h2>Explanation (UNVERIFIED free-form text)</h2>',
    '<ul>',
    ...(lineage.sections.explanations.length === 0
      ? ['  <li>(none declared)</li>']
      : lineage.sections.explanations.map((entry) => `  <li>[${escapeHtml(entry.assertionKind)}] ${escapeHtml(entry.text)}</li>`)),
    '</ul>',
    '</body></html>',
  ].join('\n');
}

export function renderResultLineage(lineage, format) {
  if (!isPlainObject(lineage) || lineage.schemaVersion !== RESULT_LINEAGE_SCHEMA) {
    fail('KS247_LINEAGE_DENIED:RENDER_INPUT');
  }
  if (!RESULT_LINEAGE_FORMATS.includes(format)) fail('KS247_LINEAGE_DENIED:RENDER_FORMAT');
  if (format === 'JSON') return jsonFor(lineage);
  if (format === 'TABLE') return tableFor(lineage);
  return `${htmlFor(lineage)}\n`;
}

// One-line diagnostics for the CLI's negative mode: "label=CODE; label=CODE".
export function formatLineageDenial(error) {
  return error?.code ?? String(error?.message ?? error);
}
