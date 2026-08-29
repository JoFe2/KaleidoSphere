// Focused tests for the local-only epic #35 release-or-no-release and
// public-readback harness. The fixtures are synthetic, deterministic evidence:
// they never authorize a network call, dispatch, merge, or release.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildChecklist,
  buildReceipt,
  canonicalize,
  CONTRACT_SCHEMA,
  parseFlags,
  run,
  terminalHash,
  validateFixtureFile,
} from '../scripts/prepare-progressive-analysis-release-readback.mjs';

const SCRIPT = 'scripts/prepare-progressive-analysis-release-readback.mjs';
const RELEASE_PATH = 'fixtures/evidence/progressive-analysis/epic-35-release-readback-valid.json';
const NO_RELEASE_PATH = 'fixtures/evidence/progressive-analysis/epic-35-no-release-valid.json';
const BASE_SHA = '35'.repeat(20);
const HEAD_SHA = 'de5facf183b8b85cd7bd455359541fc29f69e43e';
const RELEASE_HASH = 'd5ef25e4b9fed6f1a04f57dfbfedd20b2c3e2beaf3ee87f289d2b1321adf6168';
const NO_RELEASE_HASH = '49b00dfcd99890156ec11cbd1cf2ff2fbe441e3bc909f6e41181eeafdbff5426';

const releaseText = await readFile(RELEASE_PATH, 'utf8');
const noReleaseText = await readFile(NO_RELEASE_PATH, 'utf8');
const releaseRecord = JSON.parse(releaseText);
const noReleaseRecord = JSON.parse(noReleaseText);

const childOf = (record, issue) => record.children.find((child) => child.child_issue === issue);

function mutate(record, change) {
  const copy = structuredClone(record);
  change(copy);
  return copy;
}

function expectRejection(label, record, code) {
  const result = validateFixtureFile(canonicalize(record));
  assert.equal(result.ok, false, `${label}: expected fail-closed rejection`);
  assert.equal(result.code, code, `${label}: expected ${code}, got ${result.code}: ${result.detail}`);
}

function flipHash(hash) {
  return hash.replace(/^./, hash[0] === '0' ? '1' : '0');
}

test('both canonical fixtures validate and retain exact base/head lineage', () => {
  assert.deepEqual(validateFixtureFile(releaseText), { ok: true, code: 'OK' });
  assert.deepEqual(validateFixtureFile(noReleaseText), { ok: true, code: 'OK' });
  assert.equal(releaseRecord.terminal_hash, RELEASE_HASH);
  assert.equal(noReleaseRecord.terminal_hash, NO_RELEASE_HASH);
  assert.equal(terminalHash(releaseRecord), RELEASE_HASH);
  assert.equal(terminalHash(noReleaseRecord), NO_RELEASE_HASH);
  assert.equal(releaseText, `${canonicalize(releaseRecord)}\n`);
  assert.equal(noReleaseText, `${canonicalize(noReleaseRecord)}\n`);

  for (const record of [releaseRecord, noReleaseRecord]) {
    assert.equal(record.base_sha, BASE_SHA);
    assert.equal(record.head_sha, HEAD_SHA);
    assert.deepEqual(record.children.map((child) => child.child_issue), [36, 37, 38, 39, 40]);
    for (const child of record.children) {
      assert.equal(child.exact_ci.head_sha, HEAD_SHA, `child ${child.child_issue} exact-head lineage`);
      assert.equal(child.exact_ci.main_sha, BASE_SHA, `child ${child.child_issue} exact-main lineage`);
      assert.equal(child.exact_ci.exact_head_conclusion, 'success');
      assert.equal(child.exact_ci.exact_main_conclusion, 'success');
    }
  }
});

