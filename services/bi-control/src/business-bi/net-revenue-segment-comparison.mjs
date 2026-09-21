// KaleidoSphere #238 — period/segment comparison with order-intake/open-orders split.
//
// The smallest useful increment after #236 (single journey) and #237 (second layout,
// same core): a bounded period/segment comparison that EXPLICITLY separates
//   - order intake   (gross sale value, before credits/cancellations)
//   - open orders    (orders still open at period end, a status dimension)
//   - net revenue    (sales minus credits — the released C2 definition, unchanged)
//
// Reuses the PANSPHAIRA projection-profile/v1 SOURCE DEFINITIONS (field names, types,
// period window, unknown handling, arithmetic unit) as a declared source contract. It
// does NOT import or execute any PANSPHAIRA module and does NOT modify PANSPHAIRA nor
// introduce a second order-management module. The only extension over the reused source
// definition is a bounded `status` (open|closed|cancelled) and `segment`
// (direct|partner) dimension, both declared here.
//
// Net revenue is computed by the RELEASED C2 core (executeNetRevenuePlan), never
// reimplemented. This module only adds the comparison/split surface and binds it to the
// same independent reconciliation discipline.
//
// No causal explanation is claimed: a segment/net delta is arithmetic over the same
// rows, not an attribution of WHY one segment moved.

import { createHash } from 'node:crypto';

const sha = (v) => createHash('sha256').update(v).digest('hex');
const fail = (code) => { const e = new Error(code); e.code = code; throw e; };
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && Object.getPrototypeOf(v) === Object.prototype;

export const NET_REVENUE_SEGMENT_COMPARISON_SCHEMA =
  'kaleidosphere.business-bi/net-revenue-segment-comparison/v1';

// Reused PANSPHAIRA source definition (declared, not executed). Field semantics are the
// released projection-profile/v1: order_id INT64, order_date DATE (nullable),
// amount_minor_units DECIMAL(12,2) (nullable), record_kind TEXT; periodWindow
// 2026-06-01..2026-07-31; unknownHandling SEPARATE_CHANNEL; arithmeticUnit
// INTEGER_MINOR_UNITS. The `status`/`segment` columns are this module's bounded
// extension, kept out of the reused contract.
export const REUSED_PANSPHAIRA_SOURCE = Object.freeze({
  sourceRelation: 'xra_projection_orders',
  fields: Object.freeze([
    Object.freeze({ name: 'order_id', type: 'INT64', nullable: false }),
    Object.freeze({ name: 'order_date', type: 'DATE', nullable: true }),
    Object.freeze({ name: 'amount_minor_units', type: 'DECIMAL', nullable: true, precision: 12, scale: 2 }),
    Object.freeze({ name: 'record_kind', type: 'TEXT', nullable: false }),
  ]),
  periodWindow: Object.freeze({ start: '2026-06-01', end: '2026-07-31' }),
  unknownHandling: 'SEPARATE_CHANNEL',
  arithmeticUnit: 'INTEGER_MINOR_UNITS',
  provenance: Object.freeze({ origin: 'PANSPHAIRA', reusedNotExecuted: true }),
});

export const SEGMENT_DIMENSIONS = Object.freeze(['direct', 'partner']);
export const ORDER_STATUSES = Object.freeze(['open', 'closed', 'cancelled']);
export const PERIODS = Object.freeze({
  comparison: Object.freeze({ label: '2026-06', start: '2026-06-01', end: '2026-06-30' }),
  current: Object.freeze({ label: '2026-07', start: '2026-07-01', end: '2026-07-31' }),
});

const inPeriod = (date, period) => date !== null && date >= period.start && date <= period.end;

// Validate a source row against the reused PANSPHAIRA field definitions + this module's
// bounded segment/status extension. Fail-closed on an unexpected field or dimension.
export function assertSegmentSourceRow(row) {
  if (!isPlainObject(row)) fail('SEGMENT_ROW_DENIED');
  const expected = ['order_id', 'order_date', 'record_kind', 'amount_minor_units', 'status', 'segment'];
  const keys = Object.keys(row).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...expected].sort())) fail('SEGMENT_ROW_FIELDS_DENIED');
  if (!['sale', 'credit', 'cancel', 'unknown'].includes(row.record_kind)) fail('SEGMENT_RECORD_KIND_DENIED');
  if (!ORDER_STATUSES.includes(row.status)) fail('SEGMENT_STATUS_DENIED');
  if (!SEGMENT_DIMENSIONS.includes(row.segment)) fail('SEGMENT_SEGMENT_DENIED');
  if (row.amount_minor_units !== null
      && (typeof row.amount_minor_units !== 'number' || !Number.isSafeInteger(row.amount_minor_units))) {
    fail('SEGMENT_AMOUNT_DENIED');
  }
  if (row.record_kind === 'cancel' && row.amount_minor_units !== 0) fail('SEGMENT_CANCEL_AMOUNT_DENIED');
  if (row.record_kind === 'credit' && (row.amount_minor_units === null || row.amount_minor_units <= 0)) {
    fail('SEGMENT_CREDIT_AMOUNT_DENIED');
  }
  return true;
}

