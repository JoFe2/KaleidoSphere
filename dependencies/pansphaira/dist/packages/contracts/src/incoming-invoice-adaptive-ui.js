import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import { INCOMING_INVOICE_ERV_CASE_PACK_V1, INCOMING_INVOICE_ERV_CORE_V1 } from "./incoming-invoice-erv.js";
export const INCOMING_INVOICE_ADAPTIVE_UI_SCHEMA_V1 = "chimpmaera.incoming-invoice/adaptive-ui/v1";
export const INCOMING_INVOICE_APPLICATION_GUIDE_SCHEMA_V1 = "chimpmaera.incoming-invoice/application-guide/v1";
export const INCOMING_INVOICE_SETUP_DIALOGUE_SCHEMA_V1 = "chimpmaera.incoming-invoice/setup-dialogue/v1";
export const INCOMING_INVOICE_CONFIGURATION_DELTA_SCHEMA_V1 = "chimpmaera.incoming-invoice/configuration-delta/v1";
export const INCOMING_INVOICE_TOLERANCE_CONFIGURATION_SCHEMA_V1 = "chimpmaera.incoming-invoice/tolerance-configuration/v1";
const ALLOWED_EFFECTS = ["READ_SYNTHETIC", "WRITE_LOCAL_PROOF"];
const MATCHING_MODES = ["TWO_WAY_INVOICE_PO_V1", "THREE_WAY_INVOICE_PO_RECEIPT_V1"];
const TOLERANCE_POLICIES = ["STRICT_ZERO_V1", "ABS_MINOR_V1", "RATE_BPS_V1"];
const REFERENCE_KINDS = ["SUPPLIER", "PURCHASE_ORDER", "RECEIPT", "INVOICE"];
const CAPABILITY_IDS = [INCOMING_INVOICE_ERV_CORE_V1, INCOMING_INVOICE_ERV_CASE_PACK_V1];
function deepFreeze(value) {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
        for (const child of Object.values(value))
            deepFreeze(child);
        Object.freeze(value);
    }
    return value;
}
function digest(value) {
    return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, keys) {
    const expected = [...keys].sort();
    const actual = Object.keys(value).sort();
    return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function validVariant(value, allowed) {
    return validVariantShape(value) && allowed.includes(value.variantId);
}
function validVariantShape(value) {
    return isRecord(value) && exactKeys(value, ["variantId", "version"])
        && typeof value.variantId === "string" && value.variantId.length > 0
        && value.version === "1.0.0";
}
function validTolerancePolicyRequirementShape(value) {
    if (!isRecord(value) || !(exactKeys(value, ["variantId", "version"]) || exactKeys(value, ["variantId", "version", "rateBasisPoints"])))
        return false;
    if (typeof value.variantId !== "string" || value.variantId.length === 0 || value.version !== "1.0.0")
        return false;
    if (!Object.hasOwn(value, "rateBasisPoints"))
        return true;
    return value.variantId === "RATE_BPS_V1"
        && typeof value.rateBasisPoints === "number"
        && Number.isSafeInteger(value.rateBasisPoints)
        && value.rateBasisPoints >= 0
        && value.rateBasisPoints <= 10000;
}
function modeRequiredKinds(mode) {
    return mode === "TWO_WAY_INVOICE_PO_V1"
        ? ["SUPPLIER", "PURCHASE_ORDER", "INVOICE"]
        : ["SUPPLIER", "PURCHASE_ORDER", "RECEIPT", "INVOICE"];
}
function scenarioMatchingModeValid(scenario, mode) {
    return (scenario === "LEAN" && mode === "TWO_WAY_INVOICE_PO_V1")
        || (scenario !== "LEAN" && mode === "THREE_WAY_INVOICE_PO_RECEIPT_V1");
}
function thresholdValid(value) {
    return value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}
function approvalConfigurationValid(scenario, threshold) {
    return scenario === "SEGREGATED_ENTERPRISE"
        ? threshold !== null && threshold >= 10000
        : threshold === null;
}
function requirementValid(value) {
    if (!isRecord(value) || !exactKeys(value, ["schemaVersion", "requirementId", "scenario", "matchingMode", "tolerancePolicy", "separateApprovalThresholdEur", "requestedEffects", "evidenceRefs", "synthetic", "customerData"]))
        return false;
    return value.schemaVersion === "chimpmaera.incoming-invoice/erv-requirement/v1"
        && typeof value.requirementId === "string" && value.requirementId.length > 0
        && (value.scenario === "LEAN" || value.scenario === "CONTROLLED" || value.scenario === "SEGREGATED_ENTERPRISE")
        && validVariantShape(value.matchingMode)
        && validTolerancePolicyRequirementShape(value.tolerancePolicy)
        && thresholdValid(value.separateApprovalThresholdEur)
        && approvalConfigurationValid(value.scenario, value.separateApprovalThresholdEur)
        && Array.isArray(value.requestedEffects) && value.requestedEffects.every((effect) => typeof effect === "string")
        && Array.isArray(value.evidenceRefs) && value.evidenceRefs.every((ref) => typeof ref === "string" && ref.length > 0)
        && value.synthetic === true && value.customerData === false;
}
function referenceValid(value) {
    return isRecord(value) && exactKeys(value, ["kind", "referenceId", "verified", "evidenceRef"])
        && typeof value.kind === "string" && REFERENCE_KINDS.includes(value.kind)
        && typeof value.referenceId === "string" && value.referenceId.length > 0
        && typeof value.verified === "boolean" && typeof value.evidenceRef === "string" && value.evidenceRef.length > 0;
}
function uiInputValid(value) {
    if (!isRecord(value) || !exactKeys(value, ["schemaVersion", "scenario", "evidence", "authority"]))
        return false;
    if (value.schemaVersion !== INCOMING_INVOICE_ADAPTIVE_UI_SCHEMA_V1
        || !["LEAN", "CONTROLLED", "SEGREGATED_ENTERPRISE"].includes(value.scenario)
        || !isRecord(value.evidence) || !exactKeys(value.evidence, ["outcome", "matchingMode", "tolerancePolicy", "references"])
        || !["MATCHED", "CONFLICT", "EXCEPTION", "DENIED"].includes(value.evidence.outcome)
        || !validVariant(value.evidence.matchingMode, MATCHING_MODES)
        || !validVariant(value.evidence.tolerancePolicy, TOLERANCE_POLICIES)
        || !Array.isArray(value.evidence.references) || !value.evidence.references.every(referenceValid))
        return false;
    return isRecord(value.authority) && exactKeys(value.authority, ["mode", "customerDataAuthorized", "productiveBookingAuthorized", "externalCallsAuthorized"])
        && value.authority.mode === "LOCAL_SYNTHETIC_PROOF"
        && value.authority.customerDataAuthorized === false
        && value.authority.productiveBookingAuthorized === false
        && value.authority.externalCallsAuthorized === false;
}
function deniedUi(reasonCode) {
    return deepFreeze({ outcome: "DENIED", reasonCode });
}
export const INCOMING_INVOICE_APPLICATION_GUIDE_V1 = deepFreeze({
    schemaVersion: INCOMING_INVOICE_APPLICATION_GUIDE_SCHEMA_V1,
    guideVersion: "1.0.0",
    applicability: ["local synthetic incoming-invoice ERV evidence", "AP-04 versioned matching and tolerance variants"],
    variants: [
        { scenario: "LEAN", selectionRule: "AP-01 low-complexity scenario", capabilityIds: [...CAPABILITY_IDS], processVariant: "TWO_WAY_INVOICE_PO_V1" },
        { scenario: "CONTROLLED", selectionRule: "AP-01 controlled scenario", capabilityIds: [...CAPABILITY_IDS], processVariant: "THREE_WAY_INVOICE_PO_RECEIPT_V1" },
        { scenario: "SEGREGATED_ENTERPRISE", selectionRule: "AP-01 segregation-required scenario", capabilityIds: [...CAPABILITY_IDS], processVariant: "THREE_WAY_INVOICE_PO_RECEIPT_V1" },
    ],
    limits: ["Synthetic evidence only; no customer data or external retrieval", "Manifest actions are advisory/read-only and do not post, allocate or approve"],
    nonclaims: ["NO_PRODUCTION_FRONTEND_OR_LIVE_ERP_CLAIM", "NO_AUTONOMOUS_REQUIREMENTS_AUTHORITY", "NO_PRODUCTIVE_BOOKING_CLAIM"],
});
export function deriveIncomingInvoiceUiManifestV1(input) {
    if (isRecord(input) && isRecord(input.authority)
        && (input.authority.productiveBookingAuthorized === true
            || input.authority.customerDataAuthorized === true
            || input.authority.externalCallsAuthorized === true))
        return deniedUi("HIDDEN_AUTHORITY_DENIED");
    if (isRecord(input) && isRecord(input.evidence)) {
        const matchingMode = isRecord(input.evidence.matchingMode) ? input.evidence.matchingMode.variantId : undefined;
        const tolerancePolicy = isRecord(input.evidence.tolerancePolicy) ? input.evidence.tolerancePolicy.variantId : undefined;
        if ((typeof matchingMode === "string" && !MATCHING_MODES.includes(matchingMode))
            || (typeof tolerancePolicy === "string" && !TOLERANCE_POLICIES.includes(tolerancePolicy)))
            return deniedUi("UNSUPPORTED_ACTION_DENIED");
    }
    if (!uiInputValid(input))
        return deniedUi("INPUT_SHAPE_DENIED");
    if (!scenarioMatchingModeValid(input.scenario, input.evidence.matchingMode.variantId))
        return deniedUi("INPUT_SHAPE_DENIED");
    const required = modeRequiredKinds(input.evidence.matchingMode.variantId);
    const referencesByKind = new Map(input.evidence.references.map((reference) => [reference.kind, reference]));
    if (input.evidence.references.length === 0 || required.some((kind) => !referencesByKind.has(kind)))
        return deniedUi("CONTEXT_COLLAPSE_DENIED");
    const evidenceRefs = input.evidence.references.map(({ evidenceRef }) => evidenceRef);
    const fields = [
        { fieldId: "supplier", label: "Supplier", state: "VISIBLE", evidenceRefs: evidenceRefs.filter((_, index) => input.evidence.references[index]?.kind === "SUPPLIER") },
        { fieldId: "purchaseOrder", label: "Purchase order", state: "VISIBLE", evidenceRefs: evidenceRefs.filter((_, index) => input.evidence.references[index]?.kind === "PURCHASE_ORDER") },
    ];
    if (required.includes("RECEIPT"))
        fields.push({ fieldId: "receipt", label: "Receipt", state: "VISIBLE", evidenceRefs: evidenceRefs.filter((_, index) => input.evidence.references[index]?.kind === "RECEIPT") });
    fields.push({ fieldId: "invoice", label: "Invoice", state: "VISIBLE", evidenceRefs: evidenceRefs.filter((_, index) => input.evidence.references[index]?.kind === "INVOICE") });
    fields.push({ fieldId: "matchStatus", label: "Match status", state: "VISIBLE", evidenceRefs });
    if (input.scenario !== "LEAN")
        fields.push({ fieldId: "tolerancePolicy", label: "Tolerance policy", state: "VISIBLE", evidenceRefs });
    if (input.scenario === "SEGREGATED_ENTERPRISE") {
        fields.push({ fieldId: "approvalTrail", label: "Approval trail", state: "VISIBLE", evidenceRefs });
        fields.push({ fieldId: "separationOfDuties", label: "Separation of duties", state: "VISIBLE", evidenceRefs });
    }
    fields.push({ fieldId: "evidenceReferences", label: "Evidence references", state: "VISIBLE", evidenceRefs });
    const allVerified = input.evidence.references.every(({ verified }) => verified)
        && required.every((kind) => referencesByKind.get(kind)?.verified === true);
    const actions = [{ actionId: "VIEW_EVIDENCE", enabled: true, reason: "Evidence is available for read-only inspection.", evidenceRefs }];
    if (input.evidence.outcome === "MATCHED" && allVerified)
        actions.push({ actionId: "ACKNOWLEDGE_MATCH", enabled: true, reason: "All required evidence references are verified and matched.", evidenceRefs });
    if (input.evidence.outcome === "MATCHED" && !allVerified)
        actions.push({ actionId: "REQUEST_CLARIFICATION", enabled: true, reason: "A required reference is not verified; acknowledgement is withheld.", evidenceRefs });
    if (input.evidence.outcome === "CONFLICT")
        actions.push({ actionId: "IDENTIFY_AUTHORITATIVE_REFERENCE", enabled: true, reason: "Evidence conflicts; an authority decision is unresolved.", evidenceRefs });
    if (input.evidence.outcome === "EXCEPTION")
        actions.push({ actionId: "PROVIDE_MISSING_CONTEXT", enabled: true, reason: "The ERV exception requires additional evidence-backed context.", evidenceRefs });
    if (input.evidence.outcome === "DENIED")
        actions.push({ actionId: "VIEW_DENIAL", enabled: true, reason: "The ERV decision is denied and remains read-only.", evidenceRefs });
    if (input.scenario === "SEGREGATED_ENTERPRISE" && input.evidence.outcome === "CONFLICT")
        actions.push({ actionId: "ESCALATE_SEPARATION_REVIEW", enabled: true, reason: "Segregation-required conflicts need separation review.", evidenceRefs });
    const unsigned = {
        schemaVersion: INCOMING_INVOICE_ADAPTIVE_UI_SCHEMA_V1,
        manifestVersion: "1.0.0",
        scenario: input.scenario,
        evidenceState: input.evidence.outcome,
        fields,
        actions,
        reusedCapabilityIds: [...CAPABILITY_IDS],
        applicationGuideVersion: "1.0.0",
        authority: { mode: "LOCAL_SYNTHETIC_PROOF", bookingAuthorityGranted: false, externalCallsAuthorized: false },
    };
    return deepFreeze({ outcome: "DERIVED", manifest: { ...unsigned, manifestDigest: digest(unsigned) } });
}
function variantName(variant) { return `${variant.variantId}@${variant.version}`; }
function toleranceConfiguration(requirement) {
    const requestedRate = requirement.tolerancePolicy.rateBasisPoints;
    const isRatePolicy = requirement.tolerancePolicy.variantId === "RATE_BPS_V1";
    const unsigned = {
        schemaVersion: INCOMING_INVOICE_TOLERANCE_CONFIGURATION_SCHEMA_V1,
        configurationVersion: "1.0.0",
        selection: { variantId: requirement.tolerancePolicy.variantId, version: requirement.tolerancePolicy.version },
        rateBasisPoints: isRatePolicy ? requestedRate ?? 100 : null,
        resolution: isRatePolicy && requestedRate !== undefined ? "REQUESTED_PARAMETER" : "FROZEN_VARIANT_DEFAULT",
    };
    return deepFreeze({ ...unsigned, configurationDigest: digest(unsigned) });
}
function requirementDigest(requirement) { return digest(requirement); }
function configurationDigest(requirement) {
    return digest({
        scenario: requirement.scenario,
        matchingMode: requirement.matchingMode,
        tolerancePolicy: toleranceConfiguration(requirement),
        separateApprovalThresholdEur: requirement.separateApprovalThresholdEur,
        requestedEffects: requirement.requestedEffects,
    });
}
function transcript(turns) {
    const unsigned = { schemaVersion: INCOMING_INVOICE_SETUP_DIALOGUE_SCHEMA_V1, transcriptVersion: "1.0.0", syntheticEvidence: true, turns };
    return deepFreeze({ ...unsigned, transcriptDigest: digest(unsigned) });
}
function answerValid(value) {
    return isRecord(value) && exactKeys(value, ["questionId", "answer"])
        && typeof value.questionId === "string" && value.questionId.length > 0
        && (value.answer === "CONFIRM" || value.answer === "DECLINE");
}
function baseTurns(input) {
    return [
        { ordinal: 1, speaker: "SYSTEM", kind: "BASELINE_REQUIREMENT", payload: input.baseline, evidenceRefs: [...input.baseline.evidenceRefs].sort() },
        { ordinal: 2, speaker: "SYSTEM", kind: "CHANGED_REQUIREMENT", payload: input.changed, evidenceRefs: [...input.changed.evidenceRefs].sort() },
    ];
}
function setupDenied(input, gaps) {
    const turns = isRecord(input) && requirementValid(input.baseline) && requirementValid(input.changed)
        && Array.isArray(input.answers)
        ? baseTurns(input)
        : [
            { ordinal: 1, speaker: "SYSTEM", kind: "BASELINE_REQUIREMENT", payload: { invalid: true }, evidenceRefs: [] },
            { ordinal: 2, speaker: "SYSTEM", kind: "CHANGED_REQUIREMENT", payload: { invalid: true }, evidenceRefs: [] },
        ];
    const evidenceRefs = isRecord(input) && requirementValid(input.changed) ? [...input.changed.evidenceRefs].sort() : [];
    turns.push({ ordinal: turns.length + 1, speaker: "SYSTEM", kind: "OUTCOME", payload: { outcome: "DENIED_UNSUPPORTED", gaps: [...gaps].sort() }, evidenceRefs });
    return deepFreeze({ outcome: "DENIED_UNSUPPORTED", transcript: transcript(turns), unresolvedGaps: [...gaps].sort() });
}
export function runIncomingInvoiceSetupAgentV1(input) {
    if (!isRecord(input) || !exactKeys(input, ["baseline", "changed", "answers"]) || !requirementValid(input.baseline) || !requirementValid(input.changed) || !Array.isArray(input.answers) || !input.answers.every(answerValid)) {
        return setupDenied(input, ["INPUT_SHAPE_DENIED"]);
    }
    const setupInput = input;
    const unsupported = [
        ...(!MATCHING_MODES.includes(setupInput.baseline.matchingMode.variantId) ? ["UNSUPPORTED_MATCHING_MODE"] : []),
        ...(!MATCHING_MODES.includes(setupInput.changed.matchingMode.variantId) ? ["UNSUPPORTED_MATCHING_MODE"] : []),
        ...(!TOLERANCE_POLICIES.includes(setupInput.baseline.tolerancePolicy.variantId) ? ["UNSUPPORTED_TOLERANCE_POLICY"] : []),
        ...(!TOLERANCE_POLICIES.includes(setupInput.changed.tolerancePolicy.variantId) ? ["UNSUPPORTED_TOLERANCE_POLICY"] : []),
        ...(!scenarioMatchingModeValid(setupInput.baseline.scenario, setupInput.baseline.matchingMode.variantId) || !scenarioMatchingModeValid(setupInput.changed.scenario, setupInput.changed.matchingMode.variantId) ? ["UNSUPPORTED_SCENARIO_CONFIGURATION"] : []),
        ...setupInput.baseline.requestedEffects.filter((effect) => !ALLOWED_EFFECTS.includes(effect)).map(() => "UNSUPPORTED_EFFECT"),
        ...setupInput.changed.requestedEffects.filter((effect) => !ALLOWED_EFFECTS.includes(effect)).map(() => "UNSUPPORTED_EFFECT"),
    ];
    if (unsupported.length > 0)
        return setupDenied(setupInput, unsupported);
    const questions = [];
    const beforeToleranceConfiguration = toleranceConfiguration(setupInput.baseline);
    const afterToleranceConfiguration = toleranceConfiguration(setupInput.changed);
    const addQuestion = (questionId, setting) => {
        if (setupInput.changed.evidenceRefs.length === 0)
            questions.push({ questionId: `gap:${setting}`, setting, evidenceRefs: [] });
        else
            questions.push({ questionId, setting, evidenceRefs: [...setupInput.changed.evidenceRefs].sort() });
    };
    if (variantName(setupInput.baseline.matchingMode) !== variantName(setupInput.changed.matchingMode))
        addQuestion("confirm:matching-mode", "matchingMode");
    if (beforeToleranceConfiguration.configurationDigest !== afterToleranceConfiguration.configurationDigest)
        addQuestion("confirm:tolerance-policy", "tolerancePolicy");
    if (setupInput.baseline.scenario !== setupInput.changed.scenario)
        addQuestion("confirm:scenario", "scenario");
    if (setupInput.baseline.separateApprovalThresholdEur !== setupInput.changed.separateApprovalThresholdEur)
        addQuestion("confirm:separate-approval-threshold", "separateApprovalThresholdEur");
    const evidenceGaps = questions.filter(({ questionId }) => questionId.startsWith("gap:")).map(({ setting }) => `MISSING_EVIDENCE_FOR_${setting === "matchingMode" ? "MATCHING_MODE" : setting === "tolerancePolicy" ? "TOLERANCE_POLICY" : setting === "scenario" ? "SCENARIO" : "SEPARATE_APPROVAL_THRESHOLD"}`);
    const confirmQuestions = questions.filter(({ questionId }) => questionId.startsWith("confirm:")).sort((a, b) => a.questionId.localeCompare(b.questionId));
    const turns = baseTurns(setupInput);
    for (const question of confirmQuestions) {
        const requestedRate = question.setting === "tolerancePolicy" && setupInput.changed.tolerancePolicy.variantId === "RATE_BPS_V1"
            ? ` Requested rateBasisPoints=${setupInput.changed.tolerancePolicy.rateBasisPoints ?? 100}.`
            : "";
        turns.push({ ordinal: turns.length + 1, speaker: "AGENT", kind: "CLARIFICATION", payload: { questionId: question.questionId, question: `Confirm changed ${question.setting} from the evidence-backed AP-04 variant.${requestedRate}` }, evidenceRefs: question.evidenceRefs });
    }
    const answers = setupInput.answers.map((answer) => ({ questionId: answer.questionId, answer: answer.answer })).sort((a, b) => a.questionId.localeCompare(b.questionId) || a.answer.localeCompare(b.answer));
    const contradictions = answers.filter((answer, index) => index > 0 && answers[index - 1]?.questionId === answer.questionId && answers[index - 1]?.answer !== answer.answer);
    for (const answer of answers)
        turns.push({ ordinal: turns.length + 1, speaker: "OPERATOR", kind: "ANSWER", payload: answer, evidenceRefs: [...setupInput.changed.evidenceRefs].sort() });
    const gaps = [...evidenceGaps];
    if (contradictions.length > 0 || answers.some(({ questionId }) => !confirmQuestions.some((question) => question.questionId === questionId)))
        gaps.push("CONTRADICTORY_ANSWER");
    for (const question of confirmQuestions) {
        const matchingAnswers = answers.filter(({ questionId }) => questionId === question.questionId);
        if (matchingAnswers.length === 0)
            gaps.push(`UNANSWERED_${question.setting.toUpperCase()}`);
        else if (matchingAnswers.some(({ answer }) => answer !== "CONFIRM"))
            gaps.push(`DECLINED_${question.setting.toUpperCase()}`);
    }
    if (gaps.length > 0) {
        const orderedGaps = [...new Set(gaps)].sort();
        turns.push({ ordinal: turns.length + 1, speaker: "SYSTEM", kind: "OUTCOME", payload: { outcome: "NEEDS_CLARIFICATION", gaps: orderedGaps }, evidenceRefs: [...setupInput.changed.evidenceRefs].sort() });
        return deepFreeze({ outcome: "NEEDS_CLARIFICATION", transcript: transcript(turns), unresolvedGaps: orderedGaps });
    }
    const changedSettings = [];
    if (variantName(setupInput.baseline.matchingMode) !== variantName(setupInput.changed.matchingMode))
        changedSettings.push({ setting: "matchingMode", before: variantName(setupInput.baseline.matchingMode), after: variantName(setupInput.changed.matchingMode) });
    if (variantName(setupInput.baseline.tolerancePolicy) !== variantName(setupInput.changed.tolerancePolicy))
        changedSettings.push({ setting: "tolerancePolicy", before: variantName(setupInput.baseline.tolerancePolicy), after: variantName(setupInput.changed.tolerancePolicy) });
    if (beforeToleranceConfiguration.rateBasisPoints !== afterToleranceConfiguration.rateBasisPoints
        && (beforeToleranceConfiguration.rateBasisPoints !== null || afterToleranceConfiguration.rateBasisPoints !== null))
        changedSettings.push({
            setting: "toleranceRateBasisPoints",
            before: beforeToleranceConfiguration.rateBasisPoints === null ? "NONE" : String(beforeToleranceConfiguration.rateBasisPoints),
            after: afterToleranceConfiguration.rateBasisPoints === null ? "NONE" : String(afterToleranceConfiguration.rateBasisPoints),
        });
    if (setupInput.baseline.scenario !== setupInput.changed.scenario)
        changedSettings.push({ setting: "scenario", before: setupInput.baseline.scenario, after: setupInput.changed.scenario });
    if (setupInput.baseline.separateApprovalThresholdEur !== setupInput.changed.separateApprovalThresholdEur)
        changedSettings.push({
            setting: "separateApprovalThresholdEur",
            before: setupInput.baseline.separateApprovalThresholdEur === null ? "NONE" : String(setupInput.baseline.separateApprovalThresholdEur),
            after: setupInput.changed.separateApprovalThresholdEur === null ? "NONE" : String(setupInput.changed.separateApprovalThresholdEur),
        });
    const unsignedDelta = {
        schemaVersion: INCOMING_INVOICE_CONFIGURATION_DELTA_SCHEMA_V1,
        deltaVersion: "1.0.0",
        beforeRequirementDigest: requirementDigest(setupInput.baseline),
        afterRequirementDigest: requirementDigest(setupInput.changed),
        beforeConfigurationDigest: configurationDigest(setupInput.baseline),
        afterConfigurationDigest: configurationDigest(setupInput.changed),
        reusedCapabilityIds: [...CAPABILITY_IDS],
        changedSettings,
        configuration: { tolerancePolicy: afterToleranceConfiguration },
        evidenceReferences: [...new Set([...setupInput.baseline.evidenceRefs, ...setupInput.changed.evidenceRefs])].sort(),
        unresolvedGaps: [],
        authorityGranted: false,
        inventedExecutableFunctions: [],
    };
    const configurationDelta = deepFreeze({ ...unsignedDelta, configurationDeltaDigest: digest(unsignedDelta) });
    turns.push({ ordinal: turns.length + 1, speaker: "SYSTEM", kind: "OUTCOME", payload: { outcome: "RESOLVED", configurationDeltaDigest: configurationDelta.configurationDeltaDigest }, evidenceRefs: configurationDelta.evidenceReferences });
    return deepFreeze({ outcome: "RESOLVED", transcript: transcript(turns), configurationDelta });
}
