import test from 'node:test';
import assert from 'node:assert/strict';
import { loadH01PanRuntimeSourceV1, releaseH01PanRuntimeSourceV1 } from '../services/bi-control/src/runtime/pan-runtime-source.mjs';
const sourceRoot = process.env.KS292_PAN526_SOURCE;
const moduleUrl = new URL('../services/bi-control/src/runtime/local-runtime-context.mjs', import.meta.url);
// Synthetic shape fixtures only. Actual owned Docker acquisition/probes are separate.
const identity = () => ({ schemaVersion: 'pansphaira.portable-runtime/identity/v1',
  componentId: 'kaleidosphere-bi-agent', sourceCommit: 'dfc7f2ae2399109b90fe8a101f2d4eed465a7cef',
  sourceTree: 'ff9949615ec27bb37d848b0b01ca41d55f6994b7', imageDigest: 'sha256:' + 'a'.repeat(64),
  architecture: 'x86_64', productVersion: '0.18.1', runtime: { name: 'node', version: '24.14.0' },
  contractVersion: '1.0.0', instanceId: 'ks-unit-only', tenantId: 'synthetic-unit-only', generation: 1,
  authorityProfile: 'SAFE_GUIDED', effectiveRights: ['bi.catalog.read'],
  configurationDigest: 'b'.repeat(64), templateDigest: 'c'.repeat(64),
  policyDigest: 'd'.repeat(64), networkDigest: 'e'.repeat(64) });
const unitReply = () => ({httpStatus: 200, body: {
  schemaVersion: 'chimpmaera.bi/readback/v1', generationId: 'a'.repeat(64),
  summary: {source_engine: 'mssql', source_database: 'CM_BI_FIXTURE', source_mode: 'fixture',
    runtime_validation: 'SYNTHETIC_UNVALIDATED', status: 'ANALYZED_READ_ONLY', source_read_only: 1,
    relation_count: 2, column_count: 3, constraint_count: 1, index_count: 1},
  detailCount: 3, catalogSnapshot: {snapshot_sha256: '293a896156d8f6269c4ad33e8d632da653ea180d35a4ea5f390b0be52ce3e44a'},
  technicalOverview: {systemSchemaRows: 1, tableCapacityRows: 2, codeDependencyRows: 0, coverageRows: 9, biCandidateRows: 2},
  publication: {datasets: 6, charts: 13, dashboards: 5},
  projectionMirror: {state: 'IN_SYNC', inSync: true}
}});
const unitPins = () => Object.fromEntries(['superset-init', 'superset', 'bi-control', 'bi-agent'].map(role => [role, 'sha256:' + 'a'.repeat(64)]));
const unitImages = () => Object.entries(unitPins()).map(([component, imageId]) => ({ component, imageId }));
const spec = () => ({ expectedIdentity: identity(), qualifiedReadback: unitReply(),
  heldGenerationId: 'a'.repeat(64), imagePins: unitPins(),
  secretReferences: [{ slot: 'control-auth', referenceId: 'opaque:' + '7'.repeat(32) }] });
const actualInput = () => ({ observedIdentity: identity(), readback: unitReply(), imageObservations: unitImages(),
  boundaryObservation: { loopbackOnly: true, privileged: false, dockerSocketMounted: false, ownedResourcesOnly: true },
  observedAtMs: 1791130000000 });

test('H01 local opaque context feeds complete acquired facts to the same public readiness assessor', async () => {
  assert.ok(sourceRoot, 'Real exact PAN526 source required; no fixture SDK or skip');
  const source = await loadH01PanRuntimeSourceV1(sourceRoot);
  try {
    const mod = await import(moduleUrl.href).catch(error => {
      if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === moduleUrl.href) return {};
      throw error;
    });
    assert.equal(typeof mod.captureH01LocalRuntimeContextV1, 'function', 'Missing KS local context-to-common-readiness adapter');
    const handle = mod.captureH01LocalRuntimeContextV1(source, spec());
    const good = mod.assessH01LocalRuntimeReadinessV1(handle, actualInput());
    assert.equal(good.state, 'READY');
    assert.equal(good.executionAuthorityGranted, false);
    assert.ok(Object.isFrozen(good));
    const wrong = actualInput(); wrong.readback.body.summary.relation_count = 3;
    const bad = mod.assessH01LocalRuntimeReadinessV1(handle, wrong);
    assert.equal(bad.state, 'NOT_READY');
    assert.ok(bad.reasonCodes.includes('BUSINESS_PROBE_MISMATCH'));
    const subset = actualInput(); subset.imageObservations.pop();
    assert.equal(mod.assessH01LocalRuntimeReadinessV1(handle, subset).state, 'NOT_READY');
    assert.throws(() => mod.assessH01LocalRuntimeReadinessV1({ ...handle }, actualInput()), /H01_LOCAL_CONTEXT_DENIED/);
  } finally { releaseH01PanRuntimeSourceV1(source); }
});

