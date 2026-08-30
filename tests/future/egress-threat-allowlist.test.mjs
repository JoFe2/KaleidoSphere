import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const FIXTURE_PATH = 'docs/future/remote-connector/fixtures/egress-threat-allowlist-v1.json';
const MEMO_PATH = 'docs/future/remote-connector/TENANT_DATA_SECRET_EGRESS.md';

const loadFixture = async () => JSON.parse(await readFile(FIXTURE_PATH, 'utf8'));
const loadMemo = async () => readFile(MEMO_PATH, 'utf8');

function deny(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function denialCodeOf(run) {
  try {
    run();
  } catch (error) {
    return error.code;
  }
  return null;
}

function validateCandidate(candidate, fixture) {
  if (candidate.dataOrigin !== 'synthetic') deny('KS91_LIVE_DATA_DENIED');
  if (candidate.unbounded === true) deny('KS91_EGRESS_UNBOUNDED_DESTINATION_DENIED');
  if (candidate.destination === '*' || candidate.destinationPattern?.includes('*')) {
    deny('KS91_EGRESS_WILDCARD_DESTINATION_DENIED');
  }
  if (candidate.uncontrolledEgress === true) deny('KS91_UNCONTROLLED_EGRESS_DENIED');
  if (candidate.networkRequest === true) deny('KS91_REAL_NETWORK_REQUEST_DENIED');
  if (candidate.dataClass === 'secret-material' && candidate.approvalGate === 'none') {
    deny('KS91_SECRET_EGRESS_GATE_REQUIRED_DENIED');
  }
  if (candidate.dataClass === 'regulated-data' && candidate.approvalGate === 'none') {
    deny('KS91_REGULATED_EGRESS_GATE_REQUIRED_DENIED');
  }
  if (candidate.tenantScope !== 'request-tenant-only') {
    deny('KS91_CROSS_TENANT_DESTINATION_DENIED');
  }
  if (candidate.approval !== 'REQUIRED_BEFORE_USE' || candidate.approvalGate === 'none') {
    deny('KS91_EGRESS_APPROVAL_REQUIRED_DENIED');
  }

  const matched = fixture.candidates.find(({destination}) => destination === candidate.destination);
  if (!matched) deny('KS91_DESTINATION_NOT_ALLOWLISTED_DENIED');
  if (matched.tenantScope !== candidate.tenantScope
      || matched.dataClass !== candidate.dataClass
      || matched.approvalGate !== candidate.approvalGate) {
    deny('KS91_EGRESS_CANDIDATE_BINDING_DENIED');
  }
  return matched;
}

test('allowlist is a synthetic, tenant-isolated planning candidate with deny default', async () => {
  const fixture = await loadFixture();
  assert.equal(fixture.schemaVersion, 'kaleidosphere.remote-connector/egress-threat-allowlist/v1');
  assert.equal(fixture.status, 'FROZEN_FUTURE_SURFACE');
  assert.equal(fixture.evidenceClass, 'synthetic-fixture-only');
  assert.equal(fixture.scope, 'planning-candidate-only');
  assert.equal(fixture.policy.default, 'DENY');
  assert.equal(fixture.policy.syntheticOnly, true);
  assert.equal(fixture.policy.tenantIsolationRequired, true);
  assert.equal(fixture.policy.configuredNetworkControl, false);
  assert.equal(fixture.policy.realNetworkRequestsAllowed, false);
  assert.equal(fixture.policy.wildcardDestinationAllowed, false);
  assert.equal(fixture.policy.unboundedDestinationAllowed, false);
  assert.equal(fixture.policy.unapprovedDestinationAllowed, false);
  assert.equal(fixture.policy.secretEgressWithoutGateAllowed, false);
  assert.equal(fixture.policy.regulatedDataEgressWithoutGateAllowed, false);
});

test('every candidate destination has the required decision fields and remains local-only', async () => {
  const fixture = await loadFixture();
  assert.equal(fixture.candidates.length, 4);
  const requiredFields = [
    'destination',
    'purpose',
    'tenantScope',
    'dataClass',
    'approval',
    'approvalGate',
    'denyDefault',
  ];

  for (const candidate of fixture.candidates) {
    for (const field of requiredFields) assert.ok(field in candidate, `${candidate.id} missing ${field}`);
    assert.equal(candidate.destinationKind, 'local-logical-destination', candidate.id);
    assert.equal(candidate.tenantScope, 'request-tenant-only', candidate.id);
    assert.equal(candidate.approval, 'REQUIRED_BEFORE_USE', candidate.id);
    assert.notEqual(candidate.approvalGate, 'none', candidate.id);
    assert.equal(candidate.decision, 'ALLOW_CANDIDATE_ONLY', candidate.id);
    assert.equal(candidate.denyDefault, 'DENY', candidate.id);
    assert.ok(candidate.purpose.length > 0, candidate.id);
    assert.ok(candidate.dataClass.startsWith('synthetic-'), candidate.id);
    assert.equal(
      validateCandidate({...candidate, dataOrigin: 'synthetic'} , fixture),
      candidate,
      candidate.id,
    );
  }
});

test('mandatory egress threats fail closed with stable denial codes', async () => {
  const fixture = await loadFixture();
  const expectedCodes = new Set();
  for (const negative of fixture.negativeCases) {
    expectedCodes.add(negative.expectedCode);
    assert.equal(
      denialCodeOf(() => validateCandidate(negative.candidate, fixture)),
      negative.expectedCode,
      negative.id,
    );
  }

  for (const code of [
    'KS91_EGRESS_WILDCARD_DESTINATION_DENIED',
    'KS91_EGRESS_UNBOUNDED_DESTINATION_DENIED',
    'KS91_EGRESS_APPROVAL_REQUIRED_DENIED',
    'KS91_SECRET_EGRESS_GATE_REQUIRED_DENIED',
    'KS91_REGULATED_EGRESS_GATE_REQUIRED_DENIED',
    'KS91_UNCONTROLLED_EGRESS_DENIED',
    'KS91_REAL_NETWORK_REQUEST_DENIED',
  ]) {
    assert.equal(expectedCodes.has(code), true, code);
  }
  assert.equal(fixture.policy.default, 'DENY');
});

test('hard reject conditions are represented in the fixture and memo', async () => {
  const fixture = await loadFixture();
  const memo = await loadMemo();
  assert.equal(fixture.hardRejectConditions.length, 9);
  const codes = new Set(fixture.hardRejectConditions.map(({code}) => code));
  for (const code of [
    'KS91_EGRESS_WILDCARD_DESTINATION_DENIED',
    'KS91_EGRESS_UNBOUNDED_DESTINATION_DENIED',
    'KS91_EGRESS_APPROVAL_REQUIRED_DENIED',
    'KS91_SECRET_EGRESS_GATE_REQUIRED_DENIED',
    'KS91_REGULATED_EGRESS_GATE_REQUIRED_DENIED',
    'KS91_UNCONTROLLED_EGRESS_DENIED',
    'KS91_REAL_NETWORK_REQUEST_DENIED',
  ]) {
    assert.equal(codes.has(code), true, code);
  }
  for (const marker of [
    'Candidate egress allowlist decision matrix',
    'planning candidate',
    'configured network control',
    'tenant-scoped destinations',
    'uncontrolled egress',
    'wildcard',
    'unbounded',
    'unapproved destination',
    'secret',
    'regulated data',
    'real network request',
    'default: DENY',
  ]) {
    assert.match(memo, new RegExp(marker, 'i'), marker);
  }
});
