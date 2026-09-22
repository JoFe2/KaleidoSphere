import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import { inventoryPocShowcaseUseCases, simulatePocShowcaseUseCaseE2e, } from "./poc-showcase-e2e.js";
import { validatePocShowcaseV1, } from "./poc-showcase.js";
export const POC_GUIDED_DEMO_TEMPLATE_API_VERSION = "chimpmaera.dev/poc-guided-demo-template/v1";
export const POC_GUIDED_DEMO_SETUP_PLAN_API_VERSION = "chimpmaera.dev/poc-guided-demo-setup-plan/v1";
export const POC_GUIDED_DEMO_SETUP_RECEIPT_API_VERSION = "chimpmaera.dev/poc-guided-demo-setup-receipt/v1";
export const POC_GUIDED_DEMO_CLEANUP_RECEIPT_API_VERSION = "chimpmaera.dev/poc-guided-demo-cleanup-receipt/v1";
export class PocGuidedDemoBootstrapError extends Error {
    code;
    constructor(code) {
        super(code);
        this.code = code;
    }
}
const BUILTIN_TEMPLATE_IDS = [
    "quick-tour",
    "business-playground",
    "builder-lab",
];
const SAFE_STATE_ROOT = /^artifacts\/poc-guided-demo\/playgrounds\/[a-z0-9-]+$/;
const DEFAULT_PROVIDER = "DETERMINISTIC_TEMPLATE_GUIDED_ADMIN_AI";
const DEFAULT_PROFILE = "AUTO_LOCAL_SAFE_DEMO";
const sha256 = (value) => `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
const fail = (code) => {
    throw new PocGuidedDemoBootstrapError(code);
};
const exactKeys = (value, keys) => value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).sort().join("\n") === [...keys].sort().join("\n");
function assertSafeText(value) {
    const text = typeof value === "string" ? value : canonicalJson(value);
    if (/(BEGIN PRIVATE KEY|api[_-]?key|password|token=|secret=|sk-[a-z0-9]{16,})/i
        .test(text)
        || /\b\d{3}-\d{2}-\d{4}\b/.test(text)
        || /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(text)) {
        fail("FORBIDDEN_CREDENTIAL_OR_PII_REQUEST_DENIED");
    }
}
function assertTemplateIds(useCaseIds) {
    if (useCaseIds.length === 0
        || new Set(useCaseIds).size !== useCaseIds.length
        || useCaseIds.some((id) => !/^POC-UC-00[1-6]$/.test(id))) {
        fail("TEMPLATE_USE_CASES_INVALID");
    }
}
function assertTemplateShape(template) {
    if (!exactKeys(template, [
        "apiVersion",
        "kind",
        "templateId",
        "version",
        "displayName",
        "provenance",
        "recommended",
        "purpose",
        "audience",
        "includedAgents",
        "includedModules",
        "includedCapabilities",
        "declaredDataAccess",
        "declaredNetworkAccess",
        "declaredEffects",
        "selectedUseCaseIds",
        "syntheticDataset",
        "safetyProfile",
        "expectedResources",
        "welcomeTour",
        "healthChecks",
        "cleanup",
        "claimBoundary",
    ])
        || template.apiVersion !== POC_GUIDED_DEMO_TEMPLATE_API_VERSION
        || template.kind !== "PocGuidedDemoTemplate"
        || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(template.templateId)
        || template.version !== 1
        || template.welcomeTour.length === 0
        || template.healthChecks.length === 0
        || !/^sha256:[a-f0-9]{64}$/.test(template.provenance.manifestDigest)) {
        fail("TEMPLATE_INVALID");
    }
    assertTemplateIds(template.selectedUseCaseIds);
    if (!template.syntheticDataset.containsCredentials
        && !template.syntheticDataset.containsRealCustomerData
        && template.safetyProfile.defaultDenyUndeclaredAction
        && template.safetyProfile.approvalMode === "DRY_RUN_SYNTHETIC_ONLY"
        && template.safetyProfile.network === "DISABLED_BY_DEFAULT"
        && template.safetyProfile.credentials === "FORBIDDEN"
        && template.safetyProfile.containers === "FORBIDDEN"
        && template.safetyProfile.adminAiBoundary === "PROPOSES_TYPED_DIFFABLE_PLAN_ONLY"
        && template.safetyProfile.controlPlaneAuthority === "SOLE_AUTHORITY"
        && template.declaredNetworkAccess.length === 0
        && template.expectedResources.runtime === "node"
        && template.expectedResources.minNodeMajor === 24
        && template.expectedResources.questionPolicy
            === "ASK_ONLY_WHEN_REQUIRED_FOR_SAFE_CORRECT_SETUP"
        && template.expectedResources.customTemplateQuestions
            === "ALLOW_FACTUALLY_REQUIRED_PROGRESSIVE_DISCLOSURE"
        && template.expectedResources.defaultsPolicy
            === "SAFE_DEFAULTS_NO_UNNECESSARY_HANDWORK"
        && !template.expectedResources.universalWallClockReleaseGate
        && template.expectedResources.quickTourCriticalPath
            === "MINIMIZE_AND_DEFER_OPTIONAL_HEAVY_COMPONENTS"
        && template.expectedResources.benchmarkPolicy
            === "COLD_AND_WARM_CACHE_QUALITY_SIGNAL_NOT_UNIVERSAL_GATE"
        && template.expectedResources.resourceProfile === DEFAULT_PROFILE
        && SAFE_STATE_ROOT.test(template.cleanup.ownedStateRoot)
        && template.cleanup.removesOnlyOwnedState
        && template.claimBoundary
            === "LOCAL_SYNTHETIC_DEMO_NO_LIVE_LLM_NO_EXTERNAL_SERVICE_NO_PRODUCTION_CLAIM") {
        assertSafeText(template);
        return;
    }
    fail("TEMPLATE_SAFETY_INVALID");
}
export function expectedPocGuidedDemoTemplatesV1() {
    const templates = [
        {
            apiVersion: POC_GUIDED_DEMO_TEMPLATE_API_VERSION,
            kind: "PocGuidedDemoTemplate",
            templateId: "quick-tour",
            version: 1,
            displayName: "Quick Tour",
            provenance: builtinProvenance("quick-tour"),
            recommended: true,
            purpose: "Show the broad local PoC path across all six deterministic synthetic use cases.",
            audience: "first-time evaluator who wants the fastest safe overview",
            includedAgents: [
                "admin-ai.deterministic-template-guide",
                "control-plane.local-authority",
                "audit-receipt.viewer",
            ],
            includedModules: [
                "forge",
                "document-processing",
                "bi-ops",
                "business-action",
                "contributor-authoring",
                "first-run",
            ],
            includedCapabilities: [
                "typed-plan-preview",
                "dry-run-approval",
                "synthetic-effect",
                "digest-only-audit",
                "rollback-cleanup",
            ],
            declaredDataAccess: ["repository_poc_assets", "synthetic.quick-tour.v1"],
            declaredNetworkAccess: [],
            declaredEffects: ["write_owned_playground_state", "synthetic_dry_run", "cleanup_owned_state"],
            selectedUseCaseIds: [
                "POC-UC-001",
                "POC-UC-002",
                "POC-UC-003",
                "POC-UC-004",
                "POC-UC-005",
                "POC-UC-006",
            ],
            syntheticDataset: {
                datasetId: "synthetic.quick-tour.v1",
                description: "small local fixtures for the complete six-use-case tour",
                containsRealCustomerData: false,
                containsCredentials: false,
            },
            safetyProfile: safeTemplateSafetyProfile(),
            expectedResources: safeTemplateResources(),
            welcomeTour: [
                "Inspect the typed setup plan and claim boundary.",
                "Run the six-use-case deterministic smoke.",
                "Review digests, audit receipt and cleanup command.",
            ],
            healthChecks: [
                "node-runtime-supported",
                "template-manifest-curated",
                "no-network-or-credential-request",
                "selected-use-cases-e2e-accepted",
                "owned-state-root-safe",
            ],
            cleanup: cleanupFor("quick-tour"),
            claimBoundary: "LOCAL_SYNTHETIC_DEMO_NO_LIVE_LLM_NO_EXTERNAL_SERVICE_NO_PRODUCTION_CLAIM",
        },
        {
            apiVersion: POC_GUIDED_DEMO_TEMPLATE_API_VERSION,
            kind: "PocGuidedDemoTemplate",
            templateId: "business-playground",
            version: 1,
            displayName: "Business Playground",
            provenance: builtinProvenance("business-playground"),
            recommended: false,
            purpose: "Demonstrate document, BI/Ops and business-action flows with approval, audit and rollback.",
            audience: "business evaluator checking useful operational behavior",
            includedAgents: [
                "admin-ai.deterministic-template-guide",
                "control-plane.local-authority",
                "business-action.executor",
            ],
            includedModules: [
                "document-processing",
                "bi-ops",
                "business-action",
            ],
            includedCapabilities: [
                "document-summary",
                "ops-metric-check",
                "crm-erp-like-synthetic-action",
                "approval-audit-rollback",
            ],
            declaredDataAccess: ["repository_poc_assets", "synthetic.business-playground.v1"],
            declaredNetworkAccess: [],
            declaredEffects: ["write_owned_playground_state", "synthetic_business_action", "rollback", "cleanup_owned_state"],
            selectedUseCaseIds: [
                "POC-UC-002",
                "POC-UC-003",
                "POC-UC-004",
            ],
            syntheticDataset: {
                datasetId: "synthetic.business-playground.v1",
                description: "sample documents, operational metrics and business records",
                containsRealCustomerData: false,
                containsCredentials: false,
            },
            safetyProfile: safeTemplateSafetyProfile(),
            expectedResources: safeTemplateResources(),
            welcomeTour: [
                "Process a synthetic document.",
                "Inspect the BI/Ops outcome.",
                "Apply and roll back a synthetic business action.",
            ],
            healthChecks: [
                "node-runtime-supported",
                "template-manifest-curated",
                "business-use-cases-e2e-accepted",
                "approval-and-rollback-present",
                "owned-state-root-safe",
            ],
            cleanup: cleanupFor("business-playground"),
            claimBoundary: "LOCAL_SYNTHETIC_DEMO_NO_LIVE_LLM_NO_EXTERNAL_SERVICE_NO_PRODUCTION_CLAIM",
        },
        {
            apiVersion: POC_GUIDED_DEMO_TEMPLATE_API_VERSION,
            kind: "PocGuidedDemoTemplate",
            templateId: "builder-lab",
            version: 1,
            displayName: "Builder Lab",
            provenance: builtinProvenance("builder-lab"),
            recommended: false,
            purpose: "Show forge and module-authoring flow: validate, install, use and remove a tiny extension.",
            audience: "developer or contributor evaluating extensibility",
            includedAgents: [
                "admin-ai.deterministic-template-guide",
                "control-plane.local-authority",
                "module-authoring.assistant",
            ],
            includedModules: [
                "forge",
                "contributor-authoring",
            ],
            includedCapabilities: [
                "module-authoring",
                "catalog-validation",
                "local-install",
                "synthetic-use",
                "remove-extension",
            ],
            declaredDataAccess: ["repository_poc_assets", "synthetic.builder-lab.v1"],
            declaredNetworkAccess: [],
            declaredEffects: ["write_owned_playground_state", "install_local_extension", "remove_local_extension", "cleanup_owned_state"],
            selectedUseCaseIds: [
                "POC-UC-001",
                "POC-UC-005",
            ],
            syntheticDataset: {
                datasetId: "synthetic.builder-lab.v1",
                description: "tiny local module bundle and forge fixture",
                containsRealCustomerData: false,
                containsCredentials: false,
            },
            safetyProfile: safeTemplateSafetyProfile(),
            expectedResources: safeTemplateResources(),
            welcomeTour: [
                "Inspect the forge authority plan.",
                "Validate and compose a local contributor module.",
                "Use the extension once, then remove it.",
            ],
            healthChecks: [
                "node-runtime-supported",
                "template-manifest-curated",
                "builder-use-cases-e2e-accepted",
                "extension-remove-path-present",
                "owned-state-root-safe",
            ],
            cleanup: cleanupFor("builder-lab"),
            claimBoundary: "LOCAL_SYNTHETIC_DEMO_NO_LIVE_LLM_NO_EXTERNAL_SERVICE_NO_PRODUCTION_CLAIM",
        },
    ];
    return templates.map((template) => {
        const core = { ...template, provenance: { ...template.provenance, manifestDigest: "" } };
        return {
            ...template,
            provenance: { ...template.provenance, manifestDigest: sha256(core) },
        };
    });
}
function builtinProvenance(templateId) {
    return {
        label: `PanSphaira curated default: ${templateId}`,
        source: "BUILTIN",
        trustTier: "BUILTIN_VERIFIED",
        manifestDigest: "sha256:placeholder",
        signature: "NOT_REQUIRED",
    };
}
function safeTemplateSafetyProfile() {
    return {
        profileId: "local-safe-demo",
        defaultDenyUndeclaredAction: true,
        approvalMode: "DRY_RUN_SYNTHETIC_ONLY",
        network: "DISABLED_BY_DEFAULT",
        credentials: "FORBIDDEN",
        containers: "FORBIDDEN",
        adminAiBoundary: "PROPOSES_TYPED_DIFFABLE_PLAN_ONLY",
        controlPlaneAuthority: "SOLE_AUTHORITY",
    };
}
function safeTemplateResources() {
    return {
        runtime: "node",
        minNodeMajor: 24,
        questionPolicy: "ASK_ONLY_WHEN_REQUIRED_FOR_SAFE_CORRECT_SETUP",
        customTemplateQuestions: "ALLOW_FACTUALLY_REQUIRED_PROGRESSIVE_DISCLOSURE",
        defaultsPolicy: "SAFE_DEFAULTS_NO_UNNECESSARY_HANDWORK",
        universalWallClockReleaseGate: false,
        quickTourCriticalPath: "MINIMIZE_AND_DEFER_OPTIONAL_HEAVY_COMPONENTS",
        benchmarkPolicy: "COLD_AND_WARM_CACHE_QUALITY_SIGNAL_NOT_UNIVERSAL_GATE",
        resourceProfile: DEFAULT_PROFILE,
    };
}
function cleanupFor(templateId) {
    return {
        ownedStateRoot: `artifacts/poc-guided-demo/playgrounds/${templateId}`,
        command: `npm run poc:setup -- --cleanup --template=${templateId}`,
        removesOnlyOwnedState: true,
    };
}
export function validatePocGuidedDemoTemplateV1(template) {
    assertTemplateShape(template);
    const digestCore = {
        ...template,
        provenance: { ...template.provenance, manifestDigest: "" },
    };
    if (template.provenance.manifestDigest !== sha256(digestCore)) {
        fail("TAMPERED_TEMPLATE_DENIED");
    }
    const expected = expectedPocGuidedDemoTemplatesV1()
        .find(({ templateId }) => templateId === template.templateId);
    if (expected && canonicalJson(template) !== canonicalJson(expected)) {
        fail("TAMPERED_TEMPLATE_DENIED");
    }
    if (!expected) {
        if (template.provenance.source === "BUILTIN"
            || template.provenance.trustTier === "BUILTIN_VERIFIED"
            || template.provenance.trustTier === "SIGNED_VERIFIED"
            || template.provenance.signature !== "NOT_REQUIRED")
            fail("CUSTOM_TEMPLATE_TRUST_CLAIM_DENIED");
    }
    return template;
}
export function validatePocGuidedDemoTemplateCatalogV1(templates) {
    if (templates.length < BUILTIN_TEMPLATE_IDS.length)
        fail("TEMPLATE_CATALOG_INVALID");
    const validated = templates.map(validatePocGuidedDemoTemplateV1);
    for (const templateId of BUILTIN_TEMPLATE_IDS) {
        if (!validated.some((template) => template.templateId === templateId)) {
            fail("UNKNOWN_TEMPLATE_DENIED");
        }
    }
    return validated.sort((a, b) => a.templateId.localeCompare(b.templateId));
}
export function buildPocGuidedDemoSetupConversationV1() {
    return {
        apiVersion: POC_GUIDED_DEMO_SETUP_PLAN_API_VERSION,
        provider: DEFAULT_PROVIDER,
        questionPolicy: "NO_FIXED_MAXIMUM_ASK_ONLY_WHEN_REQUIRED",
        customTemplateQuestions: "ALLOW_FACTUALLY_REQUIRED_PROGRESSIVE_DISCLOSURE",
        asksTemplateChoice: true,
        asksResourceProfile: false,
        asksFinalConfirmation: true,
        defaultsAcceptableByPressingEnter: true,
        advancedModeDeferredUntilPlaygroundWorks: true,
    };
}
function selectedTemplate(templates, requestedTemplateId) {
    const templateId = requestedTemplateId ?? "quick-tour";
    const template = validatePocGuidedDemoTemplateCatalogV1(templates)
        .find((candidate) => candidate.templateId === templateId);
    return template ?? fail("UNKNOWN_TEMPLATE_DENIED");
}
function assertSetupRequestSafe(request, template) {
    if ((request.provider ?? DEFAULT_PROVIDER) !== DEFAULT_PROVIDER) {
        fail("UNSUPPORTED_ADMIN_AI_PROVIDER_DENIED");
    }
    if ((request.runtimeProfile ?? DEFAULT_PROFILE) !== DEFAULT_PROFILE) {
        fail("RESOURCE_PROFILE_MISMATCH_DENIED");
    }
    if ((request.networkMode ?? "DISABLED_BY_DEFAULT") !== "DISABLED_BY_DEFAULT") {
        fail("FORBIDDEN_NETWORK_REQUEST_DENIED");
    }
    if ((request.credentialRequests ?? []).length > 0) {
        fail("FORBIDDEN_CREDENTIAL_OR_PII_REQUEST_DENIED");
    }
    if ((request.requestedCapabilities ?? [])
        .some((capability) => !template.includedCapabilities.includes(capability))) {
        fail("UNDECLARED_CAPABILITY_DENIED");
    }
    const stateRoot = request.stateRoot ?? template.cleanup.ownedStateRoot;
    if (!SAFE_STATE_ROOT.test(stateRoot) || stateRoot !== template.cleanup.ownedStateRoot) {
        fail("UNSAFE_OWNED_STATE_PATH_DENIED");
    }
}
function nodeMajor() {
    const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
    return Number.isFinite(major) ? major : 0;
}
function smokeUseCasesFor(showcase, template) {
    const inventory = inventoryPocShowcaseUseCases(showcase);
    for (const useCaseId of template.selectedUseCaseIds) {
        if (!inventory.some((useCase) => useCase.useCaseId === useCaseId)) {
            fail("TEMPLATE_USE_CASES_INVALID");
        }
    }
    return template.selectedUseCaseIds.map((useCaseId) => simulatePocShowcaseUseCaseE2e(showcase, {
        useCaseId,
        runId: `guided-${template.templateId}`,
    }));
}
export function buildPocGuidedDemoSetupPlanV1(showcaseInput, templatesInput, request = {}) {
    const showcase = validatePocShowcaseV1(showcaseInput);
    const template = selectedTemplate(templatesInput, request.templateId);
    assertSetupRequestSafe(request, template);
    if (nodeMajor() < template.expectedResources.minNodeMajor) {
        fail("RESOURCE_PROFILE_MISMATCH_DENIED");
    }
    const evidence = smokeUseCasesFor(showcase, template);
    const configCore = {
        configId: `config.${template.templateId}.v1`,
        templateId: template.templateId,
        provider: DEFAULT_PROVIDER,
        syntheticDataOnly: true,
        claimBoundary: template.claimBoundary,
    };
    const config = {
        ...configCore,
        configDigest: sha256(configCore),
    };
    const lockCore = {
        lockId: `lock.${template.templateId}.v1`,
        templateDigest: sha256(template),
        useCaseDigests: evidence.map(({ evidenceDigest }) => evidenceDigest),
    };
    const lock = {
        ...lockCore,
        lockDigest: sha256(lockCore),
    };
    const planCore = {
        apiVersion: POC_GUIDED_DEMO_SETUP_PLAN_API_VERSION,
        kind: "PocGuidedDemoSetupPlan",
        planId: `plan.poc-guided-demo.${template.templateId}.v1`,
        planVersion: 1,
        provider: DEFAULT_PROVIDER,
        providerBoundary: {
            currentReleaseEvidence: "DETERMINISTIC_TEMPLATE_GUIDED_PROVIDER_NO_LIVE_GENERATIVE_LLM",
            futureCompatibility: "OPTIONAL_LLM_PERSONALIZATION_CAN_PROPOSE_SAME_TYPED_PLAN_CONTRACT",
        },
        conversation: buildPocGuidedDemoSetupConversationV1(),
        template: {
            templateId: template.templateId,
            version: template.version,
            displayName: template.displayName,
            manifestDigest: sha256(template),
            provenanceLabel: template.provenance.label,
            trustTier: template.provenance.trustTier,
            informedConfirmationRequired: template.provenance.trustTier === "COMMUNITY_LOCAL_UNVERIFIED"
                || template.provenance.trustTier === "CUSTOM_LOCAL_UNVERIFIED",
        },
        runtime: {
            profile: DEFAULT_PROFILE,
            detectedNodeMajor: nodeMajor(),
            accepted: true,
        },
        authorityBoundary: {
            controlPlaneSoleAuthority: true,
            adminAiMayWidenPolicy: false,
            adminAiMayRequestCredentials: false,
            undeclaredCapabilitiesFailClosed: true,
        },
        permissions: [
            "read_repository_poc_assets",
            "write_owned_playground_state",
            "run_local_deterministic_health_and_smoke",
            "remove_owned_playground_state_on_cleanup",
        ],
        storage: {
            ownedStateRoot: template.cleanup.ownedStateRoot,
            deterministicConfigPath: `${template.cleanup.ownedStateRoot}/config.json`,
            deterministicLockPath: `${template.cleanup.ownedStateRoot}/lock.json`,
            receiptPath: `${template.cleanup.ownedStateRoot}/receipt.json`,
            cleanupReceiptPath: `artifacts/poc-guided-demo/cleanup-receipts/${template.templateId}.json`,
        },
        network: {
            mode: "DISABLED_BY_DEFAULT",
            allowedEndpoints: [],
        },
        performanceContract: {
            noUniversalInteractionTimeGate: true,
            noFixedQuestionMaximum: true,
            unnecessaryQuestionsDenied: true,
            safeDefaultsRequired: true,
            progressiveDisclosureRequired: true,
            finalConfirmationRequired: true,
            immediatePreflightSummary: true,
            visibleStageProgress: true,
            silentWaitPermitted: false,
            separateDownloadAndLocalTimings: true,
            resumableVerifiedDownloads: true,
            cacheReuseRequired: true,
            unnecessaryRedownloadDenied: true,
            sizeAndDiskSummaryRequired: true,
            etaOnlyWhereDefensible: true,
            universalWallClockReleaseGate: false,
            completionAndSafeResumeCancelCleanupRequired: true,
            manualConfigEditsRequired: false,
            benchmarkPolicy: "COLD_AND_WARM_CACHE_QUALITY_SIGNAL_NOT_UNIVERSAL_GATE",
        },
        setupSteps: [
            "select_curated_or_custom_template",
            "build_typed_plan",
            "write_owned_config_lock",
            "install_sandbox",
            "run_health",
            "run_selected_demo_smoke",
            "emit_receipt",
        ],
        healthChecks: template.healthChecks,
        smokeUseCases: evidence.map(({ useCase, evidenceDigest }) => ({
            useCaseId: useCase.useCaseId,
            label: useCase.label,
            evidenceDigest,
        })),
        config,
        lock,
    };
    assertSafeText(planCore);
    return {
        ...planCore,
        planDigest: sha256(planCore),
    };
}
export function verifyPocGuidedDemoSetupPlanV1(plan) {
    const { planDigest, ...planCore } = plan;
    if (planDigest !== sha256(planCore))
        fail("TAMPERED_PLAN_DENIED");
    const { configDigest, ...configCore } = plan.config;
    if (configDigest !== sha256(configCore))
        fail("TAMPERED_PLAN_DENIED");
    const { lockDigest, ...lockCore } = plan.lock;
    if (lockDigest !== sha256(lockCore))
        fail("TAMPERED_PLAN_DENIED");
    if (plan.network.mode !== "DISABLED_BY_DEFAULT"
        || plan.network.allowedEndpoints.length !== 0
        || !SAFE_STATE_ROOT.test(plan.storage.ownedStateRoot)) {
        fail("TAMPERED_PLAN_DENIED");
    }
    assertSafeText(plan);
    return plan;
}
export function buildPocGuidedDemoSetupReceiptV1(planInput) {
    const plan = verifyPocGuidedDemoSetupPlanV1(planInput);
    const installCore = {
        templateId: plan.template.templateId,
        planDigest: plan.planDigest,
        configDigest: plan.config.configDigest,
        lockDigest: plan.lock.lockDigest,
        healthChecks: plan.healthChecks,
        smokeUseCases: plan.smokeUseCases,
    };
    const installDigest = sha256(installCore);
    const receiptCore = {
        apiVersion: POC_GUIDED_DEMO_SETUP_RECEIPT_API_VERSION,
        kind: "PocGuidedDemoSetupReceipt",
        templateId: plan.template.templateId,
        status: "READY",
        planDigest: plan.planDigest,
        configDigest: plan.config.configDigest,
        lockDigest: plan.lock.lockDigest,
        health: {
            status: "PASS",
            checks: plan.healthChecks.map((checkId) => ({
                checkId,
                status: "PASS",
            })),
        },
        demoEvidence: plan.smokeUseCases.map(({ useCaseId, evidenceDigest }) => ({
            useCaseId,
            status: "PASS",
            evidenceDigest,
        })),
        idempotency: {
            firstInstallDigest: installDigest,
            secondInstallDigest: installDigest,
            status: "IDEMPOTENT_RERUN_ACCEPTED",
        },
        performance: {
            downloadBytes: 0,
            downloadMilliseconds: 0,
            localInstallConfigHealthMilliseconds: 0,
            cache: "WARM_NO_REDOWNLOAD",
            timingProfile: "LOCAL_SYNTHETIC_REFERENCE",
            universalReleaseGateApplied: false,
        },
        readyMessage: {
            entrypoint: "npm run poc:demo",
            firstThreeActions: [
                "Open setup-plan.json and inspect the typed Admin-AI proposal.",
                "Open receipt.json and compare plan, config and lock digests.",
                "Run the cleanup command when finished.",
            ],
            cleanupCommand: `npm run poc:setup -- --cleanup --template=${plan.template.templateId}`,
        },
    };
    assertSafeText(receiptCore);
    return {
        ...receiptCore,
        receiptDigest: sha256(receiptCore),
    };
}
export function verifyPocGuidedDemoSetupReceiptV1(receipt, plan) {
    verifyPocGuidedDemoSetupPlanV1(plan);
    const { receiptDigest, ...receiptCore } = receipt;
    if (receipt.planDigest !== plan.planDigest
        || receipt.configDigest !== plan.config.configDigest
        || receipt.lockDigest !== plan.lock.lockDigest
        || receipt.status !== "READY"
        || receiptDigest !== sha256(receiptCore)) {
        fail("TAMPERED_RECEIPT_DENIED");
    }
    assertSafeText(receipt);
    return receipt;
}
export function buildPocGuidedDemoCleanupReceiptV1(planInput, receiptInput) {
    const plan = verifyPocGuidedDemoSetupPlanV1(planInput);
    const receipt = verifyPocGuidedDemoSetupReceiptV1(receiptInput, plan);
    const cleanupCore = {
        apiVersion: POC_GUIDED_DEMO_CLEANUP_RECEIPT_API_VERSION,
        kind: "PocGuidedDemoCleanupReceipt",
        templateId: plan.template.templateId,
        status: "CLEANED",
        ownedStateRoot: plan.storage.ownedStateRoot,
        removedOnlyOwnedState: true,
        planDigest: plan.planDigest,
        receiptDigest: receipt.receiptDigest,
    };
    return {
        ...cleanupCore,
        cleanupDigest: sha256(cleanupCore),
    };
}
export function renderPocGuidedDemoReadyMessageV1(plan, receipt) {
    verifyPocGuidedDemoSetupReceiptV1(receipt, plan);
    const lines = [
        "PanSphaira guided demo playground is ready.",
        `Template: ${plan.template.displayName} (${plan.template.templateId})`,
        `Admin-AI provider: deterministic template-guided provider, no live generative LLM`,
        `Plan digest: ${plan.planDigest}`,
        `Config digest: ${plan.config.configDigest}`,
        `Lock digest: ${plan.lock.lockDigest}`,
        `Local state: ${plan.storage.ownedStateRoot}`,
        `Entrypoint: ${receipt.readyMessage.entrypoint}`,
        "",
        "First three actions:",
        ...receipt.readyMessage.firstThreeActions.map((action, index) => `${index + 1}. ${action}`),
        "",
        `Cleanup: ${receipt.readyMessage.cleanupCommand}`,
    ];
    const rendered = `${lines.join("\n")}\n`;
    assertSafeText(rendered);
    return rendered;
}
