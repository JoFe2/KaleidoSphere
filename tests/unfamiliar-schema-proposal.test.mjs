// KS246 (KS-EVO-01-AC01/AC02) — focused verification for the unfamiliar-schema
// proposal + clarification slice.  Renamed from `ks246-...` for the canonical family.
//
//   AC01 — one frozen synthetic UNFAMILIAR schema reached through bounded metadata-only
//          access plus bounded aggregate counts yields a reviewable metric candidate with
//          explicit grain, units, period, relationships and unresolved business meaning,
//          with observed fields / inferred relationships / caller-confirmed rules kept in
//          separate layers.
//   AC02 — ambiguous joins/fan-out, misleading names, units, credits, cancellations and
//          missing definitions are DETECTED by named rules, and the surface asks specific
//          clarification questions instead of manufacturing meaning.
//
// Every expected value below is authored against the FIXTURE BYTES independently of the
// implementation (the fan-out ratio, the same-type scale ratio, the enum values, the two
// currency values, the two date columns and the undefined columns are read from the frozen
// fixture).  A known authored synthetic case is a local proof, not a measured blind result.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  NO_OBSERVED_VALUE_TOKEN,
  REFUSAL_TOKEN,
  UNFAMILIAR_AMBIGUITY_KINDS,
  UNFAMILIAR_INCONSISTENCY_KINDS,
  UNFAMILIAR_RULES,
  UNRESOLVED_TOKEN,
  buildMetricHandoff,
  createListAnswerSource,
  detectAmbiguities,
  loadAggregateProfile,
  loadUnfamiliarMetadata,
  proposeUnfamiliarSchemaCandidate,
  runUnfamiliarSchemaProposalEntryPoint,
} from '../services/bi-control/src/business-bi/unfamiliar-schema-proposal.mjs';
import { canonicalJson } from '../services/bi-control/src/canonical-json.js';

const ROOT = process.cwd();
const FIXTURE_DIR = 'tests/fixtures/business-bi/ks246-unfamiliar-schema';
const METADATA_PATH = `${FIXTURE_DIR}/metadata-v1.json`;
const AGGREGATE_PATH = `${FIXTURE_DIR}/aggregate-profile-v1.json`;
const CONTRACT_PATH = 'contracts/business-bi/v1/net-revenue.metric.json';
const MODULE_PATH = 'services/bi-control/src/business-bi/unfamiliar-schema-proposal.mjs';

const metadataBytes = readFileSync(METADATA_PATH);
const aggregateBytes = readFileSync(AGGREGATE_PATH);
const contractBytes = readFileSync(CONTRACT_PATH);

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const clone = (value) => JSON.parse(JSON.stringify(value));
const run = (lines) => runUnfamiliarSchemaProposalEntryPoint({
  metadataBytes,
  aggregateBytes,
  answerSource: lines === undefined ? undefined : createListAnswerSource(lines),
});

// The interview order is deterministic: required metric roles first, then the record-kind
// semantics, then relationship / name / meaning questions.  Answers are supplied by the
// TEST as a caller would; nothing here is read by the implementation as a default.
const BLOCKING_ANSWERS = Object.freeze([
  'synth_x.pay_feed.pf_id', // grain
  'synth_x.pay_feed.val_dt', // period
  'MINOR_UNITS', // arithmetic unit
  'synth_x.pay_feed.amt_a', // metric amount column
  'EUR', // currency
  'R', // credit value
  'V', // cancel value
]);

// A caller-driven run over explicit fixture BYTES: used where a negative case needs an altered
// observation (a different revision, a contradictory join profile) instead of the frozen bytes.
const runOn = (lines, metadata, aggregates) => runUnfamiliarSchemaProposalEntryPoint({
  metadataBytes: metadata,
  aggregateBytes: aggregates,
  answerSource: lines === undefined ? undefined : createListAnswerSource(lines),
});

// A caller stream whose chosen grain is observed NON-UNIQUE and whose roles span the relation the
// caller then DENIES: the retired defect confirmed this as a coherent proposal.
const NONUNIQUE_GRAIN_ANSWERS = Object.freeze([
  'synth_x.pay_adj.pf_id', // grain observed 5 non-null / 3 distinct
  'synth_x.pay_feed.val_dt', // period from ANOTHER relation
  'MINOR_UNITS',
  'synth_x.pay_feed.amt_a', // amount from ANOTHER relation
  'EUR',
  'R',
  'V',
  'NOT_A_RELATIONSHIP',
]);

// A caller stream that affirms a minor-unit declaration while declaring BASE units.
const UNIT_DECLARATION_CONFLICT_ANSWERS = Object.freeze([
  'synth_x.pay_feed.pf_id',
  'synth_x.pay_feed.val_dt',
  'BASE_UNITS',
  'synth_x.pay_feed.amt_b',
  'EUR',
  'R',
  'V',
  'NOT_A_RELATIONSHIP',
  'DECLARED_MEANING_IS_CORRECT',
]);

function questionsFor(result) {
  return Object.fromEntries(result.questions.map((q) => [q.questionId, q]));
}

function inconsistencyKinds(result) {
  return result.metricCandidate.inconsistencies.map(({ kind }) => kind).sort();
}

// The real local CLI is exercised as a PROCESS, so the delivered entry point is verified through
// its actual stdout rather than through the module API alone.
function runCli({ answers, args = [] } = {}) {
  let answersPath = null;
  let scratch = null;
  if (answers) {
    scratch = mkdtempSync(join(tmpdir(), 'ks246-cli-'));
    answersPath = join(scratch, 'answers.txt');
    writeFileSync(answersPath, `${answers.join('\n')}\n`);
  }
  try {
    const result = spawnSync(process.execPath, [
      'scripts/run-unfamiliar-schema-proposal.mjs',
      ...(answersPath === null ? [] : ['--answers', answersPath]),
      ...args,
    ], { cwd: ROOT, encoding: 'utf8' });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, summary: JSON.parse(result.stdout) };
  } finally {
    if (scratch !== null) rmSync(scratch, { recursive: true, force: true });
  }
}

function ambiguity(result, kind) {
  return result.computed.ambiguities.facts.filter((fact) => fact.kind === kind);
}

// ---------------------------------------------------------------------------------
// AC01
// ---------------------------------------------------------------------------------
test('AC01 the frozen unfamiliar schema loads through bounded metadata-only and bounded aggregate access', () => {
  const metadata = loadUnfamiliarMetadata(metadataBytes);
  const aggregates = loadAggregateProfile(aggregateBytes);
  // Independently specified expected shape read straight from the fixture bytes.
  const fixture = JSON.parse(metadataBytes.toString('utf8'));
  assert.equal(metadata.classification, 'SYNTHETIC_NON_CUSTOMER_BYTES');
  assert.equal(metadata.accessMode, 'BOUNDED_METADATA_ONLY');
  assert.equal(aggregates.accessMode, 'BOUNDED_AGGREGATE_ONLY');
  assert.equal(metadata.sourceRevision, 'synthetic-unfamiliar-v1');
  assert.equal(metadata.relations.length, fixture.relations.length);
  assert.equal(aggregates.relationProfiles.length, fixture.relations.length);
  assert.match(metadata.metadataSha256, /^[a-f0-9]{64}$/);
  assert.match(aggregates.aggregateProfileSha256, /^[a-f0-9]{64}$/);
  // Source revision identity is bound into the digest, so a substitution changes it.
  const other = loadUnfamiliarMetadata({ ...fixture, sourceRevision: 'synthetic-unfamiliar-v2' });
  assert.notEqual(other.metadataSha256, metadata.metadataSha256);
});

