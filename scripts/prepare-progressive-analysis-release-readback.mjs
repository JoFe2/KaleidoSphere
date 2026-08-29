#!/usr/bin/env node
// Local-only deterministic release-or-no-release decision and public-readback
// harness for epic #35 (progressive analysis), contract version
// epic-35-release-readback/v1.
//
// Converts a materialized release-readback evidence fixture (the five-child
// merge/release/evidence state plus the explicit epic decision) into either
// a canonical decision receipt (success) or a fail-closed explanation
// (rejection). The harness is reference-only and local-only: it reads the
// fixture file and evaluates the embedded contract shape spec (preflighted
// before any record is accepted), the pinned exact integration scope policy
// (E-SCOPE), the content probes, and rules R01-R08 in the fixed
// first-failure-wins order defined by the contract. The contract shape spec
// is embedded in this file: this slice is self-contained and reads no
// external schema file. It performs no dispatch, no network access, and no
// writes; --dry-run makes that verify-only mode explicit and is echoed in
// the output. Node builtins only.
//
// File-level validation order (first failure wins): E-SHAPE (shape, or a
// parse failure) -> E-SCOPE (pinned exact integration scope) -> content value
// probes (E-CONTENT-CREDENTIAL / E-CONTENT-SQL / E-CONTENT-RAW; the key
// probe E-CONTENT-KEY runs inside the shape walk) -> R01-R08.
//
// The success receipt branches on the explicit epic decision and carries
// the exact base/head lineage:
//   - released: the deterministic public-readback checklist (the exact
//     identifiers of the release block and of every child, sorted by their
//     canonical serialization), the authorized public-release claims, and
//     the release block;
//   - no_release: the deterministic rationale packet (reason code,
//     rationale, evidence refs) with the public release success claims
//     explicitly suppressed, the public readback null, and the release
//     block null.
//
// Output: a single canonical (compact, key-sorted) JSON line plus a
// trailing newline on stdout. Success is the canonical decision receipt:
// the stable terminal hash, the explicit decision, the exact base/head
// lineage, the nonclaims, the five child summaries (the exact recorded
// per-child CI, merge, rationale, release and readback state) sorted by
// child_issue, and the decision-branch payload (the public-readback
// checklist or the rationale packet). Rejection is the fail-closed
// envelope {code, detail, dry_run, ok, path, terminal_hash}. Exit 0 on OK,
// 1 on rejection, 2 on a usage or input I/O failure.
//
// Verification:
//   node --test tests/prepare-progressive-analysis-release-readback.test.mjs
//   node scripts/prepare-progressive-analysis-release-readback.mjs \
//     --fixture fixtures/evidence/progressive-analysis/epic-35-release-readback-valid.json --dry-run
//   git diff --check origin/main...HEAD

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// The exact current-main integration scope: requested local main through the
// independently read origin/main head. Per-child exact CI is separately bound
// to each protected pull-request head and merge commit by R02.
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
// Embedded contract shape spec (contract epic-35-release-readback/v1). This
// slice is self-contained: the spec lives in this file and is preflighted
// with validateSchemaKeywords before any fixture value is evaluated, so an
// unsupported keyword cannot silently become a future validation
// capability.
//
// Every child carries the exact CI pair (head_sha/main_sha bound to its
// protected PR head/merge, distinct positive check ids, success-only conclusions, and
// the coverage/budget/negative receipt identifiers) and exactly one
// delivery state: a protected merged PR with an explicit release decision
// (public readback when released), or a durable closed rationale. The epic
// carries one explicit decision: released requires the release block
// (artifact, tag, tag SHA and the anonymous public readback) with every
// child merged and released; no_release requires the rationale packet
// (reason code, rationale and evidence refs), no release block, and no
// released child.
// ---------------------------------------------------------------------------

