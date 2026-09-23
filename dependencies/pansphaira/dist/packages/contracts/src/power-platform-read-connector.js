import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import { verifyAzureIdentityProfileV1, } from "./azure-identity-profile.js";
import { VERIFICATION_FABRIC_BUNDLE_SCHEMA_V1 } from "./verification-fabric.js";
export const POWER_PLATFORM_READ_CONNECTOR_SCHEMA_V1 = "chimpmaera.connector/power-platform-read/v1";
export const POWER_PLATFORM_READ_CONNECTOR_VERSION_V1 = "1.0.0";
const EXPECTED_OPERATIONS = [
    {
        operationKey: "LIST_CAPABILITIES", operationId: "ListCapabilities", method: "GET",
        path: "/v1/capabilities", semantic: "DISCOVERY", delegatedScope: "cm.discovery.read",
        idempotencyKeyRequired: false,
    },
    {
        operationKey: "SUBMIT_GOVERNED_QUERY", operationId: "SubmitGovernedQuery", method: "POST",
        path: "/v1/queries", semantic: "LOGICAL_READ", delegatedScope: "cm.discovery.read",
        idempotencyKeyRequired: true,
    },
    {
        operationKey: "GET_OPERATION_STATUS", operationId: "GetOperationStatus", method: "GET",
        path: "/v1/operations/{operationId}", semantic: "STATUS", delegatedScope: "cm.discovery.read",
        idempotencyKeyRequired: false,
    },
    {
        operationKey: "GET_READBACK", operationId: "GetReadback", method: "GET",
        path: "/v1/operations/{operationId}/readback", semantic: "AUTHORITATIVE_READBACK",
        delegatedScope: "cm.discovery.read", idempotencyKeyRequired: false,
    },
    {
        operationKey: "GET_RECEIPT", operationId: "GetReceipt", method: "GET",
        path: "/v1/operations/{operationId}/receipt", semantic: "BOUND_RECEIPT",
        delegatedScope: "cm.discovery.read", idempotencyKeyRequired: false,
    },
];
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, keys) {
    return isRecord(value) && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}
function isId(value) {
    return typeof value === "string" && /^[a-z][a-z0-9-]{1,31}:[a-z0-9][a-z0-9._-]{2,95}$/.test(value);
}
function isDigest(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function exact(value, expected) {
    return canonicalJson(value) === canonicalJson(expected);
}
function denied(reason) {
    return { outcome: "DENIED", reasonCodes: [reason] };
}
export function powerPlatformReadConnectorDigestV1(contract) {
    if (!isRecord(contract))
        throw new TypeError("INVALID_POWER_PLATFORM_READ_CONNECTOR");
    const content = Object.fromEntries(Object.entries(contract).filter(([key]) => key !== "contractDigest"));
    return createHash("sha256").update(canonicalJson(content), "utf8").digest("hex");
}
export function verifyPowerPlatformReadConnectorV1(value, identityProfile) {
    if (!exactKeys(value, [
        "schemaVersion", "connectorId", "contractVersion", "platform", "evidenceClass", "openApi",
        "identityBinding", "verificationBinding", "operations", "authorityBoundary", "lifecycle",
        "credentials", "contractDigest",
    ]) || value.schemaVersion !== POWER_PLATFORM_READ_CONNECTOR_SCHEMA_V1 || !isId(value.connectorId)
        || !isDigest(value.contractDigest))
        return denied("POWER_PLATFORM_CONNECTOR_SCHEMA_DENIED");
    if (value.contractVersion !== POWER_PLATFORM_READ_CONNECTOR_VERSION_V1
        || value.platform !== "MICROSOFT_POWER_PLATFORM_CUSTOM_CONNECTOR"
        || value.evidenceClass !== "LOCAL_SYNTHETIC")
        return denied("POWER_PLATFORM_CONNECTOR_COMPATIBILITY_DENIED");
    if (!exact(value.openApi, {
        version: "2.0", basePath: "/v1", schemes: ["https"], arbitraryServerSelectionAllowed: false,
    }))
        return denied("POWER_PLATFORM_CONNECTOR_OPENAPI_DENIED");
    const identityResult = verifyAzureIdentityProfileV1(identityProfile);
    if (!exactKeys(value.identityBinding, ["profileId", "profileDigest", "delegatedScopes", "applicationRoles"])
        || identityResult.outcome !== "VERIFIED" || value.identityBinding.profileId !== identityProfile.profileId
        || value.identityBinding.profileDigest !== identityProfile.profileDigest
        || !exact(value.identityBinding.delegatedScopes, ["cm.discovery.read"])
        || !exact(value.identityBinding.delegatedScopes, identityProfile.apiPermissions.delegatedScopes)
        || !exact(value.identityBinding.applicationRoles, []))
        return denied("POWER_PLATFORM_CONNECTOR_IDENTITY_DENIED");
    if (!exact(value.operations, EXPECTED_OPERATIONS))
        return denied("POWER_PLATFORM_CONNECTOR_OPERATION_DENIED");
    if (!exact(value.authorityBoundary, {
        genericInvocationAllowed: false,
        arbitraryUrlAllowed: false,
        arbitraryHttpMethodAllowed: false,
        arbitraryCommandAllowed: false,
        arbitraryBodySchemaAllowed: false,
        callerTenantAllowed: false,
        callerCredentialAllowed: false,
        unknownOperationsDenied: true,
        requestedRights: [],
        writeTargets: [],
        proposalOperations: [],
        approvalOperations: [],
        executionOperations: [],
        cancellationOperations: [],
    }))
        return denied("POWER_PLATFORM_CONNECTOR_AUTHORITY_DENIED");
    if (!exact(value.verificationBinding, {
        bundleSchemaVersion: VERIFICATION_FABRIC_BUNDLE_SCHEMA_V1,
        requiredTuple: ["subjectDigest", "planDigest", "evidenceBundleDigest", "verdictDigest", "readbackDigest"],
    }) || !exact(value.lifecycle, {
        acceptanceSemantics: "OPERATION_REFERENCE_ONLY",
        businessSuccessRequires: "AUTHORITATIVE_READBACK_AND_BOUND_RECEIPT",
        terminalCommittedIsBusinessSuccess: false,
        authoritativeReadbackRequired: true,
        boundReceiptRequired: true,
    }))
        return denied("POWER_PLATFORM_CONNECTOR_LIFECYCLE_DENIED");
    if (!exact(value.credentials, {
        storedByConnector: false,
        embeddedAllowed: false,
        ambientAllowed: false,
        dynamicSelectionAllowed: false,
        secretReferences: [],
    }))
        return denied("POWER_PLATFORM_CONNECTOR_CREDENTIAL_DENIED");
    const contract = value;
    if (powerPlatformReadConnectorDigestV1(contract) !== contract.contractDigest) {
        return denied("POWER_PLATFORM_CONNECTOR_DIGEST_DENIED");
    }
    return {
        outcome: "VERIFIED",
        reasonCodes: ["POWER_PLATFORM_READ_CONNECTOR_VERIFIED"],
        contractDigest: contract.contractDigest,
        operationCount: 5,
        writeOperationCount: 0,
        requestedRightsCount: 0,
        writeTargetCount: 0,
    };
}
