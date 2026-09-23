import { createHash } from "node:crypto";
import { types } from "node:util";
import { canonicalJson } from "./canonical-json.js";
/**
 * EVID-PROV-01 — closed v1 schema for inspectable evidence independence and
 * verifier provenance.
 *
 * A provenance record binds, in one closed content-digested document:
 * the claim, the exact commit/tree head, the inputs, the oracle, the
 * verifier implementation/tool/model identity class, the invocation digest,
 * the environment, the timestamp, the CI run/job URL/ID, and the result
 * digest, plus an explicit evidence class.
 *
 * The evidence classes are SELF_GENERATED, ISOLATED_INTERNAL_REVIEW,
 * THIRD_PARTY_EXECUTION_PLATFORM and EXTERNAL_INDEPENDENT_VALIDATION. Each
 * class carries its own support requirements and no class implies a
 * stronger one: claiming a class whose support is absent fails closed with
 * a structured denial.
 *
 * Verification never trusts caller-authored fields. It recomputes the
 * record content digest, then compares the recorded bindings against a
 * caller-supplied recomputation of the deterministic content and provider
 * state. Self-attested PASS/result fields, forged reviewer identities,
 * substituted oracle/input/head/run state, missing provider readback and
 * class promotion all return a structured DENIED (never an exception).
 *
 * The public review receipt projects only safe method/provenance fields and
 * the exact-head binding: no statement (hidden reasoning), no invocation
 * digest, no oracle/inputs detail, no reviewer handles, no environment
 * detail. Any secret-looking or private-path material in the projected
 * fields, and any non-public data class, fail closed.
 *
 * Legacy receipts migrate to the honest weakest class (SELF_GENERATED); the
 * only oracle that can be bound is the legacy receipt's own recomputed
 * bytes, and the legacy self-attested result field is ignored and never
 * re-represented. No retrospective external-independence claim is invented.
 */
const INVALID = Symbol("EVIDENCE_PROVENANCE_INVALID");
export const EVIDENCE_PROVENANCE_RECORD_SCHEMA_V1 = "chimpmaera.evidence/provenance-record/v1";
export const EVIDENCE_PROVENANCE_PUBLIC_RECEIPT_SCHEMA_V1 = "chimpmaera.evidence/public-review-receipt/v1";
export const EVIDENCE_PROVENANCE_VERSION_V1 = "1.0.0";
export const EVIDENCE_PROVENANCE_NONE = "NONE";
export const EVIDENCE_PROVENANCE_REASON_CODES_V1 = Object.freeze([
    "EVIDENCE_PROVENANCE_VERIFIED",
    "EVIDENCE_PROVENANCE_SCHEMA_DENIED",
    "EVIDENCE_PROVENANCE_CONTENT_DIGEST_DENIED",
    "EVIDENCE_PROVENANCE_INPUT_SUBSTITUTION_DENIED",
    "EVIDENCE_PROVENANCE_ORACLE_SUBSTITUTION_DENIED",
    "EVIDENCE_PROVENANCE_HEAD_SUBSTITUTION_DENIED",
    "EVIDENCE_PROVENANCE_RUN_SUBSTITUTION_DENIED",
    "EVIDENCE_PROVENANCE_RESULT_DIGEST_DENIED",
    "EVIDENCE_PROVENANCE_SELF_SIGNED_PASS_DENIED",
    "EVIDENCE_PROVENANCE_FORGED_REVIEWER_IDENTITY_DENIED",
    "EVIDENCE_PROVENANCE_MISSING_PROVIDER_READBACK_DENIED",
    "EVIDENCE_PROVENANCE_CLASS_PROMOTION_DENIED",
    "EVIDENCE_PROVENANCE_METHOD_CLASS_MISMATCH_DENIED",
    "EVIDENCE_PROVENANCE_RECEIPT_UNVERIFIED_DENIED",
    "EVIDENCE_PROVENANCE_DATA_CLASS_DENIED",
    "EVIDENCE_PROVENANCE_REDACTION_DENIED",
]);
export const EVIDENCE_PROVENANCE_CLASSES_V1 = Object.freeze([
    "SELF_GENERATED",
    "ISOLATED_INTERNAL_REVIEW",
    "THIRD_PARTY_EXECUTION_PLATFORM",
    "EXTERNAL_INDEPENDENT_VALIDATION",
]);
export const EVIDENCE_PROVENANCE_METHODS_V1 = Object.freeze([
    "DETERMINISTIC_RECOMPUTATION",
    "INDEPENDENT_REVIEW",
    "PLATFORM_EXECUTION",
    "EXTERNAL_VALIDATION",
]);
export const EVIDENCE_PROVENANCE_VERIFIER_IDENTITY_CLASSES_V1 = Object.freeze([
    "DETERMINISTIC_TOOL",
    "SELF_HOSTED_MODEL",
    "EXTERNAL_HOSTED_MODEL",
    "INDEPENDENT_REVIEWER",
]);
/**
 * Each class names exactly one method and no two classes share a method:
 * the mapping is a bijection, so no class implies a stronger one.
 */
