import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { verifyEpicClosure } from '../../scripts/release/ks73-epic-closure-verify.mjs';

// Verifies the committed KS073 distribution-epic parent closure receipt on the
// exact base: the single canonical skill source and every child slice's
// evidence are digest-anchored to the on-disk bytes, the five child slices
// carry their real terminal states, every external wait is nonterminal with
// exactly one bounded resume action, the K4e slice is serial after K4a and
// bound to the exact six External API v2 intents, and the receipt fails
// closed on any listing claim, digest drift, intent widening, or base
// substitution. No external state is claimed or mutated.

const root = path.resolve(import.meta.dirname, '..', '..');
const script = path.join(root, 'scripts', 'release', 'ks73-epic-closure-verify.mjs');
const receiptPath = path.join(root, 'docs', 'release', 'ks73-epic-closure-v1.json');
const BASE_COMMIT = 'd038aaf0595f0bef4a762ddd06d1938ccb82eda9';

function run(args) {
  return spawnSync(process.execPath, ['--jitless', script, ...args], { cwd: root, encoding: 'utf8' });
}

async function committedReceipt() {
  return JSON.parse(await readFile(receiptPath, 'utf8'));
}

function codes(verdict) {
  return verdict.violations.map((violation) => violation.code);
}

test('the committed closure receipt verifies clean and the CLI verdict is deterministic', async () => {
  const first = run(['--json']);
  const second = run(['--json']);
  assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
  assert.equal(first.stdout, second.stdout, 'CLI verdict must be byte-deterministic');
  const verdict = JSON.parse(first.stdout);
  assert.equal(verdict.schemaVersion, 'kaleidosphere/ks73-epic-closure-verdict/v1');
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.violations, []);
  const text = run([]);
  assert.equal(text.status, 0, `${text.stdout}\n${text.stderr}`);
  assert.match(text.stdout, /^ks73-epic-closure: VERIFIED\n$/);
});

test('the closure receipt binds the exact base, task and nonterminal epic state', async () => {
  const receipt = await committedReceipt();
  assert.equal(receipt.schemaVersion, 'kaleidosphere/ks73-epic-closure/v1');
  assert.equal(receipt.task.id, 'KS073-DISTRIBUTION-EPIC');
  assert.equal(receipt.task.issue, 73);
  assert.equal(receipt.baseCommit, BASE_COMMIT);
  assert.equal(receipt.terminalState, 'nonterminal-external-wait');
  assert.equal(receipt.publicListingClaim, false);
  assert.equal(receipt.singleSource.root, 'agent-skills/kaleidosphere');
});

test('the five child slices carry their real terminal states and dispositions', async () => {
  const receipt = await committedReceipt();
  assert.deepEqual(
    receipt.children.map((child) => [child.issue, child.slice, child.terminalState, child.disposition, child.publicListingClaim]),
    [
      [74, 'K4a', 'source-local-terminal', 'COMPLETE', false],
      [75, 'K4b', 'local-terminal-external-wait', 'LOCAL_COMPLETE_NOT_PUBLISHED', false],
      [76, 'K4c', 'nonterminal-external-wait', 'NOT_RELEASED', false],
      [77, 'K4d', 'nonterminal-external-wait', 'NOT_RELEASED', false],
      [78, 'K4e', 'source-local-terminal', 'COMPLETE', false],
    ],
  );
  const k4e = receipt.children.find((child) => child.issue === 78);
  assert.deepEqual(k4e.ordering, { after: 74, afterSatisfied: true });
  assert.deepEqual(k4e.intentBound, {
    externalApiV2RuntimeIntents: ['status', 'discovery', 'analyze', 'plan', 'preview', 'readback'],
    widened: false,
    runtimeDispatch: false,
  });
});

