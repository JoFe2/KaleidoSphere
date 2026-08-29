#!/usr/bin/env node
// Local-only deterministic closure validator for epic #35 (progressive
// analysis), contract version epic-35-closure/v1.
//
// Converts a materialized closure-evidence fixture (the child evidence
// input) into either a canonical closure receipt (success) or a
// fail-closed explanation (rejection). The validator is reference-only and
// local-only: it reads the fixture file and the pinned contract schema,
// and evaluates the supported-keyword shape walk, the pinned exact
// scope policy (E-SCOPE), the content probes, and rules R01-R07 in the
// fixed first-failure-wins order defined by the contract. It performs no
// dispatch, no network access, and no writes; --dry-run makes that
// verify-only mode explicit and is echoed in the output. Node builtins
// only.
//
// File-level validation order (first failure wins): E-SHAPE (shape, or a
// parse failure) -> E-SCOPE (pinned exact integration scope) -> content value
// probes (E-CONTENT-CREDENTIAL / E-CONTENT-SQL / E-CONTENT-RAW) -> R01-R07.
// E-SCOPE is the fixture-file-level policy layered on the record-level
// contract validator, which is unchanged.
//
// Output: a single canonical (compact, key-sorted) JSON line plus a
// trailing newline on stdout. Success is the canonical closure receipt:
// the stable terminal hash, the lineage (base_sha/head_sha), the critical
// path, the #40 foundation, the nonclaims, and the five child summaries
// (the exact recorded per-child merge/release/evidence state) sorted by
// child_issue. Rejection is the fail-closed envelope {code, detail,
// dry_run, ok, path, terminal_hash}. Exit 0 on OK, 1 on rejection, 2 on a
// usage or input I/O failure.
//
// Verification:
//   node --test tests/verify-progressive-analysis-closure.test.mjs
//   node scripts/verify-progressive-analysis-closure.mjs \
//     --fixture fixtures/evidence/progressive-analysis/epic-35-closure-valid.json --dry-run
//   git diff --check origin/main...HEAD

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const SCHEMA_PATH = path.join(root, 'docs/evidence/progressive-analysis/epic-35-closure.schema.json');

// The exact current-main integration range. The base is the requested local
// main identity at slice cut; the head is the independently read current
// origin/main integration head. A materialized fixture whose recorded scope
// has drifted from either immutable identity fails E-SCOPE.
const PINNED_BASE_SHA = '173e2f7e19049a705bcdaf0269c33a5bd7f70206';
const PINNED_HEAD_SHA = 'd6b9adb5be1e475cdba71c548a71fc900aa3fdff';

// ---------------------------------------------------------------------------
// Canonical serialization and terminal hash input
//
// canonical(x): compact JSON, object keys recursively sorted in code-unit
// lexicographic order, no whitespace. The terminal hash input is the
// canonical serialization of the record with the terminal_hash member
// removed; terminal_hash is the lowercase hex SHA-256 of its UTF-8 bytes.
// (Ported verbatim from the reference validator.)
// ---------------------------------------------------------------------------

export function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}

export function deepEqual(a, b) {
  return canonicalize(a) === canonicalize(b);
}