export const EVIDENCE_PROVENANCE_CLASS_METHOD_V1 = Object.freeze({
    SELF_GENERATED: "DETERMINISTIC_RECOMPUTATION",
    ISOLATED_INTERNAL_REVIEW: "INDEPENDENT_REVIEW",
    THIRD_PARTY_EXECUTION_PLATFORM: "PLATFORM_EXECUTION",
    EXTERNAL_INDEPENDENT_VALIDATION: "EXTERNAL_VALIDATION",
});
const CODE = {
    SCHEMA: "EVIDENCE_PROVENANCE_SCHEMA_DENIED",
    CONTENT_DIGEST: "EVIDENCE_PROVENANCE_CONTENT_DIGEST_DENIED",
    INPUT_SUBSTITUTION: "EVIDENCE_PROVENANCE_INPUT_SUBSTITUTION_DENIED",
    ORACLE_SUBSTITUTION: "EVIDENCE_PROVENANCE_ORACLE_SUBSTITUTION_DENIED",
    HEAD_SUBSTITUTION: "EVIDENCE_PROVENANCE_HEAD_SUBSTITUTION_DENIED",
    RUN_SUBSTITUTION: "EVIDENCE_PROVENANCE_RUN_SUBSTITUTION_DENIED",
    RESULT_DIGEST: "EVIDENCE_PROVENANCE_RESULT_DIGEST_DENIED",
    SELF_SIGNED: "EVIDENCE_PROVENANCE_SELF_SIGNED_PASS_DENIED",
    FORGED_REVIEWER: "EVIDENCE_PROVENANCE_FORGED_REVIEWER_IDENTITY_DENIED",
    MISSING_READBACK: "EVIDENCE_PROVENANCE_MISSING_PROVIDER_READBACK_DENIED",
    PROMOTION: "EVIDENCE_PROVENANCE_CLASS_PROMOTION_DENIED",
    METHOD_MISMATCH: "EVIDENCE_PROVENANCE_METHOD_CLASS_MISMATCH_DENIED",
    RECEIPT_UNVERIFIED: "EVIDENCE_PROVENANCE_RECEIPT_UNVERIFIED_DENIED",
    DATA_CLASS: "EVIDENCE_PROVENANCE_DATA_CLASS_DENIED",
    REDACTION: "EVIDENCE_PROVENANCE_REDACTION_DENIED",
};
const TOP_KEYS = [
    "schemaVersion", "recordId", "dataClass", "claim", "evidenceClass", "head",
    "inputs", "oracle", "verifier", "invocationDigest", "environment",
    "timestamp", "ci", "provider", "review", "method", "resultDigest", "contentDigest",
];
const INPUT_KEYS = [
    "recordId", "dataClass", "claim", "evidenceClass", "head",
    "inputs", "oracle", "verifier", "invocationDigest", "environment",
    "timestamp", "ci", "provider", "review", "method", "resultDigest",
];
const CLAIM_KEYS = ["claimId", "statement"];
const HEAD_KEYS = ["commitSha", "treeSha"];
const INPUTS_KEYS = ["inputsDigest"];
const ORACLE_KEYS = ["oracleId", "oracleDigest"];
const VERIFIER_KEYS = ["implementation", "tool", "model", "identityClass"];
const ENVIRONMENT_KEYS = ["platform", "runtime"];
const CI_KEYS = ["provider", "runId", "runUrl", "jobId"];
const PROVIDER_KEYS = ["organization", "readbackUrl", "readbackDigest", "readbackTimestamp"];
const REVIEW_KEYS = ["producerId", "producerOrganization", "reviewerId", "reviewerIdentityDigest"];
const NESTED_OBJECT_KEYS = ["claim", "head", "inputs", "oracle", "verifier", "environment", "ci", "provider", "review"];
const RECOMPUTATION_KEYS = ["inputsDigest", "oracleDigest", "head", "ciRunId", "providerReadbackDigest", "resultDigest"];
const VERIFICATION_KEYS = ["outcome", "reasonCodes", "evidenceClass", "contentDigest"];
const MIGRATION_KEYS = [
    "receiptId", "receiptDigest", "legacyResult", "statement", "head",
    "verifier", "environment", "timestamp", "dataClass",
];
/**
 * Field names whose presence anywhere in the record is self-attestation.
 * A closure test recomputes truth; it does not read a PASS the caller wrote.
 */
