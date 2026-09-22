import { createHash } from "node:crypto";
export const ASF_SYNTHETIC_LIFECYCLE_SCHEMA_V1 = "pansphaira.asf/synthetic-lifecycle/v1";
export const ASF_SYNTHETIC_LIFECYCLE_AUTHORITY_V1 = "LOCAL_DETERMINISTIC_HARNESS_ONLY";
export const ASF_SYNTHETIC_LIFECYCLE_VERSION_V1 = "1.0.0";
export const ASF_SYNTHETIC_CAPABILITY_PACK_SCHEMA_V1 = "pansphaira.asf/synthetic-capability-pack/v1";
export const ASF_SYNTHETIC_BUNDLE_SCHEMA_V1 = "pansphaira.asf/synthetic-bundle/v1";
export const ASF_SYNTHETIC_BUNDLE_LOCK_SCHEMA_V1 = "pansphaira.asf/synthetic-bundle-lock/v1";
export const ASF_SYNTHETIC_LIFECYCLE_CRITERION_MATRIX_SCHEMA_V1 = ASF_SYNTHETIC_LIFECYCLE_SCHEMA_V1;
export const ASF_SYNTHETIC_LIFECYCLE_CRITERION_RECEIPT_MATRIX_V1 = Object.freeze({
    assignments: Object.freeze(["assignment"]),
    compatibilityFence: Object.freeze(["compatibility", "compatibilityTuple"]),
    deterministicGeneration: Object.freeze(["proposal", "generation"]),
    explicitActivation: Object.freeze(["activation"]),
    inactiveInstallation: Object.freeze(["analysis", "inactiveInstall"]),
    negativeFailClosed: Object.freeze(["negativeProbe"]),
    provenanceQualityRisk: Object.freeze(["qualityEvidence", "provenanceEvidence", "riskEvidence", "analysis"]),
    publicSafeReproduction: Object.freeze(["public"]),
    plannedVersusImplementedReadback: Object.freeze(["public"]),
    noUnsupportedPublicClaims: Object.freeze(["public"]),
    exactGenerationLockEvidence: Object.freeze(["generation", "bundleLock", "negativeProbe"]),
    rollbackReadback: Object.freeze(["rollback"]),
    controlledRings: Object.freeze(["ring-canary", "ring-cohort", "ring-general"]),
    immutableContentAddressing: Object.freeze(["generation", "bundleLock"]),
});
export const ASF_SYNTHETIC_LIFECYCLE_CRITERION_TO_RECEIPT_MATRIX = ASF_SYNTHETIC_LIFECYCLE_CRITERION_RECEIPT_MATRIX_V1;
const SKILL_ID = "skill:synthetic.lifecycle";
const PROFILE_ID = "profile:synthetic.canary";
const ADAPTER_ID = "adapter:synthetic.local";
const PACK_ID = "pack:synthetic.lifecycle";
const ROUTE_ID = "route:local";
const CAPABILITY_ID = "capability:documents.read";
const TARGET_SCOPE = "profile:synthetic.canary";
const FIXED_NOW_MS = 1_725_000_000_000;
const FAULT_REASON = Object.freeze({
    "authority-widening": "AUTHORITY_WIDENING_DENIED",
    "blocked-analysis": "ANALYSIS_BLOCKED_DENIED",
    "budget-drift": "BUDGET_DRIFT_DENIED",
    "incompatible-tuple": "INCOMPATIBLE_TUPLE_DENIED",
    "invalid-lkg": "INVALID_LKG_DENIED",
    "invalid-rollback": "INVALID_ROLLBACK_DENIED",
    "mismatched-evidence": "EVIDENCE_BINDING_DENIED",
    "mismatched-identity": "IDENTITY_BINDING_DENIED",
    "mismatched-receipt": "RECEIPT_BINDING_DENIED",
    "missing-authority": "AUTHORITY_MISSING_DENIED",
    "missing-explicit-activation": "EXPLICIT_ACTIVATION_REQUIRED_DENIED",
    "missing-lkg": "LKG_MISSING_DENIED",
    "replayed-identity": "IDENTITY_REPLAY_DENIED",
    "replayed-receipt": "RECEIPT_REPLAY_DENIED",
    "residue": "RESIDUE_DENIED",
    "self-authority": "SELF_AUTHORITY_DENIED",
    "stale-digest": "DIGEST_STALE_DENIED",
    "stale-evidence": "EVIDENCE_STALE_DENIED",
    "stale-identity": "IDENTITY_STALE_DENIED",
    "stale-state": "STATE_STALE_DENIED",
    "skipped-ring": "RING_ORDER_DENIED",
    "tampered-lock": "LOCK_INTEGRITY_DENIED",
    "unbound-receipt": "RECEIPT_UNBOUND_DENIED",
    "unsafe-public-readback": "PUBLIC_READBACK_UNSAFE_DENIED",
});
const FAULT_GATE = Object.freeze({
    "authority-widening": "authority",
    "blocked-analysis": "analysis",
    "budget-drift": "reconciliationBudget",
    "incompatible-tuple": "compatibilityTuple",
    "invalid-lkg": "lkg",
    "invalid-rollback": "rollback",
    "mismatched-evidence": "evidenceBinding",
    "mismatched-identity": "identityBinding",
    "mismatched-receipt": "receiptBinding",
    "missing-authority": "authority",
    "missing-explicit-activation": "activation",
    "missing-lkg": "lkg",
    "replayed-identity": "identityReplay",
    "replayed-receipt": "receiptReplay",
    "residue": "residue",
    "self-authority": "authority",
    "stale-digest": "digestFreshness",
    "stale-evidence": "evidenceFreshness",
    "stale-identity": "identityFreshness",
    "stale-state": "stateFreshness",
    "skipped-ring": "ringOrder",
    "tampered-lock": "bundleLock",
    "unbound-receipt": "receiptBinding",
    "unsafe-public-readback": "publicReadback",
});
const REDACTED_DENIAL_FAULTS = new Set([
    "authority-widening",
    "budget-drift",
    "invalid-lkg",
    "invalid-rollback",
    "mismatched-evidence",
    "mismatched-identity",
    "mismatched-receipt",
    "missing-authority",
    "replayed-identity",
    "replayed-receipt",
    "stale-digest",
    "stale-evidence",
    "stale-identity",
    "stale-state",
    "unbound-receipt",
    "unsafe-public-readback",
]);
function canonicalize(value) {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(canonicalize).join(",")}]`;
    const record = value;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(",")}}`;
}
export const canonicalJson = canonicalize;
export function asfSyntheticDigestV1(value) {
    return createHash("sha256").update(canonicalize(value)).digest("hex");
}
function freeze(value) {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
        Object.values(value).forEach((child) => freeze(child));
        Object.freeze(value);
    }
    return value;
}
function receipt(stage, core) {
    const unsigned = { stage, schemaVersion: ASF_SYNTHETIC_LIFECYCLE_SCHEMA_V1, ...core };
    return freeze({ ...unsigned, receiptDigest: asfSyntheticDigestV1(unsigned) });
}
function stateRecord(generationDigest, lockIdentity, version, state, skillId = SKILL_ID) {
    return { generationDigest, lockIdentity, skillId, state, version };
}
function makeGeneration(version, body) {
    const file = { path: "skill.md", sha256: createHash("sha256").update(body).digest("hex"), size: body.length };
    const content = { files: [file] };
    const contentDigest = asfSyntheticDigestV1(content);
    const sourceDigest = asfSyntheticDigestV1({ kind: "LOCAL_CONTENT", locator: `local+sha256:${contentDigest}`, mutable: false });
    const generationDigest = asfSyntheticDigestV1({ contentDigest, skillId: SKILL_ID, sourceDigest, version });
    return { contentDigest, files: [file], generationDigest, skillId: SKILL_ID, sourceDigest, version };
}
export function createAsfSyntheticCapabilityPackV1() {
    const core = {
        capabilityIds: [CAPABILITY_ID],
        packId: PACK_ID,
        schemaVersion: ASF_SYNTHETIC_CAPABILITY_PACK_SCHEMA_V1,
        version: ASF_SYNTHETIC_LIFECYCLE_VERSION_V1,
    };
    const contentDigest = asfSyntheticDigestV1(core);
    return freeze({ ...core, contentDigest, packDigest: asfSyntheticDigestV1({ contentDigest, packId: PACK_ID, version: core.version }) });
}
export function createAsfSyntheticBundleLockV1() {
    const generation = makeGeneration(ASF_SYNTHETIC_LIFECYCLE_VERSION_V1, "# Synthetic ASF lifecycle\n\nPinned, deterministic content.\n");
    const capabilityPack = createAsfSyntheticCapabilityPackV1();
    const bundleCore = {
        capabilityPack,
        contentDigest: generation.contentDigest,
        generationDigest: generation.generationDigest,
        schemaVersion: ASF_SYNTHETIC_BUNDLE_SCHEMA_V1,
        skillId: generation.skillId,
        sourceDigest: generation.sourceDigest,
        version: generation.version,
    };
    const bundle = freeze({ ...bundleCore, bundleDigest: asfSyntheticDigestV1(bundleCore) });
    const lockCore = {
        bundleDigest: bundle.bundleDigest,
        generationDigest: bundle.generationDigest,
        packDigest: capabilityPack.packDigest,
        schemaVersion: ASF_SYNTHETIC_BUNDLE_LOCK_SCHEMA_V1,
    };
    return freeze({ bundle, lock: { ...lockCore, lockIdentity: asfSyntheticDigestV1(lockCore) } });
}
export function validateAsfSyntheticBundleLockV1(value) {
    const { bundle, lock } = value;
    const bundleCore = {
        capabilityPack: bundle.capabilityPack,
        contentDigest: bundle.contentDigest,
        generationDigest: bundle.generationDigest,
        schemaVersion: bundle.schemaVersion,
        skillId: bundle.skillId,
        sourceDigest: bundle.sourceDigest,
        version: bundle.version,
    };
    const lockCore = {
        bundleDigest: lock.bundleDigest,
        generationDigest: lock.generationDigest,
        packDigest: lock.packDigest,
        schemaVersion: lock.schemaVersion,
    };
    const capabilityPackCore = {
        capabilityIds: bundle.capabilityPack.capabilityIds,
        packId: bundle.capabilityPack.packId,
        schemaVersion: bundle.capabilityPack.schemaVersion,
        version: bundle.capabilityPack.version,
    };
    return bundle.schemaVersion === ASF_SYNTHETIC_BUNDLE_SCHEMA_V1
        && bundle.capabilityPack.schemaVersion === ASF_SYNTHETIC_CAPABILITY_PACK_SCHEMA_V1
        && lock.schemaVersion === ASF_SYNTHETIC_BUNDLE_LOCK_SCHEMA_V1
        && bundle.capabilityPack.contentDigest === asfSyntheticDigestV1(capabilityPackCore)
        && bundle.capabilityPack.packDigest === asfSyntheticDigestV1({
            contentDigest: bundle.capabilityPack.contentDigest,
            packId: bundle.capabilityPack.packId,
            version: bundle.capabilityPack.version,
        })
        && bundle.bundleDigest === asfSyntheticDigestV1(bundleCore)
        && lock.bundleDigest === bundle.bundleDigest
        && lock.generationDigest === bundle.generationDigest
        && lock.packDigest === bundle.capabilityPack.packDigest
        && lock.lockIdentity === asfSyntheticDigestV1(lockCore);
}
function makeMatrix(generation, lockIdentity) {
    const tuple = {
        adapterId: ADAPTER_ID,
        adapterVersion: "1.0.0",
        catalogDigest: asfSyntheticDigestV1(CAPABILITY_ID),
        generationDigest: generation.generationDigest,
        lockDigest: lockIdentity,
        packDigest: asfSyntheticDigestV1(PACK_ID),
        packId: PACK_ID,
        profileId: PROFILE_ID,
        profileVersion: "1.0.0",
        routeId: ROUTE_ID,
        routeVersion: "1.0.0",
        skillId: SKILL_ID,
        version: generation.version,
    };
    const matrix = { matrixId: "asffence:synthetic.lifecycle", rows: [tuple], version: "1.0.0" };
    return { matrix, matrixDigest: asfSyntheticDigestV1(matrix), tuple, tupleDigest: asfSyntheticDigestV1(tuple) };
}
function cloneState(state) {
    return JSON.parse(canonicalize(state));
}
function completeResult(scenario, before, after, receipts, outcome, reasonCodes, effects, fault) {
    const core = {
        after,
        before,
        effects,
        outcome,
        reasonCodes,
        receipts,
        scenario,
    };
    const result = { ...core, canonicalJson: canonicalize(core), exitCode: outcome === "ACCEPTED" ? 0 : 1, ...(fault === undefined ? {} : { fault }) };
    const receiptDigest = asfSyntheticDigestV1(result);
    const publicReceipt = renderPublicAsfSyntheticLifecycleV1({ ...result, receiptDigest });
    const { receiptDigest: lifecycleReceiptDigest, ...publicCore } = publicReceipt;
    const finalResult = {
        ...result,
        receiptDigest,
        receipts: {
            ...receipts,
            public: receipt("public", { ...publicCore, lifecycleReceiptDigest }),
        },
    };
    return freeze({ ...finalResult, receiptJson: canonicalize(finalResult) });
}
function denied(scenario, fault, before, receipts) {
    const reason = FAULT_REASON[fault];
    const redactUnsafeMaterial = REDACTED_DENIAL_FAULTS.has(fault);
    const gateReceipt = receipt("gate", {
        fault,
        gate: FAULT_GATE[fault],
        verdict: "DENIED",
    });
    const negativeProbe = receipt("negativeProbe", {
        fault,
        noSideEffect: true,
        reasonCode: reason,
        ...(redactUnsafeMaterial ? { redacted: true } : {}),
    });
    return completeResult(scenario, before, cloneState(before), {
        ...(redactUnsafeMaterial ? {} : receipts),
        gate: gateReceipt,
        negativeProbe,
    }, "DENIED", [reason], {
        activationApplied: false,
        installationApplied: false,
        rollbackApplied: false,
    }, fault);
}
export function runAsfSyntheticLifecycleV1(options = {}) {
    const scenario = options.scenario ?? "success";
    const candidate = makeGeneration("1.0.0", "# Synthetic ASF lifecycle\n\nPinned, deterministic content.\n");
    const lkg = makeGeneration("0.9.0", "# Synthetic ASF lifecycle LKG\n");
    const unrelated = makeGeneration("9.0.0", "# Unrelated generation\n");
    const candidateLock = asfSyntheticDigestV1({ bundle: candidate.contentDigest, pack: PACK_ID, version: candidate.version });
    const lkgLock = asfSyntheticDigestV1({ bundle: lkg.contentDigest, pack: PACK_ID, version: lkg.version });
    const unrelatedLock = asfSyntheticDigestV1({ bundle: unrelated.contentDigest, pack: PACK_ID, version: unrelated.version });
    const before = {
        active: [stateRecord(lkg.generationDigest, lkgLock, lkg.version, "ACTIVE"), stateRecord(unrelated.generationDigest, unrelatedLock, unrelated.version, "ACTIVE", "skill:unrelated")],
        assignments: [],
        installed: [],
        rings: [],
    };
    const matrix = makeMatrix(candidate, candidateLock);
    const receipts = {
        proposal: receipt("proposal", { lifecycleState: "PROPOSED", lineage: { parentGenerationDigest: lkg.generationDigest, parentLockIdentity: lkgLock }, skillId: candidate.skillId, version: candidate.version }),
        generation: receipt("generation", { contentDigest: candidate.contentDigest, generationDigest: candidate.generationDigest, immutable: true, lineage: { parentGenerationDigest: lkg.generationDigest, parentLockIdentity: lkgLock }, sourceDigest: candidate.sourceDigest, version: candidate.version }),
        qualityEvidence: receipt("qualityEvidence", { evidenceClass: "SYNTHETIC_VERIFIED", finding: "QUALITY_CHECKED", observedAtMs: FIXED_NOW_MS }),
        provenanceEvidence: receipt("provenanceEvidence", { evidenceClass: "SYNTHETIC_VERIFIED", finding: "PROVENANCE_VERIFIED", observedAtMs: FIXED_NOW_MS }),
        riskEvidence: receipt("riskEvidence", { evidenceClass: "SYNTHETIC_VERIFIED", finding: "RISK_CLEAR", observedAtMs: FIXED_NOW_MS }),
        analysis: receipt("analysis", { evidence: ["qualityEvidence", "provenanceEvidence", "riskEvidence"], lifecycleState: "ANALYZED", provenance: "VERIFIED", quality: "PASS", risk: "CLEAR" }),
        bundleLock: receipt("bundleLock", { generationDigest: candidate.generationDigest, lockIdentity: candidateLock, tamperChecked: true }),
    };
    if (options.fault !== undefined)
        return denied(scenario, options.fault, before, receipts);
    const installed = stateRecord(candidate.generationDigest, candidateLock, candidate.version, "installed_inactive");
    receipts.inactiveInstall = receipt("inactiveInstall", { generationDigest: candidate.generationDigest, lockIdentity: candidateLock, state: "installed_inactive" });
    receipts.compatibility = receipt("compatibility", { matrix: matrix.matrix, matrixDigest: matrix.matrixDigest, verdict: "COMPATIBLE" });
    receipts.compatibilityTuple = receipt("compatibilityTuple", { matrixDigest: matrix.matrixDigest, tuple: matrix.tuple, tupleDigest: matrix.tupleDigest, verdict: "COMPATIBLE" });
    receipts.assignment = receipt("assignment", { generationDigest: candidate.generationDigest, profileId: PROFILE_ID, targetScope: TARGET_SCOPE });
    receipts.activation = receipt("activation", { explicitApproval: true, generationDigest: candidate.generationDigest, lockIdentity: candidateLock, targetScope: TARGET_SCOPE });
    receipts["ring-canary"] = receipt("ring-canary", { generationDigest: candidate.generationDigest, previous: "NONE", ringId: "canary", status: "PROMOTED" });
    receipts["ring-cohort"] = receipt("ring-cohort", { generationDigest: candidate.generationDigest, previous: "canary", ringId: "cohort", status: "PROMOTED" });
    receipts["ring-general"] = receipt("ring-general", { generationDigest: candidate.generationDigest, previous: "cohort", ringId: "general", status: "PROMOTED" });
    const activeCandidate = stateRecord(candidate.generationDigest, candidateLock, candidate.version, "ACTIVE");
    const assigned = { generationDigest: candidate.generationDigest, profileId: PROFILE_ID, skillId: SKILL_ID, targetScope: TARGET_SCOPE };
    const activated = {
        active: [activeCandidate, before.active[1]],
        assignments: [assigned],
        installed: [installed],
        rings: [{ generationDigest: candidate.generationDigest, ringId: "canary", status: "PROMOTED" }, { generationDigest: candidate.generationDigest, ringId: "cohort", status: "PROMOTED" }, { generationDigest: candidate.generationDigest, ringId: "general", status: "PROMOTED" }],
    };
    if (scenario === "success") {
        receipts.rollback = receipt("rollback", { candidateGenerationDigest: candidate.generationDigest, lkgGenerationDigest: lkg.generationDigest, mode: "RESTORE_EXACT_LOCK_OR_DENY", result: "READY", readbackDigest: asfSyntheticDigestV1(activated) });
        return completeResult(scenario, before, activated, receipts, "ACCEPTED", ["ASF_SYNTHETIC_LIFECYCLE_ACCEPTED"], { activationApplied: true, installationApplied: true, rollbackApplied: false });
    }
    const rolledBack = {
        active: [stateRecord(lkg.generationDigest, lkgLock, lkg.version, "ACTIVE"), before.active[1]],
        assignments: [],
        installed: [],
        rings: [],
    };
    const readbackDigest = asfSyntheticDigestV1(rolledBack);
    receipts.rollback = receipt("rollback", { afterReadbackDigest: readbackDigest, candidateGenerationDigest: candidate.generationDigest, exactLkg: true, lkgGenerationDigest: lkg.generationDigest, lkgLockIdentity: lkgLock, mode: "RESTORE_EXACT_LOCK_OR_DENY", result: "RESTORED" });
    return completeResult(scenario, before, rolledBack, receipts, "ACCEPTED", ["ASF_SYNTHETIC_ROLLBACK_ACCEPTED"], { activationApplied: true, installationApplied: true, rollbackApplied: true });
}
export const runAsfSyntheticLifecycle = runAsfSyntheticLifecycleV1;
export const runAsfSyntheticLifecycleHarnessV1 = runAsfSyntheticLifecycleV1;
export const executeAsfSyntheticLifecycleV1 = runAsfSyntheticLifecycleV1;
export const createAsfSyntheticLifecycleReceiptV1 = runAsfSyntheticLifecycleV1;
export function renderPublicAsfSyntheticLifecycleV1(value) {
    const receipts = Object.fromEntries(Object.entries(value.receipts).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, item]) => [key, item.receiptDigest]));
    return {
        outcome: value.outcome,
        reasonCodes: [...value.reasonCodes],
        receiptDigest: value.receiptDigest,
        receipts,
        state: { active: value.after.active, installed: value.after.installed },
    };
}
export const publicAsfSyntheticLifecycleV1 = renderPublicAsfSyntheticLifecycleV1;
export const ASF_SYNTHETIC_LIFECYCLE_SUCCESS_FIXTURE_V1 = runAsfSyntheticLifecycleV1();
export const ASF_SYNTHETIC_LIFECYCLE_ROLLBACK_FIXTURE_V1 = runAsfSyntheticLifecycleV1({ scenario: "rollback" });
export const ASF_SYNTHETIC_LIFECYCLE_DENIED_ACTIVATION_FIXTURE_V1 = runAsfSyntheticLifecycleV1({ fault: "missing-explicit-activation" });
export const ASF_SYNTHETIC_LIFECYCLE_INCOMPATIBLE_FIXTURE_V1 = runAsfSyntheticLifecycleV1({ fault: "incompatible-tuple" });
export const ASF_SYNTHETIC_LIFECYCLE_SUCCESS_FIXTURE = ASF_SYNTHETIC_LIFECYCLE_SUCCESS_FIXTURE_V1;
export const ASF_SYNTHETIC_LIFECYCLE_DENIED_ACTIVATION_FIXTURE = ASF_SYNTHETIC_LIFECYCLE_DENIED_ACTIVATION_FIXTURE_V1;
export const ASF_SYNTHETIC_LIFECYCLE_ROLLBACK_FIXTURE = ASF_SYNTHETIC_LIFECYCLE_ROLLBACK_FIXTURE_V1;
export const ASF_SYNTHETIC_LIFECYCLE_INCOMPATIBLE_FIXTURE = ASF_SYNTHETIC_LIFECYCLE_INCOMPATIBLE_FIXTURE_V1;
export const ASF_SYNTHETIC_LIFECYCLE_FIXTURES_V1 = Object.freeze({
    deniedActivation: ASF_SYNTHETIC_LIFECYCLE_DENIED_ACTIVATION_FIXTURE_V1,
    incompatible: ASF_SYNTHETIC_LIFECYCLE_INCOMPATIBLE_FIXTURE_V1,
    rollback: ASF_SYNTHETIC_LIFECYCLE_ROLLBACK_FIXTURE_V1,
    success: ASF_SYNTHETIC_LIFECYCLE_SUCCESS_FIXTURE_V1,
});
