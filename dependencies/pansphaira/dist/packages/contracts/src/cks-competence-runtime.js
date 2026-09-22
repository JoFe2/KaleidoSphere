import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import { APPLICABILITY_DIMENSIONS_V1 } from "./knowledge-quality.js";
/**
 * CKS-04 (issue #284) no-fine-tune competence runtime protocol.
 *
 * Closed, typed, data-only. It represents the six competence-response states
 * and permits only bounded `pansphaira.cks/knowledge-query/v1` tool calls that
 * return `pansphaira.cks/evidence-pack/v1` data. The selected OSS model profile
 * (model, quantization, runtime, prompt, tool and Knowledge versions) is bound
 * verbatim from the authoritative decision receipt, which remains
 * `PROFILE_DECISION_RECORDED_NOT_QUALIFIED`. Nothing here executes a model or
 * claims qualification.
 */
export const COMPETENCE_RUNTIME_SCHEMA_V1 = "pansphaira.cks/competence-runtime/v1";
export const CKS_COMPETENCE_RUNTIME_CONTRACT_ID_V1 = "cks-competence-runtime-contract:psai284-v1";
export const KNOWLEDGE_QUERY_PROTOCOL_V1 = "pansphaira.cks/knowledge-query/v1";
export const EVIDENCE_PACK_PROTOCOL_V1 = "pansphaira.cks/evidence-pack/v1";
export const COMPETENCE_RESPONSE_PROTOCOL_V1 = "pansphaira.cks/competence-response/v1";
export const MODEL_TOOL_CALL_SCHEMA_V1 = "pansphaira.cks/model-tool-call/v1";
export const ACTION_AUTHORITY_CONSTANT = "NONE";
export const EVIDENCE_PACK_INSTRUCTION_ELIGIBILITY = "DATA_ONLY_NEVER_INSTRUCTIONS_CAPABILITY_OR_AUTHORITY";
/** The six closed competence-response states. */
export const COMPETENCE_STATES_V1 = [
    "ANSWER_SUPPORTED",
    "NEED_MORE_KNOWLEDGE",
    "KNOWLEDGE_CONFLICT",
    "INSUFFICIENT_EVIDENCE",
    "COMPETENCE_LIMIT",
    "GOVERNED_ACTION_PROPOSAL",
];
/** The closed Knowledge Query reason codes. */
export const KNOWLEDGE_QUERY_REASON_CODES_V1 = [
    "MATERIAL_FACT_MISSING",
    "MATERIAL_RULE_MISSING",
    "MATERIAL_PROCEDURE_MISSING",
    "APPLICABILITY_UNRESOLVED",
    "PRECONDITION_UNRESOLVED",
    "EVIDENCE_COVERAGE_INCOMPLETE",
    "CONFLICT_DIFFERENTIATION_REQUIRED",
];
/** The exact closed argument catalogue selected by the profile decision. */
export const KNOWLEDGE_QUERY_ARGUMENT_NAMES_V1 = [
    "schemaVersion",
    "requestId",
    "taskId",
    "knowledgeEditionId",
    "knowledgeEditionVersion",
    "knowledgeEditionDigest",
    "needKinds",
    "queryText",
    "applicability",
    "requiredPreconditions",
    "maxResults",
    "maxEvidenceBytes",
    "reasonCode",
];
/** Exact Knowledge contract versions bound by the selected profile. */
export const KNOWLEDGE_CONTRACT_VERSIONS_V1 = {
    knowledgeObject: "pansphaira.cks/knowledge-object/v1",
    knowledgeQuery: KNOWLEDGE_QUERY_PROTOCOL_V1,
    applicability: "pansphaira.cks/applicability/v1",
    evidencePack: EVIDENCE_PACK_PROTOCOL_V1,
    evidenceCoverage: "pansphaira.cks/evidence-coverage/v1",
    competenceQualificationProfile: "pansphaira.cks/competence-qualification-profile/v1",
    taskComplexity: "pansphaira.cks/task-complexity-rkpu/v1",
    escalation: "pansphaira.cks/escalation/v1",
    existingKnowledgeEnvelope: "chimpmaera.knowledge/envelope/v1",
    existingKnowledgeEdition: "chimpmaera.knowledge/edition/v1",
    existingApplicabilityVocabulary: "chimpmaera.knowledge/applicability-vocabulary/v1",
};
/** The closed Evidence Pack statuses. */
export const EVIDENCE_PACK_STATUSES_V1 = [
    "MATCH",
    "NEEDS_CONTEXT",
    "CONFLICT",
    "NO_MATCH",
    "DENIED",
];
/** Bounded retrieval limits for a single task. */
export const QUERY_LIMITS_V1 = {
    maximumCallsPerTask: 3,
    maximumResultsPerCall: 6,
    maximumQueryBytes: 512,
    maximumEvidenceBytesPerCall: 12288,
    maximumAggregateEvidenceBytes: 24576,
    networkLocatorFieldsAllowed: false,
    effectFieldsAllowed: false,
};
export const COMPETENCE_RESPONSE_LIMITS_V1 = {
    maximumMaterialClaims: 16,
    maximumProcedureSteps: 16,
    maximumPreconditionChecks: 16,
    maximumExclusionChecks: 16,
    maximumConflicts: 32,
    maximumMissingKnowledgeRecords: 16,
};
const sha256 = (value) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, keys) => record(value) && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
const isDigest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const isKindId = (value) => typeof value === "string" && /^[A-Z][A-Z0-9_]{1,47}$/.test(value);
const isPreconditionId = (value) => typeof value === "string" && /^[a-z][a-z0-9-]{1,63}$/.test(value);
const isRequestId = (value) => typeof value === "string" && /^KQ-0[1-3]$/.test(value);
const isBoundedText = (value, maxBytes) => typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= maxBytes && !/[\u0000-\u001f]/.test(value);
const isNullableBoundedText = (value, maxBytes) => value === null || isBoundedText(value, maxBytes);
const isUniqueStrings = (value, predicate, min, max) => Array.isArray(value) && value.length >= min && value.length <= max && value.every(predicate) && new Set(value).size === value.length;
const isInt = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const isCanonicalizable = (value) => {
    try {
        canonicalJson(value);
        return true;
    }
    catch {
        return false;
    }
};
const deepEquals = (a, b) => {
    try {
        return canonicalJson(a) === canonicalJson(b);
    }
    catch {
        return false;
    }
};
const validateApplicability = (value) => {
    if (!exact(value, APPLICABILITY_DIMENSIONS_V1))
        return false;
    return APPLICABILITY_DIMENSIONS_V1.every((dimension) => {
        const item = value[dimension];
        if (!exact(item, ["state", "values", "provenance"]) || !["VALUE", "UNKNOWN", "NOT_PROVIDED", "NOT_APPLICABLE", "EXPLICITLY_UNRESTRICTED"].includes(item.state))
            return false;
        const values = item.values;
        if (!isUniqueStrings(values, (entry) => isBoundedText(entry, 160), 0, 16))
            return false;
        if (item.state === "VALUE")
            return values.length > 0 && ["DECLARED", "EVIDENCE_DERIVED", "INFERRED"].includes(item.provenance);
        if (values.length !== 0)
            return false;
        if (["NOT_APPLICABLE", "EXPLICITLY_UNRESTRICTED"].includes(item.state))
            return ["DECLARED", "EVIDENCE_DERIVED"].includes(item.provenance);
        return item.state === "UNKNOWN" ? item.provenance === null || item.provenance === "INFERRED" : item.provenance === null;
    });
};
const validateValidity = (value) => exact(value, ["state", "validFromMs", "validUntilMs"])
    && ["VALID", "EXPIRED", "NOT_YET_VALID"].includes(value.state)
    && isInt(value.validFromMs, 0, Number.MAX_SAFE_INTEGER)
    && (value.validUntilMs === null || isInt(value.validUntilMs, 0, Number.MAX_SAFE_INTEGER))
    && (value.validUntilMs === null || value.validUntilMs >= value.validFromMs);
