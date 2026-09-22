import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
/**
 * UD-APPLY-01 micro-slice 3 (issue #53).
 *
 * Pure, independent postcondition decision contract for a synthetic update
 * apply. A closed input (the verifier envelope) canonically binds the
 * operation/target/LKG digests, the expected versus independently observed
 * target tuple digest, the expected versus observed synthetic owner-state
 * digest, the residue count, the verifier identity/version and the
 * observation time under one canonical envelope digest. It is verified
 * against an independent trusted context and emits ACCEPT_SWITCH only for an
 * exact target and owner match with zero residue; otherwise it emits
 * ROLLBACK_REQUIRED with fixed ordered reasons bound to the exact trusted LKG
 * digest. It never mutates, rolls back, installs, promotes, executes
 * packages, or performs filesystem, process, service, or network effects.
 */
export const UPDATE_APPLY_POSTCONDITION_SCHEMA_V1 = "chimpmaera.update/apply-postcondition/v1";
export const UPDATE_APPLY_POSTCONDITION_REASON_ORDER_V1 = Object.freeze([
    "SCHEMA_DENIED",
    "UNSUPPORTED_CONTRACT_VERSION_DENIED",
    "INDEPENDENT_CONTEXT_DENIED",
    "DIGEST_MISMATCH_DENIED",
    "TUPLE_MISMATCH_DENIED",
    "OWNER_STATE_MISMATCH_DENIED",
    "RESIDUE_PRESENT_DENIED",
    "VERIFIER_BINDING_DENIED",
    "SELF_VERIFIER_DENIED",
    "OBSERVATION_TIME_DENIED",
]);
export const UPDATE_APPLY_POSTCONDITION_EXIT_CODES_V1 = Object.freeze({
    POSTCONDITION_ACCEPTED: 0,
    SCHEMA_DENIED: 70,
    UNSUPPORTED_CONTRACT_VERSION_DENIED: 71,
    INDEPENDENT_CONTEXT_DENIED: 72,
    DIGEST_MISMATCH_DENIED: 73,
    TUPLE_MISMATCH_DENIED: 74,
    OWNER_STATE_MISMATCH_DENIED: 75,
    RESIDUE_PRESENT_DENIED: 76,
    VERIFIER_BINDING_DENIED: 77,
    SELF_VERIFIER_DENIED: 78,
    OBSERVATION_TIME_DENIED: 79,
});
const ENVELOPE_KEYS = [
    "schemaVersion",
    "observationId",
    "operationDigest",
    "targetDigest",
    "lkgDigest",
    "expectedTargetTupleDigest",
    "observedTargetTupleDigest",
    "expectedOwnerStateDigest",
    "observedOwnerStateDigest",
    "residueCount",
    "verifierId",
    "verifierVersion",
    "observedAtMs",
    "envelopeDigest",
];
const CONTEXT_KEYS = [
    "operationDigest",
    "targetDigest",
    "lkgDigest",
    "expectedTargetTupleDigest",
    "expectedOwnerStateDigest",
    "operationSubjectId",
    "trustedVerifierId",
    "trustedVerifierVersion",
    "trustedEnvelopeDigest",
    "evaluationTimeMs",
    "maxObservationAgeMs",
];
const DIGEST = /^[a-f0-9]{64}$/;
const EXACT_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
const OBSERVATION_ID = /^postcondition:[a-z0-9][a-z0-9._-]{2,95}$/;
const VERIFIER_ID = /^verifier:[a-z0-9][a-z0-9._-]{2,95}$/;
const SUBJECT_ID = /^candidate:[a-z0-9][a-z0-9._-]{2,95}$/;
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
function isPlainDataRecord(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
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
function isDenseStandardArray(value) {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
        return false;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string"))
        return false;
    const expected = [...Array.from({ length: value.length }, (_, index) => String(index)), "length"];
    if (keys.length !== expected.length || expected.some((key) => !keys.includes(key)))
        return false;
    return Array.from({ length: value.length }, (_, index) => String(index)).every((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return descriptor !== undefined && "value" in descriptor && descriptor.enumerable === true;
    });
}
function exactKeys(value, keys) {
    if (!isPlainDataRecord(value))
        return false;
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function safeObject(entries, nullPrototype = false) {
    const output = Object.create(nullPrototype ? null : Object.prototype);
    for (const [key, value] of entries) {
        if (DANGEROUS_KEYS.has(key) || Object.prototype.hasOwnProperty.call(output, key)) {
            throw new TypeError("UNSAFE_JSON_OBJECT_KEY");
        }
        Object.defineProperty(output, key, { value, enumerable: true, writable: true, configurable: true });
    }
    return output;
}
function safeJsonClone(value, nullPrototypeObjects = false, ancestors = new Set()) {
    if (value === null || typeof value === "string" || typeof value === "boolean")
        return value;
    if (typeof value === "number") {
        if (Object.is(value, -0) || !Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
            throw new TypeError("UNSAFE_JSON_NUMBER");
        }
        return value;
    }
    if (Array.isArray(value)) {
        if (!isDenseStandardArray(value) || ancestors.has(value))
            throw new TypeError("UNSAFE_JSON_ARRAY");
        const next = new Set(ancestors).add(value);
        return value.map((item) => safeJsonClone(item, nullPrototypeObjects, next));
    }
    if (!isPlainDataRecord(value) || ancestors.has(value))
        throw new TypeError("UNSAFE_JSON_OBJECT");
    const next = new Set(ancestors).add(value);
    return safeObject(Object.keys(value).map((key) => [
        key,
        safeJsonClone(value[key], nullPrototypeObjects, next),
    ]), nullPrototypeObjects);
}
function deepFreeze(value) {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
        for (const key of Reflect.ownKeys(value)) {
            if (key !== "length")
                deepFreeze(value[key]);
        }
        Object.freeze(value);
    }
    return value;
}
function immutable(value) {
    return deepFreeze(safeJsonClone(value));
}
function isDigest(value) {
    return typeof value === "string" && DIGEST.test(value);
}
function isTimestamp(value) {
    return Number.isSafeInteger(value) && !Object.is(value, -0) && value >= 0;
}
/**
 * Computes the canonical SHA-256 content digest of the verifier envelope
 * after rejecting unsafe JSON shapes. This digest is a canonical binding,
 * not a signature, and provides no trust by itself.
 */
export function updateApplyPostconditionDigestV1(value, digestKey) {
    if (DANGEROUS_KEYS.has(digestKey))
        throw new TypeError("UNSAFE_DIGEST_KEY");
    const cloned = safeJsonClone(value);
    if (!isPlainDataRecord(cloned))
        throw new TypeError("UNSAFE_DIGEST_INPUT");
    const content = safeObject(Object.keys(cloned)
        .filter((key) => key !== digestKey)
        .map((key) => [key, cloned[key]]));
    return createHash("sha256").update(canonicalJson(content)).digest("hex");
}
function validEnvelope(value) {
    return exactKeys(value, ENVELOPE_KEYS)
        && value.schemaVersion === UPDATE_APPLY_POSTCONDITION_SCHEMA_V1
        && typeof value.observationId === "string" && OBSERVATION_ID.test(value.observationId)
        && isDigest(value.operationDigest) && isDigest(value.targetDigest) && isDigest(value.lkgDigest)
        && isDigest(value.expectedTargetTupleDigest) && isDigest(value.observedTargetTupleDigest)
        && isDigest(value.expectedOwnerStateDigest) && isDigest(value.observedOwnerStateDigest)
        && Number.isSafeInteger(value.residueCount) && value.residueCount >= 0
        && !Object.is(value.residueCount, -0)
        && typeof value.verifierId === "string" && VERIFIER_ID.test(value.verifierId)
        && typeof value.verifierVersion === "string" && EXACT_VERSION.test(value.verifierVersion)
        && isTimestamp(value.observedAtMs)
        && isDigest(value.envelopeDigest);
}
function validContext(value) {
    return exactKeys(value, CONTEXT_KEYS)
        && isDigest(value.operationDigest) && isDigest(value.targetDigest) && isDigest(value.lkgDigest)
        && isDigest(value.expectedTargetTupleDigest) && isDigest(value.expectedOwnerStateDigest)
        && typeof value.operationSubjectId === "string" && SUBJECT_ID.test(value.operationSubjectId)
        && typeof value.trustedVerifierId === "string" && VERIFIER_ID.test(value.trustedVerifierId)
        && typeof value.trustedVerifierVersion === "string" && EXACT_VERSION.test(value.trustedVerifierVersion)
        && isDigest(value.trustedEnvelopeDigest)
        && isTimestamp(value.evaluationTimeMs)
        && Number.isSafeInteger(value.maxObservationAgeMs) && value.maxObservationAgeMs >= 0;
}
function actorAlias(identity) {
    const separator = identity.indexOf(":");
    return identity.slice(separator + 1).toLowerCase().replace(/[._-]+/g, "-");
}
function rollbackDecision(reasonCodes, rollbackTargetDigest) {
    return immutable({
        outcome: "ROLLBACK_REQUIRED",
        reasonCodes: [...reasonCodes],
        exitCode: UPDATE_APPLY_POSTCONDITION_EXIT_CODES_V1[reasonCodes[0]],
        rollbackTargetDigest,
        rollbackExecuted: false,
    });
}
export function verifyUpdateApplyPostconditionV1(value, context) {
    let clonedContext;
    try {
        clonedContext = context === undefined ? undefined : safeJsonClone(context);
    }
    catch {
        clonedContext = undefined;
    }
    const contextValid = clonedContext !== undefined && validContext(clonedContext);
    const trustedLkgDigest = contextValid
        ? clonedContext.lkgDigest
        : null;
    let cloned;
    try {
        cloned = safeJsonClone(value);
    }
    catch {
        return rollbackDecision(["SCHEMA_DENIED"], trustedLkgDigest);
    }
    if (!exactKeys(cloned, ENVELOPE_KEYS)) {
        if (isPlainDataRecord(cloned) && typeof cloned.schemaVersion === "string"
            && cloned.schemaVersion !== UPDATE_APPLY_POSTCONDITION_SCHEMA_V1) {
            return rollbackDecision(["UNSUPPORTED_CONTRACT_VERSION_DENIED"], trustedLkgDigest);
        }
        return rollbackDecision(["SCHEMA_DENIED"], trustedLkgDigest);
    }
    if (cloned.schemaVersion !== UPDATE_APPLY_POSTCONDITION_SCHEMA_V1) {
        return rollbackDecision(["UNSUPPORTED_CONTRACT_VERSION_DENIED"], trustedLkgDigest);
    }
    if (!validEnvelope(cloned))
        return rollbackDecision(["SCHEMA_DENIED"], trustedLkgDigest);
    if (!contextValid)
        return rollbackDecision(["INDEPENDENT_CONTEXT_DENIED"], null);
    const envelope = cloned;
    const verificationContext = clonedContext;
    const reasons = new Set();
    if (envelope.operationDigest !== verificationContext.operationDigest
        || envelope.targetDigest !== verificationContext.targetDigest
        || envelope.lkgDigest !== verificationContext.lkgDigest
        || envelope.expectedTargetTupleDigest !== verificationContext.expectedTargetTupleDigest
        || envelope.expectedOwnerStateDigest !== verificationContext.expectedOwnerStateDigest) {
        reasons.add("INDEPENDENT_CONTEXT_DENIED");
    }
    if (updateApplyPostconditionDigestV1(envelope, "envelopeDigest") !== envelope.envelopeDigest
        || envelope.envelopeDigest !== verificationContext.trustedEnvelopeDigest) {
        reasons.add("DIGEST_MISMATCH_DENIED");
    }
    if (envelope.observedTargetTupleDigest !== verificationContext.expectedTargetTupleDigest) {
        reasons.add("TUPLE_MISMATCH_DENIED");
    }
    if (envelope.observedOwnerStateDigest !== verificationContext.expectedOwnerStateDigest) {
        reasons.add("OWNER_STATE_MISMATCH_DENIED");
    }
    if (envelope.residueCount > 0)
        reasons.add("RESIDUE_PRESENT_DENIED");
    if (envelope.verifierId !== verificationContext.trustedVerifierId
        || envelope.verifierVersion !== verificationContext.trustedVerifierVersion) {
        reasons.add("VERIFIER_BINDING_DENIED");
    }
    if (actorAlias(envelope.verifierId) === actorAlias(verificationContext.operationSubjectId)) {
        reasons.add("SELF_VERIFIER_DENIED");
    }
    if (envelope.observedAtMs > verificationContext.evaluationTimeMs
        || verificationContext.evaluationTimeMs - envelope.observedAtMs > verificationContext.maxObservationAgeMs) {
        reasons.add("OBSERVATION_TIME_DENIED");
    }
    if (reasons.size === 0) {
        return immutable({
            outcome: "ACCEPT_SWITCH",
            reasonCodes: ["POSTCONDITION_ACCEPTED"],
            exitCode: 0,
            rollbackTargetDigest: null,
            rollbackExecuted: false,
        });
    }
    const reasonCodes = UPDATE_APPLY_POSTCONDITION_REASON_ORDER_V1.filter((reason) => reasons.has(reason));
    return rollbackDecision(reasonCodes, trustedLkgDigest);
}
function projectPublicDecision(envelope, decision) {
    return {
        schemaVersion: UPDATE_APPLY_POSTCONDITION_SCHEMA_V1,
        outcome: decision.outcome,
        reasonCodes: [...decision.reasonCodes],
        exitCode: decision.exitCode,
        rollbackTargetDigest: decision.rollbackTargetDigest,
        rollbackExecuted: false,
        observationId: envelope.observationId,
        operationDigest: envelope.operationDigest,
        targetDigest: envelope.targetDigest,
        lkgDigest: envelope.lkgDigest,
        expectedTargetTupleDigest: envelope.expectedTargetTupleDigest,
        observedTargetTupleDigest: envelope.observedTargetTupleDigest,
        expectedOwnerStateDigest: envelope.expectedOwnerStateDigest,
        observedOwnerStateDigest: envelope.observedOwnerStateDigest,
        residueCount: envelope.residueCount,
        verifierId: envelope.verifierId,
        verifierVersion: envelope.verifierVersion,
        observedAtMs: envelope.observedAtMs,
        envelopeDigest: envelope.envelopeDigest,
    };
}
/**
 * Emits the canonical public projection only after the envelope is
 * structurally valid. The projection is a fixed field set: free text,
 * secrets, paths, URLs and execution or promotion claims can never appear
 * in it.
 */
export function renderUpdateApplyPostconditionDecisionV1(value, context) {
    let snapshot;
    try {
        snapshot = safeJsonClone(value);
    }
    catch {
        throw new Error("UNSAFE_OR_INVALID_UPDATE_POSTCONDITION");
    }
    const decision = verifyUpdateApplyPostconditionV1(snapshot, context);
    if (decision.outcome === "ROLLBACK_REQUIRED"
        && (decision.reasonCodes.includes("SCHEMA_DENIED")
            || decision.reasonCodes.includes("UNSUPPORTED_CONTRACT_VERSION_DENIED"))) {
        throw new Error("UNSAFE_OR_INVALID_UPDATE_POSTCONDITION");
    }
    if (!validEnvelope(snapshot))
        throw new Error("UNSAFE_OR_INVALID_UPDATE_POSTCONDITION");
    return canonicalJson(safeJsonClone(projectPublicDecision(snapshot, decision)));
}
