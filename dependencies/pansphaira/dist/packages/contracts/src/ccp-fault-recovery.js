import { canonicalJson } from "./canonical-json.js";
import { assertCcpDigestV1, assertCcpSafeUnsignedIntegerV1, assertCcpStringV1, ccpDigestDomainV1, ccpStrictDenyV1, readCcpClosedObjectV1, } from "./ccp-event-envelope.js";
import { issueCcpRunnerCleanupReceiptV1, parseCcpRunnerCleanupReceiptV1, } from "./ccp-runner-cleanup.js";
import { parseCcpLkgStateV1, } from "./ccp-lkg-restore.js";
/**
 * CCP PSAI52 bounded fault-recovery boundary. This contract composes only
 * injected receipts and observations. It never retries an external call,
 * executes a runner, verifies code, promotes a head, or grants merge
 * authority. A CONFIRMED result means that the recovery transition itself is
 * evidenced; it is never a verification or merge result.
 *
 * The four fault classes are deliberately finite. Runner faults require the
 * mandatory cleanup receipt, queue and API faults remain outside execution
 * authority, and a promotion fault can only recover by an exact LKG restore.
 * Every input is closed and every output is digest-bound for deterministic
 * read-back.
 */
export const CCP_FAULT_RECOVERY_INPUT_SCHEMA_V1 = "cm.ccp-fault-recovery-input/v1";
export const CCP_FAULT_RECOVERY_RECEIPT_SCHEMA_V1 = "cm.ccp-fault-recovery-receipt/v1";
export const CCP_RECOVERY_SLO_OBSERVATION_SCHEMA_V1 = "cm.ccp-recovery-slo-observation/v1";
export const CCP_LKG_RECOVERY_READBACK_SCHEMA_V1 = "cm.ccp-lkg-recovery-readback/v1";
export const CCP_FAULT_RECOVERY_TASK_ID_V1 = "QWEN-PSAI52-FAILURE-RECOVERY-09";
export const CCP_FAULT_CLASSES_V1 = Object.freeze(["RUNNER", "QUEUE", "API", "PROMOTION"]);
export const CCP_FAULT_CODES_V1 = Object.freeze([
    "RUNNER_FAILURE", "QUEUE_FAILURE", "API_FAILURE", "PROMOTION_FAILURE",
]);
export const CCP_FAULT_RECOVERY_DISPOSITIONS_V1 = Object.freeze([
    "RECOVERY_CONFIRMED", "RECOVERY_BLOCKED",
]);
export const CCP_FAULT_RECOVERY_TRANSITIONS_V1 = Object.freeze([
    "RUNNER_ABORTED_CLEANUP_CONFIRMED",
    "QUEUE_REQUEUED_NO_EXECUTION_AUTHORITY",
    "API_ABORTED_NO_EXTERNAL_RETRY",
    "PROMOTION_FAILURE_EXACT_LKG_RESTORE",
    "RECOVERY_BLOCKED_EVIDENCE_INCOMPLETE",
]);
const RECOVERY_DENIED = "CCP_FAULT_RECOVERY_SCHEMA_DENIED";
const SLO_DENIED = "CCP_RECOVERY_SLO_OBSERVATION_SCHEMA_DENIED";
const LKG_DENIED = "CCP_LKG_RECOVERY_READBACK_SCHEMA_DENIED";
const RECEIPT_DENIED = "CCP_FAULT_RECOVERY_RECEIPT_SCHEMA_DENIED";
const OBSERVATION_ID_PATTERN = /^observation:[a-z0-9][a-z0-9._-]{2,95}$/;
const LKG_TRANSITION_DOMAIN = "cm.ccp-lkg-recovery-transition/v1";
const INPUT_KEYS = Object.freeze([
    "schemaVersion", "taskId", "faultClass", "faultCode", "faultInjected", "logicalAtMs",
    "cleanup", "sloObservation", "lkgReadback",
]);
const CLEANUP_INPUT_KEYS = Object.freeze(["request", "observation"]);
const SLO_KEYS = Object.freeze([
    "schemaVersion", "observationId", "logicalAtMs", "attempts", "recovered", "failed", "targetRecoveryRateBps",
]);
const LKG_KEYS = Object.freeze([
    "schemaVersion", "beforeState", "afterState", "behavior", "expectedAfterLkgDigest", "transitionDigest",
]);
const RECEIPT_KEYS = Object.freeze([
    "schemaVersion", "taskId", "faultClass", "faultCode", "faultInjected", "logicalAtMs",
    "cleanupReceipt", "cleanupReceiptDigest", "sloObservation", "sloMetrics", "lkgReadback", "lkgBehavior",
    "disposition", "transition", "recoveryEvidenceComplete", "cleanupRequired", "zeroResidue", "runnerReleased",
    "authorization", "receiptDigest",
]);
const METRIC_KEYS = Object.freeze([
    "attempts", "recovered", "failed", "recoveryRateBps", "targetRecoveryRateBps", "met",
]);
const AUTHORIZATION_KEYS = Object.freeze([
    "verificationClaimed", "verificationAuthorized", "executionAuthorized", "promotionAuthorized", "mergeAuthorized",
]);
const FAULT_TO_CLASS = Object.freeze({
    RUNNER_FAILURE: "RUNNER",
    QUEUE_FAILURE: "QUEUE",
    API_FAILURE: "API",
    PROMOTION_FAILURE: "PROMOTION",
});
function enumValue(value, values, code) {
    if (typeof value !== "string" || !values.includes(value))
        ccpStrictDenyV1(code);
    return value;
}
function parseSloObservation(value) {
    const record = readCcpClosedObjectV1(value, SLO_KEYS, new WeakSet(), SLO_DENIED);
    if (record.schemaVersion !== CCP_RECOVERY_SLO_OBSERVATION_SCHEMA_V1)
        ccpStrictDenyV1(SLO_DENIED);
    const attempts = assertCcpSafeUnsignedIntegerV1(record.attempts, SLO_DENIED);
    const recovered = assertCcpSafeUnsignedIntegerV1(record.recovered, SLO_DENIED);
    const failed = assertCcpSafeUnsignedIntegerV1(record.failed, SLO_DENIED);
    const targetRecoveryRateBps = assertCcpSafeUnsignedIntegerV1(record.targetRecoveryRateBps, SLO_DENIED);
    if (recovered > attempts || failed > attempts || recovered + failed > attempts || targetRecoveryRateBps > 10000) {
        ccpStrictDenyV1(SLO_DENIED);
    }
    return Object.freeze({
        schemaVersion: CCP_RECOVERY_SLO_OBSERVATION_SCHEMA_V1,
        observationId: assertCcpStringV1(record.observationId, OBSERVATION_ID_PATTERN, SLO_DENIED),
        logicalAtMs: assertCcpSafeUnsignedIntegerV1(record.logicalAtMs, SLO_DENIED),
        attempts,
        recovered,
        failed,
        targetRecoveryRateBps,
    });
}
function lkgTransitionDigest(readback) {
    return ccpDigestDomainV1(LKG_TRANSITION_DOMAIN, {
        beforeStateDigest: readback.beforeState.stateDigest,
        afterStateDigest: readback.afterState.stateDigest,
        behavior: readback.behavior,
        expectedAfterLkgDigest: readback.expectedAfterLkgDigest,
    });
}
function parseLkgReadback(value) {
    const record = readCcpClosedObjectV1(value, LKG_KEYS, new WeakSet(), LKG_DENIED);
    if (record.schemaVersion !== CCP_LKG_RECOVERY_READBACK_SCHEMA_V1)
        ccpStrictDenyV1(LKG_DENIED);
    const beforeState = parseCcpLkgStateV1(record.beforeState);
    const afterState = parseCcpLkgStateV1(record.afterState);
    if (beforeState.ledgerId !== afterState.ledgerId || beforeState.tenantId !== afterState.tenantId
        || beforeState.repositoryId !== afterState.repositoryId || beforeState.contributionId !== afterState.contributionId
        || beforeState.componentId !== afterState.componentId)
        ccpStrictDenyV1(LKG_DENIED);
    const behavior = enumValue(record.behavior, ["UNCHANGED", "EXACT_PRE_PROMOTION_RESTORED"], LKG_DENIED);
    const expectedAfterLkgDigest = assertCcpDigestV1(record.expectedAfterLkgDigest, LKG_DENIED);
    const transitionDigest = record.transitionDigest === null
        ? null
        : assertCcpDigestV1(record.transitionDigest, LKG_DENIED);
    if (behavior === "UNCHANGED") {
        if (transitionDigest !== null || expectedAfterLkgDigest !== beforeState.lkgDigest
            || canonicalJson(beforeState) !== canonicalJson(afterState))
            ccpStrictDenyV1(LKG_DENIED);
    }
    else {
        if (transitionDigest === null || beforeState.lkgDigest === afterState.lkgDigest
            || afterState.lkgDigest !== expectedAfterLkgDigest || afterState.generation !== beforeState.generation + 1
            || transitionDigest !== lkgTransitionDigest({ beforeState, afterState, behavior, expectedAfterLkgDigest })) {
            ccpStrictDenyV1(LKG_DENIED);
        }
    }
    return Object.freeze({
        schemaVersion: CCP_LKG_RECOVERY_READBACK_SCHEMA_V1,
        beforeState,
        afterState,
        behavior,
        expectedAfterLkgDigest,
        transitionDigest,
    });
}
function parseInput(value) {
    const seen = new WeakSet();
    const record = readCcpClosedObjectV1(value, INPUT_KEYS, seen, RECOVERY_DENIED);
    if (record.schemaVersion !== CCP_FAULT_RECOVERY_INPUT_SCHEMA_V1
        || record.taskId !== CCP_FAULT_RECOVERY_TASK_ID_V1 || record.faultInjected !== true)
        ccpStrictDenyV1(RECOVERY_DENIED);
    const faultClass = enumValue(record.faultClass, CCP_FAULT_CLASSES_V1, RECOVERY_DENIED);
    const faultCode = enumValue(record.faultCode, CCP_FAULT_CODES_V1, RECOVERY_DENIED);
    if (FAULT_TO_CLASS[faultCode] !== faultClass)
        ccpStrictDenyV1(RECOVERY_DENIED);
    const logicalAtMs = assertCcpSafeUnsignedIntegerV1(record.logicalAtMs, RECOVERY_DENIED);
    const cleanup = readCcpClosedObjectV1(record.cleanup, CLEANUP_INPUT_KEYS, seen, RECOVERY_DENIED);
    const sloObservation = parseSloObservation(record.sloObservation);
    const lkgReadback = parseLkgReadback(record.lkgReadback);
    if (sloObservation.logicalAtMs > logicalAtMs)
        ccpStrictDenyV1(RECOVERY_DENIED);
    return Object.freeze({
        schemaVersion: CCP_FAULT_RECOVERY_INPUT_SCHEMA_V1,
        taskId: CCP_FAULT_RECOVERY_TASK_ID_V1,
        faultClass,
        faultCode,
        faultInjected: true,
        logicalAtMs,
        cleanup: Object.freeze({ request: cleanup.request, observation: cleanup.observation }),
        sloObservation,
        lkgReadback,
    });
}
function metrics(observation) {
    const recoveryRateBps = observation.attempts === 0
        ? 10000
        : Math.floor(observation.recovered * 10000 / observation.attempts);
    return Object.freeze({
        attempts: observation.attempts,
        recovered: observation.recovered,
        failed: observation.failed,
        recoveryRateBps,
        targetRecoveryRateBps: observation.targetRecoveryRateBps,
        met: recoveryRateBps >= observation.targetRecoveryRateBps,
    });
}
function transitionFor(input, evidenceComplete) {
    if (!evidenceComplete)
        return "RECOVERY_BLOCKED_EVIDENCE_INCOMPLETE";
    switch (input.faultClass) {
        case "RUNNER": return "RUNNER_ABORTED_CLEANUP_CONFIRMED";
        case "QUEUE": return "QUEUE_REQUEUED_NO_EXECUTION_AUTHORITY";
        case "API": return "API_ABORTED_NO_EXTERNAL_RETRY";
        case "PROMOTION": return "PROMOTION_FAILURE_EXACT_LKG_RESTORE";
    }
}
function makeReceipt(input) {
    const cleanupReceipt = issueCcpRunnerCleanupReceiptV1(input.cleanup.request, input.cleanup.observation);
    const sloMetrics = metrics(input.sloObservation);
    const lkgIdentity = input.lkgReadback.beforeState;
    const cleanupIdentity = cleanupReceipt.request;
    if (cleanupIdentity.ledgerId !== lkgIdentity.ledgerId
        || cleanupIdentity.tenantId !== lkgIdentity.tenantId
        || cleanupIdentity.repositoryId !== lkgIdentity.repositoryId
        || cleanupIdentity.contributionId !== lkgIdentity.contributionId)
        ccpStrictDenyV1(RECOVERY_DENIED);
    const lkgMatchesFault = input.faultClass === "PROMOTION"
        ? input.lkgReadback.behavior === "EXACT_PRE_PROMOTION_RESTORED"
        : input.lkgReadback.behavior === "UNCHANGED";
    const evidenceComplete = cleanupReceipt.zeroResidue && cleanupReceipt.runnerReleased
        && sloMetrics.met && lkgMatchesFault;
    const disposition = evidenceComplete ? "RECOVERY_CONFIRMED" : "RECOVERY_BLOCKED";
    const unsigned = Object.freeze({
        schemaVersion: CCP_FAULT_RECOVERY_RECEIPT_SCHEMA_V1,
        taskId: CCP_FAULT_RECOVERY_TASK_ID_V1,
        faultClass: input.faultClass,
        faultCode: input.faultCode,
        faultInjected: true,
        logicalAtMs: input.logicalAtMs,
        cleanupReceipt,
        cleanupReceiptDigest: cleanupReceipt.receiptDigest,
        sloObservation: input.sloObservation,
        sloMetrics,
        lkgReadback: input.lkgReadback,
        lkgBehavior: input.lkgReadback.behavior,
        disposition,
        transition: transitionFor(input, evidenceComplete),
        recoveryEvidenceComplete: evidenceComplete,
        cleanupRequired: true,
        zeroResidue: cleanupReceipt.zeroResidue,
        runnerReleased: cleanupReceipt.runnerReleased,
        authorization: Object.freeze({
            verificationClaimed: false,
            verificationAuthorized: false,
            executionAuthorized: false,
            promotionAuthorized: false,
            mergeAuthorized: false,
        }),
    });
    return Object.freeze({
        ...unsigned,
        receiptDigest: ccpDigestDomainV1(CCP_FAULT_RECOVERY_RECEIPT_SCHEMA_V1, unsigned),
    });
}
/** Parse a recovery SLO observation independently for callers that persist it. */
export function parseCcpRecoverySloObservationV1(value) {
    return parseSloObservation(value);
}
/** Parse and close an exact-LKG recovery readback. */
export function parseCcpLkgRecoveryReadbackV1(value) {
    return parseLkgReadback(value);
}
/** Compose an injected fault with cleanup, recovery SLO and LKG readback evidence. */
export function composeCcpFaultRecoveryV1(value) {
    return makeReceipt(parseInput(value));
}
export const evaluateCcpFaultRecoveryV1 = composeCcpFaultRecoveryV1;
export const issueCcpFaultRecoveryReceiptV1 = composeCcpFaultRecoveryV1;
function parseMetrics(value) {
    const record = readCcpClosedObjectV1(value, METRIC_KEYS, new WeakSet(), RECEIPT_DENIED);
    const attempts = assertCcpSafeUnsignedIntegerV1(record.attempts, RECEIPT_DENIED);
    const recovered = assertCcpSafeUnsignedIntegerV1(record.recovered, RECEIPT_DENIED);
    const failed = assertCcpSafeUnsignedIntegerV1(record.failed, RECEIPT_DENIED);
    const recoveryRateBps = assertCcpSafeUnsignedIntegerV1(record.recoveryRateBps, RECEIPT_DENIED);
    const targetRecoveryRateBps = assertCcpSafeUnsignedIntegerV1(record.targetRecoveryRateBps, RECEIPT_DENIED);
    if (typeof record.met !== "boolean" || recovered > attempts || failed > attempts
        || recovered + failed > attempts || recoveryRateBps > 10000 || targetRecoveryRateBps > 10000)
        ccpStrictDenyV1(RECEIPT_DENIED);
    return Object.freeze({ attempts, recovered, failed, recoveryRateBps, targetRecoveryRateBps, met: record.met });
}
function parseAuthorization(value) {
    const record = readCcpClosedObjectV1(value, AUTHORIZATION_KEYS, new WeakSet(), RECEIPT_DENIED);
    if (record.verificationClaimed !== false || record.verificationAuthorized !== false
        || record.executionAuthorized !== false || record.promotionAuthorized !== false || record.mergeAuthorized !== false) {
        ccpStrictDenyV1(RECEIPT_DENIED);
    }
    return Object.freeze({
        verificationClaimed: false,
        verificationAuthorized: false,
        executionAuthorized: false,
        promotionAuthorized: false,
        mergeAuthorized: false,
    });
}
/** Parse and re-derive the complete recovery receipt; forged success denies. */
export function parseCcpFaultRecoveryReceiptV1(value) {
    const record = readCcpClosedObjectV1(value, RECEIPT_KEYS, new WeakSet(), RECEIPT_DENIED);
    if (record.schemaVersion !== CCP_FAULT_RECOVERY_RECEIPT_SCHEMA_V1
        || record.taskId !== CCP_FAULT_RECOVERY_TASK_ID_V1 || record.faultInjected !== true
        || record.cleanupRequired !== true)
        ccpStrictDenyV1(RECEIPT_DENIED);
    const cleanupReceipt = parseCcpRunnerCleanupReceiptV1(record.cleanupReceipt);
    const cleanupReceiptDigest = assertCcpDigestV1(record.cleanupReceiptDigest, RECEIPT_DENIED);
    if (cleanupReceiptDigest !== cleanupReceipt.receiptDigest)
        ccpStrictDenyV1(RECEIPT_DENIED);
    const sloObservation = parseSloObservation(record.sloObservation);
    const lkgReadback = parseLkgReadback(record.lkgReadback);
    const faultClass = enumValue(record.faultClass, CCP_FAULT_CLASSES_V1, RECEIPT_DENIED);
    const faultCode = enumValue(record.faultCode, CCP_FAULT_CODES_V1, RECEIPT_DENIED);
    if (FAULT_TO_CLASS[faultCode] !== faultClass)
        ccpStrictDenyV1(RECEIPT_DENIED);
    const logicalAtMs = assertCcpSafeUnsignedIntegerV1(record.logicalAtMs, RECEIPT_DENIED);
    if (sloObservation.logicalAtMs > logicalAtMs)
        ccpStrictDenyV1(RECEIPT_DENIED);
    const input = Object.freeze({
        schemaVersion: CCP_FAULT_RECOVERY_INPUT_SCHEMA_V1,
        taskId: CCP_FAULT_RECOVERY_TASK_ID_V1,
        faultClass,
        faultCode,
        faultInjected: true,
        logicalAtMs,
        cleanup: Object.freeze({ request: cleanupReceipt.request, observation: cleanupReceipt.observation }),
        sloObservation,
        lkgReadback,
    });
    const expected = makeReceipt(input);
    const sloMetrics = parseMetrics(record.sloMetrics);
    const authorization = parseAuthorization(record.authorization);
    if (canonicalJson(sloMetrics) !== canonicalJson(expected.sloMetrics)
        || record.lkgBehavior !== expected.lkgBehavior
        || record.disposition !== expected.disposition
        || record.transition !== expected.transition
        || record.recoveryEvidenceComplete !== expected.recoveryEvidenceComplete
        || record.zeroResidue !== expected.zeroResidue
        || record.runnerReleased !== expected.runnerReleased
        || canonicalJson(authorization) !== canonicalJson(expected.authorization))
        ccpStrictDenyV1(RECEIPT_DENIED);
    const receiptDigest = assertCcpDigestV1(record.receiptDigest, RECEIPT_DENIED);
    if (receiptDigest !== expected.receiptDigest)
        ccpStrictDenyV1(RECEIPT_DENIED);
    return expected;
}
export function canonicalCcpFaultRecoveryReceiptJsonV1(value) {
    return canonicalJson(parseCcpFaultRecoveryReceiptV1(value));
}
export function ccpFaultRecoveryReceiptDigestV1(value) {
    return parseCcpFaultRecoveryReceiptV1(value).receiptDigest;
}
export function verifyCcpFaultRecoveryReceiptV1(value) {
    try {
        return parseCcpFaultRecoveryReceiptV1(value);
    }
    catch {
        return null;
    }
}
