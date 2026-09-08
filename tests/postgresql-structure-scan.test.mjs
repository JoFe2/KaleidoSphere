import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildPreflightEvidence,
  validateAnalyzeProfile,
} from '../services/bi-control/src/db-analyzer/core.mjs';
import { buildStructureMapOutputs } from '../services/bi-control/src/db-analyzer/outputs.mjs';
import { auditCatalogQuery, auditQueryPackSafety } from '../services/bi-control/src/db-analyzer/query-safety.mjs';
import { renderAnalyzeEvidence, runAnalyzeProfile } from '../services/bi-control/src/db-analyzer/workflow.mjs';

const packDirectory = 'services/bi-control/query-packs/db-analyzer/v1/postgresql';
const v2PackDirectory = 'services/bi-control/query-packs/db-analyzer/v2/postgresql';
const fixtureDirectory = 'services/bi-control/fixtures';

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const clone = (value) => structuredClone(value);

async function loadInputs() {
  const [manifest, profile, resultSets, incompleteResultSets, negativeCases] = await Promise.all([
    readJson(`${packDirectory}/manifest.json`),
    readJson(`${fixtureDirectory}/postgresql-structure-profile-v1.json`),
    readJson(`${fixtureDirectory}/postgresql-structure-results-v1.json`),
    readJson(`${fixtureDirectory}/postgresql-structure-results-incomplete-v1.json`),
    readJson(`${fixtureDirectory}/postgresql-structure-negative-cases-v1.json`),
  ]);
  const sqlByQueryId = Object.fromEntries(await Promise.all(manifest.queries
    .map(async (query) => [query.id, await readFile(`${packDirectory}/${query.file}`, 'utf8')])));
  const profileContext = {
    profileId: profile.profileId,
    mode: profile.mode,
    scope: profile.scope,
    policy: profile.policy,
    adapter: profile.adapter.kind,
  };
  return { manifest, profile, profileContext, resultSets, incompleteResultSets, negativeCases, sqlByQueryId };
}

// The v2 index-readback family reuses the same regular dispatcher/readback machinery over a
// source-local v2 pack that adds bounded index catalog metadata to the v1 structure scan.
async function loadV2Inputs() {
  const [manifest, profile, resultSets, incompleteResultSets, negativeCases] = await Promise.all([
    readJson(`${v2PackDirectory}/manifest.json`),
    readJson(`${fixtureDirectory}/postgresql-structure-profile-v2.json`),
    readJson(`${fixtureDirectory}/postgresql-structure-results-v2.json`),
    readJson(`${fixtureDirectory}/postgresql-structure-results-incomplete-v2.json`),
    readJson(`${fixtureDirectory}/postgresql-structure-negative-cases-v2.json`),
  ]);
  const sqlByQueryId = Object.fromEntries(await Promise.all(manifest.queries
    .map(async (query) => [query.id, await readFile(`${v2PackDirectory}/${query.file}`, 'utf8')])));
  const profileContext = {
    profileId: profile.profileId,
    mode: profile.mode,
    scope: profile.scope,
    policy: profile.policy,
    adapter: profile.adapter.kind,
  };
  return { manifest, profile, profileContext, resultSets, incompleteResultSets, negativeCases, sqlByQueryId };
}

const build = ({ manifest, sqlByQueryId, resultSets, profileContext }) => buildPreflightEvidence({
  manifest, sqlByQueryId, resultSets, profileContext,
});

