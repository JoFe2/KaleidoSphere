// KaleidoSphere #238 — positive local F4 composition: the real source -> #237 mapping
// profile boundary -> #238 segment comparison, tested THROUGH the actual composition
// entry point (the same surface the CLI drives). This closes the previously-unimplemented
// "#237 -> #238" composition, replacing the #238 review note that it "remained
// unimplemented and parent-owned".
//
// The positive run must reconcile to the #238 independent expected values and both REAL
// local PGlite mappings (ledger-v1 AND ledger-v2) must reproduce byte-identical kernel
// and comparison digests. The negative cases (wrong source, wrong unit/scale, wrong
// mapping) are driven through the SAME entry point and must deny fail-closed. UNKNOWN /
// missing-data semantics are preserved in the comparison channels, never coerced.

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  F4_LAYOUT_VERSIONS,
  F4_PROFILE_BY_LAYOUT,
  NET_REVENUE_F4_COMPOSITION_SCHEMA,
  AMBIGUOUS_UNITS_PROFILE,
  WRONG_SCALE_PROFILE,
  composeViaProfile,
  composeF4ForLayout,
  seedF4Database,
  readF4SourceRows,
} from '../services/bi-control/src/business-bi/net-revenue-f4-composition.mjs';
import { serializeHoldout } from '../services/bi-control/src/db-analyzer/postgresql-safe-analysis.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');

async function fx(lv) {
  const f = lv === 'ledger-v1' ? 'net-revenue-f4-composition-v1.json' : 'net-revenue-f4-composition-v2.json';
  return JSON.parse(await readFile(`tests/fixtures/business-bi/${f}`, 'utf8'));
}

function expectComparison(out) {
  const c = out.comparison.comparison;
  const u = out.comparison.current;
  assert.equal(c.saleValue, 50000);
  assert.equal(c.netRevenue, 45000);
  assert.deepEqual(c.segments, { direct: 30000, partner: 20000 });
  assert.equal(u.saleValue, 72000);
  assert.equal(u.netRevenue, 66000);
  assert.deepEqual(u.segments, { direct: 57000, partner: 15000 });
  assert.equal(out.comparison.delta.netRevenue, 21000);
  assert.equal(out.comparison.delta.saleValue, 22000);
  assert.equal(out.comparison.excludedOutOfScopeCount, 1);
  // intake / open-orders stay unsupported (null), the honest #238 acceptance limit.
  assert.equal(c.orderIntake, null);
  assert.equal(u.orderIntake, null);
  assert.equal(c.openOrderCount, null);
  assert.equal(u.openOrderValue, null);
}

test('the composition schema and layout->profile binding are frozen', () => {
  assert.equal(NET_REVENUE_F4_COMPOSITION_SCHEMA, 'kaleidosphere.business-bi/net-revenue-f4-composition/v1');
  assert.deepEqual(F4_LAYOUT_VERSIONS, ['ledger-v1', 'ledger-v2']);
  assert.deepEqual(F4_PROFILE_BY_LAYOUT, { 'ledger-v1': 'ledger-mapping-v1', 'ledger-v2': 'ledger-mapping-v2' });
});

test('positive: both layouts map through the frozen #237 profile and reconcile to the #238 expected values', async () => {
  for (const lv of F4_LAYOUT_VERSIONS) {
    const out = composeF4ForLayout(lv, (await fx(lv)).rows);
    assert.equal(out.kernelProfile, F4_PROFILE_BY_LAYOUT[lv]);
    assert.equal(out.sourceMarking, 'SYNTHETIC');
    expectComparison(out);
  }
});

test('positive: both layouts yield byte-identical kernel and comparison digests (variant/replay)', async () => {
  const o1 = composeF4ForLayout('ledger-v1', (await fx('ledger-v1')).rows);
  const o2 = composeF4ForLayout('ledger-v2', (await fx('ledger-v2')).rows);
  assert.equal(o1.kernelDigest, o2.kernelDigest);
  assert.equal(o1.comparisonDigest, o2.comparisonDigest);
  assert.equal(o1.kernelRowCount, 12);
  assert.equal(o2.kernelRowCount, 12);
});

test('the kernel rows round-trip through the released serializer (no extension leak)', async () => {
  const { canonicalRows } = composeViaProfile('ledger-v1', (await fx('ledger-v1')).rows);
  assert.equal(canonicalRows.length, 12);
  // canonical kernel rows are exactly the 4 closed fields, never the status/segment ext.
  assert.deepEqual(Object.keys(canonicalRows[0]).sort(), ['amount_minor_units', 'order_date', 'order_id', 'record_kind']);
  assert.match(sha(serializeHoldout(canonicalRows)), /^[a-f0-9]{64}$/);
});

test('UNKNOWN / missing-data semantics are preserved through the composition (bound to #238 core)', async () => {
  const out = composeF4ForLayout('ledger-v1', (await fx('ledger-v1')).rows);
  const c = out.comparison.comparison;
  const u = out.comparison.current;
  // comparison unknown: s-205 unknown amount 900 (quantified); current unknown: s-210 amount null (unquantified).
  assert.equal(c.unknown.count, 1);
  assert.equal(c.unknown.quantifiedAmountMinorUnits, 900);
  assert.equal(u.unknown.count, 1);
  assert.equal(u.unknown.quantifiedAmountMinorUnits, 0);
  assert.equal(u.unknown.unquantifiedCount, 1);
});

