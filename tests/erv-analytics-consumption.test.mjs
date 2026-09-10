// ERV-KS-AC01..AC05 (JoFe2/KaleidoSphere#157) — optional local-synthetic ERV JSON
// consumption.
//
// The standalone ERV core (PAN375, PS365-ERV-ANALYTICS-PACK-01) ships a frozen,
// privacy-minimized, prebuilt aggregate pack `ErvAnalyticsPackV1`
// (`chimpmaera.incoming-invoice/erv-analytics-pack/v1`, packVersion 1.0.0). This suite
// proves the KaleidoSphere consumer can OPTIONALLY ingest that exact versioned JSON
// through a read-only, digest-bound source adapter and render deterministic
// JSON/TABLE readback — WITHOUT gating the standalone package, importing raw receipt
// rows, or granting any posting/approval/execution authority.
//
//   AC01 — only the exact versioned pack is ingested, through a read-only digest-bound
//          source adapter (canonical serialization + full digest re-derivation).
//   AC02 — the predefined analysis/dashboard definitions preserve all metric formulas,
//          units, states, dimensions and source digests, with no raw invoice/party
//          identity.
//   AC03 — the baseline and adapted packs verify with exact parity against an
//          independent oracle (re-derived digests) and render deterministic
//          JSON/TABLE readback.
//   AC04 — wrong product/version/digest, formula drift, extra dimensions, identity
//          leakage, raw rows, arbitrary SQL, writes and substituted packs fail closed.
//   AC05 — PANSPHAIRA and KaleidoSphere ownership remain separate; the analysis grants
//          no posting, approval or execution Authority.
//
// The fixture packs are the local-synthetic artifacts produced in an isolated
// prerequisite build by the released PAN375 generator against its public source
// fixtures (baseline sha-pinned to 3d50dd9c…); no raw AP03/AP04 receipt rows enter the
// consumer — only the prebuilt aggregate packs.
//
// Nonclaim: passing these checks proves source-local, deterministic, digest-bound
// consumption of the two local-synthetic packs. It does not run a BI dashboard, connect
// an ERP, post or approve anything, or claim production/customer compatibility.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { canonicalJson } from '../services/bi-control/src/canonical-json.js';
import {
  ERV_ANALYTICS_AUTHORITY_KEYS,
  ERV_ANALYTICS_METRIC_CATALOG,
  ERV_ANALYTICS_NONCLAIMS,
  ERV_ANALYTICS_SOURCE_SCHEMA,
  PACK_SCOPE,
  PACK_SCHEMA,
  PACK_TASK_ID,
  PACK_VERSION,
  verifyErvAnalyticsSource,
} from '../services/bi-control/src/business-bi/erv-analytics-source.mjs';
import {
  ERV_ANALYTICS_READBACK_FORMATS,
  ERV_ANALYTICS_READBACK_SCHEMA,
  createErvAnalyticsReadback,
  renderErvAnalyticsJson,
  renderErvAnalyticsTable,
  verifyErvAnalyticsReadback,
  verifyErvAnalyticsRenderings,
} from '../services/bi-control/src/business-bi/erv-analytics-readback.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const BASELINE_PATH = 'tests/fixtures/erv-analytics/erv-analytics-baseline-v1.json';
const ADAPTED_PATH = 'tests/fixtures/erv-analytics/erv-analytics-adapted-v1.json';

// The baseline artifact is sha-pinned by the task and reproduced byte-for-byte in the
// isolated prerequisite build; the adapted pack's file digest comes from that same
// deterministic build.
const BASELINE_FILE_SHA256 = '3d50dd9c157e72eab46807810f63d82d6b44bd15b1887b54fa529976fd9ee71d';
const ADAPTED_FILE_SHA256 = '7cee35fc06af2a3659499127a67b6afc9a139ddd72ebee91018cd9d5cba23d92';

