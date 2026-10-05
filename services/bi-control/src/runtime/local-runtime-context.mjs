import { createHash } from 'node:crypto';
import { canonicalJson } from '../canonical-json.js';
import { readLocalObservedWireJson } from '../../../../scripts/lib/h01-local-wire-data.mjs';
import { checkLocalDemoStackFacts } from '../../../../scripts/lib/h01-local-stack-facts.mjs';
import { applyH01PanRuntimeContractV1 } from './pan-runtime-source.mjs';

const contexts = new WeakMap();
const hash = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
function deny() { throw new Error('H01_LOCAL_CONTEXT_DENIED'); }
function exact(value, keys) {
  if (!value || Array.isArray(value) || typeof value !== 'object'
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) deny();
}
function businessValue(readback, imageObservations, heldGenerationId, pins) {
  const body = readback?.body;
  const summaryKeys = ['source_engine', 'source_database', 'source_mode', 'runtime_validation', 'status',
    'source_read_only', 'relation_count', 'column_count', 'constraint_count', 'index_count'];
  const verdict = checkLocalDemoStackFacts({ readback, imageObservations }, heldGenerationId, pins);
  return { localFactsCode: verdict.code, generationId: body?.generationId ?? null,
    schemaVersion: body?.schemaVersion ?? null,
    summary: Object.fromEntries(summaryKeys.map(key => [key, body?.summary?.[key] ?? null])),
    detailCount: body?.detailCount ?? null, catalogSnapshotDigest: body?.catalogSnapshot?.snapshot_sha256 ?? null,
    technicalOverview: body?.technicalOverview ?? null,
    publication: { datasets: body?.publication?.datasets ?? null, charts: body?.publication?.charts ?? null,
      dashboards: body?.publication?.dashboards ?? null },
    projectionMirror: { state: body?.projectionMirror?.state ?? null, inSync: body?.projectionMirror?.inSync ?? null },
    serviceImageObservations: [...imageObservations].sort((a, b) => a.component.localeCompare(b.component)) };
}

// Only the local operator's trusted factory captures expectations from qualified
// source/backup/policy bytes. A transport copy cannot reconstruct this handle.
// The context is observation/planning custody, not Docker or hosted authority.
export function captureH01LocalRuntimeContextV1(source, value) {
  const spec = readLocalObservedWireJson(value);
  exact(spec, ['expectedIdentity', 'qualifiedReadback', 'heldGenerationId', 'imagePins', 'secretReferences']);
  const identity = applyH01PanRuntimeContractV1(source, 'validateRuntimeIdentityV1', spec.expectedIdentity);
  if (identity.componentId !== 'kaleidosphere-bi-agent' || identity.imageDigest !== spec.imagePins?.['bi-agent']) deny();
  const images = Object.entries(spec.imagePins).map(([component, imageId]) => ({ component, imageId }));
  const baseline = checkLocalDemoStackFacts({ readback: spec.qualifiedReadback, imageObservations: images }, spec.heldGenerationId, spec.imagePins);
  if (baseline.status !== 'LOCAL_STACK_FACTS_VERIFIED') deny();
  const desired = applyH01PanRuntimeContractV1(source, 'validateRuntimeDesiredStateV1', {
    schemaVersion: 'pansphaira.portable-runtime/desired/v1', identity, phase: 'running', secretReferences: spec.secretReferences });
  const handle = Object.freeze({});
  contexts.set(handle, { source, identity, secretReferences: desired.secretReferences,
    heldGenerationId: spec.heldGenerationId, pins: spec.imagePins,
    expectedValueDigest: hash(businessValue(spec.qualifiedReadback, images, spec.heldGenerationId, spec.imagePins)) });
  return handle;
}

// The actual owned collector supplies observations; this API never accepts a
// caller READY/PASS, invents native facts, registers roles or opens an effect.
export function assessH01LocalRuntimeReadinessV1(handle, value) {
  const held = contexts.get(handle);
  if (!held) deny();
  const observation = readLocalObservedWireJson(value);
  exact(observation, ['observedIdentity', 'readback', 'imageObservations', 'boundaryObservation', 'observedAtMs']);
  if (!Array.isArray(observation.imageObservations)) deny();
  const observedIdentity = applyH01PanRuntimeContractV1(held.source, 'validateRuntimeIdentityV1', observation.observedIdentity);
  return applyH01PanRuntimeContractV1(held.source, 'assessRuntimeReadinessV1', {
    expectedIdentity: held.identity, observedIdentity, observedAtMs: observation.observedAtMs,
    boundaryObservation: observation.boundaryObservation,
    probe: { probeId: 'kaleidosphere-bi-readback-v1', httpStatus: observation.readback?.httpStatus,
      expectedValueDigest: held.expectedValueDigest,
      observedValueDigest: hash(businessValue(observation.readback, observation.imageObservations, held.heldGenerationId, held.pins)),
      sourceObservationDigest: hash(observation) } });
}

// Owner-only read of the identity already held by the opaque local context.
// This acquires no new observation, readiness, execution or activation grant;
// a JSON copy or a client-supplied READY cannot reconstruct the capability.
export function readH01CapturedRuntimeIdentityV1(handle) {
  const held = contexts.get(handle);
  if (!held) deny();
  const identity = applyH01PanRuntimeContractV1(held.source, 'validateRuntimeIdentityV1', held.identity);
  return Object.freeze({ identity, executionAuthorityGranted: false });
}

const dispatches = new WeakMap();