test('every external wait is nonterminal with exactly one bounded resume action', async () => {
  const receipt = await committedReceipt();
  assert.deepEqual(receipt.externalWaits.map((wait) => [wait.id, wait.child, wait.satisfied]), [
    ['clawhub-publication', 75, false],
    ['codex-portal-identity', 76, false],
    ['claude-marketplace-identity', 77, false],
  ]);
  for (const wait of receipt.externalWaits) {
    assert.equal(typeof wait.resumeAction, 'string');
    assert.ok(wait.resumeAction.length > 0, wait.id);
    const attached = receipt.children.filter((child) => child.externalWaits.includes(wait.id));
    assert.equal(attached.length, 1, wait.id);
    assert.equal(attached[0].issue, wait.child, wait.id);
  }
  // The Codex and Claude resume actions stay verbatim with the committed child
  // bounded external-wait records so the parent cannot drift from them.
  const k4c = JSON.parse(await readFile(path.join(root, 'docs', 'release', 'k4c-bounded-external-wait-v1.json'), 'utf8'));
  const k4d = JSON.parse(await readFile(path.join(root, 'docs', 'release', 'k4d-bounded-external-wait-v1.json'), 'utf8'));
  const byId = new Map(receipt.externalWaits.map((wait) => [wait.id, wait]));
  assert.equal(byId.get('codex-portal-identity').resumeAction, k4c.resumeActions[0]);
  assert.equal(byId.get('claude-marketplace-identity').resumeAction, k4d.resumeActions[0]);
  assert.equal(k4c.publicListingClaim, false);
  assert.equal(k4d.publicListingClaim, false);
});

test('the KS076 and KS077 accepted deliveries are reconciled with digest-anchored evidence', async () => {
  const receipt = await committedReceipt();
  assert.deepEqual(
    receipt.branchReconciliation.map((record) => [record.taskId, record.issue, record.integratedInBase, record.deliveryPullRequest]),
    [
      ['KS076-CODEX-DISTRIBUTION', 76, true, 163],
      ['KS077-CLAUDE-DISTRIBUTION', 77, true, 164],
    ],
  );
  for (const record of receipt.branchReconciliation) {
    assert.match(record.remoteTip, /^[a-f0-9]{40}$/);
    assert.match(record.deliveryCommit, /^[a-f0-9]{40}$/);
    assert.ok(record.integrationProof.length > 0);
  }
});

test('the closure keeps the full non-claim set', async () => {
  const receipt = await committedReceipt();
  for (const nonClaim of [
    'NO_MARKETPLACE_LISTING',
    'NO_PUBLIC_INSTALLABILITY',
    'NO_CLAWHUB_OR_CODEX_OR_CLAUDE_RUNTIME_EXECUTION',
    'NO_LIVE_CODEX_PROVIDER_RESPONSE',
    'NO_RELEASE_OR_TAG_CREATED',
    'NO_HOSTED_SERVICE_OR_MANAGED_CONNECTOR',
    'NO_PRODUCTION_READINESS',
    'NO_CREDENTIAL_OR_NETWORK_ACCESS',
    'NO_SECOND_MAINTAINED_SKILL_COPY',
  ]) {
    assert.ok(receipt.nonClaims.includes(nonClaim), nonClaim);
  }
});

test('the closure denies any public listing claim at epic or child level', async () => {
  const receipt = await committedReceipt();
  const epicClaim = JSON.parse(JSON.stringify(receipt));
  epicClaim.publicListingClaim = true;
  assert.ok(codes(await verifyEpicClosure(root, { receiptText: JSON.stringify(epicClaim) })).includes('LISTING_CLAIM_DENIED'));
  const childClaim = JSON.parse(JSON.stringify(receipt));
  childClaim.children.find((child) => child.issue === 76).publicListingClaim = true;
  assert.ok(codes(await verifyEpicClosure(root, { receiptText: JSON.stringify(childClaim) })).includes('CHILD_LISTING_CLAIM_DENIED'));
});

test('the closure denies evidence digest drift and missing evidence', async () => {
  const receipt = await committedReceipt();
  const drifted = JSON.parse(JSON.stringify(receipt));
  drifted.children.find((child) => child.issue === 76).evidence[0].sha256 = '0'.repeat(64);
  assert.ok(
    codes(await verifyEpicClosure(root, { receiptText: JSON.stringify(drifted) })).includes('CHILD_EVIDENCE_DIGEST_DRIFT'),
  );
  const driftedSkill = JSON.parse(JSON.stringify(receipt));
  driftedSkill.singleSource.files['SKILL.md'] = '1'.repeat(64);
  assert.ok(
    codes(await verifyEpicClosure(root, { receiptText: JSON.stringify(driftedSkill) })).includes('SINGLE_SOURCE_DIGEST_DRIFT'),
  );
  const missing = JSON.parse(JSON.stringify(receipt));
  missing.children.find((child) => child.issue === 75).evidence[0].path = 'docs/decisions/K4B-HERMES-CONSUMPTION-missing.md';
  assert.ok(codes(await verifyEpicClosure(root, { receiptText: JSON.stringify(missing) })).includes('CHILD_EVIDENCE_MISSING'));
});