test('AC01 a reviewable candidate separates OBSERVED fields, INFERRED relationships and CALLER-CONFIRMED rules', () => {
  const result = run(BLOCKING_ANSWERS);
  // Observed layer: fixture declaration only.
  assert.equal(result.observed.unitDeclaration, null);
  assert.equal(result.observed.currencyDeclaration, null);
  assert.equal(result.observed.relations.length, 3);
  // Computed layer: named rule outcomes.
  assert.equal(result.computed.ambiguities.factKind, 'UNFAMILIAR_SCHEMA_AMBIGUITY_EVIDENCE');
  assert.ok(result.computed.ambiguities.facts.every(({ observationKind }) => observationKind === 'COMPUTED'));
  // Inferred layer: proposal-only, never executable.
  assert.ok(result.inferred.relationships.every(({ observationKind, executionAuthority }) => (
    observationKind === 'INFERRED' && executionAuthority === 'NONE'
  )));
  assert.equal(result.metricCandidate.executionAuthority, 'NONE');
  assert.equal(result.metricCandidate.carriesResult, false);
  assert.equal(result.metricCandidate.reviewState, 'REVIEW_REQUIRED');
  // Confirmed layer: exactly the caller's answers, nothing else.
  assert.deepEqual(Object.values(result.confirmed).map(({ kind }) => kind).sort(),
    ['AMOUNT_COLUMN', 'CANCEL', 'CREDIT', 'CURRENCY', 'GRAIN', 'PERIOD', 'UNITS']);
  assert.ok(Object.values(result.confirmed).every(({ answeredBy }) => answeredBy === 'CALLER'));
  // The candidate names grain, units, period, relationships and unresolved meaning.
  const candidate = result.metricCandidate;
  assert.equal(candidate.grain.selected, 'synth_x.pay_feed.pf_id');
  assert.equal(candidate.units.selected, 'MINOR_UNITS');
  assert.equal(candidate.units.amountColumn, 'synth_x.pay_feed.amt_a');
  assert.equal(candidate.period.selected, 'synth_x.pay_feed.val_dt');
  assert.equal(candidate.currency.selected, 'EUR');
  assert.deepEqual(candidate.recordKind.mapping, { R: 'credit', V: 'cancel' });
  assert.ok(candidate.relationships.length >= 1);
  assert.ok(candidate.unresolvedMeaning.length > 0, 'unresolved business meaning stays explicit');
  assert.equal(candidate.status, 'CONFIRMED');
});

test('AC01 the observed/inferred separation is not cosmetic: OBSERVED bytes never become CONFIRMED', () => {
  const result = run(BLOCKING_ANSWERS);
  // A value observed in the fixture but never answered by the caller stays unresolved.
  const residual = result.metricCandidate.unresolvedMeaning.filter(({ kind }) => kind === 'KIND_VALUE_UNRESOLVED');
  assert.deepEqual(residual.map(({ subject }) => subject).sort(),
    ['synth_x.pay_feed.ev_typ=P', 'synth_x.pay_feed.ev_typ=U']);
  // Exactly the columns the fixture leaves undefined are asked about, and they stay
  // unresolved because the caller did not answer them.
  const undefinedColumns = result.observed.relations
    .flatMap((relation) => relation.columns
      .filter(({ declaredMeaning }) => declaredMeaning === null)
      .map(({ name }) => `synth_x.${relation.relationName}.${name}`));
  const asked = result.questions.filter(({ kind }) => kind === 'MISSING_DEFINITION').map(({ subject }) => subject);
  assert.equal(new Set(asked).size, asked.length);
  for (const subject of undefinedColumns) assert.ok(asked.includes(subject), subject);
  assert.ok(result.metricCandidate.unresolvedMeaning
    .filter(({ kind }) => kind === 'MISSING_DEFINITION').length >= undefinedColumns.length);
});

// ---------------------------------------------------------------------------------
// AC01 / AC05 boundary — bounded metadata access is NOT executable authority.
// ---------------------------------------------------------------------------------
test('AC01 module carries the NONCLAIMS and a proposal grants no execution or admission authority', () => {
  const result = run(BLOCKING_ANSWERS);
  assert.ok(result.nonclaims.length >= 5);
  assert.equal(result.executionAuthority, 'NONE');
  assert.equal(result.mutationAuthority, 'NONE');
  assert.equal(result.carriesResult, false);
  const handoff = buildMetricHandoff({ proposal: result, metricContractBytes: contractBytes });
  assert.equal(handoff.authority.executionAuthority, 'NONE');
  assert.equal(handoff.authority.admissionAuthority, 'NONE');
  assert.equal(handoff.authority.arbitrarySql, false);
  assert.equal(handoff.authority.sharedTaskHandle, 'NOT_INTEGRATED');
});

// ---------------------------------------------------------------------------------
// AC02 — detection, one exact negative per ambiguity class.
// ---------------------------------------------------------------------------------
test('AC02 every named ambiguity class is owed a rule, and no class is silently empty', () => {
  const result = run();
  const { byKind, kinds } = result.computed.ambiguities;
  assert.deepEqual([...kinds].sort(), [...UNFAMILIAR_AMBIGUITY_KINDS].sort());
  for (const kind of UNFAMILIAR_AMBIGUITY_KINDS) {
    assert.ok(byKind[kind] > 0, `${kind} must be detected in the frozen fixture`);
  }
});

test('AC02 ambiguous join / fan-out is detected from the observed non-unique target (5 non-null / 3 distinct)', () => {
  const fixture = JSON.parse(aggregateBytes.toString('utf8'));
  const join = fixture.joinCandidateProfiles[0];
  assert.equal(join.target.relation, 'synth_x.pay_adj');
  assert.equal(join.targetNonNullCount, 5);
  assert.equal(join.targetDistinctCount, 3);
  assert.ok(join.targetNonNullCount > join.targetDistinctCount, 'the fixture is a fan-out by construction');
  const result = run();
  const fanout = ambiguity(result, 'AMBIGUOUS_JOIN_FANOUT');
  assert.equal(fanout.length, 1);
  assert.equal(fanout[0].ruleId, UNFAMILIAR_RULES.FANOUT);
  assert.match(fanout[0].detail, /5 non-null \/ 3 distinct/);
  const relationship = result.inferred.relationships
    .find(({ source }) => source === 'synth_x.pay_feed.pf_id');
  assert.equal(relationship.fanOutRisk, true);
  assert.equal(relationship.confidence, 'LOW');
  assert.equal(relationship.executionAuthority, 'NONE');
  // ... and the clarification asks instead of assuming.
  const question = questionsFor(result)['ks246-q-fanout-0'];
  assert.ok(question);
  assert.deepEqual(question.answerDomain.values, ['REAL_RELATIONSHIP', 'NOT_A_RELATIONSHIP']);
  // Positive counterpart: a caller who denies the relationship records a real decision.
  const denied = run([...BLOCKING_ANSWERS, 'NOT_A_RELATIONSHIP']);
  assert.equal(denied.confirmed['ks246-q-fanout-0'].value, 'NOT_A_RELATIONSHIP');
});

test('AC02 a misleading name with the SAME TYPE as a sibling is caught by the scale-conflict rule', () => {
  const metadata = JSON.parse(metadataBytes.toString('utf8'));
  const relation = metadata.relations.find(({ relationName }) => relationName === 'pay_feed');
  const amtA = relation.columns.find(({ name }) => name === 'amt_a');
  const amtB = relation.columns.find(({ name }) => name === 'amt_b');
  assert.equal(amtA.dataType, amtB.dataType, 'the pair shares one type: integer');
  assert.equal(amtA.declaredMeaning, null);
  assert.match(amtB.declaredMeaning, /cents/);
  const aggregates = JSON.parse(aggregateBytes.toString('utf8'));
  const profile = aggregates.relationProfiles.find(({ relation: r }) => r === 'synth_x.pay_feed');
  const maxA = profile.columns.find(({ name }) => name === 'amt_a').maxInteger;
  const maxB = profile.columns.find(({ name }) => name === 'amt_b').maxInteger;
  assert.ok(maxA / maxB >= 20, 'the observed magnitudes disagree with the declared scale');
  const result = run();
  const conflicts = ambiguity(result, 'MISLEADING_NAME').filter(({ ruleId }) => ruleId === UNFAMILIAR_RULES.SCALE_CONFLICT);
  assert.equal(conflicts.length, 1);
  assert.match(conflicts[0].detail, /integer/);
  // The amount question presents both same-type candidates and forces an explicit choice.
  const amountQuestion = questionsFor(result)['ks246-q-amount-column'];
  const amountCandidates = JSON.parse(metadataBytes.toString('utf8')).relations
    .flatMap((rel) => rel.columns
      .filter(({ name, dataType }) => dataType === 'integer' && /(?:amount|amt|value|revenue|total|sum)/i.test(name))
      .map(({ name }) => `synth_x.${rel.relationName}.${name}`))
    .sort();
  assert.deepEqual(amountQuestion.answerDomain.values, amountCandidates);
  assert.ok(amountCandidates.includes('synth_x.pay_feed.amt_a') && amountCandidates.includes('synth_x.pay_feed.amt_b'));
  // Positive counterpart: choosing the other candidate is a recorded decision, not a default.
  const swapped = run(['synth_x.pay_feed.pf_id', 'synth_x.pay_feed.val_dt', 'MINOR_UNITS',
    'synth_x.pay_feed.amt_b', 'EUR', 'R', 'V']);
  assert.equal(swapped.metricCandidate.units.amountColumn, 'synth_x.pay_feed.amt_b');
  assert.equal(swapped.metricCandidate.status, 'CONFIRMED');
  // ... and the misleading-name question itself has a closed domain, so it cannot be answered
  // with free prose.
  const misleading = questionsFor(result)['ks246-q-misleading-0'];
  assert.deepEqual(misleading.answerDomain.values,
    ['DECLARED_MEANING_IS_CORRECT', 'OBSERVED_SCALE_IS_CORRECT', 'NEITHER']);
});

