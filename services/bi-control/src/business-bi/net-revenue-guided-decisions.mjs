// KaleidoSphere #236 — the GUIDED decision contract for the local user journey.
//
// The released connected runner (`net-revenue-connected-journey.mjs`) is honest about
// what it is: noninteractive synthetic orchestration. It never consumes a user's actual
// choices, so it cannot demonstrate the #236 outcome "clarify the question/definition,
// select the admitted source/mapping, execute, inspect". This module supplies exactly
// that missing layer and nothing more:
//
//   * a CLOSED QUESTION SET — the bounded net-revenue questions this local surface
//     supports, each with its explicit periods, unit, corrections and missing-data
//     behaviour, plus the questions it explicitly does NOT support (order intake,
//     historical open-order balance, free-form SQL, causal attribution, a second
//     metric/currency). An unsupported question is REJECTED by name, never silently
//     answered with revenue numbers.
//   * a CLOSED SOURCE/MAPPING TABLE — the admitted sources (the admitted C2 holdout
//     relation and the two frozen ledger layout profiles) with their declared unit
//     scale, so an ambiguous or wrong-unit mapping is rejected before any read.
//   * DECISION VALIDATION — every answer is checked against the closed tables and the
//     chosen combination is checked for consistency (period must exist in the chosen
//     source's contract; unit must equal the source's declared arithmetic unit).
//
// Nothing here reimplements a metric core, a mapping profile, a comparison, a
// recognition rule or a serializer. It decides WHAT will be run; the released modules
// do the running. In particular the mapping profiles are the frozen exports of
// `net-revenue-ledger-mapping.mjs`, referenced by name, never re-declared.
//
// NONCLAIMS (structural, not decoration):
//   - a validated decision set is NOT authorization to read a production source, and
//     NOT human comprehension evidence;
//   - an absent answer (EOF, empty input, refusal) is NEVER defaulted to an admitted
//     source or period, and never reported as a completed guided run;
//   - the closed question set is this local surface's bounded scope, not a universal
//     semantic model or a generic dashboard/question platform.

import { createHash } from 'node:crypto';

import { canonicalJson } from '../canonical-json.js';
import {
  LEDGER_MAPPING_PROFILES,
  AMBIGUOUS_UNITS_PROFILE,
  WRONG_SCALE_PROFILE,
  declaredSourceUnit,
  assertProfileMatchesSourceUnit,
} from './net-revenue-ledger-mapping.mjs';
import { PERIODS as F4_COMPARISON_PERIODS } from './net-revenue-segment-comparison.mjs';

export const NET_REVENUE_GUIDED_DECISIONS_SCHEMA =
  'kaleidosphere.business-bi/net-revenue-guided-decisions/v1';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const fail = (code) => { const e = new Error(code); e.code = code; throw e; };
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && Object.getPrototypeOf(v) === Object.prototype;

// ---------------------------------------------------------------------------------
// The supported question.
//
// `bi-question-net-revenue-period-comparison` is the ONE question this surface answers.
// Its wording is bounded on purpose: it asks for a comparison of net revenue between
// two fixed calendar periods and for what is explicitly NOT known — it does not ask
// why revenue moved, and it does not ask how many orders were placed.
// ---------------------------------------------------------------------------------
export const SUPPORTED_QUESTION_ID = 'bi-question-net-revenue-period-comparison';

