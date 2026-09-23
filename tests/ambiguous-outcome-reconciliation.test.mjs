import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { sha256Digest } from '../services/bi-control/src/assistant-foundation/core-contracts.mjs';
import {
  APPLY_CAPABILITY_ID,
  TRUSTED_TARGET_VERSION,
  TYPED_RECOMMENDATION_VERSION,
  compileTrustedChangePlan,
} from '../services/bi-control/src/trusted-workflow/trusted-specialist-workflow.mjs';
import {
  FileOutcomeJournal,
  OUTCOME_READ_UNTYPED_ABSENCE_CODE,
  OutcomeAuthoritativeNotFoundError,
  OutcomeJournal,
  authorizeFreshRetryAfterUnchanged,
  compensateOwnedPartialOutcome,
  createOutcomeContext,
  recoverUnknownOutcomeFromFile,
  reconcileUnknownOutcome,
  transitionOutcomeState,
} from '../services/bi-control/src/trusted-workflow/ambiguous-outcome-reconciliation.mjs';

const uuids = {
  database: 'a6050000-0000-4000-8000-000000000001',
  dataset: 'a6050000-0000-4000-8000-000000000002',
  chart: 'a6050000-0000-4000-8000-000000000003',
  dashboard: 'a6050000-0000-4000-8000-000000000004',
};

const actionUuids = {
  '01-dataset': 'a6050000-0000-4000-8000-000000000101',
  '02-chart': 'a6050000-0000-4000-8000-000000000102',
};

function specialist() {
  const discovery = {
    visualizationProposal: { mode: 'preview-only', proposals: [{ type: 'big_number_with_trend' }], persistentMutation: false },
    trustedApplyReadbackRollback: { state: 'proposal-only', applyPerformed: false },
    semanticKpiModel: { kpis: [{ id: 'orders.revenue.sum', expression: 'SUM(revenue)', validation: 'grain-and-null-check-required' }] },
    evidenceConfidenceBlindSpots: { blindSpots: ['synthetic-fixture-only'] },
  };
  return {
    schemaVersion: 'chimpmaera.bi/real-bi-specialist/v1',
    runId: 'm6-05-specialist-1',
    self_check: { mutationPerformed: false },
    discovery,
    synthesis: { source: 'deterministic-evidence-core' },
  };
}

function target() {
  const fingerprintBody = { product: 'Apache Superset', version: '6.1.0', openapiCanonicalSha256: '1e0aea80b9f9331d83717711c577575d1f0c706f5e0e3632d403a28df0c5caa6' };
  return {
    schemaVersion: TRUSTED_TARGET_VERSION,
    targetId: 'm6-05-disposable-local',
    environment: 'disposable_local',
    baseUrl: 'http://127.0.0.1:39045',
    fingerprint: { ...fingerprintBody, digest: sha256Digest(fingerprintBody) },
    capabilityRevision: 'm6-05-local-v1',
    capabilities: [
      { capabilityId: 'superset.dataset.reviewed-update', contractVersion: 'v1', status: 'supported' },
      { capabilityId: 'superset.chart.reviewed-upsert', contractVersion: 'v1', status: 'supported' },
    ],
    assets: [
      { identity: `database:${uuids.database}`, kind: 'database', value: { uuid: uuids.database, name: 'M6-05 synthetic database' } },
      { identity: `dataset:${uuids.dataset}`, kind: 'dataset', value: { uuid: uuids.dataset, tableName: 'm6_05_synthetic', databaseUuid: uuids.database, description: 'before' } },
      {
        identity: `chart:${uuids.chart}`,
        kind: 'chart',
        value: { uuid: uuids.chart, title: 'Before chart', vizType: 'big_number', datasetUuid: uuids.dataset, metricId: 'orders.revenue.sum', groupBy: [] },
      },
    ],
  };
}

function recommendation(result = specialist()) {
  return {
    schemaVersion: TYPED_RECOMMENDATION_VERSION,
    recommendationId: 'm6-05-recommendation-1',
    sourceRunId: result.runId,
    sourceDiscoveryDigest: sha256Digest(result.discovery),
    authority: 'advisory_only',
    actions: [
      {
        actionId: '02-chart', actionType: 'chart.upsert',
        asset: { identity: `chart:${uuids.chart}`, kind: 'chart' },
        dependsOn: [`dataset:${uuids.dataset}`],
        before: { uuid: uuids.chart, title: 'Before chart', vizType: 'big_number', datasetUuid: uuids.dataset, metricId: 'orders.revenue.sum', groupBy: [] },
        after: { uuid: uuids.chart, title: 'After chart', vizType: 'big_number', datasetUuid: uuids.dataset, metricId: 'orders.revenue.sum', groupBy: [] },
      },
      {
        actionId: '01-dataset', actionType: 'dataset.update',
        asset: { identity: `dataset:${uuids.dataset}`, kind: 'dataset' },
        dependsOn: [`database:${uuids.database}`],
        before: { uuid: uuids.dataset, tableName: 'm6_05_synthetic', databaseUuid: uuids.database, description: 'before' },
        after: { uuid: uuids.dataset, tableName: 'm6_05_synthetic', databaseUuid: uuids.database, description: 'after' },
      },
    ],
  };
}

function fixtures() {
  const result = specialist();
  const plan = compileTrustedChangePlan({ planId: 'm6-05-plan-1', specialistResult: result, recommendation: recommendation(result), target: target() });
  const authorization = {
    authorized: true,
    executionId: plan.planId,
    capabilityId: APPLY_CAPABILITY_ID,
    previewDigest: plan.previewDigest,
    targetBindingDigest: sha256Digest(plan.targetBinding),
    idempotencyKey: 'm6-05-idem-1',
  };
  const context = createOutcomeContext({
    actorId: 'actor-1',
    sessionId: 'session-1',
    target: target(),
    plan,
    authorization,
    idempotencyKey: 'm6-05-idem-1',
    actionUuids,
    createdAt: '2026-08-15T06:40:00.000Z',
  });
  return { plan, authorization, context };
}

function adapterFor(plan, relationByActionId) {
  const values = new Map(plan.actions.map((action) => {
    const relation = relationByActionId[action.actionId];
    return [action.actionId, relation === 'after' ? action.after : action.before];
  }));
  const calls = { read: 0, applyValue: 0 };
  return {
    calls,
    adapter: {
      async read(action) {
        calls.read += 1;
        return structuredClone(values.get(action.actionId));
      },
      async applyValue() {
        calls.applyValue += 1;
        throw new Error('reconciliation must never dispatch mutations');
      },
    },
  };
}