test('released synthetic record yields a deterministic public-readback checklist with exact identifiers', () => {
  const first = buildReceipt(releaseRecord, true);
  const second = buildReceipt(structuredClone(releaseRecord), true);
  assert.equal(canonicalize(first), canonicalize(second), 'receipt builds are byte-stable');
  assert.equal(first.ok, true);
  assert.equal(first.code, 'OK');
  assert.equal(first.dry_run, true);
  assert.equal(first.decision, 'released');
  assert.equal(first.public_release_claims, 'authorized');
  assert.deepEqual(first.release, {
    artifact: 'dist/progressive-analysis-v0.18.0',
    tag: 'v0.18.0',
    tag_sha: '4120412041204120412041204120412041204120',
  });
  assert.deepEqual(first.public_readback, {
    receipt: 'readback-epic-35-release',
    status: 'success',
    checklist: buildChecklist(releaseRecord),
  });
  assert.equal(first.public_readback.checklist.length, 55, 'five release identifiers plus ten identifiers per child');

  const expectedByChild = {
    36: ['v0.12.0', '3620362036203620362036203620362036203620', 'readback-v0.12.0', '3610361036103610361036103610361036103610', '1', '1', '2', 'cov-36-readback', 'budget-36-readback', 'neg-36-readback'],
    37: ['v0.13.0', '3720372037203720372037203720372037203720', 'readback-v0.13.0', '3710371037103710371037103710371037103710', '2', '3', '4', 'cov-37-readback', 'budget-37-readback', 'neg-37-readback'],
    38: ['v0.14.0', '3820382038203820382038203820382038203820', 'readback-v0.14.0', '3810381038103810381038103810381038103810', '3', '5', '6', 'cov-38-readback', 'budget-38-readback', 'neg-38-readback'],
    39: ['v0.17.0', '3920392039203920392039203920392039203920', 'readback-v0.17.0', '3910391039103910391039103910391039103910', '4', '7', '8', 'cov-39-readback', 'budget-39-readback', 'neg-39-readback'],
    40: ['v0.18.0', '4020402040204020402040204020402040204020', 'readback-v0.18.0', '4010401040104010401040104010401040104010', '5', '9', '10', 'cov-40-readback', 'budget-40-readback', 'neg-40-readback'],
  };
  for (const child of first.children) {
    const source = childOf(releaseRecord, child.child_issue);
    assert.deepEqual(child, source, `child ${child.child_issue} retains its exact merge/release/evidence state`);
    const expected = expectedByChild[child.child_issue];
    const identifiers = [
      source.release_decision.tag,
      source.release_decision.tag_sha,
      source.release_decision.public_readback,
      source.merged_pr.merge_sha,
      String(source.merged_pr.number),
      String(source.exact_ci.exact_head_check_id),
      String(source.exact_ci.exact_main_check_id),
      source.exact_ci.coverage_receipt,
      source.exact_ci.budget_receipt,
      source.exact_ci.negative_receipt,
    ];
    assert.deepEqual(identifiers, expected, `child ${child.child_issue} checklist identifiers`);
  }
  assert.deepEqual(first.nonclaims, releaseRecord.nonclaims);
});

test('no-release synthetic record yields a deterministic rationale packet and suppresses release claims', () => {
  const first = buildReceipt(noReleaseRecord, true);
  const second = buildReceipt(structuredClone(noReleaseRecord), true);
  assert.equal(canonicalize(first), canonicalize(second), 'no-release receipt builds are byte-stable');
  assert.equal(first.ok, true);
  assert.equal(first.code, 'OK');
  assert.equal(first.decision, 'no_release');
  assert.equal(first.public_release_claims, 'suppressed');
  assert.equal(first.public_readback, null);
  assert.equal(first.release, null);
  assert.deepEqual(first.rationale_packet, noReleaseRecord.no_release);
  assert.match(first.rationale_packet.rationale, /no public release/i);
  assert.deepEqual(first.children.map((child) => child.child_issue), [36, 37, 38, 39, 40]);
  for (const issue of [36, 37, 38, 39]) {
    const child = childOf(first, issue);
    assert.equal(child.disposition, 'merged');
    assert.equal(child.release_decision.decision, 'no_release');
    assert.equal(child.release_decision.tag, null);
    assert.equal(child.release_decision.tag_sha, null);
    assert.equal(child.release_decision.public_readback, null);
  }
  const child40 = childOf(first, 40);
  assert.equal(child40.disposition, 'closed_no_delivery');
  assert.equal(child40.merged_pr, null);
  assert.equal(child40.release_decision, null);
  assert.deepEqual(child40.closed_rationale, {
    evidence_refs: ['docs/evidence/conveyor/sol-ks-35-state-reconcile-01.json'],
    reason_code: 'child-40-nonterminal',
  });
  assert.deepEqual(first.nonclaims, noReleaseRecord.nonclaims);
});

test('the run entry point executes both dry-run fixtures without side effects', async () => {
  const released = await run(['--fixture', RELEASE_PATH, '--dry-run']);
  assert.equal(released.exit, 0);
  assert.equal(released.text, `${canonicalize(buildReceipt(releaseRecord, true))}\n`);

  const withheld = await run(['--fixture', NO_RELEASE_PATH, '--dry-run']);
  assert.equal(withheld.exit, 0);
  assert.equal(withheld.text, `${canonicalize(buildReceipt(noReleaseRecord, true))}\n`);
});

