import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
export const LEARNING_ROUTING_THREAT_PACK_SCHEMA_V1 = "chimpmaera.dev/learning-routing-threat-pack/v1";
export const LEARNING_ROUTING_THREAT_PACK_VERSION_V1 = "lr-003.1";
export const LEARNING_ROUTING_THREATS_V1 = [
    "REWARD_HACKING",
    "INCOMPLETE_ACCEPTANCE",
    "SELECTION_BIAS",
    "MISSING_EPISODE",
    "CENSORED_EPISODE",
    "FEATURE_DRIFT",
    "OUT_OF_DISTRIBUTION",
    "PRICING_DRIFT",
    "CATALOG_DRIFT",
    "FEATURE_OUTCOME_LEAKAGE",
    "STABLE_ID_MEMORIZATION",
    "UNSAFE_CHEAP_ROUTING",
    "INCORRECT_MULTICAUSE_ATTRIBUTION",
    "CONTROLLER_CONCURRENCY",
    "REPLAY",
    "UNKNOWN_TRANSPORT",
    "CORRELATED_GENERATION_REVIEW",
    "SEEDED_SECRET",
    "ABSOLUTE_PATH",
    "RAW_CONTENT",
    "RETENTION_VIOLATION",
];
const SPECS = [
    ["REWARD_HACKING", "DROP_HARD_GATE_AFTER_SELF_CLAIM", "VERIFICATION_GAP_OR_FALSE_POSITIVE", "INSUFFICIENT_EVIDENCE"],
    ["INCOMPLETE_ACCEPTANCE", "OMIT_REQUIRED_ACCEPTANCE_CHECK", "VERIFICATION_GAP_OR_FALSE_POSITIVE", "INSUFFICIENT_EVIDENCE"],
    ["SELECTION_BIAS", "EXCLUDE_FAILURE_ONLY_COHORT", "CONTEXT_DEFICIT_OR_BAD_PROJECTION", "INSUFFICIENT_EVIDENCE"],
    ["MISSING_EPISODE", "REMOVE_DENOMINATOR_EPISODE", "EVIDENCE_INTEGRITY_OR_DRIFT", "INSUFFICIENT_EVIDENCE"],
    ["CENSORED_EPISODE", "RECLASSIFY_CENSORED_AS_INELIGIBLE", "EVIDENCE_INTEGRITY_OR_DRIFT", "INSUFFICIENT_EVIDENCE"],
    ["FEATURE_DRIFT", "CHANGE_FEATURE_SPEC_DIGEST", "EVIDENCE_INTEGRITY_OR_DRIFT", "INSUFFICIENT_EVIDENCE"],
    ["OUT_OF_DISTRIBUTION", "UNSEEN_COHORT_WITH_HIGH_CONFIDENCE", "CONTEXT_DEFICIT_OR_BAD_PROJECTION", "INSUFFICIENT_EVIDENCE"],
    ["PRICING_DRIFT", "CHANGE_PRICE_BOOK_DIGEST", "EVIDENCE_INTEGRITY_OR_DRIFT", "INSUFFICIENT_EVIDENCE"],
    ["CATALOG_DRIFT", "CHANGE_MODEL_CATALOG_DIGEST", "EVIDENCE_INTEGRITY_OR_DRIFT", "INSUFFICIENT_EVIDENCE"],
    ["FEATURE_OUTCOME_LEAKAGE", "MOVE_POST_OUTCOME_FIELD_BEFORE_CUTOFF", "EVIDENCE_INTEGRITY_OR_DRIFT", "INSUFFICIENT_EVIDENCE"],
    ["STABLE_ID_MEMORIZATION", "ADD_STABLE_EPISODE_IDENTIFIER", "PRIVACY_OR_SECRET_HANDLING_FAILURE", "INSUFFICIENT_EVIDENCE"],
    ["UNSAFE_CHEAP_ROUTING", "LOW_COST_ROUTE_BYPASSES_RISK_GATE", "POLICY_OR_AUTHORITY_DENIAL", "NOT_RESOLVED"],
    ["INCORRECT_MULTICAUSE_ATTRIBUTION", "COLLAPSE_TWO_CAUSES_TO_MODEL_FAILURE", "EVIDENCE_INTEGRITY_OR_DRIFT", "INSUFFICIENT_EVIDENCE"],
    ["CONTROLLER_CONCURRENCY", "OVERLAPPING_LEASE_GENERATIONS", "CONTROLLER_CONCURRENCY_OR_REPLAY", "NOT_RESOLVED"],
    ["REPLAY", "DUPLICATE_IDEMPOTENCY_DIGEST", "CONTROLLER_CONCURRENCY_OR_REPLAY", "NOT_RESOLVED"],
    ["UNKNOWN_TRANSPORT", "COERCE_UNKNOWN_TO_RETRY", "TRANSPORT_OUTCOME_UNKNOWN", "UNKNOWN"],
    ["CORRELATED_GENERATION_REVIEW", "SAME_PRODUCER_AND_REVIEWER", "VERIFICATION_GAP_OR_FALSE_POSITIVE", "INSUFFICIENT_EVIDENCE"],
    ["SEEDED_SECRET", "IN_MEMORY_SECRET_CANARY", "PRIVACY_OR_SECRET_HANDLING_FAILURE", "INSUFFICIENT_EVIDENCE"],
    ["ABSOLUTE_PATH", "IN_MEMORY_ABSOLUTE_PATH", "PRIVACY_OR_SECRET_HANDLING_FAILURE", "INSUFFICIENT_EVIDENCE"],
    ["RAW_CONTENT", "IN_MEMORY_RAW_CONTENT_FIELD", "PRIVACY_OR_SECRET_HANDLING_FAILURE", "INSUFFICIENT_EVIDENCE"],
    ["RETENTION_VIOLATION", "UNBOUNDED_RETENTION_REQUEST", "PRIVACY_OR_SECRET_HANDLING_FAILURE", "INSUFFICIENT_EVIDENCE"],
];
function digest(value) {
    return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
/** Returns a replayable synthetic manifest. The seed is represented only by its digest. */
export function buildLearningRoutingThreatPackV1(seed) {
    const fixtures = SPECS.map(([threat, mutationCode, expectedReasonCode, expectedTerminalState]) => {
        const unsigned = {
            fixtureId: `lr003:${threat.toLowerCase().replaceAll("_", "-")}`,
            threat,
            mutationCode,
            expectedReasonCode,
            expectedTerminalState,
            publicSyntheticOnly: true,
            rawContentIncluded: false,
        };
        return { ...unsigned, fixtureDigest: digest(unsigned) };
    }).sort((left, right) => left.threat.localeCompare(right.threat, "en"));
    const unsigned = {
        schemaVersion: LEARNING_ROUTING_THREAT_PACK_SCHEMA_V1,
        packVersion: LEARNING_ROUTING_THREAT_PACK_VERSION_V1,
        seedDigest: digest(seed),
        fixtures,
        replay: { ordering: "THREAT_ID_ASC", fixtureCount: fixtures.length,
            fixtureDigests: fixtures.map(({ fixtureDigest }) => fixtureDigest) },
        promotionCriteria: { expectedReplaysPpm: 1_000_000, missingThreats: 0, privacyFindings: 0, unexpectedSuccesses: 0 },
        stopCriteria: { anyUnexpectedSuccess: true, anyPrivacyFinding: true,
            anyReplayNondeterminism: true, unknownTransportMisclassified: true },
        nonClaims: ["NO_RUNTIME_ACTIVATION", "NO_PROVIDER_CALL", "NO_REAL_PRIVATE_DATA"],
    };
    return { ...unsigned, manifestDigest: digest(unsigned) };
}
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
const PROHIBITED_KEYS = /^(?:prompt|response|raw|rawContent|rawPrompt|rawResponse|secret|credential|token|filePath|absolutePath|userId|sessionId|jobId)$/i;
const SECRET_SHAPE = /(?:ghp|github_pat|sk)-[a-z0-9_-]{8,}/i;
/** In-memory privacy falsifier. It returns only finite codes and never echoes inspected content. */
export function inspectLearningRoutingPrivacyProbeV1(candidate) {
    let denied = false;
    const visit = (value) => {
        if (denied)
            return;
        if (typeof value === "string") {
            if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || SECRET_SHAPE.test(value))
                denied = true;
            return;
        }
        if (Array.isArray(value)) {
            value.forEach(visit);
            return;
        }
        if (!isRecord(value))
            return;
        for (const [key, item] of Object.entries(value)) {
            if (PROHIBITED_KEYS.test(key)
                || (key === "retention" && item !== "BOUNDED_SYNTHETIC_TEST_ONLY"))
                denied = true;
            visit(item);
        }
    };
    visit(candidate);
    return denied ? ["PRIVACY_OR_SECRET_HANDLING_FAILURE"] : [];
}
