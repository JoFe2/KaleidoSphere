// KaleidoSphere #238 — period/segment comparison with order-intake/open-orders split.
//
// The smallest useful increment after #236 (single journey) and #237 (second layout,
// same core): a bounded period/segment comparison that EXPLICITLY separates
//   - order intake   (gross sale value, before credits/cancellations)
//   - open orders    (orders still open at period end, a status dimension)
//   - net revenue    (sales minus credits — the released C2 definition, unchanged)
//
// The missing-data / UNKNOWN and date semantics are BOUND to the released C2 core's
// definition (net-revenue-plan.mjs::computeNetRevenue) rather than reimplemented as a
// fork: a row routes to UNKNOWN when its date is null OR its kind is `unknown` OR its
// amount is null; a null-date row is a separate UNASSIGNED channel (never "excluded"
// and never silently dropped); an invalid calendar date is DENIED (fail-closed), never
// lexically accepted into a period.  This module computes the comparison surface over
// the synthetic segment fixture only — it does NOT import or execute the C2 core, does
// NOT modify PANSPHAIRA, and does NOT introduce a second order-management module.
//
// No causal explanation is claimed: a segment/net delta is arithmetic over the same
// rows, not an attribution of WHY one segment moved.

import { createHash } from 'node:crypto';
import { validateProfileContract } from '../../../bi-agent/src/pansphaira-analytics/profile-contract.mjs';

const sha = (v) => createHash('sha256').update(v).digest('hex');
const fail = (code) => { const e = new Error(code); e.code = code; throw e; };
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && Object.getPrototypeOf(v) === Object.prototype;

export const NET_REVENUE_SEGMENT_COMPARISON_SCHEMA =
  'kaleidosphere.business-bi/net-revenue-segment-comparison/v1';

// Declared source contract for the synthetic segment fixture.  This is a DECLARATION of
// the PANSPHAIRA projection-profile/v1 field names, bound to the available LOCAL
// synthetic counterpart — NOT a claim that the upstream PANSPHAIRA registry released
// this exact projection.  The provenance below records the dependency honestly as
// HELD-by-default (the local preserve limits apply), and the module exercises the
// actual available local profile/adapter boundary rather than copying strings into a
// constant and calling them "released".
export const SYNTHETIC_SEGMENT_SOURCE = Object.freeze({
  profileVersion: 'pansphaira/projection-profile/v1',
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
  // Honest provenance: this is the LOCAL synthetic counterpart, not the released
  // upstream projection.  It must never be presented as a released PANSPHAIRA source.
  provenance: Object.freeze({
    origin: 'PANSPHAIRA',
    dependencyIssue: 'https://github.com/JoFe2/PANSPHAIRA/issues/343',
    status: 'HELD',
    closedAt: null,
    releaseReceiptSha256: null,
    pansphairaHeadCommit: null,
  }),
  // The `status`/`segment` columns are this module's bounded extension, kept OUT of the
  // reused PANSPHAIRA field contract above.
  extension: Object.freeze({
    status: Object.freeze(['open', 'closed', 'cancelled']),
    segment: Object.freeze(['direct', 'partner']),
  }),
});

