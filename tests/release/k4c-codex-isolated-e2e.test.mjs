import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');
const harness = path.join(root, 'scripts', 'release', 'k4c-codex-isolated-e2e.mjs');
const fixture = path.join(root, 'tests', 'fixtures', 'release', 'k4c-codex-cli-transcripts-v1.json');
const schema = path.join(root, 'docs', 'release', 'k4c-codex-e2e-schema-v1.json');

function run(args, options = {}) {
  return spawnSync(process.execPath, [harness, ...args], { cwd: root, encoding: 'utf8', ...options });
}

function parse(stdout) {
  const start = stdout.indexOf('{');
  assert.notEqual(start, -1, stdout);
  return JSON.parse(stdout.slice(start));
}

async function temporaryReceipt(prefix = 'ks76-codex-e2e-test-') {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  return path.join(directory, 'receipt.json');
}

test('fixture mode records the complete ordered install/discover/use/deny/remove/readback contract', async () => {
  const receiptPath = await temporaryReceipt();
  const result = run(['--fixture', fixture, '--dry-run', '--receipt', receiptPath], {
    env: { ...process.env, PATH: '/definitely-no-codex-on-path' },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const receipt = parse(result.stdout);
  const persisted = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.deepEqual(persisted, receipt);
  assert.equal(receipt.schemaVersion, 'kaleidosphere/k4c-codex-isolated-e2e/v1');
  assert.equal(receipt.mode, 'fixture');
  assert.equal(receipt.codex.version, 'codex-cli 0.144.1');
  assert.match(receipt.package.packageDigest, /^[a-f0-9]{64}$/);
  assert.equal(receipt.package.manifestSha256, '64494f3a2e993ba476834dd49dfb1a1a60cfe8671b8ab6f08eb5f86045873b77');
  assert.equal(receipt.boundaryProof.emptyAfterCleanup, true);
  assert.equal(receipt.boundaryProof.globalConfigurationMutated, false);
  assert.deepEqual(receipt.orderedCommandResults.map((item) => item.id), [
    'generate-package',
    'codex-version',
    'install-marketplace',
    'malformed-install-target-denied',
    'install-plugin',
    'discover-skill',
    'use-declared-skill',
    'use-undeclared-skill-denied',
    'remove-plugin',
    'use-after-removal-denied',
    'remove-marketplace',
    'zero-residue-readback',
  ]);
  const negativeIds = receipt.negativeAssertions.filter((item) => item.required).map((item) => item.id);
  assert.deepEqual(negativeIds, [
    'preexisting-profile-residue',
    'absent-skill-discovery',
    'undeclared-skill-invocation',
    'malformed-install-target',
    'successful-use-after-removal',
    'residue-after-cleanup',
  ]);
  assert.ok(receipt.orderedCommandResults.find((item) => item.id === 'use-undeclared-skill-denied').assertion);
  assert.equal(receipt.globalConfigurationMutated, false);
  assert.equal(receipt.accepted, true);
});

test('fixture mode is hermetic and does not need the Codex executable', async () => {
  const receiptPath = await temporaryReceipt('ks76-codex-no-cli-');
  const result = run(['--fixture', fixture, '--dry-run', '--receipt', receiptPath], {
    env: { ...process.env, PATH: '' },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(parse(result.stdout).mode, 'fixture');
});

test('required negative cases and explicit negative assertions are fail-closed', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ks76-codex-invalid-fixture-'));
  const invalidFixture = path.join(directory, 'invalid.json');
  const contents = JSON.parse(await readFile(fixture, 'utf8'));
  contents.requiredNegativeCases = contents.requiredNegativeCases.filter((item) => item.id !== 'malformed-install-target');
  await writeFile(invalidFixture, `${JSON.stringify(contents, null, 2)}\n`);
  const result = run(['--fixture', invalidFixture, '--dry-run', '--receipt', path.join(directory, 'receipt.json')]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /required negative assertion denied: malformed-install-target/);
});

test('clean-boundary implementation uses isolated Codex roots and never targets global configuration', async () => {
  const source = await readFile(harness, 'utf8');
  assert.match(source, /CODEX_HOME/);
  assert.match(source, /XDG_CONFIG_HOME/);
  assert.match(source, /XDG_CACHE_HOME/);
  assert.match(source, /XDG_DATA_HOME/);
  assert.match(source, /ignore-user-config/);
  assert.doesNotMatch(source, /process\.env\.HOME\s*=\s*['"]\//);
  assert.match(source, /\.agents', 'plugins', 'marketplace\.json'/);
  assert.match(source, /source: \{ source: 'local', path: '\.\/plugins\/kaleidosphere' \}/);
  assert.match(source, /installation: 'AVAILABLE', authentication: 'ON_INSTALL'/);
  assert.doesNotMatch(source, /marketplaceRoot, '\.codex-plugin'/);
  assert.match(source, /if \(failed\) \{[\s\S]*roots\.configRoots[\s\S]*rm\(base, \{ recursive: true, force: true \}\)/);
});

test('clean-boundary auth import fails closed before Codex when the source is absent', async () => {
  const receiptPath = await temporaryReceipt('ks76-codex-auth-denied-');
  const result = run([
    '--fixture', fixture,
    '--clean-boundary',
    '--auth-file', '/definitely-missing-codex-auth.json',
    '--receipt', receiptPath,
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /auth file denied/);
  assert.doesNotMatch(result.stderr, /unknown argument/);
});

test('receipt schema is closed and names the required evidence fields', async () => {
  const document = JSON.parse(await readFile(schema, 'utf8'));
  assert.equal(document.additionalProperties, false);
  assert.deepEqual(document.required, [
    'schemaVersion',
    'mode',
    'codex',
    'package',
    'boundaryProof',
    'orderedCommandResults',
    'negativeAssertions',
    'accepted',
    'globalConfigurationMutated',
    'nonClaims',
  ]);
});

test('synthetic early CLI failure never reports unexecuted negative cases as denied', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ks76-early-failure-'));
  const { rm } = await import('node:fs/promises');
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cli = path.join(directory, 'synthetic-codex');
  await writeFile(cli, `#!${process.execPath}\nconsole.error('SYNTHETIC_VERSION_FAILURE');process.exit(17);\n`, { mode: 0o700 });
  const result = run(['--clean-boundary', '--fixture', fixture, '--codex', cli, '--receipt', path.join(directory, 'receipt.json')]);
  assert.equal(result.status, 1, result.stderr);
  const receipt = parse(result.stdout);
  assert.equal(receipt.accepted, false);
  assert.equal(receipt.orderedCommandResults.at(-1).id, 'codex-version');
  assert.equal(receipt.codex.version, null, 'failed version probe cannot inherit historical fixture version');
  assert.ok(receipt.negativeAssertions.every((item) => item.observed !== 'denied'), 'no negative rejection was reached');
  assert.equal(receipt.negativeAssertions.find((item) => item.id === 'undeclared-skill-invocation').observed, 'not-run');
  assert.equal(receipt.mode, 'clean-boundary');
});

async function syntheticLifecycle(t, scenario) {
  const directory = await mkdtemp(path.join(tmpdir(), 'ks76-synthetic-lifecycle-'));
  const { rm } = await import('node:fs/promises');
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cli = path.join(directory, 'synthetic-codex');
  const { package: pkg } = JSON.parse(await readFile(fixture, 'utf8'));
  // Explicit local test double, never a host/model result or platform response.
  await writeFile(cli, `#!${process.execPath}
import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
const args=process.argv.slice(2), scenario=${JSON.stringify(scenario)}, pkg=${JSON.stringify(pkg)};
const marker=path.join(process.env.CODEX_HOME,'synthetic-installed');
const emit=(s)=>console.log(s);
if(args[0]==='--version')emit('codex-cli 0.156.1');
else if(args[1]==='marketplace')emit('{}');
else if(args[1]==='add' && args[2].endsWith('@')) {
  console.error(scenario==='malformed-auth-failure'?'SYNTHETIC HTTP 401 Unauthorized; target was not evaluated':scenario==='malformed-generic-failure'?'SYNTHETIC_GENERIC_PROCESS_FAILURE':scenario==='native-target-diagnostic'?'Error: plugin requires --marketplace unless passed as <plugin>@<marketplace>':'invalid plugin target');process.exit(2);
}
else if(args[1]==='add'){writeFileSync(marker,'SYNTHETIC');emit('{}');}
else if(args[1]==='list')emit(scenario==='discovery-missing'?'[]':JSON.stringify([{name:pkg.pluginName}]));
else if(args[1]==='remove'){unlinkSync(marker);emit('{}');}
else if(args[0]==='exec') {
  if(args.at(-1).includes('ks76-not-declared'))emit(scenario==='undeclared-succeeds'?pkg.expectedUseResponse:pkg.deniedUseResponse);
  else if(existsSync(marker) || scenario==='after-removal-succeeds')emit(pkg.expectedUseResponse);
  else emit(scenario==='after-removal-not-refused'?'KaleidoSphere: NOT_REFUSED; '+pkg.expectedUseResponse:scenario==='after-removal-conflicting-response'?'KaleidoSphere: REFUSED_SKILL_NOT_INSTALLED; '+pkg.expectedUseResponse:'KaleidoSphere: REFUSED_SKILL_NOT_INSTALLED');
} else {console.error('UNEXPECTED_SYNTHETIC_COMMAND');process.exit(19);}
`, { mode: 0o700 });
  const result = run(['--clean-boundary', '--fixture', fixture, '--codex', cli, '--receipt', path.join(directory, 'receipt.json')]);
  return { result, receipt: parse(result.stdout) };
}

for (const scenario of ['allowed', 'native-target-diagnostic']) {
test(`synthetic completed lifecycle ${scenario} distinguishes triggered denials from permitted guard counterparts`, async (t) => {
  const { result, receipt } = await syntheticLifecycle(t, scenario);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(receipt.schemaVersion, 'kaleidosphere/k4c-codex-isolated-e2e/v2');
  assert.equal(receipt.codex.version, 'codex-cli 0.156.1', 'observed test-double version is not historical fixture version');
  assert.equal(receipt.accepted, true);
  const observed = Object.fromEntries(receipt.negativeAssertions.map((item) => [item.id, item.observed]));
  assert.deepEqual(observed, {
    'preexisting-profile-residue': 'not-triggered',
    'absent-skill-discovery': 'not-triggered',
    'undeclared-skill-invocation': 'denied',
    'malformed-install-target': 'denied',
    'successful-use-after-removal': 'denied',
    'residue-after-cleanup': 'not-triggered',
  });
  const refusal = receipt.orderedCommandResults.find((item) => item.id === 'use-undeclared-skill-denied');
  assert.equal(refusal.result.exitCode, 0, 'content refusal can exit successfully');
  assert.equal(receipt.boundaryProof.emptyAfterCleanup, true);
});
}

for (const [scenario, failedCase, notRunCase] of [
  ['discovery-missing', 'absent-skill-discovery', 'undeclared-skill-invocation'],
  ['undeclared-succeeds', 'undeclared-skill-invocation', 'successful-use-after-removal'],
  ['after-removal-succeeds', 'successful-use-after-removal', 'residue-after-cleanup'],
  ['after-removal-not-refused', 'successful-use-after-removal', 'residue-after-cleanup'],
  ['after-removal-conflicting-response', 'successful-use-after-removal', 'residue-after-cleanup'],
  ['malformed-auth-failure', 'malformed-install-target', 'absent-skill-discovery'],
  ['malformed-generic-failure', 'malformed-install-target', 'absent-skill-discovery'],
]) {
  test(`synthetic ${scenario} records failed check without promoting later unexecuted checks`, async (t) => {
    const { result, receipt } = await syntheticLifecycle(t, scenario);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.equal(receipt.accepted, false);
    const observed = Object.fromEntries(receipt.negativeAssertions.map((item) => [item.id, item.observed]));
    assert.equal(observed[failedCase], 'failed');
    assert.equal(observed[notRunCase], 'not-run');
    assert.equal(receipt.boundaryProof.emptyAfterCleanup, true, 'recovery cleanup is not lifecycle success');
  });
}

test('v2 schema preserves observed outcomes separately from historical fixture v1', async () => {
  const document = JSON.parse(await readFile(schema.replace('v1.json', 'v2.json'), 'utf8'));
  assert.equal(document.additionalProperties, false);
  assert.equal(document.properties.mode.const, 'clean-boundary');
  assert.equal(document.properties.schemaVersion.const, 'kaleidosphere/k4c-codex-isolated-e2e/v2');
  assert.deepEqual(document.$defs.negative.properties.observed.enum, ['denied', 'not-triggered', 'failed', 'not-run']);
});
