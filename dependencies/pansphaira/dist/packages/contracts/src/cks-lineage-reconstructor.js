/**
 * CKS-08 lineage validator and reconstructor (P14).
 *
 * Named deterministic in-memory entry point for the frozen Task → Search →
 * Knowledge → Decision → Outcome usage-lineage contracts defined in
 * `cks-knowledge-lineage.ts` and bound by the frozen decision receipt
 * `docs/evidence/conveyor/sol-psai288-usage-lineage-decision-01.json`.
 *
 * This module re-exports the frozen contract surface unchanged and names the
 * P14 reconstruction entry point. It invents no new process variant, adds no
 * alternative semantics, and never substitutes a missing identifier, digest,
 * parent, semantic rule, causal evidence or profile dimension (the receipt's
 * `noSubstitutionRule`).
 *
 * Determinism: pure in-memory validation over plain-JSON event streams.
 * Fail-closed: any missing, late, replayed, cross-scope or tampered lineage
 * denies the whole task with unique, sorted, capped frozen reason codes and
 * no partial sets.
 */
import { CKS_DECISION_KNOWLEDGE_BINDING_SCHEMA_V1, CKS_DIRECT_FAILURE_EVENT_TYPE_BY_CLASS_V1, CKS_DIRECT_FAILURE_RECEIPT_SCHEMA_V1, CKS_EVENT_TYPES_V1, CKS_FAILURE_ATTRIBUTION_SCHEMA_V1, CKS_KNOWLEDGE_EVIDENCE_PROFILE_SCHEMA_V1, CKS_KNOWLEDGE_LINEAGE_SEMANTIC_RULE_V1, CKS_KNOWLEDGE_USAGE_EVENT_SCHEMA_V1, CKS_LATE_WINDOW_MS_V1, CKS_LOCAL_SYNTHETIC_SCOPE_CLASS_V1, CKS_MAX_CAUSE_EVENT_REFS_V1, CKS_MAX_EVENTS_PER_SCOPE_V1, CKS_MAX_EVENTS_PER_TASK_V1, CKS_MAX_FAILURE_CAUSES_V1, CKS_MAX_KNOWLEDGE_REFS_V1, CKS_MAX_REASON_CODES_PER_DENIAL_V1, CKS_MAX_SEARCHES_PER_TASK_V1, CKS_TASK_OUTCOME_EVIDENCE_SCHEMA_V1, cksDigestV1, decisionKnowledgeBindingDigestV1, directFailureReceiptDigestV1, failureAttributionDigestV1, knowledgeEvidenceProfileDigestV1, knowledgeUsageEventDigestV1, knowledgeUsageFactDigestV1, reconstructKnowledgeUsageV1, taskOutcomeEvidenceDigestV1, usageLineageSearchDigestV1, usageLineageTaskDigestV1, validateDecisionKnowledgeBindingV1, validateDirectFailureReceiptV1, validateFailureAttributionV1, validateKnowledgeEvidenceProfileV1, validateKnowledgeUsageEventV1, validateTaskOutcomeEvidenceV1, verifyKnowledgeUsageEventV1, } from "./cks-knowledge-lineage.js";
export { CKS_DECISION_KNOWLEDGE_BINDING_SCHEMA_V1, CKS_DIRECT_FAILURE_EVENT_TYPE_BY_CLASS_V1, CKS_DIRECT_FAILURE_RECEIPT_SCHEMA_V1, CKS_EVENT_TYPES_V1, CKS_FAILURE_ATTRIBUTION_SCHEMA_V1, CKS_KNOWLEDGE_EVIDENCE_PROFILE_SCHEMA_V1, CKS_KNOWLEDGE_LINEAGE_SEMANTIC_RULE_V1, CKS_KNOWLEDGE_USAGE_EVENT_SCHEMA_V1, CKS_LATE_WINDOW_MS_V1, CKS_LOCAL_SYNTHETIC_SCOPE_CLASS_V1, CKS_MAX_CAUSE_EVENT_REFS_V1, CKS_MAX_EVENTS_PER_SCOPE_V1, CKS_MAX_EVENTS_PER_TASK_V1, CKS_MAX_FAILURE_CAUSES_V1, CKS_MAX_KNOWLEDGE_REFS_V1, CKS_MAX_REASON_CODES_PER_DENIAL_V1, CKS_MAX_SEARCHES_PER_TASK_V1, CKS_TASK_OUTCOME_EVIDENCE_SCHEMA_V1, cksDigestV1, decisionKnowledgeBindingDigestV1, directFailureReceiptDigestV1, failureAttributionDigestV1, knowledgeEvidenceProfileDigestV1, knowledgeUsageEventDigestV1, knowledgeUsageFactDigestV1, reconstructKnowledgeUsageV1, taskOutcomeEvidenceDigestV1, usageLineageSearchDigestV1, usageLineageTaskDigestV1, validateDecisionKnowledgeBindingV1, validateDirectFailureReceiptV1, validateFailureAttributionV1, validateKnowledgeEvidenceProfileV1, validateKnowledgeUsageEventV1, validateTaskOutcomeEvidenceV1, verifyKnowledgeUsageEventV1, };
/** Frozen reconstruction receipt schema version (the literal used by the frozen base module). */
export const CKS_RECONSTRUCTION_SCHEMA_V1 = "chimpmaera.knowledge/usage-lineage-reconstruction/v1";
/**
 * Frozen denial vocabulary: the receipt's `denialPolicy.reasonCodes` minus
 * the acceptance marker `CONTRACT_VERIFIED`. Denial reason codes are always
 * emitted unique, lexicographically sorted and capped at
 * `CKS_MAX_REASON_CODES_PER_DENIAL_V1`.
 */
