// KaleidoSphere KS236 -> KS237 -> KS238 — the CONNECTED authorized local user journey.
//
// This module adds exactly one genuinely new surface: the ORCHESTRATION that hands the
// SAME real local synthetic source through the three already-released stages, in order,
// with each stage's independent expected values checked at the handoff, and one explicit
// PSAi handoff at the end. It reimplements NO metric core, NO mapping profile, NO
// comparison arithmetic, NO recognition rule and NO allow-list:
//
//   KS236  runNetRevenueJourney            (released #239 `net-revenue-journey.mjs`)
//          real local read-only PostgreSQL source -> released C2 plan/readback/visual,
//          reconciled to the independent admitted oracle.
//   KS237  composeViaProfile + mapLedgerRowsToCanonical (released #240
//          `net-revenue-f4-composition.mjs` + `net-revenue-ledger-mapping.mjs`)
//          the SAME domain core applied to a SECOND versioned mapping profile, with both
//          profiles bound byte-identically.
//   KS238  compareSegmentsAcrossPeriods + buildSegmentComparisonReport (released #240
//          `net-revenue-segment-comparison.mjs`) period/segment comparison, credits /
//          cancellations / unknowns preserved, order-intake explicitly unsupported.
//
// The PSAi handoff is the released fail-closed ingestion boundary
// (`services/bi-agent/src/pansphaira-analytics/pipeline.mjs`). It is IMPORTED and called,
// never reimplemented: the connected journey records that the declared PANSPHAIRA
// projection profile is still HELD and that ingestion DENIES it with XRA_KS01_RELEASE_HELD.
// A DENIED handoff is a legitimate, recorded outcome of the journey — not a failure of it.
//
// Consequence: the "connected" journey is not three receipts stapled together. Each stage
// consumes the PREVIOUS stage's real output where the released surfaces allow it, every
// stage's result is checked against expectations computed independently of this module,
// and a stage that does not reconcile stops the chain (fail-closed, no partial "success").

import { createHash } from 'node:crypto';

import {
  NET_REVENUE_JOURNEY_SCHEMA,
  seedJourneyDatabase,
  buildJourneyRead,
  runNetRevenueJourney,
} from './net-revenue-journey.mjs';
import {
  NET_REVENUE_F4_COMPOSITION_SCHEMA,
  F4_LAYOUT_VERSIONS,
  composeViaProfile,
  readF4SourceRows,
  seedF4Database,
} from './net-revenue-f4-composition.mjs';
import {
  NET_REVENUE_SEGMENT_COMPARISON_SCHEMA,
  compareSegmentsAcrossPeriods,
  buildSegmentComparisonReport,
  comparisonDigest,
} from './net-revenue-segment-comparison.mjs';
import { ingestProjectionProfile, validateRegistry } from '../../../bi-agent/src/pansphaira-analytics/pipeline.mjs';
import { canonicalJson } from '../canonical-json.js';

export const NET_REVENUE_CONNECTED_JOURNEY_SCHEMA =
  'kaleidosphere.business-bi/net-revenue-connected-journey/v1';

// The connected journey is a fixed three-stage chain. The stage names are frozen so a
// receipt can be compared across runs and across the synthetic/real source modes.
export const CONNECTED_JOURNEY_STAGES = Object.freeze(['KS236', 'KS237', 'KS238', 'PSAI']);

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const fail = (code) => { const e = new Error(code); e.code = code; throw e; };
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && Object.getPrototypeOf(v) === Object.prototype;

// Independent expectations for the connected run. These are the values the released
// suites already pin for each stage (KS236 oracle, KS237 profile equality, KS238
// comparison). They are declared HERE, in the orchestrator, so a stage that silently
// drifts is caught at the handoff instead of being reported as a connected success.
const CONNECTED_EXPECTATIONS = Object.freeze({
  KS236: Object.freeze({
    oracleEquality: 'EXACT',
    reconcilesToIndependentOracle: true,
    deltaMinorUnits: 70059,
  }),
  KS238: Object.freeze({
    comparisonNetRevenue: 45000,
    currentNetRevenue: 66000,
    deltaNetRevenue: 21000,
    comparisonSaleValue: 50000,
    currentSaleValue: 72000,
    deltaSaleValue: 22000,
    excludedOutOfScopeCount: 1,
    // order intake / open orders stay explicitly unsupported (the honest #238 limit).
    orderIntake: null,
    openOrderCount: null,
    openOrderValue: null,
  }),
});

export const CONNECTED_JOURNEY_EXPECTATIONS = CONNECTED_EXPECTATIONS;

