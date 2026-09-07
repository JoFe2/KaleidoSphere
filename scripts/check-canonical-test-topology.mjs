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
// CI-TOPOLOGY-05 (KaleidoSphere issue #188) — pseudo-import route scanner: a canonical
// test suite's route into the test graph may come only from an executable static import
// declaration. A raw-byte regex cannot tell `import` from an import-looking byte inside a
// comment, string, template literal, or regex literal, so it reports a pseudo-route that
// Node would never load. staticTestModuleRoutes below is the pure deterministic lexical
// scanner: it derives the importer's test-to-test edges by a lexical state machine over
// code / line comment / block comment / single-quoted string / double-quoted string /
// template literal / regex literal, emitting an edge only for an executable static
// module declaration whose literal relative specifier resolves to a tracked
// tests/**/*.test.mjs suite; import(...) and import.meta never emit an edge; and
// unterminated lexical input or an ambiguous import-like construct targeting a tracked
// suite fails closed with a diagnostic naming the importer and reason.
//
// CI-TOPOLOGY-06 (KaleidoSphere issue #190) — executable static re-export routes: the
// same pure deterministic lexical scanner is generalized from static import declarations
// to every executable static test-to-test module dependency. It now emits an edge for
// side-effect imports, binding imports, `export * from`, and named `export { ... } from`
// re-export declarations whose literal relative specifier resolves to a tracked suite. A
// local export without a `from` clause (export const/function/class/default, or
// export { ... } without `from`), a bare (non-relative) specifier, and an untracked target
// yield no edge, and re-export-looking bytes inside comments, strings, template literals,
// or regex literals yield no edge; a malformed or ambiguous re-export construct targeting
// a tracked suite fails closed with a diagnostic naming the importer and reason.
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

// CI-TOPOLOGY-05 (issue #188) / CI-TOPOLOGY-06 (issue #190) — static module route
// scanner.
//
// staticTestModuleRoutes derives the executable static test-to-test module routes for
// one importer file by scanning its source with a deterministic lexical state machine
// instead of a raw-byte regex. An edge is produced ONLY by an executable static module
// declaration — a side-effect import, a binding import, `export * from`, or a named
// `export { ... } from` re-export — whose specifier is a literal relative path resolving
// to a tracked tests/**/*.test.mjs suite. Import/re-export-looking bytes inside line
// comments, block comments, single/double-quoted strings, template-literal text, or regex
// literals never create an edge, and a dynamic import(...) or import.meta never creates an
// edge. A local export without a `from` clause (export const/function/class/default, or
// export { ... } without `from`), a bare (non-relative) specifier, and an untracked target
// create no edge. Malformed/unterminated lexical input (an unterminated block comment,
// quoted string, template literal, or regex literal) and an ambiguous import/re-export-
// like construct targeting a tracked test suite (a backtick/template specifier where a
// static module declaration requires a single/double-quoted string) fail closed with a
// diagnostic naming the importer and reason — a route is never silently created or
// dropped.
//
// importer: repo-relative path of the file being scanned (its directory is derived
//   arithmetically, so the scanner never touches fs).
// source: the file's source text.
// trackedSuites: the tracked tests/**/*.test.mjs set (a Set or array of repo-relative
//   paths); only edges whose resolved specifier is in this set are emitted.
// Returns { edges: [{ from, to }], violations: [{ path, reason }] } where `from` is the
//   importer and `to` is the resolved tracked suite; violations each name the importer
//   (path) and the fail-closed reason.
const LEX_WS = Object.freeze(' \t\r\n');
const LEX_WORD = /[A-Za-z0-9_$]/;
// A word that can end in an expression position, so a following '/' opens a regex literal
// rather than a division. When the last significant word is one of these, '/' is a regex.
const REGEX_PRECEDING_WORDS = Object.freeze(
  new Set([
    'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'do',
    'else', 'case', 'yield', 'await', 'throw', 'with', 'async', 'function',
  ]),
);

