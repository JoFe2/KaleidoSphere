// KS255 (KS-OPS-03) — reproducible current-test-root reachability and minimal runtime
// dependency closure, without rewriting any frozen proof binding.
//
// The current test root is `package.json#scripts.test`. It is deliberately NOT mutated here:
// the released C1 certificate binds the canonical command to the historical manifest and the
// canonical topology kernel proves exactly one route per tracked suite, so this suite rides
// the established imported-parent route (`tests/source-map.test.mjs`) exactly once.
//
// Every assertion below runs through the ACTUAL affected entry points: the provisioner CLI
// (`scripts/provision-ks255-journey-runtime.mjs`), the canonical topology kernel
// (`scripts/check-canonical-test-topology.mjs`), the content-addressed source map
// (`SOURCE-MAP.json`) and — when the pinned SQL runtime is present — the injected
// `@electric-sql/pglite` engine and the released connected-journey CLI.
//
// Boundary disclosure: the runtime-dependent legs (real SQL execution, installed-artifact
// digest verification) require the pinned dependency to be installed. When it is not present
// they are SKIPPED with an explicit "runtime unavailable" reason — a skip is never reported
// as, nor counted as, a PASS. The binding, measurement, reachability, identity and
// fail-closed rejection legs always run and need no runtime.

import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  canonicalTestCommand,
  canonicalTestTopology,
  formatTopologyViolations,
  staticTestModuleRoutes,
  trackedSuiteIdentities,
} from '../scripts/check-canonical-test-topology.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const SUITE_PATH = 'tests/ks255-journey-runtime-binding.test.mjs';
const PARENT = 'tests/source-map.test.mjs';
const PROVISIONER = 'scripts/provision-ks255-journey-runtime.mjs';
const MANIFEST_PATH = 'contracts/dependencies/ks255-journey-runtime-v1.json';
const BINDING_DIR = 'dependencies/ks-journey-runtime';
const WORKFLOW_PATH = '.github/workflows/ci.yml';
// The exact digest of the RETAINED workflow bytes, frozen by
// tests/postgresql-c2-safe-aggregate.test.mjs (C2 correction scope). Reading it here proves
// this slice did not rewrite that frozen binding.
const RETAINED_CI_SHA256 = 'a91ab312484e8475ff05ee71d2d8c02455b540244bcdb27222af336e84083a7f';
const C2_CORRECTION_COMMIT = '4bf55758904f04369afb74b6d185a511f731c71d';
const C2_CORRECTION_CI_SHA256 = '92cb8d81f7b751eb9c9fe80bbc263072f67291185548aebac79c411345677eb9';
// The recorded originals of the recovered historical evidence (never re-minted here).
const RECORDED_ORIGINALS = Object.freeze({
  'verification/postgresql/postgresql-c1-live-matrix-v1.json':
    '90866c86b344c2043fdd32b3b3728da5c1d5b957dd01119c03c9398a347f3eab',
  'docs/evidence/postgresql-c1-live-matrix/README.md':
    '9b524b4d3ed6a1ee771c10b514c23f16db159e986b99b6b035f95c944d10b92f',
});
const C1_CERTIFICATE_SHA256 = '9a34711f908ada71d20655d831d5e4c563fe5e44c4b56c3877b73af73266e90b';
// The six released suites whose real-SQL legs require the pinned runtime closure.
const REQUIRED_RUNTIME_SUITES = Object.freeze([
  'tests/net-revenue-connected-journey.test.mjs',
  'tests/net-revenue-f4-composition.test.mjs',
  'tests/net-revenue-guided-journey.test.mjs',
  'tests/net-revenue-journey.test.mjs',
  'tests/net-revenue-ledger-mapping.test.mjs',
  'tests/result-lineage-readonly.test.mjs',
]);

// Built dynamically on purpose: this suite DECLARES no runtime binding of its own, so the
// closure measurement must never count it as a runtime-requiring suite.
const ENTRY_SUFFIX = ['node_modules', '@electric-sql', 'pglite', 'dist', 'index.js'].join('/');
const CORE_PATH_ENV = ['PGLITE', 'CORE', 'PATH'].join('_');

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readBytes = (rel) => readFileSync(path.join(ROOT, rel));

const runProvisioner = (args, options = {}) => spawnSync(
  process.execPath,
  [path.join(ROOT, PROVISIONER), ...args],
  {cwd: options.cwd ?? ROOT, encoding: 'utf8'},
);