test('fail-closed negatives reject missing release/readback/merge identifiers and stale receipts', () => {
  expectRejection('missing release artifact', mutate(releaseRecord, (record) => {
    delete record.release.artifact;
  }), 'E-SHAPE');
  expectRejection('missing release tag', mutate(releaseRecord, (record) => {
    delete record.release.tag;
  }), 'E-SHAPE');
  expectRejection('missing child merge identifier', mutate(releaseRecord, (record) => {
    delete childOf(record, 36).merged_pr.merge_sha;
  }), 'E-SHAPE');
  expectRejection('failed anonymous public readback', mutate(releaseRecord, (record) => {
    record.release.readback.status = 'failed';
  }), 'E-SHAPE');
  expectRejection('stale terminal receipt', mutate(releaseRecord, (record) => {
    record.terminal_hash = flipHash(record.terminal_hash);
  }), 'E-R08');
});

test('fail-closed negatives reject raw values, credentials, unsupported capability, timeout, and cancel', () => {
  expectRejection('raw value key', mutate(releaseRecord, (record) => {
    record.nonclaims.push('RAW_VALUE: fixture material');
  }), 'E-CONTENT-RAW');
  expectRejection('credential-like value', mutate(releaseRecord, (record) => {
    record.nonclaims.push('credential=password=hunter2');
  }), 'E-CONTENT-CREDENTIAL');
  expectRejection('credential-like key', mutate(releaseRecord, (record) => {
    record.release.credentials = 'fixture-only';
  }), 'E-CONTENT-KEY');
  expectRejection('free SQL value', mutate(releaseRecord, (record) => {
    record.nonclaims.push('SELECT 1');
  }), 'E-CONTENT-SQL');
  expectRejection('unsupported exact-head timeout conclusion', mutate(releaseRecord, (record) => {
    childOf(record, 36).exact_ci.exact_head_conclusion = 'timed_out';
  }), 'E-SHAPE');
  expectRejection('unsupported exact-main cancellation conclusion', mutate(releaseRecord, (record) => {
    childOf(record, 36).exact_ci.exact_main_conclusion = 'cancelled';
  }), 'E-SHAPE');

  const unsupported = structuredClone(CONTRACT_SCHEMA);
  unsupported.$defs.unused = { type: 'string', default: 'future-capability' };
  assert.throws(
    () => validateFixtureFile(releaseText, unsupported),
    /unsupported schema keyword at \$\.unused: default/
  );
});

test('fail-closed no-release records require a complete rationale packet', () => {
  expectRejection('no-release without rationale', mutate(noReleaseRecord, (record) => {
    record.no_release = null;
  }), 'E-R07');
  expectRejection('no-release rationale without reason code', mutate(noReleaseRecord, (record) => {
    delete record.no_release.reason_code;
  }), 'E-SHAPE');
  expectRejection('no-release rationale without evidence refs', mutate(noReleaseRecord, (record) => {
    record.no_release.evidence_refs = [];
  }), 'E-SHAPE');
  expectRejection('released epic without release block', mutate(releaseRecord, (record) => {
    record.release = null;
  }), 'E-R07');
});

test('exact-head and exact-main identifiers are required, successful, distinct, and unique', () => {
  expectRejection('missing exact-head check id', mutate(releaseRecord, (record) => {
    delete childOf(record, 36).exact_ci.exact_head_check_id;
  }), 'E-SHAPE');
  expectRejection('failed exact-head check', mutate(releaseRecord, (record) => {
    childOf(record, 36).exact_ci.exact_head_conclusion = 'failure';
  }), 'E-SHAPE');
  expectRejection('same head/main check id', mutate(releaseRecord, (record) => {
    childOf(record, 36).exact_ci.exact_main_check_id = childOf(record, 36).exact_ci.exact_head_check_id;
  }), 'E-R03');
  expectRejection('check id reused by another child', mutate(releaseRecord, (record) => {
    childOf(record, 37).exact_ci.exact_head_check_id = 1;
  }), 'E-R04');
  expectRejection('exact-head lineage drift', mutate(releaseRecord, (record) => {
    childOf(record, 36).exact_ci.head_sha = '3636'.repeat(10);
  }), 'E-R02');
  expectRejection('exact-main lineage drift', mutate(releaseRecord, (record) => {
    childOf(record, 36).exact_ci.main_sha = '3434'.repeat(10);
  }), 'E-R02');
});

test('fail-closed negatives reject scope drift from the pinned reviewed task head', () => {
  expectRejection('stale head against the pinned reviewed task head', mutate(releaseRecord, (record) => {
    record.head_sha = '3540'.repeat(10);
  }), 'E-SCOPE');
  expectRejection('stale base against the pinned fixture placeholder', mutate(releaseRecord, (record) => {
    record.base_sha = '34'.repeat(20);
  }), 'E-SCOPE');
});

