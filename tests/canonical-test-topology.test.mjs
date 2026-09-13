// CI-TOPOLOGY-01 (KaleidoSphere issue #179) — self-policing canonical test reachability.
//
//   AC01 — Enumerates the git-tracked tests/**/*.test.mjs set from tracked source and
//          proves every suite has exactly one route from the canonical npm test roots,
//          including the intentional imported-parent routes
//          (tests/source-map.test.mjs -> tests/business-bi-epic-closure.test.mjs and
//          tests/postgresql-c1-certification.test.mjs -> tests/postgresql-c2-safe-aggregate.test.mjs).
//          Exact-Main baseline: 130 tracked suites, 128 direct roots, two imported
//          suite; this suite's own canonical registration shifts that baseline by +1.
//   AC02 — Focused fail-closed negative regressions for an omitted suite, a duplicate
//          direct root, an orphan tracked suite, and a suite reachable through multiple
//          parents; each diagnostic names the offending repository-relative path and
//          reason.
//   AC03 — Reality is derived from the git-tracked suite set plus the canonical command
//          and static test-import graph: no second hand-maintained suite allowlist.
//
// CI-TOPOLOGY-03 (KaleidoSphere issue #184) — canonical command shape integrity:
//   the canonical command must be exactly one unwrapped `node --test <suite roots...>`
//   invocation. The shape validator (canonicalTestCommand) is bound to the live
//   package.json#scripts.test command and fails closed on any shell operator,
//   pipe/redirect, command substitution, wrapper/environment prefix, extra Node
//   option, or non-suite positional token; each diagnostic names the offending token
//   or the exact malformed prefix. Duplicate/root reachability reporting stays in the
//   existing topology kernel.
//
// CI-TOPOLOGY-04 (KaleidoSphere issue #186) — tracked-suite Git identity: the live
//   topology is bound to machine-readable `git ls-files -s` index identity (mode +
//   object type), never filesystem-following metadata, and every tracked suite's
//   identity is proven before its source is read or its import edges are derived.
//   trackedSuiteIdentities is the pure validator: it accepts only unique
//   tests/**/*.test.mjs records whose mode/type is exactly "100644 blob" and rejects
//   symlinks (120000), executable blobs (100755), non-blob/special modes, duplicate
//   paths, malformed records, and non-suite paths — each diagnostic names the
//   offending path/record and reason. A suite-shaped symlink or special-mode entry
//   therefore fails closed instead of masquerading as a tracked blob.
//
// CI-TOPOLOGY-05 (KaleidoSphere issue #188) — pseudo-import routes: the live
//   test-to-test edge derivation is bound to a pure deterministic lexical scanner
//   (staticTestModuleRoutes in scripts/check-canonical-test-topology.mjs) instead of
//   a raw-byte regex, so routes derive only from executable static import
//   declarations: import-looking bytes inside line comments, block comments,
//   single/double-quoted strings, template literal text, or regex literals never
//   create an edge, and malformed/unterminated lexical input or an ambiguous
//   import-like construct targeting a tracked test suite fails closed with a
//   diagnostic naming the importer and reason.
//
// CI-TOPOLOGY-06 (KaleidoSphere issue #190) — executable static re-export routes: the
//   scanner is generalized so a route also derives from `export * from` and named
//   `export { ... } from` re-export declarations whose literal relative specifier
//   resolves to a tracked suite. A local export without `from`, a bare specifier, and an
//   untracked target yield no edge; re-export-looking bytes inside comments, strings,
//   template literals, or regex literals yield no edge; and a malformed or ambiguous
//   re-export construct targeting a tracked suite fails closed naming the importer and
//   reason. The intentional imported-parent routes and every
//   #179/#181/#184/#186/#188 invariant are preserved.
//
// CI-TOPOLOGY-07 (KaleidoSphere issue #192) — executable routes across comment trivia:
//   the scanner treats valid JavaScript line/block comment trivia inside an executable
//   static import or re-export declaration as declaration trivia — the comment content
//   is never a route — so `import /* t */ './suite'`, `import // t` (newline)
//   ` './suite'`, trivia inside a named clause, and trivia around `*`, `as ns`, `from`,
//   or the literal specifier still yield exactly one edge for a tracked target; an
//   unterminated block comment inside declaration trivia fails closed naming the
//   importer and reason; and a focused Node-execution fixture proves the corresponding
//   modules actually execute. Every #179/#181/#184/#186/#188/#190 invariant is
//   preserved.
//
// CI-TOPOLOGY-08 (KaleidoSphere issue #194) — escaped static module specifiers:
// a valid ECMAScript \uNNNN escape inside a quoted executable static import or
// re-export module specifier resolves exactly one character of the specifier before
// relative resolution, so an escaped spelling of a tracked relative path yields the
// same exactly-one edge the real Node module loader executes; escape-looking bytes in
// comments, ordinary strings, template text, and regex literals remain non-routes; a
// decoded bare or untracked target remains a non-route; and a malformed, truncated, or
// otherwise unsupported escape in such a declaration fails closed with an
// importer-and-reason diagnostic when it could still target a tracked suite. Every
// #179/#181/#184/#186/#188/#190/#192 invariant is preserved.
//
// Nonclaim: a passing check proves source-local canonical-CI reachability from tracked
// source. It does not execute suite bodies and does not claim production/host
// compatibility.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  canonicalTestCommand,
  canonicalTestSuppressionFlags,
  canonicalTestTopology,
  formatCommandViolations,
  formatImportRouteViolations,
  formatSuiteIdentityViolations,
  formatTopologyViolations,
  staticTestModuleRoutes,
  trackedSuiteIdentities,
} from '../scripts/check-canonical-test-topology.mjs';

const SUITE = /^tests\/.+\.(test\.mjs)$/;
const INTENTIONAL_IMPORTED_SUITE = Object.freeze('tests/business-bi-epic-closure.test.mjs');
const INTENTIONAL_IMPORTED_PARENT = Object.freeze('tests/source-map.test.mjs');
// KS150 (JoFe2/KaleidoSphere#150): the committed C2 safe-aggregate suite is
// canonical through exactly one imported-parent route — its certified C1/C2
// lifecycle sibling gate. The canonical command itself is byte-bound to the
// released manifest digest (postgresql-c1-certification AC04), so the C2
// suite cannot be registered in it; the topology invariant instead requires
// exactly this one static import route.
const INTENTIONAL_C2_IMPORTED_SUITE = Object.freeze('tests/postgresql-c2-safe-aggregate.test.mjs');
const INTENTIONAL_C2_IMPORTED_PARENT = Object.freeze('tests/postgresql-c1-certification.test.mjs');
const INTENTIONAL_IMPORTED_ROUTES = Object.freeze([
  { parent: INTENTIONAL_C2_IMPORTED_PARENT, suite: INTENTIONAL_C2_IMPORTED_SUITE },
  { parent: INTENTIONAL_IMPORTED_PARENT, suite: INTENTIONAL_IMPORTED_SUITE },
]);
const SLICE_FILES = Object.freeze([
  'scripts/check-canonical-test-topology.mjs',
  'tests/canonical-test-topology.test.mjs',
]);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// CI-TOPOLOGY-05 (issue #188): test-to-test edges are derived by the pure
// deterministic lexical scanner (staticTestModuleRoutes), never by a raw-byte regex —
// import-looking bytes inside line comments, block comments, quoted strings, template
// literal text, or regex literals cannot create a pseudo-route, and malformed or
// unterminated lexical input or an ambiguous import-like construct targeting a tracked
// suite fails closed with a diagnostic naming the importer and reason.
async function staticImportEdges(trackedSuites) {
  const trackedSet = new Set(trackedSuites);
  const edges = [];
  const violations = [];
  for (const file of trackedSuites) {
    const source = await readFile(file, 'utf8');
    const scanned = staticTestModuleRoutes({ importer: file, source, trackedSuites: trackedSet });
    edges.push(...scanned.edges);
    violations.push(...scanned.violations);
  }
  return { edges, violations };
}