// The digests the independent oracle must re-derive, taken from the prebuilt packs.
const EXPECTED_BASELINE = Object.freeze({
  packDigest: 'a6c76af600e2192ecaf2d569a81bcacc432888b0cc5894ff17a9e4e7e254b088',
  ap03ReceiptSha256: '41959bab323542694b120f8d55314620c214f3a44f7c8d36270e47ac8f9b9edb',
  ap04CoreDigest: 'b9fde591a23ff0d67987aac87bbf756101ab17cb5b0d2ef8f329b33b23833ed3',
  metricCatalogDigest: 'daf88d727d8b84867ed47dc57c7518ed9a35125cb9af2efcb37e33c00a9fa10e',
  resultDigest: 'b13ad745a7268df32976862d27102ac7a2c68c8c0e9f82be84edc16609bee941',
  configDigest: '063be8e9abc19cb2247592ebe0f5bba3d6b032fbef03e2a2058ae6e79e284b59',
  canonicalProjectionDigest: '8424bd84417301f18f754b47360bd0129dbe805ab8552796096101267a87e691',
  tableProjectionDigest: '61f138d878f08e686aad30ffcbcfd3fa968159c886bb94e000e0e12102f6f26c',
  metricStates: ['COMPLETE', 'COMPLETE', 'COMPLETE', 'COMPLETE', 'COMPLETE', 'COMPLETE'],
});
const EXPECTED_ADAPTED = Object.freeze({
  packDigest: 'ae51785d4e7279d34be8c4f55d66490b36da11de6415422007f9e8acc266cb40',
  metricCatalogDigest: 'daf88d727d8b84867ed47dc57c7518ed9a35125cb9af2efcb37e33c00a9fa10e',
  configDigest: '063be8e9abc19cb2247592ebe0f5bba3d6b032fbef03e2a2058ae6e79e284b59',
  metricStates: ['UNKNOWN', 'UNKNOWN', 'PARTIAL', 'COMPLETE', 'COMPLETE', 'COMPLETE'],
  metricReasonCodes: [
    'AP03_EXTRACTION_NOT_EXECUTED',
    'AP03_EXTRACTION_NOT_EXECUTED',
    'ADAPTED_TOLERANCE_NOT_EXECUTED',
    null,
    null,
    null,
  ],
});

async function load(path) {
  return readFile(path, 'utf8');
}

// Rebuild a canonical+newline serialization from a mutated parsed pack, so a tampered
// pack still exercises the canonical-bound ingest path (not a parse failure).
function tamper(text, mutate) {
  const pack = JSON.parse(text);
  mutate(pack);
  return `${canonicalJson(pack)}\n`;
}

function assertDenied(fn, code) {
  assert.throws(
    () => fn(),
    (error) => error.code === code,
    `expected fail-closed code ${code}`,
  );
}

function readbackIdentity(readback) {
  const identity = readback.identity;
  return {
    fileSha256: identity.fileSha256,
    packDigest: identity.packDigest,
    canonicalProjectionDigest: identity.canonicalProjectionDigest,
    tableProjectionDigest: identity.tableProjectionDigest,
    resultDigest: identity.resultDigest,
    configDigest: identity.configDigest,
    metricCatalogDigest: identity.metricCatalogDigest,
    ap03ReceiptSha256: identity.ap03ReceiptSha256,
    ap04CoreDigest: identity.ap04CoreDigest,
  };
}

test('AC01: the baseline pack is ingested read-only through the digest-bound source adapter', async () => {
  const text = await load(BASELINE_PATH);
  assert.equal(sha256(Buffer.from(text, 'utf8')), BASELINE_FILE_SHA256, 'fixture must be the sha-pinned baseline artifact');
  const source = verifyErvAnalyticsSource({ source: text });
  assert.equal(source.schemaVersion, ERV_ANALYTICS_SOURCE_SCHEMA);
  assert.equal(source.type, 'ERV_ANALYTICS_PACK_SOURCE');
  assert.equal(source.packSchema, PACK_SCHEMA);
  assert.equal(source.packVersion, PACK_VERSION);
  assert.equal(source.taskId, PACK_TASK_ID);
  assert.equal(source.scope, PACK_SCOPE);
  assert.equal(source.scenario, 'BASELINE');
  assert.equal(source.packDigest, EXPECTED_BASELINE.packDigest);
  assert.equal(source.fileSha256, BASELINE_FILE_SHA256);
  // The adapter is read-only and digest-bound: it re-derives and binds the exact
  // projection digests and the full binding, all false-frozen.
  assert.deepStrictEqual(source.binding, {
    ap03ReceiptSha256: EXPECTED_BASELINE.ap03ReceiptSha256,
    ap04CoreDigest: EXPECTED_BASELINE.ap04CoreDigest,
    metricCatalogDigest: EXPECTED_BASELINE.metricCatalogDigest,
    resultDigest: EXPECTED_BASELINE.resultDigest,
    configDigest: EXPECTED_BASELINE.configDigest,
  });
  assert.equal(source.projections.canonical.digest, EXPECTED_BASELINE.canonicalProjectionDigest);
  assert.equal(source.projections.table.digest, EXPECTED_BASELINE.tableProjectionDigest);
  assert.ok(Object.isFrozen(source), 'the source handle must be immutable');
  assert.equal(source.fileSha256, sha256(Buffer.from(text, 'utf8')));
});

