// Focused, dependency-free verification for the epic #35 closure fixtures
// (contract version epic-35-closure/v1).
//
// This test materializes and verifies the sanitized closure fixtures under
// fixtures/evidence/progressive-analysis/:
//
//   - epic-35-closure-valid.json             the canonical five-child record
//   - epic-35-closure-missing-foundation.json  the valid record minus the
//                                              #40 foundation block, with the
//                                              terminal hash recomputed
//   - epic-35-closure-forged-receipt.json    the valid record with the first
//                                              hex digit of the receipt digest
//                                              flipped
//
// The contract validator (supported-keyword shape walk, content probes,
// rules R01-R07 in the fixed first-failure-wins order) is ported verbatim
// from the reference validator tests/epic-35-closure-schema.test.mjs: same
// codes, same order, same regexes. On top of it this test layers one
// fixture-file-level policy, E-SCOPE, which rejects a materialized fixture
// whose recorded scope (base_sha/head_sha) has drifted from the exact
// current-main integration scope (a stale scope/base SHA). E-SCOPE is fixture
// policy, not a contract rule: the record-level validator is unchanged.
//
// File-level validation order (first failure wins): E-SHAPE (shape, or a
// parse failure) -> E-SCOPE (pinned exact integration scope) -> content value
// probes (E-CONTENT-CREDENTIAL / E-CONTENT-SQL / E-CONTENT-RAW) -> R01-R07.
//
// The tests prove byte stability (repeated loading and canonical
// serialization are byte-identical; the terminal hash input is stable), the
// per-child positive evidence (exact-head/exact-main CI pair, explicit
// release decision, public readback anchors), the named fail-closed
// negatives, and the slice receipt. Node builtins only.

import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const SCHEMA_PATH = 'docs/evidence/progressive-analysis/epic-35-closure.schema.json';
const CONTRACT_PATH = 'docs/evidence/progressive-analysis/epic-35-closure-contract.md';
const VALID_PATH = 'fixtures/evidence/progressive-analysis/epic-35-closure-valid.json';
const MISSING_PATH = 'fixtures/evidence/progressive-analysis/epic-35-closure-missing-foundation.json';
const FORGED_PATH = 'fixtures/evidence/progressive-analysis/epic-35-closure-forged-receipt.json';
const TEST_PATH = 'tests/epic-35-closure-fixture.test.mjs';
const ALLOWED_PATHS = [
  'docs/evidence/conveyor/sol-ks-35-state-reconcile-01.json',
  'docs/evidence/conveyor/terra-ks-35-root-qs-01.json',
  'docs/evidence/progressive-analysis/epic-35-close-comment.template.md',
  'docs/evidence/progressive-analysis/epic-35-closure-contract.md',
  'docs/evidence/progressive-analysis/epic-35-closure.schema.json',
  'docs/evidence/progressive-analysis/epic-35-delivery-packet.template.json',
  'fixtures/evidence/progressive-analysis/epic-35-closure-forged-receipt.json',
  'fixtures/evidence/progressive-analysis/epic-35-closure-missing-foundation.json',
  'fixtures/evidence/progressive-analysis/epic-35-closure-valid.json',
  'fixtures/evidence/progressive-analysis/epic-35-exact-ci-mismatch.json',
  'fixtures/evidence/progressive-analysis/epic-35-exact-ci-valid.json',
  'fixtures/evidence/progressive-analysis/epic-35-no-release-valid.json',
  'fixtures/evidence/progressive-analysis/epic-35-release-readback-valid.json',
  'scripts/prepare-progressive-analysis-release-readback.mjs',
  'scripts/verify-progressive-analysis-closure.mjs',
  'scripts/verify-progressive-analysis-exact-ci.mjs',
  'tests/epic-35-closure-fixture.test.mjs',
  'tests/epic-35-closure-schema.test.mjs',
  'tests/epic-35-delivery-packet.test.mjs',
  'tests/prepare-progressive-analysis-release-readback.test.mjs',
  'tests/verify-progressive-analysis-closure.test.mjs',
  'tests/verify-progressive-analysis-exact-ci.test.mjs',
].sort();