async function realTopology() {
  const [pkg, records] = await Promise.all([
    readFile('package.json', 'utf8').then(JSON.parse),
    Promise.resolve(trackedSuiteRecords()),
  ]);
  // CI-TOPOLOGY-04 (issue #186): bind the live topology to machine-readable Git index
  // identity and prove every tracked suite is a regular non-executable 100644 blob
  // BEFORE its source is read or its import edges are derived — a suite-shaped symlink
  // or special-mode entry fails closed here.
  const identity = trackedSuiteIdentities(records);
  const tracked = identity.suites;
  const directRoots = canonicalDirectRoots(pkg);
  // CI-TOPOLOGY-05 (issue #188): the test-to-test edges are derived by the
  // pseudo-import-aware scanner before any route counting; its fail-closed
  // diagnostics are bound to the live derivation below.
  const { edges: importEdges, violations: importRouteViolations } = await staticImportEdges(tracked);
  return {
    tracked,
    identity,
    directRoots,
    importEdges,
    importRouteViolations,
    topology: canonicalTestTopology({ trackedTestFiles: tracked, directRoots, importEdges }),
  };
}

// CI-TOPOLOGY-04 (issue #186): machine-readable Git index identity for the tracked
// suite set. `git ls-files -s` reports each index entry as "<mode> <object> <stage>
// \t<path>" (NUL-separated under -z). The mode + object type bind a suite path to its
// tracked Git object and are read from the index, never by following the filesystem,
// so a symlink or special-mode entry named tests/*.test.mjs cannot masquerade as a
// regular tracked blob.
function gitModeObjectClass(mode) {
  switch (mode) {
    case '100644':
    case '100755':
    case '120000':
      return 'blob';
    case '160000':
      return 'commit';
    case '040000':
      return 'tree';
    default:
      return 'unknown';
  }
}

function parseLsFilesEntry(entry) {
  const separator = entry.indexOf('\t');
  const meta = separator === -1 ? entry : entry.slice(0, separator);
  const file = separator === -1 ? entry : entry.slice(separator + 1);
  const [mode] = meta.split(' ');
  return { path: file, mode, type: gitModeObjectClass(mode) };
}

function trackedSuiteRecords() {
  const raw = execFileSync('git', ['ls-files', '-s', '-z', '--', 'tests/'], { encoding: 'utf8' });
  return raw
    .split('\0')
    .filter(Boolean)
    .map(parseLsFilesEntry)
    .filter((record) => SUITE.test(record.path));
}

function trackedTestSuites() {
  return trackedSuiteRecords().map((record) => record.path).sort();
}

function canonicalDirectRoots(pkg) {
  // CI-TOPOLOGY-03: the direct roots are the suite-shaped roots reported by the
  // canonical command shape validator — the derivation itself fails closed on shell
  // operators, wrappers, extra options, and non-suite tokens instead of silently
  // filtering for suite-looking tokens.
  return canonicalTestCommand(pkg.scripts.test.split(/\s+/)).roots;
}

function assertSingleViolation(topology, expectedPath, reasonPattern) {
  assert.equal(
    topology.violations.length,
    1,
    `expected exactly one violation, got: ${formatTopologyViolations(topology.violations)}`,
  );
  assert.equal(topology.violations[0].path, expectedPath);
  assert.match(topology.violations[0].reason, reasonPattern);
}

test('every tracked test suite has exactly one route from the canonical npm test roots', async () => {
  const { tracked, identity, directRoots, importEdges, importRouteViolations, topology } = await realTopology();
  // CI-TOPOLOGY-04 (issue #186): every tracked suite is bound to a regular
  // non-executable 100644 Git blob BEFORE its source is read or its import edges are
  // derived — the machine-readable index identity fails closed on a symlink or
  // special-mode suite-shaped entry.
  assert.equal(
    identity.ok,
    true,
    `tracked-suite identity violations: ${formatSuiteIdentityViolations(identity.violations)}`,
  );
  // CI-TOPOLOGY-05 (issue #188): the test-to-test edge derivation is bound to the
  // pseudo-import-aware lexical scanner before route counting — malformed or
  // unterminated lexical input, or an ambiguous import-like construct targeting a
  // tracked suite, fails closed here instead of silently creating or dropping a
  // route; each diagnostic names the importer and reason.
  assert.deepStrictEqual(
    importRouteViolations,
    [],
    `static import-route violations: ${formatImportRouteViolations(importRouteViolations)}`,
  );
  assert.deepStrictEqual(
    topology.violations,
    [],
    `canonical test topology violations: ${formatTopologyViolations(topology.violations)}`,
  );
  for (const suite of tracked) {
    assert.equal(topology.routes.get(suite).total, 1, suite);
  }
  // Exactly the current baseline shape: every suite is a direct root except the
  // intentional imported suites, and each imported suite's single route is its
  // intentional parent. Named pins, not hand-maintained counts, so the invariant
  // stays self-policing as the suite set grows.
  const imported = tracked
    .filter((suite) => topology.routes.get(suite).direct === 0);
  assert.deepStrictEqual(imported, [...INTENTIONAL_IMPORTED_ROUTES.map((r) => r.suite)].sort());
  for (const route of INTENTIONAL_IMPORTED_ROUTES) {
    assert.deepStrictEqual(topology.routes.get(route.suite).via, [route.parent]);
  }
  const direct = tracked.filter((suite) => topology.routes.get(suite).direct === 1);
  assert.equal(direct.length, tracked.length - INTENTIONAL_IMPORTED_ROUTES.length);
  // The canonical command itself is well-formed: no direct root registered twice.
  assert.equal(
    new Set(directRoots).size,
    directRoots.length,
    `canonical command registers a direct root twice: ${formatTopologyViolations(topology.violations)}`,
  );
  // The derivation is closed: every canonical direct root is a tracked suite and the
  // import graph is the derived graph itself (no hidden registration authority).
  const trackedSet = new Set(tracked);
  for (const root of directRoots) assert.ok(trackedSet.has(root), root);
  for (const edge of importEdges) {
    assert.ok(trackedSet.has(edge.from), edge.from);
    assert.ok(trackedSet.has(edge.to), edge.to);
  }
});

test('the canonical npm test command carries no Node global test-selection or suppression flag', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const tokens = pkg.scripts.test.split(/\s+/);
  // Positive: the real canonical command carries none of the forbidden Node global
  // test-selection/suppression flags — the dead global --test-skip-pattern authority is
  // gone and no replacement suppression flag is present.
  assert.deepStrictEqual(canonicalTestSuppressionFlags(tokens), []);
  // Negative: reintroducing any of the three forbidden flags on the canonical route is
  // rejected, and the diagnostic names exactly the offending flag.
  const negativeCases = [
    ['--test-skip-pattern', ['node', '--test', '--test-skip-pattern=^input$']],
    ['--test-name-pattern', ['node', '--test', '--test-name-pattern=^input$']],
    ['--test-only', ['node', '--test', '--test-only']],
  ];
  for (const [offendingFlag, command] of negativeCases) {
    assert.deepStrictEqual(
      canonicalTestSuppressionFlags(command),
      [offendingFlag],
      `must name the offending flag: ${offendingFlag}`,
    );
  }
});

// CI-TOPOLOGY-03 (KaleidoSphere issue #184) — canonical command shape integrity.

test('the live canonical npm test command is exactly one unwrapped node --test invocation', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const tokens = pkg.scripts.test.split(/\s+/);
  const command = canonicalTestCommand(tokens);
  // Positive: the live command is exactly the shape `node --test <suite roots...>` —
  // no shell operator, redirect, pipe, command substitution, wrapper/environment
  // prefix, extra Node option, or non-suite positional token anywhere in it.
  assert.deepStrictEqual(
    command.violations,
    [],
    `canonical command shape violations: ${formatCommandViolations(command.violations)}`,
  );
  assert.equal(command.ok, true);
  // Exactly one invocation: every token after `node --test` is itself a suite root, so
  // the validator's roots are the whole tail — nothing is hidden between the roots.
  assert.deepStrictEqual(command.roots, tokens.slice(2));
  // And the roots cover exactly the git-tracked suite set minus the intentional
  // imported suites, each direct root once: the 130-suite canonical route (128 direct
  // roots + two imported-parent routes) is preserved in registration terms.
  const tracked = trackedTestSuites();
  assert.deepStrictEqual(
    [...command.roots].sort(),
    tracked.filter(
      (suite) => !INTENTIONAL_IMPORTED_ROUTES.some((route) => route.suite === suite),
    ),
  );
  assert.equal(new Set(command.roots).size, command.roots.length);
});

