// KaleidoSphere KS246 (KS-EVO-01-AC03/AC04) — the caller-confirmed unfamiliar-schema
// proposal reaches the EXISTING metric/mapping compiler and an ACTUAL local synthetic
// database execution.
//
// The accepted AC01/AC02 slice (unfamiliar-schema-proposal.mjs) produced a reviewable
// candidate and a handoff that named the released entry point.  That was deliberately
// LOCAL SUPPORT ONLY: `metricExecution: NOT_PERFORMED`.  This module closes the LOCAL
// composition gap without touching the reviewed proposal surface:
//
//   * it reuses `buildMetricHandoff` (AC03) as the binding authority, so an EOF /
//     unconfirmed / inconsistent / non-released-unit proposal is denied by the reviewed
//     code, never by a second validator;
//   * it reuses the ONE admitted metric core — `compileNetRevenuePlan` /
//     `executeNetRevenuePlan` / `verifyNetRevenueExecutionReceipt` (#150 C2) — and the
//     released byte-bound holdout serializer; no second engine, no second metric and no
//     re-declared arithmetic;
//   * it reuses the established mapping-profile shape of #237: a FROZEN, versioned
//     source-layout profile resolves the unfamiliar layout into the canonical
//     {order_id, order_date, record_kind, amount_minor_units} rows, and the profile is
//     admitted only when it AGREES with the caller's confirmed decisions;
//   * it reuses the established local database seam of #236/#238: an INJECTED
//     `database` (a real in-process PGlite in a clean-room, or a clearly-labelled
//     synthetic adapter in the canonical graph) is seeded with the unfamiliar source
//     rows and read back through one confined SELECT, exactly as the released journeys do.
//
// WHAT IS GENUINELY NEW HERE, AND WHAT IT IS NOT
//   - New: the frozen unfamiliar layout profile, the caller-decision binding gate, the
//     unknown/residual record-kind decision gate, and the orchestration that seeds the
//     unfamiliar relation, reads it back, maps it and executes the released metric.
//   - Not new: the metric, the mapping admission vocabulary, the SQL confinement, the
//     serializer, the PGlite adapter and the receipt shape.
//
// NONCLAIMS (structural, not decoration)
//   - The released metric core is byte-bound to the ADMITTED synthetic holdout, so the
//     only executable source in scope is an authored synthetic source that maps to that
//     admitted holdout byte-for-byte.  This module STATES that confinement; it does not
//     widen it, and it never claims the discovery aggregate counts came from a database.
//   - Residual record-kind values are NEVER inferred to be sales.  Every value the
//     reviewed handoff leaves explicitly unresolved must be decided by the caller in an
//     authored decision input, or the journey DENIES.
//   - A local synthetic execution proves the local composition only.  It grants no
//     production, admission, publication or mutation authority, and the separately owned
//     PAN452 shared task handle stays NOT integrated (`sharedTaskHandle: 'NOT_INTEGRATED'`).

import { createHash } from 'node:crypto';

import { canonicalJson } from '../canonical-json.js';
import { serializeHoldout } from '../db-analyzer/postgresql-safe-analysis.mjs';
import { buildMetricHandoff } from './unfamiliar-schema-proposal.mjs';
import {
  ADMITTED_HOLDOUT_SHA256,
  compileNetRevenuePlan,
  createNetRevenueOperationRequest,
  executeNetRevenuePlan,
  verifyNetRevenueExecutionReceipt,
} from './net-revenue-plan.mjs';

export const UNFAMILIAR_METRIC_JOURNEY_SCHEMA =
  'kaleidosphere.business-bi/unfamiliar-metric-journey/v1';
export const UNFAMILIAR_SOURCE_SCHEMA =
  'kaleidosphere.business-bi/unfamiliar-schema-source-rows/v1';
export const UNFAMILIAR_KIND_DECISIONS_SCHEMA =
  'kaleidosphere.business-bi/unfamiliar-kind-decisions/v1';

export const UNFAMILIAR_SOURCE_ACCESS_MODE = 'BOUNDED_READ_ONLY';
const SYNTHETIC_CLASSIFICATION = 'SYNTHETIC_NON_CUSTOMER_BYTES';

// The released adapter is transport-neutral: a real in-process PGlite and the labelled
// synthetic adapter expose exactly this narrow read-only surface.
export const UNFAMILIAR_SESSION_MODES = Object.freeze(['REAL_POSTGRESQL', 'SYNTHETIC_FALLBACK']);

// The released metric core is byte-bound to the admitted synthetic holdout.  The
// independently specified expected numeric result for the executable source is the
// admitted oracle's exact integer-cent result; it is pinned HERE so the journey checks
// the actual database execution against a value that does not come from the adapter.
export const UNFAMILIAR_JOURNEY_EXPECTED = Object.freeze({
  currentNetMinorUnits: 100059,
  comparisonNetMinorUnits: 30000,
  deltaMinorUnits: 70059,
});

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const fail = (code) => { const error = new Error(code); error.code = code; throw error; };
const isCalendarDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
};

