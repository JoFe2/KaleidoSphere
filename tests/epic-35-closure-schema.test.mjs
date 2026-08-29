// Focused, dependency-free verification for the epic #35 closure-evidence
// contract (contract version epic-35-closure/v1).
//
// This test is the reference validator for
// docs/evidence/progressive-analysis/epic-35-closure.schema.json. It
// implements the supported-keyword schema subset, the content probes, the
// deterministic rules R01-R07 in the fixed first-failure-wins order defined
// by the contract, the canonical serialization and terminal hash input, and
// the slice receipt assertions. Node builtins only.

import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const SCHEMA_PATH = 'docs/evidence/progressive-analysis/epic-35-closure.schema.json';
const CONTRACT_PATH = 'docs/evidence/progressive-analysis/epic-35-closure-contract.md';
const VALID_PATH = 'fixtures/evidence/progressive-analysis/epic-35-closure-valid.json';
const TEST_PATH = 'tests/epic-35-closure-schema.test.mjs';
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

// ---------------------------------------------------------------------------
// Canonical serialization and terminal hash input
//
// canonical(x): compact JSON, object keys recursively sorted in code-unit
// lexicographic order, no whitespace. The terminal hash input is the
// canonical serialization of the record with the terminal_hash member
// removed; terminal_hash is the lowercase hex SHA-256 of its UTF-8 bytes.
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
// Synthetic closed/no-delivery alternative retained only to prove that branch
// of the contract. The primary fixture below is the materialized exact-state
// record loaded from disk.
// ---------------------------------------------------------------------------

function buildClosedNoDeliveryAlternative() {
  const body = {
    base_sha: '35'.repeat(20),
    child_40_foundation: {
      breadth_gate: {
        evidence_refs: ['docs/evidence/PROGRESSIVE_RUN_CONTROLLER_V1.md'],
        gated_by_child: 36,
      },
      receipt_foundation: {
        evidence_refs: ['docs/evidence/PROGRESSIVE_ANALYSIS_V1.md'],
        gated_by_children: [36, 37],
      },
    },
    children: [
      {
        child_issue: 36,
        ci_decision: {
          exact_head_conclusion: 'success',
          exact_head_run_id: 1,
          exact_main_conclusion: 'success',
          exact_main_run_id: 2,
        },
        closed_rationale: null,
        depends_on: [],
        disposition: 'merged',
        evidence_refs: ['docs/evidence/PROGRESSIVE_RUN_CONTROLLER_V1.md'],
        merged_pr: {
          base_ref: 'main',
          head_sha: '36'.repeat(20),
          merge_sha: '3610'.repeat(10),
          number: 1,
          protected: true,
        },
        release_decision: {
          decision: 'released',
          tag: 'v0.12.0',
          tag_sha: '3620'.repeat(10),
        },
      },
      {
        child_issue: 37,
        ci_decision: {
          exact_head_conclusion: 'success',
          exact_head_run_id: 3,
          exact_main_conclusion: 'success',
          exact_main_run_id: 4,
        },
        closed_rationale: null,
        depends_on: [36],
        disposition: 'merged',
        evidence_refs: ['docs/evidence/PROGRESSIVE_ANALYSIS_V1.md'],
        merged_pr: {
          base_ref: 'main',
          head_sha: '37'.repeat(20),
          merge_sha: '3710'.repeat(10),
          number: 2,
          protected: true,
        },
        release_decision: {
          decision: 'released',
          tag: 'v0.13.0',
          tag_sha: '3720'.repeat(10),
        },
      },
      {
        child_issue: 38,
        ci_decision: {
          exact_head_conclusion: 'success',
          exact_head_run_id: 5,
          exact_main_conclusion: 'success',
          exact_main_run_id: 6,
        },
        closed_rationale: null,
        depends_on: [36, 37],
        disposition: 'merged',
        evidence_refs: ['docs/evidence/PROGRESSIVE_ANALYSIS_V1.md'],
        merged_pr: {
          base_ref: 'main',
          head_sha: '38'.repeat(20),
          merge_sha: '3810'.repeat(10),
          number: 3,
          protected: true,
        },
        release_decision: {
          decision: 'released',
          tag: 'v0.14.0',
          tag_sha: '3820'.repeat(10),
        },
      },
      {
        child_issue: 39,
        ci_decision: {
          exact_head_conclusion: 'success',
          exact_head_run_id: 7,
          exact_main_conclusion: 'success',
          exact_main_run_id: 8,
        },
        closed_rationale: null,
        depends_on: [36, 37, 38],
        disposition: 'merged',
        evidence_refs: ['docs/evidence/PROGRESSIVE_ANALYSIS_V1.md'],
        merged_pr: {
          base_ref: 'main',
          head_sha: '39'.repeat(20),
          merge_sha: '3910'.repeat(10),
          number: 4,
          protected: true,
        },
        release_decision: {
          decision: 'released',
          tag: 'v0.17.0',
          tag_sha: '3920'.repeat(10),
        },
      },
      {
        child_issue: 40,
        ci_decision: null,
        closed_rationale: {
          evidence_refs: ['docs/evidence/conveyor/sol-ks-35-state-reconcile-01.json'],
          reason_code: 'child-40-nonterminal',
        },
        depends_on: [36, 37, 38, 39],
        disposition: 'closed_no_delivery',
        evidence_refs: ['docs/evidence/progressive-analysis/epic-35-closure-contract.md'],
        merged_pr: null,
        release_decision: null,
      },
    ],
    contract_version: 'epic-35-closure/v1',
    critical_path: [36, 37, 38, 39, 40],
    epic_issue: 35,
    head_sha: '3540'.repeat(10),
    nonclaims: [
      'All PR numbers, CI run ids, commit SHAs and tag anchor SHAs in this record are fixture placeholders, not live identifiers.',
      'The release tags mirror the public release identifiers recorded for issues 36 through 39; PR and CI identifiers are placeholders.',
      'This record is a closure evidence template for epic 35 and does not claim that epic 35 or any child issue is closed.',
      'Issue 40 remains exactly as recorded by the controller state reconciliation receipt; this contract neither implements, duplicates, accepts nor terminalizes issue 40 work.',
      'The record embeds no source row material, no credentials and no executable query text of any kind.',
      'The terminal hash is bound to the canonical serialization of the record with the terminal_hash field removed.',
    ],
  };
  return {...body, terminal_hash: terminalHash(body)};
}

