import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
/**
 * PSAI #53 UD-M1 successor micro-slice (canonical migration edge).
 *
 * Pure, local contract verification and fixture helpers for canonical,
 * reversible source-to-target edges of a synthetic versioned DAG. This module
 * emits CHECKED metadata only: its bounded DAG composer also neither executes,
 * checkpoints, promotes, migrates, rolls back, nor otherwise mutates
 * packages, schemas, files, services, or networks, and it grants no
 * migration or promotion authority.
 */
export const UPDATE_MIGRATION_EDGE_SCHEMA_V1 = "chimpmaera.update/migration-edge/v1";
export const UPDATE_MIGRATION_EDGE_PLANNER_SCHEMA_V1 = "chimpmaera.update/migration-edge-planner/v1";
export const MIGRATION_EDGE_PRECONDITION_CODE_V1 = "SOURCE_TUPLE_VERIFIED";
export const MIGRATION_EDGE_POSTCONDITION_CODE_V1 = "TARGET_TUPLE_VERIFIED";
export const UPDATE_MIGRATION_EDGE_EXIT_CODES_V1 = Object.freeze({
    MIGRATION_EDGE_CHECKED: 0,
    INVALID_JSON_DENIED: 71,
    SCHEMA_DENIED: 72,
    UNSUPPORTED_CONTRACT_VERSION_DENIED: 73,
    DIGEST_MISMATCH_DENIED: 74,
    SELF_LOOP_DENIED: 75,
    ORDINAL_RANGE_DENIED: 76,
    ORDINAL_GAP_DENIED: 77,
    MUTABLE_VERSION_DENIED: 78,
    TUPLE_MISMATCH_DENIED: 79,
    ROLLBACK_MISMATCH_DENIED: 80,
    CONDITION_MISMATCH_DENIED: 81,
    AUTHORITY_DRIFT_DENIED: 82,
    PLANNER_MISMATCH_DENIED: 83,
    PLANNER_INDEPENDENCE_DENIED: 84,
    REVERSIBILITY_DENIED: 85,
    MUTATION_CLAIM_DENIED: 86,
    INDEPENDENT_CONTEXT_DENIED: 87,
});
const EDGE_DENIAL_ORDER = Object.freeze([
    "SCHEMA_DENIED",
    "UNSUPPORTED_CONTRACT_VERSION_DENIED",
    "INDEPENDENT_CONTEXT_DENIED",
    "DIGEST_MISMATCH_DENIED",
    "SELF_LOOP_DENIED",
    "ORDINAL_RANGE_DENIED",
    "ORDINAL_GAP_DENIED",
    "MUTABLE_VERSION_DENIED",
    "TUPLE_MISMATCH_DENIED",
    "ROLLBACK_MISMATCH_DENIED",
    "CONDITION_MISMATCH_DENIED",
    "AUTHORITY_DRIFT_DENIED",
    "PLANNER_MISMATCH_DENIED",
    "PLANNER_INDEPENDENCE_DENIED",
    "REVERSIBILITY_DENIED",
    "MUTATION_CLAIM_DENIED",
]);
export const UPDATE_MIGRATION_EDGE_KEYS_V1 = Object.freeze([
    "schemaVersion", "migrationId", "migrationVersion", "ordinal", "sourceTupleDigest",
    "targetTupleDigest", "rollbackTargetDigest", "preconditionCode", "postconditionCode",
    "reversible", "authorityProfileDigest", "planner", "issuedAtMs", "edgeDigest",
]);
const CONTEXT_KEYS = Object.freeze([
    "expectedMigrationId", "expectedMigrationVersion", "expectedSourceTupleDigest",
    "expectedTargetTupleDigest", "expectedRollbackTargetDigest", "expectedAuthorityProfileDigest",
    "expectedPreconditionCode", "expectedPostconditionCode", "expectedPlanner", "expectedOrdinal",
]);
// Canonical SemVer 2.0.0 grammar (semver.org): no leading zeros in the core or
// numeric prerelease identifiers and no empty or repeated prerelease
// identifiers.
const CANONICAL_SEMVER_VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const DIGEST = /^[a-f0-9]{64}$/;
const MIGRATION_ID = /^migration:[a-z0-9][a-z0-9._-]{2,95}$/;
const PLANNER_ID = /^planner:[a-z0-9][a-z0-9._-]{2,95}$/;
const MUTATION_CLAIM_TOKENS = Object.freeze([
    "exec", "apply", "promote", "checkpoint", "deploy", "commit", "activate",
]);
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
function hasMutableVersion(version) {
    const lowered = version.toLowerCase();
    return lowered.includes("latest") || lowered.includes("mutable");
}
function hasClaimToken(identity) {
    const lowered = identity.toLowerCase();
    return MUTATION_CLAIM_TOKENS.some((token) => lowered.includes(token));
}
function actorAlias(identity) {
    const separator = identity.indexOf(":");
    return identity.slice(separator + 1).toLowerCase().replace(/[._-]+/g, "-");
}
/**
 * Computes a canonical SHA-256 content digest of the edge after excluding the
 * `edgeDigest` field itself and rejecting unsafe JSON shapes. This digest is
 * not a signature and provides no trust by itself.
 */
