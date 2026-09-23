import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import { LEARNING_ROUTING_CLAIM_BOUNDARY_V1, LEARNING_ROUTING_NON_CLAIMS_V1, ROUTING_OUTCOME_SCHEMA_V1, hasValidRoutingAttemptDigestV1, hasValidRoutingContextDigestV1, hasValidRoutingDecisionDigestV1, routingOutcomeDigestV1, } from "./learning-routing.js";
export const ROUTING_OUTCOME_ADAPTER_VERSION_V1 = "lr-002.1";
const REASON_ORDER = [
    "PRIVACY_OR_SECRET_HANDLING_FAILURE",
    "CONTROLLER_CONCURRENCY_OR_REPLAY",
    "TRANSPORT_OUTCOME_UNKNOWN",
    "EVIDENCE_INTEGRITY_OR_DRIFT",
    "VERIFICATION_GAP_OR_FALSE_POSITIVE",
    "POLICY_OR_AUTHORITY_DENIAL",
    "TOOL_OR_ENVIRONMENT_FAILURE",
    "LOCAL_IMPLEMENTATION_DEFECT",
    "CONTEXT_DEFICIT_OR_BAD_PROJECTION",
    "ISSUE_SPECIFICATION_GAP",
    "WORKFLOW_STRATEGY_MISMATCH",
    "THINKING_OR_OUTPUT_PROFILE_MISMATCH",
    "MODEL_CAPABILITY_LIMIT",
    "OWNER_CANCELLED",
];
const REQUIRED_GATES = [
    "ACCEPTANCE", "TESTS", "POLICY", "SCOPE", "SECRETS", "READBACK", "CLEANUP",
];
function digest(value) {
    return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
function validDigest(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function receiptDigestValid(receipt) {
    if (!validDigest(receipt.receiptDigest))
        return false;
    const unsigned = Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== "receiptDigest"));
    return digest(unsigned) === receipt.receiptDigest;
}
function reportDigestValid(report) {
    if (!validDigest(report.plan.planDigest))
        return false;
    const unsigned = Object.fromEntries(Object.entries(report.plan).filter(([key]) => key !== "planDigest"));
    return digest(unsigned) === report.plan.planDigest;
}
function uniqueSorted(values) {
    return [...new Set(values)].sort((left, right) => left.localeCompare(right, "en"));
}
function lineageValid(input) {
    if (!hasValidRoutingContextDigestV1(input.context))
        return false;
    const decisions = new Set();
    for (const decision of input.decisions) {
        if (!hasValidRoutingDecisionDigestV1(decision)
            || decision.episodePseudonym !== input.context.episodePseudonym
            || decision.contextDigest !== input.context.contextDigest
            || decisions.has(decision.decisionDigest))
            return false;
        decisions.add(decision.decisionDigest);
    }
    const attempts = new Set();
    for (const attempt of input.attempts) {
        if (!hasValidRoutingAttemptDigestV1(attempt)
            || attempt.episodePseudonym !== input.context.episodePseudonym
            || !decisions.has(attempt.decisionDigest)
            || attempts.has(attempt.attemptDigest))
            return false;
        attempts.add(attempt.attemptDigest);
    }
    return input.attempts.every(({ parentAttemptDigest }) => parentAttemptDigest === null || attempts.has(parentAttemptDigest));
}
function gateEvidenceType(gate) {
    switch (gate) {
        case "ACCEPTANCE":
        case "TESTS": return "TEST";
        case "POLICY": return "POLICY";
        case "SCOPE": return "SCOPE";
        case "SECRETS": return "SECRET_SCAN";
        case "READBACK":
        case "CLEANUP": return "REVIEW";
    }
}
function evidenceIntegrity(input, subjectDigest) {
    const required = input.hardGates.filter(({ required }) => required);
    const exactRequired = REQUIRED_GATES.every((gate) => required.some((item) => item.gate === gate))
        && new Set(input.hardGates.map(({ gate }) => gate)).size === input.hardGates.length;
    const failed = required.some(({ outcome }) => outcome === "FAIL")
        || (input.externalReview.required && input.externalReview.outcome === "FAIL");
    const unrun = required.some(({ executed, outcome }) => !executed || outcome === "NOT_RUN" || outcome === "UNKNOWN")
        || (input.externalReview.required && input.externalReview.outcome === "NOT_RUN");
    let tampered = subjectDigest === null;
    for (const gate of required) {
        if (gate.evidenceDigest === null)
            continue;
        const evidence = input.evidence.find(({ digest: itemDigest }) => itemDigest === gate.evidenceDigest);
        if (!evidence || evidence.evidenceType !== gateEvidenceType(gate.gate)
            || evidence.origin === "UNTRUSTED_CLAIM" || evidence.trust !== "AUTHORITATIVE"
            || !evidence.authoritative || evidence.subjectDigest !== subjectDigest
            || evidence.acceptanceSnapshotDigest !== input.context.snapshotDigests.acceptance
            || evidence.observedAtMs > input.nowMs || input.nowMs > evidence.expiresAtMs
            || !validDigest(evidence.digest) || !validDigest(evidence.verifierVersionDigest))
            tampered = true;
    }
    if (input.externalReview.required) {
        const review = input.externalReview.evidenceDigest === null ? undefined
            : input.evidence.find(({ digest: itemDigest }) => itemDigest === input.externalReview.evidenceDigest);
        if (!review || review.evidenceType !== "REVIEW" || !review.authoritative
            || review.trust !== "AUTHORITATIVE" || review.origin === "UNTRUSTED_CLAIM"
            || review.subjectDigest !== subjectDigest
            || review.acceptanceSnapshotDigest !== input.context.snapshotDigests.acceptance
            || input.nowMs > review.expiresAtMs || review.observedAtMs > input.nowMs)
            tampered = true;
    }
    const reportsComplete = input.verificationReports.length > 0 && input.verificationReports.every((report) => report.schemaVersion === "chimpmaera.verification/shadow-report/v2"
        && report.status === "SHADOW_PASS" && report.activation === "BLOCKED_SAMPLE_GATE"
        && report.comparator.command === "npm test" && report.comparator.authoritative
        && report.comparator.executed && report.comparator.exitCode === 0 && reportDigestValid(report));
    return {
        complete: exactRequired && required.every(({ executed, outcome, evidenceDigest }) => executed && outcome === "PASS" && evidenceDigest !== null) && !tampered && !failed && !unrun
            && reportsComplete && (!input.externalReview.required || input.externalReview.outcome === "PASS"),
        tampered,
        failed,
        unrun: unrun || !reportsComplete || !exactRequired,
    };
}
function receiptIntegrity(input) {
    const byAttempt = new Map(input.receipts.map((binding) => [binding.attemptDigest, binding]));
    if (byAttempt.size !== input.receipts.length)
        return { complete: false, tampered: true };
    let complete = true;
    let tampered = false;
    for (const attempt of input.attempts) {
        const binding = byAttempt.get(attempt.attemptDigest);
        if (!binding) {
            if (attempt.terminalTransportState === "CONFIRMED")
                complete = false;
            continue;
        }
        const receipt = binding.receipt;
        if (!receiptDigestValid(receipt) || binding.ciRuns < 0 || binding.humanReviewMinutes < 0
            || !Number.isSafeInteger(binding.ciRuns) || !Number.isSafeInteger(binding.humanReviewMinutes)
            || receipt.patchDigest !== attempt.candidateDigest
            || receipt.modelUsage.alias !== attempt.route.modelAlias
            || receipt.modelUsage.requests !== attempt.usage.requests
            || receipt.modelUsage.inputTokens !== attempt.usage.inputTokens
            || receipt.modelUsage.outputTokens !== attempt.usage.outputTokens
            || receipt.modelUsage.costMicros !== attempt.usage.costMicros)
            tampered = true;
        if (receipt.outcome !== "SUCCEEDED" || receipt.review.outcome !== "PASS"
            || receipt.cleanup.outcome !== "PASS" || receipt.cleanup.writableStateRemaining
            || !receipt.readback.synthetic || receipt.tests.some(({ outcome }) => outcome !== "PASS"))
            complete = false;
    }
    if (input.receipts.some(({ attemptDigest }) => !input.attempts.some((attempt) => attempt.attemptDigest === attemptDigest)))
        tampered = true;
    return { complete, tampered };
}
function totals(input) {
    const receipts = new Map(input.receipts.map((binding) => [binding.attemptDigest, binding]));
    return input.attempts.reduce((sum, attempt) => {
        const binding = receipts.get(attempt.attemptDigest);
        const usage = binding?.receipt.modelUsage ?? attempt.usage;
        return {
            calls: sum.calls + usage.requests,
            scoutCalls: sum.scoutCalls + (attempt.action === "SCOUT" ? usage.requests : 0),
            testRuns: sum.testRuns + (binding?.receipt.tests.length ?? 0),
            ciRuns: sum.ciRuns + (binding?.ciRuns ?? 0),
            humanReviewMinutes: sum.humanReviewMinutes + (binding?.humanReviewMinutes ?? 0),
            inputTokens: sum.inputTokens + usage.inputTokens,
            outputTokens: sum.outputTokens + usage.outputTokens,
            costMicros: sum.costMicros + usage.costMicros,
            elapsedMs: sum.elapsedMs + attempt.usage.elapsedMs,
        };
    }, { calls: 0, scoutCalls: 0, testRuns: 0, ciRuns: 0, humanReviewMinutes: 0,
        inputTokens: 0, outputTokens: 0, costMicros: 0, elapsedMs: 0 });
}
function attribution(reasonsInput, evidenceDigests) {
    const reasons = uniqueSorted(reasonsInput);
    const ordered = REASON_ORDER.filter((reason) => reasons.includes(reason));
    const primary = ordered[0] ?? "VERIFICATION_GAP_OR_FALSE_POSITIVE";
    const lowConfidence = reasons.includes("TRANSPORT_OUTCOME_UNKNOWN")
        || reasons.includes("EVIDENCE_INTEGRITY_OR_DRIFT") || evidenceDigests.length === 0;
    return {
        primary,
        contributing: ordered.filter((reason) => reason !== primary),
        confidence: lowConfidence ? "LOW" : ordered.length > 1 ? "HIGH" : "MEDIUM",
        evidenceDigests: uniqueSorted(evidenceDigests.filter(validDigest)),
    };
}
/** Pure LR-002 normalization. It performs no I/O, routing, retry, or provider action. */
export function adaptRoutingOutcomeV1(input) {
    const reasonCodes = input.attempts.flatMap(({ reasonCodes }) => [...reasonCodes]);
    const candidates = uniqueSorted(input.attempts.flatMap(({ candidateDigest }) => candidateDigest === null ? [] : [candidateDigest]));
    const subjectDigest = candidates.length === 1 ? candidates[0] : null;
    const lineage = lineageValid(input);
    const receipts = receiptIntegrity(input);
    const evidence = evidenceIntegrity(input, subjectDigest);
    const unknownTransport = input.attempts.some(({ terminalTransportState, attemptOutcome }) => terminalTransportState === "UNKNOWN" || attemptOutcome === "UNKNOWN");
    const explicitFailure = input.attempts.some(({ terminalTransportState, attemptOutcome }) => terminalTransportState === "FAILED" || attemptOutcome === "NO_CANDIDATE" || attemptOutcome === "DENIED")
        || input.receipts.some(({ receipt }) => receipt.outcome === "FAILED" || receipt.outcome === "DENIED") || evidence.failed;
    const aborted = input.attempts.length > 0 && input.attempts.every(({ attemptOutcome }) => attemptOutcome === "ABORTED");
    if (!lineage || receipts.tampered || evidence.tampered || candidates.length > 1) {
        reasonCodes.push("EVIDENCE_INTEGRITY_OR_DRIFT");
    }
    if (unknownTransport)
        reasonCodes.push("TRANSPORT_OUTCOME_UNKNOWN");
    if (evidence.unrun || !receipts.complete)
        reasonCodes.push("VERIFICATION_GAP_OR_FALSE_POSITIVE");
    if (explicitFailure && reasonCodes.length === 0)
        reasonCodes.push("LOCAL_IMPLEMENTATION_DEFECT");
    let terminalState = "INSUFFICIENT_EVIDENCE";
    if (unknownTransport)
        terminalState = "UNKNOWN";
    else if (aborted)
        terminalState = "ABORTED";
    else if (explicitFailure)
        terminalState = "NOT_RESOLVED";
    else if (lineage && receipts.complete && !receipts.tampered && evidence.complete
        && !evidence.tampered && candidates.length === 1)
        terminalState = "VERIFIED_RESOLVED";
    const unsigned = {
        schemaVersion: ROUTING_OUTCOME_SCHEMA_V1,
        episodePseudonym: input.context.episodePseudonym,
        contextDigest: input.context.contextDigest,
        decisionDigests: uniqueSorted(input.decisions.map(({ decisionDigest }) => decisionDigest)),
        attemptDigests: uniqueSorted(input.attempts.map(({ attemptDigest }) => attemptDigest)),
        terminalState,
        acceptanceSnapshotDigest: input.context.snapshotDigests.acceptance,
        evidenceSet: input.evidence.map(({ subjectDigest: ignoredSubject, acceptanceSnapshotDigest: ignoredAcceptance, ...item }) => item),
        hardGates: input.hardGates,
        externalReview: input.externalReview,
        totals: totals(input),
        attribution: attribution(reasonCodes, input.evidence.map(({ digest: itemDigest }) => itemDigest)),
        claimBoundary: LEARNING_ROUTING_CLAIM_BOUNDARY_V1,
        nonClaims: LEARNING_ROUTING_NON_CLAIMS_V1,
    };
    return { ...unsigned, outcomeDigest: routingOutcomeDigestV1(unsigned) };
}
