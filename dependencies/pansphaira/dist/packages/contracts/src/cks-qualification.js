import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
/**
 * CKS-06 (issue #286) — frozen advisory competence qualification profile v1.
 *
 * Implements the exact-qualification-profile identity frozen by
 * docs/evidence/conveyor/sol-psai286-router-semantics-decision-01.json:
 * the profile digest is SHA-256 over the canonical JSON of every required
 * exact binding. Equality means byte-equal normalized fields and equal
 * digests; aliases, family membership, ranges, defaults, omission, and
 * compatibility inference never establish equality. A change to any required
 * binding creates a different, initially UNQUALIFIED profile; evidence does
 * not inherit across profiles.
 *
 * This module is a pure contract surface: closed types, the canonical
 * profile digest, and fail-closed validation. It issues no qualification
 * verdict, performs no task classification, ranking, capacity measurement,
 * provider call, or route execution. The typed escalation receipt (closed
 * causes, frozen cause-to-disposition mapping, digest-bound) is the same
 * pure contract surface: recommendation evidence only, never a verdict.
 */
export const CKS_COMPETENCE_QUALIFICATION_PROFILE_SCHEMA_V1 = "chimpmaera.dev/cks-competence-qualification-profile/v1";
export const CKS_QUALIFICATION_STATES_V1 = [
    "UNQUALIFIED",
    "QUALIFIED",
    "SUSPENDED_DRIFT",
    "REVOKED_EVIDENCE",
];
/** Sentinel identity for an intentionally absent optional component. */
export const CKS_QUALIFICATION_NONE = "NONE";
const sha256Hex = (value) => createHash("sha256").update(value).digest("hex");
/**
 * Canonical digest of the NONE sentinel. A NONE component must bind this
 * digest in every paired digest field so that "absent" is itself an exact,
 * read-back-able value rather than an omission.
 */
export const CKS_QUALIFICATION_NONE_DIGEST_V1 = sha256Hex(canonicalJson(CKS_QUALIFICATION_NONE));
export const CKS_BINDING_NAMES_V1 = [
    "modelArtifact",
    "quantization",
    "runtime",
    "context",
    "prompt",
    "tools",
    "retriever",
    "reranker",
    "verifier",
    "knowledge",
    "qualificationSuite",
];
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const TOOL_ID_AND_VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]*@[a-z0-9][a-z0-9._-]*$/;
/**
 * Frozen field inventory of every required exact binding, in the canonical
 * order of the frozen semantics. Unknown, missing, and malformed fields are
 * all denied; the digest recomputes over exactly these fields.
 */
const CKS_BINDING_FIELD_KINDS_V1 = {
    modelArtifact: {
        artifactDigest: "digest",
        architectureId: "identifier",
        tokenizerDigest: "digest",
        licenseProfileId: "identifier",
    },
    quantization: {
        formatId: "identifier",
        quantizerVersion: "identifier",
        weightsDigest: "digest",
        parameterizationDigest: "digest",
    },
    runtime: {
        runtimeId: "identifier",
        runtimeVersion: "identifier",
        buildDigest: "digest",
        backendId: "identifier",
        kernelSetDigest: "digest",
        hardwareClassId: "identifier",
        determinismConfigDigest: "digest",
    },
    context: {
        contextWindowTokens: "positiveInt",
        maximumInputTokens: "positiveInt",
        maximumOutputTokens: "positiveInt",
        chatTemplateDigest: "digest",
        positionEncodingConfigDigest: "digest",
        kvPrecisionId: "identifier",
        truncationPolicy: "denyConst",
    },
    prompt: {
        promptContractVersion: "identifier",
        systemPromptDigest: "digest",
        instructionTemplateDigest: "digest",
        stopSequenceDigest: "digest",
        samplingConfigDigest: "digest",
    },
    tools: {
        closedToolSetDigest: "digest",
        orderedToolIdsAndVersions: "toolList",
        toolSchemaBundleDigest: "digest",
        toolPolicyDigest: "digest",
    },
    retriever: {
        componentIdOrNONE: "orNone",
        versionOrNONE: "orNone",
        configDigest: "digest",
        indexContractDigest: "digest",
    },
    reranker: {
        componentIdOrNONE: "orNone",
        versionOrNONE: "orNone",
        configDigest: "digest",
    },
    verifier: {
        deterministicVerifierId: "identifier",
        deterministicVerifierDigest: "digest",
        semanticVerifierIdOrNONE: "orNone",
        semanticVerifierDigest: "digest",
        thresholdPolicyDigest: "digest",
    },
    knowledge: {
        knowledgeContractVersion: "identifier",
        knowledgeEditionOrNONE: "orNone",
        knowledgeManifestDigest: "digest",
        applicabilityPolicyDigest: "digest",
    },
    qualificationSuite: {
        suiteVersion: "identifier",
        suiteManifestDigest: "digest",
        generatorDigest: "digest",
        splitPolicyDigest: "digest",
        scoringPolicyDigest: "digest",
        freshCertificationReceiptDigest: "digest",
    },
};
const isPlainObject = (value) => typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;
const denied = (reason, detail) => ({
    outcome: "DENIED",
    reason,
    detail,
});
/**
 * SHA-256 over canonical JSON of the exact bindings. Canonical JSON sorts
 * object keys, so the digest is independent of key insertion order.
 * Throws a TypeError for non-canonical input.
 */
