import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
/**
 * CCP-M1 bounded preparation slice: a pure in-memory contribution-intake
 * ledger. It has no network, persistence, process, worker, credential,
 * untrusted-code execution, CI-slot or merge effect capability.
 *
 * The SHA-256 values below are unkeyed. They prove deterministic consistency
 * only. They do not authenticate a caller, resist rollback, establish trusted
 * time, prove Git ancestry/GitHub delivery, or grant production authority.
 * Wholly replacing submitted evidence and recomputing a different coherent
 * history is not authenticated provenance; detecting that requires separately
 * trusted external evidence outside this slice.
 * A trusted boundary must authenticate and prevalidate the context before it
 * calls bindPrevalidatedContributionIntakeTrustContextV1.
 */
export const CONTRIBUTION_INTAKE_TRUST_CONTEXT_SCHEMA_V1 = "cm.contribution-intake-trust-context/v1";
export const CONTRIBUTION_INTAKE_LEDGER_SCHEMA_V1 = "cm.contribution-intake-ledger/v1";
export const CONTRIBUTION_INTAKE_RECEIPT_SCHEMA_V1 = "cm.contribution-intake-receipt/v1";
export const CONTRIBUTION_DELIVERY_SCHEMA_V1 = "cm.contribution-delivery/v1";
export const CONTRIBUTION_SUBMITTED_IDENTITY_EVIDENCE_SCHEMA_V1 = "cm.contribution-submitted-identity-evidence/v1";
export const CONTRIBUTION_AUTHORITY_SCOPES_V1 = Object.freeze([
    "READ", "TRIAGE", "WRITE", "ADMIN",
]);
export const CONTRIBUTION_INTAKE_ENTRY_DISPOSITIONS_V1 = Object.freeze([
    "APPENDED", "SEMANTIC_DUPLICATE", "STALE", "REJECTED",
]);
export const CONTRIBUTION_INTAKE_REASON_CODES_V1 = Object.freeze([
    "NEW_CONTRIBUTION", "PR_HEAD_SUPERSESSION", "PR_HEAD_FORCE_PUSH", "UNKNOWN_ANCESTOR",
    "TRANSPORT_REDELIVERY", "DELIVERY_ID_REUSE_TAMPER", "HEAD_ALREADY_CURRENT",
    "SUPERSEDED_HEAD_REPLAY", "INVALIDATED_HEAD_REPLAY", "TRUST_CONTEXT_MISMATCH",
    "AUTHORITY_WIDENING", "AUTHORITY_CHANGE", "STALE_HEAD_TIMESTAMP",
]);
export const CONTRIBUTION_SUBMITTED_IDENTITY_BINDINGS_V1 = Object.freeze([
    "CONTEXT_MATCH", "SCOPE_MISMATCH", "AUTHORITY_WIDENING", "AUTHORITY_CHANGE",
]);
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const NAMESPACED_ID_SUFFIX = "[a-z0-9][a-z0-9._-]{2,95}";
const LEDGER_ID_PATTERN = new RegExp(`^ledger:${NAMESPACED_ID_SUFFIX}$`);
const TENANT_ID_PATTERN = new RegExp(`^tenant:${NAMESPACED_ID_SUFFIX}$`);
const REPOSITORY_ID_PATTERN = new RegExp(`^repository:${NAMESPACED_ID_SUFFIX}$`);
const CONTRIBUTION_ID_PATTERN = new RegExp(`^contribution:${NAMESPACED_ID_SUFFIX}$`);
const DELIVERY_ID_PATTERN = new RegExp(`^delivery:${NAMESPACED_ID_SUFFIX}$`);
const ACTOR_ID_PATTERN = new RegExp(`^actor:${NAMESPACED_ID_SUFFIX}$`);
const AUTHORITY_EVIDENCE_ID_PATTERN = new RegExp(`^authority-evidence:${NAMESPACED_ID_SUFFIX}$`);
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const SCOPE_RANK = Object.freeze({
    READ: 0,
    TRIAGE: 1,
    WRITE: 2,
    ADMIN: 3,
});
const CONTEXT_INPUT_KEYS = Object.freeze([
    "schemaVersion", "ledgerId", "tenantId", "repositoryId", "contributionId",
    "actorId", "authorityEvidenceId", "authorityScope",
]);
const DELIVERY_KEYS = Object.freeze([
    "schemaVersion", "ledgerId", "tenantId", "repositoryId", "contributionId",
    "deliveryId", "headDigest", "ancestorDigest", "actorId", "authorityEvidenceId",
    "authorityScope", "payloadDigest", "receivedAtMs",
]);
const SUBMITTED_IDENTITY_EVIDENCE_KEYS = Object.freeze([
    "schemaVersion", "authoritative", "ledgerId", "tenantId", "repositoryId", "contributionId",
    "actorId", "authorityEvidenceId", "authorityScope",
]);
const ENTRY_KEYS = Object.freeze([
    "sequence", "schemaVersion", "contextDigest", "submittedIdentityEvidence", "submittedIdentityEvidenceDigest",
    "submittedIdentityBinding", "disposition", "reasonCodes", "quarantined",
    "ledgerId", "tenantId", "repositoryId", "contributionId", "deliveryId", "headDigest",
    "ancestorDigest", "actorId", "authorityEvidenceId", "authorityScope", "payloadDigest",
    "receivedAtMs", "deliveryDigest", "replacedHeadDigest", "previousEntryDigest", "entryDigest",
]);
const LEDGER_KEYS = Object.freeze([
    "schemaVersion", "ledgerId", "tenantId", "repositoryId", "contributionId", "actorId",
    "authorityEvidenceId", "authorityScope", "contextDigest", "entries", "nextSequence",
    "quarantineCount", "ledgerDigest",
]);
const RECEIPT_KEYS = Object.freeze([
    "schemaVersion", "contextDigest", "submittedIdentityEvidence", "submittedIdentityEvidenceDigest",
    "submittedIdentityBinding", "ledgerId", "tenantId", "repositoryId", "contributionId",
    "deliveryId", "headDigest", "actorId", "authorityEvidenceId", "authorityScope", "sequence",
    "disposition", "reasonCodes", "quarantined", "deliveryDigest", "receiptDigest",
]);
const verifiedContexts = new WeakSet();
const verifiedLedgers = new WeakSet();
const verifiedReceipts = new WeakSet();
function deny(code) {
    throw new TypeError(code);
}
function readExactDataObject(value, expectedKeys, seen, code) {
    if (value === null || typeof value !== "object" || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype)
        deny(code);
    if (seen.has(value))
        deny(code);
    seen.add(value);
    const keys = Reflect.ownKeys(value);
    if (keys.length !== expectedKeys.length || keys.some((key) => typeof key !== "string"))
        deny(code);
    const expected = new Set(expectedKeys);
    const result = Object.create(null);
    for (const key of keys) {
        if (typeof key !== "string" || DANGEROUS_KEYS.has(key) || !expected.has(key))
            deny(code);
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable)
            deny(code);
        result[key] = descriptor.value;
    }
    if (expectedKeys.some((key) => !Object.hasOwn(result, key)))
        deny(code);
    return result;
}
function readDenseOrdinaryArray(value, seen, code) {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
        deny(code);
    if (seen.has(value))
        deny(code);
    seen.add(value);
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (lengthDescriptor === undefined || !("value" in lengthDescriptor)
        || lengthDescriptor.enumerable || !Number.isSafeInteger(lengthDescriptor.value)
        || lengthDescriptor.value < 0)
        deny(code);
    const length = lengthDescriptor.value;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string") || keys.length !== length + 1)
        deny(code);
    const result = [];
    for (let index = 0; index < length; index += 1) {
        const key = String(index);
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable)
            deny(code);
        result.push(descriptor.value);
    }
    if (keys.some((key) => key !== "length" && !/^(0|[1-9][0-9]*)$/.test(key)))
        deny(code);
    return result;
}
function assertString(value, pattern, code) {
    if (typeof value !== "string" || !pattern.test(value))
        deny(code);
    return value;
}
function assertDigest(value, code) {
    return assertString(value, DIGEST_PATTERN, code);
}
function assertNullableDigest(value, code) {
    if (value === null)
        return null;
    return assertDigest(value, code);
}
function assertSafeUnsignedInteger(value, code) {
    if (!Number.isSafeInteger(value) || value < 0)
        deny(code);
    return value;
}
function assertSafePositiveInteger(value, code) {
    const normalized = assertSafeUnsignedInteger(value, code);
    if (normalized < 1)
        deny(code);
    return normalized;
}
function assertScope(value, code) {
    if (typeof value !== "string"
        || !CONTRIBUTION_AUTHORITY_SCOPES_V1.includes(value))
        deny(code);
    return value;
}
function assertEntryDisposition(value, code) {
    if (typeof value !== "string"
        || !CONTRIBUTION_INTAKE_ENTRY_DISPOSITIONS_V1.includes(value))
        deny(code);
    return value;
}
function assertDisposition(value, code) {
    if (value === "TRANSPORT_DUPLICATE")
        return value;
    return assertEntryDisposition(value, code);
}
function assertSubmittedIdentityBinding(value, code) {
    if (typeof value !== "string"
        || !CONTRIBUTION_SUBMITTED_IDENTITY_BINDINGS_V1.includes(value))
        deny(code);
    return value;
}
function normalizeReasonCodes(value, seen, code) {
    const raw = readDenseOrdinaryArray(value, seen, code);
    if (raw.length < 1 || raw.length > CONTRIBUTION_INTAKE_REASON_CODES_V1.length)
        deny(code);
    const normalized = raw.map((item) => {
        if (typeof item !== "string"
            || !CONTRIBUTION_INTAKE_REASON_CODES_V1.includes(item))
            deny(code);
        return item;
    });
    if (new Set(normalized).size !== normalized.length)
        deny(code);
    return Object.freeze(normalized);
}
function digestDomain(domain, value) {
    return createHash("sha256").update(canonicalJson({ domain, value })).digest("hex");
}
function contextUnsigned(context) {
    return {
        schemaVersion: context.schemaVersion,
        ledgerId: context.ledgerId,
        tenantId: context.tenantId,
        repositoryId: context.repositoryId,
        contributionId: context.contributionId,
        actorId: context.actorId,
        authorityEvidenceId: context.authorityEvidenceId,
        authorityScope: context.authorityScope,
    };
}
function normalizeContextInput(value) {
    const record = readExactDataObject(value, CONTEXT_INPUT_KEYS, new WeakSet(), "CONTRIBUTION_TRUST_CONTEXT_DENIED");
    if (record.schemaVersion !== CONTRIBUTION_INTAKE_TRUST_CONTEXT_SCHEMA_V1)
        deny("CONTRIBUTION_TRUST_CONTEXT_DENIED");
    return {
        schemaVersion: CONTRIBUTION_INTAKE_TRUST_CONTEXT_SCHEMA_V1,
        ledgerId: assertString(record.ledgerId, LEDGER_ID_PATTERN, "CONTRIBUTION_TRUST_CONTEXT_DENIED"),
        tenantId: assertString(record.tenantId, TENANT_ID_PATTERN, "CONTRIBUTION_TRUST_CONTEXT_DENIED"),
        repositoryId: assertString(record.repositoryId, REPOSITORY_ID_PATTERN, "CONTRIBUTION_TRUST_CONTEXT_DENIED"),
        contributionId: assertString(record.contributionId, CONTRIBUTION_ID_PATTERN, "CONTRIBUTION_TRUST_CONTEXT_DENIED"),
        actorId: assertString(record.actorId, ACTOR_ID_PATTERN, "CONTRIBUTION_TRUST_CONTEXT_DENIED"),
        authorityEvidenceId: assertString(record.authorityEvidenceId, AUTHORITY_EVIDENCE_ID_PATTERN, "CONTRIBUTION_TRUST_CONTEXT_DENIED"),
        authorityScope: assertScope(record.authorityScope, "CONTRIBUTION_TRUST_CONTEXT_DENIED"),
    };
}
/**
 * Accept a context only after a trusted caller has authenticated and
 * prevalidated it. This function closes, clones and digest-binds the assertion;
 * it does not itself authenticate that assertion or grant authority.
 */
