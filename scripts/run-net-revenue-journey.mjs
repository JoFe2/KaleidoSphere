#!/usr/bin/env node
// KaleidoSphere #236 — single supported entry point for the documented local
// net-revenue journey. Composes the existing C2 calculation/readback and the VIS-01
// visual into one run, against a real local read-only PostgreSQL source when a
// PGlite driver path is supplied, or a clearly-labelled synthetic fallback otherwise.
//
//   node scripts/run-net-revenue-journey.mjs [--pglite <dist/index.js path>]
//       [--format JSON|TABLE|HTML] [--negative]
//
// No credentials, network, mutation, or publish path. Writes only a local JSON
// receipt (zero public effect).

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { canonicalJson } from '../services/bi-control/src/canonical-json.js';
import {
  buildPgliteJourneyDatabase,
  buildSyntheticJourneyDatabase,
  readJourneySessionProof,
  attemptJourneyWriteRejection,
  runNetRevenueJourney,
} from '../services/bi-control/src/business-bi/net-revenue-journey.mjs';
import { projectNetRevenueVisualV1 } from '../services/bi-control/src/business-bi/net-revenue-visual-v1.mjs';

const root = path.resolve(import.meta.dirname, '..');
const METRIC = path.join(root, 'contracts/business-bi/v1/net-revenue.metric.json');
const ORACLE = path.join(root, 'tests/fixtures/business-bi/net-revenue-oracle-v1.json');
const HOLDOUT = path.join(root, 'tests/fixtures/business-bi/net-revenue-holdout-v1.json');

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

  if (!['JSON', 'TABLE', 'HTML'].includes(values.format)) {
    throw new Error('JOURNEY_CLI_FORMAT_DENIED: --format JSON|TABLE|HTML');
  }

  const [metricContractBytes, oracleBytes, holdoutBytes] = await Promise.all([
    readFile(METRIC),
    readFile(ORACLE),
    readFile(HOLDOUT),
  ]);

  let database;
  let sourceMode;
  if (values.pglite) {
    if (!path.isAbsolute(values.pglite)) {
      throw new Error('JOURNEY_CLI_PGLITE_PATH_DENIED: --pglite must be an absolute path to pglite/dist/index.js');
    }
    const { PGlite } = await import(pathToFileURL(values.pglite).href);
    const pg = new PGlite();
    database = buildPgliteJourneyDatabase(pg);
    sourceMode = 'REAL_POSTGRESQL';
  } else {
    database = buildSyntheticJourneyDatabase();
    sourceMode = 'SYNTHETIC_FALLBACK';
  }

  const journey = await runNetRevenueJourney({ metricContractBytes, oracleBytes, holdoutBytes, database });

  let negativeEvidence = null;
  if (values.negative) {
    const proof = await readJourneySessionProof(database);
    const rejection = await attemptJourneyWriteRejection(database);
    negativeEvidence = { sessionProof: proof, writeRejection: rejection };
  }

  let out;
  if (values.format === 'JSON') {
    out = `${canonicalJson({
      sourceMode,
      operationId: journey.operationId,
      oracleEquality: journey.oracleEquality,
      reconcilesToIndependentOracle: journey.reconcilesToIndependentOracle,
      planSha256: journey.planSha256,
      receiptSha256: journey.receiptSha256,
      readbackSha256: journey.readbackSha256,
      result: journey.result,
      readback: journey.readback,
      visual: journey.visual,
      negativeEvidence,
    })}\n`;
  } else if (values.format === 'TABLE') {
    out = journey.tableRendering;
  } else {
    out = journey.visualHtml;
  }

  process.stdout.write(out);

  if (values.out) {
    const resolved = path.resolve(values.out);
    if (!resolved.startsWith(`${root}${path.sep}`) && !resolved.startsWith('/tmp')) {
      throw new Error('JOURNEY_CLI_OUT_PATH_DENIED: --out must be inside the repository or /tmp');
    }
    await writeFile(resolved, out, { mode: 0o644 });
  }
} catch (error) {
  process.stderr.write(`${error.code ?? error.message}\n`);
  process.exitCode = 1;
}