export function cksExactProfileDigestV1(bindings) {
    return sha256Hex(canonicalJson(bindings));
}
function checkFieldValue(kind, path, value) {
    switch (kind) {
        case "digest":
            if (typeof value !== "string" || !DIGEST_PATTERN.test(value))
                return denied("MALFORMED_VALUE", path);
            return undefined;
        case "identifier":
            if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value))
                return denied("MALFORMED_VALUE", path);
            return undefined;
        case "orNone":
            if (value !== CKS_QUALIFICATION_NONE && (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value))) {
                return denied("MALFORMED_VALUE", path);
            }
            return undefined;
        case "positiveInt":
            if (typeof value !== "number" || !Number.isInteger(value) || value < 1)
                return denied("MALFORMED_VALUE", path);
            return undefined;
        case "denyConst":
            if (value !== "DENY")
                return denied("TRUNCATION_POLICY_NOT_DENY", path);
            return undefined;
        case "toolList": {
            if (!Array.isArray(value))
                return denied("MALFORMED_VALUE", path);
            for (let i = 0; i < value.length; i++) {
                const entry = value[i];
                if (typeof entry !== "string" || !TOOL_ID_AND_VERSION_PATTERN.test(entry)) {
                    return denied("MALFORMED_VALUE", `${path}[${i}]`);
                }
            }
            return undefined;
        }
        default:
            return denied("MALFORMED_VALUE", path);
    }
}
/**
 * Closed fail-closed validation of the exact bindings: every frozen field
 * present with a well-formed value, no unknown fields, the DENY truncation
 * policy, bounded context window, and exact NONE pairing. On success the
 * returned profileDigest is the digest that binds the result.
 */
export function validateCksExactQualificationBindingsV1(input) {
    if (!isPlainObject(input))
        return denied("MALFORMED_VALUE", "bindings");
    for (const key of Object.keys(input)) {
        if (!CKS_BINDING_NAMES_V1.includes(key))
            return denied("UNKNOWN_FIELD", `bindings.${key}`);
    }
    for (const bindingName of CKS_BINDING_NAMES_V1) {
        const path = `bindings.${bindingName}`;
        const binding = input[bindingName];
        if (!isPlainObject(binding))
            return denied("MISSING_FIELD", path);
        const kinds = CKS_BINDING_FIELD_KINDS_V1[bindingName];
        for (const key of Object.keys(binding)) {
            if (!(key in kinds))
                return denied("UNKNOWN_FIELD", `${path}.${key}`);
        }
        for (const [field, kind] of Object.entries(kinds)) {
            const fieldPath = `${path}.${field}`;
            if (!(field in binding))
                return denied("MISSING_FIELD", fieldPath);
            const malformed = checkFieldValue(kind, fieldPath, binding[field]);
            if (malformed !== undefined)
                return malformed;
        }
    }
    const context = input.context;
    const window = context.contextWindowTokens;
    const maxInput = context.maximumInputTokens;
    const maxOutput = context.maximumOutputTokens;
    if (maxInput + maxOutput > window)
        return denied("CONTEXT_WINDOW_VIOLATION", "bindings.context");
    const nonePairing = (root, id, version, digests) => {
        const idIsNone = id === CKS_QUALIFICATION_NONE;
        if (version !== undefined && idIsNone !== (version === CKS_QUALIFICATION_NONE)) {
            return denied("NONE_PAIRING_MISMATCH", `bindings.${root}.versionOrNONE`);
        }
        for (const { field, value } of digests) {
            if (idIsNone !== (value === CKS_QUALIFICATION_NONE_DIGEST_V1)) {
                return denied("NONE_PAIRING_MISMATCH", `bindings.${root}.${field}`);
            }
        }
        return undefined;
    };
    const retriever = input.retriever;
    const reranker = input.reranker;
    const verifier = input.verifier;
    const knowledge = input.knowledge;
    const noneMismatch = nonePairing("retriever", retriever.componentIdOrNONE, retriever.versionOrNONE, [
        { field: "configDigest", value: retriever.configDigest },
        { field: "indexContractDigest", value: retriever.indexContractDigest },
    ]) ??
        nonePairing("reranker", reranker.componentIdOrNONE, reranker.versionOrNONE, [
            { field: "configDigest", value: reranker.configDigest },
        ]) ??
        nonePairing("verifier", verifier.semanticVerifierIdOrNONE, undefined, [
            { field: "semanticVerifierDigest", value: verifier.semanticVerifierDigest },
        ]) ??
        nonePairing("knowledge", knowledge.knowledgeEditionOrNONE, undefined, [
            { field: "knowledgeManifestDigest", value: knowledge.knowledgeManifestDigest },
        ]);
    if (noneMismatch !== undefined)
        return noneMismatch;
    return { outcome: "VALID", profileDigest: cksExactProfileDigestV1(input) };
}
/**
 * Closed fail-closed validation of the frozen advisory qualification
 * profile. Denies unknown or missing fields, malformed values, non-DENY
 * truncation, unbounded context windows, broken NONE pairing, states
 * outside the closed enum, and any profileDigest that does not bind the
 * exact bindings.
 */
