import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { renderReceipt, runDecisionValidator } from '../../../scripts/dry-run-go-no-go-decision.mjs';

const root = new URL('../../../', import.meta.url).pathname;
const fixture = 'docs/future/remote-connector/fixtures/go-no-go-decision-valid.json';

function assertTerminal(receipt) {
  assert.equal(receipt.validation.status, 'REJECTED_WITH_EVIDENCE');
  assert.equal(receipt.validation.verdict, 'REJECT');
  assert.equal(receipt.disposition.eligibility, 'NOT_ELIGIBLE_FOR_DELIVERY');
  assert.equal(receipt.disposition.implementationEligible, false);
  assert.equal(receipt.disposition.deliveryEligible, false);
  assert.equal(receipt.disposition.runtimeDispatchEligible, false);
  assert.equal(receipt.disposition.implementationChildStatus, 'BLOCKED_NO_SEPARATE_DELIVERY_AUTHORIZATION');
  assert.equal(receipt.noExternalActionAttestation.networkAccessed, false);
  assert.equal(receipt.noExternalActionAttestation.mutationsPerformed, 0);
}

test('dry-run receipt is deterministic and keeps validation separate from rejection', async () => {
  const first = renderReceipt(await runDecisionValidator(fixture, { root }), 'OFFLINE_DRY_RUN');
  const second = renderReceipt(await runDecisionValidator(fixture, { root }), 'OFFLINE_DRY_RUN');
  assert.deepEqual(first, second);
  assertTerminal(first);
  assert.equal(first.validation.checks.citationVerification, 'PASS');
  assert.equal(first.validation.checks.assessmentEvaluation, 'PASS');
});

test('CLI uses active process.execPath and reads back the same terminal result', () => {
  const dry = JSON.parse(execFileSync(process.execPath, [...process.execArgv, 'scripts/dry-run-go-no-go-decision.mjs', '--input', fixture, '--offline'], { cwd: root, encoding: 'utf8' }));
  const readback = JSON.parse(execFileSync(process.execPath, [...process.execArgv, 'scripts/readback-go-no-go-decision.mjs', '--local-only'], { cwd: root, encoding: 'utf8' }));
  assertTerminal(dry);
  assertTerminal(readback);
});

test('missing input remains invalid and non-authorizing', async () => {
  const receipt = renderReceipt(await runDecisionValidator('docs/future/remote-connector/fixtures/missing.json', { root }), 'LOCAL_READBACK');
  assert.equal(receipt.validation.status, 'INVALID_PACKAGE');
  assert.equal(receipt.validation.verdict, null);
  assert.equal(receipt.disposition.implementationEligible, false);
});

test('readback documentation never calls local validation RELEASED', async () => {
  const text = await readFile(new URL('../../../docs/future/remote-connector/GO_NO_GO_DECISION_READBACK.md', import.meta.url), 'utf8');
  assert.match(text, /internal `VALIDATED` checks only/);
  assert.match(text, /do not turn the rejected implementation into a `RELEASED` capability/);
});