export const CONTRACT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://kaleidosphere.local/contracts/epic-35-release-readback/v1',
  title: 'Epic 35 release-or-no-release decision and public-readback evidence',
  description:
    'Self-contained contract for the epic 35 release-or-no-release decision and public-readback evidence record (contract epic-35-release-readback/v1).',
  $defs: {
    sha40: {
      type: 'string',
      pattern: '^[0-9a-f]{40}$',
    },
    receipt_id: {
      type: 'string',
      minLength: 1,
    },
    evidence_refs: {
      type: 'array',
      minItems: 1,
      uniqueItems: true,
      items: { type: 'string', minLength: 1 },
    },
    merged_pr: {
      type: ['null', 'object'],
      required: ['base_ref', 'head_sha', 'merge_sha', 'number', 'protected'],
      additionalProperties: false,
      properties: {
        base_ref: { const: 'main' },
        head_sha: { $ref: '#/$defs/sha40' },
        merge_sha: { $ref: '#/$defs/sha40' },
        number: { type: 'integer', minimum: 1 },
        protected: { type: 'boolean' },
      },
    },
    closed_rationale: {
      type: ['null', 'object'],
      required: ['evidence_refs', 'reason_code'],
      additionalProperties: false,
      properties: {
        reason_code: { type: 'string', minLength: 1, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
        evidence_refs: { $ref: '#/$defs/evidence_refs' },
      },
    },
    release_decision: {
      type: ['null', 'object'],
      required: ['decision', 'public_readback', 'tag', 'tag_sha'],
      additionalProperties: false,
      properties: {
        decision: { enum: ['no_release', 'released'] },
        tag: { type: ['null', 'string'], minLength: 1 },
        tag_sha: { type: ['null', 'string'], pattern: '^[0-9a-f]{40}$' },
        public_readback: { type: ['null', 'string'], minLength: 1 },
      },
    },
    exact_ci: {
      type: 'object',
      required: [
        'budget_receipt',
        'coverage_receipt',
        'exact_head_check_id',
        'exact_head_conclusion',
        'exact_main_check_id',
        'exact_main_conclusion',
        'head_sha',
        'main_sha',
        'negative_receipt',
      ],
      additionalProperties: false,
      properties: {
        head_sha: { $ref: '#/$defs/sha40' },
        main_sha: { $ref: '#/$defs/sha40' },
        exact_head_check_id: { type: 'integer', minimum: 1 },
        exact_main_check_id: { type: 'integer', minimum: 1 },
        exact_head_conclusion: { enum: ['success'] },
        exact_main_conclusion: { enum: ['success'] },
        coverage_receipt: { $ref: '#/$defs/receipt_id' },
        budget_receipt: { $ref: '#/$defs/receipt_id' },
        negative_receipt: { $ref: '#/$defs/receipt_id' },
      },
    },
    child: {
      type: 'object',
      required: [
        'child_issue',
        'closed_rationale',
        'disposition',
        'evidence_refs',
        'exact_ci',
        'merged_pr',
        'release_decision',
      ],
      additionalProperties: false,
      properties: {
        child_issue: { type: 'integer', minimum: 36, maximum: 40 },
        disposition: { enum: ['closed_no_delivery', 'merged'] },
        evidence_refs: { $ref: '#/$defs/evidence_refs' },
        merged_pr: { $ref: '#/$defs/merged_pr' },
        closed_rationale: { $ref: '#/$defs/closed_rationale' },
        release_decision: { $ref: '#/$defs/release_decision' },
        exact_ci: { $ref: '#/$defs/exact_ci' },
      },
    },
    readback: {
      type: 'object',
      required: ['receipt', 'status'],
      additionalProperties: false,
      properties: {
        receipt: { $ref: '#/$defs/receipt_id' },
        status: { enum: ['success'] },
      },
    },
    release_block: {
      type: ['null', 'object'],
      required: ['artifact', 'readback', 'tag', 'tag_sha'],
      additionalProperties: false,
      properties: {
        artifact: { type: 'string', minLength: 1 },
        readback: { $ref: '#/$defs/readback' },
        tag: { type: 'string', minLength: 1 },
        tag_sha: { $ref: '#/$defs/sha40' },
      },
    },
    no_release_block: {
      type: ['null', 'object'],
      required: ['evidence_refs', 'rationale', 'reason_code'],
      additionalProperties: false,
      properties: {
        evidence_refs: { $ref: '#/$defs/evidence_refs' },
        rationale: { type: 'string', minLength: 1 },
        reason_code: { type: 'string', minLength: 1, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
      },
    },
  },
  type: 'object',
  required: ['base_sha', 'children', 'contract_version', 'decision', 'epic_issue', 'head_sha', 'no_release', 'nonclaims', 'release', 'terminal_hash'],
  additionalProperties: false,
  properties: {
    base_sha: { $ref: '#/$defs/sha40' },
    head_sha: { $ref: '#/$defs/sha40' },
    contract_version: { const: 'epic-35-release-readback/v1' },
    decision: { enum: ['no_release', 'released'] },
    epic_issue: { const: 35 },
    no_release: { $ref: '#/$defs/no_release_block' },
    release: { $ref: '#/$defs/release_block' },
    children: {
      type: 'array',
      minItems: 5,
      maxItems: 5,
      items: { $ref: '#/$defs/child' },
    },
    nonclaims: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', minLength: 1 },
    },
    terminal_hash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
  },
};

