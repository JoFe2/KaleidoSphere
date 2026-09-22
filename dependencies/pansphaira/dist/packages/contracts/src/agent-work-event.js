import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
export const AGENT_WORK_EVENT_SCHEMA_V1 = "chimpmaera.agent-work-intelligence/event-record/v1";
export const AGENT_WORK_EVENT_RESULT_SCHEMA_V1 = "chimpmaera.agent-work-intelligence/event-decision/v1";
export const AGENT_WORK_EVENT_CLAIM_BOUNDARY_V1 = "DECLARATIVE_AGENT_WORK_EVENT_CONTRACT_ONLY_NO_COLLECTION_NO_TELEMETRY_NO_TRAINING_NO_PRODUCTION_INGESTION";
export const AGENT_WORK_EVENT_PROHIBITED_FIELDS_V1 = [
    "command", "content", "credential", "email", "hostname", "ipAddress", "jobId", "message",
    "path", "prompt", "response", "secret", "sessionId", "tenantId", "token", "userId",
];
export const AGENT_WORK_EVENT_FIELD_CLASSIFICATIONS_V1 = [
    ["/schemaVersion", "PUBLIC_FIXED"],
    ["/recordId", "PSEUDONYMOUS"],
    ["/lifecycle/state", "POLICY"],
    ["/lifecycle/policy", "POLICY"],
    ["/lifecycle/retainUntilMs", "POLICY"],
    ["/lifecycle/deletionRequestedAtMs", "POLICY"],
    ["/lifecycle/deleteByMs", "POLICY"],
    ["/lifecycle/deletedAtMs", "POLICY"],
    ["/payload/actorPseudonym", "PSEUDONYMOUS"],
    ["/payload/harnessPseudonym", "PSEUDONYMOUS"],
    ["/payload/source/kind", "PUBLIC_FIXED"],
    ["/payload/source/classification", "POLICY"],
    ["/payload/source/digest", "SENSITIVE_DIGEST"],
    ["/payload/event/kind", "PUBLIC_FIXED"],
    ["/payload/event/occurredAtMs", "POLICY"],
    ["/payload/event/outcome", "PUBLIC_FIXED"],
    ["/payload/event/reasonCodes", "PUBLIC_FIXED"],
    ["/payload/event/evidenceDigests", "SENSITIVE_DIGEST"],
    ["/payload/consent/basis", "POLICY"],
    ["/payload/consent/status", "POLICY"],
    ["/payload/consent/purposes", "POLICY"],
    ["/payload/consent/grantedAtMs", "POLICY"],
    ["/payload/consent/expiresAtMs", "POLICY"],
    ["/payload/consent/proofDigest", "SENSITIVE_DIGEST"],
    ["/payload/readback/visibility", "POLICY"],
    ["/tombstone/erasureDigest", "SENSITIVE_DIGEST"],
    ["/tombstone/reason", "PUBLIC_FIXED"],
    ["/claimBoundary", "PUBLIC_FIXED"],
    ["/recordDigest", "SENSITIVE_DIGEST"],
];
const RETENTION_LIMIT_MS = {
    EPHEMERAL_24H: 86_400_000,
    BOUNDED_30D: 2_592_000_000,
    BOUNDED_90D: 7_776_000_000,
};
const DELETION_SLA_MS = 604_800_000;
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, keys) {
    return isRecord(value) && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}
