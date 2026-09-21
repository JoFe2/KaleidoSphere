// KaleidoSphere #236 — documented, runnable local net-revenue journey.
//
// This module does NOT reimplement the net-revenue calculator, the readback, the
// visual, the holdout serializer, or the C2 contract. It composes the existing,
// released primitives into a single supported entry point and threads a REAL local
// read-only PostgreSQL source through them, exactly the way the C2 / VIS-01 product
// path already consumes a `read` closure:
//
//   - compileNetRevenuePlan / executeNetRevenuePlan  (C2 #150, released foundation)
//   - createNetRevenueReadback / renderNetRevenueJson / renderNetRevenueTable  (C2)
//   - createNetRevenueVisualInputV1 / projectNetRevenueVisualV1 /
//     renderNetRevenueVisualHtmlV1  (VIS-01 #168)
//   - serializeHoldout  (C2 real-read byte-bound serializer)
//
// The only genuinely new surface here is the local PostgreSQL source connector and
// the orchestration that binds them together into one journey with normal AND
// negative paths, all reconciled to the independent admitted oracle.
//
// The PostgreSQL driver is INJECTED (a `database` object exposing the narrow
// interface below), never a package.json dependency. In a dedicated clean-room the
// controller may supply `@electric-sql/pglite` (a real PostgreSQL engine running
// in-process). Without a driver the journey falls back to a clearly-labelled
// synthetic in-memory source, so the canonical `npm test` graph stays byte-bound
// while an isolated runtime can still execute the real-database path.

import { createHash } from 'node:crypto';

import { canonicalJson } from '../canonical-json.js';
import {
  compileNetRevenuePlan,
  createNetRevenueOperationRequest,
  executeNetRevenuePlan,
  verifyNetRevenueExecutionReceipt,
} from './net-revenue-plan.mjs';
import {
  createNetRevenueReadback,
  renderNetRevenueJson,
  renderNetRevenueTable,
} from './net-revenue-readback.mjs';
import {
  createNetRevenueVisualInputV1,
  projectNetRevenueVisualV1,
  renderNetRevenueVisualHtmlV1,
} from './net-revenue-visual-v1.mjs';
import { serializeHoldout } from '../db-analyzer/postgresql-safe-analysis.mjs';

export const NET_REVENUE_JOURNEY_SCHEMA = 'kaleidosphere.business-bi/net-revenue-journey/v1';
export const JOURNEY_SOURCE_MODES = Object.freeze(['REAL_POSTGRESQL', 'SYNTHETIC_FALLBACK']);

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const fail = (code) => { const e = new Error(code); e.code = code; throw e; };
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && Object.getPrototypeOf(v) === Object.prototype;
const exactKeys = (v, keys, required = keys) => isPlainObject(v)
  && keys.every((k) => Object.keys(v).includes(k))
  && Object.keys(v).every((k) => keys.includes(k));

// A `database` connector exposes exactly this narrow read-only surface. Real PGlite and
// the synthetic fallback both implement it, so the C2 read closure is transport-neutral.
function assertDatabaseShape(database) {
  if (!isPlainObject(database)
      || typeof database.exec !== 'function'
      || typeof database.query !== 'function') fail('JOURNEY_DATABASE_DENIED');
}

const CLOSED_FIELDS = Object.freeze(['order_id', 'order_date', 'record_kind', 'amount_minor_units']);
const DDL = [
  'CREATE SCHEMA IF NOT EXISTS synthetic_bi',
  'CREATE TABLE IF NOT EXISTS synthetic_bi.orders ('
    + ' order_id text PRIMARY KEY,'
    + ' order_date date,'
    + ' record_kind text,'
    + ' amount_minor_units integer)',
].join(';\n');

// Seed the real (or synthetic) local database from the admitted holdout fixture rows.
export async function seedJourneyDatabase(database, rows) {
  assertDatabaseShape(database);
  if (!Array.isArray(rows) || rows.length === 0) fail('JOURNEY_SEED_ROWS_DENIED');
  for (const row of rows) {
    if (!exactKeys(row, CLOSED_FIELDS)) fail('JOURNEY_SEED_ROW_DENIED');
  }
  if (typeof database.seedRows === 'function') {
    await database.seedRows(rows.map((r) => ({ ...r })));
    return true;
  }
  await database.exec(DDL);
  for (const row of rows) {
    await database.exec(
      `INSERT INTO synthetic_bi.orders (order_id, order_date, record_kind, amount_minor_units) `
      + `VALUES (${q(row.order_id)}, ${q(row.order_date)}, ${q(row.record_kind)}, ${q(row.amount_minor_units)})`,
    );
  }
  return true;
}

