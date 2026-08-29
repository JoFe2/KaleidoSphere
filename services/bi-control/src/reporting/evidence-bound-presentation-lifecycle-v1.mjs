import {types as utilTypes} from 'node:util';

import {canonicalJson, identitySha256, normalizeJsonValue} from '../db-analyzer/core.mjs';
import {
  EVIDENCE_BOUND_RENDERER_FORMAT_V1,
  EVIDENCE_BOUND_RENDERER_KIND_V1,
  buildEvidenceBoundRendererV1,
  verifyEvidenceBoundRendererReplayV1,
} from './evidence-bound-renderer-v1.mjs';

export const EVIDENCE_BOUND_PRESENTATION_LIFECYCLE_SCHEMA_V1 =
  'kaleidosphere.reporting/evidence-bound-presentation-lifecycle/v1';
export const EVIDENCE_BOUND_PRESENTATION_LIFECYCLE_KIND_V1 = 'SEALED_RENDERER';
export const EVIDENCE_BOUND_PRESENTATION_LIFECYCLE_STATES_V1 = Object.freeze(['UNLOADED', 'LOADED']);
export const EVIDENCE_BOUND_PRESENTATION_LIFECYCLE_RESIDUE_SCHEMA_V1 =
  'kaleidosphere.reporting/evidence-bound-presentation-residue/v1';

const HASH = /^[a-f0-9]{64}$/;
const LOAD_KEYS = Object.freeze(['projection', 'rendererKind', 'exportFormat']);
const COVERAGE_LOAD_KEYS = Object.freeze([...LOAD_KEYS, 'coverageInput']);
const REPLAY_KEYS = Object.freeze(['receipt', 'snapshot']);
const CHECKPOINT_KEYS = Object.freeze(['schemaVersion', 'state', 'renderSha256', 'residueSha256']);
const RESIDUE_KEYS = Object.freeze([
  'registrations', 'listeners', 'timers', 'caches', 'credentialHandles', 'sourceHandles',
]);

const fail = (code) => {
  const error = new Error(code);
  error.code = code;
  throw error;
};
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && !utilTypes.isProxy(value) && Object.getPrototypeOf(value) === Object.prototype;
const same = (left, right) => canonicalJson(left) === canonicalJson(right);

function exact(value, keys, code) {
  if (!plain(value)) fail(code);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key !== 'string' || descriptor?.enumerable !== true || !Object.hasOwn(descriptor ?? {}, 'value');
  }) || !same([...ownKeys].sort(), [...keys].sort())) fail(code);
}

function frozen(value) {
  const clone = structuredClone(normalizeJsonValue(value));
  const visit = (item) => {
    if (item && typeof item === 'object' && !Object.isFrozen(item)) {
      Object.values(item).forEach(visit);
      Object.freeze(item);
    }
    return item;
  };
  return visit(clone);
}

const zeroResidueBody = Object.freeze({
  schemaVersion: EVIDENCE_BOUND_PRESENTATION_LIFECYCLE_RESIDUE_SCHEMA_V1,
  registrations: [],
  listeners: [],
  timers: [],
  caches: [],
  credentialHandles: [],
  sourceHandles: [],
});
export const ZERO_EVIDENCE_BOUND_PRESENTATION_RESIDUE_SNAPSHOT_V1 = frozen({
  ...zeroResidueBody,
  residueSha256: identitySha256(zeroResidueBody),
});

function residueSnapshot() {
  return frozen(ZERO_EVIDENCE_BOUND_PRESENTATION_RESIDUE_SNAPSHOT_V1);
}

function parseLoad(value, suppliedOptions) {
  if (suppliedOptions !== undefined || !plain(value) || !Object.hasOwn(value, 'projection')) {
    return {rendererInput: value, projection: value, suppliedOptions};
  }
  exact(value, Object.hasOwn(value, 'coverageInput') ? COVERAGE_LOAD_KEYS : LOAD_KEYS,
    'EVIDENCE_BOUND_PRESENTATION_LIFECYCLE_INPUT_DENIED');
  return {rendererInput: value, projection: value.projection, suppliedOptions: undefined};
}

function prepare(value, suppliedOptions) {
  const {rendererInput, projection, suppliedOptions: options} = parseLoad(value, suppliedOptions);
  const rendered = buildEvidenceBoundRendererV1(rendererInput, options);
  // The renderer has already closed and verified the projection. Keep an isolated
  // copy for later replay so caller mutation cannot alter lifecycle state.
  return {
    rendererInput: frozen(rendererInput),
    projection: frozen(projection),
    rendered,
    options: {
      rendererKind: EVIDENCE_BOUND_RENDERER_KIND_V1,
      exportFormat: EVIDENCE_BOUND_RENDERER_FORMAT_V1,
    },
  };
}

function checkpoint(current) {
  const body = {
    schemaVersion: EVIDENCE_BOUND_PRESENTATION_LIFECYCLE_SCHEMA_V1,
    state: current === null ? 'UNLOADED' : 'LOADED',
    renderSha256: current?.rendered.renderSha256 ?? null,
    residueSha256: ZERO_EVIDENCE_BOUND_PRESENTATION_RESIDUE_SNAPSHOT_V1.residueSha256,
  };
  return frozen({...body, checkpointSha256: identitySha256(body)});
}

