import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
/**
 * CCP PSAI52 bounded intake boundary (M0 reconcile, event side): canonical
 * event bytes for synthetic intake ledger events. A pure in-memory parse and
 * canonicalization of closed synthetic delivery event envelopes. It has no
 * network, persistence, process, worker, credential, untrusted-code
 * execution, CI-slot or merge effect capability.
 *
 * The logical clock is injected: `logicalAtMs` is carried as data only and
 * this module never reads Date, Date.now, performance.now, process uptime or
 * file-system timestamps. Fixture digests derive solely from the injected
 * immutable seed through the closed domain-bound fixture derivation below;
 * no ambient randomness or clock is read.
 *
 * The SHA-256 values are unkeyed. They prove byte-stable deterministic
 * consistency only. They do not authenticate a caller, resist rollback,
 * establish trusted time, prove Git ancestry/GitHub delivery, or grant
 * production authority.
 */
export const CCP_EVENT_ENVELOPE_SCHEMA_V1 = "cm.ccp-event-envelope/v1";
export const CCP_INTAKE_LEDGER_SCHEMA_V1 = "cm.ccp-intake-ledger/v1";
export const CCP_INTAKE_ENTRY_SCHEMA_V1 = "cm.ccp-intake-entry/v1";
export const CCP_INTAKE_RECEIPT_SCHEMA_V1 = "cm.ccp-intake-receipt/v1";
export const CCP_SEMANTIC_EFFECT_SCHEMA_V1 = "cm.ccp-semantic-effect/v1";
/**
 * Bounded integration receipt for TERRA-PSAI52-CONTRACT-INTEGRATE-01. It
 * binds references to the six closed CCP proof areas without treating the
 * references as a verification result or granting any authority.
 */
export const CCP_PSAI52_INTEGRATION_RECEIPT_INPUT_SCHEMA_V1 = "cm.ccp-psai52-integration-receipt-input/v1";
export const CCP_PSAI52_INTEGRATION_RECEIPT_SCHEMA_V1 = "cm.ccp-psai52-integration-receipt/v1";
export const CCP_PSAI52_INTEGRATION_TASK_ID_V1 = "TERRA-PSAI52-CONTRACT-INTEGRATE-01";
export const CCP_PSAI52_INTEGRATION_CLAIM_BOUNDARY_V1 = "EVIDENCE_BINDING_ONLY_NO_VERIFICATION_OR_AUTHORITY_CLAIM";
export const CCP_PSAI52_PRESERVED_DECISION_IDS_V1 = Object.freeze([
    "D-001",
    "D-002",
    "D-003",
    "D-004",
    "D-005",
    "D-006",
    "D-007",
]);
export const CCP_PSAI52_INTEGRATION_CLAIM_IDS_V1 = Object.freeze([
    "SYNTHETIC_INGESTION_AND_REPLAY",
    "SUPERSESSION_DEEP_CI_EXCLUSION",
    "FAIL_CLOSED_QUARANTINE",
    "FAIRNESS_QUEUE_COST_RECOVERY_OBSERVABILITY",
    "RUNNER_QUEUE_API_RECOVERY",
    "EXACT_LKG_RESTORE",
]);
/** Injected immutable seed locked by the PSAI52 M0-M2 proof boundary. */
export const CCP_SEED_V1 = "SOL-PSAI52-M0-M2-SEED-V1";
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const SEED_PATTERN = /^SOL-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const NAMESPACED_ID_SUFFIX = "[a-z0-9][a-z0-9._-]{2,95}";
export const LEDGER_ID_PATTERN = new RegExp(`^ledger:${NAMESPACED_ID_SUFFIX}$`);
export const TENANT_ID_PATTERN = new RegExp(`^tenant:${NAMESPACED_ID_SUFFIX}$`);
export const REPOSITORY_ID_PATTERN = new RegExp(`^repository:${NAMESPACED_ID_SUFFIX}$`);
export const CONTRIBUTION_ID_PATTERN = new RegExp(`^contribution:${NAMESPACED_ID_SUFFIX}$`);
export const DELIVERY_ID_PATTERN = new RegExp(`^delivery:${NAMESPACED_ID_SUFFIX}$`);
const PROFILE_ID_PATTERN = new RegExp(`^profile:${NAMESPACED_ID_SUFFIX}$`);
const LABEL_PATTERN = /^[a-z0-9][a-z0-9._-]{0,95}$/;
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const EVENT_ENVELOPE_KEYS = Object.freeze([
    "schemaVersion", "ledgerId", "tenantId", "repositoryId", "contributionId",
    "deliveryId", "headDigest", "payloadDigest", "ancestorDigest", "logicalAtMs",
]);
const FIXTURE_DERIVATION_KEYS = Object.freeze([
    "seed", "profileId", "label", "sourceOrdinal",
]);
const PSAI52_INTEGRATION_EVIDENCE_KEYS = Object.freeze(["claimId", "evidenceDigest"]);
const PSAI52_INTEGRATION_INPUT_KEYS = Object.freeze([
    "schemaVersion", "taskId", "preservedDecisionIds", "evidence", "logicalAtMs",
]);
const PSAI52_INTEGRATION_RECEIPT_KEYS = Object.freeze([
    "schemaVersion", "taskId", "preservedDecisionIds", "evidence", "logicalAtMs", "evidenceComplete",
    "decision", "claimBoundary", "verificationClaimed", "executionAuthorized", "mergeAuthorized",
    "externalEffectsObserved", "receiptDigest",
]);
const PSAI52_INTEGRATION_DENIED = "CCP_PSAI52_INTEGRATION_RECEIPT_SCHEMA_DENIED";
export function ccpStrictDenyV1(code) {
    throw new TypeError(code);
}
/**
 * Closed-data object boundary: plain objects only, exact expected key set,
 * no cycles, no symbol keys, no dangerous keys, and value-only enumerable
 * descriptors. Returns a null-prototype closed copy of the accepted data.
 */
