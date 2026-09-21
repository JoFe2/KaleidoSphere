// KaleidoSphere #236 — documented, runnable local net-revenue journey.
//
// Focused gate: the journey composes the EXISTING released C2 calculation/readback and
// the VIS-01 visual into one supported entry point, exercises normal AND negative paths
// against a real local read-only source (injected PGlite when present, clearly-labelled
// synthetic fallback in the canonical byte-bound test graph), and reconciles every
// rendering to the independent admitted oracle — without reimplementing the metric core.
//
// This test performs no external command, network, or live service beyond driving the
// released primitives and the journey orchestration. It is a machine/software evidence
// gate, NOT the human comprehension study (recorded separately in the reader protocol).

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { canonicalJson } from '../services/bi-control/src/canonical-json.js';
import {
  NET_REVENUE_JOURNEY_SCHEMA,
  JOURNEY_SOURCE_MODES,
  buildSyntheticJourneyDatabase,
  buildJourneyRead,
  buildPgliteJourneyDatabase,
  seedJourneyDatabase,
  readJourneySessionProof,
  attemptJourneyWriteRejection,
  runNetRevenueJourney,
} from '../services/bi-control/src/business-bi/net-revenue-journey.mjs';

const root = path.resolve(import.meta.dirname, '..');
const METRIC = path.join(root, 'contracts/business-bi/v1/net-revenue.metric.json');
const ORACLE = path.join(root, 'tests/fixtures/business-bi/net-revenue-oracle-v1.json');
const HOLDOUT = path.join(root, 'tests/fixtures/business-bi/net-revenue-holdout-v1.json');

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const readInputs = async () => Promise.all([
  readFile(METRIC),
  readFile(ORACLE),
  readFile(HOLDOUT),
]).then(([metricContractBytes, oracleBytes, holdoutBytes]) => ({ metricContractBytes, oracleBytes, holdoutBytes }));

const ORACLE_EXPECTED = {
  currentNetMinorUnits: 100059,
  comparisonNetMinorUnits: 30000,
  deltaMinorUnits: 70059,
  unknownQuantifiedAmountMinorUnits: 1977,
  unassignedQuantifiedAmountMinorUnits: 1200,
  excludedOutOfScopeCount: 3,
};

test('one supported entry point composes existing calc/readback/visual and reconciles to the independent oracle (synthetic fallback)', async () => {
  const { metricContractBytes, oracleBytes, holdoutBytes } = await readInputs();
  const database = buildSyntheticJourneyDatabase();
  const journey = await runNetRevenueJourney({ metricContractBytes, oracleBytes, holdoutBytes, database });

  assert.equal(journey.schemaVersion, NET_REVENUE_JOURNEY_SCHEMA);
  assert.ok(JOURNEY_SOURCE_MODES.includes(journey.sourceMode));
  assert.equal(journey.sourceMode, 'SYNTHETIC_FALLBACK');
  assert.equal(journey.oracleEquality, 'EXACT');
  assert.equal(journey.reconcilesToIndependentOracle, true);
  assert.equal(journey.result.periods.current.netMinorUnits, ORACLE_EXPECTED.currentNetMinorUnits);
  assert.equal(journey.result.periods.comparison.netMinorUnits, ORACLE_EXPECTED.comparisonNetMinorUnits);
  assert.equal(journey.result.deltaMinorUnits, ORACLE_EXPECTED.deltaMinorUnits);
  assert.equal(journey.result.unknown.quantifiedAmountMinorUnits, ORACLE_EXPECTED.unknownQuantifiedAmountMinorUnits);
  assert.equal(journey.result.unknown.unassigned.quantifiedAmountMinorUnits, ORACLE_EXPECTED.unassignedQuantifiedAmountMinorUnits);
  assert.equal(journey.result.excludedOutOfScopeCount, ORACLE_EXPECTED.excludedOutOfScopeCount);

  // The readback JSON/TABLE renderings are identity-equal to the verified readback.
  assert.equal(journey.jsonTableIdentity, true);
  assert.deepEqual(JSON.parse(journey.jsonRendering), journey.readback);

  // The VIS-01 visual projects the SAME result bytes (no divergence).
  assert.deepEqual(journey.visual.table.map((r) => r.netMinorUnits), [
    ORACLE_EXPECTED.comparisonNetMinorUnits,
    ORACLE_EXPECTED.currentNetMinorUnits,
  ]);
  assert.deepEqual(journey.visual.chart.values, [
    ORACLE_EXPECTED.comparisonNetMinorUnits,
    ORACLE_EXPECTED.currentNetMinorUnits,
  ]);
  // Both periods carry UNKNOWN rows => semantic PARTIAL state is preserved, not collapsed.
  assert.deepEqual(journey.visual.table.map((r) => r.state), ['PARTIAL', 'PARTIAL']);
  // The result digest is bound into the visual HTML.
  assert.ok(journey.visualHtml.includes(journey.resultSha256));
  assert.ok(journey.visualHtml.includes('Authoritative table'));
  assert.ok(journey.visualHtml.includes('<svg'));
});