export function validateCksCompetenceQualificationProfileV1(input) {
    if (!isPlainObject(input))
        return denied("MALFORMED_VALUE", "profile");
    const topLevelFields = new Set(["schemaVersion", "bindings", "state", "profileDigest"]);
    for (const key of Object.keys(input)) {
        if (!topLevelFields.has(key))
            return denied("UNKNOWN_FIELD", key);
    }
    for (const key of topLevelFields) {
        if (!(key in input))
            return denied("MISSING_FIELD", key);
    }
    if (input.schemaVersion !== CKS_COMPETENCE_QUALIFICATION_PROFILE_SCHEMA_V1) {
        return denied("MALFORMED_VALUE", "schemaVersion");
    }
    if (typeof input.state !== "string" || !CKS_QUALIFICATION_STATES_V1.includes(input.state)) {
        return denied("INVALID_STATE", "state");
    }
    if (typeof input.profileDigest !== "string" || !DIGEST_PATTERN.test(input.profileDigest)) {
        return denied("MALFORMED_VALUE", "profileDigest");
    }
    const bindingsResult = validateCksExactQualificationBindingsV1(input.bindings);
    if (bindingsResult.outcome !== "VALID")
        return bindingsResult;
    if (bindingsResult.profileDigest !== input.profileDigest) {
        return denied("DIGEST_MISMATCH", "profileDigest");
    }
    return bindingsResult;
}
/** Schema identity for the finite AC-03 escalation-cause evidence contract. */
export const CKS_ESCALATION_SCHEMA_V1 = "chimpmaera.dev/cks-escalation/v1";
/** This contract recommends data only; it never grants authority or executes a route. */
export const CKS_ESCALATION_CLAIM_BOUNDARY_V1 = "TYPED_ESCALATION_EVIDENCE_ONLY_NO_ROUTE_EXECUTION_NO_AUTHORITY_GRANT";
export const CKS_ESCALATION_CAUSES_V1 = [
    "KNOWLEDGE_GAP",
    "KNOWLEDGE_CONFLICT",
    "VERIFIER_REJECTION",
    "DECOMPOSITION_GROWTH",
    "LOW_EVIDENCE_COVERAGE",
    "COMPETENCE_LIMIT",
];
export const CKS_ESCALATION_CAUSE_CODES_V1 = CKS_ESCALATION_CAUSES_V1;
export const CKS_ESCALATION_DISPOSITIONS_V1 = [
    "ABSTAIN_AND_REQUEST_BOUND_KNOWLEDGE_EVIDENCE",
    "ABSTAIN_OR_RESELECT_CONFLICT_QUALIFIED_PROFILE",
    "REJECT_CANDIDATE_AND_RESELECT_IF_BUDGETED",
    "RECLASSIFY_AND_RESELECT",
    "REJECT_OUTPUT_AND_ABSTAIN_OR_RESELECT",
    "EXCLUDE_PROFILE_AND_RESELECT",
];
/** The disposition is frozen by the decision receipt and is not caller-selected. */
export const CKS_ESCALATION_CAUSE_TO_DISPOSITION_V1 = {
    KNOWLEDGE_GAP: "ABSTAIN_AND_REQUEST_BOUND_KNOWLEDGE_EVIDENCE",
    KNOWLEDGE_CONFLICT: "ABSTAIN_OR_RESELECT_CONFLICT_QUALIFIED_PROFILE",
    VERIFIER_REJECTION: "REJECT_CANDIDATE_AND_RESELECT_IF_BUDGETED",
    DECOMPOSITION_GROWTH: "RECLASSIFY_AND_RESELECT",
    LOW_EVIDENCE_COVERAGE: "REJECT_OUTPUT_AND_ABSTAIN_OR_RESELECT",
    COMPETENCE_LIMIT: "EXCLUDE_PROFILE_AND_RESELECT",
};
const ESCALATION_DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const ESCALATION_CAUSE_SET = new Set(CKS_ESCALATION_CAUSES_V1);
const ESCALATION_TRIGGER_KEYS = {
    KNOWLEDGE_GAP: ["kind", "sourceReceiptDigest", "trigger", "materialKnowledgeObjectDigest"],
    KNOWLEDGE_CONFLICT: ["kind", "sourceReceiptDigest", "trigger", "conflictingEvidenceDigests", "applicabilityEvidenceDigest"],
    VERIFIER_REJECTION: ["kind", "sourceReceiptDigest", "verifierReceiptDigest", "verifier", "rejectedCheck"],
    DECOMPOSITION_GROWTH: [
        "kind", "sourceReceiptDigest", "previousDecompositionDigest", "currentDecompositionDigest",
        "previousNodeCount", "currentNodeCount", "previousEdgeCount", "currentEdgeCount",
        "previousLongestPath", "currentLongestPath", "previousContextTokens", "currentContextTokens",
        "previousToolSteps", "currentToolSteps", "previousDependencyCount", "currentDependencyCount",
        "previousPathLeaseCount", "currentPathLeaseCount",
    ],
    LOW_EVIDENCE_COVERAGE: ["kind", "sourceReceiptDigest", "coverageReceiptDigest", "coveredPpm", "applicabilityLinkPresent", "applicabilityEvidenceDigest"],
    COMPETENCE_LIMIT: ["kind", "sourceReceiptDigest", "trigger", "coverageBoxDigest", "taskVectorDigest"],
};
const escalationDenied = (reason, detail) => ({ outcome: "DENIED", reason, detail });
const escalationPlainObject = (value) => typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;
const escalationExactKeys = (value, expected) => {
    const actual = Object.keys(value).sort();
    return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]);
};
const escalationDigest = (value) => typeof value === "string" && ESCALATION_DIGEST_PATTERN.test(value);
const escalationSafeInteger = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
export function cksEscalationTaskVectorDigestV1(vector) {
    return sha256Hex(canonicalJson(vector));
}
/** Digest only the typed trigger payload, so changing a fact invalidates the receipt. */
export function cksEscalationEvidenceDigestV1(triggerEvidence) {
    return sha256Hex(canonicalJson(triggerEvidence));
}
export function cksEscalationReceiptDigestV1(receipt) {
    const unsigned = Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== "receiptDigest"));
    return sha256Hex(canonicalJson(unsigned));
}
function validateEscalationTrigger(cause, value, taskVectorDigest) {
    if (!escalationPlainObject(value))
        return escalationDenied("MALFORMED_VALUE", "triggerEvidence");
    const expectedKeys = ESCALATION_TRIGGER_KEYS[cause];
    if (!escalationExactKeys(value, expectedKeys))
        return escalationDenied("UNKNOWN_FIELD", "triggerEvidence");
    if (value.kind !== cause)
        return escalationDenied("TRIGGER_MISMATCH", "triggerEvidence.kind");
    const digestFields = Object.entries(value).filter(([key]) => key.endsWith("Digest"));
    if (!digestFields.every(([, digest]) => escalationDigest(digest))) {
        return escalationDenied("MALFORMED_VALUE", "triggerEvidence.digest");
    }
    if (cause === "KNOWLEDGE_GAP") {
        if (value.trigger !== "NEED_MORE_KNOWLEDGE" && value.trigger !== "MATERIAL_KNOWLEDGE_OBJECT_ABSENT") {
            return escalationDenied("TRIGGER_NOT_PROVEN", "triggerEvidence.trigger");
        }
    }
    else if (cause === "KNOWLEDGE_CONFLICT") {
        if (value.trigger !== "UNRESOLVED_MATERIAL_CONFLICT" && value.trigger !== "SUPERSESSION_AMBIGUITY") {
            return escalationDenied("TRIGGER_NOT_PROVEN", "triggerEvidence.trigger");
        }
        if (!Array.isArray(value.conflictingEvidenceDigests) || value.conflictingEvidenceDigests.length < 2
            || new Set(value.conflictingEvidenceDigests).size !== value.conflictingEvidenceDigests.length
            || !value.conflictingEvidenceDigests.every(escalationDigest)) {
            return escalationDenied("TRIGGER_NOT_PROVEN", "triggerEvidence.conflictingEvidenceDigests");
        }
    }
    else if (cause === "VERIFIER_REJECTION") {
        if (value.verifier !== "DETERMINISTIC" && value.verifier !== "SEMANTIC") {
            return escalationDenied("TRIGGER_NOT_PROVEN", "triggerEvidence.verifier");
        }
        if (!["ID", "VERSION", "DIGEST", "SCOPE", "PRECONDITION", "CLAIM_COVERAGE", "EXPECTED_STATE"].includes(value.rejectedCheck)) {
            return escalationDenied("TRIGGER_NOT_PROVEN", "triggerEvidence.rejectedCheck");
        }
    }
    else if (cause === "DECOMPOSITION_GROWTH") {
        const metricNames = ["NodeCount", "EdgeCount", "LongestPath", "ContextTokens", "ToolSteps", "DependencyCount", "PathLeaseCount"];
        for (const metric of metricNames) {
            const previous = value[`previous${metric}`];
            const current = value[`current${metric}`];
            if (!escalationSafeInteger(previous) || !escalationSafeInteger(current) || current < previous) {
                return escalationDenied("TRIGGER_NOT_PROVEN", `triggerEvidence.${metric}`);
            }
        }
        const grew = metricNames.some((metric) => {
            const previous = value[`previous${metric}`];
            const current = value[`current${metric}`];
            return escalationSafeInteger(previous) && escalationSafeInteger(current) && current > previous;
        });
        if (!grew || value.previousDecompositionDigest === value.currentDecompositionDigest) {
            return escalationDenied("TRIGGER_NOT_PROVEN", "triggerEvidence.growth");
        }
    }
    else if (cause === "LOW_EVIDENCE_COVERAGE") {
        if (!escalationSafeInteger(value.coveredPpm) || value.coveredPpm > 1_000_000
            || (value.coveredPpm >= 1_000_000 && value.applicabilityLinkPresent)
            || typeof value.applicabilityLinkPresent !== "boolean") {
            return escalationDenied("TRIGGER_NOT_PROVEN", "triggerEvidence.coverage");
        }
    }
    else if (cause === "COMPETENCE_LIMIT") {
        if (value.trigger !== "RUNTIME_COMPETENCE_LIMIT" && value.trigger !== "OUTSIDE_VERIFIED_COVERAGE_BOX") {
            return escalationDenied("TRIGGER_NOT_PROVEN", "triggerEvidence.trigger");
        }
        if (value.taskVectorDigest !== taskVectorDigest) {
            return escalationDenied("DIGEST_MISMATCH", "triggerEvidence.taskVectorDigest");
        }
    }
    return undefined;
}
/**
 * Validate one closed, digest-bound AC-03 escalation evidence record. The
 * validator does not classify, rank, infer risk/impact, or grant Authority.
 */