test('shell operators, pipes/redirects, wrappers, extra options, and non-suite tokens fail closed, each diagnostic naming the offending token or exact malformed prefix', () => {
  const ALPHA = 'tests/alpha.test.mjs';
  const BETA = 'tests/beta.test.mjs';
  const negatives = [
    ['|| true suffix', ['node', '--test', ALPHA, '||', 'true'], '||', /shell operator/],
    ['&& second invocation', ['node', '--test', ALPHA, '&&', 'node', '--test', BETA], '&&', /shell operator/],
    ['; extra command', ['node', '--test', ALPHA, ';', 'echo', 'ci-passed'], ';', /shell operator/],
    ['pipe to another command', ['node', '--test', ALPHA, '|', 'cat'], '|', /shell operator/],
    ['redirect to a file', ['node', '--test', ALPHA, '>', 'tmp/last-run.log'], '>', /redirect/],
    ['wrapper prefix', ['sh', '-c', 'node', '--test', ALPHA], 'sh -c', /malformed prefix/],
    ['environment prefix', ['NODE_OPTIONS=--max-old-space-size=4096', 'node', '--test', ALPHA], 'NODE_OPTIONS=--max-old-space-size=4096', /malformed prefix/],
    ['command substitution', ['node', '--test', ALPHA, '&&', '$(echo done)'], '$(echo done)', /command substitution/],
    ['extra node option', ['node', '--test', '--test-concurrency=1', ALPHA], '--test-concurrency=1', /extra Node option/],
    ['arbitrary non-suite path', ['node', '--test', ALPHA, 'scripts/other.mjs'], 'scripts/other.mjs', /non-suite positional/],
  ];
  for (const [name, tokens, namedToken, reasonPattern] of negatives) {
    const command = canonicalTestCommand(tokens);
    assert.equal(command.ok, false, name);
    const named = command.violations.find((violation) => violation.token === namedToken);
    assert.ok(
      named,
      `${name}: a diagnostic must name "${namedToken}": ${formatCommandViolations(command.violations)}`,
    );
    assert.match(named.reason, reasonPattern, name);
  }
});

test('a canonical command without any direct suite root fails closed, naming the exact malformed prefix', () => {
  const command = canonicalTestCommand(['node', '--test']);
  assert.equal(command.ok, false);
  assert.ok(
    command.violations.some((violation) => violation.token === 'node --test'),
    `the malformed prefix must be named: ${formatCommandViolations(command.violations)}`,
  );
  for (const violation of command.violations) {
    assert.match(violation.reason, /at least one direct/, violation.reason);
  }
});

test('grafting a shell suffix onto the live canonical command fails closed, naming the grafted tokens', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const live = pkg.scripts.test.split(/\s+/);
  const command = canonicalTestCommand([...live, '||', 'true']);
  assert.equal(command.ok, false);
  for (const token of ['||', 'true']) {
    assert.ok(
      command.violations.some((violation) => violation.token === token),
      `a diagnostic must name the grafted token "${token}": ${formatCommandViolations(command.violations)}`,
    );
  }
});

test('the shape validator accepts exactly the node --test suite-root shape and preserves duplicate roots for the topology kernel', () => {
  const command = canonicalTestCommand(['node', '--test', 'tests/alpha.test.mjs', 'tests/beta.test.mjs']);
  assert.deepStrictEqual(command, {
    ok: true,
    roots: ['tests/alpha.test.mjs', 'tests/beta.test.mjs'],
    violations: [],
  });
  // A duplicated registration is suite-shaped: the shape validator preserves it in
  // command order — duplicate/root reachability reporting belongs to the topology
  // kernel, which still rejects the duplicate as multiply reachable.
  const duplicated = canonicalTestCommand([
    'node', '--test', 'tests/alpha.test.mjs', 'tests/alpha.test.mjs', 'tests/beta.test.mjs',
  ]);
  assert.equal(duplicated.ok, true);
  assert.deepStrictEqual(
    duplicated.roots,
    ['tests/alpha.test.mjs', 'tests/alpha.test.mjs', 'tests/beta.test.mjs'],
  );
  const topology = canonicalTestTopology({
    trackedTestFiles: ['tests/alpha.test.mjs', 'tests/beta.test.mjs'],
    directRoots: duplicated.roots,
    importEdges: [],
  });
  assertSingleViolation(
    topology,
    'tests/alpha.test.mjs',
    /multiply reachable from the canonical npm test roots \(2 routes: 2 direct roots\)/,
  );
});

// Small deterministic graph for the fail-closed regressions: alpha and beta are direct
// roots; gamma's single route is the import edge alpha -> gamma.
const TRACKED = Object.freeze([
  'tests/alpha.test.mjs',
  'tests/beta.test.mjs',
  'tests/gamma.test.mjs',
]);
const ROOTS = Object.freeze(['tests/alpha.test.mjs', 'tests/beta.test.mjs']);
const EDGES = Object.freeze([
  Object.freeze({ from: 'tests/alpha.test.mjs', to: 'tests/gamma.test.mjs' }),
]);

test('the clean synthetic baseline has no topology violations', () => {
  const topology = canonicalTestTopology({ trackedTestFiles: TRACKED, directRoots: ROOTS, importEdges: EDGES });
  assert.deepStrictEqual(topology.violations, []);
});

test('an omitted direct-root suite fails closed, naming the offending paths', () => {
  const topology = canonicalTestTopology({
    trackedTestFiles: TRACKED,
    directRoots: ROOTS.filter((suite) => suite !== 'tests/alpha.test.mjs'),
    importEdges: EDGES,
  });
  // alpha lost its registration and gamma lost its only reachable parent: both fail
  // closed, and each diagnostic names the offending repository-relative path.
  assert.deepStrictEqual(
    topology.violations.map((violation) => violation.path).sort(),
    ['tests/alpha.test.mjs', 'tests/gamma.test.mjs'],
  );
  for (const violation of topology.violations) {
    assert.match(violation.reason, /unreachable from the canonical npm test roots/);
  }
});

test('a duplicate direct root fails closed, naming the offending path and reason', () => {
  const topology = canonicalTestTopology({
    trackedTestFiles: TRACKED,
    directRoots: [...ROOTS, 'tests/beta.test.mjs'],
    importEdges: EDGES,
  });
  assertSingleViolation(
    topology,
    'tests/beta.test.mjs',
    /multiply reachable from the canonical npm test roots \(2 routes: 2 direct roots\)/,
  );
});

test('an orphan tracked suite fails closed, naming the offending path and reason', () => {
  const topology = canonicalTestTopology({
    trackedTestFiles: [...TRACKED, 'tests/delta.test.mjs'],
    directRoots: ROOTS,
    importEdges: EDGES,
  });
  assertSingleViolation(
    topology,
    'tests/delta.test.mjs',
    /unreachable from the canonical npm test roots: omitted or orphan tracked suite \(0 routes\)/,
  );
});

test('a suite reachable through multiple parents fails closed, naming the offending path and reason', () => {
  const topology = canonicalTestTopology({
    trackedTestFiles: TRACKED,
    directRoots: ROOTS,
    importEdges: [
      { from: 'tests/alpha.test.mjs', to: 'tests/gamma.test.mjs' },
      { from: 'tests/beta.test.mjs', to: 'tests/gamma.test.mjs' },
    ],
  });
  assertSingleViolation(
    topology,
    'tests/gamma.test.mjs',
    /multiply reachable from the canonical npm test roots \(2 routes: 2 import routes via tests\/alpha\.test\.mjs, tests\/beta\.test\.mjs\)/,
  );
});

test('a direct root that is also imported is multiply reachable', () => {
  const topology = canonicalTestTopology({
    trackedTestFiles: TRACKED,
    directRoots: [...ROOTS, 'tests/gamma.test.mjs'],
    importEdges: EDGES,
  });
  assertSingleViolation(
    topology,
    'tests/gamma.test.mjs',
    /multiply reachable from the canonical npm test roots \(2 routes: 1 direct root, 1 import route via tests\/alpha\.test\.mjs\)/,
  );
});

test('a newly tracked orphan suite on the real graph fails closed (the #179 gap)', async () => {
  const { tracked, directRoots, importEdges } = await realTopology();
  const topology = canonicalTestTopology({
    trackedTestFiles: [...tracked, 'tests/ks179-orphan.test.mjs'],
    directRoots,
    importEdges,
  });
  assertSingleViolation(
    topology,
    'tests/ks179-orphan.test.mjs',
    /unreachable from the canonical npm test roots: omitted or orphan tracked suite \(0 routes\)/,
  );
});

