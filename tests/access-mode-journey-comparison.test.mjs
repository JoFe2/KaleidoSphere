// KaleidoSphere #248 (KS-EVO-03) — focused acceptance suite for the access-mode journey
// comparison. Every assertion is bound to an ACTUAL entry point: the module's public
// comparison and checker entry points and the ONE runnable CLI.
//
// BOUNDARY DISCLOSURE: the cases, the calibration set and the blind holdout are
// EVALUATOR-OWNED synthetic declarations derived from the independent deterministic reference
// and then frozen; they are a DECLARED synthetic blind set, not an externally authored
// holdout. Nothing here is a product execution, a real source or a measured-superiority claim.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import {
  ACCESS_MODE_FORMATS,
  ACCESS_MODE_INTERNALS,
  METRIC_KEYS_V1,
  OBSERVED_OUTCOMES_V1,
  QUESTIONS_V1,
  ACCESS_MODES_V1,
  buildAccessModeJourneyComparison,
  renderAccessModeComparison,
  verifyAccessModeJourneyComparison,
} from '../services/bi-control/src/business-bi/access-mode-journey-comparison-v1.mjs';
import { PERIODS } from '../services/bi-control/src/business-bi/net-revenue-segment-comparison.mjs';

const FD = 'tests/fixtures/business-bi/ks248-access-modes';
const ROWS_PATH = 'tests/fixtures/business-bi/net-revenue-segment-v1.json';
const NOW = '2026-09-23T00:00:00.000Z';

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));
const rowsFixture = () => readJson(ROWS_PATH).rows;
const sha256Hex = (value) => createHash('sha256').update(value).digest('hex');

const PROFILES = Object.freeze({
  A: { rights: `${FD}/rights-profile-a-v1.json`, holdout: `${FD}/holdout-v1.json`, calibration: `${FD}/calibration-v1.json` },
  B: { rights: `${FD}/rights-profile-b-v1.json`, holdout: `${FD}/holdout-denied-credits-v1.json`, calibration: `${FD}/calibration-denied-credits-v1.json` },
});