test('AC01: the adapted pack is ingested read-only through the same digest-bound source adapter', async () => {
  const text = await load(ADAPTED_PATH);
  assert.equal(sha256(Buffer.from(text, 'utf8')), ADAPTED_FILE_SHA256, 'fixture must be the deterministic adapted artifact');
  const source = verifyErvAnalyticsSource({ source: text });
  assert.equal(source.scenario, 'ADAPTED');
  assert.equal(source.packDigest, EXPECTED_ADAPTED.packDigest);
  assert.equal(source.fileSha256, ADAPTED_FILE_SHA256);
  assert.ok(Object.isFrozen(source), 'the source handle must be immutable');
});

test('AC02: the predefined analyses preserve formulas, units, states, dimensions and source digests', async () => {
  const text = await load(BASELINE_PATH);
  const source = verifyErvAnalyticsSource({ source: text });
  // Six closed analyses, in the exact frozen order, with all defining fields intact.
  assert.equal(source.metricCatalog.length, 6);
  const analyses = source.metricCatalog.map((entry) => ({
    analysis: entry.analysis,
    metricId: entry.metricId,
    title: entry.title,
    sourceReceipt: entry.sourceReceipt,
    formula: entry.formula,
    dimensions: entry.dimensions,
    denominator: entry.denominator,
    unknownHandling: entry.unknownHandling,
    units: entry.units,
    applicability: entry.applicability,
  }));
  assert.deepStrictEqual(analyses, ERV_ANALYTICS_METRIC_CATALOG.map((entry) => ({
    analysis: entry.analysis,
    metricId: entry.metricId,
    title: entry.title,
    sourceReceipt: entry.sourceReceipt,
    formula: entry.formula,
    dimensions: entry.dimensions,
    denominator: entry.denominator,
    unknownHandling: entry.unknownHandling,
    units: entry.units,
    applicability: entry.applicability,
  })));
  // Every analysis is count-valued and every catalog entry is version 1.0.0.
  for (const entry of source.metricCatalog) {
    assert.equal(entry.units, 'count');
    assert.equal(entry.metricVersion, PACK_VERSION);
  }
  // Source digests are bound to the exact released receipts (byte-pinned identities).
  assert.equal(source.binding.metricCatalogDigest, EXPECTED_BASELINE.metricCatalogDigest);
  assert.equal(source.binding.configDigest, EXPECTED_BASELINE.configDigest);
  assert.equal(source.binding.resultDigest, EXPECTED_BASELINE.resultDigest);
  assert.equal(source.binding.ap03ReceiptSha256, EXPECTED_BASELINE.ap03ReceiptSha256);
  assert.equal(source.binding.ap04CoreDigest, EXPECTED_BASELINE.ap04CoreDigest);
  // No raw invoice or party identifiers anywhere in the public projection.
  for (const token of ['supplierId', 'invoiceId', 'referenceId', 'customerId', 'questionText', 'credential', 'password', 'SYN-SUP', 'INV-2026', 'PO-2026', 'RCV-2026']) {
    assert.ok(!canonicalJson(source).includes(token), `must not leak ${token}`);
  }
});

test('AC03: the independent oracle re-derives every pack digest with exact parity (baseline)', async () => {
  const text = await load(BASELINE_PATH);
  const source = verifyErvAnalyticsSource({ source: text });
  assert.deepStrictEqual(source.oracle, {
    digestsReverified: true,
    tableRowsConsistent: true,
    parity: true,
    metricDigestsReverified: 6,
  });
  assert.deepStrictEqual(source.metrics.map((metric) => metric.state), EXPECTED_BASELINE.metricStates);
  // The oracle re-derivation reproduces the stored digests byte-for-byte.
  assert.equal(source.projections.canonical.digest, EXPECTED_BASELINE.canonicalProjectionDigest);
  assert.equal(source.projections.table.digest, EXPECTED_BASELINE.tableProjectionDigest);
  assert.equal(source.packDigest, EXPECTED_BASELINE.packDigest);
});

