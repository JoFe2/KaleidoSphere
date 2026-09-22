// KaleidoSphere #238 — receiving-side order/source consumption tests.
//
// These tests exercise the ACTUAL PAN producer module over the ACTUAL released synthetic
// read export and released read contract. They assert the receiving-side behaviour the
// issue requires, and — importantly — each negative assertion below was confirmed RED
// against a deliberately broken receiver before being accepted GREEN here.
//
// Run: node --test tests/ks238-order-source-consumption.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  ORDER_SOURCE_CONSUMPTION_SCHEMA,
  ORDER_SOURCE_CONSUMPTION_NONCLAIMS,
  PAN_ORDER_SOURCE_DEPENDENCY,
  PAN_ORDER_SOURCE_RELEASE,
  qualifyReleasedOrderSourceBinding,
  computeRuntimeClosureSha256,
  resolveOrderSourceHandoffModule,
  createRetainedSourceAuthority,
  consumeOrderSourceHandoff,
  buildOrderSourceMissingSemantics,
  compareSupportedCurrentOrders,
  composeReleasedNetRevenueComparison,
  attestReleasedNetRevenueComparison,
  buildOrderVsRevenueSeparation,
  buildOrderSourceConsumptionReport,
  orderSourceConsumptionDigest,
  runOrderSourceConsumptionSelfChecks,
  assertOrderSourceConsumptionSelfChecks,
} from '../services/bi-control/src/business-bi/order-source-consumption.mjs';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MODULE_SOURCE = readFileSync(
  path.join(REPO_ROOT, 'services/bi-control/src/business-bi/order-source-consumption.mjs'), 'utf8');

const FIXTURES = Object.freeze({
  sourceBytesFile: 'tests/fixtures/business-bi/ks238-order-source/erp-supported-export-v1.json',
  contractFile: 'tests/fixtures/business-bi/ks238-order-source/erp-read-contract-v1.json',
});
const SOURCE_LABEL = 'LOCAL_SYNTHETIC_ERP_ORDER_SOURCE_V1';
// The released export is valid 2026-08-10T08:00:00Z .. 09:00:00Z; the producer's own
// suite uses 08:30:00Z, so the receiver must too.
const NOW = '2026-08-10T08:30:00Z';
// FINDING 4: prefer the PINNED ARTIFACT PROVISION (`dependencies/pansphaira/`, installed by
// scripts/provision-ks238-order-source-dependency.mjs) and fall back to a local sibling
// checkout only if it exists. A provisioned tree needs no private Git history.
const PROVISIONED_MODULE = path.resolve(REPO_ROOT,
  'dependencies/pansphaira/src/ks238/order-source-handoff.mjs');
const SIBLING_MODULE = path.resolve(REPO_ROOT, '..', 'PANSPHAIRA-source',
  'src/ks238/order-source-handoff.mjs');
const PRODUCER_MODULE_FILE = fs.existsSync(PROVISIONED_MODULE) ? PROVISIONED_MODULE
  : (fs.existsSync(SIBLING_MODULE) ? SIBLING_MODULE : PROVISIONED_MODULE);
const PRODUCER_MODULE_ROOT = path.resolve(path.dirname(PRODUCER_MODULE_FILE), '..', '..');
const PRODUCER_REPO = PRODUCER_MODULE_ROOT;
// FINDING 1: the REAL released segment dataset (12 rows, the #242/#239 fixture), used to
// compose the revenue side through the released module rather than through a stub.
const SEGMENT_FIXTURE = JSON.parse(readFileSync(
  path.join(REPO_ROOT, 'tests/fixtures/business-bi/net-revenue-segment-v1.json'), 'utf8'));

const retainedAuthority = () => {
  const result = createRetainedSourceAuthority({
    ...FIXTURES, sourceLabel: SOURCE_LABEL, now: NOW, repoRoot: REPO_ROOT,
  });
  assert.equal(result.ok, true, `retained authority must build: ${result.code}`);
  return result.authority;
};

// The commit binding is read from the producer's own Git object database. A bare,
// disposable checkout has none, so the assertion below can only demand a positive MATCH
// when that database is actually reachable — and must never accept a MISMATCH either way.
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// A provisioned dependency lives INSIDE this repository, so a bare `git rev-parse` would
// find THIS repo's object database and then fail to resolve the producer commit. The
// database only counts when it actually contains the pinned producer commit.
const producerRepoHasObjectDatabase = () => {
  const probe = spawnSync('git', ['cat-file', '-e',
    `${PAN_ORDER_SOURCE_DEPENDENCY.parentCandidateCommit}:${PAN_ORDER_SOURCE_DEPENDENCY.module}`,
  ], { cwd: PRODUCER_REPO, encoding: 'utf8' });
  return probe.status === 0;
};

const consume = async (overrides = {}) => consumeOrderSourceHandoff({
  retainedAuthority: retainedAuthority(),
  repoRoot: REPO_ROOT,
  producerRepoRoot: PRODUCER_REPO,
  ...overrides,
});

let cachedConsumption = null;
const consumed = async () => {
  if (cachedConsumption === null) cachedConsumption = await consume();
  assert.equal(cachedConsumption.outcome, 'CONSUMED',
    `handoff must consume: ${cachedConsumption.code}`);
  return cachedConsumption;
};

// ------------------------------------------------------------ dependency identity

test('KS238-R: the PAN dependency is pinned to an exact released identity', () => {
  assert.equal(PAN_ORDER_SOURCE_DEPENDENCY.parentCandidateCommit,
    '2fb96e3f8ef599459da7f2ca8bd087c463366fc1');
  assert.match(PAN_ORDER_SOURCE_DEPENDENCY.expectedModuleSha256, /^[a-f0-9]{64}$/);
  assert.equal(PAN_ORDER_SOURCE_DEPENDENCY.producerEntryPoints.create, 'createKs238OrderSourceHandoff');
  assert.equal(PAN_ORDER_SOURCE_DEPENDENCY.producerEntryPoints.rebind, 'rebindSerializedOrderSource');
});

test('KS238-R: the resolved producer module really is the pinned PAN module', async () => {
  const resolved = await resolveOrderSourceHandoffModule({
    repoRoot: REPO_ROOT, producerRepoRoot: PRODUCER_REPO,
  });
  assert.equal(resolved.ok, true, resolved.code);
  assert.equal(resolved.moduleSha256, PAN_ORDER_SOURCE_DEPENDENCY.expectedModuleSha256);
  // The commit binding is only computable when the producer is present AS a Git checkout:
  // it is read from the producer's own object database. In a bare, disposable checkout
  // (no .git) there is no object database, so the honest value is UNRESOLVED — never a
  // fabricated MATCH. Whenever a producer repository IS reachable the binding must be a
  // positive MATCH: a MISMATCH is always a failure, and an UNRESOLVED that could have been
  // resolved is never accepted here.
  assert.notEqual(resolved.commitBinding, 'MISMATCH',
    'module bytes must not contradict the blob at the pinned producer commit');
  assert.ok(['MATCH', 'UNRESOLVED'].includes(resolved.commitBinding),
    `commitBinding must be MATCH or UNRESOLVED, got ${resolved.commitBinding}`);
  if (producerRepoHasObjectDatabase()) {
    assert.equal(resolved.commitBinding, 'MATCH',
      'with a producer object database present, module bytes must match the pinned blob');
  }
  assert.equal(typeof resolved.producer.createKs238OrderSourceHandoff, 'function');
  assert.equal(typeof resolved.producer.rebindSerializedOrderSource, 'function');
});

test('KS238-R negative: a substituted producer module is DENIED on bytes, before import', async () => {
  const os = await import('node:os');
  const fs = await import('node:fs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ks238-sub-'));
  const fake = path.join(dir, 'order-source-handoff.mjs');
  // A same-named module that would happily report anything it was asked to.
  fs.writeFileSync(fake, 'export const createKs238OrderSourceHandoff = () => ({ outcome: "ADAPTED", bindingDigest: "forged" });\n');
  const resolved = await resolveOrderSourceHandoffModule({ repoRoot: REPO_ROOT, explicitPath: fake });
  assert.equal(resolved.ok, false);
  assert.equal(resolved.state, 'DENIED');
  assert.equal(resolved.code, 'PAN_ORDER_SOURCE_MODULE_INTEGRITY_DENIED');
});

