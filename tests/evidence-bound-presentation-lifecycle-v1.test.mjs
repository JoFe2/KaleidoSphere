import assert from 'node:assert/strict';
import test from 'node:test';

import {identitySha256} from '../services/bi-control/src/db-analyzer/core.mjs';
import {
  EVIDENCE_BOUND_REPORT_DATASET_SCHEMA_V1,
  EVIDENCE_BOUND_REPORT_SPEC_SCHEMA_V1,
  buildEvidenceBoundReportV1,
} from '../services/bi-control/src/reporting/evidence-bound-report-v1.mjs';
import {
  EVIDENCE_BOUND_RENDERER_FORMAT_V1,
  EVIDENCE_BOUND_RENDERER_KIND_V1,
  buildEvidenceBoundRendererV1,
} from '../services/bi-control/src/reporting/evidence-bound-renderer-v1.mjs';
import {
  EVIDENCE_BOUND_PRESENTATION_LIFECYCLE_RESIDUE_SCHEMA_V1,
  EVIDENCE_BOUND_PRESENTATION_LIFECYCLE_SCHEMA_V1,
  ZERO_EVIDENCE_BOUND_PRESENTATION_RESIDUE_SNAPSHOT_V1,
  createEvidenceBoundPresentationLifecycleV1,
  replayEvidenceBoundPresentationReadbackV1,
  replaceEvidenceBoundPresentationHMRV1,
} from '../services/bi-control/src/reporting/evidence-bound-presentation-lifecycle-v1.mjs';

const H = (character) => character.repeat(64);
const OPTIONS = {rendererKind: EVIDENCE_BOUND_RENDERER_KIND_V1, exportFormat: EVIDENCE_BOUND_RENDERER_FORMAT_V1};
const BINDINGS = Object.freeze({
  snapshotSha256: H('1'), receiptSha256: H('2'), coverageSha256: H('3'),
  capabilitySha256: H('4'), resultSha256: H('5'),
});
const OTHER_BINDINGS = Object.freeze({
  snapshotSha256: H('6'), receiptSha256: H('7'), coverageSha256: H('8'),
  capabilitySha256: H('9'), resultSha256: H('a'),
});

function report(bindings = BINDINGS, title = 'Orders evidence report', value = 42) {
  return buildEvidenceBoundReportV1({
    schemaVersion: EVIDENCE_BOUND_REPORT_SPEC_SCHEMA_V1,
    reportId: 'orders-report',
    title,
    dataset: {
      schemaVersion: EVIDENCE_BOUND_REPORT_DATASET_SCHEMA_V1,
      datasetId: 'orders-total', kind: 'METRIC', columns: [{key: 'value'}],
      columnDefinitions: [{label: 'Orders total', dataType: 'number', nullable: false}],
      rows: [[value]], differentiator: null,
    },
    bindings: {...bindings},
  });
}

function evidence(suffix = '') {
  return {
    receipt: {receiptId: `receipt-${suffix || 'one'}`, schemaVersion: 'test/receipt/v1', status: 'SEALED'},
    snapshot: {snapshotId: `snapshot-${suffix || 'one'}`, schemaVersion: 'test/snapshot/v1', state: 'SEALED'},
  };
}

function boundReport(bindings = BINDINGS, suffix = '') {
  const readback = evidence(suffix);
  return {
    report: report({
      ...bindings,
      receiptSha256: identitySha256(readback.receipt),
      snapshotSha256: identitySha256(readback.snapshot),
    }),
    readback,
  };
}

function assertDeepFrozen(value) {
  if (!value || typeof value !== 'object') return;
  assert(Object.isFrozen(value));
  Object.values(value).forEach(assertDeepFrozen);
}

test('explicit load and idempotent unload have an exact zero-residue boundary', () => {
  const lifecycle = createEvidenceBoundPresentationLifecycleV1();
  const before = lifecycle.residueSnapshot();
  assert.equal(before.schemaVersion, EVIDENCE_BOUND_PRESENTATION_LIFECYCLE_RESIDUE_SCHEMA_V1);
  assert.deepEqual(before, ZERO_EVIDENCE_BOUND_PRESENTATION_RESIDUE_SNAPSHOT_V1);
  assertDeepFrozen(before);

  const source = boundReport();
  const rawBefore = structuredClone(source.report);
  const rendered = lifecycle.load(source.report, OPTIONS);
  assert.equal(lifecycle.status().schemaVersion, EVIDENCE_BOUND_PRESENTATION_LIFECYCLE_SCHEMA_V1);
  assert.equal(lifecycle.status().state, 'LOADED');
  assert.deepEqual(source.report, rawBefore);
  assertDeepFrozen(rendered);

  const after = lifecycle.unload();
  const repeated = lifecycle.unload();
  assert.deepEqual(after, before);
  assert.deepEqual(repeated, before);
  assert.equal(lifecycle.status().state, 'UNLOADED');
});

