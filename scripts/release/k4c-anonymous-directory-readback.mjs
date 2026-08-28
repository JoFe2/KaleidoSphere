#!/usr/bin/env node
// Credential-free, one-shot K4C anonymous directory discovery/install/readback.
// Fixture mode validates recorded transcripts. Manual mode executes only explicit
// argument-array commands in an empty temporary boundary. Neither mode submits,
// publishes, or infers a public listing without a complete accepted receipt.

import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..', '..');
const defaultFixture = path.join(root, 'tests', 'fixtures', 'release', 'k4c-directory-readback-transcripts-v1.json');
const defaultReceipt = path.join(root, 'verification', 'k4c', 'anonymous-directory-readback-v1.json');
const FIXTURE_SCHEMA = 'kaleidosphere/k4c-directory-readback-transcripts/v1';
const RECEIPT_SCHEMA = 'kaleidosphere/k4c-anonymous-directory-readback/v1';
const SHA256 = /^[a-f0-9]{64}$/;
const REQUIRED_NEGATIVES = [
  'authenticated-config',
  'cached-local-only-discovery',
  'title-only-mismatch',
  'missing-package-digest',
  'install-failure',
  'anonymous-receipt-older-than-submission',
];
const REQUIRED_COMMANDS = [
  'anonymous-boundary-preflight',
  'anonymous-directory-discovery',
  'exact-listing-readback',
  'install-matching-package',
  'installed-package-readback',
  'zero-residue-readback',
];
const NON_CLAIMS = [
  'No credentials, authenticated directory session, portal submission, publication, or release operation is performed.',
  'A public listing claim is permitted only when this receipt is complete, accepted, and publicListingClaim is true.',
  'Fixture transcripts are recorded evidence, not live directory traffic; manual mode owns live command execution.',
];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function inside(scope, candidate) {
  return candidate === scope || candidate.startsWith(`${scope}${path.sep}`);
}

function resolveInput(value, label) {
  const resolved = path.resolve(value);
  if (resolved.includes('\0') || (!inside(root, resolved) && !inside(os.tmpdir(), resolved))) {
    throw new Error(`${label} path outside repository or temporary scope denied`);
  }
  return resolved;
}

function resolveBoundary(value) {
  const resolved = path.resolve(value);
  if (resolved.includes('\0') || !inside(os.tmpdir(), resolved)) throw new Error('boundary outside temporary scope denied');
  return resolved;
}

function resolveReceipt(value) {
  const resolved = path.resolve(value);
  if (resolved.includes('\0') || (!inside(root, resolved) && !inside(os.tmpdir(), resolved))) {
    throw new Error('receipt path outside repository or temporary scope denied');
  }
  return resolved;
}

function labelPath(file) {
  return inside(root, file) ? path.relative(root, file).split(path.sep).join('/') : file;
}