// Source-local synthetic oracle for the emitted index query mapping. It interprets the
// actually-emitted bounded query (ordinal expansion tuples, the pg_index.indkey subscript
// column, the indnkeyatts row bound and the expression rule) and applies that mapping to
// independently specified native catalog state. PostgreSQL's int2vector lower bound is 0
// (REL_17_0 src/backend/utils/adt/int.c buildint2vector sets result->lbound1 = 0), so a
// correctly emitted query resolves the emitted 1-based key ordinal through a 0-based
// native vector offset; a subscript that uses the 1-based ordinal directly shifts every
// key and drops the last one. This is a source-local synthetic proof, not C1 certification.
function interpretEmittedIndexMapping(indexSql) {
  const expansion = indexSql.match(/CROSS JOIN \(VALUES([\s\S]*?)\)\s+AS\s+key_ordinal_range\s*\(([^)]*)\)/i);
  assert.ok(expansion, 'the emitted query bounds the ordinal space with an explicit expansion');
  const columns = expansion[2].split(',').map((column) => column.trim());
  const tuples = [...expansion[1].matchAll(/\(\s*(\d+)\s*(?:,\s*(\d+))?\s*\)/g)]
    .map((match) => [Number(match[1]), match[2] === undefined ? null : Number(match[2])]);
  assert.ok(tuples.length > 0, 'the expansion enumerates bounded ordinal rows');
  const emitted = indexSql.match(/key_ordinal_range\.([A-Za-z_][A-Za-z0-9_]*)\s+AS\s+key_ordinal\b/i);
  assert.ok(emitted, 'the emitted key_ordinal is projected from the expansion');
  const subscript = indexSql.match(/index_row\.indkey\s*\[\s*([A-Za-z_][A-Za-z0-9_]*)\s*\]/i);
  assert.ok(subscript, 'key positions are read positionally from the pg_index.indkey vector');
  const bound = indexSql.match(/key_ordinal_range\.([A-Za-z_][A-Za-z0-9_]*)\s*<=\s*index_row\.indnkeyatts/i);
  assert.ok(bound, 'the expansion is row-bounded by the index key-attribute count');
  const orderBy = indexSql.match(/ORDER\s+BY\s+([\s\S]*?);\s*$/i);
  assert.ok(orderBy, 'the emitted query is deterministically ordered');
  const emittedOrdinalIndex = columns.indexOf(emitted[1]);
  const offsetIndex = columns.indexOf(subscript[1]);
  const boundIndex = columns.indexOf(bound[1]);
  assert.ok(emittedOrdinalIndex >= 0, 'the emitted ordinal is an expansion column');
  assert.ok(offsetIndex >= 0, 'the vector subscript is an expansion column');
  assert.ok(boundIndex >= 0, 'the row bound is an expansion column');
  return {
    tuples,
    emittedOrdinalIndex,
    offsetIndex,
    boundIndex,
    emittedColumn: emitted[1],
    offsetColumn: subscript[1],
    sortKeys: orderBy[1].split(',').map((key) => key.trim()),
  };
}

function resolveSyntheticIndexKeys(mapping, { indkey, indnkeyatts, attributes }) {
  const rows = [];
  for (const tuple of mapping.tuples) {
    if (tuple[mapping.boundIndex] > indnkeyatts) continue;
    const vectorOffset = tuple[mapping.offsetIndex];
    const attnum = Number.isInteger(vectorOffset) && vectorOffset >= 0 && vectorOffset < indkey.length
      ? indkey[vectorOffset]
      : null;
    const attribute = attnum === null || attnum < 1 ? undefined : attributes.get(attnum);
    rows.push([tuple[mapping.emittedOrdinalIndex], attribute ? attribute.name : null, attribute ? 'COLUMN' : 'EXPRESSION', attribute ? attribute.type : null]);
  }
  return rows;
}

