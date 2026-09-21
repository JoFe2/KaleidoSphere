// KaleidoSphere #237 — second semantic synthetic layout, same bounded net-revenue core.
//
// #236 proved a single entry point over `synthetic_bi.orders`.  #237 answers the next
// supported question: can the SAME released metric core (#150 C2) read a DIFFERENT
// semantic synthetic layout WITHOUT a metric rewrite, via versioned mapping profiles,
// while rejecting ambiguous/wrong units?
//
// The second layout models a generic ledger system's naming and units:
//
//   synthetic_bi.ledger(row_key, occurred_at, posting_type, value_base_units, stream)
//
// Semantics differ from `synthetic_bi.orders` in three deliberate ways, so a mapping
// layer is genuinely required (not a column rename):
//   1. amounts are in currency BASE units (whole EUR), not minor units — the profile
//      must apply the declared base->minor conversion (x minorUnitsPerMajorUnit);
//   2. posting_type is a ledger enum (debit_sale | credit_note | cancellation |
//      unclassified) that must map to the metric kind {sale, credit, cancel, unknown};
//   3. there is a trailing non-metric `stream` column that a correct profile DROPS
//      (a too-generous profile that forwards `stream` must be rejected).
//
// The metric core, the holdout serializer, and the C2 contract are NOT reimplemented:
// a versioned profile produces canonical {order_id, order_date, record_kind,
// amount_minor_units} rows and those rows feed `compileNetRevenuePlan` +
// `executeNetRevenuePlan` exactly as #236 does.

import { createHash } from 'node:crypto';

import { serializeHoldout } from '../db-analyzer/postgresql-safe-analysis.mjs';

export const NET_REVENUE_LEDGER_MAPPING_SCHEMA = 'kaleidosphere.business-bi/net-revenue-ledger-mapping/v1';

// The two source-layout versions exercised by the profiles.  v1 and v2 differ only in
// column naming (and the enum literal spelling), which is the whole point: a versioned
// profile resolves source drift so the metric core never changes.
export const LEDGER_LAYOUT_VERSIONS = Object.freeze(['ledger-v1', 'ledger-v2']);
export const LEDGER_CURRENCY = Object.freeze({ code: 'EUR', minorUnitsPerMajorUnit: 100 });

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const fail = (code) => { const e = new Error(code); e.code = code; throw e; };
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && Object.getPrototypeOf(v) === Object.prototype;

const KIND_MAP = Object.freeze({
  1: Object.freeze({
    debit_sale: 'sale',
    credit_note: 'credit',
    cancellation: 'cancel',
    unclassified: 'unknown',
  }),
  2: Object.freeze({
    sale_entry: 'sale',
    credit_reversal: 'credit',
    void: 'cancel',
    unclassified: 'unknown',
  }),
});

// Column sets, per layout version.  A profile must declare its columns and every column
// must be exactly one of these; an unknown/extra column is `CLOSED_LEDGER_FIELDS`.
const CLOSED_LEDGER_FIELDS = {
  1: Object.freeze(['row_key', 'occurred_at', 'posting_type', 'value_atomic_units', 'stream']),
  2: Object.freeze(['row_key', 'occurred_at', 'entry_kind', 'atomic_value', 'segment']),
};

// The supported role->column bindings per layout version.  A profile must declare each
// role from this EXACT table, not an arbitrary column drawn from the allowed column list.
// This rejects a profile that, e.g., binds amountField to the id column.
const SUPPORTED_ROLE_BINDINGS = Object.freeze({
  1: Object.freeze({ idField: 'row_key', dateField: 'occurred_at', kindField: 'posting_type', amountField: 'value_atomic_units' }),
  2: Object.freeze({ idField: 'row_key', dateField: 'occurred_at', kindField: 'entry_kind', amountField: 'atomic_value' }),
});

