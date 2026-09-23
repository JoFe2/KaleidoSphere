// KS246 (KS-EVO-01-AC03/AC04) — focused verification for the LOCAL composition that takes
// a CALLER-CONFIRMED unfamiliar-schema proposal to the EXISTING metric/mapping compiler and
// an ACTUAL local synthetic database execution of the released net-revenue core.
//
//   AC03 — the accepted proposal is BOUND to the source revision, the caller's decisions and
//          the released contract digest, and handed to the existing entry point.
//   AC04 — one supported positive example EXECUTES (a real local synthetic database read
//          through the released confined SELECT, mapped by the admitted layout profile, and
//          evaluated by the released core) with an independently specified expected numeric
//          result, plus exact missing / contradictory / denied information negatives.  No
//          arbitrary SQL authority, no implicit approval and no inferred order revenue.
//
// Every expected value below is derived INDEPENDENTLY of the composition module: the periods
// come from the released metric contract, the record-kind semantics from the caller's authored
// decision input, and the arithmetic is the test's own loop over the frozen source fixture.
// A known authored synthetic case is a local proof, not a measured blind result.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  createListAnswerSource,
  runUnfamiliarSchemaProposalEntryPoint,
} from '../services/bi-control/src/business-bi/unfamiliar-schema-proposal.mjs';
import {
  ADMITTED_AMOUNT_BUSINESS_MEANING,
  UNFAMILIAR_AMOUNT_BUSINESS_MEANINGS,
  UNFAMILIAR_JOURNEY_EXPECTED,
  UNFAMILIAR_LAYOUT_PROFILE,
  UNFAMILIAR_SOURCE_SELECT,
  bindUnfamiliarMetricJourney,
  buildUnfamiliarMetricRead,
  buildUnfamiliarSyntheticDatabase,
  loadBusinessSemanticConfirmation,
  loadKindDecisions,
  loadUnfamiliarSource,
  mapUnfamiliarRowsToCanonical,
  readUnfamiliarSourceRows,
  requireJourneyCallerBindings,
  runUnfamiliarMetricJourney,
  seedUnfamiliarDatabase,
} from '../services/bi-control/src/business-bi/net-revenue-unfamiliar-composition.mjs';
import {
  compileNetRevenuePlan,
  createNetRevenueOperationRequest,
  executeNetRevenuePlan,
  verifyNetRevenueExecutionReceipt,
} from '../services/bi-control/src/business-bi/net-revenue-plan.mjs';

const ROOT = process.cwd();
const FD = 'tests/fixtures/business-bi/ks246-unfamiliar-schema';
const METADATA_PATH = `${FD}/metadata-v1.json`;
const AGGREGATE_PATH = `${FD}/aggregate-profile-v1.json`;
const SOURCE_PATH = `${FD}/source-pay-feed-v1.json`;
const KIND_DECISIONS_PATH = `${FD}/kind-decisions-v1.json`;
const BUSINESS_SEMANTICS_PATH = `${FD}/business-semantics-v1.json`;
const CONTRACT_PATH = 'contracts/business-bi/v1/net-revenue.metric.json';
const ORACLE_PATH = 'tests/fixtures/business-bi/net-revenue-oracle-v1.json';
const MODULE_PATH = 'services/bi-control/src/business-bi/net-revenue-unfamiliar-composition.mjs';
const CLI_PATH = 'scripts/run-unfamiliar-schema-metric-journey.mjs';
const SOURCE_REVISION = 'synthetic-unfamiliar-source-v1';

const metadataBytes = readFileSync(METADATA_PATH);
const aggregateBytes = readFileSync(AGGREGATE_PATH);
const sourceBytes = readFileSync(SOURCE_PATH);
const kindDecisionBytes = readFileSync(KIND_DECISIONS_PATH);
const businessSemanticBytes = readFileSync(BUSINESS_SEMANTICS_PATH);
const contractBytes = readFileSync(CONTRACT_PATH);
const oracleBytes = readFileSync(ORACLE_PATH);
const oracle = JSON.parse(oracleBytes.toString('utf8'));
const sourceFixture = JSON.parse(sourceBytes.toString('utf8'));
const decisionsFixture = JSON.parse(kindDecisionBytes.toString('utf8'));

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const clone = (value) => JSON.parse(JSON.stringify(value));
const AUTHORITY = Object.freeze({
  localSyntheticReadOnly: true, mutationAuthority: false, publicWrites: false,
});

// The interview order is deterministic: the required metric roles first, then the record-kind
// semantics.  Answers are supplied as a caller would supply them; nothing is a default.
const CONFIRMED_ANSWERS = Object.freeze([
  'synth_x.pay_feed.pf_id', // grain
  'synth_x.pay_feed.val_dt', // period
  'MINOR_UNITS', // released arithmetic unit
  'synth_x.pay_feed.amt_a', // metric amount column
  'EUR', // released currency
  'R', // credit value
  'V', // cancel value
]);

function proposalFor(lines, { metadata = metadataBytes, aggregates = aggregateBytes } = {}) {
  return runUnfamiliarSchemaProposalEntryPoint({
    metadataBytes: metadata,
    aggregateBytes: aggregates,
    answerSource: lines === undefined ? undefined : createListAnswerSource(lines),
  });
}

const proposal = proposalFor(CONFIRMED_ANSWERS);

function journeyInput(overrides = {}) {
  return {
    proposal,
    sourceBytes,
    kindDecisionBytes,
    businessSemanticBytes,
    metricContractBytes: contractBytes,
    oracleBytes,
    database: buildUnfamiliarSyntheticDatabase(),
    sourceRevision: SOURCE_REVISION,
    authority: AUTHORITY,
    ...overrides,
  };
}

const runJourney = (overrides) => runUnfamiliarMetricJourney(journeyInput(overrides));

function mutateSource(mutate) {
  const copy = clone(sourceFixture);
  mutate(copy);
  return Buffer.from(JSON.stringify(copy), 'utf8');
}

function mutateDecisions(mutate) {
  const copy = clone(decisionsFixture);
  mutate(copy);
  return Buffer.from(JSON.stringify(copy), 'utf8');
}

const businessSemanticsFixture = JSON.parse(businessSemanticBytes.toString('utf8'));

function mutateSemantics(mutate) {
  const copy = clone(businessSemanticsFixture);
  mutate(copy);
  return Buffer.from(JSON.stringify(copy), 'utf8');
}

// The admitted amount column's MISSING_DEFINITION question is the 13th interview position
// (the seven required role answers, then fanout, misleading name and four definitions before
// it).  This mirrors exactly what a caller would type on the CLI.
function answersWithAmountMeaning(meaning) {
  return [...CONFIRMED_ANSWERS, 'none', 'none', 'none', 'none', 'none', meaning];
}

// The caller's own required inputs for this journey.  They are never defaulted: omitting one
// of them must deny before any database is created.
const CALLER_ARGS = Object.freeze([
  '--kind-decisions', KIND_DECISIONS_PATH,
  '--business-semantics', BUSINESS_SEMANTICS_PATH,
  '--source-revision', SOURCE_REVISION,
]);

async function denialOf(run) {
  try {
    const outcome = await run();
    return outcome?.acceptance?.denialReasonCode ?? 'ACCEPTED';
  } catch (error) {
    return error.code ?? String(error.message ?? error);
  }
}

