import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import { verifyPocGuidedDemoSetupPlanV1, } from "./poc-guided-demo-bootstrap.js";
export const POC_EARLY_ADMIN_STATUS_API_VERSION = "chimpmaera.dev/poc-early-admin-status/v1";
export const POC_EARLY_ADMIN_REPAIR_PLAN_API_VERSION = "chimpmaera.dev/poc-early-admin-repair-plan/v1";
export const POC_EARLY_ADMIN_REPAIR_RECEIPT_API_VERSION = "chimpmaera.dev/poc-early-admin-repair-receipt/v1";
export const POC_ADMIN_AUTHORITY_PROFILE_API_VERSION = "chimpmaera.dev/admin-authority-profile/v1";
export class PocEarlyAdminSetupError extends Error {
    code;
    constructor(code) {
        super(code);
        this.code = code;
    }
}
const STAGE_A_ACTIONS = [
    "REWRITE_OWNED_CONFIG_FROM_VERIFIED_PLAN",
    "RETRY_DECLARED_HEALTH_CHECKS",
];
const FULL_CONTROL_WARNING = "FULL_CONTROL_LAB is not recommended for real operation. After activation "
    + "the Admin-AI may use every right already granted to the PanSphaira host "
    + "process, including shell, files, processes/services, packages, network, "
    + "modules, configuration and repair, without further PanSphaira capability, "
    + "action or approval gates. PanSphaira does not create OS rights: root needs "
    + "a separate visible owner elevation. With real root the Admin-AI can also "
    + "damage or remove PanSphaira, its audit data and emergency controls; audit, "
    + "status, receipts and emergency stop are transparency/recovery features, "
    + "not a security boundary.";