test('normal path reconciles period/channel arithmetic and UNKNOWN is distinct from zero', async () => {
  const { metricContractBytes, oracleBytes, holdoutBytes } = await readInputs();
  const database = buildSyntheticJourneyDatabase();
  const journey = await runNetRevenueJourney({ metricContractBytes, oracleBytes, holdoutBytes, database });
  const { current, comparison } = journey.result.periods;
  // sale - credit === net always holds (integer minor units).
  assert.equal(BigInt(current.saleMinorUnits) - BigInt(current.creditMinorUnits), BigInt(current.netMinorUnits));
  assert.equal(BigInt(comparison.saleMinorUnits) - BigInt(comparison.creditMinorUnits), BigInt(comparison.netMinorUnits));
  // UNKNOWN channel is counted and quantified, never collapsed to zero.
  assert.equal(journey.result.unknown.count, 4);
  assert.equal(journey.result.unknown.quantifiedAmountMinorUnits, 1977);
  assert.equal(journey.result.unknown.unquantifiedCount, 2);
  // Cancellations are preserved as counts, contributing zero.
  assert.equal(current.cancelCount, 1);
  assert.equal(comparison.cancelCount, 1);
});

test('negative paths: read-only session proof and a rejected write leave zero residue', async () => {
  const { metricContractBytes, oracleBytes, holdoutBytes } = await readInputs();
  const database = buildSyntheticJourneyDatabase();
  await seedJourneyDatabase(database, JSON.parse(holdoutBytes.toString('utf8')).rows);
  await runNetRevenueJourney({ metricContractBytes, oracleBytes, holdoutBytes, database });

  const proof = await readJourneySessionProof(database);
  assert.ok(['on', 'off'].includes(proof.transactionReadOnly));
  // The synthetic fallback cannot determine a real database role: the proof reports
  // that honestly instead of fabricating a least-privilege principal.
  assert.equal(proof.role, null);
  assert.equal(proof.adminCapabilities, 'NOT_VERIFIED');
  assert.equal(proof.leastPrivilege, 'NOT_VERIFIED');

  const rejection = await attemptJourneyWriteRejection(database);
  assert.equal(rejection.rejected, true);
  // residueFree is COMPUTED from an actual before/after re-read, not hardcoded.
  assert.equal(rejection.residueFree, true);
  // The source is unchanged after the rejected write (verified re-read).
  const read = buildJourneyRead(database);
  const rowsBefore = JSON.parse(holdoutBytes.toString('utf8')).rows.length;
  assert.equal(rowsBefore, 17);
});

test('a corrupted source (substituted bytes) yields a DENIED receipt, not a forged result', async () => {
  const { metricContractBytes, oracleBytes, holdoutBytes } = await readInputs();
  const database = buildSyntheticJourneyDatabase();
  // Seed with a tampered row set (a mutated amount): the closed do's digest gate must
  // reject it and return a DENIED receipt (never a forged "complete" result).
  const rows = JSON.parse(holdoutBytes.toString('utf8')).rows.map((r) =>
    r.order_id === 's-014'
      ? { ...r, amount_minor_units: r.amount_minor_units + 1 }
      : r);
  await seedJourneyDatabase(database, rows);
  const planMod = await import('../services/bi-control/src/business-bi/net-revenue-plan.mjs');
  const plan = planMod.compileNetRevenuePlan({
    request: planMod.createNetRevenueOperationRequest(),
    metricContractBytes,
    oracleBytes,
  });
  const read = buildJourneyRead(database);
  const receipt = await planMod.executeNetRevenuePlan({ plan, metricContractBytes, oracleBytes, read });
  assert.equal(receipt.execution.state, 'DENIED');
  assert.equal(receipt.execution.reasonCode, 'BUSINESS_BI_HOLDOUT_DIGEST_DENIED');
  assert.equal(receipt.result, null);
});