export function captureH01LocalLifecycleJobV1(handle, value) {
  const held = contexts.get(handle);
  if (!held) deny();
  const options = readLocalObservedWireJson(value);
  exact(options, ['action', 'jobId', 'nowMs', 'deadlineMs']);
  const desiredState = applyH01PanRuntimeContractV1(held.source, 'validateRuntimeDesiredStateV1', {
    schemaVersion: 'pansphaira.portable-runtime/desired/v1', identity: held.identity,
    phase: options.action === 'stop' ? 'stopped' : 'running', secretReferences: held.secretReferences });
  const job = applyH01PanRuntimeContractV1(held.source, 'validateRuntimeLifecycleJobV1', {
    schemaVersion: 'pansphaira.portable-runtime/lifecycle-job/v1', jobId: options.jobId, action: options.action,
    audience: 'kaleidosphere-runtime-v1', tenantId: held.identity.tenantId, instanceId: held.identity.instanceId,
    componentId: held.identity.componentId, generation: held.identity.generation,
    identityDigest: applyH01PanRuntimeContractV1(held.source, 'runtimeIdentityDigestV1', held.identity),
    desiredStateDigest: applyH01PanRuntimeContractV1(held.source, 'runtimeDesiredStateDigestV1', desiredState),
    issuedAtMs: options.nowMs, deadlineMs: options.deadlineMs },
    { expectedIdentity: held.identity, desiredState, nowMs: options.nowMs });
  return Object.freeze({ desiredState, job });
}

// The owned driver must acquire the current physical identity before dispatch;
// it must never substitute job metadata or a caller PASS for this acquisition.
// This validation token is process-local custody, NOT execution permission.
export function validateH01LocalLifecycleAtUseV1(handle, value, desiredValue, actualIdentity, nowMs) {
  const held = contexts.get(handle);
  if (!held) deny();
  const desiredState = applyH01PanRuntimeContractV1(held.source, 'validateRuntimeDesiredStateV1', desiredValue);
  if (hash(desiredState.secretReferences) !== hash(held.secretReferences)) deny();
  const observed = applyH01PanRuntimeContractV1(held.source, 'validateRuntimeIdentityV1', actualIdentity);
  const expectedDigest = applyH01PanRuntimeContractV1(held.source, 'runtimeIdentityDigestV1', held.identity);
  if (applyH01PanRuntimeContractV1(held.source, 'runtimeIdentityDigestV1', observed) !== expectedDigest) deny();
  const context = { expectedIdentity: held.identity, desiredState, nowMs };
  const job = applyH01PanRuntimeContractV1(held.source, 'validateRuntimeLifecycleJobV1', value, context);
  if (nowMs - job.issuedAtMs > job.deadlineMs) throw new Error('H01_LOCAL_JOB_DEADLINE_EXPIRED');
  const dispatch = Object.freeze({});
  dispatches.set(dispatch, { held, job, desiredState,
    jobDigest: applyH01PanRuntimeContractV1(held.source, 'runtimeLifecycleJobDigestV1', job, context) });
  return dispatch;
}
// Trusted dispatchers supply actual command/observation facts, never an outcome
// chosen by a caller. An unobserved or interrupted dispatch stays unknown.
export function recordH01LocalLifecycleOutcomeV1(dispatch, value) {
  const entry = dispatches.get(dispatch);
  if (!entry) deny();
  const facts = readLocalObservedWireJson(value);
  exact(facts, ['interrupted', 'exitCode', 'observedState', 'completedAtMs']);
  if (typeof facts.interrupted !== 'boolean' || !Number.isSafeInteger(facts.completedAtMs)
    || facts.completedAtMs < entry.job.issuedAtMs
    || !(facts.exitCode === null || Number.isSafeInteger(facts.exitCode))) deny();
  let outcome = 'outcome_unknown', reasonCode = 'DISPATCH_INTERRUPTED', observedStateDigest = null;
  if (!facts.interrupted && facts.exitCode !== null && facts.observedState !== null) {
    const observed = applyH01PanRuntimeContractV1(entry.held.source, 'validateRuntimeObservedStateV1', facts.observedState);
    if (observed.phase !== 'not_observed' && observed.observedAtMs >= entry.job.issuedAtMs
      && observed.observedAtMs <= facts.completedAtMs) {
      observedStateDigest = hash(observed);
      const actualDigest = applyH01PanRuntimeContractV1(entry.held.source, 'runtimeIdentityDigestV1', observed.identity);
      const expectedDigest = applyH01PanRuntimeContractV1(entry.held.source, 'runtimeIdentityDigestV1', entry.held.identity);
      const reached = observed.phase === entry.desiredState.phase && actualDigest === expectedDigest
        && hash(observed.secretReferences) === hash(entry.held.secretReferences);
      outcome = facts.exitCode === 0 && reached ? 'succeeded' : 'failed';
      reasonCode = facts.exitCode !== 0 ? 'DISPATCH_FAILED'
        : reached ? 'OBSERVED_TARGET_REACHED' : 'OBSERVED_TARGET_NOT_REACHED';
    }
  }
  const receipt = applyH01PanRuntimeContractV1(entry.held.source, 'validateRuntimeLifecycleReceiptV1', {
    schemaVersion: 'pansphaira.portable-runtime/lifecycle-receipt/v1', jobId: entry.job.jobId,
    jobDigest: entry.jobDigest, outcome, reasonCode, observedStateDigest,
    completedAtMs: facts.completedAtMs, executionAuthorityGranted: false });
  dispatches.delete(dispatch);
  return receipt;
}