function isTimestamp(value) {
    return Number.isSafeInteger(value) && value >= 0;
}
function isDigest(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function isPseudonym(value) {
    return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}
function uniqueClosedArray(value, allowed, allowEmpty = false) {
    return Array.isArray(value) && (allowEmpty || value.length > 0)
        && value.every((item) => typeof item === "string" && allowed.includes(item))
        && new Set(value).size === value.length;
}
function uniqueDigests(value) {
    return Array.isArray(value) && value.length <= 16 && value.every(isDigest) && new Set(value).size === value.length;
}
function normalizedKey(value) {
    return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}
function containsProhibitedField(value) {
    if (Array.isArray(value))
        return value.some(containsProhibitedField);
    if (!isRecord(value))
        return false;
    const prohibited = new Set(AGENT_WORK_EVENT_PROHIBITED_FIELDS_V1.map(normalizedKey));
    return Object.entries(value).some(([key, nested]) => prohibited.has(normalizedKey(key)) || containsProhibitedField(nested));
}
function validLifecycle(value) {
    return exactKeys(value, ["state", "policy", "retainUntilMs", "deletionRequestedAtMs", "deleteByMs", "deletedAtMs"])
        && ["ACTIVE", "DELETION_REQUESTED", "DELETED_TOMBSTONE"].includes(value.state)
        && ["EPHEMERAL_24H", "BOUNDED_30D", "BOUNDED_90D"].includes(value.policy)
        && isTimestamp(value.retainUntilMs)
        && (value.deletionRequestedAtMs === null || isTimestamp(value.deletionRequestedAtMs))
        && (value.deleteByMs === null || isTimestamp(value.deleteByMs))
        && (value.deletedAtMs === null || isTimestamp(value.deletedAtMs));
}
function validSource(value) {
    return exactKeys(value, ["kind", "classification", "digest"])
        && ["SYNTHETIC_FIXTURE", "REPOSITORY_DERIVATION", "TOOL_RECEIPT"].includes(value.kind)
        && ["PUBLIC_SYNTHETIC", "OWNER_PRIVATE_DERIVED"].includes(value.classification)
        && isDigest(value.digest);
}
function validEvent(value) {
    return exactKeys(value, ["kind", "occurredAtMs", "outcome", "reasonCodes", "evidenceDigests"])
        && ["PLAN", "CHANGE", "TEST", "REVIEW", "RELEASE", "ROLLBACK"].includes(value.kind)
        && isTimestamp(value.occurredAtMs) && ["SUCCEEDED", "FAILED", "DENIED"].includes(value.outcome)
        && uniqueClosedArray(value.reasonCodes, ["CHANGE_ACCEPTED", "TEST_PASSED", "POLICY_DENIED", "ROLLBACK_CONFIRMED"])
        && uniqueDigests(value.evidenceDigests);
}
function validConsent(value) {
    return exactKeys(value, ["basis", "status", "purposes", "grantedAtMs", "expiresAtMs", "proofDigest"])
        && ["SYNTHETIC_FIXTURE", "EXPLICIT_OPT_IN", "OWNER_AUTHORIZED_OPERATION"].includes(value.basis)
        && ["GRANTED", "WITHDRAWN"].includes(value.status)
        && uniqueClosedArray(value.purposes, ["PROCESS_IMPROVEMENT", "KNOWLEDGE_REUSE", "ASSURANCE", "PUBLIC_REPRODUCIBILITY"])
        && isTimestamp(value.grantedAtMs) && isTimestamp(value.expiresAtMs) && isDigest(value.proofDigest);
}
function validPayload(value) {
    return exactKeys(value, ["actorPseudonym", "harnessPseudonym", "source", "event", "consent", "readback"])
        && isPseudonym(value.actorPseudonym) && isPseudonym(value.harnessPseudonym)
        && validSource(value.source) && validEvent(value.event) && validConsent(value.consent)
        && exactKeys(value.readback, ["visibility"])
        && ["OWNER_ONLY", "PUBLIC_SYNTHETIC"].includes(value.readback.visibility);
}
function validTombstone(value) {
    return exactKeys(value, ["erasureDigest", "reason"]) && isDigest(value.erasureDigest)
        && ["RETENTION_EXPIRED", "CONSENT_WITHDRAWN", "OWNER_REQUEST"].includes(value.reason);
}
function validRecord(value) {
    if (!exactKeys(value, ["schemaVersion", "recordId", "lifecycle", "payload", "tombstone", "claimBoundary", "recordDigest"]))
        return false;
    if (value.schemaVersion !== AGENT_WORK_EVENT_SCHEMA_V1
        || typeof value.recordId !== "string" || !/^awi-record:[a-z0-9][a-z0-9-]{7,63}$/.test(value.recordId)
        || !validLifecycle(value.lifecycle) || !isDigest(value.recordDigest)
        || value.claimBoundary !== AGENT_WORK_EVENT_CLAIM_BOUNDARY_V1)
        return false;
    if (value.lifecycle.state === "ACTIVE") {
        return validPayload(value.payload) && value.tombstone === null
            && value.lifecycle.deletionRequestedAtMs === null && value.lifecycle.deleteByMs === null
            && value.lifecycle.deletedAtMs === null;
    }
    if (value.lifecycle.state === "DELETION_REQUESTED") {
        return validPayload(value.payload) && value.tombstone === null
            && isTimestamp(value.lifecycle.deletionRequestedAtMs) && isTimestamp(value.lifecycle.deleteByMs)
            && value.lifecycle.deletedAtMs === null;
    }
    return value.payload === null && validTombstone(value.tombstone)
        && isTimestamp(value.lifecycle.deletionRequestedAtMs) && isTimestamp(value.lifecycle.deleteByMs)
        && isTimestamp(value.lifecycle.deletedAtMs);
}
function decision(outcome, reasonCodes) {
    return { schemaVersion: AGENT_WORK_EVENT_RESULT_SCHEMA_V1, outcome, reasonCodes, claimBoundary: AGENT_WORK_EVENT_CLAIM_BOUNDARY_V1 };
}
export function agentWorkEventRecordDigestV1(value) {
    const unsigned = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "recordDigest"));
    return createHash("sha256").update(canonicalJson(unsigned)).digest("hex");
}
export function evaluateAgentWorkEventV1(value, operation, evaluatedAtMs) {
    if (containsProhibitedField(value))
        return decision("DENIED", ["PROHIBITED_FIELD_DENIED"]);
    if (!validRecord(value) || !["VALIDATE", "OWNER_READBACK", "PUBLIC_READBACK", "DELETE_PREVIEW"].includes(operation)
        || !isTimestamp(evaluatedAtMs))
        return decision("DENIED", ["SCHEMA_DENIED"]);
    if (agentWorkEventRecordDigestV1(value) !== value.recordDigest) {
        return decision("DENIED", ["DIGEST_MISMATCH_DENIED"]);
    }
    const lifecycle = value.lifecycle;
    if (lifecycle.deletionRequestedAtMs !== null && lifecycle.deleteByMs !== null
        && (lifecycle.deleteByMs < lifecycle.deletionRequestedAtMs
            || lifecycle.deleteByMs - lifecycle.deletionRequestedAtMs > DELETION_SLA_MS)) {
        return decision("DENIED", ["RETENTION_POLICY_DENIED"]);
    }
    if (lifecycle.state === "DELETED_TOMBSTONE") {
        if (lifecycle.deletedAtMs < lifecycle.deletionRequestedAtMs
            || lifecycle.deletedAtMs > evaluatedAtMs)
            return decision("DENIED", ["RETENTION_POLICY_DENIED"]);
        return operation === "OWNER_READBACK" || operation === "PUBLIC_READBACK"
            ? decision("DENIED", ["DELETED_RECORD_DENIED"])
            : decision("TOMBSTONE_CONFIRMED", ["TOMBSTONE_CONFIRMED"]);
    }
    const payload = value.payload;
    const consent = payload.consent;
    if (consent.expiresAtMs <= consent.grantedAtMs || payload.event.occurredAtMs < consent.grantedAtMs
        || lifecycle.retainUntilMs < payload.event.occurredAtMs
        || lifecycle.retainUntilMs > consent.expiresAtMs
        || lifecycle.retainUntilMs - payload.event.occurredAtMs > RETENTION_LIMIT_MS[lifecycle.policy]) {
        return decision("DENIED", ["RETENTION_POLICY_DENIED"]);
    }
    if (consent.status === "WITHDRAWN")
        return decision("DELETE_REQUIRED", ["CONSENT_WITHDRAWN_DELETE_REQUIRED"]);
    if (payload.event.occurredAtMs > consent.expiresAtMs || evaluatedAtMs > consent.expiresAtMs) {
        return decision("DENIED", ["CONSENT_EXPIRED_DENIED"]);
    }
    if (consent.purposes.length === 0)
        return decision("DENIED", ["CONSENT_DENIED"]);
    if (payload.source.classification === "PUBLIC_SYNTHETIC"
        && (payload.source.kind !== "SYNTHETIC_FIXTURE" || consent.basis !== "SYNTHETIC_FIXTURE"
            || !consent.purposes.includes("PUBLIC_REPRODUCIBILITY") || payload.readback.visibility !== "PUBLIC_SYNTHETIC")) {
        return decision("DENIED", ["PUBLIC_FIXTURE_POLICY_DENIED"]);
    }
    if (operation === "PUBLIC_READBACK"
        && (payload.source.classification !== "PUBLIC_SYNTHETIC" || payload.readback.visibility !== "PUBLIC_SYNTHETIC")) {
        return decision("DENIED", ["READBACK_SCOPE_DENIED"]);
    }
    if (lifecycle.state === "DELETION_REQUESTED")
        return decision("DELETE_REQUIRED", ["DELETION_REQUESTED"]);
    if (operation === "DELETE_PREVIEW")
        return decision("DENIED", ["DELETE_NOT_REQUESTED_DENIED"]);
    if (evaluatedAtMs > lifecycle.retainUntilMs)
        return decision("DELETE_REQUIRED", ["RETENTION_EXPIRED_DELETE_REQUIRED"]);
    return decision("ACCEPTED", ["RECORD_CONFORMANT"]);
}
export function renderPublicAgentWorkEventDecisionV1(value, evaluatedAtMs) {
    return canonicalJson(evaluateAgentWorkEventV1(value, "PUBLIC_READBACK", evaluatedAtMs));
}