function exactKeys(value, allowed, required, code) {
  if (!isPlainObject(value)) fail(code);
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.includes(key))
      || (required ?? allowed).some((key) => !keys.includes(key))) fail(code);
  return value;
}

function bytesOf(value, code) {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  fail(code);
}

function parseBoundJson(bytesOrObject, code) {
  if (isPlainObject(bytesOrObject)) return bytesOrObject;
  try { return JSON.parse(bytesOf(bytesOrObject, code).toString('utf8')); } catch { fail(`${code}:JSON`); }
}

// ---------------------------------------------------------------------------------
// The FROZEN unfamiliar layout profile (#237 shape, applied to the KS246 layout).
//
// The layout is a DECLARATION, not a discovery: it is versioned, names every role and
// every non-role column explicitly, and is admitted only when it AGREES with the
// caller's confirmed decisions.  A profile that binds a field the caller never
// confirmed, leaves a date-like column unclassified, or forwards a non-role column is
// denied by name rather than silently honoured.
// ---------------------------------------------------------------------------------
export const UNFAMILIAR_LAYOUT_PROFILE = Object.freeze({
  profileId: 'unfamiliar-pay-feed-layout-v1',
  relation: 'synth_x.pay_feed',
  idField: 'pf_id',
  dateField: 'val_dt',
  kindField: 'ev_typ',
  amountField: 'amt_a',
  currencyField: 'ccy',
  unitScale: 'MINOR_UNITS',
  // Columns a correct profile must NOT forward into the metric: the sibling amount-like
  // integer column, the second date-like column and the free-text columns.
  nonRoleColumns: Object.freeze(['amt_b', 'bk_ts', 'note']),
  // Date-like columns other than the confirmed ORDER_DATE role are NON-ROLES: their
  // presence must be explicitly classified, never silently ignored.
  excludedDateLikeColumns: Object.freeze(['bk_ts']),
  droppedOnRead: Object.freeze(['amt_b', 'bk_ts', 'note']),
});

// ---------------------------------------------------------------------------------
// Bounded source load.  This surface is a READ-ONLY synthetic source: carrying the
// authored row material is its declared purpose, and it is denied if it carries SQL
// text, credentials, executable payload, a non-synthetic classification or a write
// access mode.  Bounded read-only access is where executable authority is separated out.
// ---------------------------------------------------------------------------------
const DENIED_SOURCE_KEYS = Object.freeze({
  sql: 'KS246_SOURCE_DENIED:SQL_AUTHORITY',
  statements: 'KS246_SOURCE_DENIED:SQL_AUTHORITY',
  query: 'KS246_SOURCE_DENIED:SQL_AUTHORITY',
  credentials: 'KS246_SOURCE_DENIED:CREDENTIALS',
  dsn: 'KS246_SOURCE_DENIED:CREDENTIALS',
  password: 'KS246_SOURCE_DENIED:CREDENTIALS',
  script: 'KS246_SOURCE_DENIED:EXECUTABLE_PAYLOAD',
  evaluate: 'KS246_SOURCE_DENIED:EXECUTABLE_PAYLOAD',
});

export function loadUnfamiliarSource(bytesOrObject) {
  const code = 'KS246_SOURCE_DENIED';
  const raw = parseBoundJson(bytesOrObject, code);
  for (const key of Object.keys(raw)) {
    if (Object.hasOwn(DENIED_SOURCE_KEYS, key)) fail(DENIED_SOURCE_KEYS[key]);
  }
  exactKeys(raw, [
    'schemaVersion', 'classification', 'issue', 'sourceRevision', 'relation', 'accessMode',
    'identifierNamespace', 'provenance', 'columnDisclosure', 'columns', 'rows',
  ], [
    'schemaVersion', 'classification', 'issue', 'sourceRevision', 'relation', 'accessMode',
    'columns', 'rows',
  ], `${code}:SHAPE`);
  if (raw.schemaVersion !== UNFAMILIAR_SOURCE_SCHEMA) fail(`${code}:SCHEMA`);
  if (raw.classification !== SYNTHETIC_CLASSIFICATION) fail(`${code}:CLASSIFICATION`);
  if (raw.accessMode !== UNFAMILIAR_SOURCE_ACCESS_MODE) fail(`${code}:ACCESS_MODE`);
  if (typeof raw.sourceRevision !== 'string' || raw.sourceRevision.length === 0) fail(`${code}:REVISION`);
  if (typeof raw.relation !== 'string' || raw.relation.length === 0) fail(`${code}:RELATION`);
  if (!Array.isArray(raw.columns) || raw.columns.length === 0) fail(`${code}:COLUMNS`);
  if (!Array.isArray(raw.rows) || raw.rows.length === 0) fail(`${code}:ROWS`);

  const columns = raw.columns.map((column) => {
    exactKeys(column, ['name', 'dataType', 'nullable', 'declaredMeaning'],
      ['name', 'dataType', 'nullable'], `${code}:COLUMN`);
    if (typeof column.name !== 'string' || typeof column.dataType !== 'string'
        || typeof column.nullable !== 'boolean') fail(`${code}:COLUMN`);
    return {
      name: column.name,
      dataType: column.dataType,
      nullable: column.nullable,
      declaredMeaning: column.declaredMeaning ?? null,
    };
  });
  if (new Set(columns.map(({ name }) => name)).size !== columns.length) fail(`${code}:DUPLICATE_COLUMN`);

  const rows = raw.rows.map((row) => {
    if (!isPlainObject(row)) fail(`${code}:ROW`);
    const names = Object.keys(row);
    if (names.some((name) => !columns.some((column) => column.name === name))) fail(`${code}:ROW_COLUMN`);
    return { ...row };
  });

  const body = {
    schemaVersion: UNFAMILIAR_SOURCE_SCHEMA,
    classification: SYNTHETIC_CLASSIFICATION,
    issue: raw.issue,
    sourceRevision: raw.sourceRevision,
    relation: raw.relation,
    accessMode: UNFAMILIAR_SOURCE_ACCESS_MODE,
    identifierNamespace: raw.identifierNamespace ?? null,
    provenance: raw.provenance ?? null,
    columnDisclosure: raw.columnDisclosure ?? null,
    columns,
    rows,
  };
  const byteSha = isPlainObject(bytesOrObject)
    ? sha256(Buffer.from(canonicalJson(body), 'utf8'))
    : sha256(bytesOf(bytesOrObject, code));
  return Object.freeze({ ...body, sourceContentSha256: sha256(canonicalJson(body)), sourceByteSha256: byteSha });
}