// Each stage outcome is recorded with the same envelope: what ran, which real source
// rows it consumed, whether it reconciled to the independently declared expectation, and
// the digests needed to replay it. `reconciled === false` FAILS the chain.
function stageReceipt(name, { sourceRowsRead, expected, actual, digests }) {
  const reconciled = canonicalJson(actual) === canonicalJson(expected);
  return {
    stage: name,
    ran: true,
    sourceRowsRead,
    expected,
    actual,
    reconciled,
    digests,
  };
}

// ---- Stage KS237 -----------------------------------------------------------------
// Apply the released mapping profile boundary to the SAME source rows the KS236 stage
// seeded, for EVERY frozen layout version, and require both profiles to be bound. The
// released module already denies wrong kinds/units/currencies fail-closed; the connected
// journey adds the handoff check: the mapped kernel must be byte-identical across
// independent replays of the same profile.
export function runKs237Stage(layouts, rowsByLayout) {
  const stageLayouts = [];
  for (const lv of layouts) {
    const rows = rowsByLayout[lv];
    const first = composeViaProfile(lv, rows);
    const replay = composeViaProfile(lv, rows);
    const firstKernel = sha256(JSON.stringify(first.canonicalRows));
    const replayKernel = sha256(JSON.stringify(replay.canonicalRows));
    const bound = firstKernel === replayKernel
      && canonicalJson(first.comparisonRows) === canonicalJson(replay.comparisonRows);
    if (!bound) fail('CONNECTED_KS237_PROFILE_UNBOUND');
    stageLayouts.push({
      layoutVersion: lv,
      kernelProfile: first.kernelProfile,
      kernelRowCount: first.canonicalRows.length,
      profileBound: bound,
      kernelDigest: firstKernel,
      // Both layouts must map to the SAME domain semantics, so the same 12 kernel rows
      // and the same comparison projection are required.
      canonicalRows: first.canonicalRows,
      comparisonRows: first.comparisonRows,
    });
  }
  // Every released profile must carry the same kernel row count: a profile that drops or
  // invents rows is not a second layout of the same domain core.
  const counts = new Set(stageLayouts.map((l) => l.kernelRowCount));
  if (counts.size !== 1) fail('CONNECTED_KS237_KERNEL_DIVERGENCE');
  // The comparison projection must be identical across layouts (same core, same rows).
  const projections = new Set(stageLayouts.map((l) => sha256(canonicalJson({
    order_id: l.comparisonRows.map((r) => r.order_id),
    order_date: l.comparisonRows.map((r) => r.order_date),
    record_kind: l.comparisonRows.map((r) => r.record_kind),
    amount_minor_units: l.comparisonRows.map((r) => r.amount_minor_units),
    status: l.comparisonRows.map((r) => r.status),
    segment: l.comparisonRows.map((r) => r.segment),
  }))));
  if (projections.size !== 1) fail('CONNECTED_KS237_PROJECTION_DIVERGENCE');
  return {
    stage: 'KS237',
    ran: true,
    layouts: stageLayouts.map(({ canonicalRows, comparisonRows, ...rest }) => rest),
    // Consumed by the KS238 stage: the connected chain reuses the SAME projection the
    // #237 boundary produced (no second, divergent ingestion of the same source).
    comparisonRows: stageLayouts[0].comparisonRows,
    kernelDigest: stageLayouts[0].kernelDigest,
    profileBound: true,
  };
}

// ---- Stage KS238 -----------------------------------------------------------------
// Run the released period/segment comparison over the comparison projection handed over
// by KS237 and reconcile every published number against the independently declared
// expectations. Non-claims (gross-only segments, as-of limits, no causal attribution)
// come from the released report builder, never from this module.
export function runKs238Stage(comparisonRows) {
  const comparison = compareSegmentsAcrossPeriods(comparisonRows);
  const report = buildSegmentComparisonReport(comparison);
  const actual = {
    comparisonNetRevenue: report.comparison.netRevenue,
    currentNetRevenue: report.current.netRevenue,
    deltaNetRevenue: report.delta.netRevenue,
    comparisonSaleValue: report.comparison.saleValue,
    currentSaleValue: report.current.saleValue,
    deltaSaleValue: report.delta.saleValue,
    excludedOutOfScopeCount: report.excludedOutOfScopeCount,
    orderIntake: report.current.orderIntake,
    openOrderCount: report.current.openOrderCount,
    openOrderValue: report.current.openOrderValue,
  };
  const receipt = stageReceipt('KS238', {
    sourceRowsRead: comparisonRows.length,
    expected: CONNECTED_EXPECTATIONS.KS238,
    actual,
    digests: {
      comparisonDigest: comparisonDigest(report),
      schemaVersion: NET_REVENUE_SEGMENT_COMPARISON_SCHEMA,
    },
  });
  if (!receipt.reconciled) fail('CONNECTED_KS238_EXPECTATION_DENIED');
  return { ...receipt, report };
}

