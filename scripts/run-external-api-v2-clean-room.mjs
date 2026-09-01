#!/usr/bin/env node
import { createHash } from 'node:crypto';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:18790';
const REQUEST_SCHEMA = 'superset-bi-agent.external/intent-request/v2';
const canonical = (value) => {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
};
const digest = (value) => `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
const fail = (message) => { throw new Error(message); };

async function get(path) {
  const response = await fetch(`${baseUrl}${path}`, {signal: AbortSignal.timeout(10_000)});
  const value = await response.json();
  if (!response.ok) fail(value.code ?? `HTTP_${response.status}`);
  return value;
}

async function post(request, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}/v2/intents`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(190_000),
  });
  const value = await response.json();
  if (response.status !== expectedStatus) fail(`expected ${expectedStatus}, got ${response.status}: ${JSON.stringify(value)}`);
  return value;
}

function request(requestId, action, input) {
  return {schemaVersion: REQUEST_SCHEMA, requestId, action, ...(input === undefined ? {} : {input})};
}

function verifyEnvelope(value, action) {
  if (value.schemaVersion !== 'superset-bi-agent.external/intent-result/v2' || value.action !== action) fail(`${action}: envelope mismatch`);
  if (value.runtime.product.id !== 'superset-bi-agent' || value.runtime.product.version !== 'v0.18.1') fail(`${action}: product mismatch`);
  if (value.runtime.contract.id !== 'superset-bi-agent.external' || value.runtime.contract.version !== '2.0.0') fail(`${action}: contract mismatch`);
  const body = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'integrity'));
  if (value.integrity?.digest !== digest(body)) fail(`${action}: response digest mismatch`);
}

const attestation = await get('/v2/capabilities');
const attestationBody = Object.fromEntries(Object.entries(attestation).filter(([key]) => key !== 'attestation'));
if (attestation.product.version !== 'v0.18.1' || attestation.contract.version !== '2.0.0') fail('attestation version mismatch');
if (attestation.attestation.digest !== digest(attestationBody)) fail('attestation digest mismatch');
if (attestation.graph.acceptedIncumbent !== 'adaptive-v1' || attestation.graph.candidatePromotion !== 'none') fail('graph incumbent mismatch');
const required = ['bi.status.read', 'bi.discovery.run', 'bi.analysis.run', 'bi.graph.adaptive-v1.plan', 'bi.preview.create', 'bi.readback.read'];
if (required.some((id) => !attestation.capabilities.some((item) => item.id === id))) fail('required capability missing');

const manifest = await get('/v2/capability-manifest');
const manifestBody = Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'integrity'));
if (manifest.integrity?.digest !== digest(manifestBody)) fail('manifest integrity digest mismatch');
if (manifest.product.version !== 'v0.18.1' || manifest.contract.version !== '2.0.0') fail('manifest version mismatch');
if (manifest.attestation.digest !== attestation.attestation.digest) fail('manifest attestation binding mismatch');
const profile = manifest.consumerProfile;
if (!profile || typeof profile !== 'object' || Array.isArray(profile)) fail('manifest consumer profile missing');
const profileBody = Object.fromEntries(Object.entries(profile).filter(([key]) => key !== 'attestation'));
if (profile.attestation?.digest !== digest(profileBody)) fail('consumer profile digest mismatch');
if (profile.product?.version !== manifest.product.version || profile.contract?.version !== manifest.contract.version) fail('consumer profile version mismatch');
const supportedIds = profile.supported.map((item) => item.id);
if (supportedIds.length !== 6 || new Set(supportedIds).size !== 6 || required.some((id) => !supportedIds.includes(id))) fail('consumer profile supported surface mismatch');
const partialIds = profile.partial.map((item) => item.id).sort();
if (partialIds.length !== 3 || JSON.stringify(partialIds) !== JSON.stringify(['superset.trusted-apply', 'superset.trusted-readback', 'superset.trusted-rollback'])) fail('consumer profile partial surface mismatch');
if (profile.partial.some((item) => item.externalIntent !== false)) fail('consumer profile partial externally dispatchable');
if (profile.supported.some((item) => item.externalIntent !== undefined)) fail('consumer profile supported surface widened');
const unsupportedSurfaces = profile.unsupported.map((item) => item.surface).sort();
if (JSON.stringify(unsupportedSurfaces) !== JSON.stringify(['directSupersetMutationIntent', 'freeSql', 'modelMutation', 'rawSourceRows', 'sourceDatabaseCredentials'])) fail('consumer profile unsupported surface mismatch');
if (profile.unsupported.some((item) => item.accepted !== false)) fail('consumer profile boundary widened');
if (profile.boundaries?.sourceDatabaseCredentialsAccepted !== false || profile.boundaries?.freeSqlAccepted !== false || profile.boundaries?.rawSourceRowsReturned !== false || profile.boundaries?.modelMutationAuthority !== false || profile.boundaries?.directSupersetMutationIntentAccepted !== false) fail('consumer profile boundary widened');
if (profile.boundaries?.persistentSupersetWorkflow !== 'trusted-preview-approval-apply-readback-rollback-only') fail('consumer profile workflow mismatch');
if (profile.nonclaims.length !== 3) fail('consumer profile nonclaims mismatch');

