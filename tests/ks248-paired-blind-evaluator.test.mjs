// KS248: evaluator-owned fixed-domain BLIND subset over the released paired SQL read.
// The holdout is loaded only by this test, never sent to the producer or consumer CLI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pairedAccessReference, scorePairedAccess } from '../scripts/run-ks248-paired-access-evaluation.mjs';
const fd = 'tests/fixtures/business-bi/ks248-paired-evaluator/';
const cases = JSON.parse(readFileSync(fd + 'cases-v1.json'));
const holdout = JSON.parse(readFileSync(fd + 'holdout-v1.json'));
const sourcePath = 'tests/fixtures/business-bi/ks246-unfamiliar-schema/source-pay-feed-v1.json';
const source = readFileSync(sourcePath);
const producer = process.env.KS247_PRODUCER_CHECKOUT;
const runtime = process.env.KS247_PGLITE_PATH;
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const caseOf = (id) => cases.cases.find((item) => item.caseId === id);
const expected = (id) => holdout.expectations.find((item) => item.caseId === id);
function invoke(extra = []) {
  const scratch = mkdtempSync(join(tmpdir(), 'ks248-paired-evaluator-'));
  try {
    const answer = join(scratch, 'answers.txt');
    writeFileSync(answer, ['synth_x.pay_feed.pf_id', 'synth_x.pay_feed.val_dt',
      'MINOR_UNITS', 'synth_x.pay_feed.amt_a', 'EUR', 'R', 'V'].join('\n') + '\n');
    const result = spawnSync(process.execPath, ['scripts/run-result-lineage-journey.mjs',
      '--answers', answer,
      '--kind-decisions', 'tests/fixtures/business-bi/ks246-unfamiliar-schema/kind-decisions-v1.json',
      '--business-semantics', 'tests/fixtures/business-bi/ks246-unfamiliar-schema/business-semantics-v1.json',
      '--source-revision', cases.sourceRevision, ...extra], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
test('KS248 evaluator case/holdout are disjoint from candidate inputs and pin exact fixed source', () => {
  assert.equal(sha256(source), holdout.sourceSha256);
  assert.deepEqual(new Set(cases.cases.map((v) => v.caseId)).size, cases.cases.length);
  assert.deepEqual(new Set(holdout.expectations.map((v) => v.caseId)).size, holdout.expectations.length);
  for (const item of cases.cases) {
    assert.equal(Object.hasOwn(item, 'expected'), false);
    assert.equal(Object.hasOwn(item, 'status'), false);
    assert.equal(Object.hasOwn(item, 'netMinorUnits'), false);
  }
  const calibration = cases.cases.filter((v) => v.population === 'PUBLIC_CALIBRATION');
  const blind = cases.cases.filter((v) => v.population === 'BLIND_HOLDOUT');
  assert.equal(calibration.length, 1);
  assert.equal(blind.length, 2);
  assert.deepEqual(holdout.expectations.map((v) => v.caseId).sort(), blind.map((v) => v.caseId).sort());
  assert.equal(new Set(calibration.map((v) => v.caseId)).size, calibration.length);
});
const accessCases = JSON.parse(readFileSync(fd + 'access-cases-v2.json'));
const accessHoldout = JSON.parse(readFileSync(fd + 'access-holdout-v2.json'));
const accessCalibration = JSON.parse(readFileSync(fd + 'access-calibration-v2.json'));
test('KS248 F4: one frozen paired task has separate calibration/holdout and all three requested modes', () => {
  assert.equal(sha256(source), accessCases.sourceSha256);
  assert.deepEqual(new Set(accessCases.cases.map((v) => v.accessMode)),
    new Set(['METADATA_ONLY', 'PERMITTED_AGGREGATES', 'PERMITTED_FULL_DATA']));
  const allExpectations = [...accessCalibration.expectations, ...accessHoldout.expectations];
  assert.equal(new Set(allExpectations.map((v) => v.caseId)).size, allExpectations.length);
  for (const item of accessCases.cases) {
    assert.deepEqual(Object.keys(item).sort(), ['accessMode', 'caseId', 'population']);
    const population = item.population === 'PUBLIC_CALIBRATION' ? accessCalibration : accessHoldout;
    const exp = population.expectations.find((v) => v.caseId === item.caseId);
    assert.ok(exp);
    assert.deepEqual(pairedAccessReference(JSON.parse(source).rows, accessCases, item.accessMode),
      { outcome: exp.outcome, numbers: exp.numbers });
  }
});

test('KS248 F4: one-cent/reference-rule mutations fail the independent paired checker', () => {
  const rows = JSON.parse(source).rows;
  const exp = accessHoldout.expectations.find((v) => v.caseId === 'blind:paired-full');
  assert.equal(scorePairedAccess(pairedAccessReference(rows, accessCases, 'PERMITTED_FULL_DATA'), exp), 'CORRECT_ACCEPTANCE');
  rows.find((v) => v.pf_id === 's-011').amt_a += 1;
  assert.equal(scorePairedAccess(pairedAccessReference(rows, accessCases, 'PERMITTED_FULL_DATA'), exp), 'WRONG_NUMBER');
  assert.throws(() => pairedAccessReference(rows, { ...accessCases, rule: 'EXCLUDE_BOUNDARY_DATES' },
    'PERMITTED_FULL_DATA'), /REFERENCE_RULE_UNSUPPORTED/);
  assert.equal(scorePairedAccess({ outcome: 'ABSTAINED', numbers: null }, exp), 'FALSE_REFUSAL');
  assert.equal(scorePairedAccess({ outcome: 'UNSUPPORTED_MODE', numbers: null }, accessCalibration.expectations[0]), 'WRONG_REFUSAL_REASON');
  assert.equal(scorePairedAccess({ outcome: 'ACCEPTED', numbers: exp.numbers }, accessCalibration.expectations[0]), 'FALSE_ACCEPTANCE');
});

if (producer && runtime) {
  test('KS248 F4 actual evaluator scores fixed paired task without laundering unsupported modes', () => {
    const out = spawnSync(process.execPath, ['scripts/run-ks248-paired-access-evaluation.mjs',
      '--producer-checkout', producer, '--pglite', runtime], { encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    const report = JSON.parse(out.stdout);
    assert.equal(report.outcome, 'EVALUATED_WITH_FALSIFIED_REUSE');
    assert.equal(report.benchmark, 'FAIL');
    assert.equal(report.task.sourceSha256, accessCases.sourceSha256);
    assert.equal(report.identity.producerSha, accessCases.producerSha);
    assert.match(report.identity.consumerSha, /^[a-f0-9]{40}$/);
    assert.equal(report.populations.BLIND_HOLDOUT.reference.correctAcceptance, 2);
    assert.equal(report.populations.BLIND_HOLDOUT.integrated.correctAcceptance, 1);
    assert.equal(report.populations.BLIND_HOLDOUT.integrated.falseRefusal, 1);
    assert.equal(report.populations.PUBLIC_CALIBRATION.reference.justifiedAbstention, 1);
    assert.equal(report.populations.PUBLIC_CALIBRATION.integrated.wrongRefusalReason, 1);
    const full = report.results.find((v) => v.accessMode === 'PERMITTED_FULL_DATA');
    assert.equal(full.candidate.executed, true);
    assert.equal(full.candidate.verifiedNumberCount, 24);
    for (const item of report.results.filter((v) => v.accessMode !== 'PERMITTED_FULL_DATA')) {
      assert.equal(item.candidate.code, 'KS247_PAIRED_CLI_SCOPE_DENIED');
      assert.equal(item.candidate.numbers, null);
      assert.equal(item.candidate.executed, false);
      assert.equal(item.candidate.dataRightsQualification, 'NOT_ESTABLISHED');
    }
    for (const population of Object.values(report.populations)) {
      for (const candidate of Object.values(population)) {
        for (const metric of ['clarification', 'activeHumanWork', 'activeAgentWork', 'correctionWork', 'waiting', 'measurableCostMinorUnits']) {
          assert.equal(candidate[metric], null);
        }
      }
    }
  });
  test('KS248 calibration stays unpaired; blind case reaches real paired SQL and independent integers', () => {
    assert.equal(caseOf('calibration:unpaired-default').mode, 'UNPAIRED_READ_ONLY');
    const base = invoke();
    assert.equal(base.pairedQualification, undefined);
    assert.equal(base.verification.verifiedNumberCount, 24);
    const run = invoke(['--producer-checkout', producer, '--pglite', runtime]);
    const exp = expected('blind:paired-period-net');
    assert.equal(caseOf(exp.caseId).mode, 'PAIRED_FULL_DATA_READ');
    assert.equal(run.pairedRead.status, exp.status);
    assert.equal(run.pairedRead.effectStatus, exp.effectStatus);
    assert.equal(run.pairedQualification.verifiedNumberCount, 24);
    assert.equal(run.pairedQualification.sourceSha256, holdout.sourceSha256);
    assert.equal(run.pairedQualification.units, exp.unit);
    const numbers = Object.fromEntries(run.lineage.sections.verifiedNumbers.map((v) => [v.lineId, v.value]));
    assert.equal(numbers['periods.comparison.netMinorUnits'], exp.comparisonNetMinorUnits);
    assert.equal(numbers['periods.current.netMinorUnits'], exp.currentNetMinorUnits);
    assert.equal(numbers.deltaMinorUnits, exp.deltaMinorUnits);
    assert.equal(numbers['periods.comparison.rowCount'], exp.comparisonRows);
    assert.equal(numbers['periods.current.rowCount'], exp.currentRows);
    // Independent arithmetic over the fixed source, not a readback of the product result.
    const rows = JSON.parse(source).rows;
    for (const [name, start, end] of [['comparison', '2026-06-01', '2026-06-30'],
      ['current', '2026-07-01', '2026-07-31']]) {
      const selected = rows.filter((row) => row.val_dt !== null && row.val_dt >= start && row.val_dt <= end);
      const sales = selected.filter((row) => row.ev_typ === 'P' && Number.isInteger(row.amt_a))
        .reduce((sum, row) => sum + row.amt_a, 0);
      const credits = selected.filter((row) => row.ev_typ === 'R' && Number.isInteger(row.amt_a))
        .reduce((sum, row) => sum + row.amt_a, 0);
      assert.equal(exp[name + 'NetMinorUnits'], sales - credits);
      assert.equal(exp[name + 'Rows'], selected.length);
    }
    assert.equal(exp.deltaMinorUnits, exp.currentNetMinorUnits - exp.comparisonNetMinorUnits);
  });
  test('KS248 declared metadata/aggregate rights cannot be smuggled into fixed paired task', () => {
    for (const mode of ['METADATA_ONLY', 'PERMITTED_AGGREGATES']) {
      const out = invoke(['--producer-checkout', producer, '--pglite', runtime, '--access-mode', mode]);
      assert.equal(out.journeyDenial.message, 'KS247_PAIRED_CLI_SCOPE_DENIED');
      assert.equal(out.verification.verifiedNumberCount, 0);
      assert.equal(out.executed, false);
    }
  });
  test('KS248 blind one-cent source drift is denied at producer scope before SQL result is claimed', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'ks248-drift-'));
    try {
      const changed = JSON.parse(source);
      changed.rows.find((row) => row.pf_id === 's-011').amt_a += 1;
      const file = join(scratch, 'changed.json');
      writeFileSync(file, JSON.stringify(changed));
      const out = invoke(['--producer-checkout', producer, '--pglite', runtime, '--source', file]);
      const exp = expected('blind:one-cent-source-drift');
      assert.equal(caseOf(exp.caseId).mode, 'PAIRED_MUTATED_SOURCE');
      assert.equal(out.journeyDenial.message, exp.reasonCode);
      assert.equal(out.verification.verifiedNumberCount, 0);
      assert.equal(out.pairedQualification, undefined);
      assert.equal(out.executed, false);
      assert.notEqual(sha256(readFileSync(file)), holdout.sourceSha256);
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  });
}