function compare(profile = 'A', overrides = {}) {
  return buildAccessModeJourneyComparison({
    cases: readJson(`${FD}/cases-v1.json`),
    holdout: readJson(PROFILES[profile].holdout),
    calibration: readJson(PROFILES[profile].calibration),
    rights: readJson(PROFILES[profile].rights),
    rows: rowsFixture(),
    sourceIdentity: readJson(`${FD}/source-identity-v1.json`),
    now: NOW,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// AC01 — evaluator-owned frozen cases; hidden expectations OUTSIDE the candidate input;
// public calibration distinguished from blind holdout.
// ---------------------------------------------------------------------------
test('KS248 AC01: the case input carries NO expectation, and an expectation smuggled into a case is refused', () => {
  const cases = readJson(`${FD}/cases-v1.json`);
  for (const item of cases.cases) {
    for (const forbidden of ['expectedOutcome', 'expectedNetRevenue', 'numbers', 'reference']) {
      assert.equal(Object.hasOwn(item, forbidden), false, `case ${item.caseId} carries ${forbidden}`);
    }
  }
  const contaminated = clone(cases);
  contaminated.cases[0].expectedNetRevenue = { comparisonNetMinorUnits: 0, currentNetMinorUnits: 0, deltaNetMinorUnits: 0 };
  const refused = compare('A', { cases: contaminated });
  assert.equal(refused.outcome, 'DENIED');
  assert.equal(refused.code, 'KS248_COMPARISON_DENIED:CASES_MALFORMED');
});

test('KS248 AC01: the holdout and the calibration set are digest-bound, and public calibration is disjoint from the blind holdout', () => {
  for (const name of ['holdout-v1.json', 'calibration-v1.json', 'holdout-denied-credits-v1.json', 'calibration-denied-credits-v1.json']) {
    const population = readJson(`${FD}/${name}`);
    const { digest, ...body } = population;
    assert.equal(ACCESS_MODE_INTERNALS.sha256(body), digest, `${name} digest does not re-derive`);
  }
  const report = compare('A');
  const blind = new Set(report.populations.blindHoldout);
  const calibration = new Set(report.populations.publicCalibration);
  assert.ok(blind.size > 0 && calibration.size > 0);
  for (const id of blind) assert.equal(calibration.has(id), false, `${id} is in both populations`);
  assert.equal(report.populations.separation, 'PUBLIC_CALIBRATION_AND_BLIND_HOLDOUT_ARE_DISJOINT_POPULATIONS');
  assert.equal(report.metrics.blindHoldout.population, 'BLIND_HOLDOUT');
  assert.equal(report.metrics.publicCalibration.population, 'PUBLIC_CALIBRATION');
});

test('KS248 AC01: a tampered holdout whose digest was not re-derived is refused', () => {
  const holdout = clone(readJson(`${FD}/holdout-v1.json`));
  holdout.expectations[0].expectedNetRevenue.comparisonNetMinorUnits += 1;
  const refused = compare('A', { holdout });
  assert.equal(refused.code, 'KS248_COMPARISON_DENIED:HOLDOUT_MALFORMED');
});

// ---------------------------------------------------------------------------
// AC02 — the three access modes, justified abstention, denied FX, credits, boundary dates,
// ambiguous joins, and one-cent / rule mutations failing the independent checker.
// ---------------------------------------------------------------------------
test('KS248 AC02: the three access modes are exercised and each behaves as the granted rights allow', () => {
  const report = compare('A');
  assert.equal(report.outcome, 'COMPARED');
  const modes = new Set(report.results.map((entry) => entry.accessMode));
  for (const mode of ACCESS_MODES_V1) assert.ok(modes.has(mode), `access mode ${mode} was not exercised`);

  const metadata = report.results.find((entry) => entry.caseId === 'case:metadata-net-delta');
  assert.equal(metadata.observedOutcome, 'ABSTAINED');
  assert.equal(metadata.basis, 'METADATA_ONLY_CANNOT_ANSWER_A_NUMERIC_QUESTION');
  assert.equal(metadata.numbers, null);

  const aggregate = report.results.find((entry) => entry.caseId === 'case:aggregate-net-delta');
  assert.equal(aggregate.observedOutcome, 'ACCEPTED');
  assert.equal(aggregate.basis, 'PERMITTED_AGGREGATES_OVER_THE_RELEASED_PERIOD_WINDOWS');

  const full = report.results.find((entry) => entry.caseId === 'case:full-net-delta');
  assert.equal(full.observedOutcome, 'ACCEPTED');
  assert.equal(full.integratedPathAgreesWithReference, true);
  // Cross-mode agreement: the aggregate path and the released full-data path must produce the
  // SAME released net on the same rights profile.
  assert.deepEqual(aggregate.numbers, full.numbers);

  // A row-level question is not answerable from aggregates: a justified abstention, not a zero.
  const statusDetail = report.results.find((entry) => entry.caseId === 'case:aggregate-order-status');
  assert.equal(statusDetail.observedOutcome, 'ABSTAINED');
  assert.equal(statusDetail.basis, 'ACCESS_MODE_INSUFFICIENT_FOR_ROW_LEVEL_QUESTION');
});

test('KS248 AC02: denied FX rights, denied credits rights, an unspecified boundary rule and an ambiguous join each refuse by their own name', () => {
  const a = compare('A');
  assert.equal(a.results.find((entry) => entry.caseId === 'case:full-fx-required').observedOutcome, 'REFUSED_DENIED_FX');
  assert.equal(a.results.find((entry) => entry.caseId === 'case:full-boundary-unspecified').observedOutcome, 'ABSTAINED');
  assert.equal(a.results.find((entry) => entry.caseId === 'case:full-boundary-unspecified').basis, 'BOUNDARY_RULE_UNSPECIFIED');
  assert.equal(a.results.find((entry) => entry.caseId === 'case:ambiguous-join-net-delta').observedOutcome, 'REFUSED_AMBIGUOUS_JOIN');
  assert.equal(a.results.find((entry) => entry.caseId === 'case:ambiguous-join-net-delta').basis, 'AMBIGUOUS_JOIN_KEY_IN_SCOPE');

  const b = compare('B');
  assert.equal(b.results.find((entry) => entry.caseId === 'case:full-net-delta').observedOutcome, 'REFUSED_DENIED_CREDITS');
  assert.equal(b.results.find((entry) => entry.caseId === 'case:aggregate-net-delta').observedOutcome, 'REFUSED_DENIED_CREDITS');
  // With credits DENIED but not required, the projection READS no credit row at all: the number
  // is gross-only, and it is a different number from the credits-permitted profile.
  const grossOnly = b.results.find((entry) => entry.caseId === 'case:full-segment-net-totals');
  assert.equal(grossOnly.observedOutcome, 'ACCEPTED');
  assert.equal(grossOnly.creditsReadableInProjection, false);
  const withCredits = a.results.find((entry) => entry.caseId === 'case:full-segment-net-totals');
  assert.equal(withCredits.creditsReadableInProjection, true);
  assert.notDeepEqual(grossOnly.numbers, withCredits.numbers);
  for (const entry of b.results) {
    assert.equal(OBSERVED_OUTCOMES_V1.includes(entry.observedOutcome), true);
  }
});

test('KS248 AC02: a ONE-CENT row mutation and a ONE-CENT expectation mutation both fail the independent checker', () => {
  const report = compare('A');
  assert.equal(verifyAccessModeJourneyComparison({
    ...{ cases: readJson(`${FD}/cases-v1.json`), holdout: readJson(PROFILES.A.holdout),
      calibration: readJson(PROFILES.A.calibration), rights: readJson(PROFILES.A.rights),
      rows: rowsFixture(), sourceIdentity: readJson(`${FD}/source-identity-v1.json`), now: NOW },
    report, bindingDigest: report.bindingDigest,
  }).outcome, 'VERIFIED');

  // One cent on a retained row, with the source identity left as the independently retained one.
  const mutatedRows = rowsFixture();
  mutatedRows[0].amount_minor_units += 1;
  const substitute = verifyAccessModeJourneyComparison({
    cases: readJson(`${FD}/cases-v1.json`), holdout: readJson(PROFILES.A.holdout),
    calibration: readJson(PROFILES.A.calibration), rights: readJson(PROFILES.A.rights),
    rows: mutatedRows, sourceIdentity: readJson(`${FD}/source-identity-v1.json`), now: NOW,
    report, bindingDigest: report.bindingDigest,
  });
  assert.equal(substitute.code, 'KS248_COMPARISON_DENIED:SOURCE_SUBSTITUTION');

  // ... and with the identity RESEALED by the caller, the carried binding still fails to
  // re-derive: recomputing a digest is not evidence.
  const resealedIdentity = { ...readJson(`${FD}/source-identity-v1.json`),
    sourceBytesSha256: sha256Hex(JSON.stringify(mutatedRows)) };
  const resealed = verifyAccessModeJourneyComparison({
    cases: readJson(`${FD}/cases-v1.json`), holdout: readJson(`${PROFILES.A.holdout}`),
    calibration: readJson(`${FD}/calibration-v1.json`), rights: readJson(PROFILES.A.rights),
    rows: mutatedRows, sourceIdentity: resealedIdentity, now: NOW,
    report, bindingDigest: report.bindingDigest,
  });
  assert.equal(resealed.code, 'KS248_COMPARISON_DENIED:SERIALIZED_BINDING_MISMATCH');

  // One cent on a blind expectation is enough for the checker to refuse the comparison.
  const holdout = clone(readJson(`${FD}/holdout-v1.json`));
  const entry = holdout.expectations.find((item) => item.caseId === 'case:full-net-delta');
  entry.expectedNetRevenue.currentNetMinorUnits += 1;
  entry.expectedNetRevenue.deltaNetMinorUnits = entry.expectedNetRevenue.currentNetMinorUnits
    - entry.expectedNetRevenue.comparisonNetMinorUnits;
  holdout.digest = ACCESS_MODE_INTERNALS.sha256(Object.fromEntries(
    Object.entries(holdout).filter(([key]) => key !== 'digest')));
  const mutated = compare('A', { holdout });
  assert.equal(mutated.outcome, 'COMPARED');
  assert.equal(mutated.metrics.blindHoldout.wrongNumber, 1);
  assert.equal(mutated.metrics.blindHoldout.falseAcceptance, 0);
  const checked = verifyAccessModeJourneyComparison({
    cases: readJson(`${FD}/cases-v1.json`), holdout, calibration: readJson(`${FD}/calibration-v1.json`),
    rights: readJson(PROFILES.A.rights), rows: rowsFixture(),
    sourceIdentity: readJson(`${FD}/source-identity-v1.json`), now: NOW,
    report: mutated, bindingDigest: mutated.bindingDigest,
  });
  assert.equal(checked.code, 'KS248_COMPARISON_DENIED:BLIND_HOLDOUT_VERDICT_FAILED');
  assert.equal(checked.wrongNumber, 1);
});

// ---------------------------------------------------------------------------
// AC03 — source/rule drift, retained applicability and the paired read path.
// ---------------------------------------------------------------------------
test('KS248 AC03: a rule mutation (boundary rule) changes the re-derived binding and is refused by the checker', () => {
  const report = compare('A');
  const cases = clone(readJson(`${FD}/cases-v1.json`));
  cases.cases.find((item) => item.caseId === 'case:full-net-delta').boundaryRule = 'EXCLUDE_BOUNDARY_DATES';
  const mutated = compare('A', { cases });
  assert.notEqual(mutated.bindingDigest, report.bindingDigest);
  const checked = verifyAccessModeJourneyComparison({
    cases, holdout: readJson(`${FD}/holdout-v1.json`), calibration: readJson(`${FD}/calibration-v1.json`),
    rights: readJson(PROFILES.A.rights), rows: rowsFixture(),
    sourceIdentity: readJson(`${FD}/source-identity-v1.json`), now: NOW,
    report, bindingDigest: report.bindingDigest,
  });
  assert.equal(checked.code, 'KS248_COMPARISON_DENIED:SERIALIZED_BINDING_MISMATCH');
});

test('KS248 AC03: the boundary-date rule really matters once a boundary-dated row exists, and the bound rule is preserved', () => {
  const rows = rowsFixture();
  const boundaryRow = { order_id: 's-9xx', order_date: PERIODS.comparison.end,
    record_kind: 'sale', amount_minor_units: 1000, status: 'closed', segment: 'direct' };
  const withBoundary = [...rows, boundaryRow];
  const include = ACCESS_MODE_INTERNALS.deterministicReference({ rows: withBoundary, boundaryRule: 'INCLUDE_BOUNDARY_DATES' });
  const exclude = ACCESS_MODE_INTERNALS.deterministicReference({ rows: withBoundary, boundaryRule: 'EXCLUDE_BOUNDARY_DATES' });
  assert.equal(include.boundaryDates.length, 1);
  assert.equal(include.boundaryDates[0].order_date, PERIODS.comparison.end);
  assert.notEqual(include.comparisonNetMinorUnits, exclude.comparisonNetMinorUnits);
  assert.equal(include.comparisonNetMinorUnits - exclude.comparisonNetMinorUnits, 1000);
  assert.equal(exclude.excludedBoundaryRows, 1);
  assert.equal(include.boundaryRule, 'INCLUDE_BOUNDARY_DATES');
  assert.equal(exclude.boundaryRule, 'EXCLUDE_BOUNDARY_DATES');

  // The released integrated path agrees with the reference on the boundary-inclusive reading,
  // so the paired read path is exercised rather than assumed.
  const integrated = ACCESS_MODE_INTERNALS.integratedPath(withBoundary);
  assert.equal(integrated.comparisonNetMinorUnits, include.comparisonNetMinorUnits);
  assert.equal(integrated.currentNetMinorUnits, include.currentNetMinorUnits);
  assert.equal(integrated.deltaNetMinorUnits, include.deltaNetMinorUnits);
});

test('KS248 AC03: source drift outside the declared windows is excluded, and no synthetic EFFECT case is presented', () => {
  const report = compare('A');
  const full = report.results.find((entry) => entry.caseId === 'case:full-net-delta');
  const rows = rowsFixture();
  const expected = ACCESS_MODE_INTERNALS.deterministicReference({ rows, boundaryRule: 'INCLUDE_BOUNDARY_DATES' });
  assert.equal(full.numbers.comparisonNetMinorUnits, expected.comparisonNetMinorUnits);
  // The out-of-window row (2026-05-30) is excluded by BOTH paths, and the null-amount row is not
  // counted as a zero.
  assert.ok(rows.some((row) => row.amount_minor_units === null));
  assert.ok(rows.some((row) => ACCESS_MODE_INTERNALS.deterministicReference({ rows: [row], boundaryRule: 'INCLUDE_BOUNDARY_DATES' }).comparisonNetMinorUnits === 0
    && ACCESS_MODE_INTERNALS.deterministicReference({ rows: [row], boundaryRule: 'INCLUDE_BOUNDARY_DATES' }).currentNetMinorUnits === 0));
  // No synthetic effect case exists in this slice, so no mock completion is consumed and no
  // effect or completion status is presented anywhere on the comparison.
  for (const entry of report.results) {
    assert.equal(Object.hasOwn(entry, 'effectStatus'), false);
    assert.equal(Object.hasOwn(entry, 'completion'), false);
  }
});

// ---------------------------------------------------------------------------
// AC04 — reference vs integrated path, and the metric set with unknown metrics left unknown.
// ---------------------------------------------------------------------------
test('KS248 AC04: the deterministic reference is independent of the released path shape and agrees on every accepted blind case', () => {
  for (const profile of ['A', 'B']) {
    const report = compare(profile);
    const accepted = report.results.filter((entry) => entry.observedOutcome === 'ACCEPTED');
    assert.ok(accepted.length > 0);
    for (const entry of accepted.filter((item) => item.accessMode === 'PERMITTED_FULL_DATA')) {
      assert.equal(entry.integratedPathAgreesWithReference, true, `${entry.caseId} reference disagreed with the integrated path`);
    }
    for (const entry of accepted) {
      const reference = ACCESS_MODE_INTERNALS.deterministicReference({ rows: rowsFixture(), boundaryRule: entry.boundaryRule });
      assert.equal(typeof reference.comparisonNetMinorUnits, 'number');
    }
    assert.equal(report.metrics.blindHoldout.integratedPathDisagreement, 0);
    assert.equal(report.metrics.blindHoldout.falseAcceptance, 0);
    assert.equal(report.metrics.blindHoldout.falseRefusal, 0);
    assert.equal(report.metrics.blindHoldout.wrongNumber, 0);
    assert.equal(report.metrics.blindHoldout.wrongRefusalReason, 0);
  }
});

test('KS248 AC04: every metric key is present, and the unmeasured metrics stay null with an UNKNOWN reason', () => {
  const report = compare('A');
  for (const population of ['publicCalibration', 'blindHoldout']) {
    const metrics = report.metrics[population];
    assert.ok(metrics.caseCount > 0);
    assert.equal(metrics.waiting, null);
    assert.match(metrics.waitingReason, /^NOT_INSTRUMENTED:/);
    assert.equal(metrics.activeHumanOrAgentWork, null);
    assert.match(metrics.activeHumanOrAgentWorkReason, /^NOT_INSTRUMENTED:/);
    assert.equal(metrics.measurableCostMinorUnits, null);
    assert.match(metrics.measurableCostMinorUnitsReason, /^NOT_INVENTED:/);
    for (const key of ['correctAcceptance', 'falseAcceptance', 'falseRefusal', 'clarificationsRequested', 'correctionsRequired']) {
      assert.equal(Number.isInteger(metrics[key]), true, `${population}.${key} is not an integer`);
    }
    assert.equal(metrics.correctAcceptance + metrics.falseAcceptance + metrics.falseRefusal
      + metrics.wrongNumber + metrics.wrongRefusalReason + metrics.refusalMatch
      + metrics.justifiedAbstention, metrics.caseCount);
  }
  assert.equal(METRIC_KEYS_V1.length, 8);
});

// ---------------------------------------------------------------------------
// Contract shapes and rendering.
// ---------------------------------------------------------------------------
test('KS248: every required input has no default and no implicit fixture adoption', () => {
  const required = ['cases', 'holdout', 'calibration', 'rights', 'rows', 'sourceIdentity'];
  for (const key of required) {
    const input = {
      cases: readJson(`${FD}/cases-v1.json`), holdout: readJson(PROFILES.A.holdout),
      calibration: readJson(PROFILES.A.calibration), rights: readJson(PROFILES.A.rights),
      rows: rowsFixture(), sourceIdentity: readJson(`${FD}/source-identity-v1.json`), now: NOW,
    };
    delete input[key];
    const refused = buildAccessModeJourneyComparison(input);
    assert.equal(refused.code, 'KS248_COMPARISON_DENIED:INPUT_REQUIRED', `${key} was silently defaulted`);
    assert.ok(refused.missing.includes(key));
  }
  assert.equal(buildAccessModeJourneyComparison().code, 'KS248_COMPARISON_DENIED:INPUT_REQUIRED');
  assert.equal(QUESTIONS_V1.length, 3);
});

test('KS248: JSON and TABLE render the comparison; an unsupported format is refused', () => {
  const report = compare('A');
  for (const format of ACCESS_MODE_FORMATS) {
    const rendered = renderAccessModeComparison(report, format);
    assert.equal(rendered.outcome, 'RENDERED');
    assert.ok(rendered.text.includes(report.bindingDigest));
  }
  assert.equal(JSON.parse(renderAccessModeComparison(report, 'JSON').text).bindingDigest, report.bindingDigest);
  const table = renderAccessModeComparison(report, 'TABLE');
  for (const entry of report.results) assert.ok(table.text.includes(entry.caseId));
  assert.equal(renderAccessModeComparison(report, 'CSV').code, 'KS248_COMPARISON_DENIED:FORMAT_UNSUPPORTED');
});

// ---------------------------------------------------------------------------
// The runnable CLI on the actual entry point.
// ---------------------------------------------------------------------------
const CLI = 'scripts/run-access-mode-journey-comparison.mjs';
const runCli = (args) => execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
const cliArgs = (profile) => [
  '--cases', `${FD}/cases-v1.json`, '--holdout', PROFILES[profile].holdout,
  '--calibration', PROFILES[profile].calibration, '--source-identity', `${FD}/source-identity-v1.json`,
  '--rights', PROFILES[profile].rights, '--source-rows', ROWS_PATH,
];

test('KS248 CLI: EOF compares nothing and adopts no fixture', () => {
  const out = runCli([]);
  assert.match(out, /mode=eof report=null executed=false/);
  assert.match(out, /COMPARISON-DENIED KS248_COMPARISON_DENIED:INPUT_REQUIRED/);
  assert.match(out, /missing=cases,holdout,calibration,sourceIdentity,rights,rows/);
});

test('KS248 CLI: both rights profiles render a receipt, and a missing input is refused before any read', () => {
  for (const profile of ['A', 'B']) {
    const out = runCli([...cliArgs(profile), '--format', 'TABLE']);
    assert.match(out, /COMPARISON-RECEIPT \{/);
    assert.match(out, /"outcome":"COMPARED"/);
    assert.match(out, /"blindFalseAcceptance":0/);
    assert.match(out, /"blindFalseRefusal":0/);
    assert.match(out, /"waiting":null/);
    assert.match(out, /sourceRowsSha256=([a-f0-9]{64})/);
  }
  const partial = runCli(['--cases', `${FD}/cases-v1.json`]);
  assert.match(partial, /missing=holdout,calibration,sourceIdentity,rights,rows/);
});

test('KS248 CLI: --verify re-derives the carried binding exactly, and the negative gates all report their exact code', () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'ks248-binding-'));
  try {
    const out = runCli([...cliArgs('A')]);
    const report = JSON.parse(out.slice(0, out.indexOf('\nCOMPARISON-RECEIPT')));
    const bindingFile = path.join(scratch, 'binding.json');
    writeFileSync(bindingFile, JSON.stringify(report, null, 2));
    const verified = runCli([...cliArgs('A'), '--verify', '--binding', bindingFile]);
    assert.match(verified, /verify=VERIFIED code=OK/);
    assert.ok(verified.includes(report.bindingDigest));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const negative = runCli(['--negative']);
  assert.match(negative, /negative gates: 20 executed, 0 unexpected/);
  assert.equal(negative.includes('UNEXPECTEDLY_ACCEPTED'), false);
});

// ---------------------------------------------------------------------------
// RED/GREEN. Each disposable variant is written inside the module's directory (so its relative
// imports resolve), DRIVEN to show the boundary RED on the variant, then removed in a finally.
// ---------------------------------------------------------------------------
const MODULE_DIR = path.dirname('services/bi-control/src/business-bi/access-mode-journey-comparison-v1.mjs');
const MODULE_SRC = 'services/bi-control/src/business-bi/access-mode-journey-comparison-v1.mjs';
const moduleUrl = (relative) => pathToFileURL(path.resolve(process.cwd(), relative)).href;

async function driveVariant(name, mutate, drive) {
  const variantPath = `${MODULE_DIR}/.ks248-variant-${name}.mjs`;
  const original = readFileSync(MODULE_SRC, 'utf8');
  const mutated = mutate(original);
  assert.notEqual(mutated, original, `variant ${name} did not change the source`);
  writeFileSync(variantPath, mutated);
  try {
    return drive(await import(moduleUrl(variantPath)));
  } finally {
    rmSync(variantPath, { force: true });
    assert.equal(existsSync(variantPath), false, `variant ${name} was left on disk`);
  }
}

function variantInput(profile = 'B') {
  return {
    cases: readJson(`${FD}/cases-v1.json`), holdout: readJson(PROFILES[profile].holdout),
    calibration: readJson(PROFILES[profile].calibration), rights: readJson(PROFILES[profile].rights),
    rows: rowsFixture(), sourceIdentity: readJson(`${FD}/source-identity-v1.json`), now: NOW,
  };
}

test('KS248 RED/GREEN: without the denied-credits refusal a blind case becomes a FALSE ACCEPTANCE on the variant', async () => {
  const red = await driveVariant(
    'no-credits-refusal',
    (source) => source.replace(
      "  if (item.requiresCredits && rights.credits === 'DENIED') {",
      "  if (false && item.requiresCredits && rights.credits === 'DENIED') {"),
    (variant) => variant.buildAccessModeJourneyComparison(variantInput('B')),
  );
  assert.equal(red.outcome, 'COMPARED');
  assert.ok(red.metrics.blindHoldout.falseAcceptance >= 1, 'the broken variant produced no false acceptance');
  assert.equal(compare('B').metrics.blindHoldout.falseAcceptance, 0);
});

test('KS248 RED/GREEN: without the metadata-only abstention the metadata question no longer abstains on the variant', async () => {
  const red = await driveVariant(
    'no-metadata-abstention',
    (source) => source.replace(
      "    return { caseId: item.caseId, accessMode: item.accessMode, observedOutcome: 'ABSTAINED', numbers: null, basis: 'METADATA_ONLY_CANNOT_ANSWER_A_NUMERIC_QUESTION', projection };",
      '    return null;'),
    (variant) => {
      try {
        const report = variant.buildAccessModeJourneyComparison(variantInput('A'));
        return report.results.find((entry) => entry.caseId === 'case:metadata-net-delta');
      } catch (error) {
        return { observedOutcome: 'THREW', message: String(error?.message ?? error) };
      }
    },
  );
  // The metadata-only abstention is gone: the variant either cannot produce the case at all or
  // produces a non-abstaining verdict — either way the boundary is RED on the variant.
  assert.notEqual(red.observedOutcome, 'ABSTAINED');
  const green = compare('A').results.find((entry) => entry.caseId === 'case:metadata-net-delta');
  assert.equal(green.observedOutcome, 'ABSTAINED');
  assert.equal(green.basis, 'METADATA_ONLY_CANNOT_ANSWER_A_NUMERIC_QUESTION');
});

test('KS248 RED/GREEN: without the source-identity digest check a one-cent substitution is not refused on the variant', async () => {
  const mutatedRows = rowsFixture();
  mutatedRows[0].amount_minor_units += 1;
  const red = await driveVariant(
    'no-source-identity-check',
    (source) => source.replace(
      '  if (bytesSha256(JSON.stringify(rows)) !== sourceIdentity.sourceBytesSha256) {',
      '  if (false && bytesSha256(JSON.stringify(rows)) !== sourceIdentity.sourceBytesSha256) {'),
    (variant) => variant.buildAccessModeJourneyComparison({ ...variantInput('A'), rows: mutatedRows }),
  );
  assert.notEqual(red.code, 'KS248_COMPARISON_DENIED:SOURCE_SUBSTITUTION');
  assert.equal(compare('A', { rows: mutatedRows }).code, 'KS248_COMPARISON_DENIED:SOURCE_SUBSTITUTION');
});

test('KS248 RED/GREEN: without the holdout digest re-derivation a tampered holdout is accepted on the variant', async () => {
  const holdout = clone(readJson(`${FD}/holdout-v1.json`));
  const tampered = holdout.expectations.find((entry) => entry.caseId === 'case:full-net-delta');
  tampered.expectedNetRevenue.comparisonNetMinorUnits += 1;
  tampered.expectedNetRevenue.deltaNetMinorUnits = tampered.expectedNetRevenue.currentNetMinorUnits
    - tampered.expectedNetRevenue.comparisonNetMinorUnits;
  const red = await driveVariant(
    'no-holdout-digest-check',
    (source) => source.replace('  return sha256(body) === value.digest;', '  return true;'),
    (variant) => variant.buildAccessModeJourneyComparison({ ...variantInput('A'), holdout }),
  );
  assert.notEqual(red.code, 'KS248_COMPARISON_DENIED:HOLDOUT_MALFORMED');
  assert.equal(compare('A', { holdout }).code, 'KS248_COMPARISON_DENIED:HOLDOUT_MALFORMED');
});

test('KS248 RED/GREEN: without the calibration/blind separation check a contaminated population is accepted on the variant', async () => {
  const calibration = clone(readJson(`${FD}/calibration-v1.json`));
  calibration.expectations.push(clone(readJson(`${FD}/holdout-v1.json`).expectations[0]));
  calibration.digest = ACCESS_MODE_INTERNALS.sha256(Object.fromEntries(
    Object.entries(calibration).filter(([key]) => key !== 'digest')));
  const red = await driveVariant(
    'no-population-separation',
    (source) => source.replace(
      '    if (item.blind && calibrationIds.has(item.caseId)) return deny(\'CALIBRATION_CONTAMINATES_BLIND_HOLDOUT\', { caseId: item.caseId });',
      ''),
    (variant) => variant.buildAccessModeJourneyComparison({ ...variantInput('A'), calibration }),
  );
  assert.notEqual(red.code, 'KS248_COMPARISON_DENIED:CALIBRATION_CONTAMINATES_BLIND_HOLDOUT');
  assert.equal(compare('A', { calibration }).code, 'KS248_COMPARISON_DENIED:CALIBRATION_CONTAMINATES_BLIND_HOLDOUT');
});

test('KS248 RED/GREEN: a CLI that IMPLICITLY defaults --rights is RED through the real entry point', () => {
  const variantCli = 'scripts/.ks248-variant-cli-implicit-rights.mjs';
  const original = readFileSync(CLI, 'utf8');
  const mutated = original.replace(
    "    rights: valueOf('--rights'),",
    "    rights: valueOf('--rights') ?? RIGHTS_A_PATH,");
  assert.notEqual(mutated, original, 'the CLI variant did not change the source');
  writeFileSync(variantCli, mutated);
  try {
    const out = execFileSync(process.execPath, [variantCli, '--cases', `${FD}/cases-v1.json`], { encoding: 'utf8' });
    assert.match(out, /COMPARISON-DENIED KS248_COMPARISON_DENIED:INPUT_REQUIRED/);
    assert.equal(/missing=[^\n]*rights/.test(out), false,
      'the broken CLI still reported the implicitly defaulted rights input as missing');
  } finally {
    rmSync(variantCli, { force: true });
    assert.equal(existsSync(variantCli), false);
  }
  const green = runCli(['--cases', `${FD}/cases-v1.json`]);
  assert.match(green, /missing=holdout,calibration,sourceIdentity,rights,rows/);
});
