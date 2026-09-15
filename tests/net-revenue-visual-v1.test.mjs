import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {canonicalJson} from '../services/bi-control/src/canonical-json.js';

const moduleUrl = new URL('../services/bi-control/src/business-bi/net-revenue-visual-v1.mjs', import.meta.url);
const visual = await import(moduleUrl.href).catch(e => { if (e.code === 'ERR_MODULE_NOT_FOUND') return {}; throw e; });
const digest = x => createHash('sha256').update(canonicalJson(x)).digest('hex');
const unknown = (count = 0, quantifiedAmountMinorUnits = 0, unquantifiedCount = 0) => ({count, quantifiedAmountMinorUnits, unquantifiedCount});
// Public development example, NOT a database execution or an independent oracle.
function example() {
  const result = {
    periods: {
      comparison: {netMinorUnits: -200, saleMinorUnits: 100, creditMinorUnits: 300, cancelCount: 1, rowCount: 4, unknown: unknown(1, 0, 1)},
      current: {netMinorUnits: 700, saleMinorUnits: 900, creditMinorUnits: 200, cancelCount: 1, rowCount: 4, unknown: unknown(1, 50, 0)},
    },
    deltaMinorUnits: 900, unknown: {...unknown(3, 75, 1), unassigned: unknown(1, 25, 0)}, excludedOutOfScopeCount: 2,
  };
  return {
    schemaVersion: 'kaleidosphere.business-bi/net-revenue-visual-input/v1',
    metricId: 'bi-ks-01-net-revenue',
    scope: {relation: 'synthetic_bi.orders', classification: 'SYNTHETIC_HOLDOUT_METRIC'},
    units: {currency: 'EUR', minorUnitsPerMajorUnit: 100},
    periods: {comparison: {label: '2026-06', start: '2026-06-01', end: '2026-06-30', boundary: 'inclusive-both-ends'}, current: {label: '2026-07', start: '2026-07-01', end: '2026-07-31', boundary: 'inclusive-both-ends'}},
    coverage: {state: 'COMPLETE', reasonCode: null},
    provenance: {resultSha256: digest(result), readbackSha256: 'a'.repeat(64), executionReceiptSha256: 'b'.repeat(64), planSha256: 'c'.repeat(64), operationSha256: 'd'.repeat(64), metricContractSha256: 'e'.repeat(64), holdoutSha256: 'f'.repeat(64), oracleSha256: '1'.repeat(64), outputSha256: '2'.repeat(64)},
    result, nonclaims: ['Public development example; no executed DB proof.'],
  };
}

test('one deterministic table and signed chart share exact result values and binding', () => {
  assert.equal(typeof visual.projectNetRevenueVisualV1, 'function', 'VIS-01 projection must exist');
  const input = example();
  const model = visual.projectNetRevenueVisualV1(input);
  assert.equal(model.schemaVersion, 'kaleidosphere.business-bi/net-revenue-visual/v1');
  assert.deepEqual(model.table.map(r => r.period), ['comparison', 'current']);
  assert.deepEqual(model.table.map(r => r.netMinorUnits), [-200, 700]);
  assert.deepEqual(model.chart.values, [-200, 700]);
  assert.equal(model.chart.zeroBaseline, true);
  assert.equal(model.provenance.resultSha256, input.provenance.resultSha256);
  assert.equal(canonicalJson(model), canonicalJson(visual.projectNetRevenueVisualV1(input)));
});

test('bounded period filter retains global UNKNOWN counterevidence and signed aggregate drilldown', () => {
  const input = example();
  const model = visual.projectNetRevenueVisualV1(input, {period: 'comparison'});
  assert.equal(model.table.length, 1);
  assert.equal(model.table[0].period, 'comparison');
  assert.deepEqual(model.drilldown[0].contributions, [
    {kind: 'sale', minorUnits: 100}, {kind: 'credit', minorUnits: -300}, {kind: 'cancel', minorUnits: 0, count: 1},
  ]);
  assert.equal(model.drilldown[0].totalMinorUnits, -200);
  assert.deepEqual(model.counterevidence.unknown, input.result.unknown);
  assert.equal(model.counterevidence.excludedOutOfScopeCount, 2);
  assert.equal(model.table[0].state, 'PARTIAL');
  assert.equal(model.coverage.state, 'COMPLETE', 'execution completeness is not semantic completeness');
  for (const option of [{period: '2026'}, {period: 'all', sql: 'x'}, {period: null}]) {
    assert.throws(() => visual.projectNetRevenueVisualV1(input, option), /VISUAL_FILTER_DENIED/);
  }
});

