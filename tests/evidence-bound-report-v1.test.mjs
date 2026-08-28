import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {isDeepStrictEqual} from 'node:util';

import {identitySha256} from '../services/bi-control/src/db-analyzer/core.mjs';
import {
  EVIDENCE_BOUND_REPORT_DATASET_SCHEMA_V1,
  EVIDENCE_BOUND_REPORT_SPEC_SCHEMA_V1,
  buildEvidenceBoundReportV1,
  validateEvidenceBoundReportV1,
  verifyEvidenceBoundReportV1,
  verifyEvidenceBoundReportReplayV1,
} from '../services/bi-control/src/reporting/evidence-bound-report-v1.mjs';

const H = (character) => character.repeat(64);
const BINDINGS = Object.freeze({
  snapshotSha256: H('1'),
  receiptSha256: H('2'),
  coverageSha256: H('3'),
  capabilitySha256: H('4'),
  resultSha256: H('5'),
});

function resolveRef(root, ref) {
  assert.match(ref, /^#\//);
  return ref.slice(2).split('/').reduce((value, token) => value[token.replaceAll('~1', '/').replaceAll('~0', '~')], root);
}

function schemaAccepts(root, schema, value) {
  if (typeof schema === 'boolean') return schema;
  if (schema.$ref && !schemaAccepts(root, resolveRef(root, schema.$ref), value)) return false;
  if (Object.hasOwn(schema, 'const') && !isDeepStrictEqual(schema.const, value)
    && !(typeof schema.const === 'number' && typeof value === 'number' && schema.const === value)) return false;
  if (schema.enum && !schema.enum.some((item) => isDeepStrictEqual(item, value))) return false;
  if (schema.allOf && !schema.allOf.every((item) => schemaAccepts(root, item, value))) return false;
  if (schema.anyOf && !schema.anyOf.some((item) => schemaAccepts(root, item, value))) return false;
  if (schema.oneOf && schema.oneOf.filter((item) => schemaAccepts(root, item, value)).length !== 1) return false;
  if (schema.not && schemaAccepts(root, schema.not, value)) return false;
  if (schema.if) {
    const branch = schemaAccepts(root, schema.if, value) ? schema.then : schema.else;
    if (branch && !schemaAccepts(root, branch, value)) return false;
  }
  if (schema.type) {
    const matches = schema.type === 'null' ? value === null
      : schema.type === 'array' ? Array.isArray(value)
        : schema.type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
          : schema.type === 'integer' ? typeof value === 'number' && Number.isInteger(value)
            : typeof value === schema.type;
    if (!matches) return false;
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && [...value].length < schema.minLength) return false;
    if (schema.maxLength !== undefined && [...value].length > schema.maxLength) return false;
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) return false;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return false;
    if (schema.minimum !== undefined && value < schema.minimum) return false;
    if (schema.maximum !== undefined && value > schema.maximum) return false;
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return false;
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return false;
    if (schema.uniqueItems && value.some((item, index) => value.slice(0, index).some((other) => isDeepStrictEqual(item, other)))) return false;
    const prefixLength = schema.prefixItems?.length ?? 0;
    if (schema.prefixItems && !schema.prefixItems.every((item, index) => index >= value.length || schemaAccepts(root, item, value[index]))) return false;
    if (schema.items && !value.slice(prefixLength).every((item) => schemaAccepts(root, schema.items, item))) return false;
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    if (schema.required?.some((key) => !Object.hasOwn(value, key))) return false;
    if (schema.properties && Object.entries(schema.properties).some(([key, item]) => Object.hasOwn(value, key) && !schemaAccepts(root, item, value[key]))) return false;
    if (schema.additionalProperties === false && Object.keys(value).some((key) => !Object.hasOwn(schema.properties ?? {}, key))) return false;
  }
  return true;
}

const metricDataset = () => ({
  schemaVersion: EVIDENCE_BOUND_REPORT_DATASET_SCHEMA_V1,
  datasetId: 'orders-total',
  kind: 'METRIC',
  columns: [{key: 'value'}],
  columnDefinitions: [{label: 'Orders total', dataType: 'number', nullable: false}],
  rows: [[42]],
  differentiator: null,
});

