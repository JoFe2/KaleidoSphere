import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
export const BUILDER_AUTHORITY_INPUT_API_VERSION = "chimpmaera.builder/authority-input/v1";
export const BUILDER_AUTHORITY_RESULT_API_VERSION = "chimpmaera.builder/authority-result/v1";
export const BUILDER_AUTHORITY_PROFILES_V1 = [
    "SAFE_GUIDED",
    "CUSTOM",
    "RAMPAGE_FULL_CONTROL_LAB",
];
export const BUILDER_AUTHORITY_PROFILE_REQUESTS_V1 = [
    ...BUILDER_AUTHORITY_PROFILES_V1,
    "RAMPAGE",
    "FULL_CONTROL_LAB",
];
export const BUILDER_RIGHT_EFFECT_CLASSES_V1 = [
    "READ_ONLY",
    "REVERSIBLE_WRITE",
    "IRREVERSIBLE_EFFECT",
    "INSTALL_ACTIVATE",
    "PUBLICATION",
];
export const BUILDER_AUTHORITY_ROUTES_V1 = [
    "AUTO_EXECUTE",
    "OWNER_APPROVAL",
    "DENY",
];
function isRecord(value) {
    return value !== null
        && typeof value === "object"
        && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, expected) {
    return isRecord(value)
        && canonicalJson(Object.keys(value).sort())
            === canonicalJson([...expected].sort());
}
function digest(value) {
    return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
function invalid() {
    throw new Error("BUILDER_AUTHORITY_INPUT_INVALID_DENIED");
}
function isIdentifier(value) {
    return typeof value === "string"
        && /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/.test(value);
}
function assertUniqueReferences(value, registered) {
    if (!Array.isArray(value) || value.some((entry) => !isIdentifier(entry))) {
        return invalid();
    }
    const normalized = [...value].sort();
    if (new Set(normalized).size !== normalized.length)
        return invalid();
    if (normalized.some((entry) => !registered.has(entry)))
        return invalid();
    return normalized;
}
function selectProfile(requested) {
    if (requested === null) {
        return { requested: null, selected: "SAFE_GUIDED", defaulted: true };
    }
    if (!BUILDER_AUTHORITY_PROFILE_REQUESTS_V1.includes(requested))
        return invalid();
    const selected = requested === "RAMPAGE" || requested === "FULL_CONTROL_LAB"
        ? "RAMPAGE_FULL_CONTROL_LAB"
        : requested;
    return {
        requested: requested,
        selected,
        defaulted: false,
    };
}
function normalizeRegisteredRights(value) {
    if (!Array.isArray(value) || value.length === 0)
        return invalid();
    const rights = value.map((entry) => {
        if (!exactKeys(entry, ["effectClass", "rightId"]))
            return invalid();
        if (!isIdentifier(entry.rightId)
            || !BUILDER_RIGHT_EFFECT_CLASSES_V1.includes(entry.effectClass))
            return invalid();
        return {
            rightId: entry.rightId,
            effectClass: entry.effectClass,
        };
    }).sort((left, right) => left.rightId.localeCompare(right.rightId));
    if (new Set(rights.map(({ rightId }) => rightId)).size !== rights.length) {
        return invalid();
    }
    return rights;
}
function normalizeCustomRules(value, registered, profile) {
    if (!Array.isArray(value))
        return invalid();
    const rules = value.map((entry) => {
        if (!exactKeys(entry, ["rightId", "route"]))
            return invalid();
        if (!isIdentifier(entry.rightId)
            || !registered.has(entry.rightId)
            || !["AUTO_EXECUTE", "OWNER_APPROVAL"].includes(entry.route))
            return invalid();
        return {
            rightId: entry.rightId,
            route: entry.route,
        };
    }).sort((left, right) => left.rightId.localeCompare(right.rightId));
    if (new Set(rules.map(({ rightId }) => rightId)).size !== rules.length) {
        return invalid();
    }
    if (profile !== "CUSTOM" && rules.length > 0)
        return invalid();
    return rules;
}
function safeGuidedRoute(effectClass) {
    return effectClass === "READ_ONLY" ? "AUTO_EXECUTE" : "OWNER_APPROVAL";
}
export function resolveBuilderAuthorityV1(input) {
    if (!exactKeys(input, [
        "actor",
        "assignments",
        "currentConstraints",
        "customRules",
        "hostSystemCeiling",
        "registeredRights",
        "requestedProfile",
        "schemaVersion",
        "tenant",
    ]))
        return invalid();
    if (input.schemaVersion !== BUILDER_AUTHORITY_INPUT_API_VERSION
        || !isIdentifier(input.tenant)
        || !isIdentifier(input.actor))
        return invalid();
    const profile = selectProfile(input.requestedProfile);
    const registeredRights = normalizeRegisteredRights(input.registeredRights);
    const registered = new Set(registeredRights.map(({ rightId }) => rightId));
    const hostSystemCeiling = assertUniqueReferences(input.hostSystemCeiling, registered);
    const assignments = assertUniqueReferences(input.assignments, registered);
    const currentConstraints = assertUniqueReferences(input.currentConstraints, registered);
    const customRules = normalizeCustomRules(input.customRules, registered, profile.selected);
    const customByRight = new Map(customRules.map((rule) => [rule.rightId, rule.route]));
    const hostSet = new Set(hostSystemCeiling);
    const assignmentSet = new Set(assignments);
    const constraintSet = new Set(currentConstraints);
    const decisions = registeredRights.map(({ rightId, effectClass }) => {
        const inHostSystemCeiling = hostSet.has(rightId);
        const customRoute = customByRight.get(rightId);
        const inOwnerProfile = profile.selected !== "CUSTOM" || customRoute !== undefined;
        const inAssignments = assignmentSet.has(rightId);
        const inCurrentConstraints = constraintSet.has(rightId);
        const effective = inHostSystemCeiling
            && inOwnerProfile
            && inAssignments
            && inCurrentConstraints;
        const selectedRoute = profile.selected === "SAFE_GUIDED"
            ? safeGuidedRoute(effectClass)
            : profile.selected === "CUSTOM"
                ? customRoute ?? "OWNER_APPROVAL"
                : "AUTO_EXECUTE";
        const route = effective ? selectedRoute : "DENY";
        const reasonFacts = [
            `HOST_SYSTEM_CEILING:${inHostSystemCeiling ? "INCLUDED" : "EXCLUDED"}`,
            `OWNER_PROFILE:${inOwnerProfile ? "INCLUDED" : "EXCLUDED"}`,
            `ASSIGNMENT:${inAssignments ? "INCLUDED" : "EXCLUDED"}`,
            `CURRENT_CONSTRAINT:${inCurrentConstraints ? "INCLUDED" : "EXCLUDED"}`,
            profile.defaulted
                ? "PROFILE:SAFE_GUIDED_DEFAULT"
                : `PROFILE:${profile.selected}`,
            `ROUTE:${route}`,
        ];
        return {
            rightId,
            effectClass,
            inHostSystemCeiling,
            inOwnerProfile,
            inAssignments,
            inCurrentConstraints,
            effective,
            route,
            reasonFacts,
        };
    });
    const normalizedInput = {
        schemaVersion: BUILDER_AUTHORITY_INPUT_API_VERSION,
        tenant: input.tenant,
        actor: input.actor,
        requestedProfile: profile.requested,
        registeredRights,
        hostSystemCeiling,
        assignments,
        currentConstraints,
        customRules,
    };
    const core = {
        schemaVersion: BUILDER_AUTHORITY_RESULT_API_VERSION,
        claim: "DECISION_MATRIX_ONLY_NO_EXECUTABLE_AUTHORITY",
        tenant: normalizedInput.tenant,
        actor: normalizedInput.actor,
        profile,
        formula: "HOST_SYSTEM_CEILING_INTERSECT_OWNER_PROFILE_INTERSECT_ASSIGNMENTS_INTERSECT_CURRENT_CONSTRAINTS",
        inputDigest: digest(normalizedInput),
        decisions,
        effectiveRights: decisions.filter(({ effective }) => effective)
            .map(({ rightId }) => rightId),
        automaticRights: decisions.filter(({ route }) => route === "AUTO_EXECUTE")
            .map(({ rightId }) => rightId),
        ownerApprovalRights: decisions.filter(({ route }) => route === "OWNER_APPROVAL")
            .map(({ rightId }) => rightId),
    };
    return { ...core, resultDigest: digest(core) };
}
export function syntheticBuilderAuthorityInputV1(requestedProfile = null) {
    const registeredRights = [
        { rightId: "zoo.record.read", effectClass: "READ_ONLY" },
        { rightId: "zoo.record.update", effectClass: "REVERSIBLE_WRITE" },
        { rightId: "bundle.publish", effectClass: "PUBLICATION" },
    ];
    return {
        schemaVersion: BUILDER_AUTHORITY_INPUT_API_VERSION,
        tenant: "synthetic-zoo",
        actor: "agent:builder",
        requestedProfile,
        registeredRights,
        hostSystemCeiling: registeredRights.map(({ rightId }) => rightId),
        assignments: registeredRights.map(({ rightId }) => rightId),
        currentConstraints: registeredRights.map(({ rightId }) => rightId),
        customRules: requestedProfile === "CUSTOM"
            ? registeredRights.map(({ rightId }) => ({
                rightId,
                route: "OWNER_APPROVAL",
            }))
            : [],
    };
}
