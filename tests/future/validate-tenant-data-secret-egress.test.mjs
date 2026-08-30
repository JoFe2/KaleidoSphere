import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';

import {
  TENANT_DATA_SECRET_EGRESS_CONTRACT_DIGEST_DENIED,
  TENANT_DATA_SECRET_EGRESS_CONTRACT_ID,
  TENANT_DATA_SECRET_EGRESS_CONTRACT_SCHEMA,
  TENANT_DATA_SECRET_EGRESS_CONTRACT_SURFACE_DENIED,
  TENANT_DATA_SECRET_EGRESS_ENVELOPE_SCHEMA,
  TENANT_DATA_SECRET_EGRESS_FUTURE_MEMO_SCHEMA,
  TENANT_DATA_SECRET_EGRESS_PRODUCT_VERSION,
  buildTenantDataSecretEgressContractBodyV1,
  tenantDataSecretEgressContractDigestV1,
  validateFutureMemoCandidateV1,
  validateFutureMemoFixtureV1,
  validateTenantDataSecretEgressContractV1,
  validateTenantDataSecretEgressEnvelopeV1,
  validateTenantDataSecretEgressNegativeCasesV1,
} from '../../scripts/future/validate-tenant-data-secret-egress.mjs';

const CONTRACT_FIXTURE = 'docs/future/remote-connector/fixtures/tenant-data-secret-egress-contract-v1.json';
const NEGATIVE_FIXTURE = 'docs/future/remote-connector/fixtures/tenant-data-secret-egress-negative-cases-v1.json';
const SELF_CHECK_DENIED = 'KS91_EGRESS_SELF_CHECK_DENIED';
const ENVELOPE_SURFACE_DENIED = 'KS91_EGRESS_ENVELOPE_SURFACE_DENIED';

const loadContract = async () => JSON.parse(await readFile(CONTRACT_FIXTURE, 'utf8'));
const loadNegative = async () => JSON.parse(await readFile(NEGATIVE_FIXTURE, 'utf8'));

const denialCodeOf = (run) => {
  try {
    run();
  } catch (error) {
    return error.code;
  }
  return null;
};

const baseEnvelope = (envelopeId, items = [], attestation = {}, egress = {}) => ({
  schemaVersion: TENANT_DATA_SECRET_EGRESS_ENVELOPE_SCHEMA,
  envelopeId,
  attestation: {
    productVersion: TENANT_DATA_SECRET_EGRESS_PRODUCT_VERSION,
    contractVersion: TENANT_DATA_SECRET_EGRESS_CONTRACT_SCHEMA,
    contractSha256: attestation.contractSha256 ?? 'sha256:1d85323fc72d4e5282e68050ff6fedc96ed5c0eded0420ca688ba63636ead4fa',
    ...attestation,
  },
  egress: {
    items,
    sourceRowsIncluded: false,
    secretsIncluded: false,
    rawSqlIncluded: false,
    freeformIncluded: false,
    ...egress,
  },
});

test('contract fixture is the frozen v1 body with a binding self-digest', async () => {
  const fixture = await loadContract();
  const checked = validateTenantDataSecretEgressContractV1(fixture);
  assert.equal(checked.digest, tenantDataSecretEgressContractDigestV1());
  assert.equal(checked.contractId, TENANT_DATA_SECRET_EGRESS_CONTRACT_ID);
  assert.equal(checked.status, 'FROZEN_FUTURE_SURFACE');
  assert.equal(checked.productVersion, TENANT_DATA_SECRET_EGRESS_PRODUCT_VERSION);
  assert.equal(checked.policy.default, 'DENY');
  assert.deepEqual(checked.integration, buildTenantDataSecretEgressContractBodyV1().integration);
  assert.ok(Object.isFrozen(checked));
});

test('contract surface and digest tampering fail closed', async () => {
  const fixture = await loadContract();
  const tampered = (mutate) => {
    const value = JSON.parse(JSON.stringify(fixture));
    mutate(value);
    return value;
  };
  assert.equal(
    denialCodeOf(() => validateTenantDataSecretEgressContractV1(tampered((value) => { value.extraKey = true; }))),
    TENANT_DATA_SECRET_EGRESS_CONTRACT_SURFACE_DENIED,
  );
  assert.equal(
    denialCodeOf(() => validateTenantDataSecretEgressContractV1(tampered((value) => { delete value.integration; }))),
    TENANT_DATA_SECRET_EGRESS_CONTRACT_SURFACE_DENIED,
  );
  assert.equal(
    denialCodeOf(() => validateTenantDataSecretEgressContractV1(tampered((value) => { value.policy.tenantSourceRowsEgress = true; }))),
    TENANT_DATA_SECRET_EGRESS_CONTRACT_SURFACE_DENIED,
  );
  assert.equal(
    denialCodeOf(() => validateTenantDataSecretEgressContractV1(tampered((value) => { value.digest = `sha256:${'0'.repeat(64)}`; }))),
    TENANT_DATA_SECRET_EGRESS_CONTRACT_DIGEST_DENIED,
  );
  assert.equal(
    denialCodeOf(() => validateTenantDataSecretEgressContractV1(tampered((value) => { value.digest = `sha256:${'x'.repeat(64)}`; }))),
    TENANT_DATA_SECRET_EGRESS_CONTRACT_DIGEST_DENIED,
  );
});

