#!/usr/bin/env node
// KaleidoSphere #248 (KS-EVO-03) — the ONE runnable LOCAL access-mode comparison entry point.
//
// It compares the composed analysis journey under the declared information-rights access
// modes, against the public CALIBRATION set and the BLIND holdout kept strictly separate, and
// against a competent deterministic reference.
//
//   node scripts/run-access-mode-journey-comparison.mjs
//       EOF run: no input at all. Nothing is read, no fixture is adopted.
//
//   node scripts/run-access-mode-journey-comparison.mjs --cases <f> --holdout <f> \
//       --calibration <f> --source-identity <f> --rights <f> --source-rows <f> \
//       [--format JSON|TABLE]
//       Every input above is REQUIRED and is NEVER defaulted.
//
//   node scripts/run-access-mode-journey-comparison.mjs ... --verify --binding <f>
//       Re-execute over the independently retained rows and require the carried binding to
//       re-derive EXACTLY. A one-cent row mutation and a rule mutation in the cases both fail.
//
//   node scripts/run-access-mode-journey-comparison.mjs --negative
//       Execute the bounded negative gates and print each exact rejection code.
//
// This CLI WRITES NOTHING: it prints to stdout, opens no socket, sends no SQL of its own and
// grants no authority beyond one local read-only synthetic comparison.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

import {
  ACCESS_MODE_FORMATS,
  ACCESS_MODE_INTERNALS,
  buildAccessModeJourneyComparison,
  renderAccessModeComparison,
  verifyAccessModeJourneyComparison,
} from '../services/bi-control/src/business-bi/access-mode-journey-comparison-v1.mjs';

const FD = 'tests/fixtures/business-bi/ks248-access-modes';
const ROWS_PATH = 'tests/fixtures/business-bi/net-revenue-segment-v1.json';
const CASES_PATH = `${FD}/cases-v1.json`;
const HOLDOUT_PATH = `${FD}/holdout-v1.json`;
const CALIBRATION_PATH = `${FD}/calibration-v1.json`;
const HOLDOUT_DENIED_CREDITS_PATH = `${FD}/holdout-denied-credits-v1.json`;
const CALIBRATION_DENIED_CREDITS_PATH = `${FD}/calibration-denied-credits-v1.json`;
const SOURCE_IDENTITY_PATH = `${FD}/source-identity-v1.json`;
const RIGHTS_A_PATH = `${FD}/rights-profile-a-v1.json`;
const RIGHTS_B_PATH = `${FD}/rights-profile-b-v1.json`;
const NOW = '2026-09-23T00:00:00.000Z';

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? null : args[index + 1] ?? null;
};
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const readRows = (file) => {
  const parsed = readJson(file);
  return Array.isArray(parsed) ? parsed : parsed.rows;
};
const clone = (value) => JSON.parse(JSON.stringify(value));

function inputsFromArgs() {
  const files = {
    cases: valueOf('--cases'),
    holdout: valueOf('--holdout'),
    calibration: valueOf('--calibration'),
    sourceIdentity: valueOf('--source-identity'),
    rights: valueOf('--rights'),
    rows: valueOf('--source-rows'),
  };
  const missing = Object.entries(files).filter(([, file]) => file === null).map(([key]) => key);
  if (missing.length > 0) {
    return { denial: { outcome: 'DENIED', code: 'KS248_COMPARISON_DENIED:INPUT_REQUIRED', missing } };
  }
  return {
    cases: readJson(files.cases),
    holdout: readJson(files.holdout),
    calibration: readJson(files.calibration),
    sourceIdentity: readJson(files.sourceIdentity),
    rights: readJson(files.rights),
    rows: readRows(files.rows),
    now: NOW,
  };
}

