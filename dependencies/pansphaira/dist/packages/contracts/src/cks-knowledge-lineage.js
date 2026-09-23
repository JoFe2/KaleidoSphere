import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
export const CKS_KNOWLEDGE_USAGE_EVENT_SCHEMA_V1 = "chimpmaera.knowledge/usage-lineage-event/v1";
export const CKS_DECISION_KNOWLEDGE_BINDING_SCHEMA_V1 = "chimpmaera.knowledge/usage-lineage-decision/v1";
export const CKS_TASK_OUTCOME_EVIDENCE_SCHEMA_V1 = "chimpmaera.knowledge/usage-lineage-outcome/v1";
export const CKS_FAILURE_ATTRIBUTION_SCHEMA_V1 = "chimpmaera.knowledge/failure-attribution/v1";
export const CKS_KNOWLEDGE_EVIDENCE_PROFILE_SCHEMA_V1 = "chimpmaera.knowledge/evidence-profile/v1";
export const CKS_KNOWLEDGE_LINEAGE_SEMANTIC_RULE_V1 = "chimpmaera.knowledge/usage-lineage-semantics/v1";
export const CKS_LOCAL_SYNTHETIC_SCOPE_CLASS_V1 = "LOCAL_SYNTHETIC_FIXTURE";
export const CKS_LATE_WINDOW_MS_V1 = 300000;
export const CKS_MAX_EVENTS_PER_SCOPE_V1 = 4096;
export const CKS_MAX_EVENTS_PER_TASK_V1 = 256;
export const CKS_MAX_SEARCHES_PER_TASK_V1 = 16;
export const CKS_MAX_KNOWLEDGE_REFS_V1 = 32;
export const CKS_MAX_FAILURE_CAUSES_V1 = 3;
export const CKS_MAX_CAUSE_EVENT_REFS_V1 = 3;
export const CKS_MAX_REASON_CODES_PER_DENIAL_V1 = 8;
export const KNOWLEDGE_USAGE_EVENT_SCHEMA_V1 = CKS_KNOWLEDGE_USAGE_EVENT_SCHEMA_V1;
export const DECISION_KNOWLEDGE_BINDING_SCHEMA_V1 = CKS_DECISION_KNOWLEDGE_BINDING_SCHEMA_V1;
export const TASK_OUTCOME_EVIDENCE_SCHEMA_V1 = CKS_TASK_OUTCOME_EVIDENCE_SCHEMA_V1;
export const FAILURE_ATTRIBUTION_SCHEMA_V1 = CKS_FAILURE_ATTRIBUTION_SCHEMA_V1;
export const KNOWLEDGE_EVIDENCE_PROFILE_SCHEMA_V1 = CKS_KNOWLEDGE_EVIDENCE_PROFILE_SCHEMA_V1;
export const CKS_DIRECT_FAILURE_RECEIPT_SCHEMA_V1 = "chimpmaera.knowledge/direct-failure-receipt/v1";
export const CKS_DIRECT_FAILURE_EVENT_TYPE_BY_CLASS_V1 = {
    EXECUTION: "EXECUTION_RECEIPT_RECORDED",
    TASK_INPUT: "TASK_INPUT_RECEIPT_RECORDED",
    EXTERNAL: "EXTERNAL_RECEIPT_RECORDED",
    GOVERNANCE: "GOVERNANCE_RECEIPT_RECORDED",
};
export const CKS_EVENT_TYPES_V1 = [
    "TASK_OPENED", "SEARCH_RECORDED", "KNOWLEDGE_INSPECTED", "KNOWLEDGE_DISPOSITIONED",
    "DECISION_RECORDED", ...Object.values(CKS_DIRECT_FAILURE_EVENT_TYPE_BY_CLASS_V1), "OUTCOME_RECORDED",
];
export const CKS_FAILURE_SUBTYPES_V1 = {
    KNOWLEDGE: ["SOURCE_DEFECT", "APPLICABILITY_MISMATCH", "STALE", "CONTRADICTED", "MISSING", "UNSUPPORTED_GENERALIZATION"],
    SEARCH: ["RELEVANT_NOT_RETURNED", "RELEVANT_NOT_INSPECTED", "RELEVANT_REJECTED"],
    DECISION: ["UNSUPPORTED_SELECTION", "SUPPORTED_OPTION_IGNORED"],
    EXECUTION: ["ACTION_FAILED", "READBACK_FAILED"],
    TASK_INPUT: ["MISSING_CONTEXT", "INVALID_INPUT"],
    EXTERNAL: ["DEPENDENCY_UNAVAILABLE", "ENVIRONMENT_DRIFT"],
    GOVERNANCE: ["POLICY_DENIED", "AUTHORITY_DENIED"],
    UNKNOWN: ["INSUFFICIENT_CAUSAL_EVIDENCE"],
};
const FAILURE_CLASSES = Object.keys(CKS_FAILURE_SUBTYPES_V1);
const FAILURE_CERTAINTIES = ["CONFIRMED", "SUPPORTED", "POSSIBLE", "UNKNOWN"];
const CAUSAL_MODES = ["NOT_APPLICABLE", "SINGLE", "MULTI_CONTRIBUTING", "MULTI_JOINT", "ALTERNATIVES_UNRESOLVED", "UNKNOWN"];
const PROHIBITED_KEYS = new Set(["actoridentity", "chainofthought", "command", "content", "credential", "customer", "email", "filename", "filepath", "hostname", "identity", "ipaddress", "message", "path", "person", "phone", "prompt", "rawevent", "rawpayload", "rawreasoning", "rawtext", "reasoning", "response", "secret", "sessionid", "tenantid", "token", "userid", "username"]);
const id = (v, pattern) => typeof v === "string" && pattern.test(v);
const digest = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const timestamp = (v) => Number.isSafeInteger(v) && v >= 0;
const scopeId = (v) => id(v, /^scope:v1:[a-f0-9]{64}$/);
const taskId = (v) => id(v, /^task:v1:[a-f0-9]{64}$/);
const searchId = (v) => id(v, /^search:v1:[a-f0-9]{64}$/);
const knowledgeId = (v) => id(v, /^[a-z][a-z0-9-]{1,31}:[a-z0-9][a-z0-9._-]{2,95}$/);
const decisionId = (v) => id(v, /^decision:v1:[a-f0-9]{64}$/);
const outcomeId = (v) => id(v, /^outcome:v1:[a-f0-9]{64}$/);
const eventId = (v) => id(v, /^lineage-event:v1:[a-f0-9]{64}$/);
const normalized = (v) => v.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
const key = (v) => Object.keys(v).sort().join("\u0000");
const exact = (v, keys) => isRecord(v) && key(v) === [...keys].sort().join("\u0000");
function isRecord(v) { return v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype; }
function safeStructure(v, seen = new Set()) {
    if (v === null || typeof v === "string" || typeof v === "boolean")
        return true;
    if (typeof v === "number")
        return Number.isFinite(v);
    if (typeof v !== "object")
        return false;
    if (seen.has(v))
        return false;
    seen.add(v);
    if (Array.isArray(v)) {
        if (!Object.keys(v).every((k) => /^\d+$/.test(k)) || Object.keys(v).length !== v.length)
            return false;
        const valid = v.every((item) => safeStructure(item, seen));
        seen.delete(v);
        return valid;
    }
    if (Object.getPrototypeOf(v) !== Object.prototype)
        return false;
    for (const symbol of Object.getOwnPropertySymbols(v))
        if (symbol)
            return false;
    for (const name of Object.keys(v)) {
        const descriptor = Object.getOwnPropertyDescriptor(v, name);
        if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true || PROHIBITED_KEYS.has(normalized(name)))
            return false;
        if (!safeStructure(descriptor.value, seen))
            return false;
    }
    seen.delete(v);
    return true;
}
function refs(v, names, identifier) {
    return exact(v, names) && identifier(v[names[0]]) && digest(v[names[1]]);
}
const scopeRef = (v) => refs(v, ["scopeId", "scopeDigest"], scopeId);
const taskRef = (v) => refs(v, ["taskId", "taskDigest"], taskId);
const searchRef = (v) => refs(v, ["searchId", "searchDigest"], searchId);
const knowledgeRef = (v) => refs(v, ["knowledgeId", "knowledgeDigest"], knowledgeId);
const decisionRef = (v) => refs(v, ["decisionId", "decisionDigest"], decisionId);
const outcomeRef = (v) => refs(v, ["outcomeId", "outcomeDigest"], outcomeId);
const eventRef = (v) => refs(v, ["eventId", "eventDigest"], eventId);
const refSort = (a, b) => {
    const identifier = (ref) => ref.knowledgeId ?? ref.eventId ?? ref.searchId ?? ref.decisionId ?? ref.outcomeId ?? ref.taskId ?? ref.scopeId ?? "";
    const digestValue = (ref) => ref.knowledgeDigest ?? ref.eventDigest ?? ref.searchDigest ?? ref.decisionDigest ?? ref.outcomeDigest ?? ref.taskDigest ?? ref.scopeDigest ?? "";
    return `${identifier(a)}|${digestValue(a)}`.localeCompare(`${identifier(b)}|${digestValue(b)}`);
};
function sortedUnique(v, valid, maximum = CKS_MAX_KNOWLEDGE_REFS_V1) {
    if (!Array.isArray(v) || v.length > maximum || !v.every(valid) || new Set(v.map((x) => JSON.stringify(x))).size !== v.length)
        return false;
    return v.every((item, index) => index === 0 || refSort(v[index - 1], item) < 0);
}
function sha(value) { if (!safeStructure(value))
    throw new TypeError("CKS_DIGEST_INPUT_DENIED"); return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex"); }
function unsigned(value, field) { return Object.fromEntries(Object.entries(value).filter(([name]) => name !== field)); }
export const cksDigestV1 = (value, field) => {
    if (!isRecord(value) || !safeStructure(value))
        throw new TypeError("CKS_DIGEST_INPUT_DENIED");
    return sha(unsigned(value, field));
};
export const knowledgeUsageFactDigestV1 = (value) => sha(value);
export const knowledgeUsageEventDigestV1 = (value) => cksDigestV1(value, "eventDigest");
export const usageLineageTaskDigestV1 = (value) => cksDigestV1(value, "taskDigest");
export const usageLineageSearchDigestV1 = (value) => cksDigestV1(value, "searchDigest");
export const decisionKnowledgeBindingDigestV1 = (value) => cksDigestV1(value, "decisionDigest");
export const directFailureReceiptDigestV1 = (value) => cksDigestV1(value, "receiptDigest");
export const taskOutcomeEvidenceDigestV1 = (value) => cksDigestV1(value, "outcomeDigest");
export const failureAttributionDigestV1 = (value) => cksDigestV1(value, "failureAttributionDigest");
export const knowledgeEvidenceProfileDigestV1 = (value) => cksDigestV1(value, "profileDigest");
function validScopeAndTask(value) {
    return exact(value, ["schemaVersion", "semanticRuleId", "scopeRef", "taskId", "taskKind", "objectiveDigest", "applicabilityContextDigest", "taskSemanticDigest", "contextFingerprintDigest", "taskDigest"])
        && value.schemaVersion === "chimpmaera.knowledge/usage-lineage-task/v1" && value.semanticRuleId === CKS_KNOWLEDGE_LINEAGE_SEMANTIC_RULE_V1 && scopeRef(value.scopeRef) && taskId(value.taskId)
        && ["RETRIEVE", "DECIDE", "ACT", "VERIFY"].includes(value.taskKind) && digest(value.objectiveDigest) && digest(value.applicabilityContextDigest) && digest(value.taskSemanticDigest) && digest(value.contextFingerprintDigest) && digest(value.taskDigest)
        && usageLineageTaskDigestV1(value) === value.taskDigest;
}
function validSearch(value) {
    return exact(value, ["schemaVersion", "semanticRuleId", "scopeRef", "taskRef", "searchId", "searchIntentDigest", "resultKnowledgeRefs", "searchDigest"])
        && value.schemaVersion === "chimpmaera.knowledge/usage-lineage-search/v1" && value.semanticRuleId === CKS_KNOWLEDGE_LINEAGE_SEMANTIC_RULE_V1 && scopeRef(value.scopeRef) && taskRef(value.taskRef) && searchId(value.searchId) && digest(value.searchIntentDigest) && sortedUnique(value.resultKnowledgeRefs, knowledgeRef) && digest(value.searchDigest)
        && usageLineageSearchDigestV1(value) === value.searchDigest;
}
function validFailureCause(value) {
    return exact(value, ["class", "subtype", "certainty", "causeEventRefs", "affectedKnowledgeRefs"])
        && FAILURE_CLASSES.includes(value.class) && CKS_FAILURE_SUBTYPES_V1[value.class].includes(value.subtype)
        && FAILURE_CERTAINTIES.includes(value.certainty) && sortedUnique(value.causeEventRefs, eventRef, CKS_MAX_CAUSE_EVENT_REFS_V1) && sortedUnique(value.affectedKnowledgeRefs, knowledgeRef)
        && (value.class === "UNKNOWN" ? value.affectedKnowledgeRefs.length === 0 && value.certainty === "UNKNOWN" : value.causeEventRefs.length > 0);
}
export function validateFailureAttributionV1(value) {
    if (!safeStructure(value) || !exact(value, ["schemaVersion", "semanticRuleId", "causalMode", "causes", "failureAttributionDigest"]) || value.schemaVersion !== CKS_FAILURE_ATTRIBUTION_SCHEMA_V1 || value.semanticRuleId !== CKS_KNOWLEDGE_LINEAGE_SEMANTIC_RULE_V1 || !CAUSAL_MODES.includes(value.causalMode) || !Array.isArray(value.causes) || value.causes.length > 3 || !value.causes.every(validFailureCause) || !digest(value.failureAttributionDigest))
        return false;
    const causes = value.causes;
    const signatures = causes.map((cause) => `${cause.class}|${cause.subtype}`);
    if (new Set(signatures).size !== signatures.length || signatures.some((item, i) => i > 0 && signatures[i - 1] >= item))
        return false;
    const mode = value.causalMode;
    if (mode === "NOT_APPLICABLE" && causes.length !== 0)
        return false;
    if (mode === "UNKNOWN" && (causes.length !== 1 || causes[0].class !== "UNKNOWN"))
        return false;
    if (mode === "SINGLE" && (causes.length !== 1 || !["CONFIRMED", "SUPPORTED"].includes(causes[0].certainty)))
        return false;
    if (["MULTI_CONTRIBUTING", "MULTI_JOINT"].includes(mode) && (causes.length < 2 || !causes.every((cause) => ["CONFIRMED", "SUPPORTED"].includes(cause.certainty))))
        return false;
    if (mode === "ALTERNATIVES_UNRESOLVED" && (causes.length < 2 || !causes.every((cause) => cause.certainty === "POSSIBLE")))
        return false;
    return failureAttributionDigestV1(value) === value.failureAttributionDigest;
}
export function validateDecisionKnowledgeBindingV1(value) {
    return safeStructure(value) && exact(value, ["schemaVersion", "semanticRuleId", "scopeRef", "taskRef", "decisionId", "decisionClass", "supportingKnowledgeRefs", "decisionDigest"])
        && value.schemaVersion === CKS_DECISION_KNOWLEDGE_BINDING_SCHEMA_V1 && value.semanticRuleId === CKS_KNOWLEDGE_LINEAGE_SEMANTIC_RULE_V1 && scopeRef(value.scopeRef) && taskRef(value.taskRef) && decisionId(value.decisionId)
        && ["SELECTED", "REJECTED", "DEFERRED", "DENIED"].includes(value.decisionClass) && sortedUnique(value.supportingKnowledgeRefs, knowledgeRef) && digest(value.decisionDigest)
        && decisionKnowledgeBindingDigestV1(value) === value.decisionDigest;
}
export function validateDirectFailureReceiptV1(value) {
    if (!safeStructure(value) || !exact(value, ["schemaVersion", "semanticRuleId", "scopeRef", "taskRef", "decisionRef", "failureClass", "failureSubtype", "evidenceDigest", "receiptDigest"]))
        return false;
    const failureClass = value.failureClass;
    return value.schemaVersion === CKS_DIRECT_FAILURE_RECEIPT_SCHEMA_V1
        && value.semanticRuleId === CKS_KNOWLEDGE_LINEAGE_SEMANTIC_RULE_V1
        && Object.hasOwn(CKS_DIRECT_FAILURE_EVENT_TYPE_BY_CLASS_V1, failureClass)
        && scopeRef(value.scopeRef)
        && taskRef(value.taskRef)
        && decisionRef(value.decisionRef)
        && typeof value.failureSubtype === "string"
        && CKS_FAILURE_SUBTYPES_V1[failureClass].includes(value.failureSubtype)
        && digest(value.evidenceDigest)
        && digest(value.receiptDigest)
        && directFailureReceiptDigestV1(value) === value.receiptDigest;
}
export function validateTaskOutcomeEvidenceV1(value) {
    return safeStructure(value) && exact(value, ["schemaVersion", "semanticRuleId", "scopeRef", "taskRef", "decisionRef", "outcomeId", "outcomeClass", "contributingKnowledgeRefs", "failureAttribution", "outcomeDigest"])
        && value.schemaVersion === CKS_TASK_OUTCOME_EVIDENCE_SCHEMA_V1 && value.semanticRuleId === CKS_KNOWLEDGE_LINEAGE_SEMANTIC_RULE_V1 && scopeRef(value.scopeRef) && taskRef(value.taskRef) && decisionRef(value.decisionRef) && outcomeId(value.outcomeId)
        && ["SUCCEEDED", "FAILED", "PARTIAL", "DENIED", "UNKNOWN"].includes(value.outcomeClass) && sortedUnique(value.contributingKnowledgeRefs, knowledgeRef) && validateFailureAttributionV1(value.failureAttribution) && digest(value.outcomeDigest)
        && (value.outcomeClass === "SUCCEEDED" ? value.failureAttribution.causalMode === "NOT_APPLICABLE" && value.failureAttribution.causes.length === 0 : value.outcomeClass === "UNKNOWN" ? value.failureAttribution.causalMode === "UNKNOWN" : value.failureAttribution.causes.length > 0)
        && taskOutcomeEvidenceDigestV1(value) === value.outcomeDigest;
}
function validFact(type, fact, event) {
    if (!isRecord(fact))
        return false;
    const eventScope = event.scopeRef, eventTask = event.taskRef;
    if (type === "TASK_OPENED") {
        const task = fact.task;
        return exact(fact, ["task"]) && validScopeAndTask(task) && task.scopeRef.scopeId === eventScope.scopeId && task.taskId === eventTask.taskId && task.scopeRef.scopeDigest === eventScope.scopeDigest && task.taskDigest === eventTask.taskDigest;
    }
    if (type === "SEARCH_RECORDED") {
        const search = fact.search;
        return exact(fact, ["search"]) && validSearch(search) && search.scopeRef.scopeId === eventScope.scopeId && search.scopeRef.scopeDigest === eventScope.scopeDigest && search.taskRef.taskId === eventTask.taskId && search.taskRef.taskDigest === eventTask.taskDigest;
    }
    if (type === "KNOWLEDGE_INSPECTED")
        return exact(fact, ["scopeRef", "taskRef", "searchRef", "knowledgeRef"]) && scopeRef(fact.scopeRef) && taskRef(fact.taskRef) && searchRef(fact.searchRef) && knowledgeRef(fact.knowledgeRef) && sameScopeTask(fact, event);
    if (type === "KNOWLEDGE_DISPOSITIONED")
        return exact(fact, ["scopeRef", "taskRef", "knowledgeRef", "disposition", "reasonCode"]) && scopeRef(fact.scopeRef) && taskRef(fact.taskRef) && knowledgeRef(fact.knowledgeRef) && ["USED", "REJECTED"].includes(fact.disposition) && (["USED", "REJECTED"].includes(fact.disposition) ? (fact.disposition === "USED" ? fact.reasonCode === "SELECTED_FOR_TASK" : ["NOT_APPLICABLE", "STALE", "CONTRADICTED", "INSUFFICIENT_SOURCE_SUPPORT", "NOT_NEEDED", "POLICY_DENIED"].includes(fact.reasonCode)) : false) && sameScopeTask(fact, event);
    if (type === "DECISION_RECORDED") {
        const decision = fact.decision;
        return exact(fact, ["decision"]) && validateDecisionKnowledgeBindingV1(decision) && decision.scopeRef.scopeId === eventScope.scopeId && decision.scopeRef.scopeDigest === eventScope.scopeDigest && decision.taskRef.taskId === eventTask.taskId && decision.taskRef.taskDigest === eventTask.taskDigest;
    }
    const directFailureClass = Object.keys(CKS_DIRECT_FAILURE_EVENT_TYPE_BY_CLASS_V1)
        .find((failureClass) => CKS_DIRECT_FAILURE_EVENT_TYPE_BY_CLASS_V1[failureClass] === type);
    if (directFailureClass) {
        const receipt = fact.receipt;
        return exact(fact, ["receipt"])
            && validateDirectFailureReceiptV1(receipt)
            && receipt.failureClass === directFailureClass
            && receipt.scopeRef.scopeId === eventScope.scopeId
            && receipt.scopeRef.scopeDigest === eventScope.scopeDigest
            && receipt.taskRef.taskId === eventTask.taskId
            && receipt.taskRef.taskDigest === eventTask.taskDigest;
    }
    if (type === "OUTCOME_RECORDED") {
        const outcome = fact.outcome;
        return exact(fact, ["outcome"]) && validateTaskOutcomeEvidenceV1(outcome) && outcome.scopeRef.scopeId === eventScope.scopeId && outcome.scopeRef.scopeDigest === eventScope.scopeDigest && outcome.taskRef.taskId === eventTask.taskId && outcome.taskRef.taskDigest === eventTask.taskDigest;
    }
    return false;
}
function sameScopeTask(fact, event) {
    const s = fact.scopeRef, t = fact.taskRef, es = event.scopeRef, et = event.taskRef;
    return s.scopeId === es.scopeId && s.scopeDigest === es.scopeDigest && t.taskId === et.taskId && t.taskDigest === et.taskDigest;
}
function validEventShape(value) {
    if (!safeStructure(value) || !exact(value, ["schemaVersion", "semanticRuleId", "eventId", "eventType", "scopeRef", "taskRef", "occurredAtMs", "receivedAtMs", "scopeSequence", "previousEventDigest", "fact", "factDigest", "eventDigest"]))
        return false;
    const event = value;
    return event.schemaVersion === CKS_KNOWLEDGE_USAGE_EVENT_SCHEMA_V1 && event.semanticRuleId === CKS_KNOWLEDGE_LINEAGE_SEMANTIC_RULE_V1 && eventId(event.eventId) && CKS_EVENT_TYPES_V1.includes(event.eventType) && scopeRef(event.scopeRef) && taskRef(event.taskRef)
        && timestamp(event.occurredAtMs) && timestamp(event.receivedAtMs) && event.receivedAtMs >= event.occurredAtMs && Number.isSafeInteger(event.scopeSequence) && event.scopeSequence >= 0 && (event.previousEventDigest === null || digest(event.previousEventDigest)) && digest(event.factDigest) && digest(event.eventDigest)
        && knowledgeUsageFactDigestV1(event.fact) === event.factDigest && validFact(event.eventType, event.fact, event) && knowledgeUsageEventDigestV1(event) === event.eventDigest;
}
export function validateKnowledgeUsageEventV1(value) { return validEventShape(value); }
export function verifyKnowledgeUsageEventV1(value) { if (!safeStructure(value))
    return { outcome: "DENIED", reasonCodes: ["PROHIBITED_FIELD_DENIED"] }; return validEventShape(value) ? { outcome: "ACCEPTED", reasonCodes: ["CONTRACT_VERIFIED"] } : { outcome: "DENIED", reasonCodes: ["DIGEST_MISMATCH_DENIED"] }; }
function validProfileDimension(value) {
    if (!isRecord(value))
        return false;
    return exact(value, ["source", "applicability", "freshness", "contradiction", "generalization", "operational"])
        && exact(value.source, ["knowledgeDigest", "attributionSetDigest", "epistemicStatus", "trust"]) && digest(value.source.knowledgeDigest) && digest(value.source.attributionSetDigest) && ["VERIFIED", "SUPPORTED", "UNVERIFIED", "DISPUTED", "UNRESOLVED"].includes(value.source.epistemicStatus) && ["LOW", "MEDIUM", "HIGH"].includes(value.source.trust)
        && exact(value.applicability, ["applicabilityScopeDigest", "contextFingerprintDigest", "matchState"]) && digest(value.applicability.applicabilityScopeDigest) && digest(value.applicability.contextFingerprintDigest) && ["MATCH", "NO_MATCH", "NEEDS_CONTEXT", "CONFLICT"].includes(value.applicability.matchState)
        && exact(value.freshness, ["knowledgeDigest", "evaluatedAtMs", "freshnessState"]) && digest(value.freshness.knowledgeDigest) && timestamp(value.freshness.evaluatedAtMs) && ["FRESH", "STALE", "UNKNOWN"].includes(value.freshness.freshnessState)
        && exact(value.contradiction, ["knowledgeDigest", "conflictSetDigest", "contradictionState"]) && digest(value.contradiction.knowledgeDigest) && digest(value.contradiction.conflictSetDigest) && ["NONE_DECLARED", "DECLARED_UNRESOLVED", "UNKNOWN"].includes(value.contradiction.contradictionState)
        && validGeneralization(value.generalization) && validOperational(value.operational);
}
function validGeneralization(value) {
    return isRecord(value) && exact(value, ["validTaskOccurrenceCount", "distinctTaskSemanticCount", "distinctContextCount", "distinctJointUsageUnitCount", "identicalRepetitionCount", "marker"]) && ["validTaskOccurrenceCount", "distinctTaskSemanticCount", "distinctContextCount", "distinctJointUsageUnitCount", "identicalRepetitionCount"].every((name) => Number.isSafeInteger(value[name]) && value[name] >= 0) && value.distinctTaskSemanticCount <= value.distinctJointUsageUnitCount && value.distinctContextCount <= value.distinctJointUsageUnitCount && value.distinctJointUsageUnitCount <= value.validTaskOccurrenceCount && value.identicalRepetitionCount === value.validTaskOccurrenceCount - value.distinctJointUsageUnitCount && (value.marker === null || value.marker === "+G") && ((value.marker === "+G") === (value.distinctTaskSemanticCount >= 2 && value.distinctContextCount >= 2));
}
function validOperational(value) {
    if (!isRecord(value) || !exact(value, ["eligibleOutcomeOccurrenceCount", "distinctOperationalUnitCount", "distinctOutcomeUnitsByClass", "uncertainOutcomeOccurrenceCount", "failureCauseObservations", "marker"]))
        return false;
    const byClass = value.distinctOutcomeUnitsByClass;
    if (!["eligibleOutcomeOccurrenceCount", "distinctOperationalUnitCount", "uncertainOutcomeOccurrenceCount"].every((name) => Number.isSafeInteger(value[name]) && value[name] >= 0) || !exact(byClass, ["SUCCEEDED", "FAILED", "PARTIAL", "DENIED"]) || !["SUCCEEDED", "FAILED", "PARTIAL", "DENIED"].every((name) => Number.isSafeInteger(byClass[name]) && byClass[name] >= 0))
        return false;
    const outcomeClassTotal = ["SUCCEEDED", "FAILED", "PARTIAL", "DENIED"].reduce((total, name) => total + byClass[name], 0);
    return value.distinctOperationalUnitCount <= value.eligibleOutcomeOccurrenceCount && outcomeClassTotal === value.distinctOperationalUnitCount && Array.isArray(value.failureCauseObservations) && value.failureCauseObservations.length <= 96 && value.failureCauseObservations.every((item) => exact(item, ["class", "subtype", "certainty"]) && FAILURE_CLASSES.includes(item.class) && CKS_FAILURE_SUBTYPES_V1[item.class].includes(item.subtype) && FAILURE_CERTAINTIES.includes(item.certainty)) && (value.marker === null || value.marker === "+O") && ((value.marker === "+O") === (value.distinctOperationalUnitCount >= 1));
}
export function validateKnowledgeEvidenceProfileV1(value) {
    if (!safeStructure(value) || !exact(value, ["schemaVersion", "semanticRuleId", "scopeRef", "knowledgeRef", "dimensions", "profileDigest"]))
        return false;
    const profile = value;
    if (profile.schemaVersion !== CKS_KNOWLEDGE_EVIDENCE_PROFILE_SCHEMA_V1 || profile.semanticRuleId !== CKS_KNOWLEDGE_LINEAGE_SEMANTIC_RULE_V1 || !scopeRef(profile.scopeRef) || !knowledgeRef(profile.knowledgeRef) || !validProfileDimension(profile.dimensions) || !digest(profile.profileDigest))
        return false;
    const dimensions = profile.dimensions, reference = profile.knowledgeRef;
    return dimensions.source.knowledgeDigest === reference.knowledgeDigest && dimensions.freshness.knowledgeDigest === reference.knowledgeDigest && dimensions.contradiction.knowledgeDigest === reference.knowledgeDigest && knowledgeEvidenceProfileDigestV1(profile) === profile.profileDigest;
}
const refSignature = (v) => `${v.knowledgeId}|${v.knowledgeDigest}`;
function sameRef(a, b) { return a.knowledgeId === b.knowledgeId && a.knowledgeDigest === b.knowledgeDigest; }
function includesRef(list, wanted) { return list.some((item) => sameRef(item, wanted)); }
function denied(reasonCodes) { return { schemaVersion: "chimpmaera.knowledge/usage-lineage-reconstruction/v1", status: "DENIED", reasonCodes: [...new Set(reasonCodes)].sort() }; }
export function reconstructKnowledgeUsageV1(input) {
    if (!Array.isArray(input) || input.length === 0 || input.length > CKS_MAX_EVENTS_PER_SCOPE_V1 || !input.every(validEventShape))
        return denied(["SCHEMA_DENIED"]);
    const events = [...input].sort((a, b) => a.scopeSequence - b.scopeSequence);
    const first = events[0];
    const seenIds = new Map(), seenDigests = new Set(), seenFacts = new Set();
    let watermark = 0, previous = null;
    for (let index = 0; index < events.length; index += 1) {
        const event = events[index];
        if (event.scopeSequence !== index || (index === 0 ? event.previousEventDigest !== null : event.previousEventDigest !== previous.eventDigest))
            return denied([index === 0 ? "SEQUENCE_GAP_DENIED" : "PREVIOUS_DIGEST_MISMATCH_DENIED"]);
        if (event.scopeRef.scopeId !== first.scopeRef.scopeId || event.scopeRef.scopeDigest !== first.scopeRef.scopeDigest || event.taskRef.taskId !== first.taskRef.taskId || event.taskRef.taskDigest !== first.taskRef.taskDigest)
            return denied(["SCOPE_MISMATCH_DENIED"]);
        if ((seenIds.has(event.eventId) && seenIds.get(event.eventId) !== event.eventDigest))
            return denied(["TAMPERED_LINEAGE_DENIED"]);
        if (seenIds.has(event.eventId) || seenDigests.has(event.eventDigest) || seenFacts.has(event.factDigest))
            return denied(["REPLAY_DENIED"]);
        if (event.receivedAtMs < (previous?.receivedAtMs ?? 0) || event.receivedAtMs - event.occurredAtMs > CKS_LATE_WINDOW_MS_V1 || watermark - event.occurredAtMs > CKS_LATE_WINDOW_MS_V1)
            return denied(["LATE_EVENT_DENIED"]);
        seenIds.set(event.eventId, event.eventDigest);
        seenDigests.add(event.eventDigest);
        seenFacts.add(event.factDigest);
        watermark = Math.max(watermark, event.occurredAtMs);
        previous = event;
    }
    const opened = events.filter((event) => event.eventType === "TASK_OPENED");
    if (opened.length !== 1 || events[0].eventType !== "TASK_OPENED")
        return denied(["INCOMPLETE_LINEAGE_DENIED"]);
    if (events.length > CKS_MAX_EVENTS_PER_TASK_V1)
        return denied(["CAPACITY_DENIED"]);
    const searches = new Map(), inspected = [], dispositions = new Map();
    let decision = null, outcome = null, decisionSequence = Infinity, outcomeSequence = Infinity;
    const task = opened[0].fact.task;
    for (const [index, event] of events.entries()) {
        if (event.eventType === "SEARCH_RECORDED") {
            if (decision || outcome)
                return denied(["TASK_FROZEN_DENIED"]);
            const search = event.fact.search;
            if (searches.size >= CKS_MAX_SEARCHES_PER_TASK_V1)
                return denied(["CAPACITY_DENIED"]);
            if (searches.has(search.searchId))
                return denied(["REPLAY_DENIED"]);
            searches.set(search.searchId, search);
        }
        else if (event.eventType === "KNOWLEDGE_INSPECTED") {
            if (decision || outcome)
                return denied(["TASK_FROZEN_DENIED"]);
            const fact = event.fact;
            const search = searches.get(fact.searchRef.searchId);
            if (!search || search.searchDigest !== fact.searchRef.searchDigest || !includesRef(search.resultKnowledgeRefs, fact.knowledgeRef) || includesRef(inspected, fact.knowledgeRef))
                return denied([search ? "TRANSITION_DENIED" : "PARENT_MISSING_DENIED"]);
            inspected.push(fact.knowledgeRef);
        }
        else if (event.eventType === "KNOWLEDGE_DISPOSITIONED") {
            if (decision || outcome)
                return denied(["TASK_FROZEN_DENIED"]);
            const fact = event.fact;
            if (!includesRef(inspected, fact.knowledgeRef) || dispositions.has(refSignature(fact.knowledgeRef)))
                return denied([dispositions.has(refSignature(fact.knowledgeRef)) ? "TRANSITION_DENIED" : "PARENT_MISSING_DENIED"]);
            dispositions.set(refSignature(fact.knowledgeRef), { ref: fact.knowledgeRef, disposition: fact.disposition, reasonCode: fact.reasonCode });
        }
        else if (event.eventType === "DECISION_RECORDED") {
            if (decision || outcome)
                return denied(["TRANSITION_DENIED"]);
            decision = event.fact.decision;
            decisionSequence = index;
            if (!decision.supportingKnowledgeRefs.every((ref) => dispositions.get(refSignature(ref))?.disposition === "USED"))
                return denied(["TRANSITION_DENIED"]);
        }
        else if (Object.values(CKS_DIRECT_FAILURE_EVENT_TYPE_BY_CLASS_V1).includes(event.eventType)) {
            if (!decision || outcome)
                return denied([outcome ? "TASK_SEALED_DENIED" : "PARENT_MISSING_DENIED"]);
            const receipt = event.fact.receipt;
            if (receipt.decisionRef.decisionId !== decision.decisionId || receipt.decisionRef.decisionDigest !== decision.decisionDigest)
                return denied(["UPSTREAM_BINDING_DENIED"]);
        }
        else if (event.eventType === "OUTCOME_RECORDED") {
            if (!decision || outcome)
                return denied([decision ? "TRANSITION_DENIED" : "PARENT_MISSING_DENIED"]);
            outcome = event.fact.outcome;
            outcomeSequence = index;
            if (outcome.decisionRef.decisionId !== decision.decisionId || outcome.decisionRef.decisionDigest !== decision.decisionDigest || !outcome.contributingKnowledgeRefs.every((ref) => decision.supportingKnowledgeRefs.some((candidate) => sameRef(candidate, ref))))
                return denied(["TRANSITION_DENIED"]);
            if (!validateFailureEvidence(outcome, outcome.contributingKnowledgeRefs))
                return denied(["FAILURE_ATTRIBUTION_DENIED"]);
        }
        if (event.eventType === "TASK_OPENED" && index !== 0)
            return denied(["TRANSITION_DENIED"]);
    }
    if (!decision || !outcome || decisionSequence >= outcomeSequence)
        return denied(["INCOMPLETE_LINEAGE_DENIED"]);
    const eventByRef = new Map(events.map((event) => [event.eventId, event]));
    for (const cause of outcome.failureAttribution.causes) {
        if (cause.class === "KNOWLEDGE" && cause.subtype !== "MISSING" && cause.affectedKnowledgeRefs.length === 0)
            return denied(["FAILURE_ATTRIBUTION_DENIED"]);
        if (Object.hasOwn(CKS_DIRECT_FAILURE_EVENT_TYPE_BY_CLASS_V1, cause.class) && cause.affectedKnowledgeRefs.length !== 0)
            return denied(["FAILURE_ATTRIBUTION_DENIED"]);
        for (const causeRef of cause.causeEventRefs) {
            const causeEvent = eventByRef.get(causeRef.eventId);
            if (!causeEvent || causeEvent.eventDigest !== causeRef.eventDigest || causeEvent.scopeRef.scopeId !== first.scopeRef.scopeId || causeEvent.taskRef.taskId !== first.taskRef.taskId || causeEvent.scopeSequence >= outcomeSequence)
                return denied(["FAILURE_ATTRIBUTION_DENIED"]);
            if (cause.class === "DECISION" && causeEvent.eventType !== "DECISION_RECORDED")
                return denied(["FAILURE_ATTRIBUTION_DENIED"]);
            if (cause.class === "SEARCH" && !["SEARCH_RECORDED", "KNOWLEDGE_INSPECTED", "KNOWLEDGE_DISPOSITIONED"].includes(causeEvent.eventType))
                return denied(["FAILURE_ATTRIBUTION_DENIED"]);
            if (cause.class === "KNOWLEDGE" && cause.subtype !== "MISSING" && causeEvent.eventType !== "KNOWLEDGE_DISPOSITIONED")
                return denied(["FAILURE_ATTRIBUTION_DENIED"]);
            if (Object.hasOwn(CKS_DIRECT_FAILURE_EVENT_TYPE_BY_CLASS_V1, cause.class)) {
                const directClass = cause.class;
                const receipt = causeEvent.fact.receipt;
                if (causeEvent.eventType !== CKS_DIRECT_FAILURE_EVENT_TYPE_BY_CLASS_V1[directClass]
                    || !receipt
                    || receipt.failureClass !== directClass
                    || receipt.failureSubtype !== cause.subtype
                    || receipt.decisionRef.decisionId !== decision.decisionId
                    || receipt.decisionRef.decisionDigest !== decision.decisionDigest)
                    return denied(["FAILURE_ATTRIBUTION_DENIED"]);
            }
        }
    }
    const searched = [...new Map([...searches.values()].flatMap((search) => search.resultKnowledgeRefs.map((ref) => [refSignature(ref), ref]))).values()].sort(refSort);
    const sortedInspected = [...inspected].sort(refSort), used = [...dispositions.values()].filter((item) => item.disposition === "USED").map((item) => item.ref).sort(refSort);
    const rejected = [...dispositions.values()].filter((item) => item.disposition === "REJECTED").map((item) => ({ knowledgeRef: item.ref, reasonCode: item.reasonCode })).sort((a, b) => refSort(a.knowledgeRef, b.knowledgeRef));
    const unsigned = { schemaVersion: "chimpmaera.knowledge/usage-lineage-reconstruction/v1", status: "RECONSTRUCTED", scopeRef: first.scopeRef, taskRef: first.taskRef, searched, inspected: sortedInspected, used, rejected, decisionSupporting: decision.supportingKnowledgeRefs, outcomeContributing: outcome.contributingKnowledgeRefs, decisionRef: { decisionId: decision.decisionId, decisionDigest: decision.decisionDigest }, outcomeRef: { outcomeId: outcome.outcomeId, outcomeDigest: outcome.outcomeDigest } };
    return { ...unsigned, reconstructionDigest: sha(unsigned) };
}
function validateFailureEvidence(outcome, contributors) {
    for (const cause of outcome.failureAttribution.causes) {
        if (cause.class === "KNOWLEDGE" && cause.subtype !== "MISSING" && !cause.affectedKnowledgeRefs.every((ref) => contributors.some((candidate) => sameRef(candidate, ref))))
            return false;
        if (cause.class === "UNKNOWN" && cause.affectedKnowledgeRefs.length !== 0)
            return false;
    }
    return true;
}
export function verifyDecisionKnowledgeBindingV1(value) { return validateDecisionKnowledgeBindingV1(value) ? { outcome: "ACCEPTED", reasonCodes: ["CONTRACT_VERIFIED"] } : { outcome: "DENIED", reasonCodes: ["DIGEST_MISMATCH_DENIED"] }; }
export function verifyTaskOutcomeEvidenceV1(value) { return validateTaskOutcomeEvidenceV1(value) ? { outcome: "ACCEPTED", reasonCodes: ["CONTRACT_VERIFIED"] } : { outcome: "DENIED", reasonCodes: ["DIGEST_MISMATCH_DENIED"] }; }
export function verifyFailureAttributionV1(value) { return validateFailureAttributionV1(value) ? { outcome: "ACCEPTED", reasonCodes: ["CONTRACT_VERIFIED"] } : { outcome: "DENIED", reasonCodes: ["FAILURE_ATTRIBUTION_DENIED"] }; }
export function verifyKnowledgeEvidenceProfileV1(value) { return validateKnowledgeEvidenceProfileV1(value) ? { outcome: "ACCEPTED", reasonCodes: ["CONTRACT_VERIFIED"] } : { outcome: "DENIED", reasonCodes: ["DIGEST_MISMATCH_DENIED"] }; }
