import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
export const EXTENSION_ASSURANCE_SECURITY_ROUTING_INPUT_SCHEMA_V1 = "chimpmaera.extension-trust/assurance-security-routing-input/v1";
export const EXTENSION_ASSURANCE_SECURITY_ROUTING_DECISION_SCHEMA_V1 = "chimpmaera.extension-trust/assurance-security-routing-decision/v1";
export const EXTENSION_ASSURANCE_SECURITY_ROUTING_CLAIM_BOUNDARY_V1 = "LOCAL_SYNTHETIC_SECURITY_ROUTING_ONLY_NO_TRUST_BADGE_NO_ADMISSION_NO_PUBLICATION_NO_RELEASE";
export const EXTENSION_ASSURANCE_SEVERITIES_V1 = [
    "LOW",
    "MODERATE",
    "HIGH",
    "CRITICAL",
];
export const EXTENSION_ASSURANCE_FINDING_CLASSES_V1 = [
    "CREDENTIAL",
    "PERSONAL_DATA",
    "EXPLOIT",
    "SECURITY_SENSITIVE",
    "PUBLIC_SAFE_SYNTHETIC",
];
export const EXTENSION_ASSURANCE_SENSITIVE_FINDING_CLASSES_V1 = [
    "CREDENTIAL",
    "PERSONAL_DATA",
    "EXPLOIT",
    "SECURITY_SENSITIVE",
];
export const EXTENSION_ASSURANCE_SECURITY_ROUTING_REASON_CODES_V1 = [
    "PUBLIC_EVIDENCE_ROUTED",
    "SECURITY_SENSITIVE_PRIVATE",
    "HIGH_SEVERITY_PRIVATE",
    "SCHEMA_DENIED",
    "POLICY_DIGEST_MISMATCH_DENIED",
    "FINDING_DIGEST_MISMATCH_DENIED",
    "SEVERITY_CLASSIFICATION_MISMATCH_DENIED",
    "PUBLIC_ROUTE_ATTEMPT_DENIED",
];
function digest(value) {
    return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
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
    return typeof value === "string" && value.length <= 32 && /^\d+\.\d+\.\d+$/.test(value);
}
function isDigest(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function validFinding(value) {
    return exactKeys(value, ["findingId", "findingDigest", "severity", "findingClass"])
        && isId(value.findingId) && isDigest(value.findingDigest)
        && EXTENSION_ASSURANCE_SEVERITIES_V1.includes(value.severity)
        && EXTENSION_ASSURANCE_FINDING_CLASSES_V1.includes(value.findingClass);
}
function validEvidence(value) {
    return exactKeys(value, ["evidenceId", "evidenceDigest"])
        && isId(value.evidenceId) && isDigest(value.evidenceDigest);
}
function validPolicy(value) {
    return exactKeys(value, ["policyId", "policyVersion", "policyDigest"])
        && isId(value.policyId) && isSemver(value.policyVersion) && isDigest(value.policyDigest);
}
function policyEnvelopeDigest(policy) {
    return digest({ policyId: policy.policyId, policyVersion: policy.policyVersion });
}
function validInput(value) {
    return exactKeys(value, ["schemaVersion", "finding", "evidence", "policy", "requestedRoute"])
        && value.schemaVersion === EXTENSION_ASSURANCE_SECURITY_ROUTING_INPUT_SCHEMA_V1
        && validFinding(value.finding) && validEvidence(value.evidence) && validPolicy(value.policy)
        && (value.requestedRoute === "PUBLIC_EVIDENCE" || value.requestedRoute === "SECURITY_POLICY_PRIVATE");
}
export function extensionAssuranceFindingDigestV1(finding) {
    return digest({ ...finding });
}
function decision(outcome, route, publicDetail, reasonCodes, echo) {
    const body = {
        schemaVersion: EXTENSION_ASSURANCE_SECURITY_ROUTING_DECISION_SCHEMA_V1,
        outcome,
        route,
        publicDetail,
        reasonCodes: [...reasonCodes],
        ...echo,
        claimBoundary: EXTENSION_ASSURANCE_SECURITY_ROUTING_CLAIM_BOUNDARY_V1,
    };
    return { ...body, decisionDigest: digest(body) };
}
function ordered(reasons) {
    return EXTENSION_ASSURANCE_SECURITY_ROUTING_REASON_CODES_V1.filter((code) => reasons.has(code));
}
function deny(reasonCodes) {
    return decision("DENY", "SECURITY_POLICY_PRIVATE", "NONE", reasonCodes, {
        severity: null,
        findingDigest: null,
        evidenceDigest: null,
        policyVersion: null,
        policyDigest: null,
    });
}
export function decideExtensionAssuranceSecurityRoutingV1(value) {
    if (!validInput(value))
        return deny(["SCHEMA_DENIED"]);
    const input = value;
    const { finding, policy, requestedRoute } = input;
    const reasons = new Set();
    const elevated = finding.severity === "HIGH" || finding.severity === "CRITICAL";
    const sensitiveClass = EXTENSION_ASSURANCE_SENSITIVE_FINDING_CLASSES_V1
        .includes(finding.findingClass);
    if (policyEnvelopeDigest(policy) !== policy.policyDigest) {
        reasons.add("POLICY_DIGEST_MISMATCH_DENIED");
    }
    if (extensionAssuranceFindingDigestV1({
        findingId: finding.findingId,
        severity: finding.severity,
        findingClass: finding.findingClass,
    }) !== finding.findingDigest) {
        reasons.add("FINDING_DIGEST_MISMATCH_DENIED");
    }
    if (elevated && finding.findingClass === "PUBLIC_SAFE_SYNTHETIC") {
        reasons.add("SEVERITY_CLASSIFICATION_MISMATCH_DENIED");
    }
    if ((elevated || sensitiveClass) && requestedRoute === "PUBLIC_EVIDENCE") {
        reasons.add("PUBLIC_ROUTE_ATTEMPT_DENIED");
    }
    if (reasons.size > 0)
        return deny(ordered(reasons));
    if (elevated || sensitiveClass) {
        const privateCodes = [];
        if (sensitiveClass)
            privateCodes.push("SECURITY_SENSITIVE_PRIVATE");
        if (elevated)
            privateCodes.push("HIGH_SEVERITY_PRIVATE");
        return decision("ROUTED", "SECURITY_POLICY_PRIVATE", "NONE", privateCodes, {
            severity: finding.severity,
            findingDigest: finding.findingDigest,
            evidenceDigest: input.evidence.evidenceDigest,
            policyVersion: policy.policyVersion,
            policyDigest: policy.policyDigest,
        });
    }
    return decision("ROUTED", "PUBLIC_EVIDENCE", "FIXED_REASON_CODES_ONLY", ["PUBLIC_EVIDENCE_ROUTED"], {
        severity: finding.severity,
        findingDigest: finding.findingDigest,
        evidenceDigest: input.evidence.evidenceDigest,
        policyVersion: policy.policyVersion,
        policyDigest: policy.policyDigest,
    });
}
export function renderExtensionAssuranceSecurityRoutingDecisionV1(value) {
    return canonicalJson(decideExtensionAssuranceSecurityRoutingV1(value));
}