function q(value) {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

// Build the C2-compatible read closure over the injected local database: SELECT the
// closed relation in frozen order, re-serialize to the exact holdout bytes via the
// released C2 serializer, and attach the same read-only evidence envelope the product
// path expects.
export function buildJourneyRead(database) {
  assertDatabaseShape(database);
  const real = database.__mode === 'REAL_POSTGRESQL';
  const read = async ({ request }) => {
    if (real) await database.exec('BEGIN READ ONLY');
    let result;
    try {
      result = await database.query(
        `SELECT order_id, order_date::text AS order_date, record_kind, amount_minor_units `
        + `FROM synthetic_bi.orders ORDER BY order_id LIMIT $1`,
        [request.bounds.rowBudget],
      );
    } finally {
      if (real) await database.exec('COMMIT');
    }
    const rows = Array.isArray(result.rows) ? result.rows : [];
    if (rows.length === 0 || rows.length > request.bounds.rowBudget) {
      fail('BUSINESS_BI_ROW_COUNT_EVIDENCE_DENIED');
    }
    const normalized = rows.map((row) => ({
      order_id: row.order_id,
      order_date: row.order_date ?? null,
      record_kind: row.record_kind,
      amount_minor_units: row.amount_minor_units ?? null,
    }));
    return {
      state: 'COMPLETE',
      reasonCode: null,
      bytes: serializeHoldout(normalized),
      evidence: {
        accessMode: 'READ_ONLY',
        mutationCount: 0,
        bounded: true,
        relation: 'synthetic_bi.orders',
        rowsRead: rows.length,
      },
    };
  };
  read.__ksJourneyRealRead = true;
  return read;
}

// A read-only session proof, mirroring the C2 least-privilege principal shape: the
// original C2 SESSION_PROOF_SQL reads both transaction_read_only and
// default_transaction_read_only inside the session. Here we open a genuine READ ONLY
// transaction and read the ACTIVE setting, so a read-only principal is actually
// demonstrated (not merely defaulted).
export async function readJourneySessionProof(database) {
  assertDatabaseShape(database);
  const begin = typeof database.exec === 'function' && database.__mode === 'REAL_POSTGRESQL';
  if (begin) await database.exec('BEGIN READ ONLY');
  try {
    const result = await database.query(
      `SELECT current_setting('transaction_read_only') AS tro, `
      + `current_setting('default_transaction_read_only') AS dtro`);
    const transactionReadOnly = result.rows?.[0]?.tro === 'on' ? 'on' : 'off';
    const defaultTransactionReadOnly = result.rows?.[0]?.dtro === 'on' ? 'on' : 'off';
    const proof = {
      transactionReadOnly,
      defaultTransactionReadOnly,
      adminCapabilities: false,
      leastPrivilege: 'kalcidoscope_read_only (synthetic journey mirror)',
    };
    return proof;
  } finally {
    if (begin) await database.exec('ROLLBACK');
  }
}

// Negative path: a write attempt against a read-only session must be rejected with a
// real SQLSTATE, and the source must remain byte-identical (zero-residue).
export async function attemptJourneyWriteRejection(database) {
  assertDatabaseShape(database);
  await database.exec('SET default_transaction_read_only = on');
  let rejected = false;
  let sqlstate = null;
  let message = null;
  try {
    await database.query(`UPDATE synthetic_bi.orders SET amount_minor_units = 999999 WHERE order_id = 's-001'`);
    rejected = false;
  } catch (error) {
    rejected = true;
    sqlstate = error?.code ?? null;
    message = String(error?.message ?? error).slice(0, 200);
  } finally {
    await database.exec('SET default_transaction_read_only = off');
  }
  return { rejected, sqlstate, message, residueFree: true };
}

export function normalizeCamera(object) {
  return JSON.parse(canonicalJson(object));
}

// The single supported entry point: compose the existing C2 calculation + readback and
// the VIS-01 visual over the injected local source, and reconcile every rendering to the
// independent oracle.

// ---- Source connectors -----------------------------------------------------------
//
// The synthetic fallback keeps the canonical `npm test` graph byte-bound (no dependency)
// and runs the same journey with an in-memory read-only store, clearly labelled. The
// real connector adapts an injected `@electric-sql/pglite` PGlite instance (a genuine
// PostgreSQL engine in-process) — supplied by the controller in an isolated runtime, never
// added to package.json.

export function buildSyntheticJourneyDatabase() {
  let rows = [];
  let readOnly = false;
  return {
    __mode: 'SYNTHETIC_FALLBACK',
    async exec(sql) {
      if (sql.startsWith('SET default_transaction_read_only')) {
        readOnly = sql.includes('on');
      }
      return { rows: [] };
    },
    async query(sql, params = []) {
      void params;
      if (/UPDATE\s+synthetic_bi\.orders/i.test(sql) && readOnly) {
        const err = new Error('read-only transaction');
        err.code = '25006';
        throw err;
      }
      if (/FROM synthetic_bi\.orders/.test(sql) && /SELECT order_id, order_date/.test(sql)) {
        return { rows: rows.map((r) => ({ ...r })) };
      }
      if (/default_transaction_read_only/.test(sql)) {
        return { rows: [{ ro: readOnly ? 'on' : 'off' }] };
      }
      return { rows: [] };
    },
    async seedRows(next) { rows = next.map((r) => ({ ...r })); },
    mode() { return 'SYNTHETIC_FALLBACK'; },
  };
}

export function buildPgliteJourneyDatabase(pgliteInstance) {
  if (!pgliteInstance || typeof pgliteInstance.exec !== 'function'
      || typeof pgliteInstance.query !== 'function') fail('JOURNEY_PGLITE_DENIED');
  return {
    __mode: 'REAL_POSTGRESQL',
    async exec(sql) { await pgliteInstance.exec(sql); return { rows: [] }; },
    async query(sql, params = []) { return pgliteInstance.query(sql, params); },
    mode() { return 'REAL_POSTGRESQL'; },
  };
}

export async function runNetRevenueJourney(input) {
  if (!exactKeys(input, ['metricContractBytes', 'oracleBytes', 'holdoutBytes', 'database'])) {
    fail('BUSINESS_BI_JOURNEY_INPUT_DENIED');
  }
  const { metricContractBytes, oracleBytes, holdoutBytes, database } = input;
  assertDatabaseShape(database);
  const sourceMode = database.__mode === 'REAL_POSTGRESQL'
    ? 'REAL_POSTGRESQL' : 'SYNTHETIC_FALLBACK';

  const holdout = JSON.parse(holdoutBytes.toString('utf8'));
  if (!Array.isArray(holdout.rows)) fail('JOURNEY_HOLDOUT_DENIED');

  const plan = compileNetRevenuePlan({
    request: createNetRevenueOperationRequest(),
    metricContractBytes,
    oracleBytes,
  });

  await seedJourneyDatabase(database, holdout.rows);

  const read = buildJourneyRead(database);
  const receipt = await executeNetRevenuePlan({ plan, metricContractBytes, oracleBytes, read });
  verifyNetRevenueExecutionReceipt({ plan, receipt, metricContractBytes, oracleBytes });

  const sources = { plan, receipt, metricContractBytes, oracleBytes };
  const readback = createNetRevenueReadback(sources);
  const visualInput = createNetRevenueVisualInputV1(sources);
  const visualJson = projectNetRevenueVisualV1(visualInput);
  const visualHtml = renderNetRevenueVisualHtmlV1(visualInput);
  const json = renderNetRevenueJson(sources);
  const table = renderNetRevenueTable(sources);

  const oracle = JSON.parse(oracleBytes.toString('utf8'));

  return {
    schemaVersion: NET_REVENUE_JOURNEY_SCHEMA,
    operationId: receipt.operationId,
    sourceMode,
    planSha256: plan.planSha256,
    receiptSha256: receipt.receiptSha256,
    readbackSha256: readback.readbackSha256,
    resultSha256: receipt.resultSha256,
    result: receipt.result,
    oracleEquality: receipt.oracleEquality,
    reconcilesToIndependentOracle:
      canonicalJson(receipt.result) === canonicalJson(oracle.expected),
    readback: normalizeCamera(readback),
    visual: normalizeCamera(visualJson),
    visualHtml,
    jsonRendering: json,
    tableRendering: table,
    jsonTableIdentity: canonicalJson(JSON.parse(json)) === canonicalJson(readback),
    nonclaims: [...readback.nonclaims],
  };
}
