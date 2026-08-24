import assert from 'node:assert/strict';
import test from 'node:test';

import {COVERAGE_LEDGER_SCHEMA, identitySha256} from '../services/bi-control/src/db-analyzer/core.mjs';
import {
  OBJECT_INVENTORY_SNAPSHOT_SCHEMA,
  OBJECT_SEARCH_CURSOR_SCHEMA,
  buildObjectSearchCursor,
  createObjectInventorySnapshot,
  createObjectSearchCoverageBinding,
  createObjectSearchEnvelope,
  nextObjectSearchCursor,
  resumeObjectSearchCursor,
  resumeObjectSearchEnvelope,
} from '../services/bi-control/src/db-analyzer/object-search-envelope-v1.mjs';

const SHA256 = /^[a-f0-9]{64}$/;
const KIND_COUNTS = Object.freeze({COLUMN: 40, INDEX: 10, SEQUENCE: 2, SYNONYM: 3, TABLE: 20, VIEW: 5});
const STATE_COUNTS = Object.freeze({SUCCEEDED: 18, PARTIAL: 1, DENIED: 1, UNSUPPORTED: 0, TIMEOUT: 0, ERROR: 0});

const inventory = ({kindCounts = KIND_COUNTS, engine = 'mssql'} = {}) =>
  createObjectInventorySnapshot({engine, kindCounts});
const coverage = ({stateCounts = STATE_COUNTS} = {}) =>
  createObjectSearchCoverageBinding({stateCounts});
const input = (overrides = {}) => ({
  engine: 'mssql',
  scope: {schemas: ['finance', 'operations']},
  prefix: 'inv',
  kindFilters: ['TABLE', 'VIEW'],
  pageSize: 20,
  inventory: inventory(),
  coverage: coverage(),
  ...overrides,
});
const envelope = (overrides = {}) => createObjectSearchEnvelope(input(overrides));
const reSeal = (value, key) => {
  const {[key]: ignored, ...body} = value;
  return {...body, [key]: identitySha256(body)};
};
const shuffled = (value) => Object.fromEntries([...Object.entries(value)].reverse());
const rejects = (fn, code) => assert.throws(fn, (error) => error.code === code);

test('creates a deterministic sealed SEARCH_REQUESTED envelope', () => {
  const first = envelope();
  const second = envelope();
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(first.schemaVersion, 'chimpmaera.db/object-search-envelope/v1');
  assert.equal(first.state, 'SEARCH_REQUESTED');
  assert.equal(first.engine, 'mssql');
  assert(SHA256.test(first.envelopeSha256));
  assert.equal(first.authority.readOnly, true);
  assert.equal(first.authority.mutationAuthorized, false);
  assert.equal(first.authority.sqlAccepted, false);
  assert.equal(first.authority.dispatchAuthorized, false);
  assert.equal(first.inventory.objectCount, 80);
  assert.equal(first.coverage.totalQueries, 20);
  assert.deepEqual(resumeObjectSearchEnvelope(first), first);
});

test('accepts envelopes and cursors serialized with reordered keys', () => {
  const base = envelope();
  const reorderedEnvelope = JSON.parse(JSON.stringify(shuffled(base)));
  assert.deepEqual(resumeObjectSearchEnvelope(reorderedEnvelope), base);
  const cursor = buildObjectSearchCursor(base);
  const reorderedCursor = JSON.parse(JSON.stringify(shuffled(cursor)));
  assert.deepEqual(resumeObjectSearchCursor(base, reorderedCursor), cursor);
});

test('builds snapshot-bound opaque cursors and advances bounded pages', () => {
  const base = envelope();
  let cursor = buildObjectSearchCursor(base);
  assert.equal(cursor.schemaVersion, OBJECT_SEARCH_CURSOR_SCHEMA);
  assert.equal(cursor.pageIndex, 0);
  assert.equal(cursor.envelopeSha256, base.envelopeSha256);
  assert.equal(cursor.inventorySnapshotSha256, base.inventory.inventorySha256);
  assert(SHA256.test(cursor.opaqueDigest));
  assert.deepEqual(resumeObjectSearchCursor(base, cursor), cursor);
  for (const expected of [1, 2, 3]) {
    cursor = nextObjectSearchCursor(base, cursor);
    assert.equal(cursor.pageIndex, expected);
  }
  assert.deepEqual(resumeObjectSearchCursor(base, cursor), cursor);
  rejects(() => nextObjectSearchCursor(base, cursor), 'DB_OBJECT_SEARCH_CURSOR_EXHAUSTED');
});

