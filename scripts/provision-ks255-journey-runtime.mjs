#!/usr/bin/env node
/**
 * KS255 (KS-OPS-03) — reproducible provisioning of the MINIMAL runtime dependency closure
 * of the current test root, without rewriting any frozen proof binding.
 *
 * The current test root selects the released suites through `package.json#scripts.test`,
 * which is byte-bound to the released C1 certificate's live manifest and therefore MUST NOT
 * change.  Several of those suites additionally exercise their released SQL adapters against
 * a REAL local PostgreSQL engine, injected as `@electric-sql/pglite`, resolved from a
 * repository-owned runtime root (`.ks-journey-runtime`) or the suite's declared
 * `/workspace/.ks-journey-runtime` fallback.  When that runtime is absent the suites SKIP
 * honestly — a skip is "runtime unavailable", never a PASS, and never fabricated coverage.
 *
 * This provisioner makes that dependency closure REPRODUCIBLE from a pinned binding:
 *
 *   dependencies/ks-journey-runtime/package.json         (declared dependency)
 *   dependencies/ks-journey-runtime/package-lock.json    (real lockfile: resolved + integrity)
 *   contracts/dependencies/ks255-journey-runtime-v1.json (pinned artifact manifest: version,
 *                                                        tarball integrity, entry digest and
 *                                                        the complete installed closure)
 *
 * Modes
 *   --measure [--json]                    measure the ACTUAL closure the current test root
 *                                         requires, derived from the git-tracked suites rather
 *                                         than a hand-maintained allowlist, and report
 *                                         declared-but-unused setup separately.
 *   --install [--runtime-root <dir>]...   `npm ci` the pinned lockfile into each declared
 *                                         runtime root and verify every installed byte.
 *   --verify  [--runtime-root <dir>]...   verify the already-installed roots against the pin.
 *
 * Fail-closed: a missing binding declaration, an empty/placeholder lockfile, a lockfile that
 * disagrees with the pin, an unresolved required suite, or any installed byte that differs
 * from the pinned artifact is DENIED with an exact code — never silently accepted.
 *
 * Non-claims: local isolated synthetic qualification only.  No host/runtime/provider change,
 * no external business effect, no production or customer data, no publication.
 */
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const DEFAULT_BINDING_DIR = 'dependencies/ks-journey-runtime';
const DEFAULT_MANIFEST_PATH = 'contracts/dependencies/ks255-journey-runtime-v1.json';
const WORKFLOW_PATH = '.github/workflows/ci.yml';
const ENTRY_SUFFIX = 'node_modules/@electric-sql/pglite/dist/index.js';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const args = process.argv.slice(2);
const has = (name) => args.includes(name);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const optionAll = (name) => args.reduce(
  (out, token, index) => (token === name ? [...out, args[index + 1]] : out), []);
const fail = (code, detail) => {
  process.stderr.write(`PROVISION-DENIED ${code}${detail ? `: ${detail}` : ''}\n`);
  process.exit(1);
};
const absolute = (target) => (path.isAbsolute(target) ? target : path.join(REPO_ROOT, target));

// ---- the pinned binding declaration ------------------------------------------------------

