// KS247 (KS-EVO-02-AC02/AC03/AC04) — focused verification for the READ-ONLY result lineage on
// the existing CLI/TABLE/HTML read path.
//
//   AC02 — the numbers the read actually produced are compared, dimension by dimension, with
//          an INDEPENDENTLY MAINTAINED expectation: an authored fixture whose integers this
//          suite ALSO derives by its own loop over the frozen source fixture and the released
//          contract windows, and whose digests it content-addresses itself.  Source
//          substitution is refused even when the caller recomputes its own digest, because a
//          recomputed digest is compared against the maintained pin, never against itself.
//   AC03 — deterministic verified numbers stay separate from free-form explanation, from
//          unavailable facts and from the actual completion state; a wrong number, unit or
//          period, stale evidence and unsupported causal/completion assertions are refused by
//          name rather than presented as verified.  Every refusal has a permitted counterpart.
//   AC04 — completion is the released receipt's own state (a read-only journey keeps a valid
//          completion and invents NO effect journal), and a synthetic effect may only be shown
//          from a SEPARATELY CONFIRMED effect status.
//
// The retained KS246 composition is exercised UNCHANGED here: this suite imports its public
// entry point and drives the real local synthetic database, so a lineage package that broke
// the retained read would fail here rather than pass quietly.
//
// Nonclaim: passing legs prove the local synthetic separation only.  They are not a
// production, comprehension, admission or publication claim, and AC05 stays parent-owned.

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
  buildUnfamiliarSyntheticDatabase,
  runUnfamiliarMetricJourney,
} from '../services/bi-control/src/business-bi/net-revenue-unfamiliar-composition.mjs';
import { buildPgliteJourneyDatabase } from '../services/bi-control/src/business-bi/net-revenue-journey.mjs';
import {
  RESULT_LINEAGE_EVIDENCE_CLAIM_SCHEMA,
  RESULT_LINEAGE_EXPECTATION_SCHEMA,
  RESULT_LINEAGE_EXPLANATION_SCHEMA,
  RESULT_LINEAGE_EFFECT_STATUS_SCHEMA,
  RESULT_LINEAGE_EFFECT_STATUSES,
  RESULT_LINEAGE_FORMATS,
  RESULT_LINEAGE_LINE_KINDS,
  RESULT_LINEAGE_SCHEMA,
  buildReadOnlyResultLineage,
  loadConfirmedEffectStatus,
  loadEvidenceClaim,
  loadFreeExplanation,
  loadIndependentExpectation,
  renderResultLineage,
  verifyReadOnlyResultLineage,
} from '../services/bi-control/src/business-bi/result-lineage-v1.mjs';

const ROOT = process.cwd();
const KS246_FD = 'tests/fixtures/business-bi/ks246-unfamiliar-schema';
const KS247_FD = 'tests/fixtures/business-bi/ks247-result-lineage';
const METADATA_PATH = `${KS246_FD}/metadata-v1.json`;
const AGGREGATE_PATH = `${KS246_FD}/aggregate-profile-v1.json`;
const SOURCE_PATH = `${KS246_FD}/source-pay-feed-v1.json`;
const KIND_DECISIONS_PATH = `${KS246_FD}/kind-decisions-v1.json`;
const BUSINESS_SEMANTICS_PATH = `${KS246_FD}/business-semantics-v1.json`;
const CONTRACT_PATH = 'contracts/business-bi/v1/net-revenue.metric.json';
const ORACLE_PATH = 'tests/fixtures/business-bi/net-revenue-oracle-v1.json';
const EXPECTATION_PATH = `${KS247_FD}/independent-expectation-v1.json`;
const EXPLANATION_PATH = `${KS247_FD}/explanation-v1.json`;
const EFFECT_STATUS_PATH = `${KS247_FD}/effect-status-v1.json`;
const MODULE_PATH = 'services/bi-control/src/business-bi/result-lineage-v1.mjs';
const CLI_PATH = 'scripts/run-result-lineage-journey.mjs';
const SOURCE_REVISION = 'synthetic-unfamiliar-source-v1';

const metadataBytes = readFileSync(METADATA_PATH);
const aggregateBytes = readFileSync(AGGREGATE_PATH);
const sourceBytes = readFileSync(SOURCE_PATH);
const kindDecisionBytes = readFileSync(KIND_DECISIONS_PATH);
const businessSemanticBytes = readFileSync(BUSINESS_SEMANTICS_PATH);
const contractBytes = readFileSync(CONTRACT_PATH);
const oracleBytes = readFileSync(ORACLE_PATH);
const expectationBytes = readFileSync(EXPECTATION_PATH);
const explanationBytes = readFileSync(EXPLANATION_PATH);
const effectStatusBytes = readFileSync(EFFECT_STATUS_PATH);

const contract = JSON.parse(contractBytes.toString('utf8'));
const oracle = JSON.parse(oracleBytes.toString('utf8'));
const sourceFixture = JSON.parse(sourceBytes.toString('utf8'));
const decisionsFixture = JSON.parse(kindDecisionBytes.toString('utf8'));
const expectationFixture = JSON.parse(expectationBytes.toString('utf8'));

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const clone = (value) => JSON.parse(JSON.stringify(value));
const AUTHORITY = Object.freeze({
  localSyntheticReadOnly: true, mutationAuthority: false, publicWrites: false,
});
const CALLER_ARGS = Object.freeze([
  '--kind-decisions', KIND_DECISIONS_PATH,
  '--business-semantics', BUSINESS_SEMANTICS_PATH,
  '--source-revision', SOURCE_REVISION,
]);
const CONFIRMED_ANSWERS = Object.freeze([
  'synth_x.pay_feed.pf_id', 'synth_x.pay_feed.val_dt', 'MINOR_UNITS',
  'synth_x.pay_feed.amt_a', 'EUR', 'R', 'V',
]);

function proposalFor(lines = CONFIRMED_ANSWERS) {
  return runUnfamiliarSchemaProposalEntryPoint({
    metadataBytes,
    aggregateBytes,
    answerSource: createListAnswerSource(lines),
  });
}

async function journeyFor(overrides = {}) {
  return runUnfamiliarMetricJourney({
    proposal: proposalFor(),
    sourceBytes,
    kindDecisionBytes,
    businessSemanticBytes,
    metricContractBytes: contractBytes,
    oracleBytes,
    database: buildUnfamiliarSyntheticDatabase(),
    sourceRevision: SOURCE_REVISION,
    authority: AUTHORITY,
    ...overrides,
  });
}

const expectation = loadIndependentExpectation(expectationBytes);
const explanation = loadFreeExplanation(explanationBytes);
const effectStatus = loadConfirmedEffectStatus(effectStatusBytes);

function claimFor(journey, overrides = {}) {
  return loadEvidenceClaim({
    schemaVersion: RESULT_LINEAGE_EVIDENCE_CLAIM_SCHEMA,
    issue: 'KS-EVO-02',
    sourceRevision: journey.binding.sourceRevision,
    sourceByteSha256: journey.binding.sourceSha256,
    canonicalHoldoutSha256: journey.binding.canonicalHoldoutSha256,
    resultSha256: journey.resultSha256 ?? null,
    ...overrides,
  });
}

function lineageInput(journey, overrides = {}) {
  return {
    journey,
    expectation,
    metricContractBytes: contractBytes,
    evidenceClaim: claimFor(journey),
    explanation,
    effectStatus,
    ...overrides,
  };
}

async function denialOf(run) {
  try {
    const outcome = await run();
    return outcome?.lineageSha256 === undefined ? 'ACCEPTED:' + JSON.stringify(outcome) : `ACCEPTED:${outcome.lineageSha256}`;
  } catch (error) {
    return error.code ?? String(error.message ?? error);
  }
}

function mutateJson(bytes, mutate) {
  const copy = JSON.parse(bytes.toString('utf8'));
  mutate(copy);
  return Buffer.from(JSON.stringify(copy), 'utf8');
}

const expectationFrom = (mutate) => loadIndependentExpectation(mutateJson(expectationBytes, mutate));

function explanationFrom(assertions) {
  return loadFreeExplanation({
    schemaVersion: RESULT_LINEAGE_EXPLANATION_SCHEMA,
    issue: 'KS-EVO-02',
    assertions,
  });
}

