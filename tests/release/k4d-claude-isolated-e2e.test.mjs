import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');
const harness = path.join(root, 'scripts', 'release', 'k4d-claude-isolated-e2e.mjs');
const fixture = path.join(root, 'tests', 'fixtures', 'release', 'k4d-claude-cli-transcripts-v1.json');
const schema = path.join(root, 'docs', 'release', 'k4d-claude-e2e-schema-v1.json');

function run(args, options = {}) {
  return spawnSync(process.execPath, [harness, ...args], { cwd: root, encoding: 'utf8', ...options });
}

function parse(stdout) {
  const start = stdout.indexOf('{');
  assert.notEqual(start, -1, stdout);
  return JSON.parse(stdout.slice(start));
}

async function temporaryReceipt(prefix = 'ks77-claude-e2e-test-') {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  return path.join(directory, 'receipt.json');
}

test('fixture mode records the complete ordered install/discover/use/deny/remove/readback contract', async () => {
  const receiptPath = await temporaryReceipt();
  const result = run(['--fixture', fixture, '--receipt', receiptPath], {
    env: { ...process.env, PATH: '/definitely-no-claude-on-path' },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const receipt = parse(result.stdout);
  const persisted = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.deepEqual(persisted, receipt);
  assert.equal(receipt.schemaVersion, 'kaleidosphere/k4d-claude-isolated-e2e/v1');
  assert.equal(receipt.mode, 'fixture');
  assert.equal(receipt.claude.binary, 'claude');
  assert.equal(receipt.claude.version, '2.1.259');
  assert.match(receipt.package.packageDigest, /^[a-f0-9]{64}$/);
  assert.equal(receipt.package.manifestSha256, 'b8a53a99c90b10982ca7cd15291d000291dc6a0e511b6b6ff53b2222741ae42d');
  assert.equal(receipt.boundaryProof.clean, true);
  assert.equal(receipt.boundaryProof.emptyAfterCleanup, true);
  assert.equal(receipt.boundaryProof.globalConfigurationMutated, false);
  assert.deepEqual(receipt.orderedCommandResults.map((item) => item.id), [
    'claude-version',
    'install-marketplace',
    'install-plugin',
    'discover-skill',
    'use-declared-skill',
    'use-undeclared-skill-denied',
    'malformed-install-target-denied',
    'remove-plugin',
    'discover-skill-after-removal',
    'use-declared-skill-after-removal-denied',
    'remove-marketplace',
    'marketplace-absent-readback',
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

test('fixture mode is hermetic and does not need the claude executable', async () => {
  const result = run(['--fixture', fixture, '--dry-run'], {
    env: { ...process.env, PATH: '' },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(parse(result.stdout).mode, 'fixture');
});

test('required negative cases and explicit negative assertions are fail-closed', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ks77-claude-invalid-fixture-'));
  const invalidFixture = path.join(directory, 'invalid.json');
  const contents = JSON.parse(await readFile(fixture, 'utf8'));
  contents.requiredNegativeCases = contents.requiredNegativeCases.filter((item) => item.id !== 'malformed-install-target');
  await writeFile(invalidFixture, `${JSON.stringify(contents, null, 2)}\n`);
  const result = run(['--fixture', invalidFixture, '--dry-run', '--receipt', path.join(directory, 'receipt.json')]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /required negative assertion denied: malformed-install-target/);
});

test('clean-boundary implementation uses isolated Claude roots and never targets global configuration', async () => {
  const source = await readFile(harness, 'utf8');
  assert.match(source, /CLAUDE_CONFIG_DIR: roots\.config/);
  assert.match(source, /HOME: roots\.home/);
  assert.doesNotMatch(source, /process\.env\.HOME\s*=\s*['"]\//);
  assert.doesNotMatch(source, /CODEX_HOME|XDG_/);
  assert.doesNotMatch(source, /\.codex-plugin/);
  assert.match(source, /\.claude-plugin', 'marketplace\.json'/);
  assert.match(source, /source: '\.\/plugins\/kaleidosphere'/);
  assert.match(source, /if \(owned\) await rm\(boundary, \{ recursive: true, force: true \}\)/);
});

test('--dry-run is only valid with the recorded fixture route', () => {
  const result = run(['--clean-boundary', '--dry-run']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--dry-run is only valid with --fixture/);
});

test('receipt schema is closed and names the required evidence fields', async () => {
  const document = JSON.parse(await readFile(schema, 'utf8'));
  assert.equal(document.additionalProperties, false);
  assert.deepEqual(document.required, [
    'schemaVersion',
    'mode',
    'claude',
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
  const directory = await mkdtemp(path.join(tmpdir(), 'ks77-early-failure-'));
  const { rm } = await import('node:fs/promises');
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cli = path.join(directory, 'synthetic-claude');
  await writeFile(cli, `#!${process.execPath}\nconsole.error('SYNTHETIC_VERSION_FAILURE');process.exit(17);\n`, { mode: 0o700 });
  const result = run(['--clean-boundary', '--fixture', fixture, '--claude', cli, '--receipt', path.join(directory, 'receipt.json')]);
  assert.equal(result.status, 1, result.stderr);
  const receipt = parse(result.stdout);
  assert.equal(receipt.accepted, false);
  assert.equal(receipt.orderedCommandResults.at(-2).id, 'claude-version');
  assert.equal(receipt.claude.version, null, 'failed version probe cannot inherit historical fixture version');
  assert.equal(receipt.orderedCommandResults.at(-1).id, 'harness-cleanup-readback');
  assert.ok(receipt.negativeAssertions.every((item) => item.observed !== 'denied'), 'no negative rejection was reached');
  assert.equal(receipt.negativeAssertions.find((item) => item.id === 'undeclared-skill-invocation').observed, 'not-run');
});

for (const cacheKind of ['file', 'empty-directory']) {
test(`synthetic CLI retained cache ${cacheKind} is distinct from actual harness cleanup`, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ks77-cache-readback-'));
  const { rm } = await import('node:fs/promises');
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cli = path.join(directory, 'synthetic-claude');
  // This controlled subprocess exercises the evidence helper, not a Claude model or marketplace.
  await writeFile(cli, `#!${process.execPath}
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const args=process.argv.slice(2), config=process.env.CLAUDE_CONFIG_DIR;
const marker=path.join(path.dirname(process.argv[1]),'synthetic-state');
const emit=(s)=>console.log(s);
if(args[0]==='--version')emit('2.1.259');
else if(args[1]==='marketplace' && args[2]==='add')emit('Successfully added marketplace');
else if(args[1]==='marketplace' && args[2]==='remove')emit('Successfully removed marketplace');
else if(args[1]==='marketplace' && args[2]==='list')emit('[]');
else if(args[1]==='install' && args[2]==='kaleidosphere-agent-skill@kaleidosphere-local') {
  mkdirSync(path.join(config,'plugins/cache/kaleidosphere-agent-skill/0.26.0'),{recursive:true});
  if(${JSON.stringify(cacheKind)}==='file')writeFileSync(path.join(config,'plugins/cache/kaleidosphere-agent-skill/0.26.0/SKILL.md'),'SYNTHETIC_CACHE_RETAINED');
  writeFileSync(marker,'SYNTHETIC');emit('Successfully installed plugin');
} else if(args[1]==='install')emit('not found in marketplace');
else if(args[1]==='remove') { writeFileSync(marker,'REMOVED');emit('Successfully uninstalled plugin'); }
else if(args[1]==='list' || args[1]==='details') {
  const { readFileSync }=await import('node:fs');
  const removed=readFileSync(marker,'utf8')==='REMOVED';
  if(args[1]==='list')emit(removed?'[]':'[{"name":"kaleidosphere-agent-skill"}]');
  else emit(removed?'not found':'kaleidosphere-agent-skill Skills (1) Agents (0) Hooks (0) MCP servers (0) LSP servers (0)');
} else { console.error('UNEXPECTED_SYNTHETIC_COMMAND');process.exit(19); }
`, { mode: 0o700 });
  const result = run(['--clean-boundary', '--fixture', fixture, '--claude', cli, '--receipt', path.join(directory, 'receipt.json')]);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const receipt = parse(result.stdout);
  assert.equal(receipt.boundaryProof.nativeFilesystemEmpty, false);
  assert.ok(receipt.boundaryProof.nativeResiduePaths.some((p) => p.includes('plugins/cache/kaleidosphere-agent-skill')));
  assert.equal(receipt.boundaryProof.registrationClean, true);
  assert.equal(receipt.boundaryProof.emptyAfterCleanup, true);
  assert.deepEqual(receipt.boundaryProof.residuePaths, []);
  assert.equal(receipt.boundaryProof.temporaryBoundaryRemoved, true);
  assert.equal(receipt.orderedCommandResults.at(-1).id, 'harness-cleanup-readback');
  assert.equal(receipt.schemaVersion, 'kaleidosphere/k4d-claude-isolated-e2e/v2');
  assert.equal(receipt.accepted, true);
  const observed = Object.fromEntries(receipt.negativeAssertions.map((item) => [item.id, item.observed]));
  assert.equal(observed['preexisting-profile-residue'], 'not-triggered');
  assert.equal(observed['absent-skill-discovery'], 'not-triggered');
  assert.equal(observed['undeclared-skill-invocation'], 'denied');
  assert.equal(observed['malformed-install-target'], 'denied');
  assert.equal(observed['successful-use-after-removal'], 'denied');
  assert.equal(observed['residue-after-cleanup'], 'not-triggered');
  assert.ok(receipt.nonClaims.some((text) => text.includes('No authenticated Claude model/skill use')));
});
}

test('v2 schema keeps native residue, registration and actual harness cleanup distinct', async () => {
  const document = JSON.parse(await readFile(schema.replace('v1.json', 'v2.json'), 'utf8'));
  assert.equal(document.additionalProperties, false);
  assert.equal(document.properties.mode.const, 'clean-boundary');
  assert.equal(document.properties.schemaVersion.const, 'kaleidosphere/k4d-claude-isolated-e2e/v2');
  assert.deepEqual(document.$defs.negative.properties.observed.enum, ['denied', 'not-triggered', 'failed', 'not-run']);
  for (const field of ['registrationClean', 'nativeResiduePaths', 'nativeFilesystemEmpty', 'temporaryBoundaryRemoved']) {
    assert.ok(document.properties.boundaryProof.required.includes(field));
  }
});