test('the #179 slice files are content-addressed in the source map and match on disk', async () => {
  const sourceMap = JSON.parse(await readFile('SOURCE-MAP.json', 'utf8'));
  for (const file of SLICE_FILES) {
    assert.match(sourceMap.files[file] ?? '', /^[a-f0-9]{64}$/, file);
    assert.equal(sha256(await readFile(file)), sourceMap.files[file], file);
  }
});

// CI-TOPOLOGY-04 (KaleidoSphere issue #186) — tracked-suite Git identity: only a
// regular non-executable 100644 blob may occupy a tests/**/*.test.mjs suite slot.

test('a well-formed tracked-suite set of regular 100644 blobs passes identity', () => {
  const identity = trackedSuiteIdentities([
    { path: 'tests/alpha.test.mjs', mode: '100644', type: 'blob' },
    { path: 'tests/beta.test.mjs', mode: '100644', type: 'blob' },
  ]);
  assert.deepStrictEqual(identity.violations, []);
  assert.equal(identity.ok, true);
  assert.deepStrictEqual(identity.suites, ['tests/alpha.test.mjs', 'tests/beta.test.mjs']);
});

test('every live tracked suite is a regular non-executable 100644 Git blob (machine-readable index identity)', () => {
  const records = trackedSuiteRecords();
  assert.ok(records.length > 0, 'expected a non-empty tracked suite set');
  for (const record of records) {
    assert.equal(record.mode, '100644', record.path);
    assert.equal(record.type, 'blob', record.path);
  }
  const identity = trackedSuiteIdentities(records);
  assert.deepStrictEqual(
    identity.violations,
    [],
    `tracked-suite identity violations: ${formatSuiteIdentityViolations(identity.violations)}`,
  );
  assert.equal(identity.ok, true);
});

test('a suite-shaped tracked symlink fails closed, naming the offending path and reason', () => {
  const identity = trackedSuiteIdentities([
    { path: 'tests/ks186-symlink.test.mjs', mode: '120000', type: 'blob' },
  ]);
  assert.equal(identity.ok, false);
  const violation = identity.violations.find((candidate) => candidate.path === 'tests/ks186-symlink.test.mjs');
  assert.ok(violation, formatSuiteIdentityViolations(identity.violations));
  assert.match(violation.reason, /symlink/);
  assert.match(violation.reason, /120000/);
});

test('an executable tracked suite blob fails closed, naming the offending path and reason', () => {
  const identity = trackedSuiteIdentities([
    { path: 'tests/ks186-executable.test.mjs', mode: '100755', type: 'blob' },
  ]);
  assert.equal(identity.ok, false);
  const violation = identity.violations.find((candidate) => candidate.path === 'tests/ks186-executable.test.mjs');
  assert.ok(violation, formatSuiteIdentityViolations(identity.violations));
  assert.match(violation.reason, /executable/);
  assert.match(violation.reason, /100755/);
});

test('a non-blob gitlink or unknown special-mode tracked suite fails closed, naming the offending path and reason', () => {
  const cases = [
    ['160000', 'commit', /gitlink|non-blob/],
    ['040000', 'tree', /non-regular|special|not a 100644 blob/],
    ['777777', 'unknown', /non-regular|special|not a 100644 blob/],
  ];
  for (const [mode, type, pattern] of cases) {
    const identity = trackedSuiteIdentities([
      { path: 'tests/ks186-special.test.mjs', mode, type },
    ]);
    assert.equal(identity.ok, false, `mode ${mode}`);
    const violation = identity.violations.find((candidate) => candidate.path === 'tests/ks186-special.test.mjs');
    assert.ok(violation, `mode ${mode}: ${formatSuiteIdentityViolations(identity.violations)}`);
    assert.match(violation.reason, pattern, `mode ${mode}`);
  }
});

test('a duplicate tracked-suite path with conflicting identity fails closed, naming the offending path', () => {
  const identity = trackedSuiteIdentities([
    { path: 'tests/ks186-duplicate.test.mjs', mode: '100644', type: 'blob' },
    { path: 'tests/ks186-duplicate.test.mjs', mode: '120000', type: 'blob' },
  ]);
  assert.equal(identity.ok, false);
  const violation = identity.violations.find(
    (candidate) => candidate.path === 'tests/ks186-duplicate.test.mjs' && /duplicate/.test(candidate.reason),
  );
  assert.ok(violation, formatSuiteIdentityViolations(identity.violations));
});

test('a malformed tracked-suite record fails closed, naming the offending record', () => {
  const malformedCases = [
    { path: 'tests/ks186-malformed.test.mjs' }, // missing mode
    'not-a-record', // not an object
    null, // not an object
  ];
  for (const malformed of malformedCases) {
    const identity = trackedSuiteIdentities([
      { path: 'tests/alpha.test.mjs', mode: '100644', type: 'blob' },
      malformed,
    ]);
    assert.equal(identity.ok, false, JSON.stringify(malformed));
    assert.ok(
      identity.violations.some((candidate) => /malformed/.test(candidate.reason)),
      `malformed record must be named: ${formatSuiteIdentityViolations(identity.violations)}`,
    );
  }
});

test('a non-suite tracked entry fails closed, naming the offending path and reason', () => {
  const identity = trackedSuiteIdentities([
    { path: 'tests/smoke.sh', mode: '100644', type: 'blob' },
  ]);
  assert.equal(identity.ok, false);
  const violation = identity.violations.find((candidate) => candidate.path === 'tests/smoke.sh');
  assert.ok(violation, formatSuiteIdentityViolations(identity.violations));
  assert.match(violation.reason, /suite shape|outside/);
});

// CI-TOPOLOGY-05 (KaleidoSphere issue #188) — pseudo-import routes: the live
// test-to-test edge derivation is bound to a pure deterministic lexical scanner
// (staticTestModuleRoutes) instead of a raw-byte regex, so routes derive only from
// executable static import declarations. Import-looking bytes inside comments, strings,
// template literals, or regex literals never create an edge, and malformed or ambiguous
// import-like constructs targeting a tracked suite fail closed.

const KS188_IMPORTER = Object.freeze('tests/ks188-importer.test.mjs');
const KS188_ORPHAN = Object.freeze('tests/ks188-orphan.test.mjs');

function scan(source) {
  return staticTestModuleRoutes({
    importer: KS188_IMPORTER,
    source,
    trackedSuites: new Set([KS188_ORPHAN, KS188_IMPORTER]),
  });
}

test('import-looking bytes inside a line or block comment never create an edge', () => {
  const cases = [
    ['line comment', `// import './ks188-orphan.test.mjs';`],
    ['block comment', '/* import "./ks188-orphan.test.mjs"; */'],
  ];
  for (const [name, source] of cases) {
    const scanned = scan(source);
    assert.deepStrictEqual(
      scanned.edges,
      [],
      `${name} must not create an edge: ${JSON.stringify(scanned.edges)}`,
    );
    assert.deepStrictEqual(
      scanned.violations,
      [],
      `${name} must not fail closed: ${JSON.stringify(scanned.violations)}`,
    );
  }
});

test('import-looking bytes inside a quoted string never create an edge', () => {
  const cases = [
    ["single-quoted string", "const spec = './ks188-orphan.test.mjs';"],
    ["double-quoted string", 'const spec = "./ks188-orphan.test.mjs";'],
    ['import inside a string', "const text = \"import './ks188-orphan.test.mjs';\";"],
  ];
  for (const [name, source] of cases) {
    const scanned = scan(source);
    assert.deepStrictEqual(
      scanned.edges,
      [],
      `${name} must not create an edge: ${JSON.stringify(scanned.edges)}`,
    );
    assert.deepStrictEqual(
      scanned.violations,
      [],
      `${name} must not fail closed: ${JSON.stringify(scanned.violations)}`,
    );
  }
});

test('import-looking bytes inside template literal text never create an edge', () => {
  const source = 'const spec = `./ks188-orphan.test.mjs`;';
  const scanned = scan(source);
  assert.deepStrictEqual(scanned.edges, []);
  assert.deepStrictEqual(scanned.violations, []);
});

test('a real static side-effect import of a tracked suite is exactly one edge', () => {
  const scanned = scan("import './ks188-orphan.test.mjs';");
  assert.deepStrictEqual(scanned.edges, [
    { from: KS188_IMPORTER, to: KS188_ORPHAN },
  ]);
  assert.deepStrictEqual(scanned.violations, []);
});

test('a real static named import from a tracked suite is exactly one edge', () => {
  const scanned = scan("import { test } from './ks188-orphan.test.mjs';");
  assert.deepStrictEqual(scanned.edges, [
    { from: KS188_IMPORTER, to: KS188_ORPHAN },
  ]);
  assert.deepStrictEqual(scanned.violations, []);
});

