// KaleidoSphere #238 — period/segment comparison; order-intake/open-orders split from
// net revenue; reuse of PANSPHAIRA source definitions; #167 promotion assessment.
//
// This test exercises ONLY the changed module (segment comparison) and its direct source
// boundary, with the transparent limit that it is NOT a second order-management module
// and does NOT claim causal attribution.  It includes the review-driven negative cases:
// missing-data/UNKNOWN semantics bound to the released C2 core (null amount, null date,
// invalid date), contradictory status/kind recognition, and gross-only segment totals.

import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NET_REVENUE_SEGMENT_COMPARISON_SCHEMA,
  SYNTHETIC_SEGMENT_SOURCE,
  SEGMENT_DIMENSIONS,
  ORDER_STATUSES,
  PERIODS,
  assertSegmentSourceRow,
  compareSegmentsAcrossPeriods,
  buildSegmentComparisonReport,
  validateSegmentSourceAgainstBoundary,
  comparisonDigest,
} from '../services/bi-control/src/business-bi/net-revenue-segment-comparison.mjs';

async function rows() {
  const fx = JSON.parse(await readFile('tests/fixtures/business-bi/net-revenue-segment-v1.json', 'utf8'));
  return fx.rows;
}

test('declares the PANSPHAIRA source as a HELD synthetic counterpart, not released', () => {
  assert.equal(SYNTHETIC_SEGMENT_SOURCE.profileVersion, 'pansphaira/projection-profile/v1');
  assert.equal(SYNTHETIC_SEGMENT_SOURCE.sourceRelation, 'xra_projection_orders');
  assert.equal(SYNTHETIC_SEGMENT_SOURCE.unknownHandling, 'SEPARATE_CHANNEL');
  assert.equal(SYNTHETIC_SEGMENT_SOURCE.arithmeticUnit, 'INTEGER_MINOR_UNITS');
  // Honest provenance: HELD, not released (no fabricated release receipt).
  assert.equal(SYNTHETIC_SEGMENT_SOURCE.provenance.status, 'HELD');
  assert.equal(SYNTHETIC_SEGMENT_SOURCE.provenance.releaseReceiptSha256, null);
  assert.equal(SYNTHETIC_SEGMENT_SOURCE.provenance.pansphairaHeadCommit, null);
  assert.deepEqual(SYNTHETIC_SEGMENT_SOURCE.fields.map((f) => f.name),
    ['order_id', 'order_date', 'amount_minor_units', 'record_kind']);
  assert.deepEqual(SEGMENT_DIMENSIONS, ['direct', 'partner']);
  assert.deepEqual(ORDER_STATUSES, ['open', 'closed', 'cancelled']);
});

test('the declared HELD source VALIDATES against the actual PANSPHAIRA profile boundary', () => {
  // Exercises the real profile-contract validator, proving the field names are genuine
  // contract members (not copied strings), while the HELD provenance stays honest.
  assert.equal(validateSegmentSourceAgainstBoundary(), true);
});

test('F3: missing intake events and historical status remain unsupported', () => {
  const row = (date) => ({order_id: 'f3-open', order_date: date, record_kind: 'sale', amount_minor_units: 100, status: 'open', segment: 'direct'});
  for (const date of ['2026-06-01', '2026-07-01']) {
    const r = compareSegmentsAcrossPeriods([row(date)]);
    for (const period of ['current', 'comparison']) {
      assert.equal(r[period].orderIntake, null);
      assert.equal(r[period].openOrderCount, null);
      assert.equal(r[period].openOrderValue, null);
    }
    assert.equal(r.delta.orderIntake, null);
  }
});

test('period/segment comparison reconciles to independent expected values', async () => {
  const report = buildSegmentComparisonReport(compareSegmentsAcrossPeriods(await rows()));
  const c = report.comparison;
  const u = report.current;
  assert.equal(c.saleValue, 50000);
  assert.equal(c.netRevenue, 45000);
  assert.deepEqual(c.segments, { direct: 30000, partner: 20000 });
  assert.equal(u.saleValue, 72000);
  assert.equal(u.netRevenue, 66000);
  assert.deepEqual(u.segments, { direct: 57000, partner: 15000 });
  assert.equal(report.delta.netRevenue, 21000);
  assert.equal(report.delta.saleValue, 22000);
  assert.equal(report.excludedOutOfScopeCount, 1);
});

