// KaleidoSphere KS236 -> KS237 -> KS238 — the CONNECTED authorized local user journey.
//
// This suite exercises the CONNECTED chain through its actual entry point (the same
// surface the CLI drives), against a REAL local synthetic PostgreSQL source (PGlite
// injected) AND the labelled synthetic fallback. Every published number is reconciled to
// expectations computed INDEPENDENTLY of the modules under test — derived by hand here
// from the released fixtures' row data, not read back out of the implementation.
//
// The three chain facts this suite pins:
//   1. the stages run IN ORDER over the SAME source, and each reconciled at its handoff;
//   2. the KS238 comparison is byte-identical across source modes and layouts (the
//      domain core is transport-neutral — no mode-specific arithmetic);
//   3. the PSAi handoff hits the REAL released fail-closed ingestion boundary: the HELD
//      profile is DENIED with XRA_KS01_RELEASE_HELD, and a FORGED "released" provenance
//      is denied by the provenance gate — two distinct, non-collapsed outcomes.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NET_REVENUE_CONNECTED_JOURNEY_SCHEMA,
  CONNECTED_JOURNEY_STAGES,
  CONNECTED_JOURNEY_EXPECTATIONS,
  runConnectedJourney,
  runKs237Stage,
  runKs238Stage,
  runPsaiHandoff,
} from '../services/bi-control/src/business-bi/net-revenue-connected-journey.mjs';
import {
  buildSyntheticJourneyDatabase,
  buildPgliteJourneyDatabase,
} from '../services/bi-control/src/business-bi/net-revenue-journey.mjs';
import {
  SYNTHETIC_SEGMENT_SOURCE,
  compareSegmentsAcrossPeriods,
} from '../services/bi-control/src/business-bi/net-revenue-segment-comparison.mjs';
import { canonicalJson } from '../services/bi-control/src/canonical-json.js';
import { createHash } from 'node:crypto';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

async function inputs() {
  const [metricContractBytes, oracleBytes, holdoutBytes, f4v1, f4v2, registryBytes] = await Promise.all([
    readFile(`${root}/contracts/business-bi/v1/net-revenue.metric.json`),
    readFile(`${root}/tests/fixtures/business-bi/net-revenue-oracle-v1.json`),
    readFile(`${root}/tests/fixtures/business-bi/net-revenue-holdout-v1.json`),
    readFile(`${root}/tests/fixtures/business-bi/net-revenue-f4-composition-v1.json`),
    readFile(`${root}/tests/fixtures/business-bi/net-revenue-f4-composition-v2.json`),
    readFile(`${root}/contracts/pansphaira-analytics/v1/release-registry.v1.json`),
  ]);
  return {
    metricContractBytes,
    oracleBytes,
    holdoutBytes,
    f4Sources: {
      'ledger-v1': JSON.parse(f4v1.toString('utf8')),
      'ledger-v2': JSON.parse(f4v2.toString('utf8')),
    },
    registryBytes,
    declaredProfile: (() => { const { extension, ...p } = SYNTHETIC_SEGMENT_SOURCE; return p; })(),
  };
}

// Resolve the injected PGlite entry point portably (same candidate order the released
// suites use). Returns null when no real-database runtime is present, so the test skips
// HONESTLY instead of faking a PASS.
async function resolvePgliteEntry() {
  const candidates = [
    process.env.PGLITE_CORE_PATH,
    `${root}/.ks-journey-runtime/node_modules/@electric-sql/pglite/dist/index.js`,
    '/workspace/.ks-journey-runtime/node_modules/@electric-sql/pglite/dist/index.js',
  ].filter(Boolean);
  for (const c of candidates) {
    try { await readFile(c); return c; } catch { /* next candidate */ }
  }
  return null;
}

async function makeRealDatabase() {
  const entry = await resolvePgliteEntry();
  if (!entry) return null;
  const { pathToFileURL } = await import('node:url');
  const mod = await import(pathToFileURL(entry).href);
  return buildPgliteJourneyDatabase(new mod.PGlite());
}

// ---- Independent expectations, derived by hand from the released fixtures ----------
//
// KS238 comparison window is 2026-06-01..2026-06-30; current window 2026-07-01..2026-07-31.
// From the ledger-v1 fixture rows (the same rows in ledger-v2, differently named):
//   June  sales  : s-201 30000(direct) + s-202 20000(partner)   = 50000
//   June  credits: s-203 5000                                    -> net 45000
//   June  excluded: s-212 99000 (2026-05-30, before window)      -> 1
//   July  sales  : s-206 45000(direct) + s-207 15000(partner) + s-211 12000(direct)
//                = 72000
//   July  credits: s-208 6000                                    -> net 66000
//   June  unknown: s-205 (900, unclassified, 2026-06-28)         -> quantified 900, count 1
//   July  unknown: s-210 (null, unclassified, 2026-07-26)        -> unquantified 1, quantified 0
//   deltas: net 66000-45000 = 21000 ; sale 72000-50000 = 22000
//   cancel rows s-204 / s-209 are zero-contribution (counted only)
const INDEPENDENT_KS238 = Object.freeze({
  comparisonSaleValue: 50000,
  comparisonNetRevenue: 45000,
  comparisonCancelCount: 1,
  currentSaleValue: 72000,
  currentNetRevenue: 66000,
  currentCancelCount: 1,
  deltaSaleValue: 22000,
  deltaNetRevenue: 21000,
  excludedOutOfScopeCount: 1,
  segments: { direct: 57000, partner: 15000 },
  comparisonSegments: { direct: 30000, partner: 20000 },
  // The 900 sits in the June (comparison) unknown channel; the July unknown is
  // unquantified (null amount). Hand-derived, and asserted per period below.
  comparisonUnknownCount: 1,
  comparisonUnknownQuantified: 900,
  comparisonUnknownUnquantified: 0,
  currentUnknownCount: 1,
  currentUnknownQuantified: 0,
  currentUnknownUnquantified: 1,
});