export const SUPPORTED_QUESTION = Object.freeze({
  id: SUPPORTED_QUESTION_ID,
  text: 'How did net revenue in the current period compare with the comparison period, and what in this result is explicitly NOT known?',
  measures: 'Sum of sale amounts minus sum of credit amounts, per fixed calendar period.',
  unit: 'integer EUR minor units (cents)',
  periodSemantics: 'Two fixed, non-overlapping calendar months; both ranges inclusive at both ends.',
  correctionBehaviour:
    'credit rows subtract from the period total; cancel rows contribute exactly 0 and are counted as cancellations only.',
  missingDataBehaviour:
    'UNKNOWN is a first-class channel: unknown rows are counted, integer amounts quantified, none added to net; null-date rows are reported as unassigned and never silently dropped.',
  explicitlyNotAnswered: Object.freeze([
    'Why revenue moved (no causal attribution: a delta is arithmetic over the same rows).',
    'How many orders were placed (order intake is unsupported: no intake-event source).',
    'Period-end open-order balances (no historical status/as-of source).',
    'Any customer, production, or non-synthetic figure.',
  ]),
});

// ---------------------------------------------------------------------------------
// Questions that are explicitly NOT supported by this local surface.
//
// Each entry is a real, plausible business request that must be REJECTED rather than
// approximated by revenue numbers. `rejectedBecause` is the honest reason; the code is
// what the CLI prints.
// ---------------------------------------------------------------------------------
export const UNSUPPORTED_QUESTIONS = Object.freeze({
  'bi-question-order-intake': Object.freeze({
    text: 'How many orders were placed (order intake) in each period?',
    code: 'GUIDED_QUESTION_UNSUPPORTED:ORDER_INTAKE',
    rejectedBecause: 'No intake-event source contract exists in this local surface; order intake must never be inferred from sale rows.',
  }),
  'bi-question-open-order-balance': Object.freeze({
    text: 'What was the open-order balance at each period end?',
    code: 'GUIDED_QUESTION_UNSUPPORTED:OPEN_ORDER_BALANCE',
    rejectedBecause: 'No historical status/as-of source exists; observed open sale rows describe in-window rows only and are never a period-end balance.',
  }),
  'bi-question-revenue-causes': Object.freeze({
    text: 'Why did net revenue change between the periods?',
    code: 'GUIDED_QUESTION_UNSUPPORTED:CAUSAL_ATTRIBUTION',
    rejectedBecause: 'The bounded metric produces arithmetic over the same rows; it carries no causal attribution or driver decomposition.',
  }),
  'bi-question-arbitrary-sql': Object.freeze({
    text: 'Run my own SQL against the source and return the rows.',
    code: 'GUIDED_QUESTION_UNSUPPORTED:FREE_FORM_SQL',
    rejectedBecause: 'This surface has no free-form SQL authority; it executes one closed, digest-bound aggregate operation.',
  }),
  'bi-question-second-metric': Object.freeze({
    text: 'Show margin, headcount or any other metric alongside net revenue.',
    code: 'GUIDED_QUESTION_UNSUPPORTED:SECOND_METRIC',
    rejectedBecause: 'Exactly one admitted metric exists; a second metric or currency is a contract violation, not a configuration option.',
  }),
});

// The answer spelling that means "no question was selected". It is NOT a supported
// question and NOT an unsupported question: it is the FLOOR case (EOF / empty input /
// refusal), and it must be reported as an incomplete guided run.
export const NO_QUESTION_TOKEN = 'none';

