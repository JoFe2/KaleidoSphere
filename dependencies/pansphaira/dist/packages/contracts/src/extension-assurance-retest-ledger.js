import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import { EXTENSION_ASSURANCE_APPEAL_CLAIM_BOUNDARY_V1, EXTENSION_ASSURANCE_APPEAL_RESULT_SCHEMA_V1, } from "./extension-assurance-appeal.js";
import { EXTENSION_ASSURANCE_CLAIM_BOUNDARY_V1, EXTENSION_ASSURANCE_RESULT_SCHEMA_V1, EXTENSION_ASSURANCE_RETEST_TRIGGERS_V1, evaluateExtensionAssuranceProfileV1, extensionAssuranceProfileDigestV1, } from "./extension-assurance-profile.js";
import { EXTENSION_ASSURANCE_RETEST_DECISION_SCHEMA_V1 } from "./extension-assurance-retest-policy.js";
export const EXTENSION_ASSURANCE_RETEST_LEDGER_SCHEMA_V1 = "chimpmaera.extension-trust/assurance-retest-ledger/v1";
export const EXTENSION_ASSURANCE_RETEST_LEDGER_RESULT_SCHEMA_V1 = "chimpmaera.extension-trust/assurance-retest-ledger-result/v1";
export const EXTENSION_ASSURANCE_RETEST_LEDGER_PROJECTION_SCHEMA_V1 = "chimpmaera.extension-trust/assurance-retest-ledger-projection/v1";
export const EXTENSION_ASSURANCE_RETEST_LEDGER_CLAIM_BOUNDARY_V1 = "LOCAL_RETEST_LEDGER_ONLY_NO_TRUST_NO_ADMISSION_NO_ACTIVATION_NO_MARKETPLACE_NO_EXECUTION";
export const EXTENSION_ASSURANCE_RETEST_LEDGER_GENESIS_DIGEST_V1 = "0000000000000000000000000000000000000000000000000000000000000000";
export const EXTENSION_ASSURANCE_RETEST_LEDGER_VERIFIER_VERSION_V1 = "1.0.0";
export const EXTENSION_ASSURANCE_RETEST_LEDGER_EVENT_TYPES_V1 = [
    "RETEST_REQUESTED",
    "RETEST_STARTED",
    "RETEST_COMPLETED",
    "RETEST_DENIED",
];
export const EXTENSION_ASSURANCE_RETEST_LEDGER_STATES_V1 = [
    "RETEST_REQUIRED",
    "RETEST_IN_PROGRESS",
    "RETEST_CONFORMANT",
    "RETEST_DENIED",
];
export const EXTENSION_ASSURANCE_RETEST_LEDGER_REASON_CODES_V1 = [
    "RETEST_LEDGER_RECORDED",
    "SCHEMA_DENIED",
    "DIGEST_MISMATCH_DENIED",
    "PRIOR_BINDING_DENIED",
    "DECISION_TRIGGER_MISMATCH_DENIED",
    "APPEAL_BINDING_DENIED",
    "REVISION_SEQUENCE_DENIED",
    "EVIDENCE_BINDING_DENIED",
    "STATE_TRANSITION_DENIED",
    "CONFORMANT_EVIDENCE_DENIED",
    "VERIFIER_VERSION_DENIED",
];
const RESULT_OUTCOMES = ["PROFILE_CONFORMANT", "DENIED", "RETEST_REQUIRED"];
const RESULT_CLAIMS = [
    "LOCALLY_EVALUATED_SYNTHETIC", "ASSURANCE_DENIED", "EVIDENCE_EXPIRED_RETEST_REQUIRED", "INCONCLUSIVE",
];
const PROFILE_RESULT_REASONS = [
    "PROFILE_CONFORMANT", "SCHEMA_DENIED", "DIGEST_MISMATCH_DENIED", "UNIVERSAL_GATE_MISSING_DENIED",
    "REQUIRED_CHECK_NOT_RUN_DENIED", "HARD_FAIL_DENIED", "SECURITY_ROUTING_DENIED", "RETEST_CONTRACT_DENIED",
    "EVIDENCE_MISMATCH_RETEST_REQUIRED", "EVIDENCE_STALE_RETEST_REQUIRED", "FALSE_NEGATIVE_RETEST_REQUIRED",
];
const APPEAL_RESULT_OUTCOMES = ["APPEAL_RECORDED", "DENIED", "RETEST_REQUIRED"];
const APPEAL_RESULT_CLAIMS = [
    "LOCAL_APPEAL_RECORDED", "APPEAL_DENIED", "FALSE_NEGATIVE_RETEST_REQUIRED", "INCONCLUSIVE",
];
const APPEAL_RESULT_REASONS = [
    "APPEAL_RECORDED", "SCHEMA_DENIED", "DIGEST_MISMATCH_DENIED", "PRIOR_RESULT_BINDING_DENIED",
    "EVIDENCE_BINDING_DENIED", "REVISION_MONOTONICITY_DENIED", "REPLAY_OR_GAP_DENIED",
    "STATE_TRANSITION_DENIED", "FALSE_NEGATIVE_RETEST_REQUIRED",
];
const EVENT_STATE = {
    RETEST_REQUESTED: "RETEST_REQUIRED",
    RETEST_STARTED: "RETEST_IN_PROGRESS",
    RETEST_COMPLETED: "RETEST_CONFORMANT",
    RETEST_DENIED: "RETEST_DENIED",
};
const ALLOWED_PREVIOUS_STATES = {
    RETEST_REQUESTED: [],
    RETEST_STARTED: ["RETEST_REQUIRED"],
    RETEST_COMPLETED: ["RETEST_IN_PROGRESS"],
    RETEST_DENIED: ["RETEST_REQUIRED", "RETEST_IN_PROGRESS"],
};
const REASON_ORDER = [
    "SCHEMA_DENIED",
    "DIGEST_MISMATCH_DENIED",
    "PRIOR_BINDING_DENIED",
    "DECISION_TRIGGER_MISMATCH_DENIED",
    "APPEAL_BINDING_DENIED",
    "REVISION_SEQUENCE_DENIED",
    "EVIDENCE_BINDING_DENIED",
    "STATE_TRANSITION_DENIED",
    "CONFORMANT_EVIDENCE_DENIED",
    "VERIFIER_VERSION_DENIED",
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
function isArtifactRef(value) {
    return typeof value === "string" && /^artifact:sha256:[a-f0-9]{64}$/.test(value);
}
function isTimestamp(value) {
    return Number.isSafeInteger(value) && value >= 0;
}
function isPositiveRevision(value) {
    return Number.isSafeInteger(value) && value >= 1;
}
function isUniqueArray(value, predicate, allowEmpty = false) {
    return Array.isArray(value) && (allowEmpty || value.length > 0) && value.every(predicate)
        && new Set(value).size === value.length;
}
function validResultBinding(value) {
    return exactKeys(value, ["schemaVersion", "outcome", "reasonCodes", "publicClaim", "claimBoundary"])
        && value.schemaVersion === EXTENSION_ASSURANCE_RESULT_SCHEMA_V1
        && RESULT_OUTCOMES.includes(value.outcome)
        && Array.isArray(value.reasonCodes) && value.reasonCodes.length >= 1 && value.reasonCodes.length <= 16
        && value.reasonCodes.every((item) => typeof item === "string" && PROFILE_RESULT_REASONS.includes(item))
        && new Set(value.reasonCodes).size === value.reasonCodes.length
        && RESULT_CLAIMS.includes(value.publicClaim)
        && value.claimBoundary === EXTENSION_ASSURANCE_CLAIM_BOUNDARY_V1;
}
function validAppealResult(value) {
    return exactKeys(value, ["schemaVersion", "outcome", "reasonCodes", "publicClaim", "claimBoundary"])
        && value.schemaVersion === EXTENSION_ASSURANCE_APPEAL_RESULT_SCHEMA_V1
        && APPEAL_RESULT_OUTCOMES.includes(value.outcome)
        && Array.isArray(value.reasonCodes) && value.reasonCodes.length >= 1 && value.reasonCodes.length <= 16
        && value.reasonCodes.every((item) => typeof item === "string" && APPEAL_RESULT_REASONS.includes(item))
        && new Set(value.reasonCodes).size === value.reasonCodes.length
        && APPEAL_RESULT_CLAIMS.includes(value.publicClaim)
        && value.claimBoundary === EXTENSION_ASSURANCE_APPEAL_CLAIM_BOUNDARY_V1;
}
function validSubject(value) {
    return exactKeys(value, ["kind", "subjectId", "subjectVersion", "subjectDigest"])
        && ["EXTENSION", "CONNECTOR"].includes(value.kind)
        && isId(value.subjectId) && typeof value.subjectVersion === "string"
        && /^\d+\.\d+\.\d+$/.test(value.subjectVersion) && isDigest(value.subjectDigest);
}
function validPrior(value) {
    return exactKeys(value, ["profileId", "profileDigest", "evidenceRefs", "result", "resultDigest"])
        && isId(value.profileId) && isDigest(value.profileDigest)
        && isUniqueArray(value.evidenceRefs, isArtifactRef, true)
        && validResultBinding(value.result) && isDigest(value.resultDigest);
}
function isTrigger(value) {
    return typeof value === "string"
        && EXTENSION_ASSURANCE_RETEST_TRIGGERS_V1.includes(value);
}
function validTriggerList(value) {
    return Array.isArray(value) && value.length >= 1 && value.length <= EXTENSION_ASSURANCE_RETEST_TRIGGERS_V1.length
        && value.every(isTrigger) && new Set(value).size === value.length;
}
function orderedTriggerList(value) {
    const selected = EXTENSION_ASSURANCE_RETEST_TRIGGERS_V1.filter((trigger) => value.includes(trigger));
    return selected.length === value.length && selected.every((trigger, index) => value[index] === trigger);
}
function validDecisionBinding(value) {
    return exactKeys(value, ["schemaVersion", "decision", "triggers"])
        && value.schemaVersion === EXTENSION_ASSURANCE_RETEST_DECISION_SCHEMA_V1
        && value.decision === "RETEST_REQUIRED"
        && validTriggerList(value.triggers) && orderedTriggerList(value.triggers);
}
function validConformantCompletionShape(value) {
    return exactKeys(value, [
        "subjectDigest", "profileDigest", "profile", "result", "resultDigest", "evidenceRefs", "completionDigest",
    ])
        && isDigest(value.subjectDigest) && isDigest(value.profileDigest)
        && isRecord(value.profile)
        && validResultBinding(value.result) && isDigest(value.resultDigest)
        && isUniqueArray(value.evidenceRefs, isArtifactRef, true) && isDigest(value.completionDigest);
}
function validEntryShape(value) {
    return exactKeys(value, [
        "sequence", "revision", "eventType", "occurredAtMs", "verifierVersion", "priorProfileDigest",
        "priorResultDigest", "decisionTriggers", "appealResult", "evidenceRefs", "conformantCompletion",
        "prevEntryDigest", "entryDigest",
    ])
        && isPositiveRevision(value.sequence) && isPositiveRevision(value.revision)
        && typeof value.eventType === "string"
        && EXTENSION_ASSURANCE_RETEST_LEDGER_EVENT_TYPES_V1.includes(value.eventType)
        && isTimestamp(value.occurredAtMs)
        && typeof value.verifierVersion === "string"
        && isDigest(value.priorProfileDigest) && isDigest(value.priorResultDigest)
        && validTriggerList(value.decisionTriggers)
        && (value.appealResult === null || validAppealResult(value.appealResult))
        && isUniqueArray(value.evidenceRefs, isArtifactRef, true)
        && (value.conformantCompletion === null || validConformantCompletionShape(value.conformantCompletion))
        && isDigest(value.prevEntryDigest) && isDigest(value.entryDigest);
}
function validLedgerShape(value) {
    return exactKeys(value, [
        "schemaVersion", "ledgerId", "subject", "prior", "decision", "appeal", "state", "revision", "entries", "ledgerDigest",
    ])
        && value.schemaVersion === EXTENSION_ASSURANCE_RETEST_LEDGER_SCHEMA_V1
        && isId(value.ledgerId)
        && validSubject(value.subject)
        && validPrior(value.prior)
        && validDecisionBinding(value.decision)
        && (value.appeal === null || validAppealResult(value.appeal))
        && typeof value.state === "string"
        && EXTENSION_ASSURANCE_RETEST_LEDGER_STATES_V1.includes(value.state)
        && isPositiveRevision(value.revision)
        && Array.isArray(value.entries) && value.entries.length >= 1 && value.entries.length <= 32
        && value.entries.every(validEntryShape)
        && isDigest(value.ledgerDigest);
}
export function extensionAssuranceRetestLedgerResultDigestV1(value) {
    return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
export function extensionAssuranceRetestLedgerCompletionDigestV1(value) {
    const unsigned = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "completionDigest"));
    return createHash("sha256").update(canonicalJson(unsigned)).digest("hex");
}
export function extensionAssuranceRetestLedgerEntryDigestV1(value) {
    const unsigned = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "entryDigest"));
    return createHash("sha256").update(canonicalJson(unsigned)).digest("hex");
}
export function extensionAssuranceRetestLedgerDigestV1(value) {
    const unsigned = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "ledgerDigest"));
    return createHash("sha256").update(canonicalJson(unsigned)).digest("hex");
}
function isPinnedConformantResult(result) {
    return result.outcome === "PROFILE_CONFORMANT"
        && result.publicClaim === "LOCALLY_EVALUATED_SYNTHETIC"
        && result.reasonCodes.length === 1 && result.reasonCodes[0] === "PROFILE_CONFORMANT";
}
function resultOf(reasons) {
    const ordered = REASON_ORDER.filter((reason) => reasons.has(reason));
    if (ordered.length > 0) {
        return {
            schemaVersion: EXTENSION_ASSURANCE_RETEST_LEDGER_RESULT_SCHEMA_V1,
            outcome: "DENIED",
            retestRequired: true,
            reasonCodes: ordered,
            publicClaim: "RETEST_LEDGER_DENIED",
            claimBoundary: EXTENSION_ASSURANCE_RETEST_LEDGER_CLAIM_BOUNDARY_V1,
        };
    }
    return {
        schemaVersion: EXTENSION_ASSURANCE_RETEST_LEDGER_RESULT_SCHEMA_V1,
        outcome: "RETEST_REQUESTED",
        retestRequired: true,
        reasonCodes: ["RETEST_LEDGER_RECORDED"],
        publicClaim: "LOCAL_RETEST_REQUESTED",
        claimBoundary: EXTENSION_ASSURANCE_RETEST_LEDGER_CLAIM_BOUNDARY_V1,
    };
}
export function evaluateExtensionAssuranceRetestLedgerV1(value) {
    if (!validLedgerShape(value)) {
        return {
            schemaVersion: EXTENSION_ASSURANCE_RETEST_LEDGER_RESULT_SCHEMA_V1,
            outcome: "DENIED",
            retestRequired: true,
            reasonCodes: ["SCHEMA_DENIED"],
            publicClaim: "RETEST_LEDGER_DENIED",
            claimBoundary: EXTENSION_ASSURANCE_RETEST_LEDGER_CLAIM_BOUNDARY_V1,
        };
    }
    const ledger = value;
    const reasons = new Set();
    if (extensionAssuranceRetestLedgerDigestV1(ledger) !== ledger.ledgerDigest) {
        reasons.add("DIGEST_MISMATCH_DENIED");
    }
    if (extensionAssuranceRetestLedgerResultDigestV1(ledger.prior.result)
        !== ledger.prior.resultDigest) {
        reasons.add("PRIOR_BINDING_DENIED");
    }
    if (ledger.prior.evidenceRefs.length === 0) {
        reasons.add("EVIDENCE_BINDING_DENIED");
    }
    let previousEntryDigest = EXTENSION_ASSURANCE_RETEST_LEDGER_GENESIS_DIGEST_V1;
    let previousOccurredAtMs = null;
    let previousState = null;
    let sawTerminalState = false;
    ledger.entries.forEach((entry, index) => {
        if (sawTerminalState) {
            reasons.add("STATE_TRANSITION_DENIED");
        }
        if (extensionAssuranceRetestLedgerEntryDigestV1(entry) !== entry.entryDigest) {
            reasons.add("DIGEST_MISMATCH_DENIED");
        }
        if (entry.sequence !== index + 1 || entry.revision !== index + 1) {
            reasons.add("REVISION_SEQUENCE_DENIED");
        }
        if (entry.prevEntryDigest !== previousEntryDigest) {
            reasons.add("REVISION_SEQUENCE_DENIED");
        }
        if (previousOccurredAtMs !== null && entry.occurredAtMs < previousOccurredAtMs) {
            reasons.add("REVISION_SEQUENCE_DENIED");
        }
        if (entry.priorProfileDigest !== ledger.prior.profileDigest
            || entry.priorResultDigest !== ledger.prior.resultDigest) {
            reasons.add("PRIOR_BINDING_DENIED");
        }
        if (canonicalJson(entry.decisionTriggers) !== canonicalJson(ledger.decision.triggers)) {
            reasons.add("DECISION_TRIGGER_MISMATCH_DENIED");
        }
        if (canonicalJson(entry.appealResult) !== canonicalJson(ledger.appeal)) {
            reasons.add("APPEAL_BINDING_DENIED");
        }
        if (entry.evidenceRefs.length === 0) {
            reasons.add("EVIDENCE_BINDING_DENIED");
        }
        if (entry.verifierVersion !== EXTENSION_ASSURANCE_RETEST_LEDGER_VERIFIER_VERSION_V1) {
            reasons.add("VERIFIER_VERSION_DENIED");
        }
        const allowed = previousState === null
            ? entry.eventType === "RETEST_REQUESTED"
            : ALLOWED_PREVIOUS_STATES[entry.eventType].includes(previousState);
        if (!allowed) {
            reasons.add("STATE_TRANSITION_DENIED");
        }
        if (entry.eventType === "RETEST_COMPLETED") {
            const completion = entry.conformantCompletion;
            if (completion === null) {
                reasons.add("CONFORMANT_EVIDENCE_DENIED");
            }
            else {
                const evaluatedProfileResult = evaluateExtensionAssuranceProfileV1(completion.profile);
                const profileDigest = evaluatedProfileResult.outcome === "PROFILE_CONFORMANT"
                    ? extensionAssuranceProfileDigestV1(completion.profile)
                    : null;
                if (extensionAssuranceRetestLedgerCompletionDigestV1(completion) !== completion.completionDigest) {
                    reasons.add("DIGEST_MISMATCH_DENIED");
                }
                if (evaluatedProfileResult.outcome !== "PROFILE_CONFORMANT"
                    || canonicalJson(completion.profile.subject) !== canonicalJson(ledger.subject)
                    || completion.subjectDigest !== ledger.subject.subjectDigest
                    || completion.subjectDigest !== completion.profile.subject.subjectDigest
                    || completion.profileDigest !== completion.profile.profileDigest
                    || completion.profileDigest !== profileDigest
                    || canonicalJson(completion.result) !== canonicalJson(evaluatedProfileResult)
                    || canonicalJson(completion.evidenceRefs) !== canonicalJson(completion.profile.evidence.artifactRefs)) {
                    reasons.add("CONFORMANT_EVIDENCE_DENIED");
                }
                if (completion.profileDigest === ledger.prior.profileDigest) {
                    reasons.add("CONFORMANT_EVIDENCE_DENIED");
                }
                if (extensionAssuranceRetestLedgerResultDigestV1(completion.result)
                    !== completion.resultDigest) {
                    reasons.add("DIGEST_MISMATCH_DENIED");
                }
                if (!isPinnedConformantResult(completion.result)) {
                    reasons.add("CONFORMANT_EVIDENCE_DENIED");
                }
                if (completion.evidenceRefs.length === 0) {
                    reasons.add("CONFORMANT_EVIDENCE_DENIED");
                }
                else {
                    const priorEvidence = new Set(ledger.prior.evidenceRefs);
                    if (completion.evidenceRefs.some((item) => priorEvidence.has(item))) {
                        reasons.add("CONFORMANT_EVIDENCE_DENIED");
                    }
                }
            }
        }
        else if (entry.conformantCompletion !== null) {
            reasons.add("STATE_TRANSITION_DENIED");
        }
        previousEntryDigest = entry.entryDigest;
        previousOccurredAtMs = entry.occurredAtMs;
        const stateAfter = EVENT_STATE[entry.eventType];
        previousState = stateAfter;
        if (stateAfter === "RETEST_CONFORMANT" || stateAfter === "RETEST_DENIED") {
            sawTerminalState = true;
        }
    });
    if (ledger.revision !== ledger.entries.length) {
        reasons.add("REVISION_SEQUENCE_DENIED");
    }
    const terminalEntry = ledger.entries[ledger.entries.length - 1];
    if (terminalEntry !== undefined && EVENT_STATE[terminalEntry.eventType] !== ledger.state) {
        reasons.add("STATE_TRANSITION_DENIED");
    }
    if (reasons.size > 0)
        return resultOf(reasons);
    if (terminalEntry?.eventType === "RETEST_COMPLETED") {
        return {
            schemaVersion: EXTENSION_ASSURANCE_RETEST_LEDGER_RESULT_SCHEMA_V1,
            outcome: "RETEST_CONFORMANT",
            retestRequired: false,
            reasonCodes: ["RETEST_LEDGER_RECORDED"],
            publicClaim: "LOCAL_RETEST_CONFORMANT",
            claimBoundary: EXTENSION_ASSURANCE_RETEST_LEDGER_CLAIM_BOUNDARY_V1,
        };
    }
    if (terminalEntry?.eventType === "RETEST_DENIED") {
        return {
            schemaVersion: EXTENSION_ASSURANCE_RETEST_LEDGER_RESULT_SCHEMA_V1,
            outcome: "RETEST_DENIED",
            retestRequired: true,
            reasonCodes: ["RETEST_LEDGER_RECORDED"],
            publicClaim: "LOCAL_RETEST_DENIED",
            claimBoundary: EXTENSION_ASSURANCE_RETEST_LEDGER_CLAIM_BOUNDARY_V1,
        };
    }
    return {
        schemaVersion: EXTENSION_ASSURANCE_RETEST_LEDGER_RESULT_SCHEMA_V1,
        outcome: "RETEST_REQUESTED",
        retestRequired: true,
        reasonCodes: ["RETEST_LEDGER_RECORDED"],
        publicClaim: "LOCAL_RETEST_REQUESTED",
        claimBoundary: EXTENSION_ASSURANCE_RETEST_LEDGER_CLAIM_BOUNDARY_V1,
    };
}
export function projectExtensionAssuranceRetestLedgerV1(value) {
    const result = evaluateExtensionAssuranceRetestLedgerV1(value);
    let steps = [];
    if (result.outcome !== "DENIED") {
        const ledger = value;
        steps = ledger.entries.map((entry) => ({
            sequence: entry.sequence,
            eventType: entry.eventType,
            stateAfter: EVENT_STATE[entry.eventType],
            triggers: [...entry.decisionTriggers],
        }));
    }
    return {
        schemaVersion: EXTENSION_ASSURANCE_RETEST_LEDGER_PROJECTION_SCHEMA_V1,
        outcome: result.outcome,
        retestRequired: result.retestRequired,
        steps: Object.freeze(steps),
    };
}
export function renderExtensionAssuranceRetestLedgerResultV1(value) {
    return canonicalJson(evaluateExtensionAssuranceRetestLedgerV1(value));
}
export function renderExtensionAssuranceRetestLedgerProjectionV1(value) {
    return canonicalJson(projectExtensionAssuranceRetestLedgerV1(value));
}
