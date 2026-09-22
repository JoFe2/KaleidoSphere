import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
/**
 * UD-M1 successor micro-slice (issue #53).
 *
 * Pure, local verification and canonical projection for a synthetic isolated
 * A/B update staging envelope. The closed input binds an operation digest,
 * exact source and target tuple digests, the active and inactive slots,
 * candidate content, staged-verification, postcondition, owner-state and
 * authority-profile evidence, an independent stager identity/version
 * envelope, issuedAtMs, and a recomputed envelope digest. It emits only
 * STAGE_CHECKED metadata. It performs no copy, filesystem, pointer switch,
 * package, service, network, activation, rollback, cleanup, or execution
 * behavior, and it grants no switch or execution authority.
 */
export const UPDATE_STAGING_ENVELOPE_SCHEMA_V1 = "chimpmaera.update/staging-envelope/v1";
export const UPDATE_STAGING_CLAIM_BOUNDARY_V1 = "SYNTHETIC_ISOLATED_STAGE_CHECKED_METADATA_ONLY_NO_COPY_NO_FILESYSTEM_NO_POINTER_SWITCH_NO_PACKAGE_NO_SERVICE_NO_NETWORK_NO_ACTIVATION_NO_ROLLBACK_NO_CLEANUP_NO_EXECUTION_AUTHORITY";
export const UPDATE_STAGING_SLOTS_V1 = Object.freeze(["A", "B"]);
export const UPDATE_STAGING_EXIT_CODES_V1 = Object.freeze({
    STAGE_CHECKED: 0,
    INVALID_JSON_DENIED: 70,
    SCHEMA_DENIED: 71,
    UNSUPPORTED_CONTRACT_VERSION_DENIED: 72,
    SLOT_MISMATCH_DENIED: 73,
    TUPLE_MISMATCH_DENIED: 74,
    DIGEST_MISMATCH_DENIED: 75,
    INDEPENDENT_CONTEXT_DENIED: 76,
    STAGER_BINDING_DENIED: 77,
    MUTATION_CLAIM_DENIED: 78,
    REPLAY_DENIED: 79,
});
const STAGING_DENIAL_ORDER = Object.freeze([
    "SCHEMA_DENIED",
    "UNSUPPORTED_CONTRACT_VERSION_DENIED",
    "INDEPENDENT_CONTEXT_DENIED",
    "SLOT_MISMATCH_DENIED",
    "TUPLE_MISMATCH_DENIED",
    "DIGEST_MISMATCH_DENIED",
    "STAGER_BINDING_DENIED",
    "MUTATION_CLAIM_DENIED",
    "REPLAY_DENIED",
]);
const ENVELOPE_ID = /^staging:[a-z0-9][a-z0-9._-]{2,95}$/;
const STAGER_ID = /^stager:[a-z0-9][a-z0-9._-]{2,95}$/;
// Canonical SemVer 2.0.0 syntax: no leading zeros in numeric core parts or
// all-digit pre-release identifiers, and no empty, repeated, or trailing
// pre-release separators. Alphanumeric pre-release identifiers require at
// least one letter or hyphen; a hyphen alone is sufficient.
const SEMVER_NUMERIC = "(?:0|[1-9][0-9]*)";
const SEMVER_PRERELEASE_IDENTIFIER = "(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)";
const CANONICAL_STAGER_VERSION = new RegExp(`^${SEMVER_NUMERIC}(?:\\.${SEMVER_NUMERIC}){2}(?:-${SEMVER_PRERELEASE_IDENTIFIER}(?:\\.${SEMVER_PRERELEASE_IDENTIFIER})*)?$`);
const DIGEST = /^[a-f0-9]{64}$/;
const CLAIM_TOKENS = Object.freeze([
    "copy", "switch", "activate", "activation", "promote", "promotion",
    "execute", "execution", "rollback", "cleanup", "secret", "callback", "url", "path",
]);
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const INPUT_KEYS = [
    "schemaVersion", "envelopeId", "operationDigest", "sourceTupleDigest", "targetTupleDigest",
    "activeSlot", "inactiveSlot", "candidateContentDigest", "expectedStagedVerificationDigest",
    "expectedPostconditionDigest", "ownerStateDigest", "authorityProfileDigest", "stager",
    "issuedAtMs", "envelopeDigest",
];
const CONTEXT_KEYS = [
    "expectedOperationDigest", "expectedSourceTupleDigest", "expectedTargetTupleDigest",
    "expectedCandidateContentDigest", "expectedStagedVerificationDigest",
    "expectedPostconditionDigest", "expectedOwnerStateDigest", "expectedAuthorityProfileDigest",
    "trustedStager", "evaluationTimeMs", "maxEnvelopeAgeMs",
];
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
function actorAlias(identity) {
    const separator = identity.indexOf(":");
    return identity.slice(separator + 1).toLowerCase().replace(/[._-]+/g, "-");
}
function hasClaimToken(identity) {
    return CLAIM_TOKENS.some((token) => identity.includes(token));
}
export function oppositeSlotV1(slot) {
    return slot === "A" ? "B" : "A";
}
/**
 * Computes a canonical SHA-256 content digest after rejecting unsafe JSON
 * shapes. This digest is not a signature and provides no trust by itself.
 */