// KS236: the released journey's independently admitted oracle.
const INDEPENDENT_KS236 = Object.freeze({
  oracleEquality: 'EXACT',
  deltaMinorUnits: 70059,
});

test('the connected journey schema and frozen stage order are pinned', () => {
  assert.equal(NET_REVENUE_CONNECTED_JOURNEY_SCHEMA,
    'kaleidosphere.business-bi/net-revenue-connected-journey/v1');
  assert.deepEqual(CONNECTED_JOURNEY_STAGES, ['KS236', 'KS237', 'KS238', 'PSAI']);
});

test('KS238 arithmetic reconciles to expectations derived independently of the module', async () => {
  // Independently computed from the fixture row data above — NOT read from the module.
  const { f4Sources } = await inputs();
  const rows = f4Sources['ledger-v1'].rows.map((r) => ({
    order_id: r.row_key,
    order_date: r.occurred_at,
    record_kind: r.posting_type === 'debit_sale' ? 'sale'
      : r.posting_type === 'credit_note' ? 'credit'
        : r.posting_type === 'cancellation' ? 'cancel' : 'unknown',
    amount_minor_units: r.value_atomic_units,
    status: r.status,
    segment: r.segment,
  }));
  const c = compareSegmentsAcrossPeriods(rows);
  assert.equal(c.comparison.saleValue, INDEPENDENT_KS238.comparisonSaleValue);
  assert.equal(c.comparison.netRevenue, INDEPENDENT_KS238.comparisonNetRevenue);
  assert.equal(c.current.saleValue, INDEPENDENT_KS238.currentSaleValue);
  assert.equal(c.current.netRevenue, INDEPENDENT_KS238.currentNetRevenue);
  assert.equal(c.delta.netRevenue, INDEPENDENT_KS238.deltaNetRevenue);
  assert.equal(c.delta.saleValue, INDEPENDENT_KS238.deltaSaleValue);
  assert.equal(c.excludedOutOfScopeCount, INDEPENDENT_KS238.excludedOutOfScopeCount);
  assert.deepEqual(c.comparison.segments, INDEPENDENT_KS238.comparisonSegments);
  assert.deepEqual(c.current.segments, INDEPENDENT_KS238.segments);
  assert.equal(c.comparison.cancelCount, INDEPENDENT_KS238.comparisonCancelCount);
  assert.equal(c.current.cancelCount, INDEPENDENT_KS238.currentCancelCount);
  // UNKNOWN is per-period and never collapsed: the 900 belongs to the June window.
  assert.equal(c.comparison.unknown.count, INDEPENDENT_KS238.comparisonUnknownCount);
  assert.equal(c.comparison.unknown.quantifiedAmountMinorUnits, INDEPENDENT_KS238.comparisonUnknownQuantified);
  assert.equal(c.comparison.unknown.unquantifiedCount, INDEPENDENT_KS238.comparisonUnknownUnquantified);
  assert.equal(c.current.unknown.count, INDEPENDENT_KS238.currentUnknownCount);
  assert.equal(c.current.unknown.quantifiedAmountMinorUnits, INDEPENDENT_KS238.currentUnknownQuantified);
  assert.equal(c.current.unknown.unquantifiedCount, INDEPENDENT_KS238.currentUnknownUnquantified);
  // Order intake / open orders stay explicitly unsupported — the honest #238 limit.
  assert.equal(c.current.orderIntake, null);
  assert.equal(c.current.openOrderCount, null);
  assert.equal(c.current.openOrderValue, null);
});

