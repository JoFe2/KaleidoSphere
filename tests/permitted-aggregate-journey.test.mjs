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

test('K01 CI diagnostics records bootstrap evidence without weakening the existing sandbox gates', () => {
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
  assert.match(workflow, /node scripts\/ci\/ks283-sandbox-diagnostics\.mjs before/);
  assert.match(workflow, /node scripts\/ci\/ks283-sandbox-diagnostics\.mjs failure/);
  assert.match(workflow, /exit "\$ks283_status"/);
  assert.match(workflow, /test "\$\{RUNNER_ENVIRONMENT:\?\}" = github-hosted/);
  assert.match(workflow, /test "\$\{RUNNER_OS:\?\}" = Linux/);
  assert.match(workflow, /assert\.deepEqual\(after,JSON\.parse\(readFileSync/);
  assert.match(workflow, /profile\.includes\("ks283-ci-child"\).*profile\.includes\("enforce"\)/);
  assert.match(workflow, /\["CapEff","CapPrm","CapAmb"\]/);
  assert.match(workflow, /Object\.values\(caps\)\.every\(v=>\/\^0\+\$\//);
  assert.match(workflow, /if-no-files-found: error/);
  const profile = readFileSync('scripts/ci/ks283-bwrap.apparmor', 'utf8');
  const audited = '  audit allow px /** -> ks283-ci-bwrap//&ks283-ci-child,';
  assert.equal(profile.split(audited).length, 2);
  assert.equal(sha256(profile.replace(audited, '  allow px /** -> ks283-ci-bwrap//&ks283-ci-child,')),
    '45f7c2ca69b03a52244aa066c19f128fb21868ac060a4564f7d782fe1368a72f');
});

test('K01 CI diagnostics filters and bounds explicitly synthetic audit fixtures', async () => {
  const { selectKs283AuditFacts } = await import('../scripts/ci/ks283-sandbox-diagnostics.mjs');
  const denied = 'apparmor="DENIED" operation="capable" profile="ks283-ci-bwrap//&ks283-ci-child" pid=41 comm="bwrap" capability=12 capname="net_admin" raw="SYNTHETIC_CANARY_NOT_A_SECRET"';
  const allowed = 'apparmor="ALLOWED" operation="exec" profile="ks283-ci-bwrap" pid=41 comm="bwrap" name="/proc/self/exe" target="ks283-ci-bwrap//&ks283-ci-child"';
  const unrelated = 'apparmor="DENIED" operation="open" profile="unrelated" comm="other" name="SYNTHETIC_CANARY_NOT_A_SECRET"';
  assert.deepEqual(selectKs283AuditFacts([denied, allowed, unrelated].join('\n')), {
    events: [
      { apparmor: 'DENIED', operation: 'capable', profile: 'ks283-ci-bwrap//&ks283-ci-child', capname: 'net_admin', comm: 'bwrap', pid: 41, capability: 12 },
      { apparmor: 'ALLOWED', operation: 'exec', profile: 'ks283-ci-bwrap', target: 'ks283-ci-bwrap//&ks283-ci-child', comm: 'bwrap', pid: 41, path: '/proc/self/exe' },
    ], matched: 2, truncated: false,
  });
  const bounded = selectKs283AuditFacts(Array(33).fill(denied).join('\n'));
  assert.equal(bounded.events.length, 32);
  assert.equal(bounded.matched, 33);
  assert.equal(bounded.truncated, true);
  assert.equal(JSON.stringify(bounded).includes('SYNTHETIC_CANARY'), false);
  const redacted = selectKs283AuditFacts(allowed.replace('/proc/self/exe', '/home/private/SYNTHETIC_CANARY'));
  assert.equal(redacted.events[0].path, 'OTHER_PATH');
  assert.deepEqual(selectKs283AuditFacts('no audit evidence'), { events: [], matched: 0, truncated: false });
});

test('K01 CI diagnostics refuses execution outside the explicit hosted runner scope', () => {
  const out = spawnSync(process.execPath, ['scripts/ci/ks283-sandbox-diagnostics.mjs', 'before'], {
    env: { RUNNER_ENVIRONMENT: 'self-hosted', RUNNER_OS: 'Linux' }, encoding: 'utf8', timeout: 5000,
  });
  assert.equal(out.status, 1);
  assert.equal(out.stdout, '');
  assert.deepEqual(JSON.parse(out.stderr), { purpose: 'DIAGNOSTICS_ONLY_NOT_ACCEPTANCE', unavailable: true, code: 'K01_DIAGNOSTICS_HOSTED_LINUX_ONLY' });
});

test('K01 CI diagnostics failure trap preserves the actual gate exit even when diagnostics fails', () => {
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
  const trap = workflow.split('\n').find(line => line.trim().startsWith("trap 'ks283_status=")).trim();
  // Shell-only control fixture: this function is NOT a real kernel/CI probe.
  const stub = "node() { printf 'SYNTHETIC_DIAGNOSTIC\\n'; return 7; }";
  const failed = spawnSync('/bin/bash', ['-e', '-c', `ks283_audit_since=0\n${stub}\n${trap}\nexit 23`], { encoding: 'utf8', env: {}, timeout: 5000 });
  assert.equal(failed.status, 23);
  assert.match(failed.stdout, /SYNTHETIC_DIAGNOSTIC/);
  assert.match(failed.stdout, /original failure retained/);
  const success = spawnSync('/bin/bash', ['-e', '-c', `ks283_audit_since=0\n${stub}\n${trap}\nexit 0`], { encoding: 'utf8', env: {}, timeout: 5000 });
  assert.equal(success.status, 0);
  assert.equal(success.stdout, '');
});

test('K01 CI diagnostics D1 only emits known values or fixed redacted categories', async () => {
  const { selectKs283AuditFacts: select } = await import('../scripts/ci/ks283-sandbox-diagnostics.mjs');
  const base = 'apparmor="DENIED" operation="capable" profile="ks283-ci-bwrap" pid=41 comm="bwrap" capability=12 capname="net_admin"';
  for (const marker of ['SYNTHETIC_BOUNDARY_MARKER', 'SYNTHETIC_DIFFERENT_VALUE_2']) {
    for (const [input, key, expected] of [
      [base.replace('operation="capable"', `operation="${marker}"`), 'operation', 'OTHER_OPERATION'],
      [base.replace('profile="ks283-ci-bwrap"', `profile="ks283-ci-${marker}"`), 'profile', 'OTHER_PROFILE'],
      [base + ` target="${marker}"`, 'target', 'OTHER_PROFILE'],
      [base.replace('capname="net_admin"', `capname="${marker}"`), 'capname', 'OTHER_CAPABILITY'],
      [base + ` requested_mask="${marker}"`, 'requested_mask', 'OTHER_MASK'],
      [base + ` denied_mask="${marker}"`, 'denied_mask', 'OTHER_MASK'],
      [base + ` name="/app/${marker}"`, 'path', 'OTHER_PATH'],
      [base.replace('profile="ks283-ci-bwrap"', `profile="/home/private/${marker}"`), 'profile', 'OTHER_PROFILE'],
    ]) {
      const result = select(input);
      assert.equal(result.events[0][key], expected);
      assert.equal(JSON.stringify(result).includes(marker), false);
      assert.equal(result.events[0].pid, 41);
    }
  }
  for (const profile of ['ks283-ci-bwrap', 'ks283-ci-child', 'ks283-ci-bwrap//&ks283-ci-child', 'bwrap', 'unpriv_bwrap', 'bwrap//&unpriv_bwrap', 'unconfined']) {
    const result = select(base.replace('profile="ks283-ci-bwrap"', `profile="${profile}"`));
    assert.equal(result.events[0].profile, profile);
    assert.equal(result.events[0].capname, 'net_admin');
  }
  const exec = select('audit: type=1400 audit(123.456:7): apparmor="ALLOWED" operation="exec" profile="ks283-ci-bwrap" comm="bwrap" name="/runtime/node" requested_mask="x"');
  assert.equal(exec.events[0].path, '/runtime/node');
  assert.equal(exec.events[0].requested_mask, 'x');
});

test('K01 CI diagnostics D2 rejects entire ambiguous records and skips complete unknown values', async () => {
  const { selectKs283AuditFacts: select } = await import('../scripts/ci/ks283-sandbox-diagnostics.mjs');
  const base = 'apparmor="DENIED" operation="capable" profile="ks283-ci-bwrap" comm="bwrap" pid=41';
  for (const suffix of [' info="unfinished', ' operation="exec"', ' pid=42', ' info=one info=two', ' info="closed"junk',
    ' malformed', String.raw` info="unsupported\escape"`, " info='unsupported'", ' info=control\u0000', ' apparmor="ALLOWED"']) {
    assert.deepEqual(select(base + suffix), { events: [], matched: 0, truncated: false }, suffix);
  }
  const opaque = ' info="profile=unrelated comm=other operation=SYNTHETIC_FAKE_EVENT"';
  assert.deepEqual(select(base + opaque), select(base));
  assert.deepEqual(select(base + ' info=profile=unrelated'), select(base));
  assert.deepEqual(select('apparmor="DENIED" operation="open" profile="unrelated" comm="other"' + opaque.replace('unrelated', 'ks283-ci-bwrap')),
    { events: [], matched: 0, truncated: false });
  assert.deepEqual(select('apparmor="DENIED" profile="ks283-ci-bwrap" comm="bwrap"'), { events: [], matched: 0, truncated: false });
  assert.deepEqual(select('[ 12.345] audit: type=1400 audit(123.456:7): ' + base), select(base));
});

test('K01 CI diagnostics minimizes non-audit metadata without exposing unknown values', async () => {
  const { selectKs283RuntimeFacts: select } = await import('../scripts/ci/ks283-sandbox-diagnostics.mjs');
  // Pure, explicitly synthetic metadata; NOT an observation of the hosted job.
  const known = { bwrapVersion: 'bubblewrap 0.13.1\n', packages: 'bubblewrap 0.13.1-1\napparmor 4.0.1-0ubuntu2\napparmor-utils 4.0.1-0ubuntu2\n',
    kernelRelease: 'Linux 6.11.0-1018-azure x86_64\n', realPath: '/usr/bin/bwrap', collectorProfile: 'unconfined\n',
    loadedProfiles: 'ks283-ci-bwrap (enforce)\nks283-ci-child (enforce)\n',
    launch: { command: '/usr/bin/bwrap', args: ['--unshare-all', '--ro-bind', '/usr', '/usr', '/runtime/node'] } };
  assert.deepEqual(select(known), { bwrapVersion: 'bubblewrap 0.13.1', packages: ['bubblewrap 0.13.1-1', 'apparmor 4.0.1-0ubuntu2', 'apparmor-utils 4.0.1-0ubuntu2'],
    kernelRelease: 'Linux 6.11.0-1018-azure x86_64', realPath: '/usr/bin/bwrap', collectorProfile: 'unconfined',
    bwrapProfiles: ['ks283-ci-bwrap (enforce)', 'ks283-ci-child (enforce)'], launch: known.launch });
  for (const marker of ['SYNTHETIC_BOUNDARY_MARKER', 'SYNTHETIC_DIFFERENT_VALUE_2']) {
    const result = select({ bwrapVersion: `bubblewrap 0.${marker}`, packages: `bubblewrap 0.${marker}`, kernelRelease: `Linux 6.11.0-${marker} x86_64`,
      realPath: `/app/${marker}`, collectorProfile: `/home/private/${marker} (enforce)`,
      loadedProfiles: `ks283-ci-bwrap-${marker} (enforce)\nks283-ci-bwrap (enforce)`,
      launch: { command: `/usr/${marker}`, args: ['--unshare-all', `/home/private/${marker}`, '/runtime/node', `/app/${marker}`] } });
    assert.deepEqual(result, { bwrapVersion: null, packages: [], kernelRelease: null, realPath: 'OTHER_PATH', collectorProfile: 'OTHER_PROFILE (enforce)',
      bwrapProfiles: ['OTHER_PROFILE (enforce)', 'ks283-ci-bwrap (enforce)'],
      launch: { command: 'OTHER_EXECUTABLE', args: ['--unshare-all', 'OTHER_PATH_OR_ARGUMENT', '/runtime/node', 'OTHER_PATH_OR_ARGUMENT'] } });
    assert.equal(JSON.stringify(result).includes(marker), false);
  }
});


