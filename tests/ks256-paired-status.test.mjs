import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { projectPairedReadStatus } from '../services/bi-control/src/business-bi/paired-read-status-projection-v1.mjs';

const status = process.env.KS256_STATUS_PRODUCER_CHECKOUT;
const read = process.env.KS247_PRODUCER_CHECKOUT;
const runtime = process.env.KS247_PGLITE_PATH;
const cli = (...args) => {
  const run = spawnSync(process.execPath, ['scripts/run-ks256-paired-status.mjs', ...args], { encoding: 'utf8' });
  return { exit: run.status, result: JSON.parse(run.stdout), stderr: run.stderr };
};
const args = () => ['--pan-status-checkout', status, '--pan-read-checkout', read, '--pglite', runtime];

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
    assert.equal(view.source.unit, 'EUR_MINOR_UNITS');
    assert.equal(view.producerCrossing.status, 'EXECUTED_AND_REBOUND_LOCAL_SYNTHETIC');
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
  assert.equal(projectPairedReadStatus({ read, crossing }).outcome, 'PROJECTED_LOCAL_SYNTHETIC_READ_ONLY');
  const changed = structuredClone(read);
  changed.pairedRead.task.sourceSha256 = 'resealed-other-source';
  assert.equal(projectPairedReadStatus({ read: changed, crossing }).code, 'KS256_PAIRED_READ_UNQUALIFIED');
  const changedStatus = structuredClone(crossing);
  changedStatus.producerStatus.promotedToKsProgress = true;
  assert.equal(projectPairedReadStatus({ read, crossing: changedStatus }).code, 'KS256_PRODUCER_STATUS_UNQUALIFIED');
  changedStatus.producerStatus.promotedToKsProgress = false;
  changedStatus.ksStatus.authority.writeAuthority = 'GRANTED';
  assert.equal(projectPairedReadStatus({ read, crossing: changedStatus }).code, 'KS256_PRODUCER_STATUS_UNQUALIFIED');
});