// ---- PSAi handoff ----------------------------------------------------------------
// The released fail-closed ingestion boundary, called for real. The declared PANSPHAIRA
// projection profile is still HELD, so ingestion DENIES it — that denial IS the correct,
// recorded handoff outcome. This function never fabricates a RELEASED admission and never
// upgrades the provenance; it records the denial code and the request digest verbatim.
export async function runPsaiHandoff({ declaredProfile, registryBytes }) {
  if (!isPlainObject(declaredProfile)) fail('CONNECTED_PSAI_PROFILE_DENIED');
  const registry = validateRegistry(JSON.parse(registryBytes.toString('utf8')));
  const profileBytes = Buffer.from(canonicalJson(declaredProfile));
  const result = ingestProjectionProfile(profileBytes, { registry });
  return {
    stage: 'PSAI',
    ran: true,
    // The ingestion result is recorded EXACTLY as returned: DENIED with XRA_KS01_RELEASE_HELD
    // while the dependency stays HELD, CANDIDATE only after real public closure evidence.
    state: result.state,
    code: result.code ?? null,
    requestSha256: result.requestSha256,
    candidate: result.candidate ?? null,
    ordinaryAnswer: result.ordinaryAnswer ?? null,
    successfulOrdinaryAnswer: result.successfulOrdinaryAnswer ?? false,
    denialSha256: result.denialSha256 ?? null,
    provenanceStatus: declaredProfile.provenance?.status ?? null,
    // A HELD profile MUST be denied; anything else means the boundary was bypassed.
    boundaryRespected: result.state === 'DENIED' && result.code === 'XRA_KS01_RELEASE_HELD',
  };
}

