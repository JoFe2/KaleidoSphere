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
const BASE_SHA = '173e2f7e19049a705bcdaf0269c33a5bd7f70206';
const HEAD_SHA = 'd6b9adb5be1e475cdba71c548a71fc900aa3fdff';
const RELEASE_HASH = 'b577d7742855544dcb28cee2097859bbc64759205960136e78f59b13708b9b09';
const NO_RELEASE_HASH = '066a35c6d26c90ef83172c8f2e2339ecca7206501e6daf054e7a702334ce5861';
const PACKET_PATH = 'docs/evidence/progressive-analysis/epic-35-delivery-packet.template.json';

const releaseText = await readFile(RELEASE_PATH, 'utf8');
const noReleaseText = await readFile(NO_RELEASE_PATH, 'utf8');
const releaseRecord = JSON.parse(releaseText);
const noReleaseRecord = JSON.parse(noReleaseText);
const ALLOWED_PATHS = JSON.parse(await readFile(PACKET_PATH, 'utf8')).work_receipt.changed_paths;

const childOf = (record, issue) => record.children.find((child) => child.child_issue === issue);

function mutate(record, change, rehash = true) {
  const copy = structuredClone(record);
  change(copy);
  if (rehash) copy.terminal_hash = terminalHash(copy);
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
      assert.equal(child.exact_ci.head_sha, child.merged_pr.head_sha, `child ${child.child_issue} exact-head lineage`);
      assert.equal(child.exact_ci.main_sha, child.merged_pr.merge_sha, `child ${child.child_issue} exact-main lineage`);
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
    artifact: 'KaleidoSphere-v0.25.0.tar.gz',
    tag: 'v0.25.0',
    tag_sha: '5fee1a92aefa7bdd4cc51da2c324a9cc7ca19cb6',
  });
  assert.deepEqual(first.public_readback, {
    receipt: 'github-release-v0.25.0-anonymous-readback',
    status: 'success',
    checklist: buildChecklist(releaseRecord),
  });
  assert.equal(first.public_readback.checklist.length, 55, 'five release identifiers plus ten identifiers per child');

  const expectedByChild = {
    36: ['v0.12.0', 'a65e3e7dfe4484fb50c6ad956592892b8bcb1b83', 'github-release-v0.12.0-anonymous-readback', 'a681f1868f1678c38a46fcd7ca09256edeb4445d', '41', '32270143367', '32270208181', 'child-36-deterministic-fixture-receipt', 'child-36-budget-receipt', 'child-36-fail-closed-negative-probe'],
    37: ['v0.13.0', '5c4e919b73a04a2825b5ecfb1b36167e5098296d', 'github-release-v0.13.0-anonymous-readback', '1e12007d9c2094a34abd2d97156943ab6fedb2e2', '43', '32272856706', '32272955909', 'child-37-deterministic-fixture-receipt', 'child-37-budget-receipt', 'child-37-fail-closed-negative-probe'],
    38: ['v0.14.0', '8cad5b979e65d151d583442eed4accd38c40a527', 'github-release-v0.14.0-anonymous-readback', '70eed40a59e81ef796e0bcb5a552ba64270f8d14', '45', '32279661221', '32279763731', 'child-38-deterministic-fixture-receipt', 'child-38-budget-receipt', 'child-38-fail-closed-negative-probe'],
    39: ['v0.17.0', '8e120496a8685c4abf5fb5d3a0e98adcc8fef16f', 'github-release-v0.17.0-anonymous-readback', '9cea957fb25938eda7c77b0e92df3989141571e0', '59', '32401150190', '32401255771', 'child-39-deterministic-fixture-receipt', 'child-39-budget-receipt', 'child-39-fail-closed-negative-probe'],
    40: ['v0.25.0', '5fee1a92aefa7bdd4cc51da2c324a9cc7ca19cb6', 'github-release-v0.25.0-anonymous-readback', '5fee1a92aefa7bdd4cc51da2c324a9cc7ca19cb6', '123', '33201128462', '33201173088', 'child-40-deterministic-fixture-receipt', 'child-40-budget-receipt', 'child-40-fail-closed-negative-probe'],
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
  assert.match(first.rationale_packet.rationale, /withholds a new epic release/i);
  assert.deepEqual(first.children.map((child) => child.child_issue), [36, 37, 38, 39, 40]);
  for (const issue of [36, 37, 38, 39, 40]) {
    const child = childOf(first, issue);
    assert.equal(child.disposition, 'merged');
    assert.equal(child.release_decision.decision, 'no_release');
    assert.equal(child.release_decision.tag, null);
    assert.equal(child.release_decision.tag_sha, null);
    assert.equal(child.release_decision.public_readback, null);
  }
  assert.equal(childOf(first, 40).merged_pr.number, 123);
  assert.equal(childOf(first, 40).closed_rationale, null);
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
  }, false), 'E-R08');
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
    childOf(record, 37).exact_ci.exact_head_check_id = childOf(record, 36).exact_ci.exact_head_check_id;
  }), 'E-R04');
  expectRejection('exact-head lineage drift', mutate(releaseRecord, (record) => {
    childOf(record, 36).exact_ci.head_sha = '3636'.repeat(10);
  }), 'E-R02');
  expectRejection('exact-main lineage drift', mutate(releaseRecord, (record) => {
    childOf(record, 36).exact_ci.main_sha = '3434'.repeat(10);
  }), 'E-R02');
});

test('fail-closed negatives reject scope drift from the exact current-main integration range', () => {
  expectRejection('stale head against the pinned current-main integration head', mutate(releaseRecord, (record) => {
    record.head_sha = '3540'.repeat(10);
  }), 'E-SCOPE');
  expectRejection('stale base against the pinned local-main identity', mutate(releaseRecord, (record) => {
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
  const actual = git(['diff', '--name-only', 'origin/main']).split('\n').filter(Boolean).sort();
  const expected = [...ALLOWED_PATHS, 'SOURCE-MAP.json', 'package.json'].sort();
  assert.deepEqual(actual, expected, 'the complete current-main issue diff must contain only closure and canonical registration paths');
});
