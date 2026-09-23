import { canonicalJson } from "./canonical-json.js";
import { assertCcpDigestV1, assertCcpSafePositiveIntegerV1, assertCcpStringV1, ccpDigestDomainV1, ccpStrictDenyV1, CONTRIBUTION_ID_PATTERN, DELIVERY_ID_PATTERN, LEDGER_ID_PATTERN, REPOSITORY_ID_PATTERN, readCcpClosedObjectV1, TENANT_ID_PATTERN, } from "./ccp-event-envelope.js";
import { CCP_COMPONENT_IDS_V1, CCP_RISK_CLASSES_V1 } from "./ccp-risk-routing.js";
import { parseCcpAdmissionReceiptV1, } from "./ccp-admission-gate.js";
/**
 * CCP PSAI52 bounded intake boundary (M1 merge-train side): a pure,
 * deterministic gate that labels whether a synthetic candidate may enter
 * the component merge train. A merge-train receipt is a bounded,
 * digest-bound eligibility label: it does not schedule a runner, execute
 * code or authorize a merge. Promotion of a train-eligible candidate is a
 * separate protected decision (see `ccp-lkg-restore`), and no receipt in
 * this module can self-promote a candidate.
 *
 * The gate is fail-closed: unknown components, unknown risk classes,
 * identity drift, scope substitution, stale logical time and stale head
 * replays all deny with a closed reason code. Only a `risk:standard`
 * candidate whose head advances the train and whose logical time is not
 * stale is labeled ELIGIBLE. The admission gate and the risk routing
 * table never grant merge eligibility; this module's bounded label is the
 * first merge-train projection and it is data only.
 *
 * There is no network, persistence, clock, queue, runner or merge
 * capability. `logicalAtMs` values are injected data only. Every receipt
 * carries a domain-bound digest, so any rehashed drift in the candidate,
 * context, disposition or eligibility label denies on read-back.
 */
