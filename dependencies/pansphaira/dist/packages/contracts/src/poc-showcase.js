export const POC_SHOWCASE_API_VERSION = "chimpmaera.dev/poc-showcase/v1";
export class PocShowcaseValidationError extends Error {
    code;
    constructor(code) {
        super(code);
        this.code = code;
    }
}
const ID = /^[a-z][a-z0-9._:/-]{2,255}$/;
const VALID_STATUSES = new Set([
    "COMPLETE/CLOSED",
    "POC_REQUIRED",
    "POC_OPTIONAL",
    "PREPARATION_ONLY",
    "AUTHORITY_REQUIRED",
    "TECHNICAL_BLOCKER",
    "PARKED_OUT_OF_SCOPE",
]);
const FORBIDDEN_REF = /^(https?:|ssh:|git@)|\.\.|(^|\/)(\.env|id_rsa|secret|credentials)(\.|\/|$)/i;
const MIN_CAPABILITY_AREAS = new Set([
    "CODE_FORGE_AUTHORITY",
    "DOCUMENT_PROCESSING",
    "BI_OPERATIONS",
]);
const exactKeys = (value, keys) => value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).sort().join("\n") === [...keys].sort().join("\n");
function fail(code) {
    throw new PocShowcaseValidationError(code);
}
function assertIds(values, code) {
    if (values.length === 0
        || new Set(values).size !== values.length
        || values.some((value) => !ID.test(value))) {
        fail(code);
    }
}
function assertLocalRefs(values, code) {
    if (values.length === 0
        || values.some((value) => value.length === 0 || FORBIDDEN_REF.test(value))) {
        fail(code);
    }
}
export function validatePocShowcaseV1(value) {
    if (!exactKeys(value, [
        "apiVersion",
        "kind",
        "showcaseId",
        "revision",
        "productDefinition",
        "demoLoop",
        "modules",
        "contributorPath",
        "safetyFloor",
        "themeReclassification",
    ])
        || value.apiVersion !== POC_SHOWCASE_API_VERSION
        || value.kind !== "PocShowcase"
        || !ID.test(value.showcaseId)
        || !Number.isSafeInteger(value.revision)
        || value.revision < 1) {
        fail("ROOT_INVALID");
    }
    const { productDefinition } = value;
    if (productDefinition.goal !== "DYNAMIC_EXTENSIBLE_AGENT_OS_POC"
        || productDefinition.primaryMetric
            !== "DEMONSTRABLE_POC_POWER_EXTENSIBILITY_UNDERSTANDABILITY"
        || productDefinition.claimBoundary
            !== "LOCAL_SYNTHETIC_POC_NO_PRODUCTION_CLAIM"
        || !productDefinition.completionHistoryStatement.includes("13/14")
        || productDefinition.localBoundedStartupCommand !== "npm run poc:showcase:check") {
        fail("PRODUCT_DIRECTION_INVALID");
    }
    if (value.demoLoop.typedPlan.length < 4
        || !value.demoLoop.approvalPolicy.defaultDenyUndeclaredAction
        || !value.demoLoop.approvalPolicy.typedRightsRequired
        || !value.demoLoop.approvalPolicy.useTimeRevocationCheck
        || value.demoLoop.approvalPolicy.approvalMode === "REFERENCE_ONLY"
        || !value.demoLoop.actionReceipt.auditEvidenceRequired
        || !value.demoLoop.actionReceipt.rollbackDemonstrated) {
        fail("DEMO_LOOP_INCOMPLETE");
    }
    assertLocalRefs(value.demoLoop.actionReceipt.receiptFields, "RECEIPT_INVALID");
    if (value.modules.length < 3)
        fail("MODULE_BREADTH_INSUFFICIENT");
    assertIds(value.modules.map(({ moduleId }) => moduleId), "MODULE_IDS_INVALID");
    const capabilityAreas = new Set(value.modules.map(({ capabilityArea }) => capabilityArea));
    for (const requiredArea of MIN_CAPABILITY_AREAS) {
        if (!capabilityAreas.has(requiredArea))
            fail("MODULE_BREADTH_INSUFFICIENT");
    }
    if (!value.modules.some(({ evidenceClass }) => evidenceClass === "EXECUTABLE")) {
        fail("EXECUTABLE_EVIDENCE_REQUIRED");
    }
    for (const module of value.modules) {
        if (module.syntheticDataOnly !== true
            || module.demoGradeIntegration !== true
            || module.typedActions.length === 0
            || module.typedRights.length === 0
            || module.rollbackPath.length === 0) {
            fail("MODULE_SAFETY_INVALID");
        }
        assertIds(module.typedActions, "MODULE_ACTIONS_INVALID");
        assertIds(module.typedRights, "MODULE_RIGHTS_INVALID");
        assertLocalRefs(module.evidenceRefs, "MODULE_EVIDENCE_INVALID");
    }
    assertLocalRefs(value.contributorPath.templateRefs, "CONTRIBUTOR_TEMPLATE_INVALID");
    assertLocalRefs(value.contributorPath.validationCommands, "CONTRIBUTOR_COMMAND_INVALID");
    if (!value.contributorPath.installComposeDemo.includes("compose")
        || !value.contributorPath.rightsRollbackDemo.includes("rollback")) {
        fail("CONTRIBUTOR_PATH_INCOMPLETE");
    }
    if (!value.safetyFloor.noEmbeddedRealSecrets
        || !value.safetyFloor.tenantCellIsolation
        || !value.safetyFloor.deterministicCleanupRollback
        || !value.safetyFloor.externalSystemsForbiddenByDefault
        || !value.safetyFloor.publicationAuthorityRequired
        || !value.safetyFloor.ownerRightsAuthorityRequired
        || !value.safetyFloor.hostileTenancyClaimForbidden) {
        fail("SAFETY_FLOOR_INVALID");
    }
    if (value.themeReclassification.length < 8)
        fail("THEME_CLASSIFICATION_INCOMPLETE");
    for (const entry of value.themeReclassification) {
        if (entry.theme.length === 0
            || entry.rationale.length === 0
            || !VALID_STATUSES.has(entry.status)) {
            fail("THEME_STATUS_INVALID");
        }
    }
    return value;
}