// Resolve a relative specifier ('./x' or '../x') against the importer's directory, or
// return null for a non-relative (bare) specifier. Segment arithmetic, no node:path.
function resolveRelativeSpecifier(importer, specifier) {
  if (!(specifier.startsWith('./') || specifier.startsWith('../'))) return null;
  const lastSlash = importer.lastIndexOf('/');
  const importerDir = lastSlash === -1 ? '' : importer.slice(0, lastSlash + 1);
  const segments = (importerDir + specifier).split('/');
  const out = [];
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') { out.pop(); continue; }
    out.push(segment);
  }
  return out.join('/');
}

export function staticTestModuleRoutes({ importer, source, trackedSuites }) {
  const edges = [];
  const violations = [];
  const text = typeof source === 'string' ? source : '';
  const trackedSet = trackedSuites instanceof Set
    ? trackedSuites
    : new Set(Array.isArray(trackedSuites) ? trackedSuites : []);

  const CODE = 0;
  const LINE_COMMENT = 1;
  const BLOCK_COMMENT = 2;
  const SINGLE_QUOTED = 3;
  const DOUBLE_QUOTED = 4;
  const TEMPLATE_LITERAL = 5;
  const REGEX_LITERAL = 6;

  let state = CODE;
  let i = 0;
  const n = text.length;
  let lastSig = ''; // last significant (non-whitespace) char seen in CODE state
  let lastWord = ''; // last maximal word read in CODE state (lastSig is its final char)
  let regexInClass = false; // true while the open regex literal is inside a [...] class

  const pushEdge = (specifier) => {
    const resolved = resolveRelativeSpecifier(importer, specifier);
    if (resolved !== null && trackedSet.has(resolved)) edges.push({ from: importer, to: resolved });
  };

  // Read a quoted module specifier that begins at the opening quote (one of ' " `) at
  // index start. Returns { kind: 'ok'|'unterminated'|'ambiguous', specifier, end } where
  // end is just past the closing quote (or n when the string never closes). A backtick
  // specifier is 'ambiguous': it is a template literal, not the single/double-quoted
  // string a static module declaration requires.
  const readQuotedSpecifier = (start) => {
    const quote = text[start];
    if (quote === '`') {
      let e = start + 1;
      let buf = '';
      while (e < n && text[e] !== '`') { buf += text[e]; e += 1; }
      return { kind: 'ambiguous', specifier: buf, end: e < n ? e + 1 : n };
    }
    let e = start + 1;
    let buf = '';
    while (e < n && text[e] !== quote) {
      if (text[e] === '\\') { buf += text[e] + text[e + 1]; e += 2; }
      else { buf += text[e]; e += 1; }
    }
    if (e >= n) return { kind: 'unterminated', quote, end: n };
    return { kind: 'ok', specifier: buf, end: e + 1 };
  };

  // Read the maximal word beginning at index k, or '' when text[k] is not a word char.
  const readWordAt = (k) => {
    if (k >= n || !LEX_WORD.test(text[k])) return '';
    let e = k;
    while (e < n && LEX_WORD.test(text[e])) e += 1;
    return text.slice(k, e);
  };

  // Given that the `from` keyword begins at index k, read the module specifier that
  // follows it (which must be a quoted literal in a static re-export). Returns the
  // readQuotedSpecifier result, or { kind: 'none' } when `from` is not directly followed
  // by a literal specifier.
  const readSpecifierAfterFrom = (k) => {
    let e = k + 4; // 'from'.length
    while (e < n && LEX_WS.includes(text[e])) e += 1;
    if (e >= n) return { kind: 'none', end: n };
    const c = text[e];
    if (c === "'" || c === '"' || c === '`') return readQuotedSpecifier(e);
    return { kind: 'none', end: e };
  };

  // Parse the static import declaration that begins just after the `import` keyword, at
  // index j. Only a strict binding region (identifiers, { } * , whitespace, and the word
  // `from`) may precede the specifier quote — any other character means this is not a
  // static import (dynamic import(...), import.meta, or other syntax), which yields no
  // edge. A backtick specifier is ambiguous: it is a template literal, not the
  // single/double-quoted string a static import requires.
  const parseStaticImport = (j) => {
    let k = j;
    while (k < n) {
      const ch = text[k];
      if (ch === "'" || ch === '"' || ch === '`') return readQuotedSpecifier(k);
      if (ch === ';') return { kind: 'none', end: k + 1 };
      if (LEX_WS.includes(ch) || LEX_WORD.test(ch) || ch === '{' || ch === '}' || ch === '*' || ch === ',') {
        k += 1;
        continue;
      }
      return { kind: 'none', end: k };
    }
    return { kind: 'none', end: k };
  };

  // Parse the static export declaration that begins just after the `export` keyword, at
  // index j. Only a star re-export (`export * from '...'`, `export * as ns from '...'`)
  // or a named re-export (`export { ... } from '...'`) carries a module route: the
  // `from` keyword must directly precede a literal specifier. A local export without a
  // `from` clause (export const/function/class/default, or export { ... } without `from`)
  // yields no edge. A backtick specifier after `from` is ambiguous; an unterminated
  // specifier after `from` fails closed.
  const parseStaticExport = (j) => {
    let k = j;
    while (k < n && LEX_WS.includes(text[k])) k += 1;
    if (k >= n) return { kind: 'none', end: k };
    const ch = text[k];
    if (ch === '*') {
      // Star re-export: `export * from '...'` or `export * as ns from '...'`.
      k += 1;
      while (k < n && LEX_WS.includes(text[k])) k += 1;
      if (readWordAt(k) === 'as') {
        k += 2;
        while (k < n && LEX_WS.includes(text[k])) k += 1;
        if (k < n && LEX_WORD.test(text[k])) {
          let e = k;
          while (e < n && LEX_WORD.test(text[e])) e += 1;
          k = e;
        }
        while (k < n && LEX_WS.includes(text[k])) k += 1;
      }
      if (readWordAt(k) === 'from') return readSpecifierAfterFrom(k);
      return { kind: 'none', end: k };
    }
    if (ch === '{') {
      // Named re-export: `export { ... } from '...'`. Scan the named list to its closing
      // '}', then require the `from` keyword directly before a literal specifier.
      k += 1;
      while (k < n && text[k] !== '}') k += 1;
      if (k < n) k += 1; // just past the closing '}'
      while (k < n && LEX_WS.includes(text[k])) k += 1;
      if (readWordAt(k) === 'from') return readSpecifierAfterFrom(k);
      // Local export `export { ... }` without `from`: no module route.
      return { kind: 'none', end: k };
    }
    // Local export (export const/function/class/default/async ...): no module route.
    return { kind: 'none', end: k };
  };

  while (i < n) {
    const c = text[i];
    const next = i + 1 < n ? text[i + 1] : '';
    if (state === CODE) {
      if (c === '/' && next === '/') { state = LINE_COMMENT; i += 2; continue; }
      if (c === '/' && next === '*') { state = BLOCK_COMMENT; i += 2; continue; }
      if (c === "'") { state = SINGLE_QUOTED; i += 1; continue; }
      if (c === '"') { state = DOUBLE_QUOTED; i += 1; continue; }
      if (c === '`') { state = TEMPLATE_LITERAL; i += 1; continue; }
      if (c === '/') {
        // Regex-vs-division: '/' opens a regex literal unless the preceding significant
        // token can be a division left operand (a non-keyword word, a closing paren/
        // bracket, or a just-closed string).
        const division =
          lastSig === ')' ||
          lastSig === ']' ||
          lastSig === "'" ||
          lastSig === '"' ||
          lastSig === '`' ||
          (LEX_WORD.test(lastSig) && !REGEX_PRECEDING_WORDS.has(lastWord));
        if (!division) { state = REGEX_LITERAL; regexInClass = false; i += 1; continue; }
        lastSig = '/';
        i += 1;
        continue;
      }
      if (LEX_WORD.test(c)) {
        let end = i;
        while (end < n && LEX_WORD.test(text[end])) end += 1;
        const word = text.slice(i, end);
        if (word === 'import') {
          const result = parseStaticImport(end);
          if (result.kind === 'ok') {
            pushEdge(result.specifier);
          } else if (result.kind === 'unterminated') {
            violations.push({
              path: importer,
              reason: `unterminated ${result.quote === "'" ? 'single-quoted' : 'double-quoted'} string in a static import specifier`,
            });
          } else if (result.kind === 'ambiguous') {
            const resolved = resolveRelativeSpecifier(importer, result.specifier);
            if (resolved !== null && trackedSet.has(resolved)) {
              violations.push({
                path: importer,
                reason: `ambiguous import-like construct (template-literal specifier) targeting tracked suite "${resolved}"`,
              });
            }
          }
          // 'none' or a non-tracked target: no edge, no violation.
          lastSig = result.end < n ? text[result.end - 1] : '';
          lastWord = '';
          i = result.end;
          continue;
        }
        if (word === 'export') {
          const result = parseStaticExport(end);
          if (result.kind === 'ok') {
            pushEdge(result.specifier);
          } else if (result.kind === 'unterminated') {
            violations.push({
              path: importer,
              reason: `unterminated ${result.quote === "'" ? 'single-quoted' : 'double-quoted'} string in a static re-export specifier`,
            });
          } else if (result.kind === 'ambiguous') {
            const resolved = resolveRelativeSpecifier(importer, result.specifier);
            if (resolved !== null && trackedSet.has(resolved)) {
              violations.push({
                path: importer,
                reason: `ambiguous re-export-like construct (template-literal specifier) targeting tracked suite "${resolved}"`,
              });
            }
          }
          // 'none' (a local export without `from`) or a non-tracked target: no edge, no
          // violation; the main loop resumes just after the `export` keyword.
          lastSig = result.end < n ? text[result.end - 1] : '';
          lastWord = '';
          i = result.end;
          continue;
        }
        lastWord = word;
        lastSig = word[word.length - 1];
        i = end;
        continue;
      }
      if (!LEX_WS.includes(c)) lastSig = c;
      lastWord = '';
      i += 1;
      continue;
    }
    if (state === LINE_COMMENT) {
      if (c === '\n') { state = CODE; lastWord = ''; }
      i += 1;
      continue;
    }
    if (state === BLOCK_COMMENT) {
      if (c === '*' && next === '/') { state = CODE; i += 2; continue; }
      i += 1;
      continue;
    }
    if (state === SINGLE_QUOTED || state === DOUBLE_QUOTED) {
      const quote = state === SINGLE_QUOTED ? "'" : '"';
      if (c === '\\') { i += 2; continue; }
      if (c === quote) state = CODE;
      i += 1;
      continue;
    }
    if (state === TEMPLATE_LITERAL) {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') state = CODE;
      i += 1;
      continue;
    }
    if (state === REGEX_LITERAL) {
      if (c === '\\') { i += 2; continue; }
      if (c === '[') { regexInClass = true; i += 1; continue; }
      if (c === ']' && regexInClass) { regexInClass = false; i += 1; continue; }
      if (c === '/' && !regexInClass) { state = CODE; i += 1; continue; }
      i += 1;
      continue;
    }
  }

  // Fail closed on any lexical construct still open at end of input: a comment, quoted
  // string, template literal, or regex literal that never terminates is malformed input
  // that must not silently create or drop a route.
  if (state === BLOCK_COMMENT) {
    violations.push({ path: importer, reason: 'unterminated block comment' });
  } else if (state === SINGLE_QUOTED) {
    violations.push({ path: importer, reason: 'unterminated single-quoted string' });
  } else if (state === DOUBLE_QUOTED) {
    violations.push({ path: importer, reason: 'unterminated double-quoted string' });
  } else if (state === TEMPLATE_LITERAL) {
    violations.push({ path: importer, reason: 'unterminated template literal' });
  } else if (state === REGEX_LITERAL) {
    violations.push({ path: importer, reason: 'unterminated regex literal' });
  }

  return { edges, violations };
}

// One-line diagnostics for static import-route failures: "importer: reason; importer: reason".
export function formatImportRouteViolations(violations) {
  return violations.map((violation) => `${violation.path}: ${violation.reason}`).join('; ');
}