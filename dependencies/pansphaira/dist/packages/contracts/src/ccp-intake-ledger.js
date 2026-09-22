import { CCP_INTAKE_ENTRY_SCHEMA_V1, CCP_INTAKE_LEDGER_SCHEMA_V1, CCP_INTAKE_RECEIPT_SCHEMA_V1, CCP_SEMANTIC_EFFECT_SCHEMA_V1, CONTRIBUTION_ID_PATTERN, DELIVERY_ID_PATTERN, LEDGER_ID_PATTERN, REPOSITORY_ID_PATTERN, TENANT_ID_PATTERN, canonicalCcpEventEnvelopeBytesV1, canonicalCcpEventEnvelopeJsonV1, ccpDigestDomainV1, ccpEventEnvelopeDigestV1, parseCcpEventEnvelopeV1, readCcpClosedObjectV1, readCcpDenseArrayV1, assertCcpDigestV1, assertCcpSafePositiveIntegerV1, assertCcpStringV1, ccpStrictDenyV1, } from "./ccp-event-envelope.js";
import { canonicalJson } from "./canonical-json.js";
export { CCP_EVENT_ENVELOPE_SCHEMA_V1, CCP_INTAKE_ENTRY_SCHEMA_V1, CCP_INTAKE_LEDGER_SCHEMA_V1, CCP_INTAKE_RECEIPT_SCHEMA_V1, CCP_SEMANTIC_EFFECT_SCHEMA_V1, } from "./ccp-event-envelope.js";
export { parseCcpEventEnvelopeV1 } from "./ccp-event-envelope.js";
const IDENTITY_KEYS = Object.freeze(["ledgerId", "tenantId", "repositoryId", "contributionId"]);
const DELIVERY_KEY_KEYS = Object.freeze([...IDENTITY_KEYS, "deliveryId"]);
const SEMANTIC_KEY_KEYS = Object.freeze([
    "schemaVersion", "tenantId", "repositoryId", "contributionId", "headDigest", "effectKind",
]);
const EFFECT_KEYS = Object.freeze([
    "effectSequence", "schemaVersion", "semanticEffectKey", "semanticEffectId", "causalSequence", "deliveryDigest",
]);
const RECEIPT_KEYS = Object.freeze([
    "schemaVersion", "event", "canonicalEventBytes", "eventDigest", "deliveryKey", "causalSequence",
    "causalParentSequence", "semanticEffectKey", "semanticEffectId", "disposition", "reasonCode",
    "effectSequence", "receiptDigest",
]);
const ENTRY_KEYS = Object.freeze([
    "schemaVersion", "causalSequence", "previousEntryDigest", "receipt", "semanticEffectId", "entryDigest",
]);
const LEDGER_KEYS = Object.freeze([
    "schemaVersion", "ledgerId", "tenantId", "repositoryId", "contributionId", "entries", "semanticEffects",
    "nextCausalSequence", "ledgerDigest",
]);
const DISPOSITIONS = Object.freeze([
    "ADMITTED", "SEMANTIC_DUPLICATE", "TRANSPORT_DUPLICATE", "STALE", "QUARANTINED",
]);
const REASONS = Object.freeze([
    "NEW_SEMANTIC_HEAD", "HEAD_ALREADY_CURRENT", "DELIVERY_REDELIVERY", "DELIVERY_ID_REUSE",
    "IDENTITY_MISMATCH", "UNKNOWN_ANCESTOR", "STALE_ANCESTOR", "LOGICAL_TIME_REGRESSION", "HEAD_ALREADY_SEEN",
]);
const EFFECT_KINDS = Object.freeze(["HEAD_RECONCILED"]);
const POSITIVE_OR_NULL = (value, code) => value === null ? null : assertCcpSafePositiveIntegerV1(value, code);
function closeObject(value, keys, seen, code) {
    return readCcpClosedObjectV1(value, keys, seen, code);
}
function assertDisposition(value, code) {
    if (typeof value !== "string" || !DISPOSITIONS.includes(value))
        ccpStrictDenyV1(code);
    return value;
}
function assertReason(value, code) {
    if (typeof value !== "string" || !REASONS.includes(value))
        ccpStrictDenyV1(code);
    return value;
}
function receiptOutcomeIsValid(receipt) {
    const hasEffect = receipt.effectSequence !== null;
    switch (receipt.disposition) {
        case "ADMITTED":
            return receipt.reasonCode === "NEW_SEMANTIC_HEAD" && hasEffect;
        case "SEMANTIC_DUPLICATE":
            return receipt.reasonCode === "HEAD_ALREADY_CURRENT" && !hasEffect;
        case "TRANSPORT_DUPLICATE":
            return receipt.reasonCode === "DELIVERY_REDELIVERY" && !hasEffect;
        case "STALE":
            return (receipt.reasonCode === "STALE_ANCESTOR" || receipt.reasonCode === "HEAD_ALREADY_SEEN")
                && !hasEffect;
        case "QUARANTINED":
            return (receipt.reasonCode === "DELIVERY_ID_REUSE" || receipt.reasonCode === "IDENTITY_MISMATCH"
                || receipt.reasonCode === "UNKNOWN_ANCESTOR" || receipt.reasonCode === "LOGICAL_TIME_REGRESSION")
                && !hasEffect;
    }
}
function normalizeIdentity(value, seen, code) {
    const record = closeObject(value, IDENTITY_KEYS, seen, code);
    return normalizeIdentityRecord(record, code);
}
function normalizeIdentityRecord(record, code) {
    return Object.freeze({
        ledgerId: assertCcpStringV1(record.ledgerId, LEDGER_ID_PATTERN, code),
        tenantId: assertCcpStringV1(record.tenantId, TENANT_ID_PATTERN, code),
        repositoryId: assertCcpStringV1(record.repositoryId, REPOSITORY_ID_PATTERN, code),
        contributionId: assertCcpStringV1(record.contributionId, CONTRIBUTION_ID_PATTERN, code),
    });
}
function normalizeDeliveryKey(value, seen, code) {
    const record = closeObject(value, DELIVERY_KEY_KEYS, seen, code);
    return Object.freeze({
        ...normalizeIdentityRecord(record, code),
        deliveryId: assertCcpStringV1(record.deliveryId, DELIVERY_ID_PATTERN, code),
    });
}
function normalizeSemanticKey(value, seen, code) {
    const record = closeObject(value, SEMANTIC_KEY_KEYS, seen, code);
    if (record.schemaVersion !== CCP_SEMANTIC_EFFECT_SCHEMA_V1
        || typeof record.effectKind !== "string"
        || !EFFECT_KINDS.includes(record.effectKind))
        ccpStrictDenyV1(code);
    return Object.freeze({
        schemaVersion: CCP_SEMANTIC_EFFECT_SCHEMA_V1,
        tenantId: assertCcpStringV1(record.tenantId, TENANT_ID_PATTERN, code),
        repositoryId: assertCcpStringV1(record.repositoryId, REPOSITORY_ID_PATTERN, code),
        contributionId: assertCcpStringV1(record.contributionId, CONTRIBUTION_ID_PATTERN, code),
        headDigest: assertCcpDigestV1(record.headDigest, code),
        effectKind: record.effectKind,
    });
}
function semanticEffectKeyFor(event) {
    return Object.freeze({
        schemaVersion: CCP_SEMANTIC_EFFECT_SCHEMA_V1,
        tenantId: event.tenantId,
        repositoryId: event.repositoryId,
        contributionId: event.contributionId,
        headDigest: event.headDigest,
        effectKind: "HEAD_RECONCILED",
    });
}
function deliveryKeyFor(event) {
    return Object.freeze({
        ledgerId: event.ledgerId,
        tenantId: event.tenantId,
        repositoryId: event.repositoryId,
        contributionId: event.contributionId,
        deliveryId: event.deliveryId,
    });
}
export function ccpSemanticEffectKeyV1(event) {
    return semanticEffectKeyFor(parseCcpEventEnvelopeV1(event));
}
export function ccpSemanticEffectIdV1(key) {
    const normalized = normalizeSemanticKey(key, new WeakSet(), "CCP_SEMANTIC_EFFECT_KEY_DENIED");
    return ccpDigestDomainV1(CCP_SEMANTIC_EFFECT_SCHEMA_V1, normalized);
}
function receiptUnsigned(receipt) {
    return {
        schemaVersion: receipt.schemaVersion,
        event: receipt.event,
        canonicalEventBytes: receipt.canonicalEventBytes,
        eventDigest: receipt.eventDigest,
        deliveryKey: receipt.deliveryKey,
        causalSequence: receipt.causalSequence,
        causalParentSequence: receipt.causalParentSequence,
        semanticEffectKey: receipt.semanticEffectKey,
        semanticEffectId: receipt.semanticEffectId,
        disposition: receipt.disposition,
        reasonCode: receipt.reasonCode,
        effectSequence: receipt.effectSequence,
    };
}
function receiptDigestOf(receipt) {
    return ccpDigestDomainV1(CCP_INTAKE_RECEIPT_SCHEMA_V1, receiptUnsigned(receipt));
}
function makeReceipt(event, causalSequence, causalParentSequence, disposition, reasonCode, effectSequence) {
    const semanticEffectKey = semanticEffectKeyFor(event);
    const unsigned = {
        schemaVersion: CCP_INTAKE_RECEIPT_SCHEMA_V1,
        event,
        canonicalEventBytes: canonicalCcpEventEnvelopeJsonV1(event),
        eventDigest: ccpEventEnvelopeDigestV1(event),
        deliveryKey: deliveryKeyFor(event),
        causalSequence,
        causalParentSequence,
        semanticEffectKey,
        semanticEffectId: ccpSemanticEffectIdV1(semanticEffectKey),
        disposition,
        reasonCode,
        effectSequence,
    };
    return Object.freeze({ ...unsigned, receiptDigest: receiptDigestOf(unsigned) });
}
function entryDigestOf(entry) {
    return ccpDigestDomainV1(CCP_INTAKE_ENTRY_SCHEMA_V1, {
        schemaVersion: entry.schemaVersion,
        causalSequence: entry.causalSequence,
        previousEntryDigest: entry.previousEntryDigest,
        receiptDigest: entry.receipt.receiptDigest,
        semanticEffectId: entry.semanticEffectId,
    });
}
function ledgerDigestOf(ledger) {
    return ccpDigestDomainV1(CCP_INTAKE_LEDGER_SCHEMA_V1, {
        schemaVersion: ledger.schemaVersion,
        ledgerId: ledger.ledgerId,
        tenantId: ledger.tenantId,
        repositoryId: ledger.repositoryId,
        contributionId: ledger.contributionId,
        entryDigests: ledger.entries.map((entry) => entry.entryDigest),
        semanticEffectIds: ledger.semanticEffects.map((effect) => effect.semanticEffectId),
        nextCausalSequence: ledger.nextCausalSequence,
    });
}
function freezeLedger(unsigned) {
    const ledger = Object.freeze({
        ...unsigned,
        entries: Object.freeze([...unsigned.entries]),
        semanticEffects: Object.freeze([...unsigned.semanticEffects]),
        ledgerDigest: ledgerDigestOf(unsigned),
    });
    return ledger;
}
export function createCcpIntakeLedgerV1(identity) {
    const normalized = normalizeIdentity(identity, new WeakSet(), "CCP_INTAKE_LEDGER_IDENTITY_DENIED");
    return freezeLedger({
        schemaVersion: CCP_INTAKE_LEDGER_SCHEMA_V1,
        ...normalized,
        entries: [],
        semanticEffects: [],
        nextCausalSequence: 1,
    });
}
function normalizeReceipt(value, seen) {
    const record = closeObject(value, RECEIPT_KEYS, seen, "CCP_INTAKE_RECEIPT_DENIED");
    if (record.schemaVersion !== CCP_INTAKE_RECEIPT_SCHEMA_V1
        || typeof record.canonicalEventBytes !== "string")
        ccpStrictDenyV1("CCP_INTAKE_RECEIPT_DENIED");
    const event = parseCcpEventEnvelopeV1(record.event);
    const canonicalEventBytes = canonicalCcpEventEnvelopeJsonV1(event);
    if (record.canonicalEventBytes !== canonicalEventBytes
        || record.eventDigest !== ccpEventEnvelopeDigestV1(event))
        ccpStrictDenyV1("CCP_INTAKE_RECEIPT_DENIED");
    const receipt = Object.freeze({
        schemaVersion: CCP_INTAKE_RECEIPT_SCHEMA_V1,
        event,
        canonicalEventBytes,
        eventDigest: assertCcpDigestV1(record.eventDigest, "CCP_INTAKE_RECEIPT_DENIED"),
        deliveryKey: normalizeDeliveryKey(record.deliveryKey, seen, "CCP_INTAKE_RECEIPT_DENIED"),
        causalSequence: assertCcpSafePositiveIntegerV1(record.causalSequence, "CCP_INTAKE_RECEIPT_DENIED"),
        causalParentSequence: POSITIVE_OR_NULL(record.causalParentSequence, "CCP_INTAKE_RECEIPT_DENIED"),
        semanticEffectKey: normalizeSemanticKey(record.semanticEffectKey, seen, "CCP_INTAKE_RECEIPT_DENIED"),
        semanticEffectId: assertCcpDigestV1(record.semanticEffectId, "CCP_INTAKE_RECEIPT_DENIED"),
        disposition: assertDisposition(record.disposition, "CCP_INTAKE_RECEIPT_DENIED"),
        reasonCode: assertReason(record.reasonCode, "CCP_INTAKE_RECEIPT_DENIED"),
        effectSequence: POSITIVE_OR_NULL(record.effectSequence, "CCP_INTAKE_RECEIPT_DENIED"),
        receiptDigest: assertCcpDigestV1(record.receiptDigest, "CCP_INTAKE_RECEIPT_DENIED"),
    });
    if (receipt.deliveryKey.ledgerId !== event.ledgerId || receipt.deliveryKey.tenantId !== event.tenantId
        || receipt.deliveryKey.repositoryId !== event.repositoryId || receipt.deliveryKey.contributionId !== event.contributionId
        || receipt.deliveryKey.deliveryId !== event.deliveryId
        || ccpSemanticEffectIdV1(receipt.semanticEffectKey) !== receipt.semanticEffectId
        || receipt.semanticEffectKey.tenantId !== event.tenantId
        || receipt.semanticEffectKey.repositoryId !== event.repositoryId
        || receipt.semanticEffectKey.contributionId !== event.contributionId
        || receipt.semanticEffectKey.headDigest !== event.headDigest
        || (receipt.causalParentSequence !== null && receipt.causalParentSequence >= receipt.causalSequence)
        || (receipt.effectSequence !== null && receipt.effectSequence > receipt.causalSequence)
        || !receiptOutcomeIsValid(receipt)
        || receiptDigestOf(receipt) !== receipt.receiptDigest)
        ccpStrictDenyV1("CCP_INTAKE_RECEIPT_DENIED");
    return receipt;
}
function normalizeEffect(value, seen) {
    const record = closeObject(value, EFFECT_KEYS, seen, "CCP_SEMANTIC_EFFECT_DENIED");
    if (record.schemaVersion !== CCP_SEMANTIC_EFFECT_SCHEMA_V1)
        ccpStrictDenyV1("CCP_SEMANTIC_EFFECT_DENIED");
    const effect = Object.freeze({
        effectSequence: assertCcpSafePositiveIntegerV1(record.effectSequence, "CCP_SEMANTIC_EFFECT_DENIED"),
        schemaVersion: CCP_SEMANTIC_EFFECT_SCHEMA_V1,
        semanticEffectKey: normalizeSemanticKey(record.semanticEffectKey, seen, "CCP_SEMANTIC_EFFECT_DENIED"),
        semanticEffectId: assertCcpDigestV1(record.semanticEffectId, "CCP_SEMANTIC_EFFECT_DENIED"),
        causalSequence: assertCcpSafePositiveIntegerV1(record.causalSequence, "CCP_SEMANTIC_EFFECT_DENIED"),
        deliveryDigest: assertCcpDigestV1(record.deliveryDigest, "CCP_SEMANTIC_EFFECT_DENIED"),
    });
    if (effect.semanticEffectId !== ccpSemanticEffectIdV1(effect.semanticEffectKey)
        || effect.effectSequence > effect.causalSequence)
        ccpStrictDenyV1("CCP_SEMANTIC_EFFECT_DENIED");
    return effect;
}
function normalizeEntry(value, seen) {
    const record = closeObject(value, ENTRY_KEYS, seen, "CCP_INTAKE_ENTRY_DENIED");
    if (record.schemaVersion !== CCP_INTAKE_ENTRY_SCHEMA_V1)
        ccpStrictDenyV1("CCP_INTAKE_ENTRY_DENIED");
    const receipt = normalizeReceipt(record.receipt, seen);
    const entry = Object.freeze({
        schemaVersion: CCP_INTAKE_ENTRY_SCHEMA_V1,
        causalSequence: assertCcpSafePositiveIntegerV1(record.causalSequence, "CCP_INTAKE_ENTRY_DENIED"),
        previousEntryDigest: record.previousEntryDigest === null
            ? null : assertCcpDigestV1(record.previousEntryDigest, "CCP_INTAKE_ENTRY_DENIED"),
        receipt,
        semanticEffectId: record.semanticEffectId === null
            ? null : assertCcpDigestV1(record.semanticEffectId, "CCP_INTAKE_ENTRY_DENIED"),
        entryDigest: assertCcpDigestV1(record.entryDigest, "CCP_INTAKE_ENTRY_DENIED"),
    });
    const admitted = receipt.disposition === "ADMITTED";
    if (entry.causalSequence !== receipt.causalSequence || entryDigestOf(entry) !== entry.entryDigest
        || entry.semanticEffectId !== (admitted ? receipt.semanticEffectId : null)
        || (entry.semanticEffectId !== null) !== (receipt.effectSequence !== null)) {
        ccpStrictDenyV1("CCP_INTAKE_ENTRY_DENIED");
    }
    return entry;
}
/** Parse, close and semantically verify a ledger candidate without mutating it. */
export function parseCcpIntakeLedgerV1(value) {
    const seen = new WeakSet();
    const record = closeObject(value, LEDGER_KEYS, seen, "CCP_INTAKE_LEDGER_DENIED");
    if (record.schemaVersion !== CCP_INTAKE_LEDGER_SCHEMA_V1)
        ccpStrictDenyV1("CCP_INTAKE_LEDGER_DENIED");
    const identity = normalizeIdentityRecord(record, "CCP_INTAKE_LEDGER_DENIED");
    const entriesRaw = readCcpDenseArrayV1(record.entries, seen, "CCP_INTAKE_LEDGER_DENIED");
    const effectsRaw = readCcpDenseArrayV1(record.semanticEffects, seen, "CCP_INTAKE_LEDGER_DENIED");
    const entries = entriesRaw.map((entry) => normalizeEntry(entry, seen));
    const semanticEffects = effectsRaw.map((effect) => normalizeEffect(effect, seen));
    const nextCausalSequence = assertCcpSafePositiveIntegerV1(record.nextCausalSequence, "CCP_INTAKE_LEDGER_DENIED");
    const ledgerDigest = assertCcpDigestV1(record.ledgerDigest, "CCP_INTAKE_LEDGER_DENIED");
    // Reconstruct every transition from genesis instead of trusting a coherent
    // rehash. This binds disposition, reasons, sequence, parent, effect and all
    // digest chains to the event stream under the ledger identity.
    let replay = createCcpIntakeLedgerV1(identity);
    for (let index = 0; index < entries.length; index += 1) {
        const candidate = entries[index];
        const appended = appendParsedCcpIntakeDeliveryV1(replay, candidate.receipt.event);
        const expected = appended.ledger.entries[index];
        if (!appended.appended || expected === undefined
            || canonicalJson(candidate) !== canonicalJson(expected))
            ccpStrictDenyV1("CCP_INTAKE_LEDGER_DENIED");
        replay = appended.ledger;
    }
    if (nextCausalSequence !== replay.nextCausalSequence
        || canonicalJson(semanticEffects) !== canonicalJson(replay.semanticEffects)
        || ledgerDigest !== replay.ledgerDigest) {
        ccpStrictDenyV1("CCP_INTAKE_LEDGER_DENIED");
    }
    return replay;
}
function deliveryKeyEquals(left, right) {
    return left.ledgerId === right.ledgerId && left.tenantId === right.tenantId
        && left.repositoryId === right.repositoryId && left.contributionId === right.contributionId
        && left.deliveryId === right.deliveryId;
}
function identityMatches(identity, event) {
    return identity.ledgerId === event.ledgerId && identity.tenantId === event.tenantId
        && identity.repositoryId === event.repositoryId && identity.contributionId === event.contributionId;
}
function currentEffect(ledger) {
    return ledger.semanticEffects.at(-1) ?? null;
}
function makeEntry(ledger, receipt, semanticEffectId) {
    const unsigned = {
        schemaVersion: CCP_INTAKE_ENTRY_SCHEMA_V1,
        causalSequence: receipt.causalSequence,
        previousEntryDigest: ledger.entries.at(-1)?.entryDigest ?? null,
        receipt,
        semanticEffectId,
    };
    return Object.freeze({ ...unsigned, entryDigest: entryDigestOf(unsigned) });
}
function appendParsedCcpIntakeDeliveryV1(ledger, event) {
    const eventDigest = ccpEventEnvelopeDigestV1(event);
    const key = deliveryKeyFor(event);
    const prior = ledger.entries.find((entry) => deliveryKeyEquals(entry.receipt.deliveryKey, key));
    if (prior !== undefined) {
        if (prior.receipt.eventDigest === eventDigest) {
            const receipt = makeReceipt(event, prior.receipt.causalSequence, prior.receipt.causalParentSequence, "TRANSPORT_DUPLICATE", "DELIVERY_REDELIVERY", null);
            return Object.freeze({ ledger, receipt, appended: false, effectApplied: false });
        }
        const receipt = makeReceipt(event, ledger.nextCausalSequence, null, "QUARANTINED", "DELIVERY_ID_REUSE", null);
        const entry = makeEntry(ledger, receipt, null);
        const next = freezeLedger({
            ...ledger,
            entries: [...ledger.entries, entry],
            semanticEffects: [...ledger.semanticEffects],
            nextCausalSequence: ledger.nextCausalSequence + 1,
        });
        return Object.freeze({ ledger: next, receipt, appended: true, effectApplied: false });
    }
    const current = currentEffect(ledger);
    const knownHead = ledger.semanticEffects.find((effect) => effect.semanticEffectKey.headDigest === event.headDigest);
    let disposition = "ADMITTED";
    let reasonCode = "NEW_SEMANTIC_HEAD";
    let causalParentSequence = null;
    let effectSequence = null;
    if (!identityMatches(ledger, event)) {
        disposition = "QUARANTINED";
        reasonCode = "IDENTITY_MISMATCH";
    }
    else if (ledger.entries.length > 0 && event.logicalAtMs < ledger.entries.at(-1).receipt.event.logicalAtMs) {
        disposition = "QUARANTINED";
        reasonCode = "LOGICAL_TIME_REGRESSION";
    }
    else if (knownHead !== undefined) {
        disposition = current?.semanticEffectId === knownHead.semanticEffectId ? "SEMANTIC_DUPLICATE" : "STALE";
        reasonCode = disposition === "SEMANTIC_DUPLICATE" ? "HEAD_ALREADY_CURRENT" : "HEAD_ALREADY_SEEN";
    }
    else if (event.ancestorDigest !== null) {
        const ancestor = ledger.semanticEffects.find((effect) => effect.semanticEffectKey.headDigest === event.ancestorDigest);
        if (ancestor === undefined) {
            disposition = "QUARANTINED";
            reasonCode = "UNKNOWN_ANCESTOR";
        }
        else if (current !== null && ancestor.semanticEffectId !== current.semanticEffectId) {
            disposition = "STALE";
            reasonCode = "STALE_ANCESTOR";
        }
        else {
            causalParentSequence = ancestor.causalSequence;
        }
    }
    else if (current !== null) {
        disposition = "QUARANTINED";
        reasonCode = "DISCONNECTED_REPLACEMENT";
    }
    if (disposition === "ADMITTED") {
        effectSequence = ledger.semanticEffects.length + 1;
        causalParentSequence = causalParentSequence ?? null;
    }
    const receipt = makeReceipt(event, ledger.nextCausalSequence, causalParentSequence, disposition, reasonCode, effectSequence);
    const effect = disposition === "ADMITTED"
        ? Object.freeze({
            effectSequence: effectSequence,
            schemaVersion: CCP_SEMANTIC_EFFECT_SCHEMA_V1,
            semanticEffectKey: Object.freeze({ ...receipt.semanticEffectKey }),
            semanticEffectId: receipt.semanticEffectId,
            causalSequence: receipt.causalSequence,
            deliveryDigest: receipt.eventDigest,
        })
        : null;
    const entry = makeEntry(ledger, receipt, effect?.semanticEffectId ?? null);
    const next = freezeLedger({
        ...ledger,
        entries: [...ledger.entries, entry],
        semanticEffects: effect === null ? [...ledger.semanticEffects] : [...ledger.semanticEffects, effect],
        nextCausalSequence: ledger.nextCausalSequence + 1,
    });
    return Object.freeze({ ledger: next, receipt, appended: true, effectApplied: effect !== null });
}
/**
 * Append one closed delivery. Exact transport redelivery returns a fresh
 * deterministic TRANSPORT_DUPLICATE receipt while preserving the original
 * receipt and ledger bytes. Every first-seen delivery receives one immutable
 * entry, including semantic duplicates and quarantined candidates.
 */
