// verify-progressive-analysis-exact-ci.test.mjs
//
// Focused test for scripts/verify-progressive-analysis-exact-ci.mjs: the
// local-only, read-only deterministic validator CLI that converts an
// exact-head/exact-main CI pack-evidence fixture into a canonical pack
// receipt or a fail-closed explanation, for epic #35 (progressive-analysis)
// exact-CI pack evidence under contract epic-35-exact-ci/v1.
//
// The tests assert:
//   - the valid fixture validates OK at the file level and binds the pinned
//     stable terminal hash, with the on-disk bytes equal to the canonical
//     serialization;
//   - the mismatch fixture is rejected by the exact-CI lineage rule (E-R02)
//     while carrying a self-consistent digest: the denial is semantic, not
//     a digest failure;
//   - the receipt is byte-stable across rebuilds and carries the stable
//     hash, the exact base/head lineage, and the five exact-SHA child CI
//     entries sorted in ascending child_issue order with the per-child
//     recorded state (merge, rationale, release decision, and the
//     coverage/budget/negative receipt identifiers) intact;
//   - a protected merged child and a durable no-delivery child are both
//     represented with distinct statuses, and the no_release pairing is
//     accepted;
//   - the durable no-delivery rationale is accepted only when explicitly
//     typed and complete;
//   - every fail-closed negative category (floating ref, missing head/main
//     SHA, lineage mismatch, absent check id, failed/cancelled/timed-out
//     conclusion, missing coverage/budget/negative receipt, duplicate
//     child, colliding check ids, colliding receipt identifiers,
//     disposition pairing violations, forged digest, scope drift, unknown
//     fields, unsupported enum/const values, unsupported schema keyword)
//     rejects with its stable code;
//   - the fixed pipeline order pins which denial is reported (first
//     failure wins);
//   - the validator source performs no network access and no dispatch;
//   - the CLI exits 0 on the valid fixture with a byte-stable receipt, 1
//     on denials with the fail-closed envelope, and 2 on usage or IO
//     errors with the E-CLI envelope (in-process and as a subprocess);
//   - the slice (pre-commit: the pending working tree; post-commit: the
//     unique commit in origin/main..HEAD) changes exactly the allowed paths
//     and nothing else.
//
// Focused verification:
//   node --test tests/verify-progressive-analysis-exact-ci.test.mjs
//
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {
  buildReceipt,
  canonicalize,
  CONTRACT_SCHEMA,
  parseFlags,
  run,
  terminalHash,
  terminalHashInput,
  validateFixtureFile,
} from '../scripts/verify-progressive-analysis-exact-ci.mjs';

// ---------------------------------------------------------------------------
// Paths and pinned values
// ---------------------------------------------------------------------------