const SELF_SIGNED_KEYS = new Set([
    "pass", "PASS", "result", "verified", "selfAttested", "ok", "outcome", "status",
]);
const HEX64 = /^[a-f0-9]{64}$/;
const SHA40 = /^[a-f0-9]{40}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const ASCII_VISIBLE = /^[\x21-\x7E]+$/;
const GITHUB_RUN_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/(?:runs|workflows)\/\d+/;
const HTTPS_URL = /^https:\/\/\S+$/;
/**
 * Secret and private-path detectors for the public receipt projection. Any
 * hit fails closed with a structured denial; the receipt is never issued.
 */
const SECRET_PATTERNS = [
    [/gh[pousr]_[A-Za-z0-9]{16,}/, "github_token"],
    [/github_pat_[A-Za-z0-9_]{16,}/, "github_pat"],
    [/\bAKIA[A-Z0-9]{16}\b/, "aws_access_key"],
    [/\bsk-[A-Za-z0-9_-]{16,}\b/, "openai_key"],
    [/\bxox[baprs]-[A-Za-z0-9-]{8,}\b/, "slack_token"],
    [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/, "private_key"],
    [/\bBearer [A-Za-z0-9._~+/-]{16,}/, "bearer_token"],
    [/^[~\\/]/, "private_path"],
    [/^[A-Za-z]:[\\/]/, "private_path"],
    [/[/\\](?:Users|home|Documents|Downloads|secrets|\.ssh|\.aws)(?:[/\\]|$)/i, "private_path"],
    [/\b(?:api[_-]?key|password|passwd|secret|token|access[_-]?key)\b\s*[:=]/i, "credential_assignment"],
];
// --- plain-JSON guards (fail-closed; never invoke a trap) -------------------
function deepPlain(value, seen) {
    if (value === null)
        return null;
    if (typeof value === "string" || typeof value === "boolean")
        return value;
    if (typeof value === "number")
        return Number.isFinite(value) ? value : INVALID;
    if (typeof value !== "object")
        return INVALID;
    try {
        if (types.isProxy(value))
            return INVALID;
        if (seen.has(value))
            return INVALID;
        seen.add(value);
        if (Array.isArray(value)) {
            const entries = [];
            for (const item of value) {
                const child = deepPlain(item, seen);
                if (child === INVALID)
                    return INVALID;
                entries.push(child);
            }
            return entries;
        }
        if (Object.getPrototypeOf(value) !== Object.prototype)
            return INVALID;
        const record = value;
        const out = {};
        for (const key of Object.keys(record)) {
            const property = Object.getOwnPropertyDescriptor(record, key);
            if (property === undefined || property.get !== undefined || property.set !== undefined)
                return INVALID;
            const child = deepPlain(record[key], seen);
            if (child === INVALID)
                return INVALID;
            out[key] = child;
        }
        return out;
    }
    catch {
        return INVALID;
    }
}
function plainObject(value) {
    const plain = deepPlain(value, new Set());
    return plain !== null && typeof plain === "object" && !Array.isArray(plain)
        ? plain
        : null;
}
function digestHex(value) {
    return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
function freeze(value) {
    if (Array.isArray(value)) {
        for (const entry of value)
            freeze(entry);
        Object.freeze(value);
        return value;
    }
    if (value !== null && typeof value === "object") {
        for (const entry of Object.values(value))
            freeze(entry);
        Object.freeze(value);
        return value;
    }
    return value;
}
function asExactRecord(value, keys) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        return null;
    const record = value;
    if (canonicalJson(Object.keys(record).sort()) !== canonicalJson([...keys].sort()))
        return null;
    return record;
}
function deny(defects) {
    return freeze({ outcome: "DENIED", reasonCodes: [...defects].sort() });
}
// --- field validators --------------------------------------------------------
const isString = (value) => typeof value === "string";
const isNone = (value) => value === EVIDENCE_PROVENANCE_NONE;
function isIdentifier(value, max) {
    return isString(value) && value.length >= 1 && value.length <= max && ASCII_VISIBLE.test(value);
}
function isDigest(value) {
    return isString(value) && (value === EVIDENCE_PROVENANCE_NONE || HEX64.test(value));
}
function isHex64(value) {
    return isString(value) && HEX64.test(value);
}
function isSha40(value) {
    return isString(value) && SHA40.test(value);
}
function isTimestamp(value) {
    return isString(value) && RFC3339.test(value);
}
function isHttpsUrl(value) {
    return isString(value) && HTTPS_URL.test(value);
}
function isGithubRunUrl(value) {
    return isString(value) && GITHUB_RUN_URL.test(value);
}
function isStatement(value) {
    return isString(value) && value.length >= 1 && value.length <= 8192;
}
function isEvidenceClass(value) {
    return isString(value) && EVIDENCE_PROVENANCE_CLASSES_V1.includes(value);
}
function isMethod(value) {
    return isString(value) && EVIDENCE_PROVENANCE_METHODS_V1.includes(value);
}
function isVerifierIdentityClass(value) {
    return isString(value) && EVIDENCE_PROVENANCE_VERIFIER_IDENTITY_CLASSES_V1.includes(value);
}
function isDataClass(value) {
    return isString(value) && (value === "PUBLIC_SYNTHETIC" || value === "OWNER_PRIVATE_REFERENCE");
}
function hasSelfSignedKey(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        return false;
    return Object.keys(value).some((key) => SELF_SIGNED_KEYS.has(key));
}
/**
 * Class support rules. A class may only be claimed when the record carries
 * the support that class requires; claiming a stronger class over weaker
 * support fails closed. Requiring digests for review and above is what keeps
 * the classes from implying one another.
 */