export function pocAdminAuthorityProfilesV1() {
    const common = {
        apiVersion: POC_ADMIN_AUTHORITY_PROFILE_API_VERSION,
        osProcessRightsAreCeiling: true,
        rootElevationRequiresSeparateVisibleOwnerAction: true,
        auditAndEmergencyStopAreTransparencyNotSecurityBoundary: true,
        contextBound: true,
        visible: true,
        revocable: true,
        silentlyInherited: false,
        restartPolicy: "RESET_TO_SAFE_GUIDED",
    };
    return [
        {
            ...common,
            profileId: "SAFE_GUIDED",
            recommendedForRealOperation: true,
            intendedUse: "REAL_OPERATION",
            actionPolicy: "BOUNDED_DECLARED_ACTIONS_APPROVAL_FOR_MATERIAL_CHANGE",
        },
        {
            ...common,
            profileId: "DEVELOPER_ELEVATED",
            recommendedForRealOperation: false,
            intendedUse: "LOCAL_DEVELOPMENT_AND_SECURITY_TESTS",
            actionPolicy: "BROAD_DECLARED_SYSTEM_RIGHTS_APPROVAL_FOR_MATERIAL_CHANGE",
        },
        {
            ...common,
            profileId: "FULL_CONTROL_LAB",
            recommendedForRealOperation: false,
            intendedUse: "TEST_LAB_ONLY",
            actionPolicy: "NO_CHIMPMAERA_CAPABILITY_ACTION_OR_APPROVAL_LIMITS",
        },
    ];
}
function authorityProfile(profileId) {
    const profile = pocAdminAuthorityProfilesV1().find((candidate) => candidate.profileId === profileId);
    if (!profile)
        fail("UNKNOWN_AUTHORITY_PROFILE");
    return profile;
}
export function fullControlLabRiskWarningV1() {
    return FULL_CONTROL_WARNING;
}
const STAGE_LABELS = {
    bootstrap_supervisor: "Bootstrap supervisor and dashboard",
    preflight: "Template, policy, disk and capability preflight",
    download_and_cache: "Verified downloads and cache",
    configure_owned_state: "Owned configuration",
    install_sandbox: "Local synthetic sandbox",
    health_policy_identity: "Health, policy and identity gates",
    ready: "Ready",
};
const STAGE_IDS = Object.keys(STAGE_LABELS);
const digest = (value) => `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
const fail = (code) => {
    throw new PocEarlyAdminSetupError(code);
};
function assertSafeText(value) {
    const text = typeof value === "string" ? value : canonicalJson(value);
    if (/(?:authorization|api[-_ ]?key|password|secret|token)\s*[:=]\s*\S+/i
        .test(text)
        || /\b\d{3}-\d{2}-\d{4}\b/.test(text)
        || /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(text)) {
        fail("SENSITIVE_INPUT_DENIED");
    }
}
function statusCore(status) {
    const { statusDigest: _statusDigest, ...core } = status;
    return core;
}
function withStatusDigest(core) {
    assertSafeText(core);
    return { ...core, statusDigest: digest(core) };
}
function progressFor(stages) {
    const completedStages = stages.filter(({ status }) => status === "PASS").length;
    return {
        completedStages,
        totalStages: stages.length,
        percent: Math.floor((completedStages / stages.length) * 100),
    };
}
function updateStages(status, updates) {
    return status.stages.map((stage) => ({
        ...stage,
        status: updates[stage.stageId] ?? stage.status,
    }));
}
export function buildPocEarlyAdminStatusV1(planInput, options = {}) {
    const plan = verifyPocGuidedDemoSetupPlanV1(planInput);
    const stages = STAGE_IDS.map((stageId, index) => ({
        stageId,
        label: STAGE_LABELS[stageId],
        status: index === 0 ? "PASS" : "PENDING",
    }));
    const core = {
        apiVersion: POC_EARLY_ADMIN_STATUS_API_VERSION,
        kind: "PocEarlyAdminStatus",
        sessionId: `setup.${plan.template.templateId}.v1`,
        provider: {
            providerId: "DETERMINISTIC_ADMIN_ASSISTANT_V1",
            contract: "TYPED_ADMIN_ASSISTANT_PROVIDER_AUTHORITY_FROM_OWNER_PROFILE",
            currentEvidence: "OFFLINE_SYNTHETIC_NO_LIVE_LLM",
            laterLocalLlmPath: "LOCAL_OPENAI_COMPATIBLE_PROVIDER_BEHIND_SAME_TYPED_CONTRACT",
        },
        authority: {
            stage: "STAGE_A_BOOTSTRAP_SUPERVISOR",
            profile: authorityProfile("SAFE_GUIDED"),
            shellAccess: false,
            controlPlaneAdministration: false,
            policyWidening: false,
            hostRights: "BOUNDED_OWNED_STATE",
            stageAAllowedActions: STAGE_A_ACTIONS,
        },
        template: plan.template,
        plan: {
            planId: plan.planId,
            planDigest: plan.planDigest,
            setupSteps: plan.setupSteps,
        },
        stages,
        progress: progressFor(stages),
        resources: {
            downloadBytesTotal: 0,
            downloadBytesComplete: 0,
            cache: "VERIFIED_WARM",
            diskBytesRequiredEstimate: 65536,
            diskBytesAvailableSynthetic: 1073741824,
            universalInstallTimeClaim: false,
        },
        health: {
            status: "PENDING",
            healthGate: false,
            policyGate: options.policyAvailable ?? true,
            identityGate: false,
        },
        currentAction: "Dashboard ready; waiting for setup start.",
        warnings: [],
        decisions: [{
                decisionId: "safe-defaults",
                status: "DEFAULTED",
                summary: "Offline synthetic mode, no network, credentials or containers.",
            }],
        receipts: [],
        resume: {
            available: false,
            checkpointStage: "bootstrap_supervisor",
            cacheReusable: true,
        },
        cleanup: {
            available: true,
            ownedStateRoot: plan.storage.ownedStateRoot,
            removesOnlyOwnedState: true,
        },
        dialog: {
            questionPolicy: "NO_FIXED_MAXIMUM_ASK_ONLY_WHEN_REQUIRED",
            progressiveDisclosure: true,
            acceptsQuestions: true,
            availableActions: [
                "ASK",
                "DIAGNOSE",
                "CONFIRM_REPAIR",
                "RESUME",
                "CLEANUP",
            ],
        },
    };
    return withStatusDigest(core);
}
export function verifyPocEarlyAdminStatusV1(status) {
    const profile = status.authority.profile;
    const authorityShapeValid = profile.profileId === "SAFE_GUIDED"
        ? !status.authority.shellAccess
            && !status.authority.controlPlaneAdministration
            && !status.authority.policyWidening
            && status.authority.hostRights === "BOUNDED_OWNED_STATE"
        : profile.profileId === "DEVELOPER_ELEVATED"
            ? status.authority.shellAccess
                && status.authority.controlPlaneAdministration
                && status.authority.policyWidening
                && status.authority.hostRights === "DECLARED_OS_PROCESS_RIGHTS"
            : status.authority.shellAccess
                && status.authority.controlPlaneAdministration
                && status.authority.policyWidening
                && status.authority.hostRights
                    === "ALL_OS_PROCESS_RIGHTS_NO_CHIMPMAERA_GATES";
    if (status.apiVersion !== POC_EARLY_ADMIN_STATUS_API_VERSION
        || status.kind !== "PocEarlyAdminStatus"
        || status.statusDigest !== digest(statusCore(status))
        || profile.apiVersion !== POC_ADMIN_AUTHORITY_PROFILE_API_VERSION
        || !authorityShapeValid
        || status.resources.universalInstallTimeClaim) {
        fail("TAMPERED_STATUS_DENIED");
    }
    assertSafeText(status);
    return status;
}
export function activatePocAdminAuthorityProfileV1(statusInput, selection) {
    const status = verifyPocEarlyAdminStatusV1(statusInput);
    if (selection.contextId !== status.sessionId) {
        fail("AUTHORITY_CONTEXT_MISMATCH");
    }
    if (selection.source === "CUSTOM_TEMPLATE_REQUEST") {
        fail("CUSTOM_TEMPLATE_CANNOT_ACTIVATE_AUTHORITY_PROFILE");
    }
    const profile = authorityProfile(selection.requestedProfileId);
    if (profile.profileId === "FULL_CONTROL_LAB"
        && selection.explicitOwnerConfirmation
            !== `I ACCEPT FULL_CONTROL_LAB RISK FOR ${status.sessionId}`) {
        fail("FULL_CONTROL_EXPLICIT_RISK_ACCEPTANCE_REQUIRED");
    }
    if (profile.profileId === "DEVELOPER_ELEVATED"
        && !selection.explicitOwnerConfirmation) {
        fail("ELEVATED_PROFILE_OWNER_CONFIRMATION_REQUIRED");
    }
    const full = profile.profileId === "FULL_CONTROL_LAB";
    const elevated = profile.profileId === "DEVELOPER_ELEVATED";
    return withStatusDigest({
        ...statusCore(status),
        authority: {
            ...status.authority,
            profile,
            shellAccess: elevated || full,
            controlPlaneAdministration: elevated || full,
            policyWidening: elevated || full,
            hostRights: full
                ? "ALL_OS_PROCESS_RIGHTS_NO_CHIMPMAERA_GATES"
                : elevated
                    ? "DECLARED_OS_PROCESS_RIGHTS"
                    : "BOUNDED_OWNED_STATE",
            stageAAllowedActions: full ? [] : STAGE_A_ACTIONS,
        },
        currentAction: full
            ? "FULL_CONTROL_LAB visibly active for this setup context."
            : `${profile.profileId} visibly active for this setup context.`,
        warnings: full
            ? [...status.warnings, FULL_CONTROL_WARNING]
            : status.warnings.filter((warning) => warning !== FULL_CONTROL_WARNING),
        decisions: [
            ...status.decisions,
            {
                decisionId: `authority-profile.${profile.profileId}`,
                status: "CONFIRMED",
                summary: profile.actionPolicy,
            },
        ],
    });
}
export function resetPocAdminAuthorityToSafeV1(statusInput, reason) {
    const status = verifyPocEarlyAdminStatusV1(statusInput);
    return withStatusDigest({
        ...statusCore(status),
        authority: {
            ...status.authority,
            profile: authorityProfile("SAFE_GUIDED"),
            shellAccess: false,
            controlPlaneAdministration: false,
            policyWidening: false,
            hostRights: "BOUNDED_OWNED_STATE",
            stageAAllowedActions: STAGE_A_ACTIONS,
        },
        currentAction: `SAFE_GUIDED active after ${reason}.`,
        warnings: status.warnings.filter((warning) => warning !== FULL_CONTROL_WARNING),
        decisions: [
            ...status.decisions,
            {
                decisionId: `authority-profile.reset.${reason}`,
                status: "APPLIED",
                summary: "Elevated authority was revoked and did not persist.",
            },
        ],
    });
}
export function assertPocAdminActionAllowedV1(statusInput, action, ownerConfirmed) {
    const status = verifyPocEarlyAdminStatusV1(statusInput);
    const profileId = status.authority.profile.profileId;
    if (profileId === "FULL_CONTROL_LAB")
        return true;
    if (!action.declared)
        fail("UNDECLARED_ACTION_DENIED");
    if (action.material && !ownerConfirmed)
        fail("OWNER_CONFIRMATION_REQUIRED");
    return true;
}
export function runPocEarlyAdminSyntheticSetupV1(statusInput, options = {}) {
    const status = verifyPocEarlyAdminStatusV1(statusInput);
    if (options.injectFailure === "CONFIG_DIGEST_MISMATCH") {
        const stages = updateStages(status, {
            preflight: "PASS",
            download_and_cache: "PASS",
            configure_owned_state: "FAILED",
        });
        return withStatusDigest({
            ...statusCore(status),
            stages,
            progress: progressFor(stages),
            health: { ...status.health, status: "DEGRADED" },
            currentAction: "Configuration digest mismatch; bounded repair available.",
            warnings: ["CONFIG_DIGEST_MISMATCH"],
            resume: {
                available: false,
                checkpointStage: "download_and_cache",
                cacheReusable: true,
            },
        });
    }
    if (options.injectFailure === "TRANSIENT_HEALTH_CHECK_FAILURE") {
        const stages = updateStages(status, {
            preflight: "PASS",
            download_and_cache: "PASS",
            configure_owned_state: "PASS",
            install_sandbox: "PASS",
            health_policy_identity: "FAILED",
        });
        return withStatusDigest({
            ...statusCore(status),
            stages,
            progress: progressFor(stages),
            health: { ...status.health, status: "DEGRADED", identityGate: true },
            currentAction: "Declared health checks need a bounded retry.",
            warnings: ["TRANSIENT_HEALTH_CHECK_FAILURE"],
            resume: {
                available: false,
                checkpointStage: "install_sandbox",
                cacheReusable: true,
            },
        });
    }
    const stages = status.stages.map((stage) => ({
        ...stage,
        status: "PASS",
    }));
    const setupReceiptDigest = digest({
        kind: "SETUP",
        planDigest: status.plan.planDigest,
        templateId: status.template.templateId,
    });
    return withStatusDigest({
        ...statusCore(status),
        stages,
        progress: progressFor(stages),
        health: {
            status: "PASS",
            healthGate: true,
            policyGate: status.health.policyGate,
            identityGate: true,
        },
        currentAction: "Setup healthy; Stage B promotion is gate-controlled.",
        warnings: status.warnings.filter((warning) => warning !== "CONFIG_DIGEST_MISMATCH"
            && warning !== "TRANSIENT_HEALTH_CHECK_FAILURE"),
        receipts: [
            ...status.receipts.filter(({ kind }) => kind !== "SETUP"),
            { kind: "SETUP", digest: setupReceiptDigest },
        ],
        resume: {
            available: true,
            checkpointStage: "ready",
            cacheReusable: true,
        },
    });
}
export function buildPocEarlyAdminRepairPlanV1(statusInput, issueCode) {
    const status = verifyPocEarlyAdminStatusV1(statusInput);
    if (!status.warnings.includes(issueCode))
        fail("ISSUE_NOT_OBSERVED_DENIED");
    const definition = issueCode === "CONFIG_DIGEST_MISMATCH"
        ? {
            actionId: "REWRITE_OWNED_CONFIG_FROM_VERIFIED_PLAN",
            capability: "write_owned_playground_state",
            target: `${status.cleanup.ownedStateRoot}/config.json`,
            diagnosis: "The owned config no longer matches the verified setup-plan digest.",
            impact: "Replace only the owned config with deterministic plan-bound bytes.",
            materialChange: true,
            rollback: "RESTORE_PREVIOUS_OWNED_CONFIG",
        }
        : {
            actionId: "RETRY_DECLARED_HEALTH_CHECKS",
            capability: "run_local_deterministic_health_and_smoke",
            target: status.cleanup.ownedStateRoot,
            diagnosis: "A declared local synthetic health check was transiently false.",
            impact: "Retry only the declared idempotent health checks.",
            materialChange: false,
            rollback: "NO_STATE_CHANGE",
        };
    if (!status.authority.stageAAllowedActions.includes(definition.actionId)) {
        fail("UNDECLARED_ACTION_DENIED");
    }
    const core = {
        apiVersion: POC_EARLY_ADMIN_REPAIR_PLAN_API_VERSION,
        kind: "PocEarlyAdminRepairPlan",
        repairPlanId: `repair.${status.template.templateId}.${issueCode}.v1`,
        issueCode,
        diagnosis: definition.diagnosis,
        baseSetupPlanDigest: status.plan.planDigest,
        baseStatusDigest: status.statusDigest,
        requiredAuthority: "STAGE_A_BOOTSTRAP_SUPERVISOR",
        action: {
            actionId: definition.actionId,
            capability: definition.capability,
            target: definition.target,
            idempotent: true,
            boundedToOwnedState: true,
            materialChange: definition.materialChange,
        },
        impact: definition.impact,
        ownerConfirmationRequired: definition.materialChange,
        rollback: {
            action: definition.rollback,
            boundedToOwnedState: true,
        },
    };
    assertSafeText(core);
    return { ...core, repairPlanDigest: digest(core) };
}
export function verifyPocEarlyAdminRepairPlanV1(repairPlan, statusInput) {
    const status = verifyPocEarlyAdminStatusV1(statusInput);
    const expected = buildPocEarlyAdminRepairPlanV1(status, repairPlan.issueCode);
    const { repairPlanDigest, ...core } = repairPlan;
    if (repairPlanDigest !== digest(core)
        || repairPlanDigest !== expected.repairPlanDigest
        || repairPlan.baseSetupPlanDigest !== status.plan.planDigest
        || repairPlan.baseStatusDigest !== status.statusDigest
        || repairPlan.requiredAuthority !== "STAGE_A_BOOTSTRAP_SUPERVISOR"
        || status.authority.stage !== "STAGE_A_BOOTSTRAP_SUPERVISOR"
        || !status.authority.stageAAllowedActions.includes(repairPlan.action.actionId)
        || !repairPlan.action.idempotent
        || !repairPlan.action.boundedToOwnedState) {
        fail("TAMPERED_OR_ESCALATED_REPAIR_PLAN_DENIED");
    }
    assertSafeText(repairPlan);
    return repairPlan;
}
export function applyPocEarlyAdminRepairV1(statusInput, repairPlanInput, ownerConfirmed) {
    const status = verifyPocEarlyAdminStatusV1(statusInput);
    const repairPlan = verifyPocEarlyAdminRepairPlanV1(repairPlanInput, status);
    if (repairPlan.ownerConfirmationRequired && !ownerConfirmed) {
        fail("OWNER_CONFIRMATION_REQUIRED");
    }
    const receiptCore = {
        apiVersion: POC_EARLY_ADMIN_REPAIR_RECEIPT_API_VERSION,
        kind: "PocEarlyAdminRepairReceipt",
        repairPlanDigest: repairPlan.repairPlanDigest,
        baseSetupPlanDigest: repairPlan.baseSetupPlanDigest,
        actionId: repairPlan.action.actionId,
        ownerConfirmed,
        status: "APPLIED",
        rollback: repairPlan.rollback,
    };
    const receipt = {
        ...receiptCore,
        receiptDigest: digest(receiptCore),
    };
    const nextStatus = withStatusDigest({
        ...statusCore(status),
        currentAction: "Repair applied; setup can resume from verified checkpoint.",
        warnings: status.warnings.filter((warning) => warning !== repairPlan.issueCode),
        decisions: [
            ...status.decisions,
            {
                decisionId: repairPlan.repairPlanId,
                status: ownerConfirmed ? "CONFIRMED" : "APPLIED",
                summary: repairPlan.impact,
            },
        ],
        receipts: [
            ...status.receipts,
            { kind: "REPAIR", digest: receipt.receiptDigest },
        ],
        resume: { ...status.resume, available: true },
    });
    return { status: nextStatus, receipt };
}
export function verifyPocEarlyAdminRepairReceiptV1(receipt, repairPlan) {
    const { receiptDigest, ...core } = receipt;
    if (receiptDigest !== digest(core)
        || receipt.repairPlanDigest !== repairPlan.repairPlanDigest
        || receipt.baseSetupPlanDigest !== repairPlan.baseSetupPlanDigest
        || receipt.actionId !== repairPlan.action.actionId
        || receipt.status !== "APPLIED") {
        fail("TAMPERED_REPAIR_RECEIPT_DENIED");
    }
    assertSafeText(receipt);
    return receipt;
}
export function resumePocEarlyAdminSetupV1(statusInput) {
    const status = verifyPocEarlyAdminStatusV1(statusInput);
    if (!status.resume.available || status.warnings.length > 0) {
        fail("SAFE_RESUME_NOT_AVAILABLE");
    }
    return runPocEarlyAdminSyntheticSetupV1(status);
}
export function promotePocEarlyAdminToStageBV1(statusInput) {
    const status = verifyPocEarlyAdminStatusV1(statusInput);
    if (status.health.status !== "PASS"
        || !status.health.healthGate
        || !status.health.policyGate
        || !status.health.identityGate) {
        fail("STAGE_B_PROMOTION_GATES_NOT_MET");
    }
    return withStatusDigest({
        ...statusCore(status),
        authority: {
            ...status.authority,
            stage: "STAGE_B_ADMIN_AI",
        },
        currentAction: "Stage B Admin-AI active inside the existing policy boundary.",
        decisions: [
            ...status.decisions,
            {
                decisionId: "stage-b-promotion",
                status: "APPLIED",
                summary: "Promoted only after health, policy and identity gates passed.",
            },
        ],
    });
}
export function askPocEarlyAdminAssistantV1(statusInput, question) {
    const status = verifyPocEarlyAdminStatusV1(statusInput);
    if (question.length < 1 || question.length > 500)
        fail("QUESTION_INVALID");
    assertSafeText(question);
    const normalized = question.toLowerCase();
    const topic = /progress|stage|status/.test(normalized)
        ? "PROGRESS"
        : /safe|authority|permission/.test(normalized)
            ? "SAFETY"
            : /template|quick|builder|business/.test(normalized)
                ? "TEMPLATE"
                : /repair|resume|failure|warning/.test(normalized)
                    ? "RECOVERY"
                    : "GENERAL";
    const answers = {
        PROGRESS: `${status.progress.completedStages}/${status.progress.totalStages} stages `
            + `are complete. Current action: ${status.currentAction}`,
        SAFETY: "Stage A has no shell or Control Plane authority and can apply only "
            + "declared, idempotent, owned-state actions.",
        TEMPLATE: `Template ${status.template.displayName} is bound to `
            + `${status.template.manifestDigest}.`,
        RECOVERY: status.warnings.length > 0
            ? `Diagnosis is available for ${status.warnings.join(", ")}.`
            : "No active warning requires repair.",
        GENERAL: "I can explain setup progress, safety, templates and bounded recovery.",
    };
    return {
        providerId: "DETERMINISTIC_ADMIN_ASSISTANT_V1",
        questionDigest: digest({ question }),
        topic,
        answer: answers[topic],
        persistedQuestionText: false,
    };
}