const SCRIPT = 'scripts/verify-progressive-analysis-exact-ci.mjs';
const VALID_PATH = 'fixtures/evidence/progressive-analysis/epic-35-exact-ci-valid.json';
const MISMATCH_PATH = 'fixtures/evidence/progressive-analysis/epic-35-exact-ci-mismatch.json';
const TEST_PATH = 'tests/verify-progressive-analysis-exact-ci.test.mjs';
const ALLOWED_PATHS = [
  'docs/evidence/conveyor/sol-ks-35-state-reconcile-01.json',
  'docs/evidence/conveyor/terra-ks-35-root-qs-01.json',
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

const EXPECTED_TERMINAL_HASH = '8ec63e6523b8b1c1b55ef3282f676925f303b7d385ca0932b8293fe9b8e1be6b';
const MISMATCH_TERMINAL_HASH = '976252115d823a9f9c2ac68148c3c7579c93a28df522d17d14730aa898e671c3';
const MISMATCH_CHILD_36_HEAD = '5ffad599118cade30ce66264d529259f63d1bc45';
const FIXTURE_BASE_SHA = '173e2f7e19049a705bcdaf0269c33a5bd7f70206';
const FIXTURE_HEAD_SHA = 'd6b9adb5be1e475cdba71c548a71fc900aa3fdff';

const validText = await readFile(VALID_PATH, 'utf8');
const validRecord = JSON.parse(validText);
const mismatchText = await readFile(MISMATCH_PATH, 'utf8');
const mismatchRecord = JSON.parse(mismatchText);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const childOf = (record, issue) => record.children.find((c) => c.child_issue === issue);

function mutateValid(mutate) {
  const record = structuredClone(validRecord);
  mutate(record);
  return record;
}

function setClosedNoDelivery(record, issue = 40) {
  const child = childOf(record, issue);
  child.disposition = 'closed_no_delivery';
  child.merged_pr = null;
  child.release_decision = null;
  child.closed_rationale = {
    evidence_refs: ['docs/evidence/conveyor/sol-ks-35-state-reconcile-01.json'],
    reason_code: 'durable-no-delivery',
  };
  child.exact_ci.head_sha = record.head_sha;
  child.exact_ci.main_sha = record.base_sha;
}

function expectRejection(label, record, code) {
  const result = validateFixtureFile(canonicalize(record));
  assert.equal(result.ok, false, `${label}: expected a rejection`);
  assert.equal(result.code, code, `${label}: expected ${code}, got ${result.code} (${result.detail})`);
}

// ---------------------------------------------------------------------------
// Stable terminal hash and canonical on-disk bytes
// ---------------------------------------------------------------------------

test('the valid fixture validates OK and binds the pinned stable terminal hash', () => {
  assert.deepEqual(validateFixtureFile(validText), {ok: true, code: 'OK'});
  assert.equal(validRecord.terminal_hash, EXPECTED_TERMINAL_HASH, 'the fixture declares the pinned hash');
  assert.equal(terminalHash(validRecord), EXPECTED_TERMINAL_HASH, 'recomputed hash equals the pinned hash');
  assert.equal(validText, canonicalize(validRecord) + '\n', 'on-disk bytes are the canonical serialization plus a trailing newline');
  assert.equal(terminalHashInput(structuredClone(validRecord)), terminalHashInput(validRecord), 'the terminal hash input is byte-stable across rebuilds');
});

test('the mismatch fixture is rejected by the lineage rule while its digest stays self-consistent', () => {
  const result = validateFixtureFile(mismatchText);
  assert.equal(result.ok, false, 'the mismatch fixture must be rejected');
  assert.equal(result.code, 'E-R02', 'the denial is the exact-CI lineage rule, not the digest rule');
  assert.equal(result.path, '$.children[36].exact_ci.head_sha');
  assert.equal(result.detail, `child 36 exact CI head ${MISMATCH_CHILD_36_HEAD} must equal its protected PR head ${childOf(validRecord, 36).merged_pr.head_sha}`);
  assert.equal(mismatchRecord.terminal_hash, MISMATCH_TERMINAL_HASH, 'the fixture declares the pinned mismatch hash');
  assert.equal(terminalHash(mismatchRecord), MISMATCH_TERMINAL_HASH, 'the mismatch fixture carries a self-consistent digest, so the denial is semantic, not a digest failure');
  assert.equal(mismatchText, canonicalize(mismatchRecord) + '\n', 'on-disk bytes are the canonical serialization plus a trailing newline');
});

// ---------------------------------------------------------------------------
// Receipt: byte-stability, stable hash, lineage, five sorted exact-SHA child
// CI entries with the per-child recorded state intact
// ---------------------------------------------------------------------------

test('the receipt is byte-stable and carries the stable hash, lineage, and five sorted exact-SHA child CI entries', () => {
  const receiptA = canonicalize(buildReceipt(validRecord, true));
  const receiptB = canonicalize(buildReceipt(structuredClone(validRecord), true));
  assert.equal(receiptA, receiptB, 'repeated receipt builds are byte-identical');
  const receipt = JSON.parse(receiptA);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.code, 'OK');
  assert.equal(receipt.dry_run, true);
  assert.equal(receipt.terminal_hash, EXPECTED_TERMINAL_HASH);
  assert.equal(receipt.contract_version, 'epic-35-exact-ci/v1');
  assert.equal(receipt.epic_issue, 35);
  assert.equal(receipt.base_sha, FIXTURE_BASE_SHA);
  assert.equal(receipt.head_sha, FIXTURE_HEAD_SHA);
  assert.deepEqual(receipt.nonclaims, validRecord.nonclaims);
  assert.equal(receipt.children.length, 5);
  assert.deepEqual(receipt.children.map((child) => child.child_issue), [36, 37, 38, 39, 40], 'child entries are sorted in ascending child_issue order');
  for (const child of receipt.children) {
    const original = childOf(validRecord, child.child_issue);
    assert.deepEqual(child.exact_ci, original.exact_ci, `child ${child.child_issue} exact CI entry is retained`);
    assert.deepEqual(child.merged_pr, original.merged_pr, `child ${child.child_issue} merged_pr`);
    assert.deepEqual(child.closed_rationale, original.closed_rationale, `child ${child.child_issue} closed_rationale`);
    assert.deepEqual(child.release_decision, original.release_decision, `child ${child.child_issue} release_decision`);
    assert.deepEqual(child.evidence_refs, original.evidence_refs, `child ${child.child_issue} evidence_refs`);
    assert.equal(child.exact_ci.head_sha, child.merged_pr.head_sha, `child ${child.child_issue} exact CI is bound to its protected PR head`);
    assert.equal(child.exact_ci.main_sha, child.merged_pr.merge_sha, `child ${child.child_issue} exact CI is bound to its protected merge`);
    assert.equal(child.exact_ci.coverage_receipt, `child-${child.child_issue}-deterministic-fixture-receipt`, `child ${child.child_issue} coverage receipt identifier is retained`);
    assert.equal(child.exact_ci.budget_receipt, `child-${child.child_issue}-budget-receipt`, `child ${child.child_issue} budget receipt identifier is retained`);
    assert.equal(child.exact_ci.negative_receipt, `child-${child.child_issue}-fail-closed-negative-probe`, `child ${child.child_issue} negative receipt identifier is retained`);
  }
});