const loadBinding = () => {
  const bindingDir = option('--binding-dir', DEFAULT_BINDING_DIR);
  const manifestPath = option('--manifest', DEFAULT_MANIFEST_PATH);
  const pkgPath = absolute(path.join(bindingDir, 'package.json'));
  const lockPath = absolute(path.join(bindingDir, 'package-lock.json'));
  const manifestFullPath = absolute(manifestPath);
  if (!existsSync(pkgPath)) fail('BINDING_MISSING', `${bindingDir}/package.json`);
  if (!existsSync(lockPath)) fail('BINDING_MISSING', `${bindingDir}/package-lock.json`);
  if (!existsSync(manifestFullPath)) fail('MANIFEST_MISSING', manifestPath);
  const declaration = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const lockfile = JSON.parse(readFileSync(lockPath, 'utf8'));
  const manifest = JSON.parse(readFileSync(manifestFullPath, 'utf8'));

  const declaredNames = Object.keys(declaration.dependencies ?? {});
  if (declaredNames.length === 0) fail('BINDING_EMPTY', `${bindingDir}/package.json declares no dependency`);
  // A lockfile without a resolved package entry is an empty/placeholder lockfile: the binding
  // would be unverifiable, so it is refused rather than trusted.
  const packages = lockfile.packages ?? {};
  if (Object.keys(packages).length <= 1) fail('LOCKFILE_EMPTY', `${bindingDir}/package-lock.json has no resolved package`);
  const lockEntry = packages[`node_modules/${manifest.dependency}`];
  if (!lockEntry) fail('LOCKFILE_ENTRY_MISSING', manifest.dependency);
  if (typeof lockEntry.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/=]+$/.test(lockEntry.integrity)) {
    fail('LOCKFILE_ENTRY_INTEGRITY_MISSING', manifest.dependency);
  }
  if (typeof lockEntry.resolved !== 'string' || !lockEntry.resolved.startsWith('https://')) {
    fail('LOCKFILE_ENTRY_RESOLVED_MISSING', manifest.dependency);
  }
  // The lockfile is the installed-artifact authority; the pin must not drift from it.
  for (const [field, actual, expected] of [
    ['version', lockEntry.version, manifest.version],
    ['resolved', lockEntry.resolved, manifest.artifact?.resolved],
    ['integrity', lockEntry.integrity, manifest.artifact?.integrity],
    ['declaredVersion', declaration.dependencies?.[manifest.dependency], manifest.version],
  ]) {
    if (actual !== expected) fail('LOCKFILE_DISAGREES_WITH_MANIFEST', `${field}:${actual}!==${expected}`);
  }
  // The workflow action pin belongs to the same closure and must agree with the pin too.
  const workflowBytes = readFileSync(absolute(WORKFLOW_PATH), 'utf8');
  const pin = manifest.workflowPin;
  if (!pin) fail('WORKFLOW_PIN_MISSING', `no workflowPin in ${manifestPath}`);
  const workflowPinPattern = new RegExp(`${pin.package.replace(/[/@.]/g, '\\$&')}@([^\\s"']+)`);
  const workflowPinMatch = workflowBytes.match(workflowPinPattern);
  if (!workflowPinMatch) fail('WORKFLOW_PIN_MISSING', `${pin.package} in ${WORKFLOW_PATH}`);
  if (workflowPinMatch[1] !== pin.version) {
    fail('WORKFLOW_PIN_DISAGREES_WITH_MANIFEST', `${workflowPinMatch[1]}!==${pin.version}`);
  }
  return {manifest};
};

// ---- the ACTUAL closure required by the current test root --------------------------------

/** Git-tracked canonical test suites (never a filesystem walk, never a second allowlist). */
const trackedSuites = () => execFileSync('git', ['ls-files', '-z', '--', 'tests/'], {encoding: 'utf8', cwd: REPO_ROOT})
  .split('\0').filter((entry) => /^tests\/.+\.test\.mjs$/.test(entry)).sort();

/**
 * Normalize a declared candidate prefix captured from a suite's source into a runtime ROOT.
 * `${root}`/`${ROOT}`/`${repoRoot}` template holes denote this repository root.
 */
const normalizeRootPrefix = (prefix) => {
  const expanded = prefix.replace(/\$\{[^}]*\}/g, REPO_ROOT).replace(/\/$/, '');
  return path.isAbsolute(expanded) ? expanded : path.join(REPO_ROOT, expanded);
};

/**
 * Derive, per tracked suite, the runtime roots it DECLARES for the injected SQL engine.  The
 * derivation reads the suite's own declaration bytes (the candidate list it resolves), so the
 * measurement tracks the current test root instead of a hand-maintained list.
 */
const measureTestRoot = (sources) => {
  const required = [];
  const suffixPattern = ENTRY_SUFFIX.replace(/[/@.]/g, '\\$&');
  const entryPattern = new RegExp(`([^'"\`\\s,]*?)${suffixPattern}`, 'g');
  for (const {file, source} of sources) {
    if (!source.includes('PGLITE_CORE_PATH') && !source.includes(ENTRY_SUFFIX)) continue;
    const declaredEntryPaths = new Set();
    for (const match of source.matchAll(entryPattern)) {
      declaredEntryPaths.add(`${normalizeRootPrefix(match[1])}/${ENTRY_SUFFIX}`);
    }
    required.push({
      suite: file,
      injectedEnv: source.includes('PGLITE_CORE_PATH'),
      declaredEntryPaths: [...declaredEntryPaths].sort(),
    });
  }
  return required;
};

