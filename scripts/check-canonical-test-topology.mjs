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
// CI-TOPOLOGY-03 (KaleidoSphere issue #184) — canonical command shape integrity: the
// canonical command must be exactly one unwrapped `node --test <suite roots...>`
// invocation; canonicalTestCommand below fails closed on every token outside that
// shape. Duplicate/root reachability reporting stays in the topology kernel above.
//
// CI-TOPOLOGY-04 (KaleidoSphere issue #186) — tracked-suite Git identity: a canonical
// test suite occupies a tests/**/*.test.mjs slot in the tracked source. The gate must
// reject a canonical CI run unless every such suite is a regular non-executable Git
// blob (mode/type exactly "100644 blob"): a suite-shaped symlink (120000), an
// executable blob (100755), a non-blob/special entry (e.g. a 160000 gitlink), a
// duplicate path, a malformed record, or a non-suite path would otherwise remain
// suite-shaped by name while redirecting or masking the tracked source identity.
// trackedSuiteIdentities is the pure validator: it takes the machine-readable index
// records the caller derives (each { path, mode, type }) and reports a fail-closed
// [{ path, reason }] list, accepting only unique tests/**/*.test.mjs records whose
// mode/type is exactly "100644 blob".
//
// Nonclaim: a clean report proves source-local canonical-CI reachability from tracked
// source. It does not execute suite bodies and does not claim production/host
// compatibility.

const SUITE = /^tests\/.+\.(test\.mjs)$/;

// Node global test-selection/suppression flags the canonical `test` command must never
// carry. Carrying one on the canonical route grants repository-wide global selection or
// suppression authority; that authority belongs to an explicit, fail-closed gate, not a
// hand-maintained flag on the canonical command.
const FORBIDDEN_CANONICAL_TEST_FLAGS = Object.freeze([
  '--test-skip-pattern',
  '--test-name-pattern',
  '--test-only',
]);

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

// Returns the offending forbidden Node global test-selection/suppression flags present in
// the canonical command tokens, in first-occurrence order. The canonical command must
// carry none: a bare flag token or a `flag=value` token both count. Pure token scan with no
// fs/process access, so the caller derives the tokens from the canonical command.
export function canonicalTestSuppressionFlags(tokens) {
  const offenders = [];
  for (const token of tokens) {
    for (const flag of FORBIDDEN_CANONICAL_TEST_FLAGS) {
      const present = token === flag || token.startsWith(`${flag}=`);
      if (present && !offenders.includes(flag)) offenders.push(flag);
    }
  }
  return offenders;
}

// CI-TOPOLOGY-03 (KaleidoSphere issue #184) — canonical command shape validation.
//
// The canonical `npm test` command must be exactly one unwrapped Node test invocation
// of the shape `node --test <tests/**/*.test.mjs roots...>`. The suite-shape filter in
// the topology kernel derivation is not sufficient: extra shell/control tokens (`||
// true`, `&& ...`, `; ...`), pipes and redirections, command substitution,
// environment/wrapper prefixes, extra Node options, and non-suite positional
// arguments can preserve a clean suite-shape filter while changing or masking the
// canonical CI execution. canonicalTestCommand accepts only the exact shape, rejects
// every token outside it, and requires at least one direct suite root. Duplicate
// suite roots are suite-shaped and are preserved in command order — duplicate/root
// reachability reporting belongs to canonicalTestTopology.
const NODE = Object.freeze('node');
const TEST_FLAG = Object.freeze('--test');
const CANONICAL_SHAPE =
  'the canonical command must be exactly "node --test <tests/**/*.test.mjs roots...>"';
const SHELL_OPERATOR_TOKENS = Object.freeze(new Set(['|', '||', '&&', ';', '&']));
const REDIRECT_TOKENS = Object.freeze(
  new Set(['<', '<<', '<<<', '>', '>>', '2>', '2>>', '&>', '&>>']),
);
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