export function bindPrevalidatedContributionIntakeTrustContextV1(value) {
    const input = normalizeContextInput(value);
    const context = Object.freeze({
        ...input,
        contextDigest: digestDomain("cm.contribution-intake-trust-context/v1", contextUnsigned(input)),
    });
    verifiedContexts.add(context);
    return context;
}
function assertVerifiedContext(value) {
    if (value === null || typeof value !== "object" || !verifiedContexts.has(value)) {
        deny("CONTRIBUTION_TRUST_CONTEXT_NOT_PREVALIDATED");
    }
}
function normalizeDelivery(value, seen = new WeakSet()) {
    const record = readExactDataObject(value, DELIVERY_KEYS, seen, "CONTRIBUTION_DELIVERY_SCHEMA_DENIED");
    if (record.schemaVersion !== CONTRIBUTION_DELIVERY_SCHEMA_V1)
        deny("CONTRIBUTION_DELIVERY_SCHEMA_DENIED");
    return Object.freeze({
        schemaVersion: CONTRIBUTION_DELIVERY_SCHEMA_V1,
        ledgerId: assertString(record.ledgerId, LEDGER_ID_PATTERN, "CONTRIBUTION_DELIVERY_SCHEMA_DENIED"),
        tenantId: assertString(record.tenantId, TENANT_ID_PATTERN, "CONTRIBUTION_DELIVERY_SCHEMA_DENIED"),
        repositoryId: assertString(record.repositoryId, REPOSITORY_ID_PATTERN, "CONTRIBUTION_DELIVERY_SCHEMA_DENIED"),
        contributionId: assertString(record.contributionId, CONTRIBUTION_ID_PATTERN, "CONTRIBUTION_DELIVERY_SCHEMA_DENIED"),
        deliveryId: assertString(record.deliveryId, DELIVERY_ID_PATTERN, "CONTRIBUTION_DELIVERY_SCHEMA_DENIED"),
        headDigest: assertDigest(record.headDigest, "CONTRIBUTION_DELIVERY_SCHEMA_DENIED"),
        ancestorDigest: assertNullableDigest(record.ancestorDigest, "CONTRIBUTION_DELIVERY_SCHEMA_DENIED"),
        actorId: assertString(record.actorId, ACTOR_ID_PATTERN, "CONTRIBUTION_DELIVERY_SCHEMA_DENIED"),
        authorityEvidenceId: assertString(record.authorityEvidenceId, AUTHORITY_EVIDENCE_ID_PATTERN, "CONTRIBUTION_DELIVERY_SCHEMA_DENIED"),
        authorityScope: assertScope(record.authorityScope, "CONTRIBUTION_DELIVERY_SCHEMA_DENIED"),
        payloadDigest: assertDigest(record.payloadDigest, "CONTRIBUTION_DELIVERY_SCHEMA_DENIED"),
        receivedAtMs: assertSafeUnsignedInteger(record.receivedAtMs, "CONTRIBUTION_DELIVERY_SCHEMA_DENIED"),
    });
}
function deliveryDigestValue(delivery) {
    return digestDomain("cm.contribution-delivery/v1", delivery);
}
function submittedIdentityEvidenceFromDelivery(delivery) {
    return Object.freeze({
        schemaVersion: CONTRIBUTION_SUBMITTED_IDENTITY_EVIDENCE_SCHEMA_V1,
        authoritative: false,
        ledgerId: delivery.ledgerId,
        tenantId: delivery.tenantId,
        repositoryId: delivery.repositoryId,
        contributionId: delivery.contributionId,
        actorId: delivery.actorId,
        authorityEvidenceId: delivery.authorityEvidenceId,
        authorityScope: delivery.authorityScope,
    });
}
function cloneSubmittedIdentityEvidence(evidence) {
    return Object.freeze({ ...evidence });
}
function normalizeSubmittedIdentityEvidence(value, seen, code) {
    const record = readExactDataObject(value, SUBMITTED_IDENTITY_EVIDENCE_KEYS, seen, code);
    if (record.schemaVersion !== CONTRIBUTION_SUBMITTED_IDENTITY_EVIDENCE_SCHEMA_V1
        || record.authoritative !== false)
        deny(code);
    return Object.freeze({
        schemaVersion: CONTRIBUTION_SUBMITTED_IDENTITY_EVIDENCE_SCHEMA_V1,
        authoritative: false,
        ledgerId: assertString(record.ledgerId, LEDGER_ID_PATTERN, code),
        tenantId: assertString(record.tenantId, TENANT_ID_PATTERN, code),
        repositoryId: assertString(record.repositoryId, REPOSITORY_ID_PATTERN, code),
        contributionId: assertString(record.contributionId, CONTRIBUTION_ID_PATTERN, code),
        actorId: assertString(record.actorId, ACTOR_ID_PATTERN, code),
        authorityEvidenceId: assertString(record.authorityEvidenceId, AUTHORITY_EVIDENCE_ID_PATTERN, code),
        authorityScope: assertScope(record.authorityScope, code),
    });
}
function submittedIdentityEvidenceDigestValue(evidence) {
    return digestDomain("cm.contribution-submitted-identity-evidence/v1", evidence);
}
function deriveSubmittedIdentityBinding(ledger, event) {
    if (event.ledgerId !== ledger.ledgerId || event.tenantId !== ledger.tenantId
        || event.repositoryId !== ledger.repositoryId || event.contributionId !== ledger.contributionId) {
        return "SCOPE_MISMATCH";
    }
    if (SCOPE_RANK[event.authorityScope] > SCOPE_RANK[ledger.authorityScope])
        return "AUTHORITY_WIDENING";
    if (event.actorId !== ledger.actorId || event.authorityEvidenceId !== ledger.authorityEvidenceId
        || event.authorityScope !== ledger.authorityScope)
        return "AUTHORITY_CHANGE";
    return "CONTEXT_MATCH";
}
function entryIdentitiesMatchContext(context, entry) {
    return entry.ledgerId === context.ledgerId && entry.tenantId === context.tenantId
        && entry.repositoryId === context.repositoryId && entry.contributionId === context.contributionId
        && entry.actorId === context.actorId && entry.authorityEvidenceId === context.authorityEvidenceId
        && entry.authorityScope === context.authorityScope;
}
function receiptIdentitiesMatchContext(context, receipt) {
    return receipt.ledgerId === context.ledgerId && receipt.tenantId === context.tenantId
        && receipt.repositoryId === context.repositoryId && receipt.contributionId === context.contributionId
        && receipt.actorId === context.actorId && receipt.authorityEvidenceId === context.authorityEvidenceId
        && receipt.authorityScope === context.authorityScope;
}
function frozenClassification(disposition, reasonCodes, quarantined, replacedHeadDigest) {
    return Object.freeze({
        disposition,
        reasonCodes: Object.freeze([...reasonCodes]),
        quarantined,
        replacedHeadDigest,
    });
}
function currentHeadInternal(ledger) {
    for (let index = ledger.entries.length - 1; index >= 0; index -= 1) {
        const entry = ledger.entries[index];
        if (entry?.disposition === "APPENDED")
            return entry;
    }
    return null;
}
function headStatusInternal(ledger, headDigest) {
    const appended = ledger.entries.filter((entry) => entry.disposition === "APPENDED");
    if (appended.length === 0)
        return "UNKNOWN";
    if (appended.at(-1)?.headDigest === headDigest)
        return "CURRENT";
    const displacer = appended.find((entry) => entry.replacedHeadDigest === headDigest);
    if (displacer === undefined)
        return "UNKNOWN";
    return displacer.reasonCodes.includes("PR_HEAD_SUPERSESSION") ? "SUPERSEDED" : "INVALIDATED";
}
function classifyNormalized(ledger, event, submittedIdentityBinding = deriveSubmittedIdentityBinding(ledger, event), eventDigest = deliveryDigestValue(event)) {
    const exactRedelivery = ledger.entries.find((entry) => entry.deliveryId === event.deliveryId && entry.deliveryDigest === eventDigest);
    if (exactRedelivery !== undefined) {
        return frozenClassification("TRANSPORT_DUPLICATE", ["TRANSPORT_REDELIVERY"], false, null);
    }
    if (ledger.entries.some((entry) => entry.deliveryId === event.deliveryId)) {
        return frozenClassification("REJECTED", ["DELIVERY_ID_REUSE_TAMPER"], true, null);
    }
    if (submittedIdentityBinding === "SCOPE_MISMATCH") {
        return frozenClassification("REJECTED", ["TRUST_CONTEXT_MISMATCH"], true, null);
    }
    if (submittedIdentityBinding === "AUTHORITY_WIDENING") {
        return frozenClassification("REJECTED", ["AUTHORITY_WIDENING"], true, null);
    }
    if (submittedIdentityBinding === "AUTHORITY_CHANGE") {
        return frozenClassification("REJECTED", ["AUTHORITY_CHANGE"], true, null);
    }
    const current = currentHeadInternal(ledger);
    if (current === null)
        return frozenClassification("APPENDED", ["NEW_CONTRIBUTION"], false, null);
    if (event.headDigest === current.headDigest) {
        return frozenClassification("SEMANTIC_DUPLICATE", ["HEAD_ALREADY_CURRENT"], false, null);
    }
    if (ledger.entries.some((entry) => entry.disposition === "APPENDED" && entry.headDigest === event.headDigest)) {
        const reason = headStatusInternal(ledger, event.headDigest) === "INVALIDATED"
            ? "INVALIDATED_HEAD_REPLAY" : "SUPERSEDED_HEAD_REPLAY";
        return frozenClassification("STALE", [reason], true, null);
    }
    if (event.receivedAtMs < current.receivedAtMs) {
        return frozenClassification("STALE", ["STALE_HEAD_TIMESTAMP"], true, null);
    }
    if (event.ancestorDigest === current.headDigest) {
        return frozenClassification("APPENDED", ["PR_HEAD_SUPERSESSION"], false, current.headDigest);
    }
    if (event.ancestorDigest === null) {
        return frozenClassification("APPENDED", ["PR_HEAD_FORCE_PUSH", "UNKNOWN_ANCESTOR"], false, current.headDigest);
    }
    return frozenClassification("APPENDED", ["PR_HEAD_FORCE_PUSH"], false, current.headDigest);
}
function entryUnsigned(entry) {
    return {
        sequence: entry.sequence,
        schemaVersion: entry.schemaVersion,
        contextDigest: entry.contextDigest,
        submittedIdentityEvidence: entry.submittedIdentityEvidence,
        submittedIdentityEvidenceDigest: entry.submittedIdentityEvidenceDigest,
        submittedIdentityBinding: entry.submittedIdentityBinding,
        disposition: entry.disposition,
        reasonCodes: entry.reasonCodes,
        quarantined: entry.quarantined,
        ledgerId: entry.ledgerId,
        tenantId: entry.tenantId,
        repositoryId: entry.repositoryId,
        contributionId: entry.contributionId,
        deliveryId: entry.deliveryId,
        headDigest: entry.headDigest,
        ancestorDigest: entry.ancestorDigest,
        actorId: entry.actorId,
        authorityEvidenceId: entry.authorityEvidenceId,
        authorityScope: entry.authorityScope,
        payloadDigest: entry.payloadDigest,
        receivedAtMs: entry.receivedAtMs,
        deliveryDigest: entry.deliveryDigest,
        replacedHeadDigest: entry.replacedHeadDigest,
        previousEntryDigest: entry.previousEntryDigest,
    };
}
function buildEntry(ledger, event, classification, submittedIdentityBinding, submittedDeliveryDigest) {
    if (classification.disposition === "TRANSPORT_DUPLICATE")
        deny("CONTRIBUTION_TRANSPORT_DUPLICATE_NOT_APPENDED");
    const submittedIdentityEvidence = submittedIdentityEvidenceFromDelivery(event);
    const unsigned = {
        sequence: ledger.nextSequence,
        schemaVersion: CONTRIBUTION_INTAKE_LEDGER_SCHEMA_V1,
        contextDigest: ledger.contextDigest,
        submittedIdentityEvidence,
        submittedIdentityEvidenceDigest: submittedIdentityEvidenceDigestValue(submittedIdentityEvidence),
        submittedIdentityBinding,
        disposition: classification.disposition,
        reasonCodes: Object.freeze([...classification.reasonCodes]),
        quarantined: classification.quarantined,
        ledgerId: ledger.ledgerId,
        tenantId: ledger.tenantId,
        repositoryId: ledger.repositoryId,
        contributionId: ledger.contributionId,
        deliveryId: event.deliveryId,
        headDigest: event.headDigest,
        ancestorDigest: event.ancestorDigest,
        actorId: ledger.actorId,
        authorityEvidenceId: ledger.authorityEvidenceId,
        authorityScope: ledger.authorityScope,
        payloadDigest: event.payloadDigest,
        receivedAtMs: event.receivedAtMs,
        deliveryDigest: submittedDeliveryDigest,
        replacedHeadDigest: classification.replacedHeadDigest,
        previousEntryDigest: ledger.entries.at(-1)?.entryDigest ?? null,
    };
    return Object.freeze({
        ...unsigned,
        entryDigest: digestDomain("cm.contribution-intake-entry/v1", entryUnsigned(unsigned)),
    });
}
function cloneEntry(entry) {
    return Object.freeze({
        ...entry,
        submittedIdentityEvidence: cloneSubmittedIdentityEvidence(entry.submittedIdentityEvidence),
        reasonCodes: Object.freeze([...entry.reasonCodes]),
    });
}
function ledgerDigestValue(ledger) {
    return digestDomain("cm.contribution-intake-ledger/v1", {
        schemaVersion: ledger.schemaVersion,
        ledgerId: ledger.ledgerId,
        tenantId: ledger.tenantId,
        repositoryId: ledger.repositoryId,
        contributionId: ledger.contributionId,
        actorId: ledger.actorId,
        authorityEvidenceId: ledger.authorityEvidenceId,
        authorityScope: ledger.authorityScope,
        contextDigest: ledger.contextDigest,
        entryDigests: ledger.entries.map((entry) => entry.entryDigest),
        nextSequence: ledger.nextSequence,
        quarantineCount: ledger.quarantineCount,
    });
}
function freezeVerifiedLedger(unsigned) {
    const ledger = Object.freeze({
        ...unsigned,
        entries: Object.freeze(unsigned.entries.map(cloneEntry)),
        ledgerDigest: ledgerDigestValue(unsigned),
    });
    verifiedLedgers.add(ledger);
    return ledger;
}
function assertVerifiedLedger(context, ledger) {
    assertVerifiedContext(context);
    if (ledger === null || typeof ledger !== "object" || !verifiedLedgers.has(ledger)
        || ledger.contextDigest !== context.contextDigest || ledger.ledgerId !== context.ledgerId
        || ledger.tenantId !== context.tenantId || ledger.repositoryId !== context.repositoryId
        || ledger.contributionId !== context.contributionId || ledger.actorId !== context.actorId
        || ledger.authorityEvidenceId !== context.authorityEvidenceId
        || ledger.authorityScope !== context.authorityScope)
        deny("CONTRIBUTION_INTAKE_LEDGER_NOT_VERIFIED");
}
export function createContributionIntakeLedgerV1(context) {
    assertVerifiedContext(context);
    const unsigned = {
        schemaVersion: CONTRIBUTION_INTAKE_LEDGER_SCHEMA_V1,
        ledgerId: context.ledgerId,
        tenantId: context.tenantId,
        repositoryId: context.repositoryId,
        contributionId: context.contributionId,
        actorId: context.actorId,
        authorityEvidenceId: context.authorityEvidenceId,
        authorityScope: context.authorityScope,
        contextDigest: context.contextDigest,
        entries: Object.freeze([]),
        nextSequence: 1,
        quarantineCount: 0,
    };
    return freezeVerifiedLedger(unsigned);
}
function submittedEventFromEntry(entry) {
    const evidence = entry.submittedIdentityEvidence;
    return Object.freeze({
        schemaVersion: CONTRIBUTION_DELIVERY_SCHEMA_V1,
        ledgerId: evidence.ledgerId,
        tenantId: evidence.tenantId,
        repositoryId: evidence.repositoryId,
        contributionId: evidence.contributionId,
        deliveryId: entry.deliveryId,
        headDigest: entry.headDigest,
        ancestorDigest: entry.ancestorDigest,
        actorId: evidence.actorId,
        authorityEvidenceId: evidence.authorityEvidenceId,
        authorityScope: evidence.authorityScope,
        payloadDigest: entry.payloadDigest,
        receivedAtMs: entry.receivedAtMs,
    });
}
function normalizeEntry(value, seen) {
    const record = readExactDataObject(value, ENTRY_KEYS, seen, "CONTRIBUTION_INTAKE_ENTRY_DENIED");
    if (record.schemaVersion !== CONTRIBUTION_INTAKE_LEDGER_SCHEMA_V1
        || typeof record.quarantined !== "boolean")
        deny("CONTRIBUTION_INTAKE_ENTRY_DENIED");
    const submittedIdentityEvidence = normalizeSubmittedIdentityEvidence(record.submittedIdentityEvidence, seen, "CONTRIBUTION_INTAKE_ENTRY_DENIED");
    return {
        sequence: assertSafePositiveInteger(record.sequence, "CONTRIBUTION_INTAKE_ENTRY_DENIED"),
        schemaVersion: CONTRIBUTION_INTAKE_LEDGER_SCHEMA_V1,
        contextDigest: assertDigest(record.contextDigest, "CONTRIBUTION_INTAKE_ENTRY_DENIED"),
        submittedIdentityEvidence,
        submittedIdentityEvidenceDigest: assertDigest(record.submittedIdentityEvidenceDigest, "CONTRIBUTION_INTAKE_ENTRY_DENIED"),
        submittedIdentityBinding: assertSubmittedIdentityBinding(record.submittedIdentityBinding, "CONTRIBUTION_INTAKE_ENTRY_DENIED"),
        disposition: assertEntryDisposition(record.disposition, "CONTRIBUTION_INTAKE_ENTRY_DENIED"),
        reasonCodes: normalizeReasonCodes(record.reasonCodes, seen, "CONTRIBUTION_INTAKE_ENTRY_DENIED"),
        quarantined: record.quarantined,
        ledgerId: assertString(record.ledgerId, LEDGER_ID_PATTERN, "CONTRIBUTION_INTAKE_ENTRY_DENIED"),
        tenantId: assertString(record.tenantId, TENANT_ID_PATTERN, "CONTRIBUTION_INTAKE_ENTRY_DENIED"),
        repositoryId: assertString(record.repositoryId, REPOSITORY_ID_PATTERN, "CONTRIBUTION_INTAKE_ENTRY_DENIED"),
        contributionId: assertString(record.contributionId, CONTRIBUTION_ID_PATTERN, "CONTRIBUTION_INTAKE_ENTRY_DENIED"),
        deliveryId: assertString(record.deliveryId, DELIVERY_ID_PATTERN, "CONTRIBUTION_INTAKE_ENTRY_DENIED"),
        headDigest: assertDigest(record.headDigest, "CONTRIBUTION_INTAKE_ENTRY_DENIED"),
        ancestorDigest: assertNullableDigest(record.ancestorDigest, "CONTRIBUTION_INTAKE_ENTRY_DENIED"),
        actorId: assertString(record.actorId, ACTOR_ID_PATTERN, "CONTRIBUTION_INTAKE_ENTRY_DENIED"),
        authorityEvidenceId: assertString(record.authorityEvidenceId, AUTHORITY_EVIDENCE_ID_PATTERN, "CONTRIBUTION_INTAKE_ENTRY_DENIED"),
        authorityScope: assertScope(record.authorityScope, "CONTRIBUTION_INTAKE_ENTRY_DENIED"),
        payloadDigest: assertDigest(record.payloadDigest, "CONTRIBUTION_INTAKE_ENTRY_DENIED"),
        receivedAtMs: assertSafeUnsignedInteger(record.receivedAtMs, "CONTRIBUTION_INTAKE_ENTRY_DENIED"),
        deliveryDigest: assertDigest(record.deliveryDigest, "CONTRIBUTION_INTAKE_ENTRY_DENIED"),
        replacedHeadDigest: assertNullableDigest(record.replacedHeadDigest, "CONTRIBUTION_INTAKE_ENTRY_DENIED"),
        previousEntryDigest: assertNullableDigest(record.previousEntryDigest, "CONTRIBUTION_INTAKE_ENTRY_DENIED"),
        entryDigest: assertDigest(record.entryDigest, "CONTRIBUTION_INTAKE_ENTRY_DENIED"),
    };
}
function sameClassification(entry, derived) {
    return derived.disposition !== "TRANSPORT_DUPLICATE"
        && entry.disposition === derived.disposition
        && entry.quarantined === derived.quarantined
        && entry.replacedHeadDigest === derived.replacedHeadDigest
        && entry.reasonCodes.length === derived.reasonCodes.length
        && entry.reasonCodes.every((code, index) => code === derived.reasonCodes[index]);
}
/**
 * Structurally validates, normalizes, and semantically replays every transition
 * from genesis under an explicit prevalidated context. A correctly rehashed
 * but impossible history returns null.
 */