test('cursor bounds use ceiling page semantics for empty, singleton, exact and partial inventories', () => {
  const cases = [
    {count: 0, pageSize: 20, pages: 0},
    {count: 1, pageSize: 20, pages: 1},
    {count: 40, pageSize: 20, pages: 2},
    {count: 41, pageSize: 20, pages: 3},
  ];
  for (const {count, pageSize, pages} of cases) {
    const base = envelope({
      pageSize,
      inventory: inventory({kindCounts: {...Object.fromEntries(Object.keys(KIND_COUNTS).map((kind) => [kind, 0])), TABLE: count}}),
    });
    if (pages === 0) {
      rejects(() => buildObjectSearchCursor(base), 'DB_OBJECT_SEARCH_CURSOR_EXHAUSTED');
      continue;
    }
    for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
      assert.equal(buildObjectSearchCursor(base, {pageIndex}).pageIndex, pageIndex);
    }
    rejects(() => buildObjectSearchCursor(base, {pageIndex: pages}), 'DB_OBJECT_SEARCH_CURSOR_EXHAUSTED');
  }
});

test('fails closed on envelope and nested digest drift', () => {
  const base = envelope();
  rejects(() => resumeObjectSearchEnvelope({...base, engine: 'oracle'}), 'DB_OBJECT_SEARCH_ENVELOPE_TAMPERED');
  rejects(() => resumeObjectSearchEnvelope({...base, prefix: 'ops'}), 'DB_OBJECT_SEARCH_ENVELOPE_TAMPERED');
  rejects(() => resumeObjectSearchEnvelope({
    ...base,
    inventory: {...base.inventory, kindCounts: {...base.inventory.kindCounts, TABLE: 999}},
  }), 'DB_OBJECT_SEARCH_ENVELOPE_TAMPERED');
  rejects(() => resumeObjectSearchEnvelope({
    ...base,
    coverage: reSeal({...base.coverage, stateCounts: {...base.coverage.stateCounts, SUCCEEDED: 99}}, 'coverageSha256'),
  }), 'DB_OBJECT_SEARCH_ENVELOPE_TAMPERED');
});

test('fails closed on re-digested forgery and unknown fields', () => {
  const base = envelope();
  rejects(() => resumeObjectSearchEnvelope(reSeal(
    {...base, authority: {...base.authority, mutationAuthorized: true}}, 'envelopeSha256',
  )), 'DB_OBJECT_SEARCH_AUTHORITY_INVALID');
  rejects(() => resumeObjectSearchEnvelope(reSeal(
    {...base, kindFilters: ['TABLE', 'VIEW', 'TABLESPACE']}, 'envelopeSha256',
  )), 'DB_OBJECT_SEARCH_KIND_FILTERS_INVALID');
  rejects(() => resumeObjectSearchEnvelope(reSeal(
    {...base, dispatch: 'immediate'}, 'envelopeSha256',
  )), 'DB_OBJECT_SEARCH_ENVELOPE_INVALID');
  rejects(() => resumeObjectSearchEnvelope(reSeal(
    {...base, engine: 'oracle'}, 'envelopeSha256',
  )), 'DB_OBJECT_SEARCH_INVENTORY_INVALID');
  const cursor = buildObjectSearchCursor(base);
  const reDigested = reSeal({...base, pageSize: 10}, 'envelopeSha256');
  rejects(() => resumeObjectSearchCursor(reDigested, cursor), 'DB_OBJECT_SEARCH_CURSOR_BINDING_INVALID');
});

test('rejects identifier prefix injection and unsafe material', () => {
  for (const prefix of ['inv;DROP TABLE x', 'inv--x', 'inv/*x', 'inv"OR 1=1', "inv'x", 'inv\\x', `inv\0x`,
    'dsn', 'password1', 'a'.repeat(65), '', 42]) {
    rejects(() => envelope({prefix}), 'DB_OBJECT_SEARCH_PREFIX_INVALID');
  }
  const base = envelope();
  assert.doesNotThrow(() => resumeObjectSearchEnvelope(base));
  for (const schema of ['SELECT', '/var/lib/data', '../data', 'resultCallback', 'raw_value']) {
    rejects(() => envelope({scope: {schemas: [schema]}}), 'DB_OBJECT_SEARCH_UNSAFE_MATERIAL');
  }
  rejects(() => envelope({scope: {schemas: ['accessToken']}}), 'DB_OBJECT_SEARCH_SCOPE_INVALID');
});

