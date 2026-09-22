import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import { listCapabilityCatalogueV1, syntheticCapabilityCatalogueV1, verifyCapabilityCatalogueV1, } from "./capability-catalogue.js";
import { compileEffectiveRightsV1, EFFECTIVE_RIGHTS_INPUT_API_VERSION, } from "./effective-rights.js";
import { evaluateIntegrationProfileV1, } from "./integration-profile.js";
import { resolveBuilderAuthorityV1, BUILDER_AUTHORITY_INPUT_API_VERSION, } from "./builder-authority.js";
import { analyseSkillAdmissionV1, decideSkillAdmissionV1, syntheticSkillPolicyV1, syntheticSkillRequestV1, validateSkillAdmissionRequestV1, computeSkillPackageDigestV1, } from "./skill-admission.js";
export const PAN441_PROFILE_SCHEMA_V1 = "pan441.security/employee-agent-profile/v1";
export const PAN441_PROFILE_VERSION_V1 = "1.0.0";
export const PAN441_PROFILE_ID_V1 = "profile:pan441-employee-assistant-read-only";
export const PAN441_READ_CAPABILITY_ID_V1 = "capability:employee.directory.read.own";
export const PAN441_READ_CAPABILITY_VERSION_V1 = "1.0.0";
export const PAN441_READ_ACTION_V1 = "employee.directory.read_own";
export const PAN441_READ_RESOURCE_V1 = "employee.directory.own";
export const PAN441_READ_EFFECT_V1 = "READ";
export const PAN441_READ_PURPOSE_V1 = "employee.business.help";
export const PAN441_TENANT_V1 = "tenant:panskys-zoo";
export const PAN441_INTEGRATION_PROFILE_ID_V1 = "integration:power-apps-read-only";
export const PAN441_INTEGRATION_PROFILE_DIGEST_V1 = "0e1adf84868e8f36cf315ddba12f5470c81a8dfb7cc9da735c06062513a84a21";
export const PAN441_CATALOGUE_ID_V1 = "chimpmaera.local/synthetic-actions";
export const PAN441_CATALOGUE_VERSION_V1 = "1.0.0";
export const PAN441_ALLOWED_FIELDS_V1 = Object.freeze([
    "displayName",
    "department",
    "jobTitle",
    "employeeAlias",
]);
export const PAN441_CRITICAL_IDENTITY_FIELDS_V1 = Object.freeze([
    "nationalId",
    "dateOfBirth",
    "homeAddress",
    "personalEmail",
    "personalPhone",
    "bankAccount",
    "identityDocument",
    "credentials",
]);
export const PAN441_DENIED_OPERATIONS_V1 = Object.freeze([
    "employee.directory.write",
    "employee.directory.create",
    "employee.directory.update",
    "employee.directory.delete",
    "employee.directory.export",
]);
const CLAIM_BOUNDARY = "LOCAL_SYNTHETIC_OWN_SCOPE_READ_ONLY_NO_PROVIDER_NO_CREDENTIAL_NO_WRITE";
const PROFILE_CORE_KEYS = [
    "allowedFields", "authorityProfile", "capability", "catalogue", "claimBoundary",
    "deniedCriticalIdentityFields", "deniedOperations", "integrationProfile", "lifecycle",
    "profileId", "schemaVersion", "skill", "tenant", "version",
];
const IDENTITY_KEYS = ["authenticated", "permissions", "profileGeneration", "profileId", "tenant", "userId"];
const REQUEST_KEYS = ["capabilityId", "capabilityVersion", "fields", "operation", "targetUserId"];
const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const digest = (value) => sha256(canonicalJson(value));
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, keys) {
    return isRecord(value) && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}
function isId(value, prefix) {
    return typeof value === "string" && new RegExp(`^${prefix}:[a-z0-9][a-z0-9._-]{2,80}$`).test(value);
}
function isDigest(value) { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function frozen(value) {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
        for (const child of Object.values(value))
            frozen(child);
        Object.freeze(value);
    }
    return value;
}
function profileCore(profile) {
    const { profileDigest: _ignored, ...core } = profile;
    return core;
}
function employeeSkillRequestV1() {
    const base = syntheticSkillRequestV1({ operationId: "operation:pan441-skill-admission-0001" });
    const content = "# Employee Business Help\n\nRead only the authenticated employee's bounded directory projection.\n";
    const files = [{ ...base.files[0], content, digest: sha256(content) }];
    const manifest = {
        ...base.manifest,
        id: "skill:employee-business-help",
        displayName: "Employee Business Help",
    };
    const packageDigest = computeSkillPackageDigestV1({ manifest, files });
    return {
        ...base,
        source: { ...base.source, locator: `skill+sha256:${packageDigest}`, digest: packageDigest },
        manifest,
        files,
    };
}
const skillRequest = employeeSkillRequestV1();
const skillPackageDigest = skillRequest.source.digest;
const releasedCatalogue = syntheticCapabilityCatalogueV1();
const selectedCatalogueAction = releasedCatalogue.actions.find(({ actionId }) => actionId === PAN441_READ_ACTION_V1);
if (selectedCatalogueAction === undefined)
    throw new Error("PAN441_SELECTED_CATALOGUE_ACTION_MISSING");
