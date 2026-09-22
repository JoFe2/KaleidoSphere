import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
export const HISTORICAL_ROUTING_EPISODE_SCHEMA_V1 = "chimpmaera.dev/historical-routing-episode/v1";
export const LEARNING_ROUTING_BASELINE_SCHEMA_V1 = "chimpmaera.dev/learning-routing-baseline/v1";
export const LEARNING_ROUTING_BASELINE_VERSION_V1 = "lr-004.1";
export const ROUTING_BASELINE_CLASSES_V1 = ["STATIC", "CURRENT", "CHEAP", "STRONG"];
function digest(value) {
    return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, keys) {
    return isRecord(value) && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}
function isDigest(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function nonNegativeInteger(value) {
    return Number.isSafeInteger(value) && value >= 0;
}
function validEpisode(value) {
    if (!exactKeys(value, ["schemaVersion", "episodePseudonym", "sourceEvidence", "routeClass", "versions",
        "disposition", "evidenceComplete", "transportState", "usage"])
        || value.schemaVersion !== HISTORICAL_ROUTING_EPISODE_SCHEMA_V1
        || typeof value.episodePseudonym !== "string" || !/^ep_[a-f0-9]{32}$/.test(value.episodePseudonym)
        || !["AUGUST_CANARY", "PUBLIC_ISSUE_41", "PUBLIC_ISSUE_58", "SANITIZED_SYNTHETIC"].includes(value.sourceEvidence)
        || !ROUTING_BASELINE_CLASSES_V1.includes(value.routeClass)
        || !["VERIFIED_RESOLVED", "NOT_RESOLVED", "ABORTED", "DENIED", "CENSORED", "UNKNOWN", "INSUFFICIENT_EVIDENCE"].includes(value.disposition)
        || typeof value.evidenceComplete !== "boolean"
        || !["NOT_SENT", "CONFIRMED", "FAILED", "UNKNOWN", "RECONCILED"].includes(value.transportState))
        return false;
    if (!exactKeys(value.versions, ["featureSpec", "modelCatalog", "priceBook", "routerArtifact", "verificationGraph"])
        || !Object.values(value.versions).every(isDigest))
        return false;
    if (!exactKeys(value.usage, ["calls", "repairs", "retries", "scoutCalls", "testRuns", "ciRuns",
        "reviewMinutes", "elapsedMs", "actualReceiptCostMicros", "priceAssumptionCostMicros", "unknownTransportReserveMicros"]))
        return false;
    return Object.entries(value.usage).every(([key, item]) => key === "actualReceiptCostMicros"
        ? item === null || nonNegativeInteger(item) : nonNegativeInteger(item));
}
/** Closed, read-only normalization. Invalid or duplicate inputs fail the entire cohort. */
export function normalizeHistoricalRoutingEpisodeV1(value) {
    if (!validEpisode(value))
        throw new TypeError("INVALID_HISTORICAL_ROUTING_EPISODE");
    const normalizedDisposition = value.disposition === "VERIFIED_RESOLVED" && !value.evidenceComplete
        ? "INSUFFICIENT_EVIDENCE" : value.disposition;
    const billedCostMicros = value.usage.actualReceiptCostMicros ?? value.usage.priceAssumptionCostMicros;
    const reservedCostMicros = value.transportState === "UNKNOWN" && value.usage.actualReceiptCostMicros === null
        ? value.usage.unknownTransportReserveMicros : 0;
    const unsigned = {
        ...value,
        normalizedDisposition,
        verifiedSuccess: normalizedDisposition === "VERIFIED_RESOLVED",
        billedCostMicros,
        reservedCostMicros,
        totalCostMicros: billedCostMicros + reservedCostMicros,
    };
    return { ...unsigned, episodeDigest: digest(unsigned) };
}
function wilson95(successes, total) {
    if (total === 0)
        return { lower: 0, upper: 1_000_000 };
    const z = 1.959963984540054;
    const p = successes / total;
    const denominator = 1 + (z * z) / total;
    const center = (p + (z * z) / (2 * total)) / denominator;
    const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total) / denominator;
    return { lower: Math.round(Math.max(0, center - margin) * 1_000_000),
        upper: Math.round(Math.min(1, center + margin) * 1_000_000) };
}
function metrics(episodes) {
    const verifiedSuccesses = episodes.filter(({ verifiedSuccess }) => verifiedSuccess).length;
    const sum = (select) => episodes.reduce((total, episode) => total + select(episode), 0);
    const totals = {
        billedCostMicros: sum(({ billedCostMicros }) => billedCostMicros),
        reservedCostMicros: sum(({ reservedCostMicros }) => reservedCostMicros),
        totalCostMicros: sum(({ totalCostMicros }) => totalCostMicros),
        elapsedMs: sum(({ usage }) => usage.elapsedMs),
        calls: sum(({ usage }) => usage.calls),
        repairs: sum(({ usage }) => usage.repairs),
        retries: sum(({ usage }) => usage.retries),
        scoutCalls: sum(({ usage }) => usage.scoutCalls),
        testRuns: sum(({ usage }) => usage.testRuns),
        ciRuns: sum(({ usage }) => usage.ciRuns),
        reviewMinutes: sum(({ usage }) => usage.reviewMinutes),
    };
    const perSuccess = (value) => verifiedSuccesses === 0
        ? null : Math.round(value * 1_000 / verifiedSuccesses);
    const incomplete = episodes.filter(({ evidenceComplete }) => !evidenceComplete).length;
    const unknown = episodes.filter(({ transportState }) => transportState === "UNKNOWN").length;
    const missingCost = episodes.filter(({ usage }) => usage.actualReceiptCostMicros === null).length;
    const completeRatio = episodes.length === 0 ? 0 : (episodes.length - incomplete - unknown) / episodes.length;
    return {
        episodeCount: episodes.length,
        verifiedSuccesses,
        vsrPpm: episodes.length === 0 ? 0 : Math.round(verifiedSuccesses * 1_000_000 / episodes.length),
        vsrWilson95Ppm: wilson95(verifiedSuccesses, episodes.length),
        ecvrMicros: verifiedSuccesses === 0 ? null : Math.round(totals.totalCostMicros / verifiedSuccesses),
        etvrMs: verifiedSuccesses === 0 ? null : Math.round(totals.elapsedMs / verifiedSuccesses),
        effortPerVerifiedSuccessMilli: {
            calls: perSuccess(totals.calls), repairs: perSuccess(totals.repairs), retries: perSuccess(totals.retries),
            scoutCalls: perSuccess(totals.scoutCalls), testRuns: perSuccess(totals.testRuns),
            ciRuns: perSuccess(totals.ciRuns), reviewMinutes: perSuccess(totals.reviewMinutes),
        },
        totals,
        missingness: { incompleteEvidence: incomplete, unknownTransport: unknown,
            missingActualReceiptCost: missingCost,
            censored: episodes.filter(({ normalizedDisposition }) => normalizedDisposition === "CENSORED").length },
        confidence: episodes.length >= 24 && completeRatio === 1 ? "HIGH"
            : episodes.length >= 12 && completeRatio >= 0.8 ? "MEDIUM" : "LOW",
    };
}
/** Computes reproducible VSR/ECVR/ETVR and effort baselines without I/O or route recommendations. */
export function computeLearningRoutingBaselineV1(values) {
    const episodes = values.map(normalizeHistoricalRoutingEpisodeV1)
        .sort((left, right) => left.episodePseudonym.localeCompare(right.episodePseudonym, "en"));
    if (new Set(episodes.map(({ episodePseudonym }) => episodePseudonym)).size !== episodes.length) {
        throw new TypeError("DUPLICATE_HISTORICAL_EPISODE");
    }
    const versionTuples = [...new Set(episodes.map(({ versions }) => canonicalJson(versions)))].sort();
    const sourceCoverage = {
        AUGUST_CANARY: episodes.filter(({ sourceEvidence }) => sourceEvidence === "AUGUST_CANARY").length,
        PUBLIC_ISSUE_41: episodes.filter(({ sourceEvidence }) => sourceEvidence === "PUBLIC_ISSUE_41").length,
        PUBLIC_ISSUE_58: episodes.filter(({ sourceEvidence }) => sourceEvidence === "PUBLIC_ISSUE_58").length,
        SANITIZED_SYNTHETIC: episodes.filter(({ sourceEvidence }) => sourceEvidence === "SANITIZED_SYNTHETIC").length,
    };
    const unsigned = {
        schemaVersion: LEARNING_ROUTING_BASELINE_SCHEMA_V1,
        baselineVersion: LEARNING_ROUTING_BASELINE_VERSION_V1,
        episodeDigests: episodes.map(({ episodeDigest }) => episodeDigest),
        cohortDigest: digest(episodes.map(({ episodeDigest }) => episodeDigest)),
        versionDigest: digest(versionTuples),
        overall: metrics(episodes),
        byRouteClass: {
            STATIC: metrics(episodes.filter(({ routeClass }) => routeClass === "STATIC")),
            CURRENT: metrics(episodes.filter(({ routeClass }) => routeClass === "CURRENT")),
            CHEAP: metrics(episodes.filter(({ routeClass }) => routeClass === "CHEAP")),
            STRONG: metrics(episodes.filter(({ routeClass }) => routeClass === "STRONG")),
        },
        sourceCoverage,
        claimBoundary: "READ_ONLY_OFFLINE_NO_ROUTING_ACTIVATION",
    };
    return { ...unsigned, baselineDigest: digest(unsigned) };
}
