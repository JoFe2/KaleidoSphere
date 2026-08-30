import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  validateContracts,
  validateFixtureContract,
  validatePlanText,
} from '../scripts/validate-synthetic-connector-spike-plan.mjs';

const PLAN_PATH = new URL('../docs/future/remote-connector/SYNTHETIC_SPIKE_PLAN.md', import.meta.url);
const FIXTURE_PATH = new URL('../docs/future/remote-connector/fixtures/synthetic-connector-fixture-v1.json', import.meta.url);
const planText = await readFile(PLAN_PATH, 'utf8');
const fixture = JSON.parse(await readFile(FIXTURE_PATH, 'utf8'));

function replaceLineContaining(source, marker, replacement) {
  const lines = source.split('\n');
  const matches = lines.filter((line) => line.includes(marker));
  assert.equal(matches.length, 1, `expected one mutation target for ${marker}`);
  return lines.map((line) => (line.includes(marker) ? replacement : line)).join('\n');
}

function failingIds(result) {
  return result.findings.filter(({ status }) => status === 'FAIL').map(({ id }) => id);
}

test('committed plan and synthetic fixture validate RELEASED offline', () => {
  const result = validateContracts(planText, fixture);
  assert.equal(result.schemaVersion, 'kaleidosphere/synthetic-connector-spike-validation/v1');
  assert.equal(result.outcome, 'RELEASED');
  assert.equal(result.valid, true);
  assert.equal(result.failedCount, 0);
  assert.equal(result.plan.outcome, 'RELEASED');
  assert.equal(result.fixture.outcome, 'RELEASED');
});

test('plan contract includes explicit start, stop, rollback, fixture, isolation, and bounded sections', () => {
  const result = validatePlanText(planText);
  assert.equal(result.outcome, 'RELEASED');
  assert.deepEqual(failingIds(result), []);
  for (const id of ['PLAN-START', 'PLAN-STOP', 'PLAN-ROLLBACK', 'PLAN-FIXTURE', 'PLAN-ISOLATION', 'PLAN-BOUNDS']) {
    assert.equal(result.findings.find((finding) => finding.id === id)?.status, 'PASS');
  }
});

test('fixture contract validates provenance, isolation, read-only actions, bounds, and manifest', () => {
  const result = validateFixtureContract(fixture);
  assert.equal(result.outcome, 'RELEASED');
  assert.equal(result.failedCount, 0);
  assert.ok(result.checkCount > 0);
});

test('live credentials fail closed (NEG-01)', () => {
  const mutated = replaceLineContaining(planText, 'NEG-01: any live credential requirement', '- NEG-01: live credentials are required and injected at run time.');
  const result = validatePlanText(mutated);
  assert.equal(result.outcome, 'REJECTED_WITH_EVIDENCE');
  assert.ok(failingIds(result).includes('NEG-01'));
});

test('public or hosted endpoint fails closed (NEG-02)', () => {
  const mutated = replaceLineContaining(planText, 'NEG-02: any public bind or hosted endpoint', '- NEG-02: a public hosted endpoint is permitted for this spike.');
  const result = validatePlanText(mutated);
  assert.equal(result.outcome, 'REJECTED_WITH_EVIDENCE');
  assert.ok(failingIds(result).includes('NEG-02'));
});

test('customer data or provider payload fails closed (NEG-03)', () => {
  const mutated = replaceLineContaining(planText, 'NEG-03: any customer data or provider payload', '- NEG-03: customer data and provider payloads may be used.');
  const result = validatePlanText(mutated);
  assert.equal(result.outcome, 'REJECTED_WITH_EVIDENCE');
  assert.ok(failingIds(result).includes('NEG-03'));
});

test('mutation-capable action fails closed (NEG-04)', () => {
  const mutated = replaceLineContaining(planText, 'NEG-04: any mutation-capable connector action', '- NEG-04: mutation-capable connector actions are permitted.');
  const result = validatePlanText(mutated);
  assert.equal(result.outcome, 'REJECTED_WITH_EVIDENCE');
  assert.ok(failingIds(result).includes('NEG-04'));
});

test('open-ended retry loop fails closed (NEG-05)', () => {
  const mutated = replaceLineContaining(planText, 'NEG-05: any open-ended or blind retry loop', '- NEG-05: retry until the operation succeeds.');
  const result = validatePlanText(mutated);
  assert.equal(result.outcome, 'REJECTED_WITH_EVIDENCE');
  assert.ok(failingIds(result).includes('NEG-05'));
});

test('fixture live credentials and public/hosted endpoint requirements fail closed', () => {
  const credentials = structuredClone(fixture);
  credentials.contract.credentialsRequired = true;
  assert.equal(validateFixtureContract(credentials).outcome, 'REJECTED_WITH_EVIDENCE');
  assert.ok(failingIds(validateFixtureContract(credentials)).includes('CONTRACT-CREDENTIALS'));

  const endpoint = structuredClone(fixture);
  endpoint.contract.publicEndpointRequired = true;
  endpoint.contract.hostedEndpointRequired = true;
  const result = validateFixtureContract(endpoint);
  assert.equal(result.outcome, 'REJECTED_WITH_EVIDENCE');
  assert.ok(failingIds(result).includes('CONTRACT-PUBLIC'));
  assert.ok(failingIds(result).includes('CONTRACT-HOSTED'));
});

test('fixture customer/provider data and mutation-capable action fail closed', () => {
  const provenance = structuredClone(fixture);
  provenance.provenance.generatedFromCustomerData = true;
  assert.equal(validateFixtureContract(provenance).outcome, 'REJECTED_WITH_EVIDENCE');
  assert.ok(failingIds(validateFixtureContract(provenance)).includes('PROVENANCE-SYNTHETIC'));

  const action = structuredClone(fixture);
  action.contract.actions[0].mutates = true;
  const result = validateFixtureContract(action);
  assert.equal(result.outcome, 'REJECTED_WITH_EVIDENCE');
  assert.ok(failingIds(result).includes('ACTION-enumerate_collections'));
});

test('fixture manifest tampering fails closed', () => {
  const mutated = structuredClone(fixture);
  mutated.fixture.collections[0].records[0].rank = 99;
  const result = validateFixtureContract(mutated);
  assert.equal(result.outcome, 'REJECTED_WITH_EVIDENCE');
  assert.ok(failingIds(result).includes('MANIFEST-DIGEST'));
});

test('malformed or incomplete inputs fail closed rather than being treated as evidence', () => {
  const malformed = validateFixtureContract(null);
  assert.equal(malformed.outcome, 'REJECTED_WITH_EVIDENCE');
  assert.equal(malformed.valid, false);

  const incomplete = validatePlanText('# Spike plan\n\nEvidence: pending.\n');
  assert.equal(incomplete.outcome, 'REJECTED_WITH_EVIDENCE');
  assert.equal(incomplete.valid, false);
  assert.ok(incomplete.failedCount > 0);
});
