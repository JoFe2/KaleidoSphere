import { canonicalJson } from "./canonical-json.js";
import { assertCcpDigestV1, assertCcpSafeUnsignedIntegerV1, ccpDigestDomainV1, ccpStrictDenyV1, readCcpClosedObjectV1, } from "./ccp-event-envelope.js";
import { parseCcpFaultRecoveryReceiptV1, } from "./ccp-fault-recovery.js";
/**
 * Deterministic read-back for the bounded failure-recovery receipt. Read-back
 * is an observation of already-issued evidence: it does not re-run recovery,
 * retry queue/API work, verify a candidate, or grant execution/promotion/
 * merge authority. A blocked recovery remains blocked on read-back; it is not
 * converted into success by this projection.
 */
export const CCP_RECOVERY_READBACK_INPUT_SCHEMA_V1 = "cm.ccp-recovery-readback-input/v1";
export const CCP_RECOVERY_READBACK_RECEIPT_SCHEMA_V1 = "cm.ccp-recovery-readback-receipt/v1";
export const CCP_RECOVERY_READBACK_TASK_ID_V1 = "QWEN-PSAI52-FAILURE-RECOVERY-09";
export const CCP_RECOVERY_READBACK_DISPOSITIONS_V1 = Object.freeze([
    "READBACK_CONFIRMED", "READBACK_BLOCKED",
]);
const INPUT_KEYS = Object.freeze(["schemaVersion", "taskId", "recoveryReceipt", "logicalAtMs"]);
const RECEIPT_KEYS = Object.freeze([
    "schemaVersion", "taskId", "recoveryReceipt", "recoveryReceiptDigest", "faultClass", "faultCode", "transition",
    "recoveryDisposition", "cleanup", "slo", "lkg", "verificationClaimed", "executionAuthorized",
    "promotionAuthorized", "mergeAuthorized", "readbackDisposition", "readbackDigest",
]);
const CLEANUP_KEYS = Object.freeze(["cleanupReceiptDigest", "cleanupRequired", "zeroResidue", "runnerReleased"]);
const SLO_KEYS = Object.freeze(["attempts", "recovered", "failed", "recoveryRateBps", "targetRecoveryRateBps", "met"]);
const LKG_KEYS = Object.freeze([
    "behavior", "beforeLkgDigest", "afterLkgDigest", "beforeGeneration", "afterGeneration", "exact", "transitionDigest",
]);
const DENIED = "CCP_RECOVERY_READBACK_SCHEMA_DENIED";
function makeReadback(receipt) {
    const exact = receipt.lkgReadback.behavior === "UNCHANGED"
        ? receipt.lkgReadback.beforeState.stateDigest === receipt.lkgReadback.afterState.stateDigest
            && receipt.lkgReadback.beforeState.lkgDigest === receipt.lkgReadback.afterState.lkgDigest
        : receipt.lkgReadback.afterState.lkgDigest === receipt.lkgReadback.expectedAfterLkgDigest
            && receipt.lkgReadback.afterState.generation === receipt.lkgReadback.beforeState.generation + 1;
    const recoveryDisposition = receipt.disposition === "RECOVERY_CONFIRMED"
        ? "READBACK_CONFIRMED" : "READBACK_BLOCKED";
    const unsigned = Object.freeze({
        schemaVersion: CCP_RECOVERY_READBACK_RECEIPT_SCHEMA_V1,
        taskId: CCP_RECOVERY_READBACK_TASK_ID_V1,
        recoveryReceipt: receipt,
        recoveryReceiptDigest: receipt.receiptDigest,
        faultClass: receipt.faultClass,
        faultCode: receipt.faultCode,
        transition: receipt.transition,
        recoveryDisposition: receipt.disposition,
        cleanup: Object.freeze({
            cleanupReceiptDigest: receipt.cleanupReceiptDigest,
            cleanupRequired: true,
            zeroResidue: receipt.zeroResidue,
            runnerReleased: receipt.runnerReleased,
        }),
        slo: Object.freeze({ ...receipt.sloMetrics }),
        lkg: Object.freeze({
            behavior: receipt.lkgReadback.behavior,
            beforeLkgDigest: receipt.lkgReadback.beforeState.lkgDigest,
            afterLkgDigest: receipt.lkgReadback.afterState.lkgDigest,
            beforeGeneration: receipt.lkgReadback.beforeState.generation,
            afterGeneration: receipt.lkgReadback.afterState.generation,
            exact,
            transitionDigest: receipt.lkgReadback.transitionDigest,
        }),
        verificationClaimed: false,
        executionAuthorized: false,
        promotionAuthorized: false,
        mergeAuthorized: false,
        readbackDisposition: recoveryDisposition,
    });
    return Object.freeze({
        ...unsigned,
        readbackDigest: ccpDigestDomainV1(CCP_RECOVERY_READBACK_RECEIPT_SCHEMA_V1, unsigned),
    });
}
/** Issue a deterministic read-back receipt from a canonical recovery receipt. */
export function issueCcpRecoveryReadbackReceiptV1(value) {
    const input = readCcpClosedObjectV1(value, INPUT_KEYS, new WeakSet(), DENIED);
    if (input.schemaVersion !== CCP_RECOVERY_READBACK_INPUT_SCHEMA_V1
        || input.taskId !== CCP_RECOVERY_READBACK_TASK_ID_V1)
        ccpStrictDenyV1(DENIED);
    const logicalAtMs = assertCcpSafeUnsignedIntegerV1(input.logicalAtMs, DENIED);
    const recoveryReceipt = parseCcpFaultRecoveryReceiptV1(input.recoveryReceipt);
    if (logicalAtMs < recoveryReceipt.logicalAtMs)
        ccpStrictDenyV1(DENIED);
    return makeReadback(recoveryReceipt);
}
export const composeCcpRecoveryReadbackV1 = issueCcpRecoveryReadbackReceiptV1;
export const evaluateCcpRecoveryReadbackV1 = issueCcpRecoveryReadbackReceiptV1;
function parseReadback(value) {
    const record = readCcpClosedObjectV1(value, RECEIPT_KEYS, new WeakSet(), DENIED);
    if (record.schemaVersion !== CCP_RECOVERY_READBACK_RECEIPT_SCHEMA_V1
        || record.taskId !== CCP_RECOVERY_READBACK_TASK_ID_V1
        || record.verificationClaimed !== false || record.executionAuthorized !== false
        || record.promotionAuthorized !== false || record.mergeAuthorized !== false)
        ccpStrictDenyV1(DENIED);
    const recoveryReceipt = parseCcpFaultRecoveryReceiptV1(record.recoveryReceipt);
    const recoveryReceiptDigest = assertCcpDigestV1(record.recoveryReceiptDigest, DENIED);
    if (recoveryReceiptDigest !== recoveryReceipt.receiptDigest)
        ccpStrictDenyV1(DENIED);
    const cleanup = readCcpClosedObjectV1(record.cleanup, CLEANUP_KEYS, new WeakSet(), DENIED);
    const cleanupReceiptDigest = assertCcpDigestV1(cleanup.cleanupReceiptDigest, DENIED);
    if (cleanup.cleanupRequired !== true || typeof cleanup.zeroResidue !== "boolean"
        || typeof cleanup.runnerReleased !== "boolean")
        ccpStrictDenyV1(DENIED);
    const slo = readCcpClosedObjectV1(record.slo, SLO_KEYS, new WeakSet(), DENIED);
    const attempts = assertCcpSafeUnsignedIntegerV1(slo.attempts, DENIED);
    const recovered = assertCcpSafeUnsignedIntegerV1(slo.recovered, DENIED);
    const failed = assertCcpSafeUnsignedIntegerV1(slo.failed, DENIED);
    const recoveryRateBps = assertCcpSafeUnsignedIntegerV1(slo.recoveryRateBps, DENIED);
    const targetRecoveryRateBps = assertCcpSafeUnsignedIntegerV1(slo.targetRecoveryRateBps, DENIED);
    if (recovered > attempts || failed > attempts || recovered + failed > attempts
        || recoveryRateBps > 10000 || targetRecoveryRateBps > 10000 || typeof slo.met !== "boolean")
        ccpStrictDenyV1(DENIED);
    const lkg = readCcpClosedObjectV1(record.lkg, LKG_KEYS, new WeakSet(), DENIED);
    const behavior = lkg.behavior;
    if (behavior !== "UNCHANGED" && behavior !== "EXACT_PRE_PROMOTION_RESTORED")
        ccpStrictDenyV1(DENIED);
    const lkgValue = {
        behavior,
        beforeLkgDigest: assertCcpDigestV1(lkg.beforeLkgDigest, DENIED),
        afterLkgDigest: assertCcpDigestV1(lkg.afterLkgDigest, DENIED),
        beforeGeneration: assertCcpSafeUnsignedIntegerV1(lkg.beforeGeneration, DENIED),
        afterGeneration: assertCcpSafeUnsignedIntegerV1(lkg.afterGeneration, DENIED),
        exact: typeof lkg.exact === "boolean" ? lkg.exact : (() => { ccpStrictDenyV1(DENIED); })(),
        transitionDigest: lkg.transitionDigest === null ? null : assertCcpDigestV1(lkg.transitionDigest, DENIED),
    };
    if (typeof record.recoveryDisposition !== "string"
        || (record.recoveryDisposition !== "RECOVERY_CONFIRMED" && record.recoveryDisposition !== "RECOVERY_BLOCKED")
        || typeof record.readbackDisposition !== "string"
        || (record.readbackDisposition !== "READBACK_CONFIRMED" && record.readbackDisposition !== "READBACK_BLOCKED"))
        ccpStrictDenyV1(DENIED);
    const receipt = Object.freeze({
        schemaVersion: CCP_RECOVERY_READBACK_RECEIPT_SCHEMA_V1,
        taskId: CCP_RECOVERY_READBACK_TASK_ID_V1,
        recoveryReceipt,
        recoveryReceiptDigest,
        faultClass: record.faultClass,
        faultCode: record.faultCode,
        transition: record.transition,
        recoveryDisposition: record.recoveryDisposition,
        cleanup: Object.freeze({ cleanupReceiptDigest, cleanupRequired: true, zeroResidue: cleanup.zeroResidue, runnerReleased: cleanup.runnerReleased }),
        slo: Object.freeze({ attempts, recovered, failed, recoveryRateBps, targetRecoveryRateBps, met: slo.met }),
        lkg: Object.freeze(lkgValue),
        verificationClaimed: false,
        executionAuthorized: false,
        promotionAuthorized: false,
        mergeAuthorized: false,
        readbackDisposition: record.readbackDisposition,
        readbackDigest: assertCcpDigestV1(record.readbackDigest, DENIED),
    });
    return receipt;
}
/** Parse and re-derive a readback receipt, including its referenced recovery receipt. */
export function parseCcpRecoveryReadbackReceiptV1(value) {
    const parsed = parseReadback(value);
    const expected = makeReadback(parsed.recoveryReceipt);
    if (canonicalJson(parsed) !== canonicalJson(expected))
        ccpStrictDenyV1(DENIED);
    return parsed;
}
export function canonicalCcpRecoveryReadbackJsonV1(value) {
    return canonicalJson(parseCcpRecoveryReadbackReceiptV1(value));
}
export function verifyCcpRecoveryReadbackReceiptV1(value) {
    try {
        return parseCcpRecoveryReadbackReceiptV1(value);
    }
    catch {
        return null;
    }
}
export function ccpRecoveryReadbackReceiptDigestV1(value) {
    return parseCcpRecoveryReadbackReceiptV1(value).readbackDigest;
}
