import assert from 'node:assert/strict';
import { cp, chmod, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');
const guard = path.join(root, 'scripts', 'release', 'check-k4d-skills-only.mjs');
const packageRoot = path.join(root, 'generated', 'claude', 'kaleidosphere');
const canonicalRoot = path.join(root, 'agent-skills', 'kaleidosphere');
const policy = path.join(root, 'docs', 'release', 'k4d-skills-only-policy-v1.json');
const fixture = path.join(root, 'tests', 'fixtures', 'release', 'k4d-prohibited-package-inputs-v1.json');

function runGuard(packageDir, extra = []) {
  return spawnSync(process.execPath, [
    guard,
    '--package', packageDir,
    '--canonical', canonicalRoot,
    '--policy', policy,
    '--fixture', fixture,
    '--dry-run',
    ...extra,
  ], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '--jitless' }, cwd: root });
}

function receipt(result) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

function denied(result, reason) {
  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, reason);
}

async function packageCopy(prefix) {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  const copy = path.join(dir, 'package');
  await cp(packageRoot, copy, { recursive: true });
  return copy;
}

async function manifestPath(packageDir) {
  return path.join(packageDir, '.claude-plugin', 'plugin.json');
}

async function mutateManifest(packageDir, mutate) {
  const file = await manifestPath(packageDir);
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  mutate(manifest);
  await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

test('positive: canonical skill bytes plus the matching Apache-2.0 manifest pass', async () => {
  const packageDir = await packageCopy('ks77-static-positive-');
  const result = runGuard(packageDir);
  const actual = receipt(result);

  assert.equal(actual.schemaVersion, 'kaleidosphere/k4d-skills-only-security-license-receipt/v1');
  assert.equal(actual.packageVersion, '0.26.0');
  assert.equal(actual.manifest.license, 'Apache-2.0');
  assert.equal(actual.packageDigest.length, 64);
  assert.deepEqual(actual.scannedPaths.package, [
    '.claude-plugin/plugin.json',
    'skills/kaleidosphere/SKILL.md',
    'skills/kaleidosphere/references/contract.json',
    'skills/kaleidosphere/scripts/validate-request.mjs',
  ]);
  assert.deepEqual(actual.scannedPaths.canonical, [
    'SKILL.md',
    'references/contract.json',
    'scripts/validate-request.mjs',
  ]);
  assert.equal(actual.files.length, 3);
  assert.equal(actual.checks.skillsOnly, true);
  assert.equal(actual.checks.canonicalBytes, true);
  assert.equal(actual.checks.licenseSafe, true);
  assert.equal(actual.checks.secretFree, true);
  assert.equal(actual.checks.dependencyFree, true);
  assert.equal(actual.checks.noExecutablePayloads, true);
  assert.equal(actual.checks.noSymlinks, true);
  assert.equal(actual.checks.noExternalCommands, true);
  assert.equal(actual.publicationPerformed, false);
  assert.equal(actual.accepted, true);
  assert.doesNotMatch(JSON.stringify(actual), /sk-[A-Za-z0-9]{20,}|BEGIN .*PRIVATE KEY/i);
});

test('negative fixture coverage: secret-like values are denied without echoing contents', async () => {
  const packageDir = await packageCopy('ks77-static-secret-');
  const file = path.join(packageDir, 'skills', 'kaleidosphere', 'SKILL.md');
  const secret = 'sk-' + 'A'.repeat(24);
  await writeFile(file, `${await readFile(file, 'utf8')}\nexample: ${secret}\n`);
  const result = runGuard(packageDir);
  denied(result, /secret-like value denied/);
  assert.doesNotMatch(result.stderr, new RegExp(secret));
});

test('negative fixture coverage: app, MCP, hook, and undeclared dependency declarations are denied', async () => {
  const app = await packageCopy('ks77-static-app-');
  await mutateManifest(app, (manifest) => { manifest.apps = []; });
  denied(runGuard(app), /app declaration denied/);

  const mcp = await packageCopy('ks77-static-mcp-');
  await mutateManifest(mcp, (manifest) => { manifest.mcpServers = {}; });
  denied(runGuard(mcp), /MCP configuration denied/);

  const hook = await packageCopy('ks77-static-hook-');
  await mutateManifest(hook, (manifest) => { manifest.hooks = {}; });
  denied(runGuard(hook), /hook declaration denied/);

  const dependency = await packageCopy('ks77-static-dependency-');
  await mutateManifest(dependency, (manifest) => { manifest.dependencies = { 'not-allowed': '1.0.0' }; });
  denied(runGuard(dependency), /undeclared dependency denied/);
});

test('negative fixture coverage: executable payloads and symlink escapes are denied', async () => {
  const executable = await packageCopy('ks77-static-executable-');
  const skill = path.join(executable, 'skills', 'kaleidosphere', 'SKILL.md');
  await chmod(skill, 0o755);
  denied(runGuard(executable), /executable payload denied/);

  const escaped = await packageCopy('ks77-static-symlink-');
  const escapedSkill = path.join(escaped, 'skills', 'kaleidosphere', 'SKILL.md');
  await rm(escapedSkill);
  await symlink('/etc/hosts', escapedSkill);
  denied(runGuard(escaped), /generated package symlink denied/);
});

test('negative fixture coverage: a license mismatch is denied before digest acceptance', async () => {
  const packageDir = await packageCopy('ks77-static-license-');
  await mutateManifest(packageDir, (manifest) => { manifest.license = 'MIT'; });
  denied(runGuard(packageDir), /license mismatch denied/);
});

test('guard is static and does not import or invoke an external command runner', async () => {
  const source = await readFile(guard, 'utf8');
  assert.doesNotMatch(source, /node:child_process|spawnSync|spawn\(|execFile/);
});