export const CCP_TRAIN_CANDIDATE_SCHEMA_V1 = "cm.ccp-train-candidate/v1";
export const CCP_TRAIN_CONTEXT_SCHEMA_V1 = "cm.ccp-train-context/v1";
export const CCP_TRAIN_RECEIPT_SCHEMA_V1 = "cm.ccp-train-receipt/v1";
export const CCP_TRAIN_DISPOSITIONS_V1 = Object.freeze(["ELIGIBLE", "INELIGIBLE"]);
/** Closed reason vocabulary for the merge-train gate; first failure wins. */
export const CCP_TRAIN_REASON_CODES_V1 = Object.freeze([
    "ELIGIBLE_TRAIN_ASSIGNED",
    "ELEVATED_RISK_CLASS",
    "IDENTITY_MISMATCH",
    "MALICIOUS_RISK_CLASS",
    "SCOPE_SUBSTITUTION",
    "STALE_HEAD_REPLAY",
    "STALE_LOGICAL_TIME",
    "UNKNOWN_COMPONENT",
    "UNKNOWN_RISK_CLASS",
    "ADMISSION_RECEIPT_UNVERIFIED",
    "ADMISSION_RECEIPT_SUBJECT_MISMATCH",
]);
const TRAIN_CANDIDATE_SCHEMA_DENIED = "CCP_TRAIN_CANDIDATE_SCHEMA_DENIED";
const TRAIN_CONTEXT_SCHEMA_DENIED = "CCP_TRAIN_CONTEXT_SCHEMA_DENIED";
const TRAIN_RECEIPT_SCHEMA_DENIED = "CCP_TRAIN_RECEIPT_SCHEMA_DENIED";
const TRAIN_CANDIDATE_KEYS = Object.freeze([
    "schemaVersion", "ledgerId", "tenantId", "repositoryId", "contributionId", "deliveryId",
    "componentId", "headDigest", "payloadDigest", "riskClass", "logicalAtMs",
    "admissionReceipt", "admissionReceiptDigest",
]);
const TRAIN_CONTEXT_KEYS = Object.freeze([
    "schemaVersion", "ledgerId", "tenantId", "repositoryId", "contributionId", "componentId",
    "trainHeadDigest", "lastTrainedLogicalAtMs",
]);
const TRAIN_RECEIPT_KEYS = Object.freeze([
    "schemaVersion", "candidate", "candidateDigest", "context", "contextDigest",
    "disposition", "reasonCode", "eligibility", "receiptDigest",
]);
const TRAIN_ELIGIBILITY_KEYS = Object.freeze(["mergeTrainEligible"]);
function assertKnownComponent(componentId, code) {
    if (typeof componentId !== "string"
        || !CCP_COMPONENT_IDS_V1.includes(componentId)) {
        ccpStrictDenyV1(code);
    }
    return componentId;
}
function assertKnownRiskClass(riskClass, code) {
    if (typeof riskClass !== "string"
        || !CCP_RISK_CLASSES_V1.includes(riskClass)) {
        ccpStrictDenyV1(code);
    }
    return riskClass;
}
function readTrainIdentity(record, code) {
    return {
        ledgerId: assertCcpStringV1(record.ledgerId, LEDGER_ID_PATTERN, code),
        tenantId: assertCcpStringV1(record.tenantId, TENANT_ID_PATTERN, code),
        repositoryId: assertCcpStringV1(record.repositoryId, REPOSITORY_ID_PATTERN, code),
        contributionId: assertCcpStringV1(record.contributionId, CONTRIBUTION_ID_PATTERN, code),
    };
}
/** Parse and close a train candidate; any drift denies fail-closed. */
export function parseCcpTrainCandidateV1(value) {
    const record = readCcpClosedObjectV1(value, TRAIN_CANDIDATE_KEYS, new WeakSet(), TRAIN_CANDIDATE_SCHEMA_DENIED);
    if (record.schemaVersion !== CCP_TRAIN_CANDIDATE_SCHEMA_V1) {
        ccpStrictDenyV1(TRAIN_CANDIDATE_SCHEMA_DENIED);
    }
    const identity = readTrainIdentity(record, TRAIN_CANDIDATE_SCHEMA_DENIED);
    const admissionReceipt = parseCcpAdmissionReceiptV1(record.admissionReceipt);
    if (admissionReceipt.disposition !== "ADMITTED"
        || admissionReceipt.receiptDigest !== record.admissionReceiptDigest) {
        ccpStrictDenyV1(TRAIN_CANDIDATE_SCHEMA_DENIED);
    }
    const candidate = Object.freeze({
        schemaVersion: CCP_TRAIN_CANDIDATE_SCHEMA_V1,
        ...identity,
        deliveryId: assertCcpStringV1(record.deliveryId, DELIVERY_ID_PATTERN, TRAIN_CANDIDATE_SCHEMA_DENIED),
        componentId: assertKnownComponent(record.componentId, TRAIN_CANDIDATE_SCHEMA_DENIED),
        headDigest: assertCcpDigestV1(record.headDigest, TRAIN_CANDIDATE_SCHEMA_DENIED),
        payloadDigest: assertCcpDigestV1(record.payloadDigest, TRAIN_CANDIDATE_SCHEMA_DENIED),
        riskClass: assertKnownRiskClass(record.riskClass, TRAIN_CANDIDATE_SCHEMA_DENIED),
        logicalAtMs: assertCcpSafePositiveIntegerV1(record.logicalAtMs, TRAIN_CANDIDATE_SCHEMA_DENIED),
        admissionReceipt,
        admissionReceiptDigest: assertCcpDigestV1(record.admissionReceiptDigest, TRAIN_CANDIDATE_SCHEMA_DENIED),
    });
    return candidate;
}
/** Parse and close a train context; any drift denies fail-closed. */
export function parseCcpTrainContextV1(value) {
    const record = readCcpClosedObjectV1(value, TRAIN_CONTEXT_KEYS, new WeakSet(), TRAIN_CONTEXT_SCHEMA_DENIED);
    if (record.schemaVersion !== CCP_TRAIN_CONTEXT_SCHEMA_V1) {
        ccpStrictDenyV1(TRAIN_CONTEXT_SCHEMA_DENIED);
    }
    const identity = readTrainIdentity(record, TRAIN_CONTEXT_SCHEMA_DENIED);
    const context = Object.freeze({
        schemaVersion: CCP_TRAIN_CONTEXT_SCHEMA_V1,
        ...identity,
        componentId: assertKnownComponent(record.componentId, TRAIN_CONTEXT_SCHEMA_DENIED),
        trainHeadDigest: assertCcpDigestV1(record.trainHeadDigest, TRAIN_CONTEXT_SCHEMA_DENIED),
        lastTrainedLogicalAtMs: assertCcpSafePositiveIntegerV1(record.lastTrainedLogicalAtMs, TRAIN_CONTEXT_SCHEMA_DENIED),
    });
    return context;
}
/** Canonical JSON of the closed candidate; byte order independent of input key order. */
export function canonicalCcpTrainCandidateJsonV1(value) {
    return canonicalJson(parseCcpTrainCandidateV1(value));
}
/** Domain-bound content digest of the closed candidate. */
export function ccpTrainCandidateDigestV1(value) {
    return ccpDigestDomainV1(CCP_TRAIN_CANDIDATE_SCHEMA_V1, parseCcpTrainCandidateV1(value));
}
/** Canonical JSON of the closed context; byte order independent of input key order. */
export function canonicalCcpTrainContextJsonV1(value) {
    return canonicalJson(parseCcpTrainContextV1(value));
}
/** Domain-bound content digest of the closed context. */
export function ccpTrainContextDigestV1(value) {
    return ccpDigestDomainV1(CCP_TRAIN_CONTEXT_SCHEMA_V1, parseCcpTrainContextV1(value));
}
/**
 * Derive the closed gate decision for a candidate against a train context.
 * Checks are finite and ordered; the first failure wins and every outcome
 * is fail-closed.
 */