function addClassSupportDefects(defects, cls, support) {
    const requireDigests = () => {
        if (support.inputsDigest === EVIDENCE_PROVENANCE_NONE)
            defects.add(CODE.PROMOTION);
        if (support.oracleDigest === EVIDENCE_PROVENANCE_NONE)
            defects.add(CODE.PROMOTION);
        if (support.resultDigest === EVIDENCE_PROVENANCE_NONE)
            defects.add(CODE.PROMOTION);
    };
    if (cls === "ISOLATED_INTERNAL_REVIEW") {
        if (support.reviewerId === EVIDENCE_PROVENANCE_NONE)
            defects.add(CODE.PROMOTION);
        requireDigests();
    }
    else if (cls === "THIRD_PARTY_EXECUTION_PLATFORM") {
        if (support.ciProvider === EVIDENCE_PROVENANCE_NONE)
            defects.add(CODE.PROMOTION);
        if (support.organization === EVIDENCE_PROVENANCE_NONE)
            defects.add(CODE.PROMOTION);
        if (support.readbackDigest === EVIDENCE_PROVENANCE_NONE)
            defects.add(CODE.MISSING_READBACK);
        requireDigests();
    }
    else if (cls === "EXTERNAL_INDEPENDENT_VALIDATION") {
        if (support.ciProvider === EVIDENCE_PROVENANCE_NONE)
            defects.add(CODE.PROMOTION);
        if (support.organization === EVIDENCE_PROVENANCE_NONE)
            defects.add(CODE.PROMOTION);
        if (support.readbackDigest === EVIDENCE_PROVENANCE_NONE)
            defects.add(CODE.MISSING_READBACK);
        if (support.identityClass === "DETERMINISTIC_TOOL" || support.identityClass === "SELF_HOSTED_MODEL") {
            defects.add(CODE.PROMOTION);
        }
        if (support.producerOrganization === EVIDENCE_PROVENANCE_NONE)
            defects.add(CODE.PROMOTION);
        else if (support.producerOrganization === support.organization)
            defects.add(CODE.PROMOTION);
        requireDigests();
    }
}
/**
 * Shared structural checks for a provenance record (builder input or full
 * record). Returns the defect set; an empty set means the record is structurally
 * sound, class-supported and free of self-attestation.
 */