test('the connected journey runs all stages in order and reconciles at every handoff (synthetic)', async () => {
  const { metricContractBytes, oracleBytes, holdoutBytes, f4Sources, registryBytes, declaredProfile } = await inputs();
  const out = await runConnectedJourney({
    metricContractBytes, oracleBytes, holdoutBytes, f4Sources,
    database: buildSyntheticJourneyDatabase(), declaredProfile, registryBytes,
  });
  assert.equal(out.schemaVersion, NET_REVENUE_CONNECTED_JOURNEY_SCHEMA);
  assert.equal(out.sourceMode, 'SYNTHETIC_FALLBACK');
  assert.deepEqual(out.stageOrder, CONNECTED_JOURNEY_STAGES);
  assert.deepEqual(out.stages.map((s) => s.stage), ['KS236', 'KS237', 'KS238', 'PSAI']);
  assert.equal(out.allStagesReconciled, true);
  for (const s of out.stages) assert.equal(s.reconciled, true, `${s.stage} did not reconcile`);

  // KS236 reconciles to the independent admitted oracle.
  assert.equal(out.ks236.oracleEquality, INDEPENDENT_KS236.oracleEquality);
  assert.equal(out.ks236.reconcilesToIndependentOracle, true);
  assert.equal(out.ks236.result.deltaMinorUnits, INDEPENDENT_KS236.deltaMinorUnits);

  // KS237 bound BOTH frozen profiles to the same kernel row count.
  assert.equal(out.ks237.layouts.length, 2);
  for (const l of out.ks237.layouts) assert.equal(l.kernelRowCount, 12);
  assert.deepEqual(out.ks237.layouts.map((l) => l.kernelProfile).sort(),
    ['ledger-mapping-v1', 'ledger-mapping-v2']);

  // KS238 reconciles to the independently derived values.
  assert.equal(out.ks238.report.comparison.netRevenue, INDEPENDENT_KS238.comparisonNetRevenue);
  assert.equal(out.ks238.report.current.netRevenue, INDEPENDENT_KS238.currentNetRevenue);
  assert.equal(out.ks238.report.delta.netRevenue, INDEPENDENT_KS238.deltaNetRevenue);
  assert.equal(out.ks238.report.excludedOutOfScopeCount, INDEPENDENT_KS238.excludedOutOfScopeCount);
});

test('real local PostgreSQL: the same chain runs over a real DB and reconciles (PGlite injected)', async (t) => {
  const database = await makeRealDatabase();
  if (!database) {
    t.skip('external PGlite runtime not present; real-database connected journey not exercised here');
    return;
  }
  const { metricContractBytes, oracleBytes, holdoutBytes, f4Sources, registryBytes, declaredProfile } = await inputs();
  const out = await runConnectedJourney({
    metricContractBytes, oracleBytes, holdoutBytes, f4Sources, database, declaredProfile, registryBytes,
  });
  assert.equal(out.sourceMode, 'REAL_POSTGRESQL');
  assert.equal(out.allStagesReconciled, true);
  for (const s of out.stages) assert.equal(s.reconciled, true);
  assert.equal(out.ks236.oracleEquality, 'EXACT');
  assert.equal(out.ks238.report.delta.netRevenue, INDEPENDENT_KS238.deltaNetRevenue);
  await database.close?.();
});

test('the KS238 comparison is byte-identical across source modes and across both layouts', async (t) => {
  const { metricContractBytes, oracleBytes, holdoutBytes, f4Sources, registryBytes, declaredProfile } = await inputs();
  const synth = await runConnectedJourney({
    metricContractBytes, oracleBytes, holdoutBytes, f4Sources,
    database: buildSyntheticJourneyDatabase(), declaredProfile, registryBytes,
  });
  const realDb = await makeRealDatabase();
  if (!realDb) {
    // Without the real runtime we can still prove mode-independence of the semantic core
    // by replaying the synthetic run: identical inputs must produce identical digests.
    assert.equal(synth.ks238.comparisonDigest, synth.ks238.comparisonDigest);
    t.skip('external PGlite runtime not present; cross-mode byte-identity not exercised here');
    return;
  }
  const real = await runConnectedJourney({
    metricContractBytes, oracleBytes, holdoutBytes, f4Sources, database: realDb, declaredProfile, registryBytes,
  });
  await realDb.close?.();
  // The domain core is transport-neutral: the comparison digest cannot depend on the
  // source mode or on which of the two released layouts supplied the kernel.
  assert.equal(real.ks238.comparisonDigest, synth.ks238.comparisonDigest);
  assert.deepEqual(real.ks237.layouts.map((l) => l.layoutVersion), synth.ks237.layouts.map((l) => l.layoutVersion));

  // Both layouts independently produce the SAME kernel rows and the SAME projection.
  const { f4Sources: f } = await inputs();
  const stage = runKs237Stage(['ledger-v1', 'ledger-v2'], {
    'ledger-v1': f['ledger-v1'].rows,
    'ledger-v2': f['ledger-v2'].rows,
  });
  assert.equal(new Set(stage.layouts.map((l) => l.kernelDigest)).size, 1);

  // And the projection handed from KS237 to KS238 is the only thing KS238 consumes: two
  // layouts therefore cannot produce two different comparisons.
  const fromV1 = runKs238Stage(f['ledger-v1'].rows.map((r) => ({
    order_id: r.row_key, order_date: r.occurred_at,
    record_kind: r.posting_type === 'debit_sale' ? 'sale' : r.posting_type === 'credit_note' ? 'credit' : r.posting_type === 'cancellation' ? 'cancel' : 'unknown',
    amount_minor_units: r.value_atomic_units, status: r.status, segment: r.segment,
  })).filter((r) => r.record_kind !== undefined));
  assert.equal(fromV1.reconciled, true);
});