test('PostgreSQL structure fixture yields deterministic catalog-only inventory, constraints and declared dependencies', async () => {
  const evidence = await runAnalyzeProfile(`${fixtureDirectory}/postgresql-structure-profile-v1.json`, {
    repositoryRoot: 'services/bi-control',
  });
  assert.equal(evidence.engine, 'postgresql');
  assert.equal(evidence.runtimeValidation, 'SYNTHETIC_UNVALIDATED');
  assert.equal(evidence.coverageLedger.allComplete, true);
  assert.match(evidence.snapshotSha256, /^[a-f0-9]{64}$/);

  const relations = evidence.extracts.find((entry) => entry.category === 'relations').rows;
  const columns = evidence.extracts.find((entry) => entry.category === 'columns').rows;
  const constraints = evidence.extracts.find((entry) => entry.category === 'constraints').rows;
  const dependencies = evidence.extracts.find((entry) => entry.category === 'dependencies').rows;
  assert.equal(relations.length, 3);
  assert.equal(columns.length, 6);
  assert.deepEqual([...new Set(constraints.map((row) => row.constraint_kind))].sort(), [
    'CHECK', 'FOREIGN_KEY', 'PRIMARY_KEY', 'UNIQUE',
  ]);
  assert.ok([...relations, ...columns, ...constraints, ...dependencies]
    .every((row) => /^[a-f0-9]{64}$/.test(row.objectSha256)));
  assert.deepEqual(dependencies.map((row) => [row.relationship_authority, row.inferred]), [['CATALOG_DECLARED', false]]);
  assert.ok(evidence.blindSpots.some((entry) => entry.code === 'CHECK_DEFINITION_CONTENT_OMITTED'));

  const serialized = JSON.stringify(evidence);
  assert.doesNotMatch(serialized, /sample[_A-Z-]?value|example[_A-Z-]?value|raw[_A-Z-]?value|top[_A-Z-]?value/i);
  assert.doesNotMatch(serialized, /null[_A-Z-]?count|distinct[_A-Z-]?count|fk[_A-Z-]?candidate/i);
});

test('identical snapshot bytes and hashes are stable across input object and row order', async () => {
  const inputs = await loadInputs();
  const first = build(inputs);
  const reorderedResults = Object.fromEntries(Object.entries(inputs.resultSets.results).reverse().map(([queryId, result]) => [
    queryId,
    {...clone(result), rows: [...result.rows].reverse()},
  ]));
  const reordered = build({...inputs, resultSets: {...inputs.resultSets, results: reorderedResults}});
  assert.equal(renderAnalyzeEvidence(reordered), renderAnalyzeEvidence(first));
  assert.equal(reordered.snapshotSha256, first.snapshotSha256);
});

test('PostgreSQL pack is SELECT-only, catalog-allowlisted and projects declared relationships separately from inference', async () => {
  const inputs = await loadInputs();
  const audit = auditQueryPackSafety(inputs);
  assert.equal(audit.queryCount, 6);
  assert.equal(audit.zeroMutatingStatements, true);
  assert.equal(audit.zeroRowSamples, true);
  const evidence = build(inputs);
  const outputs = buildStructureMapOutputs({evidence, manifest: inputs.manifest, sqlByQueryId: inputs.sqlByQueryId});
  assert.ok(outputs.projections.relationships.rows.some((row) => row.relationshipKind === 'FOREIGN_KEY'));
  assert.ok(outputs.projections.relationships.rows.some((row) => row.relationshipKind === 'PG_DEPEND_REWRITE_NORMAL'));
  assert.ok(outputs.projections.relationships.rows.every((row) => row.relationshipAuthority === 'CATALOG_DECLARED' && row.inferred === false));
  assert.throws(() => auditCatalogQuery({
    engine: 'postgresql',
    queryId: 'postgresql.structure.unsafe',
    sql: 'SELECT customer_email FROM public.customers;',
  }), /DB_QUERY_ROW_SOURCE_DENIED/);
});

test('incomplete catalog fixture preserves visible partial evidence and explicit blind spots', async () => {
  const inputs = await loadInputs();
  const evidence = build({...inputs, resultSets: inputs.incompleteResultSets});
  assert.equal(evidence.coverageLedger.allComplete, false);
  assert.equal(evidence.coverage.PARTIAL, 1);
  assert.equal(evidence.coverage.DENIED, 1);
  assert.equal(evidence.extracts.find((entry) => entry.category === 'constraints').rows.length, 1);
  assert.equal(evidence.extracts.find((entry) => entry.category === 'dependencies').emptyInterpretation, 'NOT_CLAIMED');
  assert.ok(evidence.blindSpots.some((entry) => entry.queryId === 'postgresql.structure.constraints'
    && entry.coverageState === 'PARTIAL'));
  assert.ok(evidence.blindSpots.some((entry) => entry.queryId === 'postgresql.structure.dependencies'
    && entry.coverageState === 'DENIED'));
});

