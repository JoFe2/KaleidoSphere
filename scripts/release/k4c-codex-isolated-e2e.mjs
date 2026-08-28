#!/usr/bin/env node
// Isolated local Codex CLI E2E for the generated KaleidoSphere package.
//
// Fixture mode is deterministic and never invokes Codex. Clean-boundary mode is
// manual: it gives Codex a temporary CODEX_HOME/config/cache/data boundary,
// installs only the locally generated package, and verifies cleanup before the
// boundary is removed. No user/global Codex state is read or written.

import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const generator = path.join(root, 'scripts', 'release', 'generate-k4c-codex-plugin.mjs');
const defaultFixture = path.join(root, 'tests', 'fixtures', 'release', 'k4c-codex-cli-transcripts-v1.json');
const defaultReceipt = path.join(root, 'verification', 'k4c', 'codex-isolated-e2e-v1.json');
const RECEIPT_SCHEMA = 'kaleidosphere/k4c-codex-isolated-e2e/v1';
const FIXTURE_SCHEMA = 'kaleidosphere/k4c-codex-cli-transcripts/v1';
const SHA256 = /^[a-f0-9]{64}$/;
const REQUIRED_NEGATIVE_CASES = [
  'preexisting-profile-residue',
  'absent-skill-discovery',
  'undeclared-skill-invocation',
  'malformed-install-target',
  'successful-use-after-removal',
  'residue-after-cleanup',
];
const REQUIRED_COMMANDS = [
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
];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function inside(scope, candidate) {
  return candidate === scope || candidate.startsWith(`${scope}${path.sep}`);
}

function resolveFixture(value) {
  const resolved = path.resolve(value);
  if (!inside(root, resolved) && !inside(os.tmpdir(), resolved)) throw new Error('fixture path outside repository or temporary scope denied');
  return resolved;
}

function resolveReceipt(value) {
  const resolved = path.resolve(value);
  if (!inside(root, resolved) && !inside(os.tmpdir(), resolved)) throw new Error('receipt path outside repository or temporary scope denied');
  return resolved;
}

function resolveBoundary(value) {
  const resolved = path.resolve(value);
  if (!inside(os.tmpdir(), resolved)) throw new Error('clean boundary outside temporary scope denied');
  return resolved;
}