test('contract rejects proxies, accessor keys, symbol keys, and cycles', async () => {
  const fixture = await loadContract();
  const code = (value) => denialCodeOf(() => validateTenantDataSecretEgressContractV1(value));
  assert.equal(code(new Proxy(fixture, {})), TENANT_DATA_SECRET_EGRESS_CONTRACT_SURFACE_DENIED);
  const withAccessor = JSON.parse(JSON.stringify(fixture));
  Object.defineProperty(withAccessor, 'digest', {get: () => fixture.digest});
  assert.equal(code(withAccessor), TENANT_DATA_SECRET_EGRESS_CONTRACT_SURFACE_DENIED);
  const withSymbol = JSON.parse(JSON.stringify(fixture));
  withSymbol[Symbol('hostile')] = 1;
  assert.equal(code(withSymbol), TENANT_DATA_SECRET_EGRESS_CONTRACT_SURFACE_DENIED);
  const cyclic = JSON.parse(JSON.stringify(fixture));
  cyclic.self = cyclic;
  assert.equal(code(cyclic), TENANT_DATA_SECRET_EGRESS_CONTRACT_SURFACE_DENIED);
});

test('shipped negative cases are each rejected with their exact expected denial code', async () => {
  const contract = await loadContract();
  const negative = await loadNegative();
  const checked = validateTenantDataSecretEgressNegativeCasesV1(negative, contract);
  assert.equal(checked.cases.length, 16);
  const expectedCodes = new Set(checked.cases.map((item) => item.expectedCode));
  assert.deepEqual([...expectedCodes].sort(), [
    'KS91_EGRESS_AUTHORITY_DENIED',
    'KS91_EGRESS_BINDING_DENIED',
    'KS91_EGRESS_CLASS_DENIED',
    'KS91_EGRESS_CLASS_SHAPE_DENIED',
    'KS91_EGRESS_ENVELOPE_SURFACE_DENIED',
  ]);
  for (const item of negative.cases) {
    assert.equal(
      denialCodeOf(() => validateTenantDataSecretEgressEnvelopeV1(item.envelope, contract)),
      item.expectedCode,
      item.id,
    );
  }
});

test('negative-case fixture tampering fails closed', async () => {
  const contract = await loadContract();
  const negative = await loadNegative();
  const mismatched = JSON.parse(JSON.stringify(negative));
  mismatched.cases[0].expectedCode = 'KS91_EGRESS_BINDING_DENIED';
  assert.equal(
    denialCodeOf(() => validateTenantDataSecretEgressNegativeCasesV1(mismatched, contract)),
    SELF_CHECK_DENIED,
  );
  const duplicated = JSON.parse(JSON.stringify(negative));
  duplicated.cases[1].id = duplicated.cases[0].id;
  assert.equal(
    denialCodeOf(() => validateTenantDataSecretEgressNegativeCasesV1(duplicated, contract)),
    SELF_CHECK_DENIED,
  );
  const reidentified = JSON.parse(JSON.stringify(negative));
  reidentified.contractId = 'KS91-BOUNDARY-CONTRACT-02';
  assert.equal(
    denialCodeOf(() => validateTenantDataSecretEgressNegativeCasesV1(reidentified, contract)),
    SELF_CHECK_DENIED,
  );
});

test('a valid envelope carrying every permitted class is accepted and frozen', async () => {
  const contract = await loadContract();
  const items = [
    {class: 'aggregate-count', metric: 'table-count', value: 12},
    {class: 'blind-spot-label', label: 'COVERAGE_TIMEOUT'},
    {class: 'coverage-state', objectDigest: `sha256:${'e'.repeat(64)}`, state: 'PARTIAL'},
    {class: 'evidence-digest', label: 'coverage-sha', sha256: `sha256:${'a'.repeat(64)}`},
    {class: 'object-identifier', engine: 'oracle', schema: 'dbo', object: 'orders'},
  ];
  const envelope = baseEnvelope('env-ks91-positive', items);
  const accepted = validateTenantDataSecretEgressEnvelopeV1(envelope, contract);
  assert.deepEqual(accepted, envelope);
  assert.ok(Object.isFrozen(accepted));
  assert.doesNotThrow(() => validateTenantDataSecretEgressEnvelopeV1(baseEnvelope('env-ks91-empty'), contract));
  const overflow = Array.from({length: 257}, () => ({class: 'blind-spot-label', label: 'COVERAGE_UNKNOWN'}));
  assert.equal(
    denialCodeOf(() => validateTenantDataSecretEgressEnvelopeV1(baseEnvelope('env-ks91-overflow', overflow), contract)),
    ENVELOPE_SURFACE_DENIED,
  );
});