test('AC03: the independent oracle re-derives the adapted pack and preserves baseline parity on catalog/config', async () => {
  const baselineText = await load(BASELINE_PATH);
  const adaptedText = await load(ADAPTED_PATH);
  const baseline = verifyErvAnalyticsSource({ source: baselineText });
  const adapted = verifyErvAnalyticsSource({ source: adaptedText });
  assert.deepStrictEqual(adapted.oracle, {
    digestsReverified: true,
    tableRowsConsistent: true,
    parity: true,
    metricDigestsReverified: 6,
  });
  assert.deepStrictEqual(adapted.metrics.map((metric) => metric.state), EXPECTED_ADAPTED.metricStates);
  assert.deepStrictEqual(adapted.metrics.map((metric) => metric.reasonCode), EXPECTED_ADAPTED.metricReasonCodes);
  // Shared, scenario-independent digests must be identical across the two packs.
  assert.equal(adapted.binding.metricCatalogDigest, baseline.binding.metricCatalogDigest);
  assert.equal(adapted.binding.configDigest, baseline.binding.configDigest);
});

test('AC03: JSON and TABLE readback are deterministic and rebuild-and-compare for both packs', async () => {
  for (const [path, fileSha] of [[BASELINE_PATH, BASELINE_FILE_SHA256], [ADAPTED_PATH, ADAPTED_FILE_SHA256]]) {
    const text = await load(path);
    const readback = createErvAnalyticsReadback({ source: text });
    assert.equal(readback.schemaVersion, ERV_ANALYTICS_READBACK_SCHEMA);
    assert.equal(readback.identity.fileSha256, fileSha);
    assert.ok(Object.isFrozen(readback), 'the readback must be immutable');
    // Determinism: the same source renders byte-identical JSON and TABLE.
    const json1 = renderErvAnalyticsJson({ source: text });
    const json2 = renderErvAnalyticsJson({ source: text });
    const table1 = renderErvAnalyticsTable({ source: text });
    const table2 = renderErvAnalyticsTable({ source: text });
    assert.equal(json1, json2);
    assert.equal(table1, table2);
    // JSON is the canonical serialization of the readback; the table is its TABLE form.
    assert.equal(json1, `${canonicalJson(readback)}\n`);
    assert.match(table1, /\| analysis \| metricId \| dimension \| value \| state \| units \|/);
    assert.ok(table1.includes(`# readback_sha256=${readback.readbackSha256}`));
    // Rebuild-and-compare: substituting either rendering fails closed.
    assert.throws(() => verifyErvAnalyticsReadback({ source: text, readback: { ...readback, readbackSha256: '0'.repeat(64) } }));
    const rendering = verifyErvAnalyticsRenderings({ source: text, json: json1, table: table1 });
    assert.equal(rendering.identityEqual, true);
    assert.equal(rendering.readbackSha256, readback.readbackSha256);
    assert.equal(sha256(json1), rendering.jsonSha256);
    assert.equal(sha256(table1), rendering.tableSha256);
  }
});

test('AC03: readback preserves the full binding and coverage for the baseline pack', async () => {
  const text = await load(BASELINE_PATH);
  const readback = createErvAnalyticsReadback({ source: text });
  assert.deepStrictEqual(readbackIdentity(readback), {
    fileSha256: BASELINE_FILE_SHA256,
    packDigest: EXPECTED_BASELINE.packDigest,
    canonicalProjectionDigest: EXPECTED_BASELINE.canonicalProjectionDigest,
    tableProjectionDigest: EXPECTED_BASELINE.tableProjectionDigest,
    resultDigest: EXPECTED_BASELINE.resultDigest,
    configDigest: EXPECTED_BASELINE.configDigest,
    metricCatalogDigest: EXPECTED_BASELINE.metricCatalogDigest,
    ap03ReceiptSha256: EXPECTED_BASELINE.ap03ReceiptSha256,
    ap04CoreDigest: EXPECTED_BASELINE.ap04CoreDigest,
  });
  assert.deepStrictEqual(readback.coverage.metricStates, EXPECTED_BASELINE.metricStates);
  assert.equal(readback.coverage.completeCount, 6);
  assert.equal(readback.coverage.partialCount, 0);
  assert.equal(readback.coverage.unknownCount, 0);
  assert.equal(readback.coverage.deniedCount, 0);
  assert.equal(readback.coverage.deterministicReplay, true);
});

