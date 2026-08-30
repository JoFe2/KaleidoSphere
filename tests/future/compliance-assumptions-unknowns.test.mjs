import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const FIXTURE_PATH = 'docs/future/remote-connector/fixtures/compliance-assumptions-unknowns-v1.json';
const MEMO_PATH = 'docs/future/remote-connector/TENANT_DATA_SECRET_EGRESS.md';

const loadFixture = async () => JSON.parse(await readFile(FIXTURE_PATH, 'utf8'));
const loadMemo = () => readFile(MEMO_PATH, 'utf8');

function deny(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function denialCodeOf(run) {
  try {
    run();
  } catch (error) {
    return {code: error.code, message: error.message};
  }
  return null;
}

function validateCandidate(candidate, fixture) {
  if (candidate.dataOrigin !== 'synthetic') deny('KS91_LIVE_DATA_DENIED');
  if (candidate.claimType === 'compliance-guarantee') {
    deny('KS91_COMPLIANCE_GUARANTEE_CLAIM_DENIED');
  }
  if (candidate.claimType === 'legal-conclusion' && candidate.claimPresentation === 'fact') {
    deny('KS91_LEGAL_CONCLUSION_CLAIM_DENIED');
  }
  if (candidate.assumptionId && candidate.decisionAuthority === null) {
    deny('KS91_DECISION_AUTHORITY_MISSING_DENIED');
  }
  if (candidate.unknownId && candidate.bounded === false) {
    deny('KS91_UNKNOWN_UNBOUNDED_DENIED');
  }
  if (candidate.residencyChoice && candidate.tenantBoundary) {
    const choice = fixture.residencyChoices.find(({id}) => id === candidate.residencyChoice);
    if (!choice || !choice.permittedTenantBoundaries.includes(candidate.tenantBoundary)) {
      if (!candidate.exceptionGate?.completed) {
        deny('KS91_RESIDENCY_EXCEPTION_GATE_REQUIRED_DENIED');
      }
      deny('KS91_RESIDENCY_MISMATCH_DENIED');
    }
  }
  if (candidate.unknownId && candidate.decisionInputLinks?.length === 0) {
    deny('KS91_UNKNOWN_DECISION_INPUT_MISSING_DENIED');
  }
  return 'ACCEPTED';
}

test('register is a synthetic planning artifact with explicit deny defaults', async () => {
  const fixture = await loadFixture();
  assert.equal(fixture.schemaVersion, 'kaleidosphere.remote-connector/compliance-assumptions-unknowns/v1');
  assert.equal(fixture.registerId, 'KS91-COMPLIANCE-ASSUMPTIONS-UNKNOWNS-01');
  assert.equal(fixture.status, 'FROZEN_FUTURE_SURFACE');
  assert.equal(fixture.evidenceClass, 'synthetic-fixture-only');
  assert.equal(fixture.scope, 'planning-candidate-only');
  assert.equal(fixture.policy.default, 'DENY');
  assert.equal(fixture.policy.syntheticOnly, true);
  assert.equal(fixture.policy.complianceGuaranteeClaimsAllowed, false);
  assert.equal(fixture.policy.legalConclusionsAllowed, false);
  assert.equal(fixture.policy.externalWaitsAllowed, false);
  assert.equal(fixture.policy.productionApprovalGranted, false);
  assert.deepEqual(
    fixture.residencyChoices.map(({id}) => id),
    ['synthetic-eu-1', 'synthetic-us-1'],
  );
});

test('named gates connect residency, retention, isolation, custody, and egress', async () => {
  const fixture = await loadFixture();
  const gatesByDomain = new Map(fixture.approvalGates.map((gate) => [gate.domain, gate]));
  for (const domain of ['residency', 'retention', 'isolation', 'custody', 'egress']) {
    const gate = gatesByDomain.get(domain);
    assert.ok(gate, `${domain} gate missing`);
    assert.ok(gate.id.length > 0, domain);
    assert.ok(fixture.decisionAuthorities.includes(gate.decisionAuthority), domain);
    assert.ok(gate.requiredDecisionInputs.length > 0, domain);
    assert.ok(gate.rejectGate.startsWith('reject-'), domain);
    assert.equal(gate.approvalOutcome, 'APPROVE_CANDIDATE_ONLY', domain);
  }
  const exceptionGate = fixture.approvalGates.find(({id}) => id === 'gate-residency-exception-review');
  assert.equal(exceptionGate.approvalOutcome, 'NOT_AUTHORIZED_IN_V1');
  assert.equal(exceptionGate.rejectGate, 'reject-residency-exception');
});

test('every assumption has scope, evidence, authority, expiry/review, impact, and a named gate', async () => {
  const fixture = await loadFixture();
  assert.ok(fixture.assumptions.length >= 5);
  const gateIds = new Set(fixture.approvalGates.map(({id}) => id));
  for (const assumption of fixture.assumptions) {
    for (const field of ['scope', 'evidenceNeeded', 'decisionAuthority', 'expiryReview', 'impact', 'gate']) {
      assert.ok(field in assumption, `${assumption.id} missing ${field}`);
    }
    assert.ok(assumption.scope.length > 0, assumption.id);
    assert.ok(assumption.evidenceNeeded.length > 0, assumption.id);
    assert.equal(fixture.decisionAuthorities.includes(assumption.decisionAuthority), true, assumption.id);
    assert.ok(assumption.expiryReview.reviewOwner, assumption.id);
    assert.ok(assumption.expiryReview.reviewTrigger, assumption.id);
    assert.ok(assumption.expiryReview.expiryCondition, assumption.id);
    assert.ok(assumption.expiryReview.expiryOutcome.startsWith('REJECT'), assumption.id);
    assert.ok(assumption.impact.length > 0, assumption.id);
    assert.equal(gateIds.has(assumption.gate), true, assumption.id);
    assert.equal(assumption.status, 'UNVERIFIED_PLANNING_ASSUMPTION', assumption.id);
  }
});

test('every unknown is bounded, reviewable, fail-closed, and linked to a data/egress/secret input', async () => {
  const fixture = await loadFixture();
  const gateIds = new Set(fixture.approvalGates.map(({id}) => id));
  assert.ok(fixture.unknowns.length >= 5);
  for (const unknown of fixture.unknowns) {
    for (const field of ['scope', 'evidenceNeeded', 'decisionAuthority', 'expiryReview', 'impact', 'failClosedGate', 'decisionInputLinks']) {
      assert.ok(field in unknown, `${unknown.id} missing ${field}`);
    }
    assert.equal(unknown.bounded, true, unknown.id);
    assert.equal(unknown.status, 'OPEN_REJECT_UNTIL_DECIDED', unknown.id);
    assert.ok(unknown.scope.length > 0, unknown.id);
    assert.ok(unknown.evidenceNeeded.length > 0, unknown.id);
    assert.equal(fixture.decisionAuthorities.includes(unknown.decisionAuthority), true, unknown.id);
    assert.ok(unknown.expiryReview.reviewOwner, unknown.id);
    assert.ok(unknown.expiryReview.reviewTrigger, unknown.id);
    assert.ok(unknown.expiryReview.expiryCondition, unknown.id);
    assert.ok(['REJECT_WITH_EVIDENCE', 'REJECT_AND_DELETE', 'REJECT_AND_REAUTHORIZE'].includes(unknown.expiryReview.expiryOutcome), unknown.id);
    assert.ok(unknown.impact.length > 0, unknown.id);
    assert.equal(gateIds.has(unknown.failClosedGate.gateId), true, unknown.id);
    assert.ok(unknown.failClosedGate.rejectGate.startsWith('reject-'), unknown.id);
    assert.equal(unknown.failClosedGate.decision, 'REJECT', unknown.id);
    assert.ok(unknown.failClosedGate.missingEvidenceCode.endsWith('_DENIED'), unknown.id);
    assert.ok(unknown.decisionInputLinks.length > 0, unknown.id);
    assert.equal(
      unknown.decisionInputLinks.some(({type}) => ['data', 'egress', 'secret'].includes(type)),
      true,
      unknown.id,
    );
    for (const link of unknown.decisionInputLinks) {
      assert.equal(gateIds.has(link.gateId), true, `${unknown.id} link gate`);
      assert.ok(link.input.length > 0, unknown.id);
    }
  }
});

test('mandatory negative cases reject claims, missing authority, unbounded unknowns, residency mismatch, and legal facts', async () => {
  const fixture = await loadFixture();
  const expectedCodes = new Set();
  for (const negative of fixture.negativeCases) {
    expectedCodes.add(negative.expectedCode);
    assert.deepEqual(
      denialCodeOf(() => validateCandidate(negative.candidate, fixture)),
      {code: negative.expectedCode, message: negative.expectedCode},
      negative.id,
    );
  }
  for (const code of [
    'KS91_COMPLIANCE_GUARANTEE_CLAIM_DENIED',
    'KS91_DECISION_AUTHORITY_MISSING_DENIED',
    'KS91_UNKNOWN_UNBOUNDED_DENIED',
    'KS91_RESIDENCY_EXCEPTION_GATE_REQUIRED_DENIED',
    'KS91_LEGAL_CONCLUSION_CLAIM_DENIED',
    'KS91_UNKNOWN_DECISION_INPUT_MISSING_DENIED',
  ]) {
    assert.equal(expectedCodes.has(code), true, code);
  }
  assert.equal(fixture.policy.residencyMismatchWithoutExceptionGateAllowed, false);
  assert.equal(fixture.policy.unboundedUnknownsAllowed, false);
  assert.equal(fixture.policy.missingDecisionAuthorityAllowed, false);
});

test('hard rejects are named and documented without making legal or compliance claims', async () => {
  const [fixture, memo] = await Promise.all([loadFixture(), loadMemo()]);
  const hardRejectCodes = new Set(fixture.hardRejectConditions.map(({code}) => code));
  for (const code of [
    'KS91_COMPLIANCE_GUARANTEE_CLAIM_DENIED',
    'KS91_DECISION_AUTHORITY_MISSING_DENIED',
    'KS91_UNKNOWN_UNBOUNDED_DENIED',
    'KS91_RESIDENCY_EXCEPTION_GATE_REQUIRED_DENIED',
    'KS91_LEGAL_CONCLUSION_CLAIM_DENIED',
    'KS91_UNKNOWN_DECISION_INPUT_MISSING_DENIED',
  ]) {
    assert.equal(hardRejectCodes.has(code), true, code);
  }
  for (const marker of [
    'Compliance assumptions and unknowns register',
    'Residency choices',
    'Named approval and reject gates',
    'fail-closed',
    'compliance guarantee',
    'missing decision authority',
    'unbounded unknown',
    'residency mismatch',
    'exception gate',
    'legal conclusion',
    'data, egress, or secret',
    'All compliance unknowns are\\s+concrete future decisions rather than\\s+external waits or claims',
    'default: DENY',
    'planning-only',
  ]) {
    assert.match(memo, new RegExp(marker, 'i'), marker);
  }
  for (const gate of fixture.approvalGates) assert.equal(memo.includes(`\`${gate.id}\``), true, gate.id);
  for (const choice of fixture.residencyChoices) assert.equal(memo.includes(`\`${choice.id}\``), true, choice.id);
});
