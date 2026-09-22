/**
 * Pure ASF explicit activation decision contract (v1).
 *
 * This boundary consumes an already installed_inactive generation, an accepted
 * independent analysis receipt, and one exact compatible assignment. It emits
 * a deterministic decision/receipt only: it does not write pointers, execute a
 * runtime, discover assignments, or grant use-time authority.
 */
import { createHash } from "node:crypto";
import { validateAsfAnalysisReceiptV1, } from "./asf-analysis.js";
import { applyAsfAssignmentV1, } from "./asf-assignment.js";
import { verifyAsfCompatibilityMatrixV1, } from "./asf-compatibility-fence.js";
import { canonicalJson } from "./canonical-json.js";
import { decideAsfRollbackV1, } from "./asf-rollback.js";
import { decideAsfUpdateRingV1, } from "./asf-update-rings.js";
export const ASF_ACTIVATION_SCHEMA_V1 = "chimpmaera.asf/activation/v1";
export const ASF_ACTIVATION_REQUEST_SCHEMA_V1 = "chimpmaera.asf/activation-request/v1";
export const ASF_ACTIVATION_RECEIPT_SCHEMA_V1 = "chimpmaera.asf/activation-receipt/v1";
export const ASF_ACTIVATION_TARGET_STATE_V1 = "ACTIVE";
export const ASF_ACTIVATION_INSTALLED_INACTIVE_STATE_V1 = "installed_inactive";
export const ASF_ACTIVATION_AUTHORITY_V1 = Object.freeze({
    activation: "EXPLICIT_AUTHORIZED_DECISION_ONLY",
    execution: "NO_AUTHORITY",
    installation: "NO_AUTHORITY",
});
export const ASF_ACTIVATION_RUNTIME_EFFECT_V1 = "NOT_RUN";
export const ASF_ACTIVATION_DECISION_REASON_V1 = "EXPLICIT_AUTHORIZATION_FOR_EXACT_INSTALLED_GENERATION_AND_SCOPE";
/** A receipt-only composition of the existing bounded lifecycle decisions. */
export const ASF_LIFECYCLE_INTEGRATION_SCHEMA_V1 = "chimpmaera.asf/lifecycle-integration/v1";
export const ASF_LIFECYCLE_INTEGRATION_RECEIPT_SCHEMA_V1 = "chimpmaera.asf/lifecycle-integration-receipt/v1";
export const ASF_LIFECYCLE_INTEGRATION_RUNTIME_EFFECT_V1 = "NOT_RUN";
export const ASF_LIFECYCLE_INTEGRATION_AUTHORITY_V1 = Object.freeze({
    execution: "NO_AUTHORITY",
    integration: "RECEIPT_ONLY",
    pointerMutation: "NO_AUTHORITY",
});
export const ASF_LIFECYCLE_INTEGRATION_DECISION_REASON_V1 = "REQUIRED_DETERMINISTIC_DECISIONS_AND_EXACT_CROSS_BINDINGS_VERIFIED";
export const ASF_LIFECYCLE_INTEGRATION_REASON_ORDER_V1 = [
    "ACTIVATION_EVIDENCE_DENIED",
    "ASSIGNMENT_EVIDENCE_DENIED",
    "COMPATIBILITY_EVIDENCE_DENIED",
    "DUPLICATE_KEY_DENIED",
    "INTEGRATION_BINDING_DENIED",
    "INVALID_JSON_DENIED",
    "NONCANONICAL_ENCODING_DENIED",
    "ROLLBACK_READBACK_DENIED",
    "SCHEMA_DENIED",
    "UNSUPPORTED_VERSION_DENIED",
    "UPDATE_RING_EVIDENCE_DENIED",
];
export const ASF_LIFECYCLE_INTEGRATION_EXIT_CODES_V1 = Object.freeze({
    ASF_LIFECYCLE_INTEGRATION_ACCEPTED: 0,
    SCHEMA_DENIED: 140,
    UNSUPPORTED_VERSION_DENIED: 141,
    INVALID_JSON_DENIED: 142,
    DUPLICATE_KEY_DENIED: 143,
    NONCANONICAL_ENCODING_DENIED: 144,
    COMPATIBILITY_EVIDENCE_DENIED: 145,
    ASSIGNMENT_EVIDENCE_DENIED: 146,
    ACTIVATION_EVIDENCE_DENIED: 147,
    UPDATE_RING_EVIDENCE_DENIED: 148,
    ROLLBACK_READBACK_DENIED: 149,
    INTEGRATION_BINDING_DENIED: 150,
});
export const ASF_ACTIVATION_PROBE_IDS_V1 = [
    "NO_AUTOMATIC_ACTIVATION",
    "NO_SELF_APPROVAL",
    "NO_RUNTIME_EXECUTION",
];
export const ASF_ACTIVATION_REASON_ORDER_V1 = [
    "ACTIVE_STATE_DENIED",
    "ANALYSIS_RECEIPT_DENIED",
    "ANALYSIS_REVOKED_DENIED",
    "ANALYSIS_STALE_DENIED",
    "AUTO_ACTIVATION_DENIED",
    "DIGEST_MISMATCH_DENIED",
    "DUPLICATE_KEY_DENIED",
    "INCOMPATIBLE_TARGET_DENIED",
    "INVALID_JSON_DENIED",
    "NEGATIVE_PROBE_DENIED",
    "NONCANONICAL_ENCODING_DENIED",
    "NOT_INSTALLED_INACTIVE_DENIED",
    "SCHEMA_DENIED",
    "SELF_APPROVAL_DENIED",
    "UNASSIGNED_TARGET_DENIED",
    "UNSUPPORTED_VERSION_DENIED",
];
export const ASF_ACTIVATION_EXIT_CODES_V1 = Object.freeze({
    ASF_ACTIVATION_ACCEPTED: 0,
    SCHEMA_DENIED: 120,
    UNSUPPORTED_VERSION_DENIED: 121,
    INVALID_JSON_DENIED: 122,
    DUPLICATE_KEY_DENIED: 123,
    NONCANONICAL_ENCODING_DENIED: 124,
    ACTIVE_STATE_DENIED: 125,
    NOT_INSTALLED_INACTIVE_DENIED: 126,
    ANALYSIS_RECEIPT_DENIED: 127,
    ANALYSIS_STALE_DENIED: 128,
    ANALYSIS_REVOKED_DENIED: 129,
    AUTO_ACTIVATION_DENIED: 130,
    SELF_APPROVAL_DENIED: 131,
    UNASSIGNED_TARGET_DENIED: 132,
    INCOMPATIBLE_TARGET_DENIED: 133,
    DIGEST_MISMATCH_DENIED: 134,
    NEGATIVE_PROBE_DENIED: 135,
});
const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[a-z][a-z0-9.:_-]{2,127}$/;
const VERSION = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/;
const REQUEST_ID = /^activation-request:[a-z0-9][a-z0-9._-]{2,95}$/;
const TOP_LEVEL_KEYS = [
    "activationRequest", "analysisReceipt", "analysisStatus", "approval", "assignment", "generation",
    "installed", "lock", "matrix", "negativeProbes", "schemaVersion",
];
const REQUEST_KEYS = ["automaticActivation", "requestId", "requestedState", "requesterClass", "schemaVersion", "targetScope"];
const APPROVAL_KEYS = ["approverClass", "decision", "requestDigest"];
const GENERATION_KEYS = ["generationDigest", "lockDigest", "skillId", "version"];
const LOCK_KEYS = ["generationDigest", "lkgLockIdentity", "lockIdentity"];
const TARGET_KEYS = ["adapterId", "capabilityIds", "packId", "profileId", "routeId"];
const INSTALLED_KEYS = ["generationDigest", "lockDigest", "skillId", "state", "version"];
const PROBE_KEYS = ["outcome", "probeId"];
const ASSIGNMENT_KEYS = [
    "adapterId", "adapterVersion", "capabilityScope", "capabilities", "catalogDigest", "generationDigest",
    "lockDigest", "packDigest", "packId", "profileId", "profileVersion", "routeId", "routeVersion", "skillId",
    "state", "version",
];
const RECEIPT_KEYS = [
    "activationRequestDigest", "analysisReceiptDigest", "approverClass", "authority", "decisionReason",
    "generationDigest", "lockIdentity", "matrixDigest", "negativeProbeDigest", "receiptDigest", "requestId",
    "runtimeEffect", "schemaVersion", "targetScope",
];
const LIFECYCLE_INTEGRATION_KEYS = ["activation", "assignment", "compatibility", "rollback", "schemaVersion", "updateRing"];
const LIFECYCLE_INTEGRATION_RECEIPT_KEYS = [
    "activationReceiptDigest", "assignmentReceiptDigest", "authority", "compatibilityReceiptDigest", "decisionReason",
    "generationDigest", "lockIdentity", "matrixDigest", "receiptDigest", "rollbackReadbackDigest", "rollbackReceiptDigest",
    "runtimeEffect", "schemaVersion", "targetScope", "updateRingReceiptDigest",
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
        exitCode: ASF_ACTIVATION_EXIT_CODES_V1[reason],
        failClosed: { affectedScope: "DISABLE_OR_RETAIN_LKG", unrelatedAcceptedGenerations: "UNCHANGED" },
    };
}
function denyLifecycleIntegration(reason) {
    return {
        outcome: "DENIED",
        reasonCodes: [reason],
        exitCode: ASF_LIFECYCLE_INTEGRATION_EXIT_CODES_V1[reason],
        failClosed: { affectedScope: "DISABLE_OR_RETAIN_LKG", unrelatedAcceptedGenerations: "UNCHANGED" },
    };
}
function validTarget(value) {
    return exactKeys(value, TARGET_KEYS)
        && isId(value.adapterId) && isId(value.packId) && isId(value.profileId) && isId(value.routeId)
        && Array.isArray(value.capabilityIds) && value.capabilityIds.length > 0
        && value.capabilityIds.every(isId)
        && new Set(value.capabilityIds).size === value.capabilityIds.length;
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
function validInstalled(value) {
    return exactKeys(value, INSTALLED_KEYS) && isDigest(value.generationDigest) && isDigest(value.lockDigest)
        && isId(value.skillId) && isVersion(value.version)
        && (value.state === ASF_ACTIVATION_INSTALLED_INACTIVE_STATE_V1 || value.state === ASF_ACTIVATION_TARGET_STATE_V1);
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
function probeDigest(probes) {
    return digest([...probes].sort((left, right) => left.probeId.localeCompare(right.probeId)));
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
        return typeof schemaVersion === "string" && schemaVersion !== ASF_ACTIVATION_SCHEMA_V1
            ? fail("UNSUPPORTED_VERSION_DENIED") : fail("SCHEMA_DENIED");
    }
    if (value.schemaVersion !== ASF_ACTIVATION_SCHEMA_V1)
        return fail("UNSUPPORTED_VERSION_DENIED");
    const rawRequest = value.activationRequest;
    if (!exactKeys(rawRequest, REQUEST_KEYS) || !validTarget(rawRequest.targetScope))
        return fail("SCHEMA_DENIED");
    const request = rawRequest;
    if (request.schemaVersion !== ASF_ACTIVATION_REQUEST_SCHEMA_V1 || request.requestedState !== ASF_ACTIVATION_TARGET_STATE_V1
        || request.automaticActivation !== false
        || (request.requesterClass !== "ASF_PROPOSER_V1" && request.requesterClass !== "ASF_ASSIGNMENT_ACTIVATOR_V1")
        || !REQUEST_ID.test(request.requestId)) {
        if (request.automaticActivation !== false)
            return fail("AUTO_ACTIVATION_DENIED");
        return fail("SCHEMA_DENIED");
    }
    const rawApproval = value.approval;
    if (!exactKeys(rawApproval, APPROVAL_KEYS))
        return fail("SCHEMA_DENIED");
    const approval = rawApproval;
    if (approval.approverClass !== "ASF_ASSIGNMENT_ACTIVATOR_V1" || approval.decision !== "APPROVE")
        return fail("SCHEMA_DENIED");
    if (request.requesterClass === approval.approverClass)
        return fail("SELF_APPROVAL_DENIED");
    if (!isDigest(approval.requestDigest) || approval.requestDigest !== requestDigest(request))
        return fail("DIGEST_MISMATCH_DENIED");
    if (value.analysisStatus === "REVOKED")
        return fail("ANALYSIS_REVOKED_DENIED");
    if (value.analysisStatus !== "FRESH")
        return fail("ANALYSIS_STALE_DENIED");
    if (!validateAsfAnalysisReceiptV1(value.analysisReceipt))
        return fail("ANALYSIS_RECEIPT_DENIED");
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
    if (!Array.isArray(value.installed) || value.installed.length === 0 || !value.installed.every(validInstalled))
        return fail("SCHEMA_DENIED");
    const installed = value.installed;
    const targetInstalled = installed.find((entry) => entry.generationDigest === generation.generationDigest && entry.skillId === generation.skillId);
    if (targetInstalled?.state === ASF_ACTIVATION_TARGET_STATE_V1)
        return fail("ACTIVE_STATE_DENIED");
    if (targetInstalled === undefined || targetInstalled.state !== ASF_ACTIVATION_INSTALLED_INACTIVE_STATE_V1
        || targetInstalled.lockDigest !== generation.lockDigest || targetInstalled.version !== generation.version)
        return fail("NOT_INSTALLED_INACTIVE_DENIED");
    if (!validAssignment(value.assignment))
        return fail("SCHEMA_DENIED");
    const assignment = value.assignment;
    if (!targetMatches(request.targetScope, assignment))
        return fail("UNASSIGNED_TARGET_DENIED");
    if (assignment.generationDigest !== generation.generationDigest || assignment.lockDigest !== generation.lockDigest
        || assignment.skillId !== generation.skillId || assignment.version !== generation.version)
        return fail("DIGEST_MISMATCH_DENIED");
    const matrixResult = verifyAsfCompatibilityMatrixV1(value.matrix);
    if (matrixResult.outcome !== "ACCEPTED")
        return fail("DIGEST_MISMATCH_DENIED");
    const matrix = value.matrix;
    const row = matrix.rows.find((candidate) => tupleMatches(candidate, assignment));
    if (row === undefined)
        return fail("UNASSIGNED_TARGET_DENIED");
    if (row.verdict !== "COMPATIBLE")
        return fail("INCOMPATIBLE_TARGET_DENIED");
    if (!Array.isArray(value.negativeProbes))
        return fail("NEGATIVE_PROBE_DENIED");
    const rawNegativeProbes = value.negativeProbes;
    if (rawNegativeProbes.length !== ASF_ACTIVATION_PROBE_IDS_V1.length
        || !rawNegativeProbes.every((probe) => isRecord(probe) && exactKeys(probe, PROBE_KEYS)
            && ASF_ACTIVATION_PROBE_IDS_V1.includes(probe.probeId) && probe.outcome === "DENIED")
        || new Set(rawNegativeProbes.map((probe) => probe.probeId)).size !== ASF_ACTIVATION_PROBE_IDS_V1.length
        || ASF_ACTIVATION_PROBE_IDS_V1.some((probeId) => !rawNegativeProbes.some((probe) => probe.probeId === probeId)))
        return fail("NEGATIVE_PROBE_DENIED");
    const negativeProbes = rawNegativeProbes;
    const normalized = value;
    const core = {
        activationRequestDigest: requestDigest(request),
        analysisReceiptDigest: analysis.receiptDigest,
        approverClass: approval.approverClass,
        authority: ASF_ACTIVATION_AUTHORITY_V1,
        decisionReason: ASF_ACTIVATION_DECISION_REASON_V1,
        generationDigest: generation.generationDigest,
        lockIdentity: lock.lockIdentity,
        matrixDigest: matrix.matrixDigest,
        negativeProbeDigest: probeDigest(negativeProbes),
        requestId: request.requestId,
        runtimeEffect: ASF_ACTIVATION_RUNTIME_EFFECT_V1,
        schemaVersion: ASF_ACTIVATION_RECEIPT_SCHEMA_V1,
        targetScope: request.targetScope,
    };
    const receipt = { ...core, receiptDigest: receiptDigest(core) };
    const projected = installed.map((entry) => entry === targetInstalled ? { ...entry, state: ASF_ACTIVATION_TARGET_STATE_V1 } : entry);
    const result = {
        outcome: "ACCEPTED",
        reasonCodes: ["ASF_ACTIVATION_ACCEPTED"],
        exitCode: 0,
        canonicalJson: canonicalJson(normalized),
        projection: { installed: projected },
        receipt,
        receiptDigest: receipt.receiptDigest,
        receiptJson: canonicalJson(receipt),
        stateTransition: { from: ASF_ACTIVATION_INSTALLED_INACTIVE_STATE_V1, to: ASF_ACTIVATION_TARGET_STATE_V1 },
    };
    return { result, normalized };
}
export function activateAsfGenerationExplicitV1(value) {
    return verifyCore(value).result;
}
export function parseAsfActivationV1(raw) {
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
export function asfActivationReceiptDigestV1(value) {
    return receiptDigest(value);
}
export function validateAsfActivationReceiptV1(value) {
    return exactKeys(value, RECEIPT_KEYS)
        && isDigest(value.activationRequestDigest) && isDigest(value.analysisReceiptDigest) && isDigest(value.generationDigest)
        && isDigest(value.lockIdentity) && isDigest(value.matrixDigest) && isDigest(value.negativeProbeDigest)
        && isDigest(value.receiptDigest) && value.schemaVersion === ASF_ACTIVATION_RECEIPT_SCHEMA_V1
        && value.approverClass === "ASF_ASSIGNMENT_ACTIVATOR_V1"
        && value.decisionReason === ASF_ACTIVATION_DECISION_REASON_V1
        && value.runtimeEffect === ASF_ACTIVATION_RUNTIME_EFFECT_V1
        && typeof value.requestId === "string" && REQUEST_ID.test(value.requestId)
        && validTarget(value.targetScope)
        && canonicalJson(value.authority) === canonicalJson(ASF_ACTIVATION_AUTHORITY_V1)
        && asfActivationReceiptDigestV1(value) === value.receiptDigest;
}
function lifecycleIntegrationReceiptDigest(value) {
    const core = { ...value };
    delete core.receiptDigest;
    return digest(core);
}
function exactScopeMatches(left, right) {
    return canonicalJson(left) === canonicalJson(right);
}
/**
 * Re-evaluates the bounded compatibility, assignment, activation, ring, and
 * rollback/readback decisions. It emits no operational authority: acceptance
 * only proves every source decision and exact cross-binding were evidenced.
 */
export function decideAsfLifecycleIntegrationV1(value) {
    if (!isRecord(value))
        return denyLifecycleIntegration("SCHEMA_DENIED");
    const schemaVersion = value.schemaVersion;
    if (!exactKeys(value, LIFECYCLE_INTEGRATION_KEYS)) {
        return typeof schemaVersion === "string" && schemaVersion !== ASF_LIFECYCLE_INTEGRATION_SCHEMA_V1
            ? denyLifecycleIntegration("UNSUPPORTED_VERSION_DENIED")
            : denyLifecycleIntegration("SCHEMA_DENIED");
    }
    if (value.schemaVersion !== ASF_LIFECYCLE_INTEGRATION_SCHEMA_V1) {
        return denyLifecycleIntegration("UNSUPPORTED_VERSION_DENIED");
    }
    const compatibility = verifyAsfCompatibilityMatrixV1(value.compatibility);
    if (compatibility.outcome !== "ACCEPTED")
        return denyLifecycleIntegration("COMPATIBILITY_EVIDENCE_DENIED");
    const assignment = applyAsfAssignmentV1(value.assignment);
    if (assignment.outcome !== "ACCEPTED")
        return denyLifecycleIntegration("ASSIGNMENT_EVIDENCE_DENIED");
    const activation = activateAsfGenerationExplicitV1(value.activation);
    if (activation.outcome !== "ACCEPTED")
        return denyLifecycleIntegration("ACTIVATION_EVIDENCE_DENIED");
    const updateRing = decideAsfUpdateRingV1(value.updateRing);
    if (updateRing.outcome !== "ACCEPTED")
        return denyLifecycleIntegration("UPDATE_RING_EVIDENCE_DENIED");
    const rollback = decideAsfRollbackV1(value.rollback);
    if (rollback.outcome !== "ACCEPTED")
        return denyLifecycleIntegration("ROLLBACK_READBACK_DENIED");
    const targetScope = activation.receipt.targetScope;
    if (compatibility.receipt.matrixDigest !== assignment.receipt.matrixDigest
        || assignment.receipt.matrixDigest !== activation.receipt.matrixDigest
        || activation.receipt.matrixDigest !== updateRing.receipt.matrixDigest
        || assignment.receipt.lockIdentity !== activation.receipt.lockIdentity
        || activation.receipt.lockIdentity !== updateRing.receipt.lockIdentity
        || activation.receipt.generationDigest !== updateRing.receipt.generationDigest
        || activation.receipt.generationDigest !== rollback.receipt.candidateGenerationDigest
        || activation.receipt.lockIdentity !== rollback.receipt.candidateLockDigest
        || updateRing.receipt.skillId !== rollback.receipt.skillId
        || activation.receipt.analysisReceiptDigest !== updateRing.receipt.analysisReceiptDigest
        || !exactScopeMatches(targetScope, updateRing.receipt.targetScope)
        || !exactScopeMatches(targetScope, rollback.receipt.targetScope)) {
        return denyLifecycleIntegration("INTEGRATION_BINDING_DENIED");
    }
    const core = {
        activationReceiptDigest: activation.receiptDigest,
        assignmentReceiptDigest: assignment.receiptDigest,
        authority: ASF_LIFECYCLE_INTEGRATION_AUTHORITY_V1,
        compatibilityReceiptDigest: compatibility.receiptDigest,
        decisionReason: ASF_LIFECYCLE_INTEGRATION_DECISION_REASON_V1,
        generationDigest: activation.receipt.generationDigest,
        lockIdentity: activation.receipt.lockIdentity,
        matrixDigest: activation.receipt.matrixDigest,
        rollbackReadbackDigest: rollback.receipt.readbackDigest,
        rollbackReceiptDigest: rollback.receiptDigest,
        runtimeEffect: ASF_LIFECYCLE_INTEGRATION_RUNTIME_EFFECT_V1,
        schemaVersion: ASF_LIFECYCLE_INTEGRATION_RECEIPT_SCHEMA_V1,
        targetScope,
        updateRingReceiptDigest: updateRing.receiptDigest,
    };
    const receipt = { ...core, receiptDigest: lifecycleIntegrationReceiptDigest(core) };
    return {
        outcome: "ACCEPTED",
        reasonCodes: ["ASF_LIFECYCLE_INTEGRATION_ACCEPTED"],
        exitCode: 0,
        canonicalJson: canonicalJson(value),
        receipt,
        receiptDigest: receipt.receiptDigest,
        receiptJson: canonicalJson(receipt),
    };
}
export function parseAsfLifecycleIntegrationV1(raw) {
    if (typeof raw !== "string")
        return denyLifecycleIntegration("INVALID_JSON_DENIED");
    if (hasDuplicateKey(raw))
        return denyLifecycleIntegration("DUPLICATE_KEY_DENIED");
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return denyLifecycleIntegration("INVALID_JSON_DENIED");
    }
    const result = decideAsfLifecycleIntegrationV1(parsed);
    if (result.outcome !== "ACCEPTED")
        return result;
    return raw === canonicalJson(parsed) ? result : denyLifecycleIntegration("NONCANONICAL_ENCODING_DENIED");
}
export function asfLifecycleIntegrationReceiptDigestV1(value) {
    return lifecycleIntegrationReceiptDigest(value);
}
export function validateAsfLifecycleIntegrationReceiptV1(value) {
    return exactKeys(value, LIFECYCLE_INTEGRATION_RECEIPT_KEYS)
        && isDigest(value.activationReceiptDigest)
        && isDigest(value.assignmentReceiptDigest)
        && isDigest(value.compatibilityReceiptDigest)
        && isDigest(value.generationDigest)
        && isDigest(value.lockIdentity)
        && isDigest(value.matrixDigest)
        && isDigest(value.rollbackReadbackDigest)
        && isDigest(value.rollbackReceiptDigest)
        && isDigest(value.updateRingReceiptDigest)
        && isDigest(value.receiptDigest)
        && value.schemaVersion === ASF_LIFECYCLE_INTEGRATION_RECEIPT_SCHEMA_V1
        && value.decisionReason === ASF_LIFECYCLE_INTEGRATION_DECISION_REASON_V1
        && value.runtimeEffect === ASF_LIFECYCLE_INTEGRATION_RUNTIME_EFFECT_V1
        && validTarget(value.targetScope)
        && canonicalJson(value.authority) === canonicalJson(ASF_LIFECYCLE_INTEGRATION_AUTHORITY_V1)
        && asfLifecycleIntegrationReceiptDigestV1(value) === value.receiptDigest;
}
