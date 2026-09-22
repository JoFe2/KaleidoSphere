import { createHash } from "node:crypto";
import { types as nodeUtilTypes } from "node:util";
import { canonicalJson } from "./canonical-json.js";
import { UPDATE_AXIS_NAMES_V1, updateTupleDigestV1, } from "./update-check-plan.js";
/**
 * PSAI #53 update promotion gate proof.
 *
 * This is a closed, pure metadata contract. It binds a candidate's exact
 * Core/Pack/Adapter/Policy/Schema/Generation tuple and candidate artifact
 * evidence to an independently named verifier and a separate promoter
 * decision. A candidate or its updater cannot occupy a verification or
 * promotion role: self-attestation, self-promotion, and every role collision
 * fail closed. This operation does not attest, does not promote, issues no
 * promotion capability, and performs no filesystem, process, worker, network,
 * or clock effects.
 */
export const UPDATE_PROMOTION_GATE_SCHEMA_V1 = "chimpmaera.update/promotion-gate/v1";
export const UPDATE_PROMOTION_GATE_VERIFIER_SCHEMA_V1 = "chimpmaera.update/promotion-gate-verifier/v1";
export const UPDATE_PROMOTION_GATE_DECISION_SCHEMA_V1 = "chimpmaera.update/promotion-decision/v1";
export const UPDATE_PROMOTION_GATE_PHASE_V1 = "PROMOTION_GATE";
export const UPDATE_PROMOTION_GATE_TRANSITION_V1 = "PROMOTION_GATE_VERIFIED";
export const UPDATE_PROMOTION_GATE_NO_CAPABILITY_V1 = false;
export const UPDATE_PROMOTION_GATE_KEYS_V1 = Object.freeze([
    "schemaVersion",
    "transition",
    "phase",
    "candidateId",
    "updaterId",
    "sourceTupleDigest",
    "candidateTuple",
    "candidateTupleDigest",
    "candidateArtifactDigest",
    "identityBoundaryDigest",
    "verifier",
    "promoterDecision",
    "capabilityIssued",
    "observedAtMs",
    "promotionGateDigest",
]);
const VERIFIER_KEYS = Object.freeze(["schemaVersion", "verifierId", "verifierVersion"]);
const DECISION_KEYS = Object.freeze(["schemaVersion", "decisionId", "promoterId", "decisionDigest"]);
const BUILD_KEYS = Object.freeze([
    "candidateId",
    "updaterId",
    "sourceTupleDigest",
    "candidateTuple",
    "candidateArtifactDigest",
    "identityBoundaryDigest",
    "verifier",
    "promoterDecision",
    "observedAtMs",
]);
const CONTEXT_KEYS = Object.freeze([
    "expectedCandidateId",
    "expectedUpdaterId",
    "expectedSourceTupleDigest",
    "expectedCandidateTuple",
    "expectedCandidateTupleDigest",
    "expectedCandidateArtifactDigest",
    "expectedIdentityBoundaryDigest",
    "expectedVerifier",
    "expectedPromoterDecision",
    "expectedObservedAtMs",
]);
const EXPECTED_VERIFIER_KEYS = Object.freeze(["verifierId", "verifierVersion"]);
const EXPECTED_DECISION_KEYS = Object.freeze(["decisionId", "promoterId", "decisionDigest"]);
const COMPONENT_KEYS = Object.freeze(["componentId", "version", "digest"]);
const IDENTITY_BOUNDARY_KEYS = Object.freeze(["candidateSubjectId", "updaterId", "attestorId", "verifierId", "promoterId"]);
export const UPDATE_PROMOTION_GATE_EXIT_CODES_V1 = Object.freeze({
    TUPLE_MISMATCH_DENIED: 100,
    SOURCE_TUPLE_MISMATCH_DENIED: 116,
    ARTIFACT_EVIDENCE_DENIED: 101,
    CANDIDATE_BINDING_DENIED: 102,
    IDENTITY_BOUNDARY_DENIED: 103,
    VERIFIER_MISMATCH_DENIED: 104,
    PROMOTER_DECISION_MISMATCH_DENIED: 105,
    SELF_ATTESTATION_DENIED: 106,
    SELF_PROMOTION_DENIED: 107,
    ROLE_COLLISION_DENIED: 108,
    CAPABILITY_CLAIM_DENIED: 109,
    OBSERVED_TIME_MISMATCH_DENIED: 110,
    SCHEMA_DENIED: 111,
    UNSUPPORTED_CONTRACT_VERSION_DENIED: 112,
    INVALID_JSON_DENIED: 113,
    INDEPENDENT_CONTEXT_DENIED: 114,
    DIGEST_MISMATCH_DENIED: 115,
});
const DIGEST = /^[a-f0-9]{64}$/;
const CANDIDATE_ID = /^candidate:[a-z0-9][a-z0-9._-]{2,95}$/;
const UPDATER_ID = /^updater:[a-z0-9][a-z0-9._-]{2,95}$/;
const ATTESTOR_ID = /^attestor:[a-z0-9][a-z0-9._-]{2,95}$/;
// The verifier must be named independently of the candidate and updater at the
// shape level; the verification path additionally fails closed on any actor
// alias collision with the candidate or updater.
const VERIFIER_ID = /^verifier:independent-[a-z0-9][a-z0-9._-]{2,95}$/;
const PROMOTER_ID = /^promoter:[a-z0-9][a-z0-9._-]{2,95}$/;
const DECISION_ID = /^decision:[a-z0-9][a-z0-9._-]{2,95}$/;
const CANONICAL_SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const COMPONENT_ID_PATTERNS = Object.freeze({
    core: /^core:[a-z0-9][a-z0-9._-]{2,95}$/,
    packs: /^pack:[a-z0-9][a-z0-9._-]{2,95}$/,
    adapters: /^adapter:[a-z0-9][a-z0-9._-]{2,95}$/,
    policies: /^policy:[a-z0-9][a-z0-9._-]{2,95}$/,
    schemas: /^schema:[a-z0-9][a-z0-9._-]{2,95}$/,
    generations: /^generation:[a-z0-9][a-z0-9._-]{2,95}$/,
});
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
        && keys.length === expected.length
        && expected.every((key) => keys.includes(key))
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
    for (const key of Object.keys(value)) {
        output[key] = safeClone(value[key], new Set(ancestors).add(value));
    }
    return output;
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
    return deepFreeze(safeClone(value));
}
function isDigest(value) {
    return typeof value === "string" && DIGEST.test(value);
}
function isTime(value) {
    return Number.isSafeInteger(value) && !Object.is(value, -0) && value >= 0;
}
function isComponent(value, axis) {
    return exactKeys(value, COMPONENT_KEYS)
        && typeof value.componentId === "string" && COMPONENT_ID_PATTERNS[axis].test(value.componentId)
        && typeof value.version === "string" && CANONICAL_SEMVER.test(value.version)
        && isDigest(value.digest);
}
function validTuple(value) {
    if (!exactKeys(value, UPDATE_AXIS_NAMES_V1))
        return false;
    const tuple = value;
    return UPDATE_AXIS_NAMES_V1.every((axis) => {
        const components = tuple[axis];
        return isDenseArray(components)
            && components.every((component) => isComponent(component, axis))
            && components.length === new Set(components.map((component) => component.componentId)).size;
    });
}
function validCompleteTuple(value) {
    if (!validTuple(value))
        return false;
    const tuple = value;
    return UPDATE_AXIS_NAMES_V1.every((axis) => tuple[axis].length > 0);
}
function isVerifier(value) {
    return exactKeys(value, VERIFIER_KEYS)
        && value.schemaVersion === UPDATE_PROMOTION_GATE_VERIFIER_SCHEMA_V1
        && typeof value.verifierId === "string" && VERIFIER_ID.test(value.verifierId)
        && typeof value.verifierVersion === "string" && CANONICAL_SEMVER.test(value.verifierVersion);
}
function isPromoterDecision(value) {
    return exactKeys(value, DECISION_KEYS)
        && value.schemaVersion === UPDATE_PROMOTION_GATE_DECISION_SCHEMA_V1
        && typeof value.decisionId === "string" && DECISION_ID.test(value.decisionId)
        && typeof value.promoterId === "string" && PROMOTER_ID.test(value.promoterId)
        && isDigest(value.decisionDigest);
}
function isProof(value) {
    return exactKeys(value, UPDATE_PROMOTION_GATE_KEYS_V1)
        && typeof value.schemaVersion === "string"
        && value.transition === UPDATE_PROMOTION_GATE_TRANSITION_V1
        && value.phase === UPDATE_PROMOTION_GATE_PHASE_V1
        && typeof value.candidateId === "string" && CANDIDATE_ID.test(value.candidateId)
        && typeof value.updaterId === "string" && UPDATER_ID.test(value.updaterId)
        && validCompleteTuple(value.candidateTuple)
        && isDigest(value.sourceTupleDigest)
        && isDigest(value.candidateTupleDigest)
        && isDigest(value.candidateArtifactDigest)
        && isDigest(value.identityBoundaryDigest)
        && isVerifier(value.verifier)
        && isPromoterDecision(value.promoterDecision)
        && typeof value.capabilityIssued === "boolean"
        && isTime(value.observedAtMs)
        && isDigest(value.promotionGateDigest);
}
function isExpectedVerifier(value) {
    return exactKeys(value, EXPECTED_VERIFIER_KEYS)
        && typeof value.verifierId === "string" && VERIFIER_ID.test(value.verifierId)
        && typeof value.verifierVersion === "string" && CANONICAL_SEMVER.test(value.verifierVersion);
}
function isExpectedDecision(value) {
    return exactKeys(value, EXPECTED_DECISION_KEYS)
        && typeof value.decisionId === "string" && DECISION_ID.test(value.decisionId)
        && typeof value.promoterId === "string" && PROMOTER_ID.test(value.promoterId)
        && isDigest(value.decisionDigest);
}
function isContext(value) {
    return exactKeys(value, CONTEXT_KEYS)
        && typeof value.expectedCandidateId === "string" && CANDIDATE_ID.test(value.expectedCandidateId)
        && typeof value.expectedUpdaterId === "string" && UPDATER_ID.test(value.expectedUpdaterId)
        && validCompleteTuple(value.expectedCandidateTuple)
        && isDigest(value.expectedSourceTupleDigest)
        && isDigest(value.expectedCandidateTupleDigest)
        && isDigest(value.expectedCandidateArtifactDigest)
        && isDigest(value.expectedIdentityBoundaryDigest)
        && isExpectedVerifier(value.expectedVerifier)
        && isExpectedDecision(value.expectedPromoterDecision)
        && isTime(value.expectedObservedAtMs);
}
export function updatePromotionGateDigestV1(value) {
    const cloned = safeClone(value);
    if (!isPlainRecord(cloned))
        throw new TypeError("UNSAFE_PROMOTION_GATE_DIGEST_INPUT");
    const unsigned = {};
    for (const key of Object.keys(cloned)) {
        if (key !== "promotionGateDigest")
            unsigned[key] = cloned[key];
    }
    return createHash("sha256").update(canonicalJson(unsigned)).digest("hex");
}
export function updatePromotionGateIdentityBoundaryDigestV1(boundary) {
    const cloned = safeClone(boundary);
    if (!exactKeys(cloned, IDENTITY_BOUNDARY_KEYS))
        throw new TypeError("INVALID_IDENTITY_BOUNDARY");
    if (!CANDIDATE_ID.test(cloned.candidateSubjectId)
        || !UPDATER_ID.test(cloned.updaterId)
        || !ATTESTOR_ID.test(cloned.attestorId)
        || !VERIFIER_ID.test(cloned.verifierId)
        || !PROMOTER_ID.test(cloned.promoterId))
        throw new TypeError("INVALID_IDENTITY_BOUNDARY");
    return createHash("sha256").update(canonicalJson(cloned)).digest("hex");
}
function deny(reason) {
    return immutable({
        outcome: "DENIED",
        reasonCodes: [reason],
        exitCode: UPDATE_PROMOTION_GATE_EXIT_CODES_V1[reason],
    });
}
function actorAlias(identity) {
    const separator = identity.indexOf(":");
    return identity.slice(separator + 1).toLowerCase().replace(/[._-]+/g, "-");
}
export function buildUpdatePromotionGateV1(options) {
    let cloned;
    try {
        cloned = safeClone(options);
    }
    catch {
        throw new Error("INVALID_PROMOTION_GATE_FIXTURE");
    }
    if (!exactKeys(cloned, BUILD_KEYS)
        || typeof cloned.candidateId !== "string" || !CANDIDATE_ID.test(cloned.candidateId)
        || typeof cloned.updaterId !== "string" || !UPDATER_ID.test(cloned.updaterId)
        || !isDigest(cloned.sourceTupleDigest)
        || !validCompleteTuple(cloned.candidateTuple)
        || !isDigest(cloned.candidateArtifactDigest)
        || !isDigest(cloned.identityBoundaryDigest)
        || !isVerifier(cloned.verifier)
        || !isPromoterDecision(cloned.promoterDecision)
        || !isTime(cloned.observedAtMs)) {
        throw new Error("INVALID_PROMOTION_GATE_FIXTURE");
    }
    const candidateTupleDigest = updateTupleDigestV1(cloned.candidateTuple);
    const unsigned = {
        schemaVersion: UPDATE_PROMOTION_GATE_SCHEMA_V1,
        transition: UPDATE_PROMOTION_GATE_TRANSITION_V1,
        phase: UPDATE_PROMOTION_GATE_PHASE_V1,
        candidateId: cloned.candidateId,
        updaterId: cloned.updaterId,
        sourceTupleDigest: cloned.sourceTupleDigest,
        candidateTuple: cloned.candidateTuple,
        candidateTupleDigest,
        candidateArtifactDigest: cloned.candidateArtifactDigest,
        identityBoundaryDigest: cloned.identityBoundaryDigest,
        verifier: cloned.verifier,
        promoterDecision: cloned.promoterDecision,
        capabilityIssued: UPDATE_PROMOTION_GATE_NO_CAPABILITY_V1,
        observedAtMs: cloned.observedAtMs,
    };
    return immutable({ ...unsigned, promotionGateDigest: updatePromotionGateDigestV1(unsigned) });
}
export function verifyUpdatePromotionGateV1(value, context) {
    let proof;
    try {
        proof = safeClone(value);
    }
    catch {
        return deny("SCHEMA_DENIED");
    }
    if (!isProof(proof))
        return deny("SCHEMA_DENIED");
    if (proof.schemaVersion !== UPDATE_PROMOTION_GATE_SCHEMA_V1)
        return deny("UNSUPPORTED_CONTRACT_VERSION_DENIED");
    if (context === undefined)
        return deny("INDEPENDENT_CONTEXT_DENIED");
    let expected;
    try {
        expected = safeClone(context);
    }
    catch {
        return deny("INDEPENDENT_CONTEXT_DENIED");
    }
    if (!isContext(expected))
        return deny("INDEPENDENT_CONTEXT_DENIED");
    if (updatePromotionGateDigestV1(proof) !== proof.promotionGateDigest)
        return deny("DIGEST_MISMATCH_DENIED");
    let tupleDigest;
    try {
        tupleDigest = updateTupleDigestV1(proof.candidateTuple);
    }
    catch {
        return deny("TUPLE_MISMATCH_DENIED");
    }
    if (tupleDigest !== proof.candidateTupleDigest
        || tupleDigest !== expected.expectedCandidateTupleDigest
        || canonicalJson(safeClone(proof.candidateTuple)) !== canonicalJson(safeClone(expected.expectedCandidateTuple))) {
        return deny("TUPLE_MISMATCH_DENIED");
    }
    if (proof.sourceTupleDigest !== expected.expectedSourceTupleDigest)
        return deny("SOURCE_TUPLE_MISMATCH_DENIED");
    if (proof.candidateArtifactDigest !== expected.expectedCandidateArtifactDigest)
        return deny("ARTIFACT_EVIDENCE_DENIED");
    if (proof.candidateId !== expected.expectedCandidateId || proof.updaterId !== expected.expectedUpdaterId)
        return deny("CANDIDATE_BINDING_DENIED");
    if (proof.identityBoundaryDigest !== expected.expectedIdentityBoundaryDigest)
        return deny("IDENTITY_BOUNDARY_DENIED");
    if (proof.verifier.verifierId !== expected.expectedVerifier.verifierId
        || proof.verifier.verifierVersion !== expected.expectedVerifier.verifierVersion)
        return deny("VERIFIER_MISMATCH_DENIED");
    if (proof.promoterDecision.decisionId !== expected.expectedPromoterDecision.decisionId
        || proof.promoterDecision.promoterId !== expected.expectedPromoterDecision.promoterId
        || proof.promoterDecision.decisionDigest !== expected.expectedPromoterDecision.decisionDigest) {
        return deny("PROMOTER_DECISION_MISMATCH_DENIED");
    }
    const candidateAlias = actorAlias(proof.candidateId);
    const updaterAlias = actorAlias(proof.updaterId);
    const verifierAlias = actorAlias(proof.verifier.verifierId);
    const promoterAlias = actorAlias(proof.promoterDecision.promoterId);
    if (verifierAlias === candidateAlias || verifierAlias === updaterAlias)
        return deny("SELF_ATTESTATION_DENIED");
    if (promoterAlias === candidateAlias || promoterAlias === updaterAlias)
        return deny("SELF_PROMOTION_DENIED");
    if (candidateAlias === updaterAlias || verifierAlias === promoterAlias)
        return deny("ROLE_COLLISION_DENIED");
    if (proof.capabilityIssued !== UPDATE_PROMOTION_GATE_NO_CAPABILITY_V1)
        return deny("CAPABILITY_CLAIM_DENIED");
    if (proof.observedAtMs !== expected.expectedObservedAtMs)
        return deny("OBSERVED_TIME_MISMATCH_DENIED");
    return immutable({
        outcome: "VERIFIED",
        reasonCodes: ["PROMOTION_GATE_VERIFIED"],
        exitCode: 0,
    });
}
export function parseUpdatePromotionGateV1(json, context) {
    try {
        return verifyUpdatePromotionGateV1(JSON.parse(json), context);
    }
    catch {
        return deny("INVALID_JSON_DENIED");
    }
}
export function renderVerifiedUpdatePromotionGateV1(value, context) {
    let snapshot;
    try {
        snapshot = immutable(value);
    }
    catch {
        throw new Error("UNSAFE_OR_INVALID_PROMOTION_GATE");
    }
    if (verifyUpdatePromotionGateV1(snapshot, context).outcome !== "VERIFIED")
        throw new Error("UNSAFE_OR_INVALID_PROMOTION_GATE");
    return canonicalJson(snapshot);
}