test('rejects unsafe page, kind, scope, and engine bounds', () => {
  for (const pageSize of [0, 501, 2.5, '20']) {
    rejects(() => envelope({pageSize}), 'DB_OBJECT_SEARCH_PAGE_SIZE_INVALID');
  }
  assert.doesNotThrow(() => envelope({pageSize: 500}));
  for (const kindFilters of [[], ['TABLE', 'TABLE'], ['TABLE', 'TABLESPACE']]) {
    rejects(() => envelope({kindFilters}), 'DB_OBJECT_SEARCH_KIND_FILTERS_INVALID');
  }
  for (const scope of [{schemas: []}, {schemas: ['finance', 'finance']}, {schemas: ['fin\nance']}, {schemas: ['password']}]) {
    rejects(() => envelope({scope}), 'DB_OBJECT_SEARCH_SCOPE_INVALID');
  }
  rejects(() => envelope({engine: 'mysql'}), 'DB_OBJECT_SEARCH_ENGINE_INVALID');
});

test('cursor is bound to the envelope digest and inventory snapshot', () => {
  const base = envelope();
  const otherInventory = envelope({inventory: inventory({kindCounts: {...KIND_COUNTS, TABLE: 21}})});
  const cursor = buildObjectSearchCursor(base);
  rejects(() => resumeObjectSearchCursor(otherInventory, cursor), 'DB_OBJECT_SEARCH_CURSOR_BINDING_INVALID');
  rejects(() => resumeObjectSearchCursor(base, buildObjectSearchCursor(otherInventory)), 'DB_OBJECT_SEARCH_CURSOR_BINDING_INVALID');
  const forgedBody = {
    schemaVersion: OBJECT_SEARCH_CURSOR_SCHEMA,
    envelopeSha256: base.envelopeSha256,
    inventorySnapshotSha256: base.inventory.inventorySha256,
    pageIndex: 10,
    opaqueDigest: identitySha256({
      envelopeSha256: base.envelopeSha256,
      inventorySnapshotSha256: base.inventory.inventorySha256,
      pageIndex: 10,
    }),
  };
  rejects(() => resumeObjectSearchCursor(base, reSeal(forgedBody, 'cursorSha256')), 'DB_OBJECT_SEARCH_CURSOR_BINDING_INVALID');
  const wrongDigest = {...forgedBody, pageIndex: 1, opaqueDigest: identitySha256({forged: true})};
  rejects(() => resumeObjectSearchCursor(base, reSeal(wrongDigest, 'cursorSha256')), 'DB_OBJECT_SEARCH_CURSOR_BINDING_INVALID');
  const tampered = {...buildObjectSearchCursor(base), pageIndex: 9};
  rejects(() => resumeObjectSearchCursor(base, tampered), 'DB_OBJECT_SEARCH_CURSOR_TAMPERED');
});

test('inventory and coverage bindings verify internal consistency', () => {
  rejects(() => createObjectInventorySnapshot({engine: 'mssql', kindCounts: {TABLE: 1, EXTRA: 1}}),
    'DB_OBJECT_SEARCH_INVENTORY_INVALID');
  rejects(() => envelope({
    inventory: reSeal({...inventory(), objectCount: 999}, 'inventorySha256'),
  }), 'DB_OBJECT_SEARCH_INVENTORY_INVALID');
  rejects(() => envelope({
    inventory: createObjectInventorySnapshot({engine: 'oracle', kindCounts: KIND_COUNTS}),
  }), 'DB_OBJECT_SEARCH_INVENTORY_INVALID');
  rejects(() => coverage({stateCounts: {...STATE_COUNTS, EXTRA: 1}}), 'DB_OBJECT_SEARCH_COVERAGE_INVALID');
  rejects(() => envelope({
    coverage: reSeal({...coverage(), totalQueries: 999}, 'coverageSha256'),
  }), 'DB_OBJECT_SEARCH_COVERAGE_INVALID');
  rejects(() => resumeObjectSearchEnvelope({
    ...reSeal({...envelope(), coverage: {...coverage(), stateCounts: {...STATE_COUNTS, SUCCEEDED: 19}}}, 'envelopeSha256'),
  }), 'DB_OBJECT_SEARCH_COVERAGE_INVALID');
});

const UNSAFE_COUNT = Number.MAX_SAFE_INTEGER + 1;
const ZERO_KIND_COUNTS = Object.freeze(Object.fromEntries(Object.keys(KIND_COUNTS).map((kind) => [kind, 0])));
const ZERO_STATE_COUNTS = Object.freeze(Object.fromEntries(Object.keys(STATE_COUNTS).map((state) => [state, 0])));