function cli(args, script = CLI_PATH) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: ROOT, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// TABLE/HTML runs print a rendering followed by a machine receipt; JSON runs print the
// lineage document.  `summary` is the parsed JSON receipt of a JSON run, and `receipt` is the
// trailing machine receipt of a rendering run.
function cliWithAnswers(answers, extraArgs = [], script = CLI_PATH) {
  const scratch = mkdtempSync(join(tmpdir(), 'ks247-lineage-'));
  try {
    const answersPath = join(scratch, 'answers.txt');
    writeFileSync(answersPath, `${answers.join('\n')}\n`);
    const out = cli(['--answers', answersPath, ...extraArgs], script);
    const trimmed = out.stdout.trimStart();
    const summary = trimmed.startsWith('{') ? JSON.parse(out.stdout) : null;
    const receipt = summary === null ? null : summary;
    return { ...out, summary, receipt };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// The trailing JSON machine receipt of a TABLE/HTML run (the rendering precedes it).
function trailingReceipt(stdout) {
  const index = stdout.lastIndexOf('\n{');
  assert.ok(index > 0, 'a TABLE/HTML run must carry its machine receipt');
  return JSON.parse(stdout.slice(index + 1));
}

// ---------------------------------------------------------------------------------
// An INDEPENDENT expected result: this suite's OWN arithmetic over the frozen source
// fixture, using the released contract's period windows and the caller's authored decisions.
// ---------------------------------------------------------------------------------
function independentExpectedNumbers() {
  const kindOf = (value) => decisionsFixture.decisions[value];
  const windows = { current: contract.periods.current, comparison: contract.periods.comparison };
  const totals = {
    current: { net: 0, sale: 0, credit: 0, cancel: 0, rows: 0, unknown: 0 },
    comparison: { net: 0, sale: 0, credit: 0, cancel: 0, rows: 0, unknown: 0 },
  };
  for (const row of sourceFixture.rows) {
    const kind = kindOf(row.ev_typ);
    for (const [key, window] of Object.entries(windows)) {
      const inWindow = row.val_dt !== null && row.val_dt >= window.start && row.val_dt <= window.end;
      if (!inWindow) continue;
      totals[key].rows += 1;
      if (kind === 'sale' && Number.isInteger(row.amt_a)) { totals[key].net += row.amt_a; totals[key].sale += row.amt_a; }
      if (kind === 'credit' && Number.isInteger(row.amt_a)) { totals[key].net -= row.amt_a; totals[key].credit += row.amt_a; }
      if (kind === 'cancel') totals[key].cancel += 1;
      if (kind === 'unknown') totals[key].unknown += 1;
    }
  }
  return {
    'periods.current.netMinorUnits': totals.current.net,
    'periods.current.saleMinorUnits': totals.current.sale,
    'periods.current.creditMinorUnits': totals.current.credit,
    'periods.current.cancelCount': totals.current.cancel,
    'periods.comparison.netMinorUnits': totals.comparison.net,
    'periods.comparison.saleMinorUnits': totals.comparison.sale,
    'periods.comparison.creditMinorUnits': totals.comparison.credit,
    'periods.comparison.cancelCount': totals.comparison.cancel,
    deltaMinorUnits: totals.current.net - totals.comparison.net,
  };
}

// The remaining maintained expectations are ROW/UNKNOWN-channel facts whose released
// semantics (unquantified rows, out-of-scope rows, the unassigned channel) are NOT a naive
// sum: they are independently maintained by the released hand-derived oracle fixture, which
// is verified by its own independent inline calculator in tests/business-bi-metric-oracle.
// Mapping them explicitly keeps the comparison a comparison rather than a re-statement.
const ORACLE_PATHS = Object.freeze({
  'periods.current.rowCount': (o) => o.periods.current.rowCount,
  'periods.current.unknown.count': (o) => o.periods.current.unknown.count,
  'periods.current.unknown.quantifiedAmountMinorUnits': (o) => o.periods.current.unknown.quantifiedAmountMinorUnits,
  'periods.current.unknown.unquantifiedCount': (o) => o.periods.current.unknown.unquantifiedCount,
  'periods.comparison.rowCount': (o) => o.periods.comparison.rowCount,
  'periods.comparison.unknown.count': (o) => o.periods.comparison.unknown.count,
  'periods.comparison.unknown.quantifiedAmountMinorUnits': (o) => o.periods.comparison.unknown.quantifiedAmountMinorUnits,
  'periods.comparison.unknown.unquantifiedCount': (o) => o.periods.comparison.unknown.unquantifiedCount,
  'deltaMinorUnits': (o) => o.deltaMinorUnits,
  'periods.current.netMinorUnits': (o) => o.periods.current.netMinorUnits,
  'periods.current.saleMinorUnits': (o) => o.periods.current.saleMinorUnits,
  'periods.current.creditMinorUnits': (o) => o.periods.current.creditMinorUnits,
  'periods.current.cancelCount': (o) => o.periods.current.cancelCount,
  'periods.comparison.netMinorUnits': (o) => o.periods.comparison.netMinorUnits,
  'periods.comparison.saleMinorUnits': (o) => o.periods.comparison.saleMinorUnits,
  'periods.comparison.creditMinorUnits': (o) => o.periods.comparison.creditMinorUnits,
  'periods.comparison.cancelCount': (o) => o.periods.comparison.cancelCount,
  'unknown.count': (o) => o.unknown.count,
  'unknown.quantifiedAmountMinorUnits': (o) => o.unknown.quantifiedAmountMinorUnits,
  'unknown.unquantifiedCount': (o) => o.unknown.unquantifiedCount,
  'unknown.unassigned.count': (o) => o.unknown.unassigned.count,
  'unknown.unassigned.quantifiedAmountMinorUnits': (o) => o.unknown.unassigned.quantifiedAmountMinorUnits,
  'unknown.unassigned.unquantifiedCount': (o) => o.unknown.unassigned.unquantifiedCount,
  'excludedOutOfScopeCount': (o) => o.excludedOutOfScopeCount,
});

// Every maintained expectation maps to exactly one released independent oracle value.
function oracleExpectedNumbers() {
  return Object.fromEntries(Object.entries(ORACLE_PATHS).map(([path, read]) => [path, read(oracle.expected)]));
}

// ---------------------------------------------------------------------------------
// The independent expectation fixture is itself independently checkable.
// ---------------------------------------------------------------------------------
test('AC02 the maintained expectation agrees with this suite\'s own arithmetic and the released oracle', () => {
  // THIS suite's own loop over the frozen source fixture, for the money aggregates it can
  // legitimately derive: sale/credit/cancel per window and the delta.
  const independent = independentExpectedNumbers();
  for (const [path, value] of Object.entries(independent)) {
    assert.equal(expectationFixture.expectedNumbers[path], value, `expectation ${path}`);
  }
  // The FULL maintained expectation maps path-for-path onto the released hand-derived oracle,
  // so every one of the 24 pins has an independent counterpart outside this implementation.
  const oracleNumbers = oracleExpectedNumbers();
  assert.deepEqual(Object.keys(expectationFixture.expectedNumbers).sort(), Object.keys(oracleNumbers).sort());
  for (const [path, value] of Object.entries(oracleNumbers)) {
    assert.equal(expectationFixture.expectedNumbers[path], value, `oracle ${path}`);
  }
  assert.equal(expectationFixture.expectedNumbers.deltaMinorUnits, oracle.expected.deltaMinorUnits);
  assert.equal(expectationFixture.expectedNumbers['periods.current.netMinorUnits'],
    oracle.expected.periods.current.netMinorUnits);
  assert.equal(expectationFixture.expectedNumbers['periods.comparison.netMinorUnits'],
    oracle.expected.periods.comparison.netMinorUnits);
  // The maintained digests are content-addressed from the frozen fixtures by THIS suite.
  assert.equal(expectationFixture.current.sourceByteSha256, sha256(sourceBytes));
  assert.equal(expectation.current.sourceByteSha256, sha256(sourceBytes));
  assert.equal(expectation.current.canonicalHoldoutSha256,
    sha256(readFileSync('tests/fixtures/business-bi/net-revenue-holdout-v1.json')));
  assert.equal(expectation.current.canonicalRowCount, sourceFixture.rows.length);
  assert.equal(expectation.current.sourceRevision, SOURCE_REVISION);
  // The superseded evidence is the DISCOVERY revision's own bounded observation, not the
  // executable source: the two are different facts and stay different.
  assert.equal(expectation.supersededEvidence.length, 2);
  assert.ok(expectation.supersededEvidence.every(({ sourceRevision }) => sourceRevision === 'synthetic-unfamiliar-v1'));
  // The expectation declares its own independence and pins a closed unit/period vocabulary.
  assert.equal(expectation.independence, 'MAINTAINED_OUTSIDE_THE_RUN_NEVER_READ_BACK_FROM_A_RECEIPT');
  assert.equal(expectation.unit.id, `${contract.currency.code}_MINOR_UNITS`);
  assert.equal(expectation.unit.minorUnitsPerMajorUnit, contract.currency.minorUnitsPerMajorUnit);
  assert.deepEqual(expectation.periods.current, contract.periods.current);
  assert.deepEqual(expectation.periods.comparison, contract.periods.comparison);
  assert.equal(Object.keys(expectation.expectedNumbers).length, 24);
  assert.equal(expectation.unavailableFacts.length, 4);
});

// ---------------------------------------------------------------------------------
// AC02/AC03/AC04 — the positive read-only lineage.
// ---------------------------------------------------------------------------------
test('AC02/AC03/AC04 the actual local read yields a lineage that holds the four facts apart', async () => {
  const journey = await journeyFor();
  assert.equal(journey.executed, true, 'the retained KS246 composition must actually execute');
  assert.equal(journey.acceptance.executionState, 'COMPLETE');

  const input = lineageInput(journey);
  const lineage = buildReadOnlyResultLineage(input);

  assert.equal(lineage.schemaVersion, RESULT_LINEAGE_SCHEMA);
  assert.equal(lineage.observationKind, 'COMPLETE_READ_ONLY_OBSERVATION');
  assert.equal(lineage.sourceRevision, SOURCE_REVISION);

  // AC02 — every maintained expectation is a verified number, compared to the pin.
  assert.equal(lineage.verification.expectedNumberCount, 24);
  assert.equal(lineage.verification.verifiedNumberCount, 24);
  assert.equal(lineage.sections.verifiedNumbers.length, 24);
  for (const number of lineage.sections.verifiedNumbers) {
    assert.equal(number.kind, 'VERIFIED_NUMBER');
    assert.equal(number.verification, 'MATCHES_INDEPENDENT_EXPECTATION');
    assert.equal(number.value, number.expectedValue);
    assert.equal(number.independentExpectationSha256, expectation.expectationSha256);
    // Money aggregates carry the currency minor unit; counts are counts, never money.
    if (/MinorUnits$/.test(number.lineId)) assert.equal(number.unit.id, 'EUR_MINOR_UNITS');
    else assert.equal(number.unit.id, 'COUNT');
  }
  // The verified numbers ARE the released receipt's numbers.
  const byPath = Object.fromEntries(lineage.sections.verifiedNumbers.map((n) => [n.lineId, n.value]));
  assert.equal(byPath['periods.current.netMinorUnits'], journey.result.periods.current.netMinorUnits);
  assert.equal(byPath['periods.comparison.netMinorUnits'], journey.result.periods.comparison.netMinorUnits);
  assert.equal(byPath.deltaMinorUnits, journey.result.deltaMinorUnits);
  // ... and they agree with this suite's own independent arithmetic.
  for (const [path, value] of Object.entries(independentExpectedNumbers())) {
    assert.equal(byPath[path], value, `independent ${path}`);
  }

  // AC03 — explanation is a SEPARATE section, never verified.
  assert.equal(lineage.verification.explanationCount, explanation.assertions.length);
  assert.ok(lineage.sections.explanations.length > 0);
  for (const entry of lineage.sections.explanations) {
    assert.equal(entry.kind, 'EXPLANATION');
    assert.equal(entry.verified, false);
    assert.equal(entry.presentedAsVerified, false);
    assert.equal(typeof entry.text, 'string');
    assert.equal(Object.hasOwn(entry, 'value'), false, 'an explanation carries no numeric field');
  }
  // ... including the causal hypothesis, which is offered as prose and never as a verified cause.
  assert.ok(lineage.sections.explanations.some(({ assertionKind }) => assertionKind === 'CAUSAL'));

  // AC03 — unavailable facts are named as unavailable, never rendered as numbers.
  assert.equal(lineage.verification.unavailableFactCount, 4);
  const unavailableSubjects = lineage.sections.unavailableFacts.map(({ subject }) => subject).sort();
  assert.deepEqual(unavailableSubjects, ['causal_reason_for_delta', 'customer_segment_attribution',
    'gross_margin', 'order_intake']);
  for (const fact of lineage.sections.unavailableFacts) {
    assert.equal(fact.kind, 'UNAVAILABLE_FACT');
    assert.equal(fact.presentedAsVerified, false);
    assert.equal(Object.hasOwn(byPath, fact.subject), false);
  }

  // AC04 — completion is the released receipt's own state, and no effect journal is invented.
  assert.equal(lineage.sections.completion.state, 'COMPLETE');
  assert.equal(lineage.sections.completion.complete, true);
  assert.equal(lineage.sections.completion.completionSource, 'RELEASED_EXECUTION_RECEIPT_STATE');
  assert.equal(lineage.sections.completion.oracleEquality, 'EXACT');
  assert.equal(lineage.verification.effectJournal, 'NOT_INVENTED_READ_ONLY_JOURNEY');
  assert.equal(lineage.verification.effectStatus, 'EFFECT_NOT_APPLIED_READ_ONLY');
  assert.deepEqual(lineage.sections.syntheticEffects, []);
  assert.equal(lineage.promotionBoundaries.sourcePromotion, 'NONE');
  assert.equal(lineage.promotionBoundaries.journeyPromotion, 'LOCAL_SYNTHETIC_READ_ONLY_ONLY');
  assert.equal(lineage.promotionBoundaries.admissionAuthority, 'NONE');
  assert.equal(lineage.promotionBoundaries.mutationAuthority, 'NONE');
  assert.equal(lineage.promotionBoundaries.publicWrites, false);
  assert.equal(lineage.promotionBoundaries.readOnlyPromotionBoundaryPreserved, true);
  // The separately owned PAN452 read-purpose binding stays NOT integrated, stated rather
  // than stubbed.
  assert.equal(lineage.promotionBoundaries.sharedReadPurposeBinding, 'NOT_INTEGRATED');
  assert.equal(lineage.authority.sharedTaskHandle, 'NOT_INTEGRATED');
  assert.equal(lineage.authority.publicationAuthority, 'NONE');

  // The separation block is data a reader can check.
  assert.equal(lineage.separation.verifiedNumbersComeFromReleasedReceipt, true);
  assert.equal(lineage.separation.verifiedNumbersComparedAgainstIndependentExpectation, true);
  assert.equal(lineage.separation.explanationsAreNeverVerified, true);
  assert.equal(lineage.separation.explanationsCarryNoNumericField, true);
  assert.equal(lineage.separation.unavailableFactsAreNotRenderedAsNumbers, true);
  assert.equal(lineage.separation.completionIsTheReleasedState, true);
  assert.equal(lineage.separation.callerCompletionAssertionsAreNotAuthority, true);
  assert.equal(lineage.separation.callerRecomputedDigestIsNotAuthority, false);
  assert.equal(lineage.separation.effectJournalInvented, false);
  assert.match(lineage.lineageSha256, /^[a-f0-9]{64}$/);

  // The evidence the numbers rest on is the actual read evidence.
  assert.equal(lineage.verification.evidence.sourceByteSha256, journey.binding.sourceSha256);
  assert.equal(lineage.verification.evidence.canonicalHoldoutSha256, journey.binding.canonicalHoldoutSha256);
  assert.equal(lineage.verification.evidence.receiptSha256, journey.receiptSha256);
  assert.equal(lineage.verification.evidence.resultSha256, journey.resultSha256);
  assert.equal(lineage.verification.evidence.selfConsistencyIsNotAuthority, true);

  // The declared lineage kinds are exactly the four separations plus the optional effect.
  assert.deepEqual([...RESULT_LINEAGE_LINE_KINDS],
    ['VERIFIED_NUMBER', 'EXPLANATION', 'UNAVAILABLE_FACT', 'COMPLETION', 'SYNTHETIC_EFFECT']);

  // The lineage round-trips through its own verifier and is refusal-checked on substitution.
  const verified = verifyReadOnlyResultLineage({ lineage, ...input });
  assert.equal(verified.lineageSha256, lineage.lineageSha256);
  assert.equal(await denialOf(() => verifyReadOnlyResultLineage({
    lineage: { ...lineage, lineageId: 'tampered' }, ...input,
  })), 'KS247_LINEAGE_DENIED:LINEAGE_SUBSTITUTION');
});

test('AC02/AC03 the lineage is deterministic and every rendering separates the four facts', async () => {
  const journey = await journeyFor();
  const first = buildReadOnlyResultLineage(lineageInput(journey));
  const second = buildReadOnlyResultLineage(lineageInput(journey));
  assert.equal(first.lineageSha256, second.lineageSha256);

  const json = renderResultLineage(first, 'JSON');
  const table = renderResultLineage(first, 'TABLE');
  const html = renderResultLineage(first, 'HTML');
  assert.deepEqual([...RESULT_LINEAGE_FORMATS], ['JSON', 'TABLE', 'HTML']);
  assert.equal(canonicalRoundTrip(json).lineageSha256, first.lineageSha256);

  for (const text of [table, html]) {
    assert.match(text, /verified/i);
    assert.match(text, /UNVERIFIED/);
    assert.match(text, /UNAVAILABLE/);
    assert.match(text, /NOT_INVENTED_READ_ONLY_JOURNEY/);
    assert.match(text, /NOT_INTEGRATED/);
    // A verified number appears as a number, and an unavailable fact never appears as one.
    assert.match(text, /100059/);
    assert.doesNotMatch(text, /gross_margin\|\s*[0-9]/);
  }
  // The explanation text is present in the rendering, but only under the UNVERIFIED label.
  assert.match(table, /hypothesis-mix-shift/);
  assert.match(table, /## explanation \(UNVERIFIED free-form text, not a verified fact\)/);
  assert.match(html, /Explanation \(UNVERIFIED free-form text\)/);
  assert.equal(await denialOf(() => renderResultLineage(first, 'XML')),
    'KS247_LINEAGE_DENIED:RENDER_FORMAT');
});

function canonicalRoundTrip(json) {
  return JSON.parse(json);
}

test('AC03/AC04 a NON-complete read keeps a valid completion and presents no verified number', async () => {
  // A database whose content no longer reproduces the bound source: the retained composition
  // returns a DENIED receipt rather than a result, so there is nothing to verify.
  const database = buildUnfamiliarSyntheticDatabase();
  database.query = async () => ({ rows: [{
    pf_id: 's-001', val_dt: '2026-06-01', ev_typ: 'P', amt_a: 999999, ccy: 'EUR',
  }] });
  const journey = await journeyFor({ database });
  assert.equal(journey.executed, false);
  assert.equal(journey.acceptance.denialReasonCode, 'KS246_SOURCE_TABLE_SUBSTITUTED');

  const lineage = buildReadOnlyResultLineage(lineageInput(journey));
  assert.equal(lineage.observationKind, 'NON_COMPLETE_OBSERVATION');
  assert.equal(lineage.sections.completion.complete, false);
  assert.equal(lineage.sections.completion.state, 'DENIED');
  assert.equal(lineage.sections.completion.denialReasonCode, 'KS246_SOURCE_TABLE_SUBSTITUTED');
  assert.equal(lineage.sections.completion.oracleEquality, 'NOT_EVALUATED');
  assert.equal(lineage.sections.completion.resultAvailable, false);
  assert.equal(lineage.sections.completion.completionSource, 'RELEASED_EXECUTION_RECEIPT_STATE');
  assert.equal(lineage.sections.verifiedNumbers.length, 0, 'no completion means no verified number');
  assert.equal(lineage.verification.verifiedNumberCount, 0);
  assert.equal(lineage.sections.unavailableFacts.length, 24);
  assert.ok(lineage.sections.unavailableFacts.every(
    ({ reasonCode }) => reasonCode === 'NO_COMPLETED_READ_ONLY_EXECUTION',
  ));
  assert.equal(lineage.sections.completion.complete, false);
  // No invented effect journal either.
  assert.equal(lineage.verification.effectJournal, 'NOT_INVENTED_READ_ONLY_JOURNEY');
});

// ---------------------------------------------------------------------------------
// AC02 — the exact boundary rejects: wrong number / wrong unit / wrong period.
// ---------------------------------------------------------------------------------
test('AC02 a wrong NUMBER is refused by name, and the true number is accepted (positive counterpart)', async () => {
  const journey = await journeyFor();
  assert.equal(await denialOf(() => buildReadOnlyResultLineage(lineageInput(journey, {
    expectation: expectationFrom((value) => { value.expectedNumbers['periods.current.netMinorUnits'] = 999999; }),
  }))), 'KS247_LINEAGE_DENIED:WRONG_NUMBER');
  assert.equal(await denialOf(() => buildReadOnlyResultLineage(lineageInput(journey, {
    expectation: expectationFrom((value) => { value.expectedNumbers.deltaMinorUnits = 70060; }),
  }))), 'KS247_LINEAGE_DENIED:WRONG_NUMBER');
  assert.equal(await denialOf(() => buildReadOnlyResultLineage(lineageInput(journey, {
    expectation: expectationFrom((value) => { value.expectedNumbers['unknown.unquantifiedCount'] = 3; }),
  }))), 'KS247_LINEAGE_DENIED:WRONG_NUMBER');
  // Counterpart: the same expectation with the true integers is accepted.
  assert.equal(buildReadOnlyResultLineage(lineageInput(journey)).verification.verifiedNumberCount, 24);
});

test('AC02 a wrong UNIT is refused by name, and the released unit is accepted (positive counterpart)', async () => {
  const journey = await journeyFor();
  assert.equal(await denialOf(() => buildReadOnlyResultLineage(lineageInput(journey, {
    expectation: expectationFrom((value) => {
      value.unit = { id: 'CHF_MINOR_UNITS', currency: 'CHF', minorUnitsPerMajorUnit: 100, amountUnit: 'MINOR_UNITS' };
    }),
  }))), 'KS247_LINEAGE_DENIED:WRONG_UNIT');
  // A unit that is the right currency but the wrong arithmetic unit is refused too: the
  // released arithmetic is integer minor units, not major units.
  assert.equal(await denialOf(() => buildReadOnlyResultLineage(lineageInput(journey, {
    expectation: expectationFrom((value) => {
      value.unit = { id: 'EUR_MINOR_UNITS', currency: 'EUR', minorUnitsPerMajorUnit: 1, amountUnit: 'MINOR_UNITS' };
    }),
  }))), 'KS247_LINEAGE_DENIED:WRONG_UNIT');
  // Counterpart: the released EUR minor unit is accepted and IS the run's unit.
  const lineage = buildReadOnlyResultLineage(lineageInput(journey));
  assert.equal(lineage.verification.unit.id, `EUR_MINOR_UNITS`);
  assert.equal(lineage.verification.unit.currency, contract.currency.code);
  assert.equal(lineage.verification.unit.minorUnitsPerMajorUnit, contract.currency.minorUnitsPerMajorUnit);
});

test('AC02 a wrong PERIOD is refused by name, and the released windows are accepted (positive counterpart)', async () => {
  const journey = await journeyFor();
  assert.equal(await denialOf(() => buildReadOnlyResultLineage(lineageInput(journey, {
    expectation: expectationFrom((value) => { value.periods.current.end = '2026-07-30'; }),
  }))), 'KS247_LINEAGE_DENIED:WRONG_PERIOD');
  assert.equal(await denialOf(() => buildReadOnlyResultLineage(lineageInput(journey, {
    expectation: expectationFrom((value) => { value.periods.comparison.label = '2026-05'; }),
  }))), 'KS247_LINEAGE_DENIED:WRONG_PERIOD');
  assert.equal(await denialOf(() => buildReadOnlyResultLineage(lineageInput(journey, {
    expectation: expectationFrom((value) => { delete value.periods.comparison; }),
  }))), 'KS247_LINEAGE_DENIED:WRONG_PERIOD');
  // Counterpart: the released windows are accepted and carried per verified number.
  const lineage = buildReadOnlyResultLineage(lineageInput(journey));
  assert.deepEqual(lineage.verification.periods, expectation.periods);
  const current = lineage.sections.verifiedNumbers.find(({ lineId }) => lineId === 'periods.current.netMinorUnits');
  assert.deepEqual(current.periodWindow, contract.periods.current);
});

test('AC02 a substituted CONTRACT is refused before any number is compared', async () => {
  const journey = await journeyFor();
  assert.equal(await denialOf(() => buildReadOnlyResultLineage(lineageInput(journey, {
    metricContractBytes: mutateJson(contractBytes, (value) => { value.currency.code = 'CHF'; }),
  }))), 'KS247_LINEAGE_DENIED:CONTRACT_SUBSTITUTED');
  // Counterpart: the released contract is the one the journey bound.
  const lineage = buildReadOnlyResultLineage(lineageInput(journey));
  assert.equal(lineage.verification.verifiedNumberCount, 24);
  assert.equal(journey.binding.releasedContractSha256, sha256(contractBytes));
});

// ---------------------------------------------------------------------------------
// AC02 — source substitution with a CALLER-RECOMPUTED digest.
// ---------------------------------------------------------------------------------
test('AC02 a source substitution is refused even when the caller recomputes its own digest', async () => {
  const journey = await journeyFor();
  // The caller substituted the source bytes and recomputed the digest correctly: the claim is
  // internally consistent, and it is still not the maintained pin.
  const substitutedDigest = sha256(Buffer.from('{"substituted":"authored synthetic bytes"}', 'utf8'));
  assert.notEqual(substitutedDigest, expectation.current.sourceByteSha256);
  assert.equal(await denialOf(() => buildReadOnlyResultLineage(lineageInput(journey, {
    evidenceClaim: claimFor(journey, {
      sourceByteSha256: substitutedDigest,
      recomputedByCaller: true,
    }),
  }))), 'KS247_LINEAGE_DENIED:SOURCE_SUBSTITUTED');

  // Same statement, carried by the ACTUAL journey binding: a read bound to another source is
  // refused too, so neither side of the comparison can be moved alone.
  const rebound = { ...journey, binding: { ...journey.binding, sourceByteSha256: substitutedDigest, sourceSha256: substitutedDigest } };
  assert.equal(await denialOf(() => buildReadOnlyResultLineage(lineageInput(rebound, {
    evidenceClaim: claimFor(journey, { sourceByteSha256: substitutedDigest, recomputedByCaller: true }),
  }))), 'KS247_LINEAGE_DENIED:SOURCE_SUBSTITUTED');

  // A resealed source digest that agrees with the run but not with the maintained expectation.
  const shadowed = '0'.repeat(64);
  assert.equal(await denialOf(() => buildReadOnlyResultLineage(lineageInput(
    { ...journey, binding: { ...journey.binding, sourceSha256: shadowed } },
    { evidenceClaim: claimFor(journey, { sourceByteSha256: shadowed, recomputedByCaller: true }) },
  ))), 'KS247_LINEAGE_DENIED:SOURCE_SUBSTITUTED');

  // Counterpart 1: the unsubstituted source is accepted, and it is the one the released
  // confinement read (the retained KS246 composition refuses a resealed source earlier).
  const lineage = buildReadOnlyResultLineage(lineageInput(journey));
  assert.equal(lineage.verification.evidence.sourceByteSha256, sha256(sourceBytes));
  assert.equal(lineage.verification.evidence.sourceByteSha256, expectation.current.sourceByteSha256);
  assert.equal(lineage.separation.callerRecomputedDigestIsNotAuthority, false);
  // Counterpart 2: an HONEST caller that recomputes the digest itself and arrives at the
  // maintained value is accepted, and the recomputation is RECORDED rather than trusted.
  const honest = buildReadOnlyResultLineage(lineageInput(journey, {
    evidenceClaim: claimFor(journey, { recomputedByCaller: true }),
  }));
  assert.equal(honest.separation.callerRecomputedDigestIsNotAuthority, true);
  assert.equal(honest.verification.verifiedNumberCount, 24);
});

test('AC02 stale evidence and non-current evidence are distinguishable facts', async () => {
  const journey = await journeyFor();
  const superseded = expectation.supersededEvidence[0].evidenceSha256;
  assert.notEqual(superseded, expectation.current.sourceByteSha256);
  // Stale: the claim rests on the DISCOVERY revision's superseded observation.
  assert.equal(await denialOf(() => buildReadOnlyResultLineage(lineageInput(journey, {
    evidenceClaim: claimFor(journey, { sourceByteSha256: superseded }),
  }))), 'KS247_LINEAGE_DENIED:STALE_EVIDENCE');
  assert.equal(await denialOf(() => buildReadOnlyResultLineage(lineageInput(journey, {
    evidenceClaim: claimFor(journey, {
      canonicalHoldoutSha256: expectation.supersededEvidence[1].evidenceSha256,
    }),
  }))), 'KS247_LINEAGE_DENIED:STALE_EVIDENCE');
  // Not current: a well-formed digest that is simply not the maintained one.
  assert.equal(await denialOf(() => buildReadOnlyResultLineage(lineageInput(journey, {
    evidenceClaim: claimFor(journey, { canonicalHoldoutSha256: '2'.repeat(64) }),
  }))), 'KS247_LINEAGE_DENIED:EVIDENCE_NOT_CURRENT');
  // A lineage built over a journey that claims a stale source revision.
  assert.equal(await denialOf(() => buildReadOnlyResultLineage(lineageInput(journey, {
    journey: { ...journey, binding: { ...journey.binding, sourceRevision: 'synthetic-unfamiliar-v1' } },
  }))), 'KS247_LINEAGE_DENIED:SOURCE_REVISION_STALE');
  // Counterpart: the maintained current evidence is accepted.
  assert.equal(buildReadOnlyResultLineage(lineageInput(journey)).verification.verifiedNumberCount, 24);
});

test('AC02 a missing evidence claim or a missing maintained expectation denies rather than defaults', async () => {
  const journey = await journeyFor();
  assert.equal(await denialOf(() => buildReadOnlyResultLineage({
    journey, expectation, metricContractBytes: contractBytes, evidenceClaim: null,
  })), 'KS247_LINEAGE_DENIED:MISSING_EVIDENCE_CLAIM');
  assert.equal(await denialOf(() => buildReadOnlyResultLineage({
    journey, expectation: {}, metricContractBytes: contractBytes, evidenceClaim: claimFor(journey),
  })), 'KS247_LINEAGE_DENIED:MISSING_INDEPENDENT_EXPECTATION');
  // A maintained expectation that pins a number as BOTH expected and unavailable denies.
  assert.equal(await loadIndependentExpectationAsync((value) => {
    value.unavailableFacts[0].subject = 'deltaMinorUnits';
  }), 'KS247_EXPECTATION_DENIED:UNAVAILABLE_IS_EXPECTED');
});

async function loadIndependentExpectationAsync(mutate) {
  try {
    loadIndependentExpectation(mutateJson(expectationBytes, mutate));
    return 'ACCEPTED';
  } catch (error) {
    return error.code ?? String(error.message ?? error);
  }
}

// ---------------------------------------------------------------------------------
// AC03 — explanation may never be presented as verified.
// ---------------------------------------------------------------------------------
test('AC03 an unsupported causal, completion or explanation assertion presented as verified is refused', async () => {
  const journey = await journeyFor();
  assert.equal(await denialOf(() => buildReadOnlyResultLineage(lineageInput(journey, {
    explanation: explanationFrom([{ assertionId: 'c1', kind: 'CAUSAL', text: 'the campaign caused the delta', assertedAsVerified: true }]),
  }))), 'KS247_LINEAGE_DENIED:UNSUPPORTED_CAUSAL_ASSERTION');
  assert.equal(await denialOf(() => buildReadOnlyResultLineage(lineageInput(journey, {
    explanation: explanationFrom([{ assertionId: 'k1', kind: 'COMPLETION', text: 'the run completed', assertedAsVerified: true }]),
  }))), 'KS247_LINEAGE_DENIED:UNSUPPORTED_COMPLETION_ASSERTION');
  assert.equal(await denialOf(() => buildReadOnlyResultLineage(lineageInput(journey, {
    explanation: explanationFrom([{ assertionId: 'p1', kind: 'DESCRIPTIVE', text: 'prose', assertedAsVerified: true }]),
  }))), 'KS247_LINEAGE_DENIED:EXPLANATION_PRESENTED_AS_VERIFIED');
  // An unavailable fact asserted AS a number is refused: it is not a fact this surface has.
  assert.equal(await denialOf(() => buildReadOnlyResultLineage(lineageInput(journey, {
    explanation: explanationFrom([{ assertionId: 'gross_margin', kind: 'NUMBER', text: 'gross margin was 12 percent', assertedAsVerified: true }]),
  }))), 'KS247_LINEAGE_DENIED:UNAVAILABLE_FACT_ASSERTED');
  assert.equal(await denialOf(() => buildReadOnlyResultLineage(lineageInput(journey, {
    explanation: explanationFrom([{ assertionId: 'order_intake', kind: 'NUMBER', text: 'order intake rose', assertedAsVerified: true }]),
  }))), 'KS247_LINEAGE_DENIED:UNAVAILABLE_FACT_ASSERTED');

  // Counterparts: the SAME assertions are permitted as UNVERIFIED prose, and become no number.
  for (const assertions of [
    [{ assertionId: 'c2', kind: 'CAUSAL', text: 'the campaign may have caused the delta' }],
    [{ assertionId: 'k2', kind: 'COMPLETION', text: 'the run appears complete' }],
    [{ assertionId: 'p2', kind: 'DESCRIPTIVE', text: 'prose' }],
  ]) {
    const lineage = buildReadOnlyResultLineage(lineageInput(journey, {
      explanation: explanationFrom(assertions),
    }));
    assert.equal(lineage.sections.explanations.length, 1);
    assert.equal(lineage.sections.explanations[0].verified, false);
    assert.equal(lineage.sections.explanations[0].presentedAsVerified, false);
    assert.equal(lineage.verification.verifiedNumberCount, 24, 'prose adds no verified number');
  }
});

test('AC03 an explanation may not carry a numeric payload at all', async () => {
  assert.equal(await denialOf(async () => loadFreeExplanation({
    schemaVersion: RESULT_LINEAGE_EXPLANATION_SCHEMA,
    issue: 'KS-EVO-02',
    assertions: [{ assertionId: 'n1', kind: 'DESCRIPTIVE', text: 'prose', value: 70059 }],
  })), 'KS247_EXPLANATION_DENIED:ASSERTION');
  assert.equal(await denialOf(async () => loadFreeExplanation({
    schemaVersion: RESULT_LINEAGE_EXPLANATION_SCHEMA,
    issue: 'KS-EVO-02',
    assertions: [{ assertionId: 'n2', kind: 'MEASURED', text: 'prose' }],
  })), 'KS247_EXPLANATION_DENIED:ASSERTION_KIND');
  assert.equal(await denialOf(async () => loadFreeExplanation({
    schemaVersion: RESULT_LINEAGE_EXPLANATION_SCHEMA,
    issue: 'KS-EVO-02',
    assertions: [
      { assertionId: 'n3', kind: 'DESCRIPTIVE', text: 'prose' },
      { assertionId: 'n3', kind: 'DESCRIPTIVE', text: 'prose again' },
    ],
  })), 'KS247_EXPLANATION_DENIED:DUPLICATE_ASSERTION:n3');
  // Counterpart: text-only assertions load, and the loader itself reports them unverified.
  const loaded = loadFreeExplanation(explanationBytes);
  assert.equal(loaded.verified, false);
  assert.equal(loaded.assertions.length, 3);
  assert.match(loaded.explanationSha256, /^[a-f0-9]{64}$/);
});

// ---------------------------------------------------------------------------------
// AC04 — effect handling: no invented journal, separately confirmed status only.
// ---------------------------------------------------------------------------------
test('AC04 a synthetic effect shown without a separately confirmed status is a fabricated journal', async () => {
  const journey = await journeyFor();
  assert.equal(await denialOf(() => buildReadOnlyResultLineage(lineageInput(journey, {
    explanation: explanationFrom([{ assertionId: 'e1', kind: 'EFFECT', text: 'a synthetic effect was applied' }]),
    effectStatus: null,
  }))), 'KS247_LINEAGE_DENIED:FABRICATED_EFFECT_JOURNAL');
  assert.equal(await denialOf(() => buildReadOnlyResultLineage(lineageInput(journey, {
    explanation: explanationFrom([{ assertionId: 'e2', kind: 'EFFECT', text: 'x', assertedAsVerified: true }]),
    effectStatus: null,
  }))), 'KS247_LINEAGE_DENIED:FABRICATED_EFFECT_JOURNAL');
  // An effect status whose confirmation is inferred from the read itself is not a confirmation.
  assert.equal(await denialOf(async () => loadConfirmedEffectStatus({
    schemaVersion: RESULT_LINEAGE_EFFECT_STATUS_SCHEMA,
    issue: 'KS-EVO-02',
    sourceRevision: SOURCE_REVISION,
    mutationAuthority: false,
    effects: [{
      effectId: 'eff-1',
      kind: 'SYNTHETIC_EFFECT',
      status: 'SYNTHETIC_EFFECT_CONFIRMED_APPLIED',
      separateConfirmation: { kind: 'INFERRED_FROM_READ', confirmationId: 'self', confirmationSha256: '3'.repeat(64) },
    }],
  })), 'KS247_EFFECT_STATUS_DENIED:EFFECT_STATUS_NOT_SEPARATELY_CONFIRMED');
  // A status outside the closed vocabulary is refused.
  assert.equal(await denialOf(async () => loadConfirmedEffectStatus({
    schemaVersion: RESULT_LINEAGE_EFFECT_STATUS_SCHEMA,
    issue: 'KS-EVO-02',
    sourceRevision: SOURCE_REVISION,
    mutationAuthority: false,
    effects: [{
      effectId: 'eff-2',
      kind: 'SYNTHETIC_EFFECT',
      status: 'EFFECT_APPLIED',
      separateConfirmation: { kind: 'AUTHORED_SEPARATE_CONFIRMATION', confirmationId: 'c', confirmationSha256: '4'.repeat(64) },
    }],
  })), 'KS247_EFFECT_STATUS_DENIED:EFFECT_STATUS');
  // A read-only lineage may not carry an effect-status input that claims mutation authority.
  assert.equal(await denialOf(async () => loadConfirmedEffectStatus({
    schemaVersion: RESULT_LINEAGE_EFFECT_STATUS_SCHEMA,
    issue: 'KS-EVO-02',
    sourceRevision: SOURCE_REVISION,
    mutationAuthority: true,
    effects: [],
  })), 'KS247_EFFECT_STATUS_DENIED:READ_ONLY_EFFECT_CLAIM_DENIED');

  // Counterpart: with a SEPARATELY CONFIRMED status the synthetic effect is shown as what it
  // is, and it is never presented as applied when the confirmation says it was not.
  const confirmed = loadConfirmedEffectStatus({
    schemaVersion: RESULT_LINEAGE_EFFECT_STATUS_SCHEMA,
    issue: 'KS-EVO-02',
    sourceRevision: SOURCE_REVISION,
    mutationAuthority: false,
    effects: [{
      effectId: 'eff-synthetic-1',
      kind: 'SYNTHETIC_EFFECT',
      status: 'SYNTHETIC_EFFECT_CONFIRMED_NOT_APPLIED',
      separateConfirmation: {
        kind: 'AUTHORED_SEPARATE_CONFIRMATION',
        confirmationId: 'ks247-separate-effect-confirmation-1',
        confirmationSha256: '5'.repeat(64),
      },
    }],
  });
  const lineage = buildReadOnlyResultLineage(lineageInput(journey, {
    explanation: explanationFrom([{ assertionId: 'e3', kind: 'EFFECT', text: 'a synthetic effect is reported from a separately confirmed status' }]),
    effectStatus: confirmed,
  }));
  assert.equal(lineage.sections.syntheticEffects.length, 1);
  assert.equal(lineage.sections.syntheticEffects[0].status, 'SYNTHETIC_EFFECT_CONFIRMED_NOT_APPLIED');
  assert.equal(lineage.sections.syntheticEffects[0].presentedAsApplied, false);
  assert.equal(lineage.sections.syntheticEffects[0].derivedFromReadSuccess, false);
  assert.equal(lineage.verification.effectJournal, 'CONSUMED_SEPARATELY_CONFIRMED_EFFECT_STATUS');
  assert.equal(lineage.verification.separatelyConfirmedEffects, true);
  // ... and the read-only journey's own empty effect set still declares no journal.
  assert.equal(buildReadOnlyResultLineage(lineageInput(journey)).verification.effectJournal,
    'NOT_INVENTED_READ_ONLY_JOURNEY');
  assert.deepEqual([...RESULT_LINEAGE_EFFECT_STATUSES], [
    'EFFECT_NOT_APPLIED_READ_ONLY',
    'SYNTHETIC_EFFECT_CONFIRMED_APPLIED',
    'SYNTHETIC_EFFECT_CONFIRMED_NOT_APPLIED',
    'SYNTHETIC_EFFECT_STATUS_UNKNOWN',
  ]);
});

// ---------------------------------------------------------------------------------
// RED/GREEN on disposable broken variants: the guard is the reason the negative holds.
// ---------------------------------------------------------------------------------
test('RED/GREEN: a variant that trusts the caller-recomputed digest accepts the substitution', async () => {
  const source = await readFile(MODULE_PATH, 'utf8');
  const broken = source.replace(
    `  if (evidenceClaim.sourceByteSha256 !== expectation.current.sourceByteSha256
      || binding.sourceSha256 !== expectation.current.sourceByteSha256) {
    fail('KS247_LINEAGE_DENIED:SOURCE_SUBSTITUTED');
  }`,
    `  if (evidenceClaim.sourceByteSha256 !== binding.sourceSha256) {
    fail('KS247_LINEAGE_DENIED:SOURCE_SUBSTITUTED');
  }`,
  );
  assert.notEqual(broken, source, 'the sabotage must actually change the module');
  const variantPath = join(ROOT, 'services/bi-control/src/business-bi/.ks247-variant-self-consistent-digest.test.mjs');
  writeFileSync(variantPath, broken);
  const journey = await journeyFor();
  const shadowed = '0'.repeat(64);
  const variantInput = lineageInput(
    { ...journey, binding: { ...journey.binding, sourceSha256: shadowed } },
    { evidenceClaim: claimFor(journey, { sourceByteSha256: shadowed, recomputedByCaller: true }) },
  );
  try {
    const variant = await import('../services/bi-control/src/business-bi/.ks247-variant-self-consistent-digest.test.mjs');
    // RED: with the pin replaced by self-consistency, the substituted source is ACCEPTED.
    const accepted = variant.buildReadOnlyResultLineage(variantInput);
    assert.equal(accepted.verification.evidence.sourceByteSha256, shadowed);
    assert.equal(accepted.verification.verifiedNumberCount, 24);
  } finally {
    rmSync(variantPath, { force: true });
  }
  // GREEN: the real module refuses the exact same input, because it compares against the pin.
  assert.equal(await denialOf(() => buildReadOnlyResultLineage(variantInput)),
    'KS247_LINEAGE_DENIED:SOURCE_SUBSTITUTED');
});

test('RED/GREEN: a variant with the verified-marking gate removed presents prose as verified', async () => {
  const source = await readFile(MODULE_PATH, 'utf8');
  const broken = source.replace('    if (assertion.assertedAsVerified) {', '    if (false) {');
  assert.notEqual(broken, source, 'the sabotage must actually change the module');
  const variantPath = join(ROOT, 'services/bi-control/src/business-bi/.ks247-variant-verified-prose.test.mjs');
  writeFileSync(variantPath, broken);
  const journey = await journeyFor();
  const causality = explanationFrom([{
    assertionId: 'c-red', kind: 'CAUSAL', text: 'the campaign caused the delta', assertedAsVerified: true,
  }]);
  try {
    const variant = await import('../services/bi-control/src/business-bi/.ks247-variant-verified-prose.test.mjs');
    // RED: with the gate removed, a causal assertion marked as verified is accepted silently.
    const accepted = variant.buildReadOnlyResultLineage(lineageInput(journey, { explanation: causality }));
    assert.equal(accepted.sections.explanations.length, 1);
    assert.equal(accepted.sections.explanations[0].verified, false);
  } finally {
    rmSync(variantPath, { force: true });
  }
  // GREEN: the real module refuses the same assertion by name.
  assert.equal(await denialOf(() => buildReadOnlyResultLineage(lineageInput(journey, {
    explanation: causality,
  }))), 'KS247_LINEAGE_DENIED:UNSUPPORTED_CAUSAL_ASSERTION');
});

// ---------------------------------------------------------------------------------
// The real CLI entry point.
// ---------------------------------------------------------------------------------
test('the CLI --negative mode reports its exact rejection codes and accepts nothing', () => {
  const out = cli(['--negative']);
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stderr, '');
  const report = JSON.parse(out.stdout);
  assert.equal(report.mode, 'negative');
  const codes = Object.fromEntries(report.codes.map((entry) => entry.split('=')));
  for (const [label, code] of Object.entries(codes)) {
    assert.doesNotMatch(code, /UNEXPECTEDLY_ACCEPTED/, `${label} must be refused`);
  }
  assert.equal(codes['wrong-number'], 'KS247_LINEAGE_DENIED:WRONG_NUMBER');
  assert.equal(codes['wrong-unit'], 'KS247_LINEAGE_DENIED:WRONG_UNIT');
  assert.equal(codes['wrong-period'], 'KS247_LINEAGE_DENIED:WRONG_PERIOD');
  assert.equal(codes['source-substitution-with-recomputed-digest'], 'KS247_LINEAGE_DENIED:SOURCE_SUBSTITUTED');
  assert.equal(codes['stale-evidence'], 'KS247_LINEAGE_DENIED:STALE_EVIDENCE');
  assert.equal(codes['evidence-not-current'], 'KS247_LINEAGE_DENIED:EVIDENCE_NOT_CURRENT');
  assert.equal(codes['evidence-claim-source-revision-stale'],
    'KS247_LINEAGE_DENIED:EVIDENCE_SOURCE_REVISION_STALE');
  assert.equal(codes['evidence-claim-result-digest-mismatch'],
    'KS247_LINEAGE_DENIED:EVIDENCE_RESULT_DIGEST_MISMATCH');
  assert.equal(codes['contract-substituted'], 'KS247_LINEAGE_DENIED:CONTRACT_SUBSTITUTED');
  assert.equal(codes['causal-assertion-presented-as-verified'], 'KS247_LINEAGE_DENIED:UNSUPPORTED_CAUSAL_ASSERTION');
  assert.equal(codes['completion-assertion-presented-as-verified'], 'KS247_LINEAGE_DENIED:UNSUPPORTED_COMPLETION_ASSERTION');
  assert.equal(codes['unavailable-fact-asserted'], 'KS247_LINEAGE_DENIED:UNAVAILABLE_FACT_ASSERTED');
  assert.equal(codes['fabricated-effect-journal'], 'KS247_LINEAGE_DENIED:FABRICATED_EFFECT_JOURNAL');
  assert.equal(codes['effect-status-not-separately-confirmed'],
    'KS247_EFFECT_STATUS_DENIED:EFFECT_STATUS_NOT_SEPARATELY_CONFIRMED');
  assert.equal(codes['read-only-effect-claim'], 'KS247_EFFECT_STATUS_DENIED:READ_ONLY_EFFECT_CLAIM_DENIED');
  assert.equal(codes['resealed-source-refused-by-released-confinement'],
    'KS246_JOURNEY_DENIED:SOURCE_NOT_COHERENT_WITH_RELEASED_HOLDOUT');
});

test('the CLI on EOF builds no lineage, and a missing caller input refuses before the read', () => {
  const eof = cli([]);
  assert.equal(eof.status, 0, eof.stderr);
  const eofSummary = JSON.parse(eof.stdout);
  assert.equal(eofSummary.mode, 'eof');
  assert.equal(eofSummary.lineage, null);
  assert.equal(eofSummary.executed, false);
  assert.equal(eofSummary.sharedReadPurposeBinding, 'NOT_INTEGRATED');
  assert.equal(eofSummary.ac05, 'PARENT_OWNED_OPEN');

  const missing = cliWithAnswers(CONFIRMED_ANSWERS, ['--business-semantics', BUSINESS_SEMANTICS_PATH,
    '--source-revision', SOURCE_REVISION]);
  assert.equal(missing.status, 0, missing.stderr);
  assert.equal(missing.summary.lineage, null);
  assert.equal(missing.summary.executed, false);
  assert.equal(missing.summary.journeyDenial.code, 'KS246_JOURNEY_DENIED:MISSING_KIND_DECISION_INPUT');
});

test('the CLI renders the four separated facts in JSON, TABLE and HTML', () => {
  const json = cliWithAnswers(CONFIRMED_ANSWERS,
    [...CALLER_ARGS, '--explanation', EXPLANATION_PATH, '--effect-status', EFFECT_STATUS_PATH, '--format', 'JSON']);
  assert.equal(json.status, 0, json.stderr);
  const lineage = json.summary;
  assert.equal(lineage.schemaVersion, RESULT_LINEAGE_SCHEMA);
  assert.equal(lineage.observationKind, 'COMPLETE_READ_ONLY_OBSERVATION');
  assert.equal(lineage.verification.verifiedNumberCount, 24);
  assert.equal(lineage.verification.unavailableFactCount, 4);
  assert.equal(lineage.verification.explanationCount, 3);
  assert.equal(lineage.sections.completion.complete, true);
  assert.equal(lineage.verification.effectJournal, 'NOT_INVENTED_READ_ONLY_JOURNEY');
  assert.equal(lineage.promotionBoundaries.sharedReadPurposeBinding, 'NOT_INTEGRATED');
  assert.equal(lineage.authority.publicationAuthority, 'NONE');

  for (const format of ['TABLE', 'HTML']) {
    const rendered = cliWithAnswers(CONFIRMED_ANSWERS,
      [...CALLER_ARGS, '--explanation', EXPLANATION_PATH, '--effect-status', EFFECT_STATUS_PATH,
        '--format', format]);
    assert.equal(rendered.status, 0, rendered.stderr);
    assert.match(rendered.stdout, /UNVERIFIED/);
    assert.match(rendered.stdout, /UNAVAILABLE/);
    assert.match(rendered.stdout, /100059/);
    assert.match(rendered.stdout, /70059/);
    const receipt = trailingReceipt(rendered.stdout);
    assert.equal(receipt.format, format);
    assert.equal(receipt.verifiedNumberCount, 24);
    assert.equal(receipt.unavailableFactCount, 4);
    assert.equal(receipt.explanationCount, 3);
    assert.equal(receipt.effectJournal, 'NOT_INVENTED_READ_ONLY_JOURNEY');
    assert.equal(receipt.complete, true);
    assert.equal(receipt.existingCompletion, undefined);
    assert.equal(receipt.sharedReadPurposeBinding, 'NOT_INTEGRATED');
    assert.equal(receipt.lineageSha256, lineage.lineageSha256, 'the rendering is the same lineage');
  }
  // An unsupported format is refused without reading anything.
  const badFormat = cliWithAnswers(CONFIRMED_ANSWERS, [...CALLER_ARGS, '--format', 'XML']);
  assert.equal(badFormat.status, 0, badFormat.stderr);
  assert.equal(badFormat.summary.cliDenial.code, 'KS247_CLI_FORMAT_DENIED');
});

test('the CLI refuses a caller-recomputed evidence claim for substituted bytes, end to end', () => {
  const journey = cliWithAnswers(CONFIRMED_ANSWERS, CALLER_ARGS);
  assert.equal(journey.status, 0, journey.stderr);
  assert.equal(journey.summary.bindingSha256, undefined, 'the JSON receipt is the lineage document');
  const scratch = mkdtempSync(join(tmpdir(), 'ks247-claim-'));
  try {
    const claimPath = join(scratch, 'claim.json');
    writeFileSync(claimPath, JSON.stringify({
      schemaVersion: RESULT_LINEAGE_EVIDENCE_CLAIM_SCHEMA,
      issue: 'KS-EVO-02',
      sourceRevision: SOURCE_REVISION,
      sourceByteSha256: sha256(Buffer.from('substituted synthetic bytes', 'utf8')),
      canonicalHoldoutSha256: journey.summary.verification.evidence.canonicalHoldoutSha256,
      resultSha256: journey.summary.verification.evidence.resultSha256,
      recomputedByCaller: true,
    }));
    const out = cliWithAnswers(CONFIRMED_ANSWERS, [...CALLER_ARGS, '--evidence-claim', claimPath]);
    assert.equal(out.status, 0, out.stderr);
    // The claim is refused, but the read itself DID complete: the observed execution is
    // reported separately from the verification status, and no verified number is emitted.
    assert.equal(out.summary.lineage, null);
    assert.equal(out.summary.executed, true);
    assert.equal(out.summary.observedCompletion.complete, true);
    assert.equal(out.summary.verification.status, 'REFUSED');
    assert.equal(out.summary.verification.verifiedNumberCount, 0);
    assert.equal(out.summary.journeyDenial.code, 'KS247_LINEAGE_DENIED:SOURCE_SUBSTITUTED');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  // Counterpart: the CLI's own observed-evidence claim is accepted.
  assert.equal(journey.summary.verification.evidence.recomputedByCaller, false);
  assert.equal(journey.summary.verification.verifiedNumberCount, 24);
});

test('the CLI reports a retained-composition refusal with no number presented as verified', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'ks247-resealed-'));
  try {
    const resealed = join(scratch, 'resealed.json');
    const copy = clone(sourceFixture);
    copy.rows[0].amt_a = 999999;
    writeFileSync(resealed, JSON.stringify(copy));
    const out = cliWithAnswers(CONFIRMED_ANSWERS, [...CALLER_ARGS, '--source', resealed]);
    assert.equal(out.status, 0, out.stderr);
    assert.equal(out.summary.lineage, null);
    // This refusal happens BEFORE any read: the released confinement denies the resealed source
    // at bind time, so there is no observed completion to report.
    assert.equal(out.summary.executed, false);
    assert.equal(out.summary.observedCompletion, null);
    assert.equal(out.summary.journeyDenial.code, 'KS246_JOURNEY_DENIED:SOURCE_NOT_COHERENT_WITH_RELEASED_HOLDOUT');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------
// Independent-focused-review corrections B1 and B2.  Both are driven through the ACTUAL CLI
// entry point, not by re-stating its control flow.
//
// Disposable CLI variants: a regression runs a byte-copy of the real CLI against a sabotaged
// module (or a sabotaged copy of the CLI itself) and then removes both.  The variant CLI lives
// in `scripts/` and the variant module in the module's own directory, so every relative import
// resolves exactly as it does for the real entry point.
// ---------------------------------------------------------------------------------
const variantTag = () => `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

function writeVariantModule(source) {
  const name = `.ks247-variant-${variantTag()}.mjs`;
  const target = join(ROOT, 'services/bi-control/src/business-bi', name);
  writeFileSync(target, source);
  return { abs: target, rel: `../services/bi-control/src/business-bi/${name}` };
}

function writeVariantCli(source, moduleRel = null) {
  const name = `.ks247-variant-cli-${variantTag()}.mjs`;
  const target = join(ROOT, 'scripts', name);
  const body = moduleRel === null ? source : source.replace(
    "} from '../services/bi-control/src/business-bi/result-lineage-v1.mjs';",
    `} from '${moduleRel}';`,
  );
  if (moduleRel !== null) assert.notEqual(body, source, 'the variant CLI must import the variant module');
  writeFileSync(target, body);
  return target;
}

function evidenceClaimJson(evidence, overrides = {}) {
  return JSON.stringify({
    schemaVersion: RESULT_LINEAGE_EVIDENCE_CLAIM_SCHEMA,
    issue: 'KS-EVO-02',
    sourceRevision: evidence.sourceRevision,
    sourceByteSha256: evidence.sourceByteSha256,
    canonicalHoldoutSha256: evidence.canonicalHoldoutSha256,
    resultSha256: evidence.resultSha256,
    ...overrides,
  });
}

test("AC02 the CLI compares an evidence claim's OWN revision and result digest with the observed read (B1)", () => {
  const scratch = mkdtempSync(join(tmpdir(), 'ks247-claim-identity-'));
  try {
    // The observed identities, taken from the CLI's OWN honest run.
    const positive = cliWithAnswers(CONFIRMED_ANSWERS, [...CALLER_ARGS, '--format', 'JSON']);
    assert.equal(positive.status, 0, positive.stderr);
    const observed = positive.summary.verification.evidence;
    assert.equal(observed.sourceRevision, SOURCE_REVISION);
    assert.equal(observed.resultSha256, positive.summary.sections.completion.resultSha256);

    // POSITIVE counterpart: a claim naming the ACTUAL observed identities is accepted and
    // still renders all 24 verified numbers.
    const honestPath = join(scratch, 'honest.json');
    writeFileSync(honestPath, evidenceClaimJson(observed));
    const honest = cliWithAnswers(CONFIRMED_ANSWERS, [...CALLER_ARGS, '--evidence-claim', honestPath]);
    assert.equal(honest.status, 0, honest.stderr);
    assert.equal(honest.summary.verification.verifiedNumberCount, 24);
    assert.equal(honest.summary.sourceRevision, SOURCE_REVISION);

    // NEGATIVE 1: change ONLY sourceRevision, to the stale discovery revision.
    const stalePath = join(scratch, 'stale-revision.json');
    writeFileSync(stalePath, evidenceClaimJson(observed, { sourceRevision: 'synthetic-unfamiliar-v1' }));
    const stale = cliWithAnswers(CONFIRMED_ANSWERS, [...CALLER_ARGS, '--evidence-claim', stalePath]);
    assert.equal(stale.status, 0, stale.stderr);
    assert.equal(stale.summary.lineage, null, 'a stale-revision claim must render no verified number');
    assert.equal(stale.summary.verification.verifiedNumberCount, 0);
    assert.equal(stale.summary.journeyDenial.code, 'KS247_LINEAGE_DENIED:EVIDENCE_SOURCE_REVISION_STALE');

    // NEGATIVE 2: change ONLY resultSha256, to 64 zeros.
    const zeroPath = join(scratch, 'zero-result.json');
    writeFileSync(zeroPath, evidenceClaimJson(observed, { resultSha256: '0'.repeat(64) }));
    const zero = cliWithAnswers(CONFIRMED_ANSWERS, [...CALLER_ARGS, '--evidence-claim', zeroPath]);
    assert.equal(zero.status, 0, zero.stderr);
    assert.equal(zero.summary.lineage, null, 'a contradictory result digest must render no verified number');
    assert.equal(zero.summary.verification.verifiedNumberCount, 0);
    assert.equal(zero.summary.journeyDenial.code, 'KS247_LINEAGE_DENIED:EVIDENCE_RESULT_DIGEST_MISMATCH');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('RED/GREEN: without the claim-identity comparison the CLI renders 24 verified numbers for a stale revision (B1)', async () => {
  const moduleSource = await readFile(MODULE_PATH, 'utf8');
  const brokenModule = moduleSource
    .replace(
      "  if (evidenceClaim.sourceRevision !== binding.sourceRevision\n"
      + '      || evidenceClaim.sourceRevision !== expectation.current.sourceRevision) {',
      '  if (false) {',
    )
    .replace(
      '  if ((evidenceClaim.resultSha256 ?? null) !== (journey.resultSha256 ?? null)) {',
      '  if (false) {',
    );
  assert.notEqual(brokenModule, moduleSource, 'the sabotage must actually change the module');
  const variantModule = writeVariantModule(brokenModule);
  const variantCli = writeVariantCli(await readFile(CLI_PATH, 'utf8'), variantModule.rel);
  const scratch = mkdtempSync(join(tmpdir(), 'ks247-b1-red-'));
  try {
    const observed = cliWithAnswers(CONFIRMED_ANSWERS, [...CALLER_ARGS, '--format', 'JSON'])
      .summary.verification.evidence;
    const stalePath = join(scratch, 'stale-revision.json');
    writeFileSync(stalePath, evidenceClaimJson(observed, { sourceRevision: 'synthetic-unfamiliar-v1' }));

    // RED: the variant CLI ACCEPTS the stale-revision claim and attributes 24 verified numbers
    // to a revision the read never observed.
    const red = cliWithAnswers(CONFIRMED_ANSWERS, [...CALLER_ARGS, '--evidence-claim', stalePath], variantCli);
    assert.equal(red.summary.lineage === null, false, 'the sabotaged CLI accepts the stale claim');
    assert.equal(red.summary.verification.verifiedNumberCount, 24);
    assert.equal(red.summary.sourceRevision, 'synthetic-unfamiliar-v1');

    // GREEN: the real CLI refuses the exact same input, and no verified number is rendered.
    const green = cliWithAnswers(CONFIRMED_ANSWERS, [...CALLER_ARGS, '--evidence-claim', stalePath]);
    assert.equal(green.summary.lineage, null);
    assert.equal(green.summary.verification.verifiedNumberCount, 0);
    assert.equal(green.summary.journeyDenial.code, 'KS247_LINEAGE_DENIED:EVIDENCE_SOURCE_REVISION_STALE');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
    rmSync(variantCli, { force: true });
    rmSync(variantModule.abs, { force: true });
  }
});

test('AC04 a completed read whose lineage refuses keeps its observed completion in the CLI summary (B2)', async () => {
  // Instrument the read itself: the counter proves a read was actually issued, so
  // `executed: true` on a refusal is a runtime fact rather than control-flow analysis.
  const counter = { reads: 0 };
  const inner = buildUnfamiliarSyntheticDatabase();
  const instrumented = {
    ...inner,
    async query(sql, params) { counter.reads += 1; return inner.query(sql, params); },
  };
  const journey = await journeyFor({ database: instrumented });
  assert.ok(counter.reads > 0, 'the instrumented read must have been issued');
  assert.equal(journey.executed, true);
  assert.equal(journey.acceptance.executionState, 'COMPLETE');

  const scratch = mkdtempSync(join(tmpdir(), 'ks247-b2-'));
  try {
    const wrongPath = join(scratch, 'expectation-wrong-delta.json');
    writeFileSync(wrongPath, mutateJson(expectationBytes, (value) => {
      value.expectedNumbers.deltaMinorUnits = 1;
    }));

    // NEGATIVE: the WRONG_NUMBER refusal must not erase the completed read.
    const refused = cliWithAnswers(CONFIRMED_ANSWERS, [...CALLER_ARGS, '--expectation', wrongPath]);
    assert.equal(refused.status, 0, refused.stderr);
    assert.equal(refused.summary.lineage, null, 'no verified number on refusal');
    assert.equal(refused.summary.journeyDenial.code, 'KS247_LINEAGE_DENIED:WRONG_NUMBER');
    assert.equal(refused.summary.executed, true, 'the completed read must not be erased');
    assert.equal(refused.summary.observedCompletion.state, 'COMPLETE');
    assert.equal(refused.summary.observedCompletion.complete, true);
    assert.equal(refused.summary.verification.status, 'REFUSED');
    assert.equal(refused.summary.verification.reasonCode, 'KS247_LINEAGE_DENIED:WRONG_NUMBER');
    assert.equal(refused.summary.verification.verifiedNumberCount, 0);

    // POSITIVE counterpart: the maintained expectation renders the same read as 24 verified.
    const good = cliWithAnswers(CONFIRMED_ANSWERS, [...CALLER_ARGS, '--format', 'JSON']);
    assert.equal(good.summary.verification.verifiedNumberCount, 24);
    assert.equal(good.summary.observedCompletion, undefined);

    // A refusal BEFORE any read still reports executed:false.
    const preRead = cliWithAnswers(CONFIRMED_ANSWERS,
      ['--business-semantics', BUSINESS_SEMANTICS_PATH, '--source-revision', SOURCE_REVISION]);
    assert.equal(preRead.summary.executed, false);
    assert.equal(preRead.summary.observedCompletion, null);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('RED/GREEN: a variant CLI that resets executed=false erases a completed read on a WRONG_NUMBER refusal (B2)', async () => {
  const cliSource = await readFile(CLI_PATH, 'utf8');
  const broken = cliSource
    .replace(
      '      summary.executed = observedJourney !== null && observedJourney.executed === true;',
      '      summary.executed = false;',
    )
    .replace(
      '      summary.observedCompletion = observedCompletion;',
      '      summary.observedCompletion = null;',
    );
  assert.notEqual(broken, cliSource, 'the sabotage must actually change the CLI');
  const variantCli = writeVariantCli(broken);
  const scratch = mkdtempSync(join(tmpdir(), 'ks247-b2-red-'));
  try {
    const wrongPath = join(scratch, 'expectation-wrong-delta.json');
    writeFileSync(wrongPath, mutateJson(expectationBytes, (value) => {
      value.expectedNumbers.deltaMinorUnits = 1;
    }));

    // RED: the sabotaged CLI falsely reports that nothing was executed.
    const red = cliWithAnswers(CONFIRMED_ANSWERS, [...CALLER_ARGS, '--expectation', wrongPath], variantCli);
    assert.equal(red.summary.journeyDenial.code, 'KS247_LINEAGE_DENIED:WRONG_NUMBER');
    assert.equal(red.summary.executed, false);
    assert.equal(red.summary.observedCompletion, null);

    // GREEN: the real CLI keeps the observed completion and refuses only the verification.
    const green = cliWithAnswers(CONFIRMED_ANSWERS, [...CALLER_ARGS, '--expectation', wrongPath]);
    assert.equal(green.summary.executed, true);
    assert.equal(green.summary.observedCompletion.complete, true);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
    rmSync(variantCli, { force: true });
  }
});

// ---------------------------------------------------------------------------------
// The REAL local database leg.  It SKIPS HONESTLY when no runtime is present rather than
// faking a pass.
// ---------------------------------------------------------------------------------
async function resolvePgliteEntry() {
  const candidates = [
    process.env.PGLITE_CORE_PATH,
    `${ROOT}/.ks-journey-runtime/node_modules/@electric-sql/pglite/dist/index.js`,
    '/workspace/.ks-journey-runtime/node_modules/@electric-sql/pglite/dist/index.js',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { await readFile(candidate); return candidate; } catch { /* next candidate */ }
  }
  return null;
}

test('AC02/AC04 the same separation holds over a REAL in-process PGlite read', async (t) => {
  const entry = await resolvePgliteEntry();
  if (!entry) return t.skip('PGlite runtime required');
  const { pathToFileURL } = await import('node:url');
  const mod = await import(pathToFileURL(entry).href);
  const instance = new mod.PGlite();
  try {
    const journey = await journeyFor({ database: buildPgliteJourneyDatabase(instance) });
    assert.equal(journey.sourceMode, 'REAL_POSTGRESQL');
    assert.equal(journey.acceptance.executionState, 'COMPLETE');
    const lineage = buildReadOnlyResultLineage(lineageInput(journey));
    assert.equal(lineage.sections.completion.complete, true);
    assert.equal(lineage.verification.verifiedNumberCount, 24);
    assert.equal(lineage.verification.unavailableFactCount, 4);
    assert.equal(lineage.sections.verifiedNumbers.find(({ lineId }) => lineId === 'deltaMinorUnits').value, 70059);
    assert.equal(lineage.verification.effectJournal, 'NOT_INVENTED_READ_ONLY_JOURNEY');
  } finally {
    await instance.close();
  }
});
