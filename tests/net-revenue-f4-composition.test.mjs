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

// Resolve the injected PGlite entry point portably: explicit injected-runtime override
// (PGLITE_CORE_PATH) first, then the repository-owned external runtime dir, then the
// /workspace/.ks-journey-runtime installed-runtime fallback (never package.json). Returns
// the first existing absolute entry path, or null if no real-database runtime is present
// (the test then skips honestly rather than faking a PASS). Canonical `npm test` stays
// byte-bound because no dependency is installed from here.
async function resolvePgliteEntry() {
  const { readFile: rf } = await import('node:fs/promises');
  const { resolve, join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const candidates = [
    process.env.PGLITE_CORE_PATH,
    join(repoRoot, '.ks-journey-runtime/node_modules/@electric-sql/pglite/dist/index.js'),
    '/workspace/.ks-journey-runtime/node_modules/@electric-sql/pglite/dist/index.js',
  ].filter(Boolean);
  for (const c of candidates) {
    try { await rf(c); return c; } catch { /* try the next preinstalled/injected runtime */ }
  }
  return null;
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
  const entry = await resolvePgliteEntry();
  if (!entry) { t.skip('external PGlite runtime not present; real-database path not exercised here'); return; }
  let makeDb;
  try {
    const { pathToFileURL } = await import('node:url');
    const mod = await import(pathToFileURL(entry));
    const { buildPgliteJourneyDatabase } = await import('../services/bi-control/src/business-bi/net-revenue-journey.mjs');
    makeDb = () => buildPgliteJourneyDatabase(new mod.PGlite());
  } catch {
    t.skip('external PGlite runtime failed to load; real-database path not exercised here');
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
  const { stdout } = await execFileP(process.execPath, ['scripts/run-net-revenue-f4-composition.mjs', '--layout', 'ledger-v1', '--negative'], { cwd: process.cwd() });
  const doc = JSON.parse(stdout);
  assert.equal(doc.sourceMode, 'SYNTHETIC_FALLBACK');
  assert.equal(doc.layouts.length, 1);
  assert.equal(doc.layouts[0].comparison.delta.netRevenue, 21000);
  // The synthetic negative cases go through the labelled synthetic seed/read handoff
  // (never real DB evidence) and fail closed at the mapping stage, not a source-read error.
  const neg = doc.negativeEvidence;
  assert.equal(neg.wrongMapping.stage, 'mapping');
  assert.equal(neg.wrongMapping.sourceRead.mode, 'SYNTHETIC_FALLBACK');
  assert.equal(neg.wrongMapping.evidence.code, 'LEDGER_KIND_DENIED:not_a_kind');
  assert.equal(neg.wrongSource.stage, 'mapping');
  assert.equal(neg.wrongSource.evidence.code, 'LEDGER_KIND_DENIED:undefined');
  assert.equal(neg.wrongUnitScale.ambiguous.stage, 'mapping');
  assert.equal(neg.wrongUnitScale.ambiguous.evidence.code, 'LEDGER_UNIT_SCALE_AMBIGUOUS');
  assert.equal(neg.wrongUnitScale.wrongScale.stage, 'mapping');
  assert.equal(neg.wrongUnitScale.wrongScale.evidence.code, 'LEDGER_UNIT_SCALE_MISMATCH');
});

test('CLI --pglite --negative seeds/reads the actual local database before the same boundary (real source handoff)', async (t) => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileP = promisify(execFile);
  const pgliteEntry = await resolvePgliteEntry();
  if (!pgliteEntry) { t.skip('external PGlite runtime not present; real-database negative path not exercised here'); return; }
  const { stdout } = await execFileP(process.execPath, ['scripts/run-net-revenue-f4-composition.mjs', '--pglite', pgliteEntry, '--layout', 'ledger-v1', '--negative'], { cwd: process.cwd() });
  const doc = JSON.parse(stdout);
  assert.equal(doc.sourceMode, 'REAL_POSTGRESQL');
  assert.equal(doc.layouts[0].comparison.delta.netRevenue, 21000);
  const neg = doc.negativeEvidence;
  // Every negative case crossed the REAL seed/read boundary (12 rows read back) before
  // the same composition gate — no direct mutated-array handoff, no fake query adapter.
  for (const [name, caseOut] of [['wrongMapping', neg.wrongMapping], ['wrongSource', neg.wrongSource], ['ambiguous', neg.wrongUnitScale.ambiguous], ['wrongScale', neg.wrongUnitScale.wrongScale]]) {
    assert.equal(caseOut.stage, 'mapping', `${name} must fail at the mapping stage after a real source read`);
    assert.equal(caseOut.sourceRead.mode, 'REAL_POSTGRESQL', `${name} must read the real database`);
    assert.equal(caseOut.sourceRead.rowsRead, 12, `${name} must read back all 12 seeded rows`);
  }
  // Mapping failures are kept distinct from source-read failures by their own codes.
  assert.equal(neg.wrongMapping.evidence.code, 'LEDGER_KIND_DENIED:not_a_kind');
  // A real PostgreSQL round-trip normalizes the absent wrong-layout kind column to SQL
  // NULL, so the frozen #237 kind gate denies `:null` — an honest DB read, not a direct
  // array `:undefined` shortcut.
  assert.equal(neg.wrongSource.evidence.code, 'LEDGER_KIND_DENIED:null');
  assert.equal(neg.wrongUnitScale.ambiguous.evidence.code, 'LEDGER_UNIT_SCALE_AMBIGUOUS');
  assert.equal(neg.wrongUnitScale.wrongScale.evidence.code, 'LEDGER_UNIT_SCALE_MISMATCH');
});