export const CKS_DENIAL_REASON_CODES_V1 = [
    "CAPACITY_DENIED",
    "CAUSAL_ORDER_DENIED",
    "DIGEST_MISMATCH_DENIED",
    "DIGEST_MISSING_DENIED",
    "FAILURE_ATTRIBUTION_DENIED",
    "IDENTIFIER_FORMAT_DENIED",
    "IDENTIFIER_MISSING_DENIED",
    "INCOMPLETE_LINEAGE_DENIED",
    "LATE_EVENT_DENIED",
    "PARENT_MISSING_DENIED",
    "PREVIOUS_DIGEST_MISMATCH_DENIED",
    "PROHIBITED_FIELD_DENIED",
    "REPLAY_DENIED",
    "SCHEMA_DENIED",
    "SCOPE_MISMATCH_DENIED",
    "SEMANTIC_RULE_MISSING_DENIED",
    "SEMANTIC_RULE_VERSION_DENIED",
    "SEQUENCE_GAP_DENIED",
    "TAMPERED_LINEAGE_DENIED",
    "TASK_FROZEN_DENIED",
    "TASK_SEALED_DENIED",
    "TRANSITION_DENIED",
    "UPSTREAM_BINDING_DENIED",
];
/** Acceptance marker emitted by the frozen verify family (not a denial code). */
export const CKS_ACCEPTED_REASON_CODE_V1 = "CONTRACT_VERIFIED";
/** Frozen accepted-output field set (receipt `acceptedOutput.exactFields`). */
export const CKS_RECONSTRUCTED_FIELDS_V1 = [
    "decisionRef",
    "decisionSupporting",
    "inspected",
    "outcomeContributing",
    "outcomeRef",
    "rejected",
    "reconstructionDigest",
    "schemaVersion",
    "scopeRef",
    "searched",
    "status",
    "taskRef",
    "used",
];
/**
 * P14: deterministically validate and reconstruct the six usage sets
 * (searched, inspected, used, rejected, decision-supporting and
 * outcome-contributing Knowledge) from a minimized in-memory lineage event
 * stream. Re-exports the frozen `reconstructKnowledgeUsageV1` semantics
 * unchanged and additionally enforces the receipt's denial-output contract
 * (unique, sorted, capped reason codes; no partial state) on the denial arm.
 */
