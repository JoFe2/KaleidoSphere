import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import { candidateSetDigestV1, validateForwardRequirementAnalysisV1, validateRequirementCandidateSetV1, } from "./cks-requirement-analysis.js";
export const KNOWLEDGE_SUFFICIENCY_PROOF_INPUT_SCHEMA_V1 = "pansphaira.cks/knowledge-sufficiency-proof-input/v1";
export const KNOWLEDGE_SUFFICIENCY_PROOF_SCHEMA_V1 = "pansphaira.cks/knowledge-sufficiency-proof/v1";
export const GAP_FINDER_RESULT_SCHEMA_V1 = "pansphaira.cks/separate-gap-finder-result/v1";
export const P13_FALSE_COMPLETENESS_PROOF_INPUT_SCHEMA_V1 = "pansphaira.cks/p13-false-completeness-proof-input/v1";
export const P13_FALSE_COMPLETENESS_PROOF_SCHEMA_V1 = "pansphaira.cks/p13-false-completeness-proof/v1";
export const P13_A0_RETRIEVAL_RECEIPT_SCHEMA_V1 = "pansphaira.cks/retrieval-attempt-receipt/v1";
export const SUFFICIENCY_AUTHORITY_BOUNDARY_V1 = "READ_ONLY_KNOWLEDGE_NO_CREDENTIAL_POLICY_CAPABILITY_TOOL_WRITE_OR_EXECUTION_AUTHORITY";
export const SUFFICIENCY_OUTCOMES_V1 = ["SUFFICIENT", "INSUFFICIENT", "BLOCKED"];
export const SUFFICIENCY_COMPONENT_OUTCOMES_V1 = ["PASS", "FAIL", "BLOCKED"];
export const SUFFICIENCY_GAP_CLASSES_V1 = [
    "NONE", "MISSING", "BAD_SOURCE", "APPLICABILITY", "CONFLICTING", "UNKNOWN_SEMANTIC",
];
export const SUFFICIENCY_REQUIREMENT_OUTCOMES_V1 = [
    "SATISFIED", "NOT_APPLICABLE", "GAP_MISSING", "GAP_BAD_SOURCE", "GAP_APPLICABILITY", "GAP_CONFLICTING", "GAP_UNKNOWN_SEMANTIC",
];
export const SUFFICIENCY_SOURCE_CLASSES_V1 = [
    "ACTIVE_CURATED_KNOWLEDGE", "PINNED_OWNER_EVIDENCE", "PINNED_PRIMARY_EVIDENCE", "PINNED_SECONDARY_EVIDENCE",
    "INTERNET_RESULT", "MODEL_RESULT", "UNKNOWN_SOURCE",
];
export const SUFFICIENCY_BOUNDARY_PROBES_V1 = [
    "MISSING", "BAD_SOURCE", "APPLICABILITY", "CONFLICTING", "UNKNOWN_SEMANTIC",
];
export const P13_ORACLE_OUTCOMES_V1 = ["SUFFICIENT", "INSUFFICIENT"];
export const SIMPLE_SOLVER_OUTCOMES_V1 = ["COMPLETE", "INCOMPLETE", "BLOCKED"];
const P13_A0_RETRIEVAL_OUTCOMES_V1 = [
    "QUALIFYING_MATCH", "NO_MATCH", "BAD_SOURCE", "APPLICABILITY", "CONFLICTING", "UNKNOWN_SEMANTIC", "BLOCKED",
];
const sha256 = (value) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const without = (value, key) => Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
const exactKeys = (value, keys) => isRecord(value) && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
const isId = (value) => typeof value === "string" && /^[a-z][a-z0-9-]{1,31}:[a-z0-9][a-z0-9._-]{2,95}$/.test(value);
const isDigest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const isText = (value, max) => typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value);
const oneOf = (value, values) => typeof value === "string" && values.includes(value);
const unique = (value, max, predicate) => Array.isArray(value) && value.length <= max && value.every(predicate) && new Set(value).size === value.length;
const digestWithout = (value, key) => sha256(without(value, key));
export const requirementBindingsDigestV1 = (value) => sha256(value);
export const p13RequirementKeyV1 = (caseId, requirementSetDigest, requirementId) => sha256({ caseId, requirementSetDigest, requirementId });
export const p13A0RetrievalReceiptDigestV1 = (value) => digestWithout(value, "receiptDigest");
export const p13A0RetrievalReceiptSetDigestV1 = (value) => sha256(value);
export const gapFinderItemDigestV1 = (value) => digestWithout(value, "resultDigest");
export const gapFinderResultDigestV1 = (value) => digestWithout(value, "finderDigest");
export const boundaryProbeDigestV1 = (value) => digestWithout(value, "probeDigest");
export const backwardClaimDigestV1 = (value) => digestWithout(value, "claimDigest");
export const backwardClaimProofDigestV1 = (value) => digestWithout(value, "proofDigest");
export const sufficiencyProofFixtureDigestV1 = (value) => digestWithout(value, "fixtureDigest");
export const sufficiencyProofDigestV1 = (value) => digestWithout(value, "proofDigest");
export const p13FixtureDigestV1 = (value) => digestWithout(value, "fixtureDigest");
export const p13ProofDigestV1 = (value) => digestWithout(value, "proofDigest");
const validSource = (value) => oneOf(value, SUFFICIENCY_SOURCE_CLASSES_V1);
const validGap = (value) => oneOf(value, SUFFICIENCY_GAP_CLASSES_V1);
const validRequirementOutcome = (value) => oneOf(value, SUFFICIENCY_REQUIREMENT_OUTCOMES_V1);
const validDigestList = (value, max) => unique(value, max, isDigest);
function gapCombinationValid(gapClass, outcome) {
    return gapClass === "NONE" ? outcome === "SATISFIED" || outcome === "NOT_APPLICABLE" : outcome === `GAP_${gapClass}`;
}
function validateGapItem(value) {
    if (!exactKeys(value, ["needDigest", "gapClass", "requirementOutcome", "sourceClasses", "evidenceDigests", "resultDigest"]))
        return false;
    return isDigest(value.needDigest) && validGap(value.gapClass) && validRequirementOutcome(value.requirementOutcome)
        && gapCombinationValid(value.gapClass, value.requirementOutcome)
        && unique(value.sourceClasses, SUFFICIENCY_SOURCE_CLASSES_V1.length, validSource)
        && validDigestList(value.evidenceDigests, 64) && isDigest(value.resultDigest)
        && gapFinderItemDigestV1(value) === value.resultDigest
        && (value.requirementOutcome === "SATISFIED"
            ? value.sourceClasses.length > 0 && value.sourceClasses.every((source) => source === "ACTIVE_CURATED_KNOWLEDGE")
            : value.requirementOutcome === "NOT_APPLICABLE" ? value.sourceClasses.length === 0 : true);
}
export function validateSeparateGapFinderResultV1(value) {
    if (!exactKeys(value, ["schemaVersion", "caseId", "requirementSetDigest", "knowledgeBundleDigest", "results", "finderDigest"]))
        return false;
    return value.schemaVersion === GAP_FINDER_RESULT_SCHEMA_V1 && isId(value.caseId) && isDigest(value.requirementSetDigest)
        && isDigest(value.knowledgeBundleDigest) && Array.isArray(value.results) && value.results.length > 0 && value.results.length <= 1024
        && value.results.every(validateGapItem) && new Set(value.results.map((item) => item.needDigest)).size === value.results.length
        && isDigest(value.finderDigest) && gapFinderResultDigestV1(value) === value.finderDigest;
}
function validateBinding(value) {
    return exactKeys(value, ["requirementId", "needDigest"]) && isId(value.requirementId) && isDigest(value.needDigest);
}
function validateBoundaryProbe(value) {
    if (!exactKeys(value, ["probeId", "probeClass", "needDigest", "expectedOutcome", "observedOutcome", "sourceClasses", "evidenceDigests", "probeDigest"]))
        return false;
    return isId(value.probeId) && oneOf(value.probeClass, SUFFICIENCY_BOUNDARY_PROBES_V1) && isDigest(value.needDigest)
        && oneOf(value.expectedOutcome, ["INSUFFICIENT", "BLOCKED"])
        && oneOf(value.observedOutcome, ["INSUFFICIENT", "BLOCKED"])
        && unique(value.sourceClasses, SUFFICIENCY_SOURCE_CLASSES_V1.length, validSource)
        && validDigestList(value.evidenceDigests, 64) && isDigest(value.probeDigest)
        && boundaryProbeDigestV1(value) === value.probeDigest;
}
function validateClaim(value) {
    if (!exactKeys(value, ["needDigest", "claimOutcome", "proofState", "sourceClasses", "evidenceDigests", "claimDigest"]))
        return false;
    return isDigest(value.needDigest) && oneOf(value.claimOutcome, ["SATISFIED", "NOT_APPLICABLE"])
        && oneOf(value.proofState, ["PROVEN", "UNPROVEN"])
        && unique(value.sourceClasses, SUFFICIENCY_SOURCE_CLASSES_V1.length, validSource)
        && validDigestList(value.evidenceDigests, 64) && isDigest(value.claimDigest)
        && backwardClaimDigestV1(value) === value.claimDigest
        && (value.proofState === "PROVEN"
            ? (value.claimOutcome === "SATISFIED" && value.sourceClasses.length > 0 && value.sourceClasses.every((source) => source === "ACTIVE_CURATED_KNOWLEDGE"))
                || (value.claimOutcome === "NOT_APPLICABLE" && value.sourceClasses.length === 0)
            : true);
}
function validateBackwardClaimProof(value) {
    if (!exactKeys(value, ["claims", "proofStatus", "proofDigest"]))
        return false;
    return Array.isArray(value.claims) && value.claims.length > 0 && value.claims.length <= 1024 && value.claims.every(validateClaim)
        && new Set(value.claims.map((claim) => claim.needDigest)).size === value.claims.length
        && oneOf(value.proofStatus, ["PASS", "FAIL"]) && isDigest(value.proofDigest)
        && backwardClaimProofDigestV1(value) === value.proofDigest
        && (value.proofStatus === "PASS" ? value.claims.every((claim) => claim.proofState === "PROVEN") : true);
}
function validateP13A0RetrievalReceipt(value) {
    if (!exactKeys(value, [
        "schemaVersion", "caseId", "requirementKey", "attemptOrdinal", "level", "strategyId", "queryDigest",
        "knowledgeBundleDigest", "outcome", "candidateEnvelopeDigests", "selectedEnvelopeDigests", "reasonCodes", "receiptDigest",
    ]))
        return false;
    return value.schemaVersion === P13_A0_RETRIEVAL_RECEIPT_SCHEMA_V1 && isId(value.caseId) && isDigest(value.requirementKey)
        && value.attemptOrdinal === 0 && value.level === "A0" && isText(value.strategyId, 128) && isDigest(value.queryDigest)
        && isDigest(value.knowledgeBundleDigest) && oneOf(value.outcome, P13_A0_RETRIEVAL_OUTCOMES_V1)
        && validDigestList(value.candidateEnvelopeDigests, 20) && validDigestList(value.selectedEnvelopeDigests, 20)
        && value.selectedEnvelopeDigests
            .every((digest) => value.candidateEnvelopeDigests.includes(digest))
        && unique(value.reasonCodes, 20, (reason) => isText(reason, 128))
        && isDigest(value.receiptDigest) && p13A0RetrievalReceiptDigestV1(value) === value.receiptDigest;
}
function p13ComparatorInputsValid(value, forward) {
    if (!validateRequirementCandidateSetV1(value.requirementCandidates)
        || candidateSetDigestV1(value.requirementCandidates) !== forward.candidateSetDigest
        || !Array.isArray(value.a0RetrievalReceipts) || value.a0RetrievalReceipts.length > 1024
        || !value.a0RetrievalReceipts.every(validateP13A0RetrievalReceipt)
        || !isDigest(value.a0RetrievalReceiptSetDigest)
        || p13A0RetrievalReceiptSetDigestV1(value.a0RetrievalReceipts) !== value.a0RetrievalReceiptSetDigest)
        return false;
    const receipts = value.a0RetrievalReceipts;
    const expectedRequirementKeys = forward.requirements
        .filter((requirement) => requirement.applicability === "APPLICABLE")
        .map((requirement) => p13RequirementKeyV1(forward.caseId, forward.requirementSetDigest, requirement.requirementId));
    return expectedRequirementKeys.length > 0
        && canonicalJson(receipts.map((receipt) => receipt.requirementKey)) === canonicalJson(expectedRequirementKeys)
        && receipts.every((receipt) => receipt.caseId === forward.caseId);
}
function inputShapeValid(value) {
    if (!exactKeys(value, [
        "schemaVersion", "proofId", "caseId", "fixtureDigest", "requirementSetDigest", "knowledgeBundleDigest",
        "forwardRequirementAnalysis", "requirementCandidates", "a0RetrievalReceipts", "a0RetrievalReceiptSetDigest",
        "requirementBindings", "requirementBindingsDigest", "gapFinderResult",
        "boundaryProbes", "backwardClaimProof", "authorityBoundary",
    ]))
        return false;
    const forward = value.forwardRequirementAnalysis;
    const bindings = value.requirementBindings;
    return value.schemaVersion === KNOWLEDGE_SUFFICIENCY_PROOF_INPUT_SCHEMA_V1 && isId(value.proofId) && isId(value.caseId)
        && isDigest(value.fixtureDigest) && isDigest(value.requirementSetDigest) && isDigest(value.knowledgeBundleDigest)
        && validateForwardRequirementAnalysisV1(value.forwardRequirementAnalysis)
        && p13ComparatorInputsValid(value, forward)
        && value.a0RetrievalReceipts
            .every((receipt) => receipt.knowledgeBundleDigest === value.knowledgeBundleDigest)
        && Array.isArray(value.requirementBindings) && value.requirementBindings.length > 0 && value.requirementBindings.length <= 1024
        && value.requirementBindings.every(validateBinding)
        && new Set(value.requirementBindings.map((binding) => binding.requirementId)).size === value.requirementBindings.length
        && bindings.length === forward.requirements.length
        && forward.requirements.every((requirement) => bindings.some((binding) => binding.requirementId === requirement.requirementId))
        && new Set(value.requirementBindings.map((binding) => binding.needDigest)).size === value.requirementBindings.length
        && isDigest(value.requirementBindingsDigest) && requirementBindingsDigestV1(value.requirementBindings) === value.requirementBindingsDigest
        && validateSeparateGapFinderResultV1(value.gapFinderResult)
        && Array.isArray(value.boundaryProbes) && value.boundaryProbes.length <= 16 && value.boundaryProbes.every(validateBoundaryProbe)
        && new Set(value.boundaryProbes.map((probe) => probe.probeClass)).size === value.boundaryProbes.length
        && validateBackwardClaimProof(value.backwardClaimProof)
        && value.authorityBoundary === SUFFICIENCY_AUTHORITY_BOUNDARY_V1
        && value.forwardRequirementAnalysis.caseId === value.caseId
        && value.forwardRequirementAnalysis.requirementSetDigest === value.requirementSetDigest
        && value.gapFinderResult.caseId === value.caseId
        && value.gapFinderResult.requirementSetDigest === value.requirementSetDigest
        && value.gapFinderResult.knowledgeBundleDigest === value.knowledgeBundleDigest
        && sufficiencyProofFixtureDigestV1(value) === value.fixtureDigest;
}
export function validateKnowledgeSufficiencyProofInputV1(value) {
    return inputShapeValid(value);
}
const componentStatus = (value) => value ? "PASS" : "FAIL";
const distinct = (items) => [...new Set(items)];
function blockedProof(value, reasons) {
    const record = isRecord(value) ? value : {};
    const result = {
        schemaVersion: KNOWLEDGE_SUFFICIENCY_PROOF_SCHEMA_V1,
        proofId: isId(record.proofId) ? record.proofId : "proof:blocked",
        caseId: isId(record.caseId) ? record.caseId : "case:blocked",
        fixtureDigest: isDigest(record.fixtureDigest) ? record.fixtureDigest : sha256(null),
        requirementSetDigest: isDigest(record.requirementSetDigest) ? record.requirementSetDigest : sha256(null),
        knowledgeBundleDigest: isDigest(record.knowledgeBundleDigest) ? record.knowledgeBundleDigest : sha256(null),
        forwardOutcome: "BLOCKED", gapFinderOutcome: "BLOCKED", boundaryOutcome: "BLOCKED", backwardOutcome: "BLOCKED",
        blockedReasons: distinct(reasons.length > 0 ? reasons : ["DEPENDENCY_EVIDENCE_ABSENT"]),
        outcome: "BLOCKED", materialCompleteness: "NOT_MATERIAL_COMPLETE", authorityBoundary: SUFFICIENCY_AUTHORITY_BOUNDARY_V1,
    };
    return { ...result, proofDigest: sufficiencyProofDigestV1(result) };
}
function componentChecks(input) {
    const forward = input.forwardRequirementAnalysis.outcome === "PASS"
        && input.forwardRequirementAnalysis.requirements.every((item) => item.state === "SATISFIED" || item.state === "NOT_APPLICABLE");
    const forwardById = new Map(input.forwardRequirementAnalysis.requirements.map((item) => [item.requirementId, item]));
    const bindingByRequirement = new Map(input.requirementBindings.map((binding) => [binding.requirementId, binding.needDigest]));
    const gapByNeed = new Map(input.gapFinderResult.results.map((item) => [item.needDigest, item]));
    const gapFinder = input.requirementBindings.every((binding) => {
        const requirement = forwardById.get(binding.requirementId);
        const gap = gapByNeed.get(binding.needDigest);
        if (requirement === undefined || gap === undefined)
            return false;
        if (requirement.state === "SATISFIED")
            return gap.gapClass === "NONE" && gap.requirementOutcome === "SATISFIED";
        if (requirement.state === "NOT_APPLICABLE")
            return gap.gapClass === "NONE" && gap.requirementOutcome === "NOT_APPLICABLE";
        return gap.gapClass !== "NONE" && gap.requirementOutcome !== "SATISFIED" && gap.requirementOutcome !== "NOT_APPLICABLE";
    }) && input.gapFinderResult.results.length === input.requirementBindings.length
        && input.gapFinderResult.results.every((gap) => bindingByRequirement.has(input.requirementBindings.find((binding) => binding.needDigest === gap.needDigest)?.requirementId ?? ""));
    const requiredProbes = new Set(SUFFICIENCY_BOUNDARY_PROBES_V1);
    const boundary = input.boundaryProbes.length === requiredProbes.size
        && input.boundaryProbes.every((probe) => requiredProbes.has(probe.probeClass)
            && probe.expectedOutcome === probe.observedOutcome
            && (probe.observedOutcome === "INSUFFICIENT" || probe.observedOutcome === "BLOCKED"));
    const claimsByNeed = new Map(input.backwardClaimProof.claims.map((claim) => [claim.needDigest, claim]));
    const backward = input.backwardClaimProof.proofStatus === "PASS"
        && input.requirementBindings.every((binding) => {
            const requirement = forwardById.get(binding.requirementId);
            const claim = claimsByNeed.get(binding.needDigest);
            if (requirement === undefined || claim === undefined || claim.proofState !== "PROVEN")
                return false;
            return requirement.state === "SATISFIED" ? claim.claimOutcome === "SATISFIED" : requirement.state === "NOT_APPLICABLE" && claim.claimOutcome === "NOT_APPLICABLE";
        })
        && input.backwardClaimProof.claims.length === input.requirementBindings.length;
    return { forward: componentStatus(forward), gapFinder: componentStatus(gapFinder), boundary: componentStatus(boundary), backward: componentStatus(backward) };
}
export function proveKnowledgeSufficiencyV1(input) {
    if (!inputShapeValid(input))
        return blockedProof(input, ["DEPENDENCY_SCHEMA_INVALID"]);
    const typed = input;
    if (typed.forwardRequirementAnalysis.outcome === "BLOCKED")
        return blockedProof(input, ["FORWARD_REQUIREMENT_ANALYSIS_BLOCKED"]);
    const components = componentChecks(typed);
    const allPass = Object.values(components).every((status) => status === "PASS");
    const result = {
        schemaVersion: KNOWLEDGE_SUFFICIENCY_PROOF_SCHEMA_V1,
        proofId: typed.proofId, caseId: typed.caseId, fixtureDigest: typed.fixtureDigest,
        requirementSetDigest: typed.requirementSetDigest, knowledgeBundleDigest: typed.knowledgeBundleDigest,
        forwardOutcome: components.forward, gapFinderOutcome: components.gapFinder, boundaryOutcome: components.boundary,
        backwardOutcome: components.backward, blockedReasons: [], outcome: allPass ? "SUFFICIENT" : "INSUFFICIENT",
        materialCompleteness: allPass ? "MATERIAL_COMPLETE" : "NOT_MATERIAL_COMPLETE",
        authorityBoundary: SUFFICIENCY_AUTHORITY_BOUNDARY_V1,
    };
    return { ...result, proofDigest: sufficiencyProofDigestV1(result) };
}
export const evaluateKnowledgeSufficiencyV1 = proveKnowledgeSufficiencyV1;
export const knowledgeSufficiencyProofV1 = proveKnowledgeSufficiencyV1;
export function validateKnowledgeSufficiencyProofV1(value) {
    if (!exactKeys(value, [
        "schemaVersion", "proofId", "caseId", "fixtureDigest", "requirementSetDigest", "knowledgeBundleDigest",
        "forwardOutcome", "gapFinderOutcome", "boundaryOutcome", "backwardOutcome", "blockedReasons", "outcome",
        "materialCompleteness", "authorityBoundary", "proofDigest",
    ]))
        return false;
    if (value.schemaVersion !== KNOWLEDGE_SUFFICIENCY_PROOF_SCHEMA_V1 || !isId(value.proofId) || !isId(value.caseId)
        || !isDigest(value.fixtureDigest) || !isDigest(value.requirementSetDigest) || !isDigest(value.knowledgeBundleDigest)
        || !oneOf(value.forwardOutcome, SUFFICIENCY_COMPONENT_OUTCOMES_V1) || !oneOf(value.gapFinderOutcome, SUFFICIENCY_COMPONENT_OUTCOMES_V1)
        || !oneOf(value.boundaryOutcome, SUFFICIENCY_COMPONENT_OUTCOMES_V1) || !oneOf(value.backwardOutcome, SUFFICIENCY_COMPONENT_OUTCOMES_V1)
        || !Array.isArray(value.blockedReasons) || !unique(value.blockedReasons, 8, (item) => isText(item, 128))
        || !oneOf(value.outcome, SUFFICIENCY_OUTCOMES_V1) || !oneOf(value.materialCompleteness, ["MATERIAL_COMPLETE", "NOT_MATERIAL_COMPLETE"])
        || value.authorityBoundary !== SUFFICIENCY_AUTHORITY_BOUNDARY_V1 || !isDigest(value.proofDigest)
        || sufficiencyProofDigestV1(value) !== value.proofDigest)
        return false;
    const allPass = value.forwardOutcome === "PASS" && value.gapFinderOutcome === "PASS" && value.boundaryOutcome === "PASS" && value.backwardOutcome === "PASS";
    return value.outcome === "SUFFICIENT" ? allPass && value.materialCompleteness === "MATERIAL_COMPLETE" && value.blockedReasons.length === 0
        : value.outcome === "INSUFFICIENT" ? !allPass && value.materialCompleteness === "NOT_MATERIAL_COMPLETE" && value.blockedReasons.length === 0
            : value.materialCompleteness === "NOT_MATERIAL_COMPLETE" && value.blockedReasons.length > 0;
}
function validateSimpleSolver(value) {
    if (!exactKeys(value, ["solverId", "inputDigest", "denominatorDigest"]))
        return false;
    const solver = value;
    return solver.solverId === "CKS-07-SIMPLE-SOLVER-V1" && isDigest(solver.inputDigest) && isDigest(solver.denominatorDigest);
}
function validateP13Case(value) {
    return exactKeys(value, ["caseId", "oracleOutcome", "denominatorDigest", "caseInputDigest", "proofInput", "simpleSolver"])
        && isId(value.caseId) && oneOf(value.oracleOutcome, P13_ORACLE_OUTCOMES_V1) && isDigest(value.denominatorDigest)
        && isDigest(value.caseInputDigest) && inputShapeValid(value.proofInput) && validateSimpleSolver(value.simpleSolver)
        && value.proofInput.caseId === value.caseId && value.proofInput.fixtureDigest === value.caseInputDigest
        && value.simpleSolver.inputDigest === value.caseInputDigest && value.simpleSolver.denominatorDigest === value.denominatorDigest;
}
export function validateP13FalseCompletenessProofInputV1(value) {
    if (!exactKeys(value, ["schemaVersion", "suiteId", "fixtureDigest", "denominatorDigest", "cases"]))
        return false;
    return value.schemaVersion === P13_FALSE_COMPLETENESS_PROOF_INPUT_SCHEMA_V1 && isId(value.suiteId) && isDigest(value.fixtureDigest)
        && isDigest(value.denominatorDigest) && Array.isArray(value.cases) && value.cases.length > 0 && value.cases.length <= 1024
        && value.cases.every(validateP13Case) && new Set(value.cases.map((item) => item.caseId)).size === value.cases.length
        && value.cases.every((item) => item.denominatorDigest === value.denominatorDigest)
        && p13FixtureDigestV1(value) === value.fixtureDigest;
}
function simpleSolverOutcome(value) {
    const applicable = value.forwardRequirementAnalysis.requirements.filter((requirement) => requirement.applicability === "APPLICABLE");
    const receiptByKey = new Map(value.a0RetrievalReceipts.map((receipt) => [receipt.requirementKey, receipt]));
    return value.requirementCandidates.length > 0 && applicable.length > 0 && applicable.every((requirement) => {
        const key = p13RequirementKeyV1(value.caseId, value.requirementSetDigest, requirement.requirementId);
        return (receiptByKey.get(key)?.candidateEnvelopeDigests.length ?? 0) > 0;
    }) ? "COMPLETE" : "INCOMPLETE";
}
function blockedP13(value, reasons) {
    const record = isRecord(value) ? value : {};
    const result = {
        schemaVersion: P13_FALSE_COMPLETENESS_PROOF_SCHEMA_V1,
        suiteId: isId(record.suiteId) ? record.suiteId : "suite:blocked",
        fixtureDigest: isDigest(record.fixtureDigest) ? record.fixtureDigest : sha256(null),
        denominatorDigest: isDigest(record.denominatorDigest) ? record.denominatorDigest : sha256(null),
        caseCount: 0, proofOutcome: "BLOCKED", metrics: null,
        blockedReasons: distinct(reasons.length > 0 ? reasons : ["COMPARATOR_INPUT_ABSENT"]),
        authorityBoundary: SUFFICIENCY_AUTHORITY_BOUNDARY_V1,
    };
    return { ...result, proofDigest: p13ProofDigestV1(result) };
}
export function proveP13FalseCompletenessV1(input) {
    if (!validateP13FalseCompletenessProofInputV1(input))
        return blockedP13(input, ["DEPENDENCY_SCHEMA_INVALID"]);
    const typed = input;
    const decisions = typed.cases.map((item) => ({
        oracle: item.oracleOutcome,
        combined: proveKnowledgeSufficiencyV1(item.proofInput),
        simple: simpleSolverOutcome(item.proofInput),
    }));
    if (decisions.some((decision) => decision.combined.outcome === "BLOCKED" || decision.simple === "BLOCKED")
        || !decisions.some((decision) => decision.oracle === "INSUFFICIENT")
        || !decisions.some((decision) => decision.oracle === "SUFFICIENT")) {
        return blockedP13(input, ["REQUIRED_DENOMINATOR_OR_CASE_EVIDENCE_ABSENT"]);
    }
    const insufficientOracleCases = decisions.filter((decision) => decision.oracle === "INSUFFICIENT").length;
    const sufficientOracleCases = decisions.filter((decision) => decision.oracle === "SUFFICIENT").length;
    const combinedFalseCompletenessCount = decisions.filter((decision) => decision.oracle === "INSUFFICIENT" && decision.combined.outcome === "SUFFICIENT").length;
    const simpleSolverFalseCompletenessCount = decisions.filter((decision) => decision.oracle === "INSUFFICIENT" && decision.simple === "COMPLETE").length;
    const combinedTrueCompletenessCount = decisions.filter((decision) => decision.oracle === "SUFFICIENT" && decision.combined.outcome === "SUFFICIENT").length;
    const metrics = {
        insufficientOracleCases, sufficientOracleCases, combinedFalseCompletenessCount, simpleSolverFalseCompletenessCount,
        combinedTrueCompletenessCount,
        combinedFalseCompletenessRate: combinedFalseCompletenessCount / insufficientOracleCases,
        simpleSolverFalseCompletenessRate: simpleSolverFalseCompletenessCount / insufficientOracleCases,
        falseCompletenessAbsoluteReduction: (simpleSolverFalseCompletenessCount - combinedFalseCompletenessCount) / insufficientOracleCases,
        combinedTrueCompletenessRate: combinedTrueCompletenessCount / sufficientOracleCases,
    };
    const passed = combinedFalseCompletenessCount === 0
        && simpleSolverFalseCompletenessCount > combinedFalseCompletenessCount
        && combinedTrueCompletenessCount === sufficientOracleCases;
    const result = {
        schemaVersion: P13_FALSE_COMPLETENESS_PROOF_SCHEMA_V1, suiteId: typed.suiteId, fixtureDigest: typed.fixtureDigest,
        denominatorDigest: typed.denominatorDigest, caseCount: typed.cases.length, proofOutcome: passed ? "PASS" : "FAIL",
        metrics, blockedReasons: [], authorityBoundary: SUFFICIENCY_AUTHORITY_BOUNDARY_V1,
    };
    return { ...result, proofDigest: p13ProofDigestV1(result) };
}
export const runP13FalseCompletenessProofV1 = proveP13FalseCompletenessV1;
export const proveFalseCompletenessReductionV1 = proveP13FalseCompletenessV1;
export function validateP13FalseCompletenessProofV1(value) {
    if (!exactKeys(value, ["schemaVersion", "suiteId", "fixtureDigest", "denominatorDigest", "caseCount", "proofOutcome", "metrics", "blockedReasons", "authorityBoundary", "proofDigest"]))
        return false;
    if (value.schemaVersion !== P13_FALSE_COMPLETENESS_PROOF_SCHEMA_V1 || !isId(value.suiteId) || !isDigest(value.fixtureDigest)
        || !isDigest(value.denominatorDigest) || !Number.isInteger(value.caseCount) || value.caseCount < 0
        || !oneOf(value.proofOutcome, SUFFICIENCY_COMPONENT_OUTCOMES_V1) || !Array.isArray(value.blockedReasons)
        || !unique(value.blockedReasons, 8, (item) => isText(item, 128))
        || value.authorityBoundary !== SUFFICIENCY_AUTHORITY_BOUNDARY_V1 || !isDigest(value.proofDigest)
        || p13ProofDigestV1(value) !== value.proofDigest)
        return false;
    if (value.proofOutcome === "BLOCKED")
        return value.metrics === null && value.blockedReasons.length > 0;
    if (value.blockedReasons.length > 0 || !isRecord(value.metrics))
        return false;
    const metricKeys = ["insufficientOracleCases", "sufficientOracleCases", "combinedFalseCompletenessCount", "simpleSolverFalseCompletenessCount", "combinedTrueCompletenessCount", "combinedFalseCompletenessRate", "simpleSolverFalseCompletenessRate", "falseCompletenessAbsoluteReduction", "combinedTrueCompletenessRate"];
    if (!exactKeys(value.metrics, metricKeys))
        return false;
    const metrics = value.metrics;
    const counts = metricKeys.slice(0, 5);
    const typedMetrics = metrics;
    if (!counts.every((key) => Number.isInteger(typedMetrics[key]) && typedMetrics[key] >= 0)
        || !metricKeys.slice(5).every((key) => typeof typedMetrics[key] === "number" && Number.isFinite(typedMetrics[key]) && typedMetrics[key] >= 0)
        || typedMetrics.insufficientOracleCases < 1 || typedMetrics.sufficientOracleCases < 1
        || typedMetrics.combinedFalseCompletenessCount > typedMetrics.insufficientOracleCases
        || typedMetrics.simpleSolverFalseCompletenessCount > typedMetrics.insufficientOracleCases
        || typedMetrics.combinedTrueCompletenessCount > typedMetrics.sufficientOracleCases
        || typedMetrics.combinedFalseCompletenessRate !== typedMetrics.combinedFalseCompletenessCount / typedMetrics.insufficientOracleCases
        || typedMetrics.simpleSolverFalseCompletenessRate !== typedMetrics.simpleSolverFalseCompletenessCount / typedMetrics.insufficientOracleCases
        || typedMetrics.falseCompletenessAbsoluteReduction !== (typedMetrics.simpleSolverFalseCompletenessCount - typedMetrics.combinedFalseCompletenessCount) / typedMetrics.insufficientOracleCases
        || typedMetrics.combinedTrueCompletenessRate !== typedMetrics.combinedTrueCompletenessCount / typedMetrics.sufficientOracleCases)
        return false;
    if (value.proofOutcome === "PASS")
        return typedMetrics.combinedFalseCompletenessCount === 0
            && typedMetrics.simpleSolverFalseCompletenessCount > typedMetrics.combinedFalseCompletenessCount
            && typedMetrics.combinedTrueCompletenessCount === typedMetrics.sufficientOracleCases;
    return true;
}
export function validateCksSufficiencyProofV1(value) {
    if (!isRecord(value) || typeof value.schemaVersion !== "string")
        return false;
    if (value.schemaVersion === KNOWLEDGE_SUFFICIENCY_PROOF_INPUT_SCHEMA_V1)
        return validateKnowledgeSufficiencyProofInputV1(value);
    if (value.schemaVersion === KNOWLEDGE_SUFFICIENCY_PROOF_SCHEMA_V1)
        return validateKnowledgeSufficiencyProofV1(value);
    if (value.schemaVersion === GAP_FINDER_RESULT_SCHEMA_V1)
        return validateSeparateGapFinderResultV1(value);
    if (value.schemaVersion === P13_FALSE_COMPLETENESS_PROOF_INPUT_SCHEMA_V1)
        return validateP13FalseCompletenessProofInputV1(value);
    if (value.schemaVersion === P13_FALSE_COMPLETENESS_PROOF_SCHEMA_V1)
        return validateP13FalseCompletenessProofV1(value);
    return false;
}