function validateCheckpoint(value) {
  exact(value, [...CHECKPOINT_KEYS, 'checkpointSha256'], 'EVIDENCE_BOUND_PRESENTATION_LIFECYCLE_CHECKPOINT_DENIED');
  if (value.schemaVersion !== EVIDENCE_BOUND_PRESENTATION_LIFECYCLE_SCHEMA_V1
    || !EVIDENCE_BOUND_PRESENTATION_LIFECYCLE_STATES_V1.includes(value.state)
    || value.state === 'LOADED' && !HASH.test(value.renderSha256 ?? '')
    || value.state === 'UNLOADED' && value.renderSha256 !== null
    || value.residueSha256 !== ZERO_EVIDENCE_BOUND_PRESENTATION_RESIDUE_SNAPSHOT_V1.residueSha256
    || !HASH.test(value.checkpointSha256 ?? '')) {
    fail('EVIDENCE_BOUND_PRESENTATION_LIFECYCLE_CHECKPOINT_DENIED');
  }
  const {checkpointSha256: _checkpoint, ...body} = value;
  if (identitySha256(body) !== value.checkpointSha256) fail('EVIDENCE_BOUND_PRESENTATION_LIFECYCLE_CHECKPOINT_DENIED');
  return value;
}

function status(current) {
  return frozen({
    schemaVersion: EVIDENCE_BOUND_PRESENTATION_LIFECYCLE_SCHEMA_V1,
    lifecycleKind: EVIDENCE_BOUND_PRESENTATION_LIFECYCLE_KIND_V1,
    state: current === null ? 'UNLOADED' : 'LOADED',
    renderSha256: current?.rendered.renderSha256 ?? null,
    residueSha256: ZERO_EVIDENCE_BOUND_PRESENTATION_RESIDUE_SNAPSHOT_V1.residueSha256,
  });
}

export function createEvidenceBoundPresentationLifecycleV1() {
  let current = null;

  const load = (value, suppliedOptions) => {
    const next = prepare(value, suppliedOptions);
    if (current !== null) {
      if (same(current.rendered, next.rendered)) return current.rendered;
      fail('EVIDENCE_BOUND_PRESENTATION_LIFECYCLE_ALREADY_LOADED');
    }
    current = next;
    return current.rendered;
  };

  const unload = () => {
    current = null;
    return residueSnapshot();
  };

  const replace = (value, suppliedOptions) => {
    // Prepare before changing current: an invalid HMR candidate leaves the old
    // sealed render loaded and therefore gives replacement transactional rollback.
    const next = prepare(value, suppliedOptions);
    current = next;
    return current.rendered;
  };

  const replayReadback = (replayEvidence) => {
    if (current === null) fail('EVIDENCE_BOUND_PRESENTATION_LIFECYCLE_NOT_LOADED');
    exact(replayEvidence, REPLAY_KEYS, 'EVIDENCE_BOUND_PRESENTATION_REPLAY_DENIED');
    return verifyEvidenceBoundRendererReplayV1(
      current.rendered,
      current.rendererInput,
      replayEvidence,
      undefined,
    );
  };

  const rollback = (...args) => {
    if (args.length > 1) fail('EVIDENCE_BOUND_PRESENTATION_ROLLBACK_DENIED');
    if (args.length === 1 && args[0] !== undefined) validateCheckpoint(args[0]);
    current = null;
    return residueSnapshot();
  };

  const api = {
    load,
    unload,
    replace,
    hmrReplace: replace,
    replayReadback,
    replay: replayReadback,
    residueSnapshot,
    snapshot: residueSnapshot,
    checkpoint: () => checkpoint(current),
    rollback,
    status: () => status(current),
  };
  return Object.freeze(api);
}

export const createEvidenceBoundPresentationLifecycle = createEvidenceBoundPresentationLifecycleV1;
export const getEvidenceBoundPresentationResidueSnapshotV1 = residueSnapshot;
export const snapshotEvidenceBoundPresentationResidueV1 = residueSnapshot;
export const ZERO_RESIDUE_SNAPSHOT_V1 = ZERO_EVIDENCE_BOUND_PRESENTATION_RESIDUE_SNAPSHOT_V1;

export function replayEvidenceBoundPresentationReadbackV1(lifecycle, replayEvidence) {
  if (!lifecycle || typeof lifecycle.replayReadback !== 'function') {
    fail('EVIDENCE_BOUND_PRESENTATION_LIFECYCLE_DENIED');
  }
  return lifecycle.replayReadback(replayEvidence);
}

export function replaceEvidenceBoundPresentationHMRV1(lifecycle, value, suppliedOptions) {
  if (!lifecycle || typeof lifecycle.hmrReplace !== 'function') {
    fail('EVIDENCE_BOUND_PRESENTATION_LIFECYCLE_DENIED');
  }
  return lifecycle.hmrReplace(value, suppliedOptions);
}

export const loadEvidenceBoundPresentationV1 = (lifecycle, value, suppliedOptions) => {
  if (!lifecycle || typeof lifecycle.load !== 'function') fail('EVIDENCE_BOUND_PRESENTATION_LIFECYCLE_DENIED');
  return lifecycle.load(value, suppliedOptions);
};
export const unloadEvidenceBoundPresentationV1 = (lifecycle) => {
  if (!lifecycle || typeof lifecycle.unload !== 'function') fail('EVIDENCE_BOUND_PRESENTATION_LIFECYCLE_DENIED');
  return lifecycle.unload();
};
export const rollbackEvidenceBoundPresentationV1 = (lifecycle, checkpointValue) => {
  if (!lifecycle || typeof lifecycle.rollback !== 'function') fail('EVIDENCE_BOUND_PRESENTATION_LIFECYCLE_DENIED');
  return checkpointValue === undefined ? lifecycle.rollback() : lifecycle.rollback(checkpointValue);
};

export {RESIDUE_KEYS};
