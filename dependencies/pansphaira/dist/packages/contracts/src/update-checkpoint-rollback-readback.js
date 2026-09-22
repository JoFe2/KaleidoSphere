import { createHash } from "node:crypto";
import { types as nodeUtilTypes } from "node:util";
import { canonicalJson } from "./canonical-json.js";
/**
 * PSAI #53 migration checkpoint/readback proof.
 *
 * This is a closed, pure metadata contract. It proves that an independent
 * observer saw the exact unrevoked rollback target, the expected owner state,
 * a synthetic postcondition failure, zero residue, and a deterministic retry
 * receipt. It authorizes neither migration nor restore and performs no I/O.
 */
export const UPDATE_CHECKPOINT_ROLLBACK_READBACK_SCHEMA_V1 = "chimpmaera.update/checkpoint-rollback-readback/v1";
export const UPDATE_CHECKPOINT_ROLLBACK_READBACK_VERIFIER_SCHEMA_V1 = "chimpmaera.update/checkpoint-rollback-readback-verifier/v1";
export const UPDATE_CHECKPOINT_ROLLBACK_READBACK_RETRY_RECEIPT_SCHEMA_V1 = "chimpmaera.update/retry-receipt/v1";
export const UPDATE_CHECKPOINT_ROLLBACK_READBACK_PHASE_V1 = "PRE_MIGRATION_CHECKPOINT_READBACK";
export const UPDATE_CHECKPOINT_ROLLBACK_READBACK_TRANSITION_V1 = "READBACK_VERIFIED";
export const UPDATE_CHECKPOINT_ROLLBACK_READBACK_FAILURE_V1 = "SYNTHETIC_POSTCONDITION_FAILURE";
export const UPDATE_CHECKPOINT_ROLLBACK_READBACK_ZERO_RESIDUE_V1 = 0;
export const UPDATE_CHECKPOINT_ROLLBACK_READBACK_KEYS_V1 = Object.freeze([
    "schemaVersion", "transition", "phase", "operationDigest", "migrationEdgeDigest", "checkpointDigest",
    "rollbackTargetTupleDigest", "expectedRollbackTargetTupleDigest", "observedRollbackTargetTupleDigest",
    "rollbackTargetRevoked", "independentEvidenceDigest", "expectedIndependentEvidenceDigest",
    "observedOwnerStateDigest", "expectedOwnerStateDigest", "residueCount", "failureScenario",
    "retryReceiptSchemaVersion", "retryOrdinal", "retryReceiptDigest", "retryDeterminismDigest",
    "verifier", "authorityProfileDigest", "observedAtMs", "readbackDigest",
]);
const VERIFIER_KEYS = Object.freeze(["schemaVersion", "verifierId", "verifierVersion"]);
const BUILD_KEYS = Object.freeze([
    "operationDigest", "migrationEdgeDigest", "checkpointDigest", "rollbackTargetTupleDigest",
    "independentEvidenceDigest", "ownerStateDigest", "retryOrdinal", "retryReceiptDigest",
    "authorityProfileDigest", "verifier", "observedAtMs",
]);
const CONTEXT_KEYS = Object.freeze([
    "expectedOperationDigest", "expectedMigrationEdgeDigest", "expectedCheckpointDigest",
    "expectedRollbackTargetTupleDigest", "expectedIndependentEvidenceDigest", "expectedOwnerStateDigest",
    "expectedRetryOrdinal", "expectedRetryReceiptDigest", "expectedRetryDeterminismDigest",
    "expectedAuthorityProfileDigest", "expectedVerifier", "expectedObservedAtMs",
]);
const EXPECTED_VERIFIER_KEYS = Object.freeze(["verifierId", "verifierVersion"]);
export const UPDATE_CHECKPOINT_ROLLBACK_READBACK_EXIT_CODES_V1 = Object.freeze({
    READBACK_VERIFIED: 0,
    INVALID_JSON_DENIED: 71,
    SCHEMA_DENIED: 72,
    UNSUPPORTED_CONTRACT_VERSION_DENIED: 73,
    INDEPENDENT_CONTEXT_DENIED: 74,
    DIGEST_MISMATCH_DENIED: 75,
    CHECKPOINT_BINDING_DENIED: 76,
    EDGE_BINDING_DENIED: 77,
    ROLLBACK_TARGET_MISMATCH_DENIED: 78,
    ROLLBACK_TARGET_REVOKED_DENIED: 79,
    INDEPENDENT_EVIDENCE_DENIED: 80,
    OWNER_STATE_MISMATCH_DENIED: 81,
    RESIDUE_PRESENT_DENIED: 82,
    RETRY_RECEIPT_MISMATCH_DENIED: 83,
    RETRY_NONDETERMINISTIC_DENIED: 84,
    AUTHORITY_DRIFT_DENIED: 85,
    VERIFIER_MISMATCH_DENIED: 86,
    AUTHORITY_CLAIM_DENIED: 87,
});
const DIGEST = /^[a-f0-9]{64}$/;
const VERIFIER_ID = /^verifier:independent-[a-z0-9][a-z0-9._-]{2,95}$/;
const CANONICAL_SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const NEUTRAL_VERIFIER_ID = /^verifier:independent-(?:readback|checkpoint)-verifier$/;
function isPlainRecord(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype)
        return false;
    for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== "string" || DANGEROUS_KEYS.has(key))
            return false;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true)
            return false;
    }
    return true;
}
function exactKeys(value, expected) {
    if (!isPlainRecord(value))
        return false;
    const actual = Object.keys(value).sort();
    const wanted = [...expected].sort();
    return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}
