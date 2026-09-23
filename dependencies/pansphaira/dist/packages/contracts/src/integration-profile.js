import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import { AGENT_WORK_EVENT_SCHEMA_V1 } from "./agent-work-event.js";
import { ANALYTICS_PROJECTION_SCHEMA_V1 } from "./analytics-projection.js";
import { EXTENSION_ASSURANCE_PROFILE_SCHEMA_V1 } from "./extension-assurance-profile.js";
import { HMI_CONTRIBUTE_PREFLIGHT_SCHEMA_V1 } from "./hmi-contribute-preflight.js";
import { POWER_PLATFORM_READ_CONNECTOR_SCHEMA_V1 } from "./power-platform-read-connector.js";
import { UPDATE_DOCTOR_BUNDLE_SCHEMA_V1 } from "./update-doctor.js";
import { VERIFICATION_FABRIC_BUNDLE_SCHEMA_V1 } from "./verification-fabric.js";
export const INTEGRATION_PROFILE_SCHEMA_V1 = "cm.integration-profile/v1";
export const INTEGRATION_PROFILE_CONTRACT_VERSION_V1 = "1.0.0";
export const INTEGRATION_PROFILE_EVALUATED_AT_MS_V1 = 1_786_147_200_000;
export const INTEGRATION_PROFILE_CLAIM_BOUNDARY_V1 = "LOCAL_SYNTHETIC_CONTRACT_ONLY_NO_TENANT_NO_CREDENTIAL_NO_PROVIDER_CALL_NO_AUTHORITY_NO_ACTIVATION_NO_EXTERNAL_WRITE";
export const INTEGRATION_PROFILE_VARIANTS_V1 = [
    "POWER_APPS_READ_ONLY",
    "POWER_BI_READ_ONLY_PROJECTION",
    "MAILBOX_STYLE_READ_ADAPTER",
    "LOCAL_KNOWLEDGE_CORPUS",
    "ISSUE_CANDIDATE_EXPORT_ONLY",
];
const EXPECTED_ACTIONS = {
    POWER_APPS_READ_ONLY: ["READ_RECORD", "READ_METADATA"],
    POWER_BI_READ_ONLY_PROJECTION: ["READ_PROJECTION"],
    MAILBOX_STYLE_READ_ADAPTER: ["LIST_MESSAGES", "READ_MESSAGE_METADATA"],
    LOCAL_KNOWLEDGE_CORPUS: ["READ_CORPUS", "SEARCH_CORPUS"],
    ISSUE_CANDIDATE_EXPORT_ONLY: ["EXPORT_ISSUE_CANDIDATE"],
};
const COMPONENT_CONTRACTS = {
    POWER_PLATFORM_READ_CONNECTOR: POWER_PLATFORM_READ_CONNECTOR_SCHEMA_V1,
    POWER_BI_READ_ONLY_PROJECTION: ANALYTICS_PROJECTION_SCHEMA_V1,
    AGENT_WORK_INTELLIGENCE: AGENT_WORK_EVENT_SCHEMA_V1,
    HMI_CONTRIBUTION_PREFLIGHT: HMI_CONTRIBUTE_PREFLIGHT_SCHEMA_V1,
    VERIFICATION_FABRIC: VERIFICATION_FABRIC_BUNDLE_SCHEMA_V1,
    EXTENSION_TRUST_LAB: EXTENSION_ASSURANCE_PROFILE_SCHEMA_V1,
    UPDATE_CONTROLLER: UPDATE_DOCTOR_BUNDLE_SCHEMA_V1,
};
const REQUIRED_ROUTE_COMPONENT = {
    POWER_APPS_READ_ONLY: "POWER_PLATFORM_READ_CONNECTOR",
    POWER_BI_READ_ONLY_PROJECTION: "POWER_BI_READ_ONLY_PROJECTION",
    MAILBOX_STYLE_READ_ADAPTER: "AGENT_WORK_INTELLIGENCE",
    LOCAL_KNOWLEDGE_CORPUS: "AGENT_WORK_INTELLIGENCE",
    ISSUE_CANDIDATE_EXPORT_ONLY: "HMI_CONTRIBUTION_PREFLIGHT",
};
const EXPECTED_CLASSES = {
    POWER_APPS_READ_ONLY: ["READ_ONLY", "NONE"],
    POWER_BI_READ_ONLY_PROJECTION: ["READ_ONLY_PROJECTION", "READ_ONLY"],
    MAILBOX_STYLE_READ_ADAPTER: ["READ_ONLY", "NONE"],
    LOCAL_KNOWLEDGE_CORPUS: ["READ_ONLY", "NONE"],
    ISSUE_CANDIDATE_EXPORT_ONLY: ["EXPORT_ONLY", "EXPORT_ONLY"],
};
const TOP_LEVEL_KEYS = [
    "schemaVersion", "identity", "integration", "upstream", "data", "identityProfile",
    "routes", "lifecycle", "verification", "overrides", "claimBoundary", "profileDigest",
];
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, expected) {
    return isRecord(value) && canonicalJson(Object.keys(value).sort()) === canonicalJson([...expected].sort());
}
function isDigest(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function isString(value) {
    return typeof value === "string";
}
function isStringArray(value) {
    return Array.isArray(value) && value.every(isString) && new Set(value).size === value.length;
}
function hasSafePrimitiveShapes(value) {
    const identity = value.identity;
    const integration = value.integration;
    const upstream = value.upstream;
    const data = value.data;
    const identityProfile = value.identityProfile;
    const lifecycle = value.lifecycle;
    const verification = value.verification;
    const overrides = value.overrides;
    return Object.values(identity).every(isString)
        && isString(integration.variant) && isString(integration.capabilityClass)
        && isStringArray(integration.allowedActions)
        && typeof integration.externalWriteAllowed === "boolean"
        && typeof integration.genericProxyAllowed === "boolean"
        && isString(upstream.sourceKind) && isString(upstream.sourceRef)
        && isString(upstream.sourceVersion) && isString(upstream.sourceDigest)
        && isString(upstream.license) && typeof upstream.pinned === "boolean"
        && Number.isSafeInteger(upstream.replacementReviewAtMs)
        && isString(data.authoritativeReadSource) && isString(data.projectionClass)
        && isString(data.classification) && isString(data.schemaVersion)
        && isStringArray(data.lineageKeys) && isStringArray(data.excludedFields)
        && (data.privatePath === null || isString(data.privatePath))
        && isString(identityProfile.tenantScope)
        && (identityProfile.tenantReference === null || isString(identityProfile.tenantReference))
        && isString(identityProfile.identityMode) && typeof identityProfile.leastPrivilege === "boolean"
        && isString(identityProfile.approvalBoundary) && typeof identityProfile.crossTenantAllowed === "boolean"
        && typeof identityProfile.ambientCredentialAllowed === "boolean"
        && value.routes instanceof Array
        && value.routes.every((route) => exactKeys(route, ["purpose", "component", "contractSchemaVersion", "mode"])
            && Object.values(route).every(isString))
        && Object.values(lifecycle).every(isString)
        && isString(verification.fabricSchemaVersion) && isString(verification.evidenceBundleRef)
        && isString(verification.evidenceDigest) && Number.isSafeInteger(verification.verifiedAtMs)
        && Number.isSafeInteger(verification.freshUntilMs) && isString(verification.negativeProbeSet)
        && isString(verification.authoritativeReadback) && isString(verification.residualRisk)
        && isStringArray(overrides.allowlistedNames) && isRecord(overrides.values)
        && (overrides.genericHost === null || isString(overrides.genericHost))
        && (overrides.genericPath === null || isString(overrides.genericPath))
        && (overrides.genericProxy === null || isString(overrides.genericProxy));
}
function containsPrivatePath(value) {
    if (typeof value === "string") {
        return /(?:^|\s)(?:\/[A-Za-z0-9._-]+\/|[A-Za-z]:\\|~\/)/.test(value)
            || value.includes("../") || value.includes("..\\");
    }
    if (Array.isArray(value))
        return value.some(containsPrivatePath);
    return isRecord(value) && Object.values(value).some(containsPrivatePath);
}
function decision(reasonCodes, digest) {
    return {
        schemaVersion: "cm.integration-profile-decision/v1",
        outcome: reasonCodes.length === 1 && reasonCodes[0] === "INTEGRATION_PROFILE_CONFORMANT" ? "CONFORMANT" : "DENIED",
        reasonCodes,
        claimBoundary: INTEGRATION_PROFILE_CLAIM_BOUNDARY_V1,
        ...(digest === undefined ? {} : { profileDigest: digest }),
    };
}
export function integrationProfileDigestV1(value) {
    if (!isRecord(value))
        throw new TypeError("INVALID_INTEGRATION_PROFILE");
    const unsigned = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "profileDigest"));
    return createHash("sha256").update(canonicalJson(unsigned), "utf8").digest("hex");
}
export function evaluateIntegrationProfileV1(value) {
    if (!exactKeys(value, TOP_LEVEL_KEYS)
        || value.schemaVersion !== INTEGRATION_PROFILE_SCHEMA_V1
        || !isDigest(value.profileDigest)
        || value.claimBoundary !== INTEGRATION_PROFILE_CLAIM_BOUNDARY_V1
        || !exactKeys(value.identity, ["profileId", "schemaVersion", "adapterId", "adapterVersion", "contractVersion", "policyGeneration", "evidenceGeneration"])
        || !exactKeys(value.integration, ["variant", "capabilityClass", "allowedActions", "externalWriteAllowed", "genericProxyAllowed"])
        || !exactKeys(value.upstream, ["sourceKind", "sourceRef", "sourceVersion", "sourceDigest", "license", "pinned", "replacementReviewAtMs"])
        || !exactKeys(value.data, ["authoritativeReadSource", "projectionClass", "classification", "schemaVersion", "lineageKeys", "excludedFields", "privatePath"])
        || !exactKeys(value.identityProfile, ["tenantScope", "tenantReference", "identityMode", "leastPrivilege", "approvalBoundary", "crossTenantAllowed", "ambientCredentialAllowed"])
        || !Array.isArray(value.routes)
        || !exactKeys(value.lifecycle, ["storageClass", "retentionClass", "backupMode", "deletionReadback", "migrationMode", "acceptedProfileDigest", "lkgProfileDigest", "rollbackTarget"])
        || !exactKeys(value.verification, ["fabricSchemaVersion", "evidenceBundleRef", "evidenceDigest", "verifiedAtMs", "freshUntilMs", "negativeProbeSet", "authoritativeReadback", "residualRisk"])
        || !exactKeys(value.overrides, ["allowlistedNames", "values", "genericHost", "genericPath", "genericProxy"])
        || !hasSafePrimitiveShapes(value)) {
        return decision(["SCHEMA_DENIED"]);
    }
    const profile = value;
    if (profile.identity.schemaVersion !== INTEGRATION_PROFILE_SCHEMA_V1
        || profile.identity.adapterVersion !== INTEGRATION_PROFILE_CONTRACT_VERSION_V1
        || profile.identity.contractVersion !== INTEGRATION_PROFILE_CONTRACT_VERSION_V1) {
        return decision(["INCOMPATIBLE_VERSION_DENIED"]);
    }
    if (!INTEGRATION_PROFILE_VARIANTS_V1.includes(profile.integration.variant))
        return decision(["SCHEMA_DENIED"]);
    const expectedActions = EXPECTED_ACTIONS[profile.integration.variant];
    if (canonicalJson(profile.integration.allowedActions) !== canonicalJson(expectedActions)) {
        const hiddenWrite = profile.integration.allowedActions.some((action) => /WRITE|CREATE|UPDATE|DELETE|SEND|POST|MUTATE/.test(action));
        return decision([hiddenWrite ? "HIDDEN_WRITE_DENIED" : "UNKNOWN_ACTION_DENIED"]);
    }
    if (profile.integration.externalWriteAllowed !== false) {
        return decision(["HIDDEN_WRITE_DENIED"]);
    }
    if (profile.data.privatePath !== null || containsPrivatePath(profile))
        return decision(["PRIVATE_PATH_DENIED"]);
    if (profile.upstream.pinned !== true || !isDigest(profile.upstream.sourceDigest)
        || profile.upstream.license !== "Apache-2.0" || !Number.isSafeInteger(profile.upstream.replacementReviewAtMs)) {
        return decision(["UNPINNED_UPSTREAM_DENIED"]);
    }
    if (profile.identityProfile.tenantScope !== "SINGLE_SYNTHETIC_TENANT"
        || profile.identityProfile.tenantReference !== null || profile.identityProfile.crossTenantAllowed !== false) {
        return decision(["CROSS_TENANT_REFERENCE_DENIED"]);
    }
    if (!Number.isSafeInteger(profile.verification.verifiedAtMs)
        || !Number.isSafeInteger(profile.verification.freshUntilMs)
        || profile.verification.verifiedAtMs > INTEGRATION_PROFILE_EVALUATED_AT_MS_V1
        || profile.verification.freshUntilMs < INTEGRATION_PROFILE_EVALUATED_AT_MS_V1) {
        return decision(["STALE_EVIDENCE_DENIED"]);
    }
    if (profile.lifecycle.rollbackTarget.length === 0 || !isDigest(profile.lifecycle.acceptedProfileDigest)
        || !isDigest(profile.lifecycle.lkgProfileDigest)) {
        return decision(["MISSING_ROLLBACK_TARGET_DENIED"]);
    }
    if (profile.overrides.genericHost !== null || profile.overrides.genericPath !== null
        || profile.overrides.genericProxy !== null || profile.integration.genericProxyAllowed !== false) {
        return decision(["GENERIC_PROXY_OVERRIDE_DENIED"]);
    }
    if (!exactKeys(profile.overrides.values, [])
        || canonicalJson(profile.overrides.allowlistedNames) !== canonicalJson(["displayName", "refreshCadenceMs"])) {
        return decision(["GENERIC_PROXY_OVERRIDE_DENIED"]);
    }
    const routesValid = profile.routes.length >= 3 && profile.routes.every((route) => exactKeys(route, ["purpose", "component", "contractSchemaVersion", "mode"])
        && route.mode === "REFERENCE_ONLY"
        && COMPONENT_CONTRACTS[route.component] === route.contractSchemaVersion)
        && profile.routes.some((route) => route.component === REQUIRED_ROUTE_COMPONENT[profile.integration.variant])
        && profile.routes.some((route) => route.component === "VERIFICATION_FABRIC")
        && profile.routes.some((route) => route.component === "EXTENSION_TRUST_LAB")
        && profile.routes.some((route) => route.component === "UPDATE_CONTROLLER");
    if (!routesValid)
        return decision(["ROUTE_CONTRACT_DENIED"]);
    const [expectedCapability, expectedProjection] = EXPECTED_CLASSES[profile.integration.variant];
    if (profile.integration.capabilityClass !== expectedCapability || profile.data.projectionClass !== expectedProjection
        || profile.identity.policyGeneration !== "cm-policy:synthetic-v1"
        || profile.identity.evidenceGeneration !== "cm-evidence:synthetic-v1"
        || !["CM_OWNED_CONTRACT", "LOCAL_SYNTHETIC_CORPUS"].includes(profile.upstream.sourceKind)
        || profile.upstream.sourceVersion !== INTEGRATION_PROFILE_CONTRACT_VERSION_V1
        || profile.data.classification !== "LOCAL_SYNTHETIC_PUBLIC"
        || canonicalJson(profile.data.excludedFields) !== canonicalJson(["credentials", "personalIdentity", "privatePath", "providerData", "rawContent", "tenantIdentifier"])
        || !["DELEGATED_LEAST_PRIVILEGE", "WORKLOAD_READ_ONLY", "LOCAL_NO_IDENTITY"].includes(profile.identityProfile.identityMode)
        || profile.identityProfile.leastPrivilege !== true
        || profile.identityProfile.approvalBoundary !== "OWNER_POLICY_EVENT_REQUIRED_FOR_ACTIVATION"
        || profile.identityProfile.ambientCredentialAllowed !== false
        || !["NO_RUNTIME_STORAGE", "LOCAL_SYNTHETIC_FIXTURE"].includes(profile.lifecycle.storageClass)
        || profile.lifecycle.retentionClass !== "PUBLIC_SYNTHETIC_FIXTURE_ONLY"
        || profile.lifecycle.backupMode !== "NOT_APPLICABLE_NO_PERSISTENCE"
        || profile.lifecycle.deletionReadback !== "LOCAL_FIXTURE_REMOVAL_ONLY"
        || profile.lifecycle.migrationMode !== "PRESERVE_OLD_READER_UNTIL_REPLACEMENT_READBACK"
        || profile.verification.fabricSchemaVersion !== VERIFICATION_FABRIC_BUNDLE_SCHEMA_V1
        || !isDigest(profile.verification.evidenceDigest)
        || profile.verification.negativeProbeSet !== "INT-PROFILE-001"
        || profile.verification.authoritativeReadback !== "LOCAL_FIXTURE_VALIDATION_ONLY"
        || profile.verification.residualRisk !== "REAL_SYSTEM_COMPATIBILITY_NOT_VALIDATED") {
        return decision(["SCHEMA_DENIED"]);
    }
    if (integrationProfileDigestV1(profile) !== profile.profileDigest)
        return decision(["DIGEST_MISMATCH_DENIED"]);
    return decision(["INTEGRATION_PROFILE_CONFORMANT"], profile.profileDigest);
}
