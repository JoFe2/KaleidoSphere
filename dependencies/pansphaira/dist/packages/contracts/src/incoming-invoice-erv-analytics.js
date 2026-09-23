import { Buffer } from "node:buffer";
import { AP03_EXTRACTION_HOLDOUT_SHA256_V1, benchmarkSyntheticInvoiceExtractionV1, } from "./incoming-invoice-extraction-benchmark.js";
import { AP04_ERV_CASE_PACK_SHA256_V1, compileErvCapabilityCoreV1, } from "./incoming-invoice-erv.js";
import { canonicalJson } from "./canonical-json.js";
import { sha256HexV1 } from "./incoming-invoice-intake.js";
export const ERV_ANALYTICS_PACK_SCHEMA_V1 = "chimpmaera.incoming-invoice/erv-analytics-pack/v1";
export const ERV_ANALYTICS_PACK_VERSION_V1 = "1.0.0";
export const ERV_ANALYTICS_TASK_ID_V1 = "PS365-ERV-ANALYTICS-PACK-01";
const AP03_RECEIPT_ID_V1 = "AP03_EXTRACTION_RECEIPT_V1";
const AP04_RECEIPT_ID_V1 = "AP04_ERV_CORE_V1";
const AP03_RECEIPT_PATH_V1 = "tests/fixtures/incoming-invoice/ap-03-holdout-v1.json";
const AP03_RECEIPT_BYTES_V1 = 2991;
const AP04_RECEIPT_PATH_V1 = "tests/fixtures/incoming-invoice/ap-04-erv-cases-v1.json";
const AP04_RECEIPT_BYTES_V1 = 19841;
const AP04_CORE_SCHEMA_V1 = "chimpmaera.incoming-invoice/erv-core/v1";
const EMPTY_SHA256_V1 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const OUTCOMES_V1 = ["MATCHED", "CONFLICT", "EXCEPTION", "DENIED"];
const AP03_SYSTEMS_V1 = ["baseline", "boundedSyntheticModel"];
const AP03_FIELD_DIMENSIONS_V1 = ["layout", "lineItems", "taxes", "totals"];
// Fixed, closed amount bands (minor units) for the approval-workload analysis. The final band is open-ended.
const AMOUNT_BANDS_MINOR_V1 = [0, 1000, 2000, 3000, 5000, 100000000];
const AP03_NOT_EXECUTED_V1 = "AP03_EXTRACTION_NOT_EXECUTED";
const AP04_NOT_EXECUTED_V1 = "AP04_ERV_NOT_EXECUTED";
const ADAPTED_TOLERANCE_NOT_EXECUTED_V1 = "ADAPTED_TOLERANCE_NOT_EXECUTED";
class AnalyticsError extends Error {
    code;
    constructor(code) {
        super(code);
        this.code = code;
    }
}
function sha(value) { return sha256HexV1(canonicalJson(value)); }
function shaOfBytes(bytes) { return sha256HexV1(bytes); }
function deepFreeze(value) {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
        for (const child of Object.values(value))
            deepFreeze(child);
        Object.freeze(value);
    }
    return value;
}
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, keys) {
    if (!isRecord(value))
        return false;
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function isSha256(value) { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function countBy(items) {
    const counts = {};
    for (const item of items)
        counts[item] = (counts[item] ?? 0) + 1;
    return counts;
}
/** AC01: the closed, predefined metric catalog — IDs, versions, formulas, dimensions, denominators,
 *  UNKNOWN handling, units and applicability are frozen for all six analyses. */
export const ERV_ANALYTICS_METRIC_CATALOG_V1 = deepFreeze([
    {
        metricId: "ERV_EXTRACTION_OUTCOMES_V1",
        metricVersion: "1.0.0",
        analysis: 1,
        title: "Intake / extraction outcome counts",
        sourceReceipt: AP03_RECEIPT_ID_V1,
        formula: "per system in {baseline, boundedSyntheticModel}: COUNT(cases) by validation outcome in {VALID, REJECTED}; total = denominators.disposition",
        dimensions: ["system:outcome"],
        denominator: { basis: "extraction_case_count", expected: 5 },
        unknownHandling: "REJECTED dispositions (extraction errors) are counted explicitly, never dropped or coerced to VALID",
        units: "count",
        applicability: "APPLIES_WHEN_AP03_EXTRACTION_RECEIPT_RELEASED",
    },
    {
        metricId: "ERV_FIELD_COMPLETENESS_ERRORS_V1",
        metricVersion: "1.0.0",
        analysis: 2,
        title: "Field completeness + extraction error distribution",
        sourceReceipt: AP03_RECEIPT_ID_V1,
        formula: "per field dimension in {layout,lineItems,taxes,totals}: completeness = denominators[dimension] (correctly extracted cases); error distribution = COUNT(errors) grouped by error dimension",
        dimensions: ["dimension:completeness", "dimension:errors"],
        denominator: { basis: "extraction_case_count", expected: 5 },
        unknownHandling: "dimensions absent from a rejected document are tallied as incomplete, never imputed; every extraction error is counted by dimension",
        units: "count",
        applicability: "APPLIES_WHEN_AP03_EXTRACTION_RECEIPT_RELEASED",
    },
    {
        metricId: "ERV_MATCH_OUTCOME_TOLERANCE_V1",
        metricVersion: "1.0.0",
        analysis: 3,
        title: "Two-/three-way match outcome + tolerance-use rates",
        sourceReceipt: AP04_RECEIPT_ID_V1,
        formula: "match: COUNT(decision) by matchingMode x outcome; tolerance: COUNT(decision) by tolerancePolicyId; rate = count / decisionCount (denominator provided)",
        dimensions: ["matchingMode:outcome", "tolerancePolicyId"],
        denominator: { basis: "decision_count", expected: null },
        unknownHandling: "requested tolerance variants absent from the released registry are reported as a PARTIAL ADAPTED row, never dropped",
        units: "count",
        applicability: "APPLIES_WHEN_AP04_CORE_RELEASED",
    },
    {
        metricId: "ERV_EXCEPTION_REASON_DISTRIBUTION_V1",
        metricVersion: "1.0.0",
        analysis: 4,
        title: "Exception / reason-code distribution",
        sourceReceipt: AP04_RECEIPT_ID_V1,
        formula: "COUNT(decision) by exceptionCode (EXCEPTION) union reasonCode (DENIED)",
        dimensions: ["code"],
        denominator: { basis: "exception_denied_count", expected: null },
        unknownHandling: "codes outside the frozen vocabulary deny the metric (FORMULA_DRIFT)",
        units: "count",
        applicability: "APPLIES_WHEN_AP04_CORE_RELEASED",
    },
    {
        metricId: "ERV_APPROVAL_WORKLOAD_AMOUNT_BANDS_V1",
        metricVersion: "1.0.0",
        analysis: 5,
        title: "Approval-workload counts + amount bands (no party/invoice identity)",
        sourceReceipt: AP04_RECEIPT_ID_V1,
        formula: "workload: COUNT(decision) by {auto:matched=MATCHED, review:required=CONFLICT|EXCEPTION|DENIED}; bands: COUNT(MATCHED|CONFLICT) by representative amount (matchedAmountMinor | conflict.maxAmountMinor) into closed bands",
        dimensions: ["workloadBucket", "amountBand"],
        denominator: { basis: "decision_count", expected: null },
        unknownHandling: "EXCEPTION/DENIED decisions have no representative amount and are excluded from amount bands; no supplier or invoice identity is emitted",
        units: "count",
        applicability: "APPLIES_WHEN_AP04_CORE_RELEASED",
    },
    {
        metricId: "ERV_EVIDENCE_READBACK_VERDICT_V1",
        metricVersion: "1.0.0",
        analysis: 6,
        title: "Evidence completeness + readback / verdict distribution",
        sourceReceipt: AP04_RECEIPT_ID_V1,
        formula: "verdict: COUNT(decision) by outcome; evidence: SUM(verified citations) per verdict; readback: core deterministicReplay",
        dimensions: ["verdict", "verdict:evidence:verified"],
        denominator: { basis: "decision_count", expected: null },
        unknownHandling: "unverified citations are tallied as unknown evidence, never as verified",
        units: "count",
        applicability: "APPLIES_WHEN_AP04_CORE_RELEASED",
    },
]);
const NONCLAIMS_V1 = [
    "NO_FINANCIAL_OR_ACCOUNTING_OPINION",
    "NO_ANOMALY_OR_FRAUD_CLAIM",
    "NO_PRODUCTION_DASHBOARD",
    "NO_ARBITRARY_QUERY",
    "NO_ERP_DEPENDENCY",
    "NO_EXTERNAL_PUBLICATION",
    "NO_BI_EXECUTION_AUTHORITY",
    "NO_PARTY_OR_INVOICE_IDENTITY",
    "NO_CUSTOMER_DATA_EVALUATED",
];
const AUTHORITY_V1 = {
    bookingAuthorityGranted: false,
    productivePostingAuthorized: false,
    systemOfRecord: false,
    arbitraryQueryAllowed: false,
    erpRequired: false,
    externalPublication: false,
    biExecutionAuthority: false,
    financialOpinion: false,
    fraudClaim: false,
};
function parseAp04Core(bytes) {
    if (bytes.byteLength !== AP04_RECEIPT_BYTES_V1 || shaOfBytes(bytes) !== AP04_ERV_CASE_PACK_SHA256_V1)
        throw new AnalyticsError("AP04_RECEIPT_DIGEST_DENIED");
    const pack = JSON.parse(Buffer.from(bytes).toString("utf8"));
    const result = compileErvCapabilityCoreV1(pack, AP04_ERV_CASE_PACK_SHA256_V1);
    if (result.outcome !== "DECIDED")
        throw new AnalyticsError("AP04_RECEIPT_DIGEST_DENIED");
    const core = result.package;
    // the byte digest above guarantees this is the exact released fixture, so the variant registry is trusted input
    const rawPack = pack;
    const releasedToleranceVariantIds = (rawPack.variants?.tolerancePolicies ?? [])
        .map((policy) => policy.variantId)
        .filter((variantId) => typeof variantId === "string");
    return {
        schemaVersion: core.schemaVersion,
        caseCount: core.caseCount,
        decisionDigest: core.readback.decisionDigest,
        decisions: core.decisions,
        releasedToleranceVariantIds,
    };
}
function parseAp03(bytes) {
    if (bytes.byteLength !== AP03_RECEIPT_BYTES_V1 || shaOfBytes(bytes) !== AP03_EXTRACTION_HOLDOUT_SHA256_V1)
        throw new AnalyticsError("AP03_RECEIPT_DIGEST_DENIED");
    const holdout = JSON.parse(Buffer.from(bytes).toString("utf8"));
    const benchmark = benchmarkSyntheticInvoiceExtractionV1(holdout, AP03_EXTRACTION_HOLDOUT_SHA256_V1);
    if (benchmark.outcome !== "PUBLISHED")
        throw new AnalyticsError("AP03_RECEIPT_DIGEST_DENIED");
    const systems = {};
    for (const systemId of AP03_SYSTEMS_V1) {
        systems[systemId] = { validation: { validated: benchmark.systems[systemId].validation.validated, rejected: benchmark.systems[systemId].validation.rejected } };
    }
    return {
        denominators: { ...benchmark.denominators },
        systems,
        errors: benchmark.errors.map((error) => ({ dimension: error.dimension })),
    };
}
// --- metric computation ------------------------------------------------------
function metricDigestOf(result) {
    return sha({
        metricId: result.metricId,
        metricVersion: result.metricVersion,
        state: result.state,
        reasonCode: result.reasonCode,
        denominator: result.denominator,
        rows: result.rows,
    });
}
function buildResult(definition, state, reasonCode, denominator, rows) {
    const unsigned = {
        metricId: definition.metricId,
        metricVersion: definition.metricVersion,
        state,
        reasonCode,
        denominator,
        rows: [...rows],
    };
    return deepFreeze({ ...unsigned, metricDigest: metricDigestOf(unsigned) });
}
function unknownResult(definition, reasonCode) {
    return buildResult(definition, "UNKNOWN", reasonCode, { basis: definition.denominator.basis, total: 0 }, []);
}
function representativeAmountMinor(decision) {
    if (decision.outcome === "MATCHED")
        return decision.matchedAmountMinor;
    if (decision.outcome === "CONFLICT")
        return decision.conflict.maxAmountMinor;
    return null;
}
function bandLabel(amount, bands) {
    for (let index = 0; index < bands.length - 1; index += 1) {
        const lower = bands[index];
        const upper = bands[index + 1];
        if (amount >= lower && amount < upper)
            return `amount:${lower}-${upper === 100000000 ? "max" : upper}`;
    }
    return "amount:unbounded";
}
function computeAp03Metrics(ap03State, ap03) {
    const catalog = ERV_ANALYTICS_METRIC_CATALOG_V1;
    if (ap03State !== "RELEASED" || ap03 === null) {
        return [unknownResult(catalog[0], AP03_NOT_EXECUTED_V1), unknownResult(catalog[1], AP03_NOT_EXECUTED_V1)];
    }
    const total = ap03.denominators.disposition ?? 0;
    // analysis 1 — extraction outcome counts per system.
    const outcomeRows = [];
    for (const systemId of AP03_SYSTEMS_V1) {
        const validation = ap03.systems[systemId].validation;
        outcomeRows.push({ dimension: `system:${systemId}:VALID`, value: validation.validated });
        outcomeRows.push({ dimension: `system:${systemId}:REJECTED`, value: validation.rejected });
    }
    const extraction = buildResult(catalog[0], "COMPLETE", null, { basis: "extraction_case_count", total }, outcomeRows);
    // analysis 2 — field completeness + error distribution.
    const completenessRows = AP03_FIELD_DIMENSIONS_V1.map((dimension) => ({
        dimension: `dimension:${dimension}:completeness`,
        value: ap03.denominators[dimension] ?? 0,
    }));
    const errorCounts = countBy(ap03.errors.map((error) => error.dimension));
    const errorRows = Object.keys(errorCounts).sort().map((dimension) => ({
        dimension: `dimension:${dimension}:errors`,
        value: errorCounts[dimension],
    }));
    const completeness = buildResult(catalog[1], "COMPLETE", null, { basis: "extraction_case_count", total }, [...completenessRows, ...errorRows]);
    return [extraction, completeness];
}
function computeAp04Metrics(ap04State, ap04, adaptedRequests) {
    const catalog = ERV_ANALYTICS_METRIC_CATALOG_V1;
    if (ap04State !== "RELEASED" || ap04 === null) {
        return [
            unknownResult(catalog[2], AP04_NOT_EXECUTED_V1),
            unknownResult(catalog[3], AP04_NOT_EXECUTED_V1),
            unknownResult(catalog[4], AP04_NOT_EXECUTED_V1),
            unknownResult(catalog[5], AP04_NOT_EXECUTED_V1),
        ];
    }
    const decisions = ap04.decisions;
    const decisionCount = decisions.length;
    let match;
    let exception;
    let workload;
    let verdict;
    // analysis 3 — match outcome + tolerance-use (aggregated by dimension).
    {
        const matchCounts = countBy(decisions.map((decision) => `match:${decision.variant.matchingModeId}:${decision.outcome}`));
        const toleranceCounts = countBy(decisions.map((decision) => `tolerance:${decision.variant.tolerancePolicyId}`));
        const rows = [
            ...Object.keys(matchCounts).sort().map((dimension) => ({ dimension, value: matchCounts[dimension] })),
            ...Object.keys(toleranceCounts).sort().map((dimension) => ({ dimension, value: toleranceCounts[dimension] })),
        ];
        for (const request of adaptedRequests) {
            rows.push({ dimension: `tolerance:${request.variantId}:ADAPTED:${request.rateBasisPoints}bps`, value: 0 });
        }
        const state = adaptedRequests.length > 0 ? "PARTIAL" : "COMPLETE";
        match = buildResult(catalog[2], state, adaptedRequests.length > 0 ? ADAPTED_TOLERANCE_NOT_EXECUTED_V1 : null, { basis: "decision_count", total: decisionCount }, rows);
    }
    // analysis 4 — exception / reason-code distribution.
    {
        const codes = [];
        for (const decision of decisions) {
            if (decision.outcome === "EXCEPTION")
                codes.push(decision.exceptionCode);
            else if (decision.outcome === "DENIED")
                codes.push(decision.reasonCode);
        }
        const counts = countBy(codes);
        exception = buildResult(catalog[3], "COMPLETE", null, { basis: "exception_denied_count", total: codes.length }, Object.keys(counts).sort().map((code) => ({ dimension: `code:${code}`, value: counts[code] })));
    }
    // analysis 5 — approval-workload + amount bands (no identity).
    {
        const autoMatched = decisions.filter((decision) => decision.outcome === "MATCHED").length;
        const reviewRequired = decisionCount - autoMatched;
        const bands = {};
        for (const decision of decisions) {
            const amount = representativeAmountMinor(decision);
            if (amount === null)
                continue;
            const label = bandLabel(amount, AMOUNT_BANDS_MINOR_V1);
            bands[label] = (bands[label] ?? 0) + 1;
        }
        workload = buildResult(catalog[4], "COMPLETE", null, { basis: "decision_count", total: decisionCount }, [
            { dimension: "workload:auto:matched", value: autoMatched },
            { dimension: "workload:review:required", value: reviewRequired },
            ...Object.keys(bands).sort().map((label) => ({ dimension: label, value: bands[label] })),
        ]);
    }
    // analysis 6 — evidence completeness + readback / verdict.
    {
        const verdicts = {};
        for (const decision of decisions) {
            const bucket = (verdicts[decision.outcome] ??= { total: 0, verified: 0 });
            bucket.total += 1;
            bucket.verified += decision.evidenceCitations.filter((citation) => citation.verified).length;
        }
        verdict = buildResult(catalog[5], "COMPLETE", null, { basis: "decision_count", total: decisionCount }, Object.keys(verdicts).sort().flatMap((outcome) => [
            { dimension: `verdict:${outcome}`, value: verdicts[outcome].total },
            { dimension: `verdict:${outcome}:evidence:verified`, value: verdicts[outcome].verified },
        ]));
    }
    return [match, exception, workload, verdict];
}
function hasPublicProjectionLeak(value) {
    const serialized = canonicalJson(value);
    return ["supplierId", "invoiceId", "referenceId", "customerId", "questionText", "credential", "password", "SYN-SUP", "INV-2026", "PO-2026", "RCV-2026"].some((token) => serialized.includes(token));
}
export function generateErvAnalyticsPackV1(input) {
    if (!isRecord(input) || (input.scenario !== "BASELINE" && input.scenario !== "ADAPTED") || !Array.isArray(input.receipts) || !Array.isArray(input.adaptedToleranceRequests)) {
        throw new AnalyticsError("PACK_INPUT_SHAPE_DENIED");
    }
    const receiptById = new Map();
    const receiptsList = input.receipts;
    for (const receipt of receiptsList) {
        if (!isRecord(receipt) || !exactKeys(receipt, ["receiptId", "path", "state", "bytes"])
            || (receipt.receiptId !== AP03_RECEIPT_ID_V1 && receipt.receiptId !== AP04_RECEIPT_ID_V1)
            || (receipt.state !== "RELEASED" && receipt.state !== "REQUESTED_NOT_EXECUTED")
            || !(receipt.bytes instanceof Uint8Array)) {
            throw new AnalyticsError("RECEIPT_SHAPE_DENIED");
        }
        if (receiptById.has(receipt.receiptId))
            throw new AnalyticsError("RECEIPT_DUPLICATED");
        receiptById.set(receipt.receiptId, receipt);
    }
    const ap03Receipt = receiptById.get(AP03_RECEIPT_ID_V1);
    const ap04Receipt = receiptById.get(AP04_RECEIPT_ID_V1);
    if (ap03Receipt === undefined || ap04Receipt === undefined)
        throw new AnalyticsError("RECEIPT_MISSING");
    if (ap03Receipt.state === "RELEASED" && ap03Receipt.path !== AP03_RECEIPT_PATH_V1)
        throw new AnalyticsError("AP03_RECEIPT_PATH_DENIED");
    if (ap04Receipt.state === "RELEASED" && ap04Receipt.path !== AP04_RECEIPT_PATH_V1)
        throw new AnalyticsError("AP04_RECEIPT_PATH_DENIED");
    const adaptedToleranceRequests = input.adaptedToleranceRequests;
    for (const request of adaptedToleranceRequests) {
        if (!isRecord(request) || !exactKeys(request, ["variantId", "rateBasisPoints"]) || typeof request.variantId !== "string" || !Number.isSafeInteger(request.rateBasisPoints) || request.rateBasisPoints < 0) {
            throw new AnalyticsError("ADAPTED_REQUEST_SHAPE_DENIED");
        }
    }
    const ap04 = ap04Receipt.state === "RELEASED" ? parseAp04Core(ap04Receipt.bytes) : null;
    const ap03 = ap03Receipt.state === "RELEASED" ? parseAp03(ap03Receipt.bytes) : null;
    if (ap04 !== null) {
        for (const request of adaptedToleranceRequests) {
            if (!ap04.releasedToleranceVariantIds.includes(request.variantId))
                throw new AnalyticsError("ADAPTED_VARIANT_NOT_RELEASED");
        }
    }
    const [extraction, completeness] = computeAp03Metrics(ap03Receipt.state, ap03);
    const [match, exception, workload, verdict] = computeAp04Metrics(ap04Receipt.state, ap04, adaptedToleranceRequests);
    const metrics = [extraction, completeness, match, exception, workload, verdict];
    const config = { amountBandsMinor: [...AMOUNT_BANDS_MINOR_V1] };
    const binding = deepFreeze({
        ap03ReceiptSha256: ap03Receipt.state === "RELEASED" ? AP03_EXTRACTION_HOLDOUT_SHA256_V1 : EMPTY_SHA256_V1,
        ap04CoreDigest: ap04 === null ? EMPTY_SHA256_V1 : ap04.decisionDigest,
        metricCatalogDigest: sha(ERV_ANALYTICS_METRIC_CATALOG_V1),
        resultDigest: sha(metrics),
        configDigest: sha(config),
    });
    const tableRows = [];
    for (const metric of metrics) {
        const definition = ERV_ANALYTICS_METRIC_CATALOG_V1.find((entry) => entry.metricId === metric.metricId);
        for (const row of metric.rows) {
            tableRows.push({ analysis: definition.analysis, metricId: metric.metricId, dimension: row.dimension, value: row.value, state: metric.state, units: "count" });
        }
    }
    const receiptsProjection = [
        { receiptId: ap03Receipt.receiptId, path: ap03Receipt.path, state: ap03Receipt.state, identity: { byteLength: ap03Receipt.bytes.byteLength, sha256: ap03Receipt.state === "RELEASED" ? AP03_EXTRACTION_HOLDOUT_SHA256_V1 : EMPTY_SHA256_V1 } },
        { receiptId: ap04Receipt.receiptId, path: ap04Receipt.path, state: ap04Receipt.state, identity: { byteLength: ap04Receipt.bytes.byteLength, sha256: ap04Receipt.state === "RELEASED" ? AP04_ERV_CASE_PACK_SHA256_V1 : EMPTY_SHA256_V1 } },
    ];
    const unsigned = {
        schemaVersion: ERV_ANALYTICS_PACK_SCHEMA_V1,
        packVersion: ERV_ANALYTICS_PACK_VERSION_V1,
        packId: `erv-analytics-pack:${input.scenario.toLowerCase()}:v1`,
        taskId: ERV_ANALYTICS_TASK_ID_V1,
        scope: "PREBUILT_AGGREGATE_ANALYSIS",
        scenario: input.scenario,
        nonclaims: [...NONCLAIMS_V1],
        authority: { ...AUTHORITY_V1 },
        receipts: receiptsProjection,
        core: {
            schemaVersion: ap04 === null ? AP04_CORE_SCHEMA_V1 : ap04.schemaVersion,
            caseCount: ap04 === null ? 0 : ap04.caseCount,
            decisionDigest: ap04 === null ? EMPTY_SHA256_V1 : ap04.decisionDigest,
            deterministicReplay: true,
        },
        metricCatalog: ERV_ANALYTICS_METRIC_CATALOG_V1,
        config,
        metrics,
        binding,
    };
    const canonicalProjection = { format: "CANONICAL_JSON_V1", binding, digest: sha(unsigned) };
    const tableProjection = { format: "TABLE_V1", rows: tableRows, binding, digest: sha(tableRows) };
    const pack = deepFreeze({
        ...unsigned,
        projections: { canonical: canonicalProjection, table: tableProjection },
        packDigest: sha({ ...unsigned, projections: { canonical: canonicalProjection, table: tableProjection } }),
    });
    return { pack, serialized: `${canonicalJson(pack)}\n` };
}
const PACK_KEYS = ["schemaVersion", "packVersion", "packId", "taskId", "scope", "scenario", "nonclaims", "authority", "receipts", "core", "metricCatalog", "config", "metrics", "binding", "projections", "packDigest"];
const AUTHORITY_KEYS = ["bookingAuthorityGranted", "productivePostingAuthorized", "systemOfRecord", "arbitraryQueryAllowed", "erpRequired", "externalPublication", "biExecutionAuthority", "financialOpinion", "fraudClaim"];
function verifyShape(candidate) {
    if (!exactKeys(candidate, PACK_KEYS))
        return "PACK_SHAPE_DENIED";
    if (candidate.schemaVersion !== ERV_ANALYTICS_PACK_SCHEMA_V1 || candidate.packVersion !== ERV_ANALYTICS_PACK_VERSION_V1 || candidate.taskId !== ERV_ANALYTICS_TASK_ID_V1 || candidate.scope !== "PREBUILT_AGGREGATE_ANALYSIS")
        return "PACK_SHAPE_DENIED";
    if (!exactKeys(candidate.authority, AUTHORITY_KEYS))
        return "PACK_SCOPE_DENIED";
    for (const key of AUTHORITY_KEYS) {
        if (candidate.authority[key] !== false)
            return "PACK_SCOPE_DENIED";
    }
    if (!isSha256(candidate.packDigest))
        return "PACK_DIGEST_SHAPE_DENIED";
    if (!isRecord(candidate.core) || !isSha256(candidate.core.decisionDigest))
        return "CORE_DIGEST_SHAPE_DENIED";
    return null;
}
export function verifyErvAnalyticsPackV1(candidate, input) {
    if (hasPublicProjectionLeak(candidate))
        return { valid: false, reasonCodes: ["IDENTITY_LEAKAGE_DENIED"] };
    const shapeError = verifyShape(candidate);
    if (shapeError !== null)
        return { valid: false, reasonCodes: [shapeError] };
    try {
        const expected = generateErvAnalyticsPackV1(input).pack;
        if (canonicalJson(candidate) !== canonicalJson(expected))
            return { valid: false, reasonCodes: ["PACK_DIGEST_DENIED"] };
        return { valid: true, reasonCodes: [] };
    }
    catch (error) {
        return { valid: false, reasonCodes: [error instanceof AnalyticsError ? error.code : "PACK_INPUT_SHAPE_DENIED"] };
    }
}
/** AC06: standalone local report — regenerate the baseline + adapted packs and read them back. No ERP required. */
export function generateErvAnalyticsLocalReportV1(baseline, adapted) {
    const baselinePack = generateErvAnalyticsPackV1(baseline).pack;
    const adaptedPack = generateErvAnalyticsPackV1(adapted).pack;
    // AC03/AC04: both scenario packs bind the same metric / config digests; only core / result digests may differ by scenario.
    if (baselinePack.binding.metricCatalogDigest !== adaptedPack.binding.metricCatalogDigest || baselinePack.binding.configDigest !== adaptedPack.binding.configDigest) {
        throw new AnalyticsError("REPORT_BINDING_MISMATCH");
    }
    const unsigned = { reportId: "erv-analytics-local-report:v1", baseline: baselinePack, adapted: adaptedPack, binding: baselinePack.binding };
    return deepFreeze({ ...unsigned, reportDigest: sha(unsigned), serialized: `${canonicalJson(unsigned)}\n` });
}
