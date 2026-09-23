import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
export const AZURE_IDENTITY_PROFILE_SCHEMA_V1 = "chimpmaera.identity/azure-profile/v1";
export const AZURE_IDENTITY_CONTRACT_VERSION_V1 = "1.0.0";
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, keys) {
    return isRecord(value) && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}
function isDigest(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function isId(value) {
    return typeof value === "string" && /^[a-z][a-z0-9-]{1,31}:[a-z0-9][a-z0-9._-]{2,95}$/.test(value);
}
function exactStringArray(value, expected) {
    return Array.isArray(value) && canonicalJson(value) === canonicalJson(expected);
}
function denied(reason) {
    return { outcome: "DENIED", reasonCodes: [reason] };
}
export function azureIdentityProfileDigestV1(profile) {
    if (!isRecord(profile))
        throw new TypeError("INVALID_AZURE_IDENTITY_PROFILE");
    const content = Object.fromEntries(Object.entries(profile).filter(([key]) => key !== "profileDigest"));
    return createHash("sha256").update(canonicalJson(content), "utf8").digest("hex");
}
export function verifyAzureIdentityProfileV1(value) {
    if (!exactKeys(value, [
        "schemaVersion", "profileId", "contractVersion", "provider", "evidenceClass", "flow",
        "tenantBoundary", "tokenValidation", "apiPermissions", "capabilityBoundary", "credentials",
        "profileDigest",
    ]))
        return denied("AZURE_IDENTITY_SCHEMA_DENIED");
    if (value.schemaVersion !== AZURE_IDENTITY_PROFILE_SCHEMA_V1 || !isId(value.profileId)
        || !isDigest(value.profileDigest))
        return denied("AZURE_IDENTITY_SCHEMA_DENIED");
    if (value.contractVersion !== AZURE_IDENTITY_CONTRACT_VERSION_V1
        || value.provider !== "MICROSOFT_ENTRA_ID" || value.evidenceClass !== "LOCAL_SYNTHETIC") {
        return denied("AZURE_IDENTITY_COMPATIBILITY_DENIED");
    }
    if (!exactKeys(value.flow, ["kind", "redirectBinding", "stateRequired", "nonceRequired"])
        || value.flow.kind !== "OIDC_AUTHORIZATION_CODE_PKCE_S256"
        || value.flow.redirectBinding !== "REGISTERED_EXACT"
        || value.flow.stateRequired !== true || value.flow.nonceRequired !== true) {
        return denied("AZURE_IDENTITY_FLOW_DENIED");
    }
    if (!exactKeys(value.tenantBoundary, [
        "mode", "tenantSource", "requestTenantAccepted", "crossTenantAllowed", "issuerTemplate",
        "blockedAuthorities",
    ]) || value.tenantBoundary.mode !== "SINGLE_TENANT"
        || value.tenantBoundary.tenantSource !== "VERIFIED_TOKEN"
        || value.tenantBoundary.requestTenantAccepted !== false
        || value.tenantBoundary.crossTenantAllowed !== false
        || value.tenantBoundary.issuerTemplate !== "https://login.microsoftonline.com/{tenant}/v2.0"
        || !exactStringArray(value.tenantBoundary.blockedAuthorities, ["common", "consumers", "organizations"])) {
        return denied("AZURE_IDENTITY_TENANT_DENIED");
    }
    if (!exactKeys(value.tokenValidation, [
        "audience", "signatureAlgorithms", "requiredClaims", "maximumClockSkewSeconds", "tokenUse",
        "providerTokenForwarding",
    ]) || value.tokenValidation.audience !== "api://chimpmaera.synthetic/read"
        || !exactStringArray(value.tokenValidation.signatureAlgorithms, ["RS256"])
        || !exactStringArray(value.tokenValidation.requiredClaims, ["iss", "aud", "tid", "sub", "exp", "nbf", "iat", "scp"])
        || !Number.isSafeInteger(value.tokenValidation.maximumClockSkewSeconds)
        || value.tokenValidation.maximumClockSkewSeconds < 0
        || value.tokenValidation.maximumClockSkewSeconds > 300
        || value.tokenValidation.tokenUse !== "API_ENTRY_AUTHENTICATION_ONLY"
        || value.tokenValidation.providerTokenForwarding !== false) {
        return denied("AZURE_IDENTITY_TOKEN_VALIDATION_DENIED");
    }
    if (!exactKeys(value.apiPermissions, [
        "mode", "delegatedScopes", "applicationRoles", "broadPermissionNamesRejected",
    ]) || value.apiPermissions.mode !== "DELEGATED"
        || !exactStringArray(value.apiPermissions.delegatedScopes, ["cm.discovery.read"])
        || !Array.isArray(value.apiPermissions.applicationRoles) || value.apiPermissions.applicationRoles.length !== 0
        || value.apiPermissions.broadPermissionNamesRejected !== true) {
        return denied("AZURE_IDENTITY_SCOPE_DENIED");
    }
    if (!exactKeys(value.capabilityBoundary, [
        "authenticationGrantsAuthority", "requestedRights", "routeIds", "writeTargets",
        "approvalDecisionAllowed", "executionAllowed",
    ]) || value.capabilityBoundary.authenticationGrantsAuthority !== false
        || value.capabilityBoundary.approvalDecisionAllowed !== false
        || value.capabilityBoundary.executionAllowed !== false
        || ![value.capabilityBoundary.requestedRights, value.capabilityBoundary.routeIds,
            value.capabilityBoundary.writeTargets].every((items) => Array.isArray(items) && items.length === 0)) {
        return denied("AZURE_IDENTITY_AUTHORITY_DENIED");
    }
    if (!exactKeys(value.credentials, [
        "ambientAllowed", "embeddedAllowed", "dynamicSelectionAllowed", "secretReferences",
    ]) || value.credentials.ambientAllowed !== false || value.credentials.embeddedAllowed !== false
        || value.credentials.dynamicSelectionAllowed !== false || !Array.isArray(value.credentials.secretReferences)
        || value.credentials.secretReferences.length !== 0) {
        return denied("AZURE_IDENTITY_CREDENTIAL_DENIED");
    }
    const profile = value;
    if (azureIdentityProfileDigestV1(profile) !== profile.profileDigest)
        return denied("AZURE_IDENTITY_DIGEST_DENIED");
    return {
        outcome: "VERIFIED",
        reasonCodes: ["AZURE_IDENTITY_PROFILE_VERIFIED"],
        profileDigest: profile.profileDigest,
        delegatedScopeCount: profile.apiPermissions.delegatedScopes.length,
        requestedRightsCount: 0,
        routeCount: 0,
        writeTargetCount: 0,
    };
}
