import { canonicalJson } from "./canonical-json.js";
import { assertCcpDigestV1, assertCcpNullableDigestV1, assertCcpSafePositiveIntegerV1, assertCcpStringV1, ccpDigestDomainV1, ccpStrictDenyV1, CONTRIBUTION_ID_PATTERN, LEDGER_ID_PATTERN, readCcpClosedObjectV1, REPOSITORY_ID_PATTERN, TENANT_ID_PATTERN, } from "./ccp-event-envelope.js";
import { CCP_COMPONENT_IDS_V1 } from "./ccp-risk-routing.js";
import { ccpTrainReceiptDigestV1, parseCcpTrainReceiptV1, } from "./ccp-component-train.js";
import { ccpTupleLockDigestV1, parseCcpTupleLockV1, } from "./ccp-tuple-lock.js";
/**
 * CCP PSAI52 bounded intake boundary (M1 merge-train side): the protected
 * independent promotion decision and the atomic exact-LKG restoration of
 * the component merge train, in pure synthetic state.
 *
 * A promotion decision is an independent, digest-bound evaluation of a
 * train-eligible candidate plus its complete, locked verification tuple.
 * No candidate or verification result can self-promote: the decision is
 * bound to a promoter identity from a closed `promoter:` namespace that is
 * disjoint from the candidate's `delivery:` namespace and the verifier's
 * `verifier:` namespace, and a promotion decision is the only artifact
 * that may move the LKG pointer. A held decision projects no pointer
 * change (after digest equals before digest) — zero unauthorized merge
 * projection.
 *
 * The LKG pointer moves only through atomic transitions, each producing a
 * receipt with explicit before/after pointer digests, before/after state
 * digests and before/after generations:
 * - PROMOTE: the LKG advances from the before digest to the candidate
 *   head of a PROMOTED decision whose evidence exactly covers this state.
 * - RESTORE: after a failed re-verification of the promoted head, the LKG
 *   is restored atomically to the exact pre-promotion head digest of the
 *   decision — an exact, not a best-effort, restoration.
 *
 * Every transition receipt re-derives the before/after LKG state digests
 * from the pointer digests and generations it carries, so a receipt whose
 * before/after do not match real LKG states denies on read-back. There is
 * no network, persistence, clock, randomness, queue, runner or merge
 * capability; nothing here executes a merge.
 */
export const CCP_PROMOTION_DECISION_SCHEMA_V1 = "cm.ccp-promotion-decision/v1";
export const CCP_LKG_STATE_SCHEMA_V1 = "cm.ccp-lkg-state/v1";
export const CCP_LKG_TRANSITION_SCHEMA_V1 = "cm.ccp-lkg-transition/v1";
export const CCP_PROMOTION_DISPOSITIONS_V1 = Object.freeze(["PROMOTED", "HOLD"]);
/**
 * Closed reason vocabulary for the independent promotion decision; first
 * failure wins. UNAUTHORIZED_PROMOTER is the fail-closed tripwire for a
 * promoter naming the candidate or verifier: it is unreachable while the
 * closed promoter namespace stays disjoint from the delivery and verifier
 * namespaces (such forgeries deny at parse instead).
 */
