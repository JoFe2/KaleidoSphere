import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  ADAPTIVE_REQUIRED_BASE_COMMIT,
  buildAdaptiveHandlers,
  buildAdaptiveInvestigationGraphSpec,
  compareAdaptiveReplay,
  createAdaptiveInitialState,
  digest,
  executeAdaptiveGraph,
  loadJson,
  validateAdaptiveGraphSpec,
} from '../services/bi-control/src/graph-pilot/bi-adaptive-investigation-graph.mjs';
import {
  buildBiHandlers,
  buildDiscoveryReadinessGraphSpec,
  compareReplay,
  createInitialGraphState,
  executeGraph,
  loadSchema,
  validateGraphSpec,
} from '../services/bi-control/src/graph-pilot/bi-discovery-readiness-graph.mjs';
import { canonicalJson } from '../services/bi-control/src/canonical-json.js';
import { validateOrThrow } from '../services/bi-control/src/graph-pilot/schema-validator.mjs';

const graphSchema = await loadSchema(resolve('contracts/bi-discovery-readiness-graph/v0/graph-spec.schema.json'));
const stateSchema = await loadSchema(resolve('contracts/bi-discovery-readiness-graph/v0/state.schema.json'));
const receiptSchema = await loadSchema(resolve('contracts/bi-discovery-readiness-graph/v0/receipt.schema.json'));
const adaptiveGraphSchema = await loadJson(resolve('contracts/bi-adaptive-investigation-graph/v1/graph-spec.schema.json'));
const adaptiveStateSchema = await loadJson(resolve('contracts/bi-adaptive-investigation-graph/v1/state.schema.json'));
const adaptiveReceiptSchema = await loadJson(resolve('contracts/bi-adaptive-investigation-graph/v1/receipt.schema.json'));
const sealedDoc = await loadJson(resolve('services/bi-control/fixtures/graph-adaptive-v1/sealed-neutral-packs.json'));
const packs = sealedDoc.packs;

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const intField = { type: 'object', additionalProperties: false, required: ['n'], properties: { n: { type: 'integer' } } };

function discoveryTargets() {
  return [{
    id: 'known_schema_order_to_cash',
    classification: 'fixture_visible',
    databasePath: resolve('services/bi-control/fixtures/bi-specialist/candidate/training-order-to-cash.sqlite'),
    objective: 'Assess known order-to-cash KPIs',
    databaseSha256: 'test-digest',
  }];
}

async function runDiscovery({ runId = 'safeint-run' } = {}) {
  const spec = buildDiscoveryReadinessGraphSpec();
  const targets = discoveryTargets();
  const baseline = { assemblyMinutes: 30, reviewAmbiguityPoints: 6 };
  const evidenceFiles = { 'm6-03': resolve('docs/evidence/m6-03-bi-specialist/terminal-manifest.json') };
  const initialState = createInitialGraphState({ runId, sourceRefs: [], discoveryTargets: targets });
  return executeGraph({ spec, graphSchema, receiptSchema, initialState, handlers: buildBiHandlers({ targets, evidenceFiles, baseline }) });
}

function adaptiveCandidateFreeze() {
  const spec = buildAdaptiveInvestigationGraphSpec();
  const freeze = {
    schemaVersion: 'chimpmaera.bi/adaptive-investigation-candidate-freeze/v1',
    frozenBeforeSealedRun: true,
    baseCommit: ADAPTIVE_REQUIRED_BASE_COMMIT,
    modelRoute: 'offline-deterministic-fixtures',
    liveModelUsed: false,
    implementationDigest: digest({ graphSpec: spec, sealedInputDigests: packs.map((pack) => digest(pack.input)) }),
  };
  freeze.sha256 = digest(freeze);
  return freeze;
}

test('canonical closed graph spec with Number.MAX_SAFE_INTEGER + 1 budget is denied before graph execution', () => {
  const spec = buildDiscoveryReadinessGraphSpec();
  assert.equal(validateGraphSpec(spec, graphSchema), true);
  const unsafe = { ...spec, budgets: { ...spec.budgets, maxWallMs: Number.MAX_SAFE_INTEGER + 1 } };
  assert.throws(() => validateGraphSpec(unsafe, graphSchema), /SCHEMA_VALIDATION_FAILED/);
});