const tableDataset = () => ({
  schemaVersion: EVIDENCE_BOUND_REPORT_DATASET_SCHEMA_V1,
  datasetId: 'orders-by-status',
  kind: 'TABLE',
  columns: [
    {key: 'status'},
    {key: 'orders'},
  ],
  columnDefinitions: [
    {label: 'Status', dataType: 'string', nullable: false},
    {label: 'Orders', dataType: 'integer', nullable: false},
  ],
  rows: [['paid', 31], ['pending', 11]],
  differentiator: null,
});

const differentiatorDataset = () => ({
  schemaVersion: EVIDENCE_BOUND_REPORT_DATASET_SCHEMA_V1,
  datasetId: 'unavailable-differentiator',
  kind: 'DIFFERENTIATOR_PLACEHOLDER',
  columns: [],
  columnDefinitions: [],
  rows: [],
  differentiator: {type: 'DIFFERENTIATOR_PLACEHOLDER', status: 'UNPOPULATED', label: 'Differentiator pending evidence'},
});

const spec = (dataset = metricDataset()) => ({
  schemaVersion: EVIDENCE_BOUND_REPORT_SPEC_SCHEMA_V1,
  reportId: 'orders-report',
  title: 'Orders evidence report',
  dataset,
  bindings: {...BINDINGS},
});

function reordered(value) {
  if (Array.isArray(value)) return value.map(reordered);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reordered(child)]));
  return value;
}

function mutateAndRedigest(report, mutate) {
  const copy = structuredClone(report);
  mutate(copy);
  return buildEvidenceBoundReportV1(copy);
}

function assertDeepFrozen(value) {
  if (!value || typeof value !== 'object') return;
  assert(Object.isFrozen(value));
  Object.values(value).forEach(assertDeepFrozen);
}

test('bounded metric and table datasets produce deterministic canonical dataset and spec digests', () => {
  const metric = buildEvidenceBoundReportV1(spec());
  const repeated = buildEvidenceBoundReportV1(spec());
  const reorderedReport = buildEvidenceBoundReportV1(reordered(spec()));
  assert.deepEqual(repeated, metric);
  assert.deepEqual(reorderedReport, metric);
  assert.match(metric.datasetSha256, /^[a-f0-9]{64}$/);
  assert.match(metric.specSha256, /^[a-f0-9]{64}$/);
  assert.notEqual(metric.datasetSha256, metric.specSha256);

  const table = buildEvidenceBoundReportV1(spec(tableDataset()));
  assert.equal(table.dataset.kind, 'TABLE');
  assert.notEqual(table.datasetSha256, metric.datasetSha256);
  validateEvidenceBoundReportV1(table, BINDINGS);
  verifyEvidenceBoundReportV1(table, spec(tableDataset()), BINDINGS);
});

test('replay verifies the bound receipt and snapshot without granting an external authority', () => {
  const receipt = {schemaVersion: 'test/receipt/v1', receiptId: 'receipt-1', status: 'SUCCEEDED'};
  const snapshot = {schemaVersion: 'test/snapshot/v1', snapshotId: 'snapshot-1', state: 'SEALED'};
  const replayBindings = {
    ...BINDINGS,
    receiptSha256: identitySha256(receipt),
    snapshotSha256: identitySha256(snapshot),
  };
  const replaySpec = spec(metricDataset());
  replaySpec.bindings = replayBindings;
  const projection = buildEvidenceBoundReportV1(replaySpec, replayBindings);
  const verified = verifyEvidenceBoundReportReplayV1(projection, replaySpec, {receipt, snapshot}, replayBindings);

  assertDeepFrozen(verified);
  assert.notEqual(verified, projection);
  assert.equal(verified.bindings.receiptSha256, identitySha256(receipt));
  assert.equal(verified.bindings.snapshotSha256, identitySha256(snapshot));
  assert.throws(() => verifyEvidenceBoundReportReplayV1(projection, replaySpec, {
    receipt: {...receipt, status: 'TAMPERED'},
    snapshot,
  }, replayBindings), /EVIDENCE_BOUND_REPORT_REPLAY_RECEIPT_DIGEST_DENIED/);
  assert.throws(() => verifyEvidenceBoundReportReplayV1(projection, replaySpec, {
    receipt,
    snapshot: {...snapshot, state: 'TAMPERED'},
  }, replayBindings), /EVIDENCE_BOUND_REPORT_REPLAY_SNAPSHOT_DIGEST_DENIED/);
});