const inspectEntry = (entryPath) => {
  const full = absolute(entryPath);
  if (!existsSync(full)) return {entryPath, state: 'UNRESOLVED', entrySha256: null};
  try {
    return {entryPath, state: 'RESOLVED', entrySha256: sha256(readFileSync(full))};
  } catch {
    return {entryPath, state: 'UNRESOLVED', entrySha256: null};
  }
};

const runtimeRootOf = (entryPath) => entryPath.slice(0, entryPath.indexOf('/node_modules/'));

/** Measure the installed closure of one runtime root and compare it with the pin. */
const measureClosure = (runtimeRoot, manifest) => {
  const root = absolute(runtimeRoot);
  const closureRoot = path.join(root, manifest.closureRoot);
  if (!existsSync(closureRoot)) {
    return {runtimeRoot, state: 'RUNTIME_ROOT_MISSING', closureSha256: null, fileCount: 0,
      entrySha256: null, missing: [manifest.entryModule], extra: [], mismatched: []};
  }
  const walked = [];
  const walk = (dir) => {
    for (const entry of [...readdirSync(dir, {withFileTypes: true})]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else walked.push([path.relative(root, full).split(path.sep).join('/'), sha256(readFileSync(full))]);
    }
  };
  walk(closureRoot);
  const pinned = new Map(manifest.files.map((file) => [file.path, file.sha256]));
  const observed = new Map(walked);
  const missing = [...pinned.keys()].filter((rel) => !observed.has(rel));
  const extra = [...observed.keys()].filter((rel) => !pinned.has(rel));
  const mismatched = [...pinned.entries()]
    .filter(([rel, digest]) => observed.get(rel) !== undefined && observed.get(rel) !== digest)
    .map(([rel]) => rel);
  const entryFull = path.join(root, manifest.entryModule);
  return {
    runtimeRoot,
    state: 'MEASURED',
    entrySha256: existsSync(entryFull) ? sha256(readFileSync(entryFull)) : null,
    closureSha256: sha256(walked.sort(([a], [b]) => (a < b ? -1 : 1)).map(([p, h]) => `${p}\t${h}`).join('\n')),
    fileCount: walked.length,
    missing,
    extra,
    mismatched,
  };
};

const assertInstalled = (measured, manifest) => {
  if (measured.state !== 'MEASURED') fail('RUNTIME_ROOT_MISSING', measured.runtimeRoot);
  if (measured.entrySha256 === null) fail('INSTALLED_ENTRY_MISSING', `${measured.runtimeRoot}/${manifest.entryModule}`);
  if (measured.entrySha256 !== manifest.entrySha256) {
    fail('INSTALLED_ENTRY_DIGEST_MISMATCH', `${measured.entrySha256}!==${manifest.entrySha256}`);
  }
  if (measured.fileCount !== manifest.closureFileCount) {
    fail('INSTALLED_CLOSURE_FILE_COUNT_MISMATCH', `${measured.fileCount}!==${manifest.closureFileCount}`);
  }
  if (measured.missing.length > 0) fail('INSTALLED_FILE_MISSING', measured.missing.join(','));
  if (measured.extra.length > 0) fail('INSTALLED_FILE_UNEXPECTED', measured.extra.join(','));
  if (measured.mismatched.length > 0) fail('INSTALLED_FILE_DIGEST_MISMATCH', measured.mismatched.join(','));
  if (measured.closureSha256 !== manifest.closureSha256) {
    fail('INSTALLED_CLOSURE_DIGEST_MISMATCH', `${measured.closureSha256}!==${manifest.closureSha256}`);
  }
};

// ---- modes -------------------------------------------------------------------------------

const mode = has('--install') ? 'install' : has('--verify') ? 'verify' : 'measure';
const {manifest} = loadBinding();
const requestedRoots = optionAll('--runtime-root');
const rootsToUse = requestedRoots.length > 0 ? requestedRoots : manifest.runtimeRoots;