// ---------------------------------------------------------------------------------
// The caller's decision input for the record-kind values the reviewed handoff leaves
// explicitly UNRESOLVED.  It is an authored declaration: every value is a declared
// test/caller input, never a human-participation record.
// ---------------------------------------------------------------------------------
export function loadKindDecisions(bytesOrObject) {
  const code = 'KS246_KIND_DECISIONS_DENIED';
  const raw = parseBoundJson(bytesOrObject, code);
  exactKeys(raw, ['schemaVersion', 'issue', 'sourceRevision', 'decisions', 'authoredInput'],
    ['schemaVersion', 'issue', 'sourceRevision', 'decisions'], `${code}:SHAPE`);
  if (raw.schemaVersion !== UNFAMILIAR_KIND_DECISIONS_SCHEMA) fail(`${code}:SCHEMA`);
  if (typeof raw.sourceRevision !== 'string' || raw.sourceRevision.length === 0) fail(`${code}:REVISION`);
  if (!isPlainObject(raw.decisions) || Object.keys(raw.decisions).length === 0) fail(`${code}:DECISIONS`);
  for (const [value, kind] of Object.entries(raw.decisions)) {
    if (value.length === 0 || typeof kind !== 'string' || kind.length === 0) fail(`${code}:DECISIONS`);
  }
  const body = {
    schemaVersion: UNFAMILIAR_KIND_DECISIONS_SCHEMA,
    issue: raw.issue,
    sourceRevision: raw.sourceRevision,
    decisions: Object.fromEntries(Object.entries(raw.decisions).sort(([l], [r]) => l.localeCompare(r))),
    authoredInput: raw.authoredInput === true,
  };
  return Object.freeze({ ...body, decisionsSha256: sha256(canonicalJson(body)) });
}

// ---------------------------------------------------------------------------------
// AC03/AC04 binding.  Every gate below is a refusal BY NAME, and each refusal is owed a
// negative in the focused suite.
// ---------------------------------------------------------------------------------
function assertDatabaseShape(database) {
  if (!isPlainObject(database)
      || typeof database.exec !== 'function'
      || typeof database.query !== 'function') fail('KS246_JOURNEY_DENIED:DATABASE');
}

function confirmedRoleSource(handoff, role) {
  const source = handoff.canonicalRowBinding?.[role]?.source;
  if (typeof source !== 'string' || source.lastIndexOf('.') <= 0) {
    fail(`KS246_JOURNEY_DENIED:CONFIRMED_ROLE_MISSING:${role}`);
  }
  return {
    relation: source.slice(0, source.lastIndexOf('.')),
    column: source.slice(source.lastIndexOf('.') + 1),
  };
}