function recordDefects(plain, expectContentDigest) {
    const defects = new Set();
    // Self-attestation is denied before any key-set short-circuit so a hostile
    // extra PASS key cannot hide behind a generic schema denial.
    if (hasSelfSignedKey(plain))
        defects.add(CODE.SELF_SIGNED);
    for (const key of NESTED_OBJECT_KEYS) {
        if (hasSelfSignedKey(plain[key]))
            defects.add(CODE.SELF_SIGNED);
    }
    const rec = asExactRecord(plain, expectContentDigest ? TOP_KEYS : INPUT_KEYS);
    if (rec === null) {
        defects.add(CODE.SCHEMA);
        return defects;
    }
    // The builder stamps the schema version itself; a caller-supplied one must
    // match exactly, an absent one is not a defect.
    if (rec.schemaVersion !== undefined && rec.schemaVersion !== EVIDENCE_PROVENANCE_RECORD_SCHEMA_V1) {
        defects.add(CODE.SCHEMA);
    }
    if (!isIdentifier(rec.recordId, 512))
        defects.add(CODE.SCHEMA);
    if (!isDataClass(rec.dataClass))
        defects.add(CODE.SCHEMA);
    if (!isEvidenceClass(rec.evidenceClass))
        defects.add(CODE.SCHEMA);
    if (!isMethod(rec.method))
        defects.add(CODE.SCHEMA);
    if (!isTimestamp(rec.timestamp))
        defects.add(CODE.SCHEMA);
    if (!isDigest(rec.invocationDigest))
        defects.add(CODE.SCHEMA);
    if (!isDigest(rec.resultDigest))
        defects.add(CODE.SCHEMA);
    if (expectContentDigest && !isHex64(rec.contentDigest))
        defects.add(CODE.SCHEMA);
    const claim = asExactRecord(rec.claim, CLAIM_KEYS);
    if (claim === null || !isIdentifier(claim.claimId, 512) || !isStatement(claim.statement)) {
        defects.add(CODE.SCHEMA);
    }
    const head = asExactRecord(rec.head, HEAD_KEYS);
    if (head === null || !isSha40(head.commitSha) || !isSha40(head.treeSha))
        defects.add(CODE.SCHEMA);
    const inputs = asExactRecord(rec.inputs, INPUTS_KEYS);
    if (inputs === null || !isDigest(inputs.inputsDigest))
        defects.add(CODE.SCHEMA);
    const oracle = asExactRecord(rec.oracle, ORACLE_KEYS);
    if (oracle === null || !isIdentifier(oracle.oracleId, 512) || !isDigest(oracle.oracleDigest)) {
        defects.add(CODE.SCHEMA);
    }
    const verifier = asExactRecord(rec.verifier, VERIFIER_KEYS);
    if (verifier === null ||
        !isIdentifier(verifier.implementation, 512) ||
        !isIdentifier(verifier.tool, 128) ||
        (!isIdentifier(verifier.model, 128) && !isNone(verifier.model)) ||
        !isVerifierIdentityClass(verifier.identityClass)) {
        defects.add(CODE.SCHEMA);
    }
    const environment = asExactRecord(rec.environment, ENVIRONMENT_KEYS);
    if (environment === null ||
        !isIdentifier(environment.platform, 128) ||
        !isIdentifier(environment.runtime, 128)) {
        defects.add(CODE.SCHEMA);
    }
    const ci = asExactRecord(rec.ci, CI_KEYS);
    if (ci === null) {
        defects.add(CODE.SCHEMA);
    }
    else if (ci.provider === "NONE") {
        if (!isNone(ci.runId) || !isNone(ci.runUrl) || !isNone(ci.jobId))
            defects.add(CODE.SCHEMA);
    }
    else if (ci.provider === "GITHUB_ACTIONS") {
        if (!isIdentifier(ci.runId, 256) || !isIdentifier(ci.jobId, 256) || !isGithubRunUrl(ci.runUrl)) {
            defects.add(CODE.SCHEMA);
        }
    }
    else {
        defects.add(CODE.SCHEMA);
    }
    const provider = asExactRecord(rec.provider, PROVIDER_KEYS);
    if (provider === null) {
        defects.add(CODE.SCHEMA);
    }
    else if (isNone(provider.organization)) {
        if (!isNone(provider.readbackUrl) || !isNone(provider.readbackDigest) || !isNone(provider.readbackTimestamp)) {
            defects.add(CODE.SCHEMA);
        }
    }
    else if (!isIdentifier(provider.organization, 256) ||
        !isHttpsUrl(provider.readbackUrl) ||
        !isHex64(provider.readbackDigest) ||
        !isTimestamp(provider.readbackTimestamp)) {
        defects.add(CODE.SCHEMA);
    }
    const review = asExactRecord(rec.review, REVIEW_KEYS);
    if (review === null ||
        !(isNone(review.producerId) || isIdentifier(review.producerId, 256)) ||
        !(isNone(review.producerOrganization) || isIdentifier(review.producerOrganization, 256)) ||
        !(isNone(review.reviewerId) || isIdentifier(review.reviewerId, 256)) ||
        !(isNone(review.reviewerIdentityDigest) || isHex64(review.reviewerIdentityDigest))) {
        defects.add(CODE.SCHEMA);
    }
    else {
        // A reviewer binding is always attested against a distinct producer.
        if (!isNone(review.reviewerId) &&
            (isNone(review.producerId) ||
                review.reviewerId === review.producerId ||
                isNone(review.reviewerIdentityDigest))) {
            defects.add(CODE.FORGED_REVIEWER);
        }
    }
    const cls = rec.evidenceClass;
    if (isEvidenceClass(cls) && rec.method !== EVIDENCE_PROVENANCE_CLASS_METHOD_V1[cls]) {
        defects.add(CODE.METHOD_MISMATCH);
    }
    if (isEvidenceClass(cls) &&
        claim !== null &&
        inputs !== null &&
        oracle !== null &&
        verifier !== null &&
        ci !== null &&
        provider !== null &&
        review !== null) {
        addClassSupportDefects(defects, cls, {
            inputsDigest: inputs.inputsDigest,
            oracleDigest: oracle.oracleDigest,
            resultDigest: rec.resultDigest,
            reviewerId: review.reviewerId,
            ciProvider: ci.provider,
            organization: provider.organization,
            readbackDigest: provider.readbackDigest,
            identityClass: verifier.identityClass,
            producerOrganization: review.producerOrganization,
        });
    }
    return defects;
}
/**
 * Recomputation-bound checks: the record's bindings must equal the
 * caller-supplied recomputation of deterministic content and provider state.
 * Only bindings the record actually declared (not NONE) are compared.
 */