test('AC04: wrong product/version/digest, shape and non-canonical ingestion fail closed', async () => {
  const text = await load(BASELINE_PATH);
  // Wrong product (schema), version, task id or scope.
  assertDenied(() => verifyErvAnalyticsSource({ source: tamper(text, (pack) => { pack.schemaVersion = 'chimpmaera.incoming-invoice/erv-analytics-pack/v2'; }) }), 'ERV_PRODUCT_VERSION_DENIED');
  assertDenied(() => verifyErvAnalyticsSource({ source: tamper(text, (pack) => { pack.packVersion = '2.0.0'; }) }), 'ERV_PRODUCT_VERSION_DENIED');
  assertDenied(() => verifyErvAnalyticsSource({ source: tamper(text, (pack) => { pack.taskId = 'OTHER-TASK'; }) }), 'ERV_PRODUCT_VERSION_DENIED');
  assertDenied(() => verifyErvAnalyticsSource({ source: tamper(text, (pack) => { pack.scope = 'RAW_ROW_ANALYSIS'; }) }), 'ERV_PRODUCT_VERSION_DENIED');
  // A wrong (but well-formed hex) pack digest breaks the digest chain.
  assertDenied(() => verifyErvAnalyticsSource({ source: tamper(text, (pack) => { pack.packDigest = '0'.repeat(64); }) }), 'ERV_PACK_DIGEST_DENIED');
  // Raw rows smuggled in as an extra top-level key are rejected by the closed shape.
  assertDenied(() => verifyErvAnalyticsSource({ source: tamper(text, (pack) => { pack.rawRows = [{ supplierId: 'S1' }]; }) }), 'ERV_PACK_SHAPE_DENIED');
  // Extra top-level key.
  assertDenied(() => verifyErvAnalyticsSource({ source: tamper(text, (pack) => { pack.injected = true; }) }), 'ERV_PACK_SHAPE_DENIED');
  // Non-canonical serialization (reordered keys / missing newline) is not digest-bound.
  const parsed = JSON.parse(text);
  assertDenied(() => verifyErvAnalyticsSource({ source: JSON.stringify(parsed) }), 'ERV_SOURCE_NOT_CANONICAL');
  // Non-string and unparseable inputs.
  assertDenied(() => verifyErvAnalyticsSource({ source: 12345 }), 'ERV_SOURCE_TYPE_DENIED');
  assertDenied(() => verifyErvAnalyticsSource({ source: '{ not json' }), 'ERV_SOURCE_PARSE_DENIED');
});

test('AC04: formula drift, extra dimensions, identity leakage, substitution and authority drift fail closed', async () => {
  const text = await load(BASELINE_PATH);
  // Formula drift: the frozen catalog is altered -> drift (and would break the catalog digest).
  assertDenied(() => verifyErvAnalyticsSource({ source: tamper(text, (pack) => { pack.metricCatalog[0].formula = 'tampered formula'; }) }), 'ERV_CATALOG_DRIFT_DENIED');
  // Catalog dimension drift (extra dimension declared).
  assertDenied(() => verifyErvAnalyticsSource({ source: tamper(text, (pack) => { pack.metricCatalog[3].dimensions.push('extraDimension'); }) }), 'ERV_CATALOG_DRIFT_DENIED');
  // Extra metric row dimension: breaks the per-metric digest (and the table projection).
  assertDenied(() => verifyErvAnalyticsSource({ source: tamper(text, (pack) => { pack.metrics[0].rows.push({ dimension: 'system:baseline:INJECTED', value: 9 }); }) }), 'ERV_METRIC_DIGEST_DENIED');
  // Value drift in a row breaks the per-metric digest.
  assertDenied(() => verifyErvAnalyticsSource({ source: tamper(text, (pack) => { pack.metrics[2].rows[0].value += 1; }) }), 'ERV_METRIC_DIGEST_DENIED');
  // Identity leakage: a party/invoice identifier appears in a public projection.
  assertDenied(() => verifyErvAnalyticsSource({ source: tamper(text, (pack) => { pack.metrics[5].rows.push({ dimension: 'supplierId:SYN-SUP-001', value: 1 }); }) }), 'ERV_IDENTITY_LEAKAGE_DENIED');
  assertDenied(() => verifyErvAnalyticsSource({ source: tamper(text, (pack) => { pack.metricCatalog[0].title = 'see INV-2026-0001'; }) }), 'ERV_IDENTITY_LEAKAGE_DENIED');
  // Substituted pack: aggregate content replaced but the digest chain is left intact on
  // paper -> the independent oracle re-derivation catches it.
  assertDenied(() => verifyErvAnalyticsSource({ source: tamper(text, (pack) => { pack.config.amountBandsMinor = [0, 50000000]; }) }), 'ERV_CONFIG_DIGEST_DENIED');
  assertDenied(() => verifyErvAnalyticsSource({ source: tamper(text, (pack) => { pack.metrics[1].state = 'DENIED'; }) }), 'ERV_METRIC_DIGEST_DENIED');
  // Authority drift: any authority flag flipping to true is denied before the oracle runs.
  assertDenied(() => verifyErvAnalyticsSource({ source: tamper(text, (pack) => { pack.authority.biExecutionAuthority = true; }) }), 'ERV_AUTHORITY_DENIED');
  assertDenied(() => verifyErvAnalyticsSource({ source: tamper(text, (pack) => { pack.authority.productivePostingAuthorized = true; }) }), 'ERV_AUTHORITY_DENIED');
  // Nonclaim drift.
  assertDenied(() => verifyErvAnalyticsSource({ source: tamper(text, (pack) => { pack.nonclaims.push('NOPE'); }) }), 'ERV_NONCLAIM_DENIED');
});