export function bindUnfamiliarMetricJourney({
  proposal, source, kindDecisions, metricContractBytes, sourceRevision,
}) {
  if (typeof sourceRevision !== 'string' || sourceRevision.length === 0) {
    fail('KS246_JOURNEY_DENIED:MISSING_SOURCE_REVISION_BINDING');
  }

  // (1) The reviewed AC03 handoff is the binding authority.  An EOF / unconfirmed /
  // inconsistent / non-released-unit / non-released-currency / contradicted-kind
  // proposal is denied HERE with the reviewed code, never by a parallel validator.
  const handoff = buildMetricHandoff({ proposal, metricContractBytes });

  // (2) Source revision binding.  The caller asserts WHICH source revision the supplied
  // bytes are; a stale assertion (for example the discovery revision the proposal was
  // loaded against) is refused instead of being silently re-labelled.
  if (sourceRevision !== source.sourceRevision) fail('KS246_JOURNEY_DENIED:SOURCE_REVISION_STALE');

  // (3) Layout admission against the CALLER's confirmed decisions.
  const profile = UNFAMILIAR_LAYOUT_PROFILE;
  const idRole = confirmedRoleSource(handoff, 'idField');
  const dateRole = confirmedRoleSource(handoff, 'dateField');
  const kindRole = confirmedRoleSource(handoff, 'kindField');
  const amountRole = confirmedRoleSource(handoff, 'amountField');
  if (profile.relation !== source.relation
      || [idRole, dateRole, kindRole, amountRole].some(({ relation }) => relation !== profile.relation)) {
    fail('KS246_JOURNEY_DENIED:SOURCE_RELATION_NOT_CONFIRMED');
  }
  for (const [role, declared, confirmed] of [
    ['idField', profile.idField, idRole.column],
    ['dateField', profile.dateField, dateRole.column],
    ['kindField', profile.kindField, kindRole.column],
    ['amountField', profile.amountField, amountRole.column],
  ]) {
    if (declared !== confirmed) fail(`KS246_JOURNEY_DENIED:ROLE_BINDING_NOT_CONFIRMED:${role}`);
  }

  // (4) The released arithmetic unit and currency.  A caller may legitimately answer
  // otherwise (that is a recorded decision), but such a decision is not an admissible
  // handoff and is refused by name.
  const confirmedCurrency = handoff.canonicalRowBinding.amountField.currency;
  if (profile.unitScale !== handoff.canonicalRowBinding.amountField.unitScale
      || profile.unitScale !== 'MINOR_UNITS') {
    fail('KS246_JOURNEY_DENIED:UNSUPPORTED_UNIT_SCALE');
  }
  if (confirmedCurrency !== 'EUR') fail('KS246_JOURNEY_DENIED:UNSUPPORTED_CURRENCY');

  // (5) The source must be an exact, closed instance of the declared layout: every
  // declared column is either a named role column or an explicitly classified non-role
  // column, and every date-like column that is NOT the confirmed ORDER_DATE role is
  // explicitly classified as a non-role.  An unclassified or ambiguous column is denied.
  const declaredColumns = source.columns.map(({ name }) => name);
  const roleColumns = [profile.idField, profile.dateField, profile.kindField,
    profile.amountField, profile.currencyField];
  for (const roleColumn of roleColumns) {
    if (!declaredColumns.includes(roleColumn)) {
      fail(`KS246_JOURNEY_DENIED:ROLE_COLUMN_NOT_IN_SOURCE:${roleColumn}`);
    }
  }
  const expectedNonRole = declaredColumns.filter((name) => !roleColumns.includes(name)).sort();
  if (canonicalJson(expectedNonRole) !== canonicalJson([...profile.nonRoleColumns].sort())) {
    fail('KS246_JOURNEY_DENIED:UNCLASSIFIED_SOURCE_COLUMN');
  }
  const dateLike = source.columns
    .filter(({ dataType }) => dataType === 'date' || dataType === 'timestamp')
    .map(({ name }) => name)
    .filter((name) => name !== profile.dateField)
    .sort();
  if (canonicalJson(dateLike) !== canonicalJson([...profile.excludedDateLikeColumns].sort())) {
    fail('KS246_JOURNEY_DENIED:AMBIGUOUS_DATE_ROLE');
  }

  // (6) Record-kind decisions.  The reviewed handoff leaves residual values explicitly
  // unresolved and NEVER infers them as sales.  Every observed kind value must be decided
  // by the caller, the decision must use the RELEASED vocabulary, and it must agree with
  // the caller's own confirmed credit/cancel values.
  if (kindDecisions.sourceRevision !== source.sourceRevision) {
    fail('KS246_JOURNEY_DENIED:SOURCE_REVISION_STALE');
  }
  const decisions = kindDecisions.decisions;
  const observedValues = [...new Set(source.rows.map((row) => row[profile.kindField]))].sort();
  for (const value of observedValues) {
    if (typeof value !== 'string' || value.length === 0) fail('KS246_JOURNEY_DENIED:SOURCE_KIND_DENIED');
    if (!Object.hasOwn(decisions, value)) fail(`KS246_JOURNEY_DENIED:MISSING_KIND_DECISION:${value}`);
  }
  for (const value of Object.keys(decisions)) {
    if (!observedValues.includes(value)) fail(`KS246_JOURNEY_DENIED:UNKNOWN_KIND_VALUE:${value}`);
    if (!handoff.releasedKindVocabulary.includes(decisions[value])) {
      fail(`KS246_JOURNEY_DENIED:UNSUPPORTED_KIND:${decisions[value]}`);
    }
  }
  const confirmedMapping = handoff.canonicalRowBinding.kindField.confirmedMapping;
  for (const releasedKind of ['credit', 'cancel']) {
    const confirmedValue = Object.keys(confirmedMapping)
      .find((value) => confirmedMapping[value] === releasedKind);
    const decidedValues = Object.keys(decisions)
      .filter((value) => decisions[value] === releasedKind).sort();
    if (canonicalJson(decidedValues) !== canonicalJson([confirmedValue])) {
      fail(`KS246_JOURNEY_DENIED:KIND_DECISION_CONFLICT:${releasedKind}`);
    }
  }
  const residualKindValues = Object.keys(decisions)
    .filter((value) => decisions[value] !== 'credit' && decisions[value] !== 'cancel').sort();

  // (7) The executable source must be coherent with the released core's byte-bound
  // admitted holdout.  This STATES the confinement instead of quietly widening it.
  const mapping = { profile, decisions, currency: confirmedCurrency };
  const canonicalRows = mapUnfamiliarRowsToCanonical(
    mapping,
    source.rows.map((row) => projectUnfamiliarSourceRow(profile, row)),
  );
  const canonicalHoldoutSha256 = sha256(serializeHoldout(canonicalRows));
  if (canonicalHoldoutSha256 !== ADMITTED_HOLDOUT_SHA256) {
    fail('KS246_JOURNEY_DENIED:SOURCE_NOT_COHERENT_WITH_RELEASED_HOLDOUT');
  }

  const body = {
    schemaVersion: UNFAMILIAR_METRIC_JOURNEY_SCHEMA,
    observationKind: 'CONFIRMED',
    profileId: profile.profileId,
    relation: profile.relation,
    sourceRevision: source.sourceRevision,
    sourceSha256: source.sourceByteSha256,
    proposalDiscoveryRevision: proposal.source.sourceRevision,
    revisionBinding: {
      executableSourceRevision: source.sourceRevision,
      proposalDiscoveryRevision: proposal.source.sourceRevision,
      discoveryAggregateRowCount: 12,
      executableSourceRowCount: source.rows.length,
      countProvenance: 'DISCOVERY_AGGREGATE_IS_AN_AUTHORED_BOUNDED_OBSERVATION_NEVER_A_DATABASE_READ',
    },
    proposalSha256: proposal.entryPointSha256 ?? proposal.proposalSha256,
    candidateSha256: proposal.metricCandidate.candidateSha256,
    clarificationSha256: proposal.clarification.clarificationSha256,
    handoffSha256: handoff.handoffSha256,
    releasedContractSha256: handoff.releasedContractSha256,
    releasedRoleVocabulary: handoff.releasedRoleVocabulary,
    releasedKindVocabulary: handoff.releasedKindVocabulary,
    confirmedMapping,
    residualKindValues,
    decisionsSha256: kindDecisions.decisionsSha256,
    kindMapping: Object.fromEntries(Object.entries(decisions).sort(([l], [r]) => l.localeCompare(r))),
    roleBinding: {
      idField: profile.idField,
      dateField: profile.dateField,
      kindField: profile.kindField,
      amountField: profile.amountField,
      currencyField: profile.currencyField,
      currency: confirmedCurrency,
      unitScale: profile.unitScale,
      nonRoleColumns: [...profile.nonRoleColumns].sort(),
      droppedOnRead: [...profile.droppedOnRead].sort(),
    },
    canonicalHoldoutSha256,
    canonicalRowCount: canonicalRows.length,
    authority: {
      executionAuthority: 'LOCAL_SYNTHETIC_READ_ONLY',
      admissionAuthority: 'NONE',
      mutationAuthority: 'NONE',
      publicWrites: false,
      arbitrarySql: false,
      admissionConsumer: 'NOT_IMPLEMENTED',
      // The PAN452 common task contract is separately Qwen-owned and NOT accepted; this
      // local composition neither designs nor stubs its handles.
      sharedTaskHandle: 'NOT_INTEGRATED',
      humanComprehension: false,
    },
  };
  return Object.freeze({
    ...body,
    handoff,
    mapping,
    canonicalRows,
    bindingSha256: sha256(canonicalJson(body)),
  });
}

