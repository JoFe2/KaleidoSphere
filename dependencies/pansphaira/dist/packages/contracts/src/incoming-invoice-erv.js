import { canonicalJsonV1, sha256HexV1 } from "./incoming-invoice-intake.js";
export const AP04_ERV_CASE_PACK_SHA256_V1 = "136bbdfcb61bf48ab0043d828dbf797e9b9156f58d284cc7f9b921da59040845";
const AP04_ERV_CASE_PACK_CANONICAL_SHA256_V1 = "899d8dfc44be526011c35ad5aba4c2cb89bca433f1520e61fe05268d4816ad20";
export const INCOMING_INVOICE_ERV_CASE_PACK_V1 = "chimpmaera.incoming-invoice/erv-case-pack/v1";
export const INCOMING_INVOICE_ERV_CORE_V1 = "chimpmaera.incoming-invoice/erv-core/v1";
const REFERENCE_KIND_V1 = ["SUPPLIER", "PURCHASE_ORDER", "RECEIPT", "INVOICE"];
const AMOUNT_KIND_V1 = ["INVOICE", "PURCHASE_ORDER", "RECEIPT"];
const EFFECT_VOCABULARY_V1 = ["READ_SYNTHETIC", "WRITE_LOCAL_PROOF", "POST_PRODUCTIVE", "ALLOCATE_PRODUCTIVE"];
const PRODUCTIVE_EFFECTS_V1 = new Set(["POST_PRODUCTIVE", "ALLOCATE_PRODUCTIVE"]);
function deepFreeze(value) {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
        for (const child of Object.values(value))
            deepFreeze(child);
        Object.freeze(value);
    }
    return value;
}
function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, keys) {
    if (!isObject(value))
        return false;
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function isSha256(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function isNonNegativeSafeInt(value) {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function canonicalDigestV1(value) {
    return sha256HexV1(canonicalJsonV1(value));
}
export function referenceContentSha256V1(body) {
    return canonicalDigestV1(body);
}
function effectiveToleranceMinor(policy, anchor) {
    if (policy.rateBasisPoints > 0)
        return Math.round((anchor * policy.rateBasisPoints) / 10000);
    return policy.absoluteToleranceMinor;
}
function evidenceCitationsFor(references) {
    return references.map((reference) => {
        const verified = referenceContentSha256V1(reference.body) === reference.evidence.contentSha256;
        return deepFreeze({ referenceKind: reference.body.referenceKind, referenceId: reference.body.referenceId, contentSha256: reference.evidence.contentSha256, verified });
    });
}
function advisorFor(caseId, kind, text, references) {
    const citations = references.map((reference) => deepFreeze({
        referenceKind: reference.body.referenceKind,
        referenceId: reference.body.referenceId,
        evidenceSha256: reference.evidence.contentSha256,
    }));
    return deepFreeze({
        questions: [deepFreeze({ questionId: `ADV:${caseId}:${kind}`, questionText: text, citations })],
        advisorAuthority: "EVIDENCE_CITING_ONLY",
        bookingAuthorityGranted: false,
    });
}
function validVariantSelection(value) {
    if (!exactKeys(value, ["variantId", "version"]))
        return false;
    const variantId = value.variantId;
    const version = value.version;
    return typeof variantId === "string" && variantId.length > 0 && typeof version === "string" && version.length > 0;
}
function validReferenceShape(value) {
    if (!exactKeys(value, ["body", "evidence"]))
        return false;
    const body = value.body;
    const evidence = value.evidence;
    if (!exactKeys(body, ["referenceKind", "referenceId", "supplierId", "matchAmountMinor", "quantity"]))
        return false;
    const referenceKind = body.referenceKind;
    const referenceId = body.referenceId;
    const supplierId = body.supplierId;
    const matchAmountMinor = body.matchAmountMinor;
    const quantity = body.quantity;
    if (!REFERENCE_KIND_V1.includes(referenceKind)
        || typeof referenceId !== "string" || referenceId.length === 0
        || typeof supplierId !== "string" || supplierId.length === 0
        || !isNonNegativeSafeInt(matchAmountMinor) || !isNonNegativeSafeInt(quantity))
        return false;
    if (!exactKeys(evidence, ["sourceKind", "locator", "generator", "contentSha256"]))
        return false;
    const sourceKind = evidence.sourceKind;
    const locator = evidence.locator;
    const generator = evidence.generator;
    const contentSha256 = evidence.contentSha256;
    return sourceKind === "LOCAL_SYNTHETIC_FIXTURE"
        && typeof locator === "string" && locator.length > 0
        && typeof generator === "string" && generator.length > 0
        && isSha256(contentSha256);
}
function validCaseShape(value) {
    if (!exactKeys(value, ["caseId", "matchingMode", "tolerancePolicy", "requestedEffects", "references"]))
        return false;
    const caseId = value.caseId;
    const matchingMode = value.matchingMode;
    const tolerancePolicy = value.tolerancePolicy;
    const requestedEffects = value.requestedEffects;
    const references = value.references;
    if (typeof caseId !== "string" || caseId.length === 0)
        return false;
    if (!validVariantSelection(matchingMode) || !validVariantSelection(tolerancePolicy))
        return false;
    if (!Array.isArray(requestedEffects) || requestedEffects.length === 0
        || !requestedEffects.every((effect) => typeof effect === "string" && EFFECT_VOCABULARY_V1.includes(effect)))
        return false;
    return Array.isArray(references) && references.length >= 1 && references.every(validReferenceShape);
}
function validMatchingModeShape(value) {
    if (!exactKeys(value, ["variantId", "version", "requiredKinds", "amountKinds"]))
        return false;
    const variantId = value.variantId;
    const version = value.version;
    const requiredKinds = value.requiredKinds;
    const amountKinds = value.amountKinds;
    if (typeof variantId !== "string" || variantId.length === 0
        || typeof version !== "string" || version.length === 0)
        return false;
    return Array.isArray(requiredKinds) && requiredKinds.length >= 1
        && requiredKinds.every((kind) => REFERENCE_KIND_V1.includes(kind))
        && Array.isArray(amountKinds) && amountKinds.length >= 1
        && amountKinds.every((kind) => AMOUNT_KIND_V1.includes(kind));
}
function validTolerancePolicyShape(value) {
    if (!exactKeys(value, ["variantId", "version", "absoluteToleranceMinor", "rateBasisPoints"]))
        return false;
    const variantId = value.variantId;
    const version = value.version;
    const absoluteToleranceMinor = value.absoluteToleranceMinor;
    const rateBasisPoints = value.rateBasisPoints;
    return typeof variantId === "string" && variantId.length > 0
        && typeof version === "string" && version.length > 0
        && isNonNegativeSafeInt(absoluteToleranceMinor)
        && isNonNegativeSafeInt(rateBasisPoints) && rateBasisPoints <= 10000;
}
function validCasePackShape(value) {
    if (!exactKeys(value, ["schemaVersion", "packId", "frozenAt", "authority", "variants", "cases"]))
        return false;
    const schemaVersion = value.schemaVersion;
    const packId = value.packId;
    const frozenAt = value.frozenAt;
    const authority = value.authority;
    const variants = value.variants;
    const cases = value.cases;
    if (schemaVersion !== INCOMING_INVOICE_ERV_CASE_PACK_V1
        || typeof packId !== "string" || packId.length === 0
        || typeof frozenAt !== "string" || frozenAt.length === 0)
        return false;
    if (!exactKeys(authority, ["mode", "customerData", "externalProvider", "productivePosting"])
        || authority.mode !== "LOCAL_SYNTHETIC_PROOF" || authority.customerData !== false
        || authority.externalProvider !== false || authority.productivePosting !== false)
        return false;
    if (!exactKeys(variants, ["matchingModes", "tolerancePolicies"]))
        return false;
    const matchingModes = variants.matchingModes;
    const tolerancePolicies = variants.tolerancePolicies;
    if (!Array.isArray(matchingModes) || matchingModes.length === 0 || !matchingModes.every(validMatchingModeShape))
        return false;
    if (!Array.isArray(tolerancePolicies) || tolerancePolicies.length === 0 || !tolerancePolicies.every(validTolerancePolicyShape))
        return false;
    return Array.isArray(cases) && cases.length >= 1 && cases.every(validCaseShape);
}
export function evaluateErvMatchingCaseV1(candidate, pack) {
    const variant = {
        matchingModeId: candidate.matchingMode.variantId,
        matchingModeVersion: candidate.matchingMode.version,
        tolerancePolicyId: candidate.tolerancePolicy.variantId,
        tolerancePolicyVersion: candidate.tolerancePolicy.version,
    };
    const evidenceCitations = evidenceCitationsFor(candidate.references);
    const authority = deepFreeze({ productivePostingAuthorized: false, bookingAuthorityGranted: false, riskDCapability: "SEPARATELY_AUTHORIZED" });
    // AC-05: productive effects are refused before any matching, with no booking authority granted.
    const productiveEffect = candidate.requestedEffects.find((effect) => PRODUCTIVE_EFFECTS_V1.has(effect));
    if (productiveEffect !== undefined) {
        const text = `Productive effect ${productiveEffect} was requested; this ERV core grants no booking authority and defers to separate Risk-D authorization.`;
        return deepFreeze({ caseId: candidate.caseId, outcome: "DENIED", variant, reasonCode: "RISK_D_AUTHORIZATION_REQUIRED", detail: text, evidenceCitations, advisor: advisorFor(candidate.caseId, "RISK_D", text, candidate.references), authority });
    }
    // AC-02: resolve the requested versioned matching-mode and tolerance variants against the frozen registry.
    const mode = pack.variants.matchingModes.find((entry) => entry.variantId === candidate.matchingMode.variantId && entry.version === candidate.matchingMode.version);
    const policy = pack.variants.tolerancePolicies.find((entry) => entry.variantId === candidate.tolerancePolicy.variantId && entry.version === candidate.tolerancePolicy.version);
    if (mode === undefined || policy === undefined) {
        const missing = mode === undefined
            ? `matching mode ${candidate.matchingMode.variantId} v${candidate.matchingMode.version}`
            : `tolerance policy ${candidate.tolerancePolicy.variantId} v${candidate.tolerancePolicy.version}`;
        const text = `Versioned variant is not present in the frozen registry: ${missing}.`;
        return deepFreeze({ caseId: candidate.caseId, outcome: "EXCEPTION", variant, exceptionCode: "UNKNOWN_VARIANT", detail: text, evidenceCitations, advisor: advisorFor(candidate.caseId, "UNKNOWN_VARIANT", text, candidate.references), authority });
    }
    // AC-01: every reference is independently evidenced; an unbound digest is explicit and does not mask the others.
    const unverified = evidenceCitations.find((citation) => citation.verified === false);
    if (unverified !== undefined) {
        const text = `Reference ${unverified.referenceKind} ${unverified.referenceId} is not independently evidenced: its bound contentSha256 does not match its recomputed body digest.`;
        return deepFreeze({ caseId: candidate.caseId, outcome: "EXCEPTION", variant, exceptionCode: "UNVERIFIED_REFERENCE_EVIDENCE", detail: text, evidenceCitations, advisor: advisorFor(candidate.caseId, "UNVERIFIED_REFERENCE_EVIDENCE", text, candidate.references), authority });
    }
    // AC-03: missing required context is explicit rather than inferred or filled in.
    const byKind = new Map();
    for (const reference of candidate.references)
        byKind.set(reference.body.referenceKind, reference);
    const missingKinds = mode.requiredKinds.filter((kind) => !byKind.has(kind));
    if (missingKinds.length > 0) {
        const text = `Required reference kind(s) ${missingKinds.join(", ")} are missing for ${mode.variantId}; the match cannot complete without their independent evidence.`;
        return deepFreeze({ caseId: candidate.caseId, outcome: "EXCEPTION", variant, exceptionCode: "MISSING_CONTEXT", detail: text, evidenceCitations, advisor: advisorFor(candidate.caseId, "MISSING_CONTEXT", text, candidate.references), authority });
    }
    // AC-02/AC-03: compare the versioned amount kinds under the versioned tolerance policy.
    const anchor = byKind.get("INVOICE").body.matchAmountMinor;
    const amounts = mode.amountKinds.map((kind) => {
        const reference = byKind.get(kind);
        return { kind, referenceId: reference.body.referenceId, amount: reference.body.matchAmountMinor };
    });
    const min = Math.min(...amounts.map((entry) => entry.amount));
    const max = Math.max(...amounts.map((entry) => entry.amount));
    const delta = max - min;
    const toleranceMinor = effectiveToleranceMinor(policy, anchor);
    if (delta <= toleranceMinor) {
        const text = `All ${mode.amountKinds.length} matched references agree within ${policy.variantId} v${policy.version}; confirm there are no unlisted adjustments before acknowledgement.`;
        return deepFreeze({ caseId: candidate.caseId, outcome: "MATCHED", variant, matchedAmountMinor: anchor, evidenceCitations, advisor: advisorFor(candidate.caseId, "MATCHED", text, candidate.references), authority });
    }
    const minEntry = amounts.find((entry) => entry.amount === min);
    const maxEntry = amounts.find((entry) => entry.amount === max);
    const conflict = { minReferenceId: minEntry.referenceId, minAmountMinor: min, maxReferenceId: maxEntry.referenceId, maxAmountMinor: max, deltaMinor: delta, toleranceMinor, tolerancePolicyId: policy.variantId, tolerancePolicyVersion: policy.version };
    const text = `Matched amounts disagree beyond ${policy.variantId} v${policy.version} (delta ${delta} minor, tolerance ${toleranceMinor} minor); identify the authoritative reference.`;
    return deepFreeze({ caseId: candidate.caseId, outcome: "CONFLICT", variant, conflict, evidenceCitations, advisor: advisorFor(candidate.caseId, "CONFLICT", text, candidate.references), authority });
}
export function compileErvCapabilityCoreV1(candidate, claimedPackSha256) {
    if (!validCasePackShape(candidate))
        return deepFreeze({ outcome: "DENIED", reasonCode: "PACK_SHAPE_DENIED" });
    const pack = candidate;
    if (claimedPackSha256 !== AP04_ERV_CASE_PACK_SHA256_V1 || canonicalDigestV1(candidate) !== AP04_ERV_CASE_PACK_CANONICAL_SHA256_V1) {
        return deepFreeze({ outcome: "DENIED", reasonCode: "PACK_DIGEST_DENIED" });
    }
    const decisions = pack.cases.map((entry) => evaluateErvMatchingCaseV1(entry, pack));
    const decisionDigest = canonicalDigestV1(decisions);
    const pkg = {
        schemaVersion: INCOMING_INVOICE_ERV_CORE_V1,
        packId: pack.packId,
        caseCount: decisions.length,
        decisions,
        authority: { mode: "LOCAL_SYNTHETIC_PROOF", customerDataAuthorized: false, externalProviderCalls: false, productivePostingAuthorized: false, bookingAuthorityGranted: false, riskDCapability: "SEPARATELY_AUTHORIZED" },
        nonclaims: ["NO_CUSTOMER_DATA_EVALUATED", "NO_EXTERNAL_PROVIDER_EVALUATED", "NO_PRODUCTIVE_ALLOCATION_OR_POSTING_AUTHORIZED", "NO_BOOKING_AUTHORITY_GRANTED", "NO_LIVE_ERP_SYSTEM_CLAIM"],
        readback: { packSha256: AP04_ERV_CASE_PACK_CANONICAL_SHA256_V1, decisionDigest, deterministicReplay: true },
    };
    return deepFreeze({ outcome: "DECIDED", package: pkg });
}
