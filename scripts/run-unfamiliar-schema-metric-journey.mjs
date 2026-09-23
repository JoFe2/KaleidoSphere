#!/usr/bin/env node
// KS246 (KS-EVO-01-AC03/AC04) — the ONE runnable local journey from a caller-confirmed
// unfamiliar-schema proposal to an ACTUAL local synthetic database execution of the
// released net-revenue metric core.
//
//   node scripts/run-unfamiliar-schema-metric-journey.mjs
//       EOF run: the proposal entry point is driven with no answers at all.  Every
//       question stays ABSENT, the candidate stays PROPOSED, and the AC03 handoff is
//       DENIED with its exact code.  Nothing is executed.
//   node scripts/run-unfamiliar-schema-metric-journey.mjs --answers <file> \
//       --kind-decisions <file> --business-semantics <file> --source-revision <rev> \
//       [--source <path>] [--pglite <absolute dist/index.js path>] [--goal <name>]
//       one answer per line, in the printed interview order; 'none' refuses a question.
//
//       --kind-decisions, --business-semantics and --source-revision are REQUIRED to
//       execute.  There is NO default and NO fixture fallback on this path: omitting any
//       one of them DENIES with its exact code BEFORE any database is created, seeded or
//       read.  To adopt an authored fixture, the CALLER must name it explicitly — the
//       script never adopts it for them.
//       --kind-decisions is the caller's authored decision input for the record-kind
//       values the reviewed handoff leaves explicitly UNRESOLVED (never inferred here).
//       --business-semantics is the caller's CLOSED, SOURCE-BOUND confirmation of the
//       admitted amount column's business meaning.  Only NET_SALES_REVENUE authorizes the
//       net-revenue operation; an unresolved meaning, an incompatible meaning, a different
//       subject or a stale source revision all deny — and a free-text business meaning
//       RECORDED in the proposal interview that disagrees with the closed confirmation is
//       preserved as an unresolved/contradictory condition and denies pending
//       clarification.  Nothing interprets arbitrary prose as semantic authorization.
//       --source-revision is the caller's explicit assertion of WHICH source revision the
//       supplied bytes are (there is no default: stale knowledge is refused by name).
//       Without --pglite the journey runs against a clearly-labelled synthetic adapter;
//       with it, against a real in-process PGlite supplied by the caller.
//   node scripts/run-unfamiliar-schema-metric-journey.mjs --negative
//       execute the bounded negative gates and print their exact rejection codes.  This
//       mode constructs its own authored gate inputs; it is a gate SELF-TEST, never a
//       caller confirmation, and it adopts no fixture on the caller path.
//
// This CLI writes NOTHING: it prints a JSON receipt to stdout, opens no socket, sends no
// SQL of its own, mutates no public state and grants no execution authority beyond one
// local read-only synthetic execution.  The separately owned PAN452 common task handle is
// NOT integrated here.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  buildMetricHandoff,
  createListAnswerSource,
  runUnfamiliarSchemaProposalEntryPoint,
} from '../services/bi-control/src/business-bi/unfamiliar-schema-proposal.mjs';
import {
  UNFAMILIAR_JOURNEY_EXPECTED,
  buildUnfamiliarSyntheticDatabase,
  requireJourneyCallerBindings,
  runUnfamiliarMetricJourney,
} from '../services/bi-control/src/business-bi/net-revenue-unfamiliar-composition.mjs';
import { buildPgliteJourneyDatabase } from '../services/bi-control/src/business-bi/net-revenue-journey.mjs';

const FD = 'tests/fixtures/business-bi/ks246-unfamiliar-schema';
const METADATA_PATH = `${FD}/metadata-v1.json`;
const AGGREGATE_PATH = `${FD}/aggregate-profile-v1.json`;
const SOURCE_PATH = `${FD}/source-pay-feed-v1.json`;
const KIND_DECISIONS_PATH = `${FD}/kind-decisions-v1.json`;
const BUSINESS_SEMANTICS_PATH = `${FD}/business-semantics-v1.json`;
const CONTRACT_PATH = 'contracts/business-bi/v1/net-revenue.metric.json';
const ORACLE_PATH = 'tests/fixtures/business-bi/net-revenue-oracle-v1.json';
const SOURCE_REVISION = 'synthetic-unfamiliar-source-v1';

const args = process.argv.slice(2);
const optionOf = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1] ?? null;
};