// ---------------------------------------------------------------------------
// Distinct delivery states: the protected merged children and the durable
// no-delivery child
// ---------------------------------------------------------------------------

test('the live exact-state receipt represents all five protected merged children', () => {
  const receipt = buildReceipt(validRecord, true);
  assert.deepEqual([...new Set(receipt.children.map((child) => child.disposition))], ['merged']);
  for (const issue of [36, 37, 38, 39, 40]) {
    const child = childOf(receipt, issue);
    assert.equal(child.disposition, 'merged');
    assert.ok(child.merged_pr !== null, `child ${issue} carries the merged PR`);
    assert.equal(child.merged_pr.protected, true, `child ${issue} merged PR is protected`);
    assert.equal(child.closed_rationale, null, `child ${issue} carries no closed rationale`);
    assert.equal(child.release_decision.decision, 'released', `child ${issue} was released`);
    assert.ok(child.release_decision.tag !== null, `child ${issue} release carries the tag`);
    assert.ok(child.release_decision.tag_sha !== null, `child ${issue} release carries the tag SHA`);
    assert.equal(child.release_decision.public_readback, `github-release-${child.release_decision.tag}-anonymous-readback`, `child ${issue} public readback is recorded when released`);
  }
  assert.equal(childOf(receipt, 40).merged_pr.number, 123);
  assert.equal(childOf(receipt, 40).release_decision.tag, 'v0.25.0');

  const noRelease = mutateValid((r) => {
    childOf(r, 39).release_decision = {decision: 'no_release', tag: null, tag_sha: null, public_readback: null};
    r.terminal_hash = terminalHash(r);
  });
  assert.deepEqual(validateFixtureFile(canonicalize(noRelease)), {ok: true, code: 'OK'}, 'the no_release pairing (null tag, tag SHA and public readback) is accepted');
});

// ---------------------------------------------------------------------------
// The durable no-delivery rationale is accepted only when explicitly typed
// and complete
// ---------------------------------------------------------------------------

test('the durable no-delivery rationale is accepted only when explicitly typed and complete', () => {
  const closedRecord = mutateValid((record) => setClosedNoDelivery(record));
  closedRecord.terminal_hash = terminalHash(closedRecord);
  const mutateClosed = (change) => {
    const record = structuredClone(closedRecord);
    change(record);
    return record;
  };
  const rationale = childOf(closedRecord, 40).closed_rationale;
  assert.equal(typeof rationale, 'object', 'the rationale is a structured object, not prose');
  assert.ok(Array.isArray(rationale.evidence_refs) && rationale.evidence_refs.length >= 1, 'the rationale carries at least one evidence ref');
  assert.match(rationale.reason_code, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'the rationale carries a well-formed reason code');
  assert.deepEqual(validateFixtureFile(canonicalize(closedRecord)), {ok: true, code: 'OK'}, 'the typed, complete rationale is accepted as the alternative disposition');

  expectRejection('untyped prose rationale', mutateClosed((r) => {
    childOf(r, 40).closed_rationale = 'closed because the controller state receipt is nonterminal';
  }), 'E-SHAPE');
  expectRejection('rationale missing the reason code', mutateClosed((r) => {
    delete childOf(r, 40).closed_rationale.reason_code;
  }), 'E-SHAPE');
  expectRejection('rationale without evidence refs', mutateClosed((r) => {
    childOf(r, 40).closed_rationale.evidence_refs = [];
  }), 'E-SHAPE');
  expectRejection('malformed reason code', mutateClosed((r) => {
    childOf(r, 40).closed_rationale.reason_code = 'Not A Code';
  }), 'E-SHAPE');
});