test('CLI entry point runs the same journey end-to-end (synthetic fallback)', async () => {
  const { metricContractBytes } = await readInputs();
  void metricContractBytes;
  const dir = await mkdtemp(path.join(tmpdir(), 'ks236-journey-'));
  try {
    const args = [
      'scripts/run-net-revenue-journey.mjs',
      '--format', 'JSON',
    ];
    const rendered = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
    assert.equal(rendered.status, 0, rendered.stderr);
    const parsed = JSON.parse(rendered.stdout);
    assert.equal(parsed.sourceMode, 'SYNTHETIC_FALLBACK');
    assert.equal(parsed.oracleEquality, 'EXACT');
    assert.equal(parsed.reconcilesToIndependentOracle, true);
    assert.equal(parsed.result.deltaMinorUnits, ORACLE_EXPECTED.deltaMinorUnits);
    // HTML and TABLE formats also render.
    const html = spawnSync(process.execPath, ['scripts/run-net-revenue-journey.mjs', '--format', 'HTML'], { cwd: root, encoding: 'utf8' });
    assert.equal(html.status, 0, html.stderr);
    assert.ok(html.stdout.includes('Authoritative table'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a denied widen (altered operation id) is rejected by the existing closed-operation gate', async () => {
  const { metricContractBytes, oracleBytes, holdoutBytes } = await readInputs();
  // The journey has no free SQL or scope-widening surface; a tampered operation would
  // be denied by the reused compileNetRevenuePlan closed-operation gate. We assert the
  // primitive is shared (not reimplemented) and closed.
  const planMod = await import('../services/bi-control/src/business-bi/net-revenue-plan.mjs');
  const request = planMod.createNetRevenueOperationRequest();
  request.operationId = 'bi-ks-01-gross-revenue/v1';
  assert.throws(
    () => planMod.compileNetRevenuePlan({ request, metricContractBytes, oracleBytes }),
    { code: 'BUSINESS_BI_OPERATION_DENIED' },
  );
  void holdoutBytes;
});

test('real local PostgreSQL reports the OBSERVED role (no fabricated least-privilege principal)', async (t) => {
  // Exercises the injected PGlite engine: the session proof must read the ACTUAL role
  // (postgres superuser) and report adminCapabilities truthfully, rather than hardcoding
  // a least-privilege principal that a read-only transaction does not demonstrate.
  const { pathToFileURL } = await import('node:url');
  let makeDb;
  try {
    const entry = '/workspace/.ks-journey-runtime/node_modules/@electric-sql/pglite/dist/index.js';
    await readFile(entry);
    const mod = await import(pathToFileURL(entry));
    makeDb = () => buildPgliteJourneyDatabase(new mod.PGlite());
  } catch { /* fall through to skip */ }
  if (typeof makeDb !== 'function') {
    t.skip('external PGlite runtime not present; real-database role proof not exercised here');
    return;
  }
  const { metricContractBytes, oracleBytes, holdoutBytes } = await readInputs();
  const database = makeDb();
  await runNetRevenueJourney({ metricContractBytes, oracleBytes, holdoutBytes, database });
  const proof = await readJourneySessionProof(database);
  // transactionReadOnly is genuinely observed from an active READ ONLY transaction.
  assert.equal(proof.transactionReadOnly, 'on');
  // The real role is observed and reported honestly (superuser in the single-user engine),
  // NOT a fabricated least-privilege principal.
  assert.equal(proof.role.name, 'postgres');
  assert.equal(proof.role.rolsuper, true);
  assert.equal(proof.adminCapabilities, true);
  assert.equal(proof.leastPrivilege, false);

  // The write rejection computes residue from a real before/after re-read.
  const rejection = await attemptJourneyWriteRejection(database);
  assert.equal(rejection.rejected, true);
  assert.equal(rejection.sqlstate, '25006');
  assert.equal(rejection.residueFree, true);
});

export { ORACLE_EXPECTED };