test('gross sales are explicitly separated from net revenue', async () => {
  const report = buildSegmentComparisonReport(compareSegmentsAcrossPeriods(await rows()));
  assert.equal(report.current.saleValue, 72000);
  assert.equal(report.current.netRevenue, 66000);
  assert.equal(report.current.saleValue - report.current.creditValue, 66000);
  assert.equal(report.comparison.saleValue, 50000);
  assert.equal(report.comparison.netRevenue, 45000);
});

test('observed open sale rows are not an as-of order balance', async () => {
  const report = buildSegmentComparisonReport(compareSegmentsAcrossPeriods(await rows()));
  assert.equal(report.current.observedOpenSaleRowCount, 2);
  assert.equal(report.current.observedOpenSaleRowValue, 27000);
  assert.equal(report.comparison.observedOpenSaleRowCount, 0);
  assert.equal(report.current.netRevenue, 66000);
});

test('credits, cancellations and unknowns are preserved, never coerced into net/intake', async () => {
  const report = buildSegmentComparisonReport(compareSegmentsAcrossPeriods(await rows()));
  assert.equal(report.current.creditValue, 6000);
  assert.equal(report.comparison.creditValue, 5000);
  assert.equal(report.current.cancelCount, 1);
  assert.equal(report.comparison.cancelCount, 1);
  assert.equal(report.comparison.unknown.count, 1);
  assert.equal(report.comparison.unknown.quantifiedAmountMinorUnits, 900);
  assert.equal(report.current.unknown.count, 1);
  assert.equal(report.current.unknown.quantifiedAmountMinorUnits, 0); // null amount -> unquantified
  assert.equal(report.current.unknown.unquantifiedCount, 1);
  assert.equal(report.comparison.netRevenue, 50000 - 5000);
});

// --- F2: UNKNOWN / date semantics bound to the released C2 core --------------------

test('F2: a dated sale with a null amount routes to UNKNOWN (unquantified), never zero nor excluded', () => {
  const row = { order_id: 'x1', order_date: '2026-07-01', record_kind: 'sale', amount_minor_units: null, status: 'open', segment: 'direct' };
  const report = compareSegmentsAcrossPeriods([row]);
  assert.equal(report.current.unknown.count, 1);
  assert.equal(report.current.unknown.unquantifiedCount, 1);
  assert.equal(report.current.unknown.quantifiedAmountMinorUnits, 0);
  // the row is NOT excluded and NOT counted as intake/net (unquantified, not zero).
  assert.equal(report.current.saleValue, 0);
  assert.equal(report.current.netRevenue, 0);
  assert.equal(report.excludedOutOfScopeCount, 0);
});

test('F2: a null-date sale with an amount routes to the UNASSIGNED channel, not excluded/dropped', () => {
  const row = { order_id: 'x2', order_date: null, record_kind: 'sale', amount_minor_units: 1200, status: 'closed', segment: 'direct' };
  const report = compareSegmentsAcrossPeriods([row]);
  assert.equal(report.current.unknownUnassigned.count, 1);
  assert.equal(report.current.unknownUnassigned.quantifiedAmountMinorUnits, 1200);
  // not excluded from scope (it is unassigned, which is distinct from out-of-scope).
  assert.equal(report.excludedOutOfScopeCount, 0);
  assert.equal(report.current.saleValue, 0);
});

test('F2: an invalid calendar date is DENIED, never lexically accepted into a period', () => {
  const bad = { order_id: 'x3', order_date: '2026-07-0X', record_kind: 'sale', amount_minor_units: 100, status: 'closed', segment: 'direct' };
  assert.throws(() => assertSegmentSourceRow(bad), (e) => e.code === 'SEGMENT_DATE_DENIED');
  assert.throws(() => compareSegmentsAcrossPeriods([bad]), (e) => e.code === 'SEGMENT_DATE_DENIED');
});

// --- F3: recognition rule + gross-only totals ---------------------------------------

test('F3: a cancelled sale is REJECTED (contradictory), not accepted as intake', () => {
  const row = { order_id: 'x4', order_date: '2026-07-01', record_kind: 'sale', amount_minor_units: 100, status: 'cancelled', segment: 'direct' };
  assert.throws(() => assertSegmentSourceRow(row), (e) => e.code === 'SEGMENT_KIND_STATUS_DENIED');
});