test('AC02 an amount-LOOKING name with a non-numeric type is flagged, never bound as the amount', () => {
  const metadata = JSON.parse(metadataBytes.toString('utf8'));
  const column = metadata.relations.find(({ relationName }) => relationName === 'tx_meta')
    .columns.find(({ name }) => name === 'amount');
  assert.equal(column.dataType, 'text');
  const result = run();
  const misleading = ambiguity(result, 'MISLEADING_NAME').filter(({ ruleId }) => ruleId === UNFAMILIAR_RULES.MISLEADING_NAME);
  assert.ok(misleading.some(({ detail }) => /tx_meta\.amount/.test(detail)));
  // It never becomes an amount candidate or a record-kind enum candidate.
  assert.equal(result.inferred.units.amountColumns.some(({ column: name }) => name === 'amount'), false);
  assert.equal(result.inferred.recordKind.candidates.some(({ column: name }) => name === 'amount'), false);
});

test('AC02 units are ambiguous without a declaration, and the question forces an explicit unit', () => {
  const result = run();
  const units = ambiguity(result, 'AMBIGUOUS_UNITS');
  assert.equal(units.length, 3, 'one per relation exposing a numeric measure column');
  assert.ok(units.every(({ ruleId }) => ruleId === UNFAMILIAR_RULES.UNIT_UNDECLARED));
  const question = questionsFor(result)['ks246-q-units'];
  assert.deepEqual(question.answerDomain.values, ['MINOR_UNITS', 'BASE_UNITS']);
  // Negative: an out-of-domain unit is REJECTED with an exact code, not silently coerced.
  const rejected = run(['synth_x.pay_feed.pf_id', 'synth_x.pay_feed.val_dt', 'CENTS_I_GUESS'].concat(BLOCKING_ANSWERS.slice(3)));
  const decision = rejected.clarification.dispositions.find(({ questionId }) => questionId === 'ks246-q-units');
  assert.equal(decision.disposition, 'REJECTED');
  assert.equal(decision.outcomeCode, 'UNFAMILIAR_CLARIFICATION_REJECTED:UNITS');
  assert.equal(rejected.confirmed['ks246-q-units'], undefined);
  assert.equal(rejected.metricCandidate.status, 'PARTIALLY_CONFIRMED');
});

test('AC02 credit and cancellation semantics are asked, never inferred, with the observed values as the domain', () => {
  const fixture = JSON.parse(aggregateBytes.toString('utf8'));
  const evTyp = fixture.relationProfiles.find(({ relation }) => relation === 'synth_x.pay_feed')
    .columns.find(({ name }) => name === 'ev_typ');
  const observedValues = Object.keys(evTyp.valueCounts);
  assert.ok(observedValues.length >= 2);
  const result = run(BLOCKING_ANSWERS);
  const credit = questionsFor(result)['ks246-q-credit-0'];
  const cancel = questionsFor(result)['ks246-q-cancel-0'];
  // The closed domain is the OBSERVED values plus one reserved ABSENCE selection: the schema
  // never offers a synthetic observed value, and the absence selection is never a record value.
  assert.deepEqual(credit.answerDomain.values, [...observedValues, NO_OBSERVED_VALUE_TOKEN].sort());
  assert.deepEqual(cancel.answerDomain.values, [...observedValues, NO_OBSERVED_VALUE_TOKEN].sort());
  assert.equal(credit.answerDomain.values.includes('NONE'), false);
  assert.equal(credit.subject, 'synth_x.pay_feed.ev_typ');
  assert.equal(cancel.subject, 'synth_x.pay_feed.ev_typ');
  assert.ok(ambiguity(result, 'CREDIT_SEMANTICS_UNRESOLVED').length > 0);
  assert.ok(ambiguity(result, 'CANCEL_SEMANTICS_UNRESOLVED').length > 0);
  // A value that is neither credit nor cancel stays explicitly unresolved (not a sale).
  assert.deepEqual(result.metricCandidate.unresolvedMeaning
    .filter(({ kind }) => kind === 'KIND_VALUE_UNRESOLVED')
    .map(({ subject }) => subject).sort(), ['synth_x.pay_feed.ev_typ=P', 'synth_x.pay_feed.ev_typ=U']);
  // Negative: an out-of-domain kind value is rejected.
  const rejected = run([...BLOCKING_ANSWERS.slice(0, 5), 'Z', 'V']);
  const decision = rejected.clarification.dispositions.find(({ questionId }) => questionId === 'ks246-q-credit-0');
  assert.equal(decision.disposition, 'REJECTED');
  assert.equal(decision.outcomeCode, 'UNFAMILIAR_CLARIFICATION_REJECTED:CREDIT');
});

test('F3 the reserved absence selection never becomes a fabricated observed record value', () => {
  // The former sentinel was an in-domain answer whose meaning the implementation changed into a
  // synthetic observed value.  It is now simply out of domain, and absence is carried as absence.
  const legacy = run([...BLOCKING_ANSWERS.slice(0, 5), 'NONE', 'NONE']);
  const legacyDecision = legacy.clarification.dispositions.find(({ questionId }) => questionId === 'ks246-q-credit-0');
  assert.equal(legacyDecision.disposition, 'REJECTED');
  assert.equal(legacyDecision.outcomeCode, 'UNFAMILIAR_CLARIFICATION_REJECTED:CREDIT');
  assert.equal(legacy.metricCandidate.recordKind.mapping, null);
  assert.equal(Object.hasOwn(legacy.metricCandidate.recordKind.mapping ?? {}, 'NONE'), false);

  // Positive representation of absence: an explicit in-domain absence declaration that creates NO
  // mapping entry and NO synthetic record value...
  const absence = run([...BLOCKING_ANSWERS.slice(0, 5), NO_OBSERVED_VALUE_TOKEN, 'V']);
  assert.equal(absence.clarification.dispositions.find(({ questionId }) => questionId === 'ks246-q-credit-0').disposition, 'CONFIRMED');
  assert.deepEqual(absence.metricCandidate.recordKind.absenceDeclarations, [NO_OBSERVED_VALUE_TOKEN]);
  assert.equal(absence.metricCandidate.recordKind.creditValue, null);
  assert.deepEqual(absence.metricCandidate.recordKind.mapping, { V: 'cancel' });
  assert.equal(Object.hasOwn(absence.metricCandidate.recordKind.mapping, NO_OBSERVED_VALUE_TOKEN), false);
  // ... and the observed values that hold no role stay explicitly unresolved rather than sales.
  assert.deepEqual(absence.metricCandidate.unresolvedMeaning
    .filter(({ kind }) => kind === 'KIND_VALUE_UNRESOLVED')
    .map(({ subject }) => subject).sort(),
  ['synth_x.pay_feed.ev_typ=P', 'synth_x.pay_feed.ev_typ=R', 'synth_x.pay_feed.ev_typ=U']);
  // ... and no absence can be handed off as credit semantics.
  assert.throws(() => buildMetricHandoff({ proposal: absence, metricContractBytes: contractBytes }),
    (error) => error.code === 'UNFAMILIAR_HANDOFF_DENIED:UNCONFIRMED_KIND_SEMANTICS');
  // A reserved token appearing as a fixture OBSERVED value is refused instead of offered.
  const poisoned = JSON.parse(aggregateBytes.toString('utf8'));
  poisoned.relationProfiles.find(({ relation }) => relation === 'synth_x.pay_feed')
    .columns.find(({ name }) => name === 'ev_typ').valueCounts[NO_OBSERVED_VALUE_TOKEN] = 1;
  assert.throws(() => runOn([], metadataBytes, Buffer.from(JSON.stringify(poisoned))),
    (error) => error.code === 'UNFAMILIAR_CLARIFICATION_DENIED:RESERVED_TOKEN');
});