// ---------------------------------------------------------------------------
// Fail-closed negatives: every named category rejects at the pinned code
// (first failure wins, so the intended failure is never masked by a stale
// terminal hash)
// ---------------------------------------------------------------------------

test('fail-closed: the child set must be exactly {36..40} once each', () => {
  expectRejection('missing child (four children)', mutateValid((r) => {
    r.children.pop();
  }), 'E-SHAPE');
  expectRejection('out-of-set child issue 41', mutateValid((r) => {
    childOf(r, 36).child_issue = 41;
  }), 'E-SHAPE');
  expectRejection('repeated child issue inside five', mutateValid((r) => {
    r.children[4] = structuredClone(childOf(r, 39));
  }), 'E-R01');
});

test('fail-closed: exact-CI lineage mismatches and scope drift are rejected', () => {
  expectRejection('child exact CI head differs from its protected PR head', mutateValid((r) => {
    childOf(r, 36).exact_ci.head_sha = MISMATCH_CHILD_36_HEAD;
  }), 'E-R02');
  expectRejection('child exact CI main differs from its protected merge', mutateValid((r) => {
    childOf(r, 37).exact_ci.main_sha = '3434'.repeat(10);
  }), 'E-R02');
  expectRejection('floating ref instead of an exact head SHA', mutateValid((r) => {
    childOf(r, 36).exact_ci.head_sha = 'main';
  }), 'E-SHAPE');
  expectRejection('missing exact CI head SHA', mutateValid((r) => {
    delete childOf(r, 36).exact_ci.head_sha;
  }), 'E-SHAPE');
  expectRejection('missing exact CI main SHA', mutateValid((r) => {
    delete childOf(r, 36).exact_ci.main_sha;
  }), 'E-SHAPE');
  expectRejection('stale base_sha', mutateValid((r) => {
    r.base_sha = '34'.repeat(20);
  }), 'E-SCOPE');
  expectRejection('stale head_sha', mutateValid((r) => {
    r.head_sha = '3539'.repeat(10);
  }), 'E-SCOPE');
});

test('fail-closed: absent or colliding check ids and non-success conclusions are rejected', () => {
  expectRejection('missing exact-head check id', mutateValid((r) => {
    delete childOf(r, 36).exact_ci.exact_head_check_id;
  }), 'E-SHAPE');
  expectRejection('zero exact-main check id', mutateValid((r) => {
    childOf(r, 36).exact_ci.exact_main_check_id = 0;
  }), 'E-SHAPE');
  expectRejection('failed exact-head conclusion', mutateValid((r) => {
    childOf(r, 36).exact_ci.exact_head_conclusion = 'failure';
  }), 'E-SHAPE');
  expectRejection('cancelled exact-main conclusion', mutateValid((r) => {
    childOf(r, 36).exact_ci.exact_main_conclusion = 'cancelled';
  }), 'E-SHAPE');
  expectRejection('timed-out exact-head conclusion', mutateValid((r) => {
    childOf(r, 36).exact_ci.exact_head_conclusion = 'timed_out';
  }), 'E-SHAPE');
  expectRejection('same check id on both runs of one child', mutateValid((r) => {
    childOf(r, 36).exact_ci.exact_main_check_id = childOf(r, 36).exact_ci.exact_head_check_id;
  }), 'E-R03');
  expectRejection('check id reused across children', mutateValid((r) => {
    childOf(r, 37).exact_ci.exact_head_check_id = 1;
  }), 'E-R04');
});

test('fail-closed: missing or colliding coverage/budget/negative receipt identifiers are rejected', () => {
  expectRejection('missing coverage receipt', mutateValid((r) => {
    delete childOf(r, 36).exact_ci.coverage_receipt;
  }), 'E-SHAPE');
  expectRejection('empty budget receipt', mutateValid((r) => {
    childOf(r, 36).exact_ci.budget_receipt = '';
  }), 'E-SHAPE');
  expectRejection('missing negative receipt', mutateValid((r) => {
    delete childOf(r, 36).exact_ci.negative_receipt;
  }), 'E-SHAPE');
  expectRejection('budget receipt equals the coverage receipt', mutateValid((r) => {
    childOf(r, 36).exact_ci.budget_receipt = childOf(r, 36).exact_ci.coverage_receipt;
  }), 'E-R05');
});

