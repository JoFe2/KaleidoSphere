// KaleidoSphere #238 — positive local F4 composition: real source -> #237 mapping profile
// boundary -> #238 segment comparison, exposed as ONE usable documented entry point.
// This is the previously-unimplemented "#237 -> #238" CLI path.
//
// Reused unchanged: mapLedgerRowsToCanonical + frozen LEDGER_MAPPING_PROFILES (#237);
// compareSegmentsAcrossPeriods + buildSegmentComparisonReport + comparisonDigest (#238);
// serializeHoldout (C2 byte-bound serializer). Nothing reimplements the metric core,
// profile validator, recognition rule, or comparison arithmetic.
//
// Genuinely new (this module only):
//   - a real local PostgreSQL source relation carrying the ledger kernel columns AND the
//     #238 `status`/`segment` business extension columns;
//   - orchestration: read -> map kernel via frozen profile -> attach extension -> compare;
//   - explicit provenance: the DI source is synthetic (marked), the #238 source stays
//     HELD, and `status`/`segment` are read from the real source rows, never invented.
//
// The frozen #237 profile for ledger-v2 declares dropped=['segment'] and closed fields
// [row_key, occurred_at, entry_kind, atomic_value, segment]; its dropped `segment` is a
// ledger stream column, NOT the business segment dimension. To keep the business
// `segment` unambiguous, the source relation names the ledger-v2 stream column
// `ledger_stream` and the kernel projection renames it to the profile's dropped `segment`
// only when handing the row to the frozen profile. The #238 status/segment are attached
// afterwards from the same real source rows.

import { createHash } from 'node:crypto';

import {
  LEDGER_MAPPING_PROFILES,
  AMBIGUOUS_UNITS_PROFILE,
  WRONG_SCALE_PROFILE,
  mapLedgerRowsToCanonical,
} from './net-revenue-ledger-mapping.mjs';
import {
  NET_REVENUE_SEGMENT_COMPARISON_SCHEMA,
  compareSegmentsAcrossPeriods,
  buildSegmentComparisonReport,
  comparisonDigest,
} from './net-revenue-segment-comparison.mjs';
import { serializeHoldout } from '../db-analyzer/postgresql-safe-analysis.mjs';

export const NET_REVENUE_F4_COMPOSITION_SCHEMA =
  'kaleidosphere.business-bi/net-revenue-f4-composition/v1';

// Re-export the frozen negative profiles so the negative paths exercise the SAME frozen
// gate at the SAME entry point, never a parallel validator.
export { AMBIGUOUS_UNITS_PROFILE, WRONG_SCALE_PROFILE };

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const fail = (code) => { const e = new Error(code); e.code = code; throw e; };
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && Object.getPrototypeOf(v) === Object.prototype;

export const F4_LAYOUT_VERSIONS = Object.freeze(['ledger-v1', 'ledger-v2']);
export const F4_PROFILE_BY_LAYOUT = Object.freeze({
  'ledger-v1': 'ledger-mapping-v1',
  'ledger-v2': 'ledger-mapping-v2',
});

const F4_CLOSED_COLUMNS = Object.freeze({
  'ledger-v1': Object.freeze([
    'row_key', 'occurred_at', 'posting_type', 'value_atomic_units', 'stream', 'status', 'segment',
  ]),
  'ledger-v2': Object.freeze([
    'row_key', 'occurred_at', 'entry_kind', 'atomic_value', 'ledger_stream', 'status', 'segment',
  ]),
});

function assertDatabaseShape(database) {
  if (!isPlainObject(database)
      || typeof database.exec !== 'function'
      || typeof database.query !== 'function') fail('F4_DATABASE_DENIED');
}

const F4_DDL = Object.freeze({
  'ledger-v1': [
    'CREATE SCHEMA IF NOT EXISTS synthetic_bi',
    'CREATE TABLE IF NOT EXISTS synthetic_bi.orders_ledger ('
      + ' row_key text PRIMARY KEY,'
      + ' occurred_at date,'
      + ' posting_type text,'
      + ' value_atomic_units integer,'
      + ' stream text,'
      + ' status text,'
      + ' segment text)',
  ].join(';\n'),
  'ledger-v2': [
    'CREATE SCHEMA IF NOT EXISTS synthetic_bi',
    'CREATE TABLE IF NOT EXISTS synthetic_bi.orders_ledger ('
      + ' row_key text PRIMARY KEY,'
      + ' occurred_at date,'
      + ' entry_kind text,'
      + ' atomic_value integer,'
      + ' ledger_stream text,'
      + ' status text,'
      + ' segment text)',
  ].join(';\n'),
});