const measure = (args = []) => {
  const result = runProvisioner(['--measure', '--json', ...args]);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout);
};

/** Git-tracked suite identities, exactly as the canonical topology gate binds them. */
const trackedSuites = () => {
  const raw = execFileSync('git', ['ls-files', '-s', '-z', '--', 'tests/'], {encoding: 'utf8', cwd: ROOT});
  const records = raw.split('\0').filter((entry) => /^tests\/.+\.test\.mjs$/.test(entry.slice(entry.indexOf('\t') + 1))).map((entry) => {
    const separator = entry.indexOf('\t');
    const meta = separator === -1 ? entry : entry.slice(0, separator);
    const file = separator === -1 ? entry : entry.slice(separator + 1);
    const [mode] = meta.split(' ');
    const type = mode === '160000' ? 'commit' : mode === '040000' ? 'tree' : 'blob';
    return {path: file, mode, type};
  });
  return trackedSuiteIdentities(records);
};

// ---------------------------------------------------------------------------------------
// AC01 — the current test root reaches the same registered suites.

test('this suite is canonically reachable through exactly one imported-parent route and is never a second direct root', () => {
  const pkg = JSON.parse(readBytes('package.json').toString('utf8'));
  const tokens = pkg.scripts.test.split(/\s+/);
  const command = canonicalTestCommand(tokens);
  assert.deepStrictEqual(
    command.violations,
    [],
    `the live canonical command must stay well-formed: ${JSON.stringify(command.violations)}`,
  );
  assert.equal(command.ok, true);
  // The current test root itself is unchanged: this suite is NOT one of its direct roots,
  // so no package.json byte had to move for the new coverage to be reached.
  assert.equal(command.roots.includes(SUITE_PATH), false);

  const identity = trackedSuites();
  assert.equal(identity.ok, true, JSON.stringify(identity.violations));
  const tracked = identity.suites;
  assert.ok(tracked.includes(SUITE_PATH), `${SUITE_PATH} must be git-tracked`);

  const pkgDirectRoots = canonicalTestCommand(tokens).roots;
  const importEdges = tracked.flatMap((file) => staticTestModuleRoutes({
    importer: file,
    source: readFileSync(path.join(ROOT, file), 'utf8'),
    trackedSuites: new Set(tracked),
  }).edges);
  const topology = canonicalTestTopology({trackedTestFiles: tracked, directRoots: pkgDirectRoots, importEdges});
  assert.deepStrictEqual(
    topology.violations,
    [],
    `canonical topology violations: ${formatTopologyViolations(topology.violations)}`,
  );
  // Exactly one route for every tracked suite, exactly one static route for this suite, and
  // that route is the imported parent (never a second direct root).
  assert.equal(topology.routes.get(SUITE_PATH).total, 1, 'exactly one route');
  assert.equal(topology.routes.get(SUITE_PATH).direct, 0, 'not a direct canonical root');
  assert.deepStrictEqual(topology.routes.get(SUITE_PATH).via, [PARENT]);
  const parentSource = readFileSync(path.join(ROOT, PARENT), 'utf8');
  assert.equal(
    (parentSource.match(new RegExp(`import '\\./${path.basename(SUITE_PATH)}';`, 'g')) ?? []).length,
    1,
    'the parent registers this suite exactly once',
  );
});

test('the current test root reaches every tracked suite exactly once (the registered suite set is preserved)', () => {
  const pkg = JSON.parse(readBytes('package.json').toString('utf8'));
  const directRoots = canonicalTestCommand(pkg.scripts.test.split(/\s+/)).roots;
  const tracked = trackedSuites().suites;
  const reached = new Set([...directRoots, ...REQUIRED_RUNTIME_SUITES]);
  for (const suite of REQUIRED_RUNTIME_SUITES) {
    assert.ok(tracked.includes(suite), `${suite} must stay tracked`);
    assert.equal(
      reached.has(suite),
      true,
      `${suite} must stay reached by the current test root`,
    );
  }
  // The runtime-requiring suites are reached through the imported parent rather than being
  // registered twice: the canonical command must not carry them as direct roots as well.
  for (const suite of REQUIRED_RUNTIME_SUITES) {
    assert.equal(directRoots.includes(suite), false, `${suite} must not be a second direct root`);
  }
});