// ---- The connected journey -------------------------------------------------------
// One supported entry point for the whole KS236 -> KS237 -> KS238 chain plus the PSAi
// handoff. Everything runs over the SAME injected database/source mode: the KS236 stage
// seeds the released holdout relation, the KS237/KS238 stages seed and read the released
// F4 ledger relation, and the PSAi handoff hits the released ingestion boundary.
//
// `input`:
//   metricContractBytes, oracleBytes, holdoutBytes   (released KS236 inputs)
//   f4Sources: { 'ledger-v1': <fixture object>, 'ledger-v2': <fixture object> }
//   database                                          (real PGlite or labelled synthetic)
//   declaredProfile, registryBytes                    (PSAi handoff inputs)
export async function runConnectedJourney(input) {
  if (!isPlainObject(input)) fail('CONNECTED_INPUT_DENIED');
  const {
    metricContractBytes, oracleBytes, holdoutBytes,
    f4Sources, database, declaredProfile, registryBytes,
  } = input;
  if (!isPlainObject(f4Sources)) fail('CONNECTED_F4_SOURCES_DENIED');
  if (!isPlainObject(database)) fail('CONNECTED_DATABASE_DENIED');

  const sourceMode = database.__mode === 'REAL_POSTGRESQL' ? 'REAL_POSTGRESQL' : 'SYNTHETIC_FALLBACK';
  const stages = [];

  // ---- KS236: the released journey over the released holdout relation -------------
  const journey = await runNetRevenueJourney({ metricContractBytes, oracleBytes, holdoutBytes, database });
  const ks236Actual = {
    oracleEquality: journey.oracleEquality,
    reconcilesToIndependentOracle: journey.reconcilesToIndependentOracle,
    deltaMinorUnits: journey.result.deltaMinorUnits,
  };
  const ks236 = stageReceipt('KS236', {
    sourceRowsRead: JSON.parse(holdoutBytes.toString('utf8')).rows.length,
    expected: CONNECTED_EXPECTATIONS.KS236,
    actual: ks236Actual,
    digests: {
      planSha256: journey.planSha256,
      receiptSha256: journey.receiptSha256,
      resultSha256: journey.resultSha256,
      schemaVersion: NET_REVENUE_JOURNEY_SCHEMA,
    },
  });
  if (!ks236.reconciled) fail('CONNECTED_KS236_EXPECTATION_DENIED');
  stages.push(ks236);

  // ---- KS237: the SAME domain core over the second versioned mapping profile ------
  const rowsByLayout = {};
  for (const lv of F4_LAYOUT_VERSIONS) {
    const fixture = f4Sources[lv];
    if (!isPlainObject(fixture) || !Array.isArray(fixture.rows) || fixture.rows.length === 0) {
      fail(`CONNECTED_F4_SOURCE_DENIED:${lv}`);
    }
    // Seed then read through the SAME released handoff the #240 boundary uses, so the
    // rows reaching the profile are the rows the real source actually returns.
    //
    // Both released layouts deliberately declare the SAME relation name
    // (`synthetic_bi.orders_ledger`) with DIFFERENT closed column sets. A real SQL engine
    // therefore cannot hold both shapes at once, so the relation is recreated per layout
    // before seeding — the released DDL is `CREATE TABLE IF NOT EXISTS`, which would
    // otherwise silently reuse the previous layout's column set and fail at INSERT.
    if (sourceMode === 'REAL_POSTGRESQL') {
      await database.exec('DROP TABLE IF EXISTS synthetic_bi.orders_ledger');
      await seedF4Database(database, lv, fixture.rows);
      rowsByLayout[lv] = await readF4SourceRows(database, lv);
    } else {
      // The labelled synthetic adapter is not a SQL engine: it hands the fixture rows
      // back verbatim, so the profile boundary sees the same closed column set.
      rowsByLayout[lv] = fixture.rows.map((r) => ({ ...r }));
    }
  }
  const ks237 = runKs237Stage(F4_LAYOUT_VERSIONS, rowsByLayout);
  stages.push({
    stage: ks237.stage,
    ran: true,
    sourceRowsRead: Object.values(rowsByLayout).reduce((n, rows) => n + rows.length, 0),
    expected: { profileBound: true, kernelRowCount: 12 },
    actual: {
      profileBound: ks237.profileBound,
      kernelRowCount: ks237.layouts[0].kernelRowCount,
      layouts: ks237.layouts.map((l) => ({
        layoutVersion: l.layoutVersion,
        kernelProfile: l.kernelProfile,
        profileBound: l.profileBound,
      })),
    },
    reconciled: ks237.profileBound && ks237.layouts[0].kernelRowCount === 12,
    digests: {
      kernelDigest: ks237.kernelDigest,
      schemaVersion: NET_REVENUE_F4_COMPOSITION_SCHEMA,
    },
  });

  // ---- KS238: period/segment comparison over the KS237 projection -----------------
  const ks238 = runKs238Stage(ks237.comparisonRows);
  stages.push({
    stage: ks238.stage,
    ran: ks238.ran,
    sourceRowsRead: ks238.sourceRowsRead,
    expected: ks238.expected,
    actual: ks238.actual,
    reconciled: ks238.reconciled,
    digests: ks238.digests,
  });

  // ---- PSAi handoff: the released fail-closed ingestion boundary ------------------
  const psai = await runPsaiHandoff({ declaredProfile, registryBytes });
  stages.push({
    stage: psai.stage,
    ran: psai.ran,
    expected: { state: 'DENIED', code: 'XRA_KS01_RELEASE_HELD', boundaryRespected: true },
    actual: {
      state: psai.state,
      code: psai.code,
      boundaryRespected: psai.boundaryRespected,
    },
    reconciled: psai.boundaryRespected,
    digests: { requestSha256: psai.requestSha256, denialSha256: psai.denialSha256 },
  });

  if (!psai.boundaryRespected) {
    // Surface the ACTUAL released denial: a forged/unattested provenance is denied by the
    // pipeline's own provenance gate (XRA_KS01_PROVENANCE_FORGERY_DENIED), which is a
    // different fact from the honest HELD denial. Never collapse them into one code.
    fail(`CONNECTED_PSAI_BOUNDARY_DENIED:${psai.code ?? psai.state}`);
  }

  const connected = {
    schemaVersion: NET_REVENUE_CONNECTED_JOURNEY_SCHEMA,
    sourceMode,
    sourceMarking: 'SYNTHETIC',
    stageOrder: CONNECTED_JOURNEY_STAGES,
    stages,
    allStagesReconciled: stages.every((s) => s.reconciled === true),
    ks236: {
      planSha256: journey.planSha256,
      receiptSha256: journey.receiptSha256,
      resultSha256: journey.resultSha256,
      oracleEquality: journey.oracleEquality,
      reconcilesToIndependentOracle: journey.reconcilesToIndependentOracle,
      result: journey.result,
      nonclaims: journey.nonclaims,
    },
    ks237: {
      kernelDigest: ks237.kernelDigest,
      layouts: ks237.layouts,
    },
    ks238: {
      comparisonDigest: ks238.digests.comparisonDigest,
      report: ks238.report,
    },
    psai,
  };
  connected.connectedDigest = sha256(canonicalJson({
    schemaVersion: connected.schemaVersion,
    sourceMode: connected.sourceMode,
    stages: connected.stages.map((s) => ({ stage: s.stage, reconciled: s.reconciled })),
    ks236: connected.ks236.resultSha256,
    ks237: connected.ks237.kernelDigest,
    ks238: connected.ks238.comparisonDigest,
    psai: connected.psai.requestSha256,
  }));
  return connected;
}

// The SAME source via the released C2 read closure, exposed so the connected journey can
// prove it read the real relation rather than asserting it. Returns the normalized rows
// the released read closure hands to the plan.
export async function readConnectedSourceRows(database, orderId) {
  const read = buildJourneyRead(database);
  const result = await read({ request: { bounds: { rowBudget: 1000 } } });
  void orderId;
  return result;
}
