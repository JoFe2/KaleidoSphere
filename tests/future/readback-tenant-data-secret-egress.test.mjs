import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import process from 'node:process';

import {
  READBACK_CODES,
  RECEIPT_PATH,
  SOLE_MEMO_PATH,
  validateReadbackArtifacts,
} from '../../scripts/future/readback-tenant-data-secret-egress.mjs';

const FIXTURE_ROOT = 'docs/future/remote-connector/fixtures';
const COMPONENT_PATHS = {
  contract: `${FIXTURE_ROOT}/tenant-data-secret-egress-contract-v1.json`,
  'envelope-negative-cases': `${FIXTURE_ROOT}/tenant-data-secret-egress-negative-cases-v1.json`,
  isolation: `${FIXTURE_ROOT}/tenant-isolation-threat-model-v1.json`,
  retention: `${FIXTURE_ROOT}/data-classification-retention-v1.json`,
  egress: `${FIXTURE_ROOT}/egress-threat-allowlist-v1.json`,
  'secret-custody': `${FIXTURE_ROOT}/secret-custody-options-v1.json`,
  compliance: `${FIXTURE_ROOT}/compliance-assumptions-unknowns-v1.json`,
};

const loadArtifacts = async () => {
  const [receipt, entries] = await Promise.all([
    readFile(RECEIPT_PATH, 'utf8').then(JSON.parse),
    Promise.all(Object.entries(COMPONENT_PATHS).map(async ([id, file]) => [id, JSON.parse(await readFile(file, 'utf8'))])),
  ]);
  return {receipt, fixtures: Object.fromEntries(entries)};
};
const loadMemo = () => readFile(SOLE_MEMO_PATH, 'utf8');
const denialCodeOf = (run) => {
  try {
    run();
  } catch (error) {
    return error.code;
  }
  return null;
};

test('tamper-free assembled memo passes offline readback and returns every report surface', async () => {
  const [{receipt, fixtures}, memo] = await Promise.all([loadArtifacts(), loadMemo()]);
  const report = validateReadbackArtifacts({memo, receipt, fixtures});
  assert.equal(report.status, 'READBACK_PASSED');
  assert.equal(report.planningStatus, 'FUTURE_BACKLOG');
  assert.equal(report.disposition, 'NONTERMINAL');
  assert.equal(report.mode, 'offline');
  assert.equal(report.memoPath, SOLE_MEMO_PATH);
  assert.equal(report.soleMemoPath, SOLE_MEMO_PATH);
  assert.equal(report.criterionCoverage.length, 15);
  assert.equal(report.criterionCoverage.every(({covered}) => covered), true);
  assert.equal(report.componentCoverage.length, 7);
  assert.equal(report.componentCoverage.every(({covered}) => covered), true);
  assert.equal(report.hardRejects.length, 5);
  assert.equal(report.hardRejects.every(({confirmed}) => confirmed), true);
  assert.equal(report.mandatoryNegatives.length, 11);
  assert.equal(report.mandatoryNegatives.every(({confirmed}) => confirmed), true);
  assert.deepEqual(report.blockingNodes, []);
  assert.deepEqual(report.nonClaims, receipt.nonClaims);
  assert.deepEqual(report.implementationDisposition, receipt.implementationDisposition);
  assert.equal(report.implementationDisposition.disposition, 'REJECTED_WITH_EVIDENCE');
  assert.equal(report.implementationDisposition.requirementsStatus, 'FUTURE_BACKLOG');
  assert.equal(report.implementationDisposition.evidenceBindings.length, 2);
  assert.deepEqual(report.nonterminalState, {
    current: 'FUTURE_BACKLOG',
    terminal: false,
    terminalStates: ['RELEASED', 'REJECTED_WITH_EVIDENCE'],
  });
  assert.equal(report.rollback.confirmed, true);
});

test('CLI readback accepts the sole memo in offline mode', () => {
  const output = execFileSync(process.execPath, [
    'scripts/future/readback-tenant-data-secret-egress.mjs',
    '--memo',
    SOLE_MEMO_PATH,
    '--offline',
  ], {encoding: 'utf8'});
  const report = JSON.parse(output);
  assert.equal(report.status, 'READBACK_PASSED');
  assert.equal(report.planningStatus, 'FUTURE_BACKLOG');
  assert.equal(report.disposition, 'NONTERMINAL');
  assert.equal(report.mode, 'offline');
  assert.equal(report.nonterminalState.current, 'FUTURE_BACKLOG');
  assert.equal(report.nonterminalState.terminal, false);
  assert.equal(report.implementationDisposition.disposition, 'REJECTED_WITH_EVIDENCE');
  assert.equal(report.implementationDisposition.decision, 'REJECT_IMPLEMENTATION_NOW');
});

