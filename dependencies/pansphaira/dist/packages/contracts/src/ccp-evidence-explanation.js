import { canonicalJson } from "./canonical-json.js";
import { assertCcpDigestV1, assertCcpSafeUnsignedIntegerV1, assertCcpStringV1, ccpDigestDomainV1, ccpStrictDenyV1, CONTRIBUTION_ID_PATTERN, LEDGER_ID_PATTERN, readCcpClosedObjectV1, readCcpDenseArrayV1, REPOSITORY_ID_PATTERN, TENANT_ID_PATTERN, } from "./ccp-event-envelope.js";
import { CCP_CONTRIBUTOR_NEXT_ACTIONS_V1, CCP_CONTRIBUTOR_REASON_CODES_V1, CCP_CONTRIBUTOR_STATUS_KINDS_V1, parseCcpContributorStatusV1, } from "./ccp-contributor-status.js";
/**
 * Public-safe reason-code explanations for contributor status. Explanations
 * are intentionally fixed text plus bounded evidence counts: raw evidence,
 * private details, credentials, paths and nested receipt payloads are never
 * copied into this contract.
 */
export const CCP_EVIDENCE_EXPLANATION_SCHEMA_V1 = "cm.ccp-evidence-explanation/v1";
export const CCP_EVIDENCE_EXPLANATION_REDACTION_POLICY_V1 = "PUBLIC_REASON_CODE_ONLY";
export const CCP_EVIDENCE_EXPLANATION_REDACTED_FIELDS_V1 = Object.freeze([
    "rawEvidence",
    "privateDetails",
    "credentialMaterial",
    "internalReceiptPayload",
]);
const EXPLANATION_KEYS = Object.freeze([
    "schemaVersion", "ledgerId", "tenantId", "repositoryId", "contributionId", "statusDigest", "status",
    "reasonCode", "nextAction", "publicMessage", "evidence", "redactionPolicy", "redacted", "redactedFields",
    "readOnly", "queueStateChanged", "mergeAuthorized", "explanationDigest",
]);
const EVIDENCE_KEYS = Object.freeze([
    "requiredCount", "presentCount", "missingCount", "complete", "receiptEvidenceComplete",
]);
const EXPLANATION_DENIED = "CCP_EVIDENCE_EXPLANATION_SCHEMA_DENIED";
const PUBLIC_MESSAGES = Object.freeze({
    QUEUED: "The contribution is admitted and queued for bounded verification.",
    READY: "The contribution is admitted but is not currently queued.",
    SUPERSEDED: "A newer contribution head is current; this head is no longer eligible.",
    QUARANTINED: "The contribution is quarantined pending bounded review.",
    MISSING_EVIDENCE: "Required evidence is missing; no success or queue claim is made.",
    REBASE_REQUIRED: "Migration or rebase evidence requires contributor action before processing can continue.",
    LKG_RESTORED: "The last-known-good state was restored after a verification regression.",
});
function enumValue(value, values) {
    if (typeof value !== "string" || !values.includes(value))
        ccpStrictDenyV1(EXPLANATION_DENIED);
    return value;
}
function normalizeEvidence(value, seen) {
    const record = readCcpClosedObjectV1(value, EVIDENCE_KEYS, seen, EXPLANATION_DENIED);
    const requiredCount = assertCcpSafeUnsignedIntegerV1(record.requiredCount, EXPLANATION_DENIED);
    const presentCount = assertCcpSafeUnsignedIntegerV1(record.presentCount, EXPLANATION_DENIED);
    const missingCount = assertCcpSafeUnsignedIntegerV1(record.missingCount, EXPLANATION_DENIED);
    if (presentCount > requiredCount || missingCount !== requiredCount - presentCount
        || typeof record.receiptEvidenceComplete !== "boolean"
        || record.complete !== (missingCount === 0 && record.receiptEvidenceComplete))
        ccpStrictDenyV1(EXPLANATION_DENIED);
    return Object.freeze({
        requiredCount,
        presentCount,
        missingCount,
        complete: missingCount === 0 && record.receiptEvidenceComplete,
        receiptEvidenceComplete: record.receiptEvidenceComplete,
    });
}
function makeExplanation(status) {
    const unsigned = Object.freeze({
        schemaVersion: CCP_EVIDENCE_EXPLANATION_SCHEMA_V1,
        ledgerId: status.ledgerId,
        tenantId: status.tenantId,
        repositoryId: status.repositoryId,
        contributionId: status.contributionId,
        statusDigest: status.statusDigest,
        status: status.status,
        reasonCode: status.reasonCode,
        nextAction: status.nextAction,
        publicMessage: PUBLIC_MESSAGES[status.status],
        evidence: Object.freeze({
            requiredCount: status.evidence.requiredCount,
            presentCount: status.evidence.presentCount,
            missingCount: status.evidence.missingCount,
            complete: status.evidence.complete,
            receiptEvidenceComplete: status.evidence.receiptEvidenceComplete,
        }),
        redactionPolicy: CCP_EVIDENCE_EXPLANATION_REDACTION_POLICY_V1,
        redacted: true,
        redactedFields: CCP_EVIDENCE_EXPLANATION_REDACTED_FIELDS_V1,
        readOnly: true,
        queueStateChanged: false,
        mergeAuthorized: false,
    });
    return Object.freeze({
        ...unsigned,
        explanationDigest: ccpDigestDomainV1(CCP_EVIDENCE_EXPLANATION_SCHEMA_V1, unsigned),
    });
}
/** Explain a contributor status using only fixed public-safe reason text. */
export function makeCcpEvidenceExplanationV1(status) {
    return makeExplanation(parseCcpContributorStatusV1(status));
}
/** Alias emphasizing that explanation is derived from contributor status. */
export const explainCcpContributorStatusV1 = makeCcpEvidenceExplanationV1;
function normalizeExplanation(value) {
    const seen = new WeakSet();
    const record = readCcpClosedObjectV1(value, EXPLANATION_KEYS, seen, EXPLANATION_DENIED);
    if (record.schemaVersion !== CCP_EVIDENCE_EXPLANATION_SCHEMA_V1
        || record.redactionPolicy !== CCP_EVIDENCE_EXPLANATION_REDACTION_POLICY_V1
        || record.redacted !== true || record.readOnly !== true
        || record.queueStateChanged !== false || record.mergeAuthorized !== false)
        ccpStrictDenyV1(EXPLANATION_DENIED);
    const statusDigest = assertCcpDigestV1(record.statusDigest, EXPLANATION_DENIED);
    const ledgerId = assertCcpStringV1(record.ledgerId, LEDGER_ID_PATTERN, EXPLANATION_DENIED);
    const tenantId = assertCcpStringV1(record.tenantId, TENANT_ID_PATTERN, EXPLANATION_DENIED);
    const repositoryId = assertCcpStringV1(record.repositoryId, REPOSITORY_ID_PATTERN, EXPLANATION_DENIED);
    const contributionId = assertCcpStringV1(record.contributionId, CONTRIBUTION_ID_PATTERN, EXPLANATION_DENIED);
    const status = enumValue(record.status, CCP_CONTRIBUTOR_STATUS_KINDS_V1);
    const reasonCode = enumValue(record.reasonCode, CCP_CONTRIBUTOR_REASON_CODES_V1);
    const nextAction = enumValue(record.nextAction, CCP_CONTRIBUTOR_NEXT_ACTIONS_V1);
    const expectedReason = {
        QUEUED: "QUEUED_WITH_COMPLETE_EVIDENCE",
        READY: "ADMITTED_NOT_QUEUED",
        SUPERSEDED: "HEAD_SUPERSEDED",
        QUARANTINED: "CONTRIBUTION_QUARANTINED",
        MISSING_EVIDENCE: "REQUIRED_EVIDENCE_MISSING",
        REBASE_REQUIRED: "MIGRATION_REBASE_REQUIRED",
        LKG_RESTORED: "LKG_RESTORED",
    };
    const expectedAction = {
        QUEUED: "WAIT_FOR_VERIFICATION",
        READY: "CONTRIBUTOR_ACTION_REQUIRED",
        SUPERSEDED: "NO_ACTION_HEAD_SUPERSEDED",
        QUARANTINED: "REVIEW_QUARANTINE",
        MISSING_EVIDENCE: "PROVIDE_REQUIRED_EVIDENCE",
        REBASE_REQUIRED: "REBASE_AND_RESUBMIT",
        LKG_RESTORED: "REVERIFY_RESTORED_LKG",
    };
    if (reasonCode !== expectedReason[status] || nextAction !== expectedAction[status])
        ccpStrictDenyV1(EXPLANATION_DENIED);
    if (typeof record.publicMessage !== "string" || record.publicMessage !== PUBLIC_MESSAGES[status]) {
        ccpStrictDenyV1(EXPLANATION_DENIED);
    }
    const evidence = normalizeEvidence(record.evidence, seen);
    const redactedFieldsRaw = readCcpDenseArrayV1(record.redactedFields, seen, EXPLANATION_DENIED);
    if (redactedFieldsRaw.length !== CCP_EVIDENCE_EXPLANATION_REDACTED_FIELDS_V1.length
        || redactedFieldsRaw.some((item, index) => item !== CCP_EVIDENCE_EXPLANATION_REDACTED_FIELDS_V1[index])) {
        ccpStrictDenyV1(EXPLANATION_DENIED);
    }
    const unsigned = Object.freeze({
        schemaVersion: CCP_EVIDENCE_EXPLANATION_SCHEMA_V1,
        ledgerId,
        tenantId,
        repositoryId,
        contributionId,
        statusDigest,
        status,
        reasonCode,
        nextAction,
        publicMessage: record.publicMessage,
        evidence,
        redactionPolicy: CCP_EVIDENCE_EXPLANATION_REDACTION_POLICY_V1,
        redacted: true,
        redactedFields: CCP_EVIDENCE_EXPLANATION_REDACTED_FIELDS_V1,
        readOnly: true,
        queueStateChanged: false,
        mergeAuthorized: false,
    });
    const explanationDigest = assertCcpDigestV1(record.explanationDigest, EXPLANATION_DENIED);
    if (ccpDigestDomainV1(CCP_EVIDENCE_EXPLANATION_SCHEMA_V1, unsigned) !== explanationDigest) {
        ccpStrictDenyV1(EXPLANATION_DENIED);
    }
    return Object.freeze({ ...unsigned, explanationDigest });
}
export function parseCcpEvidenceExplanationV1(value) {
    return normalizeExplanation(value);
}
export function canonicalCcpEvidenceExplanationJsonV1(value) {
    return canonicalJson(parseCcpEvidenceExplanationV1(value));
}
export function ccpEvidenceExplanationDigestV1(value) {
    return parseCcpEvidenceExplanationV1(value).explanationDigest;
}
export function verifyCcpEvidenceExplanationV1(value) {
    try {
        return parseCcpEvidenceExplanationV1(value);
    }
    catch {
        return null;
    }
}
