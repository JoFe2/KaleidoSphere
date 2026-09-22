/**
 * Pure ASF controlled update-ring transition decision contract (v1).
 *
 * This boundary consumes an immutable candidate generation, a declared and
 * digested ring plan, the candidate's current ring state, an accepted
 * independent analysis receipt, and one exact compatible assignment inside a
 * verified compatibility fence. It emits a deterministic decision/receipt that
 * advances the candidate by exactly one declared ring only: it does not write
 * pointers, skip rings, install, activate, or execute a runtime. Re-running the
 * same decision is idempotent; re-evaluating after the projected state has
 * advanced is denied. All failures are closed to LKG retention or scope
 * disablement.
 */
import { createHash } from "node:crypto";
import { validateAsfAnalysisReceiptV1, } from "./asf-analysis.js";
import { verifyAsfCompatibilityMatrixV1, } from "./asf-compatibility-fence.js";
import { canonicalJson } from "./canonical-json.js";
export const ASF_UPDATE_RING_SCHEMA_V1 = "chimpmaera.asf/update-ring/v1";
export const ASF_UPDATE_RING_REQUEST_SCHEMA_V1 = "chimpmaera.asf/update-ring-request/v1";
export const ASF_UPDATE_RING_PLAN_SCHEMA_V1 = "chimpmaera.asf/update-ring-plan/v1";
export const ASF_UPDATE_RING_RECEIPT_SCHEMA_V1 = "chimpmaera.asf/update-ring-receipt/v1";
export const ASF_UPDATE_RING_GENESIS_RING_V1 = "GENESIS";
export const ASF_UPDATE_RING_GENESIS_RECEIPT_DIGEST_V1 = "0".repeat(64);
export const ASF_UPDATE_RING_AUTHORITY_V1 = Object.freeze({
    activation: "NO_AUTHORITY",
    execution: "NO_AUTHORITY",
    installation: "NO_AUTHORITY",
    promotion: "DECISION_ONLY",
});
export const ASF_UPDATE_RING_RUNTIME_EFFECT_V1 = "NOT_RUN";
export const ASF_UPDATE_RING_DECISION_REASON_V1 = "EXPLICIT_EVIDENCE_BOUND_ADVANCE_OF_EXACTLY_ONE_DECLARED_RING";
export const ASF_UPDATE_RING_PROBE_IDS_V1 = [
    "NO_AUTOMATIC_PROMOTION",
    "NO_SELF_PROMOTION",
    "NO_SKIP_PROMOTION",
    "NO_RUNTIME_EXECUTION",
];
export const ASF_UPDATE_RING_REASON_ORDER_V1 = [
    "ANALYSIS_REVOKED_DENIED",
    "ANALYSIS_STALE_DENIED",
    "AUTO_PROMOTION_DENIED",
    "DIGEST_MISMATCH_DENIED",
    "DUPLICATE_KEY_DENIED",
    "EVIDENCE_MISSING_DENIED",
    "INCOMPATIBLE_ASSIGNMENT_DENIED",
    "INVALID_JSON_DENIED",
    "MISSING_APPROVAL_DENIED",
    "MUTABLE_ALIAS_OR_RANGE_DENIED",
    "NEGATIVE_PROBE_DENIED",
    "NONCANONICAL_ENCODING_DENIED",
    "RING_STATE_DENIED",
    "SCHEMA_DENIED",
    "SELF_PROMOTION_DENIED",
    "SKIPPED_RING_DENIED",
    "UNKNOWN_RING_DENIED",
    "UNSUPPORTED_VERSION_DENIED",
];
export const ASF_UPDATE_RING_EXIT_CODES_V1 = Object.freeze({
    ASF_UPDATE_RING_ACCEPTED: 0,
    SCHEMA_DENIED: 160,
    UNSUPPORTED_VERSION_DENIED: 161,
    INVALID_JSON_DENIED: 162,
    DUPLICATE_KEY_DENIED: 163,
    NONCANONICAL_ENCODING_DENIED: 164,
    AUTO_PROMOTION_DENIED: 165,
    SELF_PROMOTION_DENIED: 166,
    MISSING_APPROVAL_DENIED: 167,
    ANALYSIS_REVOKED_DENIED: 168,
    ANALYSIS_STALE_DENIED: 169,
    EVIDENCE_MISSING_DENIED: 170,
    UNKNOWN_RING_DENIED: 171,
    SKIPPED_RING_DENIED: 172,
    RING_STATE_DENIED: 173,
    INCOMPATIBLE_ASSIGNMENT_DENIED: 174,
    MUTABLE_ALIAS_OR_RANGE_DENIED: 175,
    DIGEST_MISMATCH_DENIED: 176,
    NEGATIVE_PROBE_DENIED: 177,
});
const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[a-z][a-z0-9.:_-]{2,127}$/;
const VERSION = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/;
const RING_ID = /^ring:[a-z0-9][a-z0-9._-]{2,63}$/;
const REQUEST_ID = /^ring-request:[a-z0-9][a-z0-9._-]{2,95}$/;
const PLAN_ID = /^ringplan:[a-z0-9][a-z0-9._-]{2,95}$/;
const UNRESOLVED = /(?:\$\{|{{|}}|<[^>]*>|latest|HEAD)/i;
const WILDCARD = /\*/;
const TOP_LEVEL_KEYS = [
    "analysisReceipt", "analysisStatus", "approval", "assignment", "generation", "lock", "matrix",
    "negativeProbes", "promotionRequest", "ringPlan", "ringState", "schemaVersion",
];
const REQUEST_KEYS = ["automatic", "fromRing", "requestId", "requesterClass", "schemaVersion", "targetScope", "toRing"];
const APPROVAL_KEYS = ["approverClass", "decision", "requestDigest"];
const PLAN_KEYS = ["planId", "planDigest", "rings", "schemaVersion"];
const STATE_ENTRY_KEYS = ["generationDigest", "ringId", "receiptDigest", "skillId"];
const GENERATION_KEYS = ["generationDigest", "lockDigest", "skillId", "version"];
const LOCK_KEYS = ["generationDigest", "lkgLockIdentity", "lockIdentity"];
const TARGET_KEYS = ["adapterId", "capabilityIds", "packId", "profileId", "routeId"];
const PROBE_KEYS = ["outcome", "probeId"];
const ASSIGNMENT_KEYS = [
    "adapterId", "adapterVersion", "capabilityScope", "capabilities", "catalogDigest", "generationDigest",
    "lockDigest", "packDigest", "packId", "profileId", "profileVersion", "routeId", "routeVersion", "skillId",
    "state", "version",
];
const RECEIPT_KEYS = [
    "analysisReceiptDigest", "approverClass", "authority", "currentRingId", "decisionReason", "generationDigest",
    "lockIdentity", "matrixDigest", "negativeProbeDigest", "planDigest", "priorRingId", "priorRingReceiptDigest",
    "promotionRequestDigest", "receiptDigest", "requestId", "runtimeEffect", "schemaVersion", "skillId", "targetScope",
];
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, keys) {
    return isRecord(value) && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}