// ---------------------------------------------------------------------------------
// The admitted sources.
//
//   holdout-orders-v1  the released C2 admitted synthetic holdout relation
//                      (`synthetic_bi.orders`) — the SAME relation the #236 journey and
//                      the admitted oracle read. Periods/unit come from the released
//                      metric contract, which the caller supplies as bytes.
//   ledger-v1 / ledger-v2
//                      the two frozen versioned ledger layouts reached through the
//                      released #237 mapping profiles. Their periods/unit come from the
//                      released #238 comparison contract, which pins 2026-06 / 2026-07
//                      and integer minor units.
//
// `requiresContract` names the bytes the chosen source needs, so a run can never read a
// relation whose governing contract was not supplied.
// ---------------------------------------------------------------------------------
export const ADMITTED_SOURCES = Object.freeze({
  'holdout-orders-v1': Object.freeze({
    sourceId: 'holdout-orders-v1',
    label: 'Admitted C2 synthetic holdout relation',
    relation: 'synthetic_bi.orders',
    datasetKind: 'KS236_ADMITTED_HOLDOUT',
    requiresContract: 'METRIC_CONTRACT',
    declaredArithmeticUnit: 'INTEGER_MINOR_UNITS',
    currency: Object.freeze({ code: 'EUR', minorUnitsPerMajorUnit: 100 }),
    mappingProfileId: null,
    layoutVersion: null,
    periodSetId: 'holdout-contract-periods-v1',
    status: 'ADMITTED',
  }),
  'ledger-v1': Object.freeze({
    sourceId: 'ledger-v1',
    label: 'Frozen ledger layout v1 (synthetic_bi.orders_ledger)',
    relation: 'synthetic_bi.orders_ledger',
    datasetKind: 'F4_COMPARISON',
    requiresContract: 'SEGMENT_COMPARISON_CONTRACT',
    declaredArithmeticUnit: 'INTEGER_MINOR_UNITS',
    currency: Object.freeze({ code: 'EUR', minorUnitsPerMajorUnit: 100 }),
    mappingProfileId: 'ledger-mapping-v1',
    layoutVersion: 'ledger-v1',
    periodSetId: 'f4-comparison-periods-v1',
    status: 'ADMITTED',
  }),
  'ledger-v2': Object.freeze({
    sourceId: 'ledger-v2',
    label: 'Frozen ledger layout v2 (synthetic_bi.orders_ledger)',
    relation: 'synthetic_bi.orders_ledger',
    datasetKind: 'F4_COMPARISON',
    requiresContract: 'SEGMENT_COMPARISON_CONTRACT',
    declaredArithmeticUnit: 'INTEGER_MINOR_UNITS',
    currency: Object.freeze({ code: 'EUR', minorUnitsPerMajorUnit: 100 }),
    mappingProfileId: 'ledger-mapping-v2',
    layoutVersion: 'ledger-v2',
    periodSetId: 'f4-comparison-periods-v1',
    status: 'ADMITTED',
  }),
});

// Sources that look plausible and must be REJECTED. These are not configurations: they
// are the negative half of the source/mapping decision, and each carries its own code so
// a wrong-unit rejection is never collapsed into "source not found".
export const REJECTED_SOURCE_REQUESTS = Object.freeze({
  'production-orders': Object.freeze({
    code: 'GUIDED_SOURCE_NOT_ADMITTED:PRODUCTION_SOURCE',
    rejectedBecause: 'Only synthetic admitted sources are readable by this local surface; a production/customer source is not admitted.',
  }),
  'ledger-v1-base-units': Object.freeze({
    code: 'GUIDED_SOURCE_NOT_ADMITTED:MINOR_UNITS_EXPECTED',
    rejectedBecause: "Source amounts are integer minor units; a 'base units' reading would multiply by 100 and is rejected.",
  }),
  'ledger-unspecified': Object.freeze({
    code: 'GUIDED_SOURCE_NOT_ADMITTED:UNIT_SCALE_AMBIGUOUS',
    rejectedBecause: 'The requested mapping declares no usable unit scale (ambiguous units), so it cannot be admitted.',
  }),
});

// ---------------------------------------------------------------------------------
// The supported period answers, per period set.
//
// A period answer is a period-set ID, not an arbitrary date range: the user chooses a
// supported comparison, they do not author a window. Date ranges are resolved from the
// supplied governing contract at run time, so a period answer can never invent a window
// the contract did not declare.
// ---------------------------------------------------------------------------------
export const SUPPORTED_PERIOD_SETS = Object.freeze([
  'holdout-contract-periods-v1',
  'f4-comparison-periods-v1',
]);