test('envelope rejects proxies, non-enumerable keys, cycles, and -0', async () => {
  const contract = await loadContract();
  const code = (value) => denialCodeOf(() => validateTenantDataSecretEgressEnvelopeV1(value, contract));
  const proxied = baseEnvelope('env-ks91-proxy');
  proxied.egress.items = [new Proxy({}, {get: () => 1})];
  assert.equal(code(proxied), ENVELOPE_SURFACE_DENIED);
  const accessor = baseEnvelope('env-ks91-accessor');
  Object.defineProperty(accessor.egress, 'note', {value: 'extra'});
  assert.equal(code(accessor), ENVELOPE_SURFACE_DENIED);
  const cyclic = baseEnvelope('env-ks91-cyclic', [{}]);
  cyclic.egress.items[0].self = cyclic.egress.items[0];
  assert.equal(code(cyclic), ENVELOPE_SURFACE_DENIED);
  assert.equal(code(baseEnvelope('env-ks91-negative-zero', [{class: 'aggregate-count', metric: 'table-count', value: -0}])), ENVELOPE_SURFACE_DENIED);
});

test('static future-memo validator accepts synthetic positives and rejects every required condition', async () => {
  const [fixture, memo] = await Promise.all([loadNegative(), readFile('docs/future/remote-connector/TENANT_DATA_SECRET_EGRESS.md', 'utf8')]);
  const checked = validateFutureMemoFixtureV1(fixture.memoValidation, memo);
  assert.equal(checked.fixture.schemaVersion, TENANT_DATA_SECRET_EGRESS_FUTURE_MEMO_SCHEMA);
  assert.equal(checked.fixture.policy.default, 'DENY');
  assert.equal(checked.fixture.policy.offlineOnly, true);
  assert.equal(checked.fixture.validCases.length, 2);
  assert.equal(checked.report.length, 11);

  const requiredCriteria = new Set([
    'cross-tenant-data-flow',
    'unbounded-retention',
    'uncontrolled-egress',
    'secret-in-log-or-artifact',
    'region-residency-mismatch',
    'live-data',
    'credential-path',
    'endpoint',
    'deployment',
    'network-invocation',
  ]);
  assert.deepEqual(new Set(checked.report.map(({criterion}) => criterion)), requiredCriteria);
  for (const item of fixture.memoValidation.validCases) {
    assert.deepEqual(validateFutureMemoCandidateV1(item.candidate), item.candidate, item.id);
  }
  for (const item of fixture.memoValidation.negativeCases) {
    const denial = denialCodeOf(() => validateFutureMemoCandidateV1(item.candidate));
    assert.equal(denial, item.expectedReject, item.id);
    assert.equal(checked.report.some(({id, reject}) => id === item.id && reject === item.expectedReject), true, item.id);
  }
});

test('static future-memo validation fails closed without echoing candidate content', async () => {
  const [fixture, memo] = await Promise.all([loadNegative(), readFile('docs/future/remote-connector/TENANT_DATA_SECRET_EGRESS.md', 'utf8')]);
  const tampered = JSON.parse(JSON.stringify(fixture.memoValidation));
  tampered.negativeCases[0].expectedReject = 'KS91_DEPLOYMENT_DENIED';
  assert.equal(
    denialCodeOf(() => validateFutureMemoFixtureV1(tampered, memo)),
    'KS91_FUTURE_MEMO_SURFACE_DENIED',
  );
  assert.equal(
    denialCodeOf(() => validateFutureMemoFixtureV1(fixture.memoValidation, `${memo}\nThis memo authorizes an endpoint.`)),
    'KS91_FUTURE_MEMO_AUTHORIZATION_DENIED',
  );
  const unsafe = JSON.parse(JSON.stringify(fixture.memoValidation.validCases[0].candidate));
  unsafe.networkInvocation = true;
  assert.equal(denialCodeOf(() => validateFutureMemoCandidateV1(unsafe)), 'KS91_NETWORK_INVOCATION_DENIED');
});

