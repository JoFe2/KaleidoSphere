#!/usr/bin/env node
// KaleidoSphere KS236 -> KS237 -> KS238 — the CONNECTED local user journey CLI.
//
// One documented entry point that runs the whole chain over a REAL local synthetic
// PostgreSQL source when a PGlite driver path is supplied (or the labelled synthetic
// fallback otherwise), reconciles every stage against the independently declared
// expectations, and performs the released fail-closed PSAi handoff:
//
//   node scripts/run-connected-net-revenue-journey.mjs [--pglite <dist/index.js path>]
//       [--format JSON] [--negative] [--out <path>]
//
// No credentials, network, mutation, or publish path. Writes only a local JSON receipt
// (zero public effect). `--out` is confined to the repository or /tmp exactly like the
// released #240 CLI: no symlink component, no prefix lookalike, final open O_NOFOLLOW.

import { readFile, realpath, lstat, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import {
  runConnectedJourney,
  CONNECTED_JOURNEY_EXPECTATIONS,
} from '../services/bi-control/src/business-bi/net-revenue-connected-journey.mjs';
import {
  buildPgliteJourneyDatabase,
  buildSyntheticJourneyDatabase,
} from '../services/bi-control/src/business-bi/net-revenue-journey.mjs';
import { SYNTHETIC_SEGMENT_SOURCE } from '../services/bi-control/src/business-bi/net-revenue-segment-comparison.mjs';
import { canonicalJson } from '../services/bi-control/src/canonical-json.js';

const root = path.resolve(import.meta.dirname, '..');
const METRIC = path.join(root, 'contracts/business-bi/v1/net-revenue.metric.json');
const ORACLE = path.join(root, 'tests/fixtures/business-bi/net-revenue-oracle-v1.json');
const HOLDOUT = path.join(root, 'tests/fixtures/business-bi/net-revenue-holdout-v1.json');
const F4_V1 = path.join(root, 'tests/fixtures/business-bi/net-revenue-f4-composition-v1.json');
const F4_V2 = path.join(root, 'tests/fixtures/business-bi/net-revenue-f4-composition-v2.json');
const REGISTRY = path.join(root, 'contracts/pansphaira-analytics/v1/release-registry.v1.json');

// Same confinement contract as the released #240 CLI (kept identical on purpose: the
// connected journey must not widen the write surface it inherited).
async function assertAllowedOutputPath(out) {
  const resolved = path.resolve(out);
  const prefixes = [root, '/tmp'];
  const matchedNorm = prefixes.map((p) => (p.endsWith(path.sep) ? p.slice(0, -1) : p))
    .find((norm) => resolved === norm || resolved.startsWith(`${norm}${path.sep}`));
  if (!matchedNorm) throw new Error('CONNECTED_CLI_OUT_PATH_DENIED: --out must be inside the repository or /tmp');
  const realRoot = await realpath(matchedNorm).then((rp) => (rp.endsWith(path.sep) ? rp.slice(0, -1) : rp)).catch(() => null);
  if (realRoot === null) throw new Error('CONNECTED_CLI_OUT_PATH_DENIED: --out must be inside the repository or /tmp');
  const rel = resolved.slice(matchedNorm.length).split(path.sep).filter((c) => c !== '' && c !== '.');
  let walked = realRoot;
  for (const comp of rel) {
    const candidate = path.join(walked, comp);
    let st;
    try { st = await lstat(candidate); } catch { break; }
    if (st.isSymbolicLink()) throw new Error('CONNECTED_CLI_OUT_PATH_DENIED: --out must not contain a symlink');
    walked = candidate;
  }
  return resolved;
}

async function writeAtPathNoFollow(resolved, payload) {
  const fd = await open(resolved, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o644);
  try { await fd.writeFile(payload); } finally { await fd.close(); }
}

try {
  const { values } = parseArgs({
    options: {
      pglite: { type: 'string' },
      format: { type: 'string', default: 'JSON' },
      negative: { type: 'boolean', default: false },
      out: { type: 'string' },
    },
    allowPositionals: false,
    strict: true,
  });

  if (values.format !== 'JSON') throw new Error('CONNECTED_CLI_FORMAT_DENIED: only --format JSON');

  const [metricContractBytes, oracleBytes, holdoutBytes, f4v1, f4v2, registryBytes] = await Promise.all([
    readFile(METRIC), readFile(ORACLE), readFile(HOLDOUT),
    readFile(F4_V1), readFile(F4_V2), readFile(REGISTRY),
  ]);

  let database;
  let newDatabase;
  let sourceMode;
  if (values.pglite) {
    if (!path.isAbsolute(values.pglite)) throw new Error('CONNECTED_CLI_PGLITE_PATH_DENIED: --pglite must be an absolute path');
    const { PGlite } = await import(pathToFileURL(values.pglite).href);
    newDatabase = () => buildPgliteJourneyDatabase(new PGlite());
    database = newDatabase();
    sourceMode = 'REAL_POSTGRESQL';
  } else {
    newDatabase = () => buildSyntheticJourneyDatabase();
    database = newDatabase();
    sourceMode = 'SYNTHETIC_FALLBACK';
  }

  // The declared PANSPHAIRA projection profile is passed WITHOUT the local bounded
  // status/segment extension: those columns are this workspace's extension and are not
  // part of the reused PANSPHAIRA field contract.
  const { extension, ...declaredProfile } = SYNTHETIC_SEGMENT_SOURCE;

  const connected = await runConnectedJourney({
    metricContractBytes,
    oracleBytes,
    holdoutBytes,
    f4Sources: {
      'ledger-v1': JSON.parse(f4v1.toString('utf8')),
      'ledger-v2': JSON.parse(f4v2.toString('utf8')),
    },
    database,
    declaredProfile,
    registryBytes,
  });

  // `--negative` drives the SAME chain entry point with a deliberately forged "released"
  // provenance. The released provenance gate must deny it (forged evidence is never
  // admitted), keeping a tampered negative distinguishable from the honest HELD denial
  // of the positive path.
  let negativeEvidence = null;
  if (values.negative) {
    const forgedProfile = {
      ...declaredProfile,
      provenance: {
        ...declaredProfile.provenance,
        status: 'RELEASED',
        releaseReceiptSha256: 'f'.repeat(64),
        pansphairaHeadCommit: 'a'.repeat(40),
        closedAt: '2026-09-01',
      },
    };
    let scheme;
    try {
      await runConnectedJourney({
        metricContractBytes,
        oracleBytes,
        holdoutBytes,
        f4Sources: {
          'ledger-v1': JSON.parse(f4v1.toString('utf8')),
          'ledger-v2': JSON.parse(f4v2.toString('utf8')),
        },
        database: newDatabase(),
        declaredProfile: forgedProfile,
        registryBytes,
      });
      throw new Error('CONNECTED_NEGATIVE_EXPECTED_REJECTION_MISSING');
    } catch (error) {
      const code = error?.code ?? String(error?.message ?? error);
      if (code !== 'CONNECTED_PSAI_BOUNDARY_DENIED:XRA_KS01_PROVENANCE_FORGERY_DENIED') throw error;
      scheme = { stage: 'denied', evidence: { code } };
    }
    negativeEvidence = {
      forgedProvenance: scheme,
      // The honest path's denial (recorded in the positive run) stays visible next to it.
      honestHeldDenial: { code: connected.psai.code, state: connected.psai.state },
    };
  }

  const outJson = {
    schemaVersion: connected.schemaVersion,
    sourceMode,
    sourceMarking: connected.sourceMarking,
    stageOrder: connected.stageOrder,
    allStagesReconciled: connected.allStagesReconciled,
    dependencyClosed: connected.dependencyClosed,
    connectedDigest: connected.connectedDigest,
    expectations: CONNECTED_JOURNEY_EXPECTATIONS,
    stages: connected.stages.map((s) => ({
      stage: s.stage,
      // Explicit null, never an absent property: the released canonical serializer
      // rejects undefined object values, and a stage without a source read (PSAI) must
      // still appear as a present, comparable key.
      sourceRowsRead: s.sourceRowsRead ?? null,
      reconciled: s.reconciled,
      digests: s.digests,
    })),
    ks236: {
      planSha256: connected.ks236.planSha256,
      receiptSha256: connected.ks236.receiptSha256,
      resultSha256: connected.ks236.resultSha256,
      oracleEquality: connected.ks236.oracleEquality,
      reconcilesToIndependentOracle: connected.ks236.reconcilesToIndependentOracle,
      // The released C2 (#150) table readback and VIS-01 (#168) chart, surfaced so the
      // supported entry point actually shows calculation/readback/table/chart/details
      // rather than only digests. Nothing is re-rendered here.
      presentation: connected.ks236.presentation,
    },
    ks237: { kernelDigest: connected.ks237.kernelDigest, layouts: connected.ks237.layouts },
    ks238: {
      comparisonDigest: connected.ks238.comparisonDigest,
      comparison: connected.ks238.report.comparison,
      current: connected.ks238.report.current,
      delta: connected.ks238.report.delta,
      excludedOutOfScopeCount: connected.ks238.report.excludedOutOfScopeCount,
      nonclaims: connected.ks238.report.nonclaims,
    },
    psai: {
      state: connected.psai.state,
      code: connected.psai.code,
      requestSha256: connected.psai.requestSha256,
      boundaryRespected: connected.psai.boundaryRespected,
      provenanceStatus: connected.psai.provenanceStatus,
    },
    negativeEvidence,
  };

  process.stdout.write(`${canonicalJson(outJson)}\n`);
  if (values.out) {
    const resolved = await assertAllowedOutputPath(values.out);
    await writeAtPathNoFollow(resolved, `${canonicalJson(outJson)}\n`);
  }
} catch (error) {
  process.stderr.write(`${error.code ?? error.message}\n`);
  process.exitCode = 1;
}
