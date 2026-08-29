// verify-progressive-analysis-closure.test.mjs
//
// Focused test for scripts/verify-progressive-analysis-closure.mjs: the
// local-only, read-only deterministic validator CLI that converts child
// evidence inputs into a canonical closure receipt or a fail-closed
// explanation, for epic #35 (progressive-analysis) closure evidence under
// contract epic-35-closure/v1.
//
// The tests assert:
//   - the valid fixture validates OK at the file level and binds the pinned
//     stable terminal hash, with the on-disk bytes equal to the canonical
//     serialization;
//   - the receipt is byte-stable across rebuilds and carries the stable
//     hash, the exact base/head lineage, and five child summaries sorted in
//     ascending child_issue order with the per-child recorded state intact;
//   - the durable no-delivery rationale is accepted only when explicitly
//     typed and complete;
//   - every fail-closed negative category (forged or stale receipt, unknown
//     child, missing merge/rationale, missing CI, released-without-readback,
//     scope drift, unsupported capability, missing #40 foundation,
//     timeout/cancel status, raw values, credentials, SQL/DDL/DML, parity
//     bypass, invalid dependency order) rejects with its stable code;
//   - the fixed pipeline order pins which denial is reported (first failure
//     wins);
//   - the validator source performs no network access and no dispatch;
//   - the CLI exits 0 on the valid fixture with a byte-stable receipt, 1 on
//     denials with the fail-closed envelope, and 2 on usage or IO errors
//     with the E-CLI envelope (in-process and as a subprocess);
//   - the slice (pre-commit: the pending working tree; post-commit: the
//     unique commit in origin/main..HEAD) changes exactly the allowed paths
//     and nothing else.
//
// Focused verification:
//   node --test tests/verify-progressive-analysis-closure.test.mjs
//
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {
  buildReceipt,
  canonicalize,
  parseFlags,
  run,
  terminalHash,
  terminalHashInput,
  validateFixtureFile,
} from '../scripts/verify-progressive-analysis-closure.mjs';

// ---------------------------------------------------------------------------
// Paths and pinned values
// ---------------------------------------------------------------------------

const SCRIPT = 'scripts/verify-progressive-analysis-closure.mjs';
const SCHEMA_PATH = 'docs/evidence/progressive-analysis/epic-35-closure.schema.json';
const VALID_PATH = 'fixtures/evidence/progressive-analysis/epic-35-closure-valid.json';
const MISSING_PATH = 'fixtures/evidence/progressive-analysis/epic-35-closure-missing-foundation.json';
const FORGED_PATH = 'fixtures/evidence/progressive-analysis/epic-35-closure-forged-receipt.json';
const TEST_PATH = 'tests/verify-progressive-analysis-closure.test.mjs';
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

const EXPECTED_TERMINAL_HASH = 'bf303ff740bc91f8d05603db2556a60eb83c3d76371b6bade1018787eca28724';
const MISSING_FOUNDATION_HASH = 'f5b5e745e3daa3bd79dfaf3086e1c6084841a0427c66b03a45f7221d73f7b321';
const FORGED_RECEIPT_HASH = '0f303ff740bc91f8d05603db2556a60eb83c3d76371b6bade1018787eca28724';
const FIXTURE_BASE_SHA = '173e2f7e19049a705bcdaf0269c33a5bd7f70206';
const FIXTURE_HEAD_SHA = 'd6b9adb5be1e475cdba71c548a71fc900aa3fdff';

const schema = JSON.parse(await readFile(SCHEMA_PATH, 'utf8'));
const validText = await readFile(VALID_PATH, 'utf8');
const validRecord = JSON.parse(validText);

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
  child.ci_decision = null;
  child.release_decision = null;
  child.closed_rationale = {
    evidence_refs: ['docs/evidence/conveyor/sol-ks-35-state-reconcile-01.json'],
    reason_code: 'durable-no-delivery',
  };
}

function expectRejection(label, record, code) {
  const result = validateFixtureFile(canonicalize(record), schema);
  assert.equal(result.ok, false, `${label}: expected a rejection`);
  assert.equal(result.code, code, `${label}: expected ${code}, got ${result.code} (${result.detail})`);
}

// ---------------------------------------------------------------------------
// Stable terminal hash and canonical on-disk bytes
// ---------------------------------------------------------------------------

