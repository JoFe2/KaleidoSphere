import { canonicalJson } from "./canonical-json.js";
import { assertCcpDigestV1, assertCcpSafePositiveIntegerV1, assertCcpSafeUnsignedIntegerV1, assertCcpStringV1, ccpDigestDomainV1, ccpStrictDenyV1, readCcpClosedObjectV1, readCcpDenseArrayV1, } from "./ccp-event-envelope.js";
import { CCP_FAIR_QUEUE_EXCLUSION_REASONS_V1, parseCcpFairQueueCandidateV1, parseCcpFairQueueSelectionV1, } from "./ccp-fair-queue.js";
/**
 * CCP PSAI52 bounded observability boundary (M2 SLO side). This is a pure
 * projection of a selection receipt, its canonical candidate observations and
 * injected recovery counters into queue-age, fairness, cost and recovery SLO
 * measurements. It reads no clock and makes no claim about deep verification,
 * runner execution, merge, release or external recovery.
 *
 * All rates are integer basis points. Queue ages are calculated from the
 * injected logical observation time and candidate enqueue times. Exclusions
 * remain reason-coded, including the pre-claim quarantine, supersession and
 * unknown gates.
 */
export const CCP_SLO_OBSERVATION_INPUT_SCHEMA_V1 = "cm.ccp-slo-observation-input/v1";
export const CCP_SLO_OBSERVATION_SCHEMA_V1 = "cm.ccp-slo-observation/v1";
export const CCP_SLO_CLAIM_BOUNDARY_V1 = "SLO_PROJECTION_ONLY_NO_DEEP_VERIFICATION_CLAIM";
const SLO_DENIED = "CCP_SLO_OBSERVATION_SCHEMA_DENIED";
const INPUT_KEYS = Object.freeze(["schemaVersion", "observationId", "logicalAtMs", "selection", "candidates", "recovery", "targets"]);
const RECOVERY_KEYS = Object.freeze(["attempts", "recovered", "failed"]);
const TARGET_KEYS = Object.freeze(["maxQueueAgeMs", "minFairnessCoverageBps", "maxSelectedCostUnits", "minRecoveryRateBps"]);
const QUEUE_AGE_KEYS = Object.freeze(["eligibleCount", "oldestEligibleAgeMs", "p95EligibleAgeMs", "targetMaxQueueAgeMs", "met"]);
const FAIRNESS_KEYS = Object.freeze([
    "eligibleFairnessKeyCount", "selectedFairnessKeyCount", "coverageBps", "targetCoverageBps",
    "grantsSinceContributorLastServed", "activeEligibleContributorCount", "fairnessBound", "fairnessStatus", "met",
]);
const GRANTS_SINCE_SERVED_KEYS = Object.freeze(["fairnessKey", "grants"]);
const COST_KEYS = Object.freeze(["budgetUnits", "availableUnits", "selectedUnits", "remainingUnits", "targetMaxSelectedUnits", "met"]);
const RECOVERY_PROJECTION_KEYS = Object.freeze(["attempts", "recovered", "failed", "recoveryRateBps", "targetRecoveryRateBps", "met"]);
const REASON_COUNT_KEYS = Object.freeze(["reasonCode", "count"]);
const EXCLUSION_KEYS = Object.freeze(["total", "byReason"]);
const OBSERVATION_KEYS = Object.freeze([
    "schemaVersion", "observationId", "logicalAtMs", "selectionDigest", "queueAge", "fairness", "cost",
    "recovery", "exclusions", "outcome", "claimBoundary", "observationDigest",
]);
const OBSERVATION_ID_PATTERN = /^observation:[a-z0-9][a-z0-9._-]{2,95}$/;
function unsigned(value) {
    return assertCcpSafeUnsignedIntegerV1(value, SLO_DENIED);
}
function positive(value) {
    return assertCcpSafePositiveIntegerV1(value, SLO_DENIED);
}
function booleanValue(value) {
    if (typeof value !== "boolean")
        ccpStrictDenyV1(SLO_DENIED);
    return value;
}
function normalizeRecovery(value) {
    const record = readCcpClosedObjectV1(value, RECOVERY_KEYS, new WeakSet(), SLO_DENIED);
    const attempts = unsigned(record.attempts);
    const recovered = unsigned(record.recovered);
    const failed = unsigned(record.failed);
    if (recovered > attempts || failed > attempts || recovered + failed > attempts)
        ccpStrictDenyV1(SLO_DENIED);
    return Object.freeze({ attempts, recovered, failed });
}
function normalizeTargets(value) {
    const record = readCcpClosedObjectV1(value, TARGET_KEYS, new WeakSet(), SLO_DENIED);
    const maxQueueAgeMs = unsigned(record.maxQueueAgeMs);
    const minFairnessCoverageBps = unsigned(record.minFairnessCoverageBps);
    const maxSelectedCostUnits = unsigned(record.maxSelectedCostUnits);
    const minRecoveryRateBps = unsigned(record.minRecoveryRateBps);
    if (minFairnessCoverageBps > 10000 || minRecoveryRateBps > 10000)
        ccpStrictDenyV1(SLO_DENIED);
    return Object.freeze({ maxQueueAgeMs, minFairnessCoverageBps, maxSelectedCostUnits, minRecoveryRateBps });
}
function isEligible(candidate) {
    return candidate.admissionState === "ADMITTED"
        && candidate.headState === "CURRENT"
        && candidate.deepCiClaimEligible;
}
function normalizeInput(value) {
    const seen = new WeakSet();
    const record = readCcpClosedObjectV1(value, INPUT_KEYS, seen, SLO_DENIED);
    if (record.schemaVersion !== CCP_SLO_OBSERVATION_INPUT_SCHEMA_V1)
        ccpStrictDenyV1(SLO_DENIED);
    const selection = parseCcpFairQueueSelectionV1(record.selection);
    const candidatesRaw = readCcpDenseArrayV1(record.candidates, seen, SLO_DENIED);
    const candidates = candidatesRaw.map((candidate) => {
        // The fair-queue parser enforces the complete closed candidate shape.
        return parseCcpFairQueueCandidateV1(candidate);
    });
    const ids = new Set();
    for (const candidate of candidates) {
        if (ids.has(candidate.candidateId))
            ccpStrictDenyV1(SLO_DENIED);
        ids.add(candidate.candidateId);
    }
    const referenced = new Set();
    for (const candidate of selection.selected)
        referenced.add(candidate.candidateId);
    for (const exclusion of selection.exclusions)
        referenced.add(exclusion.candidateId);
    if (referenced.size !== ids.size || [...referenced].some((id) => !ids.has(id)))
        ccpStrictDenyV1(SLO_DENIED);
    const logicalAtMs = unsigned(record.logicalAtMs);
    if (logicalAtMs < selection.logicalAtMs)
        ccpStrictDenyV1(SLO_DENIED);
    return Object.freeze({
        schemaVersion: CCP_SLO_OBSERVATION_INPUT_SCHEMA_V1,
        observationId: assertCcpStringV1(record.observationId, OBSERVATION_ID_PATTERN, SLO_DENIED),
        logicalAtMs,
        selection,
        candidates: Object.freeze(candidates),
        recovery: normalizeRecovery(record.recovery),
        targets: normalizeTargets(record.targets),
    });
}
function percentile95(ages) {
    if (ages.length === 0)
        return 0;
    const sorted = [...ages].sort((a, b) => a - b);
    return sorted[Math.max(0, Math.ceil(sorted.length * 95 / 100) - 1)];
}
function buildObservation(input) {
    const eligible = input.candidates.filter(isEligible);
    const ages = eligible.map((candidate) => {
        if (candidate.enqueuedAtMs > input.logicalAtMs)
            ccpStrictDenyV1(SLO_DENIED);
        return input.logicalAtMs - candidate.enqueuedAtMs;
    });
    const selectedIds = new Set(input.selection.selected.map((candidate) => candidate.candidateId));
    const eligibleKeys = new Set(eligible.map((candidate) => candidate.fairnessKey));
    const selectedKeys = new Set(eligible.filter((candidate) => selectedIds.has(candidate.candidateId)).map((candidate) => candidate.fairnessKey));
    const coverageBps = eligibleKeys.size === 0 ? 10000 : Math.floor(selectedKeys.size * 10000 / eligibleKeys.size);
    const recoveryRateBps = input.recovery.attempts === 0
        ? 10000
        : Math.floor(input.recovery.recovered * 10000 / input.recovery.attempts);
    const queueAge = Object.freeze({
        eligibleCount: eligible.length,
        oldestEligibleAgeMs: ages.length === 0 ? 0 : Math.max(...ages),
        p95EligibleAgeMs: percentile95(ages),
        targetMaxQueueAgeMs: input.targets.maxQueueAgeMs,
        met: ages.length === 0 || Math.max(...ages) <= input.targets.maxQueueAgeMs,
    });
    const fairness = Object.freeze({
        eligibleFairnessKeyCount: eligibleKeys.size,
        selectedFairnessKeyCount: selectedKeys.size,
        coverageBps,
        targetCoverageBps: input.targets.minFairnessCoverageBps,
        grantsSinceContributorLastServed: Object.freeze([...eligibleKeys].sort().map((fairnessKey) => Object.freeze({
            fairnessKey,
            grants: selectedKeys.has(fairnessKey) ? 0 : input.selection.selectedCount,
        }))),
        activeEligibleContributorCount: eligibleKeys.size,
        fairnessBound: eligibleKeys.size === 0 ? 0 : eligibleKeys.size - 1,
        fairnessStatus: selectedKeys.size === eligibleKeys.size ? "FAIRNESS_BOUND_MET" : "FAIRNESS_BOUND_MISSED",
        met: coverageBps >= input.targets.minFairnessCoverageBps,
    });
    const cost = Object.freeze({
        budgetUnits: input.selection.budget.budgetUnits,
        availableUnits: input.selection.budget.remainingUnits,
        selectedUnits: input.selection.selectedCostUnits,
        remainingUnits: input.selection.remainingBudgetUnits,
        targetMaxSelectedUnits: input.targets.maxSelectedCostUnits,
        met: input.selection.selectedCostUnits <= input.targets.maxSelectedCostUnits
            && input.selection.selectedCostUnits <= input.selection.budget.remainingUnits,
    });
    const recovery = Object.freeze({
        ...input.recovery,
        recoveryRateBps,
        targetRecoveryRateBps: input.targets.minRecoveryRateBps,
        met: recoveryRateBps >= input.targets.minRecoveryRateBps,
    });
    const counts = new Map();
    for (const reason of CCP_FAIR_QUEUE_EXCLUSION_REASONS_V1)
        counts.set(reason, 0);
    for (const exclusion of input.selection.exclusions)
        counts.set(exclusion.reasonCode, (counts.get(exclusion.reasonCode) ?? 0) + 1);
    const exclusions = Object.freeze({
        total: input.selection.exclusions.length,
        byReason: Object.freeze(CCP_FAIR_QUEUE_EXCLUSION_REASONS_V1.map((reasonCode) => Object.freeze({
            reasonCode,
            count: counts.get(reasonCode) ?? 0,
        }))),
    });
    const outcome = queueAge.met && fairness.met && cost.met && recovery.met ? "SLO_MET" : "SLO_MISSED";
    const unsigned = Object.freeze({
        schemaVersion: CCP_SLO_OBSERVATION_SCHEMA_V1,
        observationId: input.observationId,
        logicalAtMs: input.logicalAtMs,
        selectionDigest: input.selection.selectionDigest,
        queueAge,
        fairness,
        cost,
        recovery,
        exclusions,
        outcome,
        claimBoundary: CCP_SLO_CLAIM_BOUNDARY_V1,
    });
    return Object.freeze({
        ...unsigned,
        observationDigest: ccpDigestDomainV1(CCP_SLO_OBSERVATION_SCHEMA_V1, unsigned),
    });
}
export function projectCcpSloObservabilityV1(value) {
    return buildObservation(normalizeInput(value));
}
function normalizeReasonCount(value) {
    const record = readCcpClosedObjectV1(value, REASON_COUNT_KEYS, new WeakSet(), SLO_DENIED);
    const reasonCode = record.reasonCode;
    if (typeof reasonCode !== "string" || !CCP_FAIR_QUEUE_EXCLUSION_REASONS_V1.includes(reasonCode))
        ccpStrictDenyV1(SLO_DENIED);
    return Object.freeze({ reasonCode: reasonCode, count: unsigned(record.count) });
}
function normalizeObservation(value) {
    const seen = new WeakSet();
    const record = readCcpClosedObjectV1(value, OBSERVATION_KEYS, seen, SLO_DENIED);
    if (record.schemaVersion !== CCP_SLO_OBSERVATION_SCHEMA_V1 || record.claimBoundary !== CCP_SLO_CLAIM_BOUNDARY_V1)
        ccpStrictDenyV1(SLO_DENIED);
    const normalizeMetric = (raw, keys) => {
        const metric = readCcpClosedObjectV1(raw, keys, seen, SLO_DENIED);
        return metric;
    };
    const queueAgeRaw = normalizeMetric(record.queueAge, QUEUE_AGE_KEYS);
    const fairnessRaw = normalizeMetric(record.fairness, FAIRNESS_KEYS);
    const grantsRaw = readCcpDenseArrayV1(fairnessRaw.grantsSinceContributorLastServed, seen, SLO_DENIED).map((value) => {
        const grant = readCcpClosedObjectV1(value, GRANTS_SINCE_SERVED_KEYS, new WeakSet(), SLO_DENIED);
        return Object.freeze({
            fairnessKey: assertCcpStringV1(grant.fairnessKey, /^fair:[a-z0-9][a-z0-9._-]{2,95}$/, SLO_DENIED),
            grants: unsigned(grant.grants),
        });
    });
    const costRaw = normalizeMetric(record.cost, COST_KEYS);
    const recoveryRaw = normalizeMetric(record.recovery, RECOVERY_PROJECTION_KEYS);
    const exclusionsRaw = readCcpClosedObjectV1(record.exclusions, EXCLUSION_KEYS, seen, SLO_DENIED);
    const reasonRaw = readCcpDenseArrayV1(exclusionsRaw.byReason, seen, SLO_DENIED).map(normalizeReasonCount);
    const observation = Object.freeze({
        schemaVersion: CCP_SLO_OBSERVATION_SCHEMA_V1,
        observationId: assertCcpStringV1(record.observationId, OBSERVATION_ID_PATTERN, SLO_DENIED),
        logicalAtMs: unsigned(record.logicalAtMs),
        selectionDigest: assertCcpDigestV1(record.selectionDigest, SLO_DENIED),
        queueAge: Object.freeze({
            eligibleCount: unsigned(queueAgeRaw.eligibleCount),
            oldestEligibleAgeMs: unsigned(queueAgeRaw.oldestEligibleAgeMs),
            p95EligibleAgeMs: unsigned(queueAgeRaw.p95EligibleAgeMs),
            targetMaxQueueAgeMs: unsigned(queueAgeRaw.targetMaxQueueAgeMs),
            met: booleanValue(queueAgeRaw.met),
        }),
        fairness: Object.freeze({
            eligibleFairnessKeyCount: unsigned(fairnessRaw.eligibleFairnessKeyCount),
            selectedFairnessKeyCount: unsigned(fairnessRaw.selectedFairnessKeyCount),
            coverageBps: unsigned(fairnessRaw.coverageBps),
            targetCoverageBps: unsigned(fairnessRaw.targetCoverageBps),
            grantsSinceContributorLastServed: Object.freeze(grantsRaw),
            activeEligibleContributorCount: unsigned(fairnessRaw.activeEligibleContributorCount),
            fairnessBound: unsigned(fairnessRaw.fairnessBound),
            fairnessStatus: fairnessRaw.fairnessStatus === "FAIRNESS_BOUND_MET"
                ? "FAIRNESS_BOUND_MET"
                : fairnessRaw.fairnessStatus === "FAIRNESS_BOUND_MISSED"
                    ? "FAIRNESS_BOUND_MISSED"
                    : ccpStrictDenyV1(SLO_DENIED),
            met: booleanValue(fairnessRaw.met),
        }),
        cost: Object.freeze({
            budgetUnits: positive(costRaw.budgetUnits),
            availableUnits: unsigned(costRaw.availableUnits),
            selectedUnits: unsigned(costRaw.selectedUnits),
            remainingUnits: unsigned(costRaw.remainingUnits),
            targetMaxSelectedUnits: unsigned(costRaw.targetMaxSelectedUnits),
            met: booleanValue(costRaw.met),
        }),
        recovery: Object.freeze({
            attempts: unsigned(recoveryRaw.attempts),
            recovered: unsigned(recoveryRaw.recovered),
            failed: unsigned(recoveryRaw.failed),
            recoveryRateBps: unsigned(recoveryRaw.recoveryRateBps),
            targetRecoveryRateBps: unsigned(recoveryRaw.targetRecoveryRateBps),
            met: booleanValue(recoveryRaw.met),
        }),
        exclusions: Object.freeze({
            total: unsigned(exclusionsRaw.total),
            byReason: Object.freeze(reasonRaw),
        }),
        outcome: record.outcome,
        claimBoundary: CCP_SLO_CLAIM_BOUNDARY_V1,
    });
    if (typeof record.outcome !== "string" || (record.outcome !== "SLO_MET" && record.outcome !== "SLO_MISSED"))
        ccpStrictDenyV1(SLO_DENIED);
    if (observation.queueAge.p95EligibleAgeMs > observation.queueAge.oldestEligibleAgeMs
        || (observation.queueAge.eligibleCount === 0
            && (observation.queueAge.oldestEligibleAgeMs !== 0 || observation.queueAge.p95EligibleAgeMs !== 0))) {
        ccpStrictDenyV1(SLO_DENIED);
    }
    if (observation.fairness.selectedFairnessKeyCount > observation.fairness.eligibleFairnessKeyCount
        || observation.fairness.coverageBps > 10000
        || (observation.fairness.eligibleFairnessKeyCount === 0 && observation.fairness.coverageBps !== 10000)) {
        ccpStrictDenyV1(SLO_DENIED);
    }
    if (observation.cost.selectedUnits > observation.cost.availableUnits
        || observation.cost.selectedUnits + observation.cost.remainingUnits !== observation.cost.availableUnits) {
        ccpStrictDenyV1(SLO_DENIED);
    }
    if (observation.recovery.recovered > observation.recovery.attempts
        || observation.recovery.failed > observation.recovery.attempts
        || observation.recovery.recovered + observation.recovery.failed > observation.recovery.attempts
        || observation.recovery.recoveryRateBps > 10000) {
        ccpStrictDenyV1(SLO_DENIED);
    }
    if (reasonRaw.length !== CCP_FAIR_QUEUE_EXCLUSION_REASONS_V1.length
        || reasonRaw.some((item, index) => item.reasonCode !== CCP_FAIR_QUEUE_EXCLUSION_REASONS_V1[index])) {
        ccpStrictDenyV1(SLO_DENIED);
    }
    if (reasonRaw.reduce((total, item) => total + item.count, 0) !== observation.exclusions.total) {
        ccpStrictDenyV1(SLO_DENIED);
    }
    const expectedOutcome = observation.queueAge.met && observation.fairness.met
        && observation.cost.met && observation.recovery.met ? "SLO_MET" : "SLO_MISSED";
    if (observation.outcome !== expectedOutcome
        || observation.queueAge.met !== (observation.queueAge.eligibleCount === 0
            || observation.queueAge.oldestEligibleAgeMs <= observation.queueAge.targetMaxQueueAgeMs)
        || observation.fairness.met !== (observation.fairness.coverageBps >= observation.fairness.targetCoverageBps)
        || observation.cost.met !== (observation.cost.selectedUnits <= observation.cost.targetMaxSelectedUnits
            && observation.cost.selectedUnits <= observation.cost.availableUnits)
        || observation.recovery.met !== (observation.recovery.recoveryRateBps >= observation.recovery.targetRecoveryRateBps)) {
        ccpStrictDenyV1(SLO_DENIED);
    }
    const expectedDigest = ccpDigestDomainV1(CCP_SLO_OBSERVATION_SCHEMA_V1, observation);
    if (record.observationDigest !== expectedDigest)
        ccpStrictDenyV1(SLO_DENIED);
    return Object.freeze({ ...observation, observationDigest: expectedDigest });
}
export function parseCcpSloObservabilityV1(value) {
    return normalizeObservation(value);
}
export function canonicalCcpSloObservabilityJsonV1(value) {
    return canonicalJson(parseCcpSloObservabilityV1(value));
}
export function ccpSloObservabilityDigestV1(value) {
    return parseCcpSloObservabilityV1(value).observationDigest;
}
export function verifyCcpSloObservabilityV1(value) {
    try {
        return parseCcpSloObservabilityV1(value);
    }
    catch {
        return null;
    }
}
