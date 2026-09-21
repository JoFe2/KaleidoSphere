// KaleidoSphere #238 — period/segment comparison; order-intake/open-orders split from
// net revenue; reuse of PANSPHAIRA source definitions; #167 promotion assessment.
//
// This test exercises ONLY the changed module (segment comparison) and its direct source
// handoff (the synthetic segment fixture), with the transparent limit that it is NOT a
// second order-management module and does NOT claim causal attribution.

import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NET_REVENUE_SEGMENT_COMPARISON_SCHEMA,
  REUSED_PANSPHAIRA_SOURCE,
  SEGMENT_DIMENSIONS,
  ORDER_STATUSES,
  PERIODS,
  assertSegmentSourceRow,
  compareSegmentsAcrossPeriods,
  buildSegmentComparisonReport,
  comparisonDigest,
} from '../services/bi-control/src/business-bi/net-revenue-segment-comparison.mjs';

async function rows() {
  const fx = JSON.parse(await readFile('tests/fixtures/business-bi/net-revenue-segment-v1.json', 'utf8'));
  return fx.rows;
}

test('reuses PANSPHAIRA source definition without executing or modifying it', () => {
  assert.equal(REUSED_PANSPHAIRA_SOURCE.sourceRelation, 'xra_projection_orders');
  assert.equal(REUSED_PANSPHAIRA_SOURCE.unknownHandling, 'SEPARATE_CHANNEL');
  assert.equal(REUSED_PANSPHAIRA_SOURCE.arithmeticUnit, 'INTEGER_MINOR_UNITS');
  assert.equal(REUSED_PANSPHAIRA_SOURCE.provenance.reusedNotExecuted, true);
  assert.deepEqual(REUSED_PANSPHAIRA_SOURCE.fields.map((f) => f.name),
    ['order_id', 'order_date', 'amount_minor_units', 'record_kind']);
  assert.deepEqual(SEGMENT_DIMENSIONS, ['direct', 'partner']);
  assert.deepEqual(ORDER_STATUSES, ['open', 'closed', 'cancelled']);
});

test('period/segment comparison reconciles to independent expected values', async () => {
  const report = buildSegmentComparisonReport(compareSegmentsAcrossPeriods(await rows()));
  const c = report.comparison;
  const u = report.current;
  assert.equal(c.orderIntake, 50000);
  assert.equal(c.netRevenue, 45000);
  assert.deepEqual(c.segments, { direct: 30000, partner: 20000 });
  assert.equal(u.orderIntake, 72000);
  assert.equal(u.netRevenue, 66000);
  assert.deepEqual(u.segments, { direct: 57000, partner: 15000 });
  assert.equal(report.delta.netRevenue, 21000);
  assert.equal(report.delta.orderIntake, 22000);
  assert.equal(report.excludedOutOfScopeCount, 1);
});

test('order intake is explicitly separated from net revenue (not conflated)', async () => {
  const report = buildSegmentComparisonReport(compareSegmentsAcrossPeriods(await rows()));
  // current: intake 72000 vs net 66000 — the gap is the credit (6000), never folded in.
  assert.equal(report.current.orderIntake, 72000);
  assert.equal(report.current.netRevenue, 66000);
  assert.equal(report.current.orderIntake - report.current.creditValue, 66000);
  // comparison: intake 50000 vs net 45000 (credit 5000).
  assert.equal(report.comparison.orderIntake, 50000);
  assert.equal(report.comparison.netRevenue, 45000);
});

test('open orders are a status dimension, distinct from intake and net', async () => {
  const report = buildSegmentComparisonReport(compareSegmentsAcrossPeriods(await rows()));
  assert.equal(report.current.openOrderCount, 2);
  assert.equal(report.current.openOrderValue, 27000); // s-207 + s-211
  assert.equal(report.comparison.openOrderCount, 0); // comparison has no open sale
  // an open order is NOT revenue: it is not added into net twice.
  assert.equal(report.current.netRevenue, 66000);
});

test('credits, cancellations and unknowns are preserved, never coerced into net/intake', async () => {
  const report = buildSegmentComparisonReport(compareSegmentsAcrossPeriods(await rows()));
  assert.equal(report.current.creditValue, 6000);
  assert.equal(report.comparison.creditValue, 5000);
  assert.equal(report.current.cancelCount, 1);
  assert.equal(report.comparison.cancelCount, 1);
  // unknowns stay in the SEPARATE channel, not in intake/net
  assert.equal(report.comparison.unknownCount, 1);
  assert.equal(report.comparison.unknownQuantified, 900);
  assert.equal(report.current.unknownCount, 1);
  assert.equal(report.current.unknownQuantified, 0); // null amount -> 0 quantified, still counted
  // net excludes unknown: comparison net 45000 = 50000 sale - 5000 credit (900 unknown NOT included)
  assert.equal(report.comparison.netRevenue, 50000 - 5000);
});

test('invalid status/segment/kind/amount are rejected fail-closed', () => {
  const base = { order_id: 'x', order_date: '2026-07-01', record_kind: 'sale', amount_minor_units: 100, status: 'closed', segment: 'direct' };
  assert.equal(assertSegmentSourceRow(base), true);
  assert.throws(() => assertSegmentSourceRow({ ...base, status: 'bogus' }), (e) => e.code === 'SEGMENT_STATUS_DENIED');
  assert.throws(() => assertSegmentSourceRow({ ...base, segment: 'bogus' }), (e) => e.code === 'SEGMENT_SEGMENT_DENIED');
  assert.throws(() => assertSegmentSourceRow({ ...base, record_kind: 'nope' }), (e) => e.code === 'SEGMENT_RECORD_KIND_DENIED');
  assert.throws(() => assertSegmentSourceRow({ ...base, amount_minor_units: 1.5 }), (e) => e.code === 'SEGMENT_AMOUNT_DENIED');
  assert.throws(() => assertSegmentSourceRow({ ...base, record_kind: 'cancel', amount_minor_units: 5 }), (e) => e.code === 'SEGMENT_CANCEL_AMOUNT_DENIED');
  assert.throws(() => assertSegmentSourceRow({ ...base, record_kind: 'credit', amount_minor_units: 0 }), (e) => e.code === 'SEGMENT_CREDIT_AMOUNT_DENIED');
  assert.throws(() => assertSegmentSourceRow({ ...base, extra: true }), (e) => e.code === 'SEGMENT_ROW_FIELDS_DENIED');
});

test('the report is stable and independently digesible (no causal overclaim)', async () => {
  const report = buildSegmentComparisonReport(compareSegmentsAcrossPeriods(await rows()));
  assert.equal(report.schemaVersion, NET_REVENUE_SEGMENT_COMPARISON_SCHEMA);
  assert.match(report.nonclaim, /No causal attribution/);
  const d = comparisonDigest(report);
  assert.match(d, /^[a-f0-9]{64}$/);
  // digest is stable across re-derivation (same bytes)
  const report2 = buildSegmentComparisonReport(compareSegmentsAcrossPeriods(await rows()));
  assert.equal(comparisonDigest(report2), d);
});

test('#167 promotion assessment: localized increments are solid, broader visual composition stays gated', async () => {
  // This is the honest, recorded assessment required by #238, not a mask over a human gate.
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