function recomputationDefects(rec, recomputation, defects) {
    const rc = asExactRecord(recomputation, RECOMPUTATION_KEYS);
    if (rc === null) {
        defects.add(CODE.SCHEMA);
        return;
    }
    const rhead = asExactRecord(rc.head, HEAD_KEYS);
    if (!isDigest(rc.inputsDigest) ||
        !isDigest(rc.oracleDigest) ||
        !isDigest(rc.resultDigest) ||
        !isDigest(rc.providerReadbackDigest) ||
        !isNone(rc.ciRunId) && !isIdentifier(rc.ciRunId, 256) ||
        rhead === null ||
        !isSha40(rhead.commitSha) ||
        !isSha40(rhead.treeSha)) {
        defects.add(CODE.SCHEMA);
        return;
    }
    const head = asExactRecord(rec.head, HEAD_KEYS);
    const inputs = asExactRecord(rec.inputs, INPUTS_KEYS);
    const oracle = asExactRecord(rec.oracle, ORACLE_KEYS);
    const ci = asExactRecord(rec.ci, CI_KEYS);
    const provider = asExactRecord(rec.provider, PROVIDER_KEYS);
    if (head !== null && (head.commitSha !== rhead.commitSha || head.treeSha !== rhead.treeSha)) {
        defects.add(CODE.HEAD_SUBSTITUTION);
    }
    if (inputs !== null && inputs.inputsDigest !== EVIDENCE_PROVENANCE_NONE && rc.inputsDigest !== inputs.inputsDigest) {
        defects.add(CODE.INPUT_SUBSTITUTION);
    }
    if (oracle !== null && oracle.oracleDigest !== EVIDENCE_PROVENANCE_NONE && rc.oracleDigest !== oracle.oracleDigest) {
        defects.add(CODE.ORACLE_SUBSTITUTION);
    }
    if (isDigest(rec.resultDigest) &&
        rec.resultDigest !== EVIDENCE_PROVENANCE_NONE &&
        rc.resultDigest !== rec.resultDigest) {
        defects.add(CODE.RESULT_DIGEST);
    }
    if (ci !== null && ci.provider === "GITHUB_ACTIONS" && rc.ciRunId !== ci.runId) {
        defects.add(CODE.RUN_SUBSTITUTION);
    }
    if (provider !== null && provider.readbackDigest !== EVIDENCE_PROVENANCE_NONE) {
        if (rc.providerReadbackDigest === EVIDENCE_PROVENANCE_NONE)
            defects.add(CODE.MISSING_READBACK);
        else if (rc.providerReadbackDigest !== provider.readbackDigest)
            defects.add(CODE.RUN_SUBSTITUTION);
    }
}
// --- public API ----------------------------------------------------------------
/**
 * Build a frozen, content-digested provenance record from caller input. The
 * input is validated fail-closed (closed schema, class support, no
 * self-attested fields) and never mutated; the content digest is computed
 * over the stamped record and must be recomputed, not trusted.
 */
export function createEvidenceProvenanceRecordV1(input) {
    const plain = plainObject(input);
    if (plain === null)
        return deny(new Set([CODE.SCHEMA]));
    const defects = recordDefects(plain, false);
    if (defects.size > 0)
        return deny(defects);
    const stamped = { ...plain, schemaVersion: EVIDENCE_PROVENANCE_RECORD_SCHEMA_V1 };
    const record = { ...stamped, contentDigest: digestHex(stamped) };
    return freeze({ outcome: "BUILT", record: record });
}
/**
 * Verify a provenance record against a recomputation of its deterministic
 * content and provider state. The stored content digest is recomputed and
 * the recorded bindings are compared against the recomputation; caller-
 * authored PASS fields never confer verification.
 */