function deriveTrainDecision(candidate, context) {
    if (candidate.ledgerId !== context.ledgerId
        || candidate.tenantId !== context.tenantId
        || candidate.repositoryId !== context.repositoryId
        || candidate.contributionId !== context.contributionId) {
        return { disposition: "INELIGIBLE", reasonCode: "IDENTITY_MISMATCH" };
    }
    if (candidate.componentId !== context.componentId) {
        return { disposition: "INELIGIBLE", reasonCode: "SCOPE_SUBSTITUTION" };
    }
    if (candidate.logicalAtMs < context.lastTrainedLogicalAtMs) {
        return { disposition: "INELIGIBLE", reasonCode: "STALE_LOGICAL_TIME" };
    }
    if (candidate.headDigest === context.trainHeadDigest) {
        return { disposition: "INELIGIBLE", reasonCode: "STALE_HEAD_REPLAY" };
    }
    if (candidate.riskClass === "risk:malicious") {
        return { disposition: "INELIGIBLE", reasonCode: "MALICIOUS_RISK_CLASS" };
    }
    if (candidate.riskClass !== "risk:standard") {
        return { disposition: "INELIGIBLE", reasonCode: "ELEVATED_RISK_CLASS" };
    }
    if (candidate.admissionReceipt.candidate.ledgerId !== candidate.ledgerId
        || candidate.admissionReceipt.candidate.tenantId !== candidate.tenantId
        || candidate.admissionReceipt.candidate.repositoryId !== candidate.repositoryId
        || candidate.admissionReceipt.candidate.contributionId !== candidate.contributionId
        || candidate.admissionReceipt.candidate.deliveryId !== candidate.deliveryId
        || candidate.admissionReceipt.candidate.componentId !== candidate.componentId
        || candidate.admissionReceipt.candidate.headDigest !== candidate.headDigest
        || candidate.admissionReceipt.candidate.payloadDigest !== candidate.payloadDigest
        || candidate.admissionReceipt.candidate.riskClass !== candidate.riskClass
        || candidate.admissionReceipt.candidate.logicalAtMs !== candidate.logicalAtMs) {
        return { disposition: "INELIGIBLE", reasonCode: "ADMISSION_RECEIPT_SUBJECT_MISMATCH" };
    }
    if (candidate.admissionReceipt.disposition !== "ADMITTED"
        || candidate.admissionReceipt.eligibility.queueEligible !== true
        || candidate.admissionReceipt.eligibility.mergeEligible !== false
        || candidate.admissionReceipt.receiptDigest !== candidate.admissionReceiptDigest) {
        return { disposition: "INELIGIBLE", reasonCode: "ADMISSION_RECEIPT_UNVERIFIED" };
    }
    return { disposition: "ELIGIBLE", reasonCode: "ELIGIBLE_TRAIN_ASSIGNED" };
}
function makeCcpTrainReceiptV1(candidate, context) {
    const decision = deriveTrainDecision(candidate, context);
    const eligibility = Object.freeze({
        mergeTrainEligible: decision.disposition === "ELIGIBLE",
    });
    const candidateDigest = ccpDigestDomainV1(CCP_TRAIN_CANDIDATE_SCHEMA_V1, candidate);
    const contextDigest = ccpDigestDomainV1(CCP_TRAIN_CONTEXT_SCHEMA_V1, context);
    const unsigned = Object.freeze({
        schemaVersion: CCP_TRAIN_RECEIPT_SCHEMA_V1,
        candidate,
        candidateDigest,
        context,
        contextDigest,
        disposition: decision.disposition,
        reasonCode: decision.reasonCode,
        eligibility,
    });
    return Object.freeze({
        ...unsigned,
        receiptDigest: ccpDigestDomainV1(CCP_TRAIN_RECEIPT_SCHEMA_V1, unsigned),
    });
}
/**
 * Evaluate the merge-train gate for a candidate against a train context.
 * Inputs are re-parsed and closed first; malformed inputs deny before any
 * receipt exists. The returned receipt is a bounded eligibility label: it
 * never schedules a runner or authorizes a merge.
 */
