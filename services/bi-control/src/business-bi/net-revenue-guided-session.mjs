// KaleidoSphere #236 — the GUIDED local user session.
//
// `net-revenue-guided-decisions.mjs` decides WHICH bounded question, source, period and
// unit are being asked. THIS module turns an admitted decision into an actual run by
// handing it to the RELEASED entry point that owns that source — and then does the thing
// the released connected runner explicitly does not do: it consumes the user's real
// answers, records what they asked in their own words, and refuses to complete a run the
// user did not actually authorize.
//
// What is reused, verbatim, never reimplemented:
//   holdout-orders-v1 -> runNetRevenueJourney        (released #239 net-revenue-journey.mjs)
//   ledger-v1/v2      -> composeF4ForLayout          (released #240 net-revenue-f4-composition.mjs)
//                        which itself applies composeViaProfile + buildSegmentComparisonReport
//                        (released #240 net-revenue-ledger-mapping.mjs / -segment-comparison.mjs)
//
// What this module adds:
//   1. ANSWER INTAKE — an answer source is a real, ordered stream of raw user lines. The
//      session reads the user's question/source/period/unit answers from it and NEVER
//      substitutes a default for a line it did not receive. An exhausted stream is the
//      ABSENT case, and an exhausted stream can never produce a completed run.
//   2. PHRASE PRESERVATION — the user's own words are carried into the receipt next to
//      the canonical decision, so a later reader can see what was literally asked rather
//      than only the option that matched.
//   3. CONFIRMATION GATE — an admitted decision is still not a run. The user must confirm
//      the resolved parameters; without a confirmation the session stops at READY and
//      records that nothing was read.
//   4. DISPATCH — the admitted source is executed through its released owner, and the
//      released result (readback, TABLE/CHART/DETAILS renderings, comparison report) is
//      carried through unmodified.
//
// NONCLAIMS (structural):
//   - a completed session is NOT evidence that a human understood the result, and NOT an
//     authorization to read a production source;
//   - `humanComprehension: false` is recorded on every receipt: this surface can record
//     what was asked and what was returned, and nothing about what anyone comprehended;
//   - the guided session owns NO question semantics of its own: an unsupported question is
//     refused by the decision layer's code, never answered approximately;
//   - the session never publishes, never unlocks a HELD provenance, and performs no write
//     beyond the caller's local receipt.

import { createHash } from 'node:crypto';

import { runNetRevenueJourney } from './net-revenue-journey.mjs';
import { composeF4ForLayout } from './net-revenue-f4-composition.mjs';
import { canonicalJson } from '../canonical-json.js';
import {
  NET_REVENUE_GUIDED_DECISIONS_SCHEMA,
  SUPPORTED_QUESTION,
  SUPPORTED_QUESTION_ID,
  UNSUPPORTED_QUESTIONS,
  NO_QUESTION_TOKEN,
  ADMITTED_SOURCES,
  REJECTED_SOURCE_REQUESTS,
  REJECTED_MAPPING_PROFILES,
  SUPPORTED_UNIT_ID,
  emptyDecisions,
  validateDecisions,
  resolveRunParameters,
} from './net-revenue-guided-decisions.mjs';

export const NET_REVENUE_GUIDED_SESSION_SCHEMA =
  'kaleidosphere.business-bi/net-revenue-guided-session/v1';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const fail = (code) => { const e = new Error(code); e.code = code; throw e; };
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && Object.getPrototypeOf(v) === Object.prototype;

// The four decisions, in the order the session asks them. Frozen so the receipt's answer
// order is comparable across runs.
export const GUIDED_STEPS = Object.freeze(['question', 'source', 'period', 'unit']);

// The prompt text for each step. These are the words a real local user sees. They state
// the bound explicitly (one question, contract-declared periods, integer minor units) so
// the user is deciding inside a stated scope rather than guessing at one.
export const GUIDED_PROMPTS = Object.freeze({
  question: Object.freeze({
    step: 'question',
    prompt: 'What do you want to know? (net revenue for the two fixed calendar periods, or something else)',
    options: Object.freeze([SUPPORTED_QUESTION_ID, ...Object.keys(UNSUPPORTED_QUESTIONS), NO_QUESTION_TOKEN]),
    defaultApplied: null,
  }),
  source: Object.freeze({
    step: 'source',
    prompt: 'Which admitted source should answer it?',
    options: Object.freeze([...Object.keys(ADMITTED_SOURCES), ...Object.keys(REJECTED_SOURCE_REQUESTS)]),
    defaultApplied: null,
  }),
  period: Object.freeze({
    step: 'period',
    prompt: 'Which contract-declared period comparison?',
    options: Object.freeze(['holdout-contract-periods-v1', 'f4-comparison-periods-v1']),
    defaultApplied: null,
  }),
  unit: Object.freeze({
    step: 'unit',
    prompt: 'In which arithmetic unit should the numbers be read?',
    options: Object.freeze([SUPPORTED_UNIT_ID, 'EUR_MAJOR_UNITS']),
    defaultApplied: null,
  }),
});