// Pinned terminal hash of the materialized fixture. Recompute with:
//   node tests/epic-35-closure-schema.test.mjs --print-terminal-hash
const EXPECTED_TERMINAL_HASH = 'bf303ff740bc91f8d05603db2556a60eb83c3d76371b6bade1018787eca28724';

const fixture = JSON.parse(await readFile(VALID_PATH, 'utf8'));
const closedNoDeliveryAlternative = buildClosedNoDeliveryAlternative();

if (process.argv.includes('--print-terminal-hash')) {
  console.log(terminalHash(fixture));
  process.exit(0);
}

const schema = JSON.parse(await readFile(SCHEMA_PATH, 'utf8'));
const contract = await readFile(CONTRACT_PATH, 'utf8');

const childOf = (record, issue) => record.children.find((c) => c.child_issue === issue);

function mutateRecord(mutate) {
  const record = structuredClone(fixture);
  mutate(record);
  return record;
}

function setClosedNoDelivery(record, issue = 40) {
  const child = childOf(record, issue);
  child.disposition = 'closed_no_delivery';
  child.merged_pr = null;
  child.ci_decision = null;
  child.release_decision = null;
  child.closed_rationale = {
    evidence_refs: ['docs/evidence/conveyor/sol-ks-35-state-reconcile-01.json'],
    reason_code: 'durable-no-delivery',
  };
}

function expectRejection(label, record, code) {
  const result = validateClosureRecord(record, schema);
  assert.equal(result.ok, false, `${label}: expected a rejection`);
  assert.equal(result.code, code, `${label}: expected ${code}, got ${result.code} (${result.detail})`);
}

// ---------------------------------------------------------------------------
// Schema structure
// ---------------------------------------------------------------------------

test('schema is self-describing and uses only the supported keyword subset', () => {
  assert.equal(schema.$id, 'kaleidosphere/epic-35-closure/v1');
  assert.equal(schema.properties.contract_version.const, 'epic-35-closure/v1');
  assert.equal(schema.properties.epic_issue.const, 35);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, [...schema.required].sort());

  const NAME_MAPS = new Set(['properties', '$defs']);
  const walkKeywords = (node) => {
    if (Array.isArray(node)) {
      for (const item of node) {
        walkKeywords(item);
      }
      return;
    }
    if (!isPlainObject(node)) {
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (NAME_MAPS.has(key)) {
        for (const sub of Object.values(value)) {
          walkKeywords(sub);
        }
        continue;
      }
      if (!METADATA_KEYWORDS.has(key) && !SUPPORTED_KEYWORDS.has(key) && key !== '$ref') {
        assert.fail(`unsupported keyword in schema: ${key}`);
      }
      walkKeywords(value);
    }
  };
  walkKeywords(schema);
});