export function validateCksEscalationEvidenceV1(input) {
    if (!escalationPlainObject(input))
        return escalationDenied("MALFORMED_VALUE", "escalation");
    const topLevelKeys = [
        "schemaVersion", "episodeDigest", "exactProfileDigest", "taskVector", "taskVectorDigest",
        "causeCode", "disposition", "triggerEvidence", "evidenceDigest", "claimBoundary", "receiptDigest",
    ];
    if (!escalationExactKeys(input, topLevelKeys)) {
        const expected = new Set(topLevelKeys);
        return escalationDenied(Object.keys(input).some((key) => !expected.has(key)) ? "UNKNOWN_FIELD" : "MISSING_FIELD", "escalation");
    }
    if (input.schemaVersion !== CKS_ESCALATION_SCHEMA_V1 || input.claimBoundary !== CKS_ESCALATION_CLAIM_BOUNDARY_V1) {
        return escalationDenied("MALFORMED_VALUE", "schemaVersion or claimBoundary");
    }
    if (!escalationDigest(input.episodeDigest) || !escalationDigest(input.exactProfileDigest)) {
        return escalationDenied("MALFORMED_VALUE", "profile or episode digest");
    }
    if (!Array.isArray(input.taskVector) || input.taskVector.length !== 4
        || !input.taskVector.every((coordinate) => escalationSafeInteger(coordinate) && coordinate <= 6)) {
        return escalationDenied("MALFORMED_VALUE", "taskVector");
    }
    if (!escalationDigest(input.taskVectorDigest)
        || cksEscalationTaskVectorDigestV1(input.taskVector) !== input.taskVectorDigest) {
        return escalationDenied("DIGEST_MISMATCH", "taskVectorDigest");
    }
    if (typeof input.causeCode !== "string" || !ESCALATION_CAUSE_SET.has(input.causeCode)) {
        return escalationDenied("INVALID_CAUSE", "causeCode");
    }
    const cause = input.causeCode;
    if (input.disposition !== CKS_ESCALATION_CAUSE_TO_DISPOSITION_V1[cause]) {
        return escalationDenied("DISPOSITION_MISMATCH", "disposition");
    }
    const triggerResult = validateEscalationTrigger(cause, input.triggerEvidence, input.taskVectorDigest);
    if (triggerResult !== undefined)
        return triggerResult;
    if (!escalationDigest(input.evidenceDigest)
        || cksEscalationEvidenceDigestV1(input.triggerEvidence) !== input.evidenceDigest) {
        return escalationDenied("DIGEST_MISMATCH", "evidenceDigest");
    }
    if (!escalationDigest(input.receiptDigest)
        || cksEscalationReceiptDigestV1(input) !== input.receiptDigest) {
        return escalationDenied("DIGEST_MISMATCH", "receiptDigest");
    }
    return {
        outcome: "VALID",
        causeCode: cause,
        disposition: input.disposition,
        evidenceDigest: input.evidenceDigest,
        receiptDigest: input.receiptDigest,
    };
}
/** Short name for callers that treat an escalation record as a receipt. */
export const validateCksEscalationReceiptV1 = validateCksEscalationEvidenceV1;
/** Schema identity for the pure, advisory-only smallest-qualified selector. */
export const CKS_ADVISORY_SELECTOR_SCHEMA_V1 = "chimpmaera.dev/cks-advisory-selector/v1";
/** Selection is data only; it cannot invoke, authorize, or reserve anything. */
export const CKS_ADVISORY_SELECTOR_CLAIM_BOUNDARY_V1 = "ADVISORY_RECOMMENDATION_ONLY_NO_ROUTE_EXECUTION_NO_AUTHORITY_GRANT_NO_RESOURCE_RESERVATION";
export const CKS_REQUIRED_SCENARIO_TAGS_V1 = [
    "APPLICABILITY",
    "CLAIM_EVIDENCE_COVERAGE",
    "COMPETENCE_LIMIT",
    "CONFLICT",
    "DECOMPOSITION",
    "FRESH_UNKNOWN_DOMAIN",
    "MISSING_KNOWLEDGE",
    "PROCEDURE",
    "SUPERSESSION",
    "UPDATE_COMPLIANCE",
    "VERIFIER_REJECTION",
];
const selectorDigest = (value) => sha256Hex(canonicalJson(value));
/** Digest qualification evidence without its self-referential lineageDigest field. */
export function cksSelectorQualificationEvidenceLineageDigestV1(evidence) {
    return selectorDigest(Object.fromEntries(Object.entries(evidence).filter(([key]) => key !== "lineageDigest")));
}
const selectorDigestValid = (value) => typeof value === "string" && ESCALATION_DIGEST_PATTERN.test(value);
const selectorSafeInteger = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const selectorVector = (value) => Array.isArray(value) && value.length === 4
    && value.every((coordinate) => selectorSafeInteger(coordinate) && coordinate <= 6);