test('a dynamic import and import.meta never create an edge', () => {
  for (const source of ["await import('./ks188-orphan.test.mjs');", 'const m = import.meta.url;']) {
    const scanned = scan(source);
    assert.deepStrictEqual(
      scanned.edges,
      [],
      `${source} must not create an edge: ${JSON.stringify(scanned.edges)}`,
    );
    assert.deepStrictEqual(scanned.violations, []);
  }
});

test('a regex literal containing import text never creates an edge', () => {
  const scanned = scan("const re = /import '.*ks188-orphan.test.mjs'/;");
  assert.deepStrictEqual(scanned.edges, []);
  assert.deepStrictEqual(scanned.violations, []);
});

test('an import of an untracked relative specifier is not a tracked edge', () => {
  const scanned = scan("import './not-a-tracked-suite.mjs';");
  assert.deepStrictEqual(scanned.edges, []);
  assert.deepStrictEqual(scanned.violations, []);
});

test('an unterminated lexical construct fails closed, naming the importer and reason', () => {
  const cases = [
    ['unterminated template', 'const spec = `./ks188-orphan.test.mjs;'],
    ['unterminated block comment', '/* import "./ks188-orphan.test.mjs";'],
    ['unterminated single-quoted string', "const spec = './ks188-orphan.test.mjs;"],
    ['unterminated double-quoted string', 'const spec = "./ks188-orphan.test.mjs;'],
  ];
  for (const [name, source] of cases) {
    const scanned = scan(source);
    assert.deepStrictEqual(
      scanned.edges,
      [],
      `${name} must not create an edge: ${JSON.stringify(scanned.edges)}`,
    );
    assert.equal(
      scanned.violations.length,
      1,
      `${name}: ${JSON.stringify(scanned.violations)}`,
    );
    assert.equal(scanned.violations[0].path, KS188_IMPORTER);
    assert.match(
      scanned.violations[0].reason,
      /unterminated|unterminated/,
      `${name} reason must name the failure: ${scanned.violations[0].reason}`,
    );
  }
});

test('an ambiguous import-like construct targeting a tracked suite fails closed, naming the importer and reason', () => {
  // A backtick-quoted import specifier is a template-literal specifier, not the
  // single/double-quoted string form a static import declaration requires; it cannot be
  // resolved deterministically and must fail closed rather than silently creating or
  // dropping a route.
  const scanned = scan('import `./ks188-orphan.test.mjs`;');
  assert.deepStrictEqual(
    scanned.edges,
    [],
    `ambiguous construct must not create an edge: ${JSON.stringify(scanned.edges)}`,
  );
  assert.equal(scanned.violations.length, 1, JSON.stringify(scanned.violations));
  assert.equal(scanned.violations[0].path, KS188_IMPORTER);
  assert.match(
    scanned.violations[0].reason,
    /ambiguous/,
    `reason must name the ambiguity: ${scanned.violations[0].reason}`,
  );
});

test('an otherwise-orphan tracked suite stays unreachable when its only apparent route is in a comment, string, or template literal', () => {
  // The importer is itself a tracked direct root; the orphan is reachable only through
  // the apparent import, which is non-executable. Across every non-executable form the
  // derived edge set is empty, so the orphan remains unreachable (0 routes).
  for (const source of [
    "// import './ks188-orphan.test.mjs';",
    '/* import "./ks188-orphan.test.mjs"; */',
    "const spec = './ks188-orphan.test.mjs';",
    'const spec = "./ks188-orphan.test.mjs";',
    'const spec = `./ks188-orphan.test.mjs`;',
  ]) {
    const scanned = scan(source);
    assert.deepStrictEqual(
      scanned.edges,
      [],
      `non-executable apparent route must not create an edge: ${JSON.stringify(scanned.edges)}`,
    );
    const topology = canonicalTestTopology({
      trackedTestFiles: [KS188_IMPORTER, KS188_ORPHAN],
      directRoots: [KS188_IMPORTER],
      importEdges: scanned.edges,
    });
    const orphan = topology.violations.find((candidate) => candidate.path === KS188_ORPHAN);
    assert.ok(
      orphan,
      `orphan must remain unreachable: ${formatTopologyViolations(topology.violations)}`,
    );
    assert.match(orphan.reason, /unreachable/);
  }
});

// CI-TOPOLOGY-06 (KaleidoSphere issue #190) — executable static re-export routes: the
// generalized scanner derives a test-to-test route for every executable static
// module dependency, including `export * from` and named `export { ... } from`
// re-export declarations, while local exports without `from`, bare or untracked
// specifiers, and re-export-looking bytes inside comments, strings, template literals,
// or regex literals yield no edge. Malformed or ambiguous re-export constructs targeting
// a tracked suite fail closed with an importer-and-reason diagnostic.

test('a star re-export of a tracked suite is exactly one edge', () => {
  for (const source of [
    "export * from './ks188-orphan.test.mjs';",
    'export * as ns from \'./ks188-orphan.test.mjs\';',
  ]) {
    const scanned = scan(source);
    assert.deepStrictEqual(
      scanned.edges,
      [{ from: KS188_IMPORTER, to: KS188_ORPHAN }],
      `${source} must yield exactly one edge: ${JSON.stringify(scanned.edges)}`,
    );
    assert.deepStrictEqual(
      scanned.violations,
      [],
      `${source} must not fail closed: ${JSON.stringify(scanned.violations)}`,
    );
  }
});

test('a named re-export of a tracked suite is exactly one edge', () => {
  for (const source of [
    "export { default as child } from './ks188-orphan.test.mjs';",
    "export { a, b } from './ks188-orphan.test.mjs';",
    "export { default } from './ks188-orphan.test.mjs';",
  ]) {
    const scanned = scan(source);
    assert.deepStrictEqual(
      scanned.edges,
      [{ from: KS188_IMPORTER, to: KS188_ORPHAN }],
      `${source} must yield exactly one edge: ${JSON.stringify(scanned.edges)}`,
    );
    assert.deepStrictEqual(
      scanned.violations,
      [],
      `${source} must not fail closed: ${JSON.stringify(scanned.violations)}`,
    );
  }
});

test('a local export without `from` never creates an edge', () => {
  for (const source of [
    'export { a };',
    'export { a }\nexport const y = 2;',
    'export const x = 1;',
    'export default 1;',
    'export default function () {};',
    'export async function f() {}',
    'export class C {}',
  ]) {
    const scanned = scan(source);
    assert.deepStrictEqual(
      scanned.edges,
      [],
      `${source} must not create an edge: ${JSON.stringify(scanned.edges)}`,
    );
    assert.deepStrictEqual(
      scanned.violations,
      [],
      `${source} must not fail closed: ${JSON.stringify(scanned.violations)}`,
    );
  }
});

test('a local export immediately followed by a re-export yields exactly the re-export edge', () => {
  const scanned = scan("export { a }\nexport * from './ks188-orphan.test.mjs';");
  assert.deepStrictEqual(scanned.edges, [
    { from: KS188_IMPORTER, to: KS188_ORPHAN },
  ]);
  assert.deepStrictEqual(scanned.violations, []);
});

test('a re-export with a bare specifier or an untracked target is not a tracked edge', () => {
  for (const source of [
    "export * from 'pkg';",
    "export { a } from 'pkg';",
    "export * from './not-a-tracked-suite.mjs';",
  ]) {
    const scanned = scan(source);
    assert.deepStrictEqual(
      scanned.edges,
      [],
      `${source} must not create an edge: ${JSON.stringify(scanned.edges)}`,
    );
    assert.deepStrictEqual(scanned.violations, [], source);
  }
});

test('re-export-looking bytes inside a line or block comment never create an edge', () => {
  const cases = [
    ['line comment', `// export * from './ks188-orphan.test.mjs';`],
    ['block comment', '/* export * from "./ks188-orphan.test.mjs"; */'],
  ];
  for (const [name, source] of cases) {
    const scanned = scan(source);
    assert.deepStrictEqual(
      scanned.edges,
      [],
      `${name} must not create an edge: ${JSON.stringify(scanned.edges)}`,
    );
    assert.deepStrictEqual(
      scanned.violations,
      [],
      `${name} must not fail closed: ${JSON.stringify(scanned.violations)}`,
    );
  }
});

