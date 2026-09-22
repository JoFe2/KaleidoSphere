import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
// Frozen CKS-09 proof vocabulary: docs/evidence/conveyor/sol-psai289-fingerprint-retrieval-decision-01.json
// (commit 8802d90, baseline 353017c). Digests use the frozen text form sha256:<64 lowercase hex>.
// Closed-world rule: unknown values, omitted required values, type errors, and prose substitutions fail closed.
// Reason mapping at the gate: malformed, out-of-vocabulary, or non-canonical typed input is PROSE_ONLY_INPUT;
// a missing or ambiguous structural fact is AMBIGUOUS_APPLICABILITY. Records are S2-and-above candidates only;
// S0/S1 states exist as admitted evidence records, never as live authority.
export const CKS_09_TASK_FINGERPRINT_SCHEMA_V1 = "pansphaira.cks/task-fingerprint/v1";
export const CKS_09_TASK_FAMILY_SCHEMA_V1 = "pansphaira.cks/task-family/v1";
export const CKS_09_KNOWLEDGE_BUNDLE_SCHEMA_V1 = "pansphaira.cks/knowledge-bundle/v1";
export const CKS_09_SOLUTION_PATTERN_SCHEMA_V1 = "pansphaira.cks/solution-pattern-candidate/v1";
export const PROOF_VERDICTS = ["PASS", "DENIED", "INCONCLUSIVE"];
export const TRUTH_VALUES = ["TRUE", "FALSE", "UNKNOWN"];
export const APPLICABILITY_RESULTS = ["APPLICABLE_SHADOW_ONLY", "DENIED"];
export const RETRIEVAL_ARMS = ["KNOWLEDGE_ONLY", "KNOWLEDGE_PLUS_EXPERIENCE"];
export const REPLAY_MODES = ["SIMULATION", "SHADOW"];
export const MATURITY_LEVELS = ["S0", "S1", "S2", "S3", "S4", "S5", "S6"];
export const EFFECT_CLASSES = ["READ_ONLY", "REVERSIBLE_LOCAL", "EXTERNAL_OR_IRREVERSIBLE"];
export const VERSION_SCHEMES = ["SEMVER_EXACT", "OPAQUE_EXACT", "SHA256_EXACT"];
export const VERSION_RELATIONS = ["COMPATIBLE", "INCOMPATIBLE", "UNKNOWN"];
export const PREDICATE_OPERATORS = ["EQ", "IN", "SET_CONTAINS_ALL", "SET_DISJOINT", "EXISTS"];
export const DEPENDENCY_KINDS = ["KNOWLEDGE", "SCHEMA", "TOOL", "RUNTIME", "PATTERN"];
export const EVIDENCE_KINDS = [
    "OBSERVATION", "REPETITION", "DIVERSITY_PROOF", "CONTRAST_PAIR", "HOLDOUT_RUN",
    "NEGATIVE_CONTROL", "COUNTEREVIDENCE_SEARCH", "KNOWN_FAILURE", "COUNTEREXAMPLE", "SHADOW_REPLAY",
];
export const P18_FIXTURE_CLASSES = ["PLANTED_STABLE", "FREQUENCY_ONLY_TRAP", "NARROW_CONTEXT_TRAP", "CORRELATION_TRAP"];
export const CHARGED_COST_EVENTS = ["RETRIEVAL_ITEM", "CANDIDATE_STEP", "TOOL_CALL", "CHECK_RUN"];
export const DENIAL_REASONS = [
    "MISSING_288_DIGEST", "INVALID_288_DIGEST", "INVALID_PROVENANCE", "MISSING_EVIDENCE", "INVALID_KNOWLEDGE_BUNDLE",
    "UNSEALED_HOLDOUT", "HOLDOUT_LEAKAGE", "INVALID_DIVERSITY_PROOF", "AMBIGUOUS_TASK_FAMILY", "FAMILY_MISMATCH",
    "AMBIGUOUS_APPLICABILITY", "PRECONDITION_FALSE", "PRECONDITION_UNKNOWN", "DEPENDENCY_MISSING", "DEPENDENCY_UNVERIFIED",
    "VERSION_INCOMPATIBLE", "VERSION_UNKNOWN", "MATCHED_KNOWN_FAILURE", "MATCHED_COUNTEREXAMPLE", "ABSENT_COUNTEREVIDENCE",
    "UNRESOLVED_FAILURE", "INSUFFICIENT_MATURITY", "PROSE_ONLY_INPUT", "LIVE_REPLAY_FORBIDDEN",
];
export const TASK_FINGERPRINT_STRUCTURAL_DIMENSIONS = [
    "taskFamilyId", "objectiveShapeId", "inputShapeId", "outputShapeId", "contextShapeId",
    "constraintIds", "effectClass", "dependencyIds", "versionVector",
];
export const FAILURE_RESOLUTION_VALUES = ["OPEN", "BOUNDED_BY_PRECONDITION", "INVALIDATES_PATTERN"];
export const COVERAGE_STATUS_VALUES = ["COMPLETE", "INCOMPLETE"];
export const MATURITY_LEVEL_SPECS_V1 = [
    { id: "S0", name: "OBSERVED", minimumIndependentEpisodes: 1, shadowRetrieval: "DENIED" },
    { id: "S1", name: "REPEATED", minimumIndependentEpisodes: 2, shadowRetrieval: "DENIED" },
    { id: "S2", name: "STRUCTURED_CANDIDATE", minimumIndependentEpisodes: 3, shadowRetrieval: "DENIED" },
    { id: "S3", name: "APPLICABILITY_BOUNDED", minimumIndependentEpisodes: 3, shadowRetrieval: "APPLICABLE_TASKS_ONLY" },
    { id: "S4", name: "HOLDOUT_IDENTIFIED", minimumIndependentEpisodes: 3, shadowRetrieval: "APPLICABLE_TASKS_ONLY" },
    { id: "S5", name: "SHADOW_BENEFICIAL", minimumIndependentEpisodes: 3, shadowRetrieval: "APPLICABLE_TASKS_ONLY" },
    { id: "S6", name: "STABLE_SHADOW_CANDIDATE", minimumIndependentEpisodes: 3, shadowRetrieval: "APPLICABLE_TASKS_ONLY" },
];
export const maturityRankV1 = (level) => MATURITY_LEVELS.indexOf(level);
const sha256Hex = (value) => createHash("sha256").update(canonicalJson(value)).digest("hex");
export const cks09Digest = (value) => `sha256:${sha256Hex(value)}`;
const withoutDigest = (value, field) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== field));
export function taskFingerprintDigestV1(value) {
    return cks09Digest(Object.fromEntries(TASK_FINGERPRINT_STRUCTURAL_DIMENSIONS.map((dimension) => [dimension, value[dimension]])));
}
export const taskFamilyDigestV1 = (value) => cks09Digest(withoutDigest(value, "canonicalDigest"));
export const knowledgeBundleDigestV1 = (value) => cks09Digest(withoutDigest(value, "canonicalDigest"));
export const solutionPatternDigestV1 = (value) => cks09Digest(withoutDigest(value, "canonicalDigest"));
export const counterevidenceAssessmentDigestV1 = (value) => cks09Digest(withoutDigest(value, "canonicalDigest"));
export const versionConstraintDigestV1 = (value) => cks09Digest(withoutDigest(value, "canonicalDigest"));
export const diversityProofDigestV1 = (value) => cks09Digest(withoutDigest(value, "canonicalDigest"));
export const evidenceRecordDigestV1 = (value) => cks09Digest(value);
export const provenanceRecordDigestV1 = (value) => cks09Digest(value);
export const dependencyRecordDigestV1 = (value) => cks09Digest(value);
export const knownFailureRecordDigestV1 = (value) => cks09Digest(value);
export const counterexampleRecordDigestV1 = (value) => cks09Digest(value);
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, keys) => record(value) && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
const ckDigest = (value) => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
const ckId = (value) => typeof value === "string" && /^[a-z][a-z0-9-]{1,31}:[a-z0-9][a-z0-9._-]{2,95}$/.test(value);
const boundedText = (value, min, max) => typeof value === "string" && value.length >= min && value.length <= max && !/[\u0000-\u001F\u007F]/.test(value);
const exactValueText = (value) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const sortedSet = (value, itemGuard, min, max) => Array.isArray(value) && value.length >= min && value.length <= max && value.every(itemGuard)
    && new Set(value).size === value.length && value.every((item, index, all) => index === 0 || all[index - 1] < item);