const metadataBytes = readFileSync(METADATA_PATH);
const aggregateBytes = readFileSync(AGGREGATE_PATH);
const sourceBytes = readFileSync(optionOf('--source') ?? SOURCE_PATH);
const metricContractBytes = readFileSync(CONTRACT_PATH);
const oracleBytes = readFileSync(ORACLE_PATH);

// The caller's OWN options.  Nothing is defaulted here: a missing option stays missing.
const answersPath = optionOf('--answers');
const kindDecisionsPath = optionOf('--kind-decisions');
const businessSemanticsPath = optionOf('--business-semantics');
const sourceRevisionOption = optionOf('--source-revision');
const goalOption = optionOf('--goal');

// The caller inputs that must be supplied BEFORE any database work happens.  Kept in one
// place so the pre-database refusal below and the journey's own guard agree exactly.
const PRE_DATABASE_DENIALS = new Set([
  'KS246_JOURNEY_DENIED:MISSING_KIND_DECISION_INPUT',
  'KS246_JOURNEY_DENIED:MISSING_BUSINESS_SEMANTIC_CONFIRMATION',
  'KS246_JOURNEY_DENIED:MISSING_SOURCE_REVISION_BINDING',
]);

const AUTHORITY = Object.freeze({
  localSyntheticReadOnly: true,
  mutationAuthority: false,
  publicWrites: false,
});

function proposalFor(lines) {
  return runUnfamiliarSchemaProposalEntryPoint({
    metadataBytes,
    aggregateBytes,
    answerSource: lines === undefined ? undefined : createListAnswerSource(lines),
  });
}

const CONFIRMED_ANSWERS = Object.freeze([
  'synth_x.pay_feed.pf_id', // grain
  'synth_x.pay_feed.val_dt', // period
  'MINOR_UNITS', // released arithmetic unit
  'synth_x.pay_feed.amt_a', // metric amount column
  'EUR', // released currency
  'R', // credit value
  'V', // cancel value
]);

function answersFrom(pathname) {
  if (pathname === null) return undefined;
  return readFileSync(pathname, 'utf8').split('\n');
}

async function makeDatabase() {
  const pglitePath = optionOf('--pglite');
  if (pglitePath === null) return buildUnfamiliarSyntheticDatabase();
  if (!path.isAbsolute(pglitePath)) {
    throw new Error('KS246_CLI_PGLITE_PATH_DENIED: --pglite must be an absolute path');
  }
  const { PGlite } = await import(pathToFileURL(pglitePath).href);
  return buildPgliteJourneyDatabase(new PGlite());
}

function mutatedJson(bytes, mutate) {
  const copy = JSON.parse(bytes.toString('utf8'));
  mutate(copy);
  return Buffer.from(JSON.stringify(copy), 'utf8');
}

// Every gate below reports the EXACT intended rejection: a thrown code, or a fail-closed
// execution receipt for the cases the released core refuses as a receipt rather than an
// exception.  An unexpected acceptance is reported as such and never hidden.
function recordSync(codes, label, run) {
  try { const out = run(); codes.push(`${label}=UNEXPECTEDLY_ACCEPTED:${JSON.stringify(out?.acceptance ?? out ?? null)}`); }
  catch (error) { codes.push(`${label}=${error.code ?? String(error.message ?? error)}`); }
}

async function recordAsync(codes, label, run) {
  try {
    const out = await run();
    const state = out?.acceptance?.executionState ?? 'ACCEPTED';
    codes.push(state === 'COMPLETE'
      ? `${label}=UNEXPECTEDLY_ACCEPTED`
      : `${label}=${out?.acceptance?.denialReasonCode ?? state}`);
  } catch (error) {
    codes.push(`${label}=${error.code ?? String(error.message ?? error)}`);
  }
}

// The proposal interview is positional: the seven required role answers, then the
// non-blocking relationship/name/meaning questions.  The admitted amount column's
// MISSING_DEFINITION question is the 13th (index 12).
function answersWithAmountMeaning(meaning) {
  return [
    ...CONFIRMED_ANSWERS,
    'none', // fanout
    'none', // misleading name
    'none', // definition: synth_x.pay_adj.adj_amt
    'none', // definition: synth_x.pay_adj.pf_id
    'none', // definition: synth_x.pay_adj.posted_ts
    meaning, // definition: synth_x.pay_feed.amt_a
  ];
}

