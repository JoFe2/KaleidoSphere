import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
/**
 * UD-M1 authorized thin slice (issue #53).
 *
 * This module contains pure, local contract verification and fixture helpers
 * for a read-only Doctor report and a CHECK_ONLY update plan. It does not
 * install, migrate, activate, promote, roll back, execute packages, inspect a
 * live system, or perform filesystem, process, worker, or network effects.
 */
export const UPDATE_AXIS_NAMES_V1 = [
    "core", "packs", "adapters", "policies", "schemas", "generations",
];
export const UPDATE_CANDIDATE_SCHEMA_V1 = "chimpmaera.update/candidate/v1";
export const UPDATE_LKG_SCHEMA_V1 = "chimpmaera.update/lkg/v1";
export const UPDATE_COMPATIBILITY_SCHEMA_V1 = "chimpmaera.update/compatibility-decision/v1";
export const UPDATE_SAFE_MODE_SCHEMA_V1 = "chimpmaera.update/safe-mode/v1";
export const UPDATE_CHECK_PLAN_SCHEMA_V1 = "chimpmaera.update/check-plan/v1";
export const UPDATE_HEALTH_REPORT_SCHEMA_V1 = "chimpmaera.update/health-report/v1";
export const SAFE_MODE_REASON_ORDER_V1 = Object.freeze([
    "LKG_INCOMPLETE",
    "HEALTH_CHECK_FAILED",
    "HEALTH_CHECK_UNOBSERVED",
]);
export const UPDATE_SAFE_MODE_EXIT_CODE_V1 = 90;
export const UPDATE_CHECK_PLAN_EXIT_CODES_V1 = Object.freeze({
    UPDATE_CHECK_ACCEPTED: 0,
    INVALID_JSON_DENIED: 49,
    SCHEMA_DENIED: 50,
    UNSUPPORTED_CONTRACT_VERSION_DENIED: 51,
    DIGEST_MISMATCH_DENIED: 52,
    TUPLE_MISMATCH_DENIED: 53,
    COMPATIBILITY_DENIED: 54,
    SELF_ATTESTATION_DENIED: 55,
    SELF_PROMOTION_DENIED: 56,
    AUTHORITY_WIDENING_DENIED: 57,
    SAFE_MODE_INCONSISTENT_DENIED: 58,
    MUTATION_CLAIM_DENIED: 59,
    INDEPENDENT_CONTEXT_DENIED: 60,
    AUTHORITY_BINDING_DENIED: 61,
    LKG_FRESHNESS_DENIED: 62,
    LKG_REVOCATION_DENIED: 63,
    HEALTH_CHECK_COVERAGE_DENIED: 64,
    HEALTH_CHECK_CONTRADICTION_DENIED: 65,
});
const PLAN_DENIAL_ORDER = Object.freeze([
    "SCHEMA_DENIED",
    "UNSUPPORTED_CONTRACT_VERSION_DENIED",
    "INDEPENDENT_CONTEXT_DENIED",
    "DIGEST_MISMATCH_DENIED",
    "TUPLE_MISMATCH_DENIED",
    "AUTHORITY_BINDING_DENIED",
    "LKG_FRESHNESS_DENIED",
    "LKG_REVOCATION_DENIED",
    "COMPATIBILITY_DENIED",
    "SELF_ATTESTATION_DENIED",
    "SELF_PROMOTION_DENIED",
    "AUTHORITY_WIDENING_DENIED",
    "SAFE_MODE_INCONSISTENT_DENIED",
    "MUTATION_CLAIM_DENIED",
]);
// Canonical SemVer 2.0.0. Exact versions are required; ranges and mutable
// selectors (including dist-tags such as `latest`) are deliberately invalid.
const SEMVER_NUMERIC = "(?:0|[1-9][0-9]*)";
const SEMVER_PRERELEASE_IDENTIFIER = "(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)";
const EXACT_VERSION = new RegExp(`^${SEMVER_NUMERIC}(?:\\.${SEMVER_NUMERIC}){2}(?:-${SEMVER_PRERELEASE_IDENTIFIER}(?:\\.${SEMVER_PRERELEASE_IDENTIFIER})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`);
const DIGEST = /^[a-f0-9]{64}$/;
const PLAN_ID = /^update:[a-z0-9][a-z0-9._-]{2,95}$/;
const CANDIDATE_ID = /^candidate:[a-z0-9][a-z0-9._-]{2,95}$/;
const UPDATER_ID = /^updater:[a-z0-9][a-z0-9._-]{2,95}$/;
const LKG_ID = /^(?:lkg|maintenance):[a-z0-9][a-z0-9._-]{2,95}$/;
const DECISION_ID = /^compatibility:[a-z0-9][a-z0-9._-]{2,95}$/;
const REPORT_ID = /^update:[a-z0-9][a-z0-9._-]{2,95}$/;
const ATTESTOR_ID = /^attestor:[a-z0-9][a-z0-9._-]{2,95}$/;
const PROMOTER_ID = /^promoter:[a-z0-9][a-z0-9._-]{2,95}$/;
const RESOLVER_ID = /^resolver:[a-z0-9][a-z0-9._-]{2,95}$/;
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const COMPONENT_ID_PATTERNS = Object.freeze({
    core: /^core:[a-z0-9][a-z0-9._-]{2,95}$/,
    packs: /^pack:[a-z0-9][a-z0-9._-]{2,95}$/,
    adapters: /^adapter:[a-z0-9][a-z0-9._-]{2,95}$/,
    policies: /^policy:[a-z0-9][a-z0-9._-]{2,95}$/,
    schemas: /^schema:[a-z0-9][a-z0-9._-]{2,95}$/,
    generations: /^generation:[a-z0-9][a-z0-9._-]{2,95}$/,
});
export const UPDATE_HEALTH_PROFILE_CHECK_IDS_V1 = deepFreeze({
    HEALTH: ["check:tuple-lock"],
    READINESS: ["check:tuple-lock", "check:safe-mode"],
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
        if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
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
    return Number.isSafeInteger(value) && value >= 0;
}
function isStringArray(value) {
    return isDenseStandardArray(value) && value.every((item) => typeof item === "string")
        && value.length === new Set(value).size;
}
function isSafeModeReason(value) {
    return typeof value === "string" && SAFE_MODE_REASON_ORDER_V1.includes(value);
}
/**
 * Computes a canonical SHA-256 content digest after rejecting unsafe JSON
 * shapes. This digest is not a signature and provides no trust by itself.
 */
export function updateCheckPlanDigestV1(value, digestKey) {
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
export function updateTupleDigestV1(tuple) {
    const cloned = safeJsonClone(tuple);
    if (!validTuple(cloned))
        throw new TypeError("INVALID_UPDATE_TUPLE");
    return createHash("sha256").update(canonicalJson(cloned)).digest("hex");
}
// ---------------------------------------------------------------------------
// Verified deterministic exports
// ---------------------------------------------------------------------------
function projectPublicHealthReport(report) {
    const checks = report.checks.map((check) => safeObject([
        ["checkId", check.checkId],
        ["status", check.status],
        ["reasonCode", check.reasonCode],
    ], true));
    return deepFreeze(safeObject([
        ["schemaVersion", report.schemaVersion],
        ["reportId", report.reportId],
        ["profile", report.profile],
        ["readOnly", report.readOnly],
        ["lockedTupleDigest", report.lockedTupleDigest],
        ["tupleStatus", report.tupleStatus],
        ["checks", checks],
        ["safeMode", safeObject([
                ["schemaVersion", report.safeMode.schemaVersion],
                ["active", report.safeMode.active],
                ["readOnly", report.safeMode.readOnly],
                ["reasonCodes", [...report.safeMode.reasonCodes]],
            ], true)],
        ["generatedAtMs", report.generatedAtMs],
        ["reportDigest", report.reportDigest],
    ], true));
}
/** Validates against independent context before emitting a fixed public projection. */
export function renderRedactedUpdateHealthReportV1(report, context) {
    let snapshot;
    try {
        snapshot = immutable(report);
    }
    catch {
        throw new Error("UNSAFE_OR_INVALID_UPDATE_EXPORT");
    }
    const result = verifyUpdateHealthReportV1(snapshot, context);
    if (result.outcome === "DENIED")
        throw new Error("UNSAFE_OR_INVALID_UPDATE_EXPORT");
    return canonicalJson(safeJsonClone(projectPublicHealthReport(snapshot)));
}
// ---------------------------------------------------------------------------
// Health/readiness report verification
// ---------------------------------------------------------------------------
function validHealthCheckShape(value) {
    return exactKeys(value, ["checkId", "status", "reasonCode"])
        && typeof value.checkId === "string"
        && ["PASS", "FAIL", "NOT_OBSERVED"].includes(value.status)
        && ["OBSERVATION_MATCHED", "OBSERVATION_MISMATCH", "OBSERVATION_UNAVAILABLE"].includes(value.reasonCode);
}
function healthStatusReasonMatches(check) {
    return (check.status === "PASS" && check.reasonCode === "OBSERVATION_MATCHED")
        || (check.status === "FAIL" && check.reasonCode === "OBSERVATION_MISMATCH")
        || (check.status === "NOT_OBSERVED" && check.reasonCode === "OBSERVATION_UNAVAILABLE");
}
function validSafeMode(value) {
    return exactKeys(value, ["schemaVersion", "active", "readOnly", "reasonCodes"])
        && value.schemaVersion === UPDATE_SAFE_MODE_SCHEMA_V1
        && typeof value.active === "boolean" && value.readOnly === true
        && isDenseStandardArray(value.reasonCodes)
        && value.reasonCodes.length === new Set(value.reasonCodes).size
        && value.reasonCodes.every(isSafeModeReason);
}
function validHealthReportShape(value) {
    return exactKeys(value, ["schemaVersion", "reportId", "profile", "readOnly", "lockedTupleDigest",
        "tupleStatus", "checks", "safeMode", "generatedAtMs", "reportDigest"])
        && value.schemaVersion === UPDATE_HEALTH_REPORT_SCHEMA_V1
        && typeof value.reportId === "string" && REPORT_ID.test(value.reportId)
        && (value.profile === "HEALTH" || value.profile === "READINESS")
        && value.readOnly === true && isDigest(value.lockedTupleDigest)
        && (value.tupleStatus === "COMPLETE" || value.tupleStatus === "INCOMPLETE")
        && isDenseStandardArray(value.checks) && value.checks.length > 0 && value.checks.every(validHealthCheckShape)
        && validSafeMode(value.safeMode)
        && isTimestamp(value.generatedAtMs) && isDigest(value.reportDigest);
}
function validHealthContext(value) {
    return exactKeys(value, ["expectedTuple", "expectedProfile"])
        && validTuple(value.expectedTuple)
        && (value.expectedProfile === "HEALTH" || value.expectedProfile === "READINESS");
}
function hasUnsupportedHealthVersion(value) {
    const safeMode = isPlainDataRecord(value.safeMode) ? value.safeMode : null;
    return (value.schemaVersion !== undefined && value.schemaVersion !== UPDATE_HEALTH_REPORT_SCHEMA_V1)
        || (safeMode?.schemaVersion !== undefined && safeMode.schemaVersion !== UPDATE_SAFE_MODE_SCHEMA_V1);
}
function denyHealth(reason) {
    return immutable({ outcome: "DENIED", reasonCodes: [reason], exitCode: UPDATE_CHECK_PLAN_EXIT_CODES_V1[reason] });
}
function healthSafeMode(reasonCodes) {
    return immutable({ outcome: "SAFE_MODE", reasonCodes: [...reasonCodes], exitCode: UPDATE_SAFE_MODE_EXIT_CODE_V1 });
}
function tupleIsComplete(tuple) {
    return UPDATE_AXIS_NAMES_V1.every((axis) => tuple[axis].length > 0);
}
function arraysEqual(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}
export function verifyUpdateHealthReportV1(value, context) {
    let clonedValue;
    let clonedContext;
    try {
        clonedValue = safeJsonClone(value);
        clonedContext = context === undefined ? undefined : safeJsonClone(context);
    }
    catch {
        return denyHealth("SCHEMA_DENIED");
    }
    if (!exactKeys(clonedValue, ["schemaVersion", "reportId", "profile", "readOnly", "lockedTupleDigest",
        "tupleStatus", "checks", "safeMode", "generatedAtMs", "reportDigest"])) {
        if (isPlainDataRecord(clonedValue) && hasUnsupportedHealthVersion(clonedValue)) {
            return denyHealth("UNSUPPORTED_CONTRACT_VERSION_DENIED");
        }
        return denyHealth("SCHEMA_DENIED");
    }
    if (hasUnsupportedHealthVersion(clonedValue))
        return denyHealth("UNSUPPORTED_CONTRACT_VERSION_DENIED");
    if (!validHealthReportShape(clonedValue))
        return denyHealth("SCHEMA_DENIED");
    if (!validHealthContext(clonedContext))
        return denyHealth("INDEPENDENT_CONTEXT_DENIED");
    const report = clonedValue;
    if (updateCheckPlanDigestV1(report, "reportDigest") !== report.reportDigest) {
        return denyHealth("DIGEST_MISMATCH_DENIED");
    }
    const expectedDigest = updateTupleDigestV1(clonedContext.expectedTuple);
    const expectedStatus = tupleIsComplete(clonedContext.expectedTuple) ? "COMPLETE" : "INCOMPLETE";
    if (report.lockedTupleDigest !== expectedDigest || report.tupleStatus !== expectedStatus) {
        return denyHealth("TUPLE_MISMATCH_DENIED");
    }
    if (report.profile !== clonedContext.expectedProfile)
        return denyHealth("HEALTH_CHECK_COVERAGE_DENIED");
    if (report.checks.some((check) => !healthStatusReasonMatches(check))) {
        return denyHealth("HEALTH_CHECK_CONTRADICTION_DENIED");
    }
    const expectedCheckIds = UPDATE_HEALTH_PROFILE_CHECK_IDS_V1[report.profile];
    const actualCheckIds = report.checks.map((check) => check.checkId);
    const coverageMatches = arraysEqual(actualCheckIds, expectedCheckIds);
    if (!coverageMatches)
        return denyHealth("HEALTH_CHECK_COVERAGE_DENIED");
    const issues = [];
    if (expectedStatus === "INCOMPLETE")
        issues.push("LKG_INCOMPLETE");
    if (report.checks.some((check) => check.status === "FAIL"))
        issues.push("HEALTH_CHECK_FAILED");
    if (report.checks.some((check) => check.status === "NOT_OBSERVED"))
        issues.push("HEALTH_CHECK_UNOBSERVED");
    const orderedIssues = SAFE_MODE_REASON_ORDER_V1.filter((reason) => issues.includes(reason));
    const declared = [...report.safeMode.reasonCodes];
    const safeModeConsistent = report.safeMode.active === (orderedIssues.length > 0)
        && arraysEqual(declared, orderedIssues);
    if (!safeModeConsistent)
        return denyHealth("SAFE_MODE_INCONSISTENT_DENIED");
    if (orderedIssues.length > 0)
        return healthSafeMode(orderedIssues);
    return immutable({ outcome: "ACCEPTED", reasonCodes: ["UPDATE_HEALTH_ACCEPTED"], exitCode: 0 });
}
export function parseUpdateHealthReportV1(json, context) {
    try {
        return verifyUpdateHealthReportV1(JSON.parse(json), context);
    }
    catch {
        return denyHealth("INVALID_JSON_DENIED");
    }
}
export function runFixtureHealthReportV1(options) {
    let cloned;
    try {
        cloned = safeJsonClone(options);
    }
    catch {
        throw new Error("INVALID_READ_ONLY_HEALTH_REPORT_FIXTURE");
    }
    if (!exactKeys(cloned, ["reportId", "profile", "lockedTuple", "checks", "safeModeReasonCodes", "generatedAtMs"])
        || !REPORT_ID.test(cloned.reportId)
        || (cloned.profile !== "HEALTH" && cloned.profile !== "READINESS")
        || !validTuple(cloned.lockedTuple)
        || !isDenseStandardArray(cloned.checks) || cloned.checks.length === 0
        || !cloned.checks.every(validHealthCheckShape)
        || !arraysEqual(cloned.checks.map((check) => check.checkId), UPDATE_HEALTH_PROFILE_CHECK_IDS_V1[cloned.profile])
        || !isDenseStandardArray(cloned.safeModeReasonCodes)
        || cloned.safeModeReasonCodes.length !== new Set(cloned.safeModeReasonCodes).size
        || !cloned.safeModeReasonCodes.every(isSafeModeReason)
        || !arraysEqual(cloned.safeModeReasonCodes, SAFE_MODE_REASON_ORDER_V1.filter((reason) => cloned.safeModeReasonCodes.includes(reason)))
        || !isTimestamp(cloned.generatedAtMs)) {
        throw new Error("INVALID_READ_ONLY_HEALTH_REPORT_FIXTURE");
    }
    const report = safeObject([
        ["schemaVersion", UPDATE_HEALTH_REPORT_SCHEMA_V1],
        ["reportId", cloned.reportId],
        ["profile", cloned.profile],
        ["readOnly", true],
        ["lockedTupleDigest", updateTupleDigestV1(cloned.lockedTuple)],
        ["tupleStatus", tupleIsComplete(cloned.lockedTuple) ? "COMPLETE" : "INCOMPLETE"],
        ["checks", cloned.checks],
        ["safeMode", safeObject([
                ["schemaVersion", UPDATE_SAFE_MODE_SCHEMA_V1],
                ["active", cloned.safeModeReasonCodes.length > 0],
                ["readOnly", true],
                ["reasonCodes", cloned.safeModeReasonCodes],
            ])],
        ["generatedAtMs", cloned.generatedAtMs],
    ]);
    const complete = safeObject([
        ...Object.entries(report),
        ["reportDigest", updateCheckPlanDigestV1(report, "reportDigest")],
    ]);
    return deepFreeze(complete);
}
// ---------------------------------------------------------------------------
// Fail-closed check/plan verification
// ---------------------------------------------------------------------------
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
    return validTuple(value) && tupleIsComplete(value);
}
function validLkg(value) {
    return exactKeys(value, ["schemaVersion", "lkgId", "releaseId", "state", "revoked", "stale",
        "tuple", "authorityProfileDigest", "observedAtMs", "tupleDigest", "lkgDigest"])
        && value.schemaVersion === UPDATE_LKG_SCHEMA_V1
        && typeof value.lkgId === "string" && LKG_ID.test(value.lkgId)
        && typeof value.releaseId === "string" && EXACT_VERSION.test(value.releaseId)
        && (value.state === "COMPLETE" || value.state === "INCOMPLETE")
        && typeof value.revoked === "boolean" && typeof value.stale === "boolean"
        && validTuple(value.tuple) && isDigest(value.authorityProfileDigest)
        && isTimestamp(value.observedAtMs) && isDigest(value.tupleDigest) && isDigest(value.lkgDigest);
}
function validCandidate(value) {
    return exactKeys(value, ["schemaVersion", "candidateId", "releaseId", "synthetic", "immutable", "source",
        "targetTuple", "targetTupleDigest", "authorityProfileDigest", "attestedBy", "promotedBy", "digest"])
        && value.schemaVersion === UPDATE_CANDIDATE_SCHEMA_V1
        && typeof value.candidateId === "string" && CANDIDATE_ID.test(value.candidateId)
        && typeof value.releaseId === "string" && EXACT_VERSION.test(value.releaseId)
        && typeof value.synthetic === "boolean" && typeof value.immutable === "boolean"
        && value.source === "SYNTHETIC_ISOLATED"
        && validCompleteTuple(value.targetTuple) && isDigest(value.targetTupleDigest)
        && isDigest(value.authorityProfileDigest)
        && typeof value.attestedBy === "string" && ATTESTOR_ID.test(value.attestedBy)
        && typeof value.promotedBy === "string" && PROMOTER_ID.test(value.promotedBy)
        && isDigest(value.digest);
}
function validCompatibility(value) {
    return exactKeys(value, ["schemaVersion", "decisionId", "subjectCandidateDigest", "subjectLkgDigest",
        "verdict", "authorityDelta", "resolvedBy", "decisionDigest"])
        && value.schemaVersion === UPDATE_COMPATIBILITY_SCHEMA_V1
        && typeof value.decisionId === "string" && DECISION_ID.test(value.decisionId)
        && isDigest(value.subjectCandidateDigest) && isDigest(value.subjectLkgDigest)
        && (value.verdict === "COMPATIBLE" || value.verdict === "INCOMPATIBLE")
        && exactKeys(value.authorityDelta, ["added", "removed"])
        && isStringArray(value.authorityDelta.added) && isStringArray(value.authorityDelta.removed)
        && typeof value.resolvedBy === "string" && RESOLVER_ID.test(value.resolvedBy)
        && isDigest(value.decisionDigest);
}
function validPlan(value) {
    return exactKeys(value, ["schemaVersion", "planId", "mode", "executionAuthorized", "candidate",
        "compatibility", "lkg", "safeMode", "selfAttestation", "selfPromotion", "authorityWidened",
        "issuedAtMs", "planDigest"])
        && value.schemaVersion === UPDATE_CHECK_PLAN_SCHEMA_V1
        && typeof value.planId === "string" && PLAN_ID.test(value.planId)
        && value.mode === "CHECK_ONLY" && typeof value.executionAuthorized === "boolean"
        && validCandidate(value.candidate) && validCompatibility(value.compatibility)
        && validLkg(value.lkg) && validSafeMode(value.safeMode)
        && typeof value.selfAttestation === "boolean" && typeof value.selfPromotion === "boolean"
        && typeof value.authorityWidened === "boolean"
        && isTimestamp(value.issuedAtMs) && isDigest(value.planDigest);
}
function validPlanContext(value) {
    if (!exactKeys(value, ["expectedUpdaterId", "expectedCandidate", "expectedCompatibility", "expectedTarget", "expectedLkg", "trustedAuthorities",
        "evaluationTimeMs", "maxLkgAgeMs", "revocationState"]))
        return false;
    if (typeof value.expectedUpdaterId !== "string" || !UPDATER_ID.test(value.expectedUpdaterId))
        return false;
    if (!exactKeys(value.expectedCandidate, ["candidateId", "releaseId", "candidateDigest"])
        || typeof value.expectedCandidate.candidateId !== "string" || !CANDIDATE_ID.test(value.expectedCandidate.candidateId)
        || typeof value.expectedCandidate.releaseId !== "string" || !EXACT_VERSION.test(value.expectedCandidate.releaseId)
        || !isDigest(value.expectedCandidate.candidateDigest))
        return false;
    if (!exactKeys(value.expectedCompatibility, ["decisionId", "decisionDigest"])
        || typeof value.expectedCompatibility.decisionId !== "string" || !DECISION_ID.test(value.expectedCompatibility.decisionId)
        || !isDigest(value.expectedCompatibility.decisionDigest))
        return false;
    if (!exactKeys(value.expectedTarget, ["tuple", "authorityProfileDigest"])
        || !validCompleteTuple(value.expectedTarget.tuple) || !isDigest(value.expectedTarget.authorityProfileDigest))
        return false;
    if (!exactKeys(value.expectedLkg, ["lkgId", "releaseId", "lkgDigest", "tuple", "authorityProfileDigest", "observedAtMs"])
        || typeof value.expectedLkg.lkgId !== "string" || !LKG_ID.test(value.expectedLkg.lkgId)
        || typeof value.expectedLkg.releaseId !== "string" || !EXACT_VERSION.test(value.expectedLkg.releaseId)
        || !isDigest(value.expectedLkg.lkgDigest) || !validTuple(value.expectedLkg.tuple)
        || !isDigest(value.expectedLkg.authorityProfileDigest) || !isTimestamp(value.expectedLkg.observedAtMs))
        return false;
    if (!exactKeys(value.trustedAuthorities, ["attestedBy", "promotedBy", "resolvedBy"])
        || typeof value.trustedAuthorities.attestedBy !== "string" || !ATTESTOR_ID.test(value.trustedAuthorities.attestedBy)
        || typeof value.trustedAuthorities.promotedBy !== "string" || !PROMOTER_ID.test(value.trustedAuthorities.promotedBy)
        || typeof value.trustedAuthorities.resolvedBy !== "string" || !RESOLVER_ID.test(value.trustedAuthorities.resolvedBy))
        return false;
    if (!isTimestamp(value.evaluationTimeMs) || !isTimestamp(value.maxLkgAgeMs))
        return false;
    return exactKeys(value.revocationState, ["lkgId", "lkgDigest", "revoked", "evaluatedAtMs"])
        && typeof value.revocationState.lkgId === "string" && LKG_ID.test(value.revocationState.lkgId)
        && isDigest(value.revocationState.lkgDigest) && typeof value.revocationState.revoked === "boolean"
        && isTimestamp(value.revocationState.evaluatedAtMs);
}
function hasUnsupportedPlanVersion(value) {
    const expected = [UPDATE_CHECK_PLAN_SCHEMA_V1, UPDATE_CANDIDATE_SCHEMA_V1,
        UPDATE_COMPATIBILITY_SCHEMA_V1, UPDATE_LKG_SCHEMA_V1, UPDATE_SAFE_MODE_SCHEMA_V1];
    const versions = [
        value.schemaVersion,
        isPlainDataRecord(value.candidate) ? value.candidate.schemaVersion : undefined,
        isPlainDataRecord(value.compatibility) ? value.compatibility.schemaVersion : undefined,
        isPlainDataRecord(value.lkg) ? value.lkg.schemaVersion : undefined,
        isPlainDataRecord(value.safeMode) ? value.safeMode.schemaVersion : undefined,
    ];
    return versions.some((version, index) => version !== undefined && version !== expected[index]);
}
function denyPlan(reason) {
    return immutable({ outcome: "DENIED", reasonCodes: [reason], exitCode: UPDATE_CHECK_PLAN_EXIT_CODES_V1[reason] });
}
function planSafeMode(reasonCodes) {
    return immutable({ outcome: "SAFE_MODE", reasonCodes: [...reasonCodes], exitCode: UPDATE_SAFE_MODE_EXIT_CODE_V1 });
}
function actorAlias(identity) {
    const separator = identity.indexOf(":");
    return identity.slice(separator + 1).toLowerCase().replace(/[._-]+/g, "-");
}
function authoritiesAreIndependent(context) {
    const identities = [
        context.trustedAuthorities.attestedBy,
        context.trustedAuthorities.promotedBy,
        context.trustedAuthorities.resolvedBy,
    ];
    const aliases = identities.map(actorAlias);
    const subjectAliases = [
        actorAlias(context.expectedCandidate.candidateId),
        actorAlias(context.expectedUpdaterId),
    ];
    return new Set(aliases).size === aliases.length
        && new Set(subjectAliases).size === subjectAliases.length
        && aliases.every((alias) => !subjectAliases.includes(alias));
}
function sameTuple(left, right) {
    return canonicalJson(safeJsonClone(left)) === canonicalJson(safeJsonClone(right));
}
/**
 * Snapshots an independently verified CHECK_ONLY plan as deeply immutable,
 * inspectable data. The plan digest binds its candidate and compatibility
 * decision, while independent context pins the exact tuple, content,
 * compatibility, and authority digests.
 *
 * This operation does not attest, promote, or authorize execution. A candidate
 * or its updater cannot occupy an attestation, compatibility, or promotion gate
 * role. Any mismatch, role collision, or malformed content fails before an
 * immutable inspection snapshot is emitted.
 */
export function freezeUpdateCheckPlanCandidateV1(plan, context) {
    let snapshot;
    try {
        snapshot = immutable(plan);
    }
    catch {
        throw new Error("UNSAFE_OR_INVALID_UPDATE_CANDIDATE");
    }
    if (verifyUpdateCheckPlanV1(snapshot, context).outcome === "DENIED") {
        throw new Error("UNSAFE_OR_INVALID_UPDATE_CANDIDATE");
    }
    return snapshot;
}
export function verifyUpdateCheckPlanV1(value, context) {
    let clonedValue;
    let clonedContext;
    try {
        clonedValue = safeJsonClone(value);
        clonedContext = context === undefined ? undefined : safeJsonClone(context);
    }
    catch {
        return denyPlan("SCHEMA_DENIED");
    }
    if (!exactKeys(clonedValue, ["schemaVersion", "planId", "mode", "executionAuthorized", "candidate",
        "compatibility", "lkg", "safeMode", "selfAttestation", "selfPromotion", "authorityWidened",
        "issuedAtMs", "planDigest"])) {
        if (isPlainDataRecord(clonedValue) && hasUnsupportedPlanVersion(clonedValue)) {
            return denyPlan("UNSUPPORTED_CONTRACT_VERSION_DENIED");
        }
        return denyPlan("SCHEMA_DENIED");
    }
    if (hasUnsupportedPlanVersion(clonedValue))
        return denyPlan("UNSUPPORTED_CONTRACT_VERSION_DENIED");
    if (!validPlan(clonedValue))
        return denyPlan("SCHEMA_DENIED");
    if (!validPlanContext(clonedContext))
        return denyPlan("INDEPENDENT_CONTEXT_DENIED");
    const plan = clonedValue;
    const verificationContext = clonedContext;
    const { candidate, compatibility, lkg, safeMode } = plan;
    const reasons = new Set();
    if (updateCheckPlanDigestV1(plan, "planDigest") !== plan.planDigest
        || updateCheckPlanDigestV1(candidate, "digest") !== candidate.digest
        || updateCheckPlanDigestV1(compatibility, "decisionDigest") !== compatibility.decisionDigest
        || updateCheckPlanDigestV1(lkg, "lkgDigest") !== lkg.lkgDigest
        || candidate.digest !== verificationContext.expectedCandidate.candidateDigest
        || compatibility.decisionDigest !== verificationContext.expectedCompatibility.decisionDigest
        || lkg.lkgDigest !== verificationContext.expectedLkg.lkgDigest) {
        reasons.add("DIGEST_MISMATCH_DENIED");
    }
    const targetTupleDigest = updateTupleDigestV1(candidate.targetTuple);
    const expectedTargetDigest = updateTupleDigestV1(verificationContext.expectedTarget.tuple);
    const expectedLkgTupleDigest = updateTupleDigestV1(verificationContext.expectedLkg.tuple);
    if (candidate.targetTupleDigest !== targetTupleDigest
        || targetTupleDigest !== expectedTargetDigest
        || !sameTuple(candidate.targetTuple, verificationContext.expectedTarget.tuple)
        || lkg.tupleDigest !== updateTupleDigestV1(lkg.tuple)
        || lkg.tupleDigest !== expectedLkgTupleDigest
        || !sameTuple(lkg.tuple, verificationContext.expectedLkg.tuple)
        || lkg.state !== (tupleIsComplete(verificationContext.expectedLkg.tuple) ? "COMPLETE" : "INCOMPLETE")) {
        reasons.add("TUPLE_MISMATCH_DENIED");
    }
    if (candidate.candidateId !== verificationContext.expectedCandidate.candidateId
        || candidate.releaseId !== verificationContext.expectedCandidate.releaseId
        || compatibility.decisionId !== verificationContext.expectedCompatibility.decisionId
        || lkg.lkgId !== verificationContext.expectedLkg.lkgId
        || lkg.releaseId !== verificationContext.expectedLkg.releaseId
        || lkg.observedAtMs !== verificationContext.expectedLkg.observedAtMs) {
        reasons.add("INDEPENDENT_CONTEXT_DENIED");
    }
    const authoritiesBound = candidate.authorityProfileDigest === verificationContext.expectedTarget.authorityProfileDigest
        && lkg.authorityProfileDigest === verificationContext.expectedLkg.authorityProfileDigest
        && candidate.authorityProfileDigest === lkg.authorityProfileDigest
        && candidate.attestedBy === verificationContext.trustedAuthorities.attestedBy
        && candidate.promotedBy === verificationContext.trustedAuthorities.promotedBy
        && compatibility.resolvedBy === verificationContext.trustedAuthorities.resolvedBy
        && authoritiesAreIndependent(verificationContext);
    if (!authoritiesBound)
        reasons.add("AUTHORITY_BINDING_DENIED");
    const independentlyStale = verificationContext.evaluationTimeMs < lkg.observedAtMs
        || verificationContext.evaluationTimeMs - lkg.observedAtMs > verificationContext.maxLkgAgeMs;
    if (plan.issuedAtMs < lkg.observedAtMs
        || plan.issuedAtMs > verificationContext.evaluationTimeMs
        || lkg.stale !== independentlyStale
        || independentlyStale)
        reasons.add("LKG_FRESHNESS_DENIED");
    const revocationBound = verificationContext.revocationState.lkgId === lkg.lkgId
        && verificationContext.revocationState.lkgDigest === lkg.lkgDigest
        && verificationContext.revocationState.evaluatedAtMs === verificationContext.evaluationTimeMs
        && lkg.revoked === verificationContext.revocationState.revoked;
    if (!revocationBound || verificationContext.revocationState.revoked)
        reasons.add("LKG_REVOCATION_DENIED");
    if (compatibility.subjectLkgDigest !== lkg.lkgDigest
        || compatibility.subjectCandidateDigest !== candidate.digest
        || compatibility.verdict !== "COMPATIBLE"
        || actorAlias(compatibility.resolvedBy) === actorAlias(candidate.candidateId)) {
        reasons.add("COMPATIBILITY_DENIED");
    }
    if (actorAlias(candidate.attestedBy) === actorAlias(candidate.candidateId)
        || actorAlias(candidate.attestedBy) === actorAlias(verificationContext.expectedUpdaterId)
        || plan.selfAttestation !== false)
        reasons.add("SELF_ATTESTATION_DENIED");
    if (actorAlias(candidate.promotedBy) === actorAlias(candidate.candidateId)
        || actorAlias(candidate.promotedBy) === actorAlias(verificationContext.expectedUpdaterId)
        || plan.selfPromotion !== false)
        reasons.add("SELF_PROMOTION_DENIED");
    if (compatibility.authorityDelta.added.length > 0 || compatibility.authorityDelta.removed.length > 0
        || plan.authorityWidened !== false)
        reasons.add("AUTHORITY_WIDENING_DENIED");
    if (plan.executionAuthorized !== false || candidate.synthetic !== true || candidate.immutable !== true
        || safeMode.readOnly !== true)
        reasons.add("MUTATION_CLAIM_DENIED");
    if (reasons.size > 0) {
        const reasonCodes = PLAN_DENIAL_ORDER.filter((reason) => reasons.has(reason));
        return immutable({
            outcome: "DENIED",
            reasonCodes,
            exitCode: UPDATE_CHECK_PLAN_EXIT_CODES_V1[reasonCodes[0]],
        });
    }
    const issues = tupleIsComplete(verificationContext.expectedLkg.tuple)
        ? []
        : ["LKG_INCOMPLETE"];
    const consistent = safeMode.active === (issues.length > 0)
        && arraysEqual([...safeMode.reasonCodes], issues);
    if (!consistent)
        return denyPlan("SAFE_MODE_INCONSISTENT_DENIED");
    if (issues.length > 0)
        return planSafeMode(issues);
    return immutable({ outcome: "ACCEPTED", reasonCodes: ["UPDATE_CHECK_ACCEPTED"], exitCode: 0 });
}
export function parseUpdateCheckPlanV1(json, context) {
    try {
        return verifyUpdateCheckPlanV1(JSON.parse(json), context);
    }
    catch {
        return denyPlan("INVALID_JSON_DENIED");
    }
}
/** Canonicalizes safe JSON bytes only. The output is explicitly untrusted. */
export function renderUntrustedUpdateCheckPlanV1(plan) {
    return canonicalJson(safeJsonClone(plan));
}
/** Emits canonical bytes only after independent-context verification succeeds. */
export function renderVerifiedUpdateCheckPlanV1(plan, context) {
    let snapshot;
    try {
        snapshot = immutable(plan);
    }
    catch {
        throw new Error("UNSAFE_OR_INVALID_UPDATE_PLAN");
    }
    if (verifyUpdateCheckPlanV1(snapshot, context).outcome === "DENIED") {
        throw new Error("UNSAFE_OR_INVALID_UPDATE_PLAN");
    }
    return canonicalJson(snapshot);
}