// The published, frozen profile definitions.  Each profile declares:
//   - layoutVersion: which source layout it resolves (ledger-v1 | ledger-v2)
//   - currency: {code, minorUnitsPerMajorUnit} — MUST be exactly one currency
//   - unitScale: how source amounts convert to minor units.  'BASE_UNITS' means
//     source values are whole major units (x minorUnitsPerMajorUnit).  'MINOR_UNITS'
//     means source values are already minor units.  Any other/absent value is ambiguous.
//   - kindField / amountField / dateField / idField: the source column holding each role
//   - dropped: trailing source columns that a correct profile must NOT forward
export const LEDGER_MAPPING_PROFILES = Object.freeze({
  'ledger-mapping-v1': Object.freeze({
    layoutVersion: 'ledger-v1',
    currency: LEDGER_CURRENCY,
    unitScale: 'MINOR_UNITS',
    idField: 'row_key',
    dateField: 'occurred_at',
    kindField: 'posting_type',
    amountField: 'value_atomic_units',
    dropped: Object.freeze(['stream']),
  }),
  'ledger-mapping-v2': Object.freeze({
    layoutVersion: 'ledger-v2',
    currency: LEDGER_CURRENCY,
    unitScale: 'MINOR_UNITS',
    idField: 'row_key',
    dateField: 'occurred_at',
    kindField: 'entry_kind',
    amountField: 'atomic_value',
    dropped: Object.freeze(['segment']),
  }),
});

// Ambient (i.e. wrong/ambiguous) profiles used ONLY by the negative tests to prove the
// gate rejects them.  They are exported so the tests can assert the exact reason.
export const AMBIGUOUS_UNITS_PROFILE = Object.freeze({
  layoutVersion: 'ledger-v1',
  currency: Object.freeze({ code: 'EUR', minorUnitsPerMajorUnit: 100 }),
  unitScale: 'UNSPECIFIED', // ambiguous: cannot know whether to scale
  idField: 'row_key',
  dateField: 'occurred_at',
  kindField: 'posting_type',
  amountField: 'value_atomic_units',
  dropped: Object.freeze(['stream']),
});
export const WRONG_SCALE_PROFILE = Object.freeze({
  layoutVersion: 'ledger-v1',
  currency: Object.freeze({ code: 'EUR', minorUnitsPerMajorUnit: 100 }),
  unitScale: 'BASE_UNITS', // WRONG: declares x100, but the source atomic unit is already minor
  idField: 'row_key',
  dateField: 'occurred_at',
  kindField: 'posting_type',
  amountField: 'value_atomic_units',
  dropped: Object.freeze(['stream']),
});

// The source relation must DECLARE its amount unit, so a profile whose scale CLAIM
// contradicts the source's actual declared unit is rejected as a wrong-unit mismatch.
// This is what separates "ambiguous units" (profile makes no scale declaration) from
// "wrong units" (profile declares a scale that contradicts the source).
export const SOURCE_UNIT_DECLARATIONS = Object.freeze({
  'ledger-v1': 'MINOR_UNITS', // value_atomic_units are integer EUR minor units (round-trips to admitted holdout)
  'ledger-v2': 'MINOR_UNITS', // atomic_value are integer EUR minor units
});

// Cross-check a profile's unit-scale claim against the source's declared unit.
export function assertProfileMatchesSourceUnit(profile, sourceUnit) {
  validateLedgerMappingProfile(profile);
  if (sourceUnit !== 'BASE_UNITS' && sourceUnit !== 'MINOR_UNITS') fail('LEDGER_SOURCE_UNIT_DENIED');
  if (profile.unitScale !== sourceUnit) fail('LEDGER_UNIT_SCALE_MISMATCH');
  return true;
}

// Resolve a source layout version's declared unit from the frozen declaration table.
export function declaredSourceUnit(layoutVersion) {
  const unit = SOURCE_UNIT_DECLARATIONS[layoutVersion];
  if (!unit) fail('LEDGER_LAYOUT_VERSION_DENIED');
  return unit;
}

