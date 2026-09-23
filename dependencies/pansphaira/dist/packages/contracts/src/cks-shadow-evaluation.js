import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
/**
 * CKS-06 shadow-evaluation decision contract v1.
 *
 * This is an offline, paired, receipt-only contract. It compares a proposed
 * router's already-produced evidence with one pinned static fallback on the
 * identical task and Knowledge inputs. It never calls a provider, routes work,
 * activates a router, grants Authority, or changes the current OFF boundary.
 * Every quality and efficiency gate is conjunctive: cost cannot compensate for
 * a quality regression, and missing evidence is not a passing measurement.
 */
export const CKS_SHADOW_EVALUATION_SCHEMA_V1 = "chimpmaera.dev/cks-shadow-evaluation/v1";
export const CKS_SHADOW_EVALUATION_CLAIM_BOUNDARY_V1 = "OFFLINE_PAIRED_RECEIPT_EVIDENCE_ONLY_NO_ROUTING_ACTIVATION_NO_PROVIDER_CALL_NO_AUTHORITY_GRANT";
export const CKS_SHADOW_EVALUATION_MODE_V1 = "OFFLINE_PAIRED_RECEIPT_EVALUATION_ONLY";
export const CKS_SHADOW_ACTIVATION_MODE_V1 = "OFF";
export const CKS_SHADOW_REQUIRED_SCENARIO_TAGS_V1 = [
    "APPLICABILITY",
    "CLAIM_EVIDENCE_COVERAGE",
    "COMPETENCE_LIMIT",
    "CONFLICT",
    "DECOMPOSITION",
    "FRESH_UNKNOWN_DOMAIN",
    "MISSING_KNOWLEDGE",
    "PROCEDURE",
    "SUPERSESSION",
    "UPDATE_COMPLIANCE",
    "VERIFIER_REJECTION",
];
/** These values are copied from the frozen router decision, not caller-selected. */
export const CKS_SHADOW_EVALUATION_THRESHOLDS_V1 = {
    consecutiveWindows: 2,
    eligiblePairedEpisodesPerWindow: 100,
    totalEligiblePairedEpisodes: 200,
    freshEphemeralCertificationSeeds: 3,
    minimumEpisodesPerRequiredCKS03Family: 20,
    exactProfileBindingRatePpm: 1_000_000,
    terminalOutcomeCoveragePpm: 1_000_000,
    authorityOrCapabilityViolationCount: 0,
    providerCallOrRouteExecutionByRouterCount: 0,
    unsupportedMaterialClaimCount: 0,
    verifierFalseAcceptanceCount: 0,
    seedSplitOrLeakageViolationCount: 0,
    qualityDeltaPairedBootstrapLowerBoundPpmVersusFallback: -10_000,
    materialClaimCoverageWilsonLowerBoundPpm: 990_000,
    requiredGapConflictAbstentionWilsonLowerBoundPpm: 950_000,
    updateComplianceWilsonLowerBoundPpm: 950_000,
    costPerVerifiedSuccessReductionLowerBoundPpm: 100_000,
    p95ElapsedRatioUpperBoundPpmVersusFallback: 1_000_000,
    resourceAdmissionDenialCountForRecommendedEpisodes: 0,
    pairedBootstrapResamples: 10_000,
};
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const digest = (value) => createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
const isPlainObject = (value) => typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;
const hasExactKeys = (value, keys) => {
    if (!isPlainObject(value))
        return false;
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};
const isDigest = (value) => typeof value === "string" && DIGEST_PATTERN.test(value);
const isIdentifier = (value) => typeof value === "string" && value.length <= 128 && IDENTIFIER_PATTERN.test(value);
const isSafeInteger = (value) => typeof value === "number" && Number.isSafeInteger(value) && !Object.is(value, -0);
const isNonNegativeInteger = (value) => isSafeInteger(value) && value >= 0;
const isPositiveInteger = (value) => isNonNegativeInteger(value) && value >= 1;
const denied = (reason, detail) => ({ outcome: "DENIED", reason, detail });
/** Digest the manifest without its self-referential manifestDigest field. */
export function cksShadowEvaluationManifestDigestV1(manifest) {
    return digest(Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== "manifestDigest")));
}
/** Digest a window without its self-referential windowDigest field. */
export function cksShadowEvaluationWindowDigestV1(window) {
    return digest(Object.fromEntries(Object.entries(window).filter(([key]) => key !== "windowDigest")));
}
/** Digest the decision envelope without either self-referential receipt field. */
export function cksShadowEvaluationDecisionDigestV1(document) {
    return digest(Object.fromEntries(Object.entries(document)
        .filter(([key]) => key !== "decisionDigest" && key !== "receiptDigest")));
}
/** Digest the complete receipt without its self-referential receiptDigest field. */
export function cksShadowEvaluationReceiptDigestV1(document) {
    return digest(Object.fromEntries(Object.entries(document).filter(([key]) => key !== "receiptDigest")));
}
function manifestValid(value) {
    if (!hasExactKeys(value, [
        "evaluationMode", "baselineVersion", "baselineDigest", "baselineCohortDigest", "baselineVersionDigest",
        "taskCorpusDigest", "knowledgeEditionDigest", "pairedInputDigest", "routerPolicyDigest",
        "evaluationPolicyDigest", "freshEphemeralCertificationSeedDigests", "manifestDigest",
    ]) || value.evaluationMode !== CKS_SHADOW_EVALUATION_MODE_V1
        || !isIdentifier(value.baselineVersion)
        || !isDigest(value.baselineDigest)
        || !isDigest(value.baselineCohortDigest)
        || !isDigest(value.baselineVersionDigest)
        || !isDigest(value.taskCorpusDigest)
        || !isDigest(value.knowledgeEditionDigest)
        || !isDigest(value.pairedInputDigest)
        || !isDigest(value.routerPolicyDigest)
        || !isDigest(value.evaluationPolicyDigest)
        || !isDigest(value.manifestDigest)
        || !Array.isArray(value.freshEphemeralCertificationSeedDigests)
        || value.freshEphemeralCertificationSeedDigests.length !== CKS_SHADOW_EVALUATION_THRESHOLDS_V1.freshEphemeralCertificationSeeds
        || !value.freshEphemeralCertificationSeedDigests.every(isDigest)
        || new Set(value.freshEphemeralCertificationSeedDigests).size !== value.freshEphemeralCertificationSeedDigests.length)
        return false;
    return cksShadowEvaluationManifestDigestV1(value) === value.manifestDigest;
}
function thresholdsValid(value) {
    return hasExactKeys(value, Object.keys(CKS_SHADOW_EVALUATION_THRESHOLDS_V1))
        && canonicalJson(value) === canonicalJson(CKS_SHADOW_EVALUATION_THRESHOLDS_V1);
}
function evidenceValid(value) {
    if (!hasExactKeys(value, ["cks03", "cks04", "cks05"]))
        return false;
    for (const key of ["cks03", "cks04", "cks05"]) {
        const receipt = value[key];
        if (!hasExactKeys(receipt, ["status", "receiptDigest"])
            || !["POSITIVE", "UNKNOWN", "NOT_RUN", "FAILED"].includes(receipt.status)
            || !isDigest(receipt.receiptDigest))
            return false;
    }
    return true;
}
function metricsValid(value) {
    if (!isPlainObject(value) || ![
        "eligiblePairedEpisodes", "terminalOutcomeCoveragePpm", "exactProfileBindingRatePpm",
        "requiredCks03FamilyEpisodeCounts", "baselineVerifiedSuccesses", "shadowVerifiedSuccesses",
        "qualityDeltaPairedBootstrapLowerBoundPpmVersusFallback", "materialClaimCoverageWilsonLowerBoundPpm",
        "requiredGapConflictAbstentionWilsonLowerBoundPpm", "updateComplianceWilsonLowerBoundPpm",
        "authorityOrCapabilityViolationCount", "providerCallOrRouteExecutionByRouterCount",
        "unsupportedMaterialClaimCount", "verifierFalseAcceptanceCount", "seedSplitOrLeakageViolationCount",
        "baselineCostPerVerifiedSuccessMicros", "shadowCostPerVerifiedSuccessMicros",
        "costPerVerifiedSuccessReductionLowerBoundPpm", "baselineP95ElapsedMs", "shadowP95ElapsedMs",
        "p95ElapsedRatioUpperBoundPpmVersusFallback", "resourceAdmissionDenialCountForRecommendedEpisodes",
    ].every((key) => key in value))
        return false;
    const record = value;
    const nonNegativeFields = [
        "eligiblePairedEpisodes", "terminalOutcomeCoveragePpm", "exactProfileBindingRatePpm",
        "baselineVerifiedSuccesses", "shadowVerifiedSuccesses", "materialClaimCoverageWilsonLowerBoundPpm",
        "requiredGapConflictAbstentionWilsonLowerBoundPpm", "updateComplianceWilsonLowerBoundPpm",
        "authorityOrCapabilityViolationCount", "providerCallOrRouteExecutionByRouterCount",
        "unsupportedMaterialClaimCount", "verifierFalseAcceptanceCount", "seedSplitOrLeakageViolationCount",
        "baselineCostPerVerifiedSuccessMicros", "shadowCostPerVerifiedSuccessMicros",
        "baselineP95ElapsedMs", "shadowP95ElapsedMs", "p95ElapsedRatioUpperBoundPpmVersusFallback",
        "resourceAdmissionDenialCountForRecommendedEpisodes",
    ];
    if (!nonNegativeFields.every((field) => isNonNegativeInteger(record[field])))
        return false;
    if (!isSafeInteger(record.qualityDeltaPairedBootstrapLowerBoundPpmVersusFallback)
        || !isSafeInteger(record.costPerVerifiedSuccessReductionLowerBoundPpm))
        return false;
    const familyCounts = record.requiredCks03FamilyEpisodeCounts;
    if (!isPlainObject(familyCounts)
        || !hasExactKeys(familyCounts, CKS_SHADOW_REQUIRED_SCENARIO_TAGS_V1)
        || !CKS_SHADOW_REQUIRED_SCENARIO_TAGS_V1.every((tag) => isNonNegativeInteger(familyCounts[tag])))
        return false;
    if (record.terminalOutcomeCoveragePpm > 1_000_000 || record.exactProfileBindingRatePpm > 1_000_000
        || record.materialClaimCoverageWilsonLowerBoundPpm > 1_000_000
        || record.requiredGapConflictAbstentionWilsonLowerBoundPpm > 1_000_000
        || record.updateComplianceWilsonLowerBoundPpm > 1_000_000
        || record.baselineVerifiedSuccesses < 1 || record.shadowVerifiedSuccesses < 1
        || record.baselineCostPerVerifiedSuccessMicros < 1 || record.baselineP95ElapsedMs < 1 || record.shadowP95ElapsedMs < 1)
        return false;
    const expectedCostReduction = Math.floor((record.baselineCostPerVerifiedSuccessMicros - record.shadowCostPerVerifiedSuccessMicros)
        * 1_000_000 / record.baselineCostPerVerifiedSuccessMicros);
    const expectedLatencyRatio = Math.ceil(record.shadowP95ElapsedMs * 1_000_000 / record.baselineP95ElapsedMs);
    return record.costPerVerifiedSuccessReductionLowerBoundPpm === expectedCostReduction
        && record.p95ElapsedRatioUpperBoundPpmVersusFallback === expectedLatencyRatio;
}
function windowValid(value) {
    if (!hasExactKeys(value, [
        "windowId", "windowOrdinal", "startedAtMs", "endedAtMs", "manifestDigest", "baselineDigest",
        "pairedInputDigest", "requiredEvidence", "eligiblePairedEpisodes", "terminalOutcomeCoveragePpm",
        "exactProfileBindingRatePpm", "requiredCks03FamilyEpisodeCounts", "baselineVerifiedSuccesses",
        "shadowVerifiedSuccesses", "qualityDeltaPairedBootstrapLowerBoundPpmVersusFallback",
        "materialClaimCoverageWilsonLowerBoundPpm", "requiredGapConflictAbstentionWilsonLowerBoundPpm",
        "updateComplianceWilsonLowerBoundPpm", "authorityOrCapabilityViolationCount",
        "providerCallOrRouteExecutionByRouterCount", "unsupportedMaterialClaimCount",
        "verifierFalseAcceptanceCount", "seedSplitOrLeakageViolationCount",
        "baselineCostPerVerifiedSuccessMicros", "shadowCostPerVerifiedSuccessMicros",
        "costPerVerifiedSuccessReductionLowerBoundPpm", "baselineP95ElapsedMs", "shadowP95ElapsedMs",
        "p95ElapsedRatioUpperBoundPpmVersusFallback", "resourceAdmissionDenialCountForRecommendedEpisodes",
        "windowDigest",
    ]) || !isIdentifier(value.windowId)
        || (value.windowOrdinal !== 0 && value.windowOrdinal !== 1)
        || !isNonNegativeInteger(value.startedAtMs) || !isNonNegativeInteger(value.endedAtMs)
        || value.endedAtMs <= value.startedAtMs
        || !isDigest(value.manifestDigest) || !isDigest(value.baselineDigest) || !isDigest(value.pairedInputDigest)
        || !evidenceValid(value.requiredEvidence) || !metricsValid(value) || !isDigest(value.windowDigest))
        return false;
    return cksShadowEvaluationWindowDigestV1(value) === value.windowDigest;
}
function commonInputValid(value) {
    if (!hasExactKeys(value, ["schemaVersion", "evaluationId", "manifest", "thresholds", "windows"])
        || value.schemaVersion !== CKS_SHADOW_EVALUATION_SCHEMA_V1
        || !isIdentifier(value.evaluationId)
        || !manifestValid(value.manifest)
        || !thresholdsValid(value.thresholds)
        || !Array.isArray(value.windows)
        || value.windows.length !== CKS_SHADOW_EVALUATION_THRESHOLDS_V1.consecutiveWindows
        || !value.windows.every(windowValid))
        return false;
    const manifest = value.manifest;
    const windows = value.windows;
    return windows.every((window) => window.manifestDigest === manifest.manifestDigest
        && window.baselineDigest === manifest.baselineDigest
        && window.pairedInputDigest === manifest.pairedInputDigest);
}
function windowGateState(window) {
    const thresholds = CKS_SHADOW_EVALUATION_THRESHOLDS_V1;
    const familiesPass = CKS_SHADOW_REQUIRED_SCENARIO_TAGS_V1.every((tag) => window.requiredCks03FamilyEpisodeCounts[tag] >= thresholds.minimumEpisodesPerRequiredCKS03Family);
    return {
        minimumEvidence: window.eligiblePairedEpisodes >= thresholds.eligiblePairedEpisodesPerWindow
            && window.terminalOutcomeCoveragePpm === thresholds.terminalOutcomeCoveragePpm
            && window.exactProfileBindingRatePpm === thresholds.exactProfileBindingRatePpm
            && familiesPass,
        cksEvidence: window.requiredEvidence.cks03.status === "POSITIVE"
            && window.requiredEvidence.cks04.status === "POSITIVE"
            && window.requiredEvidence.cks05.status === "POSITIVE",
        quality: window.authorityOrCapabilityViolationCount === thresholds.authorityOrCapabilityViolationCount
            && window.providerCallOrRouteExecutionByRouterCount === thresholds.providerCallOrRouteExecutionByRouterCount
            && window.unsupportedMaterialClaimCount === thresholds.unsupportedMaterialClaimCount
            && window.verifierFalseAcceptanceCount === thresholds.verifierFalseAcceptanceCount
            && window.seedSplitOrLeakageViolationCount === thresholds.seedSplitOrLeakageViolationCount
            && window.qualityDeltaPairedBootstrapLowerBoundPpmVersusFallback >= thresholds.qualityDeltaPairedBootstrapLowerBoundPpmVersusFallback
            && window.materialClaimCoverageWilsonLowerBoundPpm >= thresholds.materialClaimCoverageWilsonLowerBoundPpm
            && window.requiredGapConflictAbstentionWilsonLowerBoundPpm >= thresholds.requiredGapConflictAbstentionWilsonLowerBoundPpm
            && window.updateComplianceWilsonLowerBoundPpm >= thresholds.updateComplianceWilsonLowerBoundPpm,
        efficiency: window.costPerVerifiedSuccessReductionLowerBoundPpm >= thresholds.costPerVerifiedSuccessReductionLowerBoundPpm
            && window.p95ElapsedRatioUpperBoundPpmVersusFallback <= thresholds.p95ElapsedRatioUpperBoundPpmVersusFallback
            && window.resourceAdmissionDenialCountForRecommendedEpisodes === thresholds.resourceAdmissionDenialCountForRecommendedEpisodes,
    };
}
function expectedReasonCodes(input) {
    const windows = input.windows;
    const sequenceValid = windows[0].windowOrdinal === 0 && windows[1].windowOrdinal === 1
        && windows[0].startedAtMs <= windows[0].endedAtMs
        && windows[0].endedAtMs <= windows[1].startedAtMs
        && windows[1].startedAtMs <= windows[1].endedAtMs;
    const minimumEvidence = windows.reduce((total, window) => total + (windowGateState(window).minimumEvidence ? window.eligiblePairedEpisodes : 0), 0)
        === CKS_SHADOW_EVALUATION_THRESHOLDS_V1.totalEligiblePairedEpisodes
        && sequenceValid;
    const states = windows.map(windowGateState);
    const reasons = [];
    if (!sequenceValid)
        reasons.push("WINDOW_SEQUENCE_INVALID");
    if (!minimumEvidence)
        reasons.push("MINIMUM_EVIDENCE_NOT_MET");
    if (states.some((state) => !state.cksEvidence))
        reasons.push("CKS_EVIDENCE_NOT_POSITIVE");
    if (states.some((state) => !state.quality))
        reasons.push("QUALITY_GATE_FAILED");
    if (states.some((state) => !state.efficiency))
        reasons.push("EFFICIENCY_GATE_FAILED");
    return reasons.length === 0 ? ["ALL_FROZEN_GATES_PASS"] : reasons;
}
function unsignedDecision(input) {
    const reasonCodes = expectedReasonCodes(input);
    return {
        ...input,
        claimBoundary: CKS_SHADOW_EVALUATION_CLAIM_BOUNDARY_V1,
        outcome: reasonCodes.length === 1 && reasonCodes[0] === "ALL_FROZEN_GATES_PASS"
            ? "ACTIVATION_ELIGIBLE_FOR_SEPARATE_AUTHORIZATION"
            : "ACTIVATION_BLOCKED",
        reasonCodes,
        activationMode: CKS_SHADOW_ACTIVATION_MODE_V1,
        passedWindowCount: input.windows.filter((window) => {
            const state = windowGateState(window);
            return state.minimumEvidence && state.cksEvidence && state.quality && state.efficiency;
        }).length,
    };
}
/**
 * Evaluate a complete common input into a deterministic, digest-bound receipt.
 * Invalid input returns a blocked result with no activation claim.
 */