test('one explicitly typed differentiator placeholder is admitted and remains a nonclaim', () => {
  const report = buildEvidenceBoundReportV1(spec(differentiatorDataset()));
  assert.equal(report.dataset.kind, 'DIFFERENTIATOR_PLACEHOLDER');
  assert.deepEqual(report.dataset.differentiator, {
    type: 'DIFFERENTIATOR_PLACEHOLDER', status: 'UNPOPULATED', label: 'Differentiator pending evidence',
  });
  assert.equal(report.claims, undefined);
  verifyEvidenceBoundReportV1(report, spec(differentiatorDataset()), BINDINGS);
});

test('schema is closed and states the same accepted dataset kinds and limits as the runtime contract', async () => {
  const schema = JSON.parse(await readFile('contracts/evidence-bound-report/v1/report-spec.schema.json', 'utf8'));
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.$defs.datasetKind.enum, ['METRIC', 'TABLE', 'DIFFERENTIATOR_PLACEHOLDER']);
  assert.equal(schema.$defs.dataset.properties.rows.maxItems, 1000);
  assert.equal(schema.$defs.dataset.properties.columns.maxItems, 32);
  assert.equal(schema.$defs.row.maxItems, 32);
  assert.equal(schema.$defs.differentiator.properties.type.const, 'DIFFERENTIATOR_PLACEHOLDER');
  assert.equal(schema.$defs.differentiator.properties.status.const, 'UNPOPULATED');
  const safeTextPattern = new RegExp(schema.$defs.safeText.pattern);
  assert.equal(safeTextPattern.test('<script>alert(1)</script>'), false);
  assert.equal(safeTextPattern.test('eval("unsafe")'), false);
  for (const definition of Object.values(schema.$defs)) {
    if (definition.type === 'object') assert.equal(definition.additionalProperties, false);
  }
  assert.equal(schemaAccepts(schema, schema, spec()), true);
  assert.equal(schemaAccepts(schema, schema, spec(tableDataset())), true);
  assert.equal(schemaAccepts(schema, schema, spec(differentiatorDataset())), true);
  assert.deepEqual(buildEvidenceBoundReportV1(spec()).dataset, metricDataset());
});

test('validator and verifier require exact evidence bindings and digest identities', () => {
  const report = buildEvidenceBoundReportV1(spec());
  assert.deepEqual(validateEvidenceBoundReportV1(report, BINDINGS), report);
  assert.notEqual(validateEvidenceBoundReportV1(report, BINDINGS), report);
  for (const key of Object.keys(BINDINGS)) {
    const wrong = {...BINDINGS, [key]: H('9')};
    assert.throws(() => validateEvidenceBoundReportV1(report, wrong), /EVIDENCE_BOUND_REPORT_(?:BINDING|SPEC)_DENIED/);
  }
  const missingBinding = spec();
  delete missingBinding.bindings.receiptSha256;
  assert.throws(() => buildEvidenceBoundReportV1(missingBinding), /EVIDENCE_BOUND_REPORT_BINDING_DENIED/);
  assert.throws(() => verifyEvidenceBoundReportV1(report, spec(), {...BINDINGS, snapshotSha256: H('8')}), /EVIDENCE_BOUND_REPORT_BINDING_DENIED/);
  assert.throws(() => verifyEvidenceBoundReportV1(report, spec(), {...BINDINGS, resultSha256: H('9')}), /EVIDENCE_BOUND_REPORT_BINDING_DENIED/);
  assert.throws(() => verifyEvidenceBoundReportV1({...report, datasetSha256: H('9')}, spec(), BINDINGS), /EVIDENCE_BOUND_REPORT_DATASET_DIGEST_DENIED/);
  assert.throws(() => verifyEvidenceBoundReportV1({...report, specSha256: H('9')}, spec(), BINDINGS), /EVIDENCE_BOUND_REPORT_SPEC_DIGEST_DENIED/);
  assert.throws(() => verifyEvidenceBoundReportV1(mutateAndRedigest(report, (copy) => { copy.title = 'substituted'; }), spec(), BINDINGS), /EVIDENCE_BOUND_REPORT_SPEC_DIGEST_DENIED|EVIDENCE_BOUND_REPORT_MISMATCH/);
});