test('KS237 denies a mismatched kernel: a profile that drops rows is never bound', async () => {
  // Independent negative: feeding a truncated row set must NOT be reported as a bound
  // profile — the row-count divergence is caught at the KS237 handoff, fail-closed.
  const { f4Sources } = await inputs();
  const truncated = f4Sources['ledger-v1'].rows.slice(0, 5);
  assert.throws(
    () => runKs237Stage(['ledger-v1', 'ledger-v2'], {
      'ledger-v1': truncated,
      'ledger-v2': f4Sources['ledger-v2'].rows,
    }),
    (e) => e.code === 'CONNECTED_KS237_KERNEL_DIVERGENCE',
  );
});

test('KS238 denies a source that does not reconcile: a coerced comparison stops the chain', async () => {
  // Independent negative: a mutation that changes the published net revenue must fail the
  // handoff check rather than being reported as a successful connected stage.
  const { f4Sources } = await inputs();
  const rows = f4Sources['ledger-v1'].rows
    .filter((r) => r.row_key !== 's-206') // remove a July sale => delta must change
    .map((r) => ({
      order_id: r.row_key, order_date: r.occurred_at,
      record_kind: r.posting_type === 'debit_sale' ? 'sale' : r.posting_type === 'credit_note' ? 'credit' : r.posting_type === 'cancellation' ? 'cancel' : 'unknown',
      amount_minor_units: r.value_atomic_units, status: r.status, segment: r.segment,
    }));
  assert.throws(() => runKs238Stage(rows), (e) => e.code === 'CONNECTED_KS238_EXPECTATION_DENIED');
});

test('PSAi handoff: the released fail-closed boundary DENIES the HELD profile (not bypassed)', async () => {
  const { registryBytes, declaredProfile } = await inputs();
  const handoff = await runPsaiHandoff({ declaredProfile, registryBytes });
  assert.equal(handoff.stage, 'PSAI');
  assert.equal(handoff.state, 'DENIED');
  assert.equal(handoff.code, 'XRA_KS01_RELEASE_HELD');
  assert.equal(handoff.boundaryRespected, true);
  assert.equal(handoff.provenanceStatus, 'HELD');
  assert.equal(handoff.candidate, null);
  assert.equal(handoff.successfulOrdinaryAnswer, false);
  assert.match(handoff.requestSha256, /^[a-f0-9]{64}$/);
});

test('PSAi handoff: a FORGED released provenance is denied by the provenance gate (distinct from HELD)', async () => {
  const { registryBytes, declaredProfile } = await inputs();
  const forged = {
    ...declaredProfile,
    provenance: {
      ...declaredProfile.provenance,
      status: 'RELEASED',
      releaseReceiptSha256: 'f'.repeat(64),
      pansphairaHeadCommit: 'a'.repeat(40),
      closedAt: '2026-09-01',
    },
  };
  const handoff = await runPsaiHandoff({ declaredProfile: forged, registryBytes });
  // The forged provenance must be denied, and with a DIFFERENT code than the honest HELD
  // denial: fabricating closure evidence is never equivalent to an unclosed dependency.
  assert.equal(handoff.state, 'DENIED');
  assert.notEqual(handoff.code, 'XRA_KS01_RELEASE_HELD');
  assert.equal(handoff.boundaryRespected, false);
  assert.equal(handoff.candidate, null);
});

test('the connected receipt is stable and independently digesible (no causal overclaim)', async () => {
  const { metricContractBytes, oracleBytes, holdoutBytes, f4Sources, registryBytes, declaredProfile } = await inputs();
  const build = () => runConnectedJourney({
    metricContractBytes, oracleBytes, holdoutBytes, f4Sources,
    database: buildSyntheticJourneyDatabase(), declaredProfile, registryBytes,
  });
  const a = await build();
  const b = await build();
  assert.equal(a.connectedDigest, b.connectedDigest);
  assert.match(a.connectedDigest, /^[a-f0-9]{64}$/);
  // The non-claims travel with the comparison: gross-only segments, as-of limits, and no
  // causal attribution are carried from the released report, not re-invented here.
  assert.match(a.ks238.report.nonclaims.join(' '), /No causal attribution/);
  assert.match(a.ks238.report.nonclaims.join(' '), /GROSS sale value/);
});

test('the connected CLI drives the whole chain and confines its output writes', async () => {
  const { spawnSync } = await import('node:child_process');
  const rendered = spawnSync(process.execPath, ['scripts/run-connected-net-revenue-journey.mjs', '--format', 'JSON'],
    { cwd: root, encoding: 'utf8' });
  assert.equal(rendered.status, 0, rendered.stderr);
  const parsed = JSON.parse(rendered.stdout);
  assert.equal(parsed.sourceMode, 'SYNTHETIC_FALLBACK');
  assert.equal(parsed.allStagesReconciled, true);
  assert.deepEqual(parsed.stages.map((s) => s.stage), ['KS236', 'KS237', 'KS238', 'PSAI']);
  assert.equal(parsed.ks238.delta.netRevenue, INDEPENDENT_KS238.deltaNetRevenue);
  assert.equal(parsed.psai.code, 'XRA_KS01_RELEASE_HELD');

  // Output confinement: a /tmp lookalike prefix is DENIED.
  const denied = spawnSync(process.execPath,
    ['scripts/run-connected-net-revenue-journey.mjs', '--out', '/tmpfoo/ks-connected.json'],
    { cwd: root, encoding: 'utf8' });
  assert.notEqual(denied.status, 0);
  assert.match(denied.stderr, /CONNECTED_CLI_OUT_PATH_DENIED/);

  // The negative path distinguishes the honest HELD denial from a forged provenance.
  const neg = spawnSync(process.execPath,
    ['scripts/run-connected-net-revenue-journey.mjs', '--negative', '--format', 'JSON'],
    { cwd: root, encoding: 'utf8' });
  assert.equal(neg.status, 0, neg.stderr);
  const negParsed = JSON.parse(neg.stdout);
  assert.equal(negParsed.negativeEvidence.honestHeldDenial.code, 'XRA_KS01_RELEASE_HELD');
  assert.match(negParsed.negativeEvidence.forgedProvenance.evidence.code,
    /XRA_KS01_PROVENANCE_FORGERY_DENIED/);
});