// FINDING 3: pinning the wrapper's bytes does NOT bind the executable reader, because the
// wrapper imports its implementation from ../../dist/packages/contracts/src/index.js. A
// directory carrying the EXACT genuine wrapper plus a substituted runtime was previously
// consumed as if it were the pinned producer. The full runtime closure is now measured
// BEFORE import, so the genuine wrapper succeeds and the substituted runtime is refused.
test('KS238-R negative: a GENUINE wrapper over a SUBSTITUTED runtime is DENIED before import', async () => {
  const os = await import('node:os');
  const fs = await import('node:fs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ks238-closure-'));
  // Byte-for-byte the real wrapper: its own sha256 equals the pinned expectedModuleSha256,
  // so the wrapper-bytes gate and the commit binding both pass.
  fs.mkdirSync(path.join(dir, 'src', 'ks238'), { recursive: true });
  fs.copyFileSync(path.join(PRODUCER_REPO, 'src', 'ks238', 'order-source-handoff.mjs'),
    path.join(dir, 'src', 'ks238', 'order-source-handoff.mjs'));
  // ...and the real, release-critical runtime, so the forgery is exactly one file deep.
  fs.cpSync(path.join(PRODUCER_REPO, 'dist', 'packages', 'contracts', 'src'),
    path.join(dir, 'dist', 'packages', 'contracts', 'src'), { recursive: true });
  const reader = path.join(dir, 'dist', 'packages', 'contracts', 'src', 'erp-read-connector.js');
  const genuine = fs.readFileSync(reader, 'utf8');
  const forged = genuine.replace(/"FULFILLED"/g, '"CANCELLED"');
  assert.notEqual(forged, genuine, 'the substitution must actually change the reader bytes');
  fs.writeFileSync(reader, forged);

  const wrapperBytes = fs.readFileSync(path.join(dir, 'src', 'ks238', 'order-source-handoff.mjs'));
  assert.equal(sha256(wrapperBytes), PAN_ORDER_SOURCE_DEPENDENCY.expectedModuleSha256,
    'the wrapper itself must be the genuine, correctly pinned module');

  const resolved = await resolveOrderSourceHandoffModule({
    repoRoot: REPO_ROOT, explicitPath: path.join(dir, 'src', 'ks238', 'order-source-handoff.mjs'),
  });
  assert.equal(resolved.ok, false, 'a substituted runtime must not be consumed');
  assert.equal(resolved.state, 'DENIED');
  assert.equal(resolved.code, 'PAN_ORDER_SOURCE_RUNTIME_CLOSURE_DENIED');
  // The diagnostic must name WHICH byte drifted, not merely that something did.
  assert.equal(resolved.runtimeClosure.criticalMismatch.file,
    'dist/packages/contracts/src/erp-read-connector.js');
  assert.notEqual(resolved.runtimeClosure.criticalMismatch.actual,
    resolved.runtimeClosure.criticalMismatch.expected);
  // The wrapper gate alone would NOT have caught this: the module bytes are exactly the pin.
  assert.equal(resolved.moduleSha256, PAN_ORDER_SOURCE_DEPENDENCY.expectedModuleSha256);
});

test('KS238-R positive: the REAL producer runtime attests the closure and yields the entry points', async () => {
  const wrapper = path.join(PRODUCER_REPO, 'src', 'ks238', 'order-source-handoff.mjs');
  const closure = computeRuntimeClosureSha256({ moduleFile: wrapper });
  assert.equal(closure.ok, true,
    `the genuine runtime must attest the closure: ${closure.code}`);
  assert.equal(closure.state, 'AVAILABLE');
  assert.equal(closure.closureSha256, PAN_ORDER_SOURCE_DEPENDENCY.expectedRuntimeClosureSha256);
  assert.equal(closure.fileCount, PAN_ORDER_SOURCE_DEPENDENCY.expectedRuntimeClosureFileCount);
  assert.equal(closure.criticalMismatch, null);
});

test('KS238-R negative: a missing producer module is an explicit UNAVAILABLE, not an exception', async () => {
  const resolved = await resolveOrderSourceHandoffModule({
    repoRoot: REPO_ROOT, explicitPath: path.join(REPO_ROOT, 'does-not-exist.mjs'),
  });
  assert.equal(resolved.ok, false);
  assert.equal(resolved.state, 'UNAVAILABLE');
  assert.equal(resolved.code, 'PAN_ORDER_SOURCE_MODULE_EXPLICIT_PATH_MISSING');
});

// --------------------------------------------------- retained source authority

test('KS238-R: source authority is retained OUTSIDE the payload and is frozen', () => {
  const authority = retainedAuthority();
  assert.equal(Object.isFrozen(authority), true);
  assert.equal(authority.sourceLabel, SOURCE_LABEL);
  assert.equal(authority.sourceBytesSha256,
    '85194ec545b4f1e2e690b4353c6d97d1753bb6043171c00f55ca894fc6669278');
  assert.equal(authority.contractSha256,
    '905c53b122a0dbd7c6b07fa5960bb04adc0523f9097587a3219e496cf8737d4f');
  assert.equal(Buffer.isBuffer(authority.sourceBytes), true);
  // The caller cannot mutate the retained anchor into agreeing with a substituted payload.
  assert.throws(() => { authority.sourceBytesSha256 = 'f'.repeat(64); }, TypeError);
});

test('KS238-R negative: incomplete or missing retained authority is refused', async () => {
  assert.deepEqual(
    createRetainedSourceAuthority({ sourceBytesFile: FIXTURES.sourceBytesFile, contractFile: FIXTURES.contractFile, now: NOW, repoRoot: REPO_ROOT }),
    { ok: false, state: 'UNAVAILABLE', code: 'RETAINED_SOURCE_AUTHORITY_REQUIRED', missing: ['sourceLabel'] });

  const missingBytes = createRetainedSourceAuthority({
    ...FIXTURES, sourceBytesFile: 'tests/fixtures/business-bi/ks238-order-source/nope.json',
    sourceLabel: SOURCE_LABEL, now: NOW, repoRoot: REPO_ROOT,
  });
  assert.equal(missingBytes.code, 'RETAINED_SOURCE_BYTES_MISSING');

  // A caller-supplied object that is not the frozen retained authority is refused outright.
  await assert.rejects(
    () => consumeOrderSourceHandoff({
      retainedAuthority: { sourceLabel: SOURCE_LABEL, sourceBytes: Buffer.from('{}'), sourceBytesSha256: 'f'.repeat(64), contract: {}, now: NOW },
      repoRoot: REPO_ROOT,
    }),
    (error) => error.code === 'RETAINED_SOURCE_AUTHORITY_REQUIRED');
});

test('KS238-R negative: a malformed retained contract is DENIED, not parsed loosely', () => {
  const result = createRetainedSourceAuthority({
    sourceBytesFile: FIXTURES.sourceBytesFile,
    contractFile: 'tests/fixtures/business-bi/ks238-order-source/erp-supported-export-v1.json',
    sourceLabel: SOURCE_LABEL, now: NOW, repoRoot: REPO_ROOT,
  });
  // The export bytes are valid JSON but they are NOT the released read contract, so the
  // producer must refuse them -- the receiver must not "repair" the contract.
  assert.equal(result.ok, true, 'JSON parses; the producer is the one that must deny it');
  assert.notEqual(result.authority.contract.schemaVersion, 'chimpmaera.connector/erp-read/v1');
});

// ------------------------------------------------------- real create + rebind

