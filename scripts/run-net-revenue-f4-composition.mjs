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
//
// KS236–238 F4 correction: `--pglite --negative` previously fed mutated fixture arrays
// STRAIGHT to composeF4ForLayout while keeping sourceMode REAL_POSTGRESQL — so the
// negative evidence never crossed the actual source seed/read boundary. `--negative`
// now seeds each mutated case into an independent local synthetic database and reads it
// back through readF4SourceRows before the SAME composition boundary, in real AND
// synthetic mode. Source-read failures (seed/read stage) stay distinct from mapping
// failures (frozen #237 profile gate), and each negative case records which path ran.

import { readFile, realpath, writeFile } from 'node:fs/promises';
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
    async close() { store = []; },
  };
}

function capture(fn) {
  try { fn(); return null; }
  catch (error) {
    return { code: error?.code ?? String(error?.message ?? error), message: String(error?.message ?? error).slice(0, 160) };
  }
}

// Seed then read through the SAME handoff the positive boundary uses. Real mode runs
// the genuine SQL seed/read (seedF4Database + readF4SourceRows); synthetic mode stores
// the rows verbatim in the labelled adapter (no SQL engine) and reads them back the
// same way. Both hand the already-read rows to composeF4ForLayout.
async function seedAndRead(db, lv, rows) {
  if (db.__mode === 'REAL_POSTGRESQL') {
    await seedF4Database(db, lv, rows);
  } else {
    await db.seedRows(rows);
  }
  return readF4SourceRows(db, lv);
}

// The negative cases run through the SAME source seed/read handoff as the positive
// path: in real mode each case is seeded into an INDEPENDENT PGlite database and read
// back via readF4SourceRows; in synthetic mode it goes through the labelled synthetic
// adapter. The returned evidence keeps the source-read stage distinguishable from the
// mapping stage so a seed/read failure is never confused with a frozen-profile denial.
async function runNegativeCases(engine, lv, fixture) {
  const kind = lv === 'ledger-v1' ? 'posting_type' : 'entry_kind';
  const wrongMappingRows = fixture.rows.map((r) => ({ ...r, [kind]: 'not_a_kind' }));
  // Wrong source: rows from the OTHER semantic layout, fed under the declared profile.
  // The kernel projection for the declared layout reads the wrong-named kind column, so
  // the frozen #237 kind gate DENIES at the boundary (never silently accepted).
  const otherLv = lv === 'ledger-v1' ? 'ledger-v2' : 'ledger-v1';
  const wrongSourceRows = fixture.rows.map((r) => (otherLv === 'ledger-v2'
    ? { entry_kind: r[kind], atomic_value: r[lv === 'ledger-v1' ? 'value_atomic_units' : 'atomic_value'], ledger_stream: 'ch1', row_key: r.row_key, occurred_at: r.occurred_at, status: r.status, segment: r.segment }
    : { posting_type: r[kind], value_atomic_units: r[lv === 'ledger-v1' ? 'value_atomic_units' : 'atomic_value'], stream: 'ch1', row_key: r.row_key, occurred_at: r.occurred_at, status: r.status, segment: r.segment }));

  // Drive `rows` through seed+read, then the SAME boundary composeF4ForLayout. Reports
  // which stage failed: 'source-read' (seed/read error, with its OWN code) vs 'mapping'
  // (frozen #237 profile denial), vs null (accepted — must not happen for negatives).
  const throughComposition = async (rows, opts = {}) => {
    let db;
    let sourceRead;
    let readBackRows;
    const dispose = async () => { if (db?.close) await db.close(); };
    try {
      db = await engine.makeDatabase();
      readBackRows = await seedAndRead(db, lv, rows);
      sourceRead = { mode: engine.sourceMode, rowsRead: readBackRows.length };
    } catch (error) {
      await dispose();
      return { stage: 'source-read', evidence: capture(() => { throw error; }) };
    }
    try {
      const out = composeF4ForLayout(lv, readBackRows, { sourceMode: engine.sourceMode, ...opts });
      return { stage: 'accepted', sourceRead, evidence: null, outcome: { kernelDigest: out.kernelDigest, comparisonDigest: out.comparisonDigest } };
    } catch (error) {
      return { stage: 'mapping', sourceRead, evidence: capture(() => { throw error; }) };
    } finally {
      await dispose();
    }
  };

  return {
    wrongMapping: await throughComposition(wrongMappingRows),
    wrongUnitScale: {
      ambiguous: await throughComposition(fixture.rows, { profile: AMBIGUOUS_UNITS_PROFILE }),
      wrongScale: await throughComposition(fixture.rows, { profile: WRONG_SCALE_PROFILE }),
    },
    wrongSource: await throughComposition(wrongSourceRows),
  };
}