// ---------------------------------------------------------------------------------
// Decision input shape.
//
// Every field is required to be PRESENT as a key; `null` is a meaningful, distinct value
// (it means "the user did not answer"), which is why absence and refusal are
// representable rather than defaulted.
// ---------------------------------------------------------------------------------
export const DECISION_KEYS = Object.freeze([
  'questionId',
  'sourceId',
  'periodSetId',
  'unitId',
]);

export const SUPPORTED_UNIT_ID = 'EUR_MINOR_UNITS';

export function emptyDecisions() {
  return { questionId: null, sourceId: null, periodSetId: null, unitId: null };
}

function assertDecisionShape(decisions) {
  if (!isPlainObject(decisions)) fail('GUIDED_DECISIONS_DENIED:SHAPE');
  const keys = Object.keys(decisions).sort();
  if (canonicalJson(keys) !== canonicalJson([...DECISION_KEYS].sort())) {
    // The key set must match EXACTLY. A dropped key is a malformed record, not a
    // skipped answer: "the user declined" must be spelled as an explicit null, so that
    // absence-by-omission can never be read as an honest decision.
    fail('GUIDED_DECISIONS_DENIED:KEYS');
  }
}

// ---------------------------------------------------------------------------------
// Step 1 — the question decision.
//
// Returns a DISPOSITION, never a default. `disposition` is one of:
//   SUPPORTED     the one bounded question was selected
//   UNSUPPORTED   a named-but-unsupported question was selected (with its code)
//   ABSENT        no answer at all (EOF / empty input / skipped)
//   REFUSED       the user explicitly declined
// An unknown question id is UNSUPPORTED with an explicit unknown-question code.
// ---------------------------------------------------------------------------------
export function classifyQuestion(questionId) {
  if (questionId === null || questionId === undefined) {
    return { disposition: 'ABSENT', questionId: null, code: null, rejectedBecause: 'No question was answered.' };
  }
  if (questionId === NO_QUESTION_TOKEN) {
    return {
      disposition: 'REFUSED',
      questionId: NO_QUESTION_TOKEN,
      code: 'GUIDED_QUESTION_REFUSED',
      rejectedBecause: 'The user declined to select a supported question.',
    };
  }
  if (typeof questionId !== 'string') fail('GUIDED_QUESTION_DENIED:TYPE');
  if (questionId === SUPPORTED_QUESTION_ID) {
    return { disposition: 'SUPPORTED', questionId, code: null, rejectedBecause: null };
  }
  const unsupported = UNSUPPORTED_QUESTIONS[questionId];
  if (unsupported) {
    return {
      disposition: 'UNSUPPORTED',
      questionId,
      code: unsupported.code,
      rejectedBecause: unsupported.rejectedBecause,
    };
  }
  return {
    disposition: 'UNSUPPORTED',
    questionId,
    code: `GUIDED_QUESTION_UNSUPPORTED:UNKNOWN_QUESTION_ID`,
    rejectedBecause: 'The question id is not in the closed supported question set.',
  };
}

// ---------------------------------------------------------------------------------
// Step 2 — the source/mapping decision.
// ---------------------------------------------------------------------------------
export function classifySource(sourceId) {
  if (sourceId === null || sourceId === undefined) {
    return { disposition: 'ABSENT', sourceId: null, code: null, rejectedBecause: 'No source was selected.' };
  }
  if (typeof sourceId !== 'string') fail('GUIDED_SOURCE_DENIED:TYPE');
  const admitted = ADMITTED_SOURCES[sourceId];
  if (admitted) return { disposition: 'ADMITTED', sourceId, code: null, rejectedBecause: null };
  const rejected = REJECTED_SOURCE_REQUESTS[sourceId];
  if (rejected) {
    return { disposition: 'REJECTED', sourceId, code: rejected.code, rejectedBecause: rejected.rejectedBecause };
  }
  return {
    disposition: 'REJECTED',
    sourceId,
    code: 'GUIDED_SOURCE_DENIED:NOT_IN_CLOSED_SET',
    rejectedBecause: 'The source id is not in the closed admitted or explicitly-rejected set.',
  };
}