export function updateStagingEnvelopeDigestV1(value, digestKey = "envelopeDigest") {
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
function validStager(value) {
    return exactKeys(value, ["stagerId", "stagerVersion"])
        && typeof value.stagerId === "string" && STAGER_ID.test(value.stagerId)
        && typeof value.stagerVersion === "string" && CANONICAL_STAGER_VERSION.test(value.stagerVersion);
}
function validStagingInput(value) {
    return exactKeys(value, INPUT_KEYS)
        && value.schemaVersion === UPDATE_STAGING_ENVELOPE_SCHEMA_V1
        && typeof value.envelopeId === "string" && ENVELOPE_ID.test(value.envelopeId)
        && isDigest(value.operationDigest)
        && isDigest(value.sourceTupleDigest)
        && isDigest(value.targetTupleDigest)
        && typeof value.activeSlot === "string" && value.activeSlot.length > 0
        && typeof value.inactiveSlot === "string" && value.inactiveSlot.length > 0
        && isDigest(value.candidateContentDigest)
        && isDigest(value.expectedStagedVerificationDigest)
        && isDigest(value.expectedPostconditionDigest)
        && isDigest(value.ownerStateDigest)
        && isDigest(value.authorityProfileDigest)
        && validStager(value.stager)
        && isTimestamp(value.issuedAtMs)
        && isDigest(value.envelopeDigest);
}
function validStagingContext(value) {
    return exactKeys(value, CONTEXT_KEYS)
        && isDigest(value.expectedOperationDigest)
        && isDigest(value.expectedSourceTupleDigest)
        && isDigest(value.expectedTargetTupleDigest)
        && isDigest(value.expectedCandidateContentDigest)
        && isDigest(value.expectedStagedVerificationDigest)
        && isDigest(value.expectedPostconditionDigest)
        && isDigest(value.expectedOwnerStateDigest)
        && isDigest(value.expectedAuthorityProfileDigest)
        && validStager(value.trustedStager)
        && isTimestamp(value.evaluationTimeMs)
        && isTimestamp(value.maxEnvelopeAgeMs);
}
function hasUnsupportedVersion(value) {
    return value.schemaVersion !== undefined && value.schemaVersion !== UPDATE_STAGING_ENVELOPE_SCHEMA_V1;
}
function denyStaging(reason) {
    return immutable({ outcome: "DENIED", reasonCodes: [reason], exitCode: UPDATE_STAGING_EXIT_CODES_V1[reason] });
}
export function evaluateUpdateStagingEnvelopeV1(value, context) {
    let clonedValue;
    let clonedContext;
    try {
        clonedValue = safeJsonClone(value);
        clonedContext = context === undefined ? undefined : safeJsonClone(context);
    }
    catch {
        return denyStaging("SCHEMA_DENIED");
    }
    if (!exactKeys(clonedValue, INPUT_KEYS)) {
        if (isPlainDataRecord(clonedValue) && hasUnsupportedVersion(clonedValue)) {
            return denyStaging("UNSUPPORTED_CONTRACT_VERSION_DENIED");
        }
        return denyStaging("SCHEMA_DENIED");
    }
    if (hasUnsupportedVersion(clonedValue))
        return denyStaging("UNSUPPORTED_CONTRACT_VERSION_DENIED");
    if (!validStagingInput(clonedValue))
        return denyStaging("SCHEMA_DENIED");
    if (!validStagingContext(clonedContext))
        return denyStaging("INDEPENDENT_CONTEXT_DENIED");
    const input = clonedValue;
    const verification = clonedContext;
    const reasons = new Set();
    if (input.activeSlot === input.inactiveSlot
        || input.inactiveSlot !== oppositeSlotV1(input.activeSlot)) {
        reasons.add("SLOT_MISMATCH_DENIED");
    }
    if (input.sourceTupleDigest === input.targetTupleDigest
        || input.sourceTupleDigest !== verification.expectedSourceTupleDigest
        || input.targetTupleDigest !== verification.expectedTargetTupleDigest) {
        reasons.add("TUPLE_MISMATCH_DENIED");
    }
    if (updateStagingEnvelopeDigestV1(input) !== input.envelopeDigest
        || input.operationDigest !== verification.expectedOperationDigest
        || input.candidateContentDigest !== verification.expectedCandidateContentDigest
        || input.expectedStagedVerificationDigest !== verification.expectedStagedVerificationDigest
        || input.expectedPostconditionDigest !== verification.expectedPostconditionDigest
        || input.ownerStateDigest !== verification.expectedOwnerStateDigest
        || input.authorityProfileDigest !== verification.expectedAuthorityProfileDigest) {
        reasons.add("DIGEST_MISMATCH_DENIED");
    }
    if (input.stager.stagerId !== verification.trustedStager.stagerId
        || input.stager.stagerVersion !== verification.trustedStager.stagerVersion
        || actorAlias(input.envelopeId) === actorAlias(input.stager.stagerId)) {
        reasons.add("STAGER_BINDING_DENIED");
    }
    if (hasClaimToken(input.envelopeId) || hasClaimToken(input.stager.stagerId)) {
        reasons.add("MUTATION_CLAIM_DENIED");
    }
    if (input.issuedAtMs > verification.evaluationTimeMs
        || verification.evaluationTimeMs - input.issuedAtMs > verification.maxEnvelopeAgeMs) {
        reasons.add("REPLAY_DENIED");
    }
    if (reasons.size > 0) {
        const reasonCodes = STAGING_DENIAL_ORDER.filter((reason) => reasons.has(reason));
        return immutable({
            outcome: "DENIED",
            reasonCodes,
            exitCode: UPDATE_STAGING_EXIT_CODES_V1[reasonCodes[0]],
        });
    }
    return immutable({ outcome: "STAGE_CHECKED", reasonCodes: ["STAGE_CHECKED"], exitCode: 0 });
}
export function parseUpdateStagingEnvelopeV1(json, context) {
    try {
        return evaluateUpdateStagingEnvelopeV1(JSON.parse(json), context);
    }
    catch {
        return denyStaging("INVALID_JSON_DENIED");
    }
}
function projectStagingChecked(input) {
    return deepFreeze(safeObject([
        ["schemaVersion", UPDATE_STAGING_ENVELOPE_SCHEMA_V1],
        ["outcome", "STAGE_CHECKED"],
        ["reasonCode", "STAGE_CHECKED"],
        ["claimBoundary", UPDATE_STAGING_CLAIM_BOUNDARY_V1],
        ["envelopeId", input.envelopeId],
        ["operationDigest", input.operationDigest],
        ["sourceTupleDigest", input.sourceTupleDigest],
        ["targetTupleDigest", input.targetTupleDigest],
        ["activeSlot", input.activeSlot],
        ["inactiveSlot", input.inactiveSlot],
        ["candidateContentDigest", input.candidateContentDigest],
        ["expectedStagedVerificationDigest", input.expectedStagedVerificationDigest],
        ["expectedPostconditionDigest", input.expectedPostconditionDigest],
        ["ownerStateDigest", input.ownerStateDigest],
        ["authorityProfileDigest", input.authorityProfileDigest],
        ["stager", safeObject([
                ["stagerId", input.stager.stagerId],
                ["stagerVersion", input.stager.stagerVersion],
            ])],
        ["issuedAtMs", input.issuedAtMs],
        ["envelopeDigest", input.envelopeDigest],
        ["authorityGranted", false],
        ["executionAuthorized", false],
    ]));
}
function requireStagingChecked(value, context) {
    let snapshot;
    try {
        snapshot = safeJsonClone(value);
    }
    catch {
        throw new Error("UNSAFE_OR_INVALID_UPDATE_STAGING");
    }
    if (evaluateUpdateStagingEnvelopeV1(snapshot, context).outcome !== "STAGE_CHECKED") {
        throw new Error("UNSAFE_OR_INVALID_UPDATE_STAGING");
    }
    return snapshot;
}
/** Emits a deeply frozen STAGE_CHECKED projection only after fail-closed verification. */
export function updateStagingEnvelopeProjectionV1(value, context) {
    return projectStagingChecked(requireStagingChecked(value, context));
}
/** Emits canonical STAGE_CHECKED bytes only after fail-closed verification succeeds. */
export function renderUpdateStagingEnvelopeV1(value, context) {
    return canonicalJson(safeJsonClone(updateStagingEnvelopeProjectionV1(value, context)));
}
/** Deterministic SHA-256 digest of canonical STAGE_CHECKED projection bytes. */
export function updateStagingProjectionDigestV1(projection) {
    return createHash("sha256").update(canonicalJson(safeJsonClone(projection))).digest("hex");
}