test('schema declares properties in canonical (code-unit lexicographic) order at every level', () => {
  const checkCanonicalOrder = (node, at) => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => checkCanonicalOrder(item, `${at}[${i}]`));
      return;
    }
    if (!isPlainObject(node)) {
      return;
    }
    if (isPlainObject(node.properties)) {
      const keys = Object.keys(node.properties);
      assert.deepEqual(keys, [...keys].sort(), `non-canonical property order at ${at}: ${JSON.stringify(keys)}`);
    }
    for (const [key, value] of Object.entries(node)) {
      checkCanonicalOrder(value, key === 'properties' || key === '$defs' ? at : `${at}.${key}`);
    }
  };
  checkCanonicalOrder(schema, '$');
});

// ---------------------------------------------------------------------------
// Positive: the canonical five-child fixture validates deterministically
// ---------------------------------------------------------------------------

test('canonical five-child fixture validates deterministically', () => {
  assert.deepEqual(validateClosureRecord(fixture, schema), {ok: true, code: 'OK'});
  assert.equal(fixture.terminal_hash, EXPECTED_TERMINAL_HASH);
  assert.equal(terminalHash(fixture), EXPECTED_TERMINAL_HASH);
  assert.deepEqual(validateClosureRecord(closedNoDeliveryAlternative, schema), {ok: true, code: 'OK'}, 'the durable no-delivery alternative remains supported');
});

test('critical path 36 -> 37 -> 38 -> 39 -> 40 and the #40 breadth/receipt foundation are represented', () => {
  assert.deepEqual(fixture.critical_path, CRITICAL_PATH);
  const deps = Object.fromEntries(fixture.children.map((c) => [c.child_issue, c.depends_on]));
  assert.deepEqual(deps, EXPECTED_DEPS);
  assert.equal(fixture.child_40_foundation.breadth_gate.gated_by_child, 36);
  assert.deepEqual(fixture.child_40_foundation.receipt_foundation.gated_by_children, FOUNDATION_CHILDREN);
  for (const child of fixture.children) {
    if (child.disposition === 'merged') {
      assert.ok(child.merged_pr !== null, `child ${child.child_issue}: protected merged PR`);
      assert.equal(child.closed_rationale, null, `child ${child.child_issue}: rationale must be null when merged`);
      assert.ok(child.ci_decision !== null, `child ${child.child_issue}: explicit CI decision pair`);
      assert.ok(child.release_decision !== null, `child ${child.child_issue}: explicit release decision`);
    } else {
      assert.equal(child.merged_pr, null, `child ${child.child_issue}: PR must be null when not delivered`);
      assert.ok(child.closed_rationale !== null, `child ${child.child_issue}: durable closed rationale`);
      assert.equal(child.ci_decision, null, `child ${child.child_issue}: CI decision must be null when not delivered`);
      assert.equal(child.release_decision, null, `child ${child.child_issue}: release decision must be null when not delivered`);
    }
  }
});

test('canonical serialization is stable across a JSON round trip and the nonclaims are declared', () => {
  const roundTrip = JSON.parse(canonicalize(fixture));
  assert.equal(roundTrip.terminal_hash, EXPECTED_TERMINAL_HASH);
  assert.deepEqual(validateClosureRecord(roundTrip, schema), {ok: true, code: 'OK'});
  assert.ok(fixture.nonclaims.length >= 1);
  assert.ok(fixture.nonclaims.some((n) => n.includes('materialized record')));
  assert.ok(fixture.nonclaims.some((n) => n.includes('current origin/main')));
  assert.ok(fixture.nonclaims.some((n) => n.includes('5ffad599118cade30ce66264d529259f63d1bc45')));
});

// ---------------------------------------------------------------------------
// Fail-closed negative categories (each mutation fires before R07, so the
// stale terminal hash never masks the intended failure)
// ---------------------------------------------------------------------------

test('fail-closed: missing child rejects', () => {
  expectRejection('missing child', mutateRecord((r) => { r.children = r.children.slice(0, 4); }), 'E-SHAPE');
});

test('fail-closed: duplicate child rejects', () => {
  expectRejection('duplicate child (sixth entry)', mutateRecord((r) => { r.children.push(structuredClone(r.children[0])); }), 'E-SHAPE');
  expectRejection('repeated issue inside five children', mutateRecord((r) => { r.children[4].child_issue = 36; }), 'E-R01');
});

test('fail-closed: invalid dependency order rejects', () => {
  expectRejection('parity depth bypass edge', mutateRecord((r) => { childOf(r, 38).depends_on = [37]; }), 'E-R02');
  expectRejection('reordered critical path', mutateRecord((r) => { r.critical_path = [36, 37, 39, 38, 40]; }), 'E-R02');
});