// `--out` must land inside the repository or /tmp — NOT a sibling prefix like /tmpfoo
// and NOT a lexical repository path that resolves through a symlink to an outside
// target. Lexical containment is checked against exact root+separator prefixes, then
// the deepest EXISTING ancestor is realpath-resolved and re-checked against the
// realpath of each allowed root.
async function assertAllowedOutputPath(out) {
  const resolved = path.resolve(out);
  const prefixes = [root, '/tmp'];
  const lexicallyAllowed = prefixes.some((p) => resolved === p || resolved.startsWith(`${p}${path.sep}`));
  if (!lexicallyAllowed) throw new Error('F4_CLI_OUT_PATH_DENIED: --out must be inside the repository or /tmp');
  const realRoots = await Promise.all(
    prefixes.map((p) => realpath(p).then((rp) => rp.endsWith(path.sep) ? rp.slice(0, -1) : rp).catch(() => null)),
  );
  let cursor = resolved;
  let realLeaf = null;
  for (;;) {
    try { realLeaf = await realpath(cursor); break; }
    catch {
      const parent = path.dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }
  if (realLeaf !== null) {
    const contained = realRoots.some((rr) => rr !== null && (realLeaf === rr || realLeaf.startsWith(`${rr}${path.sep}`)));
    if (!contained) throw new Error('F4_CLI_OUT_PATH_DENIED: --out resolves outside the repository or /tmp');
  }
  return resolved;
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

  // Engine: real isolated local PostgreSQL (injected PGlite) or the labelled synthetic
  // fallback. Real mode holds the raw PGlite instance so each database can be closed
  // (transient resource release); the adapter still owns seed/read semantics.
  let PGliteClass = null;
  let sourceMode;
  if (values.pglite) {
    if (!path.isAbsolute(values.pglite)) throw new Error('F4_CLI_PGLITE_PATH_DENIED: --pglite must be an absolute path');
    ({ PGlite: PGliteClass } = await import(pathToFileURL(values.pglite).href));
    sourceMode = 'REAL_POSTGRESQL';
  } else {
    sourceMode = 'SYNTHETIC_FALLBACK';
  }
  const engine = {
    sourceMode,
    async makeDatabase() {
      if (PGliteClass) {
        const raw = new PGliteClass();
        return Object.assign(buildPgliteJourneyDatabase(raw), { close: async () => { await raw.close(); } });
      }
      return buildF4SyntheticDatabase([]);
    },
  };

  const results = [];
  for (const lv of layouts) {
    const fixture = JSON.parse(await readFile(lv === 'ledger-v1' ? SOURCE_V1 : SOURCE_V2, 'utf8'));
    const db = await engine.makeDatabase();
    try {
      const readBack = await seedAndRead(db, lv, fixture.rows);
      results.push(composeF4ForLayout(lv, readBack, { sourceMode }));
    } finally {
      if (db.close) await db.close();
    }
  }

  let negativeEvidence = null;
  if (values.negative) {
    const lv = layouts[0];
    const fixture = JSON.parse(await readFile(lv === 'ledger-v1' ? SOURCE_V1 : SOURCE_V2, 'utf8'));
    negativeEvidence = await runNegativeCases(engine, lv, fixture);
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
    const resolved = await assertAllowedOutputPath(values.out);
    await writeFile(resolved, `${canonicalJson(outJson)}\n`, { mode: 0o644 });
  }
} catch (error) {
  process.stderr.write(`${error.code ?? error.message}\n`);
  process.exitCode = 1;
}