test('the valid fixture validates OK and binds the pinned stable terminal hash', () => {
  assert.deepEqual(validateFixtureFile(validText, schema), {ok: true, code: 'OK'});
  assert.equal(validRecord.terminal_hash, EXPECTED_TERMINAL_HASH, 'the fixture declares the pinned hash');
  assert.equal(terminalHash(validRecord), EXPECTED_TERMINAL_HASH, 'recomputed hash equals the pinned hash');
  assert.equal(validText, canonicalize(validRecord) + '\n', 'on-disk bytes are the canonical serialization plus a trailing newline');
  assert.equal(terminalHashInput(structuredClone(validRecord)), terminalHashInput(validRecord), 'the terminal hash input is byte-stable across rebuilds');
});

// ---------------------------------------------------------------------------
// Receipt: byte-stability, stable hash, lineage, five sorted child summaries
// ---------------------------------------------------------------------------

test('the receipt is byte-stable and carries the stable hash, lineage, and five sorted child summaries', () => {
  const receiptA = canonicalize(buildReceipt(validRecord, true));
  const receiptB = canonicalize(buildReceipt(structuredClone(validRecord), true));
  assert.equal(receiptA, receiptB, 'repeated receipt builds are byte-identical');
  const receipt = JSON.parse(receiptA);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.code, 'OK');
  assert.equal(receipt.dry_run, true);
  assert.equal(receipt.terminal_hash, EXPECTED_TERMINAL_HASH);
  assert.equal(receipt.contract_version, 'epic-35-closure/v1');
  assert.equal(receipt.epic_issue, 35);
  assert.equal(receipt.base_sha, FIXTURE_BASE_SHA);
  assert.equal(receipt.head_sha, FIXTURE_HEAD_SHA);
  assert.deepEqual(receipt.critical_path, [36, 37, 38, 39, 40]);
  assert.deepEqual(receipt.nonclaims, validRecord.nonclaims);
  assert.deepEqual(receipt.child_40_foundation, validRecord.child_40_foundation);
  assert.equal(receipt.children.length, 5);
  assert.deepEqual(receipt.children.map((child) => child.child_issue), [36, 37, 38, 39, 40], 'child summaries are sorted in ascending child_issue order');
  for (const child of receipt.children) {
    const original = childOf(validRecord, child.child_issue);
    assert.equal(child.disposition, original.disposition, `child ${child.child_issue} disposition`);
    assert.deepEqual(child.depends_on, original.depends_on, `child ${child.child_issue} depends_on`);
    assert.deepEqual(child.merged_pr, original.merged_pr, `child ${child.child_issue} merged_pr`);
    assert.deepEqual(child.ci_decision, original.ci_decision, `child ${child.child_issue} ci_decision`);
    assert.deepEqual(child.release_decision, original.release_decision, `child ${child.child_issue} release_decision`);
    assert.deepEqual(child.closed_rationale, original.closed_rationale, `child ${child.child_issue} closed_rationale`);
    assert.deepEqual(child.evidence_refs, original.evidence_refs, `child ${child.child_issue} evidence_refs`);
  }
});

// ---------------------------------------------------------------------------
// The durable no-delivery rationale is accepted only when explicitly typed
// and complete
// ---------------------------------------------------------------------------

