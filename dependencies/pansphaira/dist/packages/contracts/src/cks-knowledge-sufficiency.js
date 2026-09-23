import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
export const KNOWLEDGE_NEED_SCHEMA_V1 = "pansphaira.cks/knowledge-need/v1";
export const KNOWLEDGE_GAP_SCHEMA_V1 = "pansphaira.cks/knowledge-gap/v1";
export const ACQUISITION_PLAN_SCHEMA_V1 = "pansphaira.cks/acquisition-plan/v1";
export const SOURCE_EVIDENCE_SCHEMA_V1 = "pansphaira.cks/source-evidence/v1";
export const KNOWLEDGE_SUFFICIENCY_SCHEMA_V1 = "pansphaira.cks/knowledge-sufficiency/v1";
export const KNOWLEDGE_AUTHORITY_BOUNDARY_V1 = "READ_ONLY_KNOWLEDGE_NO_CREDENTIAL_POLICY_CAPABILITY_TOOL_WRITE_OR_EXECUTION_AUTHORITY";
export const CKS_SOURCE_CLASSES_V1 = [
    "ACTIVE_CURATED_KNOWLEDGE",
    "PINNED_OWNER_EVIDENCE",
    "PINNED_PRIMARY_EVIDENCE",
    "PINNED_SECONDARY_EVIDENCE",
    "INTERNET_RESULT",
    "MODEL_RESULT",
    "UNKNOWN_SOURCE",
];
export const CKS_GAP_CLASSES_V1 = [
    "NONE",
    "MISSING",
    "BAD_SOURCE",
    "APPLICABILITY",
    "CONFLICTING",
    "UNKNOWN_SEMANTIC",
];
export const CKS_REQUIREMENT_OUTCOMES_V1 = [
    "SATISFIED",
    "NOT_APPLICABLE",
    "GAP_MISSING",
    "GAP_BAD_SOURCE",
    "GAP_APPLICABILITY",
    "GAP_CONFLICTING",
    "GAP_UNKNOWN_SEMANTIC",
];
export const CKS_ACQUISITION_LEVELS_V1 = ["A0", "A1", "A2", "A3", "A4", "A5"];
export const CKS_RETRIEVAL_OUTCOMES_V1 = [
    "QUALIFYING_MATCH",
    "NO_MATCH",
    "BAD_SOURCE",
    "APPLICABILITY",
    "CONFLICTING",
    "UNKNOWN_SEMANTIC",
    "BLOCKED",
];
export const CKS_BLOCKED_REASONS_V1 = [
    "DEPENDENCY_EVIDENCE_ABSENT",
    "DEPENDENCY_SCHEMA_INVALID",
    "DEPENDENCY_DIGEST_MISMATCH",
    "REQUIRED_SEMANTIC_RULE_ABSENT",
    "REQUIRED_APPLICABILITY_RULE_ABSENT",
    "REQUIRED_SOURCE_RULE_ABSENT",
    "RETRIEVAL_RECEIPT_ABSENT",
    "DENOMINATOR_EVIDENCE_ABSENT",
    "COMPARATOR_INPUT_ABSENT",
    "UNKNOWN_VOCABULARY_VALUE",
];
const sha256 = (value) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const without = (value, digestKey) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== digestKey));
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
const exactKeys = (value, keys) => isRecord(value) && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
const isDigest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const isId = (value) => typeof value === "string" && /^[a-z][a-z0-9-]{1,31}:[a-z0-9][a-z0-9._-]{2,95}$/.test(value);
const isText = (value, max) => typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value);
const isTimestamp = (value) => Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
const isUnique = (value, predicate, max) => Array.isArray(value) && value.length <= max && value.every(predicate) && new Set(value).size === value.length;
const isOneOf = (value, values) => typeof value === "string" && values.includes(value);
const isSourceClass = (value) => isOneOf(value, CKS_SOURCE_CLASSES_V1);
const isLevel = (value) => isOneOf(value, CKS_ACQUISITION_LEVELS_V1);
const isOutcome = (value) => isOneOf(value, CKS_REQUIREMENT_OUTCOMES_V1);
const isGapClass = (value) => isOneOf(value, CKS_GAP_CLASSES_V1);
const isRetrievalOutcome = (value) => isOneOf(value, CKS_RETRIEVAL_OUTCOMES_V1);
export const knowledgeNeedDigestV1 = (value) => sha256(without(value, "needDigest"));
export const knowledgeGapDigestV1 = (value) => sha256(without(value, "gapDigest"));
export const acquisitionPlanDigestV1 = (value) => sha256(without(value, "planDigest"));
export const sourceEvidenceDigestV1 = (value) => sha256(without(value, "evidenceDigest"));
export const knowledgeSufficiencyDigestV1 = (value) => sha256(without(value, "sufficiencyDigest"));
export function validateKnowledgeNeedV1(value) {
    if (!exactKeys(value, [
        "schemaVersion", "needId", "caseId", "requirementId", "statement", "statementDigest",
        "criticality", "applicability", "applicabilityRuleId", "requirementSetDigest", "needDigest",
    ]))
        return false;
    return value.schemaVersion === KNOWLEDGE_NEED_SCHEMA_V1 && isId(value.needId) && isId(value.caseId)
        && isId(value.requirementId) && isText(value.statement, 2048) && isDigest(value.statementDigest)
        && value.statementDigest === sha256(value.statement)
        && ["CRITICAL", "NON_CRITICAL", "UNKNOWN"].includes(value.criticality)
        && ["APPLICABLE", "NOT_APPLICABLE", "UNKNOWN"].includes(value.applicability)
        && (value.applicabilityRuleId === null || isId(value.applicabilityRuleId))
        && (value.applicability === "UNKNOWN" || value.applicabilityRuleId !== null)
        && isDigest(value.requirementSetDigest) && isDigest(value.needDigest)
        && knowledgeNeedDigestV1(value) === value.needDigest;
}
function validateRecoveryAttempt(value) {
    return exactKeys(value, ["level", "outcome", "knowledgeBundleDigest", "receiptDigest"])
        && ["A0", "A1", "A2"].includes(value.level)
        && isRetrievalOutcome(value.outcome) && isDigest(value.knowledgeBundleDigest) && isDigest(value.receiptDigest);
}
function validGapOutcome(gapClass, outcome) {
    return gapClass === "NONE"
        ? outcome === "SATISFIED" || outcome === "NOT_APPLICABLE"
        : outcome === `GAP_${gapClass}`;
}
export function validateKnowledgeGapV1(value) {
    if (!exactKeys(value, [
        "schemaVersion", "gapId", "needDigest", "gapClass", "requirementOutcome", "sourceClasses",
        "evidenceDigests", "recoveryAttempts", "gapDigest",
    ]))
        return false;
    if (value.schemaVersion !== KNOWLEDGE_GAP_SCHEMA_V1 || !isId(value.gapId) || !isDigest(value.needDigest)
        || !isGapClass(value.gapClass) || !isOutcome(value.requirementOutcome)
        || !validGapOutcome(value.gapClass, value.requirementOutcome)
        || !isUnique(value.sourceClasses, isSourceClass, CKS_SOURCE_CLASSES_V1.length)
        || !isUnique(value.evidenceDigests, isDigest, 64)
        || !Array.isArray(value.recoveryAttempts) || value.recoveryAttempts.length > 3
        || !value.recoveryAttempts.every(validateRecoveryAttempt) || !isDigest(value.gapDigest)
        || knowledgeGapDigestV1(value) !== value.gapDigest)
        return false;
    const attempts = value.recoveryAttempts;
    if (value.gapClass === "MISSING") {
        if (attempts.length !== 3 || attempts.some((attempt, index) => attempt.level !== ["A0", "A1", "A2"][index] || attempt.outcome !== "NO_MATCH"))
            return false;
        if (new Set(attempts.map((attempt) => attempt.knowledgeBundleDigest)).size !== 1)
            return false;
    }
    else if (attempts.some((attempt, index) => attempt.level !== ["A0", "A1", "A2"][index]))
        return false;
    if (value.gapClass === "NONE") {
        const sources = value.sourceClasses;
        return value.requirementOutcome === "SATISFIED"
            ? sources.length > 0 && sources.every((source) => source === "ACTIVE_CURATED_KNOWLEDGE")
            : sources.length === 0;
    }
    return value.requirementOutcome !== "SATISFIED" && value.requirementOutcome !== "NOT_APPLICABLE";
}
export function validateAcquisitionPlanV1(value) {
    if (!exactKeys(value, [
        "schemaVersion", "planId", "needDigest", "orderedLevels", "maximumTotalAttempts", "maximumAlternateAttempts",
        "allowedSourceClasses", "promotionStatus", "acceptedKnowledgeDigest", "authorityBoundary", "planDigest",
    ]))
        return false;
    if (value.schemaVersion !== ACQUISITION_PLAN_SCHEMA_V1 || !isId(value.planId) || !isDigest(value.needDigest)
        || !Array.isArray(value.orderedLevels) || value.orderedLevels.length < 1 || value.orderedLevels.length > 6
        || !value.orderedLevels.every(isLevel) || new Set(value.orderedLevels).size !== value.orderedLevels.length
        || value.maximumTotalAttempts !== 3 || value.maximumAlternateAttempts !== 2
        || !isUnique(value.allowedSourceClasses, isSourceClass, CKS_SOURCE_CLASSES_V1.length)
        || value.allowedSourceClasses.length < 1 || value.promotionStatus !== "NOT_REQUESTED"
        || value.acceptedKnowledgeDigest !== null || value.authorityBoundary !== KNOWLEDGE_AUTHORITY_BOUNDARY_V1
        || !isDigest(value.planDigest) || acquisitionPlanDigestV1(value) !== value.planDigest)
        return false;
    return value.orderedLevels.every((level, index) => CKS_ACQUISITION_LEVELS_V1[index] === level);
}
export function validateSourceEvidenceV1(value) {
    if (!exactKeys(value, [
        "schemaVersion", "evidenceId", "sourceClass", "locator", "contentDigest", "observedAtMs", "expiresAtMs",
        "licence", "acceptanceStatus", "authorityBoundary", "evidenceDigest",
    ]))
        return false;
    return value.schemaVersion === SOURCE_EVIDENCE_SCHEMA_V1 && isId(value.evidenceId) && isSourceClass(value.sourceClass)
        && isText(value.locator, 2048) && isDigest(value.contentDigest) && isTimestamp(value.observedAtMs)
        && (value.expiresAtMs === null || (isTimestamp(value.expiresAtMs) && value.expiresAtMs >= value.observedAtMs))
        && ["CC0-1.0", "CC-BY-4.0", "APACHE-2.0", "MIT", "OWNER_AUTHORIZED", "UNKNOWN"].includes(value.licence)
        && value.acceptanceStatus === "NOT_ACCEPTED" && value.authorityBoundary === KNOWLEDGE_AUTHORITY_BOUNDARY_V1
        && isDigest(value.evidenceDigest) && sourceEvidenceDigestV1(value) === value.evidenceDigest;
}
function validateSufficiencyRequirement(value) {
    if (!exactKeys(value, ["needDigest", "gapClass", "requirementOutcome", "sourceClasses", "evidenceDigests"]))
        return false;
    if (!isDigest(value.needDigest) || !isGapClass(value.gapClass) || !isOutcome(value.requirementOutcome)
        || !validGapOutcome(value.gapClass, value.requirementOutcome)
        || !isUnique(value.sourceClasses, isSourceClass, CKS_SOURCE_CLASSES_V1.length)
        || !isUnique(value.evidenceDigests, isDigest, 64))
        return false;
    if (value.requirementOutcome === "SATISFIED") {
        return value.gapClass === "NONE" && value.sourceClasses.length > 0
            && value.sourceClasses.every((source) => source === "ACTIVE_CURATED_KNOWLEDGE");
    }
    if (value.requirementOutcome === "NOT_APPLICABLE")
        return value.gapClass === "NONE";
    return value.gapClass !== "NONE";
}
export function validateKnowledgeSufficiencyV1(value) {
    if (!exactKeys(value, [
        "schemaVersion", "sufficiencyId", "caseId", "requirementSetDigest", "knowledgeBundleDigest", "requirements",
        "blockedReasons", "overallOutcome", "authorityBoundary", "sufficiencyDigest",
    ]))
        return false;
    if (value.schemaVersion !== KNOWLEDGE_SUFFICIENCY_SCHEMA_V1 || !isId(value.sufficiencyId) || !isId(value.caseId)
        || !isDigest(value.requirementSetDigest) || !isDigest(value.knowledgeBundleDigest)
        || !Array.isArray(value.requirements) || value.requirements.length < 1 || value.requirements.length > 1024
        || !value.requirements.every(validateSufficiencyRequirement)
        || new Set(value.requirements.map((item) => item.needDigest)).size !== value.requirements.length
        || !isUnique(value.blockedReasons, (item) => isOneOf(item, CKS_BLOCKED_REASONS_V1), CKS_BLOCKED_REASONS_V1.length)
        || !["SUFFICIENT", "INSUFFICIENT", "BLOCKED"].includes(value.overallOutcome)
        || !isDigest(value.sufficiencyDigest) || value.authorityBoundary !== KNOWLEDGE_AUTHORITY_BOUNDARY_V1
        || knowledgeSufficiencyDigestV1(value) !== value.sufficiencyDigest)
        return false;
    const requirements = value.requirements;
    if (value.overallOutcome === "BLOCKED")
        return value.blockedReasons.length > 0;
    if (value.blockedReasons.length > 0)
        return false;
    if (value.overallOutcome === "SUFFICIENT") {
        return requirements.every((item) => item.requirementOutcome === "SATISFIED" || item.requirementOutcome === "NOT_APPLICABLE");
    }
    return requirements.some((item) => item.requirementOutcome !== "SATISFIED" && item.requirementOutcome !== "NOT_APPLICABLE");
}
export function validateCksContractV1(value) {
    if (!isRecord(value) || typeof value.schemaVersion !== "string")
        return false;
    switch (value.schemaVersion) {
        case KNOWLEDGE_NEED_SCHEMA_V1: return validateKnowledgeNeedV1(value);
        case KNOWLEDGE_GAP_SCHEMA_V1: return validateKnowledgeGapV1(value);
        case ACQUISITION_PLAN_SCHEMA_V1: return validateAcquisitionPlanV1(value);
        case SOURCE_EVIDENCE_SCHEMA_V1: return validateSourceEvidenceV1(value);
        case KNOWLEDGE_SUFFICIENCY_SCHEMA_V1: return validateKnowledgeSufficiencyV1(value);
        default: return false;
    }
}