test('AC02 an ambiguous period role (two date-like columns) becomes an explicit choice', () => {
  const metadata = JSON.parse(metadataBytes.toString('utf8'));
  const dateColumns = metadata.relations.find(({ relationName }) => relationName === 'pay_feed')
    .columns.filter(({ dataType }) => dataType === 'date' || dataType === 'timestamp');
  assert.equal(dateColumns.length, 2, 'the fixture exposes two date-like columns');
  const result = run();
  const period = ambiguity(result, 'AMBIGUOUS_PERIOD');
  assert.equal(period.length, 1);
  assert.equal(period[0].ruleId, UNFAMILIAR_RULES.PERIOD_MULTI);
  // A date column of ANOTHER relation is not a supported period answer.
  assert.equal(result.inferred.period.some(({ column }) => column === 'note'), false);
  const rejected = run(['synth_x.pay_feed.pf_id', 'synth_x.pay_feed.note'].concat(BLOCKING_ANSWERS.slice(2)));
  assert.equal(rejected.clarification.dispositions.find(({ questionId }) => questionId === 'ks246-q-period').disposition, 'REJECTED');
});

test('AC02 a multi-valued currency column is ambiguous, and the choice is recorded, not assumed', () => {
  const fixture = JSON.parse(aggregateBytes.toString('utf8'));
  const ccy = fixture.relationProfiles.find(({ relation }) => relation === 'synth_x.pay_feed')
    .columns.find(({ name }) => name === 'ccy');
  const values = Object.keys(ccy.valueCounts).sort();
  assert.equal(values.length, 2);
  const result = run();
  const currency = ambiguity(result, 'AMBIGUOUS_CURRENCY');
  assert.equal(currency.length, 1);
  assert.equal(currency[0].ruleId, UNFAMILIAR_RULES.CURRENCY_MULTI);
  assert.deepEqual(questionsFor(result)['ks246-q-currency'].answerDomain.values, values);
});

test('AC02 missing definitions are asked one by one and can be recorded as explicitly unresolved', () => {
  const result = run([...BLOCKING_ANSWERS, 'REAL_RELATIONSHIP', 'OBSERVED_SCALE_IS_CORRECT', UNRESOLVED_TOKEN]);
  const definition = result.clarification.dispositions.filter(({ kind }) => kind === 'MISSING_DEFINITION');
  assert.equal(definition.length, 12);
  assert.equal(definition[0].disposition, 'CONFIRMED');
  assert.equal(definition[0].answer, UNRESOLVED_TOKEN);
  // Recorded as confirmed AND still listed as unresolved meaning — the two are not conflated.
  assert.ok(result.metricCandidate.unresolvedMeaning.some(({ questionId }) => questionId === definition[0].questionId));
  // Negative: an SQL-looking meaning is rejected as executable text.
  const rejected = run([...BLOCKING_ANSWERS, 'REAL_RELATIONSHIP', 'OBSERVED_SCALE_IS_CORRECT', 'SELECT * FROM synth_x.pay_feed']);
  const decision = rejected.clarification.dispositions.filter(({ kind }) => kind === 'MISSING_DEFINITION')[0];
  assert.equal(decision.disposition, 'REJECTED');
  assert.equal(decision.outcomeCode, 'UNFAMILIAR_CLARIFICATION_REJECTED:MISSING_DEFINITION');
});

// ---------------------------------------------------------------------------------
// AC02 — never manufacture meaning: absent / EOF / refusal.
// ---------------------------------------------------------------------------------
test('AC02 EOF and absences are never defaulted: nothing is confirmed and the handoff refuses', () => {
  const eof = run(); // no answer source at all
  assert.equal(eof.clarification.confirmedCount, 0);
  assert.equal(eof.clarification.absentCount, eof.questions.length);
  assert.equal(eof.metricCandidate.status, 'PROPOSED');
  assert.deepEqual(eof.confirmed, {});
  assert.deepEqual(eof.metricCandidate.grain.selected, null);
  assert.deepEqual(eof.metricCandidate.units.selected, null);
  assert.deepEqual(eof.metricCandidate.period.selected, null);
  assert.deepEqual(eof.metricCandidate.currency.selected, null);
  assert.equal(eof.metricCandidate.recordKind.mapping, null);
  assert.throws(() => buildMetricHandoff({ proposal: eof, metricContractBytes: contractBytes }),
    (error) => error.code === 'UNFAMILIAR_HANDOFF_DENIED:UNCONFIRMED_QUESTIONS');
  // A partially answered stream confirms ONLY what was answered.
  const partial = run(['synth_x.pay_feed.pf_id']);
  assert.equal(partial.clarification.confirmedCount, 1);
  assert.equal(partial.metricCandidate.status, 'PARTIALLY_CONFIRMED');
  assert.equal(partial.clarification.absentCount, partial.questions.length - 1);
});

test('AC02 an explicit refusal is REFUSED, which is distinct from ABSENT and from a confirmed value', () => {
  const refused = run([REFUSAL_TOKEN]);
  const first = refused.clarification.dispositions[0];
  assert.equal(first.questionId, 'ks246-q-grain');
  assert.equal(first.disposition, 'REFUSED');
  assert.equal(first.outcomeCode, 'UNFAMILIAR_CLARIFICATION_REFUSED');
  assert.equal(refused.clarification.refusedCount, 1);
  assert.equal(refused.confirmed['ks246-q-grain'], undefined);
  assert.equal(refused.metricCandidate.status, 'PROPOSED');
});

test('AC02 no code path can supply an answer: the module source contains no embedded confirmed value', async () => {
  const source = await readFile(MODULE_PATH, 'utf8');
  // A confirmed value can only be recorded from the caller-supplied `answers` argument or
  // an answer source line.  There is no canned answer set: the module never mentions a
  // fixture column, relation or value it could answer with.
  assert.match(source, /answeredBy: 'CALLER'/);
  assert.match(source, /Every CONFIRMED value is a caller-supplied answer/);
  for (const literal of ['pay_feed', 'pay_adj', 'tx_meta', 'pf_id', 'val_dt', 'ev_typ', 'amt_a', 'amt_b']) {
    assert.equal(source.includes(literal), false, `no embedded fixture literal: ${literal}`);
  }
  // A caller-supplied unknown question id is denied rather than ignored.
  assert.throws(() => proposeUnfamiliarSchemaCandidate({
    metadataBytes, aggregateBytes, answers: { 'ks246-q-nonexistent': 'x' },
  }), (error) => error.code === 'UNFAMILIAR_CLARIFICATION_DENIED:UNKNOWN_QUESTION:ks246-q-nonexistent');
});

// ---------------------------------------------------------------------------------
// Denied-information negatives: bounded metadata access != executable authority.
// ---------------------------------------------------------------------------------
test('AC01 a fixture carrying row material, SQL or credentials is DENIED before use', () => {
  const metadata = JSON.parse(metadataBytes.toString('utf8'));
  const cases = [
    [{ ...metadata, rows: [{ pf_id: 1 }] }, 'UNFAMILIAR_SCHEMA_DENIED:ROW_MATERIAL'],
    [{ ...metadata, sql: 'select * from x' }, 'UNFAMILIAR_SCHEMA_DENIED:SQL_AUTHORITY'],
    [{ ...metadata, credentials: { user: 'a' } }, 'UNFAMILIAR_SCHEMA_DENIED:CREDENTIALS'],
    [{ ...metadata, classification: 'PRODUCTION_CUSTOMER_BYTES' }, 'UNFAMILIAR_SCHEMA_METADATA_DENIED:CLASSIFICATION'],
    [{ ...metadata, accessMode: 'FULL_ROW_ACCESS' }, 'UNFAMILIAR_SCHEMA_METADATA_DENIED:ACCESS_MODE'],
    [{ ...metadata, extra: 1 }, 'UNFAMILIAR_SCHEMA_METADATA_DENIED:SURFACE'],
  ];
  for (const [fixture, code] of cases) {
    assert.throws(() => loadUnfamiliarMetadata(fixture), (error) => error.code === code, code);
  }
  const aggregates = JSON.parse(aggregateBytes.toString('utf8'));
  assert.throws(() => loadAggregateProfile({ ...aggregates, rows: [] }),
    (error) => error.code === 'UNFAMILIAR_SCHEMA_DENIED:ROW_MATERIAL');
  assert.throws(() => loadAggregateProfile({ ...aggregates, accessMode: 'EXECUTABLE' }),
    (error) => error.code === 'UNFAMILIAR_SCHEMA_AGGREGATE_DENIED:ACCESS_MODE');
});

