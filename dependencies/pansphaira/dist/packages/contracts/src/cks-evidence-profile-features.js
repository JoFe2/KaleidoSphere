import { CKS_KNOWLEDGE_LINEAGE_SEMANTIC_RULE_V1, knowledgeEvidenceProfileDigestV1, knowledgeUsageFactDigestV1, reconstructKnowledgeUsageV1, validateKnowledgeEvidenceProfileV1, } from "./cks-knowledge-lineage.js";
import { cksDigestV1 } from "./cks-knowledge-lineage.js";
/** P15 feature-report schema. The report is scoped to one exact Knowledge ref. */
export const CKS_LINEAGE_FEATURE_REPORT_SCHEMA_V1 = "chimpmaera.knowledge/lineage-feature-report/v1";
export const CKS_GENERALIZATION_MINIMUM_DISTINCT_TASK_SEMANTICS_V1 = 2;
export const CKS_GENERALIZATION_MINIMUM_DISTINCT_CONTEXTS_V1 = 2;
export const CKS_OPERATIONAL_MINIMUM_DISTINCT_OUTCOME_UNITS_V1 = 1;
const HEX = /^[a-f0-9]{64}$/;
const SCOPE_ID = /^scope:v1:[a-f0-9]{64}$/;
const KNOWLEDGE_ID = /^[a-z][a-z0-9-]{1,31}:[a-z0-9][a-z0-9._-]{2,95}$/;
const OUTCOME_CLASSES = ["SUCCEEDED", "FAILED", "PARTIAL", "DENIED"];
const failureObservationKey = (item) => `${item.class}|${item.subtype}|${item.certainty}`;
const refKey = (ref) => `${ref.knowledgeId}|${ref.knowledgeDigest}`;
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const isScopeRef = (value) => isRecord(value) && Object.keys(value).length === 2 && typeof value.scopeId === "string" && SCOPE_ID.test(value.scopeId) && typeof value.scopeDigest === "string" && HEX.test(value.scopeDigest);
const isKnowledgeRef = (value) => isRecord(value) && Object.keys(value).length === 2 && typeof value.knowledgeId === "string" && KNOWLEDGE_ID.test(value.knowledgeId) && typeof value.knowledgeDigest === "string" && HEX.test(value.knowledgeDigest);
const sortedUnique = (values) => values.every((value, index) => index === 0 || values[index - 1] < value) && new Set(values).size === values.length;
const exactKeys = (value, keys) => JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const denied = (reason = "SCHEMA_DENIED") => ({
    schemaVersion: CKS_LINEAGE_FEATURE_REPORT_SCHEMA_V1,
    status: "DENIED",
    reasonCodes: [reason],
});
function sameKnowledge(a, b) {
    return a.knowledgeId === b.knowledgeId && a.knowledgeDigest === b.knowledgeDigest;
}
function taskFromLineage(events) {
    const opened = events.find((event) => event.eventType === "TASK_OPENED");
    const fact = opened?.fact;
    if (!isRecord(fact) || !isRecord(fact.task))
        return null;
    return fact.task;
}
function eventFact(events, eventType, key) {
    const event = events.find((item) => item.eventType === eventType);
    const fact = event?.fact;
    if (!isRecord(fact) || !isRecord(fact[key]))
        return null;
    return fact[key];
}
/**
 * Compute P15 raw novelty/context-diversity features and the six independent
 * profile dimensions. Invalid or incomplete lineage receives no feature credit.
 */