test('generic integer primitive retains canonical safe positive, zero and negative integers wherever minimum/maximum permits', () => {
  assert.equal(validateOrThrow({ n: 0 }, intField, 'int'), true);
  assert.equal(validateOrThrow({ n: 1 }, intField, 'int'), true);
  assert.equal(validateOrThrow({ n: -1 }, intField, 'int'), true);
  assert.equal(validateOrThrow({ n: Number.MAX_SAFE_INTEGER }, intField, 'int'), true);
  assert.equal(validateOrThrow({ n: Number.MIN_SAFE_INTEGER }, intField, 'int'), true);
  const bounded = { type: 'object', additionalProperties: false, required: ['n'], properties: { n: { type: 'integer', minimum: -10, maximum: 10 } } };
  assert.equal(validateOrThrow({ n: -10 }, bounded, 'int'), true);
  assert.equal(validateOrThrow({ n: 10 }, bounded, 'int'), true);
  assert.throws(() => validateOrThrow({ n: Number.MIN_SAFE_INTEGER }, bounded, 'int'), /SCHEMA_VALIDATION_FAILED/);
  assert.throws(() => validateOrThrow({ n: Number.MAX_SAFE_INTEGER }, bounded, 'int'), /SCHEMA_VALIDATION_FAILED/);
});

test('negative zero is denied at nested budget, ordinal and count positions', () => {
  const state = createInitialGraphState({ runId: 'negzero' });
  const badState = structuredClone(state);
  badState.budgetUsage.nodes = -0;
  assert.throws(() => validateOrThrow(badState, stateSchema, 'state'), /SCHEMA_VALIDATION_FAILED/);
  const adaptiveState = createAdaptiveInitialState({ runId: 'negzero' });
  adaptiveState.budgetUsage.probes = -0;
  assert.throws(() => validateOrThrow(adaptiveState, adaptiveStateSchema, 'adaptiveState'), /SCHEMA_VALIDATION_FAILED/);
  const receipt = {
    schemaVersion: 'chimpmaera.bi/discovery-readiness-receipt/v0',
    runId: 'negzero',
    nodeId: 'BI-G0_risk_preflight',
    status: 'complete',
    attempt: 1,
    inputDigest: 'a'.repeat(64),
    outputDigest: 'b'.repeat(64),
    previousHash: 'GENESIS',
    receiptHash: 'c'.repeat(64),
    evidenceRefs: [],
    budgetAfter: { nodes: 1, explorationSteps: 0, modelTokens: 0, toolCalls: 0, persistedBytes: 0, mutations: 0 },
    runtimeMetrics: { wallTimeMs: 0, tokens: -0, costUsd: 0, cacheClass: 'cold-local', retryClass: 'no-retry', escalationClass: 'deterministic', criticalPath: true, parallelSafe: false },
    stable: {},
  };
  assert.throws(() => validateOrThrow(receipt, receiptSchema, 'receipt'), /SCHEMA_VALIDATION_FAILED/);
  assert.equal(validateOrThrow({ ...receipt, runtimeMetrics: { ...receipt.runtimeMetrics, tokens: 0 } }, receiptSchema, 'receipt'), true);
});

