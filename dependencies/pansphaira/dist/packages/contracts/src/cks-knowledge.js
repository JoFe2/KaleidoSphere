import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import { CKS_COMPLEXITY_DIMENSIONS_V1, CKS_KNOWLEDGE_KINDS_V1, CKS_MATURITY_LEVELS_V1, CKS_QUALIFICATION_LEVELS_V1 } from "./competence-knowledge-vocabulary.js";
import { APPLICABILITY_DIMENSIONS_V1, validateAcceptedContextV1 } from "./knowledge-quality.js";
import { validateKnowledgeEnvelopeV1 } from "./knowledge-envelope.js";
export const CKS_KNOWLEDGE_OBJECT_SCHEMA_V1 = "chimpmaera.cks/knowledge-object/v1";
export const CKS_KNOWLEDGE_QUERY_SCHEMA_V1 = "chimpmaera.cks/knowledge-query/v1";
export const CKS_APPLICABILITY_BINDING_SCHEMA_V1 = "chimpmaera.cks/applicability/v1";
export const CKS_KNOWLEDGE_STATUSES_V1 = ["ACTIVE", "SUPERSEDED"];
export const CKS_KNOWLEDGE_DENIAL_REASONS_V1 = [
    "SCHEMA_DENIED", "STALE_VERSION_DENIED", "AUTHORITY_DENIED", "DIGEST_TAMPERED_DENIED",
    "PROVENANCE_UNRESOLVED_DENIED", "VALIDITY_DENIED", "SUPERSESSION_UNRESOLVED_DENIED",
    "APPLICABILITY_MISMATCH_DENIED", "CROSS_SCOPE_BINDING_DENIED",
];
const sha256 = (value) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, keys) => plain(value) && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
const digest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const identifier = (value) => typeof value === "string" && /^[a-z][a-z0-9-]{1,31}:[a-z0-9][a-z0-9._-]{2,95}$/.test(value);
const bounded = (value, max) => typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value);
const timestamp = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const objectReference = (value) => exact(value, ["objectId", "objectDigest"]) && identifier(value.objectId) && digest(value.objectDigest);
const authorityShape = (value) => exact(value, ["credentials", "policyApprovals", "capabilities", "toolAccess", "writeTargets", "executionRoutes"]) && Object.values(value).every(Array.isArray);
const authorityFree = (value) => authorityShape(value) && Object.values(value).every((item) => item.length === 0);
const withoutDigest = (value, field) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== field));
export const cksKnowledgeObjectDigestV1 = (value) => sha256(withoutDigest(value, "objectDigest"));
export const cksKnowledgeQueryDigestV1 = (value) => sha256(withoutDigest(value, "queryDigest"));
export const cksApplicabilityBindingDigestV1 = (value) => sha256(withoutDigest(value, "applicabilityDigest"));
function objectShape(value) {
    if (!exact(value, ["schemaVersion", "objectId", "provenance", "knowledgeKind", "qualificationLevel", "maturityLevel", "complexityDimensions", "validity", "status", "supersedes", "authority", "objectDigest"]) || value.schemaVersion !== CKS_KNOWLEDGE_OBJECT_SCHEMA_V1 || !identifier(value.objectId) || !exact(value.provenance, ["envelopeId", "envelopeDigest", "scopeNamespace"]) || !identifier(value.provenance.envelopeId) || !digest(value.provenance.envelopeDigest) || !bounded(value.provenance.scopeNamespace, 96) || !CKS_KNOWLEDGE_KINDS_V1.includes(value.knowledgeKind) || !CKS_QUALIFICATION_LEVELS_V1.includes(value.qualificationLevel) || !CKS_MATURITY_LEVELS_V1.includes(value.maturityLevel) || !Array.isArray(value.complexityDimensions) || value.complexityDimensions.length < 1 || value.complexityDimensions.length > CKS_COMPLEXITY_DIMENSIONS_V1.length || new Set(value.complexityDimensions).size !== value.complexityDimensions.length || !value.complexityDimensions.every((dimension) => CKS_COMPLEXITY_DIMENSIONS_V1.includes(dimension)) || !exact(value.validity, ["notBeforeMs", "notAfterMs"]) || !timestamp(value.validity.notBeforeMs) || !timestamp(value.validity.notAfterMs) || !CKS_KNOWLEDGE_STATUSES_V1.includes(value.status) || !Array.isArray(value.supersedes) || value.supersedes.length > 64 || new Set(value.supersedes.map((item) => canonicalJson(item))).size !== value.supersedes.length || !value.supersedes.every(objectReference) || !authorityFree(value.authority) || !digest(value.objectDigest))
        return false;
    return true;
}
const validObjectCandidate = (value) => objectShape(value) && cksKnowledgeObjectDigestV1(value) === value.objectDigest;
export function validateCksKnowledgeObjectV1(value, taxonomy, envelopes, objects) {
    if (!plain(value) || !exact(value, ["schemaVersion", "objectId", "provenance", "knowledgeKind", "qualificationLevel", "maturityLevel", "complexityDimensions", "validity", "status", "supersedes", "authority", "objectDigest"]))
        return ["SCHEMA_DENIED"];
    if (value.schemaVersion !== CKS_KNOWLEDGE_OBJECT_SCHEMA_V1)
        return ["STALE_VERSION_DENIED"];
    if (!authorityShape(value.authority))
        return ["SCHEMA_DENIED"];
    if (!authorityFree(value.authority))
        return ["AUTHORITY_DENIED"];
    if (!objectShape(value))
        return ["SCHEMA_DENIED"];
    const reasons = [];
    if (value.validity.notAfterMs <= value.validity.notBeforeMs)
        reasons.push("VALIDITY_DENIED");
    const source = envelopes.find((candidate) => candidate.envelopeId === value.provenance.envelopeId && candidate.envelopeDigest === value.provenance.envelopeDigest);
    if (!source || validateKnowledgeEnvelopeV1(source, taxonomy).length > 0)
        reasons.push("PROVENANCE_UNRESOLVED_DENIED");
    else if (source.scope.namespace !== value.provenance.scopeNamespace || source.kind !== value.knowledgeKind)
        reasons.push("CROSS_SCOPE_BINDING_DENIED");
    const selfReference = value.supersedes.some((reference) => reference.objectId === value.objectId || reference.objectDigest === value.objectDigest);
    const unresolved = value.supersedes.some((reference) => !objects.some((candidate) => validObjectCandidate(candidate) && candidate.objectId === reference.objectId && candidate.objectDigest === reference.objectDigest));
    if (selfReference || unresolved)
        reasons.push("SUPERSESSION_UNRESOLVED_DENIED");
    if (cksKnowledgeObjectDigestV1(value) !== value.objectDigest)
        reasons.push("DIGEST_TAMPERED_DENIED");
    return reasons;
}
function queryShape(value) {
    return exact(value, ["schemaVersion", "queryId", "object", "scopeNamespace", "requestedAtMs", "authority", "queryDigest"]) && identifier(value.queryId) && objectReference(value.object) && bounded(value.scopeNamespace, 96) && timestamp(value.requestedAtMs) && authorityFree(value.authority) && digest(value.queryDigest);
}
export function validateCksKnowledgeQueryV1(value, object) {
    if (!plain(value) || !exact(value, ["schemaVersion", "queryId", "object", "scopeNamespace", "requestedAtMs", "authority", "queryDigest"]))
        return ["SCHEMA_DENIED"];
    if (value.schemaVersion !== CKS_KNOWLEDGE_QUERY_SCHEMA_V1)
        return ["STALE_VERSION_DENIED"];
    if (!authorityShape(value.authority))
        return ["SCHEMA_DENIED"];
    if (!authorityFree(value.authority))
        return ["AUTHORITY_DENIED"];
    if (!queryShape(value))
        return ["SCHEMA_DENIED"];
    const reasons = [];
    if (!objectShape(object))
        return ["SCHEMA_DENIED"];
    if (cksKnowledgeObjectDigestV1(object) !== object.objectDigest)
        reasons.push("DIGEST_TAMPERED_DENIED");
    if (value.object.objectId !== object.objectId || value.object.objectDigest !== object.objectDigest || value.scopeNamespace !== object.provenance.scopeNamespace)
        reasons.push("CROSS_SCOPE_BINDING_DENIED");
    if (value.requestedAtMs < object.validity.notBeforeMs || value.requestedAtMs > object.validity.notAfterMs)
        reasons.push("VALIDITY_DENIED");
    if (cksKnowledgeQueryDigestV1(value) !== value.queryDigest)
        reasons.push("DIGEST_TAMPERED_DENIED");
    return reasons;
}
function applicabilityShape(value) {
    return exact(value, ["schemaVersion", "object", "scopeNamespace", "acceptedContext", "materialDimensions", "authority", "applicabilityDigest"]) && objectReference(value.object) && bounded(value.scopeNamespace, 96) && validateAcceptedContextV1(value.acceptedContext) && Array.isArray(value.materialDimensions) && value.materialDimensions.length <= APPLICABILITY_DIMENSIONS_V1.length && new Set(value.materialDimensions).size === value.materialDimensions.length && value.materialDimensions.every((dimension) => APPLICABILITY_DIMENSIONS_V1.includes(dimension)) && authorityFree(value.authority) && digest(value.applicabilityDigest);
}
export function validateCksApplicabilityBindingV1(value, object) {
    if (!plain(value) || !exact(value, ["schemaVersion", "object", "scopeNamespace", "acceptedContext", "materialDimensions", "authority", "applicabilityDigest"]))
        return ["SCHEMA_DENIED"];
    if (value.schemaVersion !== CKS_APPLICABILITY_BINDING_SCHEMA_V1)
        return ["STALE_VERSION_DENIED"];
    if (!authorityShape(value.authority))
        return ["SCHEMA_DENIED"];
    if (!authorityFree(value.authority))
        return ["AUTHORITY_DENIED"];
    if (!applicabilityShape(value))
        return ["SCHEMA_DENIED"];
    const reasons = [];
    if (!objectShape(object))
        return ["SCHEMA_DENIED"];
    if (cksKnowledgeObjectDigestV1(object) !== object.objectDigest)
        reasons.push("DIGEST_TAMPERED_DENIED");
    if (value.object.objectId !== object.objectId || value.object.objectDigest !== object.objectDigest || value.scopeNamespace !== object.provenance.scopeNamespace)
        reasons.push("CROSS_SCOPE_BINDING_DENIED");
    if (value.materialDimensions.some((dimension) => !(dimension in value.acceptedContext)))
        reasons.push("APPLICABILITY_MISMATCH_DENIED");
    if (cksApplicabilityBindingDigestV1(value) !== value.applicabilityDigest)
        reasons.push("DIGEST_TAMPERED_DENIED");
    return reasons;
}