export function computeCksLineageFeatureReportV1(input) {
    if (!isRecord(input) || !isScopeRef(input.scopeRef) || !isKnowledgeRef(input.knowledgeRef) || !Array.isArray(input.lineages) || input.lineages.length === 0)
        return denied();
    const scopeRef = input.scopeRef;
    const knowledgeRef = input.knowledgeRef;
    const dimensions = input.dimensions ?? input.baseDimensions;
    if (!isRecord(dimensions) || !isRecord(dimensions.source) || !isRecord(dimensions.applicability) || !isRecord(dimensions.freshness) || !isRecord(dimensions.contradiction))
        return denied();
    const baseDimensions = dimensions;
    const thresholds = isRecord(input.thresholds) ? input.thresholds : {};
    const taskThreshold = thresholds.generalizationMinimumDistinctTaskSemantics ?? CKS_GENERALIZATION_MINIMUM_DISTINCT_TASK_SEMANTICS_V1;
    const contextThreshold = thresholds.generalizationMinimumDistinctContexts ?? CKS_GENERALIZATION_MINIMUM_DISTINCT_CONTEXTS_V1;
    const operationalThreshold = thresholds.operationalMinimumDistinctOutcomeUnits ?? CKS_OPERATIONAL_MINIMUM_DISTINCT_OUTCOME_UNITS_V1;
    if (taskThreshold !== CKS_GENERALIZATION_MINIMUM_DISTINCT_TASK_SEMANTICS_V1 || contextThreshold !== CKS_GENERALIZATION_MINIMUM_DISTINCT_CONTEXTS_V1 || operationalThreshold !== CKS_OPERATIONAL_MINIMUM_DISTINCT_OUTCOME_UNITS_V1)
        return denied();
    const generalizationUnits = [];
    const operationalUnits = [];
    const failureObservations = new Map();
    let validTaskOccurrenceCount = 0;
    let eligibleOutcomeOccurrenceCount = 0;
    let uncertainOutcomeOccurrenceCount = 0;
    for (const candidate of input.lineages) {
        if (!Array.isArray(candidate))
            return denied();
        const reconstruction = reconstructKnowledgeUsageV1(candidate);
        if (reconstruction.status !== "RECONSTRUCTED")
            return denied();
        if (!sameScope(reconstruction.scopeRef, scopeRef))
            return denied("SCOPE_MISMATCH_DENIED");
        const events = candidate;
        const task = taskFromLineage(events);
        const decision = eventFact(events, "DECISION_RECORDED", "decision");
        const outcome = eventFact(events, "OUTCOME_RECORDED", "outcome");
        if (!task || !decision || !outcome || typeof task.taskSemanticDigest !== "string" || !HEX.test(task.taskSemanticDigest) || typeof task.contextFingerprintDigest !== "string" || !HEX.test(task.contextFingerprintDigest))
            return denied("INCOMPLETE_LINEAGE_DENIED");
        const supportsKnowledge = reconstruction.decisionSupporting.some((ref) => sameKnowledge(ref, knowledgeRef));
        if (supportsKnowledge) {
            validTaskOccurrenceCount += 1;
            const unitDigest = knowledgeUsageFactDigestV1({
                semanticRuleId: CKS_KNOWLEDGE_LINEAGE_SEMANTIC_RULE_V1,
                scopeRef,
                knowledgeRef,
                taskSemanticDigest: task.taskSemanticDigest,
                contextFingerprintDigest: task.contextFingerprintDigest,
            });
            generalizationUnits.push({ taskSemanticDigest: task.taskSemanticDigest, contextFingerprintDigest: task.contextFingerprintDigest, unitDigest });
        }
        const contributesKnowledge = reconstruction.outcomeContributing.some((ref) => sameKnowledge(ref, knowledgeRef));
        const outcomeClass = outcome.outcomeClass;
        if (!contributesKnowledge || typeof outcomeClass !== "string")
            continue;
        if (outcomeClass === "UNKNOWN") {
            uncertainOutcomeOccurrenceCount += 1;
            continue;
        }
        if (!OUTCOME_CLASSES.includes(outcomeClass))
            return denied("SCHEMA_DENIED");
        if (typeof decision.decisionClass !== "string" || !isRecord(outcome.failureAttribution) || typeof outcome.failureAttribution.failureAttributionDigest !== "string")
            return denied("INCOMPLETE_LINEAGE_DENIED");
        const generalizationUnit = generalizationUnits.find((item) => item.taskSemanticDigest === task.taskSemanticDigest && item.contextFingerprintDigest === task.contextFingerprintDigest);
        if (!generalizationUnit)
            return denied("INCOMPLETE_LINEAGE_DENIED");
        const operationalUnitDigest = knowledgeUsageFactDigestV1({
            generalizationUsageUnitDigest: generalizationUnit.unitDigest,
            decisionClass: decision.decisionClass,
            outcomeClass,
            failureAttributionDigest: outcome.failureAttribution.failureAttributionDigest,
        });
        eligibleOutcomeOccurrenceCount += 1;
        operationalUnits.push({ operationalUnitDigest, outcomeClass: outcomeClass });
        if (Array.isArray(outcome.failureAttribution.causes)) {
            for (const cause of outcome.failureAttribution.causes) {
                if (isRecord(cause) && typeof cause.class === "string" && typeof cause.subtype === "string" && typeof cause.certainty === "string") {
                    failureObservations.set(failureObservationKey(cause), {
                        class: cause.class,
                        subtype: cause.subtype,
                        certainty: cause.certainty,
                    });
                }
            }
        }
    }
    const taskSemanticDigests = [...new Set(generalizationUnits.map((item) => item.taskSemanticDigest))].sort();
    const contextFingerprintDigests = [...new Set(generalizationUnits.map((item) => item.contextFingerprintDigest))].sort();
    const generalizationUsageUnitDigests = [...new Set(generalizationUnits.map((item) => item.unitDigest))].sort();
    const operationalUnitMap = new Map();
    for (const item of operationalUnits)
        operationalUnitMap.set(item.operationalUnitDigest, item.outcomeClass);
    const operationalUnitDigests = [...operationalUnitMap.keys()].sort();
    const outcomeClassObservations = [...operationalUnitMap.entries()].map(([operationalUnitDigest, outcomeClass]) => ({ operationalUnitDigest, outcomeClass })).sort((a, b) => `${a.operationalUnitDigest}|${a.outcomeClass}`.localeCompare(`${b.operationalUnitDigest}|${b.outcomeClass}`));
    const distinctOutcomeUnitsByClass = { SUCCEEDED: 0, FAILED: 0, PARTIAL: 0, DENIED: 0 };
    for (const item of operationalUnitMap.values())
        distinctOutcomeUnitsByClass[item] += 1;
    const generalization = {
        validTaskOccurrenceCount,
        distinctTaskSemanticCount: taskSemanticDigests.length,
        distinctContextCount: contextFingerprintDigests.length,
        distinctJointUsageUnitCount: generalizationUsageUnitDigests.length,
        identicalRepetitionCount: validTaskOccurrenceCount - generalizationUsageUnitDigests.length,
        marker: taskSemanticDigests.length >= taskThreshold && contextFingerprintDigests.length >= contextThreshold ? "+G" : null,
    };
    const operational = {
        eligibleOutcomeOccurrenceCount,
        distinctOperationalUnitCount: operationalUnitDigests.length,
        distinctOutcomeUnitsByClass,
        uncertainOutcomeOccurrenceCount,
        failureCauseObservations: [...failureObservations.values()].sort((a, b) => failureObservationKey(a).localeCompare(failureObservationKey(b))),
        marker: operationalUnitDigests.length >= operationalThreshold ? "+O" : null,
    };
    const reportWithoutDigest = {
        schemaVersion: CKS_LINEAGE_FEATURE_REPORT_SCHEMA_V1,
        semanticRuleId: CKS_KNOWLEDGE_LINEAGE_SEMANTIC_RULE_V1,
        status: "REPORTED",
        scopeRef,
        knowledgeRef,
        dimensions: { ...baseDimensions, generalization, operational },
        rawFeatures: {
            generalization: { taskSemanticDigests, contextFingerprintDigests, generalizationUsageUnitDigests },
            operational: { operationalUnitDigests, outcomeClassObservations },
        },
    };
    const profile = {
        schemaVersion: "chimpmaera.knowledge/evidence-profile/v1",
        semanticRuleId: CKS_KNOWLEDGE_LINEAGE_SEMANTIC_RULE_V1,
        scopeRef,
        knowledgeRef,
        dimensions: reportWithoutDigest.dimensions,
        profileDigest: knowledgeEvidenceProfileDigestV1({
            schemaVersion: "chimpmaera.knowledge/evidence-profile/v1",
            semanticRuleId: CKS_KNOWLEDGE_LINEAGE_SEMANTIC_RULE_V1,
            scopeRef,
            knowledgeRef,
            dimensions: reportWithoutDigest.dimensions,
        }),
    };
    if (!validateKnowledgeEvidenceProfileV1(profile))
        return denied("DIGEST_MISMATCH_DENIED");
    const report = { ...reportWithoutDigest, dimensions: reportWithoutDigest.dimensions, reportDigest: cksDigestV1(reportWithoutDigest, "reportDigest") };
    return report;
}
function sameScope(a, b) {
    return a.scopeId === b.scopeId && a.scopeDigest === b.scopeDigest;
}
export function validateCksLineageFeatureReportV1(value) {
    if (!isRecord(value) || !exactKeys(value, ["schemaVersion", "semanticRuleId", "status", "scopeRef", "knowledgeRef", "dimensions", "rawFeatures", "reportDigest"]) || value.schemaVersion !== CKS_LINEAGE_FEATURE_REPORT_SCHEMA_V1 || value.semanticRuleId !== CKS_KNOWLEDGE_LINEAGE_SEMANTIC_RULE_V1 || value.status !== "REPORTED" || !isScopeRef(value.scopeRef) || !isKnowledgeRef(value.knowledgeRef) || !isRecord(value.dimensions) || !isRecord(value.rawFeatures) || typeof value.reportDigest !== "string" || !HEX.test(value.reportDigest))
        return false;
    const raw = value.rawFeatures;
    if (!exactKeys(raw, ["generalization", "operational"]) || !isRecord(raw.generalization) || !isRecord(raw.operational))
        return false;
    const generalization = raw.generalization;
    const operational = raw.operational;
    if (!exactKeys(generalization, ["taskSemanticDigests", "contextFingerprintDigests", "generalizationUsageUnitDigests"]) || !Array.isArray(generalization.taskSemanticDigests) || !Array.isArray(generalization.contextFingerprintDigests) || !Array.isArray(generalization.generalizationUsageUnitDigests) || !generalization.taskSemanticDigests.every((item) => typeof item === "string" && HEX.test(item)) || !generalization.contextFingerprintDigests.every((item) => typeof item === "string" && HEX.test(item)) || !generalization.generalizationUsageUnitDigests.every((item) => typeof item === "string" && HEX.test(item)) || !sortedUnique(generalization.taskSemanticDigests) || !sortedUnique(generalization.contextFingerprintDigests) || !sortedUnique(generalization.generalizationUsageUnitDigests))
        return false;
    if (!exactKeys(operational, ["operationalUnitDigests", "outcomeClassObservations"]) || !Array.isArray(operational.operationalUnitDigests) || !sortedUnique(operational.operationalUnitDigests) || !operational.operationalUnitDigests.every((item) => typeof item === "string" && HEX.test(item)) || !Array.isArray(operational.outcomeClassObservations) || !operational.outcomeClassObservations.every((item) => isRecord(item) && exactKeys(item, ["operationalUnitDigest", "outcomeClass"]) && typeof item.operationalUnitDigest === "string" && HEX.test(item.operationalUnitDigest) && typeof item.outcomeClass === "string" && OUTCOME_CLASSES.includes(item.outcomeClass)))
        return false;
    const dimensions = value.dimensions;
    const rawGeneralization = dimensions.generalization;
    const rawOperational = dimensions.operational;
    if (!isRecord(rawGeneralization) || !isRecord(rawOperational) || rawGeneralization.distinctTaskSemanticCount !== generalization.taskSemanticDigests.length || rawGeneralization.distinctContextCount !== generalization.contextFingerprintDigests.length || rawGeneralization.distinctJointUsageUnitCount !== generalization.generalizationUsageUnitDigests.length || rawOperational.distinctOperationalUnitCount !== operational.operationalUnitDigests.length)
        return false;
    const observed = operational.outcomeClassObservations;
    if (observed.length !== operational.operationalUnitDigests.length || !observed.every((item, index) => item.operationalUnitDigest === operational.operationalUnitDigests[index]) || !sortedUnique(observed.map((item) => `${item.operationalUnitDigest}|${item.outcomeClass}`)))
        return false;
    const classCounts = { SUCCEEDED: 0, FAILED: 0, PARTIAL: 0, DENIED: 0 };
    for (const item of observed)
        classCounts[item.outcomeClass] += 1;
    if (JSON.stringify(classCounts) !== JSON.stringify(rawOperational.distinctOutcomeUnitsByClass))
        return false;
    const { reportDigest, ...withoutDigest } = value;
    return validateKnowledgeEvidenceProfileV1({
        schemaVersion: "chimpmaera.knowledge/evidence-profile/v1",
        semanticRuleId: CKS_KNOWLEDGE_LINEAGE_SEMANTIC_RULE_V1,
        scopeRef: value.scopeRef,
        knowledgeRef: value.knowledgeRef,
        dimensions: value.dimensions,
        profileDigest: knowledgeEvidenceProfileDigestV1({
            schemaVersion: "chimpmaera.knowledge/evidence-profile/v1",
            semanticRuleId: CKS_KNOWLEDGE_LINEAGE_SEMANTIC_RULE_V1,
            scopeRef: value.scopeRef,
            knowledgeRef: value.knowledgeRef,
            dimensions: value.dimensions,
        }),
    }) && cksDigestV1(withoutDigest, "reportDigest") === reportDigest;
}
export const computeCksEvidenceProfileFeaturesV1 = computeCksLineageFeatureReportV1;
export const computeEvidenceProfileFeaturesV1 = computeCksLineageFeatureReportV1;
export const buildCksLineageFeatureReportV1 = computeCksLineageFeatureReportV1;