const selectorPlainObject = (value) => typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;
const selectorExactKeys = (value, expected) => {
    const actual = Object.keys(value).sort();
    const required = [...expected].sort();
    return actual.length === required.length && actual.every((key, index) => key === required[index]);
};
const selectorBoxCardinality = (box) => (box[0] + 1) * (box[1] + 1) * (box[2] + 1) * (box[3] + 1);
function selectorCandidateIsEligible(candidate, taskVector, evidenceAsOfMs) {
    const profileValidation = validateCksCompetenceQualificationProfileV1(candidate.profile);
    if (profileValidation.outcome !== "VALID" || candidate.profile.state !== "QUALIFIED")
        return false;
    if (!selectorVector(candidate.coverageBox)
        || !candidate.coverageBox.every((coordinate, index) => coordinate >= taskVector[index]))
        return false;
    if (candidate.qualificationTierOrdinal !== Math.max(...candidate.coverageBox)
        || candidate.certifiedCoverageBoxCardinality !== selectorBoxCardinality(candidate.coverageBox))
        return false;
    if (candidate.scenarioTags.length !== CKS_REQUIRED_SCENARIO_TAGS_V1.length
        || new Set(candidate.scenarioTags).size !== CKS_REQUIRED_SCENARIO_TAGS_V1.length
        || !CKS_REQUIRED_SCENARIO_TAGS_V1.every((tag) => candidate.scenarioTags.includes(tag)))
        return false;
    if (candidate.qualificationEvidence.exactProfileDigest !== candidate.profile.profileDigest
        || candidate.qualificationEvidence.qualificationSuiteReceiptDigest
            !== candidate.profile.bindings.qualificationSuite.freshCertificationReceiptDigest
        || candidate.qualificationEvidence.issuedAtMs > evidenceAsOfMs
        || candidate.qualificationEvidence.expiresAtMs <= evidenceAsOfMs
        || candidate.qualificationEvidence.cks03.status !== "POSITIVE"
        || candidate.qualificationEvidence.cks04.status !== "POSITIVE"
        || candidate.qualificationEvidence.cks05.status !== "POSITIVE")
        return false;
    if (candidate.riskImpactPolicy !== "ALLOW" || candidate.authorityPolicy !== "ALLOW")
        return false;
    if (candidate.catalogAvailability.status !== "AVAILABLE"
        || candidate.catalogAvailability.exactProfileDigest !== candidate.profile.profileDigest
        || candidate.resourceAdmission.status !== "POSITIVE"
        || candidate.resourceAdmission.exactProfileDigest !== candidate.profile.profileDigest)
        return false;
    return true;
}
function validateSelectorInput(input) {
    if (!selectorPlainObject(input)
        || !selectorExactKeys(input, ["schemaVersion", "evidenceAsOfMs", "taskVector", "candidates"])
        || input.schemaVersion !== CKS_ADVISORY_SELECTOR_SCHEMA_V1
        || !selectorSafeInteger(input.evidenceAsOfMs)
        || !selectorVector(input.taskVector)
        || !Array.isArray(input.candidates)
        || input.candidates.length > 64)
        return false;
    const candidateKeys = [
        "profile", "coverageBox", "scenarioTags", "qualificationEvidence", "riskImpactPolicy", "authorityPolicy",
        "catalogAvailability", "resourceAdmission", "qualificationTierOrdinal", "certifiedCoverageBoxCardinality",
        "reservedCostMicros", "qualifiedP95ElapsedMs", "peakResidentBytes",
    ];
    const evidenceKeys = [
        "exactProfileDigest", "qualificationSuiteReceiptDigest", "issuedAtMs", "expiresAtMs",
        "cks03", "cks04", "cks05", "lineageDigest",
    ];
    const receiptEvidenceKeys = ["cks03", "cks04", "cks05"];
    const receiptKeys = ["status", "receiptDigest"];
    const availabilityKeys = ["status", "exactProfileDigest", "catalogReceiptDigest"];
    const admissionKeys = ["status", "exactProfileDigest", "admissionReceiptDigest"];
    for (const rawCandidate of input.candidates) {
        if (!selectorPlainObject(rawCandidate) || !selectorExactKeys(rawCandidate, candidateKeys)
            || !selectorPlainObject(rawCandidate.qualificationEvidence)
            || !selectorExactKeys(rawCandidate.qualificationEvidence, evidenceKeys)
            || !selectorPlainObject(rawCandidate.catalogAvailability)
            || !selectorExactKeys(rawCandidate.catalogAvailability, availabilityKeys)
            || !selectorPlainObject(rawCandidate.resourceAdmission)
            || !selectorExactKeys(rawCandidate.resourceAdmission, admissionKeys)
            || !selectorVector(rawCandidate.coverageBox)
            || !Array.isArray(rawCandidate.scenarioTags)
            || !rawCandidate.scenarioTags.every((tag) => typeof tag === "string")
            || !selectorSafeInteger(rawCandidate.qualificationTierOrdinal)
            || rawCandidate.qualificationTierOrdinal > 6
            || !selectorSafeInteger(rawCandidate.certifiedCoverageBoxCardinality)
            || !selectorSafeInteger(rawCandidate.reservedCostMicros)
            || !selectorSafeInteger(rawCandidate.qualifiedP95ElapsedMs)
            || !selectorSafeInteger(rawCandidate.peakResidentBytes)
            || !selectorDigestValid(rawCandidate.qualificationEvidence.exactProfileDigest)
            || !selectorDigestValid(rawCandidate.qualificationEvidence.qualificationSuiteReceiptDigest)
            || !selectorSafeInteger(rawCandidate.qualificationEvidence.issuedAtMs)
            || !selectorSafeInteger(rawCandidate.qualificationEvidence.expiresAtMs)
            || rawCandidate.qualificationEvidence.expiresAtMs <= rawCandidate.qualificationEvidence.issuedAtMs
            || !selectorDigestValid(rawCandidate.qualificationEvidence.lineageDigest)
            || cksSelectorQualificationEvidenceLineageDigestV1(rawCandidate.qualificationEvidence)
                !== rawCandidate.qualificationEvidence.lineageDigest
            || (rawCandidate.riskImpactPolicy !== "ALLOW" && rawCandidate.riskImpactPolicy !== "DENY")
            || (rawCandidate.authorityPolicy !== "ALLOW" && rawCandidate.authorityPolicy !== "DENY")
            || (rawCandidate.catalogAvailability.status !== "AVAILABLE" && rawCandidate.catalogAvailability.status !== "UNAVAILABLE")
            || (rawCandidate.resourceAdmission.status !== "POSITIVE" && rawCandidate.resourceAdmission.status !== "DENIED")
            || !selectorDigestValid(rawCandidate.catalogAvailability.exactProfileDigest)
            || !selectorDigestValid(rawCandidate.catalogAvailability.catalogReceiptDigest)
            || !selectorDigestValid(rawCandidate.resourceAdmission.exactProfileDigest)
            || !selectorDigestValid(rawCandidate.resourceAdmission.admissionReceiptDigest))
            return false;
        for (const key of receiptEvidenceKeys) {
            const evidence = rawCandidate.qualificationEvidence[key];
            if (!selectorPlainObject(evidence) || !selectorExactKeys(evidence, receiptKeys)
                || !["POSITIVE", "UNKNOWN", "NOT_RUN", "FAILED"].includes(evidence.status)
                || !selectorDigestValid(evidence.receiptDigest))
                return false;
        }
        const profileValidation = validateCksCompetenceQualificationProfileV1(rawCandidate.profile);
        if (profileValidation.outcome !== "VALID")
            return false;
    }
    return true;
}
/** Digest a selector decision without its self-referential decisionDigest field. */
export function cksAdvisoryDecisionDigestV1(decision) {
    return selectorDigest(Object.fromEntries(Object.entries(decision).filter(([key]) => key !== "decisionDigest")));
}
/**
 * Select the smallest fully qualified and currently admitted profile. Every
 * eligibility gate is conjunctive; risk/impact and Authority are independent
 * policy filters and never participate in the ordering key.
 */
