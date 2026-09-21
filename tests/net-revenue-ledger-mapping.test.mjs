// KaleidoSphere #237 — same bounded net-revenue definition over a SECOND semantic
// synthetic layout, via versioned mapping profiles, with no metric-core rewrite.
//
// The second layout (synthetic_bi.ledger) stores the SAME 17 admitted source rows with
// different column names and reworded posting enums.  Two versioned profiles resolve it
// back to the canonical {order_id, order_date, record_kind, amount_minor_units} shape,
// and the mapping must round-trip to the ADMITTED holdout digest so the released C2
// metric core computes the exact same result.  A profile that declares an ambiguous or
// contradictory unit scale is rejected fail-closed.
//
// Like #236, the canonical CI path needs no external dependency: mapping is exercised
// over in-memory source rows.  The real-local-PostgreSQL path (injected PGlite) is
// exercised here when the `--pglite` harness provides a database factory.

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LEDGER_MAPPING_PROFILES,
  AMBIGUOUS_UNITS_PROFILE,
  WRONG_SCALE_PROFILE,
  LEDGER_LAYOUT_VERSIONS,
  declaredSourceUnit,
  validateLedgerMappingProfile,
  assertProfileMatchesSourceUnit,
  mapLedgerRowToCanonical,
  mapLedgerRowsToCanonical,
  buildLedgerRead,
  compareProfileMappings,
  seedLedgerDatabase,
  readLedgerSourceRows,
} from '../services/bi-control/src/business-bi/net-revenue-ledger-mapping.mjs';
import { serializeHoldout } from '../services/bi-control/src/db-analyzer/postgresql-safe-analysis.mjs';
import {
  compileNetRevenuePlan,
  createNetRevenueOperationRequest,
  executeNetRevenuePlan,
} from '../services/bi-control/src/business-bi/net-revenue-plan.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');

async function readInputs() {
  const [metricContractBytes, oracleBytes, holdoutBytes, v1, v2] = await Promise.all([
    readFile('contracts/business-bi/v1/net-revenue.metric.json'),
    readFile('tests/fixtures/business-bi/net-revenue-oracle-v1.json'),
    readFile('tests/fixtures/business-bi/net-revenue-holdout-v1.json'),
    readFile('tests/fixtures/business-bi/net-revenue-ledger-v1.json').then((b) => JSON.parse(b.toString('utf8'))),
    readFile('tests/fixtures/business-bi/net-revenue-ledger-v2.json').then((b) => JSON.parse(b.toString('utf8'))),
  ]);
  return { metricContractBytes, oracleBytes, holdoutBytes, v1, v2 };
}

test('two versioned profiles are frozen, version-distinct, and validate', () => {
  assert.deepEqual(LEDGER_LAYOUT_VERSIONS, ['ledger-v1', 'ledger-v2']);
  const p1 = LEDGER_MAPPING_PROFILES['ledger-mapping-v1'];
  const p2 = LEDGER_MAPPING_PROFILES['ledger-mapping-v2'];
  assert.equal(validateLedgerMappingProfile(p1), true);
  assert.equal(validateLedgerMappingProfile(p2), true);
  assert.notEqual(p1.layoutVersion, p2.layoutVersion);
  assert.notEqual(p1.kindField, p2.kindField);
  assert.notEqual(p1.amountField, p2.amountField);
});

test('both profiles map the second layout to byte-identical canonical rows (variant/replay)', async () => {
  const { v1, v2 } = await readInputs();
  const p1 = LEDGER_MAPPING_PROFILES['ledger-mapping-v1'];
  const p2 = LEDGER_MAPPING_PROFILES['ledger-mapping-v2'];
  const cmp = compareProfileMappings(p1, p2, v1.rows, v2.rows);
  assert.equal(cmp.equal, true);
  assert.equal(cmp.rowCount, 17);
  assert.equal(cmp.digestA, cmp.digestB);
});

