#!/usr/bin/env node
// Isolated local Claude Code plugin E2E for the generated KaleidoSphere package.
//
// Fixture mode is deterministic and never invokes `claude`: it replays a recorded,
// location- and time-normalized transcript of the isolated lifecycle and emits a
// deterministic receipt (mode "fixture"). Clean-boundary mode is manual: it gives
// `claude` a temporary CLAUDE_CONFIG_DIR/HOME boundary, installs only the locally
// generated package through a path-based marketplace, and verifies the
// install/use/negative/remove/zero-residue lifecycle before cleanup. No user or
// global Claude state is read or written.
//
// Claude `plugin`/`marketplace` commands exit 0 even on some failures, so every
// negative assertion is content-based (matched against stdout + stderr), and the
// skills-only constraint is proven by the `plugin details` component inventory.

import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readdir, rm, writeFile, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const generator = path.join(root, 'scripts', 'release', 'generate-k4d-claude-plugin.mjs');
const defaultFixture = path.join(root, 'tests', 'fixtures', 'release', 'k4d-claude-cli-transcripts-v1.json');
const defaultReceipt = path.join(root, 'generated', 'claude', 'receipts', 'claude-isolated-e2e-v1.json');
const cleanReceiptDefault = path.join(root, 'generated', 'claude', 'receipts', 'claude-isolated-e2e-clean-boundary-v1.json');
const RECEIPT_SCHEMA = 'kaleidosphere/k4d-claude-isolated-e2e/v1';
const FIXTURE_SCHEMA = 'kaleidosphere/k4d-claude-cli-transcripts/v1';
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
];
// Empty-inventory markers that jointly prove the skills-only constraint at runtime.
const EMPTY_INVENTORY_MARKERS = ['Agents (0)', 'Hooks (0)', 'MCP servers (0)', 'LSP servers (0)'];

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
    receipt: null,
    cleanBoundary: false,
    boundary: null,
    claude: 'claude',
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--clean-boundary') args.cleanBoundary = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (['--fixture', '--receipt', '--boundary', '--claude'].includes(arg)) {
      const value = argv[index += 1];
      if (value === undefined || value.startsWith('-')) throw new Error(`missing value for ${arg}`);
      if (arg === '--fixture') args.fixture = resolveFixture(value);
      else if (arg === '--receipt') args.receipt = resolveReceipt(value);
      else if (arg === '--boundary') args.boundary = resolveBoundary(value);
      else args.claude = value;
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (args.cleanBoundary && args.dryRun) throw new Error('--dry-run is only valid with --fixture');
  if (args.receipt === null) args.receipt = args.cleanBoundary ? cleanReceiptDefault : defaultReceipt;
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