async function runNegative() {
  const codes = [];
  const confirmed = proposalFor(CONFIRMED_ANSWERS);

  // THIS SCRIPT'S OWN authored gate-construction inputs.  They are NOT caller
  // confirmation: they exist only to build the exact contradicting cases each gate must
  // refuse, and they are never used on the caller path below.
  const fixtureKindDecisions = readFileSync(KIND_DECISIONS_PATH);
  const fixtureBusinessSemantics = readFileSync(BUSINESS_SEMANTICS_PATH);
  const negativeJourney = (proposal, options = {}) => runUnfamiliarMetricJourney({
    proposal,
    sourceBytes,
    kindDecisionBytes: fixtureKindDecisions,
    businessSemanticBytes: fixtureBusinessSemantics,
    metricContractBytes,
    oracleBytes,
    database: buildUnfamiliarSyntheticDatabase(),
    sourceRevision: SOURCE_REVISION,
    authority: AUTHORITY,
    ...options,
  });
  const mutatedDecisions = (mutate) => mutatedJson(fixtureKindDecisions, mutate);
  const mutatedSemantics = (mutate) => mutatedJson(fixtureBusinessSemantics, mutate);

  // AC03 handoff gates (the reviewed proposal surface does the refusing).
  const eof = proposalFor(undefined);
  recordSync(codes, 'eof-handoff', () => buildMetricHandoff({
    proposal: eof, metricContractBytes,
  }));
  const partial = proposalFor(['synth_x.pay_feed.pf_id']);
  recordSync(codes, 'unconfirmed-proposal', () => buildMetricHandoff({
    proposal: partial, metricContractBytes,
  }));
  const baseUnits = proposalFor(['synth_x.pay_feed.pf_id', 'synth_x.pay_feed.val_dt', 'BASE_UNITS',
    'synth_x.pay_feed.amt_a', 'EUR', 'R', 'V']);
  recordSync(codes, 'unsupported-units', () => buildMetricHandoff({
    proposal: baseUnits, metricContractBytes,
  }));
  const chf = proposalFor(['synth_x.pay_feed.pf_id', 'synth_x.pay_feed.val_dt', 'MINOR_UNITS',
    'synth_x.pay_feed.amt_a', 'CHF', 'R', 'V']);
  recordSync(codes, 'unsupported-currency', () => buildMetricHandoff({
    proposal: chf, metricContractBytes,
  }));

  // Caller-input completeness gates (refused BEFORE any database work).
  await recordAsync(codes, 'missing-kind-decision-input', () => negativeJourney(confirmed, {
    kindDecisionBytes: undefined,
  }));
  await recordAsync(codes, 'missing-business-semantic-confirmation', () => negativeJourney(confirmed, {
    businessSemanticBytes: undefined,
  }));
  await recordAsync(codes, 'missing-source-revision-binding', () => negativeJourney(confirmed, {
    sourceRevision: '',
  }));

  // Journey gates.
  await recordAsync(codes, 'missing-authority', () => negativeJourney(confirmed, {
    authority: { localSyntheticReadOnly: true, mutationAuthority: true, publicWrites: false },
  }));
  await recordAsync(codes, 'incompatible-semantic-goal', () => negativeJourney(confirmed, {
    semanticGoal: 'GROSS_MARGIN',
  }));
  await recordAsync(codes, 'stale-source-revision', () => negativeJourney(confirmed, {
    sourceRevision: 'synthetic-unfamiliar-v1',
  }));
  await recordAsync(codes, 'missing-kind-decision', () => negativeJourney(confirmed, {
    kindDecisionBytes: mutatedDecisions((d) => { delete d.decisions.P; }),
  }));
  await recordAsync(codes, 'kind-decision-conflict', () => negativeJourney(confirmed, {
    kindDecisionBytes: mutatedDecisions((d) => { d.decisions.R = 'sale'; }),
  }));
  await recordAsync(codes, 'unsupported-kind', () => negativeJourney(confirmed, {
    kindDecisionBytes: mutatedDecisions((d) => { d.decisions.P = 'refund'; }),
  }));

  // Business-meaning gates: closed, source-bound confirmation of the admitted amount.
  await recordAsync(codes, 'incompatible-amount-business-meaning', () => negativeJourney(confirmed, {
    businessSemanticBytes: mutatedSemantics((b) => { b.confirmedMeaning = 'NOT_NET_SALES_REVENUE'; }),
  }));
  await recordAsync(codes, 'unresolved-amount-business-meaning', () => negativeJourney(confirmed, {
    businessSemanticBytes: mutatedSemantics((b) => { b.confirmedMeaning = 'UNRESOLVED'; }),
  }));
  await recordAsync(codes, 'business-meaning-subject-mismatch', () => negativeJourney(confirmed, {
    businessSemanticBytes: mutatedSemantics((b) => { b.subject = 'synth_x.pay_feed.amt_b'; }),
  }));
  await recordAsync(codes, 'stale-business-semantics-revision', () => negativeJourney(confirmed, {
    businessSemanticBytes: mutatedSemantics((b) => { b.sourceRevision = 'synthetic-unfamiliar-v1'; }),
  }));
  await recordAsync(codes, 'unknown-amount-business-meaning-token', () => negativeJourney(confirmed, {
    businessSemanticBytes: mutatedSemantics((b) => { b.confirmedMeaning = 'SHAREHOLDER_EQUITY'; }),
  }));
  // A free-text business meaning RECORDED in the proposal interview is never reconciled by
  // interpretation: an incompatible or explicitly unresolved record denies.
  const mismatched = proposalFor(answersWithAmountMeaning('warehouse inventory replacement cost; not sales revenue'));
  await recordAsync(codes, 'recorded-incompatible-amount-meaning', () => negativeJourney(mismatched));
  const unresolvedMeaning = proposalFor(answersWithAmountMeaning('UNRESOLVED'));
  await recordAsync(codes, 'recorded-unresolved-amount-meaning', () => negativeJourney(unresolvedMeaning));

  const wrongField = proposalFor(['synth_x.pay_feed.pf_id', 'synth_x.pay_feed.val_dt', 'MINOR_UNITS',
    'synth_x.pay_feed.amt_b', 'EUR', 'R', 'V']);
  await recordAsync(codes, 'wrong-field-binding', () => negativeJourney(wrongField));
  await recordAsync(codes, 'resealed-source-substitution', () => negativeJourney(confirmed, {
    sourceBytes: mutatedJson(sourceBytes, (s) => { s.rows[0].amt_a = 999999; }),
  }));
  await recordAsync(codes, 'substituted-database-rows', () => {
    const database = buildUnfamiliarSyntheticDatabase();
    database.query = async () => ({ rows: [{
      pf_id: 's-001', val_dt: '2026-06-01', ev_typ: 'P', amt_a: 999999, ccy: 'EUR',
    }] });
    return negativeJourney(confirmed, { database });
  });
  await recordAsync(codes, 'ambiguous-date-role', () => negativeJourney(confirmed, {
    sourceBytes: mutatedJson(sourceBytes, (s) => {
      s.columns.find((column) => column.name === 'note').dataType = 'timestamp';
    }),
  }));
  await recordAsync(codes, 'unclassified-source-column', () => negativeJourney(confirmed, {
    sourceBytes: mutatedJson(sourceBytes, (s) => {
      s.columns.push({ name: 'extra', dataType: 'text', nullable: true, declaredMeaning: null });
      for (const row of s.rows) row.extra = null;
    }),
  }));
  await recordAsync(codes, 'unsupported-source-access-mode', () => negativeJourney(confirmed, {
    sourceBytes: mutatedJson(sourceBytes, (s) => { s.accessMode = 'FULL_ROW_ACCESS'; }),
  }));
  await recordAsync(codes, 'source-sql-authority', () => negativeJourney(confirmed, {
    sourceBytes: mutatedJson(sourceBytes, (s) => { s.sql = 'select * from synth_x.pay_feed'; }),
  }));

  return {
    entryPoint: 'run-unfamiliar-schema-metric-journey',
    mode: 'negative',
    codes,
  };
}