test('fail-closed: disposition pairing violations are rejected', () => {
  expectRejection('merged child without the protected merged PR', mutateValid((r) => {
    childOf(r, 36).merged_pr = null;
  }), 'E-R06');
  expectRejection('unprotected merged PR', mutateValid((r) => {
    childOf(r, 36).merged_pr.protected = false;
  }), 'E-R06');
  expectRejection('merged PR with identical head and merge SHA', mutateValid((r) => {
    const pr = childOf(r, 36).merged_pr;
    pr.merge_sha = pr.head_sha;
  }), 'E-R06');
  expectRejection('merged child carrying a closed rationale', mutateValid((r) => {
    childOf(r, 36).closed_rationale = {
      evidence_refs: ['docs/evidence/PROGRESSIVE_RUN_CONTROLLER_V1.md'],
      reason_code: 'no-delivery',
    };
  }), 'E-R06');
  expectRejection('merged child without a release decision', mutateValid((r) => {
    childOf(r, 36).release_decision = null;
  }), 'E-R06');
  expectRejection('released decision without the tag', mutateValid((r) => {
    childOf(r, 37).release_decision = {
      decision: 'released',
      tag: null,
      tag_sha: '3720'.repeat(10),
      public_readback: 'readback-v0.13.0',
    };
  }), 'E-R06');
  expectRejection('released decision without the tag SHA', mutateValid((r) => {
    childOf(r, 37).release_decision = {
      decision: 'released',
      tag: 'v0.13.0',
      tag_sha: null,
      public_readback: 'readback-v0.13.0',
    };
  }), 'E-R06');
  expectRejection('released decision without the public readback', mutateValid((r) => {
    childOf(r, 37).release_decision = {
      decision: 'released',
      tag: 'v0.13.0',
      tag_sha: '3720'.repeat(10),
      public_readback: null,
    };
  }), 'E-R06');
  expectRejection('no_release decision carrying a tag', mutateValid((r) => {
    childOf(r, 39).release_decision = {
      decision: 'no_release',
      tag: 'v0.17.0',
      tag_sha: '3920'.repeat(10),
      public_readback: 'readback-v0.17.0',
    };
  }), 'E-R06');
  expectRejection('closed-no-delivery child carrying a merged PR', mutateValid((r) => {
    const child = childOf(r, 40);
    setClosedNoDelivery(r);
    child.merged_pr = {
      base_ref: 'main',
      head_sha: '3636'.repeat(10),
      merge_sha: '3610'.repeat(10),
      number: 5,
      protected: true,
    };
    child.exact_ci.head_sha = child.merged_pr.head_sha;
    child.exact_ci.main_sha = child.merged_pr.merge_sha;
  }), 'E-R06');
  expectRejection('closed-no-delivery child without the durable rationale', mutateValid((r) => {
    setClosedNoDelivery(r);
    childOf(r, 40).closed_rationale = null;
  }), 'E-R06');
  expectRejection('closed-no-delivery child carrying a release decision', mutateValid((r) => {
    setClosedNoDelivery(r);
    childOf(r, 40).release_decision = {
      decision: 'no_release',
      tag: null,
      tag_sha: null,
      public_readback: null,
    };
  }), 'E-R06');
});

test('fail-closed: raw value, credential, and SQL material is rejected by key or by value', () => {
  expectRejection('raw value field on a child', mutateValid((r) => {
    childOf(r, 36).raw_values = ['35'.repeat(20)];
  }), 'E-CONTENT-KEY');
  expectRejection('RAW_VALUE marker in a nonclaim', mutateValid((r) => {
    r.nonclaims.push('RAW_VALUE: alice,42');
  }), 'E-CONTENT-RAW');
  expectRejection('credential-like field on a child', mutateValid((r) => {
    childOf(r, 36).api_key = 'fixture-only';
  }), 'E-CONTENT-KEY');
  expectRejection('credential-like value in a nonclaim', mutateValid((r) => {
    r.nonclaims.push('connect with password=hunter2');
  }), 'E-CONTENT-CREDENTIAL');
  expectRejection('free SQL field on a child', mutateValid((r) => {
    childOf(r, 36).free_sql = 'select 1';
  }), 'E-CONTENT-KEY');
  expectRejection('DDL statement text in a nonclaim', mutateValid((r) => {
    r.nonclaims.push('note: DROP TABLE customers');
  }), 'E-CONTENT-SQL');
  expectRejection('DML statement text in a nonclaim', mutateValid((r) => {
    r.nonclaims.push('note: DELETE FROM accounts');
  }), 'E-CONTENT-SQL');
});