test('versioned negative catalog cases fail closed on scope and inferred relationship drift', async () => {
  const inputs = await loadInputs();
  assert.equal(inputs.negativeCases.schemaVersion, 'kaleidosphere.db/postgresql-structure-negative-cases/v1');
  for (const negativeCase of inputs.negativeCases.cases) {
    const resultSets = clone(inputs.resultSets);
    resultSets.results[negativeCase.queryId].rows = [negativeCase.row];
    assert.throws(() => build({...inputs, resultSets}), new RegExp(negativeCase.expectedError), negativeCase.caseId);
  }
});

test('scope allowlist, query allowlist and row budgets fail closed', async () => {
  const inputs = await loadInputs();
  const deniedProfileContext = clone(inputs.profileContext);
  deniedProfileContext.policy.catalogScan.allowedQueryIds = deniedProfileContext.policy.catalogScan.allowedQueryIds
    .filter((queryId) => queryId !== 'postgresql.structure.dependencies');
  assert.throws(() => build({...inputs, profileContext: deniedProfileContext}), /DB_CATALOG_SCAN_ALLOWLIST_DENIED/);

  const boundedProfileContext = clone(inputs.profileContext);
  boundedProfileContext.policy.catalogScan.maxRowsPerQuery = 1;
  assert.throws(() => build({...inputs, profileContext: boundedProfileContext}), /DB_CATALOG_SCAN_BUDGET_EXCEEDED/);

  const outsideScope = clone(inputs.resultSets);
  outsideScope.results['postgresql.structure.schemas'].rows[0].schema_name = 'private';
  assert.throws(() => build({...inputs, resultSets: outsideScope}), /DB_QUERY_RESULT_SCOPE_INVALID/);
});

test('profile and result contracts reject widened budgets and raw/example-value fields', async () => {
  const inputs = await loadInputs();
  assert.equal(validateAnalyzeProfile(inputs.profile), inputs.profile);
  const invalidProfile = clone(inputs.profile);
  invalidProfile.policy.catalogScan.maxQueries = 5;
  assert.throws(() => validateAnalyzeProfile(invalidProfile), /DB_CATALOG_SCAN_POLICY_INVALID/);

  const rawValueResult = clone(inputs.resultSets);
  rawValueResult.results['postgresql.structure.columns'].rows[0].sample_value = 'must-not-enter-evidence';
  assert.throws(() => build({...inputs, resultSets: rawValueResult}), /DB_QUERY_RESULT_COLUMNS_INVALID/);
});