export function evaluateCcpTrainGateV1(candidate, context) {
    return makeCcpTrainReceiptV1(parseCcpTrainCandidateV1(candidate), parseCcpTrainContextV1(context));
}
/**
 * Parse and close a merge-train receipt. The candidate and context are
 * re-closed, the gate decision is re-derived and the digest is
 * re-checked; any drift, forged disposition or flipped eligibility label
 * denies with a TypeError carrying the closed denial code.
 */
export function parseCcpTrainReceiptV1(value) {
    const seen = new WeakSet();
    const record = readCcpClosedObjectV1(value, TRAIN_RECEIPT_KEYS, seen, TRAIN_RECEIPT_SCHEMA_DENIED);
    if (record.schemaVersion !== CCP_TRAIN_RECEIPT_SCHEMA_V1) {
        ccpStrictDenyV1(TRAIN_RECEIPT_SCHEMA_DENIED);
    }
    const candidate = parseCcpTrainCandidateV1(record.candidate);
    const context = parseCcpTrainContextV1(record.context);
    const candidateDigest = assertCcpDigestV1(record.candidateDigest, TRAIN_RECEIPT_SCHEMA_DENIED);
    const contextDigest = assertCcpDigestV1(record.contextDigest, TRAIN_RECEIPT_SCHEMA_DENIED);
    if (candidateDigest !== ccpDigestDomainV1(CCP_TRAIN_CANDIDATE_SCHEMA_V1, candidate)) {
        ccpStrictDenyV1(TRAIN_RECEIPT_SCHEMA_DENIED);
    }
    if (contextDigest !== ccpDigestDomainV1(CCP_TRAIN_CONTEXT_SCHEMA_V1, context)) {
        ccpStrictDenyV1(TRAIN_RECEIPT_SCHEMA_DENIED);
    }
    if (typeof record.disposition !== "string"
        || !CCP_TRAIN_DISPOSITIONS_V1.includes(record.disposition)) {
        ccpStrictDenyV1(TRAIN_RECEIPT_SCHEMA_DENIED);
    }
    const disposition = record.disposition;
    if (typeof record.reasonCode !== "string"
        || !CCP_TRAIN_REASON_CODES_V1.includes(record.reasonCode)) {
        ccpStrictDenyV1(TRAIN_RECEIPT_SCHEMA_DENIED);
    }
    const eligibilityRecord = readCcpClosedObjectV1(record.eligibility, TRAIN_ELIGIBILITY_KEYS, seen, TRAIN_RECEIPT_SCHEMA_DENIED);
    if (typeof eligibilityRecord.mergeTrainEligible !== "boolean") {
        ccpStrictDenyV1(TRAIN_RECEIPT_SCHEMA_DENIED);
    }
    const expected = deriveTrainDecision(candidate, context);
    if (disposition !== expected.disposition || record.reasonCode !== expected.reasonCode) {
        ccpStrictDenyV1(TRAIN_RECEIPT_SCHEMA_DENIED);
    }
    if (eligibilityRecord.mergeTrainEligible !== (disposition === "ELIGIBLE")) {
        ccpStrictDenyV1(TRAIN_RECEIPT_SCHEMA_DENIED);
    }
    const unsigned = Object.freeze({
        schemaVersion: CCP_TRAIN_RECEIPT_SCHEMA_V1,
        candidate,
        candidateDigest,
        context,
        contextDigest,
        disposition,
        reasonCode: record.reasonCode,
        eligibility: Object.freeze({ mergeTrainEligible: eligibilityRecord.mergeTrainEligible }),
    });
    const receiptDigest = ccpDigestDomainV1(CCP_TRAIN_RECEIPT_SCHEMA_V1, unsigned);
    if (typeof record.receiptDigest !== "string" || record.receiptDigest !== receiptDigest) {
        ccpStrictDenyV1(TRAIN_RECEIPT_SCHEMA_DENIED);
    }
    return Object.freeze({ ...unsigned, receiptDigest });
}
/** Canonical JSON of the closed receipt; byte order independent of input key order. */
export function canonicalCcpTrainReceiptJsonV1(value) {
    return canonicalJson(parseCcpTrainReceiptV1(value));
}
/** Domain-bound content digest of the closed receipt. */
export function ccpTrainReceiptDigestV1(value) {
    return parseCcpTrainReceiptV1(value).receiptDigest;
}
/**
 * Verify a merge-train receipt on read-back. Returns the closed receipt on
 * success; returns null when the receipt is malformed or forged (any
 * rehashed drift in the candidate, context, disposition, eligibility
 * label or receipt digest).
 */
export function verifyCcpTrainReceiptV1(value) {
    try {
        return parseCcpTrainReceiptV1(value);
    }
    catch {
        return null;
    }
}
