// ERV-KS-AC01/AC02/AC05 — optional local-synthetic ERV JSON consumption: the
// read-only, digest-bound source adapter and the independent metric oracle.
//
// The standalone ERV core (PAN375, `chimpmaera.incoming-invoice/erv-analytics-pack/v1`)
// ships a frozen, privacy-minimized, prebuilt aggregate pack `ErvAnalyticsPackV1`. This
// consumer OPTIONALLY ingests that exact versioned JSON through a read-only, digest-bound
// adapter and re-derives the pack's internal digest chain with an INDEPENDENT oracle —
// using only the pack's own structure (its metric rows, table rows, catalog, config,
// binding) and never importing the raw AP03/AP04 receipt rows. A genuine pack re-derives
// with exact parity; any tamper, drift, leakage, or substitution fails closed.
//
// The adapter grants no posting, approval, execution or query authority (authority stays
// all-false, mirroring the pack) and keeps KaleidoSphere ownership separate from the
// PANSPHAIRA pack schema it consumes. The standalone package remains fully useful without
// this consumer; nothing here gates it.

import { createHash } from 'node:crypto';

import { canonicalJson } from '../canonical-json.js';

export const ERV_ANALYTICS_SOURCE_SCHEMA =
  'kaleidosphere.business-bi/erv-analytics-source/v1';
export const PACK_SCHEMA = 'chimpmaera.incoming-invoice/erv-analytics-pack/v1';
export const PACK_VERSION = '1.0.0';
export const PACK_TASK_ID = 'PS365-ERV-ANALYTICS-PACK-01';
export const PACK_SCOPE = 'PREBUILT_AGGREGATE_ANALYSIS';
export const EMPTY_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