// Project an authored source row onto exactly the role columns the confined read selects,
// so the same mapper serves both the database read boundary and the bind-time coherence
// check.  Non-role columns are dropped, never forwarded.
export function projectUnfamiliarSourceRow(profile, row) {
  if (!isPlainObject(row)) fail('KS246_JOURNEY_DENIED:SOURCE_ROW');
  return {
    [profile.idField]: row[profile.idField] ?? null,
    [profile.dateField]: row[profile.dateField] ?? null,
    [profile.kindField]: row[profile.kindField] ?? null,
    [profile.amountField]: row[profile.amountField] ?? null,
    [profile.currencyField]: row[profile.currencyField] ?? null,
  };
}

// ---------------------------------------------------------------------------------
// The mapping itself.  Canonical rows are built EXPLICITLY from the role columns, so a
// non-role column can never leak into the metric: it is never selected or forwarded.
// ---------------------------------------------------------------------------------
export function mapUnfamiliarRowToCanonical(mapping, sourceRow) {
  const { profile } = mapping;
  if (!isPlainObject(sourceRow)) fail('KS246_JOURNEY_DENIED:SOURCE_ROW');
  exactKeys(sourceRow, [profile.idField, profile.dateField, profile.kindField,
    profile.amountField, profile.currencyField], undefined, 'KS246_JOURNEY_DENIED:SOURCE_ROW');
  const id = sourceRow[profile.idField];
  if (typeof id !== 'string' || !/^s-\d{3,}$/.test(id)) {
    fail('KS246_JOURNEY_DENIED:SOURCE_ID_NOT_IN_SYNTHETIC_NAMESPACE');
  }
  const kindValue = sourceRow[profile.kindField];
  if (!Object.hasOwn(mapping.decisions, kindValue)) {
    fail(`KS246_JOURNEY_DENIED:MISSING_KIND_DECISION:${String(kindValue)}`);
  }
  const date = sourceRow[profile.dateField] ?? null;
  if (date !== null && !isCalendarDate(date)) fail('KS246_JOURNEY_DENIED:SOURCE_DATE_DENIED');
  const amount = sourceRow[profile.amountField] ?? null;
  if (amount !== null && (!Number.isSafeInteger(amount) || Object.is(amount, -0))) {
    fail('KS246_JOURNEY_DENIED:AMOUNT_NOT_SAFE_INT');
  }
  if (sourceRow[profile.currencyField] !== mapping.currency) {
    fail('KS246_JOURNEY_DENIED:SOURCE_CURRENCY_UNSUPPORTED');
  }
  return {
    order_id: id,
    order_date: date,
    record_kind: mapping.decisions[kindValue],
    amount_minor_units: amount,
  };
}