test('CLI output confinement: --out denies /tmp-prefixed lookalikes and symlink escapes, accepts the real boundary', async (t) => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { mkdtemp, symlink, rm, realpath: rp, lstat, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join, sep } = await import('node:path');
  const execFileP = promisify(execFile);

  const run = (args) => execFileP(process.execPath, ['scripts/run-net-revenue-f4-composition.mjs', ...args], { cwd: process.cwd() })
    .then(({ stdout }) => ({ status: 0, stdout, stderr: '' }))
    .catch((error) => ({ status: error.code ?? 255, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }));

  // /tmpfoo is a lexical sibling, NOT the allowed /tmp root: must deny and write nothing.
  const sibling = (await run(['--out', '/tmpfoo/f4-receipt.json']));
  assert.equal(sibling.status, 1, '/tmpfoo must be denied');
  assert.match(sibling.stderr, /F4_CLI_OUT_PATH_DENIED/);

  // A valid /tmp path is accepted and the receipt lands at exactly that path.
  const tmpRoot = await mkdtemp(join(tmpdir(), 'f4-out-'));
  t.after(() => rm(tmpRoot, { recursive: true, force: true }));
  const okPath = join(tmpRoot, 'receipt.json');
  const ok = await run(['--out', okPath]);
  assert.equal(ok.status, 0, 'valid /tmp receipt must be accepted');
  assert.equal(JSON.parse(await readFile(okPath, 'utf8')).sourceMode, 'SYNTHETIC_FALLBACK');

  // A symlink inside /tmp (or the repo) that resolves OUTSIDE the allowed roots must be
  // denied and must not leak a file to the real target.
  // The outside target must be a DIFFERENT root than /tmp (or the repo): use /var/tmp,
  // which resolves elsewhere and is not one of the two allowed output roots.
  const outside = await mkdtemp(join('/var/tmp', 'f4-outside-'));
  const escapeSource = join(tmpRoot, 'escape');
  await symlink(outside, escapeSource);
  t.after(() => rm(outside, { recursive: true, force: true }));
  const escape = await run(['--out', join(escapeSource, 'leak.json')]);
  assert.equal(escape.status, 1, 'symlink escape must be denied');
  assert.match(escape.stderr, /F4_CLI_OUT_PATH_DENIED/);
  await rm(join(outside, 'leak.json'), { force: true }).catch(() => {});
  let leaked = true;
  try { await rp(join(outside, 'leak.json')); } catch { leaked = false; }
  assert.equal(leaked, false, 'no file must leak to the real symlink target');

  // Deterministic dangling-leaf escape (the reproduced residual): the leaf is a symlink
  // to a NOT-YET-EXISTING file whose parent directory DOES exist. realpath fails on the
  // dangling leaf and walks UP past the symlink to a benign parent, so the old check
  // accepted it and writeFile() followed the symlink and CREATED the outside file with
  // exit 0. The corrected boundary must DENY at the symlink component and create nothing.
  const danglingTarget = join(outside, 'receipt.json'); // parent (outside) exists, leaf does not
  const danglingLeaf = join(tmpRoot, 'dangling');      // symlink -> danglingTarget
  await symlink(danglingTarget, danglingLeaf);
  const dangling = await run(['--out', danglingLeaf]);
  assert.equal(dangling.status, 1, 'dangling leaf symlink must be denied');
  assert.match(dangling.stderr, /F4_CLI_OUT_PATH_DENIED/);
  let danglingCreated = true;
  try { await lstat(danglingTarget); } catch { danglingCreated = false; }
  assert.equal(danglingCreated, false, 'no file must be created at the dangling symlink target');

  // An existing-file leaf symlink must also be denied (no-follow final open), and the
  // pre-existing outside file must be left byte-identical (not truncated/rewritten).
  const existingOutside = join(outside, 'existing.json');
  await writeFile(existingOutside, 'untouched');
  const existingLeaf = join(tmpRoot, 'existing'); // symlink -> existingOutside
  await symlink(existingOutside, existingLeaf);
  const existing = await run(['--out', existingLeaf]);
  assert.equal(existing.status, 1, 'existing-file leaf symlink must be denied');
  assert.match(existing.stderr, /F4_CLI_OUT_PATH_DENIED/);
  assert.equal(await readFile(existingOutside, 'utf8'), 'untouched', 'outside file must stay byte-identical');
});
