import { canonicalJson } from "./canonical-json.js";
import { assertCcpDigestV1, assertCcpSafeUnsignedIntegerV1, assertCcpStringV1, ccpDigestDomainV1, ccpStrictDenyV1, CONTRIBUTION_ID_PATTERN, LEDGER_ID_PATTERN, readCcpClosedObjectV1, readCcpDenseArrayV1, REPOSITORY_ID_PATTERN, TENANT_ID_PATTERN, } from "./ccp-event-envelope.js";
/**
 * CCP PSAI52 contributor status is a read-only, deterministic projection of
 * already-produced status evidence. It exposes bounded counts and digest
 * references only; it never returns raw evidence, changes queue state,
 * schedules work, authorizes a merge or moves an LKG pointer.
 *
 * Evidence completeness is checked before every positive state. Consequently
 * a missing required reference always projects MISSING_EVIDENCE rather than a
 * queued, current or otherwise successful-looking state.
 */
export const CCP_CONTRIBUTOR_STATUS_INPUT_SCHEMA_V1 = "cm.ccp-contributor-status-input/v1";
export const CCP_CONTRIBUTOR_STATUS_SCHEMA_V1 = "cm.ccp-contributor-status/v1";
export const CCP_CONTRIBUTOR_STATUS_KINDS_V1 = Object.freeze([
    "QUEUED",
    "READY",
    "SUPERSEDED",
    "QUARANTINED",
    "MISSING_EVIDENCE",
    "REBASE_REQUIRED",
    "LKG_RESTORED",
]);
export const CCP_CONTRIBUTOR_REASON_CODES_V1 = Object.freeze([
    "QUEUED_WITH_COMPLETE_EVIDENCE",
    "ADMITTED_NOT_QUEUED",
    "HEAD_SUPERSEDED",
    "CONTRIBUTION_QUARANTINED",
    "REQUIRED_EVIDENCE_MISSING",
    "MIGRATION_REBASE_REQUIRED",
    "LKG_RESTORED",
]);
export const CCP_CONTRIBUTOR_NEXT_ACTIONS_V1 = Object.freeze([
    "WAIT_FOR_VERIFICATION",
    "CONTRIBUTOR_ACTION_REQUIRED",
    "NO_ACTION_HEAD_SUPERSEDED",
    "REVIEW_QUARANTINE",
    "PROVIDE_REQUIRED_EVIDENCE",
    "REBASE_AND_RESUBMIT",
    "REVERIFY_RESTORED_LKG",
]);
const INPUT_KEYS = Object.freeze([
    "schemaVersion", "ledgerId", "tenantId", "repositoryId", "contributionId",
    "admissionState", "headState", "queued", "migrationState", "lkgState",
    "requiredEvidenceRefs", "presentEvidenceRefs", "admissionReceiptDigest",
    "queueReceiptDigest", "quarantineReceiptDigest", "migrationReceiptDigest",
    "lkgRestoreReceiptDigest", "privateDetails",
]);
const EVIDENCE_KEYS = Object.freeze([
    "requiredCount", "presentCount", "missingCount", "complete", "receiptEvidenceComplete",
]);
const RECEIPT_DIGEST_KEYS = Object.freeze(["admission", "queue", "quarantine", "migration", "lkgRestore"]);
const STATUS_KEYS = Object.freeze([
    "schemaVersion", "ledgerId", "tenantId", "repositoryId", "contributionId", "status", "reasonCode",
    "nextAction", "evidence", "receiptDigests", "inputDigest", "readOnly", "queueStateChanged",
    "mergeAuthorized", "statusDigest",
]);
const EVIDENCE_REF_PATTERN = /^evidence:[a-z0-9][a-z0-9._-]{2,95}$/;
const ADMISSION_STATES = Object.freeze(["ADMITTED", "QUARANTINED"]);
const HEAD_STATES = Object.freeze(["CURRENT", "SUPERSEDED", "INVALIDATED"]);
const MIGRATION_STATES = Object.freeze(["CURRENT", "REBASE_REQUIRED"]);
const LKG_STATES = Object.freeze(["UNCHANGED", "RESTORED"]);
const STATUS_DENIED = "CCP_CONTRIBUTOR_STATUS_SCHEMA_DENIED";
const INPUT_DENIED = "CCP_CONTRIBUTOR_STATUS_INPUT_SCHEMA_DENIED";
function enumValue(value, values, code) {
    if (typeof value !== "string" || !values.includes(value))
        ccpStrictDenyV1(code);
    return value;
}
function nullableDigest(value, code) {
    if (value === null)
        return null;
    return assertCcpDigestV1(value, code);
}
function normalizeRefs(value, code, seen) {
    const raw = readCcpDenseArrayV1(value, seen, code);
    const refs = raw.map((item) => assertCcpStringV1(item, EVIDENCE_REF_PATTERN, code));
    if (new Set(refs).size !== refs.length)
        ccpStrictDenyV1(code);
    return Object.freeze([...refs].sort());
}
function normalizeInput(value) {
    const seen = new WeakSet();
    const record = readCcpClosedObjectV1(value, INPUT_KEYS, seen, INPUT_DENIED);
    if (record.schemaVersion !== CCP_CONTRIBUTOR_STATUS_INPUT_SCHEMA_V1)
        ccpStrictDenyV1(INPUT_DENIED);
    if (typeof record.queued !== "boolean" || typeof record.privateDetails !== "string")
        ccpStrictDenyV1(INPUT_DENIED);
    const requiredEvidenceRefs = normalizeRefs(record.requiredEvidenceRefs, INPUT_DENIED, seen);
    const presentEvidenceRefs = normalizeRefs(record.presentEvidenceRefs, INPUT_DENIED, seen);
    if (requiredEvidenceRefs.length === 0)
        ccpStrictDenyV1(INPUT_DENIED);
    const required = new Set(requiredEvidenceRefs);
    if (presentEvidenceRefs.some((ref) => !required.has(ref)))
        ccpStrictDenyV1(INPUT_DENIED);
    return Object.freeze({
        schemaVersion: CCP_CONTRIBUTOR_STATUS_INPUT_SCHEMA_V1,
        ledgerId: assertCcpStringV1(record.ledgerId, LEDGER_ID_PATTERN, INPUT_DENIED),
        tenantId: assertCcpStringV1(record.tenantId, TENANT_ID_PATTERN, INPUT_DENIED),
        repositoryId: assertCcpStringV1(record.repositoryId, REPOSITORY_ID_PATTERN, INPUT_DENIED),
        contributionId: assertCcpStringV1(record.contributionId, CONTRIBUTION_ID_PATTERN, INPUT_DENIED),
        admissionState: enumValue(record.admissionState, ADMISSION_STATES, INPUT_DENIED),
        headState: enumValue(record.headState, HEAD_STATES, INPUT_DENIED),
        queued: record.queued,
        migrationState: enumValue(record.migrationState, MIGRATION_STATES, INPUT_DENIED),
        lkgState: enumValue(record.lkgState, LKG_STATES, INPUT_DENIED),
        requiredEvidenceRefs,
        presentEvidenceRefs,
        admissionReceiptDigest: nullableDigest(record.admissionReceiptDigest, INPUT_DENIED),
        queueReceiptDigest: nullableDigest(record.queueReceiptDigest, INPUT_DENIED),
        quarantineReceiptDigest: nullableDigest(record.quarantineReceiptDigest, INPUT_DENIED),
        migrationReceiptDigest: nullableDigest(record.migrationReceiptDigest, INPUT_DENIED),
        lkgRestoreReceiptDigest: nullableDigest(record.lkgRestoreReceiptDigest, INPUT_DENIED),
        privateDetails: record.privateDetails,
    });
}
function requiredReceiptEvidencePresent(input) {
    if (input.admissionReceiptDigest === null)
        return false;
    if (input.admissionState === "QUARANTINED" && input.quarantineReceiptDigest === null)
        return false;
    if (input.queued && input.queueReceiptDigest === null)
        return false;
    if (input.migrationState === "REBASE_REQUIRED" && input.migrationReceiptDigest === null)
        return false;
    if (input.lkgState === "RESTORED" && input.lkgRestoreReceiptDigest === null)
        return false;
    return true;
}
function evidenceSummary(input) {
    const requiredCount = input.requiredEvidenceRefs.length;
    const presentCount = input.presentEvidenceRefs.length;
    const receiptEvidenceComplete = requiredReceiptEvidencePresent(input);
    return Object.freeze({
        requiredCount,
        presentCount,
        missingCount: requiredCount - presentCount,
        complete: presentCount === requiredCount && receiptEvidenceComplete,
        receiptEvidenceComplete,
    });
}
function receiptDigests(input) {
    return Object.freeze({
        admission: input.admissionReceiptDigest,
        queue: input.queueReceiptDigest,
        quarantine: input.quarantineReceiptDigest,
        migration: input.migrationReceiptDigest,
        lkgRestore: input.lkgRestoreReceiptDigest,
    });
}
function statusDecision(input) {
    const evidence = evidenceSummary(input);
    if (!evidence.complete) {
        return { status: "MISSING_EVIDENCE", reasonCode: "REQUIRED_EVIDENCE_MISSING", nextAction: "PROVIDE_REQUIRED_EVIDENCE" };
    }
    if (input.admissionState === "QUARANTINED") {
        return { status: "QUARANTINED", reasonCode: "CONTRIBUTION_QUARANTINED", nextAction: "REVIEW_QUARANTINE" };
    }
    if (input.migrationState === "REBASE_REQUIRED") {
        return { status: "REBASE_REQUIRED", reasonCode: "MIGRATION_REBASE_REQUIRED", nextAction: "REBASE_AND_RESUBMIT" };
    }
    if (input.lkgState === "RESTORED") {
        return { status: "LKG_RESTORED", reasonCode: "LKG_RESTORED", nextAction: "REVERIFY_RESTORED_LKG" };
    }
    if (input.headState === "SUPERSEDED" || input.headState === "INVALIDATED") {
        return { status: "SUPERSEDED", reasonCode: "HEAD_SUPERSEDED", nextAction: "NO_ACTION_HEAD_SUPERSEDED" };
    }
    if (input.queued) {
        return { status: "QUEUED", reasonCode: "QUEUED_WITH_COMPLETE_EVIDENCE", nextAction: "WAIT_FOR_VERIFICATION" };
    }
    return { status: "READY", reasonCode: "ADMITTED_NOT_QUEUED", nextAction: "CONTRIBUTOR_ACTION_REQUIRED" };
}
function makeStatus(input) {
    const evidence = evidenceSummary(input);
    const decision = statusDecision(input);
    const source = {
        schemaVersion: input.schemaVersion,
        ledgerId: input.ledgerId,
        tenantId: input.tenantId,
        repositoryId: input.repositoryId,
        contributionId: input.contributionId,
        admissionState: input.admissionState,
        headState: input.headState,
        queued: input.queued,
        migrationState: input.migrationState,
        lkgState: input.lkgState,
        requiredEvidenceRefs: input.requiredEvidenceRefs,
        presentEvidenceRefs: input.presentEvidenceRefs,
        admissionReceiptDigest: input.admissionReceiptDigest,
        queueReceiptDigest: input.queueReceiptDigest,
        quarantineReceiptDigest: input.quarantineReceiptDigest,
        migrationReceiptDigest: input.migrationReceiptDigest,
        lkgRestoreReceiptDigest: input.lkgRestoreReceiptDigest,
        privateDetails: input.privateDetails,
    };
    const inputDigest = ccpDigestDomainV1(CCP_CONTRIBUTOR_STATUS_INPUT_SCHEMA_V1, source);
    const unsigned = Object.freeze({
        schemaVersion: CCP_CONTRIBUTOR_STATUS_SCHEMA_V1,
        ledgerId: input.ledgerId,
        tenantId: input.tenantId,
        repositoryId: input.repositoryId,
        contributionId: input.contributionId,
        status: decision.status,
        reasonCode: decision.reasonCode,
        nextAction: decision.nextAction,
        evidence,
        receiptDigests: receiptDigests(input),
        inputDigest,
        readOnly: true,
        queueStateChanged: false,
        mergeAuthorized: false,
    });
    return Object.freeze({
        ...unsigned,
        statusDigest: ccpDigestDomainV1(CCP_CONTRIBUTOR_STATUS_SCHEMA_V1, unsigned),
    });
}
/** Parse and close contributor-status input without consulting a clock or mutating state. */
export function parseCcpContributorStatusInputV1(value) {
    return normalizeInput(value);
}
/** Project canonical, redaction-safe contributor status from closed evidence. */
export function projectCcpContributorStatusV1(value) {
    return makeStatus(normalizeInput(value));
}
/** Alias for callers that use the contributor-status contract as a projector. */
export const makeCcpContributorStatusV1 = projectCcpContributorStatusV1;
function normalizeEvidenceSummary(value, seen) {
    const record = readCcpClosedObjectV1(value, EVIDENCE_KEYS, seen, STATUS_DENIED);
    const requiredCount = assertCcpSafeUnsignedIntegerV1(record.requiredCount, STATUS_DENIED);
    const presentCount = assertCcpSafeUnsignedIntegerV1(record.presentCount, STATUS_DENIED);
    const missingCount = assertCcpSafeUnsignedIntegerV1(record.missingCount, STATUS_DENIED);
    if (presentCount > requiredCount || missingCount !== requiredCount - presentCount
        || typeof record.receiptEvidenceComplete !== "boolean"
        || record.complete !== (missingCount === 0 && record.receiptEvidenceComplete))
        ccpStrictDenyV1(STATUS_DENIED);
    return Object.freeze({
        requiredCount,
        presentCount,
        missingCount,
        complete: missingCount === 0 && record.receiptEvidenceComplete,
        receiptEvidenceComplete: record.receiptEvidenceComplete,
    });
}
function normalizeReceiptDigests(value, seen) {
    const record = readCcpClosedObjectV1(value, RECEIPT_DIGEST_KEYS, seen, STATUS_DENIED);
    return Object.freeze({
        admission: nullableDigest(record.admission, STATUS_DENIED),
        queue: nullableDigest(record.queue, STATUS_DENIED),
        quarantine: nullableDigest(record.quarantine, STATUS_DENIED),
        migration: nullableDigest(record.migration, STATUS_DENIED),
        lkgRestore: nullableDigest(record.lkgRestore, STATUS_DENIED),
    });
}
function normalizeStatus(value) {
    const seen = new WeakSet();
    const record = readCcpClosedObjectV1(value, STATUS_KEYS, seen, STATUS_DENIED);
    if (record.schemaVersion !== CCP_CONTRIBUTOR_STATUS_SCHEMA_V1
        || record.readOnly !== true || record.queueStateChanged !== false || record.mergeAuthorized !== false) {
        ccpStrictDenyV1(STATUS_DENIED);
    }
    const status = enumValue(record.status, CCP_CONTRIBUTOR_STATUS_KINDS_V1, STATUS_DENIED);
    const reasonCode = enumValue(record.reasonCode, CCP_CONTRIBUTOR_REASON_CODES_V1, STATUS_DENIED);
    const nextAction = enumValue(record.nextAction, CCP_CONTRIBUTOR_NEXT_ACTIONS_V1, STATUS_DENIED);
    const evidence = normalizeEvidenceSummary(record.evidence, seen);
    const digests = normalizeReceiptDigests(record.receiptDigests, seen);
    if ((status === "MISSING_EVIDENCE") === evidence.complete)
        ccpStrictDenyV1(STATUS_DENIED);
    if (status !== "MISSING_EVIDENCE" && digests.admission === null)
        ccpStrictDenyV1(STATUS_DENIED);
    if (status === "QUEUED" && digests.queue === null)
        ccpStrictDenyV1(STATUS_DENIED);
    if (status === "QUARANTINED" && digests.quarantine === null)
        ccpStrictDenyV1(STATUS_DENIED);
    if (status === "REBASE_REQUIRED" && digests.migration === null)
        ccpStrictDenyV1(STATUS_DENIED);
    if (status === "LKG_RESTORED" && digests.lkgRestore === null)
        ccpStrictDenyV1(STATUS_DENIED);
    const inputDigest = assertCcpDigestV1(record.inputDigest, STATUS_DENIED);
    const statusDigest = assertCcpDigestV1(record.statusDigest, STATUS_DENIED);
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
        ccpStrictDenyV1(STATUS_DENIED);
    const unsigned = Object.freeze({
        schemaVersion: CCP_CONTRIBUTOR_STATUS_SCHEMA_V1,
        ledgerId: assertCcpStringV1(record.ledgerId, LEDGER_ID_PATTERN, STATUS_DENIED),
        tenantId: assertCcpStringV1(record.tenantId, TENANT_ID_PATTERN, STATUS_DENIED),
        repositoryId: assertCcpStringV1(record.repositoryId, REPOSITORY_ID_PATTERN, STATUS_DENIED),
        contributionId: assertCcpStringV1(record.contributionId, CONTRIBUTION_ID_PATTERN, STATUS_DENIED),
        status,
        reasonCode,
        nextAction,
        evidence,
        receiptDigests: digests,
        inputDigest,
        readOnly: true,
        queueStateChanged: false,
        mergeAuthorized: false,
    });
    if (ccpDigestDomainV1(CCP_CONTRIBUTOR_STATUS_SCHEMA_V1, unsigned) !== statusDigest)
        ccpStrictDenyV1(STATUS_DENIED);
    return Object.freeze({ ...unsigned, statusDigest });
}
/** Parse and verify a canonical contributor status read-back. */
export function parseCcpContributorStatusV1(value) {
    return normalizeStatus(value);
}
export function canonicalCcpContributorStatusJsonV1(value) {
    return canonicalJson(parseCcpContributorStatusV1(value));
}
export function ccpContributorStatusDigestV1(value) {
    return parseCcpContributorStatusV1(value).statusDigest;
}
export function verifyCcpContributorStatusV1(value) {
    try {
        return parseCcpContributorStatusV1(value);
    }
    catch {
        return null;
    }
}
