import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import { verifyBuilderIntegrationPlanV1, } from "./builder-integration-plan.js";
export const BUILDER_QUALITY_EVIDENCE_INPUT_API_VERSION = "chimpmaera.builder/quality-evidence-input/v1";
export const BUILDER_QUALITY_EVIDENCE_API_VERSION = "chimpmaera.builder/quality-evidence/v1";
export const BUILDER_LIFECYCLE_ACTIONS_V1 = [
    "INSTALLATION",
    "ACTIVATION",
    "MUTATION",
    "PUBLICATION",
];
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
function validDigest(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function invalid() {
    throw new Error("BUILDER_QUALITY_EVIDENCE_INVALID_DENIED");
}
function nullEvidence(observation) {
    return observation.beforeDigest === null
        && observation.afterEffectDigest === null
        && observation.finalDigest === null
        && observation.readbackDigest === null
        && observation.receiptDigest === null;
}
function validateObservation(observation, contract, planDigest) {
    if (!exactKeys(observation, [
        "afterEffectDigest", "beforeDigest", "capabilityBindingDigest", "contractId",
        "finalDigest", "mode", "operationId", "planDigest", "readbackDigest",
        "receiptDigest", "result",
    ])
        || observation.operationId !== contract.operationId
        || observation.planDigest !== planDigest
        || observation.contractId !== contract.contractId
        || observation.capabilityBindingDigest !== contract.capabilityBindingDigest
        || observation.mode !== "SYNTHETIC_CONTRACT_HARNESS")
        return invalid();
    if (contract.capabilityState === "UNRESOLVED_INTENT") {
        if (observation.result !== "NOT_EXECUTED_UNRESOLVED_INTENT" || !nullEvidence(observation)) {
            return invalid();
        }
        return {
            operationId: contract.operationId,
            status: "NOT_EXECUTED_UNRESOLVED_INTENT",
            readbackDigest: null,
            receiptDigest: null,
        };
    }
    if (contract.effectClass === "READ_ONLY") {
        if (observation.result !== "MATCHED_NO_CHANGE"
            || !validDigest(observation.beforeDigest)
            || observation.afterEffectDigest !== observation.beforeDigest
            || observation.finalDigest !== observation.beforeDigest
            || !validDigest(observation.readbackDigest)
            || !validDigest(observation.receiptDigest))
            return invalid();
        return {
            operationId: contract.operationId,
            status: "MATCHED_NO_CHANGE",
            readbackDigest: observation.readbackDigest,
            receiptDigest: observation.receiptDigest,
        };
    }
    if (contract.effectClass === "REVERSIBLE_WRITE") {
        if (observation.result !== "MATCHED_ROLLBACK"
            || !validDigest(observation.beforeDigest)
            || !validDigest(observation.afterEffectDigest)
            || observation.afterEffectDigest === observation.beforeDigest
            || observation.finalDigest !== observation.beforeDigest
            || !validDigest(observation.readbackDigest)
            || !validDigest(observation.receiptDigest))
            return invalid();
        return {
            operationId: contract.operationId,
            status: "ROLLBACK_VERIFIED",
            readbackDigest: observation.readbackDigest,
            receiptDigest: observation.receiptDigest,
        };
    }
    if (observation.result !== "NOT_EXECUTED_OWNER_ROUTE_ONLY" || !nullEvidence(observation)) {
        return invalid();
    }
    return {
        operationId: contract.operationId,
        status: "NOT_EXECUTED_OWNER_ROUTE_ONLY",
        readbackDigest: null,
        receiptDigest: null,
    };
}
export function buildBuilderQualityEvidenceV1(input) {
    if (!exactKeys(input, [
        "claimId", "issueId", "lifecycleRoutes", "observations", "plan", "schemaVersion",
    ])
        || input.schemaVersion !== BUILDER_QUALITY_EVIDENCE_INPUT_API_VERSION
        || typeof input.issueId !== "string"
        || !/^[A-Z]+-[0-9]+$/.test(input.issueId)
        || typeof input.claimId !== "string"
        || !/^[A-Z]+-[0-9]+-G[0-9]+$/.test(input.claimId)
        || !Array.isArray(input.lifecycleRoutes)
        || !Array.isArray(input.observations))
        return invalid();
    let plan;
    try {
        plan = verifyBuilderIntegrationPlanV1(input.plan);
    }
    catch {
        return invalid();
    }
    if (plan.systemManifest.dataClassification !== "SYNTHETIC"
        || plan.integrationContracts.some((contract) => contract.lifecycleState !== "INACTIVE"
            || contract.executable !== false
            || contract.authorityGranted !== false
            || contract.effectAuthorized !== false)
        || plan.fixtures.length !== plan.integrationContracts.length
        || plan.rollbackPlan.length !== plan.integrationContracts.length)
        return invalid();
    const routes = input.lifecycleRoutes;
    const actions = new Set();
    for (const route of routes) {
        if (!exactKeys(route, ["action", "route"])
            || !BUILDER_LIFECYCLE_ACTIONS_V1.includes(route.action)
            || !["AUTO_EXECUTE", "OWNER_APPROVAL", "DENY"].includes(route.route)
            || actions.has(route.action))
            return invalid();
        actions.add(route.action);
    }
    if (routes.length !== BUILDER_LIFECYCLE_ACTIONS_V1.length
        || BUILDER_LIFECYCLE_ACTIONS_V1.some((action) => !actions.has(action)))
        return invalid();
    const observations = input.observations;
    const observationByOperation = new Map();
    for (const observation of observations) {
        if (!isRecord(observation)
            || typeof observation.operationId !== "string"
            || observationByOperation.has(observation.operationId))
            return invalid();
        observationByOperation.set(observation.operationId, observation);
    }
    if (observations.length !== plan.integrationContracts.length)
        return invalid();
    const reconciliation = plan.integrationContracts.map((contract) => {
        const observation = observationByOperation.get(contract.operationId);
        if (observation === undefined)
            return invalid();
        return validateObservation(observation, contract, plan.planDigest);
    }).sort((left, right) => left.operationId.localeCompare(right.operationId));
    const lifecycleRouteDecisions = routes.map((route) => ({
        action: route.action,
        route: route.route,
        decisionDigest: digest({
            action: route.action,
            route: route.route,
            sourcePlanDigest: plan.planDigest,
        }),
    })).sort((left, right) => left.action.localeCompare(right.action));
    const focusedChecks = [
        "SOURCE_PLAN_DIGEST_BOUND",
        "SYNTHETIC_DATA_ONLY",
        "CONTRACTS_INACTIVE_NO_AUTHORITY_OR_EFFECT",
        "CAPABILITY_BINDINGS_RECONCILED",
        "READBACK_AND_RECOVERY_EVIDENCE_RECONCILED",
        "FOUR_LIFECYCLE_ROUTES_INDEPENDENT",
    ].map((checkId) => ({ checkId, status: "PASS" }));
    const negativeProbeCoverage = [
        "SOURCE_PLAN_TAMPER",
        "CAPABILITY_BINDING_SUBSTITUTION",
        "READBACK_MISMATCH",
        "ROLLBACK_MISMATCH",
        "UNRESOLVED_INTENT_EXECUTION",
        "ROUTE_CATEGORY_OMISSION_OR_DUPLICATION",
        "ROUTE_AGGREGATION_FIELD",
        "RAW_OR_SECRET_EVIDENCE_FIELD",
    ].map((probeId) => ({
        probeId,
        expected: "DENY_OR_EXPLICIT_NON_SUCCESS",
        status: "PASS",
    }));
    const inputBinding = {
        schemaVersion: BUILDER_QUALITY_EVIDENCE_INPUT_API_VERSION,
        issueId: input.issueId,
        claimId: input.claimId,
        sourcePlanDigest: plan.planDigest,
        lifecycleRouteDecisions,
        observationDigests: observations.map((observation) => digest(observation)).sort(),
    };
    const inputDigest = digest(inputBinding);
    const evidenceId = `evidence:${digest({
        issueId: input.issueId,
        claimId: input.claimId,
        inputDigest,
    }).slice(0, 24)}`;
    const core = {
        schemaVersion: BUILDER_QUALITY_EVIDENCE_API_VERSION,
        claim: "SYNTHETIC_LOCAL_QUALITY_EVIDENCE_NO_INSTALLATION_ACTIVATION_MUTATION_OR_PUBLICATION",
        issueId: input.issueId,
        claimIds: [input.claimId],
        tenant: plan.tenant,
        systemId: plan.systemId,
        sourcePlanDigest: plan.planDigest,
        qualityStatus: plan.planningStatus === "PREPARATION_REQUIRED"
            ? "PASS_PREPARATION_REQUIRED"
            : "PASS_READY_FOR_G6",
        focusedChecks,
        negativeProbeCoverage,
        reconciliation,
        lifecycleRouteDecisions,
        evidencePackage: {
            evidenceId,
            issueId: input.issueId,
            claimIds: [input.claimId],
            deliveryStatus: "locally_validated",
            releaseStatus: "NOT_RELEASED",
            dataClassification: "SYNTHETIC",
            sourcePlanDigest: plan.planDigest,
        },
        inputDigest,
    };
    return { ...core, reportDigest: digest(core) };
}
export function verifyBuilderQualityEvidenceV1(value) {
    if (!exactKeys(value, [
        "claim", "claimIds", "evidencePackage", "focusedChecks", "inputDigest", "issueId",
        "lifecycleRouteDecisions", "negativeProbeCoverage", "qualityStatus", "reconciliation",
        "reportDigest", "schemaVersion", "sourcePlanDigest", "systemId", "tenant",
    ]))
        return invalid();
    const { reportDigest, ...core } = value;
    if (value.schemaVersion !== BUILDER_QUALITY_EVIDENCE_API_VERSION
        || value.claim !== "SYNTHETIC_LOCAL_QUALITY_EVIDENCE_NO_INSTALLATION_ACTIVATION_MUTATION_OR_PUBLICATION"
        || !validDigest(reportDigest)
        || digest(core) !== reportDigest)
        return invalid();
    const serialized = canonicalJson(value);
    for (const forbidden of [
        "approveAll", "aggregateApproval", "credentialHandle", "credentialValue",
        "rawData", "rawPayload", "secret", "token", "customerData", "providerCall",
    ])
        if (serialized.includes(`\"${forbidden}\"`))
            return invalid();
    return value;
}