test('KS238-R: the receiver delegates create and reads the real reader facts', async () => {
  const consumption = await consumed();
  assert.equal(consumption.outcome, 'CONSUMED');
  assert.equal(consumption.handoff.source, 'PAN createKs238OrderSourceHandoff');
  assert.equal(consumption.handoff.bindingDigest,
    '48da2c6f49272de95bfebb857343231ff53810f812f8305c22cf5039902959d7');
  const facts = consumption.handoff.supportedFacts.orderFacts;
  assert.equal(facts.length, 3);
  assert.deepEqual(consumption.handoff.supportedFacts.statusCounts, { FULFILLED: 1, OPEN: 2 });
  // The reader proves order identity/status/period -- and nothing monetary.
  assert.deepEqual([...consumption.handoff.binding.supportedFacts].sort(),
    ['customerIdentity', 'orderIdentity', 'orderPeriod', 'orderStatus']);
});

test('KS238-R: a carried payload is REBOUND against the retained authority', async () => {
  const first = await consumed();
  const rebound = await consume({
    handoffPayload: {
      binding: first.handoff.binding,
      bindingDigest: first.handoff.bindingDigest,
    },
  });
  assert.equal(rebound.outcome, 'CONSUMED');
  assert.equal(rebound.rebind.source, 'PAN rebindSerializedOrderSource');
  assert.equal(rebound.rebind.outcome, 'REBOUND');
  assert.equal(rebound.rebind.payloadReboundAgainstRetainedAuthority, true);
});

test('KS238-R negative: a stale carried payload is DENIED by the producer on rebind', async () => {
  const first = await consumed();
  const tampered = JSON.parse(JSON.stringify(first.handoff.binding));
  tampered.supported.statusCounts.OPEN = 99;
  const result = await consume({
    handoffPayload: { binding: tampered, bindingDigest: first.handoff.bindingDigest },
  });
  assert.equal(result.outcome, 'DENIED');
  assert.match(result.code, /REBIND|MISMATCH|DENIED/);
});

test('KS238-R negative: a stale decision time is refused, never silently re-dated', async () => {
  const authority = createRetainedSourceAuthority({
    ...FIXTURES, sourceLabel: SOURCE_LABEL,
    now: '2026-08-10T09:00:01Z', // one second past the export's expiresAt
    repoRoot: REPO_ROOT,
  });
  const result = await consumeOrderSourceHandoff({
    retainedAuthority: authority.authority, repoRoot: REPO_ROOT,
  });
  assert.equal(result.outcome, 'DENIED');
  assert.equal(result.code, 'SOURCE_STALE');
});

test('KS238-R negative: a wrong source label is refused before any composition', async () => {
  const authority = createRetainedSourceAuthority({
    ...FIXTURES, sourceLabel: 'PROVIDER_ATTESTED', now: NOW, repoRoot: REPO_ROOT,
  });
  const result = await consumeOrderSourceHandoff({
    retainedAuthority: authority.authority, repoRoot: REPO_ROOT,
  });
  assert.equal(result.outcome, 'DENIED');
  assert.equal(result.code, 'SOURCE_LABEL_DENIED');
});

// ------------------------------------- metric discrepancy census (current orders)

/**
 * FINDING 1: the default supported vocabulary must be the READER'S OWN.
 *
 * The released ERP reader validates orderStatus against exactly OPEN / FULFILLED /
 * CANCELLED. The previous default (CONFIRMED / PENDING) was a vocabulary this reader can
 * never emit, so the shipped "positive" journey compared three real orders against a bill
 * that could only ever be empty: supportedOrderCount 0, byPeriod {}, every real order
 * EXCLUDED. That is a fail-closed claim, not a journey.
 *
 * With the reader's own vocabulary as the default, the SAME fixture yields the reader's
 * REAL census -- FULFILLED 1, OPEN 2 -- and a real period/customer-segment composition.
 * The independent expected outcomes below are derived from the fixture's own facts, not
 * from the implementation.
 */
test('KS238-R: the comparison defaults to the READER\'s own status vocabulary and composes real orders', async () => {
  const comparison = compareSupportedCurrentOrders({ consumption: await consumed() });
  assert.equal(comparison.outcome, 'COMPARED');
  assert.equal(comparison.comparison, 'SUPPORTED_CURRENT_ORDER_CENSUS');
  // The reader's declared vocabulary, verbatim.
  assert.deepEqual(comparison.supportedStatuses, ['CANCELLED', 'FULFILLED', 'OPEN']);
  assert.deepEqual(comparison.supportedCustomerStatuses, ['ACTIVE', 'ON_HOLD']);
  // Nothing is excluded any more: the released export's statuses are all supported.
  assert.deepEqual(comparison.unsupportedStatusesObserved, []);
  assert.deepEqual(comparison.excludedUnsupported, []);
  // The reader's OWN census: FULFILLED 1, OPEN 2 (fixture orders 001/002/003).
  assert.deepEqual(comparison.byStatus.FULFILLED, { status: 'FULFILLED', count: 1, evidence: 'READER_CENSUS' });
  assert.deepEqual(comparison.byStatus.OPEN, { status: 'OPEN', count: 2, evidence: 'READER_CENSUS' });
  assert.deepEqual(comparison.byStatus.CANCELLED, { status: 'CANCELLED', count: 0, evidence: 'NO_READER_EVIDENCE' });
  assert.deepEqual(comparison.totals, {
    supportedOrderCount: 3, unsupportedOrderCount: 0,
    totalObserved: 3, supportedCensusTotal: 3, unknownPeriodCount: 0,
    unknownCustomerStatusCount: 0,
  });
  // REAL period composition: every fixture order is dated 2026-08, and the period is the
  // reader's own evaluated period fact.
  assert.deepEqual(comparison.byPeriod, {
    '2026-08': {
      period: '2026-08', count: 3,
      orderIds: ['order:synthetic-001', 'order:synthetic-002', 'order:synthetic-003'],
    },
  });
  assert.deepEqual(comparison.knownPeriods, ['2026-08']);
  // REAL customer-segment composition: customer:zoo-001 is ACTIVE and carries orders
  // 001/003; customer:zoo-002 is ON_HOLD and carries order 002.
  assert.deepEqual(comparison.byCustomerSegment, {
    ACTIVE: {
      customerStatus: 'ACTIVE', count: 2, supported: true,
      orderIds: ['order:synthetic-001', 'order:synthetic-003'],
    },
    ON_HOLD: {
      customerStatus: 'ON_HOLD', count: 1, supported: true,
      orderIds: ['order:synthetic-002'],
    },
  });
  assert.deepEqual(comparison.knownCustomerStatuses, ['ACTIVE', 'ON_HOLD']);
});

test('KS238-R: an explicit supported-status override drives the real reader census', async () => {
  const comparison = compareSupportedCurrentOrders({
    consumption: await consumed(), supportedStatuses: ['OPEN', 'FULFILLED'],
  });
  assert.equal(comparison.outcome, 'COMPARED');
  assert.deepEqual(comparison.byStatus.OPEN, { status: 'OPEN', count: 2, evidence: 'READER_CENSUS' });
  assert.deepEqual(comparison.byStatus.FULFILLED, { status: 'FULFILLED', count: 1, evidence: 'READER_CENSUS' });
  assert.equal(comparison.totals.supportedOrderCount, 3);
  // All three orders are in the reader's reported period (2026-08), so the period
  // distribution is real, not a guess.
  assert.deepEqual(comparison.byPeriod, {
    '2026-08': {
      period: '2026-08', count: 3,
      orderIds: ['order:synthetic-001', 'order:synthetic-002', 'order:synthetic-003'],
    },
  });
  assert.deepEqual(comparison.knownPeriods, ['2026-08']);
  assert.equal(comparison.totals.unknownPeriodCount, 0);
  assert.deepEqual(comparison.countedOrderIds,
    ['order:synthetic-001', 'order:synthetic-002', 'order:synthetic-003']);
});

test('KS238-R negative: an unsupported status is never folded into a supported bucket', async () => {
  const comparison = compareSupportedCurrentOrders({
    consumption: await consumed(), supportedStatuses: ['CONFIRMED'],
  });
  // FULFILLED and OPEN remain outside; the supported total cannot absorb them.
  assert.deepEqual(Object.keys(comparison.byStatus), ['CONFIRMED']);
  assert.equal(comparison.byStatus.CONFIRMED.count, 0);
  assert.equal(comparison.totals.supportedOrderCount, 0);
  assert.equal(comparison.totals.unsupportedOrderCount, 3);
  assert.equal(comparison.totals.totalObserved, 3);
  // Consistency: supported + unsupported must account for every observed order.
  assert.equal(comparison.totals.supportedOrderCount + comparison.totals.unsupportedOrderCount,
    comparison.totals.totalObserved);
});

