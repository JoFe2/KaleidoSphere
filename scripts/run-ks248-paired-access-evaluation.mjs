#!/usr/bin/env node
// KS248 evaluator, NOT a new metric or producer contract. Run from a clean Git checkout:
// node scripts/run-ks248-paired-access-evaluation.mjs --producer-checkout <pinned-v1> --pglite <pinned-entry>
// Exit 0 means the comparison executed, NOT that reuse passed. Read benchmark/outcome.
// The trusted evaluator reads synthetic rows/expectations; candidate argv never receives
// evaluator expectations. Restricted-mode attempts test the existing entry's scope refusal,
// not an enforced OS/DB data-isolation boundary or a successful aggregate implementation.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fd = 'tests/fixtures/business-bi/ks248-paired-evaluator/';
const sourceFile = 'tests/fixtures/business-bi/ks246-unfamiliar-schema/source-pay-feed-v1.json';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const read = (file) => readFileSync(path.join(root, file));
const json = (file) => JSON.parse(read(file));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

// Independent evaluator fold over the frozen source, not a call to the product's metric core.
export function pairedAccessReference(rows, task, mode) {
  assert.equal(task.rule, 'INCLUDE_BOUNDARY_DATES', 'REFERENCE_RULE_UNSUPPORTED');
  assert.equal(task.unit, 'EUR_MINOR_UNITS');
  if (mode === 'METADATA_ONLY') return { outcome: 'ABSTAINED', numbers: null };
  assert.ok(['PERMITTED_AGGREGATES', 'PERMITTED_FULL_DATA'].includes(mode));
  const totals = {};
  for (const [name, window] of Object.entries(task.periods)) {
    let sale = 0; let credit = 0;
    for (const row of rows) {
      if (row.val_dt === null || row.val_dt < window.start || row.val_dt > window.end
          || !Number.isSafeInteger(row.amt_a)) continue;
      if (row.ev_typ === 'P') sale += row.amt_a;
      if (row.ev_typ === 'R') credit += row.amt_a;
    }
    // Aggregate reference consumes these period totals; full-data reference shares the
    // same declared business rule. This is a reference capability, NOT a candidate result.
    totals[name] = sale - credit;
    assert.ok(Number.isSafeInteger(totals[name]));
  }
  return { outcome: 'ACCEPTED', numbers: {
    comparisonNetMinorUnits: totals.comparison, currentNetMinorUnits: totals.current,
    deltaMinorUnits: totals.current - totals.comparison,
  } };
}

export function scorePairedAccess(observed, expected) {
  assert.ok(['ACCEPTED', 'ABSTAINED'].includes(expected.outcome));
  if (observed.outcome === 'ACCEPTED' && expected.outcome !== 'ACCEPTED') return 'FALSE_ACCEPTANCE';
  if (observed.outcome !== 'ACCEPTED' && expected.outcome === 'ACCEPTED') return 'FALSE_REFUSAL';
  if (observed.outcome !== 'ACCEPTED') {
    return observed.outcome === expected.outcome ? 'JUSTIFIED_ABSTENTION' : 'WRONG_REFUSAL_REASON';
  }
  const fields = ['comparisonNetMinorUnits', 'currentNetMinorUnits', 'deltaMinorUnits'];
  return fields.every((key) => Number.isSafeInteger(observed.numbers?.[key])
      && observed.numbers[key] === expected.numbers?.[key]) ? 'CORRECT_ACCEPTANCE' : 'WRONG_NUMBER';
}

function metrics(results) {
  const count = (name) => results.filter((row) => row.verdict === name).length;
  return {
    caseCount: results.length,
    correctAcceptance: count('CORRECT_ACCEPTANCE'), falseAcceptance: count('FALSE_ACCEPTANCE'),
    falseRefusal: count('FALSE_REFUSAL'), wrongNumber: count('WRONG_NUMBER'),
    justifiedAbstention: count('JUSTIFIED_ABSTENTION'), wrongRefusalReason: count('WRONG_REFUSAL_REASON'),
    unsupportedModeCount: results.filter((row) => row.candidate.outcome === 'UNSUPPORTED_MODE').length,
    clarification: null, activeHumanWork: null, activeAgentWork: null,
    correctionWork: null, waiting: null, measurableCostMinorUnits: null,
    unknownReason: 'NOT_INSTRUMENTED: only candidate outputs and evaluator verdict counts are observed; no effort or price inferred',
  };
}

