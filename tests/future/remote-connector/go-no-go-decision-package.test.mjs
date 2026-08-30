import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateDecisionPackage } from '../../../scripts/dry-run-go-no-go-decision.mjs';

const root = new URL('../../../', import.meta.url).pathname;
const fixture = JSON.parse(await readFile(new URL('../../../docs/future/remote-connector/fixtures/go-no-go-decision-valid.json', import.meta.url)));
const clone = (value) => structuredClone(value);

test('released package is terminal REJECTED_WITH_EVIDENCE and NO_GO for execution', async () => {
  const result = await validateDecisionPackage(fixture, { root });
  assert.equal(result.status, 'REJECTED_WITH_EVIDENCE');
  assert.equal(result.verdict, 'REJECT');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.checks, {
    schemaValidation: 'PASS', citationVerification: 'PASS', referenceResolution: 'PASS',
    assessmentEvaluation: 'PASS', rejectRuleEvaluation: 'VIOLATION', authorizationFirewall: 'PASS',
  });
});

test('digest drift and caller-authored authority fail closed', async () => {
  const drift = clone(fixture);
  drift.citations[0].artifactSha256 = `sha256:${'0'.repeat(64)}`;
  drift.citations[0].artifactReference.sha256 = drift.citations[0].artifactSha256;
  assert.equal((await validateDecisionPackage(drift, { root })).status, 'INVALID_PACKAGE');

  const caller = clone(fixture);
  caller.authorizationFirewall.implementationAuthorized = true;
  const result = await validateDecisionPackage(caller, { root });
  assert.equal(result.status, 'INVALID_PACKAGE');
  assert.ok(result.errors.includes('AUTHORIZATION_FIREWALL_MISMATCH'));
});

test('mandatory negative contract remains explicit and non-authorizing', async () => {
  const texts = await Promise.all([
    'docs/future/remote-connector/GO_NO_GO_DECISION.md',
    'docs/future/remote-connector/GO_NO_GO_DECISION_CONTRACT.md',
  ].map((path) => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8')));
  const text = texts.join('\n');
  for (const phrase of ['discovery completion', 'endpoint creation', 'External API v2 widening', 'credentials or customer data', 'caller-authored authority', 'deployment readiness', 'compliance readiness', 'production readiness']) assert.match(text, new RegExp(phrase, 'i'));
  assert.match(text, /every implementation child/i);
  assert.match(text, /Jo, Product, and Security/);
});
