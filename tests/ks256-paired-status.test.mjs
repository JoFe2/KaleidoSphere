import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { projectPairedReadStatus } from '../services/bi-control/src/business-bi/paired-read-status-projection-v1.mjs';
import { observeSyntheticTarget, syntheticTargetArtifacts, syntheticTargetMarker } from '../services/bi-control/src/business-bi/synthetic-target-status-v1.mjs';

const status = process.env.KS256_STATUS_PRODUCER_CHECKOUT;
const read = process.env.KS247_PRODUCER_CHECKOUT;
const corrected = process.env.KS247_PAN486_PRODUCER_CHECKOUT;
const runtime = process.env.KS247_PGLITE_PATH;
const cli = (...args) => {
  const run = spawnSync(process.execPath, ['scripts/run-ks256-paired-status.mjs', ...args], { encoding: 'utf8' });
  return { exit: run.status, result: JSON.parse(run.stdout), stderr: run.stderr };
};
const args = () => ['--pan-status-checkout', status, '--pan-read-checkout', read, '--pglite', runtime];

test('KS256 source archive excludes inherited environment-bound evidence without deleting its Git bytes', () => {
  const excluded = ['WORK_RESULT.md',
    'closure-audits/PORTFOLIO-KS143-ROOT-QS/exact-head-local-gate-receipt.json',
    'docs/evidence/m6-03-bi-specialist/qwen-conformance-manifest.json',
    'scripts/run-qwen-conformance-evidence.mjs'];
  const archive = spawnSync('git', ['archive', '--format=tar', 'HEAD'], { maxBuffer: 32 * 1024 * 1024 });
  assert.equal(archive.status, 0, archive.stderr?.toString());
  const listing = spawnSync('tar', ['-tf', '-'], { input: archive.stdout, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  assert.equal(listing.status, 0, listing.stderr);
  const files = new Set(listing.stdout.trim().split('\n'));
  for (const file of excluded) {
    assert.equal(files.has(file), false, file);
    const retained = spawnSync('git', ['show', `HEAD:${file}`]);
    assert.equal(retained.status, 0, file);
    assert.deepEqual(retained.stdout, readFileSync(file), `historic bytes changed: ${file}`);
  }
  for (const file of ['SOURCE-MAP.json', 'scripts/run-ks256-paired-status.mjs',
    'services/bi-control/src/business-bi/synthetic-target-status-v1.mjs', 'tests/ks256-paired-status.test.mjs']) {
    assert.equal(files.has(file), true, file);
  }
});

test('KS256 missing checkouts and write escalation refuse without running either producer', () => {
  for (const extra of [[], ['--request-action', 'MIGRATE'], ['--pan-status-checkout', '/missing']]) {
    const out = cli(...extra);
    assert.equal(out.exit, 1);
    assert.equal(out.result.code, 'KS256_PAIRED_INPUT_SCOPE_DENIED');
    assert.equal(out.result.mutationCount, 0);
  }
  assert.equal(projectPairedReadStatus({ requestedAction: 'MIGRATE' }).code,
    'KS256_WRITE_AUTHORITY_NOT_GRANTED');
});
if (status && read && runtime) {
  test('KS256 actual paired SQL and exact PAN461/471 crossing show source but no target inference', () => {
    const out = cli(...args());
    assert.equal(out.exit, 0, out.stderr);
    const view = out.result;
    assert.equal(view.outcome, 'PROJECTED_LOCAL_SYNTHETIC_READ_ONLY');
    assert.equal(view.source.verifiedNumberCount, 24);
    assert.equal(view.source.question, 'bi-ks-01-net-revenue');
    assert.equal(view.source.unit, 'EUR_MINOR_UNITS');
    assert.equal(view.producerCrossing.status, 'EXECUTED_AND_REBOUND_LOCAL_SYNTHETIC');
    assert.equal(view.producerCrossing.lifecycle.state, 'RUNNING');
    assert.equal(view.producerCrossing.capabilities.coverage.find(c => c.kind === 'ERP_ORDER_CREATE').availability, 'UNAVAILABLE');
    assert.equal(view.producerCrossing.appliesToMetricSourceOrTarget, false);
    assert.equal(view.target.identity, 'UNKNOWN');
    assert.equal(view.target.observed, false);
    assert.equal(view.denominator, 'NOT_OBSERVED');
    assert.equal(view.progress, 'UNKNOWN');
    assert.equal(view.quarantine, 'NOT_OBSERVED');
    assert.equal(view.authority.mutationCount, 0);
    assert.equal(view.authority.migration, 'NOT_GRANTED');
  });
  test('KS256 stale/substituted checkout cannot look current and action flags do not pass', () => {
    const incorrect = cli('--pan-status-checkout', read, '--pan-read-checkout', read, '--pglite', runtime);
    assert.equal(incorrect.exit, 1);
    assert.equal(incorrect.result.code, 'KS256_UPSTREAM_UNAVAILABLE');
    const noRead = cli('--pan-status-checkout', status, '--pan-read-checkout', status, '--pglite', runtime);
    assert.equal(noRead.exit, 1);
    assert.equal(noRead.result.code, 'KS256_PAIRED_READ_UNQUALIFIED');
    const write = cli(...args(), '--request-action', 'RESTORE');
    assert.equal(write.exit, 1);
    assert.equal(write.result.code, 'KS256_PAIRED_INPUT_SCOPE_DENIED');
  });
}
test('KS256 refuses unqualified source/target states even with well-shaped reported fields', () => {
  const read = { pairedQualification: { status: 'VERIFIED_LOCAL_SYNTHETIC_READ_ONLY',
    completion: 'READ_COMPLETE', effectStatus: 'NO_EFFECT_AUTHORIZED', mutationAuthority: false,
    externalSourceAuthority: 'NOT_GRANTED', producerSha: 'a', sourceSha256: 'b', taskRef: 'c',
    lineageSha256: 'd', verifiedNumberCount: 24 },
  pairedRead: { producerSha: 'a', status: 'READ_COMPLETE', effectStatus: 'NO_EFFECT_AUTHORIZED',
    task: { sourceSha256: 'b', taskRef: 'c' } },
  lineage: { lineageSha256: 'd', verification: { verifiedNumberCount: 24 },
    sections: { completion: { complete: true } } } };
  const crossing = { outcome: 'PROJECTED', code: 'OK', producerCrossing: 'EXECUTED_AND_REBOUND_LOCAL_SYNTHETIC',
    mutationCount: 0, producerStatus: { authority: 'READ_ONLY', promotedToKsLifecycle: false,
      promotedToKsProgress: false, effectConfirmed: false }, ksStatus: {
      authority: { writeAuthority: 'NOT_GRANTED', mutationCount: 0 } },
    crossingBindingDigest: 'f'.repeat(64) };
  // Self-consistent labels are not a released task/result qualification.
  assert.equal(projectPairedReadStatus({ read, crossing }).code, 'KS256_PAIRED_READ_UNQUALIFIED');
  const changed = structuredClone(read);
  changed.pairedRead.task.sourceSha256 = 'resealed-other-source';
  assert.equal(projectPairedReadStatus({ read: changed, crossing }).code, 'KS256_PAIRED_READ_UNQUALIFIED');
  const changedStatus = structuredClone(crossing);
  changedStatus.producerStatus.promotedToKsProgress = true;
  assert.equal(projectPairedReadStatus({ read, crossing: changedStatus }).code, 'KS256_PAIRED_READ_UNQUALIFIED');
  changedStatus.producerStatus.promotedToKsProgress = false;
  changedStatus.ksStatus.authority.writeAuthority = 'GRANTED';
  assert.equal(projectPairedReadStatus({ read, crossing: changedStatus }).code, 'KS256_PAIRED_READ_UNQUALIFIED');
});

test('KS256 corrected PAN486 source reaches the actual display without target inference', { skip: !(status && corrected && runtime) }, () => {
  const base = ['--pan-status-checkout', status, '--pan-read-checkout', corrected,
    '--pglite', runtime, '--source-variant', 'v3'];
  const out = cli(...base);
  assert.equal(out.exit, 0, out.stderr + JSON.stringify(out.result));
  assert.equal(out.result.source.sourceRevision, 'synthetic-unfamiliar-source-v2');
  assert.equal(out.result.source.producerSha, 'da92e10d8751f99b4103dfaa14bc5e5eb732e9dd');
  assert.equal(out.result.source.verifiedNumberCount, 24);
  assert.equal(out.result.target.identity, 'UNKNOWN');
  assert.equal(out.result.denominator, 'NOT_OBSERVED');
  assert.equal(out.result.authority.mutationCount, 0);
  const stale = [...base]; stale[3] = read;
  assert.equal(cli(...stale).result.code, 'KS256_PAIRED_READ_UNQUALIFIED');
  assert.equal(cli(...base, '--request-action', 'UPDATE').result.code, 'KS256_PAIRED_INPUT_SCOPE_DENIED');
});

// These are mutations of actual child outputs, not an independent host observation.
test('KS256 display rejects substituted qualifications, lineage and producer status',
  { skip: !(status && read && runtime) }, () => {
    const root = mkdtempSync(join(tmpdir(), 'ks256-output-binding-'));
    const run = (script, args) => {
      const child = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
      assert.equal(child.status, 0, child.stderr);
      return JSON.parse(child.stdout);
    };
    try {
      const answers = join(root, 'answers.txt');
      writeFileSync(answers, ['synth_x.pay_feed.pf_id', 'synth_x.pay_feed.val_dt',
        'MINOR_UNITS', 'synth_x.pay_feed.amt_a', 'EUR', 'R', 'V'].join('\n'));
      const fd = 'tests/fixtures/business-bi/ks246-unfamiliar-schema/';
      const original = {
        crossing: run('scripts/run-ks256-public-producer-crossing.mjs', ['--pan-checkout', status]),
        read: run('scripts/run-result-lineage-journey.mjs', ['--answers', answers,
          '--kind-decisions', fd + 'kind-decisions-v1.json',
          '--business-semantics', fd + 'business-semantics-v1.json',
          '--source-revision', 'synthetic-unfamiliar-source-v1',
          '--producer-checkout', read, '--pglite', runtime]),
      };
      assert.equal(projectPairedReadStatus(original).outcome, 'PROJECTED_LOCAL_SYNTHETIC_READ_ONLY');
      for (const mutate of [
        v => { v.read.pairedQualification.question = 'substituted'; },
        v => { v.read.pairedQualification.period.current.end = '2026-07-30'; },
        v => { v.read.lineage.sections.verifiedNumbers[0].value += 1; },
        v => { v.read.lineage.sourceRevision = 'stale'; },
      ]) {
        const changed = structuredClone(original); mutate(changed);
        assert.equal(projectPairedReadStatus(changed).code, 'KS256_PAIRED_READ_UNQUALIFIED');
      }
      const changed = structuredClone(original);
      changed.crossing.producerStatus.lifecycle.state = 'UNKNOWN';
      assert.equal(projectPairedReadStatus(changed).code, 'KS256_PRODUCER_STATUS_UNQUALIFIED');
      // A newly executed/rebound observation may legitimately be UNKNOWN; never infer RUNNING.
      changed.crossing.crossingBindingDigest = createHash('sha256').update(JSON.stringify({
        ks: changed.crossing.ksStatus.bindingDigest, producers: changed.crossing.producerStatus,
      })).digest('hex');
      assert.equal(projectPairedReadStatus(changed).producerCrossing.lifecycle.state, 'UNKNOWN');
      assert.equal(projectPairedReadStatus({ ...original, requestedAction: 'RESTORE' }).code,
        'KS256_WRITE_AUTHORITY_NOT_GRANTED');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

const provisionTarget = (root, sourceRead, revision = 'synthetic-target-r1') => {
  writeFileSync(join(root, 'target.json'), JSON.stringify(syntheticTargetMarker(sourceRead, revision)));
  for (const [id, bytes] of Object.entries(syntheticTargetArtifacts(sourceRead))) writeFileSync(join(root, `${id}.json`), bytes);
};
const mutateTarget = root => {
  rmSync(join(root, 'read-task.json'));
  chmodSync(join(root, 'read-result.json'), 0o000);
  rmSync(join(root, 'result-lineage.json'));
  symlinkSync('missing-synthetic-file', join(root, 'result-lineage.json'));
  writeFileSync(join(root, 'qualification.json'), 'generic synthetic mismatched artifact');
};
const assertMixedTarget = view => {
  assert.deepEqual(view.ownedScope.map(s => s.coverage), ['AVAILABLE', 'OBSERVED_ABSENT', 'DENIED', 'UNKNOWN', 'PARTIAL']);
  assert.equal(view.denominator.value, 5);
  assert.equal(view.progress.verifiedCount, 1);
  assert.equal(view.progress.fraction, null);
  assert.equal(view.quarantine.length, 1);
  assert.equal(view.quarantine[0].id, 'qualification');
  assert.equal(view.quarantine[0].includedInProgress, false);
  assert.equal(view.nextResponsibleRole, 'TARGET_CONTRACT_OWNER');
};

// Canonical CI: actual local file reads, but helper-only source qualification here.
// The full child execution/qualification boundary is exercised in the opt-in test below.
test('KS256 synthetic target observer reads bytes and preserves all coverage states (helper boundary)', () => {
  const root = mkdtempSync(join(tmpdir(), 'ks256-target-unit-'));
  const sourceRead = { pairedQualification: { sourceRevision: 'synthetic-v1', sourceSha256: 'a'.repeat(64), taskRef: 'synthetic-task' },
    pairedRead: { task: { sourceSha256: 'a'.repeat(64) } }, lineage: { synthetic: true } };
  try {
    provisionTarget(root, sourceRead);
    const input = { root, revision: 'synthetic-target-r1', read: sourceRead };
    const full = observeSyntheticTarget(input);
    assert.equal(full.outcome, 'OBSERVED_LOCAL_SYNTHETIC_TARGET');
    assert.equal(full.progress.fraction, 1);
    assert.equal(full.progress.verifiedCount, 5);
    assert.equal(full.target.observed, true);
    const bound = { ...input, expectedObservationSha256: full.target.observationSha256 };
    assert.equal(observeSyntheticTarget(bound).progress.fraction, 1);
    mutateTarget(root);
    assertMixedTarget(observeSyntheticTarget(input));
    assert.equal(observeSyntheticTarget(bound).code, 'KS256_TARGET_CARRIED_OBSERVATION_MISMATCH');
    assert.equal(observeSyntheticTarget({ ...input, revision: 'synthetic-target-r2' }).code, 'KS256_TARGET_SOURCE_OR_REVISION_MISMATCH');
    const changed = structuredClone(sourceRead); changed.pairedQualification.sourceSha256 = 'b'.repeat(64);
    assert.equal(observeSyntheticTarget({ ...input, read: changed }).code, 'KS256_TARGET_SOURCE_OR_REVISION_MISMATCH');
    const marker = syntheticTargetMarker(sourceRead, input.revision); marker.email = 'generic-payload-must-not-escape';
    writeFileSync(join(root, 'target.json'), JSON.stringify(marker));
    const rejected = observeSyntheticTarget(input);
    assert.equal(rejected.code, 'KS256_TARGET_SOURCE_OR_REVISION_MISMATCH');
    assert.equal(JSON.stringify(rejected).includes(marker.email), false);
    assert.equal(JSON.stringify(rejected).includes(root), false);
  } finally { chmodSync(join(root, 'read-result.json'), 0o600); rmSync(root, { recursive: true, force: true }); }
});

test('KS256 AC01-03 actual paired display observes target; rejects stale/substitution/privacy/authority across v1 and v3',
  { skip: !(status && read && corrected && runtime) }, () => {
    for (const variant of ['v1', 'v3']) {
      const root = mkdtempSync(join(tmpdir(), 'ks256-target-entry-'));
      const producer = variant === 'v1' ? read : corrected;
      const fd = variant === 'v1' ? 'tests/fixtures/business-bi/ks246-unfamiliar-schema/' : 'tests/fixtures/business-bi/ks247-second-source/';
      const version = variant === 'v1' ? 'v1' : 'v2';
      try {
        const answers = join(root, 'answers.txt');
        writeFileSync(answers, ['synth_x.pay_feed.pf_id', 'synth_x.pay_feed.val_dt', 'MINOR_UNITS',
          'synth_x.pay_feed.amt_a', 'EUR', 'R', 'V'].join('\n'));
        const run = spawnSync(process.execPath, ['scripts/run-result-lineage-journey.mjs',
          '--answers', answers, '--kind-decisions', fd + `kind-decisions-${version}.json`,
          '--business-semantics', fd + `business-semantics-${version}.json`,
          '--source-revision', `synthetic-unfamiliar-source-${version}`, '--source-variant', variant,
          ...(variant === 'v3' ? ['--source', fd + 'source-pay-feed-v2.json', '--expectation', fd + 'independent-expectation-v2.json'] : []),
          '--producer-checkout', producer, '--pglite', runtime], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
        assert.equal(run.status, 0, run.stderr);
        const sourceRead = JSON.parse(run.stdout);
        provisionTarget(root, sourceRead);
        const base = ['--pan-status-checkout', status, '--pan-read-checkout', producer, '--pglite', runtime,
          '--source-variant', variant, '--target-snapshot', root, '--target-revision', 'synthetic-target-r1'];
        const before = Object.fromEntries(readdirSync(root).map(name => [name, readFileSync(join(root, name)).toString('hex')]));
        const full = cli(...base);
        assert.equal(full.exit, 0, JSON.stringify(full));
        assert.equal(full.result.target.identity, 'synthetic-receipt-target');
        assert.equal(full.result.target.sourceSha256, full.result.source.sourceSha256);
        assert.equal(full.result.progress.fraction, 1);
        assert.equal(full.result.progress.verifiedCount, 5);
        assert.equal(full.result.denominator.value, 5);
        assert.equal(full.result.producerCrossing.appliesToMetricSourceOrTarget, false);
        assert.deepEqual(full.result.quarantine, []);
        assert.deepEqual(Object.fromEntries(readdirSync(root).map(name => [name, readFileSync(join(root, name)).toString('hex')])), before);
        for (const action of ['UPDATE', 'RESTORE', 'MIGRATE']) {
          const refused = cli(...base, '--request-action', action);
          assert.equal(refused.exit, 1);
          assert.equal(refused.result.code, 'KS256_PAIRED_INPUT_SCOPE_DENIED');
          assert.equal(refused.result.mutationCount, 0);
        }
        assert.equal(cli(...base, '--target-revision', 'synthetic-target-r2').result.code, 'KS256_PAIRED_INPUT_SCOPE_DENIED');
        const stale = [...base]; stale[stale.length - 1] = 'synthetic-target-r2';
        assert.equal(cli(...stale).result.code, 'KS256_TARGET_SOURCE_OR_REVISION_MISMATCH');
        mutateTarget(root);
        const mixed = cli(...base);
        assert.equal(mixed.exit, 0, JSON.stringify(mixed));
        assertMixedTarget(mixed.result);
        assert.equal(mixed.result.authority.mutationCount, 0);
        assert.equal(cli(...base, '--target-observation-sha256', full.result.target.observationSha256).result.code,
          'KS256_TARGET_CARRIED_OBSERVATION_MISMATCH');
        const marker = syntheticTargetMarker(sourceRead, 'synthetic-target-r1');
        marker.sourceSha256 = 'f'.repeat(64);
        writeFileSync(join(root, 'target.json'), JSON.stringify(marker));
        assert.equal(cli(...base).result.code, 'KS256_TARGET_SOURCE_OR_REVISION_MISMATCH');
        marker.email = 'generic-payload-must-not-escape';
        writeFileSync(join(root, 'target.json'), JSON.stringify(marker));
        const privateShape = cli(...base);
        assert.equal(privateShape.result.code, 'KS256_TARGET_SOURCE_OR_REVISION_MISMATCH');
        assert.equal(JSON.stringify(privateShape.result).includes(marker.email), false);
        assert.equal(JSON.stringify(privateShape.result).includes(root), false);
      } finally {
        try { chmodSync(join(root, 'read-result.json'), 0o600); } catch {}
        rmSync(root, { recursive: true, force: true });
      }
    }
  });