// ---------------------------------------------------------------------------------
// Step 3 — the mapping profile's OWN unit declaration, read from the released module.
//
// This is the load-bearing cross-check: the decision layer never states that a mapping
// is correct, it asks the frozen #237 profile what unit scale it declares and compares
// that to the source's declared arithmetic unit. A profile that declares BASE_UNITS over
// a MINOR_UNITS source is rejected here, using the released code, before any read.
// ---------------------------------------------------------------------------------
export function assertMappingUnitAgreement(source) {
  if (source.mappingProfileId === null) return { mappingProfileId: null, unitScale: null, agrees: true };
  const profile = LEDGER_MAPPING_PROFILES[source.mappingProfileId];
  if (!profile) fail(`GUIDED_MAPPING_PROFILE_MISSING:${source.mappingProfileId}`);
  // Ask the RELEASED declaration table what the source's atomic unit actually is, then
  // hand both to the RELEASED gate. This module never compares units itself: it routes
  // the question to the frozen #237 authority, so there is exactly one unit ruler.
  const declared = declaredSourceUnit(profile.layoutVersion);
  assertProfileMatchesSourceUnit(profile, declared);
  return { mappingProfileId: source.mappingProfileId, unitScale: declared, agrees: true };
}

// The two frozen ambient profiles exist ONLY as negative controls. They are surfaced
// here so a caller (and the suite) can drive the released unit gate through the SAME
// entry point rather than importing a second validator.
export const REJECTED_MAPPING_PROFILES = Object.freeze({
  'ledger-mapping-ambiguous': AMBIGUOUS_UNITS_PROFILE,
  'ledger-mapping-wrong-scale': WRONG_SCALE_PROFILE,
});

export function classifyMappingProfile(profileId) {
  if (profileId === null || profileId === undefined) {
    return { disposition: 'ABSENT', profileId: null, code: null };
  }
  if (typeof profileId !== 'string') fail('GUIDED_MAPPING_DENIED:TYPE');
  if (Object.hasOwn(LEDGER_MAPPING_PROFILES, profileId)) {
    return { disposition: 'ADMITTED', profileId, code: null };
  }
  if (Object.hasOwn(REJECTED_MAPPING_PROFILES, profileId)) {
    const rejected = REJECTED_MAPPING_PROFILES[profileId];
    const code = rejected.unitScale === 'UNSPECIFIED'
      ? 'GUIDED_MAPPING_NOT_ADMITTED:UNIT_SCALE_AMBIGUOUS'
      : 'GUIDED_MAPPING_NOT_ADMITTED:UNIT_SCALE_MISMATCH';
    return { disposition: 'REJECTED', profileId, code };
  }
  return { disposition: 'REJECTED', profileId, code: 'GUIDED_MAPPING_DENIED:NOT_IN_CLOSED_SET' };
}

// ---------------------------------------------------------------------------------
// Step 4 — the unit decision.
//
// The user must state the arithmetic unit explicitly; a correct guess is not a decision.
// An absent unit is ABSENT (not "assumed cents"), and a wrong unit is REJECTED.
// ---------------------------------------------------------------------------------
export function classifyUnit(unitId) {
  if (unitId === null || unitId === undefined) {
    return { disposition: 'ABSENT', unitId: null, code: null, rejectedBecause: 'No arithmetic unit was stated.' };
  }
  if (typeof unitId !== 'string') fail('GUIDED_UNIT_DENIED:TYPE');
  if (unitId === SUPPORTED_UNIT_ID) return { disposition: 'SUPPORTED', unitId, code: null, rejectedBecause: null };
  return {
    disposition: 'REJECTED',
    unitId,
    code: 'GUIDED_UNIT_DENIED:UNSUPPORTED_ARITHMETIC_UNIT',
    rejectedBecause: 'The released metric is defined over integer EUR minor units (cents); another unit is an unsupported arithmetic unit, not a free parameter.',
  };
}