test('PostgreSQL v2 index catalog metadata survives the regular Analyze-to-Readback path with ordered key columns', async () => {
  const evidence = await runAnalyzeProfile(`${fixtureDirectory}/postgresql-structure-profile-v2.json`, {
    repositoryRoot: 'services/bi-control',
  });
  assert.equal(evidence.engine, 'postgresql');
  assert.equal(evidence.runtimeValidation, 'SYNTHETIC_UNVALIDATED');
  assert.match(evidence.snapshotSha256, /^[a-f0-9]{64}$/);
  assert.equal(evidence.coverageLedger.allComplete, true);

  const indexExtract = evidence.extracts.find((entry) => entry.category === 'indexes');
  assert.ok(indexExtract, 'the index extract is present through the regular path');
  assert.equal(indexExtract.state, 'SUCCEEDED');
  assert.ok(indexExtract.rows.every((row) => /^[a-f0-9]{64}$/.test(row.objectSha256)));

  // Deterministic schema/relation/index identity with ordered key-column metadata.
  const ordersComposite = indexExtract.rows
    .filter((row) => row.index_name === 'orders_customer_amount_idx')
    .map((row) => [row.key_ordinal, row.key_column_name, row.key_column_kind, row.data_type]);
  assert.deepEqual(ordersComposite, [
    [1, 'customer_id', 'COLUMN', 'int8'],
    [2, 'total_amount', 'COLUMN', 'numeric'],
  ]);

  // Unique / primary / validity flags are preserved per index identity.
  const pkey = indexExtract.rows.find((row) => row.index_name === 'orders_pkey');
  assert.equal(pkey.is_primary, true);
  assert.equal(pkey.is_unique, true);
  assert.equal(pkey.is_valid, true);
  const uniqueNonPrimary = indexExtract.rows.find((row) => row.index_name === 'customers_email_key');
  assert.equal(uniqueNonPrimary.is_primary, false);
  assert.equal(uniqueNonPrimary.is_unique, true);
  assert.equal(uniqueNonPrimary.is_valid, true);

  // Unsupported expression content is explicit and never persisted.
  const expressionIndex = indexExtract.rows.find((row) => row.index_name === 'customers_email_lower_idx');
  assert.equal(expressionIndex.key_column_kind, 'EXPRESSION');
  assert.equal(expressionIndex.key_column_name, null);
  assert.equal(expressionIndex.data_type, null);
  assert.equal(expressionIndex.has_predicate, true);
  assert.equal(expressionIndex.predicate_disclosure, 'OMITTED_NO_RAW_PREDICATE');
  assert.equal(expressionIndex.definition_disclosure, 'OMITTED_NO_RAW_DEFINITION');

  // No raw expression text, predicate, definition, literal or row-sample leaks into the evidence.
  const serialized = JSON.stringify(evidence);
  assert.doesNotMatch(serialized, /sample[_A-Z-]?value|example[_A-Z-]?value|raw[_A-Z-]?value|top[_A-Z-]?value/i);
  assert.doesNotMatch(serialized, /\blower\s*\(/i);
  assert.doesNotMatch(serialized, /\bindpred\b|\bindkey\b/i);
});

test('PostgreSQL v2 index metadata survives projection and artifact digest binding', async () => {
  const inputs = await loadV2Inputs();
  const evidence = build(inputs);
  const outputs = buildStructureMapOutputs({ evidence, manifest: inputs.manifest, sqlByQueryId: inputs.sqlByQueryId });

  // The inventory projection carries INDEXES rows bound to the index query and its SQL digest.
  const indexRows = outputs.projections.inventory.rows.filter((row) => row.objectKind === 'INDEXES');
  assert.ok(indexRows.length > 0, 'the inventory projection carries index rows');
  const byName = new Map(indexRows.map((row) => [row.objectName, row]));
  assert.ok(byName.has('orders_pkey'));
  assert.ok(byName.has('customers_email_lower_idx'));
  const pkeyBinding = byName.get('orders_pkey');
  assert.equal(pkeyBinding.schemaName, 'public');
  assert.equal(pkeyBinding.relationName, 'orders');
  assert.equal(pkeyBinding.sourceQueryId, 'postgresql.structure.indexes');
  assert.match(pkeyBinding.sourceQuerySha256, /^[a-f0-9]{64}$/);
  // The coverage projection carries the index query as SUCCEEDED and digest-bound.
  const coverageIndex = outputs.projections.coverage.rows.find((row) => row.category === 'indexes');
  assert.equal(coverageIndex.state, 'SUCCEEDED');
  assert.match(coverageIndex.querySha256, /^[a-f0-9]{64}$/);
  // Artifact digests are well-formed, evidence-bound and byte-stable across re-derivation.
  for (const digest of Object.values(outputs.outputManifest.artifactDigests)) assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(outputs.outputManifest.sourceSnapshotSha256, evidence.snapshotSha256);
  const again = buildStructureMapOutputs({ evidence, manifest: inputs.manifest, sqlByQueryId: inputs.sqlByQueryId });
  assert.equal(again.outputManifest.artifactDigests.inventorySha256, outputs.outputManifest.artifactDigests.inventorySha256);
  assert.equal(again.outputManifest.artifactDigests.coverageSha256, outputs.outputManifest.artifactDigests.coverageSha256);
});

test('PostgreSQL v2 pack is SELECT-only, catalog-allowlisted and reads pg_catalog.pg_index', async () => {
  const inputs = await loadV2Inputs();
  const audit = auditQueryPackSafety(inputs);
  assert.equal(audit.queryCount, 7);
  assert.equal(audit.zeroMutatingStatements, true);
  assert.equal(audit.zeroRowSamples, true);
  const indexAudit = audit.queries.find((query) => query.queryId === 'postgresql.structure.indexes');
  assert.ok(indexAudit, 'the index query is audited');
  assert.equal(indexAudit.statementKind, 'SELECT');
  assert.ok(indexAudit.catalogSources.includes('PG_CATALOG.PG_INDEX'), 'the index query reads pg_catalog.pg_index');
  // A non-allowlisted index source is still denied by the same audit.
  assert.throws(() => auditCatalogQuery({
    engine: 'postgresql',
    queryId: 'postgresql.structure.unsafe-index',
    sql: 'SELECT indexrelid FROM pg_stat_user_indexes;',
  }), /DB_QUERY_ROW_SOURCE_DENIED/);
});

test('the v2 index query resolves key columns position- and expression-aware from pg_index.indkey', async () => {
  const inputs = await loadV2Inputs();
  const indexSql = inputs.sqlByQueryId['postgresql.structure.indexes'];
  // Each key position is resolved from the pg_index.indkey position vector, never from an
  // uncorrelated scan of every user column of the indexed relation. The subscript must be
  // the expansion's native 0-based vector offset (int2vector lower bound 0); using the
  // 1-based emitted key_ordinal directly would shift every key and drop the last one.
  const subscript = indexSql.match(/\bindkey\s*\[\s*([A-Za-z_][A-Za-z0-9_]*)\s*\]/i);
  assert.ok(subscript, 'the key columns are resolved positionally from pg_index.indkey');
  assert.notEqual(subscript[1], 'key_ordinal', 'the 1-based emitted ordinal is not used as the 0-based vector subscript');
  assert.match(indexSql, /attribute\.attrelid\s*=\s*index_row\.indrelid\s+AND\s+attribute\.attnum\s*=\s*index_row\.indkey/i);
  assert.doesNotMatch(indexSql, /attribute\.attnum\s*>\s*0/i);
  // The bounded ordinal expansion is capped at the index's key-attribute count...
  assert.match(indexSql, /key_ordinal_range\.key_ordinal\s*<=\s*index_row\.indnkeyatts/i);
  // ...and an expression key (indkey entry 0) LEFT JOINs to no attribute, so it is
  // disclosed as an explicit EXPRESSION row rather than a misnamed table column.
  assert.match(indexSql, /LEFT\s+JOIN\s+pg_catalog\.pg_attribute/i);
  assert.match(indexSql, /attribute\.attname\s+IS\s+NULL\s+THEN\s+'EXPRESSION'/i);
});

test('the v2 index key-ordinal expansion spans the full PostgreSQL 32-key attribute limit, never a silent prefix', async () => {
  const inputs = await loadV2Inputs();
  const indexSql = inputs.sqlByQueryId['postgresql.structure.indexes'];
  // The ordinal expansion must enumerate exactly the contiguous 1..32 range: PostgreSQL's
  // hard limit on index key attributes (indnkeyatts <= 32). Any smaller expansion would
  // silently truncate wide composite keys, and any gap or duplicate would misorder them,
  // so neither "exactly N key columns" nor "N shown of more" can be inferred either way.
  // Each emitted 1-based key ordinal must also carry its native 0-based indkey vector
  // offset, because int2vector's lower bound is 0 (REL_17_0 adt/int.c buildint2vector).
  const expansion = indexSql.match(/CROSS JOIN \(VALUES([\s\S]*?)\)\s+AS\s+key_ordinal_range\s*\(([^)]*)\)/i);
  assert.ok(expansion, 'the key ordinal expansion is an explicit bounded VALUES list');
  const tuples = [...expansion[1].matchAll(/\(\s*(\d+)\s*(?:,\s*(\d+))?\s*\)/g)]
    .map((match) => [Number(match[1]), match[2] === undefined ? null : Number(match[2])]);
  assert.equal(tuples.length, 32, 'the expansion spans all 32 key positions');
  assert.deepEqual(tuples.map(([ordinal]) => ordinal), Array.from({ length: 32 }, (_unused, offset) => offset + 1));
  const offsets = tuples.map(([, vectorOffset]) => vectorOffset);
  assert.ok(offsets.every((offset) => Number.isInteger(offset)),
    'each emitted ordinal carries its native 0-based indkey vector offset');
  assert.deepEqual(offsets, Array.from({ length: 32 }, (_unused, offset) => offset));
  // The expansion stays row-budget bounded by the index's own key-attribute count.
  assert.match(indexSql, /key_ordinal_range\.key_ordinal\s*<=\s*index_row\.indnkeyatts/i);
});

