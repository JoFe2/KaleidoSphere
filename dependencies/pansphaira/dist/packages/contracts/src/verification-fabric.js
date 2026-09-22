import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
export const VERIFICATION_FABRIC_BUNDLE_SCHEMA_V1 = "chimpmaera.verification/fabric-bundle/v1";
export const VERIFICATION_PLAN_SCHEMA_V1 = "chimpmaera.verification/plan/v1";
export const VERIFICATION_CHECK_RUN_SCHEMA_V1 = "chimpmaera.verification/check-run/v1";
export const VERIFICATION_EVIDENCE_BUNDLE_SCHEMA_V1 = "chimpmaera.verification/evidence-bundle/v1";
export const VERIFICATION_VERDICT_SCHEMA_V1 = "chimpmaera.verification/verdict/v1";
export const VERIFICATION_SELF_TEST_IDENTITY_SCHEMA_V1 = "chimpmaera.verification/self-test-identity/v1";
export const VERIFICATION_REVALIDATION_TRIGGER_SCHEMA_V1 = "chimpmaera.verification/revalidation-trigger/v1";
export const VERIFICATION_LKG_POINTER_SCHEMA_V1 = "chimpmaera.verification/lkg-pointer/v1";
export const VERIFICATION_LKG_READBACK_SCHEMA_V1 = "chimpmaera.verification/lkg-readback/v1";
const REASON_ORDER = [
    "SCHEMA_DENIED",
    "EVIDENCE_MISSING_DENIED",
    "EVIDENCE_STALE_DENIED",
    "EVIDENCE_MISMATCH_DENIED",
    "SELF_PRODUCED_EVIDENCE_DENIED",
    "CHECK_FAILED_DENIED",
    "LKG_CORRUPT_DENIED",
    "VERDICT_MISMATCH_DENIED",
];
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, keys) {
    return isRecord(value) && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}
