#!/usr/bin/env node
// KaleidoSphere KS236 (#KPI-USER-01) — reader-task PROTOCOL emitter.
//
// KS236 acceptance requires: "Document a short reader-task protocol and record actual
// comprehension evidence separately from browser/agent tests. Do not fabricate human
// responses or claim the broader #167 promotion gate passed from automated tests."
//
// This script PREPARES the task. It emits (a) the reader's worksheet derived from the SAME
// real execution the journey performs, and (b) an EMPTY comprehension record whose slots a
// real human must fill. It deliberately cannot fill them: the record is emitted with every
// answer null, and the accompanying check fails closed if any answer is present without a
// declared reader identity and timestamp. Automated runs therefore cannot manufacture a
// comprehension result — they can only ship the blank form and the reference answers the
// reviewer is NOT shown.
//
//   node scripts/emit-ks236-reader-task.mjs [--pglite <dist/index.js>] [--out <path>]

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { runConnectedJourney } from '../services/bi-control/src/business-bi/net-revenue-connected-journey.mjs';
import {
  buildPgliteJourneyDatabase,
  buildSyntheticJourneyDatabase,
} from '../services/bi-control/src/business-bi/net-revenue-journey.mjs';
import { SYNTHETIC_SEGMENT_SOURCE } from '../services/bi-control/src/business-bi/net-revenue-segment-comparison.mjs';
import { canonicalJson } from '../services/bi-control/src/canonical-json.js';

const root = path.resolve(import.meta.dirname, '..');
const read = (p) => readFile(path.join(root, p));

const { values } = parseArgs({
  options: { pglite: { type: 'string' }, out: { type: 'string' } },
  allowPositionals: false, strict: true,
});

let database; let sourceMode;
if (values.pglite) {
  if (!path.isAbsolute(values.pglite)) throw new Error('KS236_READER_PGLITE_PATH_DENIED: must be absolute');
  const { PGlite } = await import(pathToFileURL(values.pglite).href);
  database = buildPgliteJourneyDatabase(new PGlite());
  sourceMode = 'REAL_POSTGRESQL';
} else {
  database = buildSyntheticJourneyDatabase();
  sourceMode = 'SYNTHETIC_FALLBACK';
}

const { extension, ...declaredProfile } = SYNTHETIC_SEGMENT_SOURCE;
const connected = await runConnectedJourney({
  metricContractBytes: await read('contracts/business-bi/v1/net-revenue.metric.json'),
  oracleBytes: await read('tests/fixtures/business-bi/net-revenue-oracle-v1.json'),
  holdoutBytes: await read('tests/fixtures/business-bi/net-revenue-holdout-v1.json'),
  f4Sources: {
    'ledger-v1': JSON.parse((await read('tests/fixtures/business-bi/net-revenue-f4-composition-v1.json')).toString('utf8')),
    'ledger-v2': JSON.parse((await read('tests/fixtures/business-bi/net-revenue-f4-composition-v2.json')).toString('utf8')),
  },
  database, declaredProfile,
  registryBytes: await read('contracts/pansphaira-analytics/v1/release-registry.v1.json'),
});

const report = connected.ks238.report;
const c = report.current;

// The reader sees ONLY the rendered figures — the same ones the journey publishes — and is
// asked to state the meaning in their own words. The reference answers below are held apart
// and are never printed into the worksheet.
const readerFacing = {
  question: 'How did synthetic net revenue in 2026-07 compare with 2026-06, and what in this result is NOT known?',
  sourceMode,
  figures: {
    currentPeriodLabel: '2026-07',
    currentNetRevenueMinorUnits: c.netRevenue,
    comparisonPeriodLabel: '2026-06',
    comparisonNetRevenueMinorUnits: report.comparison.netRevenue,
    deltaNetRevenueMinorUnits: report.delta.netRevenue,
    currency: 'EUR (integer minor units / cents)',
    unknownChannelCurrent: c.unknown,
    unknownChannelComparison: report.comparison.unknown,
    orderIntake: c.orderIntake,
    openOrderValue: c.openOrderValue,
    observedOpenSaleRowValue: c.observedOpenSaleRowValue,
  },
  tasks: [
    { id: 'T1', prompt: 'State, in one sentence, what this metric measures and in which unit.' },
    { id: 'T2', prompt: 'State which period is "current" and which is "comparison", with their date ranges.' },
    { id: 'T3', prompt: 'State the net-revenue delta and say whether attribute is a causal claim.' },
    { id: 'T4', prompt: 'Name every field in the result that is null, and say what the null means.' },
    { id: 'T5', prompt: 'Explain how UNKNOWN rows are treated: counted? quantified? added to net?' },
    { id: 'T6', prompt: 'Say whether cancel rows contribute to net revenue, and why.' },
    { id: 'T7', prompt: 'State whether these figures support a period-end open-order balance claim.' },
  ],
};

// Reference answers exist for GRADING ONLY. They are written to a separate file the reader
// is not given, so the worksheet cannot leak the expected phrasing.
const referenceAnswers = {
  T1: 'Sum of sale amounts minus credit amounts within a fixed calendar period, in integer EUR cents.',
  T2: 'Current = 2026-07 (2026-07-01..31), comparison = 2026-06 (2026-06-01..30), inclusive both ends.',
  T3: `Delta = ${report.delta.netRevenue} cents; it is arithmetic over the same rows and carries NO causal attribution.`,
  T4: 'orderIntake, openOrderCount and openOrderValue are null: no intake-event or historical status/as-of source exists.',
  T5: 'UNKNOWN is first-class: every unknown row is counted, every integer amount is quantified, and none is added to net.',
  T6: 'Cancel rows contribute exactly 0 to net; they are validated and counted as cancellations only.',
  T7: 'No. observedOpenSaleRow* describes in-window rows only and is never a period-end balance.',
};

const worksheet = {
  schemaVersion: 'kaleidosphere.business-bi/ks236-reader-task/v1',
  issue: 'KPI-USER-01 (#236)',
  provenance: 'Prepared from a real connected-journey execution. No human response is recorded here.',
  readerFacing,
  comprehensionRecord: {
    readerIdentity: null, readAt: null, sourceModeSeen: null,
    answers: Object.fromEntries(readerFacing.tasks.map((t) => [t.id, null])),
    notes: null,
  },
  honestyRule: 'A comprehension record is valid only when readerIdentity and readAt are set by a real reader. '
    + 'This emitter cannot satisfy that: it always writes null.',
};

const payload = JSON.stringify({ worksheet, referenceAnswers }, null, 2) + '\n';
if (values.out) {
  const resolved = path.resolve(values.out);
  if (!resolved.startsWith(root) && !resolved.startsWith('/tmp')) {
    throw new Error('KS236_READER_OUT_PATH_DENIED: --out must be inside the repository or /tmp');
  }
  await writeFile(resolved, payload);
  console.log(`KS236 reader-task worksheet written: ${resolved}`);
  console.log('comprehensionRecord is EMPTY by construction — a real reader must fill it.');
} else {
  process.stdout.write(payload);
}