export function evaluatePairedAccess({ producerCheckout, pglite }) {
  assert.ok(path.isAbsolute(producerCheckout) && path.isAbsolute(pglite), 'EXPLICIT_RUNTIME_PATHS_REQUIRED');
  const consumerSha = git('rev-parse', 'HEAD');
  git('cat-file', '-e', `${consumerSha}:scripts/run-ks248-paired-access-evaluation.mjs`);
  assert.equal(git('status', '--porcelain', '--untracked-files=no'), '', 'CLEAN_CONSUMER_REQUIRED');
  const task = json(fd+'access-cases-v2.json');
  const calibration = json(fd+'access-calibration-v2.json');
  const holdout = json(fd+'access-holdout-v2.json');
  const source = read(sourceFile);
  assert.equal(sha256(source), task.sourceSha256, 'EVALUATOR_SOURCE_DRIFT');
  const expectations = [...calibration.expectations, ...holdout.expectations];
  assert.equal(new Set(expectations.map((v) => v.caseId)).size, expectations.length, 'POPULATIONS_OVERLAP');
  assert.deepEqual(expectations.map((v) => v.caseId).sort(), task.cases.map((v) => v.caseId).sort());
  const sourceRows = JSON.parse(source).rows;
  const scratch = mkdtempSync(path.join(tmpdir(), 'ks248-paired-access-'));
  const results = [];
  try {
    const answers = path.join(scratch, 'answers.txt');
    writeFileSync(answers, ['synth_x.pay_feed.pf_id', 'synth_x.pay_feed.val_dt', 'MINOR_UNITS',
      'synth_x.pay_feed.amt_a', 'EUR', 'R', 'V'].join('\n')+'\n');
    for (const item of task.cases) {
      assert.deepEqual(Object.keys(item).sort(), ['accessMode', 'caseId', 'population']);
      const population = item.population === 'PUBLIC_CALIBRATION' ? calibration : holdout;
      assert.equal(population.population, item.population);
      const expected = population.expectations.find((v) => v.caseId === item.caseId);
      assert.ok(expected, 'FROZEN_EXPECTATION_REQUIRED');
      const reference = pairedAccessReference(sourceRows, task, item.accessMode);
      assert.deepEqual(reference, { outcome: expected.outcome, numbers: expected.numbers }, 'REFERENCE_EXPECTATION_MISMATCH');
      const args = ['scripts/run-result-lineage-journey.mjs', '--answers', answers,
        '--kind-decisions', 'tests/fixtures/business-bi/ks246-unfamiliar-schema/kind-decisions-v1.json',
        '--business-semantics', 'tests/fixtures/business-bi/ks246-unfamiliar-schema/business-semantics-v1.json',
        '--source-revision', task.sourceRevision, '--producer-checkout', producerCheckout, '--pglite', pglite];
      if (item.accessMode !== 'PERMITTED_FULL_DATA') args.push('--access-mode', item.accessMode);
      // No evaluator cases, calibration or holdout path is passed to the candidate.
      const child = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 8*1024*1024 });
      assert.equal(child.status, 0, 'CANDIDATE_INVOCATION_FAILED');
      const output = JSON.parse(child.stdout);
      let candidate;
      if (output.journeyDenial?.message === 'KS247_PAIRED_CLI_SCOPE_DENIED') {
        assert.equal(output.executed, false);
        assert.equal(output.verification.verifiedNumberCount, 0);
        assert.equal(output.pairedQualification, undefined);
        candidate = { outcome: 'UNSUPPORTED_MODE', code: 'KS247_PAIRED_CLI_SCOPE_DENIED',
          numbers: null, executed: false, verifiedNumberCount: 0,
          dataRightsQualification: 'NOT_ESTABLISHED',
          note: 'Entry rejects this mode. It preloads local fixtures; no input-isolation or permitted-mode implementation is claimed.' };
      } else {
        const qualification = output.pairedQualification;
        assert.equal(qualification?.producerSha, task.producerSha, 'PRODUCER_IDENTITY_MISMATCH');
        assert.equal(qualification.sourceSha256, task.sourceSha256, 'SOURCE_IDENTITY_MISMATCH');
        assert.equal(qualification.sourceRevision, task.sourceRevision);
        assert.equal(qualification.question, task.metricId);
        assert.equal(qualification.taskRef, task.taskRef);
        assert.equal(qualification.layout, task.layout);
        assert.equal(qualification.units, task.unit);
        assert.deepEqual(qualification.period, task.periods);
        assert.equal(qualification.completion, 'READ_COMPLETE');
        assert.equal(qualification.effectStatus, 'NO_EFFECT_AUTHORIZED');
        assert.equal(qualification.mutationAuthority, false);
        assert.equal(qualification.verifiedNumberCount, 24);
        const numbers = Object.fromEntries(output.lineage.sections.verifiedNumbers.map((v) => [v.lineId, v.value]));
        assert.equal(output.pairedRead.status, 'READ_COMPLETE');
        candidate = { outcome: 'ACCEPTED', code: 'READ_COMPLETE', executed: true,
          verifiedNumberCount: qualification.verifiedNumberCount,
          effectStatus: qualification.effectStatus,
          numbers: { comparisonNetMinorUnits: numbers['periods.comparison.netMinorUnits'],
            currentNetMinorUnits: numbers['periods.current.netMinorUnits'], deltaMinorUnits: numbers.deltaMinorUnits } };
      }
      results.push({ ...item, reference, candidate, verdict: scorePairedAccess(candidate, expected),
        candidateStdoutSha256: sha256(child.stdout), candidateExit: child.status });
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
  const populations = Object.fromEntries(['PUBLIC_CALIBRATION', 'BLIND_HOLDOUT'].map((name) => {
    const selected = results.filter((v) => v.population === name);
    return [name, { reference: metrics(selected.map((v) => ({ ...v, candidate: v.reference,
      verdict: scorePairedAccess(v.reference, v.reference) }))), integrated: metrics(selected) }];
  }));
  const failed = results.some((v) => !['CORRECT_ACCEPTANCE', 'JUSTIFIED_ABSTENTION'].includes(v.verdict));
  return {
    schemaVersion: 'kaleidosphere.evaluator/paired-access-report/v2',
    outcome: failed ? 'EVALUATED_WITH_FALSIFIED_REUSE' : 'EVALUATED_WITH_REFERENCE_AGREEMENT',
    benchmark: failed ? 'FAIL' : 'PASS',
    classification: 'LOCAL_SYNTHETIC_EVALUATION_NOT_NEW_ACCESS_CAPABILITY',
    identity: { consumerSha, consumerTree: git('rev-parse', 'HEAD^{tree}'), producerSha: task.producerSha,
      casesSha256: sha256(read(fd+'access-cases-v2.json')),
      holdoutSha256: sha256(read(fd+'access-holdout-v2.json')),
      calibrationSha256: sha256(read(fd+'access-calibration-v2.json')) },
    task: { sourceSha256: task.sourceSha256, sourceRevision: task.sourceRevision,
      question: task.question, metricId: task.metricId, taskRef: task.taskRef, layout: task.layout,
      rule: task.rule, unit: task.unit, periods: task.periods },
    populations, results,
    nonclaims: ['Restricted-mode entry attempts are not admitted mode executions or database privileges.',
      'Reference aggregate capability is not implemented by the paired candidate.',
      'No effects, customer data, third-party blindness, human comprehension or measured superiority.',
      'Segment-access comparison remains a separate dataset; its successes are not pooled here.'],
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { 'producer-checkout': { type: 'string' }, pglite: { type: 'string' } }, strict: true });
    const report = evaluatePairedAccess({ producerCheckout: values['producer-checkout'], pglite: values.pglite });
    process.stdout.write(JSON.stringify(report, null, 2)+'\n');
  } catch {
    // Do not echo caller paths, source bytes or subprocess stderr into public evidence.
    process.stderr.write('KS248_PAIRED_EVALUATION_FAILED: require clean consumer, pinned producer/runtime and consistent evaluator inputs\n');
    process.exitCode = 1;
  }
}
