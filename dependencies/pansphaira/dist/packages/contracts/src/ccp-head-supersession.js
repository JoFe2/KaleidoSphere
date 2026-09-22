import { canonicalJson } from "./canonical-json.js";
import { assertCcpDigestV1, assertCcpNullableDigestV1, assertCcpSafePositiveIntegerV1, assertCcpSafeUnsignedIntegerV1, assertCcpStringV1, ccpDigestDomainV1, ccpStrictDenyV1, CONTRIBUTION_ID_PATTERN, LEDGER_ID_PATTERN, readCcpClosedObjectV1, readCcpDenseArrayV1, REPOSITORY_ID_PATTERN, TENANT_ID_PATTERN, } from "./ccp-event-envelope.js";
import { parseCcpIntakeLedgerV1, } from "./ccp-intake-ledger.js";
/**
 * CCP PSAI52 bounded intake boundary (M1 ledger, supersession side): a pure,
 * deterministic projection of a verified synthetic intake ledger into
 * PR-head supersession and force-push invalidation labels. Every head digest
 * referenced by a first-seen ledger entry is labeled exactly one of
 * CURRENT, SUPERSEDED or INVALIDATED, in first-seen order.
 *
 * CURRENT is the admitted head of the current semantic effect only.
 * SUPERSEDED covers admitted heads that a later admission displaced.
 * INVALIDATED covers heads that were never admitted: stale force-push
 * candidates (STALE_ANCESTOR), re-deliveries of previously seen heads
 * (HEAD_ALREADY_SEEN) and quarantined candidates.
 *
 * The projection is a read-only labeler: it never allocates a queue slot,
 * schedules a runner, executes code or authorizes a merge. `deepCiClaimEligible`
 * is a bounded eligibility label that is true for CURRENT heads only; every
 * superseded and invalidated head is terminally ineligible before any
 * deep-CI claim. It has no network, persistence, clock or randomness
 * capability. Its digest is domain-bound, so any rehashed drift in the
 * labels denies on read-back.
 */
export const CCP_HEAD_SUPERSESSION_PROJECTION_SCHEMA_V1 = "cm.ccp-head-supersession/v1";
export const CCP_HEAD_STATES_V1 = Object.freeze(["CURRENT", "SUPERSEDED", "INVALIDATED"]);
const SUPERSESSION_PROJECTION_SCHEMA_DENIED = "CCP_HEAD_SUPERSESSION_PROJECTION_SCHEMA_DENIED";
const SUPERSESSION_LABEL_KEYS = Object.freeze([
    "headDigest", "semanticEffectId", "effectSequence", "state", "deepCiClaimEligible",
]);
const SUPERSESSION_PROJECTION_KEYS = Object.freeze([
    "schemaVersion", "ledgerId", "tenantId", "repositoryId", "contributionId", "ledgerDigest",
    "currentHeadDigest", "currentSemanticEffectId", "heads",
    "currentCount", "supersededCount", "invalidatedCount", "supersessionDigest",
]);
function currentEffectOf(ledger) {
    return ledger.semanticEffects.at(-1) ?? null;
}
function makeHeadSupersessionProjectionV1(ledger) {
    const seenOrder = [];
    for (const entry of ledger.entries) {
        const headDigest = entry.receipt.event.headDigest;
        if (!seenOrder.includes(headDigest))
            seenOrder.push(headDigest);
    }
    const current = currentEffectOf(ledger);
    const heads = seenOrder.map((headDigest) => {
        const effect = ledger.semanticEffects.find((candidate) => candidate.semanticEffectKey.headDigest === headDigest) ?? null;
        const isCurrent = effect !== null && current !== null
            && effect.semanticEffectId === current.semanticEffectId;
        const state = effect === null ? "INVALIDATED" : (isCurrent ? "CURRENT" : "SUPERSEDED");
        return Object.freeze({
            headDigest,
            semanticEffectId: effect === null ? null : effect.semanticEffectId,
            effectSequence: effect === null ? null : effect.effectSequence,
            state,
            deepCiClaimEligible: state === "CURRENT",
        });
    });
    const unsigned = Object.freeze({
        schemaVersion: CCP_HEAD_SUPERSESSION_PROJECTION_SCHEMA_V1,
        ledgerId: ledger.ledgerId,
        tenantId: ledger.tenantId,
        repositoryId: ledger.repositoryId,
        contributionId: ledger.contributionId,
        ledgerDigest: ledger.ledgerDigest,
        currentHeadDigest: current === null ? null : current.semanticEffectKey.headDigest,
        currentSemanticEffectId: current === null ? null : current.semanticEffectId,
        heads: Object.freeze([...heads]),
        currentCount: heads.filter((label) => label.state === "CURRENT").length,
        supersededCount: heads.filter((label) => label.state === "SUPERSEDED").length,
        invalidatedCount: heads.filter((label) => label.state === "INVALIDATED").length,
    });
    return Object.freeze({
        ...unsigned,
        supersessionDigest: ccpDigestDomainV1(CCP_HEAD_SUPERSESSION_PROJECTION_SCHEMA_V1, unsigned),
    });
}
/**
 * Project a canonical intake ledger into PR-head supersession and force-push
 * invalidation labels. The ledger is re-parsed and replay-verified first;
 * malformed ledgers deny before any projection exists. Labeling never
 * allocates a queue slot, schedules a runner or authorizes a merge.
 */
