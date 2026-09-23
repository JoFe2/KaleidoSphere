import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
export const ROUTING_CONTEXT_SCHEMA_V1 = "chimpmaera.dev/routing-context/v1";
export const ROUTING_DECISION_SCHEMA_V1 = "chimpmaera.dev/routing-decision/v1";
export const ROUTING_ATTEMPT_SCHEMA_V1 = "chimpmaera.dev/routing-attempt/v1";
export const ROUTING_OUTCOME_SCHEMA_V1 = "chimpmaera.dev/routing-outcome/v1";
export const LEARNING_ROUTING_CLAIM_BOUNDARY_V1 = "LOCAL_SYNTHETIC_NO_ROUTING_ACTIVATION";
export const LEARNING_ROUTING_NON_CLAIMS_V1 = [
    "NO_ROUTE_EXECUTION",
    "NO_AUTHORITY_GRANT",
    "NO_PROVIDER_CALL",
    "NO_PRODUCTION_ACTIVATION",
    "NO_TRAINING_INGESTION",
];
export const LEARNING_ROUTING_WORKFLOWS_V1 = [
    "DIRECT",
    "PLAN_FIRST",
    "SCOUT_FIRST",
    "REPRODUCE_FIRST",
    "DECOMPOSE",
    "SECURITY_REVIEW",
];
export const LEARNING_ROUTING_MODEL_ALIASES_V1 = [
    "cm.dev.fast",
    "cm.dev.primary",
    "cm.dev.review",
    "cm.dev.escalate",
];
export const LEARNING_ROUTING_THINKING_PROFILES_V1 = [
    "MINIMAL",
    "STANDARD",
    "DEEP",
];
export const LEARNING_ROUTING_CONTEXT_PROFILES_V1 = [
    "ISSUE_ONLY",
    "ISSUE_AND_BASE",
    "TARGETED_REPOSITORY",
];
export const LEARNING_ROUTING_VERIFIER_PROFILES_V1 = [
    "CONTRACT_ONLY",
    "STANDARD",
    "SECURITY",
];
export const LEARNING_ROUTING_RECOVERY_ACTIONS_V1 = [
    "INITIAL",
    "REFLECT",
    "REPLAN",
    "SCOUT",
    "REPRODUCE",
    "ESCALATE",
    "HUMAN_REVIEW",
];
export const LEARNING_ROUTING_REASON_CODES_V1 = [
    "MODEL_CAPABILITY_LIMIT",
    "THINKING_OR_OUTPUT_PROFILE_MISMATCH",
    "WORKFLOW_STRATEGY_MISMATCH",
    "LOCAL_IMPLEMENTATION_DEFECT",
    "CONTEXT_DEFICIT_OR_BAD_PROJECTION",
    "ISSUE_SPECIFICATION_GAP",
    "TOOL_OR_ENVIRONMENT_FAILURE",
    "VERIFICATION_GAP_OR_FALSE_POSITIVE",
    "POLICY_OR_AUTHORITY_DENIAL",
    "TRANSPORT_OUTCOME_UNKNOWN",
    "CONTROLLER_CONCURRENCY_OR_REPLAY",
    "EVIDENCE_INTEGRITY_OR_DRIFT",
    "PRIVACY_OR_SECRET_HANDLING_FAILURE",
    "OWNER_CANCELLED",
];
function recordDigest(value, digestField) {
    const unsigned = Object.fromEntries(Object.entries(value).filter(([key]) => key !== digestField));
    return createHash("sha256").update(canonicalJson(unsigned), "utf8").digest("hex");
}
export function routingContextDigestV1(value) {
    return recordDigest(value, "contextDigest");
}
export function routingDecisionDigestV1(value) {
    return recordDigest(value, "decisionDigest");
}
export function routingAttemptDigestV1(value) {
    return recordDigest(value, "attemptDigest");
}
export function routingOutcomeDigestV1(value) {
    return recordDigest(value, "outcomeDigest");
}
export function hasValidRoutingContextDigestV1(value) {
    return routingContextDigestV1(value) === value.contextDigest;
}
export function hasValidRoutingDecisionDigestV1(value) {
    return routingDecisionDigestV1(value) === value.decisionDigest;
}
export function hasValidRoutingAttemptDigestV1(value) {
    return routingAttemptDigestV1(value) === value.attemptDigest;
}
export function hasValidRoutingOutcomeDigestV1(value) {
    return routingOutcomeDigestV1(value) === value.outcomeDigest;
}
/** Pure lineage check only; it cannot execute a route or grant authority. */
export function hasValidLearningRoutingLineageV1(context, decisions, attempts, outcome) {
    if (!hasValidRoutingContextDigestV1(context)
        || !hasValidRoutingOutcomeDigestV1(outcome)
        || outcome.episodePseudonym !== context.episodePseudonym
        || outcome.contextDigest !== context.contextDigest
        || outcome.acceptanceSnapshotDigest !== context.snapshotDigests.acceptance)
        return false;
    const decisionDigests = new Set();
    for (const decision of decisions) {
        if (!hasValidRoutingDecisionDigestV1(decision)
            || decision.episodePseudonym !== context.episodePseudonym
            || decision.contextDigest !== context.contextDigest
            || decisionDigests.has(decision.decisionDigest))
            return false;
        decisionDigests.add(decision.decisionDigest);
    }
    if (canonicalJson([...decisionDigests].sort()) !== canonicalJson([...outcome.decisionDigests].sort()))
        return false;
    const attemptDigests = new Set();
    for (const attempt of attempts) {
        if (!hasValidRoutingAttemptDigestV1(attempt)
            || attempt.episodePseudonym !== context.episodePseudonym
            || !decisionDigests.has(attempt.decisionDigest)
            || attemptDigests.has(attempt.attemptDigest))
            return false;
        attemptDigests.add(attempt.attemptDigest);
    }
    for (const attempt of attempts) {
        if (attempt.parentAttemptDigest !== null && !attemptDigests.has(attempt.parentAttemptDigest))
            return false;
    }
    return canonicalJson([...attemptDigests].sort()) === canonicalJson([...outcome.attemptDigests].sort());
}
