import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const text = await readFile('docs/future/remote-connector/GO_DELIVERY_AUTHORIZATION_TEMPLATE.md', 'utf8');
const template = JSON.parse(text.split('```json\n')[1].split('\n```')[0]);
const clone = (value) => structuredClone(value);

function authorize(candidate, childId = 'CHILD-IMMUTABLE-001') {
  candidate.decisionInput.goDecision = 'GO';
  candidate.decisionInput.discoveryCompletion = 'NOT_AUTHORIZATION';
  candidate.decisionInput.associations.issue73K4e = 'NOT_AUTHORIZATION';
  for (const [field, authority] of [['joAuthorization','Jo'],['productAuthorization','Product'],['securityAuthorization','Security']]) {
    candidate.authorizationRecords[field] = { ...candidate.authorizationRecords[field], recordId: `${childId}-${authority}`, authority, recordedBy: authority, authorizationStatus: 'APPROVED', decision: 'AUTHORIZE_FUTURE_PLAN_REVIEW_ONLY', independentlyRecorded: true, recordedAt: `${childId}-${authority}-TIME` };
  }
  return candidate;
}

function evaluate(candidate) {
  if (candidate.artifactStatus !== 'UNSIGNED_TEMPLATE' || candidate.signature !== null) return 'DENIED';
  if (candidate.decisionInput.goDecision !== 'GO' || candidate.decisionInput.discoveryCompletion !== 'NOT_AUTHORIZATION' || candidate.decisionInput.associations.issue73K4e !== 'NOT_AUTHORIZATION') return 'DENIED';
  if (Object.values(candidate.decisionInput.scope).some((value) => value !== false)) return 'DENIED';
  const required = [['joAuthorization','Jo'],['productAuthorization','Product'],['securityAuthorization','Security']];
  const records = required.map(([key]) => candidate.authorizationRecords?.[key]);
  if (records.some((r,i) => !r || r.authority !== required[i][1] || r.authorizationStatus !== 'APPROVED' || r.decision !== 'AUTHORIZE_FUTURE_PLAN_REVIEW_ONLY' || r.scope !== 'FUTURE_PLAN_REVIEW_ONLY' || r.executionAuthority !== 'DENIED' || r.independentlyRecorded !== true || !r.recordId || !r.recordedAt)) return 'DENIED';
  if (new Set(records.map((r) => r.recordId)).size !== 3) return 'DENIED';
  return 'ELIGIBLE_FOR_FUTURE_PLAN_REVIEW_ONLY';
}

test('every implementation child requires separate Jo Product Security records and remains execution-denied', () => {
  assert.match(text, /every implementation child/i);
  const childA = authorize(clone(template), 'A');
  assert.equal(evaluate(childA), 'ELIGIBLE_FOR_FUTURE_PLAN_REVIEW_ONLY');
  assert.equal(childA.executionEligibilityIfComplete, 'DENIED');
  assert.equal(childA.firewallResult.implementationChildStatus, 'BLOCKED_NO_SEPARATE_DELIVERY_AUTHORIZATION');
  const childB = clone(template);
  childB.authorizationRecords = childA.authorizationRecords;
  assert.match(text, /records cannot be inherited or reused/i);
  assert.equal(childB.decisionInput.goDecision, null);
  assert.equal(evaluate(childB), 'DENIED');
});

test('missing any Jo Product or Security record denies', () => {
  for (const field of ['joAuthorization','productAuthorization','securityAuthorization']) {
    const candidate = authorize(clone(template));
    delete candidate.authorizationRecords[field];
    assert.equal(evaluate(candidate), 'DENIED');
  }
});

test('discovery and every forbidden implementation/readiness scope deny', () => {
  const discovery = authorize(clone(template));
  discovery.decisionInput.discoveryCompletion = 'COMPLETE';
  assert.equal(evaluate(discovery), 'DENIED');
  for (const field of Object.keys(template.decisionInput.scope)) {
    const candidate = authorize(clone(template));
    candidate.decisionInput.scope[field] = true;
    assert.equal(evaluate(candidate), 'DENIED', field);
  }
});

test('caller-authored GO alone and ambiguous records deny', () => {
  const goOnly = clone(template);
  goOnly.decisionInput.goDecision = 'GO';
  goOnly.decisionInput.discoveryCompletion = 'NOT_AUTHORIZATION';
  goOnly.decisionInput.associations.issue73K4e = 'NOT_AUTHORIZATION';
  assert.equal(evaluate(goOnly), 'DENIED');
  const ambiguous = authorize(clone(template));
  ambiguous.authorizationRecords.productAuthorization.decision = 'APPROVED';
  assert.equal(evaluate(ambiguous), 'DENIED');
});
