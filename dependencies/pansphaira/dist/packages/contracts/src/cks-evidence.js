import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import { VERIFICATION_ATTESTATION_SCHEMA_V2, verificationAttestationDigestV2, } from "./verification-fabric-v2.js";
/**
 * CKS Evidence Pack and Evidence Coverage are binding records only. They do
 * not assert truth, grant authority, establish a trust scale, execute a
 * verifier, or imply release, delivery, or runtime permission. v1 is strict:
 * unknown versions require an explicit migration and no implicit v1-to-v2
 * interpretation is provided.
 */
export const CKS_EVIDENCE_PACK_SCHEMA_V1 = "chimpmaera.cks/evidence-pack/v1";
export const CKS_EVIDENCE_COVERAGE_SCHEMA_V1 = "chimpmaera.cks/evidence-coverage/v1";
export const CKS_EVIDENCE_STATES_V1 = ["COMPLETE", "CONFLICT", "MISSING", "STALE"];
export const CKS_EVIDENCE_DENIAL_REASONS_V1 = [
    "SCHEMA_DENIED",
    "STALE_VERSION_DENIED",
    "AUTHORITY_DENIED",
    "DIGEST_TAMPERED_DENIED",
    "PROVENANCE_UNRESOLVED_DENIED",
    "VALIDITY_DENIED",
    "CLAIM_COVERAGE_MISMATCH_DENIED",
    "EVIDENCE_MISSING_DENIED",
    "EVIDENCE_CONFLICT_DENIED",
    "EVIDENCE_STALE_DENIED",
    "CLAIM_STATE_MISMATCH_DENIED",
    "APPLICABILITY_MISMATCH_DENIED",
    "SUBJECT_MISMATCH_DENIED",
    "CROSS_SCOPE_BINDING_DENIED",
];
const sha256 = (value) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const isPlainRecord = (value) => value !== null
    && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exactKeys = (value, keys, optional = []) => {
    if (!isPlainRecord(value))
        return false;
    const actual = Object.keys(value);
    return keys.every((key) => actual.includes(key))
        && actual.every((key) => keys.includes(key) || optional.includes(key));
};
const isDigest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const isIdentifier = (value) => typeof value === "string"
    && /^[a-z][a-z0-9-]{1,31}:[a-z0-9][a-z0-9._-]{2,95}$/.test(value);
const isText = (value, max) => typeof value === "string"
    && value.length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value);
const isTimestamp = (value) => typeof value === "number"
    && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= 0;
const isState = (value) => CKS_EVIDENCE_STATES_V1.includes(value);
const authorityShape = (value) => exactKeys(value, [
    "credentials", "policyApprovals", "capabilities", "toolAccess", "writeTargets", "executionRoutes",
]) && Object.values(value).every(Array.isArray);
const authorityFree = (value) => authorityShape(value)
    && Object.values(value).every((entries) => entries.length === 0);
const objectReference = (value) => exactKeys(value, ["objectId", "objectDigest"])
    && isIdentifier(value.objectId) && isDigest(value.objectDigest);