if (mode === 'install') {
  for (const runtimeRoot of rootsToUse) {
    const root = absolute(runtimeRoot);
    execFileSync('mkdir', ['-p', root]);
    for (const file of ['package.json', 'package-lock.json']) {
      execFileSync('cp', [absolute(path.join(option('--binding-dir', DEFAULT_BINDING_DIR), file)), path.join(root, file)]);
    }
    execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], {cwd: root, stdio: 'pipe'});
    const measured = measureClosure(runtimeRoot, manifest);
    assertInstalled(measured, manifest);
    process.stdout.write(`PROVISIONED root=${runtimeRoot} entry=${measured.entrySha256.slice(0, 12)}`
      + ` closure=${measured.closureSha256.slice(0, 12)} files=${measured.fileCount}\n`);
  }
  process.exit(0);
}

if (mode === 'verify') {
  for (const runtimeRoot of rootsToUse) {
    const measured = measureClosure(runtimeRoot, manifest);
    assertInstalled(measured, manifest);
    process.stdout.write(`PROVISION-VERIFIED root=${runtimeRoot} entry=${measured.entrySha256.slice(0, 12)}`
      + ` closure=${measured.closureSha256.slice(0, 12)} files=${measured.fileCount}\n`);
  }
  process.exit(0);
}

// --measure (default): report the ACTUAL closure the current test root requires, honestly
// distinguishing RESOLVED from UNRESOLVED and declaring (never blindly removing) unused setup.
const suiteOverrides = optionAll('--suite');
const suiteSources = suiteOverrides.length > 0
  ? suiteOverrides.map((file) => ({file, source: readFileSync(absolute(file), 'utf8')}))
  : trackedSuites().map((file) => ({file, source: readFileSync(path.join(REPO_ROOT, file), 'utf8')}));
const requiredSuites = measureTestRoot(suiteSources);
const requiredEntryPaths = [...new Set(requiredSuites.flatMap((suite) => suite.declaredEntryPaths))].sort();
const resolution = requiredEntryPaths.map(inspectEntry);
const measuredRoots = manifest.runtimeRoots.map((runtimeRoot) => measureClosure(runtimeRoot, manifest));
const declaredRootsUsed = [...new Set(requiredEntryPaths.map(runtimeRootOf))].sort();
const unusedDeclaredSetup = manifest.runtimeRoots
  .filter((runtimeRoot) => !declaredRootsUsed.includes(absolute(runtimeRoot)));
const unresolved = requiredSuites.filter((suite) => suite.declaredEntryPaths.length === 0
  || !suite.declaredEntryPaths.some((entryPath) => resolution.find((entry) => entry.entryPath === entryPath)?.state === 'RESOLVED'));

const report = {
  schemaVersion: 'kaleidosphere.dependencies/journey-runtime-measurement/v1',
  dependency: manifest.dependency,
  version: manifest.version,
  artifactIntegrity: manifest.artifact.integrity,
  pinnedEntryModule: manifest.entryModule,
  pinnedEntrySha256: manifest.entrySha256,
  pinnedClosureSha256: manifest.closureSha256,
  pinnedClosureFileCount: manifest.closureFileCount,
  requiredSuiteCount: requiredSuites.length,
  requiredSuites,
  requiredEntryPaths,
  resolution,
  measuredRoots,
  declaredRootsUsed,
  unusedDeclaredSetup,
  unresolvedSuites: unresolved.map((suite) => suite.suite),
};
if (has('--json')) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(`RUNTIME-CLOSURE-MEASURED dependency=${manifest.dependency}@${manifest.version}`
    + ` requiredSuites=${requiredSuites.length} declaredEntryPaths=${requiredEntryPaths.length}`
    + ` resolved=${resolution.filter((entry) => entry.state === 'RESOLVED').length}`
    + ` unresolved=${unresolved.length} unusedDeclaredSetup=${unusedDeclaredSetup.length}\n`);
  for (const entry of resolution) {
    process.stdout.write(`  ${entry.state} ${entry.entryPath}${entry.entrySha256 ? ` entry=${entry.entrySha256.slice(0, 12)}` : ''}\n`);
  }
  for (const suite of unresolved) process.stdout.write(`  REQUIRED-SUITE-UNRESOLVED ${suite.suite}\n`);
  for (const root of unusedDeclaredSetup) process.stdout.write(`  UNUSED-DECLARED-SETUP ${root}\n`);
}
if (has('--require-resolved') && unresolved.length > 0) {
  fail('REQUIRED_SUITE_UNRESOLVED', unresolved.map((suite) => suite.suite).join(','));
}
process.exit(0);