// ---------------------------------------------------------------------------------
// An INDEPENDENT expected numeric result: the test's own arithmetic over the frozen source
// fixture, using the released contract's period windows and the caller's authored decisions.
// ---------------------------------------------------------------------------------
function independentExpectedResult() {
  const contract = JSON.parse(contractBytes.toString('utf8'));
  const current = contract.periods.current;
  const comparison = contract.periods.comparison;
  const kindOf = (value) => decisionsFixture.decisions[value];
  const totals = {
    current: { net: 0 }, comparison: { net: 0 },
  };
  for (const row of sourceFixture.rows) {
    const kind = kindOf(row.ev_typ);
    const amount = row.amt_a;
    for (const [key, window] of [['current', current], ['comparison', comparison]]) {
      const inWindow = row.val_dt !== null && row.val_dt >= window.start && row.val_dt <= window.end;
      if (!inWindow) continue;
      if (kind === 'sale' && Number.isInteger(amount)) totals[key].net += amount;
      if (kind === 'credit' && Number.isInteger(amount)) totals[key].net -= amount;
      // cancel contributes 0; unknown routes to the UNKNOWN channel and contributes 0.
    }
  }
  return {
    currentNetMinorUnits: totals.current.net,
    comparisonNetMinorUnits: totals.comparison.net,
    deltaMinorUnits: totals.current.net - totals.comparison.net,
  };
}