export function mapUnfamiliarRowsToCanonical(mapping, sourceRows) {
  if (!Array.isArray(sourceRows) || sourceRows.length === 0) {
    fail('KS246_JOURNEY_DENIED:SOURCE_ROWS_EMPTY');
  }
  const seen = new Set();
  const out = [];
  for (const row of sourceRows) {
    const canonical = mapUnfamiliarRowToCanonical(mapping, row);
    if (seen.has(canonical.order_id)) fail(`KS246_JOURNEY_DENIED:DUPLICATE_SOURCE_ID:${canonical.order_id}`);
    seen.add(canonical.order_id);
    out.push(canonical);
  }
  return out;
}

// ---------------------------------------------------------------------------------
// The local database seam (#236/#238 shape).  A real in-process PGlite in a clean-room;
// the labelled synthetic adapter keeps the canonical `npm test` graph dependency-free.
// ---------------------------------------------------------------------------------
export function buildUnfamiliarSyntheticDatabase(rows) {
  let store = (Array.isArray(rows) ? rows : []).map((row) => ({ ...row }));
  let readOnly = false;
  return {
    __mode: 'SYNTHETIC_FALLBACK',
    async exec(sql) {
      if (/SET\s+default_transaction_read_only/i.test(sql)) readOnly = /on/i.test(sql);
      return { rows: [] };
    },
    async query(sql) {
      if (/UPDATE\s+synth_x\.pay_feed/i.test(sql) && readOnly) {
        const error = new Error('read-only transaction');
        error.code = '25006';
        throw error;
      }
      if (/FROM synth_x\.pay_feed/i.test(sql)) return { rows: store.map((row) => ({ ...row })) };
      return { rows: [] };
    },
    async seedRows(next) { store = (Array.isArray(next) ? next : []).map((row) => ({ ...row })); },
    async close() { store = []; },
    mode() { return 'SYNTHETIC_FALLBACK'; },
  };
}

const UNFAMILIAR_DDL = Object.freeze([
  'CREATE SCHEMA IF NOT EXISTS synth_x',
  'CREATE TABLE IF NOT EXISTS synth_x.pay_feed ('
    + ' pf_id text PRIMARY KEY,'
    + ' val_dt date,'
    + ' ev_typ text,'
    + ' amt_a integer,'
    + ' amt_b integer,'
    + ' bk_ts timestamp,'
    + ' ccy text,'
    + ' note text)',
].join(';\n'));

const UNFAMILIAR_SELECT = 'SELECT pf_id, val_dt::text AS val_dt, ev_typ, amt_a, ccy'
  + ' FROM synth_x.pay_feed ORDER BY pf_id LIMIT $1';

// The confined SELECT is the ONLY read this surface issues, and it selects exactly the
// role columns: the non-role columns are dropped at the read boundary, so a
// too-generous profile cannot forward them.
export const UNFAMILIAR_SOURCE_SELECT = UNFAMILIAR_SELECT;