const capabilityCore = {
    capabilityId: PAN441_READ_CAPABILITY_ID_V1,
    version: PAN441_READ_CAPABILITY_VERSION_V1,
    action: PAN441_READ_ACTION_V1,
    resource: PAN441_READ_RESOURCE_V1,
    effect: PAN441_READ_EFFECT_V1,
    purpose: PAN441_READ_PURPOSE_V1,
    scope: "OWN_REQUESTING_USER",
    catalogueActionDigest: selectedCatalogueAction.digest,
};
const capability = { ...capabilityCore, digest: digest(capabilityCore) };
const profileCoreValue = {
    schemaVersion: PAN441_PROFILE_SCHEMA_V1,
    profileId: PAN441_PROFILE_ID_V1,
    version: PAN441_PROFILE_VERSION_V1,
    tenant: PAN441_TENANT_V1,
    authorityProfile: "SAFE_GUIDED",
    integrationProfile: { profileId: PAN441_INTEGRATION_PROFILE_ID_V1, profileDigest: PAN441_INTEGRATION_PROFILE_DIGEST_V1 },
    catalogue: { catalogueId: PAN441_CATALOGUE_ID_V1, version: PAN441_CATALOGUE_VERSION_V1, catalogueDigest: releasedCatalogue.digest, activationDefault: "INACTIVE" },
    capability,
    allowedFields: [...PAN441_ALLOWED_FIELDS_V1],
    deniedCriticalIdentityFields: [...PAN441_CRITICAL_IDENTITY_FIELDS_V1],
    deniedOperations: [...PAN441_DENIED_OPERATIONS_V1],
    skill: { skillId: "skill:employee-business-help", version: "1.0.0", packageDigest: skillPackageDigest },
    lifecycle: {
        storage: "NO_RUNTIME_STORAGE",
        migration: "PRESERVE_OLD_READER_UNTIL_REPLACEMENT_READBACK",
        rollback: "DENY_UNTIL_FIXED_PROFILE_READBACK",
    },
    claimBoundary: CLAIM_BOUNDARY,
};
const RELEASED_PROFILE = frozen({
    ...profileCoreValue,
    profileDigest: digest(profileCoreValue),
});
const NARROW_REPLACEMENT_CORE = {
    ...profileCoreValue,
    allowedFields: ["displayName"],
};
const NARROW_REPLACEMENT_PROFILE = frozen({
    ...NARROW_REPLACEMENT_CORE,
    profileDigest: digest(NARROW_REPLACEMENT_CORE),
});
const TRUSTED_PROFILES = [RELEASED_PROFILE, NARROW_REPLACEMENT_PROFILE];
export const PAN441_EMPLOYEE_FIXTURE_V1 = frozen([
    {
        userId: "user:alice-example",
        displayName: "Alex Example",
        department: "Operations",
        jobTitle: "Coordinator",
        employeeAlias: "alex.example",
        nationalId: "SYNTHETIC-REDACTED-001",
        personalEmail: "alex.private@example.test",
    },
    {
        userId: "user:bob-example",
        displayName: "Blair Example",
        department: "Finance",
        jobTitle: "Analyst",
        employeeAlias: "blair.example",
        nationalId: "SYNTHETIC-REDACTED-002",
        personalEmail: "blair.private@example.test",
    },
]);
export function pan441EmployeeProfileV1() { return RELEASED_PROFILE; }
export function pan441NarrowProfileReplacementV1() { return NARROW_REPLACEMENT_PROFILE; }
export function pan441SkillRequestV1() { return structuredClone(skillRequest); }
export function pan441CapabilityDigestV1() { return capability.digest; }
export function verifyPan441ProfileV1(value) {
    if (!exactKeys(value, [...PROFILE_CORE_KEYS, "profileDigest"]))
        throw new Error("PAN441_PROFILE_SCHEMA_DENIED");
    const candidate = value;
    if (!isDigest(candidate.profileDigest))
        throw new Error("PAN441_PROFILE_NOT_RELEASED_DENIED");
    const trusted = TRUSTED_PROFILES.find((pinned) => canonicalJson(candidate) === canonicalJson(pinned));
    if (trusted === undefined)
        throw new Error("PAN441_PROFILE_NOT_RELEASED_DENIED");
    return trusted;
}
function deny(reasonCodes, context = {}) {
    const core = {
        schemaVersion: "pan441.security/employee-agent-decision/v1",
        outcome: "DENY",
        reasonCodes: [...new Set(reasonCodes)].sort(),
        profileId: context.profileId ?? null,
        profileDigest: context.profileDigest ?? null,
        userId: context.userId ?? null,
        targetUserId: context.targetUserId ?? null,
        projectedRecord: null,
        builderDecisionDigest: null,
        effectiveRightsDigest: null,
        skillRequestDigest: context.skillRequestDigest ?? null,
        claimBoundary: CLAIM_BOUNDARY,
    };
    return { ...core, decisionDigest: digest(core) };
}
function builderInput(profile, identity) {
    const registeredRights = [
        { rightId: profile.capability.action, effectClass: "READ_ONLY" },
        ...profile.deniedOperations.map((rightId) => ({ rightId, effectClass: "REVERSIBLE_WRITE" })),
    ];
    const selectedRight = profile.capability.action;
    return {
        schemaVersion: BUILDER_AUTHORITY_INPUT_API_VERSION,
        tenant: identity.tenant,
        actor: identity.userId,
        requestedProfile: "SAFE_GUIDED",
        registeredRights,
        hostSystemCeiling: registeredRights.map(({ rightId }) => rightId),
        assignments: [selectedRight],
        currentConstraints: [selectedRight],
        customRules: [],
    };
}
function effectiveRightsInput(profile, identity, selectedAction, requestedFields) {
    const base = {
        tenant: identity.tenant,
        actor: identity.userId,
        profileId: profile.profileId,
        profileGeneration: identity.profileGeneration,
    };
    const profileScope = {
        actions: [selectedAction.actionId],
        resources: [selectedAction.resource],
        fields: [...profile.allowedFields],
        purposes: [profile.capability.purpose],
        effects: [profile.capability.effect],
    };
    const requestedScope = {
        ...profileScope,
        fields: [...requestedFields],
    };
    const scopes = { PROFILE: profileScope, ASSIGNMENT: requestedScope, CAPABILITY: profileScope, CONSTRAINT: requestedScope };
    return {
        schemaVersion: EFFECTIVE_RIGHTS_INPUT_API_VERSION,
        actor: identity.userId,
        tenant: identity.tenant,
        operands: ["PROFILE", "ASSIGNMENT", "CAPABILITY", "CONSTRAINT"].map((kind, index) => ({
            kind: kind,
            operandId: `pan441.${kind.toLowerCase()}.v1`,
            ...base,
            generation: index + 1,
            decisionCeiling: "ALLOW",
            scope: scopes[kind],
        })),
    };
}
export function authorizePan441EmployeeReadV1(profileValue, integrationProfileValue, identityValue, requestValue, skillRequestValue = skillRequest) {
    let profile;
    try {
        profile = verifyPan441ProfileV1(profileValue);
    }
    catch (error) {
        return deny([error instanceof Error ? error.message : "PAN441_PROFILE_SCHEMA_DENIED"]);
    }
    const context = { profileId: profile.profileId, profileDigest: profile.profileDigest };
    if (!exactKeys(identityValue, IDENTITY_KEYS))
        return deny(["IDENTITY_MISSING_DENIED"], context);
    const identity = identityValue;
    if (identity.authenticated !== true || identity.tenant !== PAN441_TENANT_V1 || identity.profileId !== PAN441_PROFILE_ID_V1
        || identity.profileGeneration !== 1 || !isId(identity.userId, "user") || !Array.isArray(identity.permissions)) {
        return deny(["IDENTITY_INVALID_DENIED"], context);
    }
    if (!identity.permissions.includes(PAN441_READ_CAPABILITY_ID_V1)) {
        return deny(["PERMISSION_MISSING_DENIED"], { ...context, userId: identity.userId });
    }
    if (!exactKeys(requestValue, REQUEST_KEYS)) {
        return deny(["REQUEST_SCHEMA_DENIED"], { ...context, userId: identity.userId });
    }
    const request = requestValue;
    const requestContext = { ...context, userId: identity.userId, targetUserId: request.targetUserId };
    if (request.operation !== profile.capability.action || profile.deniedOperations.includes(request.operation)) {
        return deny(["WRITE_DENIED"], requestContext);
    }
    if (!isId(request.targetUserId, "user") || request.targetUserId !== identity.userId) {
        return deny(["OWN_SCOPE_DENIED"], requestContext);
    }
    if (request.capabilityId !== profile.capability.capabilityId || request.capabilityVersion !== profile.capability.version) {
        return deny(["CAPABILITY_UNAVAILABLE_DENIED"], requestContext);
    }
    if (!Array.isArray(request.fields) || request.fields.length === 0 || request.fields.some((field) => !profile.allowedFields.includes(field))) {
        const critical = Array.isArray(request.fields) && request.fields.some((field) => profile.deniedCriticalIdentityFields.includes(field));
        return deny([critical ? "CRITICAL_IDENTITY_DENIED" : "FIELD_SCOPE_DENIED"], requestContext);
    }
    const integrationDecision = evaluateIntegrationProfileV1(integrationProfileValue);
    if (integrationDecision.outcome !== "CONFORMANT"
        || integrationDecision.profileDigest !== PAN441_INTEGRATION_PROFILE_DIGEST_V1) {
        return deny(["INTEGRATION_PROFILE_DENIED"], requestContext);
    }
    const integration = integrationProfileValue;
    if (integration.identity.profileId !== PAN441_INTEGRATION_PROFILE_ID_V1) {
        return deny(["INTEGRATION_PROFILE_DENIED"], requestContext);
    }
    const skillValidation = validateSkillAdmissionRequestV1(skillRequestValue);
    if (skillValidation.outcome !== "ALLOW")
        return deny(["SKILL_ADMISSION_DENIED"], requestContext);
    const skillPolicy = syntheticSkillPolicyV1();
    const report = analyseSkillAdmissionV1(skillValidation.request, skillPolicy);
    const skillDecision = decideSkillAdmissionV1(skillValidation.request, report, "SAFE_GUIDED", skillPolicy);
    if (!skillDecision.installAuthorized || skillDecision.activationAuthorized
        || skillValidation.request.manifest.id !== profile.skill.skillId
        || skillValidation.request.manifest.version !== profile.skill.version
        || skillValidation.request.source.version !== profile.skill.version
        || skillValidation.packageDigest !== profile.skill.packageDigest) {
        return deny(["SKILL_ADMISSION_DENIED"], { ...requestContext, skillRequestDigest: skillValidation.requestDigest });
    }
    let catalogue;
    try {
        catalogue = verifyCapabilityCatalogueV1(syntheticCapabilityCatalogueV1());
    }
    catch {
        return deny(["CATALOGUE_DENIED"], { ...requestContext, skillRequestDigest: skillValidation.requestDigest });
    }
    const catalogueView = listCapabilityCatalogueV1(catalogue);
    const selectedAction = catalogue.actions.find(({ actionId }) => actionId === profile.capability.action);
    if (catalogueView.catalogueVersion !== profile.catalogue.version
        || catalogueView.catalogueDigest === null
        || catalogueView.catalogueDigest !== profile.catalogue.catalogueDigest
        || catalogueView.activationAuthority
        || catalogueView.executionAuthority
        || selectedAction === undefined
        || selectedAction.version !== profile.capability.version
        || selectedAction.resource !== profile.capability.resource
        || selectedAction.digest !== profile.capability.catalogueActionDigest
        || profile.catalogue.catalogueId !== PAN441_CATALOGUE_ID_V1) {
        return deny(["CATALOGUE_DENIED"], { ...requestContext, skillRequestDigest: skillValidation.requestDigest });
    }
    const builder = resolveBuilderAuthorityV1(builderInput(profile, identity));
    const builderDecision = builder.decisions.find(({ rightId }) => rightId === profile.capability.action);
    if (builderDecision?.effective !== true || builderDecision.route !== "AUTO_EXECUTE") {
        return deny(["AUTHORIZATION_DENIED"], { ...requestContext, skillRequestDigest: skillValidation.requestDigest });
    }
    const rights = compileEffectiveRightsV1(effectiveRightsInput(profile, identity, selectedAction, request.fields));
    if (rights.outcome !== "ALLOW"
        || !rights.effectiveScope.actions.includes(profile.capability.action)
        || !rights.effectiveScope.resources.includes(profile.capability.resource)
        || !request.fields.every((field) => rights.effectiveScope.fields.includes(field))) {
        return deny(["AUTHORIZATION_DENIED"], { ...requestContext, skillRequestDigest: skillValidation.requestDigest });
    }
    const record = PAN441_EMPLOYEE_FIXTURE_V1.find(({ userId }) => userId === identity.userId);
    if (record === undefined)
        return deny(["RECORD_NOT_FOUND_DENIED"], requestContext);
    const projectedRecord = Object.fromEntries(request.fields.map((field) => [field, record[field]]));
    const core = {
        schemaVersion: "pan441.security/employee-agent-decision/v1",
        outcome: "ALLOW",
        reasonCodes: ["OWN_SCOPE_READ_ALLOWED"],
        profileId: profile.profileId,
        profileDigest: profile.profileDigest,
        userId: identity.userId,
        targetUserId: request.targetUserId,
        projectedRecord,
        builderDecisionDigest: builder.resultDigest,
        effectiveRightsDigest: rights.resultDigest,
        skillRequestDigest: skillValidation.requestDigest,
        claimBoundary: CLAIM_BOUNDARY,
    };
    return { ...core, decisionDigest: digest(core) };
}
