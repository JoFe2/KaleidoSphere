import { appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import { LEARNING_ROUTING_CLAIM_BOUNDARY_V1, LEARNING_ROUTING_MODEL_ALIASES_V1, LEARNING_ROUTING_NON_CLAIMS_V1, LEARNING_ROUTING_THINKING_PROFILES_V1, LEARNING_ROUTING_WORKFLOWS_V1, ROUTING_CONTEXT_SCHEMA_V1, hasValidRoutingContextDigestV1, } from "./learning-routing.js";
export const LEARNING_ROUTING_RECOMMENDATION_SCHEMA_V1 = "chimpmaera.dev/learning-routing-recommendation/v1";
export const LEARNING_ROUTING_RECOMMENDATION_RECORD_SCHEMA_V1 = "chimpmaera.dev/learning-routing-recommendation-record/v1";
export const LEARNING_ROUTING_RECOMMENDATION_REASON_CODES_V1 = [
    "PUBLIC_LOW_RISK_DIRECT",
    "CONTRACT_OR_SCHEMA_PLAN_FIRST",
    "SECURITY_REVIEW_REQUIRED",
    "STATIC_CONSERVATIVE_DEFAULT",
    "PRIVACY_BOUNDARY_DENIAL",
    "AUTHORITY_BOUNDARY_DENIAL",
    "MISSING_EVIDENCE",
    "UNKNOWN_EVIDENCE",
    "INVALID_CONTEXT",
    "MODEL_ALIAS_UNAVAILABLE",
];
const FALLBACK = {
    modelAlias: "cm.dev.primary",
    thinkingProfile: "STANDARD",
    workflow: "PLAN_FIRST",
    reasonCode: "STATIC_CONSERVATIVE_DEFAULT",
};
const CONTEXT_KEYS = [
    "schemaVersion", "episodePseudonym", "snapshotDigests", "cohort", "assessments",
    "observedAtMs", "featureCutoffMs", "featureSpecDigest", "claimBoundary", "nonClaims", "contextDigest",
];
const SNAPSHOT_KEYS = ["issue", "base", "projection", "acceptance", "toolchain"];
const COHORT_KEYS = [
    "issueKind", "languageFamily", "packageFamily", "allowedFileCountBin", "projectionBytesBin",
    "pathClasses", "hasReproduction", "acceptanceCriteriaPresent", "testProfileKnown",
    "dependencyRelevant", "schemaRelevant", "contractRelevant", "publicManifestRelevant",
];
const ASSESSMENT_KEYS = ["complexity", "confidence", "risk", "dataClass", "explorationAllowed"];
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function hasOnlyKeys(value, expected) {
    const actual = Object.keys(value).sort();
    const allowed = [...expected].sort();
    return actual.length === allowed.length && actual.every((key, index) => key === allowed[index]);
}
function isDigest(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function isEnum(value, values) {
    return typeof value === "string" && values.includes(value);
}
function isClosedPublicContext(value) {
    if (!isRecord(value) || !hasOnlyKeys(value, CONTEXT_KEYS)
        || value.schemaVersion !== ROUTING_CONTEXT_SCHEMA_V1
        || value.claimBoundary !== LEARNING_ROUTING_CLAIM_BOUNDARY_V1
        || typeof value.episodePseudonym !== "string" || !/^ep_[a-z0-9]{32,64}$/.test(value.episodePseudonym)
        || !isDigest(value.featureSpecDigest) || !isDigest(value.contextDigest)
        || !Number.isSafeInteger(value.observedAtMs) || !Number.isSafeInteger(value.featureCutoffMs)
        || !Array.isArray(value.nonClaims)
        || canonicalJson(value.nonClaims) !== canonicalJson(LEARNING_ROUTING_NON_CLAIMS_V1)
        || !isRecord(value.snapshotDigests) || !hasOnlyKeys(value.snapshotDigests, SNAPSHOT_KEYS)
        || !SNAPSHOT_KEYS.every((key) => isDigest(value.snapshotDigests[key]))
        || !isRecord(value.cohort) || !hasOnlyKeys(value.cohort, COHORT_KEYS)
        || !isRecord(value.assessments) || !hasOnlyKeys(value.assessments, ASSESSMENT_KEYS))
        return false;
    const cohort = value.cohort;
    const assessments = value.assessments;
    const booleans = [
        cohort.hasReproduction, cohort.acceptanceCriteriaPresent, cohort.testProfileKnown,
        cohort.dependencyRelevant, cohort.schemaRelevant, cohort.contractRelevant, cohort.publicManifestRelevant,
        assessments.explorationAllowed,
    ];
    if (!booleans.every((candidate) => typeof candidate === "boolean")
        || !isEnum(cohort.issueKind, ["BUG", "FEATURE", "DOCS", "TEST", "REFACTOR", "SECURITY", "EPIC_OR_UNFROZEN"])
        || !isEnum(cohort.languageFamily, ["TYPESCRIPT", "JAVASCRIPT", "PYTHON", "SHELL", "MARKDOWN", "MIXED", "OTHER"])
        || !isEnum(cohort.packageFamily, ["CONTRACTS", "CONTROLLER", "WORKER", "VERIFICATION", "DEMO", "DOCS", "OTHER"])
        || !isEnum(cohort.allowedFileCountBin, ["ONE", "TWO_TO_FIVE", "SIX_TO_TWENTY", "OVER_TWENTY"])
        || !isEnum(cohort.projectionBytesBin, ["UP_TO_32K", "UP_TO_128K", "UP_TO_512K", "OVER_512K"])
        || !Array.isArray(cohort.pathClasses)
        || !cohort.pathClasses.every((item) => isEnum(item, ["DOCS", "TEST", "RUNTIME", "POLICY", "SECURITY", "RELEASE"]))
        || !isEnum(assessments.complexity, ["LOW", "MEDIUM", "HIGH", "UNFROZEN"])
        || !isEnum(assessments.confidence, ["LOW", "MEDIUM", "HIGH"])
        || !isEnum(assessments.risk, ["LOW", "MEDIUM", "HIGH", "CRITICAL"])
        || assessments.dataClass !== "PUBLIC_OSS")
        return false;
    return hasValidRoutingContextDigestV1(value);
}
function recommendationDigest(value) {
    return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
function result(contextDigest, disposition, route, confidence, reasonCodes) {
    const unsigned = {
        schemaVersion: LEARNING_ROUTING_RECOMMENDATION_SCHEMA_V1,
        disposition,
        authority: "ADVISORY_ONLY",
        contextDigest,
        route,
        confidence,
        reasonCodes,
        fallback: FALLBACK,
    };
    return { ...unsigned, recommendationDigest: recommendationDigest(unsigned) };
}
function fallback(reasonCodes, contextDigest = null) {
    return result(contextDigest, "STATIC_FALLBACK", FALLBACK, { band: "LOW", supportingSampleCount: 0 }, reasonCodes);
}
/** Pure advisory function. It never executes a route, grants authority, or calls a provider. */
export function recommendLearningRouteV1(candidate) {
    if (!isRecord(candidate) || !hasOnlyKeys(candidate, ["context", "authority", "evidence", "availableModelAliases"])) {
        return fallback(["INVALID_CONTEXT"]);
    }
    if (candidate.authority !== "ADVISORY_ONLY")
        return fallback(["AUTHORITY_BOUNDARY_DENIAL"]);
    if (!isClosedPublicContext(candidate.context))
        return fallback(["PRIVACY_BOUNDARY_DENIAL", "INVALID_CONTEXT"]);
    const context = candidate.context;
    if (!isRecord(candidate.evidence)
        || !hasOnlyKeys(candidate.evidence, ["state", "sourceDigest", "supportingSampleCount"])) {
        return fallback(["MISSING_EVIDENCE"], context.contextDigest);
    }
    const evidence = candidate.evidence;
    if (evidence.state === "MISSING")
        return fallback(["MISSING_EVIDENCE"], context.contextDigest);
    if (evidence.state !== "VERIFIED_PUBLIC")
        return fallback(["UNKNOWN_EVIDENCE"], context.contextDigest);
    if (!isDigest(evidence.sourceDigest)
        || !Number.isSafeInteger(evidence.supportingSampleCount)
        || evidence.supportingSampleCount < 0) {
        return fallback(["MISSING_EVIDENCE"], context.contextDigest);
    }
    if (!Array.isArray(candidate.availableModelAliases)
        || new Set(candidate.availableModelAliases).size !== candidate.availableModelAliases.length
        || !candidate.availableModelAliases.every((alias) => isEnum(alias, LEARNING_ROUTING_MODEL_ALIASES_V1))) {
        return fallback(["MODEL_ALIAS_UNAVAILABLE"], context.contextDigest);
    }
    const supportingSampleCount = evidence.supportingSampleCount;
    let route = FALLBACK;
    let reason = "STATIC_CONSERVATIVE_DEFAULT";
    const securityRelevant = context.assessments.risk === "HIGH" || context.assessments.risk === "CRITICAL"
        || context.cohort.issueKind === "SECURITY" || context.cohort.pathClasses.includes("SECURITY");
    if (securityRelevant) {
        route = { modelAlias: "cm.dev.review", thinkingProfile: "DEEP", workflow: "SECURITY_REVIEW" };
        reason = "SECURITY_REVIEW_REQUIRED";
    }
    else if (context.assessments.risk === "LOW" && context.assessments.complexity === "LOW"
        && context.cohort.acceptanceCriteriaPresent && context.cohort.testProfileKnown) {
        route = { modelAlias: "cm.dev.fast", thinkingProfile: "MINIMAL", workflow: "DIRECT" };
        reason = "PUBLIC_LOW_RISK_DIRECT";
    }
    else if (context.cohort.contractRelevant || context.cohort.schemaRelevant) {
        route = { modelAlias: "cm.dev.primary", thinkingProfile: "STANDARD", workflow: "PLAN_FIRST" };
        reason = "CONTRACT_OR_SCHEMA_PLAN_FIRST";
    }
    if (!candidate.availableModelAliases.includes(route.modelAlias)) {
        return fallback(["MODEL_ALIAS_UNAVAILABLE", reason], context.contextDigest);
    }
    return result(context.contextDigest, "RECOMMENDATION", route, { band: supportingSampleCount >= 5 ? "MEDIUM" : "LOW", supportingSampleCount }, [reason]);
}
function hasValidRecommendation(value) {
    if (!isRecord(value)
        || !hasOnlyKeys(value, [
            "schemaVersion", "disposition", "authority", "contextDigest", "route", "confidence",
            "reasonCodes", "fallback", "recommendationDigest",
        ])
        || value.schemaVersion !== LEARNING_ROUTING_RECOMMENDATION_SCHEMA_V1
        || !isEnum(value.disposition, ["RECOMMENDATION", "STATIC_FALLBACK"])
        || value.authority !== "ADVISORY_ONLY"
        || (value.contextDigest !== null && !isDigest(value.contextDigest))
        || !isRecord(value.route) || !hasOnlyKeys(value.route, ["modelAlias", "thinkingProfile", "workflow"])
        || !isEnum(value.route.modelAlias, LEARNING_ROUTING_MODEL_ALIASES_V1)
        || !isEnum(value.route.thinkingProfile, LEARNING_ROUTING_THINKING_PROFILES_V1)
        || !isEnum(value.route.workflow, LEARNING_ROUTING_WORKFLOWS_V1)
        || !isRecord(value.confidence) || !hasOnlyKeys(value.confidence, ["band", "supportingSampleCount"])
        || !isEnum(value.confidence.band, ["LOW", "MEDIUM"])
        || !Number.isSafeInteger(value.confidence.supportingSampleCount)
        || value.confidence.supportingSampleCount < 0
        || !Array.isArray(value.reasonCodes) || value.reasonCodes.length === 0
        || new Set(value.reasonCodes).size !== value.reasonCodes.length
        || !value.reasonCodes.every((code) => isEnum(code, LEARNING_ROUTING_RECOMMENDATION_REASON_CODES_V1))
        || !isRecord(value.fallback) || !hasOnlyKeys(value.fallback, ["modelAlias", "thinkingProfile", "workflow", "reasonCode"])
        || canonicalJson(value.fallback) !== canonicalJson(FALLBACK)
        || !isDigest(value.recommendationDigest))
        return false;
    const { recommendationDigest: digest, ...unsigned } = value;
    return recommendationDigest(unsigned) === digest;
}
/** Append-only local NDJSON recorder. Omitted `enabled` means no filesystem access. */
export function recordLearningRoutingRecommendationV1(recommendation, options = {}) {
    if (options.enabled !== true)
        return { status: "DISABLED", reasonCode: "RECORDER_DISABLED", recordDigest: null };
    if (!hasValidRecommendation(recommendation))
        return { status: "DENIED", reasonCode: "INVALID_RECORD", recordDigest: null };
    if (typeof options.outputFile !== "string" || options.outputFile.length === 0) {
        return { status: "DENIED", reasonCode: "OUTPUT_NOT_CONFIGURED", recordDigest: null };
    }
    const recordedAtMs = options.recordedAtMs;
    if (!Number.isSafeInteger(recordedAtMs) || recordedAtMs < 0) {
        return { status: "DENIED", reasonCode: "INVALID_RECORD", recordDigest: null };
    }
    const unsigned = {
        schemaVersion: LEARNING_ROUTING_RECOMMENDATION_RECORD_SCHEMA_V1,
        recordedAtMs: recordedAtMs,
        recommendation,
    };
    const recordDigest = createHash("sha256").update(canonicalJson(unsigned), "utf8").digest("hex");
    appendFileSync(options.outputFile, `${canonicalJson({ ...unsigned, recordDigest })}\n`, { encoding: "utf8", mode: 0o600 });
    return { status: "RECORDED", reasonCode: "RECORDED", recordDigest };
}