export const CCP_PROMOTION_REASON_CODES_V1 = Object.freeze([
    "EVIDENCE_IDENTITY_MISMATCH",
    "HEAD_ALREADY_LKG",
    "INELIGIBLE_TRAIN_RECEIPT",
    "LOCK_NOT_COMPLETE",
    "PROMOTED_EVIDENCE_COMPLETE",
    "UNAUTHORIZED_PROMOTER",
    "VERIFICATION_PRECEDES_CANDIDATE",
]);
export const CCP_LKG_TRANSITION_KINDS_V1 = Object.freeze(["PROMOTE", "RESTORE"]);
const PROMOTION_DECISION_SCHEMA_DENIED = "CCP_PROMOTION_DECISION_SCHEMA_DENIED";
const LKG_STATE_SCHEMA_DENIED = "CCP_LKG_STATE_SCHEMA_DENIED";
const LKG_TRANSITION_SCHEMA_DENIED = "CCP_LKG_TRANSITION_SCHEMA_DENIED";
const PROMOTER_ID_PATTERN = /^promoter:[a-z0-9][a-z0-9._-]{2,95}$/;
const PROMOTION_DECISION_KEYS = Object.freeze([
    "schemaVersion", "promoterId", "trainReceipt", "trainReceiptDigest",
    "tupleLock", "tupleLockDigest", "lkgBeforeDigest", "lkgGenerationBefore",
    "lkgAfterDigest", "disposition", "reasonCode", "mergeAuthorized", "decisionDigest",
]);
const LKG_STATE_KEYS = Object.freeze([
    "schemaVersion", "ledgerId", "tenantId", "repositoryId", "contributionId",
    "componentId", "lkgDigest", "generation", "stateDigest",
]);
const LKG_TRANSITION_KEYS = Object.freeze([
    "schemaVersion", "ledgerId", "tenantId", "repositoryId", "contributionId",
    "componentId", "transitionKind", "beforeDigest", "afterDigest",
    "stateDigestBefore", "stateDigestAfter", "generationBefore", "generationAfter",
    "boundDecisionDigest", "regressionLockDigest", "transitionDigest",
]);
function assertKnownComponent(componentId, code) {
    if (typeof componentId !== "string"
        || !CCP_COMPONENT_IDS_V1.includes(componentId)) {
        ccpStrictDenyV1(code);
    }
    return componentId;
}
function readLkgIdentity(record, code) {
    return {
        ledgerId: assertCcpStringV1(record.ledgerId, LEDGER_ID_PATTERN, code),
        tenantId: assertCcpStringV1(record.tenantId, TENANT_ID_PATTERN, code),
        repositoryId: assertCcpStringV1(record.repositoryId, REPOSITORY_ID_PATTERN, code),
        contributionId: assertCcpStringV1(record.contributionId, CONTRIBUTION_ID_PATTERN, code),
    };
}
/**
 * Derive the closed promotion decision. The candidate (via the train
 * receipt) and the verification result (via the tuple lock) are evidence
 * only; the checks are finite and ordered, the first failure wins, and
 * every outcome is fail-closed. A held decision projects no pointer
 * change.
 */
function derivePromotionDecision(input) {
    const candidate = input.trainReceipt.candidate;
    const lock = input.tupleLock;
    if (candidate.ledgerId !== lock.ledgerId
        || candidate.tenantId !== lock.tenantId
        || candidate.repositoryId !== lock.repositoryId
        || candidate.contributionId !== lock.contributionId
        || candidate.componentId !== lock.componentId
        || candidate.headDigest !== lock.headDigest
        || candidate.payloadDigest !== lock.payloadDigest
        || candidate.deliveryId !== lock.deliveryId
        || lock.authorityEvidence.headDigest !== lock.headDigest
        || lock.authorityEvidence.payloadDigest !== lock.payloadDigest
        || lock.authorityEvidence.deliveryId !== lock.deliveryId) {
        return {
            disposition: "HOLD",
            reasonCode: "EVIDENCE_IDENTITY_MISMATCH",
            lkgAfterDigest: input.lkgBeforeDigest,
        };
    }
    if (input.trainReceipt.disposition !== "ELIGIBLE"
        || !input.trainReceipt.eligibility.mergeTrainEligible) {
        return {
            disposition: "HOLD",
            reasonCode: "INELIGIBLE_TRAIN_RECEIPT",
            lkgAfterDigest: input.lkgBeforeDigest,
        };
    }
    if (!lock.allClaimsPassed) {
        return {
            disposition: "HOLD",
            reasonCode: "LOCK_NOT_COMPLETE",
            lkgAfterDigest: input.lkgBeforeDigest,
        };
    }
    if (candidate.headDigest === input.lkgBeforeDigest) {
        return {
            disposition: "HOLD",
            reasonCode: "HEAD_ALREADY_LKG",
            lkgAfterDigest: input.lkgBeforeDigest,
        };
    }
    if (lock.logicalAtMs < candidate.logicalAtMs) {
        return {
            disposition: "HOLD",
            reasonCode: "VERIFICATION_PRECEDES_CANDIDATE",
            lkgAfterDigest: input.lkgBeforeDigest,
        };
    }
    if (input.promoterId !== "promoter:gatekeeper"
        || input.promoterId === candidate.deliveryId
        || input.promoterId === lock.verifierId) {
        return {
            disposition: "HOLD",
            reasonCode: "UNAUTHORIZED_PROMOTER",
            lkgAfterDigest: input.lkgBeforeDigest,
        };
    }
    return {
        disposition: "PROMOTED",
        reasonCode: "PROMOTED_EVIDENCE_COMPLETE",
        lkgAfterDigest: candidate.headDigest,
    };
}
/**
 * Build the protected independent promotion decision over a train
 * receipt and a locked verification tuple. Inputs are parsed and closed
 * first; the promoter identity must be in the closed promoter namespace.
 * The decision is digest-bound over its full evidence; it does not move
 * any pointer — only the LKG transitions may do that.
 */