export function readCcpClosedObjectV1(value, expectedKeys, seen, code) {
    if (value === null || typeof value !== "object" || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype)
        ccpStrictDenyV1(code);
    if (seen.has(value))
        ccpStrictDenyV1(code);
    seen.add(value);
    const keys = Reflect.ownKeys(value);
    if (keys.length !== expectedKeys.length || keys.some((key) => typeof key !== "string"))
        ccpStrictDenyV1(code);
    const expected = new Set(expectedKeys);
    const result = Object.create(null);
    for (const key of keys) {
        if (typeof key !== "string" || DANGEROUS_KEYS.has(key) || !expected.has(key))
            ccpStrictDenyV1(code);
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable)
            ccpStrictDenyV1(code);
        result[key] = descriptor.value;
    }
    if (expectedKeys.some((key) => !Object.hasOwn(result, key)))
        ccpStrictDenyV1(code);
    return result;
}
/**
 * Dense ordinary array boundary: Array.prototype only, safe-integer length,
 * dense 0..n-1 value-only enumerable indices, no cycles, no exotic keys.
 */
export function readCcpDenseArrayV1(value, seen, code) {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
        ccpStrictDenyV1(code);
    if (seen.has(value))
        ccpStrictDenyV1(code);
    seen.add(value);
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (lengthDescriptor === undefined || !("value" in lengthDescriptor)
        || lengthDescriptor.enumerable || !Number.isSafeInteger(lengthDescriptor.value)
        || lengthDescriptor.value < 0)
        ccpStrictDenyV1(code);
    const length = lengthDescriptor.value;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string") || keys.length !== length + 1)
        ccpStrictDenyV1(code);
    const result = [];
    for (let index = 0; index < length; index += 1) {
        const key = String(index);
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable)
            ccpStrictDenyV1(code);
        result.push(descriptor.value);
    }
    if (keys.some((key) => key !== "length" && !/^(0|[1-9][0-9]*)$/.test(key)))
        ccpStrictDenyV1(code);
    return result;
}
export function assertCcpStringV1(value, pattern, code) {
    if (typeof value !== "string" || !pattern.test(value))
        ccpStrictDenyV1(code);
    return value;
}
export function assertCcpDigestV1(value, code) {
    return assertCcpStringV1(value, DIGEST_PATTERN, code);
}
export function assertCcpNullableDigestV1(value, code) {
    if (value === null)
        return null;
    return assertCcpDigestV1(value, code);
}
/**
 * Successor numeric boundary: closed JSON data numbers only, non-negative
 * safe integers. Rejects -0, negative values, fractions, NaN/Infinity and
 * unsafe integers before any canonicalization.
 */