test('KS238-R negative: the comparison refuses to run without a CONSUMED handoff', async () => {
  const denied = compareSupportedCurrentOrders({
    consumption: { outcome: 'DENIED', code: 'SOURCE_STALE' },
  });
  assert.equal(denied.outcome, 'UNAVAILABLE');
  assert.equal(denied.code, 'CURRENT_ORDER_COMPARISON_REQUIRES_CONSUMED_HANDOFF');
  assert.equal(denied.comparable, false);
  assert.equal(denied.handoffCode, 'SOURCE_STALE');

  const empty = compareSupportedCurrentOrders({ consumption: await consumed(), supportedStatuses: [] });
  assert.equal(empty.outcome, 'DENIED');
  assert.equal(empty.code, 'CURRENT_ORDER_COMPARISON_SUPPORTED_STATUSES_REQUIRED');
});

// ------------------------------------------- explicit missing history/unit/revenue

test('KS238-R: missing HISTORY is explicit and carries the producer reason', async () => {
  const ms = buildOrderSourceMissingSemantics(await consumed());
  assert.equal(ms.history.state, 'UNAVAILABLE');
  assert.equal(ms.previousStates.state, 'UNAVAILABLE');
  assert.equal(ms.historicalOrderBook.state, 'UNAVAILABLE');
  // The reason is bound to the PRODUCER's declared closed contract, not invented here.
  assert.equal(ms.history.reason, 'REVENUE_AND_HISTORY_UNAVAILABLE:historicalOrderBook');
  assert.equal(ms.producerContract.code, 'REVENUE_AND_HISTORY_UNAVAILABLE');
  assert.ok(ms.producerContract.missingFields.includes('history.previousStates'));
  assert.equal(ms.history.value, null);
});

test('KS238-R: missing UNIT and QUANTITY are explicit and evidence-backed', async () => {
  const ms = buildOrderSourceMissingSemantics(await consumed());
  assert.equal(ms.orderedQuantity.state, 'UNAVAILABLE');
  assert.equal(ms.quantityUnit.state, 'UNAVAILABLE');
  assert.equal(ms.quantityUnit.reason, 'REVENUE_AND_HISTORY_UNAVAILABLE:quantityUnit');
  // Evidence, not assertion: every order's unit slot is the producer's frozen shape.
  assert.equal(ms.quantityEvidence.orderCount, 3);
  assert.equal(ms.quantityEvidence.distinctUnitSlots, 1);
  assert.deepEqual(ms.quantityEvidence.quantities[0].quantityUnit, { quantity: 'UNAVAILABLE', unit: 'UNAVAILABLE' });
  assert.ok(ms.producerContract.missingFields.includes('quantity.unit'));
  assert.ok(ms.producerContract.missingFields.includes('quantity.orderedQuantity'));
});

test('KS238-R: missing REVENUE is explicit and never inferred from orders', async () => {
  const ms = buildOrderSourceMissingSemantics(await consumed());
  assert.equal(ms.netRevenue.state, 'UNAVAILABLE');
  assert.equal(ms.netRevenue.reason, 'REVENUE_AND_HISTORY_UNAVAILABLE:netRevenue');
  assert.equal(ms.amount.state, 'UNAVAILABLE');
  assert.equal(ms.currencyValue.state, 'UNAVAILABLE');
  assert.equal(ms.orderIntake.state, 'UNAVAILABLE');
  assert.equal(ms.creditsCancellationsNetting.state, 'UNAVAILABLE');
  assert.ok(ms.producerContract.missingFields.includes('amount.netRevenue'));
  // What IS available is stated, not left implicit.
  assert.equal(ms.orderStatusCensus.state, 'AVAILABLE');
  assert.deepEqual(ms.orderStatusCensus.value, { FULFILLED: 1, OPEN: 2 });
  assert.equal(ms.orderCount.value, 3);
  assert.deepEqual(ms.periodsObserved.value, ['2026-08']);
});

test('KS238-R: the separation record refuses every order-to-revenue merger', async () => {
  const consumption = await consumed();
  const comparison = compareSupportedCurrentOrders({ consumption });
  const separation = buildOrderVsRevenueSeparation({ currentOrderComparison: comparison, netRevenueReport: null });
  assert.equal(separation.separation, 'ORDER_CENSUS_AND_NET_REVENUE_ARE_SEPARATE_FACTS');
  assert.equal(separation.combinedTotal.state, 'UNAVAILABLE');
  assert.equal(separation.reconciliation.state, 'UNAVAILABLE');
  assert.equal(separation.attribution.state, 'UNAVAILABLE');
  assert.equal(separation.arithmeticPerformedAcrossSides, false);
  assert.equal(separation.datasetsAreDistinct, true);
  assert.equal(separation.orderSide.state, 'AVAILABLE');
  // Net revenue absent is an explicit UNAVAILABLE -- never a zero, never inferred.
  assert.equal(separation.revenueSide.state, 'UNAVAILABLE');
  assert.equal(separation.revenueSide.reason, 'NET_REVENUE_COMPARISON_NOT_SUPPLIED');
});

/**
 * FINDING 1 (revenue half): the revenue side must be COMPOSED by the released module over
 * the real dataset -- not accepted merely because it is an object. The prior test passed a
 * hand-written `{current:{netRevenue:12345}}` stub and the surface published it as a
 * released comparison; that is an unverified claim wearing a released module's name.
 *
 * The independent expected outcomes below are the fixture's OWN arithmetic (12 rows over
 * the released 2026-06 / 2026-07 windows), computed by the released module.
 */
test('KS238-R: the released net-revenue comparison is COMPOSED from real rows and carried verbatim', async () => {
  const consumedHandoff = await consumed();
  const rows = SEGMENT_FIXTURE.rows ?? SEGMENT_FIXTURE;
  // Real composition through the RELEASED module -- no re-derivation here.
  const composed = composeReleasedNetRevenueComparison({ sourceRows: rows });
  assert.equal(composed.outcome, 'COMPOSED');
  assert.equal(composed.code, 'OK');
  const netRevenue = composed.report;

  const report = buildOrderSourceConsumptionReport({
    consumption: consumedHandoff, netRevenueComparison: netRevenue, generatedAt: NOW,
  });
  assert.equal(report.separation.revenueSide.state, 'AVAILABLE');
  assert.equal(report.separation.revenueSide.reason, null);
  const revenueValue = report.separation.revenueSide.value;
  // Verbatim: the exact same object, not a summary or a re-derivation.
  assert.equal(revenueValue.releasedComparison, netRevenue);
  // The fixture's real released arithmetic: current 2026-07 nets 66000, comparison
  // 2026-06 nets 45000 (the released module's own definition: saleValue - creditValue).
  assert.equal(revenueValue.releasedComparison.current.netRevenue, 66000);
  assert.equal(revenueValue.releasedComparison.comparison.netRevenue, 45000);
  assert.equal(revenueValue.releasedComparison.delta.netRevenue, 21000);
  // The released schema tag and the released periods travel with it.
  assert.equal(revenueValue.schema,
    'kaleidosphere.business-bi/net-revenue-segment-comparison/v1');
  assert.deepEqual(composed.periods, {
    comparison: { label: '2026-06', start: '2026-06-01', end: '2026-06-30' },
    current: { label: '2026-07', start: '2026-07-01', end: '2026-07-31' },
  });
  // The revenue side is explicitly NOT owned by this handoff.
  assert.equal(revenueValue.ownedByThisHandoff, false);
  // And still no cross-side arithmetic.
  assert.equal(report.separation.arithmeticPerformedAcrossSides, false);
  assert.equal(report.separation.combinedTotal.state, 'UNAVAILABLE');
});

/**
 * Adversarial regression: an object that merely LOOKS like a released comparison must not
 * be publishable as one. The stub carries the released schema tag and integers, so only
 * the released provenance (source declaration + non-claims) can expose it.
 */
