import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
export const AGENT_WORK_PROCESS_INPUT_SCHEMA_V1 = "chimpmaera.agent-work-intelligence/process-input/v1";
export const AGENT_WORK_PROCESS_INPUT_DECISION_SCHEMA_V1 = "chimpmaera.agent-work-intelligence/process-input-decision/v1";
export const AGENT_WORK_PROCESS_INPUT_CLAIM_BOUNDARY_V1 = "DECLARATIVE_SYNTHETIC_INPUT_ONLY_NO_PROCESS_MINING_NO_METRICS_NO_TRACE_ANALYSIS_NO_COLLECTION_NO_TELEMETRY_NO_MONITORING_NO_PRODUCTION_INGESTION";
export const AGENT_WORK_PROCESS_INPUT_PROHIBITED_FIELDS_V1 = [
    "actorIdentity", "command", "content", "credential", "email", "filePath", "hostname",
    "identity", "ipAddress", "jobId", "message", "path", "prompt", "rawEvent", "rawPayload",
    "rawText", "response", "secret", "sessionId", "tenantId", "token", "userId",
];
const PHASES = ["PLAN", "CHANGE", "TEST", "REVIEW", "RELEASE", "ROLLBACK"];
const OUTCOMES = ["SUCCEEDED", "FAILED", "DENIED"];
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, keys) {
    return isRecord(value) && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}
function isDigest(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function isEventId(value) {
    return typeof value === "string" && /^awi-evt:[a-z0-9][a-z0-9-]{7,63}$/.test(value);
}
function isGenerationId(value) {
    return typeof value === "string" && /^awi-gen:[a-z0-9][a-z0-9-]{7,63}$/.test(value);
}
function normalizedKey(value) {
    return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}
function containsProhibitedField(value) {
    if (Array.isArray(value))
        return value.some(containsProhibitedField);
    if (!isRecord(value))
        return false;
    const prohibited = new Set(AGENT_WORK_PROCESS_INPUT_PROHIBITED_FIELDS_V1.map(normalizedKey));
    return Object.entries(value).some(([key, nested]) => prohibited.has(normalizedKey(key)) || containsProhibitedField(nested));
}
function validEvent(value) {
    return exactKeys(value, ["eventId", "phase", "outcome", "occurredAtMs", "causeEventIds", "evidenceDigests"])
        && isEventId(value.eventId)
        && PHASES.includes(value.phase)
        && OUTCOMES.includes(value.outcome)
        && Number.isSafeInteger(value.occurredAtMs) && value.occurredAtMs >= 0
        && Array.isArray(value.causeEventIds) && value.causeEventIds.length <= 64
        && value.causeEventIds.every(isEventId)
        && new Set(value.causeEventIds).size === value.causeEventIds.length
        && Array.isArray(value.evidenceDigests) && value.evidenceDigests.length <= 16
        && value.evidenceDigests.every(isDigest)
        && new Set(value.evidenceDigests).size === value.evidenceDigests.length;
}
function validInput(value) {
    return exactKeys(value, ["schemaVersion", "generation", "events", "claimBoundary", "inputDigest"])
        && value.schemaVersion === AGENT_WORK_PROCESS_INPUT_SCHEMA_V1
        && exactKeys(value.generation, ["generationId", "generationDigest", "lkgGenerationDigest"])
        && isGenerationId(value.generation.generationId)
        && isDigest(value.generation.generationDigest)
        && isDigest(value.generation.lkgGenerationDigest)
        && Array.isArray(value.events) && value.events.length > 0 && value.events.length <= 256
        && value.events.every(validEvent)
        && value.claimBoundary === AGENT_WORK_PROCESS_INPUT_CLAIM_BOUNDARY_V1
        && isDigest(value.inputDigest);
}
function decision(outcome, reasonCodes) {
    return {
        schemaVersion: AGENT_WORK_PROCESS_INPUT_DECISION_SCHEMA_V1,
        outcome,
        reasonCodes,
        claimBoundary: AGENT_WORK_PROCESS_INPUT_CLAIM_BOUNDARY_V1,
    };
}
export function agentWorkProcessInputCanonicalEventsV1(value) {
    const events = [...value.events]
        .sort((a, b) => a.eventId.localeCompare(b.eventId))
        .map((event) => ({
        causeEventIds: [...event.causeEventIds].sort(),
        eventId: event.eventId,
        evidenceDigests: [...event.evidenceDigests].sort(),
        occurredAtMs: event.occurredAtMs,
        outcome: event.outcome,
        phase: event.phase,
    }));
    return canonicalJson({ events });
}
export function agentWorkProcessInputGenerationDigestV1(value) {
    return createHash("sha256").update(agentWorkProcessInputCanonicalEventsV1(value)).digest("hex");
}
export function agentWorkProcessInputDigestV1(value) {
    const unsigned = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "inputDigest"));
    return createHash("sha256").update(canonicalJson(unsigned)).digest("hex");
}
export function evaluateAgentWorkProcessInputV1(value) {
    if (containsProhibitedField(value))
        return decision("DENIED", ["PROHIBITED_FIELD_DENIED"]);
    if (!validInput(value))
        return decision("DENIED", ["SCHEMA_DENIED"]);
    if (agentWorkProcessInputDigestV1(value) !== value.inputDigest) {
        return decision("DENIED", ["DIGEST_MISMATCH_DENIED"]);
    }
    if (agentWorkProcessInputGenerationDigestV1(value) !== value.generation.generationDigest) {
        return decision("DENIED", ["GENERATION_DIGEST_MISMATCH_DENIED"]);
    }
    if (value.generation.lkgGenerationDigest !== value.generation.generationDigest) {
        return decision("DENIED", ["LKG_GENERATION_DIGEST_MISMATCH_DENIED"]);
    }
    const eventIds = value.events.map((event) => event.eventId);
    if (new Set(eventIds).size !== eventIds.length) {
        return decision("DENIED", ["DUPLICATE_EVENT_ID_DENIED"]);
    }
    const known = new Set(eventIds);
    if (value.events.some((event) => event.causeEventIds.some((cause) => !known.has(cause)))) {
        return decision("DENIED", ["UNRESOLVED_CAUSE_REFERENCE_DENIED"]);
    }
    return decision("ACCEPTED", ["PROCESS_INPUT_CONFORMANT"]);
}
export function renderPublicAgentWorkProcessInputDecisionV1(value) {
    return canonicalJson(evaluateAgentWorkProcessInputV1(value));
}