export function appendCcpIntakeDeliveryV1(candidateLedger, candidateEvent) {
    const ledger = parseCcpIntakeLedgerV1(candidateLedger);
    const event = parseCcpEventEnvelopeV1(candidateEvent);
    return appendParsedCcpIntakeDeliveryV1(ledger, event);
}
export const appendCcpIntakeLedgerV1 = appendCcpIntakeDeliveryV1;
export const appendCcpEventV1 = appendCcpIntakeDeliveryV1;
/** Parse, cross-bind and freeze an immutable delivery receipt. */
export function parseCcpDeliveryReceiptV1(value) {
    return normalizeReceipt(value, new WeakSet());
}
export function canonicalCcpDeliveryReceiptJsonV1(value) {
    return canonicalJson(parseCcpDeliveryReceiptV1(value));
}
export function canonicalCcpIntakeLedgerJsonV1(value) {
    return canonicalJson(parseCcpIntakeLedgerV1(value));
}
export function readCcpIntakeProjectionV1(candidateLedger) {
    const ledger = parseCcpIntakeLedgerV1(candidateLedger);
    const current = currentEffect(ledger);
    const projection = Object.freeze({
        schemaVersion: CCP_INTAKE_LEDGER_SCHEMA_V1,
        ledgerId: ledger.ledgerId,
        tenantId: ledger.tenantId,
        repositoryId: ledger.repositoryId,
        contributionId: ledger.contributionId,
        currentHeadDigest: current?.semanticEffectKey.headDigest ?? null,
        currentSemanticEffectId: current?.semanticEffectId ?? null,
        admittedCount: ledger.entries.filter((entry) => entry.receipt.disposition === "ADMITTED").length,
        duplicateCount: ledger.entries.filter((entry) => entry.receipt.disposition === "SEMANTIC_DUPLICATE"
            || entry.receipt.disposition === "TRANSPORT_DUPLICATE").length,
        quarantinedCount: ledger.entries.filter((entry) => entry.receipt.disposition === "QUARANTINED").length,
        staleCount: ledger.entries.filter((entry) => entry.receipt.disposition === "STALE").length,
        causalSequence: ledger.entries.at(-1)?.causalSequence ?? 0,
        semanticEffectIds: Object.freeze(ledger.semanticEffects.map((effect) => effect.semanticEffectId)),
        quarantinedDeliveryIds: Object.freeze(ledger.entries
            .filter((entry) => entry.receipt.disposition === "QUARANTINED")
            .map((entry) => entry.receipt.deliveryKey.deliveryId)),
        ledgerDigest: ledger.ledgerDigest,
    });
    return projection;
}
export const readCcpIntakeLedgerProjectionV1 = readCcpIntakeProjectionV1;
export function verifyCcpIntakeLedgerV1(value) {
    try {
        return parseCcpIntakeLedgerV1(value);
    }
    catch {
        return null;
    }
}
export function canonicalCcpEventBytesV1(value) {
    return canonicalCcpEventEnvelopeBytesV1(parseCcpEventEnvelopeV1(value));
}
