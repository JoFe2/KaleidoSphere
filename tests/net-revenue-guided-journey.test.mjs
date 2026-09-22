// KaleidoSphere #236 — the GUIDED local user journey suite.
//
// This suite drives the guided surface through its ACTUAL entry points (the module's own
// session function and the CLI binary) and pins the two things the released connected
// runner structurally cannot show:
//
//   POSITIVE: a real set of user answers is consumed, classified against the closed
//   question/source/period/unit tables, confirmed, dispatched to the RELEASED owner for
//   that source, and the released result reconciles to expectations derived HERE by hand
//   from the fixtures' row data — not read back out of the implementation.
//
//   NEGATIVE: every named way a guided journey can go wrong stops with its OWN code,
//   before any source is read. An unsupported question, a rejected source, a wrong unit,
//   an inconsistent combination, an unanswered step and an unconfirmed run are six
//   different facts and are asserted to stay distinguishable.
//
// It also pins the structural nonclaims: no default is ever substituted for a missing
// answer, a stopped session carries no result, and no receipt claims human comprehension.
//
// The released connected runner is exercised UNCHANGED in the same run (parent C1), so a
// guided package that broke the released chain would fail here rather than pass quietly.

import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NET_REVENUE_GUIDED_SESSION_SCHEMA,
  GUIDED_STEPS,
  GUIDED_PROMPTS,
  runGuidedSession,
  createListAnswerSource,
  normalizeAnswer,
  guidedSessionDigest,
} from '../services/bi-control/src/business-bi/net-revenue-guided-session.mjs';
import {
  NET_REVENUE_GUIDED_DECISIONS_SCHEMA,
  SUPPORTED_QUESTION,
  SUPPORTED_QUESTION_ID,
  UNSUPPORTED_QUESTIONS,
  NO_QUESTION_TOKEN,
  ADMITTED_SOURCES,
  REJECTED_SOURCE_REQUESTS,
  SUPPORTED_UNIT_ID,
  emptyDecisions,
  validateDecisions,
  resolveRunParameters,
  classifyMappingProfile,
} from '../services/bi-control/src/business-bi/net-revenue-guided-decisions.mjs';
import {
  buildSyntheticJourneyDatabase,
  buildPgliteJourneyDatabase,
} from '../services/bi-control/src/business-bi/net-revenue-journey.mjs';

const root = path.resolve(import.meta.dirname, '..');
const METRIC = path.join(root, 'contracts/business-bi/v1/net-revenue.metric.json');
const ORACLE = path.join(root, 'tests/fixtures/business-bi/net-revenue-oracle-v1.json');
const HOLDOUT = path.join(root, 'tests/fixtures/business-bi/net-revenue-holdout-v1.json');
const F4_V1 = path.join(root, 'tests/fixtures/business-bi/net-revenue-f4-composition-v1.json');
const F4_V2 = path.join(root, 'tests/fixtures/business-bi/net-revenue-f4-composition-v2.json');
const CLI = path.join(root, 'scripts/run-guided-net-revenue-journey.mjs');

// Resolve the injected PGlite entry point portably (same candidate order the released
// suites use), so the real-database half SKIPS HONESTLY when no runtime is present rather
// than faking a PASS.
async function resolvePgliteEntry() {
  const candidates = [
    process.env.PGLITE_CORE_PATH,
    `${root}/.ks-journey-runtime/node_modules/@electric-sql/pglite/dist/index.js`,
    '/workspace/.ks-journey-runtime/node_modules/@electric-sql/pglite/dist/index.js',
  ].filter(Boolean);
  for (const c of candidates) {
    try { await readFile(c); return c; } catch { /* next candidate */ }
  }
  return null;
}

async function makeRealDatabase() {
  const entry = await resolvePgliteEntry();
  if (!entry) return null;
  const { pathToFileURL } = await import('node:url');
  const mod = await import(pathToFileURL(entry).href);
  return buildPgliteJourneyDatabase(new mod.PGlite());
}