test('missing periods and unavailable execution states never acquire zero bars', () => {
  const input = example();
  input.result.periods.comparison = {netMinorUnits: 0, saleMinorUnits: 0, creditMinorUnits: 0, cancelCount: 0, rowCount: 0, unknown: unknown()};
  input.result.deltaMinorUnits = 700;
  input.provenance.resultSha256 = digest(input.result);
  const missing = visual.projectNetRevenueVisualV1(input);
  assert.equal(missing.table[0].state, 'MISSING');
  assert.equal(missing.table[0].netMinorUnits, null);
  assert.equal(missing.table[0].aggregateNetMinorUnits, 0);
  assert.equal(missing.chart.values[0], null);
  for (const state of ['PARTIAL', 'UNSUPPORTED', 'UNKNOWN', 'DENIED', 'TIMEOUT', 'CANCELLED']) {
    const unavailable = example();
    unavailable.coverage = {state, reasonCode: 'PUBLIC_TEST_UNAVAILABLE'};
    unavailable.result = null;
    unavailable.provenance.resultSha256 = null;
    const model = visual.projectNetRevenueVisualV1(unavailable);
    assert.deepEqual(model.chart.values, [null, null]);
    assert.deepEqual(model.table.map(r => r.state), [state, state]);
    assert.equal(model.counterevidence.unknown, null);
  }
});

test('visual input denies altered digests, numerical disagreement, unsafe numbers and widened scope', () => {
  for (const mutate of [
    x => {x.schemaVersion = 'v2';},
    x => {x.result.periods.current.netMinorUnits++;},
    x => {x.result.periods.current.netMinorUnits++; x.provenance.resultSha256 = digest(x.result);},
    x => {x.result.periods.current.saleMinorUnits = Number.MAX_SAFE_INTEGER + 1; x.provenance.resultSha256 = digest(x.result);},
    x => {x.units.currency = 'USD';},
    x => {x.periods.current.label = '<script>alert(1)</script>';},
    x => {x.sql = 'SELECT anything';},
    x => {x.coverage.state = 'UNSUPPORTED';},
  ]) {
    const input = example(); mutate(input);
    assert.throws(() => visual.projectNetRevenueVisualV1(input), /VISUAL_INPUT_DENIED/);
  }
});

test('self-contained HTML exposes authoritative table, signed SVG, accessible filter and aggregate details', () => {
  assert.equal(typeof visual.renderNetRevenueVisualHtmlV1, 'function');
  const input = example();
  input.nonclaims.push('<script>unsafe()</script>');
  const html = visual.renderNetRevenueVisualHtmlV1(input);
  assert.match(html, /<table/);
  assert.match(html, /Authoritative table/);
  assert.match(html, /<svg[^>]+role="img"/);
  assert.match(html, /data-value="-200"/);
  assert.match(html, /data-value="700"/);
  assert.match(html, /<details/);
  assert.match(html, /type="radio"/);
  assert.match(html, /UNKNOWN/);
  assert.match(html, /Unassigned/);
  assert.match(html, /PARTIAL/);
  assert.match(html, /&lt;script&gt;unsafe\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script|https?:\/\/|onchange=/);
  assert.ok(html.includes(input.provenance.resultSha256));
  assert.equal(html, visual.renderNetRevenueVisualHtmlV1(input));
});