export function makeCcpPromotionDecisionV1(input) {
    const trainReceipt = parseCcpTrainReceiptV1(input.trainReceipt);
    const tupleLock = parseCcpTupleLockV1(input.tupleLock);
    const promoterId = assertCcpStringV1(input.promoterId, PROMOTER_ID_PATTERN, PROMOTION_DECISION_SCHEMA_DENIED);
    const lkgBeforeDigest = assertCcpDigestV1(input.lkgBeforeDigest, PROMOTION_DECISION_SCHEMA_DENIED);
    const lkgGenerationBefore = assertCcpSafePositiveIntegerV1(input.lkgGenerationBefore, PROMOTION_DECISION_SCHEMA_DENIED);
    const decision = derivePromotionDecision({
        trainReceipt,
        tupleLock,
        promoterId,
        lkgBeforeDigest,
    });
    const unsigned = Object.freeze({
        schemaVersion: CCP_PROMOTION_DECISION_SCHEMA_V1,
        promoterId,
        trainReceipt,
        trainReceiptDigest: ccpTrainReceiptDigestV1(trainReceipt),
        tupleLock,
        tupleLockDigest: ccpTupleLockDigestV1(tupleLock),
        lkgBeforeDigest,
        lkgGenerationBefore,
        lkgAfterDigest: decision.lkgAfterDigest,
        disposition: decision.disposition,
        reasonCode: decision.reasonCode,
        mergeAuthorized: false,
    });
    return Object.freeze({
        ...unsigned,
        decisionDigest: ccpDigestDomainV1(CCP_PROMOTION_DECISION_SCHEMA_V1, unsigned),
    });
}
/**
 * Parse and close a promotion decision receipt. The train receipt and
 * tuple lock are re-closed and re-digested, the decision is re-derived
 * from the evidence and the digest is re-checked; any drift, forged
 * disposition or rehashed evidence denies with a TypeError carrying the
 * closed denial code.
 */