test('script, executable expression, URL, credential, connection, raw-row, oversized and renderer surfaces deny', () => {
  const cases = [
    (copy) => { copy.script = 'alert(1)'; },
    (copy) => { copy.dataset.rows[0][0] = '=SUM(A1)'; },
    (copy) => { copy.dataset = tableDataset(); copy.dataset.rows[0][0] = '<script>alert(1)</script>'; },
    (copy) => { copy.dataset = tableDataset(); copy.dataset.rows[0][0] = 'eval("unsafe")'; },
    (copy) => { copy.url = 'https://example.invalid'; },
    (copy) => { copy.credentials = 'secret'; },
    (copy) => { copy.sourceConnection = {host: 'db'}; },
    (copy) => { copy.rawRows = []; },
    (copy) => { copy.renderer = {type: 'chart'}; },
    (copy) => { copy.dataset.rows = Array.from({length: 1001}, () => [1]); },
  ];
  for (const mutate of cases) {
    const copy = structuredClone(spec());
    mutate(copy);
    assert.throws(() => buildEvidenceBoundReportV1(copy), /EVIDENCE_BOUND_REPORT_(?:SURFACE|DATASET|LIMIT|CELL)_DENIED/);
  }
});

test('unsupported data, differentiator and renderer fields deny closed-surface substitution', () => {
  for (const mutate of [
    (copy) => { copy.dataset.kind = 'CHART'; },
    (copy) => { copy.dataset.differentiator = {type: 'SCRIPT', status: 'UNPOPULATED', label: 'x'}; },
    (copy) => { copy.dataset.renderer = 'table'; },
    (copy) => { copy.dataset.columns[0].format = 'currency'; },
    (copy) => { copy.dataset.rows[0].push({rawRow: true}); },
  ]) {
    const copy = structuredClone(spec());
    mutate(copy);
    assert.throws(() => buildEvidenceBoundReportV1(copy), /EVIDENCE_BOUND_REPORT_(?:SURFACE|DATASET|CELL)_DENIED/);
  }
});

test('proxy, accessor, hidden, symbol, prototype-bearing, null, scalar and partial inputs deny without effects', () => {
  let traps = 0;
  const proxy = new Proxy(spec(), {ownKeys() { traps += 1; return Reflect.ownKeys(spec()); }, getPrototypeOf() { traps += 1; return Object.prototype; }});
  assert.throws(() => buildEvidenceBoundReportV1(proxy), /EVIDENCE_BOUND_REPORT_SURFACE_DENIED/);
  assert.equal(traps, 0);

  const accessor = spec();
  Object.defineProperty(accessor, 'title', {enumerable: true, get() { traps += 1; return 'accessed'; }});
  assert.throws(() => buildEvidenceBoundReportV1(accessor), /EVIDENCE_BOUND_REPORT_SURFACE_DENIED/);
  assert.equal(traps, 0);

  const hidden = spec();
  Object.defineProperty(hidden, 'credentials', {enumerable: false, value: 'secret'});
  assert.throws(() => buildEvidenceBoundReportV1(hidden), /EVIDENCE_BOUND_REPORT_SURFACE_DENIED/);
  const symbol = spec();
  symbol[Symbol('hidden')] = 'secret';
  assert.throws(() => buildEvidenceBoundReportV1(symbol), /EVIDENCE_BOUND_REPORT_SURFACE_DENIED/);
  assert.throws(() => buildEvidenceBoundReportV1(Object.assign(Object.create({inherited: true}), spec())), /EVIDENCE_BOUND_REPORT_SURFACE_DENIED/);
  const customArray = spec();
  Object.setPrototypeOf(customArray.dataset.rows, {custom: true});
  assert.throws(() => buildEvidenceBoundReportV1(customArray), /EVIDENCE_BOUND_REPORT_SURFACE_DENIED/);
  for (const value of [null, 7, 'report', [], {...spec(), dataset: null}, {...spec(), bindings: undefined}]) {
    assert.throws(() => buildEvidenceBoundReportV1(value), /EVIDENCE_BOUND_REPORT_(?:SURFACE|DATASET|BINDING)_DENIED/);
  }
  assert.equal(traps, 0);
});

