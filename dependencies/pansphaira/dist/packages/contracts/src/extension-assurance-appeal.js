import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import { EXTENSION_ASSURANCE_CLAIM_BOUNDARY_V1, EXTENSION_ASSURANCE_RESULT_SCHEMA_V1, } from "./extension-assurance-profile.js";
export const EXTENSION_ASSURANCE_APPEAL_SCHEMA_V1 = "chimpmaera.extension-trust/assurance-appeal/v1";
export const EXTENSION_ASSURANCE_APPEAL_RESULT_SCHEMA_V1 = "chimpmaera.extension-trust/assurance-appeal-result/v1";
export const EXTENSION_ASSURANCE_APPEAL_CLAIM_BOUNDARY_V1 = "LOCAL_APPEAL_RECORD_ONLY_NO_TRUST_NO_ADMISSION_NO_ACTIVATION_NO_MARKETPLACE";
export const EXTENSION_ASSURANCE_APPEAL_GENESIS_DIGEST_V1 = "0000000000000000000000000000000000000000000000000000000000000000";
export const EXTENSION_ASSURANCE_APPEAL_EVENT_TYPES_V1 = [
    "APPEAL_OPENED",
    "EVIDENCE_SUBMITTED",
    "FALSE_POSITIVE_CONFIRMED",
    "FALSE_NEGATIVE_CONFIRMED",
    "APPEAL_REJECTED",
    "SUPERSEDED",
];
export const EXTENSION_ASSURANCE_APPEAL_STATES_V1 = [
    "OPEN",
    "CONFIRMED_FALSE_POSITIVE",
    "CONFIRMED_FALSE_NEGATIVE",
    "REJECTED",
    "SUPERSEDED",
];
const EVENT_STATE = {
    APPEAL_OPENED: "OPEN",
    EVIDENCE_SUBMITTED: "OPEN",
    FALSE_POSITIVE_CONFIRMED: "CONFIRMED_FALSE_POSITIVE",
    FALSE_NEGATIVE_CONFIRMED: "CONFIRMED_FALSE_NEGATIVE",
    APPEAL_REJECTED: "REJECTED",
    SUPERSEDED: "SUPERSEDED",
};
const PRIOR_RESULT_OUTCOMES = ["PROFILE_CONFORMANT", "DENIED", "RETEST_REQUIRED"];
const PRIOR_RESULT_CLAIMS = [
    "LOCALLY_EVALUATED_SYNTHETIC", "ASSURANCE_DENIED", "EVIDENCE_EXPIRED_RETEST_REQUIRED", "INCONCLUSIVE",
];
const PRIOR_RESULT_REASONS = [
    "PROFILE_CONFORMANT", "SCHEMA_DENIED", "DIGEST_MISMATCH_DENIED", "UNIVERSAL_GATE_MISSING_DENIED",
    "REQUIRED_CHECK_NOT_RUN_DENIED", "HARD_FAIL_DENIED", "SECURITY_ROUTING_DENIED", "RETEST_CONTRACT_DENIED",
    "EVIDENCE_MISMATCH_RETEST_REQUIRED", "EVIDENCE_STALE_RETEST_REQUIRED", "FALSE_NEGATIVE_RETEST_REQUIRED",
];
const REASON_ORDER = [
    "SCHEMA_DENIED",
    "DIGEST_MISMATCH_DENIED",
    "PRIOR_RESULT_BINDING_DENIED",
    "EVIDENCE_BINDING_DENIED",
    "REVISION_MONOTONICITY_DENIED",
    "REPLAY_OR_GAP_DENIED",
    "STATE_TRANSITION_DENIED",
    "FALSE_NEGATIVE_RETEST_REQUIRED",
];
const DENIAL_REASONS = new Set(REASON_ORDER.filter((reason) => reason !== "APPEAL_RECORDED" && reason !== "FALSE_NEGATIVE_RETEST_REQUIRED"));
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
function isRevision(value) {
    return Number.isSafeInteger(value) && value >= 1;
}
function isUniqueArray(value, predicate, allowEmpty = false) {
    return Array.isArray(value) && (allowEmpty || value.length > 0) && value.every(predicate)
        && new Set(value).size === value.length;
}
function isEventType(value) {
    return typeof value === "string"
        && EXTENSION_ASSURANCE_APPEAL_EVENT_TYPES_V1.includes(value);
}
function isState(value) {
    return typeof value === "string"
        && EXTENSION_ASSURANCE_APPEAL_STATES_V1.includes(value);
}
function validSubject(value) {
    return exactKeys(value, ["kind", "subjectId", "subjectVersion", "subjectDigest"])
        && ["EXTENSION", "CONNECTOR"].includes(value.kind)
        && isId(value.subjectId) && typeof value.subjectVersion === "string"
        && /^\d+\.\d+\.\d+$/.test(value.subjectVersion) && isDigest(value.subjectDigest);
}
function validPriorResultObject(value) {
    return exactKeys(value, ["schemaVersion", "outcome", "reasonCodes", "publicClaim", "claimBoundary"])
        && value.schemaVersion === EXTENSION_ASSURANCE_RESULT_SCHEMA_V1
        && PRIOR_RESULT_OUTCOMES.includes(value.outcome)
        && Array.isArray(value.reasonCodes) && value.reasonCodes.length >= 1 && value.reasonCodes.length <= 16
        && value.reasonCodes.every((item) => typeof item === "string" && PRIOR_RESULT_REASONS.includes(item))
        && new Set(value.reasonCodes).size === value.reasonCodes.length
        && PRIOR_RESULT_CLAIMS.includes(value.publicClaim)
        && value.claimBoundary === EXTENSION_ASSURANCE_CLAIM_BOUNDARY_V1;
}
function validPriorResult(value) {
    return exactKeys(value, ["profileId", "profileDigest", "result", "resultDigest"])
        && isId(value.profileId) && isDigest(value.profileDigest)
        && validPriorResultObject(value.result) && isDigest(value.resultDigest);
}
function validEventShape(value) {
    return exactKeys(value, ["sequence", "eventType", "occurredAtMs", "priorResultDigest", "evidenceRefs", "prevEventDigest", "eventDigest"])
        && Number.isSafeInteger(value.sequence) && value.sequence >= 1
        && isEventType(value.eventType) && isTimestamp(value.occurredAtMs)
        && isDigest(value.priorResultDigest) && isUniqueArray(value.evidenceRefs, isArtifactRef, true)
        && isDigest(value.prevEventDigest) && isDigest(value.eventDigest);
}
function validRecord(value) {
    return exactKeys(value, ["schemaVersion", "appealId", "subject", "priorResult", "state", "revision", "events", "appealDigest"])
        && value.schemaVersion === EXTENSION_ASSURANCE_APPEAL_SCHEMA_V1 && isId(value.appealId)
        && validSubject(value.subject) && validPriorResult(value.priorResult)
        && isState(value.state) && isRevision(value.revision)
        && Array.isArray(value.events) && value.events.length >= 1 && value.events.length <= 32
        && value.events.every(validEventShape)
        && isDigest(value.appealDigest);
}
export function extensionAssuranceAppealPriorResultDigestV1(result) {
    return createHash("sha256").update(canonicalJson(result)).digest("hex");
}
export function extensionAssuranceAppealEventDigestV1(event) {
    const unsigned = Object.fromEntries(Object.entries(event).filter(([key]) => key !== "eventDigest"));
    return createHash("sha256").update(canonicalJson(unsigned)).digest("hex");
}
export function extensionAssuranceAppealDigestV1(value) {
    const unsigned = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "appealDigest"));
    return createHash("sha256").update(canonicalJson(unsigned)).digest("hex");
}
export function evaluateExtensionAssuranceAppealRecordV1(value) {
    if (!validRecord(value)) {
        return {
            schemaVersion: EXTENSION_ASSURANCE_APPEAL_RESULT_SCHEMA_V1,
            outcome: "DENIED",
            reasonCodes: ["SCHEMA_DENIED"],
            publicClaim: "INCONCLUSIVE",
            claimBoundary: EXTENSION_ASSURANCE_APPEAL_CLAIM_BOUNDARY_V1,
        };
    }
    const reasons = new Set();
    if (extensionAssuranceAppealDigestV1(value) !== value.appealDigest) {
        reasons.add("DIGEST_MISMATCH_DENIED");
    }
    if (extensionAssuranceAppealPriorResultDigestV1(value.priorResult.result)
        !== value.priorResult.resultDigest) {
        reasons.add("PRIOR_RESULT_BINDING_DENIED");
    }
    const events = value.events;
    let sawTerminalEvent = false;
    events.forEach((event, index) => {
        if (sawTerminalEvent) {
            reasons.add("STATE_TRANSITION_DENIED");
        }
        if (extensionAssuranceAppealEventDigestV1(event) !== event.eventDigest) {
            reasons.add("DIGEST_MISMATCH_DENIED");
        }
        if (event.priorResultDigest !== value.priorResult.resultDigest) {
            reasons.add("PRIOR_RESULT_BINDING_DENIED");
        }
        if (event.evidenceRefs.length === 0) {
            reasons.add("EVIDENCE_BINDING_DENIED");
        }
        if (event.sequence !== index + 1) {
            reasons.add("REPLAY_OR_GAP_DENIED");
        }
        const expectedPrev = index === 0
            ? EXTENSION_ASSURANCE_APPEAL_GENESIS_DIGEST_V1
            : events[index - 1]?.eventDigest ?? EXTENSION_ASSURANCE_APPEAL_GENESIS_DIGEST_V1;
        if (event.prevEventDigest !== expectedPrev) {
            reasons.add("REPLAY_OR_GAP_DENIED");
        }
        if (EVENT_STATE[event.eventType] !== "OPEN") {
            sawTerminalEvent = true;
        }
    });
    if (value.revision !== events.length) {
        reasons.add("REVISION_MONOTONICITY_DENIED");
    }
    if (events[0]?.eventType !== "APPEAL_OPENED") {
        reasons.add("STATE_TRANSITION_DENIED");
    }
    const terminalEvent = events[events.length - 1];
    if (terminalEvent !== undefined && EVENT_STATE[terminalEvent.eventType] !== value.state) {
        reasons.add("STATE_TRANSITION_DENIED");
    }
    if (value.state === "CONFIRMED_FALSE_NEGATIVE") {
        reasons.add("FALSE_NEGATIVE_RETEST_REQUIRED");
    }
    const ordered = REASON_ORDER.filter((reason) => reasons.has(reason));
    if (ordered.some((reason) => DENIAL_REASONS.has(reason))) {
        return {
            schemaVersion: EXTENSION_ASSURANCE_APPEAL_RESULT_SCHEMA_V1,
            outcome: "DENIED",
            reasonCodes: ordered,
            publicClaim: "APPEAL_DENIED",
            claimBoundary: EXTENSION_ASSURANCE_APPEAL_CLAIM_BOUNDARY_V1,
        };
    }
    if (ordered.length > 0) {
        return {
            schemaVersion: EXTENSION_ASSURANCE_APPEAL_RESULT_SCHEMA_V1,
            outcome: "RETEST_REQUIRED",
            reasonCodes: ordered,
            publicClaim: "FALSE_NEGATIVE_RETEST_REQUIRED",
            claimBoundary: EXTENSION_ASSURANCE_APPEAL_CLAIM_BOUNDARY_V1,
        };
    }
    return {
        schemaVersion: EXTENSION_ASSURANCE_APPEAL_RESULT_SCHEMA_V1,
        outcome: "APPEAL_RECORDED",
        reasonCodes: ["APPEAL_RECORDED"],
        publicClaim: "LOCAL_APPEAL_RECORDED",
        claimBoundary: EXTENSION_ASSURANCE_APPEAL_CLAIM_BOUNDARY_V1,
    };
}
export function renderPublicExtensionAssuranceAppealResultV1(value) {
    return canonicalJson(evaluateExtensionAssuranceAppealRecordV1(value));
}
