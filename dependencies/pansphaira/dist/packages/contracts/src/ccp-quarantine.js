import { canonicalJson } from "./canonical-json.js";
import { ccpDigestDomainV1, ccpStrictDenyV1, readCcpClosedObjectV1, } from "./ccp-event-envelope.js";
import { parseCcpAdmissionReceiptV1, CCP_ADMISSION_REASON_CODES_V1, } from "./ccp-admission-gate.js";
/**
 * CCP PSAI52 bounded intake boundary (M1 admission, quarantine side): an
 * immutable, digest-bound quarantine receipt sealing a QUARANTINED admission
 * receipt. It is a pure read-only seal: it allocates no queue slot,
 * schedules no runner, executes no code and authorizes no merge. It has no
 * network, persistence, clock or randomness capability.
 *
 * Sealing a non-quarantined admission receipt denies fail-closed. The
 * embedded admission receipt is re-verified on read-back, so any rehashed
 * drift in the candidate, context, disposition, reason code, eligibility or
 * either digest denies.
 */
export const CCP_QUARANTINE_RECEIPT_SCHEMA_V1 = "cm.ccp-quarantine-receipt/v1";
const QUARANTINE_RECEIPT_KEYS = Object.freeze([
    "schemaVersion", "admission", "reasonCode", "quarantineDigest",
]);
function makeCcpQuarantineReceiptV1(admission) {
    if (admission.disposition !== "QUARANTINED") {
        ccpStrictDenyV1("CCP_QUARANTINE_NOT_QUARANTINED");
    }
    const unsigned = Object.freeze({
        schemaVersion: CCP_QUARANTINE_RECEIPT_SCHEMA_V1,
        admission,
        reasonCode: admission.reasonCode,
    });
    return Object.freeze({
        ...unsigned,
        quarantineDigest: ccpDigestDomainV1(CCP_QUARANTINE_RECEIPT_SCHEMA_V1, unsigned),
    });
}
/**
 * Parse and close a QUARANTINED admission receipt and seal it as an
 * immutable quarantine receipt. Malformed input or an ADMITTED admission
 * receipt denies with a TypeError carrying a closed denial code before any
 * quarantine receipt exists. Sealing never allocates a queue slot,
 * schedules a runner, executes code or authorizes a merge.
 */
export function makeCcpQuarantineReceiptV1FromAdmissionV1(admission) {
    return makeCcpQuarantineReceiptV1(parseCcpAdmissionReceiptV1(admission));
}
/**
 * Parse and close a quarantine receipt. The embedded admission receipt is
 * re-derived and re-verified; any drift in its fields, the mirrored reason
 * code or the quarantine digest denies with a closed denial code. The
 * returned receipt is the expected frozen receipt.
 */
export function parseCcpQuarantineReceiptV1(value) {
    const record = readCcpClosedObjectV1(value, QUARANTINE_RECEIPT_KEYS, new WeakSet(), "CCP_QUARANTINE_RECEIPT_SCHEMA_DENIED");
    if (record.schemaVersion !== CCP_QUARANTINE_RECEIPT_SCHEMA_V1) {
        ccpStrictDenyV1("CCP_QUARANTINE_RECEIPT_SCHEMA_DENIED");
    }
    const admission = parseCcpAdmissionReceiptV1(record.admission);
    if (admission.disposition !== "QUARANTINED") {
        ccpStrictDenyV1("CCP_QUARANTINE_NOT_QUARANTINED");
    }
    if (typeof record.reasonCode !== "string"
        || !CCP_ADMISSION_REASON_CODES_V1.includes(record.reasonCode)
        || record.reasonCode !== admission.reasonCode) {
        ccpStrictDenyV1("CCP_QUARANTINE_RECEIPT_SCHEMA_DENIED");
    }
    const expected = makeCcpQuarantineReceiptV1(admission);
    if (typeof record.quarantineDigest !== "string"
        || record.quarantineDigest !== expected.quarantineDigest) {
        ccpStrictDenyV1("CCP_QUARANTINE_RECEIPT_SCHEMA_DENIED");
    }
    return expected;
}
/** Canonical JSON of the closed quarantine receipt; byte order independent of input key order. */
export function canonicalCcpQuarantineReceiptJsonV1(value) {
    return canonicalJson(parseCcpQuarantineReceiptV1(value));
}
/** Domain-bound content digest of the closed quarantine receipt. */
export function ccpQuarantineReceiptDigestV1(value) {
    return ccpDigestDomainV1(CCP_QUARANTINE_RECEIPT_SCHEMA_V1, parseCcpQuarantineReceiptV1(value));
}
/**
 * Verify a quarantine receipt on read-back. Returns the closed receipt on
 * success; returns null when the receipt is malformed or forged (any
 * rehashed drift in the embedded admission receipt, the mirrored reason
 * code or the quarantine digest), or when it seals an ADMITTED receipt.
 */
export function verifyCcpQuarantineReceiptV1(value) {
    try {
        return parseCcpQuarantineReceiptV1(value);
    }
    catch {
        return null;
    }
}
