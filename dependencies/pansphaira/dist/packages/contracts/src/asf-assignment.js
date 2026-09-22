/**
 * Deterministic ASF assignment decision contract (v1).
 *
 * An assignment decision binds one exact immutable generation to its bundle
 * lock and LKG rollback identity, then evaluates finite, explicit
 * generation-to-profile/adapter/pack/route assignments against the
 * digest-bound compatibility matrix. The decision is pure, local, and
 * fail-closed: an ENABLED assignment whose tuple is declared INCOMPATIBLE by
 * the matrix is disabled for that scope only, while unrelated accepted
 * generations remain byte-for-byte unchanged. The contract carries no
 * authority, installs nothing, and activates nothing.
 */
import { createHash } from "node:crypto";
import { verifyAsfBundleLockV1, } from "./asf-bundle-lock.js";
import { verifyAsfCompatibilityMatrixV1, } from "./asf-compatibility-fence.js";
import { canonicalJson } from "./canonical-json.js";
export const ASF_ASSIGNMENT_SCHEMA_V1 = "chimpmaera.asf/assignment/v1";
export const ASF_ASSIGNMENT_RECEIPT_SCHEMA_V1 = "chimpmaera.asf/assignment-receipt/v1";
export const ASF_ASSIGNMENT_STATES_V1 = ["DISABLED", "ENABLED"];
export const ASF_ASSIGNMENT_LKG_MODE_V1 = "RESTORE_EXACT_LOCK_OR_DENY";
export const ASF_ASSIGNMENT_AUTHORITY_V1 = Object.freeze({
    activation: "NO_AUTHORITY",
    installation: "NO_AUTHORITY",
});
export const ASF_ASSIGNMENT_REASON_ORDER_V1 = [
    "BROAD_CAPABILITY_DENIED",
    "DIGEST_MISMATCH_DENIED",
    "DUPLICATE_ASSIGNMENT_DENIED",
    "DUPLICATE_KEY_DENIED",
    "INCOMPATIBLE_TUPLE_DENIED",
    "INVALID_JSON_DENIED",
    "LKG_MISSING_DENIED",
    "MATRIX_BINDING_DENIED",
    "MUTABLE_ALIAS_OR_RANGE_DENIED",
    "NONCANONICAL_ENCODING_DENIED",
    "SCHEMA_DENIED",
    "STALE_CATALOGUE_DENIED",
    "UNKNOWN_TARGET_DENIED",
    "UNSUPPORTED_VERSION_DENIED",
];
export const ASF_ASSIGNMENT_EXIT_CODES_V1 = Object.freeze({
    ASF_ASSIGNMENT_ACCEPTED: 0,
    BROAD_CAPABILITY_DENIED: 100,
    DIGEST_MISMATCH_DENIED: 101,
    DUPLICATE_ASSIGNMENT_DENIED: 102,
    DUPLICATE_KEY_DENIED: 103,
    INCOMPATIBLE_TUPLE_DENIED: 104,
    INVALID_JSON_DENIED: 105,
    LKG_MISSING_DENIED: 106,
    MATRIX_BINDING_DENIED: 107,
    MUTABLE_ALIAS_OR_RANGE_DENIED: 108,
    NONCANONICAL_ENCODING_DENIED: 109,
    SCHEMA_DENIED: 110,
    STALE_CATALOGUE_DENIED: 111,
    UNKNOWN_TARGET_DENIED: 112,
    UNSUPPORTED_VERSION_DENIED: 113,
});
const EXACT_VERSION = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/;
const DIGEST = /^[a-f0-9]{64}$/;
const MATRIX_ID = /^asffence:[a-z0-9][a-z0-9._-]{2,63}$/;
const SKILL_ID = /^skill:[a-z0-9][a-z0-9._-]{2,63}$/;
const PROFILE_ID = /^profile:[a-z0-9][a-z0-9._-]{2,63}$/;
const ADAPTER_ID = /^adapter:[a-z0-9][a-z0-9._-]{2,63}$/;
const PACK_ID = /^pack:[a-z0-9][a-z0-9._-]{2,63}$/;
const ROUTE_ID = /^route:[a-z0-9][a-z0-9._-]{2,63}$/;
const CAPABILITY_ID = /^capability:[a-z0-9][a-z0-9._-]{2,63}$/;
const UNRESOLVED = /(?:\$\{|{{|}}|<[^>]*>|latest|HEAD)/i;
const WILDCARD = /\*/;
const ASSIGNMENT_RECORD_LIMIT = 64;
const CAPABILITY_LIMIT = 16;
const TOP_LEVEL_KEYS = [
    "assignments",
    "generation",
    "lkg",
    "lock",
    "matrix",
    "schemaVersion",
];
const TUPLE_KEYS = [
    "adapterId",
    "adapterVersion",
    "catalogDigest",
    "generationDigest",
    "lockDigest",
    "packDigest",
    "packId",
    "profileId",
    "profileVersion",
    "routeId",
    "routeVersion",
    "skillId",
    "version",
];
const RECORD_KEYS = [
    ...TUPLE_KEYS,
    "capabilityScope",
    "capabilities",
    "state",
];
const GENERATION_KEYS = [
    "capabilityIds",
    "generationDigest",
    "lockDigest",
    "skillId",
    "version",
];
const LKG_KEYS = ["lkgLockIdentity", "mode"];
const CAPABILITY_ENTRY_KEYS = ["capabilityId", "digest", "version"];
const RECEIPT_KEYS = [
    "authority",
    "disabledTransitions",
    "enabledAssignments",
    "lkgLockIdentity",
    "lockIdentity",
    "matrixDigest",
    "matrixId",
    "receiptDigest",
    "schemaVersion",
];
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, keys) {
    return isRecord(value) && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}
