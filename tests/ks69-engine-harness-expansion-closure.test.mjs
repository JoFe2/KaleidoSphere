import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const RECEIPT = 'docs/evidence/conveyor/ks69-engine-harness-expansion-closure-v1.json';

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

test('KS69 receipt records measured expansion and explicit non-promotion without invented runtime claims', async () => {
  const receipt = await readJson(RECEIPT);
  assert.equal(receipt.schemaVersion, 'kaleidosphere/evidence/ks69-engine-harness-expansion-closure/v1');
  assert.equal(receipt.issue, 69);
  assert.equal(receipt.currentMainBase, '41a1f5fa1deff64836340d1efd3e8a292bbe34f7');
  assert.deepEqual(receipt.engines, {
    mssql: 'SUPPORTED_READ_ONLY',
    oracle: 'SUPPORTED_READ_ONLY',
    postgresql: 'BOUNDED_PILOT_NOT_PROMOTED',
    mysql: 'NOT_ADMITTED',
  });
  assert.equal(receipt.dsh.repository, 'JoFe2/kaleidosphere-dsh-plugin');
  assert.equal(receipt.dsh.release, 'v0.1.0-preview.3');
  assert.equal(receipt.dsh.disposition, 'SEPARATE_DEVELOPER_PREVIEW');
  assert.deepEqual(receipt.nonClaims, [
    'NO_UNIVERSAL_ENGINE_PARITY',
    'NO_MARKETPLACE_LISTING',
    'NO_UNAVAILABLE_RUNTIME_E2E',
    'NO_PRODUCTION_OR_LIVE_CUSTOMER_EVIDENCE',
    'NO_ARBITRARY_SQL_OR_MUTATION',
  ]);
});

test('shared host contracts preserve exact evidence tiers and one business-logic copy', async () => {
  const hosts = await readJson('agent-skills/host-contracts.json');
  assert.equal(hosts.schemaVersion, 'kaleidosphere/agent-skill-host-contracts/v2');
  assert.equal(hosts.sharedBusinessLogicCopies, 1);
  assert.deepEqual(Object.keys(hosts.hosts).sort(), ['claude-code', 'codex', 'hermes', 'openclaw']);
  assert.equal(hosts.hosts.openclaw.evidence, 'runtime-validated-openclaw-2026.7.1-2');
  assert.equal(hosts.hosts.codex.evidence, 'installer-roundtrip-validated-codex-0.144.1');
  assert.equal(hosts.hosts['claude-code'].evidence, 'installer-roundtrip-validated-binary-unavailable');
  assert.equal(hosts.hosts.hermes.evidence, 'structure-validated-runtime-unavailable');
  assert.deepEqual(Object.keys(hosts.distribution.views).sort(), ['claudeCode', 'clawhubOpenClawHermes', 'codex']);
  assert.equal(hosts.crossHarness.runtimeDispatch, false);
  assert.equal(hosts.crossHarness.marketplaceApprovalClaim, false);
  assert.equal(hosts.crossHarness.security.externalCallsAllowed, false);
  assert.equal(hosts.crossHarness.security.secretsAllowed, false);
});

test('PostgreSQL remains an isolated pilot and DSH remains outside the core release', async () => {
  const readme = await readFile('README.md', 'utf8');
  assert.match(readme, /Optional bounded pilots/);
  assert.match(readme, /PostgreSQL/);
  assert.match(readme, /separate \*\*Developer Preview\*\*/);
  assert.match(readme, /not part\s+of the KaleidoSphere v0\.26\.0 release assets/);
  assert.doesNotMatch(readme, /BI_ENGINE\s*=\s*postgres/i);
  assert.doesNotMatch(readme, /Postgres(?:QL)? is now a supported production database engine/i);
  const compose = await readFile('compose.yaml', 'utf8');
  assert.doesNotMatch(compose, /BI_ENGINE:\s*postgres/i);
  assert.doesNotMatch(compose, /mysql:/i);
});

test('current evidence keeps engine/harness security and lifecycle suites canonical', async () => {
  const packageJson = await readJson('package.json');
  for (const path of [
    'tests/postgresql-e2e.test.mjs',
    'tests/postgresql-wave2-workflow.test.mjs',
    'tests/agent-skill-distribution.test.mjs',
    'tests/hermes-consumption.test.mjs',
    'tests/closed-intent-conformance-pack.test.mjs',
  ]) assert.match(packageJson.scripts.test, new RegExp(path.replaceAll('.', '\\.')));
});