export function projectCcpHeadSupersessionV1(candidateLedger) {
    return makeHeadSupersessionProjectionV1(parseCcpIntakeLedgerV1(candidateLedger));
}
function normalizeSupersessionLabel(value, seen, digests, effectSequences) {
    const record = readCcpClosedObjectV1(value, SUPERSESSION_LABEL_KEYS, seen, SUPERSESSION_PROJECTION_SCHEMA_DENIED);
    const headDigest = assertCcpDigestV1(record.headDigest, SUPERSESSION_PROJECTION_SCHEMA_DENIED);
    if (digests.has(headDigest))
        ccpStrictDenyV1(SUPERSESSION_PROJECTION_SCHEMA_DENIED);
    digests.add(headDigest);
    if (typeof record.state !== "string"
        || !CCP_HEAD_STATES_V1.includes(record.state)) {
        ccpStrictDenyV1(SUPERSESSION_PROJECTION_SCHEMA_DENIED);
    }
    const state = record.state;
    if (typeof record.deepCiClaimEligible !== "boolean"
        || record.deepCiClaimEligible !== (state === "CURRENT")) {
        ccpStrictDenyV1(SUPERSESSION_PROJECTION_SCHEMA_DENIED);
    }
    const semanticEffectId = record.semanticEffectId === null
        ? null
        : assertCcpDigestV1(record.semanticEffectId, SUPERSESSION_PROJECTION_SCHEMA_DENIED);
    const effectSequence = record.effectSequence === null
        ? null
        : assertCcpSafePositiveIntegerV1(record.effectSequence, SUPERSESSION_PROJECTION_SCHEMA_DENIED);
    if ((semanticEffectId === null) !== (effectSequence === null)) {
        ccpStrictDenyV1(SUPERSESSION_PROJECTION_SCHEMA_DENIED);
    }
    // Admitted heads are exactly the CURRENT and SUPERSEDED labels.
    if (state === "INVALIDATED" && semanticEffectId !== null) {
        ccpStrictDenyV1(SUPERSESSION_PROJECTION_SCHEMA_DENIED);
    }
    if (state !== "INVALIDATED" && semanticEffectId === null) {
        ccpStrictDenyV1(SUPERSESSION_PROJECTION_SCHEMA_DENIED);
    }
    if (effectSequence !== null) {
        if (effectSequences.has(effectSequence))
            ccpStrictDenyV1(SUPERSESSION_PROJECTION_SCHEMA_DENIED);
        effectSequences.add(effectSequence);
    }
    return Object.freeze({
        headDigest,
        semanticEffectId,
        effectSequence,
        state,
        deepCiClaimEligible: state === "CURRENT",
    });
}
/**
 * Parse and close a head supersession projection. States, eligibility
 * labels, effect bindings and the state counts are cross-validated; any
 * drift denies with a TypeError carrying the closed denial code. The
 * returned projection is the expected frozen projection.
 */