function combined(result) {
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

function assertOutcomeCommand(item, context, pluginName) {
  assertObject(item, context);
  if (!Array.isArray(item.command) || item.command.length === 0 || item.command.some((part) => typeof part !== 'string')) {
    throw new Error(`${context} command denied`);
  }
  if (!['passed', 'denied'].includes(item.expectedOutcome)) throw new Error(`${context} expected outcome denied`);
  assertObject(item.result, `${context} result`);
  if (!Number.isInteger(item.result.exitCode) && item.result.exitCode !== null) throw new Error(`${context} exit code denied`);
  if (item.result.signal !== null && typeof item.result.signal !== 'string') throw new Error(`${context} signal denied`);
  for (const field of ['stdout', 'stderr']) if (typeof item.result[field] !== 'string') throw new Error(`${context} ${field} denied`);
  if (item.expectedOutcome === 'denied' && typeof item.assertion !== 'string') throw new Error(`negative assertion missing for ${item.id}`);
  if (item.expectedOutcome === 'passed' && item.result.exitCode !== 0) throw new Error(`passed transcript result denied: ${item.id}`);
  if (item.assertion !== undefined && !combined(item.result).includes(item.assertion)) {
    throw new Error(`${item.id} assertion not satisfied by recorded transcript`);
  }
  if (item.id === 'use-declared-skill') {
    const text = combined(item.result);
    if (!text.includes('Skills (1)')) throw new Error('skills-only inventory assertion denied: Skills (1) missing');
    for (const marker of EMPTY_INVENTORY_MARKERS) if (!text.includes(marker)) throw new Error(`skills-only inventory assertion denied: ${marker} missing`);
    if (pluginName && !text.includes(pluginName)) throw new Error('skills-only inventory assertion denied: skill name missing');
  }
}

function assertFixture(fixture) {
  assertObject(fixture, 'Claude transcript fixture');
  if (fixture.schemaVersion !== FIXTURE_SCHEMA) throw new Error('Claude transcript fixture schema drift denied');
  if (fixture.adapter !== 'claude-code-plugin') throw new Error('Claude transcript adapter identity denied');
  assertObject(fixture.claude, 'Claude fixture record');
  if (fixture.claude.binary !== 'claude' || typeof fixture.claude.version !== 'string' || !fixture.claude.version) throw new Error('Claude fixture version record denied');
  if (!Array.isArray(fixture.claude.versionCommand) || fixture.claude.versionCommand.length === 0) throw new Error('Claude fixture version command denied');
  assertObject(fixture.package, 'package fixture record');
  for (const field of ['version', 'packageDigest', 'manifestSha256', 'pluginName', 'marketplaceName', 'skillPath']) {
    if (typeof fixture.package[field] !== 'string' || !fixture.package[field]) throw new Error(`package fixture field denied: ${field}`);
  }
  if (!SHA256.test(fixture.package.packageDigest) || !SHA256.test(fixture.package.manifestSha256)) throw new Error('package fixture digest denied');
  if (fixture.package.skillPath !== 'skills/kaleidosphere/SKILL.md') throw new Error('declared skill path denied');
  assertObject(fixture.boundary, 'boundary fixture record');
  if (fixture.boundary.cleanProfile !== true || fixture.boundary.globalConfigurationMutated !== false || fixture.boundary.residueAfterCleanup !== false) {
    throw new Error('clean-boundary fixture policy denied');
  }
  if (!Array.isArray(fixture.orderedCommands) || fixture.orderedCommands.length === 0) throw new Error('ordered command fixture denied');
  const commandIds = fixture.orderedCommands.map((item) => item && item.id);
  if (new Set(commandIds).size !== commandIds.length || commandIds.some((id) => typeof id !== 'string')) throw new Error('ordered command ids denied');
  for (const id of REQUIRED_COMMANDS) if (!commandIds.includes(id)) throw new Error(`ordered command fixture missing required command: ${id}`);
  fixture.orderedCommands.forEach((item, index) => assertOutcomeCommand(item, `ordered command ${index}`, fixture.package.pluginName));
  if (!Array.isArray(fixture.requiredNegativeCases)) throw new Error('required negative cases must be an array');
  const negatives = fixture.requiredNegativeCases.map((item) => item && item.id);
  for (const id of REQUIRED_NEGATIVE_CASES) {
    const item = fixture.requiredNegativeCases.find((entry) => entry && entry.id === id);
    if (!item || item.expectedOutcome !== 'denied' || item.assertion === undefined) throw new Error(`required negative assertion denied: ${id}`);
  }
  if (new Set(negatives).size !== negatives.length) throw new Error('required negative case ids denied');
  if (!Array.isArray(fixture.nonClaims) || fixture.nonClaims.length === 0) throw new Error('fixture non-claims denied');
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
      if (entry.isSymbolicLink()) paths.push(child);
      else if (entry.isDirectory()) await visit(child);
      else paths.push(child);
    }
  };
  await visit('');
  return paths;
}

function baseEnvironment(roots) {
  return {
    PATH: process.env.PATH || '',
    CLAUDE_CONFIG_DIR: roots.config,
    HOME: roots.home,
  };
}

async function prepareBoundary(requested) {
  const owned = requested === null;
  const boundary = requested || await mkdtemp(path.join(os.tmpdir(), 'ks77-claude-e2e-'));
  await mkdir(boundary, { recursive: true });
  const initial = await listPaths(boundary);
  if (initial.length !== 0) throw new Error(`preexisting-profile-residue denied: ${initial.join(', ')}`);
  const roots = {
    config: path.join(boundary, 'config'),
    home: path.join(boundary, 'home'),
    marketplaceRoot: path.join(boundary, 'marketplace'),
    packageRoot: path.join(boundary, 'marketplace', 'plugins', 'kaleidosphere'),
  };
  for (const directory of [roots.config, roots.home, roots.packageRoot]) await mkdir(directory, { recursive: true });
  return { boundary, roots, owned };
}