test('fractional, NaN and infinite values are denied at nested budget, ordinal and count positions', () => {
  for (const value of [1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(() => validateOrThrow({ n: value }, intField, 'int'), /SCHEMA_VALIDATION_FAILED/);
  }
  const spec = buildDiscoveryReadinessGraphSpec();
  assert.throws(() => validateGraphSpec({ ...spec, budgets: { ...spec.budgets, maxNodes: 2.5 } }, graphSchema), /SCHEMA_VALIDATION_FAILED/);
  assert.throws(() => validateGraphSpec({ ...spec, budgets: { ...spec.budgets, maxWallMs: Number.POSITIVE_INFINITY } }, graphSchema), /SCHEMA_VALIDATION_FAILED/);
});

test('integers outside Number.MIN_SAFE_INTEGER through Number.MAX_SAFE_INTEGER are denied', () => {
  assert.throws(() => validateOrThrow({ n: Number.MAX_SAFE_INTEGER + 1 }, intField, 'int'), /SCHEMA_VALIDATION_FAILED/);
  assert.throws(() => validateOrThrow({ n: Number.MIN_SAFE_INTEGER - 1 }, intField, 'int'), /SCHEMA_VALIDATION_FAILED/);
  const spec = buildDiscoveryReadinessGraphSpec();
  assert.throws(() => validateGraphSpec({ ...spec, budgets: { ...spec.budgets, maxExplorationSteps: Number.MAX_SAFE_INTEGER + 1 } }, graphSchema), /SCHEMA_VALIDATION_FAILED/);
  assert.throws(() => validateGraphSpec({ ...spec, budgets: { ...spec.budgets, maxPersistedBytes: Number.MIN_SAFE_INTEGER - 1 } }, graphSchema), /SCHEMA_VALIDATION_FAILED/);
});

test('unchanged-digest integer substitution and fully re-digested forged receipt are denied beside unchanged graph and evidence', async () => {
  const state = await runDiscovery();
  assert.equal(state.status, 'complete');
  const substitution = structuredClone(state.receipts[1]);
  substitution.attempt = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => validateOrThrow(substitution, receiptSchema, 'receipt'), /SCHEMA_VALIDATION_FAILED/);
  const forged = structuredClone(state);
  const receipt = forged.receipts[1];
  receipt.attempt = Number.MAX_SAFE_INTEGER + 1;
  receipt.nodeId = 'BI-GX_forged_claim';
  receipt.stable.attempt = Number.MAX_SAFE_INTEGER + 1;
  receipt.stable.nodeId = 'BI-GX_forged_claim';
  receipt.receiptHash = sha256(canonicalJson(receipt.stable));
  if (forged.receipts[2]) forged.receipts[2].previousHash = receipt.receiptHash;
  assert.throws(() => validateOrThrow(receipt, receiptSchema, 'receipt'), /SCHEMA_VALIDATION_FAILED/);
  assert.equal(compareReplay(state, forged).deterministic, false);
});

test('safe boundary integer budgets retain execution planning, deterministic receipts and zero-mutation evidence', async () => {
  const base = buildDiscoveryReadinessGraphSpec();
  const spec = { ...base, budgets: { ...base.budgets, maxWallMs: Number.MAX_SAFE_INTEGER, maxNodes: Number.MAX_SAFE_INTEGER, maxExplorationSteps: Number.MAX_SAFE_INTEGER, maxPersistedBytes: Number.MAX_SAFE_INTEGER } };
  assert.equal(validateGraphSpec(spec, graphSchema), true);
  const targets = discoveryTargets();
  const baseline = { assemblyMinutes: 30, reviewAmbiguityPoints: 6 };
  const evidenceFiles = { 'm6-03': resolve('docs/evidence/m6-03-bi-specialist/terminal-manifest.json') };
  const initialState = createInitialGraphState({ runId: 'safeint-boundary', sourceRefs: [], discoveryTargets: targets });
  validateOrThrow(initialState, stateSchema, 'state');
  const completed = await executeGraph({ spec, graphSchema, receiptSchema, initialState, handlers: buildBiHandlers({ targets, evidenceFiles, baseline }) });
  const replay = await executeGraph({ spec, graphSchema, receiptSchema, initialState, handlers: buildBiHandlers({ targets, evidenceFiles, baseline }) });
  assert.equal(completed.status, 'complete');
  assert.equal(compareReplay(completed, replay).deterministic, true);
  assert.deepEqual(completed, replay);
  assert.equal(completed.budgetUsage.mutations, 0);
  completed.receipts.forEach((receipt) => validateOrThrow(receipt, receiptSchema, `receipt:${receipt.nodeId}`));
  assert(completed.receipts.every((receipt) => receipt.runtimeMetrics.wallTimeMs === 0));
});