export function evaluateCksShadowEvaluationV1(input) {
    if (!commonInputValid(input)) {
        return {
            outcome: "ACTIVATION_BLOCKED",
            reasonCodes: ["MALFORMED_INPUT"],
            activationMode: CKS_SHADOW_ACTIVATION_MODE_V1,
        };
    }
    const unsigned = unsignedDecision(input);
    const decisionDigest = cksShadowEvaluationDecisionDigestV1(unsigned);
    const withDecision = { ...unsigned, decisionDigest };
    return { ...withDecision, receiptDigest: cksShadowEvaluationReceiptDigestV1(withDecision) };
}
/**
 * Validate a receipt and recompute every pinned binding and frozen gate. A
 * positive result means only that the evidence is sufficient to consider a
 * separately authorized transition; it is not an activation or route result.
 */
export function validateCksShadowEvaluationV1(input) {
    if (!isPlainObject(input) || !hasExactKeys(input, [
        "schemaVersion", "evaluationId", "manifest", "thresholds", "windows", "claimBoundary", "outcome",
        "reasonCodes", "activationMode", "passedWindowCount", "decisionDigest", "receiptDigest",
    ]))
        return denied("MALFORMED_INPUT", "closed top-level envelope");
    const common = {
        schemaVersion: input.schemaVersion,
        evaluationId: input.evaluationId,
        manifest: input.manifest,
        thresholds: input.thresholds,
        windows: input.windows,
    };
    if (!commonInputValid(common))
        return denied("MALFORMED_INPUT", "closed evidence input");
    if (input.claimBoundary !== CKS_SHADOW_EVALUATION_CLAIM_BOUNDARY_V1
        || input.activationMode !== CKS_SHADOW_ACTIVATION_MODE_V1
        || !isNonNegativeInteger(input.passedWindowCount)
        || !Array.isArray(input.reasonCodes)
        || !input.reasonCodes.every((reason) => typeof reason === "string"))
        return denied("MALFORMED_INPUT", "decision boundary");
    const expected = unsignedDecision(common);
    if (canonicalJson(input.reasonCodes) !== canonicalJson(expected.reasonCodes)
        || input.outcome !== expected.outcome
        || input.passedWindowCount !== expected.passedWindowCount)
        return denied("DIGEST_MISMATCH", "decision does not match recomputed gates");
    if (!isDigest(input.decisionDigest) || cksShadowEvaluationDecisionDigestV1(input) !== input.decisionDigest) {
        return denied("DIGEST_MISMATCH", "decisionDigest");
    }
    if (!isDigest(input.receiptDigest) || cksShadowEvaluationReceiptDigestV1(input) !== input.receiptDigest) {
        return denied("DIGEST_MISMATCH", "receiptDigest");
    }
    return {
        outcome: "VALID",
        evaluationOutcome: input.outcome,
        reasonCodes: input.reasonCodes,
        decisionDigest: input.decisionDigest,
        receiptDigest: input.receiptDigest,
    };
}
export const evaluateCksShadowEvaluationDecisionV1 = evaluateCksShadowEvaluationV1;
export const validateCksShadowEvaluationDecisionV1 = validateCksShadowEvaluationV1;
