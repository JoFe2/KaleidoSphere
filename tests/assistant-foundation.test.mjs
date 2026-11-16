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
