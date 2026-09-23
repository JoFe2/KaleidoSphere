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
import { createHash } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import {
  REFUSAL_TOKEN,
  UNFAMILIAR_AMBIGUITY_KINDS,
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

function questionsFor(result) {
  return Object.fromEntries(result.questions.map((q) => [q.questionId, q]));
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
  assert.deepEqual(credit.answerDomain.values, [...observedValues, 'NONE'].sort());
  assert.deepEqual(cancel.answerDomain.values, [...observedValues, 'NONE'].sort());
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

test('detection is evidence-driven: the same rule over mutated aggregate bytes changes the outcome', () => {
  const fixture = JSON.parse(aggregateBytes.toString('utf8'));
  // A disposable mutation of the OBSERVED evidence (not of the implementation): a unique
  // target means no fan-out is reported, which is the positive counterpart of the fan-out rule.
  const mutated = clone(fixture);
  mutated.joinCandidateProfiles[0].targetNonNullCount = 3;
  const result = runUnfamiliarSchemaProposalEntryPoint({
    metadataBytes,
    aggregateBytes: Buffer.from(JSON.stringify(mutated)),
    answerSource: createListAnswerSource(BLOCKING_ANSWERS),
  });
  assert.equal(result.computed.ambiguities.byKind.AMBIGUOUS_JOIN_FANOUT, 0);
  assert.equal(result.inferred.relationships.find(({ source }) => source === 'synth_x.pay_feed.pf_id').fanOutRisk, false);
  // The unmutated fixture still reports exactly one fan-out.
  assert.equal(run(BLOCKING_ANSWERS).computed.ambiguities.byKind.AMBIGUOUS_JOIN_FANOUT, 1);
});

// ---------------------------------------------------------------------------------
// RED on a disposable broken variant / GREEN on the real regression.
// ---------------------------------------------------------------------------------
test('a disposable broken variant loses the fan-out detection (RED) while the real module keeps it (GREEN)', async () => {
  const source = await readFile(MODULE_PATH, 'utf8');
  const broken = source.replaceAll(
    'candidate.targetNonNullCount > candidate.targetDistinctCount',
    'false',
  );
  assert.notEqual(broken, source, 'the sabotage must actually change the source');
  const variantPath = join(ROOT, 'services/bi-control/src/business-bi/.ks246-variant.test.mjs');
  writeFileSync(variantPath, broken);
  try {
    const variant = await import('../services/bi-control/src/business-bi/.ks246-variant.test.mjs');
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
