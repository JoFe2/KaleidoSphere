import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
export const MAINTENANCE_BUNDLE_SCHEMA_V1 = "chimpmaera.maintenance/contract-freeze/v1";
export const INSTALLATION_LOCK_SCHEMA_V1 = "chimpmaera.maintenance/installation-lock/v1";
export const MAINTENANCE_COMPATIBILITY_SCHEMA_V1 = "chimpmaera.maintenance/compatibility-profile/v1";
export const MAINTENANCE_PLAN_SCHEMA_V1 = "chimpmaera.maintenance/operation-plan/v1";
export const MAINTENANCE_RECEIPT_SCHEMA_V1 = "chimpmaera.maintenance/operation-receipt/v1";
export const MAINTENANCE_DOCTOR_SCHEMA_V1 = "chimpmaera.maintenance/doctor-report/v1";
export const MAINTENANCE_AXIS_NAMES_V1 = [
    "core", "packs", "adapters", "policies", "schemas", "generations",
];
export const MAINTENANCE_EXIT_CODES_V1 = {
    MAINTENANCE_CONTRACT_ACCEPTED: 0,
    INVALID_JSON_DENIED: 20,
    SCHEMA_DENIED: 21,
    UNSUPPORTED_VERSION_DENIED: 22,
    MUTABLE_TARGET_DENIED: 23,
    DIGEST_MISMATCH_DENIED: 24,
    AUTHORITY_DELTA_DENIED: 25,
    COMPATIBILITY_DENIED: 26,
    MUTATION_CLAIM_DENIED: 27,
};
const EXACT_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
const ID = /^[a-z][a-z0-9-]{1,31}:[a-z0-9][a-z0-9._-]{2,95}$/;
const DIGEST = /^[a-f0-9]{64}$/;
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
function isId(value) {
    return typeof value === "string" && ID.test(value);
}
function isTimestamp(value) {
    return Number.isSafeInteger(value) && value >= 0;
}
function validComponent(value) {
    return exactKeys(value, ["componentId", "version", "digest"])
        && isId(value.componentId) && typeof value.version === "string"
        && EXACT_VERSION.test(value.version) && isDigest(value.digest);
}
function normalizedLock(lock) {
    const sorted = (items) => [...items].sort((a, b) => a.componentId.localeCompare(b.componentId));
    return {
        ...lock,
        versionAxes: {
            core: sorted(lock.versionAxes.core),
            packs: sorted(lock.versionAxes.packs),
            adapters: sorted(lock.versionAxes.adapters),
            policies: sorted(lock.versionAxes.policies),
            schemas: sorted(lock.versionAxes.schemas),
            generations: sorted(lock.versionAxes.generations),
        },
    };
}
function normalizedBundle(bundle) {
    return { ...bundle, installationLock: normalizedLock(bundle.installationLock) };
}
export function maintenanceContractDigest(value, digestKey) {
    const unsigned = Object.fromEntries(Object.entries(value).filter(([key]) => key !== digestKey));
    return createHash("sha256").update(canonicalJson(unsigned)).digest("hex");
}
export function renderMaintenanceContractBundleV1(bundle) {
    return canonicalJson(normalizedBundle(bundle));
}
function schemaVersions(value) {
    return [
        value.schemaVersion,
        value.installationLock?.schemaVersion,
        value.compatibilityProfile?.schemaVersion,
        value.operationPlan?.schemaVersion,
        value.doctorReport?.schemaVersion,
        value.operationReceipt?.schemaVersion,
    ];
}
function hasUnsupportedVersion(value) {
    const expected = [MAINTENANCE_BUNDLE_SCHEMA_V1, INSTALLATION_LOCK_SCHEMA_V1,
        MAINTENANCE_COMPATIBILITY_SCHEMA_V1, MAINTENANCE_PLAN_SCHEMA_V1,
        MAINTENANCE_DOCTOR_SCHEMA_V1, MAINTENANCE_RECEIPT_SCHEMA_V1];
    return schemaVersions(value).some((version, index) => version !== undefined && version !== expected[index]);
}
function preflightSemanticDenial(value) {
    const lock = isRecord(value.installationLock) ? value.installationLock : null;
    const axes = lock && isRecord(lock.versionAxes) ? lock.versionAxes : null;
    if (axes) {
        for (const axis of MAINTENANCE_AXIS_NAMES_V1) {
            const components = axes[axis];
            if (Array.isArray(components) && components.some((component) => isRecord(component)
                && typeof component.version === "string" && !EXACT_VERSION.test(component.version))) {
                return "MUTABLE_TARGET_DENIED";
            }
        }
    }
    const compatibility = isRecord(value.compatibilityProfile) ? value.compatibilityProfile : null;
    if (compatibility && ((Array.isArray(compatibility.unresolvedInputs) && compatibility.unresolvedInputs.length > 0)
        || (Array.isArray(compatibility.mutableInputs) && compatibility.mutableInputs.length > 0))) {
        return "COMPATIBILITY_DENIED";
    }
    const deltas = [compatibility?.authorityDelta,
        isRecord(value.operationPlan) ? value.operationPlan.authorityDelta : null];
    if (deltas.some((delta) => isRecord(delta)
        && ((Array.isArray(delta.added) && delta.added.length > 0)
            || (Array.isArray(delta.removed) && delta.removed.length > 0)))) {
        return "AUTHORITY_DELTA_DENIED";
    }
    const plan = isRecord(value.operationPlan) ? value.operationPlan : null;
    const receipt = isRecord(value.operationReceipt) ? value.operationReceipt : null;
    if (plan?.executionAuthorized === true || receipt?.mutationObserved === true)
        return "MUTATION_CLAIM_DENIED";
    return null;
}
function validLock(value) {
    if (!exactKeys(value, ["schemaVersion", "lockId", "releaseId", "versionAxes", "authorityProfileDigest", "lockDigest"])
        || value.schemaVersion !== INSTALLATION_LOCK_SCHEMA_V1 || !isId(value.lockId)
        || typeof value.releaseId !== "string" || !EXACT_VERSION.test(value.releaseId)
        || !isDigest(value.authorityProfileDigest) || !isDigest(value.lockDigest)
        || !exactKeys(value.versionAxes, MAINTENANCE_AXIS_NAMES_V1))
        return false;
    const axes = value.versionAxes;
    for (const axis of MAINTENANCE_AXIS_NAMES_V1) {
        const components = axes[axis];
        if (!Array.isArray(components) || components.length === 0 || !components.every(validComponent))
            return false;
        const ids = components.map(({ componentId }) => componentId);
        if (ids.length !== new Set(ids).size)
            return false;
    }
    return axes.core.length === 1;
}
function validCompatibility(value) {
    const axisVersions = isRecord(value) && isRecord(value.requiredAxisVersions)
        ? value.requiredAxisVersions : {};
    return exactKeys(value, ["schemaVersion", "profileId", "subjectLockDigest", "requiredAxisVersions",
        "unresolvedInputs", "mutableInputs", "authorityDelta", "verdict", "profileDigest"])
        && value.schemaVersion === MAINTENANCE_COMPATIBILITY_SCHEMA_V1 && isId(value.profileId)
        && isDigest(value.subjectLockDigest) && exactKeys(value.requiredAxisVersions, MAINTENANCE_AXIS_NAMES_V1)
        && MAINTENANCE_AXIS_NAMES_V1.every((axis) => typeof axisVersions[axis] === "string"
            && EXACT_VERSION.test(axisVersions[axis]))
        && Array.isArray(value.unresolvedInputs) && value.unresolvedInputs.length === 0
        && Array.isArray(value.mutableInputs) && value.mutableInputs.length === 0
        && exactKeys(value.authorityDelta, ["added", "removed"])
        && Array.isArray(value.authorityDelta.added) && value.authorityDelta.added.length === 0
        && Array.isArray(value.authorityDelta.removed) && value.authorityDelta.removed.length === 0
        && value.verdict === "COMPATIBLE" && isDigest(value.profileDigest);
}
function validPlan(value) {
    return exactKeys(value, ["schemaVersion", "operationId", "intent", "fromLockDigest", "targetLockDigest",
        "compatibilityProfileDigest", "authorityDelta", "executionAuthorized", "issuedAtMs", "planDigest"])
        && value.schemaVersion === MAINTENANCE_PLAN_SCHEMA_V1 && isId(value.operationId)
        && ["CHECK_UPDATE", "PREVIEW_MIGRATION", "DOCTOR"].includes(value.intent)
        && isDigest(value.fromLockDigest) && isDigest(value.targetLockDigest)
        && isDigest(value.compatibilityProfileDigest) && exactKeys(value.authorityDelta, ["added", "removed"])
        && Array.isArray(value.authorityDelta.added) && value.authorityDelta.added.length === 0
        && Array.isArray(value.authorityDelta.removed) && value.authorityDelta.removed.length === 0
        && value.executionAuthorized === false && isTimestamp(value.issuedAtMs) && isDigest(value.planDigest);
}
function validDoctor(value) {
    return exactKeys(value, ["schemaVersion", "reportId", "readOnly", "observedLockDigest",
        "compatibilityProfileDigest", "checks", "publicProjection", "generatedAtMs", "reportDigest"])
        && value.schemaVersion === MAINTENANCE_DOCTOR_SCHEMA_V1 && isId(value.reportId) && value.readOnly === true
        && isDigest(value.observedLockDigest) && isDigest(value.compatibilityProfileDigest)
        && Array.isArray(value.checks) && value.checks.length > 0
        && value.checks.every((check) => exactKeys(check, ["checkId", "status", "reasonCode"])
            && isId(check.checkId) && ["PASS", "FAIL", "NOT_OBSERVED"].includes(check.status)
            && ["OBSERVATION_MATCHED", "OBSERVATION_MISMATCH", "OBSERVATION_UNAVAILABLE"].includes(check.reasonCode))
        && exactKeys(value.publicProjection, ["releaseId", "overallStatus", "reasonCodes"])
        && typeof value.publicProjection.releaseId === "string" && EXACT_VERSION.test(value.publicProjection.releaseId)
        && ["READY_FOR_REVIEW", "NOT_READY", "INCOMPLETE"].includes(value.publicProjection.overallStatus)
        && Array.isArray(value.publicProjection.reasonCodes) && value.publicProjection.reasonCodes.length > 0
        && value.publicProjection.reasonCodes.every((reason) => ["CONTRACTS_VALID", "CHECK_FAILED", "CHECK_UNAVAILABLE"].includes(reason))
        && isTimestamp(value.generatedAtMs) && isDigest(value.reportDigest);
}
function validReceipt(value) {
    return exactKeys(value, ["schemaVersion", "operationId", "outcome", "reasonCodes", "exitCode", "planDigest",
        "beforeLockDigest", "afterLockDigest", "mutationObserved", "completedAtMs", "receiptDigest"])
        && value.schemaVersion === MAINTENANCE_RECEIPT_SCHEMA_V1 && isId(value.operationId)
        && value.outcome === "VALIDATED" && canonicalJson(value.reasonCodes) === canonicalJson(["MAINTENANCE_CONTRACT_ACCEPTED"])
        && value.exitCode === 0 && isDigest(value.planDigest) && isDigest(value.beforeLockDigest)
        && isDigest(value.afterLockDigest) && value.mutationObserved === false
        && isTimestamp(value.completedAtMs) && isDigest(value.receiptDigest);
}
function deny(reason) {
    return { outcome: "DENIED", reasonCodes: [reason], exitCode: MAINTENANCE_EXIT_CODES_V1[reason] };
}
export function verifyMaintenanceContractBundleV1(input) {
    if (!exactKeys(input, ["schemaVersion", "installationLock", "compatibilityProfile", "operationPlan", "doctorReport", "operationReceipt"])) {
        if (isRecord(input) && hasUnsupportedVersion(input))
            return deny("UNSUPPORTED_VERSION_DENIED");
        return deny("SCHEMA_DENIED");
    }
    if (hasUnsupportedVersion(input))
        return deny("UNSUPPORTED_VERSION_DENIED");
    const semanticDenial = preflightSemanticDenial(input);
    if (semanticDenial)
        return deny(semanticDenial);
    if (!validLock(input.installationLock) || !validCompatibility(input.compatibilityProfile)
        || !validPlan(input.operationPlan) || !validDoctor(input.doctorReport) || !validReceipt(input.operationReceipt)) {
        return deny("SCHEMA_DENIED");
    }
    const bundle = normalizedBundle(input);
    const allVersions = MAINTENANCE_AXIS_NAMES_V1.flatMap((axis) => bundle.installationLock.versionAxes[axis].map(({ version }) => version));
    if (allVersions.some((version) => !EXACT_VERSION.test(version)))
        return deny("MUTABLE_TARGET_DENIED");
    if (bundle.compatibilityProfile.unresolvedInputs.length > 0 || bundle.compatibilityProfile.mutableInputs.length > 0)
        return deny("COMPATIBILITY_DENIED");
    if (bundle.compatibilityProfile.authorityDelta.added.length > 0 || bundle.compatibilityProfile.authorityDelta.removed.length > 0
        || bundle.operationPlan.authorityDelta.added.length > 0 || bundle.operationPlan.authorityDelta.removed.length > 0)
        return deny("AUTHORITY_DELTA_DENIED");
    const digests = [
        [bundle.installationLock, "lockDigest", bundle.installationLock.lockDigest],
        [bundle.compatibilityProfile, "profileDigest", bundle.compatibilityProfile.profileDigest],
        [bundle.operationPlan, "planDigest", bundle.operationPlan.planDigest],
        [bundle.doctorReport, "reportDigest", bundle.doctorReport.reportDigest],
        [bundle.operationReceipt, "receiptDigest", bundle.operationReceipt.receiptDigest],
    ];
    if (digests.some(([value, key, expected]) => maintenanceContractDigest(value, key) !== expected))
        return deny("DIGEST_MISMATCH_DENIED");
    const lockDigest = bundle.installationLock.lockDigest;
    const profileDigest = bundle.compatibilityProfile.profileDigest;
    if (bundle.compatibilityProfile.subjectLockDigest !== lockDigest
        || bundle.operationPlan.fromLockDigest !== lockDigest || bundle.operationPlan.targetLockDigest !== lockDigest
        || bundle.operationPlan.compatibilityProfileDigest !== profileDigest
        || bundle.doctorReport.observedLockDigest !== lockDigest || bundle.doctorReport.compatibilityProfileDigest !== profileDigest
        || bundle.operationReceipt.planDigest !== bundle.operationPlan.planDigest
        || bundle.operationReceipt.beforeLockDigest !== lockDigest || bundle.operationReceipt.afterLockDigest !== lockDigest) {
        return deny("DIGEST_MISMATCH_DENIED");
    }
    if (bundle.operationPlan.executionAuthorized !== false || bundle.operationReceipt.mutationObserved !== false)
        return deny("MUTATION_CLAIM_DENIED");
    const rendered = renderMaintenanceContractBundleV1(bundle);
    return {
        outcome: "ACCEPTED",
        reasonCodes: ["MAINTENANCE_CONTRACT_ACCEPTED"],
        exitCode: 0,
        canonicalJson: rendered,
        bundleDigest: createHash("sha256").update(rendered).digest("hex"),
        bundle,
    };
}
export function parseMaintenanceContractBundleV1(json) {
    try {
        return verifyMaintenanceContractBundleV1(JSON.parse(json));
    }
    catch {
        return deny("INVALID_JSON_DENIED");
    }
}