export function parseCcpPromotionDecisionReceiptV1(value) {
    const record = readCcpClosedObjectV1(value, PROMOTION_DECISION_KEYS, new WeakSet(), PROMOTION_DECISION_SCHEMA_DENIED);
    if (record.schemaVersion !== CCP_PROMOTION_DECISION_SCHEMA_V1) {
        ccpStrictDenyV1(PROMOTION_DECISION_SCHEMA_DENIED);
    }
    let trainReceipt;
    let tupleLock;
    try {
        trainReceipt = parseCcpTrainReceiptV1(record.trainReceipt);
        tupleLock = parseCcpTupleLockV1(record.tupleLock);
    }
    catch {
        // Nested evidence is part of this closed decision boundary: do not
        // leak a child receipt code when a decision receipt is forged.
        ccpStrictDenyV1(PROMOTION_DECISION_SCHEMA_DENIED);
    }
    const promoterId = assertCcpStringV1(record.promoterId, PROMOTER_ID_PATTERN, PROMOTION_DECISION_SCHEMA_DENIED);
    const lkgBeforeDigest = assertCcpDigestV1(record.lkgBeforeDigest, PROMOTION_DECISION_SCHEMA_DENIED);
    const lkgGenerationBefore = assertCcpSafePositiveIntegerV1(record.lkgGenerationBefore, PROMOTION_DECISION_SCHEMA_DENIED);
    const lkgAfterDigest = assertCcpDigestV1(record.lkgAfterDigest, PROMOTION_DECISION_SCHEMA_DENIED);
    if (record.trainReceiptDigest !== ccpTrainReceiptDigestV1(trainReceipt)) {
        ccpStrictDenyV1(PROMOTION_DECISION_SCHEMA_DENIED);
    }
    if (record.tupleLockDigest !== ccpTupleLockDigestV1(tupleLock)) {
        ccpStrictDenyV1(PROMOTION_DECISION_SCHEMA_DENIED);
    }
    if (typeof record.disposition !== "string"
        || !CCP_PROMOTION_DISPOSITIONS_V1.includes(record.disposition)) {
        ccpStrictDenyV1(PROMOTION_DECISION_SCHEMA_DENIED);
    }
    const disposition = record.disposition;
    if (typeof record.reasonCode !== "string"
        || !CCP_PROMOTION_REASON_CODES_V1.includes(record.reasonCode)) {
        ccpStrictDenyV1(PROMOTION_DECISION_SCHEMA_DENIED);
    }
    const expected = derivePromotionDecision({
        trainReceipt,
        tupleLock,
        promoterId,
        lkgBeforeDigest,
    });
    if (disposition !== expected.disposition
        || record.reasonCode !== expected.reasonCode
        || lkgAfterDigest !== expected.lkgAfterDigest) {
        ccpStrictDenyV1(PROMOTION_DECISION_SCHEMA_DENIED);
    }
    if (record.mergeAuthorized !== false) {
        ccpStrictDenyV1(PROMOTION_DECISION_SCHEMA_DENIED);
    }
    if ((disposition === "PROMOTED") !== (lkgAfterDigest !== lkgBeforeDigest)) {
        ccpStrictDenyV1(PROMOTION_DECISION_SCHEMA_DENIED);
    }
    const unsigned = Object.freeze({
        schemaVersion: CCP_PROMOTION_DECISION_SCHEMA_V1,
        promoterId,
        trainReceipt,
        trainReceiptDigest: record.trainReceiptDigest,
        tupleLock,
        tupleLockDigest: record.tupleLockDigest,
        lkgBeforeDigest,
        lkgGenerationBefore,
        lkgAfterDigest,
        disposition,
        reasonCode: record.reasonCode,
        mergeAuthorized: false,
    });
    const decisionDigest = ccpDigestDomainV1(CCP_PROMOTION_DECISION_SCHEMA_V1, unsigned);
    if (typeof record.decisionDigest !== "string" || record.decisionDigest !== decisionDigest) {
        ccpStrictDenyV1(PROMOTION_DECISION_SCHEMA_DENIED);
    }
    return Object.freeze({ ...unsigned, decisionDigest });
}
/** Canonical JSON of the closed promotion decision; key order independent. */
export function canonicalCcpPromotionDecisionJsonV1(value) {
    return canonicalJson(parseCcpPromotionDecisionReceiptV1(value));
}
/** Domain-bound content digest of the closed promotion decision. */
export function ccpPromotionDecisionDigestV1(value) {
    return parseCcpPromotionDecisionReceiptV1(value).decisionDigest;
}
/**
 * Verify a promotion decision receipt on read-back. Returns the closed
 * decision on success; returns null when the decision is malformed or
 * forged (rehashed evidence, forged disposition, self-named promoter
 * namespace, drifted after digest).
 */