// AC02 — the closed, predefined analysis / dashboard catalog. These six frozen
// definitions (IDs, versions, formulas, units, dimensions, denominators, UNKNOWN handling
// and applicability) are the exact catalog the PAN375 generator embeds; the adapter
// rejects any pack whose catalog differs (formula or dimension drift).
export const ERV_ANALYTICS_METRIC_CATALOG = Object.freeze([
  Object.freeze({
    metricId: 'ERV_EXTRACTION_OUTCOMES_V1',
    metricVersion: '1.0.0',
    analysis: 1,
    title: 'Intake / extraction outcome counts',
    sourceReceipt: 'AP03_EXTRACTION_RECEIPT_V1',
    formula: 'per system in {baseline, boundedSyntheticModel}: COUNT(cases) by validation outcome in {VALID, REJECTED}; total = denominators.disposition',
    dimensions: Object.freeze(['system:outcome']),
    denominator: Object.freeze({ basis: 'extraction_case_count', expected: 5 }),
    unknownHandling: 'REJECTED dispositions (extraction errors) are counted explicitly, never dropped or coerced to VALID',
    units: 'count',
    applicability: 'APPLIES_WHEN_AP03_EXTRACTION_RECEIPT_RELEASED',
  }),
  Object.freeze({
    metricId: 'ERV_FIELD_COMPLETENESS_ERRORS_V1',
    metricVersion: '1.0.0',
    analysis: 2,
    title: 'Field completeness + extraction error distribution',
    sourceReceipt: 'AP03_EXTRACTION_RECEIPT_V1',
    formula: 'per field dimension in {layout,lineItems,taxes,totals}: completeness = denominators[dimension] (correctly extracted cases); error distribution = COUNT(errors) grouped by error dimension',
    dimensions: Object.freeze(['dimension:completeness', 'dimension:errors']),
    denominator: Object.freeze({ basis: 'extraction_case_count', expected: 5 }),
    unknownHandling: 'dimensions absent from a rejected document are tallied as incomplete, never imputed; every extraction error is counted by dimension',
    units: 'count',
    applicability: 'APPLIES_WHEN_AP03_EXTRACTION_RECEIPT_RELEASED',
  }),
  Object.freeze({
    metricId: 'ERV_MATCH_OUTCOME_TOLERANCE_V1',
    metricVersion: '1.0.0',
    analysis: 3,
    title: 'Two-/three-way match outcome + tolerance-use rates',
    sourceReceipt: 'AP04_ERV_CORE_V1',
    formula: 'match: COUNT(decision) by matchingMode x outcome; tolerance: COUNT(decision) by tolerancePolicyId; rate = count / decisionCount (denominator provided)',
    dimensions: Object.freeze(['matchingMode:outcome', 'tolerancePolicyId']),
    denominator: Object.freeze({ basis: 'decision_count', expected: null }),
    unknownHandling: 'requested tolerance variants absent from the released registry are reported as a PARTIAL ADAPTED row, never dropped',
    units: 'count',
    applicability: 'APPLIES_WHEN_AP04_CORE_RELEASED',
  }),
  Object.freeze({
    metricId: 'ERV_EXCEPTION_REASON_DISTRIBUTION_V1',
    metricVersion: '1.0.0',
    analysis: 4,
    title: 'Exception / reason-code distribution',
    sourceReceipt: 'AP04_ERV_CORE_V1',
    formula: 'COUNT(decision) by exceptionCode (EXCEPTION) union reasonCode (DENIED)',
    dimensions: Object.freeze(['code']),
    denominator: Object.freeze({ basis: 'exception_denied_count', expected: null }),
    unknownHandling: 'codes outside the frozen vocabulary deny the metric (FORMULA_DRIFT)',
    units: 'count',
    applicability: 'APPLIES_WHEN_AP04_CORE_RELEASED',
  }),
  Object.freeze({
    metricId: 'ERV_APPROVAL_WORKLOAD_AMOUNT_BANDS_V1',
    metricVersion: '1.0.0',
    analysis: 5,
    title: 'Approval-workload counts + amount bands (no party/invoice identity)',
    sourceReceipt: 'AP04_ERV_CORE_V1',
    formula: 'workload: COUNT(decision) by {auto:matched=MATCHED, review:required=CONFLICT|EXCEPTION|DENIED}; bands: COUNT(MATCHED|CONFLICT) by representative amount (matchedAmountMinor | conflict.maxAmountMinor) into closed bands',
    dimensions: Object.freeze(['workloadBucket', 'amountBand']),
    denominator: Object.freeze({ basis: 'decision_count', expected: null }),
    unknownHandling: 'EXCEPTION/DENIED decisions have no representative amount and are excluded from amount bands; no supplier or invoice identity is emitted',
    units: 'count',
    applicability: 'APPLIES_WHEN_AP04_CORE_RELEASED',
  }),
  Object.freeze({
    metricId: 'ERV_EVIDENCE_READBACK_VERDICT_V1',
    metricVersion: '1.0.0',
    analysis: 6,
    title: 'Evidence completeness + readback / verdict distribution',
    sourceReceipt: 'AP04_ERV_CORE_V1',
    formula: 'verdict: COUNT(decision) by outcome; evidence: SUM(verified citations) per verdict; readback: core deterministicReplay',
    dimensions: Object.freeze(['verdict', 'verdict:evidence:verified']),
    denominator: Object.freeze({ basis: 'decision_count', expected: null }),
    unknownHandling: 'unverified citations are tallied as unknown evidence, never as verified',
    units: 'count',
    applicability: 'APPLIES_WHEN_AP04_CORE_RELEASED',
  }),
]);

export const ERV_ANALYTICS_NONCLAIMS = Object.freeze([
  'NO_FINANCIAL_OR_ACCOUNTING_OPINION',
  'NO_ANOMALY_OR_FRAUD_CLAIM',
  'NO_PRODUCTION_DASHBOARD',
  'NO_ARBITRARY_QUERY',
  'NO_ERP_DEPENDENCY',
  'NO_EXTERNAL_PUBLICATION',
  'NO_BI_EXECUTION_AUTHORITY',
  'NO_PARTY_OR_INVOICE_IDENTITY',
  'NO_CUSTOMER_DATA_EVALUATED',
]);

export const ERV_ANALYTICS_AUTHORITY_KEYS = Object.freeze([
  'bookingAuthorityGranted',
  'productivePostingAuthorized',
  'systemOfRecord',
  'arbitraryQueryAllowed',
  'erpRequired',
  'externalPublication',
  'biExecutionAuthority',
  'financialOpinion',
  'fraudClaim',
]);

const PACK_KEYS = Object.freeze([
  'schemaVersion',
  'packVersion',
  'packId',
  'taskId',
  'scope',
  'scenario',
  'nonclaims',
  'authority',
  'receipts',
  'core',
  'metricCatalog',
  'config',
  'metrics',
  'binding',
  'projections',
  'packDigest',
]);
// Identity-leakage tokens for the public projections (mirrors the PAN375 oracle): any of
// these in the canonical serialization of the pack denies ingest (AC04).
const LEAKAGE_TOKENS = Object.freeze([
  'supplierId',
  'invoiceId',
  'referenceId',
  'customerId',
  'questionText',
  'credential',
  'password',
  'SYN-SUP',
  'INV-2026',
  'PO-2026',
  'RCV-2026',
]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

// The independent oracle's digest primitive: sha256 of the canonical JSON bytes (UTF-8),
// byte-identical to the PAN375 `sha256HexV1(canonicalJson(value))`.
function sha(value) {
  return sha256(canonicalJson(value));
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, allowed, required = allowed) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.every((key) => allowed.includes(key))
    && required.every((key) => keys.includes(key));
}

