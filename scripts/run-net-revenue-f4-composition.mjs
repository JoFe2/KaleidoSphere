#!/usr/bin/env node
// KaleidoSphere #238 — positive local F4 composition CLI: one usable, documented entry
// point that reads a REAL local source, maps its kernel through the frozen #237 mapping
// profile, attaches the #238 status/segment extension, and runs the #238 period/segment
// comparison — normal AND negative paths through the same entry point.
//
//   node scripts/run-net-revenue-f4-composition.mjs [--pglite <dist/index.js path>]
//       [--layout ledger-v1|ledger-v2|both] [--format JSON] [--negative] [--out <path>]
//
// No credentials, network, mutation, or publish path. Writes only a local JSON receipt
// (zero public effect). `--out` is restricted to the repository or /tmp.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import {
  F4_LAYOUT_VERSIONS,
  AMBIGUOUS_UNITS_PROFILE,
  WRONG_SCALE_PROFILE,
  canonicalJson,
  composeF4ForLayout,
  readF4SourceRows,
  seedF4Database,
} from '../services/bi-control/src/business-bi/net-revenue-f4-composition.mjs';
import { buildPgliteJourneyDatabase } from '../services/bi-control/src/business-bi/net-revenue-journey.mjs';

const root = path.resolve(import.meta.dirname, '..');
const SOURCE_V1 = path.join(root, 'tests/fixtures/business-bi/net-revenue-f4-composition-v1.json');
const SOURCE_V2 = path.join(root, 'tests/fixtures/business-bi/net-revenue-f4-composition-v2.json');

function buildF4SyntheticDatabase(rows) {
  let store = rows.map((r) => ({ ...r }));
  return {
    __mode: 'SYNTHETIC_FALLBACK',
    async exec() { return { rows: [] }; },
    async query() { return { rows: store.map((r) => ({ ...r })) }; },
    async seedRows(next) { store = next.map((r) => ({ ...r })); },
  };
}

function capture(fn) {
  try { fn(); return null; }
  catch (error) {
    return { code: error?.code ?? String(error?.message ?? error), message: String(error?.message ?? error).slice(0, 160) };
  }
}

try {
  const { values } = parseArgs({
    options: {
      pglite: { type: 'string' },
      layout: { type: 'string', default: 'both' },
      format: { type: 'string', default: 'JSON' },
      negative: { type: 'boolean', default: false },
      out: { type: 'string' },
    },
    allowPositionals: false,
    strict: true,
  });

  if (values.format !== 'JSON') throw new Error('F4_CLI_FORMAT_DENIED: only --format JSON');
  if (!['ledger-v1', 'ledger-v2', 'both'].includes(values.layout)) {
    throw new Error('F4_CLI_LAYOUT_DENIED: --layout ledger-v1|ledger-v2|both');
  }
  const layouts = values.layout === 'both' ? F4_LAYOUT_VERSIONS : [values.layout];

  let newDatabase;
  let sourceMode;
  if (values.pglite) {
    if (!path.isAbsolute(values.pglite)) throw new Error('F4_CLI_PGLITE_PATH_DENIED: --pglite must be an absolute path');
    const { PGlite } = await import(pathToFileURL(values.pglite).href);
    newDatabase = () => buildPgliteJourneyDatabase(new PGlite());
    sourceMode = 'REAL_POSTGRESQL';
  } else {
    sourceMode = 'SYNTHETIC_FALLBACK';
  }

  const results = [];
  for (const lv of layouts) {
    const fixture = JSON.parse(await readFile(lv === 'ledger-v1' ? SOURCE_V1 : SOURCE_V2, 'utf8'));
    if (sourceMode === 'REAL_POSTGRESQL') {
      const db = newDatabase();
      await seedF4Database(db, lv, fixture.rows);
      const readBack = await readF4SourceRows(db, lv);
      results.push(composeF4ForLayout(lv, readBack, { sourceMode }));
    } else {
      const db = buildF4SyntheticDatabase(fixture.rows);
      results.push(composeF4ForLayout(lv, await readF4SourceRows(db, lv), { sourceMode }));
    }
  }

  let negativeEvidence = null;
  if (values.negative) {
    const lv = layouts[0];
    const kind = lv === 'ledger-v1' ? 'posting_type' : 'entry_kind';
    const fixture = JSON.parse(await readFile(lv === 'ledger-v1' ? SOURCE_V1 : SOURCE_V2, 'utf8'));

    const wrongMappingRows = fixture.rows.map((r) => ({ ...r, [kind]: 'not_a_kind' }));
    // Wrong source: rows from the OTHER semantic layout, fed under the declared profile.
    // The kernel projection for the declared layout reads the wrong-named kind column,
    // so the frozen #237 kind gate DENIES at the boundary (never silently accepted).
    const otherLv = lv === 'ledger-v1' ? 'ledger-v2' : 'ledger-v1';
    const wrongSourceRows = fixture.rows.map((r) => (otherLv === 'ledger-v2'
      ? { entry_kind: r[kind], atomic_value: r[lv === 'ledger-v1' ? 'value_atomic_units' : 'atomic_value'], ledger_stream: 'ch1', row_key: r.row_key, occurred_at: r.occurred_at, status: r.status, segment: r.segment }
      : { posting_type: r[kind], value_atomic_units: r[lv === 'ledger-v1' ? 'value_atomic_units' : 'atomic_value'], stream: 'ch1', row_key: r.row_key, occurred_at: r.occurred_at, status: r.status, segment: r.segment }));

    negativeEvidence = {
      wrongMapping: capture(() => composeF4ForLayout(lv, wrongMappingRows, { sourceMode })),
      wrongUnitScale: {
        ambiguous: capture(() => composeF4ForLayout(lv, fixture.rows, { sourceMode, profile: AMBIGUOUS_UNITS_PROFILE })),
        wrongScale: capture(() => composeF4ForLayout(lv, fixture.rows, { sourceMode, profile: WRONG_SCALE_PROFILE })),
      },
      wrongSource: capture(() => composeF4ForLayout(lv, wrongSourceRows, { sourceMode })),
    };
  }

  const outJson = {
    schemaVersion: results[0].schemaVersion,
    sourceMode,
    sourceMarking: 'SYNTHETIC',
    layouts: results.map((r) => ({
      layoutVersion: r.layoutVersion,
      kernelProfile: r.kernelProfile,
      kernelDigest: r.kernelDigest,
      comparisonDigest: r.comparisonDigest,
      comparison: r.comparison,
    })),
    negativeEvidence,
  };

  process.stdout.write(`${canonicalJson(outJson)}\n`);
  if (values.out) {
    const resolved = path.resolve(values.out);
    if (!resolved.startsWith(`${root}${path.sep}`) && !resolved.startsWith('/tmp')) {
      throw new Error('F4_CLI_OUT_PATH_DENIED: --out must be inside the repository or /tmp');
    }
    await writeFile(resolved, `${canonicalJson(outJson)}\n`, { mode: 0o644 });
  }
} catch (error) {
  process.stderr.write(`${error.code ?? error.message}\n`);
  process.exitCode = 1;
}