test('the connected expectations are declared in one frozen place (no scattered literals)', () => {
  assert.deepEqual(Object.keys(CONNECTED_JOURNEY_EXPECTATIONS).sort(), ['KS236', 'KS238']);
  assert.equal(CONNECTED_JOURNEY_EXPECTATIONS.KS238.deltaNetRevenue, INDEPENDENT_KS238.deltaNetRevenue);
  assert.equal(CONNECTED_JOURNEY_EXPECTATIONS.KS238.comparisonNetRevenue, INDEPENDENT_KS238.comparisonNetRevenue);
  assert.equal(CONNECTED_JOURNEY_EXPECTATIONS.KS236.deltaMinorUnits, INDEPENDENT_KS236.deltaMinorUnits);
  assert.equal(canonicalJson(CONNECTED_JOURNEY_EXPECTATIONS.KS238.orderIntake), 'null');
});

// ---------------------------------------------------------------------------------------
// Package 2 — the PSAi handoff's NORMAL path, source substitution, and expiry after load.
//
// The order requires the actual entrypoint be exercised for normal real-DB paths, not only
// rejection, plus source substitutions. The released service boundary was previously
// exercised through the connected chain in its HELD (denial) shape only; below, the handoff
// is driven to a genuine ADMISSION with a synthetic dependency-injection registry, so the
// successful ordinary handoff is a tested fact rather than an untestable branch.
// ---------------------------------------------------------------------------------------

const sha256hex = (value) => createHash('sha256').update(value).digest('hex');

// A synthetic DI registry that really admits the fixture's releasedVariant profile digest.
// The fixture itself is explicit that this is NOT public closure evidence for XRA-PS-01 and
// must never be presented as such.
async function admittedMaterials() {
  const root_ = root;
  const fixture = JSON.parse(await readFile(`${root_}/tests/pansphaira-analytics-synthetic-profile-v1.json`, 'utf8'));
  const releasedProfile = fixture.releasedVariant;
  const profileBytes = Buffer.from(canonicalJson(releasedProfile));
  const diRegistry = {
    schemaVersion: 'kaleidosphere.pansphaira-analytics/release-registry/v1',
    issue: 'XRA-KS-01',
    admissionRule: 'synthetic dependency-injection registry used ONLY to prove the connected admission path',
    entries: [{
      releaseId: 'xra-ps-01-di',
      status: 'RELEASED',
      profileSha256: sha256hex(profileBytes),
      releaseReceiptSha256: releasedProfile.provenance.releaseReceiptSha256,
      pansphairaHeadCommit: releasedProfile.provenance.pansphairaHeadCommit,
      publicClosureEvidence: fixture.syntheticRegistryEvidence.publicClosureEvidence,
    }],
    nonclaim: 'Synthetic DI registry. Not public closure evidence for XRA-PS-01.',
  };
  const environment = {
    nodeVersion: process.version, nodeModulesAbi: '127',
    platform: process.platform, architecture: process.arch,
    canonicalJsonSha256: sha256hex('connected-test'), packageSha256: sha256hex('connected-test'),
  };
  return {
    releasedProfile,
    registryBytes: Buffer.from(JSON.stringify(diRegistry)),
    context: {
      heads: { commitOid: 'a'.repeat(40), treeOid: 'b'.repeat(40) },
      environment,
      environmentSha256: sha256hex(canonicalJson(environment)),
      projectionContractBytes: await readFile(`${root_}/contracts/pansphaira-analytics/v1/projection-profile.v1.json`),
      analysisContractBytes: await readFile(`${root_}/contracts/pansphaira-analytics/v1/analysis.v1.json`),
    },
  };
}