test('H01 bound lifecycle preparation uses the single PAN Desired/Observed contract at actual use', async () => {
  const source = await loadH01PanRuntimeSourceV1(sourceRoot);
  try {
    const mod = await import(moduleUrl.href);
    assert.equal(typeof mod.captureH01LocalLifecycleJobV1, 'function', 'Missing KS typed lifecycle preparation against common contract');
    const handle = mod.captureH01LocalRuntimeContextV1(source, spec());
    const plan = mod.captureH01LocalLifecycleJobV1(handle, { action: 'stop', jobId: 'unit-stop-one', nowMs: 1791130000000, deadlineMs: 30000 });
    assert.equal(plan.desiredState.phase, 'stopped');
    assert.equal(plan.job.audience, 'kaleidosphere-runtime-v1');
    assert.deepEqual(plan.desiredState.secretReferences, spec().secretReferences);
    assert.ok(Object.isFrozen(plan.job) && Object.isFrozen(plan.desiredState));
    const bound = mod.validateH01LocalLifecycleAtUseV1(handle, plan.job, plan.desiredState, identity(), 1791130000001);
    assert.ok(Object.isFrozen(bound));
    const foreign = structuredClone(plan.job); foreign.tenantId = 'foreign-tenant';
    assert.throws(() => mod.validateH01LocalLifecycleAtUseV1(handle, foreign, plan.desiredState, identity(), 1791130000001), /RUNTIME_LIFECYCLE_JOB_DENIED/);
    const changedRuntime = identity(); changedRuntime.generation++;
    assert.throws(() => mod.validateH01LocalLifecycleAtUseV1(handle, plan.job, plan.desiredState, changedRuntime, 1791130000001), /H01_LOCAL_CONTEXT_DENIED/);
    const changedDesired = structuredClone(plan.desiredState); changedDesired.secretReferences[0].referenceId = 'opaque:' + '8'.repeat(32);
    assert.throws(() => mod.validateH01LocalLifecycleAtUseV1(handle, plan.job, changedDesired, identity(), 1791130000001), /H01_LOCAL_CONTEXT_DENIED/);
  } finally { releaseH01PanRuntimeSourceV1(source); }
});

test('H01 actual-use validation refuses elapsed job deadline even inside producer shape-age allowance', async () => {
  const source = await loadH01PanRuntimeSourceV1(sourceRoot);
  try {
    const mod = await import(moduleUrl.href);
    const handle = mod.captureH01LocalRuntimeContextV1(source, spec());
    const plan = mod.captureH01LocalLifecycleJobV1(handle, { action: 'start', jobId: 'unit-expired-one', nowMs: 1791130000000, deadlineMs: 10 });
    assert.throws(() => mod.validateH01LocalLifecycleAtUseV1(handle, plan.job, plan.desiredState, identity(), 1791130000011), /H01_LOCAL_JOB_DEADLINE_EXPIRED/);
  } finally { releaseH01PanRuntimeSourceV1(source); }
});

test('H01 records interrupted actual dispatch as outcome_unknown rather than invented definite failure', async () => {
  const source = await loadH01PanRuntimeSourceV1(sourceRoot);
  try {
    const mod = await import(moduleUrl.href);
    assert.equal(typeof mod.recordH01LocalLifecycleOutcomeV1, 'function', 'Missing honest common lifecycle outcome adapter');
    const handle = mod.captureH01LocalRuntimeContextV1(source, spec());
    const plan = mod.captureH01LocalLifecycleJobV1(handle, { action: 'restart', jobId: 'unit-interrupted-one', nowMs: 1791130000000, deadlineMs: 30000 });
    const dispatch = mod.validateH01LocalLifecycleAtUseV1(handle, plan.job, plan.desiredState, identity(), 1791130000001);
    const facts = { interrupted: true, exitCode: null, observedState: null, completedAtMs: 1791130000002 };
    const receipt = mod.recordH01LocalLifecycleOutcomeV1(dispatch, facts);
    assert.equal(receipt.outcome, 'outcome_unknown');
    assert.equal(receipt.reasonCode, 'DISPATCH_INTERRUPTED');
    assert.equal(receipt.observedStateDigest, null);
    assert.equal(receipt.executionAuthorityGranted, false);
    assert.ok(Object.isFrozen(receipt));
    assert.throws(() => mod.recordH01LocalLifecycleOutcomeV1(dispatch, facts), /H01_LOCAL_CONTEXT_DENIED/);
    assert.throws(() => mod.recordH01LocalLifecycleOutcomeV1({ ...dispatch }, facts), /H01_LOCAL_CONTEXT_DENIED/);
  } finally { releaseH01PanRuntimeSourceV1(source); }
});