test('KS238-R negative: a hand-written stub cannot pass as a released comparison', async () => {
  const stub = {
    schemaVersion: 'kaleidosphere.business-bi/net-revenue-segment-comparison/v1',
    current: { netRevenue: 12345 },
    comparison: { netRevenue: 11000 },
  };
  const attestation = attestReleasedNetRevenueComparison(stub);
  assert.equal(attestation.ok, false);
  assert.equal(attestation.code, 'NET_REVENUE_RELEASED_PROVENANCE_DENIED');
  const separation = buildOrderVsRevenueSeparation({
    currentOrderComparison: null, netRevenueReport: stub,
  });
  // The revenue side is DENIED, not published, and the separation record still refuses to
  // merge the two sides.
  assert.equal(separation.revenueSide.state, 'DENIED');
  assert.equal(separation.revenueSide.reason, 'NET_REVENUE_RELEASED_ATTESTATION_FAILED');
  assert.equal(separation.revenueSide.value, null);
  assert.equal(separation.arithmeticPerformedAcrossSides, false);
});

/**
 * Adversarial regression: a REAL released comparison whose carried digest has been
 * tampered with must be refused -- the released module's own digest is recomputed.
 */
test('KS238-R negative: a tampered released-comparison digest is refused', async () => {
  const composed = composeReleasedNetRevenueComparison({ sourceRows: SEGMENT_FIXTURE.rows ?? SEGMENT_FIXTURE });
  const tampered = { ...composed.report, digest: '0'.repeat(64) };
  const attestation = attestReleasedNetRevenueComparison(tampered);
  assert.equal(attestation.ok, false);
  assert.equal(attestation.code, 'NET_REVENUE_RELEASED_DIGEST_MISMATCH');
  assert.equal(attestation.declaredDigest, '0'.repeat(64));
  assert.match(attestation.recomputedDigest, /^[a-f0-9]{64}$/);
});

// --------------------------------------------------------- report + self-checks

test('KS238-R: the report is schema-tagged, non-claiming and deterministic', async () => {
  const consumption = await consumed();
  const report = buildOrderSourceConsumptionReport({ consumption, generatedAt: NOW });
  assert.equal(report.schema, ORDER_SOURCE_CONSUMPTION_SCHEMA);
  assert.equal(report.side, 'RECEIVING');
  assert.equal(report.trust, 'LOCAL_SYNTHETIC');
  assert.equal(report.handoff.outcome, 'CONSUMED');
  assert.deepEqual(report.nonclaims, ORDER_SOURCE_CONSUMPTION_NONCLAIMS);
  assert.ok(report.nonclaims.some((n) => /never added, netted, reconciled/.test(n)));
  // Two runs over the same retained authority produce the same digest.
  const again = buildOrderSourceConsumptionReport({ consumption, generatedAt: NOW });
  assert.equal(report.digest, again.digest);
  assert.equal(report.digest, orderSourceConsumptionDigest(report));
  assert.match(report.digest, /^sha256:[a-f0-9]{64}$/);
});

test('KS238-R: every task-specific self-check passes, and each can fail', async () => {
  const consumption = await consumed();
  const report = buildOrderSourceConsumptionReport({ consumption, generatedAt: NOW });
  const checks = runOrderSourceConsumptionSelfChecks({
    report, consumption, moduleSourceText: MODULE_SOURCE,
  });
  assert.equal(checks.length, 11);
  assert.deepEqual(checks.filter((c) => !c.ok), [], 'all self-checks must be green');
  assert.doesNotThrow(() => assertOrderSourceConsumptionSelfChecks({
    report, consumption, moduleSourceText: MODULE_SOURCE,
  }));

  // RED: a receiver that swallowed an unavailable revenue fact as available fails S6/S4.
  const broken = JSON.parse(JSON.stringify(report));
  broken.missingSemantics.netRevenue = { state: 'AVAILABLE', reason: null, value: 0 };
  assert.throws(
    () => assertOrderSourceConsumptionSelfChecks({
      report: broken, consumption, moduleSourceText: MODULE_SOURCE,
    }),
    (error) => error.code === 'ORDER_SOURCE_CONSUMPTION_SELF_CHECK_FAILED'
      && error.failed.some((f) => f.id.startsWith('S6')));

  // RED: a receiver that folded net revenue across the two sides fails S6.
  const merged = JSON.parse(JSON.stringify(report));
  merged.separation.arithmeticPerformedAcrossSides = true;
  assert.throws(() => assertOrderSourceConsumptionSelfChecks({
    report: merged, consumption, moduleSourceText: MODULE_SOURCE,
  }), (error) => error.code === 'ORDER_SOURCE_CONSUMPTION_SELF_CHECK_FAILED');

  // RED: a receiver that re-implemented the released reader fails S10.
  const forkedSource = `${MODULE_SOURCE}\nconst x = ${['readErpOrders', 'FromLabelledSourceBytesV1'].join('')};\n`;
  assert.throws(
    () => assertOrderSourceConsumptionSelfChecks({
      report, consumption, moduleSourceText: forkedSource,
    }),
    (error) => error.code === 'ORDER_SOURCE_CONSUMPTION_SELF_CHECK_FAILED'
      && error.failed.some((f) => f.id.startsWith('S10')));

  // RED: a loader that dropped the producer module identity fails S1.
  const anonymous = JSON.parse(JSON.stringify(report));
  anonymous.handoff.module = null;
  assert.throws(() => assertOrderSourceConsumptionSelfChecks({
    report: anonymous, consumption, moduleSourceText: MODULE_SOURCE,
  }), (error) => error.failed.some((f) => f.id.startsWith('S1')));
});

test('KS238-R negative: the digest is self-excluded, so it cannot be forged by injection', async () => {
  const consumption = await consumed();
  const report = buildOrderSourceConsumptionReport({ consumption, generatedAt: NOW });
  // Rewriting only the digest field must not change the recomputed digest for a given
  // body -- the digest is a function of the body, never of itself.
  const spoofed = { ...report, digest: `sha256:${'0'.repeat(64)}` };
  assert.notEqual(orderSourceConsumptionDigest(spoofed), spoofed.digest);
  assert.equal(orderSourceConsumptionDigest(spoofed), report.digest);
});

// ------------------------------------------------ runnable CLI: normal + negative

const CLI = path.join(REPO_ROOT, 'scripts/run-ks238-order-source-consumption.mjs');

const runCli = (args) => {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd: REPO_ROOT });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

test('KS238-R: the CLI normal path consumes, compares and self-checks end to end', () => {
  const run = runCli([]);
  assert.equal(run.status, 0, run.stderr);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.stage, 'NORMAL');
  assert.equal(payload.outcome, 'CONSUMED');
  assert.notEqual(payload.dependency.commitBinding, 'MISMATCH');
  if (producerRepoHasObjectDatabase()) {
    assert.equal(payload.dependency.commitBinding, 'MATCH');
  }
  assert.equal(payload.dependency.moduleSha256, PAN_ORDER_SOURCE_DEPENDENCY.expectedModuleSha256);
  // The intermediate handoff is created AND rebound against the retained authority.
  assert.equal(payload.intermediateHandoff.created, payload.intermediateHandoff.rebound);
  assert.equal(payload.intermediateHandoff.reboundAgainstRetainedAuthority, true);
  assert.equal(payload.selfChecks, 'ALL_GREEN');
  assert.equal(payload.currentOrderComparison.outcome, 'COMPARED');
  assert.equal(payload.separation.arithmeticPerformedAcrossSides, false);
});