// ---------------------------------------------------------------------------------
// Evidence / determinism
// ---------------------------------------------------------------------------------
test('the proposal is deterministic and the same inputs produce byte-identical digests', () => {
  const first = run(BLOCKING_ANSWERS);
  const second = run(BLOCKING_ANSWERS);
  assert.equal(first.entryPointSha256, second.entryPointSha256);
  assert.equal(first.metricCandidate.candidateSha256, second.metricCandidate.candidateSha256);
  assert.equal(first.clarification.clarificationSha256, second.clarification.clarificationSha256);
  assert.equal(first.computed.ambiguities.ambiguityEvidenceSha256, second.computed.ambiguities.ambiguityEvidenceSha256);
});

test('detection is evidence-driven: a COHERENT mutation of the observed evidence changes the outcome', () => {
  const fixture = JSON.parse(aggregateBytes.toString('utf8'));
  // A disposable but INTERNALLY COHERENT mutation of the OBSERVED evidence (not of the
  // implementation): a key-unique target in BOTH bounded reads means no fan-out is reported,
  // which is the positive counterpart of the fan-out rule.  Mutating only the join candidate
  // would contradict the endpoint relation profile and is covered as a negative below.
  const mutated = clone(fixture);
  mutated.joinCandidateProfiles[0].targetNonNullCount = 3;
  mutated.relationProfiles.find(({ relation }) => relation === 'synth_x.pay_adj')
    .columns.find(({ name }) => name === 'pf_id').nonNullCount = 3;
  const result = runOn(BLOCKING_ANSWERS, metadataBytes, Buffer.from(JSON.stringify(mutated)));
  assert.equal(result.computed.ambiguities.byKind.AMBIGUOUS_JOIN_FANOUT, 0);
  assert.deepEqual(result.computed.ambiguities.evidenceInconsistencies, []);
  assert.equal(result.inferred.relationships.find(({ source }) => source === 'synth_x.pay_feed.pf_id').fanOutRisk, false);
  assert.equal(result.metricCandidate.status, 'CONFIRMED');
  // The unmutated fixture still reports exactly one fan-out.
  assert.equal(run(BLOCKING_ANSWERS).computed.ambiguities.byKind.AMBIGUOUS_JOIN_FANOUT, 1);
});

// ---------------------------------------------------------------------------------
// F4 — contradictory overlapping join counts are retained, never silently erased.
// ---------------------------------------------------------------------------------
test('F4 a join candidate contradicting its endpoint relation profile keeps the fan-out and is marked', () => {
  const fixture = JSON.parse(aggregateBytes.toString('utf8'));
  const mutated = clone(fixture);
  // The retired defect: the join target is made key-unique while the endpoint relation profile
  // still observes 5 non-null / 3 distinct.  The fan-out must NOT silently disappear.
  mutated.joinCandidateProfiles[0].targetNonNullCount = 3;
  const result = runOn(BLOCKING_ANSWERS, metadataBytes, Buffer.from(JSON.stringify(mutated)));
  const fanout = result.computed.ambiguities.facts.filter(({ kind }) => kind === 'AMBIGUOUS_JOIN_FANOUT');
  assert.equal(fanout.length, 1, 'the endpoint profile still shows a non-unique target');
  assert.deepEqual(result.computed.ambiguities.evidenceInconsistencies.map(({ kind }) => kind), ['INCONSISTENT_JOIN_PROFILE']);
  assert.ok(result.computed.ambiguities.blindSpots.some((spot) => /INCONSISTENT_JOIN_PROFILE/.test(spot)));
  assert.equal(result.inferred.relationships.find(({ source }) => source === 'synth_x.pay_feed.pf_id').fanOutRisk, true);
  assert.equal(result.inferred.relationships.find(({ source }) => source === 'synth_x.pay_feed.pf_id').observedEvidenceConsistent, false);
  // The contradiction propagates into the candidate and is never confirmed or handed off.
  assert.equal(inconsistencyKinds(result).includes('INCONSISTENT_JOIN_PROFILE'), true);
  assert.equal(result.metricCandidate.status, 'INCONSISTENT');
  assert.equal(result.metricCandidate.coherent, false);
  assert.throws(() => buildMetricHandoff({ proposal: result, metricContractBytes: contractBytes }),
    (error) => error.code === 'UNFAMILIAR_HANDOFF_DENIED:INCONSISTENT_PROPOSAL');
});

test('F4 the two bounded reads must not be combined under one source revision without disclosure', () => {
  const fixture = JSON.parse(metadataBytes.toString('utf8'));
  const aggregate = JSON.parse(aggregateBytes.toString('utf8'));
  // Positive counterpart: the frozen fixture declares the SAME revision on both reads.
  const coherent = run(BLOCKING_ANSWERS);
  assert.equal(coherent.source.sourceRevision, coherent.source.aggregateSourceRevision);
  assert.equal(coherent.source.sourceRevisionMismatch, false);
  assert.deepEqual(coherent.computed.ambiguities.evidenceInconsistencies, []);
  assert.equal(coherent.metricCandidate.status, 'CONFIRMED');
  assert.ok(buildMetricHandoff({ proposal: coherent, metricContractBytes: contractBytes }).handoffSha256);
  // Negative: an aggregate read claiming another revision is neither silently merged under the
  // metadata revision nor usable as a confirmed proposal or handoff.
  const substituted = Buffer.from(JSON.stringify({ ...aggregate, sourceRevision: 'unrelated-revision' }));
  assert.equal(fixture.sourceRevision, coherent.source.sourceRevision);
  const result = runOn(BLOCKING_ANSWERS, metadataBytes, substituted);
  assert.equal(result.source.sourceRevision, 'synthetic-unfamiliar-v1');
  assert.equal(result.source.aggregateSourceRevision, 'unrelated-revision');
  assert.equal(result.source.sourceRevisionMismatch, true);
  assert.ok(result.computed.ambiguities.blindSpots.some((spot) => /SOURCE_REVISION_MISMATCH/.test(spot)));
  assert.deepEqual(result.computed.ambiguities.evidenceInconsistencies.map(({ kind }) => kind), ['SOURCE_REVISION_MISMATCH']);
  assert.equal(inconsistencyKinds(result).includes('SOURCE_REVISION_MISMATCH'), true);
  assert.notEqual(result.metricCandidate.status, 'CONFIRMED');
  assert.equal(result.metricCandidate.status, 'INCONSISTENT');
  assert.throws(() => buildMetricHandoff({ proposal: result, metricContractBytes: contractBytes }),
    (error) => error.code === 'UNFAMILIAR_HANDOFF_DENIED:INCONSISTENT_PROPOSAL');
});

// ---------------------------------------------------------------------------------
// RED on a disposable broken variant / GREEN on the real regression.
// ---------------------------------------------------------------------------------
test('a disposable broken variant loses the fan-out detection (RED) while the real module keeps it (GREEN)', async () => {
  const source = await readFile(MODULE_PATH, 'utf8');
  const broken = source
    .replaceAll('candidate.targetNonNullCount > candidate.targetDistinctCount', 'false')
    .replaceAll('targetProfile.nonNullCount > targetProfile.distinctCount', 'false');
  assert.notEqual(broken, source, 'the sabotage must actually change the source');
  const variantPath = join(ROOT, 'services/bi-control/src/business-bi/.ks246-variant-fanout.test.mjs');
  writeFileSync(variantPath, broken);
  try {
    const variant = await import('../services/bi-control/src/business-bi/.ks246-variant-fanout.test.mjs');
    const mutated = variant.runUnfamiliarSchemaProposalEntryPoint({
      metadataBytes,
      aggregateBytes,
      answerSource: variant.createListAnswerSource(BLOCKING_ANSWERS),
    });
    // RED: with the rule broken the fan-out is no longer detected, so the real assertion fails.
    assert.equal(mutated.computed.ambiguities.byKind.AMBIGUOUS_JOIN_FANOUT, 0);
    assert.equal(mutated.questions.some(({ questionId }) => questionId.startsWith('ks246-q-fanout-')), false);
  } finally {
    rmSync(variantPath, { force: true });
  }
  // GREEN: the real module still detects the fan-out and still asks.
  const real = run(BLOCKING_ANSWERS);
  assert.equal(real.computed.ambiguities.byKind.AMBIGUOUS_JOIN_FANOUT, 1);
  assert.ok(real.questions.some(({ questionId }) => questionId === 'ks246-q-fanout-0'));
});