export function verifyCcpPromotionDecisionReceiptV1(value) {
    try {
        return parseCcpPromotionDecisionReceiptV1(value);
    }
    catch {
        return null;
    }
}
/**
 * Build a closed LKG state. Inputs are validated fail-closed; the state
 * digest binds the pointer digest and generation. Used to bootstrap the
 * synthetic train state and to materialize the after-state of each
 * atomic transition.
 */
export function makeCcpLkgStateV1(input) {
    const stateIdentity = {
        ledgerId: assertCcpStringV1(input.ledgerId, LEDGER_ID_PATTERN, LKG_STATE_SCHEMA_DENIED),
        tenantId: assertCcpStringV1(input.tenantId, TENANT_ID_PATTERN, LKG_STATE_SCHEMA_DENIED),
        repositoryId: assertCcpStringV1(input.repositoryId, REPOSITORY_ID_PATTERN, LKG_STATE_SCHEMA_DENIED),
        contributionId: assertCcpStringV1(input.contributionId, CONTRIBUTION_ID_PATTERN, LKG_STATE_SCHEMA_DENIED),
    };
    const componentId = assertKnownComponent(input.componentId, LKG_STATE_SCHEMA_DENIED);
    const lkgDigest = assertCcpDigestV1(input.lkgDigest, LKG_STATE_SCHEMA_DENIED);
    const generation = assertCcpSafePositiveIntegerV1(input.generation, LKG_STATE_SCHEMA_DENIED);
    const unsigned = Object.freeze({
        schemaVersion: CCP_LKG_STATE_SCHEMA_V1,
        ...stateIdentity,
        componentId,
        lkgDigest,
        generation,
    });
    return Object.freeze({
        ...unsigned,
        stateDigest: ccpDigestDomainV1(CCP_LKG_STATE_SCHEMA_V1, unsigned),
    });
}
/**
 * Parse and close an LKG state. The state digest is re-derived from the
 * pointer digest and generation; any drift denies with a TypeError
 * carrying the closed denial code.
 */
export function parseCcpLkgStateV1(value) {
    const record = readCcpClosedObjectV1(value, LKG_STATE_KEYS, new WeakSet(), LKG_STATE_SCHEMA_DENIED);
    if (record.schemaVersion !== CCP_LKG_STATE_SCHEMA_V1) {
        ccpStrictDenyV1(LKG_STATE_SCHEMA_DENIED);
    }
    const identity = readLkgIdentity(record, LKG_STATE_SCHEMA_DENIED);
    const componentId = assertKnownComponent(record.componentId, LKG_STATE_SCHEMA_DENIED);
    const lkgDigest = assertCcpDigestV1(record.lkgDigest, LKG_STATE_SCHEMA_DENIED);
    const generation = assertCcpSafePositiveIntegerV1(record.generation, LKG_STATE_SCHEMA_DENIED);
    const unsigned = Object.freeze({
        schemaVersion: CCP_LKG_STATE_SCHEMA_V1,
        ...identity,
        componentId,
        lkgDigest,
        generation,
    });
    const stateDigest = ccpDigestDomainV1(CCP_LKG_STATE_SCHEMA_V1, unsigned);
    if (typeof record.stateDigest !== "string" || record.stateDigest !== stateDigest) {
        ccpStrictDenyV1(LKG_STATE_SCHEMA_DENIED);
    }
    return Object.freeze({ ...unsigned, stateDigest });
}
/** Canonical JSON of the closed LKG state; key order independent. */
export function canonicalCcpLkgStateJsonV1(value) {
    return canonicalJson(parseCcpLkgStateV1(value));
}
/** Domain-bound content digest of the closed LKG state. */
export function ccpLkgStateDigestV1(value) {
    return parseCcpLkgStateV1(value).stateDigest;
}
/**
 * Verify an LKG state on read-back. Returns the closed state on success;
 * returns null when the state is malformed or the state digest drifts.
 */
