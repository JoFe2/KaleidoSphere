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
  // Each key ordinal is resolved from the pg_index.indkey position vector, never from an
  // uncorrelated scan of every user column of the indexed relation.
  assert.match(indexSql, /\bindkey\s*\[\s*key_ordinal\s*\]/i);
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
  const expansion = indexSql.match(/CROSS JOIN \(VALUES([\s\S]*?)\)\s+AS\s+key_ordinal_range/i);
  assert.ok(expansion, 'the key ordinal expansion is an explicit bounded VALUES list');
  const ordinals = [...expansion[1].matchAll(/\(\s*(\d+)\s*\)/g)].map((match) => Number(match[1]));
  assert.deepEqual(ordinals, Array.from({ length: 32 }, (_, offset) => offset + 1));
  // The expansion stays row-budget bounded by the index's own key-attribute count.
  assert.match(indexSql, /key_ordinal_range\.key_ordinal\s*<=\s*index_row\.indnkeyatts/i);
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