test('fail-closed: parity depth over a non-merged controller breadth gate rejects', () => {
  expectRejection(
    'merged depth child on top of a non-merged breadth gate',
    mutateRecord((r) => {
      const c36 = childOf(r, 36);
      c36.disposition = 'closed_no_delivery';
      c36.merged_pr = null;
      c36.ci_decision = null;
      c36.release_decision = {decision: 'no_release', tag: null, tag_sha: null};
      c36.closed_rationale = {
        evidence_refs: ['docs/evidence/PROGRESSIVE_RUN_CONTROLLER_V1.md'],
        reason_code: 'no-delivery',
      };
    }),
    'E-R03'
  );
});

test('fail-closed: missing PR-or-rationale rejects', () => {
  expectRejection('merged child without merged PR', mutateRecord((r) => { childOf(r, 36).merged_pr = null; }), 'E-R04');
  expectRejection(
    'closed-no-delivery child without rationale',
    mutateRecord((r) => {
      setClosedNoDelivery(r);
      childOf(r, 40).closed_rationale = null;
    }),
    'E-R04'
  );
});

test('fail-closed: missing CI or release decision rejects', () => {
  expectRejection('merged child without CI decision pair', mutateRecord((r) => { childOf(r, 37).ci_decision = null; }), 'E-R05');
  expectRejection('merged child without release decision', mutateRecord((r) => { childOf(r, 38).release_decision = null; }), 'E-R05');
  expectRejection('released decision without tag', mutateRecord((r) => { childOf(r, 39).release_decision.tag = null; }), 'E-R05');
  expectRejection(
    'closed-no-delivery child carrying a release decision',
    mutateRecord((r) => {
      setClosedNoDelivery(r);
      childOf(r, 40).release_decision = {decision: 'no_release', tag: null, tag_sha: null};
    }),
    'E-R05'
  );
});

test('fail-closed: missing #40 foundation rejects', () => {
  expectRejection('foundation block absent', mutateRecord((r) => { delete r.child_40_foundation; }), 'E-SHAPE');
  expectRejection('wrong receipt foundation gates', mutateRecord((r) => { r.child_40_foundation.receipt_foundation.gated_by_children = [37, 38]; }), 'E-R06');
});

test('fail-closed: raw value rejects', () => {
  expectRejection('raw value field', mutateRecord((r) => { r.children[0].raw_values = ['35'.repeat(20)]; }), 'E-CONTENT-KEY');
  expectRejection('RAW_VALUE marker in prose', mutateRecord((r) => { r.nonclaims.push('RAW_VALUE: alice,42'); }), 'E-CONTENT-RAW');
});

test('fail-closed: credential-like field or value rejects', () => {
  expectRejection('credential-like field', mutateRecord((r) => { r.children[0].api_key = 'fixture-only'; }), 'E-CONTENT-KEY');
  expectRejection('credential-like value', mutateRecord((r) => { r.nonclaims.push('connect with password=hunter2'); }), 'E-CONTENT-CREDENTIAL');
});

test('fail-closed: free-form SQL field or value rejects', () => {
  expectRejection('free SQL field', mutateRecord((r) => { r.children[0].free_sql = 'select 1'; }), 'E-CONTENT-KEY');
  expectRejection('free SQL value', mutateRecord((r) => { r.nonclaims.push('note: DROP TABLE customers'); }), 'E-CONTENT-SQL');
});

test('fail-closed: terminal hash mismatch rejects', () => {
  expectRejection(
    'terminal hash mismatch',
    mutateRecord((r) => {
      r.terminal_hash = r.terminal_hash.replace(/^./, r.terminal_hash[0] === '0' ? '1' : '0');
    }),
    'E-R07'
  );
});

test('fail-closed: unknown field at any depth rejects', () => {
  expectRejection('unknown top-level field', mutateRecord((r) => { r.notes = 'extra'; }), 'E-SHAPE');
  expectRejection('unknown nested field', mutateRecord((r) => { r.children[0].remark = 'extra'; }), 'E-SHAPE');
});

// ---------------------------------------------------------------------------
// Slice receipt: exact base/head identification and changed-path allowlist.
// Passes both pre-commit (the slice is the pending working tree) and
// post-commit (the slice is the unique commit in origin/main..HEAD whose
// diff names exactly the allowed paths).
// ---------------------------------------------------------------------------

test('receipt: the current-main replay changes exactly the canonical closure paths', () => {
  const git = (args) => execFileSync('git', args, {encoding: 'utf8'}).trim();
  const actual = git(['diff', '--name-only', 'd77ed33d062268a8000ff9b0ef5ca9dc9ad3433b']).split('\n').filter(Boolean).sort();
  const expected = [...ALLOWED_PATHS, 'SOURCE-MAP.json', 'package.json', 'closure-audits/CLOSURE-KS35-ROOT-DELIVERY-01/exact-head-local-gate-receipt.json'].sort();
  assert.deepEqual(actual, expected, 'the complete current-main issue diff must contain only closure and canonical registration paths');
});