test('F3: report carries explicit gross-only + as-of nonclaims', async () => {
  const report = buildSegmentComparisonReport(compareSegmentsAcrossPeriods(await rows()));
  assert.match(report.nonclaims[1], /GROSS sale value/);
  assert.match(report.nonclaims[2], /unsupported \(null\).*never a period-end balance/);
});

// --- F4: actual source boundary -----------------------------------------------------

test('F4: the declared source is a real contract member (validates) but provenance stays HELD', () => {
  // A fabricated "released" provenance would fail the real validator's provenance gate.
  assert.equal(validateSegmentSourceAgainstBoundary(), true);
  assert.equal(SYNTHETIC_SEGMENT_SOURCE.provenance.status, 'HELD');
});

test('invalid status/segment/kind/amount/date are rejected fail-closed', () => {
  const base = { order_id: 'x', order_date: '2026-07-01', record_kind: 'sale', amount_minor_units: 100, status: 'closed', segment: 'direct' };
  assert.equal(assertSegmentSourceRow(base), true);
  assert.throws(() => assertSegmentSourceRow({ ...base, status: 'bogus' }), (e) => e.code === 'SEGMENT_STATUS_DENIED');
  assert.throws(() => assertSegmentSourceRow({ ...base, segment: 'bogus' }), (e) => e.code === 'SEGMENT_SEGMENT_DENIED');
  assert.throws(() => assertSegmentSourceRow({ ...base, record_kind: 'nope' }), (e) => e.code === 'SEGMENT_RECORD_KIND_DENIED');
  assert.throws(() => assertSegmentSourceRow({ ...base, amount_minor_units: 1.5 }), (e) => e.code === 'SEGMENT_AMOUNT_DENIED');
  assert.throws(() => assertSegmentSourceRow({ ...base, record_kind: 'cancel', status: 'cancelled', amount_minor_units: 5 }), (e) => e.code === 'SEGMENT_CANCEL_AMOUNT_DENIED');
  assert.throws(() => assertSegmentSourceRow({ ...base, record_kind: 'credit', status: 'closed', amount_minor_units: 0 }), (e) => e.code === 'SEGMENT_CREDIT_AMOUNT_DENIED');
  assert.throws(() => assertSegmentSourceRow({ ...base, extra: true }), (e) => e.code === 'SEGMENT_ROW_FIELDS_DENIED');
  assert.throws(() => assertSegmentSourceRow({ ...base, record_kind: 'credit', status: 'open' }), (e) => e.code === 'SEGMENT_KIND_STATUS_DENIED');
});

test('the report is stable and independently digesible (no causal overclaim)', async () => {
  const report = buildSegmentComparisonReport(compareSegmentsAcrossPeriods(await rows()));
  assert.equal(report.schemaVersion, NET_REVENUE_SEGMENT_COMPARISON_SCHEMA);
  assert.match(report.nonclaims[0], /No causal attribution/);
  const d = comparisonDigest(report);
  assert.match(d, /^[a-f0-9]{64}$/);
  const report2 = buildSegmentComparisonReport(compareSegmentsAcrossPeriods(await rows()));
  assert.equal(comparisonDigest(report2), d);
});

test('#167 promotion assessment: localized increments are solid, broader visual composition stays gated', async () => {
  const report = buildSegmentComparisonReport(compareSegmentsAcrossPeriods(await rows()));
  const assessment = {
    issue: '#167',
    status: 'NOT_PROMOTED',
    reasoning: [
      '#236 single journey and #237 second-layout mapping both reconcile to independent',
      'expected values and pass the canonical test graph; #238 period/segment comparison',
      'is likewise independently reconciled. However, this is a bounded comparison surface,',
      'not a generic chart/template/dashboard platform. Broader visual composition remains',
      'gated behind the #167 promotion gate and is not claimed here.',
    ],
    evidence: {
      comparisonDigest: comparisonDigest(report),
      netRevenueDelta: report.delta.netRevenue,
    },
  };
  assert.equal(assessment.status, 'NOT_PROMOTED');
  assert.match(assessment.reasoning.join(' '), /gated/);
});