export function reconstructCksLineageUsageV1(input) {
    if (Array.isArray(input)) {
        const seenEventIds = new Map();
        const seenDigests = new Set();
        const seenFacts = new Set();
        for (const item of input) {
            if (!isPlainRecord(item))
                continue;
            const eventId = item.eventId;
            const eventDigest = item.eventDigest;
            const factDigest = item.factDigest;
            if (typeof eventId === "string" && typeof eventDigest === "string") {
                const priorDigest = seenEventIds.get(eventId);
                if (priorDigest !== undefined) {
                    return { schemaVersion: CKS_RECONSTRUCTION_SCHEMA_V1, status: "DENIED", reasonCodes: [priorDigest === eventDigest ? "REPLAY_DENIED" : "TAMPERED_LINEAGE_DENIED"] };
                }
                seenEventIds.set(eventId, eventDigest);
            }
            if (typeof eventDigest === "string" && seenDigests.has(eventDigest)) {
                return { schemaVersion: CKS_RECONSTRUCTION_SCHEMA_V1, status: "DENIED", reasonCodes: ["REPLAY_DENIED"] };
            }
            if (typeof factDigest === "string" && seenFacts.has(factDigest)) {
                return { schemaVersion: CKS_RECONSTRUCTION_SCHEMA_V1, status: "DENIED", reasonCodes: ["REPLAY_DENIED"] };
            }
            if (typeof eventDigest === "string")
                seenDigests.add(eventDigest);
            if (typeof factDigest === "string")
                seenFacts.add(factDigest);
        }
    }
    const result = reconstructKnowledgeUsageV1(input);
    if (result.status !== "DENIED")
        return result;
    const codes = [...new Set(result.reasonCodes)].sort().slice(0, CKS_MAX_REASON_CODES_PER_DENIAL_V1);
    return { ...result, reasonCodes: codes };
}
/**
 * Validator half of the P14 pair: verify a single CKS-08 usage-lineage event
 * against the frozen event contract (closed keys, identifier formats,
 * digest binding, semantic-rule binding, fail-closed structure).
 */
export function validateCksLineageEventV1(value) {
    return verifyKnowledgeUsageEventV1(value);
}
const isPlainRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const isHexDigest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const isStringArray = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");
const isIdentifier = (value, key) => {
    if (typeof value !== "string")
        return false;
    if (key === "scopeId")
        return /^scope:v1:[a-f0-9]{64}$/.test(value);
    if (key === "taskId")
        return /^task:v1:[a-f0-9]{64}$/.test(value);
    if (key === "decisionId")
        return /^decision:v1:[a-f0-9]{64}$/.test(value);
    if (key === "outcomeId")
        return /^outcome:v1:[a-f0-9]{64}$/.test(value);
    return /^[a-z][a-z0-9-]{1,31}:[a-z0-9][a-z0-9._-]{2,95}$/.test(value);
};
const isKnowledgeRef = (value) => isPlainRecord(value) && isIdentifier(value.knowledgeId, "knowledgeId") && isHexDigest(value.knowledgeDigest) && Object.keys(value).length === 2;
const isRejectedKnowledgeRef = (value) => isPlainRecord(value) && isKnowledgeRef(value.knowledgeRef) && typeof value.reasonCode === "string" && Object.keys(value).length === 2;
const isEntityRef = (value, idKey) => isPlainRecord(value) && isIdentifier(value[idKey], idKey) && isHexDigest(value[`${idKey.slice(0, -2)}Digest`]) && Object.keys(value).length === 2;
const isSorted = (values) => values.every((value, index) => index === 0 || values[index - 1] < value);
const isSortedKnowledgeRefs = (value) => {
    if (!Array.isArray(value) || !value.every(isKnowledgeRef))
        return false;
    const keys = value.map(refKey).sort();
    return new Set(keys).size === keys.length && JSON.stringify(keys) === JSON.stringify(value.map(refKey));
};
const REJECTED_REASON_CODES_V1 = new Set(["NOT_APPLICABLE", "STALE", "CONTRADICTED", "INSUFFICIENT_SOURCE_SUPPORT", "NOT_NEEDED", "POLICY_DENIED"]);
function reconstructionRecordValid(value) {
    if (value.schemaVersion !== CKS_RECONSTRUCTION_SCHEMA_V1)
        return false;
    if (value.status === "DENIED") {
        const keys = Object.keys(value).sort();
        if (JSON.stringify(keys) !== JSON.stringify(["reasonCodes", "schemaVersion", "status"]))
            return false;
        const codes = value.reasonCodes;
        if (!isStringArray(codes) || codes.length === 0 || codes.length > CKS_MAX_REASON_CODES_PER_DENIAL_V1)
            return false;
        if (new Set(codes).size !== codes.length)
            return false;
        if (!codes.every((code) => CKS_DENIAL_REASON_CODES_V1.includes(code)))
            return false;
        return isSorted(codes);
    }
    if (value.status !== "RECONSTRUCTED")
        return false;
    const keys = Object.keys(value).sort();
    if (JSON.stringify(keys) !== JSON.stringify([...CKS_RECONSTRUCTED_FIELDS_V1].sort()))
        return false;
    if (!isEntityRef(value.scopeRef, "scopeId"))
        return false;
    if (!isEntityRef(value.taskRef, "taskId"))
        return false;
    if (!isEntityRef(value.decisionRef, "decisionId"))
        return false;
    if (!isEntityRef(value.outcomeRef, "outcomeId"))
        return false;
    for (const field of ["searched", "inspected", "used", "decisionSupporting", "outcomeContributing"]) {
        const list = value[field];
        if (!Array.isArray(list) || !list.every(isKnowledgeRef))
            return false;
    }
    const rejected = value.rejected;
    if (!Array.isArray(rejected) || !rejected.every(isRejectedKnowledgeRef) || !rejected.every((item) => REJECTED_REASON_CODES_V1.has(item.reasonCode)))
        return false;
    if (!["searched", "inspected", "used", "decisionSupporting", "outcomeContributing"].every((field) => isSortedKnowledgeRefs(value[field])))
        return false;
    const rejectedKeys = rejected.map((item) => refKey(item.knowledgeRef));
    if (new Set(rejectedKeys).size !== rejectedKeys.length || JSON.stringify([...rejectedKeys].sort()) !== JSON.stringify(rejectedKeys))
        return false;
    if (!cksLineageSetInvariantsHeldV1(value))
        return false;
    if (!isHexDigest(value.reconstructionDigest))
        return false;
    // Every value is now plain-JSON-shaped with no prohibited keys, so the
    // frozen digest check is total (it cannot throw on this record).
    return cksDigestV1(value, "reconstructionDigest") === value.reconstructionDigest;
}
/**
 * Fail-closed validator for a CKS-08 reconstruction receipt (either arm):
 * a DENIED receipt must carry unique, sorted, capped denial codes and no
 * partial state; a RECONSTRUCTED receipt must carry the frozen 13-field set
 * with `reconstructionDigest` bound to the rest of the record.
 */