async function inputs() {
  const [metricContractBytes, oracleBytes, holdoutBytes, f4v1, f4v2] = await Promise.all([
    readFile(METRIC), readFile(ORACLE), readFile(HOLDOUT), readFile(F4_V1), readFile(F4_V2),
  ]);
  return {
    metricContractBytes,
    oracleBytes,
    holdoutBytes,
    f4Sources: {
      'ledger-v1': JSON.parse(f4v1.toString('utf8')),
      'ledger-v2': JSON.parse(f4v2.toString('utf8')),
    },
  };
}

const answersFor = ({ question = SUPPORTED_QUESTION_ID, source, period, unit = SUPPORTED_UNIT_ID }) =>
  [question, source, period, unit].filter((v) => v !== undefined);

// Drive the module entry point with a real answer list and an explicit confirmation.
async function session(lines, { confirm = () => true, database = null } = {}) {
  return runGuidedSession({
    answerSource: createListAnswerSource(lines),
    ...(await inputs()),
    database: database ?? buildSyntheticJourneyDatabase(),
    confirm,
  });
}

// =================================================================================
// Parent C1 — the released connected runner still works, unchanged.
// =================================================================================
test('parent C1: the released connected runner is preserved and still reconciles', async (t) => {
  const entry = await resolvePgliteEntry();
  if (!entry) return t.skip('PGlite runtime required');
  const r = spawnSync(process.execPath,
    ['scripts/run-connected-net-revenue-journey.mjs', '--pglite', entry], { cwd: root, encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.allStagesReconciled, true);
  assert.deepEqual(out.stageOrder, ['KS236', 'KS237', 'KS238', 'PSAI']);
});

// =================================================================================
// Parent D1 — the guided POSITIVE path over a REAL PostgreSQL source.
// =================================================================================
test('parent D1: real answers -> admitted decision -> released holdout owner -> oracle reconcile', async (t) => {
  const database = await makeRealDatabase();
  if (!database) return t.skip('external PGlite runtime not present; real-source guided journey not exercised here');

  const s = await session(answersFor({ source: 'holdout-orders-v1', period: 'holdout-contract-periods-v1' }), { database });
  assert.equal(s.schemaVersion, NET_REVENUE_GUIDED_SESSION_SCHEMA);
  assert.equal(s.phase, 'EXECUTED');
  assert.equal(s.executed, true);
  assert.equal(s.decision.admitted, true);
  assert.equal(s.decision.carriesResult, false, 'a decision must never carry a result');

  // The four answers were consumed verbatim, with no default applied anywhere.
  assert.deepEqual(s.asked.map((a) => a.rawAnswer), [
    SUPPORTED_QUESTION_ID, 'holdout-orders-v1', 'holdout-contract-periods-v1', SUPPORTED_UNIT_ID,
  ]);
  assert.deepEqual(s.asked.map((a) => a.defaultApplied), [null, null, null, null]);

  // The result came from the RELEASED #239 owner, over the real PostgreSQL source.
  assert.equal(s.result.ownerEntryPoint, 'runNetRevenueJourney');
  assert.equal(s.result.sourceMode, 'REAL_POSTGRESQL');
  assert.equal(s.result.reconcilesToIndependentOracle, true);
  assert.equal(s.result.oracleEquality, 'EXACT');

  // Expectations derived by hand from the released holdout fixture, independent of the
  // module under test:
  //   comparison (2026-06): sales 35500 - credits 5500 = net 30000 ; cancels 1
  //   current    (2026-07): sales 141293 - credits 41234 = net 100059 ; cancels 1
  //   delta 100059 - 30000 = 70059 minor units
  assert.equal(s.result.result.periods.comparison.netMinorUnits, 30000);
  assert.equal(s.result.result.periods.comparison.saleMinorUnits, 35500);
  assert.equal(s.result.result.periods.comparison.creditMinorUnits, 5500);
  assert.equal(s.result.result.periods.comparison.cancelCount, 1);
  assert.equal(s.result.result.periods.current.netMinorUnits, 100059);
  assert.equal(s.result.result.periods.current.saleMinorUnits, 141293);
  assert.equal(s.result.result.periods.current.creditMinorUnits, 41234);
  assert.equal(s.result.result.periods.current.cancelCount, 1);
  assert.equal(s.result.result.deltaMinorUnits, 70059);

  // The released readback<->rendering identity holds and the released presentation
  // artifacts are carried through rather than re-rendered here.
  assert.equal(s.result.presentation.jsonTableIdentity, true);
  assert.ok(s.result.presentation.readback.columns.includes('delta_minor_units'));
  assert.ok(s.result.presentation.tableRendering.includes('delta_minor_units'));
  assert.ok(s.result.presentation.chartHtml.length > 0);

  // Structural nonclaims.
  assert.equal(s.authority.humanComprehension, false);
  assert.equal(s.authority.productionAdmission, false);
  assert.equal(s.authority.publish, false);
  assert.equal(s.authority.heldProvenanceUnlocked, false);
  assert.deepEqual(s.writesPerformed, []);
  assert.equal(guidedSessionDigest(s).length, 64);
});

// =================================================================================
// Parent D2 — the guided LEDGER paths through the released #240 composition.
// =================================================================================
test('parent D2: both frozen ledger layouts run through their own released profiles over a REAL source', async (t) => {
  const database = await makeRealDatabase();
  if (!database) return t.skip('external PGlite runtime not present; real-source guided journey not exercised here');

  const expectations = {
    'ledger-v1': 'ledger-mapping-v1',
    'ledger-v2': 'ledger-mapping-v2',
  };
  const digests = [];
  for (const [layoutVersion, profileId] of Object.entries(expectations)) {
    const s = await session(answersFor({ source: layoutVersion, period: 'f4-comparison-periods-v1' }), { database });
    assert.equal(s.phase, 'EXECUTED', layoutVersion);
    assert.equal(s.decision.mapping.profileId, profileId, layoutVersion);
    assert.equal(s.result.ownerEntryPoint, 'composeF4ForLayout');
    assert.equal(s.result.layoutVersion, layoutVersion);
    assert.equal(s.result.kernelProfile, profileId);
    // The current layout maps as many rows as it is given: no row is dropped to make a
    // number look right.
    assert.equal(s.result.kernelRowCount, 12, layoutVersion);
    // The guided path selects the frozen DECLARED profile for the layout by name; it does
    // not inject a caller-supplied profile, so the released flag is honestly false. The
    // binding that matters is `kernelProfile`, asserted above.
    assert.equal(s.result.usedDeclaredProfile, false, layoutVersion);

    // Hand-derived from the ledger fixtures (see the released connected suite):
    //   June  net 50000 - 5000 = 45000 ; July net 72000 - 6000 = 66000 ; delta 21000
    //   excluded out-of-scope: s-212 (2026-05-30) -> 1
    assert.equal(s.result.comparison.comparison.netRevenue, 45000, layoutVersion);
    assert.equal(s.result.comparison.current.netRevenue, 66000, layoutVersion);
    assert.equal(s.result.comparison.delta.netRevenue, 21000, layoutVersion);
    assert.equal(s.result.comparison.excludedOutOfScopeCount, 1, layoutVersion);
    // The honest unsupported fields stay null in a GUIDED run too: a user asking for the
    // supported question never acquires numbers the source cannot support.
    assert.equal(s.result.comparison.comparison.orderIntake, null, layoutVersion);
    assert.equal(s.result.comparison.current.openOrderCount, null, layoutVersion);
    assert.equal(s.result.comparison.current.openOrderValue, null, layoutVersion);
    digests.push(s.result.digests.comparisonDigest);
  }
  // Both layouts are the SAME domain rows differently named: the released composition
  // must yield byte-identical kernels and comparisons across the two mapping profiles.
  assert.equal(digests[0], digests[1]);
});

// =================================================================================
// Parent D3 — the decision layer's closed tables, driven through the public API.
// =================================================================================
test('parent D3: every unsupported question is refused by name, never approximated', () => {
  for (const [id, entry] of Object.entries(UNSUPPORTED_QUESTIONS)) {
    const d = validateDecisions({ ...emptyDecisions(), questionId: id, sourceId: 'holdout-orders-v1', periodSetId: 'holdout-contract-periods-v1', unitId: SUPPORTED_UNIT_ID });
    assert.equal(d.admitted, false, id);
    assert.equal(d.question.disposition, 'UNSUPPORTED', id);
    assert.equal(d.question.code, entry.code, id);
    assert.equal(d.carriesResult, false, id);
    assert.equal(d.authority.executeMetric, false, id);
  }
  // The supported question is the only one that admits, and the closed tables really are
  // closed: an id outside them is refused as an unknown question id.
  const ok = validateDecisions({ ...emptyDecisions(), questionId: SUPPORTED_QUESTION_ID, sourceId: 'holdout-orders-v1', periodSetId: 'holdout-contract-periods-v1', unitId: SUPPORTED_UNIT_ID });
  assert.equal(ok.admitted, true);
  assert.ok(SUPPORTED_QUESTION.explicitlyNotAnswered.length >= 4);
  const unknown = validateDecisions({ ...emptyDecisions(), questionId: 'bi-question-invented', sourceId: 'holdout-orders-v1', periodSetId: 'holdout-contract-periods-v1', unitId: SUPPORTED_UNIT_ID });
  assert.equal(unknown.question.code, 'GUIDED_QUESTION_UNSUPPORTED:UNKNOWN_QUESTION_ID');
});

test('parent D3: every rejected source keeps its own distinct code', () => {
  for (const [id, entry] of Object.entries(REJECTED_SOURCE_REQUESTS)) {
    const d = validateDecisions({ ...emptyDecisions(), questionId: SUPPORTED_QUESTION_ID, sourceId: id, periodSetId: 'f4-comparison-periods-v1', unitId: SUPPORTED_UNIT_ID });
    assert.equal(d.admitted, false, id);
    assert.equal(d.source.code, entry.code, id);
  }
  // Ambiguous units and wrong scale must not collapse into one code: they are different
  // facts about the mapping, and both are refused using the released gate.
  assert.notEqual(REJECTED_SOURCE_REQUESTS['ledger-unspecified'].code, REJECTED_SOURCE_REQUESTS['ledger-v1-base-units'].code);
  assert.equal(classifyMappingProfile('ledger-mapping-ambiguous').code, 'GUIDED_MAPPING_NOT_ADMITTED:UNIT_SCALE_AMBIGUOUS');
  assert.equal(classifyMappingProfile('ledger-mapping-wrong-scale').code, 'GUIDED_MAPPING_NOT_ADMITTED:UNIT_SCALE_MISMATCH');
  // The released profiles are the only admitted mappings, and they are named, never
  // re-declared here.
  assert.equal(classifyMappingProfile('ledger-mapping-v1').disposition, 'ADMITTED');
  assert.equal(classifyMappingProfile('ledger-mapping-v2').disposition, 'ADMITTED');
});

test('parent D3: an unsupported source has no owner, so it can never be dispatched', async () => {
  const d = validateDecisions({ ...emptyDecisions(), questionId: SUPPORTED_QUESTION_ID, sourceId: 'production-orders', periodSetId: 'holdout-contract-periods-v1', unitId: SUPPORTED_UNIT_ID });
  // The decision layer has no owner mapping for a non-admitted source, so resolution
  // fails closed before any dispatch could even be attempted.
  assert.throws(() => resolveRunParameters(d, {}), (e) => e.code === 'GUIDED_RESOLVE_DENIED:NOT_ADMITTED');
});

test('parent D3: a malformed decision record is denied rather than read as an absence', () => {
  // A DROPPED key must not be readable as "the user skipped this": refusal is spelled as
  // an explicit null, so absence-by-omission is a malformed record.
  assert.throws(() => validateDecisions({ questionId: SUPPORTED_QUESTION_ID, sourceId: 'holdout-orders-v1', periodSetId: 'holdout-contract-periods-v1' }), (e) => e.code === 'GUIDED_DECISIONS_DENIED:KEYS');
  assert.throws(() => validateDecisions({ ...emptyDecisions(), extra: 1 }), (e) => e.code === 'GUIDED_DECISIONS_DENIED:KEYS');
  assert.throws(() => validateDecisions('not-an-object'), (e) => e.code === 'GUIDED_DECISIONS_DENIED:SHAPE');
  assert.throws(() => validateDecisions(null), (e) => e.code === 'GUIDED_DECISIONS_DENIED:SHAPE');
  // An explicit all-null record is a legitimate INCOMPLETE record, not a throw.
  const blank = validateDecisions(emptyDecisions());
  assert.equal(blank.admitted, false);
  assert.equal(blank.incomplete, true);
});

// =================================================================================
// Parent D4 — the answer intake does not default, and stops before reading.
// =================================================================================
test('parent D4: an unanswered step is ABSENT, is never defaulted, and stops before any read', async () => {
  const inputs_ = await inputs();
  let readReached = false;
  // A database that records access: if the session defaults a missing answer and proceeds
  // to read, this proxy is reached and the test fails.
  const watched = new Proxy({}, {
    get(_t, prop) {
      if (prop === '__mode') return 'SYNTHETIC_FALLBACK';
      readReached = true;
      throw new Error('SOURCE_READ_REACHED_WITHOUT_ANSWERS');
    },
  });

  // EOF: nothing answered at all.
  const eof = await runGuidedSession({
    answerSource: createListAnswerSource([]), ...inputs_, database: watched, confirm: () => true,
  });
  assert.equal(eof.phase, 'STOPPED');
  assert.equal(eof.executed, false);
  assert.equal(eof.stoppedBecause.code, 'GUIDED_SESSION_INCOMPLETE');
  assert.equal(eof.stoppedBecause.incomplete, true);
  assert.equal(eof.result, null);
  assert.deepEqual(eof.asked.map((a) => a.answered), [false, false, false, false]);

  // Partial: two real answers, then EOF on the rest.
  const partial = await runGuidedSession({
    answerSource: createListAnswerSource([SUPPORTED_QUESTION_ID, 'holdout-orders-v1']),
    ...inputs_, database: watched, confirm: () => true,
  });
  assert.equal(partial.phase, 'STOPPED');
  assert.equal(partial.executed, false);
  assert.equal(partial.result, null);
  assert.deepEqual(partial.asked.map((a) => a.answered), [true, true, false, false]);
  assert.deepEqual(partial.asked.map((a) => a.rawAnswer), [SUPPORTED_QUESTION_ID, 'holdout-orders-v1', null, null]);

  // An explicit refusal is REFUSED, a DIFFERENT fact from an unanswered step.
  const refused = await runGuidedSession({
    answerSource: createListAnswerSource([NO_QUESTION_TOKEN, 'holdout-orders-v1', 'holdout-contract-periods-v1', SUPPORTED_UNIT_ID]),
    ...inputs_, database: watched, confirm: () => true,
  });
  assert.equal(refused.stoppedBecause.code, 'GUIDED_QUESTION_REFUSED');
  assert.equal(refused.decision.incomplete, true);

  // Nothing above ever touched the source.
  assert.equal(readReached, false, 'the session reached the source without complete answers');
});

test('parent D4: an admitted decision without confirmation stays READY and reads nothing', async () => {
  const inputs_ = await inputs();
  let readReached = false;
  const watched = new Proxy({}, {
    get(_t, prop) {
      if (prop === '__mode') return 'SYNTHETIC_FALLBACK';
      readReached = true;
      throw new Error('SOURCE_READ_REACHED_BEFORE_CONFIRMATION');
    },
  });
  for (const answer of [false, undefined, 'yes', 0]) {
    const s = await runGuidedSession({
      answerSource: createListAnswerSource(answersFor({ source: 'holdout-orders-v1', period: 'holdout-contract-periods-v1' })),
      ...inputs_,
      database: watched,
      confirm: () => answer,
    });
    // Only the literal `true` authorizes. Anything else is "the user did not confirm".
    assert.equal(s.phase, 'READY');
    assert.equal(s.confirmed, false);
    assert.equal(s.executed, false);
    assert.equal(s.stoppedBecause.code, 'GUIDED_SESSION_NOT_CONFIRMED');
    assert.equal(s.result, null);
    // The parameters ARE resolved and shown, so the user can see what they are declining.
    assert.equal(s.runParameters.sourceId, 'holdout-orders-v1');
  }
  assert.equal(readReached, false, 'the session read the source before confirmation');
});

test('parent D4: answer normalization keeps absence, refusal and words distinct', () => {
  assert.equal(normalizeAnswer(null), null);
  assert.equal(normalizeAnswer(undefined), null);
  assert.equal(normalizeAnswer(''), null);
  assert.equal(normalizeAnswer('   '), null, 'whitespace is not an answer');
  assert.equal(normalizeAnswer('none'), NO_QUESTION_TOKEN);
  assert.equal(normalizeAnswer('  ledger-v1  '), 'ledger-v1');
  assert.equal(normalizeAnswer('ledger v1 please'), 'ledger v1 please', 'the user\'s own words are preserved verbatim');
  assert.throws(() => normalizeAnswer(7), /GUIDED_ANSWER_DENIED:TYPE/);
  // The prompt table states a bound for every step and applies no default anywhere.
  assert.deepEqual(GUIDED_STEPS, ['question', 'source', 'period', 'unit']);
  for (const step of GUIDED_STEPS) {
    assert.equal(GUIDED_PROMPTS[step].defaultApplied, null, step);
    assert.ok(GUIDED_PROMPTS[step].options.length > 0, step);
  }
});

// =================================================================================
// Parent D5 — the CLI: the real entry point a local user runs.
// =================================================================================
test('parent D5: the CLI runs the guided journey from real answer lines and writes only its receipt', async (t) => {
  const entry = await resolvePgliteEntry();
  if (!entry) return t.skip('PGlite runtime required');
  const { mkdtemp, writeFile: wf } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const dir = await mkdtemp(path.join(tmpdir(), 'ks-guided-'));
  const answers = path.join(dir, 'answers.txt');
  await wf(answers, `${[SUPPORTED_QUESTION_ID, 'holdout-orders-v1', 'holdout-contract-periods-v1', SUPPORTED_UNIT_ID].join('\n')}\n`);
  const outPath = path.join(dir, 'session.json');

  const r = spawnSync(process.execPath, [CLI, '--answers', answers, '--pglite', entry, '--confirm', '--out', outPath],
    { cwd: root, encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.phase, 'EXECUTED');
  assert.equal(out.executed, true);
  assert.equal(out.sourceMode, 'REAL_POSTGRESQL');
  assert.equal(out.result.result.deltaMinorUnits, 70059);
  assert.equal(out.decisions.admitted, true);
  assert.equal(out.authority.humanComprehension, false);
  // The stdout receipt and the written receipt are the same bytes (canonical JSON).
  const written = JSON.parse(await readFile(outPath, 'utf8'));
  assert.equal(out.sessionDigest, written.sessionDigest);
});

test('parent D5: the CLI refuses an unsupported question with exit 0, not a crash', async (t) => {
  const entry = await resolvePgliteEntry();
  if (!entry) return t.skip('PGlite runtime required');
  const { mkdtemp, writeFile: wf } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const dir = await mkdtemp(path.join(tmpdir(), 'ks-guided-neg-'));
  const answers = path.join(dir, 'answers.txt');
  await wf(answers, `${[Object.keys(UNSUPPORTED_QUESTIONS)[0], 'holdout-orders-v1', 'holdout-contract-periods-v1', SUPPORTED_UNIT_ID].join('\n')}\n`);

  const r = spawnSync(process.execPath, [CLI, '--answers', answers, '--pglite', entry, '--confirm'],
    { cwd: root, encoding: 'utf8', timeout: 120000 });
  // A refusal is a legitimate outcome: exit 0, executed false, its own reason code.
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.executed, false);
  assert.equal(out.phase, 'STOPPED');
  assert.equal(out.stoppedBecause.code, 'GUIDED_QUESTION_UNSUPPORTED:ORDER_INTAKE');
  assert.equal(out.result, null);
  assert.equal(out.decisions.admitted, false);
});

test('parent D5: the CLI denies a missing --answers file and a non-JSON format', () => {
  const missing = spawnSync(process.execPath, [CLI, '--answers', '/tmp/ks-guided-definitely-absent.txt', '--confirm'],
    { cwd: root, encoding: 'utf8', timeout: 60000 });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /GUIDED_CLI_ANSWERS_DENIED/);

  const badFormat = spawnSync(process.execPath, [CLI, '--format', 'YAML'], { cwd: root, encoding: 'utf8', timeout: 60000 });
  assert.notEqual(badFormat.status, 0);
  assert.match(badFormat.stderr, /GUIDED_CLI_FORMAT_DENIED/);
});