test('validation returns an isolated deeply frozen canonical copy and unload leaves no lifecycle residue', () => {
  const source = spec(tableDataset());
  const report = buildEvidenceBoundReportV1(source);
  const validated = validateEvidenceBoundReportV1(report, BINDINGS);
  assert.deepEqual(validated, report);
  assert.notEqual(validated, report);
  assertDeepFrozen(validated);
  source.dataset.rows[0][1] = 999;
  assert.equal(validated.dataset.rows[0][1], 31);
  assert.equal(Object.keys(globalThis).some((key) => /report|renderer|connection|credential/i.test(key)), false);
});

test('validation and verification never return caller-owned shallow-frozen projections', () => {
  const source = buildEvidenceBoundReportV1(spec(tableDataset()));
  const mutableProjection = structuredClone(source);
  Object.freeze(mutableProjection);

  const validated = validateEvidenceBoundReportV1(mutableProjection, BINDINGS);
  assert.notEqual(validated, mutableProjection);
  assert.notEqual(validated.dataset, mutableProjection.dataset);
  assertDeepFrozen(validated);
  mutableProjection.dataset.rows[0][1] = 999;
  assert.equal(validated.dataset.rows[0][1], 31);

  const verificationInput = structuredClone(source);
  Object.freeze(verificationInput);
  const verified = verifyEvidenceBoundReportV1(verificationInput, spec(tableDataset()), BINDINGS);
  assert.notEqual(verified, verificationInput);
  assert.notEqual(verified.dataset.rows, verificationInput.dataset.rows);
  assertDeepFrozen(verified);
  verificationInput.dataset.rows[0][1] = 1000;
  assert.equal(verified.dataset.rows[0][1], 31);
});

test('schema safe text rejects uppercase forbidden variants exactly as runtime does', async () => {
  const schema = JSON.parse(await readFile('contracts/evidence-bound-report/v1/report-spec.schema.json', 'utf8'));
  const safeTextPattern = new RegExp(schema.$defs.safeText.pattern);
  for (const text of ['HTTPS://example.invalid', 'JAVASCRIPT:alert(1)', '<SCRIPT>alert(1)</SCRIPT>', 'EVAL("unsafe")', 'SELECT 1', 'PASSWORD: secret']) {
    assert.equal(safeTextPattern.test(text), false, text);
    assert.equal(schemaAccepts(schema, schema, {...spec(), title: text}), false, text);
    assert.throws(() => buildEvidenceBoundReportV1({...spec(), title: text}), /EVIDENCE_BOUND_REPORT_(?:SURFACE|SPEC)_DENIED/, text);
  }
});

test('C0 and DEL controls are denied in both the schema safe-text pattern and runtime', async () => {
  const schema = JSON.parse(await readFile('contracts/evidence-bound-report/v1/report-spec.schema.json', 'utf8'));
  const safeTextPattern = new RegExp(schema.$defs.safeText.pattern);
  for (const control of [...Array.from({length: 32}, (_, code) => String.fromCodePoint(code)), '\u007f']) {
    const text = `safe${control}text`;
    assert.equal(safeTextPattern.test(text), false, `schema accepted U+${control.codePointAt(0).toString(16)}`);
    assert.equal(schemaAccepts(schema, schema, {...spec(), title: text}), false, `schema accepted U+${control.codePointAt(0).toString(16)}`);
    assert.throws(() => buildEvidenceBoundReportV1({...spec(), title: text}), /EVIDENCE_BOUND_REPORT_SURFACE_DENIED/, text);
  }
});