test('source is local-only and the CLI envelopes are deterministic and fail-closed', async () => {
  const source = await readFile(SCRIPT, 'utf8');
  for (const token of ['node:http', 'node:https', 'node:net', 'node:dns', 'node:child_process', 'fetch(', 'WebSocket', 'XMLHttpRequest']) {
    assert.equal(source.includes(token), false, `harness must not reference ${token}`);
  }
  assert.deepEqual(parseFlags(['--fixture', RELEASE_PATH, '--dry-run']), { fixture: RELEASE_PATH, dryRun: true });
  assert.deepEqual(parseFlags(['--fixture=', '--dry-run']), { error: '--fixture requires a path argument' });
  assert.deepEqual(parseFlags(['--unknown']), { error: 'unknown argument: --unknown' });

  const usage = await run([]);
  assert.equal(usage.exit, 2);
  assert.deepEqual(JSON.parse(usage.text), {
    code: 'E-CLI',
    detail: 'missing required --fixture <path>',
    dry_run: false,
    ok: false,
    path: null,
    terminal_hash: null,
  });
  const missing = await run(['--fixture', 'fixtures/evidence/progressive-analysis/not-present.json', '--dry-run']);
  assert.equal(missing.exit, 2);
  assert.equal(JSON.parse(missing.text).dry_run, true);
  assert.equal(JSON.parse(missing.text).code, 'E-CLI');
});

test('malformed validator input and option-shaped fixture arguments fail closed', () => {
  assert.deepEqual(validateFixtureFile(null), {
    ok: false,
    code: 'E-SHAPE',
    path: '$',
    detail: 'fixture input must be UTF-8 text',
  });
  assert.deepEqual(parseFlags(['--fixture', '--dry-run']), {
    error: '--fixture requires a path argument',
  });
});

test('CLI subprocess emits one deterministic public-readback line for the release fixture', () => {
  const args = [SCRIPT, '--fixture', RELEASE_PATH, '--dry-run'];
  const first = execFileSync(process.execPath, args, { encoding: 'utf8' });
  const second = execFileSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(first, second);
  assert.equal(first, `${canonicalize(buildReceipt(releaseRecord, true))}\n`);
  assert.equal(first.trimEnd().split('\n').length, 1);
});

test('receipt: the current-main replay changes exactly the canonical closure paths', () => {
  const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const allowed = [
    'SOURCE-MAP.json',
    'docs/evidence/conveyor/sol-ks-35-state-reconcile-01.json',
    'docs/evidence/progressive-analysis/epic-35-close-comment.template.md',
    'docs/evidence/progressive-analysis/epic-35-closure-contract.md',
    'docs/evidence/progressive-analysis/epic-35-closure.schema.json',
    'docs/evidence/progressive-analysis/epic-35-delivery-packet.template.json',
    'fixtures/evidence/progressive-analysis/epic-35-closure-forged-receipt.json',
    'fixtures/evidence/progressive-analysis/epic-35-closure-missing-foundation.json',
    'fixtures/evidence/progressive-analysis/epic-35-closure-valid.json',
    'fixtures/evidence/progressive-analysis/epic-35-exact-ci-mismatch.json',
    'fixtures/evidence/progressive-analysis/epic-35-exact-ci-valid.json',
    'fixtures/evidence/progressive-analysis/epic-35-no-release-valid.json',
    'fixtures/evidence/progressive-analysis/epic-35-release-readback-valid.json',
    'package.json',
    'scripts/prepare-progressive-analysis-release-readback.mjs',
    'scripts/verify-progressive-analysis-closure.mjs',
    'scripts/verify-progressive-analysis-exact-ci.mjs',
    'tests/epic-35-closure-fixture.test.mjs',
    'tests/epic-35-closure-schema.test.mjs',
    'tests/epic-35-delivery-packet.test.mjs',
    'tests/prepare-progressive-analysis-release-readback.test.mjs',
    'tests/verify-progressive-analysis-closure.test.mjs',
    'tests/verify-progressive-analysis-exact-ci.test.mjs',
  ].sort();
  const commits = git(['rev-list', 'origin/main..HEAD']).split('\n').filter(Boolean);
  const sliceCandidates = commits.filter((commit) => {
    const names = git(['diff', '--name-only', `${commit}^`, commit]).split('\n').filter(Boolean).sort();
    return names.length === allowed.length && names.every((name, index) => name === allowed[index]);
  });
  const status = git(['status', '--porcelain', '-uall']);
  const names = [...new Set(status.split('\n').filter(Boolean).map((line) => line.slice(2).replace(/^ /, '')))].sort();
  if (names.length > 0) {
    assert.deepEqual(names, allowed, 'pending release-readback changes must be exactly the allowed paths');
  } else {
    assert.ok(sliceCandidates.length > 0, 'a committed release-readback slice commit is required');
    assert.equal(sliceCandidates[0], git(['rev-parse', 'HEAD']), 'the newest slice commit is the current head commit and touches exactly the allowed paths');
  }
});