export function selectSmallestQualifiedProfileV1(input) {
    if (!validateSelectorInput(input)) {
        const decision = {
            schemaVersion: CKS_ADVISORY_SELECTOR_SCHEMA_V1,
            outcome: "ABSTAIN",
            reason: "MALFORMED_INPUT",
            claimBoundary: CKS_ADVISORY_SELECTOR_CLAIM_BOUNDARY_V1,
        };
        return { ...decision, decisionDigest: cksAdvisoryDecisionDigestV1(decision) };
    }
    const profileDigests = input.candidates.map((candidate) => candidate.profile.profileDigest);
    if (new Set(profileDigests).size !== profileDigests.length) {
        const decision = {
            schemaVersion: CKS_ADVISORY_SELECTOR_SCHEMA_V1,
            outcome: "ABSTAIN",
            taskVector: input.taskVector,
            reason: "DUPLICATE_PROFILE",
            claimBoundary: CKS_ADVISORY_SELECTOR_CLAIM_BOUNDARY_V1,
        };
        return { ...decision, decisionDigest: cksAdvisoryDecisionDigestV1(decision) };
    }
    const eligible = input.candidates.filter((candidate) => selectorCandidateIsEligible(candidate, input.taskVector, input.evidenceAsOfMs));
    const ordered = [...eligible].sort((left, right) => {
        const leftKey = [
            left.qualificationTierOrdinal,
            left.certifiedCoverageBoxCardinality,
            left.reservedCostMicros,
            left.qualifiedP95ElapsedMs,
            left.peakResidentBytes,
            left.profile.profileDigest,
        ];
        const rightKey = [
            right.qualificationTierOrdinal,
            right.certifiedCoverageBoxCardinality,
            right.reservedCostMicros,
            right.qualifiedP95ElapsedMs,
            right.peakResidentBytes,
            right.profile.profileDigest,
        ];
        for (let index = 0; index < leftKey.length; index += 1) {
            if (leftKey[index] === rightKey[index])
                continue;
            return leftKey[index] < rightKey[index] ? -1 : 1;
        }
        return 0;
    });
    if (ordered.length === 0) {
        const decision = {
            schemaVersion: CKS_ADVISORY_SELECTOR_SCHEMA_V1,
            outcome: "NO_QUALIFIED_PROFILE",
            taskVector: input.taskVector,
            reason: "NO_ELIGIBLE_CANDIDATE",
            claimBoundary: CKS_ADVISORY_SELECTOR_CLAIM_BOUNDARY_V1,
        };
        return { ...decision, decisionDigest: cksAdvisoryDecisionDigestV1(decision) };
    }
    const selected = ordered[0];
    const decision = {
        schemaVersion: CKS_ADVISORY_SELECTOR_SCHEMA_V1,
        outcome: "ADVISORY_RECOMMENDATION",
        taskVector: input.taskVector,
        selectedProfileDigest: selected.profile.profileDigest,
        orderingKey: [
            selected.qualificationTierOrdinal,
            selected.certifiedCoverageBoxCardinality,
            selected.reservedCostMicros,
            selected.qualifiedP95ElapsedMs,
            selected.peakResidentBytes,
            selected.profile.profileDigest,
        ],
        claimBoundary: CKS_ADVISORY_SELECTOR_CLAIM_BOUNDARY_V1,
    };
    return { ...decision, decisionDigest: cksAdvisoryDecisionDigestV1(decision) };
}
export const selectCksSmallestQualifiedProfileV1 = selectSmallestQualifiedProfileV1;
