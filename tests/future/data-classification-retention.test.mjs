import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const MEMO_PATH = 'docs/future/remote-connector/TENANT_DATA_SECRET_EGRESS.md';
const FIXTURE_PATH = 'docs/future/remote-connector/fixtures/data-classification-retention-v1.json';

const DECISION_METADATA_FIELDS = new Set([
  'id',
  'dataOrigin',
  'dataCategory',
  'sensitivity',
  'tenantBoundary',
  'permittedRegionChoice',
  'retentionPolicyId',
  'retentionTrigger',
  'retentionDurationDays',
  'deletionVerification',
  'owner',
  'unknown',
]);
const SYNTHETIC_LABEL_FIELDS = [
  'dataCategory',
  'sensitivity',
  'tenantBoundary',
  'permittedRegionChoice',
  'retentionTrigger',
  'deletionVerification',
  'owner',
];

const loadFixture = async () => JSON.parse(await readFile(FIXTURE_PATH, 'utf8'));
const loadMemo = async () => readFile(MEMO_PATH, 'utf8');

function denialCodeOf(run) {
  try {
    run();
  } catch (error) {
    return error.code;
  }
  return null;
}

function deny(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function validateCandidate(candidate, contract) {
  if (candidate.dataOrigin !== 'synthetic') deny('KS91_LIVE_DATA_DENIED');
  if (!contract.matrix.some(({dataCategory}) => dataCategory === candidate.dataCategory)) {
    deny('KS91_UNKNOWN_CATEGORY_DENIED');
  }
  if (!candidate.tenantBoundary || !candidate.permittedRegionChoice) deny('KS91_RESIDENCY_UNSPECIFIED_DENIED');

  const region = contract.regionChoices.find(({id}) => id === candidate.permittedRegionChoice);
  if (!region || !region.permittedTenantBoundaries.includes(candidate.tenantBoundary)) {
    deny('KS91_RESIDENCY_MISMATCH_DENIED');
  }

  if (candidate.retentionDurationDays === null || candidate.retentionDurationDays === undefined) {
    deny(candidate.retentionPolicyId === 'unbounded'
      ? 'KS91_RETENTION_UNBOUNDED_DENIED'
      : 'KS91_RETENTION_UNSPECIFIED_DENIED');
  }
  if (!Number.isInteger(candidate.retentionDurationDays) || candidate.retentionDurationDays <= 0) {
    deny('KS91_RETENTION_DURATION_DENIED');
  }
  if (candidate.retentionDurationDays > contract.policy.maximumRetentionDays) {
    deny('KS91_RETENTION_UNBOUNDED_DENIED');
  }

  const retention = contract.retentionPolicies.find(({id}) => id === candidate.retentionPolicyId);
  if (!retention) deny('KS91_RETENTION_UNSPECIFIED_DENIED');
  if (retention.trigger !== candidate.retentionTrigger
      || retention.durationDays !== candidate.retentionDurationDays
      || retention.deletionVerification !== candidate.deletionVerification) {
    deny('KS91_RETENTION_POLICY_MISMATCH_DENIED');
  }
  if (!Number.isInteger(retention.reviewAfterDays)
      || retention.reviewAfterDays < 0
      || retention.reviewAfterDays > retention.durationDays
      || !retention.reviewOwner?.startsWith('synthetic-')
      || retention.missingReviewOutcome !== 'REJECT_AND_DELETE') {
    deny('KS91_RETENTION_REVIEW_DENIED');
  }
  if (candidate.owner !== retention.reviewOwner) deny('KS91_RETENTION_POLICY_MISMATCH_DENIED');
  if (candidate.unknown !== 'REJECT') deny('KS91_UNKNOWN_VALUE_DENIED');
  return candidate;
}

test('synthetic classification and retention matrix covers the required decision fields', async () => {
  const fixture = await loadFixture();
  assert.equal(fixture.schemaVersion, 'kaleidosphere.remote-connector/data-classification-retention/v1');
  assert.equal(fixture.status, 'FROZEN_FUTURE_SURFACE');
  assert.equal(fixture.evidenceClass, 'synthetic-fixture-only');
  assert.equal(fixture.policy.default, 'DENY');
  assert.equal(fixture.policy.syntheticOnly, true);
  assert.equal(fixture.policy.liveCustomerDataAllowed, false);
  assert.equal(fixture.policy.tenantBoundaryRequired, true);
  assert.equal(fixture.policy.residencyChoiceRequired, true);
  assert.equal(fixture.matrix.length, 3);

  const requiredFields = [
    'dataCategory',
    'sensitivity',
    'tenantBoundary',
    'permittedRegionChoice',
    'retentionTrigger',
    'retentionDurationDays',
    'deletionVerification',
    'owner',
    'unknown',
  ];
  for (const row of fixture.matrix) {
    for (const field of requiredFields) assert.ok(field in row, `${row.id} missing ${field}`);
    assert.equal(row.dataOrigin, 'synthetic');
    assert.equal(row.unknown, 'REJECT');
    assert.equal(row.owner, 'synthetic-data-governance');
    assert.equal(validateCandidate(row, fixture), row);
  }
  assert.deepEqual(
    fixture.matrix.map(({dataCategory}) => dataCategory).sort(),
    ['synthetic-aggregate', 'synthetic-identifier', 'synthetic-sensitive-metric'],
  );
});

test('every retention choice is finite and has review plus deletion verification handling', async () => {
  const fixture = await loadFixture();
  assert.ok(fixture.retentionPolicies.length >= 3);
  for (const policy of fixture.retentionPolicies) {
    assert.equal(Number.isInteger(policy.durationDays), true, policy.id);
    assert.equal(policy.durationDays > 0, true, policy.id);
    assert.equal(policy.durationDays <= fixture.policy.maximumRetentionDays, true, policy.id);
    assert.equal(Number.isInteger(policy.reviewAfterDays), true, policy.id);
    assert.equal(policy.reviewAfterDays >= 0, true, policy.id);
    assert.equal(policy.reviewAfterDays <= policy.durationDays, true, policy.id);
    assert.match(policy.reviewOwner, /^synthetic-/);
    assert.equal(policy.missingReviewOutcome, 'REJECT_AND_DELETE');
    assert.ok(policy.deletionVerification.length > 0);
  }
  assert.deepEqual(
    new Set(fixture.matrix.map(({retentionPolicyId}) => retentionPolicyId)),
    new Set(fixture.retentionPolicies.map(({id}) => id)),
  );
  assert.equal(fixture.policy.unboundedRetentionAllowed, false);
  assert.equal(fixture.policy.unspecifiedRetentionAllowed, false);
});

test('mandatory negative cases reject unbounded or unspecified retention and residency mismatch', async () => {
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
  assert.equal(expectedCodes.has('KS91_RETENTION_UNBOUNDED_DENIED'), true);
  assert.equal(expectedCodes.has('KS91_RETENTION_UNSPECIFIED_DENIED'), true);
  assert.equal(expectedCodes.has('KS91_RESIDENCY_MISMATCH_DENIED'), true);
});

test('live-origin input is rejected and the shipped fixture remains synthetic-only', async () => {
  const fixture = await loadFixture();
  const liveOrigin = fixture.negativeCases.find(({id}) => id === 'reject-live-origin');
  assert.equal(denialCodeOf(() => validateCandidate(liveOrigin.candidate, fixture)), 'KS91_LIVE_DATA_DENIED');
  assert.equal(fixture.matrix.every(({dataOrigin}) => dataOrigin === 'synthetic'), true);
  assert.equal(fixture.negativeCases.filter(({candidate}) => candidate.dataOrigin === 'synthetic').length, 3);
  assert.equal(fixture.policy.liveCustomerDataAllowed, false);

  const candidates = [
    ...fixture.matrix,
    ...fixture.negativeCases.map(({candidate}) => candidate),
  ];
  for (const candidate of candidates) {
    for (const field of Object.keys(candidate)) {
      assert.equal(DECISION_METADATA_FIELDS.has(field), true, `payload field denied: ${field}`);
    }
    for (const field of SYNTHETIC_LABEL_FIELDS) {
      assert.match(candidate[field], /^synthetic-/, `${field} must remain a synthetic label`);
    }
  }
});

test('memo records residency, classification, finite retention, deletion, and fail-closed rules', async () => {
  const [fixture, memo] = await Promise.all([loadFixture(), loadMemo()]);
  for (const marker of [
    'Data classification and retention matrix',
    'Residency choices',
    'Retention and deletion rules',
    'unbounded retention',
    'region/residency mismatch',
    'synthetic-only',
    'REJECTED_WITH_EVIDENCE',
  ]) {
    assert.match(memo, new RegExp(marker, 'i'), marker);
  }
  for (const identifier of [
    ...fixture.regionChoices.map(({id}) => id),
    ...fixture.retentionPolicies.map(({id}) => id),
    ...fixture.matrix.map(({dataCategory}) => dataCategory),
  ]) {
    assert.equal(memo.includes(`\`${identifier}\``), true, `${identifier} missing from memo`);
  }
});