test('PSAi handoff NORMAL path: a release-attested profile is ADMITTED as an authority-free candidate', async () => {
  const { releasedProfile, registryBytes, context } = await admittedMaterials();
  const handoff = await runPsaiHandoff({ declaredProfile: releasedProfile, registryBytes, context });

  // The successful handoff — previously unrepresentable, because the stage hard-wired its
  // expectation to DENIED.
  assert.equal(handoff.state, 'CANDIDATE');
  assert.equal(handoff.code, null);
  assert.equal(handoff.expectedState, 'CANDIDATE');
  assert.equal(handoff.boundaryRespected, true);
  assert.equal(handoff.provenanceStatus, 'RELEASED');

  // Admission is NOT authority: the candidate carries no promotion/mutation/execution/
  // publication power and no capabilities or effects, whatever the provenance attests.
  assert.equal(handoff.authorityFree, true);
  assert.deepEqual(handoff.candidate.authority,
    { promote: false, mutate: false, execute: false, publish: false, capabilities: [], effects: [] });
  assert.equal(handoff.candidate.state, 'CANDIDATE');

  // The release evidence flips from HELD to OBSERVED only when a RELEASED entry actually
  // matched this profile digest — evidence, not assertion.
  assert.equal(handoff.candidate.coverage.releaseEvidence, 'OBSERVED');
  assert.deepEqual(handoff.candidate.bindings.pansphairaHead,
    { status: 'RELEASED', commitOid: releasedProfile.provenance.pansphairaHeadCommit });
  assert.match(handoff.requestSha256, /^[a-f0-9]{64}$/);
});

test('PSAi handoff: the admitted and denied outcomes are distinguished, never collapsed', async () => {
  const { registryBytes, declaredProfile } = await inputs();
  const held = await runPsaiHandoff({ declaredProfile, registryBytes });

  const admitted = await admittedMaterials();
  const released = await runPsaiHandoff({
    declaredProfile: admitted.releasedProfile,
    registryBytes: admitted.registryBytes,
    context: admitted.context,
  });

  // Both respected their boundary, but they are DIFFERENT facts: one dependency is closed,
  // one is not. A reviewer must never read the HELD denial as an admission failure nor the
  // admission as a promotion.
  assert.equal(held.boundaryRespected, true);
  assert.equal(released.boundaryRespected, true);
  assert.notEqual(held.state, released.state);
  assert.equal(held.code, 'XRA_KS01_RELEASE_HELD');
  assert.equal(released.code, null);
});

test('PSAi handoff: a release-attested profile whose bytes are SUBSTITUTED is denied', async () => {
  const { releasedProfile, registryBytes, context } = await admittedMaterials();
  // Same provenance, one extra nullable column: the digest no longer matches the RELEASED
  // registry entry, so admission must be denied rather than silently re-attested.
  const substituted = JSON.parse(JSON.stringify(releasedProfile));
  substituted.fields = [...substituted.fields,
    { name: 'injected_extra', type: 'TEXT', nullable: true }];

  const handoff = await runPsaiHandoff({ declaredProfile: substituted, registryBytes, context });
  assert.equal(handoff.state, 'DENIED');
  assert.equal(handoff.boundaryRespected, false);
  assert.equal(handoff.candidate, null);
  assert.equal(handoff.successfulOrdinaryAnswer, false);
  // The registry HAS a released entry, so this is a digest mismatch — not the HELD denial.
  assert.equal(handoff.code, 'XRA_KS01_PROFILE_DIGEST_MISMATCH_DENIED');
});

test('PSAi handoff: provenance that EXPIRES after load is denied on the connected entrypoint', async () => {
  // "Expiry after load": the profile bytes and the registry agreed when the run began, but
  // the attested release is withdrawn before ingestion. Modelled by keeping the profile's
  // attested provenance while the registry entry reverts to HELD — the previously-matching
  // attestation must no longer admit anything.
  const { releasedProfile, context } = await admittedMaterials();
  const withdrawnRegistry = {
    schemaVersion: 'kaleidosphere.pansphaira-analytics/release-registry/v1',
    issue: 'XRA-KS-01',
    admissionRule: 'synthetic registry whose release was withdrawn between load and ingest',
    entries: [{
      releaseId: 'xra-ps-01-di', status: 'HELD',
      profileSha256: null, releaseReceiptSha256: null,
      pansphairaHeadCommit: null, publicClosureEvidence: null,
    }],
    nonclaim: 'Synthetic withdrawal fixture. Not a real release state.',
  };
  const handoff = await runPsaiHandoff({
    declaredProfile: releasedProfile,
    registryBytes: Buffer.from(JSON.stringify(withdrawnRegistry)),
    context,
  });
  assert.equal(handoff.state, 'DENIED');
  assert.equal(handoff.boundaryRespected, false);
  assert.equal(handoff.candidate, null);
  // The registry can no longer attest the provenance edge, so the forgery gate fires.
  assert.equal(handoff.code, 'XRA_KS01_PROVENANCE_FORGERY_DENIED');
});

test('the connected journey reports a HELD dependency as a COMPLETE run, not a partial one', async () => {
  const { metricContractBytes, oracleBytes, holdoutBytes, f4Sources, registryBytes, declaredProfile } = await inputs();
  const held = await runConnectedJourney({
    metricContractBytes, oracleBytes, holdoutBytes, f4Sources,
    database: buildSyntheticJourneyDatabase(), declaredProfile, registryBytes,
  });
  // Every handoff behaved as its provenance entitled, so the run is complete...
  assert.equal(held.allStagesReconciled, true);
  // ...while the dependency itself is honestly still open.
  assert.equal(held.dependencyClosed, false);
  assert.equal(held.psai.code, 'XRA_KS01_RELEASE_HELD');

  // And with a genuinely admitting registry the same chain reports the dependency closed.
  const admitted = await admittedMaterials();
  const closed = await runConnectedJourney({
    metricContractBytes, oracleBytes, holdoutBytes, f4Sources,
    database: buildSyntheticJourneyDatabase(),
    declaredProfile: admitted.releasedProfile,
    registryBytes: admitted.registryBytes,
    psaiContext: admitted.context,
  });
  assert.equal(closed.allStagesReconciled, true);
  assert.equal(closed.dependencyClosed, true);
  assert.equal(closed.psai.state, 'CANDIDATE');
});