test('the emitted v2 index query mapping resolves native int2vector key positions against independent catalog data', async () => {
  const inputs = await loadV2Inputs();
  const mapping = interpretEmittedIndexMapping(inputs.sqlByQueryId['postgresql.structure.indexes']);
  // The emitted key ordinal stays 1-based and is the row-order key of the query...
  assert.equal(mapping.sortKeys.at(-1), `key_ordinal_range.${mapping.emittedColumn}`);
  // ...while the native int2vector (lower bound 0) is subscripted through the expansion's
  // own offset column, never through the emitted ordinal itself.
  assert.notEqual(mapping.offsetColumn, mapping.emittedColumn);
  // Independently specified native catalog state (pg_index.indkey as a 0-based vector plus
  // the relation attributes), not the materialized fixture rows.
  const syntheticIndexes = [
    {
      // Single key: first key is the last key; a shifted or out-of-range offset reads
      // NULL and the only key disappears.
      caseId: 'single-key first/last',
      indkey: [1],
      indnkeyatts: 1,
      attributes: new Map([[1, {name: 'id', type: 'int8'}]]),
      expected: [[1, 'id', 'COLUMN', 'int8']],
    },
    {
      // Composite: first and last keys resolve to their own positions, not shifted.
      caseId: 'composite first/last',
      indkey: [2, 4],
      indnkeyatts: 2,
      attributes: new Map([[2, {name: 'customer_id', type: 'int8'}], [4, {name: 'status', type: 'text'}]]),
      expected: [[1, 'customer_id', 'COLUMN', 'int8'], [2, 'status', 'COLUMN', 'text']],
    },
    {
      // Expression key: the indkey entry 0 stays an explicit EXPRESSION row and the
      // following real key keeps its own position.
      caseId: 'expression plus column',
      indkey: [0, 3],
      indnkeyatts: 2,
      attributes: new Map([[3, {name: 'created_at', type: 'timestamp'}]]),
      expected: [[1, null, 'EXPRESSION', null], [2, 'created_at', 'COLUMN', 'timestamp']],
    },
    {
      // One key plus an INCLUDE column: indkey holds both entries but indnkeyatts bounds
      // the key count; the INCLUDE column must never replace a real key.
      caseId: 'key plus include column',
      indkey: [1, 2],
      indnkeyatts: 1,
      attributes: new Map([[1, {name: 'id', type: 'int8'}], [2, {name: 'email', type: 'text'}]]),
      expected: [[1, 'id', 'COLUMN', 'int8']],
    },
    {
      // 32-key boundary: every ordinal 1..32 pins its own 0-based offset through distinct
      // attribute numbers; any shifted offset drops or duplicates a key.
      caseId: 'thirty-two key boundary',
      indkey: Array.from({length: 32}, (_unused, offset) => offset + 1),
      indnkeyatts: 32,
      attributes: new Map(Array.from({length: 32}, (_unused, offset) => [offset + 1, {name: `key_column_${offset + 1}`, type: 'int8'}])),
      expected: Array.from({length: 32}, (_unused, offset) => [offset + 1, `key_column_${offset + 1}`, 'COLUMN', 'int8']),
    },
  ];
  for (const syntheticIndex of syntheticIndexes) {
    assert.deepEqual(
      resolveSyntheticIndexKeys(mapping, syntheticIndex),
      syntheticIndex.expected,
      syntheticIndex.caseId,
    );
  }
});