function sqlQuote(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

export async function seedUnfamiliarDatabase(database, source) {
  assertDatabaseShape(database);
  if (!isPlainObject(source) || !Array.isArray(source.rows) || source.rows.length === 0) {
    fail('KS246_JOURNEY_DENIED:SOURCE_ROWS_EMPTY');
  }
  const columns = source.columns.map(({ name }) => name);
  if (typeof database.seedRows === 'function') {
    await database.seedRows(source.rows.map((row) => ({ ...row })));
    return true;
  }
  await database.exec(UNFAMILIAR_DDL);
  for (const row of source.rows) {
    const values = columns.map((name) => sqlQuote(row[name] ?? null));
    await database.exec(
      `INSERT INTO synth_x.pay_feed (${columns.join(', ')}) VALUES (${values.join(', ')})`,
    );
  }
  return true;
}

export async function readUnfamiliarSourceRows(database) {
  assertDatabaseShape(database);
  const result = await database.query(UNFAMILIAR_SELECT, [100]);
  const rows = Array.isArray(result.rows) ? result.rows : [];
  return rows.map((row) => ({
    pf_id: row.pf_id,
    val_dt: row.val_dt ?? null,
    ev_typ: row.ev_typ,
    amt_a: row.amt_a ?? null,
    ccy: row.ccy,
  })).map((row) => projectUnfamiliarSourceRow(UNFAMILIAR_LAYOUT_PROFILE, row));
}

// The confined C2 read closure: read the unfamiliar relation back through the real (or
// labelled) local database, map it with the ADMITTED binding, and re-serialize to the
// released holdout bytes.  A database whose content no longer reproduces the bound
// source is DENIED as a receipt (fail-closed), never silently accepted.
export function buildUnfamiliarMetricRead({ binding, database, canonicalRelation }) {
  assertDatabaseShape(database);
  if (typeof canonicalRelation !== 'string' || canonicalRelation.length === 0) {
    fail('KS246_JOURNEY_DENIED:CANONICAL_RELATION');
  }
  const real = database.__mode === 'REAL_POSTGRESQL';
  const read = async ({ request }) => {
    const budget = request?.bounds?.rowBudget;
    if (real) await database.exec('BEGIN READ ONLY');
    let rows;
    try {
      rows = await readUnfamiliarSourceRows(database);
    } finally {
      if (real) await database.exec('COMMIT');
    }
    const deny = (reasonCode) => ({
      state: 'DENIED',
      reasonCode,
      bytes: null,
      evidence: {
        accessMode: 'READ_ONLY',
        mutationCount: 0,
        bounded: true,
        relation: canonicalRelation,
        rowsRead: Number.isSafeInteger(rows.length) ? rows.length : 0,
      },
    });
    if (rows.length === 0) return deny('KS246_SOURCE_ROWS_EMPTY');
    if (Number.isSafeInteger(budget) && rows.length > budget) return deny('KS246_SOURCE_ROW_BUDGET_DENIED');
    let canonical;
    try {
      canonical = mapUnfamiliarRowsToCanonical(binding.mapping, rows);
    } catch (error) {
      if (typeof error?.code === 'string' && error.code.startsWith('KS246_JOURNEY_DENIED:')) {
        return deny('KS246_SOURCE_ROW_DENIED');
      }
      throw error;
    }
    const bytes = serializeHoldout(canonical);
    if (sha256(bytes) !== binding.canonicalHoldoutSha256) return deny('KS246_SOURCE_TABLE_SUBSTITUTED');
    return {
      state: 'COMPLETE',
      reasonCode: null,
      bytes,
      evidence: {
        accessMode: 'READ_ONLY',
        mutationCount: 0,
        bounded: true,
        relation: canonicalRelation,
        rowsRead: rows.length,
      },
    };
  };
  read.__ks246UnfamiliarRead = true;
  return read;
}

export const UNFAMILIAR_JOURNEY_NONCLAIMS = Object.freeze([
  'No production, customer or real-source claim: only authored synthetic non-customer bytes are read.',
  'No arbitrary SQL: the read is one confined SELECT over the declared unfamiliar relation, and the journey accepts no SQL input.',
  'No second metric, currency, date role or mapping engine: the released core and its byte-bound holdout confinement are reused unchanged.',
  'No automatic runtime activation and no admission consumer: this executes one local synthetic example.',
  'No identifier invention: the reviewed proposal is the authority for every role, and a declaration that disagrees with the caller is refused.',
  'No full AC03/AC04 closure: the separately owned PAN452 common task handle stays NOT integrated, and AC05 stays parent-owned.',
]);

// ---------------------------------------------------------------------------------
// The single supported journey entry point.
// ---------------------------------------------------------------------------------
export async function runUnfamiliarMetricJourney(input) {
  exactKeys(input, [
    'proposal', 'sourceBytes', 'kindDecisionBytes', 'metricContractBytes', 'oracleBytes',
    'database', 'sourceRevision', 'authority', 'semanticGoal',
  ], [
    'proposal', 'sourceBytes', 'kindDecisionBytes', 'metricContractBytes', 'oracleBytes',
    'database', 'sourceRevision', 'authority',
  ], 'KS246_JOURNEY_DENIED:INPUT');

  // The released operation request IS the semantic goal.  A caller asking for any other
  // goal (gross margin, order intake, ...) is refused instead of being mapped onto the
  // one admitted metric.
  const operation = createNetRevenueOperationRequest();
  const releasedGoal = operation.aggregate.kind;
  const semanticGoal = input.semanticGoal ?? releasedGoal;
  if (semanticGoal !== releasedGoal) fail('KS246_JOURNEY_DENIED:INCOMPATIBLE_SEMANTIC_GOAL');

  // Missing authority is refused BEFORE any read or execution: a local synthetic
  // execution is an explicitly declared activity, never an implicit one.
  exactKeys(input.authority, ['localSyntheticReadOnly', 'mutationAuthority', 'publicWrites'],
    undefined, 'KS246_JOURNEY_DENIED:MISSING_AUTHORITY');
  if (input.authority.localSyntheticReadOnly !== true
      || input.authority.mutationAuthority !== false
      || input.authority.publicWrites !== false) {
    fail('KS246_JOURNEY_DENIED:MISSING_AUTHORITY');
  }
  assertDatabaseShape(input.database);

  const source = loadUnfamiliarSource(input.sourceBytes);
  const kindDecisions = loadKindDecisions(input.kindDecisionBytes);
  const binding = bindUnfamiliarMetricJourney({
    proposal: input.proposal,
    source,
    kindDecisions,
    metricContractBytes: input.metricContractBytes,
    sourceRevision: input.sourceRevision,
  });

  // The EXISTING metric compiler, unchanged: one closed operation request, the released
  // contract and the independently admitted oracle.
  const plan = compileNetRevenuePlan({
    request: createNetRevenueOperationRequest(),
    metricContractBytes: input.metricContractBytes,
    oracleBytes: input.oracleBytes,
  });

  await seedUnfamiliarDatabase(input.database, source);
  const read = buildUnfamiliarMetricRead({
    binding,
    database: input.database,
    canonicalRelation: plan.operation.source.relation,
  });
  const receipt = await executeNetRevenuePlan({
    plan,
    metricContractBytes: input.metricContractBytes,
    oracleBytes: input.oracleBytes,
    read,
  });
  verifyNetRevenueExecutionReceipt({
    plan, receipt, metricContractBytes: input.metricContractBytes, oracleBytes: input.oracleBytes,
  });

  const sourceMode = input.database.__mode === 'REAL_POSTGRESQL'
    ? 'REAL_POSTGRESQL' : 'SYNTHETIC_FALLBACK';
  const expected = UNFAMILIAR_JOURNEY_EXPECTED;
  const executed = receipt.execution.state === 'COMPLETE';
  const actual = executed
    ? {
      currentNetMinorUnits: receipt.result.periods.current.netMinorUnits,
      comparisonNetMinorUnits: receipt.result.periods.comparison.netMinorUnits,
      deltaMinorUnits: receipt.result.deltaMinorUnits,
    }
    : null;
  if (executed && canonicalJson(actual) !== canonicalJson(expected)) {
    fail('KS246_JOURNEY_DENIED:EXPECTED_RESULT_MISMATCH');
  }

  const body = {
    schemaVersion: UNFAMILIAR_METRIC_JOURNEY_SCHEMA,
    operationId: receipt.operationId,
    semanticGoal,
    sourceMode,
    executed,
    binding: {
      profileId: binding.profileId,
      relation: binding.relation,
      sourceRevision: binding.sourceRevision,
      sourceSha256: binding.sourceSha256,
      proposalDiscoveryRevision: binding.proposalDiscoveryRevision,
      revisionBinding: binding.revisionBinding,
      proposalSha256: binding.proposalSha256,
      candidateSha256: binding.candidateSha256,
      clarificationSha256: binding.clarificationSha256,
      handoffSha256: binding.handoffSha256,
      releasedContractSha256: binding.releasedContractSha256,
      decisionsSha256: binding.decisionsSha256,
      kindMapping: binding.kindMapping,
      canonicalHoldoutSha256: binding.canonicalHoldoutSha256,
      bindingSha256: binding.bindingSha256,
    },
    planSha256: plan.planSha256,
    receiptSha256: receipt.receiptSha256,
    resultSha256: receipt.resultSha256,
    result: receipt.result,
    acceptance: {
      executed,
      executionState: receipt.execution.state,
      denialReasonCode: executed ? null : receipt.execution.reasonCode,
      expectedResult: expected,
      actualResult: actual,
      reconcilesToIndependentExpectedResult:
        executed && canonicalJson(actual) === canonicalJson(expected),
      oracleEquality: receipt.oracleEquality,
      sourceMode,
    },
    authority: binding.authority,
    disclosures: [
      'The discovery aggregate counts (12 / 5 / 4 rows) are AUTHORED bounded observations of the discovery slice; they were never produced by this executable source fixture or by the local synthetic database.',
      `The executable source fixture declares its own revision ${binding.sourceRevision} with ${binding.revisionBinding.executableSourceRowCount} authored rows; the reviewed proposal was loaded against the discovery revision ${binding.proposalDiscoveryRevision}.`,
      'The executable source is authored to the admitted synthetic holdout semantics because the released metric core is byte-bound to that holdout; nothing here widens the released confinement.',
      'Residual record-kind values are decided by the caller in an authored decision input; the reviewed handoff left them explicitly unresolved and this module never infers them as sales.',
      'The identifier column is declared in the s-NNN synthetic identifier namespace; the discovery metadata integer declaration is preserved unchanged.',
    ],
    nonclaims: [...UNFAMILIAR_JOURNEY_NONCLAIMS],
  };
  return Object.freeze({ ...body, journeySha256: sha256(canonicalJson(body)) });
}
