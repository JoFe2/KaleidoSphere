// K01: the actual successor CLI, not an evaluator pretending to be a candidate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const sourceFile = 'tests/fixtures/business-bi/ks246-unfamiliar-schema/source-pay-feed-v1.json';
const sourceBytes = readFileSync(sourceFile);
const rows = JSON.parse(sourceBytes).rows;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const windows = [['comparison', '2026-06-01', '2026-06-30'], ['current', '2026-07-01', '2026-07-31']];

// Trusted test preparation. Only this test sees raw rows; the CLI receives period aggregates.
function prepared() {
  return {
    schemaVersion: 'kaleidosphere.business-bi/permitted-period-aggregates/v1',
    operationId: 'bi-ks-01-net-revenue/v1',
    accessMode: 'PERMITTED_AGGREGATES',
    source: { id: 'synth_x.pay_feed', revision: 'synthetic-unfamiliar-source-v1', sha256: sha256(sourceBytes) },
    unit: 'EUR_MINOR_UNITS',
    rule: 'INCLUDE_BOUNDARY_DATES',
    periods: windows.map(([key, start, end]) => {
      const selected = rows.filter((row) => row.val_dt !== null && row.val_dt >= start && row.val_dt <= end);
      const sum = (kind) => selected.filter((row) => row.ev_typ === kind && Number.isSafeInteger(row.amt_a))
        .reduce((a, row) => a + row.amt_a, 0);
      return { key, start, end, saleMinorUnits: sum('P'), creditMinorUnits: sum('R'),
        unknownRows: selected.filter((row) => row.ev_typ === 'U' || row.amt_a === null).length };
    }),
    unassignedUnknownRows: rows.filter((row) => row.val_dt === null).length,
  };
}
function invoke(value = prepared(), extra = []) {
  const dir = mkdtempSync(join(tmpdir(), 'ks283-aggregate-'));
  try {
    const input = join(dir, 'aggregates.json');
    writeFileSync(input, JSON.stringify(value));
    return spawnSync(process.execPath, ['scripts/run-permitted-aggregate-journey.mjs', '--input', input, ...extra],
      { encoding: 'utf8', timeout: 10000, maxBuffer: 65536 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test('K01 permitted aggregate is accepted at the genuine isolated candidate entry', () => {
  const out = invoke();
  assert.equal(out.status, 0, 'The genuine permitted-aggregate candidate must exist and execute: ' + out.stderr);
  const result = JSON.parse(out.stdout);
  assert.equal(result.outcome, 'ACCEPTED');
  // An independent row fold rather than reading expected numbers from candidate output.
  const net = Object.fromEntries(windows.map(([key, start, end]) => [key, rows.reduce((sum, row) => {
    if (row.val_dt === null || row.val_dt < start || row.val_dt > end || !Number.isSafeInteger(row.amt_a)) return sum;
    return sum + (row.ev_typ === 'P' ? row.amt_a : row.ev_typ === 'R' ? -row.amt_a : 0);
  }, 0)]));
  assert.deepEqual(result.numbers, { comparisonNetMinorUnits: net.comparison,
    currentNetMinorUnits: net.current, deltaMinorUnits: net.current - net.comparison });
  assert.equal(result.isolation, 'PRIVATE_MOUNT_PID_NETWORK_NAMESPACE');
  assert.equal(result.rawSourceAccessible, false);
  assert.equal(result.oracleAccessible, false);
  assert.equal(out.stderr, '');
});

test('K01 refuses a capability profile outside the actual aggregate grant', () => {
  const denied = prepared();
  denied.accessMode = 'FULL_AUTHORIZED_VALUES';
  const out = invoke(denied);
  assert.equal(out.status, 1, 'A full-value package must never reach the aggregate candidate');
  const result = JSON.parse(out.stdout);
  assert.equal(result.outcome, 'DENIED');
  assert.equal(result.reasonCode, 'K01_PROFILE_DENIED');
  assert.equal(result.numbers, null);
});

test('K01 denies a foreign source instead of relabeling it with known provenance', () => {
  const denied = prepared();
  denied.source.id = 'foreign-source.example';
  const out = invoke(denied);
  assert.equal(out.status, 1, 'A foreign-source aggregate must never be calculated or relabeled');
  const result = JSON.parse(out.stdout);
  assert.equal(result.outcome, 'DENIED');
  assert.equal(result.reasonCode, 'K01_SOURCE_DENIED');
  assert.equal(result.numbers, null);
  assert.equal(JSON.stringify(result).includes('foreign-source.example'), false);
});

test('K01 rejects forged aggregate values despite copied source metadata and caller roles', () => {
  const denied = prepared();
  denied.periods[1].saleMinorUnits += 1;
  denied.roles = ['admin', 'source-owner'];
  const out = invoke(denied);
  assert.equal(out.status, 1, 'Source labels or caller roles cannot authorize new aggregate bytes');
  const result = JSON.parse(out.stdout);
  assert.equal(result.outcome, 'DENIED');
  assert.equal(result.reasonCode, 'K01_APPROVED_PACKAGE_DENIED');
  assert.equal(result.numbers, null);
});

test('K01 scope refusal happens before any supplied file is opened', () => {
  const out = spawnSync(process.execPath, ['scripts/run-permitted-aggregate-journey.mjs',
    '--input', '/nonexistent-k01-raw-source', '--access-mode', 'METADATA_ONLY'],
    { encoding: 'utf8', timeout: 10000 });
  assert.equal(out.status, 1);
  assert.deepEqual(JSON.parse(out.stdout), { outcome: 'DENIED', reasonCode: 'K01_PROFILE_DENIED', numbers: null });
  assert.equal(out.stderr, '');
});

test('K01 input reader refuses a symlink instead of following it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ks283-symlink-'));
  try {
    const target = join(dir, 'approved.json');
    const link = join(dir, 'link.json');
    writeFileSync(target, JSON.stringify(prepared()));
    assert.equal(spawnSync('ln', ['-s', target, link]).status, 0);
    const out = spawnSync(process.execPath, ['scripts/run-permitted-aggregate-journey.mjs', '--input', link],
      { encoding: 'utf8', timeout: 10000 });
    assert.equal(out.status, 1);
    assert.deepEqual(JSON.parse(out.stdout), { outcome: 'DENIED', reasonCode: 'K01_INPUT_DENIED', numbers: null });
    assert.equal(out.stderr, '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('K01 isolates the actual Node executable when it lives outside /usr', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ks283-hosted-node-'));
  try {
    const node = join(dir, 'node');
    const input = join(dir, 'approved.json');
    copyFileSync(process.execPath, node);
    writeFileSync(input, JSON.stringify(prepared()));
    const out = spawnSync(node, ['scripts/run-permitted-aggregate-journey.mjs', '--input', input],
      { encoding: 'utf8', timeout: 10000, maxBuffer: 65536 });
    assert.equal(out.status, 0, 'Hosted setup-node paths outside /usr must be explicitly bound, not bypassed');
    assert.equal(JSON.parse(out.stdout).outcome, 'ACCEPTED');
    assert.equal(out.stderr, '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('K01 frozen launcher makes actual raw and oracle files structurally unreachable', async () => {
  const { aggregateSandboxCommand } = await import('../services/bi-control/src/business-bi/permitted-aggregate-sandbox.mjs');
  const root = process.cwd();
  const raw = join(root, sourceFile);
  const oracle = join(root, 'tests/fixtures/business-bi/ks248-paired-evaluator/access-holdout-v2.json');
  // Both target files really exist and are readable by this more-informed test, unlike the candidate.
  assert.ok(readFileSync(raw).length > 0);
  assert.ok(readFileSync(oracle).length > 0);
  const targets = [raw, oracle, '/app/' + sourceFile,
    '/proc/1/root' + raw, '/proc/1/root' + oracle];
  const probe = `const fs=require('node:fs');
    const allowed=fs.readFileSync('/app/scripts/run-permitted-aggregate-candidate.mjs').length>0;
    const reads=${JSON.stringify(targets)}.map(p=>{try{fs.readFileSync(p);return true}catch{return false}});
    console.log(JSON.stringify({allowed,reads,leaked:process.env.KS283_SYNTHETIC_SENTINEL!==undefined}));`;
  const { command, args } = aggregateSandboxCommand(root);
  const out = spawnSync(command, [...args.slice(0, -1), '--eval', probe], {
    encoding: 'utf8', timeout: 5000, maxBuffer: 65536,
    env: { KS283_SYNTHETIC_SENTINEL: 'test-only-not-a-credential' },
  });
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(JSON.parse(out.stdout), { allowed: true, reads: targets.map(() => false), leaked: false });
  assert.equal(out.stderr, '');
});

test('K01 all immutable source tuple mismatches stay denied and unprinted', () => {
  for (const field of ['id', 'revision', 'sha256']) {
    const value = prepared();
    value.source[field] = 'foreign-canary-never-print';
    const out = invoke(value);
    assert.equal(out.status, 1);
    assert.equal(JSON.parse(out.stdout).reasonCode, 'K01_SOURCE_DENIED');
    assert.equal((out.stdout + out.stderr).includes('foreign-canary-never-print'), false);
  }
});

test('K01 copied labels never grant raw fields, changed units, unknowns or new values', () => {
  for (const mutate of [
    p => { p.rawRows = [{ marker: 'raw-canary-never-print' }]; },
    p => { p.roles = ['admin']; },
    p => { p.unit = 'USD_MINOR_UNITS'; },
    p => { p.rule = 'EXCLUDE_BOUNDARY_DATES'; },
    p => { p.periods[1].unknownRows = 0; },
    p => { p.periods[1].saleMinorUnits += 1; },
    p => { p.periods[1].saleMinorUnits = Number.MAX_SAFE_INTEGER; },
  ]) {
    const value = prepared(); mutate(value);
    const out = invoke(value);
    assert.equal(out.status, 1);
    assert.equal(JSON.parse(out.stdout).reasonCode, 'K01_APPROVED_PACKAGE_DENIED');
    assert.equal(JSON.parse(out.stdout).numbers, null);
    assert.equal((out.stdout + out.stderr).includes('raw-canary-never-print'), false);
  }
});

test('K01 requests for full access, metadata and drilldown never broaden rights', () => {
  for (const extra of [['--access-mode', 'METADATA_ONLY'],
    ['--access-mode', 'PERMITTED_FULL_DATA'], ['--drilldown']]) {
    const out = invoke(prepared(), extra);
    assert.equal(out.status, 1);
    assert.equal(JSON.parse(out.stdout).outcome, 'DENIED');
    assert.equal(JSON.parse(out.stdout).numbers, null);
    assert.equal(out.stderr, '');
  }
});

test('K01 regular input is bounded; malformed values and file types never leak bytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ks283-input-bounds-'));
  try {
    for (const [name, contents] of [['oversize', 'x'.repeat(16385)], ['malformed', 'private-canary-never-print']]) {
      const file = join(dir, name); writeFileSync(file, contents);
      const out = spawnSync(process.execPath, ['scripts/run-permitted-aggregate-journey.mjs', '--input', file],
        { encoding: 'utf8', timeout: 5000 });
      assert.equal(out.status, 1);
      assert.equal(JSON.parse(out.stdout).numbers, null);
      assert.equal((out.stdout + out.stderr).includes('private-canary-never-print'), false);
      assert.equal(out.stderr, '');
    }
    const out = spawnSync(process.execPath, ['scripts/run-permitted-aggregate-journey.mjs', '--input', dir],
      { encoding: 'utf8', timeout: 5000 });
    assert.equal(out.status, 1);
    assert.equal(JSON.parse(out.stdout).reasonCode, 'K01_INPUT_DENIED');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('K01 leaves the original C2 whitelist, metric plan and historical evaluator byte-identical', () => {
  for (const [file, expected] of [
    ['contracts/connectors/postgresql/c2-safe-aggregate-v1.json', '69bad5664bbf64d75bc31289fcc07da00db1f9dd315f0881ee1285535116f1d1'],
    ['services/bi-control/src/business-bi/net-revenue-plan.mjs', '3dccc5ffa5a97a9be7be884eb00369ab80b52cfa18fbd0bc3ed5cdf312f72904'],
    ['scripts/run-ks248-paired-access-evaluation.mjs', '59d78827ae8cd670f130ec5019fcd1bd13804f4c1b569c3e8434cdcdf43b521f'],
  ]) assert.equal(sha256(readFileSync(file)), expected);
});