function isDigest(value) {
    return typeof value === "string" && DIGEST.test(value);
}
function isExactVersion(value) {
    return typeof value === "string" && EXACT_VERSION.test(value);
}
function isValidId(value, pattern) {
    if (typeof value !== "string")
        return false;
    if (value.normalize("NFC") !== value)
        return false;
    if (UNRESOLVED.test(value))
        return false;
    return pattern.test(value);
}
function isSafeCount(value) {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
}
function isWildcard(value) {
    return typeof value === "string" && WILDCARD.test(value);
}
function isUnresolved(value) {
    return typeof value === "string" && UNRESOLVED.test(value);
}
function asfAssignmentDigest(value) {
    return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
function unescapeJsonString(text) {
    let out = "";
    for (let index = 0; index < text.length; index += 1) {
        const char = text.charAt(index);
        if (char !== "\\") {
            out += char;
            continue;
        }
        const next = text.charAt(index + 1);
        if (next === "u") {
            const code = Number.parseInt(text.slice(index + 2, index + 6), 16);
            out += Number.isFinite(code) ? String.fromCodePoint(code) : "u";
            index += 5;
            continue;
        }
        const simple = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
        out += next === '"' || next === "\\" || next === "/" ? next : simple[next] ?? next;
        index += 1;
    }
    return out;
}
/** Deterministic raw-text scan that reports a duplicated object key. */
function hasDuplicateKey(raw) {
    const stack = [];
    let index = 0;
    while (index < raw.length) {
        const char = raw.charAt(index);
        if (char !== '"') {
            if (char === "{")
                stack.push(new Set());
            else if (char === "[")
                stack.push(null);
            else if (char === "}" || char === "]")
                stack.pop();
            index += 1;
            continue;
        }
        let cursor = index + 1;
        let text = "";
        while (cursor < raw.length) {
            const current = raw.charAt(cursor);
            if (current === "\\") {
                text += current + raw.charAt(cursor + 1);
                cursor += 2;
                continue;
            }
            if (current === '"')
                break;
            text += current;
            cursor += 1;
        }
        if (cursor >= raw.length)
            return false;
        index = cursor + 1;
        let lookahead = index;
        while (lookahead < raw.length && " \t\n\r".includes(raw.charAt(lookahead)))
            lookahead += 1;
        if (lookahead < raw.length && raw.charAt(lookahead) === ":") {
            const top = stack[stack.length - 1];
            if (top) {
                const key = unescapeJsonString(text);
                if (top.has(key))
                    return true;
                top.add(key);
            }
        }
    }
    return false;
}
function compareCanonical(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
function tupleCore(value) {
    if (!isRecord(value))
        return null;
    const core = {};
    for (const key of TUPLE_KEYS) {
        const entry = value[key];
        if (typeof entry !== "string")
            return null;
        core[key] = entry;
    }
    return core;
}
function tupleKey(value) {
    const core = tupleCore(value);
    return core === null ? null : canonicalJson(core);
}
function sameStringSet(left, right) {
    if (left.length !== right.length)
        return false;
    const leftSorted = [...left].sort(compareCanonical);
    const rightSorted = [...right].sort(compareCanonical);
    return leftSorted.every((entry, index) => entry === rightSorted[index]);
}
/**
 * Semantic fail-closed preflight over an accepted-shape assignment input.
 * Order encodes precedence: broad capability claims before unknown targets,
 * before mutable aliases, before stale catalogues, before duplicate
 * assignments.
 */
function preflightDenial(value) {
    const assignments = Array.isArray(value.assignments) ? value.assignments : [];
    for (const record of assignments) {
        if (!isRecord(record))
            continue;
        if (record.capabilityScope !== "EXPLICIT") {
            return "BROAD_CAPABILITY_DENIED";
        }
        const capabilities = Array.isArray(record.capabilities) ? record.capabilities : [];
        for (const capability of capabilities) {
            if (isRecord(capability) && isWildcard(capability.capabilityId)) {
                return "BROAD_CAPABILITY_DENIED";
            }
        }
    }
    for (const record of assignments) {
        if (!isRecord(record))
            continue;
        if ([record.skillId, record.profileId, record.adapterId, record.packId, record.routeId].some(isWildcard)) {
            return "UNKNOWN_TARGET_DENIED";
        }
    }
    for (const record of assignments) {
        if (!isRecord(record))
            continue;
        const idClaims = [
            record.skillId,
            record.profileId,
            record.adapterId,
            record.packId,
            record.routeId,
        ];
        const versionClaims = [
            record.version,
            record.profileVersion,
            record.adapterVersion,
            record.routeVersion,
        ];
        const capabilities = Array.isArray(record.capabilities) ? record.capabilities : [];
        for (const capability of capabilities) {
            if (!isRecord(capability))
                continue;
            idClaims.push(capability.capabilityId);
            versionClaims.push(capability.version);
        }
        if (idClaims.some(isUnresolved) || versionClaims.some((claim) => !isExactVersion(claim))) {
            return "MUTABLE_ALIAS_OR_RANGE_DENIED";
        }
    }
    const matrix = isRecord(value.matrix) ? value.matrix : null;
    const catalogue = matrix !== null && isRecord(matrix.catalogue) ? matrix.catalogue : null;
    if (catalogue !== null && isDigest(catalogue.catalogDigest)) {
        for (const record of assignments) {
            if (isRecord(record) && record.catalogDigest !== catalogue.catalogDigest) {
                return "STALE_CATALOGUE_DENIED";
            }
        }
    }
    const tupleKeys = new Set();
    for (const record of assignments) {
        if (!isRecord(record))
            continue;
        const key = tupleKey(record);
        if (key === null)
            continue;
        if (tupleKeys.has(key))
            return "DUPLICATE_ASSIGNMENT_DENIED";
        tupleKeys.add(key);
    }
    return null;
}
function validCapabilityEntry(value) {
    return exactKeys(value, CAPABILITY_ENTRY_KEYS)
        && isValidId(value.capabilityId, CAPABILITY_ID)
        && isDigest(value.digest)
        && isExactVersion(value.version);
}
function validRecord(value) {
    if (!exactKeys(value, RECORD_KEYS))
        return false;
    if (value.capabilityScope !== "EXPLICIT")
        return false;
    if (value.state !== "DISABLED" && value.state !== "ENABLED")
        return false;
    if (![value.generationDigest, value.lockDigest, value.packDigest, value.catalogDigest].every(isDigest)) {
        return false;
    }
    if (![value.version, value.profileVersion, value.adapterVersion, value.routeVersion].every(isExactVersion)) {
        return false;
    }
    if (!isValidId(value.skillId, SKILL_ID))
        return false;
    if (!isValidId(value.profileId, PROFILE_ID))
        return false;
    if (!isValidId(value.adapterId, ADAPTER_ID))
        return false;
    if (!isValidId(value.packId, PACK_ID))
        return false;
    if (!isValidId(value.routeId, ROUTE_ID))
        return false;
    if (!Array.isArray(value.capabilities)
        || value.capabilities.length < 1
        || value.capabilities.length > CAPABILITY_LIMIT) {
        return false;
    }
    if (value.capabilities.some((capability) => !validCapabilityEntry(capability)))
        return false;
    const ids = value.capabilities.map((capability) => capability.capabilityId);
    return ids.length === new Set(ids).size;
}
function validGenerationRef(value) {
    if (!exactKeys(value, GENERATION_KEYS))
        return false;
    if (!isDigest(value.generationDigest) || !isDigest(value.lockDigest))
        return false;
    if (!isValidId(value.skillId, SKILL_ID))
        return false;
    if (!isExactVersion(value.version))
        return false;
    if (!Array.isArray(value.capabilityIds)
        || value.capabilityIds.length < 1
        || value.capabilityIds.length > CAPABILITY_LIMIT) {
        return false;
    }
    if (value.capabilityIds.some((id) => !isValidId(id, CAPABILITY_ID)))
        return false;
    return value.capabilityIds.length === new Set(value.capabilityIds).size;
}
function validLkg(value) {
    return exactKeys(value, LKG_KEYS)
        && isDigest(value.lkgLockIdentity)
        && value.mode === ASF_ASSIGNMENT_LKG_MODE_V1;
}
function normalizeInput(document) {
    const assignments = [...document.assignments].map((record) => ({
        ...record,
        capabilities: [...record.capabilities].sort((left, right) => compareCanonical(left.capabilityId, right.capabilityId)),
    }));
    assignments.sort((left, right) => {
        const leftKey = tupleKey(left);
        const rightKey = tupleKey(right);
        return compareCanonical(leftKey === null ? "" : leftKey, rightKey === null ? "" : rightKey);
    });
    return {
        ...document,
        assignments,
        generation: {
            ...document.generation,
            capabilityIds: [...document.generation.capabilityIds].sort(),
        },
    };
}
function matchesTuple(row, record) {
    for (const key of TUPLE_KEYS) {
        if (row[key] !== record[key])
            return false;
    }
    return true;
}
function capabilitiesMatch(record, row) {
    if (record.capabilities.length !== row.capabilities.length)
        return false;
    const recordSet = [...record.capabilities]
        .map((capability) => canonicalJson(capability))
        .sort();
    const rowSet = [...row.capabilities]
        .map((capability) => canonicalJson(capability))
        .sort();
    return canonicalJson(recordSet) === canonicalJson(rowSet);
}
function transitionFrom(record) {
    return {
        adapterId: record.adapterId,
        adapterVersion: record.adapterVersion,
        catalogDigest: record.catalogDigest,
        generationDigest: record.generationDigest,
        lockDigest: record.lockDigest,
        packDigest: record.packDigest,
        packId: record.packId,
        profileId: record.profileId,
        profileVersion: record.profileVersion,
        routeId: record.routeId,
        routeVersion: record.routeVersion,
        skillId: record.skillId,
        version: record.version,
        from: "ENABLED",
        to: "DISABLED",
    };
}
function denyResult(reason) {
    return { outcome: "DENIED", reasonCodes: [reason], exitCode: ASF_ASSIGNMENT_EXIT_CODES_V1[reason] };
}
function verifyCore(value) {
    const deny = (reason) => ({ result: denyResult(reason), normalized: null });
    if (!isRecord(value))
        return deny("SCHEMA_DENIED");
    if (!("lkg" in value) || value.lkg === null || value.lkg === undefined) {
        return deny("LKG_MISSING_DENIED");
    }
    if (!exactKeys(value, TOP_LEVEL_KEYS)) {
        const version = value.schemaVersion;
        if (typeof version === "string" && version !== ASF_ASSIGNMENT_SCHEMA_V1) {
            return deny("UNSUPPORTED_VERSION_DENIED");
        }
        return deny("SCHEMA_DENIED");
    }
    if (value.schemaVersion !== ASF_ASSIGNMENT_SCHEMA_V1) {
        return deny("UNSUPPORTED_VERSION_DENIED");
    }
    const preflight = preflightDenial(value);
    if (preflight !== null)
        return deny(preflight);
    const assignments = value.assignments;
    if (!Array.isArray(assignments)
        || assignments.length < 1
        || assignments.length > ASSIGNMENT_RECORD_LIMIT) {
        return deny("SCHEMA_DENIED");
    }
    if (assignments.some((record) => !validRecord(record)))
        return deny("SCHEMA_DENIED");
    const generation = value.generation;
    if (!validGenerationRef(generation))
        return deny("SCHEMA_DENIED");
    const lkg = value.lkg;
    if (!validLkg(lkg))
        return deny("SCHEMA_DENIED");
    // Embedded documents are fully verified (shape and self-digests) before
    // their typed fields are bound below.
    const matrix = value.matrix;
    const matrixResult = verifyAsfCompatibilityMatrixV1(matrix);
    if (matrixResult.outcome !== "ACCEPTED")
        return deny("MATRIX_BINDING_DENIED");
    const lock = value.lock;
    const lockResult = verifyAsfBundleLockV1(lock);
    if (lockResult.outcome !== "ACCEPTED")
        return deny("DIGEST_MISMATCH_DENIED");
    if (matrix.catalogue.catalogDigest !== lock.capabilityCatalogue.catalogDigest
        || matrix.catalogue.catalogId !== lock.capabilityCatalogue.catalogId) {
        return deny("MATRIX_BINDING_DENIED");
    }
    if (generation.lockDigest !== lock.lock.lockIdentity
        || generation.generationDigest !== lock.lock.generationDigest
        || lock.generation.skillId !== generation.skillId
        || lock.generation.version !== generation.version
        || lkg.lkgLockIdentity !== lock.lock.rollback.lkgLockIdentity) {
        return deny("DIGEST_MISMATCH_DENIED");
    }
    const normalized = normalizeInput(value);
    const catalogue = new Map(lock.capabilityCatalogue.entries.map((entry) => [entry.capabilityId, entry]));
    const transitions = [];
    const updatedAssignments = [];
    for (const record of normalized.assignments) {
        if (record.generationDigest !== generation.generationDigest
            || record.lockDigest !== lock.lock.lockIdentity
            || record.catalogDigest !== lock.capabilityCatalogue.catalogDigest
            || record.packDigest !== lock.capabilityPack.packDigest
            || record.packId !== lock.capabilityPack.packId
            || record.skillId !== generation.skillId
            || record.version !== generation.version
            || !sameStringSet(record.capabilities.map((capability) => capability.capabilityId), generation.capabilityIds)) {
            return deny("DIGEST_MISMATCH_DENIED");
        }
        for (const capability of record.capabilities) {
            const declared = catalogue.get(capability.capabilityId);
            if (declared === undefined
                || declared.digest !== capability.digest
                || declared.version !== capability.version) {
                return deny("DIGEST_MISMATCH_DENIED");
            }
        }
        const row = matrix.rows.find((candidate) => matchesTuple(candidate, record));
        if (row === undefined)
            return deny("INCOMPATIBLE_TUPLE_DENIED");
        if (record.state === "ENABLED") {
            if (!capabilitiesMatch(record, row))
                return deny("DIGEST_MISMATCH_DENIED");
            if (row.verdict === "INCOMPATIBLE") {
                transitions.push(transitionFrom(record));
                updatedAssignments.push({ ...record, state: "DISABLED" });
                continue;
            }
        }
        else if (!capabilitiesMatch(record, row)) {
            return deny("DIGEST_MISMATCH_DENIED");
        }
        updatedAssignments.push(record);
    }
    const receiptCore = {
        authority: ASF_ASSIGNMENT_AUTHORITY_V1,
        disabledTransitions: transitions.length,
        enabledAssignments: updatedAssignments.filter((record) => record.state === "ENABLED").length,
        lkgLockIdentity: lkg.lkgLockIdentity,
        lockIdentity: lock.lock.lockIdentity,
        matrixDigest: matrix.matrixDigest,
        matrixId: matrix.matrixId,
        schemaVersion: ASF_ASSIGNMENT_RECEIPT_SCHEMA_V1,
    };
    const receipt = {
        ...receiptCore,
        receiptDigest: asfAssignmentDigest(receiptCore),
    };
    const projection = {
        assignments: updatedAssignments,
        disableTransitions: transitions,
    };
    const result = {
        outcome: "ACCEPTED",
        reasonCodes: ["ASF_ASSIGNMENT_ACCEPTED"],
        exitCode: 0,
        canonicalJson: canonicalJson(normalized),
        projection,
        receipt,
        receiptDigest: receipt.receiptDigest,
        receiptJson: canonicalJson(receipt),
    };
    return { result, normalized };
}
export function applyAsfAssignmentV1(value) {
    return verifyCore(value).result;
}
export function parseAsfAssignmentV1(raw) {
    if (hasDuplicateKey(raw))
        return denyResult("DUPLICATE_KEY_DENIED");
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return denyResult("INVALID_JSON_DENIED");
    }
    const { result, normalized } = verifyCore(parsed);
    if (result.outcome !== "ACCEPTED")
        return result;
    if (normalized === null || raw !== canonicalJson(normalized)) {
        return denyResult("NONCANONICAL_ENCODING_DENIED");
    }
    return result;
}
export function asfAssignmentReceiptDigestV1(value) {
    const core = { ...value };
    delete core.receiptDigest;
    return asfAssignmentDigest(core);
}
export function validateAsfAssignmentReceiptV1(value) {
    if (!exactKeys(value, RECEIPT_KEYS))
        return false;
    if (value.schemaVersion !== ASF_ASSIGNMENT_RECEIPT_SCHEMA_V1)
        return false;
    if (!isDigest(value.lkgLockIdentity)
        || !isDigest(value.lockIdentity)
        || !isDigest(value.matrixDigest)
        || !isDigest(value.receiptDigest)) {
        return false;
    }
    if (!isValidId(value.matrixId, MATRIX_ID))
        return false;
    if (!isSafeCount(value.disabledTransitions) || !isSafeCount(value.enabledAssignments)) {
        return false;
    }
    if (canonicalJson(value.authority) !== canonicalJson(ASF_ASSIGNMENT_AUTHORITY_V1)) {
        return false;
    }
    return asfAssignmentReceiptDigestV1(value) === value.receiptDigest;
}