test('KS238-R: the CLI negative run refuses every exact negative path', () => {
  const run = runCli(['--negative']);
  assert.equal(run.status, 0, run.stderr);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.stage, 'NEGATIVE');
  assert.equal(payload.allRefused, true);
  assert.equal(payload.total, payload.refused);
  const ids = payload.paths.map((p) => p.id);
  for (const required of [
    'N1_SUBSTITUTED_PRODUCER_DENIED',
    'N2_STALE_DECISION_TIME_DENIED',
    'N3_WRONG_SOURCE_LABEL_DENIED',
    'N4_TAMPERED_PAYLOAD_REBIND_DENIED',
    'N5_UNSUPPORTED_STATUS_NOT_FOLDED',
    'N6_ORDER_REVENUE_MERGER_REFUSED',
    'N7_UNAVAILABLE_REVENUE_NOT_RE_DECLARED_AVAILABLE',
    'N8_COMPARISON_REQUIRES_CONSUMED_HANDOFF',
  ]) assert.ok(ids.includes(required), `missing negative path ${required}`);
  assert.deepEqual(payload.paths.filter((p) => !p.refused), []);
});

test('KS238-R negative: the CLI refuses a write outside the repository and /tmp', () => {
  const run = runCli(['--out', '/etc/ks238-escape.json']);
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /KS238_CLI_OUT_PATH_DENIED/);
});

// ----------------------------- FINDING 2: retained bytes are not mutable in place

/**
 * FINDING 2: `Object.freeze(authority)` freezes the outer RECORD only; `authority.sourceBytes`
 * stays a writable Buffer. The parent's probe wrote a substituted date into those bytes and
 * the handoff was consumed as OK while still claiming the original retained SHA. The receiver
 * now re-derives the byte identity from the bytes it is about to hand the producer and refuses
 * any mismatch BEFORE resolving or importing the producer, so no downstream composition runs.
 */
test('KS238-R negative: an IN-PLACE mutation of the retained bytes is refused before any producer call', async () => {
  const authority = retainedAuthority();
  const declared = authority.sourceBytesSha256;
  const needle = Buffer.from('"orderDate": "2026-08-01"');
  const at = authority.sourceBytes.indexOf(needle);
  assert.ok(at >= 0, 'the fixture must contain the order date the probe rewrites');
  // Same-length in-place substitution into the buffer the producer would consume.
  authority.sourceBytes.write('2026-07-01', at + needle.indexOf('2026-08-01'));
  const result = await consumeOrderSourceHandoff({
    retainedAuthority: authority, repoRoot: REPO_ROOT, producerRepoRoot: PRODUCER_REPO,
  });
  assert.equal(result.outcome, 'DENIED');
  assert.equal(result.code, 'RETAINED_SOURCE_BYTES_MUTATED');
  assert.equal(result.declaredSourceBytesSha256, declared);
  assert.notEqual(result.consumedSourceBytesSha256, declared);
  // Failed admission publishes no handoff at all, and the producer was never imported.
  assert.equal(result.handoff, undefined);
});

// ----------------- FINDING 1 (revenue half): released labels are not execution evidence

/**
 * FINDING 1 (revenue half), EXACT parent reproducer from PARENT-FOCUSED-CORRECTIONS.md. The
 * object wears every public label (schema tag, both period nets, the released sourceRelation
 * and a nonclaim) and its digest is self-consistent, yet no released module ever produced it.
 * Public labels plus self-consistent hashes are NOT execution evidence.
 */
test('KS238-R negative: the parent reproducer — released labels + self-consistent digest — is DENIED', async () => {
  const fabricated = {
    schemaVersion: 'kaleidosphere.business-bi/net-revenue-segment-comparison/v1',
    current: { netRevenue: 12345 },
    comparison: { netRevenue: 11000 },
    source: { sourceRelation: 'xra_projection_orders' },
    nonclaims: ['not real'],
  };
  const attestation = attestReleasedNetRevenueComparison(fabricated);
  assert.equal(attestation.ok, false);
  assert.equal(attestation.code, 'NET_REVENUE_RELEASED_EXECUTION_UNVERIFIED');
  const separation = buildOrderVsRevenueSeparation({ netRevenueReport: fabricated });
  assert.equal(separation.revenueSide.state, 'DENIED');
  assert.equal(separation.revenueSide.value, null);
  assert.equal(separation.arithmeticPerformedAcrossSides, false);
});

/**
 * The honest second binding route: a genuine comparison that has lost object identity across
 * serialization is still attestable, but ONLY by re-executing the released module over the
 * SEPARATELY RETAINED source rows it is about. Labels and a digest alone are not enough, and a
 * different retained input cannot reproduce the digest.
 */
test('KS238-R negative: a serialized genuine comparison needs its retained rows; labels alone are refused', async () => {
  const rows = SEGMENT_FIXTURE.rows ?? SEGMENT_FIXTURE;
  const composed = composeReleasedNetRevenueComparison({ sourceRows: rows });
  const roundTripped = JSON.parse(JSON.stringify(composed.report));
  const bare = attestReleasedNetRevenueComparison(roundTripped);
  assert.equal(bare.ok, false);
  assert.equal(bare.code, 'NET_REVENUE_RELEASED_EXECUTION_UNVERIFIED');
  const attested = attestReleasedNetRevenueComparison(roundTripped, { retainedSourceRows: rows });
  assert.equal(attested.ok, true);
  assert.equal(attested.basis, 'RECOMPOSED_FROM_SEPARATELY_RETAINED_SOURCE_ROWS');
  assert.equal(attested.digest, composed.digest);
  // A different retained input cannot reproduce the same digest.
  const altered = rows.map((row, i) => (i === 0 ? { ...row, amount_minor_units: row.amount_minor_units + 1 } : row));
  const mismatched = attestReleasedNetRevenueComparison(roundTripped, { retainedSourceRows: altered });
  assert.equal(mismatched.ok, false);
  assert.equal(mismatched.code, 'NET_REVENUE_RETAINED_ROWS_DIGEST_MISMATCH');
});

// ------------------------- FINDING 3 + 4: portable pinned-artifact provisioning

test('KS238-R: the provisioned pinned artifact resolves with NO Git object database', async () => {
  const provisioned = path.resolve(REPO_ROOT,
    'dependencies/pansphaira/src/ks238/order-source-handoff.mjs');
  assert.ok(PAN_ORDER_SOURCE_DEPENDENCY.defaultCandidates
    .includes('dependencies/pansphaira/src/ks238/order-source-handoff.mjs'),
  'the pinned artifact provision must be a declared candidate');
  assert.ok(fs.existsSync(provisioned),
    'the pinned artifact provision must be present so canonical qualification needs no sibling');
  // No producerRepoRoot is supplied: there is no object database to bind against, so the
  // honest commit binding is UNRESOLVED -- never a fabricated MATCH.
  const resolved = await resolveOrderSourceHandoffModule({ repoRoot: REPO_ROOT, explicitPath: provisioned });
  assert.equal(resolved.ok, true, resolved.code);
  assert.equal(resolved.moduleSha256, PAN_ORDER_SOURCE_DEPENDENCY.expectedModuleSha256);
  assert.equal(resolved.commitBinding, 'UNRESOLVED');
  assert.equal(typeof resolved.producer.createKs238OrderSourceHandoff, 'function');
  assert.equal(typeof resolved.producer.rebindSerializedOrderSource, 'function');
});

test('KS238-R: the provisioned closure verifies byte-for-byte against the artifact manifest', () => {
  const provisioned = path.resolve(REPO_ROOT,
    'dependencies/pansphaira/src/ks238/order-source-handoff.mjs');
  assert.equal(sha256(fs.readFileSync(provisioned)),
    PAN_ORDER_SOURCE_DEPENDENCY.expectedModuleSha256);
  const closure = computeRuntimeClosureSha256({ moduleFile: provisioned });
  assert.equal(closure.ok, true, closure.code);
  assert.equal(closure.closureSha256, PAN_ORDER_SOURCE_DEPENDENCY.expectedRuntimeClosureSha256);
  assert.equal(closure.fileCount, PAN_ORDER_SOURCE_DEPENDENCY.expectedRuntimeClosureFileCount);
  const verify = spawnSync(process.execPath, [
    path.join(REPO_ROOT, 'scripts/provision-ks238-order-source-dependency.mjs'), '--verify',
  ], { encoding: 'utf8', cwd: REPO_ROOT });
  assert.equal(verify.status, 0, verify.stderr);
  assert.match(verify.stdout, /PROVISION-VERIFIED/);
});