export function verifyCksLineageReconstructionV1(value) {
    if (!isPlainRecord(value) || !reconstructionRecordValid(value)) {
        return { outcome: "DENIED", reasonCodes: ["DIGEST_MISMATCH_DENIED"] };
    }
    return { outcome: "ACCEPTED", reasonCodes: [CKS_ACCEPTED_REASON_CODE_V1] };
}
const refKey = (ref) => `${ref.knowledgeId}|${ref.knowledgeDigest}`;
function isSubsetOf(outer, inner) {
    const keys = new Set(outer.map(refKey));
    return inner.every((ref) => keys.has(refKey(ref)));
}
/**
 * The frozen set invariants of `reconstructedUsageSemantics.setInvariants`:
 * INSPECTED ⊆ SEARCHED; USED ⊆ INSPECTED; REJECTED ⊆ INSPECTED;
 * USED ∩ REJECTED = ∅ (one disposition per Knowledge item);
 * DECISION_SUPPORTING ⊆ USED and OUTCOME_CONTRIBUTING ⊆ DECISION_SUPPORTING.
 */
export function cksLineageSetInvariantsHeldV1(usage) {
    const rejectedRefs = usage.rejected.map((item) => item.knowledgeRef);
    const usedKeys = new Set(usage.used.map(refKey));
    return (isSubsetOf(usage.searched, usage.inspected) &&
        isSubsetOf(usage.inspected, usage.used) &&
        isSubsetOf(usage.inspected, rejectedRefs) &&
        rejectedRefs.every((ref) => !usedKeys.has(refKey(ref))) &&
        isSubsetOf(usage.used, usage.decisionSupporting) &&
        isSubsetOf(usage.decisionSupporting, usage.outcomeContributing));
}
/** Type guards so callers can narrow the reconstruction result without re-implementing the frozen shape. */
export function isReconstructedKnowledgeUsageV1(value) {
    return isPlainRecord(value) && value.schemaVersion === CKS_RECONSTRUCTION_SCHEMA_V1 && value.status === "RECONSTRUCTED";
}
export function isDeniedKnowledgeUsageV1(value) {
    return isPlainRecord(value) && value.schemaVersion === CKS_RECONSTRUCTION_SCHEMA_V1 && value.status === "DENIED";
}
