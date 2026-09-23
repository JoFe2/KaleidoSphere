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
//       --kind-decisions <file> --source-revision <rev> [--source <path>] \
//       [--pglite <absolute dist/index.js path>] [--goal <name>]
//       one answer per line, in the printed interview order; 'none' refuses a question.
//       --kind-decisions is the caller's authored decision input for the record-kind
//       values the reviewed handoff leaves explicitly UNRESOLVED (never inferred here).
//       --source-revision is the caller's explicit assertion of WHICH source revision the
//       supplied bytes are (there is no default: stale knowledge is refused by name).
//       Without --pglite the journey runs against a clearly-labelled synthetic adapter;
//       with it, against a real in-process PGlite supplied by the caller.
//   node scripts/run-unfamiliar-schema-metric-journey.mjs --negative
//       execute the bounded negative gates and print their exact rejection codes.
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
  runUnfamiliarMetricJourney,
} from '../services/bi-control/src/business-bi/net-revenue-unfamiliar-composition.mjs';
import { buildPgliteJourneyDatabase } from '../services/bi-control/src/business-bi/net-revenue-journey.mjs';

const FD = 'tests/fixtures/business-bi/ks246-unfamiliar-schema';
const METADATA_PATH = `${FD}/metadata-v1.json`;
const AGGREGATE_PATH = `${FD}/aggregate-profile-v1.json`;
const SOURCE_PATH = `${FD}/source-pay-feed-v1.json`;
const KIND_DECISIONS_PATH = `${FD}/kind-decisions-v1.json`;
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
const kindDecisionBytes = optionOf('--kind-decisions') === null
  ? readFileSync(KIND_DECISIONS_PATH)
  : readFileSync(optionOf('--kind-decisions'));
const metricContractBytes = readFileSync(CONTRACT_PATH);
const oracleBytes = readFileSync(ORACLE_PATH);

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

async function journeyFor(proposal, options = {}) {
  return runUnfamiliarMetricJourney({
    proposal,
    sourceBytes: options.sourceBytes ?? sourceBytes,
    kindDecisionBytes: options.kindDecisionBytes ?? kindDecisionBytes,
    metricContractBytes,
    oracleBytes,
    database: options.database ?? await makeDatabase(),
    sourceRevision: options.sourceRevision ?? SOURCE_REVISION,
    authority: options.authority ?? AUTHORITY,
    ...(options.semanticGoal === undefined ? {} : { semanticGoal: options.semanticGoal }),
  });
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

function mutated(source, mutate) {
  const copy = JSON.parse(source.toString('utf8'));
  mutate(copy);
  return Buffer.from(JSON.stringify(copy), 'utf8');
}

function mutatedDecisions(mutate) {
  const copy = JSON.parse(kindDecisionBytes.toString('utf8'));
  mutate(copy);
  return Buffer.from(JSON.stringify(copy), 'utf8');
}

async function runNegative() {
  const codes = [];
  const confirmed = proposalFor(CONFIRMED_ANSWERS);

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

  // Journey gates.
  await recordAsync(codes, 'missing-authority', () => journeyFor(confirmed, {
    authority: { localSyntheticReadOnly: true, mutationAuthority: true, publicWrites: false },
  }));
  await recordAsync(codes, 'incompatible-semantic-goal', () => journeyFor(confirmed, {
    semanticGoal: 'GROSS_MARGIN',
  }));
  await recordAsync(codes, 'stale-source-revision', () => journeyFor(confirmed, {
    sourceRevision: 'synthetic-unfamiliar-v1',
  }));
  await recordAsync(codes, 'missing-kind-decision', () => journeyFor(confirmed, {
    kindDecisionBytes: mutatedDecisions((d) => { delete d.decisions.P; }),
  }));
  await recordAsync(codes, 'kind-decision-conflict', () => journeyFor(confirmed, {
    kindDecisionBytes: mutatedDecisions((d) => { d.decisions.R = 'sale'; }),
  }));
  await recordAsync(codes, 'unsupported-kind', () => journeyFor(confirmed, {
    kindDecisionBytes: mutatedDecisions((d) => { d.decisions.P = 'refund'; }),
  }));
  const wrongField = proposalFor(['synth_x.pay_feed.pf_id', 'synth_x.pay_feed.val_dt', 'MINOR_UNITS',
    'synth_x.pay_feed.amt_b', 'EUR', 'R', 'V']);
  await recordAsync(codes, 'wrong-field-binding', () => journeyFor(wrongField));
  await recordAsync(codes, 'resealed-source-substitution', () => journeyFor(confirmed, {
    sourceBytes: mutated(sourceBytes, (s) => { s.rows[0].amt_a = 999999; }),
  }));
  await recordAsync(codes, 'substituted-database-rows', async () => {
    const database = buildUnfamiliarSyntheticDatabase();
    database.query = async () => ({ rows: [{
      pf_id: 's-001', val_dt: '2026-06-01', ev_typ: 'P', amt_a: 999999, ccy: 'EUR',
    }] });
    return journeyFor(confirmed, { database });
  });
  await recordAsync(codes, 'ambiguous-date-role', () => journeyFor(confirmed, {
    sourceBytes: mutated(sourceBytes, (s) => {
      s.columns.find((column) => column.name === 'note').dataType = 'timestamp';
    }),
  }));
  await recordAsync(codes, 'unclassified-source-column', () => journeyFor(confirmed, {
    sourceBytes: mutated(sourceBytes, (s) => {
      s.columns.push({ name: 'extra', dataType: 'text', nullable: true, declaredMeaning: null });
      for (const row of s.rows) row.extra = null;
    }),
  }));
  await recordAsync(codes, 'unsupported-source-access-mode', () => journeyFor(confirmed, {
    sourceBytes: mutated(sourceBytes, (s) => { s.accessMode = 'FULL_ROW_ACCESS'; }),
  }));
  await recordAsync(codes, 'source-sql-authority', () => journeyFor(confirmed, {
    sourceBytes: mutated(sourceBytes, (s) => { s.sql = 'select * from synth_x.pay_feed'; }),
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
  const answersPath = optionOf('--answers');
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
      journey = await journeyFor(proposal, {
        ...(optionOf('--source-revision') === null ? {} : { sourceRevision: optionOf('--source-revision') }),
        ...(optionOf('--goal') === null ? {} : { semanticGoal: optionOf('--goal') }),
      });
    } catch (error) {
      summary.journeyDenial = denial('journey', error);
      summary.executed = false;
      summary.note = 'The binding refused the journey; nothing was executed.';
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