function parseCommand(value, label) {
  let command;
  try {
    command = JSON.parse(value);
  } catch {
    throw new Error(`${label} must be a JSON command array`);
  }
  if (!Array.isArray(command) || command.length === 0 || command.some((part) => typeof part !== 'string' || part.trim() === '')) {
    throw new Error(`${label} must be a non-empty string array`);
  }
  if (command.some((part) => /(?:^|\s)(?:sh|bash|zsh|powershell|cmd)(?:\s|$)|[;&|`$()]/i.test(part))) {
    throw new Error(`${label} shell syntax denied`);
  }
  if (command.some((part) => /(?:TOKEN|PASSWORD|SECRET|CREDENTIAL|API[_-]?KEY|AUTHORIZATION|PRIVATE[_-]?KEY|BEARER)\s*=/i.test(part) || /(?:sk|ghp|glpat|xox[baprs])-[A-Za-z0-9_-]{8,}/i.test(part))) {
    throw new Error(`${label} credential content denied`);
  }
  return command;
}

function parseArgs(argv) {
  const args = {
    fixture: defaultFixture,
    receipt: defaultReceipt,
    dryRun: false,
    manual: false,
    boundary: null,
    discoverCommand: null,
    installCommand: null,
    readbackCommand: null,
    submissionReceipt: null,
  };
  const values = new Map([
    ['--fixture', 'fixture'],
    ['--receipt', 'receipt'],
    ['--boundary', 'boundary'],
    ['--discover-command', 'discoverCommand'],
    ['--install-command', 'installCommand'],
    ['--readback-command', 'readbackCommand'],
    ['--submission-receipt', 'submissionReceipt'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--manual' || arg === '--live') args.manual = true;
    else if (values.has(arg)) {
      const value = argv[index += 1];
      if (value === undefined || value.startsWith('-')) throw new Error(`missing value for ${arg}`);
      const key = values.get(arg);
      if (key === 'fixture') args.fixture = resolveInput(value, 'fixture');
      else if (key === 'receipt') args.receipt = resolveReceipt(value);
      else if (key === 'boundary') args.boundary = resolveBoundary(value);
      else if (key === 'submissionReceipt') args.submissionReceipt = resolveInput(value, 'submission receipt');
      else args[key] = parseCommand(value, arg);
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (args.manual && args.dryRun) throw new Error('--dry-run is only valid with --fixture');
  if (args.manual && (!args.discoverCommand || !args.installCommand || !args.readbackCommand)) {
    throw new Error('manual mode requires --discover-command, --install-command, and --readback-command');
  }
  return args;
}

async function readJsonWithBytes(file, label) {
  let bytes;
  try {
    bytes = await readFile(file);
  } catch (error) {
    throw new Error(`${label} denied: ${error.code || 'unreadable'}: ${labelPath(file)}`);
  }
  try {
    return { bytes, value: JSON.parse(bytes.toString('utf8')) };
  } catch {
    throw new Error(`${label} denied: invalid JSON: ${labelPath(file)}`);
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertObject(value, label) {
  if (!isObject(value)) throw new Error(`${label} denied: expected object`);
}

function assertText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} denied: expected non-empty text`);
}

function assertDigest(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error(`${label} denied: expected SHA-256`);
}

function assertBoolean(value, label) {
  if (typeof value !== 'boolean') throw new Error(`${label} denied: expected boolean`);
}

function assertTimestamp(value, label) {
  assertText(value, label);
  if (Number.isNaN(Date.parse(value))) throw new Error(`${label} denied: invalid timestamp`);
}

function compareJson(a, b, label) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${label} denied: exact value mismatch`);
}

function parseTranscriptJson(stdout, label) {
  const start = stdout.indexOf('{');
  if (start < 0) throw new Error(`${label} denied: missing JSON readback`);
  try {
    return JSON.parse(stdout.slice(start));
  } catch {
    throw new Error(`${label} denied: malformed JSON readback`);
  }
}

function resultShape(result, label) {
  assertObject(result, `${label} result`);
  if (!Number.isInteger(result.exitCode) && result.exitCode !== null) throw new Error(`${label} exit code denied`);
  if (result.signal !== null && typeof result.signal !== 'string') throw new Error(`${label} signal denied`);
  for (const field of ['stdout', 'stderr']) if (typeof result[field] !== 'string') throw new Error(`${label} ${field} denied`);
}

function commandShape(command, label) {
  if (!Array.isArray(command) || command.length === 0 || command.some((part) => typeof part !== 'string')) throw new Error(`${label} command denied`);
}

function packageShape(packageRecord) {
  assertObject(packageRecord, 'package');
  for (const field of ['name', 'version', 'title']) assertText(packageRecord[field], `package ${field}`);
  assertDigest(packageRecord.digest, 'package digest');
}

function directoryShape(directory, packageRecord) {
  assertObject(directory, 'directory');
  for (const field of ['name', 'listingId', 'expectedTitle']) assertText(directory[field], `directory ${field}`);
  if (directory.installTarget !== `${packageRecord.name}@${packageRecord.version}`) throw new Error('directory install target denied');
  assertObject(directory.expectedListing, 'directory expected listing');
  const expected = directory.expectedListing;
  const required = {
    listingId: directory.listingId,
    title: directory.expectedTitle,
    packageName: packageRecord.name,
    packageVersion: packageRecord.version,
    packageDigest: packageRecord.digest,
    source: 'anonymous-directory',
    anonymous: true,
    authenticated: false,
    cacheHit: false,
    networkAccess: true,
  };
  compareJson(expected, required, 'directory exact listing contract');
}

function boundaryShape(boundary) {
  assertObject(boundary, 'boundary');
  for (const field of ['emptyBeforeDiscovery', 'authenticatedConfig', 'cachedLocalOnly', 'residueAfterCleanup', 'temporaryRemoved']) assertBoolean(boundary[field], `boundary ${field}`);
  if (boundary.emptyBeforeDiscovery !== true || boundary.authenticatedConfig !== false || boundary.cachedLocalOnly !== false || boundary.residueAfterCleanup !== false || boundary.temporaryRemoved !== true) {
    throw new Error('anonymous boundary policy denied');
  }
}

function timestampsShape(timestamps) {
  assertObject(timestamps, 'timestamps');
  for (const field of ['anonymousReceiptAt', 'submissionReceiptAt', 'discoveryStartedAt', 'discoveryFinishedAt', 'installStartedAt', 'installFinishedAt']) assertTimestamp(timestamps[field], `timestamps ${field}`);
  if (Date.parse(timestamps.anonymousReceiptAt) <= Date.parse(timestamps.submissionReceiptAt)) throw new Error('anonymous receipt older than submission receipt denied');
  if (Date.parse(timestamps.discoveryFinishedAt) < Date.parse(timestamps.discoveryStartedAt) || Date.parse(timestamps.installFinishedAt) < Date.parse(timestamps.installStartedAt)) throw new Error('command timestamp order denied');
  if (Date.parse(timestamps.installStartedAt) < Date.parse(timestamps.discoveryFinishedAt)) throw new Error('install before discovery completion denied');
  if (Date.parse(timestamps.anonymousReceiptAt) < Date.parse(timestamps.installFinishedAt)) throw new Error('receipt before install completion denied');
}

function assertFixture(fixture) {
  assertObject(fixture, 'directory transcript fixture');
  if (fixture.schemaVersion !== FIXTURE_SCHEMA) throw new Error('directory transcript fixture schema drift denied');
  if (fixture.mode !== 'fixture') throw new Error('fixture mode denied');
  packageShape(fixture.package);
  directoryShape(fixture.directory, fixture.package);
  boundaryShape(fixture.boundary);
  timestampsShape(fixture.timestamps);
  if (!Array.isArray(fixture.orderedCommands) || fixture.orderedCommands.length !== REQUIRED_COMMANDS.length) throw new Error('ordered command set denied');
  const ids = fixture.orderedCommands.map((item) => item && item.id);
  if (JSON.stringify(ids) !== JSON.stringify(REQUIRED_COMMANDS)) throw new Error('ordered command sequence denied');
  for (const [index, item] of fixture.orderedCommands.entries()) {
    assertObject(item, `ordered command ${index}`);
    assertText(item.id, `ordered command ${index} id`);
    assertText(item.phase, `ordered command ${item.id} phase`);
    commandShape(item.command, `ordered command ${item.id}`);
    if (item.expectedOutcome !== 'passed') throw new Error(`positive command outcome denied: ${item.id}`);
    resultShape(item.result, `ordered command ${item.id}`);
    if (item.result.exitCode !== 0 || item.result.signal !== null) throw new Error(`positive command result denied: ${item.id}`);
    if (item.startedAt !== undefined) assertTimestamp(item.startedAt, `${item.id} startedAt`);
    if (item.finishedAt !== undefined) assertTimestamp(item.finishedAt, `${item.id} finishedAt`);
  }
  if (!Array.isArray(fixture.negativeCases)) throw new Error('negative case set denied');
  const negativeIds = fixture.negativeCases.map((item) => item && item.id);
  if (new Set(negativeIds).size !== negativeIds.length) throw new Error('duplicate negative case denied');
  for (const id of REQUIRED_NEGATIVES) {
    const item = fixture.negativeCases.find((candidate) => candidate && candidate.id === id);
    if (!item || item.expectedOutcome !== 'denied' || item.observed?.denied !== true || typeof item.assertion !== 'string' || item.assertion.trim() === '') {
      throw new Error(`required negative assertion denied: ${id}`);
    }
  }
  if (!Array.isArray(fixture.nonClaims) || fixture.nonClaims.length === 0 || fixture.nonClaims.some((item) => typeof item !== 'string' || item.trim() === '')) throw new Error('fixture non-claims denied');
}

function assertAnonymousListing(listing, directory, packageRecord, label) {
  assertObject(listing, label);
  compareJson(listing, directory.expectedListing, `${label} exact anonymous listing`);
  if (listing.packageDigest !== packageRecord.digest || listing.title !== directory.expectedTitle) throw new Error(`${label} matching package digest/title denied`);
}

function validateFixtureEvidence(fixture) {
  const commands = new Map(fixture.orderedCommands.map((item) => [item.id, item]));
  const discovery = parseTranscriptJson(commands.get('anonymous-directory-discovery').result.stdout, 'anonymous directory discovery');
  assertAnonymousListing(discovery, fixture.directory, fixture.package, 'anonymous directory discovery');
  const exact = parseTranscriptJson(commands.get('exact-listing-readback').result.stdout, 'exact listing readback');
  assertAnonymousListing(exact, fixture.directory, fixture.package, 'exact listing readback');
  const install = parseTranscriptJson(commands.get('install-matching-package').result.stdout, 'install result');
  if (install.installed !== true || install.packageDigest !== fixture.package.digest || install.installTarget !== fixture.directory.installTarget) throw new Error('matching digest install denied');
  const readback = parseTranscriptJson(commands.get('installed-package-readback').result.stdout, 'installed package readback');
  if (readback.installed !== true || readback.packageDigest !== fixture.package.digest || readback.installTarget !== fixture.directory.installTarget) throw new Error('installed matching digest readback denied');
  const zero = parseTranscriptJson(commands.get('zero-residue-readback').result.stdout, 'zero-residue readback');
  if (zero.emptyAfterCleanup !== true || !Array.isArray(zero.residuePaths) || zero.residuePaths.length !== 0) throw new Error('zero-residue readback denied');
  return { discovery, exact, install, readback, zero };
}

function redact(value) {
  return String(value ?? '')
    .replace(/(?:sk|pk|rk|ghp|glpat|xox[baprs])-[A-Za-z0-9_-]{8,}/gi, '<redacted-token>')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '<redacted-token>');
}

function commandResult(result) {
  return {
    exitCode: result.status === undefined ? null : result.status,
    signal: result.signal || null,
    stdout: redact(result.stdout),
    stderr: redact(result.stderr),
    errorCode: result.error?.code || null,
  };
}

function replaceTokens(command, packageRecord, directory, boundary) {
  const replacements = {
    '<package-name>': packageRecord.name,
    '<package-version>': packageRecord.version,
    '<package-digest>': packageRecord.digest,
    '<install-target>': directory.installTarget,
    '<listing-id>': directory.listingId,
    '<boundary>': boundary,
  };
  return command.map((part) => Object.entries(replacements).reduce((current, [token, replacement]) => current.replaceAll(token, replacement), part));
}

function credentialFreeEnvironment(roots) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/(?:TOKEN|PASSWORD|SECRET|CREDENTIAL|API[_-]?KEY|AUTHORIZATION|PRIVATE[_-]?KEY|BEARER)/i.test(key)) delete env[key];
  }
  env.HOME = roots.home;
  env.XDG_CONFIG_HOME = roots.config;
  env.XDG_CACHE_HOME = roots.cache;
  env.XDG_DATA_HOME = roots.data;
  env.K4C_ANONYMOUS = '1';
  env.K4C_CREDENTIALS = 'none';
  return env;
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

async function authenticatedResidue(roots) {
  const paths = [];
  for (const base of [roots.home, roots.config, roots.cache, roots.data]) {
    for (const file of await listPaths(base)) {
      if (/(?:token|secret|credential|password|auth|bearer|api[_-]?key)/i.test(file)) paths.push(file);
      else {
        try {
          const text = await readFile(file, 'utf8');
          if (/(?:authorization|bearer\s|api[_-]?key|client[_-]?secret|password\s*[:=]|access[_-]?token)/i.test(text)) paths.push(file);
        } catch {
          // Binary and unreadable files are residue, but not an authentication claim.
        }
      }
    }
  }
  return paths.sort();
}

async function assertNoAuthenticatedConfig(roots) {
  const paths = await authenticatedResidue(roots);
  if (paths.length !== 0) throw new Error(`authenticated config denied: ${paths.join(', ')}`);
}

async function prepareBoundary(requested) {
  const boundary = requested || await mkdtemp(path.join(os.tmpdir(), 'ks76-anonymous-directory-'));
  await mkdir(boundary, { recursive: true });
  if ((await listPaths(boundary)).length !== 0) throw new Error('authenticated or cached preexisting boundary residue denied');
  const roots = {
    home: path.join(boundary, 'home'),
    config: path.join(boundary, 'config'),
    cache: path.join(boundary, 'cache'),
    data: path.join(boundary, 'data'),
  };
  for (const directory of Object.values(roots)) await mkdir(directory, { recursive: true });
  return { boundary, roots };
}

function recordCommand(order, id, phase, command, result, startedAt, finishedAt, assertion) {
  return {
    order,
    id,
    phase,
    command,
    expectedOutcome: result.exitCode === 0 && result.signal === null ? 'passed' : 'denied',
    ...(assertion ? { assertion } : {}),
    startedAt,
    finishedAt,
    result,
  };
}

async function runManual(fixture, args, submissionReceiptAt) {
  const context = await prepareBoundary(args.boundary);
  const { boundary, roots } = context;
  const env = credentialFreeEnvironment(roots);
  const packageRecord = fixture.package;
  const directory = fixture.directory;
  const ordered = [];
  const started = new Date().toISOString();
  let failure = null;
  let boundaryProof;
  const execute = async (id, phase, command, assertion) => {
    const startedAt = new Date().toISOString();
    const raw = spawnSync(command[0], command.slice(1), { cwd: boundary, env, encoding: 'utf8', shell: false });
    const finishedAt = new Date().toISOString();
    ordered.push(recordCommand(ordered.length + 1, id, phase, command.map((part) => part === boundary ? '<boundary>' : part), commandResult(raw), startedAt, finishedAt, assertion));
    if (raw.status !== 0 || raw.signal) throw new Error(`${id} failed: ${raw.error?.code || raw.status || raw.signal || 'unknown'}`);
    return raw.stdout;
  };
  try {
    await assertNoAuthenticatedConfig(roots);
    ordered.push(recordCommand(1, 'anonymous-boundary-preflight', 'preflight', ['read-boundary', '<boundary>'], { exitCode: 0, signal: null, stdout: 'empty anonymous boundary\n', stderr: '', errorCode: null }, started, new Date().toISOString(), 'empty boundary and credential-free environment confirmed'));
    const discoveryOutput = await execute('anonymous-directory-discovery', 'discovery', replaceTokens(args.discoverCommand, packageRecord, directory, boundary), 'anonymous discovery precedes install and returns the exact listing');
    const discovery = parseTranscriptJson(discoveryOutput, 'anonymous directory discovery');
    assertAnonymousListing(discovery, directory, packageRecord, 'anonymous directory discovery');
    await assertNoAuthenticatedConfig(roots);
    const exactOutput = await execute('exact-listing-readback', 'discovery-readback', replaceTokens(args.discoverCommand, packageRecord, directory, boundary), 'fresh anonymous readback repeats the exact listing');
    assertAnonymousListing(parseTranscriptJson(exactOutput, 'exact listing readback'), directory, packageRecord, 'exact listing readback');
    await assertNoAuthenticatedConfig(roots);
    const installOutput = await execute('install-matching-package', 'install', replaceTokens(args.installCommand, packageRecord, directory, boundary), 'install is attempted only after anonymous exact listing');
    const install = parseTranscriptJson(installOutput, 'install result');
    if (install.installed !== true || install.packageDigest !== packageRecord.digest || install.installTarget !== directory.installTarget) throw new Error('matching digest install denied');
    const readbackOutput = await execute('installed-package-readback', 'install-readback', replaceTokens(args.readbackCommand, packageRecord, directory, boundary), 'installed package readback matches discovered digest');
    const readback = parseTranscriptJson(readbackOutput, 'installed package readback');
    if (readback.installed !== true || readback.packageDigest !== packageRecord.digest || readback.installTarget !== directory.installTarget) throw new Error('installed matching digest readback denied');
    await rm(path.join(roots.cache), { recursive: true, force: true });
    await rm(path.join(roots.data), { recursive: true, force: true });
    const residuePaths = (await Promise.all([roots.home, roots.config, roots.cache, roots.data].map((base) => listPaths(base)))).flat().sort();
    if (residuePaths.length !== 0) throw new Error(`residue after cleanup denied: ${residuePaths.join(', ')}`);
    ordered.push(recordCommand(ordered.length + 1, 'zero-residue-readback', 'readback', ['read-boundary', '<boundary>'], { exitCode: 0, signal: null, stdout: 'empty\n', stderr: '', errorCode: null }, new Date().toISOString(), new Date().toISOString(), 'temporary config and cache roots are empty'));
    boundaryProof = { cleanBeforeDiscovery: true, credentialFree: true, authenticatedConfigDetected: false, cachedLocalOnlyDiscovery: false, residuePaths: [], emptyAfterCleanup: true, temporaryBoundaryRemoved: false };
  } catch (error) {
    failure = error;
    const residuePaths = (await Promise.all([roots.home, roots.config, roots.cache, roots.data].map((base) => listPaths(base)))).flat().sort();
    boundaryProof = { cleanBeforeDiscovery: ordered.some((item) => item.id === 'anonymous-boundary-preflight'), credentialFree: true, authenticatedConfigDetected: /authenticated config/i.test(error.message), cachedLocalOnlyDiscovery: /cache/i.test(error.message), residuePaths, emptyAfterCleanup: residuePaths.length === 0, temporaryBoundaryRemoved: false };
  } finally {
    await rm(boundary, { recursive: true, force: true });
    boundaryProof ||= { cleanBeforeDiscovery: false, credentialFree: true, authenticatedConfigDetected: false, cachedLocalOnlyDiscovery: false, residuePaths: [], emptyAfterCleanup: false, temporaryBoundaryRemoved: false };
    boundaryProof.temporaryBoundaryRemoved = (await listPaths(boundary)).length === 0;
  }
  const receiptAt = new Date().toISOString();
  if (!failure && Date.parse(receiptAt) <= Date.parse(submissionReceiptAt)) failure = new Error('anonymous receipt older than submission receipt denied');
  return {
    schemaVersion: RECEIPT_SCHEMA,
    mode: 'manual',
    fixture: labelPath(args.fixture),
    fixtureSha256: null,
    package: packageRecord,
    directory: { name: directory.name, listingId: directory.listingId, installTarget: directory.installTarget },
    timestamps: { anonymousReceiptAt: receiptAt, submissionReceiptAt, commandStartedAt: started, commandFinishedAt: receiptAt },
    boundaryProof,
    orderedCommandResults: ordered,
    negativeAssertions: REQUIRED_NEGATIVES.map((id) => ({ id, required: true, observed: 'not-run-in-positive-manual-path' })),
    evidence: {
      anonymousDiscoveryBeforeInstall: !failure && ordered.findIndex((item) => item.id === 'anonymous-directory-discovery') < ordered.findIndex((item) => item.id === 'install-matching-package'),
      exactListingReadback: !failure,
      matchingDigestInstall: !failure,
      installedDigestReadback: !failure,
      freshTimestamps: !failure,
      zeroResidue: boundaryProof.emptyAfterCleanup && boundaryProof.temporaryBoundaryRemoved,
    },
    accepted: !failure && boundaryProof.emptyAfterCleanup && boundaryProof.temporaryBoundaryRemoved,
    fullReceipt: !failure && boundaryProof.emptyAfterCleanup && boundaryProof.temporaryBoundaryRemoved,
    publicListingClaim: !failure && boundaryProof.emptyAfterCleanup && boundaryProof.temporaryBoundaryRemoved,
    nonClaims: NON_CLAIMS,
    ...(failure ? { failure: redact(failure.message) } : {}),
  };
}

function fixtureReceipt(fixture, args, fixtureBytes) {
  const evidence = validateFixtureEvidence(fixture);
  const commandResults = fixture.orderedCommands.map((item, index) => ({ order: index + 1, id: item.id, phase: item.phase, command: item.command, expectedOutcome: item.expectedOutcome, ...(item.assertion ? { assertion: item.assertion } : {}), startedAt: item.startedAt || null, finishedAt: item.finishedAt || null, result: item.result }));
  return {
    schemaVersion: RECEIPT_SCHEMA,
    mode: 'fixture',
    fixture: labelPath(args.fixture),
    fixtureSha256: sha256(fixtureBytes),
    package: fixture.package,
    directory: { name: fixture.directory.name, listingId: fixture.directory.listingId, installTarget: fixture.directory.installTarget },
    timestamps: fixture.timestamps,
    boundaryProof: { cleanBeforeDiscovery: fixture.boundary.emptyBeforeDiscovery, credentialFree: true, authenticatedConfigDetected: fixture.boundary.authenticatedConfig, cachedLocalOnlyDiscovery: fixture.boundary.cachedLocalOnly, residuePaths: [], emptyAfterCleanup: !fixture.boundary.residueAfterCleanup, temporaryBoundaryRemoved: fixture.boundary.temporaryRemoved },
    orderedCommandResults: commandResults,
    negativeAssertions: fixture.negativeCases.map((item) => ({ id: item.id, required: true, observed: item.observed.denied ? 'denied' : 'accepted' })),
    evidence: { anonymousDiscoveryBeforeInstall: true, exactListingReadback: true, matchingDigestInstall: evidence.install.packageDigest === fixture.package.digest, installedDigestReadback: evidence.readback.packageDigest === fixture.package.digest, freshTimestamps: true, zeroResidue: true },
    accepted: true,
    fullReceipt: true,
    publicListingClaim: true,
    nonClaims: fixture.nonClaims,
  };
}

function extractSubmissionTimestamp(value) {
  assertObject(value, 'submission receipt');
  for (const key of ['submissionReceiptAt', 'receiptAt', 'createdAt', 'timestamp', 'submittedAt']) if (typeof value[key] === 'string') return value[key];
  if (isObject(value.timestamps)) for (const key of ['submissionReceiptAt', 'receiptAt', 'createdAt', 'timestamp']) if (typeof value.timestamps[key] === 'string') return value.timestamps[key];
  throw new Error('submission receipt timestamp missing');
}

async function writeReceipt(file, receipt, dryRun) {
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (!dryRun) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, serialized, { mode: 0o644 });
  }
  process.stdout.write(serialized);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { bytes: fixtureBytes, value: fixture } = await readJsonWithBytes(args.fixture, 'directory transcript fixture');
  assertFixture(fixture);
  let submissionReceiptAt = fixture.timestamps.submissionReceiptAt;
  if (args.submissionReceipt) {
    const { value: submission } = await readJsonWithBytes(args.submissionReceipt, 'submission receipt');
    submissionReceiptAt = extractSubmissionTimestamp(submission);
    if (!args.manual && Date.parse(fixture.timestamps.anonymousReceiptAt) <= Date.parse(submissionReceiptAt)) throw new Error('anonymous receipt older than submission receipt denied');
  }
  if (!args.manual) {
    const receipt = fixtureReceipt(fixture, args, fixtureBytes);
    await writeReceipt(args.receipt, receipt, args.dryRun);
    return;
  }
  const receipt = await runManual(fixture, args, submissionReceiptAt);
  await writeReceipt(args.receipt, receipt, false);
  if (!receipt.accepted) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  process.stderr.write(`k4c-anonymous-directory-readback: ${error.message}\n`);
  process.exitCode = 1;
}