test('a disposable variant that drops contradictions turns the F2/F4 regressions RED', async () => {
  const source = await readFile(MODULE_PATH, 'utf8');
  // Sabotage ONLY the new contradiction channel: the caller/evidence conflicts are collected by
  // `contradiction(...)` and mirrored into the unresolved-meaning channel.
  const broken = source.replaceAll(
    `  const contradiction = (kind, detail, subjects) => inconsistencies.push({
    kind,
    detail,
    subjects: [...new Set(subjects.filter((subject) => typeof subject === 'string'))].sort(),
  });`,
    '  const contradiction = () => {};',
  );
  assert.notEqual(broken, source, 'the sabotage must actually change the source');
  const variantPath = join(ROOT, 'services/bi-control/src/business-bi/.ks246-variant-contradiction.test.mjs');
  writeFileSync(variantPath, broken);
  try {
    const variant = await import('../services/bi-control/src/business-bi/.ks246-variant-contradiction.test.mjs');
    const variantResult = variant.runUnfamiliarSchemaProposalEntryPoint({
      metadataBytes,
      aggregateBytes,
      answerSource: variant.createListAnswerSource(NONUNIQUE_GRAIN_ANSWERS),
    });
    // RED: with the contradiction channel broken the non-unique-grain / denied-relationship case
    // is (wrongly) labelled CONFIRMED and is handed off — the new regression assertions fail.
    assert.equal(variantResult.metricCandidate.status, 'CONFIRMED');
    assert.deepEqual(variantResult.metricCandidate.inconsistencies, []);
    assert.ok(variant.buildMetricHandoff({ proposal: variantResult, metricContractBytes: contractBytes }).handoffSha256);
    // RED for the F4 revision disclosure as well: the mismatch is still recorded by
    // detectAmbiguities, but it no longer degrades the candidate.
    const variantAggregate = JSON.parse(aggregateBytes.toString('utf8'));
    const variantMismatch = variant.runUnfamiliarSchemaProposalEntryPoint({
      metadataBytes,
      aggregateBytes: Buffer.from(JSON.stringify({ ...variantAggregate, sourceRevision: 'unrelated-revision' })),
      answerSource: variant.createListAnswerSource(BLOCKING_ANSWERS),
    });
    assert.equal(variantMismatch.metricCandidate.status, 'CONFIRMED');
  } finally {
    rmSync(variantPath, { force: true });
  }
  // GREEN: the real module keeps the intended boundary — contradiction means INCONSISTENT.
  const real = run(NONUNIQUE_GRAIN_ANSWERS);
  assert.equal(real.metricCandidate.status, 'INCONSISTENT');
  assert.deepEqual(inconsistencyKinds(real),
    ['DENIED_RELATIONSHIP_WITH_CROSS_RELATION_ROLES', 'GRAIN_KEY_NOT_OBSERVED_UNIQUE']);
  assert.throws(() => buildMetricHandoff({ proposal: real, metricContractBytes: contractBytes }),
    (error) => error.code === 'UNFAMILIAR_HANDOFF_DENIED:INCONSISTENT_PROPOSAL');
});

// ---------------------------------------------------------------------------------
// AC03 — DIRECTLY DEMONSTRATED LOCAL SUPPORT ONLY (shared task handle NOT integrated).
// ---------------------------------------------------------------------------------
test('AC03 a CONFIRMED candidate hands off using the RELEASED row role and kind vocabulary', () => {
  const result = run(BLOCKING_ANSWERS);
  const handoff = buildMetricHandoff({ proposal: result, metricContractBytes: contractBytes });
  assert.deepEqual(handoff.releasedRoleVocabulary,
    { idField: 'order_id', dateField: 'order_date', kindField: 'record_kind', amountField: 'amount_minor_units' });
  assert.deepEqual(handoff.releasedKindVocabulary, ['cancel', 'credit', 'sale', 'unknown']);
  assert.deepEqual(handoff.canonicalRowBinding.idField, { role: 'order_id', source: 'synth_x.pay_feed.pf_id' });
  assert.deepEqual(handoff.canonicalRowBinding.amountField,
    { role: 'amount_minor_units', source: 'synth_x.pay_feed.amt_a', unitScale: 'MINOR_UNITS', currency: 'EUR' });
  assert.deepEqual(handoff.canonicalRowBinding.kindField.confirmedMapping, { R: 'credit', V: 'cancel' });
  assert.deepEqual(handoff.canonicalRowBinding.kindField.residualKindValues, ['P', 'U']);
  assert.equal(handoff.ownerEntryPoint, 'compileNetRevenuePlan');
  assert.equal(handoff.status, 'REVIEW_REQUIRED');
  assert.match(handoff.handoffSha256, /^[a-f0-9]{64}$/);
  assert.equal(handoff.releasedContractSha256, sha256(contractBytes));
});

test('AC03 the handoff reuses the RELEASED contract as the single authority and denies any substitute', () => {
  const result = run(BLOCKING_ANSWERS);
  // A contract whose record-kind vocabulary no longer carries cancel is not the released core.
  const substituted = clone(JSON.parse(contractBytes.toString('utf8')));
  delete substituted.recordRules.cancel;
  assert.throws(() => buildMetricHandoff({
    proposal: result, metricContractBytes: Buffer.from(JSON.stringify(substituted)),
  }), (error) => error.code === 'UNFAMILIAR_HANDOFF_DENIED:KIND_NOT_IN_RELEASED_CONTRACT');
  // A contract naming a different relation is not the released contract.
  const wrongRelation = clone(JSON.parse(contractBytes.toString('utf8')));
  wrongRelation.relation.name = 'synthetic_bi.other';
  assert.throws(() => buildMetricHandoff({
    proposal: result, metricContractBytes: Buffer.from(JSON.stringify(wrongRelation)),
  }), (error) => error.code === 'UNFAMILIAR_HANDOFF_DENIED:CONTRACT_NOT_RELEASED');
});

test('AC03 a non-released arithmetic unit or currency, and a credit/cancel conflict, all fail closed', () => {
  // The released core is EUR integer minor units; a caller-chosen base-unit or CHF scope
  // is a valid ANSWER but not an admissible handoff.
  const baseUnits = run(['synth_x.pay_feed.pf_id', 'synth_x.pay_feed.val_dt', 'BASE_UNITS', 'synth_x.pay_feed.amt_a', 'EUR', 'R', 'V']);
  assert.equal(baseUnits.metricCandidate.status, 'CONFIRMED');
  assert.throws(() => buildMetricHandoff({ proposal: baseUnits, metricContractBytes: contractBytes }),
    (error) => error.code === 'UNFAMILIAR_HANDOFF_DENIED:ARITHMETIC_UNIT_NOT_RELEASED');
  const chf = run(['synth_x.pay_feed.pf_id', 'synth_x.pay_feed.val_dt', 'MINOR_UNITS', 'synth_x.pay_feed.amt_a', 'CHF', 'R', 'V']);
  assert.throws(() => buildMetricHandoff({ proposal: chf, metricContractBytes: contractBytes }),
    (error) => error.code === 'UNFAMILIAR_HANDOFF_DENIED:CURRENCY_NOT_RELEASED');
  const conflict = run(['synth_x.pay_feed.pf_id', 'synth_x.pay_feed.val_dt', 'MINOR_UNITS', 'synth_x.pay_feed.amt_a', 'EUR', 'R', 'R']);
  assert.ok(conflict.metricCandidate.unresolvedMeaning.some(({ kind }) => kind === 'KIND_VALUE_CONFLICT'));
  assert.throws(() => buildMetricHandoff({ proposal: conflict, metricContractBytes: contractBytes }),
    (error) => error.code === 'UNFAMILIAR_HANDOFF_DENIED:KIND_CONFLICT');
});