// ---------------------------------------------------------------------------
// Deterministic rules R01-R08 (fixed order, first failure wins).
// ---------------------------------------------------------------------------

const CRITICAL_PATH = [36, 37, 38, 39, 40];

function semanticFailure(rule, path, detail) {
  return { ok: false, code: `E-${rule}`, path, detail };
}

function validateSemantics(record) {
  // R01: children are exactly the set {36, 37, 38, 39, 40}, one each.
  const issues = record.children.map((child) => child.child_issue);
  if (!deepEqual([...issues].sort((a, b) => a - b), CRITICAL_PATH)) {
    return semanticFailure('R01', '$.children', `children must be exactly the issues [36,37,38,39,40] once each; got ${JSON.stringify(issues)}`);
  }
  // R02: CI lineage exactness. Every delivered child's exact-head CI is bound
  // to that child's protected PR head and its exact-main CI is bound to that
  // child's merge commit. Top-level base/head identify the integration range.
  for (const child of record.children) {
    const issue = child.child_issue;
    const expectedHead = child.merged_pr?.head_sha ?? record.head_sha;
    const expectedMain = child.merged_pr?.merge_sha ?? record.base_sha;
    if (child.exact_ci.head_sha !== expectedHead) {
      return semanticFailure(
        'R02',
        `$.children[${issue}].exact_ci.head_sha`,
        `child ${issue} exact CI head ${child.exact_ci.head_sha} must equal its protected PR head ${expectedHead}`
      );
    }
    if (child.exact_ci.main_sha !== expectedMain) {
      return semanticFailure(
        'R02',
        `$.children[${issue}].exact_ci.main_sha`,
        `child ${issue} exact CI main ${child.exact_ci.main_sha} must equal its protected merge ${expectedMain}`
      );
    }
  }
  // R03: per-child run identity. The exact-head and exact-main runs of one
  // child are distinct runs, so their check ids must differ.
  for (const child of record.children) {
    const issue = child.child_issue;
    if (child.exact_ci.exact_head_check_id === child.exact_ci.exact_main_check_id) {
      return semanticFailure('R03', `$.children[${issue}].exact_ci`, `child ${issue} exact-head and exact-main CI must be distinct runs with distinct check ids`);
    }
  }
  // R04: run identifiers are distinct across the whole child set, so every
  // recorded run is attributable to exactly one child scope.
  const runIds = [];
  for (const child of record.children) {
    runIds.push(child.exact_ci.exact_head_check_id, child.exact_ci.exact_main_check_id);
  }
  if (new Set(runIds).size !== runIds.length) {
    return semanticFailure('R04', '$.children', 'exact CI check ids must be distinct across every child');
  }
  // R05: per child, the coverage, budget and negative receipt identifiers
  // are distinct and retained (the negative probe receipt is not the
  // coverage or budget receipt).
  for (const child of record.children) {
    const issue = child.child_issue;
    const receipts = [child.exact_ci.coverage_receipt, child.exact_ci.budget_receipt, child.exact_ci.negative_receipt];
    if (new Set(receipts).size !== receipts.length) {
      return semanticFailure('R05', `$.children[${issue}].exact_ci`, `child ${issue} coverage, budget and negative receipt identifiers must be distinct`);
    }
  }
  // R06: exactly one delivery state per child, paired with its evidence.
  for (const child of record.children) {
    const issue = child.child_issue;
    if (child.disposition === 'merged') {
      if (child.merged_pr === null) {
        return semanticFailure('R06', `$.children[${issue}].merged_pr`, 'merged child requires the protected merged PR');
      }
      if (child.merged_pr.protected !== true) {
        return semanticFailure('R06', `$.children[${issue}].merged_pr.protected`, 'merged child requires the protected merged PR');
      }
      if (child.merged_pr.head_sha === child.merged_pr.merge_sha) {
        return semanticFailure('R06', `$.children[${issue}].merged_pr`, 'head_sha and merge_sha must be distinct');
      }
      if (child.closed_rationale !== null) {
        return semanticFailure('R06', `$.children[${issue}].closed_rationale`, 'merged child must not carry a closed rationale');
      }
      if (child.release_decision === null) {
        return semanticFailure('R06', `$.children[${issue}].release_decision`, 'merged child requires an explicit release decision');
      }
      const decision = child.release_decision;
      if (decision.decision === 'released' && (decision.tag === null || decision.tag_sha === null || decision.public_readback === null)) {
        return semanticFailure('R06', `$.children[${issue}].release_decision`, 'released decision requires non-null tag, tag_sha and public_readback (public readback when released)');
      }
      if (decision.decision === 'no_release' && (decision.tag !== null || decision.tag_sha !== null || decision.public_readback !== null)) {
        return semanticFailure('R06', `$.children[${issue}].release_decision`, 'no_release decision requires null tag, tag_sha and public_readback');
      }
    } else {
      if (child.merged_pr !== null) {
        return semanticFailure('R06', `$.children[${issue}].merged_pr`, 'closed-no-delivery child must not carry a merged PR');
      }
      if (child.closed_rationale === null) {
        return semanticFailure('R06', `$.children[${issue}].closed_rationale`, 'closed-no-delivery child requires a durable closed rationale');
      }
      if (child.release_decision !== null) {
        return semanticFailure('R06', `$.children[${issue}].release_decision`, 'closed-no-delivery child requires a null release decision');
      }
    }
  }
  // R07: the explicit epic decision is consistent with the recorded state.
  if (record.decision === 'released') {
    if (record.release === null) {
      return semanticFailure('R07', '$.release', 'released epic decision requires the release block (artifact, tag, tag SHA and the anonymous public readback)');
    }
    for (const child of record.children) {
      const issue = child.child_issue;
      if (child.disposition !== 'merged') {
        return semanticFailure('R07', `$.children[${issue}].disposition`, `released epic decision requires every child to be merged; child ${issue} is ${child.disposition}`);
      }
      if (child.release_decision.decision !== 'released') {
        return semanticFailure('R07', `$.children[${issue}].release_decision`, `released epic decision requires every child release decision to be released; child ${issue} is ${child.release_decision.decision}`);
      }
    }
  } else {
    if (record.release !== null) {
      return semanticFailure('R07', '$.release', 'no-release epic decision must not carry a release block');
    }
    if (record.no_release === null) {
      return semanticFailure('R07', '$.no_release', 'no-release epic decision requires the rationale packet (reason code, rationale and evidence refs)');
    }
    for (const child of record.children) {
      const issue = child.child_issue;
      if (child.disposition === 'merged' && child.release_decision.decision === 'released') {
        return semanticFailure('R07', `$.children[${issue}].release_decision`, `no-release epic decision must not carry a released child; child ${issue} is released`);
      }
    }
  }
  // R08: terminal hash binds the canonical serialization of the record.
  if (record.terminal_hash !== terminalHash(record)) {
    return semanticFailure('R08', '$.terminal_hash', 'terminal_hash does not bind the canonical serialization of the record with terminal_hash removed');
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

export function validateFixtureFile(text, schema = CONTRACT_SCHEMA) {
  // Validate the entire local contract before accepting any fixture value.
  // In particular, an unsupported keyword hidden in an unused $defs branch
  // cannot silently become a future validation capability.
  validateSchemaKeywords(schema, '$', schema);
  if (typeof text !== 'string') {
    return shapeError('$', 'fixture input must be UTF-8 text');
  }
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
      if (i >= argv.length || argv[i] === '' || argv[i].startsWith('--')) {
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

// The deterministic public-readback checklist for a released record: the
// exact identifiers of the release block (artifact, tag, tag SHA, anonymous
// readback receipt, terminal hash) and of every child (child tag, tag SHA,
// public readback reference, merge SHA, PR number, exact CI check ids and
// the coverage/budget/negative receipt identifiers), sorted by canonical
// serialization so the checklist is byte-stable for the record.
export function buildChecklist(record) {
  const entries = [
    { child_issue: null, identifier: record.release.artifact, kind: 'artifact' },
    { child_issue: null, identifier: record.release.tag, kind: 'tag' },
    { child_issue: null, identifier: record.release.tag_sha, kind: 'tag-sha' },
    { child_issue: null, identifier: record.release.readback.receipt, kind: 'readback-receipt' },
    { child_issue: null, identifier: record.terminal_hash, kind: 'terminal-hash' },
  ];
  for (const child of [...record.children].sort((a, b) => a.child_issue - b.child_issue)) {
    const issue = child.child_issue;
    entries.push(
      { child_issue: issue, identifier: child.release_decision.tag, kind: 'child-tag' },
      { child_issue: issue, identifier: child.release_decision.tag_sha, kind: 'child-tag-sha' },
      { child_issue: issue, identifier: child.release_decision.public_readback, kind: 'child-public-readback' },
      { child_issue: issue, identifier: child.merged_pr.merge_sha, kind: 'merge-sha' },
      { child_issue: issue, identifier: String(child.merged_pr.number), kind: 'pr-number' },
      { child_issue: issue, identifier: String(child.exact_ci.exact_head_check_id), kind: 'exact-head-check-id' },
      { child_issue: issue, identifier: String(child.exact_ci.exact_main_check_id), kind: 'exact-main-check-id' },
      { child_issue: issue, identifier: child.exact_ci.coverage_receipt, kind: 'coverage-receipt' },
      { child_issue: issue, identifier: child.exact_ci.budget_receipt, kind: 'budget-receipt' },
      { child_issue: issue, identifier: child.exact_ci.negative_receipt, kind: 'negative-receipt' }
    );
  }
  return entries.sort((a, b) => {
    const aForm = canonicalize(a);
    const bForm = canonicalize(b);
    return aForm < bForm ? -1 : aForm > bForm ? 1 : 0;
  });
}

export function buildReceipt(record, dryRun) {
  const released = record.decision === 'released';
  return {
    base_sha: record.base_sha,
    children: [...record.children].sort((a, b) => a.child_issue - b.child_issue),
    code: 'OK',
    contract_version: record.contract_version,
    decision: record.decision,
    dry_run: dryRun,
    epic_issue: record.epic_issue,
    head_sha: record.head_sha,
    nonclaims: record.nonclaims,
    ok: true,
    public_readback: released
      ? {
          checklist: buildChecklist(record),
          receipt: record.release.readback.receipt,
          status: record.release.readback.status,
        }
      : null,
    public_release_claims: released ? 'authorized' : 'suppressed',
    rationale_packet: released
      ? null
      : {
          evidence_refs: record.no_release.evidence_refs,
          reason_code: record.no_release.reason_code,
          rationale: record.no_release.rationale,
        },
    release: released
      ? {
          artifact: record.release.artifact,
          tag: record.release.tag,
          tag_sha: record.release.tag_sha,
        }
      : null,
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
  let result;
  try {
    result = validateFixtureFile(fixtureText);
  } catch {
    // The embedded contract is local input to the validator. If it cannot
    // be evaluated (for example, because an unsupported validation keyword
    // was added to the embedded spec), do not leak a stack trace or produce
    // a false receipt: keep the CLI machine-readable and fail closed as an
    // input/contract error.
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