test('product adapter verifies existing C2 receipts and leaves old TABLE/JSON contracts intact', async () => {
  assert.equal(typeof visual.createNetRevenueVisualInputV1, 'function');
  const {readFile} = await import('node:fs/promises');
  const {compileNetRevenuePlan, createNetRevenueOperationRequest, executeNetRevenuePlan} = await import('../services/bi-control/src/business-bi/net-revenue-plan.mjs');
  const {renderNetRevenueTable, renderNetRevenueJson} = await import('../services/bi-control/src/business-bi/net-revenue-readback.mjs');
  const metricContractBytes = await readFile(new URL('../contracts/business-bi/v1/net-revenue.metric.json', import.meta.url));
  // Opaque oracle bytes consumed by the existing C2 verifier; no holdout file read.
  const oracleBytes = await readFile(new URL('./fixtures/business-bi/net-revenue-oracle-v1.json', import.meta.url));
  const plan = compileNetRevenuePlan({request: createNetRevenueOperationRequest(), metricContractBytes, oracleBytes});
  const receipt = await executeNetRevenuePlan({plan, metricContractBytes, oracleBytes,
    read: async () => ({state: 'UNSUPPORTED', reasonCode: 'PUBLIC_TEST_UNAVAILABLE', bytes: null,
      evidence: {accessMode: 'READ_ONLY', mutationCount: 0, bounded: true, relation: 'synthetic_bi.orders', rowsRead: null}})});
  const sources = {plan, receipt, metricContractBytes, oracleBytes};
  const before = [renderNetRevenueTable(sources), renderNetRevenueJson(sources)];
  const input = visual.createNetRevenueVisualInputV1(sources);
  assert.equal(input.coverage.state, 'UNSUPPORTED');
  assert.equal(input.result, null);
  assert.deepEqual(visual.projectNetRevenueVisualV1(input).chart.values, [null, null]);
  assert.deepEqual([renderNetRevenueTable(sources), renderNetRevenueJson(sources)], before);
  assert.throws(() => visual.createNetRevenueVisualInputV1({...sources, receipt: {...receipt, resultSha256: 'f'.repeat(64)}}));
  const {mkdtemp, writeFile, rm} = await import('node:fs/promises');
  const {spawnSync} = await import('node:child_process');
  const path = await import('node:path');
  const dir = await mkdtemp(path.resolve('.vis01-cli-test-'));
  try {
    await writeFile(path.join(dir, 'plan.json'), JSON.stringify(plan));
    await writeFile(path.join(dir, 'receipt.json'), JSON.stringify(receipt));
    const args = ['scripts/render-net-revenue-visual-v1.mjs', '--plan', path.join(dir, 'plan.json'), '--receipt', path.join(dir, 'receipt.json'), '--metric', 'contracts/business-bi/v1/net-revenue.metric.json', '--oracle', 'tests/fixtures/business-bi/net-revenue-oracle-v1.json'];
    const rendered = spawnSync(process.execPath, [...args, '--format', 'JSON', '--period', 'current'], {encoding: 'utf8'});
    assert.equal(rendered.status, 0, rendered.stderr);
    assert.deepEqual(JSON.parse(rendered.stdout), visual.projectNetRevenueVisualV1(input, {period: 'current'}));
    const html = spawnSync(process.execPath, [...args, '--format', 'HTML'], {encoding: 'utf8'});
    assert.equal(html.status, 0, html.stderr);
    assert.equal(html.stdout, visual.renderNetRevenueVisualHtmlV1(input));
    assert.notEqual(spawnSync(process.execPath, [...args, '--period', 'other']).status, 0);
  } finally {await rm(dir, {recursive: true, force: true});}
});

test('VIS-01 product, consumer, documentation and tests are canonically registered', async () => {
  const {readFile} = await import('node:fs/promises');
  const map = JSON.parse(await readFile('SOURCE-MAP.json', 'utf8'));
  for (const path of ['docs/evidence/vis01-net-revenue.md', 'scripts/render-net-revenue-visual-v1.mjs', 'scripts/update-vis01-source-map.mjs', 'services/bi-control/src/business-bi/net-revenue-visual-v1.mjs', 'tests/net-revenue-visual-v1.test.mjs']) {
    assert.equal(map.files[path], createHash('sha256').update(await readFile(path)).digest('hex'), path);
  }
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(pkg.scripts.test.split(' ').filter(x => x === 'tests/net-revenue-visual-v1.test.mjs').length, 0);
  const parent = await readFile('tests/source-map.test.mjs', 'utf8');
  assert.equal(parent.split("import './net-revenue-visual-v1.test.mjs';").length, 2);
});

export {example, digest};