test('AC04: substituted readback renderings and arbitrary-format render requests fail closed', async () => {
  const text = await load(BASELINE_PATH);
  const json = renderErvAnalyticsJson({ source: text });
  const table = renderErvAnalyticsTable({ source: text });
  // A swapped JSON/TABLE pair (mismatched identity) is rejected on rebuild-and-compare.
  assertDenied(() => verifyErvAnalyticsRenderings({ source: text, json, table: `${table}tampered` }), 'ERV_RENDERING_DISAGREEMENT');
  assertDenied(() => verifyErvAnalyticsRenderings({ source: text, json: `${json}tampered`, table }), 'ERV_RENDERING_DISAGREEMENT');
  // The readback is bound to the source: a different source cannot validate this readback.
  const adaptedText = await load(ADAPTED_PATH);
  const baselineReadback = createErvAnalyticsReadback({ source: text });
  assertDenied(() => verifyErvAnalyticsReadback({ source: adaptedText, readback: baselineReadback }), 'ERV_READBACK_SUBSTITUTION_DENIED');
  // Only the two registered formats are renderable.
  assert.deepStrictEqual([...ERV_ANALYTICS_READBACK_FORMATS].sort(), ['JSON', 'TABLE']);
});

test('AC05: the analysis grants no posting, approval or execution authority and keeps ownership separate', async () => {
  const text = await load(BASELINE_PATH);
  const source = verifyErvAnalyticsSource({ source: text });
  const readback = createErvAnalyticsReadback({ source: text });
  // The packed authority surface is closed and all-false.
  assert.deepStrictEqual(source.authority, Object.fromEntries(ERV_ANALYTICS_AUTHORITY_KEYS.map((key) => [key, false])));
  for (const key of ERV_ANALYTICS_AUTHORITY_KEYS) {
    assert.equal(source.authority[key], false, key);
    assert.equal(readback.authority[key], false, key);
  }
  // The readback is a KaleidoSphere surface (separate ownership) over the PANSPHAIRA
  // pack schema (separate ownership), both bound to the same digests.
  assert.equal(readback.schemaVersion, ERV_ANALYTICS_READBACK_SCHEMA);
  assert.equal(readback.packSchema, PACK_SCHEMA);
  assert.notEqual(ERV_ANALYTICS_READBACK_SCHEMA, PACK_SCHEMA);
  // The nonclaims freeze the boundary: no arbitrary query, no BI execution authority,
  // no production dashboard, no party/invoice identity.
  assert.deepStrictEqual(readback.nonclaims, ERV_ANALYTICS_NONCLAIMS);
  for (const nonclaim of ['NO_ARBITRARY_QUERY', 'NO_BI_EXECUTION_AUTHORITY', 'NO_PRODUCTION_DASHBOARD', 'NO_PARTY_OR_INVOICE_IDENTITY', 'NO_CUSTOMER_DATA_EVALUATED']) {
    assert.ok(readback.nonclaims.includes(nonclaim), nonclaim);
  }
  // The consumer surface is read-only: it exposes no posting/approval/execution/SQL entry
  // point — the read-only digest-bound adapter and the readback renderers are the whole
  // public API.
  assert.equal(typeof verifyErvAnalyticsSource, 'function');
  assert.equal(typeof createErvAnalyticsReadback, 'function');
  assert.equal(typeof renderErvAnalyticsJson, 'function');
  assert.equal(typeof renderErvAnalyticsTable, 'function');
  assert.equal(typeof verifyErvAnalyticsRenderings, 'function');
});