// ---------------------------------------------------------------------------------
// Lifecycle / integrity migration for this surface.
// ---------------------------------------------------------------------------------
test('the KS246 surface is content-addressed in SOURCE-MAP.json and canonically registered once', async () => {
  const [pkg, sourceMap] = await Promise.all([
    readFile('package.json', 'utf8').then(JSON.parse),
    readFile('SOURCE-MAP.json', 'utf8').then(JSON.parse),
  ]);
  const family = [
    METADATA_PATH,
    AGGREGATE_PATH,
    MODULE_PATH,
    'tests/unfamiliar-schema-proposal.test.mjs',
    'scripts/run-unfamiliar-schema-proposal.mjs',
    'scripts/update-ks246-unfamiliar-schema-source-map.mjs',
    'docs/evidence/ks246-unfamiliar-schema-proposal-v1.md',
  ];
  for (const file of family) {
    assert.match(sourceMap.files[file] ?? '', /^[a-f0-9]{64}$/, file);
    assert.equal(sha256(await readFile(file)), sourceMap.files[file], file);
  }
  // The suite is canonically REACHABLE, but never a second direct package.json root: the
  // canonical command is byte-bound to the released C1 certificate, so it rides the
  // imported-parent route in tests/source-map.test.mjs exactly once.
  const canonicalTests = pkg.scripts.test.split(/\s+/).slice(2);
  assert.equal(canonicalTests.includes('tests/unfamiliar-schema-proposal.test.mjs'), false);
  const parentSource = await readFile('tests/source-map.test.mjs', 'utf8');
  assert.equal((parentSource.match(/import '\.\/unfamiliar-schema-proposal\.test\.mjs';/g) ?? []).length, 1);
  // The binding is not silently extended by a self-referential digest of SOURCE-MAP itself.
  assert.equal(sourceMap.files['SOURCE-MAP.json'], undefined);
});

test('the KS246 slice introduces no legacy technical identity and no second metric core', async () => {
  const files = [
    MODULE_PATH,
    'tests/unfamiliar-schema-proposal.test.mjs',
    'scripts/run-unfamiliar-schema-proposal.mjs',
    'docs/evidence/ks246-unfamiliar-schema-proposal-v1.md',
  ];
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    assert.doesNotMatch(text, /\bCM_[A-Z0-9_]+\b/, `${file} must carry no legacy CM_* identity`);
    assert.doesNotMatch(text, /chimpmaera\.(?:bi|db)\//, `${file} must carry no legacy schema identity`);
  }
  const moduleSource = await readFile(MODULE_PATH, 'utf8');
  // Reuse, not a second core: the module reads the released operation request and never
  // re-declares the metric contract's arithmetic.
  assert.match(moduleSource, /NET_REVENUE_OPERATION_REQUEST/);
  assert.doesNotMatch(moduleSource, /minorUnitsPerMajorUnit\s*=\s*100/);
});

// ---------------------------------------------------------------------------------
// F1 — the DELIVERED CLI must expose a real clarification conversation.
// ---------------------------------------------------------------------------------
test('F1 the actual CLI prints the real question text, allowed answers, subject and stable order', () => {
  const eof = runCli();
  assert.equal(eof.status, 0, eof.stderr);
  const module = run();
  assert.equal(eof.summary.metricCandidate.status, 'PROPOSED');
  assert.equal(eof.summary.clarification.confirmedCount, 0);
  assert.equal(eof.summary.questions.length, module.questions.length);
  // Stable, printed interview order (the order a caller answers positionally).
  assert.deepEqual(eof.summary.questions.map(({ questionId }) => questionId),
    module.questions.map(({ questionId }) => questionId));
  for (const [index, question] of eof.summary.questions.entries()) {
    const asked = module.questions[index];
    assert.equal(question.index, index);
    assert.equal(question.kind, asked.kind);
    assert.equal(question.subject, asked.subject);
    assert.equal(question.questionSha256, asked.questionSha256);
    assert.equal(question.text, asked.text);
    assert.equal(typeof question.text, 'string');
    assert.ok(question.text.length > 0, 'the caller must see the actual question');
    assert.ok(question.answerDomain && typeof question.answerDomain.type === 'string');
    assert.deepEqual(question.answerDomain, asked.answerDomain);
    assert.ok(Array.isArray(question.evidenceRefs) && question.evidenceRefs.length > 0,
      'the question must name the evidence/subject it is owed by');
  }
  // Every blocking answer the test supplies positionally is visibly supported by the printout.
  for (const [index, answer] of BLOCKING_ANSWERS.entries()) {
    const question = eof.summary.questions[index];
    assert.equal(question.blocking, true, question.questionId);
    assert.equal(question.answerDomain.type, 'CLOSED_SET');
    assert.ok(question.answerDomain.values.includes(answer), `${question.questionId} must offer ${answer}`);
  }
});

test('F1 the CLI answers are real ones: a positional answer file confirms and hands off honestly', () => {
  const positive = runCli({ answers: BLOCKING_ANSWERS, args: ['--handoff'] });
  assert.equal(positive.status, 0, positive.stderr);
  assert.equal(positive.summary.metricCandidate.status, 'CONFIRMED');
  assert.equal(positive.summary.metricCandidate.coherent, true);
  assert.equal(positive.summary.metricCandidate.grain, 'synth_x.pay_feed.pf_id');
  assert.deepEqual(positive.summary.metricCandidate.recordKindMapping, { R: 'credit', V: 'cancel' });
  assert.equal(positive.summary.clarification.blockingConfirmed, true);
  assert.equal(positive.summary.handoff.ownerEntryPoint, 'compileNetRevenuePlan');
  assert.equal(positive.summary.handoff.authority.executionAuthority, 'NONE');
  assert.equal(positive.summary.handoff.authority.admissionAuthority, 'NONE');
  assert.equal(positive.summary.handoff.authority.metricExecution, 'NOT_PERFORMED');
  assert.equal(positive.summary.handoff.authority.sharedTaskHandle, 'NOT_INTEGRATED');
  assert.equal(positive.summary.handoff.identity.contractIdentity, 'RELEASED_ADMITTED_CONTRACT_DIGEST_MATCHED');
  assert.equal(positive.summary.handoff.identity.admissionConsumerImplemented, false);
  // A refusal through the CLI stays a refusal, not a default.
  const refusal = runCli({ answers: [REFUSAL_TOKEN] });
  assert.equal(refusal.status, 0);
  assert.equal(refusal.summary.clarification.refusedCount, 1);
  assert.equal(refusal.summary.metricCandidate.status, 'PROPOSED');
});

test('F1 the CLI reports a contradictory run as INCONSISTENT with the exact denial, without crashing', () => {
  const inconsistent = runCli({ answers: NONUNIQUE_GRAIN_ANSWERS, args: ['--handoff'] });
  assert.equal(inconsistent.status, 0, inconsistent.stderr);
  assert.equal(inconsistent.summary.metricCandidate.status, 'INCONSISTENT');
  assert.equal(inconsistent.summary.metricCandidate.coherent, false);
  assert.deepEqual(inconsistent.summary.metricCandidate.inconsistencyKinds,
    ['GRAIN_KEY_NOT_OBSERVED_UNIQUE', 'DENIED_RELATIONSHIP_WITH_CROSS_RELATION_ROLES']);
  assert.equal(inconsistent.summary.handoff, null);
  assert.equal(inconsistent.summary.handoffDenial.code, 'UNFAMILIAR_HANDOFF_DENIED:INCONSISTENT_PROPOSAL');
});