function digest(value) {
    return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
function isDigest(value) { return typeof value === "string" && DIGEST.test(value); }
function isId(value) { return typeof value === "string" && ID.test(value); }
function isVersion(value) { return typeof value === "string" && VERSION.test(value); }
function isRingId(value) {
    return typeof value === "string" && (value === ASF_UPDATE_RING_GENESIS_RING_V1 || RING_ID.test(value));
}
function isMutableClaim(value) {
    return typeof value === "string" && (WILDCARD.test(value) || UNRESOLVED.test(value));
}
function sameSet(left, right) {
    return canonicalJson([...new Set(left)].sort()) === canonicalJson([...new Set(right)].sort());
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
function deny(reason) {
    return {
        outcome: "DENIED",
        reasonCodes: [reason],
        exitCode: ASF_UPDATE_RING_EXIT_CODES_V1[reason],
        failClosed: { affectedScope: "DISABLE_OR_RETAIN_LKG", unrelatedAcceptedGenerations: "UNCHANGED" },
    };
}
function validTarget(value) {
    return exactKeys(value, TARGET_KEYS)
        && isId(value.adapterId) && isId(value.packId) && isId(value.profileId) && isId(value.routeId)
        && Array.isArray(value.capabilityIds) && value.capabilityIds.length > 0
        && value.capabilityIds.every(isId);
}
function validAssignment(value) {
    if (!exactKeys(value, ASSIGNMENT_KEYS))
        return false;
    if (value.capabilityScope !== "EXPLICIT" || value.state !== "ENABLED")
        return false;
    if (![value.adapterId, value.packId, value.profileId, value.routeId, value.skillId].every(isId))
        return false;
    if (![value.adapterVersion, value.profileVersion, value.routeVersion, value.version].every(isVersion))
        return false;
    if (![value.catalogDigest, value.generationDigest, value.lockDigest, value.packDigest].every(isDigest))
        return false;
    if (!Array.isArray(value.capabilities) || value.capabilities.length === 0)
        return false;
    return value.capabilities.every((entry) => isRecord(entry)
        && exactKeys(entry, ["capabilityId", "digest", "version"])
        && isId(entry.capabilityId) && isDigest(entry.digest) && isVersion(entry.version));
}
function validGeneration(value) {
    return exactKeys(value, GENERATION_KEYS) && isDigest(value.generationDigest) && isDigest(value.lockDigest)
        && isId(value.skillId) && isVersion(value.version);
}
function validStateEntry(value) {
    return exactKeys(value, STATE_ENTRY_KEYS) && isDigest(value.generationDigest) && isRingId(value.ringId)
        && isDigest(value.receiptDigest) && isId(value.skillId);
}
function tupleMatches(row, assignment) {
    for (const key of ["adapterId", "adapterVersion", "catalogDigest", "generationDigest", "lockDigest", "packDigest", "packId", "profileId", "profileVersion", "routeId", "routeVersion", "skillId", "version"]) {
        if (row[key] !== assignment[key])
            return false;
    }
    return sameSet(row.capabilities.map((entry) => entry.capabilityId), assignment.capabilities.map((entry) => entry.capabilityId))
        && row.capabilities.length === assignment.capabilities.length
        && row.capabilities.every((entry) => assignment.capabilities.some((candidate) => canonicalJson(candidate) === canonicalJson(entry)));
}
function targetMatches(target, assignment) {
    return target.adapterId === assignment.adapterId && target.packId === assignment.packId
        && target.profileId === assignment.profileId && target.routeId === assignment.routeId
        && sameSet(target.capabilityIds, assignment.capabilities.map((entry) => entry.capabilityId));
}
function requestDigest(request) {
    return digest(request);
}
function planDigest(plan) {
    return digest(plan);
}
function probeDigest(probes) {
    return digest([...probes].sort((left, right) => left.probeId.localeCompare(right.probeId)));
}
function nextDeclaredRing(plan, fromRing) {
    if (fromRing === ASF_UPDATE_RING_GENESIS_RING_V1)
        return plan.rings[0];
    const index = plan.rings.indexOf(fromRing);
    return index === -1 ? undefined : plan.rings[index + 1];
}
function receiptDigest(value) {
    const core = { ...value };
    delete core.receiptDigest;
    return digest(core);
}
function verifyCore(value) {
    const fail = (reason) => ({ result: deny(reason), normalized: null });
    if (!isRecord(value))
        return fail("SCHEMA_DENIED");
    const schemaVersion = value.schemaVersion;
    if (!exactKeys(value, TOP_LEVEL_KEYS)) {
        return typeof schemaVersion === "string" && schemaVersion !== ASF_UPDATE_RING_SCHEMA_V1
            ? fail("UNSUPPORTED_VERSION_DENIED") : fail("SCHEMA_DENIED");
    }
    if (value.schemaVersion !== ASF_UPDATE_RING_SCHEMA_V1)
        return fail("UNSUPPORTED_VERSION_DENIED");
    const rawRequest = value.promotionRequest;
    if (!exactKeys(rawRequest, REQUEST_KEYS) || !validTarget(rawRequest.targetScope))
        return fail("SCHEMA_DENIED");
    const request = rawRequest;
    if (request.automatic !== false)
        return fail("AUTO_PROMOTION_DENIED");
    if (request.schemaVersion !== ASF_UPDATE_RING_REQUEST_SCHEMA_V1
        || request.requesterClass !== "ASF_PROPOSER_V1" && request.requesterClass !== "ASF_RING_APPROVER_V1"
        || !REQUEST_ID.test(request.requestId) || !isRingId(request.fromRing) || !isRingId(request.toRing)
        || request.toRing === ASF_UPDATE_RING_GENESIS_RING_V1)
        return fail("SCHEMA_DENIED");
    const rawApproval = value.approval;
    if (!exactKeys(rawApproval, APPROVAL_KEYS))
        return fail("SCHEMA_DENIED");
    const approval = rawApproval;
    if (approval.approverClass !== "ASF_RING_APPROVER_V1" || approval.decision !== "APPROVE")
        return fail("MISSING_APPROVAL_DENIED");
    if (request.requesterClass === approval.approverClass)
        return fail("SELF_PROMOTION_DENIED");
    if (!isDigest(approval.requestDigest) || approval.requestDigest !== requestDigest(request))
        return fail("DIGEST_MISMATCH_DENIED");
    if (value.analysisStatus === "REVOKED")
        return fail("ANALYSIS_REVOKED_DENIED");
    if (value.analysisStatus !== "FRESH")
        return fail("ANALYSIS_STALE_DENIED");
    if (!validateAsfAnalysisReceiptV1(value.analysisReceipt))
        return fail("EVIDENCE_MISSING_DENIED");
    const analysis = value.analysisReceipt;
    const rawGeneration = value.generation;
    const rawLock = value.lock;
    if (!exactKeys(rawGeneration, GENERATION_KEYS) || !validGeneration(rawGeneration)
        || !exactKeys(rawLock, LOCK_KEYS)
        || !isDigest(rawLock.generationDigest) || !isDigest(rawLock.lockIdentity) || !isDigest(rawLock.lkgLockIdentity))
        return fail("SCHEMA_DENIED");
    const generation = rawGeneration;
    const lock = rawLock;
    if (lock.generationDigest !== generation.generationDigest || lock.lockIdentity !== generation.lockDigest
        || analysis.generationDigest !== generation.generationDigest || analysis.lockDigest !== generation.lockDigest
        || analysis.verdict !== "ACCEPTED")
        return fail("DIGEST_MISMATCH_DENIED");
    const rawPlan = value.ringPlan;
    if (!exactKeys(rawPlan, PLAN_KEYS))
        return fail("SCHEMA_DENIED");
    const plan = rawPlan;
    if (plan.schemaVersion !== ASF_UPDATE_RING_PLAN_SCHEMA_V1 || !PLAN_ID.test(plan.planId)
        || !Array.isArray(plan.rings) || plan.rings.length < 2 || plan.rings.length > 8
        || !plan.rings.every(isRingId)
        || new Set(plan.rings).size !== plan.rings.length
        || !isDigest(plan.planDigest))
        return fail("SCHEMA_DENIED");
    if ([plan.planId, ...plan.rings].some(isMutableClaim))
        return fail("MUTABLE_ALIAS_OR_RANGE_DENIED");
    if (!plan.rings.includes(request.fromRing) && request.fromRing !== ASF_UPDATE_RING_GENESIS_RING_V1
        || !plan.rings.includes(request.toRing))
        return fail("UNKNOWN_RING_DENIED");
    if (plan.planDigest !== planDigest({ planId: plan.planId, rings: plan.rings, schemaVersion: plan.schemaVersion })) {
        return fail("DIGEST_MISMATCH_DENIED");
    }
    if (!Array.isArray(value.ringState) || value.ringState.length === 0 || !value.ringState.every(validStateEntry))
        return fail("SCHEMA_DENIED");
    const ringState = value.ringState;
    const targetEntry = ringState.find((entry) => entry.generationDigest === generation.generationDigest && entry.skillId === generation.skillId);
    if (targetEntry === undefined || targetEntry.ringId !== request.fromRing)
        return fail("RING_STATE_DENIED");
    if ((targetEntry.ringId === ASF_UPDATE_RING_GENESIS_RING_V1) !== (targetEntry.receiptDigest === ASF_UPDATE_RING_GENESIS_RECEIPT_DIGEST_V1)) {
        return fail("DIGEST_MISMATCH_DENIED");
    }
    if (request.toRing !== nextDeclaredRing(plan, request.fromRing))
        return fail("SKIPPED_RING_DENIED");
    if (!validAssignment(value.assignment))
        return fail("SCHEMA_DENIED");
    const assignment = value.assignment;
    if (!targetMatches(request.targetScope, assignment))
        return fail("INCOMPATIBLE_ASSIGNMENT_DENIED");
    if (assignment.generationDigest !== generation.generationDigest || assignment.lockDigest !== generation.lockDigest
        || assignment.skillId !== generation.skillId || assignment.version !== generation.version)
        return fail("DIGEST_MISMATCH_DENIED");
    const matrixResult = verifyAsfCompatibilityMatrixV1(value.matrix);
    if (matrixResult.outcome !== "ACCEPTED")
        return fail("DIGEST_MISMATCH_DENIED");
    const matrix = value.matrix;
    const row = matrix.rows.find((candidate) => tupleMatches(candidate, assignment));
    if (row === undefined || row.verdict !== "COMPATIBLE")
        return fail("INCOMPATIBLE_ASSIGNMENT_DENIED");
    if (!Array.isArray(value.negativeProbes))
        return fail("NEGATIVE_PROBE_DENIED");
    const rawNegativeProbes = value.negativeProbes;
    if (rawNegativeProbes.length !== ASF_UPDATE_RING_PROBE_IDS_V1.length
        || !rawNegativeProbes.every((probe) => isRecord(probe) && exactKeys(probe, PROBE_KEYS)
            && ASF_UPDATE_RING_PROBE_IDS_V1.includes(probe.probeId) && probe.outcome === "DENIED")
        || new Set(rawNegativeProbes.map((probe) => probe.probeId)).size !== ASF_UPDATE_RING_PROBE_IDS_V1.length
        || ASF_UPDATE_RING_PROBE_IDS_V1.some((probeId) => !rawNegativeProbes.some((probe) => probe.probeId === probeId)))
        return fail("NEGATIVE_PROBE_DENIED");
    const negativeProbes = rawNegativeProbes;
    const normalized = value;
    const core = {
        analysisReceiptDigest: analysis.receiptDigest,
        approverClass: approval.approverClass,
        authority: ASF_UPDATE_RING_AUTHORITY_V1,
        currentRingId: request.toRing,
        decisionReason: ASF_UPDATE_RING_DECISION_REASON_V1,
        generationDigest: generation.generationDigest,
        lockIdentity: lock.lockIdentity,
        matrixDigest: matrix.matrixDigest,
        negativeProbeDigest: probeDigest(negativeProbes),
        planDigest: plan.planDigest,
        priorRingId: request.fromRing,
        priorRingReceiptDigest: targetEntry.receiptDigest,
        promotionRequestDigest: requestDigest(request),
        requestId: request.requestId,
        runtimeEffect: ASF_UPDATE_RING_RUNTIME_EFFECT_V1,
        schemaVersion: ASF_UPDATE_RING_RECEIPT_SCHEMA_V1,
        skillId: generation.skillId,
        targetScope: request.targetScope,
    };
    const receipt = { ...core, receiptDigest: receiptDigest(core) };
    const projected = ringState.map((entry) => entry === targetEntry
        ? { ...entry, ringId: request.toRing, receiptDigest: receipt.receiptDigest }
        : entry);
    const result = {
        outcome: "ACCEPTED",
        reasonCodes: ["ASF_UPDATE_RING_ACCEPTED"],
        exitCode: 0,
        canonicalJson: canonicalJson(normalized),
        projection: { ringState: projected },
        receipt,
        receiptDigest: receipt.receiptDigest,
        receiptJson: canonicalJson(receipt),
        stateTransition: { activated: false, fromRing: request.fromRing, toRing: request.toRing },
    };
    return { result, normalized };
}
export function decideAsfUpdateRingV1(value) {
    return verifyCore(value).result;
}
export function parseAsfUpdateRingV1(raw) {
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
    if (checked.result.outcome !== "ACCEPTED" || checked.normalized === null)
        return checked.result;
    return raw === canonicalJson(checked.normalized) ? checked.result : deny("NONCANONICAL_ENCODING_DENIED");
}
export function asfUpdateRingReceiptDigestV1(value) {
    return receiptDigest(value);
}
export function validateAsfUpdateRingReceiptV1(value) {
    return exactKeys(value, RECEIPT_KEYS)
        && isDigest(value.analysisReceiptDigest) && isDigest(value.generationDigest) && isDigest(value.lockIdentity)
        && isDigest(value.matrixDigest) && isDigest(value.negativeProbeDigest) && isDigest(value.planDigest)
        && isDigest(value.priorRingReceiptDigest) && isDigest(value.promotionRequestDigest) && isDigest(value.receiptDigest)
        && value.schemaVersion === ASF_UPDATE_RING_RECEIPT_SCHEMA_V1
        && value.approverClass === "ASF_RING_APPROVER_V1"
        && value.decisionReason === ASF_UPDATE_RING_DECISION_REASON_V1
        && value.runtimeEffect === ASF_UPDATE_RING_RUNTIME_EFFECT_V1
        && typeof value.requestId === "string" && REQUEST_ID.test(value.requestId)
        && isRingId(value.priorRingId)
        && typeof value.currentRingId === "string" && RING_ID.test(value.currentRingId)
        && isId(value.skillId)
        && validTarget(value.targetScope)
        && canonicalJson(value.authority) === canonicalJson(ASF_UPDATE_RING_AUTHORITY_V1)
        && asfUpdateRingReceiptDigestV1(value) === value.receiptDigest;
}