export function updateMigrationEdgeDigestV1(value) {
    const cloned = safeJsonClone(value);
    if (!isPlainDataRecord(cloned))
        throw new TypeError("UNSAFE_DIGEST_INPUT");
    const content = safeObject(Object.keys(cloned)
        .filter((key) => key !== "edgeDigest")
        .map((key) => [key, cloned[key]]));
    return createHash("sha256").update(canonicalJson(content)).digest("hex");
}
// ---------------------------------------------------------------------------
// Shape validation
// ---------------------------------------------------------------------------
function validPlanner(value) {
    return exactKeys(value, ["schemaVersion", "plannerId", "plannerVersion"])
        && value.schemaVersion === UPDATE_MIGRATION_EDGE_PLANNER_SCHEMA_V1
        && typeof value.plannerId === "string" && PLANNER_ID.test(value.plannerId)
        && typeof value.plannerVersion === "string" && CANONICAL_SEMVER_VERSION.test(value.plannerVersion);
}
function validEdgeShape(value) {
    return exactKeys(value, UPDATE_MIGRATION_EDGE_KEYS_V1)
        && value.schemaVersion === UPDATE_MIGRATION_EDGE_SCHEMA_V1
        && typeof value.migrationId === "string" && MIGRATION_ID.test(value.migrationId)
        && typeof value.migrationVersion === "string" && CANONICAL_SEMVER_VERSION.test(value.migrationVersion)
        && Number.isSafeInteger(value.ordinal) && !Object.is(value.ordinal, -0) && value.ordinal >= 0
        && isDigest(value.sourceTupleDigest) && isDigest(value.targetTupleDigest)
        && isDigest(value.rollbackTargetDigest)
        && value.preconditionCode === MIGRATION_EDGE_PRECONDITION_CODE_V1
        && value.postconditionCode === MIGRATION_EDGE_POSTCONDITION_CODE_V1
        && typeof value.reversible === "boolean"
        && isDigest(value.authorityProfileDigest)
        && validPlanner(value.planner)
        && isTimestamp(value.issuedAtMs)
        && isDigest(value.edgeDigest);
}
function validPlannerContext(value) {
    return exactKeys(value, ["plannerId", "plannerVersion"])
        && typeof value.plannerId === "string" && PLANNER_ID.test(value.plannerId)
        && typeof value.plannerVersion === "string" && CANONICAL_SEMVER_VERSION.test(value.plannerVersion);
}
function validContext(value) {
    return exactKeys(value, CONTEXT_KEYS)
        && typeof value.expectedMigrationId === "string" && MIGRATION_ID.test(value.expectedMigrationId)
        && typeof value.expectedMigrationVersion === "string" && CANONICAL_SEMVER_VERSION.test(value.expectedMigrationVersion)
        && isDigest(value.expectedSourceTupleDigest) && isDigest(value.expectedTargetTupleDigest)
        && isDigest(value.expectedRollbackTargetDigest) && isDigest(value.expectedAuthorityProfileDigest)
        && typeof value.expectedPreconditionCode === "string" && value.expectedPreconditionCode.length > 0
        && typeof value.expectedPostconditionCode === "string" && value.expectedPostconditionCode.length > 0
        && validPlannerContext(value.expectedPlanner)
        && Number.isSafeInteger(value.expectedOrdinal) && value.expectedOrdinal >= 1;
}
function hasUnsupportedVersion(value) {
    const planner = isPlainDataRecord(value.planner) ? value.planner : null;
    return (value.schemaVersion !== undefined && value.schemaVersion !== UPDATE_MIGRATION_EDGE_SCHEMA_V1)
        || (planner?.schemaVersion !== undefined && planner.schemaVersion !== UPDATE_MIGRATION_EDGE_PLANNER_SCHEMA_V1);
}
// ---------------------------------------------------------------------------
// Fail-closed edge verification
// ---------------------------------------------------------------------------
function deny(reason) {
    return immutable({ outcome: "DENIED", reasonCodes: [reason], exitCode: UPDATE_MIGRATION_EDGE_EXIT_CODES_V1[reason] });
}
export function verifyUpdateMigrationEdgeV1(value, context) {
    let clonedValue;
    try {
        clonedValue = safeJsonClone(value);
    }
    catch {
        return deny("SCHEMA_DENIED");
    }
    if (context === undefined)
        return deny("INDEPENDENT_CONTEXT_DENIED");
    let clonedContext;
    try {
        clonedContext = safeJsonClone(context);
    }
    catch {
        return deny("INDEPENDENT_CONTEXT_DENIED");
    }
    if (!exactKeys(clonedValue, UPDATE_MIGRATION_EDGE_KEYS_V1)) {
        if (isPlainDataRecord(clonedValue) && hasUnsupportedVersion(clonedValue)) {
            return deny("UNSUPPORTED_CONTRACT_VERSION_DENIED");
        }
        return deny("SCHEMA_DENIED");
    }
    if (hasUnsupportedVersion(clonedValue))
        return deny("UNSUPPORTED_CONTRACT_VERSION_DENIED");
    if (!validEdgeShape(clonedValue))
        return deny("SCHEMA_DENIED");
    if (!validContext(clonedContext))
        return deny("INDEPENDENT_CONTEXT_DENIED");
    const edge = clonedValue;
    const verificationContext = clonedContext;
    const reasons = new Set();
    if (updateMigrationEdgeDigestV1(edge) !== edge.edgeDigest) {
        reasons.add("DIGEST_MISMATCH_DENIED");
    }
    if (edge.sourceTupleDigest === edge.targetTupleDigest) {
        reasons.add("SELF_LOOP_DENIED");
    }
    if (edge.ordinal < 1) {
        reasons.add("ORDINAL_RANGE_DENIED");
    }
    else if (edge.ordinal !== verificationContext.expectedOrdinal) {
        reasons.add("ORDINAL_GAP_DENIED");
    }
    if (hasMutableVersion(edge.migrationVersion) || hasMutableVersion(edge.planner.plannerVersion)) {
        reasons.add("MUTABLE_VERSION_DENIED");
    }
    if (edge.migrationId !== verificationContext.expectedMigrationId
        || edge.migrationVersion !== verificationContext.expectedMigrationVersion
        || edge.sourceTupleDigest !== verificationContext.expectedSourceTupleDigest
        || edge.targetTupleDigest !== verificationContext.expectedTargetTupleDigest) {
        reasons.add("TUPLE_MISMATCH_DENIED");
    }
    if (edge.rollbackTargetDigest !== edge.sourceTupleDigest
        || edge.rollbackTargetDigest !== verificationContext.expectedRollbackTargetDigest) {
        reasons.add("ROLLBACK_MISMATCH_DENIED");
    }
    if (edge.preconditionCode !== verificationContext.expectedPreconditionCode
        || edge.postconditionCode !== verificationContext.expectedPostconditionCode) {
        reasons.add("CONDITION_MISMATCH_DENIED");
    }
    if (edge.authorityProfileDigest !== verificationContext.expectedAuthorityProfileDigest) {
        reasons.add("AUTHORITY_DRIFT_DENIED");
    }
    if (edge.planner.plannerId !== verificationContext.expectedPlanner.plannerId
        || edge.planner.plannerVersion !== verificationContext.expectedPlanner.plannerVersion) {
        reasons.add("PLANNER_MISMATCH_DENIED");
    }
    if (actorAlias(edge.planner.plannerId) === actorAlias(edge.migrationId)) {
        reasons.add("PLANNER_INDEPENDENCE_DENIED");
    }
    if (edge.reversible !== true) {
        reasons.add("REVERSIBILITY_DENIED");
    }
    if (hasClaimToken(edge.migrationId) || hasClaimToken(edge.planner.plannerId)) {
        reasons.add("MUTATION_CLAIM_DENIED");
    }
    if (reasons.size > 0) {
        const reasonCodes = EDGE_DENIAL_ORDER.filter((reason) => reasons.has(reason));
        return immutable({
            outcome: "DENIED",
            reasonCodes,
            exitCode: UPDATE_MIGRATION_EDGE_EXIT_CODES_V1[reasonCodes[0]],
        });
    }
    return immutable({ outcome: "CHECKED", reasonCodes: ["MIGRATION_EDGE_CHECKED"], exitCode: 0 });
}
export function parseUpdateMigrationEdgeV1(json, context) {
    try {
        return verifyUpdateMigrationEdgeV1(JSON.parse(json), context);
    }
    catch {
        return deny("INVALID_JSON_DENIED");
    }
}
// ---------------------------------------------------------------------------
// Deterministic fixture-only edge construction
// ---------------------------------------------------------------------------
export function buildUpdateMigrationEdgeV1(options) {
    let cloned;
    try {
        cloned = safeJsonClone(options);
    }
    catch {
        throw new Error("INVALID_MIGRATION_EDGE_FIXTURE");
    }
    if (!exactKeys(cloned, ["migrationId", "migrationVersion", "ordinal", "sourceTupleDigest", "targetTupleDigest",
        "authorityProfileDigest", "planner", "issuedAtMs"])
        || typeof cloned.migrationId !== "string" || cloned.migrationId.length === 0
        || typeof cloned.migrationVersion !== "string" || !CANONICAL_SEMVER_VERSION.test(cloned.migrationVersion)
        || hasMutableVersion(cloned.migrationVersion)
        || !Number.isSafeInteger(cloned.ordinal) || cloned.ordinal < 1
        || !isDigest(cloned.sourceTupleDigest) || !isDigest(cloned.targetTupleDigest)
        || cloned.sourceTupleDigest === cloned.targetTupleDigest
        || !isDigest(cloned.authorityProfileDigest)
        || !exactKeys(cloned.planner, ["plannerId", "plannerVersion"])
        || typeof cloned.planner.plannerId !== "string" || cloned.planner.plannerId.length === 0
        || typeof cloned.planner.plannerVersion !== "string" || !CANONICAL_SEMVER_VERSION.test(cloned.planner.plannerVersion)
        || hasMutableVersion(cloned.planner.plannerVersion)
        || !isTimestamp(cloned.issuedAtMs)) {
        throw new Error("INVALID_MIGRATION_EDGE_FIXTURE");
    }
    const edge = safeObject([
        ["schemaVersion", UPDATE_MIGRATION_EDGE_SCHEMA_V1],
        ["migrationId", cloned.migrationId],
        ["migrationVersion", cloned.migrationVersion],
        ["ordinal", cloned.ordinal],
        ["sourceTupleDigest", cloned.sourceTupleDigest],
        ["targetTupleDigest", cloned.targetTupleDigest],
        ["rollbackTargetDigest", cloned.sourceTupleDigest],
        ["preconditionCode", MIGRATION_EDGE_PRECONDITION_CODE_V1],
        ["postconditionCode", MIGRATION_EDGE_POSTCONDITION_CODE_V1],
        ["reversible", true],
        ["authorityProfileDigest", cloned.authorityProfileDigest],
        ["planner", safeObject([
                ["schemaVersion", UPDATE_MIGRATION_EDGE_PLANNER_SCHEMA_V1],
                ["plannerId", cloned.planner.plannerId],
                ["plannerVersion", cloned.planner.plannerVersion],
            ])],
        ["issuedAtMs", cloned.issuedAtMs],
    ]);
    const complete = safeObject([
        ...Object.entries(edge),
        ["edgeDigest", updateMigrationEdgeDigestV1(edge)],
    ]);
    return deepFreeze(complete);
}
// ---------------------------------------------------------------------------
// Verified CHECKED metadata emission
// ---------------------------------------------------------------------------
/** Emits canonical CHECKED metadata bytes only after verification succeeds. */
export function renderVerifiedUpdateMigrationEdgeV1(value, context) {
    let snapshot;
    try {
        snapshot = immutable(value);
    }
    catch {
        throw new Error("UNSAFE_OR_INVALID_MIGRATION_EDGE");
    }
    if (verifyUpdateMigrationEdgeV1(snapshot, context).outcome === "DENIED") {
        throw new Error("UNSAFE_OR_INVALID_MIGRATION_EDGE");
    }
    return canonicalJson(snapshot);
}
// ---------------------------------------------------------------------------
// Bounded versioned migration DAG
// ---------------------------------------------------------------------------
/** A DAG is deliberately bounded to a short, deterministic migration path. */
export const UPDATE_MIGRATION_DAG_SCHEMA_V1 = "chimpmaera.update/migration-dag/v1";
export const UPDATE_MIGRATION_DAG_MAX_EDGES_V1 = 8;
export const UPDATE_MIGRATION_DAG_KEYS_V1 = Object.freeze([
    "schemaVersion", "migrationId", "migrationVersion", "sourceTupleDigest", "targetTupleDigest",
    "rollbackTargetDigest", "authorityProfileDigest", "planner", "maxEdges", "edges", "dagDigest",
]);
export const UPDATE_MIGRATION_DAG_EXIT_CODES_V1 = Object.freeze({
    MIGRATION_DAG_CHECKED: 0,
    INVALID_JSON_DENIED: 71,
    SCHEMA_DENIED: 72,
    UNSUPPORTED_CONTRACT_VERSION_DENIED: 73,
    INDEPENDENT_CONTEXT_DENIED: 74,
    DAG_DIGEST_MISMATCH_DENIED: 75,
    DAG_BOUND_DENIED: 76,
    DAG_EDGE_BINDING_DENIED: 77,
    DAG_CHAIN_DENIED: 78,
    DAG_TARGET_MISMATCH_DENIED: 79,
});
const DAG_CONTEXT_KEYS = Object.freeze([
    "expectedMigrationId", "expectedMigrationVersion", "expectedSourceTupleDigest",
    "expectedTargetTupleDigest", "expectedRollbackTargetDigest", "expectedAuthorityProfileDigest",
    "expectedPlanner", "expectedEdgeDigests",
]);
function validDag(value) {
    return exactKeys(value, UPDATE_MIGRATION_DAG_KEYS_V1)
        && value.schemaVersion === UPDATE_MIGRATION_DAG_SCHEMA_V1
        && typeof value.migrationId === "string" && MIGRATION_ID.test(value.migrationId)
        && typeof value.migrationVersion === "string" && CANONICAL_SEMVER_VERSION.test(value.migrationVersion)
        && isDigest(value.sourceTupleDigest) && isDigest(value.targetTupleDigest)
        && isDigest(value.rollbackTargetDigest) && isDigest(value.authorityProfileDigest)
        && validPlanner(value.planner)
        && value.maxEdges === UPDATE_MIGRATION_DAG_MAX_EDGES_V1
        && isDenseStandardArray(value.edges) && value.edges.length > 0 && value.edges.length <= UPDATE_MIGRATION_DAG_MAX_EDGES_V1
        && value.edges.every(validEdgeShape)
        && isDigest(value.dagDigest);
}
function validDagContext(value) {
    return exactKeys(value, DAG_CONTEXT_KEYS)
        && typeof value.expectedMigrationId === "string" && MIGRATION_ID.test(value.expectedMigrationId)
        && typeof value.expectedMigrationVersion === "string" && CANONICAL_SEMVER_VERSION.test(value.expectedMigrationVersion)
        && isDigest(value.expectedSourceTupleDigest) && isDigest(value.expectedTargetTupleDigest)
        && isDigest(value.expectedRollbackTargetDigest) && isDigest(value.expectedAuthorityProfileDigest)
        && validPlannerContext(value.expectedPlanner)
        && isDenseStandardArray(value.expectedEdgeDigests)
        && value.expectedEdgeDigests.length > 0
        && value.expectedEdgeDigests.length <= UPDATE_MIGRATION_DAG_MAX_EDGES_V1
        && value.expectedEdgeDigests.every(isDigest);
}
/** Canonical SHA-256 over the closed DAG envelope excluding dagDigest. */
export function updateMigrationDagDigestV1(value) {
    const cloned = safeJsonClone(value);
    if (!isPlainDataRecord(cloned))
        throw new TypeError("UNSAFE_DAG_DIGEST_INPUT");
    const unsigned = safeObject(Object.keys(cloned)
        .filter((key) => key !== "dagDigest")
        .map((key) => [key, cloned[key]]));
    return createHash("sha256").update(canonicalJson(unsigned)).digest("hex");
}
function denyDag(reason) {
    return immutable({ outcome: "DENIED", reasonCodes: [reason], exitCode: UPDATE_MIGRATION_DAG_EXIT_CODES_V1[reason] });
}
/**
 * Verifies a bounded DAG against an independent edge-digest list. The result
 * is metadata only; it grants neither migration nor rollback authority.
 */