test('static future-memo validation rejects prohibited approvals, claims, and network invocation', async () => {
  const [fixture, memo] = await Promise.all([loadNegative(), readFile('docs/future/remote-connector/TENANT_DATA_SECRET_EGRESS.md', 'utf8')]);
  for (const addition of [
    'This memo approves a cross-tenant data flow.',
    'This memo approves an endpoint.',
    'This memo approves a deployment.',
    'This memo approves credential transport.',
    'This memo approves live-data access.',
    'This memo claims an endpoint exists.',
    'This memo claims a deployment exists.',
    'This memo claims a credential path exists.',
    'This memo claims live-data access exists.',
  ]) {
    assert.equal(
      denialCodeOf(() => validateFutureMemoFixtureV1(fixture.memoValidation, `${memo}\n${addition}`)),
      'KS91_FUTURE_MEMO_AUTHORIZATION_DENIED',
      addition,
    );
  }
  assert.equal(
    denialCodeOf(() => validateFutureMemoFixtureV1(fixture.memoValidation, `${memo}\nfetch("synthetic-target")`)),
    'KS91_FUTURE_MEMO_VALIDATION_DENIED',
  );
});

test('CLI self-check, envelope acceptance, denial, and usage exits', async () => {
  const cli = 'scripts/future/validate-tenant-data-secret-egress.mjs';
  const selfCheck = execFileSync(process.execPath, [cli], {encoding: 'utf8'}).trim();
  assert.match(selfCheck, /^TENANT_DATA_SECRET_EGRESS_SELF_CHECK_PASSED contractDigest=sha256:[a-f0-9]{64} negativeCases=16$/);
  const dir = await mkdtemp(path.join(tmpdir(), 'ks91-egress-'));
  const acceptedPath = path.join(dir, 'accepted.json');
  await writeFile(acceptedPath, JSON.stringify(baseEnvelope('env-ks91-cli-ok', [{class: 'blind-spot-label', label: 'COVERAGE_MISSING'}])));
  assert.equal(
    execFileSync(process.execPath, [cli, acceptedPath], {encoding: 'utf8'}).trim(),
    'TENANT_DATA_SECRET_EGRESS_ENVELOPE_ACCEPTED env-ks91-cli-ok',
  );
  const deniedPath = path.join(dir, 'denied.json');
  const deniedEnvelope = baseEnvelope('env-ks91-cli-denied');
  deniedEnvelope.egress.secretsIncluded = true;
  await writeFile(deniedPath, JSON.stringify(deniedEnvelope));
  try {
    execFileSync(process.execPath, [cli, deniedPath], {encoding: 'utf8'});
    assert.fail('expected envelope denial');
  } catch (error) {
    assert.equal(error.status, 1);
    assert.equal(String(error.stdout).trim(), 'KS91_EGRESS_AUTHORITY_DENIED');
  }
  try {
    execFileSync(process.execPath, [cli, 'a', 'b'], {encoding: 'utf8'});
    assert.fail('expected usage error');
  } catch (error) {
    assert.equal(error.status, 2);
  }
});

test('CLI dry-run validates the sole future memo and rejects an unresolved memo reference', () => {
  const cli = 'scripts/future/validate-tenant-data-secret-egress.mjs';
  const output = execFileSync(process.execPath, [cli, '--memo', 'docs/future/remote-connector/TENANT_DATA_SECRET_EGRESS.md', '--dry-run'], {encoding: 'utf8'});
  assert.match(output, /criterion=cross-tenant-data-flow id=memo-neg-cross-tenant-flow reject=KS91_CROSS_TENANT_FLOW_DENIED/);
  assert.match(output, /criterion=secret-in-log-or-artifact id=memo-neg-secret-in-artifact reject=KS91_SECRET_LOG_ARTIFACT_DENIED/);
  assert.match(output, /criterion=network-invocation id=memo-neg-network-invocation reject=KS91_NETWORK_INVOCATION_DENIED/);
  assert.match(output, /FUTURE_MEMO_VALIDATION_PASSED planningStatus=FUTURE_BACKLOG disposition=NONTERMINAL terminal=false implementationDisposition=REJECTED_WITH_EVIDENCE implementationDecision=REJECT_IMPLEMENTATION_NOW components=7 criteria=15 contractDigest=sha256:[a-f0-9]{64} validCases=2 negativeCases=11 envelopeNegativeCases=16/);
  try {
    execFileSync(process.execPath, [cli, '--memo', 'docs/future/remote-connector/UNRESOLVED.md', '--dry-run'], {encoding: 'utf8'});
    assert.fail('expected unresolved memo reference denial');
  } catch (error) {
    assert.equal(error.status, 1);
    assert.equal(String(error.stderr).trim(), 'KS91_FUTURE_MEMO_SURFACE_DENIED');
  }
});