// ---------------------------------------------------------------------------------
// Step 5 — assemble + validate the whole decision set.
//
// `validateDecisions` is the single fail-closed gate the guided runner calls. It returns
// a decision record carrying the disposition of every step; it THROWS for a malformed
// input shape only. A non-SUPPORTED disposition is NOT an exception: it is a recorded,
// reportable outcome, because "the user asked for something unsupported" is a legitimate
// result of a guided journey and must not be reported as a crash or a success.
// ---------------------------------------------------------------------------------
export function validateDecisions(decisions) {
  assertDecisionShape(decisions);
  const question = classifyQuestion(decisions.questionId);
  const source = classifySource(decisions.sourceId);
  const unit = classifyUnit(decisions.unitId);

  // Period and mapping are only meaningful once the source is admitted; classify them
  // anyway so the record is complete and comparable.
  const periodSetId = decisions.periodSetId ?? null;
  const periodDisposition = periodSetId === null
    ? { disposition: 'ABSENT', periodSetId: null, code: null, rejectedBecause: 'No period comparison was selected.' }
    : SUPPORTED_PERIOD_SETS.includes(periodSetId)
      ? { disposition: 'SUPPORTED', periodSetId, code: null, rejectedBecause: null }
      : {
        disposition: 'REJECTED',
        periodSetId,
        code: 'GUIDED_PERIOD_DENIED:NOT_A_SUPPORTED_PERIOD_SET',
        rejectedBecause: 'Periods are chosen from the contract-declared comparisons; an arbitrary window is not admitted.',
      };

  const admittedSource = source.disposition === 'ADMITTED' ? ADMITTED_SOURCES[source.sourceId] : null;
  const mapping = classifyMappingProfile(admittedSource ? admittedSource.mappingProfileId : null);

  // Cross-check: the period set must belong to the chosen source's period set, and the
  // stated unit must equal the source's declared arithmetic unit. Both are consistency
  // failures between two individually-plausible answers — exactly the class of mistake a
  // guided journey exists to catch.
  let consistency = null;
  if (admittedSource && periodDisposition.disposition === 'SUPPORTED'
      && periodDisposition.periodSetId !== admittedSource.periodSetId) {
    consistency = {
      code: 'GUIDED_DECISION_INCONSISTENT:PERIOD_SET_NOT_IN_SOURCE_CONTRACT',
      detail: `Source '${admittedSource.sourceId}' is governed by period set '${admittedSource.periodSetId}', not '${periodDisposition.periodSetId}'.`,
    };
  } else if (admittedSource && unit.disposition === 'SUPPORTED') {
    const declared = admittedSource.currency.code === 'EUR'
      && admittedSource.currency.minorUnitsPerMajorUnit === 100
      && admittedSource.declaredArithmeticUnit === 'INTEGER_MINOR_UNITS';
    if (!declared) {
      consistency = {
        code: 'GUIDED_DECISION_INCONSISTENT:UNIT_AGREEMENT',
        detail: `Source '${admittedSource.sourceId}' does not declare EUR integer minor units.`,
      };
    }
  }

  // A step is satisfied by its own success vocabulary — the question/period/unit say
  // SUPPORTED, the source says ADMITTED. Anything else blocks the run.
  const SATISFIED = Object.freeze(['SUPPORTED', 'ADMITTED']);
  const blocking = [question, source, periodDisposition, unit]
    .filter((step) => !SATISFIED.includes(step.disposition))
    .map((step) => step.code ?? `${step.disposition}`);

  const admitted = Boolean(blocking.length === 0 && consistency === null);
  const incomplete = question.disposition === 'ABSENT' || question.disposition === 'REFUSED'
    || source.disposition === 'ABSENT' || unit.disposition === 'ABSENT'
    || periodDisposition.disposition === 'ABSENT';

  const record = {
    schemaVersion: NET_REVENUE_GUIDED_DECISIONS_SCHEMA,
    question,
    source,
    period: periodDisposition,
    unit,
    mapping,
    consistency,
    admitted,
    // An ABSENT/REFUSED answer is explicitly not equivalent to an admitted default.
    incomplete,
    // The decision record never carries a result, an expectation, or a digest of one:
    // deciding what to run must stay separable from running it.
    carriesResult: false,
    authority: {
      readSource: false,
      executeMetric: false,
      humanComprehension: false,
      productionAdmission: false,
    },
  };
  return deepFreeze({ ...record, decisionsSha256: sha256(canonicalJson(record)) });
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

// ---------------------------------------------------------------------------------
// Step 6 — resolve the admitted decision into the concrete run parameters.
//
// This is where a decision becomes an executable plan WITHOUT any calculation: it maps
// the chosen source to the released entry point that owns it, resolves the periods from
// the supplied governing contract, and pins the digest of the decision that produced it.
// It refuses to resolve anything that is not `admitted`.
// ---------------------------------------------------------------------------------
export function resolveRunParameters(decision, { metricContractBytes, segmentComparisonContractBytes } = {}) {
  if (!isPlainObject(decision) || decision.admitted !== true) {
    fail('GUIDED_RESOLVE_DENIED:NOT_ADMITTED');
  }
  const source = ADMITTED_SOURCES[decision.source.sourceId];
  if (!source) fail('GUIDED_RESOLVE_DENIED:SOURCE_NOT_ADMITTED');
  assertMappingUnitAgreement(source);

  let periods;
  let contractSha256;
  if (source.requiresContract === 'METRIC_CONTRACT') {
    if (!metricContractBytes) fail('GUIDED_RESOLVE_DENIED:METRIC_CONTRACT_REQUIRED');
    const contract = JSON.parse(Buffer.from(metricContractBytes).toString('utf8'));
    if (!isPlainObject(contract.relation) || contract.relation.name === undefined
        || !isPlainObject(contract.metric) || !isPlainObject(contract.periods)) {
      fail('GUIDED_RESOLVE_DENIED:METRIC_CONTRACT_MALFORMED');
    }
    const declared = Object.fromEntries(
      Object.entries(contract.periods).map(([key, period]) => [key, {
        label: period.label, start: period.start, end: period.end,
      }]),
    );
    const requested = decision.period.periodSetId;
    if (requested !== source.periodSetId) fail('GUIDED_RESOLVE_DENIED:PERIOD_SET_NOT_IN_SOURCE_CONTRACT');
    periods = declared;
    contractSha256 = sha256(Buffer.from(metricContractBytes));
  } else {
    // The F4 comparison periods are not free parameters: read them from the RELEASED
    // frozen declaration, so a guided run can never construct a window the released
    // comparison core would not itself use.
    periods = F4_COMPARISON_PERIODS;
    contractSha256 = segmentComparisonContractBytes
      ? sha256(Buffer.from(segmentComparisonContractBytes))
      : null;
  }

  return deepFreeze({
    schemaVersion: NET_REVENUE_GUIDED_DECISIONS_SCHEMA,
    decisionsSha256: decision.decisionsSha256,
    questionId: decision.question.questionId,
    sourceId: source.sourceId,
    relation: source.relation,
    datasetKind: source.datasetKind,
    mappingProfileId: source.mappingProfileId,
    periodSetId: decision.period.periodSetId,
    unitId: decision.unit.unitId,
    currency: source.currency,
    arithmeticUnit: source.declaredArithmeticUnit,
    periods,
    governingContractSha256: contractSha256,
    ownerEntryPoint: source.datasetKind === 'KS236_ADMITTED_HOLDOUT'
      ? 'runNetRevenueJourney'
      : 'runNetRevenueF4Composition',
  });
}