test('re-export-looking bytes inside a quoted string, template literal, or regex never create an edge', () => {
  const cases = [
    ['single-quoted string', 'const spec = \'export * from "./ks188-orphan.test.mjs";\';'],
    ['double-quoted string', 'const spec = "export { a } from \'./ks188-orphan.test.mjs\';";'],
    ['template literal', 'const spec = `export * from \'./ks188-orphan.test.mjs\';`;'],
    ['regex literal', 'const re = /export \\* from \'.*ks188-orphan.test.mjs\'/;'],
  ];
  for (const [name, source] of cases) {
    const scanned = scan(source);
    assert.deepStrictEqual(
      scanned.edges,
      [],
      `${name} must not create an edge: ${JSON.stringify(scanned.edges)}`,
    );
    assert.deepStrictEqual(
      scanned.violations,
      [],
      `${name} must not fail closed: ${JSON.stringify(scanned.violations)}`,
    );
  }
});

test('an ambiguous re-export construct targeting a tracked suite fails closed, naming the importer and reason', () => {
  // A backtick-quoted re-export specifier is a template-literal specifier, not the
  // single/double-quoted string a static re-export declaration requires; it must fail
  // closed rather than silently creating or dropping a route.
  const scanned = scan('export * from `./ks188-orphan.test.mjs`;');
  assert.deepStrictEqual(
    scanned.edges,
    [],
    `ambiguous re-export must not create an edge: ${JSON.stringify(scanned.edges)}`,
  );
  assert.equal(scanned.violations.length, 1, JSON.stringify(scanned.violations));
  assert.equal(scanned.violations[0].path, KS188_IMPORTER);
  assert.match(
    scanned.violations[0].reason,
    /ambiguous/,
    `reason must name the ambiguity: ${scanned.violations[0].reason}`,
  );
});

test('an unterminated re-export specifier targeting a tracked suite fails closed, naming the importer and reason', () => {
  for (const [name, source] of [
    ['unterminated star re-export', "export * from './ks188-orphan.test.mjs"],
    ['unterminated named re-export', "export { a } from './ks188-orphan.test.mjs"],
  ]) {
    const scanned = scan(source);
    assert.deepStrictEqual(
      scanned.edges,
      [],
      `${name} must not create an edge: ${JSON.stringify(scanned.edges)}`,
    );
    assert.equal(
      scanned.violations.length,
      1,
      `${name}: ${JSON.stringify(scanned.violations)}`,
    );
    assert.equal(scanned.violations[0].path, KS188_IMPORTER);
    assert.match(
      scanned.violations[0].reason,
      /unterminated/,
      `${name} reason must name the failure: ${scanned.violations[0].reason}`,
    );
  }
});

// CI-TOPOLOGY-07 (KaleidoSphere issue #192) — executable routes across comment trivia:
// valid JavaScript line/block comment trivia inside an executable static import or
// re-export declaration is declaration trivia, not route content. The focused Node
// fixture proves the corresponding modules actually execute, the scanner derives
// exactly one tracked edge for the same declarations, comment content never creates an
// extra edge, and an unterminated block comment inside declaration trivia fails closed.

const KS192_IMPORTER = Object.freeze('tests/ks192-parent.test.mjs');
const KS192_CHILD = Object.freeze('tests/child.test.mjs');