test('the closure denies External API v2 intent widening or dispatch authority in K4e', async () => {
  const receipt = await committedReceipt();
  const widened = JSON.parse(JSON.stringify(receipt));
  widened.children.find((child) => child.issue === 78).intentBound.externalApiV2RuntimeIntents.push('dispatch');
  widened.children.find((child) => child.issue === 78).intentBound.widened = true;
  assert.ok(codes(await verifyEpicClosure(root, { receiptText: JSON.stringify(widened) })).includes('K4E_INTENT_BOUND'));
  const dispatching = JSON.parse(JSON.stringify(receipt));
  dispatching.children.find((child) => child.issue === 78).intentBound.runtimeDispatch = true;
  assert.ok(codes(await verifyEpicClosure(root, { receiptText: JSON.stringify(dispatching) })).includes('K4E_INTENT_BOUND'));
  const earlyK4e = JSON.parse(JSON.stringify(receipt));
  earlyK4e.children.find((child) => child.issue === 78).ordering.afterSatisfied = false;
  assert.ok(codes(await verifyEpicClosure(root, { receiptText: JSON.stringify(earlyK4e) })).includes('K4E_ORDERING'));
});

test('the closure denies base substitution, terminal-state upgrades and wait satisfaction', async () => {
  const receipt = await committedReceipt();
  const rebased = JSON.parse(JSON.stringify(receipt));
  rebased.baseCommit = '0'.repeat(40);
  assert.ok(codes(await verifyEpicClosure(root, { receiptText: JSON.stringify(rebased) })).includes('BASE_COMMIT_DRIFT'));
  const upgraded = JSON.parse(JSON.stringify(receipt));
  upgraded.children.find((child) => child.issue === 76).terminalState = 'released';
  assert.ok(codes(await verifyEpicClosure(root, { receiptText: JSON.stringify(upgraded) })).includes('CHILD_TERMINAL_STATE'));
  const satisfied = JSON.parse(JSON.stringify(receipt));
  satisfied.externalWaits.find((wait) => wait.id === 'codex-portal-identity').satisfied = true;
  assert.ok(codes(await verifyEpicClosure(root, { receiptText: JSON.stringify(satisfied) })).includes('WAIT_MUST_BE_NONTERMINAL'));
  const missingChild = JSON.parse(JSON.stringify(receipt));
  missingChild.children = missingChild.children.filter((child) => child.issue !== 78);
  assert.ok(codes(await verifyEpicClosure(root, { receiptText: JSON.stringify(missingChild) })).includes('CHILD_SET'));
  const unclaimedWait = JSON.parse(JSON.stringify(receipt));
  unclaimedWait.externalWaits.find((wait) => wait.id === 'clawhub-publication').resumeAction = '';
  assert.ok(codes(await verifyEpicClosure(root, { receiptText: JSON.stringify(unclaimedWait) })).includes('WAIT_RESUME_ACTION_MISSING'));
});

test('the closure denies unanchored branch integration and missing non-claims', async () => {
  const receipt = await committedReceipt();
  const notIntegrated = JSON.parse(JSON.stringify(receipt));
  notIntegrated.branchReconciliation.find((record) => record.taskId === 'KS077-CLAUDE-DISTRIBUTION').integratedInBase = false;
  assert.ok(codes(await verifyEpicClosure(root, { receiptText: JSON.stringify(notIntegrated) })).includes('RECONCILIATION_STATE'));
  const nonClaimless = JSON.parse(JSON.stringify(receipt));
  nonClaimless.nonClaims = nonClaimless.nonClaims.filter((item) => item !== 'NO_MARKETPLACE_LISTING');
  assert.ok(codes(await verifyEpicClosure(root, { receiptText: JSON.stringify(nonClaimless) })).includes('NON_CLAIM_MISSING'));
  const malformed = await verifyEpicClosure(root, { receiptText: '{not json' });
  assert.equal(malformed.ok, false);
  assert.ok(codes(malformed).includes('RECEIPT_UNREADABLE'));
});