// ---------------------------------------------------------------------------------
// F2 — contradiction between the caller's decisions and the observed evidence.
// ---------------------------------------------------------------------------------
test('F2 a non-unique grain with roles across a DENIED relationship is marked, never confirmed', () => {
  assert.ok(UNFAMILIAR_INCONSISTENCY_KINDS.includes('GRAIN_KEY_NOT_OBSERVED_UNIQUE'));
  assert.ok(UNFAMILIAR_INCONSISTENCY_KINDS.includes('DENIED_RELATIONSHIP_WITH_CROSS_RELATION_ROLES'));
  const result = run(NONUNIQUE_GRAIN_ANSWERS);
  assert.deepEqual(inconsistencyKinds(result),
    ['DENIED_RELATIONSHIP_WITH_CROSS_RELATION_ROLES', 'GRAIN_KEY_NOT_OBSERVED_UNIQUE']);
  assert.equal(result.metricCandidate.coherent, false);
  assert.notEqual(result.metricCandidate.status, 'CONFIRMED');
  assert.equal(result.metricCandidate.status, 'INCONSISTENT');
  // The contradictions are also carried in the unresolved-meaning channel with exact kinds.
  const mirrored = result.metricCandidate.unresolvedMeaning
    .filter(({ kind }) => UNFAMILIAR_INCONSISTENCY_KINDS.includes(kind))
    .map(({ kind }) => kind).sort();
  assert.deepEqual(mirrored, ['DENIED_RELATIONSHIP_WITH_CROSS_RELATION_ROLES', 'GRAIN_KEY_NOT_OBSERVED_UNIQUE']);
  // The caller's answers remain the caller's DATA — they are still recorded verbatim...
  assert.equal(result.confirmed['ks246-q-grain'].value, 'synth_x.pay_adj.pf_id');
  assert.equal(result.confirmed['ks246-q-fanout-0'].value, 'NOT_A_RELATIONSHIP');
  // ... but the candidate is not semantically confirmed and never hands off.
  assert.throws(() => buildMetricHandoff({ proposal: result, metricContractBytes: contractBytes }),
    (error) => error.code === 'UNFAMILIAR_HANDOFF_DENIED:INCONSISTENT_PROPOSAL');
  // Positive coherent counterpart: the same denial over a UNIQUE grain within ONE relation is a
  // recorded decision and hands off unchanged.
  const coherent = run([...BLOCKING_ANSWERS, 'NOT_A_RELATIONSHIP']);
  assert.equal(coherent.metricCandidate.status, 'CONFIRMED');
  assert.deepEqual(coherent.metricCandidate.inconsistencies, []);
  assert.equal(coherent.confirmed['ks246-q-fanout-0'].value, 'NOT_A_RELATIONSHIP');
  assert.match(buildMetricHandoff({ proposal: coherent, metricContractBytes: contractBytes }).handoffSha256, /^[a-f0-9]{64}$/);
});

test('F2 a contradictory unit declaration is marked as a conflict, never as a coherent confirmation', () => {
  const result = run(UNIT_DECLARATION_CONFLICT_ANSWERS);
  assert.deepEqual(inconsistencyKinds(result), ['UNITS_DECLARATION_CONFLICT']);
  assert.equal(result.metricCandidate.status, 'INCONSISTENT');
  assert.equal(result.metricCandidate.coherent, false);
  assert.equal(result.metricCandidate.units.selected, 'BASE_UNITS');
  assert.equal(result.confirmed['ks246-q-misleading-0'].value, 'DECLARED_MEANING_IS_CORRECT');
  assert.ok(result.metricCandidate.unresolvedMeaning.some(({ kind }) => kind === 'UNITS_DECLARATION_CONFLICT'));
  assert.throws(() => buildMetricHandoff({ proposal: result, metricContractBytes: contractBytes }),
    (error) => error.code === 'UNFAMILIAR_HANDOFF_DENIED:INCONSISTENT_PROPOSAL');
  // Positive coherent counterpart: affirming the declared minor-unit meaning WITH minor units,
  // and selecting that same declared column, is coherent and hands off.
  const coherent = run(['synth_x.pay_feed.pf_id', 'synth_x.pay_feed.val_dt', 'MINOR_UNITS',
    'synth_x.pay_feed.amt_b', 'EUR', 'R', 'V', 'NOT_A_RELATIONSHIP', 'DECLARED_MEANING_IS_CORRECT']);
  assert.deepEqual(coherent.metricCandidate.inconsistencies, []);
  assert.equal(coherent.metricCandidate.status, 'CONFIRMED');
  assert.equal(coherent.metricCandidate.units.amountColumn, 'synth_x.pay_feed.amt_b');
  const handoff = buildMetricHandoff({ proposal: coherent, metricContractBytes: contractBytes });
  assert.equal(handoff.canonicalRowBinding.amountField.source, 'synth_x.pay_feed.amt_b');
  assert.equal(handoff.canonicalRowBinding.amountField.unitScale, 'MINOR_UNITS');
});

// ---------------------------------------------------------------------------------
// Local-support claim accuracy — identity is verified, not copied; admission is not claimed.
// ---------------------------------------------------------------------------------
const identityDigest = (body) => sha256(Buffer.from(canonicalJson(body), 'utf8'));
// Deliberately REFORGE a self-consistent identity around an invented role: this is the case a
// digest-only check would miss, so the declared-candidate catalog must deny it independently.
const withRole = (proposal, role) => {
  const reforged = clone(proposal);
  reforged.metricCandidate.grain.selected = role;
  const { candidateSha256, ...candidateBody } = reforged.metricCandidate;
  reforged.metricCandidate.candidateSha256 = identityDigest(candidateBody);
  const { entryPointSha256, ...rest } = reforged;
  reforged.entryPointSha256 = identityDigest(rest);
  return reforged;
};

test('local support: a proposal whose declared identity does not reproduce is denied', () => {
  const base = run(BLOCKING_ANSWERS);
  const forgedSourceRevision = clone(base);
  forgedSourceRevision.source.sourceRevision = 'substituted-source';
  const forgedDigest = clone(base);
  forgedDigest.entryPointSha256 = '0'.repeat(64);
  const forgedCandidateDigest = clone(base);
  forgedCandidateDigest.metricCandidate.candidateSha256 = '0'.repeat(64);
  const forgedGrain = clone(base);
  forgedGrain.metricCandidate.grain.selected = 'nonexistent.relation.fake';
  for (const [label, forged] of [
    ['source revision', forgedSourceRevision],
    ['proposal digest', forgedDigest],
    ['candidate digest', forgedCandidateDigest],
    ['invented grain', forgedGrain],
  ]) {
    assert.throws(() => buildMetricHandoff({ proposal: forged, metricContractBytes: contractBytes }),
      (error) => error.code === 'UNFAMILIAR_HANDOFF_DENIED:PROPOSAL_IDENTITY', label);
  }
  // ... and an invented role is denied by the candidate catalog even when the identity is
  // deliberately reforged to reproduce self-consistently.
  assert.throws(() => buildMetricHandoff({ proposal: withRole(base, 'nonexistent.relation.fake'), metricContractBytes: contractBytes }),
    (error) => error.code === 'UNFAMILIAR_HANDOFF_DENIED:ROLE_NOT_IN_INFERRED_CANDIDATES:grain');
});

test('local support: the contract is bound to the released admitted digest, not to key presence', () => {
  const changedSemantics = clone(JSON.parse(contractBytes.toString('utf8')));
  changedSemantics.recordRules.credit.contribution = 'add_instead_of_subtract';
  assert.throws(() => buildMetricHandoff({
    proposal: run(BLOCKING_ANSWERS),
    metricContractBytes: Buffer.from(JSON.stringify(changedSemantics)),
  }), (error) => error.code === 'UNFAMILIAR_HANDOFF_DENIED:CONTRACT_DIGEST_NOT_RELEASED');
  // Positive counterpart: the coherent proposal over the released bytes verifies and states its
  // own limits instead of claiming admission, execution or a shared handle.
  const handoff = buildMetricHandoff({ proposal: run(BLOCKING_ANSWERS), metricContractBytes: contractBytes });
  assert.equal(handoff.releasedContractSha256, sha256(contractBytes));
  assert.deepEqual(handoff.identity, {
    proposalIdentity: 'RECOMPUTED_FROM_LOCAL_BODY',
    proposalDigestField: 'entryPointSha256',
    candidateIdentity: 'RECOMPUTED_FROM_LOCAL_BODY',
    selectedRoles: 'ALL_SELECTED_ROLES_ARE_DECLARED_INFERRED_CANDIDATES',
    contractIdentity: 'RELEASED_ADMITTED_CONTRACT_DIGEST_MATCHED',
    admissionConsumerImplemented: false,
  });
  assert.equal(handoff.authority.metricExecution, 'NOT_PERFORMED');
  assert.equal(handoff.authority.admissionConsumer, 'NOT_IMPLEMENTED');
  assert.equal(handoff.authority.admissionAuthority, 'NONE');
  assert.equal(handoff.authority.sharedTaskHandle, 'NOT_INTEGRATED');
  assert.equal(handoff.ownerEntryPoint, 'compileNetRevenuePlan');
  assert.ok(handoff.nonclaims.some((claim) => /executes no metric, provides no trusted admission/.test(claim)));
});