function classifyOffendingToken(token) {
  if (SHELL_OPERATOR_TOKENS.has(token)) {
    return `shell operator token "${token}" is not allowed; ${CANONICAL_SHAPE}`;
  }
  if (REDIRECT_TOKENS.has(token)) {
    return `redirect token "${token}" is not allowed; ${CANONICAL_SHAPE}`;
  }
  if (token.includes('$(') || token.includes('`')) {
    return `command substitution token "${token}" is not allowed; ${CANONICAL_SHAPE}`;
  }
  if (ENV_ASSIGNMENT.test(token)) {
    return `environment assignment token "${token}" is not allowed; ${CANONICAL_SHAPE}`;
  }
  if (token.startsWith('-')) {
    return `extra Node option token "${token}" is not allowed; ${CANONICAL_SHAPE}`;
  }
  return `non-suite positional token "${token}" is not allowed; ${CANONICAL_SHAPE}`;
}

// tokens: whitespace-split canonical command tokens.
// Returns { ok, roots, violations }:
//   roots — the suite-shaped direct roots at index >= 2, in command order, duplicates
//     preserved (feed these to canonicalTestTopology as directRoots; the kernel keeps
//     the duplicate/root reachability reporting);
//   violations — a deterministic [{ token, reason }] naming every offending token or
//     the exact malformed prefix; empty iff the command is exactly one unwrapped
//     `node --test` invocation carrying at least one direct suite root.
export function canonicalTestCommand(tokens) {
  const list = (Array.isArray(tokens) ? tokens : []).filter(
    (token) => typeof token === 'string' && token !== '',
  );
  const violations = [];
  const roots = [];

  const firstNode = list.indexOf(NODE);
  if (firstNode !== 0) {
    const prefix = list.slice(0, firstNode === -1 ? list.length : firstNode).join(' ');
    violations.push({
      token: prefix,
      reason: prefix === ''
        ? `empty canonical command: ${CANONICAL_SHAPE}`
        : `canonical command must begin exactly with "node"; found malformed prefix "${prefix}" (wrapper or environment prefix is not allowed)`,
    });
  }

  for (let index = 1; index < list.length; index += 1) {
    const token = list[index];
    if (index === 1) {
      if (token !== TEST_FLAG) {
        violations.push({
          token,
          reason: `canonical command token 1 must be exactly "--test"; found "${token}"`,
        });
      }
      continue;
    }
    if (SUITE.test(token)) {
      roots.push(token);
    } else {
      violations.push({ token, reason: classifyOffendingToken(token) });
    }
  }

  if (roots.length === 0) {
    violations.push({
      token: list.join(' '),
      reason: `canonical command carries no direct suite root: it must be exactly "node --test <roots...>" with at least one direct tests/**/*.test.mjs root`,
    });
  }

  return { ok: violations.length === 0, roots, violations };
}

// One-line diagnostics for command-shape failures: "\"token\": reason; \"token\": reason".
export function formatCommandViolations(violations) {
  return violations
    .map((violation) => `${violation.token === '' ? '(empty)' : `"${violation.token}"`}: ${violation.reason}`)
    .join('; ');
}

// One-line diagnostics for test failures: "path: reason; path: reason".
export function formatTopologyViolations(violations) {
  return violations.map((violation) => `${violation.path}: ${violation.reason}`).join('; ');
}

// CI-TOPOLOGY-04 (issue #186) — tracked-suite Git identity validation.
//
// A canonical test suite occupies a tests/**/*.test.mjs slot in the tracked source.
// The gate must reject a canonical CI run unless every such suite is a regular
// non-executable Git blob (mode/type exactly "100644 blob"). A suite-shaped symlink
// (120000), executable blob (100755), non-blob/special entry (e.g. a 160000 gitlink),
// duplicate path, malformed record, or non-suite path would otherwise remain
// suite-shaped by name while redirecting or masking the tracked source identity.
//
// Pure deterministic validator: it takes the machine-readable index records the caller
// derives (each { path, mode, type }) — the caller reads them from `git ls-files -s`,
// never by following the filesystem — and reports a fail-closed [{ path, reason }]
// list. It accepts only unique tests/**/*.test.mjs records whose mode/type is exactly
// "100644 blob" and rejects symlinks, executable blobs, non-blob/special modes,
// duplicate paths, malformed records, and non-suite paths; each diagnostic names the
// offending path/record and reason.
const REGULAR_NON_EXECUTABLE_BLOB_MODE = Object.freeze('100644');
const REGULAR_NON_EXECUTABLE_BLOB_TYPE = Object.freeze('blob');
const SUITE_SLOT_SHAPE = 'tests/**/*.test.mjs';

