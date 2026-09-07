// CI-TOPOLOGY-01 (KaleidoSphere issue #179) — self-policing canonical test reachability.
//
//   AC01 — Enumerates the git-tracked tests/**/*.test.mjs set from tracked source and
//          proves every suite has exactly one route from the canonical npm test roots,
//          including the one intentional imported-parent route
//          (tests/source-map.test.mjs -> tests/business-bi-epic-closure.test.mjs).
//          Exact-Main baseline: 129 tracked suites, 128 direct roots, one imported
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
// Nonclaim: a passing check proves source-local canonical-CI reachability from tracked
// source. It does not execute suite bodies and does not claim production/host
// compatibility.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  canonicalTestCommand,
  canonicalTestSuppressionFlags,
  canonicalTestTopology,
  formatCommandViolations,
  formatTopologyViolations,
} from '../scripts/check-canonical-test-topology.mjs';

const SUITE = /^tests\/.+\.(test\.mjs)$/;
const INTENTIONAL_IMPORTED_SUITE = Object.freeze('tests/business-bi-epic-closure.test.mjs');
const INTENTIONAL_IMPORTED_PARENT = Object.freeze('tests/source-map.test.mjs');
const SLICE_FILES = Object.freeze([
  'scripts/check-canonical-test-topology.mjs',
  'tests/canonical-test-topology.test.mjs',
]);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// Static import statements (side-effect or bound, single-line or multi-line). Only
// relative specifiers that resolve to a tracked tests/**/*.test.mjs file form topology
// edges; everything else (node: builtins, service modules, fixtures) is outside the
// test-reachability graph.
const STATIC_IMPORT = /(?:^|\n)\s*import\s+(?:[\w$\s,{}*]+?\sfrom\s+)?['"]([^'"]+)['"]/g;

function trackedTestSuites() {
  const tracked = execFileSync('git', ['ls-files', '-z', '--', 'tests/'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
  return tracked.filter((suite) => SUITE.test(suite)).sort();
}

function canonicalDirectRoots(pkg) {
  // CI-TOPOLOGY-03: the direct roots are the suite-shaped roots reported by the
  // canonical command shape validator — the derivation itself fails closed on shell
  // operators, wrappers, extra options, and non-suite tokens instead of silently
  // filtering for suite-looking tokens.
  return canonicalTestCommand(pkg.scripts.test.split(/\s+/)).roots;
}

function resolveSpec(importer, spec) {
  const dir = importer.slice(0, importer.lastIndexOf('/'));
  return path.posix.join(dir, spec);
}

async function staticImportEdges(trackedSuites) {
  const trackedSet = new Set(trackedSuites);
  const edges = [];
  for (const file of trackedSuites) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(STATIC_IMPORT)) {
      const spec = match[1];
      if (!spec.startsWith('./') && !spec.startsWith('../')) continue;
      const resolved = resolveSpec(file, spec);
      if (resolved === file || !trackedSet.has(resolved)) continue;
      edges.push({ from: file, to: resolved });
    }
  }
  return edges;
}

async function realTopology() {
  const [pkg, tracked] = await Promise.all([
    readFile('package.json', 'utf8').then(JSON.parse),
    Promise.resolve(trackedTestSuites()),
  ]);
  const directRoots = canonicalDirectRoots(pkg);
  const importEdges = await staticImportEdges(tracked);
  return {
    tracked,
    directRoots,
    importEdges,
    topology: canonicalTestTopology({ trackedTestFiles: tracked, directRoots, importEdges }),
  };
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
  const { tracked, directRoots, importEdges, topology } = await realTopology();
  assert.deepStrictEqual(
    topology.violations,
    [],
    `canonical test topology violations: ${formatTopologyViolations(topology.violations)}`,
  );
  for (const suite of tracked) {
    assert.equal(topology.routes.get(suite).total, 1, suite);
  }
  // Exactly the current baseline shape: every suite is a direct root except the one
  // intentional imported suite, and that suite's single route is the intentional
  // parent. Named pins, not hand-maintained counts, so the invariant stays
  // self-policing as the suite set grows.
  const imported = tracked.filter((suite) => topology.routes.get(suite).direct === 0);
  assert.deepStrictEqual(imported, [INTENTIONAL_IMPORTED_SUITE]);
  assert.deepStrictEqual(
    topology.routes.get(INTENTIONAL_IMPORTED_SUITE).via,
    [INTENTIONAL_IMPORTED_PARENT],
  );
  const direct = tracked.filter((suite) => topology.routes.get(suite).direct === 1);
  assert.equal(direct.length, tracked.length - 1);
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
  // And the roots cover exactly the git-tracked suite set minus the one intentional
  // imported suite, each direct root once: the 129-suite canonical route (128 direct
  // roots + one imported-parent route) is preserved in registration terms.
  const tracked = trackedTestSuites();
  assert.deepStrictEqual(
    [...command.roots].sort(),
    tracked.filter((suite) => suite !== INTENTIONAL_IMPORTED_SUITE),
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