// Pinned hashes. EXPECTED_TERMINAL_HASH is the terminal hash of the valid
// fixture and equals the evidence_terminal_hash recorded by the contract
// slice receipt. The other two are pinned by derivation (see the
// materialized-negative-fixture test below).
const EXPECTED_TERMINAL_HASH = 'bf303ff740bc91f8d05603db2556a60eb83c3d76371b6bade1018787eca28724';
const MISSING_FOUNDATION_HASH = 'f5b5e745e3daa3bd79dfaf3086e1c6084841a0427c66b03a45f7221d73f7b321';
const FORGED_RECEIPT_HASH = '0f303ff740bc91f8d05603db2556a60eb83c3d76371b6bade1018787eca28724';

// The fixtures are pinned to requested local main through the independently
// read current origin/main integration head.
const FIXTURE_BASE_SHA = '173e2f7e19049a705bcdaf0269c33a5bd7f70206';
const FIXTURE_HEAD_SHA = 'd6b9adb5be1e475cdba71c548a71fc900aa3fdff';

// ---------------------------------------------------------------------------
// Canonical serialization and terminal hash input
//
// canonical(x): compact JSON, object keys recursively sorted in code-unit
// lexicographic order, no whitespace. The terminal hash input is the
// canonical serialization of the record with the terminal_hash member
// removed; terminal_hash is the lowercase hex SHA-256 of its UTF-8 bytes.
// (Ported verbatim from the reference validator.)
// ---------------------------------------------------------------------------

function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}

function deepEqual(a, b) {
  return canonicalize(a) === canonicalize(b);
}

function sha256Hex(input) {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function terminalHashInput(record) {
  const {terminal_hash: _removed, ...rest} = record;
  return canonicalize(rest);
}

function terminalHash(record) {
  const {terminal_hash: _removed, ...rest} = record;
  return sha256Hex(canonicalize(rest));
}

// ---------------------------------------------------------------------------
// Probes (fixed order on every string value: credential-like, free SQL,
// raw-value marker) and the content key probe (applied to every object key
// during the shape walk).
// ---------------------------------------------------------------------------

const FORBIDDEN_KEY =
  /raw|source_row|row_material|cell_value|business_row|password|passwd|secret|token|api[_-]?key|access[_-]?key|credential|private[_-]?key|sql/i;
const CREDENTIAL_VALUE =
  /\b(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|credential|credentials|private[_-]?key)\b\s*[:=]/i;
const SQL_VALUE =
  /\b(?:select|insert|update|delete|drop|truncate|alter|create|execute|exec|merge|grant|revoke)\b\s+\S/i;
const RAW_VALUE_MARKER = /RAW_VALUE:/i;

// ---------------------------------------------------------------------------
// Shape validation over the supported-keyword subset of JSON Schema 2020-12.
// Any other validation keyword is rejected (the focused validator fails
// closed on the subset).
// ---------------------------------------------------------------------------

const METADATA_KEYWORDS = new Set(['$schema', '$id', 'title', 'description']);
const SUPPORTED_KEYWORDS = new Set([
  'type',
  'enum',
  'const',
  'required',
  'properties',
  'additionalProperties',
  'items',
  'minItems',
  'maxItems',
  'uniqueItems',
  'pattern',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
]);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function typeName(value) {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'integer' : 'number';
  }
  return typeof value;
}

function typeMatches(type, value) {
  switch (type) {
    case 'null':
      return value === null;
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isPlainObject(value);
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return Number.isInteger(value);
    case 'number':
      return typeof value === 'number';
    case 'boolean':
      return typeof value === 'boolean';
    default:
      throw new Error(`unsupported schema type: ${type}`);
  }
}

function shapeError(path, detail) {
  return {ok: false, code: 'E-SHAPE', path, detail};
}

function resolveRef(ref, rootSchema) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) {
    throw new Error(`unsupported $ref: ${ref}`);
  }
  const segments = ref
    .slice(2)
    .split('/')
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
  let node = rootSchema;
  for (const segment of segments) {
    if (node === null || typeof node !== 'object' || !Object.hasOwn(node, segment)) {
      throw new Error(`unresolvable $ref: ${ref}`);
    }
    node = node[segment];
  }
  return node;
}