test('fail-closed: unknown fields, unsupported enum values, and const drift are rejected at the shape level', () => {
  expectRejection('unknown field at child depth', mutateValid((r) => {
    childOf(r, 36).auto_merge = true;
  }), 'E-SHAPE');
  expectRejection('unknown top-level field', mutateValid((r) => {
    r.deployment_wave = 1;
  }), 'E-SHAPE');
  expectRejection('unsupported disposition value', mutateValid((r) => {
    childOf(r, 36).disposition = 'deployed';
  }), 'E-SHAPE');
  expectRejection('drifted contract version', mutateValid((r) => {
    r.contract_version = 'epic-35-exact-ci/v2';
  }), 'E-SHAPE');
  expectRejection('wrong epic issue', mutateValid((r) => {
    r.epic_issue = 36;
  }), 'E-SHAPE');
});

test('fail-closed: an unsupported schema capability is rejected before any record is evaluated', () => {
  const unsupported = structuredClone(CONTRACT_SCHEMA);
  unsupported.properties.epic_issue.default = 35;
  assert.throws(
    () => validateFixtureFile(validText, unsupported),
    /unsupported schema keyword at \$\.epic_issue: default/
  );

  const hiddenUnsupported = structuredClone(CONTRACT_SCHEMA);
  hiddenUnsupported.$defs.unused = {type: 'string', default: 'future-capability'};
  assert.throws(
    () => validateFixtureFile(validText, hiddenUnsupported),
    /unsupported schema keyword at \$\.unused: default/
  );

  const hiddenUnsupportedType = structuredClone(CONTRACT_SCHEMA);
  hiddenUnsupportedType.$defs.unused = {type: 'future-capability'};
  assert.throws(
    () => validateFixtureFile(validText, hiddenUnsupportedType),
    /unsupported schema type at \$\.unused: future-capability/
  );

  const hiddenBrokenRef = structuredClone(CONTRACT_SCHEMA);
  hiddenBrokenRef.$defs.unused = {$ref: '#/$defs/absent'};
  assert.throws(
    () => validateFixtureFile(validText, hiddenBrokenRef),
    /unresolvable \$ref: #\/\$defs\/absent/
  );
});

test('fail-closed: a forged terminal hash is rejected at R07', () => {
  expectRejection(
    'receipt digest first hex digit flipped',
    mutateValid((r) => {
      r.terminal_hash = r.terminal_hash.replace(/^./, r.terminal_hash[0] === '0' ? '1' : '0');
    }),
    'E-R07'
  );
});

// ---------------------------------------------------------------------------
// Pipeline order: first failure wins
// ---------------------------------------------------------------------------

test('first failure wins: the fixed pipeline order pins the reported denial', () => {
  expectRejection('content key probe fires before the scope policy', mutateValid((r) => {
    childOf(r, 36).raw_values = ['35'.repeat(20)];
    r.base_sha = '34'.repeat(20);
  }), 'E-CONTENT-KEY');
  expectRejection('the scope policy fires before R07', mutateValid((r) => {
    r.base_sha = '34'.repeat(20);
    r.terminal_hash = r.terminal_hash.replace(/^./, r.terminal_hash[0] === '0' ? '1' : '0');
  }), 'E-SCOPE');
  expectRejection('the shape check fires before the scope policy', mutateValid((r) => {
    childOf(r, 36).child_issue = 41;
    r.base_sha = '34'.repeat(20);
  }), 'E-SHAPE');
  expectRejection('the lineage rule R02 fires before the digest rule R07', mutateValid((r) => {
    childOf(r, 36).exact_ci.head_sha = MISMATCH_CHILD_36_HEAD;
    r.terminal_hash = r.terminal_hash.replace(/^./, r.terminal_hash[0] === '0' ? '1' : '0');
  }), 'E-R02');
});

// ---------------------------------------------------------------------------
// No network access and no dispatch in the validator source
// ---------------------------------------------------------------------------