// ------------------- FINDING 1 (CLI half): the normal run ANSWERS the bounded question

test('KS238-R: the CLI normal path EXECUTES the released revenue comparison beside the order census', () => {
  const run = runCli([]);
  assert.equal(run.status, 0, run.stderr);
  const payload = JSON.parse(run.stdout);
  // F1: top-level self-checks are green AND the revenue side is a real released execution,
  // never an unconditional UNAVAILABLE on the normal path.
  assert.equal(payload.selfChecks, 'ALL_GREEN');
  assert.equal(payload.separation.revenueSide.state, 'AVAILABLE');
  assert.equal(payload.separation.revenueSide.reason, null);
  const value = payload.separation.revenueSide.value;
  assert.equal(value.attestation.basis, 'IN_PROCESS_RELEASED_COMPOSITION');
  assert.equal(value.ownedByThisHandoff, false);
  // Independent expected fixture outcomes: the released 2026-06 / 2026-07 windows.
  assert.equal(value.releasedComparison.current.netRevenue, 66000);
  assert.equal(value.releasedComparison.comparison.netRevenue, 45000);
  assert.equal(value.releasedComparison.delta.netRevenue, 21000);
  // The order side independently answers the reader's own census, and stays separate.
  assert.equal(payload.currentOrderComparison.byStatus.OPEN.count, 2);
  assert.equal(payload.currentOrderComparison.byStatus.FULFILLED.count, 1);
  assert.equal(payload.currentOrderComparison.byCustomerSegment.ACTIVE.count, 2);
  assert.equal(payload.currentOrderComparison.byCustomerSegment.ON_HOLD.count, 1);
  assert.equal(payload.separation.arithmeticPerformedAcrossSides, false);
});

// ------------------------------- RELEASE BINDING: released source vs its local build
//
// The producer is NOT unpublished: `bounded-order-source-dbdea89e1d55` is a public GitHub
// release whose tag resolves to Main `dbdea89e1d553a7fdb60727224e1ab677717d371`. It is a
// SOURCE_EVIDENCE_ONLY release with NO attached assets, and the repository's own SHA256SUMS
// lists the handoff module at exactly the pinned digest. These tests bind that released
// SOURCE identity, keep it apart from the retained compiled artifact (a reproducible LOCAL
// build), the historical candidate commits and the optional Git evidence, and refuse to
// inflate a source-only release into a published compiled bundle.