test('schema and runtime count astral Unicode code points equally at bounded text limits', async () => {
  const schema = JSON.parse(await readFile('contracts/evidence-bound-report/v1/report-spec.schema.json', 'utf8'));
  const astral = '\u{1f642}';
  const surfaces = [
    ['title', 256, () => spec(), (value, text) => { value.title = text; }],
    ['column label', 128, () => spec(tableDataset()), (value, text) => { value.dataset.columnDefinitions[0].label = text; }],
    ['differentiator label', 128, () => spec(differentiatorDataset()), (value, text) => { value.dataset.differentiator.label = text; }],
    ['string cell', 512, () => spec(tableDataset()), (value, text) => { value.dataset.rows[0][0] = text; }],
  ];

  for (const [label, maximum, fixture, setText] of surfaces) {
    for (const [codePoints, accepted] of [[maximum, true], [maximum + 1, false]]) {
      const value = fixture();
      setText(value, astral.repeat(codePoints));
      const message = `${label} at ${codePoints} code points`;
      assert.equal(schemaAccepts(schema, schema, value), accepted, `schema mismatch for ${message}`);
      if (accepted) assert.doesNotThrow(() => buildEvidenceBoundReportV1(value), `runtime rejected ${message}`);
      else assert.throws(() => buildEvidenceBoundReportV1(value), /EVIDENCE_BOUND_REPORT_(?:SURFACE|SPEC|DATASET|CELL)_DENIED/, `runtime accepted ${message}`);
    }
  }
});

test('standard schema assertions and runtime deny the same bounded relational and numeric fixtures', async () => {
  const schema = JSON.parse(await readFile('contracts/evidence-bound-report/v1/report-spec.schema.json', 'utf8'));
  assert.equal(schema.$defs.row.minItems, 1);
  assert.equal(schema.$defs.dataset.properties.columns.uniqueItems, true);
  assert.deepEqual(schema.$defs.dataType.enum, ['string', 'integer', 'number', 'boolean']);
  assert.equal(schema.$defs.safeNumber.minimum, -9007199254740991);
  assert.equal(schema.$defs.safeNumber.maximum, 9007199254740991);
  assert.equal(schema.$defs.safeNumber.not.const, 0);
  assert.equal(schema.$defs.canonicalZero.const, '0');
  assert.equal(JSON.stringify(schema).includes('x-kaleidosphere-invariants'), false);

  const typedDataset = {
    schemaVersion: EVIDENCE_BOUND_REPORT_DATASET_SCHEMA_V1,
    datasetId: 'typed-values',
    kind: 'TABLE',
    columns: [
      {key: 'text'},
      {key: 'count'},
      {key: 'ratio'},
      {key: 'enabled'},
    ],
    columnDefinitions: [
      {label: 'Text', dataType: 'string', nullable: true},
      {label: 'Count', dataType: 'integer', nullable: false},
      {label: 'Ratio', dataType: 'number', nullable: false},
      {label: 'Enabled', dataType: 'boolean', nullable: false},
    ],
    rows: [[null, '0', -9007199254740991, true], ['ok', 9007199254740991, '0', false]],
    differentiator: null,
  };
  const acceptedSpec = spec(typedDataset);
  assert.equal(schemaAccepts(schema, schema, acceptedSpec), true);
  const accepted = buildEvidenceBoundReportV1(acceptedSpec);
  assertDeepFrozen(accepted);

  const denied = [
    ['row width', (copy) => { copy.dataset.rows[0].pop(); }],
    ['definition width', (copy) => { copy.dataset.columnDefinitions.pop(); }],
    ['integer type', (copy) => { copy.dataset.rows[0][1] = 1.5; }],
    ['nullability', (copy) => { copy.dataset.columnDefinitions[0].nullable = false; }],
    ['boolean type', (copy) => { copy.dataset.rows[0][3] = 1; }],
    ['duplicate key', (copy) => { copy.dataset.columns[1].key = copy.dataset.columns[0].key; }],
    ['negative zero', (copy) => { copy.dataset.rows[0][2] = -0; }],
    ['noncanonical numeric zero', (copy) => { copy.dataset.rows[0][2] = 0; }],
    ['unsafe magnitude', (copy) => { copy.dataset.rows[0][2] = 9007199254740992; }],
    ['numeric string substitution', (copy) => { copy.dataset.rows[0][2] = '1'; }],
  ];
  for (const [label, mutate] of denied) {
    const copy = structuredClone(spec(typedDataset));
    mutate(copy);
    assert.equal(schemaAccepts(schema, schema, copy), false, `schema accepted ${label}`);
    assert.throws(() => buildEvidenceBoundReportV1(copy), /EVIDENCE_BOUND_REPORT_(?:DATASET|CELL|SURFACE)_DENIED/, label);
  }
});
