import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  InMemoryEvidenceStore, assertEventEnvelope, assertSafeJson, sha256Digest,
} from '../services/bi-control/src/assistant-foundation/core-contracts.mjs';
import {
  assertCapabilityDescriptor, assertPluginManifest, resolveBuiltInRegistry,
} from '../services/bi-control/src/assistant-foundation/capability-registry.mjs';
import {
  ExecutionController, assertRetryPolicy, createApprovalGrant, createExecutionReceipt,
} from '../services/bi-control/src/assistant-foundation/execution-control.mjs';
import {
  InMemoryDashboardStateAdapter, assertDashboardCapabilityManifest, assertVoiceStreamEvent,
  createPersistentAssetRevisionProposal, createPersonalSavedViewRequest,
} from '../services/bi-control/src/assistant-foundation/ui-state-adapter.mjs';

const fixture = async (name) => JSON.parse(await readFile(`services/bi-control/fixtures/assistant-foundation/${name}`, 'utf8'));
const clone = (value) => structuredClone(value);

test('M6-00 golden schemas and fixtures are versioned and compatible with the runtime contracts', async () => {
  const schemaFiles = ['event-envelope.schema.json', 'agent-process-action.schema.json', 'plugin-manifest.schema.json', 'capability-descriptor.schema.json', 'control-and-ui.schema.json'];
  for (const file of schemaFiles) {
    const schema = JSON.parse(await readFile(`contracts/assistant-foundation/v1/${file}`, 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.match(schema.$id, /assistant-foundation\/v1\//);
  }
  const envelopeSchema = JSON.parse(await readFile('contracts/assistant-foundation/v1/event-envelope.schema.json', 'utf8'));
  const processSchema = JSON.parse(await readFile('contracts/assistant-foundation/v1/agent-process-action.schema.json', 'utf8'));
  assert.equal(envelopeSchema.allOf[0].then.properties.payload.$ref, processSchema.$id);
  assert.match(processSchema.$id, /^https:\/\/kaleidosphere\.local\/contracts\//);
  const event = await fixture('event-envelope-v1.json');
  assert.equal(assertEventEnvelope(event), event);
  const registry = await fixture('static-registry-v1.json');
  const resolved = resolveBuiltInRegistry(registry);
  assert.match(resolved.hash, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(resolved.order, ['assistant-shell']);
  assert.equal(JSON.parse(resolved.dump).schemaVersion, 'chimpmaera.bi/resolved-capability-registry/v1');
  const ui = await fixture('ui-action-v1.json');
  assertDashboardCapabilityManifest(ui.manifest);
  const adapter = new InMemoryDashboardStateAdapter(ui.manifest);
  const receipt = adapter.apply(ui.request);
  assert.equal(receipt.status, 'applied');
  assert.equal(receipt.sideEffect, 'reversible_session');
  assert.equal(adapter.apply(ui.request).status, 'already_applied');
  assert.equal(adapter.undo(receipt.undoToken, receipt.stateVersion).status, 'undone');
  assert.equal(adapter.attempt({ ...ui.request, actionId: 'denied-1', action: 'save_dashboard', idempotencyKey: 'denied-1' }).denialReason, 'UI_ACTION_UNSAFE');
  assertVoiceStreamEvent(await fixture('voice-stream-v1.json'));
});

test('M6-00 policy pipeline consumes one bound grant and emits an observable receipt', () => {
  const args = { action: 'set_filter', key: 'region' };
  const resource = { dashboardId: 'dashboard-demo', stateVersion: 1 };
  const policy = { decision: 'allow', revision: 'p1' };
  const grant = createApprovalGrant({ grantId: 'grant-1', executionId: 'exec-1', capabilityId: 'dashboard-session-actions', args, resource, policy, issuedAt: '2026-08-14T17:00:00.000Z', expiresAt: '2026-08-14T17:10:00.000Z' });
  const controller = new ExecutionController();
  controller.registerGrant(grant);
  assert.equal(controller.authorize({ grantId: grant.grantId, executionId: 'exec-1', capabilityId: 'dashboard-session-actions', args, resource, policy, guards: [{ id: 'risk', mandatory: true, decision: 'allow' }], now: '2026-08-14T17:05:00.000Z' }).authorized, true);
  assert.throws(() => controller.authorize({ grantId: grant.grantId, executionId: 'exec-1', capabilityId: 'dashboard-session-actions', args, resource, policy, guards: [{ id: 'risk', mandatory: true, decision: 'allow' }], now: '2026-08-14T17:05:01.000Z' }), /APPROVAL_GRANT_REPLAY/);
  const receipt = createExecutionReceipt({ executionId: 'exec-1', capabilityId: 'dashboard-session-actions', status: 'succeeded', startedAt: '2026-08-14T17:05:00.000Z', finishedAt: '2026-08-14T17:05:01.000Z', args, resource, policy, sideEffect: 'reversible', idempotencyKey: 'idem-1', observations: [{ stateVersion: 2 }], rollback: { undoToken: 'undo-1', automaticRetry: false } });
  assert.equal(receipt.retryAllowed, false);
  assertRetryPolicy({ schemaVersion: 'chimpmaera.bi/retry-policy/v1', mode: 'bounded', maxAttempts: 2, retryCodes: ['TIMEOUT_BEFORE_DISPATCH'], idempotencyRequired: true, onOutcomeUnknown: 'stop' });
});

test('M6-00 saved-view request and persistent revision proposal remain separate non-applying contracts', () => {
  const saved = createPersonalSavedViewRequest({ requestId: 'view-1', dashboardId: 'dashboard-demo', stateVersion: 2, name: 'EMEA' });
  const proposal = createPersistentAssetRevisionProposal({ proposalId: 'proposal-1', dashboardId: 'dashboard-demo', baseRevision: 'rev-1', diff: { title: { from: 'A', to: 'B' } }, approvalChannel: 'trusted_ui' });
  assert.equal(saved.scope, 'personal');
  assert.equal(saved.persistentSupersetMutation, false);
  assert.equal(proposal.applied, false);
  assert.deepEqual(proposal.requirements, ['preview_diff', 'trusted_ui_approval', 'bi_control_apply', 'readback', 'rollback']);
});

const grantInputs = () => ({
  grantId: 'grant-negative', executionId: 'exec-negative', capabilityId: 'dashboard-session-actions',
  args: { action: 'focus_chart' }, resource: { dashboardId: 'dashboard-demo' }, policy: { revision: 'p1' },
  issuedAt: '2026-08-14T17:00:00.000Z', expiresAt: '2026-08-14T17:10:00.000Z',
});

const negative = [];
negative.push(['unknown required event fails closed', async () => { const event = await fixture('event-envelope-v1.json'); event.eventType = 'future.required'; assertEventEnvelope(event); }, /UNKNOWN_REQUIRED_EVENT/]);
negative.push(['payload digest mismatch', async () => { const event = await fixture('event-envelope-v1.json'); event.payload.text = 'tampered'; assertEventEnvelope(event); }, /EVENT_PAYLOAD_DIGEST_MISMATCH/]);
negative.push(['invalid producer artifact digest', async () => { const event = await fixture('event-envelope-v1.json'); event.version.producer.artifactDigest = 'sha256:bad'; assertEventEnvelope(event); }, /PRODUCER_DIGEST_INVALID/]);
negative.push(['non-monotonic durable sequence', async () => { const event = await fixture('event-envelope-v1.json'); const store = new InMemoryEvidenceStore(); store.append(event); event.eventId = 'evt-0002'; event.seq = 3; store.append(event); }, /EVENT_SEQUENCE_NON_MONOTONIC/]);
negative.push(['unknown causation event', async () => { const event = await fixture('event-envelope-v1.json'); event.causationId = 'evt-missing'; new InMemoryEvidenceStore().append(event); }, /EVENT_CAUSATION_UNKNOWN/]);
negative.push(['cross-correlation causation', async () => { const event = await fixture('event-envelope-v1.json'); const store = new InMemoryEvidenceStore(); store.append(event); const next = clone(event); next.eventId = 'evt-0002'; next.seq = 2; next.causationId = event.eventId; next.correlationId = 'corr-other'; store.append(next); }, /EVENT_CORRELATION_MISMATCH/]);
negative.push(['event id replay', async () => { const event = await fixture('event-envelope-v1.json'); const store = new InMemoryEvidenceStore(); store.append(event); store.append(event); }, /EVENT_ID_REPLAY/]);
negative.push(['secret-shaped payload field', () => assertSafeJson({ accessToken: 'redacted?' }), /SENSITIVE_FIELD_DENIED/]);
negative.push(['secret literal in payload value', () => assertSafeJson({ text: 'Bearer abcdefghijklmnopqrstuvwxyz' }), /SENSITIVE_VALUE_DENIED/]);
negative.push(['source-row payload field', () => assertSafeJson({ sourceRows: [] }), /SENSITIVE_FIELD_DENIED/]);
negative.push(['PII category without redaction', async () => { const event = await fixture('event-envelope-v1.json'); event.sensitivity.categories = ['pii']; assertEventEnvelope(event); }, /EVENT_PII_REDACTION_REQUIRED/]);
negative.push(['unsupported secret sensitivity category', async () => { const event = await fixture('event-envelope-v1.json'); event.sensitivity.categories = ['secret']; assertEventEnvelope(event); }, /EVENT_SENSITIVE_CATEGORY_DENIED/]);
negative.push(['unknown plugin is absent from pinned digest set', async () => { const registry = await fixture('static-registry-v1.json'); resolveBuiltInRegistry({ ...registry, expectedDigests: {} }); }, /PLUGIN_UNKNOWN/]);
negative.push(['plugin artifact digest mismatch', async () => { const registry = await fixture('static-registry-v1.json'); registry.expectedDigests['assistant-shell'] = `sha256:${'0'.repeat(64)}`; resolveBuiltInRegistry(registry); }, /PLUGIN_DIGEST_MISMATCH/]);
negative.push(['runtime install source field', async () => { const registry = await fixture('static-registry-v1.json'); registry.manifests[0].installUrl = 'https://plugins.example/one.js'; assertPluginManifest(registry.manifests[0]); }, /PLUGIN_DYNAMIC_FIELD_DENIED/]);
negative.push(['non-built-in plugin', async () => { const registry = await fixture('static-registry-v1.json'); registry.manifests[0].builtIn = false; assertPluginManifest(registry.manifests[0]); }, /PLUGIN_NOT_BUILT_IN/]);
negative.push(['unknown capability dependency', async () => { const registry = await fixture('static-registry-v1.json'); registry.manifests[0].requires = [{ capabilityId: 'missing-capability', contractVersion: 'v1' }]; resolveBuiltInRegistry(registry); }, /PLUGIN_DEPENDENCY_UNKNOWN/]);
negative.push(['capability contract incompatibility', async () => { const registry = await fixture('static-registry-v1.json'); registry.manifests[0].requires = [{ capabilityId: 'dashboard-session-actions', contractVersion: 'v2' }]; resolveBuiltInRegistry(registry); }, /CAPABILITY_CONTRACT_MISMATCH/]);
negative.push(['capability missing enforcement fact', async () => { const registry = await fixture('static-registry-v1.json'); delete registry.capabilities[0].rollback; assertCapabilityDescriptor(registry.capabilities[0]); }, /CAPABILITY_ENFORCEMENT_FACT_MISSING/]);
negative.push(['plugin dependency cycle', async () => {
  const registry = await fixture('static-registry-v1.json');
  registry.capabilities.push({ ...clone(registry.capabilities[0]), capabilityId: 'voice-stream' });
  registry.manifests[0].requires = [{ capabilityId: 'voice-stream', contractVersion: 'v1' }];
  registry.manifests.push({ ...clone(registry.manifests[0]), pluginId: 'voice-shell', artifactDigest: `sha256:${'1'.repeat(64)}`, provides: [{ capabilityId: 'voice-stream', contractVersion: 'v1' }], requires: [{ capabilityId: 'dashboard-session-actions', contractVersion: 'v1' }] });
  registry.expectedDigests['voice-shell'] = `sha256:${'1'.repeat(64)}`;
  resolveBuiltInRegistry(registry);
}, /PLUGIN_DEPENDENCY_CYCLE/]);
negative.push(['mandatory denial cannot become allow', () => { const inputs = grantInputs(); const grant = createApprovalGrant(inputs); const controller = new ExecutionController(); controller.registerGrant(grant); controller.authorize({ grantId: grant.grantId, executionId: inputs.executionId, capabilityId: inputs.capabilityId, args: inputs.args, resource: inputs.resource, policy: inputs.policy, guards: [{ id: 'deny', mandatory: true, decision: 'deny' }, { id: 'later', mandatory: true, decision: 'allow' }], now: '2026-08-14T17:05:00.000Z' }); }, /MANDATORY_POLICY_DENY/]);
negative.push(['approval replay after consumption', () => { const inputs = grantInputs(); const grant = createApprovalGrant(inputs); const controller = new ExecutionController(); controller.registerGrant(grant); const request = { grantId: grant.grantId, executionId: inputs.executionId, capabilityId: inputs.capabilityId, args: inputs.args, resource: inputs.resource, policy: inputs.policy, guards: [{ id: 'g', mandatory: true, decision: 'allow' }], now: '2026-08-14T17:05:00.000Z' }; controller.authorize(request); controller.authorize(request); }, /APPROVAL_GRANT_REPLAY/]);
negative.push(['approval argument binding mismatch', () => { const inputs = grantInputs(); const grant = createApprovalGrant(inputs); const controller = new ExecutionController(); controller.registerGrant(grant); controller.authorize({ grantId: grant.grantId, executionId: inputs.executionId, capabilityId: inputs.capabilityId, args: { changed: true }, resource: inputs.resource, policy: inputs.policy, guards: [{ id: 'g', mandatory: true, decision: 'allow' }], now: '2026-08-14T17:05:00.000Z' }); }, /APPROVAL_BINDING_MISMATCH/]);
negative.push(['approval resource binding mismatch', () => { const inputs = grantInputs(); const grant = createApprovalGrant(inputs); const controller = new ExecutionController(); controller.registerGrant(grant); controller.authorize({ grantId: grant.grantId, executionId: inputs.executionId, capabilityId: inputs.capabilityId, args: inputs.args, resource: { dashboardId: 'other' }, policy: inputs.policy, guards: [{ id: 'g', mandatory: true, decision: 'allow' }], now: '2026-08-14T17:05:00.000Z' }); }, /APPROVAL_BINDING_MISMATCH/]);
negative.push(['approval policy binding mismatch', () => { const inputs = grantInputs(); const grant = createApprovalGrant(inputs); const controller = new ExecutionController(); controller.registerGrant(grant); controller.authorize({ grantId: grant.grantId, executionId: inputs.executionId, capabilityId: inputs.capabilityId, args: inputs.args, resource: inputs.resource, policy: { revision: 'p2' }, guards: [{ id: 'g', mandatory: true, decision: 'allow' }], now: '2026-08-14T17:05:00.000Z' }); }, /APPROVAL_BINDING_MISMATCH/]);
negative.push(['approval scope mismatch', () => { const inputs = grantInputs(); const grant = createApprovalGrant(inputs); const controller = new ExecutionController(); controller.registerGrant(grant); controller.authorize({ grantId: grant.grantId, executionId: 'other-execution', capabilityId: inputs.capabilityId, args: inputs.args, resource: inputs.resource, policy: inputs.policy, guards: [{ id: 'g', mandatory: true, decision: 'allow' }], now: '2026-08-14T17:05:00.000Z' }); }, /APPROVAL_SCOPE_MISMATCH/]);
negative.push(['expired approval', () => { const inputs = grantInputs(); const grant = createApprovalGrant(inputs); const controller = new ExecutionController(); controller.registerGrant(grant); controller.authorize({ grantId: grant.grantId, executionId: inputs.executionId, capabilityId: inputs.capabilityId, args: inputs.args, resource: inputs.resource, policy: inputs.policy, guards: [{ id: 'g', mandatory: true, decision: 'allow' }], now: '2026-08-14T17:11:00.000Z' }); }, /APPROVAL_GRANT_EXPIRED/]);
negative.push(['voice approval grant creation', () => createApprovalGrant({ ...grantInputs(), channel: 'voice' }), /APPROVAL_TRUSTED_UI_REQUIRED/]);
negative.push(['retry-always policy', () => assertRetryPolicy({ schemaVersion: 'chimpmaera.bi/retry-policy/v1', mode: 'always', maxAttempts: 99 }), /RETRY_POLICY_INVALID/]);
negative.push(['retry budget above bound', () => assertRetryPolicy({ schemaVersion: 'chimpmaera.bi/retry-policy/v1', mode: 'bounded', maxAttempts: 4, retryCodes: ['TRANSPORT'], idempotencyRequired: true, onOutcomeUnknown: 'stop' }), /RETRY_BUDGET_INVALID/]);
negative.push(['unsafe retry code', () => assertRetryPolicy({ schemaVersion: 'chimpmaera.bi/retry-policy/v1', mode: 'bounded', maxAttempts: 2, retryCodes: ['SIDE_EFFECT_UNKNOWN'], idempotencyRequired: true, onOutcomeUnknown: 'stop' }), /RETRY_CODE_DENIED/]);
negative.push(['retry without idempotency requirement', () => assertRetryPolicy({ schemaVersion: 'chimpmaera.bi/retry-policy/v1', mode: 'bounded', maxAttempts: 2, retryCodes: ['TRANSPORT'], idempotencyRequired: false, onOutcomeUnknown: 'stop' }), /RETRY_SIDE_EFFECT_SAFETY_REQUIRED/]);
negative.push(['outcome-unknown blind retry', () => createExecutionReceipt({ executionId: 'e', capabilityId: 'c', status: 'outcome_unknown', startedAt: '2026-08-14T17:00:00Z', finishedAt: '2026-08-14T17:00:01Z', args: {}, resource: {}, policy: {}, sideEffect: 'persistent', idempotencyKey: 'i', rollback: { automaticRetry: true } }), /OUTCOME_UNKNOWN_BLIND_RETRY_DENIED/]);
negative.push(['unsafe UI action', async () => { const ui = await fixture('ui-action-v1.json'); new InMemoryDashboardStateAdapter(ui.manifest).apply({ ...ui.request, action: 'save_dashboard' }); }, /UI_ACTION_UNSAFE/]);
negative.push(['stale dashboard state', async () => { const ui = await fixture('ui-action-v1.json'); const adapter = new InMemoryDashboardStateAdapter(ui.manifest); adapter.apply(ui.request); adapter.apply({ ...ui.request, actionId: 'action-2', idempotencyKey: 'idem-2' }); }, /DASHBOARD_STATE_STALE/]);
negative.push(['dashboard precondition mismatch', async () => { const ui = await fixture('ui-action-v1.json'); new InMemoryDashboardStateAdapter(ui.manifest).apply({ ...ui.request, preconditions: { dashboardId: 'other' } }); }, /UI_ACTION_PRECONDITION_FAILED/]);
negative.push(['dashboard manifest resource escape', async () => { const ui = await fixture('ui-action-v1.json'); new InMemoryDashboardStateAdapter(ui.manifest).apply({ ...ui.request, action: 'focus_chart', args: { chartId: 'chart-not-in-manifest' } }); }, /UI_ACTION_RESOURCE_DENIED/]);
negative.push(['UI idempotency key reused for different request', async () => { const ui = await fixture('ui-action-v1.json'); const adapter = new InMemoryDashboardStateAdapter(ui.manifest); adapter.apply(ui.request); adapter.apply({ ...ui.request, args: { key: 'region', value: 'APAC' } }); }, /UI_ACTION_IDEMPOTENCY_MISMATCH/]);
negative.push(['persistent dashboard capability manifest', async () => { const ui = await fixture('ui-action-v1.json'); assertDashboardCapabilityManifest({ ...ui.manifest, persistentMutationAllowed: true }); }, /DASHBOARD_MUTATION_BOUNDARY_INVALID/]);
negative.push(['voice-only persistent proposal approval', () => createPersistentAssetRevisionProposal({ proposalId: 'p', dashboardId: 'd', baseRevision: 'r', diff: {}, approvalChannel: 'voice' }), /VOICE_ONLY_PERSISTENT_APPROVAL_DENIED/]);
negative.push(['chain-of-thought voice payload', async () => { const voice = await fixture('voice-stream-v1.json'); voice.payload = { chainOfThought: 'hidden reasoning' }; assertVoiceStreamEvent(voice); }, /SENSITIVE_FIELD_DENIED/]);
negative.push(['invalid voice confidence', async () => { const voice = await fixture('voice-stream-v1.json'); voice.confidence = 1.1; assertVoiceStreamEvent(voice); }, /VOICE_METADATA_INVALID/]);
negative.push(['PII-shaped UI action argument', async () => { const ui = await fixture('ui-action-v1.json'); ui.request.args = { email: 'person@example.test' }; new InMemoryDashboardStateAdapter(ui.manifest).apply(ui.request); }, /SENSITIVE_FIELD_DENIED/]);

for (const [name, run, expected] of negative) {
  test(`M6-00 negative probe: ${name}`, async () => { await assert.rejects(async () => run(), expected); });
}

test('M6-00 contains at least 25 distinct fail-closed probes', () => assert.ok(negative.length >= 25, `${negative.length} probes`));

// KS321: authored SYNTHETIC fixture, not a PAN runtime export or original ZIP.
const syntheticProcessEvent = async () => {
  const event = await fixture('event-envelope-v1.json');
  event.eventType = 'pan.workspace.action.observed';
  event.version.contract = 'workspace-action-observation';
  event.payload = {
    schemaVersion: 'kaleidosphere.agent-process/action-observation/v1',
    scope: { tenantId: 'synthetic-tenant', principalDigest: 'c'.repeat(64), privacyEpoch: 1 },
    source: { sourceId: 'pan548.signed-native-context-outbox/v1', sourceEpoch: 'a'.repeat(64),
      eventDigest: 'b'.repeat(64), sourceTimeMs: null },
    action: { taskId: 'invocation:synthetic', stepId: 'step:synthetic', attempt: 1,
      capability: 'pan.workspace.view.preview/v1', taskRevision: 1 },
    mode: 'PREVIEW', phase: 'UNKNOWN', result: null, readbackRef: null,
    processFacts: 'NOT_OBSERVED', humanFacts: 'NOT_OBSERVED', grantFacts: 'NOT_OBSERVED',
  };
  event.payloadDigest = sha256Digest(event.payload);
  return event;
};

test('KS321 registers only the concrete Preview/Display observation at the real envelope validator', async () => {
  const event = await syntheticProcessEvent();
  assert.doesNotThrow(() => assertEventEnvelope(event));
  assert.equal(new InMemoryEvidenceStore().append(event).payload.phase, 'UNKNOWN');
  event.eventType = 'pan.agent.anything';
  assert.throws(() => assertEventEnvelope(event), /UNKNOWN_REQUIRED_EVENT/);
});

test('KS321 rejects extra envelope fields and unobserved or inconsistent process facts', async () => {
  const changes = [
    e => { e.extra = true; },
    e => { e.version.extra = true; },
    e => { e.version.producer.extra = true; },
    e => { e.sensitivity.extra = true; },
    e => { e.payload.extra = true; },
    e => { e.payload.scope.extra = true; },
    e => { e.payload.source.extra = true; },
    e => { e.payload.action.extra = true; },
    e => { e.payload.action.attempt = '1'; },
    e => { e.payload.source.sourceTimeMs = -1; },
    e => { e.payload.mode = 'SIMULATION'; },
    e => { e.payload.phase = 'DISPATCHED'; },
    e => { e.payload.phase = 'RESULT_CONFIRMED'; },
    e => { e.payload.grantFacts = 'GRANTED'; },
    e => { e.payload.action.capability = 'pan.workspace.send/v1'; },
    e => { e.payload.mode = 'DISPLAY'; },
    e => { e.version.contract = 'pan.agent'; },
    e => { e.channel = 'live'; },
    e => { e.ignorable = true; },
  ];
  for (const change of changes) {
    const event = await syntheticProcessEvent();
    change(event);
    event.payloadDigest = sha256Digest(event.payload);
    assert.throws(() => assertEventEnvelope(event), /EVENT_CLOSED_SHAPE_DENIED|PROCESS_.*DENIED/, change.toString());
  }
});

const syntheticInboxBinding = event => ({
  scope: structuredClone(event.payload.scope),
  sourceId: event.payload.source.sourceId, sourceEpoch: event.payload.source.sourceEpoch,
  streamId: event.streamId, producer: structuredClone(event.version.producer),
});

test('KS322 opt-in evidence owner retains the acknowledged synthetic import after reopen', async t => {
  const root = mkdtempSync(join(tmpdir(), 'ks322-reopen-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const event = await syntheticProcessEvent();
  const options = { agentProcess: { stateRoot: root, binding: syntheticInboxBinding(event), authorizeRead: () => true, maxEvents: 128 } };
  const store = new InMemoryEvidenceStore(options);
  store.append(event);
  // No close method exists on the historical memory owner. Optional cleanup
  // keeps this initial RED on actual lost evidence, not an absent-method error.
  store.close?.();
  const reopened = new InMemoryEvidenceStore(options);
  t.after(() => reopened.close?.());
  assert.deepEqual(reopened.durableEvents(), [event], 'acknowledged event must survive a real owner reopen');
});

async function syntheticInbox(t, maxEvents = 128) {
  const root = mkdtempSync(join(tmpdir(), 'ks322-inbox-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const event = await syntheticProcessEvent();
  const binding = syntheticInboxBinding(event);
  const store = new InMemoryEvidenceStore({ agentProcess: { stateRoot: root, binding, authorizeRead: () => true, maxEvents } });
  t.after(() => store.close());
  return { store, event, root, binding };
}

test('KS322 exact duplicate bytes acknowledge once and conflicting bytes never overwrite', async t => {
  const { store, event } = await syntheticInbox(t);
  const bytes = Buffer.from(JSON.stringify(event));
  const first = store.importBytes(bytes);
  assert.equal(first.status, 'IMPORTED');
  assert.equal(first.persisted, true);
  let duplicate;
  assert.doesNotThrow(() => { duplicate = store.importBytes(bytes); });
  assert.equal(duplicate.status, 'DUPLICATE');
  assert.equal(duplicate.count, 1);
  assert.equal(duplicate.rawSha256, first.rawSha256);
  assert.throws(() => store.importBytes(Buffer.from(JSON.stringify(event, null, 2))), /PROCESS_ID_COLLISION_DENIED/);
  const changed = structuredClone(event);
  changed.payload.source.sourceTimeMs = 123;
  changed.payloadDigest = sha256Digest(changed.payload);
  assert.throws(() => store.importBytes(Buffer.from(JSON.stringify(changed))), /PROCESS_ID_COLLISION_DENIED/);
  assert.deepEqual(store.durableEvents(), [event]);
});

test('KS322 sequence gap is explicit, unacknowledged and does not advance the accepted prefix', async t => {
  const { store, event } = await syntheticInbox(t);
  store.importBytes(Buffer.from(JSON.stringify(event)));
  const third = { ...structuredClone(event), eventId: 'evt-0003', seq: 3 };
  let gap;
  assert.doesNotThrow(() => { gap = store.importBytes(Buffer.from(JSON.stringify(third))); });
  assert.deepEqual(gap, { status: 'GAP', persisted: false, count: 1, expectedSequence: 2, receivedSequence: 3 });
  assert.deepEqual(store.durableEvents(), [event]);
  assert.throws(() => store.append(third), /PROCESS_SEQUENCE_GAP/);
  const second = { ...structuredClone(event), eventId: 'evt-0002', seq: 2 };
  assert.equal(store.importBytes(Buffer.from(JSON.stringify(second))).status, 'IMPORTED');
  assert.equal(store.importBytes(Buffer.from(JSON.stringify(third))).status, 'IMPORTED');
  const collision = { ...structuredClone(second), eventId: 'evt-other' };
  assert.throws(() => store.importBytes(Buffer.from(JSON.stringify(collision))), /PROCESS_SEQUENCE_COLLISION_DENIED/);
  assert.deepEqual(store.durableEvents(), [event, second, third]);
});

test('KS322 foreign tenant, principal, epoch or substituted producer stays denied despite recomputed caller hashes', async t => {
  const { store, event } = await syntheticInbox(t);
  const changes = [
    e => { e.payload.scope.tenantId = 'foreign'; },
    e => { e.payload.scope.principalDigest = 'd'.repeat(64); },
    e => { e.payload.scope.privacyEpoch = 2; },
    e => { e.payload.source.sourceEpoch = 'd'.repeat(64); },
    e => { e.version.producer.artifactDigest = `sha256:${'d'.repeat(64)}`; },
    e => { e.version.producer.id = 'foreign-producer'; },
    e => { e.streamId = 'foreign-stream'; },
  ];
  for (const change of changes) {
    const foreign = structuredClone(event);
    change(foreign);
    foreign.payloadDigest = sha256Digest(foreign.payload);
    assert.throws(() => store.importBytes(Buffer.from(JSON.stringify(foreign))), /PROCESS_SOURCE_SCOPE_DENIED/);
    assert.deepEqual(store.durableEvents(), []);
  }
  store.importBytes(Buffer.from(JSON.stringify(event)));
  assert.deepEqual(store.durableEvents(), [event]);
});

test('KS322 current read scope gates import, duplicate, cached read and reopen without changing persisted facts', async t => {
  const root = mkdtempSync(join(tmpdir(), 'ks322-current-scope-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const event = await syntheticProcessEvent();
  let allowed = true;
  const binding = syntheticInboxBinding(event);
  const options = { agentProcess: { stateRoot: root, binding, authorizeRead: () => allowed, maxEvents: 128 } };
  const store = new InMemoryEvidenceStore(options);
  t.after(() => store.close());
  const bytes = Buffer.from(JSON.stringify(event));
  store.importBytes(bytes);
  allowed = false;
  assert.throws(() => store.importBytes(bytes), /PROCESS_CURRENT_SCOPE_DENIED/);
  assert.throws(() => store.durableEvents(), /PROCESS_CURRENT_SCOPE_DENIED/);
  assert.throws(() => store.liveEvents(), /PROCESS_CURRENT_SCOPE_DENIED/);
  assert.throws(() => new InMemoryEvidenceStore(options), /PROCESS_CURRENT_SCOPE_DENIED/);
  allowed = true;
  binding.scope.tenantId = 'foreign';
  // Original configuration mutation cannot retarget the already opened owner.
  assert.deepEqual(store.durableEvents(), [event]);
  assert.throws(() => new InMemoryEvidenceStore(options), /PROCESS_BINDING_DRIFT_DENIED/);
  binding.scope.tenantId = event.payload.scope.tenantId;
  binding.scope.privacyEpoch++;
  assert.throws(() => new InMemoryEvidenceStore(options), /PROCESS_BINDING_DRIFT_DENIED/);
});

test('KS322 bounded capacity denies additional evidence but retains duplicate acknowledgement and UNKNOWN', async t => {
  const { store, event } = await syntheticInbox(t, 1);
  const bytes = Buffer.from(JSON.stringify(event));
  store.importBytes(bytes);
  assert.equal(store.importBytes(bytes).status, 'DUPLICATE');
  assert.throws(() => store.importBytes(Buffer.from(JSON.stringify({ ...event, eventId: 'evt-0002', seq: 2 }))), /PROCESS_CAPACITY_DENIED/);
  assert.deepEqual(store.durableEvents(), [event]);
  assert.equal(store.durableEvents()[0].payload.source.sourceTimeMs, null);
  assert.equal(store.durableEvents()[0].payload.phase, 'UNKNOWN');
  for (const bytes of [Buffer.alloc(65537), Buffer.from([0xff]), Buffer.from('{'), Buffer.from('\ufeff{}')]) {
    assert.throws(() => store.importBytes(bytes), /PROCESS_BYTES_DENIED/);
  }
});

test('KS322 fresh Node process reads the exact persisted synthetic import and deduplicates after restart', async t => {
  const { store, event, root, binding } = await syntheticInbox(t);
  const bytes = Buffer.from(JSON.stringify(event));
  const ack = store.importBytes(bytes);
  store.close();
  const moduleUrl = new URL('../services/bi-control/src/assistant-foundation/core-contracts.mjs', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { readFileSync } from 'node:fs';
    import { InMemoryEvidenceStore } from ${JSON.stringify(moduleUrl)};
    const input = JSON.parse(readFileSync(0, 'utf8'));
    const store = new InMemoryEvidenceStore({agentProcess: {...input.options, authorizeRead: () => true}});
    try { console.log(JSON.stringify({events: store.durableEvents(), duplicate: store.importBytes(Buffer.from(input.bytes, 'base64'))})); }
    finally { store.close(); }
  `], { input: JSON.stringify({ options: { stateRoot: root, binding, maxEvents: 128 }, bytes: bytes.toString('base64') }), encoding: 'utf8', timeout: 10000 });
  assert.equal(child.status, 0, child.stderr);
  const readback = JSON.parse(child.stdout);
  assert.deepEqual(readback.events, [event]);
  assert.equal(readback.duplicate.status, 'DUPLICATE');
  assert.equal(readback.duplicate.count, 1);
  assert.equal(readback.duplicate.rawSha256, ack.rawSha256);
});

test('KS321 synthetic Preview/Display confirmations require matching existing proof and readback references', async () => {
  for (const [mode, capability, resultPhase, proofKind] of [
    ['PREVIEW', 'pan.workspace.view.preview/v1', 'PREVIEW_VALIDATED', 'PAN546_PREVIEW_VALIDATED'],
    ['DISPLAY', 'pan.workspace.document.display/v2', 'DOCUMENT_ACCEPTED', 'PAN597_DOCUMENT_ACCEPTED'],
  ]) {
    const event = await syntheticProcessEvent();
    Object.assign(event.payload, { mode, phase: 'RESULT_CONFIRMED', readbackRef: event.payload.action.taskId,
      result: { resultPhase, proofRef: `context-proof:${'d'.repeat(64)}`, proofKind } });
    event.payload.action.capability = capability;
    event.payloadDigest = sha256Digest(event.payload);
    assert.doesNotThrow(() => assertEventEnvelope(event));
    event.payload.readbackRef = null;
    event.payloadDigest = sha256Digest(event.payload);
    assert.throws(() => assertEventEnvelope(event), /PROCESS_PAYLOAD_DENIED/);
  }
});

test('KS322 object append validates closed descriptors before encoding untrusted input', async t => {
  const { store, event } = await syntheticInbox(t);
  let getters = 0;
  const payload = event.payload;
  Object.defineProperty(event, 'payload', { enumerable: true, get() { getters++; return payload; } });
  assert.throws(() => store.append(event), /EVENT_CLOSED_SHAPE_DENIED/);
  assert.equal(getters, 0);
  assert.deepEqual(store.durableEvents(), []);
});

for (const revoked of [false, true]) {
  test(`KS322 R1 object append denies an own array-index getter without execution (${revoked ? 'read revoked' : 'read allowed'})`, async t => {
    const root = mkdtempSync(join(tmpdir(), 'ks322-array-descriptor-'));
    const event = await syntheticProcessEvent();
    const plain = structuredClone(event);
    let allowed = true;
    const options = { agentProcess: { stateRoot: root, binding: syntheticInboxBinding(event), authorizeRead: () => allowed, maxEvents: 128 } };
    const store = new InMemoryEvidenceStore(options);
    t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
    let getterCalls = 0;
    Object.defineProperty(event.sensitivity.categories, '0', {
      enumerable: true, configurable: true, get() { getterCalls++; return 'none'; },
    });
    allowed = !revoked;
    let acknowledgement, denial;
    try { acknowledgement = store.append(event); } catch (error) { denial = error; }
    assert.equal(getterCalls, 0, 'descriptor denial must precede every category read or encoding');
    assert.equal(acknowledgement, undefined, 'accessor input must never produce an ACK');
    assert.equal(denial?.code, 'EVENT_CLOSED_SHAPE_DENIED');
    allowed = true;
    assert.deepEqual(store.durableEvents(), [], 'rejected object must not persist an event');
    store.close();
    const reopened = new InMemoryEvidenceStore(options);
    try {
      assert.deepEqual(reopened.durableEvents(), [], 'reopen must confirm the empty persisted prefix');
      assert.deepEqual(reopened.append(plain), plain, 'ordinary data arrays remain accepted');
      assert.deepEqual(reopened.durableEvents(), [plain]);
    } finally { reopened.close(); }
  });
}

// KS323: every record and expected value below is authored SYNTHETIC data.
// No PAN producer/readback, independent remote clock or business effect is claimed.
async function syntheticMetricEvents(specs) {
  const base = await syntheticProcessEvent();
  return specs.map((spec, index) => {
    const event = structuredClone(base), taskId = `invocation:SYNTHETIC-${spec.action}`;
    Object.assign(event, { eventId: `ks323:SYNTHETIC-${spec.id}`, seq: index + 1,
      correlationId: spec.correlation ?? `correlation:SYNTHETIC-${spec.action}`,
      causationId: spec.cause ? `ks323:SYNTHETIC-${spec.cause}` : null,
      occurredAt: spec.observedAt ?? '2099-01-01T00:00:00.000Z' });
    const mode = spec.mode ?? 'PREVIEW', phase = spec.phase;
    Object.assign(event.payload, { mode, phase, readbackRef: phase === 'RESULT_CONFIRMED' ? spec.readback ?? taskId : null,
      result: phase === 'RESULT_CONFIRMED' ? {
        resultPhase: mode === 'PREVIEW' ? 'PREVIEW_VALIDATED' : 'DOCUMENT_ACCEPTED',
        proofRef: `context-proof:${sha256Digest({ syntheticProof: spec.action }).slice(7)}`,
        proofKind: spec.proofKind ?? (mode === 'PREVIEW' ? 'PAN546_PREVIEW_VALIDATED' : 'PAN597_DOCUMENT_ACCEPTED'),
      } : null });
    event.payload.source.eventDigest = sha256Digest({ syntheticSourceFact: spec.fact ?? spec.id }).slice(7);
    event.payload.source.sourceTimeMs = spec.time ?? null;
    event.payload.action = { taskId, stepId: `step:SYNTHETIC-${spec.action}`, attempt: spec.attempt ?? 1,
      capability: mode === 'PREVIEW' ? 'pan.workspace.view.preview/v1' : 'pan.workspace.document.display/v2',
      taskRevision: Object.hasOwn(spec, 'revision') ? spec.revision : phase === 'RESULT_CONFIRMED' ? 2 : 1 };
    event.payloadDigest = sha256Digest(event.payload);
    return event;
  });
}

const syntheticPositiveMetricSpecs = [
  { id: 'p-proposed', action: 'preview', phase: 'PROPOSED', attempt: 0, revision: null, time: 900 },
  { id: 'p-pending', action: 'preview', phase: 'PENDING', time: 1000 },
  { id: 'p-result', action: 'preview', phase: 'RESULT_CONFIRMED', time: 1450, cause: 'p-pending' },
  { id: 'p-poll', action: 'preview', phase: 'RESULT_CONFIRMED', time: 1450, cause: 'p-pending', fact: 'p-result' },
  { id: 'd-pending', action: 'display', mode: 'DISPLAY', phase: 'PENDING', time: 2000 },
  { id: 'd-result', action: 'display', mode: 'DISPLAY', phase: 'RESULT_CONFIRMED', time: 2600, cause: 'd-pending' },
  { id: 'd-render', action: 'display', mode: 'DISPLAY', phase: 'RESULT_CONFIRMED', time: 3000, cause: 'd-result', proofKind: 'PAN597_DOCUMENT_RENDERED' },
  { id: 'u-pending', action: 'unknown', phase: 'PENDING', time: 4000 },
  { id: 'u-result', action: 'unknown', phase: 'UNKNOWN', revision: 2, time: 4200, cause: 'u-pending' },
  { id: 'u-poll', action: 'unknown', phase: 'UNKNOWN', revision: 2, time: 4200, cause: 'u-pending', fact: 'u-result' },
];

// Independently fixed before implementation; 450/600ms are reported phase spans,
// never an execution-latency estimate. Missing duration is null + UNKNOWN reason.
const SYNTHETIC_POSITIVE_METRICS = {
  confirmed: 2, unknown: 1,
  durations: [['invocation:SYNTHETIC-preview', 450, null], ['invocation:SYNTHETIC-display', 600, null],
    ['invocation:SYNTHETIC-unknown', null, 'OUTCOME_UNKNOWN']],
};
const metricNumbers = value => value && ({ confirmed: value.confirmedResults.value, unknown: value.unknownOutcomes.value,
  durations: value.actionDurations.values.map(item => [item.taskId, item.value, item.reason]) });

test('KS323 SYNTHETIC durable M1 has fixed independent counts/spans after COMMIT and reopen, without duplicate counting', async t => {
  const { store, root, binding } = await syntheticInbox(t);
  const events = await syntheticMetricEvents(syntheticPositiveMetricSpecs);
  for (const [index, event] of events.entries()) {
    const ack = store.importBytes(Buffer.from(JSON.stringify(event)));
    assert.equal(ack.status, 'IMPORTED');
    assert.equal(ack.persisted, true);
    assert.equal(ack.count, index + 1);
  }
  store.close();
  const reopened = new InMemoryEvidenceStore({ agentProcess: { stateRoot: root, binding, authorizeRead: () => true, maxEvents: 128 } });
  t.after(() => reopened.close());
  assert.deepEqual(reopened.durableEvents(), events);
  const request = { requiredThroughSequence: events.length };
  // The new owner read API is introduced by this slice. Optional invocation keeps
  // the initial RED an expected-number AssertionError, not a missing-method error.
  const metrics = reopened.processMetrics?.(request);
  assert.deepEqual(metricNumbers(metrics), SYNTHETIC_POSITIVE_METRICS);
  for (const event of events) assert.equal(reopened.importBytes(Buffer.from(JSON.stringify(event))).status, 'DUPLICATE');
  assert.deepEqual(reopened.processMetrics(request), metrics);
  assert.deepEqual(reopened.durableEvents(), events, 'calculation never appends or changes evidence');
});

test('KS323 SYNTHETIC negative expected set separates UNKNOWN and missing time/readback/render/unattempted facts', async t => {
  const { store } = await syntheticInbox(t);
  const events = await syntheticMetricEvents([
    { id: 'n-pending', action: 'no-time', phase: 'PENDING', time: null },
    { id: 'n-result', action: 'no-time', phase: 'RESULT_CONFIRMED', time: 1450, cause: 'n-pending' },
    { id: 'n-unknown', action: 'unknown', phase: 'UNKNOWN', time: null },
    { id: 'n-wrong-start', action: 'wrong-readback', phase: 'PENDING', time: 2000 },
    { id: 'n-wrong-result', action: 'wrong-readback', phase: 'RESULT_CONFIRMED', time: 2600, cause: 'n-wrong-start', readback: 'invocation:SYNTHETIC-other' },
    { id: 'n-render', action: 'render-only', mode: 'DISPLAY', phase: 'RESULT_CONFIRMED', time: 3000, proofKind: 'PAN597_DOCUMENT_RENDERED' },
    { id: 'n-unattempted', action: 'unattempted', phase: 'UNKNOWN', attempt: 0, revision: null, time: null },
  ]);
  for (const event of events) store.append(event);
  const metrics = store.processMetrics?.({ requiredThroughSequence: events.length });
  assert.deepEqual(metricNumbers(metrics), { confirmed: 1, unknown: 1, durations: [
    ['invocation:SYNTHETIC-no-time', null, 'OWNER_TIME_UNAVAILABLE'], ['invocation:SYNTHETIC-unknown', null, 'OUTCOME_UNKNOWN'],
    ['invocation:SYNTHETIC-wrong-readback', null, 'READBACK_UNMATCHED'], ['invocation:SYNTHETIC-render-only', null, 'RENDER_ONLY'],
    ['invocation:SYNTHETIC-unattempted', null, 'NOT_ATTEMPTED'],
  ] });
});

test('KS323 every SYNTHETIC number carries formula unit prefix sources exclusions and nonclaims without a payload dump', async t => {
  const { store, binding } = await syntheticInbox(t);
  const events = await syntheticMetricEvents(syntheticPositiveMetricSpecs);
  events.forEach(event => store.append(event));
  const result = store.processMetrics();
  assert.deepEqual(result.input.binding, binding);
  assert.equal(result.input.status, 'COMMITTED_PREFIX');
  assert.equal(result.input.sourceHead, 'NOT_ATTESTED');
  assert.match(result.input.inputStateDigest, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(result.input.eventIds, events.map(event => event.eventId));
  for (const metric of [result.confirmedResults, result.unknownOutcomes, result.actionDurations]) {
    assert.ok(metric.formula.length > 20);
    assert.equal(metric.inputStateDigest, result.input.inputStateDigest);
    assert.ok(Array.isArray(metric.exclusions));
    for (const exclusion of metric.exclusions) for (const source of exclusion.sources) assert.ok(result.input.eventIds.includes(source));
  }
  assert.equal(result.confirmedResults.unit, 'RESULT_COUNT');
  assert.equal(result.unknownOutcomes.unit, 'OUTCOME_COUNT');
  assert.equal(result.actionDurations.unit, 'MILLISECOND');
  for (const span of result.actionDurations.values) {
    assert.equal(span.inputStateDigest, result.input.inputStateDigest);
    assert.match(span.actionKeyDigest, /^sha256:[a-f0-9]{64}$/);
    for (const id of span.sources) assert.ok(result.input.eventIds.includes(id));
    assert.equal(span.status, span.value === null ? 'UNKNOWN' : 'OBSERVED_SOURCE_SPAN');
  }
  assert.ok(result.nonclaims.includes('NO_INDEPENDENT_CLOCK_ATTESTATION'));
  assert.ok(result.nonclaims.includes('RECORDED_PROOF_AND_READBACK_REFS_NOT_REVERIFIED_PAN'));
  assert.equal(JSON.stringify(result).includes('"payload"'), false);
  assert.equal(JSON.stringify(result).includes('occurredAt'), false);
  result.confirmedResults.value = 999;
  result.input.binding.scope.tenantId = 'SYNTHETIC-caller-mutation';
  assert.equal(store.processMetrics().confirmedResults.value, 2);
  assert.deepEqual(store.processMetrics().input.binding, binding);
  assert.deepEqual(store.durableEvents(), events);
});

test('KS323 SYNTHETIC owner endpoint negatives stay UNKNOWN while a genuinely recorded zero remains zero', async t => {
  const start = { id: 'start', action: 'span', phase: 'PENDING', time: 1000 };
  const end = { id: 'end', action: 'span', phase: 'RESULT_CONFIRMED', time: 1450, cause: 'start' };
  const cases = [
    [[start, { ...end, time: null }], 'OWNER_TIME_UNAVAILABLE', null, 1],
    [[start, { ...end, time: 900 }], 'OWNER_TIME_REVERSED', null, 1],
    [[start, { ...end, revision: 1 }], 'OWNER_REVISION_UNMATCHED', null, 1],
    [[start, { ...end, cause: null }], 'UNMATCHED_OWNER_ENDPOINTS', null, 1],
    [[{ ...end, cause: null }], 'START_NOT_RECORDED', null, 1],
    [[start, end, { ...end, id: 'another-end', time: 1600 }], 'AMBIGUOUS_OWNER_ENDPOINTS', null, 1],
    [[start, { ...start, id: 'another-start', time: 1200 }, end], 'AMBIGUOUS_OWNER_ENDPOINTS', null, 1],
    [[start, { ...end, fact: 'start' }], 'SOURCE_FACT_CONFLICT', null, 0],
    [[start, { ...end, correlation: 'correlation:SYNTHETIC-other', cause: null }], 'ACTION_LINEAGE_UNMATCHED', null, 0],
    [[start, { ...end, time: 1000 }], null, 0, 1],
  ];
  for (const [specs, reason, value, confirmed] of cases) {
    const { store } = await syntheticInbox(t);
    const events = await syntheticMetricEvents(specs);
    events.forEach(event => store.append(event));
    const metrics = store.processMetrics();
    assert.equal(metrics.confirmedResults.value, confirmed, String(reason));
    assert.equal(metrics.unknownOutcomes.value, 0);
    assert.equal(metrics.actionDurations.values[0].reason, reason);
    assert.equal(metrics.actionDurations.values[0].value, value);
  }
});

test('KS323 SYNTHETIC gap or incomplete required prefix yields UNKNOWN not zero and recomputes after real reopen/fill', async t => {
  const { store, root, binding } = await syntheticInbox(t);
  const [start, end] = await syntheticMetricEvents([
    { id: 'gap-start', action: 'gap', phase: 'PENDING', time: 1000 },
    { id: 'gap-end', action: 'gap', phase: 'RESULT_CONFIRMED', time: 1450, cause: 'gap-start' },
  ]);
  end.seq = 3;
  store.append(start);
  assert.equal(store.importBytes(Buffer.from(JSON.stringify(end))).status, 'GAP');
  const request = { requiredThroughSequence: 3 }, incomplete = store.processMetrics(request);
  assert.equal(incomplete.input.status, 'INCOMPLETE_PREFIX');
  assert.equal(incomplete.input.throughSequence, 1);
  assert.equal(incomplete.confirmedResults.value, null);
  assert.equal(incomplete.unknownOutcomes.value, null);
  assert.equal(incomplete.confirmedResults.status, 'UNKNOWN');
  assert.equal(incomplete.actionDurations.values[0].value, null);
  assert.equal(incomplete.actionDurations.values[0].reason, 'REQUIRED_PREFIX_MISSING');
  store.close();
  const reopened = new InMemoryEvidenceStore({ agentProcess: { stateRoot: root, binding, authorizeRead: () => true, maxEvents: 128 } });
  t.after(() => reopened.close());
  assert.deepEqual(reopened.processMetrics(request), incomplete);
  const [filler] = await syntheticMetricEvents([{ id: 'gap-fill', action: 'not-attempted', phase: 'PROPOSED', attempt: 0, revision: null }]);
  filler.seq = 2;
  reopened.append(filler);
  reopened.append(end);
  const complete = reopened.processMetrics(request);
  assert.equal(complete.input.throughSequence, 3);
  assert.equal(complete.confirmedResults.value, 1);
  assert.equal(complete.unknownOutcomes.value, 0);
  assert.equal(complete.actionDurations.values[0].value, 450);
  assert.equal(reopened.processMetrics({ requiredThroughSequence: 0 }).confirmedResults.value, 1, 'minimum-prefix query cannot replay an older result');
});

test('KS323 SYNTHETIC permission is rechecked before every query and final result; revoked duplicate/cache/reopen stay DENIED', async t => {
  const root = mkdtempSync(join(tmpdir(), 'ks323-authorization-'));
  let allowed = true, reads = 0, denyAt = Infinity;
  const events = await syntheticMetricEvents(syntheticPositiveMetricSpecs), binding = syntheticInboxBinding(events[0]);
  const options = { agentProcess: { stateRoot: root, binding, authorizeRead: () => allowed && ++reads < denyAt, maxEvents: 128 } };
  const store = new InMemoryEvidenceStore(options);
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  events.forEach(event => store.append(event));
  assert.equal(store.processMetrics().confirmedResults.value, 2);
  reads = 0; denyAt = 3;
  let leaked;
  assert.throws(() => { leaked = store.processMetrics(); }, /PROCESS_CURRENT_SCOPE_DENIED/);
  assert.equal(leaked, undefined, 'revocation at the final permission check cannot publish a calculated result');
  allowed = false;
  assert.throws(() => store.processMetrics(), /PROCESS_CURRENT_SCOPE_DENIED/);
  assert.throws(() => store.importBytes(Buffer.from(JSON.stringify(events[0]))), /PROCESS_CURRENT_SCOPE_DENIED/);
  assert.throws(() => new InMemoryEvidenceStore(options), /PROCESS_CURRENT_SCOPE_DENIED/);
  allowed = true; denyAt = Infinity;
  store.close();
  const reopened = new InMemoryEvidenceStore(options);
  try {
    assert.equal(reopened.processMetrics().confirmedResults.value, 2);
    allowed = false;
    assert.throws(() => reopened.processMetrics(), /PROCESS_CURRENT_SCOPE_DENIED/);
  } finally { reopened.close(); }
});

test('KS323 SYNTHETIC metrics never join foreign scope/producer/stream or source epochs sharing action IDs', async t => {
  const { store, binding } = await syntheticInbox(t);
  const [event] = await syntheticMetricEvents([{ id: 'scope-result', action: 'shared-id', phase: 'RESULT_CONFIRMED', time: 1450 }]);
  for (const change of [e => { e.payload.scope.tenantId = 'foreign'; }, e => { e.payload.scope.principalDigest = 'd'.repeat(64); },
    e => { e.payload.scope.privacyEpoch = 2; }, e => { e.payload.source.sourceEpoch = 'd'.repeat(64); },
    e => { e.streamId = 'foreign-stream'; }, e => { e.version.producer.id = 'foreign'; },
    e => { e.version.producer.artifactDigest = `sha256:${'d'.repeat(64)}`; }]) {
    const foreign = structuredClone(event); change(foreign); foreign.payloadDigest = sha256Digest(foreign.payload);
    assert.throws(() => store.importBytes(Buffer.from(JSON.stringify(foreign))), /PROCESS_SOURCE_SCOPE_DENIED/);
    assert.equal(store.processMetrics().confirmedResults.value, 0);
  }
  store.append(event);
  const first = store.processMetrics();
  const root = mkdtempSync(join(tmpdir(), 'ks323-other-epoch-'));
  const otherBinding = structuredClone(binding); otherBinding.sourceEpoch = 'd'.repeat(64);
  const other = new InMemoryEvidenceStore({ agentProcess: { stateRoot: root, binding: otherBinding, authorizeRead: () => true, maxEvents: 128 } });
  t.after(() => { other.close(); rmSync(root, { recursive: true, force: true }); });
  const secondEvent = structuredClone(event);
  secondEvent.payload.source.sourceEpoch = otherBinding.sourceEpoch;
  secondEvent.payloadDigest = sha256Digest(secondEvent.payload);
  other.append(secondEvent);
  const second = other.processMetrics();
  assert.equal(first.confirmedResults.value, 1);
  assert.equal(second.confirmedResults.value, 1);
  assert.notEqual(first.actionDurations.values[0].actionKeyDigest, second.actionDurations.values[0].actionKeyDigest);
  assert.equal(first.actionDurations.values[0].reason, 'START_NOT_RECORDED');
  assert.equal(second.actionDurations.values[0].reason, 'START_NOT_RECORDED');
  assert.throws(() => new InMemoryEvidenceStore({ agentProcess: { stateRoot: root, binding, authorizeRead: () => true, maxEvents: 128 } }), /PROCESS_BINDING_DRIFT_DENIED/);
});

test('KS323 SYNTHETIC absent readback/proof and simulation/replay are denied; default memory and getters are not widened', async t => {
  const { store } = await syntheticInbox(t);
  const [event] = await syntheticMetricEvents([{ id: 'denied-result', action: 'denied', phase: 'RESULT_CONFIRMED', time: 1450 }]);
  for (const change of [e => { e.payload.readbackRef = null; }, e => { e.payload.result = null; },
    e => { e.payload.mode = 'SIMULATION'; }, e => { e.payload.mode = 'REPLAY'; }]) {
    const denied = structuredClone(event); change(denied); denied.payloadDigest = sha256Digest(denied.payload);
    assert.throws(() => store.append(denied), /PROCESS_PAYLOAD_DENIED/);
  }
  assert.equal(store.processMetrics().confirmedResults.value, 0);
  assert.equal(store.processMetrics().unknownOutcomes.value, 0);
  assert.equal(store.processMetrics().input.sourceHead, 'NOT_ATTESTED');
  assert.throws(() => new InMemoryEvidenceStore().processMetrics(), /PROCESS_PERSISTENT_OWNER_REQUIRED/);
  for (const requiredThroughSequence of [-1, 1.5, 129, '1']) assert.throws(() => store.processMetrics({ requiredThroughSequence }), /PROCESS_METRICS_REQUEST_DENIED/);
  let getterCalls = 0;
  assert.throws(() => store.processMetrics({ get requiredThroughSequence() { getterCalls++; return 0; } }), /PROCESS_METRICS_REQUEST_DENIED/);
  assert.equal(getterCalls, 0);
  assert.deepEqual(store.durableEvents(), []);
});

test('KS323 SYNTHETIC repeated old source facts never resurrect success over a newer UNKNOWN owner fact', async t => {
  for (const repeatedSourceFact of [true, false]) {
    const { store } = await syntheticInbox(t);
    const events = await syntheticMetricEvents([
      { id: 'old-start', action: 'reobserve', phase: 'PENDING', time: 1000 },
      { id: 'old-confirmed', action: 'reobserve', phase: 'RESULT_CONFIRMED', time: 1450, cause: 'old-start' },
      { id: 'new-unknown', action: 'reobserve', phase: 'UNKNOWN', revision: 3, time: 2000, cause: 'old-confirmed' },
      { id: 'late-poll', action: 'reobserve', phase: 'RESULT_CONFIRMED', time: 1450, cause: 'old-start',
        fact: repeatedSourceFact ? 'old-confirmed' : 'SYNTHETIC-new-digest-old-revision' },
    ]);
    events.slice(0, 3).forEach(event => store.append(event));
    assert.equal(store.processMetrics().unknownOutcomes.value, 1);
    store.append(events[3]);
    const metrics = store.processMetrics();
    assert.equal(metrics.confirmedResults.value, 0);
    assert.equal(metrics.unknownOutcomes.value, repeatedSourceFact ? 1 : 0);
    assert.equal(metrics.actionDurations.values[0].value, null);
    assert.equal(metrics.actionDurations.values[0].reason, repeatedSourceFact ? 'OUTCOME_UNKNOWN' : 'OWNER_REVISION_REGRESSION');
  }
});

test('KS323 R1 SYNTHETIC incompatible terminal facts at one owner revision remain ambiguous in either observation order', async t => {
  for (const phases of [['UNKNOWN', 'RESULT_CONFIRMED'], ['RESULT_CONFIRMED', 'UNKNOWN']]) {
    const { store } = await syntheticInbox(t);
    const events = await syntheticMetricEvents([
      { id: 'r1-pending', action: 'r1-display', mode: 'DISPLAY', phase: 'PENDING', time: 100 },
      { id: 'r1-first', action: 'r1-display', mode: 'DISPLAY', phase: phases[0], revision: 2, time: 200, cause: 'r1-pending' },
      { id: 'r1-last', action: 'r1-display', mode: 'DISPLAY', phase: phases[1], revision: 2, time: 350, cause: 'r1-pending' },
    ]);
    events.forEach(event => store.append(event));
    const metrics = store.processMetrics();
    assert.equal(metrics.confirmedResults.value, 0);
    assert.equal(metrics.confirmedResults.exclusions[0].reason, 'OWNER_REVISION_OUTCOME_CONFLICT');
    assert.equal(metrics.unknownOutcomes.exclusions[0].reason, 'OWNER_REVISION_OUTCOME_CONFLICT');
    assert.equal(metrics.actionDurations.values[0].value, null);
    assert.equal(metrics.actionDurations.values[0].status, 'UNKNOWN');
    assert.equal(metrics.actionDurations.values[0].reason, 'OWNER_REVISION_OUTCOME_CONFLICT');
    assert.deepEqual(store.durableEvents(), events);
  }
});

const {readProcessViewV1} = await import('../services/bi-control/src/assistant-foundation/process-view-readback-v1.mjs');
const syntheticViewSpecs = [
  {id:'view-start',action:'view',phase:'PENDING',time:100,correlation:'correlation:SYNTHETIC-view'},
  {id:'view-end',action:'view',phase:'RESULT_CONFIRMED',time:350,cause:'view-start',correlation:'correlation:SYNTHETIC-view'},
  {id:'view-unknown',action:'unknown',phase:'UNKNOWN',time:null,correlation:'correlation:SYNTHETIC-view'},
];
test('KS324 SYNTHETIC view and filter use one actual authorized committed input, without effects or payload dumps',async t=>{
  const {store}=await syntheticInbox(t),events=await syntheticMetricEvents(syntheticViewSpecs);
  events.forEach(event=>store.append(event));
  const before=store.durableEvents(),view=readProcessViewV1(store,{phase:'UNKNOWN'});
  assert.equal(view.state,'CURRENT');assert.equal(view.correlationId,'correlation:SYNTHETIC-view');
  assert.deepEqual(view.rows.map(row=>row.eventId),[events[2].eventId]);
  assert.equal(view.metrics.confirmedResults.value,1);assert.equal(view.metrics.unknownOutcomes.value,1);
  assert.equal(view.metrics.actionDurations.values[0].value,250);
  assert.equal(view.inputStateDigest,view.metrics.input.inputStateDigest);
  assert.ok(view.rows.every(row=>row.inputStateDigest===view.inputStateDigest));
  assert.equal(JSON.stringify(view).includes('"payload"'),false);
  for(const request of [{phase:'ALL',scope:{tenantId:'foreign'}},{phase:'ALL',role:'admin'},{phase:'ALL',sourceEpoch:'foreign'},{phase:'SUCCESS'}])assert.throws(()=>readProcessViewV1(store,request),/DENIED/);
  assert.deepEqual(store.durableEvents(),before);
});

test('KS324 SYNTHETIC actual SQLite change between owner reads is STALE, never mixed rows and metrics',async t=>{
  const {store,root,binding}=await syntheticInbox(t),events=await syntheticMetricEvents(syntheticViewSpecs);
  events.forEach(event=>store.append(event));
  const [later]=await syntheticMetricEvents([{id:'view-later',action:'view',phase:'UNKNOWN',revision:3,time:450,cause:'view-end',correlation:'correlation:SYNTHETIC-view'}]);later.seq=4;
  let checks=0,changeAt=Infinity;
  const reader=new InMemoryEvidenceStore({agentProcess:{stateRoot:root,binding,maxEvents:128,authorizeRead:()=>{if(++checks===changeAt)store.append(later);return true;}}});
  t.after(()=>reader.close());checks=0;changeAt=3;
  assert.throws(()=>readProcessViewV1(reader,{phase:'ALL'}),/PROCESS_VIEW_STALE/);
  assert.equal(store.durableEvents().length,4);
  const fresh=readProcessViewV1(reader,{phase:'ALL'});assert.equal(fresh.metrics.confirmedResults.value,0);assert.equal(fresh.metrics.unknownOutcomes.value,2);
});

test('KS324 SYNTHETIC multiple correlations are unavailable and final current authorization still denies a read',async t=>{
  const {store,root,binding}=await syntheticInbox(t);
  (await syntheticMetricEvents(syntheticPositiveMetricSpecs)).forEach(event=>store.append(event));
  assert.deepEqual(readProcessViewV1(store,{phase:'ALL'}),{state:'UNAVAILABLE',code:'PROCESS_VIEW_MULTIPLE_CORRELATIONS',rows:[],metrics:null});
  let allowed=true;
  const reader=new InMemoryEvidenceStore({agentProcess:{stateRoot:root,binding,maxEvents:128,authorizeRead:()=>allowed}});t.after(()=>reader.close());
  allowed=false;assert.throws(()=>readProcessViewV1(reader,{phase:'ALL'}),/PROCESS_CURRENT_SCOPE_DENIED/);
});

test('KS324 SYNTHETIC existing agent/control HTTP path reads real inbox, rejects foreign input/origin/auth and never fills missing data',async t=>{
  const {startProcessViewFixtureV1}=await import('./helpers/ks324-process-view-fixture.mjs');
  const {renameSync,existsSync}=await import('node:fs');
  const f=await startProcessViewFixtureV1();t.after(()=>f.close());
  assert.ok(f.acks.every(ack=>ack.status==='IMPORTED'&&ack.persisted));
  const before=f.store.durableEvents(),response=await f.request();assert.equal(response.status,200);
  const value=await response.json();assert.equal(value.state,'CURRENT');assert.equal(value.metrics.confirmedResults.value,1);assert.equal(value.metrics.unknownOutcomes.value,1);assert.equal(value.metrics.actionDurations.values[0].value,250);
  assert.deepEqual(value.rows.map(row=>row.eventId),before.map(event=>event.eventId));
  const page=await fetch(f.origin+'/process-view');assert.equal(page.status,200);assert.match(await page.text(),/Vorgangsansicht/);
  const api=await fetch(f.origin+'/api/process-view',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phase:'ALL'})});assert.deepEqual(await api.json(),value);
  const foreign=await f.request({phase:'ALL',scope:{tenantId:'foreign'}});assert.equal(foreign.status,400);assert.equal((await foreign.json()).status,'DENIED');
  const unauthenticated=await fetch(f.control+'/v1/process-view/read',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phase:'ALL'})});assert.equal(unauthenticated.status,401);
  const origin=await fetch(f.origin+'/api/process-view',{method:'POST',headers:{'content-type':'application/json',origin:'http://SYNTHETIC-foreign.invalid'},body:JSON.stringify({phase:'ALL'})});assert.equal(origin.status,400);assert.equal((await origin.json()).code,'AGENT_PROCESS_ORIGIN_DENIED');
  assert.deepEqual(f.store.durableEvents(),before);
  renameSync(f.configFile,f.configFile+'.held');assert.equal((await(await f.request()).json()).state,'MISSING');renameSync(f.configFile+'.held',f.configFile);
  f.store.close();const db=join(f.stateRoot,'agent-process-inbox-v1.sqlite');renameSync(db,db+'.held');
  assert.equal((await(await f.request()).json()).state,'MISSING');assert.equal(existsSync(db),false);
});

// KS324: canonical imported routes retain the frozen npm test command.
import './ks324-local-bootstrap.test.mjs';
import './ks324-read-only-owner.test.mjs';
