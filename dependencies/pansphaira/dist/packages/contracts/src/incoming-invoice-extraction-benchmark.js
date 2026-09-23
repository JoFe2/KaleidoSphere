import { createHash } from "node:crypto";
import { canonicalJsonV1 } from "./incoming-invoice-intake.js";
export const AP03_EXTRACTION_HOLDOUT_SHA256_V1 = "41959bab323542694b120f8d55314620c214f3a44f7c8d36270e47ac8f9b9edb";
const AP03_EXTRACTION_HOLDOUT_CANONICAL_SHA256_V1 = "9a3e80ea4fd8dc0a57c355e88d53ac848bb3052f9d9c9268ade67fdf80639760";
export const INCOMING_INVOICE_EXTRACTION_BENCHMARK_V1 = "chimpmaera.incoming-invoice/extraction-benchmark/v1";
function deepFreeze(value) {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
        for (const child of Object.values(value))
            deepFreeze(child);
        Object.freeze(value);
    }
    return value;
}
function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, keys) {
    if (!isObject(value))
        return false;
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function finiteInteger(value) { return Number.isSafeInteger(value) && value >= 0; }
function validExtractionShape(value) {
    if (!exactKeys(value, ["layout", "lineItems", "taxes", "totals"]) || !["TABLE", "COMPACT", "TAX_EXEMPT"].includes(value.layout))
        return false;
    if (!Array.isArray(value.lineItems) || value.lineItems.length === 0 || !value.lineItems.every((line) => exactKeys(line, ["description", "quantity", "unitAmountMinor", "netAmountMinor"])
        && typeof line.description === "string" && line.description.length > 0 && finiteInteger(line.quantity)
        && finiteInteger(line.unitAmountMinor) && finiteInteger(line.netAmountMinor)))
        return false;
    if (!Array.isArray(value.taxes) || value.taxes.length === 0 || !value.taxes.every((tax) => exactKeys(tax, ["rateBasisPoints", "baseAmountMinor", "taxAmountMinor"])
        && finiteInteger(tax.rateBasisPoints) && tax.rateBasisPoints <= 10000
        && finiteInteger(tax.baseAmountMinor) && finiteInteger(tax.taxAmountMinor)))
        return false;
    return exactKeys(value.totals, ["netAmountMinor", "taxAmountMinor", "grossAmountMinor"])
        && finiteInteger(value.totals.netAmountMinor) && finiteInteger(value.totals.taxAmountMinor)
        && finiteInteger(value.totals.grossAmountMinor);
}
function validProposalShape(value) {
    if (!isObject(value))
        return false;
    const common = typeof value.caseId === "string" && ["DETERMINISTIC_BASELINE", "BOUNDED_SYNTHETIC_MODEL_PROPOSAL"].includes(value.proposalKind)
        && typeof value.confidence === "number" && Number.isFinite(value.confidence) && value.confidence >= 0 && value.confidence <= 1;
    if (!common)
        return false;
    if (value.disposition === "VALID")
        return exactKeys(value, ["proposalKind", "caseId", "confidence", "disposition", "extraction"])
            && validExtractionShape(value.extraction);
    return value.disposition === "REJECTED" && exactKeys(value, ["proposalKind", "caseId", "confidence", "disposition", "reasonCode"])
        && ["VALIDATION_TOTAL_MISMATCH", "LAYOUT_UNSUPPORTED", "VALIDATION_LINE_ARITHMETIC", "VALIDATION_TAX_ARITHMETIC"].includes(value.reasonCode);
}
function parseDocumentV1(document) {
    const lines = document.split("\n");
    const layoutText = lines.find((line) => line.startsWith("LAYOUT="))?.slice(7);
    if (!["TABLE", "COMPACT", "TAX_EXEMPT"].includes(layoutText ?? ""))
        return "LAYOUT_UNSUPPORTED";
    const lineItems = [];
    const taxes = [];
    let totals;
    for (const line of lines) {
        if (line.startsWith("LINE=")) {
            const [description, quantity, unit, net] = line.slice(5).split("|");
            lineItems.push({ description: description ?? "", quantity: Number(quantity), unitAmountMinor: Number(unit), netAmountMinor: Number(net) });
        }
        else if (line.startsWith("TAX=")) {
            const [rate, base, amount] = line.slice(4).split("|");
            taxes.push({ rateBasisPoints: Number(rate) * 100, baseAmountMinor: Number(base), taxAmountMinor: Number(amount) });
        }
        else if (line.startsWith("TOTAL=")) {
            const [net, tax, gross] = line.slice(6).split("|");
            totals = { netAmountMinor: Number(net), taxAmountMinor: Number(tax), grossAmountMinor: Number(gross) };
        }
    }
    const extraction = { layout: layoutText, lineItems, taxes, totals };
    if (!validExtractionShape(extraction))
        return "PROPOSAL_SHAPE_DENIED";
    const validatedExtraction = extraction;
    const lineNet = lineItems.reduce((sum, line) => sum + line.netAmountMinor, 0);
    if (lineItems.some((line) => line.quantity * line.unitAmountMinor !== line.netAmountMinor) || lineNet !== validatedExtraction.totals.netAmountMinor)
        return "VALIDATION_LINE_ARITHMETIC";
    const taxAmount = taxes.reduce((sum, tax) => sum + tax.taxAmountMinor, 0);
    if (taxes.some((tax) => Math.round(tax.baseAmountMinor * tax.rateBasisPoints / 10000) !== tax.taxAmountMinor) || taxAmount !== validatedExtraction.totals.taxAmountMinor)
        return "VALIDATION_TAX_ARITHMETIC";
    if (validatedExtraction.totals.netAmountMinor + validatedExtraction.totals.taxAmountMinor !== validatedExtraction.totals.grossAmountMinor)
        return "VALIDATION_TOTAL_MISMATCH";
    return validatedExtraction;
}
export function validateIncomingInvoiceExtractionProposalV1(proposal, document) {
    if (!validProposalShape(proposal))
        return deepFreeze({ outcome: "REJECTED", reasonCode: "PROPOSAL_SHAPE_DENIED", validated: false, authoritative: false });
    const independentlyParsed = parseDocumentV1(document);
    if (proposal.disposition === "REJECTED") {
        if (typeof independentlyParsed === "string" && proposal.reasonCode === independentlyParsed) {
            return deepFreeze({ outcome: "VALIDATED", validated: true, authoritative: false, disposition: "REJECTED", reasonCode: proposal.reasonCode });
        }
        return deepFreeze({ outcome: "REJECTED", reasonCode: typeof independentlyParsed === "string" ? independentlyParsed : "PROPOSAL_SHAPE_DENIED", validated: false, authoritative: false });
    }
    if (typeof independentlyParsed === "string")
        return deepFreeze({ outcome: "REJECTED", reasonCode: independentlyParsed, validated: false, authoritative: false });
    if (canonicalJsonV1(proposal.extraction) !== canonicalJsonV1(independentlyParsed)) {
        return deepFreeze({ outcome: "REJECTED", reasonCode: "VALIDATION_LINE_ARITHMETIC", validated: false, authoritative: false });
    }
    return deepFreeze({ outcome: "VALIDATED", validated: true, authoritative: false, disposition: "VALID", extraction: structuredClone(proposal.extraction) });
}
function proposalForV1(item, kind, confidence) {
    const parsed = parseDocumentV1(item.document);
    if (typeof parsed === "string")
        return { proposalKind: kind, caseId: item.caseId, confidence, disposition: "REJECTED", reasonCode: parsed };
    const extraction = structuredClone(parsed);
    if (kind === "BOUNDED_SYNTHETIC_MODEL_PROPOSAL" && item.caseId === "layout-compact-multi-line")
        extraction.lineItems[1].netAmountMinor = 601;
    return { proposalKind: kind, caseId: item.caseId, confidence, disposition: "VALID", extraction };
}
function validHoldoutShape(value) {
    if (!exactKeys(value, ["schemaVersion", "holdoutId", "frozenAt", "sourceBinding", "authority", "cases"]))
        return false;
    if (value.schemaVersion !== "chimpmaera.incoming-invoice/extraction-holdout/v1" || typeof value.holdoutId !== "string" || typeof value.frozenAt !== "string")
        return false;
    if (!exactKeys(value.sourceBinding, ["sourceId", "sourceSha256", "supplierId", "invoiceNumber"]) || !Object.values(value.sourceBinding).every((entry) => typeof entry === "string"))
        return false;
    if (!exactKeys(value.authority, ["mode", "customerData", "externalProvider", "productivePosting"]) || value.authority.mode !== "LOCAL_SYNTHETIC_PROOF" || value.authority.customerData !== false || value.authority.externalProvider !== false || value.authority.productivePosting !== false)
        return false;
    return Array.isArray(value.cases) && value.cases.length > 0 && value.cases.every((item) => {
        if (!exactKeys(item, ["caseId", "document", "expected"]) || typeof item.caseId !== "string" || typeof item.document !== "string" || !isObject(item.expected))
            return false;
        return item.expected.disposition === "VALID"
            ? exactKeys(item.expected, ["disposition", "extraction"]) && validExtractionShape(item.expected.extraction)
            : item.expected.disposition === "REJECTED" && exactKeys(item.expected, ["disposition", "reasonCode"]) && typeof item.expected.reasonCode === "string";
    });
}
function canonicalDigestV1(value) { return createHash("sha256").update(canonicalJsonV1(value)).digest("hex"); }
function equalV1(left, right) { return canonicalJsonV1(left) === canonicalJsonV1(right); }
export function benchmarkSyntheticInvoiceExtractionV1(candidate, claimedHoldoutSha256) {
    if (!validHoldoutShape(candidate))
        return deepFreeze({ outcome: "DENIED", reasonCode: "HOLDOUT_SHAPE_DENIED" });
    if (claimedHoldoutSha256 !== AP03_EXTRACTION_HOLDOUT_SHA256_V1 || canonicalDigestV1(candidate) !== AP03_EXTRACTION_HOLDOUT_CANONICAL_SHA256_V1)
        return deepFreeze({ outcome: "DENIED", reasonCode: "HOLDOUT_DIGEST_DENIED" });
    const holdout = structuredClone(candidate);
    const validCount = holdout.cases.filter((item) => item.expected.disposition === "VALID").length;
    const denominators = { disposition: holdout.cases.length, layout: validCount, lineItems: validCount, taxes: validCount, totals: validCount, confidence: holdout.cases.length };
    const errors = [];
    const confidenceByCase = new Map([["layout-table-single-tax", 0.95], ["layout-compact-multi-line", 0.8], ["layout-tax-exempt", 0.85], ["failure-total-mismatch", 0.9], ["failure-unsupported-layout", 0.9]]);
    const score = (systemId, kind) => {
        const exactCorrect = { disposition: 0, layout: 0, lineItems: 0, taxes: 0, totals: 0 };
        let validated = 0;
        let rejected = 0;
        let confidenceSum = 0;
        let brierTotal = 0;
        for (const item of holdout.cases) {
            const confidence = kind === "DETERMINISTIC_BASELINE" ? 0.99 : confidenceByCase.get(item.caseId);
            const proposal = proposalForV1(item, kind, confidence);
            const validation = validateIncomingInvoiceExtractionProposalV1(proposal, item.document);
            if (validation.validated)
                validated += 1;
            else
                rejected += 1;
            const observedDisposition = validation.outcome === "VALIDATED" ? validation.disposition : "REJECTED";
            const dispositionCorrect = observedDisposition === item.expected.disposition;
            if (dispositionCorrect)
                exactCorrect.disposition += 1;
            else
                errors.push({ systemId, caseId: item.caseId, dimension: "disposition", expected: item.expected.disposition, observed: observedDisposition });
            confidenceSum += confidence;
            brierTotal += (confidence - (dispositionCorrect ? 1 : 0)) ** 2;
            if (item.expected.disposition === "VALID") {
                for (const dimension of ["layout", "lineItems", "taxes", "totals"]) {
                    const observed = validation.outcome === "VALIDATED" && validation.disposition === "VALID" ? validation.extraction[dimension] : undefined;
                    if (observed !== undefined && equalV1(observed, item.expected.extraction[dimension]))
                        exactCorrect[dimension] += 1;
                    else
                        errors.push({ systemId, caseId: item.caseId, dimension, expected: canonicalJsonV1(item.expected.extraction[dimension]), observed: observed === undefined ? "VALIDATION_REJECTED" : canonicalJsonV1(observed) });
                }
            }
        }
        return { systemId, proposalKind: kind, exactCorrect, validation: { validated, rejected }, confidenceCalibration: { brierScore: brierTotal / denominators.confidence, bins: [{ lowerInclusive: 0.8, upperInclusive: 1, count: denominators.confidence, meanConfidence: Number((confidenceSum / denominators.confidence).toFixed(12)), observedExactDispositionAccuracy: exactCorrect.disposition / denominators.disposition }] } };
    };
    const baseline = score("deterministic-baseline-v1", "DETERMINISTIC_BASELINE");
    const boundedSyntheticModel = score("bounded-synthetic-model-v1", "BOUNDED_SYNTHETIC_MODEL_PROPOSAL");
    return deepFreeze({
        outcome: "PUBLISHED", schemaVersion: INCOMING_INVOICE_EXTRACTION_BENCHMARK_V1, holdoutId: holdout.holdoutId,
        denominators, systems: { baseline, boundedSyntheticModel }, errors,
        authority: { authoritativeOutputs: false, productivePostingAuthorized: false, customerDataAuthorized: false, externalProviderCalls: false },
        nonclaims: ["NO_CUSTOMER_DATA_EVALUATED", "NO_EXTERNAL_PROVIDER_EVALUATED", "NO_PRODUCTIVE_ALLOCATION_OR_POSTING_AUTHORIZED", "NO_ARBITRARY_MODEL_CLAIM", "NO_PRODUCTION_FITNESS_CLAIM"],
    });
}