test('a six-key composite unique index is read back with every key column in ordinal order', async () => {
  const evidence = await runAnalyzeProfile(`${fixtureDirectory}/postgresql-structure-profile-v2.json`, {
    repositoryRoot: 'services/bi-control',
  });
  const indexExtract = evidence.extracts.find((entry) => entry.category === 'indexes');
  // A composite unique index wider than any legacy ordinal cap must be represented with
  // all of its key columns, in order, not a truncated prefix.
  const wideKey = indexExtract.rows
    .filter((row) => row.index_name === 'settlements_source_key')
    .map((row) => [row.key_ordinal, row.key_column_name, row.key_column_kind, row.data_type]);
  assert.deepEqual(wideKey, [
    [1, 'settlement_id', 'COLUMN', 'int8'],
    [2, 'source_ref', 'COLUMN', 'text'],
    [3, 'account_ref', 'COLUMN', 'text'],
    [4, 'period_code', 'COLUMN', 'text'],
    [5, 'amount', 'COLUMN', 'numeric'],
    [6, 'version', 'COLUMN', 'int8'],
  ]);
  const wideFlags = indexExtract.rows.filter((row) => row.index_name === 'settlements_source_key');
  assert.ok(wideFlags.every((row) => row.is_unique === true && row.is_primary === false && row.is_valid === true));
});