const validateSupersession = (value) => exact(value, ["state", "supersededBy"])
    && ["CURRENT", "SUPERSEDED"].includes(value.state)
    && (value.supersededBy === null || isBoundedText(value.supersededBy, 96))
    && ((value.state === "CURRENT" && value.supersededBy === null) || (value.state === "SUPERSEDED" && value.supersededBy !== null));
// ---------------------------------------------------------------------------
// Digest functions
// ---------------------------------------------------------------------------
export function knowledgeQueryRequestDigestV1(value) {
    return sha256(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "requestDigest")));
}
export function evidencePackDigestV1(value) {
    return sha256(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "packDigest")));
}
export function competenceResponseDigestV1(value) {
    return sha256(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "responseDigest")));
}
export function cksCompetenceRuntimeContractDigestV1(value) {
    return sha256(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "contractDigest")));
}
// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------
export function validateKnowledgeQueryRequestV1(value) {
    if (!exact(value, ["schemaVersion", "requestId", "taskId", "knowledgeEditionId", "knowledgeEditionVersion", "knowledgeEditionDigest", "needKinds", "queryText", "applicability", "requiredPreconditions", "maxResults", "maxEvidenceBytes", "reasonCode", "requestDigest"]))
        return false;
    if (value.schemaVersion !== KNOWLEDGE_QUERY_PROTOCOL_V1)
        return false;
    if (!isRequestId(value.requestId))
        return false;
    if (!isBoundedText(value.taskId, 96))
        return false;
    if (!isBoundedText(value.knowledgeEditionId, 96))
        return false;
    if (!isBoundedText(value.knowledgeEditionVersion, 32))
        return false;
    if (!isDigest(value.knowledgeEditionDigest))
        return false;
    if (!isUniqueStrings(value.needKinds, isKindId, 1, 4))
        return false;
    if (!isBoundedText(value.queryText, QUERY_LIMITS_V1.maximumQueryBytes))
        return false;
    if (!validateApplicability(value.applicability))
        return false;
    if (!isUniqueStrings(value.requiredPreconditions, isPreconditionId, 0, 16))
        return false;
    if (!isInt(value.maxResults, 1, QUERY_LIMITS_V1.maximumResultsPerCall))
        return false;
    if (!isInt(value.maxEvidenceBytes, 1, QUERY_LIMITS_V1.maximumEvidenceBytesPerCall))
        return false;
    if (!KNOWLEDGE_QUERY_REASON_CODES_V1.includes(value.reasonCode))
        return false;
    if (!isDigest(value.requestDigest))
        return false;
    return knowledgeQueryRequestDigestV1(value) === value.requestDigest;
}
/** Validate model-emitted arguments and bind their canonical digest. */
export function bindKnowledgeQueryArgumentsV1(value) {
    if (!exact(value, KNOWLEDGE_QUERY_ARGUMENT_NAMES_V1))
        return null;
    const candidate = { ...value, requestDigest: knowledgeQueryRequestDigestV1(value) };
    return validateKnowledgeQueryRequestV1(candidate) ? candidate : null;
}
export function validateCksModelToolCallV1(value) {
    return exact(value, ["schemaVersion", "toolName", "arguments"])
        && value.schemaVersion === MODEL_TOOL_CALL_SCHEMA_V1
        && value.toolName === "cks_knowledge_query"
        && bindKnowledgeQueryArgumentsV1(value.arguments) !== null;
}
export function validateEvidencePackResultV1(value) {
    if (!exact(value, ["schemaVersion", "packId", "status", "request", "task", "knowledgeEdition", "retrievalConfiguration", "claims", "applicability", "evidence", "conflicts", "missingKnowledge", "instructionEligibility", "evidenceBytes", "packDigest"]))
        return false;
    if (value.schemaVersion !== EVIDENCE_PACK_PROTOCOL_V1)
        return false;
    if (!isBoundedText(value.packId, 96))
        return false;
    if (!EVIDENCE_PACK_STATUSES_V1.includes(value.status))
        return false;
    if (!exact(value.request, ["requestId", "requestDigest"]) || !isRequestId(value.request.requestId) || !isDigest(value.request.requestDigest))
        return false;
    if (!exact(value.task, ["taskId", "scopeDigest"]) || !isBoundedText(value.task.taskId, 96) || !isDigest(value.task.scopeDigest))
        return false;
    if (!exact(value.knowledgeEdition, ["editionId", "version", "digest"]) || !isBoundedText(value.knowledgeEdition.editionId, 96) || !isBoundedText(value.knowledgeEdition.version, 32) || !isDigest(value.knowledgeEdition.digest))
        return false;
    if (!exact(value.retrievalConfiguration, ["configurationId", "version", "digest"]) || !isBoundedText(value.retrievalConfiguration.configurationId, 96) || !isBoundedText(value.retrievalConfiguration.version, 32) || !isDigest(value.retrievalConfiguration.digest))
        return false;
    if (!Array.isArray(value.claims) || value.claims.length > QUERY_LIMITS_V1.maximumResultsPerCall || !value.claims.every((claim) => exact(claim, ["claimId", "knowledgeObjectId", "version", "digest", "sourcePassageIds"]) && isBoundedText(claim.claimId, 96) && isBoundedText(claim.knowledgeObjectId, 96) && isBoundedText(claim.version, 32) && isDigest(claim.digest) && isUniqueStrings(claim.sourcePassageIds, (item) => isBoundedText(item, 96), 1, 32)))
        return false;
    if (!exact(value.applicability, ["applicability", "preconditions", "exclusions", "validity", "supersession"]) || !validateApplicability(value.applicability.applicability) || !isUniqueStrings(value.applicability.preconditions, isPreconditionId, 0, 16) || !isUniqueStrings(value.applicability.exclusions, isPreconditionId, 0, 16) || !validateValidity(value.applicability.validity) || !validateSupersession(value.applicability.supersession))
        return false;
    if (!exact(value.evidence, ["positive", "negative"]))
        return false;
    const evidenceItems = (items) => Array.isArray(items) && items.length <= 32 && items.every((item) => exact(item, ["id", "digest"]) && isBoundedText(item.id, 96) && isDigest(item.digest));
    if (!evidenceItems(value.evidence.positive) || !evidenceItems(value.evidence.negative))
        return false;
    if (!Array.isArray(value.conflicts) || value.conflicts.length > 32 || !value.conflicts.every((conflict) => exact(conflict, ["conflictId", "claimIds"]) && isBoundedText(conflict.conflictId, 96) && isUniqueStrings(conflict.claimIds, (item) => isBoundedText(item, 96), 1, 32)))
        return false;
    if (!Array.isArray(value.missingKnowledge) || value.missingKnowledge.length > 16 || !value.missingKnowledge.every((item) => exact(item, ["needId", "reasonCode"]) && isBoundedText(item.needId, 96) && KNOWLEDGE_QUERY_REASON_CODES_V1.includes(item.reasonCode)))
        return false;
    if (value.instructionEligibility !== EVIDENCE_PACK_INSTRUCTION_ELIGIBILITY)
        return false;
    if (!isInt(value.evidenceBytes, 0, QUERY_LIMITS_V1.maximumEvidenceBytesPerCall))
        return false;
    if (!isDigest(value.packDigest))
        return false;
    return evidencePackDigestV1(value) === value.packDigest;
}
/**
 * Validate an Evidence Pack against the exact request that caused retrieval.
 * This closes the request/result pair over task, Knowledge edition, request
 * digest and the request-specific Evidence byte ceiling.
 */
