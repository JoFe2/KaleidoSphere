// CI-TOPOLOGY-01 (KaleidoSphere issue #179) — pure canonical test topology kernel.
//
// The `test` command in package.json#scripts is the single authority for canonical test
// reachability. Every tracked tests/**/*.test.mjs suite must have exactly one route into
// that graph: either exactly one occurrence as a direct root in the canonical command,
// or exactly one static import edge from a reachable test file (the current intentional
// route is tests/source-map.test.mjs -> tests/business-bi-epic-closure.test.mjs).
//
// Zero routes is an unreachable (omitted or orphaned) tracked suite. More than one route
// is multiply reachable: a duplicated direct root, a suite imported by multiple parents,
// or a direct root that is also imported.
//
// Pure graph kernel: no fs, git, or process access. The caller derives the inputs from
// tracked repository source (the tracked suite set, the canonical command tokens, and
// the static import edges), so this check never holds a second hand-maintained suite
// allowlist that could drift in parallel with the canonical command.
//
// CI-SUPPRESSION-01 (KaleidoSphere issue #181) — the canonical test command additionally
// carries no Node global test-selection/suppression flag. The dead global
// --test-skip-pattern that matched no test title is removed from canonical npm test, and
// any of the three flags (--test-skip-pattern, --test-name-pattern, --test-only)
// re-introduced into the canonical command fails closed and is named, so future global
// test suppression is explicit rather than a silent, drifting authority.
//
// Nonclaim: a clean report proves source-local canonical-CI reachability from tracked
// source. It does not execute suite bodies and does not claim production/host
// compatibility.

const SUITE = /^tests\/.+\.(test\.mjs)$/;

function pluralize(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

// trackedTestFiles: repo-relative tests/**/*.test.mjs paths (order irrelevant).
// directRoots: repo-relative suite paths in canonical command order, duplicates
//   preserved — a duplicated registration is exactly the defect this kernel rejects.
// importEdges: { from, to } repo-relative static import edges between test suites,
//   multiplicity preserved.
// Returns { reachable, routes, violations } where routes maps each tracked suite to
// { direct, via, total } and violations is a deterministic [{ path, reason }] list:
//   - 0 routes  -> unreachable (omitted or orphan tracked suite)
//   - N>1 routes -> multiply reachable (duplicate root / multiple parents)
//   - a direct root that is not a tracked suite
export function canonicalTestTopology({ trackedTestFiles, directRoots, importEdges }) {
  const tracked = [...new Set(trackedTestFiles)].sort();
  const trackedSet = new Set(tracked);

  const roots = directRoots.filter((suite) => SUITE.test(suite));
  const edges = importEdges.filter(
    (edge) => edge !== null && typeof edge === 'object'
      && SUITE.test(edge.from) && SUITE.test(edge.to)
      && trackedSet.has(edge.from) && trackedSet.has(edge.to)
      && edge.from !== edge.to,
  );

  const directCount = new Map();
  for (const suite of roots) directCount.set(suite, (directCount.get(suite) ?? 0) + 1);

  // Reachable set: the least set containing every direct root and closed under import
  // edges. Iterative fixpoint — the current graph is depth one, but the closure is
  // defined for arbitrary depth.
  const reachable = new Set([...directCount.keys()]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const edge of edges) {
      if (reachable.has(edge.from) && !reachable.has(edge.to)) {
        reachable.add(edge.to);
        grew = true;
      }
    }
  }

  // One route per tracked suite: its direct-root occurrences plus its import edges from
  // reachable parents. A parent that is itself unreachable contributes no route.
  const routes = new Map();
  for (const suite of tracked) {
    const direct = directCount.get(suite) ?? 0;
    const via = edges
      .filter((edge) => edge.to === suite && reachable.has(edge.from))
      .map((edge) => edge.from)
      .sort();
    routes.set(suite, { direct, via, total: direct + via.length });
  }

  const violations = [];
  for (const suite of tracked) {
    const route = routes.get(suite);
    if (route.total === 0) {
      violations.push({
        path: suite,
        reason: 'unreachable from the canonical npm test roots: omitted or orphan tracked suite (0 routes)',
      });
    } else if (route.total > 1) {
      const parts = [];
      if (route.direct > 0) parts.push(pluralize(route.direct, 'direct root'));
      if (route.via.length > 0) parts.push(`${pluralize(route.via.length, 'import route')} via ${route.via.join(', ')}`);
      violations.push({
        path: suite,
        reason: `multiply reachable from the canonical npm test roots (${route.total} routes: ${parts.join(', ')})`,
      });
    }
  }
  for (const suite of [...new Set(roots)].sort()) {
    if (!trackedSet.has(suite)) {
      violations.push({
        path: suite,
        reason: 'direct canonical root is not a tracked tests/**/*.test.mjs suite',
      });
    }
  }
  violations.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0));

  return { reachable, routes, violations };
}

// One-line diagnostics for test failures: "path: reason; path: reason".
export function formatTopologyViolations(violations) {
  return violations.map((violation) => `${violation.path}: ${violation.reason}`).join('; ');
}

// CI-SUPPRESSION-01 (KaleidoSphere issue #181): Node's global test-selection/suppression
// flags silently narrow the canonical suite set. None of them may appear in the
// canonical npm test command; any future global test suppression is therefore explicit
// and fail-closed, and is rejected by name.
export const FORBIDDEN_CANONICAL_TEST_FLAGS = Object.freeze([
  '--test-skip-pattern',
  '--test-name-pattern',
  '--test-only',
]);

// Returns the forbidden global test-selection/suppression flags present in a canonical
// test command, in flag definition order. A bare `--flag` token and a `--flag=value`
// token both count as the flag being used; suite paths and unrelated `--test*` options
// are not flagged.
export function canonicalTestSuppressionFlags(command) {
  const tokens = String(command).split(/\s+/).filter(Boolean);
  return FORBIDDEN_CANONICAL_TEST_FLAGS.filter((flag) =>
    tokens.some((token) => token === flag || token.startsWith(`${flag}=`)),
  );
}

// One-line diagnostics for suppression violations: "flag: reason; flag: reason".
export function formatSuppressionViolations(flags) {
  return flags
    .map((flag) =>
      `canonical test command uses forbidden global test-selection/suppression flag: ${flag}`)
    .join('; ');
}