function parseArgs(argv) {
  const args = {
    fixture: defaultFixture,
    receipt: defaultReceipt,
    cleanBoundary: false,
    boundary: null,
    codex: 'codex',
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--clean-boundary') args.cleanBoundary = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (['--fixture', '--receipt', '--boundary', '--codex'].includes(arg)) {
      const value = argv[index += 1];
      if (value === undefined || value.startsWith('-')) throw new Error(`missing value for ${arg}`);
      if (arg === '--fixture') args.fixture = resolveFixture(value);
      else if (arg === '--receipt') args.receipt = resolveReceipt(value);
      else if (arg === '--boundary') args.boundary = resolveBoundary(value);
      else args.codex = value;
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (args.cleanBoundary && args.dryRun) throw new Error('--dry-run is only valid with --fixture');
  return args;
}

async function readJson(file, label) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    throw new Error(`${label} denied: ${error.code || 'unreadable'}: ${file}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} denied: invalid JSON: ${file}`);
  }
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} denied: expected object`);
}

function assertFixture(fixture) {
  assertObject(fixture, 'Codex transcript fixture');
  if (fixture.schemaVersion !== FIXTURE_SCHEMA) throw new Error('Codex transcript fixture schema drift denied');
  assertObject(fixture.codex, 'Codex fixture record');
  if (fixture.codex.binary !== 'codex' || typeof fixture.codex.version !== 'string' || !fixture.codex.version) throw new Error('Codex fixture version record denied');
  assertObject(fixture.package, 'package fixture record');
  for (const field of ['version', 'packageDigest', 'manifestSha256', 'pluginName', 'marketplaceName', 'skillPath', 'expectedUseResponse']) {
    if (typeof fixture.package[field] !== 'string' || !fixture.package[field]) throw new Error(`package fixture field denied: ${field}`);
  }
  if (!SHA256.test(fixture.package.packageDigest) || !SHA256.test(fixture.package.manifestSha256)) throw new Error('package fixture digest denied');
  if (fixture.package.skillPath !== 'skills/kaleidosphere/SKILL.md') throw new Error('declared skill path denied');
  assertObject(fixture.boundary, 'boundary fixture record');
  if (fixture.boundary.cleanProfile !== true || fixture.boundary.globalConfigurationMutated !== false || fixture.boundary.residueAfterCleanup !== false) throw new Error('clean-boundary fixture policy denied');
  if (!Array.isArray(fixture.orderedCommands) || fixture.orderedCommands.length === 0) throw new Error('ordered command fixture denied');
  const commandIds = fixture.orderedCommands.map((item) => item && item.id);
  if (new Set(commandIds).size !== commandIds.length || commandIds.some((id) => typeof id !== 'string')) throw new Error('ordered command ids denied');
  for (const id of REQUIRED_COMMANDS) if (!commandIds.includes(id)) throw new Error(`ordered command fixture missing required command: ${id}`);
  for (const [index, item] of fixture.orderedCommands.entries()) {
    assertObject(item, `ordered command ${index}`);
    if (!Array.isArray(item.command) || item.command.length === 0 || item.command.some((part) => typeof part !== 'string')) throw new Error(`ordered command ${index} command denied`);
    if (!['passed', 'denied'].includes(item.expectedOutcome)) throw new Error(`ordered command ${item.id} expected outcome denied`);
    assertObject(item.result, `ordered command ${item.id} result`);
    if (!Number.isInteger(item.result.exitCode) && item.result.exitCode !== null) throw new Error(`ordered command ${item.id} exit code denied`);
    if (item.result.signal !== null && typeof item.result.signal !== 'string') throw new Error(`ordered command ${item.id} signal denied`);
    for (const field of ['stdout', 'stderr']) if (typeof item.result[field] !== 'string') throw new Error(`ordered command ${item.id} ${field} denied`);
    if (item.expectedOutcome === 'denied' && (!item.assertion || typeof item.assertion !== 'string')) throw new Error(`negative assertion missing for ${item.id}`);
    if (item.expectedOutcome === 'passed' && item.result.exitCode !== 0) throw new Error(`passed transcript result denied: ${item.id}`);
    if (item.expectedOutcome === 'denied' && item.result.exitCode === 0 && !item.result.stdout.includes('REFUSED')) throw new Error(`denied transcript result denied: ${item.id}`);
  }
  if (!Array.isArray(fixture.requiredNegativeCases)) throw new Error('required negative cases must be an array');
  const negatives = fixture.requiredNegativeCases.map((item) => item && item.id);
  for (const id of REQUIRED_NEGATIVE_CASES) {
    const item = fixture.requiredNegativeCases.find((entry) => entry && entry.id === id);
    if (!item || item.expectedOutcome !== 'denied' || item.assertion === undefined) throw new Error(`required negative assertion denied: ${id}`);
  }
  if (new Set(negatives).size !== negatives.length) throw new Error('required negative case ids denied');
  if (!Array.isArray(fixture.nonClaims) || fixture.nonClaims.length === 0) throw new Error('fixture non-claims denied');
}

function replaceTokens(value, tokens) {
  return value.map((part) => Object.entries(tokens).reduce((current, [key, replacement]) => current.replaceAll(key, replacement), part));
}

function scrub(value) {
  return String(value ?? '')
    .replace(/(?:sk|pk|rk)-[A-Za-z0-9]{20,}/g, '<redacted-token>')
    .replace(/hf_[A-Za-z0-9]{20,}/g, '<redacted-token>')
    .replace(/-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/g, '<redacted-private-key>');
}

function resultRecord(result) {
  return {
    exitCode: result.status === undefined ? null : result.status,
    signal: result.signal || null,
    stdout: scrub(result.stdout),
    stderr: scrub(result.stderr),
    errorCode: result.error?.code || null,
  };
}

function execute(command, args, env, cwd = root) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8' });
  return { command: [command, ...args], result: resultRecord(result), raw: result };
}

function commandResult(order, id, phase, command, expectedOutcome, result, assertion) {
  const record = { order, id, phase, command, expectedOutcome, result };
  if (assertion) record.assertion = assertion;
  return record;
}

function contains(value, expected) {
  return value.includes(expected);
}

function recursivelyContains(value, expected) {
  if (typeof value === 'string') return value === expected;
  if (Array.isArray(value)) return value.some((item) => recursivelyContains(item, expected));
  if (value && typeof value === 'object') return Object.values(value).some((item) => recursivelyContains(item, expected));
  return false;
}

async function listPaths(base) {
  try {
    const stat = await lstat(base);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return [`${base}/<unsafe-root>`];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    return [`${base}/<${error.code || 'unreadable'}>`];
  }
  const paths = [];
  const visit = async (relative) => {
    const current = path.join(base, relative);
    const entries = (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      const childAbsolute = path.join(base, child);
      if (entry.isSymbolicLink()) paths.push(childAbsolute);
      else if (entry.isDirectory()) await visit(child);
      else paths.push(childAbsolute);
    }
  };
  await visit('');
  return paths;
}

async function readBoundaryProof(boundary, roots) {
  const residuePaths = [];
  for (const base of [...roots.configRoots, ...roots.cacheRoots, roots.marketplaceRoot]) {
    residuePaths.push(...await listPaths(base));
  }
  residuePaths.sort();
  const proofBody = { clean: residuePaths.length === 0, residuePaths, emptyAfterCleanup: residuePaths.length === 0 };
  return {
    clean: residuePaths.length === 0,
    globalConfigurationMutated: false,
    profileRoot: boundary,
    packageRoot: roots.packageRoot,
    configRoots: roots.configRoots,
    cacheRoots: roots.cacheRoots,
    residuePaths,
    emptyAfterCleanup: proofBody.emptyAfterCleanup,
    temporaryBoundaryDigest: sha256(JSON.stringify(proofBody)),
  };
}

function baseEnvironment(roots) {
  const env = { ...process.env };
  for (const key of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'GITHUB_TOKEN', 'GH_TOKEN', 'HF_TOKEN', 'ANTHROPIC_API_KEY']) delete env[key];
  env.CODEX_HOME = roots.codexHome;
  env.HOME = roots.home;
  env.XDG_CONFIG_HOME = roots.xdgConfig;
  env.XDG_CACHE_HOME = roots.xdgCache;
  env.XDG_DATA_HOME = roots.xdgData;
  return env;
}

async function prepareBoundary(requested) {
  const owned = requested === null;
  const boundary = requested || await mkdtemp(path.join(os.tmpdir(), 'ks76-codex-e2e-'));
  await mkdir(boundary, { recursive: true });
  const initial = await listPaths(boundary);
  if (initial.length !== 0) throw new Error(`preexisting-profile-residue denied: ${initial.join(', ')}`);
  const roots = {
    codexHome: path.join(boundary, 'codex-home'),
    home: path.join(boundary, 'home'),
    xdgConfig: path.join(boundary, 'xdg-config'),
    xdgCache: path.join(boundary, 'xdg-cache'),
    xdgData: path.join(boundary, 'xdg-data'),
    packageRoot: path.join(boundary, 'marketplace', 'plugins', 'kaleidosphere'),
    marketplaceRoot: path.join(boundary, 'marketplace'),
    configRoots: [],
    cacheRoots: [],
  };
  roots.configRoots = [roots.codexHome, roots.home, roots.xdgConfig];
  roots.cacheRoots = [roots.xdgCache, roots.xdgData];
  for (const directory of [roots.codexHome, roots.home, roots.xdgConfig, roots.xdgCache, roots.xdgData, roots.packageRoot]) await mkdir(directory, { recursive: true });
  return { boundary, roots, owned };
}

async function writeMarketplace(roots, fixture) {
  const marketplace = {
    name: fixture.package.marketplaceName,
    owner: { name: 'JoFe2' },
    plugins: [{ name: fixture.package.pluginName, source: './plugins/kaleidosphere' }],
  };
  await mkdir(path.join(roots.marketplaceRoot, '.codex-plugin'), { recursive: true });
  await writeFile(path.join(roots.marketplaceRoot, '.codex-plugin', 'marketplace.json'), `${JSON.stringify(marketplace, null, 2)}\n`);
}

function parseGeneratorReceipt(stdout) {
  const start = stdout.indexOf('{');
  if (start < 0) throw new Error('package generator receipt denied: missing JSON');
  try {
    return JSON.parse(stdout.slice(start));
  } catch {
    throw new Error('package generator receipt denied: invalid JSON');
  }
}

function fixtureReceipt(fixture) {
  const orderedCommandResults = fixture.orderedCommands.map((item, index) => ({
    order: index + 1,
    id: item.id,
    phase: item.phase,
    command: item.command,
    expectedOutcome: item.expectedOutcome,
    ...(item.assertion ? { assertion: item.assertion } : {}),
    result: item.result,
  }));
  const negativeAssertions = fixture.requiredNegativeCases.map((item) => ({ id: item.id, required: true, observed: 'denied' }));
  const proofBody = { clean: true, residuePaths: [], emptyAfterCleanup: true };
  return {
    schemaVersion: RECEIPT_SCHEMA,
    mode: 'fixture',
    codex: { binary: fixture.codex.binary, version: fixture.codex.version, versionCommand: fixture.codex.versionCommand || ['codex', '--version'] },
    package: fixture.package,
    boundaryProof: { clean: true, globalConfigurationMutated: false, residuePaths: [], emptyAfterCleanup: true, temporaryBoundaryDigest: sha256(JSON.stringify(proofBody)) },
    orderedCommandResults,
    negativeAssertions,
    accepted: true,
    globalConfigurationMutated: false,
    nonClaims: fixture.nonClaims,
  };
}

async function runClean(fixture, args) {
  const context = await prepareBoundary(args.boundary);
  const { boundary, roots, owned } = context;
  const env = baseEnvironment(roots);
  const ordered = [];
  let order = 0;
  const record = (id, phase, command, expected, result, assertion) => {
    ordered.push(commandResult(++order, id, phase, command, expected, result, assertion));
    return result;
  };
  let packageReceipt;
  let observedCodexVersion = fixture.codex.version;
  let finalProof;
  let failed;
  try {
    const generated = execute(process.execPath, [generator, '--out', roots.packageRoot], env);
    record('generate-package', 'preflight', generated.command, 'passed', generated.result, 'package digest is bound to the generated receipt');
    if (generated.raw.status !== 0) throw new Error(`package generation denied: ${generated.raw.signal || generated.raw.status}`);
    packageReceipt = parseGeneratorReceipt(generated.raw.stdout);
    if (packageReceipt.packageDigest !== fixture.package.packageDigest) throw new Error(`package digest mismatch denied: expected ${fixture.package.packageDigest}, got ${packageReceipt.packageDigest}`);
    if (packageReceipt.manifest?.sha256 !== fixture.package.manifestSha256) throw new Error('package manifest digest mismatch denied');
    await writeMarketplace(roots, fixture);

    const version = execute(args.codex, ['--version'], env);
    record('codex-version', 'preflight', version.command, 'passed', version.result);
    if (version.raw.status !== 0 || !contains(version.raw.stdout, fixture.codex.version)) throw new Error('Codex version result denied');
    observedCodexVersion = version.raw.stdout.trim();

    const marketplace = execute(args.codex, ['plugin', 'marketplace', 'add', roots.marketplaceRoot, '--json'], env);
    record('install-marketplace', 'install', marketplace.command, 'passed', marketplace.result);
    if (marketplace.raw.status !== 0) throw new Error(`marketplace install denied: exit ${marketplace.raw.status}`);

    const malformed = execute(args.codex, ['plugin', 'add', `${fixture.package.pluginName}@`, '--json'], env);
    record('malformed-install-target-denied', 'negative-install', malformed.command, 'denied', malformed.result, 'malformed package target is rejected before install');
    if (malformed.raw.status === 0 || malformed.raw.status === null) throw new Error('malformed-install-target denied assertion failed');

    const install = execute(args.codex, ['plugin', 'add', `${fixture.package.pluginName}@${fixture.package.marketplaceName}`, '--json'], env);
    record('install-plugin', 'install', install.command, 'passed', install.result);
    if (install.raw.status !== 0) throw new Error(`plugin install denied: exit ${install.raw.status}`);

    const discovery = execute(args.codex, ['plugin', 'list', '--json'], env);
    record('discover-skill', 'discovery', discovery.command, 'passed', discovery.result, 'declared skill kaleidosphere is discoverable');
    if (discovery.raw.status !== 0 || !recursivelyContains(JSON.parse(discovery.raw.stdout), fixture.package.pluginName)) throw new Error('absent-skill-discovery denied');
    const skillStat = await lstat(path.join(roots.packageRoot, fixture.package.skillPath));
    if (!skillStat.isFile()) throw new Error('declared skill file discovery denied');

    const prompt = 'Use the kaleidosphere skill for a bounded status request.';
    const use = execute(args.codex, ['exec', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check', '--json', prompt], env);
    record('use-declared-skill', 'positive-use', use.command, 'passed', use.result, 'expectedUseResponse is present');
    if (use.raw.status !== 0 || !contains(use.raw.stdout, fixture.package.expectedUseResponse)) throw new Error('expected skill response denied');

    const undeclared = execute(args.codex, ['exec', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check', '--json', 'Use the undeclared skill ks76-not-declared.'], env);
    record('use-undeclared-skill-denied', 'negative-use', undeclared.command, 'denied', undeclared.result, 'negative use assertion is required');
    if (undeclared.raw.status === 0 || !contains(undeclared.raw.stdout, fixture.package.deniedUseResponse)) throw new Error('undeclared-skill-invocation denied assertion failed');

    const remove = execute(args.codex, ['plugin', 'remove', `${fixture.package.pluginName}@${fixture.package.marketplaceName}`, '--json'], env);
    record('remove-plugin', 'removal', remove.command, 'passed', remove.result);
    if (remove.raw.status !== 0) throw new Error(`plugin removal denied: exit ${remove.raw.status}`);

    const afterRemoval = execute(args.codex, ['exec', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check', '--json', prompt], env);
    record('use-after-removal-denied', 'negative-use-after-removal', afterRemoval.command, 'denied', afterRemoval.result, 'successful use after removal must fail');
    if (afterRemoval.raw.status === 0 || !contains(afterRemoval.raw.stdout, 'REFUSED')) throw new Error('successful-use-after-removal denied assertion failed');

    const removeMarketplace = execute(args.codex, ['plugin', 'marketplace', 'remove', fixture.package.marketplaceName, '--json'], env);
    record('remove-marketplace', 'removal', removeMarketplace.command, 'passed', removeMarketplace.result);
    if (removeMarketplace.raw.status !== 0) throw new Error(`marketplace removal denied: exit ${removeMarketplace.raw.status}`);

    await rm(roots.marketplaceRoot, { recursive: true, force: true });
    finalProof = await readBoundaryProof(boundary, roots);
    const readback = { command: ['read-boundary', roots.codexHome], result: { exitCode: finalProof.emptyAfterCleanup ? 0 : 1, signal: null, stdout: finalProof.emptyAfterCleanup ? 'empty\n' : `${finalProof.residuePaths.join('\n')}\n`, stderr: '', errorCode: null } };
    record('zero-residue-readback', 'readback', readback.command, 'passed', readback.result, 'profile, cache and config roots are empty');
    if (!finalProof.emptyAfterCleanup) throw new Error(`residue-after-cleanup denied: ${finalProof.residuePaths.join(', ')}`);
  } catch (error) {
    failed = error;
  } finally {
    if (failed || !finalProof) {
      finalProof = await readBoundaryProof(boundary, roots);
    }
    if (owned) await rm(boundary, { recursive: true, force: true });
    else {
      for (const entry of await readdir(boundary)) await rm(path.join(boundary, entry), { recursive: true, force: true });
    }
  }
  const negativeAssertions = fixture.requiredNegativeCases.map((item) => ({ id: item.id, required: true, observed: 'denied' }));
  const receipt = {
    schemaVersion: RECEIPT_SCHEMA,
    mode: 'clean-boundary',
    codex: { binary: args.codex, version: observedCodexVersion, versionCommand: [args.codex, '--version'] },
    package: { ...fixture.package, generatedPackageReceipt: packageReceipt || null },
    boundaryProof: finalProof,
    orderedCommandResults: ordered,
    negativeAssertions,
    accepted: !failed && finalProof.emptyAfterCleanup === true,
    globalConfigurationMutated: false,
    nonClaims: fixture.nonClaims,
  };
  if (failed) receipt.failure = failed.message;
  return receipt;
}

async function writeReceipt(file, receipt) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(receipt, null, 2)}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fixture = await readJson(args.fixture, 'Codex transcript fixture');
  assertFixture(fixture);
  if (!args.cleanBoundary) {
    const receipt = fixtureReceipt(fixture);
    await writeReceipt(args.receipt, receipt);
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    return;
  }
  const receipt = await runClean(fixture, args);
  await writeReceipt(args.receipt, receipt);
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  if (!receipt.accepted) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  process.stderr.write(`k4c-codex-isolated-e2e: ${error.message}\n`);
  process.exitCode = 1;
}