test('G2 binds ambiguous outcome context to actor, session, target, capabilities, snapshot, plan, preview, idempotency, action UUIDs, and preconditions', () => {
  const { context, plan } = fixtures();
  assert.equal(context.actorId, 'actor-1');
  assert.equal(context.sessionId, 'session-1');
  assert.equal(context.target.targetId, 'm6-05-disposable-local');
  assert.equal(context.target.fingerprintDigest, plan.targetBinding.fingerprintDigest);
  assert.equal(context.target.capabilityDigest, plan.targetBinding.capabilityDigest);
  assert.equal(context.target.assetSnapshotDigest, plan.targetBinding.assetSnapshotDigest);
  assert.equal(context.previewDigest, plan.previewDigest);
  assert.equal(context.planDigest, sha256Digest(plan));
  assert.equal(context.actionBindings.length, 2);
  assert.match(context.preconditionDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(context.privacy.cotPersisted, false);
});

test('G2 state machine fails closed on blind retry, terminal mutation, and unknown events', () => {
  assert.equal(transitionOutcomeState(null, 'initialized'), 'not_dispatched');
  assert.equal(transitionOutcomeState('not_dispatched', 'dispatch_response_lost'), 'outcome_unknown');
  assert.equal(transitionOutcomeState('outcome_unknown', 'reconcile_exact_before'), 'unchanged_safe_to_retry');
  assert.equal(transitionOutcomeState('unchanged_safe_to_retry', 'fresh_retry_authorized'), 'not_dispatched');
  assert.throws(() => transitionOutcomeState('outcome_unknown', 'fresh_retry_authorized'), /OUTCOME_ILLEGAL_TRANSITION/);
  assert.throws(() => transitionOutcomeState('committed_equivalent', 'dispatch_response_lost'), /OUTCOME_ILLEGAL_TRANSITION/);
  assert.throws(() => transitionOutcomeState('not_dispatched', 'blind_retry'), /OUTCOME_ILLEGAL_TRANSITION/);
});

test('G2 hash-chained journal verifies restart persistence and rejects tampering, truncation shape, and raw persistence fields', async () => {
  const { context } = fixtures();
  const tmp = await mkdtemp(join(tmpdir(), 'm6-05-outcome-'));
  try {
    const filePath = join(tmp, 'journal.json');
    const journal = await FileOutcomeJournal.open({ filePath, context, clock: () => '2026-08-15T06:41:00.000Z' });
    await journal.appendAndFlush({ eventType: 'initialized', evidence: { targetReadinessDigest: context.target.assetSnapshotDigest }, decision: { dispatchAllowed: true } });
    await journal.appendAndFlush({ eventType: 'dispatch_response_lost', evidence: { transportFault: 'loopback_response_cut_after_dispatch' }, decision: { blindRetryAllowed: false } });
    assert.equal(journal.state, 'outcome_unknown');
    const reopened = await FileOutcomeJournal.open({ filePath, context });
    assert.equal(reopened.state, 'outcome_unknown');
    assert.equal(reopened.entries().length, 2);
    const tampered = reopened.snapshot();
    tampered.entries[1].decision.blindRetryAllowed = true;
    assert.throws(() => new OutcomeJournal({ context, entries: tampered.entries }), /OUTCOME_JOURNAL_HASH_MISMATCH/);
    const reordered = reopened.snapshot();
    reordered.entries.reverse();
    assert.throws(() => new OutcomeJournal({ context, entries: reordered.entries }), /OUTCOME_JOURNAL_ENTRY_INVALID|OUTCOME_JOURNAL_STATE_CHAIN_INVALID/);
    assert.throws(() => reopened.append({ eventType: 'reconcile_manual_review', evidence: { rawResponse: { status: 200 } } }), /OUTCOME_JOURNAL_RAW_OR_SECRET_FIELD_DENIED/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('G3 reconciles exact committed after-state without redispatching duplicate mutation requests', async () => {
  const { context, plan } = fixtures();
  const journal = new OutcomeJournal({ context });
  journal.append({ eventType: 'initialized' });
  journal.append({ eventType: 'dispatch_response_lost', decision: { blindRetryAllowed: false } });
  const { adapter, calls } = adapterFor(plan, { '01-dataset': 'after', '02-chart': 'after' });
  const result = await reconcileUnknownOutcome({ journal, plan, adapter, target: target(), occurredAt: '2026-08-15T06:42:00.000Z' });
  assert.equal(result.state, 'committed_equivalent');
  assert.equal(result.classification, 'committed_equivalent');
  assert.equal(calls.read, 2);
  assert.equal(calls.applyValue, 0);
  assert.deepEqual(result.entry.decision, {
    classification: 'committed_equivalent',
    retryAllowed: false,
    retryRequiresFreshGrant: false,
    compensationAllowed: false,
    manualReviewRequired: false,
  });
});

test('G3 permits unchanged pre-dispatch retry only after new bound authorization', async () => {
  const { context, plan } = fixtures();
  const journal = new OutcomeJournal({ context });
  journal.append({ eventType: 'initialized' });
  journal.append({ eventType: 'dispatch_response_lost', decision: { blindRetryAllowed: false } });
  const { adapter, calls } = adapterFor(plan, { '01-dataset': 'before', '02-chart': 'before' });
  const result = await reconcileUnknownOutcome({ journal, plan, adapter, target: target() });
  assert.equal(result.state, 'unchanged_safe_to_retry');
  assert.equal(result.entry.decision.retryRequiresFreshGrant, true);
  assert.equal(calls.applyValue, 0);
  assert.throws(() => authorizeFreshRetryAfterUnchanged({
    journal,
    context,
    plan,
    authorization: { ...fixtures().authorization, idempotencyKey: 'm6-05-idem-1' },
    idempotencyKey: 'm6-05-idem-1',
  }), /OUTCOME_FRESH_RETRY_REQUIRES_NEW_IDEMPOTENCY/);
  const freshAuthorization = {
    authorized: true,
    executionId: plan.planId,
    capabilityId: APPLY_CAPABILITY_ID,
    previewDigest: plan.previewDigest,
    targetBindingDigest: sha256Digest(plan.targetBinding),
    idempotencyKey: 'm6-05-idem-2',
  };
  const retryEntry = authorizeFreshRetryAfterUnchanged({ journal, context, plan, authorization: freshAuthorization, idempotencyKey: 'm6-05-idem-2' });
  assert.equal(retryEntry.toState, 'not_dispatched');
  assert.equal(retryEntry.decision.blindRedispatch, false);
});

test('G3 classifies owned partial, diverged, foreign-owned, and target drift as no-retry outcomes', async () => {
  const { context, plan } = fixtures();
  const partialJournal = new OutcomeJournal({ context });
  partialJournal.append({ eventType: 'initialized' });
  partialJournal.append({ eventType: 'dispatch_response_lost' });
  const partial = await reconcileUnknownOutcome({ journal: partialJournal, plan, target: target(), ...adapterFor(plan, { '01-dataset': 'after', '02-chart': 'before' }) });
  assert.equal(partial.state, 'partial');
  assert.equal(partial.entry.decision.retryAllowed, false);
  assert.equal(partial.entry.decision.compensationAllowed, true);

  const divergedJournal = new OutcomeJournal({ context });
  divergedJournal.append({ eventType: 'initialized' });
  divergedJournal.append({ eventType: 'dispatch_response_lost' });
  const divergedAdapter = { async read(action) { return { ...action.after, title: 'foreign change', description: 'foreign change' }; } };
  const diverged = await reconcileUnknownOutcome({ journal: divergedJournal, plan, adapter: divergedAdapter, target: target() });
  assert.equal(diverged.state, 'diverged');
  assert.equal(diverged.entry.decision.manualReviewRequired, true);

  const foreignJournal = new OutcomeJournal({ context });
  foreignJournal.append({ eventType: 'initialized' });
  foreignJournal.append({ eventType: 'dispatch_response_lost' });
  const foreign = await reconcileUnknownOutcome({ journal: foreignJournal, plan, target: target(), ...adapterFor(plan, { '01-dataset': 'after', '02-chart': 'after' }), ownership: { '01-dataset': 'foreign' } });
  assert.equal(foreign.state, 'manual_review');
  assert.equal(foreign.entry.decision.retryAllowed, false);

  const driftJournal = new OutcomeJournal({ context });
  driftJournal.append({ eventType: 'initialized' });
  driftJournal.append({ eventType: 'dispatch_response_lost' });
  const driftedTarget = target();
  driftedTarget.assets[1].value.description = 'drifted before reconciliation';
  const drift = await reconcileUnknownOutcome({ journal: driftJournal, plan, target: driftedTarget, ...adapterFor(plan, { '01-dataset': 'before', '02-chart': 'before' }) });
  assert.equal(drift.state, 'manual_review');
  assert.equal(drift.entry.decision.manualReviewRequired, true);
});

test('G5 restart recovery is single-owner, suppresses concurrent duplicates, and is idempotent', async () => {
  const { context, plan } = fixtures();
  const tmp = await mkdtemp(join(tmpdir(), 'm6-05-recovery-'));
  try {
    const filePath = join(tmp, 'journal.json');
    const leasePath = join(tmp, 'recovery.lock');
    const firstProcess = await FileOutcomeJournal.open({ filePath, context });
    await firstProcess.appendAndFlush({ eventType: 'initialized' });
    await firstProcess.appendAndFlush({ eventType: 'dispatch_response_lost', decision: { blindRetryAllowed: false } });

    let releaseRead;
    const readGate = new Promise((resolve) => { releaseRead = resolve; });
    let readStarted;
    const started = new Promise((resolve) => { readStarted = resolve; });
    const values = new Map(plan.actions.map((action) => [action.actionId, action.after]));
    const calls = { read: 0, applyValue: 0 };
    const adapter = {
      async read(action) { calls.read += 1; readStarted(); await readGate; return structuredClone(values.get(action.actionId)); },
      async applyValue() { calls.applyValue += 1; throw new Error('duplicate mutation denied'); },
    };
    const owner = recoverUnknownOutcomeFromFile({ filePath, leasePath, ownerId: 'executor-restart-1', context, plan, adapter, target: target() });
    await started;
    await assert.rejects(
      recoverUnknownOutcomeFromFile({ filePath, leasePath, ownerId: 'executor-restart-2', context, plan, adapter, target: target() }),
      /OUTCOME_RECOVERY_LEASE_HELD/,
    );
    releaseRead();
    const recovered = await owner;
    assert.equal(recovered.state, 'committed_equivalent');
    assert.equal(recovered.recovered, true);
    assert.equal(calls.applyValue, 0);

    const repeated = await recoverUnknownOutcomeFromFile({ filePath, leasePath, ownerId: 'executor-restart-3', context, plan, adapter, target: target() });
    assert.equal(repeated.state, 'committed_equivalent');
    assert.equal(repeated.recovered, false);
    assert.equal(repeated.duplicateSuppressed, true);
    assert.equal(calls.read, 2);
    assert.equal(calls.applyValue, 0);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('G5 compensates only exact owned partial actions and leaves unrelated assets untouched', async () => {
  const { context, plan } = fixtures();
  const journal = new OutcomeJournal({ context });
  journal.append({ eventType: 'initialized' });
  journal.append({ eventType: 'dispatch_response_lost' });
  const values = new Map(plan.actions.map((action) => [action.actionId, action.actionId === '01-dataset' ? action.after : action.before]));
  const unrelated = { identity: 'dashboard:unrelated', title: 'untouched' };
  const calls = [];
  const adapter = {
    async read(action) { return structuredClone(values.get(action.actionId)); },
    async applyValue(action, value) { calls.push(action.actionId); values.set(action.actionId, structuredClone(value)); return structuredClone(value); },
  };
  const classified = await reconcileUnknownOutcome({ journal, plan, adapter, target: target() });
  assert.equal(classified.state, 'partial');
  const compensation = await compensateOwnedPartialOutcome({ journal, plan, adapter });
  assert.deepEqual(calls, ['01-dataset']);
  assert.equal(compensation.restored.length, 1);
  assert.deepEqual(unrelated, { identity: 'dashboard:unrelated', title: 'untouched' });
  assert.equal(compensation.entry.evidence.unrelatedAssetsMutated, 0);

  const foreignJournal = new OutcomeJournal({ context });
  foreignJournal.append({ eventType: 'initialized' });
  foreignJournal.append({ eventType: 'dispatch_response_lost' });
  values.set('01-dataset', structuredClone(plan.actions.find((action) => action.actionId === '01-dataset').after));
  await reconcileUnknownOutcome({ journal: foreignJournal, plan, adapter, target: target() });
  assert.equal(foreignJournal.state, 'partial');
  await assert.rejects(compensateOwnedPartialOutcome({ journal: foreignJournal, plan, adapter, ownership: { '01-dataset': 'foreign' } }), /OUTCOME_COMPENSATION_FOREIGN_OWNERSHIP/);
});

test('G6 rejects forged journal heads and plan substitution, and closes on capability drift without mutation', async () => {
  const { context, plan } = fixtures();
  const tmp = await mkdtemp(join(tmpdir(), 'm6-05-adversarial-'));
  try {
    const filePath = join(tmp, 'journal.json');
    const journal = await FileOutcomeJournal.open({ filePath, context });
    await journal.appendAndFlush({ eventType: 'initialized' });
    await journal.appendAndFlush({ eventType: 'dispatch_response_lost' });
    const forged = JSON.parse(await readFile(filePath, 'utf8'));
    forged.lastHash = `sha256:${'0'.repeat(64)}`;
    await writeFile(filePath, `${JSON.stringify(forged)}\n`);
    await assert.rejects(FileOutcomeJournal.open({ filePath, context }), /OUTCOME_JOURNAL_FILE_TRUNCATED_OR_FORGED/);

    const substituted = structuredClone(plan);
    substituted.actions[0].after.description = 'substituted';
    const body = Object.fromEntries(Object.entries(substituted).filter(([key]) => key !== 'previewDigest'));
    substituted.previewDigest = sha256Digest(body);
    const substitutionJournal = new OutcomeJournal({ context });
    substitutionJournal.append({ eventType: 'initialized' });
    substitutionJournal.append({ eventType: 'dispatch_response_lost' });
    await assert.rejects(reconcileUnknownOutcome({ journal: substitutionJournal, plan: substituted, ...adapterFor(substituted, { '01-dataset': 'before', '02-chart': 'before' }), target: target() }), /OUTCOME_PLAN_SUBSTITUTION/);

    const driftTarget = target();
    driftTarget.capabilityRevision = 'foreign-revision';
    const driftJournal = new OutcomeJournal({ context });
    driftJournal.append({ eventType: 'initialized' });
    driftJournal.append({ eventType: 'dispatch_response_lost' });
    const { adapter, calls } = adapterFor(plan, { '01-dataset': 'before', '02-chart': 'before' });
    const drift = await reconcileUnknownOutcome({ journal: driftJournal, plan, adapter, target: driftTarget });
    assert.equal(drift.state, 'manual_review');
    assert.equal(calls.read, 0);
    assert.equal(calls.applyValue, 0);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

// =============================================================================================
// KS-OPS-01 (KaleidoSphere #253) — ambiguous-outcome readback correction.
//
// A CREATE action carries `before === null` and a DELETE-shaped action carries `after === null`.
// The reconciler previously read ANY read failure as "absence" for exactly those two shapes, so a
// transport, timeout or permission fault minted `unchanged_safe_to_retry` (false safe retry) or
// `committed_equivalent` (false committed).  KS-OPS-01 binds absence to an EXPLICITLY TYPED
// authoritative-not-found observation and keeps every other read failure UNKNOWN, preserving the
// state instead of deciding it.
//
// Every negative and positive below runs through the ACTUAL native entry points: the in-process
// reconciliation (`reconcileUnknownOutcome`) and, for the restart path, the file-recovery entry
// point (`recoverUnknownOutcomeFromFile`) over a real hash-chained `FileOutcomeJournal`.
//
// Honest boundaries:
//   * `compileTrustedChangePlan` requires a non-null `after` for every released action type, so the
//     delete shape cannot be produced by the released compiler.  The create shape (before === null)
//     IS compiled through the real compiler; the delete shape is derived from that compiled plan by
//     nulling `after` and re-minting `previewDigest`, and is exercised at the reconciler boundary.
//   * The injected read adapter is the module's designed collaborator (the reconciliation reads
//     through it); it is not a stand-in for the reconciler under test.
// =============================================================================================

const KS253_PRIMARY_CHART_UUID = 'a6050000-0000-4000-8000-000000000201';
const KS253_SECOND_CHART_UUID = 'a6050000-0000-4000-8000-000000000202';
const KS253_MODULE_PATH = 'services/bi-control/src/trusted-workflow/ambiguous-outcome-reconciliation.mjs';
const KS253_MODULE_ABSOLUTE_PATH = resolve(KS253_MODULE_PATH);

function createdChartAction(actionId, uuid) {
  return {
    actionId,
    actionType: 'chart.upsert',
    asset: { identity: `chart:${uuid}`, kind: 'chart' },
    dependsOn: [`dataset:${uuids.dataset}`],
    before: null,
    after: {
      uuid,
      title: `Created chart ${actionId}`,
      vizType: 'big_number',
      datasetUuid: uuids.dataset,
      metricId: 'orders.revenue.sum',
      groupBy: [],
    },
  };
}

// A compiled plan containing CREATE actions (before === null) — produced by the REAL compiler:
// the assets are deliberately absent from the target snapshot, which is what makes them creates.
function createPlan(actionIds = ['03-created-chart']) {
  const result = specialist();
  const recommendation = {
    schemaVersion: TYPED_RECOMMENDATION_VERSION,
    recommendationId: 'ks253-create-recommendation-1',
    sourceRunId: result.runId,
    sourceDiscoveryDigest: sha256Digest(result.discovery),
    authority: 'advisory_only',
    actions: actionIds.map((actionId, index) => createdChartAction(
      actionId,
      index === 0 ? KS253_PRIMARY_CHART_UUID : KS253_SECOND_CHART_UUID,
    )),
  };
  return compileTrustedChangePlan({
    planId: 'ks253-create-plan-1',
    specialistResult: result,
    recommendation,
    target: target(),
  });
}

// A delete-shaped action (`after === null`) derived from the compiled plan and re-minted so the
// reconciler's own plan validation accepts it.  DISCLOSED BOUNDARY: not compiler-producible.
function deleteShapedPlan() {
  const compiled = createPlan();
  const source = compiled.actions[0];
  const action = { ...source, before: { ...source.after }, after: null };
  const body = { ...compiled, actions: [action], applyOrder: [action.actionId] };
  delete body.previewDigest;
  return { ...body, previewDigest: sha256Digest(body) };
}

// JournalClass lets a disposable RED variant build a journal of ITS OWN class: the native
// reconciler requires its own OutcomeJournal instance, so a broken byte-copy must be handed a
// journal it recognises.  The context and plan stay the real, compiled ones.
function planJournal(plan, actionIdToUuid, idempotencyKey = 'ks253-idem-1', JournalClass = OutcomeJournal) {
  const authorization = {
    authorized: true,
    executionId: plan.planId,
    capabilityId: APPLY_CAPABILITY_ID,
    previewDigest: plan.previewDigest,
    targetBindingDigest: sha256Digest(plan.targetBinding),
    idempotencyKey,
  };
  const context = createOutcomeContext({
    actorId: 'ks253-actor',
    sessionId: 'ks253-session',
    target: target(),
    plan,
    authorization,
    actionUuids: actionIdToUuid,
    idempotencyKey,
    createdAt: '2026-09-23T00:00:00.000Z',
  });
  const journal = new JournalClass({ context });
  journal.append({ eventType: 'initialized', occurredAt: '2026-09-23T00:00:01.000Z' });
  journal.append({
    eventType: 'dispatch_response_lost',
    occurredAt: '2026-09-23T00:00:02.000Z',
    decision: { blindRetryAllowed: false },
  });
  return { journal, context };
}

function ks253Adapter(readForActionId) {
  const calls = { read: 0, applyValue: 0, readActionIds: [] };
  return {
    calls,
    adapter: {
      async read(action) {
        calls.read += 1;
        calls.readActionIds.push(action.actionId);
        return readForActionId(action);
      },
      async applyValue() {
        calls.applyValue += 1;
        throw new Error('KS-OPS-01: reconciliation must never dispatch a mutation');
      },
    },
  };
}

const ks253TimeoutFault = () => Object.assign(new Error('loopback readback timed out'), { code: 'READBACK_TIMEOUT' });
const ks253PermissionFault = () => Object.assign(new Error('readback principal lacks read permission'), { code: 'READBACK_PERMISSION_DENIED' });
const ks253BareFault = () => new Error('readback failed without a typed code');
const ks253AuthoritativeAbsence = () => { throw new OutcomeAuthoritativeNotFoundError(); };

// Load the REAL module bytes with one bounded mutation applied, resolved from a scratch directory
// so no variant is ever left inside the repository tree.  Relative import specifiers are rewritten
// to absolute file URLs so the variant resolves exactly the same collaborators as the real module.
async function loadKs253Variant(mutate) {
  const source = await readFile(KS253_MODULE_PATH, 'utf8');
  const mutated = mutate(source);
  assert.notEqual(mutated, source, 'the broken variant must actually differ from the real module');
  const rewritten = mutated.replace(/(from\s+')(\.[^']+)(')/g, (match, prefix, specifier, suffix) =>
    `${prefix}${pathToFileURL(resolve(dirname(KS253_MODULE_ABSOLUTE_PATH), specifier)).href}${suffix}`);
  const scratch = await mkdtemp(join(tmpdir(), 'ks253-variant-'));
  const filePath = join(scratch, 'ambiguous-outcome-reconciliation.variant.mjs');
  await writeFile(filePath, rewritten);
  return { mod: await import(pathToFileURL(filePath).href), scratch };
}

test('KS-OPS-01 AC01/AC02 a timeout or permission fault on a CREATE (before===null) action stays UNKNOWN, never a safe retry', async () => {
  const plan = createPlan();
  const actionUuids = { '03-created-chart': KS253_PRIMARY_CHART_UUID };
  for (const [name, fault] of [['timeout', ks253TimeoutFault], ['permission', ks253PermissionFault]]) {
    const { journal } = planJournal(plan, actionUuids);
    const { adapter, calls } = ks253Adapter(() => { throw fault(); });
    const result = await reconcileUnknownOutcome({
      journal,
      plan,
      adapter,
      target: target(),
      occurredAt: '2026-09-23T00:00:03.000Z',
    });
    assert.equal(result.state, 'outcome_unknown', `${name} must not be read as absence`);
    assert.equal(result.classification, 'outcome_unknown', name);
    assert.equal(result.entry.eventType, 'reconcile_unknown_unresolved', name);
    assert.equal(result.entry.toState, 'outcome_unknown', name);
    assert.deepEqual(result.entry.decision, {
      classification: 'outcome_unknown',
      retryAllowed: false,
      retryRequiresFreshGrant: false,
      compensationAllowed: false,
      manualReviewRequired: false,
    }, name);
    assert.equal(result.readback[0].relation, 'unknown', name);
    assert.equal(result.readback[0].readState, 'unknown', name);
    assert.equal(result.readback[0].readErrorCode, fault().code, name);
    assert.equal(result.readback[0].observedDigest, null, name);
    assert.equal(calls.read, 1, name);
    assert.equal(calls.applyValue, 0, 'no unintended mutation');
    assert.equal(journal.state, 'outcome_unknown', name);
  }
});

test('KS-OPS-01 AC01/AC02 a timeout or permission fault on a DELETE-shaped (after===null) action stays UNKNOWN, never committed', async () => {
  const plan = deleteShapedPlan();
  const actionUuids = { '03-created-chart': KS253_PRIMARY_CHART_UUID };
  for (const [name, fault] of [['timeout', ks253TimeoutFault], ['permission', ks253PermissionFault]]) {
    const { journal } = planJournal(plan, actionUuids);
    const { adapter, calls } = ks253Adapter(() => { throw fault(); });
    const result = await reconcileUnknownOutcome({ journal, plan, adapter, target: target() });
    assert.notEqual(result.state, 'committed_equivalent', `${name} must not be read as a committed outcome`);
    assert.equal(result.state, 'outcome_unknown', name);
    assert.equal(result.classification, 'outcome_unknown', name);
    assert.equal(result.entry.toState, 'outcome_unknown', name);
    assert.equal(result.entry.decision.retryAllowed, false, name);
    assert.equal(result.entry.decision.compensationAllowed, false, name);
    assert.equal(result.entry.decision.manualReviewRequired, false, name);
    assert.equal(result.readback[0].relation, 'unknown', name);
    assert.equal(calls.applyValue, 0, 'no unintended mutation');
  }
});

test('KS-OPS-01 AC02 a bare read failure without a typed code is UNKNOWN too, and reports its own failure code', async () => {
  const plan = createPlan();
  const { journal } = planJournal(plan, { '03-created-chart': KS253_PRIMARY_CHART_UUID });
  const { adapter } = ks253Adapter(() => { throw ks253BareFault(); });
  const result = await reconcileUnknownOutcome({ journal, plan, adapter, target: target() });
  assert.equal(result.state, 'outcome_unknown');
  assert.equal(result.readback[0].readState, 'unknown');
  assert.equal(result.readback[0].readErrorCode, 'READBACK_FAILED');
});

test('KS-OPS-01 AC03 the typed authoritative absence still establishes absence, and the present/diverged positives are retained', async () => {
  // A create whose absence is AUTHORITATIVELY observed did not happen: unchanged, safe to retry.
  const create = createPlan();
  const { journal: createJournal } = planJournal(create, { '03-created-chart': KS253_PRIMARY_CHART_UUID });
  const absence = ks253Adapter(ks253AuthoritativeAbsence);
  const createResult = await reconcileUnknownOutcome({ journal: createJournal, plan: create, adapter: absence.adapter, target: target() });
  assert.equal(createResult.readback[0].relation, 'before');
  assert.equal(createResult.readback[0].readState, 'authoritative_not_found');
  assert.equal(createResult.readback[0].readErrorCode, 'OUTCOME_READ_NOT_FOUND');
  assert.equal(createResult.state, 'unchanged_safe_to_retry');
  assert.equal(createResult.entry.decision.retryAllowed, true);
  assert.equal(createResult.entry.decision.retryRequiresFreshGrant, true);
  assert.equal(absence.calls.applyValue, 0);

  // A delete whose absence is AUTHORITATIVELY observed did happen: committed equivalent.
  const deletion = deleteShapedPlan();
  const { journal: deleteJournal } = planJournal(deletion, { '03-created-chart': KS253_PRIMARY_CHART_UUID });
  const deleteAbsence = ks253Adapter(ks253AuthoritativeAbsence);
  const deleteResult = await reconcileUnknownOutcome({ journal: deleteJournal, plan: deletion, adapter: deleteAbsence.adapter, target: target() });
  assert.equal(deleteResult.readback[0].relation, 'after');
  assert.equal(deleteResult.state, 'committed_equivalent');
  assert.equal(deleteAbsence.calls.applyValue, 0);

  // An UPDATE action (before and after both present) with an authoritative absence stays 'missing',
  // which is the retained divergence classification — an absence is never mistaken for an after-state.
  const { context: updateContext, plan: updatePlan } = fixtures();
  const updateJournal = new OutcomeJournal({ context: updateContext });
  updateJournal.append({ eventType: 'initialized' });
  updateJournal.append({ eventType: 'dispatch_response_lost' });
  const updateAbsence = ks253Adapter(ks253AuthoritativeAbsence);
  const updateResult = await reconcileUnknownOutcome({ journal: updateJournal, plan: updatePlan, adapter: updateAbsence.adapter, target: target() });
  assert.equal(updateResult.readback.every((item) => item.relation === 'missing'), true);
  assert.equal(updateResult.state, 'diverged');
  assert.equal(updateAbsence.calls.applyValue, 0);

  // Present-after and present-before positives over the released shapes are retained unchanged.
  const { context: afterContext, plan: afterPlan } = fixtures();
  const afterJournal = new OutcomeJournal({ context: afterContext });
  afterJournal.append({ eventType: 'initialized' });
  afterJournal.append({ eventType: 'dispatch_response_lost' });
  const afterResult = await reconcileUnknownOutcome({ journal: afterJournal, plan: afterPlan, target: target(), ...adapterFor(afterPlan, { '01-dataset': 'after', '02-chart': 'after' }) });
  assert.equal(afterResult.state, 'committed_equivalent');
  assert.equal(afterResult.readback.every((item) => item.readState === 'observed'), true);
});

test('KS-OPS-01 AC02/AC03 an UNKNOWN action dominates the pass, and the preserved UNKNOWN is still resolvable later', async () => {
  const plan = createPlan(['03-created-chart', '04-created-chart']);
  const actionUuids = {
    '03-created-chart': KS253_PRIMARY_CHART_UUID,
    '04-created-chart': KS253_SECOND_CHART_UUID,
  };
  const { journal } = planJournal(plan, actionUuids);
  const mixed = ks253Adapter((action) => {
    if (action.actionId === '03-created-chart') throw new OutcomeAuthoritativeNotFoundError();
    throw ks253TimeoutFault();
  });
  const first = await reconcileUnknownOutcome({ journal, plan, adapter: mixed.adapter, target: target() });
  assert.equal(first.state, 'outcome_unknown');
  assert.equal(first.classification, 'outcome_unknown');
  assert.equal(
    first.entry.decision.retryAllowed,
    false,
    'a typed absence on one action must not mint a safe retry while another action is UNREAD',
  );
  assert.deepEqual(
    first.readback.map((item) => [item.actionId, item.relation]),
    [['03-created-chart', 'before'], ['04-created-chart', 'unknown']],
  );
  assert.equal(mixed.calls.applyValue, 0);

  // The SAME journal stays reconcilable: the UNKNOWN was preserved, not frozen into a terminal state.
  assert.equal(journal.state, 'outcome_unknown');
  const later = ks253Adapter(ks253AuthoritativeAbsence);
  const second = await reconcileUnknownOutcome({ journal, plan, adapter: later.adapter, target: target() });
  assert.equal(second.state, 'unchanged_safe_to_retry');
  assert.equal(second.entry.decision.retryAllowed, true);
  assert.equal(later.calls.applyValue, 0);
});

test('KS-OPS-01 AC03 the restart recovery entry point keeps an UNREAD outcome UNKNOWN, mutates nothing, and still resolves it later', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'ks253-recovery-'));
  try {
    const plan = createPlan();
    const actionUuids = { '03-created-chart': KS253_PRIMARY_CHART_UUID };
    const { context } = planJournal(plan, actionUuids);
    const filePath = join(tmp, 'journal.json');
    const leasePath = join(tmp, 'recovery.lock');
    const seeded = await FileOutcomeJournal.open({ filePath, context });
    await seeded.appendAndFlush({ eventType: 'initialized' });
    await seeded.appendAndFlush({ eventType: 'dispatch_response_lost', decision: { blindRetryAllowed: false } });

    const faulted = ks253Adapter(() => { throw ks253PermissionFault(); });
    const first = await recoverUnknownOutcomeFromFile({
      filePath,
      leasePath,
      ownerId: 'ks253-restart-1',
      context,
      plan,
      adapter: faulted.adapter,
      target: target(),
    });
    assert.equal(first.state, 'outcome_unknown');
    assert.equal(first.classification, 'outcome_unknown');
    assert.equal(first.mutationRequestsIssued, 0);
    assert.equal(faulted.calls.applyValue, 0, 'no unintended mutation');
    assert.equal((await FileOutcomeJournal.open({ filePath, context })).state, 'outcome_unknown');

    const later = ks253Adapter(ks253AuthoritativeAbsence);
    const second = await recoverUnknownOutcomeFromFile({
      filePath,
      leasePath,
      ownerId: 'ks253-restart-2',
      context,
      plan,
      adapter: later.adapter,
      target: target(),
    });
    assert.equal(second.state, 'unchanged_safe_to_retry');
    assert.equal(later.calls.applyValue, 0);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('KS-OPS-01 AC02 a RESOLVED but UNTYPED null/undefined read result on a CREATE (before===null) action stays UNKNOWN, never a safe retry', async () => {
  const plan = createPlan();
  const actionUuids = { '03-created-chart': KS253_PRIMARY_CHART_UUID };
  for (const [name, value] of [['null', null], ['undefined', undefined]]) {
    const { journal } = planJournal(plan, actionUuids);
    const { adapter, calls } = ks253Adapter(() => value);
    const result = await reconcileUnknownOutcome({ journal, plan, adapter, target: target() });
    assert.equal(result.state, 'outcome_unknown', `a resolved ${name} must not be read as absence`);
    assert.equal(result.classification, 'outcome_unknown', name);
    assert.equal(result.entry.eventType, 'reconcile_unknown_unresolved', name);
    assert.equal(result.entry.toState, 'outcome_unknown', name);
    assert.deepEqual(result.entry.decision, {
      classification: 'outcome_unknown',
      retryAllowed: false,
      retryRequiresFreshGrant: false,
      compensationAllowed: false,
      manualReviewRequired: false,
    }, name);
    assert.equal(result.readback[0].relation, 'unknown', name);
    assert.equal(result.readback[0].readState, 'unknown', name);
    assert.equal(result.readback[0].readErrorCode, OUTCOME_READ_UNTYPED_ABSENCE_CODE, name);
    assert.equal(result.readback[0].observedDigest, null, name);
    assert.equal(calls.read, 1, name);
    assert.equal(calls.applyValue, 0, 'no unintended mutation');
    assert.equal(journal.state, 'outcome_unknown', name);
  }
});

test('KS-OPS-01 AC02 a RESOLVED but UNTYPED null/undefined read result on a DELETE-shaped (after===null) action stays UNKNOWN, never committed', async () => {
  const plan = deleteShapedPlan();
  const actionUuids = { '03-created-chart': KS253_PRIMARY_CHART_UUID };
  for (const [name, value] of [['null', null], ['undefined', undefined]]) {
    const { journal } = planJournal(plan, actionUuids);
    const { adapter, calls } = ks253Adapter(() => value);
    const result = await reconcileUnknownOutcome({ journal, plan, adapter, target: target() });
    assert.notEqual(result.state, 'committed_equivalent', `a resolved ${name} must not be read as a committed outcome`);
    assert.equal(result.state, 'outcome_unknown', name);
    assert.equal(result.classification, 'outcome_unknown', name);
    assert.equal(result.entry.toState, 'outcome_unknown', name);
    assert.equal(result.entry.decision.retryAllowed, false, name);
    assert.equal(result.entry.decision.retryRequiresFreshGrant, false, name);
    assert.equal(result.entry.decision.compensationAllowed, false, name);
    assert.equal(result.entry.decision.manualReviewRequired, false, name);
    assert.equal(result.readback[0].relation, 'unknown', name);
    assert.equal(result.readback[0].readState, 'unknown', name);
    assert.equal(result.readback[0].readErrorCode, OUTCOME_READ_UNTYPED_ABSENCE_CODE, name);
    assert.equal(calls.applyValue, 0, 'no unintended mutation');
    assert.equal(journal.state, 'outcome_unknown', name);
  }
});

test('KS-OPS-01 AC02 a THROWN null or undefined fault on both action shapes stays UNKNOWN and never crashes the digest', async () => {
  const actionUuids = { '03-created-chart': KS253_PRIMARY_CHART_UUID };
  for (const [shape, plan] of [['create-before-null', createPlan()], ['delete-after-null', deleteShapedPlan()]]) {
    for (const [name, thrown] of [['thrown null', null], ['thrown undefined', undefined]]) {
      const { journal } = planJournal(plan, actionUuids);
      const { adapter, calls } = ks253Adapter(() => { throw thrown; });
      const result = await reconcileUnknownOutcome({ journal, plan, adapter, target: target() });
      const label = `${shape}/${name}`;
      assert.equal(result.state, 'outcome_unknown', label);
      assert.equal(result.classification, 'outcome_unknown', label);
      assert.equal(result.entry.eventType, 'reconcile_unknown_unresolved', label);
      assert.equal(result.entry.decision.retryAllowed, false, label);
      assert.equal(result.entry.decision.compensationAllowed, false, label);
      assert.equal(result.entry.decision.manualReviewRequired, false, label);
      assert.equal(result.readback[0].relation, 'unknown', label);
      assert.equal(result.readback[0].readState, 'unknown', label);
      assert.equal(result.readback[0].readErrorCode, 'READBACK_FAILED', label);
      assert.equal(result.readback[0].observedDigest, null, label);
      assert.equal(calls.applyValue, 0, 'no unintended mutation');
      assert.equal(journal.state, 'outcome_unknown', label);
    }
  }
});

test('KS-OPS-01 AC02/AC03 an UNTYPED absence is preserved UNKNOWN and a later typed authoritative read still resolves it', async () => {
  const plan = createPlan();
  const actionUuids = { '03-created-chart': KS253_PRIMARY_CHART_UUID };
  const { journal } = planJournal(plan, actionUuids);
  const untyped = ks253Adapter(() => null);
  const first = await reconcileUnknownOutcome({ journal, plan, adapter: untyped.adapter, target: target() });
  assert.equal(first.state, 'outcome_unknown');
  assert.equal(first.entry.decision.retryAllowed, false);
  assert.equal(journal.state, 'outcome_unknown', 'an untyped absence must remain recoverable, not terminal');
  const later = ks253Adapter(ks253AuthoritativeAbsence);
  const second = await reconcileUnknownOutcome({ journal, plan, adapter: later.adapter, target: target() });
  assert.equal(second.state, 'unchanged_safe_to_retry');
  assert.equal(second.entry.decision.retryAllowed, true);
  assert.equal(later.calls.applyValue, 0);
});

test('KS-OPS-01 RED/GREEN: a variant that reads every fault as absence mints a false safe retry and a false committed outcome, while the real module refuses', async () => {
  const anchor = `  return error.authoritativeNotFound === true && error.code === OUTCOME_READ_NOT_FOUND_CODE
    ? READ_STATE_AUTHORITATIVE_NOT_FOUND
    : READ_STATE_UNKNOWN;`;
  const { mod: variant, scratch } = await loadKs253Variant((source) => {
    assert.equal(source.includes(anchor), true, 'the variant anchor must exist in the real module');
    return source.replace(anchor, '  return READ_STATE_AUTHORITATIVE_NOT_FOUND;');
  });
  try {
    const plan = createPlan();
    const actionUuids = { '03-created-chart': KS253_PRIMARY_CHART_UUID };

    const { journal: redCreateJournal } = planJournal(plan, actionUuids, 'ks253-idem-red', variant.OutcomeJournal);
    const redCreate = await variant.reconcileUnknownOutcome({
      journal: redCreateJournal,
      plan,
      adapter: ks253Adapter(() => { throw ks253TimeoutFault(); }).adapter,
      target: target(),
    });
    assert.equal(redCreate.state, 'unchanged_safe_to_retry', 'the broken variant fabricates a safe retry from a timeout');
    assert.equal(redCreate.entry.decision.retryAllowed, true);

    const deletePlan = deleteShapedPlan();
    const { journal: redDeleteJournal } = planJournal(deletePlan, actionUuids, 'ks253-idem-red', variant.OutcomeJournal);
    const redDelete = await variant.reconcileUnknownOutcome({
      journal: redDeleteJournal,
      plan: deletePlan,
      adapter: ks253Adapter(() => { throw ks253PermissionFault(); }).adapter,
      target: target(),
    });
    assert.equal(redDelete.state, 'committed_equivalent', 'the broken variant fabricates a committed outcome from a permission fault');

    // GREEN — the real module on the SAME faults decides nothing.
    const { journal: greenCreateJournal } = planJournal(plan, actionUuids);
    const greenCreate = await reconcileUnknownOutcome({
      journal: greenCreateJournal,
      plan,
      adapter: ks253Adapter(() => { throw ks253TimeoutFault(); }).adapter,
      target: target(),
    });
    assert.equal(greenCreate.state, 'outcome_unknown');
    const { journal: greenDeleteJournal } = planJournal(deletePlan, actionUuids);
    const greenDelete = await reconcileUnknownOutcome({
      journal: greenDeleteJournal,
      plan: deletePlan,
      adapter: ks253Adapter(() => { throw ks253PermissionFault(); }).adapter,
      target: target(),
    });
    assert.equal(greenDelete.state, 'outcome_unknown');
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('KS-OPS-01 RED/GREEN: without the UNKNOWN-preservation branch the same fault is decided as diverged instead of staying UNKNOWN', async () => {
  const anchor = '  if (unknownActions.length > 0) {';
  const { mod: variant, scratch } = await loadKs253Variant((source) => {
    assert.equal(source.split(anchor).length - 1, 1, 'the variant anchor must exist exactly once in the real module');
    return source.replace(anchor, '  if (false) {');
  });
  try {
    const plan = createPlan();
    const actionUuids = { '03-created-chart': KS253_PRIMARY_CHART_UUID };
    const { journal: redJournal } = planJournal(plan, actionUuids, 'ks253-idem-red', variant.OutcomeJournal);
    const red = await variant.reconcileUnknownOutcome({
      journal: redJournal,
      plan,
      adapter: ks253Adapter(() => { throw ks253TimeoutFault(); }).adapter,
      target: target(),
    });
    assert.equal(red.state, 'diverged', 'without the guard an UNREAD action is decided as a divergence');
    assert.notEqual(red.state, 'outcome_unknown');

    const { journal: greenJournal } = planJournal(plan, actionUuids);
    const green = await reconcileUnknownOutcome({
      journal: greenJournal,
      plan,
      adapter: ks253Adapter(() => { throw ks253TimeoutFault(); }).adapter,
      target: target(),
    });
    assert.equal(green.state, 'outcome_unknown');
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('KS-OPS-01 RED/GREEN: a variant that treats an UNTYPED null/undefined as an observation re-mints absence (resolved null -> false decision, thrown null -> digest crash), while the real module keeps it UNKNOWN', async () => {
  const resolvedGuard = '      if (observed === null || observed === undefined) {';
  const thrownGuard = '  if (error === null || error === undefined) return READ_STATE_UNKNOWN;';
  const { mod: variant, scratch } = await loadKs253Variant((source) => {
    assert.equal(source.split(resolvedGuard).length - 1, 1, 'the resolved-null guard must exist exactly once');
    assert.equal(source.split(thrownGuard).length - 1, 1, 'the thrown-null guard must exist exactly once');
    return source
      .replace(resolvedGuard, '      if (false) {')
      .replace(thrownGuard, '  if (error === null || error === undefined) return READ_STATE_OBSERVED;');
  });
  try {
    const plan = createPlan();
    const deletePlan = deleteShapedPlan();
    const actionUuids = { '03-created-chart': KS253_PRIMARY_CHART_UUID };

    // RED (a) — a RESOLVED null is read as absence: a false safe retry and a false committed outcome.
    const { journal: redCreateJournal } = planJournal(plan, actionUuids, 'ks253-idem-red', variant.OutcomeJournal);
    const redCreate = await variant.reconcileUnknownOutcome({
      journal: redCreateJournal, plan, adapter: ks253Adapter(() => null).adapter, target: target(),
    });
    assert.equal(redCreate.state, 'unchanged_safe_to_retry', 'the broken variant fabricates a safe retry from a resolved null');
    assert.equal(redCreate.entry.decision.retryAllowed, true);
    const { journal: redDeleteJournal } = planJournal(deletePlan, actionUuids, 'ks253-idem-red', variant.OutcomeJournal);
    const redDelete = await variant.reconcileUnknownOutcome({
      journal: redDeleteJournal, plan: deletePlan, adapter: ks253Adapter(() => null).adapter, target: target(),
    });
    assert.equal(redDelete.state, 'committed_equivalent', 'the broken variant fabricates a committed outcome from a resolved null');

    // RED (b) — a THROWN null crashes while digesting the non-observation.
    const { journal: redThrowJournal } = planJournal(plan, actionUuids, 'ks253-idem-red', variant.OutcomeJournal);
    await assert.rejects(
      variant.reconcileUnknownOutcome({
        journal: redThrowJournal, plan, adapter: ks253Adapter(() => { throw null; }).adapter, target: target(),
      }),
      /Canonical JSON/,
      'the broken variant crashes digesting a thrown null',
    );

    // GREEN — the real module keeps every untyped null/undefined UNKNOWN.
    const { journal: greenCreateJournal } = planJournal(plan, actionUuids);
    const greenCreate = await reconcileUnknownOutcome({
      journal: greenCreateJournal, plan, adapter: ks253Adapter(() => null).adapter, target: target(),
    });
    assert.equal(greenCreate.state, 'outcome_unknown');
    const { journal: greenThrowJournal } = planJournal(plan, actionUuids);
    const greenThrow = await reconcileUnknownOutcome({
      journal: greenThrowJournal, plan, adapter: ks253Adapter(() => { throw null; }).adapter, target: target(),
    });
    assert.equal(greenThrow.state, 'outcome_unknown');
    const { journal: greenDeleteJournal } = planJournal(deletePlan, actionUuids);
    const greenDelete = await reconcileUnknownOutcome({
      journal: greenDeleteJournal, plan: deletePlan, adapter: ks253Adapter(() => undefined).adapter, target: target(),
    });
    assert.equal(greenDelete.state, 'outcome_unknown');
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
