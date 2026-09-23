import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import { BUILDER_AUTHORITY_INPUT_API_VERSION, resolveBuilderAuthorityV1, } from "./builder-authority.js";
import { BUILDER_CAPABILITY_RESOLUTION_INPUT_API_VERSION, resolveBuilderCapabilitiesV1, } from "./builder-capability-resolution.js";
import { BUILDER_DISCOVERY_INPUT_API_VERSION, discoverBuilderSystemV1, } from "./builder-discovery.js";
export const BUILDER_INTEGRATION_PLAN_INPUT_API_VERSION = "chimpmaera.builder/integration-plan-input/v1";
export const BUILDER_INTEGRATION_PLAN_API_VERSION = "chimpmaera.builder/integration-plan/v1";
export const BUILDER_PLANNED_SYSTEM_MANIFEST_API_VERSION = "chimpmaera.builder/planned-system-manifest/v1";
export const BUILDER_OBJECT_GRAPH_API_VERSION = "chimpmaera.builder/object-dependency-graph/v1";
export const BUILDER_GENERIC_CONTRACT_API_VERSION = "chimpmaera.builder/generic-integration-contract/v1";
export const BUILDER_SCAFFOLD_KINDS_V1 = ["ADAPTER", "SKILL"];
function isRecord(value) {
    return value !== null
        && typeof value === "object"
        && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, expected) {
    return isRecord(value)
        && canonicalJson(Object.keys(value).sort()) === canonicalJson([...expected].sort());
}
function digest(value) {
    return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
function invalid() {
    throw new Error("BUILDER_INTEGRATION_PLAN_INVALID_DENIED");
}
function safeGuidedRoute(effectClass) {
    return effectClass === "READ_ONLY" ? "AUTO_EXECUTE" : "OWNER_APPROVAL";
}
function rollbackStrategy(effectClass) {
    const strategies = {
        READ_ONLY: "NOT_APPLICABLE_READ_ONLY",
        REVERSIBLE_WRITE: "RESTORE_PRIOR_VALUE",
        IRREVERSIBLE_EFFECT: "OWNER_DEFINED_RECOVERY_REQUIRED",
        INSTALL_ACTIVATE: "DEACTIVATE_AND_REMOVE_OWNED_RESIDUE",
        PUBLICATION: "WITHDRAWAL_OR_CORRECTION_REQUIRED",
    };
    return strategies[effectClass];
}
function fixtureMode(effectClass) {
    if (effectClass === "READ_ONLY")
        return "READ_EXPECTATION";
    if (effectClass === "REVERSIBLE_WRITE")
        return "REVERSIBLE_WRITE_ROLLBACK";
    return "EFFECT_RECOVERY_PROBE";
}
function fixtureAssertions(effectClass) {
    if (effectClass === "READ_ONLY") {
        return ["NO_STATE_CHANGE", "BOUNDED_READBACK", "RECEIPT_REQUIRED"];
    }
    if (effectClass === "REVERSIBLE_WRITE") {
        return ["PRIOR_VALUE_CAPTURED", "BOUNDED_READBACK", "ROLLBACK_PROVEN", "RECEIPT_REQUIRED"];
    }
    return ["OWNER_ROUTE_REQUIRED", "RECOVERY_EVIDENCE_REQUIRED", "RECEIPT_REQUIRED"];
}
export function planBuilderIntegrationV1(input) {
    if (!exactKeys(input, [
        "authorityInput",
        "discoveryInput",
        "registeredCapabilities",
        "scaffoldKind",
        "schemaVersion",
    ])
        || input.schemaVersion !== BUILDER_INTEGRATION_PLAN_INPUT_API_VERSION
        || !BUILDER_SCAFFOLD_KINDS_V1.includes(input.scaffoldKind)
        || !isRecord(input.discoveryInput)
        || input.discoveryInput.schemaVersion !== BUILDER_DISCOVERY_INPUT_API_VERSION
        || !isRecord(input.authorityInput)
        || input.authorityInput.schemaVersion !== BUILDER_AUTHORITY_INPUT_API_VERSION
        || !Array.isArray(input.registeredCapabilities))
        return invalid();
    const discoveryInput = input.discoveryInput;
    const registeredCapabilities = input.registeredCapabilities;
    const authorityInput = input.authorityInput;
    const scaffoldKind = input.scaffoldKind;
    const discovery = discoverBuilderSystemV1(discoveryInput);
    const capabilityResolution = resolveBuilderCapabilitiesV1({
        schemaVersion: BUILDER_CAPABILITY_RESOLUTION_INPUT_API_VERSION,
        discovery,
        registeredCapabilities,
    });
    const authority = resolveBuilderAuthorityV1(authorityInput);
    if (authority.tenant !== discovery.tenant
        || authority.actor !== discovery.actor
        || capabilityResolution.tenant !== discovery.tenant
        || capabilityResolution.systemId !== discovery.system.systemId
        || capabilityResolution.discoveryRecordDigest !== discovery.recordDigest)
        return invalid();
    const operationsById = new Map(discovery.discoveredOperations.map((operation) => [operation.operationId, operation]));
    if (authority.decisions.length !== operationsById.size
        || authority.decisions.some((decision) => {
            const operation = operationsById.get(decision.rightId);
            return operation === undefined || operation.effectClass !== decision.effectClass;
        }))
        return invalid();
    const systemManifestCore = {
        schemaVersion: BUILDER_PLANNED_SYSTEM_MANIFEST_API_VERSION,
        sourceManifestId: discovery.system.manifestId,
        sourceManifestDigest: discovery.sourceDigests.manifest,
        tenant: discovery.tenant,
        systemId: discovery.system.systemId,
        systemType: discovery.system.systemType,
        dataClassification: "SYNTHETIC",
        objectTypes: discovery.discoveredObjects.map(({ objectType }) => objectType).sort(),
        operationIds: discovery.discoveredOperations.map(({ operationId }) => operationId).sort(),
    };
    const systemManifest = {
        ...systemManifestCore,
        manifestDigest: digest(systemManifestCore),
    };
    const graphCore = {
        schemaVersion: BUILDER_OBJECT_GRAPH_API_VERSION,
        nodes: discovery.discoveredObjects.map(({ objectType, description }) => ({
            objectType,
            description,
        })).sort((left, right) => left.objectType.localeCompare(right.objectType)),
        edges: discovery.discoveredObjects.flatMap(({ objectType, dependencyObjectTypes }) => dependencyObjectTypes.map((toDependencyObjectType) => ({
            fromObjectType: objectType,
            toDependencyObjectType,
        }))).sort((left, right) => `${left.fromObjectType}:${left.toDependencyObjectType}`.localeCompare(`${right.fromObjectType}:${right.toDependencyObjectType}`)),
    };
    const objectDependencyGraph = {
        ...graphCore,
        graphDigest: digest(graphCore),
    };
    const reusedByOperation = new Map(capabilityResolution.reusedCapabilities.map((entry) => [entry.operationId, entry]));
    const unresolvedByOperation = new Map(capabilityResolution.unresolvedIntents.map((entry) => [entry.operationId, entry]));
    const templateId = scaffoldKind === "ADAPTER"
        ? "chimpmaera.builder/generic-adapter-contract/v1"
        : "chimpmaera.builder/generic-skill-contract/v1";
    const integrationContracts = discovery.discoveredOperations.map((operation) => {
        const reused = reusedByOperation.get(operation.operationId);
        const unresolved = unresolvedByOperation.get(operation.operationId);
        if ((reused === undefined) === (unresolved === undefined))
            return invalid();
        const capabilityState = reused === undefined
            ? "UNRESOLVED_INTENT"
            : "REUSE_REGISTERED";
        const capabilityRef = reused?.capabilityId ?? unresolved?.proposalId;
        if (capabilityRef === undefined)
            return invalid();
        const capabilityBindingDigest = reused?.descriptorDigest ?? digest(unresolved);
        const contractSeed = {
            discoveryRecordDigest: discovery.recordDigest,
            operationId: operation.operationId,
            scaffoldKind,
            capabilityRef,
            capabilityBindingDigest,
        };
        return {
            schemaVersion: BUILDER_GENERIC_CONTRACT_API_VERSION,
            contractId: `contract:${digest(contractSeed).slice(0, 24)}`,
            templateId,
            scaffoldKind,
            operationId: operation.operationId,
            objectType: operation.objectType,
            effectClass: operation.effectClass,
            capabilityState,
            capabilityRef,
            capabilityBindingDigest,
            lifecycleState: "INACTIVE",
            executable: false,
            authorityGranted: false,
            effectAuthorized: false,
        };
    }).sort((left, right) => left.operationId.localeCompare(right.operationId));
    const profileDiff = {
        selectedProfile: authority.profile.selected,
        entries: authority.decisions.map((decision) => {
            const baseline = safeGuidedRoute(decision.effectClass);
            return {
                rightId: decision.rightId,
                effectClass: decision.effectClass,
                safeGuidedRoute: baseline,
                selectedRoute: decision.route,
                changedFromSafeGuided: decision.route !== baseline,
                effective: decision.effective,
                reasonFacts: decision.reasonFacts,
            };
        }).sort((left, right) => left.rightId.localeCompare(right.rightId)),
    };
    const fixtures = discovery.discoveredOperations.map((operation) => ({
        fixtureId: `fixture:${digest({
            discoveryRecordDigest: discovery.recordDigest,
            operationId: operation.operationId,
        }).slice(0, 24)}`,
        operationId: operation.operationId,
        dataClassification: "SYNTHETIC",
        mode: fixtureMode(operation.effectClass),
        assertions: fixtureAssertions(operation.effectClass),
    })).sort((left, right) => left.operationId.localeCompare(right.operationId));
    const contextsById = new Map(discovery.selectedContexts.map((context) => [context.contextId, context]));
    const rollbackPlan = discovery.discoveredOperations.map((operation) => {
        const contextRefs = operation.contextRefs.filter((reference) => {
            const kind = contextsById.get(reference)?.kind;
            return kind === "ROLLBACK" || kind === "SAFETY";
        }).sort();
        return {
            operationId: operation.operationId,
            requiredBeforeActivation: operation.effectClass !== "READ_ONLY",
            strategy: rollbackStrategy(operation.effectClass),
            contextRefs,
            successEvidence: operation.effectClass === "READ_ONLY"
                ? ["NO_STATE_CHANGE", "READ_RECEIPT"]
                : ["PRIOR_VALUE", "POST_WRITE_READBACK", "ROLLBACK_READBACK", "EFFECT_RECEIPT"],
        };
    }).sort((left, right) => left.operationId.localeCompare(right.operationId));
    const inputBinding = {
        schemaVersion: BUILDER_INTEGRATION_PLAN_INPUT_API_VERSION,
        discoveryRecordDigest: discovery.recordDigest,
        capabilityResolutionDigest: capabilityResolution.resultDigest,
        authorityResultDigest: authority.resultDigest,
        scaffoldKind,
    };
    const core = {
        schemaVersion: BUILDER_INTEGRATION_PLAN_API_VERSION,
        claim: "DATA_ONLY_GENERIC_PLAN_NO_AUTHORITY_EFFECT_ACTIVATION_OR_PUBLICATION",
        tenant: discovery.tenant,
        systemId: discovery.system.systemId,
        systemType: discovery.system.systemType,
        planningStatus: capabilityResolution.unresolvedIntents.length > 0
            ? "PREPARATION_REQUIRED"
            : "READY_FOR_QUALITY_GATE",
        sourceBindings: {
            discoveryRecordDigest: discovery.recordDigest,
            capabilityResolutionDigest: capabilityResolution.resultDigest,
            authorityResultDigest: authority.resultDigest,
        },
        systemManifest,
        objectDependencyGraph,
        integrationContracts,
        profileDiff,
        fixtures,
        rollbackPlan,
        inputDigest: digest(inputBinding),
    };
    return { ...core, planDigest: digest(core) };
}
export function verifyBuilderIntegrationPlanV1(value) {
    if (!exactKeys(value, [
        "claim",
        "fixtures",
        "inputDigest",
        "integrationContracts",
        "objectDependencyGraph",
        "planDigest",
        "planningStatus",
        "profileDiff",
        "rollbackPlan",
        "schemaVersion",
        "sourceBindings",
        "systemId",
        "systemManifest",
        "systemType",
        "tenant",
    ]))
        return invalid();
    const { planDigest, ...core } = value;
    if (value.schemaVersion !== BUILDER_INTEGRATION_PLAN_API_VERSION
        || value.claim !== "DATA_ONLY_GENERIC_PLAN_NO_AUTHORITY_EFFECT_ACTIVATION_OR_PUBLICATION"
        || typeof planDigest !== "string"
        || !/^[a-f0-9]{64}$/.test(planDigest)
        || digest(core) !== planDigest)
        return invalid();
    const serialized = canonicalJson(value);
    for (const forbidden of [
        "credentialHandle", "credentialValue", "rawPayload", "providerCall",
        "effectCallback", "activationToken", "approvalToken", "executableCode",
        "customerScript",
    ])
        if (serialized.includes(`\"${forbidden}\"`))
            return invalid();
    return value;
}