test('the validator source performs no network access and no dispatch', async () => {
  const source = await readFile(SCRIPT, 'utf8');
  for (const token of ['node:http', 'node:https', 'node:net', 'node:dns', 'node:child_process', 'fetch(', 'WebSocket', 'XMLHttpRequest']) {
    assert.ok(!source.includes(token), `validator source must not reference ${token}`);
  }
});

// ---------------------------------------------------------------------------
// CLI flag parsing and the in-process run() envelopes
// ---------------------------------------------------------------------------

test('parseFlags accepts only the documented flags and fails closed on anything else', () => {
  assert.deepEqual(parseFlags([]), {error: 'missing required --fixture <path>'});
  assert.deepEqual(parseFlags(['--fixture']), {error: '--fixture requires a path argument'});
  assert.deepEqual(parseFlags(['--fixture=']), {error: '--fixture requires a path argument'});
  assert.deepEqual(parseFlags(['--bogus']), {error: 'unknown argument: --bogus'});
  assert.deepEqual(parseFlags(['--fixture', VALID_PATH, '--dry-run']), {fixture: VALID_PATH, dryRun: true});
  assert.deepEqual(parseFlags(['--fixture=fixtures/evidence/progressive-analysis/epic-35-exact-ci-valid.json']), {fixture: 'fixtures/evidence/progressive-analysis/epic-35-exact-ci-valid.json', dryRun: false});
});

test('run(): usage failures and unreadable fixtures exit 2 with the E-CLI envelope', async () => {
  for (const [argv, detail] of [
    [[], 'missing required --fixture <path>'],
    [['--fixture'], '--fixture requires a path argument'],
    [['--bogus'], 'unknown argument: --bogus'],
  ]) {
    const {exit, text} = await run(argv);
    assert.equal(exit, 2, `run(${JSON.stringify(argv)}) must exit 2`);
    const envelope = JSON.parse(text);
    assert.equal(envelope.code, 'E-CLI');
    assert.equal(envelope.detail, detail);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.dry_run, false);
  }
  const missing = await run(['--fixture', 'fixtures/evidence/progressive-analysis/does-not-exist.json', '--dry-run']);
  assert.equal(missing.exit, 2);
  const envelope = JSON.parse(missing.text);
  assert.equal(envelope.code, 'E-CLI');
  assert.equal(envelope.detail, 'fixture file could not be read');
  assert.equal(envelope.ok, false);
  assert.equal(envelope.dry_run, true, '--dry-run is echoed even in the IO-error envelope');
});

test('run(): the valid fixture yields exit 0 with the canonical receipt; the mismatch fixture yields exit 1 with the fail-closed envelope', async () => {
  const ok = await run(['--fixture', VALID_PATH, '--dry-run']);
  assert.equal(ok.exit, 0);
  const receipt = JSON.parse(ok.text);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.code, 'OK');
  assert.equal(receipt.dry_run, true);
  assert.equal(receipt.terminal_hash, EXPECTED_TERMINAL_HASH);
  assert.equal(ok.text, canonicalize(buildReceipt(validRecord, true)) + '\n', 'stdout is exactly one canonicalized JSON line plus a trailing newline');

  const mismatch = await run(['--fixture', MISMATCH_PATH]);
  assert.equal(mismatch.exit, 1);
  const mismatchEnvelope = JSON.parse(mismatch.text);
  assert.equal(mismatchEnvelope.ok, false);
  assert.equal(mismatchEnvelope.code, 'E-R02');
  assert.equal(mismatchEnvelope.path, '$.children[36].exact_ci.head_sha');
  assert.equal(mismatchEnvelope.detail, `child 36 exact CI head ${MISMATCH_CHILD_36_HEAD} must equal its protected PR head ${childOf(validRecord, 36).merged_pr.head_sha}`);
  assert.equal(mismatchEnvelope.terminal_hash, MISMATCH_TERMINAL_HASH, 'the envelope reports the digest the fixture itself declared');
  assert.equal(mismatchEnvelope.dry_run, false);
});

// ---------------------------------------------------------------------------
// CLI subprocess: exit codes, determinism, and envelopes
// ---------------------------------------------------------------------------