export function assertCcpSafeUnsignedIntegerV1(value, code) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0
        || Object.is(value, -0))
        ccpStrictDenyV1(code);
    return value;
}
export function assertCcpSafePositiveIntegerV1(value, code) {
    const normalized = assertCcpSafeUnsignedIntegerV1(value, code);
    if (normalized < 1)
        ccpStrictDenyV1(code);
    return normalized;
}
/** Domain-bound SHA-256: lowercase hex, exactly 64 characters. */
export function ccpDigestDomainV1(domain, value) {
    return createHash("sha256").update(canonicalJson({ domain, value })).digest("hex");
}
function normalizeEventEnvelope(value) {
    const record = readCcpClosedObjectV1(value, EVENT_ENVELOPE_KEYS, new WeakSet(), "CCP_EVENT_ENVELOPE_SCHEMA_DENIED");
    if (record.schemaVersion !== CCP_EVENT_ENVELOPE_SCHEMA_V1)
        ccpStrictDenyV1("CCP_EVENT_ENVELOPE_SCHEMA_DENIED");
    return Object.freeze({
        schemaVersion: CCP_EVENT_ENVELOPE_SCHEMA_V1,
        ledgerId: assertCcpStringV1(record.ledgerId, LEDGER_ID_PATTERN, "CCP_EVENT_ENVELOPE_SCHEMA_DENIED"),
        tenantId: assertCcpStringV1(record.tenantId, TENANT_ID_PATTERN, "CCP_EVENT_ENVELOPE_SCHEMA_DENIED"),
        repositoryId: assertCcpStringV1(record.repositoryId, REPOSITORY_ID_PATTERN, "CCP_EVENT_ENVELOPE_SCHEMA_DENIED"),
        contributionId: assertCcpStringV1(record.contributionId, CONTRIBUTION_ID_PATTERN, "CCP_EVENT_ENVELOPE_SCHEMA_DENIED"),
        deliveryId: assertCcpStringV1(record.deliveryId, DELIVERY_ID_PATTERN, "CCP_EVENT_ENVELOPE_SCHEMA_DENIED"),
        headDigest: assertCcpDigestV1(record.headDigest, "CCP_EVENT_ENVELOPE_SCHEMA_DENIED"),
        payloadDigest: assertCcpDigestV1(record.payloadDigest, "CCP_EVENT_ENVELOPE_SCHEMA_DENIED"),
        ancestorDigest: assertCcpNullableDigestV1(record.ancestorDigest, "CCP_EVENT_ENVELOPE_SCHEMA_DENIED"),
        logicalAtMs: assertCcpSafeUnsignedIntegerV1(record.logicalAtMs, "CCP_EVENT_ENVELOPE_SCHEMA_DENIED"),
    });
}
/**
 * Parse and close a synthetic delivery event envelope. The returned envelope
 * is frozen and independent of its input; malformed input denies with a
 * TypeError carrying a closed denial code.
 */
export function parseCcpEventEnvelopeV1(value) {
    return normalizeEventEnvelope(value);
}
/** Canonical JSON of the closed envelope; byte order independent of input key order. */
export function canonicalCcpEventEnvelopeJsonV1(value) {
    return canonicalJson(parseCcpEventEnvelopeV1(value));
}
/** Canonical bytes: UTF-8 of the canonical JSON, no BOM, no trailing newline. */
export function canonicalCcpEventEnvelopeBytesV1(value) {
    return new TextEncoder().encode(canonicalCcpEventEnvelopeJsonV1(value));
}
/** Domain-bound content digest of the closed envelope. */
export function ccpEventEnvelopeDigestV1(value) {
    return ccpDigestDomainV1(CCP_EVENT_ENVELOPE_SCHEMA_V1, parseCcpEventEnvelopeV1(value));
}
/**
 * Deterministic fixture derivation locked by the PSAI52 proof boundary:
 * SHA-256 of canonicalJson({ domain: "cm.conveyor-fixture-derive/v1",
 * value: { seed, profileId, label, sourceOrdinal } }) over closed data only.
 */
