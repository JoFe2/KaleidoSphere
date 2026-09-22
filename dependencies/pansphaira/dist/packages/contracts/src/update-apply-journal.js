import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
/**
 * UD-APPLY-01 authorized thin slice (issue #53, micro-slice 2).
 *
 * This module contains a pure, immutable synthetic apply-journal contract for
 * the governed update apply sequence. It models the fixed event ladder
 * (STAGE_COPY, VERIFY_STAGED, SWITCH_POINTER, VERIFY_POSTCONDITION,
 * ROLLBACK_LKG, CLEANUP) as a hash-chained, fail-closed verification target
 * bound to an independent operation context. It does not stage, copy, switch
 * pointers, roll back, clean up, execute packages, or perform filesystem,
 * process, worker, or network effects.
 */
export const UPDATE_APPLY_JOURNAL_SCHEMA_V1 = "chimpmaera.update/apply-journal/v1";
export const APPLY_EVENT_NAMES_V1 = Object.freeze([
    "STAGE_COPY",
    "VERIFY_STAGED",
    "SWITCH_POINTER",
    "VERIFY_POSTCONDITION",
    "ROLLBACK_LKG",
    "CLEANUP",
]);
export const APPLY_OUTCOMES_BY_EVENT_V1 = Object.freeze({
    STAGE_COPY: ["STAGE_COPIED"],
    VERIFY_STAGED: ["STAGE_VERIFIED"],
    SWITCH_POINTER: ["POINTER_SWITCHED"],
    VERIFY_POSTCONDITION: ["POSTCONDITION_VERIFIED", "POSTCONDITION_FAILED"],
    ROLLBACK_LKG: ["LKG_RESTORED"],
    CLEANUP: ["ZERO_RESIDUE"],
});
export const APPLY_SUCCESS_EVENT_SEQUENCE_V1 = Object.freeze([
    "STAGE_COPY",
    "VERIFY_STAGED",
    "SWITCH_POINTER",
    "VERIFY_POSTCONDITION",
]);
export const APPLY_ROLLBACK_EVENT_SEQUENCE_V1 = Object.freeze([
    "STAGE_COPY",
    "VERIFY_STAGED",
    "SWITCH_POINTER",
    "VERIFY_POSTCONDITION",
    "ROLLBACK_LKG",
    "CLEANUP",
]);
export const APPLY_JOURNAL_GENESIS_DIGEST_V1 = createHash("sha256")
    .update("chimpmaera.update/apply-journal/genesis/v1")
    .digest("hex");
export const UPDATE_APPLY_JOURNAL_EXIT_CODES_V1 = Object.freeze({
    APPLY_JOURNAL_ACCEPTED: 0,
    INVALID_JSON_DENIED: 71,
    SCHEMA_DENIED: 72,
    UNSUPPORTED_CONTRACT_VERSION_DENIED: 73,
    INDEPENDENT_CONTEXT_DENIED: 74,
    OPERATION_BINDING_DENIED: 75,
    SEQUENCE_GAP_DENIED: 76,
    TIME_REVERSAL_DENIED: 77,
    DIGEST_MISMATCH_DENIED: 78,
    EVENT_SEQUENCE_DENIED: 79,
    ROLLBACK_INCOMPLETE_DENIED: 80,
    TERMINAL_STATE_DENIED: 81,
    TERMINAL_APPEND_DENIED: 82,
});
const APPLY_DENIAL_ORDER = Object.freeze([
    "SCHEMA_DENIED",
    "UNSUPPORTED_CONTRACT_VERSION_DENIED",
    "INDEPENDENT_CONTEXT_DENIED",
    "OPERATION_BINDING_DENIED",
    "SEQUENCE_GAP_DENIED",
    "TIME_REVERSAL_DENIED",
    "DIGEST_MISMATCH_DENIED",
    "EVENT_SEQUENCE_DENIED",
    "ROLLBACK_INCOMPLETE_DENIED",
    "TERMINAL_STATE_DENIED",
    "TERMINAL_APPEND_DENIED",
]);
const JOURNAL_KEYS = Object.freeze([
    "schemaVersion",
    "mode",
    "operationDigest",
    "sourceLockDigest",
    "targetLockDigest",
    "revision",
    "entries",
    "terminalState",
    "journalDigest",
]);
const ENTRY_KEYS = Object.freeze([
    "eventType",
    "operationDigest",
    "sourceLockDigest",
    "targetLockDigest",
    "sequence",
    "timestampMs",
    "previousDigest",
    "outcome",
    "entryDigest",
]);
const CONTEXT_KEYS = Object.freeze([
    "expectedOperationDigest",
    "expectedSourceLockDigest",
    "expectedTargetLockDigest",
    "expectedRevision",
]);
const DIGEST = /^[a-f0-9]{64}$/;
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
function isPositiveRevision(value) {
    return Number.isSafeInteger(value) && value > 0;
}
function isApplyEventName(value) {
    return typeof value === "string" && APPLY_EVENT_NAMES_V1.includes(value);
}
function isAllowedOutcome(eventName, outcome) {
    return APPLY_OUTCOMES_BY_EVENT_V1[eventName].includes(outcome);
}
/**
 * Computes a canonical SHA-256 content digest after rejecting unsafe JSON
 * shapes. This digest is not a signature and provides no trust by itself.
 */