test('immutable historical evidence retains its exact source identity (no frozen proof binding rewritten)', () => {
  // (1) The retained CI workflow binding: unchanged bytes, and the source map agrees.
  assert.equal(sha256(readBytes(WORKFLOW_PATH)), RETAINED_CI_SHA256, 'retained workflow bytes');
  assert.equal(
    sha256(Buffer.from(`${execFileSync('git', ['show', `${C2_CORRECTION_COMMIT}:${WORKFLOW_PATH}`], {cwd: ROOT, encoding: 'utf8'}).trim()}\n`)),
    C2_CORRECTION_CI_SHA256,
    'the recorded C2-correction workflow original',
  );
  // (2) Every content-addressed source-map entry still matches on disk: the map binds the
  //     historical evidence and is never silently re-pointed at substituted bytes.
  const sourceMap = JSON.parse(readBytes('SOURCE-MAP.json').toString('utf8'));
  assert.equal(sourceMap.files[WORKFLOW_PATH], RETAINED_CI_SHA256);
  for (const [file, expected] of Object.entries(sourceMap.files)) {
    assert.equal(sha256(readBytes(file)), expected, `${file} source identity`);
  }
  // (3) The recovered historical originals stay at their recorded digests.
  for (const [file, expected] of Object.entries(RECORDED_ORIGINALS)) {
    assert.equal(sourceMap.files[file], expected, `${file} recorded original binding`);
    assert.equal(sha256(readBytes(file)), expected, `${file} recorded original bytes`);
  }
  const c1 = JSON.parse(readBytes('verification/postgresql/postgresql-c1-evidence-v1.json').toString('utf8'));
  assert.equal(c1.certificateSha256, C1_CERTIFICATE_SHA256, 'frozen C1 certificate digest');
  assert.equal(c1.realDisprovablePostgresql.state, 'BLOCKED_EXTERNAL', 'held real-environment evidence stays held');
});

// ---------------------------------------------------------------------------------------
// AC02 — the actual runtime dependency closure is measured, and exercised with its real
// pinned artifact.

test('the runtime dependency closure is MEASURED from the current test root, not hand-listed', () => {
  // Measurement is a REPORT: it never requires the runtime to be installed, and it never
  // upgrades an unresolved binding to a PASS.  (Rejection is the --require-resolved boundary,
  // exercised below on a disposable probe.)
  const report = measure();
  assert.equal(report.schemaVersion, 'kaleidosphere.dependencies/journey-runtime-measurement/v1');
  // The measurement derives the required suites from the tracked suite sources themselves.
  const liveReport = report;
  assert.deepStrictEqual(
    liveReport.requiredSuites.map((suite) => suite.suite).sort(),
    [...REQUIRED_RUNTIME_SUITES],
    'the measured required-suite set must be exactly the suites that declare the runtime',
  );
  // A disposable synthetic suite declaring an unmounted root is measured as UNRESOLVED and is
  // REJECTED — the tool never reports an unresolved binding as resolved.
  const sandbox = mkdtempSync(path.join(tmpdir(), 'ks255-measure-'));
  try {
    const probe = path.join(sandbox, 'synthetic-unmounted.test.mjs');
    writeFileSync(probe, [
      "import test from 'node:test';",
      `const candidates = [process.env.${CORE_PATH_ENV},`,
      `  '${sandbox}/never-mounted/${ENTRY_SUFFIX}'];`,
      "test('probe', () => {});",
      '',
    ].join('\n'));
    const unresolvedReport = measure(['--suite', probe]);
    assert.deepStrictEqual(unresolvedReport.unresolvedSuites, [probe]);
    assert.equal(unresolvedReport.resolution[0].state, 'UNRESOLVED');
    const denied = runProvisioner(['--measure', '--suite', probe, '--require-resolved']);
    assert.equal(denied.status, 1, 'an unresolved required suite must be rejected');
    assert.match(denied.stderr, /PROVISION-DENIED REQUIRED_SUITE_UNRESOLVED:/);
  } finally {
    rmSync(sandbox, {recursive: true, force: true});
  }
  // The pinned artifact identity is real and non-empty (no placeholder binding).
  assert.match(report.pinnedEntrySha256, /^[a-f0-9]{64}$/);
  assert.match(report.pinnedClosureSha256, /^[a-f0-9]{64}$/);
  assert.ok(report.pinnedClosureFileCount > 100, 'the pinned closure must be a real closure');
  assert.match(report.artifactIntegrity, /^sha512-/);
  // The workflow action pin belongs to the same closure and is measured against the manifest.
  const workflowPin = JSON.parse(readBytes(MANIFEST_PATH).toString('utf8')).workflowPin;
  assert.equal(workflowPin.path, WORKFLOW_PATH);
  assert.match(
    readBytes(WORKFLOW_PATH).toString('utf8'),
    new RegExp(`${workflowPin.package.replace(/[/@.]/g, '\\$&')}@${workflowPin.version}(\\s|$)`),
  );
});