export function verifyCcpLkgStateV1(value) {
    try {
        return parseCcpLkgStateV1(value);
    }
    catch {
        return null;
    }
}
/**
 * Parse and close an LKG pointer transition receipt. The before/after
 * state digests are re-derived from the pointer digests and generations
 * carried by the receipt; the transition must be single-step
 * (generationAfter = generationBefore + 1), non-trivial (before and after
 * pointer digests differ) and consistent in kind (PROMOTE carries no
 * regression lock, RESTORE carries exactly one). Any drift denies with a
 * TypeError carrying the closed denial code.
 */
export function parseCcpLkgTransitionReceiptV1(value) {
    const record = readCcpClosedObjectV1(value, LKG_TRANSITION_KEYS, new WeakSet(), LKG_TRANSITION_SCHEMA_DENIED);
    if (record.schemaVersion !== CCP_LKG_TRANSITION_SCHEMA_V1) {
        ccpStrictDenyV1(LKG_TRANSITION_SCHEMA_DENIED);
    }
    const identity = readLkgIdentity(record, LKG_TRANSITION_SCHEMA_DENIED);
    const componentId = assertKnownComponent(record.componentId, LKG_TRANSITION_SCHEMA_DENIED);
    if (typeof record.transitionKind !== "string"
        || !CCP_LKG_TRANSITION_KINDS_V1.includes(record.transitionKind)) {
        ccpStrictDenyV1(LKG_TRANSITION_SCHEMA_DENIED);
    }
    const transitionKind = record.transitionKind;
    const beforeDigest = assertCcpDigestV1(record.beforeDigest, LKG_TRANSITION_SCHEMA_DENIED);
    const afterDigest = assertCcpDigestV1(record.afterDigest, LKG_TRANSITION_SCHEMA_DENIED);
    if (beforeDigest === afterDigest) {
        ccpStrictDenyV1(LKG_TRANSITION_SCHEMA_DENIED);
    }
    const stateDigestBefore = assertCcpDigestV1(record.stateDigestBefore, LKG_TRANSITION_SCHEMA_DENIED);
    const stateDigestAfter = assertCcpDigestV1(record.stateDigestAfter, LKG_TRANSITION_SCHEMA_DENIED);
    const generationBefore = assertCcpSafePositiveIntegerV1(record.generationBefore, LKG_TRANSITION_SCHEMA_DENIED);
    const generationAfter = assertCcpSafePositiveIntegerV1(record.generationAfter, LKG_TRANSITION_SCHEMA_DENIED);
    if (generationAfter !== generationBefore + 1) {
        ccpStrictDenyV1(LKG_TRANSITION_SCHEMA_DENIED);
    }
    const boundDecisionDigest = assertCcpDigestV1(record.boundDecisionDigest, LKG_TRANSITION_SCHEMA_DENIED);
    const regressionLockDigest = assertCcpNullableDigestV1(record.regressionLockDigest, LKG_TRANSITION_SCHEMA_DENIED);
    if ((transitionKind === "PROMOTE") !== (regressionLockDigest === null)) {
        ccpStrictDenyV1(LKG_TRANSITION_SCHEMA_DENIED);
    }
    // The receipt must bind to real LKG states: re-derive both state
    // digests from the pointer digests and generations it carries.
    const expectedStateDigestBefore = ccpDigestDomainV1(CCP_LKG_STATE_SCHEMA_V1, Object.freeze({
        schemaVersion: CCP_LKG_STATE_SCHEMA_V1,
        ...identity,
        componentId,
        lkgDigest: beforeDigest,
        generation: generationBefore,
    }));
    const expectedStateDigestAfter = ccpDigestDomainV1(CCP_LKG_STATE_SCHEMA_V1, Object.freeze({
        schemaVersion: CCP_LKG_STATE_SCHEMA_V1,
        ...identity,
        componentId,
        lkgDigest: afterDigest,
        generation: generationAfter,
    }));
    if (stateDigestBefore !== expectedStateDigestBefore
        || stateDigestAfter !== expectedStateDigestAfter) {
        ccpStrictDenyV1(LKG_TRANSITION_SCHEMA_DENIED);
    }
    const unsigned = Object.freeze({
        schemaVersion: CCP_LKG_TRANSITION_SCHEMA_V1,
        ...identity,
        componentId,
        transitionKind,
        beforeDigest,
        afterDigest,
        stateDigestBefore,
        stateDigestAfter,
        generationBefore,
        generationAfter,
        boundDecisionDigest,
        regressionLockDigest,
    });
    const transitionDigest = ccpDigestDomainV1(CCP_LKG_TRANSITION_SCHEMA_V1, unsigned);
    if (typeof record.transitionDigest !== "string"
        || record.transitionDigest !== transitionDigest) {
        ccpStrictDenyV1(LKG_TRANSITION_SCHEMA_DENIED);
    }
    return Object.freeze({ ...unsigned, transitionDigest });
}
/** Canonical JSON of the closed transition receipt; key order independent. */
export function canonicalCcpLkgTransitionReceiptJsonV1(value) {
    return canonicalJson(parseCcpLkgTransitionReceiptV1(value));
}
/** Domain-bound content digest of the closed transition receipt. */
export function ccpLkgTransitionReceiptDigestV1(value) {
    return parseCcpLkgTransitionReceiptV1(value).transitionDigest;
}
/**
 * Verify an LKG pointer transition receipt on read-back. Returns the
 * closed receipt on success; returns null when the receipt is malformed
 * or forged (swapped before/after, rehashed state digests, non-atomic
 * generation step, regression lock on a promotion).
 */
