import { Buffer } from "node:buffer";
import { AP04_ERV_CASE_PACK_SHA256_V1, compileErvCapabilityCoreV1, } from "./incoming-invoice-erv.js";
import { deriveIncomingInvoiceUiManifestV1, runIncomingInvoiceSetupAgentV1, } from "./incoming-invoice-adaptive-ui.js";
import { canonicalJson } from "./canonical-json.js";
import { sha256HexV1 } from "./incoming-invoice-intake.js";
export const AP05_EXACT_HEAD_V1 = "ef10d39fa7843e7c45e6e46cbc73647ad4a3ea2c";
export const AP05_RECEIPT_MANIFEST_SCHEMA_V1 = "chimpmaera.incoming-invoice/ap05-receipt-manifest/v1";
const AP04_MERGE_SHA_V1 = "ff68eda6cacc510ee67ed3b5b6cd51545f017a21";
const AP04_RELEASE_TAG_V1 = "pan377-current-head-docker-e2e-source-v1";
const AP04_CORE_SOURCE_SHA256_V1 = "6ba5250783df35f60602a11437c843272ab014bf24e69135cfbf52dfb41750cf";
const AP04_CORE_SOURCE_BYTES_V1 = 21114;
const AP04_SCHEMA_PATH_V1 = "schemas/contracts/incoming-invoice-erv-v1.schema.json";
const AP04_SCHEMA_SHA256_V1 = "7eabf5156f5a74404499b67d435c879f123f9d842028c739033269edd7959caf";
const AP04_SCHEMA_BYTES_V1 = 12657;
const AP04_CASE_PACK_BYTES_V1 = 19841;
const AP05_ADAPTIVE_MERGE_SHA_V1 = "988395110a9189d1b8cd4ee98184ed5c1d77a15d";
const AP05_FROZEN_TOLERANCE_MERGE_SHA_V1 = AP05_EXACT_HEAD_V1;
const ADAPTIVE_UI_RELEASE_SOURCE_SHA256_V1 = "69541b22c8545cf24ccb7e3004337cb6572209547ee926bc6d490954170a9aa4";
const ADAPTIVE_UI_RELEASE_SOURCE_BYTES_V1 = 29722;
const APPLICATION_GUIDE_RELEASE_SOURCE_SHA256_V1 = "01cd4350b05e2db5828b0bd7fbd1add2043b0f11b1e2bd4ff4b259cb6bf88547";
const APPLICATION_GUIDE_RELEASE_SOURCE_BYTES_V1 = 1697;
const FROZEN_ADAPTIVE_UI_SOURCE_SHA256_V1 = "e60fb079364bc48d12629825531299bc7abd9986c5299067e450e7577ef75b1f";
const FROZEN_ADAPTIVE_UI_SOURCE_BYTES_V1 = 33045;
const FROZEN_APPLICATION_GUIDE_SOURCE_SHA256_V1 = "8ee060c3f158810c93e097e83ab55297c0d976b92c0392fdd290d6d33a88b7bd";
const FROZEN_APPLICATION_GUIDE_SOURCE_BYTES_V1 = 2504;
const CASE_PACK_PATH_V1 = "tests/fixtures/incoming-invoice/ap-04-erv-cases-v1.json";
const ERV_SOURCE_PATH_V1 = "packages/contracts/src/incoming-invoice-erv.ts";
const ADAPTIVE_UI_SOURCE_PATH_V1 = "packages/contracts/src/incoming-invoice-adaptive-ui.ts";
const APPLICATION_GUIDE_PATH_V1 = "docs/INCOMING-INVOICE-APPLICATION-GUIDE.md";
const AP04_CLAIMED_PACK_SHA256_V1 = AP04_ERV_CASE_PACK_SHA256_V1;
const UNKNOWN_ADAPTED_REASON_V1 = "NO_RELEASED_AP04_CORE_VARIANT_FOR_200_BPS";
const UNKNOWN_OUTCOME_REASON_V1 = "ADAPTED_ERV_NOT_EXECUTED";
const CRITERIA_V1 = ["AP-05-AC01", "AP-05-AC02", "AP-05-AC03", "AP-05-AC04", "AP-05-AC05", "AP-05-AC06", "AP-05-AC07", "AP-05-AC08"];
const OUTCOMES_V1 = ["MATCHED", "CONFLICT", "EXCEPTION", "DENIED"];
const REFERENCE_KINDS_V1 = ["SUPPLIER", "PURCHASE_ORDER", "RECEIPT", "INVOICE"];
class ManifestError extends Error {
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
function canonicalIdentity(value) { return identity(canonicalJson(value)); }
function sourceByRelease(sources, releaseId, path) {
    const source = sources.find((candidate) => candidate.releaseId === releaseId && candidate.path === path);
    if (source === undefined)
        throw new ManifestError("SOURCE_MISSING");
    return source;
}
function exactSource(source, expectedSha256, expectedByteLength) {
    const actual = identity(source.bytes);
    if (actual.sha256 !== expectedSha256 || actual.byteLength !== expectedByteLength)
        throw new ManifestError("SOURCE_IDENTITY_MISMATCH");
    return actual;
}
function sourceRecord(source, expectedSha256, expectedByteLength, releaseIds) {
    return { path: source.path, identity: exactSource(source, expectedSha256, expectedByteLength), releaseIds };
}
function requirementMatches(value, expected) {
    return Object.entries(expected).every(([key, expectedValue]) => canonicalJson(value[key]) === canonicalJson(expectedValue));
}
function verifySetupShape(setup) {
    const common = { requestedEffects: ["READ_SYNTHETIC", "WRITE_LOCAL_PROOF"], synthetic: true, customerData: false };
    if (setup.baseline.requestedEffects.some((effect) => !common.requestedEffects.includes(effect)) || setup.changed.requestedEffects.some((effect) => !common.requestedEffects.includes(effect)))
        throw new ManifestError("SETUP_DENIED");
    if (!requirementMatches(setup.baseline, { ...common, requirementId: "requirement:baseline", scenario: "LEAN", matchingMode: { variantId: "TWO_WAY_INVOICE_PO_V1", version: "1.0.0" }, tolerancePolicy: { variantId: "STRICT_ZERO_V1", version: "1.0.0" }, separateApprovalThresholdEur: null, evidenceRefs: ["evidence:ap04-synthetic-001"] }))
        throw new ManifestError("SETUP_INPUT_MISMATCH");
    if (!requirementMatches(setup.changed, { ...common, requirementId: "requirement:changed-rate", scenario: "SEGREGATED_ENTERPRISE", matchingMode: { variantId: "THREE_WAY_INVOICE_PO_RECEIPT_V1", version: "1.0.0" }, tolerancePolicy: { variantId: "RATE_BPS_V1", version: "1.0.0", rateBasisPoints: 200 }, separateApprovalThresholdEur: 10000, evidenceRefs: ["evidence:ap04-synthetic-rate-002"] }))
        throw new ManifestError("SETUP_INPUT_MISMATCH");
    const answerIds = setup.answers.map(({ questionId, answer }) => `${questionId}:${answer}`).sort();
    if (canonicalJson(answerIds) !== canonicalJson([
        "confirm:matching-mode:CONFIRM",
        "confirm:scenario:CONFIRM",
        "confirm:separate-approval-threshold:CONFIRM",
        "confirm:tolerance-policy:CONFIRM",
    ]))
        throw new ManifestError("SETUP_ANSWERS_MISMATCH");
}
function publicDenominator(pack) {
    const byKind = { SUPPLIER: 0, PURCHASE_ORDER: 0, RECEIPT: 0, INVOICE: 0 };
    for (const entry of pack.cases)
        for (const reference of entry.references)
            byKind[reference.body.referenceKind] += 1;
    return { caseCount: pack.cases.length, decisionCount: pack.cases.length, referenceCount: Object.values(byKind).reduce((sum, count) => sum + count, 0), referenceCountByKind: byKind };
}
function uiProjection(pack, caseId, outcome, scenario, projection) {
    const entry = pack.cases.find((candidate) => candidate.caseId === caseId);
    if (entry === undefined)
        throw new ManifestError("UI_SOURCE_CASE_MISSING");
    const result = deriveIncomingInvoiceUiManifestV1({
        schemaVersion: "chimpmaera.incoming-invoice/adaptive-ui/v1",
        scenario,
        evidence: {
            outcome,
            matchingMode: entry.matchingMode,
            tolerancePolicy: entry.tolerancePolicy,
            references: entry.references.map((reference) => ({ kind: reference.body.referenceKind, referenceId: reference.body.referenceId, verified: true, evidenceRef: reference.evidence.locator })),
        },
        authority: { mode: "LOCAL_SYNTHETIC_PROOF", customerDataAuthorized: false, productiveBookingAuthorized: false, externalCallsAuthorized: false },
    });
    if (result.outcome !== "DERIVED")
        throw new ManifestError("UI_PRODUCER_DENIED");
    return {
        projection,
        evidenceState: outcome,
        manifestDigest: result.manifest.manifestDigest,
        identity: canonicalIdentity(result.manifest),
        fieldIds: result.manifest.fields.map(({ fieldId }) => fieldId),
        actionIds: result.manifest.actions.map(({ actionId }) => actionId),
    };
}
function outcomeCounts(decisions) {
    const counts = { MATCHED: 0, CONFLICT: 0, EXCEPTION: 0, DENIED: 0 };
    for (const decision of decisions)
        counts[decision.outcome] += 1;
    return counts;
}
function buildReceipt(pack, decisions) {
    const denominator = publicDenominator(pack);
    const baselineUnsigned = {
        schemaVersion: "chimpmaera.incoming-invoice/public-receipt/v1",
        authority: { mode: "NONE", evidenceClass: "PUBLIC_SYNTHETIC_NON_CUSTOMER", customerData: false, externalProvider: false, productiveEffect: false },
        denominator,
        rows: decisions.map((decision, index) => ({ ordinal: index + 1, outcome: decision.outcome, verifiedReferenceCount: decision.evidenceCitations.filter(({ verified }) => verified).length, referenceCount: decision.evidenceCitations.length })),
        outcomeCounts: outcomeCounts(decisions),
    };
    const adaptedOutcome = { state: "UNKNOWN", reasonCode: UNKNOWN_OUTCOME_REASON_V1 };
    const adaptedUnsigned = { denominator: { ...denominator, decisionCount: 0 }, rows: pack.cases.map((_, index) => ({ ordinal: index + 1, outcome: adaptedOutcome })), outcome: adaptedOutcome };
    return {
        schemaVersion: baselineUnsigned.schemaVersion,
        authority: baselineUnsigned.authority,
        baseline: { denominator, rows: baselineUnsigned.rows, outcomeCounts: baselineUnsigned.outcomeCounts, receiptIdentity: canonicalIdentity(baselineUnsigned) },
        adapted: { ...adaptedUnsigned, receiptIdentity: canonicalIdentity(adaptedUnsigned) },
    };
}
export function generateIncomingInvoiceAp05ReceiptManifestV1(input) {
    verifySetupShape(input.setup);
    const adaptiveUi = sourceByRelease(input.predecessorSources, "pan365-adaptive-ui-source-v1", ADAPTIVE_UI_SOURCE_PATH_V1);
    const guide = sourceByRelease(input.predecessorSources, "pan365-adaptive-ui-source-v1", APPLICATION_GUIDE_PATH_V1);
    const frozenAdaptiveUi = sourceByRelease(input.predecessorSources, "pan365-frozen-tolerance-source-v1", ADAPTIVE_UI_SOURCE_PATH_V1);
    const frozenGuide = sourceByRelease(input.predecessorSources, "pan365-frozen-tolerance-source-v1", APPLICATION_GUIDE_PATH_V1);
    const erv = sourceByRelease(input.predecessorSources, "ap04-erv-source-v1", ERV_SOURCE_PATH_V1);
    const casePackSource = sourceByRelease(input.predecessorSources, "ap04-erv-source-v1", CASE_PACK_PATH_V1);
    const schema = sourceByRelease(input.predecessorSources, "ap04-erv-source-v1", AP04_SCHEMA_PATH_V1);
    const sources = [
        sourceRecord(adaptiveUi, ADAPTIVE_UI_RELEASE_SOURCE_SHA256_V1, ADAPTIVE_UI_RELEASE_SOURCE_BYTES_V1, ["pan365-adaptive-ui-source-v1"]),
        sourceRecord(guide, APPLICATION_GUIDE_RELEASE_SOURCE_SHA256_V1, APPLICATION_GUIDE_RELEASE_SOURCE_BYTES_V1, ["pan365-adaptive-ui-source-v1"]),
        sourceRecord(frozenAdaptiveUi, FROZEN_ADAPTIVE_UI_SOURCE_SHA256_V1, FROZEN_ADAPTIVE_UI_SOURCE_BYTES_V1, ["pan365-frozen-tolerance-source-v1"]),
        sourceRecord(frozenGuide, FROZEN_APPLICATION_GUIDE_SOURCE_SHA256_V1, FROZEN_APPLICATION_GUIDE_SOURCE_BYTES_V1, ["pan365-frozen-tolerance-source-v1"]),
        sourceRecord(erv, AP04_CORE_SOURCE_SHA256_V1, AP04_CORE_SOURCE_BYTES_V1, [AP04_RELEASE_TAG_V1]),
        sourceRecord(casePackSource, AP04_ERV_CASE_PACK_SHA256_V1, AP04_CASE_PACK_BYTES_V1, [AP04_RELEASE_TAG_V1]),
        sourceRecord(schema, AP04_SCHEMA_SHA256_V1, AP04_SCHEMA_BYTES_V1, [AP04_RELEASE_TAG_V1]),
    ];
    const pack = JSON.parse(Buffer.from(casePackSource.bytes).toString("utf8"));
    const coreResult = compileErvCapabilityCoreV1(pack, AP04_CLAIMED_PACK_SHA256_V1);
    if (coreResult.outcome !== "DECIDED")
        throw new ManifestError("AP04_CORE_DENIED");
    const casePackIdentity = identity(casePackSource.bytes);
    const coreOutputIdentity = canonicalIdentity(coreResult.package);
    const setupResult = runIncomingInvoiceSetupAgentV1(input.setup);
    if (setupResult.outcome !== "RESOLVED")
        throw new ManifestError("SETUP_DENIED");
    const setupInputIdentity = canonicalIdentity(input.setup);
    const transcriptIdentity = canonicalIdentity(setupResult.transcript);
    const configurationIdentity = canonicalIdentity(setupResult.configurationDelta.configuration);
    const deltaIdentity = canonicalIdentity(setupResult.configurationDelta);
    const decisions = coreResult.package.decisions;
    const sourceCase = pack.cases.find((candidate) => candidate.matchingMode.variantId === "THREE_WAY_INVOICE_PO_RECEIPT_V1" && candidate.caseId === "three-way-matched-rate-tolerance");
    if (sourceCase === undefined)
        throw new ManifestError("UI_SOURCE_CASE_MISSING");
    const sourceDecision = decisions.find((candidate) => candidate.caseId === sourceCase.caseId);
    if (sourceDecision === undefined)
        throw new ManifestError("UI_SOURCE_DECISION_MISSING");
    const publicReceipt = buildReceipt(pack, decisions);
    const unsigned = {
        schemaVersion: AP05_RECEIPT_MANIFEST_SCHEMA_V1,
        manifestVersion: "1.0.0",
        taskId: "PS365-AP05-RECEIPT-MANIFEST-01",
        predecessorLineage: {
            exactHead: AP05_EXACT_HEAD_V1,
            releases: [
                { releaseId: "pan365-adaptive-ui-source-v1", releaseTag: "pan365-adaptive-ui-source-v1", mergeSha: AP05_ADAPTIVE_MERGE_SHA_V1, sourceCommit: AP05_ADAPTIVE_MERGE_SHA_V1, sourcePaths: [ADAPTIVE_UI_SOURCE_PATH_V1, APPLICATION_GUIDE_PATH_V1] },
                { releaseId: "pan365-frozen-tolerance-source-v1", releaseTag: "pan365-frozen-tolerance-source-v1", mergeSha: AP05_FROZEN_TOLERANCE_MERGE_SHA_V1, sourceCommit: AP05_FROZEN_TOLERANCE_MERGE_SHA_V1, sourcePaths: [ADAPTIVE_UI_SOURCE_PATH_V1, APPLICATION_GUIDE_PATH_V1] },
                { releaseId: "ap04-erv-source-v1", releaseTag: AP04_RELEASE_TAG_V1, mergeSha: AP04_MERGE_SHA_V1, sourceCommit: AP04_MERGE_SHA_V1, sourcePaths: [ERV_SOURCE_PATH_V1, CASE_PACK_PATH_V1, AP04_SCHEMA_PATH_V1] },
            ],
            sources,
        },
        sourceEvidenceRelease: {
            releaseId: "pan365-ap05-receipt-manifest-source-v1",
            releaseTag: "pan365-ap05-receipt-manifest-source-v1",
            releaseStatus: "PENDING_EXACT_SOURCE_RELEASE",
            sourceCommit: null,
            sourcePaths: [
                "packages/contracts/src/incoming-invoice-ap05-receipt-manifest.ts",
                "scripts/generate-incoming-invoice-ap05-receipt-manifest.mjs",
                "tests/fixtures/incoming-invoice/ap-05-frozen-setup-v1.json",
                "tests/incoming-invoice-ap05-receipt-manifest.test.ts",
            ],
        },
        externalPrerequisites: [{
                repository: "JoFe2/PANSPHAIRA",
                issueNumber: 364,
                required: true,
                status: "SOURCE_VERIFIED",
                boundPredecessor: {
                    releaseId: "ap04-erv-source-v1",
                    releaseTag: AP04_RELEASE_TAG_V1,
                    mergeSha: AP04_MERGE_SHA_V1,
                    sourceCommit: AP04_MERGE_SHA_V1,
                },
                boundArtifacts: [
                    { path: ERV_SOURCE_PATH_V1, identity: identity(erv.bytes) },
                    { path: AP04_SCHEMA_PATH_V1, identity: identity(schema.bytes) },
                ],
            }],
        ap04: {
            casePack: { path: CASE_PACK_PATH_V1, identity: casePackIdentity, canonicalSha256: coreResult.package.readback.packSha256 },
            coreOutput: { schemaVersion: coreResult.package.schemaVersion, caseCount: coreResult.package.caseCount, decisionDigest: coreResult.package.readback.decisionDigest, identity: coreOutputIdentity, deterministicReplay: true },
        },
        ap05Setup: {
            input: input.setup,
            answers: input.setup.answers,
            transcript: setupResult.transcript,
            transcriptIdentity,
            configurationDelta: setupResult.configurationDelta,
            configurationIdentity,
            deltaIdentity,
            inputIdentity: setupInputIdentity,
        },
        uiProducerOutputs: [
            uiProjection(pack, sourceCase.caseId, sourceDecision.outcome, "CONTROLLED", "BASELINE_SOURCE_EVIDENCE"),
            uiProjection(pack, sourceCase.caseId, sourceDecision.outcome, "SEGREGATED_ENTERPRISE", "CHANGED_CONFIGURATION_SOURCE_EVIDENCE"),
        ],
        sourceToReceiptProjectionRules: [
            "Project AP04 core decisions to ordinal, outcome, reference denominator and verification counts only.",
            "Omit source identifiers, amounts, advisor text, exception detail and all identity-bearing reference fields.",
            "Retain AP05 setup and configuration identities without treating configuration as an ERV execution result.",
            "Encode the adapted 200-bps ERV receipt as typed UNKNOWN because the released AP04 core has no such variant.",
        ],
        publicReceipt,
        acceptanceCriteria: [...CRITERIA_V1],
    };
    const manifestIdentity = canonicalIdentity(unsigned);
    const manifest = { ...unsigned, manifestIdentity, manifestDigest: manifestIdentity.sha256 };
    return { manifest, serialized: `${canonicalJson(manifest)}\n` };
}
function hasPublicProjectionLeak(value) {
    const serialized = canonicalJson(value);
    return ["supplierId", "invoiceId", "referenceId", "customerId", "questionText", "credential", "password", "SYN-SUP", "INV-2026", "PO-2026", "RCV-2026"].some((token) => serialized.includes(token));
}
function errorCode(error) { return error instanceof ManifestError ? error.code : "MANIFEST_INPUT_DENIED"; }
export function verifyIncomingInvoiceAp05ReceiptManifestV1(candidate, input) {
    if (candidate === null || typeof candidate !== "object")
        return { valid: false, reasonCodes: ["MANIFEST_SHAPE_DENIED"] };
    const record = candidate;
    if (isRecord(record.publicReceipt) && hasPublicProjectionLeak(record.publicReceipt))
        return { valid: false, reasonCodes: ["PUBLIC_PROJECTION_LEAK"] };
    try {
        const expected = generateIncomingInvoiceAp05ReceiptManifestV1(input).manifest;
        if (canonicalJson(candidate) !== canonicalJson(expected))
            return { valid: false, reasonCodes: ["MANIFEST_IDENTITY_MISMATCH"] };
        return { valid: true, reasonCodes: [] };
    }
    catch (error) {
        return { valid: false, reasonCodes: [errorCode(error)] };
    }
}
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