export function sha256Hex(input) {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function terminalHashInput(record) {
  const { terminal_hash: _removed, ...rest } = record;
  return canonicalize(rest);
}

export function terminalHash(record) {
  const { terminal_hash: _removed, ...rest } = record;
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
const SUPPORTED_SCHEMA_TYPES = new Set([
  'null',
  'array',
  'object',
  'string',
  'integer',
  'number',
  'boolean',
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
  return { ok: false, code: 'E-SHAPE', path, detail };
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

function validateSchemaKeywords(schema, path, rootSchema = schema) {
  if (!isPlainObject(schema)) {
    throw new Error(`unsupported schema node at ${path}`);
  }
  if (Object.hasOwn(schema, '$ref')) {
    for (const key of Object.keys(schema)) {
      if (key === '$ref' || METADATA_KEYWORDS.has(key)) {
        continue;
      }
      throw new Error(`unsupported sibling keyword next to $ref at ${path}: ${key}`);
    }
    const target = resolveRef(schema.$ref, rootSchema);
    if (!isPlainObject(target)) {
      throw new Error(`unsupported $ref target at ${path}: ${schema.$ref}`);
    }
    return;
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
    if (types.length === 0) {
      throw new Error(`unsupported empty schema type declaration at ${path}`);
    }
    for (const type of types) {
      if (!SUPPORTED_SCHEMA_TYPES.has(type)) {
        throw new Error(`unsupported schema type at ${path}: ${String(type)}`);
      }
    }
  }
  if (Object.hasOwn(schema, 'additionalProperties') && schema.additionalProperties !== false) {
    throw new Error(`unsupported additionalProperties value at ${path}`);
  }
  for (const containerKey of ['$defs', 'properties']) {
    if (!Object.hasOwn(schema, containerKey)) {
      continue;
    }
    const definitions = schema[containerKey];
    if (!isPlainObject(definitions)) {
      throw new Error(`unsupported ${containerKey} container at ${path}`);
    }
    for (const key of Object.keys(definitions)) {
      validateSchemaKeywords(definitions[key], `${path}.${key}`, rootSchema);
    }
  }
  if (Object.hasOwn(schema, 'items')) {
    validateSchemaKeywords(schema.items, `${path}.items`, rootSchema);
  }
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
      return { ok: false, code: 'E-CONTENT-CREDENTIAL', path, detail: 'string contains credential-like material' };
    }
    if (SQL_VALUE.test(value)) {
      return { ok: false, code: 'E-CONTENT-SQL', path, detail: 'string contains free-form SQL statement text' };
    }
    if (RAW_VALUE_MARKER.test(value)) {
      return { ok: false, code: 'E-CONTENT-RAW', path, detail: 'string contains the RAW_VALUE marker' };
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
  return { ok: false, code: `E-${rule}`, path, detail };
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

// ---------------------------------------------------------------------------
// Fixture-file-level policy: the pinned exact integration scope (E-SCOPE) and the
// file-level pipeline (parse -> shape -> scope -> content -> semantics).
// E-SCOPE is fixture policy layered on the materialized files; the
// record-level contract validator above is unchanged.
// ---------------------------------------------------------------------------

function scopeProbe(record) {
  if (record.base_sha !== PINNED_BASE_SHA) {
    return {
      ok: false,
      code: 'E-SCOPE',
      path: '$.base_sha',
      detail: `fixture base_sha ${record.base_sha} is stale relative to the pinned local-main base ${PINNED_BASE_SHA}`,
    };
  }
  if (record.head_sha !== PINNED_HEAD_SHA) {
    return {
      ok: false,
      code: 'E-SCOPE',
      path: '$.head_sha',
      detail: `fixture head_sha ${record.head_sha} is stale relative to the pinned current-main integration head ${PINNED_HEAD_SHA}`,
    };
  }
  return null;
}

export function validateFixtureFile(text, schema) {
  // Validate the entire local contract before accepting any fixture value.
  // In particular, an unsupported keyword hidden in an unused $defs branch
  // cannot silently become a future validation capability.
  validateSchemaKeywords(schema, '$', schema);
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
  return { ok: true, code: 'OK' };
}

// ---------------------------------------------------------------------------
// CLI: flag parsing, receipt construction, and the run entry point.
// ---------------------------------------------------------------------------

export function parseFlags(argv) {
  let fixture = null;
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--fixture') {
      i += 1;
      if (i >= argv.length || argv[i] === '') {
        return { error: '--fixture requires a path argument' };
      }
      fixture = argv[i];
    } else if (arg.startsWith('--fixture=')) {
      fixture = arg.slice('--fixture='.length);
      if (fixture === '') {
        return { error: '--fixture requires a path argument' };
      }
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else {
      return { error: `unknown argument: ${arg}` };
    }
  }
  if (fixture === null) {
    return { error: 'missing required --fixture <path>' };
  }
  return { fixture, dryRun };
}

export function buildReceipt(record, dryRun) {
  return {
    base_sha: record.base_sha,
    child_40_foundation: record.child_40_foundation,
    children: [...record.children].sort((a, b) => a.child_issue - b.child_issue),
    code: 'OK',
    contract_version: record.contract_version,
    critical_path: record.critical_path,
    dry_run: dryRun,
    epic_issue: record.epic_issue,
    head_sha: record.head_sha,
    nonclaims: record.nonclaims,
    ok: true,
    terminal_hash: record.terminal_hash,
  };
}

function declaredTerminalHash(text) {
  try {
    const record = JSON.parse(text);
    return isPlainObject(record) && typeof record.terminal_hash === 'string' ? record.terminal_hash : null;
  } catch {
    return null;
  }
}

function cliFailure(detail, dryRun) {
  return (
    canonicalize({
      code: 'E-CLI',
      detail,
      dry_run: dryRun,
      ok: false,
      path: null,
      terminal_hash: null,
    }) + '\n'
  );
}

export async function run(argv) {
  const flags = parseFlags(argv);
  if (flags.error) {
    return { exit: 2, text: cliFailure(flags.error, false) };
  }
  let fixtureText;
  try {
    fixtureText = await readFile(flags.fixture, 'utf8');
  } catch {
    return { exit: 2, text: cliFailure('fixture file could not be read', flags.dryRun) };
  }
  let schema;
  try {
    schema = JSON.parse(await readFile(SCHEMA_PATH, 'utf8'));
  } catch {
    return { exit: 2, text: cliFailure('contract schema could not be read or parsed', flags.dryRun) };
  }
  let result;
  try {
    result = validateFixtureFile(fixtureText, schema);
  } catch {
    // The contract schema is local input to the validator. If it cannot be
    // evaluated (for example, because a future validation keyword was added),
    // do not leak a stack trace or produce a false receipt: keep the CLI
    // machine-readable and fail closed as an input/contract error.
    return { exit: 2, text: cliFailure('contract schema could not be evaluated', flags.dryRun) };
  }
  if (result.ok) {
    const record = JSON.parse(fixtureText);
    return { exit: 0, text: canonicalize(buildReceipt(record, flags.dryRun)) + '\n' };
  }
  return {
    exit: 1,
    text:
      canonicalize({
        code: result.code,
        detail: result.detail,
        dry_run: flags.dryRun,
        ok: false,
        path: result.path,
        terminal_hash: declaredTerminalHash(fixtureText),
      }) + '\n',
  };
}

const isMain =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
  const { exit, text } = await run(process.argv.slice(2));
  process.stdout.write(text);
  process.exitCode = exit;
}