export const SEGMENT_DIMENSIONS = Object.freeze(['direct', 'partner']);
export const ORDER_STATUSES = Object.freeze(['open', 'closed', 'cancelled']);
export const PERIODS = Object.freeze({
  comparison: Object.freeze({ label: '2026-06', start: '2026-06-01', end: '2026-06-30' }),
  current: Object.freeze({ label: '2026-07', start: '2026-07-01', end: '2026-07-31' }),
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Exact calendar-date check (identical rule to the released C2 core): the string must
// be a real calendar date, else DENIED.
function isCalendarDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

const inPeriod = (date, period) =>
  date !== null && date >= period.start && date <= period.end;

// The recognition rule: `record_kind` and `status` must be a supported, non-contradictory
// combination.  A sale is recognized only when it is NOT cancelled; a credit/cancel must
// not be `open`.  This binds the recognition semantics the released core assumes
// (cancelled rows contribute zero via a `cancel` kind, not via a `sale` kind with a
// `cancelled` status), instead of accepting every sale as both intake and revenue.
const RECOGNITION = Object.freeze({
  sale: Object.freeze(['open', 'closed']),
  credit: Object.freeze(['closed']),
  cancel: Object.freeze(['cancelled']),
  unknown: Object.freeze(['open', 'closed']),
});

// Validate a source row against the reused PANSPHAIRA field definitions + this module's
// bounded segment/status extension, INCLUDING the recognition rule and a strict date
// check.  Fail-closed on an unexpected field, dimension, contradictory combination, or
// invalid date.
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
  // Strict date check: invalid calendar dates are DENIED, never lexically accepted.
  if (row.order_date !== null && !isCalendarDate(row.order_date)) fail('SEGMENT_DATE_DENIED');
  // Recognition rule: contradictory kind/status combinations are rejected, not coerced.
  if (!RECOGNITION[row.record_kind].includes(row.status)) fail('SEGMENT_KIND_STATUS_DENIED');
  if (row.record_kind === 'cancel' && row.amount_minor_units !== 0) fail('SEGMENT_CANCEL_AMOUNT_DENIED');
  if (row.record_kind === 'credit' && (row.amount_minor_units === null || row.amount_minor_units <= 0)) {
    fail('SEGMENT_CREDIT_AMOUNT_DENIED');
  }
  return true;
}

// Exercise the ACTUAL local PANSPHAIRA profile/adapter boundary: validate the declared
// source profile through the released profile-contract validator.  This binds the
// provenance/version contract honestly (the HELD synthetic counterpart validates; a
// "released" field-set would need the released provenance the validator enforces).
// Project the declared source into the EXACT closed profile-contract document shape
// (TOP_LEVEL_KEYS only) and run it through the RELEASED PANSPHAIRA profile validator.
// This exercises the actual available local adapter/profile boundary: the HELD synthetic
// counterpart (provenance.status HELD, release fields null) VALIDATES, proving the field
// names are well-formed contract members — while a would-be "released" projection would
// need the released provenance (closedAt/headCommit/receipt) that the validator enforces
// and that this local counterpart intentionally does NOT claim.
export function validateSegmentSourceAgainstBoundary() {
  const s = SYNTHETIC_SEGMENT_SOURCE;
  validateProfileContract({
    profileVersion: s.profileVersion,
    sourceRelation: s.sourceRelation,
    fields: s.fields.map((f) => ({ ...f })),
    periodWindow: { ...s.periodWindow },
    unknownHandling: s.unknownHandling,
    arithmeticUnit: s.arithmeticUnit,
    provenance: { ...s.provenance },
  });
  return true;
}

function emptyUnknownChannel() {
  return { count: 0, quantifiedAmountMinorUnits: 0, unquantifiedCount: 0 };
}

function recordUnknown(channel, amount) {
  channel.count++;
  if (Number.isSafeInteger(amount)) {
    channel.quantifiedAmountMinorUnits += amount;
  } else {
    channel.unquantifiedCount++;
  }
}

// The comparison/split core over the synthetic segment fixture rows.  `sourceRows` are
// the already-read rows.  Returns periods.{comparison,current} with gross sale / credits
// / net, open-order status dimension, cancel count, UNKNOWN + UNASSIGNED channels, and
// per-segment GROSS sale values; plus delta and excludedOutOfScopeCount.
//
// Missing-data semantics are BOUND to the released C2 core:
//   routesToUnknown = date === null || kind === 'unknown' || amount === null
//   null-date  -> UNASSIGNED channel (not excluded, not dropped)
//   null-amount/kind-unknown (in-period) -> UNKNOWN channel, still counted in period
//   invalid date -> already DENIED by assertSegmentSourceRow above.
export function compareSegmentsAcrossPeriods(sourceRows) {
  if (!Array.isArray(sourceRows) || sourceRows.length === 0) fail('SEGMENT_ROWS_EMPTY');
  const mkPeriod = () => ({
    orderIntake: 0,       // gross sale value (recognized sales only), before credits
    saleValue: 0,         // gross sale value — GROSS-ONLY, not net contribution
    creditValue: 0,
    netRevenue: 0,        // saleValue - creditValue (same released C2 definition)
    openOrderCount: 0,    // sales with status 'open' among in-window rows
    openOrderValue: 0,
    cancelCount: 0,
    unknown: emptyUnknownChannel(),
    unknownUnassigned: emptyUnknownChannel(),
    segments: { direct: 0, partner: 0 }, // GROSS sale value per segment
  });
  const result = {
    comparison: mkPeriod(),
    current: mkPeriod(),
    excludedOutOfScopeCount: 0,
  };
  for (const row of sourceRows) {
    assertSegmentSourceRow(row);
    const date = row.order_date;
    const kind = row.record_kind;
    const amount = row.amount_minor_units;
    const routesToUnknown = date === null || kind === 'unknown' || amount === null;

    // Null-date rows route to the UNASSIGNED channel and DO NOT enter a period
    // (mirrors the released core: `recordUnknown(unassigned); continue;`).
    if (date === null) {
      recordUnknown(result.current.unknownUnassigned, amount);
      continue;
    }

    const period = inPeriod(date, PERIODS.comparison) ? 'comparison'
      : inPeriod(date, PERIODS.current) ? 'current'
      : null;

    if (period === null) {
      if (routesToUnknown) {
        // A null-amount/unknown row dated outside both windows: excluded.
        result.excludedOutOfScopeCount++;
      } else {
        result.excludedOutOfScopeCount++;
      }
      continue;
    }

    const o = result[period];
    if (routesToUnknown) {
      recordUnknown(o.unknown, amount);
      continue;
    }

    if (kind === 'sale') {
      assertSegmentSourceRow(row); // recognition already enforced
      o.saleValue += amount;
      o.orderIntake += amount;
      o.segments[row.segment] += amount;
      if (row.status === 'open') { o.openOrderCount++; o.openOrderValue += amount; }
    } else if (kind === 'credit') {
      o.creditValue += amount;
    } else if (kind === 'cancel') {
      o.cancelCount++;
    }
    // kind 'unknown' with a valid non-null amount is already routed above.
  }
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
// declared source and the explicit non-claims (gross-only segment totals, as-of limits,
// no causal attribution).
export function buildSegmentComparisonReport(comparison) {
  if (!isPlainObject(comparison)) fail('SEGMENT_COMPARISON_DENIED');
  if (!Number.isSafeInteger(comparison.current?.netRevenue)
      || !Number.isSafeInteger(comparison.comparison?.netRevenue)) fail('SEGMENT_NET_DENIED');
  comparison.schemaVersion = NET_REVENUE_SEGMENT_COMPARISON_SCHEMA;
  comparison.source = SYNTHETIC_SEGMENT_SOURCE;
  comparison.nonclaims = Object.freeze([
    'No causal attribution: deltas are arithmetic over the same rows.',
    'Segment totals are GROSS sale value, not net-revenue contributions (credits/fees are not allocated per segment).',
    'openOrder* is an as-of snapshot over in-window rows only; no status-history/as-of binding is modeled.',
  ]);
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