const withoutDigest = (value, key) => Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
const compareCanonical = (left, right) => {
    const a = canonicalJson(left);
    const b = canonicalJson(right);
    return a < b ? -1 : a > b ? 1 : 0;
};
function sortedPackContent(value) {
    return {
        ...withoutDigest(value, "packDigest"),
        claims: Array.isArray(value.claims)
            ? [...value.claims].sort(compareCanonical)
            : value.claims,
        evidence: Array.isArray(value.evidence)
            ? [...value.evidence].sort(compareCanonical)
            : value.evidence,
    };
}
function sortedCoverageContent(value) {
    return {
        ...withoutDigest(value, "coverageDigest"),
        claims: Array.isArray(value.claims)
            ? [...value.claims].sort(compareCanonical)
            : value.claims,
    };
}
export const cksEvidencePackDigestV1 = (value) => sha256(sortedPackContent(value));
export const cksEvidenceCoverageDigestV1 = (value) => sha256(sortedCoverageContent(value));
function validClaim(value) {
    return exactKeys(value, ["claimId"]) && isIdentifier(value.claimId);
}
function validEvidenceEntry(value) {
    if (!exactKeys(value, ["claimId", "attestationDigest", "attestedTest"], ["expiresAtMs"]) || !isIdentifier(value.claimId)
        || !isDigest(value.attestationDigest) || !isText(value.attestedTest, 512))
        return false;
    return !Object.hasOwn(value, "expiresAtMs") || isTimestamp(value.expiresAtMs);
}
function validVerificationAttestation(value) {
    if (!exactKeys(value, [
        "schemaVersion", "nodeId", "nodeDigest", "graphDigest", "toolchainDigest", "environmentDigest",
        "createdAtMs", "testResults", "attestationDigest",
    ], ["expiresAtMs"]) || value.schemaVersion !== VERIFICATION_ATTESTATION_SCHEMA_V2
        || !isIdentifier(value.nodeId) || !isDigest(value.nodeDigest) || !isDigest(value.graphDigest)
        || !isDigest(value.toolchainDigest) || !isDigest(value.environmentDigest)
        || !isTimestamp(value.createdAtMs) || (Object.hasOwn(value, "expiresAtMs") && !isTimestamp(value.expiresAtMs))
        || !Array.isArray(value.testResults) || value.testResults.length === 0 || !isDigest(value.attestationDigest))
        return false;
    return value.testResults.every((result) => exactKeys(result, ["test", "outcome"])
        && isText(result.test, 512) && result.outcome === "PASS")
        && new Set(value.testResults.map((result) => result.test)).size === value.testResults.length;
}
function resolveAttestation(resolver, attestationDigest) {
    try {
        if (resolver === undefined)
            return undefined;
        if (typeof resolver === "function")
            return resolver(attestationDigest);
        if ("get" in resolver && typeof resolver.get === "function")
            return resolver.get(attestationDigest);
        return resolver[attestationDigest];
    }
    catch {
        return undefined;
    }
}
function attestationReasons(entry, resolver) {
    const resolved = resolveAttestation(resolver, entry.attestationDigest);
    if (resolved === undefined)
        return ["PROVENANCE_UNRESOLVED_DENIED"];
    if (!validVerificationAttestation(resolved))
        return ["SCHEMA_DENIED"];
    const { attestationDigest: suppliedDigest, ...unsigned } = resolved;
    const reasons = [];
    if (suppliedDigest !== verificationAttestationDigestV2(unsigned))
        add(reasons, "DIGEST_TAMPERED_DENIED");
    if (suppliedDigest !== entry.attestationDigest)
        add(reasons, "DIGEST_TAMPERED_DENIED");
    if (!resolved.testResults.some((result) => result.test === entry.attestedTest && result.outcome === "PASS")) {
        add(reasons, "SUBJECT_MISMATCH_DENIED");
    }
    if (Object.hasOwn(entry, "expiresAtMs") && entry.expiresAtMs !== resolved.expiresAtMs) {
        add(reasons, "DIGEST_TAMPERED_DENIED");
    }
    return reasons;
}
function evidenceAttestationReasons(value, resolver) {
    const reasons = [];
    for (const entry of value.evidence) {
        for (const reason of attestationReasons(entry, resolver))
            add(reasons, reason);
    }
    return reasons;
}
function validPackShape(value) {
    if (!exactKeys(value, [
        "schemaVersion", "packId", "object", "applicabilityDigest", "scopeNamespace", "claims", "evidence", "validity", "authority", "packDigest",
    ]) || value.schemaVersion !== CKS_EVIDENCE_PACK_SCHEMA_V1 || !isIdentifier(value.packId)
        || !objectReference(value.object) || !isDigest(value.applicabilityDigest) || !isText(value.scopeNamespace, 96)
        || !Array.isArray(value.claims) || value.claims.length < 1 || value.claims.length > 256
        || new Set(value.claims.map((claim) => isPlainRecord(claim) ? claim.claimId : undefined)).size !== value.claims.length
        || !value.claims.every(validClaim) || !Array.isArray(value.evidence) || value.evidence.length > 512
        || !value.evidence.every(validEvidenceEntry) || !exactKeys(value.validity, ["notBeforeMs", "notAfterMs"])
        || !isTimestamp(value.validity.notBeforeMs) || !isTimestamp(value.validity.notAfterMs)
        || !authorityFree(value.authority) || !isDigest(value.packDigest))
        return false;
    return true;
}
function validCoverageClaim(value) {
    return exactKeys(value, ["claimId", "state"]) && isIdentifier(value.claimId) && isState(value.state);
}
function validCoverageShape(value) {
    return exactKeys(value, [
        "schemaVersion", "coverageId", "pack", "scopeNamespace", "evaluatedAtMs", "status", "claims", "authority", "coverageDigest",
    ]) && value.schemaVersion === CKS_EVIDENCE_COVERAGE_SCHEMA_V1 && isIdentifier(value.coverageId)
        && exactKeys(value.pack, ["packId", "packDigest"]) && isIdentifier(value.pack.packId) && isDigest(value.pack.packDigest)
        && isText(value.scopeNamespace, 96) && isTimestamp(value.evaluatedAtMs) && isState(value.status)
        && Array.isArray(value.claims) && value.claims.length > 0 && value.claims.length <= 256
        && value.claims.every(validCoverageClaim) && isPlainRecord(value.authority) && authorityFree(value.authority)
        && isDigest(value.coverageDigest);
}
const add = (reasons, reason) => {
    if (!reasons.includes(reason))
        reasons.push(reason);
};
export function validateCksEvidencePackV1(value, object, applicability, attestationResolver) {
    if (!isPlainRecord(value) || !exactKeys(value, [
        "schemaVersion", "packId", "object", "applicabilityDigest", "scopeNamespace", "claims", "evidence", "validity", "authority", "packDigest",
    ]))
        return ["SCHEMA_DENIED"];
    if (value.schemaVersion !== CKS_EVIDENCE_PACK_SCHEMA_V1)
        return ["STALE_VERSION_DENIED"];
    if (!authorityShape(value.authority))
        return ["SCHEMA_DENIED"];
    if (!authorityFree(value.authority))
        return ["AUTHORITY_DENIED"];
    if (!validPackShape(value))
        return ["SCHEMA_DENIED"];
    const reasons = [];
    if (value.validity.notAfterMs <= value.validity.notBeforeMs)
        add(reasons, "VALIDITY_DENIED");
    if (value.object.objectId !== object.objectId || value.object.objectDigest !== object.objectDigest) {
        add(reasons, "PROVENANCE_UNRESOLVED_DENIED");
    }
    if (applicability.object.objectId !== object.objectId || applicability.object.objectDigest !== object.objectDigest
        || value.applicabilityDigest !== applicability.applicabilityDigest)
        add(reasons, "APPLICABILITY_MISMATCH_DENIED");
    if (value.scopeNamespace !== object.provenance.scopeNamespace)
        add(reasons, "CROSS_SCOPE_BINDING_DENIED");
    if (applicability.scopeNamespace !== object.provenance.scopeNamespace)
        add(reasons, "CROSS_SCOPE_BINDING_DENIED");
    const claimIds = new Set(value.claims.map((claim) => claim.claimId));
    if (value.evidence.some((entry) => !claimIds.has(entry.claimId)))
        add(reasons, "SUBJECT_MISMATCH_DENIED");
    for (const reason of evidenceAttestationReasons(value, attestationResolver))
        add(reasons, reason);
    if (cksEvidencePackDigestV1(value) !== value.packDigest)
        add(reasons, "DIGEST_TAMPERED_DENIED");
    return reasons;
}
function derivedClaimState(entries, evaluatedAtMs, attestationResolver) {
    if (entries.length === 0)
        return "MISSING";
    if (entries.length > 1)
        return "CONFLICT";
    const entry = entries[0];
    const resolved = entry === undefined ? undefined : resolveAttestation(attestationResolver, entry.attestationDigest);
    const expiresAtMs = validVerificationAttestation(resolved) ? resolved.expiresAtMs : undefined;
    return expiresAtMs !== undefined && evaluatedAtMs > expiresAtMs ? "STALE" : "COMPLETE";
}
function derivedStatus(states) {
    if (states.includes("CONFLICT"))
        return "CONFLICT";
    if (states.includes("MISSING"))
        return "MISSING";
    if (states.includes("STALE"))
        return "STALE";
    return "COMPLETE";
}
export function validateCksEvidenceCoverageV1(value, pack, attestationResolver) {
    if (!isPlainRecord(value) || !exactKeys(value, [
        "schemaVersion", "coverageId", "pack", "scopeNamespace", "evaluatedAtMs", "status", "claims", "authority", "coverageDigest",
    ]))
        return ["SCHEMA_DENIED"];
    if (value.schemaVersion !== CKS_EVIDENCE_COVERAGE_SCHEMA_V1)
        return ["STALE_VERSION_DENIED"];
    if (!authorityShape(value.authority))
        return ["SCHEMA_DENIED"];
    if (!authorityFree(value.authority))
        return ["AUTHORITY_DENIED"];
    if (!validCoverageShape(value))
        return ["SCHEMA_DENIED"];
    if (!validPackShape(pack))
        return ["SCHEMA_DENIED"];
    const reasons = [];
    if (cksEvidencePackDigestV1(pack) !== pack.packDigest)
        add(reasons, "DIGEST_TAMPERED_DENIED");
    if (value.pack.packId !== pack.packId || value.pack.packDigest !== pack.packDigest)
        add(reasons, "DIGEST_TAMPERED_DENIED");
    if (value.scopeNamespace !== pack.scopeNamespace)
        add(reasons, "CROSS_SCOPE_BINDING_DENIED");
    if (value.evaluatedAtMs < pack.validity.notBeforeMs || value.evaluatedAtMs > pack.validity.notAfterMs)
        add(reasons, "VALIDITY_DENIED");
    for (const reason of evidenceAttestationReasons(pack, attestationResolver))
        add(reasons, reason);
    if (cksEvidenceCoverageDigestV1(value) !== value.coverageDigest)
        add(reasons, "DIGEST_TAMPERED_DENIED");
    const packClaimIds = pack.claims.map((claim) => claim.claimId);
    const coverageClaimIds = value.claims.map((claim) => claim.claimId);
    if (new Set(coverageClaimIds).size !== coverageClaimIds.length
        || coverageClaimIds.length !== packClaimIds.length
        || !packClaimIds.every((claimId) => coverageClaimIds.includes(claimId)))
        add(reasons, "CLAIM_COVERAGE_MISMATCH_DENIED");
    const states = packClaimIds.map((claimId) => derivedClaimState(pack.evidence.filter((entry) => entry.claimId === claimId), value.evaluatedAtMs, attestationResolver));
    const expectedStatus = derivedStatus(states);
    if (value.status !== expectedStatus) {
        if (expectedStatus === "MISSING")
            add(reasons, "EVIDENCE_MISSING_DENIED");
        if (expectedStatus === "CONFLICT")
            add(reasons, "EVIDENCE_CONFLICT_DENIED");
        if (expectedStatus === "STALE")
            add(reasons, "EVIDENCE_STALE_DENIED");
        add(reasons, "CLAIM_STATE_MISMATCH_DENIED");
    }
    if (expectedStatus === "MISSING" && value.status === "COMPLETE")
        add(reasons, "EVIDENCE_MISSING_DENIED");
    if (expectedStatus === "CONFLICT" && value.status === "COMPLETE")
        add(reasons, "EVIDENCE_CONFLICT_DENIED");
    if (expectedStatus === "STALE" && value.status === "COMPLETE")
        add(reasons, "EVIDENCE_STALE_DENIED");
    for (const [index, state] of states.entries()) {
        const covered = value.claims.find((claim) => claim.claimId === packClaimIds[index]);
        if (covered && covered.state !== state)
            add(reasons, "CLAIM_STATE_MISMATCH_DENIED");
    }
    return reasons;
}
