import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import { KNOWLEDGE_AUTHORITY_BOUNDARY_V1 } from "./knowledge-envelope.js";
export const CKS_VOCABULARY_SCHEMA_V1 = "chimpmaera.cks/vocabulary/v1";
export const CKS_KNOWLEDGE_KINDS_V1 = ["FACT", "RULE", "PROCEDURE", "GUIDE", "EXAMPLE", "COUNTEREXAMPLE", "CONSTRAINT"];
export const CKS_QUALIFICATION_LEVELS_V1 = ["Q0", "Q1", "Q2", "Q3", "Q4", "Q5", "Q6"];
export const CKS_MATURITY_LEVELS_V1 = ["L0", "L1", "L2", "L3", "L4", "L5", "L6"];
export const CKS_COMPLEXITY_DIMENSIONS_V1 = ["R", "K", "P", "U"];
export const CKS_DENIAL_REASONS_V1 = ["SCHEMA_DENIED", "STALE_VERSION_DENIED", "AUTHORITY_DENIED", "REGISTRY_MUTATION_DENIED", "NONCLAIM_MUTATION_DENIED", "APPLICABILITY_MISMATCH_DENIED", "CROSS_SCOPE_BINDING_DENIED", "DIGEST_TAMPERED_DENIED"];
export const CKS_NONCLAIMS_V1 = [
    "NO_KNOWLEDGE_OBJECT_SEMANTICS", "NO_QUERY_SEMANTICS", "NO_APPLICABILITY_SEMANTICS", "NO_EVIDENCE_SEMANTICS",
    "NO_QUALIFICATION_ASSESSMENT_SEMANTICS", "NO_ESCALATION_SEMANTICS", "NO_STORAGE_SEMANTICS", "NO_RETRIEVAL_SEMANTICS",
    "NO_ROUTING_OR_PROVIDER_SEMANTICS", "NO_CAPABILITY_OR_POLICY_SEMANTICS", "NO_WRITE_OR_EXECUTION_AUTHORITY",
    "NO_RUNTIME_ACTIVATION_SEMANTICS", "LEVELS_AND_DIMENSIONS_CARRY_NO_SCORE_WEIGHT_OR_THRESHOLD", "VOCABULARY_IS_NOT_A_TRUTH_CLAIM",
];
export const CKS_VOCABULARY_V1 = {
    schemaVersion: CKS_VOCABULARY_SCHEMA_V1,
    knowledgeKinds: CKS_KNOWLEDGE_KINDS_V1,
    qualificationLevels: CKS_QUALIFICATION_LEVELS_V1,
    maturityLevels: CKS_MATURITY_LEVELS_V1,
    complexityDimensions: CKS_COMPLEXITY_DIMENSIONS_V1,
    denialReasons: CKS_DENIAL_REASONS_V1,
    authorityBoundary: KNOWLEDGE_AUTHORITY_BOUNDARY_V1,
    nonclaims: CKS_NONCLAIMS_V1,
    vocabularyDigest: "3f7c1891a5fd2ecf01882df395921f9b8f2af268f74e4ac6b83a3caed69a03c0",
};
const sha256 = (value) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const digestLike = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const stringArray = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");
const sameOrder = (a, b) => a.length === b.length && a.every((item, index) => item === b[index]);
export function cksVocabularyDigestV1(value) {
    return sha256(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "vocabularyDigest")));
}
const CKS_SCOPE_MEMBERS_V1 = {
    KNOWLEDGE_KIND: CKS_KNOWLEDGE_KINDS_V1,
    QUALIFICATION: CKS_QUALIFICATION_LEVELS_V1,
    MATURITY: CKS_MATURITY_LEVELS_V1,
    COMPLEXITY: CKS_COMPLEXITY_DIMENSIONS_V1,
};
export function cksScopeMembersV1(scope) {
    return CKS_SCOPE_MEMBERS_V1[scope];
}
export function isCksScopeMemberV1(scope, member) {
    return typeof member === "string" && cksScopeMembersV1(scope).includes(member);
}
const CKS_REGISTRY_FROZEN_V1 = {
    KNOWLEDGE_KIND: CKS_KNOWLEDGE_KINDS_V1,
    QUALIFICATION: CKS_QUALIFICATION_LEVELS_V1,
    MATURITY: CKS_MATURITY_LEVELS_V1,
    COMPLEXITY: CKS_COMPLEXITY_DIMENSIONS_V1,
    DENIAL_REASON: CKS_DENIAL_REASONS_V1,
};
const CKS_REGISTRY_GRAMMARS_V1 = {
    KNOWLEDGE_KIND: /^[A-Z][A-Z0-9_]{1,47}$/,
    QUALIFICATION: /^Q[0-9]$/,
    MATURITY: /^L[0-9]$/,
    COMPLEXITY: /^[A-Z][0-9]?$/,
    DENIAL_REASON: /^[A-Z][A-Z0-9_]+_DENIED$/,
};
const ALL_REGISTRY_FROZEN_MEMBERS_V1 = new Set(Object.values(CKS_REGISTRY_FROZEN_V1).flat());
function registryReason(scope, members) {
    const frozen = CKS_REGISTRY_FROZEN_V1[scope];
    if (sameOrder(members, frozen))
        return null;
    if (members.every((member) => frozen.includes(member)))
        return "REGISTRY_MUTATION_DENIED";
    if (members.some((member) => ALL_REGISTRY_FROZEN_MEMBERS_V1.has(member) && !frozen.includes(member)))
        return "CROSS_SCOPE_BINDING_DENIED";
    if (members.every((member) => CKS_REGISTRY_GRAMMARS_V1[scope].test(member)))
        return "APPLICABILITY_MISMATCH_DENIED";
    return "SCHEMA_DENIED";
}
const CKS_VOCABULARY_KEYS_V1 = ["schemaVersion", "knowledgeKinds", "qualificationLevels", "maturityLevels", "complexityDimensions", "denialReasons", "authorityBoundary", "nonclaims", "vocabularyDigest"];
export function validateCksVocabularyV1(value) {
    if (!record(value) || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...CKS_VOCABULARY_KEYS_V1].sort())
        || typeof value.schemaVersion !== "string" || typeof value.authorityBoundary !== "string" || !digestLike(value.vocabularyDigest)
        || !stringArray(value.knowledgeKinds) || !stringArray(value.qualificationLevels) || !stringArray(value.maturityLevels)
        || !stringArray(value.complexityDimensions) || !stringArray(value.denialReasons) || !stringArray(value.nonclaims))
        return ["SCHEMA_DENIED"];
    const reasons = [];
    if (value.schemaVersion !== CKS_VOCABULARY_SCHEMA_V1)
        reasons.push("STALE_VERSION_DENIED");
    if (value.authorityBoundary !== KNOWLEDGE_AUTHORITY_BOUNDARY_V1)
        reasons.push("AUTHORITY_DENIED");
    const registry = (scope, members) => {
        const reason = registryReason(scope, members);
        if (reason)
            reasons.push(reason);
    };
    registry("KNOWLEDGE_KIND", value.knowledgeKinds);
    registry("QUALIFICATION", value.qualificationLevels);
    registry("MATURITY", value.maturityLevels);
    registry("COMPLEXITY", value.complexityDimensions);
    registry("DENIAL_REASON", value.denialReasons);
    if (!sameOrder(value.nonclaims, CKS_NONCLAIMS_V1)) {
        reasons.push("NONCLAIM_MUTATION_DENIED");
        if (value.nonclaims.some((member) => ALL_REGISTRY_FROZEN_MEMBERS_V1.has(member)))
            reasons.push("CROSS_SCOPE_BINDING_DENIED");
    }
    if (cksVocabularyDigestV1(value) !== value.vocabularyDigest)
        reasons.push("DIGEST_TAMPERED_DENIED");
    return reasons;
}