const versionVectorEntries = (value, min, max) => Array.isArray(value) && value.length >= min && value.length <= max && value.every((entry) => exact(entry, ["componentId", "versionScheme", "exactValue"]) && ckId(entry.componentId)
    && VERSION_SCHEMES.includes(entry.versionScheme) && exactValueText(entry.exactValue))
    && new Set(value.map((entry) => `${entry.componentId}\u0000${entry.versionScheme}`)).size === value.length
    && value.every((entry, index, all) => index === 0 || canonicalJson(all[index - 1]) < canonicalJson(entry));
const factPath = (value) => typeof value === "string"
    && (value === "" || value.startsWith("/") && value.slice(1).split("/").every((token) => !/~(?![01])/.test(token)));
const typedOperand = (value) => {
    if (value === null || typeof value === "boolean")
        return true;
    if (typeof value === "number")
        return Number.isFinite(value);
    if (typeof value === "string")
        return boundedText(value, 1, 128);
    return Array.isArray(value) && value.length <= 32 && value.every((item) => item === null || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item)
        || typeof item === "string" && boundedText(item, 1, 128));
};
const clause = (value) => exact(value, ["factPath", "operator", "operand"]) && factPath(value.factPath)
    && PREDICATE_OPERATORS.includes(value.operator) && typedOperand(value.operand);
