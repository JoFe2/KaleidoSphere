import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const FIXTURE_PATH = 'docs/future/remote-connector/fixtures/secret-custody-options-v1.json';
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
    return {code: error.code, message: error.message};
  }
  return null;
}

function containsLiteralSecret(value) {
  return typeof value === 'string' && (
    /(?:credential|password|api[_-]?key)\s*[:=]/i.test(value)
    || /^Bearer\s+/i.test(value)
    || /BEGIN\s+[A-Z ]+KEY/i.test(value)
  );
}

function validateCandidate(candidate, fixture) {
  if (candidate.dataOrigin !== 'synthetic') deny('KS91_LIVE_OR_AMBIGUOUS_INPUT_DENIED');
  if (containsLiteralSecret(candidate.secretValue)) deny('KS91_SECRET_LITERAL_DENIED');
  if (candidate.exposure?.containsSecret === true
      && ['logs', 'test-output', 'artifacts', 'fixtures', 'telemetry', 'review-evidence']
        .includes(candidate.exposure.surface)) {
    deny('KS91_SECRET_LOG_ARTIFACT_DENIED');
  }
  if (candidate.custodyMode === 'plaintext'
      || candidate.hypotheticalAccess?.mode === 'plaintext-value') {
    deny('KS91_PLAINTEXT_CUSTODY_DENIED');
  }
  if (candidate.customerCredentialCapture === true
      || candidate.hypotheticalAccess?.customerCredentialCapture === true) {
    deny('KS91_CUSTOMER_CREDENTIAL_CAPTURE_DENIED');
  }
  if (!candidate.approvalGate
      || candidate.approvalGate.status !== 'APPROVED_FOR_SYNTHETIC_REVIEW') {
    deny('KS91_APPROVAL_GATE_REQUIRED_DENIED');
  }

  const matched = fixture.options.find(({id}) => id === candidate.optionId || id === candidate.id);
  if (!matched) deny('KS91_LIVE_OR_AMBIGUOUS_INPUT_DENIED');
  if (matched.decision !== 'APPROVE_CANDIDATE_ONLY') {
    deny('KS91_PLAINTEXT_CUSTODY_DENIED');
  }
  return matched;
}

function materializeNegativeCandidate(negative) {
  const candidate = {...negative.candidate};
  if (candidate.literalKind === 'credential') {
    candidate.secretValue = ['credential', ': synthetic-placeholder'].join('');
  }
  if (candidate.literalKind === 'token') {
    candidate.secretValue = ['Bearer', ' synthetic-placeholder'].join('');
  }
  if (candidate.literalKind === 'private-key') {
    candidate.secretValue = [
      '-----BEGIN ',
      'PRIVATE KEY-----',
      '\nsynthetic-placeholder\n',
      '-----END ',
      'PRIVATE KEY-----',
    ].join('');
  }
  if (candidate.exposureSurface) {
    candidate.exposure = {surface: candidate.exposureSurface, containsSecret: true};
  }
  return candidate;
}

test('secret-custody options compare synthetic boundaries with explicit approval gates', async () => {
  const fixture = await loadFixture();
  assert.equal(fixture.schemaVersion, 'kaleidosphere.remote-connector/secret-custody-options/v1');
  assert.equal(fixture.status, 'FROZEN_FUTURE_SURFACE');
  assert.equal(fixture.evidenceClass, 'synthetic-fixture-only');
  assert.equal(fixture.scope, 'planning-candidate-only');
  assert.equal(fixture.policy.default, 'DENY');
  assert.equal(fixture.policy.syntheticOnly, true);
  assert.equal(fixture.policy.customerCredentialCaptureAllowed, false);
  assert.equal(fixture.policy.plaintextCustodyAllowed, false);
  assert.equal(fixture.policy.secretValuesInLogsAllowed, false);
  assert.equal(fixture.policy.secretValuesInArtifactsAllowed, false);

  assert.equal(fixture.options.length, 4);
  const approved = fixture.options.filter(({decision}) => decision === 'APPROVE_CANDIDATE_ONLY');
  assert.equal(approved.length, 3);
  for (const option of fixture.options) {
    for (const field of [
      'custodyBoundary',
      'hypotheticalAccess',
      'rotationRevocation',
      'auditRequirements',
      'approver',
      'rejectionTrigger',
      'approvalGate',
      'decision',
    ]) {
      assert.ok(field in option, `${option.id} missing ${field}`);
    }
    assert.equal(option.hypotheticalAccess.secretValueVisibleToConsumer, option.decision === 'REJECT_HARD');
    assert.equal(option.hypotheticalAccess.customerCredentialCapture, false);
    assert.equal(option.rotationRevocation.staleReferenceOutcome.startsWith('REJECT'), true, option.id);
    assert.equal(option.auditRequirements.secretValueRecorded, false, option.id);
    assert.ok(option.auditRequirements.requiredEvents.length > 0 || option.decision === 'REJECT_HARD');
    assert.ok(option.approver.startsWith('synthetic-'), option.id);
    assert.ok(option.rejectionTrigger.startsWith('reject'), option.id);
  }
  for (const option of approved) {
    assert.equal(option.approvalGate.status, 'APPROVED_FOR_SYNTHETIC_REVIEW', option.id);
    assert.ok(option.approvalGate.requiredChecks.length >= 5, option.id);
    assert.equal(
      validateCandidate({...option, dataOrigin: 'synthetic'}, fixture),
      option,
      option.id,
    );
  }
  assert.equal(fixture.options.find(({id}) => id === 'plaintext-runtime-custody').decision, 'REJECT_HARD');
});