test('replay is readback-only, verifies both bound identities, and HMR replacement is transactional', () => {
  const lifecycle = createEvidenceBoundPresentationLifecycleV1();
  const first = boundReport(BINDINGS, 'first');
  const second = boundReport(OTHER_BINDINGS, 'second');
  const before = lifecycle.residueSnapshot();
  const firstRender = lifecycle.load({projection: first.report, ...OPTIONS});

  assert.deepEqual(replayEvidenceBoundPresentationReadbackV1(lifecycle, first.readback), firstRender);
  assert.equal(lifecycle.checkpoint().state, 'LOADED');

  const secondRender = replaceEvidenceBoundPresentationHMRV1(lifecycle, second.report, OPTIONS);
  assert.notEqual(secondRender.renderSha256, firstRender.renderSha256);
  assert.deepEqual(lifecycle.residueSnapshot(), before);
  assert.deepEqual(lifecycle.replay(second.readback), secondRender);

  assert.throws(() => lifecycle.replay(first.readback), /EVIDENCE_BOUND_RENDERER_REPLAY_(?:RECEIPT|SNAPSHOT)_DIGEST_DENIED/);
  assert.throws(() => lifecycle.hmrReplace({projection: second.report, ...OPTIONS, dispatch: true}), /EVIDENCE_BOUND_PRESENTATION_LIFECYCLE_INPUT_DENIED/);
  assert.equal(lifecycle.status().renderSha256, secondRender.renderSha256);

  // A failed candidate never replaces the old sealed render.
  assert.throws(() => lifecycle.replace({...second.report, title: 'not a valid replacement'}), /EVIDENCE_BOUND_REPORT_/);
  assert.equal(lifecycle.status().renderSha256, secondRender.renderSha256);
  assert.deepEqual(lifecycle.replay(second.readback), secondRender);

  const rollbackResidue = lifecycle.rollback(lifecycle.checkpoint());
  assert.deepEqual(rollbackResidue, before);
  assert.equal(lifecycle.status().state, 'UNLOADED');
});

test('lifecycle keeps renderer digests deterministic and does not mutate the governed projection', () => {
  const first = report();
  const second = report();
  const left = buildEvidenceBoundRendererV1(first, OPTIONS);
  const right = buildEvidenceBoundRendererV1(second, OPTIONS);
  assert.equal(left.datasetSha256, right.datasetSha256);
  assert.equal(left.specSha256, right.specSha256);
  assert.equal(left.viewSha256, right.viewSha256);
  assert.equal(left.renderSha256, right.renderSha256);

  const lifecycle = createEvidenceBoundPresentationLifecycleV1();
  const original = structuredClone(first);
  lifecycle.load(first);
  assert.deepEqual(first, original);
  assert.equal(lifecycle.unload().residueSha256, ZERO_EVIDENCE_BOUND_PRESENTATION_RESIDUE_SNAPSHOT_V1.residueSha256);
});

test('registration, listener, timer, cache, credential, source-handle and authority surfaces fail closed', () => {
  const lifecycle = createEvidenceBoundPresentationLifecycleV1();
  const source = report();
  for (const badInput of [
    {projection: source, registration: true},
    {projection: source, listener: true},
    {projection: source, timer: true},
    {projection: source, cache: true},
    {projection: source, credentialHandle: 'secret'},
    {projection: source, sourceHandle: 'db'},
    {projection: source, mutation: true},
    {projection: source, fetch: true},
    {projection: source, dispatch: true},
    {projection: source, release: true},
    {projection: source, issueClose: true},
  ]) {
    assert.throws(() => lifecycle.load(badInput), /EVIDENCE_BOUND_PRESENTATION_LIFECYCLE_INPUT_DENIED/);
  }
  for (const mutate of [
    (copy) => { copy.credentials = {password: 'secret'}; },
    (copy) => { copy.sourceConnections = ['db']; },
    (copy) => { copy.mutation = true; },
    (copy) => { copy.dispatch = true; },
  ]) {
    const bad = structuredClone(source);
    mutate(bad);
    assert.throws(() => lifecycle.load(bad), /EVIDENCE_BOUND_RENDERER_|EVIDENCE_BOUND_REPORT_/);
  }
  for (const authorityMethod of ['register', 'listen', 'setTimer', 'cache', 'fetch', 'dispatch', 'release', 'closeIssue']) {
    assert.equal(Object.hasOwn(lifecycle, authorityMethod), false);
  }
  assert.deepEqual(lifecycle.residueSnapshot(), ZERO_EVIDENCE_BOUND_PRESENTATION_RESIDUE_SNAPSHOT_V1);
});

test('replay after unload, stale readback, malformed rollback and mutation/accessor inputs fail closed', () => {
  const lifecycle = createEvidenceBoundPresentationLifecycleV1();
  const first = boundReport(BINDINGS, 'first');
  lifecycle.load(first.report);
  lifecycle.unload();
  assert.throws(() => lifecycle.replay(first.readback), /EVIDENCE_BOUND_PRESENTATION_LIFECYCLE_NOT_LOADED/);
  assert.throws(() => lifecycle.rollback({state: 'LOADED'}), /EVIDENCE_BOUND_PRESENTATION_LIFECYCLE_CHECKPOINT_DENIED/);

  lifecycle.load(first.report);
  const stale = {
    receipt: {...first.readback.receipt, receiptId: 'receipt-stale'},
    snapshot: first.readback.snapshot,
  };
  assert.throws(() => lifecycle.replay(stale), /EVIDENCE_BOUND_RENDERER_REPLAY_RECEIPT_DIGEST_DENIED/);

  let traps = 0;
  const proxy = new Proxy(first.report, {
    ownKeys() { traps += 1; return Reflect.ownKeys(first.report); },
    getPrototypeOf() { traps += 1; return Object.prototype; },
  });
  assert.throws(() => lifecycle.replace(proxy), /EVIDENCE_BOUND_RENDERER_SURFACE_DENIED|EVIDENCE_BOUND_REPORT_SURFACE_DENIED/);
  assert.equal(traps, 0);

  const accessor = structuredClone(first.report);
  Object.defineProperty(accessor, 'title', {enumerable: true, get() { traps += 1; return 'accessed'; }});
  assert.throws(() => lifecycle.replace(accessor), /EVIDENCE_BOUND_RENDERER_SURFACE_DENIED|EVIDENCE_BOUND_REPORT_SURFACE_DENIED/);
  assert.equal(traps, 0);
  lifecycle.unload();
});