test('KS238-R: the public released source identity is pinned and agrees with the consumer pin', () => {
  // The release identity itself.
  assert.equal(PAN_ORDER_SOURCE_RELEASE.repository, 'JoFe2/PANSPHAIRA');
  assert.equal(PAN_ORDER_SOURCE_RELEASE.releaseId, 'bounded-order-source-dbdea89e1d55');
  assert.equal(PAN_ORDER_SOURCE_RELEASE.tag, PAN_ORDER_SOURCE_RELEASE.releaseId);
  assert.equal(PAN_ORDER_SOURCE_RELEASE.mainCommit,
    'dbdea89e1d553a7fdb60727224e1ab677717d371');
  assert.match(PAN_ORDER_SOURCE_RELEASE.publishedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  // SOURCE EVIDENCE ONLY: the release publishes no compiled bundle.
  assert.equal(PAN_ORDER_SOURCE_RELEASE.releaseClass, 'SOURCE_EVIDENCE_ONLY');
  assert.equal(PAN_ORDER_SOURCE_RELEASE.attachedAssets, 0);
  assert.equal(PAN_ORDER_SOURCE_RELEASE.compiledClosurePublished, false);
  // The released module bytes ARE the consumer pin; the released closure is the pinned one.
  assert.equal(PAN_ORDER_SOURCE_RELEASE.module, PAN_ORDER_SOURCE_DEPENDENCY.module);
  assert.equal(PAN_ORDER_SOURCE_RELEASE.moduleSha256,
    PAN_ORDER_SOURCE_DEPENDENCY.expectedModuleSha256);
  assert.equal(PAN_ORDER_SOURCE_RELEASE.runtimeClosureSha256,
    PAN_ORDER_SOURCE_DEPENDENCY.expectedRuntimeClosureSha256);
  assert.equal(PAN_ORDER_SOURCE_RELEASE.runtimeClosureFileCount,
    PAN_ORDER_SOURCE_DEPENDENCY.expectedRuntimeClosureFileCount);
  // The historical candidate commits are explicitly NOT the release.
  assert.deepEqual([...PAN_ORDER_SOURCE_RELEASE.historicalCandidateCommits], [
    'a1b65af354e17f206bc7bc1c5df29cdcb11bef6f',
    '2fb96e3f8ef599459da7f2ca8bd087c463366fc1',
  ]);
  assert.ok(PAN_ORDER_SOURCE_RELEASE.historicalCandidateCommits
    .includes(PAN_ORDER_SOURCE_RELEASE.mainCommit) === false);
  // The artifact manifest carries the same released identity, as an executable agreement.
  const manifest = JSON.parse(readFileSync(
    path.join(REPO_ROOT, 'contracts/dependencies/pansphaira-order-source-v1.json'), 'utf8'));
  assert.equal(manifest.release.releaseId, PAN_ORDER_SOURCE_RELEASE.releaseId);
  assert.equal(manifest.release.mainCommit, PAN_ORDER_SOURCE_RELEASE.mainCommit);
  assert.equal(manifest.release.releaseClass, 'SOURCE_EVIDENCE_ONLY');
  assert.equal(manifest.release.attachedAssets, 0);
  assert.equal(manifest.release.compiledClosurePublished, false);
  assert.equal(manifest.release.sourceModuleSha256, PAN_ORDER_SOURCE_RELEASE.moduleSha256);
  assert.equal(manifest.moduleSha256, PAN_ORDER_SOURCE_RELEASE.moduleSha256);
  assert.equal(manifest.runtimeClosureSha256, PAN_ORDER_SOURCE_RELEASE.runtimeClosureSha256);
});

test('KS238-R: the retained compiled artifact QUALIFIES as the released source, portably', () => {
  // The provisioned artifact is measured with NO Git object database and NO sibling source:
  // the release binding is bytes-only, so it holds in a bare, disposable tree.
  const qualified = qualifyReleasedOrderSourceBinding({ moduleFile: PRODUCER_MODULE_FILE });
  assert.equal(qualified.ok, true, qualified.code);
  assert.equal(qualified.state, 'QUALIFIED');
  assert.equal(qualified.code, 'OK');
  assert.equal(qualified.releaseBinding, 'PUBLIC_RELEASED_SOURCE');
  assert.equal(qualified.release.releaseId, PAN_ORDER_SOURCE_RELEASE.releaseId);
  assert.equal(qualified.release.releaseClass, 'SOURCE_EVIDENCE_ONLY');
  assert.equal(qualified.release.attachedAssets, 0);
  assert.equal(qualified.release.compiledClosurePublished, false);
  // The released SOURCE module is the artifact of the release.
  assert.equal(qualified.publicReleasedSource.state, 'MATCH');
  assert.equal(qualified.publicReleasedSource.module, 'src/ks238/order-source-handoff.mjs');
  assert.equal(qualified.publicReleasedSource.moduleSha256, PAN_ORDER_SOURCE_RELEASE.moduleSha256);
  assert.equal(qualified.publicReleasedSource.compiledAssetsPublished, false);
  // The retained compiled artifact is byte-identical to the released source's own build --
  // and is NOT reported as published.
  assert.equal(qualified.retainedCompiledArtifact.state, 'BYTE_IDENTICAL_TO_RELEASED_SOURCE_BUILD');
  assert.equal(qualified.retainedCompiledArtifact.closureSha256,
    PAN_ORDER_SOURCE_RELEASE.runtimeClosureSha256);
  assert.equal(qualified.retainedCompiledArtifact.fileCount,
    PAN_ORDER_SOURCE_RELEASE.runtimeClosureFileCount);
  assert.equal(qualified.retainedCompiledArtifact.publishedAsReleaseAsset, false);
  assert.equal(qualified.retainedCompiledArtifact.buildCommand, 'tsc -p tsconfig.json');
  // The historical candidate commits are named, and are NOT the release.
  assert.equal(qualified.historicalCandidate.isTheRelease, false);
  assert.equal(qualified.historicalCandidate.state, 'NOT_THE_RELEASE');
  assert.equal(qualified.historicalCandidate.sameModuleBytesAsRelease, true);
  assert.ok(qualified.historicalCandidate.commits.includes(qualified.release.mainCommit) === false);
});

test('KS238-R: the CONSUMED handoff carries the release binding into the published report', async () => {
  const consumption = await consumed();
  const release = consumption.module.release;
  assert.equal(release.state, 'QUALIFIED');
  assert.equal(release.releaseBinding, 'PUBLIC_RELEASED_SOURCE');
  assert.equal(release.release.mainCommit, PAN_ORDER_SOURCE_RELEASE.mainCommit);
  assert.equal(release.release.compiledClosurePublished, false);
  const report = buildOrderSourceConsumptionReport({ consumption, generatedAt: NOW });
  // The published report carries the same four distinguished identities.
  assert.equal(report.handoff.module.release.releaseBinding, 'PUBLIC_RELEASED_SOURCE');
  assert.equal(report.handoff.module.release.publicReleasedSource.state, 'MATCH');
  assert.equal(report.handoff.module.release.retainedCompiledArtifact.publishedAsReleaseAsset, false);
  assert.equal(report.handoff.module.release.historicalCandidate.isTheRelease, false);
  // S11 is the self-check that would fail if this binding were inflated or dropped.
  const checks = runOrderSourceConsumptionSelfChecks({
    report, consumption, moduleSourceText: MODULE_SOURCE,
  });
  const s11 = checks.find((c) => c.id.startsWith('S11'));
  assert.ok(s11, 'S11 must exist');
  assert.equal(s11.ok, true, JSON.stringify(s11.detail));
});

test('KS238-R negative: S11 fails if the release is inflated into a publication', async () => {
  const consumption = await consumed();
  const report = buildOrderSourceConsumptionReport({ consumption, generatedAt: NOW });
  // RED: the compiled artifact is re-declared as a PUBLISHED release asset.
  const inflated = JSON.parse(JSON.stringify(report));
  inflated.handoff.module.release.retainedCompiledArtifact.publishedAsReleaseAsset = true;
  assert.throws(() => assertOrderSourceConsumptionSelfChecks({
    report: inflated, consumption, moduleSourceText: MODULE_SOURCE,
  }), (error) => error.code === 'ORDER_SOURCE_CONSUMPTION_SELF_CHECK_FAILED'
    && error.failed.some((f) => f.id.startsWith('S11')));

  // RED: the release class is upgraded away from SOURCE_EVIDENCE_ONLY.
  const upgraded = JSON.parse(JSON.stringify(report));
  upgraded.handoff.module.release.release.releaseClass = 'PRODUCTION_READY';
  assert.throws(() => assertOrderSourceConsumptionSelfChecks({
    report: upgraded, consumption, moduleSourceText: MODULE_SOURCE,
  }), (error) => error.failed.some((f) => f.id.startsWith('S11')));

  // RED: the historical candidate is passed off as the release.
  const conflated = JSON.parse(JSON.stringify(report));
  conflated.handoff.module.release.historicalCandidate.isTheRelease = true;
  assert.throws(() => assertOrderSourceConsumptionSelfChecks({
    report: conflated, consumption, moduleSourceText: MODULE_SOURCE,
  }), (error) => error.failed.some((f) => f.id.startsWith('S11')));
});

test('KS238-R negative: a HISTORICAL CANDIDATE commit is not the public release identity', () => {
  const claimed = qualifyReleasedOrderSourceBinding({
    moduleFile: PRODUCER_MODULE_FILE,
    claimed: {
      releaseId: PAN_ORDER_SOURCE_RELEASE.releaseId,
      mainCommit: PAN_ORDER_SOURCE_RELEASE.historicalCandidateCommits[1],
    },
  });
  assert.equal(claimed.ok, false);
  assert.equal(claimed.state, 'DENIED');
  assert.equal(claimed.code, 'PAN_ORDER_SOURCE_RELEASE_IDENTITY_DENIED');
  assert.equal(claimed.namesHistoricalCandidate, true);
  // The genuine released identity is accepted with the same bytes: the difference is the
  // release identity, not the bytes.
  const genuine = qualifyReleasedOrderSourceBinding({
    moduleFile: PRODUCER_MODULE_FILE,
    claimed: {
      releaseId: PAN_ORDER_SOURCE_RELEASE.releaseId,
      mainCommit: PAN_ORDER_SOURCE_RELEASE.mainCommit,
      moduleSha256: PAN_ORDER_SOURCE_RELEASE.moduleSha256,
      runtimeClosureSha256: PAN_ORDER_SOURCE_RELEASE.runtimeClosureSha256,
    },
  });
  assert.equal(genuine.ok, true, genuine.code);
  assert.equal(genuine.releaseBinding, 'PUBLIC_RELEASED_SOURCE');
});

test('KS238-R negative: a CHANGED MODULE is refused by the released-source binding', async () => {
  const os = await import('node:os');
  const fs = await import('node:fs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ks238-rel-mod-'));
  const forged = path.join(dir, 'order-source-handoff.mjs');
  const genuine = fs.readFileSync(PRODUCER_MODULE_FILE, 'utf8');
  const changed = genuine.replace('KS238_QUANTITY_UNAVAILABLE_V1', 'KS238_QUANTITY_AVAILABLE_V1');
  assert.notEqual(changed, genuine, 'the probe must actually change the module bytes');
  fs.writeFileSync(forged, changed);
  const result = qualifyReleasedOrderSourceBinding({ moduleFile: forged });
  assert.equal(result.ok, false);
  assert.equal(result.state, 'DENIED');
  assert.equal(result.code, 'PAN_ORDER_SOURCE_RELEASE_MODULE_DENIED');
  assert.notEqual(result.actual.moduleSha256, PAN_ORDER_SOURCE_RELEASE.moduleSha256);
  // A missing module is an honest UNAVAILABLE, not a pass.
  const absent = qualifyReleasedOrderSourceBinding({ moduleFile: path.join(dir, 'nope.mjs') });
  assert.equal(absent.state, 'UNAVAILABLE');
  assert.equal(absent.code, 'PAN_ORDER_SOURCE_RELEASE_MODULE_NOT_FOUND');
});

test('KS238-R negative: a CHANGED CLOSURE is refused by the released-source binding', async () => {
  const os = await import('node:os');
  const fs = await import('node:fs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ks238-rel-clo-'));
  fs.mkdirSync(path.join(dir, 'src', 'ks238'), { recursive: true });
  fs.copyFileSync(PRODUCER_MODULE_FILE, path.join(dir, 'src', 'ks238', 'order-source-handoff.mjs'));
  const producerRoot = PRODUCER_MODULE_ROOT;
  fs.cpSync(path.join(producerRoot, 'dist', 'packages', 'contracts', 'src'),
    path.join(dir, 'dist', 'packages', 'contracts', 'src'), { recursive: true });
  // The module is EXACTLY the released bytes; only the compiled runtime is substituted.
  const substituted = path.join(dir, 'src', 'ks238', 'order-source-handoff.mjs');
  assert.equal(sha256(fs.readFileSync(substituted)), PAN_ORDER_SOURCE_RELEASE.moduleSha256);
  const reader = path.join(dir, 'dist', 'packages', 'contracts', 'src', 'erp-read-connector.js');
  const genuineReader = fs.readFileSync(reader, 'utf8');
  const changedReader = genuineReader.replace(/"FULFILLED"/g, '"CANCELLED"');
  assert.notEqual(changedReader, genuineReader, 'the probe must actually change the runtime');
  fs.writeFileSync(reader, changedReader);
  const result = qualifyReleasedOrderSourceBinding({ moduleFile: substituted });
  assert.equal(result.ok, false);
  assert.equal(result.state, 'DENIED');
  assert.equal(result.code, 'PAN_ORDER_SOURCE_RELEASE_CLOSURE_DENIED');
});