function receipt(report) {
  const blind = report.metrics.blindHoldout;
  const calibration = report.metrics.publicCalibration;
  return {
    outcome: report.outcome,
    casesVersion: report.casesVersion,
    holdoutEvaluationId: report.holdoutEvaluationId,
    blindHoldoutCases: report.populations.blindHoldout.length,
    publicCalibrationCases: report.populations.publicCalibration.length,
    blindCorrectAcceptance: blind.correctAcceptance,
    blindFalseAcceptance: blind.falseAcceptance,
    blindFalseRefusal: blind.falseRefusal,
    blindWrongNumber: blind.wrongNumber,
    blindJustifiedAbstention: blind.justifiedAbstention,
    blindRefusalMatch: blind.refusalMatch,
    calibrationCorrectAcceptance: calibration.correctAcceptance,
    calibrationFalseAcceptance: calibration.falseAcceptance,
    calibrationFalseRefusal: calibration.falseRefusal,
    integratedPathDisagreement: blind.integratedPathDisagreement + calibration.integratedPathDisagreement,
    waiting: blind.waiting,
    activeHumanOrAgentWork: blind.activeHumanOrAgentWork,
    measurableCostMinorUnits: blind.measurableCostMinorUnits,
    bindingDigest: report.bindingDigest,
  };
}

if (args.length === 0) {
  process.stdout.write('mode=eof report=null executed=false\n');
  process.stdout.write('COMPARISON-DENIED KS248_COMPARISON_DENIED:INPUT_REQUIRED missing=cases,holdout,calibration,sourceIdentity,rights,rows\n');
  process.exit(0);
}

