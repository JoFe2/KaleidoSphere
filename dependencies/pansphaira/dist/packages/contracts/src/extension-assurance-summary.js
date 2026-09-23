import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import { EXTENSION_ASSURANCE_CLAIM_BOUNDARY_V1, EXTENSION_ASSURANCE_RESULT_SCHEMA_V1, evaluateExtensionAssuranceProfileV1, extensionAssuranceProfileDigestV1, } from "./extension-assurance-profile.js";
export const EXTENSION_ASSURANCE_SUMMARY_INPUT_SCHEMA_V1 = "chimpmaera.extension-trust/assurance-summary-input/v1";
export const EXTENSION_ASSURANCE_SUMMARY_SCHEMA_V1 = "chimpmaera.extension-trust/assurance-summary/v1";
export const EXTENSION_ASSURANCE_SUMMARY_CLAIM_BOUNDARY_V1 = "LOCAL_SYNTHETIC_SUMMARY_ONLY_NO_TRUST_BADGE_NO_CERTIFICATION_NO_MALWARE_FREE_NO_ADMISSION_NO_MARKETPLACE_NO_ACTIVATION";
export const EXTENSION_ASSURANCE_SUMMARY_DENIAL_REASONS_V1 = [
    "SCHEMA_DENIED",
    "DIGEST_MISMATCH_DENIED",
    "RESULT_BINDING_DENIED",
    "PROFILE_RESULT_MISMATCH_DENIED",
    "EVIDENCE_MISSING_DENIED",
    "EVIDENCE_BINDING_DENIED",
    "TIME_REVERSAL_DENIED",
    "VERIFIER_BINDING_DENIED",
];
export const EXTENSION_ASSURANCE_SUMMARY_RESIDUAL_RISK_CODES_V1 = [
    "RESIDUAL_RISK_LOW",
    "RESIDUAL_RISK_MODERATE",
    "RESIDUAL_RISK_HIGH",
    "RESIDUAL_RISK_CRITICAL",
    "RESIDUAL_REVIEW_FAILURE_RISK",
    "RESIDUAL_FALSE_NEGATIVE_RISK",
    "RESIDUAL_OPEN_REVIEW_RISK",
];
export const EXTENSION_ASSURANCE_SUMMARY_COVERAGE_GAP_CODES_V1 = [
    "COVERAGE_GAP_NOT_APPLICABLE",
    "COVERAGE_GAP_PRIVATE_LAB_REQUIRED",
];
export const EXTENSION_ASSURANCE_SUMMARY_CHECK_REASONS_V1 = [
    "NONE",
    "NOT_APPLICABLE",
    "PRIVATE_LAB_REQUIRED",
];
const RESULT_OUTCOMES = ["PROFILE_CONFORMANT", "DENIED", "RETEST_REQUIRED"];
const RESULT_CLAIMS = [
    "LOCALLY_EVALUATED_SYNTHETIC", "ASSURANCE_DENIED", "EVIDENCE_EXPIRED_RETEST_REQUIRED", "INCONCLUSIVE",
];
const RESULT_REASONS = [
    "PROFILE_CONFORMANT", "SCHEMA_DENIED", "DIGEST_MISMATCH_DENIED", "UNIVERSAL_GATE_MISSING_DENIED",
    "REQUIRED_CHECK_NOT_RUN_DENIED", "HARD_FAIL_DENIED", "SECURITY_ROUTING_DENIED", "RETEST_CONTRACT_DENIED",
    "EVIDENCE_MISMATCH_RETEST_REQUIRED", "EVIDENCE_STALE_RETEST_REQUIRED", "FALSE_NEGATIVE_RETEST_REQUIRED",
];
const RESIDUAL_RISK_BY_CLASS = {
    LOW: "RESIDUAL_RISK_LOW",
    MODERATE: "RESIDUAL_RISK_MODERATE",
    HIGH: "RESIDUAL_RISK_HIGH",
    CRITICAL: "RESIDUAL_RISK_CRITICAL",
};
const COVERAGE_GAP_BY_NOT_RUN_REASON = {
    NOT_APPLICABLE: "COVERAGE_GAP_NOT_APPLICABLE",
    PRIVATE_LAB_REQUIRED: "COVERAGE_GAP_PRIVATE_LAB_REQUIRED",
};
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, keys) {
    return isRecord(value) && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}