export function verifyCcpLkgTransitionReceiptV1(value) {
    try {
        return parseCcpLkgTransitionReceiptV1(value);
    }
    catch {
        return null;
    }
}
function buildTransitionReceipt(state, transitionKind, afterDigest, stateAfter, boundDecisionDigest, regressionLockDigest) {
    const unsigned = Object.freeze({
        schemaVersion: CCP_LKG_TRANSITION_SCHEMA_V1,
        ledgerId: state.ledgerId,
        tenantId: state.tenantId,
        repositoryId: state.repositoryId,
        contributionId: state.contributionId,
        componentId: state.componentId,
        transitionKind,
        beforeDigest: state.lkgDigest,
        afterDigest,
        stateDigestBefore: state.stateDigest,
        stateDigestAfter: stateAfter.stateDigest,
        generationBefore: state.generation,
        generationAfter: stateAfter.generation,
        boundDecisionDigest,
        regressionLockDigest,
    });
    return Object.freeze({
        ...unsigned,
        transitionDigest: ccpDigestDomainV1(CCP_LKG_TRANSITION_SCHEMA_V1, unsigned),
    });
}
/**
 * Atomically promote the LKG pointer from a PROMOTED decision. The
 * decision must exactly cover this state (same before digest and
 * generation, same identity and component); a held decision, a drifted
 * state or an identity mismatch denies fail-closed. Returns the new LKG
 * state (pointer at the candidate head, generation + 1) and the atomic
 * PROMOTE transition receipt with explicit before/after.
 */