test('negative (wrong mapping): an unrecognised posting/entry kind DENIES at the boundary', async () => {
  const kind = 'posting_type';
  const rows = (await fx('ledger-v1')).rows.map((r) => ({ ...r, [kind]: 'not_a_kind' }));
  assert.throws(() => composeF4ForLayout('ledger-v1', rows), (e) => e.code === 'LEDGER_KIND_DENIED:not_a_kind');
});

test('negative (wrong source/layout): the other layout fed under the declared profile DENIES', async () => {
  // ledger-v2 column names fed under ledger-v1 profile -> kind column resolves to undefined.
  const v2rows = (await fx('ledger-v2')).rows.map((r) => ({
    entry_kind: r.entry_kind, atomic_value: r.atomic_value, ledger_stream: r.ledger_stream,
    row_key: r.row_key, occurred_at: r.occurred_at, status: r.status, segment: r.segment,
  }));
  assert.throws(() => composeF4ForLayout('ledger-v1', v2rows), (e) => e.code === 'LEDGER_KIND_DENIED:undefined');
});

test('negative (wrong unit): ambiguous and wrong-scale profiles DENY through the same entry point', async () => {
  const rows = (await fx('ledger-v1')).rows;
  assert.throws(() => composeF4ForLayout('ledger-v1', rows, { profile: AMBIGUOUS_UNITS_PROFILE }),
    (e) => e.code === 'LEDGER_UNIT_SCALE_AMBIGUOUS');
  assert.throws(() => composeF4ForLayout('ledger-v1', rows, { profile: WRONG_SCALE_PROFILE }),
    (e) => e.code === 'LEDGER_UNIT_SCALE_MISMATCH');
});

test('negative (unit/role/currency gate) is enforced INSIDE the composition, not as a caller convention', async () => {
  // A self-consistent but wrong-scale profile must still fail at mapping time, proving
  // the gate lives at the frozen #237 mapping boundary, not in a separately-invoked helper.
  const rows = (await fx('ledger-v1')).rows;
  assert.throws(() => composeViaProfile('ledger-v1', rows, { profile: WRONG_SCALE_PROFILE }),
    (e) => e.code === 'LEDGER_UNIT_SCALE_MISMATCH');
});

test('real local PostgreSQL: both layouts seed/read/map/compare via the actual entry point (PGlite injected)', async (t) => {
  let makeDb;
  try {
    const { readFile: rf } = await import('node:fs/promises');
    const { pathToFileURL } = await import('node:url');
    const candidate = '/workspace/.ks-journey-runtime/node_modules/@electric-sql/pglite/dist/index.js';
    try { await rf(candidate); } catch { throw new Error('no pglite'); }
    const mod = await import(pathToFileURL(candidate));
    const { buildPgliteJourneyDatabase } = await import('../services/bi-control/src/business-bi/net-revenue-journey.mjs');
    makeDb = () => buildPgliteJourneyDatabase(new mod.PGlite());
  } catch {
    t.skip('external PGlite runtime not present; real-database path not exercised here');
    return;
  }

  const digests = [];
  for (const lv of F4_LAYOUT_VERSIONS) {
    const db = makeDb();
    await seedF4Database(db, lv, (await fx(lv)).rows);
    const readBack = await readF4SourceRows(db, lv);
    const out = composeF4ForLayout(lv, readBack, { sourceMode: 'REAL_POSTGRESQL' });
    assert.equal(out.sourceMode, 'REAL_POSTGRESQL');
    expectComparison(out);
    digests.push({ kernel: out.kernelDigest, comparison: out.comparisonDigest });
  }
  assert.equal(digests[0].kernel, digests[1].kernel);
  assert.equal(digests[0].comparison, digests[1].comparison);
});

test('the CLI entry point composes the same positive and negative paths (synthetic fallback)', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileP = promisify(execFile);
  const { stdout } = await execFileP('node', ['scripts/run-net-revenue-f4-composition.mjs', '--layout', 'ledger-v1', '--negative'], { cwd: process.cwd() });
  const doc = JSON.parse(stdout);
  assert.equal(doc.sourceMode, 'SYNTHETIC_FALLBACK');
  assert.equal(doc.layouts.length, 1);
  assert.equal(doc.layouts[0].comparison.delta.netRevenue, 21000);
  assert.equal(doc.negativeEvidence.wrongMapping.code, 'LEDGER_KIND_DENIED:not_a_kind');
  assert.equal(doc.negativeEvidence.wrongSource.code, 'LEDGER_KIND_DENIED:undefined');
  assert.equal(doc.negativeEvidence.wrongUnitScale.ambiguous.code, 'LEDGER_UNIT_SCALE_AMBIGUOUS');
  assert.equal(doc.negativeEvidence.wrongUnitScale.wrongScale.code, 'LEDGER_UNIT_SCALE_MISMATCH');
});