function isDenseArray(value) {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
        return false;
    const keys = Reflect.ownKeys(value);
    const expected = [...Array.from({ length: value.length }, (_, index) => String(index)), "length"];
    return keys.every((key) => typeof key === "string")
        && keys.length === expected.length && expected.every((key) => keys.includes(key))
        && Array.from({ length: value.length }, (_, index) => String(index)).every((key) => {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            return descriptor !== undefined && "value" in descriptor && descriptor.enumerable === true;
        });
}
function safeClone(value, ancestors = new Set()) {
    if (nodeUtilTypes.isProxy(value))
        throw new TypeError("UNSAFE_JSON_PROXY");
    if (value === null || typeof value === "string" || typeof value === "boolean")
        return value;
    if (typeof value === "number") {
        if (!Number.isFinite(value) || Object.is(value, -0) || (Number.isInteger(value) && !Number.isSafeInteger(value)))
            throw new TypeError("UNSAFE_JSON_NUMBER");
        return value;
    }
    if (Array.isArray(value)) {
        if (!isDenseArray(value) || ancestors.has(value))
            throw new TypeError("UNSAFE_JSON_ARRAY");
        return value.map((item) => safeClone(item, new Set(ancestors).add(value)));
    }
    if (!isPlainRecord(value) || ancestors.has(value))
        throw new TypeError("UNSAFE_JSON_OBJECT");
    const output = {};
    for (const key of Object.keys(value))
        output[key] = safeClone(value[key], new Set(ancestors).add(value));
    return output;
}
function deepFreeze(value) {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
        for (const key of Reflect.ownKeys(value))
            if (key !== "length")
                deepFreeze(value[key]);
        Object.freeze(value);
    }
    return value;
}
function immutable(value) { return deepFreeze(safeClone(value)); }
function isDigest(value) { return typeof value === "string" && DIGEST.test(value); }
function isTime(value) { return Number.isSafeInteger(value) && !Object.is(value, -0) && value >= 0; }
function isPositiveInteger(value) { return Number.isSafeInteger(value) && !Object.is(value, -0) && value > 0; }
function isVerifierIdentity(value) {
    return exactKeys(value, EXPECTED_VERIFIER_KEYS)
        && typeof value.verifierId === "string" && VERIFIER_ID.test(value.verifierId)
        && typeof value.verifierVersion === "string" && CANONICAL_SEMVER.test(value.verifierVersion);
}
function isVerifier(value) {
    return exactKeys(value, VERIFIER_KEYS)
        && value.schemaVersion === UPDATE_CHECKPOINT_ROLLBACK_READBACK_VERIFIER_SCHEMA_V1
        && typeof value.verifierId === "string" && VERIFIER_ID.test(value.verifierId)
        && typeof value.verifierVersion === "string" && CANONICAL_SEMVER.test(value.verifierVersion);
}
function isProof(value) {
    return exactKeys(value, UPDATE_CHECKPOINT_ROLLBACK_READBACK_KEYS_V1)
        && value.schemaVersion === UPDATE_CHECKPOINT_ROLLBACK_READBACK_SCHEMA_V1
        && value.transition === UPDATE_CHECKPOINT_ROLLBACK_READBACK_TRANSITION_V1
        && value.phase === UPDATE_CHECKPOINT_ROLLBACK_READBACK_PHASE_V1
        && isDigest(value.operationDigest) && isDigest(value.migrationEdgeDigest) && isDigest(value.checkpointDigest)
        && isDigest(value.rollbackTargetTupleDigest) && isDigest(value.expectedRollbackTargetTupleDigest)
        && isDigest(value.observedRollbackTargetTupleDigest) && typeof value.rollbackTargetRevoked === "boolean"
        && isDigest(value.independentEvidenceDigest) && isDigest(value.expectedIndependentEvidenceDigest)
        && isDigest(value.observedOwnerStateDigest) && isDigest(value.expectedOwnerStateDigest)
        && Number.isSafeInteger(value.residueCount) && value.residueCount >= 0 && !Object.is(value.residueCount, -0)
        && value.failureScenario === UPDATE_CHECKPOINT_ROLLBACK_READBACK_FAILURE_V1
        && value.retryReceiptSchemaVersion === UPDATE_CHECKPOINT_ROLLBACK_READBACK_RETRY_RECEIPT_SCHEMA_V1
        && isPositiveInteger(value.retryOrdinal) && isDigest(value.retryReceiptDigest) && isDigest(value.retryDeterminismDigest)
        && isVerifier(value.verifier) && isDigest(value.authorityProfileDigest) && isDigest(value.readbackDigest);
}
function isContext(value) {
    return exactKeys(value, CONTEXT_KEYS)
        && isDigest(value.expectedOperationDigest) && isDigest(value.expectedMigrationEdgeDigest)
        && isDigest(value.expectedCheckpointDigest) && isDigest(value.expectedRollbackTargetTupleDigest)
        && isDigest(value.expectedIndependentEvidenceDigest) && isDigest(value.expectedOwnerStateDigest)
        && isPositiveInteger(value.expectedRetryOrdinal) && isDigest(value.expectedRetryReceiptDigest)
        && isDigest(value.expectedRetryDeterminismDigest) && isDigest(value.expectedAuthorityProfileDigest)
        && isVerifierIdentity(value.expectedVerifier) && isTime(value.expectedObservedAtMs);
}
function isNeutralVerifier(verifierId) { return NEUTRAL_VERIFIER_ID.test(verifierId); }
export function updateCheckpointRollbackRetryDeterminismDigestV1(value) {
    const cloned = safeClone(value);
    if (!exactKeys(cloned, ["operationDigest", "migrationEdgeDigest", "rollbackTargetTupleDigest", "retryOrdinal", "retryReceiptDigest"]))
        throw new TypeError("UNSAFE_RETRY_BINDING");
    return createHash("sha256").update(canonicalJson(cloned)).digest("hex");
}
/** Canonical SHA-256 over the proof envelope excluding readbackDigest. */
export function updateCheckpointRollbackReadbackDigestV1(value) {
    const cloned = safeClone(value);
    if (!isPlainRecord(cloned))
        throw new TypeError("UNSAFE_READBACK_DIGEST_INPUT");
    const unsigned = Object.fromEntries(Object.keys(cloned).filter((key) => key !== "readbackDigest").map((key) => [key, cloned[key]]));
    return createHash("sha256").update(canonicalJson(unsigned)).digest("hex");
}
function deny(reason) {
    return immutable({ outcome: "DENIED", reasonCodes: [reason], exitCode: UPDATE_CHECKPOINT_ROLLBACK_READBACK_EXIT_CODES_V1[reason] });
}
export function buildUpdateCheckpointRollbackReadbackV1(options) {
    let cloned;
    try {
        cloned = safeClone(options);
    }
    catch {
        throw new Error("INVALID_CHECKPOINT_ROLLBACK_READBACK_FIXTURE");
    }
    if (!exactKeys(cloned, BUILD_KEYS)
        || !isDigest(cloned.operationDigest) || !isDigest(cloned.migrationEdgeDigest) || !isDigest(cloned.checkpointDigest)
        || !isDigest(cloned.rollbackTargetTupleDigest) || !isDigest(cloned.independentEvidenceDigest)
        || !isDigest(cloned.ownerStateDigest) || !isPositiveInteger(cloned.retryOrdinal) || !isDigest(cloned.retryReceiptDigest)
        || !isDigest(cloned.authorityProfileDigest) || !isVerifierIdentity(cloned.verifier)
        || !isNeutralVerifier(cloned.verifier.verifierId) || !isTime(cloned.observedAtMs)) {
        throw new Error("INVALID_CHECKPOINT_ROLLBACK_READBACK_FIXTURE");
    }
    const retryDeterminismDigest = updateCheckpointRollbackRetryDeterminismDigestV1({
        operationDigest: cloned.operationDigest,
        migrationEdgeDigest: cloned.migrationEdgeDigest,
        rollbackTargetTupleDigest: cloned.rollbackTargetTupleDigest,
        retryOrdinal: cloned.retryOrdinal,
        retryReceiptDigest: cloned.retryReceiptDigest,
    });
    const unsigned = {
        schemaVersion: UPDATE_CHECKPOINT_ROLLBACK_READBACK_SCHEMA_V1,
        transition: UPDATE_CHECKPOINT_ROLLBACK_READBACK_TRANSITION_V1,
        phase: UPDATE_CHECKPOINT_ROLLBACK_READBACK_PHASE_V1,
        operationDigest: cloned.operationDigest,
        migrationEdgeDigest: cloned.migrationEdgeDigest,
        checkpointDigest: cloned.checkpointDigest,
        rollbackTargetTupleDigest: cloned.rollbackTargetTupleDigest,
        expectedRollbackTargetTupleDigest: cloned.rollbackTargetTupleDigest,
        observedRollbackTargetTupleDigest: cloned.rollbackTargetTupleDigest,
        rollbackTargetRevoked: false,
        independentEvidenceDigest: cloned.independentEvidenceDigest,
        expectedIndependentEvidenceDigest: cloned.independentEvidenceDigest,
        observedOwnerStateDigest: cloned.ownerStateDigest,
        expectedOwnerStateDigest: cloned.ownerStateDigest,
        residueCount: UPDATE_CHECKPOINT_ROLLBACK_READBACK_ZERO_RESIDUE_V1,
        failureScenario: UPDATE_CHECKPOINT_ROLLBACK_READBACK_FAILURE_V1,
        retryReceiptSchemaVersion: UPDATE_CHECKPOINT_ROLLBACK_READBACK_RETRY_RECEIPT_SCHEMA_V1,
        retryOrdinal: cloned.retryOrdinal,
        retryReceiptDigest: cloned.retryReceiptDigest,
        retryDeterminismDigest,
        verifier: {
            schemaVersion: UPDATE_CHECKPOINT_ROLLBACK_READBACK_VERIFIER_SCHEMA_V1,
            verifierId: cloned.verifier.verifierId,
            verifierVersion: cloned.verifier.verifierVersion,
        },
        authorityProfileDigest: cloned.authorityProfileDigest,
        observedAtMs: cloned.observedAtMs,
    };
    return immutable({ ...unsigned, readbackDigest: updateCheckpointRollbackReadbackDigestV1(unsigned) });
}
export function verifyUpdateCheckpointRollbackReadbackV1(value, context) {
    let proofInput;
    try {
        proofInput = safeClone(value);
    }
    catch {
        return deny("SCHEMA_DENIED");
    }
    if (!exactKeys(proofInput, UPDATE_CHECKPOINT_ROLLBACK_READBACK_KEYS_V1))
        return deny("SCHEMA_DENIED");
    if (isPlainRecord(proofInput) && proofInput.schemaVersion !== UPDATE_CHECKPOINT_ROLLBACK_READBACK_SCHEMA_V1)
        return deny("UNSUPPORTED_CONTRACT_VERSION_DENIED");
    if (!isProof(proofInput))
        return deny("SCHEMA_DENIED");
    if (context === undefined)
        return deny("INDEPENDENT_CONTEXT_DENIED");
    let contextInput;
    try {
        contextInput = safeClone(context);
    }
    catch {
        return deny("INDEPENDENT_CONTEXT_DENIED");
    }
    if (!isContext(contextInput))
        return deny("INDEPENDENT_CONTEXT_DENIED");
    const proof = proofInput;
    const expected = contextInput;
    if (updateCheckpointRollbackReadbackDigestV1(proof) !== proof.readbackDigest)
        return deny("DIGEST_MISMATCH_DENIED");
    if (proof.operationDigest !== expected.expectedOperationDigest)
        return deny("CHECKPOINT_BINDING_DENIED");
    if (proof.migrationEdgeDigest !== expected.expectedMigrationEdgeDigest)
        return deny("EDGE_BINDING_DENIED");
    if (proof.checkpointDigest !== expected.expectedCheckpointDigest)
        return deny("CHECKPOINT_BINDING_DENIED");
    if (proof.rollbackTargetTupleDigest !== expected.expectedRollbackTargetTupleDigest
        || proof.expectedRollbackTargetTupleDigest !== expected.expectedRollbackTargetTupleDigest
        || proof.observedRollbackTargetTupleDigest !== expected.expectedRollbackTargetTupleDigest)
        return deny("ROLLBACK_TARGET_MISMATCH_DENIED");
    if (proof.rollbackTargetRevoked !== false)
        return deny("ROLLBACK_TARGET_REVOKED_DENIED");
    if (proof.independentEvidenceDigest !== expected.expectedIndependentEvidenceDigest
        || proof.expectedIndependentEvidenceDigest !== expected.expectedIndependentEvidenceDigest)
        return deny("INDEPENDENT_EVIDENCE_DENIED");
    if (proof.observedOwnerStateDigest !== expected.expectedOwnerStateDigest
        || proof.expectedOwnerStateDigest !== expected.expectedOwnerStateDigest)
        return deny("OWNER_STATE_MISMATCH_DENIED");
    if (proof.residueCount !== UPDATE_CHECKPOINT_ROLLBACK_READBACK_ZERO_RESIDUE_V1)
        return deny("RESIDUE_PRESENT_DENIED");
    if (proof.retryOrdinal !== expected.expectedRetryOrdinal || proof.retryReceiptDigest !== expected.expectedRetryReceiptDigest)
        return deny("RETRY_RECEIPT_MISMATCH_DENIED");
    const retryDeterminismDigest = updateCheckpointRollbackRetryDeterminismDigestV1({
        operationDigest: proof.operationDigest,
        migrationEdgeDigest: proof.migrationEdgeDigest,
        rollbackTargetTupleDigest: proof.rollbackTargetTupleDigest,
        retryOrdinal: proof.retryOrdinal,
        retryReceiptDigest: proof.retryReceiptDigest,
    });
    if (proof.retryDeterminismDigest !== retryDeterminismDigest || proof.retryDeterminismDigest !== expected.expectedRetryDeterminismDigest)
        return deny("RETRY_NONDETERMINISTIC_DENIED");
    if (proof.authorityProfileDigest !== expected.expectedAuthorityProfileDigest)
        return deny("AUTHORITY_DRIFT_DENIED");
    if (proof.verifier.verifierId !== expected.expectedVerifier.verifierId || proof.verifier.verifierVersion !== expected.expectedVerifier.verifierVersion)
        return deny("VERIFIER_MISMATCH_DENIED");
    if (!isNeutralVerifier(proof.verifier.verifierId))
        return deny("AUTHORITY_CLAIM_DENIED");
    if (proof.observedAtMs !== expected.expectedObservedAtMs)
        return deny("INDEPENDENT_EVIDENCE_DENIED");
    return immutable({ outcome: "VERIFIED", reasonCodes: ["READBACK_VERIFIED"], exitCode: 0 });
}
export function parseUpdateCheckpointRollbackReadbackV1(json, context) {
    try {
        return verifyUpdateCheckpointRollbackReadbackV1(JSON.parse(json), context);
    }
    catch {
        return deny("INVALID_JSON_DENIED");
    }
}
/** Emits proof metadata only after independent-context verification succeeds. */
export function renderVerifiedUpdateCheckpointRollbackReadbackV1(value, context) {
    let snapshot;
    try {
        snapshot = immutable(value);
    }
    catch {
        throw new Error("UNSAFE_OR_INVALID_CHECKPOINT_ROLLBACK_READBACK");
    }
    if (verifyUpdateCheckpointRollbackReadbackV1(snapshot, context).outcome !== "VERIFIED")
        throw new Error("UNSAFE_OR_INVALID_CHECKPOINT_ROLLBACK_READBACK");
    return canonicalJson(snapshot);
}