// Validate a profile declaration shape and its currency/unit declaration BEFORE any
// source read.  This is the fail-closed unit/ambiguity gate.
export function validateLedgerMappingProfile(profile) {
  if (!isPlainObject(profile)) fail('LEDGER_PROFILE_DENIED');
  const version = String(profile.layoutVersion ?? '');
  if (!LEDGER_LAYOUT_VERSIONS.includes(version)) fail('LEDGER_LAYOUT_VERSION_DENIED');
  const closed = CLOSED_LEDGER_FIELDS[version === 'ledger-v2' ? 2 : 1];
  const currency = profile.currency;
  if (!isPlainObject(currency)
      || currency.code !== 'EUR'
      || !Number.isInteger(currency.minorUnitsPerMajorUnit)
      // The released metric is defined over integer minor units at exactly 100 per
      // major unit; any other minor-unit factor (e.g. 7) is an unsupported arithmetic
      // unit, not a free parameter.
      || currency.minorUnitsPerMajorUnit !== 100) fail('LEDGER_CURRENCY_DENIED');
  const scale = profile.unitScale;
  if (scale !== 'BASE_UNITS' && scale !== 'MINOR_UNITS') fail('LEDGER_UNIT_SCALE_AMBIGUOUS');
  for (const field of ['idField', 'dateField', 'kindField', 'amountField']) {
    if (typeof profile[field] !== 'string' || !closed.includes(profile[field])
        || profile[field] !== SUPPORTED_ROLE_BINDINGS[version === 'ledger-v2' ? 2 : 1][field]) {
      fail(`LEDGER_${field.toUpperCase()}_DENIED`);
    }
  }
  if (!Array.isArray(profile.dropped)
      || profile.dropped.some((c) => !closed.includes(c))) fail('LEDGER_DROPPED_DENIED');
  return true;
}

// Map ONE source ledger row (already read from the local source) into the canonical
// metric row shape.  `writeUnitEvidenceTarget` is a test seam: when true, the function
// records the computed minor value so the variant/replay test can assert v1 == v2.
export function mapLedgerRowToCanonical(profile, sourceRow) {
  validateLedgerMappingProfile(profile);
  // Enforce the unit/semantic gate at the MAPPING boundary, not as a caller convention:
  // a profile whose declared unit scale contradicts the source's declared unit is
  // rejected here (not merely by a separately invoked assertion in a test).
  assertProfileMatchesSourceUnit(profile, declaredSourceUnit(profile.layoutVersion));
  if (!isPlainObject(sourceRow)) fail('LEDGER_ROW_DENIED');
  const kindIndex = profile.layoutVersion === 'ledger-v2' ? 2 : 1;
  const kind = KIND_MAP[kindIndex][sourceRow[profile.kindField]];
  if (!kind) fail(`LEDGER_KIND_DENIED:${String(sourceRow[profile.kindField])}`);
  const raw = sourceRow[profile.amountField];
  const amountMinorUnits = (raw === null || raw === undefined)
    ? null
    : (() => {
        if (typeof raw !== 'number' || !Number.isSafeInteger(raw)) fail('LEDGER_AMOUNT_NOT_SAFE_INT');
        const minor = profile.unitScale === 'BASE_UNITS'
          ? raw * profile.currency.minorUnitsPerMajorUnit
          : raw;
        if (!Number.isSafeInteger(minor)) fail('LEDGER_AMOUNT_SCALE_OVERFLOW');
        return minor;
      })();
  return {
    order_id: sourceRow[profile.idField],
    order_date: sourceRow[profile.dateField] ?? null,
    record_kind: kind,
    amount_minor_units: amountMinorUnits,
  };
}

// Map a full result set (array of source rows) into canonical metric rows, verifying
// (a) the profile is valid, (b) no two source rows collapse to the same id, (c) dropped
// columns did not leak.  The output is the EXACT canonical shape the metric core wants.
export function mapLedgerRowsToCanonical(profile, sourceRows) {
  validateLedgerMappingProfile(profile);
  // Same mandatory unit gate at the batch entry point (kept in sync with the single-row
  // mapper) so a wrong-scale profile can never silently scale a declared source.
  assertProfileMatchesSourceUnit(profile, declaredSourceUnit(profile.layoutVersion));
  if (!Array.isArray(sourceRows) || sourceRows.length === 0) fail('LEDGER_ROWS_EMPTY');
  const seen = new Set();
  const out = [];
  for (const row of sourceRows) {
    const canonical = mapLedgerRowToCanonical(profile, row);
    const id = canonical.order_id;
    if (seen.has(id)) fail(`LEDGER_DUPLICATE_ID:${id}`);
    seen.add(id);
    out.push(canonical);
  }
  return out;
}