export function parseCcpHeadSupersessionProjectionV1(value) {
    const seen = new WeakSet();
    const record = readCcpClosedObjectV1(value, SUPERSESSION_PROJECTION_KEYS, seen, SUPERSESSION_PROJECTION_SCHEMA_DENIED);
    if (record.schemaVersion !== CCP_HEAD_SUPERSESSION_PROJECTION_SCHEMA_V1) {
        ccpStrictDenyV1(SUPERSESSION_PROJECTION_SCHEMA_DENIED);
    }
    const identity = Object.freeze({
        ledgerId: assertCcpStringV1(record.ledgerId, LEDGER_ID_PATTERN, SUPERSESSION_PROJECTION_SCHEMA_DENIED),
        tenantId: assertCcpStringV1(record.tenantId, TENANT_ID_PATTERN, SUPERSESSION_PROJECTION_SCHEMA_DENIED),
        repositoryId: assertCcpStringV1(record.repositoryId, REPOSITORY_ID_PATTERN, SUPERSESSION_PROJECTION_SCHEMA_DENIED),
        contributionId: assertCcpStringV1(record.contributionId, CONTRIBUTION_ID_PATTERN, SUPERSESSION_PROJECTION_SCHEMA_DENIED),
    });
    const ledgerDigest = assertCcpDigestV1(record.ledgerDigest, SUPERSESSION_PROJECTION_SCHEMA_DENIED);
    const currentHeadDigest = assertCcpNullableDigestV1(record.currentHeadDigest, SUPERSESSION_PROJECTION_SCHEMA_DENIED);
    const currentSemanticEffectId = assertCcpNullableDigestV1(record.currentSemanticEffectId, SUPERSESSION_PROJECTION_SCHEMA_DENIED);
    const currentCount = assertCcpSafeUnsignedIntegerV1(record.currentCount, SUPERSESSION_PROJECTION_SCHEMA_DENIED);
    if (currentCount > 1)
        ccpStrictDenyV1(SUPERSESSION_PROJECTION_SCHEMA_DENIED);
    const supersededCount = assertCcpSafeUnsignedIntegerV1(record.supersededCount, SUPERSESSION_PROJECTION_SCHEMA_DENIED);
    const invalidatedCount = assertCcpSafeUnsignedIntegerV1(record.invalidatedCount, SUPERSESSION_PROJECTION_SCHEMA_DENIED);
    if ((currentHeadDigest === null) !== (currentSemanticEffectId === null)) {
        ccpStrictDenyV1(SUPERSESSION_PROJECTION_SCHEMA_DENIED);
    }
    if ((currentHeadDigest === null) !== (currentCount === 0)) {
        ccpStrictDenyV1(SUPERSESSION_PROJECTION_SCHEMA_DENIED);
    }
    const headsRaw = readCcpDenseArrayV1(record.heads, seen, SUPERSESSION_PROJECTION_SCHEMA_DENIED);
    const digests = new Set();
    const effectSequences = new Set();
    const heads = headsRaw.map((label) => normalizeSupersessionLabel(label, seen, digests, effectSequences));
    const currentLabels = heads.filter((label) => label.state === "CURRENT");
    const supersededLabels = heads.filter((label) => label.state === "SUPERSEDED");
    const invalidatedLabels = heads.filter((label) => label.state === "INVALIDATED");
    if (currentLabels.length !== currentCount || supersededLabels.length !== supersededCount
        || invalidatedLabels.length !== invalidatedCount) {
        ccpStrictDenyV1(SUPERSESSION_PROJECTION_SCHEMA_DENIED);
    }
    if (currentHeadDigest !== null) {
        const currentLabel = currentLabels.at(0);
        if (currentLabel === undefined || currentLabel.headDigest !== currentHeadDigest) {
            ccpStrictDenyV1(SUPERSESSION_PROJECTION_SCHEMA_DENIED);
        }
        if (currentLabel.semanticEffectId !== currentSemanticEffectId) {
            ccpStrictDenyV1(SUPERSESSION_PROJECTION_SCHEMA_DENIED);
        }
    }
    const unsigned = Object.freeze({
        schemaVersion: CCP_HEAD_SUPERSESSION_PROJECTION_SCHEMA_V1,
        ...identity,
        ledgerDigest,
        currentHeadDigest,
        currentSemanticEffectId,
        heads: Object.freeze([...heads]),
        currentCount,
        supersededCount,
        invalidatedCount,
    });
    const supersessionDigest = ccpDigestDomainV1(CCP_HEAD_SUPERSESSION_PROJECTION_SCHEMA_V1, unsigned);
    if (typeof record.supersessionDigest !== "string"
        || record.supersessionDigest !== supersessionDigest) {
        ccpStrictDenyV1(SUPERSESSION_PROJECTION_SCHEMA_DENIED);
    }
    return Object.freeze({ ...unsigned, supersessionDigest });
}
/** Canonical JSON of the closed projection; byte order independent of input key order. */
export function canonicalCcpHeadSupersessionProjectionJsonV1(value) {
    return canonicalJson(parseCcpHeadSupersessionProjectionV1(value));
}
/** Domain-bound content digest of the closed projection. */
export function ccpHeadSupersessionProjectionDigestV1(value) {
    return parseCcpHeadSupersessionProjectionV1(value).supersessionDigest;
}
/**
 * Verify a head supersession projection on read-back. Returns the closed
 * projection on success; returns null when the projection is malformed or
 * forged (any rehashed drift in the head labels, eligibility flags, state
 * counts or the supersession digest).
 */
export function verifyCcpHeadSupersessionProjectionV1(value) {
    try {
        return parseCcpHeadSupersessionProjectionV1(value);
    }
    catch {
        return null;
    }
}