export function verifyContributionIntakeLedgerV1(context, candidate) {
    assertVerifiedContext(context);
    try {
        const seen = new WeakSet();
        const record = readExactDataObject(candidate, LEDGER_KEYS, seen, "CONTRIBUTION_INTAKE_LEDGER_DENIED");
        if (record.schemaVersion !== CONTRIBUTION_INTAKE_LEDGER_SCHEMA_V1)
            deny("CONTRIBUTION_INTAKE_LEDGER_DENIED");
        const entriesRaw = readDenseOrdinaryArray(record.entries, seen, "CONTRIBUTION_INTAKE_LEDGER_DENIED");
        const normalizedEntries = [];
        const replay = {
            schemaVersion: CONTRIBUTION_INTAKE_LEDGER_SCHEMA_V1,
            ledgerId: assertString(record.ledgerId, LEDGER_ID_PATTERN, "CONTRIBUTION_INTAKE_LEDGER_DENIED"),
            tenantId: assertString(record.tenantId, TENANT_ID_PATTERN, "CONTRIBUTION_INTAKE_LEDGER_DENIED"),
            repositoryId: assertString(record.repositoryId, REPOSITORY_ID_PATTERN, "CONTRIBUTION_INTAKE_LEDGER_DENIED"),
            contributionId: assertString(record.contributionId, CONTRIBUTION_ID_PATTERN, "CONTRIBUTION_INTAKE_LEDGER_DENIED"),
            actorId: assertString(record.actorId, ACTOR_ID_PATTERN, "CONTRIBUTION_INTAKE_LEDGER_DENIED"),
            authorityEvidenceId: assertString(record.authorityEvidenceId, AUTHORITY_EVIDENCE_ID_PATTERN, "CONTRIBUTION_INTAKE_LEDGER_DENIED"),
            authorityScope: assertScope(record.authorityScope, "CONTRIBUTION_INTAKE_LEDGER_DENIED"),
            contextDigest: assertDigest(record.contextDigest, "CONTRIBUTION_INTAKE_LEDGER_DENIED"),
            entries: normalizedEntries,
            nextSequence: 1,
            quarantineCount: 0,
            ledgerDigest: "0".repeat(64),
        };
        let replayNextSequence = 1;
        let replayQuarantineCount = 0;
        if (replay.ledgerId !== context.ledgerId || replay.tenantId !== context.tenantId
            || replay.repositoryId !== context.repositoryId || replay.contributionId !== context.contributionId
            || replay.actorId !== context.actorId || replay.authorityEvidenceId !== context.authorityEvidenceId
            || replay.authorityScope !== context.authorityScope || replay.contextDigest !== context.contextDigest) {
            deny("CONTRIBUTION_INTAKE_LEDGER_DENIED");
        }
        let previousEntryDigest = null;
        for (let index = 0; index < entriesRaw.length; index += 1) {
            const entry = normalizeEntry(entriesRaw[index], seen);
            const event = submittedEventFromEntry(entry);
            const derivedSubmittedIdentityEvidenceDigest = submittedIdentityEvidenceDigestValue(entry.submittedIdentityEvidence);
            const derivedSubmittedIdentityBinding = deriveSubmittedIdentityBinding(replay, event);
            const derivedDeliveryDigest = deliveryDigestValue(event);
            const derived = classifyNormalized(replay, event, derivedSubmittedIdentityBinding, derivedDeliveryDigest);
            if (entry.sequence !== index + 1 || entry.contextDigest !== context.contextDigest
                || !entryIdentitiesMatchContext(context, entry)
                || entry.submittedIdentityEvidenceDigest !== derivedSubmittedIdentityEvidenceDigest
                || entry.submittedIdentityBinding !== derivedSubmittedIdentityBinding
                || entry.deliveryDigest !== derivedDeliveryDigest
                || entry.previousEntryDigest !== previousEntryDigest
                || entry.quarantined !== (entry.disposition === "STALE" || entry.disposition === "REJECTED")
                || !sameClassification(entry, derived)
                || entry.entryDigest !== digestDomain("cm.contribution-intake-entry/v1", entryUnsigned(entry))) {
                deny("CONTRIBUTION_INTAKE_LEDGER_SEMANTIC_REPLAY_DENIED");
            }
            const frozen = cloneEntry(entry);
            normalizedEntries.push(frozen);
            replayNextSequence += 1;
            if (frozen.quarantined)
                replayQuarantineCount += 1;
            previousEntryDigest = frozen.entryDigest;
        }
        const nextSequence = assertSafePositiveInteger(record.nextSequence, "CONTRIBUTION_INTAKE_LEDGER_DENIED");
        const quarantineCount = assertSafeUnsignedInteger(record.quarantineCount, "CONTRIBUTION_INTAKE_LEDGER_DENIED");
        const ledgerDigest = assertDigest(record.ledgerDigest, "CONTRIBUTION_INTAKE_LEDGER_DENIED");
        if (nextSequence !== replayNextSequence || quarantineCount !== replayQuarantineCount) {
            deny("CONTRIBUTION_INTAKE_LEDGER_DENIED");
        }
        const unsigned = {
            schemaVersion: replay.schemaVersion,
            ledgerId: replay.ledgerId,
            tenantId: replay.tenantId,
            repositoryId: replay.repositoryId,
            contributionId: replay.contributionId,
            actorId: replay.actorId,
            authorityEvidenceId: replay.authorityEvidenceId,
            authorityScope: replay.authorityScope,
            contextDigest: replay.contextDigest,
            entries: Object.freeze(normalizedEntries),
            nextSequence,
            quarantineCount,
        };
        if (ledgerDigest !== ledgerDigestValue(unsigned))
            deny("CONTRIBUTION_INTAKE_LEDGER_DENIED");
        return freezeVerifiedLedger(unsigned);
    }
    catch {
        return null;
    }
}
export function classifyContributionDeliveryV1(context, ledger, event) {
    assertVerifiedLedger(context, ledger);
    return classifyNormalized(ledger, normalizeDelivery(event));
}
function receiptUnsigned(receipt) {
    return {
        schemaVersion: receipt.schemaVersion,
        contextDigest: receipt.contextDigest,
        submittedIdentityEvidence: receipt.submittedIdentityEvidence,
        submittedIdentityEvidenceDigest: receipt.submittedIdentityEvidenceDigest,
        submittedIdentityBinding: receipt.submittedIdentityBinding,
        ledgerId: receipt.ledgerId,
        tenantId: receipt.tenantId,
        repositoryId: receipt.repositoryId,
        contributionId: receipt.contributionId,
        deliveryId: receipt.deliveryId,
        headDigest: receipt.headDigest,
        actorId: receipt.actorId,
        authorityEvidenceId: receipt.authorityEvidenceId,
        authorityScope: receipt.authorityScope,
        sequence: receipt.sequence,
        disposition: receipt.disposition,
        reasonCodes: receipt.reasonCodes,
        quarantined: receipt.quarantined,
        deliveryDigest: receipt.deliveryDigest,
    };
}
function buildReceipt(context, event, sequence, classification, submittedIdentityBinding, submittedDeliveryDigest) {
    const submittedIdentityEvidence = submittedIdentityEvidenceFromDelivery(event);
    const unsigned = {
        schemaVersion: CONTRIBUTION_INTAKE_RECEIPT_SCHEMA_V1,
        contextDigest: context.contextDigest,
        submittedIdentityEvidence,
        submittedIdentityEvidenceDigest: submittedIdentityEvidenceDigestValue(submittedIdentityEvidence),
        submittedIdentityBinding,
        ledgerId: context.ledgerId,
        tenantId: context.tenantId,
        repositoryId: context.repositoryId,
        contributionId: context.contributionId,
        deliveryId: event.deliveryId,
        headDigest: event.headDigest,
        actorId: context.actorId,
        authorityEvidenceId: context.authorityEvidenceId,
        authorityScope: context.authorityScope,
        sequence,
        disposition: classification.disposition,
        reasonCodes: Object.freeze([...classification.reasonCodes]),
        quarantined: classification.quarantined,
        deliveryDigest: submittedDeliveryDigest,
    };
    const receipt = Object.freeze({
        ...unsigned,
        receiptDigest: digestDomain("cm.contribution-intake-receipt/v1", receiptUnsigned(unsigned)),
    });
    verifiedReceipts.add(receipt);
    return receipt;
}
function normalizeReceipt(value) {
    const seen = new WeakSet();
    const record = readExactDataObject(value, RECEIPT_KEYS, seen, "CONTRIBUTION_INTAKE_RECEIPT_DENIED");
    if (record.schemaVersion !== CONTRIBUTION_INTAKE_RECEIPT_SCHEMA_V1
        || typeof record.quarantined !== "boolean")
        deny("CONTRIBUTION_INTAKE_RECEIPT_DENIED");
    const submittedIdentityEvidence = normalizeSubmittedIdentityEvidence(record.submittedIdentityEvidence, seen, "CONTRIBUTION_INTAKE_RECEIPT_DENIED");
    return {
        schemaVersion: CONTRIBUTION_INTAKE_RECEIPT_SCHEMA_V1,
        contextDigest: assertDigest(record.contextDigest, "CONTRIBUTION_INTAKE_RECEIPT_DENIED"),
        submittedIdentityEvidence,
        submittedIdentityEvidenceDigest: assertDigest(record.submittedIdentityEvidenceDigest, "CONTRIBUTION_INTAKE_RECEIPT_DENIED"),
        submittedIdentityBinding: assertSubmittedIdentityBinding(record.submittedIdentityBinding, "CONTRIBUTION_INTAKE_RECEIPT_DENIED"),
        ledgerId: assertString(record.ledgerId, LEDGER_ID_PATTERN, "CONTRIBUTION_INTAKE_RECEIPT_DENIED"),
        tenantId: assertString(record.tenantId, TENANT_ID_PATTERN, "CONTRIBUTION_INTAKE_RECEIPT_DENIED"),
        repositoryId: assertString(record.repositoryId, REPOSITORY_ID_PATTERN, "CONTRIBUTION_INTAKE_RECEIPT_DENIED"),
        contributionId: assertString(record.contributionId, CONTRIBUTION_ID_PATTERN, "CONTRIBUTION_INTAKE_RECEIPT_DENIED"),
        deliveryId: assertString(record.deliveryId, DELIVERY_ID_PATTERN, "CONTRIBUTION_INTAKE_RECEIPT_DENIED"),
        headDigest: assertDigest(record.headDigest, "CONTRIBUTION_INTAKE_RECEIPT_DENIED"),
        actorId: assertString(record.actorId, ACTOR_ID_PATTERN, "CONTRIBUTION_INTAKE_RECEIPT_DENIED"),
        authorityEvidenceId: assertString(record.authorityEvidenceId, AUTHORITY_EVIDENCE_ID_PATTERN, "CONTRIBUTION_INTAKE_RECEIPT_DENIED"),
        authorityScope: assertScope(record.authorityScope, "CONTRIBUTION_INTAKE_RECEIPT_DENIED"),
        sequence: assertSafePositiveInteger(record.sequence, "CONTRIBUTION_INTAKE_RECEIPT_DENIED"),
        disposition: assertDisposition(record.disposition, "CONTRIBUTION_INTAKE_RECEIPT_DENIED"),
        reasonCodes: normalizeReasonCodes(record.reasonCodes, seen, "CONTRIBUTION_INTAKE_RECEIPT_DENIED"),
        quarantined: record.quarantined,
        deliveryDigest: assertDigest(record.deliveryDigest, "CONTRIBUTION_INTAKE_RECEIPT_DENIED"),
        receiptDigest: assertDigest(record.receiptDigest, "CONTRIBUTION_INTAKE_RECEIPT_DENIED"),
    };
}
export function verifyContributionIntakeReceiptV1(context, ledger, candidate) {
    assertVerifiedLedger(context, ledger);
    try {
        const receipt = normalizeReceipt(candidate);
        if (receipt.contextDigest !== context.contextDigest || !receiptIdentitiesMatchContext(context, receipt)
            || receipt.submittedIdentityEvidenceDigest
                !== submittedIdentityEvidenceDigestValue(receipt.submittedIdentityEvidence)
            || receipt.receiptDigest !== digestDomain("cm.contribution-intake-receipt/v1", receiptUnsigned(receipt))) {
            deny("CONTRIBUTION_INTAKE_RECEIPT_DENIED");
        }
        const matched = ledger.entries[receipt.sequence - 1];
        if (matched === undefined)
            deny("CONTRIBUTION_INTAKE_RECEIPT_DENIED");
        let expected;
        if (receipt.disposition === "TRANSPORT_DUPLICATE") {
            expected = buildReceipt(context, submittedEventFromEntry(matched), matched.sequence, frozenClassification("TRANSPORT_DUPLICATE", ["TRANSPORT_REDELIVERY"], false, null), matched.submittedIdentityBinding, matched.deliveryDigest);
        }
        else {
            expected = buildReceipt(context, submittedEventFromEntry(matched), matched.sequence, {
                disposition: matched.disposition,
                reasonCodes: matched.reasonCodes,
                quarantined: matched.quarantined,
                replacedHeadDigest: matched.replacedHeadDigest,
            }, matched.submittedIdentityBinding, matched.deliveryDigest);
        }
        if (canonicalJson(receipt) !== canonicalJson(expected))
            deny("CONTRIBUTION_INTAKE_RECEIPT_DENIED");
        return expected;
    }
    catch {
        return null;
    }
}
export function ingestContributionDeliveryV1(context, ledger, candidate) {
    assertVerifiedLedger(context, ledger);
    const event = normalizeDelivery(candidate);
    const submittedIdentityBinding = deriveSubmittedIdentityBinding(ledger, event);
    const submittedDeliveryDigest = deliveryDigestValue(event);
    const classification = classifyNormalized(ledger, event, submittedIdentityBinding, submittedDeliveryDigest);
    if (classification.disposition === "TRANSPORT_DUPLICATE") {
        const prior = ledger.entries.find((entry) => entry.deliveryId === event.deliveryId
            && entry.deliveryDigest === deliveryDigestValue(event));
        if (prior === undefined)
            deny("CONTRIBUTION_INTAKE_INTERNAL_DENIED");
        return Object.freeze({
            ledger,
            receipt: buildReceipt(context, event, prior.sequence, classification, submittedIdentityBinding, submittedDeliveryDigest),
        });
    }
    const entry = buildEntry(ledger, event, classification, submittedIdentityBinding, submittedDeliveryDigest);
    const entries = Object.freeze([...ledger.entries.map(cloneEntry), entry]);
    const unsigned = {
        schemaVersion: CONTRIBUTION_INTAKE_LEDGER_SCHEMA_V1,
        ledgerId: ledger.ledgerId,
        tenantId: ledger.tenantId,
        repositoryId: ledger.repositoryId,
        contributionId: ledger.contributionId,
        actorId: ledger.actorId,
        authorityEvidenceId: ledger.authorityEvidenceId,
        authorityScope: ledger.authorityScope,
        contextDigest: ledger.contextDigest,
        entries,
        nextSequence: ledger.nextSequence + 1,
        quarantineCount: ledger.quarantineCount + (classification.quarantined ? 1 : 0),
    };
    const nextLedger = freezeVerifiedLedger(unsigned);
    return Object.freeze({
        ledger: nextLedger,
        receipt: buildReceipt(context, event, entry.sequence, classification, submittedIdentityBinding, submittedDeliveryDigest),
    });
}
export function replayContributionIntakeV1(context, candidates) {
    assertVerifiedContext(context);
    const seen = new WeakSet();
    const raw = readDenseOrdinaryArray(candidates, seen, "CONTRIBUTION_DELIVERY_STREAM_DENIED");
    const events = raw.map((event) => normalizeDelivery(event, seen));
    let ledger = createContributionIntakeLedgerV1(context);
    const receipts = [];
    for (const event of events) {
        const next = ingestContributionDeliveryV1(context, ledger, event);
        ledger = next.ledger;
        receipts.push(next.receipt);
    }
    return Object.freeze({ ledger, receipts: Object.freeze(receipts) });
}
export function currentHeadEntryV1(context, ledger) {
    assertVerifiedLedger(context, ledger);
    return currentHeadInternal(ledger);
}
export function headStatusV1(context, ledger, headDigest) {
    assertVerifiedLedger(context, ledger);
    return headStatusInternal(ledger, assertDigest(headDigest, "CONTRIBUTION_HEAD_DIGEST_DENIED"));
}
export function deepCiEligibleEntriesV1(context, ledger) {
    assertVerifiedLedger(context, ledger);
    const current = currentHeadInternal(ledger);
    return Object.freeze(current === null ? [] : [current]);
}
export function isDeepCiEligibleV1(context, ledger, headDigest) {
    assertVerifiedLedger(context, ledger);
    return currentHeadInternal(ledger)?.headDigest === assertDigest(headDigest, "CONTRIBUTION_HEAD_DIGEST_DENIED");
}
export function quarantinedEntriesV1(context, ledger) {
    assertVerifiedLedger(context, ledger);
    return Object.freeze(ledger.entries.filter((entry) => entry.quarantined));
}