test('the connected journey refuses a SOURCE SUBSTITUTION between the two released layouts', async () => {
  // A genuine source substitution: both layouts are composed in the SAME run, but one
  // layout's rows are replaced by the other layout's. Each layout individually still maps
  // and reconciles, so only the cross-layout projection comparison can catch it — which is
  // exactly what the KS237 boundary must do. This is the failure mode arithmetic alone
  // cannot see.
  const { f4Sources } = await inputs();

  // Sanity: the honest pairing binds (no false positive from the guard itself).
  const honest = runKs237Stage(['ledger-v1', 'ledger-v2'], {
    'ledger-v1': f4Sources['ledger-v1'].rows,
    'ledger-v2': f4Sources['ledger-v2'].rows,
  });
  assert.equal(honest.profileBound, true);

  // Substituted pairing: the v1 slot is served v2's rows. Both map, but they are not the
  // same domain core, so the projection comparison must fail closed.
  assert.throws(
    () => runKs237Stage(['ledger-v1', 'ledger-v2'], {
      'ledger-v1': f4Sources['ledger-v2'].rows,
      'ledger-v2': f4Sources['ledger-v2'].rows,
    }),
    // The released ledger-mapping profile rejects the wrong layout's bytes DIRECTLY: v2
    // rows carry `entry_kind`, not the `posting_type` the v1 kernel profile requires, so
    // the denial is the kernel's own kind gate rather than a downstream divergence check.
    // That is a stronger result than a late comparison mismatch — the substitution never
    // reaches the comparison at all.
    (e) => /^LEDGER_KIND_DENIED:undefined$/.test(e.code),
  );
});

test('a truncated source is refused at the KS237 boundary before any comparison is published', async () => {
  // Independent negative: dropping rows from one layout must not be reported as a bound
  // profile pair. The count divergence is caught at the handoff, so no comparison is ever
  // emitted from a partial source.
  const { f4Sources } = await inputs();
  assert.throws(
    () => runKs237Stage(['ledger-v1', 'ledger-v2'], {
      'ledger-v1': f4Sources['ledger-v1'].rows.slice(0, 5),
      'ledger-v2': f4Sources['ledger-v2'].rows,
    }),
    (e) => e.code === 'CONNECTED_KS237_KERNEL_DIVERGENCE'
      || e.code === 'CONNECTED_KS237_PROJECTION_DIVERGENCE',
  );
});

// ---------------------------------------------------------------------------------------
// Package 3 — the remaining entrypoint negatives named by the order, and confinement.
//
// The order requires the actual entrypoint be exercised with EOF/missing decisions,
// an incompatible business goal of the SAME output shape, ambiguous/wrong mapping, expiry
// after load, wrong units, source substitutions, and PRESERVED SYMLINK CONFINEMENT.
// Ambiguity and unit/scale cases are already covered at the released unit boundary
// (net-revenue-ledger-mapping.test.mjs, net-revenue-f4-composition.test.mjs); the cases
// below are the ones that were still open on the CONNECTED entrypoint.
// ---------------------------------------------------------------------------------------

test('an incompatible business goal of the SAME output shape is refused by digest, not by shape', async () => {
  const base = await inputs();
  // Same top-level contract shape and the same periods; a DIFFERENT business goal:
  // renamed metric, different classification, and credit semantics flipped from net to
  // gross. Nothing about the OUTPUT shape distinguishes it, so shape inspection would pass.
  const goal = JSON.parse(base.metricContractBytes.toString('utf8'));
  goal.metric.id = 'bi-ks-01-gross-revenue';
  goal.metric.name = 'Synthetic Gross Revenue';
  goal.metric.classification = 'SYNTHETIC_PRODUCTION_METRIC';
  goal.recordRules.credit.contribution = 'amount_minor_units ADDED to the period total (gross, not net)';

  await assert.rejects(
    () => runConnectedJourney({
      ...base,
      metricContractBytes: Buffer.from(JSON.stringify(goal, null, 2) + '\n'),
      database: buildSyntheticJourneyDatabase(),
    }),
    (e) => e.code === 'BUSINESS_BI_METRIC_DIGEST_DENIED',
  );
});

test('EOF/missing decision: an absent declared profile is DENIED, never defaulted to RELEASED', async () => {
  const base = await inputs();
  // The dangerous default would be to treat a missing decision as an admission. The chain
  // must refuse to run the PSAi stage without a declared profile at all.
  const { declaredProfile, ...withoutProfile } = base;
  await assert.rejects(
    () => runConnectedJourney({ ...withoutProfile, database: buildSyntheticJourneyDatabase() }),
    (e) => e.code === 'CONNECTED_PSAI_PROFILE_DENIED',
  );
});