if (has('--negative')) {
  const base = {
    cases: readJson(CASES_PATH),
    holdout: readJson(HOLDOUT_PATH),
    calibration: readJson(CALIBRATION_PATH),
    sourceIdentity: readJson(SOURCE_IDENTITY_PATH),
    rights: readJson(RIGHTS_A_PATH),
    rows: readRows(ROWS_PATH),
    now: NOW,
  };
  const { sha256 } = ACCESS_MODE_INTERNALS;
  const resealHoldout = (population) => {
    const { digest: _ignored, ...body } = population;
    return { ...body, digest: sha256(body) };
  };
  const gates = [];
  const addGate = (name, expected, run) => gates.push({ name, expected, run });

  addGate('eof-input-required', 'KS248_COMPARISON_DENIED:INPUT_REQUIRED',
    () => buildAccessModeJourneyComparison({ now: NOW }));
  addGate('cases-malformed', 'KS248_COMPARISON_DENIED:CASES_MALFORMED', () => {
    const cases = clone(base.cases);
    delete cases.casesVersion;
    return buildAccessModeJourneyComparison({ ...base, cases });
  });
  addGate('holdout-blind-flag-wrong', 'KS248_COMPARISON_DENIED:HOLDOUT_MALFORMED', () => {
    const holdout = clone(base.holdout);
    holdout.blind = false;
    return buildAccessModeJourneyComparison({ ...base, holdout: resealHoldout(holdout) });
  });
  addGate('holdout-digest-not-re-derived', 'KS248_COMPARISON_DENIED:HOLDOUT_MALFORMED', () => {
    const holdout = clone(base.holdout);
    holdout.expectations[0].expectedNetRevenue = {
      comparisonNetMinorUnits: 1, currentNetMinorUnits: 2, deltaNetMinorUnits: 1,
    };
    return buildAccessModeJourneyComparison({ ...base, holdout });
  });
  addGate('calibration-malformed', 'KS248_COMPARISON_DENIED:CALIBRATION_MALFORMED', () => {
    const calibration = clone(base.calibration);
    calibration.blind = true;
    return buildAccessModeJourneyComparison({ ...base, calibration: resealHoldout(calibration) });
  });
  addGate('rights-malformed', 'KS248_COMPARISON_DENIED:RIGHTS_MALFORMED',
    () => buildAccessModeJourneyComparison({ ...base, rights: { fxConversion: 'MAYBE', credits: 'PERMITTED' } }));
  addGate('source-identity-malformed', 'KS248_COMPARISON_DENIED:SOURCE_IDENTITY_MALFORMED',
    () => buildAccessModeJourneyComparison({ ...base, sourceIdentity: { sourceLabel: 'x' } }));
  addGate('rows-required', 'KS248_COMPARISON_DENIED:ROWS_REQUIRED',
    () => buildAccessModeJourneyComparison({ ...base, rows: [] }));
  addGate('blind-case-without-holdout-expectation', 'KS248_COMPARISON_DENIED:BLIND_CASE_WITHOUT_HOLDOUT_EXPECTATION', () => {
    const holdout = clone(base.holdout);
    holdout.expectations = holdout.expectations.filter((entry) => entry.caseId !== 'case:full-net-delta');
    return buildAccessModeJourneyComparison({ ...base, holdout: resealHoldout(holdout) });
  });
  addGate('calibration-case-without-expectation', 'KS248_COMPARISON_DENIED:CALIBRATION_CASE_WITHOUT_EXPECTATION', () => {
    const calibration = clone(base.calibration);
    calibration.expectations = calibration.expectations.filter((entry) => entry.caseId !== 'case:full-fx-required');
    return buildAccessModeJourneyComparison({ ...base, calibration: resealHoldout(calibration) });
  });
  addGate('calibration-contaminates-blind-holdout', 'KS248_COMPARISON_DENIED:CALIBRATION_CONTAMINATES_BLIND_HOLDOUT', () => {
    const calibration = clone(base.calibration);
    calibration.expectations.push(clone(base.holdout.expectations[0]));
    return buildAccessModeJourneyComparison({ ...base, calibration: resealHoldout(calibration) });
  });
  addGate('source-substitution-one-cent', 'KS248_COMPARISON_DENIED:SOURCE_SUBSTITUTION', () => {
    const rows = clone(base.rows);
    rows[0].amount_minor_units += 1;
    return buildAccessModeJourneyComparison({ ...base, rows });
  });
  addGate('format-unsupported', 'KS248_COMPARISON_DENIED:FORMAT_UNSUPPORTED', () => {
    const report = buildAccessModeJourneyComparison({ ...base });
    return renderAccessModeComparison(report, 'CSV');
  });
  addGate('verify-one-cent-row-mutation', 'KS248_COMPARISON_DENIED:SOURCE_SUBSTITUTION', () => {
    // A one-cent mutation of the retained rows no longer matches the independently retained
    // source identity: the substitution is refused before any number is recomputed.
    const report = buildAccessModeJourneyComparison({ ...base });
    const rows = clone(base.rows);
    rows[0].amount_minor_units += 1;
    return verifyAccessModeJourneyComparison({ ...base, rows, report, bindingDigest: report.bindingDigest });
  });
  addGate('verify-one-cent-row-mutation-resealed-identity', 'KS248_COMPARISON_DENIED:SERIALIZED_BINDING_MISMATCH', () => {
    // Even when the caller RE-DERIVES the source identity for the mutated rows, the carried
    // binding no longer re-derives. Recomputing a digest is not evidence.
    const report = buildAccessModeJourneyComparison({ ...base });
    const rows = clone(base.rows);
    rows[0].amount_minor_units += 1;
    const sourceIdentity = { ...clone(base.sourceIdentity),
      sourceBytesSha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
    return verifyAccessModeJourneyComparison({ ...base, rows, sourceIdentity, report, bindingDigest: report.bindingDigest });
  });
  addGate('verify-rule-mutation', 'KS248_COMPARISON_DENIED:SERIALIZED_BINDING_MISMATCH', () => {
    const report = buildAccessModeJourneyComparison({ ...base });
    const cases = clone(base.cases);
    cases.cases.find((item) => item.caseId === 'case:full-net-delta').boundaryRule = 'EXCLUDE_BOUNDARY_DATES';
    return verifyAccessModeJourneyComparison({ ...base, cases, report, bindingDigest: report.bindingDigest });
  });
  addGate('verify-rights-mutation', 'KS248_COMPARISON_DENIED:SERIALIZED_BINDING_MISMATCH', () => {
    const report = buildAccessModeJourneyComparison({ ...base });
    return verifyAccessModeJourneyComparison({ ...base, rights: readJson(RIGHTS_B_PATH), report, bindingDigest: report.bindingDigest });
  });
  addGate('verify-resealed-report', 'KS248_COMPARISON_DENIED:SERIALIZED_EVIDENCE_MISMATCH', () => {
    const report = buildAccessModeJourneyComparison({ ...base });
    const resealed = clone(report);
    resealed.binding.metrics = { publicCalibration: {}, blindHoldout: {} };
    return verifyAccessModeJourneyComparison({ ...base, report: resealed, bindingDigest: report.bindingDigest });
  });
  addGate('verify-serialized-binding-malformed', 'KS248_COMPARISON_DENIED:SERIALIZED_BINDING_MALFORMED',
    () => verifyAccessModeJourneyComparison({ ...base, report: {}, bindingDigest: 'not-a-digest' }));
  addGate('verify-one-cent-expectation-mutation', 'KS248_COMPARISON_DENIED:BLIND_HOLDOUT_VERDICT_FAILED', () => {
    // A ONE-CENT mutation of the blind expectation is enough for the independent checker to
    // fail the comparison — the checker is not resting on the comparison's self-consistency.
    const holdout = clone(base.holdout);
    const entry = holdout.expectations.find((item) => item.caseId === 'case:full-net-delta');
    entry.expectedNetRevenue.comparisonNetMinorUnits += 1;
    entry.expectedNetRevenue.deltaNetMinorUnits =
      entry.expectedNetRevenue.currentNetMinorUnits - entry.expectedNetRevenue.comparisonNetMinorUnits;
    const sealed = resealHoldout(holdout);
    const report = buildAccessModeJourneyComparison({ ...base, holdout: sealed });
    return verifyAccessModeJourneyComparison({ ...base, holdout: sealed, report, bindingDigest: report.bindingDigest });
  });

  let failures = 0;
  for (const gate of gates) {
    let observed;
    try { observed = gate.run(); } catch (error) { observed = { code: `THREW:${String(error?.message ?? error)}` }; }
    const ok = observed?.code === gate.expected;
    if (!ok) failures += 1;
    process.stdout.write(`gate=${gate.name.padEnd(42)} expected=${gate.expected} observed=${observed?.code} ${ok ? 'OK' : 'UNEXPECTEDLY_ACCEPTED'}\n`);
  }
  process.stdout.write(`negative gates: ${gates.length} executed, ${failures} unexpected\n`);
  process.exit(0);
}

const loaded = inputsFromArgs();
if (loaded.denial) {
  process.stdout.write(`COMPARISON-DENIED ${loaded.denial.code} missing=${(loaded.denial.missing ?? []).join(',')}\n`);
  process.exit(0);
}

if (has('--verify')) {
  const bindingFile = valueOf('--binding');
  if (bindingFile === null) {
    process.stdout.write('COMPARISON-DENIED KS248_COMPARISON_DENIED:SERIALIZED_BINDING_MALFORMED missing=binding\n');
    process.exit(0);
  }
  const carried = readJson(bindingFile);
  const verified = verifyAccessModeJourneyComparison({
    ...loaded, report: carried, bindingDigest: carried.bindingDigest,
  });
  process.stdout.write(`verify=${verified.outcome} code=${verified.code} bindingDigest=${verified.bindingDigest ?? null}\n`);
  process.exit(0);
}

const format = valueOf('--format') ?? 'JSON';
if (!ACCESS_MODE_FORMATS.includes(format)) {
  process.stdout.write(`COMPARISON-DENIED KS248_COMPARISON_DENIED:FORMAT_UNSUPPORTED format=${format}\n`);
  process.exit(0);
}

const report = buildAccessModeJourneyComparison(loaded);
if (report.outcome !== 'COMPARED') {
  process.stdout.write(`COMPARISON-DENIED ${report.code} ${JSON.stringify(report.missing ?? report.detail ?? {})}\n`);
  process.exit(0);
}
const rendered = renderAccessModeComparison(report, format);
process.stdout.write(rendered.text);
process.stdout.write(`COMPARISON-RECEIPT ${JSON.stringify(receipt(report))}\n`);
process.stdout.write(`sourceRowsSha256=${createHash('sha256').update(JSON.stringify(loaded.rows)).digest('hex')}\n`);