const FINGERPRINT_FIELDS = ["fingerprintId", "taskFamilyId", "objectiveShapeId", "inputShapeId", "outputShapeId", "contextShapeId", "constraintIds", "effectClass", "dependencyIds", "versionVector", "canonicalDigest"];
export function validateTaskFingerprintV1(value) {
    if (!exact(value, FINGERPRINT_FIELDS))
        return ["PROSE_ONLY_INPUT"];
    const v = value;
    if (!ckId(v.fingerprintId) || !ckId(v.taskFamilyId) || !ckId(v.objectiveShapeId) || !ckId(v.inputShapeId) || !ckId(v.outputShapeId) || !ckId(v.contextShapeId))
        return ["PROSE_ONLY_INPUT"];
    if (!sortedSet(v.constraintIds, ckId, 0, 32) || !sortedSet(v.dependencyIds, ckId, 0, 32))
        return ["AMBIGUOUS_APPLICABILITY"];
    if (!EFFECT_CLASSES.includes(v.effectClass))
        return ["PROSE_ONLY_INPUT"];
    if (!versionVectorEntries(v.versionVector, 0, 16))
        return ["PROSE_ONLY_INPUT"];
    if (!ckDigest(v.canonicalDigest) || v.canonicalDigest !== taskFingerprintDigestV1(v))
        return ["PROSE_ONLY_INPUT"];
    return [];
}
const FAMILY_FIELDS = ["familyId", "membershipClauses", "invariantIds", "variantAxes", "exclusionClauses", "evidenceRefs", "provenanceRefs", "canonicalDigest"];
export function validateTaskFamilyV1(value) {
    if (!exact(value, FAMILY_FIELDS))
        return ["PROSE_ONLY_INPUT"];
    const v = value;
    if (!ckId(v.familyId))
        return ["PROSE_ONLY_INPUT"];
    if (!Array.isArray(v.membershipClauses) || v.membershipClauses.length < 1 || v.membershipClauses.length > 16 || !v.membershipClauses.every(clause))
        return ["PROSE_ONLY_INPUT"];
    if (!sortedSet(v.invariantIds, ckId, 1, 32))
        return ["PROSE_ONLY_INPUT"];
    if (!Array.isArray(v.variantAxes) || new Set(v.variantAxes).size !== v.variantAxes.length || !v.variantAxes.every((axis) => TASK_FINGERPRINT_STRUCTURAL_DIMENSIONS.includes(axis)))
        return ["PROSE_ONLY_INPUT"];
    if (!Array.isArray(v.exclusionClauses) || v.exclusionClauses.length > 16 || !v.exclusionClauses.every(clause))
        return ["PROSE_ONLY_INPUT"];
    if (!sortedSet(v.evidenceRefs, ckId, 1, 32) || !sortedSet(v.provenanceRefs, ckId, 1, 32))
        return ["PROSE_ONLY_INPUT"];
    if (!ckDigest(v.canonicalDigest) || v.canonicalDigest !== taskFamilyDigestV1(v))
        return ["PROSE_ONLY_INPUT"];
    return [];
}
const BUNDLE_FIELDS = ["bundleId", "contentRefs", "scopeIds", "versionVector", "provenanceRefs", "canonicalDigest"];
const contentRef = (value) => exact(value, ["contentId", "contentDigest", "provenanceRef"]) && ckId(value.contentId) && ckDigest(value.contentDigest) && ckId(value.provenanceRef);
export function validateKnowledgeBundleV1(value) {
    if (!exact(value, BUNDLE_FIELDS))
        return ["INVALID_KNOWLEDGE_BUNDLE"];
    const v = value;
    if (!ckId(v.bundleId))
        return ["INVALID_KNOWLEDGE_BUNDLE"];
    if (!Array.isArray(v.contentRefs) || v.contentRefs.length < 1 || v.contentRefs.length > 32 || !v.contentRefs.every(contentRef))
        return ["INVALID_KNOWLEDGE_BUNDLE"];
    if (new Set(v.contentRefs.map((item) => item.contentId)).size !== v.contentRefs.length)
        return ["INVALID_KNOWLEDGE_BUNDLE"];
    if (!sortedSet(v.scopeIds, ckId, 1, 16))
        return ["INVALID_KNOWLEDGE_BUNDLE"];
    if (!versionVectorEntries(v.versionVector, 0, 16) || !sortedSet(v.provenanceRefs, ckId, 1, 32))
        return ["INVALID_KNOWLEDGE_BUNDLE"];
    if (!v.contentRefs.every((item) => v.provenanceRefs.includes(item.provenanceRef)))
        return ["INVALID_KNOWLEDGE_BUNDLE"];
    if (!ckDigest(v.canonicalDigest) || v.canonicalDigest !== knowledgeBundleDigestV1(v))
        return ["INVALID_KNOWLEDGE_BUNDLE"];
    return [];
}
const EVIDENCE_FIELDS = ["evidenceId", "kind", "sourceDigest", "taskFingerprintDigest", "outcomeDigest", "provenanceRef"];
export function validateEvidenceRecordV1(value) {
    if (!exact(value, EVIDENCE_FIELDS))
        return ["PROSE_ONLY_INPUT"];
    const v = value;
    if (!ckId(v.evidenceId) || !EVIDENCE_KINDS.includes(v.kind))
        return ["PROSE_ONLY_INPUT"];
    if (!ckDigest(v.sourceDigest) || !ckDigest(v.taskFingerprintDigest) || !ckDigest(v.outcomeDigest) || !ckId(v.provenanceRef))
        return ["PROSE_ONLY_INPUT"];
    return [];
}
const PROVENANCE_FIELDS = ["provenanceId", "sourceKind", "sourceLocator", "rootDigest", "parentDigests", "producerId", "toolchainVersionVector", "sealed"];
export function validateProvenanceRecordV1(value) {
    if (!exact(value, PROVENANCE_FIELDS))
        return ["INVALID_PROVENANCE"];
    const v = value;
    if (!ckId(v.provenanceId) || !boundedText(v.sourceKind, 1, 64) || !boundedText(v.sourceLocator, 1, 256))
        return ["INVALID_PROVENANCE"];
    if (!ckDigest(v.rootDigest) || !sortedSet(v.parentDigests, ckDigest, 0, 32) || !ckId(v.producerId))
        return ["INVALID_PROVENANCE"];
    if (!versionVectorEntries(v.toolchainVersionVector, 0, 16) || v.sealed !== true && v.sealed !== false)
        return ["INVALID_PROVENANCE"];
    return [];
}
const DEPENDENCY_FIELDS = ["dependencyId", "kind", "requiredStateDigest", "versionConstraintRef", "verificationEvidenceRef"];
export function validateDependencyRecordV1(value) {
    if (!exact(value, DEPENDENCY_FIELDS))
        return ["PROSE_ONLY_INPUT"];
    const v = value;
    if (!ckId(v.dependencyId) || !DEPENDENCY_KINDS.includes(v.kind))
        return ["PROSE_ONLY_INPUT"];
    if (!ckDigest(v.requiredStateDigest) || !ckId(v.versionConstraintRef) || !ckId(v.verificationEvidenceRef))
        return ["PROSE_ONLY_INPUT"];
    return [];
}
const CONSTRAINT_FIELDS = ["constraintId", "componentId", "versionScheme", "allowedExactValues", "evidenceRefs", "canonicalDigest"];
export function validateVersionConstraintV1(value) {
    if (!exact(value, CONSTRAINT_FIELDS))
        return ["PROSE_ONLY_INPUT"];
    const v = value;
    if (!ckId(v.constraintId) || !ckId(v.componentId) || !VERSION_SCHEMES.includes(v.versionScheme))
        return ["PROSE_ONLY_INPUT"];
    if (!sortedSet(v.allowedExactValues, exactValueText, 1, 32) || !sortedSet(v.evidenceRefs, ckId, 1, 32))
        return ["PROSE_ONLY_INPUT"];
    if (!ckDigest(v.canonicalDigest) || v.canonicalDigest !== versionConstraintDigestV1(v))
        return ["PROSE_ONLY_INPUT"];
    return [];
}
const KNOWN_FAILURE_FIELDS = ["failureId", "patternId", "taskFingerprintDigest", "expectedOutcomeDigest", "observedOutcomeDigest", "evidenceRef", "provenanceRef", "resolution"];
export function validateKnownFailureRecordV1(value) {
    if (!exact(value, KNOWN_FAILURE_FIELDS))
        return ["PROSE_ONLY_INPUT"];
    const v = value;
    if (!ckId(v.failureId) || !ckId(v.patternId))
        return ["PROSE_ONLY_INPUT"];
    if (!ckDigest(v.taskFingerprintDigest) || !ckDigest(v.expectedOutcomeDigest) || !ckDigest(v.observedOutcomeDigest))
        return ["PROSE_ONLY_INPUT"];
    if (!ckId(v.evidenceRef) || !ckId(v.provenanceRef))
        return ["PROSE_ONLY_INPUT"];
    if (!FAILURE_RESOLUTION_VALUES.includes(v.resolution))
        return ["PROSE_ONLY_INPUT"];
    return [];
}
const COUNTEREXAMPLE_FIELDS = ["counterexampleId", "patternId", "taskFingerprintDigest", "matchedSimilarityFacts", "blockingStructuralDimension", "expectedDenialReason", "evidenceRef", "provenanceRef"];
export function validateCounterexampleRecordV1(value) {
    if (!exact(value, COUNTEREXAMPLE_FIELDS))
        return ["PROSE_ONLY_INPUT"];
    const v = value;
    if (!ckId(v.counterexampleId) || !ckId(v.patternId) || !ckDigest(v.taskFingerprintDigest))
        return ["PROSE_ONLY_INPUT"];
    if (!sortedSet(v.matchedSimilarityFacts, (item) => boundedText(item, 1, 128), 0, 32))
        return ["PROSE_ONLY_INPUT"];
    if (!TASK_FINGERPRINT_STRUCTURAL_DIMENSIONS.includes(v.blockingStructuralDimension))
        return ["PROSE_ONLY_INPUT"];
    if (!DENIAL_REASONS.includes(v.expectedDenialReason) || !ckId(v.evidenceRef) || !ckId(v.provenanceRef))
        return ["PROSE_ONLY_INPUT"];
    return [];
}
const ASSESSMENT_FIELDS = ["assessmentId", "searchEvidenceRefs", "knownFailureRefs", "counterexampleRefs", "negativeControlRefs", "coverageStatus", "canonicalDigest"];
export function validateCounterevidenceAssessmentV1(value) {
    if (!exact(value, ASSESSMENT_FIELDS))
        return ["PROSE_ONLY_INPUT"];
    const v = value;
    if (!ckId(v.assessmentId))
        return ["PROSE_ONLY_INPUT"];
    if (!sortedSet(v.searchEvidenceRefs, ckId, 1, 32) || !sortedSet(v.knownFailureRefs, ckId, 0, 32))
        return ["PROSE_ONLY_INPUT"];
    if (!sortedSet(v.counterexampleRefs, ckId, 0, 32) || !sortedSet(v.negativeControlRefs, ckId, 1, 32))
        return ["PROSE_ONLY_INPUT"];
    if (!COVERAGE_STATUS_VALUES.includes(v.coverageStatus))
        return ["PROSE_ONLY_INPUT"];
    if (!ckDigest(v.canonicalDigest) || v.canonicalDigest !== counterevidenceAssessmentDigestV1(v))
        return ["PROSE_ONLY_INPUT"];
    return [];
}
const PROOF_FIELDS = ["proofId", "patternId", "independentEpisodeRefs", "taskVariantIds", "contextShapeIds", "coveredVariantAxes", "contrastPairRefs", "provenanceRefs", "canonicalDigest"];
function transitiveRoots(value, provenanceByRoot) {
    const seen = new Set([value.rootDigest]);
    const frontier = [...value.parentDigests];
    while (frontier.length > 0) {
        const root = frontier.pop();
        if (seen.has(root))
            continue;
        seen.add(root);
        const parent = provenanceByRoot.get(root);
        if (parent !== undefined)
            frontier.push(...parent.parentDigests);
    }
    return seen;
}
export function validateDiversityProofV1(value, context) {
    if (!exact(value, PROOF_FIELDS))
        return ["INVALID_DIVERSITY_PROOF"];
    const v = value;
    if (!ckId(v.proofId) || !ckId(v.patternId))
        return ["INVALID_DIVERSITY_PROOF"];
    if (!sortedSet(v.independentEpisodeRefs, ckId, 3, 32) || !sortedSet(v.taskVariantIds, ckId, 3, 32))
        return ["INVALID_DIVERSITY_PROOF"];
    if (!sortedSet(v.contextShapeIds, ckId, 2, 16))
        return ["INVALID_DIVERSITY_PROOF"];
    if (!Array.isArray(v.coveredVariantAxes) || v.coveredVariantAxes.length < 2 || new Set(v.coveredVariantAxes).size !== v.coveredVariantAxes.length
        || !v.coveredVariantAxes.every((axis) => TASK_FINGERPRINT_STRUCTURAL_DIMENSIONS.includes(axis)))
        return ["INVALID_DIVERSITY_PROOF"];
    if (!sortedSet(v.contrastPairRefs, ckId, 1, 16) || !sortedSet(v.provenanceRefs, ckId, 1, 32))
        return ["INVALID_DIVERSITY_PROOF"];
    if (!ckDigest(v.canonicalDigest) || v.canonicalDigest !== diversityProofDigestV1(v))
        return ["INVALID_DIVERSITY_PROOF"];
    const reasons = [];
    const evidenceById = new Map(context.evidence.map((item) => [item.evidenceId, item]));
    const provenanceById = new Map(context.provenance.map((item) => [item.provenanceId, item]));
    const proofProvenanceRefs = new Set(v.provenanceRefs);
    for (const ref of v.provenanceRefs) {
        const provenance = provenanceById.get(ref);
        if (provenance === undefined || validateProvenanceRecordV1(provenance).length > 0 || provenance.sealed !== true)
            reasons.push("INVALID_PROVENANCE");
    }
    const episodes = [];
    const episodeProvenance = [];
    for (const ref of v.independentEpisodeRefs) {
        const evidence = evidenceById.get(ref);
        if (evidence === undefined || validateEvidenceRecordV1(evidence).length > 0 || evidence.kind !== "OBSERVATION") {
            if (evidence === undefined)
                reasons.push("MISSING_EVIDENCE");
            else
                reasons.push("INVALID_DIVERSITY_PROOF");
            continue;
        }
        const episode = context.episodes.find((item) => item.canonicalDigest === evidence.taskFingerprintDigest);
        if (episode === undefined || validateTaskFingerprintV1(episode).length > 0 || !proofProvenanceRefs.has(evidence.provenanceRef)) {
            reasons.push("INVALID_DIVERSITY_PROOF");
            continue;
        }
        const provenance = provenanceById.get(evidence.provenanceRef);
        if (provenance === undefined || validateProvenanceRecordV1(provenance).length > 0 || provenance.sealed !== true) {
            reasons.push("INVALID_PROVENANCE");
            continue;
        }
        episodes.push(episode);
        episodeProvenance.push(provenance);
    }
    if (episodes.length !== v.independentEpisodeRefs.length)
        return reasons;
    const provenanceByRoot = new Map();
    for (const item of context.provenance)
        if (!provenanceByRoot.has(item.rootDigest))
            provenanceByRoot.set(item.rootDigest, item);
    for (let i = 0; i < episodes.length; i += 1) {
        for (let j = i + 1; j < episodes.length; j += 1) {
            const a = episodeProvenance[i];
            const b = episodeProvenance[j];
            if (a.rootDigest === b.rootDigest || transitiveRoots(a, provenanceByRoot).has(b.rootDigest) || transitiveRoots(b, provenanceByRoot).has(a.rootDigest))
                reasons.push("INVALID_PROVENANCE");
        }
    }
    const episodeEvidence = v.independentEpisodeRefs.map((ref) => evidenceById.get(ref));
    if (new Set(episodes.map((item) => item.canonicalDigest)).size < 3)
        reasons.push("INVALID_DIVERSITY_PROOF");
    if (new Set(episodes.map((item) => item.fingerprintId)).size !== v.taskVariantIds.length
        || !episodes.every((item) => v.taskVariantIds.includes(item.fingerprintId)))
        reasons.push("INVALID_DIVERSITY_PROOF");
    const observedContexts = [...new Set(episodes.map((item) => item.contextShapeId))].sort();
    if (observedContexts.length < 2 || canonicalJson(observedContexts) !== canonicalJson(v.contextShapeIds.sort()))
        reasons.push("INVALID_DIVERSITY_PROOF");
    for (const axis of v.coveredVariantAxes) {
        const distinct = new Set(episodes.map((item) => {
            const raw = item[axis];
            return typeof raw === "string" ? raw : canonicalJson(raw);
        }));
        if (distinct.size < 2)
            reasons.push("INVALID_DIVERSITY_PROOF");
    }
    for (const episode of episodes) {
        const resolution = resolveTaskFamilyV1(episode, context.families);
        if (resolution.reason === "AMBIGUOUS_TASK_FAMILY")
            reasons.push("AMBIGUOUS_TASK_FAMILY");
    }
    for (const ref of v.contrastPairRefs) {
        const evidence = evidenceById.get(ref);
        if (evidence === undefined) {
            reasons.push("MISSING_EVIDENCE");
            continue;
        }
        if (validateEvidenceRecordV1(evidence).length > 0 || evidence.kind !== "CONTRAST_PAIR") {
            reasons.push("INVALID_DIVERSITY_PROOF");
            continue;
        }
        const provenance = provenanceById.get(evidence.provenanceRef);
        if (provenance === undefined || validateProvenanceRecordV1(provenance).length > 0 || provenance.sealed !== true)
            reasons.push("INVALID_PROVENANCE");
    }
    const holdout = new Set(context.holdoutEpisodeDigests);
    if (episodes.some((item) => holdout.has(item.canonicalDigest)) || episodeEvidence.some((item) => holdout.has(item.sourceDigest)))
        reasons.push("HOLDOUT_LEAKAGE");
    return reasons;
}
const PATTERN_FIELDS = ["patternId", "maturity", "taskFamilyIds", "applicabilityClauses", "preconditions", "procedureDigest", "expectedOutcomeDigest", "dependencyRefs", "evidenceRefs", "provenanceRefs", "knownFailureRefs", "counterexampleRefs", "counterevidenceAssessmentRef", "versionConstraintRefs", "canonicalDigest"];
const CANDIDATE_MATURITIES = ["S2", "S3", "S4", "S5", "S6"];
export function validateSolutionPatternV1(value) {
    if (!exact(value, PATTERN_FIELDS))
        return ["PROSE_ONLY_INPUT"];
    const v = value;
    if (!ckId(v.patternId) || !ckId(v.counterevidenceAssessmentRef))
        return ["PROSE_ONLY_INPUT"];
    if (!CANDIDATE_MATURITIES.includes(v.maturity))
        return ["PROSE_ONLY_INPUT"];
    if (!sortedSet(v.taskFamilyIds, ckId, 1, 8))
        return ["PROSE_ONLY_INPUT"];
    if (!Array.isArray(v.applicabilityClauses) || v.applicabilityClauses.length < 1 || v.applicabilityClauses.length > 16 || !v.applicabilityClauses.every(clause))
        return ["PROSE_ONLY_INPUT"];
    if (!Array.isArray(v.preconditions) || v.preconditions.length < 1 || v.preconditions.length > 16 || !v.preconditions.every(clause))
        return ["PROSE_ONLY_INPUT"];
    if (!ckDigest(v.procedureDigest) || !ckDigest(v.expectedOutcomeDigest))
        return ["PROSE_ONLY_INPUT"];
    if (!sortedSet(v.dependencyRefs, ckId, 0, 16) || !sortedSet(v.evidenceRefs, ckId, 1, 32))
        return ["PROSE_ONLY_INPUT"];
    if (!sortedSet(v.provenanceRefs, ckId, 1, 32) || !sortedSet(v.knownFailureRefs, ckId, 0, 32))
        return ["PROSE_ONLY_INPUT"];
    if (!sortedSet(v.counterexampleRefs, ckId, 0, 32) || !sortedSet(v.versionConstraintRefs, ckId, 0, 16))
        return ["PROSE_ONLY_INPUT"];
    if (!ckDigest(v.canonicalDigest) || v.canonicalDigest !== solutionPatternDigestV1(v))
        return ["PROSE_ONLY_INPUT"];
    return [];
}
export function isAdmittedEvidenceV1(evidence, provenanceById) {
    if (validateEvidenceRecordV1(evidence).length > 0)
        return false;
    const provenance = provenanceById.get(evidence.provenanceRef);
    return provenance !== undefined && provenance.sealed === true && validateProvenanceRecordV1(provenance).length === 0;
}
function pointerTokens(path) {
    if (path === "")
        return [];
    if (!path.startsWith("/"))
        return null;
    return path.slice(1).split("/").map((token) => token.replace(/~1/g, "/").replace(/~0/g, "~"));
}
function pointerValue(root, path) {
    const tokens = pointerTokens(path);
    if (tokens === null)
        return { found: false, value: undefined };
    let current = root;
    for (const token of tokens) {
        if (current === null || typeof current !== "object" || !Object.hasOwn(current, token))
            return { found: false, value: undefined };
        current = current[token];
    }
    return { found: true, value: current };
}
function sameJson(left, right) {
    try {
        return canonicalJson(left) === canonicalJson(right);
    }
    catch {
        return false;
    }
}
/** Evaluate one closed predicate. UNKNOWN is never treated as TRUE. */
export function evaluatePredicateV1(predicate, facts) {
    if (!clause(predicate))
        return { truth: "UNKNOWN", reason: "ILL_TYPED_OPERAND" };
    const resolved = pointerValue(facts, predicate.factPath);
    if (!resolved.found) {
        return predicate.operator === "EXISTS" ? { truth: "FALSE" } : { truth: "UNKNOWN", reason: "MISSING_FACT" };
    }
    switch (predicate.operator) {
        case "EXISTS":
            return { truth: "TRUE" };
        case "EQ":
            return { truth: sameJson(resolved.value, predicate.operand) ? "TRUE" : "FALSE" };
        case "IN": {
            if (!Array.isArray(predicate.operand))
                return { truth: "UNKNOWN", reason: "ILL_TYPED_OPERAND" };
            return { truth: predicate.operand.some((item) => sameJson(resolved.value, item)) ? "TRUE" : "FALSE" };
        }
        case "SET_CONTAINS_ALL": {
            if (!Array.isArray(resolved.value) || !Array.isArray(predicate.operand))
                return { truth: "UNKNOWN", reason: "ILL_TYPED_OPERAND" };
            const actualValues = resolved.value;
            const expectedValues = predicate.operand;
            return { truth: expectedValues.every((item) => actualValues.some((actual) => sameJson(actual, item))) ? "TRUE" : "FALSE" };
        }
        case "SET_DISJOINT": {
            if (!Array.isArray(resolved.value) || !Array.isArray(predicate.operand))
                return { truth: "UNKNOWN", reason: "ILL_TYPED_OPERAND" };
            const actualValues = resolved.value;
            const expectedValues = predicate.operand;
            return { truth: expectedValues.every((item) => !actualValues.some((actual) => sameJson(actual, item))) ? "TRUE" : "FALSE" };
        }
    }
}
export function resolveTaskFamilyV1(fingerprint, families) {
    if (validateTaskFingerprintV1(fingerprint).length > 0) {
        return { result: "DENIED", family: null, matchingFamilyIds: [], reason: "AMBIGUOUS_TASK_FAMILY" };
    }
    const matches = families.filter((family) => {
        if (validateTaskFamilyV1(family).length > 0)
            return false;
        const facts = fingerprint;
        const members = family.membershipClauses.every((item) => evaluatePredicateV1(item, facts).truth === "TRUE");
        const excluded = family.exclusionClauses.some((item) => evaluatePredicateV1(item, facts).truth === "TRUE");
        return members && !excluded;
    });
    const matchingFamilyIds = matches.map((item) => item.familyId).sort();
    return matchingFamilyIds.length === 1 && matchingFamilyIds[0] === fingerprint.taskFamilyId
        ? { result: "RESOLVED", family: matches[0], matchingFamilyIds }
        : { result: "DENIED", family: null, matchingFamilyIds, reason: "AMBIGUOUS_TASK_FAMILY" };
}
function admittedReferenceSet(refs, evidenceById, provenanceById) {
    for (const ref of refs) {
        const evidence = evidenceById.get(ref);
        if (evidence === undefined)
            return "MISSING_EVIDENCE";
        if (!isAdmittedEvidenceV1(evidence, provenanceById))
            return "INVALID_PROVENANCE";
    }
    return undefined;
}
function exactVersionCompatible(pattern, fingerprint, context, evidenceById, provenanceById) {
    const vectors = new Map(fingerprint.versionVector.map((entry) => [`${entry.componentId}\u0000${entry.versionScheme}`, entry.exactValue]));
    const constraints = new Map(context.versionConstraints.map((constraint) => [constraint.constraintId, constraint]));
    const constrainedKeys = new Set();
    for (const ref of pattern.versionConstraintRefs) {
        const constraint = constraints.get(ref);
        if (constraint === undefined || validateVersionConstraintV1(constraint).length > 0)
            return "VERSION_UNKNOWN";
        const evidenceReason = admittedReferenceSet(constraint.evidenceRefs, evidenceById, provenanceById);
        if (evidenceReason !== undefined)
            return "VERSION_UNKNOWN";
        const actual = vectors.get(`${constraint.componentId}\u0000${constraint.versionScheme}`);
        if (actual === undefined)
            return "VERSION_UNKNOWN";
        if (!constraint.allowedExactValues.includes(actual))
            return "VERSION_INCOMPATIBLE";
        constrainedKeys.add(`${constraint.componentId}\u0000${constraint.versionScheme}`);
    }
    if ([...vectors.keys()].some((key) => !constrainedKeys.has(key)))
        return "VERSION_UNKNOWN";
    return undefined;
}
/** Applicability-first, shadow-only evaluation. It never returns procedure content or authority. */
export function evaluateSolutionPatternV1(pattern, fingerprint, context) {
    const denied = (reason) => ({ result: "DENIED", reason, patternId: record(pattern) && typeof pattern.patternId === "string" ? pattern.patternId : "invalid" });
    if (validateSolutionPatternV1(pattern).length > 0)
        return denied("PROSE_ONLY_INPUT");
    if (validateTaskFingerprintV1(fingerprint).length > 0)
        return denied("PROSE_ONLY_INPUT");
    const evidenceById = new Map(context.evidence.map((item) => [item.evidenceId, item]));
    const provenanceById = new Map(context.provenance.map((item) => [item.provenanceId, item]));
    const referenceReason = admittedReferenceSet(pattern.evidenceRefs, evidenceById, provenanceById);
    if (referenceReason !== undefined)
        return denied(referenceReason);
    if (pattern.evidenceRefs.some((ref) => {
        const evidence = evidenceById.get(ref);
        return evidence !== undefined && !pattern.provenanceRefs.includes(evidence.provenanceRef);
    }))
        return denied("INVALID_PROVENANCE");
    for (const ref of pattern.provenanceRefs) {
        const provenance = provenanceById.get(ref);
        if (provenance === undefined || validateProvenanceRecordV1(provenance).length > 0)
            return denied("INVALID_PROVENANCE");
        if (!provenance.sealed)
            return denied("UNSEALED_HOLDOUT");
    }
    const resolution = resolveTaskFamilyV1(fingerprint, context.families);
    if (resolution.result !== "RESOLVED")
        return denied("AMBIGUOUS_TASK_FAMILY");
    if (!pattern.taskFamilyIds.includes(resolution.family?.familyId ?? ""))
        return denied("FAMILY_MISMATCH");
    const facts = fingerprint;
    for (const predicate of pattern.applicabilityClauses) {
        const evaluated = evaluatePredicateV1(predicate, facts);
        if (evaluated.truth === "FALSE")
            return denied("AMBIGUOUS_APPLICABILITY");
        if (evaluated.truth === "UNKNOWN")
            return denied("AMBIGUOUS_APPLICABILITY");
    }
    for (const predicate of pattern.preconditions) {
        const evaluated = evaluatePredicateV1(predicate, facts);
        if (evaluated.truth === "FALSE")
            return denied("PRECONDITION_FALSE");
        if (evaluated.truth === "UNKNOWN")
            return denied("PRECONDITION_UNKNOWN");
    }
    const dependencies = new Map(context.dependencies.map((item) => [item.dependencyId, item]));
    for (const ref of pattern.dependencyRefs) {
        const dependency = dependencies.get(ref);
        if (dependency === undefined)
            return denied("DEPENDENCY_MISSING");
        if (validateDependencyRecordV1(dependency).length > 0)
            return denied("DEPENDENCY_UNVERIFIED");
        if (!pattern.versionConstraintRefs.includes(dependency.versionConstraintRef))
            return denied("VERSION_UNKNOWN");
        if (context.dependencyStateDigests?.get(ref) !== dependency.requiredStateDigest)
            return denied("DEPENDENCY_UNVERIFIED");
        const verification = evidenceById.get(dependency.verificationEvidenceRef);
        if (verification === undefined || !isAdmittedEvidenceV1(verification, provenanceById))
            return denied("DEPENDENCY_UNVERIFIED");
    }
    const versionReason = exactVersionCompatible(pattern, fingerprint, context, evidenceById, provenanceById);
    if (versionReason !== undefined)
        return denied(versionReason);
    for (const ref of pattern.knownFailureRefs) {
        const failure = context.knownFailures.find((item) => item.failureId === ref);
        if (failure === undefined || validateKnownFailureRecordV1(failure).length > 0)
            return denied("MATCHED_KNOWN_FAILURE");
        if (failure.patternId !== pattern.patternId)
            return denied("PROSE_ONLY_INPUT");
        const failureEvidence = evidenceById.get(failure.evidenceRef);
        if (failureEvidence === undefined || failureEvidence.taskFingerprintDigest !== failure.taskFingerprintDigest
            || failureEvidence.provenanceRef !== failure.provenanceRef)
            return denied("INVALID_PROVENANCE");
        if (admittedReferenceSet([failure.evidenceRef], evidenceById, provenanceById) !== undefined)
            return denied("INVALID_PROVENANCE");
        const failureProvenance = provenanceById.get(failure.provenanceRef);
        if (failureProvenance === undefined || validateProvenanceRecordV1(failureProvenance).length > 0 || !failureProvenance.sealed)
            return denied("INVALID_PROVENANCE");
        if (failure.resolution === "OPEN" || failure.resolution === "INVALIDATES_PATTERN")
            return denied("UNRESOLVED_FAILURE");
        if (failure.taskFingerprintDigest === fingerprint.canonicalDigest)
            return denied("MATCHED_KNOWN_FAILURE");
    }
    for (const ref of pattern.counterexampleRefs) {
        const counterexample = context.counterexamples.find((item) => item.counterexampleId === ref);
        if (counterexample === undefined || validateCounterexampleRecordV1(counterexample).length > 0)
            return denied("MATCHED_COUNTEREXAMPLE");
        if (counterexample.patternId !== pattern.patternId)
            return denied("PROSE_ONLY_INPUT");
        const counterexampleEvidence = evidenceById.get(counterexample.evidenceRef);
        if (counterexampleEvidence === undefined || counterexampleEvidence.taskFingerprintDigest !== counterexample.taskFingerprintDigest
            || counterexampleEvidence.provenanceRef !== counterexample.provenanceRef)
            return denied("INVALID_PROVENANCE");
        if (admittedReferenceSet([counterexample.evidenceRef], evidenceById, provenanceById) !== undefined)
            return denied("INVALID_PROVENANCE");
        const counterexampleProvenance = provenanceById.get(counterexample.provenanceRef);
        if (counterexampleProvenance === undefined || validateProvenanceRecordV1(counterexampleProvenance).length > 0 || !counterexampleProvenance.sealed)
            return denied("INVALID_PROVENANCE");
        if (counterexample.taskFingerprintDigest === fingerprint.canonicalDigest)
            return denied("MATCHED_COUNTEREXAMPLE");
    }
    const assessment = context.assessments.find((item) => item.assessmentId === pattern.counterevidenceAssessmentRef);
    if (assessment === undefined || validateCounterevidenceAssessmentV1(assessment).length > 0 || assessment.coverageStatus !== "COMPLETE")
        return denied("ABSENT_COUNTEREVIDENCE");
    if (admittedReferenceSet(assessment.searchEvidenceRefs, evidenceById, provenanceById) !== undefined
        || admittedReferenceSet(assessment.negativeControlRefs, evidenceById, provenanceById) !== undefined)
        return denied("ABSENT_COUNTEREVIDENCE");
    if (canonicalJson(assessment.knownFailureRefs) !== canonicalJson(pattern.knownFailureRefs)
        || canonicalJson(assessment.counterexampleRefs) !== canonicalJson(pattern.counterexampleRefs))
        return denied("ABSENT_COUNTEREVIDENCE");
    if (assessment.knownFailureRefs.some((ref) => !context.knownFailures.some((item) => item.failureId === ref))
        || assessment.counterexampleRefs.some((ref) => !context.counterexamples.some((item) => item.counterexampleId === ref)))
        return denied("ABSENT_COUNTEREVIDENCE");
    if (maturityRankV1(pattern.maturity) < maturityRankV1("S3"))
        return denied("INSUFFICIENT_MATURITY");
    const matchingProofs = context.diversityProofs.filter((proof) => proof.patternId === pattern.patternId);
    if (matchingProofs.length !== 1)
        return denied("INVALID_DIVERSITY_PROOF");
    const proofReasons = validateDiversityProofV1(matchingProofs[0], {
        evidence: context.evidence,
        provenance: context.provenance,
        families: context.families,
        episodes: context.episodes,
        holdoutEpisodeDigests: context.holdoutEpisodeDigests,
    });
    if (proofReasons.length > 0)
        return denied(proofReasons[0] ?? "INVALID_DIVERSITY_PROOF");
    return { result: "APPLICABLE_SHADOW_ONLY", patternId: pattern.patternId };
}
export const evaluateSolutionPatternApplicabilityV1 = evaluateSolutionPatternV1;
export function validateSolutionPatternTransitionV1(previous, next) {
    if (validateSolutionPatternV1(previous).length > 0 || validateSolutionPatternV1(next).length > 0 || previous.patternId !== next.patternId)
        return ["PROSE_ONLY_INPUT"];
    if (maturityRankV1(next.maturity) < maturityRankV1(previous.maturity)
        || next.counterevidenceAssessmentRef !== previous.counterevidenceAssessmentRef)
        return ["PROSE_ONLY_INPUT"];
    const preserved = ["dependencyRefs", "evidenceRefs", "provenanceRefs", "knownFailureRefs", "counterexampleRefs", "versionConstraintRefs"];
    return preserved.every((field) => previous[field].every((ref) => next[field].includes(ref))) ? [] : ["PROSE_ONLY_INPUT"];
}