export function deriveCcpFixtureDigestV1(derivation) {
    const record = readCcpClosedObjectV1(derivation, FIXTURE_DERIVATION_KEYS, new WeakSet(), "CCP_FIXTURE_DERIVATION_SCHEMA_DENIED");
    const seed = assertCcpStringV1(record.seed, SEED_PATTERN, "CCP_FIXTURE_DERIVATION_SCHEMA_DENIED");
    const profileId = assertCcpStringV1(record.profileId, PROFILE_ID_PATTERN, "CCP_FIXTURE_DERIVATION_SCHEMA_DENIED");
    const label = assertCcpStringV1(record.label, LABEL_PATTERN, "CCP_FIXTURE_DERIVATION_SCHEMA_DENIED");
    const sourceOrdinal = assertCcpSafePositiveIntegerV1(record.sourceOrdinal, "CCP_FIXTURE_DERIVATION_SCHEMA_DENIED");
    return ccpDigestDomainV1("cm.conveyor-fixture-derive/v1", { seed, profileId, label, sourceOrdinal });
}
function exactCcpStringArrayV1(value, expected, seen, code) {
    const values = readCcpDenseArrayV1(value, seen, code);
    if (values.length !== expected.length || values.some((item, index) => item !== expected[index]))
        ccpStrictDenyV1(code);
    return expected;
}
function normalizeCcpPsaI52IntegrationEvidenceV1(value, expectedClaimId, seen) {
    const record = readCcpClosedObjectV1(value, PSAI52_INTEGRATION_EVIDENCE_KEYS, seen, PSAI52_INTEGRATION_DENIED);
    if (record.claimId !== expectedClaimId)
        ccpStrictDenyV1(PSAI52_INTEGRATION_DENIED);
    return Object.freeze({
        claimId: expectedClaimId,
        evidenceDigest: assertCcpDigestV1(record.evidenceDigest, PSAI52_INTEGRATION_DENIED),
    });
}
function normalizeCcpPsaI52IntegrationInputV1(value) {
    const seen = new WeakSet();
    const record = readCcpClosedObjectV1(value, PSAI52_INTEGRATION_INPUT_KEYS, seen, PSAI52_INTEGRATION_DENIED);
    if (record.schemaVersion !== CCP_PSAI52_INTEGRATION_RECEIPT_INPUT_SCHEMA_V1
        || record.taskId !== CCP_PSAI52_INTEGRATION_TASK_ID_V1)
        ccpStrictDenyV1(PSAI52_INTEGRATION_DENIED);
    const preservedDecisionIds = exactCcpStringArrayV1(record.preservedDecisionIds, CCP_PSAI52_PRESERVED_DECISION_IDS_V1, seen, PSAI52_INTEGRATION_DENIED);
    const rawEvidence = readCcpDenseArrayV1(record.evidence, seen, PSAI52_INTEGRATION_DENIED);
    if (rawEvidence.length !== CCP_PSAI52_INTEGRATION_CLAIM_IDS_V1.length)
        ccpStrictDenyV1(PSAI52_INTEGRATION_DENIED);
    const evidence = rawEvidence.map((item, index) => normalizeCcpPsaI52IntegrationEvidenceV1(item, CCP_PSAI52_INTEGRATION_CLAIM_IDS_V1[index] ?? ccpStrictDenyV1(PSAI52_INTEGRATION_DENIED), seen));
    return Object.freeze({
        schemaVersion: CCP_PSAI52_INTEGRATION_RECEIPT_INPUT_SCHEMA_V1,
        taskId: CCP_PSAI52_INTEGRATION_TASK_ID_V1,
        preservedDecisionIds,
        evidence: Object.freeze(evidence),
        logicalAtMs: assertCcpSafeUnsignedIntegerV1(record.logicalAtMs, PSAI52_INTEGRATION_DENIED),
    });
}
function makeCcpPsaI52IntegrationReceiptV1(input) {
    const unsigned = Object.freeze({
        schemaVersion: CCP_PSAI52_INTEGRATION_RECEIPT_SCHEMA_V1,
        taskId: CCP_PSAI52_INTEGRATION_TASK_ID_V1,
        preservedDecisionIds: CCP_PSAI52_PRESERVED_DECISION_IDS_V1,
        evidence: input.evidence,
        logicalAtMs: input.logicalAtMs,
        evidenceComplete: true,
        decision: "EVIDENCE_BOUND_RECEIPT_ISSUED",
        claimBoundary: CCP_PSAI52_INTEGRATION_CLAIM_BOUNDARY_V1,
        verificationClaimed: false,
        executionAuthorized: false,
        mergeAuthorized: false,
        externalEffectsObserved: false,
    });
    return Object.freeze({
        ...unsigned,
        receiptDigest: ccpDigestDomainV1(CCP_PSAI52_INTEGRATION_RECEIPT_SCHEMA_V1, unsigned),
    });
}
/**
 * Issue the deterministic, evidence-binding PSAI52 integration receipt.
 * Callers must obtain and verify evidence separately; this pure function
 * neither runs those checks nor converts evidence references into authority.
 */