test('Node v24 executes static import and re-export declarations carrying valid comment trivia (the #192 current-Main gap fixture)', () => {
  // The concrete gap: Node executes these executable static declarations, but the
  // pre-#192 scanner returned zero edges and zero violations for the same bytes, so a
  // tracked suite could execute through a valid static dependency while the canonical
  // topology checker reported no route. The focused fixture runs the real Node module
  // loader over a parent/child pair in a scratch directory, proves the child module
  // actually executes, and binds the scanner to exactly one tracked edge for the same
  // declaration.
  const forms = [
    ['side-effect import, block trivia', "import /* route trivia */ './child.test.mjs';"],
    ['side-effect import, line trivia', "import // route trivia\n'./child.test.mjs';"],
    ['default-binding import, block trivia', "import /* route trivia */ child from './child.test.mjs';"],
    ['star re-export, block trivia around `*` and `from`', "export /* route trivia */ * from /* route trivia */ './child.test.mjs';"],
    ['named re-export, block trivia in the clause and before `from`', "export { child /* route trivia */ } /* route trivia */ from './child.test.mjs';"],
  ];
  for (const [name, source] of forms) {
    const dir = mkdtempSync(join(tmpdir(), 'ks192-'));
    try {
      writeFileSync(
        join(dir, 'child.test.mjs'),
        "export const child = 1;\nexport default 2;\nconsole.log('KS192_CHILD_EXECUTED');\n",
      );
      writeFileSync(join(dir, 'parent.mjs'), source);
      const out = execFileSync('node', [join(dir, 'parent.mjs')], { encoding: 'utf8' });
      assert.ok(
        out.includes('KS192_CHILD_EXECUTED'),
        `${name}: Node must execute the child module, got: ${JSON.stringify(out)}`,
      );
      const scanned = staticTestModuleRoutes({
        importer: KS192_IMPORTER,
        source,
        trackedSuites: new Set([KS192_CHILD, KS192_IMPORTER]),
      });
      assert.deepStrictEqual(
        scanned.edges,
        [{ from: KS192_IMPORTER, to: KS192_CHILD }],
        `${name}: the scanner must derive exactly one tracked edge: ${JSON.stringify(scanned.edges)}`,
      );
      assert.deepStrictEqual(
        scanned.violations,
        [],
        `${name}: the scanner must not fail closed: ${JSON.stringify(scanned.violations)}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('valid block or line comment trivia in side-effect and binding static imports is exactly one edge', () => {
  for (const [name, source] of [
    ['block trivia before the specifier', "import /* t */ './ks188-orphan.test.mjs';"],
    ['line trivia before the specifier', "import // t\n'./ks188-orphan.test.mjs';"],
    ['block trivia between `import` and the binding', "import /* t */ child from './ks188-orphan.test.mjs';"],
    ['line trivia between `import` and the binding', "import // t\nchild from './ks188-orphan.test.mjs';"],
    ['block trivia inside the named clause', "import { a /* t */ , b /* } */ } from './ks188-orphan.test.mjs';"],
    ['line trivia inside the named clause', "import { a // t\n, b }\nfrom './ks188-orphan.test.mjs';"],
    ['block trivia before `from`', "import child from /* t */ './ks188-orphan.test.mjs';"],
    ['line trivia before `from`', "import child from // t\n'./ks188-orphan.test.mjs';"],
    ['multiple consecutive trivia runs', "import /* a */ /* b */ // c\n'./ks188-orphan.test.mjs';"],
  ]) {
    const scanned = scan(source);
    assert.deepStrictEqual(
      scanned.edges,
      [{ from: KS188_IMPORTER, to: KS188_ORPHAN }],
      `${name}: must yield exactly one edge: ${JSON.stringify(scanned.edges)}`,
    );
    assert.deepStrictEqual(
      scanned.violations,
      [],
      `${name}: must not fail closed: ${JSON.stringify(scanned.violations)}`,
    );
  }
});

test('valid comment trivia around the star, named clause, `from`, and specifier of static re-exports is exactly one edge', () => {
  for (const [name, source] of [
    ['block trivia before the star', "export /* t */ * from './ks188-orphan.test.mjs';"],
    ['block trivia after the star', "export * /* t */ from './ks188-orphan.test.mjs';"],
    ['line trivia after the star', "export * // t\nfrom './ks188-orphan.test.mjs';"],
    ['block trivia around the namespace', "export * as /* t */ ns /* t */ from './ks188-orphan.test.mjs';"],
    ['block trivia before `from` in a star re-export', "export * from /* t */ './ks188-orphan.test.mjs';"],
    ['line trivia before `from` in a star re-export', "export * from // t\n'./ks188-orphan.test.mjs';"],
    ['block trivia in the named clause and before `from`', "export { a /* t */ , b /* } */ } /* t */ from './ks188-orphan.test.mjs';"],
    ['line trivia in the named clause', "export { a // t\n, b }\nfrom './ks188-orphan.test.mjs';"],
    ['block trivia before `from` in a named re-export', "export { a } from /* t */ './ks188-orphan.test.mjs';"],
  ]) {
    const scanned = scan(source);
    assert.deepStrictEqual(
      scanned.edges,
      [{ from: KS188_IMPORTER, to: KS188_ORPHAN }],
      `${name}: must yield exactly one edge: ${JSON.stringify(scanned.edges)}`,
    );
    assert.deepStrictEqual(
      scanned.violations,
      [],
      `${name}: must not fail closed: ${JSON.stringify(scanned.violations)}`,
    );
  }
});

test('comment trivia does not make local exports, bare specifiers, or untracked targets into routes', () => {
  for (const [name, source] of [
    ['block trivia before a local export', "export /* t */ const x = 1;"],
    ['line trivia before a local export', "export // t\nconst x = 1;"],
    ['block trivia before a bare star re-export specifier', "export * from /* t */ 'pkg';"],
    ['block trivia in a local named export list', "export { a /* t */ , b // t\n };"],
    ['block trivia before a bare import specifier', "import /* t */ 'pkg';"],
    ['block trivia before an untracked import specifier', "import /* t */ './not-a-tracked-suite.mjs';"],
    ['block trivia before an untracked re-export specifier', "export { a } from /* t */ './not-a-tracked-suite.mjs';"],
  ]) {
    const scanned = scan(source);
    assert.deepStrictEqual(
      scanned.edges,
      [],
      `${name}: must not create an edge: ${JSON.stringify(scanned.edges)}`,
    );
    assert.deepStrictEqual(
      scanned.violations,
      [],
      `${name}: must not fail closed: ${JSON.stringify(scanned.violations)}`,
    );
  }
});

test('import/re-export-looking tokens and tracked-suite paths inside declaration trivia create no extra edge', () => {
  // The trivia content is comment content, never a route: import- and re-export-looking
  // bytes, including a second copy of the tracked specifier, stay inside the comment and
  // the declaration still yields exactly one edge.
  for (const source of [
    "import /* import './ks188-orphan.test.mjs'; */ './ks188-orphan.test.mjs';",
    "import /* export * from './ks188-orphan.test.mjs'; */ child from './ks188-orphan.test.mjs';",
    "export * from /* import './ks188-orphan.test.mjs'; export { a } from './ks188-orphan.test.mjs'; */ './ks188-orphan.test.mjs';",
    "export { a /* import './ks188-orphan.test.mjs' */ , b } from './ks188-orphan.test.mjs';",
  ]) {
    const scanned = scan(source);
    assert.deepStrictEqual(
      scanned.edges,
      [{ from: KS188_IMPORTER, to: KS188_ORPHAN }],
      `${source}: must yield exactly one edge: ${JSON.stringify(scanned.edges)}`,
    );
    assert.deepStrictEqual(
      scanned.violations,
      [],
      `${source}: must not fail closed: ${JSON.stringify(scanned.violations)}`,
    );
  }
});

test('comments outside executable declarations remain non-routes', () => {
  for (const source of [
    "// import './ks188-orphan.test.mjs';\nconst x = 1;",
    "/* import './ks188-orphan.test.mjs'; */\nconst x = 1;",
    "const x = 1; // import './ks188-orphan.test.mjs';",
    "export const x = 1; /* export * from './ks188-orphan.test.mjs'; */",
  ]) {
    const scanned = scan(source);
    assert.deepStrictEqual(
      scanned.edges,
      [],
      `${source}: must not create an edge: ${JSON.stringify(scanned.edges)}`,
    );
    assert.deepStrictEqual(
      scanned.violations,
      [],
      `${source}: must not fail closed: ${JSON.stringify(scanned.violations)}`,
    );
  }
});

test('edge multiplicity remains exact across declaration trivia', () => {
  // Two real declarations carrying trivia yield exactly two edges: the trivia neither
  // duplicates nor drops an edge.
  const scanned = scan(
    "import /* a */ './ks188-orphan.test.mjs';\nimport // b\n'./ks188-orphan.test.mjs';\n",
  );
  assert.deepStrictEqual(scanned.edges, [
    { from: KS188_IMPORTER, to: KS188_ORPHAN },
    { from: KS188_IMPORTER, to: KS188_ORPHAN },
  ]);
  assert.deepStrictEqual(scanned.violations, []);
});

test('an unterminated declaration-trivia block comment fails closed, naming the importer and reason', () => {
  for (const [name, source, declaration] of [
    ['import declaration', "import /* t './ks188-orphan.test.mjs';", 'static import declaration'],
    ['import binding region', "import child from /* t './ks188-orphan.test.mjs';", 'static import declaration'],
    ['star re-export after `from`', "export * from /* t './ks188-orphan.test.mjs';", 'static re-export declaration'],
    ['named re-export clause', "export { a /* t './ks188-orphan.test.mjs'; } from './ks188-orphan.test.mjs';", 'static re-export declaration'],
  ]) {
    const scanned = scan(source);
    assert.deepStrictEqual(
      scanned.edges,
      [],
      `${name}: must not create an edge: ${JSON.stringify(scanned.edges)}`,
    );
    assert.equal(
      scanned.violations.length,
      1,
      `${name}: ${JSON.stringify(scanned.violations)}`,
    );
    assert.equal(scanned.violations[0].path, KS188_IMPORTER);
    assert.match(scanned.violations[0].reason, /unterminated block comment/, name);
    assert.match(scanned.violations[0].reason, new RegExp(declaration), name);
  }
});

test('a malformed or ambiguous declaration with comment trivia is never promoted to a route', () => {
  for (const [name, source, reasonPattern] of [
    ['template specifier after trivia', 'import /* t */ `./ks188-orphan.test.mjs`;', /ambiguous/],
    ['template re-export specifier after trivia', 'export * from /* t */ `./ks188-orphan.test.mjs`;', /ambiguous/],
    ['unterminated quoted specifier after trivia', "import /* t */ './ks188-orphan.test.mjs", /unterminated/],
    ['unterminated quoted re-export specifier after trivia', "export * from /* t */ './ks188-orphan.test.mjs", /unterminated/],
  ]) {
    const scanned = scan(source);
    assert.deepStrictEqual(
      scanned.edges,
      [],
      `${name}: must not create an edge: ${JSON.stringify(scanned.edges)}`,
    );
    assert.equal(
      scanned.violations.length,
      1,
      `${name}: ${JSON.stringify(scanned.violations)}`,
    );
    assert.equal(scanned.violations[0].path, KS188_IMPORTER);
    assert.match(
      scanned.violations[0].reason,
      reasonPattern,
      `${name} reason must name the failure: ${scanned.violations[0].reason}`,
    );
  }
});

test('the live derived test-to-test edge set is exactly the intentional imported-parent routes', async () => {
  const { importEdges, importRouteViolations } = await realTopology();
  assert.deepStrictEqual(
    importRouteViolations,
    [],
    `static import-route violations: ${formatImportRouteViolations(importRouteViolations)}`,
  );
  assert.deepStrictEqual(
    importEdges,
    INTENTIONAL_IMPORTED_ROUTES.map((route) => ({ from: route.parent, to: route.suite })),
  );
});

test('formatImportRouteViolations renders importer-and-reason diagnostics', () => {
  const rendered = formatImportRouteViolations([
    { path: 'tests/alpha.test.mjs', reason: 'unterminated template literal' },
    { path: 'tests/beta.test.mjs', reason: 'ambiguous import-like construct' },
  ]);
  assert.equal(
    rendered,
    'tests/alpha.test.mjs: unterminated template literal; tests/beta.test.mjs: ambiguous import-like construct',
  );
});

// CI-TOPOLOGY-08 (KaleidoSphere issue #194) — escaped static module specifiers:
// a valid ECMAScript \uNNNN escape in a quoted executable static import or re-export
// specifier resolves exactly one character before relative resolution, so an escaped
// spelling of a tracked relative path yields exactly one edge — the same child Node's
// module loader executes; escape-looking bytes in comments, ordinary strings,
// template text, and regex literals remain non-routes; a decoded bare or untracked
// target remains a non-route; and a malformed, truncated, or otherwise unsupported
// escape in such a declaration fails closed naming the importer and reason when it
// could still target a tracked suite.

const KS194_IMPORTER = Object.freeze('tests/ks194-parent.test.mjs');
const KS194_CHILD = Object.freeze('tests/child.test.mjs');

function scanKS194(source) {
  return staticTestModuleRoutes({
    importer: KS194_IMPORTER,
    source,
    trackedSuites: new Set([KS194_CHILD, KS194_IMPORTER]),
  });
}

test('a valid \\uNNNN escape resolving one path character of a tracked relative specifier is exactly one edge in every executable static declaration form (CI-TOPOLOGY-08 AC01)', () => {
  const forms = [
    ['side-effect import, single-quoted', "import './ch\\u0069ld.test.mjs';"],
    ['side-effect import, double-quoted', 'import "./ch\\u0069ld.test.mjs";'],
    ['binding import, single-quoted', "import child from './ch\\u0069ld.test.mjs';"],
    ['binding import, double-quoted', 'import child from "./ch\\u0069ld.test.mjs";'],
    ['named import, single-quoted', "import { child } from './ch\\u0069ld.test.mjs';"],
    ['named import, double-quoted', 'import { child } from "./ch\\u0069ld.test.mjs";'],
    ['star re-export, single-quoted', "export * from './ch\\u0069ld.test.mjs';"],
    ['star re-export, double-quoted', 'export * from "./ch\\u0069ld.test.mjs";'],
    ['named re-export, single-quoted', "export { child } from './ch\\u0069ld.test.mjs';"],
    ['named re-export, double-quoted', 'export { child } from "./ch\\u0069ld.test.mjs";'],
    ['escape in the relative prefix, single-quoted', "import '\\u002e/child.test.mjs';"],
    ['multiple escapes, single-quoted', "import './\\u0063hild.test.mjs';"],
    ['uppercase hex digits, single-quoted', "import './chi\\u006Cd.test.mjs';"],
  ];
  for (const [name, source] of forms) {
    const scanned = scanKS194(source);
    assert.deepStrictEqual(
      scanned.edges,
      [{ from: KS194_IMPORTER, to: KS194_CHILD }],
      `${name}: must yield exactly one edge: ${JSON.stringify(scanned.edges)}`,
    );
    assert.deepStrictEqual(
      scanned.violations,
      [],
      `${name}: must not fail closed: ${JSON.stringify(scanned.violations)}`,
    );
  }
});

test('Node executes the escaped-specifier declarations loading the same child the scanner resolves (CI-TOPOLOGY-08 AC02)', () => {
  const forms = [
    ['side-effect import, single-quoted', "import './ch\\u0069ld.test.mjs';"],
    ['side-effect import, double-quoted', 'import "./ch\\u0069ld.test.mjs";'],
    ['binding import, single-quoted', "import child from './ch\\u0069ld.test.mjs';"],
    ['star re-export, single-quoted', "export * from './ch\\u0069ld.test.mjs';"],
    ['named re-export, single-quoted', "export { child } from './ch\\u0069ld.test.mjs';"],
  ];
  for (const [name, source] of forms) {
    const dir = mkdtempSync(join(tmpdir(), 'ks194-'));
    try {
      writeFileSync(
        join(dir, 'child.test.mjs'),
        "export const child = 1;\nexport default 2;\nconsole.log('KS194_CHILD_EXECUTED');\n",
      );
      writeFileSync(join(dir, 'parent.mjs'), source);
      const out = execFileSync('node', [join(dir, 'parent.mjs')], { encoding: 'utf8' });
      assert.ok(
        out.includes('KS194_CHILD_EXECUTED'),
        `${name}: Node must execute the child module, got: ${JSON.stringify(out)}`,
      );
      const scanned = scanKS194(source);
      assert.deepStrictEqual(
        scanned.edges,
        [{ from: KS194_IMPORTER, to: KS194_CHILD }],
        `${name}: the scanner must derive exactly one tracked edge: ${JSON.stringify(scanned.edges)}`,
      );
      assert.deepStrictEqual(
        scanned.violations,
        [],
        `${name}: the scanner must not fail closed: ${JSON.stringify(scanned.violations)}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('escape-looking bytes in comments, ordinary strings, template text, and regex literals remain non-routes (CI-TOPOLOGY-08 AC03)', () => {
  for (const [name, source] of [
    ['line comment', "// import './ch\\u0069ld.test.mjs';"],
    ['block comment', '/* import "./ch\\u0069ld.test.mjs"; */'],
    ['single-quoted ordinary string', "const spec = './ch\\u0069ld.test.mjs';"],
    ['double-quoted ordinary string', 'const spec = "./ch\\u0069ld.test.mjs";'],
    ['template literal text', 'const spec = `./ch\\u0069ld.test.mjs`;'],
    ['regex literal', "const re = /ch\\u0069ld/;"],
  ]) {
    const scanned = scanKS194(source);
    assert.deepStrictEqual(
      scanned.edges,
      [],
      `${name}: must not create an edge: ${JSON.stringify(scanned.edges)}`,
    );
    assert.deepStrictEqual(
      scanned.violations,
      [],
      `${name}: must not fail closed: ${JSON.stringify(scanned.violations)}`,
    );
  }
});

test('a decoded bare specifier or a decoded untracked target remains a non-route (CI-TOPOLOGY-08 AC03)', () => {
  for (const [name, source] of [
    ['decoded bare specifier', "import 'pkg\\u0065';"],
    ['decoded untracked relative target', "import './no\\u0070e.test.mjs';"],
    ['decoded parent-directory target outside the tracked set', "import '\\u002e\\u002e/child.test.mjs';"],
  ]) {
    const scanned = scanKS194(source);
    assert.deepStrictEqual(
      scanned.edges,
      [],
      `${name}: must not create an edge: ${JSON.stringify(scanned.edges)}`,
    );
    assert.deepStrictEqual(
      scanned.violations,
      [],
      `${name}: must not fail closed: ${JSON.stringify(scanned.violations)}`,
    );
  }
});

test('edge multiplicity remains exact for escaped specifiers (CI-TOPOLOGY-08 AC03)', () => {
  const scanned = scanKS194("import './ch\\u0069ld.test.mjs';\nimport './child.test.mjs';\n");
  assert.deepStrictEqual(scanned.edges, [
    { from: KS194_IMPORTER, to: KS194_CHILD },
    { from: KS194_IMPORTER, to: KS194_CHILD },
  ]);
  assert.deepStrictEqual(scanned.violations, []);
});

test('a malformed, truncated, or unsupported escape in a static declaration that could target a tracked suite fails closed, naming the importer and reason (CI-TOPOLOGY-08 AC04)', () => {
  for (const [name, source, declaration] of [
    ['truncated \\u escape, side-effect import', "import './ch\\u006ld.test.mjs';", 'static import'],
    ['zero-hex \\u escape, side-effect import', "import './ch\\uld.test.mjs';", 'static import'],
    ['unsupported \\x escape, side-effect import', "import './ch\\x69ld.test.mjs';", 'static import'],
    ['unsupported single-character escape, side-effect import', "import './ch\\ild.test.mjs';", 'static import'],
    ['escaped backslash, side-effect import', "import './ch\\\\ld.test.mjs';", 'static import'],
    ['truncated \\u escape, star re-export', "export * from './ch\\u006ld.test.mjs';", 'static re-export'],
    ['unsupported \\x escape, named re-export', "export { child } from './ch\\x69ld.test.mjs';", 'static re-export'],
  ]) {
    const scanned = scanKS194(source);
    assert.deepStrictEqual(
      scanned.edges,
      [],
      `${name}: must not create an edge: ${JSON.stringify(scanned.edges)}`,
    );
    assert.equal(
      scanned.violations.length,
      1,
      `${name}: ${JSON.stringify(scanned.violations)}`,
    );
    assert.equal(scanned.violations[0].path, KS194_IMPORTER, name);
    assert.match(
      scanned.violations[0].reason,
      /malformed or unsupported escape/,
      `${name} reason must name the failure: ${scanned.violations[0].reason}`,
    );
    assert.match(
      scanned.violations[0].reason,
      /could target tracked suite "tests\/child\.test\.mjs"/,
      `${name} reason must name the tracked suite: ${scanned.violations[0].reason}`,
    );
    assert.match(scanned.violations[0].reason, new RegExp(declaration), name);
  }
});

test('an unsupported escape that cannot target any tracked suite creates no edge and no violation (CI-TOPOLOGY-08 AC04)', () => {
  for (const [name, source] of [
    ['unsupported \\x escape, untracked target', "import './no\\x61pe.test.mjs';"],
    ['truncated \\u escape, untracked target', "import './zz\\u00q.test.mjs';"],
  ]) {
    const scanned = scanKS194(source);
    assert.deepStrictEqual(
      scanned.edges,
      [],
      `${name}: must not create an edge: ${JSON.stringify(scanned.edges)}`,
    );
    assert.deepStrictEqual(
      scanned.violations,
      [],
      `${name}: must not fail closed: ${JSON.stringify(scanned.violations)}`,
    );
  }
});