export function validateEvidencePackResultForRequestV1(value, request) {
    if (!validateKnowledgeQueryRequestV1(request) || !validateEvidencePackResultV1(value))
        return false;
    return value.request.requestId === request.requestId
        && value.request.requestDigest === request.requestDigest
        && value.task.taskId === request.taskId
        && value.knowledgeEdition.editionId === request.knowledgeEditionId
        && value.knowledgeEdition.version === request.knowledgeEditionVersion
        && value.knowledgeEdition.digest === request.knowledgeEditionDigest
        && value.claims.length <= request.maxResults
        && value.evidenceBytes <= request.maxEvidenceBytes;
}
export function validateCompetenceResponseV1(value) {
    if (!exact(value, ["schemaVersion", "state", "taskId", "answer", "materialClaims", "procedureSteps", "preconditionChecks", "exclusionChecks", "conflicts", "missingKnowledge", "escalation", "actionAuthority", "responseDigest"]))
        return false;
    if (value.schemaVersion !== COMPETENCE_RESPONSE_PROTOCOL_V1)
        return false;
    if (!COMPETENCE_STATES_V1.includes(value.state))
        return false;
    if (!isBoundedText(value.taskId, 96))
        return false;
    if (!isNullableBoundedText(value.answer, 8192))
        return false;
    if (!Array.isArray(value.materialClaims) || value.materialClaims.length > COMPETENCE_RESPONSE_LIMITS_V1.maximumMaterialClaims || !value.materialClaims.every((claim) => exact(claim, ["claimId", "text", "evidenceIds"]) && isBoundedText(claim.claimId, 96) && isBoundedText(claim.text, 2048) && isUniqueStrings(claim.evidenceIds, (item) => isBoundedText(item, 96), 0, 32)))
        return false;
    if (!Array.isArray(value.procedureSteps) || value.procedureSteps.length > COMPETENCE_RESPONSE_LIMITS_V1.maximumProcedureSteps || !value.procedureSteps.every((step) => exact(step, ["stepId", "text", "order", "evidenceIds"]) && isBoundedText(step.stepId, 96) && isBoundedText(step.text, 2048) && isInt(step.order, 0, 1024) && isUniqueStrings(step.evidenceIds, (item) => isBoundedText(item, 96), 0, 32)))
        return false;
    if (!Array.isArray(value.preconditionChecks) || value.preconditionChecks.length > COMPETENCE_RESPONSE_LIMITS_V1.maximumPreconditionChecks || !value.preconditionChecks.every((check) => exact(check, ["preconditionId", "result"]) && isPreconditionId(check.preconditionId) && ["SATISFIED", "NOT_SATISFIED", "UNKNOWN"].includes(check.result)))
        return false;
    if (!Array.isArray(value.exclusionChecks) || value.exclusionChecks.length > COMPETENCE_RESPONSE_LIMITS_V1.maximumExclusionChecks || !value.exclusionChecks.every((check) => exact(check, ["exclusionId", "matched"]) && isPreconditionId(check.exclusionId) && typeof check.matched === "boolean"))
        return false;
    if (!Array.isArray(value.conflicts) || value.conflicts.length > COMPETENCE_RESPONSE_LIMITS_V1.maximumConflicts || !value.conflicts.every((conflict) => exact(conflict, ["conflictId", "claimIds"]) && isBoundedText(conflict.conflictId, 96) && isUniqueStrings(conflict.claimIds, (item) => isBoundedText(item, 96), 1, 32)))
        return false;
    if (!Array.isArray(value.missingKnowledge) || value.missingKnowledge.length > COMPETENCE_RESPONSE_LIMITS_V1.maximumMissingKnowledgeRecords || !value.missingKnowledge.every((item) => exact(item, ["needId", "reasonCode"]) && isBoundedText(item.needId, 96) && KNOWLEDGE_QUERY_REASON_CODES_V1.includes(item.reasonCode)))
        return false;
    if (!(value.escalation === null || (exact(value.escalation, ["required", "target"]) && value.escalation.required === true && isBoundedText(value.escalation.target, 96))))
        return false;
    if (value.actionAuthority !== ACTION_AUTHORITY_CONSTANT)
        return false;
    if (!isDigest(value.responseDigest))
        return false;
    // State-specific closed invariants.
    const hasSupportedContent = value.answer !== null
        && value.conflicts.length === 0
        && value.missingKnowledge.length === 0
        && value.preconditionChecks.every((check) => check.result === "SATISFIED")
        && value.exclusionChecks.every((check) => !check.matched)
        && value.materialClaims.every((claim) => claim.evidenceIds.length > 0)
        && value.procedureSteps.every((step) => step.evidenceIds.length > 0);
    if (value.conflicts.length > 0 && value.state !== "KNOWLEDGE_CONFLICT")
        return false;
    if (value.state === "ANSWER_SUPPORTED" && (!hasSupportedContent || value.escalation !== null))
        return false;
    if ((value.state === "NEED_MORE_KNOWLEDGE" || value.state === "INSUFFICIENT_EVIDENCE") && (value.answer !== null || value.missingKnowledge.length === 0))
        return false;
    if (value.state === "KNOWLEDGE_CONFLICT" && (value.answer !== null || value.conflicts.length === 0))
        return false;
    if (value.state === "COMPETENCE_LIMIT" && (value.answer !== null || (value.escalation === null || value.escalation.required !== true)))
        return false;
    if (value.state === "GOVERNED_ACTION_PROPOSAL" && !hasSupportedContent)
        return false;
    return competenceResponseDigestV1(value) === value.responseDigest;
}
// --- Runtime contract section validators ---
function validateModelBinding(value) {
    if (!exact(value, ["publisher", "name", "baseModelId", "artifactRepository", "artifactRevision", "artifactFile", "artifactFormat", "artifactArchitecture", "artifactSha256", "artifactSizeBytes", "artifactSourceUrl", "mutableAliasesForbidden", "localArtifactVerificationRequired", "artifactAcquiredByThisDecision"]))
        return false;
    if (!isBoundedText(value.publisher, 64) || !isBoundedText(value.name, 64) || !isBoundedText(value.baseModelId, 96) || !isBoundedText(value.artifactRepository, 96) || !isBoundedText(value.artifactRevision, 64) || !isBoundedText(value.artifactFile, 96) || !isBoundedText(value.artifactFormat, 16) || !isBoundedText(value.artifactArchitecture, 32) || !isBoundedText(value.artifactSourceUrl, 512))
        return false;
    if (!isDigest(value.artifactSha256) || !isInt(value.artifactSizeBytes, 1, Number.MAX_SAFE_INTEGER))
        return false;
    if (!isUniqueStrings(value.mutableAliasesForbidden, (item) => isBoundedText(item, 32), 0, 8))
        return false;
    return value.localArtifactVerificationRequired === true && value.artifactAcquiredByThisDecision === false;
}
function validateQuantizationBinding(value) {
    if (!exact(value, ["scheme", "source", "conversionOrRequantizationAllowed", "quantizationEquivalenceClaimed", "reproducibleConversionClaimed"]))
        return false;
    if (!isBoundedText(value.scheme, 32) || !isBoundedText(value.source, 64))
        return false;
    return value.conversionOrRequantizationAllowed === false && value.quantizationEquivalenceClaimed === false && value.reproducibleConversionClaimed === false;
}
function validateRuntimeBinding(value) {
    if (!exact(value, ["implementation", "releaseTag", "sourceCommit", "executable", "distributionAsset", "distributionAssetUrl", "distributionAssetSha256", "distributionAssetSizeBytes", "backend", "gpuLayers", "parallelSequences", "threads", "batchSize", "microBatchSize", "memoryMap", "memoryLock", "embeddedChatTemplateRequired", "chatTemplateOverrideAllowed", "runtimeArchiveAcquiredByThisDecision", "runManifestMustBindExtractedExecutableSha256", "runManifestMustCaptureVersionReadback"]))
        return false;
    if (!isBoundedText(value.implementation, 32) || !isBoundedText(value.releaseTag, 32) || !isBoundedText(value.sourceCommit, 64) || !isBoundedText(value.executable, 32) || !isBoundedText(value.distributionAsset, 96) || !isBoundedText(value.distributionAssetUrl, 512) || !isBoundedText(value.backend, 16))
        return false;
    if (!isDigest(value.distributionAssetSha256) || !isInt(value.distributionAssetSizeBytes, 1, Number.MAX_SAFE_INTEGER))
        return false;
    if (!isInt(value.gpuLayers, 0, 0) || !isInt(value.parallelSequences, 1, 1) || !isInt(value.threads, 1, 64) || !isInt(value.batchSize, 1, 1048576) || !isInt(value.microBatchSize, 1, 1048576))
        return false;
    if (typeof value.memoryMap !== "boolean" || typeof value.memoryLock !== "boolean")
        return false;
    return value.embeddedChatTemplateRequired === true && value.chatTemplateOverrideAllowed === false && value.runtimeArchiveAcquiredByThisDecision === false && value.runManifestMustBindExtractedExecutableSha256 === true && value.runManifestMustCaptureVersionReadback === true;
}
function validateContextBinding(value) {
    if (!exact(value, ["runtimeContextTokens", "modelMetadataContextTokensObserved", "maximumGeneratedTokens", "tokenBudget", "truncationPolicy", "onBudgetExceeded"]))
        return false;
    if (!isInt(value.runtimeContextTokens, 1, 1048576) || !isInt(value.modelMetadataContextTokensObserved, 1, 1048576) || !isInt(value.maximumGeneratedTokens, 1, 1048576))
        return false;
    if (!exact(value.tokenBudget, ["systemPromptMaximum", "toolDefinitionsMaximum", "taskAndConversationMaximum", "aggregateEvidencePackMaximum", "generatedOutputMaximum", "safetyReserve", "sum"]))
        return false;
    const budget = value.tokenBudget;
    if (!["systemPromptMaximum", "toolDefinitionsMaximum", "taskAndConversationMaximum", "aggregateEvidencePackMaximum", "generatedOutputMaximum", "safetyReserve"].every((key) => isInt(budget[key], 1, 1048576)))
        return false;
    const parts = ["systemPromptMaximum", "toolDefinitionsMaximum", "taskAndConversationMaximum", "aggregateEvidencePackMaximum", "generatedOutputMaximum", "safetyReserve"].reduce((total, key) => total + budget[key], 0);
    if (!isInt(budget.sum, 1, 1048576) || parts !== budget.sum)
        return false;
    if (!isBoundedText(value.truncationPolicy, 512) || !isBoundedText(value.onBudgetExceeded, 128))
        return false;
    return true;
}
function validateDecodingBinding(value) {
    if (!exact(value, ["mode", "temperature", "topK", "topP", "minP", "typicalP", "repeatPenalty", "repeatLastN", "presencePenalty", "frequencyPenalty", "mirostat", "seed", "maximumGeneratedTokens", "stopSequences", "grammarConstraint", "sameHardwareByteRepeatCount", "byteIdenticalRepeatRequired"]))
        return false;
    if (!isBoundedText(value.mode, 32) || !isBoundedText(value.grammarConstraint, 256))
        return false;
    for (const key of ["temperature", "topP", "minP", "typicalP", "repeatPenalty", "presencePenalty", "frequencyPenalty"]) {
        const num = value[key];
        if (typeof num !== "number" || !Number.isFinite(num) || num < 0 || num > 2)
            return false;
    }
    if (!isInt(value.topK, 0, 1024) || !isInt(value.repeatLastN, 0, 1024) || !isInt(value.mirostat, 0, 2) || !isInt(value.seed, 0, Number.MAX_SAFE_INTEGER) || !isInt(value.maximumGeneratedTokens, 1, 1048576))
        return false;
    if (!isUniqueStrings(value.stopSequences, (item) => isBoundedText(item, 64), 0, 8))
        return false;
    if (!isInt(value.sameHardwareByteRepeatCount, 1, 8))
        return false;
    return value.byteIdenticalRepeatRequired === true;
}
function validatePromptBinding(value) {
    if (!exact(value, ["promptId", "promptVersion", "encoding", "normalization", "trailingLineFeed", "assemblyVersion", "chatTemplateSource", "sha256"]))
        return false;
    if (!isBoundedText(value.promptId, 96) || !isBoundedText(value.promptVersion, 16) || !isBoundedText(value.assemblyVersion, 128) || !isBoundedText(value.chatTemplateSource, 128))
        return false;
    if (!isDigest(value.sha256))
        return false;
    return value.encoding === "UTF-8" && value.normalization === "NONE" && value.trailingLineFeed === false;
}
function validateQueryToolProtocol(value) {
    if (!exact(value, ["toolName", "protocolId", "protocolVersion", "contractStatus", "requiredArguments", "reasonCodes", "limits"]))
        return false;
    if (value.toolName !== "cks_knowledge_query" || value.protocolId !== KNOWLEDGE_QUERY_PROTOCOL_V1 || value.protocolVersion !== "1" || !isBoundedText(value.contractStatus, 256))
        return false;
    if (!exact(value.requiredArguments, KNOWLEDGE_QUERY_ARGUMENT_NAMES_V1) || !Object.values(value.requiredArguments).every((item) => isBoundedText(item, 256)))
        return false;
    if (!Array.isArray(value.reasonCodes) || !deepEquals([...value.reasonCodes].sort(), [...KNOWLEDGE_QUERY_REASON_CODES_V1].sort()) || value.reasonCodes.length !== KNOWLEDGE_QUERY_REASON_CODES_V1.length)
        return false;
    return deepEquals(value.limits, QUERY_LIMITS_V1);
}
function validateEvidencePackProtocol(value) {
    if (!exact(value, ["protocolId", "protocolVersion", "contractStatus", "requiredBindings", "statuses", "instructionEligibility"]))
        return false;
    if (value.protocolId !== EVIDENCE_PACK_PROTOCOL_V1 || value.protocolVersion !== "1" || !isBoundedText(value.contractStatus, 256))
        return false;
    if (!isUniqueStrings(value.requiredBindings, (item) => isBoundedText(item, 256), 1, 32))
        return false;
    if (!Array.isArray(value.statuses) || !deepEquals([...value.statuses].sort(), [...EVIDENCE_PACK_STATUSES_V1].sort()) || value.statuses.length !== EVIDENCE_PACK_STATUSES_V1.length)
        return false;
    return value.instructionEligibility === EVIDENCE_PACK_INSTRUCTION_ELIGIBILITY;
}
function validateFinalResponseProtocol(value) {
    if (!exact(value, ["protocolId", "protocolVersion", "contractStatus", "requiredFields", "states", "actionAuthorityConstant", "unknownFields"]))
        return false;
    if (value.protocolId !== COMPETENCE_RESPONSE_PROTOCOL_V1 || value.protocolVersion !== "1" || !isBoundedText(value.contractStatus, 256))
        return false;
    if (!isUniqueStrings(value.requiredFields, (item) => isBoundedText(item, 64), 1, 32))
        return false;
    if (!Array.isArray(value.states) || !deepEquals([...value.states].sort(), [...COMPETENCE_STATES_V1].sort()) || value.states.length !== COMPETENCE_STATES_V1.length)
        return false;
    return value.actionAuthorityConstant === ACTION_AUTHORITY_CONSTANT && value.unknownFields === "DENY";
}
function validateToolProtocols(value) {
    if (!exact(value, ["catalogueMode", "unknownToolsOrFields", "wireFormat", "queryTool", "evidencePackResult", "finalResponse"]))
        return false;
    if (value.catalogueMode !== "CLOSED_EXACTLY_ONE_MODEL_CALLABLE_TOOL" || value.unknownToolsOrFields !== "DENY" || !isBoundedText(value.wireFormat, 128))
        return false;
    return validateQueryToolProtocol(value.queryTool) && validateEvidencePackProtocol(value.evidencePackResult) && validateFinalResponseProtocol(value.finalResponse);
}
function validateKnowledgeBindings(value) {
    if (!exact(value, ["contractVersions", "contractArtifactPolicy", "editionPolicy", "requiredPerCaseBindings", "allowedVisibilityClasses", "onlineFallback", "mixedGeneration", "missingOrConflictingMaterialKnowledge", "knowledgeGrantsCapabilityOrAuthority"]))
        return false;
    if (!deepEquals(value.contractVersions, KNOWLEDGE_CONTRACT_VERSIONS_V1))
        return false;
    if (!isBoundedText(value.contractArtifactPolicy, 512) || !isBoundedText(value.editionPolicy, 512))
        return false;
    if (!isUniqueStrings(value.requiredPerCaseBindings, (item) => isBoundedText(item, 256), 1, 32))
        return false;
    if (!isUniqueStrings(value.allowedVisibilityClasses, (item) => isBoundedText(item, 64), 1, 16))
        return false;
    if (!isBoundedText(value.missingOrConflictingMaterialKnowledge, 256))
        return false;
    return value.onlineFallback === "FORBIDDEN" && value.mixedGeneration === "FORBIDDEN" && value.knowledgeGrantsCapabilityOrAuthority === false;
}
function validateInteractionPolicy(value) {
    if (!exact(value, ["informationNeedDetectionRequired", "applicabilityBeforeRanking", "preconditionsMustBeExplicitlyChecked", "exclusionsMustBeExplicitlyChecked", "parametricKnowledgePrecedence", "conflictResolution", "claimCoverageRule", "procedureCoverageRule", "missingKnowledgeRule", "conflictRule", "competenceRule", "toolOutputsInstructionEligible", "modelOutputAuthority"]))
        return false;
    const bools = ["informationNeedDetectionRequired", "applicabilityBeforeRanking", "preconditionsMustBeExplicitlyChecked", "exclusionsMustBeExplicitlyChecked"];
    if (!bools.every((key) => value[key] === true) || value.toolOutputsInstructionEligible !== false)
        return false;
    for (const key of ["parametricKnowledgePrecedence", "conflictResolution", "claimCoverageRule", "procedureCoverageRule", "missingKnowledgeRule", "conflictRule", "competenceRule", "modelOutputAuthority"]) {
        if (!isBoundedText(value[key], 512))
            return false;
    }
    return true;
}
function validateResourceLimits(value) {
    if (!exact(value, ["maximumWallSecondsPerModelTurn", "maximumWallSecondsPerCase", "maximumWallSecondsPerQualificationRun", "maximumRetrievalCallsPerTask", "maximumAggregateEvidenceBytesPerTask", "maximumGeneratedTokensPerTurn", "maximumMaterialClaimsPerResponse", "maximumProcedureStepsPerResponse", "maximumResidentBytes", "performanceClaim"]))
        return false;
    for (const key of ["maximumWallSecondsPerModelTurn", "maximumWallSecondsPerCase", "maximumWallSecondsPerQualificationRun", "maximumRetrievalCallsPerTask", "maximumAggregateEvidenceBytesPerTask", "maximumGeneratedTokensPerTurn", "maximumMaterialClaimsPerResponse", "maximumProcedureStepsPerResponse", "maximumResidentBytes"]) {
        if (!isInt(value[key], 1, Number.MAX_SAFE_INTEGER))
            return false;
    }
    return value.maximumRetrievalCallsPerTask === QUERY_LIMITS_V1.maximumCallsPerTask
        && value.maximumAggregateEvidenceBytesPerTask === QUERY_LIMITS_V1.maximumAggregateEvidenceBytes
        && value.maximumGeneratedTokensPerTurn === 1024
        && value.maximumMaterialClaimsPerResponse === COMPETENCE_RESPONSE_LIMITS_V1.maximumMaterialClaims
        && value.maximumProcedureStepsPerResponse === COMPETENCE_RESPONSE_LIMITS_V1.maximumProcedureSteps
        && isBoundedText(value.performanceClaim, 512);
}
export function validateCksCompetenceRuntimeContractV1(value) {
    if (!exact(value, ["schemaVersion", "contractId", "receiptSource", "profile", "model", "quantization", "runtime", "context", "decoding", "prompt", "toolProtocols", "knowledgeBindings", "interactionPolicy", "resourceLimits", "states", "contractDigest"]))
        return false;
    if (value.schemaVersion !== COMPETENCE_RUNTIME_SCHEMA_V1 || value.contractId !== CKS_COMPETENCE_RUNTIME_CONTRACT_ID_V1)
        return false;
    if (!exact(value.receiptSource, ["receiptPath", "receiptDigest", "profileCoreDigest", "decisionId"]) || !isBoundedText(value.receiptSource.receiptPath, 256) || !isDigest(value.receiptSource.receiptDigest) || !isDigest(value.receiptSource.profileCoreDigest) || !isBoundedText(value.receiptSource.decisionId, 96))
        return false;
    if (!exact(value.profile, ["profileSchemaVersion", "profileId", "profileRevision", "intendedUse", "selectionStatus"]) || !isBoundedText(value.profile.profileSchemaVersion, 128) || !isBoundedText(value.profile.profileId, 128) || !isInt(value.profile.profileRevision, 1, 1024) || !isBoundedText(value.profile.intendedUse, 128) || value.profile.selectionStatus !== "SELECTED_NOT_QUALIFIED")
        return false;
    if (!deepEquals(value.states, [...COMPETENCE_STATES_V1]))
        return false;
    if (!validateModelBinding(value.model) || !validateQuantizationBinding(value.quantization) || !validateRuntimeBinding(value.runtime) || !validateContextBinding(value.context) || !validateDecodingBinding(value.decoding) || !validatePromptBinding(value.prompt) || !validateToolProtocols(value.toolProtocols) || !validateKnowledgeBindings(value.knowledgeBindings) || !validateInteractionPolicy(value.interactionPolicy) || !validateResourceLimits(value.resourceLimits))
        return false;
    if (value.context.tokenBudget.sum !== value.context.runtimeContextTokens
        || value.context.maximumGeneratedTokens !== value.decoding.maximumGeneratedTokens
        || value.context.maximumGeneratedTokens !== value.resourceLimits.maximumGeneratedTokensPerTurn
        || value.resourceLimits.maximumRetrievalCallsPerTask !== value.toolProtocols.queryTool.limits.maximumCallsPerTask
        || value.resourceLimits.maximumAggregateEvidenceBytesPerTask !== value.toolProtocols.queryTool.limits.maximumAggregateEvidenceBytes)
        return false;
    if (!isDigest(value.contractDigest))
        return false;
    return cksCompetenceRuntimeContractDigestV1(value) === value.contractDigest;
}
/**
 * Build a data-only runtime contract from an authoritative decision receipt's
 * `selectedProfile`. The prompt is bound by header fields plus `sha256` only;
 * the system-prompt body is deliberately not embedded.
 */
