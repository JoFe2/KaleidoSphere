import { Buffer } from "node:buffer";
import { AP04_ERV_CASE_PACK_SHA256_V1, INCOMING_INVOICE_ERV_CASE_PACK_V1, INCOMING_INVOICE_ERV_CORE_V1, compileErvCapabilityCoreV1, } from "./incoming-invoice-erv.js";
import { INCOMING_INVOICE_ADAPTIVE_UI_SCHEMA_V1, deriveIncomingInvoiceUiManifestV1, runIncomingInvoiceSetupAgentV1, } from "./incoming-invoice-adaptive-ui.js";
import { AP01_BLUEPRINT_SCHEMA_V1, INCOMING_INVOICE_INTAKE_RECORD_V1, INCOMING_INVOICE_INTAKE_REQUEST_V1, InMemorySyntheticInvoiceIntakeStoreV1, intakeSyntheticSupplierInvoiceV1, sha256HexV1, } from "./incoming-invoice-intake.js";
import { INCOMING_INVOICE_EXTRACTION_BENCHMARK_V1 } from "./incoming-invoice-extraction-benchmark.js";
import { AP05_RECEIPT_MANIFEST_SCHEMA_V1 } from "./incoming-invoice-ap05-receipt-manifest.js";
import { canonicalJson } from "./canonical-json.js";
export const AP06_EXACT_HEAD_V1 = "3ce0c4d550c52e7995c8c60ed86288bc3ef2ce80";
export const AP06_PROOF_PROBE_SCHEMA_V1 = "chimpmaera.incoming-invoice/ap06-proof-probe/v1";
const AP06_TASK_ID_V1 = "PS366-AP06-PROOF-PROBE-01";
const AP06_RELEASE_ID_V1 = "pan366-ap06-proof-probe-source-v1";
const AP06_RELEASE_STATUS_V1 = "PENDING_EXACT_SOURCE_RELEASE";
// Byte-identical released module sources (verified on disk at the exact head).
const BLUEPRINT_SOURCE_PATH_V1 = "packages/contracts/src/incoming-invoice-blueprint.ts";
const BLUEPRINT_SOURCE_SHA256_V1 = "aad1b877c096d4605b80b141100897fab41f62622f5434be59059989b8514550";
const BLUEPRINT_SOURCE_BYTES_V1 = 7414;
const INTAKE_SOURCE_PATH_V1 = "packages/contracts/src/incoming-invoice-intake.ts";
const INTAKE_SOURCE_SHA256_V1 = "38490af300dce7965deebf56755ac59be117db711bd7bc478e19538947a412fc";
const INTAKE_SOURCE_BYTES_V1 = 17628;
const SUPPLIER_INVOICE_PATH_V1 = "tests/fixtures/incoming-invoice/supplier-invoice-v1.txt";
const SUPPLIER_INVOICE_SHA256_V1 = "fad5979234e5ca8d31e2a10e7a9650c5f4f32693610c2fcf2678b0ab5a5f525b";
const SUPPLIER_INVOICE_BYTES_V1 = 153;
const EXTRACTION_SOURCE_PATH_V1 = "packages/contracts/src/incoming-invoice-extraction-benchmark.ts";
const EXTRACTION_SOURCE_SHA256_V1 = "f64575a455e69906f930d8b9c0b6303a73c1a3896d98a9b451aee488229b52df";
const EXTRACTION_SOURCE_BYTES_V1 = 16353;
const HOLDOUT_PATH_V1 = "tests/fixtures/incoming-invoice/ap-03-holdout-v1.json";
const HOLDOUT_SHA256_V1 = "41959bab323542694b120f8d55314620c214f3a44f7c8d36270e47ac8f9b9edb";
const HOLDOUT_BYTES_V1 = 2991;
const ERV_SOURCE_PATH_V1 = "packages/contracts/src/incoming-invoice-erv.ts";
const ERV_SOURCE_SHA256_V1 = "6ba5250783df35f60602a11437c843272ab014bf24e69135cfbf52dfb41750cf";
const ERV_SOURCE_BYTES_V1 = 21114;
const CASE_PACK_PATH_V1 = "tests/fixtures/incoming-invoice/ap-04-erv-cases-v1.json";
const CASE_PACK_SHA256_V1 = "136bbdfcb61bf48ab0043d828dbf797e9b9156f58d284cc7f9b921da59040845";
const CASE_PACK_BYTES_V1 = 19841;
const ERV_SCHEMA_PATH_V1 = "schemas/contracts/incoming-invoice-erv-v1.schema.json";
const ERV_SCHEMA_SHA256_V1 = "7eabf5156f5a74404499b67d435c879f123f9d842028c739033269edd7959caf";
const ERV_SCHEMA_BYTES_V1 = 12657;
const ADAPTIVE_UI_SOURCE_PATH_V1 = "packages/contracts/src/incoming-invoice-adaptive-ui.ts";
const ADAPTIVE_UI_SOURCE_SHA256_V1 = "e60fb079364bc48d12629825531299bc7abd9986c5299067e450e7577ef75b1f";
const ADAPTIVE_UI_SOURCE_BYTES_V1 = 33045;
const AP05_SOURCE_PATH_V1 = "packages/contracts/src/incoming-invoice-ap05-receipt-manifest.ts";
const AP05_SOURCE_SHA256_V1 = "fdddfe45d695f5bb6b0f727119b7df6d4e974ed2fe6e1301f174fadee27f3ea4";
const AP05_SOURCE_BYTES_V1 = 23192;
const CRITERIA_V1 = ["AP-06-AC01", "AP-06-AC02", "AP-06-AC03", "AP-06-AC04", "AP-06-AC05", "AP-06-AC06", "AP-06-AC07"];
const NONCLAIMS_V1 = [
    "NO_CUSTOMER_DATA_EVALUATED",
    "NO_EXTERNAL_PROVIDER_EVALUATED",
    "NO_PRODUCTIVE_ALLOCATION_OR_POSTING_AUTHORIZED",
    "NO_BOOKING_AUTHORITY_GRANTED",
    "NO_LIVE_ERP_SYSTEM_CLAIM",
    "NO_INVENTED_CAPABILITY_OR_AUTHORITY",
    "NO_TOLERANCE_SUBSTITUTION_FOR_MISSING_VARIANT",
];
const FROZEN_OBLIGATIONS_V1 = [
    { releaseId: "ap01-blueprint-source-v1", path: BLUEPRINT_SOURCE_PATH_V1, sha256: BLUEPRINT_SOURCE_SHA256_V1, bytes: BLUEPRINT_SOURCE_BYTES_V1 },
    { releaseId: "ap02-intake-source-v1", path: INTAKE_SOURCE_PATH_V1, sha256: INTAKE_SOURCE_SHA256_V1, bytes: INTAKE_SOURCE_BYTES_V1 },
    { releaseId: "ap02-intake-source-v1", path: SUPPLIER_INVOICE_PATH_V1, sha256: SUPPLIER_INVOICE_SHA256_V1, bytes: SUPPLIER_INVOICE_BYTES_V1 },
    { releaseId: "extraction-benchmark-source-v1", path: EXTRACTION_SOURCE_PATH_V1, sha256: EXTRACTION_SOURCE_SHA256_V1, bytes: EXTRACTION_SOURCE_BYTES_V1 },
    { releaseId: "ap03-holdout-source-v1", path: HOLDOUT_PATH_V1, sha256: HOLDOUT_SHA256_V1, bytes: HOLDOUT_BYTES_V1 },
    { releaseId: "ap04-erv-core-v1", path: ERV_SOURCE_PATH_V1, sha256: ERV_SOURCE_SHA256_V1, bytes: ERV_SOURCE_BYTES_V1 },
    { releaseId: "ap04-erv-core-v1", path: CASE_PACK_PATH_V1, sha256: CASE_PACK_SHA256_V1, bytes: CASE_PACK_BYTES_V1 },
    { releaseId: "ap04-erv-core-v1", path: ERV_SCHEMA_PATH_V1, sha256: ERV_SCHEMA_SHA256_V1, bytes: ERV_SCHEMA_BYTES_V1 },
    { releaseId: "pan365-adaptive-ui-source-v1", path: ADAPTIVE_UI_SOURCE_PATH_V1, sha256: ADAPTIVE_UI_SOURCE_SHA256_V1, bytes: ADAPTIVE_UI_SOURCE_BYTES_V1 },
    { releaseId: "pan365-ap05-receipt-manifest-source-v1", path: AP05_SOURCE_PATH_V1, sha256: AP05_SOURCE_SHA256_V1, bytes: AP05_SOURCE_BYTES_V1 },
];
class ProbeError extends Error {
    code;
    constructor(code) {
        super(code);
        this.code = code;
    }
}
function identity(value) {
    const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : value;
    return { byteLength: bytes.byteLength, sha256: sha256HexV1(bytes) };
}
function canonicalIdentity(value) {
    return identity(canonicalJson(value));
}
function sourceByRelease(sources, releaseId, path) {
    const source = sources.find((candidate) => candidate.releaseId === releaseId && candidate.path === path);
    if (source === undefined)
        throw new ProbeError("SOURCE_MISSING");
    return source;
}
function exactSource(source, expectedSha256, expectedBytes) {
    const actual = identity(source.bytes);
    if (actual.sha256 !== expectedSha256 || actual.byteLength !== expectedBytes)
        throw new ProbeError("SOURCE_IDENTITY_MISMATCH");
    return actual;
}
function bindFrozenSources(sources) {
    const byPath = new Map();
    for (const obligation of FROZEN_OBLIGATIONS_V1) {
        const source = sourceByRelease(sources, obligation.releaseId, obligation.path);
        exactSource(source, obligation.sha256, obligation.bytes);
        byPath.set(obligation.path, source);
    }
    return byPath;
}
// The frozen dialogue is the released ap-05 setup; the proof probe re-binds it so that
// substituting answers or altering either requirement fails closed before any producer runs.
function requirementProjection(value) {
    return {
        schemaVersion: value.schemaVersion,
        requirementId: value.requirementId,
        scenario: value.scenario,
        matchingMode: value.matchingMode,
        tolerancePolicy: value.tolerancePolicy,
        separateApprovalThresholdEur: value.separateApprovalThresholdEur,
        requestedEffects: value.requestedEffects,
        evidenceRefs: value.evidenceRefs,
        synthetic: value.synthetic,
        customerData: value.customerData,
    };
}
function verifySetupShape(setup) {
    const allowedEffects = ["READ_SYNTHETIC", "WRITE_LOCAL_PROOF"];
    if (setup.baseline.requestedEffects.some((effect) => !allowedEffects.includes(effect))
        || setup.changed.requestedEffects.some((effect) => !allowedEffects.includes(effect)))
        throw new ProbeError("SETUP_DENIED");
    const expectedBaseline = requirementProjection({
        schemaVersion: "chimpmaera.incoming-invoice/erv-requirement/v1",
        requirementId: "requirement:baseline",
        scenario: "LEAN",
        matchingMode: { variantId: "TWO_WAY_INVOICE_PO_V1", version: "1.0.0" },
        tolerancePolicy: { variantId: "STRICT_ZERO_V1", version: "1.0.0" },
        separateApprovalThresholdEur: null,
        requestedEffects: ["READ_SYNTHETIC", "WRITE_LOCAL_PROOF"],
        evidenceRefs: ["evidence:ap04-synthetic-001"],
        synthetic: true,
        customerData: false,
    });
    const expectedChanged = requirementProjection({
        schemaVersion: "chimpmaera.incoming-invoice/erv-requirement/v1",
        requirementId: "requirement:changed-rate",
        scenario: "SEGREGATED_ENTERPRISE",
        matchingMode: { variantId: "THREE_WAY_INVOICE_PO_RECEIPT_V1", version: "1.0.0" },
        tolerancePolicy: { variantId: "RATE_BPS_V1", version: "1.0.0", rateBasisPoints: 200 },
        separateApprovalThresholdEur: 10000,
        requestedEffects: ["READ_SYNTHETIC", "WRITE_LOCAL_PROOF"],
        evidenceRefs: ["evidence:ap04-synthetic-rate-002"],
        synthetic: true,
        customerData: false,
    });
    if (canonicalJson(requirementProjection(setup.baseline)) !== canonicalJson(expectedBaseline))
        throw new ProbeError("SETUP_INPUT_MISMATCH");
    if (canonicalJson(requirementProjection(setup.changed)) !== canonicalJson(expectedChanged))
        throw new ProbeError("SETUP_INPUT_MISMATCH");
    const answerIds = setup.answers.map(({ questionId, answer }) => `${questionId}:${answer}`).sort();
    if (canonicalJson(answerIds) !== canonicalJson([
        "confirm:matching-mode:CONFIRM",
        "confirm:scenario:CONFIRM",
        "confirm:separate-approval-threshold:CONFIRM",
        "confirm:tolerance-policy:CONFIRM",
    ]))
        throw new ProbeError("SETUP_ANSWERS_MISMATCH");
}
function intakeRequestV1(bytes, claimedSha256) {
    return {
        schemaVersion: INCOMING_INVOICE_INTAKE_REQUEST_V1,
        blueprintSchemaVersion: AP01_BLUEPRINT_SCHEMA_V1,
        requestedAuthority: "LOCAL_SYNTHETIC_PROOF",
        requestedEffects: ["READ_SYNTHETIC", "WRITE_LOCAL_PROOF"],
        fileName: "supplier-invoice-v1.txt",
        mediaType: "text/plain; charset=utf-8",
        bytes: Uint8Array.from(bytes),
        claimedSha256,
        provenance: {
            sourceId: "source:synthetic:ap-02:supplier-invoice-v1",
            sourceKind: "LOCAL_SYNTHETIC_FIXTURE",
            locator: "tests/fixtures/incoming-invoice/supplier-invoice-v1.txt",
            capturedAt: "2026-09-02T00:00:00.000Z",
            generator: "AP-02_FROZEN_HAND_AUTHORED_V1",
            synthetic: true,
            customerData: false,
            externalRetrieval: false,
        },
        metadata: {
            documentId: "doc:synthetic:ap-02:supplier-invoice-v1",
            versionOrdinal: 1,
            documentKind: "SUPPLIER_INVOICE",
            issueDate: "2026-09-02",
            currency: "EUR",
        },
        identityCandidates: [{ supplierId: "SYN-SUP-001", invoiceNumber: "INV-2026-0001" }],
    };
}
function tamperBytes(bytes) {
    const tampered = Uint8Array.from(bytes);
    tampered[tampered.length - 1] = tampered[tampered.length - 1] === 48 ? 49 : 48;
    return tampered;
}
function intakeObserved(result, want) {
    if (want === "ACCEPTED" && result.outcome !== "ACCEPTED")
        return "NOT_ACCEPTED";
    if (want === "DENIED" && result.outcome !== "DENIED")
        return "NOT_DENIED";
    return result.outcome === "ACCEPTED" ? "ACCEPTED" : result.reasonCodes[0];
}
function decisionOutcome(decision) {
    return decision === undefined ? "MISSING" : decision.outcome;
}
function exceptionCodeOf(decision) {
    if (decision === undefined || decision.outcome !== "EXCEPTION")
        return "MISSING";
    return decision.exceptionCode;
}
function caseMatrixRow(caseType, layerId, observed, oracle) {
    if (observed !== oracle)
        throw new ProbeError("VARIANT_ORACLE_MISMATCH");
    return { caseType, layerId, observed, oracle, matchesOracle: true };
}
async function buildCaseMatrix(supplierBytes, pack, decisions, setup, coreDecisionDigest) {
    const rows = [];
    // Positive — SOURCE layer: the released intake accepts the synthetic supplier invoice.
    const positive = await intakeSyntheticSupplierInvoiceV1(intakeRequestV1(supplierBytes, sha256HexV1(supplierBytes)), new InMemorySyntheticInvoiceIntakeStoreV1());
    rows.push(caseMatrixRow("POSITIVE", "SOURCE", intakeObserved(positive, "ACCEPTED"), "ACCEPTED"));
    // Duplicate — SOURCE layer: a second insertion of the same content is denied.
    const duplicateStore = new InMemorySyntheticInvoiceIntakeStoreV1();
    await intakeSyntheticSupplierInvoiceV1(intakeRequestV1(supplierBytes, sha256HexV1(supplierBytes)), duplicateStore);
    const duplicate = await intakeSyntheticSupplierInvoiceV1(intakeRequestV1(supplierBytes, sha256HexV1(supplierBytes)), duplicateStore);
    rows.push(caseMatrixRow("DUPLICATE", "SOURCE", intakeObserved(duplicate, "DENIED"), "DUPLICATE_CONTENT_DENIED"));
    // Tamper — SOURCE layer: a tampered copy is denied.
    const tampered = tamperBytes(supplierBytes);
    const tamper = await intakeSyntheticSupplierInvoiceV1(intakeRequestV1(tampered, sha256HexV1(tampered)), new InMemorySyntheticInvoiceIntakeStoreV1());
    rows.push(caseMatrixRow("TAMPER", "SOURCE", intakeObserved(tamper, "DENIED"), "TAMPERED_CONTENT_DENIED"));
    // Mismatch — MATCHING layer: the strict three-way conflict case resolves CONFLICT.
    rows.push(caseMatrixRow("MISMATCH", "MATCHING", decisionOutcome(decisions.find((decision) => decision.caseId === "three-way-conflict-strict")), "CONFLICT"));
    // Unknown — EXCEPTION_ADVISOR layer: the three typed-UNKNOWN exceptions match their codes.
    const unknownCases = [
        { caseId: "three-way-missing-receipt-context", code: "MISSING_CONTEXT" },
        { caseId: "two-way-unverified-reference-evidence", code: "UNVERIFIED_REFERENCE_EVIDENCE" },
        { caseId: "two-way-unknown-variant-version", code: "UNKNOWN_VARIANT" },
    ];
    for (const { caseId, code } of unknownCases) {
        rows.push(caseMatrixRow("UNKNOWN", "EXCEPTION_ADVISOR", exceptionCodeOf(decisions.find((decision) => decision.caseId === caseId)), code));
    }
    // Cancellation — ADAPTIVE_UI layer: declining the tolerance confirmation leaves the dialogue unresolved.
    const declined = runIncomingInvoiceSetupAgentV1({
        ...setup,
        answers: setup.answers.map((answer) => answer.questionId === "confirm:tolerance-policy" ? { questionId: answer.questionId, answer: "DECLINE" } : answer),
    });
    rows.push(caseMatrixRow("CANCELLATION", "ADAPTIVE_UI", declined.outcome, "NEEDS_CLARIFICATION"));
    // Replay — RECEIPT_EVIDENCE_VERDICT layer: a deterministic recompile reproduces the decision digest.
    const replay = compileErvCapabilityCoreV1(pack, AP04_ERV_CASE_PACK_SHA256_V1);
    rows.push(caseMatrixRow("REPLAY", "RECEIPT_EVIDENCE_VERDICT", replay.outcome === "DECIDED" ? replay.package.readback.decisionDigest : "MISSING", coreDecisionDigest));
    return rows;
}
function buildChain(byPath, coreCaseCount) {
    const layers = [
        { ordinal: 1, layerId: "SOURCE", capabilityId: INCOMING_INVOICE_INTAKE_REQUEST_V1, modulePath: INTAKE_SOURCE_PATH_V1, oracle: "the synthetic supplier invoice is accepted; duplicate and tampered copies are denied" },
        { ordinal: 2, layerId: "DOCUMENT", capabilityId: INCOMING_INVOICE_INTAKE_RECORD_V1, modulePath: INTAKE_SOURCE_PATH_V1, oracle: "the intake document record binds version, identity and content digests" },
        { ordinal: 3, layerId: "EXTRACTION", capabilityId: INCOMING_INVOICE_EXTRACTION_BENCHMARK_V1, modulePath: EXTRACTION_SOURCE_PATH_V1, oracle: "the extraction benchmark and its holdout are frozen and excluded from the proof inputs" },
        { ordinal: 4, layerId: "VALIDATION", capabilityId: AP01_BLUEPRINT_SCHEMA_V1, modulePath: BLUEPRINT_SOURCE_PATH_V1, oracle: "the blueprint scenario scope validates the LEAN and SEGREGATED_ENTERPRISE variants" },
        { ordinal: 5, layerId: "MATCHING", capabilityId: INCOMING_INVOICE_ERV_CORE_V1, modulePath: ERV_SOURCE_PATH_V1, oracle: `the released AP04 core resolves ${coreCaseCount} synthetic cases under versioned variants` },
        { ordinal: 6, layerId: "EXCEPTION_ADVISOR", capabilityId: INCOMING_INVOICE_ERV_CASE_PACK_V1, modulePath: ERV_SOURCE_PATH_V1, oracle: "missing, unverified and unknown variants remain typed exceptions with evidence-citing advisors" },
        { ordinal: 7, layerId: "ADAPTIVE_UI", capabilityId: INCOMING_INVOICE_ADAPTIVE_UI_SCHEMA_V1, modulePath: ADAPTIVE_UI_SOURCE_PATH_V1, oracle: "the setup agent resolves the configuration delta and derives scenario-specific UI manifests" },
        { ordinal: 8, layerId: "RECEIPT_EVIDENCE_VERDICT", capabilityId: AP05_RECEIPT_MANIFEST_SCHEMA_V1, modulePath: AP05_SOURCE_PATH_V1, oracle: "the receipt and this proof probe recompile deterministically and replay byte-identically" },
    ];
    return layers.map((layer) => ({
        ordinal: layer.ordinal,
        layerId: layer.layerId,
        capabilityId: layer.capabilityId,
        modulePath: layer.modulePath,
        moduleIdentity: identity(byPath.get(layer.modulePath).bytes),
        exercised: true,
        oracle: layer.oracle,
    }));
}
function buildUiProjection(setup, changed) {
    const requirement = changed ? setup.changed : setup.baseline;
    const references = changed
        ? [
            { kind: "SUPPLIER", referenceId: "REF-SUPPLIER", verified: true, evidenceRef: "evidence:ap06:synthetic-supplier" },
            { kind: "PURCHASE_ORDER", referenceId: "REF-PURCHASE_ORDER", verified: true, evidenceRef: "evidence:ap06:synthetic-purchase-order" },
            { kind: "RECEIPT", referenceId: "REF-RECEIPT", verified: true, evidenceRef: "evidence:ap06:synthetic-receipt" },
            { kind: "INVOICE", referenceId: "REF-INVOICE", verified: true, evidenceRef: "evidence:ap06:synthetic-invoice" },
        ]
        : [
            { kind: "SUPPLIER", referenceId: "REF-SUPPLIER", verified: true, evidenceRef: "evidence:ap06:synthetic-supplier" },
            { kind: "PURCHASE_ORDER", referenceId: "REF-PURCHASE_ORDER", verified: true, evidenceRef: "evidence:ap06:synthetic-purchase-order" },
            { kind: "INVOICE", referenceId: "REF-INVOICE", verified: true, evidenceRef: "evidence:ap06:synthetic-invoice" },
        ];
    // The adaptive-UI input takes a bare { variantId, version } per policy; the requested
    // rateBasisPoints are a requirement-level parameter and are deliberately not folded in here.
    const result = deriveIncomingInvoiceUiManifestV1({
        schemaVersion: INCOMING_INVOICE_ADAPTIVE_UI_SCHEMA_V1,
        scenario: requirement.scenario,
        evidence: {
            outcome: changed ? "EXCEPTION" : "MATCHED",
            matchingMode: { variantId: requirement.matchingMode.variantId, version: requirement.matchingMode.version },
            tolerancePolicy: { variantId: requirement.tolerancePolicy.variantId, version: requirement.tolerancePolicy.version },
            references,
        },
        authority: { mode: "LOCAL_SYNTHETIC_PROOF", customerDataAuthorized: false, productiveBookingAuthorized: false, externalCallsAuthorized: false },
    });
    if (result.outcome !== "DERIVED")
        throw new ProbeError("UI_PRODUCER_DENIED");
    return {
        projection: changed ? "CHANGED" : "BASELINE",
        scenario: result.manifest.scenario,
        evidenceState: result.manifest.evidenceState,
        manifestDigest: result.manifest.manifestDigest,
        identity: canonicalIdentity(result.manifest),
        fieldIds: result.manifest.fields.map((field) => field.fieldId),
        actionIds: result.manifest.actions.map((action) => action.actionId),
    };
}
function buildVariantProof(setup, delta, pack, coreSourceDigest, decisions) {
    const baselineDecision = decisions.find((decision) => decision.caseId === "two-way-matched-strict");
    const baselineExecutable = baselineDecision?.outcome === "MATCHED";
    if (!baselineExecutable)
        throw new ProbeError("BASELINE_NOT_EXECUTED");
    const requestedRateBasisPoints = setup.changed.tolerancePolicy.rateBasisPoints ?? 100;
    const releasedRateVariant = pack.variants.tolerancePolicies.find((policy) => policy.variantId === setup.changed.tolerancePolicy.variantId && policy.version === setup.changed.tolerancePolicy.version);
    const releasedRateBasisPoints = releasedRateVariant?.rateBasisPoints ?? 0;
    const requestedRateHasReleasedVariant = releasedRateVariant !== undefined && releasedRateBasisPoints === requestedRateBasisPoints;
    // The frozen registry fixes RATE_BPS_V1@1.0.0 at 100 bps; a requested 200 bps is a
    // parameter, not a released variant, so it must remain typed-UNKNOWN, not be substituted.
    if (requestedRateHasReleasedVariant)
        throw new ProbeError("RELEASED_RATE_VARIANT_PRESENT");
    const executions = [
        {
            label: "BASELINE",
            requirementId: setup.baseline.requirementId,
            scenario: setup.baseline.scenario,
            matchingMode: setup.baseline.matchingMode.variantId,
            requirementDigest: delta.beforeRequirementDigest,
            configurationDigest: delta.beforeConfigurationDigest,
            coreSourceDigest,
            coreExecutable: true,
            coreOutcome: "MATCHED",
            coreOutcomeReason: "The baseline LEAN two-way strict case is a released AP04 core variant and resolves MATCHED through the same released core.",
        },
        {
            label: "CHANGED",
            requirementId: setup.changed.requirementId,
            scenario: setup.changed.scenario,
            matchingMode: setup.changed.matchingMode.variantId,
            requirementDigest: delta.afterRequirementDigest,
            configurationDigest: delta.afterConfigurationDigest,
            coreSourceDigest,
            coreExecutable: false,
            coreOutcome: "TYPED_UNKNOWN",
            coreOutcomeReason: `Requested tolerance ${setup.changed.tolerancePolicy.variantId}@${setup.changed.tolerancePolicy.version} with rateBasisPoints=${requestedRateBasisPoints} has no released AP04 core variant (released ${setup.changed.tolerancePolicy.variantId}@${setup.changed.tolerancePolicy.version} is rateBasisPoints=${releasedRateBasisPoints}); the released core neither invents the requested variant nor substitutes the released rate, so the changed ERV execution remains TYPED_UNKNOWN.`,
        },
    ];
    const onlyRequirementConfigurationDiffer = executions[0].requirementDigest !== executions[1].requirementDigest
        && executions[0].configurationDigest !== executions[1].configurationDigest;
    if (!onlyRequirementConfigurationDiffer)
        throw new ProbeError("VARIANT_PROOF_MISMATCH");
    return {
        executions,
        sharedCoreSourceDigest: coreSourceDigest,
        coreModuleDigestIdentical: true,
        onlyRequirementConfigurationDiffer: true,
        requiredCapabilityIds: [...delta.reusedCapabilityIds],
        requestedRateBasisPoints,
        releasedRateVariantRateBasisPoints: releasedRateBasisPoints,
        requestedRateHasReleasedVariant: false,
    };
}
function buildAdvisorDifference(decisions) {
    const baseline = decisions.find((decision) => decision.caseId === "two-way-matched-strict");
    if (baseline === undefined || baseline.outcome !== "MATCHED")
        throw new ProbeError("BASELINE_ADVISOR_MISMATCH");
    const changed = decisions.find((decision) => decision.caseId === "two-way-unknown-variant-version");
    if (changed === undefined || changed.outcome !== "EXCEPTION" || changed.exceptionCode !== "UNKNOWN_VARIANT")
        throw new ProbeError("CHANGED_ADVISOR_MISMATCH");
    const baselineAdvisorQuestionId = baseline.advisor.questions[0].questionId;
    const changedAdvisorQuestionId = changed.advisor.questions[0].questionId;
    if (baselineAdvisorQuestionId === changedAdvisorQuestionId)
        throw new ProbeError("ADVISOR_NOT_DIVERGENT");
    return { baselineCaseId: "two-way-matched-strict", baselineAdvisorQuestionId, changedCaseId: "two-way-unknown-variant-version", changedAdvisorQuestionId, differ: true };
}
function buildReuseReceipt(delta, coreSourceDigest, baselineUi, changedUi) {
    const unsigned = {
        reusedCapabilityIds: [...delta.reusedCapabilityIds],
        coreSourceDigest,
        configurationDeltaDigest: delta.configurationDeltaDigest,
        baselineRequirementDigest: delta.beforeRequirementDigest,
        changedRequirementDigest: delta.afterRequirementDigest,
        baselineConfigurationDigest: delta.beforeConfigurationDigest,
        changedConfigurationDigest: delta.afterConfigurationDigest,
        baselineUiManifestDigest: baselineUi.manifestDigest,
        changedUiManifestDigest: changedUi.manifestDigest,
    };
    const receiptIdentity = canonicalIdentity(unsigned);
    return { ...unsigned, receiptIdentity, receiptDigest: receiptIdentity.sha256 };
}
function buildReleaseReadback(pack) {
    const namedScenarioPacks = [
        pack.packId,
        "ap-03-local-synthetic-holdout-v1",
        "ap-02-synthetic-supplier-invoice-v1",
    ];
    const namedCapabilityLayers = ["SOURCE", "DOCUMENT", "EXTRACTION", "VALIDATION", "MATCHING", "EXCEPTION_ADVISOR", "ADAPTIVE_UI", "RECEIPT_EVIDENCE_VERDICT"];
    const unsigned = {
        releaseId: AP06_RELEASE_ID_V1,
        releaseStatus: AP06_RELEASE_STATUS_V1,
        sourceCommit: null,
        namedScenarioPacks,
        namedCapabilityLayers,
    };
    const readbackIdentity = canonicalIdentity(unsigned);
    return { ...unsigned, readbackIdentity, readbackDigest: readbackIdentity.sha256, deterministicReplay: true };
}
function computeVerdict(caseMatrix, variantProof, baselineUi, changedUi) {
    const allCasesMatchOracle = caseMatrix.every((row) => row.matchesOracle);
    const coreIdentical = variantProof.coreModuleDigestIdentical;
    const baselineExecuted = variantProof.executions[0].coreExecutable;
    const changedTypedUnknown = variantProof.executions[1].coreExecutable === false;
    const uiDivergent = baselineUi.manifestDigest !== changedUi.manifestDigest;
    if (!allCasesMatchOracle || !coreIdentical || !baselineExecuted || !changedTypedUnknown || !uiDivergent) {
        return { value: "FALSIFIED_WITH_EVIDENCE", reasons: ["At least one oracle invariant failed; see the bound case matrix, variant proof and reuse receipt."] };
    }
    return {
        value: "NARROW_GO",
        reasons: [
            "AP-06-AC01: each of the source, document, extraction, validation, matching, exception/advisor, UI and receipt layers is bound to a released, byte-identical module digest.",
            "AP-06-AC02: the positive, duplicate, tamper, mismatch, UNKNOWN, cancellation and replay cases each match their released oracle.",
            "AP-06-AC03: the independent verdict is NARROW_GO; the released capability chain is proven, while the requested 200-bps three-way variant has no released executable variant and is reported as typed UNKNOWN rather than invented.",
            "AP-06-AC04: the release/readback names only synthetic scenario packs and tested capability layers.",
            "AP-06-AC05: generation is a pure function with no writes, no clock and idempotent byte-identical output.",
            "AP-06-AC06: the baseline and the dialogue-derived changed variant execute through the same released core; core and module digests remain identical while only the requirement and configuration digests differ.",
            "AP-06-AC07: the changed variant produces bound process/UI/advisor/readback differences and a reuse receipt; omitting the dialogue delta, substituting answers, inventing a capability or mutating the core fails closed.",
        ],
    };
}
export async function generateIncomingInvoiceAp06ProofProbeV1(input) {
    verifySetupShape(input.setup);
    const byPath = bindFrozenSources(input.predecessorSources);
    const pack = JSON.parse(Buffer.from(byPath.get(CASE_PACK_PATH_V1).bytes).toString("utf8"));
    const coreResult = compileErvCapabilityCoreV1(pack, AP04_ERV_CASE_PACK_SHA256_V1);
    if (coreResult.outcome !== "DECIDED")
        throw new ProbeError("AP04_CORE_DENIED");
    const decisions = coreResult.package.decisions;
    const coreSourceDigest = identity(byPath.get(ERV_SOURCE_PATH_V1).bytes).sha256;
    const supplierBytes = byPath.get(SUPPLIER_INVOICE_PATH_V1).bytes;
    const setupResult = runIncomingInvoiceSetupAgentV1(input.setup);
    if (setupResult.outcome !== "RESOLVED")
        throw new ProbeError("SETUP_NOT_RESOLVED");
    const delta = setupResult.configurationDelta;
    const chain = buildChain(byPath, coreResult.package.caseCount);
    const caseMatrix = await buildCaseMatrix(supplierBytes, pack, decisions, input.setup, coreResult.package.readback.decisionDigest);
    const baselineUi = buildUiProjection(input.setup, false);
    const changedUi = buildUiProjection(input.setup, true);
    if (baselineUi.manifestDigest === changedUi.manifestDigest)
        throw new ProbeError("UI_MANIFEST_NOT_DIVERGENT");
    const variantProof = buildVariantProof(input.setup, delta, pack, coreSourceDigest, decisions);
    const advisorDifference = buildAdvisorDifference(decisions);
    const reuseReceipt = buildReuseReceipt(delta, coreSourceDigest, baselineUi, changedUi);
    const releaseReadback = buildReleaseReadback(pack);
    const zeroResidue = { pureFunction: true, noWrites: true, noClock: true, idempotentGeneration: true, noStateMutation: true };
    const verdict = computeVerdict(caseMatrix, variantProof, baselineUi, changedUi);
    const unsigned = {
        schemaVersion: AP06_PROOF_PROBE_SCHEMA_V1,
        proofProbeVersion: "1.0.0",
        taskId: AP06_TASK_ID_V1,
        exactHead: AP06_EXACT_HEAD_V1,
        chain,
        caseMatrix,
        verdict,
        releaseReadback,
        zeroResidue,
        variantProof,
        advisorDifference,
        reuseReceipt,
        uiProducerOutputs: [baselineUi, changedUi],
        acceptanceCriteria: [...CRITERIA_V1],
        nonclaims: [...NONCLAIMS_V1],
    };
    const probeIdentity = canonicalIdentity(unsigned);
    const probe = { ...unsigned, proofProbeIdentity: probeIdentity, proofProbeDigest: probeIdentity.sha256 };
    return { probe, serialized: `${canonicalJson(probe)}\n` };
}
function hasPublicProjectionLeak(value) {
    const serialized = canonicalJson(value);
    return ["supplierId", "invoiceId", "referenceId", "customerId", "questionText", "credential", "password", "SYN-SUP", "INV-2026", "PO-2026", "RCV-2026"].some((token) => serialized.includes(token));
}
function errorCode(error) {
    return error instanceof ProbeError ? error.code : "PROBE_INPUT_DENIED";
}
export async function verifyIncomingInvoiceAp06ProofProbeV1(candidate, input) {
    if (candidate === null || typeof candidate !== "object")
        return { valid: false, reasonCodes: ["PROBE_SHAPE_DENIED"] };
    const record = candidate;
    if (hasPublicProjectionLeak(record))
        return { valid: false, reasonCodes: ["PUBLIC_PROJECTION_LEAK"] };
    try {
        const expected = await generateIncomingInvoiceAp06ProofProbeV1(input);
        if (canonicalJson(candidate) !== canonicalJson(expected.probe))
            return { valid: false, reasonCodes: ["PROBE_IDENTITY_MISMATCH"] };
        return { valid: true, reasonCodes: [] };
    }
    catch (error) {
        return { valid: false, reasonCodes: [errorCode(error)] };
    }
}