test('parent D5: the CLI confines --out like the released #239/#240 CLIs', async () => {
  const { mkdtemp, writeFile: wf } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const dir = await mkdtemp(path.join(tmpdir(), 'ks-guided-out-'));
  const answers = path.join(dir, 'answers.txt');
  await wf(answers, `${[SUPPORTED_QUESTION_ID, 'holdout-orders-v1', 'holdout-contract-periods-v1', SUPPORTED_UNIT_ID].join('\n')}\n`);

  // An out-path outside the repository and /tmp is denied before the run.
  const escaped = spawnSync(process.execPath, [CLI, '--answers', answers, '--confirm', '--out', '/etc/ks-guided.json'],
    { cwd: root, encoding: 'utf8', timeout: 60000 });
  assert.notEqual(escaped.status, 0);
  assert.match(escaped.stderr, /GUIDED_CLI_OUT_PATH_DENIED/);
});

// =================================================================================
// Parent D6 — the guided surface leaves the released artifacts untouched.
// =================================================================================
test('parent D6: the released surfaces this package reuses are byte-identical to their released identities', async () => {
  const map = JSON.parse(await readFile(path.join(root, 'SOURCE-MAP.json'), 'utf8'));
  const released = [
    'services/bi-control/src/business-bi/net-revenue-journey.mjs',
    'services/bi-control/src/business-bi/net-revenue-connected-journey.mjs',
    'services/bi-control/src/business-bi/net-revenue-ledger-mapping.mjs',
    'services/bi-control/src/business-bi/net-revenue-f4-composition.mjs',
    'services/bi-control/src/business-bi/net-revenue-segment-comparison.mjs',
    'scripts/run-connected-net-revenue-journey.mjs',
    'scripts/run-net-revenue-journey.mjs',
    'scripts/emit-ks236-reader-task.mjs',
  ];
  const { createHash } = await import('node:crypto');
  for (const p of released) {
    const digest = createHash('sha256').update(await readFile(path.join(root, p))).digest('hex');
    assert.equal(digest, map.files[p], `${p} differs from its released content-addressed identity`);
  }
});

test('parent D6: the guided surface is registered in the content-addressed source map', async () => {
  const map = JSON.parse(await readFile(path.join(root, 'SOURCE-MAP.json'), 'utf8'));
  const { createHash } = await import('node:crypto');
  const guided = [
    'services/bi-control/src/business-bi/net-revenue-guided-decisions.mjs',
    'services/bi-control/src/business-bi/net-revenue-guided-session.mjs',
    'scripts/run-guided-net-revenue-journey.mjs',
    'scripts/update-guided-journey-source-map.mjs',
    'tests/net-revenue-guided-journey.test.mjs',
  ];
  for (const p of guided) {
    assert.ok(map.files[p], `${p} is not registered`);
    const digest = createHash('sha256').update(await readFile(path.join(root, p))).digest('hex');
    assert.equal(digest, map.files[p], `${p} registered digest is stale`);
  }
  // The schema identity is a real, distinct schema version for this surface.
  assert.equal(NET_REVENUE_GUIDED_DECISIONS_SCHEMA, 'kaleidosphere.business-bi/net-revenue-guided-decisions/v1');
  assert.equal(ADMITTED_SOURCES['holdout-orders-v1'].status, 'ADMITTED');
});