function isId(value) {
    return typeof value === "string" && /^[a-z][a-z0-9-]{1,31}:[a-z0-9][a-z0-9._-]{2,95}$/.test(value);
}
function isSemver(value) {
    return typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value);
}
function isDigest(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function isArtifactRef(value) {
    return typeof value === "string" && /^artifact:sha256:[a-f0-9]{64}$/.test(value);
}
function isTimestamp(value) {
    return Number.isSafeInteger(value) && value >= 0;
}
function validResultObject(value) {
    return exactKeys(value, ["schemaVersion", "outcome", "reasonCodes", "publicClaim", "claimBoundary"])
        && value.schemaVersion === EXTENSION_ASSURANCE_RESULT_SCHEMA_V1
        && RESULT_OUTCOMES.includes(value.outcome)
        && Array.isArray(value.reasonCodes) && value.reasonCodes.length >= 1 && value.reasonCodes.length <= 16
        && value.reasonCodes.every((item) => typeof item === "string" && RESULT_REASONS.includes(item))
        && new Set(value.reasonCodes).size === value.reasonCodes.length
        && RESULT_CLAIMS.includes(value.publicClaim)
        && value.claimBoundary === EXTENSION_ASSURANCE_CLAIM_BOUNDARY_V1;
}
function validEvidenceBundle(value) {
    return exactKeys(value, ["collectedAtMs", "expiresAtMs", "subjectDigest", "artifactRefs"])
        && isTimestamp(value.collectedAtMs) && isTimestamp(value.expiresAtMs)
        && isDigest(value.subjectDigest)
        && Array.isArray(value.artifactRefs)
        && value.artifactRefs.every((item) => typeof item === "string" && isArtifactRef(item))
        && new Set(value.artifactRefs).size === value.artifactRefs.length;
}
function validVerifier(value) {
    return exactKeys(value, ["verifierId", "verifierVersion", "verifierDigest"])
        && isId(value.verifierId) && isSemver(value.verifierVersion) && isDigest(value.verifierDigest);
}
function validInput(value) {
    return exactKeys(value, ["schemaVersion", "profile", "result", "resultDigest", "evidence", "verifier", "nowMs"])
        && value.schemaVersion === EXTENSION_ASSURANCE_SUMMARY_INPUT_SCHEMA_V1
        && isRecord(value.profile) && validResultObject(value.result) && isDigest(value.resultDigest)
        && validEvidenceBundle(value.evidence) && validVerifier(value.verifier) && isTimestamp(value.nowMs);
}
function deny(reasonCodes) {
    return {
        schemaVersion: EXTENSION_ASSURANCE_SUMMARY_SCHEMA_V1,
        status: "DENIED",
        outcome: "INCONCLUSIVE",
        reasonCodes: [...reasonCodes],
        checks: [],
        residualRisks: [],
        coverageGaps: [],
        evidence: { status: "UNKNOWN", retestRequired: true, artifactRefs: [] },
        verifier: { verifierVersion: "", verifierDigest: "" },
        publicClaim: "INCONCLUSIVE",
        claimBoundary: EXTENSION_ASSURANCE_SUMMARY_CLAIM_BOUNDARY_V1,
    };
}
export function extensionAssuranceSummaryResultDigestV1(value) {
    return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
function verifierEnvelopeDigest(verifier) {
    const envelope = { verifierId: verifier.verifierId, verifierVersion: verifier.verifierVersion };
    return createHash("sha256").update(canonicalJson(envelope)).digest("hex");
}
export function summarizeExtensionAssuranceV1(value) {
    if (!validInput(value))
        return deny(["SCHEMA_DENIED"]);
    const input = value;
    const reasons = new Set();
    const evaluation = evaluateExtensionAssuranceProfileV1(input.profile);
    if (evaluation.outcome === "DENIED" && evaluation.reasonCodes.includes("SCHEMA_DENIED")) {
        reasons.add("SCHEMA_DENIED");
    }
    if (extensionAssuranceProfileDigestV1(input.profile)
        !== input.profile.profileDigest) {
        reasons.add("DIGEST_MISMATCH_DENIED");
    }
    if (extensionAssuranceSummaryResultDigestV1(input.result)
        !== input.resultDigest) {
        reasons.add("RESULT_BINDING_DENIED");
    }
    if (canonicalJson(evaluation) !== canonicalJson(input.result)) {
        reasons.add("PROFILE_RESULT_MISMATCH_DENIED");
    }
    const bundle = input.evidence;
    const bundleRefs = new Set(bundle.artifactRefs);
    const runChecks = input.profile.checks.filter((check) => check.runDecision === "RUN");
    if (bundle.artifactRefs.length === 0
        || runChecks.some((check) => check.evidenceRefs.some((artifactRef) => !bundleRefs.has(artifactRef)))) {
        reasons.add("EVIDENCE_MISSING_DENIED");
    }
    if (canonicalJson(bundle) !== canonicalJson(input.profile.evidence)
        || bundle.subjectDigest !== input.profile.subject.subjectDigest) {
        reasons.add("EVIDENCE_BINDING_DENIED");
    }
    if (input.nowMs < input.profile.evaluatedAtMs || input.nowMs < input.profile.evidence.collectedAtMs) {
        reasons.add("TIME_REVERSAL_DENIED");
    }
    if (verifierEnvelopeDigest(input.verifier) !== input.verifier.verifierDigest) {
        reasons.add("VERIFIER_BINDING_DENIED");
    }
    const ordered = EXTENSION_ASSURANCE_SUMMARY_DENIAL_REASONS_V1.filter((reason) => reasons.has(reason));
    if (ordered.length > 0)
        return deny(ordered);
    const profile = input.profile;
    const result = input.result;
    const expired = input.nowMs >= profile.evidence.expiresAtMs;
    const expiryRetest = expired && result.outcome !== "DENIED";
    const residualRisks = [RESIDUAL_RISK_BY_CLASS[profile.riskClass]];
    if (profile.checks.some((check) => check.ruleId === "OPTIONAL_MANUAL_REVIEW" && check.outcome === "FAIL")) {
        residualRisks.push("RESIDUAL_REVIEW_FAILURE_RISK");
    }
    if (profile.falseResultTracking.confirmedFalseNegativeCount > 0) {
        residualRisks.push("RESIDUAL_FALSE_NEGATIVE_RISK");
    }
    if (profile.falseResultTracking.openReviewCount > 0) {
        residualRisks.push("RESIDUAL_OPEN_REVIEW_RISK");
    }
    const coverageGaps = EXTENSION_ASSURANCE_SUMMARY_COVERAGE_GAP_CODES_V1.filter((code) => profile.checks.some((check) => check.runDecision === "NOT_RUN"
        && check.notRunReason !== "NONE"
        && COVERAGE_GAP_BY_NOT_RUN_REASON[check.notRunReason] === code));
    return {
        schemaVersion: EXTENSION_ASSURANCE_SUMMARY_SCHEMA_V1,
        status: "EMITTED",
        outcome: expiryRetest ? "RETEST_REQUIRED" : result.outcome,
        reasonCodes: expiryRetest ? ["EVIDENCE_STALE_RETEST_REQUIRED"] : [...result.reasonCodes],
        checks: profile.checks.map((check) => ({
            ruleId: check.ruleId,
            status: check.outcome,
            reason: check.outcome === "NOT_RUN" ? check.notRunReason : "NONE",
        })),
        residualRisks,
        coverageGaps,
        evidence: {
            status: expired ? "EXPIRED" : "VALID",
            retestRequired: expired || result.outcome === "RETEST_REQUIRED",
            artifactRefs: [...bundle.artifactRefs],
        },
        verifier: {
            verifierVersion: input.verifier.verifierVersion,
            verifierDigest: input.verifier.verifierDigest,
        },
        publicClaim: expiryRetest ? "EVIDENCE_EXPIRED_RETEST_REQUIRED" : result.publicClaim,
        claimBoundary: EXTENSION_ASSURANCE_SUMMARY_CLAIM_BOUNDARY_V1,
    };
}
export function renderPublicExtensionAssuranceSummaryV1(value) {
    return canonicalJson(summarizeExtensionAssuranceV1(value));
}