test('PostgreSQL v2 index snapshot bytes are stable across index row order', async () => {
  const inputs = await loadV2Inputs();
  const first = build(inputs);
  const reordered = clone(inputs.resultSets);
  reordered.results['postgresql.structure.indexes'].rows = [...reordered.results['postgresql.structure.indexes'].rows].reverse();
  const rebuilt = build({...inputs, resultSets: reordered});
  assert.equal(renderAnalyzeEvidence(rebuilt), renderAnalyzeEvidence(first));
  assert.equal(rebuilt.snapshotSha256, first.snapshotSha256);
});

test('denied PostgreSQL v2 index metadata stays explicit DENIED, never coerced to empty success', async () => {
  const inputs = await loadV2Inputs();
  const denied = clone(inputs.resultSets);
  denied.results['postgresql.structure.indexes'] = { state: 'DENIED', reasonCode: 'PG_INDEX_VISIBILITY_DENIED', rows: [] };
  const evidence = build({...inputs, resultSets: denied});
  const indexExtract = evidence.extracts.find((entry) => entry.category === 'indexes');
  assert.equal(indexExtract.state, 'DENIED');
  assert.notEqual(indexExtract.state, 'SUCCEEDED');
  assert.equal(indexExtract.visibility, 'INVISIBLE');
  assert.equal(indexExtract.emptyInterpretation, 'NOT_CLAIMED');
  assert.equal(indexExtract.rows.length, 0);
  assert.equal(evidence.coverageLedger.allComplete, false);
  assert.ok(evidence.blindSpots.some((entry) => entry.queryId === 'postgresql.structure.indexes'
    && entry.coverageState === 'DENIED'));
});

test('missing PostgreSQL v2 index catalog rows stay explicit PARTIAL, never verified empty', async () => {
  const inputs = await loadV2Inputs();
  const evidence = build({...inputs, resultSets: inputs.incompleteResultSets});
  const indexExtract = evidence.extracts.find((entry) => entry.category === 'indexes');
  assert.equal(indexExtract.state, 'PARTIAL');
  assert.equal(indexExtract.visibility, 'VISIBLE_PARTIAL');
  assert.equal(indexExtract.emptyInterpretation, 'NOT_CLAIMED');
  assert.equal(evidence.coverageLedger.allComplete, false);
  assert.ok(evidence.blindSpots.some((entry) => entry.queryId === 'postgresql.structure.indexes'
    && entry.coverageState === 'PARTIAL'));
});

test('out-of-scope and substituted PostgreSQL v2 index metadata fail closed', async () => {
  const inputs = await loadV2Inputs();
  assert.equal(inputs.negativeCases.schemaVersion, 'kaleidosphere.db/postgresql-structure-negative-cases/v1');
  for (const negativeCase of inputs.negativeCases.cases) {
    const resultSets = clone(inputs.resultSets);
    resultSets.results[negativeCase.queryId].rows = [negativeCase.row];
    assert.throws(() => build({...inputs, resultSets}), new RegExp(negativeCase.expectedError), negativeCase.caseId);
  }
});

test('a missing PostgreSQL v2 index query result is tampered, never dropped or inferred', async () => {
  const inputs = await loadV2Inputs();
  const tampered = clone(inputs.resultSets);
  delete tampered.results['postgresql.structure.indexes'];
  assert.throws(() => build({...inputs, resultSets: tampered}), /DB_QUERY_RESULT_SET_TAMPERED/);
});
