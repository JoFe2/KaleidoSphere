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
  canonicalTestTopology,
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
  // The canonical command is `node --test --test-skip-pattern=... <suite> ...`; every
  // token that claims to be a suite is a direct root, in command order, duplicates
  // preserved.
  return pkg.scripts.test.split(/\s+/).filter((token) => SUITE.test(token));
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