export function verifyUpdateMigrationDagV1(value, context) {
    let clonedValue;
    try {
        clonedValue = safeJsonClone(value);
    }
    catch {
        return denyDag("SCHEMA_DENIED");
    }
    if (context === undefined)
        return denyDag("INDEPENDENT_CONTEXT_DENIED");
    let clonedContext;
    try {
        clonedContext = safeJsonClone(context);
    }
    catch {
        return denyDag("INDEPENDENT_CONTEXT_DENIED");
    }
    if (!exactKeys(clonedValue, UPDATE_MIGRATION_DAG_KEYS_V1)) {
        if (isPlainDataRecord(clonedValue) && clonedValue.schemaVersion !== undefined
            && clonedValue.schemaVersion !== UPDATE_MIGRATION_DAG_SCHEMA_V1)
            return denyDag("UNSUPPORTED_CONTRACT_VERSION_DENIED");
        return denyDag("SCHEMA_DENIED");
    }
    if (isPlainDataRecord(clonedValue) && clonedValue.schemaVersion !== UPDATE_MIGRATION_DAG_SCHEMA_V1) {
        return denyDag("UNSUPPORTED_CONTRACT_VERSION_DENIED");
    }
    if (!validDag(clonedValue))
        return denyDag("SCHEMA_DENIED");
    if (!validDagContext(clonedContext))
        return denyDag("INDEPENDENT_CONTEXT_DENIED");
    const dag = clonedValue;
    const expected = clonedContext;
    if (updateMigrationDagDigestV1(dag) !== dag.dagDigest)
        return denyDag("DAG_DIGEST_MISMATCH_DENIED");
    if (dag.edges.length !== expected.expectedEdgeDigests.length || dag.edges.length > UPDATE_MIGRATION_DAG_MAX_EDGES_V1) {
        return denyDag("DAG_BOUND_DENIED");
    }
    if (dag.migrationId !== expected.expectedMigrationId || dag.migrationVersion !== expected.expectedMigrationVersion
        || dag.sourceTupleDigest !== expected.expectedSourceTupleDigest
        || dag.targetTupleDigest !== expected.expectedTargetTupleDigest
        || dag.rollbackTargetDigest !== expected.expectedRollbackTargetDigest
        || dag.authorityProfileDigest !== expected.expectedAuthorityProfileDigest
        || dag.planner.plannerId !== expected.expectedPlanner.plannerId
        || dag.planner.plannerVersion !== expected.expectedPlanner.plannerVersion) {
        return denyDag("DAG_TARGET_MISMATCH_DENIED");
    }
    let prior = dag.sourceTupleDigest;
    for (const [index, edge] of dag.edges.entries()) {
        const edgeContext = {
            expectedMigrationId: expected.expectedMigrationId,
            expectedMigrationVersion: expected.expectedMigrationVersion,
            expectedSourceTupleDigest: prior,
            expectedTargetTupleDigest: index === dag.edges.length - 1 ? expected.expectedTargetTupleDigest : edge.targetTupleDigest,
            expectedRollbackTargetDigest: prior,
            expectedAuthorityProfileDigest: expected.expectedAuthorityProfileDigest,
            expectedPreconditionCode: MIGRATION_EDGE_PRECONDITION_CODE_V1,
            expectedPostconditionCode: MIGRATION_EDGE_POSTCONDITION_CODE_V1,
            expectedPlanner: expected.expectedPlanner,
            expectedOrdinal: index + 1,
        };
        if (edge.edgeDigest !== expected.expectedEdgeDigests[index]
            || verifyUpdateMigrationEdgeV1(edge, edgeContext).outcome !== "CHECKED")
            return denyDag("DAG_EDGE_BINDING_DENIED");
        prior = edge.targetTupleDigest;
    }
    if (prior !== expected.expectedTargetTupleDigest)
        return denyDag("DAG_CHAIN_DENIED");
    return immutable({ outcome: "CHECKED", reasonCodes: ["MIGRATION_DAG_CHECKED"], exitCode: 0 });
}
export function parseUpdateMigrationDagV1(json, context) {
    try {
        return verifyUpdateMigrationDagV1(JSON.parse(json), context);
    }
    catch {
        return denyDag("INVALID_JSON_DENIED");
    }
}
/** Deterministically composes one bounded path from source through intermediates to target. */
export function buildUpdateMigrationDagV1(options) {
    let cloned;
    try {
        cloned = safeJsonClone(options);
    }
    catch {
        throw new Error("INVALID_MIGRATION_DAG_FIXTURE");
    }
    if (!exactKeys(cloned, ["migrationId", "migrationVersion", "sourceTupleDigest", "targetTupleDigest",
        "intermediateTupleDigests", "authorityProfileDigest", "planner", "issuedAtMs"])
        || typeof cloned.migrationId !== "string" || !MIGRATION_ID.test(cloned.migrationId)
        || typeof cloned.migrationVersion !== "string" || !CANONICAL_SEMVER_VERSION.test(cloned.migrationVersion)
        || hasMutableVersion(cloned.migrationVersion) || !isDigest(cloned.sourceTupleDigest)
        || !isDigest(cloned.targetTupleDigest) || cloned.sourceTupleDigest === cloned.targetTupleDigest
        || !isDenseStandardArray(cloned.intermediateTupleDigests)
        || cloned.intermediateTupleDigests.length + 1 > UPDATE_MIGRATION_DAG_MAX_EDGES_V1
        || !cloned.intermediateTupleDigests.every(isDigest)
        || !isDigest(cloned.authorityProfileDigest) || !validPlannerContext(cloned.planner)
        || hasMutableVersion(cloned.planner.plannerVersion) || !isTimestamp(cloned.issuedAtMs)) {
        throw new Error("INVALID_MIGRATION_DAG_FIXTURE");
    }
    const tuples = [cloned.sourceTupleDigest, ...cloned.intermediateTupleDigests, cloned.targetTupleDigest];
    if (tuples.some((tuple, index) => index > 0 && tuple === tuples[index - 1]))
        throw new Error("INVALID_MIGRATION_DAG_FIXTURE");
    const edges = tuples.slice(0, -1).map((source, index) => buildUpdateMigrationEdgeV1({
        migrationId: cloned.migrationId,
        migrationVersion: cloned.migrationVersion,
        ordinal: index + 1,
        sourceTupleDigest: source,
        targetTupleDigest: tuples[index + 1],
        authorityProfileDigest: cloned.authorityProfileDigest,
        planner: cloned.planner,
        issuedAtMs: cloned.issuedAtMs,
    }));
    const unsigned = {
        schemaVersion: UPDATE_MIGRATION_DAG_SCHEMA_V1,
        migrationId: cloned.migrationId,
        migrationVersion: cloned.migrationVersion,
        sourceTupleDigest: cloned.sourceTupleDigest,
        targetTupleDigest: cloned.targetTupleDigest,
        rollbackTargetDigest: cloned.sourceTupleDigest,
        authorityProfileDigest: cloned.authorityProfileDigest,
        planner: {
            schemaVersion: UPDATE_MIGRATION_EDGE_PLANNER_SCHEMA_V1,
            plannerId: cloned.planner.plannerId,
            plannerVersion: cloned.planner.plannerVersion,
        },
        maxEdges: UPDATE_MIGRATION_DAG_MAX_EDGES_V1,
        edges,
    };
    return immutable({ ...unsigned, dagDigest: updateMigrationDagDigestV1(unsigned) });
}
export const updateMigrationDAGDigestV1 = updateMigrationDagDigestV1;
export const buildUpdateMigrationDAGV1 = buildUpdateMigrationDagV1;
export const verifyUpdateMigrationDAGV1 = verifyUpdateMigrationDagV1;
