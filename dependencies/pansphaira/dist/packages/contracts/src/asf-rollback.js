/**
 * Pure ASF controlled exact rollback/readback decision contract (v1).
 *
 * This boundary consumes an immutable failed candidate generation, a digested
 * explicit rollback request and independent approval, a declared last-known-good
 * (LKG) tuple or an explicitly absent one, a digested pre-rollback scope
 * snapshot, and a digested post-rollback readback snapshot. It emits a
 * deterministic decision and receipt that either restores the exact last
 * accepted unrevoked LKG tuple or disables only the declared affected scope
 * when no valid LKG exists. It never writes pointers, executes a runtime,
 * modifies unrelated accepted generations, or permits partial or cross-scope
 * restoration. Every failure is closed: retain the LKG or disable the affected
 * scope, and leave every unrelated accepted generation unchanged.
 */
import { createHash } from "node:crypto";
import { validateAsfAnalysisReceiptV1, } from "./asf-analysis.js";
import { canonicalJson } from "./canonical-json.js";
export const ASF_ROLLBACK_SCHEMA_V1 = "chimpmaera.asf/rollback/v1";
export const ASF_ROLLBACK_REQUEST_SCHEMA_V1 = "chimpmaera.asf/rollback-request/v1";
export const ASF_ROLLBACK_RECEIPT_SCHEMA_V1 = "chimpmaera.asf/rollback-receipt/v1";
export const ASF_ROLLBACK_ABSENT_LKG_DIGEST_V1 = "0".repeat(64);
export const ASF_ROLLBACK_AUTHORITY_V1 = Object.freeze({
    activation: "NO_AUTHORITY",
    execution: "NO_AUTHORITY",
    installation: "NO_AUTHORITY",
    rollback: "DECISION_ONLY",
});
export const ASF_ROLLBACK_RUNTIME_EFFECT_V1 = "NOT_RUN";
export const ASF_ROLLBACK_DECISION_REASON_LKG_V1 = "EXACT_RESTORE_OF_LAST_ACCEPTED_NON_REVOKED_LKG_TUPLE";
export const ASF_ROLLBACK_DECISION_REASON_DISABLE_V1 = "SCOPE_LOCAL_DISABLE_BECAUSE_NO_VALID_LKG_TUPLE";
export const ASF_ROLLBACK_PROBE_IDS_V1 = [
    "NO_AUTOMATIC_ROLLBACK",
    "NO_CROSS_SCOPE_MODIFICATION",
    "NO_PARTIAL_RESTORE",
    "NO_RUNTIME_EXECUTION",
];
export const ASF_ROLLBACK_REASON_ORDER_V1 = [
    "ANALYSIS_REVOKED_DENIED",
    "ANALYSIS_STALE_DENIED",
    "AUTO_ROLLBACK_DENIED",
    "CROSS_SCOPE_DENIED",
    "DIGEST_MISMATCH_DENIED",
    "DUPLICATE_KEY_DENIED",
    "EVIDENCE_MISSING_DENIED",
    "INVALID_JSON_DENIED",
    "LKG_MISMATCH_DENIED",
    "LKG_MUTABLE_DENIED",
    "LKG_REVOKED_DENIED",
    "MISSING_APPROVAL_DENIED",
    "MISSING_READBACK_DENIED",
    "MUTABLE_ALIAS_OR_RANGE_DENIED",
    "NEGATIVE_PROBE_DENIED",
    "NONCANONICAL_ENCODING_DENIED",
    "PARTIAL_RESTORE_DENIED",
    "RESIDUE_DENIED",
    "SCHEMA_DENIED",
    "SELF_APPROVAL_DENIED",
    "UNSUPPORTED_VERSION_DENIED",
];
export const ASF_ROLLBACK_EXIT_CODES_V1 = Object.freeze({
    ASF_ROLLBACK_ACCEPTED: 0,
    SCHEMA_DENIED: 178,
    UNSUPPORTED_VERSION_DENIED: 179,
    INVALID_JSON_DENIED: 180,
    DUPLICATE_KEY_DENIED: 181,
    NONCANONICAL_ENCODING_DENIED: 182,
    AUTO_ROLLBACK_DENIED: 183,
    SELF_APPROVAL_DENIED: 184,
    MISSING_APPROVAL_DENIED: 185,
    ANALYSIS_REVOKED_DENIED: 186,
    ANALYSIS_STALE_DENIED: 187,
    EVIDENCE_MISSING_DENIED: 188,
    MUTABLE_ALIAS_OR_RANGE_DENIED: 189,
    LKG_REVOKED_DENIED: 190,
    LKG_MUTABLE_DENIED: 191,
    LKG_MISMATCH_DENIED: 192,
    MISSING_READBACK_DENIED: 193,
    DIGEST_MISMATCH_DENIED: 194,
    RESIDUE_DENIED: 195,
    PARTIAL_RESTORE_DENIED: 196,
    CROSS_SCOPE_DENIED: 197,
    NEGATIVE_PROBE_DENIED: 198,
});
const TOP_LEVEL_KEYS = [
    "analysisReceipt",
    "analysisStatus",
    "approval",
    "beforeSnapshot",
    "candidate",
    "lkg",
    "negativeProbes",
    "readback",
    "rollbackRequest",
    "schemaVersion",
];
const REQUEST_KEYS = ["automatic", "requestId", "requesterClass", "schemaVersion", "targetScope"];
const APPROVAL_KEYS = ["approverClass", "decision", "requestDigest"];
const TARGET_KEYS = ["adapterId", "capabilityIds", "packId", "profileId", "routeId"];
const CANDIDATE_KEYS = ["generationDigest", "lockDigest", "skillId", "version"];
const LKG_KEYS = [
    "adapterId",
    "capabilityIds",
    "generationDigest",
    "lockIdentity",
    "locator",
    "packId",
    "profileId",
    "routeId",
    "skillId",
    "status",
    "version",
];
const SNAPSHOT_KEYS = ["digest", "records"];
const RECORD_KEYS = ["generationDigest", "lockIdentity", "skillId", "state", "version"];
const RECEIPT_KEYS = [
    "afterSnapshotDigest",
    "approverClass",
    "authority",
    "beforeSnapshotDigest",
    "candidateGenerationDigest",
    "candidateLockDigest",
    "decisionReason",
    "lkgGenerationDigest",
    "lkgLockIdentity",
    "readbackDigest",
    "receiptDigest",
    "requestId",
    "result",
    "runtimeEffect",
    "schemaVersion",
    "skillId",
    "targetScope",
];
const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[a-z][a-z0-9.:_-]{2,127}$/;
const VERSION = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/;
const REQUEST_ID = /^rollback-request:[a-z0-9][a-z0-9._-]{2,95}$/;
const UNRESOLVED = /(?:\$\{|{{|}}|<[^>]*>|latest|HEAD)/i;
const WILDCARD = /\*/;
const SCOPE_STATES = ["ACTIVE", "DISABLED", "installed_inactive"];
function isRecord(value) {
    return typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, keys) {
    if (!isRecord(value))
        return false;
    const expected = [...keys].sort();
    const actual = Object.keys(value).sort();
    if (actual.length !== expected.length)
        return false;
    for (let index = 0; index < expected.length; index += 1) {
        if (actual[index] !== expected[index])
            return false;
    }
    return true;
}
function isDigest(value) {
    return typeof value === "string" && DIGEST.test(value);
}
function isId(value) {
    return typeof value === "string" && ID.test(value);
}
function isVersion(value) {
    return typeof value === "string" && VERSION.test(value);
}
function isMutableClaim(value) {
    return typeof value === "string" && (WILDCARD.test(value) || UNRESOLVED.test(value));
}
function sameSet(left, right) {
    if (left.length !== right.length)
        return false;
    const seen = new Set();
    for (const value of left) {
        if (seen.has(value))
            return false;
        seen.add(value);
    }
    for (const value of right) {
        if (!seen.has(value))
            return false;
    }
    return true;
}
function digest(value) {
    return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
function deny(reason) {
    return {
        outcome: "DENIED",
        reasonCodes: [reason],
        exitCode: ASF_ROLLBACK_EXIT_CODES_V1[reason],
        failClosed: { affectedScope: "DISABLE_OR_RETAIN_LKG", unrelatedAcceptedGenerations: "UNCHANGED" },
    };
}
function validTarget(value) {
    if (!exactKeys(value, TARGET_KEYS))
        return false;
    const target = value;
    return (isId(target.adapterId) &&
        isId(target.packId) &&
        isId(target.profileId) &&
        isId(target.routeId) &&
        Array.isArray(target.capabilityIds) &&
        target.capabilityIds.length > 0 &&
        target.capabilityIds.every(isId) &&
        new Set(target.capabilityIds).size === target.capabilityIds.length);
}
function validCandidate(value) {
    if (!exactKeys(value, CANDIDATE_KEYS))
        return false;
    const candidate = value;
    return (isDigest(candidate.generationDigest) &&
        isDigest(candidate.lockDigest) &&
        isId(candidate.skillId) &&
        isVersion(candidate.version));
}
function validLkgRecord(value) {
    if (!exactKeys(value, LKG_KEYS))
        return false;
    const record = value;
    return (isId(record.adapterId) &&
        isId(record.packId) &&
        isId(record.profileId) &&
        isId(record.routeId) &&
        isId(record.skillId) &&
        typeof record.locator === "string" &&
        record.locator.length > 0 &&
        (record.status === "ACCEPTED" || record.status === "REVOKED") &&
        isDigest(record.generationDigest) &&
        isDigest(record.lockIdentity) &&
        isVersion(record.version) &&
        Array.isArray(record.capabilityIds) &&
        record.capabilityIds.length > 0 &&
        record.capabilityIds.every(isId) &&
        new Set(record.capabilityIds).size === record.capabilityIds.length);
}
function validScopeRecord(value) {
    if (!exactKeys(value, RECORD_KEYS))
        return false;
    const record = value;
    return (isDigest(record.generationDigest) &&
        isDigest(record.lockIdentity) &&
        isId(record.skillId) &&
        isVersion(record.version) &&
        SCOPE_STATES.includes(record.state));
}
function snapshotDigestOf(records) {
    return digest({ records });
}
function lkgMatchesTarget(target, record) {
    return (record.adapterId === target.adapterId &&
        record.packId === target.packId &&
        record.profileId === target.profileId &&
        record.routeId === target.routeId &&
        sameSet(target.capabilityIds, record.capabilityIds));
}
function verifyCore(value) {
    const fail = (reason) => ({ result: deny(reason), normalized: null });
    if (!isRecord(value))
        return fail("SCHEMA_DENIED");
    const schemaVersion = value.schemaVersion;
    if (!exactKeys(value, TOP_LEVEL_KEYS)) {
        return typeof schemaVersion === "string" && schemaVersion !== ASF_ROLLBACK_SCHEMA_V1
            ? fail("UNSUPPORTED_VERSION_DENIED")
            : fail("SCHEMA_DENIED");
    }
    if (value.schemaVersion !== ASF_ROLLBACK_SCHEMA_V1)
        return fail("UNSUPPORTED_VERSION_DENIED");
    const rawRequest = value.rollbackRequest;
    if (!exactKeys(rawRequest, REQUEST_KEYS) || !validTarget(rawRequest.targetScope)) {
        return fail("SCHEMA_DENIED");
    }
    const request = rawRequest;
    if (request.automatic !== false)
        return fail("AUTO_ROLLBACK_DENIED");
    if (request.schemaVersion !== ASF_ROLLBACK_REQUEST_SCHEMA_V1 ||
        (request.requesterClass !== "ASF_PROPOSER_V1" && request.requesterClass !== "ASF_RING_APPROVER_V1") ||
        !REQUEST_ID.test(request.requestId)) {
        return fail("SCHEMA_DENIED");
    }
    if ([
        request.targetScope.adapterId,
        request.targetScope.packId,
        request.targetScope.profileId,
        request.targetScope.routeId,
        ...request.targetScope.capabilityIds,
    ].some(isMutableClaim)) {
        return fail("MUTABLE_ALIAS_OR_RANGE_DENIED");
    }
    const rawApproval = value.approval;
    if (!exactKeys(rawApproval, APPROVAL_KEYS))
        return fail("SCHEMA_DENIED");
    const approval = rawApproval;
    if (approval.approverClass !== "ASF_RING_APPROVER_V1" || approval.decision !== "APPROVE") {
        return fail("MISSING_APPROVAL_DENIED");
    }
    if (request.requesterClass === approval.approverClass)
        return fail("SELF_APPROVAL_DENIED");
    if (!isDigest(approval.requestDigest) || approval.requestDigest !== digest(request)) {
        return fail("DIGEST_MISMATCH_DENIED");
    }
    if (!validCandidate(value.candidate))
        return fail("SCHEMA_DENIED");
    const candidate = value.candidate;
    if (value.analysisStatus === "REVOKED")
        return fail("ANALYSIS_REVOKED_DENIED");
    if (value.analysisStatus !== "FRESH")
        return fail("ANALYSIS_STALE_DENIED");
    if (!validateAsfAnalysisReceiptV1(value.analysisReceipt))
        return fail("EVIDENCE_MISSING_DENIED");
    const analysis = value.analysisReceipt;
    if (analysis.generationDigest !== candidate.generationDigest ||
        analysis.lockDigest !== candidate.lockDigest ||
        analysis.verdict !== "ACCEPTED") {
        return fail("DIGEST_MISMATCH_DENIED");
    }
    const rawBefore = value.beforeSnapshot;
    if (!exactKeys(rawBefore, SNAPSHOT_KEYS))
        return fail("SCHEMA_DENIED");
    const beforeSnapshot = rawBefore;
    if (!isDigest(beforeSnapshot.digest) ||
        !Array.isArray(beforeSnapshot.records) ||
        beforeSnapshot.records.length === 0 ||
        !beforeSnapshot.records.every(validScopeRecord) ||
        new Set(beforeSnapshot.records.map((record) => record.skillId)).size !== beforeSnapshot.records.length) {
        return fail("SCHEMA_DENIED");
    }
    if (snapshotDigestOf(beforeSnapshot.records) !== beforeSnapshot.digest)
        return fail("DIGEST_MISMATCH_DENIED");
    const beforeTarget = beforeSnapshot.records.find((record) => record.skillId === candidate.skillId);
    if (beforeTarget === undefined ||
        beforeTarget.generationDigest !== candidate.generationDigest ||
        beforeTarget.lockIdentity !== candidate.lockDigest ||
        beforeTarget.version !== candidate.version ||
        beforeTarget.state !== "ACTIVE") {
        return fail("DIGEST_MISMATCH_DENIED");
    }
    if (!Array.isArray(value.lkg) || !value.lkg.every(validLkgRecord))
        return fail("SCHEMA_DENIED");
    const lkg = value.lkg;
    let resultKind;
    let decisionReason;
    let lkgGenerationDigest;
    let lkgLockIdentity;
    let expectedTarget;
    if (lkg.length > 1)
        return fail("LKG_MISMATCH_DENIED");
    if (lkg.length === 1) {
        const record = lkg[0];
        if (record === undefined)
            return fail("SCHEMA_DENIED");
        if (record.status === "REVOKED")
            return fail("LKG_REVOKED_DENIED");
        if (isMutableClaim(record.locator))
            return fail("LKG_MUTABLE_DENIED");
        if (record.locator !== `asf-bundle+sha256:${record.lockIdentity}`)
            return fail("LKG_MISMATCH_DENIED");
        if (record.skillId !== candidate.skillId || !lkgMatchesTarget(request.targetScope, record)) {
            return fail("LKG_MISMATCH_DENIED");
        }
        if (record.generationDigest === candidate.generationDigest &&
            record.lockIdentity === candidate.lockDigest &&
            record.version === candidate.version) {
            return fail("LKG_MISMATCH_DENIED");
        }
        resultKind = "LKG_RESTORED";
        decisionReason = ASF_ROLLBACK_DECISION_REASON_LKG_V1;
        lkgGenerationDigest = record.generationDigest;
        lkgLockIdentity = record.lockIdentity;
        expectedTarget = {
            generationDigest: record.generationDigest,
            lockIdentity: record.lockIdentity,
            skillId: record.skillId,
            state: "ACTIVE",
            version: record.version,
        };
    }
    else {
        resultKind = "SCOPE_DISABLED";
        decisionReason = ASF_ROLLBACK_DECISION_REASON_DISABLE_V1;
        lkgGenerationDigest = ASF_ROLLBACK_ABSENT_LKG_DIGEST_V1;
        lkgLockIdentity = ASF_ROLLBACK_ABSENT_LKG_DIGEST_V1;
        expectedTarget = {
            generationDigest: candidate.generationDigest,
            lockIdentity: candidate.lockDigest,
            skillId: candidate.skillId,
            state: "DISABLED",
            version: candidate.version,
        };
    }
    const rawReadback = value.readback;
    if (!exactKeys(rawReadback, SNAPSHOT_KEYS) ||
        !isDigest(rawReadback.digest) ||
        !Array.isArray(rawReadback.records) ||
        rawReadback.records.length === 0) {
        return fail("MISSING_READBACK_DENIED");
    }
    const readback = rawReadback;
    if (!readback.records.every(validScopeRecord) ||
        new Set(readback.records.map((record) => record.skillId)).size !== readback.records.length) {
        return fail("SCHEMA_DENIED");
    }
    if (snapshotDigestOf(readback.records) !== readback.digest)
        return fail("DIGEST_MISMATCH_DENIED");
    const readbackTarget = readback.records.find((record) => record.skillId === candidate.skillId);
    if (readbackTarget === undefined)
        return fail("CROSS_SCOPE_DENIED");
    if (canonicalJson(readbackTarget) === canonicalJson(beforeTarget))
        return fail("RESIDUE_DENIED");
    if (readback.records.some((record) => !beforeSnapshot.records.some((entry) => entry.skillId === record.skillId))) {
        return fail("RESIDUE_DENIED");
    }
    if (readback.records.length !== beforeSnapshot.records.length)
        return fail("CROSS_SCOPE_DENIED");
    if (canonicalJson(readbackTarget) !== canonicalJson(expectedTarget))
        return fail("PARTIAL_RESTORE_DENIED");
    for (const beforeRecord of beforeSnapshot.records) {
        if (beforeRecord.skillId === candidate.skillId)
            continue;
        const readbackRecord = readback.records.find((record) => record.skillId === beforeRecord.skillId);
        if (readbackRecord === undefined || canonicalJson(readbackRecord) !== canonicalJson(beforeRecord)) {
            return fail("CROSS_SCOPE_DENIED");
        }
    }
    if (!Array.isArray(value.negativeProbes) ||
        value.negativeProbes.length !== ASF_ROLLBACK_PROBE_IDS_V1.length ||
        !value.negativeProbes.every((probe) => isRecord(probe) &&
            Object.keys(probe).length === 2 &&
            probe.outcome === "DENIED" &&
            typeof probe.probeId === "string" &&
            ASF_ROLLBACK_PROBE_IDS_V1.includes(probe.probeId)) ||
        new Set(value.negativeProbes.map((probe) => probe.probeId)).size !==
            value.negativeProbes.length) {
        return fail("NEGATIVE_PROBE_DENIED");
    }
    const normalized = value;
    const afterRecords = beforeSnapshot.records.map((record) => record.skillId === candidate.skillId ? expectedTarget : record);
    const afterSnapshotDigest = snapshotDigestOf(afterRecords);
    const core = {
        afterSnapshotDigest,
        approverClass: approval.approverClass,
        authority: ASF_ROLLBACK_AUTHORITY_V1,
        beforeSnapshotDigest: beforeSnapshot.digest,
        candidateGenerationDigest: candidate.generationDigest,
        candidateLockDigest: candidate.lockDigest,
        decisionReason,
        lkgGenerationDigest,
        lkgLockIdentity,
        readbackDigest: readback.digest,
        requestId: request.requestId,
        result: resultKind,
        runtimeEffect: ASF_ROLLBACK_RUNTIME_EFFECT_V1,
        schemaVersion: ASF_ROLLBACK_RECEIPT_SCHEMA_V1,
        skillId: candidate.skillId,
        targetScope: request.targetScope,
    };
    const receipt = {
        ...core,
        receiptDigest: receiptDigestOfCore(core),
    };
    const result = {
        outcome: "ACCEPTED",
        reasonCodes: ["ASF_ROLLBACK_ACCEPTED"],
        exitCode: 0,
        canonicalJson: canonicalJson(normalized),
        projection: { records: afterRecords, snapshotDigest: afterSnapshotDigest },
        receipt,
        receiptDigest: receipt.receiptDigest,
        receiptJson: canonicalJson(receipt),
        result: resultKind,
        stateTransition: {
            afterSnapshotDigest,
            applied: false,
            beforeSnapshotDigest: beforeSnapshot.digest,
            result: resultKind,
        },
    };
    return { result, normalized };
}
function receiptDigestOfCore(value) {
    const core = { ...value };
    delete core.receiptDigest;
    return digest(core);
}
export function decideAsfRollbackV1(value) {
    return verifyCore(value).result;
}
export function parseAsfRollbackV1(raw) {
    if (typeof raw !== "string")
        return deny("INVALID_JSON_DENIED");
    if (hasDuplicateKey(raw))
        return deny("DUPLICATE_KEY_DENIED");
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return deny("INVALID_JSON_DENIED");
    }
    const checked = verifyCore(parsed);
    if (checked.result.outcome !== "ACCEPTED")
        return checked.result;
    return raw === canonicalJson(checked.normalized) ? checked.result : deny("NONCANONICAL_ENCODING_DENIED");
}
export function asfRollbackReceiptDigestV1(value) {
    return receiptDigestOfCore(value);
}
export function validateAsfRollbackReceiptV1(value) {
    if (!exactKeys(value, RECEIPT_KEYS))
        return false;
    const receipt = value;
    const digests = [
        receipt.afterSnapshotDigest,
        receipt.beforeSnapshotDigest,
        receipt.candidateGenerationDigest,
        receipt.candidateLockDigest,
        receipt.lkgGenerationDigest,
        receipt.lkgLockIdentity,
        receipt.readbackDigest,
        receipt.receiptDigest,
    ];
    if (!digests.every(isDigest))
        return false;
    if (receipt.schemaVersion !== ASF_ROLLBACK_RECEIPT_SCHEMA_V1 ||
        receipt.approverClass !== "ASF_RING_APPROVER_V1" ||
        receipt.runtimeEffect !== ASF_ROLLBACK_RUNTIME_EFFECT_V1) {
        return false;
    }
    if (typeof receipt.requestId !== "string" || !REQUEST_ID.test(receipt.requestId))
        return false;
    if (!isId(receipt.skillId) || !validTarget(receipt.targetScope))
        return false;
    if (canonicalJson(receipt.authority) !== canonicalJson(ASF_ROLLBACK_AUTHORITY_V1))
        return false;
    if (receipt.afterSnapshotDigest !== receipt.readbackDigest)
        return false;
    if (receipt.result === "LKG_RESTORED") {
        if (receipt.decisionReason !== ASF_ROLLBACK_DECISION_REASON_LKG_V1)
            return false;
        if (receipt.lkgGenerationDigest === ASF_ROLLBACK_ABSENT_LKG_DIGEST_V1 ||
            receipt.lkgLockIdentity === ASF_ROLLBACK_ABSENT_LKG_DIGEST_V1) {
            return false;
        }
    }
    else if (receipt.result === "SCOPE_DISABLED") {
        if (receipt.decisionReason !== ASF_ROLLBACK_DECISION_REASON_DISABLE_V1)
            return false;
        if (receipt.lkgGenerationDigest !== ASF_ROLLBACK_ABSENT_LKG_DIGEST_V1 ||
            receipt.lkgLockIdentity !== ASF_ROLLBACK_ABSENT_LKG_DIGEST_V1) {
            return false;
        }
    }
    else {
        return false;
    }
    return asfRollbackReceiptDigestV1(value) === receipt.receiptDigest;
}
function hasDuplicateKey(raw) {
    const stack = [];
    let inString = false;
    let escaped = false;
    for (let index = 0; index < raw.length; index += 1) {
        const char = raw[index];
        if (inString) {
            if (escaped)
                escaped = false;
            else if (char === "\\")
                escaped = true;
            else if (char === '"')
                inString = false;
            continue;
        }
        if (char === '"') {
            let end = index + 1;
            while (end < raw.length) {
                if (raw[end] === "\\") {
                    end += 2;
                    continue;
                }
                if (raw[end] === '"')
                    break;
                end += 1;
            }
            let cursor = end + 1;
            while (/\s/.test(raw[cursor] ?? ""))
                cursor += 1;
            if (raw[cursor] === ":" && stack.length > 0) {
                let key;
                try {
                    key = JSON.parse(raw.slice(index, end + 1));
                }
                catch {
                    return false;
                }
                const current = stack[stack.length - 1];
                if (current?.has(key))
                    return true;
                current?.add(key);
                index = end;
                continue;
            }
            inString = true;
            continue;
        }
        if (char === "{")
            stack.push(new Set());
        else if (char === "}")
            stack.pop();
    }
    return false;
}
