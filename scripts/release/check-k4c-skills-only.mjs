#!/usr/bin/env node
// Fail-closed static security guard for the generated K4C Codex package.
// This guard only reads package inputs and writes an optional local receipt. It
// deliberately does not invoke the repository generator, Python, or any other
// external command; generator and @plugin-creator acceptance remain separate
// gates recorded by validate-k4c-codex-plugin.mjs.

import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const defaultPackage = path.join(root, 'packages', 'codex', 'kaleidosphere');
const defaultCanonical = path.join(root, 'agent-skills', 'kaleidosphere');
const defaultPolicy = path.join(root, 'docs', 'release', 'k4c-skills-only-policy-v1.json');
const defaultFixture = path.join(root, 'tests', 'fixtures', 'release', 'k4c-prohibited-package-inputs-v1.json');
const defaultReceipt = path.join(root, 'verification', 'k4c', 'security-license-receipt-v1.json');
const POLICY_SCHEMA = 'kaleidosphere/k4c-skills-only-policy/v1';
const FIXTURE_SCHEMA = 'kaleidosphere/k4c-prohibited-package-inputs/v1';
const RECEIPT_SCHEMA = 'kaleidosphere/k4c-security-license-receipt/v1';
const PACKAGE_DIGEST_SCHEMA = 'kaleidosphere/k4c-codex-plugin-package-digest/v1';
const SHA256 = /^[a-f0-9]{64}$/;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function comparePath(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function relSafe(file) {
  const normalized = path.posix.normalize(file);
  if (path.isAbsolute(file) || normalized === '..' || normalized.startsWith('../') || normalized.includes('\0')) {
    throw new Error(`unsafe relative path denied: ${file}`);
  }
  return normalized;
}

function inside(scope, candidate) {
  return candidate === scope || candidate.startsWith(`${scope}${path.sep}`);
}

function resolveReadScope(value, label) {
  const resolved = path.resolve(value);
  if (resolved.includes('\0') || (!inside(root, resolved) && !inside(os.tmpdir(), resolved))) {
    throw new Error(`${label} outside repository or temporary read scope denied`);
  }
  return resolved;
}

function resolveReceipt(value) {
  const resolved = path.resolve(value);
  if (resolved.includes('\0') || !inside(root, resolved)) throw new Error('receipt path outside repository denied');
  return resolved;
}

function labelPath(file) {
  return inside(root, file) ? path.relative(root, file).split(path.sep).join('/') : file;
}

function parseArgs(argv) {
  const args = {
    packageDir: defaultPackage,
    canonicalDir: defaultCanonical,
    policy: defaultPolicy,
    fixture: defaultFixture,
    receipt: defaultReceipt,
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (['--package', '--out', '--canonical', '--policy', '--fixture', '--receipt'].includes(arg)) {
      const value = argv[index += 1];
      if (value === undefined || value.startsWith('-')) throw new Error(`missing value for ${arg}`);
      if (arg === '--package' || arg === '--out') args.packageDir = resolveReadScope(value, 'package root');
      else if (arg === '--canonical') args.canonicalDir = resolveReadScope(value, 'canonical root');
      else if (arg === '--policy') args.policy = resolveReadScope(value, 'policy');
      else if (arg === '--fixture') args.fixture = resolveReadScope(value, 'negative-case fixture');
      else args.receipt = resolveReceipt(value);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

async function readJson(file, label) {
  let contents;
  try {
    contents = await readFile(file, 'utf8');
  } catch (error) {
    throw new Error(`${label} denied: ${error.code || 'unreadable'}: ${labelPath(file)}`);
  }
  try {
    return JSON.parse(contents);
  } catch {
    throw new Error(`${label} denied: invalid JSON: ${labelPath(file)}`);
  }
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} denied: expected object`);
}

function assertPolicy(policy) {
  assertObject(policy, 'skills-only policy');
  if (policy.schemaVersion !== POLICY_SCHEMA) throw new Error('skills-only policy schema drift denied');
  for (const section of ['package', 'canonical', 'manifest', 'packageSurface', 'contentScanners', 'receipt', 'determinism']) {
    assertObject(policy[section], `skills-only policy ${section}`);
  }
  if (policy.package.license !== 'Apache-2.0') throw new Error('policy license must be Apache-2.0');
  if (!SHA256.test(policy.package.manifestSha256)) throw new Error('policy manifest digest denied');
  if (policy.receipt.schemaVersion !== RECEIPT_SCHEMA) throw new Error('policy receipt schema drift denied');
  if (policy.receipt.externalCommandsCalled !== false) throw new Error('policy external command allowance denied');
  if (policy.determinism.timestamps !== false || policy.determinism.randomValues !== false || policy.determinism.secretContentsInReceipt !== false) {
    throw new Error('policy determinism boundary denied');
  }
}

function assertFixture(fixture, policy) {
  assertObject(fixture, 'prohibited package input fixture');
  if (fixture.schemaVersion !== FIXTURE_SCHEMA) throw new Error('prohibited package input fixture schema drift denied');
  if (fixture.policy !== 'docs/release/k4c-skills-only-policy-v1.json') throw new Error('prohibited package input fixture policy binding denied');
  const required = fixture.coverage?.requiredNegativeCaseIds;
  if (!Array.isArray(required) || required.length === 0) throw new Error('prohibited package input fixture coverage denied');
  const cases = fixture.negativeCases;
  if (!Array.isArray(cases)) throw new Error('prohibited package input fixture cases denied');
  const ids = cases.map((item) => item && item.id);
  if (new Set(ids).size !== ids.length || ids.some((id) => typeof id !== 'string')) throw new Error('prohibited package input fixture case ids denied');
  for (const id of required) {
    if (!ids.includes(id)) throw new Error(`prohibited package input fixture missing required case: ${id}`);
  }
  if (fixture.positiveCase?.expected !== 'accepted') throw new Error('prohibited package input fixture positive case denied');
  if (!Array.isArray(fixture.coverage.receiptMustExclude) || fixture.coverage.receiptMustExclude.length === 0) {
    throw new Error('prohibited package input fixture receipt boundary denied');
  }
  const expectedIds = ['secret-like-value', 'app-declaration', 'mcp-config', 'hook', 'executable-payload', 'symlink-escape', 'undeclared-dependency', 'license-mismatch'];
  for (const id of expectedIds) if (!required.includes(id)) throw new Error(`prohibited package input fixture incomplete: ${id}`);
  if (policy.package.skillName !== 'kaleidosphere') throw new Error('policy skill binding denied');
}

async function walkTree(base, label) {
  let rootStat;
  try {
    rootStat = await lstat(base);
  } catch (error) {
    throw new Error(`${label} denied: ${error.code || 'unreadable'}: ${labelPath(base)}`);
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error(`${label} denied: root is not a plain directory`);
  const files = [];
  const directories = [];
  const visit = async (prefix) => {
    let entries;
    try {
      entries = await readdir(path.join(base, prefix || '.'), { withFileTypes: true });
    } catch (error) {
      throw new Error(`${label} denied: ${error.code || 'unreadable'}: ${prefix || '.'}`);
    }
    entries.sort((a, b) => comparePath(a.name, b.name));
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      relSafe(relative);
      if (entry.isSymbolicLink()) throw new Error(`${label} symlink denied: ${relative}`);
      if (entry.isDirectory()) {
        directories.push(relative);
        await visit(relative);
        continue;
      }
      const stat = await lstat(path.join(base, relative));
      if (!stat.isFile()) throw new Error(`${label} non-regular path denied: ${relative}`);
      files.push({ relative, mode: stat.mode });
    }
  };
  await visit('');
  return { files, directories };
}

function pathComponentsDenied(relative, policy) {
  const components = relative.toLowerCase().split('/');
  return policy.packageSurface.forbiddenPathComponents.some((item) => components.includes(item.toLowerCase()));
}

function extensionDenied(relative, policy) {
  const lower = relative.toLowerCase();
  return policy.packageSurface.forbiddenExtensions.some((extension) => lower.endsWith(extension));
}

function compileScanners(policy) {
  const scanner = policy.contentScanners;
  const compile = (pattern, label) => {
    try {
      return new RegExp(pattern, 'im');
    } catch {
      throw new Error(`policy ${label} pattern denied`);
    }
  };
  return {
    secrets: scanner.secretPatterns.map((pattern) => compile(pattern, 'secret')),
    secretEnvironment: compile(scanner.secretEnvironmentPattern, 'secret environment'),
    remoteExecution: compile(scanner.remoteExecutionPattern, 'remote execution'),
    app: compile(scanner.declarationPatterns.app, 'app declaration'),
    mcp: compile(scanner.declarationPatterns.mcp, 'MCP declaration'),
    hook: compile(scanner.declarationPatterns.hook, 'hook declaration'),
    dependency: new RegExp(`(?:["'](?:${policy.packageSurface.dependencyDeclarationKeys.join('|')})["'])\\s*:`, 'im'),
  };
}

function scanText(bytes, relative, context, scanners) {
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error(`non-UTF8 payload denied in ${context}: ${relative}`);
  if (scanners.secrets.some((pattern) => pattern.test(text)) || scanners.secretEnvironment.test(text)) {
    throw new Error(`secret-like value denied in ${context}: ${relative}`);
  }
  if (scanners.remoteExecution.test(text)) throw new Error(`remote executable pattern denied in ${context}: ${relative}`);
  if (scanners.app.test(text)) throw new Error(`app declaration denied in ${context}: ${relative}`);
  if (scanners.mcp.test(text)) throw new Error(`MCP configuration denied in ${context}: ${relative}`);
  if (scanners.hook.test(text)) throw new Error(`hook declaration denied in ${context}: ${relative}`);
  if (scanners.dependency.test(text)) throw new Error(`undeclared dependency denied in ${context}: ${relative}`);
}

function scanBinaryAndMode(record, bytes, context, policy) {
  if ((record.mode & 0o111) !== 0) throw new Error(`executable payload denied in ${context}: ${record.relative}`);
  if (extensionDenied(record.relative, policy) || bytes.subarray(0, 2).equals(Buffer.from('MZ')) || bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    throw new Error(`executable payload denied in ${context}: ${record.relative}`);
  }
}

function scanModuleSpecifiers(text, relative, policy) {
  if (!/\.(?:mjs|js|cjs)$/i.test(relative)) return;
  const importPattern = /\bimport\s*(?:[^'";]*?\sfrom\s*)?["']([^"']+)["']/g;
  const requirePattern = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const pattern of [importPattern, requirePattern]) {
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      if (!policy.packageSurface.allowedModulePrefixes.some((prefix) => match[1].startsWith(prefix))) {
        throw new Error(`undeclared dependency denied in package file: ${relative}`);
      }
    }
  }
}

function assertNoForbiddenKeys(value, forbidden, location = 'manifest') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenKeys(item, forbidden, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (forbidden.includes(key)) {
      const dependencyKeys = new Set(['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'bundleDependencies', 'bundledDependencies']);
      if (dependencyKeys.has(key)) throw new Error(`undeclared dependency denied in ${location}.${key}`);
      if (key === 'apps' || key === 'agents') throw new Error(`app declaration denied in ${location}.${key}`);
      if (key === 'mcp' || key === 'mcpServers' || key === 'servers') throw new Error(`MCP configuration denied in ${location}.${key}`);
      throw new Error(`hook declaration denied in ${location}.${key}`);
    }
    assertNoForbiddenKeys(child, forbidden, `${location}.${key}`);
  }
}

function expectedDirectories(files) {
  const expected = new Set();
  for (const file of files) {
    const parts = file.split('/');
    for (let index = 1; index < parts.length; index += 1) expected.add(parts.slice(0, index).join('/'));
  }
  return expected;
}

async function loadCanonical(canonicalDir, policy, fixturePath) {
  const canonicalTree = await walkTree(canonicalDir, 'canonical source');
  const fixture = await readJson(fixturePath, 'canonical digest fixture');
  if (fixture.schemaVersion !== 'kaleidosphere/k4c-canonical-skill-digests/v1' || fixture.canonicalSource !== policy.canonical.source) {
    throw new Error('canonical digest fixture binding denied');
  }
  if (!fixture.files || typeof fixture.files !== 'object' || Array.isArray(fixture.files) || Object.keys(fixture.files).length === 0) {
    throw new Error('canonical digest fixture file map denied');
  }
  const actualNames = canonicalTree.files.map((record) => record.relative).sort(comparePath);
  const declaredNames = Object.keys(fixture.files).sort(comparePath);
  if (actualNames.length !== declaredNames.length || actualNames.some((name, index) => name !== declaredNames[index])) {
    throw new Error('undeclared canonical skill file denied');
  }
  for (const record of canonicalTree.files) {
    if (pathComponentsDenied(record.relative, policy)) throw new Error(`forbidden canonical path denied: ${record.relative}`);
    const bytes = await readFile(path.join(canonicalDir, record.relative));
    scanBinaryAndMode(record, bytes, 'canonical source', policy);
    const scanners = compileScanners(policy);
    scanText(bytes, record.relative, 'canonical skill', scanners);
    scanModuleSpecifiers(bytes.toString('utf8'), record.relative, policy);
    const digest = sha256(bytes);
    if (!SHA256.test(fixture.files[record.relative]) || digest !== fixture.files[record.relative]) {
      throw new Error(`canonical skill digest mismatch denied: ${record.relative}`);
    }
  }
  if (!Object.hasOwn(fixture.files, 'SKILL.md')) throw new Error('canonical skill must contain SKILL.md');
  return { tree: canonicalTree, fixture, files: new Map(canonicalTree.files.map((record) => [record.relative, record])) };
}

async function inspectPackage(packageDir, canonicalDir, canonical, policy) {
  const packageTree = await walkTree(packageDir, 'generated package');
  if (packageTree.files.length === 0) throw new Error('empty generated package denied');
  const scanners = compileScanners(policy);
  for (const record of packageTree.files) {
    if (pathComponentsDenied(record.relative, policy)) throw new Error(`forbidden package path denied: ${record.relative}`);
    const bytes = await readFile(path.join(packageDir, record.relative));
    scanBinaryAndMode(record, bytes, 'generated package', policy);
    scanText(bytes, record.relative, 'generated package', scanners);
    scanModuleSpecifiers(bytes.toString('utf8'), record.relative, policy);
    if (record.relative.endsWith('.json')) {
      try {
        JSON.parse(bytes.toString('utf8'));
      } catch {
        throw new Error(`invalid package JSON denied: ${record.relative}`);
      }
    }
  }
  const expectedFiles = [policy.package.manifest, ...Object.keys(canonical.fixture.files).map((relative) => `${policy.package.skillRoot}/${relative}`)].sort(comparePath);
  const actualFiles = packageTree.files.map((record) => record.relative).sort(comparePath);
  if (actualFiles.length !== expectedFiles.length || actualFiles.some((name, index) => name !== expectedFiles[index])) {
    const extra = actualFiles.find((name) => !expectedFiles.includes(name));
    throw new Error(`${extra?.startsWith('skills/') ? 'extra generated skill' : 'extra generated'} file denied: ${extra || 'package file set drift'}`);
  }
  const expectedDirs = expectedDirectories(expectedFiles);
  for (const directory of packageTree.directories) {
    if (!expectedDirs.has(directory)) throw new Error(`extra generated directory denied: ${directory}`);
  }
  const manifestPath = path.join(packageDir, policy.package.manifest);
  const manifestBytes = await readFile(manifestPath);
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch {
    throw new Error('plugin manifest JSON denied');
  }
  assertObject(manifest, 'plugin manifest');
  if (manifest.license !== policy.package.license) throw new Error(`license mismatch denied: expected ${policy.package.license}`);
  if (manifest.version !== policy.package.version) throw new Error('plugin manifest version denied');
  if (manifest.skills !== policy.manifest.skillsValue) throw new Error('plugin manifest skills path denied');
  if (manifest.name !== 'kaleidosphere-agent-skill') throw new Error('plugin manifest name denied');
  const actualKeys = Object.keys(manifest).sort(comparePath);
  const allowedKeys = [...policy.manifest.allowedTopLevelKeys].sort(comparePath);
  for (const key of actualKeys) {
    if (!allowedKeys.includes(key)) {
      if (policy.manifest.forbiddenKeys.includes(key)) assertNoForbiddenKeys({ [key]: manifest[key] }, policy.manifest.forbiddenKeys);
      throw new Error(`undeclared manifest field denied: ${key}`);
    }
  }
  for (const key of policy.manifest.requiredTopLevelKeys) if (!Object.hasOwn(manifest, key)) throw new Error(`missing manifest field denied: ${key}`);
  assertNoForbiddenKeys(manifest, policy.manifest.forbiddenKeys);
  if (sha256(manifestBytes) !== policy.package.manifestSha256) throw new Error('plugin manifest digest mismatch denied');

  for (const [relative, canonicalRecord] of canonical.files) {
    const packageRelative = `${policy.package.skillRoot}/${relative}`;
    const packageBytes = await readFile(path.join(packageDir, packageRelative));
    if (!packageBytes.equals(await readFile(path.join(canonicalDir, relative)))) {
      throw new Error(`canonical skill byte mismatch denied: ${packageRelative}`);
    }
    if (sha256(packageBytes) !== canonical.fixture.files[relative]) throw new Error(`generated skill digest mismatch denied: ${packageRelative}`);
    if (canonicalRecord.mode & 0o111) throw new Error(`executable payload denied in canonical source: ${relative}`);
  }
  return { tree: packageTree, manifestBytes };
}

function packageDigest(packageVersion, canonicalSource, manifestPath, manifestDigest, files) {
  return sha256(JSON.stringify({
    schemaVersion: PACKAGE_DIGEST_SCHEMA,
    packageVersion,
    canonicalSource,
    manifest: { path: manifestPath, sha256: manifestDigest },
    skillFiles: files.map((file) => ({ path: file.path, sha256: file.sha256 })),
  }, null, 2));
}

function buildReceipt(packageDir, canonicalDir, policy, fixturePath, canonical, inspected) {
  const files = [...canonical.files.entries()].map(([relative]) => ({
    path: `${policy.package.skillRoot}/${relative}`,
    canonicalPath: `${policy.canonical.source}/${relative}`,
    sha256: canonical.fixture.files[relative],
  })).sort((a, b) => comparePath(a.path, b.path));
  const packageDigestValue = packageDigest(policy.package.version, policy.canonical.source, policy.package.manifest, policy.package.manifestSha256, files);
  const receipt = {
    schemaVersion: RECEIPT_SCHEMA,
    policy: 'docs/release/k4c-skills-only-policy-v1.json',
    fixture: 'tests/fixtures/release/k4c-prohibited-package-inputs-v1.json',
    packagePath: labelPath(packageDir),
    canonicalSource: labelPath(canonicalDir),
    packageVersion: policy.package.version,
    manifest: { path: policy.package.manifest, sha256: policy.package.manifestSha256, license: policy.package.license },
    scannedPaths: {
      package: inspected.tree.files.map((record) => record.relative).sort(comparePath),
      canonical: canonical.tree.files.map((record) => record.relative).sort(comparePath),
      packageDirectories: inspected.tree.directories.slice().sort(comparePath),
      canonicalDirectories: canonical.tree.directories.slice().sort(comparePath),
      inputs: [
        'docs/release/k4c-skills-only-policy-v1.json',
        'tests/fixtures/release/k4c-prohibited-package-inputs-v1.json',
        policy.canonical.digestFixture,
      ].sort(comparePath),
    },
    files,
    packageDigest: packageDigestValue,
    checks: {
      skillsOnly: true,
      canonicalBytes: true,
      licenseSafe: true,
      secretFree: true,
      dependencyFree: true,
      noExecutablePayloads: true,
      noSymlinks: true,
      noExternalCommands: true,
    },
    dryRun: false,
    publicationPerformed: false,
    accepted: true,
    nonClaims: [
      'No generator, validator, remote command, publication, submission or portal mutation was performed by this static guard.',
      'This receipt does not claim marketplace listing, approval, runtime execution or host compatibility.',
    ],
  };
  const receiptText = JSON.stringify(receipt);
  if (/private key|password\s*[:=]|token\s*[:=]|secret\s*[:=]/i.test(receiptText)) throw new Error('receipt secret-content boundary denied');
  return receipt;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const policy = await readJson(args.policy, 'skills-only policy');
  assertPolicy(policy);
  const fixture = await readJson(args.fixture, 'prohibited package input fixture');
  assertFixture(fixture, policy);
  const canonicalFixturePath = path.join(root, policy.canonical.digestFixture);
  const canonical = await loadCanonical(args.canonicalDir, policy, canonicalFixturePath);
  const inspected = await inspectPackage(args.packageDir, args.canonicalDir, canonical, policy);
  const receipt = buildReceipt(args.packageDir, args.canonicalDir, policy, args.fixture, canonical, inspected);
  receipt.dryRun = args.dryRun;
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (!args.dryRun) {
    await mkdir(path.dirname(args.receipt), { recursive: true });
    await writeFile(args.receipt, serialized, { mode: 0o644 });
  }
  process.stdout.write(serialized);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`k4c-skills-only: ${error.message}\n`);
  process.exitCode = 1;
}