function sqlQuote(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

export async function seedF4Database(database, layoutVersion, sourceRows) {
  assertDatabaseShape(database);
  if (!F4_LAYOUT_VERSIONS.includes(layoutVersion)) fail('F4_LAYOUT_VERSION_DENIED');
  if (!Array.isArray(sourceRows) || sourceRows.length === 0) fail('F4_ROWS_EMPTY');
  const cols = F4_CLOSED_COLUMNS[layoutVersion];
  await database.exec(F4_DDL[layoutVersion]);
  for (const row of sourceRows) {
    const values = cols.map((c) => sqlQuote(row[c]));
    await database.exec(
      `INSERT INTO synthetic_bi.orders_ledger (${cols.join(', ')}) VALUES (${values.join(', ')})`,
    );
  }
  return true;
}

const F4_SELECT = Object.freeze({
  'ledger-v1':
    'SELECT row_key, occurred_at::text AS occurred_at, posting_type, value_atomic_units, stream, status, segment '
    + 'FROM synthetic_bi.orders_ledger ORDER BY row_key',
  'ledger-v2':
    'SELECT row_key, occurred_at::text AS occurred_at, entry_kind, atomic_value, ledger_stream, status, segment '
    + 'FROM synthetic_bi.orders_ledger ORDER BY row_key',
});

export async function readF4SourceRows(database, layoutVersion) {
  assertDatabaseShape(database);
  if (!F4_LAYOUT_VERSIONS.includes(layoutVersion)) fail('F4_LAYOUT_VERSION_DENIED');
  const result = await database.query(F4_SELECT[layoutVersion]);
  return Array.isArray(result.rows) ? result.rows : [];
}

// Project a REAL source row to the exact frozen-#237 kernel row (4 roles + dropped),
// stripping the #238 status/segment extension so the profile sees only its closed set.
function kernelProjection(layoutVersion, row) {
  if (layoutVersion === 'ledger-v1') {
    return {
      row_key: row.row_key,
      occurred_at: row.occurred_at,
      posting_type: row.posting_type,
      value_atomic_units: row.value_atomic_units,
      stream: row.stream,
    };
  }
  return {
    row_key: row.row_key,
    occurred_at: row.occurred_at,
    entry_kind: row.entry_kind,
    atomic_value: row.atomic_value,
    segment: row.ledger_stream, // frozen ledger-v2 dropped column name
  };
}

// Map the kernel through a mapping profile (defaults to the frozen profile for the
// layout) and attach the #238 status/segment extension read from the SAME real source
// rows. Returns { canonicalRows, comparisonRows, kernelProfile }.
export function composeViaProfile(layoutVersion, sourceRows, { profile = null } = {}) {
  if (!F4_LAYOUT_VERSIONS.includes(layoutVersion)) fail('F4_LAYOUT_VERSION_DENIED');
  const effectiveProfile = profile ?? LEDGER_MAPPING_PROFILES[F4_PROFILE_BY_LAYOUT[layoutVersion]];
  const canonicalRows = mapLedgerRowsToCanonical(effectiveProfile, sourceRows.map((r) => kernelProjection(layoutVersion, r)));
  const byKey = new Map(sourceRows.map((r) => [r.row_key, r]));
  const comparisonRows = canonicalRows.map((c) => {
    const src = byKey.get(c.order_id);
    if (!src) fail(`F4_EXTENSION_MISSING:${c.order_id}`);
    return {
      order_id: c.order_id,
      order_date: c.order_date,
      record_kind: c.record_kind,
      amount_minor_units: c.amount_minor_units,
      status: src.status ?? null,
      segment: src.segment ?? null,
    };
  });
  return {
    canonicalRows,
    comparisonRows,
    kernelProfile: F4_PROFILE_BY_LAYOUT[layoutVersion],
    usedDeclaredProfile: profile !== null,
  };
}

export function buildF4CanonicalRead(mappedCanonicalRows, rawSource) {
  const rows = mappedCanonicalRows.map((r) => ({ ...r }));
  const provenance = Object.freeze({ ...(isPlainObject(rawSource) ? rawSource : {}) });
  const read = async ({ request }) => {
    if (Number.isInteger(request.bounds.rowBudget) && rows.length > request.bounds.rowBudget) {
      fail('BUSINESS_BI_ROW_COUNT_EVIDENCE_DENIED');
    }
    return {
      state: 'COMPLETE',
      reasonCode: null,
      bytes: serializeHoldout(rows),
      evidence: {
        accessMode: 'READ_ONLY',
        mutationCount: 0,
        bounded: true,
        relation: 'synthetic_bi.orders',
        rowsRead: rows.length,
      },
    };
  };
  read.provenance = provenance;
  return read;
}

// Single composition entry point for one layout version. `sourceRows` are the ALREADY
// read real-source rows (the caller seeded + read them). Optionally pass an explicit
// `profile` to drive a negative (wrong/ambiguous unit) case through the same boundary.
export function composeF4ForLayout(layoutVersion, sourceRows, { sourceMode = 'SYNTHETIC_FALLBACK', profile = null } = {}) {
  const { canonicalRows, comparisonRows, kernelProfile, usedDeclaredProfile } =
    composeViaProfile(layoutVersion, sourceRows, { profile });
  const report = buildSegmentComparisonReport(compareSegmentsAcrossPeriods(comparisonRows));
  const kernelDigest = sha256(serializeHoldout(canonicalRows));
  return {
    schemaVersion: NET_REVENUE_F4_COMPOSITION_SCHEMA,
    layoutVersion,
    kernelProfile,
    usedDeclaredProfile,
    sourceMode,
    sourceMarking: 'SYNTHETIC',
    kernelDigest,
    comparisonDigest: comparisonDigest(report),
    kernelRowCount: canonicalRows.length,
    comparison: report,
  };
}

export function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON rejects non-finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError('Canonical JSON accepts plain JSON objects only');
  }
  const entries = Object.keys(value).sort().map((key) => {
    if (value[key] === undefined) throw new TypeError('Canonical JSON rejects undefined object values');
    return `${JSON.stringify(key)}:${canonicalJson(value[key])}`;
  });
  return `{${entries.join(',')}}`;
}