const status = await post(request('clean-status', 'status')); verifyEnvelope(status, 'status');
const analysis = await post(request('clean-analyze', 'analyze')); verifyEnvelope(analysis, 'analyze');
if (analysis.result.safety.rawSourceRowsReturned !== false || analysis.result.safety.credentialsReturned !== false) fail('analysis disclosure mismatch');
const discovery = await post(request('clean-discovery', 'discovery', {command: 'start', sessionId: 'cleanroom-v2'})); verifyEnvelope(discovery, 'discovery');
const plan = await post(request('clean-plan', 'plan', {objective: 'Review weekly order value and coverage', receiptId: analysis.result.receiptId})); verifyEnvelope(plan, 'plan');
if (plan.result.graph.acceptedIncumbent !== 'adaptive-v1' || plan.result.authority.persistentActionAllowed !== false) fail('plan authority mismatch');
const preview = await post(request('clean-preview', 'preview', {objective: 'Preview weekly order value and coverage', receiptId: analysis.result.receiptId})); verifyEnvelope(preview, 'preview');
if (preview.result.authority.proposalOnly !== true || preview.result.authority.applyPerformed !== false || preview.result.authority.approvalRequiredBeforePersistence !== true) fail('preview boundary mismatch');
const readback = await post(request('clean-readback', 'readback')); verifyEnvelope(readback, 'readback');
if (readback.result.disclosure.rawSourceRowsReturned !== false || readback.result.disclosure.credentialsReturned !== false || readback.result.disclosure.freeSqlReturned !== false) fail('readback disclosure mismatch');

const denials = [
  request('deny-sql', 'plan', {objective: 'SELECT all orders'}),
  request('deny-apply', 'trusted-apply'),
  request('deny-publish', 'publish'),
  {...request('deny-url', 'plan', {objective: 'Review orders'}), input: {objective: 'Review orders', url: 'http://evil.test'}},
  {...request('deny-rows', 'discovery', {command: 'start', sessionId: 'cleanroom-v2'}), input: {command: 'start', sessionId: 'cleanroom-v2', rawRows: []}},
  {...request('deny-schema', 'status'), schemaVersion: 'superset-bi-agent.external/intent-request/v1'},
];
for (const denial of denials) {
  const result = await post(denial, 400);
  if (result.status !== 'DENIED' || !/^[A-Z0-9_]+$/.test(result.code ?? '')) fail('negative probe did not fail closed');
}

const tampered = structuredClone(preview); tampered.result.authority.applyPerformed = true;
const tamperedBody = Object.fromEntries(Object.entries(tampered).filter(([key]) => key !== 'integrity'));
if (tampered.integrity.digest === digest(tamperedBody)) fail('tamper probe unexpectedly retained digest');

const serialized = JSON.stringify({analysis, discovery, plan, preview, readback});
if (/password|credentialValue|rawRows|Bearer\s+[A-Za-z0-9]/i.test(serialized)) fail('sensitive surface leaked');

process.stdout.write(`${JSON.stringify({
  status: 'PASS',
  productVersion: attestation.product.version,
  contractVersion: attestation.contract.version,
  capabilityCount: attestation.capabilities.length,
  requiredCapabilities: required.length,
  consumerProfileDigest: profile.attestation.digest,
  consumerSupportedCount: profile.supported.length,
  consumerPartialCount: profile.partial.length,
  consumerUnsupportedCount: profile.unsupported.length,
  receiptId: analysis.result.receiptId,
  graphIncumbent: plan.result.graph.acceptedIncumbent,
  previewProposalOnly: preview.result.authority.proposalOnly,
  supersetReadback: readback.result.superset.status,
  negativeProbes: denials.length + 1,
  rawSourceRowsReturned: false,
  credentialsReturned: false,
}, null, 2)}\n`);