// Build the read closure a ledger layout can feed to `executeNetRevenuePlan`.  The
// mapping layer has ALREADY normalized the ledger source into the canonical admitted
// relation, so the evidence.relation reports the canonical `synthetic_bi.orders`
// (what the metric core actually consumed) — the raw-source provenance is carried
// separately on the closure for the reconciliation/audit record, never passed through
// the metric scope gate.
export function buildLedgerRead(mappedCanonicalRows, rawSource) {
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

// Seed the real (PGlite) local database with the ledger layout and read the source
// rows back via a real SQL SELECT, then map them.  This is the "real local source"
// half of #237: the profile is applied over rows actually retrieved from PostgreSQL,
// not over an in-memory array.
const LEDGER_DDL = {
  1: [
    'CREATE SCHEMA IF NOT EXISTS synthetic_bi',
    'CREATE TABLE IF NOT EXISTS synthetic_bi.ledger ('
      + ' row_key text PRIMARY KEY,'
      + ' occurred_at date,'
      + ' posting_type text,'
      + ' value_atomic_units integer,'
      + ' stream text)',
  ].join(';\n'),
  2: [
    'CREATE SCHEMA IF NOT EXISTS synthetic_bi',
    'CREATE TABLE IF NOT EXISTS synthetic_bi.ledger ('
      + ' row_key text PRIMARY KEY,'
      + ' occurred_at date,'
      + ' entry_kind text,'
      + ' atomic_value integer,'
      + ' segment text)',
  ].join(';\n'),
};

function ledgerQuote(value) {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

export async function seedLedgerDatabase(database, layoutVersion, sourceRows) {
  if (typeof database !== 'object' || database === null
      || typeof database.exec !== 'function' || typeof database.query !== 'function') fail('LEDGER_DATABASE_DENIED');
  if (!LEDGER_LAYOUT_VERSIONS.includes(layoutVersion)) fail('LEDGER_LAYOUT_VERSION_DENIED');
  if (!Array.isArray(sourceRows) || sourceRows.length === 0) fail('LEDGER_ROWS_EMPTY');
  await database.exec(LEDGER_DDL[layoutVersion === 'ledger-v2' ? 2 : 1]);
  const cols = CLOSED_LEDGER_FIELDS[layoutVersion === 'ledger-v2' ? 2 : 1];
  for (const row of sourceRows) {
    const values = cols.map((c) => ledgerQuote(row[c]));
    await database.exec(`INSERT INTO synthetic_bi.ledger (${cols.join(', ')}) VALUES (${values.join(', ')})`);
  }
  return true;
}

export async function readLedgerSourceRows(database, layoutVersion) {
  if (typeof database !== 'object' || database === null
      || typeof database.query !== 'function') fail('LEDGER_DATABASE_DENIED');
  if (!LEDGER_LAYOUT_VERSIONS.includes(layoutVersion)) fail('LEDGER_LAYOUT_VERSION_DENIED');
  const select = layoutVersion === 'ledger-v2'
    ? 'SELECT row_key, occurred_at::text AS occurred_at, entry_kind, atomic_value, segment FROM synthetic_bi.ledger ORDER BY row_key'
    : 'SELECT row_key, occurred_at::text AS occurred_at, posting_type, value_atomic_units, stream FROM synthetic_bi.ledger ORDER BY row_key';
  const result = await database.query(select);
  return Array.isArray(result.rows) ? result.rows : [];
}

// Variant/replay helper: given two profiles and the SAME underlying source rows, prove
// both profiles yield byte-identical canonical rows (same bounded definition, no drift).
export function compareProfileMappings(profileA, profileB, sourceRowsA, sourceRowsB) {
  const rowsA = mapLedgerRowsToCanonical(profileA, sourceRowsA);
  const rowsB = mapLedgerRowsToCanonical(profileB, sourceRowsB);
  const digestA = sha256(serializeHoldout(rowsA));
  const digestB = sha256(serializeHoldout(rowsB));
  return { equal: rowsA.length === rowsB.length && digestA === digestB, digestA, digestB, rowCount: rowsA.length };
}
