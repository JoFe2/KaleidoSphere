import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import { UPDATE_AXIS_NAMES_V1, updateTupleDigestV1, } from "./update-check-plan.js";
/**
 * PSAI #53 UD-APPLY-01 micro-slice 1 (issue #53).
 *
 * Pure, fail-closed exact source/target tuple-lock envelope built over the
 * existing UpdateTupleV1 and updateTupleDigestV1 contracts. It recomputes every
 * tuple and envelope digest, requires an unchanged authority profile and a
 * source tuple different from the target tuple, and emits a frozen CHECKED
 * lock carrying only source/target digests and the lock digest. It grants no
 * execution or promotion authority and performs no filesystem, apply,
 * pointer, package, service, network, or release behavior.
 */
export const UPDATE_APPLY_TUPLE_LOCK_SCHEMA_V1 = "chimpmaera.update/apply-tuple-lock/v1";
export const UPDATE_APPLY_TUPLE_LOCK_STATE_V1 = "CHECKED";
export const UPDATE_APPLY_TUPLE_LOCK_EXIT_CODES_V1 = Object.freeze({
    TUPLE_LOCK_CHECKED: 0,
    SCHEMA_DENIED: 66,
    DIGEST_MISMATCH_DENIED: 67,
    AUTHORITY_PROFILE_CHANGED_DENIED: 68,
    IDENTICAL_TUPLE_DENIED: 69,
});
const LOCK_DENIAL_ORDER = Object.freeze([
    "SCHEMA_DENIED",
    "DIGEST_MISMATCH_DENIED",
    "AUTHORITY_PROFILE_CHANGED_DENIED",
    "IDENTICAL_TUPLE_DENIED",
]);
const EXACT_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
const DIGEST = /^[a-f0-9]{64}$/;
const APPLY_OPERATION_ID = /^apply:[a-z0-9][a-z0-9._-]{2,95}$/;
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const COMPONENT_ID_PATTERNS = Object.freeze({
    core: /^core:[a-z0-9][a-z0-9._-]{2,95}$/,
    packs: /^pack:[a-z0-9][a-z0-9._-]{2,95}$/,
    adapters: /^adapter:[a-z0-9][a-z0-9._-]{2,95}$/,
    policies: /^policy:[a-z0-9][a-z0-9._-]{2,95}$/,
    schemas: /^schema:[a-z0-9][a-z0-9._-]{2,95}$/,
    generations: /^generation:[a-z0-9][a-z0-9._-]{2,95}$/,
});
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
function validComponent(value, axis) {
    return exactKeys(value, ["componentId", "version", "digest"])
        && typeof value.componentId === "string" && COMPONENT_ID_PATTERNS[axis].test(value.componentId)
        && typeof value.version === "string" && EXACT_VERSION.test(value.version)
        && isDigest(value.digest);
}
function validTuple(value) {
    if (!exactKeys(value, UPDATE_AXIS_NAMES_V1))
        return false;
    const tuple = value;
    return UPDATE_AXIS_NAMES_V1.every((axis) => {
        const components = tuple[axis];
        return isDenseStandardArray(components)
            && components.every((component) => validComponent(component, axis))
            && components.length === new Set(components.map((component) => component.componentId)).size;
    });
}
function validCompleteTuple(value) {
    return validTuple(value)
        && UPDATE_AXIS_NAMES_V1.every((axis) => value[axis].length > 0);
}
function validSide(value) {
    return exactKeys(value, ["tuple", "tupleDigest", "authorityProfileDigest"])
        && validCompleteTuple(value.tuple)
        && isDigest(value.tupleDigest)
        && isDigest(value.authorityProfileDigest);
}
/**
 * Computes the canonical SHA-256 content digest of a lock record after
 * excluding the named digest field. This digest is not a signature and
 * provides no trust by itself.
 */
export function updateApplyTupleLockDigestV1(value, digestKey) {
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
function denyLock(reasonCodes) {
    return immutable({
        outcome: "DENIED",
        reasonCodes: [...reasonCodes],
        exitCode: UPDATE_APPLY_TUPLE_LOCK_EXIT_CODES_V1[reasonCodes[0]],
    });
}
/**
 * Checks the closed tuple-lock input and emits a frozen CHECKED lock. Fails
 * closed on every schema, digest, authority, or identity mismatch. The lock
 * is a pure content envelope: it carries no tuple data and grants no
 * execution or promotion authority.
 */
export function checkUpdateApplyTupleLockV1(value) {
    let input;
    try {
        input = safeJsonClone(value);
    }
    catch {
        return denyLock(["SCHEMA_DENIED"]);
    }
    if (!exactKeys(input, ["source", "target", "operationId", "issuedAtMs"])) {
        return denyLock(["SCHEMA_DENIED"]);
    }
    if (typeof input.operationId !== "string" || !APPLY_OPERATION_ID.test(input.operationId)) {
        return denyLock(["SCHEMA_DENIED"]);
    }
    if (!isTimestamp(input.issuedAtMs)) {
        return denyLock(["SCHEMA_DENIED"]);
    }
    if (!validSide(input.source) || !validSide(input.target)) {
        return denyLock(["SCHEMA_DENIED"]);
    }
    const source = input.source;
    const target = input.target;
    let sourceTupleDigest;
    let targetTupleDigest;
    try {
        sourceTupleDigest = updateTupleDigestV1(source.tuple);
        targetTupleDigest = updateTupleDigestV1(target.tuple);
    }
    catch {
        return denyLock(["SCHEMA_DENIED"]);
    }
    const reasons = new Set();
    if (sourceTupleDigest !== source.tupleDigest || targetTupleDigest !== target.tupleDigest) {
        reasons.add("DIGEST_MISMATCH_DENIED");
    }
    if (source.authorityProfileDigest !== target.authorityProfileDigest) {
        reasons.add("AUTHORITY_PROFILE_CHANGED_DENIED");
    }
    if (sourceTupleDigest === targetTupleDigest) {
        reasons.add("IDENTICAL_TUPLE_DENIED");
    }
    if (reasons.size > 0) {
        const reasonCodes = LOCK_DENIAL_ORDER.filter((reason) => reasons.has(reason));
        return denyLock(reasonCodes);
    }
    const content = safeObject([
        ["schemaVersion", UPDATE_APPLY_TUPLE_LOCK_SCHEMA_V1],
        ["state", UPDATE_APPLY_TUPLE_LOCK_STATE_V1],
        ["operationId", input.operationId],
        ["issuedAtMs", input.issuedAtMs],
        ["sourceTupleDigest", sourceTupleDigest],
        ["targetTupleDigest", targetTupleDigest],
        ["authorityProfileDigest", source.authorityProfileDigest],
    ]);
    const lockDigest = updateApplyTupleLockDigestV1({ ...content, lockDigest: "" }, "lockDigest");
    const lock = immutable(safeObject([
        ...Object.entries(content),
        ["lockDigest", lockDigest],
    ]));
    return immutable({ outcome: "CHECKED", lock });
}