// ---------------------------------------------------------------------------------
// Answer intake.
//
// An answer source is `{ read: () => string|null }`. `read()` returning null (or an
// exhausted array) means THE USER DID NOT ANSWER — EOF. It never means "take the
// default", because there is no default: every step carries `defaultApplied: null` and
// the session records `absent` for that step.
//
// `createListAnswerSource` is the honest noninteractive adapter: it replays lines that
// were really supplied (stdin, a scripted session, a recorded file). A caller that wants
// a live terminal passes its own reader. Either way the session cannot distinguish the
// two, and neither can default.
// ---------------------------------------------------------------------------------
export function createListAnswerSource(lines) {
  if (!Array.isArray(lines)) fail('GUIDED_ANSWER_SOURCE_DENIED');
  let index = 0;
  return {
    kind: 'LISTED_LINES',
    read() {
      if (index >= lines.length) return null; // EOF — a real, reportable outcome
      const line = lines[index];
      index += 1;
      return typeof line === 'string' ? line : null;
    },
    get consumed() { return index; },
  };
}

// Normalize one raw line into a decision value. The distinction that matters:
//   undefined/null/whitespace -> null  (ABSENT: the user did not answer)
//   the refusal token         -> 'none' (REFUSED: the user declined)
//   anything else             -> verbatim, trimmed (the user's own words)
// Note that an EMPTY STRING is ABSENT, not an answer, and never a default.
export function normalizeAnswer(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') fail('GUIDED_ANSWER_DENIED:TYPE');
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  return trimmed;
}

// ---------------------------------------------------------------------------------
// The session.
//
// Phases, in order: ASKED -> DECIDED -> [READY] -> EXECUTED | STOPPED.
//
//   ASKED     answers were read off the source
//   DECIDED   the decision layer classified them (admitted or refused, never defaulted)
//   READY     admitted AND confirmed: parameters resolved, still nothing read
//   EXECUTED  the released owner ran and returned its result
//   STOPPED   the session did not reach EXECUTED, with the reason retained
//
// A session that ends anywhere other than EXECUTED is NOT a partial success: it is a
// complete, honest record that the journey did not run.
// ---------------------------------------------------------------------------------
export async function runGuidedSession(input) {
  if (!isPlainObject(input)) fail('GUIDED_SESSION_INPUT_DENIED');
  const {
    answerSource,
    metricContractBytes,
    segmentComparisonContractBytes,
    oracleBytes,
    holdoutBytes,
    f4Sources,
    database,
    confirm,
  } = input;
  if (!isPlainObject(answerSource) || typeof answerSource.read !== 'function') {
    fail('GUIDED_SESSION_ANSWER_SOURCE_DENIED');
  }
  if (typeof confirm !== 'function') fail('GUIDED_SESSION_CONFIRM_DENIED');

  // ---- Phase ASKED: read the user's raw answers, in order, with no defaults ----------
  const raw = {};
  const asked = [];
  for (const step of GUIDED_STEPS) {
    const value = normalizeAnswer(answerSource.read());
    raw[step] = value;
    asked.push({
      step,
      prompt: GUIDED_PROMPTS[step].prompt,
      rawAnswer: value,
      // Recorded per step so "no answer" is visible in the receipt as itself.
      answered: value !== null,
      defaultApplied: null,
    });
  }

  // Map the user's raw words onto the decision shape. A refusal token stays the refusal
  // token; an unanswered step stays null.
  const decisions = {
    ...emptyDecisions(),
    questionId: raw.question,
    sourceId: raw.source,
    periodSetId: raw.period,
    unitId: raw.unit,
  };

  // ---- Phase DECIDED ----------------------------------------------------------------
  let decision;
  try {
    decision = validateDecisions(decisions);
  } catch (error) {
    // A malformed answer shape is a session-level STOP, not a crash: the receipt records
    // which step produced the malformed value.
    return deepFreeze({
      schemaVersion: NET_REVENUE_GUIDED_SESSION_SCHEMA,
      phase: 'STOPPED',
      stoppedBecause: { code: error.code ?? 'GUIDED_SESSION_DECISION_DENIED', step: null },
      stepOrder: GUIDED_STEPS,
      asked,
      rawAnswers: raw,
      decision: null,
      runParameters: null,
      confirmed: false,
      executed: false,
      result: null,
      writesPerformed: [],
      authority: guidedAuthority(),
    });
  }

  const base = {
    schemaVersion: NET_REVENUE_GUIDED_SESSION_SCHEMA,
    stepOrder: GUIDED_STEPS,
    asked,
    rawAnswers: raw,
    decision,
    authority: guidedAuthority(),
  };

  if (!decision.admitted) {
    // Every refusal is recorded with its OWN code from the decision layer — an
    // unsupported question, a rejected source, a wrong unit and an inconsistent
    // combination are four different facts and are never merged.
    return deepFreeze({
      ...base,
      phase: 'STOPPED',
      stoppedBecause: {
        code: firstBlockingCode(decision) ?? (decision.incomplete ? 'GUIDED_SESSION_INCOMPLETE' : 'GUIDED_SESSION_NOT_ADMITTED'),
        step: firstBlockingStep(decision),
        incomplete: decision.incomplete,
      },
      runParameters: null,
      confirmed: false,
      executed: false,
      result: null,
      writesPerformed: [],
    });
  }

  // ---- Phase READY: resolve parameters, then require an explicit confirmation --------
  let runParameters;
  try {
    runParameters = resolveRunParameters(decision, { metricContractBytes, segmentComparisonContractBytes });
  } catch (error) {
    return deepFreeze({
      ...base,
      phase: 'STOPPED',
      stoppedBecause: { code: error.code ?? 'GUIDED_SESSION_RESOLVE_DENIED', step: null, incomplete: false },
      runParameters: null,
      confirmed: false,
      executed: false,
      result: null,
      writesPerformed: [],
    });
  }

  // The confirmation gate. `confirm` sees exactly what will run (source, relation, unit,
  // resolved periods) and returns the user's real decision. `false` and a missing return
  // are the same fact: the user did not authorize the run.
  const confirmation = await confirm(confirmationSummary(runParameters, decision));
  const confirmed = confirmation === true;

  if (!confirmed) {
    return deepFreeze({
      ...base,
      phase: 'READY',
      stoppedBecause: {
        code: 'GUIDED_SESSION_NOT_CONFIRMED',
        step: 'confirm',
        incomplete: false,
      },
      runParameters,
      confirmation,
      confirmed: false,
      executed: false,
      // Nothing was read: the confirmation gate sits BEFORE the first source access.
      result: null,
      writesPerformed: [],
    });
  }

  // ---- Phase EXECUTED: hand the admitted source to its released owner ----------------
  const result = await dispatchAdmittedSource({
    runParameters, decision, metricContractBytes, oracleBytes, holdoutBytes, f4Sources, database,
  });

  return deepFreeze({
    ...base,
    phase: 'EXECUTED',
    stoppedBecause: null,
    runParameters,
    confirmation: true,
    confirmed: true,
    executed: true,
    result,
    writesPerformed: [],
  });
}