export function buildCksCompetenceRuntimeContractV1(input) {
    const profile = input.selectedProfile;
    const prompt = profile["prompt"];
    if (!isDigest(input.receiptDigest) || !isDigest(input.profileCoreDigest) || !isBoundedText(input.receiptPath, 256) || !isBoundedText(input.decisionId, 96))
        throw new Error("CKS_COMPETENCE_RUNTIME_INPUT_DENIED");
    if (!record(prompt))
        throw new Error("CKS_COMPETENCE_RUNTIME_INPUT_DENIED");
    const promptBinding = {
        promptId: prompt["promptId"],
        promptVersion: prompt["promptVersion"],
        encoding: prompt["encoding"],
        normalization: prompt["normalization"],
        trailingLineFeed: prompt["trailingLineFeed"],
        assemblyVersion: prompt["assemblyVersion"],
        chatTemplateSource: prompt["chatTemplateSource"],
        sha256: prompt["sha256"],
    };
    const unsigned = {
        schemaVersion: COMPETENCE_RUNTIME_SCHEMA_V1,
        contractId: CKS_COMPETENCE_RUNTIME_CONTRACT_ID_V1,
        receiptSource: { receiptPath: input.receiptPath, receiptDigest: input.receiptDigest, profileCoreDigest: input.profileCoreDigest, decisionId: input.decisionId },
        profile: {
            profileSchemaVersion: profile["profileSchemaVersion"],
            profileId: profile["profileId"],
            profileRevision: profile["profileRevision"],
            intendedUse: profile["intendedUse"],
            selectionStatus: profile["selectionStatus"],
        },
        model: profile["model"],
        quantization: profile["quantization"],
        runtime: profile["runtime"],
        context: profile["context"],
        decoding: profile["decoding"],
        prompt: promptBinding,
        toolProtocols: profile["toolProtocols"],
        knowledgeBindings: profile["knowledgeBindings"],
        interactionPolicy: profile["interactionPolicy"],
        resourceLimits: profile["resourceLimits"],
        states: [...COMPETENCE_STATES_V1],
    };
    const candidate = { ...unsigned, contractDigest: cksCompetenceRuntimeContractDigestV1(unsigned) };
    if (!validateCksCompetenceRuntimeContractV1(candidate))
        throw new Error("CKS_COMPETENCE_RUNTIME_INPUT_DENIED");
    return candidate;
}
/**
 * Admit a bounded Knowledge Query call for an exact task binding. Enforces the
 * task, Knowledge edition, applicability, allowed kinds and Preconditions plus
 * the per-task call budget, monotonic `KQ-0[1-3]` request ordering and per-call
 * and aggregate Evidence byte ceilings. The returned `maxEvidenceBytes` bound
 * is what the retrieval layer must honour when it assembles the Evidence Pack.
 */