if (args.includes('--negative')) {
  process.stdout.write(`${JSON.stringify(await runNegative(), null, 2)}\n`);
} else {
  const proposal = proposalFor(answersFrom(answersPath));
  const summary = {
    entryPoint: 'run-unfamiliar-schema-metric-journey',
    mode: answersPath === null ? 'eof' : 'answers',
    proposal: {
      status: proposal.metricCandidate.status,
      coherent: proposal.metricCandidate.coherent,
      confirmedCount: proposal.clarification.confirmedCount,
      blockingConfirmed: proposal.clarification.blockingConfirmed,
      grain: proposal.metricCandidate.grain.selected,
      period: proposal.metricCandidate.period.selected,
      amountColumn: proposal.metricCandidate.units.amountColumn,
      unitScale: proposal.metricCandidate.units.selected,
      currency: proposal.metricCandidate.currency.selected,
      recordKindMapping: proposal.metricCandidate.recordKind.mapping,
    },
    expectedResult: UNFAMILIAR_JOURNEY_EXPECTED,
    // The PAN452 common task contract is separately Qwen-owned and NOT accepted; this CLI
    // neither designs nor stubs its handles.
    sharedTaskHandle: 'NOT_INTEGRATED',
    ac05: 'PARENT_OWNED_OPEN',
  };

  // A denial is REPORTED (exit 0), like the --negative gates: the code is the evidence.
  const denial = (kind, error) => ({ kind, code: error.code ?? null, message: String(error.message ?? error) });

  if (proposal.metricCandidate.status !== 'CONFIRMED') {
    try {
      buildMetricHandoff({ proposal, metricContractBytes });
      summary.handoffDenial = { kind: 'handoff', code: null, message: 'handoff unexpectedly accepted' };
    } catch (error) {
      summary.handoffDenial = denial('handoff', error);
    }
    summary.executed = false;
    summary.note = 'The proposal is not caller-confirmed, so nothing is compiled or executed.';
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    let journey = null;
    try {
      // The caller's OWN inputs — never defaulted, never substituted with a fixture.
      const callerKindDecisionBytes = kindDecisionsPath === null ? undefined : readFileSync(kindDecisionsPath);
      const callerBusinessSemanticBytes = businessSemanticsPath === null ? undefined : readFileSync(businessSemanticsPath);
      // Refuses BEFORE makeDatabase(): a missing caller input must not create, seed or read
      // any database.
      requireJourneyCallerBindings({
        kindDecisionBytes: callerKindDecisionBytes,
        businessSemanticBytes: callerBusinessSemanticBytes,
        sourceRevision: sourceRevisionOption,
      });
      journey = await runUnfamiliarMetricJourney({
        proposal,
        sourceBytes,
        kindDecisionBytes: callerKindDecisionBytes,
        businessSemanticBytes: callerBusinessSemanticBytes,
        metricContractBytes,
        oracleBytes,
        database: await makeDatabase(),
        sourceRevision: sourceRevisionOption,
        authority: AUTHORITY,
        ...(goalOption === null ? {} : { semanticGoal: goalOption }),
      });
    } catch (error) {
      summary.journeyDenial = denial('journey', error);
      summary.executed = false;
      summary.note = PRE_DATABASE_DENIALS.has(error?.code)
        ? 'A required caller input is missing; the journey refused before creating, seeding or reading any database.'
        : 'The binding refused the journey; nothing was executed.';
    }
    if (journey === null) {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    } else {
      summary.sourceMode = journey.sourceMode;
      summary.executed = journey.executed;
      summary.sourceRevision = journey.binding.sourceRevision;
      summary.proposalDiscoveryRevision = journey.binding.proposalDiscoveryRevision;
      summary.revisionBinding = journey.binding.revisionBinding;
      summary.kindMapping = journey.binding.kindMapping;
      summary.amountBusinessMeaning = journey.binding.amountBusinessMeaning;
      summary.amountBusinessMeaningSha256 = journey.binding.amountBusinessMeaningSha256;
      summary.residualKindValues = Object.keys(journey.binding.kindMapping)
        .filter((value) => !['credit', 'cancel'].includes(journey.binding.kindMapping[value]))
        .sort();
      summary.sourceSha256 = journey.binding.sourceSha256;
      summary.canonicalHoldoutSha256 = journey.binding.canonicalHoldoutSha256;
      summary.bindingSha256 = journey.binding.bindingSha256;
      summary.planSha256 = journey.planSha256;
      summary.receiptSha256 = journey.receiptSha256;
      summary.resultSha256 = journey.resultSha256;
      summary.acceptance = journey.acceptance;
      summary.authority = journey.authority;
      summary.disclosures = journey.disclosures;
      summary.nonclaims = journey.nonclaims;
      summary.journeySha256 = journey.journeySha256;
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    }
  }
}