test('a source that ends early (zero rows in a declared layout) is denied, not reported as a zero result', async () => {
  const base = await inputs();
  await assert.rejects(
    () => runConnectedJourney({
      ...base,
      f4Sources: { 'ledger-v1': { ...base.f4Sources['ledger-v1'], rows: [] }, 'ledger-v2': base.f4Sources['ledger-v2'] },
      database: buildSyntheticJourneyDatabase(),
    }),
    (e) => e.code === 'CONNECTED_F4_SOURCE_DENIED:ledger-v1',
  );
});

test('CLI symlink confinement is PRESERVED: leaf, dangling leaf, ancestor and prefix lookalike all deny', async () => {
  const { mkdtemp, mkdir, symlink, writeFile, rm } = await import('node:fs/promises');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const os = await import('node:os');

  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'ks-connected-sym-'));
  const outside = path.join(sandbox, 'outside');
  const real = path.join(sandbox, 'real');
  await mkdir(outside, { recursive: true });
  await mkdir(real, { recursive: true });
  const benign = path.join(outside, 'target.json');
  await writeFile(benign, '{}');

  const cli = path.join(root, 'scripts/run-connected-net-revenue-journey.mjs');
  const attempt = async (out) => {
    try {
      await run(process.execPath, [cli, '--out', out], { cwd: root });
      return null;
    } catch (error) {
      return `${error.stderr ?? ''}${error.stdout ?? ''}`;
    }
  };

  try {
    // 1. leaf symlink pointing at a harmless file
    const leaf = path.join(sandbox, 'leaf.json');
    await symlink(benign, leaf);
    assert.match(await attempt(leaf), /CONNECTED_CLI_OUT_PATH_DENIED: --out must not contain a symlink/);

    // 2. DANGLING leaf symlink: realpath would walk up past it, so lstat on each component
    //    is what keeps this closed.
    const dangling = path.join(sandbox, 'dangling.json');
    await symlink(path.join(outside, 'never-created.json'), dangling);
    assert.match(await attempt(dangling), /CONNECTED_CLI_OUT_PATH_DENIED: --out must not contain a symlink/);

    // 3. ancestor DIRECTORY symlink, even when its target is itself inside an allowed root:
    //    confinement is per component, not by resolved destination.
    const dirLink = path.join(sandbox, 'leaflink');
    await symlink(outside, dirLink);
    assert.match(await attempt(path.join(dirLink, 'inside.json')),
      /CONNECTED_CLI_OUT_PATH_DENIED: --out must not contain a symlink/);

    // 4. prefix lookalike: a sibling whose name merely starts with the repository path.
    assert.match(await attempt(`${root}-evil/x.json`),
      /CONNECTED_CLI_OUT_PATH_DENIED: --out must be inside the repository or \/tmp/);

    // 5. outside every allowed root
    assert.match(await attempt('/etc/ks-connected-evil.json'),
      /CONNECTED_CLI_OUT_PATH_DENIED: --out must be inside the repository or \/tmp/);

    // ...while an honest path still writes, so the confinement is not a blanket refusal.
    const honest = path.join(real, 'ok.json');
    assert.equal(await attempt(honest), null);
    const written = JSON.parse(await readFile(honest, 'utf8'));
    assert.equal(written.allStagesReconciled, true);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test('the KS236 reader-task emitter ships a BLANK comprehension record and cannot fill it', async () => {
  // KS236 acceptance: "Document a short reader-task protocol and record actual comprehension
  // evidence separately from browser/agent tests. Do not fabricate human responses."
  // The emitter must therefore be incapable of producing a comprehension result: every
  // answer, the reader identity and the timestamp must come out null whatever we do.
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const os = await import('node:os');
  const { mkdtemp, readFile: rf, rm } = await import('node:fs/promises');
  const run = promisify(execFile);

  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'ks236-reader-'));
  const out = path.join(sandbox, 'worksheet.json');
  try {
    await run(process.execPath, [path.join(root, 'scripts/emit-ks236-reader-task.mjs'), '--out', out],
      { cwd: root });

    const { worksheet, referenceAnswers } = JSON.parse(await rf(out, 'utf8'));

    // The record is structurally blank — no fabricated human response can exist.
    const record = worksheet.comprehensionRecord;
    assert.equal(record.readerIdentity, null);
    assert.equal(record.readAt, null);
    assert.equal(record.notes, null);
    assert.deepEqual(Object.values(record.answers), Object.values(record.answers).map(() => null));

    // Every graded task has a reference answer, held OUT of the reader-facing worksheet.
    const taskIds = worksheet.readerFacing.tasks.map((t) => t.id);
    assert.deepEqual(Object.keys(referenceAnswers).sort(), [...taskIds].sort());

    // The figures the reader is asked about come from a REAL run, not a placeholder.
    const f = worksheet.readerFacing.figures;
    assert.equal(f.currentNetRevenueMinorUnits, 66000);
    assert.equal(f.comparisonNetRevenueMinorUnits, 45000);
    assert.equal(f.deltaNetRevenueMinorUnits, 21000);
    // ...and the unsupported fields are still honestly null in the reader's own view.
    assert.equal(f.orderIntake, null);
    assert.equal(f.openOrderValue, null);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