test('H01 derives definite outcomes only from bound actual observed state', async () => {
  const source = await loadH01PanRuntimeSourceV1(sourceRoot);
  try {
    const mod = await import(moduleUrl.href);
    const handle = mod.captureH01LocalRuntimeContextV1(source, spec());
    const plan = mod.captureH01LocalLifecycleJobV1(handle, { action: 'stop', jobId: 'unit-observed-one', nowMs: 1791130000000, deadlineMs: 30000 });
    const observed = phase => ({ schemaVersion: 'pansphaira.portable-runtime/observed/v1', identity: identity(), phase,
      secretReferences: spec().secretReferences, observedAtMs: 1791130000002 });
    for (const [phase, exitCode, outcome, reason] of [
      ['stopped', 0, 'succeeded', 'OBSERVED_TARGET_REACHED'],
      ['running', 0, 'failed', 'OBSERVED_TARGET_NOT_REACHED'],
      ['running', 1, 'failed', 'DISPATCH_FAILED']]) {
      const dispatch = mod.validateH01LocalLifecycleAtUseV1(handle, plan.job, plan.desiredState, identity(), 1791130000001);
      const receipt = mod.recordH01LocalLifecycleOutcomeV1(dispatch, { interrupted: false, exitCode,
        observedState: observed(phase), completedAtMs: 1791130000003 });
      assert.equal(receipt.outcome, outcome);
      assert.equal(receipt.reasonCode, reason);
      assert.match(receipt.observedStateDigest, /^[a-f0-9]{64}$/);
      assert.equal(receipt.executionAuthorityGranted, false);
    }
  } finally { releaseH01PanRuntimeSourceV1(source); }
});

test('H01 lifecycle never treats stale or post-receipt state as a definitive outcome observation', async () => {
  const source = await loadH01PanRuntimeSourceV1(sourceRoot);
  try {
    const mod = await import(moduleUrl.href);
    const handle = mod.captureH01LocalRuntimeContextV1(source, spec());
    const plan = mod.captureH01LocalLifecycleJobV1(handle, { action: 'stop', jobId: 'unit-stale-observation', nowMs: 1791130000010, deadlineMs: 30000 });
    for (const observedAtMs of [1791130000000, 1791130000021]) {
      const dispatch = mod.validateH01LocalLifecycleAtUseV1(handle, plan.job, plan.desiredState, identity(), 1791130000011);
      const observed = { schemaVersion: 'pansphaira.portable-runtime/observed/v1', identity: identity(), phase: 'stopped',
        secretReferences: spec().secretReferences, observedAtMs };
      const receipt = mod.recordH01LocalLifecycleOutcomeV1(dispatch, { interrupted: false, exitCode: 0,
        observedState: observed, completedAtMs: 1791130000020 });
      assert.equal(receipt.outcome, 'outcome_unknown', 'An old or future state is not a definitive post-dispatch observation');
      assert.equal(receipt.observedStateDigest, null);
    }
  } finally { releaseH01PanRuntimeSourceV1(source); }
});

// Shape-only unit metadata; exporting this identity never grants execution or
// makes these fixtures a native runtime/image qualification.
test('H01 captured identity is available only through the held opaque owner context',async()=>{
  const source=await loadH01PanRuntimeSourceV1(sourceRoot);
  try{
    const mod=await import(moduleUrl.href);
    assert.equal(typeof mod.readH01CapturedRuntimeIdentityV1,'function','missing captured identity owner-only seam');
    const handle=mod.captureH01LocalRuntimeContextV1(source,spec());
    const captured=mod.readH01CapturedRuntimeIdentityV1(handle);
    assert.deepEqual(captured.identity,identity());assert.equal(captured.executionAuthorityGranted,false);
    assert.ok(Object.isFrozen(captured)&&Object.isFrozen(captured.identity));
    assert.throws(()=>mod.readH01CapturedRuntimeIdentityV1({...handle}),/H01_LOCAL_CONTEXT_DENIED/);
    assert.throws(()=>mod.readH01CapturedRuntimeIdentityV1({identity:identity(),state:'READY'}),/H01_LOCAL_CONTEXT_DENIED/);
  }finally{releaseH01PanRuntimeSourceV1(source);}
});