export function promoteCcpLkgV1(candidateState, candidateDecision) {
    const state = parseCcpLkgStateV1(candidateState);
    const decision = parseCcpPromotionDecisionReceiptV1(candidateDecision);
    if (decision.disposition !== "PROMOTED") {
        ccpStrictDenyV1(LKG_TRANSITION_SCHEMA_DENIED);
    }
    const candidate = decision.trainReceipt.candidate;
    if (decision.lkgBeforeDigest !== state.lkgDigest
        || decision.lkgGenerationBefore !== state.generation
        || candidate.ledgerId !== state.ledgerId
        || candidate.tenantId !== state.tenantId
        || candidate.repositoryId !== state.repositoryId
        || candidate.contributionId !== state.contributionId
        || candidate.componentId !== state.componentId) {
        ccpStrictDenyV1(LKG_TRANSITION_SCHEMA_DENIED);
    }
    const afterDigest = decision.lkgAfterDigest;
    if (afterDigest === state.lkgDigest) {
        ccpStrictDenyV1(LKG_TRANSITION_SCHEMA_DENIED);
    }
    const stateAfter = makeCcpLkgStateV1({
        ledgerId: state.ledgerId,
        tenantId: state.tenantId,
        repositoryId: state.repositoryId,
        contributionId: state.contributionId,
        componentId: state.componentId,
        lkgDigest: afterDigest,
        generation: state.generation + 1,
    });
    const receipt = buildTransitionReceipt(state, "PROMOTE", afterDigest, stateAfter, decision.decisionDigest, null);
    return Object.freeze({ state: stateAfter, receipt });
}
/**
 * Atomically restore the LKG pointer to the exact pre-promotion head
 * after a failed re-verification of the promoted head. The state must be
 * exactly the promoted head (decision after digest, generation one past
 * the decision's before generation), and the failed lock must be a
 * complete tuple lock with at least one failed claim about the current
 * head. Returns the restored LKG state (pointer at the decision's exact
 * before digest, generation + 1) and the atomic RESTORE transition
 * receipt with explicit before/after and the regression lock digest.
 */
export function restoreCcpLkgV1(candidateState, candidateDecision, candidateRegressionLock) {
    const state = parseCcpLkgStateV1(candidateState);
    const decision = parseCcpPromotionDecisionReceiptV1(candidateDecision);
    const regressionLock = parseCcpTupleLockV1(candidateRegressionLock);
    if (decision.disposition !== "PROMOTED") {
        ccpStrictDenyV1(LKG_TRANSITION_SCHEMA_DENIED);
    }
    const candidate = decision.trainReceipt.candidate;
    if (decision.lkgAfterDigest !== state.lkgDigest
        || state.generation !== decision.lkgGenerationBefore + 1
        || candidate.ledgerId !== state.ledgerId
        || candidate.tenantId !== state.tenantId
        || candidate.repositoryId !== state.repositoryId
        || candidate.contributionId !== state.contributionId
        || candidate.componentId !== state.componentId) {
        ccpStrictDenyV1(LKG_TRANSITION_SCHEMA_DENIED);
    }
    if (regressionLock.headDigest !== state.lkgDigest
        || regressionLock.payloadDigest !== candidate.payloadDigest
        || regressionLock.deliveryId !== candidate.deliveryId
        || regressionLock.logicalAtMs < candidate.logicalAtMs
        || regressionLock.allClaimsPassed !== false
        || regressionLock.ledgerId !== state.ledgerId
        || regressionLock.tenantId !== state.tenantId
        || regressionLock.repositoryId !== state.repositoryId
        || regressionLock.contributionId !== state.contributionId
        || regressionLock.componentId !== state.componentId) {
        ccpStrictDenyV1(LKG_TRANSITION_SCHEMA_DENIED);
    }
    const afterDigest = decision.lkgBeforeDigest;
    if (afterDigest === state.lkgDigest) {
        ccpStrictDenyV1(LKG_TRANSITION_SCHEMA_DENIED);
    }
    const stateAfter = makeCcpLkgStateV1({
        ledgerId: state.ledgerId,
        tenantId: state.tenantId,
        repositoryId: state.repositoryId,
        contributionId: state.contributionId,
        componentId: state.componentId,
        lkgDigest: afterDigest,
        generation: state.generation + 1,
    });
    const receipt = buildTransitionReceipt(state, "RESTORE", afterDigest, stateAfter, decision.decisionDigest, regressionLock.lockDigest);
    return Object.freeze({ state: stateAfter, receipt });
}