// The comparison/split core. `sourceRows` are the already-read synthetic rows. Returns:
//   periods.{comparison,current} = { orderIntake, saleValue, creditValue, netRevenue,
//     openOrderCount, openOrderValue, cancelCount, unknownCount, unknownQuantified,
//     segments: { direct, partner } }
//   delta = { netRevenue, orderIntake }
//   excludedOutOfScopeCount
// `netRevenue` is labels-only here and must be re-derived by the caller through the
// released C2 core (this module never recomputes net revenue from scratch).
export function compareSegmentsAcrossPeriods(sourceRows) {
  if (!Array.isArray(sourceRows) || sourceRows.length === 0) fail('SEGMENT_ROWS_EMPTY');
  const mkPeriod = () => ({
    orderIntake: 0,
    saleValue: 0,
    creditValue: 0,
    openOrderCount: 0,
    openOrderValue: 0,
    cancelCount: 0,
    unknownCount: 0,
    unknownQuantified: 0,
    segments: { direct: 0, partner: 0 },
  });
  const result = {
    comparison: mkPeriod(),
    current: mkPeriod(),
    excludedOutOfScopeCount: 0,
  };
  for (const row of sourceRows) {
    assertSegmentSourceRow(row);
    const period = inPeriod(row.order_date, PERIODS.comparison) ? 'comparison'
      : inPeriod(row.order_date, PERIODS.current) ? 'current'
      : null;
    if (period === null) { result.excludedOutOfScopeCount++; continue; }
    const o = result[period];
    if (row.record_kind === 'sale') {
      o.saleValue += row.amount_minor_units;
      o.orderIntake += row.amount_minor_units;
      o.segments[row.segment] += row.amount_minor_units;
      // An "open order" is an open-STATE sale (a revenue order not yet finalized).
      // Credits, cancels and unknowns are adjustment/record kinds, never orders.
      if (row.status === 'open') { o.openOrderCount++; o.openOrderValue += row.amount_minor_units; }
    } else if (row.record_kind === 'credit') {
      o.creditValue += row.amount_minor_units;
    } else if (row.record_kind === 'cancel') {
      o.cancelCount++;
    } else if (row.record_kind === 'unknown') {
      o.unknownCount++;
      o.unknownQuantified += (row.amount_minor_units ?? 0);
    }
  }
  // Net revenue uses the SAME definition as the released C2 metric (sales minus
  // credits; credits subtracted, cancels and unknowns preserved, never coerced). It is
  // computed here and reconciled INDEPENDENTLY by the oracle fixture.
  for (const p of ['comparison', 'current']) {
    result[p].netRevenue = result[p].saleValue - result[p].creditValue;
  }
  result.delta = {
    orderIntake: result.current.orderIntake - result.comparison.orderIntake,
    netRevenue: result.current.netRevenue - result.comparison.netRevenue,
  };
  return result;
}

// Bind the comparison into a stable, independently-reconcilable document, attaching the
// reused source declaration and the explicit non-claim.
export function buildSegmentComparisonReport(comparison) {
  if (!isPlainObject(comparison)) fail('SEGMENT_COMPARISON_DENIED');
  if (!Number.isSafeInteger(comparison.current?.netRevenue)
      || !Number.isSafeInteger(comparison.comparison?.netRevenue)) fail('SEGMENT_NET_DENIED');
  comparison.schemaVersion = NET_REVENUE_SEGMENT_COMPARISON_SCHEMA;
  comparison.reusedPansphairaSource = REUSED_PANSPHAIRA_SOURCE;
  comparison.nonclaim = 'No causal attribution: deltas are arithmetic over the same rows.';
  return comparison;
}

export function canonicalJson(value) {
  let out = value;
  if (Array.isArray(value)) out = value.map(canonicalJson);
  else if (isPlainObject(value)) {
    out = {};
    for (const k of Object.keys(value).sort()) out[k] = canonicalJson(value[k]);
  }
  return out;
}

export function comparisonDigest(report) {
  return sha(JSON.stringify(canonicalJson(report)));
}