function cloneJson(value) {
  return JSON.parse(canonicalJson(value));
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function hasLeakage(value) {
  const serialized = canonicalJson(value);
  return LEAKAGE_TOKENS.some((token) => serialized.includes(token));
}

// AC03 — the independent metric oracle. Re-derives every stored digest from the pack's
// own structure (no raw receipt rows) and fails closed on any mismatch. The digest chain
// reproduces the PAN375 generator byte-for-byte, so a genuine pack re-derives with exact
// parity and a tampered/substituted pack cannot.
function rederive(pack) {
  for (const metric of pack.metrics) {
    const recomputed = sha({
      metricId: metric.metricId,
      metricVersion: metric.metricVersion,
      state: metric.state,
      reasonCode: metric.reasonCode,
      denominator: metric.denominator,
      rows: metric.rows,
    });
    if (recomputed !== metric.metricDigest) fail('ERV_METRIC_DIGEST_DENIED');
  }
  if (sha(pack.metrics) !== pack.binding.resultDigest) fail('ERV_RESULT_DIGEST_DENIED');
  if (sha(pack.config) !== pack.binding.configDigest) fail('ERV_CONFIG_DIGEST_DENIED');
  if (sha(pack.metricCatalog) !== pack.binding.metricCatalogDigest) {
    fail('ERV_METRIC_CATALOG_DIGEST_DENIED');
  }

  // Canonical projection: sha of the pack minus the projections and the pack digest.
  const unsigned = cloneJson(pack);
  delete unsigned.projections;
  delete unsigned.packDigest;
  if (pack.projections.canonical.format !== 'CANONICAL_JSON_V1') {
    fail('ERV_PROJECTION_SHAPE_DENIED');
  }
  if (sha(unsigned) !== pack.projections.canonical.digest) {
    fail('ERV_CANONICAL_PROJECTION_DIGEST_DENIED');
  }
  if (canonicalJson(pack.projections.canonical.binding) !== canonicalJson(pack.binding)) {
    fail('ERV_PROJECTION_BINDING_DENIED');
  }

  // TABLE projection: rows rebuilt from the metric rows + catalog (analysis per metricId)
  // must equal the stored rows, and their digest must match.
  const analysisById = new Map(pack.metricCatalog.map((entry) => [entry.metricId, entry.analysis]));
  const tableRows = [];
  for (const metric of pack.metrics) {
    for (const row of metric.rows) {
      tableRows.push({
        analysis: analysisById.get(metric.metricId),
        metricId: metric.metricId,
        dimension: row.dimension,
        value: row.value,
        state: metric.state,
        units: 'count',
      });
    }
  }
  if (pack.projections.table.format !== 'TABLE_V1') fail('ERV_PROJECTION_SHAPE_DENIED');
  if (canonicalJson(tableRows) !== canonicalJson(pack.projections.table.rows)) {
    fail('ERV_TABLE_ROWS_INCONSISTENT');
  }
  if (sha(tableRows) !== pack.projections.table.digest) {
    fail('ERV_TABLE_PROJECTION_DIGEST_DENIED');
  }
  if (canonicalJson(pack.projections.table.binding) !== canonicalJson(pack.binding)) {
    fail('ERV_PROJECTION_BINDING_DENIED');
  }

  // Pack digest: sha of the pack minus the pack digest field itself.
  const withoutDigest = cloneJson(pack);
  delete withoutDigest.packDigest;
  if (sha(withoutDigest) !== pack.packDigest) fail('ERV_PACK_DIGEST_DENIED');

  return Object.freeze({
    digestsReverified: true,
    tableRowsConsistent: true,
    parity: true,
    metricDigestsReverified: pack.metrics.length,
  });
}

// The binding must agree with the pack's own receipt identities and core readback.
function receiptBindingConsistent(pack) {
  if (!Array.isArray(pack.receipts) || pack.receipts.length !== 2) return false;
  const ap03 = pack.receipts.find((receipt) => receipt.receiptId === 'AP03_EXTRACTION_RECEIPT_V1');
  const ap04 = pack.receipts.find((receipt) => receipt.receiptId === 'AP04_ERV_CORE_V1');
  if (!ap03 || !ap04) return false;
  if (!isSha256(ap03.identity?.sha256) || !isSha256(ap04.identity?.sha256)) return false;
  if (!isSha256(pack.core?.decisionDigest)) return false;
  if (pack.core?.deterministicReplay !== true) return false;
  if (pack.binding.ap03ReceiptSha256 !== ap03.identity.sha256) return false;
  if (pack.binding.ap04CoreDigest !== pack.core.decisionDigest) return false;
  return true;
}

// AC01 — ingest only the exact versioned pack, read-only and digest-bound. `input.source`
// is the UTF-8 file text; it must be the exact canonical serialization (+ trailing
// newline) of a closed, all-false-authority pack whose digest chain re-derives.
export function verifyErvAnalyticsSource(input) {
  if (!exactKeys(input, ['source'])) fail('ERV_SOURCE_INPUT_DENIED');
  const source = input.source;
  if (typeof source !== 'string') fail('ERV_SOURCE_TYPE_DENIED');
  let pack;
  try {
    pack = JSON.parse(source);
  } catch {
    fail('ERV_SOURCE_PARSE_DENIED');
  }
  if (!isPlainObject(pack)) fail('ERV_SOURCE_PARSE_DENIED');
  // Digest-bound: the ingested bytes are exactly the canonical serialization.
  if (source !== `${canonicalJson(pack)}\n`) fail('ERV_SOURCE_NOT_CANONICAL');
  // AC04 — closed shape (no raw rows / smuggled top-level fields).
  if (!exactKeys(pack, PACK_KEYS)) fail('ERV_PACK_SHAPE_DENIED');
  // AC04 — exact product / version / task / scope.
  if (pack.schemaVersion !== PACK_SCHEMA
    || pack.packVersion !== PACK_VERSION
    || pack.taskId !== PACK_TASK_ID
    || pack.scope !== PACK_SCOPE) fail('ERV_PRODUCT_VERSION_DENIED');
  // AC05 — authority stays closed and all-false.
  if (!exactKeys(pack.authority, ERV_ANALYTICS_AUTHORITY_KEYS)) fail('ERV_AUTHORITY_DENIED');
  for (const key of ERV_ANALYTICS_AUTHORITY_KEYS) {
    if (pack.authority[key] !== false) fail('ERV_AUTHORITY_DENIED');
  }
  // AC04 — frozen nonclaims.
  if (canonicalJson(pack.nonclaims) !== canonicalJson(ERV_ANALYTICS_NONCLAIMS)) {
    fail('ERV_NONCLAIM_DENIED');
  }
  // AC04 — no party / invoice identity in any public projection.
  if (hasLeakage(pack)) fail('ERV_IDENTITY_LEAKAGE_DENIED');
  // AC02/AC04 — the predefined catalog is frozen (formula / dimension drift fails closed).
  if (canonicalJson(pack.metricCatalog) !== canonicalJson(ERV_ANALYTICS_METRIC_CATALOG)) {
    fail('ERV_CATALOG_DRIFT_DENIED');
  }
  // AC03 — the independent oracle re-derives the whole digest chain.
  const oracle = rederive(pack);
  if (!receiptBindingConsistent(pack)) fail('ERV_RECEIPT_BINDING_DENIED');

  return deepFreeze({
    schemaVersion: ERV_ANALYTICS_SOURCE_SCHEMA,
    type: 'ERV_ANALYTICS_PACK_SOURCE',
    packSchema: pack.schemaVersion,
    packVersion: pack.packVersion,
    taskId: pack.taskId,
    scope: pack.scope,
    scenario: pack.scenario,
    packId: pack.packId,
    fileSha256: sha256(source),
    packDigest: pack.packDigest,
    binding: cloneJson(pack.binding),
    nonclaims: [...ERV_ANALYTICS_NONCLAIMS],
    authority: Object.fromEntries(ERV_ANALYTICS_AUTHORITY_KEYS.map((key) => [key, false])),
    metricCatalog: cloneJson(pack.metricCatalog),
    metrics: cloneJson(pack.metrics),
    tableRows: cloneJson(pack.projections.table.rows),
    projections: {
      canonical: {
        format: pack.projections.canonical.format,
        digest: pack.projections.canonical.digest,
      },
      table: {
        format: pack.projections.table.format,
        digest: pack.projections.table.digest,
        rowCount: pack.projections.table.rows.length,
      },
    },
    oracle,
  });
}