function validateShape(value, schema, path, rootSchema) {
  if (Object.hasOwn(schema, '$ref')) {
    for (const key of Object.keys(schema)) {
      if (key === '$ref' || METADATA_KEYWORDS.has(key)) {
        continue;
      }
      throw new Error(`unsupported sibling keyword next to $ref at ${path}: ${key}`);
    }
    return validateShape(value, resolveRef(schema.$ref, rootSchema), path, rootSchema);
  }
  for (const key of Object.keys(schema)) {
    if (METADATA_KEYWORDS.has(key) || key === '$defs') {
      continue;
    }
    if (!SUPPORTED_KEYWORDS.has(key)) {
      throw new Error(`unsupported schema keyword at ${path}: ${key}`);
    }
  }
  if (Object.hasOwn(schema, 'type')) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => typeMatches(type, value))) {
      return shapeError(path, `expected type ${types.join(' | ')} but got ${typeName(value)}`);
    }
  }
  if (Object.hasOwn(schema, 'enum') && !schema.enum.some((item) => deepEqual(item, value))) {
    return shapeError(path, `value is not one of the allowed enum values`);
  }
  if (Object.hasOwn(schema, 'const') && !deepEqual(schema.const, value)) {
    return shapeError(path, `value does not match the required const`);
  }
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      return shapeError(path, `string is shorter than minLength ${schema.minLength}`);
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      return shapeError(path, `string is longer than maxLength ${schema.maxLength}`);
    }
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) {
      return shapeError(path, `string does not match the required pattern`);
    }
  }
  if (typeof value === 'number' && Number.isInteger(value)) {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      return shapeError(path, `value is below minimum ${schema.minimum}`);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      return shapeError(path, `value is above maximum ${schema.maximum}`);
    }
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      return shapeError(path, `array has fewer than minItems ${schema.minItems}`);
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      return shapeError(path, `array has more than maxItems ${schema.maxItems}`);
    }
    if (schema.uniqueItems === true) {
      const seen = new Set();
      for (const item of value) {
        const form = canonicalize(item);
        if (seen.has(form)) {
          return shapeError(path, 'array items are not unique');
        }
        seen.add(form);
      }
    }
    if (Object.hasOwn(schema, 'items')) {
      if (!isPlainObject(schema.items)) {
        throw new Error(`unsupported items schema at ${path}`);
      }
      for (let i = 0; i < value.length; i += 1) {
        const failure = validateShape(value[i], schema.items, `${path}[${i}]`, rootSchema);
        if (failure) {
          return failure;
        }
      }
    }
  }
  if (isPlainObject(value)) {
    if (Object.hasOwn(schema, 'additionalProperties') && schema.additionalProperties !== false) {
      throw new Error(`unsupported additionalProperties value at ${path}`);
    }
    const properties = isPlainObject(schema.properties) ? schema.properties : null;
    if (properties === null) {
      return shapeError(path, 'object without declared properties is not supported');
    }
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) {
        return shapeError(path, `missing required property "${key}"`);
      }
    }
    for (const key of Object.keys(value).sort()) {
      if (FORBIDDEN_KEY.test(key)) {
        return {
          ok: false,
          code: 'E-CONTENT-KEY',
          path: `${path}.${key}`,
          detail: `forbidden key name "${key}" (raw-value, credential-like, or free-SQL material)`,
        };
      }
      if (Object.hasOwn(properties, key)) {
        const failure = validateShape(value[key], properties[key], `${path}.${key}`, rootSchema);
        if (failure) {
          return failure;
        }
      } else if (schema.additionalProperties === false) {
        return shapeError(path, `additional property "${key}" is not allowed`);
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Content probes over every string value (object keys already probed during
// the shape walk).
// ---------------------------------------------------------------------------

function contentProbe(value, path) {
  if (typeof value === 'string') {
    if (CREDENTIAL_VALUE.test(value)) {
      return {ok: false, code: 'E-CONTENT-CREDENTIAL', path, detail: 'string contains credential-like material'};
    }
    if (SQL_VALUE.test(value)) {
      return {ok: false, code: 'E-CONTENT-SQL', path, detail: 'string contains free-form SQL statement text'};
    }
    if (RAW_VALUE_MARKER.test(value)) {
      return {ok: false, code: 'E-CONTENT-RAW', path, detail: 'string contains the RAW_VALUE marker'};
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const failure = contentProbe(value[i], `${path}[${i}]`);
      if (failure) {
        return failure;
      }
    }
    return null;
  }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value).sort()) {
      const failure = contentProbe(value[key], `${path}.${key}`);
      if (failure) {
        return failure;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Deterministic rules R01-R07 (fixed order, first failure wins).
// ---------------------------------------------------------------------------

const CRITICAL_PATH = [36, 37, 38, 39, 40];
const EXPECTED_DEPS = {
  36: [],
  37: [36],
  38: [36, 37],
  39: [36, 37, 38],
  40: [36, 37, 38, 39],
};
const FOUNDATION_CHILDREN = [36, 37];

function semanticFailure(rule, path, detail) {
  return {ok: false, code: `E-${rule}`, path, detail};
}

function validateSemantics(record) {
  // R01: children are exactly the set {36, 37, 38, 39, 40}, one each.
  const issues = record.children.map((child) => child.child_issue);
  if (!deepEqual([...issues].sort((a, b) => a - b), CRITICAL_PATH)) {
    return semanticFailure('R01', '$.children', `children must be exactly the issues [36,37,38,39,40] once each; got ${JSON.stringify(issues)}`);
  }
  // R02: depends_on matches the dependency map and the critical path order.
  for (const child of record.children) {
    const expected = EXPECTED_DEPS[child.child_issue];
    if (!deepEqual(child.depends_on, expected)) {
      return semanticFailure(
        'R02',
        `$.children[${child.child_issue}].depends_on`,
        `child ${child.child_issue} must declare depends_on ${JSON.stringify(expected)}; got ${JSON.stringify(child.depends_on)}`
      );
    }
  }
  if (!deepEqual(record.critical_path, CRITICAL_PATH)) {
    return semanticFailure('R02', '$.critical_path', `critical_path must be exactly [36,37,38,39,40] in that order; got ${JSON.stringify(record.critical_path)}`);
  }
  // R03: a merged child requires every dependency to be merged.
  const byIssue = new Map(record.children.map((child) => [child.child_issue, child]));
  for (const child of record.children) {
    if (child.disposition !== 'merged') {
      continue;
    }
    for (const dep of child.depends_on) {
      const parent = byIssue.get(dep);
      if (parent === undefined || parent.disposition !== 'merged') {
        return semanticFailure('R03', `$.children[${child.child_issue}]`, `merged child ${child.child_issue} requires its dependency ${dep} to be merged (no bypass of the controller breadth gate)`);
      }
    }
  }
  // R04: exactly one delivery state per child.
  for (const child of record.children) {
    const issue = child.child_issue;
    if (child.disposition === 'merged') {
      if (child.merged_pr === null) {
        return semanticFailure('R04', `$.children[${issue}].merged_pr`, 'merged child requires the protected merged PR');
      }
      if (child.closed_rationale !== null) {
        return semanticFailure('R04', `$.children[${issue}].closed_rationale`, 'merged child must not carry a closed rationale');
      }
      if (child.merged_pr.head_sha === child.merged_pr.merge_sha) {
        return semanticFailure('R04', `$.children[${issue}].merged_pr`, 'head_sha and merge_sha must be distinct');
      }
    } else {
      if (child.closed_rationale === null) {
        return semanticFailure('R04', `$.children[${issue}].closed_rationale`, 'closed-no-delivery child requires a durable closed rationale');
      }
      if (child.merged_pr !== null) {
        return semanticFailure('R04', `$.children[${issue}].merged_pr`, 'closed-no-delivery child must not carry a merged PR');
      }
    }
  }
  // R05: CI and release decisions per delivery state.
  for (const child of record.children) {
    const issue = child.child_issue;
    if (child.disposition === 'merged') {
      if (child.ci_decision === null) {
        return semanticFailure('R05', `$.children[${issue}].ci_decision`, 'merged child requires the exact-head and exact-main CI decision pair');
      }
      if (child.release_decision === null) {
        return semanticFailure('R05', `$.children[${issue}].release_decision`, 'merged child requires an explicit release decision');
      }
      const decision = child.release_decision;
      if (decision.decision === 'released' && (decision.tag === null || decision.tag_sha === null)) {
        return semanticFailure('R05', `$.children[${issue}].release_decision`, 'released decision requires non-null tag and tag_sha');
      }
      if (decision.decision === 'no_release' && (decision.tag !== null || decision.tag_sha !== null)) {
        return semanticFailure('R05', `$.children[${issue}].release_decision`, 'no_release decision requires null tag and tag_sha');
      }
    } else {
      if (child.ci_decision !== null) {
        return semanticFailure('R05', `$.children[${issue}].ci_decision`, 'closed-no-delivery child requires null ci_decision');
      }
      if (child.release_decision !== null) {
        return semanticFailure('R05', `$.children[${issue}].release_decision`, 'closed-no-delivery child requires null release_decision');
      }
    }
  }
  // R06: child #40 breadth/receipt foundation gates.
  const foundation = record.child_40_foundation;
  if (foundation.breadth_gate.gated_by_child !== 36) {
    return semanticFailure('R06', '$.child_40_foundation.breadth_gate.gated_by_child', 'child 40 breadth gate must be gated by child 36');
  }
  if (!deepEqual(foundation.receipt_foundation.gated_by_children, FOUNDATION_CHILDREN)) {
    return semanticFailure(
      'R06',
      '$.child_40_foundation.receipt_foundation.gated_by_children',
      `child 40 receipt foundation must be gated by exactly [36,37]; got ${JSON.stringify(foundation.receipt_foundation.gated_by_children)}`
    );
  }
  // R07: terminal hash binds the canonical serialization of the record.
  if (record.terminal_hash !== terminalHash(record)) {
    return semanticFailure('R07', '$.terminal_hash', 'terminal_hash does not bind the canonical serialization of the record with terminal_hash removed');
  }
  return null;
}

function validateClosureRecord(record, rootSchema) {
  if (!isPlainObject(record)) {
    return shapeError('$', 'record must be an object');
  }
  const shape = validateShape(record, rootSchema, '$', rootSchema);
  if (shape) {
    return shape;
  }
  const content = contentProbe(record, '$');
  if (content) {
    return content;
  }
  const semantic = validateSemantics(record);
  if (semantic) {
    return semantic;
  }
  return {ok: true, code: 'OK'};
}

// ---------------------------------------------------------------------------
// Fixture-file-level policy: the pinned exact integration scope (E-SCOPE) and the
// file-level pipeline (parse -> shape -> scope -> content -> semantics).
// E-SCOPE is fixture policy layered on the materialized files; the
// record-level contract validator above is unchanged.
// ---------------------------------------------------------------------------

function scopeProbe(record) {
  if (record.base_sha !== FIXTURE_BASE_SHA) {
    return {
      ok: false,
      code: 'E-SCOPE',
      path: '$.base_sha',
      detail: `fixture base_sha ${record.base_sha} is stale relative to the pinned local-main base ${FIXTURE_BASE_SHA}`,
    };
  }
  if (record.head_sha !== FIXTURE_HEAD_SHA) {
    return {
      ok: false,
      code: 'E-SCOPE',
      path: '$.head_sha',
      detail: `fixture head_sha ${record.head_sha} is stale relative to the pinned current-main integration head ${FIXTURE_HEAD_SHA}`,
    };
  }
  return null;
}

function validateFixture(text) {
  let record;
  try {
    record = JSON.parse(text);
  } catch (error) {
    return shapeError('$', `fixture file is not parseable JSON: ${error.message}`);
  }
  if (!isPlainObject(record)) {
    return shapeError('$', 'fixture record must be an object');
  }
  const shape = validateShape(record, schema, '$', schema);
  if (shape) {
    return shape;
  }
  const scope = scopeProbe(record);
  if (scope) {
    return scope;
  }
  const content = contentProbe(record, '$');
  if (content) {
    return content;
  }
  const semantic = validateSemantics(record);
  if (semantic) {
    return semantic;
  }
  return {ok: true, code: 'OK'};
}

// ---------------------------------------------------------------------------
// Load the contract, the schema, and the materialized fixtures.
// ---------------------------------------------------------------------------

const schema = JSON.parse(await readFile(SCHEMA_PATH, 'utf8'));
const contract = await readFile(CONTRACT_PATH, 'utf8');
const validText = await readFile(VALID_PATH, 'utf8');
const missingText = await readFile(MISSING_PATH, 'utf8');
const forgedText = await readFile(FORGED_PATH, 'utf8');
const validRecord = JSON.parse(validText);

const childOf = (record, issue) => record.children.find((c) => c.child_issue === issue);

function mutateValid(mutate) {
  const record = structuredClone(validRecord);
  mutate(record);
  return record;
}

function expectRejection(label, record, code) {
  const result = validateFixture(canonicalize(record));
  assert.equal(result.ok, false, `${label}: expected a rejection`);
  assert.equal(result.code, code, `${label}: expected ${code}, got ${result.code} (${result.detail})`);
}

// ---------------------------------------------------------------------------
// Byte stability: repeated loading and canonical serialization are
// byte-identical for every fixture, and the terminal hash input is stable.
// ---------------------------------------------------------------------------

test('repeated loading and canonical serialization are byte-identical for every fixture', async () => {
  for (const [path, text] of [[VALID_PATH, validText], [MISSING_PATH, missingText], [FORGED_PATH, forgedText]]) {
    const again = await readFile(path, 'utf8');
    assert.equal(again, text, `${path}: repeated loads are byte-identical`);
    const parsed = JSON.parse(text);
    assert.equal(
      canonicalize(parsed) + '\n',
      text,
      `${path}: on-disk bytes are the canonical serialization plus one trailing newline`
    );
  }
});

test('the terminal hash input is stable across repeated derivation of the valid fixture', async () => {
  const [first, second] = [
    JSON.parse(await readFile(VALID_PATH, 'utf8')),
    JSON.parse(await readFile(VALID_PATH, 'utf8')),
  ];
  assert.equal(terminalHashInput(first), terminalHashInput(second));
  assert.equal(terminalHash(first), terminalHash(second));
  assert.equal(terminalHash(first), EXPECTED_TERMINAL_HASH);
});

// ---------------------------------------------------------------------------
// Positive: the valid fixture is canonical, pinned, and carries the
// per-child delivery evidence.
// ---------------------------------------------------------------------------

test('the valid fixture on disk is canonical and its terminal hash is pinned', () => {
  assert.equal(validText, canonicalize(validRecord) + '\n');
  assert.equal(validRecord.terminal_hash, EXPECTED_TERMINAL_HASH);
  assert.equal(terminalHash(validRecord), EXPECTED_TERMINAL_HASH);
  assert.ok(validRecord.nonclaims.some((n) => n.includes('materialized record')));
  assert.ok(validRecord.nonclaims.some((n) => n.includes('current origin/main')));
  assert.ok(validRecord.nonclaims.some((n) => n.includes('5ffad599118cade30ce66264d529259f63d1bc45')));
});

test('the valid fixture validates OK at the record level and the fixture-file level', () => {
  assert.deepEqual(validateClosureRecord(validRecord, schema), {ok: true, code: 'OK'});
  assert.deepEqual(validateFixture(validText), {ok: true, code: 'OK'});
});

test('each child carries its protected delivery, exact-head/exact-main CI, release decision, and public readback', () => {
  for (const issue of [36, 37, 38, 39, 40]) {
    const child = childOf(validRecord, issue);
    assert.ok(child.evidence_refs.length >= 1, `child ${issue}: deterministic evidence refs`);
    assert.equal(child.disposition, `merged`, `child ${issue} is merged`);
    assert.equal(child.merged_pr.base_ref, 'main', `child ${issue}: protected PR against main`);
    assert.equal(child.merged_pr.protected, true, `child ${issue}: protected PR`);
    assert.match(child.merged_pr.head_sha, /^[0-9a-f]{40}$/, `child ${issue}: head SHA`);
    assert.match(child.merged_pr.merge_sha, /^[0-9a-f]{40}$/, `child ${issue}: merge SHA`);
    assert.notEqual(child.merged_pr.head_sha, child.merged_pr.merge_sha, `child ${issue}: distinct head and merge SHA`);
    assert.equal(child.closed_rationale, null, `child ${issue}: rationale must be null when merged`);
    assert.equal(child.ci_decision.exact_head_conclusion, 'success', `child ${issue}: exact-head CI concluded success`);
    assert.equal(child.ci_decision.exact_main_conclusion, 'success', `child ${issue}: exact-main CI concluded success`);
    assert.ok(Number.isInteger(child.ci_decision.exact_head_run_id) && child.ci_decision.exact_head_run_id >= 1, `child ${issue}: exact-head run id`);
    assert.ok(Number.isInteger(child.ci_decision.exact_main_run_id) && child.ci_decision.exact_main_run_id >= 1, `child ${issue}: exact-main run id`);
    assert.equal(child.release_decision.decision, 'released', `child ${issue}: explicit release decision`);
    assert.match(child.release_decision.tag, /^v[0-9]+\.[0-9]+\.[0-9]+$/, `child ${issue}: public release tag readback`);
    assert.match(child.release_decision.tag_sha, /^[0-9a-f]{40}$/, `child ${issue}: public tag anchor SHA readback`);
  }
  const c40 = childOf(validRecord, 40);
  assert.equal(c40.merged_pr.number, 123, 'child 40: protected delivery PR');
  assert.equal(c40.release_decision.tag, 'v0.25.0', 'child 40: public release disposition');
});

test('critical path 36 -> 37 -> 38 -> 39 -> 40 and the #40 breadth/receipt foundation are represented', () => {
  assert.deepEqual(validRecord.critical_path, CRITICAL_PATH);
  const deps = Object.fromEntries(validRecord.children.map((c) => [c.child_issue, c.depends_on]));
  assert.deepEqual(deps, EXPECTED_DEPS);
  assert.equal(validRecord.child_40_foundation.breadth_gate.gated_by_child, 36);
  assert.deepEqual(validRecord.child_40_foundation.receipt_foundation.gated_by_children, FOUNDATION_CHILDREN);
  assert.ok(validRecord.child_40_foundation.breadth_gate.evidence_refs.length >= 1);
  assert.ok(validRecord.child_40_foundation.receipt_foundation.evidence_refs.length >= 1);
});

// ---------------------------------------------------------------------------
// Materialized negative fixtures: exact derivations of the valid record.
// ---------------------------------------------------------------------------

test('the materialized negative fixtures are exact derivations of the valid record', () => {
  // missing-foundation: the valid record minus the #40 foundation block,
  // with the terminal hash recomputed over what remains (the missing block
  // is the single defect; the shape check rejects it as E-SHAPE required).
  const missingBody = structuredClone(validRecord);
  delete missingBody.child_40_foundation;
  const missing = {...missingBody, terminal_hash: terminalHash(missingBody)};
  assert.equal(missing.terminal_hash, MISSING_FOUNDATION_HASH);
  assert.equal(canonicalize(missing) + '\n', missingText);

  // forged-receipt: the valid record with the receipt digest forged by
  // flipping the first hex digit (deterministic rule, 7 -> 0).
  const forged = {
    ...validRecord,
    terminal_hash: validRecord.terminal_hash.replace(/^./, validRecord.terminal_hash[0] === '0' ? '1' : '0'),
  };
  assert.equal(forged.terminal_hash, FORGED_RECEIPT_HASH);
  assert.equal(canonicalize(forged) + '\n', forgedText);
});

// ---------------------------------------------------------------------------
// Fail-closed negatives (each named case rejects the fixture policy at the
// pinned code; first failure wins, so the intended failure is never masked
// by a stale terminal hash)
// ---------------------------------------------------------------------------

test('fail-closed: missing breadth threshold rejects', () => {
  const materialized = validateFixture(missingText);
  assert.equal(materialized.ok, false);
  assert.equal(materialized.code, 'E-SHAPE', `materialized missing-foundation fixture: expected E-SHAPE, got ${materialized.code} (${materialized.detail})`);
  expectRejection('foundation block absent', mutateValid((r) => { delete r.child_40_foundation; }), 'E-SHAPE');
  expectRejection('breadth gate property absent', mutateValid((r) => { delete r.child_40_foundation.breadth_gate; }), 'E-SHAPE');
  expectRejection('wrong foundation gates', mutateValid((r) => { r.child_40_foundation.receipt_foundation.gated_by_children = [37, 38]; }), 'E-R06');
});

test('fail-closed: forged receipt digest rejects', () => {
  const materialized = validateFixture(forgedText);
  assert.equal(materialized.ok, false);
  assert.equal(materialized.code, 'E-R07', `materialized forged-receipt fixture: expected E-R07, got ${materialized.code} (${materialized.detail})`);
  expectRejection(
    'receipt digest first hex digit flipped',
    mutateValid((r) => {
      r.terminal_hash = r.terminal_hash.replace(/^./, r.terminal_hash[0] === '0' ? '1' : '0');
    }),
    'E-R07'
  );
});

test('fail-closed: stale scope/base SHA rejects', () => {
  expectRejection('stale base_sha', mutateValid((r) => { r.base_sha = '34'.repeat(20); }), 'E-SCOPE');
  expectRejection('stale head_sha', mutateValid((r) => { r.head_sha = '3539'.repeat(10); }), 'E-SCOPE');
});

test('fail-closed: raw-value request rejects', () => {
  expectRejection('raw value field', mutateValid((r) => { r.children[0].raw_values = ['35'.repeat(20)]; }), 'E-CONTENT-KEY');
  expectRejection('RAW_VALUE marker in prose', mutateValid((r) => { r.nonclaims.push('RAW_VALUE: alice,42'); }), 'E-CONTENT-RAW');
});

test('fail-closed: credential-like value rejects', () => {
  expectRejection('credential-like field', mutateValid((r) => { r.children[0].api_key = 'fixture-only'; }), 'E-CONTENT-KEY');
  expectRejection('credential-like value', mutateValid((r) => { r.nonclaims.push('connect with password=hunter2'); }), 'E-CONTENT-CREDENTIAL');
});

test('fail-closed: DDL/DML or free-SQL field rejects', () => {
  expectRejection('free SQL field', mutateValid((r) => { r.children[0].free_sql = 'select 1'; }), 'E-CONTENT-KEY');
  expectRejection('DDL statement value', mutateValid((r) => { r.nonclaims.push('note: DROP TABLE customers'); }), 'E-CONTENT-SQL');
  expectRejection('DML statement value', mutateValid((r) => { r.nonclaims.push('note: DELETE FROM accounts'); }), 'E-CONTENT-SQL');
});

test('fail-closed: parity depth bypassing the controller breadth gate rejects', () => {
  expectRejection(
    'merged depth children on top of a non-merged breadth gate',
    mutateValid((r) => {
      const c36 = childOf(r, 36);
      c36.disposition = 'closed_no_delivery';
      c36.merged_pr = null;
      c36.ci_decision = null;
      c36.release_decision = null;
      c36.closed_rationale = {
        evidence_refs: ['docs/evidence/PROGRESSIVE_RUN_CONTROLLER_V1.md'],
        reason_code: 'no-delivery',
      };
    }),
    'E-R03'
  );
});

// ---------------------------------------------------------------------------
// Cross-links: the contract receipt pins exactly this evidence.
// ---------------------------------------------------------------------------

test('the contract receipt pins the valid fixture terminal hash and the live origin/main', () => {
  const git = (args) => execFileSync('git', args, {encoding: 'utf8'}).trim();
  const originInContract = contract.match(/origin_main_sha:\s*`?([0-9a-f]{40})`?/);
  const evidenceInContract = contract.match(/evidence_terminal_hash:\s*`?([0-9a-f]{64})`?/);
  assert.ok(originInContract, 'contract must record origin_main_sha');
  assert.ok(evidenceInContract, 'contract must record evidence_terminal_hash');
  assert.equal(evidenceInContract[1], EXPECTED_TERMINAL_HASH, 'contract evidence_terminal_hash must equal the valid fixture terminal hash');
  assert.equal(evidenceInContract[1], validRecord.terminal_hash, 'valid fixture terminal hash must equal the contract-pinned evidence hash');
  assert.equal(originInContract[1], git(['rev-parse', 'origin/main']), 'contract origin_main_sha must equal the live origin/main');
});

// ---------------------------------------------------------------------------
// Slice receipt: exact changed-path allowlist. Passes both pre-commit (the
// slice is the pending working tree) and post-commit (the slice is the
// unique commit in origin/main..HEAD whose diff names exactly the allowed
// paths).
// ---------------------------------------------------------------------------

test('receipt: the current-main replay changes exactly the canonical closure paths', () => {
  const git = (args) => execFileSync('git', args, {encoding: 'utf8'}).trim();
  const actual = git(['diff', '--name-only', 'origin/main']).split('\n').filter(Boolean).sort();
  const expected = [...ALLOWED_PATHS, 'SOURCE-MAP.json', 'package.json'].sort();
  assert.deepEqual(actual, expected, 'the complete current-main issue diff must contain only closure and canonical registration paths');
});