test('CLI subprocess: the valid fixture exits 0 with a byte-stable receipt across repeated runs', () => {
  const args = [SCRIPT, '--fixture', VALID_PATH, '--dry-run'];
  const first = execFileSync(process.execPath, args, {encoding: 'utf8'});
  const second = execFileSync(process.execPath, args, {encoding: 'utf8'});
  assert.equal(first, second, 'repeated subprocess runs are byte-identical');
  assert.ok(first.endsWith('\n'), 'stdout ends with a trailing newline');
  assert.equal(first.trimEnd().split('\n').length, 1, 'stdout is a single JSON line');
  const receipt = JSON.parse(first);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.code, 'OK');
  assert.equal(receipt.dry_run, true);
  assert.equal(receipt.terminal_hash, EXPECTED_TERMINAL_HASH);
  assert.deepEqual(receipt.children.map((child) => child.child_issue), [36, 37, 38, 39, 40], 'the subprocess receipt carries the five sorted child CI entries');
});

test('CLI subprocess: the mismatch fixture exits 1 with the fail-closed envelope; usage errors exit 2', () => {
  let error = null;
  try {
    execFileSync(process.execPath, [SCRIPT, '--fixture', MISMATCH_PATH, '--dry-run'], {encoding: 'utf8'});
  } catch (err) {
    error = err;
  }
  assert.ok(error, 'the mismatch fixture must be denied with a non-zero exit');
  assert.equal(error.status, 1, 'denials exit 1');
  const envelope = JSON.parse(error.stdout);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.code, 'E-R02', `expected E-R02, got ${envelope.code} (${envelope.detail})`);
  assert.equal(envelope.dry_run, true, '--dry-run is echoed in the denial envelope');

  let usageError = null;
  try {
    execFileSync(process.execPath, [SCRIPT], {encoding: 'utf8'});
  } catch (err) {
    usageError = err;
  }
  assert.ok(usageError, 'missing --fixture must fail closed');
  assert.equal(usageError.status, 2, 'usage errors exit 2');
  const usageEnvelope = JSON.parse(usageError.stdout);
  assert.equal(usageEnvelope.code, 'E-CLI');
  assert.equal(usageEnvelope.ok, false);
});

// ---------------------------------------------------------------------------
// Slice receipt: exact changed-path allowlist. Passes both pre-commit (the
// slice is the pending working tree) and post-commit (the slice is the
// unique commit in origin/main..HEAD whose diff names exactly the allowed
// paths).
// ---------------------------------------------------------------------------

test('receipt: the current-main replay changes exactly the canonical closure paths', () => {
  const git = (args) => execFileSync('git', args, {encoding: 'utf8'}).replace(/\r?\n$/, '');
  const headNow = git(['rev-parse', 'HEAD']);
  const commits = git(['rev-list', 'origin/main..HEAD']).split('\n').filter(Boolean);

  const sliceCandidates = commits.filter((commit) => {
    const names = git(['diff', '--name-only', `${commit}^`, commit]).split('\n').filter(Boolean).sort();
    return names.length === ALLOWED_PATHS.length && names.every((name, i) => name === ALLOWED_PATHS[i]);
  });

  const status = git(['status', '--porcelain', '-uall']);
  const workingNames = [...new Set(status.split('\n').filter(Boolean).map((line) => line.slice(3)))].sort();

  let sliceBase;
  let receipt;
  if (workingNames.length === 0 && sliceCandidates.length > 0) {
    // A bounded continuation may have more than one allowed-path commit in
    // origin/main..HEAD. The newest matching commit is the current slice;
    // its parent is the exact base for this receipt.
    const slice = sliceCandidates[0];
    assert.equal(slice, headNow, 'the newest allowed-path commit must be the current slice head');
    sliceBase = git(['rev-parse', `${slice}^`]);
    receipt = {
      head_commit_sha: slice,
      head_tree_sha: git(['rev-parse', `${slice}^{tree}`]),
      base_commit_sha: sliceBase,
    };
  } else if (workingNames.length > 0) {
    sliceBase = headNow;
    assert.ok(workingNames.every((name) => ALLOWED_PATHS.includes(name)), 'working tree changes must stay within the allowed paths before the slice commit');
    receipt = {
      head_commit_sha: null,
      head_tree_sha: null,
      base_commit_sha: sliceBase,
      note: 'pre-commit working tree',
    };
  } else {
    assert.fail('expected either a committed allowed-path slice or the pending allowed-path working tree');
  }

  console.log(`[epic-35-exact-ci validator receipt] base_sha=${sliceBase} head=${JSON.stringify(receipt)} changed_paths=${JSON.stringify(ALLOWED_PATHS)}`);
});