export function issueCcpPsaI52IntegrationReceiptV1(value) {
    return makeCcpPsaI52IntegrationReceiptV1(normalizeCcpPsaI52IntegrationInputV1(value));
}
/** Re-derive every fixed field and the digest before accepting a receipt. */
export function parseCcpPsaI52IntegrationReceiptV1(value) {
    const seen = new WeakSet();
    const record = readCcpClosedObjectV1(value, PSAI52_INTEGRATION_RECEIPT_KEYS, seen, PSAI52_INTEGRATION_DENIED);
    if (record.schemaVersion !== CCP_PSAI52_INTEGRATION_RECEIPT_SCHEMA_V1
        || record.taskId !== CCP_PSAI52_INTEGRATION_TASK_ID_V1
        || record.evidenceComplete !== true
        || record.decision !== "EVIDENCE_BOUND_RECEIPT_ISSUED"
        || record.claimBoundary !== CCP_PSAI52_INTEGRATION_CLAIM_BOUNDARY_V1
        || record.verificationClaimed !== false
        || record.executionAuthorized !== false
        || record.mergeAuthorized !== false
        || record.externalEffectsObserved !== false)
        ccpStrictDenyV1(PSAI52_INTEGRATION_DENIED);
    const input = normalizeCcpPsaI52IntegrationInputV1({
        schemaVersion: CCP_PSAI52_INTEGRATION_RECEIPT_INPUT_SCHEMA_V1,
        taskId: record.taskId,
        preservedDecisionIds: record.preservedDecisionIds,
        evidence: record.evidence,
        logicalAtMs: record.logicalAtMs,
    });
    const expected = makeCcpPsaI52IntegrationReceiptV1(input);
    const receiptDigest = assertCcpDigestV1(record.receiptDigest, PSAI52_INTEGRATION_DENIED);
    if (receiptDigest !== expected.receiptDigest)
        ccpStrictDenyV1(PSAI52_INTEGRATION_DENIED);
    return expected;
}
export function canonicalCcpPsaI52IntegrationReceiptJsonV1(value) {
    return canonicalJson(parseCcpPsaI52IntegrationReceiptV1(value));
}
export function ccpPsaI52IntegrationReceiptDigestV1(value) {
    return parseCcpPsaI52IntegrationReceiptV1(value).receiptDigest;
}
export function verifyCcpPsaI52IntegrationReceiptV1(value) {
    try {
        return parseCcpPsaI52IntegrationReceiptV1(value);
    }
    catch {
        return null;
    }
}