export function admitKnowledgeQueryV1(state, request) {
    if (!exact(state, ["taskId", "knowledgeEditionId", "knowledgeEditionVersion", "knowledgeEditionDigest", "applicability", "allowedNeedKinds", "allowedPreconditions", "admittedCallCount", "aggregateEvidenceBytes"])
        || !isBoundedText(state.taskId, 96)
        || !isBoundedText(state.knowledgeEditionId, 96)
        || !isBoundedText(state.knowledgeEditionVersion, 32)
        || !isDigest(state.knowledgeEditionDigest)
        || !validateApplicability(state.applicability)
        || !isUniqueStrings(state.allowedNeedKinds, isKindId, 1, 16)
        || !isUniqueStrings(state.allowedPreconditions, isPreconditionId, 0, 16)
        || !isInt(state.admittedCallCount, 0, QUERY_LIMITS_V1.maximumCallsPerTask)
        || !isInt(state.aggregateEvidenceBytes, 0, QUERY_LIMITS_V1.maximumAggregateEvidenceBytes))
        return { outcome: "DENIED", reason: "TASK_STATE_MALFORMED" };
    if (state.admittedCallCount >= QUERY_LIMITS_V1.maximumCallsPerTask)
        return { outcome: "DENIED", reason: "CALL_BUDGET_EXHAUSTED" };
    if (!validateKnowledgeQueryRequestV1(request))
        return { outcome: "DENIED", reason: "QUERY_MALFORMED" };
    if (request.taskId !== state.taskId)
        return { outcome: "DENIED", reason: "TASK_BINDING_MISMATCH" };
    if (request.knowledgeEditionId !== state.knowledgeEditionId
        || request.knowledgeEditionVersion !== state.knowledgeEditionVersion
        || request.knowledgeEditionDigest !== state.knowledgeEditionDigest)
        return { outcome: "DENIED", reason: "KNOWLEDGE_EDITION_BINDING_MISMATCH" };
    if (!request.needKinds.every((kind) => state.allowedNeedKinds.includes(kind)))
        return { outcome: "DENIED", reason: "NEED_KIND_NOT_ALLOWED" };
    if (!deepEquals(request.applicability, state.applicability))
        return { outcome: "DENIED", reason: "APPLICABILITY_SCOPE_MISMATCH" };
    if (!request.requiredPreconditions.every((precondition) => state.allowedPreconditions.includes(precondition)))
        return { outcome: "DENIED", reason: "PRECONDITION_NOT_ALLOWED" };
    const expectedNumber = state.admittedCallCount + 1;
    const prefix = `KQ-0${expectedNumber}`;
    if (!isRequestId(request.requestId))
        return { outcome: "DENIED", reason: "REQUEST_ID_INVALID" };
    if (request.requestId !== prefix) {
        const requested = Number(request.requestId.slice(4));
        if (requested <= state.admittedCallCount)
            return { outcome: "DENIED", reason: "REQUEST_ID_DUPLICATE" };
        return { outcome: "DENIED", reason: "REQUEST_ID_NOT_MONOTONIC" };
    }
    if (Buffer.byteLength(request.queryText, "utf8") > QUERY_LIMITS_V1.maximumQueryBytes)
        return { outcome: "DENIED", reason: "QUERY_TEXT_BYTES_EXCEEDED" };
    if (request.maxResults > QUERY_LIMITS_V1.maximumResultsPerCall)
        return { outcome: "DENIED", reason: "RESULT_LIMIT_EXCEEDED" };
    if (request.maxEvidenceBytes > QUERY_LIMITS_V1.maximumEvidenceBytesPerCall)
        return { outcome: "DENIED", reason: "EVIDENCE_BYTE_LIMIT_EXCEEDED" };
    if (state.aggregateEvidenceBytes + request.maxEvidenceBytes > QUERY_LIMITS_V1.maximumAggregateEvidenceBytes)
        return { outcome: "DENIED", reason: "AGGREGATE_EVIDENCE_BYTES_EXCEEDED" };
    // The closed schema carries no network-locator or effect fields, so a valid
    // request cannot name one; this is the explicit closed-catalogue guarantee.
    return { outcome: "ADMITTED", callNumber: expectedNumber, newAggregateEvidenceBytes: state.aggregateEvidenceBytes + request.maxEvidenceBytes };
}
/**
 * Resolve one of the six closed competence states from a task's evidence
 * posture. Deterministic and fail-closed: a conflict or a material knowledge
 * gap always beats a supported answer, and exhausted bounded retrieval that
 * still exceeds the profile escalates via COMPETENCE_LIMIT.
 */
export function resolveCompetenceStateV1(input) {
    if (input.conflictsPresent)
        return "KNOWLEDGE_CONFLICT";
    if (input.retrievalCallsExhausted && !input.taskWithinProfile)
        return "COMPETENCE_LIMIT";
    if (input.materialKnowledgeMissing) {
        if (input.differentiatingRetrievalAvailable && !input.retrievalCallsExhausted)
            return "NEED_MORE_KNOWLEDGE";
        return "INSUFFICIENT_EVIDENCE";
    }
    if (input.allMaterialClaimsCovered && input.allProcedureStepsCovered && input.preconditionsChecked && input.exclusionsChecked)
        return "ANSWER_SUPPORTED";
    return "INSUFFICIENT_EVIDENCE";
}