function isId(value) {
    return typeof value === "string" && /^[a-z][a-z0-9-]{1,31}:[a-z0-9][a-z0-9._-]{2,95}$/.test(value);
}
function isDigest(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function isTimestamp(value) {
    // -0 is a safe integer that satisfies >= 0; the canonical boundary is +0 or positive.
    return Number.isSafeInteger(value) && !Object.is(value, -0) && value >= 0;
}
function isArtifactRef(value) {
    return typeof value === "string" && /^artifact:sha256:[a-f0-9]{64}$/.test(value);
}
function isUniqueStringArray(value, predicate) {
    return Array.isArray(value) && value.length > 0 && value.every(predicate)
        && new Set(value).size === value.length;
}
function contractDigest(value, digestKey) {
    const content = Object.fromEntries(Object.entries(value).filter(([key]) => key !== digestKey));
    return createHash("sha256").update(canonicalJson(content)).digest("hex");
}
function validPlan(value) {
    if (!exactKeys(value, [
        "schemaVersion", "planId", "subjectId", "subjectProducerId", "subjectDigest", "profileId",
        "issuedAtMs", "evidenceMaxAgeMs", "requiredCheckIds", "artifactRefs", "planDigest",
    ]))
        return false;
    return value.schemaVersion === VERIFICATION_PLAN_SCHEMA_V1
        && isId(value.planId) && isId(value.subjectId) && isId(value.subjectProducerId)
        && isDigest(value.subjectDigest) && isId(value.profileId) && isTimestamp(value.issuedAtMs)
        && Number.isSafeInteger(value.evidenceMaxAgeMs) && value.evidenceMaxAgeMs > 0
        && isUniqueStringArray(value.requiredCheckIds, isId)
        && isUniqueStringArray(value.artifactRefs, isArtifactRef) && isDigest(value.planDigest);
}
function validIdentity(value) {
    if (!exactKeys(value, [
        "schemaVersion", "verifierId", "producerId", "subjectProducerId", "independence", "issuedAtMs", "identityDigest",
    ]))
        return false;
    return value.schemaVersion === VERIFICATION_SELF_TEST_IDENTITY_SCHEMA_V1
        && isId(value.verifierId) && isId(value.producerId) && isId(value.subjectProducerId)
        && value.independence === "INDEPENDENT" && isTimestamp(value.issuedAtMs) && isDigest(value.identityDigest);
}
function validCheckRun(value) {
    if (!exactKeys(value, [
        "schemaVersion", "checkRunId", "checkId", "planDigest", "subjectDigest", "verifierId",
        "startedAtMs", "completedAtMs", "outcome", "runDigest",
    ]))
        return false;
    return value.schemaVersion === VERIFICATION_CHECK_RUN_SCHEMA_V1 && isId(value.checkRunId)
        && isId(value.checkId) && isDigest(value.planDigest) && isDigest(value.subjectDigest)
        && isId(value.verifierId) && isTimestamp(value.startedAtMs) && isTimestamp(value.completedAtMs)
        && ["PASS", "FAIL", "ERROR"].includes(value.outcome) && isDigest(value.runDigest);
}
function validEvidence(value) {
    if (!exactKeys(value, [
        "schemaVersion", "bundleId", "planDigest", "subjectDigest", "producerId", "collectedAtMs",
        "expiresAtMs", "checkRunDigests", "artifactRefs", "bundleDigest",
    ]))
        return false;
    return value.schemaVersion === VERIFICATION_EVIDENCE_BUNDLE_SCHEMA_V1 && isId(value.bundleId)
        && isDigest(value.planDigest) && isDigest(value.subjectDigest) && isId(value.producerId)
        && isTimestamp(value.collectedAtMs) && isTimestamp(value.expiresAtMs)
        && isUniqueStringArray(value.checkRunDigests, isDigest)
        && isUniqueStringArray(value.artifactRefs, isArtifactRef) && isDigest(value.bundleDigest);
}
function validVerdict(value) {
    if (!exactKeys(value, [
        "schemaVersion", "verdictId", "status", "reasonCodes", "planDigest", "subjectDigest",
        "evidenceBundleDigest", "evaluatedAtMs", "verdictDigest",
    ]))
        return false;
    return value.schemaVersion === VERIFICATION_VERDICT_SCHEMA_V1 && isId(value.verdictId)
        && ["VERIFIED", "DENIED", "INCONCLUSIVE"].includes(value.status)
        && isUniqueStringArray(value.reasonCodes, (item) => typeof item === "string"
            && [...REASON_ORDER, "VERIFICATION_COMPLETE"].includes(item))
        && isDigest(value.planDigest) && isDigest(value.subjectDigest) && isDigest(value.evidenceBundleDigest)
        && isTimestamp(value.evaluatedAtMs) && isDigest(value.verdictDigest);
}
function validTrigger(value) {
    if (!exactKeys(value, [
        "schemaVersion", "triggerId", "state", "causes", "observedSubjectDigest", "observedPlanDigest",
        "observedEvidenceBundleDigest", "armedAtMs", "triggerDigest",
    ]))
        return false;
    const causes = ["SUBJECT_CHANGED", "PLAN_CHANGED", "EVIDENCE_EXPIRED", "MANUAL"];
    return value.schemaVersion === VERIFICATION_REVALIDATION_TRIGGER_SCHEMA_V1 && isId(value.triggerId)
        && value.state === "ARMED" && isUniqueStringArray(value.causes, (item) => causes.includes(item))
        && isDigest(value.observedSubjectDigest) && isDigest(value.observedPlanDigest)
        && isDigest(value.observedEvidenceBundleDigest) && isTimestamp(value.armedAtMs)
        && isDigest(value.triggerDigest);
}
function validPointer(value) {
    if (!exactKeys(value, [
        "schemaVersion", "pointerId", "targetVerdictDigest", "targetEvidenceBundleDigest", "generation", "pointerDigest",
    ]))
        return false;
    return value.schemaVersion === VERIFICATION_LKG_POINTER_SCHEMA_V1 && isId(value.pointerId)
        && isDigest(value.targetVerdictDigest) && isDigest(value.targetEvidenceBundleDigest)
        && Number.isSafeInteger(value.generation) && value.generation > 0 && isDigest(value.pointerDigest);
}
function validReadback(value) {
    if (!exactKeys(value, [
        "schemaVersion", "pointerId", "pointerDigest", "observedVerdictDigest", "observedEvidenceBundleDigest",
        "observedGeneration", "status", "readAtMs", "readbackDigest",
    ]))
        return false;
    return value.schemaVersion === VERIFICATION_LKG_READBACK_SCHEMA_V1 && isId(value.pointerId)
        && isDigest(value.pointerDigest) && isDigest(value.observedVerdictDigest)
        && isDigest(value.observedEvidenceBundleDigest) && Number.isSafeInteger(value.observedGeneration)
        && value.observedGeneration > 0 && ["MATCHED", "MISMATCH", "MISSING"].includes(value.status)
        && isTimestamp(value.readAtMs) && isDigest(value.readbackDigest);
}
function validBundle(value) {
    if (!exactKeys(value, [
        "schemaVersion", "plan", "selfTestIdentity", "checkRuns", "evidenceBundle", "verdict", "revalidationTrigger", "lkg",
    ]) || value.schemaVersion !== VERIFICATION_FABRIC_BUNDLE_SCHEMA_V1 || !Array.isArray(value.checkRuns)
        || value.checkRuns.length === 0 || !value.checkRuns.every(validCheckRun)
        || !exactKeys(value.lkg, ["pointer", "readback"]))
        return false;
    return validPlan(value.plan) && validIdentity(value.selfTestIdentity) && validEvidence(value.evidenceBundle)
        && validVerdict(value.verdict) && validTrigger(value.revalidationTrigger)
        && validPointer(value.lkg.pointer) && validReadback(value.lkg.readback);
}
function sameMembers(left, right) {
    return left.length === right.length && left.every((value) => right.includes(value));
}
export function verifyVerificationFabricBundleV1(value) {
    if (!validBundle(value))
        return { outcome: "DENIED", reasonCodes: ["SCHEMA_DENIED"] };
    const reasons = new Set();
    const { plan, selfTestIdentity: identity, checkRuns, evidenceBundle: evidence, verdict, revalidationTrigger: trigger } = value;
    const { pointer, readback } = value.lkg;
    const requiredCheckIds = plan.requiredCheckIds;
    const actualCheckIds = checkRuns.map(({ checkId }) => checkId);
    if (!sameMembers(requiredCheckIds, actualCheckIds)
        || !sameMembers(evidence.checkRunDigests, checkRuns.map(({ runDigest }) => runDigest))) {
        reasons.add("EVIDENCE_MISSING_DENIED");
    }
    if (verdict.evaluatedAtMs > evidence.expiresAtMs || evidence.collectedAtMs < plan.issuedAtMs
        || evidence.expiresAtMs - evidence.collectedAtMs > plan.evidenceMaxAgeMs) {
        reasons.add("EVIDENCE_STALE_DENIED");
    }
    if (evidence.planDigest !== plan.planDigest || evidence.subjectDigest !== plan.subjectDigest
        || verdict.planDigest !== plan.planDigest || verdict.subjectDigest !== plan.subjectDigest
        || verdict.evidenceBundleDigest !== evidence.bundleDigest
        || trigger.observedPlanDigest !== plan.planDigest || trigger.observedSubjectDigest !== plan.subjectDigest
        || trigger.observedEvidenceBundleDigest !== evidence.bundleDigest
        || checkRuns.some((run) => run.planDigest !== plan.planDigest || run.subjectDigest !== plan.subjectDigest
            || run.verifierId !== identity.verifierId || run.completedAtMs < run.startedAtMs)
        || identity.subjectProducerId !== plan.subjectProducerId || identity.producerId !== evidence.producerId
        || contractDigest(plan, "planDigest") !== plan.planDigest
        || contractDigest(identity, "identityDigest") !== identity.identityDigest
        || checkRuns.some((run) => contractDigest(run, "runDigest") !== run.runDigest)
        || contractDigest(evidence, "bundleDigest") !== evidence.bundleDigest
        || contractDigest(verdict, "verdictDigest") !== verdict.verdictDigest
        || contractDigest(trigger, "triggerDigest") !== trigger.triggerDigest) {
        reasons.add("EVIDENCE_MISMATCH_DENIED");
    }
    if (evidence.producerId === plan.subjectProducerId || identity.producerId === identity.subjectProducerId) {
        reasons.add("SELF_PRODUCED_EVIDENCE_DENIED");
    }
    if (checkRuns.some(({ outcome }) => outcome !== "PASS"))
        reasons.add("CHECK_FAILED_DENIED");
    if (verdict.status !== "VERIFIED" || !sameMembers(verdict.reasonCodes, ["VERIFICATION_COMPLETE"])) {
        reasons.add("VERDICT_MISMATCH_DENIED");
    }
    if (pointer.targetVerdictDigest !== verdict.verdictDigest
        || pointer.targetEvidenceBundleDigest !== evidence.bundleDigest
        || readback.pointerId !== pointer.pointerId || readback.pointerDigest !== pointer.pointerDigest
        || readback.observedVerdictDigest !== pointer.targetVerdictDigest
        || readback.observedEvidenceBundleDigest !== pointer.targetEvidenceBundleDigest
        || readback.observedGeneration !== pointer.generation || readback.status !== "MATCHED"
        || contractDigest(pointer, "pointerDigest") !== pointer.pointerDigest
        || contractDigest(readback, "readbackDigest") !== readback.readbackDigest) {
        reasons.add("LKG_CORRUPT_DENIED");
    }
    if (reasons.size === 0)
        return { outcome: "VERIFIED", reasonCodes: ["VERIFICATION_COMPLETE"] };
    return {
        outcome: "DENIED",
        reasonCodes: REASON_ORDER.filter((reason) => reasons.has(reason)),
    };
}