test('fixture uses references and explicitly excludes secret values from logs and artifacts', async () => {
  const fixture = await loadFixture();
  const serialized = JSON.stringify(fixture);
  assert.equal(fixture.logArtifactExclusionRule.excludedSurfaces.includes('logs'), true);
  assert.equal(fixture.logArtifactExclusionRule.excludedSurfaces.includes('artifacts'), true);
  assert.equal(fixture.logArtifactExclusionRule.redactionFailureOutcome, 'REJECTED_WITH_EVIDENCE');
  assert.equal(fixture.options.every(({auditRequirements}) => auditRequirements.secretValueRecorded === false), true);
  assert.equal(Object.prototype.hasOwnProperty.call(fixture, 'secretValue'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(fixture, 'credentialValue'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(fixture, 'privateKey'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(fixture, 'logMessage'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(fixture, 'artifactContent'), false);
  assert.doesNotMatch(serialized, /-----BEGIN\s+PRIVATE KEY-----/i);
  assert.doesNotMatch(serialized, /(?:credential|password|api[_-]?key)\s*[:=]\s*[^"\s]+/i);
});

test('mandatory fail-closed secret-custody negatives return stable denial codes without echoing input', async () => {
  const fixture = await loadFixture();
  const expectedCodes = new Set();
  for (const negative of fixture.negativeCases) {
    expectedCodes.add(negative.expectedCode);
    const denial = denialCodeOf(() => validateCandidate(materializeNegativeCandidate(negative), fixture));
    assert.deepEqual(denial, {
      code: negative.expectedCode,
      message: negative.expectedCode,
    }, negative.id);
  }

  for (const code of [
    'KS91_SECRET_LITERAL_DENIED',
    'KS91_SECRET_LOG_ARTIFACT_DENIED',
    'KS91_PLAINTEXT_CUSTODY_DENIED',
    'KS91_APPROVAL_GATE_REQUIRED_DENIED',
    'KS91_CUSTOMER_CREDENTIAL_CAPTURE_DENIED',
  ]) {
    assert.equal(expectedCodes.has(code), true, code);
  }
  assert.equal(fixture.policy.default, 'DENY');
});

test('hard reject conditions and gate language are documented without authorizing custody', async () => {
  const fixture = await loadFixture();
  const memo = await loadMemo();
  assert.equal(fixture.hardRejectConditions.length, 8);
  const codes = new Set(fixture.hardRejectConditions.map(({code}) => code));
  for (const code of [
    'KS91_SECRET_LITERAL_DENIED',
    'KS91_SECRET_LOG_ARTIFACT_DENIED',
    'KS91_PLAINTEXT_CUSTODY_DENIED',
    'KS91_APPROVAL_GATE_REQUIRED_DENIED',
    'KS91_CUSTOMER_CREDENTIAL_CAPTURE_DENIED',
  ]) {
    assert.equal(codes.has(code), true, code);
  }
  for (const marker of [
    'Secret-custody option matrix',
    'custody boundary',
    'hypothetical access',
    'rotation',
    'revocation',
    'audit requirements',
    'approver',
    'rejection trigger',
    'logs.*artifacts',
    'plaintext custody',
    'customer credential capture',
    'default: DENY',
    'planning-only',
  ]) {
    assert.match(memo, new RegExp(marker, 'i'), marker);
  }
});