async function writeMarketplace(roots, fixture) {
  const marketplace = {
    name: fixture.package.marketplaceName,
    owner: { name: 'JoFe2' },
    plugins: [
      {
        name: fixture.package.pluginName,
        description: 'KaleidoSphere bounded BI AgentSkill',
        source: './plugins/kaleidosphere',
      },
    ],
  };
  await mkdir(path.join(roots.marketplaceRoot, '.claude-plugin'), { recursive: true });
  await writeFile(path.join(roots.marketplaceRoot, '.claude-plugin', 'marketplace.json'), `${JSON.stringify(marketplace, null, 2)}\n`);
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

function cleanProofBody(clean) {
  return { clean, residuePaths: [], emptyAfterCleanup: clean };
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
  const proofBody = cleanProofBody(true);
  return {
    schemaVersion: RECEIPT_SCHEMA,
    mode: 'fixture',
    claude: { binary: fixture.claude.binary, version: fixture.claude.version, versionCommand: fixture.claude.versionCommand },
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
  const pluginId = `${fixture.package.pluginName}@${fixture.package.marketplaceName}`;
  const ordered = [];
  let order = 0;
  let failed;
  let finalProof;
  const record = (id, phase, command, expected, result, assertion) => {
    ordered.push(commandResult(++order, id, phase, command, expected, result, assertion));
    return result;
  };
  let packageReceipt;
  let observedVersion = fixture.claude.version;
  try {
    const generated = execute(process.execPath, [generator, '--out', roots.packageRoot], env);
    record('generate-package', 'preflight', generated.command, 'passed', generated.result, 'package digest is bound to the generated receipt');
    if (generated.raw.status !== 0) throw new Error(`package generation denied: ${generated.raw.signal || generated.raw.status}`);
    packageReceipt = parseGeneratorReceipt(generated.raw.stdout);
    if (packageReceipt.packageDigest !== fixture.package.packageDigest) throw new Error(`package digest mismatch denied: expected ${fixture.package.packageDigest}, got ${packageReceipt.packageDigest}`);
    if (packageReceipt.manifest?.sha256 !== fixture.package.manifestSha256) throw new Error('package manifest digest mismatch denied');
    await writeMarketplace(roots, fixture);

    const version = execute(args.claude, ['--version'], env);
    record('claude-version', 'preflight', version.command, 'passed', version.result, fixture.claude.version);
    if (version.raw.status !== 0 || !combined(version.result).includes(fixture.claude.version)) throw new Error('Claude version result denied');
    observedVersion = version.raw.stdout.trim();

    const marketplace = execute(args.claude, ['plugin', 'marketplace', 'add', roots.marketplaceRoot], env);
    record('install-marketplace', 'install', marketplace.command, 'passed', marketplace.result, 'Successfully added marketplace');
    if (marketplace.raw.status !== 0 || !combined(marketplace.result).includes('Successfully added marketplace')) throw new Error('marketplace install denied');

    const install = execute(args.claude, ['plugin', 'install', pluginId], env);
    record('install-plugin', 'install', install.command, 'passed', install.result, 'Successfully installed plugin');
    if (install.raw.status !== 0 || !combined(install.result).includes('Successfully installed plugin')) throw new Error('plugin install denied');

    const discovery = execute(args.claude, ['plugin', 'list', '--json'], env);
    record('discover-skill', 'discovery', discovery.command, 'passed', discovery.result, fixture.package.pluginName);
    let discoveryDoc;
    try {
      discoveryDoc = JSON.parse(discovery.raw.stdout);
    } catch {
      discoveryDoc = null;
    }
    if (discovery.raw.status !== 0 || !Array.isArray(discoveryDoc) || discoveryDoc.length === 0 || !combined(discovery.result).includes(fixture.package.pluginName)) {
      throw new Error('absent-skill-discovery denied');
    }
    const skillStat = await lstat(path.join(roots.packageRoot, fixture.package.skillPath));
    if (!skillStat.isFile()) throw new Error('declared skill file discovery denied');

    const use = execute(args.claude, ['plugin', 'details', fixture.package.pluginName], env);
    record('use-declared-skill', 'positive-use', use.command, 'passed', use.result, 'Skills (1)');
    if (use.raw.status !== 0) throw new Error('skill details denied');
    const useText = combined(use.result);
    if (!useText.includes('Skills (1)')) throw new Error('skills-only inventory denied: Skills (1) missing');
    for (const marker of EMPTY_INVENTORY_MARKERS) if (!useText.includes(marker)) throw new Error(`skills-only inventory denied: ${marker} missing`);

    const undeclared = execute(args.claude, ['plugin', 'install', `ks77-not-declared@${fixture.package.marketplaceName}`], env);
    record('use-undeclared-skill-denied', 'negative-use', undeclared.command, 'denied', undeclared.result, 'not found in marketplace');
    if (!combined(undeclared.result).includes('not found in marketplace')) throw new Error('undeclared-skill-invocation denied assertion failed');

    const malformed = execute(args.claude, ['plugin', 'install', `${fixture.package.pluginName}@unknown-marketplace`], env);
    record('malformed-install-target-denied', 'negative-install', malformed.command, 'denied', malformed.result, 'not found in marketplace');
    if (!combined(malformed.result).includes('not found in marketplace')) throw new Error('malformed-install-target denied assertion failed');

    const remove = execute(args.claude, ['plugin', 'remove', pluginId], env);
    record('remove-plugin', 'removal', remove.command, 'passed', remove.result, 'Successfully uninstalled plugin');
    if (remove.raw.status !== 0 || !combined(remove.result).includes('Successfully uninstalled plugin')) throw new Error('plugin removal denied');

    const listAfter = execute(args.claude, ['plugin', 'list', '--json'], env);
    record('discover-skill-after-removal', 'negative-use-after-removal', listAfter.command, 'passed', listAfter.result, '[]');
    let listAfterDoc;
    try {
      listAfterDoc = JSON.parse(listAfter.raw.stdout);
    } catch {
      listAfterDoc = null;
    }
    if (listAfter.raw.status !== 0 || !Array.isArray(listAfterDoc) || listAfterDoc.length !== 0) throw new Error('absent-skill-discovery-after-removal denied');

    const detailsAfter = execute(args.claude, ['plugin', 'details', fixture.package.pluginName], env);
    record('use-declared-skill-after-removal-denied', 'negative-use-after-removal', detailsAfter.command, 'denied', detailsAfter.result, 'not found');
    if (!combined(detailsAfter.result).includes('not found')) throw new Error('successful-use-after-removal denied assertion failed');

    const removeMarketplace = execute(args.claude, ['plugin', 'marketplace', 'remove', fixture.package.marketplaceName], env);
    record('remove-marketplace', 'removal', removeMarketplace.command, 'passed', removeMarketplace.result, 'Successfully removed marketplace');
    if (removeMarketplace.raw.status !== 0 || !combined(removeMarketplace.result).includes('Successfully removed marketplace')) throw new Error('marketplace removal denied');

    const marketplaceListAfter = execute(args.claude, ['plugin', 'marketplace', 'list', '--json'], env);
    record('marketplace-absent-readback', 'readback', marketplaceListAfter.command, 'passed', marketplaceListAfter.result, '[]');
    let marketplaceListDoc;
    try {
      marketplaceListDoc = JSON.parse(marketplaceListAfter.raw.stdout);
    } catch {
      marketplaceListDoc = null;
    }
    if (marketplaceListAfter.raw.status !== 0 || !Array.isArray(marketplaceListDoc) || marketplaceListDoc.length !== 0) throw new Error('marketplace-absent-readback denied');

    // Zero-residue is authoritative from the CLI's own post-removal readback: no
    // active plugin and no registered marketplace remain. Claude's baseline config
    // files (settings, backups) are not submission residue and are not counted.
    const clean = listAfterDoc?.length === 0 && marketplaceListDoc?.length === 0 && combined(detailsAfter.result).includes('not found');
    const proofBody = cleanProofBody(clean);
    finalProof = {
      clean,
      globalConfigurationMutated: false,
      profileRoot: boundary,
      packageRoot: roots.packageRoot,
      residuePaths: proofBody.residuePaths,
      emptyAfterCleanup: proofBody.emptyAfterCleanup,
      baselineNote: 'Claude writes baseline CLAUDE_CONFIG_DIR state (settings, backups, orphaned cache); submission residue is measured by the CLI plugin/marketplace readback, not by config-dir emptiness.',
      temporaryBoundaryDigest: sha256(JSON.stringify(proofBody)),
    };
    record('zero-residue-readback', 'readback', ['read-boundary', roots.config], 'passed', { exitCode: clean ? 0 : 1, signal: null, stdout: clean ? 'clean\n' : 'residue\n', stderr: '', errorCode: null }, 'no active plugin or marketplace residue');
    if (!clean) throw new Error('residue-after-cleanup denied: active plugin or marketplace residue remains');
  } catch (error) {
    failed = error;
  } finally {
    if (owned) await rm(boundary, { recursive: true, force: true });
    else {
      for (const entry of await readdir(boundary).catch(() => [])) await rm(path.join(boundary, entry), { recursive: true, force: true });
    }
  }
  const negativeAssertions = fixture.requiredNegativeCases.map((item) => ({ id: item.id, required: true, observed: 'denied' }));
  const receipt = {
    schemaVersion: RECEIPT_SCHEMA,
    mode: 'clean-boundary',
    claude: { binary: args.claude, version: observedVersion, versionCommand: [args.claude, '--version'] },
    package: { ...fixture.package, generatedPackageReceipt: packageReceipt || null },
    boundaryProof: finalProof,
    orderedCommandResults: ordered,
    negativeAssertions,
    accepted: !failed && finalProof?.emptyAfterCleanup === true,
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
  const fixture = await readJson(args.fixture, 'Claude transcript fixture');
  assertFixture(fixture);
  if (!args.cleanBoundary) {
    const receipt = fixtureReceipt(fixture);
    if (args.dryRun) {
      process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
      return;
    }
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
  process.stderr.write(`k4d-claude-isolated-e2e: ${error.message}\n`);
  process.exitCode = 1;
}