test('rejects Number.MAX_SAFE_INTEGER + 1 kind and state counts before sealing', () => {
  rejects(() => createObjectInventorySnapshot({
    engine: 'mssql',
    kindCounts: {...ZERO_KIND_COUNTS, TABLE: UNSAFE_COUNT},
  }), 'DB_OBJECT_SEARCH_INVENTORY_INVALID');
  rejects(() => createObjectSearchCoverageBinding({
    stateCounts: {...ZERO_STATE_COUNTS, SUCCEEDED: UNSAFE_COUNT},
  }), 'DB_OBJECT_SEARCH_COVERAGE_INVALID');
});

test('rejects unsafe aggregate overflow in computed objectCount and totalQueries', () => {
  rejects(() => createObjectInventorySnapshot({
    engine: 'mssql',
    kindCounts: {...ZERO_KIND_COUNTS, TABLE: Number.MAX_SAFE_INTEGER, VIEW: 2},
  }), 'DB_OBJECT_SEARCH_INVENTORY_INVALID');
  rejects(() => createObjectSearchCoverageBinding({
    stateCounts: {...ZERO_STATE_COUNTS, SUCCEEDED: Number.MAX_SAFE_INTEGER, PARTIAL: 2},
  }), 'DB_OBJECT_SEARCH_COVERAGE_INVALID');
});

test('fails closed on re-digested unsafe inventory and coverage bindings', () => {
  const unsafeInventory = reSeal({
    schemaVersion: OBJECT_INVENTORY_SNAPSHOT_SCHEMA,
    engine: 'mssql',
    objectCount: UNSAFE_COUNT,
    kindCounts: {...ZERO_KIND_COUNTS, TABLE: UNSAFE_COUNT},
  }, 'inventorySha256');
  rejects(() => envelope({inventory: unsafeInventory}), 'DB_OBJECT_SEARCH_INVENTORY_INVALID');
  rejects(() => resumeObjectSearchEnvelope(reSeal(
    {...envelope(), inventory: unsafeInventory}, 'envelopeSha256',
  )), 'DB_OBJECT_SEARCH_INVENTORY_INVALID');
  const unsafeCoverage = reSeal({
    schemaVersion: COVERAGE_LEDGER_SCHEMA,
    totalQueries: UNSAFE_COUNT,
    stateCounts: {...ZERO_STATE_COUNTS, SUCCEEDED: UNSAFE_COUNT},
  }, 'coverageSha256');
  rejects(() => envelope({coverage: unsafeCoverage}), 'DB_OBJECT_SEARCH_COVERAGE_INVALID');
  rejects(() => resumeObjectSearchEnvelope(reSeal(
    {...envelope(), coverage: unsafeCoverage}, 'envelopeSha256',
  )), 'DB_OBJECT_SEARCH_COVERAGE_INVALID');
});

test('rejects Number.MAX_SAFE_INTEGER + 1 cursor page index before sealing', () => {
  rejects(() => buildObjectSearchCursor(envelope(), {pageIndex: UNSAFE_COUNT}), 'DB_OBJECT_SEARCH_CURSOR_INVALID');
});

test('fails closed on re-digested unsafe cursor page index', () => {
  const base = envelope();
  const forged = {
    schemaVersion: OBJECT_SEARCH_CURSOR_SCHEMA,
    envelopeSha256: base.envelopeSha256,
    inventorySnapshotSha256: base.inventory.inventorySha256,
    pageIndex: UNSAFE_COUNT,
    opaqueDigest: identitySha256({
      envelopeSha256: base.envelopeSha256,
      inventorySnapshotSha256: base.inventory.inventorySha256,
      pageIndex: UNSAFE_COUNT,
    }),
  };
  rejects(() => resumeObjectSearchCursor(base, reSeal(forged, 'cursorSha256')), 'DB_OBJECT_SEARCH_CURSOR_BINDING_INVALID');
});

test('accepts boundary-safe counts at MAX_SAFE_INTEGER without aggregate overflow', () => {
  const base = envelope({
    pageSize: 500,
    inventory: inventory({kindCounts: {...ZERO_KIND_COUNTS, TABLE: Number.MAX_SAFE_INTEGER}}),
  });
  assert.equal(base.inventory.objectCount, Number.MAX_SAFE_INTEGER);
  assert.deepEqual(resumeObjectSearchEnvelope(base), base);
  const first = buildObjectSearchCursor(base);
  assert.deepEqual(resumeObjectSearchCursor(base, first), first);
  const lastPageIndex = Math.ceil(Number.MAX_SAFE_INTEGER / 500) - 1;
  const last = buildObjectSearchCursor(base, {pageIndex: lastPageIndex});
  assert.equal(last.pageIndex, lastPageIndex);
  rejects(() => nextObjectSearchCursor(base, last), 'DB_OBJECT_SEARCH_CURSOR_EXHAUSTED');
});
