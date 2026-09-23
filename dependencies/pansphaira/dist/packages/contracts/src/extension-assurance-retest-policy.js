import { canonicalJson } from "./canonical-json.js";
import { EXTENSION_ASSURANCE_CLAIM_BOUNDARY_V1, EXTENSION_ASSURANCE_RETEST_TRIGGERS_V1, evaluateExtensionAssuranceProfileV1, extensionAssuranceProfileDigestV1, } from "./extension-assurance-profile.js";
export const EXTENSION_ASSURANCE_RETEST_POLICY_INPUT_SCHEMA_V1 = "chimpmaera.extension-trust/assurance-retest-policy-input/v1";
export const EXTENSION_ASSURANCE_RETEST_DECISION_SCHEMA_V1 = "chimpmaera.extension-trust/assurance-retest-decision/v1";
export const EXTENSION_ASSURANCE_RETEST_DENIAL_REASONS_V1 = [
    "SCHEMA_DENIED",
    "PRIOR_PROFILE_INVALID_DENIED",
    "PRIOR_BINDING_MISMATCH_DENIED",
    "TIME_REVERSAL_DENIED",
];
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
function isTimestamp(value) {
    return Number.isSafeInteger(value) && value >= 0;
}
function isCount(value) {
    return Number.isSafeInteger(value) && value >= 0;
}
function validSubject(value) {
    return exactKeys(value, ["kind", "subjectId", "subjectVersion", "subjectDigest"])
        && ["EXTENSION", "CONNECTOR"].includes(value.kind)
        && isId(value.subjectId) && isSemver(value.subjectVersion) && isDigest(value.subjectDigest);
}
function validPolicyRef(value) {
    return exactKeys(value, ["policyId", "policyVersion", "policyDigest"])
        && isId(value.policyId) && isSemver(value.policyVersion) && isDigest(value.policyDigest);
}
function validCurrentProfile(value) {
    return exactKeys(value, ["profileId", "profileVersion", "profileDigest"])
        && isId(value.profileId) && isSemver(value.profileVersion) && isDigest(value.profileDigest);
}
function validEvidence(value) {
    return exactKeys(value, ["collectedAtMs", "expiresAtMs"])
        && isTimestamp(value.collectedAtMs) && isTimestamp(value.expiresAtMs);
}
function validFalseNegative(value) {
    return exactKeys(value, ["confirmedCount", "reviewedAtMs"])
        && isCount(value.confirmedCount) && isTimestamp(value.reviewedAtMs);
}
function validManual(value) {
    return exactKeys(value, ["requested", "requestedAtMs"])
        && typeof value.requested === "boolean" && isTimestamp(value.requestedAtMs);
}
function validInput(value) {
    if (!exactKeys(value, ["schemaVersion", "prior", "current"])
        || value.schemaVersion !== EXTENSION_ASSURANCE_RETEST_POLICY_INPUT_SCHEMA_V1)
        return false;
    if (!exactKeys(value.prior, ["profile", "profileDigest", "policy"])
        || !isRecord(value.prior.profile) || !isDigest(value.prior.profileDigest)
        || !validPolicyRef(value.prior.policy))
        return false;
    return exactKeys(value.current, [
        "subject", "profile", "policy", "evidence", "falseNegative", "manual", "nowMs",
    ]) && validSubject(value.current.subject) && validCurrentProfile(value.current.profile)
        && validPolicyRef(value.current.policy) && validEvidence(value.current.evidence)
        && validFalseNegative(value.current.falseNegative) && validManual(value.current.manual)
        && isTimestamp(value.current.nowMs);
}
function deny(reasonCodes) {
    return {
        schemaVersion: EXTENSION_ASSURANCE_RETEST_DECISION_SCHEMA_V1,
        decision: "DENY",
        triggers: [],
        reasonCodes: [...reasonCodes],
        claimBoundary: EXTENSION_ASSURANCE_CLAIM_BOUNDARY_V1,
    };
}
export function decideExtensionAssuranceRetestV1(value) {
    if (!validInput(value))
        return deny(["SCHEMA_DENIED"]);
    const input = value;
    const prior = input.prior.profile;
    const current = input.current;
    const reasons = new Set();
    if (evaluateExtensionAssuranceProfileV1(prior).outcome !== "PROFILE_CONFORMANT") {
        reasons.add("PRIOR_PROFILE_INVALID_DENIED");
    }
    if (extensionAssuranceProfileDigestV1(prior) !== input.prior.profileDigest) {
        reasons.add("PRIOR_BINDING_MISMATCH_DENIED");
    }
    if (current.nowMs < prior.evaluatedAtMs
        || current.nowMs < current.evidence.collectedAtMs
        || current.evidence.expiresAtMs <= current.evidence.collectedAtMs
        || current.falseNegative.reviewedAtMs > current.nowMs
        || current.manual.requestedAtMs > current.nowMs) {
        reasons.add("TIME_REVERSAL_DENIED");
    }
    const denial = EXTENSION_ASSURANCE_RETEST_DENIAL_REASONS_V1.filter((reason) => reasons.has(reason));
    if (denial.length > 0)
        return deny(denial);
    const triggered = new Set();
    if (current.subject.kind !== prior.subject.kind
        || current.subject.subjectId !== prior.subject.subjectId
        || current.subject.subjectVersion !== prior.subject.subjectVersion
        || current.subject.subjectDigest !== prior.subject.subjectDigest) {
        triggered.add("SUBJECT_CHANGED");
    }
    if (current.profile.profileId !== prior.profileId
        || current.profile.profileVersion !== prior.profileVersion
        || current.profile.profileDigest !== prior.profileDigest) {
        triggered.add("PROFILE_CHANGED");
    }
    if (current.nowMs >= current.evidence.expiresAtMs)
        triggered.add("EVIDENCE_EXPIRED");
    if (current.policy.policyId !== input.prior.policy.policyId
        || current.policy.policyVersion !== input.prior.policy.policyVersion
        || current.policy.policyDigest !== input.prior.policy.policyDigest) {
        triggered.add("POLICY_CHANGED");
    }
    if (current.falseNegative.confirmedCount > 0)
        triggered.add("FALSE_NEGATIVE_CONFIRMED");
    if (current.manual.requested === true)
        triggered.add("MANUAL");
    const triggers = EXTENSION_ASSURANCE_RETEST_TRIGGERS_V1.filter((trigger) => triggered.has(trigger));
    return {
        schemaVersion: EXTENSION_ASSURANCE_RETEST_DECISION_SCHEMA_V1,
        decision: triggers.length > 0 ? "RETEST_REQUIRED" : "RETAIN",
        triggers,
        reasonCodes: [triggers.length > 0 ? "RETEST_TRIGGERED" : "RETEST_POLICY_RETAIN"],
        claimBoundary: EXTENSION_ASSURANCE_CLAIM_BOUNDARY_V1,
    };
}
export function renderExtensionAssuranceRetestDecisionV1(value) {
    return canonicalJson(decideExtensionAssuranceRetestV1(value));
}