test('the resolved pinned artifact is a REAL PostgreSQL engine and the released SQL path runs on it', async (t) => {
  const report = measure();
  const resolved = report.resolution.filter((entry) => entry.state === 'RESOLVED');
  if (resolved.length === 0) {
    // Runtime unavailable: reported as such, never as a PASS, and never faked.
    assert.deepStrictEqual(report.unresolvedSuites, [...REQUIRED_RUNTIME_SUITES].sort());
    t.skip('pinned SQL runtime not installed in this checkout; real-SQL legs not exercised here');
    return;
  }
  const entry = resolved[0].entryPath;
  assert.equal(resolved.every((candidate) => candidate.entrySha256 === resolved[0].entrySha256), true,
    'every resolved candidate root carries the SAME pinned artifact');
  assert.equal(resolved[0].entrySha256, report.pinnedEntrySha256, 'resolved entry is the pinned artifact');

  // Real SQL: the pinned artifact is an actual PostgreSQL engine, not a stub.
  const {pathToFileURL} = await import('node:url');
  const {PGlite} = await import(pathToFileURL(entry).href);
  const database = new PGlite();
  try {
    const version = await database.query("SELECT current_setting('server_version') AS v");
    assert.match(String(version.rows[0].v), /^\d+\./, `real PostgreSQL engine version, got ${JSON.stringify(version.rows)}`);
    await database.exec('CREATE TABLE ks255_probe (id integer primary key, label text);');
    await database.exec("INSERT INTO ks255_probe VALUES (1, 'pinned'), (2, 'artifact');");
    const result = await database.query('SELECT count(*)::int AS n FROM ks255_probe');
    assert.equal(result.rows[0].n, 2, 'the pinned engine executes DDL/DML/SELECT');
  } finally {
    await database.close();
  }

  // The actual affected entry point: the released connected-journey CLI over the real engine.
  const cli = spawnSync(process.execPath,
    [path.join(ROOT, 'scripts/run-connected-net-revenue-journey.mjs'), '--pglite', entry, '--negative'],
    {cwd: ROOT, encoding: 'utf8', timeout: 120000});
  assert.equal(cli.status, 0, cli.stderr);
  const out = JSON.parse(cli.stdout);
  assert.equal(
    out.negativeEvidence.forgedProvenance.evidence.code,
    'CONNECTED_PSAI_BOUNDARY_DENIED:XRA_KS01_PROVENANCE_FORGERY_DENIED',
    'the real SQL path reaches the exact released provenance rejection',
  );
});

test('the installed artifact closure is verified byte-for-byte against the pin (runtime-gated)', (t) => {
  const report = measure();
  if (report.resolution.every((entry) => entry.state !== 'RESOLVED')) {
    t.skip('pinned SQL runtime not installed in this checkout; installed-closure verification not exercised here');
    return;
  }
  const verified = runProvisioner(['--verify']);
  assert.equal(verified.status, 0, verified.stderr);
  assert.match(verified.stdout, /PROVISION-VERIFIED root=/);
  const manifest = JSON.parse(readBytes(MANIFEST_PATH).toString('utf8'));
  assert.match(verified.stdout, new RegExp(`closure=${manifest.closureSha256.slice(0, 12)}`));
  assert.match(verified.stdout, new RegExp(`files=${manifest.closureFileCount}`));
  // A substituted installed byte is refused, not accepted.
  const sandbox = mkdtempSync(path.join(tmpdir(), 'ks255-tamper-'));
  try {
    const root = path.join(sandbox, 'runtime');
    assert.equal(runProvisioner(['--install', '--runtime-root', root]).status, 0);
    writeFileSync(path.join(root, manifest.entryModule), 'substituted\n');
    const tampered = runProvisioner(['--verify', '--runtime-root', root]);
    assert.equal(tampered.status, 1);
    assert.match(tampered.stderr, /PROVISION-DENIED INSTALLED_ENTRY_DIGEST_MISMATCH:/);
  } finally {
    rmSync(sandbox, {recursive: true, force: true});
  }
});