test('adaptive sealed fixture run retains deterministic replay, receipts and zero mutation with safe boundary budgets', async () => {
  const base = buildAdaptiveInvestigationGraphSpec();
  const spec = { ...base, budgets: { ...base.budgets, maxWallMs: Number.MAX_SAFE_INTEGER, maxNodes: Number.MAX_SAFE_INTEGER, maxTotalProbes: Number.MAX_SAFE_INTEGER, maxPersistedBytes: Number.MAX_SAFE_INTEGER } };
  assert.equal(validateAdaptiveGraphSpec(spec, adaptiveGraphSchema), true);
  const initialState = createAdaptiveInitialState({ runId: 'safeint-adaptive', sealedInputs: packs.map((pack) => ({ id: pack.id, tier: pack.tier, inputDigest: digest(pack.input) })) });
  validateOrThrow(initialState, adaptiveStateSchema, 'adaptiveInitialState');
  const state = await executeAdaptiveGraph({ spec, graphSchema: adaptiveGraphSchema, receiptSchema: adaptiveReceiptSchema, initialState, handlers: buildAdaptiveHandlers({ packs, candidateFreeze: adaptiveCandidateFreeze() }) });
  const replayState = await executeAdaptiveGraph({ spec, graphSchema: adaptiveGraphSchema, receiptSchema: adaptiveReceiptSchema, initialState, handlers: buildAdaptiveHandlers({ packs, candidateFreeze: adaptiveCandidateFreeze() }) });
  assert.equal(state.status, 'complete');
  assert.equal(compareAdaptiveReplay(state, replayState).deterministic, true);
  assert.deepEqual(state, replayState);
  assert.equal(state.budgetUsage.mutations, 0);
  assert.equal(state.budgetUsage.modelTokens, 0);
  state.receipts.forEach((receipt) => validateOrThrow(receipt, adaptiveReceiptSchema, `adaptiveReceipt:${receipt.nodeId}`));
});

test('existing fail-closed denials are retained for unknown keys, raw values, credentials, model approval and mutation authority', async () => {
  const spec = buildDiscoveryReadinessGraphSpec();
  assert.throws(() => validateGraphSpec({ ...spec, extra: true }, graphSchema), /SCHEMA_VALIDATION_FAILED/);
  assert.throws(() => validateGraphSpec({ ...spec, owners: { ...spec.owners, mutationAuthority: true } }, graphSchema), /SCHEMA_VALIDATION_FAILED/);
  const modelApproval = { ...spec, nodes: spec.nodes.map((node) => node.id === 'BI-G2_readiness_assembly' ? { ...node, modelBoundary: { ...node.modelBoundary, modelMayApprove: true } } : node) };
  assert.throws(() => validateGraphSpec(modelApproval, graphSchema), /SCHEMA_VALIDATION_FAILED|MODEL_APPROVAL_DENIED/);
  const receipt = {
    schemaVersion: 'chimpmaera.bi/discovery-readiness-receipt/v0',
    runId: 'failclosed',
    nodeId: 'BI-G0_risk_preflight',
    status: 'complete',
    attempt: 1,
    inputDigest: 'a'.repeat(64),
    outputDigest: 'b'.repeat(64),
    previousHash: 'GENESIS',
    receiptHash: 'c'.repeat(64),
    evidenceRefs: [],
    budgetAfter: {},
    runtimeMetrics: { wallTimeMs: 0, tokens: 0, costUsd: 0, cacheClass: 'cold-local', retryClass: 'no-retry', escalationClass: 'deterministic', criticalPath: true, parallelSafe: false },
    stable: {},
  };
  assert.throws(() => validateOrThrow({ ...receipt, extraKey: 1 }, receiptSchema, 'receipt'), /SCHEMA_VALIDATION_FAILED/);
  const targets = discoveryTargets();
  const baseline = { assemblyMinutes: 30, reviewAmbiguityPoints: 6 };
  const handlers = buildBiHandlers({ targets, evidenceFiles: {}, baseline });
  const initialState = createInitialGraphState({ runId: 'failclosed', discoveryTargets: targets });
  await assert.rejects(executeGraph({ spec, graphSchema, receiptSchema, initialState, handlers: { ...handlers, 'BI-G1_discovery_core': async () => ({ stable: { source_rows: [{ secret: 'raw source row' }] } }) } }), /FORBIDDEN_PERSISTED_FIELD/);
  await assert.rejects(executeGraph({ spec, graphSchema, receiptSchema, initialState, handlers: { ...handlers, 'BI-G1_discovery_core': async () => ({ stable: { mutationPerformed: false, note: 'Bearer abcdefghijklmnop' } }) } }), /FORBIDDEN_PERSISTED_VALUE/);
  await assert.rejects(executeGraph({ spec, graphSchema, receiptSchema, initialState, handlers: { ...handlers, 'BI-G0_risk_preflight': async () => ({ mutations: 1, stable: { mutationPerformed: true } }) } }), /GRAPH_MUTATION_DENIED/);
});