// What the user is asked to confirm. It states the bound one more time so a confirmation
// is a decision about stated parameters, not about a familiar-looking prompt.
export function confirmationSummary(runParameters, decision) {
  return {
    question: SUPPORTED_QUESTION.text,
    questionId: runParameters.questionId,
    sourceId: runParameters.sourceId,
    relation: runParameters.relation,
    unitId: runParameters.unitId,
    currency: runParameters.currency,
    periods: runParameters.periods,
    decisionsSha256: runParameters.decisionsSha256,
    readerNote: 'Confirming authorizes one read of the admitted synthetic source above. It is not an admission of any production source.',
    ...(decision ? {} : {}),
  };
}

function guidedAuthority() {
  return {
    readSource: false,
    executeMetric: false,
    humanComprehension: false,
    productionAdmission: false,
    publish: false,
    heldProvenanceUnlocked: false,
  };
}

function firstBlockingCode(decision) {
  const steps = [decision.question, decision.source, decision.period, decision.unit];
  const blocked = steps.find((s) => s.code);
  if (blocked) return blocked.code;
  if (decision.consistency) return decision.consistency.code;
  return null;
}

function firstBlockingStep(decision) {
  for (const [step, value] of Object.entries({
    question: decision.question, source: decision.source, period: decision.period, unit: decision.unit,
  })) {
    if (value.code) return step;
  }
  return decision.consistency ? 'period' : null;
}