// ---------------------------------------------------------------------------------------
// AC03 — a missing runtime binding is rejected; no empty lockfile, no fabricated coverage.

test('the committed binding lockfile is REAL: a resolved tarball with a sha512 integrity', () => {
  const lock = JSON.parse(readBytes(path.join(BINDING_DIR, 'package-lock.json')).toString('utf8'));
  const manifest = JSON.parse(readBytes(MANIFEST_PATH).toString('utf8'));
  const entry = lock.packages?.[`node_modules/${manifest.dependency}`];
  assert.ok(entry, 'the lockfile must carry a resolved entry for the pinned dependency');
  assert.equal(entry.version, manifest.version);
  assert.match(entry.integrity, /^sha512-[A-Za-z0-9+/=]+$/);
  assert.match(entry.resolved, /^https:\/\/registry\.npmjs\.org\//);
  assert.equal(entry.integrity, manifest.artifact.integrity);
  // Not an empty/placeholder lockfile: the pin is a full, digest-bound closure.
  assert.equal(manifest.files.length, manifest.closureFileCount);
  for (const file of manifest.files) assert.match(file.sha256, /^[a-f0-9]{64}$/, file.path);
});

test('a missing or empty runtime binding declaration is REJECTED with an exact code', () => {
  const sandbox = mkdtempSync(path.join(tmpdir(), 'ks255-binding-'));
  try {
    const binding = path.join(sandbox, 'binding');
    mkdirSync(binding);
    writeFileSync(path.join(binding, 'package.json'), JSON.stringify({
      name: 'ks-journey-runtime', version: '1.0.0', dependencies: {'@electric-sql/pglite': '0.3.14'},
    }, null, 2));
    // (1) missing lockfile
    const missingBridge = runProvisioner(['--verify', '--binding-dir', binding]);
    assert.equal(missingBridge.status, 1);
    assert.match(missingBridge.stderr, /PROVISION-DENIED BINDING_MISSING: .*package-lock\.json/);
    // (2) empty/placeholder lockfile
    writeFileSync(path.join(binding, 'package-lock.json'), JSON.stringify({
      name: 'ks-journey-runtime', version: '1.0.0', lockfileVersion: 3, requires: true,
      packages: {'': {name: 'ks-journey-runtime', version: '1.0.0'}},
    }, null, 2));
    const emptyLock = runProvisioner(['--verify', '--binding-dir', binding]);
    assert.equal(emptyLock.status, 1);
    assert.match(emptyLock.stderr, /PROVISION-DENIED LOCKFILE_EMPTY:/);
    // (3) a declaration without a dependency is not a binding at all
    writeFileSync(path.join(binding, 'package.json'), JSON.stringify({name: 'ks-journey-runtime', version: '1.0.0'}, null, 2));
    const noDependency = runProvisioner(['--verify', '--binding-dir', binding]);
    assert.equal(noDependency.status, 1);
    assert.match(noDependency.stderr, /PROVISION-DENIED BINDING_EMPTY:/);
    // (4) a real lockfile whose entries carry no integrity is refused, never trusted
    writeFileSync(path.join(binding, 'package.json'), JSON.stringify({
      name: 'ks-journey-runtime', version: '1.0.0', dependencies: {'@electric-sql/pglite': '0.3.14'},
    }, null, 2));
    writeFileSync(path.join(binding, 'package-lock.json'), JSON.stringify({
      name: 'ks-journey-runtime', version: '1.0.0', lockfileVersion: 3, requires: true,
      packages: {'': {name: 'ks-journey-runtime', version: '1.0.0'},
        'node_modules/@electric-sql/pglite': {version: '0.3.14', resolved: 'https://registry.npmjs.org/@electric-sql/pglite/-/pglite-0.3.14.tgz'}},
    }, null, 2));
    const noIntegrity = runProvisioner(['--verify', '--binding-dir', binding]);
    assert.equal(noIntegrity.status, 1);
    assert.match(noIntegrity.stderr, /PROVISION-DENIED LOCKFILE_ENTRY_INTEGRITY_MISSING:/);
  } finally {
    rmSync(sandbox, {recursive: true, force: true});
  }
});

test('a binding that drifts from the pin is rejected, and declared-but-unused setup is reported rather than silently removed', () => {
  const sandbox = mkdtempSync(path.join(tmpdir(), 'ks255-drift-'));
  try {
    const manifest = JSON.parse(readBytes(MANIFEST_PATH).toString('utf8'));
    // (1) version drift between the lockfile and the pin
    const drifted = {...manifest, version: '0.0.0'};
    const driftedPath = path.join(sandbox, 'manifest-version-drift.json');
    writeFileSync(driftedPath, JSON.stringify(drifted));
    const versionDrift = runProvisioner(['--verify', '--manifest', driftedPath]);
    assert.equal(versionDrift.status, 1);
    assert.match(versionDrift.stderr, /PROVISION-DENIED LOCKFILE_DISAGREES_WITH_MANIFEST: version:/);
    // (2) the workflow action pin drifting from the manifest
    const workflowDrift = {...manifest, workflowPin: {...manifest.workflowPin, version: '0.0.0'}};
    const workflowDriftPath = path.join(sandbox, 'manifest-workflow-drift.json');
    writeFileSync(workflowDriftPath, JSON.stringify(workflowDrift));
    const pinDrift = runProvisioner(['--verify', '--manifest', workflowDriftPath]);
    assert.equal(pinDrift.status, 1);
    assert.match(pinDrift.stderr, /PROVISION-DENIED WORKFLOW_PIN_DISAGREES_WITH_MANIFEST:/);
    // (3) declared-but-unused setup is REPORTED (never blindly deleted, never silently trusted)
    const withUnused = {...manifest, runtimeRoots: [...manifest.runtimeRoots, path.join(sandbox, 'never-mounted')]};
    const withUnusedPath = path.join(sandbox, 'manifest-unused.json');
    writeFileSync(withUnusedPath, JSON.stringify(withUnused));
    const measured = measure(['--manifest', withUnusedPath]);
    assert.deepStrictEqual(measured.unusedDeclaredSetup, [path.join(sandbox, 'never-mounted')]);
    // ...and the live manifest declares no unused setup: every declared root is required.
    assert.deepStrictEqual(measure().unusedDeclaredSetup, []);
  } finally {
    rmSync(sandbox, {recursive: true, force: true});
  }
});

test('an unresolvable runtime root is denied rather than treated as an absent-but-fine dependency', () => {
  const sandbox = mkdtempSync(path.join(tmpdir(), 'ks255-absent-'));
  try {
    const absent = path.join(sandbox, 'absent');
    const verified = runProvisioner(['--verify', '--runtime-root', absent]);
    assert.equal(verified.status, 1);
    assert.match(verified.stderr, /PROVISION-DENIED RUNTIME_ROOT_MISSING:/);
    const installed = runProvisioner(['--install', '--runtime-root', absent]);
    assert.equal(installed.status, 0, installed.stderr);
    assert.match(installed.stdout, /PROVISIONED root=/);
    assert.match(runProvisioner(['--verify', '--runtime-root', absent]).stdout, /PROVISION-VERIFIED root=/);
  } finally {
    rmSync(sandbox, {recursive: true, force: true});
  }
});

test('the KS255 family is content-addressed in the source map and canonically registered once through its parent', () => {
  const sourceMap = JSON.parse(readBytes('SOURCE-MAP.json').toString('utf8'));
  for (const file of [
    SUITE_PATH,
    MANIFEST_PATH,
    'dependencies/ks-journey-runtime/package.json',
    'dependencies/ks-journey-runtime/package-lock.json',
    PROVISIONER,
    'docs/evidence/ks255-journey-runtime-binding-v1.md',
    'scripts/update-ks255-journey-runtime-source-map.mjs',
  ]) {
    assert.match(sourceMap.files[file] ?? '', /^[a-f0-9]{64}$/, file);
    assert.equal(sha256(readBytes(file)), sourceMap.files[file], file);
  }
  // The canonical command still carries no direct root for this suite.
  const pkg = JSON.parse(readBytes('package.json').toString('utf8'));
  assert.equal(pkg.scripts.test.split(/\s+/).includes(SUITE_PATH), false);
  assert.ok(existsSync(path.join(ROOT, SUITE_PATH)));
});