export function verifyEvidenceProvenanceV1(record, recomputation) {
    const rplain = plainObject(record);
    const cplain = plainObject(recomputation);
    if (rplain === null || cplain === null)
        return deny(new Set([CODE.SCHEMA]));
    const defects = recordDefects(rplain, true);
    const { contentDigest: _stored, ...rest } = rplain;
    if (rplain.contentDigest !== digestHex(rest))
        defects.add(CODE.CONTENT_DIGEST);
    const rec = asExactRecord(rplain, TOP_KEYS);
    if (rec !== null)
        recomputationDefects(rec, cplain, defects);
    if (defects.size > 0)
        return deny(defects);
    return freeze({
        outcome: "VERIFIED",
        reasonCodes: ["EVIDENCE_PROVENANCE_VERIFIED"],
        evidenceClass: rplain.evidenceClass,
        contentDigest: rplain.contentDigest,
    });
}
/**
 * Issue the public review receipt for a verified record. The receipt is
 * bound to the verified record's recomputed content digest, projects only
 * safe method/provenance fields and the exact-head binding, and fails
 * closed on non-public data classes and on any secret or private-path
 * material inside the projected fields.
 */
export function publicReviewReceiptV1(record, verification) {
    const rplain = plainObject(record);
    const vplain = plainObject(verification);
    if (rplain === null || vplain === null)
        return deny(new Set([CODE.RECEIPT_UNVERIFIED]));
    const v = asExactRecord(vplain, VERIFICATION_KEYS);
    const rc = v === null ? null : v.reasonCodes;
    if (v === null ||
        v.outcome !== "VERIFIED" ||
        !Array.isArray(rc) ||
        rc.length !== 1 ||
        rc[0] !== "EVIDENCE_PROVENANCE_VERIFIED" ||
        !isEvidenceClass(v.evidenceClass) ||
        !isHex64(v.contentDigest)) {
        return deny(new Set([CODE.RECEIPT_UNVERIFIED]));
    }
    const rec = asExactRecord(rplain, TOP_KEYS);
    if (rec === null)
        return deny(new Set([CODE.RECEIPT_UNVERIFIED]));
    const { contentDigest: _stored, ...rest } = rplain;
    const recomputedDigest = digestHex(rest);
    if (rplain.contentDigest !== recomputedDigest)
        return deny(new Set([CODE.RECEIPT_UNVERIFIED]));
    if (v.contentDigest !== recomputedDigest)
        return deny(new Set([CODE.RECEIPT_UNVERIFIED]));
    if (v.evidenceClass !== rplain.evidenceClass)
        return deny(new Set([CODE.RECEIPT_UNVERIFIED]));
    if (rplain.dataClass !== "PUBLIC_SYNTHETIC")
        return deny(new Set([CODE.DATA_CLASS]));
    const claim = rplain.claim;
    const head = rplain.head;
    const verifier = rplain.verifier;
    const ci = rplain.ci;
    const provider = rplain.provider;
    const receiptBody = {
        schemaVersion: EVIDENCE_PROVENANCE_PUBLIC_RECEIPT_SCHEMA_V1,
        recordId: rplain.recordId,
        claimId: claim.claimId,
        evidenceClass: rplain.evidenceClass,
        method: rplain.method,
        head: { commitSha: head.commitSha, treeSha: head.treeSha },
        verifier: {
            implementation: verifier.implementation,
            tool: verifier.tool,
            model: verifier.model,
            identityClass: verifier.identityClass,
        },
        ci: { provider: ci.provider, runId: ci.runId, runUrl: ci.runUrl, jobId: ci.jobId },
        provider: {
            organization: provider.organization,
            readbackUrl: provider.readbackUrl,
            readbackDigest: provider.readbackDigest,
            readbackTimestamp: provider.readbackTimestamp,
        },
        dataClass: rplain.dataClass,
        timestamp: rplain.timestamp,
        resultDigest: rplain.resultDigest,
        contentDigest: recomputedDigest,
    };
    const hits = new Set();
    scanForSecrets(receiptBody, hits);
    if (hits.size > 0)
        return deny(new Set([CODE.REDACTION]));
    const receipt = {
        ...receiptBody,
        receiptDigest: digestHex(receiptBody),
    };
    return freeze({ outcome: "ISSUED", receipt: receipt });
}
function scanForSecrets(value, hits) {
    if (typeof value === "string") {
        for (const [pattern, label] of SECRET_PATTERNS) {
            if (pattern.test(value))
                hits.add(label);
        }
    }
    else if (Array.isArray(value)) {
        for (const entry of value)
            scanForSecrets(entry, hits);
    }
    else if (value !== null && typeof value === "object") {
        for (const entry of Object.values(value))
            scanForSecrets(entry, hits);
    }
}
/**
 * Migrate a legacy checked-in receipt with the honest weakest class only.
 * The legacy self-attested result field is ignored and never re-represented;
 * the only oracle that can be bound is the legacy receipt's own recomputed
 * bytes. Verifier identity classes that would imply independence are
 * refused. No retrospective external-independence claim is invented.
 */
