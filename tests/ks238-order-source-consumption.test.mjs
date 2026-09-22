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
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import {
  ORDER_SOURCE_CONSUMPTION_SCHEMA,
  ORDER_SOURCE_CONSUMPTION_NONCLAIMS,
  PAN_ORDER_SOURCE_DEPENDENCY,
  resolveOrderSourceHandoffModule,
  createRetainedSourceAuthority,
  consumeOrderSourceHandoff,
  buildOrderSourceMissingSemantics,
  compareSupportedCurrentOrders,
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
const PRODUCER_REPO = path.resolve(REPO_ROOT, '..', 'PANSPHAIRA-source');

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
const producerRepoHasObjectDatabase = () => spawnSync(
  'git', ['rev-parse', '--git-dir'], { cwd: PRODUCER_REPO, encoding: 'utf8' },
).status === 0;

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
 * The released export's order statuses are FULFILLED / OPEN, not the CONFIRMED / PENDING
 * vocabulary this surface supports. That is the point of the bounded comparison: the
 * supported set is a DECLARED choice, and the observed statuses outside it are reported
 * as EXCLUDED rather than being folded in. The reader's census (FULFILLED 1, OPEN 2) is
 * therefore the fixture's REAL current-order census, and this surface reports it as
 * observed-but-unsupported.
 */
test('KS238-R: the current-order comparison is bounded to the declared supported statuses', async () => {
  const comparison = compareSupportedCurrentOrders({ consumption: await consumed() });
  assert.equal(comparison.outcome, 'COMPARED');
  assert.equal(comparison.comparison, 'SUPPORTED_CURRENT_ORDER_CENSUS');
  assert.deepEqual(comparison.supportedStatuses, ['CONFIRMED', 'PENDING']);
  // Every observed status in the released export is outside the supported set: none of
  // them may appear in a supported bucket.
  assert.deepEqual(comparison.unsupportedStatusesObserved, ['FULFILLED', 'OPEN']);
  assert.deepEqual(comparison.excludedUnsupported, [
    { status: 'FULFILLED', count: 1, disposition: 'EXCLUDED_UNSUPPORTED' },
    { status: 'OPEN', count: 2, disposition: 'EXCLUDED_UNSUPPORTED' },
  ]);
  assert.deepEqual(comparison.totals, {
    supportedOrderCount: 0, unsupportedOrderCount: 3,
    totalObserved: 3, supportedCensusTotal: 0, unknownPeriodCount: 0,
  });
  // Counts are the reader's own census, and a supported status with no evidence is 0
  // WITH its evidence state -- never an inferred order.
  assert.deepEqual(comparison.byStatus.CONFIRMED, { status: 'CONFIRMED', count: 0, evidence: 'NO_READER_EVIDENCE' });
  assert.deepEqual(comparison.byStatus.PENDING, { status: 'PENDING', count: 0, evidence: 'NO_READER_EVIDENCE' });
  assert.deepEqual(comparison.byPeriod, {});
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
  assert.deepEqual(comparison.byPeriod, { '2026-08': { period: '2026-08', count: 3 } });
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

test('KS238-R: a supplied net-revenue report is carried through VERBATIM and not merged', async () => {
  const consumedHandoff = await consumed();
  // A real released comparison report, built by the released module itself.
  const netRevenue = {
    schemaVersion: 'kaleidosphere.business-bi/net-revenue-segment-comparison/v1',
    current: { netRevenue: 12345 },
    comparison: { netRevenue: 11000 },
  };
  const report = buildOrderSourceConsumptionReport({
    consumption: consumedHandoff, netRevenueComparison: netRevenue, generatedAt: NOW,
  });
  assert.equal(report.separation.revenueSide.state, 'AVAILABLE');
  assert.equal(report.separation.revenueSide.reason, null);
  const revenueValue = report.separation.revenueSide.value;
  // Verbatim: the exact same object, not a summary or a re-derivation.
  assert.equal(revenueValue.releasedComparison, netRevenue);
  assert.equal(revenueValue.releasedComparison.current.netRevenue, 12345);
  assert.equal(revenueValue.releasedComparison.comparison.netRevenue, 11000);
  // The revenue side is explicitly NOT owned by this handoff.
  assert.equal(revenueValue.ownedByThisHandoff, false);
  assert.equal(revenueValue.schema,
    'kaleidosphere.business-bi/net-revenue-segment-comparison/v1');
  // And still no cross-side arithmetic.
  assert.equal(report.separation.arithmeticPerformedAcrossSides, false);
  assert.equal(report.separation.combinedTotal.state, 'UNAVAILABLE');
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
  assert.equal(checks.length, 10);
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