test('the mapped canonical rows round-trip to the ADMITTED holdout digest (same bounded definition)', async () => {
  const { v1, holdoutBytes } = await readInputs();
  const p1 = LEDGER_MAPPING_PROFILES['ledger-mapping-v1'];
  const rows = mapLedgerRowsToCanonical(p1, v1.rows);
  const admitted = JSON.parse(holdoutBytes.toString('utf8'));
  assert.equal(sha(serializeHoldout(rows)), sha(serializeHoldout(admitted.rows)));
});

test('the second layout drives the released metric core to the exact same oracle result', async () => {
  const { metricContractBytes, oracleBytes, v1 } = await readInputs();
  const p1 = LEDGER_MAPPING_PROFILES['ledger-mapping-v1'];
  assertProfileMatchesSourceUnit(p1, declaredSourceUnit('ledger-v1'));
  const rows = mapLedgerRowsToCanonical(p1, v1.rows);
  const plan = compileNetRevenuePlan({ request: createNetRevenueOperationRequest(), metricContractBytes, oracleBytes });
  const read = buildLedgerRead(rows, { rawRelation: 'synthetic_bi.ledger', profile: 'ledger-mapping-v1' });
  const receipt = await executeNetRevenuePlan({ plan, metricContractBytes, oracleBytes, read });
  assert.equal(receipt.execution.state, 'COMPLETE');
  assert.equal(receipt.oracleEquality, 'EXACT');
  assert.equal(receipt.result.deltaMinorUnits, 70059);
  assert.equal(receipt.result.periods.current.netMinorUnits, 100059);
  assert.equal(receipt.result.periods.comparison.netMinorUnits, 30000);
});

test('a profile with no unit-scale declaration (ambiguous units) is rejected', async () => {
  const { v1 } = await readInputs();
  assert.throws(() => validateLedgerMappingProfile(AMBIGUOUS_UNITS_PROFILE), (e) => e.code === 'LEDGER_UNIT_SCALE_AMBIGUOUS');
  assert.throws(() => assertProfileMatchesSourceUnit(AMBIGUOUS_UNITS_PROFILE, declaredSourceUnit('ledger-v1')), (e) => e.code === 'LEDGER_UNIT_SCALE_AMBIGUOUS');
  // and it must not silently map rows
  assert.throws(() => mapLedgerRowsToCanonical(AMBIGUOUS_UNITS_PROFILE, v1.rows), (e) => e.code === 'LEDGER_UNIT_SCALE_AMBIGUOUS');
});

test('a profile whose unit scale contradicts the source declaration (wrong units) is rejected', async () => {
  const { v1 } = await readInputs();
  // WRONG_SCALE_PROFILE declares BASE_UNITS while the source declares MINOR_UNITS
  assert.equal(validateLedgerMappingProfile(WRONG_SCALE_PROFILE), true, 'self-consistent profiles validate');
  assert.throws(() => assertProfileMatchesSourceUnit(WRONG_SCALE_PROFILE, declaredSourceUnit('ledger-v1')), (e) => e.code === 'LEDGER_UNIT_SCALE_MISMATCH');
  // F5: the wrong-scale gate is enforced INSIDE the mapping entry point, not as a
  // caller convention.  Mapping WRONG_SCALE over real rows is rejected, so a declared
  // source can never be silently scaled by 100.
  assert.throws(() => mapLedgerRowToCanonical(WRONG_SCALE_PROFILE, v1.rows[0]), (e) => e.code === 'LEDGER_UNIT_SCALE_MISMATCH');
  assert.throws(() => mapLedgerRowsToCanonical(WRONG_SCALE_PROFILE, v1.rows), (e) => e.code === 'LEDGER_UNIT_SCALE_MISMATCH');
});