export function migrateLegacyEvidenceReceiptV1(input) {
    const plain = plainObject(input);
    if (plain === null)
        return deny(new Set([CODE.SCHEMA]));
    const mig = asExactRecord(plain, MIGRATION_KEYS);
    if (mig === null)
        return deny(new Set([CODE.SCHEMA]));
    const defects = new Set();
    if (!isIdentifier(mig.receiptId, 256))
        defects.add(CODE.SCHEMA);
    if (!isHex64(mig.receiptDigest))
        defects.add(CODE.SCHEMA);
    if (!isIdentifier(mig.legacyResult, 128))
        defects.add(CODE.SCHEMA);
    if (!isStatement(mig.statement))
        defects.add(CODE.SCHEMA);
    const head = asExactRecord(mig.head, HEAD_KEYS);
    if (head === null || !isSha40(head.commitSha) || !isSha40(head.treeSha))
        defects.add(CODE.SCHEMA);
    const verifier = asExactRecord(mig.verifier, VERIFIER_KEYS);
    if (verifier === null ||
        !isIdentifier(verifier.implementation, 512) ||
        !isIdentifier(verifier.tool, 128) ||
        (!isIdentifier(verifier.model, 128) && !isNone(verifier.model))) {
        defects.add(CODE.SCHEMA);
    }
    if (verifier !== null &&
        verifier.identityClass !== "DETERMINISTIC_TOOL" &&
        verifier.identityClass !== "SELF_HOSTED_MODEL") {
        defects.add(CODE.PROMOTION);
    }
    const environment = asExactRecord(mig.environment, ENVIRONMENT_KEYS);
    if (environment === null ||
        !isIdentifier(environment.platform, 128) ||
        !isIdentifier(environment.runtime, 128)) {
        defects.add(CODE.SCHEMA);
    }
    if (!isTimestamp(mig.timestamp))
        defects.add(CODE.SCHEMA);
    if (!isDataClass(mig.dataClass))
        defects.add(CODE.SCHEMA);
    if (defects.size > 0)
        return deny(defects);
    // Unreachable (any null here already recorded a schema defect), but keeps
    // the strict-mode narrowing honest for the object construction below.
    if (head === null || verifier === null || environment === null) {
        return deny(new Set([CODE.SCHEMA]));
    }
    const receiptId = mig.receiptId;
    const built = createEvidenceProvenanceRecordV1({
        recordId: `migrated:${receiptId}`,
        dataClass: mig.dataClass,
        claim: { claimId: `legacy-receipt:${receiptId}`, statement: mig.statement },
        evidenceClass: "SELF_GENERATED",
        head: { commitSha: head.commitSha, treeSha: head.treeSha },
        inputs: { inputsDigest: EVIDENCE_PROVENANCE_NONE },
        oracle: { oracleId: `legacy-receipt:${receiptId}`, oracleDigest: mig.receiptDigest },
        verifier: {
            implementation: verifier.implementation,
            tool: verifier.tool,
            model: verifier.model,
            identityClass: verifier.identityClass,
        },
        invocationDigest: EVIDENCE_PROVENANCE_NONE,
        environment: { platform: environment.platform, runtime: environment.runtime },
        timestamp: mig.timestamp,
        ci: {
            provider: EVIDENCE_PROVENANCE_NONE,
            runId: EVIDENCE_PROVENANCE_NONE,
            runUrl: EVIDENCE_PROVENANCE_NONE,
            jobId: EVIDENCE_PROVENANCE_NONE,
        },
        provider: {
            organization: EVIDENCE_PROVENANCE_NONE,
            readbackUrl: EVIDENCE_PROVENANCE_NONE,
            readbackDigest: EVIDENCE_PROVENANCE_NONE,
            readbackTimestamp: EVIDENCE_PROVENANCE_NONE,
        },
        review: {
            producerId: EVIDENCE_PROVENANCE_NONE,
            producerOrganization: EVIDENCE_PROVENANCE_NONE,
            reviewerId: EVIDENCE_PROVENANCE_NONE,
            reviewerIdentityDigest: EVIDENCE_PROVENANCE_NONE,
        },
        method: "DETERMINISTIC_RECOMPUTATION",
        resultDigest: EVIDENCE_PROVENANCE_NONE,
    });
    if (built.outcome !== "BUILT")
        return deny(new Set(built.reasonCodes));
    return freeze({
        outcome: "MIGRATED",
        record: built.record,
        nonclaims: ["WEAKEST_CLASS_ASSIGNED", "LEGACY_SELF_SIGNED_RESULT_IGNORED"],
    });
}