test('the durable no-delivery alternative is accepted only when explicitly typed and complete', () => {
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
  assert.deepEqual(validateFixtureFile(canonicalize(closedRecord), schema), {ok: true, code: 'OK'}, 'the typed, complete rationale is accepted as an alternative disposition');

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
  expectRejection('merged child carrying a closed rationale', mutateValid((r) => {
    childOf(r, 36).closed_rationale = {
      evidence_refs: ['docs/evidence/PROGRESSIVE_RUN_CONTROLLER_V1.md'],
      reason_code: 'no-delivery',
    };
  }), 'E-R04');
  expectRejection('closed child carrying a merged PR', mutateClosed((r) => {
    childOf(r, 40).merged_pr = {
      base_ref: 'main',
      head_sha: '3636'.repeat(10),
      merge_sha: '3610'.repeat(10),
      number: 5,
      protected: true,
    };
  }), 'E-R04');
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

test('fail-closed: invalid dependency order is rejected', () => {
  expectRejection('wrong dependency edge on child 38', mutateValid((r) => {
    childOf(r, 38).depends_on = [37];
  }), 'E-R02');
  expectRejection('reordered critical path', mutateValid((r) => {
    r.critical_path = [40, 39, 38, 37, 36];
  }), 'E-R02');
});

test('fail-closed: parity depth bypassing the controller breadth gate rejects', () => {
  expectRejection(
    'merged depth children on top of a non-merged breadth gate',
    mutateValid((r) => {
      const c36 = childOf(r, 36);
      c36.disposition = 'closed_no_delivery';
      c36.merged_pr = null;
      c36.ci_decision = null;
      c36.release_decision = null;
      c36.closed_rationale = {
        evidence_refs: ['docs/evidence/PROGRESSIVE_RUN_CONTROLLER_V1.md'],
        reason_code: 'no-delivery',
      };
    }),
    'E-R03'
  );
});

test('fail-closed: missing merge or rationale is rejected', () => {
  expectRejection('merged child without the protected merged PR', mutateValid((r) => {
    childOf(r, 36).merged_pr = null;
  }), 'E-R04');
  expectRejection('closed child without the durable rationale', mutateValid((r) => {
    setClosedNoDelivery(r);
    childOf(r, 40).closed_rationale = null;
  }), 'E-R04');
  expectRejection('merged PR with identical head and merge SHA', mutateValid((r) => {
    const pr = childOf(r, 36).merged_pr;
    pr.merge_sha = pr.head_sha;
  }), 'E-R04');
});

test('fail-closed: missing CI, missing release decision, and released-without-readback are rejected', () => {
  expectRejection('merged child with null CI decision', mutateValid((r) => {
    childOf(r, 36).ci_decision = null;
  }), 'E-R05');
  expectRejection('merged child with null release decision', mutateValid((r) => {
    childOf(r, 36).release_decision = null;
  }), 'E-R05');
  expectRejection('released decision without the tag SHA readback', mutateValid((r) => {
    childOf(r, 36).release_decision.tag_sha = null;
  }), 'E-R05');
  expectRejection('no_release decision carrying a tag', mutateValid((r) => {
    childOf(r, 39).release_decision = {
      decision: 'no_release',
      tag: 'v0.17.0',
      tag_sha: '3920392039203920392039203920392039203920',
    };
  }), 'E-R05');
  expectRejection('closed child carrying a CI decision', mutateValid((r) => {
    setClosedNoDelivery(r);
    childOf(r, 40).ci_decision = {
      exact_head_conclusion: 'success',
      exact_head_run_id: 9,
      exact_main_conclusion: 'success',
      exact_main_run_id: 10,
    };
  }), 'E-R05');
});

test('fail-closed: missing #40 foundation is rejected', () => {
  expectRejection('foundation block absent', mutateValid((r) => {
    delete r.child_40_foundation;
  }), 'E-SHAPE');
  expectRejection('breadth gate property absent', mutateValid((r) => {
    delete r.child_40_foundation.breadth_gate;
  }), 'E-SHAPE');
  expectRejection('breadth gate not gated by child 36', mutateValid((r) => {
    r.child_40_foundation.breadth_gate.gated_by_child = 37;
  }), 'E-SHAPE');
  expectRejection('receipt foundation gated by the wrong children', mutateValid((r) => {
    r.child_40_foundation.receipt_foundation.gated_by_children = [37, 38];
  }), 'E-R06');
});

test('fail-closed: timeout or cancelled CI conclusions are rejected', () => {
  expectRejection('timeout conclusion on the exact-head CI', mutateValid((r) => {
    childOf(r, 36).ci_decision.exact_head_conclusion = 'timeout';
  }), 'E-SHAPE');
  expectRejection('cancelled conclusion on the exact-main CI', mutateValid((r) => {
    childOf(r, 36).ci_decision.exact_main_conclusion = 'cancelled';
  }), 'E-SHAPE');
});

test('fail-closed: stale scope (scope drift) is rejected against the pinned placeholders', () => {
  expectRejection('stale base_sha', mutateValid((r) => {
    r.base_sha = '34'.repeat(20);
  }), 'E-SCOPE');
  expectRejection('stale head_sha', mutateValid((r) => {
    r.head_sha = '3539'.repeat(10);
  }), 'E-SCOPE');
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

test('fail-closed: unknown fields and unsupported enum values are rejected at the shape level', () => {
  expectRejection('unknown field at child depth', mutateValid((r) => {
    childOf(r, 36).auto_merge = true;
  }), 'E-SHAPE');
  expectRejection('unknown top-level field', mutateValid((r) => {
    r.deployment_wave = 1;
  }), 'E-SHAPE');
  expectRejection('unsupported disposition value', mutateValid((r) => {
    childOf(r, 36).disposition = 'deployed';
  }), 'E-SHAPE');
  expectRejection('unsupported capability value', mutateValid((r) => {
    childOf(r, 40).capability = 'adaptive-drilldown';
  }), 'E-SHAPE');
});

test('fail-closed: an unsupported schema capability is rejected before any record is evaluated', () => {
  const unsupported = structuredClone(schema);
  unsupported.properties.epic_issue.default = 35;
  assert.throws(
    () => validateFixtureFile(validText, unsupported),
    /unsupported schema keyword at \$\.epic_issue: default/
  );

  const hiddenUnsupported = structuredClone(schema);
  hiddenUnsupported.$defs.unused = {type: 'string', default: 'future-capability'};
  assert.throws(
    () => validateFixtureFile(validText, hiddenUnsupported),
    /unsupported schema keyword at \$\.unused: default/
  );

  const hiddenUnsupportedType = structuredClone(schema);
  hiddenUnsupportedType.$defs.unused = {type: 'future-capability'};
  assert.throws(
    () => validateFixtureFile(validText, hiddenUnsupportedType),
    /unsupported schema type at \$\.unused: future-capability/
  );

  const hiddenBrokenRef = structuredClone(schema);
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
  assert.deepEqual(parseFlags(['--fixture=fixtures/evidence/progressive-analysis/epic-35-closure-valid.json']), {fixture: 'fixtures/evidence/progressive-analysis/epic-35-closure-valid.json', dryRun: false});
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
  assert.equal(envelope.dry_run, true, '--dry-run is echoed even in the usage-error envelope');
});

test('run(): the valid fixture yields exit 0 with the canonical receipt; denials yield exit 1 with the fail-closed envelope', async () => {
  const ok = await run(['--fixture', VALID_PATH, '--dry-run']);
  assert.equal(ok.exit, 0);
  const receipt = JSON.parse(ok.text);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.code, 'OK');
  assert.equal(receipt.dry_run, true);
  assert.equal(receipt.terminal_hash, EXPECTED_TERMINAL_HASH);
  assert.equal(ok.text, canonicalize(buildReceipt(validRecord, true)) + '\n', 'stdout is exactly one canonicalized JSON line plus a trailing newline');

  const forged = await run(['--fixture', FORGED_PATH]);
  assert.equal(forged.exit, 1);
  const forgedEnvelope = JSON.parse(forged.text);
  assert.equal(forgedEnvelope.ok, false);
  assert.equal(forgedEnvelope.code, 'E-R07');
  assert.equal(forgedEnvelope.path, '$.terminal_hash');
  assert.equal(forgedEnvelope.detail, 'terminal_hash does not bind the canonical serialization of the record with terminal_hash removed');
  assert.equal(forgedEnvelope.terminal_hash, FORGED_RECEIPT_HASH, 'the envelope reports the digest the fixture itself declared');
  assert.equal(forgedEnvelope.dry_run, false);

  const missing = await run(['--fixture', MISSING_PATH]);
  assert.equal(missing.exit, 1);
  const missingEnvelope = JSON.parse(missing.text);
  assert.equal(missingEnvelope.ok, false);
  assert.equal(missingEnvelope.code, 'E-SHAPE');
  assert.equal(missingEnvelope.path, '$');
  assert.equal(missingEnvelope.detail, 'missing required property "child_40_foundation"');
  assert.equal(missingEnvelope.terminal_hash, MISSING_FOUNDATION_HASH);
  assert.equal(missingEnvelope.dry_run, false);
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
  assert.deepEqual(receipt.children.map((child) => child.child_issue), [36, 37, 38, 39, 40], 'the subprocess receipt carries the five sorted child summaries');
});

test('CLI subprocess: denials exit 1 with the fail-closed envelope; usage errors exit 2', () => {
  for (const [fixturePath, code] of [[MISSING_PATH, 'E-SHAPE'], [FORGED_PATH, 'E-R07']]) {
    let error = null;
    try {
      execFileSync(process.execPath, [SCRIPT, '--fixture', fixturePath, '--dry-run'], {encoding: 'utf8'});
    } catch (err) {
      error = err;
    }
    assert.ok(error, `${fixturePath}: the CLI must deny with a non-zero exit`);
    assert.equal(error.status, 1, `${fixturePath}: denials exit 1`);
    const envelope = JSON.parse(error.stdout);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.code, code, `${fixturePath}: expected ${code}, got ${envelope.code} (${envelope.detail})`);
    assert.equal(envelope.dry_run, true, '--dry-run is echoed in the denial envelope');
  }
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
  const git = (args) => execFileSync('git', args, {encoding: 'utf8'}).trim();
  const actual = git(['diff', '--name-only', 'd77ed33d062268a8000ff9b0ef5ca9dc9ad3433b']).split('\n').filter(Boolean).sort();
  const expected = [...ALLOWED_PATHS, 'SOURCE-MAP.json', 'package.json', 'closure-audits/CLOSURE-KS35-ROOT-DELIVERY-01/exact-head-local-gate-receipt.json'].sort();
  assert.deepEqual(actual, expected, 'the complete current-main issue diff must contain only closure and canonical registration paths');
});