function suiteIdentityModeReason({ path, mode, type }) {
  if (mode === '120000') {
    return `tracked suite "${path}" is a Git symlink (mode 120000, type ${type}), not a regular non-executable 100644 blob`;
  }
  if (mode === '100755') {
    return `tracked suite "${path}" is an executable Git blob (mode 100755, type ${type}), not a regular non-executable 100644 blob`;
  }
  if (mode === '160000') {
    return `tracked suite "${path}" is a Git gitlink (mode 160000, type ${type}), a non-blob special mode, not a 100644 blob`;
  }
  if (mode === REGULAR_NON_EXECUTABLE_BLOB_MODE && type !== REGULAR_NON_EXECUTABLE_BLOB_TYPE) {
    return `tracked suite "${path}" has mode 100644 but object type ${type} (not a blob), not a regular non-executable 100644 blob`;
  }
  return `tracked suite "${path}" has a non-regular Git mode "${mode}" (type ${type}), a special mode, not a 100644 blob`;
}

// records: the machine-readable tracked index records the caller derives from
//   `git ls-files -s` (each { path, mode, type } for a tests/** entry).
// Returns { ok, suites, violations }:
//   suites — the sorted unique paths that are exactly regular non-executable 100644
//     blobs AND suite-shaped (the bindable tracked suite set);
//   violations — a deterministic fail-closed [{ path, reason }] naming every malformed
//     record, non-suite path, non-100644-blob identity, or duplicate path; empty iff
//     every record is a unique, well-formed tests/**/*.test.mjs 100644 blob.
export function trackedSuiteIdentities(records) {
  const list = Array.isArray(records) ? records : [];
  const violations = [];
  const pathCounts = new Map();
  const suiteSet = new Set();

  list.forEach((record, index) => {
    // Malformed record: not a well-formed { path, mode } object.
    if (record === null || typeof record !== 'object') {
      violations.push({
        path: `<record ${index}>`,
        reason: `malformed tracked-suite record (each entry must be an object with a non-empty string path and a string Git mode): <record ${index}>`,
      });
      return;
    }
    const suitePath = record.path;
    const hasPath = typeof suitePath === 'string' && suitePath !== '';
    if (!hasPath || typeof record.mode !== 'string' || record.mode === '') {
      const label = hasPath ? `"${suitePath}"` : `<record ${index}>`;
      violations.push({
        path: hasPath ? suitePath : `<record ${index}>`,
        reason: `malformed tracked-suite record (each entry must be an object with a non-empty string path and a string Git mode): ${label}`,
      });
      return;
    }

    pathCounts.set(suitePath, (pathCounts.get(suitePath) ?? 0) + 1);

    // A tracked index record outside the tests/**/*.test.mjs suite shape is not a
    // canonical suite and must not occupy a suite slot.
    if (!SUITE.test(suitePath)) {
      violations.push({
        path: suitePath,
        reason: `tracked index record is outside the ${SUITE_SLOT_SHAPE} suite shape: "${suitePath}"`,
      });
    }

    if (record.mode === REGULAR_NON_EXECUTABLE_BLOB_MODE && record.type === REGULAR_NON_EXECUTABLE_BLOB_TYPE) {
      if (SUITE.test(suitePath)) suiteSet.add(suitePath);
    } else {
      violations.push({ path: suitePath, reason: suiteIdentityModeReason(record) });
    }
  });

  for (const [suitePath, count] of [...pathCounts.entries()].sort()) {
    if (count > 1) {
      violations.push({
        path: suitePath,
        reason: `duplicate tracked index record for "${suitePath}" appears ${count} times where a single regular non-executable 100644 blob identity is required`,
      });
    }
  }

  violations.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0));
  return { ok: violations.length === 0, suites: [...suiteSet].sort(), violations };
}

// One-line diagnostics for tracked-suite identity failures: "path: reason; path: reason".
export function formatSuiteIdentityViolations(violations) {
  return violations.map((violation) => `${violation.path}: ${violation.reason}`).join('; ');
}