test('F5: unsupported currency minor-unit factor and arbitrary role bindings are rejected', () => {
  const p1 = LEDGER_MAPPING_PROFILES['ledger-mapping-v1'];
  // EUR at minorUnitsPerMajorUnit 7 is not the released minor-unit arithmetic and is denied.
  assert.throws(() => validateLedgerMappingProfile({
    ...p1, currency: { code: 'EUR', minorUnitsPerMajorUnit: 7 },
  }), (e) => e.code === 'LEDGER_CURRENCY_DENIED');
  // A role bound to an arbitrary column (amount -> the id column, kind -> the date column)
  // is denied, not silently accepted from the allowed column list.
  assert.throws(() => validateLedgerMappingProfile({ ...p1, amountField: 'row_key' }), (e) => e.code === 'LEDGER_AMOUNTFIELD_DENIED');
  assert.throws(() => validateLedgerMappingProfile({ ...p1, kindField: 'occurred_at' }), (e) => e.code === 'LEDGER_KINDFIELD_DENIED');
  assert.throws(() => validateLedgerMappingProfile({ ...p1, idField: 'posting_type' }), (e) => e.code === 'LEDGER_IDFIELD_DENIED');
});

test('a rewording/missing posting kind is rejected fail-closed (never silently unknown)', () => {
  const p1 = LEDGER_MAPPING_PROFILES['ledger-mapping-v1'];
  const bad = [
    { row_key: 'x-1', occurred_at: '2026-07-01', posting_type: 'debit_sale', value_atomic_units: 10, stream: 'c' },
    { row_key: 'x-2', occurred_at: '2026-07-01', posting_type: 'not_a_kind', value_atomic_units: 10, stream: 'c' },
  ];
  assert.throws(() => mapLedgerRowsToCanonical(p1, bad), (e) => e.code === 'LEDGER_KIND_DENIED:not_a_kind');
});

test('real local PostgreSQL: seed, read, map, and reconcile the second layout (PGlite injected)', async (t) => {
  // Try the injected PGlite engine from the external runtime dir (never package.json).
  // In a fresh CI without the external dependency this skips honestly — the metric core
  // and mapping are still fully exercised by the synthetic tests above.
  let makeDb;
  try {
    const { readdir } = await import('node:fs/promises');
    const { pathToFileURL } = await import('node:url');
    const candidates = [
      '/workspace/.ks-journey-runtime/node_modules/@electric-sql/pglite/dist/index.js',
    ];
    let entry = null;
    for (const c of candidates) {
      try { await readFile(c); entry = c; break; } catch {}
    }
    if (entry) {
      const mod = await import(pathToFileURL(entry));
      const { buildPgliteJourneyDatabase } = await import('../services/bi-control/src/business-bi/net-revenue-journey.mjs');
      makeDb = () => buildPgliteJourneyDatabase(new mod.PGlite());
    }
  } catch {}
  if (typeof makeDb !== 'function') {
    t.skip('external PGlite runtime not present; real-database path not exercised here');
    return;
  }

  const { metricContractBytes, oracleBytes, v1, v2 } = await readInputs();
  const p1 = LEDGER_MAPPING_PROFILES['ledger-mapping-v1'];
  const p2 = LEDGER_MAPPING_PROFILES['ledger-mapping-v2'];

  const db1 = makeDb();
  await seedLedgerDatabase(db1, 'ledger-v1', v1.rows);
  const src1 = await readLedgerSourceRows(db1, 'ledger-v1');
  const canon1 = mapLedgerRowsToCanonical(p1, src1);

  const db2 = makeDb();
  await seedLedgerDatabase(db2, 'ledger-v2', v2.rows);
  const src2 = await readLedgerSourceRows(db2, 'ledger-v2');
  const canon2 = mapLedgerRowsToCanonical(p2, src2);

  assert.equal(compareProfileMappings(p1, p2, src1, src2).equal, true);

  const plan = compileNetRevenuePlan({ request: createNetRevenueOperationRequest(), metricContractBytes, oracleBytes });
  const read = buildLedgerRead(canon1, { rawRelation: 'synthetic_bi.ledger', profile: 'ledger-mapping-v1', sourceMode: 'REAL_POSTGRESQL' });
  const receipt = await executeNetRevenuePlan({ plan, metricContractBytes, oracleBytes, read });
  assert.equal(receipt.execution.state, 'COMPLETE');
  assert.equal(receipt.oracleEquality, 'EXACT');
  assert.equal(receipt.result.deltaMinorUnits, 70059);
});