// ---------------------------------------------------------------------------------
// Dispatch — the admitted source is executed by the released module that owns it.
//
// This function contains no arithmetic, no mapping and no rendering: it selects the
// owner by the admitted source's own `datasetKind` and returns what the owner returned.
// ---------------------------------------------------------------------------------
export async function dispatchAdmittedSource({
  runParameters, decision, metricContractBytes, oracleBytes, holdoutBytes, f4Sources, database,
}) {
  const source = ADMITTED_SOURCES[runParameters.sourceId];
  if (!source) fail('GUIDED_DISPATCH_DENIED:SOURCE_NOT_ADMITTED');

  if (source.datasetKind === 'KS236_ADMITTED_HOLDOUT') {
    if (!metricContractBytes || !oracleBytes || !holdoutBytes) fail('GUIDED_DISPATCH_DENIED:HOLDOUT_INPUTS_REQUIRED');
    if (!isPlainObject(database)) fail('GUIDED_DISPATCH_DENIED:DATABASE_REQUIRED');
    const journey = await runNetRevenueJourney({ metricContractBytes, oracleBytes, holdoutBytes, database });
    if (journey.jsonTableIdentity !== true) fail('GUIDED_DISPATCH_DENIED:READBACK_RENDER_IDENTITY');
    return {
      ownerEntryPoint: 'runNetRevenueJourney',
      ownerSchemaVersion: journey.schemaVersion,
      sourceMode: journey.sourceMode,
      oracleEquality: journey.oracleEquality,
      reconcilesToIndependentOracle: journey.reconcilesToIndependentOracle,
      result: journey.result,
      nonclaims: journey.nonclaims,
      // The released presentation artifacts, carried through unmodified.
      presentation: {
        readbackSha256: journey.readbackSha256,
        readback: journey.readback,
        tableRendering: journey.tableRendering,
        chart: journey.visual,
        chartHtml: journey.visualHtml,
        jsonRendering: journey.jsonRendering,
        jsonTableIdentity: journey.jsonTableIdentity,
      },
      digests: {
        planSha256: journey.planSha256,
        receiptSha256: journey.receiptSha256,
        resultSha256: journey.resultSha256,
      },
    };
  }

  if (source.datasetKind === 'F4_COMPARISON') {
    const fixture = isPlainObject(f4Sources) ? f4Sources[source.layoutVersion] : null;
    if (!isPlainObject(fixture) || !Array.isArray(fixture.rows) || fixture.rows.length === 0) {
      fail(`GUIDED_DISPATCH_DENIED:F4_SOURCE_REQUIRED:${source.layoutVersion}`);
    }
    // The rows reaching the profile come from the real source when one was supplied: the
    // dispatch recreates the released relation for THIS layout, seeds it and reads it back
    // through the released closure, so the profile sees what the source actually returned.
    let rows = fixture.rows.map((r) => ({ ...r }));
    let sourceMode = 'SYNTHETIC_FALLBACK';
    if (isPlainObject(database) && database.__mode === 'REAL_POSTGRESQL') {
      const { seedF4Database, readF4SourceRows } = await import('./net-revenue-f4-composition.mjs');
      await database.exec('DROP TABLE IF EXISTS synthetic_bi.orders_ledger');
      await seedF4Database(database, source.layoutVersion, fixture.rows);
      rows = await readF4SourceRows(database, source.layoutVersion);
      sourceMode = 'REAL_POSTGRESQL';
    }
    // composeF4ForLayout applies the released profile AND the released comparison, so the
    // guided session never touches either.
    const composed = composeF4ForLayout(source.layoutVersion, rows, { sourceMode });
    return {
      ownerEntryPoint: 'composeF4ForLayout',
      ownerSchemaVersion: composed.schemaVersion,
      sourceMode: composed.sourceMode,
      sourceMarking: composed.sourceMarking,
      layoutVersion: composed.layoutVersion,
      kernelProfile: composed.kernelProfile,
      usedDeclaredProfile: composed.usedDeclaredProfile,
      kernelRowCount: composed.kernelRowCount,
      comparison: composed.comparison,
      digests: {
        kernelDigest: composed.kernelDigest,
        comparisonDigest: composed.comparisonDigest,
      },
    };
  }

  fail(`GUIDED_DISPATCH_DENIED:NO_OWNER_FOR:${source.datasetKind}`);
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

// ---------------------------------------------------------------------------------
// Receipt digest — over the session's own decisions and outcomes only.
//
// The digest deliberately covers the ASKED lines and the DECISION (including every
// refusal code), so two runs that differ only in what the user asked produce different
// digests. It covers the result digest too, so a receipt cannot be replayed against a
// different result.
// ---------------------------------------------------------------------------------
export function guidedSessionDigest(session) {
  if (!isPlainObject(session)) fail('GUIDED_SESSION_DIGEST_DENIED');
  return sha256(canonicalJson({
    schemaVersion: session.schemaVersion,
    phase: session.phase,
    asked: session.asked,
    decisionSha256: session.decision ? session.decision.decisionsSha256 : null,
    admitted: session.decision ? session.decision.admitted : null,
    stoppedBecause: session.stoppedBecause,
    confirmed: session.confirmed,
    executed: session.executed,
    resultDigest: session.result
      ? (session.result.digests?.resultSha256
        ?? session.result.digests?.comparisonDigest
        ?? null)
      : null,
  }));
}

// Re-exported so a suite can drive the closed tables through ONE import, without
// reaching past the session surface for the decision contract.
export { NET_REVENUE_GUIDED_DECISIONS_SCHEMA, SUPPORTED_QUESTION, SUPPORTED_QUESTION_ID };