function cli(args, script = CLI_PATH) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: ROOT, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function cliWithAnswers(answers, extraArgs = [], script = CLI_PATH) {
  const scratch = mkdtempSync(join(tmpdir(), 'ks246-journey-'));
  try {
    const answersPath = join(scratch, 'answers.txt');
    writeFileSync(answersPath, `${answers.join('\n')}\n`);
    const out = cli(['--answers', answersPath, ...extraArgs], script);
    return { ...out, summary: out.stdout === '' ? null : JSON.parse(out.stdout) };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------
// AC04 — the supported positive example, executed.
// ---------------------------------------------------------------------------------
test('AC04 a caller-confirmed unfamiliar-schema proposal EXECUTES against a real local synthetic database', async () => {
  const journey = await runJourney();
  assert.equal(journey.executed, true);
  assert.equal(journey.acceptance.executionState, 'COMPLETE');
  assert.equal(journey.acceptance.denialReasonCode, null);
  assert.equal(journey.acceptance.oracleEquality, 'EXACT');
  assert.equal(journey.acceptance.reconcilesToIndependentExpectedResult, true);
  // The result is a released aggregate result, not an adapter invention.
  assert.equal(journey.result.deltaMinorUnits, 70059);
  assert.equal(journey.result.periods.current.netMinorUnits, 100059);
  assert.equal(journey.result.periods.comparison.netMinorUnits, 30000);
  assert.equal(journey.result.unknown.count, 4);
  assert.equal(journey.result.excludedOutOfScopeCount, 3);
  // The source really was read through the local database seam (17 authored rows).
  assert.equal(journey.binding.canonicalHoldoutSha256, sha256(readFileSync('tests/fixtures/business-bi/net-revenue-holdout-v1.json')));
  assert.equal(journey.sourceMode, 'SYNTHETIC_FALLBACK');
  assert.match(journey.journeySha256, /^[a-f0-9]{64}$/);
  assert.match(journey.receiptSha256, /^[a-f0-9]{64}$/);
  assert.match(journey.planSha256, /^[a-f0-9]{64}$/);
});

test('AC04 the expected numeric result is independently specified, not taken from the adapter', () => {
  const independent = independentExpectedResult();
  assert.deepEqual(independent, {
    currentNetMinorUnits: 100059, comparisonNetMinorUnits: 30000, deltaMinorUnits: 70059,
  });
  assert.deepEqual(independent, { ...UNFAMILIAR_JOURNEY_EXPECTED });
  // ... and the released independent oracle agrees on the same integers.
  assert.equal(independent.deltaMinorUnits, oracle.expected.deltaMinorUnits);
  assert.equal(independent.currentNetMinorUnits, oracle.expected.periods.current.netMinorUnits);
  assert.equal(independent.comparisonNetMinorUnits, oracle.expected.periods.comparison.netMinorUnits);
});

test('AC04 the executed receipt round-trips through the released verifier (not a bespoke shape)', async () => {
  const source = loadUnfamiliarSource(sourceBytes);
  const binding = bindUnfamiliarMetricJourney({
    proposal,
    source,
    kindDecisions: loadKindDecisions(kindDecisionBytes),
    businessSemantics: loadBusinessSemanticConfirmation(businessSemanticBytes),
    metricContractBytes: contractBytes,
    sourceRevision: SOURCE_REVISION,
  });
  const plan = compileNetRevenuePlan({
    request: createNetRevenueOperationRequest(),
    metricContractBytes: contractBytes,
    oracleBytes,
  });
  const database = buildUnfamiliarSyntheticDatabase();
  await seedUnfamiliarDatabase(database, source);
  const readBack = await readUnfamiliarSourceRows(database);
  assert.equal(readBack.length, sourceFixture.rows.length);
  const receipt = await executeNetRevenuePlan({
    plan,
    metricContractBytes: contractBytes,
    oracleBytes,
    read: buildUnfamiliarMetricRead({
      binding, database, canonicalRelation: plan.operation.source.relation,
    }),
  });
  const verified = verifyNetRevenueExecutionReceipt({
    plan, receipt, metricContractBytes: contractBytes, oracleBytes,
  });
  assert.equal(verified.execution.state, 'COMPLETE');
  assert.equal(verified.result.deltaMinorUnits, UNFAMILIAR_JOURNEY_EXPECTED.deltaMinorUnits);
});

// ---------------------------------------------------------------------------------
// AC03 — the binding: source revision, caller decisions, released contract.
// ---------------------------------------------------------------------------------
test('AC03 the journey binds source revision, caller decisions, proposal identity and the released contract digest', async () => {
  const journey = await runJourney();
  assert.equal(journey.binding.sourceRevision, SOURCE_REVISION);
  assert.equal(journey.binding.proposalDiscoveryRevision, 'synthetic-unfamiliar-v1');
  assert.equal(journey.binding.sourceSha256, sha256(sourceBytes));
  assert.equal(journey.binding.releasedContractSha256, sha256(contractBytes));
  assert.match(journey.binding.handoffSha256, /^[a-f0-9]{64}$/);
  assert.equal(journey.binding.proposalSha256, proposal.entryPointSha256);
  assert.equal(journey.binding.candidateSha256, proposal.metricCandidate.candidateSha256);
  assert.equal(journey.binding.clarificationSha256, proposal.clarification.clarificationSha256);
  assert.deepEqual(journey.binding.kindMapping, { P: 'sale', R: 'credit', U: 'unknown', V: 'cancel' });
  assert.equal(journey.authority.sharedTaskHandle, 'NOT_INTEGRATED');
  assert.equal(journey.authority.admissionAuthority, 'NONE');
  assert.equal(journey.authority.admissionConsumer, 'NOT_IMPLEMENTED');
  assert.equal(journey.authority.publicWrites, false);
  assert.equal(journey.authority.arbitrarySql, false);
});

test('AC03 the admitted profile must AGREE with the caller\'s own confirmed decisions', async () => {
  // The caller confirmed amt_b as the metric amount; the frozen layout profile binds amt_a.
  const swapped = proposalFor(['synth_x.pay_feed.pf_id', 'synth_x.pay_feed.val_dt', 'MINOR_UNITS',
    'synth_x.pay_feed.amt_b', 'EUR', 'R', 'V']);
  assert.equal(swapped.metricCandidate.status, 'CONFIRMED');
  assert.equal(await denialOf(() => runJourney({ proposal: swapped })),
    'KS246_JOURNEY_DENIED:ROLE_BINDING_NOT_CONFIRMED:amountField');
  // Positive counterpart: the agreement holds for the confirmed amount column.
  assert.equal(UNFAMILIAR_LAYOUT_PROFILE.amountField, 'amt_a');
  assert.equal(proposal.metricCandidate.units.amountColumn, 'synth_x.pay_feed.amt_a');
});

// ---------------------------------------------------------------------------------
// Provenance accuracy for the new source fixture.
// ---------------------------------------------------------------------------------
test('AC04 the discovery aggregate counts are never presented as a database read', async () => {
  const journey = await runJourney();
  const revision = journey.binding.revisionBinding;
  const aggregateFixture = JSON.parse(aggregateBytes.toString('utf8'));
  const discoveryRows = aggregateFixture.relationProfiles
    .find(({ relation }) => relation === 'synth_x.pay_feed').rowCount;
  assert.equal(discoveryRows, 12);
  assert.equal(revision.discoveryAggregateRowCount, discoveryRows);
  assert.equal(revision.executableSourceRowCount, sourceFixture.rows.length);
  assert.notEqual(revision.discoveryAggregateRowCount, revision.executableSourceRowCount);
  assert.equal(revision.countProvenance,
    'DISCOVERY_AGGREGATE_IS_AN_AUTHORED_BOUNDED_OBSERVATION_NEVER_A_DATABASE_READ');
  assert.ok(journey.disclosures.some((line) => /never produced by this executable source fixture or by the local synthetic database/.test(line)));
  assert.ok(journey.disclosures.some((line) => /decided by the caller in an authored decision input/.test(line)));
  assert.ok(journey.nonclaims.some((line) => /NOT integrated/.test(line)));
});

// ---------------------------------------------------------------------------------
// AC04 — exact missing / contradictory / denied information negatives.
// ---------------------------------------------------------------------------------
test('AC04 missing information: an undecided residual record-kind value is DENIED, never a sale', async () => {
  assert.equal(await denialOf(() => runJourney({
    kindDecisionBytes: mutateDecisions((d) => { delete d.decisions.P; }),
  })), 'KS246_JOURNEY_DENIED:MISSING_KIND_DECISION:P');
  assert.equal(await denialOf(() => runJourney({
    kindDecisionBytes: mutateDecisions((d) => { delete d.decisions.U; }),
  })), 'KS246_JOURNEY_DENIED:MISSING_KIND_DECISION:U');
  // A whole missing decision input is denied as a missing authored input.
  assert.equal(await denialOf(() => runJourney({ kindDecisionBytes: Buffer.from('{"decisions":{}}') })),
    'KS246_KIND_DECISIONS_DENIED:SHAPE');
});

test('AC04 contradictory information: a decision that contradicts the confirmed credit/cancel is DENIED', async () => {
  assert.equal(await denialOf(() => runJourney({
    kindDecisionBytes: mutateDecisions((d) => { d.decisions.R = 'sale'; }),
  })), 'KS246_JOURNEY_DENIED:KIND_DECISION_CONFLICT:credit');
  assert.equal(await denialOf(() => runJourney({
    kindDecisionBytes: mutateDecisions((d) => { d.decisions.V = 'sale'; }),
  })), 'KS246_JOURNEY_DENIED:KIND_DECISION_CONFLICT:cancel');
  assert.equal(await denialOf(() => runJourney({
    kindDecisionBytes: mutateDecisions((d) => { d.decisions.P = 'cancel'; }),
  })), 'KS246_JOURNEY_DENIED:KIND_DECISION_CONFLICT:cancel');
  assert.equal(await denialOf(() => runJourney({
    kindDecisionBytes: mutateDecisions((d) => { d.decisions.P = 'credit'; }),
  })), 'KS246_JOURNEY_DENIED:KIND_DECISION_CONFLICT:credit');
  // A decision about a value the source does not carry is contradictory too.
  assert.equal(await denialOf(() => runJourney({
    kindDecisionBytes: mutateDecisions((d) => { d.decisions.Z = 'sale'; }),
  })), 'KS246_JOURNEY_DENIED:UNKNOWN_KIND_VALUE:Z');
});

test('AC04 denied information: missing authority, an incompatible goal and unsupported kinds/units all fail closed', async () => {
  assert.equal(await denialOf(() => runJourney({
    authority: { localSyntheticReadOnly: true, mutationAuthority: true, publicWrites: false },
  })), 'KS246_JOURNEY_DENIED:MISSING_AUTHORITY');
  assert.equal(await denialOf(() => runJourney({ authority: {} })),
    'KS246_JOURNEY_DENIED:MISSING_AUTHORITY');
  assert.equal(await denialOf(() => runJourney({ semanticGoal: 'GROSS_MARGIN' })),
    'KS246_JOURNEY_DENIED:INCOMPATIBLE_SEMANTIC_GOAL');
  assert.equal(await denialOf(() => runJourney({ semanticGoal: 'ORDER_INTAKE' })),
    'KS246_JOURNEY_DENIED:INCOMPATIBLE_SEMANTIC_GOAL');
  assert.equal(await denialOf(() => runJourney({
    kindDecisionBytes: mutateDecisions((d) => { d.decisions.P = 'refund'; }),
  })), 'KS246_JOURNEY_DENIED:UNSUPPORTED_KIND:refund');
  const baseUnits = proposalFor(['synth_x.pay_feed.pf_id', 'synth_x.pay_feed.val_dt', 'BASE_UNITS',
    'synth_x.pay_feed.amt_a', 'EUR', 'R', 'V']);
  assert.equal(await denialOf(() => runJourney({ proposal: baseUnits })),
    'UNFAMILIAR_HANDOFF_DENIED:ARITHMETIC_UNIT_NOT_RELEASED');
  const chf = proposalFor(['synth_x.pay_feed.pf_id', 'synth_x.pay_feed.val_dt', 'MINOR_UNITS',
    'synth_x.pay_feed.amt_a', 'CHF', 'R', 'V']);
  assert.equal(await denialOf(() => runJourney({ proposal: chf })),
    'UNFAMILIAR_HANDOFF_DENIED:CURRENCY_NOT_RELEASED');
});

test('AC04 the actual entry point on EOF refuses to compile or execute anything', async () => {
  const eof = proposalFor(undefined);
  assert.equal(eof.metricCandidate.status, 'PROPOSED');
  assert.equal(eof.clarification.confirmedCount, 0);
  assert.equal(await denialOf(() => runJourney({ proposal: eof })),
    'UNFAMILIAR_HANDOFF_DENIED:UNCONFIRMED_QUESTIONS');
  const partial = proposalFor(['synth_x.pay_feed.pf_id']);
  assert.equal(await denialOf(() => runJourney({ proposal: partial })),
    'UNFAMILIAR_HANDOFF_DENIED:UNCONFIRMED_QUESTIONS');
  // An inconsistent proposal is refused before any execution as well.
  const inconsistent = proposalFor([
    'synth_x.pay_adj.pf_id', 'synth_x.pay_feed.val_dt', 'MINOR_UNITS', 'synth_x.pay_feed.amt_a',
    'EUR', 'R', 'V', 'NOT_A_RELATIONSHIP',
  ]);
  assert.equal(inconsistent.metricCandidate.status, 'INCONSISTENT');
  assert.equal(await denialOf(() => runJourney({ proposal: inconsistent })),
    'UNFAMILIAR_HANDOFF_DENIED:INCONSISTENT_PROPOSAL');
});

test('AC04 stale-after-load knowledge and a resealed / substituted source are refused by name', async () => {
  // Stale: the caller asserts the source is the revision the proposal was loaded against.
  assert.equal(await denialOf(() => runJourney({ sourceRevision: 'synthetic-unfamiliar-v1' })),
    'KS246_JOURNEY_DENIED:SOURCE_REVISION_STALE');
  assert.equal(await denialOf(() => runJourney({ sourceRevision: undefined })),
    'KS246_JOURNEY_DENIED:MISSING_SOURCE_REVISION_BINDING');
  assert.equal(await denialOf(() => runJourney({ sourceRevision: '' })),
    'KS246_JOURNEY_DENIED:MISSING_SOURCE_REVISION_BINDING');
  // Resealed: the source bytes were edited and handed back under the same declared revision.
  assert.equal(await denialOf(() => runJourney({
    sourceBytes: mutateSource((s) => { s.rows[0].amt_a = 999999; }),
  })), 'KS246_JOURNEY_DENIED:SOURCE_NOT_COHERENT_WITH_RELEASED_HOLDOUT');
  assert.equal(await denialOf(() => runJourney({
    sourceBytes: mutateSource((s) => { s.rows.length = 16; }),
  })), 'KS246_JOURNEY_DENIED:SOURCE_NOT_COHERENT_WITH_RELEASED_HOLDOUT');
  // Substituted database content: the bytes are right, the table is not.
  const substituting = buildUnfamiliarSyntheticDatabase();
  substituting.query = async () => ({ rows: [{
    pf_id: 's-001', val_dt: '2026-06-01', ev_typ: 'P', amt_a: 999999, ccy: 'EUR',
  }] });
  assert.equal(await denialOf(() => runJourney({ database: substituting })),
    'KS246_SOURCE_TABLE_SUBSTITUTED');
  const empty = buildUnfamiliarSyntheticDatabase();
  empty.query = async () => ({ rows: [] });
  assert.equal(await denialOf(() => runJourney({ database: empty })), 'KS246_SOURCE_ROWS_EMPTY');
});

test('AC04 ambiguous and wrong fields are refused: unclassified columns, a second date role, an out-of-namespace id', async () => {
  assert.equal(await denialOf(() => runJourney({
    sourceBytes: mutateSource((s) => {
      s.columns.push({ name: 'extra', dataType: 'text', nullable: true, declaredMeaning: null });
      for (const row of s.rows) row.extra = null;
    }),
  })), 'KS246_JOURNEY_DENIED:UNCLASSIFIED_SOURCE_COLUMN');
  assert.equal(await denialOf(() => runJourney({
    sourceBytes: mutateSource((s) => {
      s.columns.find((column) => column.name === 'note').dataType = 'timestamp';
    }),
  })), 'KS246_JOURNEY_DENIED:AMBIGUOUS_DATE_ROLE');
  assert.equal(await denialOf(() => runJourney({
    sourceBytes: mutateSource((s) => {
      s.columns = s.columns.filter((column) => column.name !== 'amt_a');
      for (const row of s.rows) delete row.amt_a;
    }),
  })), 'KS246_JOURNEY_DENIED:ROLE_COLUMN_NOT_IN_SOURCE:amt_a');
  assert.equal(await denialOf(() => runJourney({
    sourceBytes: mutateSource((s) => { s.relation = 'synth_x.other_feed'; }),
  })), 'KS246_JOURNEY_DENIED:SOURCE_RELATION_NOT_CONFIRMED');
});

test('AC04 the bounded source surface denies row-less, SQL, credential, executable and non-synthetic bytes', () => {
  const cases = [
    [mutateSource((s) => { s.rows = []; }), 'KS246_SOURCE_DENIED:ROWS'],
    [mutateSource((s) => { s.sql = 'select 1'; }), 'KS246_SOURCE_DENIED:SQL_AUTHORITY'],
    [mutateSource((s) => { s.credentials = { user: 'a' }; }), 'KS246_SOURCE_DENIED:CREDENTIALS'],
    [mutateSource((s) => { s.script = 'process.exit(0)'; }), 'KS246_SOURCE_DENIED:EXECUTABLE_PAYLOAD'],
    [mutateSource((s) => { s.classification = 'PRODUCTION_CUSTOMER_BYTES'; }), 'KS246_SOURCE_DENIED:CLASSIFICATION'],
    [mutateSource((s) => { s.accessMode = 'FULL_ROW_ACCESS'; }), 'KS246_SOURCE_DENIED:ACCESS_MODE'],
    [mutateSource((s) => { s.extra = 1; }), 'KS246_SOURCE_DENIED:SHAPE'],
    [mutateSource((s) => { s.columns[1] = { ...s.columns[1], name: 'pf_id' }; }), 'KS246_SOURCE_DENIED:DUPLICATE_COLUMN'],
    [mutateSource((s) => { s.rows[0].undeclared = 1; }), 'KS246_SOURCE_DENIED:ROW_COLUMN'],
  ];
  for (const [bytes, code] of cases) {
    assert.throws(() => loadUnfamiliarSource(bytes), (error) => error.code === code, code);
  }
  // Positive counterpart: the frozen fixture loads and carries its own identity.
  const loaded = loadUnfamiliarSource(sourceBytes);
  assert.equal(loaded.classification, 'SYNTHETIC_NON_CUSTOMER_BYTES');
  assert.equal(loaded.accessMode, 'BOUNDED_READ_ONLY');
  assert.equal(loaded.sourceRevision, SOURCE_REVISION);
  assert.equal(loaded.rows.length, 17);
  assert.equal(loaded.sourceByteSha256, sha256(sourceBytes));
});

// ---------------------------------------------------------------------------------
// SQL confinement and authority.
// ---------------------------------------------------------------------------------
test('the journey issues exactly one confined SELECT and exposes no SQL authority', async () => {
  const journeyInputKeys = Object.keys(journeyInput());
  assert.deepEqual(journeyInputKeys.sort(), [
    'authority', 'businessSemanticBytes', 'database', 'kindDecisionBytes',
    'metricContractBytes', 'oracleBytes', 'proposal', 'sourceBytes', 'sourceRevision',
  ]);
  for (const forbidden of ['sql', 'query', 'statement', 'statements']) {
    assert.equal(journeyInputKeys.includes(forbidden), false, forbidden);
  }
  assert.equal(UNFAMILIAR_SOURCE_SELECT.includes('synth_x.pay_feed'), true);
  assert.equal(UNFAMILIAR_SOURCE_SELECT.trim().startsWith('SELECT'), true);
  assert.equal(/;/.test(UNFAMILIAR_SOURCE_SELECT), false);
  for (const nonRole of UNFAMILIAR_LAYOUT_PROFILE.droppedOnRead) {
    assert.equal(new RegExp(`\\b${nonRole}\\b`).test(UNFAMILIAR_SOURCE_SELECT), false,
      `${nonRole} must not be selected`);
  }
  // No write, network or publish surface in the composition or the CLI.
  for (const file of [MODULE_PATH, CLI_PATH]) {
    const text = await readFile(file, 'utf8');
    assert.doesNotMatch(text, /writeFileSync|createWriteStream|node:net|node:http|fetch\(/, file);
  }
  // The read-only database is denied a write through the released read-only evidence rule.
  const database = buildUnfamiliarSyntheticDatabase(sourceFixture.rows);
  await database.exec('SET default_transaction_read_only = on');
  await assert.rejects(() => database.query('UPDATE synth_x.pay_feed SET amt_a = 1'),
    (error) => error.code === '25006');
});

test('the composition reuses the released core instead of re-declaring its arithmetic', async () => {
  const source = await readFile(MODULE_PATH, 'utf8');
  assert.match(source, /compileNetRevenuePlan/);
  assert.match(source, /executeNetRevenuePlan/);
  assert.match(source, /verifyNetRevenueExecutionReceipt/);
  assert.match(source, /serializeHoldout/);
  assert.match(source, /buildMetricHandoff/);
  assert.match(source, /ADMITTED_HOLDOUT_SHA256/);
  assert.doesNotMatch(source, /minorUnitsPerMajorUnit\s*=\s*100/);
  assert.doesNotMatch(source, /\bCM_[A-Z0-9_]+\b/);
  assert.doesNotMatch(source, /chimpmaera\.(?:bi|db)\//);
  // The confined SELECT is the only place the layout relation is named.
  const relations = source.match(/synth_x\.pay_feed/g) ?? [];
  assert.equal(relations.length >= 2, true);
});

test('no full AC03/AC04 closure and no PAN452 handling are claimed', async () => {
  const journey = await runJourney();
  assert.equal(journey.authority.sharedTaskHandle, 'NOT_INTEGRATED');
  assert.equal(journey.authority.executionAuthority, 'LOCAL_SYNTHETIC_READ_ONLY');
  assert.equal(journey.authority.admissionAuthority, 'NONE');
  for (const file of [MODULE_PATH, CLI_PATH]) {
    const text = await readFile(file, 'utf8');
    assert.doesNotMatch(text, /sharedTaskHandle:\s*'(?!NOT_INTEGRATED)/, file);
    assert.doesNotMatch(text, /AC05[^\n]*COMPLETE/, file);
    assert.match(text, /NOT_INTEGRATED/);
  }
  // The proposal handoff itself still refuses to claim admission or execution.
  const handoff = bindUnfamiliarMetricJourney({
    proposal,
    source: loadUnfamiliarSource(sourceBytes),
    kindDecisions: loadKindDecisions(kindDecisionBytes),
    businessSemantics: loadBusinessSemanticConfirmation(businessSemanticBytes),
    metricContractBytes: contractBytes,
    sourceRevision: SOURCE_REVISION,
  }).handoff;
  assert.equal(handoff.ownerEntryPoint, 'compileNetRevenuePlan');
  assert.equal(handoff.authority.metricExecution, 'NOT_PERFORMED');
  assert.equal(handoff.authority.sharedTaskHandle, 'NOT_INTEGRATED');
});

// ---------------------------------------------------------------------------------
// Determinism and RED/GREEN on a disposable broken variant.
// ---------------------------------------------------------------------------------
test('the journey is deterministic and byte-identical for the same inputs', async () => {
  const first = await runJourney();
  const second = await runJourney();
  assert.equal(first.journeySha256, second.journeySha256);
  assert.equal(first.receiptSha256, second.receiptSha256);
  assert.equal(first.resultSha256, second.resultSha256);
  assert.equal(first.binding.bindingSha256, second.binding.bindingSha256);
});

test('a disposable variant that INFERS an undecided kind as a sale goes RED; the real module stays GREEN', async () => {
  const source = await readFile(MODULE_PATH, 'utf8');
  const broken = source
    .replace(`    if (!Object.hasOwn(decisions, value)) fail(\`KS246_JOURNEY_DENIED:MISSING_KIND_DECISION:\${value}\`);`, '')
    .replace(`  if (!Object.hasOwn(mapping.decisions, kindValue)) {
    fail(\`KS246_JOURNEY_DENIED:MISSING_KIND_DECISION:\${String(kindValue)}\`);
  }`, '')
    .replace('record_kind: mapping.decisions[kindValue],', "record_kind: mapping.decisions[kindValue] ?? 'sale',");
  assert.notEqual(broken, source, 'the sabotage must actually change the source');
  const variantPath = join(ROOT, 'services/bi-control/src/business-bi/.ks246-variant-kind-inference.test.mjs');
  writeFileSync(variantPath, broken);
  try {
    const variant = await import('../services/bi-control/src/business-bi/.ks246-variant-kind-inference.test.mjs');
    const outcome = await variant.runUnfamiliarMetricJourney(journeyInput({
      kindDecisionBytes: mutateDecisions((d) => { delete d.decisions.P; }),
    }));
    // RED: with the decision gate broken an UNDECIDED value is silently executed as a sale.
    assert.equal(outcome.executed, true);
    assert.equal(outcome.acceptance.executionState, 'COMPLETE');
    assert.equal(outcome.result.deltaMinorUnits, UNFAMILIAR_JOURNEY_EXPECTED.deltaMinorUnits);
  } finally {
    rmSync(variantPath, { force: true });
  }
  // GREEN: the real module refuses the exact same input by name and executes nothing.
  assert.equal(await denialOf(() => runJourney({
    kindDecisionBytes: mutateDecisions((d) => { delete d.decisions.P; }),
  })), 'KS246_JOURNEY_DENIED:MISSING_KIND_DECISION:P');
});

test('a disposable variant that maps the DROPPED sibling amount slips through RED; the real module keeps the confirmed field (GREEN)', async () => {
  const source = await readFile(MODULE_PATH, 'utf8');
  // Sabotage the projection so the non-role sibling amount is forwarded as the metric amount.
  const broken = source.replace('amt_a: row.amt_a ?? null,', 'amt_a: row.amt_b ?? null,');
  assert.notEqual(broken, source, 'the sabotage must actually change the source');
  const variantPath = join(ROOT, 'services/bi-control/src/business-bi/.ks246-variant-dropped-column.test.mjs');
  writeFileSync(variantPath, broken);
  try {
    const variant = await import('../services/bi-control/src/business-bi/.ks246-variant-dropped-column.test.mjs');
    const outcome = await variant.runUnfamiliarMetricJourney(journeyInput());
    // RED: the real assertion (a COMPLETE execution over the confirmed amount column) fails
    // for the variant, because the substituted column can never reproduce the bound source.
    assert.equal(outcome.executed, false);
    assert.equal(outcome.acceptance.executionState, 'DENIED');
    assert.equal(outcome.acceptance.denialReasonCode, 'KS246_SOURCE_TABLE_SUBSTITUTED');
  } finally {
    rmSync(variantPath, { force: true });
  }
  // GREEN: the real module never selects or forwards the non-role sibling amount.
  assert.equal(new RegExp('\\bamt_b\\b').test(UNFAMILIAR_SOURCE_SELECT), false);
  const real = await runJourney();
  assert.equal(real.acceptance.executionState, 'COMPLETE');
  assert.equal(real.result.deltaMinorUnits, UNFAMILIAR_JOURNEY_EXPECTED.deltaMinorUnits);
});


// ---------------------------------------------------------------------------------
// AC04/C1/C2 — the caller's OWN required inputs: no default, no fixture adoption.
// ---------------------------------------------------------------------------------
test('C1/C2 a missing caller input is refused BEFORE any database is created, seeded or read', async () => {
  const buildSpy = () => {
    const state = { touched: false };
    const database = buildUnfamiliarSyntheticDatabase();
    database.exec = async () => { state.touched = true; return { rows: [] }; };
    database.query = async () => { state.touched = true; return { rows: [] }; };
    return { state, database };
  };
  for (const [overrides, code] of [
    [{ kindDecisionBytes: undefined }, 'KS246_JOURNEY_DENIED:MISSING_KIND_DECISION_INPUT'],
    [{ businessSemanticBytes: undefined }, 'KS246_JOURNEY_DENIED:MISSING_BUSINESS_SEMANTIC_CONFIRMATION'],
    [{ sourceRevision: undefined }, 'KS246_JOURNEY_DENIED:MISSING_SOURCE_REVISION_BINDING'],
    [{ sourceRevision: '' }, 'KS246_JOURNEY_DENIED:MISSING_SOURCE_REVISION_BINDING'],
  ]) {
    const { state, database } = buildSpy();
    assert.equal(await denialOf(() => runJourney({ ...overrides, database })), code);
    assert.equal(state.touched, false, `${code} must not touch the database`);
  }
  // Positive counterpart: the guard passes for the caller's complete, explicit inputs.
  assert.equal(requireJourneyCallerBindings({
    kindDecisionBytes, businessSemanticBytes, sourceRevision: SOURCE_REVISION,
  }), undefined);
});

test('AC04 the admitted amount column requires a CLOSED, SOURCE-BOUND caller confirmation', async () => {
  const journey = await runJourney();
  assert.equal(journey.binding.amountBusinessMeaning, ADMITTED_AMOUNT_BUSINESS_MEANING);
  assert.deepEqual([...UNFAMILIAR_AMOUNT_BUSINESS_MEANINGS],
    ['NET_SALES_REVENUE', 'NOT_NET_SALES_REVENUE', 'UNRESOLVED']);
  // The frozen confirmation names exactly the caller's confirmed amount column.
  assert.equal(businessSemanticsFixture.subject, proposal.metricCandidate.units.amountColumn);
  // The confirmation must BIND the caller's confirmed subject and source revision.
  assert.equal(await denialOf(() => runJourney({
    businessSemanticBytes: mutateSemantics((b) => { b.subject = 'synth_x.pay_feed.amt_b'; }),
  })), 'KS246_JOURNEY_DENIED:BUSINESS_MEANING_SUBJECT_NOT_CONFIRMED_AMOUNT');
  assert.equal(await denialOf(() => runJourney({
    businessSemanticBytes: mutateSemantics((b) => { b.sourceRevision = 'synthetic-unfamiliar-v1'; }),
  })), 'KS246_JOURNEY_DENIED:SOURCE_REVISION_STALE');
  // An incompatible or explicitly unresolved confirmed meaning is refused, never mapped on.
  assert.equal(await denialOf(() => runJourney({
    businessSemanticBytes: mutateSemantics((b) => { b.confirmedMeaning = 'NOT_NET_SALES_REVENUE'; }),
  })), 'KS246_JOURNEY_DENIED:INCOMPATIBLE_AMOUNT_BUSINESS_MEANING');
  assert.equal(await denialOf(() => runJourney({
    businessSemanticBytes: mutateSemantics((b) => { b.confirmedMeaning = 'UNRESOLVED'; }),
  })), 'KS246_JOURNEY_DENIED:UNRESOLVED_AMOUNT_BUSINESS_MEANING');
  // A token outside the CLOSED vocabulary is refused by the loader, not interpreted.
  assert.throws(() => loadBusinessSemanticConfirmation(
    mutateSemantics((b) => { b.confirmedMeaning = 'SHAREHOLDER_EQUITY'; }),
  ), (error) => error.code === 'KS246_BUSINESS_SEMANTICS_DENIED:MEANING');
  // Positive counterpart: the frozen fixture loads with its own identity.
  const loaded = loadBusinessSemanticConfirmation(businessSemanticBytes);
  assert.equal(loaded.confirmedMeaning, ADMITTED_AMOUNT_BUSINESS_MEANING);
  assert.equal(loaded.sourceRevision, SOURCE_REVISION);
  assert.match(loaded.confirmationSha256, /^[a-f0-9]{64}$/);
});

test('AC04 a RECORDED free-text amount business meaning is never reconciled by interpretation', async () => {
  // The reviewed proposal API legitimately RECORDS a caller free-text meaning; the NEW
  // boundary under test is that turning it into an EXECUTED business metric refuses an
  // incompatible or unresolved meaning instead of running anyway.
  const incompatible = proposalFor(answersWithAmountMeaning('warehouse inventory replacement cost; not sales revenue'));
  assert.equal(incompatible.metricCandidate.status, 'CONFIRMED');
  assert.equal(await denialOf(() => runJourney({ proposal: incompatible })),
    'KS246_JOURNEY_DENIED:INCOMPATIBLE_AMOUNT_BUSINESS_MEANING');
  const unresolved = proposalFor(answersWithAmountMeaning('UNRESOLVED'));
  assert.equal(unresolved.metricCandidate.status, 'CONFIRMED');
  assert.equal(await denialOf(() => runJourney({ proposal: unresolved })),
    'KS246_JOURNEY_DENIED:UNRESOLVED_AMOUNT_BUSINESS_MEANING');
  // Positive counterpart: an ABSENT recorded meaning keeps the closed confirmation as the
  // authorization, and a recorded meaning that IS the confirmed token reconciles.
  assert.equal((await runJourney()).binding.amountBusinessMeaning, ADMITTED_AMOUNT_BUSINESS_MEANING);
  const agreeing = proposalFor(answersWithAmountMeaning(ADMITTED_AMOUNT_BUSINESS_MEANING));
  assert.equal((await runJourney({ proposal: agreeing })).binding.amountBusinessMeaning,
    ADMITTED_AMOUNT_BUSINESS_MEANING);
});

// ---------------------------------------------------------------------------------
// The delivered CLI, exercised as a PROCESS.
// ---------------------------------------------------------------------------------
test('the CLI runs the ACTUAL entry point on EOF and reports the exact denial without executing', () => {
  const eof = cli([]);
  assert.equal(eof.status, 0, eof.stderr);
  const summary = JSON.parse(eof.stdout);
  assert.equal(summary.mode, 'eof');
  assert.equal(summary.proposal.status, 'PROPOSED');
  assert.equal(summary.proposal.confirmedCount, 0);
  assert.equal(summary.executed, false);
  assert.equal(summary.handoffDenial.code, 'UNFAMILIAR_HANDOFF_DENIED:UNCONFIRMED_QUESTIONS');
  assert.equal(summary.sharedTaskHandle, 'NOT_INTEGRATED');
  assert.equal(summary.ac05, 'PARENT_OWNED_OPEN');
  assert.deepEqual(summary.expectedResult, { ...UNFAMILIAR_JOURNEY_EXPECTED });
});

test('the CLI executes the supported positive example and prints its independently expected result', () => {
  const positive = cliWithAnswers(CONFIRMED_ANSWERS, [...CALLER_ARGS]);
  assert.equal(positive.status, 0, positive.stderr);
  assert.equal(positive.summary.proposal.status, 'CONFIRMED');
  assert.equal(positive.summary.executed, true);
  assert.equal(positive.summary.acceptance.executionState, 'COMPLETE');
  assert.deepEqual(positive.summary.acceptance.actualResult, independentExpectedResult());
  assert.equal(positive.summary.acceptance.oracleEquality, 'EXACT');
  assert.equal(positive.summary.sourceRevision, SOURCE_REVISION);
  assert.equal(positive.summary.proposalDiscoveryRevision, 'synthetic-unfamiliar-v1');
  assert.deepEqual(positive.summary.residualKindValues, ['P', 'U']);
  assert.equal(positive.summary.amountBusinessMeaning, ADMITTED_AMOUNT_BUSINESS_MEANING);
  assert.match(positive.summary.amountBusinessMeaningSha256, /^[a-f0-9]{64}$/);
  assert.equal(positive.summary.authority.sharedTaskHandle, 'NOT_INTEGRATED');
  // The CLI honours the caller's explicit source-revision assertion: a STALE assertion is
  // reported as an exact denial, and nothing is executed.
  const stale = cliWithAnswers(CONFIRMED_ANSWERS,
    ['--kind-decisions', KIND_DECISIONS_PATH, '--business-semantics', BUSINESS_SEMANTICS_PATH,
      '--source-revision', 'synthetic-unfamiliar-v1']);
  assert.equal(stale.status, 0, stale.stderr);
  assert.equal(stale.summary.executed, false);
  assert.equal(stale.summary.journeyDenial.code, 'KS246_JOURNEY_DENIED:SOURCE_REVISION_STALE');
  // ... and the correct revision executes.
  const asserted = cliWithAnswers(CONFIRMED_ANSWERS, [...CALLER_ARGS]);
  assert.equal(asserted.summary.executed, true);
  assert.equal(asserted.summary.acceptance.executionState, 'COMPLETE');
  // An incompatible semantic goal is refused with its exact code through the same CLI.
  const wrongGoal = cliWithAnswers(CONFIRMED_ANSWERS, [...CALLER_ARGS, '--goal', 'GROSS_MARGIN']);
  assert.equal(wrongGoal.summary.journeyDenial.code, 'KS246_JOURNEY_DENIED:INCOMPATIBLE_SEMANTIC_GOAL');
});

test('C1 the real CLI refuses a missing caller kind-decision input before any database work', () => {
  const out = cliWithAnswers(CONFIRMED_ANSWERS,
    ['--business-semantics', BUSINESS_SEMANTICS_PATH, '--source-revision', SOURCE_REVISION]);
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.summary.executed, false);
  assert.equal(out.summary.sourceMode, undefined);
  assert.equal(out.summary.journeyDenial.code, 'KS246_JOURNEY_DENIED:MISSING_KIND_DECISION_INPUT');
  assert.match(out.summary.note, /before creating, seeding or reading any database/);
});

test('C2 the real CLI refuses a missing source-revision assertion instead of manufacturing one', () => {
  const out = cliWithAnswers(CONFIRMED_ANSWERS,
    ['--kind-decisions', KIND_DECISIONS_PATH, '--business-semantics', BUSINESS_SEMANTICS_PATH]);
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.summary.executed, false);
  assert.equal(out.summary.journeyDenial.code, 'KS246_JOURNEY_DENIED:MISSING_SOURCE_REVISION_BINDING');
});

test('C3 the real CLI refuses a missing business-semantics confirmation and an incompatible recorded meaning', () => {
  const missing = cliWithAnswers(CONFIRMED_ANSWERS,
    ['--kind-decisions', KIND_DECISIONS_PATH, '--source-revision', SOURCE_REVISION]);
  assert.equal(missing.summary.executed, false);
  assert.equal(missing.summary.journeyDenial.code, 'KS246_JOURNEY_DENIED:MISSING_BUSINESS_SEMANTIC_CONFIRMATION');
  const incompatible = cliWithAnswers(
    answersWithAmountMeaning('warehouse inventory replacement cost; not sales revenue'), [...CALLER_ARGS]);
  assert.equal(incompatible.status, 0, incompatible.stderr);
  assert.equal(incompatible.summary.executed, false);
  assert.equal(incompatible.summary.journeyDenial.code,
    'KS246_JOURNEY_DENIED:INCOMPATIBLE_AMOUNT_BUSINESS_MEANING');
  const unresolved = cliWithAnswers(answersWithAmountMeaning('UNRESOLVED'), [...CALLER_ARGS]);
  assert.equal(unresolved.summary.executed, false);
  assert.equal(unresolved.summary.journeyDenial.code,
    'KS246_JOURNEY_DENIED:UNRESOLVED_AMOUNT_BUSINESS_MEANING');
});

test('C1 RED/GREEN through the real CLI: a variant that defaults kind decisions executes; the real CLI refuses', () => {
  const source = readFileSync(CLI_PATH, 'utf8');
  const guardCall = '      requireJourneyCallerBindings({\n'
    + '        kindDecisionBytes: callerKindDecisionBytes,\n'
    + '        businessSemanticBytes: callerBusinessSemanticBytes,\n'
    + '        sourceRevision: sourceRevisionOption,\n'
    + '      });\n';
  const broken = source
    .replace("const callerKindDecisionBytes = kindDecisionsPath === null ? undefined : readFileSync(kindDecisionsPath);",
      'const callerKindDecisionBytes = kindDecisionsPath === null ? readFileSync(KIND_DECISIONS_PATH) : readFileSync(kindDecisionsPath);')
    .replace(guardCall, '');
  assert.notEqual(broken, source, 'the C1 sabotage must actually change the CLI');
  const variantPath = 'scripts/.ks246-variant-cli-default-kind-decisions.mjs';
  writeFileSync(variantPath, broken);
  try {
    const red = cliWithAnswers(CONFIRMED_ANSWERS,
      ['--business-semantics', BUSINESS_SEMANTICS_PATH, '--source-revision', SOURCE_REVISION], variantPath);
    // RED: with the guard removed and the fixture re-adopted, an omission EXECUTES.
    assert.equal(red.summary.executed, true);
    assert.equal(red.summary.acceptance.executionState, 'COMPLETE');
  } finally {
    rmSync(variantPath, { force: true });
  }
  // GREEN: the real CLI refuses the exact same omission, before any database work.
  const green = cliWithAnswers(CONFIRMED_ANSWERS,
    ['--business-semantics', BUSINESS_SEMANTICS_PATH, '--source-revision', SOURCE_REVISION]);
  assert.equal(green.summary.executed, false);
  assert.equal(green.summary.journeyDenial.code, 'KS246_JOURNEY_DENIED:MISSING_KIND_DECISION_INPUT');
});

test('C2 RED/GREEN through the real CLI: a variant that manufactures the revision executes; the real CLI refuses', () => {
  const source = readFileSync(CLI_PATH, 'utf8');
  const broken = source.replace(
    "const sourceRevisionOption = optionOf('--source-revision');",
    "const sourceRevisionOption = optionOf('--source-revision') ?? SOURCE_REVISION;");
  assert.notEqual(broken, source, 'the C2 sabotage must actually change the CLI');
  const variantPath = 'scripts/.ks246-variant-cli-default-source-revision.mjs';
  writeFileSync(variantPath, broken);
  try {
    const red = cliWithAnswers(CONFIRMED_ANSWERS,
      ['--kind-decisions', KIND_DECISIONS_PATH, '--business-semantics', BUSINESS_SEMANTICS_PATH], variantPath);
    assert.equal(red.summary.executed, true);
    assert.equal(red.summary.acceptance.executionState, 'COMPLETE');
  } finally {
    rmSync(variantPath, { force: true });
  }
  const green = cliWithAnswers(CONFIRMED_ANSWERS,
    ['--kind-decisions', KIND_DECISIONS_PATH, '--business-semantics', BUSINESS_SEMANTICS_PATH]);
  assert.equal(green.summary.executed, false);
  assert.equal(green.summary.journeyDenial.code, 'KS246_JOURNEY_DENIED:MISSING_SOURCE_REVISION_BINDING');
});

test('C3 RED/GREEN through the real CLI: a variant without the business-meaning gate executes; the real CLI refuses', () => {
  const moduleSource = readFileSync(MODULE_PATH, 'utf8');
  const brokenModule = moduleSource
    .split("fail('KS246_JOURNEY_DENIED:INCOMPATIBLE_AMOUNT_BUSINESS_MEANING');").join('void 0;')
    .split("fail('KS246_JOURNEY_DENIED:UNRESOLVED_AMOUNT_BUSINESS_MEANING');").join('void 0;');
  assert.notEqual(brokenModule, moduleSource, 'the C3 sabotage must actually change the module');
  const variantModulePath = 'services/bi-control/src/business-bi/.ks246-variant-no-business-meaning.mjs';
  const variantCliPath = 'scripts/.ks246-variant-cli-no-business-meaning.mjs';
  writeFileSync(variantModulePath, brokenModule);
  writeFileSync(variantCliPath, readFileSync(CLI_PATH, 'utf8').replace(
    "'../services/bi-control/src/business-bi/net-revenue-unfamiliar-composition.mjs'",
    "'../services/bi-control/src/business-bi/.ks246-variant-no-business-meaning.mjs'"));
  const answers = answersWithAmountMeaning('warehouse inventory replacement cost; not sales revenue');
  try {
    const red = cliWithAnswers(answers, [...CALLER_ARGS], variantCliPath);
    assert.equal(red.summary.executed, true);
    assert.equal(red.summary.acceptance.executionState, 'COMPLETE');
    assert.equal(red.summary.acceptance.actualResult.deltaMinorUnits, UNFAMILIAR_JOURNEY_EXPECTED.deltaMinorUnits);
  } finally {
    rmSync(variantModulePath, { force: true });
    rmSync(variantCliPath, { force: true });
  }
  const green = cliWithAnswers(answers, [...CALLER_ARGS]);
  assert.equal(green.summary.executed, false);
  assert.equal(green.summary.journeyDenial.code, 'KS246_JOURNEY_DENIED:INCOMPATIBLE_AMOUNT_BUSINESS_MEANING');
});

test('the CLI --negative gate reports only the exact intended rejection codes', () => {
  const negative = cli(['--negative']);
  assert.equal(negative.status, 0, negative.stderr);
  const summary = JSON.parse(negative.stdout);
  const expected = {
    'eof-handoff': 'UNFAMILIAR_HANDOFF_DENIED:UNCONFIRMED_QUESTIONS',
    'unconfirmed-proposal': 'UNFAMILIAR_HANDOFF_DENIED:UNCONFIRMED_QUESTIONS',
    'unsupported-units': 'UNFAMILIAR_HANDOFF_DENIED:ARITHMETIC_UNIT_NOT_RELEASED',
    'unsupported-currency': 'UNFAMILIAR_HANDOFF_DENIED:CURRENCY_NOT_RELEASED',
    'missing-kind-decision-input': 'KS246_JOURNEY_DENIED:MISSING_KIND_DECISION_INPUT',
    'missing-business-semantic-confirmation': 'KS246_JOURNEY_DENIED:MISSING_BUSINESS_SEMANTIC_CONFIRMATION',
    'missing-source-revision-binding': 'KS246_JOURNEY_DENIED:MISSING_SOURCE_REVISION_BINDING',
    'missing-authority': 'KS246_JOURNEY_DENIED:MISSING_AUTHORITY',
    'incompatible-semantic-goal': 'KS246_JOURNEY_DENIED:INCOMPATIBLE_SEMANTIC_GOAL',
    'stale-source-revision': 'KS246_JOURNEY_DENIED:SOURCE_REVISION_STALE',
    'missing-kind-decision': 'KS246_JOURNEY_DENIED:MISSING_KIND_DECISION:P',
    'kind-decision-conflict': 'KS246_JOURNEY_DENIED:KIND_DECISION_CONFLICT:credit',
    'unsupported-kind': 'KS246_JOURNEY_DENIED:UNSUPPORTED_KIND:refund',
    'incompatible-amount-business-meaning': 'KS246_JOURNEY_DENIED:INCOMPATIBLE_AMOUNT_BUSINESS_MEANING',
    'unresolved-amount-business-meaning': 'KS246_JOURNEY_DENIED:UNRESOLVED_AMOUNT_BUSINESS_MEANING',
    'business-meaning-subject-mismatch': 'KS246_JOURNEY_DENIED:BUSINESS_MEANING_SUBJECT_NOT_CONFIRMED_AMOUNT',
    'stale-business-semantics-revision': 'KS246_JOURNEY_DENIED:SOURCE_REVISION_STALE',
    'unknown-amount-business-meaning-token': 'KS246_BUSINESS_SEMANTICS_DENIED:MEANING',
    'recorded-incompatible-amount-meaning': 'KS246_JOURNEY_DENIED:INCOMPATIBLE_AMOUNT_BUSINESS_MEANING',
    'recorded-unresolved-amount-meaning': 'KS246_JOURNEY_DENIED:UNRESOLVED_AMOUNT_BUSINESS_MEANING',
    'wrong-field-binding': 'KS246_JOURNEY_DENIED:ROLE_BINDING_NOT_CONFIRMED:amountField',
    'resealed-source-substitution': 'KS246_JOURNEY_DENIED:SOURCE_NOT_COHERENT_WITH_RELEASED_HOLDOUT',
    'substituted-database-rows': 'KS246_SOURCE_TABLE_SUBSTITUTED',
    'ambiguous-date-role': 'KS246_JOURNEY_DENIED:AMBIGUOUS_DATE_ROLE',
    'unclassified-source-column': 'KS246_JOURNEY_DENIED:UNCLASSIFIED_SOURCE_COLUMN',
    'unsupported-source-access-mode': 'KS246_SOURCE_DENIED:ACCESS_MODE',
    'source-sql-authority': 'KS246_SOURCE_DENIED:SQL_AUTHORITY',
  };
  const seen = Object.fromEntries(summary.codes.map((entry) => {
    const index = entry.indexOf('=');
    return [entry.slice(0, index), entry.slice(index + 1)];
  }));
  assert.deepEqual(Object.keys(seen).sort(), Object.keys(expected).sort());
  for (const [label, code] of Object.entries(expected)) assert.equal(seen[label], code, label);
  assert.equal(summary.codes.some((entry) => /UNEXPECTEDLY_ACCEPTED/.test(entry)), false);
});

// ---------------------------------------------------------------------------------
// Lifecycle / integrity migration for the new family.
// ---------------------------------------------------------------------------------
test('the KS246 metric-journey family is content-addressed in SOURCE-MAP.json and canonically registered once', async () => {
  const [pkg, sourceMap] = await Promise.all([
    readFile('package.json', 'utf8').then(JSON.parse),
    readFile('SOURCE-MAP.json', 'utf8').then(JSON.parse),
  ]);
  const family = [
    SOURCE_PATH,
    KIND_DECISIONS_PATH,
    BUSINESS_SEMANTICS_PATH,
    MODULE_PATH,
    CLI_PATH,
    'tests/unfamiliar-schema-metric-journey.test.mjs',
    'docs/evidence/ks246-unfamiliar-metric-journey-v1.md',
    'scripts/update-ks246-unfamiliar-schema-source-map.mjs',
    METADATA_PATH,
    AGGREGATE_PATH,
    'services/bi-control/src/business-bi/unfamiliar-schema-proposal.mjs',
    'tests/unfamiliar-schema-proposal.test.mjs',
    'scripts/run-unfamiliar-schema-proposal.mjs',
    'docs/evidence/ks246-unfamiliar-schema-proposal-v1.md',
  ];
  for (const file of family) {
    assert.match(sourceMap.files[file] ?? '', /^[a-f0-9]{64}$/, file);
    assert.equal(sha256(await readFile(file)), sourceMap.files[file], file);
  }
  // The suite is canonically REACHABLE but is never a second direct package.json root: the
  // canonical command is byte-bound to the released C1 certificate, so it rides the
  // imported-parent route in tests/source-map.test.mjs exactly once.
  const canonicalTests = pkg.scripts.test.split(/\s+/).slice(2);
  assert.equal(canonicalTests.includes('tests/unfamiliar-schema-metric-journey.test.mjs'), false);
  const parentSource = await readFile('tests/source-map.test.mjs', 'utf8');
  assert.equal((parentSource.match(/import '\.\/unfamiliar-schema-metric-journey\.test\.mjs';/g) ?? []).length, 1);
  const topologySource = await readFile('tests/canonical-test-topology.test.mjs', 'utf8');
  assert.equal((topologySource.match(/tests\/unfamiliar-schema-metric-journey\.test\.mjs/g) ?? []).length, 1);
  assert.equal(sourceMap.files['SOURCE-MAP.json'], undefined);
});

test('the preserved AC01/AC02 proposal surface and fixtures are unchanged by this composition', async () => {
  const sourceMap = JSON.parse(await readFile('SOURCE-MAP.json', 'utf8'));
  // The reviewed proposal fixtures keep their exact bytes.
  assert.equal(sha256(metadataBytes), sourceMap.files[METADATA_PATH]);
  assert.equal(sha256(aggregateBytes), sourceMap.files[AGGREGATE_PATH]);
  const aggregateFixture = JSON.parse(aggregateBytes.toString('utf8'));
  assert.equal(aggregateFixture.sourceRevision, 'synthetic-unfamiliar-v1');
  assert.equal(aggregateFixture.relationProfiles.length, 3);
  // The proposal module still exposes its narrowed AC03 local support and never executes.
  const proposalSource = await readFile('services/bi-control/src/business-bi/unfamiliar-schema-proposal.mjs', 'utf8');
  assert.match(proposalSource, /metricExecution: 'NOT_PERFORMED'/);
  assert.match(proposalSource, /sharedTaskHandle: 'NOT_INTEGRATED'/);
  assert.doesNotMatch(proposalSource, /compileNetRevenuePlan\(/);
});