test('readback fails closed for missing fixture or memo section', async () => {
  const [{receipt, fixtures}, memo] = await Promise.all([loadArtifacts(), loadMemo()]);
  const missingFixture = {...fixtures};
  delete missingFixture.egress;
  assert.equal(
    denialCodeOf(() => validateReadbackArtifacts({memo, receipt, fixtures: missingFixture})),
    READBACK_CODES.FIXTURE_MISSING,
  );
  assert.equal(
    denialCodeOf(() => validateReadbackArtifacts({memo: memo.replace('## Tenant-isolation threat model', ''), receipt, fixtures})),
    READBACK_CODES.MEMO_SECTION,
  );
});

test('readback fails closed when a reject gate is altered', async () => {
  const [{receipt, fixtures}, memo] = await Promise.all([loadArtifacts(), loadMemo()]);
  const altered = structuredClone(fixtures);
  const negative = altered.egress.negativeCases.find(({id}) => id === 'reject-uncontrolled-egress');
  negative.expectedCode = 'KS91_EGRESS_APPROVAL_REQUIRED_DENIED';
  assert.equal(
    denialCodeOf(() => validateReadbackArtifacts({memo, receipt, fixtures: altered})),
    READBACK_CODES.REJECT_GATE,
  );
});

test('readback requires the nonterminal planning state and all no-claim markers', async () => {
  const [{receipt, fixtures}, memo] = await Promise.all([loadArtifacts(), loadMemo()]);
  assert.equal(
    denialCodeOf(() => validateReadbackArtifacts({memo: memo.replace('Status: `FUTURE_BACKLOG` / planning-only', ''), receipt, fixtures})),
    READBACK_CODES.NONTERMINAL_STATE,
  );
  assert.equal(
    denialCodeOf(() => validateReadbackArtifacts({memo: memo.replace('no completeness claims', ''), receipt, fixtures})),
    READBACK_CODES.NON_CLAIM,
  );
});

test('readback rejects credential, live-data, and network references without echoing content', async () => {
  const [{receipt, fixtures}, memo] = await Promise.all([loadArtifacts(), loadMemo()]);
  for (const [addition, code] of [
    ['credential: synthetic-placeholder', READBACK_CODES.UNSAFE_CONTENT],
    ['liveData: true', READBACK_CODES.UNSAFE_CONTENT],
    ['fetch("synthetic-placeholder")', READBACK_CODES.UNSAFE_CONTENT],
    ['This memo approves a cross-tenant data flow.', READBACK_CODES.UNSAFE_CONTENT],
    ['This memo approves an endpoint.', READBACK_CODES.UNSAFE_CONTENT],
    ['This memo approves a deployment.', READBACK_CODES.UNSAFE_CONTENT],
    ['This memo approves credential transport.', READBACK_CODES.UNSAFE_CONTENT],
    ['This memo approves live-data access.', READBACK_CODES.UNSAFE_CONTENT],
    ['This memo claims an endpoint exists.', READBACK_CODES.UNSAFE_CONTENT],
    ['This memo claims a deployment exists.', READBACK_CODES.UNSAFE_CONTENT],
    ['This memo claims a credential path exists.', READBACK_CODES.UNSAFE_CONTENT],
    ['This memo claims live-data access exists.', READBACK_CODES.UNSAFE_CONTENT],
    ['This memo claims compliance readiness.', READBACK_CODES.UNSAFE_CONTENT],
    ['This memo treats caller-authored expected values as authority.', READBACK_CODES.UNSAFE_CONTENT],
  ]) {
    assert.equal(
      denialCodeOf(() => validateReadbackArtifacts({memo: `${memo}\n${addition}`, receipt, fixtures})),
      code,
      addition,
    );
  }
});

test('readback rejects a receipt mismatch before producing a report', async () => {
  const [{receipt, fixtures}, memo] = await Promise.all([loadArtifacts(), loadMemo()]);
  const altered = structuredClone(receipt);
  altered.criteria[0].name = 'altered';
  assert.equal(
    denialCodeOf(() => validateReadbackArtifacts({memo, receipt: altered, fixtures})),
    READBACK_CODES.RECEIPT_INVALID,
  );
  const callerAuthored = structuredClone(receipt);
  callerAuthored.implementationDisposition.decisionOwner = 'caller-supplied-owner';
  assert.equal(
    denialCodeOf(() => validateReadbackArtifacts({memo, receipt: callerAuthored, fixtures})),
    READBACK_CODES.RECEIPT_INVALID,
  );
});