export function updateApplyJournalDigestV1(value, digestKey) {
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
// ---------------------------------------------------------------------------
// Deterministic fixture-only journal construction
// ---------------------------------------------------------------------------
function validEventSpec(value) {
    return exactKeys(value, ["outcome", "timestampMs"])
        && typeof value.outcome === "string"
        && isTimestamp(value.timestampMs);
}
/**
 * Builds a frozen synthetic apply journal for exactly one canonical path:
 * the success ladder (terminal VERIFIED) or the rollback ladder
 * (terminal ROLLED_BACK_ZERO_RESIDUE). Any other shape is rejected.
 */
export function buildUpdateApplyJournalV1(options) {
    let cloned;
    try {
        cloned = safeJsonClone(options);
    }
    catch {
        throw new Error("INVALID_APPLY_JOURNAL_FIXTURE");
    }
    if (!exactKeys(cloned, ["operationDigest", "sourceLockDigest", "targetLockDigest", "revision", "events"])
        || !isDigest(cloned.operationDigest)
        || !isDigest(cloned.sourceLockDigest)
        || !isDigest(cloned.targetLockDigest)
        || !isPositiveRevision(cloned.revision)
        || !isDenseStandardArray(cloned.events)
        || (cloned.events.length !== 4 && cloned.events.length !== 6)
        || !cloned.events.every(validEventSpec)) {
        throw new Error("INVALID_APPLY_JOURNAL_FIXTURE");
    }
    const sequence = cloned.events.length === 4
        ? APPLY_SUCCESS_EVENT_SEQUENCE_V1
        : APPLY_ROLLBACK_EVENT_SEQUENCE_V1;
    const outcomesOk = cloned.events.every((spec, index) => isAllowedOutcome(sequence[index], spec.outcome))
        && (cloned.events.length === 4
            ? cloned.events[3].outcome === "POSTCONDITION_VERIFIED"
            : cloned.events[3].outcome === "POSTCONDITION_FAILED");
    const timestampsOk = cloned.events.every((spec, index) => index === 0
        || spec.timestampMs >= cloned.events[index - 1].timestampMs);
    if (!outcomesOk || !timestampsOk)
        throw new Error("INVALID_APPLY_JOURNAL_FIXTURE");
    let previousDigest = APPLY_JOURNAL_GENESIS_DIGEST_V1;
    const entries = cloned.events.map((spec, index) => {
        const unsigned = safeObject([
            ["eventType", sequence[index]],
            ["operationDigest", cloned.operationDigest],
            ["sourceLockDigest", cloned.sourceLockDigest],
            ["targetLockDigest", cloned.targetLockDigest],
            ["sequence", index + 1],
            ["timestampMs", spec.timestampMs],
            ["previousDigest", previousDigest],
            ["outcome", spec.outcome],
        ]);
        const entryDigest = updateApplyJournalDigestV1(unsigned, "entryDigest");
        previousDigest = entryDigest;
        return safeObject([...Object.entries(unsigned), ["entryDigest", entryDigest]]);
    });
    const terminalState = cloned.events.length === 4
        ? "VERIFIED"
        : "ROLLED_BACK_ZERO_RESIDUE";
    const unsignedJournal = safeObject([
        ["schemaVersion", UPDATE_APPLY_JOURNAL_SCHEMA_V1],
        ["mode", "SYNTHETIC_LOCAL_ONLY"],
        ["operationDigest", cloned.operationDigest],
        ["sourceLockDigest", cloned.sourceLockDigest],
        ["targetLockDigest", cloned.targetLockDigest],
        ["revision", cloned.revision],
        ["entries", entries],
        ["terminalState", terminalState],
    ]);
    const journalDigest = updateApplyJournalDigestV1(unsignedJournal, "journalDigest");
    const complete = safeObject([...Object.entries(unsignedJournal), ["journalDigest", journalDigest]]);
    return deepFreeze(complete);
}
// ---------------------------------------------------------------------------
// Fail-closed verification
// ---------------------------------------------------------------------------
function validEntry(value) {
    return exactKeys(value, ENTRY_KEYS)
        && isApplyEventName(value.eventType)
        && isAllowedOutcome(value.eventType, value.outcome)
        && isDigest(value.operationDigest)
        && isDigest(value.sourceLockDigest)
        && isDigest(value.targetLockDigest)
        && isPositiveRevision(value.sequence)
        && isTimestamp(value.timestampMs)
        && isDigest(value.previousDigest)
        && isDigest(value.entryDigest);
}
function validJournal(value) {
    return exactKeys(value, JOURNAL_KEYS)
        && value.schemaVersion === UPDATE_APPLY_JOURNAL_SCHEMA_V1
        && value.mode === "SYNTHETIC_LOCAL_ONLY"
        && isDigest(value.operationDigest)
        && isDigest(value.sourceLockDigest)
        && isDigest(value.targetLockDigest)
        && isPositiveRevision(value.revision)
        && isDenseStandardArray(value.entries)
        && value.entries.length > 0
        && value.entries.every(validEntry)
        && (value.terminalState === "VERIFIED" || value.terminalState === "ROLLED_BACK_ZERO_RESIDUE")
        && isDigest(value.journalDigest);
}
function validContext(value) {
    return exactKeys(value, CONTEXT_KEYS)
        && isDigest(value.expectedOperationDigest)
        && isDigest(value.expectedSourceLockDigest)
        && isDigest(value.expectedTargetLockDigest)
        && isPositiveRevision(value.expectedRevision);
}
function classifyApplyChain(names, outcomes) {
    const hasSuccessHead = names.length >= 4
        && names[0] === "STAGE_COPY"
        && names[1] === "VERIFY_STAGED"
        && names[2] === "SWITCH_POINTER"
        && names[3] === "VERIFY_POSTCONDITION";
    const successTerminal = hasSuccessHead && names.length === 4 && outcomes[3] === "POSTCONDITION_VERIFIED";
    if (successTerminal)
        return "SUCCESS";
    const rollbackComplete = hasSuccessHead
        && outcomes[3] === "POSTCONDITION_FAILED"
        && names[4] === "ROLLBACK_LKG"
        && names[5] === "CLEANUP";
    if (rollbackComplete && names.length === 6)
        return "ROLLBACK";
    if (hasSuccessHead && outcomes[3] === "POSTCONDITION_VERIFIED" && names.length > 4)
        return "TERMINAL_APPEND";
    if (rollbackComplete && names.length > 6)
        return "TERMINAL_APPEND";
    if (names.length === 5 && hasSuccessHead && outcomes[3] === "POSTCONDITION_FAILED" && names[4] === "ROLLBACK_LKG") {
        return "ROLLBACK_INCOMPLETE";
    }
    return "INVALID";
}
function denyApply(reason) {
    return immutable({ outcome: "DENIED", reasonCodes: [reason], exitCode: UPDATE_APPLY_JOURNAL_EXIT_CODES_V1[reason] });
}
export function verifyUpdateApplyJournalV1(value, context) {
    let clonedValue;
    let clonedContext;
    try {
        clonedValue = safeJsonClone(value);
        clonedContext = context === undefined ? undefined : safeJsonClone(context);
    }
    catch {
        return denyApply("SCHEMA_DENIED");
    }
    if (!exactKeys(clonedValue, JOURNAL_KEYS)) {
        if (isPlainDataRecord(clonedValue)
            && clonedValue.schemaVersion !== undefined
            && clonedValue.schemaVersion !== UPDATE_APPLY_JOURNAL_SCHEMA_V1) {
            return denyApply("UNSUPPORTED_CONTRACT_VERSION_DENIED");
        }
        return denyApply("SCHEMA_DENIED");
    }
    if (clonedValue.schemaVersion !== UPDATE_APPLY_JOURNAL_SCHEMA_V1) {
        return denyApply("UNSUPPORTED_CONTRACT_VERSION_DENIED");
    }
    if (!validJournal(clonedValue))
        return denyApply("SCHEMA_DENIED");
    if (!validContext(clonedContext))
        return denyApply("INDEPENDENT_CONTEXT_DENIED");
    const journal = clonedValue;
    const expected = clonedContext;
    const entries = journal.entries;
    const reasons = new Set();
    // Independent operation binding: fully re-digested forgeries cannot rename the operation.
    if (journal.operationDigest !== expected.expectedOperationDigest
        || journal.sourceLockDigest !== expected.expectedSourceLockDigest
        || journal.targetLockDigest !== expected.expectedTargetLockDigest) {
        reasons.add("OPERATION_BINDING_DENIED");
    }
    if (entries.some((entry) => entry.operationDigest !== journal.operationDigest
        || entry.sourceLockDigest !== journal.sourceLockDigest
        || entry.targetLockDigest !== journal.targetLockDigest)) {
        reasons.add("DIGEST_MISMATCH_DENIED");
    }
    // Sequence integrity: strictly 1..n and journal revision matching the independent expectation.
    if (entries.some((entry, index) => entry.sequence !== index + 1))
        reasons.add("SEQUENCE_GAP_DENIED");
    if (journal.revision !== expected.expectedRevision)
        reasons.add("SEQUENCE_GAP_DENIED");
    if (entries.some((entry, index) => index > 0 && entry.timestampMs < entries[index - 1].timestampMs)) {
        reasons.add("TIME_REVERSAL_DENIED");
    }
    // Hash-chain integrity: genesis anchor, previous/entry/journal digests.
    if (entries[0].previousDigest !== APPLY_JOURNAL_GENESIS_DIGEST_V1
        || entries.some((entry, index) => index > 0 && entry.previousDigest !== entries[index - 1].entryDigest)
        || entries.some((entry) => updateApplyJournalDigestV1(entry, "entryDigest") !== entry.entryDigest)
        || updateApplyJournalDigestV1(journal, "journalDigest") !== journal.journalDigest) {
        reasons.add("DIGEST_MISMATCH_DENIED");
    }
    // Canonical event ladder: success stops after VERIFY_POSTCONDITION;
    // failure requires ROLLBACK_LKG then CLEANUP with zero-residue evidence.
    const shape = classifyApplyChain(entries.map((entry) => entry.eventType), entries.map((entry) => entry.outcome));
    if (shape === "ROLLBACK_INCOMPLETE")
        reasons.add("ROLLBACK_INCOMPLETE_DENIED");
    else if (shape === "TERMINAL_APPEND")
        reasons.add("TERMINAL_APPEND_DENIED");
    else if (shape !== "SUCCESS" && shape !== "ROLLBACK")
        reasons.add("EVENT_SEQUENCE_DENIED");
    const expectedTerminal = shape === "SUCCESS"
        ? "VERIFIED"
        : shape === "ROLLBACK" ? "ROLLED_BACK_ZERO_RESIDUE" : null;
    if (journal.terminalState !== expectedTerminal)
        reasons.add("TERMINAL_STATE_DENIED");
    if (reasons.size > 0) {
        const reasonCodes = APPLY_DENIAL_ORDER.filter((reason) => reasons.has(reason));
        return immutable({
            outcome: "DENIED",
            reasonCodes,
            exitCode: UPDATE_APPLY_JOURNAL_EXIT_CODES_V1[reasonCodes[0]],
        });
    }
    return immutable({ outcome: "ACCEPTED", reasonCodes: ["APPLY_JOURNAL_ACCEPTED"], exitCode: 0 });
}
export function parseUpdateApplyJournalV1(json, context) {
    try {
        return verifyUpdateApplyJournalV1(JSON.parse(json), context);
    }
    catch {
        return denyApply("INVALID_JSON_DENIED");
    }
}
