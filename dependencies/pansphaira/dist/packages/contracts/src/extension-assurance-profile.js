import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
export const EXTENSION_ASSURANCE_PROFILE_SCHEMA_V1 = "chimpmaera.extension-trust/assurance-profile/v1";
export const EXTENSION_ASSURANCE_RESULT_SCHEMA_V1 = "chimpmaera.extension-trust/assurance-result/v1";
export const EXTENSION_ASSURANCE_CLAIM_BOUNDARY_V1 = "LOCAL_SYNTHETIC_PROFILE_ONLY_NO_TRUST_BADGE_NO_ACCEPTANCE_NO_ACTIVATION_NO_EXECUTION";
export const EXTENSION_ASSURANCE_HARD_FAIL_RULES_V1 = [
    "MALWARE_SIGNAL",
    "CREDENTIAL_ACCESS",
    "AUTHORITY_EXPANSION",
    "UNBOUNDED_NETWORK_EGRESS",
    "UNVERIFIED_EXECUTABLE",
    "PROHIBITED_DATA_DISCLOSURE",
    "SIGNATURE_OR_DIGEST_MISMATCH",
    "EVIDENCE_TAMPER",
];
export const EXTENSION_ASSURANCE_RETEST_TRIGGERS_V1 = [
    "SUBJECT_CHANGED",
    "PROFILE_CHANGED",
    "EVIDENCE_EXPIRED",
    "POLICY_CHANGED",
    "FALSE_NEGATIVE_CONFIRMED",
    "MANUAL",
];
const REASON_ORDER = [
    "SCHEMA_DENIED",
    "DIGEST_MISMATCH_DENIED",
    "UNIVERSAL_GATE_MISSING_DENIED",
    "REQUIRED_CHECK_NOT_RUN_DENIED",
    "HARD_FAIL_DENIED",
    "SECURITY_ROUTING_DENIED",
    "RETEST_CONTRACT_DENIED",
    "EVIDENCE_MISMATCH_RETEST_REQUIRED",
    "EVIDENCE_STALE_RETEST_REQUIRED",
    "FALSE_NEGATIVE_RETEST_REQUIRED",
];
const DENIAL_REASONS = new Set([
    "SCHEMA_DENIED",
    "DIGEST_MISMATCH_DENIED",
    "UNIVERSAL_GATE_MISSING_DENIED",
    "REQUIRED_CHECK_NOT_RUN_DENIED",
    "HARD_FAIL_DENIED",
    "SECURITY_ROUTING_DENIED",
    "RETEST_CONTRACT_DENIED",
]);
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
function isDigest(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function isArtifactRef(value) {
    return typeof value === "string" && /^artifact:sha256:[a-f0-9]{64}$/.test(value);
}
// Canonical numbers are raw values, not JSON text: -0 must fail closed even
// though canonicalJson re-serializes it as 0 and the digest cannot tell them apart.
function isCanonicalNonNegativeNumber(value) {
    return Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
}
function isTimestamp(value) {
    return isCanonicalNonNegativeNumber(value);
}
function isCount(value) {
    return isCanonicalNonNegativeNumber(value);
}
function isUniqueArray(value, predicate, allowEmpty = false) {
    return Array.isArray(value) && (allowEmpty || value.length > 0) && value.every(predicate)
        && new Set(value).size === value.length;
}
function validSubject(value) {
    return exactKeys(value, ["kind", "subjectId", "subjectVersion", "subjectDigest"])
        && ["EXTENSION", "CONNECTOR"].includes(value.kind)
        && isId(value.subjectId) && typeof value.subjectVersion === "string"
        && /^\d+\.\d+\.\d+$/.test(value.subjectVersion) && isDigest(value.subjectDigest);
}
function validEvidence(value) {
    return exactKeys(value, ["collectedAtMs", "expiresAtMs", "subjectDigest", "artifactRefs"])
        && isTimestamp(value.collectedAtMs) && isTimestamp(value.expiresAtMs)
        && isDigest(value.subjectDigest) && isUniqueArray(value.artifactRefs, isArtifactRef);
}
function isRule(value) {
    return typeof value === "string"
        && [...EXTENSION_ASSURANCE_HARD_FAIL_RULES_V1, "OPTIONAL_MANUAL_REVIEW"].includes(value);
}
function validCheck(value) {
    if (!exactKeys(value, ["checkId", "ruleId", "runDecision", "outcome", "notRunReason", "evidenceRefs"])
        || !isId(value.checkId) || !isRule(value.ruleId)
        || !["RUN", "NOT_RUN"].includes(value.runDecision)
        || !["PASS", "FAIL", "NOT_RUN"].includes(value.outcome)
        || !["NONE", "NOT_APPLICABLE", "PRIVATE_LAB_REQUIRED"].includes(value.notRunReason)
        || !isUniqueArray(value.evidenceRefs, isArtifactRef, true))
        return false;
    if (value.runDecision === "RUN") {
        return ["PASS", "FAIL"].includes(value.outcome)
            && value.notRunReason === "NONE" && value.evidenceRefs.length > 0;
    }
    return value.outcome === "NOT_RUN" && value.notRunReason !== "NONE" && value.evidenceRefs.length === 0;
}
function validFalseResultTracking(value) {
    return exactKeys(value, [
        "confirmedFalsePositiveCount", "confirmedFalseNegativeCount", "openReviewCount", "reviewedAtMs", "evidenceRefs",
    ]) && isCount(value.confirmedFalsePositiveCount) && isCount(value.confirmedFalseNegativeCount)
        && isCount(value.openReviewCount) && isTimestamp(value.reviewedAtMs)
        && isUniqueArray(value.evidenceRefs, isArtifactRef, true);
}
function validSecurityRouting(value) {
    return exactKeys(value, ["classification", "route", "publicDetail"])
        && ["PUBLIC_SAFE", "SECURITY_SENSITIVE"].includes(value.classification)
        && ["PUBLIC_EVIDENCE", "SECURITY_POLICY_PRIVATE"].includes(value.route)
        && ["FIXED_REASON_CODES_ONLY", "NONE"].includes(value.publicDetail);
}
function validProfile(value) {
    if (!exactKeys(value, [
        "schemaVersion", "profileId", "profileVersion", "subject", "riskClass", "evaluatedAtMs", "evidence",
        "checks", "retestTriggers", "falseResultTracking", "securityRouting", "publicClaim", "claimBoundary", "profileDigest",
    ]))
        return false;
    const retestTrigger = (item) => typeof item === "string"
        && EXTENSION_ASSURANCE_RETEST_TRIGGERS_V1.includes(item);
    const claims = [
        "LOCALLY_EVALUATED_SYNTHETIC", "ASSURANCE_DENIED", "EVIDENCE_EXPIRED_RETEST_REQUIRED", "INCONCLUSIVE",
    ];
    return value.schemaVersion === EXTENSION_ASSURANCE_PROFILE_SCHEMA_V1 && isId(value.profileId)
        && typeof value.profileVersion === "string" && /^\d+\.\d+\.\d+$/.test(value.profileVersion)
        && validSubject(value.subject) && ["LOW", "MODERATE", "HIGH", "CRITICAL"].includes(value.riskClass)
        && isTimestamp(value.evaluatedAtMs) && validEvidence(value.evidence)
        && Array.isArray(value.checks) && value.checks.length > 0 && value.checks.length <= 32
        && value.checks.every(validCheck) && new Set(value.checks.map(({ ruleId }) => ruleId)).size === value.checks.length
        && isUniqueArray(value.retestTriggers, retestTrigger) && validFalseResultTracking(value.falseResultTracking)
        && validSecurityRouting(value.securityRouting) && claims.includes(value.publicClaim)
        && value.claimBoundary === EXTENSION_ASSURANCE_CLAIM_BOUNDARY_V1 && isDigest(value.profileDigest);
}
export function extensionAssuranceProfileDigestV1(value) {
    const unsigned = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "profileDigest"));
    return createHash("sha256").update(canonicalJson(unsigned)).digest("hex");
}
export function evaluateExtensionAssuranceProfileV1(value) {
    if (!validProfile(value)) {
        return {
            schemaVersion: EXTENSION_ASSURANCE_RESULT_SCHEMA_V1,
            outcome: "DENIED",
            reasonCodes: ["SCHEMA_DENIED"],
            publicClaim: "INCONCLUSIVE",
            claimBoundary: EXTENSION_ASSURANCE_CLAIM_BOUNDARY_V1,
        };
    }
    const reasons = new Set();
    if (extensionAssuranceProfileDigestV1(value) !== value.profileDigest) {
        reasons.add("DIGEST_MISMATCH_DENIED");
    }
    const checks = new Map(value.checks.map((check) => [check.ruleId, check]));
    for (const ruleId of EXTENSION_ASSURANCE_HARD_FAIL_RULES_V1) {
        const check = checks.get(ruleId);
        if (check === undefined)
            reasons.add("UNIVERSAL_GATE_MISSING_DENIED");
        else if (check.runDecision !== "RUN")
            reasons.add("REQUIRED_CHECK_NOT_RUN_DENIED");
        else if (check.outcome === "FAIL")
            reasons.add("HARD_FAIL_DENIED");
    }
    const routing = value.securityRouting;
    const routingValid = routing.classification === "SECURITY_SENSITIVE"
        ? routing.route === "SECURITY_POLICY_PRIVATE" && routing.publicDetail === "NONE"
        : routing.route === "PUBLIC_EVIDENCE" && routing.publicDetail === "FIXED_REASON_CODES_ONLY";
    if (!routingValid)
        reasons.add("SECURITY_ROUTING_DENIED");
    if (!EXTENSION_ASSURANCE_RETEST_TRIGGERS_V1.every((trigger) => value.retestTriggers.includes(trigger))) {
        reasons.add("RETEST_CONTRACT_DENIED");
    }
    if (value.evidence.subjectDigest !== value.subject.subjectDigest) {
        reasons.add("EVIDENCE_MISMATCH_RETEST_REQUIRED");
    }
    if (value.evidence.expiresAtMs <= value.evidence.collectedAtMs
        || value.evaluatedAtMs > value.evidence.expiresAtMs) {
        reasons.add("EVIDENCE_STALE_RETEST_REQUIRED");
    }
    if (value.falseResultTracking.confirmedFalseNegativeCount > 0) {
        reasons.add("FALSE_NEGATIVE_RETEST_REQUIRED");
    }
    const ordered = REASON_ORDER.filter((reason) => reasons.has(reason));
    if (ordered.some((reason) => DENIAL_REASONS.has(reason))) {
        return {
            schemaVersion: EXTENSION_ASSURANCE_RESULT_SCHEMA_V1,
            outcome: "DENIED",
            reasonCodes: ordered,
            publicClaim: "ASSURANCE_DENIED",
            claimBoundary: EXTENSION_ASSURANCE_CLAIM_BOUNDARY_V1,
        };
    }
    if (ordered.length > 0) {
        return {
            schemaVersion: EXTENSION_ASSURANCE_RESULT_SCHEMA_V1,
            outcome: "RETEST_REQUIRED",
            reasonCodes: ordered,
            publicClaim: "EVIDENCE_EXPIRED_RETEST_REQUIRED",
            claimBoundary: EXTENSION_ASSURANCE_CLAIM_BOUNDARY_V1,
        };
    }
    return {
        schemaVersion: EXTENSION_ASSURANCE_RESULT_SCHEMA_V1,
        outcome: "PROFILE_CONFORMANT",
        reasonCodes: ["PROFILE_CONFORMANT"],
        publicClaim: "LOCALLY_EVALUATED_SYNTHETIC",
        claimBoundary: EXTENSION_ASSURANCE_CLAIM_BOUNDARY_V1,
    };
}
export function renderPublicExtensionAssuranceResultV1(value) {
    return canonicalJson(evaluateExtensionAssuranceProfileV1(value));
}
